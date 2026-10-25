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
const pad = { pad: true, x: -1, z: 0.1, width: 0.05, length: 0.05, top: 0.012 };
assert.equal(keyAt([...keys, pad], -1, 0.012, 0.12), pad, 'pad hit inside its own z range');
assert.equal(keyAt([...keys, pad], -1, 0.012, 0.05), null, 'pad not hit in front of its back edge');
console.log('keys ok');
