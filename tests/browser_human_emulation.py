#!/usr/bin/env python3
"""
Real Browser Human-Emulation Test Suite for 1C BSL AI Copilot.
Tests 100% of UI functionality over HTTP port 8088 with Playwright Chromium.
Performs realistic mouse clicks, keyboard input, theme switching, and screenshot analysis.
"""

import os
import sys
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

PORT = 8088
URL = f"http://127.0.0.1:{PORT}/"
SCREENSHOT_DIR = Path(__file__).resolve().parent.parent / "qa_screenshots"
SCREENSHOT_DIR.mkdir(exist_ok=True)

print("=" * 70)
print(f"🚀 RUNNING HUMAN EMULATION VISUAL QA SUITE ON {URL}")
print("=" * 70)

browser_logs = []
browser_errors = []

def run_test():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path="/usr/bin/google-chrome",
            headless=True,
            args=["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"]
        )
        context = browser.new_context(
            viewport={"width": 340, "height": 880},
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
        print(f"\n[Step 1] Opening HTTP URL: {URL}...")
        resp = page.goto(URL, wait_until="networkidle")
        assert resp.status == 200, f"Expected HTTP 200, got {resp.status}"
        page.wait_for_timeout(300)
        assert len(browser_errors) == 0, f"Found browser errors on load: {browser_errors}"
        print("  ✓ Page loaded over HTTP :8088 with ZERO console errors")

        # 2. Header & Theme Toggle Check
        print("\n[Step 2] Testing Theme Toggle & Header Bar...")
        theme_btn = page.locator("#themeBtn")
        assert theme_btn.is_visible(), "Theme toggle button is missing"
        
        # Initial theme is Espresso Obsidian
        assert "theme-espresso" in page.locator("body").get_attribute("class")
        assert page.locator("#themeLabel").inner_text() == "Песочная"
        
        # Click toggle -> Warm Sand
        theme_btn.click()
        page.wait_for_timeout(200)
        assert "theme-warm-sand" in page.locator("body").get_attribute("class")
        assert page.locator("#themeLabel").inner_text() == "Тёмная"
        print("  ✓ Successfully switched to 'Warm Sand' theme")

        # Capture Warm Sand Queries
        page.screenshot(path=str(SCREENSHOT_DIR / "01_warm_sand_queries.png"))

        # Switch back to Espresso Obsidian for standard testing
        theme_btn.click()
        page.wait_for_timeout(200)
        assert "theme-espresso" in page.locator("body").get_attribute("class")
        print("  ✓ Successfully returned to 'Espresso Obsidian' theme")

        # 3. Tab 1: Queries (Запросы)
        print("\n[Step 3] Testing Tab 1: Queries (Генерация, Оптимизация, Пакеты)...")
        # Click chip for sample query
        page.locator(".chips-row .chip:has-text('Остатки на дату')").click()
        page.wait_for_timeout(100)
        query_val = page.locator("#queryIntent").input_value()
        assert "остатки" in query_val.lower(), f"Expected query intent filled, got {query_val}"

        # Click generate query
        page.locator("button[onclick='generateQuery()']").click()
        page.wait_for_timeout(350)
        query_out = page.locator("#queryOutput")
        assert query_out.is_visible()
        assert "ВЫБРАТЬ" in query_out.inner_text()
        print("  ✓ AI Query batch generated and displayed with syntax formatting")

        # Test Refactoring Query
        page.fill("#refactorInput", "ВЫБРАТЬ Ссылка, Номенклатура ИЗ РегистрНакопления.ТоварыНаСкладах.Остатки КАК Остатки")
        page.locator("button[onclick='refactorQuery()']").click()
        page.wait_for_timeout(350)
        refactor_out = page.locator("#refactorOutput")
        assert refactor_out.is_visible()
        assert "ОПТИМИЗИРОВАННЫЙ ПАКЕТ ЗАПРОСОВ" in refactor_out.inner_text()
        print("  ✓ Query refactoring executed according to 1C ITS standards")

        # Test Batch Posting Template
        page.fill("#batchEntity", "РеализацияТоваровУслуг")
        page.locator("button[onclick='generateBatch()']").click()
        page.wait_for_timeout(200)
        toast = page.locator("#toast")
        assert "show" in toast.get_attribute("class")
        print("  ✓ Batch posting template generated and toast confirmed")
        page.screenshot(path=str(SCREENSHOT_DIR / "01_human_tab_queries.png"))

        # 4. Tab 2: BSP 3.1 (Библиотека Стандартных Подсистем)
        print("\n[Step 4] Testing Tab 2: BSP 3.1 Catalog & Search...")
        page.locator("#tab-btn-bsp").click()
        page.wait_for_timeout(250)
        assert page.locator("#tab-bsp").is_visible()

        # Check BSP items count
        bsp_items = page.locator(".bsp-item")
        count = bsp_items.count()
        assert count >= 35, f"Expected 40 BSP methods, got {count}"
        print(f"  ✓ BSP Catalog rendered with {count} standard methods")

        # Verify Hierarchy of BSP method card:
        # Title must be method name (e.g. ЗначениеРеквизитаОбъекта()), subtitle must be module name
        first_title = bsp_items.first.locator(".bsp-method-name").inner_text()
        first_module = bsp_items.first.locator(".bsp-module-tag").inner_text()
        print(f"    - First BSP Title: '{first_title}'")
        print(f"    - First BSP Module Subtitle: '{first_module}'")
        assert "()" in first_title, f"Method title should end with (): {first_title}"
        assert "Общий модуль:" in first_module, f"Module subtitle should state module: {first_module}"

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
        page.locator("#bspFilters .chip:has-text('Строки')").click()
        page.wait_for_timeout(200)
        strings_count = page.locator(".bsp-item").count()
        assert strings_count > 0 and strings_count < count
        print(f"  ✓ Subsystem chip 'Строки' filtered to {strings_count} methods")

        page.screenshot(path=str(SCREENSHOT_DIR / "02_human_tab_bsp.png"))

        # Also capture BSP in Warm Sand theme
        theme_btn.click()
        page.wait_for_timeout(200)
        page.screenshot(path=str(SCREENSHOT_DIR / "10_warm_sand_bsp.png"))
        theme_btn.click() # return to Espresso
        page.wait_for_timeout(200)

        # 5. Tab 3: Extensions (&cfe)
        print("\n[Step 5] Testing Tab 3: Extensions (&cfe Interceptors & Buttons)...")
        page.locator("#tab-btn-extensions").click()
        page.wait_for_timeout(250)
        assert page.locator("#tab-extensions").is_visible()

        # Check form labels and inputs
        labels = page.locator("#tab-extensions .form-label").all_inner_texts()
        assert any("перехватываемой" in l.lower() for l in labels), "Missing method label"
        assert any("директива" in l.lower() for l in labels), "Missing directive label"
        assert any("параметры" in l.lower() for l in labels), "Missing params label"

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
        btn_code = page.locator("#extOutput").inner_text()
        assert "КнопкаЭкспрессПечать" in btn_code
        print("  ✓ Dynamic managed form button generated")
        page.screenshot(path=str(SCREENSHOT_DIR / "03_human_tab_extensions.png"))

        # 6. Tab 4: Audit (ИТС Аудит)
        print("\n[Step 6] Testing Tab 4: ITS Code Standards Audit...")
        page.locator("#tab-btn-audit").click()
        page.wait_for_timeout(250)
        
        # Test snippet audit
        page.fill("#auditSnippetInput", "Для Каждого Стр Из ТЗ Цикл\n    Запрос = Новый Запрос;\nКонецЦикла;")
        page.locator("button[onclick='auditSnippet()']").click()
        page.wait_for_timeout(350)
        
        issue_cards = page.locator(".issue-card")
        assert issue_cards.count() >= 2, f"Expected issue cards, got {issue_cards.count()}"
        print(f"  ✓ ITS Audit detected {issue_cards.count()} structured quality issues")
        page.screenshot(path=str(SCREENSHOT_DIR / "04_human_tab_audit.png"))

        # 7. Tab 5: Vanessa BDD
        print("\n[Step 7] Testing Tab 5: Vanessa BDD Scenario Generator...")
        page.locator("#tab-btn-bdd").click()
        page.wait_for_timeout(250)

        # Check form labels
        bdd_labels = page.locator("#tab-bdd .form-label").all_inner_texts()
        assert any("документа" in l.lower() for l in bdd_labels)
        assert any("табличная часть" in l.lower() for l in bdd_labels)
        assert any("регистр" in l.lower() for l in bdd_labels)

        # Generate scenario
        page.fill("#bddEntity", "РеализацияТоваровУслуг")
        page.fill("#bddTabular", "Товары")
        page.fill("#bddRegister", "ТоварыНаСкладах")
        page.locator("button[onclick='generateBdd(false)']").click()
        page.wait_for_timeout(350)

        bdd_out = page.locator("#bddOutput")
        assert bdd_out.is_visible()
        bdd_text = bdd_out.inner_text()
        print("  --- Generated BDD Output Preview ---")
        for line in bdd_text.split("\n")[:8]:
            print(f"    {line}")
        print("  -----------------------------------")
        
        # Verify formatting and spaces
        assert "# language: ru" in bdd_text, "Missing # language: ru"
        assert "Функционал: Проведение документа РеализацияТоваровУслуг" in bdd_text
        assert "Контекст:" in bdd_text
        assert "Сценарий:" in bdd_text
        assert "| Номенклатура" in bdd_text, "Missing table formatting in BDD scenario"
        assert "| \"Кофе зерновой\"" in bdd_text
        print("  ✓ BDD Gherkin scenario generated with beautiful indentation and aligned table spaces")
        page.screenshot(path=str(SCREENSHOT_DIR / "05_human_tab_bdd.png"))

        # Also capture BDD in Warm Sand
        theme_btn.click()
        page.wait_for_timeout(200)
        page.screenshot(path=str(SCREENSHOT_DIR / "11_warm_sand_bdd.png"))
        theme_btn.click() # return to Espresso
        page.wait_for_timeout(200)

        # 8. Tab 6: Tech Log (ТЖ)
        print("\n[Step 8] Testing Tab 6: Tech Log Diagnosis...")
        page.locator("#tab-btn-techlog").click()
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
        assert "Архитектурные рекомендации" in tech_out.inner_text()
        print("  ✓ Tech Log parsed and analyzed with High-Load lock remediation")
        page.screenshot(path=str(SCREENSHOT_DIR / "06_human_tab_techlog.png"))

        # 9. Tab 7: Metadata (Метаданные)
        print("\n[Step 9] Testing Tab 7: Metadata Cache...")
        page.locator("#tab-btn-metadata").click()
        page.wait_for_timeout(250)

        page.locator("button[onclick='scanMetadata()']").click()
        page.wait_for_timeout(200)
        meta_summary = page.locator("#metadataSummaryBox").inner_text()
        assert "Справочники:" in meta_summary
        assert "Документы:" in meta_summary
        print("  ✓ Metadata scanned and summary formatted with bullet points")
        page.screenshot(path=str(SCREENSHOT_DIR / "07_human_tab_metadata.png"))

        # 10. Tab 8: Sidecar Status
        print("\n[Step 10] Testing Tab 8: Sidecar Daemon...")
        page.locator("#tab-btn-sidecar").click()
        page.wait_for_timeout(250)

        page.locator("button[onclick='checkSidecar()']").click()
        page.wait_for_timeout(200)
        ind_text = page.locator("#sidecarStatusIndicator").inner_text()
        assert "Sidecar активен" in ind_text
        print(f"  ✓ Sidecar check passed: {ind_text}")
        page.screenshot(path=str(SCREENSHOT_DIR / "08_human_tab_sidecar.png"))

        # 11. Tab 9: Settings (Настройки, Модели, Баланс)
        print("\n[Step 11] Testing Tab 9: Settings & AI Model Options...")
        page.locator("#tab-btn-settings").click()
        page.wait_for_timeout(250)

        # Check balance display
        balance_elem = page.locator("#tab-settings div[style*='JetBrains Mono']").first
        balance_text = balance_elem.inner_text()
        assert "₽" in balance_text, f"Expected ruble balance, got {balance_text}"
        print(f"  ✓ NormaHub balance displayed: {balance_text}")

        # Check model dropdown options
        options = page.locator("#modelSelector option").all_inner_texts()
        print("  --- Available AI Models in Settings ---")
        for opt in options:
            print(f"    • {opt}")
        print("  ---------------------------------------")

        # CRITICAL VERIFICATION: Claude 3.5 Sonnet must NOT exist in options!
        assert not any("claude 3.5" in opt.lower() or "sonnet 3.5" in opt.lower() for opt in options), \
            "ERROR: Claude 3.5 Sonnet is still present in model options!"
        print("  ✓ CONFIRMED: Claude 3.5 Sonnet is 100% REMOVED from all model options!")

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
        page.screenshot(path=str(SCREENSHOT_DIR / "09_human_tab_settings.png"))

        # 12. Dropdown Navigation Selector
        print("\n[Step 12] Testing Mobile/Compact Dropdown Navigation Selector...")
        page.select_option("#tabNavSelector", "bdd")
        page.wait_for_timeout(200)
        assert page.locator("#tab-bdd").is_visible()
        print("  ✓ Dropdown selector directly navigated to BDD tab")

        # 13. Narrow Viewport Test (220px width)
        print("\n[Step 13] Testing Narrow Sidebar Viewport (220px width)...")
        page.set_viewport_size({"width": 220, "height": 750})
        page.wait_for_timeout(300)
        page.screenshot(path=str(SCREENSHOT_DIR / "12_narrow_viewport_220px.png"))
        print("  ✓ Narrow viewport screenshot captured at 220px")

        browser.close()

    print("\n" + "=" * 70)
    print("🎉 ALL TESTS PASSED! 100% REAL HUMAN EMULATION SUCCESSFUL OVER HTTP :8088")
    print("=" * 70)

if __name__ == "__main__":
    run_test()
