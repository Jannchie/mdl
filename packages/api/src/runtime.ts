import { parseArgs } from 'node:util'
import { serve } from '@hono/node-server'

export interface ApiRuntimeOptions {
  host: string
  port: number
}

export interface ApiServerApp {
  fetch: Parameters<typeof serve>[0]['fetch']
}

function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return 3653
  }

  if (value.trim() === '') {
    throw new TypeError('port must be an integer between 0 and 65535')
  }

  const port = Number(value)
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new TypeError('port must be an integer between 0 and 65535')
  }

  return port
}

export function resolveRuntimeOptions(args = process.argv.slice(2), env = process.env): ApiRuntimeOptions {
  const { values } = parseArgs({
    args,
    options: {
      port: {
        type: 'string',
      },
    },
    allowPositionals: true,
  })

  return {
    host: env.HOST ?? '127.0.0.1',
    port: parsePort(values.port ?? env.PORT),
  }
}

export function startApiServer(
  app: ApiServerApp,
  args = process.argv.slice(2),
  env = process.env,
) {
  const { host, port } = resolveRuntimeOptions(args, env)
  return serve({
    fetch: app.fetch,
    port,
    hostname: host,
  }, (info) => {
    // eslint-disable-next-line no-console
    console.log(`API server listening on http://${host}:${info.port}`)
  })
}
