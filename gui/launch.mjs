#!/usr/bin/env node
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGuiServer } from './server.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const option = (name) => {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 ? argv[index + 1] : undefined
}

const desiredPort = Number(option('port') ?? process.env.NETOPS_GUI_PORT ?? 7681)
const rootDir = option('root') ?? process.env.NETOPS_HOME ?? readGuiConfig().rootDir
const { server } = createGuiServer({ rootDir })

try {
  await listen(server, desiredPort)
} catch (error) {
  if (error.code === 'EADDRINUSE') {
    // 已经有一个面板在跑，直接开窗口
    openApp(`http://127.0.0.1:${desiredPort}/`)
    process.exit(0)
  }
  throw error
}

const url = `http://127.0.0.1:${server.address().port}/`
console.log(`dsh-netops 巡检面板：${url}`)
console.log('关闭窗口后可在面板里点「退出」，或按 Ctrl+C')
if (!flag('no-open')) openApp(url)

function listen(target, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error)
    target.once('error', onError)
    target.listen(port, '127.0.0.1', () => {
      target.off('error', onError)
      resolve()
    })
  })
}

/** 本机配置：dist/gui/gui.config.json，只写数据目录，不进仓库。 */
function readGuiConfig() {
  const file = path.join(HERE, 'gui.config.json')
  try {
    if (!fs.existsSync(file)) return {}
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function openApp(target) {
  try {
    if (process.platform === 'win32') {
      const edge = [
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      ].find((file) => fs.existsSync(file))
      if (edge) {
        spawn(edge, [`--app=${target}`, '--window-size=1200,900', '--no-first-run'], {
          detached: true,
          stdio: 'ignore',
        }).unref()
        return
      }
      spawn('cmd', ['/c', 'start', '', target], { detached: true, stdio: 'ignore' }).unref()
      return
    }
    const opener = process.platform === 'darwin' ? 'open' : 'xdg-open'
    spawn(opener, [target], { detached: true, stdio: 'ignore' }).unref()
  } catch {
    // 打不开窗口也不影响服务本身
  }
}
