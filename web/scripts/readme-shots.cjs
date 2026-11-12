// Captures the README images from a running server (default http://localhost:8787) into docs/readme/.
//   node web/scripts/readme-shots.cjs [baseUrl]
// Needs Playwright (preinstalled in dev containers), Pillow (python3) for WebP, and ffmpeg for the GIF.
const { chromium, devices } = require('playwright');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const BASE = (process.argv[2] || 'http://localhost:8787').replace(/\/$/, '');
const OUT = path.resolve(__dirname, '../../docs/readme');
const TMP = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bsw-shots-'));
fs.mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function webp(src, name, width) {
  execFileSync('python3', ['-c', `
from PIL import Image
im = Image.open(${JSON.stringify(src)}).convert('RGB')
w = ${width}
if im.width > w: im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
im.save(${JSON.stringify(path.join(OUT, name))}, 'WEBP', quality=86, method=6)
`]);
}

(async () => {
  const b = await chromium.launch({ args: ARGS });
  const desk = async (url, opts = {}) => {
    const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2, ...opts });
    const p = await ctx.newPage(); await p.goto(BASE + url); return p;
  };

  // 1 · landing
  let p = await desk('/?hold');
  await wait(3500); await p.screenshot({ path: `${TMP}/hero.png` }); webp(`${TMP}/hero.png`, 'hero.webp', 1800);

  // 2 · swoop GIF: record real-time video (frame-by-frame screenshots are too slow to catch the swoop)
  const vdir = path.join(TMP, 'vid');
  const ctxG = await b.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: vdir, size: { width: 1280, height: 800 } } });
  const g = await ctxG.newPage(); await g.goto(BASE + '/?notour'); await wait(3200);
  await g.keyboard.press('Enter'); await wait(3800); await ctxG.close();
  const webm = path.join(vdir, fs.readdirSync(vdir).find((f) => f.endsWith('.webm')));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '1.6', '-t', '5.4', '-i', webm, '-vf',
    'fps=12,scale=760:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=112:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle', path.join(OUT, 'intro.gif')]);

  // 3 · dashboard overview, Gulf of Finland, world
  p = await desk('/?nohero&notour');
  await wait(9000); await p.screenshot({ path: `${TMP}/dash.png` }); webp(`${TMP}/dash.png`, 'dashboard.webp', 1800);
  await (await p.$('button.tab[data-r="GULF OF FINLAND"]')).click(); await wait(2500);
  await p.screenshot({ path: `${TMP}/gulf.png` }); webp(`${TMP}/gulf.png`, 'gulf-of-finland.webp', 1400);
  // 4 · alert dossier + "what you shouldn't conclude"
  const al = await p.$('.alert'); if (al) { await al.click(); await wait(2500); }
  await p.screenshot({ path: `${TMP}/dossier.png` }); webp(`${TMP}/dossier.png`, 'alert-dossier.webp', 1400);
  await p.keyboard.press('Escape'); await wait(400);
  await (await p.$('button.tab[data-r="WORLD"]')).click(); await wait(2500);
  await p.screenshot({ path: `${TMP}/world.png` }); webp(`${TMP}/world.png`, 'world.webp', 1400);
  // 5 · daily brief overlay (only if a real brief.json is served)
  const brief = await p.$('text=/DAILY BRIEF/i');
  if (brief) { await brief.click(); await wait(1500); await p.screenshot({ path: `${TMP}/brief.png` }); webp(`${TMP}/brief.png`, 'daily-brief.webp', 1400); }

  // 6 · how it works
  p = await desk('/how.html'); await wait(3000);
  await p.screenshot({ path: `${TMP}/how.png` }); webp(`${TMP}/how.png`, 'how-it-works.webp', 1400);

  // 7 · mobile pair
  const m = await (await b.newContext({ ...devices['iPhone 14'] })).newPage();
  await m.goto(BASE + '/?hold'); await wait(3000); await m.screenshot({ path: `${TMP}/m1.png` });
  await m.goto(BASE + '/?nohero&notour'); await wait(8000); await m.screenshot({ path: `${TMP}/m2.png` });
  execFileSync('python3', ['-c', `
from PIL import Image
a, b = Image.open(${JSON.stringify(TMP + '/m1.png')}).convert('RGB'), Image.open(${JSON.stringify(TMP + '/m2.png')}).convert('RGB')
h = 1400; a = a.resize((round(a.width*h/a.height), h)); b = b.resize((round(b.width*h/b.height), h))
gap = 48; c = Image.new('RGB', (a.width + b.width + gap*3, h + gap*2), (5, 9, 12))
c.paste(a, (gap, gap)); c.paste(b, (a.width + gap*2, gap)); c.save(${JSON.stringify(OUT + '/mobile.webp')}, 'WEBP', quality=86, method=6)
`]);

  await b.close();
  for (const f of fs.readdirSync(OUT)) console.log(f.padEnd(24), (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0) + ' KB');
})();
