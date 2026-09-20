import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createClientPlugin } from '../client/index.mjs';

function harness(initial = {}, mutateImpl = async () => {}) {
  let snapshot = { status: 'ready', value: { providers: {} }, revision: 4, writable: true, mode: 'host', ...initial };
  const calls = [], listeners = new Set();
  const scope = {
    getSnapshot() { assert.equal(this, scope); return snapshot; },
    subscribe(fn) { assert.equal(this, scope); listeners.add(fn); return () => listeners.delete(fn); },
    async mutate(ops, revision) {
      calls.push({ ops, revision });
      await mutateImpl(ops, revision);
      snapshot = { ...snapshot, revision: snapshot.revision + 1, value: { providers: { ...snapshot.value.providers, [ops[0].path[1]]: ops[0].value } } };
      for (const listener of listeners) listener();
    },
  };
  let active;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
    useMemo: fn => fn(),
    useState(value) {
      const instance = active, index = instance.cursor++;
      if (!(index in instance.state)) instance.state[index] = value;
      return [instance.state[index], next => { instance.state[index] = next; }];
    },
    useRef(value) {
      const instance = active, index = instance.cursor++;
      return instance.state[index] ??= { current: value };
    },
    useEffect(fn) {
      const index = active.cursor++;
      if (!(index in active.state)) active.state[index] = fn();
    },
    useId: () => `test-${active.cursor++}`,
    useSyncExternalStore(subscribe, getSnapshot) {
      const instance = active, index = instance.cursor++;
      if (!(index in instance.state)) instance.state[index] = subscribe(() => { instance.notifications++; });
      return getSnapshot();
    },
  };
  const plugin = createClientPlugin(name => { assert.equal(name, 'react'); return React; });
  let registration, component;
  plugin.apply({
    settingsScope: { bind(spec) { assert.deepEqual(spec, { namespace: 'short-tool-ids' }); return scope; } },
    slots: {
      inject(name, callback) { assert.equal(name, 'settings.models.provider-card'); callback(); },
      register(options, view) { registration = options; component = view; },
    },
  });
  function card(route = 'cc') {
    const instance = { state: [], cursor: 0, notifications: 0 };
    return {
      instance,
      render() { active = instance; active.cursor = 0; return component({ provider: { provider: route }, ...registration.inject() }); },
    };
  }
  return { plugin, registration, card, calls, scope };
}
function nodes(tree, type) {
  if (!tree || typeof tree !== 'object') return [];
  return [...(tree.type === type ? [tree] : []), ...tree.children.flatMap(child => nodes(child, type))];
}
function checkbox(card) { return nodes(card.render(), 'input')[0].props; }

test('registers the provider-family slot with default OFF and shell React only', () => {
  const h = harness();
  assert.deepEqual(h.plugin.inject, ['slots', 'settingsScope']);
  assert.equal(h.registration.key, 'llm-pi-ai');
  assert.equal(checkbox(h.card()).checked, false);
  assert.equal(checkbox(h.card('__proto__')).checked, false);
  assert.match(JSON.stringify(h.card().render()), /Use short tool-call IDs/);
});

test('explanation is a labelled bounded notice associated with the checkbox', () => {
  const tree = harness().card().render();
  const input = nodes(tree, 'input')[0];
  const notice = nodes(tree, 'aside')[0];
  assert.equal(notice.props.role, 'note');
  assert.equal(notice.props['aria-label'], 'About short tool-call IDs');
  assert.equal(input.props['aria-describedby'], notice.props.id);
  assert.equal(nodes(notice, 'strong')[0].children[0], 'Experimental workaround');
  assert.equal(notice.props.style.maxWidth, '520px');
  assert.equal(notice.props.style.minWidth, 0);
  assert.match(JSON.stringify(notice), /Enable only if this provider rejects/);
  assert.match(JSON.stringify(notice), /saved history stays unchanged/);
});

test('writes only route path with rendered revision and notifies every card', async () => {
  const h = harness();
  const first = h.card(), same = h.card(), other = h.card('other');
  checkbox(same); checkbox(other);
  await checkbox(first).onChange({ currentTarget: { checked: true } });
  assert.deepEqual(h.calls, [{ ops: [{ op: 'set', path: ['providers', 'cc'], value: true }], revision: 4 }]);
  assert.equal(checkbox(same).checked, true);
  assert.equal(checkbox(other).checked, false);
  assert.equal(same.instance.notifications, 1);
  await checkbox(first).onChange({ currentTarget: { checked: false } });
  assert.equal(h.calls[1].revision, 5);
  assert.equal(checkbox(first).checked, false);
});

test('loaded persisted booleans restore independently; only true enables', () => {
  const h = harness({ value: { providers: { cc: true, other: false, bad: 'true' } } });
  assert.equal(checkbox(h.card()).checked, true);
  assert.equal(checkbox(h.card('other')).checked, false);
  assert.equal(checkbox(h.card('bad')).checked, false);
});

test('loading, unavailable, read-only and memory scopes cannot mutate', async () => {
  for (const state of [{ status: 'loading' }, { status: 'unavailable' }, { writable: false }, { mode: 'memory' }]) {
    const h = harness(state), input = checkbox(h.card());
    assert.equal(input.disabled, true);
    await input.onChange({ currentTarget: { checked: true } });
    assert.equal(h.calls.length, 0);
  }
});

test('pending writes prevent duplicate changes and failed save shows safe error', async () => {
  let reject;
  const h = harness({}, () => new Promise((_, no) => { reject = no; }));
  const card = h.card(), input = checkbox(card);
  const write = input.onChange({ currentTarget: { checked: true } });
  assert.equal(checkbox(card).disabled, true);
  await input.onChange({ currentTarget: { checked: true } });
  assert.equal(h.calls.length, 1);
  reject(new Error('SECRET_CONFIGURATION_DETAILS'));
  await write;
  const tree = card.render();
  assert.equal(nodes(tree, 'input')[0].props.checked, false);
  assert.equal(nodes(tree, 'input')[0].props.disabled, false);
  assert.equal(nodes(tree, 'p').filter(node => node.props.role === 'alert').length, 1);
  assert.doesNotMatch(JSON.stringify(tree), /SECRET_CONFIGURATION_DETAILS/);
});

test('silent recovered refusal is detected even when scope.mutate resolves', async () => {
  const h = harness();
  h.scope.mutate = async () => {}; // installed scope returns after an {ok:false} recovery
  const card = h.card();
  await checkbox(card).onChange({ currentTarget: { checked: true } });
  assert.equal(checkbox(card).checked, false);
  assert.equal(nodes(card.render(), 'p').filter(node => node.props.role === 'alert').length, 1);
});

test('distributed bundle registers lazily and matches authored factory', async () => {
  const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  let registration;
  vm.runInNewContext(bundle, { window: { __ModuleLoader__: { load(value) { registration = value; } } } });
  assert.equal(registration.id, 'dsh-short-tool-ids');
  assert.equal(typeof registration.factory, 'function');
  assert.equal(registration.factory.toString(), createClientPlugin.toString());
  const requests = [];
  const plugin = registration.factory(name => { requests.push(name); return {}; });
  assert.deepEqual(requests, ['react']);
  assert.equal(typeof plugin.apply, 'function');
});
