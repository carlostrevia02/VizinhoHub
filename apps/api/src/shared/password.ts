import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

const KEY_LEN = 64

const derive = (password: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, KEY_LEN, (err, key) => (err ? reject(err) : resolve(key)))
  })

// Formato: scrypt$<salt base64>$<chave base64>. Sem dependência externa.
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await derive(password, salt)
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, key] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !key) return false
  const expected = Buffer.from(key, 'base64')
  const actual = await derive(password, Buffer.from(salt, 'base64'))
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

// Hash descartável: login com e-mail inexistente gasta o mesmo tempo que um existente.
export const DUMMY_HASH = `scrypt$${Buffer.alloc(16).toString('base64')}$${Buffer.alloc(KEY_LEN).toString('base64')}`
