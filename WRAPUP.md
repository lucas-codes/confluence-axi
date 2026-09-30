# Release wrap-up

## Result

Official TOON encoding and local validation are ready. The owner has decided to publish the existing history as-is, without rewriting or squashing, accepting the historical personal checkout paths and internal documentation-wrapper identifier described below. The current README and skill remove them. The owner confirmed MIT licensing and later public publication; root `LICENSE` contains the standard MIT text with `Copyright (c) 2026 Lucas Lim`, README links to it, and `package.json` retains `"license": "MIT"` and `"private": true`. No remote or publication is part of this change.

## Design and engineering plan

Use `@toon-format/toon` exactly `4.1.1` with default options (two-space indentation, comma delimiter, no key folding). Keep normalization, credential refusal, and post-encoding byte limits intact. Strict decoding must match normalized JSON for all seven data commands, the no-argument home, empty collections, truncation and errors; diagnostic help/version intentionally stay text.

Add bounded read-only `help[]` command templates and explicit collection empty messages. Keep the single-request status home; executable-path/description enrichment, narrower default schemas, unavailable totals, and ambient hooks are follow-ups, not new features. Preserve bounded `--full` semantics rather than promise unlimited text.

Sequence followed: failing production-path tests → official encoder and small response fixes → deliberate fixtures → mocked regression/typecheck/build/audit → history and upstream finding review. No live Confluence requests, remotes, pushes, or credential-bearing installs.

Documentation-service resolution and docs requests both returned HTTP 429 monthly quota exceeded. Installed official package README/types, https://axi.md/ and https://github.com/toon-format/spec/blob/main/SPEC.md were read instead.

## Tests and conformance

Before implementation, the production `main` round-trip test failed: empty display name decoded as `'-'`, whereas normalized JSON was `''`. The response test failed because home `help` was absent. A subsequent regression test caught an invalid `status --full` suggestion; the fix suppresses it because that command does not accept the flag.

`src/__tests__/cli.test.ts:41–87` now exercises strict `decode(..., {strict:true})` against the JSON output from the same mocked data for status, search, spaces, page, children, attachments, labels, no-argument home, every empty collection, truncated body/title, and usage errors. Existing tests retain pre-fetch argument rejection, exact-origin auth, no redirects, one GET, pagination safety, credential/control sanitization, hard output/body/ADF limits, and safe errors.

`src/__tests__/fixtures/responses.json` deliberately locks 11 outputs, including all seven data commands, home, emptiness, uniform nested truncation metadata, heterogeneous rows, continuation, and a usage error. There were no pre-existing exact-output fixture files; these are new golden fixtures rather than an unnoticed snapshot regeneration.

Spec §13 review: the official 4.1.1 implementation targets TOON spec 4.1; default encoding supplies UTF-8/LF text, two-space indentation, normative key/string quoting and escapes, shape-selected forms, exact array lengths, key/row order, and literal numbers/booleans/null. Our input is normalized JSON-compatible data, not exotic host objects. `encode` adds no newline; the CLI retains its existing one-newline stdout framing. Appendix C describes the reference suite as informative, not the definition of conformance. The application tests prove its output contract; they are not a claim that this repo ran every upstream encoder/decoder fixture or independently certified the library.

### Visible output changes

1. Nulls are `null`, no longer `-`; empty strings are `""`, no longer `-`.
2. Empty arrays are `key: []`, no longer `key[0]{}:`.
3. Bodies are quoted strings with escaped `\n`, `\t`, quotes and backslashes, no longer literal indented blocks. Empty bodies are `body: ""`.
4. Uniform nested objects can fold into table field groups, e.g. `truncatedFields{title}`; heterogeneous rows still use object lists with normative indentation.
5. String quoting follows the official grammar rather than the old heuristic. Numeric-looking IDs stay strings; nonnumeric version `0.1.0` is now unquoted. Strings starting with hyphens are quoted only when required by the grammar.
6. Data responses append primitive-string `help[N]: ...` arrays (inline TOON with the default delimiter); JSON contains the same arrays. Usage `help` changes from scalar to array; ordinary runtime errors now have an array too. Emergency security and loader fallback shapes remain unchanged.
7. Zero-row collections add `message: 0 results on this source page`. `hasMore` still distinguishes a truly exhausted collection from a filtered source page with continuation.

These are intentional compact-format changes, not a promise of compatibility with consumers of the former custom syntax. JSON data fields retain their previous types and bounds; `help` and `message` are the response-shape changes above.

## AXI response check

| Principle | Result / evidence |
|---|---|
| Definitive empty states | `count: 0`, empty array, `hasMore`, plus explicit source-page message (`src/help.ts:15`, `src/model.ts:66–68`). Does not misleadingly claim the entire source is empty when filtered children have continuation. |
| Structured errors / exit codes | stdout error/code/help; 0 success, 2 usage, 1 other failures; single final write (`src/index.ts:18–29`). Safe minimal fallbacks intentionally override richer output if a credential matches fixed syntax. |
| Content-first no arguments | Existing default status makes one live GET, never help (`src/args.ts:24`, `src/model.ts:33–44`). Now suggests spaces/search (`src/help.ts:12`). |
| Truncation / full hint | Existing original lengths, body flag, and bounds untouched (`src/render.ts:6–24`); bounded `--full` hint added for supported commands (`src/help.ts:5–14`). No invalid status hint or promise of unbounded completion. |
| Contextual help[] | Read-only concrete templates, placeholder IDs/CQL/cursor rather than untrusted remote text (`src/help.ts:11–14`). Errors provide generic CLI help (`src/index.ts:21`). |

Follow-ups, deliberately not built: richer home with executable path and description; 3–4-field collection defaults / explicit field selection; global totals where API/source filtering prevents knowing them from one request; more code-specific runtime-error next steps; retention of limit/full settings in continuation templates; ambient hook integrations (not appropriate to silently add under the current no-hooks security contract). Full text beyond existing caps remains out of scope.

## Upstream security audit: applicability to our implementation

Reviewed every ranked finding and the accompanying inventory/dependency/publication notes of the supplied third-party audit. Upstream's commit and tarball provenance do not attest to this independent local implementation.

| Finding | Applies here? Evidence |
|---|---|
| 1. Arbitrary site / auth validation gap | No. Fixed origin, HTTPS/443, no userinfo/fragments, exact allowlisted paths validated before auth fetch (`src/api.ts:2–9,20–27`); no host flags (`src/args.ts:4–16`). Status shares that transport (`src/model.ts:33,37`). |
| 1. Redirect / pagination boundary | No. Explicit manual redirect and all 3xx refused (`src/api.ts:26–27`). Next URLs must pass the same validator and retain collection path; bounded opaque cursor, no auto-fetch (`src/api.ts:43–69`, `src/security.ts:26–28`). |
| 2. Writes / OAuth scopes / confirmation | No mutation surface. Read command allowlist (`src/args.ts:2–8`), one GET-only transport (`src/api.ts:26`), projection-only model (`src/model.ts:31–68`). No OAuth implementation or token scope request. Server-side read-only permission is still recommended; a broad principal is not made read-only by token format. |
| 3. Mutable registry install / updater / install scripts with credentials | Removed personal installation paths; guidance uses built local symlink, never registry CLI or auto-update (`README.md:13–37`, `skills/confluence-axi/SKILL.md:8–19,39`). Exact runtime version/integrity locked (`package.json:33–35`, `package-lock.json:25–30`); install used `npm ci --ignore-scripts` without injected auth. Manifest build/prepublish scripts are explicit developer actions, not consumer installation hooks (`package.json:23–27`). No workflow directory or update/setup command is tracked. |
| 4. Persisted credentials / child argv / remote secret echo | No persistence/login/keychain/OAuth/child-process runtime (`src/security.ts:30–35`, complete `src/index.ts` and launcher). Reads env each invocation. Raw errors discarded (`src/api.ts:28,36,40`, `src/index.ts:19`); redaction and final credential refusal (`src/security.ts:6–24`, `src/render.ts:12–16,26–35`). Test-only subprocess calls are not CLI runtime. |
| 5. Inconsistent control stripping / prompt injection / write suggestions | Control stripping and redaction cover all normalized strings (`src/security.ts:16–24`, `src/render.ts:6–24`); cursor must be unchanged by cleaning. No eval/shell/browser/content-driven import; ADF links/cards only same-origin navigation (`src/adf.ts:28–30,53–55`, `src/api.ts:11–17`). Content remains untrusted prose; skill states this explicitly (`skills/confluence-axi/SKILL.md:41`). New suggestions are fixed read-only templates, not remote-derived instructions (`src/help.ts:11–14`). Prompt injection risk inherent in reading documents remains. |
| Inventory: Jira fallback, OAuth hosts, browser callback, hooks, cache/export/body-file | None exists. Seven allowlisted Confluence paths only (`src/api.ts:3`); model endpoint selection (`src/model.ts:33`); parser rejects unsupported flags/commands (`src/args.ts:15,25`). No runtime filesystem writes or subprocesses in tracked runtime source; launcher only imports the adjacent build and writes bounded fallback output (`bin/confluence-axi:1–15`). |
| Dependency advisory: old TOON decoder prototype pollution | Not the audited old version: official encoder 4.1.1 is bundled (`src/render.ts:1,27`, manifest/lock). Decoder is only imported by tests (`src/__tests__/cli.test.ts:2,58,86`); build has no decoder. Current runtime+dev npm audit reports zero advisories. |
| Other eleven upstream advisories / dev lifecycle scripts | Upstream brace-expansion, nanoid, PostCSS, Vitest/mocker and esbuild are not in this npm lock. Our installed graph is TOON 4.1.1, TypeScript 5.9.3, Node types 24.19.0, undici-types 7.24.6 (`package-lock.json`). No installed package has preinstall/install/postinstall/prepare scripts. Bun is a separately supplied build tool, not covered by npm audit. No finding required a further upgrade. |
| Upstream publication/provenance/license observations | Not applicable as evidence for this owned local repo. No remote created or publication attempted. The owner has resolved the license and history publication decisions below. |

## Release checks and history

README now describes exact encoder version, Node build/test versus runtime requirements, Bun-only build requirement, local symlink install, rebuild behavior, error shape and normalized TOON/JSON equivalence. The skill uses the same nonpersonal path. `.gitignore:1–3` already covers dependencies, build output and local analysis state; `git check-ignore dist/index.js node_modules/@toon-format/toon/package.json` confirmed both generated outputs are ignored.

History scan before this change: `git rev-list --all --reflog --objects` plus `git cat-file` covered **all 4 commits and 20 distinct file blobs**, including commit messages and author/committer metadata, not merely the working tree or last patch. `git fsck --full --no-reflogs` produced no dangling/unreachable warnings. Pattern searches included home paths, internal orchestration/documentation identifiers, credential assignments, common provider token prefixes, and private-key headers; all credential-like matches were manually reviewed dummy test values or environment variable references. No real credential/token/private key was found. This is a pattern/manual review, not proof that arbitrary secrets cannot exist; no dedicated secret-scanner binary was available. Normal Git author/committer identity remains present.

Confirmed historical findings, accepted by the owner for publication as-is (values deliberately not reproduced):

- README blob `64fec9a503cf8456fb9bae037690f40ce262387d`, lines 9/16/28: personal absolute checkout paths; line 127: internal documentation-wrapper name.
- Skill blob `af7f5aeb5cb591f6061e09940e1dcd19aee42ebc`, lines 8/11/19: personal absolute checkout paths.
- Changes in this branch remove those strings from current tracked documentation, but the original blobs remain in history. The owner explicitly chose to publish the existing history as-is: no rewriting, squashing, or fresh sanitized snapshot.
- Fixed organization origin remains intentionally in source/docs under the assigned exact-host security contract and the owner's decision to make this repository public later. No authenticated-host generalization was made.
- License decision resolved: MIT, copyright 2026 Lucas Lim. Root `LICENSE` and README's License section now document it; manifest remains MIT and private.

## Validation evidence

After adding the owner-approved license and recording the history decision, `npm run typecheck`, `npm test` and `npm run build` were rerun: all exited 0, with 20 tests passed, 0 failed, and the same 43.17 KB bundle. `git diff --check` also passed.

On Node `v24.21.0`, Bun `1.4.0`:

```text
npm install --package-lock-only --ignore-scripts --save-exact @toon-format/toon@4.1.1
  → audited 5 packages, 0 vulnerabilities
npm ci --ignore-scripts
  → added 4 packages, audited 5 packages, 0 vulnerabilities
npm audit --include=dev
  → found 0 vulnerabilities
npm run typecheck
  → tsc --noEmit, exit 0
npm test
  → 20 tests, 20 pass, 0 fail (mocked fetch only)
npm run build
  → Bundled 9 modules; dist/index.js 43.17 KB; exit 0
 git diff --check
  → no whitespace errors
```

There is no lint script in this repo; typecheck/tests and whitespace check were run, not an invented lint command.

Bundling proof: temporarily moved `node_modules` aside **inside this checkout**, created an in-checkout executable symlink to the launcher, and invoked it with an import-time fetch mock and dummy credentials. Both compact status and `--json` succeeded with dependencies absent, as did help. After restoring dependencies, strict decoding of the bundled compact output exactly equaled bundled JSON. Built JS imports only Node's `node:url`, inlines the official encoder, and tree-shakes the test-only decoder. No dependency import is needed at runtime. Node 22 itself was not installed/run during this check; the build target and documented minimum remain Node >=22.
