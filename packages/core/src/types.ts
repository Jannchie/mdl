export type SourceScopedConfig = Record<string, Record<string, unknown>>

export interface Track {
  source: string
  rootSource?: string
  identifier: string
  songName: string
  singers?: string
  album?: string
  ext?: string
  fileSizeBytes?: number
  fileSize?: string
  durationS?: number
  duration?: string
  lyric?: string
  coverUrl?: string
  downloadUrl?: string
  protocol?: 'http' | 'hls'
  workDir?: string
  downloadHeaders?: Record<string, string>
  rawData?: Record<string, unknown>
  episodes?: Track[]
}

export interface SearchOptions {
  keyword: string
  sources?: string[]
  searchSizePerSource?: number
  searchSizePerPage?: number
  initSourceConfig?: SourceScopedConfig
  requestOverrides?: SourceScopedConfig
  searchRules?: SourceScopedConfig
}

export interface FetchDetailOptions {
  track: Track
  initSourceConfig?: SourceScopedConfig
  requestOverrides?: SourceScopedConfig
}

export interface DownloadOptions {
  tracks: Track[]
  outputDir?: string
  requestOverrides?: SourceScopedConfig
}

export interface OpenTrackStreamOptions {
  track: Track
  requestOverrides?: SourceScopedConfig
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
  playlistUrl: string
  sources?: string[]
  initSourceConfig?: SourceScopedConfig
  requestOverrides?: SourceScopedConfig
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

export interface SourceContext {
  initConfig?: Record<string, unknown>
  requestOverrides?: Record<string, unknown>
  searchRule?: Record<string, unknown>
}

export interface MusicSource {
  readonly name: string
  search: (input: SearchOptions, context: SourceContext) => Promise<Track[]>
  fetchDetail: (input: FetchDetailOptions, context: SourceContext) => Promise<Track>
  download: (input: DownloadOptions, context: SourceContext) => Promise<DownloadResult>
  openTrackStream: (input: OpenTrackStreamOptions, context: SourceContext) => Promise<OpenedTrackStream>
  parsePlaylist?: (input: ParsePlaylistOptions, context: SourceContext) => Promise<Track[]>
}
