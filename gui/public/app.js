const $ = (id) => document.getElementById(id)

const state = {
  status: null,
  lastRun: null,
  running: false,
}

init()

async function init() {
  wire()
  try {
    const status = await getJson('/api/status')
    state.status = status
    renderEnv(status)
    renderChecks(status.checks ?? [])
    if (status.username) $('username').value = status.username
    renderRuns(status.runs ?? [])
  } catch (error) {
    showError(`连接本地面板失败：${error.message}`)
  }
}

function wire() {
  $('run').addEventListener('click', runInspect)
  $('refresh').addEventListener('click', refreshRuns)
  $('open-report').addEventListener('click', () => state.lastRun && showReport(state.lastRun))
  $('closeReport').addEventListener('click', () => $('reportDialog').close())
  $('quit').addEventListener('click', quit)
  $('protocol').addEventListener('change', () => {
    $('port').placeholder = $('protocol').value === 'telnet' ? '23' : '22'
  })
  $('history').addEventListener('click', (event) => {
    const row = event.target.closest('.run')
    if (row) showReport(row.dataset.run)
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.matches('input') && !state.running) runInspect()
  })
}

function renderEnv(status) {
  const env = $('env')
  env.textContent = ''
  $('version').textContent = `v${status.version}`
  env.append(chip(`Python`, true), chip('netmiko', true), chip(status.rootDir, true))
  if (!status.devices || status.devices.length === 0) {
    env.append(chip('设备清单未配置', false))
  }
}

function chip(text, ok) {
  const span = document.createElement('span')
  span.className = `chip ${ok ? 'ok' : 'bad'}`
  span.textContent = text
  span.title = text
  return span
}

function renderChecks(checks) {
  const box = $('checks')
  box.textContent = ''
  for (const check of checks) {
    const label = document.createElement('label')
    label.className = 'check'
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.value = check.id
    input.checked = true
    label.append(input, document.createTextNode(check.label))
    box.append(label)
  }
}

function selectedChecks() {
  const picked = [...document.querySelectorAll('#checks input:checked')].map((input) => input.value)
  return picked.length > 0 ? picked : undefined
}

async function runInspect() {
  if (state.running) return
  const host = $('host').value.trim()
  if (!host) {
    showError('请填写设备 IP 地址')
    $('host').focus()
    return
  }

  const body = {
    host,
    port: $('port').value.trim() || undefined,
    protocol: $('protocol').value,
    username: $('username').value.trim(),
    password: $('password').value,
    checks: selectedChecks(),
  }

  setRunning(true)
  hideError()
  $('hint').className = 'hint'
  $('hint').textContent = '巡检中…（每台大约 10 秒）'

  try {
    const data = await postJson('/api/inspect', body)
    state.lastRun = data.runId
    renderResult(data)
    await refreshRuns()
  } catch (error) {
    showError(error.message)
  } finally {
    setRunning(false)
    $('hint').textContent = ''
  }
}

function setRunning(running) {
  state.running = running
  $('run').disabled = running
  $('run').textContent = running ? '巡检中…' : '开始巡检'
}

function renderResult(data) {
  $('result').classList.remove('hidden')
  const finding = (data.findings && data.findings[0]) ?? null

  $('r-name').textContent = finding ? (finding.hostname || finding.id) : '巡检失败'
  const seconds = (data.elapsedMs / 1000).toFixed(1)
  $('r-meta').textContent = finding
    ? `${finding.host} · ${finding.protocol} · 用时 ${seconds}s · ${data.runId}`
    : `${data.runId} · 用时 ${seconds}s`

  const tilesBox = $('tiles')
  tilesBox.textContent = ''
  const alertsBox = $('alerts')
  alertsBox.textContent = ''

  if (!finding) {
    const failure = (data.failures && data.failures[0]) || (data.runnerErrors && { error: data.runnerErrors[0] })
    showError(failure?.error || '没有拿到任何巡检数据')
    $('paths').textContent = ''
    return
  }

  const limits = state.status?.thresholds ?? { cpu: 80, memory: 80, disk: 85 }
  tilesBox.append(
    tile('型号', finding.model ?? '-'),
    tile('版本', finding.os ?? '-'),
    tile('运行时长', uptime(finding.uptimeHours)),
    tile('CPU', pct(finding.cpu?.last5m), level(finding.cpu?.last5m, limits.cpu, limits.cpu - 12)),
    tile('内存', pct(finding.memory?.usedPct), level(finding.memory?.usedPct, limits.memory, limits.memory - 12)),
    tile('风扇', fans(finding.fans)),
    tile('电源', fans(finding.powers)),
    tile('最高温度', maxTemp(finding.temps), tempLevel(finding.temps)),
    tile('磁盘', pct(finding.disk?.usedPct), level(finding.disk?.usedPct, limits.disk, limits.disk - 10)),
  )

  for (const alert of finding.alerts ?? []) {
    const row = document.createElement('div')
    row.className = `alert ${alert.severity}`
    const tag = document.createElement('span')
    tag.className = 'tag'
    tag.textContent = { critical: '严重', warn: '告警', info: '提示' }[alert.severity] ?? alert.severity
    const text = document.createElement('span')
    text.textContent = alert.message
    row.append(tag, text)
    alertsBox.append(row)
  }

  const paths = $('paths')
  paths.textContent = ''
  const code = document.createElement('code')
  code.textContent = data.reportPath
  paths.append(document.createTextNode('报告：'), code)
}

function tile(key, value, tone = '') {
  const box = document.createElement('div')
  box.className = `tile ${tone}`.trim()
  const k = document.createElement('div')
  k.className = 'k'
  k.textContent = key
  const v = document.createElement('div')
  v.className = 'v'
  v.textContent = value
  box.append(k, v)
  return box
}

function level(value, bad, warn) {
  if (value === null || value === undefined) return ''
  if (value >= bad) return 'bad'
  if (value >= warn) return 'warn'
  return 'good'
}

function tempLevel(temps) {
  if (!temps || temps.length === 0) return ''
  const worst = temps.reduce((acc, temp) => (temp.temperature > acc.temperature ? temp : acc), temps[0])
  if (worst.temperature >= worst.alarm) return 'bad'
  if (worst.temperature >= worst.warning) return 'warn'
  return 'good'
}

function pct(value) {
  return value === null || value === undefined ? '-' : `${value}%`
}

function uptime(hours) {
  if (hours === null || hours === undefined) return '-'
  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    return `${days}天${Math.round(hours - days * 24)}小时`
  }
  return `${Number(hours).toFixed(1)}小时`
}

function fans(items) {
  if (!items || items.length === 0) return '-'
  const normal = items.filter((item) => item.state === 'normal').length
  return `${normal}/${items.length}`
}

function maxTemp(temps) {
  if (!temps || temps.length === 0) return '-'
  return `${Math.max(...temps.map((temp) => temp.temperature))}℃`
}

async function refreshRuns() {
  const data = await getJson('/api/runs')
  renderRuns(data.runs ?? [])
}

function renderRuns(runs) {
  const box = $('history')
  box.textContent = ''
  if (!runs || runs.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'empty'
    empty.textContent = '还没有巡检记录'
    box.append(empty)
    return
  }
  for (const run of runs) {
    const row = document.createElement('div')
    row.className = 'run'
    row.dataset.run = run.runId

    const when = document.createElement('span')
    when.className = 'when'
    when.textContent = formatTime(run.startedAt) || run.runId

    const badge = document.createElement('span')
    const failed = Number(run.failed ?? 0)
    badge.className = `badge ${failed > 0 ? 'bad' : 'ok'}`
    badge.textContent = failed > 0 ? `${failed} 台失败` : '成功'

    const count = document.createElement('span')
    count.className = 'when'
    count.textContent = run.devices?.length ? run.devices.join('，') : ''

    row.append(when, count, badge)
    box.append(row)
  }
}

async function showReport(runId) {
  try {
    const data = await getJson(`/api/runs/${encodeURIComponent(runId)}`)
    $('reportTitle').textContent = runId
    $('reportBody').textContent = data.report ?? '（空）'
    $('reportDialog').showModal()
  } catch (error) {
    showError(`读取报告失败：${error.message}`)
  }
}

async function quit() {
  try {
    await postJson('/api/quit', {})
  } catch {
    // 服务已经退出也无所谓
  }
  window.close()
}

function formatTime(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function showError(message) {
  const box = $('error')
  box.textContent = message
  box.classList.remove('hidden')
}

function hideError() {
  const box = $('error')
  box.textContent = ''
  box.classList.add('hidden')
}

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  return parse(response)
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return parse(response)
}

async function parse(response) {
  let data = null
  try {
    data = await response.json()
  } catch {
    data = null
  }
  if (!response.ok) throw new Error(data?.error ?? `请求失败（HTTP ${response.status}）`)
  return data
}
