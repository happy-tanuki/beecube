// The rooms of the room library, drawn on canvases in a browser (see
// make-room-library.mjs). Each room draws the six faces of the stage's
// box, at the size of a face's picture: 2 pixels a unit, as a centimeter
// (a sprite of 100 is about a child's height). Walls are drawn with the
// floor at the bottom; the floor with the back at the top. Windows are
// transparent, so the scenery shows through them.

const PX = 2
const STAGE = { width: 480, depth: 360, wall: 360 }
const SIZE = {
  floor: [STAGE.width, STAGE.depth],
  ceiling: [STAGE.width, STAGE.depth],
  back: [STAGE.width, STAGE.wall],
  front: [STAGE.width, STAGE.wall],
  left: [STAGE.depth, STAGE.wall],
  right: [STAGE.depth, STAGE.wall],
}

/** The same drawing every time. */
function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A face to draw on, in centimeters: x from the left, y up from the floor
 * on walls (from the front on the floor and the ceiling).
 */
class Face {
  constructor(name, textures) {
    const [w, h] = SIZE[name]
    this.w = w
    this.h = h
    this.canvas = document.createElement('canvas')
    this.canvas.width = w * PX
    this.canvas.height = h * PX
    this.g = this.canvas.getContext('2d')
    this.g.setTransform(PX, 0, 0, -PX, 0, h * PX)
    this.textures = textures
  }

  rect(x, y, w, h, fill) {
    this.g.fillStyle = fill
    this.g.fillRect(x, y, w, h)
  }

  /** A texture repeated over a rectangle, one repeat being `size` centimeters (as photographed). */
  texture(name, size, x = 0, y = 0, w = this.w, h = this.h, { alpha = 1, mode = 'source-over' } = {}) {
    const image = this.textures[name]
    const pattern = this.g.createPattern(image, 'repeat')
    pattern.setTransform(new DOMMatrix().scale(size / image.width, -size / image.height))
    this.g.save()
    this.g.globalAlpha = alpha
    this.g.globalCompositeOperation = mode
    this.g.fillStyle = pattern
    this.g.fillRect(x, y, w, h)
    this.g.restore()
  }

  /** A painted surface: a color with the texture of plaster under it. */
  paint(color, x = 0, y = 0, w = this.w, h = this.h) {
    this.rect(x, y, w, h, color)
    this.texture('plastered_wall_04', 180, x, y, w, h, { alpha: 0.35, mode: 'soft-light' })
  }

  gradient(x0, y0, x1, y1, stops) {
    const gr = this.g.createLinearGradient(x0, y0, x1, y1)
    for (const [at, color] of stops) gr.addColorStop(at, color)
    return gr
  }

  /** Darker towards the edges, where the face meets the others (the walls' color isn't lit). */
  corners({ bottom = 0.22, top = 0.1, sides = 0.16 } = {}) {
    const { w, h } = this
    const edge = (x0, y0, x1, y1, a, x, y, ww, hh) =>
      this.rect(x, y, ww, hh, this.gradient(x0, y0, x1, y1, [[0, `rgba(0,0,0,${a})`], [1, 'rgba(0,0,0,0)']]))
    edge(0, 0, 0, 30, bottom, 0, 0, w, 30)
    edge(0, h, 0, h - 30, top, 0, h - 30, w, 30)
    edge(0, 0, 40, 0, sides, 0, 0, 40, h)
    edge(w, 0, w - 40, 0, sides, w - 40, 0, 40, h)
  }

  /** A hole the scenery shows through, with a little glass in it. */
  glass(x, y, w, h) {
    this.g.clearRect(x, y, w, h)
    this.rect(x, y, w, h, 'rgba(210,235,255,0.12)')
  }

  circle(x, y, r, fill) {
    this.g.beginPath()
    this.g.arc(x, y, r, 0, Math.PI * 2)
    this.g.fillStyle = fill
    this.g.fill()
  }

  roundRect(x, y, w, h, r, fill) {
    this.g.beginPath()
    this.g.roundRect(x, y, w, h, r)
    this.g.fillStyle = fill
    this.g.fill()
  }

  line(x0, y0, x1, y1, width, stroke) {
    this.g.beginPath()
    this.g.moveTo(x0, y0)
    this.g.lineTo(x1, y1)
    this.g.lineWidth = width
    this.g.strokeStyle = stroke
    this.g.stroke()
  }

  /** A soft shadow under a thing on the wall, as if lit from above. */
  shadow(x, y, w, h) {
    this.g.save()
    this.g.filter = 'blur(3px)'
    this.rect(x + 1.5, y - 3, w, h, 'rgba(0,0,0,0.18)')
    this.g.restore()
  }
}

// Things in more than one room.

/** A window in a frame, with a sill; `bars` divide it. */
function window_(f, x, y, w, h, { frame = '#ffffff', width = 6, bars = [], rows = [] } = {}) {
  f.shadow(x - width, y - width, w + 2 * width, h + 2 * width)
  f.rect(x - width, y - width, w + 2 * width, h + 2 * width, frame)
  f.glass(x, y, w, h)
  for (const at of bars) f.rect(x + w * at - width / 3, y, (width * 2) / 3, h, frame)
  for (const at of rows) f.rect(x, y + h * at - width / 3, w, (width * 2) / 3, frame)
  f.rect(x - width - 6, y - width - 4, w + 2 * width + 12, 5, frame)
  f.rect(x - width - 6, y - width - 5, w + 2 * width + 12, 1, 'rgba(0,0,0,0.15)')
}

/** A curtain hanging in folds, from `top` down to `bottom`. */
function curtain(f, x, w, bottom, top, color) {
  f.rect(x, bottom, w, top - bottom, color)
  const folds = Math.max(3, Math.round(w / 9))
  for (let i = 0; i < folds; i++) {
    const fx = x + (w * i) / folds
    const fw = w / folds
    f.rect(fx, bottom, fw, top - bottom, f.gradient(fx, 0, fx + fw, 0, [[0, 'rgba(0,0,0,0.18)'], [0.5, 'rgba(255,255,255,0.12)'], [1, 'rgba(0,0,0,0.1)']]))
  }
  f.rect(x, bottom, w, 3, 'rgba(0,0,0,0.12)')
}

function curtainRod(f, x, w, y) {
  f.rect(x, y, w, 2.5, '#6b5440')
  f.circle(x, y + 1.25, 3, '#6b5440')
  f.circle(x + w, y + 1.25, 3, '#6b5440')
}

function door(f, x, w, h, color) {
  f.shadow(x - 6, 0, w + 12, h + 6)
  f.rect(x - 6, 0, w + 12, h + 6, '#f4f1ea')
  f.rect(x, 0, w, h, color)
  f.texture('laminate_floor_02', 170, x, 0, w, h, { alpha: 0.35, mode: 'multiply' })
  for (const [py, ph] of [[18, 80], [h - 95, 80]]) {
    f.rect(x + 12, py, w - 24, ph, 'rgba(0,0,0,0.08)')
    f.rect(x + 14, py + 2, w - 28, ph - 4, color)
    f.texture('laminate_floor_02', 170, x + 14, py + 2, w - 28, ph - 4, { alpha: 0.25, mode: 'multiply' })
  }
  f.circle(x + w - 10, 100, 3.2, '#d9b45a')
  f.circle(x + w - 10.6, 100.6, 1.4, '#f3dc9a')
}

function baseboard(f, color, height = 10) {
  f.rect(0, 0, f.w, height, color)
  f.rect(0, height, f.w, 1, 'rgba(255,255,255,0.35)')
}

/** A picture in a frame: hills under a sky. */
function painting(f, x, y, w, h, rnd) {
  f.shadow(x - 5, y - 5, w + 10, h + 10)
  f.rect(x - 5, y - 5, w + 10, h + 10, '#8a6439')
  f.rect(x - 2, y - 2, w + 4, h + 4, '#f5efe0')
  f.rect(x, y, w, h, f.gradient(0, y + h, 0, y, [[0, '#cfe6f2'], [1, '#7fb6d9']]))
  f.circle(x + w * 0.75, y + h * 0.72, h * 0.12, '#fff2b0')
  for (const [color, base, amp] of [['#8cbf6a', 0.45, 0.12], ['#5f9e4f', 0.28, 0.1]]) {
    f.g.beginPath()
    f.g.moveTo(x, y)
    for (let i = 0; i <= 20; i++) f.g.lineTo(x + (w * i) / 20, y + h * (base + amp * Math.sin(i / 3 + rnd() * 0.4)))
    f.g.lineTo(x + w, y)
    f.g.fillStyle = color
    f.g.fill()
  }
}

// The rooms. Each returns its faces' canvases and their colors (the color
// is under the picture, and shows until it has loaded; null for a face
// with windows, which must stay transparent).

function living(textures) {
  const rnd = random(1)
  const face = (name) => new Face(name, textures)
  const wall = '#efe4d2'
  const curtainColor = '#c7795a'
  const walls = (f) => {
    f.paint(wall)
    baseboard(f, '#8d6a4b')
    f.rect(0, f.h - 6, f.w, 6, '#fbf8f2')
    f.rect(0, f.h - 7, f.w, 1, 'rgba(0,0,0,0.08)')
  }

  const back = face('back')
  walls(back)
  window_(back, 140, 80, 200, 170, { bars: [0.5], rows: [0.7] })
  curtainRod(back, 80, 320, 272)
  curtain(back, 86, 50, 40, 272, curtainColor)
  curtain(back, 344, 50, 40, 272, curtainColor)
  back.corners()

  const left = face('left')
  walls(left)
  window_(left, 110, 90, 140, 150, { bars: [0.5] })
  curtainRod(left, 70, 220, 262)
  curtain(left, 74, 34, 60, 262, curtainColor)
  curtain(left, 252, 34, 60, 262, curtainColor)
  left.corners()

  const right = face('right')
  walls(right)
  door(right, 40, 90, 205, '#b07f52')
  painting(right, 190, 140, 110, 80, rnd)
  right.rect(150, 110, 8, 12, '#fbfaf6')
  right.rect(152.5, 114, 3, 4, '#ddd8cc')
  right.corners()

  const front = face('front')
  walls(front)
  // A shelf of books.
  front.shadow(150, 150, 180, 4)
  for (const y of [150, 205]) {
    front.rect(150, y, 180, 4, '#7a5a3c')
    let x = 156
    while (x < 320) {
      const bw = 5 + rnd() * 6
      const bh = 26 + rnd() * 18
      const hue = Math.floor(rnd() * 360)
      front.rect(x, y + 4, bw, bh, `hsl(${hue} 45% ${40 + rnd() * 20}%)`)
      front.rect(x, y + 4 + bh * 0.75, bw, 2, 'rgba(255,255,255,0.35)')
      x += bw + 0.8 + (rnd() < 0.1 ? 14 : 0)
    }
  }
  painting(front, 60, 140, 60, 80, rnd)
  front.corners()

  const ceiling = face('ceiling')
  ceiling.paint('#f8f5ef')
  const glow = ceiling.g.createRadialGradient(240, 180, 10, 240, 180, 150)
  glow.addColorStop(0, 'rgba(255,248,225,0.9)')
  glow.addColorStop(1, 'rgba(255,248,225,0)')
  ceiling.rect(0, 0, 480, 360, glow)
  ceiling.circle(240, 180, 34, '#e9e4da')
  ceiling.circle(240, 180, 30, '#fffdf6')
  ceiling.corners({ bottom: 0.12, top: 0.12, sides: 0.12 })

  const floor = face('floor')
  floor.texture('laminate_floor_02', 170)
  floor.corners({ bottom: 0.15, top: 0.15, sides: 0.15 })

  return {
    floor: [floor, '#a8875f'],
    ceiling: [ceiling, '#f8f5ef'],
    back: [back, null],
    front: [front, wall],
    left: [left, null],
    right: [right, wall],
  }
}

function classroom(textures) {
  const rnd = random(2)
  const face = (name) => new Face(name, textures)
  const wall = '#eef0e6'
  const walls = (f) => {
    f.paint(wall)
    f.paint('#bcd3c0', 0, 0, f.w, 90)
    f.rect(0, 88, f.w, 5, '#94b19e')
    f.rect(0, 93, f.w, 1, 'rgba(0,0,0,0.08)')
    baseboard(f, '#5c6b62', 8)
  }

  const back = face('back')
  walls(back)
  // The blackboard, with a little written on it.
  back.shadow(66, 86, 348, 128)
  back.rect(66, 86, 348, 128, '#9a7448')
  back.rect(70, 90, 340, 120, '#2f5c47')
  for (let i = 0; i < 40; i++) {
    back.g.save()
    back.g.filter = 'blur(4px)'
    back.rect(70 + rnd() * 320, 90 + rnd() * 100, 20 + rnd() * 40, 6 + rnd() * 10, 'rgba(255,255,255,0.035)')
    back.g.restore()
  }
  back.g.save()
  back.g.lineCap = 'round'
  back.g.lineJoin = 'round'
  const chalk = 'rgba(245,245,235,0.85)'
  back.g.beginPath()
  back.g.arc(130, 160, 22, 0, Math.PI * 2)
  back.g.lineWidth = 1.6
  back.g.strokeStyle = chalk
  back.g.stroke()
  back.g.beginPath()
  back.g.moveTo(180, 138)
  back.g.lineTo(222, 138)
  back.g.lineTo(201, 182)
  back.g.closePath()
  back.g.stroke()
  back.g.strokeRect(245, 140, 40, 40)
  back.g.restore()
  // Text the right way up: in pixels, y down.
  back.g.save()
  back.g.setTransform(1, 0, 0, 1, 0, 0)
  back.g.font = `600 ${20 * PX}px "Chalkboard", "Comic Sans MS", sans-serif`
  back.g.fillStyle = chalk
  back.g.fillText('1 + 2 = 3', 300 * PX, (STAGE.wall - 152) * PX)
  back.g.restore()
  back.rect(66, 82, 348, 5, '#8a6640')
  for (const [x, color] of [[120, '#ffffff'], [128, '#f5d76e'], [300, '#f08a8a']]) back.rect(x, 87, 6, 2, color)
  // The clock.
  back.circle(240.5, 268.5, 19, 'rgba(0,0,0,0.15)')
  back.circle(240, 270, 19, '#3a3a3a')
  back.circle(240, 270, 16.5, '#ffffff')
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    back.line(240 + Math.sin(a) * 13.5, 270 + Math.cos(a) * 13.5, 240 + Math.sin(a) * 15.5, 270 + Math.cos(a) * 15.5, 1, '#333')
  }
  back.line(240, 270, 240 + 7, 270 + 5, 1.6, '#222')
  back.line(240, 270, 240 - 2, 270 + 12, 1.1, '#222')
  back.corners()

  const left = face('left')
  walls(left)
  for (const x of [25, 135, 245]) window_(left, x, 95, 90, 180, { frame: '#c4c9ce', width: 5, rows: [0.55] })
  left.corners()

  const right = face('right')
  walls(right)
  // A sliding door with a small window into the corridor.
  right.shadow(24, 0, 102, 206)
  right.rect(24, 0, 102, 206, '#a9b0a8')
  right.rect(28, 0, 94, 200, '#d0ad80')
  right.texture('laminate_floor_02', 170, 28, 0, 94, 200, { alpha: 0.3, mode: 'multiply' })
  right.rect(48, 120, 54, 60, '#8f9a92')
  right.rect(51, 123, 48, 54, '#dfe9ec')
  right.rect(108, 85, 4, 26, '#6d6d6d')
  // A noticeboard with papers pinned on it.
  right.shadow(160, 120, 170, 100)
  right.rect(160, 120, 170, 100, '#8a6640')
  right.rect(164, 124, 162, 92, '#c79b68')
  right.texture('plastered_wall_04', 120, 164, 124, 162, 92, { alpha: 0.5, mode: 'multiply' })
  for (const [x, y, w, h, color] of [[172, 168, 38, 40, '#ffffff'], [218, 172, 30, 36, '#fff3a8'], [256, 162, 30, 46, '#ffffff'], [294, 170, 26, 34, '#cfe8ff'], [178, 130, 50, 30, '#ffd3d3'], [240, 132, 40, 24, '#ffffff'], [290, 130, 30, 28, '#d8f2c8']]) {
    right.shadow(x, y, w, h)
    right.rect(x, y, w, h, color)
    for (let i = 1; i < 4; i++) right.rect(x + 4, y + h - 5 - i * 6, w - 8, 1, 'rgba(0,0,0,0.18)')
    right.circle(x + w / 2, y + h - 3, 1.6, ['#e04848', '#3b7be0', '#2fae5a'][Math.floor(rnd() * 3)])
  }
  right.corners()

  const front = face('front')
  walls(front)
  // Cubbies, with bags in some.
  front.shadow(20, 0, 440, 112)
  front.rect(20, 0, 440, 112, '#b78c5c')
  front.texture('laminate_floor_02', 170, 20, 0, 440, 112, { alpha: 0.3, mode: 'multiply' })
  for (let row = 0; row < 2; row++)
    for (let col = 0; col < 8; col++) {
      const x = 26 + col * 54
      const y = 6 + row * 52
      front.rect(x, y, 48, 46, '#6e5236')
      if (rnd() < 0.7) {
        const hue = Math.floor(rnd() * 360)
        front.roundRect(x + 6, y, 36, 30 + rnd() * 8, 5, `hsl(${hue} 55% 50%)`)
        front.rect(x + 6, y + 18, 36, 2, 'rgba(0,0,0,0.15)')
      }
    }
  front.shadow(120, 150, 240, 100)
  front.rect(120, 150, 240, 100, '#9a7448')
  front.rect(124, 154, 232, 92, '#2f5c47')
  front.corners()

  const ceiling = face('ceiling')
  ceiling.paint('#f4f4ef')
  for (let x = 60; x < 480; x += 60) ceiling.rect(x, 0, 0.6, 360, 'rgba(0,0,0,0.1)')
  for (let y = 60; y < 360; y += 60) ceiling.rect(0, y, 480, 0.6, 'rgba(0,0,0,0.1)')
  for (const x of [130, 350])
    for (const y of [100, 260]) {
      const glow = ceiling.g.createRadialGradient(x, y, 10, x, y, 110)
      glow.addColorStop(0, 'rgba(255,255,255,0.7)')
      glow.addColorStop(1, 'rgba(255,255,255,0)')
      ceiling.rect(x - 110, y - 110, 220, 220, glow)
      ceiling.rect(x - 62, y - 10, 124, 20, '#d8dbdc')
      ceiling.rect(x - 58, y - 6, 116, 12, '#ffffff')
    }
  ceiling.corners({ bottom: 0.12, top: 0.12, sides: 0.12 })

  const floor = face('floor')
  floor.texture('wood_floor', 170)
  floor.corners({ bottom: 0.15, top: 0.15, sides: 0.15 })

  return {
    floor: [floor, '#8d6a48'],
    ceiling: [ceiling, '#f4f4ef'],
    back: [back, wall],
    front: [front, wall],
    left: [left, null],
    right: [right, wall],
  }
}

function spaceship(textures) {
  const rnd = random(3)
  const face = (name) => new Face(name, textures)
  const wall = '#d3d9e2'
  const screws = (f, x, y, w, h) => {
    for (const [sx, sy] of [[x + 4, y + 4], [x + w - 4, y + 4], [x + 4, y + h - 4], [x + w - 4, y + h - 4]]) f.circle(sx, sy, 1, 'rgba(0,0,0,0.25)')
  }
  const panels = (f, color, y, h, width) => {
    f.paint(color, 0, y, f.w, h)
    for (let x = 0; x < f.w; x += width) {
      f.rect(x, y, 1, h, 'rgba(0,0,0,0.22)')
      f.rect(x + 1, y, 1, h, 'rgba(255,255,255,0.35)')
      screws(f, x, y, width, h)
    }
    f.rect(0, y, f.w, 1, 'rgba(0,0,0,0.25)')
  }
  const lightStrip = (f, y) => {
    f.rect(0, y - 4, f.w, 8, 'rgba(90,230,255,0.25)')
    f.rect(0, y - 1.5, f.w, 3, '#8ff4ff')
  }
  const walls = (f) => {
    panels(f, wall, 100, 190, 60)
    panels(f, '#8f9aaa', 0, 100, 60)
    panels(f, '#aeb7c4', 290, 70, 60)
    lightStrip(f, 100)
    lightStrip(f, 290)
  }
  /** A round window onto space. */
  const porthole = (f, x, y, r) => {
    f.circle(x + 1, y - 2, r + 7, 'rgba(0,0,0,0.25)')
    f.circle(x, y, r + 7, '#5d6878')
    f.circle(x, y, r + 3, '#3c4452')
    f.g.save()
    f.g.beginPath()
    f.g.arc(x, y, r, 0, Math.PI * 2)
    f.g.clip()
    f.glass(x - r, y - r, 2 * r, 2 * r)
    f.g.restore()
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      f.circle(x + Math.cos(a) * (r + 5), y + Math.sin(a) * (r + 5), 1.2, '#9aa4b2')
    }
  }

  const back = face('back')
  walls(back)
  back.shadow(82, 92, 316, 196)
  back.roundRect(82, 92, 316, 196, 30, '#5d6878')
  back.roundRect(90, 100, 300, 180, 24, '#3c4452')
  back.g.save()
  back.g.beginPath()
  back.g.roundRect(96, 106, 288, 168, 20)
  back.g.clip()
  back.glass(96, 106, 288, 168)
  back.g.restore()
  back.corners({ bottom: 0.25, top: 0.15, sides: 0.18 })

  const left = face('left')
  walls(left)
  porthole(left, 110, 210, 34)
  porthole(left, 250, 210, 34)
  // A console with screens and buttons.
  left.shadow(50, 70, 260, 66)
  left.roundRect(50, 70, 260, 66, 6, '#3c4452')
  for (const x of [62, 192]) {
    left.roundRect(x, 82, 106, 44, 4, '#0b2a33')
    left.g.save()
    left.g.beginPath()
    for (let i = 0; i <= 30; i++) left.g.lineTo(x + 6 + i * 3.1, 104 + Math.sin(i / 2.5 + x) * 10 * rnd())
    left.g.lineWidth = 1.2
    left.g.strokeStyle = '#4ff0c8'
    left.g.stroke()
    left.g.restore()
    for (let i = 0; i < 5; i++) left.rect(x + 8 + i * 8, 86, 5, 3 + rnd() * 12, '#2fb6e0')
  }
  for (let i = 0; i < 6; i++) left.circle(176, 80 + i * 9.5, 2.6, ['#ff5a5a', '#ffd23f', '#45e07a'][i % 3])
  left.corners({ bottom: 0.25, top: 0.15, sides: 0.18 })

  const right = face('right')
  walls(right)
  porthole(right, 110, 210, 34)
  porthole(right, 250, 210, 34)
  right.corners({ bottom: 0.25, top: 0.15, sides: 0.18 })

  const front = face('front')
  walls(front)
  // A sliding door, framed with warning stripes.
  front.shadow(176, 0, 128, 248)
  front.g.save()
  front.g.beginPath()
  front.g.rect(176, 0, 128, 248)
  front.g.clip()
  front.rect(176, 0, 128, 248, '#f2c230')
  for (let i = -20; i < 30; i++) {
    front.g.beginPath()
    front.g.moveTo(176 + i * 16, 0)
    front.g.lineTo(176 + i * 16 + 8, 0)
    front.g.lineTo(176 + i * 16 + 8 + 248, 248)
    front.g.lineTo(176 + i * 16 + 248, 248)
    front.g.fillStyle = '#2a2a2a'
    front.g.fill()
  }
  front.g.restore()
  front.rect(188, 0, 104, 236, '#7d8898')
  front.rect(239, 0, 2, 236, '#4a5361')
  for (const x of [200, 252]) front.rect(x, 110, 28, 4, '#aab4c2')
  front.circle(240, 262, 5, '#45e07a')
  front.circle(240, 262, 9, 'rgba(69,224,122,0.25)')
  front.corners({ bottom: 0.25, top: 0.15, sides: 0.18 })

  const ceiling = face('ceiling')
  ceiling.paint('#b9c1cd')
  for (let x = 0; x < 480; x += 80) ceiling.rect(x, 0, 1, 360, 'rgba(0,0,0,0.2)')
  for (let y = 0; y < 360; y += 60) ceiling.rect(0, y, 480, 1, 'rgba(0,0,0,0.2)')
  for (const x of [160, 320]) {
    ceiling.rect(x - 14, 20, 28, 320, 'rgba(200,250,255,0.35)')
    ceiling.rect(x - 7, 24, 14, 312, '#f2feff')
  }
  ceiling.corners({ bottom: 0.15, top: 0.15, sides: 0.15 })

  const floor = face('floor')
  floor.paint('#4c5462')
  for (let x = 0; x <= 480; x += 60)
    for (let y = 0; y <= 360; y += 60) {
      floor.rect(x, y, 60, 1.2, 'rgba(0,0,0,0.4)')
      floor.rect(x, y, 1.2, 60, 'rgba(0,0,0,0.4)')
      floor.rect(x + 1.2, y + 1.2, 58, 0.8, 'rgba(255,255,255,0.12)')
      screws(floor, x, y, 60, 60)
    }
  for (let i = 0; i < 6; i++) {
    const x = 60 * Math.floor(rnd() * 8) + 15
    const y = 60 * Math.floor(rnd() * 6) + 15
    for (let k = 0; k < 6; k++) floor.rect(x, y + k * 5, 30, 2, 'rgba(0,0,0,0.35)')
  }
  floor.corners({ bottom: 0.2, top: 0.2, sides: 0.2 })

  return {
    floor: [floor, '#4c5462'],
    ceiling: [ceiling, '#b9c1cd'],
    back: [back, null],
    front: [front, wall],
    left: [left, null],
    right: [right, null],
  }
}

export const ROOMS = { living, classroom, spaceship }

/** The textures the rooms are drawn with: Poly Haven ids (their diffuse maps). */
export const TEXTURES = ['laminate_floor_02', 'wood_floor', 'plastered_wall_04']

/** Draws a room; its faces as canvases, with their colors. */
export function drawRoom(key, textures) {
  const faces = ROOMS[key](textures)
  return Object.fromEntries(Object.entries(faces).map(([name, [f, color]]) => [name, { canvas: f.canvas, color }]))
}
