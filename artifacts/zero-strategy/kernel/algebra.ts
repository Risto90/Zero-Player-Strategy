/**
 * Пакетная алгебра множеств, таблиц и взвешенных мер.
 *
 * Здесь намеренно нет пользовательских предикатов-функций: запрос целиком
 * описывается данными и исполняется одним вызовом, без переходов JS на строку.
 */

export type AlgebraValue = string | number | boolean | bigint | null;
export type AlgebraRow = readonly AlgebraValue[];
export interface AlgebraTable {
  readonly columns: readonly string[];
  readonly rows: readonly AlgebraRow[];
  /** Столбец неотрицательной массы для режима «мера». */
  readonly weightColumn?: string;
}

type RelationName = string;
type Mode = 'set' | 'multiset' | 'measure';
type CompareOperator = 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'in' | 'notIn' | 'isNull' | 'notNull';
export type AlgebraPredicate =
  | { op: CompareOperator; column: string; value?: AlgebraValue | readonly AlgebraValue[] }
  | { op: 'and'; predicates: readonly AlgebraPredicate[] }
  | { op: 'or'; predicates: readonly AlgebraPredicate[] }
  | { op: 'not'; predicate: AlgebraPredicate };

export type AlgebraOperation =
  | { op: 'set'; id: string; mode: Mode; kind: 'union' | 'intersection' | 'difference' | 'symmetricDifference' | 'complement'; left: RelationName; right?: RelationName; universe?: RelationName; keyColumns?: readonly string[] }
  | { op: 'measureSum'; id: string; inputs: readonly RelationName[]; keyColumns: readonly string[]; weightColumn: string }
  | { op: 'contains' | 'subset' | 'equal' | 'disjoint'; id: string; left: RelationName; right: RelationName; keyColumns?: readonly string[] }
  | { op: 'filter'; id: string; input: RelationName; where: AlgebraPredicate }
  | { op: 'partition'; id: string; input: RelationName; where: AlgebraPredicate }
  | { op: 'project'; id: string; input: RelationName; columns: readonly { from: string; as?: string }[] }
  | { op: 'product'; id: string; left: RelationName; right: RelationName; columns?: readonly Projection[] }
  | { op: 'join'; id: string; left: RelationName; right: RelationName; on: readonly { left: string; right: string }[]; columns: readonly Projection[] }
  | { op: 'group'; id: string; input: RelationName; by: readonly string[]; aggregates: readonly Aggregate[] }
  | { op: 'choose'; id: string; input: RelationName; keyColumns: readonly string[]; weightColumn: string; seed: number; priorities?: readonly { columns: readonly string[]; rank: number }[]; reference?: RelationName }
  | { op: 'take' | 'remove' | 'transfer'; id: string; input: RelationName; destination?: RelationName; reference?: RelationName; keyColumns: readonly string[]; weightColumn: string; amount: number; priorities?: readonly { columns: readonly string[]; rank: number }[] };

type Projection = { from: 'left' | 'right'; column: string; as: string };
type Aggregate =
  | { op: 'count'; as: string; column?: string }
  | { op: 'sum' | 'min' | 'max' | 'mean'; as: string; column: string };

export interface AlgebraQuery {
  readonly inputs: Readonly<Record<RelationName, AlgebraTable>>;
  readonly operations: readonly AlgebraOperation[];
}

export interface AlgebraQueryResult {
  readonly tables: Readonly<Record<string, AlgebraTable>>;
  readonly values: Readonly<Record<string, boolean>>;
  readonly selections: Readonly<Record<string, { selected: AlgebraTable; remaining: AlgebraTable; destination?: AlgebraTable }>>;
}

const MAX_ROWS = 10_000_000;

/** Запускает составной запрос в порядке операций и возвращает все именованные результаты. */
export function runAlgebraQuery(query: AlgebraQuery): AlgebraQueryResult {
  if (!query || typeof query !== 'object' || !query.inputs || !Array.isArray(query.operations)) {
    throw new TypeError('Некорректный дескриптор запроса алгебры');
  }
  const relations = new Map<string, AlgebraTable>();
  for (const [name, input] of Object.entries(query.inputs)) {
    assertName(name, 'имя входной таблицы');
    relations.set(name, validateTable(input));
  }
  const tables: Record<string, AlgebraTable> = Object.create(null);
  const values: Record<string, boolean> = Object.create(null);
  const selections: Record<string, { selected: AlgebraTable; remaining: AlgebraTable; destination?: AlgebraTable }> = Object.create(null);
  const operations: readonly AlgebraOperation[] = query.operations;
  const resultIds = new Set<string>();

  for (const operation of operations) {
    assertName(operation?.id, 'имя результата');
    if (relations.has(operation.id) || resultIds.has(operation.id)) {
      throw new TypeError(`Повторяется имя результата «${operation.id}»`);
    }
    resultIds.add(operation.id);
    switch (operation.op) {
      case 'set': {
        const left = requireRelation(relations, operation.left);
        const right = operation.kind === 'complement'
          ? requireRelation(relations, operation.universe ?? '')
          : requireRelation(relations, operation.right ?? '');
        const result = setOperation(operation.mode, operation.kind, left, right, operation.keyColumns);
        relations.set(operation.id, result);
        tables[operation.id] = result;
        break;
      }
      case 'measureSum': {
        const inputs = operation.inputs.map((name) => requireRelation(relations, name));
        const result = addMeasures(inputs, operation.keyColumns, operation.weightColumn);
        relations.set(operation.id, result);
        tables[operation.id] = result;
        break;
      }
      case 'contains':
      case 'subset':
      case 'equal':
      case 'disjoint': {
        const result = compareSets(operation.op, requireRelation(relations, operation.left),
          requireRelation(relations, operation.right), operation.keyColumns);
        values[operation.id] = result;
        break;
      }
      case 'filter': {
        const input = requireRelation(relations, operation.input);
        validatePredicate(operation.where, input);
        const result = makeTable(input.columns, input.rows.filter((row) => testPredicate(operation.where, input, row)), input.weightColumn);
        relations.set(operation.id, result);
        tables[operation.id] = result;
        break;
      }
      case 'partition': {
        const input = requireRelation(relations, operation.input);
        validatePredicate(operation.where, input);
        const yes: AlgebraRow[] = [], no: AlgebraRow[] = [];
        for (const row of input.rows) (testPredicate(operation.where, input, row) ? yes : no).push(row);
        const selected = makeTable(input.columns, yes, input.weightColumn);
        const remaining = makeTable(input.columns, no, input.weightColumn);
        relations.set(`${operation.id}:true`, selected);
        relations.set(`${operation.id}:false`, remaining);
        tables[`${operation.id}:true`] = selected;
        tables[`${operation.id}:false`] = remaining;
        selections[operation.id] = { selected, remaining };
        break;
      }
      case 'project': {
        const input = requireRelation(relations, operation.input);
        const indices = operation.columns.map(({ from }) => columnIndex(input, from));
        const columns = operation.columns.map(({ from, as }) => as ?? from);
        assertUniqueColumns(columns);
        const weightIndex = input.weightColumn ? input.columns.indexOf(input.weightColumn) : -1;
        const weightColumn = weightIndex >= 0 ? columns[indices.indexOf(weightIndex)] : undefined;
        const result = makeTable(columns, input.rows.map((row) => indices.map((index) => row[index])), weightColumn);
        relations.set(operation.id, result);
        tables[operation.id] = result;
        break;
      }
      case 'product':
      case 'join': {
        const left = requireRelation(relations, operation.left);
        const right = requireRelation(relations, operation.right);
        const projections = operation.columns ?? [
          ...left.columns.map((column) => ({ from: 'left' as const, column, as: `left.${column}` })),
          ...right.columns.map((column) => ({ from: 'right' as const, column, as: `right.${column}` })),
        ];
        const result = joinTables(left, right, operation.op === 'join' ? operation.on : [],
          projections, operation.op === 'product');
        relations.set(operation.id, result);
        tables[operation.id] = result;
        break;
      }
      case 'group': {
        const result = groupTable(requireRelation(relations, operation.input), operation.by, operation.aggregates);
        relations.set(operation.id, result);
        tables[operation.id] = result;
        break;
      }
      case 'choose': {
        const input = requireRelation(relations, operation.input);
        const selected = chooseMeasure(input, operation.keyColumns, operation.weightColumn, operation.seed,
          operation.priorities ?? [], operation.reference ? requireRelation(relations, operation.reference) : undefined);
        tables[operation.id] = selected;
        relations.set(operation.id, selected);
        break;
      }
      case 'take':
      case 'remove':
      case 'transfer': {
        const source = requireRelation(relations, operation.input);
        const split = takeMeasure(source, operation.keyColumns, operation.weightColumn, operation.amount,
          operation.priorities ?? [], operation.reference ? requireRelation(relations, operation.reference) : undefined);
        let destination: AlgebraTable | undefined;
        if (operation.op === 'transfer') {
          if (!operation.destination) throw new TypeError('Перенос требует целевую таблицу');
          destination = addMeasures([requireRelation(relations, operation.destination), split.selected],
            operation.keyColumns, operation.weightColumn);
        }
        const selected = split.selected;
        const remaining = split.remaining;
        relations.set(operation.id, remaining);
        relations.set(`${operation.id}:selected`, selected);
        relations.set(`${operation.id}:remaining`, remaining);
        if (destination) relations.set(`${operation.id}:destination`, destination);
        tables[`${operation.id}:selected`] = selected;
        tables[`${operation.id}:remaining`] = remaining;
        if (destination) tables[`${operation.id}:destination`] = destination;
        selections[operation.id] = { selected, remaining, ...(destination ? { destination } : {}) };
        break;
      }
      default:
        throw new TypeError(`Неизвестная операция алгебры: ${(operation as { op?: string }).op ?? 'не задана'}`);
    }
  }
  return { tables, values, selections };
}

function validateTable(table: AlgebraTable): AlgebraTable {
  if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) {
    throw new TypeError('Таблица должна содержать столбцы и строки');
  }
  assertUniqueColumns(table.columns);
  if (table.rows.length > MAX_ROWS) throw new RangeError('Таблица превышает лимит строк');
  const weightIndex = table.weightColumn === undefined ? -1 : columnIndex(table, table.weightColumn);
  const rows = table.rows.map((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== table.columns.length) {
      throw new TypeError(`Строка ${rowIndex} имеет неверную ширину`);
    }
    row.forEach((value, index) => {
      if (value !== null && typeof value !== 'string' && typeof value !== 'boolean' &&
          typeof value !== 'bigint' && (typeof value !== 'number' || !Number.isFinite(value))) {
        throw new TypeError(`Недопустимое значение в строке ${rowIndex}, столбце ${table.columns[index]}`);
      }
    });
    if (weightIndex >= 0 && (typeof row[weightIndex] !== 'number' || row[weightIndex] < 0)) {
      throw new RangeError(`Масса в строке ${rowIndex} должна быть конечным неотрицательным числом`);
    }
    return [...row];
  });
  return makeTable(table.columns, rows, table.weightColumn);
}

function makeTable(columns: readonly string[], rows: readonly AlgebraRow[], weightColumn?: string): AlgebraTable {
  return { columns: [...columns], rows: rows.map((row) => [...row]), ...(weightColumn ? { weightColumn } : {}) };
}

function assertName(value: string, label: string): void {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} должно быть непустой строкой`);
}

function assertUniqueColumns(columns: readonly string[]): void {
  if (!Array.isArray(columns) || columns.some((column) => typeof column !== 'string' || !column.trim()) ||
      new Set(columns).size !== columns.length) throw new TypeError('Имена столбцов должны быть непустыми и уникальными');
}

function columnIndex(table: AlgebraTable, name: string): number {
  const index = table.columns.indexOf(name);
  if (index < 0) throw new TypeError(`Неизвестный столбец «${name}»`);
  return index;
}

function requireRelation(relations: Map<string, AlgebraTable>, name: string): AlgebraTable {
  const table = relations.get(name);
  if (!table) throw new TypeError(`Неизвестная таблица «${name}»`);
  return table;
}

function keyOf(row: AlgebraRow, indices: readonly number[]): string {
  return JSON.stringify(indices.map((index) => encodeValue(row[index])));
}

function encodeValue(value: AlgebraValue): unknown {
  if (typeof value === 'bigint') return { bigint: value.toString() };
  if (value === null) return ['null'];
  return [typeof value, value];
}

function compareValue(a: AlgebraValue, b: AlgebraValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'bigint' && typeof b === 'bigint') return a < b ? -1 : a > b ? 1 : 0;
  const aa = `${typeof a}:${String(a)}`, bb = `${typeof b}:${String(b)}`;
  return aa < bb ? -1 : aa > bb ? 1 : 0;
}

function compareRows(a: AlgebraRow, b: AlgebraRow, indices: readonly number[]): number {
  for (const index of indices) {
    const difference = compareValue(a[index], b[index]);
    if (difference) return difference;
  }
  return 0;
}

function normalizeColumns(table: AlgebraTable, requested?: readonly string[]): { columns: readonly string[]; indices: readonly number[] } {
  const columns = requested ?? table.columns;
  if (!columns.length || new Set(columns).size !== columns.length) {
    throw new TypeError('Ключ должен содержать неповторяющиеся столбцы');
  }
  return { columns, indices: columns.map((column) => columnIndex(table, column)) };
}

function assertSameColumns(left: AlgebraTable, right: AlgebraTable): void {
  if (left.columns.length !== right.columns.length || left.columns.some((column, index) => column !== right.columns[index])) {
    throw new TypeError('Таблицы должны иметь одинаковые столбцы и порядок');
  }
}

function setOperation(mode: Mode, kind: Extract<AlgebraOperation, { op: 'set' }>['kind'],
  left: AlgebraTable, right: AlgebraTable, keyColumns?: readonly string[]): AlgebraTable {
  if (!['set', 'multiset', 'measure'].includes(mode)) throw new TypeError('Неизвестная семантика множества');
  if (!['union', 'intersection', 'difference', 'symmetricDifference', 'complement'].includes(kind)) {
    throw new TypeError('Неизвестная операция множества');
  }
  assertSameColumns(left, right);
  if (mode === 'measure') {
    const weightColumn = left.weightColumn;
    if (!weightColumn || right.weightColumn !== weightColumn) throw new TypeError('Мере нужны одинаковые столбцы массы');
    const dimensions = keyColumns ?? left.columns.filter((column) => column !== weightColumn);
    const { columns, indices } = normalizeColumns(left, dimensions);
    if (dimensions.includes(weightColumn)) throw new TypeError('Столбец массы не может входить в ключ меры');
    if (columns.length !== left.columns.length - 1 ||
        left.columns.some((column) => column !== weightColumn && !columns.includes(column))) {
      throw new TypeError('Операции над мерой сохраняют все совместные измерения; проекция выполняется отдельно');
    }
    const a = measureIndex(left, indices, weightColumn), b = measureIndex(right, indices, weightColumn);
    const keys = [...new Set([...a.keys(), ...b.keys()])].sort((leftKey, rightKey) => {
      const leftRow = a.get(leftKey)?.row ?? b.get(leftKey)!.row;
      const rightRow = a.get(rightKey)?.row ?? b.get(rightKey)!.row;
      return compareRows(leftRow, rightRow, indices);
    });
    if (keys.length > MAX_ROWS) throw new RangeError('Результат меры превышает лимит строк');
    const rows = keys.flatMap((key) => {
      const av = a.get(key), bv = b.get(key);
      const aw = av?.weight ?? 0, bw = bv?.weight ?? 0;
      let weight = 0;
      if (kind === 'union') weight = Math.max(aw, bw);
      else if (kind === 'intersection') weight = Math.min(aw, bw);
      else if (kind === 'difference' || kind === 'complement') weight = Math.max(0, (kind === 'complement' ? bw : aw) - (kind === 'complement' ? aw : bw));
      else weight = Math.abs(aw - bw);
      if (!weight) return [];
      const source = av?.row ?? bv!.row;
      const row = [...indices.map((index) => source[index]), weight];
      return [row];
    });
    return makeTable([...columns, weightColumn], rows, weightColumn);
  }
  if (left.weightColumn || right.weightColumn) throw new TypeError('Обычные множества не могут неявно терять столбец массы');
  const { columns, indices } = normalizeColumns(left, keyColumns);
  const a = countKeys(left.rows, indices), b = countKeys(right.rows, indices);
  const rowByKey = new Map<string, AlgebraRow>();
  for (const row of [...left.rows, ...right.rows]) rowByKey.set(keyOf(row, indices), row);
  const keys = [...new Set([...a.keys(), ...b.keys()])].sort();
  const rows: AlgebraRow[] = [];
  for (const key of keys) {
    const ac = a.get(key) ?? 0, bc = b.get(key) ?? 0;
    const count = mode === 'set'
      ? (kind === 'union' ? Number(ac > 0 || bc > 0)
        : kind === 'intersection' ? Number(ac > 0 && bc > 0)
          : kind === 'difference' || kind === 'complement' ? Number((kind === 'complement' ? bc > 0 && ac === 0 : ac > 0 && bc === 0))
            : Number((ac > 0) !== (bc > 0)))
      : kind === 'union' ? Math.max(ac, bc)
        : kind === 'intersection' ? Math.min(ac, bc)
          : kind === 'difference' || kind === 'complement'
            ? Math.max(0, (kind === 'complement' ? bc : ac) - (kind === 'complement' ? ac : bc))
            : Math.abs(ac - bc);
    const representative = rowByKey.get(key)!;
    const projected = indices.map((index) => representative[index]);
    if (rows.length + count > MAX_ROWS) throw new RangeError('Результат множества превышает лимит строк');
    for (let index = 0; index < count; index += 1) rows.push(projected);
  }
  rows.sort((a, b) => compareRows(a, b, indices.map((_, index) => index)));
  return makeTable(columns, rows);
}

function countKeys(rows: readonly AlgebraRow[], indices: readonly number[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = keyOf(row, indices);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function compareSets(kind: 'contains' | 'subset' | 'equal' | 'disjoint',
  left: AlgebraTable, right: AlgebraTable, keyColumns?: readonly string[]): boolean {
  const { indices: leftIndices, columns } = normalizeColumns(left, keyColumns);
  const rightIndices = columns.map((column) => columnIndex(right, column));
  const a = new Set(left.rows.map((row) => keyOf(row, leftIndices)));
  const b = new Set(right.rows.map((row) => keyOf(row, rightIndices)));
  if (kind === 'contains') return right.rows.length === 1 && a.has(keyOf(right.rows[0], rightIndices));
  if (kind === 'subset') return [...a].every((key) => b.has(key));
  if (kind === 'equal') return a.size === b.size && [...a].every((key) => b.has(key));
  return ![...a].some((key) => b.has(key));
}

function measureIndex(table: AlgebraTable, keyIndices: readonly number[], weightColumn: string) {
  const weightIndex = columnIndex(table, weightColumn);
  const result = new Map<string, { row: AlgebraRow; weight: number }>();
  for (const row of table.rows) {
    const key = keyOf(row, keyIndices), weight = row[weightIndex] as number;
    const existing = result.get(key);
    if (existing) existing.weight = stableSum([existing.weight, weight]);
    else result.set(key, { row, weight });
  }
  return result;
}

function addMeasures(tables: readonly AlgebraTable[], keyColumns: readonly string[], weightColumn: string): AlgebraTable {
  const first = tables[0];
  if (!first) throw new TypeError('Сложение меры требует хотя бы одной таблицы');
  if (first.weightColumn !== weightColumn) throw new TypeError('Столбец массы не совпадает с описанием таблицы');
  const { indices } = normalizeColumns(first, keyColumns);
  const totals = new Map<string, { row: AlgebraRow; weights: number[] }>();
  const weightIndex = columnIndex(first, weightColumn);
  for (const table of tables) {
    assertSameColumns(first, table);
    if (table.weightColumn !== weightColumn) throw new TypeError('Столбец массы не совпадает');
    for (const row of table.rows) {
      const key = keyOf(row, indices), value = totals.get(key);
      if (value) value.weights.push(row[weightIndex] as number);
      else totals.set(key, { row, weights: [row[weightIndex] as number] });
    }
  }
  if (totals.size > MAX_ROWS) throw new RangeError('Результат суммы меры превышает лимит строк');
  const rows = [...totals.values()].map(({ row, weights }) => {
    const result = [...row];
    result[weightIndex] = stableSum(weights);
    return result;
  }).filter((row) => (row[weightIndex] as number) > 0)
    .sort((a, b) => compareRows(a, b, indices));
  return makeTable(first.columns, rows, weightColumn);
}

function stableSum(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => Math.abs(a) - Math.abs(b) || a - b);
  let sum = 0, correction = 0;
  for (const value of sorted) {
    const adjusted = value - correction;
    const next = sum + adjusted;
    correction = (next - sum) - adjusted;
    sum = next;
  }
  if (!Number.isFinite(sum)) throw new RangeError('Переполнение суммы меры');
  return sum;
}

function validatePredicate(predicate: AlgebraPredicate, table: AlgebraTable): void {
  if (!predicate || typeof predicate !== 'object') throw new TypeError('Некорректный предикат');
  if (predicate.op === 'and' || predicate.op === 'or') {
    if (!Array.isArray(predicate.predicates)) throw new TypeError('Составной предикат должен содержать список условий');
    predicate.predicates.forEach((part) => validatePredicate(part, table));
    return;
  }
  if (predicate.op === 'not') return validatePredicate(predicate.predicate, table);
  if (!['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'notIn', 'isNull', 'notNull'].includes(predicate.op)) {
    throw new TypeError('Неизвестный оператор предиката');
  }
  columnIndex(table, predicate.column);
  if (predicate.op === 'isNull' || predicate.op === 'notNull') return;
  if (predicate.op === 'in' || predicate.op === 'notIn') {
    if (!Array.isArray(predicate.value)) throw new TypeError('Оператор in требует список значений');
    predicate.value.forEach(assertAlgebraValue);
    return;
  }
  assertAlgebraValue(predicate.value);
  if (['lt', 'lte', 'gt', 'gte'].includes(predicate.op) &&
      typeof predicate.value !== 'number' && typeof predicate.value !== 'string' && typeof predicate.value !== 'bigint') {
    throw new TypeError('Сравнение порядка требует число, строку или целое bigint');
  }
}

function assertAlgebraValue(value: unknown): asserts value is AlgebraValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'bigint' ||
      (typeof value === 'number' && Number.isFinite(value))) return;
  throw new TypeError('Предикат содержит недопустимое значение');
}

function testPredicate(predicate: AlgebraPredicate, table: AlgebraTable, row: AlgebraRow): boolean {
  if (predicate.op === 'and') return predicate.predicates.every((part) => testPredicate(part, table, row));
  if (predicate.op === 'or') return predicate.predicates.some((part) => testPredicate(part, table, row));
  if (predicate.op === 'not') return !testPredicate(predicate.predicate, table, row);
  const value = row[columnIndex(table, predicate.column)];
  if (predicate.op === 'isNull') return value === null;
  if (predicate.op === 'notNull') return value !== null;
  if (predicate.op === 'in' || predicate.op === 'notIn') {
    const found = (predicate.value as readonly AlgebraValue[]).some((candidate) => compareValue(value, candidate) === 0 && typeof value === typeof candidate);
    return predicate.op === 'in' ? found : !found;
  }
  const comparison = compareValue(value, predicate.value as AlgebraValue);
  switch (predicate.op) {
    case 'eq': return typeof value === typeof predicate.value && comparison === 0;
    case 'ne': return typeof value !== typeof predicate.value || comparison !== 0;
    case 'lt': return orderedComparison(value, predicate.value as AlgebraValue) < 0;
    case 'lte': return orderedComparison(value, predicate.value as AlgebraValue) <= 0;
    case 'gt': return orderedComparison(value, predicate.value as AlgebraValue) > 0;
    case 'gte': return orderedComparison(value, predicate.value as AlgebraValue) >= 0;
    default: return false;
  }
}

function orderedComparison(left: AlgebraValue, right: AlgebraValue): number {
  if (typeof left !== typeof right || (typeof left !== 'number' && typeof left !== 'string' && typeof left !== 'bigint')) {
    throw new TypeError('Сравнение порядка требует значения одного числового или строкового типа');
  }
  return compareValue(left, right);
}

function joinTables(left: AlgebraTable, right: AlgebraTable, on: readonly { left: string; right: string }[],
  projections: readonly Projection[], cartesian: boolean): AlgebraTable {
  if (!cartesian && !on.length) throw new TypeError('Соединение требует хотя бы один ключ');
  const leftKeys = on.map(({ left: column }) => columnIndex(left, column));
  const rightKeys = on.map(({ right: column }) => columnIndex(right, column));
  const leftColumns = projections.map((projection) => {
    if (!projection.as) throw new TypeError('Проекции соединения должны иметь имя');
    return columnIndex(projection.from === 'left' ? left : right, projection.column);
  });
  const names = projections.map(({ as }) => as);
  assertUniqueColumns(names);
  const rightBuckets = new Map<string, AlgebraRow[]>();
  for (const row of right.rows) {
    const key = cartesian ? '' : keyOf(row, rightKeys);
    const bucket = rightBuckets.get(key) ?? [];
    bucket.push(row);
    rightBuckets.set(key, bucket);
  }
  if (cartesian) {
    const estimate = left.rows.length * right.rows.length;
    if (!Number.isSafeInteger(estimate) || estimate > MAX_ROWS) throw new RangeError('Произведение превышает лимит результата');
  }
  const rows: AlgebraRow[] = [];
  for (const leftRow of left.rows) {
    const matches = rightBuckets.get(cartesian ? '' : keyOf(leftRow, leftKeys)) ?? [];
    if (rows.length + matches.length > MAX_ROWS) throw new RangeError('Соединение превышает лимит результата');
    for (const rightRow of matches) {
      rows.push(projections.map((projection, index) =>
        projection.from === 'left' ? leftRow[leftColumns[index]] : rightRow[leftColumns[index]],
      ));
    }
  }
  return makeTable(names, rows);
}

function groupTable(input: AlgebraTable, by: readonly string[], aggregates: readonly Aggregate[]): AlgebraTable {
  const groupIndices = by.map((column) => columnIndex(input, column));
  const aggregateIndices = aggregates.map((aggregate) =>
    aggregate.column === undefined ? -1 : columnIndex(input, aggregate.column));
  aggregates.forEach((aggregate, index) => {
    if (aggregate.op !== 'count' && input.rows.some((row) => typeof row[aggregateIndices[index]] !== 'number')) {
      throw new TypeError(`Агрегат «${aggregate.as}» требует числовой столбец`);
    }
  });
  const groups = new Map<string, { key: AlgebraRow; rows: AlgebraRow[] }>();
  for (const row of input.rows) {
    const key = keyOf(row, groupIndices);
    const group = groups.get(key);
    if (group) group.rows.push(row);
    else groups.set(key, { key: groupIndices.map((index) => row[index]), rows: [row] });
  }
  const columns = [...by, ...aggregates.map(({ as }) => as)];
  assertUniqueColumns(columns);
  const rows = [...groups.values()].sort((a, b) => compareRows(a.key, b.key, a.key.map((_, index) => index)))
    .map(({ key, rows: members }) => [
      ...key,
      ...aggregates.map((aggregate, index) => aggregateValue(aggregate, members, aggregateIndices[index])),
    ]);
  return makeTable(columns, rows);
}

function aggregateValue(aggregate: Aggregate, rows: readonly AlgebraRow[], index: number): AlgebraValue {
  if (aggregate.op === 'count') return aggregate.column
    ? rows.filter((row) => row[index] !== null).length
    : rows.length;
  const values = rows.map((row) => row[index]).filter((value): value is number => typeof value === 'number');
  if (!values.length) return null;
  if (aggregate.op === 'sum') return stableSum(values);
  if (aggregate.op === 'mean') {
    const scale = values.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
    return scale === 0 ? 0 : scale * (stableSum(values.map((value) => value / scale)) / values.length);
  }
  return values.reduce((best, value) => aggregate.op === 'min' ? Math.min(best, value) : Math.max(best, value));
}

function takeMeasure(source: AlgebraTable, keyColumns: readonly string[], weightColumn: string, amount: number,
  priorities: readonly { columns: readonly string[]; rank: number }[], reference?: AlgebraTable) {
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError('Количество извлечения должно быть конечным и неотрицательным');
  if (source.weightColumn !== weightColumn || (reference && reference.weightColumn !== weightColumn)) {
    throw new TypeError('Извлечение требует согласованный столбец массы');
  }
  assertCompleteMeasureKey(source, keyColumns, weightColumn);
  if (reference) assertCompleteMeasureKey(reference, keyColumns, weightColumn);
  if (!reference && priorities.length) throw new TypeError('Приоритеты извлечения требуют таблицу сравнения');
  source = addMeasures([source], keyColumns, weightColumn);
  if (reference) reference = addMeasures([reference], keyColumns, weightColumn);
  const keyIndices = keyColumns.map((column) => columnIndex(source, column));
  const weightIndex = columnIndex(source, weightColumn);
  const priorityIndices = priorities.map(({ columns, rank }) => {
    if (!Number.isFinite(rank) || !Array.isArray(columns) || !columns.length ||
        columns.some((column) => !keyColumns.includes(column))) {
      throw new TypeError('Приоритет должен содержать конечный ранг и ключевые измерения');
    }
    return { indices: columns.map((column) => columnIndex(source, column)), rank };
  }).sort((a, b) => a.rank - b.rank);
  const priorityKeys = priorityIndices.map(({ indices }) => {
    const keys = new Set<string>();
    if (!reference) return keys;
    const refIndices = indices.map((index) => columnIndex(reference, source.columns[index]));
    for (const row of reference.rows) if ((row[columnIndex(reference, weightColumn)] as number) > 0) keys.add(keyOf(row, refIndices));
    return keys;
  });
  const indexed = source.rows.map((row) => {
    const key = keyOf(row, keyIndices);
    let rank = priorityIndices.findIndex(({ indices }, index) =>
      priorityKeys[index].has(keyOf(row, indices)));
    if (!reference && priorityIndices.length) rank = 0;
    return { row: [...row], key, rank: rank < 0 ? priorityIndices.length : rank, weight: row[weightIndex] as number };
  });
  const target = Math.min(amount, stableSum(indexed.map(({ weight }) => weight)));
  let left = target;
  const selectedWeights = new Map<number, number>();
  const ranks = [...new Set(indexed.map(({ rank }) => rank))].sort((a, b) => a - b);
  for (const rank of ranks) {
    if (left <= 0) break;
    const group = indexed.map((entry, index) => ({ ...entry, index })).filter((entry) => entry.rank === rank);
    const total = stableSum(group.map(({ weight }) => weight));
    const taken = Math.min(left, total);
    if (!taken || !total) continue;
    const ratio = taken / total;
    let allocated = 0;
    group.forEach(({ index, weight }, offset) => {
      const value = offset === group.length - 1 ? taken - allocated : weight * ratio;
      selectedWeights.set(index, Math.min(weight, Math.max(0, value)));
      allocated += value;
    });
    left -= taken;
  }
  const selected: AlgebraRow[] = [], remaining: AlgebraRow[] = [];
  indexed.forEach(({ row, weight }, index) => {
    const taken = selectedWeights.get(index) ?? 0;
    if (taken > 0) {
      const selectedRow = [...row]; selectedRow[weightIndex] = taken; selected.push(selectedRow);
    }
    if (weight - taken > 0) {
      const remainingRow = [...row]; remainingRow[weightIndex] = weight - taken; remaining.push(remainingRow);
    }
  });
  return {
    selected: makeTable(source.columns, selected, weightColumn),
    remaining: makeTable(source.columns, remaining, weightColumn),
  };
}

function chooseMeasure(source: AlgebraTable, keyColumns: readonly string[], weightColumn: string,
  seed: number, priorities: readonly { columns: readonly string[]; rank: number }[], reference?: AlgebraTable): AlgebraTable {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    throw new RangeError('Начальное значение выбора должно быть uint32');
  }
  const weightIndex = columnIndex(source, weightColumn);
  if (source.weightColumn !== weightColumn || (reference && reference.weightColumn !== weightColumn)) {
    throw new TypeError('Выбор меры требует согласованный столбец массы');
  }
  assertCompleteMeasureKey(source, keyColumns, weightColumn);
  if (reference) assertCompleteMeasureKey(reference, keyColumns, weightColumn);
  if (!reference && priorities.length) throw new TypeError('Приоритеты выбора требуют таблицу сравнения');
  source = addMeasures([source], keyColumns, weightColumn);
  if (reference) reference = addMeasures([reference], keyColumns, weightColumn);
  const keyIndices = keyColumns.map((column) => columnIndex(source, column));
  const refKeys = priorities.map(({ columns }) => {
    const keys = new Set<string>();
    if (!reference) return keys;
    const refIndices = columns.map((column) => columnIndex(reference, column));
    const refWeightIndex = columnIndex(reference, weightColumn);
    for (const row of reference.rows) if ((row[refWeightIndex] as number) > 0) keys.add(keyOf(row, refIndices));
    return keys;
  });
  const sortedPriorities = priorities.map((priority, index) => {
    if (!Number.isFinite(priority.rank) || !Array.isArray(priority.columns) || !priority.columns.length ||
        priority.columns.some((column) => !keyColumns.includes(column))) {
      throw new TypeError('Некорректное описание приоритета выбора');
    }
    return {
      ...priority,
      indices: priority.columns.map((column) => columnIndex(source, column)),
      keySet: refKeys[index],
    };
  }).sort((a, b) => a.rank - b.rank);
  let candidates = source.rows.filter((row) => (row[weightIndex] as number) > 0);
  if (!candidates.length) return makeTable(source.columns, [], weightColumn);
  const priorityOf = (row: AlgebraRow) => {
    const index = sortedPriorities.findIndex((priority) =>
      !reference || priority.keySet.has(keyOf(row, priority.indices)));
    return index < 0 ? sortedPriorities.length : index;
  };
  if (sortedPriorities.length) {
    const best = Math.min(...candidates.map(priorityOf));
    candidates = candidates.filter((row) => priorityOf(row) === best);
  }
  candidates.sort((a, b) => compareRows(a, b, keyIndices));
  const total = stableSum(candidates.map((row) => row[weightIndex] as number));
  const state = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
  const draw = ((state >>> 0) / 0x1_0000_0000) * total;
  let running = 0;
  for (const row of candidates) {
    running = stableSum([running, row[weightIndex] as number]);
    if (draw < running) return makeTable(source.columns, [row], weightColumn);
  }
  return makeTable(source.columns, [candidates[candidates.length - 1]], weightColumn);
}

function assertCompleteMeasureKey(table: AlgebraTable, keyColumns: readonly string[], weightColumn: string): void {
  if (table.weightColumn !== weightColumn || !Array.isArray(keyColumns) ||
      keyColumns.length !== table.columns.length - 1 ||
      keyColumns.includes(weightColumn) ||
      table.columns.some((column) => column !== weightColumn && !keyColumns.includes(column))) {
    throw new TypeError('Операция над группами требует ключ из всех совместных измерений');
  }
}
