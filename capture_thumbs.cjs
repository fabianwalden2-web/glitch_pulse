const puppeteer = require('puppeteer');
const fs = require('fs');

const genContent = fs.readFileSync('src/lib/generatives.ts', 'utf8');
const uuids = [...genContent.matchAll(/"uuid":\s*"([^"]+)"/g)].map(m => m[1]);
console.log('Found UUIDs:', uuids);

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  await page.setViewport({ width: 800, height: 800, deviceScaleFactor: 1 });

  // Initial warmup navigation
  try {
    await page.goto('http://127.0.0.1:3000', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await new Promise(r => setTimeout(r, 2000));
  } catch (e) {
    console.log('Warmup note:', e.message);
  }

  for (const uuid of uuids) {
    console.log(`Capturing ${uuid}...`);
    try {
      await page.goto(`http://127.0.0.1:3000/?gen=${uuid}`, { waitUntil: 'domcontentloaded', timeout: 12000 });
    } catch (e) {
      console.log('Goto error (ignored):', e.message);
    }
    
    try {
      // Wait for WebGL shader compilation and canvas rendering
      await new Promise(r => setTimeout(r, 4500));
      
      const canvasElement = await page.$('canvas');
      if (canvasElement) {
        await canvasElement.screenshot({ path: `public/previews/${uuid}.png` });
      } else {
        await page.screenshot({ path: `public/previews/${uuid}.png` });
      }
      console.log(`Saved square thumbnail: ${uuid}.png`);
    } catch(e) {
      console.log('Screenshot error:', e.message);
    }
  }

  await browser.close();
  console.log('All square screenshots captured!');
})();
