"use strict";

function updateAddress({ addressesWithQRList }) {
    const infoContainer = document.getElementById('info');
    if (!infoContainer) {
        return false;
    };
    addressesWithQRList.forEach(({ address, qrCode }) => {
        const div = document.createElement('div');
        div.classList.add(
            'd-flex', 'flex-column', 'align-items-center', 'p-1', 'm-1',
            'alert', 'alert-primary',
        );
        const img = document.createElement('img');
        img.width = 200;
        img.src = qrCode;
        img.alt = address;
        div.appendChild(img);
        const p = document.createElement('p');
        p.innerText = address;
        div.appendChild(p);
        infoContainer.appendChild(div);
    });
    return true;
}

function getAddressesInfo() {
    function logError(...args) {
        console.log(...args);
        console.log("Retrying in 5 seconds...");
        setTimeout(() => {

        }, 5000);
    }

    const request = new XMLHttpRequest();
    request.open('GET', `/info/addresses?pathname=${window.location.pathname}`, true);
    request.onload = function () {
        if (request.status >= 200 && request.status < 400) {
            const resp = request.responseText;
            const data = JSON.parse(resp);
            if (!updateAddress(data)) {
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

getAddressesInfo();
