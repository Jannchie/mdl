import { beforeEach, describe, expect, it, vi } from 'vitest'

const getQQSongDetail = vi.fn()

vi.mock('../src/shared/qq.js', () => ({
  getQQSongDetail,
}))

const { QQMusicSource } = await import('../src/sources/qq.js')

class TestQQMusicSource extends QQMusicSource {
  protected override get parseClient() {
    return {
      resolveUrl: async () => 'https://cdn.example.com/demo.mp3',
      text: async () => '[00:00.00]demo',
    } as never
  }

  protected override get audioLinkTester() {
    return {
      test: async () => ({ ok: true }),
      probe: async () => ({
        ext: 'mp3',
        fileSize: '1.00 MB',
        durationS: 223,
      }),
    } as never
  }
}

describe('qqmusicsource fetch detail fallback', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    getQQSongDetail.mockReset()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('refreshes expired search metadata from the track identifier', async () => {
    getQQSongDetail.mockResolvedValue({
      name: '稻香',
      singer: [{ name: '周杰伦' }],
      album: { name: '魔杰座' },
      interval: 223,
    })
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://www.jbsou.cn/',
      json: async () => ({
        data: [{
          songid: '003aAYrm3GE0Ac',
          name: '稻香',
          artist: '周杰伦',
          lrc: 'api.php?get=lrc&type=qq&id=003aAYrm3GE0Ac',
          url: 'api.php?get=url&type=qq&id=003aAYrm3GE0Ac',
          cover: 'api.php?get=pic&type=qq&id=003aAYrm3GE0Ac',
        }],
      }),
    })

    const source = new TestQQMusicSource()
    const result = await source.fetchDetail({
      track: {
        source: source.name,
        identifier: '003aAYrm3GE0Ac',
      },
    }, {})

    const request = fetchMock.mock.calls[0]?.[1] as { body?: URLSearchParams } | undefined
    expect(request?.body?.get('input')).toBe('稻香 周杰伦')
    expect(result.downloadUrl).toBe('https://cdn.example.com/demo.mp3')
    expect(result.album).toBe('魔杰座')
  })
})
