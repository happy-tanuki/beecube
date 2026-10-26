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

## Costumes

Each entry in the costume library is a picture on one of the shapes or a 3D
model, made by `scripts/make-costume-library.mjs`. The pictures are drawn by
`scripts/costumes.js` and re-encoded as the editor re-encodes a picture a
user uploads for a costume. The list, with each one's shape and how its
picture wraps it, is in `src/ui/costumeLibrary.json`.

The costumes are drawn for BeeCube, except the Earth and the Moon, which are
NASA's maps (public domain), scaled down:

| Costume | Map |
| --- | --- |
| earth | [Blue Marble: Land Surface, Shallow Water, and Shaded Topography](https://visibleearth.nasa.gov/images/57752/blue-marble-land-surface-shallow-water-and-shaded-topography) (NASA Earth Observatory) |
| moon | [CGI Moon Kit](https://svs.gsfc.nasa.gov/4720) color map (NASA's Scientific Visualization Studio, from the Lunar Reconnaissance Orbiter) |

The 3D models are from [Kenney](https://kenney.nl)'s kits, released under
[CC0](https://creativecommons.org/publicdomain/zero/1.0/), each re-exported
as one binary glTF file with its textures inside (and the space kit's turned
to face +z, as the others do; models with skeletons keep their animations,
to make poses from):

| Kit | Models |
| --- | --- |
| [Cube Pets](https://kenney.nl/assets/cube-pets) | cat, dog, bunny, panda, penguin, chick |
| [Mini Characters](https://kenney.nl/assets/mini-characters) | girl, boy |
| [Car Kit](https://kenney.nl/assets/car-kit) | car, police car, fire truck, race car |
| [Space Kit](https://kenney.nl/assets/space-kit) | spaceship, alien, astronaut, rover |
| [Nature Kit](https://kenney.nl/assets/nature-kit) | tree, pine tree, flower |
| [Food Kit](https://kenney.nl/assets/food-kit) | apple, burger, cake, donut, pizza |
