// The moon's surface as a 360° image (equirectangular), drawn in a browser
// for the scenery library (see make-scenery-library.mjs): grey ground with
// craters under a black sky with stars and the Earth.
//
// The scenery is shown ground-projected, as photographed from 150 above the
// stage (src/stage/environment.ts), so the ground is drawn where a ray
// from that height meets it: craters keep their shape on the ground around
// the stage. Units are centimeters, as in the room library.

const EYE_HEIGHT = 150

function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A number from 0 to 1 for each pair of integers (and a salt). */
function hash(x, y, salt) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(salt, 2246822519)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Smooth noise from 0 to 1, varying over about `size`. */
function noise(x, y, size, salt) {
  x /= size
  y /= size
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const a = hash(ix, iy, salt)
  const b = hash(ix + 1, iy, salt)
  const c = hash(ix, iy + 1, salt)
  const d = hash(ix + 1, iy + 1, salt)
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}

/**
 * Craters of about `size` across, at most one in each cell of a grid of
 * twice that: how much lighter (+) or darker (-) the ground is at (x, y),
 * lit from the sun's side (sx, sy).
 */
function craters(x, y, size, salt, sx, sy) {
  const cell = size * 2
  const cx = Math.floor(x / cell)
  const cy = Math.floor(y / cell)
  let shade = 0
  for (let i = -1; i <= 1; i++)
    for (let j = -1; j <= 1; j++) {
      const gx = cx + i
      const gy = cy + j
      if (hash(gx, gy, salt + 1) < 0.35) continue
      const r = size * (0.25 + hash(gx, gy, salt + 2) * 0.75)
      const ox = (gx + hash(gx, gy, salt + 3)) * cell
      const oy = (gy + hash(gx, gy, salt + 4)) * cell
      // None under the stage (480 by 360), whose floor lies on the ground.
      if (Math.abs(ox) < 240 + r * 1.35 && Math.abs(oy) < 180 + r * 1.35) continue
      const dx = x - ox
      const dy = y - oy
      const d = Math.hypot(dx, dy) / r
      if (d > 1.35) continue
      // Which side of the crater the point is on: the sun's side (1) or the other (-1).
      const side = d > 0 ? (dx * sx + dy * sy) / (d * r) : 0
      // Inside, the wall on the sun's side faces away from it; the rim outside faces it.
      if (d < 1) shade += -0.22 * side * d * d - 0.04
      else shade += (0.1 * side + 0.03) * ((1.35 - d) / 0.35) ** 2
    }
  return shade
}

/** The image, `width` pixels wide (twice as wide as tall), on a canvas. */
export default function drawMoon(width = 4096) {
  const height = width / 2
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const g = canvas.getContext('2d')
  const rnd = random(7)

  // The sky: black, with stars, a few of them bright.
  g.fillStyle = '#020309'
  g.fillRect(0, 0, width, height / 2)
  for (let i = 0; i < width * 1.5; i++) {
    const y = Math.acos(1 - rnd()) / Math.PI // even over the sphere, not the image
    const big = rnd() < 0.04
    g.globalAlpha = 0.35 + rnd() * 0.65
    g.fillStyle = rnd() < 0.15 ? '#cfe0ff' : rnd() < 0.1 ? '#ffe6c8' : '#ffffff'
    const s = (big ? 2.2 : 1.1) * (width / 4096)
    g.fillRect(rnd() * width, y * height, s / Math.max(0.2, Math.sin(y * Math.PI)), s)
  }
  g.globalAlpha = 1

  // The Earth, ahead and a little to the left, larger than it really looks.
  const ex = width * 0.43
  const ey = height * 0.3
  const er = width * 0.022
  g.save()
  g.translate(ex, ey)
  g.scale(1 / Math.cos(((0.5 - 0.3) * Math.PI)), 1)
  const glow = g.createRadialGradient(0, 0, er, 0, 0, er * 1.6)
  glow.addColorStop(0, 'rgba(120,170,255,0.35)')
  glow.addColorStop(1, 'rgba(120,170,255,0)')
  g.fillStyle = glow
  g.fillRect(-er * 2, -er * 2, er * 4, er * 4)
  g.beginPath()
  g.arc(0, 0, er, 0, Math.PI * 2)
  g.clip()
  g.fillStyle = '#2b62c9'
  g.fillRect(-er, -er, 2 * er, 2 * er)
  for (let i = 0; i < 14; i++) {
    g.fillStyle = rnd() < 0.5 ? '#5f9b4a' : '#b49a62'
    g.beginPath()
    g.ellipse((rnd() - 0.5) * 1.6 * er, (rnd() - 0.5) * 1.6 * er, er * (0.1 + rnd() * 0.25), er * (0.08 + rnd() * 0.2), rnd() * 3, 0, Math.PI * 2)
    g.fill()
  }
  for (let i = 0; i < 18; i++) {
    g.fillStyle = 'rgba(255,255,255,0.75)'
    g.beginPath()
    g.ellipse((rnd() - 0.5) * 2 * er, (rnd() - 0.5) * 2 * er, er * (0.15 + rnd() * 0.35), er * (0.03 + rnd() * 0.06), rnd() * 0.6 - 0.3, 0, Math.PI * 2)
    g.fill()
  }
  // Night on the side away from the sun (which is on the left).
  const night = g.createLinearGradient(-er * 0.9, 0, er * 0.3, 0)
  night.addColorStop(0, 'rgba(0,0,8,0)')
  night.addColorStop(1, 'rgba(0,0,8,0.85)')
  g.fillStyle = night
  g.fillRect(-er, -er, 2 * er, 2 * er)
  g.restore()

  // The ground, pixel by pixel, where each pixel's ray meets it.
  const top = Math.floor(height / 2)
  const image = g.getImageData(0, top, width, height - top)
  const px = image.data
  // The sun is low, on the left (stage -x) and a little behind.
  const sx = -0.94
  const sy = -0.34
  for (let row = 0; row < height - top; row++) {
    const el = -((row + 0.5) / height) * Math.PI
    const d = EYE_HEIGHT / Math.tan(-el)
    // How much ground a pixel covers (most along the ray).
    const footprint = ((d * d) / EYE_HEIGHT + EYE_HEIGHT) * (Math.PI / height)
    // Detail smaller than a few pixels fades out with distance.
    const fade = (size) => Math.max(0, Math.min(1, (size / footprint - 2) / 4))
    for (let col = 0; col < width; col++) {
      const az = ((col + 0.5) / width - 0.5) * Math.PI * 2
      const x = d * Math.sin(az)
      const y = d * Math.cos(az)
      let v = 0.55
      v += (noise(x, y, 2500, 1) - 0.5) * 0.2
      v += (noise(x, y, 400, 2) - 0.5) * 0.14 * fade(400)
      v += (noise(x, y, 60, 3) - 0.5) * 0.12 * fade(60)
      v += (noise(x, y, 12, 4) - 0.5) * 0.1 * fade(12)
      v += craters(x, y, 1600, 200, sx, sy) * fade(1600)
      v += craters(x, y, 350, 300, sx, sy) * fade(350)
      v += craters(x, y, 70, 400, sx, sy) * fade(70)
      v = Math.max(0, Math.min(1, v))
      const i = (row * width + col) * 4
      px[i] = 34 + v * 190
      px[i + 1] = 33 + v * 188
      px[i + 2] = 32 + v * 184
      px[i + 3] = 255
    }
  }
  g.putImageData(image, 0, top)

  // Hills on the horizon, lighter where they face the sun (on the left, a quarter of the way round).
  const hill = (u) => height * (0.006 * noise(u * 48, 0, 1, 11) + 0.014 * noise(u * 12, 0, 1, 12))
  for (let col = 0; col < width; col++) {
    const u = (col + 0.5) / width
    const h = hill(u)
    // The slope across a few pixels: rising towards the sun is lit.
    const slope = (hill(u - 4 / width) - hill(u + 4 / width)) / (8 * ((Math.PI * 2) / width) * height / Math.PI)
    const sun = Math.cos((u - 0.25) * Math.PI * 2)
    const v = Math.max(0.3, Math.min(0.85, 0.55 + slope * 6 * sun))
    g.fillStyle = `rgb(${34 + v * 190},${33 + v * 188},${32 + v * 184})`
    g.fillRect(col, top - h, 1, h + 1)
  }
  return canvas
}
