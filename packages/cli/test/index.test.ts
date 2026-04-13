import { describe, expect, it } from 'vitest'

import packageJson from '../package.json' with { type: 'json' }
import { cliVersion, parseIntegerOption, parseTrack, parseTrackList } from '../src/index.js'

describe('cli helpers', () => {
  it('uses the package version', () => {
    expect(cliVersion).toBe(packageJson.version)
  })

  it('parses integer options within the allowed range', () => {
    expect(parseIntegerOption('60', '--rrf-k', 1)).toBe(60)
    expect(parseIntegerOption('0', '--timeout-ms', 0)).toBe(0)
  })

  it('rejects invalid integer options', () => {
    expect(() => parseIntegerOption('nope', '--rrf-k', 1)).toThrow('--rrf-k must be an integer greater than or equal to 1')
    expect(() => parseIntegerOption('-1', '--timeout-ms', 0)).toThrow('--timeout-ms must be an integer greater than or equal to 0')
  })

  it('validates download input files before passing them to the service', () => {
    expect(parseTrack('{"source":"A","identifier":"1","songName":"demo"}')).toEqual(
      { source: 'A', identifier: '1', songName: 'demo' },
    )
    expect(parseTrackList('[{"source":"A","identifier":"1","songName":"demo"}]')).toEqual([
      { source: 'A', identifier: '1', songName: 'demo' },
    ])
    expect(() => parseTrack('[{"source":"A"}]')).toThrow('Input file must contain a JSON track object')
    expect(() => parseTrackList('{"source":"A"}')).toThrow('Input file must contain a JSON array of tracks')
    expect(() => parseTrackList('[{"source":"A"}]')).toThrow('Invalid track at index 0')
  })
})
