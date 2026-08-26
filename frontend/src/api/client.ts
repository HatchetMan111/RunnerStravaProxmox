const TOKEN_KEY = 'lt_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  status: number
  body: unknown

  constructor(status: number, body: unknown) {
    super(`API error ${status}`)
    this.status = status
    this.body = body
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }
  Object.assign(headers, options.headers ?? {})

  const response = await fetch(path, { ...options, headers })
  if (!response.ok) {
    let body: unknown
    try {
      body = await response.json()
    } catch {
      body = await response.text()
    }
    if (response.status === 401 && !path.includes('/auth/')) {
      clearToken()
      window.location.href = '/login'
    }
    throw new ApiError(response.status, body)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export const api = {
  get<T>(path: string): Promise<T> {
    return request<T>(path)
  },
  post<T>(path: string, data?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
    return request<T>(path, {
      method: 'POST',
      body:
        data === undefined
          ? undefined
          : data instanceof FormData
            ? data
            : JSON.stringify(data),
      headers: extraHeaders,
    })
  },
  patch<T>(path: string, data: unknown): Promise<T> {
    return request<T>(path, { method: 'PATCH', body: JSON.stringify(data) })
  },
  delete(path: string): Promise<void> {
    return request<void>(path, { method: 'DELETE' })
  },
}

export interface HealthInfo {
  status: string
  app: string
  version: string
  setup_complete: boolean
}
