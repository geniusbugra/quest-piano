import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildKeys, keyAt, WHITE_W, WHITE_L } from './keys.js';
import { CHORDS, chordAt, crossed, pluck, STRING_Y, NECK_START, ZONE, SADDLE, NUT, SCALE } from './guitar.js';
import { marimbaBars, thereminPitch, thereminVolume } from './instruments.js';
import { SONGS, parseMidi } from './songs.js';

// ---------- Sound
const audio = new AudioContext();
const out = audio.createDynamicsCompressor(); // keeps chords from clipping
out.connect(audio.destination);
addEventListener('pointerdown', () => audio.resume());

// Everything plays into `fx`; the effect pads switch its lo-fi filter and the reverb / delay sends.
const fx = audio.createBiquadFilter();
fx.type = 'lowpass';
fx.frequency.value = 20000;
fx.connect(out);
const room = audio.createBuffer(2, audio.sampleRate * 2.5, audio.sampleRate);
for (let c = 0; c < 2; c++) {
  const d = room.getChannelData(c);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 3;
}
const reverb = audio.createConvolver();
reverb.buffer = room;
const reverbSend = audio.createGain();
reverbSend.gain.value = 0;
fx.connect(reverbSend).connect(reverb).connect(out);
const delay = audio.createDelay(1);
delay.delayTime.value = 0.3;
const feedback = audio.createGain();
feedback.gain.value = 0.35;
delay.connect(feedback).connect(delay);
const delaySend = audio.createGain();
delaySend.gain.value = 0;
fx.connect(delaySend).connect(delay).connect(out);

// Piano: Salamander Grand Piano samples (CC-BY 3.0, Alexander Holm), pitch-shifted to the nearest note
const buffers = {};
const SAMPLE_NOTE = { C: 0, Ds: 3, Fs: 6, A: 9 };
const SAMPLES = ['A0', 'C8', ...[1, 2, 3, 4, 5, 6, 7].flatMap(o => ['C', 'Ds', 'Fs', 'A'].map(n => n + o))];
for (const name of SAMPLES) {
  const midi = 12 * (Number(name.slice(-1)) + 1) + SAMPLE_NOTE[name.slice(0, -1)];
  fetch(`https://tonejs.github.io/audio/salamander/${name}.mp3`)
    .then(r => r.arrayBuffer()).then(b => audio.decodeAudioData(b)).then(buf => { buffers[midi] = buf; })
    .catch(e => console.warn('sample failed', name, e));
}

// ---------- MIDI out: open the page with ?midi while midi_bridge.py runs, and FL Studio sees a
// "Quest Piyano" MIDI keyboard. The built-in sound is muted then; FL makes the sound.
const MIDI = new URLSearchParams(location.search).has('midi');
let midiSocket = null;
function connectMidi() {
  midiSocket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/midi`);
  midiSocket.onclose = () => setTimeout(connectMidi, 2000);
}
if (MIDI) connectMidi();
const sendMidi = bytes => midiSocket?.readyState === WebSocket.OPEN && midiSocket.send(JSON.stringify(bytes));

const voices = {};
let sustain = false;
const sustained = new Set();
function noteOn(midi, velocity) {
  if (MIDI) return sendMidi([0x90, midi, Math.max(1, Math.round(velocity * 127))]);
  stopVoice(midi);
  const gain = audio.createGain();
  gain.gain.value = velocity;
  gain.connect(fx);
  const loaded = Object.keys(buffers).map(Number);
  let src;
  if (loaded.length) {
    const base = loaded.reduce((a, b) => (Math.abs(b - midi) < Math.abs(a - midi) ? b : a));
    src = audio.createBufferSource();
    src.buffer = buffers[base];
    src.playbackRate.value = 2 ** ((midi - base) / 12);
  } else {
    // shortcut: plain synth until the samples arrive (or when offline)
    src = audio.createOscillator();
    src.type = 'triangle';
    src.frequency.value = 440 * 2 ** ((midi - 69) / 12);
    gain.gain.setTargetAtTime(0, audio.currentTime, 0.5);
  }
  src.connect(gain);
  src.start();
  voices[midi] = { src, gain };
}
function stopVoice(midi) {
  const v = voices[midi];
  if (!v) return;
  delete voices[midi];
  const now = audio.currentTime;
  (v.gain.gain.cancelAndHoldAtTime || v.gain.gain.cancelScheduledValues).call(v.gain.gain, now);
  v.gain.gain.setTargetAtTime(0, now, 0.1); // damper
  v.src.stop(now + 1);
}
function noteOff(midi) {
  if (MIDI) return sendMidi([0x80, midi, 0]);
  if (sustain) return sustained.add(midi); // pedal down: let it ring
  stopVoice(midi);
}
function setSustain(on) {
  sustain = on;
  if (MIDI) return sendMidi([0xB0, 64, on ? 127 : 0]);
  if (on) return;
  for (const midi of sustained) if (!keyByMidi[midi].down) stopVoice(midi);
  sustained.clear();
}

// Drums are synthesised, so they need no samples.
const noiseBuf = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
const noiseData = noiseBuf.getChannelData(0);
for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;
function decay(node, level, seconds) {
  const g = audio.createGain(), t = audio.currentTime;
  g.gain.setValueAtTime(level, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + seconds);
  node.connect(g).connect(fx);
}
function noise(type, freq, level, seconds) {
  const src = audio.createBufferSource(), filter = audio.createBiquadFilter();
  src.buffer = noiseBuf;
  filter.type = type;
  filter.frequency.value = freq;
  decay(src.connect(filter), level, seconds);
  src.start();
  src.stop(audio.currentTime + seconds);
}
function tone(from, to, level, seconds) {
  const osc = audio.createOscillator(), t = audio.currentTime;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + seconds / 2);
  decay(osc, level, seconds);
  osc.start();
  osc.stop(t + seconds);
}
// note = General MIDI drum note, sent on channel 10 in MIDI mode
const DRUMS = [
  { label: 'KICK', note: 36, color: 0xff3b30, play: v => tone(150, 40, v, 0.45) },
  { label: 'SNARE', note: 38, color: 0xff9500, play: v => { noise('highpass', 1200, v * 0.8, 0.22); tone(220, 160, v * 0.4, 0.12); } },
  { label: 'CLAP', note: 39, color: 0xffcc00, play: v => noise('bandpass', 1500, v, 0.18) },
  { label: 'HAT', note: 42, color: 0x34c759, play: v => noise('highpass', 7000, v * 0.5, 0.06) },
  { label: 'OPEN HAT', note: 46, color: 0x30d158, play: v => noise('highpass', 7000, v * 0.5, 0.35) },
  { label: 'TOM LO', note: 45, color: 0x0a84ff, play: v => tone(130, 70, v, 0.35) },
  { label: 'TOM HI', note: 50, color: 0x5e5ce6, play: v => tone(220, 120, v, 0.3) },
  { label: 'CRASH', note: 49, color: 0xbf5af2, play: v => noise('highpass', 4500, v * 0.6, 1.4) },
];
const EFFECTS = [
  { label: 'REVERB', color: 0x64d2ff, set: on => reverbSend.gain.setTargetAtTime(on ? 0.6 : 0, audio.currentTime, 0.05) },
  { label: 'DELAY', color: 0xda8fff, set: on => delaySend.gain.setTargetAtTime(on ? 0.45 : 0, audio.currentTime, 0.05) },
  { label: 'LO-FI', color: 0xff375f, set: on => fx.frequency.setTargetAtTime(on ? 1400 : 20000, audio.currentTime, 0.05) },
  { label: 'SUSTAIN', color: 0xffd60a, set: setSustain },
];

// Marimba: a struck bar is a sine at the pitch plus the 4th harmonic it is tuned to, and a short mallet click.
const hz = midi => 440 * 2 ** ((midi - 69) / 12);
function marimbaNote(midi, v) {
  const ring = 1.4 - (midi - 57) * 0.025; // low bars ring longer
  for (const [mult, level, seconds] of [[1, 0.6, ring], [4, 0.15, ring * 0.3]]) {
    const osc = audio.createOscillator(), t = audio.currentTime;
    osc.frequency.value = hz(midi) * mult;
    decay(osc, v * level, seconds);
    osc.start(t);
    osc.stop(t + seconds);
  }
  noise('bandpass', hz(midi) * 3, v * 0.12, 0.03);
}

// Theremin: one continuous voice (sine + soft triangle, gentle vibrato), started the first time it is used.
let thereminVoice = null;
function theremin() {
  if (thereminVoice) return thereminVoice;
  const osc = audio.createOscillator(), soft = audio.createOscillator(), softGain = audio.createGain();
  const lfo = audio.createOscillator(), lfoDepth = audio.createGain(), gain = audio.createGain();
  soft.type = 'triangle';
  softGain.gain.value = 0.25;
  lfo.frequency.value = 5.5;
  lfoDepth.gain.value = 3;
  lfo.connect(lfoDepth);
  lfoDepth.connect(osc.frequency);
  lfoDepth.connect(soft.frequency);
  gain.gain.value = 0;
  osc.connect(gain);
  soft.connect(softGain).connect(gain);
  gain.connect(fx);
  for (const o of [osc, soft, lfo]) o.start();
  return (thereminVoice = { osc, soft, gain });
}

// ---------- Scene
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); // alpha = passthrough shows behind
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setFoveation(1); // Quest renders the edges of the view at lower resolution: big GPU saving
document.body.append(renderer.domElement, ARButton.createButton(renderer, { optionalFeatures: ['hand-tracking', 'local-floor'] }));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.01, 20);
camera.position.set(0.1, 1.6, 1.3);
camera.lookAt(0.1, 1, -0.4);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
// Studio-style reflections make the lacquer and ivory read as real materials.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

// ---------- Piano: full 88 keys A0–C8 at real size (~1.23 m)
const keys = buildKeys(21, 108);
const keyByMidi = Object.fromEntries(keys.map(k => [k.midi, k]));
const width = keys.filter(k => !k.black).length * WHITE_W;
const CHEEK = 0.025, OUTER = width + 2 * CHEEK;
const piano = new THREE.Group();
piano.position.set(0, 1, -0.3);
scene.add(piano);

const lacquer = new THREE.MeshPhysicalMaterial({ color: 0x080808, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.04 });
function part(w, h, d, x, y, z, mat = lacquer, radius = 0.004) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(radius, w / 2, h / 2, d / 2)), mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  piano.add(m);
  return m;
}
part(OUTER, 0.03, 0.21, 0, -0.035, 0.065);                          // base under the keys
for (const s of [-1, 1]) part(CHEEK, 0.06, 0.21, s * (width + CHEEK) / 2, -0.015, 0.065); // side cheeks
part(width, 0.09, 0.03, 0, 0.025, -0.025);                           // fallboard behind the keys
part(width, 0.02, 0.012, 0, -0.019, WHITE_L + 0.006);                // key slip in front
part(width, 0.004, 0.008, 0, 0, -0.005,
  new THREE.MeshStandardMaterial({ color: 0x7a0f1c, roughness: 1 }), 0.001); // red felt strip
part(width * 0.6, 0.0015, 0.001, 0, 0.055, -0.0098,
  new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 1, roughness: 0.3 }), 0); // gold pinstripe

const KEY_H = 0.02;
// Standard (not physical) materials and no key shadows: 88 keys stay cheap for the Quest GPU.
const ivory = { color: 0xf3efe6, roughness: 0.3 };
const ebony = { color: 0x0b0b0b, roughness: 0.22 };
const whiteGeo = new RoundedBoxGeometry(WHITE_W - 0.001, KEY_H, WHITE_L, 2, 0.0015).translate(0, 0, WHITE_L / 2);
const blackGeo = new RoundedBoxGeometry(keys.find(k => k.black).width - 0.001, KEY_H, keys.find(k => k.black).length, 2, 0.002)
  .translate(0, 0, keys.find(k => k.black).length / 2); // origin at the back edge: keys pivot like a real action
for (const k of keys) {
  k.down = 0;
  k.mesh = new THREE.Mesh(k.black ? blackGeo : whiteGeo, new THREE.MeshStandardMaterial(k.black ? ebony : ivory));
  k.mesh.position.set(k.x, k.top - KEY_H / 2, 0);
  k.mesh.receiveShadow = true;
  k.mesh.userData.key = k;
  piano.add(k.mesh);
}

// ---------- Pad bank left of the keys: two rows of drums in front, effect switches behind
const PAD = 0.052, GAP = 0.008, PAD_H = 0.012;
const bankW = 4 * PAD + 5 * GAP, bankD = 3 * PAD + 4 * GAP;
const bankX = -OUTER / 2 - 0.01 - bankW / 2, bankFront = WHITE_L + 0.012;
const bank = part(bankW, 0.04, bankD, bankX, -0.02, bankFront - bankD / 2);

// A w × h metre plane with centred white text, facing +z.
function label(text, w, h = w) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = Math.round(256 * h / w);
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff';
  let size = 40;
  do g.font = `bold ${size--}px system-ui, sans-serif`; while (g.measureText(text).width > canvas.width * 0.9 && size > 10);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, canvas.width / 2, canvas.height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
}
const pads = [...DRUMS, ...EFFECTS].map((def, n) => {
  const col = n % 4, row = Math.floor(n / 4); // row 0 is nearest to you
  const pad = { ...def, pad: true, down: 0, on: false, glow: 0, width: PAD, length: PAD, top: PAD_H,
    x: bankX - bankW / 2 + GAP + PAD / 2 + col * (PAD + GAP),
    z: bankFront - GAP - PAD - row * (PAD + GAP) };
  pad.mat = new THREE.MeshStandardMaterial({ color: 0x1d1d20, roughness: 0.8, emissive: def.color, emissiveIntensity: 0 });
  pad.mesh = new THREE.Mesh(new RoundedBoxGeometry(PAD, PAD_H, PAD, 2, 0.004), pad.mat);
  pad.restY = PAD_H / 2;
  pad.mesh.position.set(pad.x, pad.restY, pad.z + PAD / 2);
  pad.mesh.castShadow = pad.mesh.receiveShadow = true;
  const text = label(def.label, PAD * 0.9);
  text.rotation.x = -Math.PI / 2;
  text.position.y = PAD_H / 2 + 0.0005;
  pad.mesh.userData.key = text.userData.key = pad;
  pad.mesh.add(text);
  piano.add(pad.mesh);
  return pad;
});

// A soft contact shadow under the piano grounds it on your real table.
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(0.15, 0.8, 0.5);
sun.target = piano;
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.radius = 4;
Object.assign(sun.shadow.camera, { left: -1, right: 1, top: 0.4, bottom: -0.4, near: 0.1, far: 2 });
piano.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(OUTER + bankW + 0.3, 0.45), new THREE.ShadowMaterial({ opacity: 0.35 }));
ground.rotation.x = -Math.PI / 2;
ground.position.set(-(bankW + 0.01) / 2, -0.0505, 0.07);
ground.receiveShadow = true;
piano.add(ground);

// ---------- Guitar (chord mode). Pinch the neck to play: the body sits in front of your chest, the
// neck points at that hand, and how far up the neck the hand is picks the chord; the other hand
// strums over the sound hole. Pinch the body to carry it anywhere. Let go and it stays there.
const guitar = new THREE.Group();
guitar.matrixAutoUpdate = false;
scene.add(guitar);
function woodTexture(base, grain, lines) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const g = canvas.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = grain;
  for (let i = 0; i < lines; i++) { // grain runs along the neck
    const y = Math.random() * 512;
    g.globalAlpha = 0.05 + Math.random() * 0.15;
    g.lineWidth = 0.5 + Math.random() * 2;
    g.beginPath();
    g.moveTo(0, y);
    g.bezierCurveTo(170, y + Math.random() * 8 - 4, 340, y + Math.random() * 8 - 4, 512, y);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2); // the body's UVs are in metres: one tile per 50 cm
  return tex;
}
const spruce = new THREE.MeshPhysicalMaterial({ map: woodTexture('#dcb47e', '#8a5a2b', 260), roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.06 });
const rosewood = new THREE.MeshPhysicalMaterial({ map: woodTexture('#4a2312', '#1e0d05', 200), roughness: 0.45, clearcoat: 1, clearcoatRoughness: 0.1 });
const mahogany = new THREE.MeshPhysicalMaterial({ map: woodTexture('#6b3518', '#2e1408', 200), roughness: 0.4, clearcoat: 0.8 });
const ebonyBoard = new THREE.MeshStandardMaterial({ color: 0x1c130d, roughness: 0.6 });
const bone = new THREE.MeshStandardMaterial({ color: 0xf2ead8, roughness: 0.4 });
const metal = new THREE.MeshStandardMaterial({ color: 0xd9d4c7, metalness: 1, roughness: 0.25 });
function gpart(geo, mat, x, y, z) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  guitar.add(m);
  return m;
}
// Body: a dreadnought outline (half of it, neck joint to tail), mirrored and extruded. Top at z = 0.
const halfOutline = [[0.17, 0.035], [0.15, 0.1], [0.09, 0.142], [0.02, 0.145], [-0.05, 0.118], [-0.1, 0.125],
  [-0.18, 0.175], [-0.28, 0.19], [-0.37, 0.165], [-0.43, 0.09], [-0.445, 0]].map(([x, y]) => new THREE.Vector2(x, y));
const outline = [...halfOutline, ...halfOutline.slice(0, -1).reverse().map(v => new THREE.Vector2(v.x, -v.y))];
const bodyGeo = new THREE.ExtrudeGeometry(new THREE.Shape(new THREE.SplineCurve([...outline, outline[0]]).getPoints(160)),
  { depth: 0.085, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 3 });
bodyGeo.translate(0, 0, -0.089);
gpart(bodyGeo, [spruce, rosewood], 0, 0, 0);                                         // top and back, sides
gpart(new THREE.CircleGeometry(0.043, 48), new THREE.MeshBasicMaterial({ color: 0x080504 }), 0, 0, 0.0005); // sound hole
gpart(new THREE.RingGeometry(0.045, 0.05, 48), rosewood, 0, 0, 0.0005);              // rosette
gpart(new THREE.RingGeometry(0.051, 0.053, 48), bone, 0, 0, 0.0005);
const pickguard = gpart(new THREE.CircleGeometry(0.05, 32), new THREE.MeshPhysicalMaterial({ color: 0x3b1d0e, roughness: 0.3, clearcoat: 1 }), 0.03, -0.06, 0.0006);
pickguard.scale.set(1.4, 0.8, 1);
gpart(new RoundedBoxGeometry(0.03, 0.16, 0.008, 2, 0.003), rosewood, SADDLE - 0.006, 0, 0.004); // bridge
gpart(new THREE.BoxGeometry(0.003, 0.07, 0.004), bone, SADDLE, 0, 0.01);              // saddle
for (const y of STRING_Y) gpart(new THREE.SphereGeometry(0.0025, 8, 6), bone, SADDLE - 0.014, y, 0.008); // bridge pins

// Neck: mahogany shaft, ebony fretboard over the upper bout, real fret spacing, pearl dots, headstock with tuners.
gpart(new RoundedBoxGeometry(NUT - 0.15, 0.05, 0.022, 3, 0.008), mahogany, (0.15 + NUT) / 2, 0, -0.008);
gpart(new RoundedBoxGeometry(NUT - 0.05, 0.054, 0.006, 2, 0.002), ebonyBoard, (0.05 + NUT) / 2, 0, 0.007);
gpart(new THREE.BoxGeometry(0.004, 0.054, 0.006), bone, NUT, 0, 0.012);              // nut
const fretX = n => NUT - SCALE * (1 - 2 ** (-n / 12));
for (let n = 1; fretX(n) > 0.055; n++) {
  gpart(new THREE.BoxGeometry(0.0015, 0.054, 0.0015), metal, fretX(n), 0, 0.0105);
  const mid = (fretX(n) + fretX(n - 1)) / 2;
  for (const y of n === 12 ? [-0.012, 0.012] : [3, 5, 7, 9, 15, 17].includes(n) ? [0] : []) {
    gpart(new THREE.CircleGeometry(0.0035, 16), bone, mid, y, 0.0102);
  }
}
const headstock = gpart(new RoundedBoxGeometry(0.18, 0.08, 0.015, 2, 0.006), mahogany, NUT + 0.088, 0, -0.012);
headstock.rotation.y = 0.2; // angled back like a real headstock
for (let k = 0; k < 3; k++) for (const side of [-1, 1]) {
  const x = NUT + 0.045 + k * 0.045, z = -0.012 - (x - NUT) * 0.2;
  gpart(new THREE.CylinderGeometry(0.0045, 0.0045, 0.018, 12), metal, x, side * 0.048, z);     // tuner housing
  gpart(new THREE.SphereGeometry(0.008, 12, 8), bone, x, side * 0.064, z).scale.set(0.9, 0.5, 1.2); // button
}

const chordZones = CHORDS.map((chord, c) => {
  const x = NECK_START + (c + 0.5) * ZONE;
  const mat = new THREE.MeshBasicMaterial({ color: [0xff453a, 0xff9f0a, 0xffd60a, 0x30d158, 0x64d2ff, 0xbf5af2][c], transparent: true, opacity: 0.18, depthWrite: false });
  const zone = gpart(new THREE.PlaneGeometry(ZONE - 0.003, 0.052), mat, x, 0, 0.0106);
  const text = label(chord.name, ZONE - 0.003, 0.03);
  text.position.z = 0.001;
  zone.add(text);
  zone.userData.chord = text.userData.chord = c;
  return mat;
});
const strings = STRING_Y.map((y, s) => {
  const wound = s < 3, r = 0.0011 - s * 0.00011;
  const mat = new THREE.MeshStandardMaterial({ color: wound ? 0xc8a46b : 0xe6e6e6, metalness: 1, roughness: 0.3, emissive: 0xfff2c0, emissiveIntensity: 0 });
  const m = gpart(new THREE.CylinderGeometry(r, r, SCALE, 6), mat, (SADDLE + NUT) / 2, y, 0.014);
  m.rotation.z = Math.PI / 2;
  m.userData.string = s;
  return mat;
});

// held.mode: 'play' (pinched the neck) or 'carry' (pinched the body). After letting go it stays put.
const held = { hand: -1, mode: null, offset: new THREE.Matrix4() };
let guitarFree = false;                      // false until first picked up: rests by the piano
let chord = CHORDS.length - 1;
const restMatrix = new THREE.Matrix4()       // lying flat right of the piano, neck pointing away
  .makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0))
  .setPosition(OUTER / 2 + 0.3, 0.04, 0);
const guitarInverse = new THREE.Matrix4();

const guitarBuffers = {}, ringing = [], lastNote = [];
function pluckString(s, velocity) {
  const midi = CHORDS[chord].notes[s];
  if (midi == null) return;
  strings[s].emissiveIntensity = 1;
  if (MIDI) { // guitar on channel 2, so it can drive its own instrument in the DAW
    if (lastNote[s] != null) sendMidi([0x81, lastNote[s], 0]);
    sendMidi([0x91, midi, Math.max(1, Math.round(velocity * 127))]);
    lastNote[s] = midi;
    return;
  }
  if (!guitarBuffers[midi]) {
    const wave = pluck(440 * 2 ** ((midi - 69) / 12), audio.sampleRate);
    guitarBuffers[midi] = audio.createBuffer(1, wave.length, audio.sampleRate);
    guitarBuffers[midi].copyToChannel(wave, 0);
  }
  const now = audio.currentTime;
  if (ringing[s]) { // a string rings one note at a time
    ringing[s].gain.gain.setTargetAtTime(0, now, 0.02);
    ringing[s].src.stop(now + 0.15);
  }
  const src = audio.createBufferSource(), gain = audio.createGain();
  src.buffer = guitarBuffers[midi];
  gain.gain.value = velocity * 0.7;
  src.connect(gain).connect(fx);
  src.start();
  ringing[s] = { src, gain };
}

// A w × h metre panel whose text can change: panel.userData.show(['Title', 'line 2', ...]).
function textPanel(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = Math.round(512 * h / w);
  const g = canvas.getContext('2d'), tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  let shown = '';
  mesh.userData.show = lines => {
    if (lines.join('\n') === shown) return; // redraw only on change
    shown = lines.join('\n');
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = 'rgba(12, 14, 22, 0.85)';
    g.beginPath();
    g.roundRect(0, 0, canvas.width, canvas.height, 28);
    g.fill();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    lines.forEach((line, n) => {
      const size = canvas.height / (lines.length + 0.6) * (n ? 0.55 : 0.75);
      g.font = `${n ? '' : 'bold '}${Math.round(size)}px system-ui, sans-serif`;
      g.fillStyle = n ? '#b8c0d8' : '#fff';
      g.fillText(line, canvas.width / 2, canvas.height * (n + 0.8) / (lines.length + 0.6));
    });
    tex.needsUpdate = true;
  };
  return mesh;
}

// ---------- Marimba: rosewood bars over brass resonators. Strike the bars from above with your fingertips.
const marimba = new THREE.Group();
marimba.visible = false;
scene.add(marimba);
const bars = marimbaBars(57, 84); // A3–C6
const brass = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 1, roughness: 0.3 });
const barWood = woodTexture('#8a3b1c', '#3d1508', 160);
const halfSpan = Math.max(...bars.map(b => Math.abs(b.x))) + 0.04;
for (const bar of bars) {
  Object.assign(bar, { down: 0, glow: 0, restY: bar.top - 0.011 });
  bar.mesh = new THREE.Mesh(new RoundedBoxGeometry(bar.width, 0.022, bar.length, 2, 0.004),
    new THREE.MeshStandardMaterial({ map: barWood, roughness: 0.45, emissive: 0xffa040, emissiveIntensity: 0 }));
  bar.mesh.position.set(bar.x, bar.restY, bar.z + bar.length / 2);
  bar.mesh.castShadow = true;
  bar.mesh.userData.key = bar;
  marimba.add(bar.mesh);
  const tubeLen = 0.1 + 0.45 * (84 - bar.midi) / 27; // resonators shorten as pitch rises
  const resonator = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, tubeLen, 16, 1, true), brass);
  resonator.position.set(bar.x, bar.top - 0.045 - tubeLen / 2, bar.z + bar.length / 2);
  marimba.add(resonator);
  bar.onDown = v => {
    bar.mesh.position.y = bar.restY - 0.004;
    bar.glow = 1;
    if (MIDI) sendMidi([0x93, bar.midi, Math.max(1, Math.round(v * 127))]); // marimba on channel 4
    else marimbaNote(bar.midi, v);
  };
  bar.onUp = () => {
    bar.mesh.position.y = bar.restY;
    if (MIDI) sendMidi([0x83, bar.midi, 0]);
  };
}
for (const [z, y] of [[0.06, -0.032], [0.19, -0.032], [-0.1, -0.007], [-0.24, -0.007]]) { // rails under both rows
  const rail = new THREE.Mesh(new RoundedBoxGeometry(halfSpan * 2, 0.02, 0.025, 2, 0.006), rosewood);
  rail.position.set(0, y, z);
  marimba.add(rail);
}
for (const s of [-1, 1]) { // end boards: pinch one to carry the marimba
  const end = new THREE.Mesh(new RoundedBoxGeometry(0.04, 0.1, 0.62, 2, 0.01), rosewood);
  end.position.set(s * (halfSpan + 0.02), -0.035, -0.03);
  marimba.add(end);
}

// ---------- Theremin: played without touching. Right hand distance to the vertical antenna sets the
// pitch (closer = higher, snapped to the nearest semitone so it stays in tune); left hand height over
// the loop sets the volume (lower = quieter).
const thereminRig = new THREE.Group();
thereminRig.visible = false;
scene.add(thereminRig);
thereminRig.add(new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.12, 0.2, 3, 0.012), mahogany));
const ANTENNA = new THREE.Vector3(0.18, 0, -0.05), LOOP = new THREE.Vector3(-0.3, 0.03, 0);
const glowMetal = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 1, roughness: 0.2, emissive: 0x66ccff, emissiveIntensity: 0 });
const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.006, 0.5, 12), glowMetal);
antenna.position.set(ANTENNA.x, 0.31, ANTENNA.z);
const loop = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.004, 8, 48), glowMetal);
loop.rotation.x = Math.PI / 2;
loop.position.copy(LOOP);
const loopArm = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.06), metal);
loopArm.rotation.z = Math.PI / 2;
loopArm.position.set(-0.24, 0.03, 0);
const thereminDisplay = textPanel(0.3, 0.07);
thereminDisplay.position.set(0, 0, 0.101);
thereminRig.add(antenna, loop, loopArm, thereminDisplay);

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = midi => NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
let thereminNote = null;
const tA = new THREE.Vector3(), tB = new THREE.Vector3();
function updateTheremin() {
  const now = audio.currentTime;
  let volume = 0, pitch = null;
  const right = handIndex('right'), left = handIndex('left');
  if (thereminRig.visible && right >= 0 && left >= 0 && handPoint(right, tA) && handPoint(left, tB)) {
    thereminRig.worldToLocal(tA);
    thereminRig.worldToLocal(tB);
    const distance = Math.hypot(tA.x - ANTENNA.x, tA.z - ANTENNA.z); // to the vertical rod
    const overLoop = Math.hypot(tB.x - LOOP.x, tB.z - LOOP.z) < 0.25;
    pitch = Math.round(thereminPitch(distance));
    volume = overLoop && distance < 0.6 ? thereminVolume(tB.y - LOOP.y) : 0;
  }
  glowMetal.emissiveIntensity = volume;
  if (thereminRig.visible) {
    thereminDisplay.userData.show(pitch == null ? ['THEREMIN', 'Right hand: pitch · Left hand: volume']
      : [noteName(pitch), volume > 0.02 ? `volume ${Math.round(volume * 100)}%` : 'Raise your left hand over the loop']);
  }
  if (MIDI) { // theremin on channel 3, one note at a time
    const note = volume > 0.1 ? pitch : null;
    if (note === thereminNote) return;
    if (thereminNote != null) sendMidi([0x82, thereminNote, 0]);
    if (note != null) sendMidi([0x92, note, Math.round(volume * 127)]);
    thereminNote = note;
    return;
  }
  if (!thereminVoice && volume === 0) return;
  const voice = theremin();
  if (pitch != null) {
    voice.osc.frequency.setTargetAtTime(hz(pitch), now, 0.03);
    voice.soft.frequency.setTargetAtTime(hz(pitch), now, 0.03);
  }
  voice.gain.gain.setTargetAtTime(volume * 0.45, now, 0.05);
}

// ---------- Song guide on the piano: the keys of the next step light up green; play them to move on.
const guide = { on: false, song: 0, name: SONGS[0].name, steps: SONGS[0].steps, step: 0, hit: new Set(), wrong: new Map() };
const guidePanel = textPanel(0.5, 0.075);
guidePanel.position.set(0, 0.11, -0.026); // standing on the fallboard
guidePanel.rotation.x = -0.25;
guidePanel.visible = false;
piano.add(guidePanel);
function setGuide(on) {
  guide.on = on;
  guidePanel.visible = on;
}
function loadSong(name, steps) {
  Object.assign(guide, { name, steps, step: 0 });
  guide.hit.clear();
  setGuide(true);
}
function nextSong() {
  guide.song = (guide.song + 1) % SONGS.length;
  loadSong(SONGS[guide.song].name, SONGS[guide.song].steps);
}
function guideKey(midi) {
  if (!guide.on || guide.step >= guide.steps.length) return;
  const step = guide.steps[guide.step];
  if (!step.includes(midi)) return guide.wrong.set(midi, performance.now() + 300); // flash red
  guide.hit.add(midi);
  if (step.every(m => guide.hit.has(m))) {
    guide.step++;
    guide.hit.clear();
  }
}
function updateGuide() {
  const step = (guide.on && guide.steps[guide.step]) || [], next = (guide.on && guide.steps[guide.step + 1]) || [];
  const now = performance.now(), pulse = 0.6 + 0.4 * Math.sin(now / 120);
  for (const k of keys) {
    const todo = step.includes(k.midi) && !guide.hit.has(k.midi);
    const hex = k.down ? 0x0c1a3a : (guide.wrong.get(k.midi) ?? 0) > now ? 0x6a0000
      : todo ? 0x12a03a : next.includes(k.midi) ? 0x063015 : 0;
    k.mesh.material.emissive.setHex(hex);
    k.mesh.material.emissiveIntensity = todo && !k.down ? pulse : 1;
  }
  if (guide.on) {
    guidePanel.userData.show(guide.step >= guide.steps.length ? [guide.name, 'Bravo! Song complete'] : [guide.name, `${guide.step + 1} / ${guide.steps.length}`]);
  }
}

// ---------- Showing, hiding and summoning instruments
const view = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() }; // where you are and look, updated each frame
const vFwd = new THREE.Vector3(), vRight = new THREE.Vector3();
function viewBasis() {
  vFwd.set(0, 0, -1).applyQuaternion(view.quat).setY(0);
  if (vFwd.lengthSq() < 1e-4) vFwd.set(0, 0, -1);
  vFwd.normalize();
  vRight.crossVectors(vFwd, upward);
}
// Each instrument has its own spot in a half circle around you, so summoned instruments never pile up:
// [height below your eyes, distance, angle to your left in radians].
const SPOTS = new Map([[piano, [0.4, 0.5, 0]], [marimba, [0.6, 0.8, 1.2]], [thereminRig, [0.45, 0.85, -1.45]]]);
const GUITAR_SPOT = [0.6, 0.42, -1.85]; // on a stand at your right side, neck up
const spotDir = new THREE.Vector3();
function spot([drop, distance, angle], target) { // world position of a spot; sets spotDir to point at it
  viewBasis();
  spotDir.copy(vFwd).applyAxisAngle(upward, angle);
  return target.copy(view.pos).addScaledVector(spotDir, distance).setY(view.pos.y - drop);
}
function summon(obj) { // put it in its spot, facing you
  spot(SPOTS.get(obj), obj.position);
  obj.rotation.y = Math.atan2(-spotDir.x, -spotDir.z);
}
function toggle(obj) {
  obj.visible = !obj.visible;
  if (obj.visible) summon(obj);
}
function setPads(on) {
  bank.visible = on;
  for (const pad of pads) pad.mesh.visible = on;
}
function presentGuitar() { // standing in its spot like on a guitar stand: neck up, strings facing you
  const at = spot(GUITAR_SPOT, new THREE.Vector3());
  const facing = spotDir.clone().negate().setY(0).normalize();
  guitar.matrix.makeBasis(upward, new THREE.Vector3().crossVectors(facing, upward), facing).setPosition(at);
  guitarFree = true;
  held.hand = -1;
}
function toggleGuitar() {
  guitar.visible = !guitar.visible;
  held.hand = -1;
  if (guitar.visible) presentGuitar();
}
function bringHere() {
  for (const obj of SPOTS.keys()) if (obj.visible) summon(obj);
  if (guitar.visible) presentGuitar();
}

// ---------- Menu: in the headset, turn your left palm towards your face and it appears above your hand;
// poke the buttons with your right index finger. On a desktop (or before entering AR) it is a toolbar.
const MENU = [
  { label: 'PIANO', on: () => piano.visible, act: () => toggle(piano) },
  { label: 'PADS', on: () => bank.visible, act: () => setPads(!bank.visible) },
  { label: 'GUITAR', on: () => guitar.visible, act: toggleGuitar },
  { label: 'MARIMBA', on: () => marimba.visible, act: () => toggle(marimba) },
  { label: 'THEREMIN', on: () => thereminRig.visible, act: () => toggle(thereminRig) },
  { label: 'SONG GUIDE', on: () => guide.on, act: () => setGuide(!guide.on) },
  { label: 'NEXT SONG', on: () => false, act: nextSong },
  { label: 'BRING HERE', on: () => false, act: bringHere },
];
const menu = new THREE.Group();
menu.visible = false;
scene.add(menu);
const menuBg = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.215, 0.006, 2, 0.01),
  new THREE.MeshStandardMaterial({ color: 0x15161c, roughness: 0.4, transparent: true, opacity: 0.92 }));
menuBg.position.z = -0.006;
const menuTitle = label('QUEST PIANO', 0.18, 0.025);
menuTitle.position.set(0, 0.088, 0);
menu.add(menuBg, menuTitle);
const BTN_W = 0.085, BTN_H = 0.03;
MENU.forEach((item, n) => {
  item.mat = new THREE.MeshStandardMaterial({ color: 0x2c2f3a, roughness: 0.5, emissive: 0x0a84ff, emissiveIntensity: 0 });
  item.mesh = new THREE.Mesh(new RoundedBoxGeometry(BTN_W, BTN_H, 0.008, 2, 0.004), item.mat);
  item.mesh.position.set((n % 2 - 0.5) * (BTN_W + 0.01), 0.048 - Math.floor(n / 2) * (BTN_H + 0.008), 0);
  const text = label(item.label, BTN_W, BTN_H);
  text.position.z = 0.0045;
  item.mesh.add(text);
  menu.add(item.mesh);
});

const toolbar = document.createElement('div');
toolbar.style.cssText = 'position:fixed;top:10px;left:10px;right:10px;display:flex;flex-wrap:wrap;gap:6px;font:12px system-ui,sans-serif;z-index:10';
const buttonCss = 'padding:6px 10px;border-radius:8px;border:1px solid #444;color:#eee;cursor:pointer;';
for (const item of MENU) {
  item.button = document.createElement('button');
  item.button.textContent = item.label;
  item.button.onclick = () => { item.act(); refreshToolbar(); };
  toolbar.append(item.button);
}
const midiLabel = document.createElement('label'), midiInput = document.createElement('input'), status = document.createElement('span');
midiInput.type = 'file';
midiInput.accept = '.mid,.midi';
midiInput.style.display = 'none';
midiLabel.style.cssText = buttonCss + 'background:#1f6f3a;';
midiLabel.append('LOAD MIDI SONG', midiInput);
status.style.cssText = 'color:#aaa;align-self:center;';
toolbar.append(midiLabel, status);
document.body.append(toolbar);
function refreshToolbar() {
  for (const item of MENU) item.button.style.cssText = buttonCss + `background:${item.on() ? '#0a84ff' : '#222'};`;
}
refreshToolbar();
setInterval(refreshToolbar, 500); // reflects changes made from the in-headset menu
midiInput.onchange = async () => {
  const file = midiInput.files[0];
  if (!file) return;
  try {
    const steps = parseMidi(await file.arrayBuffer());
    if (!steps.length) throw new Error('no piano notes found');
    loadSong(file.name.replace(/\.midi?$/i, ''), steps);
    if (!piano.visible) toggle(piano);
    status.textContent = `Loaded "${guide.name}": ${steps.length} steps`;
  } catch (e) {
    status.textContent = `Could not read that MIDI file (${e.message})`;
  }
  refreshToolbar();
};

function press(k, speed) {
  if (k.down++) return;
  const velocity = THREE.MathUtils.clamp(speed / 0.5, 0.25, 1); // faster strike = louder
  if (k.onDown) return k.onDown(velocity);
  if (k.pad) {
    k.mesh.position.y = k.restY - 0.004;
    if (!k.play) return k.set(k.on = !k.on); // effect pads toggle
    k.glow = 1.6;
    if (MIDI) sendMidi([0x99, k.note, Math.round(velocity * 127)]);
    else k.play(velocity);
    return;
  }
  noteOn(k.midi, velocity);
  guideKey(k.midi);
  k.mesh.rotation.x = 0.06; // front edge dips ~9 mm (colour comes from updateGuide)
}
function release(k) {
  if (--k.down) return;
  if (k.onUp) return k.onUp();
  if (k.pad) {
    k.mesh.position.y = k.restY;
    if (k.play && MIDI) sendMidi([0x89, k.note, 0]);
    return;
  }
  noteOff(k.midi);
  k.mesh.rotation.x = 0;
}

// Everything you can play by touching, per instrument (each in its own local space), only while shown.
const pianoTargets = [...keys, ...pads];
const playables = [
  { space: piano, list: () => (!piano.visible ? [] : bank.visible ? pianoTargets : keys) },
  { space: marimba, list: () => (marimba.visible ? bars : []) },
];
// Pinch these parts to carry an instrument.
const grabbables = [
  { obj: piano, test: l => Math.abs(l.x) <= OUTER / 2 && l.z > -0.1 && l.z < 0.02 && l.y > -0.03 && l.y < 0.16 }, // back panel
  { obj: marimba, test: l => Math.abs(l.x) > halfSpan - 0.03 && Math.abs(l.x) < halfSpan + 0.12 && l.y > -0.15 && l.y < 0.12 }, // end boards
  { obj: thereminRig, test: l => Math.abs(l.x) < 0.25 && Math.abs(l.y) < 0.12 && Math.abs(l.z) < 0.15 }, // cabinet
];

// ---------- Desktop fallback: click keys and pads with the mouse
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let mouseKey = null;
renderer.domElement.addEventListener('pointerdown', e => {
  ndc.set(e.clientX / innerWidth * 2 - 1, -e.clientY / innerHeight * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const meshes = playables.flatMap(inst => inst.list().map(k => k.mesh));
  const hit = ray.intersectObjects(guitar.visible ? [...meshes, guitar] : meshes)[0]?.object.userData ?? {};
  if (hit.chord != null) chord = hit.chord;
  if (hit.string != null) pluckString(hit.string, 0.6);
  mouseKey = hit.key ?? null;
  if (mouseKey) press(mouseKey, 0.35);
});
addEventListener('pointerup', () => { if (mouseKey) release(mouseKey); mouseKey = null; });

// ---------- XR input: every fingertip (or controller tip) is a probe that can press keys and pads
const TIPS = ['thumb-tip', 'index-finger-tip', 'middle-finger-tip', 'ring-finger-tip', 'pinky-finger-tip'];
const CTRL_TIP = new THREE.Vector3(0, 0, -0.06);
const tipMat = new THREE.MeshStandardMaterial({ color: 0x4da3ff, emissive: 0x0a2a55 });
const probes = [];
const pinchTmp = new THREE.Vector3();
let drag = null;

function pinchPos(i, v) {
  const ctrl = renderer.xr.getController(i);
  if (ctrl.userData.isHand) {
    // Midway between thumb and index tip: where the fingers meet, even on the frame the pinch is
    // detected and the joints still show the fingers apart.
    const joints = renderer.xr.getHand(i).joints, thumb = joints['thumb-tip'], index = joints['index-finger-tip'];
    if (!thumb?.visible || !index?.visible) return null; // a lost hand must not keep holding anything
    return thumb.getWorldPosition(v).add(index.getWorldPosition(pinchTmp)).multiplyScalar(0.5);
  }
  return ctrl.visible ? ctrl.localToWorld(v.copy(CTRL_TIP)) : null;
}
function handIndex(handedness) { // input index of the left or right hand (the order is not fixed)
  for (const i of [0, 1]) if (renderer.xr.getController(i).userData.handedness === handedness) return i;
  return -1;
}

for (let i = 0; i < 2; i++) {
  const hand = renderer.xr.getHand(i), ctrl = renderer.xr.getController(i);
  scene.add(hand, ctrl);
  const marker = new THREE.Mesh(new THREE.SphereGeometry(0.008), tipMat);
  marker.position.copy(CTRL_TIP);
  ctrl.add(marker);
  ctrl.addEventListener('connected', e => {
    Object.assign(ctrl.userData, { isHand: !!e.data.hand, handedness: e.data.handedness });
    marker.visible = !e.data.hand;
  });
  ctrl.addEventListener('disconnected', () => { ctrl.userData.handedness = null; });
  ctrl.addEventListener('selectstart', () => {
    const p = pinchPos(i, new THREE.Vector3());
    if (!p) return;
    if (held.hand < 0 && guitar.visible) {
      const g = p.clone().applyMatrix4(guitarInverse.copy(guitar.matrixWorld).invert());
      // Generous zones: the pinch fires while the fingers are still closing, ~7 cm off the surface.
      const onNeck = g.x > 0.15 && g.x < NUT + 0.2 && Math.abs(g.y) < 0.08 && g.z > -0.08 && g.z < 0.12;
      const onBody = g.x > -0.47 && g.x <= 0.15 && Math.abs(g.y) < 0.22 && g.z > -0.15 && g.z < 0.12;
      const hand = handMatrix(i);
      if ((onNeck || onBody) && hand) {
        Object.assign(held, { hand: i, mode: onNeck ? 'play' : 'carry' });
        held.offset.copy(hand).invert().multiply(guitar.matrix); // carry keeps the guitar where you grabbed it
        guitarFree = true;
        return;
      }
    }
    for (const { obj, test } of grabbables) {
      if (!obj.visible) continue;
      const local = obj.worldToLocal(p.clone());
      // Keep the grab point under your fingers, so grabbing the middle brings the middle to you.
      if (test(local)) { drag = { i, local, obj }; return; }
    }
  });
  ctrl.addEventListener('selectend', () => {
    if (drag?.i === i) drag = null;
    if (held.hand === i) held.hand = -1; // let go: the guitar stays where it is
  });

  for (const tip of TIPS) {
    probes.push({ pos: v => {
      const j = hand.joints[tip];
      return ctrl.userData.isHand && j?.visible ? j.getWorldPosition(v) : null;
    } });
  }
  probes.push({ pos: v => (ctrl.visible && !ctrl.userData.isHand ? ctrl.localToWorld(v.copy(CTRL_TIP)) : null) });
}

// Invisible depth-only capsules along every finger bone, so your real fingers appear in front of the keys.
const occluderMat = new THREE.MeshBasicMaterial({ colorWrite: false });
const ball = new THREE.SphereGeometry(1, 12, 8);
const tube = new THREE.CylinderGeometry(1, 1, 1, 10);
const FINGERS = [
  ['wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'],
  ...['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'].map(f =>
    ['wrist', `${f}-metacarpal`, `${f}-phalanx-proximal`, `${f}-phalanx-intermediate`, `${f}-phalanx-distal`, `${f}-tip`]),
  // across the knuckles, so the palm is covered too
  ['index-finger-phalanx-proximal', 'middle-finger-phalanx-proximal', 'ring-finger-phalanx-proximal', 'pinky-finger-phalanx-proximal'],
  ['index-finger-metacarpal', 'middle-finger-metacarpal', 'ring-finger-metacarpal', 'pinky-finger-metacarpal'],
];
const bones = [0, 1].map(() => FINGERS.flatMap(chain => chain.slice(1).map((b, n) => {
  const mesh = new THREE.Mesh(tube, occluderMat);
  mesh.renderOrder = -1;
  scene.add(mesh);
  return { a: chain[n], b, mesh };
})));
const UP = new THREE.Vector3(0, 1, 0), ja = new THREE.Vector3(), jb = new THREE.Vector3();

function updateOccluders() {
  for (let i = 0; i < 2; i++) {
    const joints = renderer.xr.getHand(i).joints;
    for (const j of Object.values(joints)) {
      if (!j.userData.occluder) {
        j.userData.occluder = new THREE.Mesh(ball, occluderMat);
        j.userData.occluder.renderOrder = -1;
        j.add(j.userData.occluder);
      }
      j.userData.occluder.scale.setScalar(j.jointRadius || 0.008);
    }
    for (const bone of bones[i]) {
      const a = joints[bone.a], b = joints[bone.b];
      bone.mesh.visible = !!(a?.visible && b?.visible);
      if (!bone.mesh.visible) continue;
      a.getWorldPosition(ja);
      b.getWorldPosition(jb);
      const r = Math.min(a.jointRadius || 0.008, b.jointRadius || 0.008);
      bone.mesh.position.addVectors(ja, jb).multiplyScalar(0.5);
      bone.mesh.quaternion.setFromUnitVectors(UP, jb.sub(ja).normalize());
      bone.mesh.scale.set(r, ja.distanceTo(bone.mesh.position) * 2, r);
    }
  }
}

// ---------- Guitar each frame: follow the holding hand, pick the chord, detect strums
const STRUM_TIPS = ['thumb-tip', 'index-finger-tip', 'middle-finger-tip'];
const strumPrev = [], lastPluck = [];
const gx = new THREE.Vector3(), gy = new THREE.Vector3(), gz = new THREE.Vector3(), anchor = new THREE.Vector3();
const grip = new THREE.Vector3(), tip = new THREE.Vector3(), upward = new THREE.Vector3(0, 1, 0);
function handPoint(i, v) { // where a hand holds the neck: its middle knuckle, or the controller tip
  const ctrl = renderer.xr.getController(i);
  if (!ctrl.userData.isHand) return ctrl.visible ? ctrl.localToWorld(v.copy(CTRL_TIP)) : null;
  const j = renderer.xr.getHand(i).joints['middle-finger-phalanx-proximal'];
  return j?.visible ? j.getWorldPosition(v) : null;
}
function handMatrix(i) { // a hand's wrist pose, or the controller pose
  const ctrl = renderer.xr.getController(i);
  if (!ctrl.userData.isHand) return ctrl.visible ? ctrl.matrixWorld : null;
  const wrist = renderer.xr.getHand(i).joints.wrist;
  return wrist?.visible ? wrist.matrixWorld : null;
}
function updateGuitar(pose, dt) {
  const playing = held.hand >= 0 && held.mode === 'play';
  if (!guitarFree) {
    guitar.matrix.multiplyMatrices(piano.matrixWorld, restMatrix);
  } else if (held.hand >= 0 && held.mode === 'carry') {
    const hand = handMatrix(held.hand); // a lost hand keeps the guitar where it was
    if (hand) guitar.matrix.multiplyMatrices(hand, held.offset);
  } else if (playing && pose && handPoint(held.hand, grip)) {
    // Body in front of your chest, neck pointing at the holding hand, top tilted up so you see the strings.
    fwd.set(0, 0, -1).applyQuaternion(quat.copy(pose.transform.orientation)).setY(0).normalize();
    gy.crossVectors(fwd, upward); // your right
    anchor.copy(head).addScaledVector(upward, -0.45).addScaledVector(fwd, 0.22).addScaledVector(gy, 0.08);
    gx.subVectors(grip, anchor).normalize();
    gz.copy(fwd).addScaledVector(upward, 1.2);
    gz.addScaledVector(gx, -gz.dot(gx)).normalize();
    gy.crossVectors(gz, gx);
    guitar.matrix.makeBasis(gx, gy, gz).setPosition(anchor);
    chord = chordAt(grip.distanceTo(anchor));
  }
  guitar.matrixWorldNeedsUpdate = true;
  guitar.updateMatrixWorld();
  chordZones.forEach((mat, c) => { mat.opacity = c === chord ? 0.7 : 0.18; });
  for (const mat of strings) mat.emissiveIntensity = Math.max(0, mat.emissiveIntensity - dt * 5);
  if (!playing) return;

  guitarInverse.copy(guitar.matrixWorld).invert();
  const strummer = 1 - held.hand, hand = renderer.xr.getHand(strummer), sctrl = renderer.xr.getController(strummer);
  for (let n = 0; n < STRUM_TIPS.length; n++) {
    const j = hand.joints[STRUM_TIPS[n]];
    const found = sctrl.userData.isHand ? j?.visible && j.getWorldPosition(tip)
      : n === 0 && sctrl.visible && sctrl.localToWorld(tip.copy(CTRL_TIP));
    if (!found) { strumPrev[n] = undefined; continue; }
    tip.applyMatrix4(guitarInverse);
    const over = tip.x > -0.13 && tip.x < 0.08 && tip.z > -0.01 && tip.z < 0.05 && Math.abs(tip.y) < 0.08; // over the sound hole
    if (over && strumPrev[n] !== undefined) {
      const speed = Math.abs(tip.y - strumPrev[n]) / dt;
      for (const s of crossed(strumPrev[n], tip.y)) {
        if (performance.now() - (lastPluck[s] || 0) < 50) continue; // fingertips crossing together pluck once
        lastPluck[s] = performance.now();
        pluckString(s, THREE.MathUtils.clamp(speed / 1.2, 0.3, 1)); // faster strum = louder
      }
    }
    strumPrev[n] = over ? tip.y : undefined;
  }
}

// ---------- Hand menu each frame: show it while the left palm faces you, poke buttons with the right index
const mWrist = new THREE.Vector3(), mIndex = new THREE.Vector3(), mPinky = new THREE.Vector3(), palm = new THREE.Vector3();
const mCentre = new THREE.Vector3(), toHead = new THREE.Vector3(), pokeTip = new THREE.Vector3(), pokeLocal = new THREE.Vector3();
let menuCooldown = 0;
function updateMenu() {
  const li = handIndex('left'), ri = handIndex('right');
  const joints = li >= 0 && renderer.xr.getController(li).userData.isHand && renderer.xr.getHand(li).joints;
  let facing = 0;
  if (joints && ['wrist', 'index-finger-metacarpal', 'pinky-finger-metacarpal'].every(n => joints[n]?.visible)) {
    joints.wrist.getWorldPosition(mWrist);
    joints['index-finger-metacarpal'].getWorldPosition(mIndex);
    joints['pinky-finger-metacarpal'].getWorldPosition(mPinky);
    mCentre.copy(mWrist).add(mIndex).add(mPinky).divideScalar(3);
    // pinky × index points out of the left palm (index × pinky is the back of the hand: checked in the emulator)
    palm.crossVectors(mPinky.sub(mWrist), mIndex.sub(mWrist)).normalize();
    facing = palm.dot(toHead.subVectors(view.pos, mCentre).normalize());
  }
  menu.visible = menu.visible ? facing > 0.35 : facing > 0.6; // hysteresis: no flicker at the edge
  if (!menu.visible) return;
  menu.position.copy(mCentre).addScaledVector(palm, 0.07).addScaledVector(upward, 0.1);
  menu.lookAt(view.pos);
  menu.updateMatrixWorld();
  const tipJoint = ri >= 0 && renderer.xr.getHand(ri).joints['index-finger-tip'];
  const tipSeen = tipJoint?.visible && tipJoint.getWorldPosition(pokeTip);
  const now = performance.now();
  for (const item of MENU) {
    let touching = false;
    if (tipSeen) {
      item.mesh.worldToLocal(pokeLocal.copy(pokeTip));
      touching = Math.abs(pokeLocal.x) < BTN_W / 2 && Math.abs(pokeLocal.y) < BTN_H / 2 && pokeLocal.z < 0.015 && pokeLocal.z > -0.025;
    }
    if (touching && !item.touching && now > menuCooldown) {
      item.act();
      menuCooldown = now + 400;
    }
    item.touching = touching;
    item.mesh.position.z = touching ? -0.004 : 0;
    item.mat.emissiveIntensity = item.on() ? 0.8 : touching ? 0.3 : 0;
  }
}

// ---------- Loop
let last = 0, placed = false;
renderer.xr.addEventListener('sessionstart', () => { placed = false; held.hand = -1; guitarFree = false; });
if (window.xrDevice) { // handle for emulator.html tests
  window.app = { THREE, renderer, camera, piano, guitar, held, keys, pads, strings, bars, marimba, thereminRig, menu, MENU, guide,
    getChord: () => chord, getVoice: () => thereminVoice, view };
}
const head = new THREE.Vector3(), fwd = new THREE.Vector3(), quat = new THREE.Quaternion();
const p = new THREE.Vector3(), tmp = new THREE.Vector3();

renderer.setAnimationLoop((t, frame) => {
  const dt = Math.max((t - last) / 1000, 1e-3);
  last = t;

  const pose = frame?.getViewerPose(renderer.xr.getReferenceSpace());
  if (pose) {
    view.pos.copy(pose.transform.position);
    view.quat.copy(pose.transform.orientation);
  } else {
    view.pos.copy(camera.position);
    view.quat.copy(camera.quaternion);
  }
  if (pose) {
    head.copy(pose.transform.position);
    if (!placed) {
      // First frame in XR: put the piano in front of you at about table height.
      fwd.set(0, 0, -1).applyQuaternion(quat.copy(pose.transform.orientation)).setY(0);
      if (fwd.lengthSq() > 1e-4) {
        fwd.normalize();
        piano.position.copy(head).addScaledVector(fwd, 0.5).setY(head.y - 0.4);
        piano.rotation.y = Math.atan2(-fwd.x, -fwd.z);
        placed = true;
      }
    }
    if (drag && !pinchPos(drag.i, p)) drag = null;
    if (drag) {
      // Turn smoothly towards you instead of snapping every frame, so it does not swing in your hand.
      const obj = drag.obj;
      const want = Math.atan2(head.x - obj.position.x, head.z - obj.position.z);
      const turn = Math.atan2(Math.sin(want - obj.rotation.y), Math.cos(want - obj.rotation.y));
      obj.rotation.y += turn * Math.min(1, dt * 4);
      obj.position.copy(p).sub(tmp.copy(drag.local).applyQuaternion(obj.quaternion));
    }
    updateOccluders();
  }
  lacquer.emissive.setHex(drag?.obj === piano ? 0x0a1a33 : 0x000000); // the case glows while you carry it
  for (const pad of pads) {
    if (pad.play) pad.glow = Math.max(0, pad.glow - dt * 4);
    pad.mat.emissiveIntensity = pad.play ? Math.max(0.06, pad.glow) : pad.on ? 1 : 0.1;
  }
  for (const bar of bars) {
    bar.glow = Math.max(0, bar.glow - dt * 3);
    bar.mesh.material.emissiveIntensity = bar.glow * 0.5;
  }
  for (const { space } of playables) space.updateMatrixWorld();
  thereminRig.updateMatrixWorld();
  updateGuitar(pose, dt);
  updateTheremin();
  updateGuide();
  updateMenu();

  for (const probe of probes) {
    let key = null, speed = 0;
    if (probe.pos(p)) {
      speed = Math.max(0, (probe.lastY ?? p.y) - p.y) / dt; // downward speed: every playing surface is level
      probe.lastY = p.y;
      // While carrying something your fingers brush the keys: play nothing until you let go.
      if (!drag) {
        for (const inst of playables) {
          const list = inst.list();
          if (!list.length) continue;
          inst.space.worldToLocal(tmp.copy(p));
          key = keyAt(list, tmp.x, tmp.y, tmp.z, list.includes(probe.key) ? probe.key : undefined);
          if (key) break;
        }
      }
    } else probe.lastY = undefined;
    if (key !== probe.key) {
      if (probe.key) release(probe.key);
      if (key) press(key, speed);
      probe.key = key;
    }
  }

  renderer.render(scene, camera);
});
