/**
 * scratch-blocks configuration: locale, theme (Scratch 3 category colours),
 * and the blocks this project adds (z axis, pitch, colour, 3D pen).
 */
import * as ScratchBlocks from 'scratch-blocks'
import { APP_ID } from '../brand'
import { CATEGORY_COLOURS } from './colours'
import type { SpriteProperty } from '../engine/analyze'
import { EDGE, MOUSE, MYSELF } from '../engine/types'
import { blockMessages, getLocale } from '../i18n'

/** Sets scratch-blocks' language and adds the messages for this project's blocks. Call before creating blocks. */
export function applyBlocksLocale(): void {
  ScratchBlocks.ScratchMsgs.setLocale(getLocale())
  Object.assign(ScratchBlocks.Msg, blockMessages())
}

/** `extensionColours` maps extra block style names (one per extension) to their colours. */
export function createTheme(extensionColours: Record<string, [string, string, string]> = {}): ScratchBlocks.Theme {
  const blockStyles: Record<string, Partial<ScratchBlocks.Theme.BlockStyle> & { colourQuaternary?: string }> = {}
  for (const [name, [p, s, t]] of Object.entries({ ...CATEGORY_COLOURS, ...extensionColours })) {
    blockStyles[name] = { colourPrimary: p, colourSecondary: s, colourTertiary: t, colourQuaternary: t }
  }
  blockStyles.textField = {
    colourPrimary: '#FFFFFF',
    colourSecondary: '#FFFFFF',
    colourTertiary: '#FFFFFF',
    colourQuaternary: '#FFFFFF',
  }
  return new ScratchBlocks.Theme(APP_ID, blockStyles as Record<string, Partial<ScratchBlocks.Theme.BlockStyle>>, {}, {})
}

type ArgDef = { type: 'input_value'; name: string }
const arg = (name: string): ArgDef => ({ type: 'input_value', name })

function defineStatement(type: string, msgKey: string, args: ArgDef[], style: string): void {
  ScratchBlocks.Blocks[type] = {
    init(this: ScratchBlocks.Block) {
      this.jsonInit({
        message0: ScratchBlocks.Msg[msgKey],
        args0: args,
        extensions: [`colours_${style}`, 'shape_statement'],
      })
    },
  }
}

function defineReporter(type: string, msgKey: string, style: string): void {
  ScratchBlocks.Blocks[type] = {
    init(this: ScratchBlocks.Block) {
      this.jsonInit({
        message0: ScratchBlocks.Msg[msgKey],
        extensions: [`colours_${style}`, 'output_number', 'monitor_block'],
      })
    },
  }
}

/** Names of the other sprites, for the touching / distance menus. Set by the editor. */
let otherSpriteNames: () => string[] = () => []

export function setSpriteNameSource(fn: () => string[]): void {
  otherSpriteNames = fn
}

/** A sprite's own variable names, for the "of" block's property menu. Set by the editor. */
let spriteVariableNames: (spriteName: string) => string[] = () => []

export function setSpriteVariableSource(fn: (spriteName: string) => string[]): void {
  spriteVariableNames = fn
}

type MenuOption = [string, string]

/** Shown when a sprite menu has nothing to offer (a dropdown can't be empty). */
const NO_SPRITE: MenuOption = ['—', '']

function defineObjectMenu(type: string, fieldName: string, style: string, fixed: () => MenuOption[]): void {
  ScratchBlocks.Blocks[type] = {
    init(this: ScratchBlocks.Block) {
      this.jsonInit({
        message0: '%1',
        args0: [
          {
            type: 'field_dropdown',
            name: fieldName,
            options: (): MenuOption[] => {
              const options = [...fixed(), ...otherSpriteNames().map((n): MenuOption => [n, n])]
              // Keep a value that refers to a sprite that is gone, so the block doesn't silently change.
              const current = this.getFieldValue(fieldName) as string | null
              if (current && !options.some((o) => o[1] === current)) options.push([current, current])
              return options.length > 0 ? options : [NO_SPRITE]
            },
          },
        ],
        extensions: [`colours_${style}`, 'output_string'],
      })
    },
  }
}

/** Labels of the "of" block's built-in properties, by menu value. */
const propertyLabels = (): Record<SpriteProperty, string> => ({
  'x position': ScratchBlocks.Msg.SENSING_OF_XPOSITION,
  'y position': ScratchBlocks.Msg.SENSING_OF_YPOSITION,
  'z position': ScratchBlocks.Msg.MOTION_ZPOSITION,
  direction: ScratchBlocks.Msg.SENSING_OF_DIRECTION,
  pitch: ScratchBlocks.Msg.MOTION_PITCH,
  roll: ScratchBlocks.Msg.MOTION_ROLL,
  size: ScratchBlocks.Msg.SENSING_OF_SIZE,
})

/** "(x position) of (sprite)": the property menu adds the chosen sprite's own variables. */
function defineSensingOf(): void {
  ScratchBlocks.Blocks.sensing_of = {
    init(this: ScratchBlocks.Block) {
      const block = this
      this.jsonInit({
        message0: ScratchBlocks.Msg.SENSING_OF,
        args0: [
          {
            type: 'field_dropdown',
            name: 'PROPERTY',
            options: (): MenuOption[] => {
              const sprite = block.getInputTargetBlock('OBJECT')?.getFieldValue('OBJECT') as string | undefined
              const options: MenuOption[] = [
                ...Object.entries(propertyLabels()).map(([value, label]): MenuOption => [label, value]),
                ...(sprite ? spriteVariableNames(sprite) : []).map((n): MenuOption => [n, n]),
              ]
              const current = block.getFieldValue('PROPERTY') as string | null
              if (current && !options.some((o) => o[1] === current)) options.push([current, current])
              return options
            },
          },
          { type: 'input_value', name: 'OBJECT' },
        ],
        extensions: ['colours_sensing', 'output_string'],
      })
    },
    // As in Scratch, choosing another sprite resets the property, whose variable may not exist there.
    onchange(this: ScratchBlocks.Block, e: ScratchBlocks.Events.Abstract) {
      if (e.type !== ScratchBlocks.Events.BLOCK_CHANGE) return
      const change = e as ScratchBlocks.Events.BlockChange
      const menu = this.getInputTargetBlock('OBJECT')
      if (menu && change.blockId === menu.id && change.name === 'OBJECT' && change.oldValue !== change.newValue) {
        this.setFieldValue('x position', 'PROPERTY')
      }
    },
  }
}

/** "change / set pen (color) by / to": the menu of the pen color's parts (PEN_PARAMS). */
function definePenParam(type: string, msgKey: string): void {
  ScratchBlocks.Blocks[type] = {
    init(this: ScratchBlocks.Block) {
      this.jsonInit({
        message0: ScratchBlocks.Msg[msgKey],
        args0: [
          {
            type: 'field_dropdown',
            name: 'COLOR_PARAM',
            options: (): MenuOption[] => [
              [ScratchBlocks.Msg.PEN_PARAM_COLOR, 'color'],
              [ScratchBlocks.Msg.PEN_PARAM_SATURATION, 'saturation'],
              [ScratchBlocks.Msg.PEN_PARAM_BRIGHTNESS, 'brightness'],
              [ScratchBlocks.Msg.PEN_PARAM_TRANSPARENCY, 'transparency'],
            ],
          },
          arg('VALUE'),
        ],
        extensions: ['colours_pen', 'shape_statement'],
      })
    },
  }
}

let defined = false

/** Registers this project's blocks. Messages are read at block creation, so locale changes apply. */
export function defineCustomBlocks(): void {
  if (defined) return
  defined = true
  defineStatement('motion_gotoxyz', 'MOTION_GOTOXYZ', [arg('X'), arg('Y'), arg('Z')], 'motion')
  defineStatement('motion_glidesecstoxyz', 'MOTION_GLIDESECSTOXYZ', [arg('SECS'), arg('X'), arg('Y'), arg('Z')], 'motion')
  defineStatement('motion_setz', 'MOTION_SETZ', [arg('Z')], 'motion')
  defineStatement('motion_changezby', 'MOTION_CHANGEZBY', [arg('DZ')], 'motion')
  defineStatement('motion_setpitch', 'MOTION_SETPITCH', [arg('PITCH')], 'motion')
  defineStatement('motion_turnup', 'MOTION_TURNUP', [arg('DEGREES')], 'motion')
  defineStatement('motion_turndown', 'MOTION_TURNDOWN', [arg('DEGREES')], 'motion')
  defineReporter('motion_zposition', 'MOTION_ZPOSITION', 'motion')
  defineReporter('motion_pitch', 'MOTION_PITCH', 'motion')
  defineStatement('motion_setroll', 'MOTION_SETROLL', [arg('ROLL')], 'motion')
  defineStatement('motion_changerollby', 'MOTION_CHANGEROLLBY', [arg('DEGREES')], 'motion')
  defineReporter('motion_roll', 'MOTION_ROLL', 'motion')

  // scratch-blocks defines the hat; its menu lists this project's targets.
  defineObjectMenu('event_touchingobjectmenu', 'TOUCHINGOBJECTMENU', 'event', () => [
    [ScratchBlocks.Msg.SENSING_TOUCHINGOBJECT_EDGE, EDGE],
    [ScratchBlocks.Msg.EVENT_TOUCHINGOBJECT_MYSELF, MYSELF],
  ])
  ScratchBlocks.Blocks.sensing_touchedsprite = {
    init(this: ScratchBlocks.Block) {
      this.jsonInit({ message0: ScratchBlocks.Msg.SENSING_TOUCHEDSPRITE, extensions: ['colours_sensing', 'output_string'] })
    },
  }
  defineObjectMenu('sensing_touchingobjectmenu', 'TOUCHINGOBJECTMENU', 'sensing', () => [
    [ScratchBlocks.Msg.SENSING_TOUCHINGOBJECT_EDGE, EDGE],
  ])
  defineObjectMenu('sensing_distancetomenu', 'DISTANCETOMENU', 'sensing', () => [
    [ScratchBlocks.Msg.SENSING_DISTANCETO_POINTER, MOUSE],
  ])
  defineObjectMenu('sensing_of_object_menu', 'OBJECT', 'sensing', () => [])
  defineSensingOf()
  defineObjectMenu('control_create_clone_of_menu', 'CLONE_OPTION', 'control', () => [
    [ScratchBlocks.Msg.CONTROL_CREATECLONEOF_MYSELF, MYSELF],
  ])

  defineStatement('looks_setcolorto', 'LOOKS_SETCOLORTO', [arg('COLOR')], 'looks')

  defineStatement('pen_clear', 'PEN_CLEAR', [], 'pen')
  defineStatement('pen_penDown', 'PEN_PENDOWN', [], 'pen')
  defineStatement('pen_penUp', 'PEN_PENUP', [], 'pen')
  defineStatement('pen_setPenColorToColor', 'PEN_SETCOLORTO', [arg('COLOR')], 'pen')
  definePenParam('pen_changePenColorParamBy', 'PEN_CHANGECOLORPARAMBY')
  definePenParam('pen_setPenColorParamTo', 'PEN_SETCOLORPARAMTO')
  defineStatement('pen_changePenSizeBy', 'PEN_CHANGESIZEBY', [arg('SIZE')], 'pen')
  defineStatement('pen_setPenSizeTo', 'PEN_SETSIZETO', [arg('SIZE')], 'pen')
  defineStatement('pen_stamp', 'PEN_STAMP', [], 'pen')
  defineStatement('pen_drawCube', 'PEN_DRAWCUBE', [arg('SIZE')], 'pen')
  defineStatement('pen_drawSphere', 'PEN_DRAWSPHERE', [arg('RADIUS')], 'pen')
}
