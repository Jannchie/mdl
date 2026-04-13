import type { TrackDetail, TrackLookup, TrackSummary } from '@jannchie/mdl-core'
import type { SearchRequest, SourceContext } from '@jannchie/mdl-core/internal'

import { describe, expect, it } from 'vitest'
import { BaseMusicSource } from '../src/sources/base.js'

class TestMusicSource extends BaseMusicSource {
  readonly name = 'TestMusicSource'
  protected readonly searchHeaders = {}
  protected readonly parseHeaders = {}
  protected readonly downloadHeaders = {}

  protected override get searchClient() {
    return {
      json: async () => ({
        items: [{ id: '1' }, { id: '2' }, { id: '3' }],
      }),
    } as never
  }

  protected buildSearchRequests(_input: SearchRequest, _context: SourceContext) {
    return [{ url: 'https://example.com/search' }]
  }

  protected extractSearchItems(payload: unknown): unknown[] {
    return (payload as { items?: unknown[] }).items ?? []
  }

  protected async buildSearchTrack(item: unknown): Promise<TrackSummary | null> {
    const identifier = String((item as { id?: string }).id ?? '')
    return identifier
      ? {
          source: this.name,
          identifier,
          songName: identifier,
        }
      : null
  }

  protected async resolveTrackDetail(track: TrackLookup): Promise<TrackDetail> {
    return {
      ...track,
      songName: track.songName ?? track.identifier,
      downloadUrl: `https://example.com/${track.identifier}.mp3`,
    }
  }
}

describe('basemusicsource search defaults', () => {
  it('returns all fetched items when no explicit per-source limit is provided', async () => {
    const source = new TestMusicSource()

    const result = await source.search({ keyword: 'demo' }, {})

    expect(result.map(item => item.identifier)).toEqual(['1', '2', '3'])
  })

  it('still respects an explicit per-source limit', async () => {
    const source = new TestMusicSource()

    const result = await source.search({ keyword: 'demo', limit: 2 }, {})

    expect(result.map(item => item.identifier)).toEqual(['1', '2'])
  })
})
