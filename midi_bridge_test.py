# End-to-end check while midi_bridge.py runs: listens on the "Quest Piyano" MIDI input like FL Studio
# would, sends notes (and junk) over the WebSocket, and asserts only the valid notes arrive.
import asyncio, ctypes, ctypes.wintypes as w, time
import websockets

winmm = ctypes.WinDLL("winmm")


class Caps(ctypes.Structure):
    _fields_ = [("wMid", w.WORD), ("wPid", w.WORD), ("vDriverVersion", w.UINT), ("szPname", w.WCHAR * 32), ("dwSupport", w.DWORD)]


names = []
for i in range(winmm.midiInGetNumDevs()):
    c = Caps()
    winmm.midiInGetDevCapsW(i, ctypes.byref(c), ctypes.sizeof(c))
    names.append(c.szPname)
print("MIDI inputs:", names)
assert "Quest Piyano" in names

got = []
Callback = ctypes.WINFUNCTYPE(None, w.HANDLE, w.UINT, ctypes.c_size_t, ctypes.c_size_t, ctypes.c_size_t)
on_midi = Callback(lambda h, msg, inst, p1, p2: got.append(p1) if msg == 0x3C3 else None)  # MIM_DATA
handle = w.HANDLE()
assert winmm.midiInOpen(ctypes.byref(handle), names.index("Quest Piyano"), on_midi, None, 0x30000) == 0  # CALLBACK_FUNCTION
winmm.midiInStart(handle)


async def send():
    async with websockets.connect("ws://localhost:8000/midi") as ws:
        for m in ["[144,60,100]", "[128,60,0]", "[153,36,100]", "[176,64,127]",  # piano, drum on ch 10, sustain
                  '"junk"', "[144,200,1]", "[224,0,64]", "[144,60.5,1]", "[400,1,1]"]:  # all dropped
            await ws.send(m)
            await asyncio.sleep(0.02)
        await asyncio.sleep(0.5)


asyncio.run(send())
time.sleep(0.3)
winmm.midiInStop(handle)
winmm.midiInClose(handle)
assert [x & 0xFFFFFF for x in got] == [0x643C90, 0x003C80, 0x642499, 0x7F40B0], [hex(x) for x in got]
print("midi ok: notes, drums and sustain arrived, junk dropped")
