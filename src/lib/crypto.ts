const enc = new TextEncoder()
const dec = new TextDecoder()

export const toB64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

export const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

export const randomToken = (bytes = 32) => toB64(crypto.getRandomValues(new Uint8Array(bytes))).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]!)

export async function hashPassword(password: string, saltB64: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(saltB64), iterations: 100000 }, key, 256)
  return toB64(bits)
}

export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

const keyCache = new Map<string, Promise<{ aes: CryptoKey; mac: CryptoKey }>>()

function keys(secret: string) {
  if (!secret) throw new Error('ENC_KEY is not configured')
  let k = keyCache.get(secret)
  if (!k) {
    const raw = fromB64(secret)
    if (raw.length !== 32) throw new Error('ENC_KEY must be 32 bytes, base64')
    k = Promise.all([
      crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']),
      crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    ]).then(([aes, mac]) => ({ aes, mac }))
    keyCache.set(secret, k)
  }
  return k
}

export async function seal(secret: string, data: unknown) {
  const { aes } = await keys(secret)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, enc.encode(JSON.stringify(data)))
  return `${toB64(iv)}.${toB64(ct)}`
}

export async function unseal<T>(secret: string, blob: string): Promise<T> {
  const { aes } = await keys(secret)
  const [iv, ct] = blob.split('.')
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, aes, fromB64(ct))
  return JSON.parse(dec.decode(pt)) as T
}

export async function blindIndex(secret: string, value: string) {
  const { mac } = await keys(secret)
  return toB64(await crypto.subtle.sign('HMAC', mac, enc.encode(value)))
}
