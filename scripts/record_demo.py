"""Record the AdKnob demo (demo.html) as a 1920x1080 MP4 following a scripted scenario.

    pip install playwright imageio-ffmpeg     # uses the installed Chrome; no browser download
    python scripts/record_demo.py [--out videos/adknob_demo.mp4]

The script serves the site locally, plays the scenario in headless Chrome with a drawn
cursor, captures frames through the DevTools screencast (real-time, so streaming text and
highlight animations keep their timing), and encodes them with ffmpeg.

Scenario (Cars request, Dacia Duster ad): the advertiser's input and the user's request are
typed in, the knob is pressed at Level 1 and raised to Level 4 one step at a time, then the
labeling threshold is moved down and up and reset.
"""
import argparse
import asyncio
import base64
import functools
import http.server
import math
import os
import shutil
import subprocess
import tempfile
import threading
import time

import imageio_ffmpeg
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
W, H, FPS = 1920, 1080, 30
PROMPT_ID, AD_ID = 120, 172  # Cars request, Dacia Duster

CURSOR_JS = r"""
(() => {
  const c = document.createElement('div');
  c.innerHTML = '<svg width="30" height="30" viewBox="0 0 28 28"><path d="M4 2 L4 22 L9.5 17 L13 25 ' +
    'L16.5 23.5 L13 15.5 L20.5 15.5 Z" fill="#111827" stroke="#fff" stroke-width="1.6" ' +
    'stroke-linejoin="round"/></svg>';
  Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: 99999, pointerEvents: 'none',
    transform: 'translate(-100px, -100px)', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.35))' });
  const ring = document.createElement('div');
  Object.assign(ring.style, { position: 'fixed', width: '38px', height: '38px', marginLeft: '-19px',
    marginTop: '-19px', borderRadius: '50%', border: '3px solid rgba(37, 99, 235, 0.75)', zIndex: 99998,
    pointerEvents: 'none', opacity: '0' });
  document.body.append(ring, c);
  window.__rec = {
    move(x, y, ms) {
      c.style.transition = `transform ${ms}ms cubic-bezier(.45, 0, .25, 1)`;
      c.style.transform = `translate(${x - 4}px, ${y - 2}px)`;
    },
    press(x, y) {
      ring.style.left = x + 'px';
      ring.style.top = y + 'px';
      ring.animate([{ opacity: 0.9, transform: 'scale(0.4)' }, { opacity: 0, transform: 'scale(1.3)' }],
                   { duration: 500, easing: 'ease-out' });
    },
  };
})();
"""


class Recorder:
    def __init__(self, page):
        self.page = page
        self.pos = (W * 0.75, H * 0.6)

    async def hold(self, seconds):
        await asyncio.sleep(seconds)

    async def move(self, x, y, ms=700):
        await self.page.evaluate(f"__rec.move({x}, {y}, {ms})")
        await asyncio.sleep(ms / 1000)
        await self.page.mouse.move(x, y)
        self.pos = (x, y)

    async def press(self, x, y):
        await self.page.evaluate(f"__rec.press({x}, {y})")

    async def drag(self, x0, y0, x1, y1, ms=900):
        """Press at (x0, y0), drag to (x1, y1) with easing, release."""
        await self.move(x0, y0)
        await self.press(x0, y0)
        await self.page.mouse.down()
        steps = max(2, int(ms / 16))
        for i in range(1, steps + 1):
            t = i / steps
            e = t * t * (3 - 2 * t)  # smoothstep
            x, y = x0 + (x1 - x0) * e, y0 + (y1 - y0) * e
            await self.page.mouse.move(x, y)
            await self.page.evaluate(f"__rec.move({x}, {y}, 0)")
            await asyncio.sleep(ms / 1000 / steps)
        await self.page.mouse.up()
        self.pos = (x1, y1)

    async def wait_generation(self, timeout=60):
        await asyncio.sleep(0.3)
        start = time.time()
        while await self.page.evaluate("window.adknobDemo.isStreaming()"):
            if time.time() - start > timeout:
                raise TimeoutError("generation did not finish")
            await asyncio.sleep(0.1)

    async def zoom(self):
        return await self.page.evaluate(
            "parseFloat(getComputedStyle(document.querySelector('.present-left')).zoom) || 1")

    async def knob_point(self, level):
        box = await self.page.locator("#demo-level").bounding_box()
        thumb = 22 * await self.zoom()
        x = box["x"] + thumb / 2 + (box["width"] - thumb) * (level - 1) / 3
        return x, box["y"] + box["height"] / 2

    async def tau_point(self, tau):
        box = await self.page.locator("#demo-threshold").bounding_box()
        lo, hi = await self.page.evaluate("window.ADKNOB_DEMO.tau_range")
        v = (math.log10(tau) - math.log10(lo)) / (math.log10(hi) - math.log10(lo))
        thumb = 16 * await self.zoom()
        return box["x"] + thumb / 2 + (box["width"] - thumb) * v, box["y"] + box["height"] / 2


async def scenario(rec):
    page = rec.page
    await rec.hold(0.8)

    # The advertiser's input and then the user's request are typed in.
    await page.evaluate("window.adknobDemo.typeInputs(40)")
    await rec.hold(0.7)

    # Level 1: press the knob where it sits; the provider's token appears and the response streams in.
    x, y = await rec.knob_point(1)
    await rec.move(x, y, 1100)
    await rec.press(x, y)
    await page.evaluate("window.adknobDemo.generate()")
    await rec.wait_generation()
    await rec.hold(1.6)

    # Raise the knob one level at a time.
    for level in (2, 3, 4):
        x0, y0 = await rec.knob_point(level - 1)
        x1, y1 = await rec.knob_point(level)
        await rec.drag(x0, y0, x1, y1, 800)
        await rec.wait_generation()
        await rec.hold(1.8 if level < 4 else 2.4)

    # Threshold: lower it (more sentences labeled), raise it (fewer), then reset.
    x0, y0 = await rec.tau_point(0.010)
    x1, _ = await rec.tau_point(0.0045)
    await rec.drag(x0, y0, x1, y0, 1400)
    await rec.hold(1.6)
    x2, _ = await rec.tau_point(0.016)
    await rec.drag(x1, y0, x2, y0, 1800)
    await rec.hold(1.6)
    box = await page.locator("#demo-threshold-reset").bounding_box()
    rx, ry = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    await rec.move(rx, ry, 800)
    await rec.press(rx, ry)
    await page.mouse.click(rx, ry)
    await rec.hold(2.5)


def serve(port):
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    handler.func.log_message = lambda *a: None
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


async def record(out, port):
    frames_dir = tempfile.mkdtemp(prefix="adknob_frames_")
    frames = []  # (timestamp, path)
    server = serve(port)
    try:
        async with async_playwright() as pw:
            # The window must be as large as the viewport, or the screencast is cropped.
            browser = await pw.chromium.launch(executable_path=CHROME, headless=True,
                                               args=[f"--window-size={W},{H}"])
            context = await browser.new_context(viewport={"width": W, "height": H}, device_scale_factor=1)
            page = await context.new_page()
            url = (f"http://127.0.0.1:{port}/demo.html?prompt={PROMPT_ID}&ad={AD_ID}"
                   f"&level=1&autoplay=0")
            await page.goto(url, wait_until="networkidle")
            await page.evaluate("document.fonts.ready")
            await page.evaluate(CURSOR_JS)
            rec = Recorder(page)
            await page.evaluate(f"__rec.move({rec.pos[0]}, {rec.pos[1]}, 0)")

            cdp = await context.new_cdp_session(page)

            async def on_frame(params):
                path = os.path.join(frames_dir, f"{len(frames):06d}.jpg")
                with open(path, "wb") as f:
                    f.write(base64.b64decode(params["data"]))
                frames.append((params["metadata"].get("timestamp", time.time()), path))
                await cdp.send("Page.screencastFrameAck", {"sessionId": params["sessionId"]})

            cdp.on("Page.screencastFrame", lambda p: asyncio.ensure_future(on_frame(p)))
            await cdp.send("Page.startScreencast",
                           {"format": "jpeg", "quality": 95, "maxWidth": W, "maxHeight": H})
            t_start = time.time()
            await scenario(rec)
            t_end = time.time()
            await cdp.send("Page.stopScreencast")
            await asyncio.sleep(0.3)
            await browser.close()
    finally:
        server.shutdown()

    if len(frames) < 2:
        raise RuntimeError("no frames captured")
    with open(frames[0][1], "rb") as f:  # JPEG SOF0 marker holds the frame size
        head = f.read(4096)
    i = head.find(b"\xff\xc0")
    fh, fw = int.from_bytes(head[i + 5:i + 7], "big"), int.from_bytes(head[i + 7:i + 9], "big")
    if (fw, fh) != (W, H):
        raise RuntimeError(f"captured frames are {fw}x{fh}, expected {W}x{H}")
    # Durations from capture timestamps; the last frame holds until the scenario ended.
    lines = []
    for (t, path), (t_next, _) in zip(frames, frames[1:]):
        lines += [f"file '{path}'", f"duration {max(t_next - t, 1e-3):.4f}"]
    tail = max(0.04, (t_end - t_start) - (frames[-1][0] - frames[0][0]))
    lines += [f"file '{frames[-1][1]}'", f"duration {tail:.4f}", f"file '{frames[-1][1]}'"]
    listing = os.path.join(frames_dir, "frames.txt")
    open(listing, "w").write("\n".join(lines) + "\n")

    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
                    "-i", listing, "-vf", f"fps={FPS},setsar=1,scale=out_range=tv,format=yuv420p", "-color_range", "tv",
                    "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-movflags", "+faststart", out],
                   check=True)
    span = frames[-1][0] - frames[0][0]
    print(f"{len(frames)} frames over {span:.1f}s (~{len(frames) / max(span, 1e-6):.0f} fps captured) -> {out}")
    shutil.rmtree(frames_dir)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "videos", "adknob_demo.mp4"))
    ap.add_argument("--port", type=int, default=8767)
    args = ap.parse_args()
    asyncio.run(record(args.out, args.port))


if __name__ == "__main__":
    main()
