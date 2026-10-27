// Assembles a single self-contained HTML file from src/.
//   node build.js   -> dist/index.html (full page, for GitHub Pages or any web host)
const fs = require('fs'); const r = (p) => fs.readFileSync(__dirname + '/src/' + p, 'utf8');
// JSON data is inlined in <script>; escape '</' so text inside data can't end the tag early
const rj = (p) => r(p).replace(/<\//g, '<\\/');
const head = `<title>Vermont School District Builder</title>
<meta name="description" content="Group Vermont's towns into school districts and compare size, tax capacity, child poverty and distance with today's supervisory unions.">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Public+Sans:wght@400;600;700&display=swap">
<style>${r('app.css')}</style>`;
const scripts = `<script>window.DATA=${rj('data.json')};window.GENERATED=${rj('generated.json')};</script>
<script>${r('engine.js')}</script>
<script>${r('app.js')}</script>`;
fs.mkdirSync(__dirname + '/dist', { recursive: true });
fs.writeFileSync(__dirname + '/dist/index.html', `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🏔️</text></svg>">
<style>:root{box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}html{scroll-padding-top:env(safe-area-inset-top,0px)}body{margin:0}[hidden]{display:none!important}</style>
${head}</head><body>
${r('body.html')}
${scripts}
</body></html>
`);
console.log('built', (fs.statSync(__dirname + '/dist/index.html').size / 1024).toFixed(0), 'KB');
