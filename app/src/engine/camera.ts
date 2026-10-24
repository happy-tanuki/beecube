/**
 * The stage camera as the camera blocks see it. A sprite can be the camera:
 * the view is then from its center along its forward axis, so moving and
 * turning the sprite moves and turns the camera. Otherwise the viewer orbits
 * the camera, and a script can put it at one of the preset views (the
 * stage's view buttons).
 */

/** Zoom 100% is a vertical field of view of this many degrees. */
export const BASE_FOV = 45
const MIN_ZOOM = 10
const MAX_ZOOM = 1000

export const VIEWS = ['home', 'top', 'front', 'side'] as const
export type ViewName = (typeof VIEWS)[number]

export class Camera {
  /** Zoom (%), and its value at the start of the tick (for interpolation). */
  zoom = 100
  prevZoom = 100
  /** The entity that is the camera (a store handle), or null. */
  sprite: number | null = null
  /** The preset view a script last asked for; `viewRequests` counts the requests. */
  view: ViewName = 'home'
  viewRequests = 0

  savePose(): void {
    this.prevZoom = this.zoom
  }

  setZoom(zoom: number): void {
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number.isFinite(zoom) ? zoom : 100))
  }

  /** Puts the camera at a preset view at zoom 100%, so it is no sprite's. */
  setView(view: ViewName): void {
    this.sprite = null
    this.zoom = 100
    this.view = view
    this.viewRequests++
  }

  /** Back to the viewer's camera at zoom 100% (on stop). */
  release(): void {
    this.sprite = null
    this.zoom = this.prevZoom = 100
  }
}

/** The vertical field of view (degrees) for a zoom (%). */
export function fovOf(zoom: number): number {
  return (2 * Math.atan(Math.tan((BASE_FOV * Math.PI) / 360) * (100 / zoom)) * 180) / Math.PI
}
