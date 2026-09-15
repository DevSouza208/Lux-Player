(() => {
  'use strict';

  const VERSION = '20260915-drive-hq1';
  const DEFAULT_HQ_SOURCE = {
    id: 'hq-drive-marvel',
    name: 'HQs • Google Drive',
    provider: 'google-drive',
    kind: 'comics',
    url: 'https://drive.google.com/drive/folders/1zjVQ0K6mWgXcZSTV8gNi-jxY0x2KWjGN',
    enabled: true,
    recursive: true,
    formats: ['cbr','cbz','pdf','epub','zip','rar','jpg','jpeg','png','webp','avif']
  };

  const state = { sources: [DEFAULT_HQ_SOURCE] };

  function extractDriveFolderId(value = '') {
    const text = String(value).trim();
    const match = text.match(/\/folders\/([a-zA-Z0-9_-]+)/) || text.match(/^([a-zA-Z0-9_-]{10,})$/);
    return match ? match[1] : '';
  }

  function classify(name = '', mimeType = '') {
    const ext = String(name).split('.').pop().toLowerCase();
    if (mimeType === 'application/vnd.google-apps.folder') return 'folder';
    if (['cbr','cbz','zip','rar'].includes(ext)) return 'comic';
    if (['pdf','epub','mobi','azw','azw3'].includes(ext)) return 'book';
    if (['jpg','jpeg','png','webp','avif','gif'].includes(ext)) return 'image';
    if (['mp4','mkv','webm','mov','m4v'].includes(ext)) return 'video';
    if (['mp3','m4a','aac','ogg','flac','wav'].includes(ext)) return 'audio';
    return 'file';
  }

  function normalizeDriveItem(item, parentPath = '') {
    const name = String(item?.name || item?.title || '').trim();
    const folder = item?.mimeType === 'application/vnd.google-apps.folder' || item?.mime_type === 'application/vnd.google-apps.folder' || item?.file_or_folder === 'folder';
    const path = [parentPath, name].filter(Boolean).join('/');
    return {
      sourceProvider: 'google-drive',
      externalId: item?.id || '',
      name,
      path,
      parentPath,
      type: folder ? 'folder' : classify(name, item?.mimeType || item?.mime_type || ''),
      mimeType: item?.mimeType || item?.mime_type || '',
      size: Number(item?.size || 0) || 0,
      modifiedAt: item?.modifiedTime || item?.modified_time || null,
      url: item?.webViewLink || item?.url || '',
      downloadable: item?.can_download !== false,
      children: folder ? [] : undefined
    };
  }

  // Adapter contract. A server/Edge Function supplies listChildren so API credentials
  // never need to live in the browser. The walk is iterative to tolerate deep trees.
  async function scanDriveTree({ folderUrl, listChildren, onProgress, signal, maxItems = 100000 }) {
    const rootId = extractDriveFolderId(folderUrl);
    if (!rootId) throw new Error('Pasta do Google Drive inválida.');
    if (typeof listChildren !== 'function') throw new Error('Adaptador Google Drive ainda não está conectado ao backend.');

    const root = { sourceProvider: 'google-drive', externalId: rootId, name: 'HQs', path: '', type: 'folder', children: [] };
    const queue = [{ id: rootId, node: root, path: '' }];
    let scanned = 0;

    while (queue.length) {
      if (signal?.aborted) throw new DOMException('Scan cancelado', 'AbortError');
      const current = queue.shift();
      const children = await listChildren(current.id, signal);
      for (const raw of children || []) {
        if (++scanned > maxItems) throw new Error(`Limite de segurança atingido (${maxItems} itens).`);
        const item = normalizeDriveItem(raw, current.path);
        current.node.children.push(item);
        if (item.type === 'folder') queue.push({ id: item.externalId, node: item, path: item.path });
      }
      onProgress?.({ scanned, pendingFolders: queue.length, currentPath: current.path });
    }
    return root;
  }

  window.LuxSourceHub = {
    version: VERSION,
    state,
    extractDriveFolderId,
    classify,
    normalizeDriveItem,
    scanDriveTree,
    getSources: () => state.sources.map(source => ({ ...source }))
  };
})();
