# Serves the piano page and turns the notes you play on the Quest into a virtual MIDI input
# called "Quest Piyano" that FL Studio (or any DAW) sees like a real MIDI keyboard.
# Needs loopMIDI installed (it ships the teVirtualMIDI driver). Usage: python midi_bridge.py
import asyncio, ctypes, json, pathlib
from websockets.asyncio.server import serve
from websockets.datastructures import Headers
from websockets.http11 import Response

ROOT = pathlib.Path(__file__).parent.resolve()
PORT_NAME = "Quest Piyano"
# Only the page itself is served: the tunnel makes this public, so no certs or scripts leak.
TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8"}

vm = ctypes.WinDLL("teVirtualMIDI64.dll", use_last_error=True)
vm.virtualMIDICreatePortEx2.restype = ctypes.c_void_p
vm.virtualMIDICreatePortEx2.argtypes = [ctypes.c_wchar_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint32, ctypes.c_uint32]
vm.virtualMIDISendData.restype = ctypes.c_bool
vm.virtualMIDISendData.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_uint32]
vm.virtualMIDIClosePort.argtypes = [ctypes.c_void_p]
PARSE_RX, INSTANTIATE_BOTH = 1, 12
port = vm.virtualMIDICreatePortEx2(PORT_NAME, None, None, 65535, PARSE_RX | INSTANTIATE_BOTH)
if not port:
    raise SystemExit(f"MIDI port could not be created (error {ctypes.get_last_error()}). Is loopMIDI installed?")


def process_request(connection, request):
    path = request.path.split("?")[0]
    if path == "/midi":
        return None  # continue with the WebSocket handshake
    file = (ROOT / path.lstrip("/")).resolve()
    if file.is_dir():
        file = file / "index.html"
    if not file.is_relative_to(ROOT) or file.suffix not in TYPES or not file.is_file():
        return connection.respond(404, "Not found\n")
    body = file.read_bytes()
    headers = Headers({"Content-Type": TYPES[file.suffix], "Content-Length": str(len(body)), "Cache-Control": "no-cache"})
    return Response(200, "OK", headers, body)


async def midi(ws):
    print("Quest connected", flush=True)
    async for msg in ws:
        try:
            status, note, velocity = json.loads(msg)
        except (ValueError, TypeError):
            continue
        # The tunnel is public: accept nothing but well-formed note on/off and control change (sustain), any channel.
        if (isinstance(status, int) and 0 <= status < 256 and status & 0xF0 in (0x80, 0x90, 0xB0)
                and all(isinstance(v, int) and 0 <= v < 128 for v in (note, velocity))):
            vm.virtualMIDISendData(port, bytes([status, note, velocity]), 3)
    print("Quest disconnected", flush=True)


async def main():
    async with serve(midi, "127.0.0.1", 8000, process_request=process_request) as server:
        print(f'MIDI port "{PORT_NAME}" ready, page on http://localhost:8000', flush=True)
        await server.serve_forever()


try:
    asyncio.run(main())
finally:
    vm.virtualMIDIClosePort(port)
