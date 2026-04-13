import { describe, expect, it } from 'vitest'

import packageJson from '../package.json' with { type: 'json' }
import { createServer as createAppServer } from '../src/app.js'
import { apiVersion, createServer } from '../src/index.js'

describe('api server', () => {
  it('uses the package version in the generated openapi document', async () => {
    expect(apiVersion).toBe(packageJson.version)

    const response = await createServer().request('/openapi.json')
    expect(response.status).toBe(200)

    const payload = await response.json() as { info?: { version?: string } }
    expect(payload.info?.version).toBe(packageJson.version)
  })

  it('serves the health endpoint', async () => {
    const response = await createServer().request('/health')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
  })

  it('serves the fetch-detail endpoint', async () => {
    const app = createAppServer({
      listSources: () => ['A'],
      search: async () => ({ A: [] }),
      fetchDetail: async ({ track }) => ({
        ...track,
        downloadUrl: 'https://example.com/demo.mp3',
      }),
      parsePlaylist: async () => [],
      download: async () => [],
      openTrackStream: async () => {
        throw new Error('not implemented')
      },
    } as never, packageJson.version)

    const response = await app.request('/fetch-detail', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        track: {
          source: 'A',
          identifier: '1',
          songName: 'demo',
        },
      }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      result: {
        source: 'A',
        identifier: '1',
        songName: 'demo',
        downloadUrl: 'https://example.com/demo.mp3',
      },
    })
  })
})
