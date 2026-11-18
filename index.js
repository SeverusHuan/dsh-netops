import { resolveOptions } from './lib/options.js'
import { createStore } from './lib/store.js'
import { registerTools } from './lib/tools.js'

export const name = '@local/dsh-netops'
export const inject = ['tools']

export function apply(ctx, config = {}) {
  const options = resolveOptions(config)
  const store = createStore(options)

  ctx.effect(() => {
    const disposers = registerTools(ctx, { options, store })
    return () => {
      for (const dispose of disposers) {
        try { dispose() } catch {}
      }
    }
  })
}
