"use strict";

import express from 'express';
import { resolve } from 'node:path';
import { getAddressesWithQR, setCorsHeaders, listFilesWithStats } from './helpers.mjs';

export function init({ app, filesStorePath, publicPath }) {

    app.use(express.static(publicPath));

    const baseRoutePath = '/info';

    app.get(`${baseRoutePath}/files`, (_req, res) => {
        setCorsHeaders(res);
        listFilesWithStats(filesStorePath).then((files) => {
            res.json({
                "fileList": files.map(({ name }) => name),
                files,
            });
        });
    });

    app.get(`${baseRoutePath}/addresses`, (req, res) => {
        const { pathname } = req.query;
        setCorsHeaders(res);
        getAddressesWithQR(app.get('port'), pathname).then((addressesWithQRList) => {
            res.json({
                addressesWithQRList
            });
        });
    });

    app.use((_req, _res, next) => {
        const err = new Error('Not Found');
        err.status = 404;
        next(err);
    });

    app.use((err, _req, res, _next) => {
        if (err.status == 404) {
            const filePath = resolve(publicPath, 'index.html');
            console.log(filePath);
            res.sendFile(filePath, { dotfiles: 'allow' });
        } else {
            res.sendStatus(500);
        }
    });

};
