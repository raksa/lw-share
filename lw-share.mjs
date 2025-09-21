#!/usr/bin/env node

import { createServer } from 'node:net';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import qrCode from 'qrcode-terminal';
import { getUrlList } from './src/helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
    const packageJson = JSON.parse(readFileSync(join(__dirname, 'package.json')));
    const commander = await import('commander');
    const defaultDir = './share';
    // add title and description to commander
    const command = commander.program
        .version(packageJson.version)
        .description(packageJson.description)
        .option('-D, --dir <dir>', `Target directory to share (default: ${defaultDir})`)
        .option('-P, --port <port>', 'Port for server to run on (default: will pick an available port)')
        .parse(process.argv);
    let dir = command.getOptionValue('dir');
    if (!dir) {
        console.log(`No directory specified, using default: ${defaultDir}`);
        dir = resolve(defaultDir);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
    } else {
        dir = resolve(dir);
        if (!existsSync(dir) || !statSync(dir).isDirectory()) {
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
        const tempServer = createServer((sock) => {
            sock.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK');
        });
        tempServer.listen(0, () => {
            console.log('Listening on port ' + tempServer.address().port);
        });
        port = tempServer.address().port;
        tempServer.close();
    }

    console.log('Starting lw-share...');
    const { init: initApp, httpServer } = await import('./src/index.mjs');
    initApp(dir, port);
    httpServer.on('listening', () => {
        const addr = httpServer.address();
        if (typeof addr === 'string') {
            console.log(`Listening on pipe ${addr}`);
        } else {
            console.log('Listening on:');
            const urls = getUrlList(port);
            urls.forEach((url) => {
                console.log('-------------------');
                console.log(url);
                qrCode.generate(url, { small: true }, (printable) => {
                    console.log(printable);
                });
            });
        }
    });
    httpServer.listen(port);
}

main();