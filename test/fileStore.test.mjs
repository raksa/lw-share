import { after, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { createFileStore, MAX_TEXT_BYTES, sanitizeName, validateName } from '../src/fileStore.mjs';

const sandbox = mkdtempSync(join(tmpdir(), 'lw-share-test-'));
const root = join(sandbox, 'share');
const outside = join(sandbox, 'outside.txt');
const store = createFileStore(root);

beforeEach(() => {
    rmSync(root, { recursive: true, force: true });
    mkdirSync(join(root, 'docs', 'old'), { recursive: true });
    writeFileSync(join(root, 'a.txt'), 'a');
    writeFileSync(join(root, 'docs', 'b.txt'), 'b');
    writeFileSync(join(root, '.hidden'), 'secret');
    writeFileSync(outside, 'outside');
});

after(() => {
    rmSync(sandbox, { recursive: true, force: true });
});

const names = (dir = root) => readdirSync(dir).sort();

describe('paths stay inside the root', () => {
    const escapes = ['..', '../outside.txt', 'docs/../../outside.txt', '.hidden', 'docs/.', '..\\outside.txt'];

    for (const path of escapes) {
        test(`rejects "${path}"`, async () => {
            await assert.rejects(store.list(path), { status: 400 });
            assert.throws(() => store.rename(path, 'x'), { status: 400 });
            assert.throws(() => store.move(['a.txt'], path), { status: 400 });
            assert.throws(() => store.createFolder(path, 'x'), { status: 400 });
            assert.throws(() => store.createFile(path, 'x.txt'), { status: 400 });
            await assert.rejects(store.readText(path), { status: 400 });
            await assert.rejects(store.writeText(path, 'x'), { status: 400 });
            await assert.rejects(store.saveUpload(path, 'x.txt', Readable.from(['x'])), { status: 400 });
            assert.equal(store.move([path], 'docs').failed.length, 1);
            assert.equal((await store.remove([path])).failed.length, 1);
        });
    }

    test('the outside file is untouched', () => {
        assert.equal(readFileSync(outside, 'utf8'), 'outside');
    });

    test('the root cannot be renamed, moved or deleted', async () => {
        assert.throws(() => store.rename('', 'x'), { status: 400 });
        assert.equal(store.move([''], 'docs').failed.length, 1);
        assert.equal((await store.remove(['/'])).failed.length, 1);
        assert.ok(existsSync(root));
    });
});

describe('list', () => {
    test('lists folders and files, hiding dot entries', async () => {
        const { path, entries } = await store.list('');
        assert.equal(path, '');
        assert.deepEqual(entries.map((e) => [e.name, e.type]).sort(), [['a.txt', 'file'], ['docs', 'folder']]);
        assert.equal(entries.find((e) => e.name === 'a.txt').size, 1);
        assert.equal(entries.find((e) => e.name === 'docs').size, null);
    });

    test('normalizes slashes and 404s missing folders', async () => {
        assert.equal((await store.list('/docs/')).path, 'docs');
        await assert.rejects(store.list('nope'), { status: 404 });
        await assert.rejects(store.list('a.txt'), { status: 404 });
    });
});

describe('names', () => {
    test('validateName rejects unusable names', () => {
        for (const bad of ['', '   ', '.env', 'a/b', 'a\\b', 'a:b', 'what?', 'CON', 'nul.txt', 'trailing.', 'x'.repeat(256)]) {
            assert.throws(() => validateName(bad), { status: 400 }, bad);
        }
        assert.equal(validateName('  Report 2024.pdf '), 'Report 2024.pdf');
    });

    test('sanitizeName makes uploaded names usable', () => {
        assert.equal(sanitizeName('a:b?.txt'), 'a_b_.txt');
        assert.equal(sanitizeName('..env'), 'env');
        assert.equal(sanitizeName('CON'), '_CON');
        assert.match(sanitizeName('...'), /^uploaded_file_\d+$/);
    });
});

describe('createFolder and rename', () => {
    test('creates a folder and refuses a duplicate', () => {
        assert.equal(store.createFolder('docs', 'New'), 'docs/New');
        assert.ok(existsSync(join(root, 'docs', 'New')));
        assert.throws(() => store.createFolder('docs', 'New'), { status: 409 });
        assert.throws(() => store.createFolder('missing', 'x'), { status: 404 });
    });

    test('renames, refuses clashes, and allows case-only renames', () => {
        assert.equal(store.rename('a.txt', 'c.txt'), 'c.txt');
        assert.throws(() => store.rename('c.txt', 'docs'), { status: 409 });
        assert.equal(store.rename('docs', 'Docs'), 'Docs');
        assert.deepEqual(names(), ['.hidden', 'Docs', 'c.txt']);
        assert.throws(() => store.rename('missing.txt', 'x.txt'), { status: 404 });
    });
});

describe('createFile, readText and writeText', () => {
    test('creates an empty file and refuses a duplicate or bad name', () => {
        assert.equal(store.createFile('docs', 'notes.md'), 'docs/notes.md');
        assert.equal(readFileSync(join(root, 'docs', 'notes.md'), 'utf8'), '');
        assert.throws(() => store.createFile('docs', 'notes.md'), { status: 409 });
        assert.throws(() => store.createFile('', 'docs'), { status: 409 });
        assert.throws(() => store.createFile('', '.env'), { status: 400 });
        assert.throws(() => store.createFile('missing', 'x.txt'), { status: 404 });
    });

    test('reads text, keeping a byte order mark and CRLF line endings', async () => {
        writeFileSync(join(root, 'bom.txt'), '\uFEFFone\r\ntwo');
        const text = await store.readText('bom.txt');
        assert.equal(text.path, 'bom.txt');
        assert.equal(text.content, '\uFEFFone\r\ntwo');
        assert.equal(text.size, 11);
        assert.equal(typeof text.mtime, 'number');
    });

    test('refuses folders, binary, non-UTF-8 and large files', async () => {
        writeFileSync(join(root, 'bin.dat'), Buffer.from([0x50, 0x00, 0x51]));
        writeFileSync(join(root, 'latin1.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe9]));
        writeFileSync(join(root, 'big.txt'), Buffer.alloc(MAX_TEXT_BYTES + 1, 0x61));
        await assert.rejects(store.readText('docs'), { status: 400 });
        await assert.rejects(store.readText('bin.dat'), { status: 415 });
        await assert.rejects(store.readText('latin1.txt'), { status: 415 });
        await assert.rejects(store.readText('big.txt'), { status: 413 });
        await assert.rejects(store.readText('missing.txt'), { status: 404 });
    });

    test('writes text and returns the new size and mtime', async () => {
        const { mtime } = await store.readText('a.txt');
        const saved = await store.writeText('a.txt', 'héllo', mtime);
        assert.deepEqual([saved.path, saved.size], ['a.txt', 6]);
        assert.equal(readFileSync(join(root, 'a.txt'), 'utf8'), 'héllo');
        assert.equal((await store.readText('a.txt')).mtime, saved.mtime);
        await store.writeText('docs/b.txt', Buffer.from(''));
        assert.equal(readFileSync(join(root, 'docs', 'b.txt'), 'utf8'), '');
        assert.deepEqual(names(), ['.hidden', 'a.txt', 'docs']);
    });

    test('does not overwrite a file that changed since it was read', async () => {
        const { mtime } = await store.readText('a.txt');
        await assert.rejects(store.writeText('a.txt', 'stale', mtime - 5000), { status: 412 });
        await assert.rejects(store.writeText('a.txt', 'stale', Number.NaN), { status: 400 });
        assert.equal(readFileSync(join(root, 'a.txt'), 'utf8'), 'a');
    });

    test('refuses to write folders, missing files and too much data', async () => {
        await assert.rejects(store.writeText('docs', 'x'), { status: 400 });
        await assert.rejects(store.writeText('missing.txt', 'x'), { status: 404 });
        await assert.rejects(store.writeText('a.txt', Buffer.alloc(MAX_TEXT_BYTES + 1)), { status: 413 });
        assert.deepEqual(names(), ['.hidden', 'a.txt', 'docs']);
    });
});

describe('move', () => {
    test('moves items and renames on a clash', () => {
        writeFileSync(join(root, 'docs', 'a.txt'), 'other');
        const { moved, failed } = store.move(['a.txt'], 'docs');
        assert.deepEqual(failed, []);
        assert.deepEqual(moved, [{ from: 'a.txt', to: 'docs/a (1).txt' }]);
        assert.equal(readFileSync(join(root, 'docs', 'a (1).txt'), 'utf8'), 'a');
    });

    test('skips items already in the destination', () => {
        assert.deepEqual(store.move(['docs/b.txt'], 'docs'), { moved: [], failed: [] });
    });

    test('refuses to move a folder into itself or its subfolder', () => {
        assert.match(store.move(['docs'], 'docs').failed[0].error, /into itself/);
        const intoChild = store.move(['docs'], 'docs/old');
        assert.equal(intoChild.failed.length, 1);
        assert.match(intoChild.failed[0].error, /into itself/);
        assert.ok(existsSync(join(root, 'docs', 'old')));
    });

    test('reports missing items without stopping the batch', () => {
        const { moved, failed } = store.move(['missing.txt', 'a.txt'], 'docs');
        assert.equal(moved.length, 1);
        assert.equal(failed.length, 1);
        assert.throws(() => store.move(['a.txt'], 'missing'), { status: 404 });
    });
});

describe('remove', () => {
    test('deletes files and folders recursively', async () => {
        const { removed, failed } = await store.remove(['a.txt', 'docs']);
        assert.deepEqual(removed, ['a.txt', 'docs']);
        assert.deepEqual(failed, []);
        assert.deepEqual(names(), ['.hidden']);
    });
});

describe('saveUpload', () => {
    test('writes a file, renaming on a clash', async () => {
        assert.equal(await store.saveUpload('', 'new.txt', Readable.from(['hello'])), 'new.txt');
        assert.equal(await store.saveUpload('', 'a.txt', Readable.from(['second'])), 'a (1).txt');
        assert.equal(readFileSync(join(root, 'a.txt'), 'utf8'), 'a');
        assert.equal(readFileSync(join(root, 'a (1).txt'), 'utf8'), 'second');
    });

    test('creates the subfolders of a folder upload and sanitizes names', async () => {
        const saved = await store.saveUpload('docs', 'pics/2024/../a:b.png', Readable.from(['png']));
        assert.equal(saved, 'docs/pics/2024/a_b.png');
        assert.ok(existsSync(join(root, 'docs', 'pics', '2024', 'a_b.png')));
    });

    test('leaves no temp file behind when the upload fails', async () => {
        const broken = new Readable({
            read() {
                this.destroy(new Error('connection lost'));
            },
        });
        await assert.rejects(store.saveUpload('', 'broken.bin', broken));
        assert.deepEqual(names(), ['.hidden', 'a.txt', 'docs']);
    });

    test('rejects a missing name or folder', async () => {
        await assert.rejects(store.saveUpload('', '', Readable.from([''])), { status: 400 });
        await assert.rejects(store.saveUpload('missing', 'x.txt', Readable.from([''])), { status: 404 });
    });
});
