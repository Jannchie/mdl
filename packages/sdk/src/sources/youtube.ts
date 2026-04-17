import type { TrackDetail } from '@jannchie/mdl-core'

import type { YtDlpMetadata } from '../shared/ytdlp.js'

import { pickBestThumbnail } from '../shared/ytdlp.js'
import { YtDlpMusicSource } from './ytdlp-base.js'

export class YoutubeMusicSource extends YtDlpMusicSource {
  readonly name = 'Youtube'

  protected buildUrl(identifier: string): string {
    return identifier.startsWith('http') ? identifier : `https://www.youtube.com/watch?v=${identifier}`
  }

  protected mapMetadata(raw: YtDlpMetadata, fallbackId: string): Partial<TrackDetail> & Pick<TrackDetail, 'identifier' | 'songName' | 'singers'> {
    return {
      identifier: raw.id ?? fallbackId,
      songName: raw.track ?? raw.title ?? 'Unknown',
      singers: raw.artist ?? raw.uploader ?? 'Unknown',
      album: raw.album,
      coverUrl: pickBestThumbnail(raw),
      durationS: raw.duration,
    }
  }
}
