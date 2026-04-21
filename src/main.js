const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  protocol,
  net,
} = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: { secure: true, standard: true, stream: true },
  },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL('http://localhost:5173');
}

app.whenReady().then(() => {
  protocol.handle('media', (request) => {
    const url = new URL(request.url);
    const rawPath = decodeURIComponent(url.pathname.slice(1));
    return net.fetch(pathToFileURL(rawPath).toString(), {
      headers: Object.fromEntries(request.headers),
    });
  });

  ipcMain.handle('open-file', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Videos', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm'] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  createWindow();
});
