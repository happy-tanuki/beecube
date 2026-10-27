/** Small line icons for menus and buttons, drawn in the text's color. */

export type IconName = 'choose' | 'paint' | 'upload' | 'new'

const PATHS: Record<IconName, string> = {
  // A magnifying glass.
  choose: 'M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13M15.2 15.2L20 20',
  // A brush.
  paint: 'M14 4l6 6l-8 8l-6-6zM6 12l-2 6l2 2l6-2',
  // An arrow up out of a tray.
  upload: 'M12 15V4M7.5 8.5L12 4l4.5 4.5M4 14v5h16v-5',
  // A box with a plus.
  new: 'M5 5h14v14H5zM12 9v6M9 12h6',
}

export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  )
}
