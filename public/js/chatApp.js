"use strict";

(() => {
    const { el, icon, copyWithToast, openConnectDialog } = LWShare;

    const TYPING_TIMER_LENGTH = 400; // ms
    const NICKNAME_KEY = 'lw-share:nickname';
    const GROUP_WINDOW_MS = 2 * 60 * 1000;
    // Dark enough for white initials in both light and dark themes.
    const AVATAR_COLORS = [
        '#c2410c', '#be123c', '#a21caf', '#6d28d9', '#4338ca', '#1d4ed8',
        '#0e7490', '#047857', '#15803d', '#a16207', '#b91c1c', '#7c3aed',
    ];
    const URL_PATTERN = /\bhttps?:\/\/[^\s<>"]+/gi;

    const joinPanel = document.getElementById('joinPanel');
    const joinForm = document.getElementById('joinForm');
    const joinTitle = document.getElementById('joinTitle');
    const joinIntro = document.getElementById('joinIntro');
    const joinSubmit = document.getElementById('joinSubmit');
    const joinCancel = document.getElementById('joinCancel');
    const nicknameInput = document.getElementById('nicknameInput');
    const chatMe = document.getElementById('chatMe');
    const myName = document.getElementById('myName');
    const changeNameButton = document.getElementById('changeName');
    const onlineCount = document.getElementById('onlineCount');
    const onlineCountText = document.getElementById('onlineCountText');
    const connectionBanner = document.getElementById('connectionBanner');
    const chatScroll = document.getElementById('chatScroll');
    const messageList = document.getElementById('messages');
    const newMessagesButton = document.getElementById('newMessages');
    const typingIndicator = document.getElementById('typingIndicator');
    const composer = document.getElementById('composer');
    const messageInput = document.getElementById('messageInput');
    const sendButton = document.getElementById('sendButton');

    const isTouch = window.matchMedia('(hover: none)').matches;
    const baseTitle = document.title;

    let username = '';      // Chosen name; empty until the user joins.
    let joined = false;     // The server has accepted the name on the current connection.
    let renaming = false;   // Reconnecting on purpose to switch to a new name.
    let everJoined = false;
    let typing = false;
    let lastTypingTime = 0;
    let unread = 0;
    let lastAuthor = null;
    let lastAuthorTime = 0;
    const typingUsers = new Set();

    const socket = io();

    // ---- Helpers -------------------------------------------------------------

    function avatarColor(name) {
        let hash = 7;
        for (let i = 0; i < name.length; i++) {
            hash = name.charCodeAt(i) + (hash << 5) - hash;
        }
        return AVATAR_COLORS[Math.abs(hash % AVATAR_COLORS.length)];
    }

    function formatTime(date) {
        return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }

    // Turns http(s) URLs into links; everything else stays plain text.
    function linkify(text) {
        const nodes = [];
        let last = 0;
        for (const match of text.matchAll(URL_PATTERN)) {
            const url = match[0].replace(/[.,;:!?)\]}'"]+$/, '');
            const start = match.index;
            if (start > last) {
                nodes.push(document.createTextNode(text.slice(last, start)));
            }
            nodes.push(el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: url }));
            last = start + url.length;
        }
        if (last < text.length) {
            nodes.push(document.createTextNode(text.slice(last)));
        }
        return nodes;
    }

    function isNearBottom() {
        return chatScroll.scrollHeight - chatScroll.scrollTop - chatScroll.clientHeight < 80;
    }

    function scrollToBottom() {
        chatScroll.scrollTop = chatScroll.scrollHeight;
        newMessagesButton.hidden = true;
    }

    function appendItem(item, { forceScroll = false } = {}) {
        const stick = forceScroll || isNearBottom();
        messageList.appendChild(item);
        if (stick) {
            scrollToBottom();
        } else {
            newMessagesButton.hidden = false;
        }
    }

    function updateTitle() {
        document.title = unread > 0 ? `(${unread}) ${baseTitle}` : baseTitle;
    }

    // ---- Rendering -----------------------------------------------------------

    function log(...content) {
        lastAuthor = null;
        appendItem(el('li', { className: 'msg-log' }, ...content));
    }

    function addMessage({ author, text, own }) {
        const now = new Date();
        const continued = author === lastAuthor && now - lastAuthorTime < GROUP_WINDOW_MS;
        lastAuthor = author;
        lastAuthorTime = now.getTime();

        const copyButton = el('button', {
            type: 'button',
            className: 'msg-copy',
            title: 'Copy message',
            'aria-label': 'Copy message',
            onclick: () => copyWithToast(text, 'Message copied'),
        }, icon('copy'));

        const header = continued ? null : el('div', { className: 'msg-header' },
            own ? null : el('span', { className: 'msg-author', text: author }),
            el('time', { datetime: now.toISOString(), text: formatTime(now) }),
        );

        const item = el('li', { className: `msg${own ? ' msg-own' : ''}${continued ? ' msg-continued' : ''}` },
            own ? null : el('span', {
                className: 'msg-avatar',
                style: `background-color: ${avatarColor(author)}`,
                'aria-hidden': 'true',
                text: Array.from(author)[0] || '?',
            }),
            el('div', { className: 'msg-content' },
                header,
                el('div', { className: 'msg-line' },
                    el('div', { className: 'msg-bubble' }, ...linkify(text)),
                    copyButton,
                ),
            ),
        );
        appendItem(item, { forceScroll: own });

        if (!own && document.hidden) {
            unread++;
            updateTitle();
        }
    }

    function renderTyping() {
        const names = Array.from(typingUsers);
        let text = '';
        if (names.length === 1) {
            text = `${names[0]} is typing…`;
        } else if (names.length === 2) {
            text = `${names[0]} and ${names[1]} are typing…`;
        } else if (names.length > 2) {
            text = 'Several people are typing…';
        }
        typingIndicator.textContent = text;
    }

    function setOnline(count) {
        onlineCount.hidden = false;
        onlineCountText.textContent = `${count} online`;
    }

    function updateComposerState() {
        // Typing stays possible while reconnecting; only sending waits for the connection.
        messageInput.disabled = !username;
        sendButton.disabled = !(joined && socket.connected);
        connectionBanner.hidden = !everJoined || socket.connected || renaming;
    }

    function autoGrow() {
        messageInput.style.height = 'auto';
        messageInput.style.height = `${Math.min(messageInput.scrollHeight + 2, 160)}px`;
    }

    // ---- Join / leave --------------------------------------------------------

    function showJoinPanel() {
        const changing = Boolean(username);
        joinTitle.textContent = changing ? 'Change your name' : 'Join the chat';
        joinSubmit.textContent = changing ? 'Save name' : 'Join chat';
        joinCancel.hidden = !changing;
        joinIntro.hidden = changing;
        joinPanel.hidden = false;
        nicknameInput.value = username || localStorage.getItem(NICKNAME_KEY) || '';
        nicknameInput.focus();
        nicknameInput.select();
    }

    function hideJoinPanel() {
        joinPanel.hidden = true;
        messageInput.focus();
    }

    joinForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const name = nicknameInput.value.trim();
        if (!name) {
            nicknameInput.focus();
            return;
        }
        localStorage.setItem(NICKNAME_KEY, name);
        if (name === username) {
            hideJoinPanel();
            return;
        }
        const firstJoin = !username;
        username = name;
        myName.textContent = name;
        chatMe.hidden = false;
        if (firstJoin) {
            if (socket.connected) {
                socket.emit('add user', username);
            }
            // Otherwise the 'connect' handler sends the name once connected.
        } else {
            // The server keeps one name per connection, so a new name means a new connection.
            renaming = true;
            socket.disconnect();
            socket.connect();
        }
        updateComposerState();
        hideJoinPanel();
    });

    changeNameButton.addEventListener('click', showJoinPanel);
    joinCancel.addEventListener('click', hideJoinPanel);
    joinPanel.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && username) {
            hideJoinPanel();
        }
    });

    // ---- Sending -------------------------------------------------------------

    function sendMessage() {
        const text = messageInput.value;
        if (!text.trim() || !joined || !socket.connected) {
            return;
        }
        socket.emit('new message', text);
        if (typing) {
            socket.emit('stop typing');
            typing = false;
        }
        addMessage({ author: username, text, own: true });
        messageInput.value = '';
        autoGrow();
        messageInput.focus();
    }

    composer.addEventListener('submit', (event) => {
        event.preventDefault();
        sendMessage();
    });

    messageInput.addEventListener('keydown', (event) => {
        // Enter sends; Shift+Enter adds a line. On touch keyboards Enter always adds a
        // line and the Send button sends. Never send while an IME is composing.
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229 && !isTouch) {
            event.preventDefault();
            sendMessage();
        }
    });

    messageInput.addEventListener('input', () => {
        autoGrow();
        if (!joined || !socket.connected) {
            return;
        }
        if (!typing) {
            typing = true;
            socket.emit('typing');
        }
        lastTypingTime = Date.now();
        setTimeout(() => {
            if (typing && Date.now() - lastTypingTime >= TYPING_TIMER_LENGTH) {
                socket.emit('stop typing');
                typing = false;
            }
        }, TYPING_TIMER_LENGTH);
    });

    // Typing anywhere on the page goes to the message box.
    window.addEventListener('keydown', (event) => {
        if (!username || !joinPanel.hidden || event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) {
            return;
        }
        const active = document.activeElement;
        if (active && (active.matches('input, textarea, select, [contenteditable]') || active.closest('dialog'))) {
            return;
        }
        messageInput.focus();
    });

    chatScroll.addEventListener('scroll', () => {
        if (isNearBottom()) {
            newMessagesButton.hidden = true;
        }
    });
    newMessagesButton.addEventListener('click', scrollToBottom);

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            unread = 0;
            updateTitle();
        }
    });

    // ---- Socket events -------------------------------------------------------

    socket.on('connect', () => {
        // Also runs after a reconnect (e.g. the server restarted): join again.
        if (username) {
            socket.emit('add user', username);
        }
        updateComposerState();
    });

    socket.on('login', (data) => {
        const firstJoin = !everJoined;
        joined = true;
        everJoined = true;
        setOnline(data.numUsers);
        updateComposerState();
        if (renaming) {
            renaming = false;
            log(`You are now ${username}.`);
            return;
        }
        if (!firstJoin) {
            log('Reconnected.');
            return;
        }
        if (data.numUsers <= 1) {
            log(`Welcome, ${username}! Nobody else is here yet. `, el('button', {
                type: 'button',
                className: 'btn btn-link btn-sm p-0',
                text: 'Open the chat on another device',
                onclick: openConnectDialog,
            }), '.');
        } else {
            log(`Welcome, ${username}! ${data.numUsers - 1} other ${data.numUsers === 2 ? 'person is' : 'people are'} here.`);
        }
    });

    socket.on('new message', (data) => {
        typingUsers.delete(data.username);
        renderTyping();
        addMessage({ author: data.username || 'Someone', text: String(data.message ?? ''), own: false });
    });

    socket.on('user joined', (data) => {
        log(`${data.username} joined`);
        setOnline(data.numUsers);
    });

    socket.on('user left', (data) => {
        log(`${data.username} left`);
        setOnline(data.numUsers);
        typingUsers.delete(data.username);
        renderTyping();
    });

    socket.on('typing', (data) => {
        if (data.username) {
            typingUsers.add(data.username);
            renderTyping();
        }
    });

    socket.on('stop typing', (data) => {
        typingUsers.delete(data.username);
        renderTyping();
    });

    socket.on('disconnect', () => {
        joined = false;
        typing = false;
        typingUsers.clear();
        renderTyping();
        updateComposerState();
    });

    socket.on('connect_error', updateComposerState);

    showJoinPanel();
})();
