import { Element, TreeNode } from './types';

export function buildTree(elements: Element[]): TreeNode[] {
  const containers = elements.filter((e) => e.type === 'container');
  const others = elements.filter((e) => e.type !== 'container');

  const isInside = (child: Element, parent: Element) =>
    child.boundingBox[0] >= parent.boundingBox[0] &&
    child.boundingBox[1] >= parent.boundingBox[1] &&
    child.boundingBox[2] <= parent.boundingBox[2] &&
    child.boundingBox[3] <= parent.boundingBox[3];

  const area = (e: Element) =>
    (e.boundingBox[2] - e.boundingBox[0]) *
    (e.boundingBox[3] - e.boundingBox[1]);

  const childrenMap = new Map<string, Element[]>();
  containers.forEach((c) => childrenMap.set(c.id, []));

  const orphans: Element[] = [];
  for (const el of others) {
    const parent = containers
      .filter((c) => isInside(el, c))
      .sort((a, b) => area(a) - area(b))[0];
    if (parent) {
      childrenMap.get(parent.id)!.push(el);
    } else {
      orphans.push(el);
    }
  }

  const containerParentMap = new Map<string, string>();
  for (const c of containers) {
    const parent = containers
      .filter((p) => p.id !== c.id && isInside(c, p))
      .sort((a, b) => area(a) - area(b))[0];
    if (parent) containerParentMap.set(c.id, parent.id);
  }

  const rootContainers = containers.filter(
    (c) => !containerParentMap.has(c.id),
  );

  function buildNode(container: Element): TreeNode {
    const directChildren = childrenMap.get(container.id) || [];
    const nestedContainers = containers
      .filter((c) => containerParentMap.get(c.id) === container.id)
      .map(buildNode);
    return {
      element: container,
      children: [
        ...nestedContainers,
        ...directChildren.map((e) => ({ element: e, children: [] })),
      ],
    };
  }

  return [
    ...rootContainers.map(buildNode),
    ...orphans.map((e) => ({ element: e, children: [] })),
  ];
}
