const SEVERITY_LABEL = { critical: '严重', warn: '告警', info: '提示' }

export function pct(value) {
  return value === null || value === undefined ? '-' : `${value}%`
}

export function uptimeText(hours) {
  if (hours === null || hours === undefined) return '-'
  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    return `${days}天${Math.round(hours - days * 24)}小时`
  }
  return `${Number(hours).toFixed(1)}小时`
}

export function fanText(items, label) {
  if (!items || items.length === 0) return '-'
  const normal = items.filter((item) => item.state === 'normal').length
  return `${normal}/${items.length} ${label}正常`
}

export function maxTempText(temps) {
  if (!temps || temps.length === 0) return '-'
  return `${Math.max(...temps.map((temp) => temp.temperature))}℃`
}

export function overviewTable(findings) {
  const rows = [
    ['设备', '地址', '型号', '运行时长', 'CPU', '内存', '风扇', '电源', '温度', '磁盘', '关注'],
  ]
  for (const f of findings) {
    rows.push([
      f.hostname && f.hostname !== f.id ? `${f.id}(${f.hostname})` : f.id,
      f.host,
      f.model ?? '-',
      uptimeText(f.uptimeHours),
      pct(f.cpu.last5m),
      pct(f.memory.usedPct),
      fanText(f.fans, ''),
      fanText(f.powers, ''),
      maxTempText(f.temps),
      pct(f.disk.usedPct),
      f.alerts.length > 0 ? String(f.alerts.length) : '-',
    ])
  }
  return markdownTable(rows)
}

export function markdownTable(rows) {
  if (rows.length === 0) return ''
  const header = rows[0]
  const lines = [`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`]
  for (const row of rows.slice(1)) lines.push(`| ${row.join(' | ')} |`)
  return lines.join('\n')
}

export function renderReport({ runId, startedAt, elapsedMs, checks, thresholds, findings, failures, runnerErrors }) {
  const lines = []
  lines.push(`# 巡检报告 ${runId}`)
  lines.push('')
  lines.push(`- 生成时间：${formatTime(startedAt)}`)
  lines.push(`- 用时：${(elapsedMs / 1000).toFixed(1)}s`)
  lines.push(`- 设备：${findings.length + failures.length} 台（成功 ${findings.length}，失败 ${failures.length}）`)
  lines.push(`- 检查项：${checks.join('、')}`)
  lines.push(
    `- 阈值：CPU ≥ ${thresholds.cpu}%、内存 ≥ ${thresholds.memory}%、磁盘 ≥ ${thresholds.disk}%、运行时长 < ${thresholds.uptimeHours}h 提示`,
  )
  lines.push('')
  lines.push('## 概览')
  lines.push('')
  lines.push(overviewTable(findings))

  const allAlerts = []
  for (const finding of findings) {
    for (const alert of finding.alerts) {
      allAlerts.push(`- [${SEVERITY_LABEL[alert.severity] ?? alert.severity}] ${finding.id}（${finding.host}）：${alert.message}`)
    }
  }
  lines.push('')
  lines.push('## 关注项')
  lines.push('')
  lines.push(allAlerts.length > 0 ? allAlerts.join('\n') : '无')

  if (failures.length > 0 || (runnerErrors && runnerErrors.length > 0)) {
    lines.push('')
    lines.push('## 失败')
    lines.push('')
    for (const failure of failures) lines.push(`- ${failure.id}（${failure.host}）：${failure.error}`)
    for (const error of runnerErrors ?? []) lines.push(`- 执行器：${error}`)
  }

  lines.push('')
  lines.push('## 设备详情')
  for (const finding of findings) {
    lines.push('')
    lines.push(`### ${finding.id}${finding.hostname && finding.hostname !== finding.id ? ` / ${finding.hostname}` : ''}（${finding.host}，${finding.protocol}）`)
    lines.push('')
    lines.push(`- 型号：${finding.model ?? '-'}`)
    lines.push(`- 版本：${finding.os ?? '-'}`)
    lines.push(`- 序列号：${finding.serial ?? '-'}${finding.deviceName ? `（${finding.deviceName}）` : ''}`)
    lines.push(`- MAC：${finding.mac ?? '-'}`)
    lines.push(`- 运行时长：${uptimeText(finding.uptimeHours)}`)
    lines.push(
      `- CPU：5 分钟 ${pct(finding.cpu.last5m)}，1 分钟 ${pct(finding.cpu.last1m)}，5 秒 ${pct(finding.cpu.last5s)}`,
    )
    lines.push(
      `- 内存：${pct(finding.memory.usedPct)}（${finding.memory.usedKB ?? '-'} / ${finding.memory.totalKB ?? '-'} KB）`,
    )
    lines.push(`- 磁盘：${pct(finding.disk.usedPct)}（free ${finding.disk.freeKB ?? '-'} / total ${finding.disk.totalKB ?? '-'} KB）`)
    if (finding.fans.length > 0) {
      lines.push(`- 风扇：${finding.fans.map((fan) => `${fan.id}=${fan.raw}`).join('，')}`)
    }
    if (finding.powers.length > 0) {
      lines.push(`- 电源：${finding.powers.map((power) => `${power.id}=${power.raw}`).join('，')}`)
    }
    if (finding.temps.length > 0) {
      lines.push(
        `- 温度：${finding.temps
          .map((temp) => `${temp.sensor} ${temp.temperature}℃（告警 ${temp.warning}℃ / 严重 ${temp.alarm}℃）`)
          .join('，')}`,
      )
    }
    const commandErrors = Object.entries(finding.commandErrors ?? {})
    if (commandErrors.length > 0) {
      lines.push(`- 命令失败：${commandErrors.map(([key, error]) => `${key}: ${error}`).join('；')}`)
    }
    for (const note of finding.notes) lines.push(`- 说明：${note}`)
  }

  lines.push('')
  lines.push('## 原始输出')
  lines.push('')
  lines.push(`每台设备的命令原文在 \`raw/<设备>.json\`，与本次报告同目录。`)
  lines.push('')
  return lines.join('\n')
}

export function renderCsv(findings) {
  const header = [
    'device', 'host', 'hostname', 'protocol', 'model', 'os', 'serial', 'mac',
    'uptimeHours', 'cpu5m', 'memoryUsedPct', 'diskUsedPct',
    'fans', 'powers', 'maxTemp', 'alerts',
  ]
  const rows = [header]
  for (const f of findings) {
    rows.push([
      f.id,
      f.host,
      f.hostname ?? '',
      f.protocol ?? '',
      f.model ?? '',
      f.os ?? '',
      f.serial ?? '',
      f.mac ?? '',
      f.uptimeHours ?? '',
      f.cpu.last5m ?? '',
      f.memory.usedPct ?? '',
      f.disk.usedPct ?? '',
      fanText(f.fans, ''),
      fanText(f.powers, ''),
      maxTempText(f.temps),
      f.alerts.map((alert) => alert.message).join(' | '),
    ])
  }
  return rows.map((row) => row.map(csvCell).join(',')).join('\n')
}

export function renderSummaryText(result) {
  const lines = []
  const failText = result.failed > 0 ? `，失败 ${result.failed} 台` : ''
  lines.push(`巡检完成：${result.ok}/${result.total} 台成功${failText}，用时 ${(result.elapsedMs / 1000).toFixed(1)}s（run ${result.runId}）`)
  lines.push('')

  const rows = [['设备', '地址', '型号', '运行时长', 'CPU', '内存', '风扇', '温度', '磁盘', '关注']]
  for (const f of result.findings) {
    rows.push([
      f.id,
      f.host,
      f.model ?? '-',
      uptimeText(f.uptimeHours),
      pct(f.cpu.last5m),
      pct(f.memory.usedPct),
      fanText(f.fans, ''),
      maxTempText(f.temps),
      pct(f.disk.usedPct),
      f.alerts.length > 0 ? `!${f.alerts.length}` : '-',
    ])
  }
  lines.push(paddedTable(rows))

  if (result.alerts.length > 0) {
    lines.push('')
    lines.push('关注项：')
    for (const alert of result.alerts) lines.push(`- ${alert}`)
  }
  if (result.failures.length > 0) {
    lines.push('')
    lines.push('失败：')
    for (const failure of result.failures) lines.push(`- ${failure.id}（${failure.host}）：${failure.error}`)
  }
  if (result.runnerErrors && result.runnerErrors.length > 0) {
    lines.push('')
    lines.push('执行器错误：')
    for (const error of result.runnerErrors) lines.push(`- ${error}`)
  }

  lines.push('')
  lines.push(`报告：${result.reportPath}`)
  return lines.join('\n')
}

export function renderDevicesText(devices, file) {
  const lines = [`设备清单：${devices.length} 台（${file}）`, '']
  const rows = [['id', '地址', '协议', '平台', '分组', '用户名']]
  for (const device of devices) {
    rows.push([device.id, device.host, device.protocol ?? 'ssh', device.platform, device.group ?? '-', device.username ?? '-'])
  }
  lines.push(paddedTable(rows))
  return lines.join('\n')
}

function paddedTable(rows) {
  const widths = []
  for (const row of rows) {
    row.forEach((cell, index) => {
      const width = displayWidth(String(cell))
      widths[index] = Math.max(widths[index] ?? 0, width)
    })
  }
  return rows
    .map((row) => row.map((cell, index) => padRight(String(cell), widths[index])).join('  ').trimEnd())
    .join('\n')
}

function displayWidth(text) {
  let width = 0
  for (const char of text) width += char.charCodeAt(0) > 0x2e80 ? 2 : 1
  return width
}

function padRight(text, width) {
  const pad = width - displayWidth(text)
  return pad > 0 ? text + ' '.repeat(pad) : text
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

function formatTime(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
