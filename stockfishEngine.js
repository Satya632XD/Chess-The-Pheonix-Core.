// src/lib/stockfishEngine.js
//
// DROP-IN REPLACEMENT — same exported functions as before
// (initEngine, evaluatePosition, terminateEngine), same return shape from
// evaluatePosition ({ eval, bestMove, pv, mate, depth, sideToMove }), so
// AnalysisMode.jsx needs ZERO changes.
//
// What changed: the actual Stockfish engine no longer runs in a browser
// Worker loaded from /stockfish.js. It runs as a native process on the
// backend (see backend/stockfishPool.js) and this file just sends the FEN
// over the shared socket and waits for the JSON result. This is what keeps
// your custom-licensed Stockfish build off the public frontend bundle.

import { remoteAnalyze, isEngineConnected } from '../engine/remoteEngineClient';
import { getSocket } from './socketClient';

let connectPromise = null;

/**
 * Ensure the shared socket is connected. Kept as `initEngine` for
 * call-site compatibility with the old local-worker version, even though
 * there's no engine process to boot on the client anymore.
 */
export async function initEngine() {
  if (isEngineConnected()) return;
  if (connectPromise) return connectPromise;

  connectPromise = new Promise((resolve, reject) => {
    const socket = getSocket();
    if (socket.connected) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      reject(new Error('Could not connect to analysis server'));
    }, 10000);

    socket.once('connect', () => {
      clearTimeout(timeout);
      resolve();
    });

    socket.once('connect_error', (err) => {
      clearTimeout(timeout);
      reject(new Error('Connection error: ' + (err?.message || 'unknown')));
    });
  }).finally(() => {
    connectPromise = null;
  });

  return connectPromise;
}

/**
 * Evaluate a single position. Same signature and return shape as before:
 * { eval, bestMove, pv, mate, depth, sideToMove }
 * `eval` is normalized to White-positive perspective, same as the old
 * local-engine version did.
 */
export async function evaluatePosition(fen, depth = 12, moveTime = 4000) {
  await initEngine();

  const sideToMove = fen.split(' ')[1] === 'b' ? 'black' : 'white';

  const result = await remoteAnalyze(fen, {
    depth,
    multipv: 1,
    moveTime,
    timeoutMs: moveTime + 8000,
  });

  const top = result.moves?.[0];
  const rawEval = top?.eval ?? 0;
  const mate = top?.mate ?? null;
  const pv = top?.pv ? top.pv.join(' ') : '';

  // Normalize to White-positive perspective (matches old behavior).
  const normalizedEval = sideToMove === 'black' ? -rawEval : rawEval;

  return {
    eval: normalizedEval,
    bestMove: result.bestMove,
    pv,
    mate,
    depth: top?.depth ?? depth,
    sideToMove,
  };
}

/**
 * Kept for call-site compatibility. There's no local worker to terminate
 * anymore — the shared socket persists across the app intentionally so
 * repeated analysis calls (e.g. AnalysisMode's per-move loop) don't pay a
 * reconnect cost each time. This is a deliberate no-op.
 */
export function terminateEngine() {
  // Intentional no-op — shared socket is managed at the app level.
}
