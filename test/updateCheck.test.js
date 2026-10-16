'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseVersion, isNewer, isAllowedReleaseUrl, fetchLatestRelease } = require('../lib/updateCheck');

const REPO = 'yumebi/example';

test('parseVersion: v の有無・桁数を許し、版番号でなければ null', () => {
  assert.deepEqual(parseVersion('1.3.5'), [1, 3, 5]);
  assert.deepEqual(parseVersion('v1.3.5'), [1, 3, 5]);
  assert.deepEqual(parseVersion(' V2.0 '), [2, 0]);
  assert.equal(parseVersion('auto-25'), null);
  assert.equal(parseVersion(''), null);
  assert.equal(parseVersion(undefined), null);
  assert.equal(parseVersion('1.2.x'), null);
});

test('isNewer: 数値で比較する', () => {
  assert.equal(isNewer('1.3.6', '1.3.5'), true);
  assert.equal(isNewer('1.10.0', '1.9.0'), true);     // 文字列比較だと逆になる
  assert.equal(isNewer('1.9.0', '1.10.0'), false);
  assert.equal(isNewer('v1.3.5', '1.3.5'), false);    // 同じ版は更新なし
  assert.equal(isNewer('1.3', '1.3.0'), false);       // 桁数が違っても同じ版
  assert.equal(isNewer('1.3.4', '1.3.5'), false);     // 手元のほうが新しい
});

test('isNewer: 版番号として読めなければ更新なし', () => {
  assert.equal(isNewer('auto-25', '1.0.0'), false);
  assert.equal(isNewer('1.0.1', 'dev'), false);
  assert.equal(isNewer(null, '1.0.0'), false);
});

test('isAllowedReleaseUrl: 自リポジトリの https URL だけ', () => {
  assert.equal(isAllowedReleaseUrl('https://github.com/yumebi/example/releases/tag/v1.0.0', REPO), true);
  assert.equal(isAllowedReleaseUrl('http://github.com/yumebi/example/releases', REPO), false);
  assert.equal(isAllowedReleaseUrl('https://github.com/yumebi/example.evil.com/', REPO), false);
  assert.equal(isAllowedReleaseUrl('https://github.com/yumebi/other/releases', REPO), false);
  assert.equal(isAllowedReleaseUrl('https://github.com@evil.com/yumebi/example/', REPO), false);
  assert.equal(isAllowedReleaseUrl(undefined, REPO), false);
});

const fakeFetch = (body, ok = true) => async () => ({ ok, json: async () => body });

test('fetchLatestRelease: タグと URL を返す', async () => {
  const r = await fetchLatestRelease(REPO, fakeFetch({ tag_name: 'v1.4.0', html_url: 'https://github.com/yumebi/example/releases/tag/v1.4.0' }));
  assert.deepEqual(r, { version: '1.4.0', url: 'https://github.com/yumebi/example/releases/tag/v1.4.0' });
});

test('fetchLatestRelease: 自リポジトリ以外の URL は空にする', async () => {
  const r = await fetchLatestRelease(REPO, fakeFetch({ tag_name: 'v1.4.0', html_url: 'https://evil.example.com/' }));
  assert.deepEqual(r, { version: '1.4.0', url: '' });
});

test('fetchLatestRelease: 失敗・不正は null(例外を投げない)', async () => {
  assert.equal(await fetchLatestRelease(REPO, fakeFetch({}, false)), null);
  assert.equal(await fetchLatestRelease(REPO, fakeFetch({ tag_name: 'auto-25' })), null);
  assert.equal(await fetchLatestRelease(REPO, fakeFetch({ unexpected: 1 })), null);
  assert.equal(await fetchLatestRelease(REPO, async () => { throw new Error('network down'); }), null);
});

test('fetchLatestRelease: GitHub Releases API を見に行く(version.json ではない)', async () => {
  let called;
  await fetchLatestRelease(REPO, async (url) => { called = url; return { ok: false }; });
  assert.equal(called, 'https://api.github.com/repos/yumebi/example/releases/latest');
});
