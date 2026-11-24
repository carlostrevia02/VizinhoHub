const puppeteer = require('puppeteer'); const JSZip = require('jszip'); const fs = require('fs'); const path = require('path')
;(async () => {
  const zip = await JSZip.loadAsync(fs.readFileSync(path.resolve(__dirname, '..', 'Slides-VizinhoHub-Final.pptx')))
  const items = []
  for (const n of Object.keys(zip.files)) if (/\.(xml|rels)$/.test(n)) items.push([n, await zip.file(n).async('string')])
  const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
  const p = await b.newPage()
  const bad = await p.evaluate((items) => items.filter(([n, x]) => new DOMParser().parseFromString(x, 'application/xml').getElementsByTagName('parsererror').length).map((i) => i[0]), items)
  console.log('arquivos XML:', items.length, '| mal formados:', bad.length, bad.join(','))
  await b.close()
})()
