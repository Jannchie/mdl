import { MusicService } from '@jannchie/mdl-core'

import {
  BilibiliMusicSource,
  JamendoMusicSource,
  KugouMusicSource,
  KuwoMusicSource,
  MiguMusicSource,
  NeteaseMusicSource,
  QQMusicSource,
  YoutubeMusicSource,
} from './sources/index.js'

export function createClient(): MusicService {
  return new MusicService([
    new MiguMusicSource(),
    new NeteaseMusicSource(),
    new QQMusicSource(),
    new KuwoMusicSource(),
    new KugouMusicSource(),
    new JamendoMusicSource(),
    new YoutubeMusicSource(),
    new BilibiliMusicSource(),
  ])
}
