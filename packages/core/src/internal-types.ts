import type {
  DownloadOptions,
  DownloadResult,
  FetchDetailOptions,
  OpenedTrackStream,
  OpenTrackStreamOptions,
  ParsePlaylistOptions,
  SearchOptions,
  SourceCapabilities,
  TrackDetail,
  TrackLookup,
  TrackSummary,
} from './types.js'

export interface SearchRequest extends SearchOptions {
  keyword: string
}

export interface FetchDetailRequest extends FetchDetailOptions {
  track: TrackLookup
}

export interface DownloadRequest extends DownloadOptions {
  tracks: TrackDetail[]
}

export interface OpenTrackStreamRequest extends OpenTrackStreamOptions {
  track: TrackDetail
}

export interface ParsePlaylistRequest extends ParsePlaylistOptions {
  playlistUrl: string
}

export interface SourceContext {
  sourceOptions?: Record<string, unknown>
  requestOptions?: Record<string, unknown>
  sourceSearchOptions?: Record<string, unknown>
}

export interface MusicSource {
  readonly name: string
  readonly capabilities?: SourceCapabilities
  search: (input: SearchRequest, context: SourceContext) => Promise<TrackSummary[]>
  fetchDetail: (input: FetchDetailRequest, context: SourceContext) => Promise<TrackDetail>
  download: (input: DownloadRequest, context: SourceContext) => Promise<DownloadResult>
  openTrackStream: (input: OpenTrackStreamRequest, context: SourceContext) => Promise<OpenedTrackStream>
  parsePlaylist?: (input: ParsePlaylistRequest, context: SourceContext) => Promise<TrackSummary[]>
}
