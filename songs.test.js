import assert from 'node:assert/strict';
import { noteNumber, parseSong, parseMidi, SONGS } from './songs.js';
import { marimbaBars, thereminPitch, thereminVolume } from './instruments.js';

assert.equal(noteNumber('C4'), 60);
assert.equal(noteNumber('A4'), 69);
assert.equal(noteNumber('D#5'), 75);
assert.equal(noteNumber('Bb3'), 58);
assert.deepEqual(parseSong('C4 E4+G4'), [[60], [64, 67]]);
assert.ok(SONGS.every(s => s.steps.length > 10 && s.steps.flat().every(n => n >= 21 && n <= 108)));

// A tiny MIDI file: C4+E4 together (running status), then G4 a beat later; a drum note is ignored.
const track = [0x00, 0x90, 60, 100, 0x00, 64, 100, 0x00, 0x99, 36, 100, 0x60, 0x80, 60, 0, 0x00, 0x90, 67, 90, 0x00, 0xff, 0x2f, 0x00];
const bytes = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96, 0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, track.length, ...track];
assert.deepEqual(parseMidi(new Uint8Array(bytes).buffer), [[60, 64], [67]]);
assert.throws(() => parseMidi(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer), /not a MIDI file/);

const bars = marimbaBars(57, 84);
assert.equal(bars.length, 28);
assert.ok(bars.filter(b => b.black).every(b => b.z + b.length < 0), 'accidentals sit behind the naturals');
assert.ok(bars[0].length > bars.at(-1).length, 'low bars are longer');

assert.equal(thereminPitch(0.05), 84);
assert.equal(thereminPitch(1), 48);
assert.ok(thereminPitch(0.2) > thereminPitch(0.4), 'closer to the antenna is higher');
assert.equal(thereminVolume(0), 0);
assert.equal(thereminVolume(1), 1);
console.log('songs and instruments ok');
