'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createDataStore } = require('../lib/dataStore');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hacchu-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function sample(n) {
  return {
    senders: [{ name: `送信元${n}` }],
    clients: [],
    templates: [],
    orders: Array.from({ length: n }, (_, i) => ({ id: `o${i}` })),
    lastNo: n + 1,
  };
}

const fixedDate = (y, m, d) => () => new Date(y, m - 1, d, 9, 30, 0);

test('保存して読み込める', (t) => {
  const store = createDataStore(path.join(tempDir(t), 'data.json'));
  store.save(sample(3));
  const { data, recovery } = store.load();
  assert.equal(recovery, null);
  assert.deepEqual(data, sample(3));
});

test('ファイルが無ければ空データ(復元の通知は出ない)', (t) => {
  const store = createDataStore(path.join(tempDir(t), 'data.json'));
  const { data, recovery } = store.load();
  assert.equal(recovery, null);
  assert.deepEqual(data, { senders: [], clients: [], templates: [], orders: [], lastNo: 1 });
});

test('足りない項目は既定値で補う', (t) => {
  const file = path.join(tempDir(t), 'data.json');
  fs.writeFileSync(file, JSON.stringify({ orders: [{ id: 'x' }] }));
  const { data } = createDataStore(file).load();
  assert.deepEqual(data.senders, []);
  assert.equal(data.lastNo, 1);
  assert.equal(data.orders.length, 1);
});

test('保存のたびに、直前の正常なファイルが .bak に残る', (t) => {
  const file = path.join(tempDir(t), 'data.json');
  const store = createDataStore(file);
  store.save(sample(1));
  store.save(sample(2));
  assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.bak`, 'utf-8')), sample(1));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf-8')), sample(2));
});

test('壊れたファイルは退避し、.bak から復元する(空データで上書きしない)', (t) => {
  const file = path.join(tempDir(t), 'data.json');
  const store = createDataStore(file, { now: fixedDate(2026, 10, 14) });
  store.save(sample(1));
  store.save(sample(5));                       // .bak は sample(1)
  const truncated = '{"senders":[{"name":"途中で切れ';   // 書き込み中に落ちた状態
  fs.writeFileSync(file, truncated);

  const { data, recovery } = store.load();

  assert.equal(recovery.kind, 'restoredBackup');
  assert.deepEqual(data, sample(1));
  assert.equal(fs.readFileSync(recovery.corruptPath, 'utf-8'), truncated, '壊れたファイルはそのまま退避される');
  assert.ok(path.basename(recovery.corruptPath).startsWith('data.json.corrupt-20261014-093000'));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf-8')), sample(1), '本来のファイルは正常な内容に戻る');
});

test('壊れていて .bak も無ければ、空データで起動するが、壊れたファイルは残る', (t) => {
  const file = path.join(tempDir(t), 'data.json');
  fs.writeFileSync(file, 'ゴミ');
  const { data, recovery } = createDataStore(file).load();

  assert.equal(recovery.kind, 'empty');
  assert.equal(data.orders.length, 0);
  assert.equal(fs.readFileSync(recovery.corruptPath, 'utf-8'), 'ゴミ');
});

test('配列や null のJSONも壊れているとみなす', (t) => {
  for (const text of ['[]', 'null', '123', '"x"']) {
    const file = path.join(tempDir(t), 'data.json');
    fs.writeFileSync(file, text);
    const { recovery } = createDataStore(file).load();
    assert.equal(recovery.kind, 'empty', text);
  }
});

test('壊れた状態で保存しても、.bak を壊れたもので上書きしない', (t) => {
  const file = path.join(tempDir(t), 'data.json');
  const store = createDataStore(file);
  store.save(sample(1));
  store.save(sample(2));                       // .bak = sample(1)
  fs.writeFileSync(file, '{壊れ');
  store.save(sample(9));                       // 壊れたファイルは .bak にしない
  assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.bak`, 'utf-8')), sample(1));
});

test('ファイルだけが消えた場合は .bak から戻す', (t) => {
  const file = path.join(tempDir(t), 'data.json');
  const store = createDataStore(file);
  store.save(sample(1));
  store.save(sample(2));
  fs.unlinkSync(file);

  const { data, recovery } = store.load();
  assert.equal(recovery.kind, 'restoredMissing');
  assert.deepEqual(data, sample(1));
});

test('.bak も壊れていれば、日次バックアップから復元する', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'data.json');
  const store = createDataStore(file, { now: fixedDate(2026, 10, 14) });
  store.save(sample(1));
  store.save(sample(2));       // 日次バックアップ(14日)= sample(1) の状態
  fs.writeFileSync(`${file}.bak`, '壊れ');
  fs.writeFileSync(file, '壊れ');

  const { data, recovery } = store.load();
  assert.equal(recovery.kind, 'restoredBackup');
  assert.deepEqual(data, sample(1));
  assert.ok(recovery.from.includes('backups'));
});

test('日次バックアップは、その日の最初の保存の前の状態を 1 日 1 つだけ残す', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'data.json');
  let day = 14;
  const store = createDataStore(file, { now: () => new Date(2026, 9, day, 9, 0, 0) });

  store.save(sample(1));                       // まだ元のファイルが無い → 日次なし
  store.save(sample(2));                       // 14日の最初の保存(直前 = sample(1))
  store.save(sample(3));                       // 同じ日の2回目 → 追加しない
  const files = fs.readdirSync(path.join(dir, 'backups'));
  assert.deepEqual(files, ['data-20261014.json']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'backups', files[0]), 'utf-8')), sample(1));

  day = 15;
  store.save(sample(4));
  assert.deepEqual(fs.readdirSync(path.join(dir, 'backups')).sort(), ['data-20261014.json', 'data-20261015.json']);
});

test('日次バックアップは古いものから消えて、指定の件数に収まる', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'data.json');
  let day = 1;
  const store = createDataStore(file, { dailyKeep: 3, now: () => new Date(2026, 9, day, 9, 0, 0) });
  for (day = 1; day <= 8; day++) store.save(sample(day));

  const files = fs.readdirSync(path.join(dir, 'backups')).sort();
  assert.equal(files.length, 3);
  assert.equal(files[2], 'data-20261008.json');
});

test('保存に失敗しても、元のファイルは壊れず、一時ファイルも残らない', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'data.json');
  const store = createDataStore(file);
  store.save(sample(2));

  t.mock.method(fs, 'renameSync', () => {
    throw Object.assign(new Error('disk error'), { code: 'EIO' });
  });
  assert.throws(() => store.save(sample(99)), /disk error/);
  t.mock.restoreAll();

  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf-8')), sample(2), '元のデータが残っている');
  const leftovers = fs.readdirSync(dir).filter((n) => n.endsWith('.tmp'));
  assert.deepEqual(leftovers, [], '一時ファイルが残っていない');
});
