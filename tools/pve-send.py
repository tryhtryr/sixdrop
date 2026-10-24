#!/usr/bin/env python3
"""
在 PVE 上用无头 Chromium 当发送端，造一个 300 MB 文件发出去。
用法: python3 pve-send.py [MB]
"""
import json
import subprocess
import sys
import time
import urllib.request

import websocket

MB = int(sys.argv[1]) if len(sys.argv) > 1 else 300
CHROME = "/usr/bin/chromium"
PORT = 9223
URL = "https://sixdrop.example"

proc = subprocess.Popen(
    [
        CHROME,
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        f"--remote-debugging-port={PORT}",
        "--remote-allow-origins=*",
        "--user-data-dir=/tmp/chr-sixdrop-send",
        URL,
    ],
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)


def target():
    for _ in range(120):
        try:
            data = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json", timeout=2))
            for t in data:
                if t.get("type") == "page" and "sixdrop" in (t.get("url") or ""):
                    return t
        except Exception:
            pass
        time.sleep(0.3)
    raise RuntimeError("拿不到调试目标")


info = target()
ws = websocket.create_connection(info["webSocketDebuggerUrl"], timeout=900, suppress_origin=True)
msg_id = 0


def call(method, params=None):
    global msg_id
    msg_id += 1
    ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
    while True:
        resp = json.loads(ws.recv())
        if resp.get("id") == msg_id:
            return resp


call("Runtime.enable")

# 1) 造文件、建房、把取件码打出来
START = """
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 150 && !document.getElementById('file'); i++) await sleep(100);
  const size = %d * 1024 * 1024;
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 4096) bytes[i] = (i / 4096) & 255;
  const dt = new DataTransfer();
  dt.items.add(new File([bytes], 'pve-%dmb.bin', { type: 'application/octet-stream' }));
  const input = document.getElementById('file');
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  for (let i = 0; i < 200; i++) {
    const c = document.getElementById('room-code').textContent.trim();
    if (/^[2-9A-HJ-NP-Z]{6}$/.test(c)) return c;
    await sleep(100);
  }
  return '';
})()
""" % (MB, MB)

resp = call("Runtime.evaluate", {"expression": START, "awaitPromise": True, "returnByValue": True})
raw = resp.get("result", {})
if raw.get("exceptionDetails"):
    print("  EXC " + json.dumps(raw["exceptionDetails"])[:600], flush=True)
code = str(raw.get("result", {}).get("value") or "")
print(f"CODE {code}", flush=True)
if not code:
    print("  RESULT {\"error\": \"no code\"}")
    sys.exit(1)

# 2) 等待对方接入并完成
WAIT = """
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let started = 0;
  let last = '';
  for (let i = 0; i < 6000; i++) {
    await sleep(200);
    const sub = document.getElementById('xfer-sub');
    const st = document.getElementById('xfer-stats');
    if (sub && /发送完成/.test(sub.textContent)) {
      return JSON.stringify({
        seconds: started ? (Date.now() - started) / 1000 : 0,
        last: st ? st.textContent : '',
        path: (document.getElementById('path') || {}).textContent || '',
        verify: (document.getElementById('verify-code') || {}).textContent || '',
      });
    }
    if (!started && st && /\\d/.test(st.textContent) && !/准备中/.test(st.textContent)) {
      started = Date.now();
    }
  }
  return JSON.stringify({ error: 'timeout' });
})()
"""

resp = call("Runtime.evaluate", {"expression": WAIT, "awaitPromise": True, "returnByValue": True})
print("  RESULT " + str(resp.get("result", {}).get("result", {}).get("value")))

ws.close()
proc.terminate()
