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
    async fetchDetail(input) {
      return {
        ...input.track,
        downloadUrl: `https://example.com/${input.track.identifier}.mp3`,
      }
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

  it('fetches detail by source', async () => {
    const service = new MusicService([createSource('A')])
    const result = await service.fetchDetail({
      track: {
        source: 'A',
        identifier: '1',
        songName: 'demo',
      },
    })

    expect(result.downloadUrl).toBe('https://example.com/1.mp3')
  })

  it('tries playlist parsing sequentially', async () => {
    const service = new MusicService([createSource('A'), createSource('B', [createTrack('B', 'x')])])
    const result = await service.parsePlaylist({ playlistUrl: 'https://example.com' })

    expect(result).toHaveLength(1)
    expect(result[0]?.source).toBe('B')
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
