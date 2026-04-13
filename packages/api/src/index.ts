#!/usr/bin/env node
import { createClient } from '@jannchie/mdl-sdk'
import { createServer as createAppServer } from './app.js'
import { startApiServer } from './runtime.js'

export function createServer() {
  return createAppServer(createClient())
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  startApiServer(createServer(), process.argv.slice(2), process.env)
}
