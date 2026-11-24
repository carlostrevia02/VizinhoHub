// Gera Slide-Unico-VizinhoHub.pptx (1 slide). Rodar: node build-1slide.js (NODE_PATH com pptxgenjs)
const path = require('path')
const PptxGenJS = require('pptxgenjs')
const root = path.join(__dirname, '..')
const C = { green: '2E7D32', dark: '1B5E20', light: 'E8F5E9', ink: '263238', gray: '546E7A', orange: 'F57C00', white: 'FFFFFF', line: 'CFD8DC' }
const F = 'Calibri'
const pptx = new PptxGenJS()
pptx.layout = 'LAYOUT_WIDE' // 13.333 x 7.5
pptx.title = 'VizinhoHub - Slide único'
const s = pptx.addSlide()
s.background = { color: C.white }

// Cabeçalho
s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 1.2, fill: { color: C.green }, line: { type: 'none' } })
s.addText('VizinhoHub', { x: 0.5, y: 0.12, w: 7, h: 0.65, fontFace: F, fontSize: 36, bold: true, color: C.white, margin: 0 })
s.addText('Intermediário de descontos entre o comércio de bairro e quem mora perto', { x: 0.5, y: 0.75, w: 9.5, h: 0.35, fontFace: F, fontSize: 16, color: C.light, margin: 0 })
s.addText('Projeto de Extensão • Unifor • 2026', { x: 9.3, y: 0.45, w: 3.55, h: 0.3, fontFace: F, fontSize: 12, color: C.light, align: 'right', margin: 0 })

// Problema / Solução
const colW = 3.75
s.addText('O problema', { x: 0.5, y: 1.45, w: colW, h: 0.3, fontFace: F, fontSize: 15, bold: true, color: C.orange, margin: 0 })
s.addText('Pequenos comércios de Fortaleza dependem de WhatsApp, cadernos e planilhas, e pagam 12–25% de comissão aos marketplaces.', { x: 0.5, y: 1.78, w: colW, h: 1.05, fontFace: F, fontSize: 13, color: C.ink, margin: 0, valign: 'top' })
s.addText('A solução', { x: 4.45, y: 1.45, w: colW, h: 0.3, fontFace: F, fontSize: 15, bold: true, color: C.green, margin: 0 })
s.addText('Ofertas do bairro, cupons de 24 h e ofertas relâmpago com estoque limitado, sem taxa de intermediação abusiva, em PWA mobile-first.', { x: 4.45, y: 1.78, w: colW, h: 1.05, fontFace: F, fontSize: 13, color: C.ink, margin: 0, valign: 'top' })

// Números
const stats = [['43', 'tabelas\nPostgreSQL'], ['18', 'migrações\nversionadas'], ['82', 'requisitos\nfuncionais'], ['20', 'diagramas\nUML/C4/DER']]
const sw = 1.8, gap = 0.1
stats.forEach(([n, l], i) => {
  const x = 0.5 + i * (sw + gap)
  s.addShape(pptx.ShapeType.rect, { x, y: 2.95, w: sw, h: 1.2, fill: { color: C.light }, line: { type: 'none' } })
  s.addText(n, { x, y: 3.0, w: sw, h: 0.55, fontFace: F, fontSize: 28, bold: true, color: C.dark, align: 'center', margin: 0 })
  s.addText(l, { x, y: 3.55, w: sw, h: 0.55, fontFace: F, fontSize: 12, color: C.gray, align: 'center', margin: 0, valign: 'top' })
})

// Arquitetura
s.addText('Arquitetura (containers)', { x: 0.5, y: 4.35, w: 5, h: 0.3, fontFace: F, fontSize: 14, bold: true, color: C.green, margin: 0 })
const dw = 7.7, dh = dw * 360 / 1568
s.addImage({ path: path.join(root, 'diagramas/06-containers-c4.png'), x: 0.5, y: 4.7, w: dw, h: dh })
s.addText('React 19 + Vite (PWA)  •  Node 24 + Express 5 + Socket.io  •  PostgreSQL  •  MCP Server', { x: 0.5, y: 4.7 + dh + 0.1, w: dw, h: 0.3, fontFace: F, fontSize: 12, color: C.gray, margin: 0 })

// Telas
const iw = 3.9, ih = iw * 900 / 1440
s.addImage({ path: path.join(root, 'capturas/03-ofertas-do-bairro.png'), x: 8.93, y: 1.45, w: iw, h: ih })
s.addText('Ofertas do bairro (cliente)', { x: 8.93, y: 1.45 + ih + 0.03, w: iw, h: 0.28, fontFace: F, fontSize: 11, color: C.gray, margin: 0 })
s.addImage({ path: path.join(root, 'capturas/22-kanban.png'), x: 8.93, y: 4.4, w: iw, h: ih })
s.addText('Kanban de pedidos em tempo real (lojista)', { x: 8.93, y: 4.4 + ih + 0.03, w: iw, h: 0.28, fontFace: F, fontSize: 11, color: C.gray, margin: 0 })

// Rodapé
s.addShape(pptx.ShapeType.rect, { x: 0, y: 7.2, w: 13.333, h: 0.3, fill: { color: C.dark }, line: { type: 'none' } })
s.addText('Carlos Antônio de Oliveira Trévia • Bacharelado em Ciência da Computação • Unifor', { x: 0.5, y: 7.2, w: 12.3, h: 0.3, fontFace: F, fontSize: 10, color: C.white, margin: 0, valign: 'middle' })

s.addNotes('VizinhoHub é um intermediário de descontos: o comerciante publica ofertas do bairro, cupons de 24 h e ofertas relâmpago; o morador encontra e retira. A arquitetura é um monorepo com API Node/Express, front React PWA, servidor MCP e PostgreSQL. Os números refletem o repositório: 43 tabelas, 18 migrações, 82 requisitos funcionais e 20 diagramas.')
pptx.writeFile({ fileName: path.join(root, 'Slide-Unico-VizinhoHub.pptx') }).then((f) => console.log('ok', f))
