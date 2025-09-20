"use strict";

import { unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import express from 'express';

import { setCorsHeaders, checkIsValidFile, listFiles } from './helpers.mjs';

export function init({ app, filesStorePath, publicPath }) {
    const baseRoutePath = '/files'

    app.get(`${baseRoutePath}/`, (_req, res) => {
        res.sendFile(join(publicPath, 'fileApp.html'));
    });

    app.use(`${baseRoutePath}/`, express.static(filesStorePath));

    app.post(`${baseRoutePath}/`, (req, res) => {
        const contentType = req.headers['content-type'];
        if (contentType && contentType.startsWith('multipart/form-data')) {
            const boundary = contentType.split('boundary=')[1];
            if (!boundary) {
                return res.redirect(`${baseRoutePath}/?error=${encodeURIComponent('Invalid boundary')}`);
            }

            let fileData = Buffer.from('');
            const maxFileSize = 100 * 1024 * 1024; // 100MB limit

            req.on('data', (chunk) => {
                fileData = Buffer.concat([fileData, chunk]);

                // Check file size limit
                if (fileData.length > maxFileSize) {
                    req.destroy();
                    return res.redirect(`${baseRoutePath}/?error=${encodeURIComponent('File too large (max 100MB)')}`);
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
                        const partString = part.toString('binary', 0, Math.min(part.length, 1024)); // Only convert header portion to string
                        if (partString.includes('filename=') && !partString.includes('filename=""')) {
                            const filenameMatch = partString.match(/filename="([^"]+)"/);
                            if (filenameMatch && filenameMatch[1]) {
                                // Sanitize filename to prevent directory traversal
                                const rawFilename = filenameMatch[1];
                                let finalName = rawFilename.replace(/[/\\:*?"<>|]/g, '_').replace(/^\.+/, '');

                                // Ensure filename is not empty after sanitization
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

                                            // Remove existing file if it exists and is valid
                                            if (checkIsValidFile(filesStorePath, finalName)) {
                                                unlinkSync(filePath);
                                            }

                                            writeFileSync(filePath, fileContent);
                                            uploadedFiles.push(finalName);
                                            console.log(`File saved: ${finalName}`);
                                        } catch (error) {
                                            console.error(`Error saving file ${finalName}:`, error);
                                            hasErrors = true;
                                        }
                                    }
                                }
                            }
                        }
                    }

                    setCorsHeaders(res);
                    if (uploadedFiles.length > 0) {
                        const message = uploadedFiles.length === 1
                            ? `File uploaded: ${uploadedFiles[0]}`
                            : `${uploadedFiles.length} files uploaded: ${uploadedFiles.join(', ')}`;
                        res.redirect(`${baseRoutePath}/?success=` + encodeURIComponent(message));
                    } else if (hasErrors) {
                        res.redirect(`${baseRoutePath}/?error=${encodeURIComponent('Some files failed to upload')}`);
                    } else {
                        res.redirect(`${baseRoutePath}/?error=${encodeURIComponent('No valid files found')}`);
                    }
                } catch (error) {
                    console.error('Error processing upload:', error);
                    res.redirect(`${baseRoutePath}/?error=${encodeURIComponent('Upload processing failed')}`);
                }
            });

            req.on('error', (error) => {
                console.error('Upload request error:', error);
                res.redirect(`${baseRoutePath}/?error=${encodeURIComponent('Upload request failed')}`);
            });
        } else {
            res.redirect(`${baseRoutePath}/?error=${encodeURIComponent('Invalid Content-Type')}`);
        }
    });

    app.delete(`${baseRoutePath}/:filename`, (req, res) => {
        const filename = req.params.filename;

        // Basic filename validation
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
