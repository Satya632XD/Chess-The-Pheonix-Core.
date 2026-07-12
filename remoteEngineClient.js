// src/engine/remoteEngineClient.js
//
// Low-level transport for talking to the backend Stockfish pool.
// This is the ONLY file in the frontend that knows about the
// 'engineAnalyze' / 'engineResult' / 'engineError' socket protocol.
//
// Nothing here loads stockfish.js or stockfish.wasm — the actual engine
// binary lives entirely on the server (see backend/stockfishPool.js).
// This keeps any custom-licensed engine build off the client and out of
// the bundle you ship publicly.
//
// Public API mirrors what the old local-worker clients returned, so
// lib/stockfishEngine.js and engine/stockfishBot.js can be swapped to use
// this without changing their own exported function signatures (and so
// AnalysisMode.jsx / NormalChess.jsx / PhoenixCore.jsx need zero changes).

import { getSocket } from '../lib/socketClient';

const DEFAULT_TIMEOUT_MS = 25000;
const pending = new Map();
let listenersAttached = false;

function attachListeners() {
  if (listenersAttached) return;
  listenersAttached = true;

  const socket = getSocket();

  socket.on('engineResult', ({ requestId, bestMove, moves }) => {
    const entry = pending.get(requestId);
    if (!entry) return;
    pending.delete(requestId);
    clearTimeout(entry.timeoutId);
    entry.resolve({ bestMove, moves: moves || [] });
  });

  socket.on('engineError', ({ requestId, error }) => {
    const entry = pending.get(requestId);
    if (!entry) return;
    pending.delete(requestId);
    clearTimeout(entry.timeoutId);
    entry.reject(new Error(error || 'Engine error'));
  });

  socket.on('disconnect', () => {
    // Fail every in-flight request rather than leaving callers hanging
    // forever waiting on a connection that's gone.
    for (const [requestId, entry] of pending.entries()) {
      clearTimeout(entry.timeoutId);
      entry.reject(new Error('Socket disconnected'));
      pending.delete(requestId);
    }
  });
}

function genRequestId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Request analysis of a single FEN from the backend engine pool.
 *
 * @param {string} fen
 * @param {object} opts { depth, multipv, moveTime, timeoutMs }
 * @returns {Promise<{bestMove: string|null, moves: Array<{move,eval,mate,depth,pv}>}>}
 */
export function remoteAnalyze(fen, opts = {}) {
  attachListeners();
  const socket = getSocket();

  const requestId = genRequestId();
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('Engine request timed out'));
    }, timeoutMs);

    pending.set(requestId, { resolve, reject, timeoutId });

    const emit = () => {
      socket.emit('engineAnalyze', {
        requestId,
        fen,
        depth: opts.depth ?? 14,
        multipv: opts.multipv ?? 1,
        moveTime: opts.moveTime ?? 3000,
      });
    };

    if (socket.connected) {
      emit();
    } else {
      socket.once('connect', emit);
    }
  });
}

/**
 * Best-effort "stop" signal (no-op on server side beyond the hook it
 * exposes; each job already carries its own timeout).
 */
export function remoteStop() {
  try {
    getSocket().emit('engineStop');
  } catch {}
}

/**
 * Whether the shared socket is currently connected.
 */
export function isEngineConnected() {
  return !!getSocket().connected;
}
