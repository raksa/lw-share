#!/usr/bin/env node

import { createServer } from 'node:net';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import qrCode from 'qrcode-terminal';
import {
    init as initApp, httpServer, getUrlList, myConsole, getRandomPort,
} from './src/index.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
    const packageJson = JSON.parse(readFileSync(join(__dirname, 'package.json')));
    const commander = await import('commander');
    const defaultDir = './share';
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
        port = await getRandomPort();
        if (!port) {
            console.error('Error: Unable to get an available port.');
            process.exit(1);
        }
    }

    myConsole.log('Starting lw-share...');
    initApp(dir, port);
    httpServer.on('listening', () => {
        const addr = httpServer.address();
        if (typeof addr === 'string') {
            myConsole.log(`Listening on pipe ${addr}`);
        } else {
            myConsole.log('Listening on:');
            const urls = getUrlList(port);
            urls.forEach((url) => {
                myConsole.log('-------------------');
                myConsole.log('\n', url, '\n');
                qrCode.generate(url, { small: true }, (printable) => {
                    myConsole.log(printable);
                });
            });
        }
    });
    httpServer.listen(port);
}

main();