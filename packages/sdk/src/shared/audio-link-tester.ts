import { cookieHeader } from './utils.js'

export interface AudioLinkProbe {
  fileSize: string
  ctype: string
  ext: string
  durationS?: number
  downloadUrl: string
  finalUrl: string
}

export interface AudioLinkTestResult {
  ok: boolean
  status: number
  method: string
  finalUrl: string | null
  ctype: string | null
  clen: number | null
  range: boolean | null
  fmt: string | null
  reason: string
}

export interface AudioLinkRequestOptions {
  headers?: Record<string, string>
  cookies?: Record<string, unknown> | string
  timeoutMs?: number
  signal?: AbortSignal
}

export class AudioLinkTester {
  static readonly validAudioExts = new Set([
    'aac',
    'aif',
    'aiff',
    'alac',
    'ape',
    'flac',
    'm3u8',
    'm4a',
    'mid',
    'midi',
    'mp2',
    'mp3',
    'ogg',
    'oga',
    'opus',
    'wav',
    'wave',
    'wma',
    'wv',
    'tta',
    'dsf',
    'dff',
    'm4s',
    'mp4',
  ])

  private static readonly audioCtExtra = new Set([
    'application/octet-stream',
    'application/x-flac',
    'application/flac',
    'application/x-mpegurl',
    'video/mp4',
  ])

  private static readonly ctypeToExt = new Map<string, string>([
    ['audio/mpeg', 'mp3'],
    ['audio/mp3', 'mp3'],
    ['audio/mp4', 'm4a'],
    ['audio/x-m4a', 'm4a'],
    ['audio/aac', 'aac'],
    ['audio/wav', 'wav'],
    ['audio/x-wav', 'wav'],
    ['audio/flac', 'flac'],
    ['audio/x-flac', 'flac'],
    ['audio/ogg', 'ogg'],
    ['audio/opus', 'opus'],
    ['audio/x-ogg', 'ogg'],
    ['video/mp4', 'mp4'],
  ])

  private readonly defaultHeaders: Record<string, string>
  private readonly timeoutMs: number

  constructor(options: AudioLinkRequestOptions = {}) {
    this.defaultHeaders = {
      'Accept': '*/*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
      ...options.headers,
    }
    this.timeoutMs = options.timeoutMs ?? 15_000
  }

  async probe(url: string, options: AudioLinkRequestOptions = {}): Promise<AudioLinkProbe> {
    const naiveGuessExt = this.guessExtFromUrl(url)
    let headResponse: Response | null = null
    try {
      headResponse = await this.request(url, { ...options, method: 'HEAD' })
      const ctype = this.normalizeContentType(headResponse.headers.get('content-type'), naiveGuessExt)
      const ext = AudioLinkTester.ctypeToExt.get(ctype) ?? 'NULL'
      const fileSize = this.formatMb(Number(headResponse.headers.get('content-length') ?? '0'))
      if (fileSize !== 'NULL') {
        return {
          fileSize,
          ctype,
          ext,
          durationS: this.parseDurationHeader(headResponse.headers),
          downloadUrl: url,
          finalUrl: headResponse.url,
        }
      }
    }
    catch {
      headResponse = null
    }

    try {
      const response = await this.request(url, options)
      const ctype = this.normalizeContentType(response.headers.get('content-type'), naiveGuessExt)
      const ext = AudioLinkTester.ctypeToExt.get(ctype) ?? 'NULL'
      const fileSize = this.formatMb(Number(response.headers.get('content-length') ?? '0'))
      return {
        fileSize,
        ctype,
        ext,
        durationS: this.parseDurationHeader(response.headers),
        downloadUrl: url,
        finalUrl: response.url,
      }
    }
    catch {
      return {
        fileSize: 'NULL',
        ctype: 'NULL',
        ext: 'NULL',
        downloadUrl: url,
        finalUrl: 'NULL',
      }
    }
  }

  async test(url: string, options: AudioLinkRequestOptions = {}): Promise<AudioLinkTestResult> {
    const naiveGuessExt = this.guessExtFromUrl(url)
    const output: AudioLinkTestResult = {
      ok: false,
      status: 0,
      method: '',
      finalUrl: null,
      ctype: null,
      clen: null,
      range: null,
      fmt: null,
      reason: '',
    }

    try {
      const response = await this.request(url, { ...options, method: 'HEAD' })
      const ctype = this.normalizeContentType(response.headers.get('content-type'), naiveGuessExt)
      const clen = this.parseNullableInt(response.headers.get('content-length'))
      output.status = response.status
      output.method = 'HEAD'
      output.finalUrl = response.url
      output.ctype = ctype
      output.clen = clen
      output.range = (response.headers.get('accept-ranges') ?? '').toLowerCase() === 'bytes'
      if (response.ok && (this.isAudioContentType(ctype) || naiveGuessExt === 'm4s') && (clen || output.range)) {
        output.ok = true
        output.reason = 'HEAD success'
        return output
      }
    }
    catch (error) {
      output.reason = `HEAD error: ${String(error)}`
    }

    try {
      const response = await this.request(url, {
        ...options,
        headers: {
          Range: 'bytes=0-15',
          ...options.headers,
        },
      })
      output.status = response.status
      output.method = 'RANGEGET'
      output.finalUrl = response.url
      if (![200, 206].includes(response.status)) {
        output.reason = `RANGEGET error: response status ${response.status}`
        return output
      }
      const bytes = new Uint8Array(await response.arrayBuffer())
      const ctype = output.ctype ?? this.normalizeContentType(response.headers.get('content-type'), naiveGuessExt)
      const clen
        = output.clen
        ?? this.parseNullableInt(response.headers.get('content-length'))
        ?? this.parseNullableInt((response.headers.get('content-range') ?? '').split('/').at(-1) ?? null)
      output.ctype = ctype
      output.range = output.range || response.status === 206 || response.headers.has('content-range')
      output.clen = clen
      output.fmt = this.sniffMagic(bytes)
      if (this.isAudioContentType(ctype) || output.fmt || naiveGuessExt === 'm4s') {
        output.ok = true
        output.reason = 'RANGEGET success'
      }
      else {
        output.reason = 'RANGEGET error: Not audio-like (CT/magic)'
      }
    }
    catch (error) {
      output.reason = `RANGEGET error: ${String(error)}`
    }

    return output
  }

  private async request(
    url: string,
    options: AudioLinkRequestOptions & { method?: 'GET' | 'HEAD' } = {},
  ): Promise<Response> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? this.timeoutMs)
    const headers = new Headers(this.defaultHeaders)
    for (const [key, value] of Object.entries(options.headers ?? {})) {
      headers.set(key, value)
    }
    const cookie = cookieHeader(options.cookies)
    if (cookie) {
      headers.set('cookie', cookie)
    }
    try {
      const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal
      return await fetch(url, {
        method: options.method ?? 'GET',
        headers,
        redirect: 'follow',
        signal,
      })
    }
    finally {
      clearTimeout(timeout)
    }
  }

  private isAudioContentType(contentType: string | null): boolean {
    if (!contentType) {
      return false
    }
    return contentType.startsWith('audio/') || AudioLinkTester.audioCtExtra.has(contentType)
  }

  private normalizeContentType(contentType: string | null, naiveGuessExt: string): string {
    const normalized = (String(contentType ?? '')
      .split(';', 1)[0] ?? '')
      .trim()
      .toLowerCase()
    if (normalized === 'image/jpg') {
      return 'audio/mpeg'
    }
    if (normalized === 'text/plain' && naiveGuessExt === 'm4s') {
      return 'audio/mp4'
    }
    return normalized || 'NULL'
  }

  private sniffMagic(bytes: Uint8Array): string | null {
    const checks: Array<[Uint8Array, string]> = [
      [new Uint8Array([0x49, 0x44, 0x33]), 'mp3'],
      [new Uint8Array([0xFF, 0xFB]), 'mp3'],
      [new Uint8Array([0x66, 0x4C, 0x61, 0x43]), 'flac'],
      [new Uint8Array([0x52, 0x49, 0x46, 0x46]), 'wav'],
      [new Uint8Array([0x4F, 0x67, 0x67, 0x53]), 'ogg'],
      [new Uint8Array([0x4D, 0x54, 0x68, 0x64]), 'midi'],
      [new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]), 'mp4/m4a'],
    ]
    for (const [signature, format] of checks) {
      if (signature.every((value, index) => bytes[index] === value)) {
        return format
      }
    }
    const firstByte = bytes[0]
    const secondByte = bytes[1]
    if (firstByte !== undefined && secondByte !== undefined && firstByte === 0xFF && (secondByte & 0xF0) === 0xF0) {
      return 'aac/adts'
    }
    return null
  }

  private guessExtFromUrl(url: string): string {
    return url.split('?')[0]?.split('.').pop()?.toLowerCase() ?? ''
  }

  private parseNullableInt(value: string | null): number | null {
    return value && /^\d+$/.test(value) ? Number(value) : null
  }

  private parseDurationHeader(headers: Headers): number | undefined {
    for (const key of ['content-duration', 'x-content-duration']) {
      const value = headers.get(key)
      if (!value) {
        continue
      }
      const durationS = Number(value)
      if (Number.isFinite(durationS) && durationS > 0) {
        return durationS
      }
    }
    return undefined
  }

  private formatMb(size: number): string {
    if (!size || Number.isNaN(size)) {
      return 'NULL'
    }
    return `${(size / 1024 / 1024).toFixed(2)} MB`
  }
}
