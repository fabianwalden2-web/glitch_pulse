const { app, BrowserWindow, ipcMain, dialog, Menu, session, desktopCapturer } = require('electron');
const fs = require('fs');
const path = require('path');

// --- Maximum Hardware & GPU Performance Command-Line Switches ---
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-native-gpu-memory-buffers');
app.commandLine.appendSwitch('enable-accelerated-mjpeg-decode');
app.commandLine.appendSwitch('enable-accelerated-video-decode');
app.commandLine.appendSwitch('enable-hardware-overlays', 'single-fullscreen,single-on-top,underlay');
app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder,CanvasOopRasterization,UseSkiaRenderer,MediaFoundationVideoEncoding,WebGPU');
app.commandLine.appendSwitch('max-active-webgl-contexts', '32');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false, // Enable local media file loading without CORS restrictions
      backgroundThrottling: false, // Prevent frame drops when window is blurred
    },
    title: 'Glitch Pulse',
    backgroundColor: '#050505',
    autoHideMenuBar: false
  });

  // Setup Application Menu
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Project',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            mainWindow.webContents.send('menu:new');
          }
        },
        {
          label: 'Open Project...',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            mainWindow.webContents.send('menu:open');
          }
        },
        {
          label: 'Save Project',
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            mainWindow.webContents.send('menu:save');
          }
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    const indexPath = path.join(__dirname, '../dist/index.html');
    mainWindow.loadFile(indexPath).catch(err => {
      console.error("Error loading index.html:", err);
    });
  }

  // Handle render crashes or loading failures
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load app:', errorCode, errorDescription);
  });
}

app.whenReady().then(() => {
  // Allow getDisplayMedia() from the renderer (used to capture YouTube / browser
  // audio for music reactivity). Grant the primary screen video + system-audio
  // loopback automatically so non-technical users get one-click capture.
  try {
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
        callback({ video: sources[0], audio: 'loopback' });
      }).catch(() => callback({}));
    }, { useSystemPicker: false });
  } catch (e) {
    console.warn('setDisplayMediaRequestHandler unavailable:', e && e.message);
  }

  createWindow();

  // IPC Handlers for Save/Load Project
  ipcMain.handle('dialog:saveProject', async (event, projectData) => {
    const { filePath } = await dialog.showSaveDialog({
      title: 'Save Glitch Pulse Project',
      defaultPath: 'project.glitch',
      filters: [{ name: 'Glitch Pulse Project', extensions: ['glitch', 'json'] }]
    });
    if (filePath) {
      fs.writeFileSync(filePath, projectData, 'utf-8');
      return filePath;
    }
    return null;
  });

  ipcMain.handle('dialog:openProject', async (event) => {
    const { filePaths } = await dialog.showOpenDialog({
      title: 'Open Glitch Pulse Project',
      properties: ['openFile'],
      filters: [{ name: 'Glitch Pulse Project', extensions: ['glitch', 'json'] }]
    });
    if (filePaths && filePaths.length > 0) {
      const data = fs.readFileSync(filePaths[0], 'utf-8');
      return { data, filePath: filePaths[0] };
    }
    return null;
  });

  ipcMain.handle('fs:checkExists', async (event, absolutePath) => {
    return fs.existsSync(absolutePath);
  });

  const autoSavePath = path.join(app.getPath('userData'), 'autosave.json');

  ipcMain.handle('fs:saveAutoSave', async (event, data) => {
    try {
      fs.writeFileSync(autoSavePath, data, 'utf-8');
      return true;
    } catch (e) {
      console.error('AutoSave Error:', e);
      return false;
    }
  });

  ipcMain.handle('fs:loadAutoSave', async () => {
    try {
      if (fs.existsSync(autoSavePath)) {
        return fs.readFileSync(autoSavePath, 'utf-8');
      }
    } catch (e) {
      console.error('Load AutoSave Error:', e);
    }
    return null;
  });



  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
