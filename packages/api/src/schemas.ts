import type { DownloadedTrack, DownloadResult, TrackDetail, TrackLookup, TrackSummary } from '@jannchie/mdl-core'

import { z } from '@hono/zod-openapi'

export const exampleTrackLookup = {
  source: 'QQMusicClient',
  identifier: '003aAYrm3GE0Ac',
  songName: '稻香',
  singers: '周杰伦',
  album: '魔杰座',
  durationS: 223,
  coverUrl: 'https://y.qq.com/music/photo_new/T002R800x800M0000025NhlN2yWrP4.jpg',
} satisfies TrackLookup

export const exampleTrackDetail = {
  source: 'QQMusicClient',
  identifier: '003aAYrm3GE0Ac',
  songName: '稻香',
  singers: '周杰伦',
  album: '魔杰座',
  ext: 'm4a',
  fileSizeBytes: 8_945_664,
  fileSize: '8.53 MB',
  durationS: 223,
  duration: '3:43',
  lyric: '[00:00.00]稻香 - 周杰伦',
  coverUrl: 'https://y.qq.com/music/photo_new/T002R800x800M0000025NhlN2yWrP4.jpg',
  downloadUrl: 'https://dl.stream.qqmusic.qq.com/C400003aAYrm3GE0Ac.m4a',
  protocol: 'http' as const,
} satisfies TrackDetail

const sourceField = z.string().openapi({ example: 'QQMusicClient' })
const rootSourceField = z.string().openapi({ example: 'qq' })
const identifierField = z.string().openapi({ example: '003aAYrm3GE0Ac' })
const songNameField = z.string().openapi({ example: '稻香' })
const singersField = z.string().openapi({ example: '周杰伦' })
const albumField = z.string().openapi({ example: '魔杰座' })
const durationSField = z.number().openapi({ example: 223 })
const durationField = z.string().openapi({ example: '3:43' })
const coverUrlField = z.string().openapi({ example: exampleTrackLookup.coverUrl })
const downloadUrlField = z.string().openapi({ example: exampleTrackDetail.downloadUrl })
const extField = z.string().openapi({ example: 'm4a' })
const fileSizeBytesField = z.number().openapi({ example: 8_945_664 })
const fileSizeField = z.string().openapi({ example: '8.53 MB' })
const lyricField = z.string().openapi({ example: '[00:00.00]稻香 - 周杰伦' })
const protocolField = z.enum(['http', 'hls']).openapi({ example: 'http' })
const workDirField = z.string().openapi({ example: '/tmp/mdl' })
const downloadHeadersField = z.record(z.string(), z.string()).openapi({
  example: {
    referer: 'https://y.qq.com/',
  },
})
const rawDataField = z.record(z.string(), z.any()).optional().openapi({
  description: 'Optional source payload for debugging. Some providers return short-lived values here, so callers should not rely on it as the default input.',
})

const trackSummaryBaseSchema = z.object({
  source: sourceField,
  identifier: identifierField,
  rootSource: rootSourceField.optional(),
  songName: songNameField,
  singers: singersField.optional(),
  album: albumField.optional(),
  durationS: durationSField.optional(),
  coverUrl: coverUrlField.optional(),
  rawData: rawDataField,
}) satisfies z.ZodType<TrackSummary>

export const trackSummarySchema = trackSummaryBaseSchema.openapi({
  example: exampleTrackLookup,
})

const trackLookupBaseSchema = z.object({
  source: sourceField,
  identifier: identifierField,
  rootSource: rootSourceField.optional(),
  songName: songNameField.optional(),
  singers: singersField.optional(),
  album: albumField.optional(),
  durationS: durationSField.optional(),
  coverUrl: coverUrlField.optional(),
  downloadUrl: downloadUrlField.optional(),
  rawData: rawDataField,
}) satisfies z.ZodType<TrackLookup>

export const trackLookupSchema = trackLookupBaseSchema.openapi({
  example: exampleTrackLookup,
})

const trackDetailBaseSchema = z.object({
  source: sourceField,
  identifier: identifierField,
  rootSource: rootSourceField.optional(),
  songName: songNameField,
  singers: singersField.optional(),
  album: albumField.optional(),
  ext: extField.optional(),
  fileSizeBytes: fileSizeBytesField.optional(),
  fileSize: fileSizeField.optional(),
  durationS: durationSField.optional(),
  duration: durationField.optional(),
  lyric: lyricField.optional(),
  coverUrl: coverUrlField.optional(),
  downloadUrl: downloadUrlField.optional(),
  protocol: protocolField.optional(),
  workDir: workDirField.optional(),
  downloadHeaders: downloadHeadersField.optional(),
  rawData: rawDataField,
  episodes: z.array(trackSummarySchema).optional(),
}) satisfies z.ZodType<TrackDetail>

export const trackDetailSchema = trackDetailBaseSchema.openapi({
  example: exampleTrackDetail,
})

const downloadedTrackBaseSchema = z.object({
  source: sourceField,
  identifier: identifierField,
  savePath: z.string().openapi({ example: '/tmp/downloads/QQMusicClient/稻香 - 003aAYrm3GE0Ac.mp3' }),
}) satisfies z.ZodType<DownloadedTrack>

export const downloadedTrackSchema = downloadedTrackBaseSchema

const downloadResultBaseSchema = z.object({
  source: sourceField,
  requested: z.number().openapi({ example: 1 }),
  completed: z.number().openapi({ example: 1 }),
  items: z.array(downloadedTrackSchema),
}) satisfies z.ZodType<DownloadResult>

export const downloadResultSchema = downloadResultBaseSchema

export const looseObjectSchema = z.record(z.string(), z.any()).openapi({
  description: 'Arbitrary source-specific configuration.',
  example: {
    headers: {
      referer: 'https://music.example.com/',
    },
  },
})

export const sourceScopedConfigSchema = z.record(z.string(), looseObjectSchema).openapi({
  description: 'Per-source overrides keyed by source name.',
  example: {
    QQMusicClient: {
      headers: {
        referer: 'https://y.qq.com/',
      },
    },
  },
})
