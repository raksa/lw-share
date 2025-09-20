"use strict";

import express from 'express';
import { join } from 'node:path';
import { getAddressesWithQR, setCorsHeaders, listFiles } from './helpers.mjs';

export function init({ app, filesStorePath, publicPath }) {

    app.use(express.static(publicPath));

    const baseRoutePath = '/info';

    app.get(`${baseRoutePath}/files`, (_req, res) => {
        setCorsHeaders(res);
        listFiles(filesStorePath).then((filePaths) => {
            res.json({
                "fileList": filePaths
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
            res.sendFile(join(publicPath, 'index.html'));
        } else {
            res.sendStatus(500);
        }
    });

};
