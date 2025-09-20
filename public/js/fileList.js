"use strict";

function updateFileList({ fileList }) {
    const fileListContainer = document.getElementById('fileList');
    if (!fileListContainer) {
        return false;
    };
    fileListContainer.innerHTML = fileList.map((fileName) => {
        return `
        <li class="list-group-item d-flex justify-content-between align-items-center">
            <a target="_blank" href="/files/${fileName}"
                class="btn flex-grow-1">${fileName}</a>
            <button class="btn btn-danger btn-sm mx-2"
                onclick="deleteFile('${fileName}')"
                style="cursor:pointer;">&times;</button>
        </li>`;
    }).join('');
    return true;
}

function getFileList() {
    function logError(...args) {
        console.log(...args);
    }

    const request = new XMLHttpRequest();
    request.open('GET', '/info/files', true);
    request.onload = function () {
        if (request.status >= 200 && request.status < 400) {
            const resp = request.responseText;
            const data = JSON.parse(resp);
            if (!updateFileList(data)) {
                logError('Failed to update address');
            }
        } else {
            logError('Getting QR error, status code: ' + request.status);
        }
    };
    request.onerror = function (err) {
        logError('Getting QR error: ', err);
    };
    request.send();
}

getFileList();
setInterval(getFileList, 2000);
