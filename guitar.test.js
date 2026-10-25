import assert from 'node:assert/strict';
import { chordAt, crossed, pluck, CHORDS, NECK_START, ZONE, STRING_Y } from './guitar.js';

assert.equal(chordAt(0.1), 0, 'hand close to the body clamps to the first zone');
assert.equal(chordAt(NECK_START + ZONE * 2.5), 2);
assert.equal(chordAt(5), CHORDS.length - 1, 'far hand clamps to the last zone');
assert.ok(CHORDS.every(c => c.notes.length === STRING_Y.length));

assert.deepEqual(crossed(-0.05, 0.05), [0, 1, 2, 3, 4, 5], 'strum one way hits all strings low to high');
assert.deepEqual(crossed(0.05, -0.05), [5, 4, 3, 2, 1, 0], 'strum back hits them high to low');
assert.deepEqual(crossed(0.001, 0.002), [], 'tiny move between strings hits nothing');
assert.deepEqual(crossed(STRING_Y[2] - 0.001, STRING_Y[2] + 0.001), [2], 'single string');

const wave = pluck(110, 48000);
const rms = (a, b) => Math.sqrt(wave.slice(a, b).reduce((s, v) => s + v * v, 0) / (b - a));
assert.ok(rms(0, 4800) > 0.05, 'the string sounds');
assert.ok(rms(wave.length - 4800, wave.length) < rms(0, 4800) / 3, 'and dies away');
console.log('guitar ok');
