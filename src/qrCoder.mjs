"use strict";

import { resolve } from 'node:path';
import { genQRImage, setCorsHeaders } from './helpers.mjs';

export function init({ app, publicPath }) {
    const baseRoutePath = '/qrCoder'

    app.get(`${baseRoutePath}/`, (_req, res) => {
        const filePath = resolve(publicPath, 'qrCoder.html');
        console.log(filePath);
        res.sendFile(filePath, { dotfiles: 'allow' });
    });

    const readBody = (req) => {
        return new Promise((resolve, reject) => {
            const body = [];
            req.on('data', (chunk) => {
                body.push(chunk);
            }).on('end', () => {
                try {
                    const parsedBody = JSON.parse(Buffer.concat(body).toString());
                    resolve(parsedBody);
                } catch (err) {
                    reject('Invalid JSON');
                }
            });
        });
    };

    app.post(`${baseRoutePath}/`, async (req, res) => {
        const contentType = req.headers['content-type'];
        if (!contentType || !contentType.includes('application/json')) {
            res.status(400).json({
                error: 'Invalid content type, expected application/json'
            });
            return;
        }
        try {
            const body = await readBody(req);
            const text = body.text;
            let size = parseInt(body.size || '500');
            size = isNaN(size) || size <= 0 ? 500 : size;
            size = Math.ceil(size / 29)
            const dataUrl = await genQRImage(text, { type: 'png', size });
            setCorsHeaders(res);
            res.setHeader('Content-Type', 'application/json');
            res.json({ qrCode: dataUrl });
        } catch (error) {
            return res.status(400).json({ error });
        }
    });

};
