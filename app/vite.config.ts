import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vitest/config'
import { licenses } from './scripts/licenses.mjs'
import { APP_NAME } from './src/brand.ts'

/**
 * Cross-origin isolation, so the logic worker trial (`?bench=A&logic=worker`)
 * can use SharedArrayBuffer. Only for that page and what it loads: elsewhere
 * it would block third-party scripts such as Turnstile.
 */
const isolation: Plugin = {
  name: 'isolation',
  configureServer: (server) => void server.middlewares.use(isolate),
  configurePreviewServer: (server) => void server.middlewares.use(isolate),
}

function isolate(req: unknown, res: unknown, next: () => void): void {
  // Typed loosely: this project doesn't install Node's type definitions.
  const { url = '', headers } = req as { url?: string; headers: Record<string, string | undefined> }
  if (/[?&]logic=/.test(url) || /[?&]logic=/.test(headers.referer ?? '')) {
    const r = res as { setHeader(name: string, value: string): void }
    r.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
    r.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
  }
  next()
}

/** Fills %APP_NAME% in index.html from src/brand.ts. */
const brand: Plugin = {
  name: 'brand',
  transformIndexHtml: (html) => html.replaceAll('%APP_NAME%', APP_NAME),
}

/** In development, /p/<id> is the player page, as functions/p/[id].ts makes it when deployed. */
const sharePages: Plugin = {
  name: 'share-pages',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      // Typed loosely: this project doesn't install Node's type definitions.
      const r = req as { url?: string }
      if (r.url && /^\/p\/[a-z0-9]+\/?(\?.*)?$/.test(r.url)) r.url = '/play.html'
      next()
    })
  },
}

export default defineConfig({
  plugins: [
    react(),
    brand,
    sharePages,
    isolation,
    licenses({ header: `${APP_NAME}\nCopyright (c) 2026 masataka takeuchi`, licenseFile: '../LICENSE' }),
  ],
  server: {
    // The sharing API runs in `npm run pages:dev` (wrangler, port 8788).
    proxy: { '/api': 'http://localhost:8788' },
  },
  resolve: {
    alias: [
      // scratch-blocks from its source rather than its prebuilt file, so its
      // translations can be limited to the app's languages (src/blocks/l10n.ts).
      // In development, Vite pre-bundles it: after changing l10n.ts, restart
      // the dev server with --force.
      { find: /^scratch-blocks$/, replacement: new URL('./node_modules/scratch-blocks/src/index.ts', import.meta.url).pathname },
      { find: 'scratch-l10n/locales/blocks-msgs.js', replacement: new URL('./src/blocks/l10n.ts', import.meta.url).pathname },
    ],
  },
  worker: { format: 'es' },
  build: {
    rolldownOptions: {
      // The editor, the player for shared projects, the About page and the moderation page.
      input: { main: 'index.html', play: 'play.html', about: 'about.html', admin: 'admin.html' },
    },
  },
  test: {
    include: ['test/**/*.test.ts', 'server/**/*.test.ts'],
    exclude: ['test/browser/**'],
  },
})
