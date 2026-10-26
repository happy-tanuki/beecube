import { describe, expect, it } from 'vitest'
import { zipSync } from 'fflate'
import { Assets, assetFileName, hashAsset, type AssetRef } from '../src/engine/assets'
import { plainBackdrop } from '../src/engine/backdrop'
import { parseProject, projectAssets, serializeProject } from '../src/engine/project'
import { readProjectFile, writeProjectFile } from '../src/ui/projectFile'
import { makeSprite, setup } from './helpers'

const bytes = (...n: number[]) => new Uint8Array(n)

describe('assets', () => {
  it('are kept by the hash of their contents, and the loader is asked once for one not in memory', async () => {
    const assets = new Assets()
    const ref = await assets.add(bytes(1, 2, 3), 'png')
    expect(ref.assetId).toBe(await hashAsset(bytes(1, 2, 3)))
    expect(ref.assetId).toMatch(/^[0-9a-f]{64}$/)
    expect(assets.get(ref)).toEqual(bytes(1, 2, 3))

    const asked: string[] = []
    assets.loader = async (r) => {
      asked.push(assetFileName(r))
      return r.assetId === 'a'.repeat(64) ? bytes(9) : null
    }
    const found = { assetId: 'a'.repeat(64), dataFormat: 'jpg' } as const
    const missing = { assetId: 'b'.repeat(64), dataFormat: 'jpg' } as const
    expect(await Promise.all([assets.load(found), assets.load(found), assets.load(missing)])).toEqual([bytes(9), bytes(9), null])
    expect(await assets.load(missing)).toBeNull()
    expect(asked).toEqual([`${'a'.repeat(64)}.jpg`, `${'b'.repeat(64)}.jpg`])
    expect(assets.get(found)).toEqual(bytes(9))
  })
})

describe('backdrop pictures in project files', () => {
  async function projectWithPictures() {
    const { rt } = setup([makeSprite('a', [])])
    const day = plainBackdrop('day')
    const night = plainBackdrop('night')
    const wall = await rt.assets.add(bytes(1), 'jpg')
    const floor = await rt.assets.add(bytes(2), 'png')
    const sky = await rt.assets.add(bytes(3), 'jpg')
    day.faces.back.picture = wall
    night.faces.back.picture = wall
    night.faces.floor.picture = floor
    night.sceneryPicture = sky
    rt.backdrops.set([day, night], 0)
    return { rt, wall, floor, sky }
  }

  it('refer to their assets, each once, and faces from older files have none', async () => {
    const { rt, wall, floor, sky } = await projectWithPictures()
    const project = parseProject(JSON.parse(JSON.stringify(serializeProject(rt))))
    expect(project.backdrops[1].faces.floor.picture).toEqual(floor)
    expect(project.backdrops[1].sceneryPicture).toEqual(sky)
    expect(projectAssets(project)).toEqual([wall, sky, floor])

    const old = serializeProject(rt) as unknown as { backdrops: { sceneryPicture?: AssetRef; faces: Record<string, { picture?: AssetRef }> }[] }
    delete old.backdrops[0].faces.back.picture
    delete old.backdrops[1].sceneryPicture
    expect(parseProject(old).backdrops[0].faces.back.picture).toBeNull()
    expect(parseProject(old).backdrops[1].sceneryPicture).toBeNull()
  })

  it('refuses pictures that are not assets', async () => {
    const { rt } = await projectWithPictures()
    const withPicture = (picture: unknown) => {
      const b = plainBackdrop('x') as unknown as { faces: { back: { picture: unknown } } }
      b.faces.back.picture = picture
      return () => parseProject({ ...serializeProject(rt), backdrops: [b] })
    }
    expect(withPicture({ assetId: 'abc', dataFormat: 'png' })).toThrow(/SHA-256/)
    expect(withPicture({ assetId: 'a'.repeat(64), dataFormat: 'gif' })).toThrow(/dataFormat/)
    expect(withPicture('a.png')).toThrow(/picture/)
  })

  it('are saved in the zip with project.json, and read back; a picture that does not match its name is left out', async () => {
    const { rt, wall, floor, sky } = await projectWithPictures()
    const project = serializeProject(rt)
    const assets = new Map(rt.assets.entries())
    const file = writeProjectFile(project, assets)
    const read = await readProjectFile(file)
    expect(read.project).toEqual(parseProject(JSON.parse(JSON.stringify(project))))
    expect(read.assets).toEqual([
      [wall, bytes(1)],
      [sky, bytes(3)],
      [floor, bytes(2)],
    ])

    const tampered = zipSync({
      'project.json': new TextEncoder().encode(JSON.stringify(project)),
      [assetFileName(wall)]: bytes(1),
      [assetFileName(floor)]: bytes(7),
    })
    // The sky is missing, and the floor doesn't match.
    expect((await readProjectFile(tampered)).assets).toEqual([[wall, bytes(1)]])
  })

  it('opens project files that are the JSON alone', async () => {
    const { rt } = setup([makeSprite('a', [])])
    const read = await readProjectFile(new TextEncoder().encode(JSON.stringify(serializeProject(rt))))
    expect(read.project.sprites[0].name).toBe('a')
    expect(read.assets).toEqual([])
  })
})
