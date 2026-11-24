'use strict'
// Renderizador DOCX (biblioteca `docx`). Recebe o modelo já resolvido (modelo.resolver).
const fs = require('fs')
const cfg = require('./config')
const { inline } = require('./modelo')
const fg = require('./figuras')
const D = cfg.req('docx')
const JSZip = cfg.req('jszip')

const {
  Document, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, Header, Footer, PageNumber, PageReference, Bookmark,
  InternalHyperlink, TabStopType, LeaderType, Packer, LevelFormat, AlignmentType, PageOrientation, SectionType, ShadingType,
  BorderStyle, WidthType, HeadingLevel, PageBreak, TableLayoutType, VerticalAlign,
} = D

const VERDE = cfg.COR.slice(1)
const ESCURO = cfg.COR_ESCURA.slice(1)
const ZEBRA = cfg.COR_ZEBRA.slice(1)
const W_P = 9072 // largura útil retrato (dxa)
const W_L = 14004 // largura útil paisagem
const FONT = 'Calibri'
const MONO = 'Consolas'

const runs = (text, base = {}) =>
  inline(text).map(
    (x) =>
      new TextRun({
        text: x.s,
        bold: x.b || base.bold,
        italics: x.i || base.italics,
        font: x.c ? MONO : base.font,
        size: x.c ? Math.max((base.size || 22) - 2, 14) : base.size,
        color: base.color,
        shading: x.c ? { type: ShadingType.CLEAR, fill: 'EEF2EE', color: 'auto' } : undefined,
      }),
  )

function pHead(b) {
  const lvl = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3 }[b.level]
  return new Paragraph({
    heading: lvl,
    keepNext: true,
    children: [new Bookmark({ id: b.id, children: [new TextRun({ text: b.full })] })],
  })
}

function listParas(items, ref, level = 0) {
  return items.map(
    (it) => new Paragraph({ numbering: { reference: ref, level }, spacing: { after: 60 }, children: runs(it) }),
  )
}

const borda = (cor, sz = 4) => ({ style: BorderStyle.SINGLE, size: sz, color: cor })
const bordas = (cor, sz) => ({ top: borda(cor, sz), bottom: borda(cor, sz), left: borda(cor, sz), right: borda(cor, sz) })

function tabelaDocx(b, largura) {
  const w = b.w && b.w.length ? b.w : b.head.map(() => 1 / b.head.length)
  const sum = w.reduce((a, c) => a + c, 0)
  const cols = w.map((x) => Math.floor((x / sum) * largura))
  const tam = b.size === 'xs' ? 15 : b.size === 'sm' ? 17 : 19
  const cell = (txt, i, head, zebra) =>
    new TableCell({
      width: { size: cols[i], type: WidthType.DXA },
      verticalAlign: head ? VerticalAlign.CENTER : VerticalAlign.TOP,
      shading: head ? { type: ShadingType.CLEAR, fill: VERDE, color: 'auto' } : zebra ? { type: ShadingType.CLEAR, fill: ZEBRA, color: 'auto' } : undefined,
      margins: { top: 50, bottom: 50, left: 80, right: 80 },
      borders: bordas(head ? ESCURO : 'C9D6C9'),
      children: String(txt)
        .split('\n')
        .map((ln) => new Paragraph({ spacing: { after: 0, line: 245 }, children: runs(ln, { size: tam, bold: head, color: head ? 'FFFFFF' : undefined }) })),
    })
  const header = new TableRow({ tableHeader: true, cantSplit: true, children: b.head.map((h, i) => cell(h, i, true)) })
  const body = b.rows.map((r, ri) => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, i, false, ri % 2 === 1)) }))
  const out = []
  if (b.caption) {
    out.push(
      new Paragraph({
        keepNext: true,
        spacing: { before: 160, after: 80 },
        children: [new Bookmark({ id: b.id, children: [new TextRun({ text: `Tabela ${b.n} — `, bold: true, color: ESCURO, size: 20 }), ...runs(b.caption, { bold: true, color: ESCURO, size: 20 })] })],
      }),
    )
  }
  out.push(
    new Table({
      width: { size: largura, type: WidthType.DXA },
      columnWidths: cols,
      layout: TableLayoutType.FIXED,
      rows: [header, ...body],
    }),
  )
  out.push(new Paragraph({ spacing: { after: 120 }, children: [] }))
  return out
}

function caixa(b, largura) {
  const cor = b.kind === 'warn' ? 'E65100' : b.kind === 'todo' ? '1565C0' : VERDE
  const fundo = b.kind === 'warn' ? 'FFF4E8' : b.kind === 'todo' ? 'EAF2FB' : 'EEF6EF'
  const kids = [new Paragraph({ spacing: { after: 60 }, keepNext: true, children: runs(b.title, { bold: true }) })]
  if (b.items.length === 1) kids.push(new Paragraph({ spacing: { after: 40 }, children: runs(b.items[0]) }))
  else kids.push(...listParas(b.items, 'bullets'))
  const none = { style: BorderStyle.NONE, size: 0, color: 'auto' }
  const t = new Table({
    width: { size: largura, type: WidthType.DXA },
    columnWidths: [largura],
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: largura, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill: fundo, color: 'auto' },
            margins: { top: 100, bottom: 80, left: 160, right: 120 },
            borders: { top: none, bottom: none, right: none, left: { style: BorderStyle.SINGLE, size: 24, color: cor } },
            children: kids,
          }),
        ],
      }),
    ],
  })
  return [t, new Paragraph({ spacing: { after: 140 }, children: [] })]
}

function figuraDocx(b, emLand) {
  if (b.missing) return []
  const m = fg.medida(b, emLand)
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      keepNext: true,
      spacing: { before: 120, after: 60 },
      children: [new ImageRun({ type: 'png', data: m.buf, transformation: { width: m.w, height: m.h }, altText: { name: b.file, title: b.file, description: b.caption.replace(/[*`]/g, '') } })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [new Bookmark({ id: b.id, children: [new TextRun({ text: `Figura ${b.n} — `, size: 19 }), ...runs(b.caption, { size: 19 })] })],
    }),
  ]
}

let olSeq = 0
const olRefs = []

function blocoDocx(b, emLand) {
  const largura = emLand ? W_L : W_P
  switch (b.t) {
    case 'h1': case 'h2': case 'h3': return [pHead(b)]
    case 'p': return [new Paragraph({ spacing: { after: 120 }, children: runs(b.text) })]
    case 'ul': return listParas(b.items, 'bullets')
    case 'ol': {
      const ref = `ol${++olSeq}`
      olRefs.push(ref)
      return listParas(b.items, ref)
    }
    case 'code':
      return [
        ...b.text.split('\n').map(
          (ln) =>
            new Paragraph({
              spacing: { after: 0, line: 240 },
              indent: { left: 120 },
              shading: { type: ShadingType.CLEAR, fill: 'F4F6F4', color: 'auto' },
              border: { left: { style: BorderStyle.SINGLE, size: 18, color: VERDE, space: 6 } },
              children: [new TextRun({ text: ln === '' ? ' ' : ln, font: MONO, size: 17 })],
            }),
        ),
        new Paragraph({ spacing: { after: 120 }, children: [] }),
      ]
    case 'pb': return [new Paragraph({ children: [new PageBreak()] })]
    case 'table': return tabelaDocx(b, largura)
    case 'box': return caixa(b, largura)
    case 'fig': return figuraDocx(b, emLand)
    default: return []
  }
}

function cabecalho(largura) {
  return new Header({
    children: [
      new Paragraph({
        spacing: { after: 0 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: VERDE, space: 3 } },
        children: [new TextRun({ text: cfg.META.cabecalho, size: 18, color: VERDE })],
      }),
    ],
  })
}
function rodape(largura) {
  return new Footer({
    children: [
      new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: largura }],
        children: [
          new TextRun({ text: cfg.META.rodape, size: 17, color: '555555' }),
          new TextRun({ text: '\tPágina ', size: 18 }),
          new TextRun({ children: [PageNumber.CURRENT], size: 18 }),
        ],
      }),
    ],
  })
}

function capaDocx() {
  const m = cfg.META
  const none = { style: BorderStyle.NONE, size: 0, color: 'auto' }
  const banner = new Table({
    width: { size: W_P, type: WidthType.DXA },
    columnWidths: [W_P],
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({
        height: { value: 2600, rule: D.HeightRule.ATLEAST },
        children: [
          new TableCell({
            width: { size: W_P, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill: VERDE, color: 'auto' },
            margins: { top: 300, bottom: 300, left: 360, right: 240 },
            verticalAlign: VerticalAlign.CENTER,
            borders: { top: none, bottom: none, left: none, right: none },
            children: [
              new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: m.instituicao, bold: true, size: 32, color: 'FFFFFF' })] }),
              new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: m.centro, size: 26, color: 'FFFFFF' })] }),
              new Paragraph({ children: [new TextRun({ text: m.curso, size: 26, color: 'FFFFFF' })] }),
            ],
          }),
        ],
      }),
    ],
  })
  return [
    banner,
    new Paragraph({ spacing: { before: 2200, after: 120 }, children: [new TextRun({ text: m.tipo.toUpperCase(), bold: true, size: 28, color: VERDE })] }),
    new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: m.titulo, bold: true, size: 100, color: ESCURO })] }),
    new Paragraph({ spacing: { after: 2400 }, children: [new TextRun({ text: m.subtitulo, size: 32, color: '333333' })] }),
    new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: m.autor, bold: true, size: 32 })] }),
    new Paragraph({ spacing: { after: 900 }, children: [new TextRun({ text: 'Autor único · Projeto de extensão universitária', size: 24 })] }),
    new Paragraph({
      border: { top: { style: BorderStyle.SINGLE, size: 12, color: VERDE, space: 8 } },
      children: [new TextRun({ text: m.local, size: 24, color: '333333' })],
    }),
  ]
}

function listaFront(titulo, entries) {
  const out = [new Paragraph({ pageBreakBefore: true, spacing: { after: 280 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: VERDE, space: 4 } }, children: [new TextRun({ text: titulo, bold: true, size: 40, color: ESCURO })] })]
  for (const e of entries) {
    const ind = e.level === 1 ? 0 : e.level === 2 ? 280 : 560
    out.push(
      new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: W_P, leader: LeaderType.DOT }],
        indent: { left: ind },
        spacing: { before: e.level === 1 ? 100 : 0, after: 30 },
        children: [
          new InternalHyperlink({
            anchor: e.id,
            children: [new TextRun({ text: e.text, bold: e.level === 1, size: e.level === 1 ? 22 : 20 }), new TextRun({ text: '\t', size: 20 }), new PageReference(e.id)],
          }),
        ],
      }),
    )
  }
  return out
}

async function gerarDocx(modelo, pages = {}) {
  const sectionsMain = []
  let atual = { land: false, children: [] }
  const flush = () => {
    if (atual.children.length) sectionsMain.push(atual)
  }
  for (const b of modelo.blocks) {
    if (b.t === 'land') {
      flush()
      sectionsMain.push({ land: true, children: b.blocks.flatMap((x) => blocoDocx(x, true)) })
      atual = { land: false, children: [] }
    } else atual.children.push(...blocoDocx(b, false))
  }
  flush()

  const front = [
    ...listaFront('Sumário', modelo.toc),
    ...listaFront('Lista de figuras', modelo.figs.map((f) => ({ id: f.id, level: 2, text: `Figura ${f.n} — ${f.caption.replace(/[*`]/g, '')}` }))),
    ...listaFront('Lista de tabelas', modelo.tabs.map((f) => ({ id: f.id, level: 2, text: `Tabela ${f.n} — ${f.caption.replace(/[*`]/g, '')}` }))),
  ]

  const margem = { top: 1417, bottom: 1417, left: 1417, right: 1417, header: 709, footer: 709 }
  const pagePortrait = { size: { width: 11906, height: 16838 }, margin: margem }
  const pageLand = { size: { width: 11906, height: 16838, orientation: PageOrientation.LANDSCAPE }, margin: margem }

  const sections = [
    { properties: { page: { size: { width: 11906, height: 16838 }, margin: { ...margem, header: 0, footer: 0 } } }, children: capaDocx() },
    // O sumário e o corpo ficam na mesma seção retrato; a primeira seção de corpo continua a numeração.
  ]
  const [primeira, ...resto] = sectionsMain
  sections.push({
    properties: { type: SectionType.NEXT_PAGE, page: pagePortrait },
    headers: { default: cabecalho(W_P) },
    footers: { default: rodape(W_P) },
    children: [...front, ...(primeira ? primeira.children : [])],
  })
  for (const s of resto) {
    sections.push({
      properties: { type: SectionType.NEXT_PAGE, page: s.land ? pageLand : pagePortrait },
      headers: { default: cabecalho(s.land ? W_L : W_P) },
      footers: { default: rodape(s.land ? W_L : W_P) },
      children: s.children,
    })
  }

  const numbering = {
    config: [
      {
        reference: 'bullets',
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } },
          { level: 1, format: LevelFormat.BULLET, text: '–', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1000, hanging: 270 } } } },
        ],
      },
      ...olRefs.map((reference) => ({
        reference,
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 320 } } } }],
      })),
    ],
  }

  const doc = new Document({
    creator: cfg.META.autor,
    title: `${cfg.META.titulo} — ${cfg.META.tipo}`,
    description: cfg.META.subtitulo,
    features: { updateFields: true },
    styles: {
      default: { document: { run: { font: FONT, size: 22 }, paragraph: { spacing: { line: 300 } } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 40, bold: true, color: ESCURO }, paragraph: { pageBreakBefore: true, spacing: { before: 0, after: 280 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: VERDE, space: 4 } }, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 29, bold: true, color: VERDE }, paragraph: { spacing: { before: 360, after: 120 }, outlineLevel: 1 } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 24, bold: true, color: ESCURO }, paragraph: { spacing: { before: 240, after: 80 }, outlineLevel: 2 } },
      ],
    },
    numbering,
    sections,
  })
  let buf = await Packer.toBuffer(doc)
  buf = await preencherPaginas(buf, modelo, pages)
  fs.writeFileSync(cfg.SAIDA_DOCX, buf)
  return buf
}

// Os campos PAGEREF saem vazios da biblioteca; grava o resultado em cache (nº de página da versão em PDF) para
// que o sumário apareça mesmo antes de o Word atualizar os campos (F9 / abrir e aceitar "atualizar campos").
async function preencherPaginas(buf, modelo, pages) {
  const zip = await JSZip.loadAsync(buf)
  let xml = await zip.file('word/document.xml').async('string')
  let n = 0
  const RE = /(<w:instrText[^>]*>\s*PAGEREF\s+(\S+)[^<]*<\/w:instrText><w:fldChar w:fldCharType="separate"\/>)(<w:fldChar w:fldCharType="end"\/>)/g
  xml = xml.replace(RE, (all, a, id, end) => {
    const pg = pages[id]
    if (!pg) return all
    n++
    return `${a}<w:t>${pg}</w:t>${end}`
  })
  zip.file('word/document.xml', xml)
  console.log(`  docx: ${n} campos PAGEREF preenchidos`)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

module.exports = { gerarDocx }
