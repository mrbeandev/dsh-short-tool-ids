# Local setup and migration from the v0.1 startup patch

This document is for local development and migration. It intentionally does not
contain machine-specific paths or private session data.

If an older local installation used a startup patch, remove that patch from the
startup command after installing this package. Do not load both the package and
the old adapter overlay in the same process.

## Normal profile installation

Stop the current DSH Web process with Ctrl+C, then install from this checkout:

```bash
npm_config_cache="$PWD/.cache/npm" \
  dsh plugin --profile web add "/absolute/path/to/dsh-short-tool-ids"
dsh web --no-open --port 3080
```

No --patch flag this time. Do not use both package installation and the old patch.
Refresh http://127.0.0.1:3080, open Settings → Models → cc and enable
**Use short tool-call IDs**, then retry the old conversation. This switch defaults
OFF for every provider in v0.2.0. No automatic migration silently enables it.

The profile installation and GUI activation are user steps. Keep the package
folder in place if the profile manager installed it as a link.

## Local regression command

```bash
DSH_TEST_HARNESS_ENTRY="/absolute/path/to/dsh/lib/bin.js" \
  npm run test:integration
```

`DSH_TEST_SESSION=/path/to/decoded-session.jsonl` is optional for private-history
replay checks. Never package or commit real session history. This file and
`local.patch.yml` are excluded from the npm file allowlist.
