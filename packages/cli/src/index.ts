#!/usr/bin/env node
import { createClient } from '@jannchie/mdl-sdk'
import packageJson from '../package.json' with { type: 'json' }
import { createCli } from './app.js'

export const cliVersion = packageJson.version
export { createCli, parseIntegerOption, parseSources, parseTrack, parseTrackList } from './app.js'

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  createCli(createClient(), cliVersion).parse()
}
