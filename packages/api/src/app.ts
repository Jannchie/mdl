import type { MusicService } from '@jannchie/mdl-core'

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'

import { Scalar } from '@scalar/hono-api-reference'
import {
  downloadResultSchema,
  exampleTrackDetail,
  exampleTrackLookup,
  sourceScopedConfigSchema,
  trackDetailSchema,
  trackLookupSchema,
  trackSummarySchema,
} from './schemas.js'

const healthResponseSchema = z.object({
  ok: z.boolean().openapi({ example: true }),
})

const indexResponseSchema = z.object({
  name: z.string().openapi({ example: 'MDL API' }),
  version: z.string().openapi({ example: '0.2.0' }),
  docs: z.object({
    openapi: z.string().url().openapi({ example: 'http://127.0.0.1:3653/openapi.json' }),
    scalar: z.string().url().openapi({ example: 'http://127.0.0.1:3653/scalar' }),
  }),
}).openapi({
  example: {
    name: 'MDL API',
    version: '0.2.0',
    docs: {
      openapi: 'http://127.0.0.1:3653/openapi.json',
      scalar: 'http://127.0.0.1:3653/scalar',
    },
  },
})

const sourcesResponseSchema = z.object({
  sources: z.array(z.string()).openapi({
    example: ['QQMusicClient', 'NeteaseMusicClient', 'KuwoMusicClient'],
  }),
})

const searchRequestSchema = z.object({
  keyword: z.string().min(1).openapi({ example: '周杰伦 稻香' }),
  sources: z.array(z.string()).optional().openapi({ example: ['QQMusicClient', 'KugouMusicClient'] }),
  limit: z.number().int().positive().optional().openapi({ example: 5 }),
  pageSize: z.number().int().positive().optional().openapi({ example: 20 }),
  sourceOptions: sourceScopedConfigSchema.optional(),
  requestOptions: sourceScopedConfigSchema.optional(),
  sourceSearchOptions: sourceScopedConfigSchema.optional(),
})

const groupedSearchResponseSchema = z.object({
  results: z.record(z.string(), z.array(trackSummarySchema)).openapi({
    example: {
      QQMusicClient: [exampleTrackLookup],
    },
  }),
})

const fetchDetailFlatRequestSchema = trackLookupSchema.extend({
  sourceOptions: sourceScopedConfigSchema.optional(),
  requestOptions: sourceScopedConfigSchema.optional(),
}).openapi({
  example: {
    source: 'QQMusicClient',
    identifier: '003aAYrm3GE0Ac',
    songName: '稻香',
    singers: '周杰伦',
  },
})

const fetchDetailRequestSchema = fetchDetailFlatRequestSchema.openapi({
  description: 'Fetch detail by sending track fields directly in the request body.',
  example: {
    source: 'QQMusicClient',
    identifier: '003aAYrm3GE0Ac',
    songName: '稻香',
    singers: '周杰伦',
  },
})

const fetchDetailResponseSchema = z.object({
  result: trackDetailSchema,
}).openapi({
  example: {
    result: exampleTrackDetail,
  },
})

const parsePlaylistRequestSchema = z.object({
  playlistUrl: z.string().url().openapi({ example: 'https://music.163.com/#/playlist?id=123456' }),
  sources: z.array(z.string()).optional().openapi({ example: ['NeteaseMusicClient', 'QQMusicClient'] }),
  sourceOptions: sourceScopedConfigSchema.optional(),
  requestOptions: sourceScopedConfigSchema.optional(),
})

const playlistResponseSchema = z.object({
  results: z.array(trackSummarySchema),
})

const downloadRequestSchema = z.object({
  tracks: z.array(trackDetailSchema).min(1),
  outputDir: z.string().optional().openapi({ example: '/tmp/mdl-downloads' }),
  requestOptions: sourceScopedConfigSchema.optional(),
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

const indexRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['System'],
  summary: 'Describe the API entrypoint',
  description: 'Returns the API name, version, and documentation URLs.',
  responses: {
    200: {
      description: 'API metadata and documentation links.',
      content: {
        'application/json': {
          schema: indexResponseSchema,
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

const fetchDetailRoute = createRoute({
  method: 'post',
  path: '/fetch-detail',
  tags: ['Search'],
  summary: 'Fetch full track detail',
  description: 'Resolves a lightweight track into a detailed track with download metadata.',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: fetchDetailRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Detailed track information.',
      content: {
        'application/json': {
          schema: fetchDetailResponseSchema,
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

export function createServer(client: MusicService, version: string) {
  const app = new OpenAPIHono()
  const apiTitle = 'MDL API'

  app.doc('/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: apiTitle,
      version,
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

  app.openapi(indexRoute, (c) => {
    const requestUrl = new URL(c.req.url)
    const openapiUrl = new URL('/openapi.json', requestUrl)
    const scalarUrl = new URL('/scalar', requestUrl)

    return c.json({
      name: apiTitle,
      version,
      docs: {
        openapi: openapiUrl.href,
        scalar: scalarUrl.href,
      },
    })
  })

  app.openapi(healthRoute, c => c.json({ ok: true }))

  app.openapi(sourcesRoute, c =>
    c.json({
      sources: client.listSources(),
    }))

  app.openapi(searchRoute, async (c) => {
    const body = c.req.valid('json')
    return c.json({
      results: await client.search(body.keyword, {
        sources: body.sources,
        limit: body.limit,
        pageSize: body.pageSize,
        sourceOptions: body.sourceOptions,
        requestOptions: body.requestOptions,
        sourceSearchOptions: body.sourceSearchOptions,
      }),
    })
  })

  app.openapi(fetchDetailRoute, async (c) => {
    const body = c.req.valid('json')
    return c.json({
      result: await client.fetchDetail({
        source: body.source,
        identifier: body.identifier,
        rootSource: body.rootSource,
        songName: body.songName,
        singers: body.singers,
        album: body.album,
        durationS: body.durationS,
        coverUrl: body.coverUrl,
        downloadUrl: body.downloadUrl,
        rawData: body.rawData,
      }, {
        sourceOptions: body.sourceOptions,
        requestOptions: body.requestOptions,
      }),
    })
  })

  app.openapi(parsePlaylistRoute, async (c) => {
    const body = c.req.valid('json')
    return c.json({
      results: await client.parsePlaylist(body.playlistUrl, {
        sources: body.sources,
        sourceOptions: body.sourceOptions,
        requestOptions: body.requestOptions,
      }),
    })
  })

  app.openapi(downloadRoute, async (c) => {
    const body = c.req.valid('json')
    return c.json({
      results: await client.download(body.tracks, {
        outputDir: body.outputDir,
        requestOptions: body.requestOptions,
      }),
    })
  })

  return app
}
