'use strict'
// Modelo de conteúdo do relatório: UMA fonte de verdade para o .docx e o .pdf.
// Cada capítulo (conteudo/capNN.js) exporta uma função que devolve uma lista de blocos criados por estes helpers.
//
// Marcação inline aceita em qualquer texto:  **negrito**  *itálico*  `código`
// Referências cruzadas:  [[fig:03-der-completo]] -> "Figura 7"   [[tab:id]] -> "Tabela 12"   (resolvidas em resolver())

const h1 = (text, o = {}) => ({ t: 'h1', text, ...o })
const h2 = (text, o = {}) => ({ t: 'h2', text, ...o })
const h3 = (text, o = {}) => ({ t: 'h3', text, ...o })
const p = (text, o = {}) => ({ t: 'p', text, ...o })
const ul = (items, o = {}) => ({ t: 'ul', items, ...o })
const ol = (items, o = {}) => ({ t: 'ol', items, ...o })
const code = (text, o = {}) => ({ t: 'code', text, ...o })
const pb = () => ({ t: 'pb' })
// tabela: head = ['A','B'], rows = [['a','b']], w = frações das colunas (somam ~1), id opcional para [[tab:id]]
const table = (caption, head, rows, o = {}) => ({ t: 'table', caption, head, rows, ...o })
// figura: file = nome base do PNG em diagramas/ ou capturas/ (ex.: '03-der-completo'); dir = 'diagramas' | 'capturas'
const fig = (file, caption, o = {}) => ({ t: 'fig', file, caption, dir: 'diagramas', ...o })
const shot = (file, caption, o = {}) => ({ t: 'fig', file, caption, dir: 'capturas', ...o })
// caixa de destaque: kind = 'info' | 'warn' | 'todo'
const box = (title, items, o = {}) => ({ t: 'box', title, items: Array.isArray(items) ? items : [items], kind: 'info', ...o })
// grupo de blocos numa página em paisagem
const land = (blocks) => ({ t: 'land', blocks })

// ---------------------------------------------------------------------------
// Pré-passe: numera títulos/figuras/tabelas, resolve [[fig:..]] e [[tab:..]].
// ---------------------------------------------------------------------------
function flatten(blocks) {
  const out = []
  for (const b of blocks) {
    if (Array.isArray(b)) out.push(...flatten(b))
    else if (b && b.t === 'land') out.push({ ...b, blocks: flatten(b.blocks) })
    else if (b) out.push(b)
  }
  return out
}

function walk(blocks, fn) {
  for (const b of blocks) {
    if (b.t === 'land') walk(b.blocks, fn)
    else fn(b)
  }
}

function resolver(blocksIn, existe) {
  const blocks = flatten(blocksIn)
  let c1 = 0, c2 = 0, c3 = 0, nFig = 0, nTab = 0
  const figNum = {}, tabNum = {}
  const toc = [], figs = [], tabs = []
  let seq = 0
  walk(blocks, (b) => {
    if (b.t === 'h1') {
      if (b.num) { /* apêndice: rótulo próprio */ } else { c1++; c2 = 0; c3 = 0; b.num = String(c1) }
      b.level = 1
    } else if (b.t === 'h2') { c2++; c3 = 0; b.num = `${c1}.${c2}`; b.level = 2 }
    else if (b.t === 'h3') { c3++; b.num = `${c1}.${c2}.${c3}`; b.level = 3 }
    if (b.t === 'h1' || b.t === 'h2' || b.t === 'h3') {
      b.id = `sec${++seq}`
      b.full = b.noNum ? b.text : `${b.num} ${b.text}`
      if (b.level <= 2 || b.toc3) toc.push({ id: b.id, level: b.level, text: b.full })
    }
    if (b.t === 'fig') {
      if (existe && !existe(b)) { b.missing = true; return }
      b.n = ++nFig; b.id = `fig${b.n}`; figNum[b.file] = b.n
      figs.push({ id: b.id, n: b.n, caption: b.caption })
    }
    if (b.t === 'table' && b.caption) {
      b.n = ++nTab; b.id = `tab${b.n}`; if (b.key) tabNum[b.key] = b.n
      tabs.push({ id: b.id, n: b.n, caption: b.caption })
    }
  })
  const sub = (s) => typeof s !== 'string' ? s : s
    .replace(/\[\[fig:([^\]]+)\]\]/g, (_, k) => (figNum[k] ? `Figura ${figNum[k]}` : `a figura do arquivo ${k}`))
    .replace(/\[\[tab:([^\]]+)\]\]/g, (_, k) => (tabNum[k] ? `Tabela ${tabNum[k]}` : `a tabela ${k}`))
  walk(blocks, (b) => {
    if (b.text) b.text = sub(b.text)
    if (b.caption) b.caption = sub(b.caption)
    if (b.items) b.items = b.items.map(sub)
    if (b.title) b.title = sub(b.title)
    if (b.head) b.head = b.head.map(sub)
    if (b.rows) b.rows = b.rows.map((r) => r.map(sub))
  })
  for (const f of figs) f.caption = sub(f.caption)
  return { blocks, toc, figs, tabs }
}

// Quebra marcação inline em segmentos {s, b, i, c}
function inline(text) {
  const out = []
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/g
  let last = 0, m
  const s = String(text)
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ s: s.slice(last, m.index) })
    const tok = m[0]
    if (tok.startsWith('**')) out.push({ s: tok.slice(2, -2), b: true })
    else if (tok.startsWith('`')) out.push({ s: tok.slice(1, -1), c: true })
    else out.push({ s: tok.slice(1, -1), i: true })
    last = m.index + tok.length
  }
  if (last < s.length) out.push({ s: s.slice(last) })
  return out
}

module.exports = { h1, h2, h3, p, ul, ol, code, pb, table, fig, shot, box, land, resolver, inline, flatten }
