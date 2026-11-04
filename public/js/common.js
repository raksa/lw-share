"use strict";

// Shared helpers for every lw-share page: icons, clipboard, toasts and the
// "Open on another device" dialog that shows QR codes for the current page.
const LWShare = (() => {
    const ICON_SPRITE = '/img/icons.svg';
    const SVG_NS = 'http://www.w3.org/2000/svg';

    // Follow the OS light/dark preference while the page is open.
    const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
    darkQuery.addEventListener('change', (event) => {
        document.documentElement.setAttribute('data-bs-theme', event.matches ? 'dark' : 'light');
    });

    function icon(name, className = '') {
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', `icon ${className}`.trim());
        svg.setAttribute('aria-hidden', 'true');
        const use = document.createElementNS(SVG_NS, 'use');
        use.setAttribute('href', `${ICON_SPRITE}#${name}`);
        svg.appendChild(use);
        return svg;
    }

    function el(tagName, attributes = {}, ...children) {
        const element = document.createElement(tagName);
        for (const [key, value] of Object.entries(attributes)) {
            if (value === undefined || value === null || value === false) {
                continue;
            }
            if (key === 'className') {
                element.className = value;
            } else if (key === 'text') {
                element.textContent = value;
            } else if (key.startsWith('on') && typeof value === 'function') {
                element.addEventListener(key.substring(2), value);
            } else {
                element.setAttribute(key, value === true ? '' : value);
            }
        }
        element.append(...children.filter((child) => child !== null && child !== undefined));
        return element;
    }

    // navigator.clipboard only exists on secure origins (https, localhost). Devices
    // that reach lw-share over plain http on the LAN need the execCommand fallback.
    async function copyText(text) {
        if (navigator.clipboard && window.isSecureContext) {
            try {
                await navigator.clipboard.writeText(text);
                return true;
            } catch {
                // Fall through to the legacy path.
            }
        }
        const previousFocus = document.activeElement;
        const textarea = el('textarea', { readonly: true, 'aria-hidden': 'true' });
        textarea.value = text;
        Object.assign(textarea.style, { position: 'fixed', top: '0', left: '0', opacity: '0' });
        document.body.appendChild(textarea);
        textarea.select();
        textarea.setSelectionRange(0, text.length);
        let copied = false;
        try {
            copied = document.execCommand('copy');
        } catch {
            copied = false;
        }
        textarea.remove();
        if (previousFocus instanceof HTMLElement) {
            previousFocus.focus({ preventScroll: true });
        }
        return copied;
    }

    let toastStack = null;
    function toast(message, type = 'info', duration = 3000) {
        if (!toastStack) {
            toastStack = el('div', { className: 'toast-stack', role: 'status', 'aria-live': 'polite' });
            document.body.appendChild(toastStack);
        }
        const iconName = { success: 'check', error: 'alert' }[type];
        const item = el('div', { className: `app-toast toast-${type}` },
            iconName ? icon(iconName) : null,
            el('span', { text: message }),
        );
        toastStack.appendChild(item);
        setTimeout(() => {
            item.classList.add('hiding');
            setTimeout(() => item.remove(), 200);
        }, duration);
    }

    async function copyWithToast(text, successMessage = 'Copied to clipboard') {
        const copied = await copyText(text);
        if (copied) {
            toast(successMessage, 'success');
        } else {
            toast('Could not copy. Select the text and copy it manually.', 'error', 4000);
        }
        return copied;
    }

    // ---- Addresses -------------------------------------------------------

    function isPrivateIPv4(ip) {
        const [a, b] = ip.split('.').map(Number);
        return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
    }

    // Rank the server's addresses so the one most likely to work from a phone
    // on the same Wi-Fi comes first. Loopback and link-local addresses can't be
    // reached from another device; host-only adapters (WSL, VirtualBox, Docker)
    // usually can't either.
    function describeAddress(info) {
        const ip = new URL(info.address).hostname;
        const name = info.interfaceName || '';
        if (info.internal || ip.startsWith('127.')) {
            return { rank: 4, note: 'This computer only' };
        }
        if (ip.startsWith('169.254.')) {
            return { rank: 3, note: `${name ? name + ' · ' : ''}link-local, usually not reachable` };
        }
        if (info.virtual) {
            return { rank: 2, note: `${name ? name + ' · ' : ''}virtual machine network` };
        }
        if (isPrivateIPv4(ip)) {
            return { rank: 0, note: name };
        }
        return { rank: 1, note: name };
    }

    function rankAddresses(list) {
        return list
            .map((info, index) => ({ ...info, ...describeAddress(info), index }))
            .sort((a, b) => a.rank - b.rank || a.index - b.index);
    }

    const addressCache = new Map();
    function loadAddresses(pathname = location.pathname) {
        if (!addressCache.has(pathname)) {
            const request = fetch(`/info/addresses?pathname=${encodeURIComponent(pathname)}`)
                .then((response) => {
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }
                    return response.json();
                })
                .then((data) => rankAddresses(data.addressesWithQRList || []));
            request.catch(() => addressCache.delete(pathname));
            addressCache.set(pathname, request);
        }
        return addressCache.get(pathname);
    }

    function copyButton(text, label) {
        return el('button', {
            type: 'button',
            className: 'btn btn-outline-secondary btn-sm btn-icon',
            onclick: () => copyWithToast(text, 'Link copied'),
        }, icon('copy'), label ? el('span', { text: label }) : null);
    }

    // Renders the selected address as a large QR code, with the rest listed
    // underneath so they can be picked instead.
    function renderAddresses(container, addresses, selectedIndex = 0) {
        container.replaceChildren();
        if (addresses.length === 0) {
            container.append(el('p', { className: 'text-secondary mb-0', text: 'No network addresses found.' }));
            return;
        }
        const selected = addresses[selectedIndex];
        container.append(el('div', { className: 'address-main' },
            el('img', {
                className: 'address-qr',
                src: selected.qrCode,
                alt: `QR code for ${selected.address}`,
                width: 220,
                height: 220,
            }),
            el('a', {
                className: 'address-url mt-2',
                href: selected.address,
                text: selected.address,
            }),
            selected.note ? el('span', { className: 'address-note', text: selected.note }) : null,
            el('div', { className: 'mt-2' }, copyButton(selected.address, 'Copy link')),
        ));

        const others = addresses.filter((_, index) => index !== selectedIndex);
        if (others.length === 0) {
            return;
        }
        const otherList = el('div', { className: 'mt-1' });
        others.forEach((info) => {
            const index = addresses.indexOf(info);
            otherList.append(el('div', { className: 'address-row' },
                el('div', { className: 'address-row-text' },
                    el('span', { className: 'address-url', text: info.address }),
                    info.note ? el('span', { className: 'address-note', text: info.note }) : null,
                ),
                el('button', {
                    type: 'button',
                    className: 'btn btn-outline-secondary btn-sm btn-icon',
                    title: 'Show QR code',
                    'aria-label': `Show QR code for ${info.address}`,
                    onclick: () => {
                        renderAddresses(container, addresses, index);
                        container.querySelector('.address-other')?.setAttribute('open', '');
                    },
                }, icon('qr')),
                copyButton(info.address),
            ));
        });
        container.append(el('details', { className: 'address-other' },
            el('summary', { text: `Not working? Try another address (${others.length})` }),
            otherList,
        ));
    }

    async function fillAddresses(container, pathname) {
        container.replaceChildren(el('div', { className: 'text-center text-secondary py-4' },
            el('span', { className: 'spinner-border spinner-border-sm me-2', 'aria-hidden': 'true' }),
            'Loading addresses…',
        ));
        try {
            renderAddresses(container, await loadAddresses(pathname));
        } catch (error) {
            container.replaceChildren(el('div', { className: 'text-danger py-3' },
                `Could not load addresses (${error.message}).`));
        }
    }

    // ---- "Open on another device" dialog ---------------------------------

    let connectDialog = null;
    function openConnectDialog() {
        if (!connectDialog) {
            const body = el('div', { className: 'connect-dialog-body' });
            connectDialog = el('dialog', { className: 'connect-dialog', 'aria-labelledby': 'connect-dialog-title' },
                el('div', { className: 'connect-dialog-header' },
                    el('div', { className: 'flex-grow-1' },
                        el('h2', { id: 'connect-dialog-title', text: 'Open this page on another device' }),
                        el('p', {
                            className: 'text-secondary small mb-0 mt-1',
                            text: 'Scan with the phone camera. Both devices must be on the same network.',
                        }),
                    ),
                    el('button', {
                        type: 'button',
                        className: 'btn-close',
                        'aria-label': 'Close',
                        onclick: () => connectDialog.close(),
                    }),
                ),
                body,
            );
            // Close when the backdrop (outside the dialog box) is clicked.
            connectDialog.addEventListener('click', (event) => {
                if (event.target !== connectDialog) {
                    return;
                }
                const rect = connectDialog.getBoundingClientRect();
                const inside = event.clientX >= rect.left && event.clientX <= rect.right
                    && event.clientY >= rect.top && event.clientY <= rect.bottom;
                if (!inside) {
                    connectDialog.close();
                }
            });
            document.body.appendChild(connectDialog);
            fillAddresses(body, location.pathname);
        }
        connectDialog.showModal();
    }

    document.querySelectorAll('[data-connect]').forEach((button) => {
        button.addEventListener('click', openConnectDialog);
    });

    return { icon, el, copyText, copyWithToast, toast, loadAddresses, fillAddresses, openConnectDialog };
})();
