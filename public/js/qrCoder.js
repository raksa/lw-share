"use strict";

async function submitForm(event) {
    event.preventDefault();
    const text = document.getElementById('text').value;
    const size = document.getElementById('size').value;
    if (!text) {
        alert('Please enter text for the QR code.');
        return;
    }
    const request = new XMLHttpRequest()
    request.open('POST', event.target.parentElement.action, true)
    request.setRequestHeader('Content-Type', 'application/json');
    request.send(JSON.stringify({ text, size }));
    const { qrCode } = await new Promise((resolve, reject) => {
        request.onload = function () {
            if (request.status >= 200 && request.status < 300) {
                try {
                    const response = JSON.parse(request.responseText);
                    resolve(response);
                } catch (error) {
                    reject('Error parsing QR code response');
                }
            } else {
                reject('Error generating QR code');
            }
        };
        request.onerror = function () {
            reject('Network error');
        };
    });
    const qrImage = document.getElementById('qrImage');
    qrImage.src = qrCode;
    qrImage.style.display = 'block';
}