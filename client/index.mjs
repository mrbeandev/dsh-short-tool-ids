/** Self-contained factory: the build embeds it without bundling another React. */
export function createClientPlugin(require) {
  const React = require('react');
  const { createElement: h, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } = React;
  const namespace = 'short-tool-ids';
  const inject = ['slots', 'settingsScope'];

  function ShortIdsToggle({ provider, scope }) {
    const reader = useMemo(() => ({
      subscribe: listener => scope.subscribe(listener),
      getSnapshot: () => scope.getSnapshot(),
    }), [scope]);
    const snapshot = useSyncExternalStore(reader.subscribe, reader.getSnapshot, reader.getSnapshot);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState('');
    const busy = useRef(false);
    const mounted = useRef(true);
    useEffect(() => {
      mounted.current = true;
      return () => { mounted.current = false; };
    }, []);
    const hintId = useId();
    const errorId = useId();
    const route = provider.provider;
    const checked = Object.hasOwn(snapshot.value?.providers ?? {}, route)
      && snapshot.value.providers[route] === true;
    const writable = snapshot.status === 'ready' && snapshot.writable && snapshot.mode === 'host';

    async function change(event) {
      if (!writable || busy.current) return;
      const next = event.currentTarget.checked === true;
      busy.current = true;
      setPending(true);
      setError('');
      try {
        // Fence the rendered snapshot; the scope owns serialization, recovery,
        // and the shared mirror that refreshes every occurrence of this card.
        await scope.mutate([{ op: 'set', path: ['providers', route], value: next }], snapshot.revision);
        // This installed scope recovers {ok:false} responses without rejecting.
        // Confirm the mirrored value instead of treating settlement as success.
        const settled = scope.getSnapshot();
        if (settled.status !== 'ready' || settled.value?.providers?.[route] !== next) {
          throw new Error('Setting was not confirmed');
        }
      } catch {
        // Never render raw transport errors: only this namespace is relevant,
        // and server diagnostics can contain configuration details.
        if (mounted.current) setError('Could not save this setting. It may have changed elsewhere. Review the current value and try again.');
      } finally {
        busy.current = false;
        if (mounted.current) setPending(false);
      }
    }

    return h('div', { style: { padding: '12px 0', fontSize: '13px' } },
      h('label', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
        h('input', {
          type: 'checkbox', checked, disabled: !writable || pending,
          onChange: change, 'aria-busy': pending,
          'aria-describedby': error ? `${hintId} ${errorId}` : hintId,
        }),
        h('span', null, 'Use short tool-call IDs')),
      h('aside', {
        id: hintId, role: 'note', 'aria-label': 'About short tool-call IDs',
        style: {
          margin: '10px 0 0', padding: '10px 12px', minWidth: 0,
          border: '1px solid var(--dsw-alias-border-l3)',
          borderInlineStart: '3px solid var(--dsw-alias-state-warn-label)',
          borderRadius: '8px', maxWidth: '520px', boxSizing: 'border-box',
          fontSize: '12px', lineHeight: '18px', overflowWrap: 'anywhere',
          color: 'var(--dsw-alias-label-secondary)',
        },
      },
        h('strong', { style: {
          display: 'block', marginBottom: '4px', fontWeight: 600,
          color: 'var(--dsw-alias-state-warn-label)',
        } }, 'Experimental workaround'),
        h('p', { style: { margin: 0 } },
          'Enable only if this provider rejects long tool-call IDs. Shortens outgoing IDs to 64 characters or fewer for Chat Completions; saved history stays unchanged.'),
        h('p', { style: { margin: '4px 0 0', color: 'var(--dsw-alias-label-tertiary)' } },
          'Other protocols are not supported. Compatibility is not guaranteed.')), 
      !writable ? h('p', { role: 'status', style: { margin: '6px 0 0' } },
        snapshot.status === 'loading' ? 'Loading setting…' : 'This setting is unavailable or read-only.') : null,
      pending ? h('p', { role: 'status', style: { margin: '6px 0 0' } }, 'Saving…') : null,
      error ? h('p', { id: errorId, role: 'alert', style: { margin: '6px 0 0' } }, error) : null);
  }

  /**
   * dsh-rpm composite row: per-provider requests-per-minute limit backed by
   * the `dsh-rpm` settings namespace. Duplicated here (rather than imported)
   * because the client bundle purity gate forbids cross-plugin value imports;
   * the provider-card cell is single-occupant per settings namespace, so this
   * card renders both controls from its one seat. When dsh-rpm is not
   * installed the row hides itself.
   */
  function RpmRow({ provider, scope }) {
    const reader = useMemo(() => ({
      subscribe: listener => scope.subscribe(listener),
      getSnapshot: () => scope.getSnapshot(),
    }), [scope]);
    const snapshot = useSyncExternalStore(reader.subscribe, reader.getSnapshot, reader.getSnapshot);
    const [draft, setDraft] = useState('');
    const [dirty, setDirty] = useState(false);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState('');
    const busy = useRef(false);
    const mounted = useRef(true);
    useEffect(() => {
      mounted.current = true;
      return () => { mounted.current = false; };
    }, []);

    const route = provider.provider;
    const saved = snapshot.value?.providers?.[route];
    const writable = snapshot.status === 'ready' && snapshot.writable && snapshot.mode === 'host';

    // Follow external changes (another card of the same provider, reloads).
    useEffect(() => {
      setDraft('');
      setDirty(false);
    }, [saved, snapshot.revision, route]);

    // Namespace not served (dsh-rpm absent): stay invisible.
    // Must sit past every hook so hook order stays stable across renders.
    if (snapshot.status !== 'ready' && snapshot.status !== 'loading') return null;

    // Untouched fields track the persisted value; edits stay until saved.
    const display = dirty ? draft : (typeof saved === 'number' ? String(saved) : '');

    async function save() {
      if (!writable || busy.current) return;
      const trimmed = display.trim();
      const next = trimmed === '' ? 0 : Number(trimmed);
      if (!Number.isInteger(next) || next < 0) {
        setError('Enter 0 (unlimited) or a positive whole number.');
        return;
      }
      busy.current = true;
      setPending(true);
      setError('');
      try {
        await scope.mutate([next === 0
          ? { op: 'unset', path: ['providers', route] }
          : { op: 'set', path: ['providers', route], value: next }], snapshot.revision);
        const settled = scope.getSnapshot();
        const settledValue = settled.value?.providers?.[route] ?? 0;
        if (settled.status !== 'ready' || settledValue !== next) {
          throw new Error('Setting was not confirmed');
        }
        if (mounted.current) setDirty(false);
      } catch {
        if (mounted.current) setError('Could not save this setting. It may have changed elsewhere. Review the current value and try again.');
      } finally {
        busy.current = false;
        if (mounted.current) setPending(false);
      }
    }

    return h('div', { style: { padding: '12px 0', fontSize: '13px' } },
      h('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
        h('span', null, 'Rate limit (requests per minute)'),
        h('input', {
          type: 'number', min: 0, step: 1, placeholder: 'unlimited',
          value: display, disabled: !writable || pending,
          onChange: event => { setDraft(event.currentTarget.value); setDirty(true); },
          'aria-label': `Requests-per-minute limit for ${route}`,
          'aria-busy': pending,
          style: {
            width: '110px', padding: '4px 8px', boxSizing: 'border-box',
            border: '1px solid var(--dsw-alias-border-l3)', borderRadius: '6px',
            background: 'transparent', color: 'inherit', font: 'inherit',
          },
        }),
        h('button', {
          type: 'button', disabled: !writable || pending,
          onClick: save,
          style: {
            padding: '4px 12px', border: '1px solid var(--dsw-alias-border-l3)',
            borderRadius: '6px', background: 'transparent', color: 'inherit',
            font: 'inherit', cursor: 'pointer',
          },
        }, 'Apply')),
      h('p', { style: { margin: '6px 0 0', color: 'var(--dsw-alias-label-tertiary)', fontSize: '12px', lineHeight: '18px', maxWidth: '520px' } },
        'Requests beyond the limit are delayed until the next one-minute window instead of failing. 0 or empty = unlimited. Applies to every session immediately.'),
      snapshot.status === 'loading' ? h('p', { role: 'status', style: { margin: '6px 0 0' } }, 'Loading setting…') : null,
      pending ? h('p', { role: 'status', style: { margin: '6px 0 0' } }, 'Saving…') : null,
      error ? h('p', { role: 'alert', style: { margin: '6px 0 0' } }, error) : null);
  }

  function CardExtras({ provider, scope, rpmScope }) {
    return h('div', null,
      h(ShortIdsToggle, { provider, scope }),
      h(RpmRow, { provider, scope: rpmScope }));
  }

  function apply(ctx) {
    // bind() belongs to this calling fiber; it owns subscription/write teardown.
    const scope = ctx.settingsScope.bind({ namespace });
    // Optional dsh-rpm composite: when that plugin is installed, its
    // rate-limit row renders beneath the toggle on this card cell.
    let rpmScope;
    try {
      rpmScope = ctx.settingsScope.bind({ namespace: 'dsh-rpm' });
    } catch {
      rpmScope = undefined;
    }
    // dsh-rpm absent: register the toggle alone, preserving the original view.
    const view = rpmScope === undefined ? ShortIdsToggle : CardExtras;
    ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register({
      name: 'settings.models.provider-card',
      key: 'llm-pi-ai',
      inject: () => rpmScope === undefined ? { scope } : { scope, rpmScope },
    }, view));
  }

  return { inject, apply };
}
