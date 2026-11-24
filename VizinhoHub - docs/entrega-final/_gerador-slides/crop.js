// Recorta regioes de capturas muito altas (uso: node crop.js entrada.png saida.png x y w h)
const puppeteer = require('puppeteer');
const fs = require('fs'); const path = require('path');
const [,, inp, out, x, y, w, h] = process.argv;
(async () => {
  const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--allow-file-access-from-files'] });
  const p = await b.newPage();
  const data = fs.readFileSync(inp).toString('base64');
  const res = await p.evaluate(async (data, x, y, w, h) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + data; await img.decode();
    const c = document.createElement('canvas'); c.width = +w; c.height = +h;
    c.getContext('2d').drawImage(img, +x, +y, +w, +h, 0, 0, +w, +h);
    return c.toDataURL('image/png').split(',')[1];
  }, data, x, y, w, h);
  fs.writeFileSync(out, Buffer.from(res, 'base64'));
  await b.close();
})();
