# Production UI / QA review — 2026-10-14

## Source and verdict

- Repository: `/home/user/Desktop/normahub/normahub-github/repos/1c-bsl-ai-copilot`.
- Branch: `main`, baseline HEAD: `f8b4eda190204c6cec2a115f6dce02bfa444f275`.
- Reviewed state: local, uncommitted changes on top of that baseline.
- Automated checks pass for the scenarios below. This is not a production deployment or approval of the installed VSIX.
- The previous completion report overstated QA coverage: the historical visual test still failed and browser preview responses did not exercise real sidebar handlers. Both gaps are addressed by the new suites.

## Confirmed defects fixed

| Defect | Fix | Verification |
|---|---|---|
| Sidebar batch/extension/form generators inserted immediately when any editor was active | Always return preview; insert only on explicit action | Real provider host test with an active editor |
| First render waited for network and metadata | Render shell first; status handshake refreshes asynchronously | Host test asserts zero network/scan calls before initial render |
| API-key save rebuilt HTML and discarded form state | Update status through messages | Host test checks one render; controlled browser bridge preserves inputs/navigation |
| Untitled BSL document classified by filename alone | Include VS Code language ID | Host test uses `Untitled-1` with BSL language |
| Insertion reported success even when editor rejected the edit | Check `editor.edit` result; show failure | Host test simulates a read-only/rejected edit |
| Repeated submits could create additional paid requests | Provider-level single-flight guard and shared disabled UI state | Deferred completion test and repeated keyboard submit |
| Empty AI response and request errors left unclear or stale results | Explicit empty/error result; clear prior actionable output | Host empty/network-error tests and controlled UI failure tests |
| AI model shown in panel could differ from reasoning model | Initial selection uses reasoning model; selectors synchronized | Host model assertion and controlled UI model selection |
| Audit output used unescaped dynamic HTML | Render issue fields as text nodes | Browser malicious-content test |
| Selected-code audit line numbers were relative to the selection | Apply file line offset | Host checks selection beginning on file line 41 |
| Audit jump could target a different active file | Remember audited document URI/version; reject stale report; pasted snippets have no editor jump | Host switches editor, modifies document version and tests snippet result |
| Old visual QA targeted removed navigation | Compatibility entrypoint invokes current interaction and independent regression suites | `python3 tests/qa_visual_test.py` |
| Toast timer hid subsequent feedback; narrow panels clipped UI | Cancel previous timer, wrap header/footer/notifications | Interaction suite and geometry matrix |
| Main metadata drawer contained fields no longer used by any action | Remove inactive fields; keep real specialized forms | Source review |
| BDD button promised clipboard but generated preview only | Label it as preview | Source and interaction review |

## Verification

```bash
npm run build
node tests/generate_html.js
npm test
python3 tests/qa_visual_test.py
git diff --check
```

- TypeScript compilation and esbuild bundles: pass.
- Existing core suites and 18 Python Sidecar tests: pass.
- `sidebar_host_test.js`: real provider/generators with a mocked VS Code/API boundary; no paid remote requests.
- Browser interaction suite: all current tools and themes; it still uses preview demonstrations for responses.
- `webview_regression.py`: controlled `acquireVsCodeApi` bridge suppresses built-in preview demonstrations; verifies message dispatch, keyboard, pending/error/result transitions, model synchronization, context-dependent insertion, literal rendering of untrusted issue text and BSP empty state.
- Geometry: 12 panels × 7 widths (220, 250, 280, 320, 360, 480, 800 px) × 2 themes = 168 cases. Visible controls/cards checked by bounding rectangles, rather than relying only on hidden horizontal overflow.
- Short modal viewport: 220 × 360 px; primary action remains within viewport.
- Modal keyboard focus, Tab containment and Escape: pass.
- Contrast measured for key palette pairs (not a complete WCAG certification):

| Theme | Main text | Secondary text | Primary button text |
|---|---:|---:|---:|
| Espresso | 15.51:1 | 8.42:1 | 8.47:1 |
| Warm Sand | 13.82:1 | 7.05:1 | 5.47:1 |

## Release evidence still required

- A human visual review of updated screenshots: this agent session cannot inspect image input; DOM measurements do not establish aesthetic quality.
- Smoke test of the newly packaged extension in actual VS Code and Cursor: activation, native Webview lifecycle, keyboard focus, editor switching, SecretStorage, clipboard and read-only editor behavior.
- Live gateway validation/error recovery and live authenticated Sidecar behavior were not exercised by the UI suites; browser demo success must not be interpreted as live connectivity.
- No new VSIX was packaged, installed, published or deployed in this task; existing checked-in VSIX is not evidence of these source changes.
- Automated browser tests cover Chromium in this environment, not all supported IDE versions, platforms, zoom levels or high-contrast themes.
- The large inline Webview template and historical preview-demonstration fallback remain architectural follow-ups; this patch is a targeted QA/UX hardening change.
