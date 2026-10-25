// Chord-mode guitar. Guitar-local space: x runs from the sound hole (0) up the neck, strings lie
// across y, z points out of the top. The neck hand picks a chord by how far up the neck it is,
// the other hand strums across the strings over the sound hole.
export const STRING_Y = [0, 1, 2, 3, 4, 5].map(s => (s - 2.5) * 0.01); // low E first, 1 cm apart
export const NECK_START = 0.3, ZONE = 0.075; // chord zones start 30 cm up the neck, 7.5 cm each

// MIDI note per string (low E to high E); null = string not played. Nearest the body first.
export const CHORDS = [
  { name: 'D', notes: [null, null, 50, 57, 62, 66] },
  { name: 'Em', notes: [40, 47, 52, 55, 59, 64] },
  { name: 'F', notes: [41, 48, 53, 57, 60, 65] },
  { name: 'Am', notes: [null, 45, 52, 57, 60, 64] },
  { name: 'G', notes: [43, 47, 50, 55, 59, 67] },
  { name: 'C', notes: [null, 48, 52, 55, 60, 64] },
];

// Chord index for a neck hand `distance` metres from the sound hole.
export function chordAt(distance) {
  return Math.min(CHORDS.length - 1, Math.max(0, Math.floor((distance - NECK_START) / ZONE)));
}

// Strings a fingertip crossed moving from prevY to y, in the order it met them.
export function crossed(prevY, y) {
  const lo = Math.min(prevY, y), hi = Math.max(prevY, y);
  const hits = STRING_Y.flatMap((s, i) => (s > lo && s <= hi ? [i] : []));
  return y < prevY ? hits.reverse() : hits;
}

// Karplus-Strong plucked string: a noise burst circulating in a delay line one period long.
export function pluck(freq, sampleRate, seconds = 2.5) {
  const period = Math.round(sampleRate / freq), out = new Float32Array(Math.round(sampleRate * seconds));
  for (let i = 0; i < period; i++) out[i] = Math.random() - 0.5;
  for (let i = period; i < out.length; i++) out[i] = 0.996 * 0.5 * (out[i - period] + (out[i - period - 1] ?? 0));
  return out;
}
