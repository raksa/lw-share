"use strict";

import { unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import express from 'express';

import { setCorsHeaders, checkIsValidFile } from './helpers.mjs';

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
            let fileData = Buffer.from('');
            req.on('data', (chunk) => {
                fileData = Buffer.concat([fileData, chunk]);
            });
            req.on('end', () => {
                const parts = fileData.toString().split(`--${boundary}`);
                let finalName = 'uploaded_file';
                for (const part of parts) {
                    if (part.includes('filename=')) {
                        const filenameMatch = part.match(/filename="([^"]+)"/);
                        if (filenameMatch && filenameMatch[1]) {
                            finalName = filenameMatch[1];
                        }
                        const contentStart = part.indexOf('\r\n\r\n') + 4;
                        const fileContent = part.substring(contentStart, part.lastIndexOf('\r\n'));

                        const filePath = resolve(filesStorePath, finalName);
                        if (checkIsValidFile(filesStorePath, finalName)) {
                            unlinkSync(filePath);
                        }
                        writeFileSync(filePath, Buffer.from(fileContent, 'binary'));
                        console.log(`File saved: ${finalName}`);
                    }
                }
                setCorsHeaders(res);
                res.redirect(`${baseRoutePath}/?success=` + encodeURIComponent(finalName));
            });
        } else {
            res.redirect(`${baseRoutePath}/?error=${encodeURIComponent('Invalid Content-Type')}`);
        }
    });

    app.delete(`${baseRoutePath}/:filename`, (req, res) => {
        const filename = req.params.filename
        const filePath = resolve(filesStorePath, filename);
        console.log(`Deleting file: ${filePath}`);
        try {
            if (!checkIsValidFile(filesStorePath, filename)) {
                res.status(404).send('File not found or invalid filename');
                return;
            }
            unlinkSync(filePath)
            setCorsHeaders(res);
            res.status(200)
            console.log(`File deleted: ${filePath}`);
        } catch (err) {
            console.error(`Error deleting file: ${filePath}`, err);
            res.status(500).send('Error deleting file');
        }
    });

    app.get(`${baseRoutePath}/files/info`, (_req, res) => {
        setCorsHeaders(res);
        listFiles(filesStorePath).then((filePaths) => {
            res.json({
                "fileList": filePaths
            });
        });
    });

};
