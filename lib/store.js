import fs from 'node:fs'

/**
 * 设备清单的唯一来源：<rootDir>/devices.json
 * 只做读取与筛选，不写文件——改设备请直接改这个 JSON（M3 才做页面编辑）。
 */
export function createStore(options) {
  function read() {
    if (!fs.existsSync(options.devicesFile)) {
      throw new Error(
        `找不到设备清单：${options.devicesFile}。先创建它，内容形如 {"devices":[{"id":"sw1","host":"192.168.0.1","protocol":"ssh","platform":"h3c_comware"}]}`,
      )
    }
    let parsed
    try {
      parsed = JSON.parse(fs.readFileSync(options.devicesFile, 'utf8'))
    } catch (error) {
      throw new Error(`设备清单不是合法 JSON（${options.devicesFile}）：${error.message}`)
    }
    const list = Array.isArray(parsed) ? parsed : parsed.devices
    if (!Array.isArray(list)) {
      throw new Error(`设备清单格式不对（${options.devicesFile}）：需要 {"devices": [...]} 或数组`)
    }
    return list.map(normalize)
  }

  return {
    file: options.devicesFile,
    list(filter = {}) {
      let list = read()
      const ids = filter.ids ?? filter.devices
      if (Array.isArray(ids) && ids.length > 0) {
        const wanted = new Set(ids.map((id) => String(id)))
        list = list.filter((device) => wanted.has(device.id))
      }
      if (filter.group) list = list.filter((device) => device.group === filter.group)
      if (filter.tag) list = list.filter((device) => device.tags.includes(filter.tag))
      return list
    },
  }
}

function normalize(device, index) {
  if (!device || typeof device !== 'object') throw new Error(`设备清单第 ${index + 1} 条不是对象`)
  if (!device.host) throw new Error(`设备清单第 ${index + 1} 条缺少 host`)
  const id = String(device.id ?? device.host)
  return {
    id,
    host: String(device.host),
    port: device.port === undefined ? undefined : Number(device.port),
    protocol: device.protocol ?? 'ssh',
    platform: device.platform ?? 'h3c_comware',
    group: device.group ?? 'default',
    username: device.username,
    password: device.password,
    tags: Array.isArray(device.tags) ? device.tags.map(String) : [],
    note: device.note,
  }
}
