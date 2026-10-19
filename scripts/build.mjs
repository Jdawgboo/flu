// Builds dist/: the installable PWA (index.html + assets) and dist/artifact.html,
// a single-file copy with everything inlined for hosts that wrap the page themselves.
import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';

const root = new URL('../', import.meta.url);
const app = new URL('app/', root);
const dist = new URL('dist/', root);
const read = p => readFile(new URL(p, app), 'utf8');

const SCRIPTS = ['src/content.js', 'src/engine.js', 'src/grader.js', 'src/coach.js', 'src/studio.js', 'src/router.js', 'src/voice.js', 'src/llm.js', 'src/instagram.js', 'src/app.js'];
const ASSETS = ['index.html', 'styles.css', 'manifest.webmanifest', 'icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', ...SCRIPTS];

const config = yaml.load(await readFile(new URL('config/gamification.yaml', root), 'utf8'));
const appConfig = yaml.load(await readFile(new URL('config/app.yaml', root), 'utf8')) || {};
config.app = Object.assign({}, appConfig, {
  ig_api_base: String(appConfig.ig_api_base || '').replace(/\/+$/, ''),
  ai_api_base: String(appConfig.ai_api_base || '').replace(/\/+$/, '')
});
const baseConfigJs = `window.LI_CONFIG = ${JSON.stringify(config, null, 2)};\n`;

// Version the offline cache by the content it serves; the same hash is shown in Settings as the build.
const hash = createHash('sha256');
hash.update(baseConfigJs);
for (const f of ASSETS) hash.update(await readFile(new URL(f, app)));
const version = hash.digest('hex').slice(0, 10);
const configJs = baseConfigJs + `window.LI_BUILD = ${JSON.stringify(version)};\n`;

await rm(dist, { recursive: true, force: true });
await mkdir(new URL('src/', dist), { recursive: true });
await mkdir(new URL('icons/', dist), { recursive: true });
for (const f of ASSETS) await cp(new URL(f, app), new URL(f, dist));
await writeFile(new URL('config.js', dist), configJs);

await writeFile(new URL('sw.js', dist), (await read('sw.js')).replaceAll('__VERSION__', version));

// Single-file artifact: no doctype/html/head/body, no manifest, worker or icons.
const html = await read('index.html');
const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/)[0];
const markup = html.match(/<!-- app:markup -->([\s\S]*?)<!-- \/app:markup -->/)[1].trim();
const inline = code => code.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const scripts = [configJs, ...(await Promise.all(SCRIPTS.map(read)))];
const artifact = [
  '<title>LockIn</title>',
  '<meta name="claude:viewport-fit-sides" content="cover">',
  fonts,
  `<style>\n${(await read('styles.css')).replace(/<\/style/gi, '<\\/style')}\n</style>`,
  markup,
  ...scripts.map(s => `<script>\n${inline(s)}\n</script>`)
].join('\n') + '\n';
await writeFile(new URL('artifact.html', dist), artifact);

console.log(`built dist/ (cache lockin-${version}) and dist/artifact.html (${Math.round(artifact.length / 1024)} KB)`);
