import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('self-hosted ntfy config enables iOS upstream and a shared-publisher burst', () => {
  const config = readFileSync(new URL('../../ntfy/server.yml', import.meta.url), 'utf8');
  assert.match(config, /^upstream-base-url: "https:\/\/ntfy\.sh"$/m);
  assert.match(config, /^visitor-request-limit-burst: 1000$/m);
  assert.match(config, /^visitor-request-limit-replenish: "1s"$/m);
});
