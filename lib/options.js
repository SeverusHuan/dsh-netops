import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

export const DEFAULT_THRESHOLDS = {
  cpu: 80,
  memory: 80,
  disk: 85,
  temperature: 66,
  uptimeHours: 24,
}

/**
 * 配置优先级：环境变量 > <rootDir>/netops.local.json > 插件行的 config > 内置默认值。
 * 机器相关的路径和密码放在 netops.local.json（不进仓库、不进 profile 的 patch）。
 */
export function resolveOptions(config = {}) {
  const rootDir = path.resolve(config.rootDir ?? path.join(os.homedir(), 'dsh-netops'))
  const overrides = readLocalOverrides(rootDir)
  const settings = { ...config, ...overrides }

  const options = {
    pluginDir: PLUGIN_DIR,
    rootDir,
    runsDir: path.join(rootDir, 'runs'),
    reportsDir: path.join(rootDir, 'reports'),
    backupsDir: path.join(rootDir, 'backups'),
    devicesFile: path.resolve(rootDir, settings.devicesFile ?? 'devices.json'),
    runnerScript: path.join(PLUGIN_DIR, 'scripts', 'netops_runner.py'),
    python: settings.python ?? 'python',
    username: settings.username ?? 'admin',
    password: process.env.NETOPS_PASSWORD ?? settings.password ?? '',
    thresholds: { ...DEFAULT_THRESHOLDS, ...(settings.thresholds ?? {}) },
    connTimeoutSec: Number(settings.connTimeoutSec ?? 15),
    readTimeoutSec: Number(settings.readTimeoutSec ?? 30),
    deviceTimeoutSec: Number(settings.deviceTimeoutSec ?? 120),
    runTimeoutMs: Number(settings.runTimeoutMs ?? 20 * 60 * 1000),
    maxDevicesPerRun: Number(settings.maxDevicesPerRun ?? 50),
  }

  for (const dir of [options.rootDir, options.runsDir, options.reportsDir, options.backupsDir]) {
    fs.mkdirSync(dir, { recursive: true })
  }

  return options
}

function readLocalOverrides(rootDir) {
  const file = path.join(rootDir, 'netops.local.json')
  if (!fs.existsSync(file)) return {}
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch (error) {
    console.warn(`[dsh-netops] 忽略无法解析的 ${file}：${error.message}`)
    return {}
  }
}
