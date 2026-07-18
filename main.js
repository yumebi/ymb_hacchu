const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

app.setName('YMB 発注くん');

const VERSION_JSON_URL = 'https://raw.githubusercontent.com/yumebi/ymb_hacchu/master/version.json';

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

const DATA_FILE = path.join(app.getPath('userData'), 'data.json');

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const data = JSON.parse(raw);
    return {
      senders: data.senders || [],
      clients: data.clients || [],
      orders: data.orders || [],
      lastNo: data.lastNo || 1
    };
  } catch (e) {
    return { senders: [], clients: [], orders: [], lastNo: 1 };
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    title: 'YMB 発注くん',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('data:get', () => {
  return loadData();
});

ipcMain.handle('data:setSenders', (event, senders) => {
  const data = loadData();
  data.senders = senders;
  saveData(data);
  return data.senders;
});

ipcMain.handle('data:setClients', (event, clients) => {
  const data = loadData();
  data.clients = clients;
  saveData(data);
  return data.clients;
});

ipcMain.handle('data:saveOrder', (event, order) => {
  const data = loadData();
  const idx = data.orders.findIndex(o => o.id === order.id);
  const now = new Date().toISOString();
  if (idx >= 0) {
    order.createdAt = data.orders[idx].createdAt;
    order.updatedAt = now;
    data.orders[idx] = order;
  } else {
    order.createdAt = now;
    order.updatedAt = now;
    data.orders.push(order);
  }
  const noNum = parseInt(order.no, 10);
  if (!isNaN(noNum) && noNum >= data.lastNo) {
    data.lastNo = noNum + 1;
  }
  saveData(data);
  return { orders: data.orders, lastNo: data.lastNo };
});

ipcMain.handle('data:deleteOrder', (event, id) => {
  const data = loadData();
  data.orders = data.orders.filter(o => o.id !== id);
  saveData(data);
  return data.orders;
});

ipcMain.handle('app:getVersion', () => {
  return app.getVersion();
});

ipcMain.handle('update:check', async () => {
  try {
    const res = await fetch(VERSION_JSON_URL, { cache: 'no-store' });
    if (!res.ok) return { hasUpdate: false };
    const remote = await res.json();
    const current = app.getVersion();
    if (remote.version && compareVersions(remote.version, current) > 0) {
      return { hasUpdate: true, latest: remote.version, url: remote.url };
    }
    return { hasUpdate: false };
  } catch (e) {
    return { hasUpdate: false };
  }
});

ipcMain.handle('update:openUrl', (event, url) => {
  if (typeof url === 'string' && url.startsWith('https://github.com/yumebi/ymb_hacchu')) {
    shell.openExternal(url);
  }
});

ipcMain.handle('pdf:export', async (event, suggestedName) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'PDFとして保存',
    defaultPath: suggestedName || '発注書.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (canceled || !filePath) return { ok: false };
  const pdfBuffer = await win.webContents.printToPDF({
    printBackground: true,
    pageSize: 'A4',
    margins: { marginType: 'none' }
  });
  fs.writeFileSync(filePath, pdfBuffer);
  return { ok: true, path: filePath };
});
