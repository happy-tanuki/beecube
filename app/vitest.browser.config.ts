import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

/**
 * `npm run test:browser`: rendering tests in headless Chrome (WebGL through
 * SwiftShader, so no GPU is needed). Uses the installed Google Chrome.
 */
export default defineConfig({
  test: {
    include: ['test/browser/**/*.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        launchOptions: { channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
      }),
      instances: [{ browser: 'chromium' }],
      viewport: { width: 640, height: 480 },
    },
  },
})
