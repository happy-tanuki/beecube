# Library pictures

## Scenery

Each entry in the scenery library is a 360° image, re-encoded by
`scripts/make-scenery-library.mjs` as the editor re-encodes one a user
adds; files are named by the SHA-256 of their contents, as project assets
are. The list, with the sky's color taken from each image, is in
`src/ui/sceneryLibrary.json`.

The 360° images are from [Poly Haven](https://polyhaven.com), released under
[CC0](https://creativecommons.org/publicdomain/zero/1.0/) (the tonemapped JPG
of each):

| Scenery | Poly Haven image | Author |
| --- | --- | --- |
| meadow | [Meadow 2](https://polyhaven.com/a/meadow_2) | Sergej Majboroda |
| beach | [Spiaggia di Mondello](https://polyhaven.com/a/spiaggia_di_mondello) | Andreas Mischok |
| desert | [Goegap](https://polyhaven.com/a/goegap) | Greg Zaal |

The moon is drawn for BeeCube by `scripts/moon.js`, through the same script.

## Rooms

Each entry in the room library is a picture for each of the six faces of the
stage's box, drawn by `scripts/make-room-library.mjs` (the drawing is in
`scripts/rooms.js`) and re-encoded as the editor re-encodes a picture a user
puts on a face. The list is in `src/ui/roomLibrary.json`.

The rooms are drawn for BeeCube, over these textures from
[Poly Haven](https://polyhaven.com), released under
[CC0](https://creativecommons.org/publicdomain/zero/1.0/) (the 1k diffuse
map of each):

| Texture | Author | Used for |
| --- | --- | --- |
| [Laminate Floor 02](https://polyhaven.com/a/laminate_floor_02) | Charlotte Baglioni, Dario Barresi | the living room's floor, the doors and the cubbies |
| [Wood Floor](https://polyhaven.com/a/wood_floor) | Dimitrios Savva | the classroom's floor |
| [Plastered Wall 04](https://polyhaven.com/a/plastered_wall_04) | Rob Tuytel | the grain of painted walls and ceilings |
