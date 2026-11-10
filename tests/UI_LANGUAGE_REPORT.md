# RU/EN interface verification — 2026-10-28

Candidate: **1.0.7**, repository `/home/user/Desktop/normahub/normahub-github/repos/1c-bsl-ai-copilot`, branch `main`, base HEAD `f98713a64c8c44a098497d222925ddd4d24215bb`. The worktree was already dirty; existing changes were preserved and backed up before this work. This is an uncommitted candidate, not a published release.

## Result

The top-right RU/EN selector changes panel labels, tools, settings, placeholders, feedback, BSP descriptions and structured local technical-log reports. The preference is saved in extension global state. The initial language follows the IDE when no preference exists. Runtime status and diagnostics follow the panel preference; contributed command names and configuration descriptions follow the IDE language through VS Code NLS files.

Switching preserves user input, BSL code, metadata identifiers, BSP signatures, generated preview code and clipboard payloads. AI response bodies are preserved; this feature does not promise English AI answers. No AI request is sent merely to switch language. Preference-save failures restore the acknowledged language and show an error.

## Evidence

- `npm test`: pass, including UI-language host checks, existing extension regressions, autocomplete coverage and 24 Sidecar tests.
- `pnpm build`, `pnpm lint`, VSIX packaging and release QA: pass.
- `tests/ui_language_webview_test.py`: pass; RU/EN labels and input placeholders, bilingual search, accessible selector, rollback, draft/preview/copy integrity and **364 layout cases** across two themes and seven widths.
- Actual installed **1.0.7 VSIX** in a separate normal VS Code profile: English startup, RU/EN switching, native status changes, unchanged draft and batch preview all passed. After normal window closure and process restart, Russian remained selected. The saved preference was independently checked in that profile's extension storage.
- Packaged runtime bundles and both NLS files match the workspace and installed extension byte for byte. The installed package manifest matches after excluding VS Code's added `__metadata` installation field; the VSIX manifest matches the workspace byte for byte.
- The prior 1.0.6 artifact retains SHA-256 `9e20b6cdc3d8daed6921750b340247dc6e245cbb4077f5f9dd8cfd149101779d`.

The development-host test alone was insufficient to verify persistence because its extension-test storage was transient. Persistence was therefore verified in the separate normal installed profile. No real user IDE profile was changed.

Evidence directory: `/home/user/1c-copilot-i18n-2026-10-28-zehzn91g/`, including the before snapshot, test logs, IDE screenshots, initial/restart results and `final-verification.json` with installed/package parity.

## Artifact and limits

`1c-bsl-ai-copilot-1.0.7.vsix`

SHA-256: `7191192b675a5a601a925bf284365e4a992c004285b4f156a7948d9a572879f8`

This verification covers localization. It does not resolve the previously documented product-audit findings, prove 1C execution, or repeat live NormaHub latency/quality measurements. Cursor persistence was not separately retested for this change. Nothing was committed or published.
