"use strict";

import { createServer } from 'node:http';
import express from 'express';

import { init as initHttpApp } from './httpApp.mjs';
import { init as initFileApp } from './fileApp.mjs';
import { init as initChatApp } from './chatApp.mjs';
import { init as initQRCoder } from './qrCoder.mjs';
import { getDirPath } from './helpers.mjs';
import { myConsole } from './consoleHelpers.mjs';

export const app = express();
export const httpServer = createServer(app);

export async function init(filesStorePath, port) {
    app.set('port', port);

    const option = {
        app,
        httpServer,
        filesStorePath,
        publicPath: getDirPath('public')
    }
    initFileApp(option);
    initChatApp(option);
    initQRCoder(option);
    initHttpApp(option);

    return () => {
        httpServer.on('listening', function onListening() {
            const addr = httpServer.address();

            if (typeof addr === 'string') {
                myConsole.log(`Listening on pipe ${addr}`);
            } else {
                fileShare.addresses.forEach((address) => {
                    const url = `http://${address}:${addr.port}`;
                    myConsole.log(`Listening on ${url}`);
                });
            }
        });
        httpServer.listen(app.get('port'));
    }
}

export * from './helpers.mjs';
export * from './consoleHelpers.mjs';
export * as qrCode from 'qrcode-terminal';