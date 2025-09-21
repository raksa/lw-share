"use strict";

import { unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';

import { setCorsHeaders, checkIsValidFile, listFiles } from './helpers.mjs';

export function init({ app, filesStorePath, publicPath }) {
    const baseRoutePath = '/files'

    app.get(`${baseRoutePath}/`, (_req, res) => {
        const filePath = resolve(publicPath, 'fileApp.html');
        console.log(`Serving file app: ${filePath}`);
        res.sendFile(filePath, { dotfiles: 'allow' });
    });

    app.use(`${baseRoutePath}/`, express.static(filesStorePath));

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
                                            console.log(`File saved: ${filePath}`);
                                        } catch (error) {
                                            console.error(`Error saving file ${finalName}:`, error);
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
                    console.error('Error processing upload:', error);
                    redirectError(res, 'Upload processing failed');
                }
            });

            req.on('error', (error) => {
                console.error('Upload request error:', error);
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
        console.log(`Deleting file: ${filePath}`);

        try {
            if (!checkIsValidFile(filesStorePath, filename)) {
                setCorsHeaders(res);
                return res.status(404).send('File not found or invalid filename');
            }

            unlinkSync(filePath);
            setCorsHeaders(res);
            res.status(200).send('File deleted successfully');
            console.log(`File deleted: ${filePath}`);
        } catch (err) {
            console.error(`Error deleting file: ${filePath}`, err);
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
                console.error('Error listing files:', error);
                res.status(500).json({ error: 'Failed to list files' });
            });
    });

};
