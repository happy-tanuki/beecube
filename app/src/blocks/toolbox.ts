import * as ScratchBlocks from 'scratch-blocks'
import { EDGE, MOUSE, MYSELF } from '../engine/types'
import type { ExtensionSpec } from '../engine/extension'
import { extensionCategoryXml } from './extensions'
import { CATEGORY_COLOURS } from './colours'
import { t } from '../i18n'

const num = (name: string, v: number | string, type = 'math_number') =>
  `<value name="${name}"><shadow type="${type}"><field name="NUM">${v}</field></shadow></value>`
const txt = (name: string, v: string) =>
  `<value name="${name}"><shadow type="text"><field name="TEXT">${v}</field></shadow></value>`
const colour = (name: string, v: string) =>
  `<value name="${name}"><shadow type="colour_picker"><field name="COLOUR">${v}</field></shadow></value>`
const block = (type: string, inner = '') => `<block type="${type}">${inner}</block>`
const sep = (gap = 36) => `<sep gap="${gap}"/>`

function category(id: string, msgKey: string, styleName: string, contents: string): string {
  const [primary, secondary] = CATEGORY_COLOURS[styleName]
  const name = ScratchBlocks.Msg[msgKey] ?? id
  return `<category name="${name}" id="${id}" colour="${primary}" secondaryColour="${secondary}">${contents}</category>`
}

/** Builds the toolbox XML. Call after setting the locale so category names are translated. */
export function makeToolboxXml(extensions: ExtensionSpec[] = []): string {
  const motion = [
    block('motion_movesteps', num('STEPS', 10)),
    block('motion_turnright', num('DEGREES', 15)),
    block('motion_turnleft', num('DEGREES', 15)),
    block('motion_turnup', num('DEGREES', 15)),
    block('motion_turndown', num('DEGREES', 15)),
    sep(),
    block('motion_gotoxyz', num('X', 0) + num('Y', 0) + num('Z', 20)),
    block('motion_gotoxy', num('X', 0) + num('Y', 0)),
    block('motion_glidesecstoxyz', num('SECS', 1) + num('X', 0) + num('Y', 0) + num('Z', 20)),
    sep(),
    block('motion_ifonedgebounce'),
    sep(),
    block('motion_pointindirection', num('DIRECTION', 90, 'math_angle')),
    block('motion_setpitch', num('PITCH', 0, 'math_angle')),
    block('motion_setroll', num('ROLL', 0, 'math_angle')),
    block('motion_changerollby', num('DEGREES', 15)),
    sep(),
    block('motion_changexby', num('DX', 10)),
    block('motion_setx', num('X', 0)),
    block('motion_changeyby', num('DY', 10)),
    block('motion_sety', num('Y', 0)),
    block('motion_changezby', num('DZ', 10)),
    block('motion_setz', num('Z', 0)),
    sep(),
    block('motion_xposition'),
    block('motion_yposition'),
    block('motion_zposition'),
    block('motion_direction'),
    block('motion_pitch'),
    block('motion_roll'),
  ].join('')

  const looks = [
    block('looks_sayforsecs', txt('MESSAGE', t('default.hello')) + num('SECS', 2)),
    block('looks_say', txt('MESSAGE', t('default.hello'))),
    sep(),
    block('looks_setcolorto', colour('COLOR', '#ff8c1a')),
    block('looks_changesizeby', num('CHANGE', 10)),
    block('looks_setsizeto', num('SIZE', 100)),
    sep(),
    block('looks_show'),
    block('looks_hide'),
    sep(),
    block('looks_size'),
  ].join('')

  const broadcastMenu = '<value name="BROADCAST_INPUT"><shadow type="event_broadcast_menu"></shadow></value>'
  const events = [
    block('event_whenflagclicked'),
    block('event_whenkeypressed'),
    block('event_whenthisspriteclicked'),
    block(
      'event_whentouchingobject',
      `<value name="TOUCHINGOBJECTMENU"><shadow type="event_touchingobjectmenu"><field name="TOUCHINGOBJECTMENU">${EDGE}</field></shadow></value>`,
    ),
    sep(),
    block('event_whenbroadcastreceived'),
    block('event_broadcast', broadcastMenu),
    block('event_broadcastandwait', broadcastMenu),
  ].join('')

  const control = [
    block('control_wait', num('DURATION', 1, 'math_positive_number')),
    sep(),
    block('control_repeat', num('TIMES', 10, 'math_whole_number')),
    block('control_forever'),
    sep(),
    block('control_if'),
    block('control_if_else'),
    block('control_wait_until'),
    block('control_repeat_until'),
    sep(),
    block('control_stop'),
    sep(),
    block('control_start_as_clone'),
    block(
      'control_create_clone_of',
      `<value name="CLONE_OPTION"><shadow type="control_create_clone_of_menu"><field name="CLONE_OPTION">${MYSELF}</field></shadow></value>`,
    ),
    block('control_delete_this_clone'),
  ].join('')

  const sensing = [
    block(
      'sensing_touchingobject',
      `<value name="TOUCHINGOBJECTMENU"><shadow type="sensing_touchingobjectmenu"><field name="TOUCHINGOBJECTMENU">${EDGE}</field></shadow></value>`,
    ),
    block('sensing_touchingcolor', colour('COLOR', '#ff8c1a')),
    block('sensing_touchedsprite'),
    block(
      'sensing_distanceto',
      `<value name="DISTANCETOMENU"><shadow type="sensing_distancetomenu"><field name="DISTANCETOMENU">${MOUSE}</field></shadow></value>`,
    ),
    sep(),
    block(
      'sensing_keypressed',
      '<value name="KEY_OPTION"><shadow type="sensing_keyoptions"><field name="KEY_OPTION">space</field></shadow></value>',
    ),
    block('sensing_mousedown'),
    block('sensing_mousex'),
    block('sensing_mousey'),
    sep(),
    block('sensing_timer'),
    block('sensing_resettimer'),
    sep(),
    // The object menu starts on its first option: the first other sprite.
    block('sensing_of', '<value name="OBJECT"><shadow type="sensing_of_object_menu"></shadow></value>'),
  ].join('')

  const two = (type: string, a: string, b: string, va = '', vb = '') =>
    block(type, (a.startsWith('NUM') ? num(a, va) + num(b, vb) : txt(a, va) + txt(b, vb)))
  const operators = [
    two('operator_add', 'NUM1', 'NUM2'),
    two('operator_subtract', 'NUM1', 'NUM2'),
    two('operator_multiply', 'NUM1', 'NUM2'),
    two('operator_divide', 'NUM1', 'NUM2'),
    sep(),
    block('operator_random', num('FROM', 1) + num('TO', 10)),
    sep(),
    two('operator_gt', 'OPERAND1', 'OPERAND2', '', '50'),
    two('operator_lt', 'OPERAND1', 'OPERAND2', '', '50'),
    two('operator_equals', 'OPERAND1', 'OPERAND2', '', '50'),
    sep(),
    block('operator_and'),
    block('operator_or'),
    block('operator_not'),
    sep(),
    two('operator_join', 'STRING1', 'STRING2', t('default.apple'), t('default.banana')),
    block('operator_letter_of', num('LETTER', 1, 'math_whole_number') + txt('STRING', t('default.apple'))),
    block('operator_length', txt('STRING', t('default.apple'))),
    sep(),
    two('operator_mod', 'NUM1', 'NUM2'),
    block('operator_round', num('NUM', '')),
    block('operator_mathop', num('NUM', '')),
  ].join('')

  const pen = [
    block('pen_clear'),
    sep(),
    block('pen_stamp'),
    sep(),
    block('pen_penDown'),
    block('pen_penUp'),
    sep(),
    block('pen_setPenColorToColor', colour('COLOR', '#0fbd8c')),
    block('pen_changePenColorParamBy', num('VALUE', 10)),
    block('pen_setPenColorParamTo', num('VALUE', 50)),
    sep(),
    block('pen_changePenSizeBy', num('SIZE', 1)),
    block('pen_setPenSizeTo', num('SIZE', 1)),
    sep(),
    block('pen_drawCube', num('SIZE', 40)),
    block('pen_drawSphere', num('RADIUS', 30)),
  ].join('')

  const [dataPrimary, dataSecondary] = CATEGORY_COLOURS.data
  const variables = `<category name="${ScratchBlocks.Msg.CATEGORY_VARIABLES}" id="variables" colour="${dataPrimary}" secondaryColour="${dataSecondary}" custom="VARIABLE"></category>`

  const [morePrimary, moreSecondary] = CATEGORY_COLOURS.more
  const myBlocks = `<category name="${ScratchBlocks.Msg.CATEGORY_MYBLOCKS}" id="myBlocks" colour="${morePrimary}" secondaryColour="${moreSecondary}" custom="PROCEDURE"></category>`

  return (
    '<xml style="display: none">' +
    category('motion', 'CATEGORY_MOTION', 'motion', motion) +
    category('looks', 'CATEGORY_LOOKS', 'looks', looks) +
    category('events', 'CATEGORY_EVENTS', 'event', events) +
    category('control', 'CATEGORY_CONTROL', 'control', control) +
    category('sensing', 'CATEGORY_SENSING', 'sensing', sensing) +
    category('operators', 'CATEGORY_OPERATORS', 'operators', operators) +
    variables +
    myBlocks +
    category('pen', 'CATEGORY_PEN', 'pen', pen) +
    extensions.map(extensionCategoryXml).join('') +
    '</xml>'
  )
}
