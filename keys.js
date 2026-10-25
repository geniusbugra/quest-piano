// Real piano key dimensions in metres. Piano-local space: x along the keyboard (centred),
// y up with the white key tops at 0, z from 0 (back) to WHITE_L (front edge, towards the player).
export const WHITE_W = 0.0235, WHITE_L = 0.15, BLACK_W = 0.0137, BLACK_L = 0.095, BLACK_H = 0.012;
const TIP = 0.008;   // fingertip radius: touching the top surface already counts
const DEPTH = 0.02;  // how far below a key top a finger still counts (deeper = under the piano)

const isBlack = midi => [1, 3, 6, 8, 10].includes(midi % 12);

export function buildKeys(low, high) {
  const keys = [];
  let whites = 0;
  for (let midi = low; midi <= high; midi++) {
    if (isBlack(midi)) keys.push({ midi, black: true, x: whites * WHITE_W, width: BLACK_W, length: BLACK_L, top: BLACK_H });
    else keys.push({ midi, black: false, x: (whites++ + 0.5) * WHITE_W, width: WHITE_W, length: WHITE_L, top: 0 });
  }
  for (const k of keys) k.x -= whites * WHITE_W / 2;
  return keys;
}

// Keys start at z = 0; other targets (e.g. drum pads) give their own back edge in `z`.
function inside(k, x, y, z, margin) {
  const z0 = k.z || 0;
  return Math.abs(x - k.x) <= k.width / 2 + margin && z >= z0 - margin && z <= z0 + k.length + margin
    && y <= k.top + TIP + margin && y >= k.top - DEPTH - margin;
}

// The key a fingertip at (x, y, z) is pressing, or null. A held key gets a small margin so
// tracking jitter at its edge does not retrigger the note.
export function keyAt(keys, x, y, z, held) {
  if (held && inside(held, x, y, z, 0.005)) return held;
  let hit = null;
  for (const k of keys) {
    if (!inside(k, x, y, z, 0)) continue;
    if (k.black) return k; // black keys sit on top of the whites
    hit = k;
  }
  return hit;
}
