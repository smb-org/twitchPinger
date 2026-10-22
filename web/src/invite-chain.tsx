import { useMemo, useState } from 'preact/hooks';
import { buildForest, formatPoints, longestPath } from '../../src/invite-tree.ts';
import type { TreeNode } from '../../src/invite-tree.ts';
import type { AdminUser } from './api.ts';

const ICICLE_ROW = 28;
const ICICLE_HEIGHT = ICICLE_ROW * 6;

interface TreeRow {
  node: TreeNode<AdminUser>;
  depth: number;
  connectors: boolean[];
  last: boolean;
}

interface IcicleBlock {
  node: TreeNode<AdminUser>;
  left: number;
  width: number;
}

function descendants(root: TreeNode<AdminUser>) {
  const result: TreeNode<AdminUser>[] = [];
  const stack = [root];
  while (stack.length) {
    const node = stack.pop()!;
    result.push(node);
    for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
  }
  return result;
}

function deepestDepth(roots: TreeNode<AdminUser>[]) {
  let deepest = 0;
  const stack = [...roots];
  while (stack.length) {
    const node = stack.pop()!;
    deepest = Math.max(deepest, node.depth);
    stack.push(...node.children);
  }
  return deepest;
}

function icicleBlocks(roots: TreeNode<AdminUser>[], total: number): IcicleBlock[] {
  if (!total) return [];
  const blocks: IcicleBlock[] = [];
  let start = 0;

  function add(node: TreeNode<AdminUser>, left: number, width: number) {
    blocks.push({ node, left, width });
    let childStart = left;
    for (const child of node.children) {
      const childWidth = width * ((child.size + 1) / node.size);
      add(child, childStart, childWidth);
      childStart += childWidth;
    }
  }

  for (const root of roots) {
    for (const child of root.children) {
      const width = (child.size + 1) / total;
      add(child, start / total, width);
      start += child.size + 1;
    }
  }
  return blocks;
}

function visibleRows(roots: TreeNode<AdminUser>[], expanded: Set<string>, baseDepth: number): TreeRow[] {
  const rows: TreeRow[] = [];
  const stack = roots.map((node, index) => ({
    node,
    depth: 0,
    connectors: [] as boolean[],
    last: index === roots.length - 1,
  })).reverse();

  while (stack.length) {
    const item = stack.pop()!;
    rows.push({ ...item, depth: item.node.depth - baseDepth });
    if (!expanded.has(item.node.user.id)) continue;
    for (let i = item.node.children.length - 1; i >= 0; i--) {
      const child = item.node.children[i];
      stack.push({
        node: child,
        depth: item.depth + 1,
        connectors: item.depth === 0 ? [] : [...item.connectors, !item.last],
        last: i === item.node.children.length - 1,
      });
    }
  }
  return rows;
}

export function InviteChain({ users, error = false }: { users: AdminUser[] | undefined; error?: boolean }) {
  const roots = useMemo(() => users ? buildForest(users) : [], [users]);
  const longest = useMemo(() => longestPath(roots), [roots]);
  const byId = useMemo(() => new Map(roots.flatMap(descendants).map((node) => [node.user.id, node])), [roots]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedState, setExpandedState] = useState<Set<string> | null>(null);

  const allNodes = useMemo(() => roots.flatMap(descendants), [roots]);
  const totalInvited = roots.reduce((sum, root) => sum + root.size, 0);
  const blocks = useMemo(() => icicleBlocks(roots, totalInvited), [roots, totalInvited]);
  const selected = selectedId ? byId.get(selectedId) : undefined;
  const visibleRoots = selected ? [selected] : roots;
  const baseDepth = selected?.depth ?? 0;
  const visibleNodes = useMemo(() => visibleRoots.flatMap(descendants), [visibleRoots]);
  const defaultExpanded = useMemo(() => new Set(visibleNodes
    .filter((node) => node.children.length > 0 && (node.depth - baseDepth < 2 || longest.has(node.user.id)))
    .map((node) => node.user.id)), [visibleNodes, baseDepth, longest]);
  const expanded = expandedState ?? defaultExpanded;
  const rows = useMemo(() => visibleRows(visibleRoots, expanded, baseDepth), [visibleRoots, expanded, baseDepth]);
  const maxPoints = Math.max(0, ...rows.map(({ node }) => node.points));
  const depth = selected ? deepestDepth([selected]) - selected.depth : deepestDepth(roots);
  const count = selected ? selected.size + 1 : allNodes.length;
  const chartDepth = Math.max(1, deepestDepth(roots));
  const chartHeight = Math.max(ICICLE_HEIGHT, chartDepth * ICICLE_ROW);
  const allButtonLabel = 'Alle';

  function select(id: string | null) {
    setSelectedId(id);
    setExpandedState(null);
  }

  function toggle(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedState(next);
  }

  return (
    <section class="invite-chain" aria-labelledby="invite-chain-title">
      <header class="admin-section-head">
        <h2 id="invite-chain-title">Einladungskette</h2>
      </header>

      <div class="invite-icicle-scroll" role="group" aria-label="Übersicht der Einladungskette">
        {!users ? (
          <div class="invite-icicle-placeholder" aria-hidden="true">
            {Array.from({ length: 6 }, (_, index) => <span key={index} />)}
          </div>
        ) : blocks.length === 0 ? (
          <p class="invite-icicle-empty">Noch keine Einladungen.</p>
        ) : (
          <div class="invite-icicle-content" style={{ height: `${chartHeight}px`, minWidth: `max(100%, ${totalInvited * 12 + 36}px)` }}>
            {Array.from({ length: chartDepth }, (_, index) => (
              <span key={index} class="invite-depth-label mono" style={{ top: `${index * ICICLE_ROW}px` }}>E{index + 1}</span>
            ))}
            <div class="invite-icicle-canvas" style={{ height: `${chartHeight}px` }}>
              {blocks.map(({ node, left, width }) => (
                <button
                  key={node.user.id}
                  class={`invite-icicle-block${longest.has(node.user.id) ? ' longest' : ''}${selectedId === node.user.id ? ' selected' : ''}`}
                  style={{ left: `${left * 100}%`, width: `${width * 100}%`, top: `${(node.depth - 1) * ICICLE_ROW}px` }}
                  title={`@${node.user.login} · ${node.size + 1} Nutzer im Ast`}
                  aria-label={`@${node.user.login} – Ast mit ${node.size} weiteren Nutzern`}
                  aria-pressed={selectedId === node.user.id}
                  onClick={() => select(node.user.id)}
                >
                  <span class="invite-icicle-label">{node.user.login}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div class="invite-tree-head">
        <div class="invite-tree-summary">
          <span class="mono muted" aria-live="polite">{users ? `${count} Nutzer · ${depth} Ebenen tief` : error ? 'Einladungskette konnte nicht geladen werden.' : 'Lade Einladungskette …'}</span>
          <button class="btn ghost sm invite-all" disabled={!selected} onClick={() => select(null)}>{allButtonLabel}</button>
        </div>
        <div class="invite-tree-columns mono muted">
          <span>direkt</span><span>Ast</span><span>Punkte</span>
        </div>
      </div>

      <div class="invite-tree-scroll">
        {!users ? (
          <div class="invite-tree-placeholder" aria-hidden="true">
            {Array.from({ length: 6 }, (_, index) => <span key={index} />)}
          </div>
        ) : (
          <ul class="invite-tree-list" aria-label="Einladungskette">
            {rows.map(({ node, depth: rowDepth, connectors, last }) => {
              const open = expanded.has(node.user.id);
              const pointsWidth = maxPoints ? `${node.points / maxPoints * 100}%` : '0%';
              const guide = `${connectors.map((continues) => continues ? '│ ' : '  ').join('')}${rowDepth > 0 ? (last ? '└ ' : '├ ') : ''}`;
              return (
                <li class={`invite-tree-row${node.user.locked ? ' locked' : ''}`} key={node.user.id}>
                  <span class="invite-tree-person">
                    {rowDepth > 0 && <span class="invite-tree-guide" aria-hidden="true">{guide}</span>}
                    {node.children.length > 0
                      ? <button class="invite-tree-toggle" aria-expanded={open} aria-label={`Äste von @${node.user.login} ${open ? 'zuklappen' : 'aufklappen'}`} onClick={() => toggle(node.user.id)}>{open ? '▾' : '▸'}</button>
                      : <span class="invite-tree-toggle-spacer" aria-hidden="true" />}
                    <span class={`invite-tree-login mono${node.depth > 0 && longest.has(node.user.id) && !node.user.locked ? ' longest' : ''}`} title={`@${node.user.login}`}>@{node.user.login}</span>
                    {node.user.locked && <span class="invite-tree-locked muted">gesperrt</span>}
                  </span>
                  <span class="invite-tree-metrics mono">
                    <span class="invite-tree-direct"><span class="sr">direkt </span>{node.direct}</span>
                    <span class="invite-tree-size"><span class="sr">Ast </span>{node.size}</span>
                    <span class="invite-tree-points">
                      <span class="invite-points-bar" aria-hidden="true"><span style={{ width: pointsWidth }} /></span>
                      <span><span class="sr">Punkte </span>{formatPoints(node.points)}</span>
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
