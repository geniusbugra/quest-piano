import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildKeys, keyAt, WHITE_W, WHITE_L } from './keys.js';

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
camera.position.set(-0.15, 1.5, 1.05);
camera.lookAt(-0.15, 1, -0.2);
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

function label(text) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff';
  g.font = 'bold 20px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(PAD * 0.9, PAD * 0.9), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = PAD_H / 2 + 0.0005;
  return m;
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
  const text = label(def.label);
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
  mouseKey = ray.intersectObjects(targets.map(k => k.mesh))[0]?.object.userData.key ?? null;
  if (mouseKey) press(mouseKey, 0.35);
});
addEventListener('pointerup', () => { if (mouseKey) release(mouseKey); mouseKey = null; });

// ---------- XR input: every fingertip (or controller tip) is a probe that can press keys and pads
const TIPS = ['thumb-tip', 'index-finger-tip', 'middle-finger-tip', 'ring-finger-tip', 'pinky-finger-tip'];
const CTRL_TIP = new THREE.Vector3(0, 0, -0.06);
const tipMat = new THREE.MeshStandardMaterial({ color: 0x4da3ff, emissive: 0x0a2a55 });
const probes = [];
let drag = null;

function pinchPos(i, v) {
  const ctrl = renderer.xr.getController(i);
  if (ctrl.userData.isHand) {
    const thumb = renderer.xr.getHand(i).joints['thumb-tip'];
    return thumb?.visible ? thumb.getWorldPosition(v) : null; // a lost hand must not keep holding the piano
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
    const local = piano.worldToLocal(p.clone());
    const onFallboard = Math.abs(local.x) <= OUTER / 2 && local.z > -0.08 && local.z < 0.01 && local.y > -0.03 && local.y < 0.1;
    // Keep the grab point under your fingers, so grabbing the middle brings the middle to you.
    if (onFallboard) drag = { i, local };
  });
  ctrl.addEventListener('selectend', () => { if (drag?.i === i) drag = null; });

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

// ---------- Loop
let last = 0, placed = false;
renderer.xr.addEventListener('sessionstart', () => { placed = false; });
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
