'use strict'
const path = require('path')

// Pasta de entrega (pai de _gerador) e caminhos derivados.
const ROOT = path.resolve(__dirname, '..')
// Pacotes de apoio (docx, puppeteer, image-size, jszip). Pode ser trocado com a variável FERRAMENTAS.
const FERRAMENTAS = process.env.FERRAMENTAS ||
  'C:/Users/USURIO~1/AppData/Local/Temp/claude/9945f5bdd61a86aa/26c81f90-b8a7-4c63-b1fd-6ce2a3e3c6e0/scratchpad/tools/node_modules'
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'

module.exports = {
  ROOT,
  DIAGRAMAS: path.join(ROOT, 'diagramas'),
  CAPTURAS: path.join(ROOT, 'capturas'),
  BUILD: path.join(__dirname, 'build'),
  SAIDA_DOCX: path.join(ROOT, 'Relatorio-Final-VizinhoHub.docx'),
  SAIDA_PDF: path.join(ROOT, 'Relatorio-Final-VizinhoHub.pdf'),
  CHROME,
  req: (m) => require(path.join(FERRAMENTAS, m)),
  META: {
    titulo: 'VizinhoHub',
    subtitulo: 'Plataforma web de ofertas e pedidos em tempo real para o pequeno varejo do bairro',
    tipo: 'Relatório Final do Projeto de Extensão',
    instituicao: 'Universidade de Fortaleza (Unifor)',
    centro: 'Centro de Ciências Tecnológicas',
    curso: 'Desenvolvimento de Plataformas Web — 2026.2',
    autor: 'Carlos Trevia',
    local: 'Fortaleza, novembro de 2026',
    cabecalho: 'VizinhoHub — Relatório Final do Projeto de Extensão',
    rodape: 'Unifor · Desenvolvimento de Plataformas Web · 2026.2',
  },
  COR: '#2E7D32',
  COR_ESCURA: '#1B5E20',
  COR_ZEBRA: '#F1F8F2',
  // Área útil (px a 96 dpi): retrato 16 cm x 24,7 cm; paisagem 24,7 cm x 16 cm.
  AREA: { pw: 604, ph: 930, lw: 933, lh: 600 },
}
