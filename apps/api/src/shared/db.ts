import pg from 'pg'

export type Db = pg.Pool
export type DbClient = pg.PoolClient

export function createPool(connectionString: string): Db {
  // "Hoje" no banco = dia de Fortaleza (Salva-Estoque compara validade com current_date).
  return new pg.Pool({ connectionString, max: 10, options: '-c timezone=America/Fortaleza' })
}

// Executa `work` numa transação: COMMIT se der certo, ROLLBACK em qualquer erro.
export async function withTransaction<T>(db: Db, work: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// NUMERIC chega do pg como string ("4.29"). Dinheiro é calculado em centavos inteiros.
export const toCents = (value: string | number) => Math.round(Number(value) * 100)
export const fromCents = (cents: number) => cents / 100
