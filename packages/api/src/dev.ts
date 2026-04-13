#!/usr/bin/env node
import { createClient } from '@jannchie/mdl-sdk/dev'

import { createServer } from './app.js'
import { startApiServer } from './runtime.js'

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  startApiServer(createServer(createClient()), process.argv.slice(2), process.env)
}
