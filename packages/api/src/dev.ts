#!/usr/bin/env node
import { serve } from '@hono/node-server'
import { createClient } from '@jannchie/mdl-sdk/dev'

import packageJson from '../package.json' with { type: 'json' }
import { createServer } from './app.js'

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const app = createServer(createClient(), packageJson.version)
  const port = Number(process.env.PORT ?? '3000')
  const host = process.env.HOST ?? '127.0.0.1'
  serve({
    fetch: app.fetch,
    port,
    hostname: host,
  })
}
