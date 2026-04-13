import { describe, expect, it } from 'vitest'
import { createClient } from '../src/client.js'

describe('createClient', () => {
  it('does not enable JBSouMusicClient by default', () => {
    const client = createClient()

    expect(client.listSources()).not.toContain('JBSouMusicClient')
  })
})
