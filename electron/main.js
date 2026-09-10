const path = require('path');
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');

let mainWindow;
let updateReady = false;

// Mantém a janela principal e superfícies nativas do Chromium (como PiP)
// associadas ao mesmo aplicativo na barra de tarefas do Windows.
app.setAppUserModelId('com.devsouza208.luxplay');

function sendUpdateStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('lux:update-status', status);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'lux.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.maximize();
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.once('did-finish-load', checkForUpdates);
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const isFullscreenShortcut = input.key === 'F11' || (input.alt && input.key === 'Enter');
    if (isFullscreenShortcut) {
      event.preventDefault();
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    } else if (input.key === 'Escape' && mainWindow.isFullScreen()) {
      event.preventDefault();
      mainWindow.setFullScreen(false);
    }
  });
}

function checkForUpdates() {
  // Em desenvolvimento não existe app-update.yml nem Release para consultar.
  if (!app.isPackaged) return;
  autoUpdater.checkForUpdates().catch(error => console.warn('Não foi possível verificar atualizações:', error.message));
}

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.autoRunAppAfterInstall = true;

autoUpdater.on('checking-for-update', () => sendUpdateStatus({ state: 'checking' }));
autoUpdater.on('update-available', info => sendUpdateStatus({ state: 'downloading', version: info.version }));
autoUpdater.on('download-progress', progress => sendUpdateStatus({ state: 'downloading', percent: Math.round(progress.percent) }));
autoUpdater.on('update-downloaded', info => {
  updateReady = true;
  sendUpdateStatus({ state: 'ready', version: info.version });
});
autoUpdater.on('error', error => console.warn('Atualizador:', error.message));

ipcMain.handle('lux:install-update', () => {
  if (!updateReady) return false;
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return true;
});

ipcMain.handle('lux:reader-source', async (event, value) => {
  if (event.sender !== mainWindow?.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) return false;
  try {
    const url = new URL(value);
    const allowed=(url.origin==='https://pt.wiktionary.org'&&url.pathname.startsWith('/wiki/'))||(url.origin==='https://www.dicio.com.br'&&/^\/[a-z-]{1,80}\/$/.test(url.pathname));
    if (!allowed || url.username || url.password) return false;
    await shell.openExternal(url.href);
    return true;
  } catch { return false; }
});

ipcMain.handle('lux:download-vod', async (_event, { url, fileName }) => {
  if (!mainWindow || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    return { ok: false, message: 'Link de download inválido.' };
  }

  const safeFileName = String(fileName || 'lux-play-vod.mp4')
    .replace(/[\\/:*?"<>|]/g, '_')
    .slice(0, 180);

  mainWindow.webContents.session.once('will-download', async (_downloadEvent, item) => {
    item.pause();
    const saveResult = await dialog.showSaveDialog(mainWindow, {
      title: 'Salvar VOD',
      defaultPath: path.join(app.getPath('downloads'), safeFileName),
      buttonLabel: 'Salvar download'
    });

    if (saveResult.canceled || !saveResult.filePath) {
      item.cancel();
      return;
    }

    item.setSavePath(saveResult.filePath);
    item.resume();
  });

  try {
    mainWindow.webContents.downloadURL(url);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error.message || 'Não foi possível iniciar o download.' };
  }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
