import assert from 'node:assert/strict';
import { buildKeys, keyAt, BLACK_H } from './keys.js';

const keys = buildKeys(48, 72);
const key = midi => keys.find(k => k.midi === midi);
assert.equal(keys.length, 25);
assert.equal(keys.filter(k => !k.black).length, 15);
assert.ok(Math.abs(keys[0].x + keys.at(-1).x) < 1e-9, 'keyboard is centred');

assert.equal(keyAt(keys, key(60).x, 0, 0.13)?.midi, 60, 'front of a white key');
assert.equal(keyAt(keys, key(61).x, BLACK_H, 0.05)?.midi, 61, 'black key wins at the back');
assert.equal(keyAt(keys, key(60).x, 0.05, 0.13), null, 'hovering above');
assert.equal(keyAt(keys, key(60).x, -0.05, 0.13), null, 'under the piano');
assert.equal(keyAt(keys, key(60).x, 0.01, 0.13), null, 'just above the surface');
assert.equal(keyAt(keys, key(60).x, 0.01, 0.13, key(60))?.midi, 60, 'held key keeps its margin');
console.log('keys ok');
