import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildForest, formatPoints, longestPath, pointsFor } from './invite-tree.ts';

const U = (id: string, invitedBy: string | null) => ({ id, invitedBy });
const chain = [U('a', null), U('b', 'a'), U('c', 'b'), U('d', 'c'), U('e', 'a')];

test('points halve per level', () => {
  assert.equal(pointsFor(chain, 'a'), 1 + 1 + 0.5 + 0.25);
  assert.equal(pointsFor(chain, 'd'), 0);
});

test('forest sizes and direct counts', () => {
  const [a] = buildForest(chain);
  assert.equal(a.size, 4);
  assert.equal(a.direct, 2);
  assert.equal(a.children[0].depth, 1);
  assert.deepEqual(a.children.map((n) => n.user.id), ['b', 'e']);
  assert.equal(a.points, 1 + 1 + 0.5 + 0.25);
});

test('unknown parent and cycles become roots, no hang', () => {
  const f = buildForest([U('x', 'ghost'), U('p', 'q'), U('q', 'p'), U('r', null)]);
  assert.deepEqual(f.map((n) => n.user.id).sort(), ['p', 'r', 'x']);
  const p = f.find((n) => n.user.id === 'p')!;
  assert.deepEqual(p.children.map((n) => n.user.id), ['q']);
});

test('longest path', () => {
  assert.deepEqual([...longestPath(buildForest(chain))], ['a', 'b', 'c', 'd']);
});

test('longest path keeps the first path on a tie', () => {
  const forest = buildForest([U('a', null), U('b', 'a'), U('c', null), U('d', 'c')]);
  assert.deepEqual([...longestPath(forest)], ['a', 'b']);
});

test('formatPoints', () => {
  assert.equal(formatPoints(3.75), '3,8');
  assert.equal(formatPoints(2), '2');
  assert.equal(formatPoints(0), '0');
});
