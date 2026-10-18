# Design

Settled on 2026-10-18. This document records what the project is and the
decisions that shape it. The runtime has its own document,
[vm-design.md](vm-design.md); sharing is in [sharing.md](sharing.md).

## 1. What it is

BeeCube is a Scratch-style block programming environment in 3D:

- Sprites are 3D objects and the stage is a 3D space.
- The blocks are Scratch's, with blocks added or changed for the third
  dimension.
- The pen draws in space: lines, and wireframe shapes.
- Objects and the camera are handled like in Tinkercad.
- Physics comes as an extension.

The audience is children, as with Scratch. Section 7 lists what follows from that.

## 2. Relationship to Scratch

- **Scratch on the outside, a game engine on the inside.** Blocks, how they
  snap together, and ideas such as the green flag, "forever", broadcasts and
  clones stay as in Scratch. The runtime is a game engine instead: fixed
  ticks, and many entities updated together (see vm-design.md).
- **No compatibility with Scratch files.** Projects can't be imported from or
  exported to `.sb3`, and exact Scratch timing is not a goal. This frees the
  project format and the runtime to fit 3D.
- **Code from Scratch.** The block editor is
  [scratch-blocks](https://github.com/scratchfoundation/scratch-blocks)
  (Apache-2.0), used as a library. The Scratch editor monorepo
  (`scratch-editor`) is AGPL-3.0: it is read to understand behavior, and no
  code is copied from it.
- **Name.** The project is called **BeeCube** (decided on 2026-10-18).
  "Scratch" is a trademark of the Scratch Foundation, and the project is not
  affiliated with it, so Scratch's name, logo and characters are not used for
  it. The name is kept in one place, `app/src/brand.ts`.

## 3. The stage and sprites

- **Coordinates.** x and y span a 480 × 360 workplane, the size of the Scratch
  stage, and z is height (z-up). The workplane's four walls and its floor are
  the "edge".
- **Orientation.** `direction` follows Scratch (90 = +x). `pitch` is
  elevation (+90 = straight up), and `roll` turns a sprite about its heading.
  "move steps" follows direction and pitch.
- **Shapes instead of costumes.** A sprite is a cube, sphere, cone or
  cylinder with a color and a size. Costumes, and sounds, are not done yet.

## 4. Blocks

Scratch's categories and blocks are kept where they make sense in 3D. Added
or changed:

| Category | Blocks |
|---|---|
| Motion | go to x/y/z, glide to x/y/z, set z / change z / z position; set pitch / turn up / turn down / pitch; set roll / change roll / roll |
| Looks | set color to (in place of costumes) |
| Events | when I touch (a sprite, or my own clones) |
| Sensing | touched sprite (a sprite reference); "of" for another sprite's properties and sprite-only variables |
| Pen | lines drawn in space; draw cube, draw sphere (wireframes) |

Changed meanings:

- **"touching color"** means touching a sprite of that color, because a 3D
  view has no single picture to sample pixels from.
- **"touching"** tests the real shapes in 3D, and **"distance to"** measures
  between centers in 3D.
- **Sprite references.** Some reporters return a sprite (or clone) rather
  than its name. As text a reference reads as the sprite's name.

Variables and lists can belong to all sprites or to one sprite, as in
Scratch, and monitors show them on the stage.

## 5. The editor

- **Layout.** Scratch's layout: block palette and code area on the left, and
  the stage and sprite list on the right. The editor is designed for
  computers with a mouse and keyboard.
- **3D handling, Tinkercad style.** Drag a sprite to move it on its height
  plane. Drag the cone above the selected sprite to change its height.
  Dragging empty space orbits the camera, Shift+drag pans and the wheel zooms.
  The home button and the top, front and side buttons reset the camera.
- **Full screen** fills the window like Scratch's, keeping the stage's aspect
  ratio. It is for playing: sprites can be clicked but not moved, while the
  camera still orbits.
- **Saving.** The project is autosaved in the browser and can be saved to
  and opened from a JSON file (format in `app/src/engine/project.ts`).

## 6. Extensions

An extension is data plus functions: its blocks, their text in each
language, and the code they run (`app/src/engine/extension.ts`). Built-in
extensions are added from the menu bar, as in Scratch. The first is physics
([Rapier](https://rapier.rs)), which is loaded only by projects that use it.

## 7. Audience: children

- **No personal data.** There are no accounts. Nothing identifying the people
  who share or report projects is stored. Analytics, if added, must not use
  cookies.
- **Sharing is by link**, with no public gallery, comments or messages
  between users. Projects can be reported, and reported projects are hidden
  until reviewed (see sharing.md).
- **Words for children.** Messages in the interface, especially about safety
  and privacy, are written so that children can understand them. So are the
  privacy policy and the terms of use, on the About page (`about.html`,
  text in `app/src/i18n/pages/`).
- **A way for grown-ups to reach us** (to remove a project, or ask about
  privacy) is required: `CONTACT` in `app/src/brand.ts`, an email address,
  shown in the privacy policy.
- **Ads**, if any, are non-personalized ads for a child-directed site. They
  stay away from the editor, the stage and full screen. For now the pages
  carry only AdSense's site verification tag, and no ads; the privacy policy
  is updated before any ads appear.

## 8. The player

`play.html` (and `/p/<id>` for shared projects) shows one project: its stage,
title and notes. Links to it are expected to be opened on phones, so it is
laid out for phones first and loads without the block editor. Its stage is
play-only, with a large green flag before the project starts.

- **On-screen keys.** On touch screens, the player shows buttons for the keys
  the project's key blocks use: arrows as a pad, and space and letters
  beside it.
- **Full screen on phones held sideways.** When the window is short, the
  buttons move to a column beside the stage so that the stage can use the
  full height. Taller windows keep Scratch's layout, buttons above.

## 9. Languages

- The interface is multilingual: every message goes through `t()` in
  `app/src/i18n/`, with English defining the keys and every other language
  (currently Japanese) translating all of them. Text for the blocks this
  project adds is in the same files.
- The repository is in English: code, comments, documents and commit
  messages.

## 10. License

The project is MIT-licensed (decided on 2026-10-17, confirmed on 2026-10-18).

The block translations needed care. scratch-blocks (Apache-2.0) ships with
the translations of scratch-l10n built into its file, and scratch-l10n is
AGPL-3.0 since version 5.0 (November 2024); it was BSD-3-Clause before. For a
day the project switched to the AGPL to take them in. It went back to MIT
once these were established:

- scratch-blocks is built from its source (see the Vite config), and
  `app/src/blocks/l10n.ts` supplies the translations in place of
  scratch-l10n's all-language file.
- They come from scratch-l10n **4.0.46**, its last BSD-3-Clause release. Its
  Japanese has 283 of the 290 messages scratch-blocks uses now, identical to
  the current AGPL translations; the 7 it lacks are not translated there
  either (except "online?", a block this project doesn't offer), and this
  project translates them in `app/src/i18n/`. TurboWarp and PenguinMod
  likewise pin a BSD-era scratch-l10n.
- **Don't upgrade scratch-l10n past 4.x.** Messages scratch-blocks adds later
  are translated in `app/src/i18n/`.
- Not known: on what terms the Transifex volunteers contributed the
  translations. This is the same for the BSD and the AGPL releases.

Libraries keep their own licenses; notably scratch-blocks and Rapier are
Apache-2.0, three.js is MIT and scratch-l10n 4.0.46 is BSD-3-Clause. The build
collects the licenses of the bundled packages into `licenses.txt`, which the
app links to, along with its source code
([github.com/happy-tanuki/beecube](https://github.com/happy-tanuki/beecube),
`SOURCE_URL` in `app/src/brand.ts`).
