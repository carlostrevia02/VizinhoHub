// Baixa a página de uma fonte e devolve só o texto, pronto para o extrator.
export type PageFetcher = (url: string, kind: 'HTML' | 'TEXT') => Promise<string>

// Mais que isso custaria caro em tokens e quase certamente não é um encarte: falha em vez de cortar em silêncio.
export const MAX_CONTENT_CHARS = 300_000

export class FetchError extends Error {}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export function htmlToText(html: string): string {
  // JSON-LD costuma trazer os produtos em sites que montam a página por JavaScript.
  const structured = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]!.trim())
  const text = html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' '
      }
      return ENTITIES[e.toLowerCase()] ?? m
    })
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return [text, ...structured].filter(Boolean).join('\n\n')
}

// robots.txt: respeita Disallow/Allow do nosso user-agent (ou de `*`), vence a regra mais específica.
export function robotsAllows(robots: string, userAgent: string, path: string): boolean {
  const token = userAgent.split(/[\/\s]/)[0]!.toLowerCase()
  const groups: { agents: string[]; rules: { allow: boolean; prefix: string }[] }[] = []
  let current: (typeof groups)[number] | undefined
  let lastWasAgent = false
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    const i = line.indexOf(':')
    if (i === -1) continue
    const field = line.slice(0, i).trim().toLowerCase()
    const value = line.slice(i + 1).trim()
    if (field === 'user-agent') {
      if (!lastWasAgent || !current) groups.push((current = { agents: [], rules: [] }))
      current.agents.push(value.toLowerCase())
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (current && (field === 'allow' || field === 'disallow') && value) current.rules.push({ allow: field === 'allow', prefix: value })
  }
  const group = groups.find((g) => g.agents.includes(token)) ?? groups.find((g) => g.agents.includes('*'))
  if (!group) return true
  let best: { allow: boolean; len: number } | undefined
  for (const { allow, prefix } of group.rules) {
    if (!path.startsWith(prefix.replace(/\*$/, ''))) continue
    if (!best || prefix.length > best.len || (prefix.length === best.len && allow)) best = { allow, len: prefix.length }
  }
  return best?.allow ?? true
}

export interface PageFetcherOptions {
  userAgent: string
  timeoutMs?: number
}

export function createPageFetcher({ userAgent, timeoutMs = 20_000 }: PageFetcherOptions): PageFetcher {
  const robotsCache = new Map<string, Promise<string | null>>() // origem → robots.txt (null = sem restrições)
  const get = (url: string) =>
    fetch(url, { headers: { 'user-agent': userAgent, 'accept-language': 'pt-BR,pt;q=0.9' }, signal: AbortSignal.timeout(timeoutMs) })

  async function allowed(target: URL): Promise<boolean> {
    let robots = robotsCache.get(target.origin)
    if (!robots) {
      robots = get(`${target.origin}/robots.txt`).then(
        async (res) => {
          if (res.status >= 500) return 'User-agent: *\nDisallow: /' // servidor com problema: na dúvida, não coleta
          return res.ok ? await res.text() : null // 4xx: sem robots.txt, sem restrições
        },
        () => null,
      )
      robotsCache.set(target.origin, robots)
    }
    const content = await robots
    return content === null || robotsAllows(content, userAgent, target.pathname + target.search)
  }

  return async (rawUrl, kind) => {
    const url = new URL(rawUrl)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new FetchError('Só URLs http(s) são aceitas.')
    if (!(await allowed(url))) throw new FetchError('Bloqueado pelo robots.txt do site.')

    const res = await get(url.href)
    if (!res.ok) throw new FetchError(`O site respondeu ${res.status}.`)
    const type = res.headers.get('content-type') ?? ''
    if (/pdf|image\//i.test(type)) throw new FetchError(`Conteúdo ${type} ainda não é suportado (só HTML/texto).`)

    const body = await res.text()
    const text = kind === 'HTML' ? htmlToText(body) : body.trim()
    if (text.length > MAX_CONTENT_CHARS) throw new FetchError(`Página grande demais (${text.length} caracteres).`)
    return text
  }
}
