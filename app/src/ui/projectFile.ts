/**
 * Project files on the user's computer: a zip, as Scratch's, holding
 * project.json and the assets it uses, each named <sha-256>.<format>. Files
 * from before assets are the JSON alone, and still open.
 */
import { unzipSync, zipSync } from 'fflate'
import { assetFileName, hashAsset, type AssetRef } from '../engine/assets'
import { ProjectFormatError, parseProject, projectAssets, type ProjectFile } from '../engine/project'

const PROJECT_JSON = 'project.json'

/** The file's contents, with those of the project's assets given (one missing is left out). */
export function writeProjectFile(project: ProjectFile, assets: Map<string, Uint8Array>): Uint8Array {
  const files: Record<string, Uint8Array> = { [PROJECT_JSON]: new TextEncoder().encode(JSON.stringify(project)) }
  for (const ref of projectAssets(project)) {
    const name = assetFileName(ref)
    const data = assets.get(name)
    // Pictures are compressed already (see the level below).
    if (data) files[name] = data
  }
  return zipSync(files, { level: 0 })
}

/** Reads a project file. Throws ProjectFormatError (or SyntaxError for bad JSON) if it isn't valid. */
export async function readProjectFile(bytes: Uint8Array): Promise<{ project: ProjectFile; assets: [AssetRef, Uint8Array][] }> {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b
  if (!isZip) return { project: parseProject(JSON.parse(new TextDecoder().decode(bytes))), assets: [] }
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch (err) {
    throw new ProjectFormatError(`the file is not a readable zip (${err instanceof Error ? err.message : err})`)
  }
  const json = files[PROJECT_JSON] ?? Object.entries(files).find(([name]) => name.endsWith(`/${PROJECT_JSON}`))?.[1]
  if (!json) throw new ProjectFormatError(`the file has no ${PROJECT_JSON}`)
  const project = parseProject(JSON.parse(new TextDecoder().decode(json)))
  const byName = new Map(Object.entries(files).map(([name, data]) => [name.split('/').pop()!, data]))
  const assets: [AssetRef, Uint8Array][] = []
  for (const ref of projectAssets(project)) {
    const data = byName.get(assetFileName(ref))
    if (!data) continue
    // A file whose contents don't match its name is left out (the face then shows its color).
    if ((await hashAsset(data)) !== ref.assetId) continue
    assets.push([ref, data])
  }
  return { project, assets }
}
