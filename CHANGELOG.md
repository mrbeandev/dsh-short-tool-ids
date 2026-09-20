# Changelog

## 0.2.0 — Unreleased

- Standalone npm package with host/client exports and a dependency-free client build.
- Persisted per-provider "Use short tool-call IDs" checkbox in Models settings.
- Group explanatory copy into a bounded, theme-aware experimental notice linked
  to the checkbox, instead of a loose full-width paragraph.
- Default off; opt-in covers all eligible Chat Completions models of each provider.
- Live dispatch-time enablement, protocol guards, save conflict/read-only UI handling.
- Explicit release gate remains pending the owner-selected distribution license.

## 0.1.0 — Local prototype

- Scoped cc/openai-astra/gpt-6-astra workaround with reversible adapter wrappers.
- Deterministic 53-character IDs and paired result rewriting without transcript edits.
- Regression tests and real-adapter mock-HTTP serialization checks.
- User confirmed the previously stalled session could reply again.
