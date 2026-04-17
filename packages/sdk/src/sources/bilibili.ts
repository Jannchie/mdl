import type { TrackDetail } from '@jannchie/mdl-core'

import type { YtDlpMetadata } from '../shared/ytdlp.js'

import { pickBestThumbnail } from '../shared/ytdlp.js'
import { YtDlpMusicSource } from './ytdlp-base.js'

export class BilibiliMusicSource extends YtDlpMusicSource {
  readonly name = 'Bilibili'

  protected buildUrl(identifier: string): string {
    return identifier.startsWith('http') ? identifier : `https://www.bilibili.com/video/${identifier}`
  }

  protected mapMetadata(raw: YtDlpMetadata, fallbackId: string): Partial<TrackDetail> & Pick<TrackDetail, 'identifier' | 'songName' | 'singers'> {
    const entry = raw.entries?.[0]
    const info = entry ?? raw
    return {
      identifier: info.id ?? fallbackId,
      songName: info.title ?? 'Unknown',
      singers: raw.uploader ?? entry?.uploader ?? 'Unknown',
      album: entry?.description ?? raw.description,
      coverUrl: pickBestThumbnail(info),
      durationS: info.duration,
    }
  }
}
