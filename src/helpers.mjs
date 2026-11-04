"use strict";

import { existsSync, statSync, readdir } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { networkInterfaces } from 'node:os';
import { image as qrGenQRImage } from "qr-image";
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

// Host-side adapters of virtual machines and containers (Hyper-V/WSL, VirtualBox,
// VMware, Parallels, Docker). Windows may give them plain names like "Ethernet",
// so the MAC vendor prefix is checked as well as the name.
const VIRTUAL_MAC_PREFIXES = [
    '00:15:5d', '0a:00:27', '08:00:27', '00:50:56', '00:0c:29', '00:05:69',
    '00:1c:14', '00:1c:42', '02:42:',
];
const VIRTUAL_INTERFACE_NAME = /^(vEthernet|VirtualBox|VMware|vmnet|vboxnet|docker|br-|veth|virbr|lxc|lxd)/i;

function isVirtualInterface(interfaceName, mac) {
    const lowerMac = (mac || '').toLowerCase();
    return VIRTUAL_INTERFACE_NAME.test(interfaceName)
        || VIRTUAL_MAC_PREFIXES.some((prefix) => lowerMac.startsWith(prefix));
}

function getUrlInfoList(port, pathname) {
    const interfaces = networkInterfaces();
    const urlInfoList = [];
    for (const [interfaceName, interfaceInfo] of Object.entries(interfaces)) {
        for (const address of interfaceInfo || []) {
            if (address.family === 'IPv4') {
                urlInfoList.push({
                    address: `http://${address.address}:${port}${pathname || ''}`,
                    interfaceName,
                    internal: address.internal,
                    virtual: isVirtualInterface(interfaceName, address.mac),
                });
            }
        }
    }
    return urlInfoList;
}

export function getUrlList(port, pathname) {
    return getUrlInfoList(port, pathname).map(({ address }) => address);
}

function base64EncodeStream(readableStream) {
    return new Promise((resolve, reject) => {
        let chunks = [];
        readableStream.on('data', (chunk) => {
            chunks.push(chunk);
        });
        readableStream.on('end', () => {
            const buffer = Buffer.concat(chunks);
            const base64 = buffer.toString('base64');
            resolve(`data:image/png;base64,${base64}`);
        });
        readableStream.on('error', (err) => {
            reject(err);
        });
    });
}
export function genQRImage(text, options) {
    const readableStream = qrGenQRImage(text, options);
    return base64EncodeStream(readableStream);
}

export function getAddressesWithQR(port, pathname) {
    const urlInfoList = getUrlInfoList(port, pathname);
    const qrPromises = urlInfoList.map((urlInfo) => {
        return genQRImage(urlInfo.address, { type: 'png' }).then((dataUrl) => {
            return {
                ...urlInfo,
                qrCode: dataUrl
            };
        });
    });
    return Promise.all(qrPromises);
}

export function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,contenttype');
    res.setHeader('Access-Control-Allow-Credentials', true);
}

export function checkIsValidFile(baseDir, fileFullName) {
    if (fileFullName.startsWith('.')) {
        return false;
    }
    const filePath = resolve(baseDir, fileFullName);
    if (!existsSync(filePath)) {
        return false;
    }
    const stats = statSync(filePath);
    return stats.isFile();
}

export function listFiles(targetPath) {
    return new Promise((resolve) => {
        readdir(targetPath, (err, contents) => {
            if (err || contents === null) {
                resolve([]);
            } else {
                resolve(contents.filter((fileName) => {
                    return checkIsValidFile(targetPath, fileName);
                }));
            }
        })
    });
}

export function listFilesWithStats(targetPath) {
    return listFiles(targetPath).then((fileNames) => {
        const files = [];
        for (const name of fileNames) {
            try {
                const stats = statSync(resolve(targetPath, name));
                files.push({ name, size: stats.size, mtime: stats.mtimeMs });
            } catch {
                // The file was removed between listing and stat; skip it.
            }
        }
        return files;
    });
}

const __dirname = dirname(fileURLToPath(import.meta.url));
export function getDirPath(targetPath) {
    return resolve(__dirname, '..', targetPath);
}

export function getRandomPort() {
    return new Promise((resolve) => {
        const tempServer = createServer((sock) => {
            sock.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK');
        });
        tempServer.listen(0, () => {
            const port = tempServer.address().port;
            tempServer.close();
            resolve(port);
        });
    });
}