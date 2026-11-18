import {
  firstMatch,
  firstNumber,
  parseStatusTable,
  parseTemperatureTable,
  round,
  statusOf,
} from './_common.js'

const UNSUPPORTED = /unrecognized command|invalid input|% ?too many arguments|incomplete command/i

export function parse(outputs, profile, thresholds = {}) {
  const t = thresholds
  const alerts = []
  const notes = []
  const unsupported = []

  for (const [key, text] of Object.entries(outputs ?? {})) {
    if (typeof text === 'string' && UNSUPPORTED.test(text)) unsupported.push(key)
  }

  const version = outputs.version ?? ''
  const board = outputs.board ?? ''
  const inventory = outputs.inventory ?? ''

  const model =
    firstMatch(version, /BOARD TYPE:\s*(\S+)/) ??
    firstMatch(version, /H3C\s+(\S+)\s+uptime is/) ??
    firstMatch(board, /^\s*\d+\s+(\S+)\s+(?:Master|Standby|Slave)/m)
  const os = firstMatch(version, /H3C Comware Software, Version\s*([^\r\n]+)/)
  const uptimeLine = firstMatch(version, /uptime is ([^\r\n]+)/)
  const uptimeHours = uptimeLine === null ? null : parseUptime(uptimeLine)

  const cpu = {
    last5s: firstNumber(outputs.cpu, /(\d+)\s*%\s*in last 5 seconds/i),
    last1m: firstNumber(outputs.cpu, /(\d+)\s*%\s*in last 1 minute/i),
    last5m: firstNumber(outputs.cpu, /(\d+)\s*%\s*in last 5 minutes/i),
  }

  const memMatch = /^\s*Mem:\s+(\d+)\s+(\d+)\s+(\d+)/m.exec(outputs.memory ?? '')
  const memory = memMatch
    ? {
        totalKB: Number(memMatch[1]),
        usedKB: Number(memMatch[2]),
        freeKB: Number(memMatch[3]),
        usedPct: Number(memMatch[1]) > 0 ? round((Number(memMatch[2]) / Number(memMatch[1])) * 100) : null,
      }
    : { totalKB: null, usedKB: null, freeKB: null, usedPct: null }

  const diskMatch = /(\d+)\s*KB\s+total\s*\((\d+)\s*KB\s+free\)/i.exec(outputs.flash ?? '')
  const disk = diskMatch
    ? {
        totalKB: Number(diskMatch[1]),
        freeKB: Number(diskMatch[2]),
        usedPct:
          Number(diskMatch[1]) > 0
            ? round(((Number(diskMatch[1]) - Number(diskMatch[2])) / Number(diskMatch[1])) * 100)
            : null,
      }
    : { totalKB: null, freeKB: null, usedPct: null }

  const fans = parseStatusTable(outputs.fan).map((row) => ({ id: row.id, raw: row.raw, state: statusOf(row.raw) }))
  const powers = parseStatusTable(outputs.power).map((row) => ({ id: row.id, raw: row.raw, state: statusOf(row.raw) }))
  const temps = parseTemperatureTable(outputs.environment)

  const serial = firstMatch(inventory, /DEVICE_SERIAL_NUMBER:\s*(\S+)/)
  const deviceName = firstMatch(inventory, /DEVICE_NAME:\s*(\S+)/)
  const mac = firstMatch(inventory, /MAC_ADDRESS:\s*(\S+)/)

  // ---- 判定 ----
  const cpuLimit = t.cpu ?? 80
  if (cpu.last5m !== null && cpu.last5m >= cpuLimit) {
    alerts.push({
      severity: cpu.last5m >= cpuLimit + 10 ? 'critical' : 'warn',
      message: `CPU 5 分钟均值 ${cpu.last5m}%（阈值 ${cpuLimit}%）`,
    })
  }

  const memLimit = t.memory ?? 80
  if (memory.usedPct !== null && memory.usedPct >= memLimit) {
    alerts.push({
      severity: memory.usedPct >= memLimit + 10 ? 'critical' : 'warn',
      message: `内存使用率 ${memory.usedPct}%（阈值 ${memLimit}%）`,
    })
  }

  const diskLimit = t.disk ?? 85
  if (disk.usedPct !== null && disk.usedPct >= diskLimit) {
    alerts.push({ severity: 'warn', message: `flash 使用率 ${disk.usedPct}%（阈值 ${diskLimit}%）` })
  }

  for (const fan of fans) {
    if (fan.state !== 'normal') {
      alerts.push({ severity: 'critical', message: `风扇 ${fan.id} 状态异常：「${fan.raw}」` })
    }
  }
  for (const power of powers) {
    if (power.state !== 'normal') {
      alerts.push({ severity: 'critical', message: `电源 ${power.id} 状态异常：「${power.raw}」` })
    }
  }

  for (const temp of temps) {
    if (temp.temperature >= temp.alarm) {
      alerts.push({
        severity: 'critical',
        message: `温度 ${temp.sensor} ${temp.temperature}℃ 达到严重阈值 ${temp.alarm}℃`,
      })
    } else if (temp.temperature >= temp.warning) {
      alerts.push({
        severity: 'warn',
        message: `温度 ${temp.sensor} ${temp.temperature}℃ 超过告警阈值 ${temp.warning}℃`,
      })
    }
  }

  const minUptime = t.uptimeHours ?? 24
  if (uptimeHours !== null && uptimeHours < minUptime) {
    alerts.push({
      severity: 'info',
      message: `运行时长 ${formatHours(uptimeHours)}（< ${minUptime}h），可能刚重启过`,
    })
  }

  if (unsupported.length > 0) notes.push(`以下命令在该设备上不被支持：${unsupported.join('、')}`)
  if (fans.length === 0) notes.push('没有读到风扇信息（可能是无风扇型号或命令不同）')
  if (temps.length === 0) notes.push('没有读到温度信息')

  return {
    model,
    os,
    serial,
    deviceName,
    mac,
    uptimeHours: round(uptimeHours, 2),
    cpu,
    memory,
    disk,
    fans,
    powers,
    temps,
    alerts,
    notes,
    unsupported,
  }
}

function formatHours(hours) {
  if (hours === null || hours === undefined) return '-'
  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    const rest = Math.round(hours - days * 24)
    return `${days}天${rest}小时`
  }
  return `${hours.toFixed(1)}小时`
}

/**
 * Comware 的 uptime 单复数会变（"1 hour" 不是 "1 hours"），也可能省略为 0 的部分，
 * 所以按单位分别找，找不到就当 0。
 */
function parseUptime(text) {
  const unit = (pattern) => {
    const match = pattern.exec(text)
    return match ? Number(match[1]) : 0
  }
  const weeks = unit(/(\d+)\s*weeks?/)
  const days = unit(/(\d+)\s*days?/)
  const hours = unit(/(\d+)\s*hours?/)
  const minutes = unit(/(\d+)\s*minutes?/)
  const total = weeks * 168 + days * 24 + hours + minutes / 60
  return Number.isFinite(total) ? total : null
}
