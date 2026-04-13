#!/usr/bin/env node
import { createClient } from '@jannchie/mdl-sdk'
import packageJson from '../package.json' with { type: 'json' }
import { createServer as createAppServer } from './app.js'
import { startApiServer } from './runtime.js'

export const apiVersion = packageJson.version

export function createServer() {
  return createAppServer(createClient(), apiVersion)
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  startApiServer(createServer(), process.argv.slice(2), process.env)
}
