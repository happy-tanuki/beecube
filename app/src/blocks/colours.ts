// Kept apart from setup.ts so the player can use the colours without loading scratch-blocks.

/** [primary, secondary, tertiary] per category, as in Scratch 3. */
export const CATEGORY_COLOURS: Record<string, [string, string, string]> = {
  motion: ['#4C97FF', '#4280D7', '#3373CC'],
  looks: ['#9966FF', '#855CD6', '#774DCB'],
  sounds: ['#CF63CF', '#C94FC9', '#BD42BD'],
  control: ['#FFAB19', '#EC9C13', '#CF8B17'],
  event: ['#FFBF00', '#E6AC00', '#CC9900'],
  sensing: ['#5CB1D6', '#47A8D1', '#2E8EB8'],
  pen: ['#0FBD8C', '#0DA57A', '#0B8E69'],
  // BeeCube's own category.
  camera: ['#5B7290', '#4F6580', '#435770'],
  operators: ['#59C059', '#46B946', '#389438'],
  data: ['#FF8C1A', '#FF8000', '#DB6E00'],
  data_lists: ['#FF661A', '#FF5500', '#E64D00'],
  more: ['#FF6680', '#FF4D6A', '#FF3355'],
}
