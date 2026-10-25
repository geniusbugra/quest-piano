// Songs for the piano guide: a few built-in public-domain tunes, and a small Standard MIDI File
// reader so any song can be loaded. A song is a list of steps; a step is the notes played together.
const NAMES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function noteNumber(name) {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  return 12 * (Number(m[3]) + 1) + NAMES[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

// "C4 E4+G4" → [[60], [64, 67]]; '+' joins notes played together
export function parseSong(text) {
  return text.trim().split(/\s+/).map(step => step.split('+').map(noteNumber));
}

export const SONGS = [
  { name: 'Twinkle Twinkle', steps: parseSong('C4 C4 G4 G4 A4 A4 G4 F4 F4 E4 E4 D4 D4 C4 G4 G4 F4 F4 E4 E4 D4 G4 G4 F4 F4 E4 E4 D4 C4 C4 G4 G4 A4 A4 G4 F4 F4 E4 E4 D4 D4 C4') },
  { name: 'Ode to Joy', steps: parseSong('E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4 D4 D4 E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 D4 C4 C4') },
  { name: 'Für Elise', steps: parseSong('E5 D#5 E5 D#5 E5 B4 D5 C5 A4 C4 E4 A4 B4 E4 G#4 B4 C5 E4 E5 D#5 E5 D#5 E5 B4 D5 C5 A4 C4 E4 A4 B4 E4 C5 B4 A4') },
  { name: 'Frère Jacques', steps: parseSong('C4 D4 E4 C4 C4 D4 E4 C4 E4 F4 G4 E4 F4 G4 G4 A4 G4 F4 E4 C4 G4 A4 G4 F4 E4 C4 C4 G3 C4 C4 G3 C4') },
  { name: 'Jingle Bells', steps: parseSong('E4 E4 E4 E4 E4 E4 E4 G4 C4 D4 E4 F4 F4 F4 F4 F4 E4 E4 E4 E4 E4 D4 D4 E4 D4 G4') },
];

// Standard MIDI File → steps. Every note-on (drum channel excluded) within the piano's range,
// grouped into one step when notes start within a 1/16 beat of each other.
export function parseMidi(buffer, maxSteps = 2000) {
  const d = new DataView(buffer);
  let p = 0;
  const tag = () => String.fromCharCode(d.getUint8(p), d.getUint8(p + 1), d.getUint8(p + 2), d.getUint8(p + 3));
  if (tag() !== 'MThd') throw new Error('not a MIDI file');
  const tracks = d.getUint16(10), division = d.getUint16(12);
  p = 8 + d.getUint32(4);
  const notes = []; // [tick, midi]
  for (let t = 0; t < tracks && p < d.byteLength; t++) {
    if (tag() !== 'MTrk') throw new Error('bad MIDI track');
    const end = p + 8 + d.getUint32(p + 4);
    p += 8;
    let tick = 0, status = 0;
    const varLen = () => { let v = 0, b; do { b = d.getUint8(p++); v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };
    while (p < end) {
      tick += varLen();
      if (d.getUint8(p) & 0x80) status = d.getUint8(p++); // otherwise running status
      const type = status & 0xf0;
      // `p += varLen()` would read p before varLen advances it, so take the length first.
      if (status === 0xff) { p++; const len = varLen(); p += len; }        // meta event
      else if (status === 0xf0 || status === 0xf7) { const len = varLen(); p += len; } // sysex
      else if (type === 0xc0 || type === 0xd0) p += 1;                     // one data byte
      else {
        const note = d.getUint8(p), velocity = d.getUint8(p + 1);
        p += 2;
        if (type === 0x90 && velocity > 0 && (status & 0x0f) !== 9 && note >= 21 && note <= 108) notes.push([tick, note]);
      }
    }
    p = end;
  }
  notes.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const steps = [], window = Math.max(1, division / 16);
  let start = -Infinity;
  for (const [tick, note] of notes) {
    if (tick - start > window) { if (steps.length === maxSteps) break; steps.push([]); start = tick; }
    const step = steps[steps.length - 1];
    if (!step.includes(note)) step.push(note);
  }
  return steps;
}
