const puppeteer = require('puppeteer');
const fs = require('fs');

// We will read generatives.ts and extract the uuids using a regex
const genContent = fs.readFileSync('src/lib/generatives.ts', 'utf8');
const uuids = [...genContent.matchAll(/"uuid":\s*"([^"]+)"/g)].map(m => m[1]);
console.log('Found UUIDs:', uuids);

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  await page.setViewport({ width: 800, height: 400 });

  for (const uuid of uuids) {
    console.log(`Capturing ${uuid}...`);
    try {
      await page.goto(`http://127.0.0.1:3000/?gen=${uuid}`, { waitUntil: 'load', timeout: 5000 });
    } catch (e) {
      console.log('Goto error (ignored):', e.message);
    }
    
    try {
      // Brutalist Grid and some others take a second to compile shaders
      await new Promise(r => setTimeout(r, 4000)); 
      await page.screenshot({ path: `public/previews/${uuid}.png` });
      console.log(`Saved ${uuid}.png`);
    } catch(e) {
      console.log('Screenshot error:', e.message);
    }
  }

  await browser.close();
  console.log('All screenshots captured!');
})();
