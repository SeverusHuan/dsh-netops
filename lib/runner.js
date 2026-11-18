import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * 跑一次执行器：写 job 文件 → 起 Python → 读 result 文件。
 * job 文件里有临时凭据，跑完立刻删除，不进报告、不进日志。
 */
export async function executeJob(ctx, options, { runDir, tag, devices, commands, jobOptions }) {
  const jobPath = path.join(runDir, `job-${tag}.json`)
  const resultPath = path.join(runDir, `result-${tag}.json`)

  const payload = {
    devices,
    commands,
    options: {
      connTimeoutSec: jobOptions.connTimeoutSec ?? options.connTimeoutSec,
      readTimeoutSec: jobOptions.readTimeoutSec ?? options.readTimeoutSec,
      deviceTimeoutSec: jobOptions.deviceTimeoutSec ?? options.deviceTimeoutSec,
    },
  }

  await fs.promises.writeFile(jobPath, JSON.stringify(payload, null, 2), 'utf8')

  let run
  try {
    run = await runCommand(ctx, options, [options.runnerScript, jobPath, resultPath])
  } finally {
    await fs.promises.rm(jobPath, { force: true }).catch(() => {})
  }

  if (!fs.existsSync(resultPath)) {
    const detail = [run.stderr, run.stdout].filter(Boolean).join('\n').trim()
    throw new Error(
      `执行器没有产出结果（exit=${run.code}）。${detail ? `\n${detail.slice(0, 1200)}` : '检查 python 路径与 netmiko 是否可用。'}`,
    )
  }

  const text = await fs.promises.readFile(resultPath, 'utf8')
  let result
  try {
    result = JSON.parse(text)
  } catch (error) {
    throw new Error(`执行器结果不是合法 JSON：${error.message}`)
  }
  if (run.code !== 0) result.partial = true
  return result
}

/**
 * 跑一个以配置里的 python 开头的命令，收集 stdout/stderr。
 * 优先用 Host 的 subprocess 服务（受沙箱/策略管辖），没有就退回 child_process。
 */
export async function runCommand(ctx, options, args) {
  const argv = [options.python, ...args]
  const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONWARNINGS: 'ignore' }
  const subprocess = typeof ctx?.get === 'function' ? ctx.get('subprocess') : undefined

  if (subprocess && typeof subprocess.spawn === 'function') {
    const handle = subprocess.spawn({
      argv,
      cwd: options.pluginDir,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 2 * 1024 * 1024 },
        stderr: { maxBytes: 512 * 1024 },
      },
      graceMs: 3000,
      env,
    })

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      try { handle.terminate() } catch {}
    }, options.runTimeoutMs)

    try {
      const outcome = await handle.done
      if (timedOut) throw new Error(`执行器超过 ${Math.round(options.runTimeoutMs / 1000)}s 仍未结束，已终止`)
      return {
        code: outcome.exitCode ?? -1,
        stdout: readCollected(handle.collected?.stdout),
        stderr: readCollected(handle.collected?.stderr),
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('已终止')) throw error
      throw new Error(`执行器启动失败：${error.message}。检查配置里的 python 路径：${options.python}`)
    } finally {
      clearTimeout(timer)
    }
  }

  // 没有 subprocess 服务时退回 Node 自己的子进程
  try {
    const { stdout, stderr } = await execFileAsync(options.python, args, {
      cwd: options.pluginDir,
      env,
      timeout: options.runTimeoutMs,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    })
    return { code: 0, stdout, stderr }
  } catch (error) {
    return {
      code: typeof error.code === 'number' ? error.code : -1,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? error.message ?? '',
    }
  }
}

function readCollected(reader) {
  if (!reader || typeof reader.readFrom !== 'function') return ''
  try {
    return reader.readFrom(0).text ?? ''
  } catch {
    return ''
  }
}
