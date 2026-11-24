// Biblioteca do gerador: registra cada caixa (para checagem e espelho HTML) e desenha com pptxgenjs.
const fs = require('fs')
const path = require('path')

const W = 13.333
const H = 7.5
const C = {
  green: '2E7D32', greenDark: '1B5E20', greenLight: 'E8F5E9', ink: '263238', gray: '546E7A', line: 'CFD8DC',
  orange: 'F57C00', white: 'FFFFFF', paper: 'F5F7F6',
}
const FONT = 'Calibri'

function pngSize(file) {
  const b = fs.readFileSync(file)
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}

class Deck {
  constructor(pptx) {
    this.pptx = pptx
    this.slides = []
  }
  slide(name) {
    const s = new SlideRec(this, name, this.slides.length + 1)
    this.slides.push(s)
    return s
  }
}

class SlideRec {
  constructor(deck, name, n) {
    this.deck = deck
    this.name = name
    this.n = n
    this.p = deck.pptx.addSlide()
    this.boxes = []
    this.noteText = ''
    this.p.background = { color: C.white }
  }
  _rec(b) { this.boxes.push(b); return b }

  rect({ x, y, w, h, fill, line, lineW = 1, bg = true, label = '' }) {
    const opts = { x, y, w, h }
    if (fill) opts.fill = { color: fill }; else opts.fill = { type: 'none' }
    opts.line = line ? { color: line, width: lineW } : { type: 'none' }
    this.p.addShape(this.deck.pptx.ShapeType.rect, opts)
    this._rec({ kind: 'rect', x, y, w, h, fill, line, lineW, bg, label })
  }

  // paras: string | array de parágrafos. Parágrafo: string | { t | runs:[{t,b,c,s}], b, c, s, bullet, after }
  text(paras, o) {
    const { x, y, w, h, size = 18, bold = false, color = C.ink, align = 'left', valign = 'top', fill, bg = false, lineSp = 1.0 } = o
    const list = (Array.isArray(paras) ? paras : [paras]).map((p) => (typeof p === 'string' ? { t: p } : p))
    const runs = []
    list.forEach((p, i) => {
      const pr = p.runs || [{ t: p.t }]
      const last = i === list.length - 1
      pr.forEach((r, j) => {
        const lastRun = j === pr.length - 1
        const ro = {
          fontFace: FONT, fontSize: r.s || p.s || size, bold: r.b ?? p.b ?? bold, color: r.c || p.c || color,
          align: p.align || align, breakLine: lastRun && !last, lineSpacingMultiple: lineSp,
        }
        if (lastRun && p.after) ro.paraSpaceAfter = p.after
        if (j === 0 && p.bullet) ro.bullet = { indent: 14 }
        runs.push({ text: r.t, options: ro })
      })
    })
    const opts = { x, y, w, h, margin: 0, valign, fontFace: FONT, fontSize: size, color, wrap: true, fit: 'none' }
    if (fill) opts.fill = { color: fill }
    this.p.addText(runs, opts)
    this._rec({ kind: 'text', x, y, w, h, size, bold, color, align, valign, fill, bg, list, lineSp })
  }

  // imagem "contain" dentro da area; devolve a caixa efetiva
  img(file, area, { border = true, align = 'center', valign = 'middle' } = {}) {
    const sz = pngSize(file)
    const ar = sz.w / sz.h
    let w = area.w
    let h = w / ar
    if (h > area.h) { h = area.h; w = h * ar }
    let x = area.x + (align === 'left' ? 0 : align === 'right' ? area.w - w : (area.w - w) / 2)
    let y = area.y + (valign === 'top' ? 0 : valign === 'bottom' ? area.h - h : (area.h - h) / 2)
    this.p.addImage({ path: file, x, y, w, h })
    this._rec({ kind: 'image', x, y, w, h, file, ar, srcW: sz.w, srcH: sz.h })
    if (border) {
      this.p.addShape(this.deck.pptx.ShapeType.rect, { x, y, w, h, fill: { type: 'none' }, line: { color: C.line, width: 0.75 } })
      this._rec({ kind: 'rect', x, y, w, h, line: C.line, lineW: 0.75, bg: true, deco: true })
    }
    return { x, y, w, h }
  }

  arrow({ x1, y1, x2, y2, color = C.gray, w = 2 }) {
    const x = Math.min(x1, x2), y = Math.min(y1, y2)
    const o = { x, y, w: Math.abs(x2 - x1), h: Math.abs(y2 - y1), line: { color, width: w, endArrowType: 'triangle' } }
    if (x2 < x1) o.flipH = true
    if (y2 < y1) o.flipV = true
    this.p.addShape(this.deck.pptx.ShapeType.line, o)
    this._rec({ kind: 'arrow', x1, y1, x2, y2, color, sw: w, bg: true, deco: true, x, y, w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) })
  }

  table(rows, { x, y, colW, rowH, size = 15, headFill = C.green }) {
    const trows = rows.map((r, i) => r.map((c) => ({
      text: c,
      options: {
        fontFace: FONT, fontSize: size, bold: i === 0, color: i === 0 ? C.white : C.ink,
        fill: { color: i === 0 ? headFill : i % 2 ? C.white : C.greenLight }, valign: 'middle',
        border: [{ type: 'solid', pt: 0.75, color: C.line }, { type: 'solid', pt: 0.75, color: C.line }, { type: 'solid', pt: 0.75, color: C.line }, { type: 'solid', pt: 0.75, color: C.line }],
        margin: [0.04, 0.1, 0.04, 0.1],
      },
    })))
    const w = colW.reduce((a, b) => a + b, 0)
    const rh = Array.isArray(rowH) ? rowH : rows.map(() => rowH)
    this.p.addTable(trows, { x, y, w, colW, rowH: rh, margin: 0.08 })
    this._rec({ kind: 'table', x, y, w, h: rh.reduce((a, b) => a + b, 0), rows, colW, rowH: rh, size })
  }

  notes(t) { this.noteText = t; this.p.addNotes(t) }
}

// ---- estimativa de altura de texto (conservadora, Calibri) ----
function textWidthIn(str, pt, bold) {
  const em = pt / 72
  let w = 0
  for (const ch of str) {
    if ('iljtf.,;:!|\' '.includes(ch)) w += 0.27
    else if ('mwMW'.includes(ch)) w += 0.82
    else if (ch >= 'A' && ch <= 'Z') w += 0.58
    else w += 0.50
  }
  return w * em * (bold ? 1.06 : 1)
}
function linesFor(str, pt, bold, widthIn) {
  const words = str.split(/\s+/).filter(Boolean)
  let lines = 1, cur = 0
  const sp = textWidthIn(' ', pt, bold)
  for (const wd of words) {
    const ww = textWidthIn(wd, pt, bold)
    if (cur === 0) cur = ww
    else if (cur + sp + ww <= widthIn) cur += sp + ww
    else { lines++; cur = ww }
  }
  return lines
}
function neededHeight(b) {
  let total = 0
  for (const p of b.list) {
    const runs = p.runs || [{ t: p.t }]
    const pt = Math.max(...runs.map((r) => r.s || p.s || b.size))
    const str = runs.map((r) => r.t).join('')
    const bold = runs.some((r) => r.b ?? p.b ?? b.bold)
    const wid = b.w - (p.bullet ? 14 / 72 : 0)
    total += linesFor(str, pt, bold, wid) * pt * 1.2 * b.lineSp / 72 + (p.after || 0) / 72
  }
  return total
}

function check(deck) {
  const problems = []
  const eps = 0.005
  for (const s of deck.slides) {
    const tag = `slide ${s.n} (${s.name})`
    const live = s.boxes.filter((b) => b.kind !== 'arrow')
    for (const b of live) {
      if (b.x < -eps || b.y < -eps || b.x + b.w > W + eps || b.y + b.h > H + eps) problems.push(`${tag}: caixa fora do slide ${JSON.stringify({ k: b.kind, x: b.x.toFixed(2), y: b.y.toFixed(2), w: b.w.toFixed(2), h: b.h.toFixed(2) })}`)
      if (b.kind === 'text') {
        const need = neededHeight(b)
        if (need > b.h + 0.02) problems.push(`${tag}: texto estoura a caixa (precisa ${need.toFixed(2)} in, tem ${b.h.toFixed(2)}): "${(b.list[0].t || b.list[0].runs[0].t).slice(0, 40)}"`)
      }
      if (b.kind === 'image') {
        const ar = b.w / b.h
        if (Math.abs(ar - b.ar) / b.ar > 0.005) problems.push(`${tag}: imagem distorcida ${b.file}`)
      }
    }
    const solid = live.filter((b) => !b.bg && !b.deco)
    for (let i = 0; i < solid.length; i++) {
      for (let j = i + 1; j < solid.length; j++) {
        const a = solid[i], c = solid[j]
        const ox = Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x)
        const oy = Math.min(a.y + a.h, c.y + c.h) - Math.max(a.y, c.y)
        if (ox > 0.01 && oy > 0.01) problems.push(`${tag}: sobreposicao ${a.kind}@(${a.x.toFixed(2)},${a.y.toFixed(2)}) x ${c.kind}@(${c.x.toFixed(2)},${c.y.toFixed(2)})`)
      }
    }
    // texto dentro de cartao: precisa caber no retangulo de fundo que o contem parcialmente
    const rects = live.filter((b) => b.kind === 'rect' && !b.deco)
    for (const t of live.filter((b) => b.kind === 'text')) {
      for (const r of rects) {
        const ox = Math.min(t.x + t.w, r.x + r.w) - Math.max(t.x, r.x)
        const oy = Math.min(t.y + t.h, r.y + r.h) - Math.max(t.y, r.y)
        const inter = ox > 0 && oy > 0 ? ox * oy : 0
        const area = t.w * t.h
        if (inter > 0.02 && inter < area - 0.02 && area > 0) {
          // so acusa se o texto esta majoritariamente dentro do cartao mas vaza
          if (inter / area > 0.5) problems.push(`${tag}: texto vaza do cartao @(${t.x.toFixed(2)},${t.y.toFixed(2)})`)
        }
      }
    }
    if (!s.noteText || s.noteText.length < 40) problems.push(`${tag}: sem notas do orador`)
  }
  return problems
}

// ---- espelho HTML para conferencia visual ----
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;') }
function mirrorHtml(deck) {
  const px = (v) => (v * 96).toFixed(1) + 'px'
  const parts = []
  for (const s of deck.slides) {
    const els = s.boxes.map((b) => {
      const pos = `left:${px(b.x)};top:${px(b.y)};width:${px(b.w)};height:${px(b.h)};`
      if (b.kind === 'rect') return `<div style="position:absolute;${pos}box-sizing:border-box;${b.fill ? `background:#${b.fill};` : ''}${b.line ? `border:${b.lineW * 96 / 72}px solid #${b.line};` : ''}"></div>`
      if (b.kind === 'image') return `<img src="file:///${b.file.replace(/\\/g, '/')}" style="position:absolute;${pos}object-fit:fill">`
      if (b.kind === 'arrow') {
        const horiz = Math.abs(b.x2 - b.x1) >= Math.abs(b.y2 - b.y1)
        const ang = Math.atan2(b.y2 - b.y1, b.x2 - b.x1) * 180 / Math.PI
        const len = Math.hypot(b.x2 - b.x1, b.y2 - b.y1)
        return `<div style="position:absolute;left:${px(b.x1)};top:${px(b.y1)};width:${px(len)};height:0;border-top:${b.sw * 96 / 72}px solid #${b.color};transform-origin:0 0;transform:rotate(${ang}deg)"></div><div style="position:absolute;left:${px(b.x2)};top:${px(b.y2)};width:0;height:0;border:6px solid transparent;border-left:10px solid #${b.color};transform-origin:0 0;transform:translate(-10px,-6px) rotate(${ang}deg) translate(0,0)"></div>`
      }
      if (b.kind === 'table') {
        const trs = b.rows.map((r, i) => `<tr style="height:${px(b.rowH[i])}">${r.map((c, j) => `<td style="box-sizing:border-box;width:${px(b.colW[j])};border:1px solid #CFD8DC;padding:0 9.6px;background:#${i === 0 ? '2E7D32' : i % 2 ? 'FFFFFF' : 'E8F5E9'};color:#${i === 0 ? 'FFFFFF' : '263238'};font-weight:${i === 0 ? 700 : 400};font-size:${b.size * 96 / 72}px">${esc(c)}</td>`).join('')}</tr>`).join('')
        return `<table style="position:absolute;${pos}border-collapse:collapse;table-layout:fixed;font-family:Calibri">${trs}</table>`
      }
      const jc = b.valign === 'middle' ? 'center' : b.valign === 'bottom' ? 'flex-end' : 'flex-start'
      const ps = b.list.map((p) => {
        const runs = (p.runs || [{ t: p.t }]).map((r) => `<span style="font-size:${(r.s || p.s || b.size) * 96 / 72}px;font-weight:${(r.b ?? p.b ?? b.bold) ? 700 : 400};color:#${r.c || p.c || b.color}">${esc(r.t)}</span>`).join('')
        return `<div style="text-align:${p.align || b.align};margin-bottom:${(p.after || 0) * 96 / 72}px;${p.bullet ? 'padding-left:14px;text-indent:-14px' : ''}">${p.bullet ? '&bull; ' : ''}${runs}</div>`
      }).join('')
      return `<div style="position:absolute;${pos}display:flex;flex-direction:column;justify-content:${jc};line-height:${1.2 * b.lineSp};${b.fill ? `background:#${b.fill};` : ''}outline:${process.env.OUTLINE ? '1px dashed #f0f' : 'none'}">${ps}</div>`
    }).join('')
    parts.push(`<section class="sl" id="s${s.n}" style="position:relative;width:1280px;height:720px;background:#fff;overflow:hidden;font-family:Calibri,Arial,sans-serif;margin:0 0 20px 0">${els}</section>`)
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#888}</style></head><body>${parts.join('')}</body></html>`
}

module.exports = { Deck, check, mirrorHtml, W, H, C, FONT, pngSize, neededHeightPublic: neededHeight }
