import type {
  DownloadRequest,
  MusicSource,
  OpenTrackStreamRequest,
  ParsePlaylistRequest,
  SearchRequest,
  SourceContext,
} from '../src/internal.js'
import type {
  TrackDetail,
  TrackSummary,
} from '../src/types.js'

import { describe, expect, it } from 'vitest'
import { MusicService } from '../src/service.js'

function createTrack(source: string, identifier: string): TrackSummary {
  return {
    source,
    identifier,
    songName: identifier,
  }
}

function createDetailTrack(source: string, identifier: string): TrackDetail {
  return {
    ...createTrack(source, identifier),
    downloadUrl: `https://example.com/${identifier}.mp3`,
  }
}

function createSource(name: string, playlistTracks: TrackSummary[] = []): MusicSource {
  return {
    name,
    async search(input: SearchRequest) {
      return [createTrack(name, input.keyword)]
    },
    async fetchDetail(input) {
      return {
        ...input.track,
        songName: input.track.songName ?? input.track.identifier,
        downloadUrl: `https://example.com/${input.track.identifier}.mp3`,
      }
    },
    async download(input: DownloadRequest) {
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
    async openTrackStream(input: OpenTrackStreamRequest) {
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
    async parsePlaylist(_input: ParsePlaylistRequest, _context: SourceContext) {
      return playlistTracks
    },
  }
}

describe('musicservice', () => {
  it('searches across sources', async () => {
    const service = new MusicService([createSource('A'), createSource('B')])
    const result = await service.search('demo')

    expect(Object.keys(result)).toEqual(['A', 'B'])
    expect(result.A[0]?.identifier).toBe('demo')
    expect(result.B[0]?.identifier).toBe('demo')
  })

  it('searches a selected source subset', async () => {
    const service = new MusicService([createSource('A')])
    const result = await service.search('demo', { sources: ['A'] })

    expect(Object.keys(result)).toEqual(['A'])
    expect(result.A[0]?.identifier).toBe('demo')
  })

  it('groups downloads by source', async () => {
    const service = new MusicService([createSource('A'), createSource('B')])
    const result = await service.download([createDetailTrack('A', '1'), createDetailTrack('A', '2'), createDetailTrack('B', '3')])

    expect(result).toHaveLength(2)
    expect(result.find(item => item.source === 'A')?.completed).toBe(2)
    expect(result.find(item => item.source === 'B')?.completed).toBe(1)
  })

  it('passes download options through the concise signature', async () => {
    const service = new MusicService([createSource('A')])
    const result = await service.download([createDetailTrack('A', '1')], { outputDir: '/tmp/out' })

    expect(result).toHaveLength(1)
    expect(result[0]?.completed).toBe(1)
  })

  it('fetches detail by source', async () => {
    const service = new MusicService([createSource('A')])
    const result = await service.fetchDetail({
      source: 'A',
      identifier: '1',
      songName: 'demo',
    })

    expect(result.downloadUrl).toBe('https://example.com/1.mp3')
  })

  it('passes detail options through the concise signature', async () => {
    const service = new MusicService([createSource('A')])
    const result = await service.fetchDetail({
      source: 'A',
      identifier: '1',
      songName: 'demo',
    }, {
      requestOptions: {
        A: {
          timeoutMs: 1000,
        },
      },
    })

    expect(result.downloadUrl).toBe('https://example.com/1.mp3')
  })

  it('tries playlist parsing sequentially', async () => {
    const service = new MusicService([createSource('A'), createSource('B', [createTrack('B', 'x')])])
    const result = await service.parsePlaylist('https://example.com')

    expect(result).toHaveLength(1)
    expect(result[0]?.source).toBe('B')
  })

  it('passes playlist options through the concise signature', async () => {
    const service = new MusicService([createSource('A', [createTrack('A', 'x')])])
    const result = await service.parsePlaylist('https://example.com', { sources: ['A'] })

    expect(result).toHaveLength(1)
    expect(result[0]?.source).toBe('A')
  })

  it('opens a track stream by source', async () => {
    const service = new MusicService([createSource('A')])
    const result = await service.openTrackStream(createDetailTrack('A', 'demo'))

    expect(result.source).toBe('A')
    expect(result.identifier).toBe('demo')
    expect(result.contentType).toBe('audio/mpeg')
  })

  it('passes stream options through the concise signature', async () => {
    const service = new MusicService([createSource('A')])
    const result = await service.openTrackStream(createDetailTrack('A', 'demo'), {
      requestOptions: {
        A: {
          timeoutMs: 1000,
        },
      },
    })

    expect(result.source).toBe('A')
    expect(result.identifier).toBe('demo')
  })
})
