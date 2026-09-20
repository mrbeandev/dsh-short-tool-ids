import { createRequire } from 'node:module';
import { readFileSync, realpathSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installAdapterShim } from './normalize.mjs';

export const name = 'short-tool-ids';
export const inject = ['llm', 'settings'];
export const namespace = 'short-tool-ids';

/** Resolve through the running CLI, not a second npm copy of the adapter. */
export async function loadRuntime(harnessEntry = process.argv[1]) {
  if (!harnessEntry) throw new Error('short-tool-ids: cannot locate running DSH; set harnessEntry');
  const require = createRequire(realpathSync(harnessEntry));
  const adapterEntry = require.resolve('@deepseek-ai/dsh-llm-pi-ai');
  const adapterRequire = createRequire(adapterEntry);
  const adapterPackage = JSON.parse(readFileSync(adapterRequire.resolve('@deepseek-ai/dsh-llm-pi-ai/package.json'), 'utf8'));
  // pi-ai is import-only and does not export package.json; locate the package
  // through the adapter's Node resolution search paths without importing a copy.
  const piRoot = adapterRequire.resolve.paths('@earendil-works/pi-ai')
    .map(path => resolve(path, '@earendil-works/pi-ai'))
    .find(path => existsSync(resolve(path, 'package.json')));
  if (!piRoot) throw new Error('short-tool-ids: pi-ai package not found');
  const piPackage = JSON.parse(readFileSync(resolve(piRoot, 'package.json'), 'utf8'));
  if (adapterPackage.version !== '0.1.5-rc.2' || piPackage.version !== '0.85.1') {
    throw new Error(`short-tool-ids: untested versions ${adapterPackage.version}/${piPackage.version}; refusing to patch`);
  }
  const { PiAiAdapter } = await import(pathToFileURL(adapterEntry).href);
  const { default: z } = await import(pathToFileURL(adapterRequire.resolve('@deepseek-ai/schemastery')).href);
  return { PiAiAdapter, z, adapterEntry, piRoot, adapterVersion: adapterPackage.version, piVersion: piPackage.version };
}

export async function apply(ctx, config = {}) {
  if (config.enabled === false) return;
  const runtime = await loadRuntime(config.harnessEntry);
  const { z } = runtime;
  const scope = ctx.settings.register(namespace, z.object({
    providers: z.dict(z.boolean()).default({}),
  }), { applies: 'live' });
  ctx.effect(() => installAdapterShim(runtime.PiAiAdapter, {
    isEnabled: provider => Object.hasOwn(scope.get().providers, provider) && scope.get().providers[provider] === true,
  }), 'short-tool-ids: reversible adapter shim');
  ctx.logger.info('short-tool-ids: provider toggles ready (default off); session files unchanged');
}
