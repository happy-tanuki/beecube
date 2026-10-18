/**
 * A sprite reference: a value naming one entity (a sprite or a clone), such
 * as the one "touched sprite" reports. It holds the entity's handle, so it
 * refers to nobody once that entity is deleted.
 *
 * As text it is the sprite's name; as a number, 0. Saved projects keep the
 * name only.
 */
export class EntityRef {
  constructor(
    readonly handle: number,
    /** The sprite's name when the reference was made. */
    readonly name: string,
  ) {}

  toString(): string {
    return this.name
  }

  toJSON(): string {
    return this.name
  }
}

/** A value as stored in a project file: references become their names. */
export function savable<T>(v: T): T | string {
  return v instanceof EntityRef ? v.name : v
}
