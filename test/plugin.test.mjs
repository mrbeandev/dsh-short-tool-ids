import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeRequest, shortId, installAdapterShim } from '../normalize.mjs';
import { loadRuntime, apply } from '../index.mjs';

const long = 'gwid_' + 'a'.repeat(76);
const route = { provider: 'cc', model: 'openai-astra/gpt-6-astra' };
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function fixture(ids = [long]) {
  const blocks = ids.map(id => ({ type: 'tool-call', id, name: 'read', arguments: '{"file_path":"docs/STATUS.md"}' }));
  return freeze({ ...route, messages: [
    { role: 'assistant', id: 'assistant', source: { kind: 'model', ...route, replayState: {
      response: { kind: 'pi-ai', version: 2, api: 'openai-completions', ...route, stopReason: 'toolUse' },
      blocks: blocks.map(() => ({ type: 'tool-call' })),
    } }, content: blocks },
    { role: 'user', id: 'result', source: { kind: 'tool' }, content: ids.map(toolCallId => ({ type: 'tool-result', toolCallId, content: [{ type: 'text', text: 'OK' }] })) },
  ] });
}

test('frozen history unchanged; calls/results match and replay preserved', () => {
  const original = fixture(); const before = JSON.stringify(original);
  const result = normalizeRequest(original);
  assert.equal(JSON.stringify(original), before);
  assert.equal(result.messages[0].content[0].id, shortId(long));
  assert.equal(result.messages[1].content[0].toolCallId, shortId(long));
  assert.equal(result.messages[0].source, original.messages[0].source);
  assert.equal(normalizeRequest(result), result);
});
test('64-character boundary; shared prefixes remain distinct; retries deterministic', () => {
  const input = fixture(['a'.repeat(64), 'a'.repeat(65), long, long.slice(0, -1) + 'b']);
  const a = normalizeRequest(input); const b = normalizeRequest(input);
  const ids = a.messages[0].content.map(x => x.id);
  assert.equal(ids[0].length, 64); assert.ok(ids.every(id => id.length <= 64));
  assert.equal(new Set(ids).size, 4); assert.deepEqual(a, b);
});
test('untouched-ID collisions refuse rather than pair wrong results', () => {
  assert.throws(() => normalizeRequest(fixture([long, shortId(long)])), /collision/);
});
test('compound Responses IDs preserve distinct item identity, outside hotfix scope', () => {
  const input = fixture(['call_x|' + 'a'.repeat(80), 'call_x|' + 'b'.repeat(80)]);
  assert.equal(normalizeRequest(input), input);
});
test('nested results rewrite while ordinary text/arguments remain intact', () => {
  const input = { ...route, messages: [{ role: 'user', content: [{ type: 'tool-result', toolCallId: long, content: [{ type: 'tool-result', toolCallId: long, content: [{ type: 'text', text: long }] }] }] }] };
  const output = normalizeRequest(input);
  assert.equal(output.messages[0].content[0].content[0].toolCallId, shortId(long));
  assert.equal(output.messages[0].content[0].content[0].content[0].text, long);
});
test('signed replay refuses conversion', () => {
  const input = structuredClone(fixture());
  input.messages[0].source.replayState.response.api = 'anthropic-messages';
  assert.throws(() => normalizeRequest(input), /unsupported/);
});

class Fake {
  current() { return { api: this.api ?? 'openai-completions' }; }
  modelOf(snapshot) { return snapshot; }
  stream(options) { return options; }
  prepareCall() { const snapshot = this.current(); return Promise.resolve({ model: snapshot, stream: options => ({ options, snapshot }) }); }
}
test('public direct/prepared paths, route isolation, captured snapshot, disposal', async () => {
  class Adapter extends Fake { stream(o) { return super.stream(o); } prepareCall(...a) { return super.prepareCall(...a); } }
  const restore = installAdapterShim(Adapter, { isEnabled: provider => provider === 'cc' }); const adapter = new Adapter();
  try {
    assert.throws(() => installAdapterShim(Adapter, { isEnabled: provider => provider === 'cc' }), /already installed/);
    const directInput = fixture();
    assert.equal(adapter.stream(directInput).messages[0].content[0].id, shortId(long));
    for (const different of [{ provider: 'other' }]) {
      const input = { ...fixture(), ...different }; assert.equal(adapter.stream(input), input);
    }
    const prepared = await adapter.prepareCall(route.provider, route.model);
    adapter.api = 'anthropic-messages';
    const result = prepared.stream(fixture());
    assert.equal(result.snapshot.api, 'openai-completions');
    assert.equal(result.options.messages[0].content[0].id, shortId(long));
    const unsupported = fixture(); assert.equal(adapter.stream(unsupported), unsupported);
    restore();
    const input = fixture(); assert.equal(prepared.stream(input).options, input);
    assert.equal(adapter.stream(input), input);
  } finally { restore(); }
});
test('provider toggles default off, cover all models, and update pending handles live', async () => {
  class Adapter extends Fake { stream(o) { return super.stream(o); } prepareCall(...a) { return super.prepareCall(...a); } }
  const input = fixture();
  const offDispose = installAdapterShim(Adapter);
  assert.equal(new Adapter().stream(input), input); offDispose();
  const providers = {};
  const dispose = installAdapterShim(Adapter, { isEnabled: p => providers[p] === true });
  try {
    const adapter = new Adapter();
    const prepared = await adapter.prepareCall('cc', route.model);
    assert.equal(prepared.stream(input).options, input);
    providers.cc = true;
    assert.equal(prepared.stream(input).options.messages[0].content[0].id, shortId(long));
    const otherModel = { ...fixture(), model: 'second-model' };
    assert.equal(adapter.stream(otherModel).messages[0].content[0].id, shortId(long));
    const otherProvider = { ...fixture(), provider: 'other' };
    assert.equal(adapter.stream(otherProvider), otherProvider);
    providers.other = true;
    assert.equal(adapter.stream(otherProvider).messages[0].content[0].id, shortId(long));
    providers.cc = false;
    assert.equal(prepared.stream(input).options, input);
  } finally { dispose(); }
});

test('stale disposer cannot remove ownership of a newer installation', () => {
  class Adapter extends Fake { stream(o) { return super.stream(o); } prepareCall(...a) { return super.prepareCall(...a); } }
  const oldDispose = installAdapterShim(Adapter, { isEnabled: provider => provider === 'cc' });
  oldDispose();
  const newDispose = installAdapterShim(Adapter, { isEnabled: provider => provider === 'cc' });
  try {
    oldDispose();
    assert.throws(() => installAdapterShim(Adapter, { isEnabled: provider => provider === 'cc' }), /already installed/);
    assert.equal(new Adapter().stream(fixture()).messages[0].content[0].id, shortId(long));
  } finally { newDispose(); }
});

test('iterator cancellation and errors pass through unchanged', async () => {
  let closed = false;
  class Adapter extends Fake {
    async *stream() { try { yield 1; throw new Error('sentinel'); } finally { closed = true; } }
    prepareCall(...a) { return super.prepareCall(...a); }
  }
  const restore = installAdapterShim(Adapter, { isEnabled: provider => provider === 'cc' });
  try {
    const it = new Adapter().stream(fixture()); assert.deepEqual(await it.next(), { value: 1, done: false });
    await it.return(); assert.ok(closed);
    const second = new Adapter().stream(fixture()); await second.next();
    await assert.rejects(second.next(), /sentinel/);
  } finally { restore(); }
});

const harnessEntry = process.env.DSH_TEST_HARNESS_ENTRY;
const runtimeAvailable = Boolean(harnessEntry && existsSync(harnessEntry));

test('real adapter + real pi-ai HTTP serialization repairs resumed IDs; server closes', { skip: !runtimeAvailable }, async () => {
  const runtime = await loadRuntime(harnessEntry);
  const { streamSimple, convertMessages } = await import(runtime.piRoot + '/dist/api/openai-completions.js');
  const captured = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    captured.push(JSON.parse(body));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: ' + JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', created: 0, model: route.model, choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const model = { id: route.model, provider: route.provider, api: 'openai-completions', name: 'mock', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, reasoning: false, input: ['text'], contextWindow: 1000000, maxTokens: 100, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const snapshot = {
    profiles: new Map([['cc', { modelErrors: new Map(), piProvider: {}, streamIdleTimeoutMs: 5000, configuredMaxTokens: new Map() }]]),
    models: { getModel: () => model, streamSimple },
  };
  const adapter = new runtime.PiAiAdapter({ resolveApiKey: async () => 'fake-test-key' });
  adapter.current = () => snapshot;
  const original = fixture(); const before = JSON.stringify(original);
  let restore;
  try {
    // Baseline reproduces actual oversized wire ID without needing a paid API call.
    for await (const _ of adapter.stream(original)) {}
    assert.equal(captured[0].messages[0].tool_calls[0].id.length, 81);
    restore = installAdapterShim(runtime.PiAiAdapter, { isEnabled: provider => provider === 'cc' });
    for await (const _ of adapter.stream(original)) {}
    const prepared = await adapter.prepareCall(route.provider, route.model);
    for await (const _ of prepared.stream(original)) {}
    for (const wire of captured.slice(1)) {
      assert.equal(wire.messages[0].tool_calls[0].id, shortId(long));
      assert.equal(wire.messages[1].tool_call_id, shortId(long));
    }
    assert.deepEqual(captured[1], captured[2]);
    assert.equal(JSON.stringify(original), before);
    // Renaming to the literal string openai: cc is not the exact openai branch.
    const ctx = { messages: [{ role: 'assistant', provider: 'foreign', api: 'foreign', model: 'foreign', content: [{ type: 'toolCall', id: long, name: 'read', arguments: {} }], stopReason: 'toolUse', timestamp: 0 }, { role: 'toolResult', toolCallId: long, toolName: 'read', content: [{ type: 'text', text: 'OK' }], timestamp: 0 }] };
    assert.equal(convertMessages({ ...model, provider: 'openai: cc' }, ctx, {})[0].tool_calls[0].id.length, 81);
  } finally {
    restore?.(); server.closeAllConnections(); await new Promise(r => server.close(r));
  }
});

test('Cordis plugin apply registers reversible effect on exact runtime', { skip: !runtimeAvailable }, async () => {
  let dispose; const messages = [];
  await apply({
    settings: { register(ns, schema, options) {
      assert.equal(ns, 'short-tool-ids'); assert.equal(options.applies, 'live');
      assert.deepEqual(schema({}), { providers: {} });
      assert.throws(() => schema({ providers: { cc: 'yes' } }));
      return { get: () => ({ providers: {} }) };
    } },
    effect: fn => { dispose = fn(); }, logger: { info: msg => messages.push(msg) },
  }, { harnessEntry });
  try { assert.match(messages[0], /session files unchanged/); } finally { dispose(); }
});

test('saved-session replay: every ordinary oversized ID normalizes and history stays unchanged', { skip: !process.env.DSH_TEST_SESSION }, () => {
  const events = readFileSync(resolve(process.env.DSH_TEST_SESSION), 'utf8').trim().split('\n').map(JSON.parse);
  const messages = events.filter(e => e.type === 'assistant/message').map(e => e.data.message);
  const before = JSON.stringify(messages);
  const input = freeze({ ...route, messages });
  const output = normalizeRequest(input);
  let oversized = 0;
  for (let i = 0; i < messages.length; i++) for (let j = 0; j < messages[i].content.length; j++) {
    const b = messages[i].content[j];
    if (b.type === 'tool-call' && b.id.length > 64 && !b.id.includes('|')) {
      oversized++; assert.equal(output.messages[i].content[j].id, shortId(b.id));
    }
  }
  assert.ok(oversized > 0); assert.equal(JSON.stringify(messages), before);
  console.log(`Saved-session replay verified: ${oversized} oversized tool-call occurrences`);
});
