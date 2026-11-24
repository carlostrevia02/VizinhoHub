'use strict'
// Gera recortes legíveis de imagens muito altas (diagramas verticais e capturas de página inteira).
// Os arquivos originais não são alterados; as fatias vão para build/fatias/<nome>-<n>.png.
//  - FATIAS: divide em N partes, cortando perto da posição ideal na linha com menos pixels de conteúdo.
//  - CORTES: mantém só o topo (altura em px do arquivo) de uma captura longa.
const fs = require('fs')
const path = require('path')
const cfg = require('./config')
const { createCanvas, loadImage } = cfg.req('@napi-rs/canvas')

const FATIAS = {
  diagramas: { '01-casos-de-uso': 2, '13-atividades-cliente': 2, '14-atividades-lojista': 2, '15b-fluxo-dados-dfd-nivel1': 2 },
  capturas: { '21-analises': 2 },
}
const CORTES = { '01-home': 2100, '02-ofertas': 2300, '08-receitas': 2000 }

async function carregar(dir, nome) {
  const img = await loadImage(fs.readFileSync(path.join(dir, `${nome}.png`)))
  const c = createCanvas(img.width, img.height)
  const g = c.getContext('2d')
  g.drawImage(img, 0, 0)
  return { c, g, w: img.width, h: img.height }
}

function salvar(src, y0, y1, destino) {
  const h = y1 - y0
  const c = createCanvas(src.w, h)
  c.getContext('2d').drawImage(src.c, 0, y0, src.w, h, 0, 0, src.w, h)
  fs.writeFileSync(destino, c.toBuffer('image/png'))
}

// Linha com menos pixels diferentes do fundo, dentro de [lo, hi].
function melhorCorte(src, lo, hi) {
  const data = src.g.getImageData(0, 0, src.w, src.h).data
  const bg = [data[0], data[1], data[2]]
  let melhor = lo, menor = Infinity
  for (let y = lo; y < hi; y++) {
    let n = 0
    for (let x = 0; x < src.w; x++) {
      const i = (y * src.w + x) * 4
      if (Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 30) n++
    }
    if (n < menor) { menor = n; melhor = y }
  }
  return melhor
}

async function fatiar() {
  const out = path.join(cfg.BUILD, 'fatias')
  fs.mkdirSync(out, { recursive: true })
  const pron = {}
  for (const [tipo, mapa] of Object.entries(FATIAS)) {
    const dir = tipo === 'diagramas' ? cfg.DIAGRAMAS : cfg.CAPTURAS
    for (const [nome, n] of Object.entries(mapa)) {
      const src = await carregar(dir, nome)
      const cortes = [0]
      for (let i = 1; i < n; i++) {
        const ideal = Math.round((src.h * i) / n)
        const janela = Math.round(src.h / n * 0.18)
        cortes.push(melhorCorte(src, ideal - janela, ideal + janela))
      }
      cortes.push(src.h)
      for (let i = 0; i < n; i++) salvar(src, cortes[i], cortes[i + 1], path.join(out, `${nome}-${i + 1}.png`))
      pron[nome] = n
    }
  }
  for (const [nome, h] of Object.entries(CORTES)) {
    const src = await carregar(cfg.CAPTURAS, nome)
    salvar(src, 0, Math.min(h, src.h), path.join(out, `${nome}-topo.png`))
  }
  // Composição: três capturas mobile lado a lado numa só figura.
  const trio = ['12-mobile-home', '13-mobile-ofertas', '14-mobile-carrinho']
  const imgs = []
  for (const n of trio) imgs.push(await carregar(cfg.CAPTURAS, n))
  const gap = 60, W = imgs.reduce((a, i) => a + i.w, 0) + gap * (imgs.length - 1), H = Math.max(...imgs.map((i) => i.h))
  const c = createCanvas(W, H), g = c.getContext('2d')
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H)
  let x = 0
  for (const i of imgs) { g.drawImage(i.c, x, 0); g.strokeStyle = '#cfd8d0'; g.lineWidth = 3; g.strokeRect(x, 0, i.w, i.h); x += i.w + gap }
  fs.writeFileSync(path.join(out, 'mobile-trio.png'), c.toBuffer('image/png'))
  return pron
}

module.exports = { fatiar, FATIAS, CORTES }
if (require.main === module) fatiar().then((r) => console.log('fatias:', r)).catch((e) => { console.error(e); process.exit(1) })
