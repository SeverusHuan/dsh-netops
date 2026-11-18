import fs from 'node:fs'
import path from 'node:path'
import { inspectDevices } from './inspect.js'
import { renderDevicesText, renderSummaryText } from './report.js'

const CHECK_ENUM = ['identity', 'uptime', 'cpu', 'memory', 'fan', 'power', 'thermal', 'disk', 'all']

export function registerTools(ctx, deps) {
  const disposers = []

  disposers.push(
    ctx.tools.register({
      name: 'netops_devices',
      description: '列出插件里登记的网络设备（id、管理地址、协议、平台、分组）。巡检前先用它确认设备 id。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: {
        schema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: '设备清单表格（纯文本）。' },
            count: { type: 'number', description: '设备数量。' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: value.text }],
      },
      async execute() {
        const devices = deps.store.list({})
        const text = renderDevicesText(devices, deps.store.file)
        return {
          count: devices.length,
          text,
          devices: devices.map((device) => ({
            id: device.id,
            host: device.host,
            protocol: device.protocol ?? 'ssh',
            platform: device.platform,
            group: device.group ?? null,
          })),
        }
      },
    }),
  )

  disposers.push(
    ctx.tools.register({
      name: 'netops_inspect',
      description:
        '对网络设备执行只读巡检：设备身份、运行时长、CPU、内存、风扇、电源、温度、磁盘，按阈值给出关注项，并生成报告。不修改任何配置。',
      parameters: {
        type: 'object',
        properties: {
          devices: {
            type: 'array',
            items: { type: 'string' },
            description: '设备 id 列表；省略表示巡检设备清单里的全部设备。',
          },
          checks: {
            type: 'array',
            items: { type: 'string', enum: CHECK_ENUM },
            description: '要检查的项；省略或 all 表示全部（identity/uptime/cpu/memory/fan/power/thermal/disk）。',
          },
          protocol: {
            type: 'string',
            enum: ['ssh', 'telnet'],
            description: '强制使用的登录协议；省略则按设备记录里的 protocol。',
          },
        },
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            runId: { type: 'string' },
            total: { type: 'number' },
            ok: { type: 'number' },
            failed: { type: 'number' },
            alerts: { type: 'array', items: { type: 'string' } },
            reportPath: { type: 'string' },
            summary: { type: 'string', description: '给模型看的巡检汇总（表格 + 关注项）。' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: value.summary }],
      },
      timeoutMs: 20 * 60 * 1000,
      async execute(args = {}) {
        const result = await inspectDevices(ctx, deps, args)
        return {
          runId: result.runId,
          total: result.total,
          ok: result.ok,
          failed: result.failed,
          alerts: result.alerts,
          reportPath: result.reportPath,
          summary: renderSummaryText(result),
        }
      },
    }),
  )

  disposers.push(
    ctx.tools.register({
      name: 'netops_run_report',
      description: '读取某次巡检的完整报告（Markdown）。runId 来自 netops_inspect 的结果。',
      parameters: {
        type: 'object',
        properties: {
          runId: { type: 'string', description: '巡检运行 id，例如 20261118-153012-inspect。' },
        },
        required: ['runId'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            runId: { type: 'string' },
            path: { type: 'string' },
            text: { type: 'string' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: value.text }],
      },
      async execute(args = {}) {
        const runId = String(args.runId ?? '').trim()
        if (!/^[A-Za-z0-9._-]+$/.test(runId)) throw new Error(`runId 不合法：${runId}`)

        const reportPath = path.join(deps.options.runsDir, runId, 'report.md')
        if (!fs.existsSync(reportPath)) throw new Error(`找不到报告：${reportPath}`)

        const full = fs.readFileSync(reportPath, 'utf8')
        const limit = 12000
        const text = full.length > limit ? `${full.slice(0, limit)}\n\n…（报告较长，已截断；完整文件：${reportPath}）` : full
        return { runId, path: reportPath, text }
      },
    }),
  )

  return disposers
}
