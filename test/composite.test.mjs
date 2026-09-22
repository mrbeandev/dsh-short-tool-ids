import test from 'node:test';
import assert from 'node:assert/strict';
import { createClientPlugin } from '../client/index.mjs';

function makeScope(initialValue = {}) {
  let snapshot = { status: 'ready', value: { providers: initialValue }, revision: 4, writable: true, mode: 'host' };
  const calls = [], listeners = new Set();
  return {
    calls,
    getSnapshot() { return snapshot; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async mutate(ops, revision) {
      calls.push({ ops, revision });
      const providers = { ...snapshot.value.providers };
      if (ops[0].op === 'unset') delete providers[ops[0].path[1]];
      else providers[ops[0].path[1]] = ops[0].value;
      snapshot = { ...snapshot, revision: snapshot.revision + 1, value: { providers } };
      for (const listener of listeners) listener();
    },
  };
}

/** Minimal fake React matching client.test.mjs, plus recursive function-component rendering. */
function harness() {
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
  const idsScope = makeScope();
  const rpmScope = makeScope({ cc: 30 });
  const plugin = createClientPlugin(name => { assert.equal(name, 'react'); return React; });
  let registration, component;
  plugin.apply({
    settingsScope: {
      bind(spec) {
        if (spec.namespace === 'short-tool-ids') return idsScope;
        if (spec.namespace === 'dsh-rpm') return rpmScope;
        throw new Error(`unexpected namespace ${spec.namespace}`);
      },
    },
    slots: {
      inject(name, callback) { callback(); },
      register(options, view) { registration = options; component = view; },
    },
  });

  // Hook state persists per (component, route) across re-renders, like a real
  // reconciler, so onChange followed by a re-render sees the new draft.
  const instances = new Map();
  function activate(key) {
    if (!instances.has(key)) instances.set(key, { state: [], notifications: 0 });
    active = instances.get(key);
    active.cursor = 0;
  }

  function renderDeep(element, out = []) {
    if (!element || typeof element !== 'object') return out;
    if (typeof element.type === 'function') {
      activate(`${element.type.name}:${element.props?.provider?.provider ?? ''}`);
      return renderDeep(element.type(element.props), out);
    }
    out.push(element);
    for (const child of element.children) renderDeep(child, out);
    return out;
  }

  function card(route = 'cc') {
    activate(`root:${route}`);
    const flat = [];
    const tree = component({ provider: { provider: route }, ...registration.inject() });
    renderDeep(tree, flat);
    return flat;
  }
  return { registration, card, idsScope, rpmScope };
}

test('with dsh-rpm installed the card renders both toggle and RPM row', () => {
  const h = harness();
  assert.equal(h.registration.key, 'llm-pi-ai');
  const flat = h.card();
  assert.ok(flat.some(n => n.type === 'span' && n.children.includes('Use short tool-call IDs')));
  assert.ok(flat.some(n => n.type === 'span' && n.children.includes('Rate limit (requests per minute)')));
});

test('RPM row restores the saved limit for the card route', () => {
  const h = harness();
  const flat = h.card();
  const input = flat.find(n => n.type === 'input' && n.props['aria-label'] === 'Requests-per-minute limit for cc');
  assert.equal(input.props.value, '30');
});

test('RPM apply persists rpm via the dsh-rpm scope, not the toggle scope', async () => {
  const h = harness();
  const first = h.card();
  first.find(n => n.type === 'input' && n.props['aria-label'] === 'Requests-per-minute limit for cc')
    .props.onChange({ currentTarget: { value: '15' } });
  // Re-render: the field now reflects the typed draft.
  const second = h.card();
  assert.equal(second.find(n => n.type === 'input' && n.props['aria-label'] === 'Requests-per-minute limit for cc').props.value, '15');
  await second.find(n => n.type === 'button' && n.children.includes('Apply')).props.onClick();
  assert.deepEqual(h.rpmScope.calls, [{ ops: [{ op: 'set', path: ['providers', 'cc'], value: 15 }], revision: 4 }]);
  assert.deepEqual(h.idsScope.calls, []);
});

test('clearing the RPM field unsets the route entry', async () => {
  const h = harness();
  const first = h.card();
  first.find(n => n.type === 'input' && n.props['aria-label'] === 'Requests-per-minute limit for cc')
    .props.onChange({ currentTarget: { value: '' } });
  const second = h.card();
  await second.find(n => n.type === 'button' && n.children.includes('Apply')).props.onClick();
  assert.deepEqual(h.rpmScope.calls, [{ ops: [{ op: 'unset', path: ['providers', 'cc'] }], revision: 4 }]);
});
