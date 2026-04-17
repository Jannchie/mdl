import type { DownloadResult, OpenedTrackStream, SourceCapabilities, TrackDetail, TrackLookup, TrackSummary } from '@jannchie/mdl-core'
import type { DownloadRequest, OpenTrackStreamRequest, SourceContext } from '@jannchie/mdl-core/internal'

import type { YtDlpMetadata } from '../shared/ytdlp.js'

import path from 'node:path'
import { buildTrackOutputPath } from '../shared/utils.js'
import { getYtDlpClient, runDownload, runExec } from '../shared/ytdlp.js'
import { BaseMusicSource } from './base.js'

export abstract class YtDlpMusicSource extends BaseMusicSource {
  override readonly capabilities: SourceCapabilities = {
    search: false,
    playlist: false,
    stream: false,
    download: true,
  }

  protected readonly searchHeaders = {}
  protected readonly parseHeaders = {}
  protected readonly downloadHeaders = {}

  protected abstract buildUrl(identifier: string): string
  protected abstract mapMetadata(raw: YtDlpMetadata, fallbackId: string): Pick<TrackDetail, 'identifier' | 'songName' | 'singers'> & Partial<TrackDetail>

  protected async resolveTrackDetail(track: TrackLookup, context: SourceContext): Promise<TrackDetail> {
    if (this.isDetailedTrack(track)) {
      return track
    }

    const url = this.buildUrl(track.identifier)
    const client = await getYtDlpClient()
    const signal = context.requestOptions?.signal as AbortSignal | undefined

    const result = await runExec(
      client,
      url,
      { dumpSingleJson: true, noCheckCertificates: true, noWarnings: true },
      signal,
    )

    const raw = JSON.parse(result.stdout || result.output || '{}') as YtDlpMetadata
    const mapped = this.mapMetadata(raw, track.identifier)

    return {
      ext: 'm4a',
      ...mapped,
      source: this.name,
      downloadUrl: url,
    }
  }

  override async download(input: DownloadRequest, context: SourceContext): Promise<DownloadResult> {
    const outputDir = input.outputDir ?? path.resolve(process.cwd(), 'downloads')
    const client = await getYtDlpClient()
    const signal = context.requestOptions?.signal as AbortSignal | undefined
    const items = []

    for (const track of input.tracks) {
      if (signal?.aborted) {
        break
      }
      const ext = track.ext === 'mp3' ? 'mp3' : 'm4a'
      const savePath = buildTrackOutputPath(outputDir, this.name, track.songName, track.identifier, ext)

      await runDownload(
        client,
        this.buildUrl(track.identifier),
        { output: savePath, extractAudio: true, audioFormat: ext },
        signal,
      )

      items.push({
        source: this.name,
        identifier: track.identifier,
        savePath,
      })
    }

    return {
      source: this.name,
      requested: input.tracks.length,
      completed: items.length,
      items,
    }
  }

  override async openTrackStream(_input: OpenTrackStreamRequest, _context: SourceContext): Promise<OpenedTrackStream> {
    throw this.unsupported('openTrackStream')
  }

  override async search(_input: { keyword: string }, _context: SourceContext): Promise<TrackSummary[]> {
    throw this.unsupported('search')
  }

  override async parsePlaylist(_input: { playlistUrl: string }, _context: SourceContext): Promise<TrackSummary[]> {
    throw this.unsupported('parsePlaylist')
  }

  protected unsupported(operation: string): Error {
    return new Error(
      `${this.name} does not support ${operation}. Use fetchDetail() with a direct video URL or identifier.`,
    )
  }
}
