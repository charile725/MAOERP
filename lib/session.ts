/**
 * Session token 簽章
 *
 * 舊版把 `使用者ID:到期時間` 明文放在 cookie，middleware 只確認格式就放行，
 * 任何人自己捏一個 cookie 就能取得完整權限。改成 HMAC-SHA256 簽章後，
 * 沒有密鑰就偽造不出有效 token。
 *
 * 用 Web Crypto（不是 node:crypto），middleware 的 Edge runtime 與
 * API route 的 Node runtime 都能跑同一份程式碼。
 */

const encoder = new TextEncoder()

/**
 * 簽章密鑰。優先用專屬的 SESSION_SECRET；沒設定時退回 service role key
 * （只在伺服器端使用，不會進到瀏覽器），確保部署不會因為少一個變數就全站登不進去。
 */
function getSecret(): string {
  const secret = process.env.SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) {
    throw new Error('無法簽署 session：SESSION_SECRET 與 SUPABASE_SERVICE_ROLE_KEY 都沒有設定')
  }
  return secret
}

let cachedKey: Promise<CryptoKey> | null = null

function getKey(): Promise<CryptoKey> {
  if (!cachedKey) {
    cachedKey = crypto.subtle.importKey(
      'raw',
      encoder.encode(getSecret()),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    )
  }
  return cachedKey
}

function toBase64Url(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes)
  let binary = ''
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

export type SessionPayload = {
  userId: string
  expiresAt: number
}

/** 產生 `使用者ID.到期時間.簽章` 格式的 token */
export async function createSessionToken(userId: string, expiresAt: number): Promise<string> {
  const payload = `${userId}.${expiresAt}`
  const signature = await crypto.subtle.sign('HMAC', await getKey(), encoder.encode(payload))
  return `${payload}.${toBase64Url(signature)}`
}

/**
 * 驗證 token。簽章不符、格式錯誤或已過期都回傳 null。
 * 簽章比對用 crypto.subtle.verify，本身是常數時間，不會因為比對early-exit洩漏資訊。
 */
export async function verifySessionToken(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null

  const lastDot = token.lastIndexOf('.')
  if (lastDot <= 0) return null

  const payload = token.slice(0, lastDot)
  const signature = fromBase64Url(token.slice(lastDot + 1))
  if (!signature) return null

  let valid: boolean
  try {
    valid = await crypto.subtle.verify(
      'HMAC',
      await getKey(),
      signature as unknown as ArrayBuffer,
      encoder.encode(payload)
    )
  } catch {
    return null
  }
  if (!valid) return null

  const separator = payload.lastIndexOf('.')
  if (separator <= 0) return null

  const userId = payload.slice(0, separator)
  const expiresAt = Number(payload.slice(separator + 1))

  // Number.isFinite 擋掉 NaN —— 舊版用 parseInt，亂碼會變成 NaN 而
  // `Date.now() > NaN` 恆為 false，等於永不過期。
  if (!userId || !Number.isFinite(expiresAt) || Date.now() > expiresAt) return null

  return { userId, expiresAt }
}
