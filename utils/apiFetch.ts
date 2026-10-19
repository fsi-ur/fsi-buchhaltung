import type { FetchOptions, FetchResponse } from 'ofetch'
import type { InternalApi } from 'nitropack/types'

export type ApiFetchOptions = FetchOptions<any>

/**
 * The serialized response of one server route, e.g. `ApiResponse<'/api/members'>` or
 * `ApiResponse<'/api/events/:id', 'put'>`. A direct lookup, so it only resolves that handler.
 */
export type ApiResponse<
  Route extends keyof InternalApi,
  Method extends keyof InternalApi[Route] = Extract<'get', keyof InternalApi[Route]>,
> = InternalApi[Route][Method]

type UntypedFetch = {
  (url: string, opts?: ApiFetchOptions): Promise<unknown>
  raw(url: string, opts?: ApiFetchOptions): Promise<FetchResponse<unknown>>
}

const untypedFetch = () => $fetch as unknown as UntypedFetch

export function apiFetch<T = unknown>(url: string, opts?: ApiFetchOptions): Promise<T> {
  return untypedFetch()(url, opts) as Promise<T>
}

apiFetch.raw = function apiFetchRaw<T = unknown>(url: string, opts?: ApiFetchOptions): Promise<FetchResponse<T>> {
  return untypedFetch().raw(url, opts) as Promise<FetchResponse<T>>
}
