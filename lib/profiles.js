import fs from 'node:fs'
import path from 'node:path'

const PARSERS = {
  h3c_comware: () => import('./parsers/h3c_comware.js'),
}

export function loadProfile(pluginDir, platform) {
  const file = path.join(pluginDir, 'profiles', `${platform}.json`)
  if (!fs.existsSync(file)) {
    throw new Error(`未知平台「${platform}」：缺少 ${file}。新增厂商需要补一份 profile 和一个解析器。`)
  }
  const profile = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!profile.netmiko || !profile.commands) {
    throw new Error(`profile 不完整（${file}）：需要 netmiko 与 commands 字段`)
  }
  return profile
}

export async function loadParser(platform) {
  const factory = PARSERS[platform]
  if (!factory) throw new Error(`平台「${platform}」还没有解析器（lib/parsers/${platform}.js）`)
  return factory()
}

export function knownPlatforms() {
  return Object.keys(PARSERS)
}
