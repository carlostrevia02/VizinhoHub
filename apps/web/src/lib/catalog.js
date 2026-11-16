// Catálogo vindo da API (GET /products e /categories). Este módulo só traduz o formato da API para o
// formato que os componentes de vitrine usam; o estado vive em context/CatalogContext.jsx.

// "Frios e Laticínios" → "frioselaticinios" (âncoras /produtos#frioselaticinios e imagens de capa).
export const slugify = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

// Remove acentos e caixa para a busca ("acucar" encontra "Açúcar").
export const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const stockLabel = (stock) => (stock === 0 ? 'Esgotado' : stock <= 5 ? `Restam apenas ${stock}` : 'Em estoque')

/** ProductDTO da API → produto da vitrine. O preço mostrado já é o final (Salva-Estoque aplicado). */
export function adaptProduct(p) {
  return {
    id: p.id,
    code: p.id.slice(0, 8).toUpperCase(),
    name: p.name,
    description: p.description ?? '',
    dept: slugify(p.category.name),
    deptName: p.category.name,
    categoryId: p.category.id,
    price: p.effectivePrice,
    oldPrice: p.discountPct > 0 ? p.price : null,
    discount: p.discountPct,
    stock: p.stockQty,
    stockLabel: stockLabel(p.stockQty),
    unit: p.unit,
    img: p.image,
    expirationDate: p.expirationDate,
    merchantId: p.merchantId,
    store: p.store,
    kind: p.kind ?? 'ITEM', // ITEM | COMBO | DAILY_SPECIAL
    leadTimeHours: p.leadTimeHours ?? 0, // > 0 = encomenda
  }
}

const PLACEHOLDER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="#eef4f0"/>' +
      '<g fill="none" stroke="#9db8aa" stroke-width="10" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M120 150h160l-14 120H134z"/><path d="M165 150v-20a35 35 0 0170 0v20"/></g></svg>',
  )

export const imgSrc = (p) => (p.img ? `/img/${p.img}` : PLACEHOLDER)

export function searchProducts(products, query) {
  const q = norm(query.trim())
  if (!q) return products
  return products.filter((p) => norm(p.name).includes(q) || norm(p.deptName).includes(q))
}
