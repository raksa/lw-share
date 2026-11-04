"use strict";

(() => {
    const { copyWithToast } = LWShare;

    const form = document.getElementById('qrForm');
    const textInput = document.getElementById('text');
    const textError = document.getElementById('textError');
    const charCount = document.getElementById('charCount');
    const result = document.getElementById('qrResult');
    const qrImage = document.getElementById('qrImage');
    const downloadLink = document.getElementById('downloadQr');
    const copyButton = document.getElementById('copyQrText');

    let latestRequest = 0;
    let debounceTimer = null;

    function selectedSize() {
        return form.querySelector('input[name="size"]:checked')?.value || '500';
    }

    function fileNameFor(text) {
        const slug = text.trim().toLowerCase()
            .replace(/^https?:\/\//, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 40);
        return `qr-${slug || 'code'}.png`;
    }

    function showError(message) {
        textError.textContent = message;
        textInput.classList.add('is-invalid');
    }

    function clearError() {
        textInput.classList.remove('is-invalid');
    }

    function updateCharCount() {
        const length = textInput.value.length;
        charCount.textContent = length ? `${length} / ${textInput.maxLength}` : '';
    }

    async function generate() {
        const text = textInput.value;
        if (!text.trim()) {
            latestRequest++;
            clearError();
            result.dataset.state = 'empty';
            result.classList.remove('is-loading');
            return;
        }

        // Typing fires many requests; only the newest answer may update the page.
        const requestId = ++latestRequest;
        result.classList.add('is-loading');
        try {
            const response = await fetch('/qrCoder/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, size: selectedSize() }),
            });
            if (!response.ok) {
                throw new Error(response.status === 400
                    ? 'Could not make a QR code from this text. It may be too long.'
                    : `The server returned an error (HTTP ${response.status}).`);
            }
            const { qrCode } = await response.json();
            if (requestId !== latestRequest) {
                return;
            }
            qrImage.src = qrCode;
            qrImage.alt = `QR code for: ${text.length > 80 ? text.slice(0, 80) + '…' : text}`;
            downloadLink.href = qrCode;
            downloadLink.download = fileNameFor(text);
            result.dataset.state = 'ready';
            clearError();
        } catch (error) {
            if (requestId !== latestRequest) {
                return;
            }
            // Don't leave an older code on screen that no longer matches the text.
            result.dataset.state = 'empty';
            showError(error instanceof TypeError
                ? 'Cannot reach lw-share. Is the server still running?'
                : error.message);
        } finally {
            if (requestId === latestRequest) {
                result.classList.remove('is-loading');
            }
        }
    }

    textInput.addEventListener('input', () => {
        updateCharCount();
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(generate, 300);
    });

    form.addEventListener('change', (event) => {
        if (event.target.name === 'size') {
            generate();
        }
    });

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        generate();
    });

    copyButton.addEventListener('click', () => copyWithToast(textInput.value, 'Text copied'));

    // Restore after a reload or back navigation, when the browser keeps the text.
    updateCharCount();
    if (textInput.value.trim()) {
        generate();
    }
})();
