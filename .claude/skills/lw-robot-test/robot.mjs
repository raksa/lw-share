#!/usr/bin/env node
// Fixtures, cleanup and scripted HTTP checks for the lw-robot-test skill (see SKILL.md).
//
//   node .claude/skills/lw-robot-test/robot.mjs setup [--out <dir>]
//   node .claude/skills/lw-robot-test/robot.mjs api [<runId>]
//   node .claude/skills/lw-robot-test/robot.mjs cleanup <runId> [--artifacts]
//   node .claude/skills/lw-robot-test/robot.mjs cleanup --all
//
// It talks to the running server over HTTP only (LW_URL, default
// http://localhost:3006), so it works whatever folder the server shares.
// Everything it creates in the share lives in one top-level folder,
// robot-<runId>; nothing else there is read, changed or deleted.

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const BASE = (process.env.LW_URL || 'http://localhost:3006').replace(/\/+$/, '');
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const DEFAULT_OUT = join(REPO, 'test-results', 'lw-robot-test');
// Electron saves to the OS Downloads folder; override if it has been moved.
const DOWNLOADS = process.env.LW_DOWNLOADS || join(homedir(), 'Downloads');
const RUN_FOLDER = /^robot-(\d{8}-\d{6})$/;

// ---- Helpers -------------------------------------------------------------

function newRunId() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const query = (params) => new URLSearchParams(params).toString();

async function http(method, path, { json, body, headers = {} } = {}) {
    const init = { method, headers: { ...headers }, redirect: 'manual' };
    if (json !== undefined) {
        init.body = JSON.stringify(json);
        init.headers['Content-Type'] ??= 'application/json';
    } else if (body !== undefined) {
        init.body = body;
    }
    const res = await fetch(BASE + path, init);
    const text = await res.text();
    let data = null;
    try {
        data = JSON.parse(text);
    } catch {
        // Not JSON; callers check `text` or `status`.
    }
    return { status: res.status, headers: res.headers, text, data };
}

const api = {
    list: (path) => http('GET', `/api/files/list?${query({ path })}`),
    folder: (path, name) => http('POST', '/api/files/folder', { json: { path, name } }),
    file: (path, name) => http('POST', '/api/files/file', { json: { path, name } }),
    upload: (path, name, body) => http('PUT', `/api/files/upload?${query({ path, name })}`, { body }),
    text: (path) => http('GET', `/api/files/text?${query({ path })}`),
    putText: (path, body, mtime) => http('PUT', `/api/files/text?${query(mtime === undefined ? { path } : { path, mtime })}`, { body }),
    rename: (path, name) => http('POST', '/api/files/rename', { json: { path, name } }),
    move: (paths, destination) => http('POST', '/api/files/move', { json: { paths, destination } }),
    remove: (paths) => http('POST', '/api/files/delete', { json: { paths } }),
};

function must(res, what) {
    if (res.status < 200 || res.status >= 300) {
        throw new Error(`${what} failed: HTTP ${res.status} ${res.text.slice(0, 200)}`);
    }
    return res.data;
}

async function ensureServer() {
    try {
        await fetch(`${BASE}/api/files/list`);
    } catch {
        console.error(`lw-share is not answering at ${BASE}. Start it with \`npm run dev\` (see AGENTS.md).`);
        process.exit(2);
    }
}

// A small valid PNG (checkerboard), built here so no binary has to be checked in.
function crc32(buf) {
    let crc = 0xffffffff;
    for (const byte of buf) {
        let c = (crc ^ byte) & 0xff;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([length, typed, crc]);
}

function makePng(size = 32, colors = [[37, 99, 235], [250, 204, 21]]) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(size, 0);
    header.writeUInt32BE(size, 4);
    header[8] = 8; // bit depth
    header[9] = 2; // RGB
    const rows = [];
    for (let y = 0; y < size; y++) {
        const row = Buffer.alloc(1 + size * 3); // leading 0 = no filter
        for (let x = 0; x < size; x++) {
            row.set(colors[(Math.floor(x / 8) + Math.floor(y / 8)) % 2], 1 + x * 3);
        }
        rows.push(row);
    }
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        pngChunk('IHDR', header),
        pngChunk('IDAT', deflateSync(Buffer.concat(rows))),
        pngChunk('IEND', Buffer.alloc(0)),
    ]);
}

function argValue(args, flag) {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
}

// ---- setup -----------------------------------------------------------------

async function setup(args) {
    await ensureServer();
    const runId = newRunId();
    const folder = `robot-${runId}`;
    const artifacts = resolve(argValue(args, '--out') ?? DEFAULT_OUT, runId);
    const uploadsDir = join(artifacts, 'uploads');
    const screenshots = join(artifacts, 'screenshots');

    must(await api.folder('', folder), `create ${folder}`);
    for (const [parent, name] of [[folder, 'Docs'], [`${folder}/Docs`, 'Archive'], [folder, 'Photos'], [folder, 'Empty']]) {
        must(await api.folder(parent, name), `create ${parent}/${name}`);
    }
    // Uploaded one by one, a little apart, so "Last modified" sorting is predictable.
    const files = [
        [folder, 'readme.txt', 'Hello from lw-robot-test.\n'],
        [folder, 'crlf.txt', 'first line\r\nsecond line\r\n'],
        [folder, 'large.txt', 'lw-robot-test large file line\n'.repeat(150)],
        [folder, 'binary.dat', Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff, 0xfe])],
        [folder, `download-${runId}.bin`, Buffer.from(Array.from({ length: 256 }, (_, i) => i))],
        [`${folder}/Docs`, 'notes.md', '# Notes\n\nCreated by lw-robot-test.\n'],
        [`${folder}/Photos`, 'pixel.png', makePng()],
    ];
    const fixtures = [];
    for (const [path, name, content] of files) {
        fixtures.push(must(await api.upload(path, name, content), `upload ${path}/${name}`).path);
        await sleep(25);
    }

    mkdirSync(uploadsDir, { recursive: true });
    mkdirSync(screenshots, { recursive: true });
    const uploads = {
        upload: join(uploadsDir, `upload-${runId}.txt`),
        clash: join(uploadsDir, 'readme.txt'),
        image: join(uploadsDir, `photo-${runId}.png`),
    };
    writeFileSync(uploads.upload, `Uploaded through the explorer by lw-robot-test run ${runId}.\n`);
    writeFileSync(uploads.clash, 'A second readme.txt, uploaded to test name clashes.\n');
    writeFileSync(uploads.image, makePng(48, [[22, 163, 74], [255, 255, 255]]));

    const info = {
        runId,
        baseUrl: BASE,
        folder,
        folderUrl: `${BASE}/files/${folder}/`,
        fixtures,
        folders: ['Docs', 'Docs/Archive', 'Photos', 'Empty'].map((name) => `${folder}/${name}`),
        artifacts,
        screenshots,
        uploads,
        downloadsDir: DOWNLOADS,
        cleanup: `node .claude/skills/lw-robot-test/robot.mjs cleanup ${runId}`,
    };
    writeFileSync(join(artifacts, 'run.json'), `${JSON.stringify(info, null, 2)}\n`);
    console.log(JSON.stringify(info, null, 2));
}

// ---- cleanup -----------------------------------------------------------------

async function cleanup(args) {
    await ensureServer();
    const all = args.includes('--all');
    const runId = args.find((arg) => /^\d{8}-\d{6}$/.test(arg));
    if (!all && !runId) {
        console.error('Usage: robot.mjs cleanup <runId> [--artifacts] | cleanup --all');
        process.exit(2);
    }

    const root = must(await api.list(''), 'list the shared folder');
    const folders = root.entries
        .filter((entry) => entry.type === 'folder' && RUN_FOLDER.test(entry.name))
        .map((entry) => entry.name)
        .filter((name) => all || name === `robot-${runId}`);
    // Legacy-upload leftovers from an interrupted `api` run.
    const strays = root.entries
        .filter((entry) => entry.type === 'file' && /^robot-\d{8}-\d{6}-/.test(entry.name))
        .map((entry) => entry.name)
        .filter((name) => all || name.startsWith(`robot-${runId}-`));
    const targets = [...folders, ...strays];
    const removed = targets.length ? must(await api.remove(targets), 'delete run folders') : { removed: [], failed: [] };

    // Downloads made by a run carry its runId in the name, so only those go.
    const tag = all ? /\d{8}-\d{6}/ : new RegExp(runId);
    const ownDownload = (name) => tag.test(name)
        && /^(download-|qr-|upload-|photo-|robot-)/.test(name);
    const downloads = [];
    if (existsSync(DOWNLOADS)) {
        for (const name of readdirSync(DOWNLOADS)) {
            if (ownDownload(name)) {
                rmSync(join(DOWNLOADS, name), { force: true });
                downloads.push(join(DOWNLOADS, name));
            }
        }
    }

    let artifacts = null;
    if (args.includes('--artifacts') && runId) {
        artifacts = join(DEFAULT_OUT, runId);
        rmSync(artifacts, { recursive: true, force: true });
    }

    console.log(JSON.stringify({
        removedFromShare: removed.removed,
        failedInShare: removed.failed,
        removedDownloads: downloads,
        removedArtifacts: artifacts,
    }, null, 2));
}

// ---- api checks --------------------------------------------------------------

async function apiChecks(args) {
    await ensureServer();
    const givenRun = args.find((arg) => /^\d{8}-\d{6}$/.test(arg));
    const runId = givenRun ?? newRunId();
    const runFolder = `robot-${runId}`;
    let ownRunFolder = false;
    if (!(await api.list(runFolder)).data?.entries) {
        must(await api.folder('', runFolder), `create ${runFolder}`);
        ownRunFolder = true;
    }
    const S = `${runFolder}/api-checks`;
    must(await api.folder(runFolder, 'api-checks'), `create ${S}`);
    const legacyName = `${runFolder}-legacy.txt`;

    const checks = [];
    const check = (id, name, fn) => checks.push({ id, name, fn });
    const expectStatus = (res, status, what) => assert.equal(res.status, status,
        `${what}: expected HTTP ${status}, got ${res.status} ${res.text.slice(0, 160)}`);
    const expectJsonError = (res, status, what) => {
        expectStatus(res, status, what);
        assert.equal(typeof res.data?.error, 'string', `${what}: expected a JSON {error}, got ${res.text.slice(0, 160)}`);
    };

    check('A-01', 'pages answer with HTML', async () => {
        const pages = {
            '/': 'Local Web Share',
            '/files/': 'Files · Local Web Share',
            [`/files/${S}/`]: 'Files · Local Web Share',
            '/chat/': 'Chat · Local Web Share',
            '/qrCoder/': 'QR code · Local Web Share',
        };
        for (const [path, title] of Object.entries(pages)) {
            const res = await http('GET', path);
            expectStatus(res, 200, path);
            assert.match(res.headers.get('content-type') || '', /text\/html/, `${path} content type`);
            assert.ok(res.text.includes(`<title>${title}</title>`), `${path} should have the title "${title}"`);
        }
    });

    check('A-02', 'static assets are served', async () => {
        for (const path of ['/js/common.js', '/js/fileApp.js', '/js/chatApp.js', '/js/qrCoder.js', '/js/socket.io.js',
            '/css/style.css', '/css/bootstrap.min.css', '/img/icons.svg']) {
            expectStatus(await http('GET', path), 200, path);
        }
    });

    check('A-03', 'an unknown page falls back to the home page', async () => {
        const res = await http('GET', `/robot-no-such-page-${runId}`);
        expectStatus(res, 200, 'unknown page');
        assert.ok(res.text.includes('Share between devices'), 'should serve index.html');
    });

    check('A-04', 'list: JSON, no-store, no CORS header', async () => {
        const res = await api.list(S);
        expectStatus(res, 200, 'list');
        assert.equal(res.data.path, S);
        assert.deepEqual(res.data.entries, []);
        assert.equal(res.headers.get('cache-control'), 'no-store');
        assert.equal(res.headers.get('access-control-allow-origin'), null, '/api/files must not send CORS headers');
    });

    check('A-05', 'list: a missing folder is a JSON 404', async () => {
        expectJsonError(await api.list(`${S}/nope`), 404, 'missing folder');
    });

    check('A-06', 'paths cannot leave the share or reach hidden names', async () => {
        for (const path of ['..', '../x', `${S}/../../..`, '.hidden', `${S}/.x`, '..\\x']) {
            expectJsonError(await api.list(path), 400, `list "${path}"`);
            expectJsonError(await api.folder(path, 'x'), 400, `folder in "${path}"`);
        }
    });

    check('A-07', 'changes need a JSON body (CSRF guard)', async () => {
        const plain = await http('POST', '/api/files/folder', {
            body: JSON.stringify({ path: S, name: 'csrf' }), headers: { 'Content-Type': 'text/plain' },
        });
        expectJsonError(plain, 415, 'text/plain body');
        const form = await http('POST', '/api/files/delete', {
            body: 'paths=x', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
        expectJsonError(form, 415, 'form body');
        const broken = await http('POST', '/api/files/folder', { body: '{', headers: { 'Content-Type': 'application/json' } });
        expectJsonError(broken, 400, 'malformed JSON');
        assert.equal((await api.list(S)).data.entries.length, 0, 'nothing may have been created');
    });

    check('A-08', 'create folder, then a clash is a 409', async () => {
        assert.equal(must(await api.folder(S, 'Alpha'), 'create Alpha').path, `${S}/Alpha`);
        expectJsonError(await api.folder(S, 'Alpha'), 409, 'duplicate folder');
        expectJsonError(await api.folder(S, '  Alpha  '), 409, 'duplicate after trimming');
    });

    check('A-09', 'invalid names are refused with a message', async () => {
        for (const name of ['', '   ', '.dot', 'a/b', 'a\\b', 'what?', 'star*', 'con', 'NUL.txt', 'trail.', 'x'.repeat(256)]) {
            expectJsonError(await api.folder(S, name), 400, `folder name ${JSON.stringify(name.slice(0, 20))}`);
            expectJsonError(await api.file(S, name), 400, `file name ${JSON.stringify(name.slice(0, 20))}`);
        }
    });

    check('A-10', 'text editing round trip with the mtime guard', async () => {
        assert.equal(must(await api.file(S, 'note.txt'), 'create note.txt').path, `${S}/note.txt`);
        expectJsonError(await api.file(S, 'note.txt'), 409, 'duplicate file');
        const empty = must(await api.text(`${S}/note.txt`), 'read note.txt');
        assert.equal(empty.content, '');
        // mtimes are compared in whole milliseconds, so let the clock move on first.
        await sleep(30);
        const saved = must(await api.putText(`${S}/note.txt`, 'v1\n', empty.mtime), 'save v1');
        assert.equal(saved.size, 3);
        assert.notEqual(saved.mtime, empty.mtime, 'saving must change the mtime');
        expectJsonError(await api.putText(`${S}/note.txt`, 'stale\n', empty.mtime), 412, 'save with a stale mtime');
        expectJsonError(await api.putText(`${S}/note.txt`, 'bad\n', 'abc'), 400, 'save with a bad mtime');
        assert.equal(must(await api.text(`${S}/note.txt`), 'read again').content, 'v1\n', 'refused saves must not write');
        must(await api.putText(`${S}/note.txt`, 'v2\n'), 'save without mtime');
        assert.equal(must(await api.text(`${S}/note.txt`), 'read v2').content, 'v2\n');
    });

    check('A-11', 'CRLF and a byte order mark survive', async () => {
        const content = '﻿one\r\ntwo\r\n';
        must(await api.upload(S, 'bom.txt', content), 'upload bom.txt');
        assert.equal(must(await api.text(`${S}/bom.txt`), 'read bom.txt').content, content);
    });

    check('A-12', 'binary files and folders cannot be opened as text', async () => {
        must(await api.upload(S, 'blob.dat', Buffer.from([0, 1, 2, 0])), 'upload blob.dat');
        expectJsonError(await api.text(`${S}/blob.dat`), 415, 'binary file');
        expectJsonError(await api.text(`${S}/Alpha`), 400, 'folder');
        expectJsonError(await api.text(`${S}/missing.txt`), 404, 'missing file');
    });

    check('A-13', 'uploads never overwrite: "name (n).ext"', async () => {
        const paths = [];
        for (const body of ['one', 'two', 'three']) {
            const res = await api.upload(S, 'dup.txt', body);
            expectStatus(res, 201, 'upload dup.txt');
            paths.push(res.data.path);
        }
        assert.deepEqual(paths, [`${S}/dup.txt`, `${S}/dup (1).txt`, `${S}/dup (2).txt`]);
        assert.equal(must(await api.text(`${S}/dup.txt`), 'read dup.txt').content, 'one');
    });

    check('A-14', 'folder uploads create subfolders; names are sanitized', async () => {
        assert.equal(must(await api.upload(S, 'deep/er/file.txt', 'x'), 'nested upload').path, `${S}/deep/er/file.txt`);
        assert.equal(must(await api.upload(S, 'bad:name?.txt', 'x'), 'illegal characters').path, `${S}/bad_name_.txt`);
        assert.equal(must(await api.upload(S, '.secret.txt', 'x'), 'leading dot').path, `${S}/secret.txt`);
        expectJsonError(await api.upload(S, '', 'x'), 400, 'empty name');
        expectJsonError(await api.upload(S, '../..', 'x'), 400, 'name of only dot segments');
        expectJsonError(await api.upload(`${S}/nope`, 'x.txt', 'x'), 404, 'missing target folder');
    });

    check('A-15', 'uploaded files are served under /files/', async () => {
        const res = await http('GET', `/files/${S.split('/').map(encodeURIComponent).join('/')}/dup%20(1).txt`);
        expectStatus(res, 200, 'GET file');
        assert.equal(res.text, 'two');
    });

    check('A-16', 'rename, including clashes and the root', async () => {
        assert.equal(must(await api.rename(`${S}/dup.txt`, 'renamed.txt'), 'rename').path, `${S}/renamed.txt`);
        expectJsonError(await api.rename(`${S}/renamed.txt`, 'dup (1).txt'), 409, 'rename onto an existing name');
        expectJsonError(await api.rename(`${S}/renamed.txt`, 'a/b'), 400, 'rename to an invalid name');
        expectJsonError(await api.rename('', 'x'), 400, 'rename the root');
        expectJsonError(await api.rename(`${S}/missing.txt`, 'x.txt'), 404, 'rename a missing item');
    });

    check('A-17', 'move, including clashes and moving a folder into itself', async () => {
        const first = must(await api.move([`${S}/renamed.txt`], `${S}/Alpha`), 'move');
        assert.deepEqual(first, { moved: [{ from: `${S}/renamed.txt`, to: `${S}/Alpha/renamed.txt` }], failed: [] });
        must(await api.upload(S, 'renamed.txt', 'again'), 'upload a second renamed.txt');
        const clash = must(await api.move([`${S}/renamed.txt`], `${S}/Alpha`), 'move onto a clash');
        assert.equal(clash.moved[0]?.to, `${S}/Alpha/renamed (1).txt`);
        const self = must(await api.move([`${S}/Alpha`], `${S}/Alpha`), 'move into itself');
        assert.equal(self.moved.length, 0);
        assert.match(self.failed[0]?.error || '', /into itself/);
        expectJsonError(await api.move([`${S}/bom.txt`], `${S}/nope`), 404, 'move to a missing folder');
        expectJsonError(await api.move([], S), 400, 'move nothing');
    });

    check('A-18', 'delete reports what it removed and what failed', async () => {
        const res = must(await api.remove([`${S}/Alpha`, `${S}/missing.txt`]), 'delete');
        assert.deepEqual(res.removed, [`${S}/Alpha`]);
        assert.equal(res.failed[0]?.path, `${S}/missing.txt`);
        expectJsonError(await api.remove([]), 400, 'delete nothing');
        const root = must(await api.remove(['']), 'delete the root');
        assert.equal(root.removed.length, 0, 'the root must not be deleted');
        assert.match(root.failed[0]?.error || '', /root/i);
        assert.equal((await api.list(`${S}/Alpha`)).status, 404, 'Alpha is gone');
    });

    check('A-19', 'unknown /api/files routes are JSON 404s', async () => {
        expectJsonError(await http('GET', '/api/files/nope'), 404, 'unknown route');
    });

    check('A-20', '/info/files and /info/addresses', async () => {
        const files = await http('GET', '/info/files');
        expectStatus(files, 200, '/info/files');
        assert.ok(Array.isArray(files.data?.fileList) && Array.isArray(files.data?.files), 'fileList and files arrays');
        const res = await http('GET', `/info/addresses?${query({ pathname: '/files/' })}`);
        expectStatus(res, 200, '/info/addresses');
        const list = res.data?.addressesWithQRList;
        assert.ok(Array.isArray(list) && list.length > 0, 'at least one address');
        const port = new URL(BASE).port;
        for (const item of list) {
            assert.match(item.address, new RegExp(`^http://[\\d.]+:${port}/files/$`), `address ${item.address}`);
            assert.match(item.qrCode, /^data:image\/png;base64,/, 'qrCode is a PNG data URL');
        }
    });

    check('A-21', 'POST /qrCoder/', async () => {
        const ok = await http('POST', '/qrCoder/', { json: { text: `robot ${runId}`, size: 250 } });
        expectStatus(ok, 200, 'QR code');
        assert.match(ok.data?.qrCode || '', /^data:image\/png;base64,/);
        expectStatus(await http('POST', '/qrCoder/', { body: '{"text":"x"}', headers: { 'Content-Type': 'text/plain' } }), 400, 'wrong content type');
        expectStatus(await http('POST', '/qrCoder/', { body: '{', headers: { 'Content-Type': 'application/json' } }), 400, 'malformed JSON');
    });

    check('A-22', 'legacy multipart upload and DELETE /files/<name>', async () => {
        const boundary = `----lwRobot${runId.replace('-', '')}`;
        const body = [
            `--${boundary}`,
            `Content-Disposition: form-data; name="file-to-upload"; filename="${legacyName}"`,
            'Content-Type: text/plain',
            '',
            'legacy upload',
            `--${boundary}--`,
            '',
        ].join('\r\n');
        const res = await http('POST', '/files/', { body, headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } });
        expectStatus(res, 302, 'multipart upload');
        assert.match(res.headers.get('location') || '', /^\/files\/\?success=/);
        assert.equal((await http('GET', `/files/${legacyName}`)).text, 'legacy upload');
        expectStatus(await http('DELETE', `/files/${legacyName}`), 200, 'legacy delete');
        expectStatus(await http('DELETE', `/files/${legacyName}`), 404, 'legacy delete again');
        expectStatus(await http('DELETE', '/files/..%2Foutside.txt'), 400, 'legacy delete outside the share');
    });

    let failed = 0;
    for (const { id, name, fn } of checks) {
        try {
            await fn();
            console.log(`PASS ${id} ${name}`);
        } catch (error) {
            failed++;
            console.log(`FAIL ${id} ${name} — ${error.message.split('\n')[0]}`);
        }
    }

    // Leave the UI run folder as setup made it.
    await api.remove([ownRunFolder ? runFolder : S]);
    const legacy = await http('GET', `/files/${legacyName}`);
    if (legacy.status === 200 && legacy.text === 'legacy upload') {
        await http('DELETE', `/files/${legacyName}`);
    }

    console.log(`\n${checks.length - failed} passed, ${failed} failed (${BASE})`);
    process.exitCode = failed ? 1 : 0;
}

// ---- main --------------------------------------------------------------------

const [command, ...args] = process.argv.slice(2);
const commands = { setup, cleanup, api: apiChecks };
if (!commands[command]) {
    console.error('Usage: robot.mjs setup [--out <dir>] | api [<runId>] | cleanup <runId> [--artifacts] | cleanup --all');
    process.exit(2);
}
commands[command](args).catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
});
