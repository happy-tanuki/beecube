// The costume library's pictures, drawn in a browser (see
// make-costume-library.mjs). Each is laid out as src/engine/costume.ts
// says: a net on a grid of 4 × 3 squares, the same picture on every side,
// or a globe (equirectangular, twice as wide as tall) for a sphere.
//
// Pictures from elsewhere (NASA's maps, public domain) are passed in as
// images by name.

const NET_W = 1024
const NET_H = 768
const CELL = 256

function canvas(width, height) {
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  return [c, c.getContext('2d')]
}

function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A cube's net: the squares of its faces, as [column, row]. */
const CUBE = { top: [1, 0], right: [0, 1], front: [1, 1], left: [2, 1], back: [3, 1], bottom: [1, 2] }

/** Draws each face of a cube's net with `draw(g, name)`, in a square of CELL from (0, 0). */
function cubeNet(draw) {
  const [c, g] = canvas(NET_W, NET_H)
  for (const [name, [col, row]] of Object.entries(CUBE)) {
    g.save()
    g.translate(col * CELL, row * CELL)
    g.beginPath()
    g.rect(0, 0, CELL, CELL)
    g.clip()
    draw(g, name)
    g.restore()
  }
  return c
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath()
  g.roundRect(x, y, w, h, r)
}

// ---- cubes -------------------------------------------------------------------

/** Pips of a die: opposite faces add up to 7. */
const PIPS = { front: 1, back: 6, top: 2, bottom: 5, right: 3, left: 4 }
const PIP_AT = {
  1: [[0.5, 0.5]],
  2: [[0.27, 0.27], [0.73, 0.73]],
  3: [[0.27, 0.27], [0.5, 0.5], [0.73, 0.73]],
  4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
  5: [[0.27, 0.27], [0.73, 0.27], [0.5, 0.5], [0.27, 0.73], [0.73, 0.73]],
  6: [[0.27, 0.25], [0.73, 0.25], [0.27, 0.5], [0.73, 0.5], [0.27, 0.75], [0.73, 0.75]],
}

function dice() {
  return cubeNet((g, face) => {
    g.fillStyle = '#fbfbf7'
    g.fillRect(0, 0, CELL, CELL)
    const edge = g.createRadialGradient(CELL / 2, CELL / 2, CELL * 0.35, CELL / 2, CELL / 2, CELL * 0.75)
    edge.addColorStop(0, 'rgba(0,0,0,0)')
    edge.addColorStop(1, 'rgba(60,60,80,0.18)')
    g.fillStyle = edge
    g.fillRect(0, 0, CELL, CELL)
    const n = PIPS[face]
    for (const [x, y] of PIP_AT[n]) {
      g.fillStyle = n === 1 ? '#d42a2a' : '#222'
      g.beginPath()
      g.arc(x * CELL, y * CELL, n === 1 ? 30 : 22, 0, Math.PI * 2)
      g.fill()
    }
  })
}

function bee() {
  return cubeNet((g, face) => {
    g.fillStyle = '#ffc61a'
    g.fillRect(0, 0, CELL, CELL)
    if (face === 'front') {
      // A face.
      for (const x of [0.32, 0.68]) {
        g.fillStyle = '#fff'
        g.beginPath()
        g.ellipse(x * CELL, 0.42 * CELL, 30, 36, 0, 0, Math.PI * 2)
        g.fill()
        g.fillStyle = '#222'
        g.beginPath()
        g.arc(x * CELL + 6, 0.44 * CELL, 17, 0, Math.PI * 2)
        g.fill()
        g.fillStyle = '#fff'
        g.beginPath()
        g.arc(x * CELL + 11, 0.4 * CELL, 6, 0, Math.PI * 2)
        g.fill()
      }
      g.strokeStyle = '#222'
      g.lineWidth = 9
      g.lineCap = 'round'
      g.beginPath()
      g.arc(CELL / 2, 0.6 * CELL, 40, 0.2 * Math.PI, 0.8 * Math.PI)
      g.stroke()
      g.fillStyle = 'rgba(255,120,120,0.55)'
      for (const x of [0.18, 0.82]) {
        g.beginPath()
        g.ellipse(x * CELL, 0.62 * CELL, 20, 13, 0, 0, Math.PI * 2)
        g.fill()
      }
    } else if (face === 'back') {
      // The end of the body, with a sting.
      for (const [r, color] of [[80, '#2a2a2a'], [50, '#ffc61a'], [18, '#2a2a2a']]) {
        g.fillStyle = color
        g.beginPath()
        g.arc(CELL / 2, CELL / 2, r, 0, Math.PI * 2)
        g.fill()
      }
    } else {
      // Stripes round the body, which runs from the front to the back: placed
      // evenly, they meet across the edges whichever way each face is turned.
      g.fillStyle = '#2a2a2a'
      for (const k of [0.25, 0.59]) {
        if (face === 'top' || face === 'bottom') g.fillRect(0, k * CELL, CELL, 0.16 * CELL)
        else g.fillRect(k * CELL, 0, 0.16 * CELL, CELL)
      }
      if (face === 'top') {
        // Wings, and the antennae at the front edge (the bottom of this square).
        g.fillStyle = 'rgba(255,255,255,0.85)'
        g.strokeStyle = '#8fb8de'
        g.lineWidth = 5
        for (const x of [0.3, 0.7]) {
          g.beginPath()
          g.ellipse(x * CELL, 0.42 * CELL, 52, 78, x < 0.5 ? -0.35 : 0.35, 0, Math.PI * 2)
          g.fill()
          g.stroke()
        }
        g.strokeStyle = '#222'
        g.lineWidth = 8
        g.lineCap = 'round'
        for (const x of [0.38, 0.62]) {
          g.beginPath()
          g.moveTo(x * CELL, CELL)
          g.lineTo(x * CELL + (x < 0.5 ? -18 : 18), CELL - 50)
          g.stroke()
        }
      }
    }
  })
}

function present() {
  const [c, g] = canvas(512, 512)
  g.fillStyle = '#e8384f'
  g.fillRect(0, 0, 512, 512)
  g.fillStyle = 'rgba(255,255,255,0.18)'
  for (let x = -512; x < 512; x += 64) {
    g.beginPath()
    g.moveTo(x, 512)
    g.lineTo(x + 32, 512)
    g.lineTo(x + 544, 0)
    g.lineTo(x + 512, 0)
    g.fill()
  }
  g.fillStyle = '#ffd23f'
  g.fillRect(226, 0, 60, 512)
  g.fillRect(0, 226, 512, 60)
  g.fillStyle = 'rgba(0,0,0,0.12)'
  g.fillRect(226, 0, 6, 512)
  g.fillRect(0, 226, 512, 6)
  return c
}

function crate() {
  const [c, g] = canvas(512, 512)
  const rnd = random(3)
  // Planks across, with grain.
  for (let y = 0; y < 512; y += 64) {
    const base = 150 + rnd() * 30
    g.fillStyle = `rgb(${base + 40},${base - 5},${base - 70})`
    g.fillRect(0, y, 512, 64)
    for (let k = 0; k < 14; k++) {
      g.strokeStyle = `rgba(90,50,20,${0.08 + rnd() * 0.12})`
      g.lineWidth = 1 + rnd() * 2
      g.beginPath()
      const yy = y + 4 + rnd() * 56
      g.moveTo(0, yy)
      g.bezierCurveTo(170, yy + rnd() * 8 - 4, 340, yy + rnd() * 8 - 4, 512, yy + rnd() * 6 - 3)
      g.stroke()
    }
    g.fillStyle = 'rgba(60,30,10,0.45)'
    g.fillRect(0, y, 512, 3)
  }
  // The frame and a brace.
  const frame = (draw) => {
    g.save()
    g.fillStyle = '#a8703c'
    g.strokeStyle = 'rgba(60,30,10,0.55)'
    g.lineWidth = 4
    draw()
    g.fill()
    g.stroke()
    g.restore()
  }
  frame(() => {
    g.beginPath()
    g.moveTo(40, 470)
    g.lineTo(90, 470)
    g.lineTo(472, 88)
    g.lineTo(472, 40)
    g.lineTo(422, 40)
    g.lineTo(40, 422)
    g.closePath()
  })
  frame(() => {
    g.beginPath()
    g.rect(0, 0, 512, 44)
    g.rect(0, 468, 512, 44)
    g.rect(0, 44, 44, 424)
    g.rect(468, 44, 44, 424)
  })
  g.fillStyle = '#5b5f66'
  for (const [x, y] of [[22, 22], [490, 22], [22, 490], [490, 490]]) {
    g.beginPath()
    g.arc(x, y, 7, 0, Math.PI * 2)
    g.fill()
  }
  return c
}

function bricks() {
  const [c, g] = canvas(512, 512)
  const rnd = random(5)
  g.fillStyle = '#d8d2c4'
  g.fillRect(0, 0, 512, 512)
  const h = 512 / 8
  const w = 512 / 4
  for (let row = 0; row < 8; row++) {
    const shift = row % 2 ? w / 2 : 0
    for (let k = -1; k < 5; k++) {
      const x = k * w + shift
      const r = 160 + rnd() * 40
      g.fillStyle = `rgb(${r},${60 + rnd() * 25},${45 + rnd() * 20})`
      roundRect(g, x + 4, row * h + 4, w - 8, h - 8, 4)
      g.fill()
      g.fillStyle = 'rgba(255,255,255,0.08)'
      g.fillRect(x + 6, row * h + 6, w - 12, 8)
    }
  }
  return c
}

function grass() {
  const rnd = random(9)
  const dirt = (g) => {
    g.fillStyle = '#8a5a35'
    g.fillRect(0, 0, CELL, CELL)
    for (let k = 0; k < 220; k++) {
      g.fillStyle = rnd() < 0.5 ? '#6f4526' : '#a06c43'
      g.fillRect(Math.floor(rnd() * 16) * 16, Math.floor(rnd() * 16) * 16, 16, 16)
    }
  }
  const green = (g, x, y, w, h) => {
    g.fillStyle = '#5fae3a'
    g.fillRect(x, y, w, h)
    for (let k = 0; k < (w * h) / 900; k++) {
      g.fillStyle = rnd() < 0.5 ? '#4e9a2e' : '#72c24a'
      g.fillRect(x + Math.floor((rnd() * w) / 16) * 16, y + Math.floor((rnd() * h) / 16) * 16, 16, 16)
    }
  }
  return cubeNet((g, face) => {
    if (face === 'top') return green(g, 0, 0, CELL, CELL)
    dirt(g)
    if (face === 'bottom') return
    // Grass hangs over the top of each side.
    green(g, 0, 0, CELL, 48)
    for (let x = 0; x < CELL; x += 16) if (rnd() < 0.5) green(g, x, 48, 16, 16 * (1 + Math.floor(rnd() * 2)))
  })
}

// ---- spheres -----------------------------------------------------------------

function beachBall() {
  const [c, g] = canvas(1024, 512)
  const colors = ['#ff4d4d', '#ffffff', '#3d8bff', '#ffffff', '#ffd23f', '#ffffff']
  colors.forEach((color, k) => {
    g.fillStyle = color
    g.fillRect((k * 1024) / colors.length, 0, 1024 / colors.length + 1, 512)
  })
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, 1024, 40)
  g.fillRect(0, 472, 1024, 40)
  return c
}

function watermelon() {
  const [c, g] = canvas(1024, 512)
  const rnd = random(11)
  g.fillStyle = '#3f8f2c'
  g.fillRect(0, 0, 1024, 512)
  for (let k = 0; k < 16; k++) {
    const x0 = (k * 1024) / 16
    g.fillStyle = '#1f5a1b'
    g.beginPath()
    g.moveTo(x0, 0)
    for (let y = 0; y <= 512; y += 16) g.lineTo(x0 + Math.sin(y / 40 + k) * 10 + rnd() * 6 - 18, y)
    for (let y = 512; y >= 0; y -= 16) g.lineTo(x0 + Math.sin(y / 40 + k) * 10 + rnd() * 6 + 18, y)
    g.fill()
  }
  return c
}

/** A map from elsewhere, scaled to a sphere's picture. */
function map(image) {
  const [c, g] = canvas(1024, 512)
  g.imageSmoothingQuality = 'high'
  g.drawImage(image, 0, 0, 1024, 512)
  return c
}

// ---- cylinders and cones -------------------------------------------------------

/** A cylinder's or a cone's end: a circle in the middle of a row of the net (engine/costume.ts). */
function end(g, row, draw) {
  g.save()
  g.beginPath()
  g.arc(NET_W / 2, (row + 0.5) * CELL, CELL / 2, 0, Math.PI * 2)
  g.clip()
  g.translate(NET_W / 2 - CELL / 2, row * CELL)
  draw()
  g.restore()
}

function can() {
  const [c, g] = canvas(NET_W, NET_H)
  // The side: the middle row, all the way round.
  const y0 = CELL
  g.fillStyle = '#d81e2c'
  g.fillRect(0, y0, NET_W, CELL)
  g.fillStyle = '#ffffff'
  g.beginPath()
  g.moveTo(0, y0 + 150)
  for (let x = 0; x <= NET_W; x += 8) g.lineTo(x, y0 + 150 + Math.sin((x / NET_W) * Math.PI * 4) * 26)
  for (let x = NET_W; x >= 0; x -= 8) g.lineTo(x, y0 + 172 + Math.sin((x / NET_W) * Math.PI * 4) * 26)
  g.fill()
  g.font = 'bold 72px sans-serif'
  g.textAlign = 'center'
  g.fillText('POP!', NET_W / 2, y0 + 110)
  g.fillText('POP!', 0, y0 + 110)
  g.fillText('POP!', NET_W, y0 + 110)
  const metal = (g) => {
    const shine = g.createLinearGradient(0, 0, CELL, CELL)
    shine.addColorStop(0, '#f2f4f7')
    shine.addColorStop(1, '#9aa1ab')
    g.fillStyle = shine
    g.fillRect(0, 0, CELL, CELL)
    g.strokeStyle = 'rgba(80,85,95,0.6)'
    g.lineWidth = 6
    g.beginPath()
    g.arc(CELL / 2, CELL / 2, CELL / 2 - 14, 0, Math.PI * 2)
    g.stroke()
  }
  for (const y of [y0, y0 + CELL - 14]) {
    g.fillStyle = 'rgba(220,225,232,0.9)'
    g.fillRect(0, y, NET_W, 14)
  }
  end(g, 0, () => {
    metal(g)
    // The ring pull, towards the front (the bottom of this square).
    g.fillStyle = '#c3c8cf'
    g.strokeStyle = '#7d848e'
    g.lineWidth = 5
    roundRect(g, CELL / 2 - 30, CELL / 2 + 10, 60, 80, 24)
    g.fill()
    g.stroke()
    g.fillStyle = '#5c626b'
    roundRect(g, CELL / 2 - 14, CELL / 2 + 40, 28, 34, 12)
    g.fill()
  })
  end(g, 2, () => metal(g))
  return c
}

function trafficCone() {
  const [c, g] = canvas(NET_W, NET_H)
  // The side: the top two rows, the tip along the top edge.
  g.fillStyle = '#ff6a1a'
  g.fillRect(0, 0, NET_W, CELL * 2)
  g.fillStyle = '#ffffff'
  g.fillRect(0, CELL * 0.55, NET_W, CELL * 0.28)
  g.fillRect(0, CELL * 1.15, NET_W, CELL * 0.32)
  const shade = g.createLinearGradient(0, 0, NET_W, 0)
  for (let k = 0; k <= 8; k++) shade.addColorStop(k / 8, k % 2 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.06)')
  g.fillStyle = shade
  g.fillRect(0, 0, NET_W, CELL * 2)
  end(g, 2, () => {
    g.fillStyle = '#333'
    g.fillRect(0, 0, CELL, CELL)
  })
  return c
}

/** The library: key → shape, layout, and the drawing (given the images from elsewhere). */
export const COSTUMES = {
  dice: { shape: 'cube', layout: 'net', draw: dice },
  bee: { shape: 'cube', layout: 'net', draw: bee },
  present: { shape: 'cube', layout: 'same', draw: present },
  crate: { shape: 'cube', layout: 'same', draw: crate },
  bricks: { shape: 'cube', layout: 'same', draw: bricks },
  grass: { shape: 'cube', layout: 'net', draw: grass },
  earth: { shape: 'sphere', layout: 'same', draw: (images) => map(images.earth) },
  moon: { shape: 'sphere', layout: 'same', draw: (images) => map(images.moon) },
  beachBall: { shape: 'sphere', layout: 'same', draw: beachBall },
  watermelon: { shape: 'sphere', layout: 'same', draw: watermelon },
  can: { shape: 'cylinder', layout: 'net', draw: can },
  trafficCone: { shape: 'cone', layout: 'net', draw: trafficCone },
}

/** Maps from NASA (public domain), by the name the drawings use. */
export const MAPS = {
  // Blue Marble: land with shallow topography (NASA Earth Observatory).
  earth: 'https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57752/land_shallow_topo_2048.jpg',
  // The Moon's color, from the Lunar Reconnaissance Orbiter (NASA's Scientific Visualization Studio, CGI Moon Kit).
  moon: 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_1k.jpg',
}

export function drawCostume(key, images) {
  return COSTUMES[key].draw(images)
}

/** Kenney's kits (CC0) the library's 3D models come from. */
export const KITS = {
  'cube-pets': 'https://kenney.nl/media/pages/assets/cube-pets/44e58e945f-1774520254/kenney_cube-pets_1.0.zip',
  'mini-characters': 'https://kenney.nl/media/pages/assets/mini-characters/bfc7e272b4-1774770718/kenney_mini-characters.zip',
  'car-kit': 'https://kenney.nl/media/pages/assets/car-kit/1a312ec241-1775131960/kenney_car-kit.zip',
  'space-kit': 'https://kenney.nl/media/pages/assets/space-kit/20874c75ac-1677698978/kenney_space-kit.zip',
  'nature-kit': 'https://kenney.nl/media/pages/assets/nature-kit/37ac38a37b-1677698939/kenney_nature-kit.zip',
  'food-kit': 'https://kenney.nl/media/pages/assets/food-kit/83086fa91c-1719418518/kenney_food-kit.zip',
}

/**
 * The library's 3D models: key → the kit, the file in it, and whether it
 * faces backwards (glTF's -z; the space kit's do), to be turned round.
 */
export const MODELS = {
  cat: ['cube-pets', 'Models/GLB format/animal-cat.glb'],
  dog: ['cube-pets', 'Models/GLB format/animal-dog.glb'],
  bunny: ['cube-pets', 'Models/GLB format/animal-bunny.glb'],
  panda: ['cube-pets', 'Models/GLB format/animal-panda.glb'],
  penguin: ['cube-pets', 'Models/GLB format/animal-penguin.glb'],
  chick: ['cube-pets', 'Models/GLB format/animal-chick.glb'],
  girl: ['mini-characters', 'Models/GLB format/character-female-a.glb'],
  boy: ['mini-characters', 'Models/GLB format/character-male-a.glb'],
  car: ['car-kit', 'Models/GLB format/taxi.glb'],
  police: ['car-kit', 'Models/GLB format/police.glb'],
  fireTruck: ['car-kit', 'Models/GLB format/firetruck.glb'],
  raceCar: ['car-kit', 'Models/GLB format/race.glb'],
  spaceship: ['space-kit', 'Models/GLTF format/craft_speederA.glb', 'backwards'],
  alien: ['space-kit', 'Models/GLTF format/alien.glb', 'backwards'],
  astronaut: ['space-kit', 'Models/GLTF format/astronautA.glb', 'backwards'],
  rover: ['space-kit', 'Models/GLTF format/rover.glb', 'backwards'],
  tree: ['nature-kit', 'Models/GLTF format/tree_default.glb'],
  pineTree: ['nature-kit', 'Models/GLTF format/tree_pineDefaultA.glb'],
  flower: ['nature-kit', 'Models/GLTF format/flower_redA.glb'],
  apple: ['food-kit', 'Models/GLB format/apple.glb'],
  burger: ['food-kit', 'Models/GLB format/burger.glb'],
  cake: ['food-kit', 'Models/GLB format/cake-birthday.glb'],
  donut: ['food-kit', 'Models/GLB format/donut-sprinkles.glb'],
  pizza: ['food-kit', 'Models/GLB format/pizza.glb'],
}
