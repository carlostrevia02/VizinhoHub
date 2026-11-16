// Otimizador do Carrinho Inteligente: função pura (sem SQL), exata e sem solver.
// Com N lojas candidatas (≈ 8) testa todos os subconjuntos de 1 a `maxStores` lojas (92 no pior caso) e, em cada
// um, compra cada item na loja mais barata do subconjunto. Custo = itens + taxa de entrega de cada loja usada.
// Dinheiro em centavos inteiros: nada de erro de ponto flutuante nem desempate instável.

export interface OptimizerItem {
  canonicalId: number
  quantity: number // unidades inteiras >= 1
}

export interface OptimizerStore {
  merchantId: string
  /** Taxa de entrega em centavos (0 = retirada ou frete grátis). */
  feeCents: number
}

/** Uma oferta de uma loja por item canônico (já com preço efetivo, ou preço de oferta relâmpago). */
export interface OptimizerOffer<M = unknown> {
  merchantId: string
  canonicalId: number
  priceCents: number
  /** Unidades disponíveis nesta oferta; a oferta só vale se cobrir a quantidade pedida. */
  available: number
  meta?: M
}

export interface PlanLine<M = unknown> {
  canonicalId: number
  merchantId: string
  quantity: number
  unitCents: number
  subtotalCents: number
  meta?: M
}

export interface Plan<M = unknown> {
  /** Lojas usadas, na ordem de entrada (normalmente a mais próxima primeiro). */
  merchantIds: string[]
  lines: PlanLine<M>[]
  itemsCents: number
  feesCents: number
  totalCents: number
  /** Itens que este plano não cobre (nenhuma loja do plano tem a oferta). */
  missing: number[]
}

export interface OptimizeOutput<M = unknown> {
  /** Melhor plano comprando numa loja só (null sem lojas). */
  single: Plan<M> | null
  /** Melhor plano em até `maxStores` lojas (>= tão bom quanto `single`). */
  split: Plan<M> | null
  /** Itens sem oferta em NENHUMA loja candidata. */
  unavailable: number[]
}

/** Todos os subconjuntos de tamanho k, mantendo a ordem de `arr`. */
function* combinations<T>(arr: readonly T[], k: number, start = 0, acc: T[] = []): Generator<T[]> {
  if (acc.length === k) {
    yield [...acc]
    return
  }
  for (let i = start; i < arr.length; i++) {
    acc.push(arr[i]!)
    yield* combinations(arr, k, i + 1, acc)
    acc.pop()
  }
}

/**
 * Ordem de preferência entre planos: cobre mais itens > custo total menor > menos lojas > lojas mais cedo na lista
 * (mais próximas). Determinística: o mesmo problema sempre dá o mesmo plano.
 */
function better(a: Plan<unknown>, b: Plan<unknown> | null, order: Map<string, number>): boolean {
  if (!b) return true
  if (a.missing.length !== b.missing.length) return a.missing.length < b.missing.length
  if (a.totalCents !== b.totalCents) return a.totalCents < b.totalCents
  if (a.merchantIds.length !== b.merchantIds.length) return a.merchantIds.length < b.merchantIds.length
  for (let i = 0; i < a.merchantIds.length; i++) {
    const d = order.get(a.merchantIds[i]!)! - order.get(b.merchantIds[i]!)!
    if (d !== 0) return d < 0
  }
  return false
}

export function optimize<M = unknown>(input: {
  items: OptimizerItem[]
  stores: OptimizerStore[]
  offers: OptimizerOffer<M>[]
  maxStores?: number
}): OptimizeOutput<M> {
  const maxStores = Math.max(1, Math.min(input.maxStores ?? 3, 3))
  const stores = input.stores
  const order = new Map(stores.map((s, i) => [s.merchantId, i]))
  const feeOf = new Map(stores.map((s) => [s.merchantId, s.feeCents]))

  // Melhor oferta de cada (loja, item): a mais barata que cobre a quantidade pedida.
  const best = new Map<string, OptimizerOffer<M>>() // `${loja}|${item}`
  const quantity = new Map(input.items.map((i) => [i.canonicalId, i.quantity]))
  for (const o of input.offers) {
    const qty = quantity.get(o.canonicalId)
    if (qty === undefined || !order.has(o.merchantId) || o.available < qty) continue
    const key = `${o.merchantId}|${o.canonicalId}`
    const cur = best.get(key)
    if (!cur || o.priceCents < cur.priceCents) best.set(key, o)
  }

  const unavailable = input.items.filter((i) => !stores.some((s) => best.has(`${s.merchantId}|${i.canonicalId}`))).map((i) => i.canonicalId)

  const evaluate = (subset: OptimizerStore[]): Plan<M> => {
    const lines: PlanLine<M>[] = []
    const missing: number[] = []
    for (const item of input.items) {
      let pick: OptimizerOffer<M> | null = null
      for (const s of subset) {
        const o = best.get(`${s.merchantId}|${item.canonicalId}`)
        // Empate de preço: a loja que vem antes (mais próxima) fica com o item.
        if (o && (!pick || o.priceCents < pick.priceCents)) pick = o
      }
      if (!pick) {
        missing.push(item.canonicalId)
        continue
      }
      lines.push({
        canonicalId: item.canonicalId,
        merchantId: pick.merchantId,
        quantity: item.quantity,
        unitCents: pick.priceCents,
        subtotalCents: pick.priceCents * item.quantity,
        meta: pick.meta,
      })
    }
    // Só paga frete da loja que de fato vende alguma coisa.
    const used = subset.filter((s) => lines.some((l) => l.merchantId === s.merchantId))
    const itemsCents = lines.reduce((n, l) => n + l.subtotalCents, 0)
    const feesCents = used.reduce((n, s) => n + (feeOf.get(s.merchantId) ?? 0), 0)
    return { merchantIds: used.map((s) => s.merchantId), lines, itemsCents, feesCents, totalCents: itemsCents + feesCents, missing }
  }

  let single: Plan<M> | null = null
  let split: Plan<M> | null = null
  for (let k = 1; k <= Math.min(maxStores, stores.length); k++) {
    for (const subset of combinations(stores, k)) {
      const plan = evaluate(subset)
      if (plan.lines.length === 0) continue
      if (k === 1 && better(plan, single, order)) single = plan
      if (better(plan, split, order)) split = plan
    }
  }
  return { single, split, unavailable }
}
