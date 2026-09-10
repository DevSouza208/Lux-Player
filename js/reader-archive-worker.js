import { createExtractorFromData } from 'node-unrar-js/esm/index.esm.js';
import JSZip from 'jszip';
const MAX_BYTES = 512 * 1024 * 1024;
const MAX_PAGES = 2000;
const imageFile = name => /\.(jpe?g|png)$/i.test(name) && !name.split('/').some(part => part.startsWith('.')) && !name.startsWith('__MACOSX/');
self.onmessage = async ({ data }) => {
  try {
    let pages = [];
    let total = 0;
    const add = (name, bytes) => {
      total += bytes.byteLength;
      if (total > MAX_BYTES || pages.length >= MAX_PAGES || bytes.byteLength > 40 * 1024 * 1024) throw new Error('HQ muito grande. Limite: 2.000 páginas, 40 MB por imagem e 512 MB descompactados.');
      pages.push({ name, blob: new Blob([bytes], { type: /\.png$/i.test(name) ? 'image/png' : 'image/jpeg' }) });
    };
    if (data.format === 'cbr') {
      const wasmBinary = await (await fetch(new URL('unrar.wasm', self.location.href))).arrayBuffer();
      const extractor = await createExtractorFromData({ data: data.buffer, wasmBinary });
      const headers = [...extractor.getFileList().fileHeaders];
      if (headers.some(h => h.flags.encrypted)) throw new Error('Este CBR tem senha. Importe uma cópia sem senha.');
      if (headers.reduce((sum, h) => sum + h.unpSize, 0) > MAX_BYTES || headers.filter(h => imageFile(h.name)).length > MAX_PAGES) throw new Error('HQ excede o limite de 512 MB ou 2.000 páginas.');
      // Exhaust the iterator: unrar releases native memory after iteration finishes.
      for (const item of extractor.extract({ files: h => !h.flags.directory && imageFile(h.name) }).files) {
        if (item.extraction) add(item.fileHeader.name, item.extraction);
      }
    } else {
      const zip = await JSZip.loadAsync(data.buffer);
      const entries = Object.values(zip.files).filter(file => !file.dir && imageFile(file.name));
      if (entries.length > MAX_PAGES || entries.reduce((sum, file) => sum + (file._data?.uncompressedSize || 0), 0) > MAX_BYTES) throw new Error('HQ excede o limite de 512 MB ou 2.000 páginas.');
      for (const file of entries) add(file.name, await file.async('uint8array'));
    }
    if (!pages.length) throw new Error('Nenhuma página JPG ou PNG encontrada nesta HQ.');
    pages.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true, sensitivity: 'base' }));
    self.postMessage({ pages });
  } catch (error) { self.postMessage({ error: error.message || 'Não foi possível descompactar esta HQ.' }); }
};
