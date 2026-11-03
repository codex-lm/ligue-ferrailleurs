import json
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "evidence"
OUT.mkdir(exist_ok=True)
BASE = "http://127.0.0.1:4177/"
report = {"schemaVersion": 2, "scope": "local-browser-refonte", "checks": {}, "consoleErrors": [], "viewports": {}}


def check(name, condition):
    report["checks"][name] = bool(condition)
    if not condition:
        raise AssertionError(name)


def snapshot(page):
    return page.evaluate("window.__SCRAP_LEAGUE__.snapshot()")


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, args=["--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.on("pageerror", lambda error: report["consoleErrors"].append(str(error)))
    page.on("console", lambda message: report["consoleErrors"].append(message.text) if message.type == "error" else None)
    page.on("dialog", lambda dialog: dialog.accept())
    page.goto(BASE)
    page.wait_for_function("window.__SCRAP_LEAGUE__ !== undefined", timeout=20000)
    check("home-english-default", page.locator("html").get_attribute("lang") == "en")
    page.locator('[data-action="new-campaign"]').click()
    if page.locator('[data-action="close-help"]').count():
        page.locator('[data-action="close-help"]').last.click()
    check("three-chassis-visible", page.locator(".unit-tab").count() == 3)

    page.locator('[data-action="preview-module"][data-module="blaster"]').click()
    check("module-preview-budgets", "→ 9/8" in page.locator(".budgets").inner_text())
    check("preview-does-not-equip", page.evaluate("JSON.parse(localStorage.getItem('scrap-league-v1:campaign')).team.units[0].modules.some(entry => entry.socket === 'right')") is False)
    page.locator('[data-action="cancel-preview"]').click()
    page.locator('[data-action="preview-module"][data-module="blaster"]').click()
    page.locator('[data-action="equip-preview"]').click()
    check("weight-and-energy-refusal", "9/8" in page.locator(".validation").inner_text() and "8/5" in page.locator(".validation").inner_text())
    check("invalid-launch-disabled", page.locator('[data-action="start-battle"]').is_disabled())
    page.screenshot(path=OUT / "refonte-invalid-build.png", full_page=True)
    page.locator('[data-action="preview-module"][data-module=""]').click()
    page.locator('[data-action="equip-preview"]').click()

    page.locator('[data-action="workshop-tab"][data-tab="placement"]').click()
    page.keyboard.press("ArrowRight")
    page.locator('[data-action="confirm-placement"]').click()
    check("placement-on-real-arena-persisted", page.evaluate("JSON.parse(localStorage.getItem('scrap-league-v1:campaign')).team.units[0].position") == [1, 1])
    page.keyboard.press("ArrowLeft")
    page.keyboard.press("ArrowDown")
    page.keyboard.press("ArrowDown")
    page.locator('[data-action="confirm-placement"]').click()
    check("occupied-position-swaps", page.evaluate("JSON.parse(localStorage.getItem('scrap-league-v1:campaign')).team.units.slice(0, 2).map(unit => unit.position)") == [[0, 3], [1, 1]])

    page.locator('[data-action="start-battle"]').click()
    page.wait_for_timeout(350)
    initial = snapshot(page)
    check("battle-starts-suspended", initial["paused"] and not initial["started"] and initial["battleTick"] == 0)
    check("default-speed-half", initial["speed"] == 0.5)
    check("orders-wait-for-begin", page.locator('[data-action="order-target"]').is_disabled())
    page.screenshot(path=OUT / "refonte-preparation-1440.png", full_page=True)

    page.locator('[data-action="pause"]').click()
    page.wait_for_function("window.__SCRAP_LEAGUE__.snapshot().battleTick >= 2")
    page.locator('[data-action="pause"]').click()
    paused_tick = snapshot(page)["battleTick"]
    paused_presentation_time = snapshot(page)["presentationTime"]
    page.wait_for_timeout(400)
    check("pause-freezes-simulation", snapshot(page)["battleTick"] == paused_tick)
    check("pause-freezes-presentation-effects", snapshot(page)["presentationTime"] == paused_presentation_time)

    page.locator('.combat-unit.player[data-id="clank"]').click()
    page.locator('[data-action="order-overload"]').click()
    check("passive-overload-disabled", page.locator('[data-action="choose-overload-module"][data-module="shield"]').is_disabled())
    check("passive-refusal-costs-nothing", snapshot(page)["charges"] == 3)
    page.locator('[data-action="cancel-order"]').click()

    page.locator('.combat-unit.player[data-id="nib"]').click()
    page.locator('[data-action="order-target"]').click()
    page.locator(".combat-unit.enemy").first.click()
    check("target-preview-identities", "Nib" in page.locator(".order-summary").inner_text() and "Rattle" in page.locator(".order-summary").inner_text())
    page.locator('[data-action="cancel-order"]').click()
    check("cancel-keeps-charges-and-pause", snapshot(page)["charges"] == 3 and snapshot(page)["paused"])
    page.locator('.combat-unit.player[data-id="nib"]').click()
    page.locator('[data-action="order-target"]').click()
    page.locator(".combat-unit.enemy").first.click()
    page.locator('[data-action="fullscreen"]').click()
    page.wait_for_timeout(250)
    check("fullscreen-preserves-order-preview", page.evaluate("Boolean(document.fullscreenElement)") and snapshot(page)["orderMode"] == "target" and snapshot(page)["charges"] == 3)
    page.evaluate("document.exitFullscreen()")
    page.wait_for_timeout(200)
    check("fullscreen-exit-preserves-order-preview", snapshot(page)["orderMode"] == "target" and snapshot(page)["charges"] == 3)
    page.locator('[data-action="confirm-order"]').dblclick()
    check("target-confirmation-spends-one", snapshot(page)["charges"] == 2 and snapshot(page)["paused"] and snapshot(page)["orders"] == 1)
    page.locator('.combat-unit.player[data-id="nib"]').click()
    page.locator('[data-action="order-retreat"]').click()
    check("retreat-preview-before-confirmation", "3.5" in page.locator(".order-summary").inner_text())
    page.locator('[data-action="confirm-order"]').click()
    check("retreat-confirmation-spends-one", snapshot(page)["charges"] == 1 and snapshot(page)["orders"] == 2)
    page.locator('[data-action="order-overload"]').click()
    page.locator('[data-action="choose-overload-module"][data-module="blade"]').click()
    check("overload-preview-values", "16" in page.locator(".order-summary").inner_text() and "0.4" in page.locator(".order-summary").inner_text())
    page.locator('[data-action="confirm-order"]').click()
    check("three-unique-confirmed-orders", snapshot(page)["charges"] == 0 and snapshot(page)["orders"] == 3)
    page.screenshot(path=OUT / "refonte-orders-1440.png", full_page=True)

    before_loss = snapshot(page)
    page.evaluate("window.__contextLoss = document.querySelector('#scene-gl').getContext('webgl2').getExtension('WEBGL_lose_context'); window.__contextLoss.loseContext()")
    page.wait_for_function("window.__SCRAP_LEAGUE__.snapshot().renderLost === true")
    check("context-loss-pauses-and-preserves", snapshot(page)["paused"] and snapshot(page)["battleTick"] == before_loss["battleTick"])
    page.evaluate("window.__contextLoss.restoreContext()")
    page.wait_for_function("window.__SCRAP_LEAGUE__.snapshot().renderLost === false", timeout=20000)
    check("context-restore-keeps-simulation", snapshot(page)["battleTick"] == before_loss["battleTick"] and snapshot(page)["paused"] and snapshot(page)["modulesVisible"] > 0)

    before_step = snapshot(page)["battleTick"]
    page.locator('[data-action="step"]').click()
    check("single-tick-step", snapshot(page)["battleTick"] == before_step + 1 and snapshot(page)["paused"])
    page.locator('[data-change="speed"]').select_option("2")
    check("speed-two-selected", snapshot(page)["speed"] == 2)

    page.locator('[data-action="open-history"]').click()
    check("structured-history-open", page.locator(".history-event").count() > 0)
    page.locator(".history-event").first.click()
    check("historical-replay-paused", snapshot(page)["replayEventId"] is not None and snapshot(page)["paused"])
    replay_tick = snapshot(page)["battleTick"]
    page.wait_for_timeout(300)
    check("replay-does-not-advance-live", snapshot(page)["battleTick"] == replay_tick)
    page.screenshot(path=OUT / "refonte-replay-1440.png", full_page=True)
    page.locator('[data-action="return-live"]').click()
    check("return-live-stays-paused", snapshot(page)["replayEventId"] is None and snapshot(page)["paused"])

    page.locator('[data-action="pause"]').click()
    page.wait_for_function("window.__SCRAP_LEAGUE__.snapshot().result !== null", timeout=45000)
    result = snapshot(page)["result"]
    report["firstBattleResult"] = result
    check("battle-reaches-result", result["tick"] <= 900)
    check("result-has-six-unit-rows", page.locator(".result-table tbody tr").count() == 6)
    page.screenshot(path=OUT / "refonte-result-1440.png", full_page=True)
    page.locator('[data-action="review-combat"]').click()
    check("result-replay-available", snapshot(page)["replayEventId"] is not None)
    page.locator('[data-action="return-live"]').click()
    if result["winner"] == "player":
        page.locator('[data-action="claim"]').click()
        check("nine-research-nodes", page.locator(".research-node").count() == 9)
        page.locator('[data-action="research"][data-id="power-hammer"]').click()
        page.locator('[data-action="next-arena"]').click()
        check("campaign-progression", snapshot(page)["encounter"] == 1)
    else:
        page.locator('[data-action="retry"]').click()

    page.locator('[data-action="home"]').click()
    page.locator('[data-action="test-range"]').click()
    page.locator('[data-action="save-plan"][data-slot="0"]').click()
    page.locator('[data-action="preview-module"][data-module="blaster"]').click()
    page.locator('[data-action="equip-preview"]').click()
    page.locator('[data-action="load-plan"][data-slot="0"]').click()
    check("blueprint-restores-modules", page.evaluate("JSON.parse(localStorage.getItem('scrap-league-v1:blueprints'))[0].team.units[0].modules.some(entry => entry.socket === 'right')") is False)
    page.locator('[data-change="language"]').select_option("fr")
    check("french-interface", "Atelier" in page.locator("body").inner_text())
    page.locator('[data-change="language"]').select_option("es")
    check("spanish-interface", "Taller" in page.locator("body").inner_text())
    page.locator('[data-change="language"]').select_option("en")
    page.locator('[data-action="start-battle"]').click()

    for width, height in [(1280, 720), (1366, 768), (1440, 900), (1920, 1080), (1024, 768), (768, 1024), (390, 844), (360, 640), (844, 390), (320, 568)]:
        page.set_viewport_size({"width": width, "height": height})
        page.wait_for_timeout(220)
        metrics = snapshot(page)
        key = f"{width}x{height}"
        report["viewports"][key] = metrics
        check(f"layout-{key}-no-horizontal-overflow", metrics["pageWidth"] <= width + 1)
        check(f"layout-{key}-no-page-scroll", metrics["pageHeight"] <= height + 1)
        check(f"layout-{key}-controls-visible", page.locator('[data-action="pause"]').is_visible() and page.locator('[data-action="order-target"]').is_visible())
        if key in ["1280x720", "390x844", "844x390"]:
            page.screenshot(path=OUT / f"refonte-combat-{key}.png", full_page=True)
    page.set_viewport_size({"width": 390, "height": 844})
    page.locator('[data-action="zoom-in"]').click()
    check("mobile-camera-zoom", snapshot(page)["cameraZoom"] == 1.25)
    page.locator('[data-action="zoom-fit"]').click()
    check("mobile-camera-fit", snapshot(page)["cameraZoom"] == 1)
    page.locator('[data-action="details"]').first.click()
    check("mobile-details-pauses", snapshot(page)["paused"] and page.locator(".details-open").count() == 1)
    page.locator(".details-close").click()
    check("mobile-details-close-keeps-pause", snapshot(page)["paused"] and page.locator(".details-open").count() == 0)

    page.locator('[data-action="home"]').click()
    page.reload()
    page.wait_for_function("window.__SCRAP_LEAGUE__ !== undefined", timeout=20000)
    check("campaign-save-survives-reload", "continue" in page.locator("body").inner_text().lower())

    page.locator('[data-action="new-campaign"]').click()
    page.locator('[data-action="start-battle"]').click()
    page.locator('[data-change="speed"]').select_option("2")
    page.locator('[data-action="pause"]').click()
    page.wait_for_function("window.__SCRAP_LEAGUE__.snapshot().result !== null", timeout=45000)
    victory = snapshot(page)["result"]
    report["realVictoryResult"] = victory
    check("real-victory-by-neutralization", victory["winner"] == "player" and victory["reason"] == "neutralized")
    page.locator('[data-action="claim"]').click()
    reward = page.evaluate("JSON.parse(localStorage.getItem('scrap-league-v1:campaign'))")
    check("reward-applied-once", len(reward["rewards"]) == 1 and reward["encounter"] == 1 and reward["researchPoints"] == 1)
    page.evaluate("document.querySelector('[data-action=claim]')?.click()")
    check("duplicate-callback-cannot-reward", len(page.evaluate("JSON.parse(localStorage.getItem('scrap-league-v1:campaign')).rewards")) == 1)
    page.locator('[data-action="research"][data-id="power-hammer"]').click()
    check("research-affects-current-campaign", "power-hammer" in page.evaluate("JSON.parse(localStorage.getItem('scrap-league-v1:campaign')).research"))
    page.screenshot(path=OUT / "refonte-real-victory-reward.png", full_page=True)
    browser.close()

report["passed"] = all(report["checks"].values()) and not report["consoleErrors"]
(OUT / "refonte-browser.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(json.dumps(report, indent=2, ensure_ascii=False))
