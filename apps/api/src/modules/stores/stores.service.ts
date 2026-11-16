import type { Db, DbClient } from '../../shared/db.js'
import { AppError } from '../../shared/errors.js'
import { DEFAULT_SETTINGS, type StoreSettings } from './stores.schema.js'

type Queryable = Db | DbClient

export interface PublicStoreDTO {
  id: string
  name: string
  neighborhood: string
  city: string
  state: string | null
  settings: Omit<StoreSettings, 'pixKey'>
}

// O JSON guardado pode ser parcial (loja antiga, campo novo): completa com os padrões, seção por seção.
function withDefaults(stored: Partial<StoreSettings> | null, phone: string | null): StoreSettings {
  const s = stored ?? {}
  return {
    phone: phone ?? DEFAULT_SETTINGS.phone,
    address: s.address ?? DEFAULT_SETTINGS.address,
    hours: { ...DEFAULT_SETTINGS.hours, ...s.hours },
    delivery: { ...DEFAULT_SETTINGS.delivery, ...s.delivery },
    payments: { ...DEFAULT_SETTINGS.payments, ...s.payments },
    pixKey: s.pixKey ?? null,
  }
}

// Usado também pelo módulo de pedidos (regras de entrega e pagamento).
export async function loadSettings(db: Queryable, merchantId: string): Promise<StoreSettings> {
  const { rows } = await db.query<{ store_settings: Partial<StoreSettings>; phone: string | null }>(
    `SELECT store_settings, phone FROM users WHERE id = $1 AND role = 'MERCHANT'`,
    [merchantId],
  )
  if (!rows[0]) throw new AppError(404, 'STORE_NOT_FOUND', 'Loja não encontrada.')
  return withDefaults(rows[0].store_settings, rows[0].phone)
}

export function createStoresService(deps: { db: Db }) {
  const { db } = deps

  async function getPublic(id: string): Promise<PublicStoreDTO> {
    const { rows } = await db.query<{ id: string; store_name: string; neighborhood: string; city: string; state: string | null }>(
      `SELECT id, store_name, neighborhood, city, state FROM users WHERE id = $1 AND role = 'MERCHANT'`,
      [id],
    )
    const row = rows[0]
    if (!row) throw new AppError(404, 'STORE_NOT_FOUND', 'Loja não encontrada.')
    // A chave Pix é do lojista (usada só no lembrete da caderneta): não vai para a vitrine pública.
    const { pixKey, ...settings } = await loadSettings(db, id)
    void pixKey
    return { id: row.id, name: row.store_name, neighborhood: row.neighborhood, city: row.city, state: row.state, settings }
  }

  async function saveSettings(merchantId: string, settings: StoreSettings): Promise<StoreSettings> {
    const { phone, pixKey, ...others } = settings
    // pixKey omitido = mantém a chave atual; null = apaga.
    const rest = { ...others, pixKey: pixKey === undefined ? (await loadSettings(db, merchantId)).pixKey : pixKey }
    await db.query(`UPDATE users SET store_settings = $2::jsonb, phone = $3 WHERE id = $1`, [merchantId, JSON.stringify(rest), phone])
    return loadSettings(db, merchantId)
  }

  return { getPublic, getSettings: (merchantId: string) => loadSettings(db, merchantId), saveSettings }
}

export type StoresService = ReturnType<typeof createStoresService>
