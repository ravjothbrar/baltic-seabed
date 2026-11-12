// Renders web/public/og.png (1200×630 link preview) and web/public/apple-touch-icon.png from the live flat map.
// Needs the app running (default http://localhost:8787). Usage: node scripts/build-og.cjs [baseUrl]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.argv[2] || 'http://localhost:8787';
const PUB = path.join(__dirname, '..', 'public');

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

  // 1) a clean render of the flat map, fitted to the Baltic
  const p = await b.newPage({ viewport: { width: 1500, height: 1050 }, deviceScaleFactor: 2 });
  await p.goto(`${BASE}/?nohero&notour`);
  await p.waitForTimeout(9000);
  await p.addStyleTag({ content: '.hud,.hint,.legend,.mapctl,.brk,.ring,#focus-bar,.tip{display:none!important}' });
  await p.waitForTimeout(400);
  const map = await (await p.$('#flat')).screenshot({ type: 'png' });
  await p.close();

  // 2) compose the card
  const card = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  const fav = fs.readFileSync(path.join(PUB, 'favicon.svg'), 'utf8');
  await card.setContent(`<!doctype html><html><head><style>
    html,body{margin:0;width:1200px;height:630px;background:#060b0f;overflow:hidden}
    .map{position:absolute;right:-40px;top:-30px;width:900px;height:690px;background:url(data:image/png;base64,${map.toString('base64')}) center/cover}
    .fade{position:absolute;inset:0;background:linear-gradient(90deg,#060b0f 0%,#060b0f 34%,rgba(6,11,15,.82) 52%,rgba(6,11,15,.1) 78%,rgba(6,11,15,0) 100%)}
    .t{position:absolute;left:64px;top:78px;width:560px;font-family:Inter,sans-serif;color:#eef3f5}
    .mk{width:56px;height:56px}
    .k{font-family:'JetBrains Mono',monospace;font-size:17px;letter-spacing:.24em;margin-top:30px;color:#eef3f5}
    .k b{color:#53f0c9;font-weight:500}
    h1{font-weight:300;font-size:58px;line-height:1.04;letter-spacing:-.03em;margin:22px 0 0}
    p{font-family:'JetBrains Mono',monospace;font-size:15.5px;color:#9fb3bb;letter-spacing:.02em;margin:26px 0 0;white-space:nowrap}
    .live{position:absolute;left:64px;bottom:56px;font-family:'JetBrains Mono',monospace;font-size:15px;letter-spacing:.14em;color:#53f0c9}
    .live i{display:inline-block;width:9px;height:9px;border-radius:50%;background:#53f0c9;box-shadow:0 0 10px #53f0c9;margin-right:10px}
    .by{position:absolute;right:48px;bottom:52px;font-family:Inter,sans-serif;font-size:16px;color:#fff;background:rgba(6,11,15,.75);padding:8px 12px;border:1px solid rgba(169,139,255,.55)}
  </style></head><body>
    <div class="map"></div><div class="fade"></div>
    <div class="t"><div class="mk">${fav.replace('<svg ', '<svg width="56" height="56" ')}</div>
      <div class="k">BALTIC <b>SEABED</b> WATCH</div>
      <h1>Live watch over Baltic undersea cables.</h1>
      <p>Ships · sanctions lists · seabed lines · public data</p></div>
    <div class="live"><i></i>LIVE · OPEN SOURCE</div>
    <div class="by">Made by Ravjoth Brar · ravjothbrar.com</div>
  </body></html>`);
  await card.waitForTimeout(300);
  await card.screenshot({ path: path.join(PUB, 'og.png') });
  await card.close();

  // 3) apple-touch-icon (180×180)
  const ic = await b.newPage({ viewport: { width: 180, height: 180 } });
  await ic.setContent(`<html><body style="margin:0;background:#060b0f">${fav.replace('<svg ', '<svg width="180" height="180" ')}</body></html>`);
  await ic.screenshot({ path: path.join(PUB, 'apple-touch-icon.png') });
  await b.close();
  console.log('wrote public/og.png and public/apple-touch-icon.png');
})();
