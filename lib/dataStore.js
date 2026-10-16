'use strict';

const fs = require('fs');
const path = require('path');
const { atomicWriteFileSync } = require('./atomicWrite');

const emptyData = () => ({ senders: [], clients: [], templates: [], orders: [], lastNo: 1 });

function normalize(data) {
  return {
    senders: data.senders || [],
    clients: data.clients || [],
    templates: data.templates || [],
    orders: data.orders || [],
    lastNo: data.lastNo || 1,
  };
}

/** JSON として読めて、オブジェクトであること(配列や null は壊れているとみなす)。 */
function parseDataText(text) {
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('データがオブジェクトではありません');
  }
  return normalize(data);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function dayKey(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function stampOf(date) {
  return `${dayKey(date)}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/**
 * 発注データ(data.json)の読み書き。
 *
 * 守るもの
 * - 保存は原子的(一時ファイル + rename)。書き込み中に落ちても、元のファイルは壊れない
 * - 保存のたびに、直前の正常なファイルを .bak に残す。さらに、その日の最初の保存の前の状態を
 *   backups/ に日次で残す(古いものは dailyKeep 件まで)
 * - 壊れたファイルを読み込んだときは、黙って空データにせず、壊れたファイルを退避してから
 *   .bak(次に日次バックアップ)から復元する。退避したファイルは上書き・削除しない
 *
 * 以前は、読み込みに失敗すると空データを返し、次の保存で壊れたファイルを空データで上書きしていた
 * (全件が失われる)。
 */
function createDataStore(file, options = {}) {
  const now = options.now || (() => new Date());
  const dailyKeep = options.dailyKeep ?? 14;
  const backupFile = `${file}.bak`;
  const dailyDir = path.join(path.dirname(file), 'backups');

  function tryRead(target) {
    let text;
    try {
      text = fs.readFileSync(target, 'utf-8');
    } catch (error) {
      return { ok: false, missing: error.code === 'ENOENT', error };
    }
    try {
      return { ok: true, data: parseDataText(text), text };
    } catch (error) {
      return { ok: false, missing: false, error };
    }
  }

  function dailyFiles() {
    try {
      return fs.readdirSync(dailyDir)
        .filter((name) => /^data-\d{8}\.json$/.test(name))
        .sort();   // 日付順(昇順)
    } catch {
      return [];
    }
  }

  function latestUsableDaily() {
    for (const name of dailyFiles().reverse()) {
      const result = tryRead(path.join(dailyDir, name));
      if (result.ok) return { ...result, path: path.join(dailyDir, name) };
    }
    return null;
  }

  /** 壊れたファイルを、上書きされない名前に移す。移せなければコピーして残す。 */
  function quarantine() {
    const dest = `${file}.corrupt-${stampOf(now())}`;
    try {
      fs.renameSync(file, dest);
    } catch {
      fs.copyFileSync(file, dest);
    }
    return dest;
  }

  function load() {
    const main = tryRead(file);
    if (main.ok) return { data: main.data, recovery: null };

    if (main.missing) {
      // 初回起動。または、ファイルだけが消えている場合の救済として、バックアップから戻す。
      const backup = tryRead(backupFile);
      if (backup.ok) {
        atomicWriteFileSync(file, backup.text);
        return { data: backup.data, recovery: { kind: 'restoredMissing', from: backupFile } };
      }
      return { data: emptyData(), recovery: null };
    }

    // 壊れている。まず退避して、証拠を残す。
    const corruptPath = quarantine();

    const backup = tryRead(backupFile);
    if (backup.ok) {
      atomicWriteFileSync(file, backup.text);
      return { data: backup.data, recovery: { kind: 'restoredBackup', corruptPath, from: backupFile } };
    }
    const daily = latestUsableDaily();
    if (daily) {
      atomicWriteFileSync(file, daily.text);
      return { data: daily.data, recovery: { kind: 'restoredBackup', corruptPath, from: daily.path } };
    }
    return { data: emptyData(), recovery: { kind: 'empty', corruptPath } };
  }

  /** 保存の前に、直前の正常なファイルをバックアップする。失敗しても保存自体は止めない。 */
  function backupBeforeSave() {
    const current = tryRead(file);
    if (!current.ok) return;   // 壊れているものでバックアップを上書きしない

    try {
      atomicWriteFileSync(backupFile, current.text);
    } catch (error) {
      console.warn('[dataStore] .bak の更新に失敗:', error.message);
    }

    try {
      const daily = path.join(dailyDir, `data-${dayKey(now())}.json`);
      if (!fs.existsSync(daily)) {
        atomicWriteFileSync(daily, current.text);
        for (const name of dailyFiles().slice(0, Math.max(0, dailyFiles().length - dailyKeep))) {
          fs.unlinkSync(path.join(dailyDir, name));
        }
      }
    } catch (error) {
      console.warn('[dataStore] 日次バックアップに失敗:', error.message);
    }
  }

  function save(data) {
    backupBeforeSave();
    atomicWriteFileSync(file, JSON.stringify(data, null, 2));
  }

  return { load, save, file, backupFile, dailyDir };
}

module.exports = { createDataStore, parseDataText, emptyData };
