export type SourceOptionsMap = Record<string, Record<string, unknown>>

export interface SourceCapabilities {
  search: boolean
  playlist: boolean
  stream: boolean
  download: boolean
}

export const DEFAULT_SOURCE_CAPABILITIES: SourceCapabilities = {
  search: true,
  playlist: true,
  stream: true,
  download: true,
}

export interface TrackLookup {
  source: string
  identifier: string
  rootSource?: string
  songName?: string
  singers?: string
  album?: string
  durationS?: number
  coverUrl?: string
  downloadUrl?: string
  rawData?: Record<string, unknown>
}

export interface TrackSummary extends TrackLookup {
  songName: string
  duration?: string
}

export interface TrackDetail extends TrackSummary {
  ext?: string
  fileSizeBytes?: number
  fileSize?: string
  lyric?: string
  protocol?: 'http' | 'hls'
  workDir?: string
  downloadHeaders?: Record<string, string>
  episodes?: TrackSummary[]
}

export interface SearchOptions {
  sources?: string[]
  limit?: number
  pageSize?: number
  sourceOptions?: SourceOptionsMap
  requestOptions?: SourceOptionsMap
  sourceSearchOptions?: SourceOptionsMap
}

export interface FetchDetailOptions {
  sourceOptions?: SourceOptionsMap
  requestOptions?: SourceOptionsMap
}

export interface DownloadOptions {
  outputDir?: string
  requestOptions?: SourceOptionsMap
}

export interface OpenTrackStreamOptions {
  requestOptions?: SourceOptionsMap
}

export interface OpenedTrackStream {
  source: string
  identifier: string
  downloadUrl: string
  finalUrl: string
  contentType: string | null
  contentLength: number | null
  ext?: string
  headers: Record<string, string>
  body: ReadableStream<Uint8Array>
}

export interface ParsePlaylistOptions {
  sources?: string[]
  sourceOptions?: SourceOptionsMap
  requestOptions?: SourceOptionsMap
}

export interface DownloadedTrack {
  source: string
  identifier: string
  savePath: string
}

export interface DownloadResult {
  source: string
  requested: number
  completed: number
  items: DownloadedTrack[]
}
