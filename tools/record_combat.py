import json
import shutil
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "evidence"
VIDEO_DIR = OUT / "video-tmp"
OUT.mkdir(exist_ok=True)
VIDEO_DIR.mkdir(exist_ok=True)

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, args=["--enable-unsafe-swiftshader"])
    context = browser.new_context(
        viewport={"width": 1280, "height": 720},
        record_video_dir=VIDEO_DIR,
        record_video_size={"width": 1280, "height": 720},
    )
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto("http://127.0.0.1:4177/")
    page.wait_for_function("window.__SCRAP_LEAGUE__ !== undefined", timeout=20000)
    page.locator('[data-action="test-range"]').click()
    page.locator('[data-action="start-battle"]').click()
    page.locator('[data-change="speed"]').select_option("2")
    page.locator('[data-action="pause"]').click()
    page.locator('[data-action="pause"]').click()
    page.locator('[data-action="order-target"]').click()
    page.locator(".combat-unit.enemy").first.click()
    page.locator('[data-action="confirm-order"]').click()
    page.locator('[data-action="read-combat"]').click()
    page.locator('[data-action="pause"]').click()
    metrics = page.evaluate("""() => new Promise(resolve => {
      const frames = [];
      let previous = performance.now();
      function sample(now) {
        frames.push(now - previous);
        previous = now;
        if (frames.length < 120) requestAnimationFrame(sample);
        else {
          const sorted = frames.slice(1).sort((a, b) => a - b);
          const averageMs = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
          resolve({averageFps: 1000 / averageMs, averageMs, p95Ms: sorted[Math.floor(sorted.length * 0.95)]});
        }
      }
      requestAnimationFrame(sample);
    })""")
    page.wait_for_function("window.__SCRAP_LEAGUE__.snapshot().result !== null", timeout=45000)
    page.wait_for_timeout(1200)
    result = page.evaluate("window.__SCRAP_LEAGUE__.snapshot().result")
    video = page.video
    context.close()
    source = Path(video.path())
    destination = OUT / "refonte-combat.webm"
    shutil.copyfile(source, destination)
    browser.close()

report = {
    "schemaVersion": 1,
    "scope": "uncut-local-combat-and-render-metrics",
    "video": destination.name,
    "result": result,
    "metrics": metrics,
    "environment": "Chromium headless with SwiftShader software rendering; not a physical mobile/GPU benchmark",
    "viewport": "1280x720",
    "consoleErrors": errors,
}
(OUT / "refonte-performance.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
for path in VIDEO_DIR.iterdir():
    path.unlink()
VIDEO_DIR.rmdir()
print(json.dumps(report, indent=2))
