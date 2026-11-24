'use strict'
// Renderizador HTML (para o PDF via Chrome headless). Recebe o modelo já resolvido (modelo.resolver).
const path = require('path')
const { pathToFileURL } = require('url')
const cfg = require('./config')
const { inline } = require('./modelo')
const fg = require('./figuras')

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const rich = (text) =>
  inline(text)
    .map((x) => {
      const t = esc(x.s)
      return x.b ? `<strong>${t}</strong>` : x.i ? `<em>${t}</em>` : x.c ? `<code>${t}</code>` : t
    })
    .join('')
const imgUrl = (b) => pathToFileURL(fg.caminho(b)).href

const CSS = `
@page { size: A4; margin: 2.5cm;
  @top-center { content: "${cfg.META.cabecalho}"; font: 9pt Calibri, Carlito, Arial, sans-serif; color: ${cfg.COR}; border-bottom: 0.75pt solid ${cfg.COR}; padding-bottom: 3pt; width: 100%; }
  @bottom-left { content: "${cfg.META.rodape}"; font: 8.5pt Calibri, Carlito, Arial, sans-serif; color: #555; }
  @bottom-right { content: "Página " counter(page); font: 9pt Calibri, Carlito, Arial, sans-serif; color: #333; }
}
@page cover { margin: 0; @top-center { content: none; border: 0 } @bottom-left { content: none } @bottom-right { content: none } }
@page land { size: A4 landscape; margin: 2.5cm; }
* { box-sizing: border-box; }
html { font-family: Calibri, Carlito, Arial, sans-serif; font-size: 11pt; color: #1b1b1b; }
body { margin: 0; line-height: 1.32; }
.cover { page: cover; width: 210mm; height: 297mm; position: relative; break-after: page; overflow: hidden; }
.cover .band { position: absolute; left: 0; top: 0; width: 100%; height: 92mm; background: ${cfg.COR}; }
.cover .band2 { position: absolute; left: 0; top: 92mm; width: 100%; height: 5mm; background: ${cfg.COR_ESCURA}; }
.cover .uni { position: absolute; left: 25mm; top: 22mm; color: #fff; font-size: 13pt; letter-spacing: .3pt; line-height: 1.5; }
.cover .uni b { font-size: 15pt; }
.cover .tit { position: absolute; left: 25mm; right: 25mm; top: 118mm; }
.cover .tit .tipo { color: ${cfg.COR}; font-size: 14pt; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2pt; }
.cover .tit .h1 { font-size: 46pt; margin: 6mm 0 4mm; color: ${cfg.COR_ESCURA}; font-weight: 700; line-height: 1.05; }
.cover .tit .sub { font-size: 16pt; color: #333; line-height: 1.3; }
.cover .aut { position: absolute; left: 25mm; right: 25mm; bottom: 52mm; font-size: 12pt; line-height: 1.6; }
.cover .aut .nome { font-size: 16pt; font-weight: 700; }
.cover .loc { position: absolute; left: 25mm; right: 25mm; bottom: 22mm; font-size: 12pt; color: #333; border-top: 1.5pt solid ${cfg.COR}; padding-top: 4mm; }
h1, h2, h3 { color: ${cfg.COR_ESCURA}; font-weight: 700; line-height: 1.2; break-after: avoid; }
h1 { font-size: 20pt; border-bottom: 2pt solid ${cfg.COR}; padding-bottom: 4pt; margin: 0 0 14pt; break-before: page; }
h1.sempb { break-before: auto; }
h2 { font-size: 14.5pt; margin: 18pt 0 6pt; color: ${cfg.COR}; }
h3 { font-size: 12pt; margin: 12pt 0 4pt; }
p { margin: 0 0 7pt; text-align: left; orphans: 3; widows: 3; }
ul, ol { margin: 0 0 8pt; padding-left: 20pt; }
li { margin: 0 0 3pt; }
li > p { margin: 0; }
code { font-family: Consolas, "Courier New", monospace; font-size: 9.2pt; background: #eef2ee; padding: 0 2pt; border-radius: 2pt; }
pre { font-family: Consolas, "Courier New", monospace; font-size: 8.6pt; line-height: 1.3; background: #f4f6f4; border: 0.5pt solid #cfd8cf; border-left: 3pt solid ${cfg.COR}; padding: 6pt 8pt; margin: 0 0 9pt; white-space: pre-wrap; word-break: break-word; break-inside: avoid; }
.fm-titulo { font-size: 20pt; font-weight: 700; color: ${cfg.COR_ESCURA}; border-bottom: 2pt solid ${cfg.COR}; padding-bottom: 4pt; margin: 0 0 14pt; }
.toc { margin: 0 0 2pt; }
.toc a { display: flex; align-items: baseline; color: inherit; text-decoration: none; }
.toc .t { flex: 0 1 auto; }
.toc .d { flex: 1 1 auto; border-bottom: 1pt dotted #8a8a8a; margin: 0 4pt; transform: translateY(-3pt); min-width: 12pt; }
.toc .pg { flex: 0 0 auto; min-width: 16pt; text-align: right; }
.toc.l1 { font-weight: 700; margin-top: 5pt; }
.toc.l2 { padding-left: 16pt; font-size: 10.5pt; }
.toc.l3 { padding-left: 32pt; font-size: 10pt; }
.lof .toc { font-size: 9.8pt; line-height: 1.2; }
figure { margin: 8pt 0 10pt; text-align: center; break-inside: avoid; }
figure img { display: block; margin: 0 auto; border: 0.5pt solid #d5ddd5; }
figcaption, .figcap, .tabcap { font-size: 9.5pt; color: #333; margin: 4pt 0 0; font-weight: 400; line-height: 1.25; text-align: center; }
.tabcap { text-align: left; font-weight: 700; color: ${cfg.COR_ESCURA}; margin: 10pt 0 4pt; break-after: avoid; }
h6.figcap, h6.tabcap { font-family: inherit; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 0 0 4pt; font-size: 9.6pt; }
table.sm { font-size: 8.6pt; }
table.xs { font-size: 7.9pt; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
th { background: ${cfg.COR}; color: #fff; text-align: left; font-weight: 700; padding: 4pt 5pt; border: 0.5pt solid ${cfg.COR_ESCURA}; vertical-align: middle; }
td { padding: 3.5pt 5pt; border: 0.5pt solid #c9d6c9; vertical-align: top; overflow-wrap: anywhere; }
table code { font-size: .92em; padding: 0 1pt; }
table.xs td { padding: 2.5pt 4pt; }
table.xs th { padding: 3pt 4pt; }
table.sm td { padding: 3pt 4.5pt; }
tbody tr:nth-child(even) td { background: ${cfg.COR_ZEBRA}; }
.tabwrap { margin: 0 0 10pt; }
.box { margin: 4pt 0 11pt; padding: 7pt 10pt; border-left: 4pt solid ${cfg.COR}; background: #eef6ef; break-inside: avoid; }
.box.warn { border-left-color: #E65100; background: #fff4e8; }
.box.todo { border-left-color: #1565C0; background: #eaf2fb; }
.box .bt { font-weight: 700; margin-bottom: 3pt; color: #1b1b1b; }
.box ul { margin: 0; padding-left: 16pt; }
.box p { margin: 0 0 3pt; }
.land { page: land; }
.land h1 { break-before: auto; }
.nobreak { break-inside: avoid; }
`

function renderTable(b, opts) {
  const w = b.w && b.w.length ? b.w : b.head.map(() => 1 / b.head.length)
  const sum = w.reduce((a, c) => a + c, 0)
  const cols = w.map((x) => `<col style="width:${((x / sum) * 100).toFixed(2)}%">`).join('')
  const cap = b.caption
    ? `<${opts.pass1 ? 'h6' : 'p'} class="tabcap" id="${b.id}">Tabela ${b.n} — ${rich(b.caption)}</${opts.pass1 ? 'h6' : 'p'}>`
    : ''
  const head = `<thead><tr>${b.head.map((h) => `<th>${rich(h)}</th>`).join('')}</tr></thead>`
  const body = `<tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${rich(c).replace(/\n/g, '<br>')}</td>`).join('')}</tr>`).join('')}</tbody>`
  return `<div class="tabwrap">${cap}<table class="${b.size || ''}"><colgroup>${cols}</colgroup>${head}${body}</table></div>`
}

function renderBlock(b, opts, emLand) {
  switch (b.t) {
    case 'h1': return `<h1 id="${b.id}"${b.noPb ? ' class="sempb"' : ''}>${esc(b.full)}</h1>`
    case 'h2': return `<h2 id="${b.id}">${esc(b.full)}</h2>`
    case 'h3': return `<h3 id="${b.id}">${esc(b.full)}</h3>`
    case 'p': return `<p>${rich(b.text)}</p>`
    case 'ul': return `<ul>${b.items.map((i) => `<li>${rich(i)}</li>`).join('')}</ul>`
    case 'ol': return `<ol>${b.items.map((i) => `<li>${rich(i)}</li>`).join('')}</ol>`
    case 'code': return `<pre>${esc(b.text)}</pre>`
    case 'pb': return '<div style="break-after:page"></div>'
    case 'table': return renderTable(b, opts)
    case 'box':
      return `<div class="box ${b.kind}"><div class="bt">${rich(b.title)}</div>${
        b.items.length === 1 ? `<p>${rich(b.items[0])}</p>` : `<ul>${b.items.map((i) => `<li>${rich(i)}</li>`).join('')}</ul>`
      }</div>`
    case 'fig': {
      if (b.missing) return ''
      const m = fg.medida(b, emLand)
      const cap = `Figura ${b.n} — ${rich(b.caption)}`
      const capEl = opts.pass1 ? `<h6 class="figcap" id="${b.id}">${cap}</h6>` : `<figcaption class="figcap" id="${b.id}">${cap}</figcaption>`
      return `<figure><img src="${imgUrl(b)}" width="${m.w}" height="${m.h}" alt="${esc(b.caption)}">${capEl}</figure>`
    }
    case 'land':
      return `<section class="land">${b.blocks.map((x) => renderBlock(x, opts, true)).join('\n')}</section>`
    default: return ''
  }
}

function capa() {
  const m = cfg.META
  return `<section class="cover"><div class="band"></div><div class="band2"></div>
  <div class="uni"><b>${esc(m.instituicao)}</b><br>${esc(m.centro)}<br>${esc(m.curso)}</div>
  <div class="tit"><div class="tipo">${esc(m.tipo)}</div><div class="h1">${esc(m.titulo)}</div><div class="sub">${esc(m.subtitulo)}</div></div>
  <div class="aut"><div class="nome">${esc(m.autor)}</div><div>Autor único · Projeto de extensão universitária</div></div>
  <div class="loc">${esc(m.local)}</div></section>`
}

function listaFront(titulo, entries, pages, opts) {
  const tag = opts.pass1 ? 'div' : 'div'
  return `<div class="${titulo === 'Sumário' ? 'sumario' : 'lof'}" style="break-before:page"><div class="fm-titulo">${esc(titulo)}</div>${entries
    .map((e) => {
      const n = pages[e.id] != null ? pages[e.id] : '00'
      return `<${tag} class="toc l${e.level || 2}"><a href="#${e.id}"><span class="t">${esc(e.text)}</span><span class="d"></span><span class="pg">${n}</span></a></${tag}>`
    })
    .join('')}</div>`
}

// pages: { id -> nº da página } (vazio na 1ª passada)
function render(modelo, pages = {}, opts = {}) {
  const sumario = listaFront('Sumário', modelo.toc, pages, opts)
  const lof = listaFront('Lista de figuras', modelo.figs.map((f) => ({ id: f.id, level: 2, text: `Figura ${f.n} — ${f.caption.replace(/[*`]/g, '')}` })), pages, opts)
  const lot = listaFront('Lista de tabelas', modelo.tabs.map((f) => ({ id: f.id, level: 2, text: `Tabela ${f.n} — ${f.caption.replace(/[*`]/g, '')}` })), pages, opts)
  const corpo = modelo.blocks.map((b) => renderBlock(b, opts, false)).join('\n')
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(cfg.META.titulo)} — ${esc(cfg.META.tipo)}</title><style>${CSS}</style></head><body>${capa()}${sumario}${lof}${lot}${corpo}</body></html>`
}

module.exports = { render }
