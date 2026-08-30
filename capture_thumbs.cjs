const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const genContent = fs.readFileSync('src/lib/generatives.ts', 'utf8');
const uuids = [...genContent.matchAll(/"uuid":\s*"([^"]+)"/g)].map(m => m[1]);
const uniqueUuids = Array.from(new Set(uuids));
console.log(`Found ${uniqueUuids.length} unique Generatives:`, uniqueUuids);

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  
  await page.setViewport({ width: 1440, height: 950 });

  page.on('console', msg => {
    if (msg.type() === 'error') console.log('BROWSER LOG ERROR:', msg.text());
  });
  page.on('pageerror', err => console.log('BROWSER PAGE ERROR:', err.message));

  for (const uuid of uniqueUuids) {
    console.log(`[Preview Generator] Processing ${uuid}...`);
    try {
      await page.goto(`http://127.0.0.1:3000/?gen=${uuid}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    } catch (e) {
      console.log(`Goto note for ${uuid}:`, e.message);
    }
    
    try {
      // Wait for shaders and canvas animation
      await new Promise(r => setTimeout(r, 3000));
      
      const outPath = path.join(__dirname, 'public', 'previews', `${uuid}.png`);
      
      // Wait for canvas element to appear
      await page.waitForSelector('#main-render-canvas', { timeout: 5000 });
      const canvasHandle = await page.$('#main-render-canvas');
      
      if (canvasHandle) {
        await canvasHandle.screenshot({ path: outPath });
        const stat = fs.statSync(outPath);
        console.log(`✓ Saved canvas element screenshot: ${uuid}.png (${stat.size} bytes)`);
      } else {
        await page.screenshot({ path: outPath });
        console.log(`! Fallback screenshot: ${uuid}.png`);
      }
    } catch(e) {
      console.log(`Screenshot error for ${uuid}:`, e.message);
    }
  }

  await browser.close();
  console.log('All generative preview screenshots have been updated successfully!');
})();
