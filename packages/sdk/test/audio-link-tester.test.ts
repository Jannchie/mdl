import { afterEach, describe, expect, it, vi } from 'vitest'

import { AudioLinkTester } from '../src/shared/audio-link-tester.js'

function stubResponse(contentType: string, bytes: number[]) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(bytes), {
    status: 206,
    headers: { 'content-type': contentType, 'content-length': '4096', 'content-range': 'bytes 0-15/4096' },
  })))
}

describe('audiolinktester', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('trusts the url extension over a mislabelled content type', async () => {
    stubResponse('application/x-www-form-urlencoded', [0x66, 0x4C, 0x61, 0x43])

    const probe = await new AudioLinkTester().probe('https://cdn.example.com/F000.flac?vkey=1')

    expect(probe.ext).toBe('flac')
  })

  it('accepts iso bmff audio whose ftyp box is not 0x18 bytes long', async () => {
    stubResponse('application/x-www-form-urlencoded', [0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70])

    const result = await new AudioLinkTester().test('https://cdn.example.com/C600')

    expect(result.ok).toBe(true)
    expect(result.fmt).toBe('mp4/m4a')
    expect(result.ext).toBe('m4a')
    expect(result.clen).toBe(4096)
  })
})
