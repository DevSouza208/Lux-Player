import { readingAuth, readingHeaders, readingJson } from '../_shared/reading-auth.ts';

const DRIVE_FOLDER = 'application/vnd.google-apps.folder';
const DEFAULT_PAGE_SIZE = 200;
const MAX_PAGE_SIZE = 500;
const MAX_FOLDERS_PER_CALL = 40;
const MAX_ITEMS_PER_CALL = 4000;

function folderId(value: unknown) {
  const text = String(value || '').trim();
  return text.match(/\/folders\/([a-zA-Z0-9_-]+)/)?.[1] || (/^[a-zA-Z0-9_-]{10,}$/.test(text) ? text : '');
}
function safeText(value: unknown, max = 1000) { return String(value || '').trim().slice(0, max); }
function extension(name: string) { const m = name.toLowerCase().match(/\.([a-z0-9]{1,10})$/); return m?.[1] || ''; }
function kind(name: string, mime = '') {
  if (mime === DRIVE_FOLDER) return 'folder';
  const ext = extension(name);
  if (['cbr','cbz','zip','rar','7z'].includes(ext)) return 'comic';
  if (['pdf','epub','mobi','azw','azw3','djvu'].includes(ext)) return 'book';
  if (['jpg','jpeg','png','webp','avif','gif','bmp'].includes(ext)) return 'image';
  if (['mp4','mkv','webm','mov','m4v'].includes(ext)) return 'video';
  if (['mp3','m4a','aac','ogg','flac','wav'].includes(ext)) return 'audio';
  return 'file';
}
function encodeQuery(value: string) { return encodeURIComponent(value).replace(/%27/g, "'"); }

async function driveList(parentId: string, pageToken: string, pageSize: number, signal: AbortSignal) {
  const key = Deno.env.get('GOOGLE_DRIVE_API_KEY');
  if (!key) throw { status: 503, message: 'Configure GOOGLE_DRIVE_API_KEY no Supabase para ativar o scanner.' };
  const q = `'${parentId.replace(/'/g, "\\'")}' in parents and trashed = false`;
  const fields = 'nextPageToken,files(id,name,mimeType,size,modifiedTime,createdTime,md5Checksum,webViewLink,thumbnailLink,iconLink)';
  const params = [`q=${encodeQuery(q)}`, `fields=${encodeURIComponent(fields)}`, `pageSize=${pageSize}`, 'supportsAllDrives=true', 'includeItemsFromAllDrives=true', `key=${encodeURIComponent(key)}`];
  if (pageToken) params.push(`pageToken=${encodeURIComponent(pageToken)}`);
  const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params.join('&')}`, { signal });
  let data: any = null; try { data = await response.json(); } catch (_) {}
  if (!response.ok) {
    const reason = safeText(data?.error?.message || `Google Drive respondeu ${response.status}.`, 500);
    if (response.status === 403 || response.status === 404) throw { status: 400, message: `A pasta não pôde ser lida. Confirme que está pública e que a Drive API está habilitada. ${reason}` };
    throw { status: 502, message: `Falha ao consultar Google Drive. ${reason}` };
  }
  return { files: Array.isArray(data?.files) ? data.files : [], nextPageToken: safeText(data?.nextPageToken, 500) };
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: readingHeaders });
  if (request.method !== 'POST') return readingJson({ error: 'Método não permitido.' }, 405);
  try {
    let body: any; try { body = await request.json(); } catch { return readingJson({ error: 'JSON inválido.' }, 400); }
    await readingAuth(body, true);
    const rootId = folderId(body.folderUrl || body.folderId);
    if (!rootId) return readingJson({ error: 'Pasta do Google Drive inválida.' }, 400);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(25, Number(body.pageSize) || DEFAULT_PAGE_SIZE));
    const supplied = Array.isArray(body.queue) ? body.queue : [];
    const queue: any[] = supplied.length ? supplied.slice(0, 10000) : [{ id: rootId, path: '', pageToken: '' }];
    const items: any[] = [];
    let foldersProcessed = 0;

    while (queue.length && foldersProcessed < MAX_FOLDERS_PER_CALL && items.length < MAX_ITEMS_PER_CALL) {
      const current = queue.shift();
      const id = safeText(current?.id, 200);
      const parentPath = safeText(current?.path, 2000);
      const token = safeText(current?.pageToken, 500);
      if (!id) continue;
      const page = await driveList(id, token, pageSize, request.signal);
      foldersProcessed += 1;
      for (const raw of page.files) {
        const name = safeText(raw?.name, 500);
        const mimeType = safeText(raw?.mimeType, 200);
        const isFolder = mimeType === DRIVE_FOLDER;
        const path = [parentPath, name].filter(Boolean).join('/');
        const item = {
          externalId: safeText(raw?.id, 200), name, path, parentPath,
          type: kind(name, mimeType), mimeType,
          extension: isFolder ? '' : extension(name),
          size: Number(raw?.size || 0) || 0,
          modifiedAt: safeText(raw?.modifiedTime, 100) || null,
          createdAt: safeText(raw?.createdTime, 100) || null,
          checksum: safeText(raw?.md5Checksum, 100) || null,
          webViewLink: safeText(raw?.webViewLink, 2048),
          thumbnailLink: safeText(raw?.thumbnailLink, 2048),
          sourceProvider: 'google-drive'
        };
        items.push(item);
        if (isFolder && item.externalId) queue.push({ id: item.externalId, path, pageToken: '' });
      }
      if (page.nextPageToken) queue.unshift({ id, path: parentPath, pageToken: page.nextPageToken });
    }

    return readingJson({
      rootId, items, queue,
      done: queue.length === 0,
      stats: { items: items.length, foldersProcessed, pendingFolders: queue.length },
      cursorVersion: 1
    });
  } catch (error: any) {
    console.error('[LUX-DRIVE-SCAN]', error);
    return readingJson({ error: error?.status ? error.message : 'Não foi possível varrer a pasta do Google Drive.' }, error?.status || 500);
  }
});
