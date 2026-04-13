#!/usr/bin/env node
import { createClient } from '@jannchie/mdl-sdk/dev'

import packageJson from '../package.json' with { type: 'json' }
import { createServer } from './app.js'
import { startApiServer } from './runtime.js'

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  startApiServer(createServer(createClient(), packageJson.version), process.argv.slice(2), process.env)
}
