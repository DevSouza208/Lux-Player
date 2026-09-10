const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'js/vendor');
fs.mkdirSync(out, { recursive: true });
async function build() {
  await esbuild.build({ entryPoints: [path.join(root, 'js/reader-engine.js')], bundle: true,
    format: 'esm', platform: 'browser', target: 'chrome138', outfile: path.join(out, 'reader-engine.mjs'), minify: true,
    legalComments: 'linked' });
  await esbuild.build({ entryPoints: [path.join(root, 'js/reader-archive-worker.js')], bundle: true,
    format: 'iife', platform: 'browser', target: 'chrome138', outfile: path.join(out, 'reader-archive-worker.js'), minify: true,
    legalComments: 'linked' });
  const pdf = path.dirname(require.resolve('pdfjs-dist/package.json'));
  await esbuild.build({ entryPoints: [path.join(root, 'js/reading-import-worker.js')], bundle: true,
    format: 'iife', platform: 'browser', target: 'chrome138', outfile: path.join(out, 'reading-import-worker.js'), minify: true,
    legalComments: 'linked' });
  fs.copyFileSync(path.join(pdf, 'legacy/build/pdf.worker.mjs'), path.join(out, 'pdf.worker.mjs'));
  for (const folder of ['cmaps', 'standard_fonts', 'wasm']) fs.cpSync(path.join(pdf, folder), path.join(out, folder), { recursive: true });
  fs.copyFileSync(require.resolve('node-unrar-js/esm/js/unrar.wasm'), path.join(out, 'unrar.wasm'));
  for (const name of ['pdfjs-dist', 'epubjs', 'jszip', 'node-unrar-js', 'dompurify', 'marked']) {
    const dir = path.join(root, 'node_modules', name);
    const license = fs.readdirSync(dir).find(file => /^licen[sc]e(?:\.|$)/i.test(file));
    if (license) fs.copyFileSync(path.join(dir, license), path.join(out, name + '-LICENSE.txt'));
  }
  console.log('Leitor: bibliotecas e workers locais preparados.');
}
build().catch(error => { console.error(error); process.exitCode = 1; });
