import { describe, expect, it } from 'vitest'

import { decryptMiguPayload } from '../src/sources/migu.js'

const KEY = new TextEncoder().encode('Jk8qzuePiJ1qE3mDYhLQ3T73DtDoAhLP')

function encrypt(value: unknown, seed: number): Uint8Array {
  const plain = new TextEncoder().encode(JSON.stringify(value))
  const body = plain.map((byte, index) => (byte - seed + (KEY[index % KEY.length] ?? 0)) & 0xFF)
  return new Uint8Array([0xAB, 0xCD, 0x01, seed, ...body])
}

describe('decryptmigupayload', () => {
  it('decodes the obfuscated listen-url body', () => {
    const payload = { code: '000000', data: { url: 'https://freetyst.nf.migu.cn/demo.mp3' } }

    expect(decryptMiguPayload(encrypt(payload, 0x5A), null)).toEqual(payload)
  })

  it('passes plain json through', () => {
    expect(decryptMiguPayload(new TextEncoder().encode('{"code":"000000"}'), null)).toEqual({ code: '000000' })
  })
})
