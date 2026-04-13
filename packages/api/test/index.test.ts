import { describe, expect, it } from 'vitest'

import packageJson from '../package.json' with { type: 'json' }
import { apiVersion, createServer as createAppServer } from '../src/app.js'
import { createServer } from '../src/index.js'
import { resolveRuntimeOptions } from '../src/runtime.js'

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

  it('serves the index endpoint with version and documentation links', async () => {
    const response = await createServer().request('http://127.0.0.1:3653/')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      name: 'MDL API',
      version: packageJson.version,
      docs: {
        openapi: 'http://127.0.0.1:3653/openapi.json',
        scalar: 'http://127.0.0.1:3653/scalar',
      },
    })
  })

  it('serves the fetch-detail endpoint with the simplified request shape', async () => {
    const app = createAppServer({
      listSources: () => ['A'],
      search: async () => ({ A: [] }),
      fetchDetail: async track => ({
        ...track,
        songName: track.songName ?? 'demo',
        downloadUrl: 'https://example.com/demo.mp3',
      }),
      parsePlaylist: async () => [],
      download: async () => [],
      openTrackStream: async () => {
        throw new Error('not implemented')
      },
    } as never)

    const response = await app.request('/fetch-detail', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        source: 'A',
        identifier: '1',
        songName: 'demo',
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

  it('passes search parameters through to the service', async () => {
    const app = createAppServer({
      listSources: () => ['A'],
      search: async (keyword, options) => ({
        A: [{
          source: 'A',
          identifier: `${keyword}:${options?.limit ?? 0}`,
          songName: 'demo',
        }],
      }),
      fetchDetail: async track => ({
        ...track,
        songName: track.songName ?? 'demo',
        downloadUrl: 'https://example.com/demo.mp3',
      }),
      parsePlaylist: async () => [],
      download: async () => [],
      openTrackStream: async () => {
        throw new Error('not implemented')
      },
    } as never)

    const response = await app.request('/search', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        keyword: 'demo',
        sources: ['A'],
        limit: 2,
        pageSize: 10,
        requestOptions: {
          A: {
            timeoutMs: 5000,
          },
        },
      }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      results: {
        A: [{
          source: 'A',
          identifier: 'demo:2',
          songName: 'demo',
        }],
      },
    })
  })

  it('rejects the removed legacy nested track shape for fetch-detail', async () => {
    const app = createAppServer({
      listSources: () => ['A'],
      search: async () => ({ A: [] }),
      fetchDetail: async track => ({
        ...track,
        songName: track.songName ?? 'demo',
        downloadUrl: 'https://example.com/demo.mp3',
      }),
      parsePlaylist: async () => [],
      download: async () => [],
      openTrackStream: async () => {
        throw new Error('not implemented')
      },
    } as never)

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

    expect(response.status).toBe(400)
  })

  it('passes parse-playlist parameters through to the service', async () => {
    const app = createAppServer({
      listSources: () => ['A'],
      search: async () => ({ A: [] }),
      fetchDetail: async track => ({
        ...track,
        songName: track.songName ?? 'demo',
        downloadUrl: 'https://example.com/demo.mp3',
      }),
      parsePlaylist: async (playlistUrl, options) => [{
        source: options?.sources?.[0] ?? 'A',
        identifier: playlistUrl,
        songName: 'playlist-track',
      }],
      download: async () => [],
      openTrackStream: async () => {
        throw new Error('not implemented')
      },
    } as never)

    const response = await app.request('/parse-playlist', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        playlistUrl: 'https://music.163.com/#/playlist?id=123456',
        sources: ['A'],
      }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      results: [{
        source: 'A',
        identifier: 'https://music.163.com/#/playlist?id=123456',
        songName: 'playlist-track',
      }],
    })
  })

  it('passes download parameters through to the service', async () => {
    const app = createAppServer({
      listSources: () => ['A'],
      search: async () => ({ A: [] }),
      fetchDetail: async track => ({
        ...track,
        songName: track.songName ?? 'demo',
        downloadUrl: 'https://example.com/demo.mp3',
      }),
      parsePlaylist: async () => [],
      download: async (tracks, options) => [{
        source: tracks[0]?.source ?? 'A',
        requested: tracks.length,
        completed: tracks.length,
        items: [{
          source: tracks[0]?.source ?? 'A',
          identifier: options?.outputDir ?? 'missing',
          savePath: '/tmp/demo.mp3',
        }],
      }],
      openTrackStream: async () => {
        throw new Error('not implemented')
      },
    } as never)

    const response = await app.request('/download', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        tracks: [{
          source: 'A',
          identifier: '1',
          songName: 'demo',
          downloadUrl: 'https://example.com/demo.mp3',
        }],
        outputDir: '/tmp/downloads',
      }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      results: [{
        source: 'A',
        requested: 1,
        completed: 1,
        items: [{
          source: 'A',
          identifier: '/tmp/downloads',
          savePath: '/tmp/demo.mp3',
        }],
      }],
    })
  })

  it('includes the main route paths in the generated openapi document', async () => {
    const response = await createServer().request('/openapi.json')
    expect(response.status).toBe(200)

    const payload = await response.json() as { paths?: Record<string, unknown> }
    expect(payload.paths).toMatchObject({
      '/': expect.any(Object),
      '/health': expect.any(Object),
      '/sources': expect.any(Object),
      '/search': expect.any(Object),
      '/fetch-detail': expect.any(Object),
      '/parse-playlist': expect.any(Object),
      '/download': expect.any(Object),
    })
  })

  it('uses port 3653 by default', () => {
    expect(resolveRuntimeOptions([], {})).toEqual({
      host: '127.0.0.1',
      port: 3653,
    })
  })

  it('uses the port from the environment when provided', () => {
    expect(resolveRuntimeOptions([], {
      HOST: '0.0.0.0',
      PORT: '8787',
    })).toEqual({
      host: '0.0.0.0',
      port: 8787,
    })
  })

  it('prefers the command line port over the environment', () => {
    expect(resolveRuntimeOptions(['--port', '4567'], {
      PORT: '8787',
    })).toEqual({
      host: '127.0.0.1',
      port: 4567,
    })
  })

  it('rejects invalid ports', () => {
    expect(() => resolveRuntimeOptions(['--port', 'abc'], {})).toThrow('port must be an integer between 0 and 65535')
  })
})
