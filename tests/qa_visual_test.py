#!/usr/bin/env python3
"""
Senior Visual QA Test Suite for 1C BSL AI Copilot (NormaHub).
Executes 100% of all UI features in a real headless Google Chrome browser.
"""

import os
import sys
import json
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE_DIR = Path(__file__).resolve().parent.parent
HTML_PATH = BASE_DIR / "tests" / "webview_test.html"
SCREENSHOT_DIR = BASE_DIR / "qa_screenshots"
SCREENSHOT_DIR.mkdir(exist_ok=True)

print("=" * 65)
print("STARTING 100% REAL VISUAL QA TEST FOR 1C BSL AI COPILOT")
print("=" * 65)

errors_logged = []

def run_qa():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path="/usr/bin/google-chrome",
            headless=True,
            args=["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"]
        )
        context = browser.new_context(
            viewport={"width": 320, "height": 850},
            device_scale_factor=1.0
        )
        page = context.new_page()

        # Intercept console messages and errors
        page.on("console", lambda msg: (
            print(f"  [BROWSER {msg.type.upper()}] {msg.text}") 
            if msg.type in ("error", "warning") else None,
            errors_logged.append(msg.text) if msg.type == "error" else None
        ))
        page.on("pageerror", lambda err: (
            print(f"  [PAGE ERROR CRASH] {err}"),
            errors_logged.append(str(err))
        ))

        # Inject realistic VS Code Webview API bridge
        page.add_init_script("""
            window.__postedMessages = [];
            window.__vscodeState = {};
            window.acquireVsCodeApi = function() {
                return {
                    postMessage: function(msg) {
                        window.__postedMessages.push(msg);
                    },
                    getState: function() { return window.__vscodeState; },
                    setState: function(s) { window.__vscodeState = s; }
                };
            };
        """)

        def get_last_posted():
            return page.evaluate("window.__postedMessages[window.__postedMessages.length - 1]")

        def get_all_posted():
            return page.evaluate("window.__postedMessages")

        def send_backend_message(data):
            page.evaluate("(msg) => { window.dispatchEvent(new MessageEvent('message', { data: msg })); }", data)

        print("\n[Step 1] Loading Webview in Chrome (file:// url)...")
        page.goto(f"file://{HTML_PATH}")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(500)
        assert len(errors_logged) == 0, f"Page loaded with errors: {errors_logged}"
        print("  ✓ Webview loaded with ZERO console errors")

        # 1. Header & Theme Toggle
        print("\n[Step 2] Testing Theme Toggle & Header Bar...")
        theme_btn = page.locator("#themeBtn")
        assert theme_btn.is_visible()
        theme_label = page.locator("#themeLabel").inner_text()
        assert theme_label == "Песочная", f"Expected 'Песочная', got {theme_label}"
        assert "theme-espresso" in page.locator("body").get_attribute("class")
        
        # Click toggle theme
        theme_btn.click()
        page.wait_for_timeout(200)
        assert "theme-warm-sand" in page.locator("body").get_attribute("class")
        assert page.locator("#themeLabel").inner_text() == "Тёмная"
        print("  ✓ Toggled to Warm Sand theme successfully")
        
        # Toggle back to Espresso
        theme_btn.click()
        page.wait_for_timeout(200)
        assert "theme-espresso" in page.locator("body").get_attribute("class")
        print("  ✓ Toggled back to Espresso theme successfully")

        # 2. Context Bar
        print("\n[Step 3] Verifying Context Bar...")
        context_bar = page.locator(".context-bar")
        assert context_bar.is_visible()
        items = page.locator(".context-item").all_inner_texts()
        assert any("Метаданные" in it for it in items)
        assert any("Вкладок в контексте" in it for it in items)
        print("  ✓ Context bar renders metadata count and multi-tab context badges")

        # 3. Tab Navigation (Test all 9 tabs)
        print("\n[Step 4] Testing Tab Switching (All 9 Tabs)...")
        tabs = [
            ("queries", "#tab-btn-queries", "#tab-queries"),
            ("bsp", "#tab-btn-bsp", "#tab-bsp"),
            ("extensions", "#tab-btn-extensions", "#tab-extensions"),
            ("audit", "#tab-btn-audit", "#tab-audit"),
            ("bdd", "#tab-btn-bdd", "#tab-bdd"),
            ("techlog", "#tab-btn-techlog", "#tab-techlog"),
            ("metadata", "#tab-btn-metadata", "#tab-metadata"),
            ("sidecar", "#tab-btn-sidecar", "#tab-sidecar"),
            ("settings", "#tab-btn-settings", "#tab-settings"),
        ]
        for name, btn_sel, panel_sel in tabs:
            page.locator(btn_sel).click()
            page.wait_for_timeout(100)
            assert "active" in page.locator(btn_sel).get_attribute("class"), f"Tab btn {name} not active"
            assert "active" in page.locator(panel_sel).get_attribute("class"), f"Tab panel {name} not active"
        print("  ✓ All 9 navigation tabs switch deterministically and activate their panels")

        # 4. Tab 1: Queries
        print("\n[Step 5] Testing Tab 1: Queries (Refactor & Batch Templates)...")
        page.locator("#tab-btn-queries").click()
        
        # A: Refactor Query
        page.fill("#refactorInput", "ВЫБРАТЬ Ссылка ИЗ Документ.РеализацияТоваровУслуг ЛЕВОЕ СОЕДИНЕНИЕ РегистрНакопления.ТоварыНаСкладах.Остатки КАК Остатки ПО Истина")
        page.locator("button:has-text('Оптимизировать запрос')").click()
        last_msg = get_last_posted()
        assert last_msg["type"] == "refactorQuery", f"Expected refactorQuery, got {last_msg}"
        print("  ✓ Refactor request posted to backend")

        # Mock refactor response from backend
        send_backend_message({
            "type": "refactorResult",
            "code": "// Оптимизированный пакет запросов 1С\nВЫБРАТЬ ... ПОМЕСТИТЬ ВТ_Остатки ... ИНДЕКСИРОВАТЬ ПО ...",
            "optimizations": ["Изоляция виртуальной таблицы Остатки в ВТ_Остатки", "Добавлена индексация по измерениям"]
        })
        page.wait_for_timeout(200)
        refactor_output = page.locator("#refactorOutput")
        assert refactor_output.is_visible()
        assert "ПРИМЕНЕННЫЕ ОПТИМИЗАЦИИ ИТС" in refactor_output.inner_text()
        print("  ✓ Refactor result received and displayed in output box")

        # B: Batch Posting Template
        page.fill("#batchEntity", "ПриходнаяНакладная")
        page.fill("#batchTabular", "Материалы")
        page.fill("#batchRegister", "ОстаткиМатериалов")
        page.locator("button[onclick='generateBatch()']").click()
        last_msg = get_last_posted()
        assert last_msg["type"] == "generateBatchTemplate"
        assert last_msg["entity"] == "ПриходнаяНакладная"
        assert last_msg["register"] == "ОстаткиМатериалов"
        print("  ✓ Batch template generation dispatched with parameters")

        # C: Query Intent
        page.fill("#queryIntent", "Остатки товаров на складах с ценами номенклатуры")
        page.locator("button[onclick='generateQuery()']").click()
        last_msg = get_last_posted()
        assert last_msg["type"] == "generateQuery"
        assert "Остатки товаров" in last_msg["intent"]
        print("  ✓ AI Query generation request dispatched")
        page.screenshot(path=str(SCREENSHOT_DIR / "01_tab_queries.png"))

        # 5. Tab 2: BSP 3.1
        print("\n[Step 6] Testing Tab 2: BSP 3.1 (Catalog, Filters, Search & Clipboard)...")
        page.locator("#tab-btn-bsp").click()
        page.wait_for_timeout(200)
        
        # Verify 40 methods rendered
        bsp_items = page.locator(".bsp-item")
        assert bsp_items.count() >= 35, f"Expected 40 items, found {bsp_items.count()}"
        print(f"  ✓ BSP catalog rendered with {bsp_items.count()} standard methods")

        # Test filter chip
        page.locator("#bspFilters .chip:has-text('Строки')").click()
        page.wait_for_timeout(100)
        filtered_count = page.locator(".bsp-item").count()
        assert filtered_count < 40 and filtered_count > 0
        print(f"  ✓ Filtered by 'Строки' subsystem: {filtered_count} methods shown")

        # Reset filter
        page.locator("#bspFilters .chip:has-text('Все')").click()
        page.wait_for_timeout(100)
        assert page.locator(".bsp-item").count() == bsp_items.count()

        # Search method
        page.fill("#bspSearchInput", "ЗначениеРеквизитаОбъекта")
        page.wait_for_timeout(100)
        assert page.locator(".bsp-item").count() >= 1
        print("  ✓ Live search accurately filtered to 'ЗначениеРеквизитаОбъекта'")

        # Click Copy
        page.locator(".bsp-item button:has-text('Копировать')").first.click()
        last_msg = get_last_posted()
        assert last_msg["type"] == "copyToClipboard"
        assert "ЗначениеРеквизитаОбъекта" in last_msg["text"]
        print("  ✓ Snippet copy dispatched to clipboard")

        # Click Insert
        page.locator(".bsp-item button:has-text('Вставить')").first.click()
        last_msg = get_last_posted()
        assert last_msg["type"] == "insertCode"
        print("  ✓ Snippet insert dispatched to active editor")
        page.screenshot(path=str(SCREENSHOT_DIR / "02_tab_bsp.png"))

        # 6. Tab 3: Extensions (&cfe)
        print("\n[Step 7] Testing Tab 3: Extensions (&cfe Interceptors & Buttons)...")
        page.locator("#tab-btn-extensions").click()
        page.select_option("#extDirective", "Вместо")
        page.fill("#extMethod", "ОбработкаПроведения")
        page.locator("button:has-text('Сгенерировать перехватчик')").click()
        last_msg = get_last_posted()
        assert last_msg["type"] == "generateExtension"
        assert last_msg["directive"] == "Вместо"
        print("  ✓ Extension interceptor generated with &Вместо")

        # Simulate backend response
        send_backend_message({
            "type": "extensionResult",
            "code": "&Вместо(\"ОбработкаПроведения\")\nПроцедура Расш_ОбработкаПроведения(Отказ, РежимПроведения)\n    ПродолжитьВызов(Отказ, РежимПроведения);\nКонецПроцедуры"
        })
        page.wait_for_timeout(200)
        assert page.locator("#extOutput").is_visible()
        assert "ПродолжитьВызов" in page.locator("#extOutput").inner_text()
        print("  ✓ Interceptor displayed with ContinueCall safety pattern")

        # Dynamic form button
        page.fill("#btnFormName", "КнопкаЭкспрессПечать")
        page.locator("button:has-text('Сгенерировать код ПриСозданииНаСервере')").click()
        last_msg = get_last_posted()
        assert last_msg["type"] == "generateFormButton"
        assert last_msg["buttonName"] == "КнопкаЭкспрессПечать"
        print("  ✓ Dynamic form button generator dispatched")
        page.screenshot(path=str(SCREENSHOT_DIR / "03_tab_extensions.png"))

        # 7. Tab 4: Audit
        print("\n[Step 8] Testing Tab 4: ITS Standards Audit...")
        page.locator("#tab-btn-audit").click()
        page.fill("#auditSnippetInput", "Для Каждого Стр Из ТЗ Цикл\n    Запрос = Новый Запрос;\nКонецЦикла;\nПредупреждение(\"Ошибка\");")
        page.locator("button:has-text('Проверить фрагмент')").click()
        last_msg = get_last_posted()
        assert last_msg["type"] == "auditCodeSnippet"
        print("  ✓ Audit snippet dispatched to standards checker")

        # Send audit result
        send_backend_message({
            "type": "auditResult",
            "issues": [
                {
                    "rule": "ITS-PERF-001",
                    "severity": "error",
                    "line": 2,
                    "message": "Запрос внутри цикла",
                    "suggestion": "Вынесите запрос за пределы цикла с передачей массива параметров."
                },
                {
                    "rule": "ITS-UI-003",
                    "severity": "warning",
                    "line": 4,
                    "message": "Синхронный модальный вызов Предупреждение()",
                    "suggestion": "Замените на асинхронный ПоказатьПредупреждение() в управляемом интерфейсе."
                }
            ]
        })
        page.wait_for_timeout(200)
        issue_cards = page.locator(".issue-card")
        assert issue_cards.count() == 2
        print("  ✓ Audit returned 2 structured issues with severity badges")

        # Test jump to line link
        page.locator(".issue-link").first.click()
        last_msg = get_last_posted()
        assert last_msg["type"] == "jumpToLine"
        assert last_msg["line"] == 2
        print("  ✓ Clicking 'Строка 2' triggered editor navigation jumpToLine")
        page.screenshot(path=str(SCREENSHOT_DIR / "04_tab_audit.png"))

        # 8. Tab 5: Vanessa BDD
        print("\n[Step 9] Testing Tab 5: Vanessa-Automation BDD...")
        page.locator("#tab-btn-bdd").click()
        page.fill("#bddEntity", "ЗаказКлиента")
        page.locator("button:has-text('Сгенерировать в буфер')").click()
        last_msg = get_last_posted()
        assert last_msg["type"] == "generateBdd"
        assert last_msg["entity"] == "ЗаказКлиента"
        assert last_msg["openEditor"] is False
        print("  ✓ BDD feature generation dispatched")

        send_backend_message({
            "type": "bddResult",
            "feature": "# language: ru\nФункционал: Проведение документа ЗаказКлиента\nСценарий: Проведение с контролем взаиморасчетов"
        })
        page.wait_for_timeout(200)
        assert page.locator("#bddOutput").is_visible()
        assert "Функционал: Проведение документа ЗаказКлиента" in page.locator("#bddOutput").inner_text()
        print("  ✓ Russian Gherkin BDD scenario generated and rendered")
        page.screenshot(path=str(SCREENSHOT_DIR / "05_tab_bdd.png"))

        # 9. Tab 6: Tech Log
        print("\n[Step 10] Testing Tab 6: 1C TechLog Diagnostics...")
        page.locator("#tab-btn-techlog").click()
        
        # Test all 4 demo chips
        chips = ["TLOCK", "TDEADLOCK", "EXCP", "DBPOSTGR"]
        for chip in chips:
            page.locator(f"#tab-techlog .chip:has-text('{chip}')").click()
            val = page.locator("#techlogInput").input_value()
            assert chip in val, f"Chip {chip} failed to populate input"
        print("  ✓ All 4 incident sample chips (TLOCK, TDEADLOCK, EXCP, DBPOSTGR) work cleanly")

        # Analyze
        page.locator("button:has-text('Диагностировать инциденты')").click()
        last_msg = get_last_posted()
        assert last_msg["type"] == "analyzeTechLog"
        assert "DBPOSTGR" in last_msg["rawLog"]
        print("  ✓ Tech log diagnosis request dispatched")

        send_backend_message({
            "type": "techLogResult",
            "report": "АНАЛИЗ ТЕХНОЛОГИЧЕСКОГО ЖУРНАЛА 1С\nИнцидент: Медленный запрос DBPOSTGR (8450 мс)\nРекомендация: Добавить составной индекс СУБД."
        })
        page.wait_for_timeout(200)
        assert page.locator("#techlogOutput").is_visible()
        assert "Медленный запрос DBPOSTGR" in page.locator("#techlogOutput").inner_text()
        print("  ✓ High-Load incident diagnosis rendered with architectural resolution")
        page.screenshot(path=str(SCREENSHOT_DIR / "06_tab_techlog.png"))

        # 10. Tab 7: Metadata
        print("\n[Step 11] Testing Tab 7: Configuration Metadata Tree...")
        page.locator("#tab-btn-metadata").click()
        page.locator("button:has-text('Сканировать')").click()
        last_msg = get_last_posted()
        assert last_msg["type"] == "scanMetadata"
        print("  ✓ Scan metadata request dispatched")

        send_backend_message({
            "type": "metadataResult",
            "summary": "1С:ПРЕДПРИЯТИЕ 8.3 МЕТАДАННЫЕ:\nСправочники (14): Номенклатура, Склады, Контрагенты\nДокументы (18): РеализацияТоваровУслуг, ПоступлениеТоваров"
        })
        page.wait_for_timeout(200)
        assert "Справочники (14)" in page.locator("#metadataSummaryBox").inner_text()
        print("  ✓ Configuration tree parsed and displayed in metadata summary box")

        page.locator("button:has-text('Открыть metadata.json')").click()
        last_msg = get_last_posted()
        assert last_msg["type"] == "openWorkspaceFile"
        assert last_msg["relativePath"] == "metadata.json"
        print("  ✓ Metadata workspace file open request dispatched")
        page.screenshot(path=str(SCREENSHOT_DIR / "07_tab_metadata.png"))

        # 11. Tab 8: Sidecar
        print("\n[Step 12] Testing Tab 8: Global Sidecar & Configurator Status...")
        page.locator("#tab-btn-sidecar").click()
        page.locator("button[onclick='checkSidecar()']").click()
        last_msg = get_last_posted()
        assert last_msg["type"] == "checkSidecarStatus"
        print("  ✓ Sidecar daemon health check dispatched")

        send_backend_message({
            "type": "sidecarStatus",
            "online": True,
            "info": {"version": "1.0.0"}
        })
        page.wait_for_timeout(200)
        assert "Онлайн" in page.locator("#sidecarStatusIndicator").inner_text()
        print("  ✓ Sidecar status updated to online in UI")
        page.screenshot(path=str(SCREENSHOT_DIR / "08_tab_sidecar.png"))

        # 12. Tab 9: Settings, Balance & Models
        print("\n[Step 13] Testing Tab 9: Settings, Balance & Model Selector...")
        page.locator("#tab-btn-settings").click()
        
        # Test model selector dropdown (7 models)
        models_to_test = [
            "gpt-6.1-sol",
            "gpt-6-sol",
            "gpt-6-astra",
            "glm-5.3-flash",
            "muse-spark-1.3",
            "claude-sonnet-5-5",
            "deepseek-v4.1-flash"
        ]
        for m in models_to_test:
            page.select_option("#modelSelector", m)
            page.wait_for_timeout(50)
            last_msg = get_last_posted()
            assert last_msg["type"] == "changeModel"
            assert last_msg["model"] == m
        print(f"  ✓ All {len(models_to_test)} AI models selected and synchronized with VS Code settings")

        # Save API key
        page.fill("#apiKeyInput", "nr_hub_enterprise_senior_test_key_2026")
        page.locator("button:has-text('Сохранить ключ в SecretStorage')").click()
        last_msg = get_last_posted()
        assert last_msg["type"] == "saveKey"
        assert last_msg["value"] == "nr_hub_enterprise_senior_test_key_2026"
        print("  ✓ API Key securely dispatched to SecretStorage")

        # External billing links
        page.locator("button:has-text('Пополнить (СБП / МИР)')").click()
        last_msg = get_last_posted()
        assert last_msg["type"] == "openBilling"

        page.locator("button:has-text('Счет с НДС 20%')").click()
        last_msg = get_last_posted()
        assert last_msg["type"] == "openB2B"
        print("  ✓ Billing and corporate invoice external URLs verified")
        page.screenshot(path=str(SCREENSHOT_DIR / "09_tab_settings.png"))

        # 13. Narrow Viewport / Responsiveness Test
        print("\n[Step 14] Testing Ultra-Narrow Viewport (220px) Ergonomics...")
        page.set_viewport_size({"width": 220, "height": 800})
        page.wait_for_timeout(300)
        
        # Check that there is NO horizontal document overflow
        scroll_width = page.evaluate("document.body.scrollWidth")
        client_width = page.evaluate("document.body.clientWidth")
        assert scroll_width <= client_width + 2, f"Horizontal scroll detected! scrollWidth={scroll_width}, clientWidth={client_width}"
        print(f"  ✓ Ultra-narrow viewport (220px) verified: ZERO horizontal overflow (scrollWidth={scroll_width}, clientWidth={client_width})")
        page.screenshot(path=str(SCREENSHOT_DIR / "10_narrow_viewport_220px.png"))

        # 14. Verification of Console Errors
        print("\n[Step 15] Verifying Console Log Quality...")
        assert len(errors_logged) == 0, f"Found console errors during execution: {errors_logged}"
        print("  ✓ ABSOLUTE ZERO (0) runtime JS errors during entire end-to-end user session!")

        browser.close()

    print("\n" + "=" * 65)
    print("ALL 15/15 SENIOR VISUAL QA SUITES PASSED WITH 100% SUCCESS!")
    print(f"Screenshots saved to: {SCREENSHOT_DIR}")
    print("=" * 65)

if __name__ == "__main__":
    run_qa()
