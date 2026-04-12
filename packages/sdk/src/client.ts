import { MusicService } from '@jannchie/mdl-core'

import {
  JamendoMusicSource,
  JBSouMusicSource,
  KugouMusicSource,
  KuwoMusicSource,
  MiguMusicSource,
  NeteaseMusicSource,
  QQMusicSource,
} from './sources/index.js'

export function createClient(): MusicService {
  return new MusicService([
    new MiguMusicSource(),
    new NeteaseMusicSource(),
    new QQMusicSource(),
    new KuwoMusicSource(),
    new KugouMusicSource(),
    new JBSouMusicSource(),
    new JamendoMusicSource(),
  ])
}
