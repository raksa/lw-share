// Dev-only Electron shell around the lw-share web UI, so the chrome-devtools
// MCP can attach to it. Started by `npm run electron` (or `npm run dev`) with
// --remote-debugging-port=9226; not part of the published package.
import { app, BrowserWindow, session } from 'electron';
import { existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Must match the --port of "dev:server" in package.json.
const SERVER_ORIGIN = 'http://localhost:3006';
const PRELOAD_PATH = fileURLToPath(new URL('./electron-preload.cjs', import.meta.url));

const READY_TIMEOUT_MS = 60_000; // give up waiting for the server after this long
const POLL_INTERVAL_MS = 300; // delay between readiness checks

// Electron is pointed at this file rather than the package (whose "main" is the
// library entry), so it would otherwise call the app "Electron" and share that
// generic profile directory with any other bare `electron <script>` run.
app.setName('lw-share-dev');
app.setPath('userData', path.join(app.getPath('appData'), 'lw-share-dev'));

/**
 * Resolve once the server responds to a request, or reject on timeout.
 * Any HTTP response (even a 404) means the server is up and listening.
 */
function waitForServer(
    url,
    { timeoutMs = READY_TIMEOUT_MS, intervalMs = POLL_INTERVAL_MS } = {},
) {
    const deadline = Date.now() + timeoutMs;

    return new Promise((resolve, reject) => {
        const attempt = () => {
            const request = http.get(url, (response) => {
                response.resume(); // drain the response so the socket is freed
                resolve();
            });

            request.on('error', () => {
                if (Date.now() >= deadline) {
                    reject(new Error(`Timed out waiting for ${url} after ${timeoutMs}ms`));
                    return;
                }
                setTimeout(attempt, intervalMs);
            });
        };

        attempt();
    });
}

/** `name.ext`, else `name (1).ext`, `name (2).ext`, ... — never overwrite. */
function uniqueDownloadPath(fileName) {
    const dir = app.getPath('downloads');
    const { name, ext } = path.parse(path.basename(fileName));
    let candidate = path.join(dir, `${name}${ext}`);
    for (let i = 1; existsSync(candidate); i++) {
        candidate = path.join(dir, `${name} (${i})${ext}`);
    }
    return candidate;
}

/**
 * Save downloads straight to the Downloads folder instead of showing a native
 * Save dialog, which the MCP cannot see or dismiss.
 */
function setupAutoDownloads() {
    session.defaultSession.on('will-download', (_event, item, webContents) => {
        const savePath = uniqueDownloadPath(item.getFilename());
        item.setSavePath(savePath);

        // A target="_blank" link to a non-viewable file opens a window that
        // never loads anything. Chrome closes such tabs; Electron leaves them.
        const owner = BrowserWindow.fromWebContents(webContents);
        const isEmptyPopup = owner && !webContents.getURL();

        item.once('done', (_doneEvent, state) => {
            console.log(`[download ${state}] ${savePath}`);
            if (isEmptyPopup && !owner.isDestroyed()) {
                owner.close();
            }
        });
    });
}

/**
 * Registered on the session rather than in webPreferences so it also runs in
 * windows opened by target="_blank" links, which do not inherit the preload.
 */
function setupPreload() {
    session.defaultSession.registerPreloadScript({ filePath: PRELOAD_PATH, type: 'frame' });
}

function createWindow() {
    const window = new BrowserWindow({
        height: 800,
        show: false,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
        width: 1280,
    });

    window.once('ready-to-show', () => {
        window.maximize();
        window.show();
    });
    window.webContents.openDevTools();
    window.loadURL(SERVER_ORIGIN);

    return window;
}

app.whenReady().then(async () => {
    try {
        await waitForServer(SERVER_ORIGIN);
    } catch (error) {
        console.error(error.message);
        app.quit();
        return;
    }

    setupPreload();
    setupAutoDownloads();
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
