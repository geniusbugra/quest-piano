// Layout and mapping for the marimba and the theremin (pure functions, tested in instruments.test.js).
import { buildKeys, WHITE_W } from './keys.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Marimba bars in marimba-local space, same conventions as piano keys (see keys.js): naturals in the
// front row from z = 0 towards you, accidentals in a raised back row. Bars get shorter as pitch rises.
export const BAR_PITCH = 0.055;
export function marimbaBars(low, high) {
  return buildKeys(low, high).map(k => {
    const length = 0.36 - 0.15 * (k.midi - low) / (high - low);
    return {
      midi: k.midi, black: k.black, x: k.x / WHITE_W * BAR_PITCH,
      width: k.black ? 0.042 : 0.048, length: k.black ? length * 0.85 : length,
      z: k.black ? -0.03 - length * 0.85 : 0, top: k.black ? 0.025 : 0,
    };
  });
}

// Theremin: right hand distance from the pitch antenna → pitch (closer = higher, like the real thing),
// left hand height above the volume loop → loudness (closer = quieter).
export function thereminPitch(distance) {
  return 84 - 36 * clamp((distance - 0.05) / 0.55, 0, 1); // fractional MIDI note, C6 down to C3
}
export function thereminVolume(height) {
  return clamp((height - 0.03) / 0.3, 0, 1);
}
