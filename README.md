# confluence-axi

Owned, local-only, read-only Confluence CLI. Fixed origin: `https://einc.atlassian.net` (HTTPS, port 443). Native fetch, no Atlassian SDK. Compact responses use the official `@toon-format/toon` encoder, pinned to `4.1.1` (TOON specification 4.1), bundled into the build. This is **not** the public registry package with the same name.

## Local development

Use Volta-pinned Node `24.21.0` and Bun. Source tests require Node `>=22.18.0`; the compiled launcher supports Node `>=22`.

From your local checkout, without injected credentials:

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
./bin/confluence-axi --help
```

For local installation, create a symlink to the built checkout (keep that checkout in place):

```sh
mkdir -p "$HOME/.local/bin"
ln -s "$PWD/bin/confluence-axi" "$HOME/.local/bin/confluence-axi"
# Ensure ~/.local/bin is on PATH.
confluence-axi --help
```

If a target already exists, inspect it rather than overwrite it. The launcher resolves its symlink to load the adjacent `dist/index.js`; runtime needs Node `>=22`, but no `node_modules` or Bun. Dependency installation and source tests require Node `>=22.18.0`; Bun is required only to build.

No registry CLI installation, lifecycle installation hooks, credential files, disk caches or runtime temp files. Build artifacts are local and ignored by Git. Rebuild after changing source; the launcher never installs or updates itself.

## Credentials and owner smoke test

Supply `ATLASSIAN_EMAIL` and a **non-scoped** Basic API token through `ATLASSIAN_API_TOKEN`, falling back to nonempty `JIRA_API_TOKEN`. Empty values count as missing. The account must have Confluence read permission; use a read-only principal where possible. Scoped gateway tokens are unsupported: no alternate host or token-format guessing. Email must not contain `:`; email and either token variable must not contain credential control characters, including an unused fallback token. No login/config discovery, host environment override, credential CLI flags or automatic secret injection.

After ensuring the env file supplies the email and a compatible token, the owner can run this exact live smoke test:

```sh
op run --env-file="$DOTFILES/shell/secrets.env" -- "$HOME/.local/bin/confluence-axi" status
```

Development tests use dummy credentials and mocked fetch only. No live service/real credential smoke test was performed.

## Command grammar

```text
confluence-axi                         # status
confluence-axi status
confluence-axi search --cql/-q <CQL>
confluence-axi spaces
confluence-axi page <ID>
confluence-axi children <ID>
confluence-axi attachments <ID>        # metadata only, no download URLs
confluence-axi labels <ID>
confluence-axi help
```

Common flags: `--json`, `--help/-h`, `--version/-v/-V`. Collections (`search`, `spaces`, `children`, `attachments`, `labels`): `--limit <N>`, `--cursor <opaque>`. Page: `--max-chars <N>`. Six content commands accept `--full`; status/help do not. No other flags, aliases, bare-ID shortcut or raw request escape hatch.

Unknown commands/flags, duplicate flags (including aliases), boolean values, missing values, extra positionals and flag scope violations fail before fetch. Integer IDs are positive decimal int64 strings (`1` through `9223372036854775807`), with no leading zeroes. IDs never pass through JavaScript numbers. CQL must be nonempty; syntax is server-validated and no implicit page filter is added. `--full` conflicts with `--max-chars`; help conflicts with version. Valid diagnostic flags waive only missing ID/CQL and credentials, not supplied invalid arguments. Help/version remain text even with `--json`.

## Bounds and pagination

| Resource | Default | Maximum |
|---|---:|---:|
| Collection source rows (`--limit`) | 30 | 100 |
| Scalar/row strings, Unicode code points | 90 | 1000 with `--full` |
| Search excerpts, Unicode code points | 600 | 1000 with `--full` |
| Page body, Unicode code points | 2000 | 20000 (`--full` or `--max-chars`) |
| Opaque continuation, UTF-8 bytes | — | 8192 (never truncated) |
| Complete stdout, UTF-8 bytes | — | 512 KiB |
| Decoded response stream bytes | — | 5 MiB |
| Whole request and body deadline | — | 30 seconds |
| ADF depth / nodes | — | 64 / 100000 |

Limits are identical in JSON and compact output. No retries. Invalid/out-of-range limits fail rather than clamp. `--max-chars` accepts `1–20000`. `--full` expands only bounded text, never raw fields or requests.

Each invocation makes exactly one GET and returns one source page. A valid next link produces `hasMore: true` and complete `nextCursor`; pass it unchanged with `--cursor` on the same command and search CQL. No auto-following or recursive traversal. Cursor values must survive redaction/sanitization unchanged or fail. Children uses immediate `/direct-children` and filters `type=page` **after** the source page limit, so fewer rows (even zero) can accompany `hasMore: true`.

Both body `_links.next` and header `Link` next links must normalize to the same exact origin, collection endpoint and parent ID. Foreign origins, userinfo, fragments (even empty), wrong paths, invalid/missing/duplicate cursors and conflicting links fail. V1 `/rest/api/…` links receive the fixed `/wiki` context. `_links.base` never determines the host. Header links use standard angle-bracket URLs and a single `rel=next` value; malformed headers fail closed. Other next-link query parameters are validated by URL parsing but never replayed; only the opaque cursor is reused with the caller's CQL/limit.

## Normalized output

Compact output is official TOON: `key: value`, `rows[N]{columns}:` and indented rows, with the encoder's default two-space indentation and comma delimiter. Null/unavailable fields use `null` in both formats; empty strings use `""` in TOON. Bodies are quoted strings with escaped newlines/tabs, not literal indented blocks. Uniform nested objects can fold into tabular headers; nonuniform rows use object lists. Empty arrays use `[]`. The CLI appends one framing newline after the encoder's document. JSON is **normalized**, not a raw remote dump, and strictly decoding TOON yields the same data.

| Command | Fields |
|---|---|
| status | `origin, version, auth, accountId, displayName` |
| search | `query, count, total, hasMore, nextCursor, results[{id,type,title,url,excerpt,updated}]` |
| spaces | `count, hasMore, nextCursor, spaces[{id,key,name,type,status,homepageId}]` |
| page | `id,title,status,spaceId,parentId,version,created,updated,url,body,bodyLength,bodyTruncated` |
| children | `pageId,count,hasMore,nextCursor,children[{id,title,status,spaceId,position}]` |
| attachments | `pageId,count,hasMore,nextCursor,attachments[{id,title,mediaType,fileSize,created,version}]` |
| labels | `pageId,count,hasMore,nextCursor,labels[{id,name,prefix}]` |

Every successful data response includes read-only next-step `help[]` command templates; placeholders such as `<ID>`, `<CQL>` and `<nextCursor>` must be replaced by the caller. Zero emitted rows include `message: 0 results on this source page` (even if `hasMore` is true). Shortened content suggests `--full` when available; this still respects the hard limits above. Diagnostic help/version remain plain text.

`count` is emitted rows. Search ID comes from `content.id` or `space.id`, type from `entityType`, updated from `lastModified`, total from `totalSize`. Page version/updated come from `version.number/createdAt`, created from `createdAt`; children position from `childPosition`. Attachment version uses `version.number`. Status display name falls back to `publicName`. Missing optional fields do not trigger requests.

Non-body shortened strings carry optional `truncatedFields: {fieldName: originalCodePointLength}` on their owning object/row. Page `bodyLength` records the sanitized/redacted converted body length before truncation; `bodyTruncated` discloses shortening. Same-origin navigation URLs normalize relative web paths with the fixed context; foreign/invalid targets become null. URLs are bounded display data, not request inputs, and truncation is disclosed.

Required minimum shapes: object roots; collections require object entries in `results` arrays no longer than the requested limit before filtering; pages require matching string ID and string `body.atlas_doc_format.value` encoding a `type=doc`, `version=1`, array-content ADF document; status requires `known`/`user` type and nonempty `accountId`. Optional declared fields, when present/non-null, must have their stated string/object/integer types. V1 numeric space IDs must be positive safe integers, then convert to strings; unsafe numeric IDs/counts/sizes/versions fail rather than guess rounded values. Undeclared raw fields are discarded.

## Content and security boundaries

All transport goes through one GET-only request function, with an explicit path allowlist:

```text
/wiki/rest/api/user/current
/wiki/rest/api/search
/wiki/api/v2/spaces
/wiki/api/v2/pages/{id}
/wiki/api/v2/pages/{id}/direct-children
/wiki/api/v2/pages/{id}/attachments
/wiki/api/v2/pages/{id}/labels
```

Invalid initial URLs fail before attaching credentials/fetch. Redirects use `redirect: manual`: the initial allowed-origin GET necessarily carries credentials, but all 3xx fail and **zero follow-up requests** are made. Crafted next links similarly fail after the single allowed-origin read and are never fetched. No POST exceptions, write commands, passthrough, uploads/downloads, hooks, setup, install or self-update commands exist.

Page GET requests `body-format=atlas_doc_format`; conversion preserves paragraphs, headings, lists, tables, links and code. Media/attachments remain placeholders; unsupported leaves are visibly marked and unsupported containers retain textual content. This is readable markdown/text, not full rendering fidelity. No HTML rendering, conversion POST or fetching body targets. Link/card URL attributes allow only same-origin HTTPS navigation, no userinfo/control characters: unsafe anchors retain text with `[link omitted]`, unsafe cards show `[card omitted]`. URL-looking prose is not interpreted as a navigation attribute.

Every remote/normalized string is untrusted data, never executable instructions. Strip complete ANSI CSI/OSC sequences, C0/C1 and DEL; newline/tab survive only in bodies. Redact both token variables and generated Basic Base64 before sanitization/truncation, again after transformation, and check the entire serialized output before a single stdout write. Exceptions, headers and raw HTTP error payloads are never serialized. In the pathological case where a supplied secret matches fixed diagnostic syntax itself, fail closed with only a newline rather than leak it; normal loader failures emit bounded generic `error/code` on stdout and exit 1.

## Errors

Success exits `0`; usage errors exit `2`; all other failures exit `1`. Errors go to stdout as `{error,code,help[]}` (JSON with `--json`, compact otherwise); minimal security/loader fallbacks may omit `help`. Codes:

```text
usage token_missing unauthorized forbidden not_found rate_limited
http_error transport_error security bad_json bad_response
response_too_large output_too_large
```

No raw remote error bodies, network retries or write-oriented follow-up suggestions. Size/security/shape failures do not produce partial data.

## Design notes and endpoint verification

The security contract overrides the Jira reference's unbounded output, credential configuration, automatic secret injection and writes. Most restrictive choices where API behavior is permissive: fail on malformed pagination headers, reject controls/whitespace and even empty userinfo in URL inputs, validate filtered-out children too, retain no raw response fields.

The documentation lookup service returned HTTP `429`, monthly quota exceeded. Endpoint parameters and schemas were verified from Atlassian's published [V1 OpenAPI](https://dac-static.atlassian.com/cloud/confluence/swagger.v3.json) and [V2 OpenAPI](https://dac-static.atlassian.com/cloud/confluence/openapi-v2.v3.json). Credentials use the documented site-direct [Basic authentication](https://developer.atlassian.com/cloud/confluence/basic-auth-for-rest-apis/) contract; [scoped token routing](https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/) is intentionally unsupported.
