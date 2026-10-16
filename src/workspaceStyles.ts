/** Shared visual language for the Webview; bundled locally with the extension. */
export const workspaceStyles = `
body.theme-espresso {
    --bg-main: #111719; --bg-card: #192224; --bg-card-subtle: #202D30; --bg-sub: #162023;
    --border-color: #344448; --border-light: #29383C; --border-focus: #72E4CB;
    --btn-primary: #72E4CB; --btn-primary-hover: #99F0DE; --btn-primary-text: #0A2420;
    --btn-sec: #202D30; --btn-sec-hover: #2C3B40; --btn-sec-text: #EDF5F3;
    --text-main: #EDF5F3; --text-secondary: #B8C8C7; --text-muted: #9FB3B3;
    --code-bg: #0E1517; --code-text: #D8EEE7; --accent-badge: #72E4CB;
    --badge-ok-bg: #18382E; --badge-ok-text: #88E7BF;
    --badge-warn-bg: #3C321B; --badge-warn-text: #F6D58E;
    --badge-crit-bg: #3C2528; --badge-crit-text: #FFB1B7;
    --card-shadow: 0 8px 24px rgba(0,0,0,.16); color-scheme: dark;
}
body.theme-warm-sand {
    --bg-main: #F3F6F5; --bg-card: #FFFFFF; --bg-card-subtle: #EAF0EE; --bg-sub: #E1EBE7;
    --border-color: #BDCFCA; --border-light: #D6E1DC; --border-focus: #087568;
    --btn-primary: #087568; --btn-primary-hover: #075D53; --btn-primary-text: #FFFFFF;
    --btn-sec: #F4F8F6; --btn-sec-hover: #E1EBE6; --btn-sec-text: #182D2A;
    --text-main: #182D2A; --text-secondary: #405953; --text-muted: #526D64;
    --code-bg: #EDF3F0; --code-text: #183F33; --accent-badge: #087568;
    --badge-ok-bg: #E1F3E8; --badge-ok-text: #146242;
    --badge-warn-bg: #FFF2D9; --badge-warn-text: #805711;
    --badge-crit-bg: #FBE9EC; --badge-crit-text: #9B3047;
    --card-shadow: 0 5px 18px rgba(22,48,40,.06); color-scheme: light;
}
body { padding: 16px 14px 22px; font-size: 13px; line-height: 1.55; }
button, input[type="text"], input[type="password"], textarea, select { font-size: 12px; border-radius: 8px; box-shadow: none; }
button { min-height: 36px; padding: 8px 11px; transition: background-color .15s, border-color .15s; }
button:hover, .chip:hover, .theme-toggle-btn:hover { transform: none; box-shadow: none; }
button:focus-visible, [role="button"]:focus-visible, a:focus-visible { outline: 2px solid var(--border-focus); outline-offset: 3px; }
button:disabled:hover { transform: none; box-shadow: none; }
input[type="text"], input[type="password"], textarea, select { min-height: 38px; padding: 9px 10px; background: var(--bg-main); }
textarea { min-height: 110px; font-size: 12px; }
input:focus, textarea:focus, select:focus { box-shadow: 0 0 0 2px color-mix(in srgb, var(--border-focus) 20%, transparent); }
button.secondary { background: var(--btn-sec); }
.top-navbar { flex-wrap: nowrap; gap: 8px; min-height: 44px; padding: 0 0 14px; margin-bottom: 14px; border-color: var(--border-light); }
.brand-block { gap: 9px; min-width: 0; flex-shrink: 1; }
.brand-badge { width: 32px; height: 32px; display: grid; place-items: center; padding: 0; border-radius: 9px; background: var(--btn-primary); color: var(--btn-primary-text); box-shadow: none; font-size: 11px; flex-shrink: 0; }
.brand-lockup { min-width: 0; }
.brand-title { font-size: 13px; font-weight: 700; letter-spacing: 0; white-space: normal; }
.brand-subtitle { margin-top: 2px; color: var(--text-muted); font-size: 10px; }
.header-badges { gap: 6px; flex-shrink: 0; }
.header-badges .meta-pill { display: none; }
.theme-toggle-btn { width: 32px; height: 32px; padding: 0; display: grid; place-items: center; border-radius: 8px; box-shadow: none; }
.theme-icon { font-size: 18px !important; }
.theme-label-text { display: none; }
.workspace-hero { position: relative; margin: 20px 0 18px; padding: 0; }
.workspace-hero-topline { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.workspace-eyebrow { color: var(--btn-primary); font-size: 10px; font-weight: 700; letter-spacing: .1em; }
.workspace-live { display: inline-flex; align-items: center; gap: 5px; color: var(--text-muted); font-size: 10px; }
.workspace-live .status-dot { box-shadow: none; }
.workspace-hero h1 { margin: 10px 0 6px; color: var(--text-main); font-size: 24px; line-height: 1.16; font-weight: 700; letter-spacing: -.025em; }
.workspace-hero h1:focus, .catalog-heading h1:focus { outline: none; }
.workspace-hero p { margin: 0; color: var(--text-secondary); font-size: 12px; line-height: 1.6; max-width: 420px; }
.workspace-hero-footer { display: none; }
.quick-start-box { margin: 16px 0; border-radius: 8px; box-shadow: none; }
.quick-start-header { padding: 8px 10px; min-height: 36px; background: transparent; }
.quick-start-title { font-size: 11px; }
.quick-start-body { padding: 12px; gap: 12px; }
.qs-step { font-size: 12px; }
.qs-num { width: 20px; height: 20px; border-radius: 6px; }
.category-segmented { position: sticky; top: 0; z-index: 5; margin: 0; padding: 3px; border-radius: 8px; background: var(--bg-sub); border-color: var(--border-color); }
.seg-btn { flex: 1 1 0; min-width: 0; min-height: 34px; padding: 5px 6px; font-size: 11px; border-radius: 6px; white-space: normal; }
.seg-btn.active { background: var(--bg-card); color: var(--text-main); border-color: var(--border-light); box-shadow: none; }
.seg-label { font-size: inherit; }
.seg-icon { display: none; }
.section-label { display: flex; align-items: center; gap: 8px; margin: 16px 0 10px; color: var(--text-muted); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
.section-label-line { height: 1px; flex: 1; background: var(--border-light); }
.breadcrumb-back { width: auto; min-height: 24px; padding: 3px 7px; border: 0; background: transparent; color: var(--btn-primary); font-size: 10px; }
.catalog-heading { margin: 18px 0 14px; }
.catalog-heading h1 { margin: 8px 0 4px; font-size: 24px; line-height: 1.2; letter-spacing: -.02em; }
.catalog-heading p { margin: 0; color: var(--text-secondary); font-size: 12px; }
#toolSearch { margin-bottom: 16px; background: var(--bg-card); }
.catalog-group { margin: 0 0 18px; }
.catalog-group h2 { margin: 0 0 8px; color: var(--text-muted); font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.catalog-grid { display: grid; grid-template-columns: 1fr; gap: 7px; }
.catalog-card { position: relative; display: grid; grid-template-columns: 30px 1fr auto; align-items: start; gap: 9px; width: 100%; min-height: 72px; padding: 12px; text-align: left; border: 1px solid var(--border-color); border-radius: 9px; background: var(--bg-card); color: var(--text-main); }
.catalog-card:hover { background: var(--bg-card-subtle); border-color: var(--border-focus); }
.catalog-symbol { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 7px; border: 1px solid var(--border-color); color: var(--btn-primary); font-family: monospace; font-size: 10px; }
.catalog-card-copy { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.catalog-card-copy strong { font-size: 12px; line-height: 1.25; }
.catalog-card-copy small { color: var(--text-secondary); font-size: 10px; line-height: 1.4; font-weight: 400; }
.catalog-mode { color: var(--text-muted); font-size: 9px; white-space: nowrap; }
.catalog-empty { padding: 20px 0; color: var(--text-secondary); font-size: 12px; }
.tool-dropdown-wrapper { margin-bottom: 14px; }
.tool-select { min-height: 38px; background: var(--bg-card); font-size: 12px; box-shadow: none; }
#tab-ai-overview.active { display: flex; flex-direction: column; }
.pilot-context-bar { min-height: 52px; margin-bottom: 14px; padding: 10px; gap: 8px; border-radius: 8px; background: var(--bg-sub); }
.pilot-context-file { font-size: 12px; font-weight: 600; }
.pilot-context-sel { font-size: 11px; white-space: normal; }
.pilot-context-bar .action-btn-sm { min-height: 30px; font-size: 10px; width: auto; padding: 4px; }
.pilot-context-dot { color: var(--text-muted); }
.workspace-status-rail { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: -4px 2px 18px; color: var(--text-muted); font-size: 10px; }
.workspace-status-rail > span, .workspace-status-rail > button { display: inline-flex; align-items: center; gap: 6px; width: auto; min-height: 24px; padding: 2px 0; border: 0; background: transparent; color: var(--text-secondary); font-size: 10px; }
.workspace-status-rail > button:hover { background: transparent; color: var(--btn-primary); }
.rail-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-muted); flex: 0 0 auto; }
.rail-dot.online { background: #35B887; }
.rail-dot.warning { background: #F0B64A; }
.workspace-status-rail b { color: var(--text-main); font-weight: 600; }
.pilot-prompt-card { order: 1; margin: 0 0 20px; padding: 0; border: 1px solid var(--border-color); border-radius: 12px; background: var(--bg-card); box-shadow: none; overflow: hidden; }
.pilot-prompt-title { padding: 14px 14px 0; margin: 0; gap: 8px; color: var(--text-main); font-size: 13px; font-weight: 600; }
.pilot-prompt-title > span:first-child { font-size: 9px; color: var(--btn-primary); padding: 3px 5px; border: 1px solid var(--border-color); border-radius: 4px; }
.pilot-prompt-row { display: flex; flex-direction: column; gap: 0; padding: 6px 14px 12px; }
.pilot-prompt-row textarea { width: 100%; min-width: 0; min-height: 126px; height: 126px; padding: 10px 0; border: 0; border-radius: 0; font-family: inherit; font-size: 13px; background: transparent; box-shadow: none; line-height: 1.65; }
.pilot-prompt-row textarea:focus { background: transparent; box-shadow: none; outline: none; }
.pilot-prompt-card:focus-within { border-color: var(--border-focus); box-shadow: 0 0 0 2px color-mix(in srgb, var(--border-focus) 12%, transparent); }
.pilot-send-btn { align-self: flex-end; width: auto; min-height: 34px; padding: 7px 11px; border-radius: 7px; font-size: 12px; gap: 6px; }
.pilot-prompt-footer { padding: 10px 14px; border-top: 1px solid var(--border-light); margin: 0; gap: 6px; font-size: 10px; background: var(--bg-sub); }
.pilot-model-wrapper { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
.pilot-model-select { max-width: 100%; min-height: 29px; padding: 4px 7px; font-size: 11px; border-radius: 6px; }
.pilot-prompt-status { margin: 0; padding: 10px 14px; font-size: 12px; }
.pilot-prompt-status:empty { display: none; }
.killer-actions-grid { order: 3; display: flex; flex-direction: column; gap: 0; border-top: 1px solid var(--border-light); margin-bottom: 18px; }
.killer-actions-grid::before { content: "ИНСТРУМЕНТЫ ДЛЯ КОДА"; padding: 12px 0 4px; color: var(--text-muted); font-size: 10px; font-weight: 700; letter-spacing: .06em; }
.killer-card { position: relative; padding: 12px 0; border: 0; border-bottom: 1px solid var(--border-light); border-radius: 0; box-shadow: none; background: transparent; cursor: default; }
.killer-card:hover { transform: none; border-color: var(--border-light); box-shadow: none; background: transparent; }
.killer-card-header { margin: 0 0 3px; }
.killer-card-title { margin: 0; gap: 8px; font-size: 13px; line-height: 1.4; font-weight: 600; }
.killer-card-title > span:first-child { display: grid; place-items: center; width: 24px; height: 24px; flex-shrink: 0; border: 1px solid var(--border-color); border-radius: 6px; font-family: monospace; font-size: 10px; color: var(--btn-primary); }
.killer-card-badge { display: none; }
.killer-card-desc { margin: 0 0 8px 32px; color: var(--text-secondary); font-size: 11px; line-height: 1.5; }
.killer-card-action { justify-content: flex-start; margin-left: 32px; }
.killer-card-btn { width: auto; min-height: 28px; padding: 4px 8px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-card); color: var(--text-main); font-size: 11px; }
.killer-card-btn:hover { background: var(--bg-card-subtle); color: var(--text-main); }
#cockpitOutputStudio { order: 2; padding: 0; margin-bottom: 20px; border: 1px solid var(--border-color); border-radius: 10px; overflow: hidden; background: var(--bg-card); box-shadow: none; }
.studio-header { margin: 0; padding: 12px; align-items: flex-start; border-bottom: 1px solid var(--border-light); }
.studio-badge { color: var(--badge-ok-text); font-size: 12px; }
.studio-meta { font-size: 10px; }
.studio-target { padding: 8px 12px; margin: 0; font-size: 11px; }
.studio-actions-bar { padding: 4px 12px 12px; gap: 6px; margin: 0; }
.studio-btn-primary, .studio-btn-secondary, .studio-btn-ghost { min-height: 34px; border-radius: 6px; font-size: 11px; }
.studio-btn-primary { background: var(--btn-primary); color: var(--btn-primary-text); }
.studio-btn-primary:hover { background: var(--btn-primary-hover); }
.studio-code-details { margin: 0; border-top: 1px solid var(--border-light); }
.studio-code-details summary { padding: 9px 12px; margin: 0; font-size: 11px; }
.studio-code-pre { border: 0; border-top: 1px solid var(--border-light); border-radius: 0; margin: 0; padding: 12px; max-height: 340px; font-size: 12px; line-height: 1.6; }
.card { padding: 16px; margin-bottom: 14px; border-radius: 10px; box-shadow: none; border-color: var(--border-color); }
.card:hover { border-color: var(--border-color); }
.card-header { margin-bottom: 10px; gap: 8px; }
.card-title { font-size: 15px; line-height: 1.35; letter-spacing: 0; }
.card-desc { margin-bottom: 14px; font-size: 12px; color: var(--text-secondary); line-height: 1.6; }
.form-group { margin-bottom: 12px; }
.form-label { margin-bottom: 6px; font-size: 12px; font-weight: 500; }
.form-hint { font-size: 11px; line-height: 1.5; }
.btn-group { gap: 7px; }
.btn-group button { min-width: 90px; }
.badge { font-size: 10px; border-radius: 5px; padding: 3px 6px; }
.chip { font-size: 11px; padding: 5px 8px; border-radius: 6px; }
.chips-row { gap: 6px; margin-bottom: 12px; }
.code-box { padding: 12px; max-height: 320px; font-size: 12px; border-radius: 8px; line-height: 1.6; }
.bsp-item { padding: 14px; border-radius: 8px; margin-bottom: 10px; box-shadow: none; }
.bsp-method-name { font-size: 13px; }
.bsp-desc { font-size: 12px; }
.bsp-signature, .bsp-example { padding: 8px; font-size: 11px; }
.issue-card { padding: 12px; font-size: 12px; border-radius: 0 8px 8px 0; box-shadow: none; }
.issue-link { min-height: 28px; font-size: 11px; background: transparent; }
.hotkeys-footer { padding: 12px 0; border: 0; border-top: 1px solid var(--border-light); border-radius: 0; background: transparent; }
.hotkey-item { font-size: 10px; }
.toast { border-radius: 8px; padding: 10px 12px; }
.modal-card { border-radius: 12px; }
.modal-header { padding: 14px; }
.modal-brand { min-width: 0; }
.modal-title { font-size: 15px; line-height: 1.4; }
.modal-body { padding: 16px; }
.modal-lead { font-size: 13px; }
.modal-feature-item { border: 0; padding: 10px 0; background: transparent; }
.modal-feature-title { font-size: 13px; }
.modal-feature-desc { font-size: 12px; }
.modal-footer { padding: 12px 14px; }
.modal-btn-primary { font-size: 12px; }
@media (min-width: 580px) {
    body { max-width: 920px; margin: 0 auto; padding: 22px 24px; }
    #tab-ai-overview.active { display: grid; grid-template-columns: minmax(0,1.15fr) minmax(0,.85fr); gap: 18px; align-items: start; }
    #editorContextBanner, .workspace-status-rail { grid-column: 1 / -1; }
    #editorContextBanner { margin-bottom: 0; }
    .workspace-status-rail { grid-row: 2; margin: 0; }
    .pilot-prompt-card { grid-column: 1; grid-row: 3; margin: 0; }
    .killer-actions-grid { grid-column: 2; grid-row: 3 / span 2; margin: 0; }
    #cockpitOutputStudio { grid-column: 1; grid-row: 4; margin: 0; }
    .workspace-hero h1 { font-size: 30px; }
    .catalog-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 280px) {
    body { padding: 10px 8px 16px; }
    .brand-title { font-size: 11px; }
    .brand-subtitle { font-size: 9px; }
    .workspace-hero h1 { font-size: 21px; }
    .seg-btn { font-size: 10px; padding: 5px 2px; }
    .card { padding: 12px; }
    .card-title { font-size: 14px; }
    .pilot-prompt-footer { align-items: flex-start; }
    .pilot-model-wrapper { width: 100%; }
    .pilot-model-select { width: 100%; }
    .pilot-context-bar { flex-wrap: wrap; }
    .pilot-context-bar .action-btn-sm { margin-left: auto; }
}
`;
