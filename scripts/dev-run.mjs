/**
 * 开发用：不装插件、直接跑巡检链路（用于验证解析器/执行器改动）。
 *   node scripts/dev-run.mjs '{"devices":["sw1"]}' '{"protocol":"telnet"}'
 * 参数 1 = netops_inspect 的入参；参数 2 = 可选，覆盖配置（rootDir/python/password...）。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveOptions } from '../lib/options.js'
import { createStore } from '../lib/store.js'
import { inspectDevices } from '../lib/inspect.js'
import { renderSummaryText } from '../lib/report.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(here, '..', '..', 'netops')

const overrides = process.argv[3] ? JSON.parse(process.argv[3]) : {}
const options = resolveOptions({
  rootDir,
  python: process.env.NETOPS_PYTHON ?? 'python',
  username: process.env.NETOPS_USER ?? 'admin',
  password: process.env.NETOPS_PASSWORD ?? '',
  ...overrides,
})
const store = createStore(options)
const ctx = { get: () => undefined }

const args = process.argv[2] ? JSON.parse(process.argv[2]) : {}
const result = await inspectDevices(ctx, { options, store }, args)
console.log(renderSummaryText(result))
