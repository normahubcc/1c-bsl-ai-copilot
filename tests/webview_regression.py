"""Verify production Webview UI using a controlled host bridge, without preview demos."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

HTML = Path(__file__).with_name("webview_test.html")
TOOLS = ["ai-overview", "tools", "queries-gen", "queries-refactor", "queries-batch", "bsp",
         "extensions", "audit", "bdd", "techlog", "metadata", "sidecar", "settings"]


def run_regression():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True,
                                    args=["--no-sandbox", "--disable-dev-shm-usage"])
        page = browser.new_page(viewport={"width": 360, "height": 750})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.add_init_script("""
            localStorage.clear();
            window.__messages = [];
            window.__state = {};
            window.acquireVsCodeApi = () => ({
                postMessage: message => window.__messages.push(message),
                getState: () => window.__state,
                setState: state => window.__state = state
            });
        """)
        page.goto(HTML.as_uri())
        page.evaluate("openWelcomeModal()")
        expect(page.locator("#welcomeModal")).to_be_visible()
        expect(page.locator(".modal-btn-primary")).to_be_focused()
        page.keyboard.press("Tab")
        assert page.evaluate("document.getElementById('welcomeModal').contains(document.activeElement)")
        page.keyboard.press("Escape")
        expect(page.locator("#welcomeModal")).to_be_hidden()
        expect(page.locator(".workspace-hero h1")).to_be_focused()
        assert page.evaluate("__messages.some(m => m.type === 'webviewReady')")
        assert page.locator("#tab-ai-overview").evaluate("el => [...el.children].map(x => x.className || x.id).indexOf('pilot-prompt-card') < [...el.children].map(x => x.className || x.id).indexOf('killer-actions-grid')"), "Prompt should precede secondary actions in reading order"

        def send(message):
            page.evaluate("m => window.dispatchEvent(new MessageEvent('message', {data: m}))", message)

        def messages(kind):
            return page.evaluate("kind => __messages.filter(m => m.type === kind)", kind)

        send({"type": "sidebarStatus", "gatewayStatusLabel": "Сеть недоступна", "gatewayStatusBadge": "badge-warn",
              "gatewayActive": False, "balanceDisplay": "Проверьте подключение", "metadataAvailable": False,
              "metadataLabel": "Метаданные: примеры", "maskedKey": "nr_hub_t...1234"})
        expect(page.locator("#metadataHeaderLabel")).to_have_text("Метаданные: примеры")
        send({"type": "editorContext", "fileName": "Untitled-1", "isBsl": True,
              "hasSelection": True, "lineCount": 2, "selectedText": "ВЫБРАТЬ Ссылка ИЗ Документ.ЗаказКлиента"})
        page.locator(".killer-card button").first.focus()
        page.keyboard.press("Enter")
        expect(page.locator("#refactorInput")).to_have_value("ВЫБРАТЬ Ссылка ИЗ Документ.ЗаказКлиента")
        assert not messages("refactorQuery"), "Navigation must not silently execute a demo query"
        page.locator("#refactorInput").press("Control+Enter")
        assert len(messages("refactorQuery")) == 1
        send({"type": "refactorResult", "code": "Результат оптимизации", "optimizations": []})
        expect(page.locator("#refactorOutput")).to_be_visible()
        page.locator("#refactorInput").fill("ВЫБРАТЬ ДругаяСсылка")
        page.locator("#refactorInput").press("Control+Enter")
        expect(page.locator("#refactorOutput")).to_be_hidden()
        assert not page.locator("#cockpitOutputStudio").is_visible(), "New request must not leave prior output actionable"

        page.evaluate("selectSubTool('ai-overview')")
        page.fill("#cockpitPromptInput", "Остатки товаров на дату")
        page.locator("#cockpitPromptInput").press("Control+Enter")
        expect(page.locator("#btnSendCockpitPrompt")).to_be_disabled()
        page.locator("#cockpitPromptInput").press("Control+Enter")
        assert len(messages("generateQuery")) == 1, "Duplicate keyboard submit must not create paid requests"
        send({"type": "queryResult", "code": "Запрос = Новый Запрос;"})
        expect(page.locator("#btnSendCockpitPrompt")).to_be_enabled()
        expect(page.locator("#cockpitOutputStudio")).to_be_visible()
        send({"type": "editorContext", "fileName": "settings.json", "isBsl": False, "hasSelection": False})
        expect(page.locator("button[onclick='insertCockpitCode()']")).to_be_disabled()
        assert "Откройте BSL" in page.locator("#cockpitTarget").inner_text()
        page.locator("button[onclick='copyCockpitCode()']").click()
        assert messages("copyToClipboard")[-1]["text"] == "Запрос = Новый Запрос;"

        page.locator("#cockpitPromptInput").press("Control+Enter")
        send({"type": "queryResult", "error": "HTTP 401: ключ недействителен"})
        expect(page.locator("#cockpitPromptStatus")).to_have_text("HTTP 401: ключ недействителен")
        expect(page.locator("#cockpitOutputStudio")).to_be_hidden()
        expect(page.locator("#queryActions")).to_be_hidden()
        expect(page.locator("#btnSendCockpitPrompt")).to_be_enabled()

        page.evaluate("selectSubTool('settings')")
        page.select_option("#modelSelector", "deepseek-v4.1-flash")
        assert page.locator("#cockpitModelSelect").input_value() == "deepseek-v4.1-flash"
        page.fill("#apiKeyInput", "nr_hub_test")
        page.locator("button[onclick='saveKey()']").click()
        assert messages("saveKey")[-1]["value"] == "nr_hub_test"
        send({"type": "sidebarStatus", "gatewayStatusLabel": "Подключен", "gatewayStatusBadge": "badge-ok",
              "gatewayActive": True, "balanceDisplay": "Pay-As-You-Go", "maskedKey": "nr_hub_t...test"})
        expect(page.locator("#apiKeyInput")).to_have_value("nr_hub_test")
        assert page.locator("#toolSelector").input_value() == "settings"

        page.evaluate("selectSubTool('audit')")
        malicious = '<img src=x onerror="window.__injected=true">'
        send({"type": "auditResult", "issues": [{"severity": "warning", "rule": "ITS-TEST",
              "line": 12, "message": malicious, "suggestion": malicious}]})
        assert page.locator("#auditOutputContainer img").count() == 0
        assert malicious in page.locator("#auditOutputContainer").inner_text()
        page.locator(".issue-link").focus()
        page.keyboard.press("Enter")
        assert messages("jumpToLine")[-1]["line"] == 12

        page.evaluate("selectSubTool('bsp')")
        page.fill("#bspSearchInput", "нет_такого_метода_9876")
        expect(page.locator(".bsp-empty")).to_be_visible()
        page.fill("#bspSearchInput", "")
        expect(page.locator(".bsp-item button").first).to_be_disabled()
        send({"type": "editorContext", "fileName": "БольшоеИмяМодуляКонфигурации.bsl", "isBsl": True,
              "hasSelection": False, "lineCount": 0})
        expect(page.locator(".bsp-item button").first).to_be_enabled()

        page.evaluate("selectSubTool('tools')")
        expect(page.locator("#tab-tools")).to_be_visible()
        expect(page.locator(".catalog-card")).to_have_count(10)
        page.fill("#toolSearch", "Технологический журнал")
        expect(page.locator(".catalog-card")).to_have_count(1)
        expect(page.locator(".catalog-card").first).to_contain_text("Технологический журнал")
        page.locator(".catalog-card").click()
        expect(page.locator("#tab-techlog")).to_be_visible()
        page.locator("#toolBreadcrumb button").click()
        expect(page.locator("#tab-tools")).to_be_visible()
        expect(page.locator(".catalog-card")).to_have_count(1)
        page.fill("#toolSearch", "нет_такого_инструмента")
        expect(page.locator(".catalog-empty")).to_be_visible()
        page.fill("#toolSearch", "")
        expect(page.locator(".catalog-card")).to_have_count(10)

        # Measure real element geometry, not merely scrollWidth hidden by overflow-x.
        checks = 0
        for theme in ("espresso", "warm-sand"):
            page.evaluate("theme => applyTheme(theme)", theme)
            for width in (220, 250, 280, 320, 360, 480, 800):
                page.set_viewport_size({"width": width, "height": 650})
                for tool in TOOLS:
                    page.evaluate("tool => selectSubTool(tool)", tool)
                    page.wait_for_timeout(180)
                    violations = page.evaluate("""() => {
                        const width = document.documentElement.clientWidth;
                        return [...document.querySelectorAll('button,input,select,textarea,.card,.top-navbar,.killer-card')]
                            .filter(e => e.getClientRects().length && !e.closest('[style*="display:none"],[style*="display: none"]'))
                            .map(e => ({id: e.id || e.className || e.tagName, rect:e.getBoundingClientRect()}))
                            .filter(e => e.rect.right > width + 1 || e.rect.left < -1)
                            .map(e => ({id:e.id, right:e.rect.right, left:e.rect.left}));
                    }""")
                    assert not violations, f"{theme}/{width}px/{tool} clipped controls: {violations}"
                    checks += 1
                page.evaluate("showToast('Длинное уведомление о результате проверки и вставки в открытый модуль 1С')")
                toast = page.locator("#toast").bounding_box()
                assert toast["x"] >= 0 and toast["x"] + toast["width"] <= width + 1

        page.set_viewport_size({"width": 220, "height": 360})
        page.evaluate("openWelcomeModal()")
        footer = page.locator(".modal-btn-primary").bounding_box()
        assert footer["y"] >= 0 and footer["y"] + footer["height"] <= 360
        page.keyboard.press("Escape")
        assert not errors, f"Webview runtime errors: {errors}"
        contrast_by_theme = {}
        for theme in ("espresso", "warm-sand"):
            page.evaluate("theme => applyTheme(theme)", theme)
            contrast = page.evaluate("""() => {
            const probe = document.createElement('span');
            document.body.appendChild(probe);
            const rgb = value => {
                probe.style.color = value.trim();
                const parts = getComputedStyle(probe).color.match(/[\\d.]+/g).map(Number);
                if (parts.length < 3) return [0,0,0];
                const alpha = parts.length === 4 ? parts[3] : 1;
                return parts.slice(0,3).map(channel => channel * alpha + 255 * (1 - alpha));
            };
            const luminance = color => color.map(channel => {
                channel /= 255;
                return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
            }).reduce((sum, channel, i) => sum + channel * [.2126,.7152,.0722][i], 0);
            const ratio = (a,b) => {
                const x = luminance(rgb(a)), y = luminance(rgb(b));
                return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
            };
            const css = getComputedStyle(document.body);
            const resultButton = getComputedStyle(document.querySelector('.studio-btn-primary'));
            const resultBadge = getComputedStyle(document.querySelector('.studio-badge'));
            const resultPanel = getComputedStyle(document.querySelector('.output-studio'));
            const result = {
                text: ratio(css.getPropertyValue('--text-main'), css.getPropertyValue('--bg-main')),
                secondary: ratio(css.getPropertyValue('--text-secondary'), css.getPropertyValue('--bg-main')),
                button: ratio(css.getPropertyValue('--btn-primary-text'), css.getPropertyValue('--btn-primary')),
                result_button: ratio(resultButton.color, resultButton.backgroundColor),
                result_status: ratio(resultBadge.color, resultPanel.backgroundColor)
            };
            probe.remove();
            return result;
            }""")
            contrast_by_theme[theme] = contrast
            assert contrast["text"] >= 7, f"Primary text contrast below WCAG AAA in {theme}: {contrast}"
            assert contrast["secondary"] >= 4.5, f"Secondary text contrast below WCAG AA in {theme}: {contrast}"
            assert contrast["button"] >= 4.5, f"Primary button contrast below WCAG AA in {theme}: {contrast}"
            assert contrast["result_button"] >= 4.5, f"Result button contrast below WCAG AA in {theme}: {contrast}"
            assert contrast["result_status"] >= 4.5, f"Result status contrast below WCAG AA in {theme}: {contrast}"
        browser.close()
        print(f"Production Webview: controlled bridge/error/keyboard/model/context/injection tests, {checks} layout cases, and theme contrast passed: {contrast_by_theme}")


if __name__ == "__main__":
    run_regression()
