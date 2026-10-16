const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { createDataStore } = require('./lib/dataStore');
const { createWindowStateKeeper } = require('./lib/windowState');
const { fetchLatestRelease, isNewer } = require('./lib/updateCheck');

app.setName('YMB 発注くん');

const UPDATE_REPO = 'yumebi/ymb_hacchu';
const RELEASES_URL = `https://github.com/${UPDATE_REPO}/releases/latest`;

const DATA_FILE = path.join(app.getPath('userData'), 'data.json');

// 保存は原子的(一時ファイル + rename)。直前の正常なファイルは .bak に、その日の最初の保存の前の
// 状態は backups/ に残す。壊れたファイルを読んだときは、空データで上書きせず、退避して復元する。
// (以前は、読み込みに失敗すると空データを返し、次の保存で全件を失う恐れがあった)
const dataStore = createDataStore(DATA_FILE);

// 壊れたデータを復元したときは、黙って進めず利用者に知らせる(同じ内容を何度も出さない)。
const shownRecoveryKinds = new Set();
function notifyRecovery(recovery) {
  if (!recovery || shownRecoveryKinds.has(recovery.kind)) return;
  shownRecoveryKinds.add(recovery.kind);

  const messages = {
    restoredBackup: {
      message: 'データファイルが壊れていたため、バックアップから復元しました。',
      detail: `壊れたファイルは、次の場所に退避してあります。\n${recovery.corruptPath}\n\n復元に使ったバックアップ:\n${recovery.from}\n\n直前の保存より少し前の状態に戻っている可能性があります。`,
    },
    empty: {
      message: 'データファイルが壊れていて、使えるバックアップも見つかりませんでした。空の状態で起動します。',
      detail: `壊れたファイルは、次の場所に退避してあります(削除しないでください)。\n${recovery.corruptPath}\n\nこのファイルがあれば、内容を取り出せる可能性があります。`,
    },
    restoredMissing: {
      message: 'データファイルが見つからなかったため、バックアップから復元しました。',
      detail: `復元に使ったバックアップ:\n${recovery.from}`,
    },
  };
  const m = messages[recovery.kind];
  if (!m) return;

  const options = { type: 'warning', title: 'YMB 発注くん', message: m.message, detail: m.detail, buttons: ['OK'] };
  const args = mainWindow && !mainWindow.isDestroyed() ? [mainWindow, options] : [options];
  dialog.showMessageBox(...args).catch(() => {});
}

function loadData() {
  const { data, recovery } = dataStore.load();
  notifyRecovery(recovery);
  return data;
}

function saveData(data) {
  dataStore.save(data);
}

// 送信元が自アプリのメインウィンドウ(メインフレーム)かどうかを検証する。
function isTrustedSender(event) {
  const win = BrowserWindow.fromWebContents(event.sender);
  return !!win && win === mainWindow && event.senderFrame === win.webContents.mainFrame;
}

// ---- レンダラーから渡されるデータのサニタイズ(型・サイズ・文字列化) ----
const crypto = require('crypto');
const MAX_ARRAY_LENGTH = 5000;
function sanitizeText(value, max) {
  return String(value ?? '').slice(0, max);
}
function sanitizeSender(s) {
  if (typeof s !== 'object' || s === null) return null;
  return { name: sanitizeText(s.name, 200), zip: sanitizeText(s.zip, 50), addr: sanitizeText(s.addr, 500) };
}
function sanitizeClient(c) {
  if (typeof c !== 'object' || c === null) return null;
  return { name: sanitizeText(c.name, 200), zip: sanitizeText(c.zip, 50), addr: sanitizeText(c.addr, 500), suffix: sanitizeText(c.suffix, 20) };
}
function sanitizeItem(it) {
  if (typeof it !== 'object' || it === null) return null;
  return {
    name: sanitizeText(it.name, 200),
    qty: sanitizeText(it.qty, 20),
    unit: sanitizeText(it.unit, 20),
    price: sanitizeText(it.price, 20),
    amount: sanitizeText(it.amount, 20)
  };
}
function sanitizeItems(arr) {
  return Array.isArray(arr) ? arr.map(sanitizeItem).filter(Boolean).slice(0, MAX_ARRAY_LENGTH) : [];
}
function sanitizeTemplate(t) {
  if (typeof t !== 'object' || t === null) return null;
  return {
    id: sanitizeText(t.id, 100) || crypto.randomUUID(),
    name: sanitizeText(t.name, 200),
    clientZip: sanitizeText(t.clientZip, 50),
    clientAddr: sanitizeText(t.clientAddr, 500),
    clientName: sanitizeText(t.clientName, 200),
    clientSuffix: sanitizeText(t.clientSuffix, 20),
    remarks: sanitizeText(t.remarks, 2000),
    items: sanitizeItems(t.items)
  };
}
function sanitizeOrder(o) {
  if (typeof o !== 'object' || o === null) return null;
  return {
    id: sanitizeText(o.id, 100) || crypto.randomUUID(),
    no: sanitizeText(o.no, 50),
    date: sanitizeText(o.date, 20),
    senderName: sanitizeText(o.senderName, 200),
    senderZip: sanitizeText(o.senderZip, 50),
    senderAddr: sanitizeText(o.senderAddr, 500),
    clientName: sanitizeText(o.clientName, 200),
    clientZip: sanitizeText(o.clientZip, 50),
    clientAddr: sanitizeText(o.clientAddr, 500),
    clientSuffix: sanitizeText(o.clientSuffix, 20),
    remarks: sanitizeText(o.remarks, 2000),
    items: sanitizeItems(o.items),
    subtotal: Number.isFinite(o.subtotal) ? o.subtotal : 0,
    tax: Number.isFinite(o.tax) ? o.tax : 0,
    total: Number.isFinite(o.total) ? o.total : 0
  };
}
function sanitizeList(arr, fn) {
  if (!Array.isArray(arr)) throw new Error('データ形式が不正です');
  return arr.map(fn).filter(Boolean).slice(0, MAX_ARRAY_LENGTH);
}

let mainWindow;

const MIN_WIDTH = 900;
const MIN_HEIGHT = 600;

// 位置・大きさ・最大化の状態を保存して、次回の起動で復元する。
// モニタ構成が変わっていて画面外になる場合は、画面内に補正される。
const windowState = createWindowStateKeeper({
  file: path.join(app.getPath('userData'), 'window-state.json'),
  defaultWidth: 1200,
  defaultHeight: 900,
  minWidth: MIN_WIDTH,
  minHeight: MIN_HEIGHT,
  screen,
});

function createWindow() {
  const state = windowState.load();
  mainWindow = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    // 描画が整うまで表示しない(表示した瞬間に、白い空のウインドウが見えるのを防ぐ)。
    show: false,
    backgroundColor: '#f5f6f8',
    title: 'YMB 発注くん',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  mainWindow.setMenuBarVisibility(false);
  // レンダラーからのウィンドウ生成・外部サイトへの遷移を無効化(IPC面の露呈を防ぐ)
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  windowState.manage(mainWindow);
  mainWindow.once('ready-to-show', () => {
    // 最大化で終了していた場合は、表示する前に最大化する(通常サイズが一瞬見えるのを防ぐ)。
    if (state.isMaximized) mainWindow.maximize();
    mainWindow.show();
  });
}

// 二重起動を防ぐ。2つ開くと、それぞれが data.json を丸ごと保存するため、後から保存した方の内容で
// 先の変更が失われる。2つ目を起動したら、すでに開いているウインドウを前面に出す。
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('data:get', (event) => {
  if (!isTrustedSender(event)) return { senders: [], clients: [], templates: [], orders: [], lastNo: 1 };
  return loadData();
});

ipcMain.handle('data:setSenders', (event, senders) => {
  if (!isTrustedSender(event)) throw new Error('不正な送信元からの呼び出しです');
  const data = loadData();
  data.senders = sanitizeList(senders, sanitizeSender);
  saveData(data);
  return data.senders;
});

ipcMain.handle('data:setClients', (event, clients) => {
  if (!isTrustedSender(event)) throw new Error('不正な送信元からの呼び出しです');
  const data = loadData();
  data.clients = sanitizeList(clients, sanitizeClient);
  saveData(data);
  return data.clients;
});

ipcMain.handle('data:setTemplates', (event, templates) => {
  if (!isTrustedSender(event)) throw new Error('不正な送信元からの呼び出しです');
  const data = loadData();
  data.templates = sanitizeList(templates, sanitizeTemplate);
  saveData(data);
  return data.templates;
});

ipcMain.handle('data:saveOrder', (event, order) => {
  if (!isTrustedSender(event)) throw new Error('不正な送信元からの呼び出しです');
  const safe = sanitizeOrder(order);
  if (!safe) throw new Error('発注データの形式が不正です');
  const data = loadData();
  const idx = data.orders.findIndex(o => o.id === safe.id);
  const now = new Date().toISOString();
  if (idx >= 0) {
    safe.createdAt = data.orders[idx].createdAt;
    safe.updatedAt = now;
    data.orders[idx] = safe;
  } else {
    safe.createdAt = now;
    safe.updatedAt = now;
    data.orders.push(safe);
  }
  const noNum = parseInt(safe.no, 10);
  if (!isNaN(noNum) && noNum >= data.lastNo) {
    data.lastNo = noNum + 1;
  }
  saveData(data);
  return { orders: data.orders, lastNo: data.lastNo };
});

ipcMain.handle('data:deleteOrder', (event, id) => {
  if (!isTrustedSender(event)) throw new Error('不正な送信元からの呼び出しです');
  const data = loadData();
  data.orders = data.orders.filter(o => o.id !== String(id ?? ''));
  saveData(data);
  return data.orders;
});

ipcMain.handle('app:getVersion', (event) => {
  if (!isTrustedSender(event)) return '0.0.0';
  return app.getVersion();
});

ipcMain.handle('update:check', async (event) => {
  if (!isTrustedSender(event)) return { hasUpdate: false };
  // 公開済みのリリースを見る(version.json だと、リリースに失敗しても先に更新されて、存在しない版を案内してしまう)。
  // 取れない・版番号として読めない場合は「更新なし」。
  const release = await fetchLatestRelease(UPDATE_REPO);
  if (release && isNewer(release.version, app.getVersion())) {
    return { hasUpdate: true, latest: release.version, url: release.url || RELEASES_URL };
  }
  return { hasUpdate: false };
});

// 更新ページのURL検証: 自リポジトリのURLだけを開く。
// 単純な startsWith では「https://github.com/yumebi/ymb_hacchu.evil.com」のような
// 偽装ホストも通ってしまうため、URLをパースしてホスト名とパスを厳密に検証する。
function isAllowedUpdateUrl(url) {
  if (typeof url !== 'string') return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.hostname !== 'github.com') return false;
  return parsed.pathname === '/yumebi/ymb_hacchu' ||
    parsed.pathname.startsWith('/yumebi/ymb_hacchu/');
}

ipcMain.handle('update:openUrl', (event, url) => {
  if (!isTrustedSender(event)) return;
  if (isAllowedUpdateUrl(url)) {
    shell.openExternal(url);
  }
});

ipcMain.handle('pdf:export', async (event, suggestedName) => {
  if (!isTrustedSender(event)) return { ok: false };
  // レンダラー指定のファイル名はパス/拡張子を強制し、ダイアログの初期位置の改竄を防ぐ
  let name = typeof suggestedName === 'string' ? path.basename(suggestedName) : '';
  name = name.replace(/\.pdf$/i, '');
  name = name.replace(/[/\\?%*:|"<>\x00-\x1f]/g, '_');
  if (!name) name = '発注書';
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'PDFとして保存',
    defaultPath: `${name}.pdf`,
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
