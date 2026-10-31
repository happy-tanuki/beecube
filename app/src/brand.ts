/** The app's name and related settings, in one place. */

/** Shown to users: the menu bar, the page title, dialogs. */
export const APP_NAME = 'BeeCube'

/** Lower-case id for storage keys, the project file format and other internal names. */
export const APP_ID = 'beecube'

/** Extension of saved project files (a zip; older files were the JSON alone, named .beecube.json). */
export const PROJECT_FILE_EXTENSION = '.beecube'

/** The public source repository, which the app links to; null to leave the link out. */
export const SOURCE_URL: string | null = 'https://github.com/happy-tanuki/beecube'

/** The project's X (Twitter) account, without the @, for news; null to leave it out. */
export const X_ACCOUNT: string | null = 'beecube_dev'

/**
 * Where grown-ups can give money to support the site (Buy Me a Coffee); null
 * to leave it out. A plain link, so the site loads nothing from there.
 */
export const SUPPORT_URL: string | null = 'https://buymeacoffee.com/beecube'

/**
 * How grown-ups reach the people running the site (to remove a project, or
 * ask about privacy): a mailto: or https: URL. The privacy policy leaves the
 * contact section out when it is null.
 */
export const CONTACT: string | null = 'mailto:beecube.dev@gmail.com'
