#!/usr/bin/env node

import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import qrCode from 'qrcode-terminal';
import { getUrlList } from './src/helpers.mjs';


async function main() {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve('./package.json')));
    const commander = await import('commander');
    const defaultDir = './share';
    const command = commander.program
        .version(packageJson.version)
        .option('-D, --dir <dir>', `Target directory to share (default: ${defaultDir})`)
        .option('-P, --port <port>', 'Port for server to run on (default: will pick an available port)')
        .parse(process.argv);
    let dir = command.getOptionValue('dir');
    if (!dir) {
        console.log(`No directory specified, using default: ${defaultDir}`);
        dir = path.resolve(defaultDir);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    } else {
        dir = path.resolve(dir);
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
            console.error('Error: Invalid directory to share.');
            process.exit(1);
        }
    }

    let port = command.getOptionValue('port');
    if (port) {
        port = parseInt(port);
        if (isNaN(port) || port <= 0 || port >= 65536) {
            console.error('Error: Invalid port number.');
            process.exit(1);
        }
    }
    if (!port) {
        console.log('No port specified, picking an available port...');
        const tempServer = net.createServer(function (sock) {
            sock.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK');
        });
        tempServer.listen(0, function () {
            console.log('Listening on port ' + tempServer.address().port);
        });
        port = tempServer.address().port;
        tempServer.close();
    }

    console.log('Starting web-sharing...');
    const { init: initApp, httpServer } = await import('./src/index.mjs');
    initApp(dir, port);
    httpServer.on('listening', function () {
        const addr = httpServer.address();
        if (typeof addr === 'string') {
            console.log(`Listening on pipe ${addr}`);
        } else {
            console.log('Listening on:');
            const urls = getUrlList(port);
            urls.forEach(function (url) {
                console.log('-------------------');
                console.log(url);
                qrCode.generate(url, { small: true }, function (printable) {
                    console.log(printable);
                });
            });
        }
    });
    httpServer.listen(port);
}

main();