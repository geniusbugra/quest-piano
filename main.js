import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildKeys, keyAt, WHITE_W, WHITE_L } from './keys.js';
import { CHORDS, chordAt, crossed, pluck, STRING_Y, NECK_START, ZONE, SADDLE, NUT, SCALE } from './guitar.js';

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

// ---------- Scene
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); // alpha = passthrough shows behind
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
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
const ivory = { color: 0xf3efe6, roughness: 0.35, clearcoat: 0.3, clearcoatRoughness: 0.2 };
const ebony = { color: 0x0b0b0b, roughness: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.1 };
for (const k of keys) {
  k.down = 0;
  const geo = new RoundedBoxGeometry(k.width - 0.001, KEY_H, k.length, 2, k.black ? 0.002 : 0.0015);
  geo.translate(0, 0, k.length / 2); // origin at the back edge: keys pivot like a real action
  k.mesh = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial(k.black ? ebony : ivory));
  k.mesh.position.set(k.x, k.top - KEY_H / 2, 0);
  k.mesh.castShadow = k.mesh.receiveShadow = true;
  k.mesh.userData.key = k;
  piano.add(k.mesh);
}

// ---------- Pad bank left of the keys: two rows of drums in front, effect switches behind
const PAD = 0.052, GAP = 0.008, PAD_H = 0.012;
const bankW = 4 * PAD + 5 * GAP, bankD = 3 * PAD + 4 * GAP;
const bankX = -OUTER / 2 - 0.01 - bankW / 2, bankFront = WHITE_L + 0.012;
part(bankW, 0.04, bankD, bankX, -0.02, bankFront - bankD / 2);

// A w × h metre plane with centred white text, facing +z.
function label(text, w, h = w) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = Math.round(256 * h / w);
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff';
  g.font = 'bold 40px system-ui, sans-serif';
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
const targets = [...keys, ...pads];

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

function press(k, speed) {
  if (k.down++) return;
  const velocity = THREE.MathUtils.clamp(speed / 0.5, 0.25, 1); // faster strike = louder
  if (k.pad) {
    k.mesh.position.y = k.restY - 0.004;
    if (!k.play) return k.set(k.on = !k.on); // effect pads toggle
    k.glow = 1.6;
    if (MIDI) sendMidi([0x99, k.note, Math.round(velocity * 127)]);
    else k.play(velocity);
    return;
  }
  noteOn(k.midi, velocity);
  k.mesh.rotation.x = 0.06; // front edge dips ~9 mm
  k.mesh.material.emissive.setHex(0x0c1a3a);
}
function release(k) {
  if (--k.down) return;
  if (k.pad) {
    k.mesh.position.y = k.restY;
    if (k.play && MIDI) sendMidi([0x89, k.note, 0]);
    return;
  }
  noteOff(k.midi);
  k.mesh.rotation.x = 0;
  k.mesh.material.emissive.setHex(0x000000);
}

// ---------- Desktop fallback: click keys and pads with the mouse
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let mouseKey = null;
renderer.domElement.addEventListener('pointerdown', e => {
  ndc.set(e.clientX / innerWidth * 2 - 1, -e.clientY / innerHeight * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects([...targets.map(k => k.mesh), guitar])[0]?.object.userData ?? {};
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

for (let i = 0; i < 2; i++) {
  const hand = renderer.xr.getHand(i), ctrl = renderer.xr.getController(i);
  scene.add(hand, ctrl);
  const marker = new THREE.Mesh(new THREE.SphereGeometry(0.008), tipMat);
  marker.position.copy(CTRL_TIP);
  ctrl.add(marker);
  ctrl.addEventListener('connected', e => { ctrl.userData.isHand = !!e.data.hand; marker.visible = !e.data.hand; });
  ctrl.addEventListener('selectstart', () => {
    const p = pinchPos(i, new THREE.Vector3());
    if (!p) return;
    if (held.hand < 0) {
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
    const local = piano.worldToLocal(p.clone());
    const onFallboard = Math.abs(local.x) <= OUTER / 2 && local.z > -0.1 && local.z < 0.02 && local.y > -0.03 && local.y < 0.16;
    // Keep the grab point under your fingers, so grabbing the middle brings the middle to you.
    if (onFallboard) drag = { i, local };
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

// ---------- Loop
let last = 0, placed = false;
renderer.xr.addEventListener('sessionstart', () => { placed = false; held.hand = -1; guitarFree = false; });
if (window.xrDevice) window.app = { THREE, renderer, piano, guitar, held, keys, pads, strings, getChord: () => chord }; // handle for emulator.html tests
const head = new THREE.Vector3(), fwd = new THREE.Vector3(), quat = new THREE.Quaternion();
const p = new THREE.Vector3(), tmp = new THREE.Vector3();

renderer.setAnimationLoop((t, frame) => {
  const dt = Math.max((t - last) / 1000, 1e-3);
  last = t;

  const pose = frame?.getViewerPose(renderer.xr.getReferenceSpace());
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
      // Turn smoothly towards you instead of snapping every frame, so the piano does not swing in your hand.
      const want = Math.atan2(head.x - piano.position.x, head.z - piano.position.z);
      const turn = Math.atan2(Math.sin(want - piano.rotation.y), Math.cos(want - piano.rotation.y));
      piano.rotation.y += turn * Math.min(1, dt * 4);
      piano.position.copy(p).sub(tmp.copy(drag.local).applyQuaternion(piano.quaternion));
    }
    updateOccluders();
  }
  lacquer.emissive.setHex(drag ? 0x0a1a33 : 0x000000); // the case glows while you carry it
  for (const pad of pads) {
    if (pad.play) pad.glow = Math.max(0, pad.glow - dt * 4);
    pad.mat.emissiveIntensity = pad.play ? Math.max(0.06, pad.glow) : pad.on ? 1 : 0.1;
  }
  piano.updateMatrixWorld();
  updateGuitar(pose, dt);

  for (const probe of probes) {
    let key = null, speed = 0;
    if (probe.pos(p)) {
      piano.worldToLocal(p);
      // While carrying the piano your fingers brush the keys: play nothing until you let go.
      key = drag ? null : keyAt(targets, p.x, p.y, p.z, probe.key);
      speed = Math.max(0, (probe.lastY ?? p.y) - p.y) / dt;
      probe.lastY = p.y;
    } else probe.lastY = undefined;
    if (key !== probe.key) {
      if (probe.key) release(probe.key);
      if (key) press(key, speed);
      probe.key = key;
    }
  }

  renderer.render(scene, camera);
});
