'use strict'
// Lê os marcadores (outline) do PDF gerado pelo Chrome e devolve { título -> nº da página (1 = capa) }.
// O Skia grava os objetos em texto simples, então basta varrer os dicionários.
const zlib = require('zlib')

function decodeTitulo(raw) {
  raw = raw.trim()
  if (raw.startsWith('<')) {
    const hex = raw.replace(/[<>\s]/g, '')
    const buf = Buffer.from(hex, 'hex')
    return buf[0] === 0xfe && buf[1] === 0xff ? swap(buf.subarray(2)) : buf.toString('latin1')
  }
  // string literal ( ... ) com escapes
  const inner = raw.slice(1, -1)
  const bytes = []
  for (let i = 0; i < inner.length; i++) {
    let c = inner.charCodeAt(i)
    if (c === 92) {
      const n = inner[++i]
      if (n === 'n') c = 10
      else if (n === 'r') c = 13
      else if (n === 't') c = 9
      else if (/[0-7]/.test(n)) {
        let o = n
        while (o.length < 3 && /[0-7]/.test(inner[i + 1] || '')) o += inner[++i]
        c = parseInt(o, 8)
      } else c = n.charCodeAt(0)
    }
    bytes.push(c & 255)
  }
  const buf = Buffer.from(bytes)
  return buf[0] === 0xfe && buf[1] === 0xff ? swap(buf.subarray(2)) : buf.toString('latin1')
}
const swap = (b) => {
  const out = Buffer.from(b)
  out.swap16()
  return out.toString('utf16le')
}

function paginas(pdfBuf) {
  const s = pdfBuf.toString('latin1')
  const objs = new Map()
  const re = /(\d+) 0 obj\b([\s\S]*?)endobj/g
  let m
  while ((m = re.exec(s))) objs.set(Number(m[1]), m[2])

  // Descobre a ordem das páginas pela árvore /Pages
  const kidsOf = (n) => {
    const body = objs.get(n) || ''
    const k = /\/Kids\s*\[([^\]]*)\]/.exec(body)
    return k ? [...k[1].matchAll(/(\d+) 0 R/g)].map((x) => Number(x[1])) : null
  }
  let root = null
  for (const [n, body] of objs) if (/\/Type\s*\/Pages\b/.test(body) && !/\/Parent/.test(body)) root = n
  const ordem = []
  const dfs = (n) => {
    const k = kidsOf(n)
    if (k) k.forEach(dfs)
    else ordem.push(n)
  }
  if (root != null) dfs(root)
  const idx = new Map(ordem.map((n, i) => [n, i + 1]))

  const out = []
  for (const [, body] of objs) {
    const t = /\/Title\s*(<[0-9A-Fa-f\s]*>|\((?:\\.|[^\\)])*\))/.exec(body)
    if (!t) continue
    const d = /\/Dest\s*\[\s*(\d+) 0 R/.exec(body)
    if (!d) continue
    out.push({ title: decodeTitulo(t[1]), page: idx.get(Number(d[1])) })
  }
  return { total: ordem.length, itens: out.filter((x) => x.page) }
}

module.exports = { paginas }
