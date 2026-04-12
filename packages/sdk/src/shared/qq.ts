import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const qqMusicApi = require('qq-music-api') as {
  api: (path: string, query?: Record<string, unknown>) => Promise<unknown>
}

interface QQSongDetailTrackInfo {
  interval?: number
  album?: {
    name?: string
  }
}

interface QQSongDetailPayload {
  track_info?: QQSongDetailTrackInfo
}

export async function getQQSongDetail(songmid: string): Promise<QQSongDetailTrackInfo | null> {
  try {
    const payload = await qqMusicApi.api('song', { songmid }) as QQSongDetailPayload
    return payload.track_info ?? null
  }
  catch {
    return null
  }
}
