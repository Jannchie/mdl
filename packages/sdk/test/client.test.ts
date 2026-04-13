import { describe, expect, it } from 'vitest'
import { createClient } from '../src/client.js'

describe('createclient', () => {
  it('does not enable jbsoumusicclient by default', () => {
    const client = createClient()

    expect(client.listSources()).not.toContain('JBSouMusicClient')
  })
})
