#!/usr/bin/env node
import { serve } from '@hono/node-server'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { createClient } from '@jannchie/mdl-sdk'

import { Scalar } from '@scalar/hono-api-reference'

const client = createClient()

const looseObjectSchema = z.record(z.string(), z.any()).openapi({
  description: 'Arbitrary source-specific configuration.',
  example: {
    headers: {
      referer: 'https://music.example.com/',
    },
  },
})

const sourceScopedConfigSchema = z.record(z.string(), looseObjectSchema).openapi({
  description: 'Per-source overrides keyed by source name.',
  example: {
    QQMusicClient: {
      headers: {
        referer: 'https://y.qq.com/',
      },
    },
  },
})

const nestedTrackSchema = z.object({
  source: z.string().openapi({ example: 'QQMusicClient' }),
  rootSource: z.string().optional().openapi({ example: 'qq' }),
  identifier: z.string().openapi({ example: '003aAYrm3GE0Ac' }),
  songName: z.string().openapi({ example: '稻香' }),
  singers: z.string().optional().openapi({ example: '周杰伦' }),
  album: z.string().optional().openapi({ example: '魔杰座' }),
  ext: z.string().optional().openapi({ example: 'mp3' }),
  fileSizeBytes: z.number().optional().openapi({ example: 8_945_664 }),
  fileSize: z.string().optional().openapi({ example: '8.53 MB' }),
  durationS: z.number().optional().openapi({ example: 189 }),
  duration: z.string().optional().openapi({ example: '3:09' }),
  lyric: z.string().optional().openapi({ example: '[00:00.00]稻香 - 周杰伦' }),
  coverUrl: z.string().optional().openapi({ example: 'https://example.com/cover.jpg' }),
  downloadUrl: z.string().optional().openapi({ example: 'https://example.com/audio.mp3' }),
  protocol: z.enum(['http', 'hls']).optional().openapi({ example: 'http' }),
  workDir: z.string().optional().openapi({ example: '/tmp/mdl' }),
  downloadHeaders: z.record(z.string(), z.string()).optional().openapi({
    example: {
      referer: 'https://y.qq.com/',
    },
  }),
  rawData: z.record(z.string(), z.any()).optional().openapi({
    description: 'Original source payload for debugging or custom integrations.',
  }),
  fusedScore: z.number().optional().openapi({ example: 0.032_522 }),
  matchedSources: z.array(z.string()).optional().openapi({ example: ['QQMusicClient', 'JBSouMusicClient'] }),
})

const trackSchema = nestedTrackSchema.extend({
  episodes: z.array(nestedTrackSchema).optional(),
  alternatives: z.array(nestedTrackSchema).optional(),
})

const downloadedTrackSchema = z.object({
  source: z.string().openapi({ example: 'QQMusicClient' }),
  identifier: z.string().openapi({ example: '003aAYrm3GE0Ac' }),
  savePath: z.string().openapi({ example: '/tmp/downloads/QQMusicClient/稻香 - 003aAYrm3GE0Ac.mp3' }),
})

const downloadResultSchema = z.object({
  source: z.string().openapi({ example: 'QQMusicClient' }),
  requested: z.number().openapi({ example: 1 }),
  completed: z.number().openapi({ example: 1 }),
  items: z.array(downloadedTrackSchema),
})

const healthResponseSchema = z.object({
  ok: z.boolean().openapi({ example: true }),
})

const sourcesResponseSchema = z.object({
  sources: z.array(z.string()).openapi({
    example: ['QQMusicClient', 'NeteaseMusicClient', 'KuwoMusicClient'],
  }),
})

const searchRequestSchema = z.object({
  keyword: z.string().min(1).openapi({ example: '周杰伦 稻香' }),
  sources: z.array(z.string()).optional().openapi({ example: ['QQMusicClient', 'KugouMusicClient'] }),
  searchSizePerSource: z.number().int().positive().optional().openapi({ example: 5 }),
  searchSizePerPage: z.number().int().positive().optional().openapi({ example: 20 }),
  initSourceConfig: sourceScopedConfigSchema.optional(),
  requestOverrides: sourceScopedConfigSchema.optional(),
  searchRules: sourceScopedConfigSchema.optional(),
})

const groupedSearchResponseSchema = z.object({
  results: z.record(z.string(), z.array(trackSchema)).openapi({
    example: {
      QQMusicClient: [
        {
          source: 'QQMusicClient',
          identifier: '003aAYrm3GE0Ac',
          songName: '稻香',
          singers: '周杰伦',
          ext: 'mp3',
          downloadUrl: 'https://example.com/audio.mp3',
          protocol: 'http',
        },
      ],
    },
  }),
})

const searchMergedRequestSchema = searchRequestSchema.extend({
  rrfK: z.number().int().positive().optional().openapi({ example: 60 }),
  timeoutMs: z.number().int().positive().optional().openapi({ example: 1500 }),
})

const mergedSearchResponseSchema = z.object({
  results: z.array(trackSchema),
})

const parsePlaylistRequestSchema = z.object({
  playlistUrl: z.string().url().openapi({ example: 'https://music.163.com/#/playlist?id=123456' }),
  sources: z.array(z.string()).optional().openapi({ example: ['NeteaseMusicClient', 'QQMusicClient'] }),
  initSourceConfig: sourceScopedConfigSchema.optional(),
  requestOverrides: sourceScopedConfigSchema.optional(),
})

const playlistResponseSchema = z.object({
  results: z.array(trackSchema),
})

const downloadRequestSchema = z.object({
  tracks: z.array(trackSchema).min(1),
  outputDir: z.string().optional().openapi({ example: '/tmp/mdl-downloads' }),
  requestOverrides: sourceScopedConfigSchema.optional(),
})

const downloadResponseSchema = z.object({
  results: z.array(downloadResultSchema),
})

const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  tags: ['System'],
  summary: 'Health check',
  description: 'Returns a simple liveness payload for monitoring.',
  responses: {
    200: {
      description: 'Healthy response.',
      content: {
        'application/json': {
          schema: healthResponseSchema,
        },
      },
    },
  },
})

const sourcesRoute = createRoute({
  method: 'get',
  path: '/sources',
  tags: ['System'],
  summary: 'List visible music sources',
  description: 'Returns the default visible sources currently exposed by the SDK client.',
  responses: {
    200: {
      description: 'Available source names.',
      content: {
        'application/json': {
          schema: sourcesResponseSchema,
        },
      },
    },
  },
})

const searchRoute = createRoute({
  method: 'post',
  path: '/search',
  tags: ['Search'],
  summary: 'Search grouped by source',
  description: 'Runs searches across one or more sources and returns grouped results without rank fusion.',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: searchRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Grouped search results keyed by source name.',
      content: {
        'application/json': {
          schema: groupedSearchResponseSchema,
        },
      },
    },
  },
})

const searchMergedRoute = createRoute({
  method: 'post',
  path: '/search-merged',
  tags: ['Search'],
  summary: 'Search with RRF fusion',
  description: 'Runs multi-source search concurrently and fuses the ranking with Reciprocal Rank Fusion.',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: searchMergedRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Merged search results.',
      content: {
        'application/json': {
          schema: mergedSearchResponseSchema,
        },
      },
    },
  },
})

const parsePlaylistRoute = createRoute({
  method: 'post',
  path: '/parse-playlist',
  tags: ['Playlist'],
  summary: 'Parse a playlist URL',
  description: 'Tries the selected sources sequentially until one of them can parse the playlist.',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: parsePlaylistRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Resolved playlist tracks.',
      content: {
        'application/json': {
          schema: playlistResponseSchema,
        },
      },
    },
  },
})

const downloadRoute = createRoute({
  method: 'post',
  path: '/download',
  tags: ['Download'],
  summary: 'Download tracks to local disk',
  description: 'Downloads the provided tracks into the target output directory on the API server.',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: downloadRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Download results grouped by source.',
      content: {
        'application/json': {
          schema: downloadResponseSchema,
        },
      },
    },
  },
})

export function createServer() {
  const app = new OpenAPIHono()

  app.doc('/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'MDL API',
      version: '0.1.0',
      description: 'HTTP API for music search, playlist parsing, and server-side downloads.',
    },
  })

  app.get(
    '/scalar',
    Scalar({
      url: '/openapi.json',
      pageTitle: 'MDL API Reference',
      theme: 'purple',
    }),
  )

  app.openapi(healthRoute, c => c.json({ ok: true }))

  app.openapi(sourcesRoute, c =>
    c.json({
      sources: client.listSources(),
    }))

  app.openapi(searchRoute, async (c) => {
    const body = c.req.valid('json')
    return c.json({
      results: await client.search(body),
    })
  })

  app.openapi(searchMergedRoute, async (c) => {
    const body = c.req.valid('json')
    return c.json({
      results: await client.searchMerged(body),
    })
  })

  app.openapi(parsePlaylistRoute, async (c) => {
    const body = c.req.valid('json')
    return c.json({
      results: await client.parsePlaylist(body),
    })
  })

  app.openapi(downloadRoute, async (c) => {
    const body = c.req.valid('json')
    return c.json({
      results: await client.download(body),
    })
  })

  return app
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const app = createServer()
  const port = Number(process.env.PORT ?? '3000')
  const host = process.env.HOST ?? '127.0.0.1'
  serve({
    fetch: app.fetch,
    port,
    hostname: host,
  })
}
