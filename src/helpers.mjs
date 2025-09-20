"use strict";

import { existsSync, statSync, readdir } from 'node:fs';
import { resolve } from 'node:path';
import { networkInterfaces } from 'node:os';
import { image as qrGenQRImage } from "qr-image";

export function getUrlList(port, pathname) {
    var interfaces = networkInterfaces();
    const urlList = [];
    for (const interfaceInfo of Object.values(interfaces)) {
        for (const address of Object.values(interfaceInfo)) {
            if (address.family === 'IPv4') {
                urlList.push(`http://${address.address}:${port}${pathname || ''}`);
            }
        }
    }
    return urlList;
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
    const addresses = getUrlList(port, pathname);
    const qrPromises = addresses.map((address) => {
        return genQRImage(address, { type: 'png' }).then((dataUrl) => {
            return {
                address: address,
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