import type { SearchOptions, SourceContext, Track } from '@jannchie/mdl-core'

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

  protected buildSearchRequests(_input: SearchOptions, _context: SourceContext) {
    return [{ url: 'https://example.com/search' }]
  }

  protected extractSearchItems(payload: unknown): unknown[] {
    return (payload as { items?: unknown[] }).items ?? []
  }

  protected async parseSearchItem(item: unknown): Promise<Track | null> {
    const identifier = String((item as { id?: string }).id ?? '')
    return identifier
      ? {
          source: this.name,
          identifier,
          songName: identifier,
          downloadUrl: `https://example.com/${identifier}.mp3`,
        }
      : null
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

    const result = await source.search({ keyword: 'demo', searchSizePerSource: 2 }, {})

    expect(result.map(item => item.identifier)).toEqual(['1', '2'])
  })
})
