# HTTPS static server on the local network: the Quest browser only allows WebXR over HTTPS.
# Usage: python serve.py   (a self-signed certificate is created on first run)
import http.server, os, pathlib, socket, ssl, subprocess

os.chdir(pathlib.Path(__file__).parent)
if not os.path.exists("cert.pem"):
    openssl = r"C:\Program Files\Git\usr\bin\openssl.exe"  # ships with Git for Windows
    subprocess.run([openssl, "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "key.pem",
                    "-out", "cert.pem", "-days", "365", "-subj", "/CN=quest-piano"], check=True)

s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.connect(("10.255.255.255", 1))  # sends nothing; just picks the LAN interface
ip = s.getsockname()[0]
s.close()

httpd = http.server.ThreadingHTTPServer(("0.0.0.0", 8443), http.server.SimpleHTTPRequestHandler)
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain("cert.pem", "key.pem")
httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
print(f"Quest tarayicisinda ac: https://{ip}:8443   (durdurmak icin Ctrl+C)")
httpd.serve_forever()
