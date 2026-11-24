'use strict'
const fs = require('fs')
const path = require('path')
const cfg = require('./config')
const imageSize = cfg.req('image-size').imageSize

// 'fatias' = recortes gerados por fatiar.js (diagramas verticais e capturas longas), em build/fatias.
const dirDe = (b) => (b.dir === 'capturas' ? cfg.CAPTURAS : b.dir === 'fatias' ? path.join(cfg.BUILD, 'fatias') : cfg.DIAGRAMAS)
const caminho = (b) => path.join(dirDe(b), `${b.file}.png`)
const existe = (b) => fs.existsSync(caminho(b))

// Tamanho (px a 96 dpi) com que a figura entra na página: cabe na área útil, sem ampliar além de 1x do arquivo.
function medida(b, emPaisagem) {
  const buf = fs.readFileSync(caminho(b))
  const s = imageSize(buf)
  const maxW = (emPaisagem ? cfg.AREA.lw : cfg.AREA.pw) * (b.w || 1)
  const maxH = b.maxH || (emPaisagem ? cfg.AREA.lh - 90 : cfg.AREA.ph - 190)
  const k = Math.min(maxW / s.width, maxH / s.height, b.noUpscale === false ? Infinity : 1)
  // Diagramas e capturas são gerados em 2x: permitir exibir até 100% do tamanho do arquivo é suficiente para a página.
  return { w: Math.round(s.width * k), h: Math.round(s.height * k), nw: s.width, nh: s.height, buf }
}

module.exports = { caminho, existe, medida }
