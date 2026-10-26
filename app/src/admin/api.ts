/** The moderation routes of the sharing API (server/api.ts), with the admin token. */
import { ApiError } from '../share/client'

export interface ReviewItem {
  id: string
  title: string
  notes: string
  status: 'shared' | 'hidden'
  reports: number
  /** Report counts by reason. */
  reasons: Record<string, number>
  updated_at: number
}

export interface ReviewDetail {
  id: string
  title: string
  notes: string
  status: 'shared' | 'hidden'
  reports: number
  hasThumbnail: boolean
  project: unknown
  /** The project's own pictures (file names), as uploaded. */
  assets: string[]
}

const BASE = `${import.meta.env.BASE_URL}api/admin/projects`

export class AdminApi {
  constructor(private readonly token: string) {}

  private async call(method: string, path = ''): Promise<Response> {
    const res = await fetch(`${BASE}${path}`, { method, headers: { authorization: `Bearer ${this.token}` } })
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      throw new ApiError(res.status, data?.error ?? 'unknown')
    }
    return res
  }

  async list(): Promise<ReviewItem[]> {
    return ((await (await this.call('GET')).json()) as { projects: ReviewItem[] }).projects
  }

  async get(id: string): Promise<ReviewDetail> {
    return (await (await this.call('GET', `/${id}`)).json()) as ReviewDetail
  }

  /** An object URL for the project's picture; revoke it when done. */
  async thumbnailUrl(id: string): Promise<string> {
    return URL.createObjectURL(await (await this.call('GET', `/${id}/thumbnail`)).blob())
  }

  /** An object URL for one of the project's pictures; revoke it when done. */
  async assetUrl(id: string, file: string): Promise<string> {
    return URL.createObjectURL(await (await this.call('GET', `/${id}/assets/${file}`)).blob())
  }

  async hide(id: string): Promise<void> {
    await this.call('POST', `/${id}/hide`)
  }

  async restore(id: string): Promise<void> {
    await this.call('POST', `/${id}/restore`)
  }

  async remove(id: string): Promise<void> {
    await this.call('DELETE', `/${id}`)
  }
}
