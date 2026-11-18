import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { runCommand } from './runner.js'

const PROBE = [
  'import sys, json',
  'info = {"python": sys.version.split()[0], "executable": sys.executable}',
  'try:',
  '    import netmiko',
  '    info["netmiko"] = netmiko.__version__',
  'except Exception as error:',
  '    info["netmiko"] = None',
  '    info["netmikoError"] = type(error).__name__',
  'print(json.dumps(info))',
].join('\n')

/**
 * 环境自检：Python / netmiko / 数据目录 / 设备清单 / （可选）管理地址连通性。
 * 目的不是替用户装东西，而是把「缺什么、怎么补」直接说清楚。
 */
export async function diagnose(ctx, { options, store }, args = {}) {
  const checks = []

  const python = await checkPython(ctx, options)
  checks.push({
    name: 'python',
    ok: python.ok,
    detail: python.detail,
    fix: python.ok ? undefined : fixPython(options),
  })
  checks.push({
    name: 'netmiko',
    ok: Boolean(python.netmiko),
    detail: python.netmiko ? `netmiko ${python.netmiko}` : python.netmikoError ?? '没有导入成功',
    fix: python.netmiko ? undefined : `"${options.python}" -m pip install netmiko`,
  })

  checks.push(checkWritable(options))
  checks.push(checkDevices(store))

  let deviceChecks
  if (args.network === true) {
    deviceChecks = await checkNetwork(store)
  }

  const ok = checks.every((check) => check.ok) && (deviceChecks ? deviceChecks.every((d) => d.ok) : true)

  return {
    ok,
    checks: checks.map((check) => ({ ...check, detail: String(check.detail ?? '').slice(0, 300) })),
    devices: deviceChecks,
    text: renderText({ checks, deviceChecks, options, ok }),
  }
}

async function checkPython(ctx, options) {
  try {
    const run = await runCommand(ctx, options, ['-c', PROBE])
    const lines = (run.stdout ?? '').trim().split(/\r?\n/).filter(Boolean)
    const line = lines.pop() ?? ''
    if (run.code !== 0 || line === '') {
      return { ok: false, detail: firstReason(run), netmiko: null }
    }
    let info
    try {
      info = JSON.parse(line)
    } catch {
      return { ok: false, detail: `Python 输出无法解析：${line.slice(0, 200)}`, netmiko: null }
    }
    return { ok: true, detail: `Python ${info.python}（${info.executable}）`, ...info }
  } catch (error) {
    return {
      ok: false,
      detail: `无法运行 ${options.python}：${String(error.message ?? error).slice(0, 200)}`,
      netmiko: null,
    }
  }
}

function firstReason(run) {
  const text = `${run.stderr ?? ''}\n${run.stdout ?? ''}`
  const line = text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item !== '')
  if (!line) return `Python 没有输出（退出码 ${run.code ?? '未知'}），路径是否正确？`
  return line.replace(/^执行器启动失败：/, '').slice(0, 240)
}

function checkWritable(options) {
  const file = path.join(options.rootDir, '.netops-write-test')
  try {
    fs.writeFileSync(file, 'ok', 'utf8')
    fs.rmSync(file, { force: true })
    return { name: 'rootDir', ok: true, detail: options.rootDir }
  } catch (error) {
    return {
      name: 'rootDir',
      ok: false,
      detail: `数据目录不可写：${options.rootDir}（${error.message}）`,
      fix: `换一个可写目录，在插件 config 里设置 rootDir，或在 netops.local.json 里去掉自定义路径`,
    }
  }
}

function checkDevices(store) {
  try {
    const devices = store.list({})
    if (devices.length === 0) {
      return { name: 'devices', ok: false, detail: `设备清单是空的：${store.file}`, fix: '往 devices.json 里加至少一台设备' }
    }
    const protocols = new Set(devices.map((device) => device.protocol ?? 'ssh'))
    return {
      name: 'devices',
      ok: true,
      detail: `${devices.length} 台（${[...protocols].join('/')}）— ${store.file}`,
    }
  } catch (error) {
    return { name: 'devices', ok: false, detail: error.message, fix: '按 README 的格式创建 devices.json' }
  }
}

async function checkNetwork(store) {
  let devices = []
  try {
    devices = store.list({}).slice(0, 20)
  } catch {
    return []
  }
  return Promise.all(
    devices.map(async (device) => {
      const port = device.port ?? ((device.protocol ?? 'ssh') === 'telnet' ? 23 : 22)
      const ok = await probeTcp(device.host, port)
      return { id: device.id, host: device.host, port, ok }
    }),
  )
}

function probeTcp(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    const settle = (result) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => settle(true))
    socket.once('timeout', () => settle(false))
    socket.once('error', () => settle(false))
  })
}

function fixPython(options) {
  return [
    `当前配置的 python：${options.python}`,
    '· 没装 Python：https://www.python.org/downloads/ 装 3.8+，安装时勾选 Add python.exe to PATH',
    '· 装了但路径不对：在 <rootDir>/netops.local.json 里写 {"python": "C:\\\\...\\\\python.exe"}',
    '· 用 WSL/Docker 的 python 也可以，但要保证它能访问设备管理网段',
  ].join('\n')
}

function renderText({ checks, deviceChecks, options, ok }) {
  const lines = []
  lines.push(ok ? '环境自检通过' : '环境自检发现问题')
  lines.push('')
  for (const check of checks) {
    lines.push(`${check.ok ? '[OK]  ' : '[FAIL]'} ${check.name.padEnd(9)} ${check.detail}`)
  }

  const fixes = checks.filter((check) => !check.ok)
  if (fixes.length > 0) {
    lines.push('')
    lines.push('怎么修：')
    for (const check of fixes) {
      if (check.fix) lines.push(`- ${check.name}：${check.fix}`)
    }
  }

  if (deviceChecks) {
    lines.push('')
    lines.push('管理地址连通性：')
    for (const device of deviceChecks) {
      lines.push(`${device.ok ? '  [OK]  ' : '  [FAIL]'} ${device.id} ${device.host}:${device.port}`)
    }
  } else {
    lines.push('')
    lines.push('（没有测管理地址连通性；需要时传 network: true）')
  }

  lines.push('')
  lines.push(`数据目录：${options.rootDir}`)
  return lines.join('\n')
}
