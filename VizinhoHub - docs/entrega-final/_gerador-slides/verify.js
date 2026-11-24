// Reabre o .pptx: conta slides, notas, imagens (e confere proporção) e valida se cada XML é bem formado.
const fs = require('fs'); const path = require('path')
const JSZip = require('jszip')
const file = path.resolve(__dirname, '..', 'Slides-VizinhoHub-Final.pptx')
;(async () => {
  const zip = await JSZip.loadAsync(fs.readFileSync(file))
  const names = Object.keys(zip.files)
  const slides = names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]))
  const notes = names.filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n))
  console.log('slides:', slides.length, '| notas:', notes.length)
  const { DOMParser } = (() => { try { return require('@xmldom/xmldom') } catch { return {} } })()
  let bad = 0
  for (const n of names.filter((x) => x.endsWith('.xml') || x.endsWith('.rels'))) {
    const x = await zip.file(n).async('string')
    if (DOMParser) {
      const errs = []
      new DOMParser({ onError: (l, m) => errs.push(m) }).parseFromString(x, 'text/xml')
      if (errs.length) { bad++; console.log('XML invalido', n, errs[0]) }
    } else if (!x.trim().startsWith('<?xml') && !x.trim().startsWith('<')) { bad++; console.log('XML suspeito', n) }
  }
  console.log('xml com erro:', bad, DOMParser ? '(xmldom)' : '(checagem simples)')
  const emuIn = 914400
  let slidesNoNote = []
  for (const s of slides) {
    const num = s.match(/\d+/)[0]
    const rels = await zip.file(`ppt/slides/_rels/slide${num}.xml.rels`).async('string')
    const hasNote = /notesSlide/.test(rels)
    const xml = await zip.file(s).async('string')
    let noteTxt = ''
    if (hasNote) {
      const nf = rels.match(/notesSlides\/(notesSlide\d+\.xml)/)[1]
      const nx = await zip.file('ppt/notesSlides/' + nf).async('string')
      noteTxt = (nx.match(/<a:t>[^<]*<\/a:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join(' ')
    }
    if (!hasNote || noteTxt.length < 40) slidesNoNote.push(num)
    const pics = [...xml.matchAll(/<p:pic>[\s\S]*?<\/p:pic>/g)].map((m) => m[0])
    const out = []
    for (const p of pics) {
      const rid = p.match(/r:embed="([^"]+)"/)[1]
      const tgt = rels.match(new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`)) || rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${rid}"`))
      const img = 'ppt/' + tgt[1].replace('../', '')
      const b = await zip.file(img).async('nodebuffer')
      const iw = b.readUInt32BE(16), ih = b.readUInt32BE(20)
      const ext = p.match(/<a:ext cx="(\d+)" cy="(\d+)"/)
      const off = p.match(/<a:off x="(-?\d+)" y="(-?\d+)"/)
      const cx = +ext[1], cy = +ext[2], ox = +off[1], oy = +off[2]
      const dist = Math.abs(cx / cy - iw / ih) / (iw / ih)
      const inside = ox >= 0 && oy >= 0 && ox + cx <= 13.333 * emuIn + 10 && oy + cy <= 7.5 * emuIn + 10
      out.push(`${path.basename(img)} ${iw}x${ih} -> ${(cx / emuIn).toFixed(2)}x${(cy / emuIn).toFixed(2)}in dist=${(dist * 100).toFixed(2)}% ${inside ? '' : 'FORA'}`)
      if (dist > 0.005 || !inside) console.log('PROBLEMA imagem slide', num, out[out.length - 1])
    }
    console.log(`slide ${num}: notas=${noteTxt.length} chars; imagens=${pics.length}`, out.join(' | '))
  }
  console.log('slides sem nota:', slidesNoNote.length ? slidesNoNote.join(',') : 'nenhum')
})()
