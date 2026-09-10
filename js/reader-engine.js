import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import ePub from 'epubjs';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import JSZip from 'jszip';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.mjs', import.meta.url).href;
export { pdfjs, ePub };
// Read metadata without rendering or running any content from the publication.
export async function epubLanguage(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  async function xml(name) {
    const entry = zip.file(name);
    if (!entry || entry._data?.uncompressedSize > 1024 * 1024) return null;
    const text = await entry.async('string');
    if (text.length > 1024 * 1024) return null;
    return new DOMParser().parseFromString(text, 'application/xml');
  }
  const container = await xml('META-INF/container.xml');
  const path = container?.getElementsByTagNameNS('*', 'rootfile')[0]?.getAttribute('full-path');
  if (!path) return '';
  const opf = await xml(path);
  return opf?.getElementsByTagNameNS('*', 'language')[0]?.textContent?.trim().slice(0, 10) || '';
}
export function renderMarkdown(text) {
  const html=DOMPurify.sanitize(marked.parse(String(text||''),{breaks:true,gfm:true}),{
    ALLOWED_TAGS:['p','h1','h2','h3','strong','em','del','ul','ol','li','blockquote','code','pre','br','hr','a'],ALLOWED_ATTR:['href','title']
  });
  const colored=html.replace(/\[cor=(#[a-fA-F0-9]{6})\]([\s\S]*?)\[\/cor\]/g,'<span style="color:$1">$2</span>');
  const doc=new DOMParser().parseFromString(colored,'text/html');
  for(const anchor of doc.querySelectorAll('a')){anchor.removeAttribute('href');anchor.removeAttribute('target');}
  return doc.body.innerHTML;
}
export const pdfAssets = {
  cMapUrl: new URL('./cmaps/', import.meta.url).href, cMapPacked: true,
  standardFontDataUrl: new URL('./standard_fonts/', import.meta.url).href,
  wasmUrl: new URL('./wasm/', import.meta.url).href, isEvalSupported: false
};
export function sanitizeChapter(html) {
  const clean = DOMPurify.sanitize(html, { WHOLE_DOCUMENT: true, ADD_TAGS: ['link'], ADD_ATTR: ['xmlns'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'base', 'meta'],
    ALLOW_UNKNOWN_PROTOCOLS: false });
  const doc = new DOMParser().parseFromString(clean, 'text/html');
  const policy = doc.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = "default-src 'none'; img-src blob: data:; style-src 'unsafe-inline' blob: data:; font-src blob: data:; media-src blob: data:; base-uri 'none'; form-action 'none'";
  doc.head.prepend(policy);
  return '<!DOCTYPE html>' + doc.documentElement.outerHTML;
}
