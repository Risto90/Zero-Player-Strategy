import type { Person } from './government';

export const DYNASTY_NODE_WIDTH = 218;
export const DYNASTY_NODE_HEIGHT = 104;
export const DYNASTY_NODE_GAP_X = 44;
export const DYNASTY_NODE_GAP_Y = 86;
export const DYNASTY_MARGIN_X = 36;
export const DYNASTY_MARGIN_Y = 40;

export interface DynastyTreeNode {
  person: Person;
  generation: number;
  x: number;
  y: number;
  isDynastyMember: boolean;
  childrenIds: number[];
}

export interface DynastyTreePair {
  firstId: number;
  secondId: number;
  childrenIds: number[];
  kind: 'marriage' | 'love' | 'parents';
}

export interface DynastyTreeModel {
  nodes: DynastyTreeNode[];
  pairs: DynastyTreePair[];
  width: number;
  height: number;
}

function pairKey(firstId: number, secondId: number): string {
  return firstId < secondId ? `${firstId}:${secondId}` : `${secondId}:${firstId}`;
}

function descendantsToHide(
  roots: number[],
  childrenByParent: ReadonlyMap<number, readonly number[]>,
  hidden: Set<number>,
  protectedPartners: ReadonlySet<number>,
  partnersByPerson: ReadonlyMap<number, readonly number[]>,
): void {
  const queue = [...roots];
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index];
    if (hidden.has(id)) continue;
    hidden.add(id);
    for (const childId of childrenByParent.get(id) ?? []) queue.push(childId);
    for (const partnerId of partnersByPerson.get(id) ?? []) {
      if (!protectedPartners.has(partnerId)) queue.push(partnerId);
    }
  }
}

export function buildDynastyTree(
  people: readonly Person[],
  familyId: number,
  collapsedPeople: ReadonlySet<number> = new Set(),
  collapsedPairs: ReadonlySet<string> = new Set(),
): DynastyTreeModel {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const includedIds = new Set(people.filter((person) => person.familyId === familyId).map((person) => person.id));
  const expandedIds = new Set<number>();
  const queue = [...includedIds];
  const childrenByParent = new Map<number, number[]>();

  for (const child of people) {
    for (const parentId of new Set(child.parents)) {
      const children = childrenByParent.get(parentId);
      if (children) children.push(child.id);
      else childrenByParent.set(parentId, [child.id]);
    }
  }

  while (queue.length) {
    const personId = queue.shift()!;
    const person = peopleById.get(personId);
    if (!person || person.familyId !== familyId || expandedIds.has(personId)) continue;
    expandedIds.add(personId);

    const children = (childrenByParent.get(personId) ?? [])
      .map((childId) => peopleById.get(childId))
      .filter((child): child is Person => !!child);
    for (const child of children) {
      includedIds.add(child.id);
      const otherParentId = child.parents.find((parentId) => parentId !== personId);
      if (otherParentId !== undefined && peopleById.has(otherParentId)) includedIds.add(otherParentId);
    }

    const relatedIds = new Set([...person.spouseIds, ...person.loverIds]);
    for (const relatedId of relatedIds) {
      const related = peopleById.get(relatedId);
      if (!related) continue;
      const sharesChild = children.some((child) => child.parents.includes(relatedId));
      if (!related.alive && !sharesChild) continue;
      includedIds.add(relatedId);
    }

    for (const child of children) {
      if (child.familyId === familyId && !expandedIds.has(child.id)) queue.push(child.id);
    }
  }

  const pairsByKey = new Map<string, DynastyTreePair>();
  for (const personId of includedIds) {
    const person = peopleById.get(personId);
    if (!person) continue;
    const relatedIds = new Set([...person.spouseIds, ...person.loverIds]);
    for (const relatedId of relatedIds) {
      if (!includedIds.has(relatedId)) continue;
      const related = peopleById.get(relatedId);
      if (!related) continue;
      const sharedChildren = (childrenByParent.get(personId) ?? [])
        .filter((childId) => (childrenByParent.get(relatedId) ?? []).includes(childId));
      const isMarriage = person.spouseIds.includes(relatedId) || related.spouseIds.includes(personId);
      const isLove = person.loverIds.includes(relatedId) || related.loverIds.includes(personId);
      if (!person.alive && !related.alive && !sharedChildren.length) continue;
      const key = pairKey(personId, relatedId);
      pairsByKey.set(key, {
        firstId: Math.min(personId, relatedId),
        secondId: Math.max(personId, relatedId),
        childrenIds: sharedChildren,
        kind: isMarriage ? 'marriage' : isLove ? 'love' : 'parents',
      });
    }
  }

  for (const personId of includedIds) {
    const person = peopleById.get(personId);
    if (!person) continue;
    for (const childId of childrenByParent.get(personId) ?? []) {
      if (!includedIds.has(childId)) continue;
      const child = peopleById.get(childId);
      if (!child) continue;
      for (const otherParentId of child.parents) {
        if (otherParentId === personId || !includedIds.has(otherParentId)) continue;
        const key = pairKey(personId, otherParentId);
        const previous = pairsByKey.get(key);
        const childrenIds = new Set(previous?.childrenIds ?? []);
        childrenIds.add(childId);
        const otherParent = peopleById.get(otherParentId);
        const isMarriage = person.spouseIds.includes(otherParentId) ||
          otherParent?.spouseIds.includes(personId);
        const isLove = person.loverIds.includes(otherParentId) ||
          otherParent?.loverIds.includes(personId);
        pairsByKey.set(key, {
          firstId: Math.min(personId, otherParentId),
          secondId: Math.max(personId, otherParentId),
          childrenIds: [...childrenIds],
          kind: isMarriage ? 'marriage' : isLove ? 'love' : 'parents',
        });
      }
    }
  }

  const hiddenIds = new Set<number>();
  const partnersByPerson = new Map<number, number[]>();
  for (const pair of pairsByKey.values()) {
    const firstPartners = partnersByPerson.get(pair.firstId) ?? [];
    firstPartners.push(pair.secondId);
    partnersByPerson.set(pair.firstId, firstPartners);
    const secondPartners = partnersByPerson.get(pair.secondId) ?? [];
    secondPartners.push(pair.firstId);
    partnersByPerson.set(pair.secondId, secondPartners);
  }
  for (const personId of collapsedPeople) {
    descendantsToHide(
      childrenByParent.get(personId) ?? [],
      childrenByParent,
      hiddenIds,
      new Set([personId]),
      partnersByPerson,
    );
  }
  for (const pair of pairsByKey.values()) {
    if (!collapsedPairs.has(pairKey(pair.firstId, pair.secondId))) continue;
    descendantsToHide(
      pair.childrenIds,
      childrenByParent,
      hiddenIds,
      new Set([pair.firstId, pair.secondId]),
      partnersByPerson,
    );
  }
  const visibleIds = [...includedIds].filter((id) => !hiddenIds.has(id) && peopleById.has(id));
  const visibleSet = new Set(visibleIds);
  const visiblePairs = [...pairsByKey.values()].filter(
    (pair) => visibleSet.has(pair.firstId) && visibleSet.has(pair.secondId),
  );

  const generationCache = new Map<number, number>();
  const parentCounts = new Map<number, number>();
  const generationQueue: number[] = [];
  for (const id of visibleIds) {
    const parentCount = new Set(peopleById.get(id)!.parents.filter((parentId) => visibleSet.has(parentId))).size;
    parentCounts.set(id, parentCount);
    if (parentCount === 0) {
      generationCache.set(id, 0);
      generationQueue.push(id);
    }
  }
  for (let index = 0; index < generationQueue.length; index += 1) {
    const parentId = generationQueue[index];
    const parentGeneration = generationCache.get(parentId) ?? 0;
    for (const childId of childrenByParent.get(parentId) ?? []) {
      if (!visibleSet.has(childId)) continue;
      generationCache.set(childId, Math.max(generationCache.get(childId) ?? 0, parentGeneration + 1));
      const nextParentCount = (parentCounts.get(childId) ?? 1) - 1;
      parentCounts.set(childId, nextParentCount);
      if (nextParentCount === 0) generationQueue.push(childId);
    }
  }
  for (const id of visibleIds) {
    if (!generationCache.has(id)) generationCache.set(id, 0);
  }

  const byGeneration = new Map<number, Person[]>();
  for (const id of visibleIds) {
    const person = peopleById.get(id)!;
    const generation = generationCache.get(id) ?? 0;
    const row = byGeneration.get(generation);
    if (row) row.push(person);
    else byGeneration.set(generation, [person]);
  }

  let maxRowSize = 1;
  const nodes: DynastyTreeNode[] = [];
  for (const [generation, row] of byGeneration) {
    row.sort((a, b) => a.bornAt - b.bornAt || a.id - b.id);
    maxRowSize = Math.max(maxRowSize, row.length);
    row.forEach((person, index) => {
      nodes.push({
        person,
        generation,
        x: DYNASTY_MARGIN_X + index * (DYNASTY_NODE_WIDTH + DYNASTY_NODE_GAP_X),
        y: DYNASTY_MARGIN_Y + generation * (DYNASTY_NODE_HEIGHT + DYNASTY_NODE_GAP_Y),
        isDynastyMember: person.familyId === familyId,
        childrenIds: (childrenByParent.get(person.id) ?? []).filter((id) => includedIds.has(id)),
      });
    });
  }
  const maxGeneration = [...byGeneration.keys()].reduce((maximum, generation) => Math.max(maximum, generation), 0);

  return {
    nodes,
    pairs: visiblePairs,
    width: DYNASTY_MARGIN_X * 2 + maxRowSize * DYNASTY_NODE_WIDTH +
      Math.max(0, maxRowSize - 1) * DYNASTY_NODE_GAP_X,
    height: DYNASTY_MARGIN_Y * 2 + (maxGeneration + 1) * DYNASTY_NODE_HEIGHT +
      maxGeneration * DYNASTY_NODE_GAP_Y,
  };
}

export function dynastyPairKey(firstId: number, secondId: number): string {
  return pairKey(firstId, secondId);
}
