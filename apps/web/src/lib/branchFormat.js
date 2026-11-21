// Filial mais próxima de uma oferta (`deal.nearestBranch`, vindo de GET /deals?lat=&lng=).
// Só funções puras (sem rede nem DOM), reexportadas por lib/deals.js.

const isNum = (n) => typeof n === 'number' && Number.isFinite(n)

// '850 m' abaixo de 1000 m; '1,2 km' (vírgula decimal) a partir daí.
export function formatDistance(meters) {
  if (!isNum(meters) || meters < 0) return ''
  const m = Math.round(meters)
  if (m < 1000) return `${m} m`
  return `${(m / 1000).toFixed(1).replace('.', ',')} km`
}

// '~6 min'; a partir de 60 min, '1 h 05 min'. Nunca abaixo de '~1 min' (o tempo da API é arredondado).
export function formatDuration(seconds) {
  if (!isNum(seconds) || seconds < 0) return ''
  const total = Math.max(1, Math.round(seconds / 60))
  if (total < 60) return `~${total} min`
  const h = Math.floor(total / 60)
  const min = String(total % 60).padStart(2, '0')
  return `~${h} h ${min} min`
}

// Frase final da linha da filial. Devolve null quando não há o que mostrar (sem erro, sem texto).
//   { atBranch: true,  name, text: 'Você está nesta filial · Nome' }
//   { atBranch: false, name, text: 'Nome · 1,2 km · ~6 min de moto', title? }   (title = 'Tempo estimado…' se estimated)
export function branchLine(nearestBranch) {
  const b = nearestBranch
  const name = typeof b?.name === 'string' ? b.name.trim() : ''
  if (!name) return null
  if (b.atBranch === true) return { atBranch: true, name, text: `Você está nesta filial · ${name}` }
  const distance = formatDistance(b.distanceM)
  const duration = formatDuration(b.durationS)
  if (!distance || !duration) return null
  return {
    atBranch: false,
    name,
    text: `${name} · ${distance} · ${duration} de moto`,
    title: b.estimated === true ? 'Tempo estimado (sem rota real)' : undefined,
  }
}
