export async function fetcher<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`)
  }
  const json = await res.json()
  if (!json.ok) {
    throw new Error(json.error || 'Unknown error')
  }
  return json.data as T
}

export async function paginatedFetcher<T = unknown>(
  url: string
): Promise<{ data: T; pagination: { page: number; pageSize: number; total: number; totalPages: number } }> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`)
  }
  const json = await res.json()
  if (!json.ok) {
    throw new Error(json.error || 'Unknown error')
  }
  return { data: json.data as T, pagination: json.pagination }
}

export async function rawFetcher<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`)
  }
  const json = await res.json()
  if (!json.ok) {
    throw new Error(json.error || 'Unknown error')
  }
  return json as T
}
