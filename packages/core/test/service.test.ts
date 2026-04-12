import type {
  DownloadOptions,
  MusicSource,
  OpenTrackStreamOptions,
  ParsePlaylistOptions,
  SearchOptions,
  SourceContext,
  Track,
} from '../src/types.js'

import { describe, expect, it } from 'vitest'
import { MusicService } from '../src/service.js'

function createTrack(source: string, identifier: string): Track {
  return {
    source,
    identifier,
    songName: identifier,
  }
}

function createSource(name: string, playlistTracks: Track[] = []): MusicSource {
  return {
    name,
    async search(input: SearchOptions) {
      return [createTrack(name, input.keyword)]
    },
    async download(input: DownloadOptions) {
      return {
        source: name,
        requested: input.tracks.length,
        completed: input.tracks.length,
        items: input.tracks.map(track => ({
          source: name,
          identifier: track.identifier,
          savePath: `/tmp/${track.identifier}`,
        })),
      }
    },
    async openTrackStream(input: OpenTrackStreamOptions) {
      return {
        source: name,
        identifier: input.track.identifier,
        downloadUrl: 'https://example.com/audio.mp3',
        finalUrl: 'https://example.com/audio.mp3',
        contentType: 'audio/mpeg',
        contentLength: 123,
        ext: 'mp3',
        headers: {},
        body: new ReadableStream<Uint8Array>(),
      }
    },
    async parsePlaylist(_input: ParsePlaylistOptions, _context: SourceContext) {
      return playlistTracks
    },
  }
}

function createSearchSource(name: string, tracks: Track[]): MusicSource {
  return {
    name,
    async search() {
      return tracks
    },
    async download(input: DownloadOptions) {
      return {
        source: name,
        requested: input.tracks.length,
        completed: input.tracks.length,
        items: input.tracks.map(track => ({
          source: name,
          identifier: track.identifier,
          savePath: `/tmp/${track.identifier}`,
        })),
      }
    },
    async openTrackStream(input: OpenTrackStreamOptions) {
      return {
        source: name,
        identifier: input.track.identifier,
        downloadUrl: 'https://example.com/audio.mp3',
        finalUrl: 'https://example.com/audio.mp3',
        contentType: 'audio/mpeg',
        contentLength: 123,
        ext: 'mp3',
        headers: {},
        body: new ReadableStream<Uint8Array>(),
      }
    },
  }
}

describe('musicservice', () => {
  it('searches across sources', async () => {
    const service = new MusicService([createSource('A'), createSource('B')])
    const result = await service.search({ keyword: 'demo' })

    expect(Object.keys(result)).toEqual(['A', 'B'])
    expect(result.A[0]?.identifier).toBe('demo')
    expect(result.B[0]?.identifier).toBe('demo')
  })

  it('groups downloads by source', async () => {
    const service = new MusicService([createSource('A'), createSource('B')])
    const result = await service.download({
      tracks: [createTrack('A', '1'), createTrack('A', '2'), createTrack('B', '3')],
    })

    expect(result).toHaveLength(2)
    expect(result.find(item => item.source === 'A')?.completed).toBe(2)
    expect(result.find(item => item.source === 'B')?.completed).toBe(1)
  })

  it('tries playlist parsing sequentially', async () => {
    const service = new MusicService([createSource('A'), createSource('B', [createTrack('B', 'x')])])
    const result = await service.parsePlaylist({ playlistUrl: 'https://example.com' })

    expect(result).toHaveLength(1)
    expect(result[0]?.source).toBe('B')
  })

  it('fuses multi-source search results with rrf', async () => {
    const service = new MusicService([
      createSearchSource('A', [
        { source: 'A', identifier: 'a1', songName: '稻香', singers: '周杰伦', fileSizeBytes: 100 },
        { source: 'A', identifier: 'a2', songName: '夜曲', singers: '周杰伦' },
      ]),
      createSearchSource('B', [
        { source: 'B', identifier: 'b1', songName: '稻香', singers: '周杰伦', fileSizeBytes: 200 },
        { source: 'B', identifier: 'b2', songName: '晴天', singers: '周杰伦' },
      ]),
    ])

    const result = await service.searchMerged({ keyword: '周杰伦' })

    expect(result[0]?.songName).toBe('稻香')
    expect(result[0]?.matchedSources).toEqual(['A', 'B'])
    expect(result[0]?.source).toBe('B')
    expect(result[0]?.alternatives).toHaveLength(2)
    expect(result).toHaveLength(3)
  })

  it('returns merged results without waiting for slow sources after timeout', async () => {
    const service = new MusicService([
      {
        name: 'Fast',
        async search() {
          return [{ source: 'Fast', identifier: 'fast-1', songName: '稻香', singers: '周杰伦' }]
        },
        async download(input: DownloadOptions) {
          return {
            source: 'Fast',
            requested: input.tracks.length,
            completed: input.tracks.length,
            items: [],
          }
        },
        async openTrackStream(input: OpenTrackStreamOptions) {
          return {
            source: 'Fast',
            identifier: input.track.identifier,
            downloadUrl: 'https://example.com/fast.mp3',
            finalUrl: 'https://example.com/fast.mp3',
            contentType: 'audio/mpeg',
            contentLength: 123,
            ext: 'mp3',
            headers: {},
            body: new ReadableStream<Uint8Array>(),
          }
        },
      },
      {
        name: 'Slow',
        async search(_input: SearchOptions, context: SourceContext) {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, 80)
            const signal = context.requestOverrides?.signal as AbortSignal | undefined
            signal?.addEventListener(
              'abort',
              () => {
                clearTimeout(timer)
                reject(new Error('aborted'))
              },
              { once: true },
            )
          })
          return [{ source: 'Slow', identifier: 'slow-1', songName: '夜曲', singers: '周杰伦' }]
        },
        async download(input: DownloadOptions) {
          return {
            source: 'Slow',
            requested: input.tracks.length,
            completed: input.tracks.length,
            items: [],
          }
        },
        async openTrackStream(input: OpenTrackStreamOptions) {
          return {
            source: 'Slow',
            identifier: input.track.identifier,
            downloadUrl: 'https://example.com/slow.mp3',
            finalUrl: 'https://example.com/slow.mp3',
            contentType: 'audio/mpeg',
            contentLength: 123,
            ext: 'mp3',
            headers: {},
            body: new ReadableStream<Uint8Array>(),
          }
        },
      },
    ])

    const started = Date.now()
    const result = await service.searchMerged({ keyword: '周杰伦', timeoutMs: 20 })
    const elapsed = Date.now() - started

    expect(elapsed).toBeLessThan(70)
    expect(result).toHaveLength(1)
    expect(result[0]?.source).toBe('Fast')
  })

  it('opens a track stream by source', async () => {
    const service = new MusicService([createSource('A')])
    const result = await service.openTrackStream({
      track: {
        source: 'A',
        identifier: 'demo',
        songName: 'demo',
      },
    })

    expect(result.source).toBe('A')
    expect(result.identifier).toBe('demo')
    expect(result.contentType).toBe('audio/mpeg')
  })
})
