/**
 * Stands in for scratch-l10n's `locales/blocks-msgs.js` when scratch-blocks
 * is built from its source (see vite.config.ts). That file has the block
 * translations of every Scratch language (over 1 MB); this one has only the
 * languages the app offers besides English, which scratch-blocks has built in.
 *
 * Add a line here for each language added to src/i18n (LOCALES).
 *
 * scratch-l10n is pinned at 4.0.46, its last BSD-3-Clause release; from 5.0
 * it is AGPL-3.0, which the app's MIT license can't take in (docs/design.md,
 * section 10). Messages newer than 4.0.46 are translated in src/i18n.
 */
import ja from 'scratch-l10n/editor/blocks/ja.json'

export default { ja }
