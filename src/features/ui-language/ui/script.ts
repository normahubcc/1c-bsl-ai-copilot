import { ENGLISH } from '../../../shared/i18n/en';
import { createTranslator, UiLanguage } from '../../../shared/i18n/translator';

/** Declarative labels + explicitly scoped dynamic UI; never walk user code or inputs. */
export function languageScript(initial: UiLanguage): string {
    const catalogue = JSON.stringify(ENGLISH).replace(/</g, '\\u003c');
    return `
        const uiCatalogue = ${catalogue};
        const makeUiTranslator = (${createTranslator.toString()});
        let uiLanguage = '${initial}';
        let t = makeUiTranslator(uiCatalogue, uiLanguage);
        const dynamicUiSources = new WeakMap();
        const dynamicUiSelector = '#toolCatalog, #toolSelector, #bspListContainer, #toast, #metadataHeaderLabel, #gatewayStatusBadge, #gatewayBalanceDisplay, #gatewayRailStatus, #cockpitPromptStatus, #cockpitBadge, #cockpitMeta, #cockpitTarget, #bspCountBadge, #sectionLabel, #themeLabel, #refactorStatus, #bddStatus, #techlogStatus, #sidecarStatusIndicator, #pilotContextSel, #pilotContextFile, button[onclick^="insertCodeFrom"]';

        function translateDynamicUi(root) {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            let node;
            while ((node = walker.nextNode())) {
                if (!node.parentElement || node.parentElement.closest('code, pre, textarea, [data-i18n-preserve]')) continue;
                const current = node.nodeValue;
                const saved = dynamicUiSources.get(node);
                const source = saved && saved.last === current ? saved.source : current;
                const translated = t(source);
                dynamicUiSources.set(node, {source, last:translated});
                if (translated !== current) node.nodeValue = translated;
            }
        }

        function applyUiLanguage(language) {
            if (language !== 'ru' && language !== 'en') return;
            uiLanguage = language;
            t = makeUiTranslator(uiCatalogue, uiLanguage);
            document.documentElement.lang = language;
            document.title = t('NormaHub · Помощник 1С');
            const selector = document.getElementById('uiLanguageSelector');
            if (selector) selector.value = language;
            document.querySelectorAll('[data-i18n]').forEach(element => {
                const value = t(element.dataset.i18n);
                if (element.textContent !== value) element.textContent = value;
            });
            for (const attribute of ['placeholder','title','aria-label']) {
                document.querySelectorAll('[data-i18n-' + attribute + ']').forEach(element => {
                    element.setAttribute(attribute, t(element.getAttribute('data-i18n-' + attribute)));
                });
            }
            for (const [id,label] of [['cockpitModelSelect','Модель генерации запроса'],['modelSelector','Рабочая модель AI'],['apiKeyInput','API-ключ NormaHub']]) {
                document.getElementById(id)?.setAttribute('aria-label',t(label));
            }
            applyTheme(document.body.classList.contains('theme-warm-sand') ? 'warm-sand' : 'espresso');
            document.querySelectorAll(dynamicUiSelector).forEach(translateDynamicUi);
            if (typeof renderToolCatalog === 'function') renderToolCatalog();
            if (typeof renderBspList === 'function') renderBspList();
            document.querySelectorAll(dynamicUiSelector).forEach(translateDynamicUi);
            if (vscode.setState) vscode.setState({...(vscode.getState ? vscode.getState() : {}), uiLanguage});
        }

        function changeUiLanguage(language) {
            if (language !== 'ru' && language !== 'en') return;
            applyUiLanguage(language);
            vscode.postMessage({type:'setUiLanguage',language});
        }

        function initUiLanguage() {
            applyUiLanguage(uiLanguage);
            const observer = new MutationObserver(records => {
                const roots = new Set();
                for (const record of records) {
                    const element = record.target.nodeType === Node.TEXT_NODE ? record.target.parentElement : record.target;
                    const root = element?.closest ? element.closest(dynamicUiSelector) : null;
                    if (root) roots.add(root);
                }
                roots.forEach(translateDynamicUi);
            });
            document.querySelectorAll(dynamicUiSelector).forEach(root => observer.observe(root,{subtree:true,childList:true,characterData:true}));
            window.addEventListener('message', event => {
                if (event.data.type !== 'uiLanguageChanged') return;
                applyUiLanguage(event.data.language);
                if (event.data.error) showToast(t(event.data.error));
            });
        }
    `;
}
