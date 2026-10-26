import type { Person } from './government';
import { expectedHeirFor, rulers } from './succession';
import type { World } from './world';

export type DynastyCrownRole = 'ruler' | 'heir' | 'former';

export interface DynastyCrownTargets {
  role: DynastyCrownRole;
  countries: World['countries'];
}

export function dynastyCrownTargets(
  world: World,
  visiblePersonIds: Set<number>,
): Map<number, DynastyCrownTargets> {
  const roles = new Map<number, Map<DynastyCrownRole, Map<number, World['countries'][number]>>>();
  const add = (personId: number, role: DynastyCrownRole, country: World['countries'][number]) => {
    if (!visiblePersonIds.has(personId)) return;
    let personRoles = roles.get(personId);
    if (!personRoles) {
      personRoles = new Map();
      roles.set(personId, personRoles);
    }
    let countries = personRoles.get(role);
    if (!countries) {
      countries = new Map();
      personRoles.set(role, countries);
    }
    countries.set(country.id, country);
  };

  for (const country of world.countries) {
    const leaders = rulers(world, country);
    const currentLeaderIds = new Set(leaders.map((leader) => leader.id));
    for (const leader of leaders) add(leader.id, 'ruler', country);

    const heirs = country.modifiers.includes('consulate')
      ? leaders
        .map((leader) => expectedHeirFor(world, country, leader))
        .filter((heir): heir is Person => !!heir)
      : country.heir ? [country.heir] : [];
    for (const heir of heirs) add(heir.id, 'heir', country);

    const formerLeaderIds = new Set([
      ...country.previousRulerIds,
      ...(country.rulerTerms ?? [])
        .filter((term) => term.endYear !== null)
        .map((term) => term.personId),
    ]);
    for (const formerId of formerLeaderIds) {
      if (!currentLeaderIds.has(formerId)) add(formerId, 'former', country);
    }
  }

  const result = new Map<number, DynastyCrownTargets>();
  const priority: DynastyCrownRole[] = ['ruler', 'heir', 'former'];
  for (const [personId, personRoles] of roles) {
    const role = priority.find((candidate) => (personRoles.get(candidate)?.size ?? 0) > 0);
    if (!role) continue;
    const countries = [...(personRoles.get(role)?.values() ?? [])]
      .sort((first, second) => first.name.localeCompare(second.name, 'ru'));
    result.set(personId, { role, countries });
  }
  return result;
}

export function toggleDynastySelection(selectedPersonId: number | null, clickedPersonId: number): number | null {
  return selectedPersonId === clickedPersonId ? null : clickedPersonId;
}

export const DYNASTY_NODE_WIDTH = 152;
export const DYNASTY_NODE_HEIGHT = 74;
export const DYNASTY_NODE_GAP_X = 34;
export const DYNASTY_NODE_GAP_Y = 48;
export const DYNASTY_MARGIN_X = 22;
export const DYNASTY_MARGIN_Y = 24;

export interface DynastyViewportSize {
  width: number;
  height: number;
}

export interface DynastyPanOffset {
  x: number;
  y: number;
}

export function zoomDynastyAtViewportCenter(
  offset: DynastyPanOffset,
  viewport: DynastyViewportSize,
  currentScale: number,
  nextScale: number,
): DynastyPanOffset {
  const centerX = viewport.width / 2;
  const centerY = viewport.height / 2;
  const worldX = (centerX - offset.x) / currentScale;
  const worldY = (centerY - offset.y) / currentScale;
  return {
    x: centerX - worldX * nextScale,
    y: centerY - worldY * nextScale,
  };
}

export function centerDynastyPoint(
  point: { x: number; y: number },
  viewport: DynastyViewportSize,
  scale: number,
): DynastyPanOffset {
  return {
    x: viewport.width / 2 - point.x * scale,
    y: viewport.height / 2 - point.y * scale,
  };
}

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

  const unionFind = (ids: number[]) => {
    const parent = new Map(ids.map((id) => [id, id]));
    const find = (id: number): number => {
      const current = parent.get(id);
      if (current === undefined || current === id) return id;
      const root = find(current);
      parent.set(id, root);
      return root;
    };
    const union = (first: number, second: number) => {
      const firstRoot = find(first);
      const secondRoot = find(second);
      if (firstRoot !== secondRoot) parent.set(secondRoot, firstRoot);
    };
    return { find, union };
  };

  const generationUnion = unionFind(visibleIds);
  for (const pair of visiblePairs) generationUnion.union(pair.firstId, pair.secondId);
  const generationGroupByPerson = new Map(
    visibleIds.map((id) => [id, generationUnion.find(id)] as const),
  );
  const generationGroupMembers = new Map<number, number[]>();
  for (const id of visibleIds) {
    const groupId = generationGroupByPerson.get(id)!;
    const members = generationGroupMembers.get(groupId);
    if (members) members.push(id);
    else generationGroupMembers.set(groupId, [id]);
  }

  const generationParents = new Map<number, Set<number>>();
  const generationChildren = new Map<number, Set<number>>();
  for (const groupId of generationGroupMembers.keys()) {
    generationParents.set(groupId, new Set());
    generationChildren.set(groupId, new Set());
  }
  for (const childId of visibleIds) {
    const childGroupId = generationGroupByPerson.get(childId)!;
    for (const parentId of peopleById.get(childId)!.parents) {
      if (!visibleSet.has(parentId)) continue;
      const parentGroupId = generationGroupByPerson.get(parentId)!;
      if (parentGroupId === childGroupId) continue;
      generationParents.get(childGroupId)!.add(parentGroupId);
      generationChildren.get(parentGroupId)!.add(childGroupId);
    }
  }

  const unresolvedParents = new Map(
    [...generationParents.entries()].map(([groupId, parents]) => [groupId, parents.size]),
  );
  const generationByGroup = new Map<number, number>();
  const processedGroups = new Set<number>();
  const readyGroups = [...unresolvedParents.entries()]
    .filter(([, parentCount]) => parentCount === 0)
    .map(([groupId]) => groupId)
    .sort((a, b) => a - b);
  while (processedGroups.size < generationGroupMembers.size) {
    if (!readyGroups.length) {
      // Ошибочная или межпоколенческая связь может образовать цикл.
      // Разрываем его детерминированно, сохраняя партнёров на одной строке.
      const cycleRoot = [...generationGroupMembers.keys()]
        .filter((groupId) => !processedGroups.has(groupId))
        .sort((a, b) => a - b)[0];
      const knownParentGeneration = [...(generationParents.get(cycleRoot) ?? [])]
        .filter((parentId) => processedGroups.has(parentId))
        .map((parentId) => generationByGroup.get(parentId)! + 1);
      generationByGroup.set(cycleRoot, Math.max(0, ...knownParentGeneration));
      readyGroups.push(cycleRoot);
    }

    const groupId = readyGroups.shift()!;
    if (processedGroups.has(groupId)) continue;
    processedGroups.add(groupId);
    const groupGeneration = generationByGroup.get(groupId) ?? 0;
    for (const childGroupId of generationChildren.get(groupId) ?? []) {
      generationByGroup.set(
        childGroupId,
        Math.max(generationByGroup.get(childGroupId) ?? 0, groupGeneration + 1),
      );
      const remaining = (unresolvedParents.get(childGroupId) ?? 1) - 1;
      unresolvedParents.set(childGroupId, remaining);
      if (remaining === 0) readyGroups.push(childGroupId);
    }
  }

  const byGeneration = new Map<number, Person[]>();
  for (const id of visibleIds) {
    const person = peopleById.get(id)!;
    const generation = generationByGroup.get(generationGroupByPerson.get(id)!) ?? 0;
    const row = byGeneration.get(generation);
    if (row) row.push(person);
    else byGeneration.set(generation, [person]);
  }

  let maxRowSize = 1;
  const nodes: DynastyTreeNode[] = [];
  const xByPerson = new Map<number, number>();

  for (const [generation, row] of [...byGeneration.entries()].sort(([a], [b]) => a - b)) {
    const rowIds = row.map((person) => person.id);
    const rowIdSet = new Set(rowIds);
    const union = unionFind(rowIds);

    for (const pair of visiblePairs) {
      if (rowIdSet.has(pair.firstId) && rowIdSet.has(pair.secondId)) {
        union.union(pair.firstId, pair.secondId);
      }
    }

    const siblingGroups = new Map<string, number[]>();
    for (const person of row) {
      const visibleParents = [...new Set(person.parents.filter((parentId) => visibleSet.has(parentId)))].sort((a, b) => a - b);
      if (!visibleParents.length) continue;
      const key = visibleParents.join(':');
      const siblings = siblingGroups.get(key);
      if (siblings) siblings.push(person.id);
      else siblingGroups.set(key, [person.id]);
    }
    for (const siblings of siblingGroups.values()) {
      for (let index = 1; index < siblings.length; index += 1) union.union(siblings[0], siblings[index]);
    }

    const blocksByRoot = new Map<number, Person[]>();
    for (const person of row) {
      const root = union.find(person.id);
      const block = blocksByRoot.get(root);
      if (block) block.push(person);
      else blocksByRoot.set(root, [person]);
    }
    const blocks = [...blocksByRoot.values()];
    const blockPosition = (block: Person[]) => {
      const parentPositions = block.flatMap((person) => person.parents
        .filter((parentId) => visibleSet.has(parentId) && xByPerson.has(parentId))
        .map((parentId) => xByPerson.get(parentId)! + DYNASTY_NODE_WIDTH / 2));
      if (parentPositions.length) {
        return parentPositions.reduce((sum, value) => sum + value, 0) / parentPositions.length;
      }
      return Math.min(...block.map((person) => person.bornAt));
    };
    blocks.sort((a, b) => blockPosition(a) - blockPosition(b) ||
      Math.min(...a.map((person) => person.bornAt)) - Math.min(...b.map((person) => person.bornAt)));
    for (const block of blocks) block.sort((a, b) => a.bornAt - b.bornAt || a.id - b.id);

    const orderedBlocks = blocks.map((block) => {
      const blockIds = new Set(block.map((person) => person.id));
      const partnersById = new Map<number, number[]>();
      for (const pair of visiblePairs) {
        if (!blockIds.has(pair.firstId) || !blockIds.has(pair.secondId)) continue;
        const firstPartners = partnersById.get(pair.firstId) ?? [];
        firstPartners.push(pair.secondId);
        partnersById.set(pair.firstId, firstPartners);
        const secondPartners = partnersById.get(pair.secondId) ?? [];
        secondPartners.push(pair.firstId);
        partnersById.set(pair.secondId, secondPartners);
      }

      const ordered: Person[] = [];
      const placed = new Set<number>();
      for (const person of block) {
        if (placed.has(person.id)) continue;
        ordered.push(person);
        placed.add(person.id);
        for (const partnerId of partnersById.get(person.id) ?? []) {
          if (placed.has(partnerId)) continue;
          const partner = block.find((candidate) => candidate.id === partnerId);
          if (!partner) continue;
          ordered.push(partner);
          placed.add(partnerId);
        }
      }
      return ordered;
    });
    const orderedRow = orderedBlocks.flat();
    maxRowSize = Math.max(maxRowSize, row.length);
    orderedRow.forEach((person, index) => {
      const x = DYNASTY_MARGIN_X + index * (DYNASTY_NODE_WIDTH + DYNASTY_NODE_GAP_X);
      xByPerson.set(person.id, x);
      nodes.push({
        person,
        generation,
        x,
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
