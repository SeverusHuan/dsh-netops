import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveOptions } from '../lib/options.js'
import { createStore } from '../lib/store.js'
import { inspectDevices } from '../lib/inspect.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = path.join(HERE, 'public')
const PACKAGE_JSON = path.join(HERE, '..', 'package.json')

const STATIC_FILES = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/app.js', 'app.js'],
  ['/style.css', 'style.css'],
])

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}

// 没有 DSH 的 subprocess 服务时，runner 会自己退回 child_process
const ctx = { get: () => undefined }

export function createGuiServer({ rootDir } = {}) {
  const options = resolveOptions(rootDir ? { rootDir } : {})
  const store = createStore(options)

  const server = http.createServer((req, res) => {
    route(req, res).catch((error) => {
      if (!res.headersSent) sendJson(res, 500, { error: String(error?.message ?? error) })
      else res.end()
    })
  })

  async function route(req, res) {
    if (!isLocalRequest(req)) return sendJson(res, 403, { error: '只接受本机访问' })

    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const pathname = url.pathname

    if (req.method === 'GET' && STATIC_FILES.has(pathname)) {
      return sendFile(res, STATIC_FILES.get(pathname))
    }

    if (req.method === 'GET' && pathname === '/api/status') {
      return sendJson(res, 200, {
        version: readVersion(),
        rootDir: options.rootDir,
        python: options.python,
        username: options.username,
        devices: listDevices(),
        checks: DEFAULT_CHECKS,
        thresholds: options.thresholds,
        runs: recentRuns(8),
      })
    }

    if (req.method === 'POST' && pathname === '/api/inspect') {
      const body = await readJson(req)
      return sendJson(res, 200, await inspect(body))
    }

    if (req.method === 'GET' && pathname === '/api/runs') {
      return sendJson(res, 200, { runs: recentRuns(20) })
    }

    if (req.method === 'GET' && pathname.startsWith('/api/runs/')) {
      const runId = decodeURIComponent(pathname.slice('/api/runs/'.length))
      return sendJson(res, 200, readRun(runId))
    }

    if (req.method === 'POST' && pathname === '/api/quit') {
      sendJson(res, 200, { ok: true })
      setTimeout(() => process.exit(0), 150)
      return
    }

    return sendJson(res, 404, { error: 'not found' })
  }

  async function inspect(body = {}) {
    const host = String(body.host ?? '').trim()
    if (!host) throw new Error('请填写设备 IP 地址')

    const device = {
      id: String(body.id ?? host).trim() || host,
      host,
      port: body.port ? Number(body.port) : undefined,
      protocol: body.protocol === 'telnet' ? 'telnet' : 'ssh',
      username: String(body.username ?? options.username ?? ''),
      password: String(body.password ?? ''),
    }

    const result = await inspectDevices(ctx, { options, store }, {
      inlineDevices: [device],
      checks: body.checks,
    })

    return {
      runId: result.runId,
      reportPath: result.reportPath,
      total: result.total,
      ok: result.ok,
      failed: result.failed,
      elapsedMs: result.elapsedMs,
      findings: result.findings.map(compactFinding),
      failures: result.failures,
      runnerErrors: result.runnerErrors,
    }
  }

  function listDevices() {
    try {
      return store.list({}).map((device) => ({
        id: device.id,
        host: device.host,
        protocol: device.protocol,
        platform: device.platform,
        group: device.group,
      }))
    } catch {
      return []
    }
  }

  function recentRuns(limit) {
    try {
      return fs
        .readdirSync(options.runsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
        .reverse()
        .slice(0, limit)
        .map((runId) => {
          const meta = readJsonFile(path.join(options.runsDir, runId, 'meta.json'))
          return {
            runId,
            startedAt: meta?.startedAt ?? null,
            ok: meta?.ok ?? null,
            failed: meta?.failed ?? null,
            devices: meta?.devices ?? [],
          }
        })
    } catch {
      return []
    }
  }

  function readRun(runId) {
    if (!/^[A-Za-z0-9._-]+$/.test(runId)) throw new Error('runId 不合法')
    const dir = path.join(options.runsDir, runId)
    const reportPath = path.join(dir, 'report.md')
    if (!fs.existsSync(reportPath)) throw new Error(`找不到报告：${runId}`)
    const report = fs.readFileSync(reportPath, 'utf8').slice(0, 200_000)
    return { runId, reportPath, meta: readJsonFile(path.join(dir, 'meta.json')), report }
  }

  return { server, options, store }
}

const DEFAULT_CHECKS = [
  { id: 'identity', label: '设备身份' },
  { id: 'uptime', label: '运行时长' },
  { id: 'cpu', label: 'CPU' },
  { id: 'memory', label: '内存' },
  { id: 'fan', label: '风扇' },
  { id: 'power', label: '电源' },
  { id: 'thermal', label: '温度' },
  { id: 'disk', label: '磁盘' },
]

function compactFinding(finding) {
  return {
    id: finding.id,
    host: finding.host,
    hostname: finding.hostname,
    protocol: finding.protocol,
    model: finding.model,
    os: finding.os,
    serial: finding.serial,
    mac: finding.mac,
    uptimeHours: finding.uptimeHours,
    cpu: finding.cpu,
    memory: finding.memory,
    disk: finding.disk,
    fans: finding.fans,
    powers: finding.powers,
    temps: finding.temps,
    alerts: finding.alerts,
    notes: finding.notes,
  }
}

function isLocalRequest(req) {
  const host = String(req.headers.host ?? '')
  const name = host.replace(/:\d+$/, '')
  return name === '127.0.0.1' || name === 'localhost' || name === '[::1]' || name === '::1'
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function sendFile(res, name) {
  const file = path.join(PUBLIC_DIR, name)
  if (!fs.existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
    return
  }
  const body = fs.readFileSync(file)
  res.writeHead(200, {
    'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
    'content-length': body.length,
  })
  res.end(body)
}

function readJson(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function readVersion() {
  const pkg = readJsonFile(PACKAGE_JSON)
  return pkg?.version ?? '0.0.0'
}
