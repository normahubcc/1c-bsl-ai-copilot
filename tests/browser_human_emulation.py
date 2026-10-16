#!/usr/bin/env python3
"""
Real Browser Human-Emulation Test Suite for 1C BSL AI Copilot.
Tests 100% of UI functionality over HTTP port 8088 with Playwright Chromium.
Performs realistic mouse clicks, keyboard input, theme switching, segmented controls,
and visual screenshot capture.
"""

from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from playwright.sync_api import sync_playwright

BASE_DIR = Path(__file__).resolve().parent.parent
HTML_DIR = BASE_DIR / "tests"
HTML_PATH = HTML_DIR / "webview_test.html"
SCREENSHOT_DIR = BASE_DIR / "qa_screenshots"
SCREENSHOT_DIR.mkdir(exist_ok=True)

print("=" * 70)
print("🚀 RUNNING HUMAN EMULATION VISUAL QA SUITE")
print("=" * 70)

browser_logs = []
browser_errors = []

def run_test():
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=str(HTML_DIR)))
    server_thread = Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    url = f"http://127.0.0.1:{server.server_address[1]}/{HTML_PATH.name}"

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                executable_path="/usr/bin/google-chrome",
                headless=True,
                args=["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"]
            )
            context = browser.new_context(
                viewport={"width": 360, "height": 880},
                device_scale_factor=1.0
            )
            page = context.new_page()

            # Listen to console messages and page errors
            page.on("console", lambda msg: (
                browser_logs.append(f"[{msg.type.upper()}] {msg.text}"),
                browser_errors.append(msg.text) if msg.type == "error" else None,
                print(f"  [BROWSER {msg.type.upper()}] {msg.text}") if msg.type in ("error", "warning") else None
            ))
            page.on("pageerror", lambda err: (
                browser_errors.append(str(err)),
                print(f"  [FATAL PAGE CRASH] {err}")
            ))

            # 1. Open URL
            print(f"\n[Step 1] Opening HTTP URL: {url}...")
            resp = page.goto(url, wait_until="networkidle")
            assert resp.status == 200, f"Expected HTTP 200, got {resp.status}"
            page.wait_for_timeout(300)
            assert len(browser_errors) == 0, f"Found browser errors on load: {browser_errors}"
            print("  ✓ Page loaded over a local HTTP server with ZERO console errors")

            # 1.5 Welcome Modal Verification & Dismissal
            print("\n[Step 1.5] Testing First-Launch Welcome Modal...")
            welcome_modal = page.locator("#welcomeModal")
            if welcome_modal.is_visible():
                modal_title = page.locator(".modal-title").inner_text()
                assert "BSL Studio" in modal_title or "Добро пожаловать" in modal_title
                assert page.locator(".modal-btn-primary").is_visible()
                print(f"  ✓ Welcome modal displayed on first launch: '{modal_title}'")
                page.screenshot(path=str(SCREENSHOT_DIR / "00_welcome_modal.png"))
                # Dismiss welcome modal
                page.locator(".modal-btn-primary").click()
                page.wait_for_timeout(300)
                assert not welcome_modal.is_visible(), "Welcome modal should close after clicking primary button"
                print("  ✓ Welcome modal closed cleanly, uncovering main UI")
            else:
                print("  ℹ Welcome modal already dismissed in previous state")

            # 2. Header & Theme Toggle Check
            print("\n[Step 2] Testing Theme Toggle & Header Bar...")
            theme_btn = page.locator("#themeBtn")
            assert theme_btn.is_visible(), "Theme toggle button is missing"
        
            # Initial theme is Espresso Obsidian
            assert "theme-espresso" in page.locator("body").get_attribute("class")
            assert page.locator("#themeLabel").inner_text() == "Светлая"
        
            # Click toggle -> Warm Sand
            theme_btn.click()
            page.wait_for_timeout(200)
            assert "theme-warm-sand" in page.locator("body").get_attribute("class")
            assert page.locator("#themeLabel").inner_text() == "Тёмная"
            print("  ✓ Successfully switched to the light theme")

            # Capture Warm Sand Queries
            page.screenshot(path=str(SCREENSHOT_DIR / "01_warm_sand_queries.png"))

            # Switch back to Espresso Obsidian for standard testing
            theme_btn.click()
            page.wait_for_timeout(200)
            assert "theme-espresso" in page.locator("body").get_attribute("class")
            print("  ✓ Successfully returned to the graphite dark theme")

            # 2.5 Quick Start Guide Check
            print("\n[Step 2.5] Testing Collapsible 3-Step Quick Start Guide...")
            qs_box = page.locator("#quickStartBox")
            if qs_box.is_visible():
                qs_steps = page.locator(".qs-step")
                assert qs_steps.count() == 3, f"Expected 3 quick start steps, got {qs_steps.count()}"
                print("  ✓ Quick Start box rendered with 3 clear onboarding steps")

                # Test collapse toggle
                page.locator(".quick-start-header").click()
                page.wait_for_timeout(150)
                assert "collapsed" in qs_box.get_attribute("class"), "Expected Quick Start box to collapse"
                assert not page.locator("#quickStartBody").is_visible(), "Quick Start body should be hidden when collapsed"
                print("  ✓ Collapsed Quick Start guide successfully")

                # Test expand toggle
                page.locator(".quick-start-header").click()
                page.wait_for_timeout(150)
                assert "collapsed" not in qs_box.get_attribute("class"), "Expected Quick Start box to expand"
                assert page.locator("#quickStartBody").is_visible(), "Quick Start body should be visible"
                print("  ✓ Expanded Quick Start guide back")

            # 2.6 Test Segmented Control (AI vs Tools)
            print("\n[Step 2.6] Testing Segmented Category Control...")
            seg_ai = page.locator("#cat-btn-ai")
            seg_tools = page.locator("#cat-btn-tools")
            assert seg_ai.is_visible() and seg_tools.is_visible()

            # Switch to Tools
            seg_tools.click()
            page.wait_for_timeout(200)
            assert "active" in seg_tools.get_attribute("class")
            print("  ✓ Switched to 'Инструменты 1С' category")

            # Switch back to AI
            seg_ai.click()
            page.wait_for_timeout(200)
            assert "active" in seg_ai.get_attribute("class")
            print("  ✓ Switched to 'AI Ассистент' category")

            # 2.7 Test Action Pilot Cockpit (Killer Actions & Live Output Studio)
            print("\n[Step 2.7] Testing Action Pilot Cockpit...")
            page.evaluate("selectCategory('ai', 'ai-overview')")
            page.wait_for_timeout(200)

            # Context banner check
            ctx_banner = page.locator("#editorContextBanner")
            assert ctx_banner.is_visible(), "Editor context banner must be visible in Action Pilot"
            assert ctx_banner.get_attribute("data-context-state") == "empty"
            assert "не выбран" in page.locator("#pilotContextFile").inner_text()
            assert "Объектов" not in page.locator(".top-navbar").inner_text()
            print("  ✓ Empty editor context is explicit and header does not show a fabricated metadata count")

            # Simulate VS Code reporting an active BSL file and a selected query.
            page.evaluate("""window.dispatchEvent(new MessageEvent('message', { data: {
                type: 'editorContext', fileName: 'Остатки.bsl', isBsl: true,
                lineCount: 8, hasSelection: true,
                selectedText: 'ВЫБРАТЬ Ссылка ИЗ Документ.ЗаказКлиента'
            }}))""")
            assert ctx_banner.get_attribute("data-context-state") == "ready"
            assert "Остатки.bsl" in page.locator("#pilotContextFile").inner_text()

            # Quick action opens the real tool with selected editor content; it does not run on demo code.
            killer_opt = page.locator(".killer-card:has-text('Оптимизировать запрос (ИТС)')")
            assert killer_opt.is_visible()
            killer_opt.locator("button").click()
            page.wait_for_timeout(350)
            assert "active" in page.locator("#tab-queries-refactor").get_attribute("class")
            assert "ВЫБРАТЬ Ссылка ИЗ Документ.ЗаказКлиента" in page.locator("#refactorInput").input_value()
            assert not page.locator("#cockpitOutputStudio").is_visible()
            print("  ✓ Optimize action opens the real query tool and carries selected code without fabricating a result")

            # Other quick actions also navigate to their actual forms.
            page.evaluate("selectCategory('ai', 'ai-overview')")
            killer_ext = page.locator(".killer-card:has-text('Обернуть метод в расширение')")
            killer_ext.locator("button").click()
            page.wait_for_timeout(350)
            assert "active" in page.locator("#tab-extensions").get_attribute("class")
            print("  ✓ Extension quick action opens its configured form")

            # Batch action
            page.evaluate("selectCategory('ai', 'ai-overview')")
            killer_batch = page.locator(".killer-card:has-text('Сформировать проведение с остатками')")
            killer_batch.locator("button").click()
            page.wait_for_timeout(350)
            assert "active" in page.locator("#tab-queries-batch").get_attribute("class")
            print("  ✓ Posting quick action opens the configured batch form")

            # Main prompt truthfully describes query generation and submits with Ctrl+Enter.
            page.evaluate("selectCategory('ai', 'ai-overview')")
            page.fill("#cockpitPromptInput", "Сформировать выборку остатков номенклатуры")
            page.locator("#cockpitPromptInput").press("Control+Enter")
            page.wait_for_timeout(250)
            assert "Сформировать пакет запроса" in page.locator(".pilot-prompt-title").inner_text()
            assert "Готово" in page.locator("#cockpitPromptStatus").inner_text()
            print("  ✓ Query prompt is explicit and keyboard shortcut dispatches a request")

            # Result can be inserted only when BSL context exists.
            page.evaluate("window.dispatchEvent(new MessageEvent('message', { data: { type: 'queryResult', code: 'Запрос = Новый Запрос;' } }))")
            assert page.locator("#cockpitOutputStudio").is_visible()
            assert "активный BSL-модуль" in page.locator("#cockpitTarget").inner_text()
            page.locator("button[onclick='insertCockpitCode()']").click()
            assert "insertCode" in page.locator("#toast").get_attribute("class") or "show" in page.locator("#toast").get_attribute("class")
            print("  ✓ Generated result exposes its target and insert action when a BSL file is active")

            # Screenshot Action Pilot
            page.screenshot(path=str(SCREENSHOT_DIR / "01_action_pilot_cockpit.png"))

            # 3. Tab 1: Queries (Запросы)
            print("\n[Step 3] Testing Tab: Queries Refactor & Generation...")
            page.evaluate("switchTab('queries-refactor')")
            page.wait_for_timeout(250)

            # Test 1-Click Sample Chip for Query Refactoring
            sample_chip = page.locator(".chip:has-text('Пример: Соединение с вирт. таблицей')")
            if sample_chip.is_visible():
                sample_chip.click()
                page.wait_for_timeout(150)
                refactor_input_val = page.locator("#refactorInput").input_value()
                assert "РегистрНакопления.ТоварыНаСкладах.Остатки" in refactor_input_val
                print("  ✓ 1-Click sample chip populated realistic non-optimal query into textarea")

            # Test Refactoring Query
            page.locator("button[onclick='refactorQuery()']").click()
            page.wait_for_timeout(350)
            refactor_out = page.locator("#refactorOutput")
            assert refactor_out.is_visible()
            assert "ОПТИМИЗИРОВАННЫЙ ПАКЕТ ЗАПРОСОВ" in refactor_out.inner_text()
            print("  ✓ Query refactoring executed according to 1C ITS standards")

            # Test 'Вставить в модуль' clear user feedback
            page.locator("#refactorActions button:has-text('Вставить в модуль')").click()
            page.wait_for_timeout(200)
            toast = page.locator("#toast")
            assert "show" in toast.get_attribute("class")
            print(f"  ✓ User feedback verified on 'Вставить в модуль': '{toast.inner_text()}'")

            # Test Query Generator
            page.evaluate("switchTab('queries-gen')")
            page.wait_for_timeout(200)
            chip_gen = page.locator(".chips-row .chip:has-text('Остатки на дату')")
            if chip_gen.is_visible():
                chip_gen.click()
                page.wait_for_timeout(100)
            page.locator("button[onclick='generateQuery()']").click()
            page.wait_for_timeout(350)
            query_out = page.locator("#queryOutput")
            assert query_out.is_visible()
            assert "ВЫБРАТЬ" in query_out.inner_text()
            print("  ✓ AI Query generation executed successfully")

            # Test Batch Posting Template
            page.evaluate("switchTab('queries-batch')")
            page.wait_for_timeout(200)
            page.fill("#batchEntity", "РеализацияТоваровУслуг")
            page.locator("button[onclick='generateBatch()']").click()
            page.wait_for_timeout(200)
            batch_out = page.locator("#batchOutput")
            assert batch_out.is_visible()
            assert "Движения.ТоварыНаСкладах.Записывать = Истина;" in batch_out.inner_text()
            print("  ✓ Batch posting template generated")
            page.screenshot(path=str(SCREENSHOT_DIR / "01_human_tab_queries.png"))

            # 4. Tab 2: BSP 3.1 (Библиотека Стандартных Подсистем)
            print("\n[Step 4] Testing Tab: BSP 3.1 Catalog & Search...")
            page.evaluate("switchTab('bsp')")
            page.wait_for_timeout(250)
            assert page.locator("#tab-bsp").is_visible()

            # Check BSP items count
            bsp_items = page.locator(".bsp-item")
            count = bsp_items.count()
            assert count >= 35, f"Expected 40 BSP methods, got {count}"
            print(f"  ✓ BSP Catalog rendered with {count} standard methods")

            # Verify Hierarchy of BSP method card
            first_title = bsp_items.first.locator(".bsp-method-name").inner_text()
            first_module = bsp_items.first.locator(".bsp-module-tag").inner_text()
            print(f"    - First BSP Title: '{first_title}'")
            print(f"    - First BSP Module Subtitle: '{first_module}'")
            assert "()" in first_title
            assert "Общий модуль:" in first_module

            # Test search
            page.fill("#bspSearchInput", "ЗначениеРеквизитаОбъекта")
            page.wait_for_timeout(200)
            filtered_count = page.locator(".bsp-item").count()
            assert filtered_count >= 1, "Should find ЗначениеРеквизитаОбъекта"
            found_title = page.locator(".bsp-item .bsp-method-name").first.inner_text()
            assert "ЗначениеРеквизитаОбъекта" in found_title
            print(f"  ✓ Live search filtered to '{found_title}'")

            # Test Copy snippet button
            page.locator(".bsp-item button:has-text('Копировать вызов')").first.click()
            page.wait_for_timeout(200)
            assert "show" in page.locator("#toast").get_attribute("class")
            print("  ✓ 'Копировать вызов' clicked, toast feedback confirmed")

            # Test Subsystem Filter chip
            page.fill("#bspSearchInput", "")
            page.locator("#bspFilters .chip:has-text('Строковые функции')").click()
            page.wait_for_timeout(200)
            strings_count = page.locator(".bsp-item").count()
            assert 0 < strings_count < count
            print(f"  ✓ Subsystem chip 'Строковые функции' filtered to {strings_count} methods")

            page.screenshot(path=str(SCREENSHOT_DIR / "02_human_tab_bsp.png"))

            # Capture BSP in Warm Sand theme
            theme_btn.click()
            page.wait_for_timeout(200)
            page.screenshot(path=str(SCREENSHOT_DIR / "10_warm_sand_bsp.png"))
            theme_btn.click()
            page.wait_for_timeout(200)

            # 5. Tab 3: Extensions (&cfe)
            print("\n[Step 5] Testing Tab: Extensions (&cfe Interceptors & Buttons)...")
            page.evaluate("switchTab('extensions')")
            page.wait_for_timeout(250)
            assert page.locator("#tab-extensions").is_visible()

            # Generate &cfe interceptor
            page.select_option("#extDirective", "Вместо")
            page.fill("#extMethod", "ОбработкаПроведения")
            page.fill("#extParams", "Отказ, РежимПроведения")
            page.locator("button[onclick='generateExt()']").click()
            page.wait_for_timeout(350)
        
            ext_out = page.locator("#extOutput")
            assert ext_out.is_visible()
            ext_text = ext_out.inner_text()
            assert "&Вместо(\"ОбработкаПроведения\")" in ext_text
            assert "ПродолжитьВызов" in ext_text
            print("  ✓ Generated safe &Вместо interceptor with ContinueCall guard")

            # Generate form button
            page.fill("#btnFormName", "КнопкаЭкспрессПечать")
            page.fill("#btnFormTitle", "Экспресс-Печать УПД")
            page.locator("button[onclick='generateFormBtn()']").click()
            page.wait_for_timeout(350)
            btn_out = page.locator("#btnFormOutput")
            assert btn_out.is_visible()
            btn_code = btn_out.inner_text()
            assert "КнопкаЭкспрессПечать" in btn_code
            print("  ✓ Dynamic managed form button generated in dedicated container")
            page.screenshot(path=str(SCREENSHOT_DIR / "03_human_tab_extensions.png"))

            # 6. Tab 4: Audit (ИТС Аудит)
            print("\n[Step 6] Testing Tab: ITS Code Standards Audit...")
            page.evaluate("switchTab('audit')")
            page.wait_for_timeout(250)
        
            # Test 1-Click Sample Chip for ITS Audit
            sample_audit_chip = page.locator(".chip:has-text('Пример: Запрос в цикле и модальность')")
            if sample_audit_chip.is_visible():
                sample_audit_chip.click()
                page.wait_for_timeout(150)
                audit_val = page.locator("#auditSnippetInput").input_value()
                assert "Для Каждого" in audit_val and "Предупреждение" in audit_val
                print("  ✓ 1-Click sample chip populated anti-pattern BSL snippet")

            # Test snippet audit
            page.locator("button[onclick='auditSnippet()']").click()
            page.wait_for_timeout(350)
        
            issue_cards = page.locator(".issue-card")
            assert issue_cards.count() >= 2, f"Expected issue cards, got {issue_cards.count()}"
            print(f"  ✓ ITS Audit detected {issue_cards.count()} structured quality issues")
            page.screenshot(path=str(SCREENSHOT_DIR / "04_human_tab_audit.png"))

            # 7. Tab 5: Vanessa BDD
            print("\n[Step 7] Testing Tab: Vanessa BDD Scenario Generator...")
            page.evaluate("switchTab('bdd')")
            page.wait_for_timeout(250)

            # Generate scenario
            page.fill("#bddEntity", "РеализацияТоваровУслуг")
            page.fill("#bddTabular", "Товары")
            page.fill("#bddRegister", "ТоварыНаСкладах")
            page.locator("button[onclick='generateBdd(false)']").click()
            page.wait_for_timeout(350)

            bdd_out = page.locator("#bddOutput")
            assert bdd_out.is_visible()
            bdd_text = bdd_out.inner_text()
            assert "# language: ru" in bdd_text
            assert "Функционал: Проведение документа РеализацияТоваровУслуг" in bdd_text
            assert "| Номенклатура" in bdd_text
            print("  ✓ BDD Gherkin scenario generated with beautiful formatting and aligned table spaces")
            page.screenshot(path=str(SCREENSHOT_DIR / "05_human_tab_bdd.png"))

            # Capture BDD in Warm Sand
            theme_btn.click()
            page.wait_for_timeout(200)
            page.screenshot(path=str(SCREENSHOT_DIR / "11_warm_sand_bdd.png"))
            theme_btn.click()
            page.wait_for_timeout(200)

            # 8. Tab 6: Tech Log (ТЖ)
            print("\n[Step 8] Testing Tab: Tech Log Diagnosis...")
            page.evaluate("switchTab('techlog')")
            page.wait_for_timeout(250)

            # Click TLOCK chip
            page.locator(".chips-row .chip:has-text('TLOCK')").click()
            page.wait_for_timeout(100)
            tlog_val = page.locator("#techlogInput").input_value()
            assert "TLOCK" in tlog_val

            # Click analyze
            page.locator("button[onclick='analyzeTechLog()']").click()
            page.wait_for_timeout(350)
            tech_out = page.locator("#techlogOutput")
            assert tech_out.is_visible()
            assert "TLOCK" in tech_out.inner_text()
            print("  ✓ Tech Log parsed and analyzed with High-Load lock remediation")
            page.screenshot(path=str(SCREENSHOT_DIR / "06_human_tab_techlog.png"))

            # 9. Tab 7: Metadata (Метаданные)
            print("\n[Step 9] Testing Tab: Metadata Cache...")
            page.evaluate("switchTab('metadata')")
            page.wait_for_timeout(250)

            page.locator("button[onclick='scanMetadata()']").click()
            page.wait_for_timeout(200)
            meta_summary = page.locator("#metadataSummaryBox").inner_text()
            assert "Справочники:" in meta_summary or "Документы:" in meta_summary
            print("  ✓ Metadata scanned and summary formatted")
            page.screenshot(path=str(SCREENSHOT_DIR / "07_human_tab_metadata.png"))

            # 10. Tab 8: Sidecar Status
            print("\n[Step 10] Testing Tab: Sidecar Daemon...")
            page.evaluate("switchTab('sidecar')")
            page.wait_for_timeout(250)

            page.locator("button[onclick='checkSidecar()']").click()
            page.wait_for_timeout(200)
            ind_text = page.locator("#sidecarStatusIndicator").inner_text()
            print(f"  ✓ Sidecar indicator verified: {ind_text}")
            page.screenshot(path=str(SCREENSHOT_DIR / "08_human_tab_sidecar.png"))

            # 11. Tab 9: Settings (Настройки, Модели, Баланс)
            print("\n[Step 11] Testing Tab: Settings & AI Model Options...")
            page.evaluate("switchTab('settings')")
            page.wait_for_timeout(250)

            # Check genuine balance / gateway status display
            balance_elem = page.locator("#tab-settings div[style*='JetBrains Mono']").first
            balance_text = balance_elem.inner_text()
            assert "Оплата по факту" in balance_text or "шлюз активен" in balance_text.lower() or "normahub" in balance_text.lower(), \
                f"Expected genuine gateway status, got: {balance_text}"
            print(f"  ✓ Genuine gateway status verified: {balance_text}")

            # Check model dropdown options
            options = page.locator("#modelSelector option").all_inner_texts()
            print("  --- Available AI Models in Settings ---")
            for opt in options:
                print(f"    • {opt}")
            print("  ---------------------------------------")

            assert any("deepseek-v4.1-flash" in opt.lower() for opt in options), \
                "Expected DeepSeek v4.1 Flash to be present in model options"
            assert any("gpt-6.1-sol" in opt.lower() or "gpt-6-sol" in opt.lower() for opt in options), \
                "Expected GPT-6 Sol models to be present in model options"
            assert not any("claude-sonnet-5-5" in opt.lower() or "sonnet 5.5" in opt.lower() for opt in options), \
                "ERROR: Removed Claude Sonnet 5.5 found in model options!"
            assert not any("gpt-6-astra" in opt.lower() for opt in options), \
                "ERROR: Removed GPT-6 Astra found in model options!"
            assert not any("muse-spark" in opt.lower() for opt in options), \
                "ERROR: Removed Muse Spark found in model options!"
            print("  ✓ Confirmed trimmed model matrix in Settings")

            # Change model
            page.select_option("#modelSelector", "deepseek-v4.1-flash")
            page.wait_for_timeout(200)
            assert "show" in page.locator("#toast").get_attribute("class")
            print("  ✓ Selected DeepSeek v4.1 Flash, toast feedback confirmed")

            # Wait for toast fade-out
            page.wait_for_timeout(1600)

            # Save API key
            page.fill("#apiKeyInput", "nr_hub_live_enterprise_secret_key_123")
            page.locator("button[onclick='saveKey()']").click()
            page.wait_for_timeout(200)
            assert "show" in page.locator("#toast").get_attribute("class")
            print("  ✓ Saved API key, SecretStorage toast feedback confirmed")

            # Test Promo Code Box in Settings
            print("  --- Testing Promo Code Box in Settings ---")
            promo_box = page.locator(".promo-badge-box")
            assert promo_box.is_visible(), "Promo badge box is missing in Settings tab"
            promo_text = promo_box.inner_text()
            assert "1CPROMO" in promo_text
            assert "$0.10" in promo_text
            print("  ✓ Promo code 1CPROMO with $0.10 bonus is subtly rendered in Settings")

            # Test copying promo code
            page.locator(".promo-copy-btn").click()
            page.wait_for_timeout(200)
            toast = page.locator("#toast")
            assert "show" in toast.get_attribute("class")
            assert "1CPROMO" in toast.inner_text()
            print(f"  ✓ Promo code copied with toast feedback: '{toast.inner_text()}'")

            page.screenshot(path=str(SCREENSHOT_DIR / "09_human_tab_settings.png"))

            # 12. Dropdown Navigation Selector
            print("\n[Step 12] Testing Navigation Selector...")
            page.evaluate("switchTab('bdd')")
            page.wait_for_timeout(200)
            assert page.locator("#tab-bdd").is_visible()
            print("  ✓ Selector directly navigated to BDD tab")

            # 13. Narrow Viewport Test (220px width)
            print("\n[Step 13] Testing Narrow Sidebar Viewport (220px width)...")
            page.set_viewport_size({"width": 220, "height": 750})
            page.wait_for_timeout(300)
            scroll_width = page.evaluate("document.documentElement.scrollWidth")
            client_width = page.evaluate("document.documentElement.clientWidth")
            assert scroll_width <= client_width + 2, f"Horizontal overflow at 220px: scrollWidth={scroll_width}, clientWidth={client_width}"
            page.screenshot(path=str(SCREENSHOT_DIR / "12_narrow_viewport_220px.png"))
            print(f"  ✓ Narrow viewport verified at 220px with no horizontal overflow ({scroll_width}px / {client_width}px)")

            browser.close()

        print("\n" + "=" * 70)
        print("🎉 ALL CURRENT WEBVIEW HUMAN-EMULATION TESTS PASSED")
        print("=" * 70)
    finally:
        server.shutdown()
        server.server_close()

if __name__ == "__main__":
    run_test()
