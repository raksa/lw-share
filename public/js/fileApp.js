"use strict";

// Google-Drive-style explorer for the shared folder: folder URLs and
// breadcrumbs, list and grid views, multi-select (click, Ctrl/Shift, drag a
// box, long-press on touch), context menus, drag and drop (upload from the
// desktop, drag items onto folders to move them), new folder, new file, a
// plain text editor, rename, move, delete and an upload queue. Uses the JSON
// API in src/fileApp.mjs.
(() => {
    const { el, icon, toast, copyWithToast } = LWShare;

    const API = '/api/files';
    const ROOT_LABEL = 'Files';
    const REFRESH_INTERVAL = 3000;
    const UPLOAD_CONCURRENCY = 3;
    const LONG_PRESS_MS = 500;
    const DRAG_TYPE = 'application/x-lw-share-items';
    const THUMBNAIL_PATTERN = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i;
    const SORT_LABELS = { name: 'Name', mtime: 'Last modified', size: 'File size' };
    const MAX_EDIT_BYTES = 5 * 1024 * 1024; // MAX_TEXT_BYTES in src/fileStore.mjs
    // Files the editor is not offered for. Anything else may be text; the
    // server refuses what turns out to be binary.
    const NOT_TEXT_EXTENSIONS = new Set([
        'png jpg jpeg gif webp bmp heic heif avif ico tif tiff psd',
        'mp4 mov avi mkv webm m4v wmv 3gp mp3 wav flac aac ogg m4a opus wma',
        'pdf doc docx xls xlsx ppt pptx odt ods odp pages numbers key',
        'zip rar 7z tar gz bz2 xz tgz iso dmg apk jar exe dll so dylib bin class',
        'woff woff2 ttf otf eot sqlite db',
    ].join(' ').split(' '));

    const KINDS = [
        { id: 'image', icon: 'image', pattern: /\.(png|jpe?g|gif|webp|svg|bmp|heic|heif|avif|ico|tiff?)$/i },
        { id: 'video', icon: 'film', pattern: /\.(mp4|mov|avi|mkv|webm|m4v|wmv|3gp)$/i },
        { id: 'audio', icon: 'music', pattern: /\.(mp3|wav|flac|aac|ogg|m4a|opus|wma)$/i },
        { id: 'pdf', icon: 'text', pattern: /\.pdf$/i },
        { id: 'sheet', icon: 'text', pattern: /\.(xlsx?|ods|csv|numbers)$/i },
        { id: 'slides', icon: 'text', pattern: /\.(pptx?|odp|key)$/i },
        { id: 'doc', icon: 'text', pattern: /\.(docx?|odt|rtf|pages|txt|md|log|json|xml|html?)$/i },
        { id: 'archive', icon: 'archive', pattern: /\.(zip|rar|7z|tar|gz|bz2|xz|tgz|iso|dmg|apk)$/i },
    ];
    const FOLDER_KIND = { id: 'folder', icon: 'folder' };
    const OTHER_KIND = { id: 'file', icon: 'file' };

    const $ = (id) => document.getElementById(id);
    const explorer = $('explorer');
    const body = $('explorerBody');
    const itemsEl = $('items');
    const listHeader = $('listHeader');
    const emptyState = $('emptyState');
    const breadcrumbs = $('breadcrumbs');
    const newButton = $('newButton');
    const filterInput = $('filterInput');
    const sortButton = $('sortButton');
    const viewButtons = Array.from(explorer.querySelectorAll('[data-view]'));
    const selectionBar = $('selectionBar');
    const selectionCount = $('selectionCount');
    const folderSummary = $('folderSummary');
    const marquee = $('marquee');
    const dropHint = $('dropHint');
    const fileInput = $('fileInput');
    const folderInput = $('folderInput');

    // ---- Small helpers ------------------------------------------------------

    const joinPath = (...parts) => parts.filter(Boolean).join('/');
    const parentOf = (path) => path.split('/').slice(0, -1).join('/');
    const baseName = (path) => path.split('/').pop();
    const folderLabel = (path) => (path ? baseName(path) : ROOT_LABEL);
    const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');
    const fileUrl = (path) => `/files/${encodePath(path)}`;
    const folderUrl = (path) => (path ? `/files/${encodePath(path)}/` : '/files/');
    const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    const kindOf = (entry) => (entry.type === 'folder'
        ? FOLDER_KIND
        : KINDS.find((kind) => kind.pattern.test(entry.name)) || OTHER_KIND);
    const isEditable = (entry) => entry.type === 'file' && entry.size <= MAX_EDIT_BYTES
        && !(entry.name.includes('.') && NOT_TEXT_EXTENSIONS.has(entry.name.split('.').pop().toLowerCase()));

    function pathFromLocation() {
        const rest = location.pathname.replace(/^\/files\/?/, '');
        try {
            return rest.split('/').filter(Boolean).map(decodeURIComponent).join('/');
        } catch {
            return '';
        }
    }

    function formatBytes(bytes) {
        if (bytes < 1024) {
            return `${bytes} B`;
        }
        const units = ['KB', 'MB', 'GB', 'TB'];
        let value = bytes;
        let unit = -1;
        do {
            value /= 1024;
            unit++;
        } while (value >= 1024 && unit < units.length - 1);
        return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
    }

    function formatDate(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        if (date.toDateString() === now.toDateString()) {
            return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
        }
        return date.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
        });
    }

    // "Untitled folder", else "Untitled folder (1)", ... (case-insensitive, like
    // the server's renaming on Windows and macOS). Files keep their extension
    // last: "Untitled (1).txt".
    function uniqueName(name, takenNames, { isFile = false } = {}) {
        const taken = new Set(Array.from(takenNames, (taken) => taken.toLowerCase()));
        const dot = isFile ? name.lastIndexOf('.') : -1;
        const stem = dot > 0 ? name.slice(0, dot) : name;
        const extension = dot > 0 ? name.slice(dot) : '';
        let candidate = name;
        for (let n = 1; taken.has(candidate.toLowerCase()); n++) {
            candidate = `${stem} (${n})${extension}`;
        }
        return candidate;
    }

    const prefs = {
        get(key, fallback) {
            try {
                return JSON.parse(localStorage.getItem(`lwShare.files.${key}`)) ?? fallback;
            } catch {
                return fallback;
            }
        },
        set(key, value) {
            try {
                localStorage.setItem(`lwShare.files.${key}`, JSON.stringify(value));
            } catch {
                // Storage can be unavailable (private mode); the setting just won't stick.
            }
        },
    };

    // payload: an object is sent as JSON, a string as plain text.
    async function api(method, endpoint, payload) {
        const isText = typeof payload === 'string';
        let response;
        try {
            response = await fetch(`${API}/${endpoint}`, {
                method,
                cache: 'no-store',
                headers: payload === undefined
                    ? undefined
                    : { 'Content-Type': isText ? 'text/plain;charset=UTF-8' : 'application/json' },
                body: payload === undefined || isText ? payload : JSON.stringify(payload),
            });
        } catch {
            throw Object.assign(new Error('Cannot reach lw-share. Is the server still running?'), { offline: true });
        }
        const data = await response.json().catch(() => null);
        if (!response.ok) {
            throw Object.assign(new Error(data?.error || `HTTP ${response.status}`), { status: response.status });
        }
        return data;
    }

    const listFolder = (path) => api('GET', `list?path=${encodeURIComponent(path)}`);

    // ---- State --------------------------------------------------------------

    const savedSort = prefs.get('sort', null);
    const state = {
        path: pathFromLocation(),
        status: 'loading', // 'loading' | 'ready' | 'missing' | 'error'
        errorMessage: '',
        entries: [],
        byName: new Map(),
        signature: '',
        visible: [],
        selected: new Set(),
        anchor: null, // where a Shift+click range starts
        lead: null, // the item arrow keys move from
        filter: '',
        sort: savedSort && SORT_LABELS[savedSort.key] && Math.abs(savedSort.dir) === 1
            ? savedSort
            : { key: 'name', dir: 1 },
        view: prefs.get('view', 'list') === 'grid' ? 'grid' : 'list',
        offline: false,
    };

    let lastPointerType = 'mouse';
    let suppressClick = false;
    let keyboardMode = false;
    const highlight = new Set(); // names to flash as new on their next render

    // A new gesture starts: forget any click suppression left from the last one
    // (long-press or box selection), and stop showing the keyboard focus ring.
    document.addEventListener('pointerdown', (event) => {
        lastPointerType = event.pointerType || 'mouse';
        suppressClick = false;
        keyboardMode = false;
    }, true);

    // ---- Rendering ----------------------------------------------------------

    function compareEntries(a, b) {
        if (a.type !== b.type) {
            return a.type === 'folder' ? -1 : 1;
        }
        const { key, dir } = state.sort;
        let result = 0;
        if (key === 'mtime') {
            result = a.mtime - b.mtime;
        } else if (key === 'size') {
            result = (a.size ?? 0) - (b.size ?? 0);
        }
        return (result || collator.compare(a.name, b.name)) * dir;
    }

    function computeVisible() {
        const query = state.filter.trim().toLowerCase();
        const list = query
            ? state.entries.filter((entry) => entry.name.toLowerCase().includes(query))
            : state.entries.slice();
        return list.sort(compareEntries);
    }

    function moreButton(entry) {
        return el('button', {
            type: 'button',
            className: 'item-more',
            tabindex: '-1',
            title: 'More actions',
            'aria-label': `More actions for ${entry.name}`,
            'data-action': 'more',
        }, icon('more-vertical'));
    }

    function itemIcon(entry, className = '') {
        const kind = kindOf(entry);
        return el('span', { className: `item-icon kind-${kind.id} ${className}`.trim() }, icon(kind.icon));
    }

    function itemAttributes(entry, className) {
        const isFolder = entry.type === 'folder';
        return {
            className: `item ${className}`,
            role: 'option',
            'aria-selected': 'false',
            tabindex: '-1',
            draggable: 'true',
            title: entry.name,
            'aria-label': entry.name,
            'data-name': entry.name,
            'data-drop-path': isFolder ? joinPath(state.path, entry.name) : null,
        };
    }

    function renderRow(entry) {
        const isFolder = entry.type === 'folder';
        const size = isFolder ? '—' : formatBytes(entry.size);
        const modified = formatDate(entry.mtime);
        return el('div', itemAttributes(entry, 'item-row'),
            el('span', { className: 'item-name-cell' },
                itemIcon(entry),
                el('span', { className: 'item-text' },
                    el('span', { className: 'item-name', text: entry.name }),
                    el('span', { className: 'item-meta', text: isFolder ? modified : `${size} · ${modified}` }),
                ),
            ),
            el('span', {
                className: 'item-cell item-modified',
                title: new Date(entry.mtime).toLocaleString(),
                text: modified,
            }),
            el('span', { className: 'item-cell item-size', text: size }),
            moreButton(entry),
        );
    }

    function renderCard(entry) {
        if (entry.type === 'folder') {
            return el('div', itemAttributes(entry, 'item-card item-folder-card'),
                itemIcon(entry),
                el('span', { className: 'item-name', text: entry.name }),
                moreButton(entry),
            );
        }
        const thumb = el('div', { className: 'item-thumb' });
        if (THUMBNAIL_PATTERN.test(entry.name)) {
            thumb.append(el('img', {
                src: `${fileUrl(joinPath(state.path, entry.name))}?v=${entry.mtime}`,
                alt: '',
                loading: 'lazy',
                decoding: 'async',
                draggable: 'false',
                onerror: () => thumb.replaceChildren(itemIcon(entry, 'item-icon-lg')),
            }));
        } else {
            thumb.append(itemIcon(entry, 'item-icon-lg'));
        }
        return el('div', itemAttributes(entry, 'item-card item-file-card'),
            el('div', { className: 'item-card-header' },
                itemIcon(entry),
                el('span', { className: 'item-name', text: entry.name }),
                moreButton(entry),
            ),
            thumb,
        );
    }

    // Item elements are reused while their entry is unchanged, so the 3-second
    // refresh doesn't reload thumbnails or drop hover and focus.
    const itemCache = new Map(); // `${view}|${name}` -> { signature, element }

    function itemElement(entry) {
        const key = `${state.view}|${entry.name}`;
        const signature = `${entry.type}|${entry.size}|${entry.mtime}|${new Date().toDateString()}`;
        const cached = itemCache.get(key);
        if (cached && cached.signature === signature) {
            return cached.element;
        }
        const element = state.view === 'grid' ? renderCard(entry) : renderRow(entry);
        if (highlight.delete(entry.name)) {
            element.classList.add('is-new');
        }
        itemCache.set(key, { signature, element });
        return element;
    }

    const itemElementByName = (name) => itemCache.get(`${state.view}|${name}`)?.element;
    const entryOf = (element) => state.byName.get(element.dataset.name);

    function renderItems() {
        state.visible = computeVisible();
        const visibleNames = new Set(state.visible.map((entry) => entry.name));
        for (const name of state.selected) {
            if (!visibleNames.has(name)) {
                state.selected.delete(name);
            }
        }

        const liveKeys = new Set();
        const elementFor = (entry) => {
            liveKeys.add(`${state.view}|${entry.name}`);
            return itemElement(entry);
        };
        if (state.view === 'grid') {
            const folders = state.visible.filter((entry) => entry.type === 'folder').map(elementFor);
            const files = state.visible.filter((entry) => entry.type === 'file').map(elementFor);
            itemsEl.replaceChildren(
                ...(folders.length ? [
                    el('h2', { className: 'items-section-title', text: 'Folders' }),
                    el('div', { className: 'items-grid', role: 'presentation' }, ...folders),
                ] : []),
                ...(files.length ? [
                    el('h2', { className: 'items-section-title', text: 'Files' }),
                    el('div', { className: 'items-grid', role: 'presentation' }, ...files),
                ] : []),
            );
        } else {
            itemsEl.replaceChildren(...state.visible.map(elementFor));
        }
        for (const key of itemCache.keys()) {
            if (!liveKeys.has(key)) {
                itemCache.delete(key);
            }
        }

        itemsEl.className = `items view-${state.view}`;
        listHeader.hidden = state.view !== 'list' || state.visible.length === 0;
        renderEmptyState();
        renderSelection();
    }

    function renderSelection() {
        for (const element of itemsEl.querySelectorAll('.item')) {
            const name = element.dataset.name;
            const selected = state.selected.has(name);
            element.classList.toggle('is-selected', selected);
            element.setAttribute('aria-selected', String(selected));
            element.classList.toggle('is-lead', keyboardMode && name === state.lead);
        }
        renderSubbar();
    }

    function renderSubbar() {
        const entries = selectedEntries();
        selectionBar.hidden = entries.length === 0;
        folderSummary.hidden = entries.length > 0;
        if (entries.length > 0) {
            const single = entries.length === 1;
            selectionCount.textContent = `${entries.length} selected`;
            selectionBar.querySelector('[data-action="download"]').hidden = !entries.every((e) => e.type === 'file');
            selectionBar.querySelector('[data-action="edit"]').hidden = !single || !isEditable(entries[0]);
            selectionBar.querySelector('[data-action="rename"]').hidden = !single;
            selectionBar.querySelector('[data-action="copy-link"]').hidden = !single;
            return;
        }
        let text = '';
        if (state.status === 'ready') {
            const folders = state.entries.filter((entry) => entry.type === 'folder').length;
            const files = state.entries.length - folders;
            text = [folders && plural(folders, 'folder'), files && plural(files, 'file')]
                .filter(Boolean).join(' · ') || 'Empty folder';
            if (state.filter.trim()) {
                text = `${state.visible.length} of ${plural(state.entries.length, 'item')} match`;
            }
        }
        folderSummary.textContent = text;
    }

    function renderEmptyState() {
        let content = null;
        if (state.status === 'loading') {
            content = [el('div', { className: 'explorer-loading' },
                el('span', { className: 'spinner-border spinner-border-sm me-2', 'aria-hidden': 'true' }),
                'Loading…')];
        } else if (state.status === 'missing') {
            content = [
                el('span', { className: 'explorer-empty-icon' }, icon('folder', 'icon-lg')),
                el('h2', { text: 'This folder does not exist' }),
                el('p', { text: 'It may have been moved, renamed or deleted.' }),
                el('a', { className: 'btn btn-primary btn-sm', href: '/files/', 'data-nav-path': '', text: `Go to ${ROOT_LABEL}` }),
            ];
        } else if (state.status === 'error') {
            content = [
                el('span', { className: 'explorer-empty-icon is-error' }, icon('alert', 'icon-lg')),
                el('h2', { text: 'Could not load this folder' }),
                el('p', { text: state.errorMessage }),
                el('button', { type: 'button', className: 'btn btn-primary btn-sm', text: 'Try again', onclick: () => refresh() }),
            ];
        } else if (state.entries.length === 0) {
            content = [
                el('span', { className: 'explorer-empty-icon' }, icon('upload', 'icon-lg')),
                el('h2', { text: 'Drop files here' }),
                el('p', { text: 'Or use the New button. You can also paste a copied file or screenshot.' }),
            ];
        } else if (state.visible.length === 0) {
            content = [el('p', { text: `No items match “${state.filter.trim()}”.` })];
        }
        emptyState.hidden = !content;
        if (content) {
            emptyState.replaceChildren(...content);
        }
    }

    function renderBreadcrumbs() {
        const segments = state.path ? state.path.split('/') : [];
        const crumbs = [{ label: ROOT_LABEL, path: '' }]
            .concat(segments.map((label, index) => ({ label, path: segments.slice(0, index + 1).join('/') })));
        breadcrumbs.replaceChildren(...crumbs.flatMap((crumb, index) => {
            const isCurrent = index === crumbs.length - 1;
            const label = el('span', { className: 'crumb-label', text: crumb.label });
            const node = isCurrent
                ? el('button', {
                    type: 'button',
                    className: 'crumb crumb-current',
                    'aria-current': 'page',
                    'aria-haspopup': 'menu',
                    title: `${crumb.label}: folder actions`,
                    'data-action': 'folder-menu',
                    'data-drop-path': crumb.path,
                }, label, icon('chevron-down'))
                : el('a', {
                    className: 'crumb',
                    href: folderUrl(crumb.path),
                    title: crumb.label,
                    'data-nav-path': crumb.path,
                    'data-drop-path': crumb.path,
                }, label);
            return index === 0
                ? [node]
                : [el('span', { className: 'crumb-sep', 'aria-hidden': 'true' }, icon('chevron-right')), node];
        }));
        document.title = state.path
            ? `${folderLabel(state.path)} · Files · Local Web Share`
            : 'Files · Local Web Share';
    }

    function renderSortControls() {
        const { key, dir } = state.sort;
        const arrow = dir > 0 ? 'arrow-up' : 'arrow-down';
        sortButton.replaceChildren(icon(arrow), el('span', { className: 'sort-label', text: SORT_LABELS[key] }));
        sortButton.title = `Sorted by ${SORT_LABELS[key].toLowerCase()}, ${dir > 0 ? 'ascending' : 'descending'}`;
        for (const header of listHeader.querySelectorAll('[data-sort]')) {
            const active = header.dataset.sort === key;
            header.parentElement.setAttribute('aria-sort', active ? (dir > 0 ? 'ascending' : 'descending') : 'none');
            header.querySelector('.sort-arrow')?.remove();
            if (active) {
                header.append(icon(arrow, 'sort-arrow'));
            }
        }
        for (const button of viewButtons) {
            button.setAttribute('aria-pressed', String(button.dataset.view === state.view));
        }
    }

    function renderAll() {
        renderSortControls();
        renderItems();
    }

    // ---- Loading and navigation ---------------------------------------------

    let refreshSeq = 0;
    let refreshSoonTimer = null;

    function setOffline(offline) {
        if (offline === state.offline) {
            return;
        }
        state.offline = offline;
        if (offline) {
            toast('Cannot reach lw-share. Is the server still running?', 'error', 5000);
        } else {
            toast('Connection restored', 'success');
        }
    }

    function applyListing(entries) {
        const signature = JSON.stringify(entries);
        const unchanged = state.status === 'ready' && signature === state.signature;
        state.status = 'ready';
        if (unchanged) {
            return;
        }
        state.signature = signature;
        state.entries = entries;
        state.byName = new Map(entries.map((entry) => [entry.name, entry]));
        renderAll();
    }

    async function refresh() {
        const seq = ++refreshSeq;
        try {
            const data = await listFolder(state.path);
            if (seq !== refreshSeq) {
                return; // a newer refresh or a navigation superseded this one
            }
            setOffline(false);
            applyListing(data.entries);
        } catch (error) {
            if (seq !== refreshSeq) {
                return;
            }
            if (error.offline) {
                setOffline(true);
                if (state.status !== 'loading') {
                    return; // keep showing the last listing until the server is back
                }
            }
            state.status = error.status === 404 || error.status === 400 ? 'missing' : 'error';
            state.errorMessage = error.message;
            state.entries = [];
            state.byName = new Map();
            state.signature = '';
            renderAll();
        }
    }

    function refreshSoon() {
        clearTimeout(refreshSoonTimer);
        refreshSoonTimer = setTimeout(refresh, 250);
    }

    function navigate(path, { push = true } = {}) {
        closeMenu();
        if (push) {
            history.pushState({ path }, '', folderUrl(path));
        }
        Object.assign(state, {
            path,
            status: 'loading',
            entries: [],
            byName: new Map(),
            signature: '',
            selected: new Set(),
            anchor: null,
            lead: null,
            filter: '',
        });
        filterInput.value = '';
        itemCache.clear();
        body.dataset.dropPath = path;
        body.scrollTop = 0;
        renderBreadcrumbs();
        renderAll();
        refresh();
    }

    function openEntry(entry) {
        const path = joinPath(state.path, entry.name);
        if (entry.type === 'folder') {
            navigate(path);
        } else {
            window.open(fileUrl(path), '_blank', 'noopener');
        }
    }

    // ---- Selection ----------------------------------------------------------

    const selectedEntries = () => state.visible.filter((entry) => state.selected.has(entry.name));

    function setSelection(names, { anchor = state.anchor, lead = state.lead } = {}) {
        state.selected = new Set(names);
        state.anchor = anchor;
        state.lead = lead;
        renderSelection();
    }

    const selectOnly = (name) => setSelection([name], { anchor: name, lead: name });
    const clearSelection = () => setSelection([], { anchor: null, lead: null });

    function toggleSelected(name) {
        const next = new Set(state.selected);
        if (!next.delete(name)) {
            next.add(name);
        }
        setSelection(next, { anchor: name, lead: name });
    }

    function selectRange(name, additive) {
        const order = state.visible.map((entry) => entry.name);
        const from = order.indexOf(state.anchor);
        const to = order.indexOf(name);
        if (from === -1 || to === -1) {
            selectOnly(name);
            return;
        }
        const range = order.slice(Math.min(from, to), Math.max(from, to) + 1);
        setSelection(additive ? [...state.selected, ...range] : range, { lead: name });
    }

    function focusItem(name) {
        const element = itemElementByName(name);
        if (element) {
            element.focus({ preventScroll: true });
            element.scrollIntoView({ block: 'nearest' });
        }
    }

    function gridColumns() {
        const grid = itemsEl.querySelector('.items-grid');
        return grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 1;
    }

    function moveLead(event) {
        const order = state.visible;
        const isGrid = state.view === 'grid';
        if (order.length === 0 || (!isGrid && (event.key === 'ArrowLeft' || event.key === 'ArrowRight'))) {
            return;
        }
        event.preventDefault();
        keyboardMode = true;
        const index = order.findIndex((entry) => entry.name === state.lead);
        const step = { ArrowDown: isGrid ? gridColumns() : 1, ArrowUp: isGrid ? -gridColumns() : -1, ArrowRight: 1, ArrowLeft: -1 }[event.key];
        let next;
        if (event.key === 'Home') {
            next = 0;
        } else if (event.key === 'End') {
            next = order.length - 1;
        } else {
            next = index === -1 ? 0 : index + step;
        }
        const name = order[Math.max(0, Math.min(order.length - 1, next))].name;
        if (event.shiftKey && state.anchor !== null) {
            selectRange(name, false);
        } else {
            selectOnly(name);
        }
        focusItem(name);
    }

    // ---- Menus --------------------------------------------------------------

    let menuState = null;

    function closeMenu({ restoreFocus = false } = {}) {
        if (!menuState) {
            return;
        }
        const { menu, previousFocus } = menuState;
        menuState = null;
        menu.remove();
        if (restoreFocus && previousFocus instanceof HTMLElement && previousFocus.isConnected) {
            previousFocus.focus({ preventScroll: true });
        }
    }

    // items: [{ label, icon, action, hint, danger, disabled }] or '-' for a separator.
    // Opens at { x, y }, or below { anchor } aligned to its start or end edge.
    function openMenu(items, { x, y, anchor, align = 'end' }) {
        closeMenu();
        const menu = el('div', { className: 'context-menu', role: 'menu' });
        for (const item of items) {
            if (item === '-') {
                if (menu.lastChild && !menu.lastChild.classList.contains('context-menu-sep')) {
                    menu.append(el('div', { className: 'context-menu-sep', role: 'separator' }));
                }
                continue;
            }
            menu.append(el('button', {
                type: 'button',
                role: 'menuitem',
                className: `context-menu-item${item.danger ? ' is-danger' : ''}`,
                disabled: item.disabled,
                onclick: () => {
                    closeMenu();
                    item.action(); // synchronously: file pickers need the click's user gesture
                },
            },
            item.icon ? icon(item.icon) : el('span', { className: 'icon' }),
            el('span', { className: 'context-menu-label', text: item.label }),
            item.hint ? el('kbd', { text: item.hint }) : null));
        }
        if (menu.lastChild?.classList.contains('context-menu-sep')) {
            menu.lastChild.remove();
        }
        document.body.append(menu);

        const { width, height } = menu.getBoundingClientRect();
        const margin = 8;
        let left = x;
        let top = y;
        if (anchor) {
            const rect = anchor.getBoundingClientRect();
            left = align === 'start' ? rect.left : rect.right - width;
            top = rect.bottom + 4;
            if (top + height > innerHeight - margin) {
                top = rect.top - height - 4;
            }
        } else if (left + width > innerWidth - margin) {
            left = left - width;
        }
        menu.style.left = `${Math.max(margin, Math.min(left, innerWidth - width - margin))}px`;
        menu.style.top = `${Math.max(margin, Math.min(top, innerHeight - height - margin))}px`;

        menuState = { menu, previousFocus: document.activeElement };
        menu.querySelector('.context-menu-item:not(:disabled)')?.focus({ preventScroll: true });
    }

    function handleMenuKey(event) {
        const buttons = Array.from(menuState.menu.querySelectorAll('.context-menu-item:not(:disabled)'));
        const index = buttons.indexOf(document.activeElement);
        if (event.key === 'Escape' || event.key === 'Tab') {
            event.preventDefault();
            closeMenu({ restoreFocus: true });
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            buttons[(index + step + buttons.length) % buttons.length]?.focus();
        } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            buttons[event.key === 'Home' ? 0 : buttons.length - 1]?.focus();
        }
    }

    document.addEventListener('pointerdown', (event) => {
        if (menuState && !menuState.menu.contains(event.target)) {
            closeMenu();
        }
    });
    window.addEventListener('resize', () => closeMenu());
    window.addEventListener('blur', () => closeMenu());
    body.addEventListener('scroll', () => closeMenu(), { passive: true });

    const canPickFolders = 'webkitdirectory' in document.createElement('input');

    function folderMenu() {
        const ready = state.status === 'ready';
        return [
            { label: 'New folder', icon: 'folder-plus', disabled: !ready, action: () => createFolder() },
            { label: 'New file', icon: 'file-plus', disabled: !ready, action: () => createFile() },
            '-',
            { label: 'File upload', icon: 'upload', disabled: !ready, action: () => pickFiles(fileInput) },
            canPickFolders && {
                label: 'Folder upload', icon: 'folder-upload', disabled: !ready, action: () => pickFiles(folderInput),
            },
        ].filter(Boolean);
    }

    function itemMenu(entries) {
        const single = entries.length === 1 ? entries[0] : null;
        const allFiles = entries.every((entry) => entry.type === 'file');
        return [
            single && {
                label: 'Open',
                icon: single.type === 'folder' ? 'folder' : 'external-link',
                hint: 'Enter',
                action: () => openEntry(single),
            },
            single && isEditable(single) && {
                label: 'Edit',
                icon: 'file-edit',
                action: () => editFile(joinPath(state.path, single.name)),
            },
            allFiles && {
                label: single ? 'Download' : `Download ${entries.length} files`,
                icon: 'download',
                action: () => downloadEntries(entries),
            },
            single && { label: 'Copy link', icon: 'link', action: () => copyLink(single) },
            '-',
            single && { label: 'Rename', icon: 'edit', hint: 'F2', action: () => renameEntry(single) },
            { label: 'Move to…', icon: 'folder-move', action: () => moveEntries(entries) },
            '-',
            { label: 'Delete', icon: 'trash', hint: 'Del', danger: true, action: () => deleteEntries(entries) },
        ].filter(Boolean);
    }

    function sortMenu() {
        return Object.entries(SORT_LABELS).map(([key, label]) => ({
            label,
            icon: state.sort.key === key ? (state.sort.dir > 0 ? 'arrow-up' : 'arrow-down') : null,
            action: () => setSort(key),
        }));
    }

    function setSort(key) {
        state.sort = state.sort.key === key
            ? { key, dir: -state.sort.dir }
            : { key, dir: key === 'name' ? 1 : -1 }; // newest and largest first
        prefs.set('sort', state.sort);
        renderAll();
    }

    function setView(view) {
        if (view === state.view) {
            return;
        }
        state.view = view;
        prefs.set('view', view);
        renderAll();
    }

    // ---- Dialogs ------------------------------------------------------------

    function showDialog(dialog, onClose, { closeOnBackdrop = true } = {}) {
        // Close when the backdrop (outside the dialog box) is clicked. The press
        // must start there too: a text selection dragged out of the box ends
        // with a click on the dialog element.
        const onBackdrop = (event) => {
            if (event.target !== dialog) {
                return false;
            }
            const rect = dialog.getBoundingClientRect();
            return event.clientX < rect.left || event.clientX > rect.right
                || event.clientY < rect.top || event.clientY > rect.bottom;
        };
        let pressedBackdrop = false;
        dialog.addEventListener('pointerdown', (event) => {
            pressedBackdrop = onBackdrop(event);
        });
        dialog.addEventListener('click', (event) => {
            if (closeOnBackdrop && pressedBackdrop && onBackdrop(event)) {
                dialog.close();
            }
        });
        dialog.addEventListener('close', () => {
            dialog.remove();
            onClose();
        });
        document.body.append(dialog);
        dialog.showModal();
    }

    // Asks for a name. onSubmit(name) does the work; if it throws, the error is
    // shown in the dialog so the name can be fixed. Resolves to the name or null.
    function promptDialog({ title, label, value, okLabel, hint = '', selectStem = false, onSubmit }) {
        return new Promise((resolve) => {
            let result = null;
            const hintId = `hint-${Date.now()}`;
            const input = el('input', {
                type: 'text',
                className: 'form-control',
                'aria-label': label,
                'aria-describedby': hint ? hintId : null,
                autocomplete: 'off',
                spellcheck: 'false',
            });
            input.value = value;
            const error = el('div', { className: 'invalid-feedback', role: 'alert' });
            const okButton = el('button', { type: 'submit', className: 'btn btn-primary', text: okLabel });
            const form = el('form', { className: 'explorer-dialog-form', novalidate: true },
                el('h2', { className: 'explorer-dialog-title', text: title }),
                input,
                error,
                hint ? el('div', { className: 'form-text', id: hintId, text: hint }) : null,
                el('div', { className: 'explorer-dialog-actions' },
                    el('button', { type: 'button', className: 'btn btn-outline-secondary', text: 'Cancel', onclick: () => dialog.close() }),
                    okButton,
                ),
            );
            const dialog = el('dialog', { className: 'explorer-dialog' }, form);

            const showError = (message) => {
                error.textContent = message;
                input.classList.add('is-invalid');
                input.focus();
            };
            input.addEventListener('input', () => input.classList.remove('is-invalid'));
            form.addEventListener('submit', async (event) => {
                event.preventDefault();
                const name = input.value.trim();
                if (!name) {
                    showError('Enter a name.');
                    return;
                }
                okButton.disabled = true;
                try {
                    await onSubmit(name);
                    result = name;
                    dialog.close();
                } catch (submitError) {
                    showError(submitError.message);
                } finally {
                    okButton.disabled = false;
                }
            });

            showDialog(dialog, () => resolve(result));
            input.focus();
            const dot = value.lastIndexOf('.');
            input.setSelectionRange(0, selectStem && dot > 0 ? dot : value.length);
        });
    }

    function confirmDialog({ title, message, okLabel, danger = false }) {
        return new Promise((resolve) => {
            let confirmed = false;
            const okButton = el('button', {
                type: 'button',
                className: `btn ${danger ? 'btn-danger' : 'btn-primary'}`,
                text: okLabel,
                onclick: () => {
                    confirmed = true;
                    dialog.close();
                },
            });
            const cancelButton = el('button', {
                type: 'button',
                className: 'btn btn-outline-secondary',
                text: 'Cancel',
                onclick: () => dialog.close(),
            });
            const dialog = el('dialog', { className: 'explorer-dialog', role: 'alertdialog' },
                el('h2', { className: 'explorer-dialog-title', text: title }),
                el('p', { className: 'explorer-dialog-message', text: message }),
                el('div', { className: 'explorer-dialog-actions' }, cancelButton, okButton),
            );
            showDialog(dialog, () => resolve(confirmed));
            // A stray Enter must not delete anything: destructive dialogs start on Cancel.
            (danger ? cancelButton : okButton).focus();
        });
    }

    // Folder picker for "Move to…". Starts in the current folder; click a folder
    // to open it, then "Move here". Resolves to the destination path or null.
    function moveDialog(entries, fromPath) {
        return new Promise((resolve) => {
            const movingPaths = entries.map((entry) => joinPath(fromPath, entry.name));
            const isBlocked = (path) => movingPaths.some((moving) => path === moving || path.startsWith(`${moving}/`));
            let current = fromPath;
            let chosen = null;

            const nav = el('div', { className: 'move-nav' });
            const list = el('div', { className: 'move-list' });
            const moveButton = el('button', {
                type: 'button',
                className: 'btn btn-primary',
                text: 'Move here',
                onclick: () => {
                    chosen = current;
                    dialog.close();
                },
            });
            const dialog = el('dialog', { className: 'explorer-dialog move-dialog' },
                el('h2', {
                    className: 'explorer-dialog-title',
                    text: entries.length === 1 ? `Move “${entries[0].name}”` : `Move ${entries.length} items`,
                }),
                nav,
                list,
                el('div', { className: 'explorer-dialog-actions' },
                    el('button', { type: 'button', className: 'btn btn-outline-secondary', text: 'Cancel', onclick: () => dialog.close() }),
                    moveButton,
                ),
            );

            async function show(path) {
                current = path;
                // el() skips null children; replaceChildren() would print "null".
                nav.replaceChildren(el('div', { className: 'move-nav-inner' },
                    path
                        ? el('button', {
                            type: 'button',
                            className: 'btn btn-outline-secondary btn-sm btn-icon btn-square',
                            title: `Back to ${folderLabel(parentOf(path))}`,
                            'aria-label': `Back to ${folderLabel(parentOf(path))}`,
                            onclick: () => show(parentOf(path)),
                        }, icon('arrow-left'))
                        : null,
                    icon('folder'),
                    el('span', { className: 'move-current', text: folderLabel(path) }),
                    path === fromPath ? el('span', { className: 'move-badge', text: 'Current location' }) : null,
                ));
                moveButton.disabled = path === fromPath;
                list.replaceChildren(el('p', { className: 'move-empty', text: 'Loading…' }));
                try {
                    const { entries: children } = await listFolder(path);
                    if (current !== path) {
                        return;
                    }
                    const folders = children
                        .filter((child) => child.type === 'folder')
                        .sort((a, b) => collator.compare(a.name, b.name));
                    list.replaceChildren(...(folders.length ? folders.map((folder) => {
                        const folderPath = joinPath(path, folder.name);
                        return el('button', {
                            type: 'button',
                            className: 'move-item',
                            disabled: isBlocked(folderPath),
                            title: isBlocked(folderPath) ? 'Cannot move a folder into itself' : `Open ${folder.name}`,
                            onclick: () => show(folderPath),
                        }, icon('folder'), el('span', { text: folder.name }), icon('chevron-right'));
                    }) : [el('p', { className: 'move-empty', text: 'No folders here.' })]));
                } catch (error) {
                    list.replaceChildren(el('p', { className: 'move-empty text-danger', text: error.message }));
                }
            }

            showDialog(dialog, () => resolve(chosen));
            show(fromPath);
        });
    }

    // ---- Text editor --------------------------------------------------------

    let activeEditor = null; // { isDirty } while the editor is open

    // Edits a UTF-8 text file in a plain textarea. Save saves and closes;
    // Ctrl/Cmd+S saves and keeps editing. CRLF line endings and a byte order
    // mark are kept. If someone else saved the file after it was opened, asks
    // before overwriting their version.
    function editFile(path) {
        const name = baseName(path);
        let mtime = null; // set once loaded
        let crlf = false;
        let savedValue = '';
        let busy = false; // saving, or asking a question

        const status = el('span', { className: 'editor-status', 'aria-live': 'polite', text: 'Loading…' });
        const textarea = el('textarea', {
            className: 'form-control editor-text',
            'aria-label': `Contents of ${name}`,
            autocomplete: 'off',
            autocapitalize: 'off',
            spellcheck: 'false',
            disabled: true,
        });
        const error = el('div', { className: 'editor-error', role: 'alert', hidden: true });
        const cancelButton = el('button', {
            type: 'button',
            className: 'btn btn-outline-secondary',
            text: 'Cancel',
            onclick: () => requestClose(),
        });
        const saveButton = el('button', {
            type: 'button',
            className: 'btn btn-primary',
            text: 'Save',
            title: 'Save and close. Ctrl+S saves and keeps editing.',
            disabled: true,
            onclick: () => save({ close: true }),
        });
        const dialog = el('dialog', { className: 'explorer-dialog editor-dialog', 'aria-label': `Edit ${name}` },
            el('div', { className: 'editor-header' },
                itemIcon({ type: 'file', name }),
                el('h2', { className: 'explorer-dialog-title', title: path, text: name }),
            ),
            textarea,
            error,
            el('div', { className: 'explorer-dialog-actions' }, status, cancelButton, saveButton),
        );

        const isDirty = () => mtime !== null && textarea.value !== savedValue;
        const showStatus = () => {
            status.textContent = isDirty() ? 'Unsaved changes' : '';
        };
        const showError = (message) => {
            error.textContent = message;
            error.hidden = !message;
        };

        async function load() {
            try {
                const file = await api('GET', `text?${new URLSearchParams({ path })}`);
                crlf = file.content.includes('\r\n');
                textarea.value = file.content;
                savedValue = textarea.value; // the textarea has turned CRLF into LF
                mtime = file.mtime;
                textarea.disabled = false;
                saveButton.disabled = false;
                showStatus();
                textarea.focus();
                textarea.setSelectionRange(0, 0);
            } catch (loadError) {
                status.textContent = '';
                dialog.classList.add('is-failed');
                textarea.hidden = true;
                saveButton.hidden = true;
                cancelButton.textContent = 'Close';
                showError(`Could not open “${name}”: ${loadError.message}`);
                cancelButton.focus();
            }
        }

        async function save({ close = false } = {}) {
            if (busy || mtime === null) {
                return;
            }
            if (!isDirty()) {
                if (close) {
                    dialog.close();
                }
                return;
            }
            const value = textarea.value;
            const text = crlf ? value.replace(/\n/g, '\r\n') : value;
            if (new Blob([text]).size > MAX_EDIT_BYTES) {
                showError(`Files over ${MAX_EDIT_BYTES / 1024 / 1024} MB cannot be saved here.`);
                return;
            }
            // Without the mtime the server saves even if the file has changed.
            const put = (checkMtime) => api('PUT', `text?${new URLSearchParams(checkMtime ? { path, mtime } : { path })}`, text);
            busy = true;
            saveButton.disabled = true;
            status.textContent = 'Saving…';
            showError('');
            try {
                let result;
                try {
                    result = await put(true);
                } catch (saveError) {
                    if (saveError.status !== 412) {
                        throw saveError;
                    }
                    const overwrite = await confirmDialog({
                        title: 'Overwrite their changes?',
                        message: `Someone else saved “${name}” after you opened it. Saving replaces their version with yours.`,
                        okLabel: 'Overwrite',
                        danger: true,
                    });
                    if (!overwrite) {
                        showStatus();
                        return;
                    }
                    result = await put(false);
                }
                mtime = result.mtime;
                savedValue = value;
                refreshSoon();
                if (close) {
                    dialog.close();
                    toast(`Saved “${name}”`, 'success');
                } else {
                    status.textContent = isDirty() ? 'Unsaved changes' : 'Saved';
                }
            } catch (saveError) {
                showError(`Could not save: ${saveError.message}`);
                showStatus();
            } finally {
                busy = false;
                saveButton.disabled = false;
            }
        }

        async function requestClose() {
            if (busy) {
                return;
            }
            if (isDirty()) {
                busy = true;
                const discard = await confirmDialog({
                    title: 'Discard changes?',
                    message: `Your changes to “${name}” have not been saved.`,
                    okLabel: 'Discard',
                    danger: true,
                });
                busy = false;
                if (!discard) {
                    textarea.focus();
                    return;
                }
            }
            dialog.close();
        }

        textarea.addEventListener('input', showStatus);
        dialog.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                requestClose();
            } else if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') {
                event.preventDefault();
                save();
            }
        });
        // Other ways the browser asks to close a dialog, such as Android's Back.
        dialog.addEventListener('cancel', (event) => {
            event.preventDefault();
            requestClose();
        });

        activeEditor = { isDirty };
        // No closing on a backdrop click: it is too easy to lose the text that way.
        showDialog(dialog, () => {
            activeEditor = null;
        }, { closeOnBackdrop: false });
        load();
    }

    // ---- Actions ------------------------------------------------------------

    async function createFolder() {
        const parent = state.path;
        let createdPath = null;
        const name = await promptDialog({
            title: 'New folder',
            label: 'Folder name',
            value: uniqueName('Untitled folder', state.entries.map((entry) => entry.name)),
            okLabel: 'Create',
            onSubmit: async (value) => {
                createdPath = (await api('POST', 'folder', { path: parent, name: value })).path;
            },
        });
        if (!name) {
            return;
        }
        const createdName = baseName(createdPath);
        toast(`Created “${createdName}”`, 'success');
        if (state.path === parent) {
            highlight.add(createdName);
            await refresh();
            selectOnly(createdName);
            focusItem(createdName);
        }
    }

    // Asks for a full name, extension included, creates the empty file and
    // opens it in the editor.
    async function createFile() {
        const parent = state.path;
        let createdPath = null;
        const name = await promptDialog({
            title: 'New file',
            label: 'File name',
            value: uniqueName('Untitled.txt', state.entries.map((entry) => entry.name), { isFile: true }),
            hint: 'Include the extension, such as .txt, .md or .html.',
            okLabel: 'Create',
            onSubmit: async (value) => {
                createdPath = (await api('POST', 'file', { path: parent, name: value })).path;
            },
        });
        if (!name) {
            return;
        }
        if (state.path === parent) {
            const createdName = baseName(createdPath);
            highlight.add(createdName);
            await refresh();
            selectOnly(createdName);
        }
        editFile(createdPath);
    }

    async function renameEntry(entry) {
        const folder = state.path;
        const oldPath = joinPath(folder, entry.name);
        let newPath = oldPath;
        const name = await promptDialog({
            title: 'Rename',
            label: 'New name',
            value: entry.name,
            okLabel: 'Rename',
            selectStem: entry.type === 'file',
            onSubmit: async (value) => {
                if (value !== entry.name) {
                    newPath = (await api('POST', 'rename', { path: oldPath, name: value })).path;
                }
            },
        });
        if (!name || newPath === oldPath) {
            return;
        }
        const newName = baseName(newPath);
        toast(`Renamed to “${newName}”`, 'success');
        if (state.path === folder) {
            await refresh();
            selectOnly(newName);
            focusItem(newName);
        }
    }

    async function moveEntries(entries) {
        const from = state.path;
        const destination = await moveDialog(entries, from);
        if (destination !== null) {
            await moveTo(entries.map((entry) => joinPath(from, entry.name)), destination);
        }
    }

    async function moveTo(paths, destination) {
        try {
            const { moved, failed } = await api('POST', 'move', { paths, destination });
            if (moved.length > 0) {
                const what = moved.length === 1 ? `“${baseName(moved[0].to)}”` : plural(moved.length, 'item');
                toast(`Moved ${what} to ${folderLabel(destination)}`, 'success');
            }
            if (failed.length > 0) {
                toast(failed.length === 1
                    ? `Could not move “${baseName(failed[0].path)}”: ${failed[0].error}`
                    : `${plural(failed.length, 'item')} could not be moved: ${failed[0].error}`, 'error', 5000);
            }
        } catch (error) {
            toast(`Could not move: ${error.message}`, 'error', 5000);
        }
        await refresh();
    }

    async function deleteEntries(entries) {
        const single = entries.length === 1 ? entries[0] : null;
        const hasFolder = entries.some((entry) => entry.type === 'folder');
        let message;
        if (single) {
            message = single.type === 'folder'
                ? `The folder “${single.name}” and everything in it will be deleted for everyone.`
                : `“${single.name}” will be deleted for everyone.`;
        } else {
            message = `${plural(entries.length, 'item')} will be deleted for everyone${hasFolder ? ', including everything inside the folders' : ''}.`;
        }
        const confirmed = await confirmDialog({
            title: single ? `Delete “${single.name}”?` : `Delete ${plural(entries.length, 'item')}?`,
            message: `${message} This can't be undone.`,
            okLabel: 'Delete',
            danger: true,
        });
        if (!confirmed) {
            return;
        }
        const folder = state.path;
        try {
            const { removed, failed } = await api('POST', 'delete', {
                paths: entries.map((entry) => joinPath(folder, entry.name)),
            });
            if (removed.length > 0) {
                toast(removed.length === 1 ? `Deleted “${baseName(removed[0])}”` : `Deleted ${plural(removed.length, 'item')}`, 'success');
            }
            if (failed.length > 0) {
                toast(failed.length === 1
                    ? `Could not delete “${baseName(failed[0].path)}”: ${failed[0].error}`
                    : `${plural(failed.length, 'item')} could not be deleted: ${failed[0].error}`, 'error', 5000);
            }
        } catch (error) {
            toast(`Could not delete: ${error.message}`, 'error', 5000);
        }
        if (state.path === folder) {
            clearSelection();
        }
        await refresh();
    }

    function downloadEntries(entries) {
        const urls = entries
            .filter((entry) => entry.type === 'file')
            .map((entry) => ({ name: entry.name, url: fileUrl(joinPath(state.path, entry.name)) }));
        // Spaced out: browsers drop rapid back-to-back download clicks.
        urls.forEach(({ name, url }, index) => {
            setTimeout(() => {
                const link = el('a', { href: url, download: name, hidden: true });
                document.body.append(link);
                link.click();
                link.remove();
            }, index * 400);
        });
    }

    function copyLink(entry) {
        const path = joinPath(state.path, entry.name);
        const url = new URL(entry.type === 'folder' ? folderUrl(path) : fileUrl(path), location.href).href;
        copyWithToast(url, 'Link copied');
    }

    function runSelectionAction(action) {
        const entries = selectedEntries();
        if (entries.length === 0) {
            return;
        }
        switch (action) {
            case 'download': downloadEntries(entries); break;
            case 'edit': editFile(joinPath(state.path, entries[0].name)); break;
            case 'move': moveEntries(entries); break;
            case 'rename': renameEntry(entries[0]); break;
            case 'copy-link': copyLink(entries[0]); break;
            case 'delete': deleteEntries(entries); break;
            case 'clear': clearSelection(); break;
        }
    }

    // ---- Uploads ------------------------------------------------------------

    const uploads = { tasks: [], active: 0, panel: null, rows: new Map(), minimized: false, renderQueued: false };
    let uploadSeq = 0;
    let pickTarget = '';

    function pickFiles(input) {
        pickTarget = state.path;
        input.value = '';
        input.click();
    }

    // files: [{ file, name }] where name may include folders ("trip/day1/a.jpg").
    async function queueUploads(files, folder) {
        if (files.length === 0) {
            toast('Nothing to upload. Empty folders are skipped.', 'info', 4000);
            return;
        }
        // A dropped folder that clashes with an existing name gets its own
        // "name (1)" folder instead of mixing its files into the existing one.
        const topFolders = new Set(files.filter((f) => f.name.includes('/')).map((f) => f.name.split('/')[0]));
        const renamed = new Map();
        if (topFolders.size > 0) {
            let taken = [];
            if (folder === state.path) {
                taken = state.entries.map((entry) => entry.name);
            } else {
                try {
                    taken = (await listFolder(folder)).entries.map((entry) => entry.name);
                } catch {
                    // Upload anyway; the server merges into an existing folder.
                }
            }
            for (const top of topFolders) {
                const unique = uniqueName(top, taken);
                taken.push(unique);
                if (unique !== top) {
                    renamed.set(top, unique);
                }
            }
        }
        for (const { file, name } of files) {
            const [top, ...rest] = name.split('/');
            const finalName = rest.length > 0 && renamed.has(top) ? [renamed.get(top), ...rest].join('/') : name;
            uploads.tasks.push({
                id: ++uploadSeq,
                file,
                folder,
                name: finalName,
                status: 'queued', // 'queued' | 'uploading' | 'done' | 'error' | 'canceled'
                loaded: 0,
                error: '',
                xhr: null,
            });
        }
        uploads.minimized = false;
        pumpUploads();
        renderUploads();
    }

    function pumpUploads() {
        while (uploads.active < UPLOAD_CONCURRENCY) {
            const task = uploads.tasks.find((t) => t.status === 'queued');
            if (!task) {
                break;
            }
            startUpload(task);
        }
    }

    function startUpload(task) {
        uploads.active++;
        task.status = 'uploading';
        task.loaded = 0;
        const xhr = new XMLHttpRequest();
        task.xhr = xhr;
        const finish = (status, error = '') => {
            uploads.active--;
            task.status = status;
            task.error = error;
            task.xhr = null;
            if (status === 'done') {
                task.loaded = task.file.size;
                onUploaded(task);
            }
            pumpUploads();
            renderUploads();
        };
        xhr.upload.addEventListener('progress', (event) => {
            if (event.lengthComputable) {
                task.loaded = event.loaded;
                renderUploads();
            }
        });
        xhr.addEventListener('load', () => {
            let data = null;
            try {
                data = JSON.parse(xhr.responseText);
            } catch {
                // Not JSON: reported by status below.
            }
            if (xhr.status >= 200 && xhr.status < 300) {
                task.savedPath = data?.path;
                finish('done');
            } else {
                finish('error', data?.error || `HTTP ${xhr.status}`);
            }
        });
        xhr.addEventListener('error', () => finish('error', 'The connection was interrupted'));
        xhr.addEventListener('abort', () => finish('canceled'));
        xhr.open('PUT', `${API}/upload?${new URLSearchParams({ path: task.folder, name: task.name })}`);
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.send(task.file);
    }

    function onUploaded(task) {
        const prefix = state.path ? `${state.path}/` : '';
        if (!task.savedPath || !task.savedPath.startsWith(prefix)) {
            return;
        }
        const topName = task.savedPath.slice(prefix.length).split('/')[0];
        if (!state.byName.has(topName)) {
            highlight.add(topName);
        }
        refreshSoon();
    }

    function cancelUpload(task) {
        if (task.status === 'uploading') {
            task.xhr.abort();
        } else if (task.status === 'queued') {
            task.status = 'canceled';
            renderUploads();
        }
    }

    function retryUpload(task) {
        task.status = 'queued';
        task.error = '';
        task.loaded = 0;
        pumpUploads();
        renderUploads();
    }

    async function closeUploads() {
        const active = uploads.tasks.filter((t) => t.status === 'queued' || t.status === 'uploading');
        if (active.length > 0) {
            const confirmed = await confirmDialog({
                title: `Cancel ${plural(active.length, 'upload')}?`,
                message: 'Uploads that have not finished will be stopped.',
                okLabel: 'Cancel uploads',
                danger: true,
            });
            if (!confirmed) {
                return;
            }
            active.forEach(cancelUpload);
        }
        uploads.tasks = [];
        uploads.rows.clear();
        uploads.panel?.remove();
        uploads.panel = null;
    }

    function buildUploadPanel() {
        const panel = el('section', { className: 'upload-panel', 'aria-label': 'Uploads' },
            el('div', { className: 'upload-panel-header' },
                el('h2', { className: 'upload-panel-title', 'aria-live': 'polite' }),
                el('button', {
                    type: 'button',
                    className: 'upload-panel-btn upload-minimize',
                    title: 'Minimize',
                    'aria-label': 'Minimize uploads',
                    onclick: () => {
                        uploads.minimized = !uploads.minimized;
                        renderUploads();
                    },
                }, icon('chevron-down')),
                el('button', {
                    type: 'button',
                    className: 'upload-panel-btn',
                    title: 'Close',
                    'aria-label': 'Close uploads',
                    onclick: closeUploads,
                }, icon('x')),
            ),
            el('div', { className: 'progress upload-overall', role: 'progressbar', 'aria-label': 'Total upload progress' },
                el('div', { className: 'progress-bar' })),
            el('ul', { className: 'upload-list' }),
        );
        document.body.append(panel);
        return panel;
    }

    function uploadRow(task) {
        const row = el('li', { className: 'upload-row' },
            itemIcon({ type: 'file', name: task.name }),
            el('div', { className: 'upload-row-main' },
                el('span', { className: 'upload-name', title: task.name, text: baseName(task.name) }),
                el('span', { className: 'upload-status' }),
                el('div', { className: 'progress upload-progress', 'aria-hidden': 'true' }, el('div', { className: 'progress-bar' })),
            ),
            el('span', { className: 'upload-state' }),
        );
        uploads.panel.querySelector('.upload-list').append(row);
        return row;
    }

    function updateUploadRow(row, task) {
        const percent = task.file.size > 0 ? Math.round((task.loaded / task.file.size) * 100) : 100;
        const status = row.querySelector('.upload-status');
        const progress = row.querySelector('.upload-progress');
        const stateBox = row.querySelector('.upload-state');
        row.className = `upload-row is-${task.status}`;
        progress.hidden = task.status !== 'uploading';
        progress.firstChild.style.width = `${percent}%`;

        const actionButton = (iconName, label, onclick) => el('button', {
            type: 'button',
            className: 'upload-panel-btn',
            title: label,
            'aria-label': `${label} ${task.name}`,
            onclick,
        }, icon(iconName));

        const key = task.status;
        if (stateBox.dataset.status !== key) {
            stateBox.dataset.status = key;
            if (key === 'queued' || key === 'uploading') {
                stateBox.replaceChildren(actionButton('x', 'Cancel', () => cancelUpload(task)));
            } else if (key === 'done') {
                stateBox.replaceChildren(icon('check', 'upload-done'));
            } else {
                stateBox.replaceChildren(actionButton('rotate-cw', 'Retry', () => retryUpload(task)));
            }
        }
        status.textContent = {
            queued: 'Waiting…',
            uploading: `${percent}% of ${formatBytes(task.file.size)}`,
            done: formatBytes(task.file.size),
            error: task.error,
            canceled: 'Canceled',
        }[task.status];
    }

    function renderUploads() {
        if (uploads.renderQueued) {
            return;
        }
        uploads.renderQueued = true;
        requestAnimationFrame(() => {
            uploads.renderQueued = false;
            const { tasks } = uploads;
            if (tasks.length === 0) {
                return;
            }
            uploads.panel ??= buildUploadPanel();
            const panel = uploads.panel;
            for (const task of tasks) {
                let row = uploads.rows.get(task.id);
                if (!row) {
                    row = uploadRow(task);
                    uploads.rows.set(task.id, row);
                }
                updateUploadRow(row, task);
            }

            const active = tasks.filter((t) => t.status === 'queued' || t.status === 'uploading');
            const done = tasks.filter((t) => t.status === 'done').length;
            const failed = tasks.filter((t) => t.status === 'error').length;
            let title;
            if (active.length > 0) {
                title = `Uploading ${plural(active.length, 'item')}`;
            } else if (failed > 0) {
                title = `${done} uploaded, ${failed} failed`;
            } else {
                title = done > 0 ? `${plural(done, 'upload')} complete` : 'Uploads canceled';
            }
            panel.querySelector('.upload-panel-title').textContent = title;

            const counted = tasks.filter((t) => t.status !== 'canceled');
            const total = counted.reduce((sum, t) => sum + t.file.size, 0);
            const loaded = counted.reduce((sum, t) => sum + t.loaded, 0);
            const overall = panel.querySelector('.upload-overall');
            overall.hidden = active.length === 0;
            overall.firstChild.style.width = `${total > 0 ? (loaded / total) * 100 : 0}%`;

            panel.classList.toggle('is-minimized', uploads.minimized);
            panel.querySelector('.upload-minimize').title = uploads.minimized ? 'Expand' : 'Minimize';
        });
    }

    window.addEventListener('beforeunload', (event) => {
        if (uploads.tasks.some((t) => t.status === 'queued' || t.status === 'uploading') || activeEditor?.isDirty()) {
            event.preventDefault();
            event.returnValue = '';
        }
    });

    // Turns dropped items into [{ file, name }], walking into dropped folders.
    // The entries must be taken from the event synchronously, before any await.
    function readDrop(dataTransfer) {
        const entries = Array.from(dataTransfer.items || [])
            .filter((item) => item.kind === 'file')
            .map((item) => item.webkitGetAsEntry?.())
            .filter(Boolean);
        const files = Array.from(dataTransfer.files || []);
        if (entries.length === 0) {
            return Promise.resolve(files.map((file) => ({ file, name: file.name })));
        }
        return Promise.all(entries.map((entry) => walkEntry(entry, ''))).then((lists) => lists.flat());
    }

    async function walkEntry(entry, prefix) {
        const name = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isFile) {
            const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
            return [{ file, name }];
        }
        if (!entry.isDirectory) {
            return [];
        }
        const reader = entry.createReader();
        const children = [];
        for (;;) {
            const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
            if (batch.length === 0) {
                break;
            }
            children.push(...batch);
        }
        // Skip hidden files inside folders (.DS_Store, .git, …); lw-share hides them anyway.
        const visible = children.filter((child) => !child.name.startsWith('.'));
        return (await Promise.all(visible.map((child) => walkEntry(child, name)))).flat();
    }

    fileInput.addEventListener('change', () => {
        const files = Array.from(fileInput.files).map((file) => ({ file, name: file.name }));
        fileInput.value = '';
        queueUploads(files, pickTarget);
    });

    folderInput.addEventListener('change', () => {
        const files = Array.from(folderInput.files)
            .map((file) => ({ file, name: file.webkitRelativePath || file.name }))
            .filter(({ name }) => !name.split('/').some((segment) => segment.startsWith('.')));
        folderInput.value = '';
        queueUploads(files, pickTarget);
    });

    function timestampName() {
        const now = new Date();
        const pad = (value) => String(value).padStart(2, '0');
        return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
            + `_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    }

    document.addEventListener('paste', (event) => {
        const pasted = Array.from(event.clipboardData?.files || []);
        if (pasted.length === 0 || state.status !== 'ready' || document.querySelector('dialog[open]')) {
            return;
        }
        event.preventDefault();
        // Browsers name every pasted screenshot "image.png"; give each a dated
        // name so it is easy to tell apart.
        const files = pasted.map((file, index) => {
            if (!/^image\.\w+$/i.test(file.name)) {
                return { file, name: file.name };
            }
            const extension = file.name.split('.').pop();
            const suffix = pasted.length > 1 ? `-${index + 1}` : '';
            return { file, name: `pasted_${timestampName()}${suffix}.${extension}` };
        });
        queueUploads(files, state.path);
    });

    // ---- Drag and drop ------------------------------------------------------

    let drag = null; // { paths, from } while one of our items is being dragged
    let dropTarget = null;
    let dropUiTimer = null;

    function dragKind(event) {
        const types = Array.from(event.dataTransfer?.types || []);
        if (types.includes(DRAG_TYPE)) {
            return 'move';
        }
        return types.includes('Files') ? 'upload' : null;
    }

    // The element that would receive the drop: a folder row or card, a
    // breadcrumb, or (for uploads) the current folder's list.
    function dropTargetFor(node, kind) {
        if (document.querySelector('dialog[open]')) {
            return null;
        }
        const target = node instanceof Element ? node.closest('[data-drop-path]') : null;
        if (kind === 'move') {
            if (!target) {
                return null;
            }
            const path = target.dataset.dropPath;
            if (drag && (path === drag.from
                || drag.paths.some((moving) => path === moving || path.startsWith(`${moving}/`)))) {
                return null;
            }
            return target;
        }
        if (state.status !== 'ready' && (!target || target === body)) {
            return null;
        }
        return target || body;
    }

    function setDropTarget(target, kind) {
        if (dropTarget !== target) {
            dropTarget?.classList.remove('is-drop-target');
            dropTarget = target;
            dropTarget?.classList.add('is-drop-target');
        }
        if (!target) {
            dropHint.hidden = true;
            return;
        }
        const folder = el('strong', { text: folderLabel(target.dataset.dropPath) });
        if (kind === 'move') {
            const count = drag ? drag.paths.length : 0;
            dropHint.replaceChildren(icon('folder-move'),
                el('span', { text: `Move ${count === 1 ? 'item' : plural(count, 'item')} to ` }), folder);
        } else {
            dropHint.replaceChildren(icon('upload'), el('span', { text: 'Drop to upload to ' }), folder);
        }
        dropHint.hidden = false;
    }

    function endDropUi() {
        clearTimeout(dropUiTimer);
        setDropTarget(null);
    }

    body.addEventListener('dragstart', (event) => {
        const itemEl = event.target instanceof Element ? event.target.closest('.item') : null;
        if (!itemEl || lastPointerType === 'touch') {
            event.preventDefault();
            return;
        }
        const entry = entryOf(itemEl);
        if (!state.selected.has(entry.name)) {
            selectOnly(entry.name);
        }
        const entries = selectedEntries();
        const paths = entries.map((e) => joinPath(state.path, e.name));
        drag = { paths, from: state.path };
        event.dataTransfer.effectAllowed = 'copyMove';
        event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(paths));
        // Chrome: dragging a single file out of the window onto the desktop downloads it.
        if (entries.length === 1 && entry.type === 'file' && !entry.name.includes(':')) {
            const url = new URL(fileUrl(paths[0]), location.href).href;
            event.dataTransfer.setData('DownloadURL', `application/octet-stream:${entry.name}:${url}`);
        }
        const ghost = el('div', { className: 'drag-ghost' },
            entries.length === 1 ? itemIcon(entry) : icon('copy'),
            el('span', { text: entries.length === 1 ? entry.name : plural(entries.length, 'item') }));
        document.body.append(ghost);
        event.dataTransfer.setDragImage(ghost, 18, 18);
        setTimeout(() => ghost.remove(), 0);
        closeMenu();
        for (const e of entries) {
            itemElementByName(e.name)?.classList.add('is-dragging');
        }
    });

    document.addEventListener('dragend', () => {
        drag = null;
        endDropUi();
        itemsEl.querySelectorAll('.is-dragging').forEach((node) => node.classList.remove('is-dragging'));
    });

    document.addEventListener('dragover', (event) => {
        const kind = dragKind(event);
        if (!kind) {
            return;
        }
        // Always cancel, so dropped files never make the browser navigate away.
        event.preventDefault();
        const target = dropTargetFor(event.target, kind);
        event.dataTransfer.dropEffect = target ? (kind === 'move' ? 'move' : 'copy') : 'none';
        setDropTarget(target, kind);
        // dragover repeats while the pointer is over the page, so its absence
        // means the drag left the window.
        clearTimeout(dropUiTimer);
        dropUiTimer = setTimeout(endDropUi, 400);
    });

    document.addEventListener('drop', (event) => {
        const kind = dragKind(event);
        if (!kind) {
            return;
        }
        event.preventDefault();
        const target = dropTargetFor(event.target, kind);
        endDropUi();
        if (!target) {
            return;
        }
        const destination = target.dataset.dropPath;
        if (kind === 'move') {
            let paths = [];
            try {
                paths = JSON.parse(event.dataTransfer.getData(DRAG_TYPE));
            } catch {
                // Not our data after all.
            }
            if (paths.length > 0) {
                moveTo(paths, destination);
            }
        } else {
            readDrop(event.dataTransfer)
                .then((files) => queueUploads(files, destination))
                .catch(() => toast('Could not read the dropped items.', 'error'));
        }
    });

    // ---- Pointer and keyboard -----------------------------------------------

    function onItemClick(event, entry) {
        if (lastPointerType === 'touch') {
            // Touch: tap opens; after a long-press has started a selection, taps toggle.
            if (state.selected.size > 0) {
                toggleSelected(entry.name);
            } else {
                openEntry(entry);
            }
            return;
        }
        if (event.shiftKey) {
            selectRange(entry.name, event.ctrlKey || event.metaKey);
        } else if (event.ctrlKey || event.metaKey) {
            toggleSelected(entry.name);
        } else {
            selectOnly(entry.name);
        }
    }

    body.addEventListener('click', (event) => {
        if (suppressClick) {
            suppressClick = false;
            return;
        }
        const target = event.target instanceof Element ? event.target : null;
        const navLink = target?.closest('a[data-nav-path]');
        if (navLink) {
            event.preventDefault();
            navigate(navLink.dataset.navPath);
            return;
        }
        const sortHeader = target?.closest('[data-sort]');
        if (sortHeader) {
            setSort(sortHeader.dataset.sort);
            return;
        }
        const itemEl = target?.closest('.item');
        if (!itemEl) {
            if (!target?.closest('button, a, .list-header')) {
                clearSelection();
            }
            return;
        }
        const entry = entryOf(itemEl);
        if (!entry) {
            return;
        }
        if (target.closest('[data-action="more"]')) {
            if (!state.selected.has(entry.name)) {
                selectOnly(entry.name);
            }
            openMenu(itemMenu(selectedEntries()), { anchor: target.closest('[data-action="more"]') });
            return;
        }
        onItemClick(event, entry);
    });

    body.addEventListener('dblclick', (event) => {
        const itemEl = event.target instanceof Element ? event.target.closest('.item') : null;
        if (itemEl && lastPointerType !== 'touch' && !event.target.closest('[data-action="more"]')) {
            const entry = entryOf(itemEl);
            if (entry) {
                openEntry(entry);
            }
        }
    });

    body.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        if (lastPointerType === 'touch') {
            return; // touch uses long-press to select and the ⋮ button for actions
        }
        const itemEl = event.target instanceof Element ? event.target.closest('.item') : null;
        // The keyboard's menu key reports no pointer position.
        const fromKeyboard = event.clientX === 0 && event.clientY === 0;
        const entry = itemEl && entryOf(itemEl);
        if (entry) {
            if (!state.selected.has(entry.name)) {
                selectOnly(entry.name);
            }
            openMenu(itemMenu(selectedEntries()), fromKeyboard
                ? { anchor: itemEl, align: 'start' }
                : { x: event.clientX, y: event.clientY });
        } else {
            clearSelection();
            openMenu(folderMenu(), fromKeyboard
                ? { anchor: breadcrumbs.lastElementChild, align: 'start' }
                : { x: event.clientX, y: event.clientY });
        }
    });

    // Touch: hold an item to start selecting.
    body.addEventListener('pointerdown', (event) => {
        if (event.pointerType !== 'touch') {
            return;
        }
        const itemEl = event.target instanceof Element ? event.target.closest('.item') : null;
        if (!itemEl || event.target.closest('[data-action="more"]')) {
            return;
        }
        const { clientX: startX, clientY: startY } = event;
        const cleanup = () => {
            clearTimeout(timer);
            body.removeEventListener('pointermove', onMove);
            body.removeEventListener('pointerup', cleanup);
            body.removeEventListener('pointercancel', cleanup);
        };
        const onMove = (moveEvent) => {
            if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > 10) {
                cleanup();
            }
        };
        const timer = setTimeout(() => {
            cleanup();
            suppressClick = true;
            toggleSelected(itemEl.dataset.name);
            navigator.vibrate?.(20);
        }, LONG_PRESS_MS);
        body.addEventListener('pointermove', onMove);
        body.addEventListener('pointerup', cleanup);
        body.addEventListener('pointercancel', cleanup);
    });

    // Mouse: drag a box over empty space to select the items it touches.
    body.addEventListener('pointerdown', (event) => {
        if (event.pointerType !== 'mouse' || event.button !== 0) {
            return;
        }
        const target = event.target instanceof Element ? event.target : null;
        if (!target || target.closest('.item, .list-header, button, a, input, .explorer-empty')) {
            return;
        }
        // A press on the scrollbar lands on the scroll container outside its content box.
        if (target === body && (event.offsetX >= body.clientWidth || event.offsetY >= body.clientHeight)) {
            return;
        }
        const additive = event.ctrlKey || event.metaKey || event.shiftKey;
        const base = additive ? [...state.selected] : [];
        const toContent = (clientX, clientY) => {
            const rect = body.getBoundingClientRect();
            return { x: clientX - rect.left + body.scrollLeft, y: clientY - rect.top + body.scrollTop };
        };
        const origin = toContent(event.clientX, event.clientY);
        let last = event;
        let active = false;

        const update = () => {
            const point = toContent(last.clientX, last.clientY);
            const box = {
                left: Math.min(origin.x, point.x),
                top: Math.min(origin.y, point.y),
                right: Math.max(origin.x, point.x),
                bottom: Math.max(origin.y, point.y),
            };
            Object.assign(marquee.style, {
                left: `${box.left}px`,
                top: `${box.top}px`,
                width: `${box.right - box.left}px`,
                height: `${box.bottom - box.top}px`,
            });
            const names = new Set(base);
            for (const itemEl of itemsEl.querySelectorAll('.item')) {
                const rect = itemEl.getBoundingClientRect();
                const topLeft = toContent(rect.left, rect.top);
                if (topLeft.x < box.right && topLeft.x + rect.width > box.left
                    && topLeft.y < box.bottom && topLeft.y + rect.height > box.top) {
                    names.add(itemEl.dataset.name);
                }
            }
            setSelection(names);
        };
        const onMove = (moveEvent) => {
            last = moveEvent;
            if (!active) {
                if (Math.hypot(moveEvent.clientX - event.clientX, moveEvent.clientY - event.clientY) < 5) {
                    return;
                }
                active = true;
                marquee.hidden = false;
                closeMenu();
            }
            update();
        };
        const onScroll = () => active && update();
        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            body.removeEventListener('scroll', onScroll);
            if (active) {
                marquee.hidden = true;
                suppressClick = true; // the click that ends the box must not clear it
            }
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        body.addEventListener('scroll', onScroll, { passive: true });
    });

    document.addEventListener('keydown', (event) => {
        if (menuState) {
            handleMenuKey(event);
            return;
        }
        if (event.defaultPrevented || document.querySelector('dialog[open]')) {
            return;
        }
        const target = event.target;
        if (target === filterInput) {
            if (event.key === 'Escape' && filterInput.value) {
                filterInput.value = '';
                setFilter('');
            } else if (event.key === 'ArrowDown' && state.visible.length > 0) {
                event.preventDefault();
                selectOnly(state.visible[0].name);
                focusItem(state.visible[0].name);
            }
            return;
        }
        // Only act when focus is on the page itself, the list or an item, so
        // keys keep working normally in the header, toolbar and dialogs.
        const inList = target === document.body || target === body || target.classList?.contains('item');
        if (!inList) {
            return;
        }
        const mod = event.ctrlKey || event.metaKey;
        const entries = selectedEntries();
        switch (event.key) {
            case 'Delete':
                if (entries.length > 0) {
                    event.preventDefault();
                    deleteEntries(entries);
                }
                break;
            case 'Backspace':
                if (mod && entries.length > 0) {
                    event.preventDefault();
                    deleteEntries(entries);
                }
                break;
            case 'F2':
                if (entries.length === 1) {
                    event.preventDefault();
                    renameEntry(entries[0]);
                }
                break;
            case 'F10':
                if (event.shiftKey && entries.length > 0) {
                    event.preventDefault();
                    openMenu(itemMenu(entries), { anchor: itemElementByName(state.lead) || body, align: 'start' });
                }
                break;
            case 'Enter':
                if (entries.length === 1) {
                    event.preventDefault();
                    openEntry(entries[0]);
                }
                break;
            case 'Escape':
                if (state.selected.size > 0) {
                    clearSelection();
                }
                break;
            case 'a':
            case 'A':
                if (mod) {
                    event.preventDefault();
                    setSelection(state.visible.map((entry) => entry.name));
                }
                break;
            case 'ArrowUp':
                if (event.altKey) {
                    event.preventDefault();
                    if (state.path) {
                        navigate(parentOf(state.path));
                    }
                    break;
                }
                moveLead(event);
                break;
            case 'ArrowDown':
            case 'ArrowLeft':
            case 'ArrowRight':
            case 'Home':
            case 'End':
                moveLead(event);
                break;
        }
    });

    // ---- Toolbar ------------------------------------------------------------

    function setFilter(value) {
        state.filter = value;
        renderItems();
    }

    filterInput.addEventListener('input', () => setFilter(filterInput.value));
    newButton.addEventListener('click', () => openMenu(folderMenu(), { anchor: newButton, align: 'start' }));
    sortButton.addEventListener('click', () => openMenu(sortMenu(), { anchor: sortButton }));
    viewButtons.forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
    selectionBar.addEventListener('click', (event) => {
        const button = event.target instanceof Element ? event.target.closest('[data-action]') : null;
        if (button) {
            runSelectionAction(button.dataset.action);
        }
    });

    breadcrumbs.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const link = target?.closest('a[data-nav-path]');
        if (link) {
            // Let modified clicks open the folder in a new tab or window.
            if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
                return;
            }
            event.preventDefault();
            navigate(link.dataset.navPath);
            return;
        }
        const current = target?.closest('[data-action="folder-menu"]');
        if (current) {
            openMenu(folderMenu(), { anchor: current, align: 'start' });
        }
    });

    window.addEventListener('popstate', () => navigate(pathFromLocation(), { push: false }));

    // ---- Start --------------------------------------------------------------

    // Result of a plain (no-JavaScript) form upload: show it once.
    const params = new URLSearchParams(location.search);
    if (params.has('success')) {
        toast(params.get('success'), 'success', 4000);
    } else if (params.has('error')) {
        toast(`Upload failed: ${params.get('error')}`, 'error', 5000);
    }
    history.replaceState({ path: state.path }, '', folderUrl(state.path));

    body.dataset.dropPath = state.path;
    renderBreadcrumbs();
    renderAll();
    refresh();

    // A missing folder is not polled: each 404 would log a console error every few seconds.
    // It is checked again when the tab becomes visible, or on reload.
    setInterval(() => {
        if (!document.hidden && !drag && state.status !== 'missing') {
            refresh();
        }
    }, REFRESH_INTERVAL);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            refresh();
        }
    });
})();
