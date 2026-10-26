/**
 * The About page (about.html): what the site is, the privacy policy and the
 * terms of use. Written for children, in short sentences. English defines
 * the shape; every other locale translates all of it.
 *
 * `{app}` is replaced by the app's name and `{contact}` by CONTACT in
 * brand.ts, and `{x}` by a link to X_ACCOUNT; the sections with id "contact"
 * and "news" appear only when those are set.
 * `[text](url)` becomes a link.
 */

export interface PageSection {
  id: string
  heading: string
  paragraphs: string[]
}

export interface PageContent {
  title: string
  updated: string
  sections: PageSection[]
}

export interface Pages {
  about: PageContent
  privacy: PageContent
  terms: PageContent
}

export const en: Pages = {
  about: {
    title: 'About {app}',
    updated: '',
    sections: [
      {
        id: 'what',
        heading: 'What is {app}?',
        paragraphs: [
          '{app} lets you make 3D games and animations by snapping blocks together, like Scratch. Your sprites are shapes in a 3D world.',
          '{app} is not made by the Scratch Foundation. Scratch is a project of the Scratch Foundation.',
        ],
      },
      {
        id: 'source',
        heading: 'Source code',
        paragraphs: [
          '{app} is open-source software under the MIT License. You can read, change and share its code.',
          'The software it uses has its own licenses: [see the list](licenses.txt).',
        ],
      },
      {
        id: 'news',
        heading: 'News',
        paragraphs: ['News about {app} is posted on X: {x}'],
      },
    ],
  },
  privacy: {
    title: 'Privacy policy',
    updated: 'Last updated: October 26, 2026',
    sections: [
      {
        id: 'short',
        heading: 'The short version',
        paragraphs: [
          'You don’t need an account. We never ask for your name, email address or anything else about you.',
          'When you share a project, anyone with its link can see it. So never put your real name, where you live, your school or photos of yourself in a project.',
          'Before you share, talk with a grown-up who looks after you.',
        ],
      },
      {
        id: 'share',
        heading: 'What we keep when you share',
        paragraphs: [
          'When you press Share, we keep the title, the text about the project, the project itself with the pictures and 3D models you put in it, and a picture of the stage. They stay until you stop sharing, or until we remove the project.',
          'We also give your browser a secret key. Only that browser can change the project or stop sharing it.',
        ],
      },
      {
        id: 'report',
        heading: 'Reports',
        paragraphs: ['When someone reports a project, we keep only the reason they chose. We don’t keep who sent it.'],
      },
      {
        id: 'browser',
        heading: 'What stays in your browser',
        paragraphs: [
          'Your browser keeps the project you are making, the language you chose, and the list of projects you shared (with their secret keys). This stays on your computer, not with us.',
          'If you clear your browser’s data, they are gone. Save your project to a file if you want to keep it.',
        ],
      },
      {
        id: 'cloudflare',
        heading: 'Cloudflare',
        paragraphs: [
          '{app} runs on Cloudflare. To deliver pages and keep the site safe, Cloudflare handles technical information such as your IP address. [Cloudflare’s privacy policy](https://www.cloudflare.com/privacypolicy/)',
          'When you share or report, Cloudflare Turnstile checks that a person, not a program, is doing it. [Turnstile’s privacy notice](https://www.cloudflare.com/turnstile-privacy-policy/)',
        ],
      },
      {
        id: 'nothing-else',
        heading: 'Ads and tracking',
        paragraphs: [
          'There are no ads and no tracking. If that changes, we will update this page first.',
        ],
      },
      {
        id: 'contact',
        heading: 'Questions, or removing a project',
        paragraphs: [
          'Grown-ups can ask us to remove a project or ask about this policy here: {contact}',
        ],
      },
    ],
  },
  terms: {
    title: 'Terms of use',
    updated: 'Last updated: October 18, 2026',
    sections: [
      {
        id: 'free',
        heading: 'Using {app}',
        paragraphs: [
          '{app} is free to use. We do our best to keep it working, but it comes as it is, without any promise.',
        ],
      },
      {
        id: 'kind',
        heading: 'Be kind and safe',
        paragraphs: [
          'Don’t share anything mean, scary or rude.',
          'Don’t share personal information, yours or anyone else’s.',
          'Only use pictures, sounds and ideas you made, or ones you have permission to use. Say who made them.',
        ],
      },
      {
        id: 'license',
        heading: 'Sharing and remixing',
        paragraphs: [
          'When you share a project, you let everyone see it, open it with “See inside”, change it and share their version, under the [Creative Commons Attribution-ShareAlike 4.0](https://creativecommons.org/licenses/by-sa/4.0/) license.',
          'When you share a project that started from someone else’s, say so in the text about your project and include its link.',
        ],
      },
      {
        id: 'remove',
        heading: 'Hiding and removing projects',
        paragraphs: [
          'Anyone can report a project. A project with several reports is hidden until we check it. We may hide or remove projects that break these rules.',
        ],
      },
      {
        id: 'changes',
        heading: 'Changes',
        paragraphs: ['We may change these terms. The date at the top shows the last change.'],
      },
    ],
  },
}
