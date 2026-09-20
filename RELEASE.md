# Release checklist

The package is prepared for the initial public repository push. No npm
publication has been performed.

The repository URL is configured as
`https://github.com/mrbeandev/dsh-short-tool-ids`. The package is licensed under
MIT. `prepublishOnly` still stops a publish if the license is missing or
`UNLICENSED`. The package name was unpublished on npm when last checked
(2026-09-20); verify ownership while logged into the intended npm account
before publishing.

1. Choose the package name/scope and verify npm availability/ownership.
2. Distribution license: MIT (done; LICENSE and package.json agree).
3. Confirm the repository, bugs and homepage metadata in package.json.
4. Review supported DSH/adapter/pi-ai versions and prototype-patching limitations.
5. Run `npm test`, then `npm run test:integration` with DSH_TEST_HARNESS_ENTRY set.
6. Verify the provider UI toggle and a real session using the installed package.
7. Run `npm run pack:check` and inspect every packed file: no credentials, private
   session history, machine-local patch, cache or absolute user paths. Synthetic
   regression tests and source/build scripts are intentionally included.
8. Bump the version. Publish only on explicit owner instruction.

After those gates are complete, publish the public package with:

```bash
npm publish --access public
```

Users can then install it into the Web profile with:

```bash
dsh plugin --profile web add dsh-short-tool-ids
```

`prepublishOnly` refuses publication if the distribution license is missing or
`UNLICENSED`. The repository metadata is already configured.
No build system is required for the current server-side ESM sources. Any browser
entry must be built and verified before including it in the package's files list.
