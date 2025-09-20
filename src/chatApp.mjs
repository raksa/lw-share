"Use strict";

import { join } from 'node:path';
import { Server } from 'socket.io';

function initSocket(socket, store) {
    let addedUser = false;

    socket.on('new message', (data) => {
        socket.broadcast.emit('new message', {
            username: socket.username,
            message: data
        });
    });

    socket.on('add user', (username) => {
        if (addedUser) {
            return;
        }

        socket.username = username;
        ++store.numUsers;
        addedUser = true;
        socket.emit('login', {
            numUsers: store.numUsers
        });
        socket.broadcast.emit('user joined', {
            username: socket.username,
            numUsers: store.numUsers
        });
    });

    socket.on('typing', () => {
        socket.broadcast.emit('typing', {
            username: socket.username
        });
    });

    socket.on('stop typing', () => {
        socket.broadcast.emit('stop typing', {
            username: socket.username
        });
    });

    socket.on('disconnect', () => {
        if (addedUser) {
            --store.numUsers;

            socket.broadcast.emit('user left', {
                username: socket.username,
                numUsers: store.numUsers
            });
        }
    });
}

export function init({ app, httpServer, publicPath }) {
    app.get('/chat/', (_req, res) => {
        res.sendFile(join(publicPath, 'chatApp.html'));
    });

    const io = new Server(httpServer);
    const store = { numUsers: 0 };
    io.on('connection', (socket) => {
        initSocket(socket, store);
    });
};

