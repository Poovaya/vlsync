import { app, BrowserWindow, ipcMain, dialog, protocol } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { state as pinger } from './pinger';
import { init as initMqtt, publish as mqttPublish } from './mqttSync';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIME_TYPES = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.webm': 'video/webm',
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      standard: true,
      secure: true,
      bypassCSP: true,
      allowServiceWorkers: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);

let win = null;

function createWindow() {
  win = new BrowserWindow({
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
    try {
      const url = new URL(request.url);
      const filePath = path.normalize(
        decodeURIComponent(url.pathname.slice(1)),
      );

      if (!fs.existsSync(filePath)) {
        return new Response('File not found', { status: 404 });
      }

      const ext = path.extname(filePath).toLowerCase();
      const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const range = request.headers.get('range');

      const headers = {
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes',
      };

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        if (start >= fileSize || end >= fileSize) {
          return new Response(null, { status: 416, headers });
        }

        const stream = fs.createReadStream(filePath, { start, end });
        return new Response(stream, {
          status: 206,
          headers: {
            ...headers,
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Content-Length': String(end - start + 1),
          },
        });
      }

      const stream = fs.createReadStream(filePath);
      return new Response(stream, {
        status: 200,
        headers: { ...headers, 'Content-Length': String(fileSize) },
      });
    } catch (error) {
      return new Response('Internal Server Error: ' + error.message, {
        status: 500,
      });
    }
  });

  initMqtt(
    (data) => win?.webContents.send('remote-action', data),
    (status) => win?.webContents.send('mqtt-status', status),
  );

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

  // cmd: 'play' | 'pause' | 'seek', mediaTimeMs: number
  ipcMain.handle('sync-action', (_event, cmd, mediaTimeMs) => {
    const action = cmd === 'play' ? true : cmd === 'pause' ? false : null;
    mqttPublish(action, mediaTimeMs, pinger.ping ?? 0);
  });

  ipcMain.handle('get-ping', () => pinger.ping);

  createWindow();
});
