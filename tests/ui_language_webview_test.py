"""RU/EN UI, state preservation and code integrity against the actual rendered Webview."""
import json
import os
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

HTML = Path(os.getenv('WEBVIEW_TEST_HTML', str(Path(tempfile.gettempdir()) / '1c-copilot-webview-test.html')))
OUT = Path(os.getenv('UI_LANGUAGE_EVIDENCE', '/tmp/1c-copilot-language'))
OUT.mkdir(parents=True, exist_ok=True)


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--no-sandbox','--disable-dev-shm-usage'])
        context = browser.new_context(viewport={'width':320,'height':850})
        context.add_init_script("""
          window.__messages=[];window.__state={draftMarker:'preserve-me'};
          window.acquireVsCodeApi=()=>({postMessage:m=>__messages.push(m),getState:()=>__state,setState:s=>{window.__state=s;}});
        """)
        page=context.new_page();errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(HTML.as_uri())
        page.evaluate('closeWelcomeModal()')
        page.select_option('#uiLanguageSelector','en')
        expect(page.locator('html')).to_have_attribute('lang','en')
        expect(page.locator('#workspaceTitle')).to_have_text('From task to code.')
        assert page.evaluate('__state.draftMarker')=='preserve-me'
        assert page.evaluate('__messages.filter(m=>m.type==="setUiLanguage").at(-1).language')=='en'
        expect(page.locator('#uiLanguageSelector')).to_have_accessible_name('Panel language')
        expect(page.locator('#apiKeyInput')).to_have_attribute('placeholder','Paste your nr_hub_… key')
        expect(page.locator('#batchDimensions')).to_have_attribute('placeholder','Example: Номенклатура, Склад')
        page.fill('#cockpitPromptInput','Keep my draft: Документ.Заказ')
        code='Сообщить("Сохранить ключ");\n// Пользовательский код: Подключение'
        page.evaluate("m=>window.dispatchEvent(new MessageEvent('message',{data:m}))",{'type':'queryResult','code':code,'previewId':'translation-test','targetName':'Module.bsl','comparisonAvailable':True,'reviewAvailable':True,'sourceCurrent':True})
        expect(page.locator('#queryValidation')).to_have_text('Validate result')
        expect(page.locator('#reviewPreview')).to_have_text('Review changes')
        page.screenshot(path=str(OUT/'en-home.png'),full_page=True)
        for language in ['ru','en','ru','en']:
            page.select_option('#uiLanguageSelector',language)
            expect(page.locator('#cockpitPromptInput')).to_have_value('Keep my draft: Документ.Заказ')
            assert page.locator('#cockpitCodePre').inner_text()==code
            assert page.locator('#cockpitOutputStudio').is_visible()
            assert page.evaluate('currentCockpitCode')==code
        page.locator('button[onclick="copyCockpitCode()"]').click()
        assert page.evaluate('__messages.filter(m=>m.type==="copyToClipboard").at(-1).text')==code

        warning = 'The source context changed. You can open or copy the draft; generate it again before applying.'
        page.evaluate("m=>window.dispatchEvent(new MessageEvent('message',{data:m}))", {
            'type':'queryResult','code':code,'previewId':'stale-en','targetName':'Module.bsl',
            'sourceCurrent':False,'comparisonAvailable':True,'message':warning})
        expect(page.locator('button[onclick="insertCockpitCode()"]')).to_be_disabled()
        expect(page.locator('#cockpitTarget')).to_have_text(warning)
        expect(page.locator('#cockpitPromptStatus')).to_have_text(warning)
        page.locator('button[onclick="copyCockpitCode()"]').click()
        assert page.evaluate('__messages.filter(m=>m.type==="copyToClipboard").at(-1).text')==code

        page.evaluate("selectSubTool('tools')")
        page.fill('#toolSearch','shortage')
        expect(page.locator('.catalog-card')).to_have_count(1)
        expect(page.locator('.catalog-card strong')).to_have_text('Stock shortage query')
        page.fill('#toolSearch','')
        expect(page.locator('.catalog-card')).to_have_count(9)
        page.screenshot(path=str(OUT/'en-catalogue.png'),full_page=True)
        page.evaluate("selectSubTool('bsp')")
        page.fill('#bspSearchInput','attribute')
        assert page.locator('.bsp-item').count()>0
        assert 'attribute' in page.locator('.bsp-desc').first.inner_text().lower()
        assert page.locator('.bsp-method-name').first.inner_text().endswith('()')
        page.fill('#bspSearchInput','')
        page.select_option('#uiLanguageSelector','ru')
        assert page.locator('.bsp-desc').first.inner_text().startswith('Получает')
        page.select_option('#uiLanguageSelector','en')

        leftovers={}
        for tool in ['ai-overview','tools','queries-refactor','queries-batch','bsp','extensions','audit','bdd','techlog','metadata','sidecar','settings']:
            page.evaluate('tool=>selectSubTool(tool)',tool)
            leftovers[tool]=page.evaluate("""() => {
                const root=document.querySelector('.tab-panel.active');const nodes=[];
                const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;
                while(n=walker.nextNode()) {
                  if(n.parentElement.closest('code,pre,textarea,.code-box,.bsp-method-name,.bsp-module-tag b,[data-i18n-preserve]'))continue;
                  const presentation=n.nodeValue.replace(/&(?:Вместо|Перед|После)|ПриСозданииНаСервере/g,'');
                  if(n.parentElement.getClientRects().length && /[А-Яа-яЁё]/.test(presentation))nodes.push(n.nodeValue.trim());
                }
                return [...new Set(nodes.filter(Boolean))];
            }""")
            assert page.locator('#uiLanguageSelector').is_visible()
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),tool
        (OUT/'remaining-cyrillic.json').write_text(json.dumps(leftovers,ensure_ascii=False,indent=2))
        assert not any(leftovers.values()),leftovers
        page.screenshot(path=str(OUT/'en-settings.png'),full_page=True)
        layout_cases=0
        for language in ['ru','en']:
            page.select_option('#uiLanguageSelector',language)
            for theme in ['espresso','warm-sand']:
                page.evaluate('theme=>applyTheme(theme)',theme)
                for width in [220,250,280,320,360,480,800]:
                    page.set_viewport_size({'width':width,'height':650})
                    for tool in ['ai-overview','tools','queries-gen','queries-refactor','queries-batch','bsp','extensions','audit','bdd','techlog','metadata','sidecar','settings']:
                        page.evaluate('tool=>selectSubTool(tool)',tool)
                        page.wait_for_timeout(35)
                        clipped=page.evaluate("""() => [...document.querySelectorAll('button,input,select,textarea,.card,.top-navbar')]
                            .filter(e=>e.getClientRects().length && !e.closest('[style*="display:none"],[style*="display: none"]'))
                            .map(e=>({id:e.id||e.className,rect:e.getBoundingClientRect()}))
                            .filter(e=>e.rect.right>innerWidth+1 || e.rect.left < -1)
                            .map(e=>({id:e.id,left:e.rect.left,right:e.rect.right}))""")
                        assert not clipped,(language,theme,width,tool,clipped)
                        layout_cases+=1
        page.evaluate("m=>window.dispatchEvent(new MessageEvent('message',{data:m}))",{'type':'uiLanguageChanged','language':'ru','error':'Не удалось сохранить язык интерфейса.'})
        expect(page.locator('html')).to_have_attribute('lang','ru')
        expect(page.locator('#workspaceTitle')).to_have_text('От задачи к коду.')
        assert not errors,errors
        print(f'RU/EN Webview: top-right selector, bilingual search, draft/preview/copy integrity, all panels, accessible labels, rollback and {layout_cases} layout cases passed.')
        browser.close()


if __name__=='__main__':
    run()
