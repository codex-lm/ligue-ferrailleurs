import json
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "evidence"
OUT.mkdir(exist_ok=True)
BASE = "http://127.0.0.1:4177/"
report = {"schemaVersion": 1, "scope": "local-browser", "checks": {}, "consoleErrors": []}


def check(name, condition):
    report["checks"][name] = bool(condition)
    if not condition:
        raise AssertionError(name)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, args=["--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.on("pageerror", lambda error: report["consoleErrors"].append(str(error)))
    page.on("console", lambda message: report["consoleErrors"].append(message.text) if message.type == "error" else None)
    page.goto(BASE)
    page.wait_for_function("window.__SCRAP_LEAGUE__ !== undefined", timeout=20000)
    page.wait_for_timeout(1000)
    check("home-english-default", page.locator("html").get_attribute("lang") == "en")
    page.screenshot(path=OUT / "local-home.png", full_page=True)
    page.locator('[data-action="new-campaign"]').click()
    if page.locator('[data-action="close-help"]').count():
        page.locator('[data-action="close-help"]').last.click()
    check("three-chassis-visible", page.locator(".unit-tab").count() == 3)
    page.locator('[data-socket="right"]').select_option("blade")
    check("weight-refusal-visible", "9/8" in page.locator(".validation").inner_text())
    check("invalid-launch-disabled", page.locator('[data-action="start-battle"]').is_disabled())
    page.screenshot(path=OUT / "local-invalid-build.png", full_page=True)
    page.locator('[data-socket="right"]').select_option("")
    page.locator('[data-action="position"][data-x="1"][data-y="1"]').click()
    saved_position = page.evaluate("JSON.parse(localStorage.getItem('scrap-league-v1:campaign')).team.units[0].position")
    check("starting-position-persisted", saved_position == [1, 1])
    page.locator('[data-action="position"][data-x="0"][data-y="3"]').click()
    swapped = page.evaluate("JSON.parse(localStorage.getItem('scrap-league-v1:campaign')).team.units.slice(0, 2).map(unit => unit.position)")
    check("occupied-position-swaps-default-cell", swapped == [[0, 3], [1, 1]])
    page.locator('[data-action="start-battle"]').click()
    page.wait_for_function("window.__SCRAP_LEAGUE__.snapshot().battleTick > 4")
    page.locator('[data-action="pause"]').click()
    paused_tick = page.evaluate("window.__SCRAP_LEAGUE__.snapshot().battleTick")
    page.wait_for_timeout(450)
    check("pause-freezes-simulation", page.evaluate("window.__SCRAP_LEAGUE__.snapshot().battleTick") == paused_tick)
    page.locator('[data-action="order-retreat"]').click()
    page.locator('[data-action="order-target"]').click()
    page.locator(".combat-unit.enemy:not([disabled])").first.click()
    page.locator('[data-action="order-overload"]').click()
    page.locator('[data-action="overload-module"][data-module="blade"]').click()
    check("three-tactical-charges-used", page.locator(".charge-dot.used").count() == 3)
    page.screenshot(path=OUT / "local-pause-orders.png", full_page=True)
    page.locator('[data-action="pause"]').click()
    page.locator('[data-action="speed"]').click()
    page.locator('[data-action="speed"]').click()
    page.wait_for_function("window.__SCRAP_LEAGUE__.snapshot().result !== null", timeout=45000)
    result = page.evaluate("window.__SCRAP_LEAGUE__.snapshot().result")
    report["firstBattleResult"] = result
    page.screenshot(path=OUT / "local-battle-result.png", full_page=True)
    check("battle-reaches-result", result["tick"] <= 900)
    if result["winner"] == "player":
        page.locator('[data-action="claim"]').click()
        check("nine-research-nodes", page.locator(".research-node").count() == 9)
        page.locator('[data-action="research"][data-id="power-hammer"]').click()
        check("research-unlocked", "unlocked" in page.locator('[data-action="research"][data-id="power-hammer"]').inner_text().lower())
        page.locator('[data-action="next-arena"]').click()
        check("second-encounter-ready", page.evaluate("window.__SCRAP_LEAGUE__.snapshot().encounter") == 1)
    else:
        page.locator('[data-action="retry"]').click()
    page.locator('[data-action="home"]').click()
    page.locator('[data-action="test-range"]').click()
    page.locator('[data-action="save-plan"][data-slot="0"]').click()
    page.locator('[data-socket="right"]').select_option("blaster")
    page.locator('[data-action="load-plan"][data-slot="0"]').click()
    check("blueprint-restores-modules", page.locator('[data-socket="right"]').input_value() == "")
    page.locator('[data-action="start-battle"]').click()
    page.locator('[data-action="speed"]').click()
    page.locator('[data-action="speed"]').click()
    page.wait_for_function("window.__SCRAP_LEAGUE__.snapshot().result !== null", timeout=45000)
    page.locator('[data-action="swap-replay"]').wait_for(state="visible", timeout=5000)
    check("test-range-result", page.locator('[data-action="swap-replay"]').is_visible())
    page.locator('[data-action="edit-teams"]').click()
    check("result-overlay-cleared-in-workshop", page.locator(".result-veil").count() == 0)
    page.locator('[data-change="language"]').select_option("fr")
    check("french-interface", "Atelier" in page.locator("body").inner_text())
    page.locator('[data-change="language"]').select_option("es")
    check("spanish-interface", "Taller" in page.locator("body").inner_text())
    page.locator('[data-change="language"]').select_option("en")
    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(400)
    check("mobile-no-horizontal-overflow", page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
    page.screenshot(path=OUT / "local-mobile-workshop.png", full_page=True)
    page.reload()
    page.wait_for_function("window.__SCRAP_LEAGUE__ !== undefined", timeout=20000)
    check("campaign-save-survives-reload", "continue" in page.locator("body").inner_text().lower())
    browser.close()

report["passed"] = all(report["checks"].values()) and not report["consoleErrors"]
(OUT / "local-browser.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report, indent=2))
