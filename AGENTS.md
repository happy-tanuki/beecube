# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project

A 3D take on Scratch: sprites are 3D objects on a 3D stage, edited with Scratch-style blocks. The app lives in `app/`; see `app/README.md` for layout and commands (`npm run dev`, `npm test`, `npm run typecheck`).

Design decisions are in `docs/`: [design.md](docs/design.md) (goals, audience, blocks, editor), [vm-design.md](docs/vm-design.md) (the runtime) and [sharing.md](docs/sharing.md). Follow them, and update them when a decision changes.

## Language

- Everything committed is in English: source code comments, READMEs, `docs/`, commit messages. The repository is meant to be published on GitHub.
- `.work/` is a local, gitignored workspace and may be in Japanese:
  - `.work/docs/` holds working drafts. When a draft is settled, translate it into English under `docs/` at the repository root.
  - `.work/scratch-editor/`, `.work/scratch-gui/`, `.work/scratch-vm/` are reference checkouts.
- The app UI is multilingual. Do not hard-code UI text:
  - Add each message to `app/src/i18n/en.ts` (which defines the keys) and to every other locale file (e.g. `ja.ts`), then use `t()`.
  - Text for the blocks this project adds goes in the `blocks` section of the same files.
  - Literals in other languages are fine in locale files and in deliberate test data only.

## Licensing

- `.work/scratch-editor/` is AGPL-3.0: read it for behavior, never copy code from it.
- The project is called BeeCube. "Scratch" is a trademark of the Scratch Foundation: don't use it (or its logo and characters) as a name for this project or its parts. The app's name lives in `app/src/brand.ts`.
