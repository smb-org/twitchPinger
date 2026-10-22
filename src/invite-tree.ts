export interface TreeUser {
  id: string;
  invitedBy: string | null;
}

export interface TreeNode<U extends TreeUser> {
  user: U;
  depth: number;
  children: TreeNode<U>[];
  size: number;
  direct: number;
  points: number;
}

export function buildForest<U extends TreeUser>(users: U[]): TreeNode<U>[] {
  const nodes = users.map((user): TreeNode<U> => ({
    user,
    depth: 0,
    children: [],
    size: 0,
    direct: 0,
    points: 0,
  }));
  const byId = new Map(nodes.map((node) => [node.user.id, node]));
  const inputOrder = new Map(nodes.map((node, index) => [node, index]));
  const cycleRoots = new Set<TreeNode<U>>();
  const visited = new Set<TreeNode<U>>();

  for (const node of nodes) {
    if (visited.has(node)) continue;
    const path: TreeNode<U>[] = [];
    const positions = new Map<TreeNode<U>, number>();
    let current: TreeNode<U> | undefined = node;

    while (current && !visited.has(current) && !positions.has(current)) {
      positions.set(current, path.length);
      path.push(current);
      current = current.user.invitedBy === null ? undefined : byId.get(current.user.invitedBy);
    }

    if (current && positions.has(current)) {
      const cycle = path.slice(positions.get(current));
      cycleRoots.add(cycle.reduce((first, candidate) =>
        inputOrder.get(candidate)! < inputOrder.get(first)! ? candidate : first,
      ));
    }
    for (const entry of path) visited.add(entry);
  }

  const roots: TreeNode<U>[] = [];
  for (const node of nodes) {
    const parent = node.user.invitedBy === null ? undefined : byId.get(node.user.invitedBy);
    if (!parent || cycleRoots.has(node)) roots.push(node);
    else parent.children.push(node);
  }

  const order: TreeNode<U>[] = [];
  const stack = [...roots].reverse().map((node) => ({ node, depth: 0 }));
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    node.depth = depth;
    order.push(node);
    for (let i = node.children.length - 1; i >= 0; i--) {
      stack.push({ node: node.children[i], depth: depth + 1 });
    }
  }

  for (let i = order.length - 1; i >= 0; i--) {
    const node = order[i];
    node.direct = node.children.length;
    node.size = node.children.reduce((size, child) => size + child.size + 1, 0);
    node.points = node.children.reduce((points, child) => points + 1 + child.points / 2, 0);
  }

  return roots;
}

export function pointsFor(users: TreeUser[], id: string): number {
  const roots = buildForest(users);
  const stack = [...roots];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.user.id === id) return node.points;
    stack.push(...node.children);
  }
  return 0;
}

export function longestPath<U extends TreeUser>(roots: TreeNode<U>[]): Set<string> {
  const parents = new Map<TreeNode<U>, TreeNode<U> | undefined>();
  const stack = roots.slice().reverse().map((node) => ({ node, depth: 0 }));
  let deepest: TreeNode<U> | undefined;
  let deepestDepth = -1;

  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (depth > deepestDepth) {
      deepest = node;
      deepestDepth = depth;
    }
    for (let i = node.children.length - 1; i >= 0; i--) {
      const child = node.children[i];
      parents.set(child, node);
      stack.push({ node: child, depth: depth + 1 });
    }
  }

  const path: string[] = [];
  while (deepest) {
    path.push(deepest.user.id);
    deepest = parents.get(deepest);
  }
  return new Set(path.reverse());
}

export function formatPoints(p: number): string {
  return Number.isInteger(p) ? String(p) : p.toFixed(1).replace('.', ',');
}
