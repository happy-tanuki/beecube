// Vite plugin: writes licenses.txt into the build, with the license (and
// NOTICE) text of every package whose code ends up in the bundle.
//
// The packages are read from the bundle's modules. A package that ships
// pre-bundled would hide the packages inside it; scratch-blocks did, and is
// now built from its source (see vite.config.ts) so that its parts show.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const PACKAGE_DIR = /^(.*[\\/]node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)[\\/]/

function readPackage(dir) {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
}

/** LICENSE / LICENCE / COPYING and NOTICE files in a package directory. */
function noticeFiles(dir) {
  return readdirSync(dir)
    .filter((f) => /^(licen[cs]e|copying|notice)(\.(md|txt))?$/i.test(f))
    .sort((a, b) => Number(/^notice/i.test(a)) - Number(/^notice/i.test(b)))
    .map((f) => readFileSync(join(dir, f), 'utf8').trim())
}

/**
 * @param {{ header: string, licenseFile: string }} options
 *   `header` (the app's name and copyright) and the text of `licenseFile`
 *   (the app's own license) start the file.
 */
export function licenses({ header, licenseFile }) {
  return {
    name: 'licenses',
    apply: 'build',
    generateBundle(_options, bundle) {
      const dirs = new Set()
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue
        for (const id of output.moduleIds) {
          const m = PACKAGE_DIR.exec(id)
          if (m) dirs.add(m[1])
        }
      }
      const entries = [...dirs]
        .map((dir) => ({ dir, pkg: readPackage(dir) }))
        .sort((a, b) => a.pkg.name.localeCompare(b.pkg.name))
      // A package without a license file points to one with the same license.
      const withText = new Map()
      for (const { dir, pkg } of entries) if (noticeFiles(dir).length > 0 && !withText.has(pkg.license)) withText.set(pkg.license, pkg.name)
      const sections = entries.map(({ dir, pkg }) => {
        const files = noticeFiles(dir)
        const text = files.length > 0 ? files : withText.has(pkg.license) ? [`The ${pkg.license} license text is under ${withText.get(pkg.license)} above.`] : []
        return [`${pkg.name} ${pkg.version} (${pkg.license ?? 'see below'})`, pkg.homepage ?? '', '', ...text].join('\n').trim()
      })
      const rule = '\n\n' + '-'.repeat(78) + '\n\n'
      this.emitFile({
        type: 'asset',
        fileName: 'licenses.txt',
        source: `${header.trim()}\n\n${readFileSync(licenseFile, 'utf8').trim()}${rule}Third-party software in this app:${rule}${sections.join(rule)}\n`,
      })
    },
  }
}
