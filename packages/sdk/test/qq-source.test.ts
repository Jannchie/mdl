import { describe, expect, it } from 'vitest'

import { QQMusicSource } from '../src/sources/qq.js'

type JsonHandler = (url: string, options: { query?: Record<string, unknown>, json?: unknown }) => unknown

interface FakeLink {
  ok: boolean
  bytes: number
}

class TestQQMusicSource extends QQMusicSource {
  constructor(
    private readonly handleJson: JsonHandler,
    private readonly links: Record<string, FakeLink>,
  ) {
    super()
  }

  protected override get searchClient() {
    return { json: async (url: string, options: never) => this.handleJson(url, options) } as never
  }

  protected override get parseClient() {
    return { json: async (url: string, options: never) => this.handleJson(url, options) } as never
  }

  protected override get audioLinkTester() {
    return {
      test: async (url: string) => ({
        ok: this.links[url]?.ok ?? false,
        clen: this.links[url]?.bytes ?? null,
        ext: url.endsWith('.flac') ? 'flac' : 'm4a',
      }),
    } as never
  }
}

const MB = 1024 * 1024

describe('qqmusicsource', () => {
  it('maps desktop search results', async () => {
    const source = new TestQQMusicSource(() => ({
      req: {
        data: {
          body: {
            song: {
              list: [{
                mid: '001OyHbk2MSIi4',
                name: '十年',
                interval: 205,
                singer: [{ name: '陈奕迅' }],
                album: { mid: '000GDz8k03UOaI', name: '黑白灰' },
              }],
            },
          },
        },
      },
    }), {})

    const [track] = await source.search({ keyword: '十年', limit: 1 }, {})

    expect(track).toMatchObject({
      identifier: '001OyHbk2MSIi4',
      songName: '十年',
      singers: '陈奕迅',
      album: '黑白灰',
      durationS: 205,
      coverUrl: 'https://y.gtimg.cn/music/photo_new/T002R800x800M000000GDz8k03UOaI.jpg',
    })
  })

  it('falls back to the lite search method when desktop search is throttled', async () => {
    const source = new TestQQMusicSource((_url, options) => {
      const method = (options.json as { req: { method: string } }).req.method
      return method === 'DoSearchForQQMusicDesktop'
        ? { req: { data: { body: { song: { list: [] } } } } }
        : { req: { data: { body: { item_song: [{ mid: '000JsP1J4Ohhr0', name: '十年' }] } } } }
    }, {})

    const tracks = await source.search({ keyword: '十年', limit: 1 }, {})

    expect(tracks.map(track => track.identifier)).toEqual(['000JsP1J4Ohhr0'])
  })

  it('falls through failing resolvers and picks the best playable quality', async () => {
    const source = new TestQQMusicSource((url) => {
      if (url.includes('tang.api')) {
        throw new Error('HTTP 503')
      }
      if (url.includes('hk0.cc')) {
        return {
          song_name: '十年',
          singer_name: '陈奕迅',
          album_name: '黑白灰',
          song_play_time: 205,
          song_play_url_sq: 'https://cdn.example.com/dead.flac',
          song_play_url_hq: 'https://cdn.example.com/ok.m4a',
          song_lyric: '[00:00.00]十年',
        }
      }
      throw new Error(`unexpected ${url}`)
    }, {
      'https://cdn.example.com/dead.flac': { ok: false, bytes: 0 },
      'https://cdn.example.com/ok.m4a': { ok: true, bytes: 5 * MB },
    })

    const detail = await source.fetchDetail({ track: { source: source.name, identifier: '001OyHbk2MSIi4' } }, {})

    expect(detail).toMatchObject({
      songName: '十年',
      singers: '陈奕迅',
      album: '黑白灰',
      durationS: 205,
      ext: 'm4a',
      downloadUrl: 'https://cdn.example.com/ok.m4a',
    })
  })

  it('rejects preview clips that are too small for the track duration', async () => {
    const source = new TestQQMusicSource(() => ({
      song_play_url_hq: 'https://cdn.example.com/preview.m4a',
    }), {
      'https://cdn.example.com/preview.m4a': { ok: true, bytes: 0.47 * MB },
    })

    await expect(source.fetchDetail({
      track: { source: source.name, identifier: '001OyHbk2MSIi4', durationS: 205 },
    }, {})).rejects.toThrow('Failed to fetch detail')
  })
})
