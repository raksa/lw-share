"use strict";

import { resolve } from 'node:path';
import { createServer } from 'node:http';
import express from 'express';

import { init as initHttpApp } from './httpApp.mjs';
import { init as initFileApp } from './fileApp.mjs';
import { init as initChatApp } from './chatApp.mjs';

export const app = express();
export const httpServer = createServer(app);

export function init(filesStorePath, port) {
    app.set('port', port);

    const option = {
        app,
        httpServer,
        filesStorePath,
        publicPath: resolve('public')
    }
    initFileApp(option);
    initChatApp(option);
    initHttpApp(option);

    return () => {
        httpServer.on('listening', function onListening() {
            const addr = httpServer.address();

            if (typeof addr === 'string') {
                console.log(`Listening on pipe ${addr}`);
            } else {
                fileShare.addresses.forEach((address) => {
                    const url = `http://${address}:${addr.port}`;
                    console.log(`Listening on ${url}`);
                });
            }
        });
        httpServer.listen(app.get('port'));
    }
}
