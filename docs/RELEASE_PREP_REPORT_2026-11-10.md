# Release preparation report — 2026-11-10

## Scope and provenance

- Target: `/home/user/Desktop/normahub/normahub-github/repos/1c-bsl-ai-copilot`; branch `main`; starting and ending HEAD `f98713a64c8c44a098497d222925ddd4d24215bb`; one worktree. The source was already dirty (124 porcelain entries); after this stage there are 129 entries including the new release-preparation files. User/Muse changes were preserved; no checkout/reset/clean, commit, tag, registry upload or external account mutation occurred.
- Local candidate before and after this stage: `1c-bsl-ai-copilot-1.0.11.vsix`, SHA-256 `a95ea52a1d0ff9fa6dc85f8608df8cdf01de6ab8240977b2c26fe919b3a6ae3a`. This is an **uncommitted local artifact**, not a package built from the current HEAD or a published version. No VSIX was overwritten.
- Changed in this stage: `.github/workflows/release.yml`, `.github/workflows/ci.yml`, `publish.sh`, `MARKETPLACE_GUIDE.md`, new GitHub issue forms under `.github/ISSUE_TEMPLATE/`, new `docs/RELEASE_AND_GROWTH_2026-11-10.md`, new `docs/MEDIA_KIT_2026-11-10.md`, and an additive correction at the top of `docs/PUBLISHING.md`. Packaged extension source/runtime was not edited in this stage.

## Changes

1. Replaced unsafe `find ... | head -n 1` in local publisher with exact `package.name-package.version.vsix`; publisher requires clean tagged source, runs packaged QA and checksum, has a read-only `--check`, and passes registry credentials through the CLI-supported environment variables rather than argv. Older local VSIX remain untouched.
2. Tag push now creates only a **draft prerelease** with the exact VSIX and SHA256SUMS. A separate manual `workflow_dispatch` on the same tag with `promote=true` downloads this draft package, verifies its digest and packaged QA, requires both registry credentials, publishes to Open VSX/Marketplace and then opens the GitHub prerelease. Experimental EPF/TurboConf source files are no longer advertised as independent release assets.
3. The release workflow runs lint as well as tests/build and gives registry credentials only to promotion steps. CI now runs packaged release QA. Copy and channel plan distinguish open beta from Team GA and identify Infostart rules, MCP packaging, Microsoft PAT migration and exact media claims.
4. Public bug/improvement issue forms ask for exact environment and useful outcome while explicitly excluding keys, client code and personal data. A private security/support route still needs an owner-confirmed destination.

## Local verification performed

| Check | Result | Meaning / limit |
| --- | --- | --- |
| `npm test` | pass, exit 0 | Full current local suite; fake/controlled paths do not prove live AI or all 1С |
| `pnpm build` | pass, exit 0 | Bundles from current source |
| `pnpm lint` | pass, exit 0 | TS noEmit + Ruff in local environment |
| `python3 tests/release_qa.py` | pass, exit 0 before and after build | Exact 1.0.11 package parity, 9 MCP tools and negative protocol cases, credential pattern scan; not a general security audit |
| `bash -n publish.sh` | pass | Shell syntax only |
| `./publish.sh --check` | expected stop: tracked source dirty | Correct release guard; tag/artifact upload not attempted |
| Isolated temporary Git repository with bare `origin`, exact tag, current and old dummy VSIX | pass | `publish.sh --check` chose exact version, accepted clean pushed tag and rejected later dirty tracked source; mock QA only, no registry network |
| YAML BaseLoader parse + workflow step inspection | pass | Syntax/structure only; GitHub Actions remote execution not yet observed |
| `git diff --check` | pass | Whitespace on tracked changes |
| Local relative links in new docs | pass | Remote destinations/policies verified separately; link availability can change |
| Current-tree literal token pattern search (excluding binaries/bundles) | no matches | Regex scan is narrower than full secret audit and does not scan Git history |
| `npm audit --omit=dev --audit-level=moderate` | found 0 vulnerabilities | Checks declared production dependencies only; bundled code and all other supply chain risks are separate |
| `npm audit --audit-level=high` | exit 0; one moderate advisory for build-time `esbuild <=0.24.2` | Existing esbuild range is `^0.20.0`; evaluate a pinned upgrade and rebuild in the next reviewed version. The advisory concerns a development server, not a demonstrated packaged runtime exploit |

Historical native evidence: [installed 1.0.11](../tests/PACKAGED_INLINE_RELEASE_REPORT_2026-11-02.md), [own training 1С parameters](../tests/PARAMETERS_NATIVE_ACCEPTANCE_REPORT_2026-11-02.md), [live NormaHub 1017](../tests/LIVE_NORMAHUB_1017_REPORT_2026-10-31.md). None was rerun with a newly published artifact in this stage.

## State and next gates

**verified local:** tests/build/lint/package QA and new guard failure on dirty tree. **not_run:** GitHub Actions candidate/promotion, actual catalog upload/download/install, fresh paid NormaHub live suite, fresh 1С/IDE smoke from final tagged package, independent security/domain review. **unknown:** exact current Marketplace API version; public page still cited an older VSIX during inspection. **not achieved:** reviewed/committed SHA, tag, CI artifact digest, registry versions, post-install runtime and Team GA release gates. **Known dependency work:** one moderate build-tool advisory as noted above; do not run `npm audit fix --force` blindly on the dirty candidate.

Priority: review dirty source → fix/decide release version and claims → clean tagged commit → CI draft and exact installed package test → authorized live NormaHub evaluation and price/privacy/support confirmation → manual promotion → post-publish download/install → beta media. If live evaluation is deferred, only quiet preview positioning is supported. Full B2B/1С scope and media details are in [release and growth plan](RELEASE_AND_GROWTH_2026-11-10.md).
