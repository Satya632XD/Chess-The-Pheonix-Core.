// src/lib/socketClient.js
//
// Single shared Socket.IO connection for the whole app.
//
// Previously each page (OnlineChess.jsx, AuthContext.jsx) hardcoded its own
// SERVER_URL string, and OnlineChess.jsx opened its own `io(...)` connection.
// Now that the engine (analysis + bot) also needs a socket connection to
// reach the backend Stockfish pool, we centralize the URL here so every
// file that needs it imports from one place.

import { io } from 'socket.io-client';

export const SERVER_URL =
  import.meta?.env?.VITE_SERVER_URL || 'https://phoenix-chess-server.onrender.com';

let socket = null;

/**
 * Get (and lazily create) the shared socket connection used by the engine
 * client (analysis + bot moves). Safe to call from multiple places —
 * always returns the same instance.
 */
export function getSocket() {
  if (socket) return socket;

  socket = io(SERVER_URL, {
    transports: ['websocket', 'polling'],
    autoConnect: true,
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    try {
      socket.disconnect();
    } catch {}
    socket = null;
  }
}
