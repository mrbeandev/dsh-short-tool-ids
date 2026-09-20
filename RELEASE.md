# Release checklist

The package is prepared for the initial public repository push. No npm
publication has been performed.

The repository URL is configured as
`https://github.com/mrbeandev/dsh-short-tool-ids`. The current package is not
publishable yet because `prepublishOnly` intentionally stops until the owner
selects a distribution license. The package name is currently unpublished on
npm; verify ownership while logged into the intended npm account before
publishing.

1. Choose the package name/scope and verify npm availability/ownership.
2. Choose a distribution license; replace LICENSE and package.json's UNLICENSED.
3. Confirm the repository, bugs and homepage metadata in package.json.
4. Review supported DSH/adapter/pi-ai versions and prototype-patching limitations.
5. Run `npm test`, then `npm run test:integration` with DSH_TEST_HARNESS_ENTRY set.
6. Verify the provider UI toggle and a real session using the installed package.
7. Run `npm run pack:check` and inspect every packed file: no credentials, private
   session history, machine-local patch, cache or absolute user paths. Synthetic
   regression tests and source/build scripts are intentionally included.
8. Update CHANGELOG.md and version. Publish only on explicit owner instruction.

After those gates are complete, publish the public package with:

```bash
npm publish --access public
```

Users can then install it into the Web profile with:

```bash
dsh plugin --profile web add dsh-short-tool-ids
```

`prepublishOnly` refuses publication until the owner supplies a distribution
license. The repository metadata is already configured.
No build system is required for the current server-side ESM sources. Any browser
entry must be built and verified before including it in the package's files list.
