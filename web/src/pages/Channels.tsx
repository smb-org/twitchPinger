import { AddChannelForm, Suggestions, useChannels } from '../channels.tsx';
import { meStore } from '../api.ts';
import { ConfirmButton, LoadError, PageHead, Placeholder, useTitle } from '../ui.tsx';
import { health } from '../shell.tsx';

export function Channels() {
  useTitle('Channels');
  const c = useChannels();
  const hs = health.use();
  const me = meStore.get()!;
  const joining = !!hs.h && hs.h.joined < hs.h.desired;
  return (
    <div class="page">
      <PageHead title="Channels">
        <span class="mono muted">{c.channels?.length ?? '–'} von {me.limits.MAX_CHANNELS_PER_USER}</span>
      </PageHead>
      <AddChannelForm c={c} />
      <div class="cols2">
        <section aria-label="Deine Channels">
          <h2>Deine Channels</h2>
          {!c.channels && !c.error && <Placeholder rows={3} />}
          {!c.channels && c.error && <LoadError error={c.error} retry={c.reload} />}
          {c.channels?.length === 0 && <p class="muted">Noch keine Channels. Deine gefolgten Channels:</p>}
          <ul class="list">
            {c.channels?.map((ch) => (
              <li class="row" key={ch.id}>
                <span class="mono grow">{ch.login}</span>
                <span class="muted state">{c.fresh.includes(ch.id) && joining ? 'trete bei…' : ''}</span>
                <ConfirmButton label="Entfernen" onConfirm={() => c.remove(ch)} />
              </li>
            ))}
          </ul>
        </section>
        <section aria-label="Gefolgte Channels">
          <h2>Gefolgte Channels</h2>
          <Suggestions c={c} />
        </section>
      </div>
    </div>
  );
}
