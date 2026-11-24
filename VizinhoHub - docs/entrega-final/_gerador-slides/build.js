// Gera Slides-VizinhoHub-Final.pptx. Uso: node build.js [--mirror]
const path = require('path')
const fs = require('fs')
const { execSync } = require('child_process')
const PptxGenJS = require('pptxgenjs')
const { Deck, check, mirrorHtml, W, H, C, FONT, pngSize } = require('./lib')

const ROOT = path.resolve(__dirname, '..', '..', '..')
const ENTREGA = path.resolve(__dirname, '..')
const DIAG = (n) => {
  const f = path.join(ENTREGA, 'diagramas', n + '.png')
  if (!fs.existsSync(f)) { if (process.env.STUB) return path.join(ENTREGA, 'diagramas', '08-sequencia-pedido-tempo-real.png'); throw new Error('diagrama ausente: ' + n) }
  return f
}
const CAP = (n) => {
  const f = path.join(ENTREGA, 'capturas', n + '.png')
  if (!fs.existsSync(f)) throw new Error('captura ausente: ' + n)
  return f
}
const CROP = (n) => path.join(__dirname, 'crops', n + '.png')
const commits = execSync('git rev-list --count HEAD', { cwd: ROOT }).toString().trim()

const pptx = new PptxGenJS()
pptx.layout = 'LAYOUT_WIDE' // 13.333 x 7.5
pptx.title = 'VizinhoHub - Apresentação final'
pptx.author = 'Carlos Antônio de Oliveira Trévia'
pptx.company = 'Unifor'
const deck = new Deck(pptx)

const MX = 0.6
const CW = W - 2 * MX // 12.133
const BOTTOM = 6.9
const used = {} // slide -> imagens

// ---------- estrutura comum ----------
function chrome(s, title, sub) {
  s.rect({ x: 0, y: 0, w: W, h: 0.14, fill: C.green })
  s.text(title, { x: MX, y: 0.36, w: CW, h: 0.62, size: 30, bold: true, color: C.ink, valign: 'middle' })
  if (sub) s.text(sub, { x: MX, y: 1.0, w: CW, h: 0.38, size: 18, color: C.gray, valign: 'middle' })
  s.rect({ x: MX, y: 7.02, w: CW, h: 0.01, fill: C.line })
  s.text('VizinhoHub · Unifor 2026.2', { x: MX, y: 7.07, w: 6, h: 0.25, size: 11, color: C.gray, valign: 'middle' })
  s.text(String(s.n), { x: W - MX - 1, y: 7.07, w: 1, h: 0.25, size: 11, color: C.gray, align: 'right', valign: 'middle' })
  return sub ? 1.5 : 1.2
}
function est(list, w, size) {
  // reaproveita a estimativa da lib via check interno
  const { neededHeightPublic } = require('./lib')
  return neededHeightPublic({ list, w, size, bold: false, lineSp: 1 })
}
function card(s, { x, y, w, h, head, body, hs = 22, bs = 17, fill = C.greenLight, bar = C.green }) {
  s.rect({ x, y, w, h, fill })
  s.rect({ x, y, w, h: 0.07, fill: bar })
  s.text(head, { x: x + 0.25, y: y + 0.28, w: w - 0.5, h: 0.5 * Math.ceil(head.length * hs * 0.0072 / (w - 0.5) + 0.01), size: hs, bold: true, color: C.greenDark })
  const hh = 0.5 * Math.ceil(head.length * hs * 0.0072 / (w - 0.5) + 0.01)
  s.text(body, { x: x + 0.25, y: y + 0.38 + hh, w: w - 0.5, h: h - hh - 0.55, size: bs, color: C.ink })
}

// diagrama grande + pontos (lateral se a imagem for alta, faixa inferior se for larga)
function diagramSlide(s, { title, sub, img, points = [], ptsSize = 16 }) {
  const top = chrome(s, title, sub)
  const area = { x: MX, y: top, w: CW, h: BOTTOM - top }
  const sz = pngSize(img)
  const ar = sz.w / sz.h
  used[s.n] = [path.basename(img)]
  const wFull = area.h * ar
  if (points.length && wFull <= area.w - 3.9) {
    const panelW = Math.min(5.3, area.w - wFull - 0.45)
    const gw = wFull + 0.45 + panelW
    const gx = MX + (area.w - gw) / 2
    const box = s.img(img, { x: gx, y: area.y, w: wFull, h: area.h }, { align: 'left', valign: 'top' })
    let y = box.y
    points.forEach((p) => {
      const paras = [{ t: p.h, b: true, c: C.greenDark, s: ptsSize + 2, after: 3 }, { t: p.t, s: ptsSize }]
      const hh = est(paras, panelW - 0.3, ptsSize) + 0.06
      s.rect({ x: gx + wFull + 0.45, y, w: 0.06, h: hh, fill: C.green })
      s.text(paras, { x: gx + wFull + 0.45 + 0.22, y, w: panelW - 0.22, h: hh, size: ptsSize })
      y += hh + 0.24
    })
  } else if (points.length) {
    const n = points.length
    const gap = 0.3
    const colW = (CW - gap * (n - 1)) / n
    const heights = points.map((p) => est([{ t: p.h, b: true, s: ptsSize + 1, after: 3 }, { t: p.t, s: ptsSize - 1 }], colW, ptsSize - 1) + 0.08)
    const stripH = Math.max(...heights) + 0.2
    const availH = area.h - stripH - 0.3
    // imagem e faixa formam um bloco centralizado verticalmente
    const imgW = Math.min(area.w, availH * ar), imgH = imgW / ar
    const shift = (area.h - (imgH + 0.3 + stripH)) / 2
    const box = s.img(img, { x: area.x, y: area.y + shift, w: area.w, h: imgH })
    const y0 = area.y + shift + box.h + 0.3
    points.forEach((p, i) => {
      const x = MX + i * (colW + gap)
      s.rect({ x, y: y0, w: colW, h: 0.05, fill: C.green })
      s.text([{ t: p.h, b: true, c: C.greenDark, s: ptsSize + 1, after: 3 }, { t: p.t, s: ptsSize - 1 }], { x, y: y0 + 0.14, w: colW, h: stripH - 0.14, size: ptsSize - 1 })
    })
  } else {
    s.img(img, area)
  }
}

// ======================================================================
// 1 Capa
{
  const s = deck.slide('capa')
  s.rect({ x: 0, y: 0, w: 8.1, h: H, fill: C.green })
  s.rect({ x: 0.8, y: 2.95, w: 1.2, h: 0.09, fill: C.orange })
  s.text('Projeto de extensão · Unifor · 2026.2', { x: 0.8, y: 0.8, w: 6.8, h: 0.4, size: 18, color: C.greenLight })
  s.text('VizinhoHub', { x: 0.8, y: 1.45, w: 6.9, h: 1.3, size: 66, bold: true, color: C.white, valign: 'middle' })
  s.text('Plataforma de ofertas e pedidos do varejo de bairro', { x: 0.8, y: 3.3, w: 6.6, h: 1.1, size: 28, color: C.white })
  s.text([
    { t: 'Desenvolvimento de Plataformas Web', s: 18, b: true, c: C.white, after: 4 },
    { t: 'Carlos Antônio de Oliveira Trévia', s: 18, c: C.greenLight, after: 2 },
    { t: 'Bacharelado em Ciência da Computação · Universidade de Fortaleza', s: 16, c: C.greenLight },
  ], { x: 0.8, y: 5.35, w: 6.9, h: 1.4, size: 18, color: C.white })
  s.rect({ x: 8.1, y: 0, w: W - 8.1, h: H, fill: C.greenLight })
  const f = CROP('mhome-top')
  s.img(f, { x: 8.1 + 0.55, y: 0.6, w: W - 8.1 - 1.1, h: H - 1.2 }, { border: true })
  used[s.n] = ['crops/mhome-top (recorte de 12-mobile-home)']
  s.notes('Boa tarde. Eu sou o Carlos Trévia e apresento o VizinhoHub, o projeto de extensão da disciplina de Desenvolvimento de Plataformas Web. É uma plataforma que reúne as ofertas dos supermercados e mercadinhos do bairro, em Fortaleza, e deixa o morador pegar um cupom de retirada ou fazer um pedido que chega em tempo real ao lojista. Nos próximos minutos mostro o problema, a solução, a arquitetura e os dois desafios técnicos que mais me deram trabalho.')
}

// 2 Problema
{
  const s = deck.slide('problema')
  const top = chrome(s, 'Três gargalos travam o varejo de bairro')
  const items = [
    ['1', 'Descontos pouco visíveis', 'As promoções ficam espalhadas em encartes e mensagens. O morador não sabe onde está o melhor preço perto de casa.'],
    ['2', 'Processos manuais', 'Cadernos e planilhas estáticas não conversam com o catálogo público. O pedido chega por vários canais e se perde.'],
    ['3', 'Taxas de 12% a 25%', 'Marketplaces cobram comissão ou mensalidade que o microempreendedor do bairro não consegue pagar.'],
  ]
  const cw = (CW - 0.6) / 3
  items.forEach((it, i) => {
    const x = MX + i * (cw + 0.3)
    s.rect({ x, y: top + 0.2, w: cw, h: 3.9, fill: C.greenLight })
    s.rect({ x, y: top + 0.2, w: cw, h: 0.08, fill: C.green })
    s.text(it[0], { x: x + 0.3, y: top + 0.5, w: 1, h: 0.9, size: 54, bold: true, color: C.green })
    s.text(it[1], { x: x + 0.3, y: top + 1.5, w: cw - 0.6, h: 0.8, size: 22, bold: true, color: C.ink })
    s.text(it[2], { x: x + 0.3, y: top + 2.35, w: cw - 0.6, h: 1.65, size: 18, color: C.ink })
  })
  s.rect({ x: MX, y: 5.65, w: 0.08, h: 1.15, fill: C.orange })
  s.text([{ t: 'Pergunta do projeto', b: true, c: C.greenDark, s: 18, after: 3 }, { t: 'Como dar visibilidade e agilidade ao comércio do bairro sem cobrar a comissão de um marketplace?', s: 20 }], { x: MX + 0.3, y: 5.65, w: CW - 0.3, h: 1.15, size: 20 })
  s.notes('O ponto de partida são três gargalos que aparecem nos pequenos comércios de Fortaleza. Primeiro, as promoções estão espalhadas em encartes e mensagens, então o morador não consegue comparar preço no bairro. Segundo, o lojista controla tudo em caderno e planilha, que não falam com nenhum catálogo público. Terceiro, os marketplaces cobram de 12 a 25 por cento de comissão, o que inviabiliza a venda online para quem tem margem apertada.')
}

// 3 Público e ODS
{
  const s = deck.slide('publico-ods')
  const top = chrome(s, 'Quem usa e a quais ODS responde')
  const lw = 5.6
  const pers = [
    ['Comerciante / operador', 'Dono de mercadinho ou supermercado de bairro. Cadastra ofertas, recebe pedidos e acompanha as vendas.'],
    ['Morador / cliente final', 'Quem mora no bairro e quer achar o melhor preço perto de casa, pegar o cupom e retirar no caixa.'],
  ]
  pers.forEach((p, i) => {
    const y = top + 0.15 + i * 2.65
    s.rect({ x: MX, y, w: lw, h: 2.45, fill: C.greenLight })
    s.rect({ x: MX, y, w: 0.09, h: 2.45, fill: C.green })
    s.text(p[0], { x: MX + 0.35, y: y + 0.25, w: lw - 0.6, h: 0.45, size: 23, bold: true, color: C.greenDark })
    s.text(p[1], { x: MX + 0.35, y: y + 0.85, w: lw - 0.6, h: 1.4, size: 18, color: C.ink })
  })
  const ods = [
    ['8', 'Trabalho decente e crescimento econômico', 'Renda e vendas do pequeno comerciante'],
    ['9', 'Indústria, inovação e infraestrutura', 'Tecnologia acessível ao pequeno varejo'],
    ['11', 'Cidades e comunidades sustentáveis', 'Economia local e comunidade do bairro'],
    ['12', 'Consumo e produção responsáveis', 'Menos desperdício com o Salva-Estoque'],
  ]
  const ox = MX + lw + 0.4
  const ow = W - MX - ox
  const oh = 1.1
  s.text('Objetivos de Desenvolvimento Sustentável', { x: ox, y: top + 0.1, w: ow, h: 0.4, size: 18, bold: true, color: C.gray })
  ods.forEach((o, i) => {
    const y = top + 0.65 + i * (oh + 0.1)
    s.rect({ x: ox, y, w: 1.05, h: oh, fill: C.green })
    s.text(o[0], { x: ox, y, w: 1.05, h: oh, size: 36, bold: true, color: C.white, align: 'center', valign: 'middle' })
    s.rect({ x: ox + 1.05, y, w: ow - 1.05, h: oh, fill: C.paper })
    s.text([{ t: o[1], b: true, s: 18, after: 2 }, { t: o[2], s: 15, c: C.gray }], { x: ox + 1.3, y: y + 0.1, w: ow - 1.45, h: oh - 0.2, size: 18, valign: 'middle' })
  })
  s.notes('O público tem dois lados. Do lado do comerciante, o dono do pequeno negócio que precisa de uma ferramenta simples para ofertas e pedidos. Do lado do morador, quem quer economizar perto de casa. O projeto se conecta a quatro ODS: o 8, pelo crescimento do pequeno comerciante; o 9, pela inovação e infraestrutura digital acessível; o 11, pela economia da comunidade; e o 12, porque o Salva-Estoque dá desconto automático perto do vencimento e reduz desperdício.')
}

// 4 Solução e objetivos
{
  const s = deck.slide('solucao')
  const top = chrome(s, 'A solução: uma plataforma, três entregáveis')
  s.rect({ x: MX, y: top + 0.05, w: CW, h: 1.15, fill: C.green })
  s.text([{ t: 'Objetivo geral', b: true, s: 15, c: C.greenLight, after: 2 }, { t: 'Conectar moradores e comerciantes do bairro com ofertas visíveis e pedidos em tempo real, sem taxas abusivas de intermediação.', s: 20, c: C.white }], { x: MX + 0.3, y: top + 0.05, w: CW - 0.6, h: 1.15, size: 20, valign: 'middle' })
  const cards = [
    ['VizinhoHub Store', 'Vitrine pública e responsiva (PWA): ofertas do bairro, cupom de retirada, carrinho e acompanhamento do pedido.', 'Específico: tornar os descontos visíveis'],
    ['VizinhoHub Manager', 'Painel do lojista: Kanban em tempo real, PDV, catálogo, ofertas relâmpago e análises de venda.', 'Específico: tirar o lojista do caderno'],
    ['VizinhoHub Core API', 'REST + WebSocket: regras das ofertas, estados do pedido e avisos instantâneos, sobre PostgreSQL.', 'Específico: nunca vender além da oferta'],
  ]
  const cw = (CW - 0.6) / 3
  cards.forEach((c, i) => {
    const x = MX + i * (cw + 0.3)
    const y = top + 1.5
    s.rect({ x, y, w: cw, h: 3.9, fill: C.greenLight })
    s.rect({ x, y, w: cw, h: 0.08, fill: C.green })
    s.text(c[0], { x: x + 0.28, y: y + 0.3, w: cw - 0.56, h: 0.5, size: 24, bold: true, color: C.greenDark })
    s.text(c[1], { x: x + 0.28, y: y + 1.0, w: cw - 0.56, h: 1.9, size: 18, color: C.ink })
    s.rect({ x: x + 0.28, y: y + 3.0, w: cw - 0.56, h: 0.015, fill: C.green })
    s.text(c[2], { x: x + 0.28, y: y + 3.1, w: cw - 0.56, h: 0.6, size: 16, bold: true, color: C.orange })
  })
  s.notes('A solução entrega três peças. A Store é a vitrine do morador, instalável como PWA. O Manager é o painel do lojista, com Kanban de pedidos em tempo real, PDV e análises. A Core API é o coração: REST mais WebSocket, com as regras das ofertas e dos estados do pedido. O objetivo geral é conectar bairro e comerciante sem taxas abusivas, e cada peça atende a um objetivo específico.')
}

// 5 Como funciona
{
  const s = deck.slide('como-funciona')
  const top = chrome(s, 'Como funciona: do clique do cliente ao Kanban')
  const colW = 2.1, gap = (CW - 5 * colW) / 4
  const cx = (i) => MX + i * (colW + gap)
  const ch = 1.6
  const yC = top + 0.55, yL = top + 3.55
  s.text('CLIENTE · VizinhoHub Store', { x: MX, y: top + 0.05, w: 6, h: 0.35, size: 15, bold: true, color: C.green })
  s.text('LOJISTA · VizinhoHub Manager', { x: MX, y: top + 3.05, w: 6, h: 0.35, size: 15, bold: true, color: C.green })
  const box = (i, y, head, body, fill = C.greenLight, tc = C.ink) => {
    s.rect({ x: cx(i), y, w: colW, h: ch, fill })
    s.text([{ t: head, b: true, s: 18, c: fill === C.green ? C.white : C.greenDark, after: 3 }, { t: body, s: 15, c: fill === C.green ? C.white : tc }], { x: cx(i) + 0.15, y: y + 0.12, w: colW - 0.3, h: ch - 0.24, size: 15 })
  }
  box(0, yC, 'Vitrine', 'Ofertas e produtos do bairro')
  box(1, yC, 'Carrinho ou cupom', 'Itens, entrega ou retirada')
  box(2, yC, 'Envia o pedido', 'Validado no servidor', C.green)
  box(4, yC, 'Acompanha', 'Status muda sozinho na tela')
  box(2, yL, 'Chega ao Kanban', 'Aviso visual e som no caixa', C.green)
  box(3, yL, 'Em preparação', 'Lojista aceita o pedido')
  box(4, yL, 'Pronto e concluído', 'Lojista avança o status')
  const my = (y) => y + ch / 2
  s.arrow({ x1: cx(0) + colW, y1: my(yC), x2: cx(1), y2: my(yC) })
  s.arrow({ x1: cx(1) + colW, y1: my(yC), x2: cx(2), y2: my(yC) })
  s.arrow({ x1: cx(2) + colW / 2, y1: yC + ch, x2: cx(2) + colW / 2, y2: yL, color: C.orange, w: 3 })
  s.arrow({ x1: cx(2) + colW, y1: my(yL), x2: cx(3), y2: my(yL) })
  s.arrow({ x1: cx(3) + colW, y1: my(yL), x2: cx(4), y2: my(yL) })
  s.arrow({ x1: cx(4) + colW / 2, y1: yL, x2: cx(4) + colW / 2, y2: yC + ch, color: C.orange, w: 3 })
  s.text([{ t: 'WebSocket (Socket.io)', b: true, s: 15, c: C.orange, after: 1 }, { t: 'evento order:created', s: 14, c: C.gray }], { x: cx(2) + colW / 2 + 0.15, y: yC + ch + 0.3, w: 2.0, h: 0.85, size: 14 })
  s.text([{ t: 'WebSocket (Socket.io)', b: true, s: 15, c: C.orange, after: 1 }, { t: 'evento order:status_updated', s: 14, c: C.gray }], { x: cx(4) + colW / 2 - 0.15 - 2.6, y: yC + ch + 0.3, w: 2.6, h: 0.85, size: 14, align: 'right' })
  s.text('Cada lojista e cada cliente entram numa sala própria do Socket.io: o evento só chega a quem é dono do pedido.', { x: MX, y: yL + 0.15, w: 3.9, h: 1.2, size: 16, color: C.gray })
  used[s.n] = ['(fluxo desenhado em formas nativas)']
  s.notes('Este é o fluxo principal. O cliente navega pela vitrine, monta o carrinho ou pega um cupom e envia o pedido. O servidor valida e publica um evento pelo WebSocket para a sala daquele lojista, e o pedido aparece no Kanban com aviso e som, sem recarregar a página. Quando o lojista avança o status, outro evento volta para a sala do cliente, e a tela de acompanhamento muda sozinha.')
}

// 6 Demo vitrine
{
  const s = deck.slide('demo-vitrine')
  const top = chrome(s, 'Demo da vitrine: desktop e celular')
  const capH = 0.35
  const ah = BOTTOM - top - capH - 0.1
  const mw = ah * (780 / 1690)
  const dw = CW - 2 * (mw + 0.3)
  const dh = dw / 1.6
  const dy = top + (ah - dh) / 2
  s.img(CROP('home-top'), { x: MX, y: dy, w: dw, h: dh })
  s.text('Início no desktop', { x: MX, y: dy + dh + 0.12, w: dw, h: capH, size: 15, color: C.gray, align: 'center' })
  const m1 = MX + dw + 0.3
  s.img(CROP('mhome-top'), { x: m1, y: top, w: mw, h: ah })
  s.text('Início no celular', { x: m1, y: top + ah + 0.1, w: mw, h: capH, size: 15, color: C.gray, align: 'center' })
  const m2 = m1 + mw + 0.3
  s.img(CROP('mofertas-top'), { x: m2, y: top, w: mw, h: ah })
  s.text('Ofertas no celular', { x: m2, y: top + ah + 0.1, w: mw, h: capH, size: 15, color: C.gray, align: 'center' })
  used[s.n] = ['crops/home-top (01-home)', 'crops/mhome-top (12-mobile-home)', 'crops/mofertas-top (13-mobile-ofertas)']
  s.notes('Aqui está a vitrine funcionando, em ambiente de desenvolvimento com o catálogo importado. A mesma página responde no desktop e no celular, porque o front é mobile-first e instalável como PWA. A busca, os departamentos e as ofertas ficam a um toque, e o carrinho flutuante acompanha o cliente até finalizar o pedido.')
}

// 7 Demo painel
{
  const s = deck.slide('demo-painel')
  const top = chrome(s, 'Demo do painel: Kanban e análises')
  const iw = (CW - 0.4) / 2
  const ih = iw / 1.6
  s.img(CAP('22-kanban'), { x: MX, y: top, w: iw, h: ih })
  s.img(CROP('analises-top'), { x: MX + iw + 0.4, y: top, w: iw, h: ih })
  const ty = top + ih + 0.25
  s.text([{ t: 'Mural de pedidos', b: true, c: C.greenDark, s: 20, after: 3 }, { t: 'O pedido novo entra na coluna Novos Pedidos sem recarregar, com aviso e som. Avançar o status também atualiza o cliente.', s: 16 }], { x: MX, y: ty, w: iw, h: 1.5, size: 16 })
  s.text([{ t: 'Análises da loja', b: true, c: C.greenDark, s: 20, after: 3 }, { t: 'Faturamento, ticket médio, lucro e conversão da vitrine, comparados ao período anterior. Dados de demonstração.', s: 16 }], { x: MX + iw + 0.4, y: ty, w: iw, h: 1.5, size: 16 })
  used[s.n] = ['22-kanban', 'crops/analises-top (21-analises)']
  s.notes('No painel do lojista, a tela principal é o mural Kanban. Os pedidos chegam por WebSocket e o navegador toca um aviso, depois que o lojista ativa o som do caixa. À direita, a tela de análises com faturamento, ticket médio, lucro e conversão. Atenção: esses números vêm de dados de demonstração gerados para a captura, não de vendas reais.')
}

// 8 Ofertas do bairro
diagramSlide(deck.slide('ofertas-bairro'), {
  title: 'Ofertas do bairro, cupom e leitura de encartes',
  img: DIAG('10-sequencia-cupom-ofertas-bairro'),
  points: [
    { h: 'A IA lê o encarte', t: 'Página, PDF ou imagem viram ofertas em JSON (Claude). Mesmo conteúdo, sem nova chamada.' },
    { h: 'O servidor não confia na IA', t: 'Percentual e elegibilidade são recalculados; oferta inválida é descartada.' },
    { h: 'Cupom de retirada', t: 'Vale 24 h e exige desconto de 15% ou mais. A compra confirmada vira venda.' },
  ],
})
deck.slides[7].notes('Esta é a parte de inovação do projeto. As ofertas dos supermercados entram por leitura automática de páginas ou de encartes em PDF e imagem, feita pelo Claude, e o servidor valida tudo: recalcula o percentual de desconto, descarta o que parece errado e nunca confia cegamente na IA. O morador pega um cupom de retirada que vale 24 horas e só é elegível com desconto de 15 por cento ou mais. O cupom é uma reserva de preço: a baixa no caixa da rede depende de parceria.')

// 9 Arquitetura contexto
diagramSlide(deck.slide('arq-contexto'), {
  title: 'Arquitetura: o sistema e quem fala com ele',
  img: DIAG('05-contexto-c4'),
  points: [
    { h: 'Pessoas', t: 'Cliente e comerciante usam a PWA; o lojista também fala com a API por um servidor MCP.' },
    { h: 'Sistemas externos', t: 'Claude (leitura de encartes), Firebase Auth, gateway Asaas e mapas OpenStreetMap.' },
  ],
})
deck.slides[8].notes('Esta é a visão de contexto, no estilo C4. Dentro da fronteira está o VizinhoHub; fora, as pessoas e os sistemas externos. Cliente e comerciante usam a aplicação web. O lojista também pode gerenciar ofertas conversando com uma IA, por meio do servidor MCP. Os serviços externos são opcionais e ficam atrás de adaptadores: Claude para ler encartes, Firebase para login com Google e o gateway Asaas para o Clube VIP.')

// 10 Arquitetura containers
diagramSlide(deck.slide('arq-containers'), {
  title: 'Arquitetura: containers e tecnologias',
  img: DIAG('06-containers-c4'),
  points: [
    { h: 'Front', t: 'React + Vite (PWA), Socket.io-client, Leaflet e Recharts.' },
    { h: 'Back-end', t: 'Node 24, TypeScript, Express 5 e Socket.io em apps/api.' },
    { h: 'Dados e contratos', t: 'PostgreSQL 16 com SQL puro; schemas zod em packages/contracts.' },
    { h: 'Implantação', t: 'Render (API + banco), Vercel ou Cloudflare Pages (front); alternativa PM2 em VPS.' },
  ],
})
deck.slides[9].notes('Aqui estão os containers do monorepo. O front em React com Vite conversa com a API por JSON e por WebSocket. A API Express 5 tem as rotas, o Socket.io e os jobs agendados, e usa um único PostgreSQL com 43 tabelas. Os contratos em zod ficam num pacote compartilhado, então API e front usam os mesmos tipos. Em produção, a API e o banco vão para o Render e o front para Vercel ou Cloudflare Pages, sem Docker.')

// 11 Camadas e decisões
diagramSlide(deck.slide('camadas'), {
  title: 'Camadas do backend e decisões de projeto',
  img: DIAG('07-camadas-backend'),
  ptsSize: 15,
  points: [
    { h: 'Camadas explícitas', t: 'routes, service, repository: rota valida e autentica, o serviço decide, o repositório fala SQL.' },
    { h: 'SQL puro, sem ORM', t: 'O UPDATE condicional é o lock, e fica visível no código.' },
    { h: 'React + Vite, API separada', t: 'WebSocket não roda em serverless; Next.js ficou como opção futura (16/11).' },
    { h: 'Sem estoque de produto', t: 'O VizinhoHub só intermedeia descontos; só a oferta tem quantidade (20/11).' },
  ],
})
deck.slides[10].notes('O backend segue arquitetura em camadas: a rota autentica e valida a entrada, o serviço concentra as regras e transações, e o repositório fala SQL puro com o driver pg. O serviço publica eventos depois do commit, sem conhecer o Socket.io. As principais decisões foram manter React com Vite separado da API, porque WebSocket persistente não roda em funções serverless, e assumir que o VizinhoHub é intermediário de descontos, sem estoque de produto. Só as ofertas têm quantidade limitada.')

// 12 Tempo real
diagramSlide(deck.slide('tempo-real'), {
  title: 'Desafio 1: tempo real do pedido ao Kanban',
  img: DIAG('08-sequencia-pedido-tempo-real'),
  points: [
    { h: 'Salas por papel', t: 'merchant:id e customer:id; o evento só chega ao dono do pedido.' },
    { h: 'Publica após o COMMIT', t: 'Ninguém é avisado de um pedido que a transação desfez.' },
    { h: 'Som do caixa', t: 'O navegador só libera áudio após um gesto: botão Ativar som do caixa.' },
  ],
})
deck.slides[11].notes('O primeiro desafio técnico é o tempo real. O pedido é gravado numa transação e, só depois do commit, a API publica o evento na sala do lojista, para nunca avisar de um pedido que foi desfeito. O Kanban recebe, mostra o cartão e toca o aviso. Um detalhe prático: navegadores só liberam som depois de um gesto do usuário, por isso existe o botão para ativar o som do caixa no início do turno.')

// 13 Concorrência diagrama
diagramSlide(deck.slide('concorrencia'), {
  title: 'Desafio 2: concorrência em ofertas limitadas',
  img: DIAG('09-sequencia-oferta-concorrencia'),
  points: [
    { h: 'O UPDATE condicional é o lock', t: 'WHERE qty_available >= q decide no banco, sem ler e depois gravar.' },
    { h: 'Limite por cliente também é atômico', t: 'INSERT ... ON CONFLICT ... WHERE, na ordem que evita deadlock.' },
    { h: 'Quem perde recebe 422', t: 'A segunda transação reavalia, vê zero linhas e responde FLASH_UNAVAILABLE.' },
  ],
})
deck.slides[12].notes('O segundo desafio é a corrida por unidades limitadas. Se dois clientes compram a última unidade ao mesmo tempo, ler a quantidade e depois gravar deixaria os dois passarem. A solução é um UPDATE condicional: a própria instrução decide no banco se ainda há quantidade, e a linha fica travada até o commit. O limite por cliente usa o mesmo padrão, com INSERT ON CONFLICT, e a ordem das operações evita deadlock.')

// 14 Concorrência resultados
{
  const s = deck.slide('concorrencia-resultados')
  const top = chrome(s, 'Concorrência medida: o banco decide', 'Testes automatizados com transações simultâneas contra PostgreSQL real')
  const rows = [
    ['Caso', 'Instrução atômica', 'Cenário do teste', 'Resultado'],
    ['Oferta relâmpago', 'UPDATE ... WHERE qty_available >= q', '30 clientes, 5 unidades', 'Vendeu 5'],
    ['Limite por cliente', 'INSERT ... ON CONFLICT ... WHERE', '6 tentativas, limite 2', '2 passam'],
    ['Fiado (caderneta)', 'UPDATE ... WHERE saldo + v <= limite', '20 compras de R$ 10, limite R$ 100', '10 passam'],
    ['Vaga de encomenda', 'ON CONFLICT ... WHERE booked < capacity', '10 reservas, capacidade 3', '3 entram'],
    ['Prato do dia', 'UPDATE ... WHERE qty_available >= q', '10 pedidos, 4 porções', '4 vendem'],
    ['Aceite de corrida', 'UPDATE ... WHERE courier_id IS NULL', '8 entregadores', '1 leva'],
  ]
  s.table(rows, { x: MX, y: top + 0.1, colW: [2.5, 4.4, 3.5, 1.733], rowH: [0.5, 0.58, 0.58, 0.58, 0.58, 0.58, 0.58], size: 16 })
  s.rect({ x: MX, y: 6.0, w: 0.08, h: 0.8, fill: C.orange })
  s.text([{ t: 'Edição de produto pelo lojista: bloqueio otimista', b: true, c: C.greenDark, s: 17, after: 2 }, { t: 'WHERE id = $1 AND version = $2; se nenhuma linha muda, a API responde HTTP 409.', s: 16 }], { x: MX + 0.3, y: 6.0, w: CW - 0.3, h: 0.8, size: 16 })
  used[s.n] = ['(tabela nativa)']
  s.notes('Estes são os resultados medidos pela suíte de testes, sempre com transações simultâneas contra um PostgreSQL de verdade. Trinta clientes disputando cinco unidades: vendeu exatamente cinco. No fiado, vinte compras de dez reais com limite de cem: dez passam. Nas vagas de encomenda, dez reservas para três vagas: três entram. E, no aceite de corrida, oito entregadores disputam e só um leva. Para edição de produto, uso bloqueio otimista com versão.')
}

// 15 Modelagem
diagramSlide(deck.slide('modelagem'), {
  title: 'Modelagem de dados: 43 tabelas no PostgreSQL',
  img: DIAG('03-der-completo'),
  ptsSize: 15,
  points: [
    { h: 'SQL puro e migrações', t: 'schema.sql para banco novo e 18 migrações idempotentes.' },
    { h: 'Núcleo neste DER', t: 'Logística, caderneta, VIP e carrinho têm DER próprio (04a e 04b).' },
    { h: 'Preço histórico', t: 'order_items.unit_price guarda o valor no momento da compra.' },
    { h: 'Dinheiro com livro-razão', t: 'credit_ledger só recebe inserções e explica cada saldo.' },
    { h: 'Sem enums novos', t: 'VARCHAR com CHECK evita ALTER TYPE nas migrações.' },
  ],
})
deck.slides[14].notes('O banco é PostgreSQL com SQL puro: um schema completo para bancos novos e migrações idempotentes para os existentes. São 43 tabelas, do núcleo de usuários, produtos e pedidos até os módulos de ofertas, entrega, caderneta e Clube VIP. Duas escolhas que valem destacar: o preço unitário fica gravado no item do pedido, preservando o histórico, e o dinheiro da caderneta tem um livro-razão que só aceita inserções.')

// 16 Estados
diagramSlide(deck.slide('estados'), {
  title: 'Máquina de estados e regras de negócio',
  img: DIAG('11-estados-pedido'),
  ptsSize: 15,
  points: [
    { h: 'Pedido', t: 'Cancelar só em PENDING ou IN_PREPARATION; outra transição responde 409.' },
    { h: 'Aceitar ou cancelar', t: 'Só muda o status; oferta limitada devolve a quantidade.' },
    { h: 'Cupom', t: 'Vale 24 h; elegível com desconto de 15% ou mais.' },
    { h: 'Salva-Estoque', t: 'Vence hoje ou amanhã: 50%; até 3 dias: 30%.' },
  ],
})
deck.slides[15].notes('O pedido segue uma máquina de estados simples: pendente, em preparação, pronto e concluído, com cancelamento possível até o preparo. As transições são validadas no servidor, então a API não aceita um salto de estado. Aceitar ou cancelar só muda o status, já que não há estoque de produto, e uma oferta limitada devolve a quantidade. Entre as regras de negócio, o cupom vale 24 horas e o Salva-Estoque dá 50 por cento para produto que vence hoje ou amanhã e 30 por cento até três dias.')

// 17 Segurança e LGPD
diagramSlide(deck.slide('seguranca'), {
  title: 'Segurança e LGPD',
  img: DIAG('20-seguranca-e-lgpd'),
  points: [
    { h: 'Papel vem do banco', t: 'A API confere cliente ou comerciante em cada chamada.' },
    { h: 'Entrada validada', t: 'Todo corpo passa por zod; login e funil têm limite de tentativas.' },
    { h: 'Retenção definida', t: 'GPS 30 dias; funil 90 dias pseudonimizado; pedidos 5 anos.' },
    { h: 'PIN de entrega', t: '5 tentativas e apagado na confirmação.' },
  ],
})
deck.slides[16].notes('Segurança e LGPD foram tratadas no projeto, e não depois. O papel do usuário, cliente ou comerciante, vem sempre do banco e é conferido em cada chamada. O conteúdo lido de páginas externas é tratado como dado não confiável. Para a LGPD, cada dado tem uma retenção: o GPS do entregador fica 30 dias, o funil de conversão 90 dias e pseudonimizado, e o PIN de entrega é apagado quando a entrega é confirmada. Um job de limpeza aplica essas regras.')

// 18 Qualidade e testes
{
  const s = deck.slide('qualidade')
  const top = chrome(s, 'Qualidade: testes contra um PostgreSQL real')
  const tiles = [
    ['402', 'testes automatizados, todos passando'],
    ['337', 'testes da API em 22 arquivos e 95 suítes'],
    ['47', 'testes do servidor MCP'],
    ['18', 'testes dos contratos zod'],
  ]
  const tw = 2.7, th = 1.9
  tiles.forEach((t, i) => {
    const x = MX + (i % 2) * (tw + 0.25)
    const y = top + 0.15 + Math.floor(i / 2) * (th + 0.25)
    s.rect({ x, y, w: tw, h: th, fill: i === 0 ? C.green : C.greenLight })
    s.text(t[0], { x: x + 0.25, y: y + 0.2, w: tw - 0.5, h: 0.9, size: 48, bold: true, color: i === 0 ? C.white : C.green, valign: 'middle' })
    s.text(t[1], { x: x + 0.25, y: y + 1.1, w: tw - 0.5, h: 0.7, size: 15, color: i === 0 ? C.white : C.ink })
  })
  const rx = MX + 2 * tw + 0.25 + 0.5
  const rw = W - MX - rx
  const pts = [
    ['Banco real, não simulado', 'Os testes sobem um PostgreSQL embutido com o schema de verdade.'],
    ['Concorrência de verdade', 'De 6 a 30 transações simultâneas por cenário.'],
    ['API documentada e guardada', 'OpenAPI 3.1 gerado do código; rota sem documentação faz o teste falhar.'],
    ['Typecheck limpo', 'tsc sem erros na API.'],
  ]
  let y = top + 0.15
  pts.forEach((p) => {
    const paras = [{ t: p[0], b: true, c: C.greenDark, s: 19, after: 2 }, { t: p[1], s: 16 }]
    const hh = est(paras, rw - 0.25, 16) + 0.06
    s.rect({ x: rx, y, w: 0.06, h: hh, fill: C.green })
    s.text(paras, { x: rx + 0.22, y, w: rw - 0.22, h: hh, size: 16 })
    y += hh + 0.3
  })
  used[s.n] = ['(sem imagens)']
  s.notes('Sobre qualidade: rodei toda a suíte para esta apresentação. São 337 testes na API, 47 no servidor MCP e 18 nos contratos, 402 no total, todos passando. O ponto forte é que os testes usam um PostgreSQL embutido com o schema real, então as garantias de concorrência são provadas no banco e não em simulação. A documentação OpenAPI é gerada do código e um teste falha se uma rota ficar sem documentação, e o typecheck do TypeScript está limpo.')
}

// 19 Metodologia e cronograma
diagramSlide(deck.slide('cronograma'), {
  title: 'Metodologia e cronograma',
  img: DIAG('18-cronograma-gantt'),
  points: [
    { h: 'Iterativa, em etapas', t: `Cinco fases planejadas, executadas em 15 etapas e ${commits} commits, um por ideia ("etapa.n").` },
    { h: 'Do protótipo ao produto', t: 'Primeiro escopo e protótipo HTML; depois banco, API, React e módulos avançados.' },
  ],
})
deck.slides[18].notes('O trabalho foi iterativo, em quinze etapas, com um commit por ideia e mensagens no formato etapa ponto número. As primeiras etapas fecharam escopo, fluxo e protótipo HTML e CSS; as seguintes construíram a API, o front em React e os módulos avançados, como ofertas relâmpago, logística, caderneta e Clube VIP. O cronograma mostra como as etapas se distribuíram entre setembro e novembro de 2026.')

// 20 Resultados e impacto
{
  const s = deck.slide('resultados')
  const top = chrome(s, 'Resultados em números e indicadores de impacto')
  const tiles = [
    [commits, 'commits em 15 etapas'],
    ['43', 'tabelas no PostgreSQL'],
    ['130', 'operações na API (OpenAPI)'],
    ['20', 'módulos de negócio na API'],
    ['2.325', 'produtos em 24 departamentos'],
    ['10', 'ferramentas do servidor MCP'],
    ['402', 'testes passando'],
    ['23 mil', 'linhas de código (API e front)'],
  ]
  const tw = 1.95, th = 1.55, g = 0.18
  tiles.forEach((t, i) => {
    const x = MX + (i % 4) * (tw + g)
    const y = top + 0.15 + Math.floor(i / 4) * (th + g)
    s.rect({ x, y, w: tw, h: th, fill: C.greenLight })
    s.text(t[0], { x: x + 0.15, y: y + 0.12, w: tw - 0.3, h: 0.7, size: 32, bold: true, color: C.green, valign: 'middle' })
    s.text(t[1], { x: x + 0.15, y: y + 0.85, w: tw - 0.3, h: 0.62, size: 14, color: C.ink })
  })
  const rx = MX + 4 * (tw + g) + 0.35
  const rw = W - MX - rx
  s.text('Indicadores de impacto previstos para o piloto', { x: rx, y: top + 0.15, w: rw, h: 0.7, size: 19, bold: true, color: C.greenDark })
  const inds = [
    ['Visibilidade', 'Ofertas vigentes e cupons gerados por bairro.'],
    ['Agilidade', 'Tempo entre pedido criado e aceito no Kanban.'],
    ['Custo', 'Taxa paga pelo lojista frente aos 12% a 25% de marketplaces.'],
    ['Adoção', 'Lojas ativas e pedidos por semana.'],
  ]
  let y = top + 0.95
  inds.forEach((p) => {
    const paras = [{ t: p[0], b: true, c: C.greenDark, s: 16, after: 1 }, { t: p[1], s: 14 }]
    const hh = est(paras, rw - 0.25, 14) + 0.04
    s.rect({ x: rx, y, w: 0.06, h: hh, fill: C.orange })
    s.text(paras, { x: rx + 0.2, y, w: rw - 0.2, h: hh, size: 14 })
    y += hh + 0.16
  })
  s.text('Ainda sem piloto com lojistas reais: o impacto é plano de validação, não resultado medido.', { x: MX, y: 6.0, w: 8.2, h: 0.8, size: 15, color: C.gray })
  used[s.n] = ['(sem imagens)']
  s.notes('Em números, o projeto tem 43 tabelas, 130 operações documentadas na API, 20 módulos de negócio, mais de dois mil produtos em 24 departamentos e 402 testes passando. À direita estão os indicadores de impacto que pretendo medir num piloto: visibilidade das ofertas, agilidade no aceite do pedido, custo frente às comissões de marketplace e adoção pelas lojas. É importante ser honesto: ainda não houve piloto com lojistas reais, então impacto aqui é plano de validação.')
}

// 21 Limitações e próximos passos
{
  const s = deck.slide('proximos')
  const top = chrome(s, 'Limitações e próximos passos')
  const cw = (CW - 0.4) / 2
  const colBox = (x, head, color, items) => {
    s.rect({ x, y: top + 0.1, w: cw, h: 0.55, fill: color })
    s.text(head, { x: x + 0.25, y: top + 0.1, w: cw - 0.5, h: 0.55, size: 20, bold: true, color: C.white, valign: 'middle' })
    let y = top + 0.9
    items.forEach((it) => {
      const paras = [{ t: it[0], b: true, c: C.greenDark, s: 17, after: 1 }, { t: it[1], s: 15 }]
      const hh = est(paras, cw - 0.3, 15) + 0.04
      s.text(paras, { x: x + 0.1, y, w: cw - 0.1, h: hh, size: 15 })
      y += hh + 0.2
    })
  }
  colBox(MX, 'Limitações atuais', C.gray, [
    ['Sem implantação pública', 'Render e Vercel estão configurados, mas o sistema ainda roda em ambiente de desenvolvimento.'],
    ['Cupom é reserva de preço', 'A baixa no caixa da rede depende de parceria com cada rede.'],
    ['Encartes sem tela própria', 'O envio é pela API e pelo servidor MCP; sites montados por JavaScript pedem navegador headless.'],
    ['Sem piloto real', 'Falta validar com lojistas e moradores.'],
  ])
  colBox(MX + cw + 0.4, 'Próximos passos', C.green, [
    ['Logística', 'Pool de entregadores do bairro, com cadastro e confiança, além da frota própria.'],
    ['Clube VIP', 'Validar o gateway Asaas fora do sandbox.'],
    ['Caderneta', 'Lembretes e acerto com lojistas reais.'],
    ['Carrinho inteligente', 'Ampliar o vínculo do catálogo com itens canônicos.'],
  ])
  used[s.n] = ['(sem imagens)']
  s.notes('As limitações atuais: o sistema ainda não está implantado publicamente, embora Render e Vercel estejam configurados; o cupom é uma reserva de preço, e a baixa no caixa depende de parceria com a rede; e falta um piloto com lojistas reais. Os próximos passos seguem o roadmap: logística com o pool de entregadores do bairro, validação do gateway do Clube VIP, a caderneta com lojistas reais e a ampliação do carrinho inteligente, que depende da qualidade do vínculo entre os produtos do catálogo.')
}

// 22 Conclusão
{
  const s = deck.slide('conclusao')
  s.rect({ x: 0, y: 0, w: W, h: H, fill: C.green })
  s.text('Conclusão', { x: MX + 0.2, y: 0.7, w: 8, h: 0.8, size: 36, bold: true, color: C.white })
  s.rect({ x: MX + 0.2, y: 1.55, w: 1.2, h: 0.09, fill: C.orange })
  const items = [
    'Ofertas do bairro visíveis em um só lugar, com cupom de retirada.',
    'Pedido em tempo real do cliente ao Kanban do lojista.',
    'Garantias de concorrência provadas por testes no próprio banco.',
  ]
  items.forEach((t, i) => {
    s.text(String(i + 1), { x: MX + 0.2, y: 2.1 + i * 1.1, w: 0.6, h: 0.8, size: 36, bold: true, color: C.orange, valign: 'middle' })
    s.text(t, { x: MX + 1.0, y: 2.1 + i * 1.1, w: 10.8, h: 0.8, size: 24, color: C.white, valign: 'middle' })
  })
  s.text('Obrigado! Perguntas?', { x: MX + 0.2, y: 5.6, w: 8, h: 0.8, size: 36, bold: true, color: C.white, valign: 'middle' })
  s.text('Carlos Antônio de Oliveira Trévia · github.com/carlostrevia02/VizinhoHub', { x: MX + 0.2, y: 6.45, w: 11, h: 0.4, size: 16, color: C.greenLight })
  used[s.n] = ['(sem imagens)']
  s.notes('Para concluir: o VizinhoHub reúne as ofertas do bairro em um só lugar, entrega o pedido em tempo real ao lojista e garante, com testes no próprio banco, que uma oferta limitada nunca é vendida além da quantidade. Ele mostra que é possível dar ao pequeno varejo ferramentas profissionais sem a comissão de um marketplace. O código está no GitHub. Obrigado pela atenção, e fico à disposição para perguntas.')
}

// ---------- saída ----------
const out = path.join(ENTREGA, 'Slides-VizinhoHub-Final.pptx')
const problems = check(deck)
if (problems.length) { console.log('PROBLEMAS:\n' + problems.join('\n')) } else console.log('checagem de layout: ok')
if (process.argv.includes('--mirror')) fs.writeFileSync(path.join(__dirname, 'espelho.html'), mirrorHtml(deck))
fs.writeFileSync(path.join(__dirname, 'imagens-por-slide.json'), JSON.stringify(used, null, 1))
if (!problems.length || process.argv.includes('--force')) {
  pptx.writeFile({ fileName: out }).then(() => console.log('gerado', out, deck.slides.length, 'slides'))
}
