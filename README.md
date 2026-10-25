# Quest Piano: a hands-only music studio for Meta Quest 3

**Five instruments in your real room: a real-size 88-key piano with drum pads, a guitar you hold, a marimba and a theremin. You play all of them with your bare hands, they can teach you songs, and they drive FL Studio or any DAW over MIDI. No controllers, no install.**

Quest Piano is a mixed reality music app built around Quest's hand tracking. Instruments appear in your room through passthrough. You switch them on and off from a menu on your palm, carry them anywhere, and play them the way you would play the real thing.

## Instruments

| Instrument | How you play it |
|------------|-----------------|
| **Piano**, 88 keys (A0–C8) at true size | Play with all ten fingers. Velocity comes from how fast each fingertip comes down, and the keys pivot like a real action. The sound is a sampled grand piano. |
| **Drum pads and effects** | Eight light-up drum pads beside the keys. Four switches turn on reverb, delay, a lo-fi filter and a sustain pedal; the effects apply to every instrument. |
| **Guitar**, a real-size dreadnought | Pinch the neck to play. Slide that hand along the neck to change chords (D, Em, F, Am, G, C) and strum with your other hand. Each string is detected separately. Karplus-Strong string synthesis. |
| **Marimba**, A3–C6 | Strike the rosewood bars from above. Brass resonators sit under the bars. |
| **Theremin** | Played without touching. Move your right hand towards the antenna for higher notes; it snaps to semitones so it stays in tune. Raise your left hand over the loop for more volume. |

## Hands first, everywhere

- **Palm menu.** Turn your left palm towards your face and a menu appears above it. Poke the buttons with your right index finger to show or hide instruments, start the song guide, pick a song, or bring everything to you. Instruments appear in their own spots in a half circle around you, so they never pile up.
- **Carry anything.** Pinch the piano's back panel, the marimba's end boards, the theremin's cabinet or the guitar's body. The grab point stays under your fingers, the instrument turns to face you, and it stays where you let go. Nothing plays while you carry it.
- **Your hands stay in front.** Depth-only capsules along every finger bone let your real fingers show over the virtual instruments.
- **Tuned on an emulated Quest.** Grab zones are sized from the measured pinch point. The pinch fires while the fingers are still closing, about 7 cm off the surface.

## Learn songs

Turn on **SONG GUIDE** and the piano lights up the next keys in green; the step after that glows faintly. Play them to move on, and a wrong key flashes red. A panel on the piano shows your progress. Built-in songs: Twinkle Twinkle, Ode to Joy, Für Elise, Frère Jacques and Jingle Bells. **LOAD MIDI SONG** loads any MIDI file you have; chords are grouped automatically.

## A MIDI controller for any DAW

| Channel | Instrument |
|---------|------------|
| 1 | Piano (sustain switch = CC64) |
| 2 | Guitar |
| 3 | Theremin |
| 4 | Marimba |
| 10 | Drums (General MIDI notes) |

A small desktop bridge opens a virtual MIDI input called "Quest Piyano". FL Studio, Ableton Live, Reaper and others see it as a regular keyboard.

## Try it

**Headset only:** open **https://geniusbugra.github.io/quest-piano/** in the Quest browser and press **START AR**. The toolbar at the top of the page (instruments, song guide, LOAD MIDI SONG) works before you enter AR too.

**As a MIDI controller for your DAW (Windows):**

1. Install [loopMIDI](https://www.tobias-erichsen.de/software/loopmidi.html). Its driver provides the virtual MIDI port.
2. Run `python midi_bridge.py`. You need Python 3.12+ and `pip install websockets`. This serves the app and creates the "Quest Piyano" MIDI input.
3. Expose it to the headset over HTTPS, for example with `cloudflared tunnel --url http://localhost:8000`.
4. On the Quest, open `https://<your-address>/?midi`. The built-in sound mutes and your DAW makes the sound.
5. In FL Studio, go to **Options → MIDI settings**, enable **Quest Piyano**, and play.

## How it works

| Part | File |
|------|------|
| Key layout and fingertip hit test with hysteresis | `keys.js` |
| Guitar chords, strum detection, Karplus-Strong string | `guitar.js` |
| Marimba bar layout, theremin pitch and volume mapping | `instruments.js` |
| Built-in songs, Standard MIDI File reader | `songs.js` |
| WebXR scene, instruments, palm menu, hand probes, occluders, sound, MIDI out | `main.js` |
| Static server + WebSocket → virtual MIDI port (teVirtualMIDI) | `midi_bridge.py` |

It is built with three.js (WebXR) and the Web Audio API, and runs at about 120 draw calls and 40k triangles per frame with everything on. Fixed foveated rendering is enabled. The bridge accepts only well-formed note on/off and control change messages.

## Tests

- `npm test` covers the key layout, fingertip hit logic, guitar chords, strum detection, string synth, songs, the MIDI file reader, marimba layout and theremin mapping.
- `emulator.html` runs the app in Meta's Immersive Web Emulator, an emulated Quest 3 with hand tracking. Drive `window.xrDevice` (hands, pinch) from the console. Every interaction in this README was tested this way: the palm menu, playing, strumming, the theremin, the song guide and carrying. Keep the browser tab visible, since a hidden tab stalls XR frames.
- `python midi_bridge_test.py` (while the bridge runs) listens on the MIDI port like a DAW and checks that notes arrive and junk is dropped.

## Credits

- Piano samples: Salamander Grand Piano V3 by Alexander Holm, CC-BY 3.0.
- Virtual MIDI driver: teVirtualMIDI / loopMIDI by Tobias Erichsen.
- Developed with the help of an AI coding assistant (Claude Code).

## License

The code is MIT licensed (see `LICENSE`). The piano samples keep their own CC-BY 3.0 license.
