import { describe, expect, it } from 'vitest'
import l10n from '../node_modules/scratch-l10n/package.json'
import app from '../package.json'

describe('licenses', () => {
  it('keeps scratch-l10n at a BSD release, which the MIT app can include', () => {
    // From 5.0, scratch-l10n is AGPL-3.0 (docs/design.md, section 10).
    expect(app.license).toBe('MIT')
    expect(l10n.license).toBe('BSD-3-Clause')
  })
})
