// Dados de exemplo de VENDAS para o painel de Análises do comerciante Zé (ze@vizinhohub.test), só em desenvolvimento.
//   npm run seed-demo-sales                  → apaga o que este script criou antes e recria ~30 dias de vendas
//   npm run seed-demo-sales -- --clean       → só apaga o que o script criou
//   npm run seed-demo-sales -- --demo-products → usa ~20 produtos demo (em vez de produtos reais do Zé)
//
// O que cria (tudo numa transação; rodar de novo não duplica):
//  * 25 clientes demo-cliente-NN@vizinhohub.test (senha "vizinho123", a mesma do seed);
//  * ~30 dias de pedidos online do Zé (2–6 por dia, picos às 12h e 18–19h de Fortaleza) com itens de produtos reais do Zé;
//  * 1 fonte de encarte (flyer:demo-sales:ze) com 4 encartes SUCCESS, 12 ofertas e ~60 cupons (REDEEMED/EXPIRED/ACTIVE);
//  * eventos da vitrine (store_events) para uma conversão de ~11 %.
// Marcas usadas na limpeza: e-mails demo-cliente-*, deal_sources.url = 'flyer:demo-sales:ze' (e o que pende dela:
// encartes, ofertas, cupons), session_id de store_events com prefixo dead5a1e- e produtos do Zé com a descrição DEMO_MARK.
// Nada do seed fixo nem de outros comerciantes é tocado. Os pedidos NÃO baixam estoque (são histórico).
import { parseArgs } from 'node:util'
import { createPool, withTransaction, type DbClient } from '../src/shared/db.js'
import { loadEnv } from '../src/shared/env.js'

const ZE_ID = '11111111-1111-4111-8111-111111111111'
const ZE_EMAIL = 'ze@vizinhohub.test'
const SOURCE_URL = 'flyer:demo-sales:ze'
const CHAIN_SLUG = 'sao-luiz'
const SESSION_PREFIX = 'dead5a1e'
const DEMO_MARK = 'Produto de demonstração (npm run seed-demo-sales)'
const EMAIL_PATTERN = 'demo-cliente-%@vizinhohub.test'
const DAYS = 30
const CONVERSION = 0.11 // compras ÷ sessões da vitrine

const { values: args } = parseArgs({
  options: { clean: { type: 'boolean', default: false }, 'demo-products': { type: 'boolean', default: false } },
})
const env = loadEnv()
if (env.NODE_ENV === 'production') throw new Error('seed-demo-sales não roda em produção.')

// ---------------------------------------------------------------------------------------------------------------
// Aleatoriedade determinística (mulberry32): a estrutura dos dados é a mesma a cada execução.
// ---------------------------------------------------------------------------------------------------------------
let state = 20260601
function rand(): number {
  state = (state + 0x6d2b79f5) | 0
  let t = Math.imul(state ^ (state >>> 15), 1 | state)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1))
const chance = (p: number) => rand() < p
function pick<T>(list: readonly T[]): T {
  return list[Math.floor(rand() * list.length)]!
}
function weighted<T>(items: readonly T[], weights: readonly number[]): T {
  const total = weights.reduce((s, w) => s + w, 0)
  let r = rand() * total
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]!
    if (r < 0) return items[i]!
  }
  return items[items.length - 1]!
}
function shuffle<T>(list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[list[i], list[j]] = [list[j]!, list[i]!]
  }
  return list
}

// Horário de compra em Fortaleza: picos às 12h e entre 18h e 19h.
const HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]
const HOUR_WEIGHTS = [1, 2, 3, 4, 6, 12, 8, 4, 3, 4, 7, 11, 11, 5, 2]
const pickHour = () => weighted(HOURS, HOUR_WEIGHTS)

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const round2 = (n: number) => Math.round(n * 100) / 100

// ---------------------------------------------------------------------------------------------------------------
// Dados de referência
// ---------------------------------------------------------------------------------------------------------------
const CUSTOMER_NAMES = [
  'Ana Beatriz Lima', 'Carlos Eduardo Pinto', 'Fernanda Albuquerque', 'João Pedro Moreira', 'Mariana Cavalcante',
  'Rafael Nogueira', 'Juliana Bezerra', 'Lucas Gabriel Matos', 'Patrícia Holanda', 'Thiago Menezes',
  'Camila Rodrigues', 'Antônio Carlos Freitas', 'Larissa Sampaio', 'Francisco Nunes', 'Beatriz Teixeira',
  'Gustavo Vasconcelos', 'Renata Aragão', 'Matheus Lopes', 'Aline Monteiro', 'Pedro Henrique Castro',
  'Vanessa Gomes', 'Diego Ximenes', 'Isabela Fontenele', 'Rodrigo Pacheco', 'Luciana Barros',
]
const DEMO_PRODUCTS: { name: string; category: string; price: number; unit: string }[] = [
  { name: 'Arroz Agulhinha Tipo 1 5kg', category: 'Mercearia', price: 29.9, unit: 'Unidade' },
  { name: 'Feijão Carioca 1kg', category: 'Mercearia', price: 8.49, unit: 'Unidade' },
  { name: 'Açúcar Refinado 1kg', category: 'Mercearia', price: 4.69, unit: 'Unidade' },
  { name: 'Óleo de Soja 900ml', category: 'Mercearia', price: 7.99, unit: 'Unidade' },
  { name: 'Café Torrado e Moído 500g', category: 'Mercearia', price: 21.9, unit: 'Unidade' },
  { name: 'Macarrão Espaguete 500g', category: 'Mercearia', price: 4.29, unit: 'Unidade' },
  { name: 'Farinha de Trigo 1kg', category: 'Mercearia', price: 5.49, unit: 'Unidade' },
  { name: 'Leite Integral Caixa 1L', category: 'Frios e Laticínios', price: 5.99, unit: 'Unidade' },
  { name: 'Queijo Mussarela Fatiado 200g', category: 'Frios e Laticínios', price: 13.9, unit: 'Unidade' },
  { name: 'Manteiga com Sal 200g', category: 'Frios e Laticínios', price: 11.5, unit: 'Unidade' },
  { name: 'Presunto Fatiado 200g', category: 'Frios e Laticínios', price: 9.9, unit: 'Unidade' },
  { name: 'Refrigerante Cola 2L', category: 'Bebidas', price: 9.49, unit: 'Unidade' },
  { name: 'Suco de Laranja 1L', category: 'Bebidas', price: 7.2, unit: 'Unidade' },
  { name: 'Água Mineral 1,5L', category: 'Bebidas', price: 2.8, unit: 'Unidade' },
  { name: 'Pão Francês', category: 'Padaria', price: 14.9, unit: 'Kg' },
  { name: 'Pão de Forma Tradicional 500g', category: 'Padaria', price: 8.9, unit: 'Unidade' },
  { name: 'Detergente Líquido 500ml', category: 'Limpeza', price: 2.99, unit: 'Unidade' },
  { name: 'Sabão em Pó 1,6kg', category: 'Limpeza', price: 24.9, unit: 'Unidade' },
  { name: 'Papel Higiênico 12 rolos', category: 'Higiene', price: 21.9, unit: 'Unidade' },
  { name: 'Creme Dental 90g', category: 'Higiene', price: 4.5, unit: 'Unidade' },
]

// Ofertas do encarte (preço "de" → "por"). `share` = popularidade relativa entre os cupons.
interface DealSeed { name: string; brand: string | null; category: string; unit: string; minQty: number; original: number; discount: number; share: number }
const DEALS: DealSeed[] = [
  { name: 'Ovos Brancos Dúzia', brand: null, category: 'Laticínios e Ovos', unit: 'un', minQty: 1, original: 20, discount: 14, share: 10 },
  { name: 'Leite Integral Caixa 1L', brand: 'Italac', category: 'Laticínios e Ovos', unit: 'l', minQty: 2, original: 6.49, discount: 4.99, share: 6 },
  { name: 'Arroz Agulhinha Tipo 1 5kg', brand: 'Camil', category: 'Mercearia', unit: 'pacote', minQty: 1, original: 32.9, discount: 26.9, share: 6 },
  { name: 'Feijão Carioca 1kg', brand: 'Kicaldo', category: 'Mercearia', unit: 'pacote', minQty: 2, original: 9.8, discount: 7.2, share: 5 },
  { name: 'Café Torrado e Moído 500g', brand: 'Santa Clara', category: 'Mercearia', unit: 'pacote', minQty: 1, original: 24.9, discount: 18.9, share: 7 },
  { name: 'Óleo de Soja 900ml', brand: 'Liza', category: 'Mercearia', unit: 'un', minQty: 3, original: 8.99, discount: 6.49, share: 4 },
  { name: 'Frango Inteiro Congelado', brand: 'Seara', category: 'Açougue e Peixaria', unit: 'kg', minQty: 1, original: 12.9, discount: 9.9, share: 5 },
  { name: 'Pão de Forma Tradicional 500g', brand: 'Wickbold', category: 'Padaria e Matinais', unit: 'pacote', minQty: 1, original: 8.9, discount: 6.5, share: 4 },
  { name: 'Refrigerante Cola 2L', brand: 'Coca-Cola', category: 'Bebidas', unit: 'un', minQty: 2, original: 10.5, discount: 7.99, share: 5 },
  { name: 'Papel Higiênico 12 rolos', brand: 'Neve', category: 'Higiene e Beleza', unit: 'pacote', minQty: 1, original: 24.9, discount: 16.9, share: 3 },
  { name: 'Sabão em Pó 1,6kg', brand: 'Omo', category: 'Limpeza', unit: 'un', minQty: 1, original: 28.9, discount: 15.9, share: 3 },
  { name: 'Banana Prata', brand: null, category: 'Hortifrúti', unit: 'kg', minQty: 1, original: 7.99, discount: 4.99, share: 5 },
]

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const newCode = (used: Set<string>) => {
  for (;;) {
    const code = Array.from({ length: 8 }, () => CODE_ALPHABET[int(0, CODE_ALPHABET.length - 1)]).join('')
    if (!used.has(code)) {
      used.add(code)
      return code
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Limpeza: só o que o script criou
// ---------------------------------------------------------------------------------------------------------------
async function clean(tx: DbClient): Promise<void> {
  await tx.query(`DELETE FROM store_events WHERE merchant_id = $1 AND session_id::text LIKE $2`, [ZE_ID, `${SESSION_PREFIX}-%`])
  await tx.query(
    `DELETE FROM deal_coupons
      WHERE deal_id IN (SELECT d.id FROM deals d JOIN deal_sources s ON s.id = d.source_id WHERE s.url = $1)
         OR customer_id IN (SELECT id FROM users WHERE email LIKE $2 AND role = 'CUSTOMER')`,
    [SOURCE_URL, EMAIL_PATTERN],
  )
  await tx.query(`DELETE FROM orders WHERE customer_id IN (SELECT id FROM users WHERE email LIKE $1 AND role = 'CUSTOMER')`, [EMAIL_PATTERN])
  await tx.query(`DELETE FROM deals WHERE source_id IN (SELECT id FROM deal_sources WHERE url = $1)`, [SOURCE_URL])
  await tx.query(`DELETE FROM flyer_uploads WHERE source_id IN (SELECT id FROM deal_sources WHERE url = $1)`, [SOURCE_URL])
  await tx.query(`DELETE FROM deal_sources WHERE url = $1`, [SOURCE_URL])
  const demoProducts = `SELECT id FROM products WHERE user_id = $1 AND description = $2`
  // Tabela legada do antigo livro de estoque (não é mais escrita); linhas antigas ainda travariam o DELETE dos produtos.
  await tx.query(`DELETE FROM stock_movements WHERE product_id IN (${demoProducts})`, [ZE_ID, DEMO_MARK])
  await tx.query(`DELETE FROM order_items WHERE product_id IN (${demoProducts})`, [ZE_ID, DEMO_MARK])
  await tx.query(`DELETE FROM products WHERE user_id = $1 AND description = $2`, [ZE_ID, DEMO_MARK])
  await tx.query(`DELETE FROM users WHERE email LIKE $1 AND role = 'CUSTOMER'`, [EMAIL_PATTERN])
}

// ---------------------------------------------------------------------------------------------------------------
interface Product { id: string; price: number }
interface Customer { id: string; name: string; phone: string }
interface Ev { session: string; user: string | null; type: string; product: string | null; at: Date }

async function seed(tx: DbClient) {
  // "Hoje" e o instante atual no banco (dia de Fortaleza). Fortaleza não tem horário de verão: UTC-3 fixo.
  const { rows: clock } = await tx.query<{ today: string; now: Date }>(`SELECT (now() AT TIME ZONE 'America/Fortaleza')::date::text AS today, now() AS now`)
  const today = clock[0]!.today
  const now = clock[0]!.now.getTime()
  const at = (dayOffset: number, hour: number, minute: number, second = 0): number => {
    const d = new Date(`${today}T00:00:00-03:00`).getTime() - dayOffset * DAY
    return d + hour * HOUR + minute * MIN + second * 1000
  }

  // ---- clientes ----
  const { rows: hashRows } = await tx.query<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [ZE_ID])
  const passwordHash = hashRows[0]!.password_hash
  const customers: Customer[] = []
  for (const [i, name] of CUSTOMER_NAMES.entries()) {
    const n = String(i + 1).padStart(2, '0')
    const phone = `(85) 9${int(8000, 9999)}-${int(1000, 9999)}`
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO users (name, email, password_hash, firebase_uid, role, phone, created_at)
       VALUES ($1, $2, $3, $4, 'CUSTOMER', $5, $6) RETURNING id`,
      [name, `demo-cliente-${n}@vizinhohub.test`, passwordHash, `seed-demo-cliente-${n}`, phone, new Date(at(DAYS + 5, 9, 0))],
    )
    customers.push({ id: rows[0]!.id, name, phone })
  }
  // Recorrentes: os 5 primeiros compram bem mais que o resto.
  const customerWeights = customers.map((_, i) => (i < 5 ? [8, 6, 5, 4, 3][i]! : 1 + (i % 3)))

  // ---- produtos ----
  let products: Product[] = []
  let createdProducts = 0
  if (!args['demo-products']) {
    const { rows } = await tx.query<{ id: string; price: string }>(
      `SELECT id, price FROM products
        WHERE user_id = $1 AND active AND kind = 'ITEM' AND price BETWEEN 2 AND 45
          AND (description IS DISTINCT FROM $2)
        ORDER BY id`,
      [ZE_ID, DEMO_MARK],
    )
    products = shuffle(rows.map((r) => ({ id: r.id, price: Number(r.price) }))).slice(0, 60)
  }
  if (products.length < 15) {
    const { rows: cats } = await tx.query<{ id: number; name: string }>(`SELECT id, name FROM categories WHERE name = ANY($1::text[])`, [[...new Set(DEMO_PRODUCTS.map((p) => p.category))]])
    const catId = new Map(cats.map((c) => [c.name, c.id]))
    for (const p of DEMO_PRODUCTS) {
      const category = catId.get(p.category)
      if (!category) throw new Error(`Categoria "${p.category}" não existe (rode o seed do banco).`)
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO products (user_id, category_id, name, description, price, unit)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [ZE_ID, category, `${p.name} (demo)`, DEMO_MARK, p.price, p.unit],
      )
      products.push({ id: rows[0]!.id, price: p.price })
      createdProducts++
    }
  }
  const productWeights = products.map((_, i) => 1 / (i + 1) ** 0.9) // poucos produtos vendem muito (Curva ABC)

  const events: Ev[] = []
  let sessionSeq = 0
  const newSession = () => `${SESSION_PREFIX}-0000-4000-8000-${(++sessionSeq).toString(16).padStart(12, '0')}`

  // ---- pedidos online ----
  let orderCount = 0
  let buyerSessions = 0
  for (let day = DAYS - 1; day >= 0; day--) {
    const dow = new Date(`${today}T12:00:00-03:00`).getTime() - day * DAY
    const weekday = new Date(dow).getUTCDay() // 0 = domingo
    let perDay = int(2, 6)
    if ((weekday === 5 || weekday === 6) && chance(0.4)) perDay = Math.min(6, perDay + 1)
    for (let k = 0; k < perDay; k++) {
      const createdAt = at(day, pickHour(), int(0, 59), int(0, 59))
      if (createdAt > now - 10 * MIN) continue // ainda não aconteceu
      const customer = weighted(customers, customerWeights)
      const hoursAgo = (now - createdAt) / HOUR
      let status: string
      if (chance(hoursAgo < 5 ? 0.85 : hoursAgo < 30 ? 0.25 : 0)) status = weighted(['PENDING', 'IN_PREPARATION', 'READY'], [4, 3, 3])
      else status = chance(0.1) ? 'CANCELLED' : 'COMPLETED'

      // 1 a 4 itens distintos (UNIQUE order_id + product_id), quantidade 1 a 3 (itens baratos podem levar mais).
      const lineCount = weighted([1, 2, 3, 4], [30, 35, 25, 10])
      const chosen = new Map<string, { product: Product; quantity: number }>()
      while (chosen.size < Math.min(lineCount, products.length)) {
        const product = weighted(products, productWeights)
        if (chosen.has(product.id)) continue
        chosen.set(product.id, { product, quantity: product.price < 8 ? int(1, 5) : int(1, 3) })
      }
      const lines = [...chosen.values()]
      const totalCents = lines.reduce((s, l) => s + Math.round(l.quantity * l.product.price * 100), 0)
      const payment = weighted(['pix', 'card', 'cash', null], [45, 30, 15, 10])
      const updatedAt = status === 'PENDING' ? createdAt : createdAt + (status === 'CANCELLED' ? int(5, 30) : int(15, 60)) * MIN

      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO orders (customer_id, merchant_id, channel, total_price, status, contact_name, phone, delivery_method, payment_method, created_at, updated_at)
         VALUES ($1, $2, 'ONLINE', $3, $4, $5, $6, 'Retirada na loja', $7, $8, $9) RETURNING id`,
        [customer.id, ZE_ID, totalCents / 100, status, customer.name, customer.phone, payment, new Date(createdAt), new Date(Math.min(updatedAt, now))],
      )
      await tx.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price)
         SELECT $1, product_id, quantity, unit_price
           FROM unnest($2::uuid[], $3::int[], $4::numeric[]) AS t(product_id, quantity, unit_price)`,
        [rows[0]!.id, lines.map((l) => l.product.id), lines.map((l) => l.quantity), lines.map((l) => l.product.price)],
      )
      orderCount++

      // Sessão da vitrine que gerou o pedido: visita → produto → carrinho → checkout.
      const session = newSession()
      const start = createdAt - int(6, 25) * MIN
      const main = lines[0]!.product.id
      events.push({ session, user: customer.id, type: 'STORE_VIEW', product: null, at: new Date(start) })
      events.push({ session, user: customer.id, type: 'PRODUCT_VIEW', product: main, at: new Date(start + 2 * MIN) })
      events.push({ session, user: customer.id, type: 'ADD_TO_CART', product: main, at: new Date(start + 4 * MIN) })
      events.push({ session, user: customer.id, type: 'CHECKOUT_START', product: null, at: new Date(createdAt - int(1, 3) * MIN) })
      buyerSessions++
    }
  }

  // ---- encartes, ofertas e cupons ----
  const { rows: chainRows } = await tx.query<{ id: number }>(`SELECT id FROM retail_chains WHERE slug = $1`, [CHAIN_SLUG])
  if (!chainRows[0]) throw new Error(`Rede "${CHAIN_SLUG}" não existe em retail_chains.`)
  const chainId = chainRows[0].id
  const { rows: srcRows } = await tx.query<{ id: number }>(
    `INSERT INTO deal_sources (chain_id, url, neighborhood, kind, last_scanned_at, last_status)
     VALUES ($1, $2, 'Aldeota', 'FLYER', $3, 'OK') RETURNING id`,
    [chainId, SOURCE_URL, new Date(now)],
  )
  const sourceId = srcRows[0]!.id
  // Encartes semanais enviados pelo Zé (a conversão de encartes olha o período do envio).
  for (const [i, day] of [28, 21, 14, 7].entries()) {
    const sentAt = new Date(at(day, 9, 15))
    await tx.query(
      `INSERT INTO flyer_uploads (chain_id, uploader_id, source_id, neighborhood, file_name, media_type, size_bytes, status, items_extracted, items_dropped, created_at, finished_at)
       VALUES ($1, $2, $3, 'Aldeota', $4, 'image/jpeg', $5, 'SUCCESS', $6, 0, $7, $8)`,
      [chainId, ZE_ID, sourceId, `demo-sales-encarte-${i + 1}.jpg`, int(300_000, 900_000), DEALS.length, sentAt, new Date(sentAt.getTime() + 20_000)],
    )
  }
  const dealIds: string[] = []
  for (const d of DEALS) {
    const pct = Math.round((1 - d.discount / d.original) * 100)
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO deals (chain_id, source_id, neighborhood, product_name, category, brand, unit, wholesale_min_qty, original_price, discount_price,
                          discount_pct, coupon_eligible, raw_offer_text, first_seen_at, last_seen_at, valid_until)
       VALUES ($1, $2, 'Aldeota', $3, $4, $5, $6, $7, $8, $9, $10, TRUE, $11, $12, $13, $14) RETURNING id`,
      [chainId, sourceId, d.name, d.category, d.brand, d.unit, d.minQty, d.original, d.discount, pct, `${d.name} de R$ ${d.original} por R$ ${d.discount}`,
        new Date(at(DAYS - 1, 9, 15)), new Date(now - HOUR), new Date(now + 7 * DAY)],
    )
    dealIds.push(rows[0]!.id)
  }

  // ~60 cupons de clientes variados: 55 % confirmados, 25 % vencidos, 20 % ativos recentes.
  const usedCodes = new Set<string>()
  const activePairs = new Set<string>()
  const COUPONS = 60
  const nRedeemed = Math.round(COUPONS * 0.55)
  const nExpired = Math.round(COUPONS * 0.25)
  const statuses = [...Array<string>(nRedeemed).fill('REDEEMED'), ...Array<string>(nExpired).fill('EXPIRED'), ...Array<string>(COUPONS - nRedeemed - nExpired).fill('ACTIVE')]
  const dealShares = DEALS.map((d) => d.share)
  const couponCustomerWeights = customers.map((_, i) => (i < 5 ? 3 : 1 + (i % 2)))
  let couponBuyers = 0
  for (const status of statuses) {
    const dealIndex = weighted(DEALS.map((_, i) => i), dealShares)
    const deal = DEALS[dealIndex]!
    let customer = weighted(customers, couponCustomerWeights)
    let createdAt: number
    let redeemedAt: Date | null = null
    if (status === 'ACTIVE') {
      // Um cupom ativo por (oferta, cliente).
      while (activePairs.has(`${dealIndex}:${customer.id}`)) customer = weighted(customers, couponCustomerWeights)
      activePairs.add(`${dealIndex}:${customer.id}`)
      createdAt = now - int(1, 20) * HOUR - int(0, 59) * MIN
    } else if (status === 'EXPIRED') {
      createdAt = at(int(2, DAYS - 1), pickHour(), int(0, 59))
    } else {
      createdAt = at(int(0, DAYS - 1), pickHour(), int(0, 59))
      let redeemed = createdAt + int(20, 360) * MIN
      if (redeemed > now - 5 * MIN) {
        createdAt = at(int(1, DAYS - 1), pickHour(), int(0, 59))
        redeemed = createdAt + int(20, 360) * MIN
      }
      redeemedAt = new Date(redeemed)
      const session = newSession()
      events.push({ session, user: customer.id, type: 'STORE_VIEW', product: null, at: new Date(createdAt - 8 * MIN) })
      events.push({ session, user: customer.id, type: 'PRODUCT_VIEW', product: null, at: new Date(createdAt - 4 * MIN) })
      couponBuyers++
      buyerSessions++
    }
    await tx.query(
      `INSERT INTO deal_coupons (code, deal_id, customer_id, product_name, unit_price, original_price, min_qty, status, created_at, expires_at, redeemed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [newCode(usedCodes), dealIds[dealIndex], customer.id, deal.name, deal.discount, deal.original, deal.minQty, status, new Date(createdAt), new Date(createdAt + DAY), redeemedAt],
    )
  }

  // ---- eventos da vitrine: sessões que só olharam (conversão-alvo CONVERSION sobre as compras) ----
  const validOrders = Number((await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM orders o WHERE o.merchant_id = $1 AND o.status <> 'CANCELLED' AND o.customer_id IN (SELECT id FROM users WHERE email LIKE $2)`, [ZE_ID, EMAIL_PATTERN])).rows[0]!.n)
  const purchases = validOrders + couponBuyers
  const targetSessions = Math.round(purchases / CONVERSION)
  const browsers = Math.max(0, targetSessions - buyerSessions)
  for (let i = 0; i < browsers; i++) {
    const day = chance(0.08) ? 0 : int(0, DAYS - 1)
    let when = at(day, weighted([...HOURS, 22], [...HOUR_WEIGHTS, 1]), int(0, 59), int(0, 59))
    if (when > now - 2 * MIN) when = now - int(10, 600) * MIN
    const session = newSession()
    events.push({ session, user: null, type: 'STORE_VIEW', product: null, at: new Date(when) })
    if (!chance(0.55)) continue
    const views = weighted([1, 2, 3], [55, 30, 15])
    let product = weighted(products, productWeights).id
    for (let v = 0; v < views; v++) {
      product = weighted(products, productWeights).id
      events.push({ session, user: null, type: 'PRODUCT_VIEW', product, at: new Date(when + (v + 1) * 90_000) })
    }
    if (!chance(0.3)) continue
    events.push({ session, user: null, type: 'ADD_TO_CART', product, at: new Date(when + 6 * MIN) })
    if (chance(0.25)) events.push({ session, user: null, type: 'CHECKOUT_START', product: null, at: new Date(when + 9 * MIN) })
  }
  const CHUNK = 1000
  for (let i = 0; i < events.length; i += CHUNK) {
    const part = events.slice(i, i + CHUNK)
    await tx.query(
      `INSERT INTO store_events (merchant_id, session_id, user_id, type, product_id, created_at)
       SELECT $1, session_id, user_id, type, product_id, created_at
         FROM unnest($2::uuid[], $3::uuid[], $4::text[], $5::uuid[], $6::timestamptz[]) AS t(session_id, user_id, type, product_id, created_at)`,
      [ZE_ID, part.map((e) => e.session), part.map((e) => e.user), part.map((e) => e.type), part.map((e) => e.product), part.map((e) => e.at)],
    )
  }

  return { today, customers: customers.length, createdProducts, productPool: products.length, orderCount, events: events.length, sessions: sessionSeq }
}

// ---------------------------------------------------------------------------------------------------------------
async function summary(tx: DbClient, today: string) {
  const q = async <T extends object>(sql: string, params: unknown[] = []) => (await tx.query<T>(sql, params)).rows
  const start = `((($1::date - ${DAYS - 1})::timestamp) AT TIME ZONE 'America/Fortaleza')`
  const end = `((($1::date + 1)::timestamp) AT TIME ZONE 'America/Fortaleza')`
  const orders = await q<{ status: string; n: number; total: string }>(
    `SELECT o.status::text, count(*)::int AS n, coalesce(sum(o.total_price), 0)::text AS total
       FROM orders o WHERE o.merchant_id = '${ZE_ID}' AND o.customer_id IN (SELECT id FROM users WHERE email LIKE '${EMAIL_PATTERN}')
        AND o.created_at >= ${start} AND o.created_at < ${end} GROUP BY 1 ORDER BY 1`, [today])
  const coupons = await q<{ status: string; n: number }>(
    `SELECT k.status::text, count(*)::int AS n FROM deal_coupons k JOIN deals d ON d.id = k.deal_id JOIN deal_sources s ON s.id = d.source_id
      WHERE s.url = '${SOURCE_URL}' GROUP BY 1 ORDER BY 1`)
  const redeemed = (await q<{ n: number; revenue: string; profit: string }>(
    `SELECT count(*)::int AS n, coalesce(sum(k.unit_price * k.min_qty), 0)::text AS revenue, coalesce(sum((k.original_price - k.unit_price) * k.min_qty), 0)::text AS profit
       FROM deal_coupons k JOIN deals d ON d.id = k.deal_id JOIN deal_sources s ON s.id = d.source_id
      WHERE s.url = '${SOURCE_URL}' AND k.status = 'REDEEMED' AND k.redeemed_at >= ${start} AND k.redeemed_at < ${end}`, [today]))[0]!
  const ev = (await q<{ sessions: number; views: number; carts: number; checkouts: number }>(
    `SELECT count(DISTINCT session_id) FILTER (WHERE type = 'STORE_VIEW')::int AS sessions,
            count(DISTINCT session_id) FILTER (WHERE type = 'PRODUCT_VIEW')::int AS views,
            count(DISTINCT session_id) FILTER (WHERE type = 'ADD_TO_CART')::int AS carts,
            count(DISTINCT session_id) FILTER (WHERE type = 'CHECKOUT_START')::int AS checkouts
       FROM store_events WHERE merchant_id = '${ZE_ID}' AND session_id::text LIKE '${SESSION_PREFIX}-%'`))[0]!
  const valid = orders.filter((o) => o.status !== 'CANCELLED')
  const onlineRevenue = valid.reduce((s, o) => s + Number(o.total), 0)
  const onlineOrders = valid.reduce((s, o) => s + o.n, 0)
  return { orders, coupons, redeemed, ev, onlineRevenue, onlineOrders }
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const db = createPool(env.DATABASE_URL)
try {
  const { rows: ze } = await db.query(`SELECT 1 FROM users WHERE id = $1 AND email = $2 AND role = 'MERCHANT'`, [ZE_ID, ZE_EMAIL])
  if (!ze[0]) throw new Error(`O comerciante ${ZE_EMAIL} (${ZE_ID}) não existe neste banco. Rode o seed (db/seed.sql, ou recrie o banco com npm run dev:db) e tente de novo.`)

  if (args.clean) {
    await withTransaction(db, clean)
    console.log('Dados de demonstração de vendas removidos.')
  } else {
    const result = await withTransaction(db, async (tx) => {
      await clean(tx)
      const made = await seed(tx)
      return { made, sum: await summary(tx, made.today) }
    })
    const { made, sum } = result
    console.log(`Dados de demonstração de vendas criados para ${ZE_EMAIL} (${DAYS} dias até ${made.today}).`)
    console.log(`  Clientes demo:       ${made.customers}`)
    console.log(`  Produtos usados:     ${made.productPool} (${made.createdProducts ? `${made.createdProducts} produtos demo criados` : 'produtos reais do Zé'})`)
    console.log(`  Pedidos online:      ${sum.orders.reduce((s, o) => s + o.n, 0)}  [${sum.orders.map((o) => `${o.status}: ${o.n}`).join(', ')}]`)
    console.log(`  Cupons:              ${sum.coupons.reduce((s, c) => s + c.n, 0)}  [${sum.coupons.map((c) => `${c.status}: ${c.n}`).join(', ')}]`)
    console.log(`  Faturamento online:  ${brl(sum.onlineRevenue)} (${sum.onlineOrders} pedidos válidos)`)
    console.log(`  Faturamento cupom:   ${brl(Number(sum.redeemed.revenue))} (${sum.redeemed.n} cupons confirmados)`)
    console.log(`  Lucro dos cupons:    ${brl(Number(sum.redeemed.profit))}`)
    console.log(`  Faturamento total:   ${brl(sum.onlineRevenue + Number(sum.redeemed.revenue))} em ${sum.onlineOrders + sum.redeemed.n} compras`)
    console.log(`  Vitrine (sessões):   ${sum.ev.sessions} visitas · ${sum.ev.views} viram produto · ${sum.ev.carts} no carrinho · ${sum.ev.checkouts} checkout · conversão ${((100 * (sum.onlineOrders + sum.redeemed.n)) / sum.ev.sessions).toFixed(1)} %`)
    console.log(`  Painel: GET /api/v1/analytics/dashboard?startDate=${new Date(new Date(`${made.today}T12:00:00-03:00`).getTime() - (DAYS - 1) * DAY).toISOString().slice(0, 10)}&endDate=${made.today}`)
  }
} finally {
  await db.end()
}
