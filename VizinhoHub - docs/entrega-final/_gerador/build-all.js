'use strict'
// Gera Relatorio-Final-VizinhoHub.docx e .pdf a partir de conteudo/index.js (uma única fonte de conteúdo).
//   node _gerador/build-all.js            -> PDF + DOCX
//   node _gerador/build-all.js --so-docx  -> só o DOCX (sem números de página reais no sumário)
// Requer Node 24, Chrome instalado e os pacotes docx, puppeteer, image-size e jszip (ver config.js / FERRAMENTAS).
const { resolver } = require('./modelo')
const fg = require('./figuras')
const { gerarPdf } = require('./build-pdf')
const { gerarDocx } = require('./build-docx')

async function main() {
  await require('./fatiar').fatiar()
  const conteudo = require('./conteudo')
  const modelo = resolver(conteudo(), (b) => fg.existe(b))
  const ausentes = []
  const walk = (bs) => bs.forEach((b) => (b.t === 'land' ? walk(b.blocks) : b.t === 'fig' && b.missing && ausentes.push(`${b.dir}/${b.file}.png`)))
  walk(modelo.blocks)
  if (ausentes.length) console.warn('Figuras ausentes (omitidas):', ausentes.join(', '))
  console.log(`Modelo: ${modelo.blocks.length} blocos, ${modelo.figs.length} figuras, ${modelo.tabs.length} tabelas`)
  let pages = {}
  if (!process.argv.includes('--so-docx')) {
    const r = await gerarPdf(modelo)
    pages = r.pages
    console.log(`PDF gerado: ${r.total} páginas`)
  }
  await gerarDocx(modelo, pages)
  console.log('DOCX gerado')
}
main().catch((e) => { console.error(e); process.exit(1) })
