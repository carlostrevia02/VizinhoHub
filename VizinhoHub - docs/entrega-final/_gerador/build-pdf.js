'use strict'
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const cfg = require('./config')
const { render } = require('./build-html')
const { paginas } = require('./pdf-paginas')

const norm = (s) => String(s).replace(/[*`]/g, '').normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase()

async function imprimir(html, arquivo, saida, outline) {
  const puppeteer = cfg.req('puppeteer')
  fs.mkdirSync(cfg.BUILD, { recursive: true })
  const htmlPath = path.join(cfg.BUILD, arquivo)
  fs.writeFileSync(htmlPath, html)
  const browser = await puppeteer.launch({ executablePath: cfg.CHROME, args: ['--no-sandbox', '--allow-file-access-from-files'], headless: true })
  try {
    const page = await browser.newPage()
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle0', timeout: 120000 })
    await page.evaluate(() => document.fonts.ready)
    const bad = await page.evaluate(() => [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.src))
    if (bad.length) console.warn('IMAGENS NAO CARREGADAS:', bad)
    const buf = await page.pdf({ preferCSSPageSize: true, printBackground: true, outline, tagged: outline, displayHeaderFooter: false })
    fs.writeFileSync(saida, buf)
    return Buffer.from(buf)
  } finally {
    await browser.close()
  }
}

function mapear(modelo, pdfBuf) {
  const { total, itens } = paginas(pdfBuf)
  const porTitulo = new Map()
  for (const it of itens) porTitulo.set(norm(it.title), it.page)
  const pages = {}
  const faltam = []
  const alvo = [
    ...modelo.toc.map((e) => ({ id: e.id, text: e.text })),
    ...modelo.figs.map((f) => ({ id: f.id, text: `Figura ${f.n} — ${f.caption}` })),
    ...modelo.tabs.map((f) => ({ id: f.id, text: `Tabela ${f.n} — ${f.caption}` })),
  ]
  for (const a of alvo) {
    const pg = porTitulo.get(norm(a.text))
    if (pg) pages[a.id] = pg
    else faltam.push(a.text)
  }
  return { pages, total, faltam }
}

async function gerarPdf(modelo) {
  // 1ª passada: legendas como <h6> para entrarem no outline e darmos número de página às listas.
  let pages = {}
  let buf = await imprimir(render(modelo, pages, { pass1: true }), 'relatorio-p1.html', path.join(cfg.BUILD, 'p1.pdf'), true)
  let r = mapear(modelo, buf)
  pages = r.pages
  if (r.faltam.length) console.warn(`Sem página para ${r.faltam.length} entradas, ex.: ${r.faltam.slice(0, 3).join(' | ')}`)
  // 2ª passada: PDF final (legendas normais, marcadores só dos títulos) com os números do sumário.
  for (let i = 0; i < 3; i++) {
    buf = await imprimir(render(modelo, pages, { pass1: false }), 'relatorio.html', cfg.SAIDA_PDF, true)
    // confere se o sumário final bate com a paginação real dos títulos
    const { itens, total } = paginas(buf)
    const real = new Map(itens.map((x) => [norm(x.title), x.page]))
    let dif = 0
    for (const e of modelo.toc) {
      const pg = real.get(norm(e.text))
      if (pg && pages[e.id] !== pg) { pages[e.id] = pg; dif++ }
    }
    if (!dif) return { pages, total }
    console.log(`  sumário ajustado em ${dif} entradas; repetindo`)
  }
  return { pages, total: paginas(buf).total }
}

module.exports = { gerarPdf }
