# Design

Settled on 2026-10-18. This document records what the project is and the
decisions that shape it. The runtime has its own document,
[vm-design.md](vm-design.md); sharing is in [sharing.md](sharing.md).

## 1. What it is

BeeCube is a Scratch-style block programming environment in 3D:

- Sprites are 3D objects and the stage is a 3D space.
- The blocks are Scratch's, with blocks added or changed for the third
  dimension.
- The pen draws in space: lines, wireframe shapes and stamps of a sprite's
  shape.
- Objects and the camera are handled like in Tinkercad.
- Physics comes as an extension.

The audience is children, as with Scratch: it is made to be safe and easy for
them, but it is open to everyone, with no accounts or age checks. Children like
what grown-ups enjoy, so it should not look or read as babyish. Section 7 lists
what follows from that.

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
  elevation (+90 = straight up), and `roll` turns a sprite about its heading
  (positive banks right). "move steps" follows direction and pitch.
  - The relative turns are about the sprite's own axes, as in a flight
    game: turn right/left about its top, turn up/down about its sideways
    axis, roll right/left about its heading. While a sprite is level they
    change only direction, pitch or roll, as in Scratch.
  - Pitch is not held within ±90: like direction, it wraps to (-180, 180],
    so turning up keeps going over the top (loops). Past ±90 the sprite
    flies upside down and against its direction.
  - "point in direction", "set pitch" and "set roll" set the angles
    themselves (relative to the world).
  - Turning about one axis while moving draws a circle (also when pitched or
    banked); turning about two at once (up and roll) draws a helix.
- **Costumes**, as in Scratch (`app/src/engine/costume.ts`): a sprite has
  one or more, and wears one (each clone its own). A costume is a cube,
  sphere, cone or cylinder with a picture wrapped around it, or none; the
  picture's transparent parts show the sprite's color, and "set color"
  still sets that color. A picture wraps a shape in one of two ways: the
  same picture on every side (a cylinder's or a cone's side is wrapped once
  round with it, and its ends show it cut round), or a net on a grid of
  4 × 3 squares (a cube's is a cross; a cylinder's side is the middle row,
  with its ends above and below; a cone's side is the top two rows, its
  base below). A sphere's picture is always wrapped like a globe
  (equirectangular, as 360° images are). The middle of a picture is on the
  front, the side the sprite heads to. The Costumes tab, beside a sprite's
  code as in Scratch, lists them and edits the chosen one's name, shape,
  picture and wrapping; the sprite's "shape" field changes the costume
  worn. Uploaded pictures are scaled down to 1024 pixels at most. The
  costume library (dice, a bee, a present, a crate, bricks, a grass block,
  the Earth, the Moon, a beach ball, a watermelon, a can and a traffic
  cone) is made by `app/scripts/make-costume-library.mjs`; the Earth and the
  Moon are NASA's maps. Files from before costumes open with one costume of
  their sprite's shape. Sounds are not done yet.
- **3D models as costumes.** A costume can be a binary glTF file (`.glb`,
  up to 5 MB) in place of a shape and picture (`app/src/stage/models.ts`).
  It is turned from glTF's axes (up +y, front +z) to the sprite's (up +z,
  front +x), centered on its box, and scaled so the box's longest side is a
  cube's; it keeps its own colors (the sprite's color doesn't show; metal
  is made mostly matte, as the stage has nothing to reflect). It touches
  things, bounces and takes part in physics as that box: the costume keeps
  the box's proportions, and the store an extent per axis that collisions
  multiply width, depth and height by. Skinned models are drawn as their
  skeleton stands, in the costume's pose. The library adds 24
  models from Kenney's kits (CC0): animals, children, cars, space, trees
  and food, re-exported with their textures inside. Models are assets like
  pictures, so they are saved, shared and moderated the same way (the
  moderation page draws them).
- **Poses.** A costume of a model with a skeleton keeps a pose: bones by
  name, each turned by three angles in degrees about the sprite's front,
  left and up axes (as seen with its parent bone at rest), so a slider
  means the same on every bone. The Costumes tab turns the chosen bone with
  three sliders, and makes costumes from one of the file's animations: a
  number of moments evenly through it, each a costume with that pose (only
  how bones turn is kept). Switching such costumes moves the model like a
  flip book; animations are not played as they are, and blocks don't turn
  bones. A pose is drawn by shaping the skinned meshes once, as a look of
  its own; the box stays the model's at rest, so switching poses doesn't
  change what it touches. The library's children keep their kit's
  animations (walk, run, jump, sit and more).
- **The picture editor** (`app/src/ui/PaintEditor.tsx`) paints a costume's
  picture or a backdrop face's, like Scratch's paint editor in bitmap mode
  (there is no vector mode): brush, eraser, fill, line, rectangle, ellipse,
  text and a color picker, with undo and redo. As in Scratch's vector
  mode, it has a fill color (brush, fill, text and filled rectangles and
  ellipses) and an outline color (lines and outlined rectangles and
  ellipses). Each is a label beside the browser's color picker, opened
  directly. For rectangles and ellipses the two labels become buttons that
  choose between filled (fill color, no outline) and outlined (outline
  color only), as Scratch's bitmap mode does; filled is the default, and
  covers just what the outlined one would (its edge is drawn in the fill
  color, rounded corners and all). The
  options bar never changes: the labels keep their size, and the color the
  tool doesn't use is dimmed (the eraser uses neither). The width (1–100
  pixels) is a number field that pops up a long slider while edited, as
  the size does. In the Costumes tab it is
  always there, as in Scratch, under the costume's settings: it paints the
  picture there is or a new transparent one (a net's 1024 × 768, a
  globe's 1024 × 512, otherwise 512 × 512), and each change becomes the
  costume's picture a moment after it is made (so a stroke is stored
  once); there is no Done. For a backdrop's face it opens over the tab
  with "Paint" (on a picture of the face's size) and keeps the picture on
  Done. It shows a guide of where each part of the shape goes, over the
  picture but not in it. What it makes is kept as an uploaded picture
  would be.
- **Width, depth and height** stretch a shape along its own axes, in
  percent of its size (1–2000%, 100% each by default): width along its
  heading (x at direction 90), depth across it, height up its local z axis.
  A stretched cube is a cuboid, for floors, walls and ramps; a stretched
  sphere is an egg. They turn with the sprite, and "size" scales all three.
  They are the sprite's: scaling, relative to what it wears, in percent
  of its size. Its information shows only "size"; editing it pops up
  sliders for the size and for width, depth and height, as Scratch's
  direction pops up a dial. The popup and "set width to" give them as
  they are (size 200 and width 100 is 100, though it is 80 units wide),
  and the size field and "set size to" scale all three, keeping their
  proportions.
- **A costume's width, depth and height** are its shape, in stage units: a
  cube's are 40 each, a model's its box as drawn. Setting them in the
  Costumes tab makes a flat board from a cube or a tall boy from the boy
  model; they stay when the shape changes or the model is taken off. A
  costume of other dimensions is a look of its own, its geometry scaled,
  and touches things as that box; the sprite's width, depth and height
  scale it in turn. Files before version 3 have none.
- **The stage's box.** The workplane's walls stop sprites at any height,
  as before. What the stage shows is a box from the floor up to 360 (the
  height of Scratch's stage, so the back wall is 480 × 360): floor, ceiling
  and four walls. Each face is drawn on its inside only, so from the usual
  view above the stage the near walls and the ceiling disappear and the
  floor and far walls show; from inside the box all six show. The ceiling
  is only a picture: a sprite above 360 shows above it.
- **Backdrops** (`app/src/engine/backdrop.ts`) dress the box, as Scratch's
  backdrops dress its stage (decided on 2026-10-25). A backdrop has the
  scenery (outside the box: a color, or a 360° image all round, its ground
  on the floor's level),
  each face's color or transparent with a picture over it, and whether the
  grid shows (with the axes and the border). The walls and the ceiling show their color and picture as they
  are; the floor is lit and takes shadows (a transparent floor has none,
  except on a 360° image's ground), and a picture's transparent parts show the color, or the scenery on a
  transparent face. A new project's backdrop looks as the stage did before
  backdrops: transparent walls, a pale floor and the grid. A project has one
  or more backdrops, one is current, and it is saved with the project;
  stopping doesn't change it.
  - Considered and dropped (2026-10-24): a sky with a gradient and stars,
    and a brightness, made by blending colors. They didn't match Scratch's
    backdrops, and a sky at infinity left the floor floating.
- **Backdrop pictures** (2026-10-26). A picture covers its face, scaled to
  fill it and cut off evenly where it is longer, with twice as many pixels
  as the face is long (as Scratch's bitmaps have twice the stage's).
  Uploading a backdrop puts the picture on the back wall, as Scratch puts it
  on the stage. Pictures are re-encoded in the browser, as JPEG or, with
  transparent parts, PNG, which also drops a photo's location.
- **360° scenery** (2026-10-26). A 360° image (equirectangular, at most 4096
  pixels wide) is the scenery's, its middle ahead (towards the back wall).
  It is shown ground-projected (three.js's `GroundedSkybox`): the lower half
  of the image is laid flat as a ground at the floor's level, as if the
  photo had been taken from 150 above the stage's center, so the floor lies
  on the image's ground (as a mat, or not at all when transparent) and
  sprites cast shadows on it. The scenery library (`app/public/library/`)
  is 360° images from Poly Haven (CC0) taken in the open, and the moon's
  surface, drawn for BeeCube (`app/scripts/moon.js`) as seen from the
  same height, with no craters under the stage: choosing one changes only
  the current backdrop's scenery, not its faces or grid.
  - Considered and dropped (2026-10-26): cutting a 360° image into the
    box's six faces (a cube panorama). It is right only from the box's
    center; from the usual view above the stage the walls and the floor
    looked badly distorted.
  - Considered and dropped (2026-10-26): the image at infinity, as a
    background. The stage's floor floated above the image's ground. A
    library entry was also a whole backdrop, so choosing scenery added a
    backdrop and changed the floor, which mixed the two up.
  - Images with things near the camera (a room, a forest trail, trees in a
    snowy park) don't suit
    a ground projection: the near things are smeared over the ground. The
    stage's box is the room; the scenery is what is outside it.
- **Room library** (2026-10-26). Rooms dress the stage's box: a living
  room, a classroom and the inside of a spaceship, each a picture for every
  face (walls, floor and ceiling). Choosing one changes only the current
  backdrop's six faces, not its scenery or grid, so any room can stand in
  any scenery. Windows are transparent, and the scenery shows through them
  (the spaceship's onto the moon). A room is drawn at a
  centimeter a unit (a sprite of 100 is about a child's height), its
  textures repeated at their real size and from Poly Haven (CC0), and its
  walls darker towards the corners, as walls aren't lit. The pictures are
  made by `app/scripts/make-room-library.mjs` and are ordinary face
  pictures, so the user can change or remove each.
- **Assets**, as in Scratch (`app/src/engine/assets.ts`). A picture is an
  asset: the project's JSON refers to it by the SHA-256 of its contents and
  its format, and the contents are kept apart, in memory while the project
  is open. The library refers to its pictures the same way, and they are
  fetched when shown.

## 4. Blocks

Scratch's categories and blocks are kept where they make sense in 3D. Added
or changed:

| Category | Blocks |
|---|---|
| Motion | go to (random position, mouse pointer, a sprite: in 3D); point towards (a sprite: direction and pitch; the mouse pointer or a random direction: direction only); go to x/y/z; glide to (the same targets as go to, where the target is when the glide starts) and glide to x/y/z; set z / change z / z position; turn up / turn down, roll right / roll left (about the own axes; turn right/left too); set pitch / pitch; set roll / roll |
| Looks | set color to; switch costume to, next costume, costume (number / name), as in Scratch; set / change (width, depth, height); width / depth / height; switch backdrop to, next backdrop, backdrop (number / name), and on the stage switch backdrop to and wait, as in Scratch |
| Camera (new) | make this sprite the camera; set view to (home, top, front, side); set / change camera zoom |
| Events | when I touch (a sprite, or my own clones); when backdrop switches to, and on the stage when stage clicked (a click where there is no sprite), as in Scratch |
| Sensing | touched sprite (a sprite reference); "of" for another sprite's properties and sprite-only variables |
| Pen | lines drawn in space; draw cube, draw sphere (wireframes); stamp leaves a copy of the shape |

Changed meanings:

- **"touching color"** means touching a sprite of that color, because a 3D
  view has no single picture to sample pixels from.
- **Pen size** is a width in space, in stage units (size 1 is 1 unit, as a
  pixel of Scratch's stage), so lines look thinner further away, like the
  shapes around them. They stay at least 1.5 pixels wide on the screen so
  they don't vanish. The pen color's parts (color, saturation, brightness,
  transparency) are as in Scratch.
- **"stamp"** leaves a copy of the sprite's costume, color and pose, even when
  the sprite is hidden (so a hidden sprite can stamp). Stamps are not
  sprites: they don't move, aren't touched, and "erase all" removes them.
- **"touching"** tests the real shapes in 3D, and **"distance to"** measures
  between centers in 3D. "Touching", the edge and physics all use the shape
  as stretched by width, depth and height.
- **Sprite references.** Some reporters return a sprite (or clone) rather
  than its name. As text a reference reads as the sprite's name.

The camera is a sprite (`app/src/engine/camera.ts`):

- **"Make this sprite the camera"** shows the view from the sprite's center
  along its forward axis, rolled with it, and doesn't draw that sprite (it
  still touches things). Moving and turning the sprite moves and turns the
  camera, so the motion blocks are the camera blocks, and the camera's
  position is a sprite's, saved with the project. A first-person view is the
  player sprite as the camera; a third-person view is a camera sprite that
  chases the player ("point towards", "move", "go to"). A deleted clone
  stops being the camera.
- **"Set view to"** puts the camera at one of the stage's view buttons'
  views; it and the buttons stop a sprite being the camera.
- **Zoom** is a field of view: 100% is 45°, 200% shows things twice as big
  (10–1000%). Setting a view resets it.
- While a sprite is the camera, the viewer can't orbit. Stopping (and the
  green flag, which stops first) goes back to the viewer's camera as it was,
  at zoom 100%. Opening another project does the same.
- Considered and dropped (2026-10-24): camera blocks with a position and a
  target of their own, and following a sprite from behind. Making a sprite
  the camera covers both with blocks children already know.
- Later: attaching a camera sprite to another sprite (links) for a view that
  stays behind it.

How blocks are split (motion, looks, camera): frequently used and core
blocks are separate blocks, so they can be found in the palette and read as
verbs (position, the turns). Finer variants that are used less go in one
block with a menu (width, depth and height). Reporters are always separate,
each with its own monitor checkbox.

Variables and lists can belong to all sprites or to one sprite, as in
Scratch, and monitors show them on the stage.

The stage has scripts of its own, as in Scratch, and its palette has only
what makes sense without a body: no motion; in looks, only the backdrop
blocks; "erase all" of the pen; the camera's views and zoom; "create clone
of" a sprite; no "touching" or "distance"; its variables are for all
sprites. Extension blocks are left out, as they act on sprites.

## 5. The editor

- **Layout.** Scratch's layout: block palette and code area on the left, and
  the stage and sprite list on the right, with the stage beside the sprite
  list. Selecting the stage shows its scripts and a Backdrops tab, where
  backdrops are chosen (the chosen one becomes current, as in Scratch),
  added (uploaded or plain), renamed, deleted and changed, a picture at a
  time, with a 360° image from the scenery library or uploaded, and a room
  from the room library. Selecting a sprite shows its scripts and a
  Costumes tab, which does the same for its costumes. The editor is
  designed for computers with a mouse and keyboard; tablets work too,
  without a layout of their own.
- **Choosing first.** The audience is small children, so adding things
  starts from libraries of pictures. The sprite list, the costume list and
  the backdrop list each have a round "+" button with the same menu of
  icons: choose (a library over the whole editor), paint, upload, and new.
  The sprite library has the costume library's models and pictured shapes,
  and the plain shapes, in categories (animals, people, vehicles, space,
  nature, food, things, shapes); a sprite chosen is named after it and
  stands on the floor, and the library's children come with walking
  costumes. The backdrop library makes a new backdrop of scenery or a room.
  Upload takes a picture or a 3D model, told apart by the file. Costumes
  are shown as they look on the stage, drawn in 3D (`app/src/ui/costumeThumbnails.ts`),
  and the library's models' animations and bones have translated names.
- **Few fields.** A sprite's information is its name and whether it
  shows, and below them x, y and z (kept together on one row, as they are
  read together, with their labels above them), direction and size. Like Scratch's direction, which pops up a dial, the direction pops
  up three dials when edited: direction seen from above, pitch seen from
  the side and roll seen from behind, each turned by dragging its knob (or
  with the arrow keys); the size pops up sliders for it and for width,
  depth and height (see Width, depth and height), which reach 5–500%
  (the fields take more). What a sprite looks like is in its Costumes
  tab, laid out as Scratch's: a costume's settings in a band at the top
  (name, shape and how a picture wraps it, chosen with picture buttons,
  the color, one for the sprite as the "set color" block sets it, width,
  depth and height, and whether the editor's guide shows; places that
  don't apply, such as a sphere's wrapping, stay empty so the band never
  moves), and the picture editor below (a picture is
  uploaded as a new costume, from the "+" menu, and cleared with the
  editor's Clear); a model costume shows the model large, with its
  pose. Adding a costume to paint adds one without a picture. A backdrop's form shows the scenery and the room
  as two big cards, chosen by pressing their pictures; each face's color
  and picture are under "More".
- **3D handling, Tinkercad style.** Drag a sprite to move it on its height
  plane. Drag the cone above the selected sprite to change its height.
  Dragging empty space orbits the camera, Shift+drag pans and the wheel zooms.
  The home button and the top, front and side buttons reset the camera.
  On a touch screen one finger does what the mouse does, and two fingers
  pinch to zoom and pan, even when the first one landed on a sprite (its
  drag stops). A finger moves farther before a press becomes a drag, and
  presses the height cone when near it (a sprite under it comes first).
  Popups stay open while their sliders are used, though those take no
  focus on touch screens and in Safari.
- **Words for children.** The interface keeps Scratch's words children
  know (sprite, costume, extensions) and avoids grown-ups' ones: "throw
  away" rather than "discard", "room" rather than "interior", squares
  rather than a grid, short notes that speak to the child.
- **Full screen** fills the window like Scratch's, keeping the stage's aspect
  ratio. It is for playing: sprites can be clicked but not moved, while the
  camera still orbits.
- **Saving.** The project is autosaved in the browser: its JSON in
  localStorage and its assets in IndexedDB (Scratch keeps assets only in
  memory until saving; this editor saves as you go). It can be saved to and
  opened from a `.beecube` file, a zip as Scratch's: `project.json` (format
  in `app/src/engine/project.ts`) and each asset it uses, named
  `<sha-256>.<format>` (`app/src/ui/projectFile.ts`). Older files, the JSON
  alone, still open. Shared projects keep their pictures per project (see
  [sharing.md](sharing.md)), unlike Scratch's asset server, which keeps
  them for everyone.

## 6. Extensions

An extension is data plus functions: its blocks, their text in each
language, and the code they run (`app/src/engine/extension.ts`). Built-in
extensions are added from the menu bar, as in Scratch. The first is physics
([Rapier](https://rapier.rs)), which is loaded only by projects that use it.

## 7. Audience: children

Made for children, not only for them: anyone can use it, and what follows
keeps it safe for the youngest.

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
- **Support** from grown-ups goes through Buy Me a Coffee (`SUPPORT_URL` in
  `app/src/brand.ts`): a section of the About page with a button, and a link
  to it under the player. It is a plain link, so the site loads nothing from
  there, and it stays out of the editor.

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
