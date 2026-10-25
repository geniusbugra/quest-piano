# Quest Piano: a hands-only MIDI keyboard for Meta Quest 3

**Play a real-size, 88-key piano on your desk with your bare hands, and use it as a MIDI keyboard in FL Studio or any DAW. No controllers, no install.**

Quest Piano is a mixed reality instrument built around Quest's hand tracking. The keyboard appears in your real room through passthrough. You can place it on a real table and play it with all ten fingers. Every key you press can go straight into your music software as MIDI.

## Why it is different

- **Hands only, end to end.** It is designed for Quest's current hand tracking (Hand Tracking 2.x). Every fingertip of both hands is a key probe, so chords, runs and two-handed playing work. Controllers are optional.
- **Velocity from your fingers.** How fast your fingertip comes down sets how loud the note is, like a real piano action.
- **Real size, real feel.** 88 keys (A0–C8) at true piano dimensions. The keys pivot like a real action. A sampled grand piano plays through the headset.
- **Your hands stay in front.** Depth-only hand occluders let your real fingers render over the virtual keys, so you see your own hands on the keyboard.
- **Put it where you play.** Pinch anywhere on the back panel to carry the piano onto a real desk. It always turns to face you.
- **A MIDI controller for any DAW.** A small desktop bridge opens a virtual MIDI input called "Quest Piyano". FL Studio, Ableton Live, Reaper and others see it as a regular keyboard.
- **No install on the headset.** It runs in the Quest browser with WebXR. You open a link and play.

## Try it

**Headset only (built-in piano sound):** open **https://geniusbugra.github.io/quest-piano/** in the Quest browser and press **START AR**.

**As a MIDI keyboard for your DAW (Windows):**

1. Install [loopMIDI](https://www.tobias-erichsen.de/software/loopmidi.html). Its driver provides the virtual MIDI port.
2. Run `python midi_bridge.py`. You need Python 3.12+ and `pip install websockets`. This serves the app and creates the "Quest Piyano" MIDI input.
3. Expose it to the headset over HTTPS, for example with `cloudflared tunnel --url http://localhost:8000`.
4. On the Quest, open `https://<your-address>/?midi`. The built-in sound mutes and your DAW makes the sound.
5. In FL Studio, go to **Options → MIDI settings**, enable **Quest Piyano**, and play.

## How it works

| Part | File |
|------|------|
| Key layout and fingertip hit test with hysteresis | `keys.js` |
| WebXR scene, hand probes, velocity, occluders, sound, MIDI out | `main.js` |
| Static server + WebSocket → virtual MIDI port (teVirtualMIDI) | `midi_bridge.py` |

Built with three.js (WebXR) and the Web Audio API. The bridge accepts only well-formed note on/off messages.

## Tests

- `npm test` checks the key layout and the fingertip hit logic.
- `python midi_bridge_test.py` (while the bridge runs) listens on the MIDI port like a DAW and checks that notes arrive and junk is dropped.

## Credits

- Piano samples: Salamander Grand Piano V3 by Alexander Holm, CC-BY 3.0.
- Virtual MIDI driver: teVirtualMIDI / loopMIDI by Tobias Erichsen.
- Developed with the help of an AI coding assistant (Claude Code).

## License

The code is MIT licensed (see `LICENSE`). The piano samples keep their own CC-BY 3.0 license.
