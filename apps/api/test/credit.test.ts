// Caderneta (fiado): livro-razão, anti-race do limite, estorno, baixa, ajuste, lembrete com Pix e retenção.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { buildPixPayload, crc16, isValidPixPayload } from '../src/modules/credit/credit.pix.js'
import { runCreditReminders, runCreditRetention } from '../src/modules/credit/credit.jobs.js'
import { LUCIA, MARIA, ZE, startTestEnv, tokenFor, type TestEnv } from './helpers.js'

let t: TestEnv
const ze = () => tokenFor(ZE)
const lucia = () => tokenFor(LUCIA)
const maria = () => tokenFor(MARIA)

const DEZ = 'cccccccc-0000-4000-8000-000000000010' // produto de R$ 10,00 do Zé
const JOAO = '44444444-4444-4444-8444-444444444444' // segundo cliente, sem caderneta

before(async () => {
  t = await startTestEnv()
  await t.db.query(`INSERT INTO products (id, user_id, category_id, name, price, stock_qty) VALUES ($1, $2, 1, 'Marmita fiado R$ 10', 10.00, 1000)`, [DEZ, ZE])
  await t.db.query(
    `INSERT INTO users (id, name, email, password_hash, firebase_uid, role, neighborhood, city)
     SELECT $1, 'João Cliente', 'joao@vizinhohub.test', password_hash, 'seed-joao', 'CUSTOMER', neighborhood, city FROM users WHERE id = $2`,
    [JOAO, MARIA],
  )
  await t.db.query(`UPDATE users SET phone = '(85) 98888-7777' WHERE id = $1`, [MARIA])
})
after(() => t?.stop())

const orderFiado = (token = maria(), merchantProduct = DEZ) =>
  t.api('POST', '/api/orders', { token, body: { items: [{ productId: merchantProduct, quantity: 1 }], paymentMethod: 'credit' } })
const account = async (merchantId = ZE, customerId = MARIA) => (await t.db.query(`SELECT * FROM credit_accounts WHERE merchant_id = $1 AND customer_id = $2`, [merchantId, customerId])).rows[0]
// Invariante do livro: o saldo da conta sempre fecha com a soma dos lançamentos.
const assertLedgerCloses = async () => {
  const { rows } = await t.db.query(
    `SELECT a.id, a.balance::float8 AS balance, COALESCE(sum(l.amount), 0)::float8 AS soma FROM credit_accounts a LEFT JOIN credit_ledger l ON l.account_id = a.id GROUP BY a.id`,
  )
  for (const r of rows) assert.equal(r.balance, r.soma, `conta ${r.id}: saldo ${r.balance} ≠ livro ${r.soma}`)
}

describe('Pix copia e cola (BR Code estático)', () => {
  it('CRC16-CCITT conhecido: "123456789" → 29B1', () => {
    assert.equal(crc16('123456789'), '29B1')
  })

  it('payload com chave, nome, cidade e valor; CRC confere e adulterar quebra', () => {
    const p = buildPixPayload({ key: 'ze@mercadinho.com', merchantName: 'Zé Mercador', city: 'Fortaleza', amount: 45 })
    assert.match(p, /^000201010211/)
    assert.ok(p.includes('0014br.gov.bcb.pix0117ze@mercadinho.com'), 'chave dentro do campo 26')
    assert.ok(p.includes('540545.00'), 'valor')
    assert.ok(p.includes('5802BR'))
    assert.ok(p.includes('5911ZE MERCADOR'), 'nome sem acento em maiúsculas')
    assert.ok(p.includes('6009FORTALEZA'))
    assert.ok(isValidPixPayload(p))
    assert.ok(!isValidPixPayload(p.replace('45.00', '46.00')), 'qualquer alteração invalida o CRC')
  })

  it('normaliza CPF e telefone; sem valor omite o campo 54', () => {
    assert.ok(buildPixPayload({ key: '123.456.789-09', merchantName: 'A', city: 'B' }).includes('011112345678909'))
    const phone = buildPixPayload({ key: '(85) 98888-7777', merchantName: 'A', city: 'B', amount: 1 })
    assert.ok(phone.includes('+5585988887777'))
    assert.ok(!buildPixPayload({ key: 'a@b.co', merchantName: 'A', city: 'B' }).includes('5403'))
    assert.throws(() => buildPixPayload({ key: 'x'.repeat(78), merchantName: 'A', city: 'B' }))
  })
})

describe('contas da caderneta (lojista)', () => {
  it('só lojista abre conta; cliente do próprio bairro é candidato depois de comprar', async () => {
    assert.equal((await t.api('POST', '/api/credit/accounts', { token: maria(), body: { customerId: MARIA, creditLimit: 100 } })).status, 403)
    assert.equal((await t.api('POST', '/api/credit/accounts', { body: { customerId: MARIA, creditLimit: 100 } })).status, 401)
    // Compra comum (sem fiado) para Maria virar candidata.
    const plain = await t.api('POST', '/api/orders', { token: maria(), body: { items: [{ productId: DEZ, quantity: 1 }], paymentMethod: 'cash' } })
    assert.equal(plain.status, 201)
    const cand = await t.api('GET', '/api/credit/candidates', { token: ze() })
    assert.deepEqual(cand.body.map((c: { id: string }) => c.id), [MARIA])
  })

  it('abre a conta com limite R$ 100; duplicada → 409; limite com 3 casas → 400', async () => {
    const res = await t.api('POST', '/api/credit/accounts', { token: ze(), body: { customerId: MARIA, creditLimit: 100, settlementDay: 5 } })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    assert.equal(res.body.creditLimit, 100)
    assert.equal(res.body.balance, 0)
    assert.equal(res.body.available, 100)
    assert.equal(res.body.customer.name, 'Maria Souza')
    assert.equal(res.body.status, 'ACTIVE')
    const dup = await t.api('POST', '/api/credit/accounts', { token: ze(), body: { customerId: MARIA, creditLimit: 50 } })
    assert.equal(dup.status, 409)
    assert.equal(dup.body.error.code, 'CREDIT_ACCOUNT_EXISTS')
    assert.equal((await t.api('POST', '/api/credit/accounts', { token: ze(), body: { customerId: JOAO, creditLimit: 1.005 } })).status, 400)
    assert.equal((await t.api('POST', '/api/credit/accounts', { token: ze(), body: { customerId: ZE, creditLimit: 10 } })).status, 404, 'só clientes')
  })

  it('sem caderneta na loja → 422 NO_CREDIT_ACCOUNT e o pedido não é criado', async () => {
    const before = (await t.db.query(`SELECT count(*)::int AS n FROM orders`)).rows[0].n
    const res = await orderFiado(maria(), 'bbbbbbbb-0000-4000-8000-000000000001') // loja da Lúcia
    assert.equal(res.status, 422)
    assert.equal(res.body.error.code, 'NO_CREDIT_ACCOUNT')
    const joao = await orderFiado(tokenFor(JOAO))
    assert.equal(joao.body.error.code, 'NO_CREDIT_ACCOUNT')
    assert.equal((await t.db.query(`SELECT count(*)::int AS n FROM orders`)).rows[0].n, before)
  })
})

describe('compra no fiado: anti-race do limite', () => {
  let orderIds: string[] = []

  it('20 compras simultâneas de R$ 10 com limite R$ 100 → 10 passam, 10 → 422 CREDIT_LIMIT; saldo = soma do livro', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => orderFiado()))
    const ok = results.filter((r) => r.status === 201)
    const blocked = results.filter((r) => r.status === 422)
    assert.equal(ok.length, 10, results.map((r) => r.status).join(','))
    assert.equal(blocked.length, 10)
    assert.ok(blocked.every((r) => r.body.error.code === 'CREDIT_LIMIT'))
    orderIds = ok.map((r) => r.body.id)

    const acc = await account()
    assert.equal(Number(acc.balance), 100)
    const { rows } = await t.db.query(`SELECT count(*)::int AS n, sum(amount)::float8 AS soma, max(balance_after)::float8 AS topo FROM credit_ledger WHERE account_id = $1 AND kind = 'CHARGE'`, [acc.id])
    assert.deepEqual(rows[0], { n: 10, soma: 100, topo: 100 })
    await assertLedgerCloses()
    // Os 10 recusados não deixaram pedido para trás (rollback).
    const { rows: pend } = await t.db.query(`SELECT count(*)::int AS n FROM orders WHERE customer_id = $1 AND payment_method = 'credit'`, [MARIA])
    assert.equal(pend[0].n, 10)
  })

  it('conta cheia: a próxima compra também é recusada; o limite pode ser baixado abaixo da dívida', async () => {
    assert.equal((await orderFiado()).body.error.code, 'CREDIT_LIMIT')
    const lower = await t.api('PATCH', `/api/credit/accounts/${(await account()).id}`, { token: ze(), body: { creditLimit: 50 } })
    assert.equal(lower.status, 200)
    assert.equal(lower.body.creditLimit, 50)
    assert.equal(lower.body.balance, 100)
    assert.equal(lower.body.available, 0)
    await t.api('PATCH', `/api/credit/accounts/${(await account()).id}`, { token: ze(), body: { creditLimit: 100 } })
  })

  it('cancelar um pedido no fiado lança o estorno e libera o limite', async () => {
    const res = await t.api('PATCH', `/api/orders/${orderIds[0]}/status`, { token: ze(), body: { status: 'CANCELLED' } })
    assert.equal(res.status, 200)
    const acc = await account()
    assert.equal(Number(acc.balance), 90)
    const { rows } = await t.db.query(`SELECT kind, amount::float8 AS amount, balance_after::float8 AS after, order_id FROM credit_ledger WHERE order_id = $1 ORDER BY id`, [orderIds[0]])
    assert.deepEqual(rows.map((r) => [r.kind, r.amount]), [['CHARGE', 10], ['ADJUSTMENT', -10]])
    assert.equal(rows[1].after, 90)
    await assertLedgerCloses()
    assert.equal((await orderFiado()).status, 201, 'o limite liberado volta a servir')
    await t.api('PATCH', `/api/orders/${orderIds[1]}/status`, { token: ze(), body: { status: 'CANCELLED' } })
    assert.equal(Number((await account()).balance), 90)
  })

  it('o livro é só-inserção: UPDATE/DELETE direto não é feito pela API; extrato do cliente e do lojista', async () => {
    const id = (await account()).id
    const cust = await t.api('GET', `/api/credit/accounts/${id}/ledger`, { token: maria() })
    assert.equal(cust.status, 200)
    assert.equal(cust.body.account.balance, 90)
    assert.ok(cust.body.entries.length >= 12)
    const sum = cust.body.entries.reduce((s: number, e: { amount: number }) => s + e.amount, 0)
    assert.equal(Math.round(sum * 100) / 100, 90, 'o extrato soma o saldo')
    assert.equal((await t.api('GET', `/api/credit/accounts/${id}/ledger`, { token: ze() })).status, 200)
  })
})

describe('baixa de pagamento e ajuste', () => {
  it('registra pagamento (balance cai, lançamento negativo com método e nota)', async () => {
    const id = (await account()).id
    const res = await t.api('POST', `/api/credit/accounts/${id}/payments`, { token: ze(), body: { amount: 30, paymentMethod: 'PIX', note: 'Pix recebido' } })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    assert.equal(res.body.balance, 60)
    const { rows } = await t.db.query(`SELECT kind, amount::float8 AS amount, balance_after::float8 AS after, payment_method, note, created_by FROM credit_ledger WHERE account_id = $1 AND kind = 'PAYMENT'`, [id])
    assert.deepEqual(rows, [{ kind: 'PAYMENT', amount: -30, after: 60, payment_method: 'PIX', note: 'Pix recebido', created_by: ZE }])
    await assertLedgerCloses()
  })

  it('pagamento maior que a dívida → 422; valor 0, negativo ou 3 casas → 400', async () => {
    const id = (await account()).id
    const over = await t.api('POST', `/api/credit/accounts/${id}/payments`, { token: ze(), body: { amount: 60.01 } })
    assert.equal(over.status, 422)
    assert.equal(over.body.error.code, 'PAYMENT_EXCEEDS_BALANCE')
    for (const amount of [0, -5, 1.234]) assert.equal((await t.api('POST', `/api/credit/accounts/${id}/payments`, { token: ze(), body: { amount } })).status, 400)
    assert.equal(Number((await account()).balance), 60)
  })

  it('pagamentos simultâneos nunca passam do saldo (4 × R$ 20 com dívida de R$ 60 → 3 passam)', async () => {
    const id = (await account()).id
    const results = await Promise.all(Array.from({ length: 4 }, () => t.api('POST', `/api/credit/accounts/${id}/payments`, { token: ze(), body: { amount: 20 } })))
    assert.equal(results.filter((r) => r.status === 201).length, 3)
    assert.equal(Number((await account()).balance), 0)
    await assertLedgerCloses()
    // volta a dívida para os próximos testes (ajuste positivo com nota)
    const adj = await t.api('POST', `/api/credit/accounts/${id}/adjustments`, { token: ze(), body: { amount: 55, note: 'Saldo anterior do caderno de papel' } })
    assert.equal(adj.status, 201)
    assert.equal(adj.body.balance, 55)
  })

  it('ajuste exige nota e valor ≠ 0; ajuste negativo reduz; não deixa a dívida negativa', async () => {
    const id = (await account()).id
    assert.equal((await t.api('POST', `/api/credit/accounts/${id}/adjustments`, { token: ze(), body: { amount: -5 } })).status, 400)
    assert.equal((await t.api('POST', `/api/credit/accounts/${id}/adjustments`, { token: ze(), body: { amount: 0, note: 'x' } })).status, 400)
    const neg = await t.api('POST', `/api/credit/accounts/${id}/adjustments`, { token: ze(), body: { amount: -5, note: 'Desconto combinado' } })
    assert.equal(neg.body.balance, 50)
    const below = await t.api('POST', `/api/credit/accounts/${id}/adjustments`, { token: ze(), body: { amount: -50.01, note: 'erro' } })
    assert.equal(below.status, 422)
    assert.equal(below.body.error.code, 'ADJUSTMENT_BELOW_ZERO')
    await assertLedgerCloses()
  })
})

describe('lembrete (texto + wa.me + Pix copia e cola)', () => {
  it('sem chave Pix cadastrada: texto e link sem Pix', async () => {
    const id = (await account()).id
    const res = await t.api('POST', `/api/credit/accounts/${id}/reminder`, { token: ze() })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(res.body.pixCopyPaste, null)
    assert.equal(res.body.amount, 50)
    assert.ok(res.body.text.includes('R$ 50,00'))
    assert.ok(res.body.whatsappUrl.startsWith('https://wa.me/5585988887777?text='))
  })

  it('com a chave Pix do lojista: o payload tem o valor devido e o CRC confere', async () => {
    const settings = (await t.api('GET', '/api/stores/me/settings', { token: ze() })).body
    assert.equal(settings.pixKey, null)
    const save = await t.api('PUT', '/api/stores/me/settings', { token: ze(), body: { ...settings, pixKey: 'ze@mercadinho.com' } })
    assert.equal(save.status, 200, JSON.stringify(save.body))
    assert.equal(save.body.pixKey, 'ze@mercadinho.com')
    // Omitir o campo mantém a chave; a página pública da loja nunca a expõe.
    const { pixKey: _omit, ...withoutKey } = save.body
    assert.equal((await t.api('PUT', '/api/stores/me/settings', { token: ze(), body: withoutKey })).body.pixKey, 'ze@mercadinho.com')
    const pub = await t.api('GET', `/api/stores/${ZE}`)
    assert.equal(pub.status, 200)
    assert.equal('pixKey' in pub.body.settings, false)

    const id = (await account()).id
    const res = await t.api('POST', `/api/credit/accounts/${id}/reminder`, { token: ze() })
    assert.equal(res.status, 200)
    const pix: string = res.body.pixCopyPaste
    assert.ok(isValidPixPayload(pix), 'CRC16 confere')
    assert.ok(pix.includes('ze@mercadinho.com'))
    assert.ok(pix.includes('540550.00'), 'valor da dívida')
    const text = decodeURIComponent(res.body.whatsappUrl.split('?text=')[1])
    assert.equal(text, res.body.text)
    assert.ok(text.includes(pix))
    assert.ok((await account()).last_reminder_at, 'marca o último lembrete')
  })

  it('conta sem dívida → 422 NOTHING_OWED', async () => {
    await t.api('POST', '/api/credit/accounts', { token: ze(), body: { customerId: JOAO, creditLimit: 20 } })
    const joao = await account(ZE, JOAO)
    const res = await t.api('POST', `/api/credit/accounts/${joao.id}/reminder`, { token: ze() })
    assert.equal(res.status, 422)
    assert.equal(res.body.error.code, 'NOTHING_OWED')
  })
})

describe('permissões', () => {
  it('cliente só vê as próprias contas; outra loja não mexe na conta alheia (404)', async () => {
    const mine = await t.api('GET', '/api/credit/mine', { token: maria() })
    assert.equal(mine.status, 200)
    assert.equal(mine.body.length, 1)
    assert.equal(mine.body[0].merchant.id, ZE)
    assert.equal(mine.body[0].balance, 50)
    assert.deepEqual((await t.api('GET', '/api/credit/mine', { token: tokenFor(JOAO) })).body.map((a: { balance: number }) => a.balance), [0])

    const id = (await account()).id
    assert.equal((await t.api('GET', `/api/credit/accounts/${id}/ledger`, { token: tokenFor(JOAO) })).status, 404)
    assert.equal((await t.api('GET', `/api/credit/accounts/${id}/ledger`, { token: lucia() })).status, 404)
    assert.equal((await t.api('POST', `/api/credit/accounts/${id}/payments`, { token: lucia(), body: { amount: 1 } })).status, 404)
    assert.equal((await t.api('POST', `/api/credit/accounts/${id}/adjustments`, { token: lucia(), body: { amount: 1, note: 'x' } })).status, 404)
    assert.equal((await t.api('PATCH', `/api/credit/accounts/${id}`, { token: lucia(), body: { creditLimit: 9999 } })).status, 404)
    assert.equal((await t.api('POST', `/api/credit/accounts/${id}/reminder`, { token: lucia() })).status, 404)
    assert.deepEqual((await t.api('GET', '/api/credit/accounts', { token: lucia() })).body, [])
    // Cliente não gerencia nada.
    for (const [m, url, body] of [
      ['GET', '/api/credit/accounts', undefined],
      ['POST', `/api/credit/accounts/${id}/payments`, { amount: 1 }],
      ['PATCH', `/api/credit/accounts/${id}`, { creditLimit: 999 }],
      ['POST', `/api/credit/accounts/${id}/reminder`, undefined],
    ] as const) assert.equal((await t.api(m, url, { token: maria(), body })).status, 403, `${m} ${url}`)
    assert.equal((await t.api('GET', '/api/credit/accounts')).status, 401)
    assert.equal((await t.api('GET', '/api/credit/mine', { token: ze() })).status, 403)
  })

  it('conta SUSPENSA não compra no fiado; encerrar com dívida é recusado', async () => {
    const id = (await account()).id
    assert.equal((await t.api('PATCH', `/api/credit/accounts/${id}`, { token: ze(), body: { status: 'CLOSED' } })).body.error.code, 'ACCOUNT_HAS_DEBT')
    await t.api('PATCH', `/api/credit/accounts/${id}`, { token: ze(), body: { status: 'SUSPENDED' } })
    assert.equal((await orderFiado()).body.error.code, 'NO_CREDIT_ACCOUNT')
    await t.api('PATCH', `/api/credit/accounts/${id}`, { token: ze(), body: { status: 'ACTIVE' } })
  })
})

describe('jobs: lembretes e retenção de 5 anos', () => {
  it('lembra só quem está há mais de N dias sem pagar e respeita o intervalo mínimo', async () => {
    const acc = await account()
    const pushed: string[][] = []
    const ops = { pushToUsers: async (ids: string[]) => void pushed.push(ids) } as never
    // Dívida recente: nada a lembrar.
    assert.equal(await runCreditReminders({ db: t.db, ops }, { overdueDays: 30 }), 0)
    // Envelhece o livro: última cobrança e último pagamento há 40 dias; zera o último lembrete.
    await t.db.query(`UPDATE credit_ledger SET created_at = now() - interval '40 days' WHERE account_id = $1`, [acc.id])
    await t.db.query(`UPDATE credit_accounts SET last_reminder_at = NULL WHERE id = $1`, [acc.id])
    assert.equal(await runCreditReminders({ db: t.db, ops }, { overdueDays: 30, minIntervalDays: 7 }), 1)
    await new Promise((r) => setTimeout(r, 50))
    assert.deepEqual(pushed, [[MARIA]])
    // Segunda execução imediata: dentro do intervalo mínimo.
    assert.equal(await runCreditReminders({ db: t.db, ops }, { overdueDays: 30, minIntervalDays: 7 }), 0)
    // Quem já pagou há pouco não é cobrado.
    await t.db.query(`UPDATE credit_accounts SET last_reminder_at = NULL WHERE id = $1`, [acc.id])
    await t.db.query(`UPDATE credit_ledger SET created_at = now() - interval '2 days' WHERE account_id = $1 AND kind = 'PAYMENT' AND id = (SELECT max(id) FROM credit_ledger WHERE account_id = $1 AND kind = 'PAYMENT')`, [acc.id])
    assert.equal(await runCreditReminders({ db: t.db, ops }, { overdueDays: 30 }), 0)
  })

  it('retenção: apaga conta quitada e parada há 5 anos (livro + conta); preserva dívida e movimento recente', async () => {
    const mk = async (id: string, customerEmail: string, balance: string, ageYears: number, ledgerAgeYears: number) => {
      const cid = `5555555${id}-5555-4555-8555-555555555555`
      await t.db.query(
        `INSERT INTO users (id, name, email, password_hash, firebase_uid, role, neighborhood, city)
         SELECT $1, 'Cliente ' || $3, $2, password_hash, 'seed-' || $3, 'CUSTOMER', neighborhood, city FROM users WHERE id = $4`,
        [cid, customerEmail, id, MARIA],
      )
      const acc = await t.db.query(`INSERT INTO credit_accounts (merchant_id, customer_id, credit_limit, balance, created_at) VALUES ($1, $2, 100, $3, now() - make_interval(years => $4)) RETURNING id`, [LUCIA, cid, balance, ageYears])
      const aid = acc.rows[0].id
      // Livro coerente: compra e pagamento (ou só a compra, se há dívida).
      await t.db.query(`INSERT INTO credit_ledger (account_id, kind, amount, balance_after, created_at) VALUES ($1, 'CHARGE', 10, 10, now() - make_interval(years => $2))`, [aid, ledgerAgeYears])
      if (Number(balance) === 0) await t.db.query(`INSERT INTO credit_ledger (account_id, kind, amount, balance_after, created_at) VALUES ($1, 'PAYMENT', -10, 0, now() - make_interval(years => $2))`, [aid, ledgerAgeYears])
      else await t.db.query(`UPDATE credit_ledger SET balance_after = $2 WHERE account_id = $1`, [aid, balance])
      return aid as string
    }
    const velha = await mk('1', 'velha@vizinhohub.test', '0', 6, 6) // quitada e parada há 6 anos → apaga
    const devendo = await mk('2', 'devendo@vizinhohub.test', '10', 6, 6) // 6 anos mas com dívida → fica
    const recente = await mk('3', 'recente@vizinhohub.test', '0', 6, 1) // quitada, mas com lançamento de 1 ano → fica
    const nova = await mk('4', 'nova@vizinhohub.test', '0', 1, 1) // nova → fica
    const out = await runCreditRetention(t.db)
    assert.deepEqual(out, { accounts: 1, entries: 2 })
    const left = (await t.db.query(`SELECT id FROM credit_accounts WHERE id = ANY($1::uuid[])`, [[velha, devendo, recente, nova]])).rows.map((r) => r.id).sort()
    assert.deepEqual(left, [devendo, recente, nova].sort())
    assert.equal((await t.db.query(`SELECT count(*)::int AS n FROM credit_ledger WHERE account_id = $1`, [velha])).rows[0].n, 0)
    await assertLedgerCloses() // o invariante continua valendo para tudo o que sobrou
  })
})
