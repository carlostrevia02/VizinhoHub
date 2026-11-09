import type { Db } from '../../shared/db.js'
import type { UserDTO } from './auth.types.js'

export interface UserRow {
  id: string
  password_hash: string | null
  firebase_uid: string | null
}

const USER_DTO_SQL = `
  SELECT u.id, u.name, u.email::text AS email, u.role, u.phone,
         CASE WHEN u.role = 'MERCHANT' THEN json_build_object(
           'name', u.store_name, 'neighborhood', u.neighborhood, 'city', u.city, 'state', u.state,
           'latitude', u.latitude::float8, 'longitude', u.longitude::float8) END AS store
    FROM users u`

export async function findUserDtoById(db: Db, id: string): Promise<UserDTO | undefined> {
  const { rows } = await db.query<UserDTO>(`${USER_DTO_SQL} WHERE u.id = $1`, [id])
  return rows[0]
}

export async function findCredentialByEmail(db: Db, email: string): Promise<UserRow | undefined> {
  const { rows } = await db.query<UserRow>('SELECT id, password_hash, firebase_uid FROM users WHERE email = $1', [email])
  return rows[0]
}

export async function findIdByFirebaseUid(db: Db, uid: string): Promise<string | undefined> {
  const { rows } = await db.query<{ id: string }>('SELECT id FROM users WHERE firebase_uid = $1', [uid])
  return rows[0]?.id
}

export async function insertCustomer(
  db: Db,
  u: { name: string; email: string; passwordHash?: string; firebaseUid?: string },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO users (name, email, password_hash, firebase_uid, role) VALUES ($1, $2, $3, $4, 'CUSTOMER') RETURNING id`,
    [u.name, u.email, u.passwordHash ?? null, u.firebaseUid ?? null],
  )
  return rows[0]!.id
}

export async function linkFirebaseUid(db: Db, userId: string, uid: string): Promise<void> {
  await db.query('UPDATE users SET firebase_uid = $2 WHERE id = $1', [userId, uid])
}

export async function updateName(db: Db, userId: string, name: string): Promise<void> {
  await db.query('UPDATE users SET name = $2 WHERE id = $1', [userId, name])
}

export async function updatePhone(db: Db, userId: string, phone: string | null): Promise<void> {
  await db.query('UPDATE users SET phone = $2 WHERE id = $1', [userId, phone])
}

export async function promoteToMerchant(
  db: Db,
  userId: string,
  s: { name: string; neighborhood: string; city: string; state: string },
): Promise<void> {
  await db.query(
    `UPDATE users SET role = 'MERCHANT', store_name = $2, neighborhood = $3, city = $4, state = $5 WHERE id = $1`,
    [userId, s.name, s.neighborhood, s.city, s.state],
  )
}

export async function updateStore(
  db: Db,
  userId: string,
  s: { name?: string; neighborhood?: string; city?: string; state?: string; latitude?: number | null; longitude?: number | null },
): Promise<void> {
  // COALESCE só para campos omitidos; latitude/longitude podem ser limpos com null explícito.
  await db.query(
    `UPDATE users SET
       store_name   = COALESCE($2, store_name),
       neighborhood = COALESCE($3, neighborhood),
       city         = COALESCE($4, city),
       state        = COALESCE($5, state),
       latitude     = CASE WHEN $6::boolean THEN $7::numeric ELSE latitude  END,
       longitude    = CASE WHEN $8::boolean THEN $9::numeric ELSE longitude END
     WHERE id = $1`,
    [userId, s.name ?? null, s.neighborhood ?? null, s.city ?? null, s.state ?? null,
     s.latitude !== undefined, s.latitude ?? null, s.longitude !== undefined, s.longitude ?? null],
  )
}
