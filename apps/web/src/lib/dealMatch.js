// Correspondência APROXIMADA por nome entre uma oferta de supermercado (GET /deals, vinda de panfleto)
// e um produto do catálogo. Funções puras, sem import.meta.env: dá para testar direto no node.
//
// Método:
//  1. Normalização: minúsculas, sem acento, só letras e números separados por espaço
//     (única exceção: o ponto decimal entre dígitos, "1,5kg" -> "1.5kg", para o tamanho continuar inteiro).
//  2. Tamanho/quantidade: "900ml", "1,5kg", "360g", "2l", "12 rolos", "20 unidades", "dúzia", "c/ 12" e "kg" solto
//     (= vendido por quilo) viram códigos canônicos (m:<gramas>, v:<ml>, n:<quantidade>) e SAEM dos tokens.
//  3. Tokens: o que sobra, sem palavras-ligação ("de", "com"...), de embalagem ("pacote", "garrafa"...) nem
//     números soltos ("tipo 1"). "sem X" vira um token só, para "com osso" não casar com "sem osso".
//  4. Similaridade: coeficiente de Dice sobre os CONJUNTOS de tokens: 2·|A∩B| / (|A|+|B|), de 0 a 1.
//     Dice (e não Jaccard) porque o catálogo traz nomes bem mais longos que o panfleto ("Óleo de Soja Soya 900ml"
//     x "Óleo de Soja 900ml"): uma marca a mais custa pouco, mas dois nomes só com a categoria em comum ficam abaixo.
//  5. Trava de tamanho: se os dois nomes têm tamanho da MESMA grandeza (massa, volume ou quantidade) e
//     nenhum valor coincide, não casa, por mais parecidos que sejam ("Creme de Açaí 2L" x "1L").
//     Se só um dos lados informa tamanho, não há trava.
//  6. Corte: similaridade >= MIN_SIMILARITY (0.6). Vários candidatos: maior similaridade; empate, menor preço.
export const MIN_SIMILARITY = 0.6

const STOP = new Set([
  // ligações
  'de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'as', 'os', 'com', 'c', 'em', 'para', 'p', 'no', 'na', 'ao', 'por',
  // embalagem / unidade solta: não identificam o produto
  'pacote', 'pct', 'garrafa', 'pet', 'lata', 'caixa', 'cx', 'pote', 'frasco', 'bandeja', 'sache', 'vidro', 'embalagem',
  'unidade', 'unidades', 'un', 'und', 'unid',
])

export const normalize = (text) =>
  String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/[^a-z0-9.]+/g, ' ')
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const QTY = '(\\d+(?:\\.\\d+)?)\\s*(kg|g|gr|ml|l|lt|litros?|un|und|unid|unidades?|rolos?|folhas?)\\b'
const trimNum = (n) => String(Number(n.toFixed(3)))

/** Separa o texto normalizado em { sizes: Set<'m:1000'|'v:900'|'n:12'>, rest: string }. */
export function extractSizes(norm) {
  const sizes = new Set()
  let rest = norm
  const take = (re, fn) => {
    rest = rest.replace(re, (...m) => {
      const code = fn(...m)
      if (code) sizes.add(code)
      return ' '
    })
  }
  take(new RegExp(QTY, 'g'), (_, num, unit) => {
    const n = parseFloat(num)
    if (unit === 'kg') return `m:${trimNum(n * 1000)}`
    if (unit === 'g' || unit === 'gr') return `m:${trimNum(n)}`
    if (unit === 'l' || unit === 'lt' || unit.startsWith('litro')) return `v:${trimNum(n * 1000)}`
    if (unit === 'ml') return `v:${trimNum(n)}`
    return `n:${trimNum(n)}` // un, unidades, rolos, folhas
  })
  take(/\b(?:c|com)\s+(\d+)\b/g, (_, n) => `n:${n}`) // "c/ 12"
  take(/\bduzia\b/g, () => 'n:12')
  take(/\bkg\b/g, () => 'm:1000') // "kg" solto: vendido por quilo
  return { sizes, rest }
}

/** { tokens: Set<string>, sizes: Set<string> } de um nome. */
export function analyze(name) {
  // "sem osso" vira um token só ("semosso"): "com osso" e "sem osso" são produtos diferentes.
  const { sizes, rest } = extractSizes(normalize(name).replace(/\bsem (\w+)/g, 'sem$1'))
  // Números soltos ("tipo 1", "leve 12 pague 11") não identificam o produto e só inflavam a similaridade.
  const tokens = new Set(rest.split(' ').filter((t) => t && !STOP.has(t) && !/^\d+(\.\d+)?$/.test(t)))
  return { tokens, sizes }
}

/** Coeficiente de Dice entre dois conjuntos de tokens (0 a 1). */
export function dice(a, b) {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return (2 * inter) / (a.size + b.size)
}

/** true se há tamanhos de mesma grandeza dos dois lados e nenhum valor em comum. */
export function sizeConflict(a, b) {
  for (const kind of ['m', 'v', 'n']) {
    const xa = [...a].filter((s) => s[0] === kind)
    const xb = [...b].filter((s) => s[0] === kind)
    if (xa.length && xb.length && !xa.some((s) => xb.includes(s))) return true
  }
  return false
}

/** Similaridade entre dois nomes: 0 quando a trava de tamanho barra, senão o Dice dos tokens. */
export function similarity(nameA, nameB) {
  const a = analyze(nameA)
  const b = analyze(nameB)
  return sizeConflict(a.sizes, b.sizes) ? 0 : dice(a.tokens, b.tokens)
}

// Análise por produto em cache (a lista do catálogo tem milhares de itens e o objeto é estável entre renders).
const cache = new WeakMap()
const analyzed = (p) => {
  let a = cache.get(p)
  if (!a) cache.set(p, (a = analyze(p.name)))
  return a
}

const EPS = 1e-9

/**
 * Produto do catálogo que melhor corresponde à oferta, ou null.
 * @returns {{ product: object, score: number } | null}
 */
export function matchDealToProduct(deal, products) {
  const d = analyze(deal.productName)
  if (d.tokens.size === 0) return null
  let best = null
  for (const p of products) {
    if (p.kind === 'COMBO' || p.kind === 'DAILY_SPECIAL') continue
    const a = analyzed(p)
    if (sizeConflict(d.sizes, a.sizes)) continue
    const score = dice(d.tokens, a.tokens)
    if (score + EPS < MIN_SIMILARITY) continue
    if (!best || score > best.score + EPS || (Math.abs(score - best.score) <= EPS && p.price < best.product.price)) {
      best = { product: p, score }
    }
  }
  return best
}
