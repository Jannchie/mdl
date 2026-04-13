#!/usr/bin/env node
import { createClient } from '@jannchie/mdl-sdk/dev'

import packageJson from '../package.json' with { type: 'json' }
import { createCli } from './app.js'

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  createCli(createClient(), packageJson.version).parse()
}
