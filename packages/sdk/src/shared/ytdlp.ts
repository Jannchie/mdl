import type { ArgsOptions, Download, Exec, ExecBuilderResult, YtDlp } from 'ytdlp-nodejs'

import { existsSync } from 'node:fs'

import { helpers, YtDlp as YtDlpClass } from 'ytdlp-nodejs'

type DownloadOptions = Parameters<YtDlp['download']>[1]

export interface YtDlpFormat {
  url?: string
  ext?: string
  filesize?: number
  format_id?: string
  acodec?: string
}

export interface YtDlpMetadata {
  id?: string
  title?: string
  thumbnail?: string
  uploader?: string
  description?: string
  duration?: number
  formats?: YtDlpFormat[]
  entries?: YtDlpMetadata[]
}

const INSTALL_HINT
  = 'yt-dlp binary not found. Install yt-dlp (https://github.com/yt-dlp/yt-dlp), '
    + 'set YTDLP_PATH to the binary location, or set MDL_AUTO_INSTALL_YTDLP=1 to auto-download on demand.'

let cachedYtDlpPath: string | null = null

async function resolveYtDlpPath(): Promise<string> {
  if (cachedYtDlpPath && existsSync(cachedYtDlpPath)) {
    return cachedYtDlpPath
  }

  const envPath = process.env.YTDLP_PATH
  if (envPath && existsSync(envPath)) {
    cachedYtDlpPath = envPath
    return cachedYtDlpPath
  }

  const foundPath = helpers.findYtdlpBinary()
  if (foundPath && existsSync(foundPath)) {
    cachedYtDlpPath = foundPath
    return cachedYtDlpPath
  }

  if (process.env.MDL_AUTO_INSTALL_YTDLP !== '1') {
    throw new Error(INSTALL_HINT)
  }

  await helpers.downloadYtDlp()
  const downloadedPath = helpers.findYtdlpBinary()
  if (downloadedPath && existsSync(downloadedPath)) {
    cachedYtDlpPath = downloadedPath
    return cachedYtDlpPath
  }

  throw new Error(INSTALL_HINT)
}

export async function getYtDlpClient(): Promise<YtDlp> {
  const binaryPath = await resolveYtDlpPath()
  return new YtDlpClass({ binaryPath })
}

export function pickAudioFormat(formats: YtDlpFormat[] | undefined): YtDlpFormat | undefined {
  return formats?.find(
    f => f.ext === 'm4a' || f.ext === 'mp3' || (f.acodec !== undefined && f.acodec !== 'none' && !f.url?.includes('manifest')),
  )
}

interface Killable { kill: (signal?: NodeJS.Signals | number) => boolean }

async function runWithAbort<T, Op extends Killable & PromiseLike<T>>(
  operation: Op,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) {
    return await Promise.resolve(operation)
  }
  if (signal.aborted) {
    operation.kill('SIGTERM')
    throw new DOMException('Operation aborted', 'AbortError')
  }
  const onAbort = (): void => {
    operation.kill('SIGTERM')
  }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await Promise.resolve(operation)
  }
  finally {
    signal.removeEventListener('abort', onAbort)
  }
}

export async function runExec(
  client: YtDlp,
  url: string,
  options: ArgsOptions,
  signal: AbortSignal | undefined,
): Promise<ExecBuilderResult> {
  const exec: Exec = client.exec(url, options)
  return await runWithAbort(exec, signal)
}

export async function runDownload(
  client: YtDlp,
  url: string,
  options: DownloadOptions,
  signal: AbortSignal | undefined,
): Promise<void> {
  const download: Download = client.download(url, options)
  await runWithAbort(download, signal)
}
