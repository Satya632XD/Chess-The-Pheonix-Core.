// src/engine/stockfishBot.js
//
// DROP-IN REPLACEMENT — createStockfish() still returns an object with
// the same methods as before (getBestMove, getBestMoveFromPool,
// waitUntilReady, stop, newGame, terminate, isHealthy), so NormalChess.jsx
// needs ZERO changes to keep working.
//
// What changed: no /stockfish.js Worker is spawned in the browser anymore.
// Every search is sent to the backend Stockfish pool over the shared
// socket connection (see engine/remoteEngineClient.js + backend/stockfishPool.js).
// getBestMove / getBestMoveFromPool still resolve to {move, eval} shaped
// entries, matching the old local-engine contract exactly.

import { remoteAnalyze, remoteStop, isEngineConnected } from './remoteEngineClient';
import { getSocket } from '../lib/socketClient';

function waitForConnection(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const socket = getSocket();
    if (socket.connected) {
      resolve(true);
      return;
    }

    const timeout = setTimeout(() => {
      reject(new Error('Could not connect to engine server'));
    }, timeoutMs);

    socket.once('connect', () => {
      clearTimeout(timeout);
      resolve(true);
    });
  });
}

export function createStockfish() {
  let healthy = true;

  return {
    // Same contract as before: resolves to {move, eval} or null.
    getBestMove: async (fen, depth = 10, mpv = 1, moveTime = null) => {
      try {
        await waitForConnection();
        const result = await remoteAnalyze(fen, {
          depth,
          multipv: mpv,
          moveTime: moveTime || 2000,
        });
        healthy = true;
        const top = result.moves?.[0];
        if (!top) return result.bestMove ? { move: result.bestMove, eval: null } : null;
        return { move: top.move, eval: top.eval };
      } catch (e) {
        healthy = false;
        console.error('Remote engine error (getBestMove):', e.message);
        return null;
      }
    },

    // Same contract as before: resolves to an array of {move, eval},
    // best line first, MultiPV-slot order, deduped by the server.
    getBestMoveFromPool: async (fen, depth = 10, mpv = 7, moveTime = null) => {
      try {
        await waitForConnection();
        const result = await remoteAnalyze(fen, {
          depth,
          multipv: mpv,
          moveTime: moveTime || 2000,
        });
        healthy = true;
        return (result.moves || []).map((m) => ({ move: m.move, eval: m.eval }));
      } catch (e) {
        healthy = false;
        console.error('Remote engine error (getBestMoveFromPool):', e.message);
        return [];
      }
    },

    waitUntilReady: () => waitForConnection(),

    stop: () => {
      remoteStop();
    },

    // No server-side "new game" state to reset per-client — each analyze
    // call is already a fresh, independent search (`ucinewgame` is sent
    // server-side before every job). Kept for call-site compatibility.
    newGame: async () => true,

    // Nothing local to tear down; the shared socket persists for the
    // life of the app. Kept for call-site compatibility.
    terminate: () => {},

    isHealthy: () => healthy && isEngineConnected(),
  };
}
