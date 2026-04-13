import type { TrackDetail, TrackLookup, TrackSummary } from '@jannchie/mdl-core'
import type { SearchRequest, SourceContext } from '@jannchie/mdl-core/internal'

import type { JbsouSearchItem } from '../shared/jbsou.js'

import { buildSearchTrackFromJbsouItem, refreshJbsouSearchItem, resolveTrackFromJbsouItem, searchJbsouSite } from '../shared/jbsou.js'
import { BaseMusicSource } from './base.js'

const DEFAULT_SITES = ['qq', 'netease', 'kugou', 'kuwo']

export class JBSouMusicSource extends BaseMusicSource {
  readonly name = 'JBSouMusicClient'
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
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
  }

  override async search(input: SearchRequest, context: SourceContext): Promise<TrackSummary[]> {
    const limit = input.limit
    const sites = this.resolveSites(context)
    const results: TrackSummary[] = []
    const signal = context.requestOptions?.signal as AbortSignal | undefined

    for (const site of sites) {
      if (signal?.aborted) {
        return results
      }
      const items = await searchJbsouSite(site, input.keyword, {
        ...this.searchHeaders,
        ...(context.requestOptions?.headers as Record<string, string> | undefined),
      }, {
        signal: context.requestOptions?.signal as AbortSignal | undefined,
      })
      for (const item of items) {
        if (signal?.aborted) {
          return results
        }
        const track = buildSearchTrackFromJbsouItem({
          sourceName: this.name,
          rootSource: site,
          item,
        })
        if (!track) {
          continue
        }
        results.push(track)
        if (limit !== undefined && results.length >= limit) {
          return results
        }
      }
    }

    return results
  }

  protected async resolveTrackDetail(track: TrackLookup, context: SourceContext): Promise<TrackDetail> {
    if (this.isDetailedTrack(track)) {
      return track
    }

    const rootSource = track.rootSource
    if (!rootSource) {
      throw new Error(`Track ${track.identifier} from ${this.name} is missing JBSou search metadata`)
    }

    const item = track.rawData?.search as JbsouSearchItem | undefined
    if (item) {
      const detailed = await resolveTrackFromJbsouItem({
        sourceName: this.name,
        rootSource,
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
      site: rootSource,
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
          rootSource,
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

  private resolveSites(context: SourceContext): string[] {
    const configured = Array.isArray(context.sourceOptions?.allowedSites) ? context.sourceOptions.allowedSites : undefined
    const sites = configured?.filter((site): site is string => typeof site === 'string' && DEFAULT_SITES.includes(site)) ?? DEFAULT_SITES
    return sites.length > 0 ? sites : DEFAULT_SITES
  }
}
