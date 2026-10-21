#!/usr/bin/env python3
"""
在 PVE 上用无头 Chromium + CDP 当接收端，测六位码传输速度。
用法: python3 pve-receive.py <取件码>
"""
import json
import subprocess
import sys
import time
import urllib.request

import websocket

CODE = (sys.argv[1] if len(sys.argv) > 1 else "").upper()
if len(CODE) != 6:
    print("用法: python3 pve-receive.py <6位取件码>")
    sys.exit(1)

CHROME = "/usr/bin/chromium"
PORT = 9222
URL = "https://sixdrop.dev"

proc = subprocess.Popen(
    [
        CHROME,
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        f"--remote-debugging-port={PORT}",
        "--remote-allow-origins=*",
        "--user-data-dir=/tmp/chr-sixdrop",
        URL,
    ],
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)


def target():
    for _ in range(100):
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
ws = websocket.create_connection(
    info["webSocketDebuggerUrl"], timeout=300, suppress_origin=True
)
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

for _ in range(80):
    st = call("Runtime.evaluate", {"expression": "document.readyState", "returnByValue": True})
    if st.get("result", {}).get("result", {}).get("value") == "complete":
        break
    time.sleep(0.25)

SCRIPT = """
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 150 && !document.getElementById('code'); i++) await sleep(100);
  const codeEl = document.getElementById('code');
  if (!codeEl) return JSON.stringify({ error: 'page not ready' });

  // 无头 Linux Chromium 可能有 File System Access，先关掉，逼它走内存分支
  window.showSaveFilePicker = undefined;
  window.showDirectoryPicker = undefined;

  codeEl.value = '%s';
  codeEl.dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('join').requestSubmit();

  for (let i = 0; i < 1200; i++) {
    if (!document.getElementById('view-ask').hidden) break;
    await sleep(100);
  }
  if (document.getElementById('view-ask').hidden) {
    return JSON.stringify({ error: 'no ask dialog' });
  }

  const sizeLine = document.getElementById('ask-size').textContent.trim();
  const path = (document.getElementById('path') || {}).textContent || '';
  const verify = (document.getElementById('verify-code') || {}).textContent || '';
  const started = Date.now();
  document.getElementById('accept').click();

  let last = '';
  for (let i = 0; i < 3000; i++) {
    await sleep(200);
    const st = document.getElementById('xfer-stats');
    if (st && st.textContent !== last) last = st.textContent;
    const back = document.getElementById('back');
    if (back && !back.hidden) {
      const seconds = (Date.now() - started) / 1000;
      return JSON.stringify({ sizeLine, seconds, last, path, verify });
    }
  }
  return JSON.stringify({ error: 'timeout', last });
})()
""" % CODE

resp = None
for attempt in range(4):
    resp = call(
        "Runtime.evaluate",
        {"expression": SCRIPT, "awaitPromise": True, "returnByValue": True},
    )
    if "result" in resp:
        break
    print(f"  重试 {attempt + 1}: {json.dumps(resp.get('error', {}))[:120]}", flush=True)
    time.sleep(1.5)
raw = resp.get("result", {})
if raw.get("exceptionDetails") or "result" not in raw:
    print("  RAW " + json.dumps(resp)[:1200], flush=True)
value = raw.get("result", {}).get("value")
print("  RESULT " + str(value))

ws.close()
proc.terminate()
