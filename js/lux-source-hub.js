(() => {
  'use strict';

  const VERSION = '20260915-drive-hq2';
  const DEFAULT_HQ_SOURCE = {
    id: 'hq-drive-marvel', name: 'HQs • Google Drive', provider: 'google-drive', kind: 'comics',
    url: 'https://drive.google.com/drive/folders/1zjVQ0K6mWgXcZSTV8gNi-jxY0x2KWjGN', enabled: true, recursive: true,
    formats: ['cbr','cbz','pdf','epub','zip','rar','jpg','jpeg','png','webp','avif']
  };
  const state = { sources: [DEFAULT_HQ_SOURCE], lastScan: null };

  function extractDriveFolderId(value = '') {
    const text = String(value).trim();
    const match = text.match(/\/folders\/([a-zA-Z0-9_-]+)/) || text.match(/^([a-zA-Z0-9_-]{10,})$/);
    return match ? match[1] : '';
  }
  function classify(name = '', mimeType = '') {
    const ext = String(name).split('.').pop().toLowerCase();
    if (mimeType === 'application/vnd.google-apps.folder') return 'folder';
    if (['cbr','cbz','zip','rar','7z'].includes(ext)) return 'comic';
    if (['pdf','epub','mobi','azw','azw3','djvu'].includes(ext)) return 'book';
    if (['jpg','jpeg','png','webp','avif','gif','bmp'].includes(ext)) return 'image';
    if (['mp4','mkv','webm','mov','m4v'].includes(ext)) return 'video';
    if (['mp3','m4a','aac','ogg','flac','wav'].includes(ext)) return 'audio';
    return 'file';
  }
  function normalizeDriveItem(item, parentPath = '') {
    const name = String(item?.name || item?.title || '').trim();
    const folder = item?.mimeType === 'application/vnd.google-apps.folder' || item?.mime_type === 'application/vnd.google-apps.folder' || item?.file_or_folder === 'folder';
    const path = item?.path || [parentPath, name].filter(Boolean).join('/');
    return { sourceProvider:'google-drive', externalId:item?.externalId || item?.id || '', name, path,
      parentPath:item?.parentPath ?? parentPath, type:folder?'folder':(item?.type || classify(name,item?.mimeType||item?.mime_type||'')),
      mimeType:item?.mimeType||item?.mime_type||'', extension:item?.extension||'', size:Number(item?.size||0)||0,
      modifiedAt:item?.modifiedAt||item?.modifiedTime||item?.modified_time||null, checksum:item?.checksum||item?.md5Checksum||null,
      url:item?.webViewLink||item?.url||'', thumbnailLink:item?.thumbnailLink||'', downloadable:item?.can_download!==false,
      children:folder?[]:undefined };
  }
  async function cloudRequest(payload) {
    if (window.LuxReaderCloud?.request) return window.LuxReaderCloud.request('drive-source-scan', payload);
    throw new Error('Conexão segura com o Lux indisponível. Entre novamente e tente de novo.');
  }
  async function scanDriveSource({ folderUrl, onProgress, signal, pageSize = 300, maxCalls = 500 }) {
    const rootId = extractDriveFolderId(folderUrl);
    if (!rootId) throw new Error('Pasta do Google Drive inválida.');
    let queue = [], all = [], calls = 0, done = false;
    const totals = { items:0, folders:0, comics:0, books:0, images:0, videos:0, audio:0, files:0 };
    while (!done) {
      if (signal?.aborted) throw new DOMException('Scan cancelado','AbortError');
      if (++calls > maxCalls) throw new Error('A pasta é grande demais para uma única sincronização.');
      const data = await cloudRequest({ folderUrl, queue, pageSize });
      const batch = (data.items || []).map(item => normalizeDriveItem(item, item.parentPath || ''));
      all.push(...batch); queue = Array.isArray(data.queue) ? data.queue : []; done = data.done === true;
      for (const item of batch) { totals.items++; if (item.type === 'folder') totals.folders++; else if (item.type === 'comic') totals.comics++; else if (item.type === 'book') totals.books++; else if (item.type === 'image') totals.images++; else if (item.type === 'video') totals.videos++; else if (item.type === 'audio') totals.audio++; else totals.files++; }
      onProgress?.({ ...totals, calls, pendingFolders:queue.length, done });
    }
    state.lastScan = { rootId, folderUrl, items:all, stats:{...totals}, scannedAt:Date.now() };
    try { sessionStorage.setItem('lux.drive.lastScan', JSON.stringify({rootId,folderUrl,stats:totals,scannedAt:state.lastScan.scannedAt})); } catch {}
    window.dispatchEvent(new CustomEvent('lux-source-scan-complete',{detail:state.lastScan}));
    return state.lastScan;
  }
  window.LuxSourceHub = { version:VERSION, state, extractDriveFolderId, classify, normalizeDriveItem,
    scanDriveSource, getLastScan:()=>state.lastScan, getSources:()=>state.sources.map(source=>({...source})) };
})();
