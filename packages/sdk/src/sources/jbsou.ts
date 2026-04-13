import type { SearchOptions, SourceContext, Track } from '@jannchie/mdl-core'

import type { JbsouSearchItem } from '../shared/jbsou.js'

import { buildSearchTrackFromJbsouItem, resolveTrackFromJbsouItem, searchJbsouSite } from '../shared/jbsou.js'
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

  protected buildSearchRequests(): Array<{ url: string }> {
    return []
  }

  protected extractSearchItems(): unknown[] {
    return []
  }

  protected async buildSearchTrack(_item: unknown, _context: SourceContext): Promise<Track | null> {
    return null
  }

  override async search(input: SearchOptions, context: SourceContext): Promise<Track[]> {
    const limit = input.searchSizePerSource
    const sites = this.resolveSites(context)
    const results: Track[] = []
    const signal = context.requestOverrides?.signal as AbortSignal | undefined

    for (const site of sites) {
      if (signal?.aborted) {
        return results
      }
      const items = await searchJbsouSite(site, input.keyword, {
        ...this.searchHeaders,
        ...(context.requestOverrides?.headers as Record<string, string> | undefined),
      }, {
        signal: context.requestOverrides?.signal as AbortSignal | undefined,
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

  protected async resolveTrackDetail(track: Track, context: SourceContext): Promise<Track> {
    if (track.downloadUrl) {
      return track
    }

    const item = track.rawData?.search as JbsouSearchItem | undefined
    const rootSource = track.rootSource
    if (!item || !rootSource) {
      throw new Error(`Track ${track.identifier} from ${this.name} is missing JBSou search metadata`)
    }

    const detailed = await resolveTrackFromJbsouItem({
      sourceName: this.name,
      rootSource,
      item,
      context,
      parseClient: this.parseClient,
      audioLinkTester: this.audioLinkTester,
    })
    if (!detailed) {
      throw new Error(`Failed to fetch detail for ${track.identifier} from ${this.name}`)
    }
    return detailed
  }

  private resolveSites(context: SourceContext): string[] {
    const configured = Array.isArray(context.initConfig?.allowedSites) ? context.initConfig.allowedSites : undefined
    const sites = configured?.filter((site): site is string => typeof site === 'string' && DEFAULT_SITES.includes(site)) ?? DEFAULT_SITES
    return sites.length > 0 ? sites : DEFAULT_SITES
  }
}
