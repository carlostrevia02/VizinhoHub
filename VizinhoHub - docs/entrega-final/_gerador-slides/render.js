// Renderiza espelho.html em PNGs (prev/slide-N.png). Uso: node render.js
const puppeteer = require('puppeteer'); const path = require('path'); const fs = require('fs')
;(async () => {
  const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--allow-file-access-from-files'] })
  const p = await b.newPage(); await p.setViewport({ width: 1280, height: 720 })
  await p.goto('file:///' + path.join(__dirname, 'espelho.html').split(String.fromCharCode(92)).join('/'))
  await new Promise((r) => setTimeout(r, 1500))
  fs.mkdirSync(path.join(__dirname, 'prev'), { recursive: true })
  const n = await p.$$eval('section.sl', (a) => a.length)
  const only = process.argv.slice(2).map(Number)
  for (let i = 1; i <= n; i++) {
    if (only.length && !only.includes(i)) continue
    const el = await p.$('#s' + i)
    await el.screenshot({ path: path.join(__dirname, 'prev', `slide-${i}.png`) })
  }
  await b.close()
})()
