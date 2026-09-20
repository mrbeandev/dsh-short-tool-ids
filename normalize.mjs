import { createHash } from 'node:crypto';

// 192 hash bits, ASCII-only, 53 characters. Hash the WHOLE original, not its prefix.
export function shortId(id) {
  return `call_${createHash('sha256').update(id).digest('hex').slice(0, 48)}`;
}

/** Clone only changed content. Never mutate frozen, durable session messages. */
export function normalizeRequest(options) {
  const ids = new Set();
  function collect(blocks) {
    for (const block of blocks) {
      if (block.type === 'tool-call') ids.add(block.id);
      if (block.type === 'tool-result') {
        ids.add(block.toolCallId);
        collect(block.content);
      }
    }
  }
  for (const message of options.messages) collect(message.content);
  const mapping = new Map();
  const owners = new Map([...ids].map(id => [id, id]));
  for (const id of ids) {
    // Responses compound call_id|item_id has separate protocol semantics.
    // This hotfix deliberately handles ordinary Chat Completions IDs only.
    if (typeof id !== 'string' || id.length <= 64 || id.includes('|')) continue;
    const candidate = shortId(id);
    if (owners.has(candidate) && owners.get(candidate) !== id) {
      throw new Error('short-tool-ids: ID collision; request refused');
    }
    owners.set(candidate, id);
    mapping.set(id, candidate);
  }
  if (!mapping.size) return options;
  function rewrite(blocks) {
    let changed = false;
    const result = blocks.map(block => {
      if (block.type === 'tool-call' && mapping.has(block.id)) {
        changed = true;
        return { ...block, id: mapping.get(block.id) };
      }
      if (block.type === 'tool-result') {
        const content = rewrite(block.content);
        const toolCallId = mapping.get(block.toolCallId) ?? block.toolCallId;
        if (content !== block.content || toolCallId !== block.toolCallId) {
          changed = true;
          return { ...block, toolCallId, content };
        }
      }
      return block;
    });
    return changed ? result : blocks;
  }
  const messages = options.messages.map(message => {
    const content = rewrite(message.content);
    if (content === message.content) return message;
    // Signed/non-Chat-Completions replay has protocol-specific requirements.
    const replay = message.source?.replayState;
    if (message.role === 'assistant' && replay && (
      replay.response?.kind !== 'pi-ai' || replay.response?.api !== 'openai-completions' ||
      replay.blocks?.some(block => block.thoughtSignature || block.redacted)
    )) throw new Error('short-tool-ids: unsupported signed/native replay; request refused');
    return { ...message, content };
  });
  return { ...options, messages };
}

const installationKey = Symbol.for('vehicle-monitor.dsh-short-tool-ids');

/** Reversible adapter-boundary shim. Preserves prepared-call snapshot binding. */
export function installAdapterShim(Adapter, { isEnabled = () => false } = {}) {
  const proto = Adapter.prototype;
  if (Object.hasOwn(proto, installationKey)) throw new Error('short-tool-ids: already installed');
  const streamDescriptor = Object.getOwnPropertyDescriptor(proto, 'stream');
  const prepareDescriptor = Object.getOwnPropertyDescriptor(proto, 'prepareCall');
  if (typeof streamDescriptor?.value !== 'function' || typeof prepareDescriptor?.value !== 'function') {
    throw new Error('short-tool-ids: incompatible adapter interface');
  }
  let active = true;
  function apiOf(adapter, route, target) {
    return adapter.modelOf(adapter.current(), route, target).api;
  }
  function convert(options, api) {
    // A provider can expose different protocols: only Chat Completions is supported.
    if (!active || !isEnabled(options.provider) || api !== 'openai-completions') return options;
    return normalizeRequest(options);
  }
  function stream(options) {
    return streamDescriptor.value.call(this, convert(options, apiOf(this, options.provider, options.model)));
  }
  async function prepareCall(...args) {
    // Capture API before awaiting: the real adapter captures its snapshot synchronously.
    // Enabled state is read at dispatch, so toggles also affect pending prepared calls.
    const api = apiOf(this, args[0], args[1]);
    const handle = await prepareDescriptor.value.apply(this, args);
    return {
      ...handle,
      stream(options) { return handle.stream(convert(options, api)); },
    };
  }
  Object.defineProperty(proto, 'stream', { ...streamDescriptor, value: stream });
  Object.defineProperty(proto, 'prepareCall', { ...prepareDescriptor, value: prepareCall });
  Object.defineProperty(proto, installationKey, { value: true, configurable: true });
  return () => {
    if (!active) return; // A stale disposer must not disturb a later installation.
    active = false; // Already prepared handles also stop converting after unload.
    if (proto.stream === stream) Object.defineProperty(proto, 'stream', streamDescriptor);
    if (proto.prepareCall === prepareCall) Object.defineProperty(proto, 'prepareCall', prepareDescriptor);
    delete proto[installationKey];
  };
}
