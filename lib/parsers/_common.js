export function firstMatch(text, pattern) {
  const match = pattern.exec(text ?? '')
  return match && match[1] !== undefined ? String(match[1]).trim() : null
}

export function firstNumber(text, pattern) {
  const match = pattern.exec(text ?? '')
  return match && match[1] !== undefined ? Number(match[1]) : null
}

/** "Device Info on Slot 1:\nDevice ID.  Status\n 1   Normal" → [{id, raw}] */
export function parseStatusTable(text) {
  const rows = []
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue
    if (/device\s*id\.?\s*status/i.test(line)) continue
    const match = /^\s*(\d+)\s+(\S.*?)\s*$/.exec(line)
    if (!match) continue
    rows.push({ id: match[1], raw: match[2] })
  }
  return rows
}

export function statusOf(raw) {
  const text = String(raw ?? '').trim().toLowerCase()
  if (!text) return 'unknown'
  if (/abnormal|fault|fail|error|critical|not present|absent|offline/.test(text)) return 'abnormal'
  if (/normal|present|good|\bok\b/.test(text)) return 'normal'
  return 'unknown'
}

/**
 * 温度表：列宽靠空格对齐，传感器名里也可能有空格，所以按 token 切：
 * 第一个 token 是槽位，最后 4 个数字是 温度/下限/告警/严重，中间是传感器名。
 */
export function parseTemperatureTable(text) {
  const rows = []
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (!/^-{3,}\s*$/.test(line.trim()) && !line.trim()) continue
    const tokens = line.trim().split(/\s+/)
    if (tokens.length < 6) continue
    if (!/^\d+(\/\d+)?$/.test(tokens[0])) continue
    const numbers = tokens.slice(-4)
    if (!numbers.every((token) => /^-?\d+$/.test(token))) continue
    const sensor = tokens.slice(1, -4).join(' ')
    if (!sensor) continue
    rows.push({
      slot: tokens[0],
      sensor,
      temperature: Number(numbers[0]),
      lower: Number(numbers[1]),
      warning: Number(numbers[2]),
      alarm: Number(numbers[3]),
    })
  }
  return rows
}

export function round(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
