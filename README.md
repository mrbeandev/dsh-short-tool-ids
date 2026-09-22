# dsh-short-tool-ids

An experimental DeepSeek Harness plugin with a per-provider **Use short tool-call
IDs** checkbox in **Settings → Models**, on configured pi-ai provider cards.

Fixes ordinary oversized tool-call IDs in OpenAI-compatible Chat Completions
history, such as `maximum length 64, got length 81`, without editing saved sessions.

[Source repository](https://github.com/mrbeandev/dsh-short-tool-ids)

## Why this plugin exists

This was built to recover a real DSH chat session that could no longer accept
messages. The session history contained tool-call IDs with 81 characters, but
the OpenAI-compatible API receiving the request accepts at most 64. Every new
turn resent the invalid history, so the session failed before the model could
respond with:

```text
Invalid 'input[5].call_id': string too long. Expected a string with maximum length 64, but got a string with length 81 instead.
```

The original route used a custom `cc` provider. DSH's built-in normalization
did not cover that provider during same-model replay, and renaming it to
`openai: cc` would not activate the exact upstream `openai` branch. Renaming it
to `openai` would still leave the same-model replay gap.

Use this plugin when an OpenAI-compatible Chat Completions provider rejects a
resumed or tool-using chat because a tool-call ID is too long. Enable the
toggle only for the affected provider in **Settings → Models**. The plugin
shortens IDs at request time, rewrites matching tool results consistently, and
leaves the saved session history unchanged. It is a targeted compatibility
workaround, not a general fix for Responses or Anthropic message IDs.

## Install from npm

Install it into the Web profile with one command:

```bash
dsh plugin --profile web add dsh-short-tool-ids
```

The package declares the bundled host patch and browser registration in its
`package.json` metadata, so a global `npm install` is not required. Stop the
existing DSH Web process when active work is finished, then restart it normally
(without the previous short-ID `--patch` flag):

```bash
dsh web --no-open --port 3080
```

Refresh the existing Web page. In **Settings → Models**, enable **Use short
tool-call IDs** for the provider that returns the ID-length error. Retry that
chat.

## Install locally

To install from a local checkout instead, from a terminal:

```bash
dsh plugin --profile web add "/absolute/path/to/dsh-short-tool-ids"
```

Stop the existing DSH Web process when active work is finished, then restart it
normally (without the previous short-ID `--patch` flag):

```bash
dsh web --no-open --port 3080
```

Refresh the existing Web page. In **Settings → Models**, enable **Use short
tool-call IDs** for the provider that returns the ID-length error. Retry that chat.
**All provider toggles default OFF**, including `cc` when upgrading from v0.1.0.

The profile installation persists across restarts. Each enabled provider covers
all its eligible models and sessions in that process. It does not enable other
profiles or separately launched worker processes. Keep the local package folder
in place if the package manager installed it as a link.

**Do not load this package and the old startup overlay together.** Two installs
of the same adapter wrapper are rejected. The host client-package manifest and
browser bundle are cached, so upgrading from the host-only plugin requires a
server restart plus page refresh. There is no standalone UI server to start and
no core Web rebuild is necessary; the plugin uses an existing settings slot.

Rollback:

```bash
dsh plugin --profile web remove dsh-short-tool-ids
# Stop/restart the existing server without any short-ID --patch flag.
```

Or switch a provider's toggle off; subsequent dispatches stop rewriting its IDs.

## What the toggle does

- Persists a boolean under the plugin-owned `short-tool-ids.providers` settings
  map, not in API keys or the provider's own configuration schema.
- Defaults off. Changes take effect on the next dispatch, including a prepared
  request not yet dispatched. Already-dispatched requests are unaffected.
- Supports **pi-ai `openai-completions` models only**. Other protocols and native
  adapters are untouched even when that provider's switch is on.
- Ordinary IDs longer than 64 characters become `call_` plus 48 SHA-256 hex
  characters (53 total). Calls and matching results receive the same mapping.
- Leaves valid IDs, arguments, outputs, replay metadata, tool execution identities
  and saved session files unchanged. Works on existing history and future requests.
- Checks for collisions against rewritten and untouched IDs; refuses collisions
  instead of pairing the wrong result.
- Leaves compound Responses `call_id|item_id` IDs untouched; this is NOT a general
  Responses/Anthropic compatibility fix. Unsupported signed/native history that
  would require an unsafe rewrite is refused rather than stripped.

The checkbox disables itself for loading, unavailable, read-only or non-host
settings and during saves. Path-scoped writes retain other provider settings and
use revision fencing. Save conflicts/failures show an error rather than a false
success; different provider cards subscribe to the shared settings scope.

## Optional dsh-rpm composite seat

The provider-card extension cell is single-occupant per settings namespace, so
this plugin's `llm-pi-ai` seat can also host one companion control: when
[dsh-rpm](https://github.com/mrbeandev/dsh-rpm) is installed, a **Rate limit
(requests per minute)** input renders beneath the toggle, reading and writing
dsh-rpm's own `dsh-rpm` settings namespace. Nothing about the toggle's behavior,
document, or defaults changes; without dsh-rpm the seat renders the toggle
alone, exactly as before, and the RPM row never appears. Introduced in v0.3.0.

## Compatibility and risk

**No guarantee of zero regressions.** This is a version-gated prototype wrapper,
not an officially supported adapter-decorator API. DSH's ordinary `llm/stream`
middleware sees frozen durable requests and cannot replace their histories.

The plugin resolves the adapter from the running CLI's dependency tree, wraps
`PiAiAdapter.stream()` and prepared-call dispatch reversibly, and retains original
prepared handles/model snapshots. Runtime versions are deliberately pinned:

| Package | Tested version |
|---|---|
| `@deepseek-ai/dsh-llm-pi-ai` | `0.1.5-rc.2` |
| `@earendil-works/pi-ai` | `0.85.1` |
| Inspected CLI | `0.1.5-rc.1` |

Untested adapter versions refuse plugin startup and require review. Disable or
remove the plugin if an upgrade prevents startup. It must not be combined with
another wrapper of the same methods. The UI occupies the keyed
`settings.models.provider-card` slot for `llm-pi-ai`; that slot supports only one
occupant per key, so another plugin using the same key needs coordination.

Renaming a provider to literal `openai: cc` does not trigger the upstream exact
`provider === 'openai'` branch. Even renaming to `openai` leaves the upstream
same-model normalization gap.

## Development

Zero npm runtime/build dependencies: server code is ESM; the dependency-free client
builder emits DSH's lazy ModuleLoader format using the shell's existing React.

```bash
npm run build
npm test
DSH_TEST_HARNESS_ENTRY="/absolute/path/to/dsh/lib/bin.js" npm run test:integration
npm run pack:check
```

Use a workspace-local npm cache if desired (`npm_config_cache="$PWD/.cache/npm"`).
Optional `DSH_TEST_SESSION=/path/to/decoded-session.jsonl` enables private-history
replay checks. Never package or commit real session history. Generic test runs
skip integration tests without the explicit installed CLI path; the integration
script refuses a missing path rather than silently skipping adapter verification.

Tests include frozen-history preservation, matching results, boundary lengths,
collisions, live provider toggles, protocol isolation, prepared snapshots,
unload/duplicate guards, iterator cancellation/errors, settings schema, actual
adapter HTTP serialization, provider checkbox writes/errors/read-only state and
lazy browser-bundle registration. Mock HTTP tests use a temporary loopback SSE
endpoint and fake credentials, close it afterward, and make no paid API calls.
UI tests use a fake React hook harness, not a full browser DOM test.

v0.1.0's live repair was confirmed with a successful reply on a previously stalled
session. The v0.2.0 provider-card UI was checked in a running DSH web session:
toggle rendering, saving, and persistence across a page reload.

## License

[MIT](LICENSE). Maintainer release steps are in [RELEASE.md](RELEASE.md).
