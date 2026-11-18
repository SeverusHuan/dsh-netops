import fs from 'node:fs'
import path from 'node:path'
import { loadParser, loadProfile } from './profiles.js'
import { executeJob } from './runner.js'
import { renderCsv, renderReport } from './report.js'

export const DEFAULT_CHECKS = ['identity', 'uptime', 'cpu', 'memory', 'fan', 'power', 'thermal', 'disk']

export async function inspectDevices(ctx, { options, store }, args = {}) {
  const ids = Array.isArray(args.devices) && args.devices.length > 0 ? args.devices : undefined
  const devices = store.list({ ids })
  if (devices.length === 0) {
    throw new Error(`没有匹配的设备（设备清单：${store.file}）。先用 netops_devices 看看有哪些 id。`)
  }
  if (devices.length > options.maxDevicesPerRun) {
    throw new Error(
      `一次最多巡检 ${options.maxDevicesPerRun} 台，这次匹配到 ${devices.length} 台。请用 devices 参数分批，或调大 maxDevicesPerRun。`,
    )
  }

  const checks = normalizeChecks(args.checks)
  const thresholds = options.thresholds
  const startedAt = new Date()
  const startedAtMs = Date.now()
  const runId = makeRunId('inspect')
  const runDir = path.join(options.runsDir, runId)
  fs.mkdirSync(path.join(runDir, 'raw'), { recursive: true })

  const findings = []
  const failures = []
  const runnerErrors = []

  const byPlatform = groupBy(devices, (device) => device.platform)
  let index = 0

  for (const [platform, list] of byPlatform) {
    const profile = loadProfile(options.pluginDir, platform)
    const parser = await loadParser(platform)
    const commandKeys = commandsFor(profile, checks)
    if (commandKeys.length === 0) {
      throw new Error(`平台 ${platform} 没有配置检查项 ${checks.join('/')} 对应的命令`)
    }

    const jobDevices = list.map((device) => {
      const protocol = args.protocol ?? device.protocol ?? 'ssh'
      const netmiko = profile.netmiko[protocol]
      if (!netmiko) throw new Error(`平台 ${platform} 不支持 ${protocol} 登录`)
      return {
        id: device.id,
        host: device.host,
        port: device.port ?? profile.defaultPort?.[protocol] ?? (protocol === 'telnet' ? 23 : 22),
        protocol,
        netmiko,
        username: device.username ?? options.username,
        password: device.password || options.password,
      }
    })

    const commands = commandKeys.map((key) => ({ key, command: profile.commands[key] }))
    const tag = `${index++}-${platform}`

    let result
    try {
      result = await executeJob(ctx, options, {
        runDir,
        tag,
        devices: jobDevices,
        commands,
        jobOptions: {},
      })
    } catch (error) {
      runnerErrors.push(`${platform}: ${error.message}`)
      continue
    }

    for (const record of result.devices ?? []) {
      const device = list.find((item) => item.id === record.id) ?? { id: record.id, host: record.host }
      if (!record.ok) {
        failures.push({ id: record.id, host: record.host, error: record.error ?? '连接失败（未返回原因）' })
        continue
      }

      let parsed
      try {
        parsed = parser.parse(record.outputs ?? {}, profile, thresholds)
      } catch (error) {
        failures.push({ id: record.id, host: record.host, error: `解析失败：${error.message}` })
        continue
      }

      findings.push({
        id: record.id,
        host: record.host,
        hostname: record.hostname ?? null,
        protocol: record.protocol ?? null,
        group: device.group ?? null,
        elapsedSec: record.elapsedSec ?? null,
        commandErrors: record.errors ?? {},
        ...parsed,
      })

      fs.writeFileSync(
        path.join(runDir, 'raw', `${safeName(record.id)}.json`),
        JSON.stringify(
          {
            id: record.id,
            host: record.host,
            protocol: record.protocol,
            hostname: record.hostname,
            capturedAt: startedAt.toISOString(),
            outputs: record.outputs ?? {},
            errors: record.errors ?? {},
          },
          null,
          2,
        ),
        'utf8',
      )
    }
  }

  const elapsedMs = Date.now() - startedAtMs
  const report = renderReport({
    runId,
    startedAt,
    elapsedMs,
    checks,
    thresholds,
    findings,
    failures,
    runnerErrors,
  })
  const reportPath = path.join(runDir, 'report.md')
  fs.writeFileSync(reportPath, report, 'utf8')
  fs.writeFileSync(path.join(runDir, 'summary.csv'), renderCsv(findings), 'utf8')
  fs.writeFileSync(
    path.join(runDir, 'meta.json'),
    JSON.stringify(
      {
        runId,
        startedAt: startedAt.toISOString(),
        elapsedMs,
        checks,
        thresholds,
        devices: devices.map((device) => device.id),
        ok: findings.length,
        failed: failures.length,
      },
      null,
      2,
    ),
    'utf8',
  )
  fs.writeFileSync(path.join(options.reportsDir, `${runId}.md`), report, 'utf8')

  const alerts = findings.flatMap((finding) =>
    finding.alerts.map((alert) => `${finding.id}（${finding.host}）：${alert.message}`),
  )

  return {
    runId,
    runDir,
    reportPath,
    total: devices.length,
    ok: findings.length,
    failed: devices.length - findings.length,
    elapsedMs,
    alerts,
    failures,
    runnerErrors,
    findings,
  }
}

export function normalizeChecks(input) {
  if (input === undefined || input === null) return [...DEFAULT_CHECKS]
  const list = Array.isArray(input) ? input : [input]
  const checks = []
  for (const item of list) {
    const value = String(item)
    if (value === 'all') {
      for (const check of DEFAULT_CHECKS) if (!checks.includes(check)) checks.push(check)
      continue
    }
    if (!DEFAULT_CHECKS.includes(value)) {
      throw new Error(`未知检查项「${value}」，可选：${DEFAULT_CHECKS.join('、')}、all`)
    }
    if (!checks.includes(value)) checks.push(value)
  }
  return checks.length > 0 ? checks : [...DEFAULT_CHECKS]
}

function commandsFor(profile, checks) {
  const keys = []
  for (const check of checks) {
    for (const key of profile.checks?.[check] ?? []) {
      if (profile.commands[key] && !keys.includes(key)) keys.push(key)
    }
  }
  return keys
}

function groupBy(list, selector) {
  const map = new Map()
  for (const item of list) {
    const key = selector(item)
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(item)
  }
  return map
}

function makeRunId(kind) {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${kind}`
}

function safeName(name) {
  return String(name).replace(/[^A-Za-z0-9._-]/g, '_')
}
