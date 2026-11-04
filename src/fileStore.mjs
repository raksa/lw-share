"use strict";

// Folder-aware file operations for the explorer, confined to one root folder.
// Paths are "/"-separated and relative to the root ("" is the root itself).
// Names starting with "." are hidden: they are never listed or addressable,
// which also rules out ".." and keeps in-progress uploads out of sight.

import { createWriteStream, lstatSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';

/** An error with an HTTP status and a message that is safe to show users. */
export class FileStoreError extends Error {
    constructor(status, message) {
        super(message);
        this.name = 'FileStoreError';
        this.status = status;
    }
}

const ILLEGAL_CHARS = /[\\/:*?"<>|\u0000-\u001f]/;
const ILLEGAL_CHARS_GLOBAL = new RegExp(ILLEGAL_CHARS.source, 'g');
const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
const MAX_NAME_BYTES = 255;
const MAX_BATCH = 10_000;
/** Largest file the text editor opens or saves. */
export const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const TOO_LARGE_TO_EDIT = `Files over ${MAX_TEXT_BYTES / 1024 / 1024} MB cannot be edited here`;
const IS_WINDOWS = process.platform === 'win32';

/** Map a Node fs error (or anything thrown) to a FileStoreError. */
export function toStoreError(error) {
    if (error instanceof FileStoreError) {
        return error;
    }
    switch (error?.code) {
        case 'ENOENT': return new FileStoreError(404, 'Not found');
        case 'ENOTDIR': return new FileStoreError(400, 'Not a folder');
        case 'EEXIST':
        case 'ENOTEMPTY': return new FileStoreError(409, 'An item with that name already exists');
        case 'EACCES': return new FileStoreError(403, 'Permission denied');
        case 'EPERM': return new FileStoreError(403, 'Permission denied, or the item is in use');
        case 'EBUSY': return new FileStoreError(409, 'The item is in use by another program');
        case 'ENAMETOOLONG': return new FileStoreError(400, 'Name is too long');
        case 'EINVAL': return new FileStoreError(400, 'Invalid operation');
        case 'EXDEV': return new FileStoreError(400, 'Cannot move items to another drive');
        case 'ENOSPC': return new FileStoreError(507, 'Not enough disk space');
        default: return new FileStoreError(500, 'Unexpected server error');
    }
}

/** Return the trimmed name, or throw if it cannot be a file or folder name. */
export function validateName(name) {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    let problem = null;
    if (!trimmed) {
        problem = 'Name cannot be empty';
    } else if (trimmed.startsWith('.')) {
        problem = 'Name cannot start with a dot';
    } else if (ILLEGAL_CHARS.test(trimmed)) {
        problem = 'Name cannot contain any of \\ / : * ? " < > |';
    } else if (trimmed.endsWith('.')) {
        problem = 'Name cannot end with a dot';
    } else if (WINDOWS_DEVICE_NAME.test(trimmed)) {
        problem = `"${trimmed}" is a reserved name`;
    } else if (Buffer.byteLength(trimmed) > MAX_NAME_BYTES) {
        problem = 'Name is too long';
    }
    if (problem) {
        throw new FileStoreError(400, problem);
    }
    return trimmed;
}

/** Make an uploaded file's name usable instead of rejecting the upload. */
export function sanitizeName(name) {
    let clean = String(name ?? '')
        .replace(ILLEGAL_CHARS_GLOBAL, '_')
        .replace(/^[.\s]+/, '')
        .replace(/[.\s]+$/, '');
    if (WINDOWS_DEVICE_NAME.test(clean)) {
        clean = `_${clean}`;
    }
    return clean || `uploaded_file_${Date.now()}`;
}

function toSegments(relPath) {
    if (relPath === undefined || relPath === null) {
        return [];
    }
    if (typeof relPath !== 'string') {
        throw new FileStoreError(400, 'Invalid path');
    }
    const segments = relPath.split('/').filter(Boolean);
    for (const segment of segments) {
        if (segment.startsWith('.') || segment.includes('\\') || segment.includes('\0')
            || (IS_WINDOWS && (segment.includes(':') || WINDOWS_DEVICE_NAME.test(segment)))) {
            throw new FileStoreError(400, 'Invalid path');
        }
    }
    return segments;
}

function isSameOrInside(childPath, parentPath) {
    const rel = relative(parentPath, childPath);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function joinRel(...parts) {
    return parts.filter(Boolean).join('/');
}

function entryExists(absPath) {
    try {
        lstatSync(absPath);
        return true;
    } catch {
        return false;
    }
}

function isSameEntry(pathA, pathB) {
    try {
        const a = statSync(pathA, { bigint: true });
        const b = statSync(pathB, { bigint: true });
        return a.dev === b.dev && a.ino === b.ino;
    } catch {
        return false;
    }
}

/**
 * `name` if it is free in the folder, else the first free "name (n)" (files
 * keep their extension last: "photo (1).jpg"). Callers must use the result in
 * the same synchronous step, so no other request can claim it in between.
 */
function uniqueName(folderAbsPath, name, isFolder) {
    if (!entryExists(join(folderAbsPath, name))) {
        return name;
    }
    const ext = isFolder ? '' : extname(name);
    let stem = name.slice(0, name.length - ext.length);
    let n = 1;
    const numbered = stem.match(/^(.*) \((\d+)\)$/);
    if (numbered) {
        stem = numbered[1];
        n = Number(numbered[2]) + 1;
    }
    for (let attempt = 0; attempt < MAX_BATCH; attempt++, n++) {
        const candidate = `${stem} (${n})${ext}`;
        if (!entryExists(join(folderAbsPath, candidate))) {
            return candidate;
        }
    }
    throw new FileStoreError(409, 'Too many items with the same name');
}

function toPathList(paths) {
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_BATCH
        || !paths.every((path) => typeof path === 'string')) {
        throw new FileStoreError(400, 'Expected a list of paths');
    }
    return paths;
}

export function createFileStore(rootPath) {
    const root = resolve(rootPath);

    function locate(relPath) {
        const segments = toSegments(relPath);
        const absPath = resolve(root, ...segments);
        if (!isSameOrInside(absPath, root)) {
            throw new FileStoreError(400, 'Invalid path');
        }
        return { absPath, segments, relPath: segments.join('/') };
    }

    function locateFolder(relPath) {
        const folder = locate(relPath);
        let isFolder = false;
        try {
            isFolder = statSync(folder.absPath).isDirectory();
        } catch {
            // Missing: reported below.
        }
        if (!isFolder) {
            throw new FileStoreError(404, 'Folder not found');
        }
        return folder;
    }

    function locateItem(relPath) {
        const item = locate(relPath);
        if (item.segments.length === 0) {
            throw new FileStoreError(400, 'The root folder cannot be changed');
        }
        const name = item.segments[item.segments.length - 1];
        let stats;
        try {
            stats = statSync(item.absPath);
        } catch {
            throw new FileStoreError(404, `"${name}" was not found`);
        }
        return {
            ...item,
            name,
            parentRelPath: item.segments.slice(0, -1).join('/'),
            isFolder: stats.isDirectory(),
            stats,
        };
    }

    function locateFile(relPath) {
        const item = locateItem(relPath);
        if (item.isFolder) {
            throw new FileStoreError(400, 'Only files can be edited');
        }
        return item;
    }

    /** List the visible files and folders directly inside a folder. */
    async function list(relPath) {
        const folder = locate(relPath);
        let dirents;
        try {
            dirents = await readdir(folder.absPath, { withFileTypes: true });
        } catch (error) {
            throw ['ENOENT', 'ENOTDIR'].includes(error.code)
                ? new FileStoreError(404, 'Folder not found')
                : error;
        }
        const entries = await Promise.all(dirents
            .filter((dirent) => !dirent.name.startsWith('.'))
            .map(async ({ name }) => {
                try {
                    const stats = await stat(join(folder.absPath, name));
                    const mtime = Math.round(stats.mtimeMs);
                    if (stats.isDirectory()) {
                        return { name, type: 'folder', size: null, mtime };
                    }
                    if (stats.isFile()) {
                        return { name, type: 'file', size: stats.size, mtime };
                    }
                } catch {
                    // Broken link, no permission, or removed meanwhile: skip it.
                }
                return null;
            }));
        return { path: folder.relPath, entries: entries.filter(Boolean) };
    }

    function createFolder(parentRelPath, name) {
        const folderName = validateName(name);
        const parent = locateFolder(parentRelPath);
        try {
            mkdirSync(join(parent.absPath, folderName));
        } catch (error) {
            if (error.code === 'EEXIST') {
                throw new FileStoreError(409, `"${folderName}" already exists here`);
            }
            throw error;
        }
        return joinRel(parent.relPath, folderName);
    }

    /** Create an empty file. Unlike uploads, a clashing name is an error. */
    function createFile(parentRelPath, name) {
        const fileName = validateName(name);
        const parent = locateFolder(parentRelPath);
        try {
            writeFileSync(join(parent.absPath, fileName), '', { flag: 'wx' });
        } catch (error) {
            if (error.code === 'EEXIST') {
                throw new FileStoreError(409, `"${fileName}" already exists here`);
            }
            throw error;
        }
        return joinRel(parent.relPath, fileName);
    }

    /**
     * A file's contents as text, for the editor. Only UTF-8 text up to
     * MAX_TEXT_BYTES is returned; a byte order mark is kept in `content` so
     * saving writes it back.
     */
    async function readText(fileRelPath) {
        const file = locateFile(fileRelPath);
        if (file.stats.size > MAX_TEXT_BYTES) {
            throw new FileStoreError(413, TOO_LARGE_TO_EDIT);
        }
        const data = await readFile(file.absPath);
        let content = null;
        if (!data.includes(0)) {
            try {
                content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data);
            } catch {
                // Not UTF-8: reported below.
            }
        }
        if (content === null) {
            throw new FileStoreError(415, 'This is not a text file, so it cannot be edited here');
        }
        return { path: file.relPath, content, size: data.length, mtime: Math.round(file.stats.mtimeMs) };
    }

    /**
     * Replace a file's contents. With `expectedMtime` (from readText), a file
     * that changed in the meantime is not overwritten (412). The data goes to
     * a temp file first, so a failed save leaves the old contents intact.
     */
    async function writeText(fileRelPath, data, expectedMtime) {
        const file = locateFile(fileRelPath);
        const bytes = typeof data === 'string' ? Buffer.from(data) : data;
        if (!Buffer.isBuffer(bytes)) {
            throw new FileStoreError(400, 'Expected the file contents');
        }
        if (bytes.length > MAX_TEXT_BYTES) {
            throw new FileStoreError(413, TOO_LARGE_TO_EDIT);
        }
        if (expectedMtime !== undefined && !Number.isFinite(expectedMtime)) {
            throw new FileStoreError(400, 'Invalid mtime');
        }
        if (expectedMtime !== undefined && expectedMtime !== Math.round(file.stats.mtimeMs)) {
            throw new FileStoreError(412, `"${file.name}" was changed by someone else since you opened it`);
        }
        const tempPath = join(dirname(file.absPath), `.lw-share-save-${randomUUID()}`);
        try {
            await writeFile(tempPath, bytes, { flag: 'wx', mode: file.stats.mode & 0o777 });
            renameSync(tempPath, file.absPath);
        } catch (error) {
            await unlink(tempPath).catch(() => { });
            throw error;
        }
        const stats = statSync(file.absPath);
        return { path: file.relPath, size: stats.size, mtime: Math.round(stats.mtimeMs) };
    }

    function rename(itemRelPath, newName) {
        const item = locateItem(itemRelPath);
        const name = validateName(newName);
        if (name === item.name) {
            return item.relPath;
        }
        const parentAbsPath = resolve(item.absPath, '..');
        const target = join(parentAbsPath, name);
        // A case-only rename ("a.txt" -> "A.txt") finds itself on
        // case-insensitive file systems; anything else there is a real clash.
        const isCaseOnlyRename = name.toLowerCase() === item.name.toLowerCase()
            && isSameEntry(item.absPath, target);
        if (entryExists(target) && !isCaseOnlyRename) {
            throw new FileStoreError(409, `"${name}" already exists here`);
        }
        renameSync(item.absPath, target);
        return joinRel(item.parentRelPath, name);
    }

    /** Move items into a folder, renaming them "name (1)" on a clash. */
    function move(itemRelPaths, destinationRelPath) {
        const destination = locateFolder(destinationRelPath);
        const moved = [];
        const failed = [];
        for (const itemRelPath of toPathList(itemRelPaths)) {
            try {
                const item = locateItem(itemRelPath);
                if (item.parentRelPath === destination.relPath) {
                    continue; // already there
                }
                if (isSameOrInside(destination.absPath, item.absPath)) {
                    throw new FileStoreError(400, 'Cannot move a folder into itself');
                }
                const name = uniqueName(destination.absPath, item.name, item.isFolder);
                renameSync(item.absPath, join(destination.absPath, name));
                moved.push({ from: item.relPath, to: joinRel(destination.relPath, name) });
            } catch (error) {
                failed.push({ path: itemRelPath, error: toStoreError(error).message });
            }
        }
        return { moved, failed };
    }

    /** Permanently delete files and folders (folders with their contents). */
    async function remove(itemRelPaths) {
        const removed = [];
        const failed = [];
        for (const itemRelPath of toPathList(itemRelPaths)) {
            try {
                const item = locateItem(itemRelPath);
                await rm(item.absPath, { recursive: true, maxRetries: 2 });
                removed.push(item.relPath);
            } catch (error) {
                failed.push({ path: itemRelPath, error: toStoreError(error).message });
            }
        }
        return { removed, failed };
    }

    /**
     * Stream one uploaded file into a folder. `relName` may contain "/" (from
     * a folder upload); missing subfolders are created and existing ones are
     * reused. The data goes to a hidden temp file first, so a half-finished
     * upload never shows up, and a clashing file name gets a " (n)" suffix.
     */
    async function saveUpload(folderRelPath, relName, source) {
        const folder = locateFolder(folderRelPath);
        const segments = typeof relName === 'string'
            ? relName.split('/').filter((s) => s && s !== '.' && s !== '..').map(sanitizeName)
            : [];
        if (segments.length === 0) {
            throw new FileStoreError(400, 'Missing file name');
        }
        const fileName = segments.pop();
        const parentAbsPath = join(folder.absPath, ...segments);
        if (segments.length > 0) {
            await mkdir(parentAbsPath, { recursive: true });
        }
        const tempPath = join(parentAbsPath, `.lw-share-upload-${randomUUID()}`);
        try {
            await pipeline(source, createWriteStream(tempPath, { flags: 'wx' }));
            const finalName = uniqueName(parentAbsPath, fileName, false);
            renameSync(tempPath, join(parentAbsPath, finalName));
            return joinRel(folder.relPath, ...segments, finalName);
        } catch (error) {
            await unlink(tempPath).catch(() => { });
            throw error;
        }
    }

    return { root, list, createFolder, createFile, readText, writeText, rename, move, remove, saveUpload };
}
