import type { TrackDetail, TrackLookup, TrackSummary } from '@jannchie/mdl-core'
import type { SearchRequest, SourceContext } from '@jannchie/mdl-core/internal'

import type { JbsouSearchItem } from '../shared/jbsou.js'

import { buildSearchTrackFromJbsouItem, refreshJbsouSearchItem, resolveTrackFromJbsouItem, searchJbsouSite } from '../shared/jbsou.js'
import { BaseMusicSource } from './base.js'

export class KugouMusicSource extends BaseMusicSource {
  readonly name = 'KugouMusicClient'
  protected readonly searchHeaders = {
    'accept': 'application/json, text/javascript, */*; q=0.01',
    'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'origin': 'https://www.jbsou.cn',
    'referer': 'https://www.jbsou.cn/',
    'x-requested-with': 'XMLHttpRequest',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
  }

  protected readonly parseHeaders = {
    'origin': 'https://www.jbsou.cn',
    'referer': 'https://www.jbsou.cn/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
  }

  protected readonly downloadHeaders = {
    'referer': 'https://www.kugou.com/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
  }

  override async search(input: SearchRequest, context: SourceContext): Promise<TrackSummary[]> {
    const signal = context.requestOptions?.signal as AbortSignal | undefined
    if (signal?.aborted) {
      return []
    }
    const items = await searchJbsouSite('kugou', input.keyword, {
      ...this.searchHeaders,
      ...(context.requestOptions?.headers as Record<string, string> | undefined),
    }, {
      signal: context.requestOptions?.signal as AbortSignal | undefined,
    })
    const limit = input.limit
    const results: TrackSummary[] = []
    for (const item of limit === undefined ? items : items.slice(0, limit)) {
      if (signal?.aborted) {
        return results
      }
      const track = buildSearchTrackFromJbsouItem({
        sourceName: this.name,
        rootSource: 'kugou',
        item,
      })
      if (track) {
        results.push(track)
      }
    }
    return results
  }

  protected async resolveTrackDetail(track: TrackLookup, context: SourceContext): Promise<TrackDetail> {
    if (this.isDetailedTrack(track)) {
      return track
    }

    const item = track.rawData?.search as JbsouSearchItem | undefined
    if (item) {
      const detailed = await resolveTrackFromJbsouItem({
        sourceName: this.name,
        rootSource: 'kugou',
        item,
        context,
        parseClient: this.parseClient,
        audioLinkTester: this.audioLinkTester,
      })
      if (detailed) {
        return detailed
      }
    }

    const refreshedItem = await refreshJbsouSearchItem({
      site: 'kugou',
      identifier: track.identifier,
      track,
      headers: {
        ...this.searchHeaders,
        ...(context.requestOptions?.headers as Record<string, string> | undefined),
      },
      signal: context.requestOptions?.signal as AbortSignal | undefined,
    })
    const detailed = refreshedItem
      ? await resolveTrackFromJbsouItem({
          sourceName: this.name,
          rootSource: 'kugou',
          item: refreshedItem,
          context,
          parseClient: this.parseClient,
          audioLinkTester: this.audioLinkTester,
        })
      : null
    if (!detailed) {
      throw new Error(`Failed to fetch detail for ${track.identifier} from ${this.name}`)
    }
    return detailed
  }
}
