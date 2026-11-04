"use strict";

import { unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';

import { myConsole } from './consoleHelpers.mjs';
import { createFileStore, toStoreError } from './fileStore.mjs';

import { setCorsHeaders, checkIsValidFile, listFiles } from './helpers.mjs';

function sendStoreError(res, error) {
    const storeError = toStoreError(error);
    if (storeError.status >= 500) {
        myConsole.error('File API error:', error);
    }
    res.status(storeError.status).json({ error: storeError.message });
}

/**
 * JSON API used by the explorer page. It sends no CORS headers, and the
 * endpoints that change things only accept application/json bodies or PUT,
 * so another web site cannot trigger them from a visitor's browser.
 */
function createApiRouter(store) {
    const router = express.Router();
    const jsonBody = [
        (req, res, next) => {
            if (!req.is('application/json')) {
                return res.status(415).json({ error: 'Expected application/json' });
            }
            next();
        },
        express.json({ limit: '1mb' }),
    ];
    const handle = (action) => async (req, res) => {
        try {
            res.json(await action(req.body ?? {}, req));
        } catch (error) {
            sendStoreError(res, error);
        }
    };

    router.use((_req, res, next) => {
        res.setHeader('Cache-Control', 'no-store');
        next();
    });

    // ?path=a/b -> { path, entries: [{ name, type: 'file'|'folder', size, mtime }] }
    router.get('/list', handle((_body, req) => store.list(req.query.path)));
    // { path, name } -> { path } of the new folder
    router.post('/folder', jsonBody, handle(({ path, name }) => {
        return { path: store.createFolder(path, name) };
    }));
    // { path, name } -> { path } after renaming
    router.post('/rename', jsonBody, handle(({ path, name }) => {
        return { path: store.rename(path, name) };
    }));
    // { paths, destination } -> { moved: [{ from, to }], failed: [{ path, error }] }
    router.post('/move', jsonBody, handle(({ paths, destination }) => {
        return store.move(paths, destination);
    }));
    // { paths } -> { removed: [path], failed: [{ path, error }] }
    router.post('/delete', jsonBody, handle(({ paths }) => store.remove(paths)));
    // ?path=folder&name=file.txt (or sub/dir/file.txt), raw file as the body -> { path }
    router.put('/upload', async (req, res) => {
        try {
            const path = await store.saveUpload(req.query.path, req.query.name, req);
            myConsole.log(`File saved: ${path}`);
            res.status(201).json({ path });
        } catch (error) {
            if (!res.headersSent && !req.socket.destroyed) {
                sendStoreError(res, error);
            }
        }
    });

    router.use((_req, res) => {
        res.status(404).json({ error: 'Not found' });
    });
    // Body parser errors (bad JSON, too large) would otherwise reach the app's
    // HTML error handler.
    router.use((error, _req, res, _next) => {
        const status = error.status >= 400 && error.status < 500 ? error.status : 500;
        res.status(status).json({ error: status === 500 ? 'Unexpected server error' : error.message });
    });
    return router;
}

export function init({ app, filesStorePath, publicPath }) {
    const baseRoutePath = '/files'
    const fileAppPath = resolve(publicPath, 'fileApp.html');

    app.use('/api/files', createApiRouter(createFileStore(filesStorePath)));

    app.get(`${baseRoutePath}/`, (_req, res) => {
        myConsole.log(fileAppPath);
        res.sendFile(fileAppPath, { dotfiles: 'allow' });
    });

    // No index.html lookup: a folder URL opens the explorer (see the end of init).
    app.use(`${baseRoutePath}/`, express.static(filesStorePath, { index: false }));

    function redirectSuccess(res, message) {
        setCorsHeaders(res);
        res.redirect(`${baseRoutePath}/?success=` + encodeURIComponent(message));
    }
    function redirectError(res, message) {
        setCorsHeaders(res);
        res.redirect(`${baseRoutePath}/?error=` + encodeURIComponent(message));
    }
    app.post(`${baseRoutePath}/`, (req, res) => {
        const contentType = req.headers['content-type'];
        if (contentType && contentType.startsWith('multipart/form-data')) {
            const boundary = contentType.split('boundary=')[1];
            if (!boundary) {
                return redirectError(res, 'Invalid boundary');
            }

            let fileData = Buffer.from('');
            const maxFileSize = 100 * 1024 * 1024;

            req.on('data', (chunk) => {
                fileData = Buffer.concat([fileData, chunk]);

                if (fileData.length > maxFileSize) {
                    req.destroy();
                    return redirectError(res, 'File too large (max 100MB)');
                }
            });

            req.on('end', () => {
                try {
                    const boundaryBuffer = Buffer.from(`--${boundary}`);
                    const parts = [];
                    let start = 0;

                    while (true) {
                        const boundaryIndex = fileData.indexOf(boundaryBuffer, start);
                        if (boundaryIndex === -1) break;

                        if (start !== 0) {
                            parts.push(fileData.slice(start, boundaryIndex));
                        }
                        start = boundaryIndex + boundaryBuffer.length;
                    }

                    const uploadedFiles = [];
                    let hasErrors = false;

                    for (const part of parts) {
                        const partString = part.toString('binary', 0, Math.min(part.length, 1024));
                        if (partString.includes('filename=') && !partString.includes('filename=""')) {
                            const filenameMatch = partString.match(/filename="([^"]+)"/);
                            if (filenameMatch && filenameMatch[1]) {
                                const rawFilename = filenameMatch[1];
                                let finalName = rawFilename.replace(/[/\\:*?"<>|]/g, '_').replace(/^\.+/, '');

                                if (!finalName || finalName.trim() === '') {
                                    finalName = `uploaded_file_${Date.now()}`;
                                }

                                const headerEndIndex = part.indexOf('\r\n\r\n');
                                if (headerEndIndex !== -1) {
                                    const contentStart = headerEndIndex + 4;
                                    const contentEnd = part.lastIndexOf('\r\n');
                                    const fileContent = part.slice(contentStart, contentEnd > contentStart ? contentEnd : undefined);

                                    if (fileContent && fileContent.length > 0) {
                                        try {
                                            const filePath = resolve(filesStorePath, finalName);

                                            if (checkIsValidFile(filesStorePath, finalName)) {
                                                unlinkSync(filePath);
                                            }

                                            writeFileSync(filePath, fileContent);
                                            uploadedFiles.push(finalName);
                                            myConsole.log(`File saved: ${filePath}`);
                                        } catch (error) {
                                            myConsole.error(`Error saving file ${finalName}:`, error);
                                            hasErrors = true;
                                        }
                                    }
                                }
                            }
                        }
                    }

                    if (uploadedFiles.length > 0) {
                        const message = uploadedFiles.length === 1
                            ? `File uploaded: ${uploadedFiles[0]}`
                            : `${uploadedFiles.length} files uploaded: ${uploadedFiles.join(', ')}`;
                        redirectSuccess(res, message);
                    } else if (hasErrors) {
                        redirectError(res, 'Some files failed to upload');
                    } else {
                        redirectError(res, 'No valid files found');
                    }
                } catch (error) {
                    myConsole.error('Error processing upload:', error);
                    redirectError(res, 'Upload processing failed');
                }
            });

            req.on('error', (error) => {
                myConsole.error('Upload request error:', error);
                redirectError(res, 'Upload request failed');
            });
        } else {
            redirectError(res, 'Invalid Content-Type');
        }
    });

    app.delete(`${baseRoutePath}/:filename`, (req, res) => {
        const filename = req.params.filename;

        if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            setCorsHeaders(res);
            return res.status(400).send('Invalid filename');
        }

        const filePath = resolve(filesStorePath, filename);
        myConsole.log(`Deleting file: ${filePath}`);

        try {
            if (!checkIsValidFile(filesStorePath, filename)) {
                setCorsHeaders(res);
                return res.status(404).send('File not found or invalid filename');
            }

            unlinkSync(filePath);
            setCorsHeaders(res);
            res.status(200).send('File deleted successfully');
            myConsole.log(`File deleted: ${filePath}`);
        } catch (err) {
            myConsole.error(`Error deleting file: ${filePath}`, err);
            setCorsHeaders(res);
            res.status(500).send('Error deleting file');
        }
    });

    app.get(`${baseRoutePath}/files/info`, (_req, res) => {
        setCorsHeaders(res);
        listFiles(filesStorePath)
            .then((filePaths) => {
                res.json({
                    "fileList": filePaths
                });
            })
            .catch((error) => {
                myConsole.error('Error listing files:', error);
                res.status(500).json({ error: 'Failed to list files' });
            });
    });

    // Folder URLs such as /files/Photos/2024/ open the explorer at that folder;
    // the page reads the folder from its own URL. Files were served above.
    app.get(`${baseRoutePath}/*splat`, (req, res, next) => {
        if (!req.path.endsWith('/')) {
            return next();
        }
        res.sendFile(fileAppPath, { dotfiles: 'allow' });
    });

};
