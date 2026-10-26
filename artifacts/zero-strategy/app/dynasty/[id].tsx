import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import colors, { fonts } from '@/constants/colors';
import type { Person } from '@/game/government';
import {
  buildDynastyTree,
  dynastyPairKey,
  DYNASTY_NODE_HEIGHT,
  DYNASTY_NODE_WIDTH,
} from '@/game/dynastyTree';
import { useGameSnapshot } from '@/game/useGame';
import type { Game } from '@/game/game';
import { continueSavedGame, currentGame } from '@/game/session';

const c = colors.light;

export default function DynastyPage() {
  const { id: rawId, person: rawFocusId } = useLocalSearchParams<{ id: string; person?: string }>();
  const [game, setGame] = useState<Game | null>(() => currentGame());
  const [loadError, setLoadError] = useState('');
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (game) return;
    let active = true;
    continueSavedGame()
      .then((loaded) => {
        if (!active) return;
        if (loaded) setGame(loaded);
        else setLoadError('Сохранённая игра не найдена.');
      })
      .catch(() => {
        if (active) setLoadError('Не удалось открыть сохранённую игру.');
      });
    return () => {
      active = false;
    };
  }, [game]);

  if (!game) {
    return (
      <View style={[styles.screen, styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.note}>{loadError || 'Загружаю династию…'}</Text>
        {!!loadError && <BackButton />}
      </View>
    );
  }

  const requestedFamilyId = Number(rawId);
  const focusId = Number(rawFocusId);
  const focusPerson = game.world.people.find((person) => person.id === focusId);
  const hasRequestedFamily = game.world.people.some((person) => person.familyId === requestedFamilyId);
  const familyId = hasRequestedFamily ? requestedFamilyId : focusPerson?.familyId ?? requestedFamilyId;
  if (!Number.isFinite(familyId)) {
    return (
      <View style={[styles.screen, styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.title}>Династия не найдена</Text>
        <BackButton />
      </View>
    );
  }

  return <DynastyTree game={game} familyId={familyId} focusId={focusPerson?.familyId === familyId ? focusId : undefined} />;
}

function BackButton() {
  return (
    <Pressable onPress={() => router.back()} style={styles.back}>
      <Feather name="arrow-left" size={18} color={c.foreground} />
      <Text style={styles.backText}>Назад</Text>
    </Pressable>
  );
}

function DynastyTree({ game, familyId, focusId }: { game: Game; familyId: number; focusId?: number }) {
  useGameSnapshot(game);
  const insets = useSafeAreaInsets();
  const [collapsedPeople, setCollapsedPeople] = useState<Set<number>>(() => new Set());
  const [collapsedPairs, setCollapsedPairs] = useState<Set<string>>(() => new Set());
  const [selectedPersonId, setSelectedPersonId] = useState<number | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const panOffset = useRef({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });
  const centered = useRef(false);

  const familyMembers = game.world.people.filter((person) => person.familyId === familyId);
  const model = useMemo(
    () => buildDynastyTree(game.world.people, familyId, collapsedPeople, collapsedPairs),
    [game.world.version, familyId, collapsedPeople, collapsedPairs],
  );
  const nodesById = useMemo(() => new Map(model.nodes.map((node) => [node.person.id, node])), [model.nodes]);
  const familyName = familyMembers[0]?.familyName ?? model.nodes.find((node) => node.isDynastyMember)?.person.familyName ?? 'Династия';
  const safeTop = insets.top + (Platform.OS === 'web' ? 67 : 0);
  const safeBottom = insets.bottom + (Platform.OS === 'web' ? 34 : 0);

  const centerOnPerson = (width: number, height: number) => {
    if (centered.current || !focusId || width <= 0 || height <= 0) return;
    const node = nodesById.get(focusId);
    if (!node) return;
    const next = {
      x: width / 2 - node.x - DYNASTY_NODE_WIDTH / 2,
      y: height / 2 - node.y - DYNASTY_NODE_HEIGHT / 2,
    };
    panOffset.current = next;
    pan.setValue(next);
    centered.current = true;
  };

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) + Math.abs(gesture.dy) > 5,
    onPanResponderGrant: () => {
      panStart.current = panOffset.current;
    },
    onPanResponderMove: (_event, gesture) => {
      const next = { x: panStart.current.x + gesture.dx, y: panStart.current.y + gesture.dy };
      panOffset.current = next;
      pan.setValue(next);
    },
    onPanResponderRelease: () => {
      panStart.current = panOffset.current;
    },
    onPanResponderTerminate: () => {
      panStart.current = panOffset.current;
    },
  }), [pan]);

  const togglePerson = (personId: number) => {
    setCollapsedPeople((previous) => {
      const next = new Set(previous);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });
  };
  const togglePair = (firstId: number, secondId: number) => {
    const key = dynastyPairKey(firstId, secondId);
    setCollapsedPairs((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const openPerson = (personId: number) => {
    router.push({ pathname: '/person/[id]', params: { id: String(personId) } });
  };
  const openDynasty = (person: Person) => {
    router.push({
      pathname: '/dynasty/[id]',
      params: { id: String(person.familyId), person: String(person.id) },
    });
  };

  const onViewportLayout = (width: number, height: number) => {
    setViewport({ width, height });
    centerOnPerson(width, height);
  };

  const singleParentChildren = new Map<number, (typeof model.nodes)[number][]>();
  for (const childNode of model.nodes) {
    const parentIds = [...new Set(childNode.person.parents)].filter((parentId) => nodesById.has(parentId));
    if (parentIds.length !== 1) continue;
    const siblings = singleParentChildren.get(parentIds[0]);
    if (siblings) siblings.push(childNode);
    else singleParentChildren.set(parentIds[0], [childNode]);
  }

  return (
    <View style={[styles.screen, { paddingTop: safeTop, paddingBottom: safeBottom }]}>
      <View style={styles.header}>
        <BackButton />
        <Text style={styles.eyebrow}>РОДОСЛОВНАЯ</Text>
      </View>
      <View style={styles.titleRow}>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{familyName}</Text>
          <Text style={styles.subtitle}>Династия · {familyMembers.length} персонажей</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Вернуться к выбранному персонажу"
          onPress={() => {
            centered.current = false;
            centerOnPerson(viewport.width, viewport.height);
          }}
          style={styles.centerButton}
        >
          <Feather name="crosshair" size={18} color={c.foreground} />
        </Pressable>
      </View>
      {model.nodes.length ? (
        <>
          <Text style={styles.hint}>Перетаскивайте древо пальцем или мышью. Нажмите − или +, чтобы свернуть или раскрыть ветвь.</Text>
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendLine, styles.marriageLine]} />
              <Text style={styles.legendText}>брак</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendLine, styles.loveLine]} />
              <Text style={styles.legendText}>любовная связь</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendLine, styles.parentLine]} />
              <Text style={styles.legendText}>родство по детям</Text>
            </View>
          </View>
          <View
            style={styles.viewport}
            onLayout={(event) => onViewportLayout(event.nativeEvent.layout.width, event.nativeEvent.layout.height)}
            {...responder.panHandlers}
          >
            <Animated.View
              style={[
                styles.treeCanvas,
                { width: Math.max(viewport.width, model.width), height: Math.max(viewport.height, model.height) },
                { transform: pan.getTranslateTransform() },
              ]}
            >
              <Svg
                pointerEvents="none"
                width={Math.max(viewport.width, model.width)}
                height={Math.max(viewport.height, model.height)}
                style={StyleSheet.absoluteFill}
              >
                {model.pairs.map((pair) => {
                  const first = nodesById.get(pair.firstId);
                  const second = nodesById.get(pair.secondId);
                  if (!first || !second) return null;
                  const leftNode = first.x <= second.x ? first : second;
                  const rightNode = first.x <= second.x ? second : first;
                  const pairChildren = pair.childrenIds
                    .map((id) => nodesById.get(id))
                    .filter((node): node is (typeof model.nodes)[number] => !!node);
                  const selected = selectedPersonId === pair.firstId ||
                    selectedPersonId === pair.secondId ||
                    (selectedPersonId !== null && pair.childrenIds.includes(selectedPersonId));
                  const relationshipStartX = leftNode.x + DYNASTY_NODE_WIDTH;
                  const relationshipEndX = rightNode.x;
                  const relationshipStartY = leftNode.y + DYNASTY_NODE_HEIGHT / 2;
                  const relationshipEndY = rightNode.y + DYNASTY_NODE_HEIGHT / 2;
                  const relationshipColor = selected
                    ? c.primary
                    : pair.kind === 'love' ? c.primary : pair.kind === 'marriage' ? c.accent : c.border;
                  const paths = [
                    <Path
                      key={`pair-${pair.firstId}-${pair.secondId}`}
                      d={`M ${relationshipStartX} ${relationshipStartY} C ${(relationshipStartX + relationshipEndX) / 2} ${relationshipStartY}, ${(relationshipStartX + relationshipEndX) / 2} ${relationshipEndY}, ${relationshipEndX} ${relationshipEndY}`}
                      stroke={relationshipColor}
                      strokeWidth={selected ? 5 : pair.kind === 'parents' ? 2 : 3}
                      strokeDasharray={pair.kind === 'love' ? '5 4' : undefined}
                      fill="none"
                    />,
                  ];
                  if (pairChildren.length) {
                    const parentBottom = Math.max(first.y, second.y) + DYNASTY_NODE_HEIGHT;
                    const branchY = Math.min(...pairChildren.map((node) => node.y)) - 24;
                    const parentCenterX = (first.x + second.x + DYNASTY_NODE_WIDTH) / 2;
                    const childCenters = pairChildren.map((node) => node.x + DYNASTY_NODE_WIDTH / 2);
                    const firstChildX = Math.min(...childCenters);
                    const lastChildX = Math.max(...childCenters);
                    let branchPath = `M ${parentCenterX} ${parentBottom} V ${branchY} H ${firstChildX} M ${firstChildX} ${branchY} V ${pairChildren[0].y}`;
                    for (const childNode of pairChildren.slice(1)) {
                      const childX = childNode.x + DYNASTY_NODE_WIDTH / 2;
                      branchPath += ` M ${childX} ${branchY} V ${childNode.y}`;
                    }
                    if (firstChildX !== lastChildX) {
                      branchPath += ` M ${firstChildX} ${branchY} H ${lastChildX}`;
                    }
                    paths.push(
                      <Path
                        key={`children-${pair.firstId}-${pair.secondId}`}
                        d={branchPath}
                        stroke={selected ? c.primary : c.border}
                        strokeWidth={selected ? 4 : 2}
                        fill="none"
                      />,
                    );
                  }
                  return paths;
                })}
                {[...singleParentChildren.entries()].map(([parentId, children]) => {
                  const parentNode = nodesById.get(parentId);
                  if (!parentNode || !children.length) return null;
                  const selected = selectedPersonId === parentId ||
                    (selectedPersonId !== null && children.some((node) => node.person.id === selectedPersonId));
                  const childCenters = children.map((node) => node.x + DYNASTY_NODE_WIDTH / 2);
                  const firstChildX = Math.min(...childCenters);
                  const lastChildX = Math.max(...childCenters);
                  const parentCenterX = parentNode.x + DYNASTY_NODE_WIDTH / 2;
                  const parentBottom = parentNode.y + DYNASTY_NODE_HEIGHT;
                  const branchY = Math.min(...children.map((node) => node.y)) - 24;
                  let path = `M ${parentCenterX} ${parentBottom} V ${branchY} H ${firstChildX}`;
                  if (firstChildX !== lastChildX) path += ` H ${lastChildX}`;
                  for (const childNode of children) {
                    path += ` M ${childNode.x + DYNASTY_NODE_WIDTH / 2} ${branchY} V ${childNode.y}`;
                  }
                  return (
                    <Path
                      key={`single-parent-${parentId}`}
                      d={path}
                      stroke={selected ? c.primary : c.border}
                      strokeWidth={selected ? 4 : 2}
                      fill="none"
                    />
                  );
                })}
              </Svg>
              {model.nodes.map((node) => {
                const person = node.person;
                const externalChild = !node.isDynastyMember &&
                  person.parents.some((parentId) => nodesById.get(parentId)?.isDynastyMember);
                const partnerBranchKeys = !node.isDynastyMember && !externalChild
                  ? model.pairs
                    .filter((pair) => pair.childrenIds.length > 0 &&
                      (pair.firstId === person.id || pair.secondId === person.id) &&
                      nodesById.get(pair.firstId === person.id ? pair.secondId : pair.firstId)?.isDynastyMember)
                    .map((pair) => dynastyPairKey(pair.firstId, pair.secondId))
                  : [];
                const hasBranchControl = node.isDynastyMember
                  ? node.childrenIds.length > 0
                  : partnerBranchKeys.length > 0;
                const collapsed = node.isDynastyMember
                  ? collapsedPeople.has(person.id)
                  : partnerBranchKeys.length > 0 && partnerBranchKeys.every((key) => collapsedPairs.has(key));
                return (
                  <Pressable
                    key={person.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Выбрать связи персонажа ${person.name}`}
                    onPress={() => setSelectedPersonId(person.id)}
                    style={[
                      styles.personCard,
                      { left: node.x, top: node.y, width: DYNASTY_NODE_WIDTH, minHeight: DYNASTY_NODE_HEIGHT },
                      node.isDynastyMember ? styles.dynastyPersonCard : styles.partnerPersonCard,
                      selectedPersonId === person.id && styles.selectedPersonCard,
                    ]}
                  >
                    <View style={styles.personTitleRow}>
                      <Pressable
                        onPress={(event) => {
                          event.stopPropagation();
                          openPerson(person.id);
                        }}
                        style={styles.personNameButton}
                      >
                        <Text numberOfLines={2} style={styles.personName}>{person.name}</Text>
                      </Pressable>
                      <MaterialCommunityIcons
                        name={person.gender === 'female' ? 'gender-female' : 'gender-male'}
                        size={17}
                        color={c.primary}
                      />
                      {hasBranchControl && (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={collapsed ? `Развернуть потомков ${person.name}` : `Свернуть потомков ${person.name}`}
                          onPress={(event) => {
                            event.stopPropagation();
                            if (node.isDynastyMember) {
                              togglePerson(person.id);
                            } else {
                              for (const key of partnerBranchKeys) {
                                const [firstId, secondId] = key.split(':').map(Number);
                                togglePair(firstId, secondId);
                              }
                            }
                          }}
                          style={styles.foldButton}
                        >
                          <Feather name={collapsed ? 'plus' : 'minus'} size={15} color={c.foreground} />
                        </Pressable>
                      )}
                    </View>
                    <Text style={styles.personLife}>
                      {person.alive ? `${person.age} лет` : `${Math.floor(person.bornAt)}—${person.deathYear ?? '…'}`}
                    </Text>
                    {!node.isDynastyMember && (
                      <Text style={styles.relationType}>
                        {person.parents.some((parentId) => nodesById.get(parentId)?.isDynastyMember)
                          ? 'Ребёнок династии'
                          : 'Партнёр'}
                      </Text>
                    )}
                    {externalChild && (
                      <Pressable
                        accessibilityRole="link"
                        accessibilityLabel={`Открыть династию ${person.familyName}`}
                        onPress={(event) => {
                          event.stopPropagation();
                          openDynasty(person);
                        }}
                        style={styles.externalDynastyButton}
                      >
                        <Feather name="arrow-down" size={15} color={c.accent} />
                      </Pressable>
                    )}
                  </Pressable>
                );
              })}
            </Animated.View>
          </View>
        </>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.note}>Персонажи этой династии не найдены.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.background },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16 },
  header: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, borderBottomWidth: 2, borderColor: c.foreground },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  backText: { fontFamily: fonts.sansMedium, fontSize: 13, color: c.foreground },
  eyebrow: { marginLeft: 'auto', fontFamily: fonts.sansSemiBold, fontSize: 10, letterSpacing: 1.6, color: c.primary },
  titleRow: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  titleBlock: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.display, fontSize: 30, color: c.foreground },
  subtitle: { fontFamily: fonts.sans, fontSize: 13, color: c.mutedForeground },
  centerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.border, backgroundColor: c.card },
  hint: { paddingHorizontal: 18, paddingBottom: 8, fontFamily: fonts.sans, fontSize: 11, color: c.mutedForeground },
  legend: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingBottom: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendLine: { width: 18, borderTopWidth: 2 },
  marriageLine: { borderColor: c.accent, borderTopWidth: 3 },
  loveLine: { borderColor: c.primary, borderStyle: 'dashed' },
  parentLine: { borderColor: c.border },
  legendText: { fontFamily: fonts.sans, fontSize: 10, color: c.mutedForeground },
  viewport: { flex: 1, overflow: 'hidden', backgroundColor: c.card },
  treeCanvas: { position: 'absolute', left: 0, top: 0 },
  personCard: { position: 'absolute', padding: 9, gap: 4, backgroundColor: c.background, borderWidth: 1, borderColor: c.border, borderRadius: 4, zIndex: 1 },
  dynastyPersonCard: { borderTopWidth: 3, borderTopColor: c.primary },
  partnerPersonCard: { borderTopWidth: 3, borderTopColor: c.accent },
  selectedPersonCard: { borderColor: c.primary, borderWidth: 2, backgroundColor: c.card, shadowColor: c.foreground, shadowOpacity: 0.18, shadowRadius: 5, elevation: 4 },
  personTitleRow: { minHeight: 27, flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  personNameButton: { flex: 1 },
  personName: { fontFamily: fonts.sansSemiBold, fontSize: 12, lineHeight: 16, color: c.accent, textDecorationLine: 'underline' },
  personLife: { fontFamily: fonts.sans, fontSize: 11, color: c.foreground },
  relationType: { fontFamily: fonts.sans, fontSize: 10, color: c.mutedForeground },
  foldButton: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: c.muted },
  externalDynastyButton: { width: 28, height: 22, alignItems: 'center', justifyContent: 'center', marginTop: -2 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  note: { fontFamily: fonts.sans, fontSize: 13, color: c.mutedForeground },
});
