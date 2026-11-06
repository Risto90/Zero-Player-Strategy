import { getBinaryMathKernel } from './runtime';

export type AlgebraValue = string | number | boolean | bigint | null;
export type AlgebraRow = readonly AlgebraValue[];

export interface AlgebraTable {
  readonly columns: readonly string[];
  readonly rows: readonly AlgebraRow[];
  readonly weightColumn?: string;
}

type RelationName = string;
type Mode = 'set' | 'multiset' | 'measure';
type CompareOperator =
  | 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'in' | 'notIn'
  | 'isNull' | 'notNull';

export type AlgebraPredicate =
  | { op: CompareOperator; column: string; value?: AlgebraValue | readonly AlgebraValue[] }
  | { op: 'and'; predicates: readonly AlgebraPredicate[] }
  | { op: 'or'; predicates: readonly AlgebraPredicate[] }
  | { op: 'not'; predicate: AlgebraPredicate };

type Projection = { from: 'left' | 'right'; column: string; as: string };
type Aggregate =
  | { op: 'count'; as: string; column?: string }
  | { op: 'sum' | 'min' | 'max' | 'mean'; as: string; column: string };

export type AlgebraOperation =
  | {
      op: 'set';
      id: string;
      mode: Mode;
      kind: 'union' | 'intersection' | 'difference' | 'symmetricDifference' | 'complement';
      left: RelationName;
      right?: RelationName;
      universe?: RelationName;
      keyColumns?: readonly string[];
    }
  | {
      op: 'measureSum';
      id: string;
      inputs: readonly RelationName[];
      keyColumns: readonly string[];
      weightColumn: string;
    }
  | {
      op: 'contains' | 'subset' | 'equal' | 'disjoint';
      id: string;
      left: RelationName;
      right: RelationName;
      keyColumns?: readonly string[];
    }
  | { op: 'filter'; id: string; input: RelationName; where: AlgebraPredicate }
  | { op: 'partition'; id: string; input: RelationName; where: AlgebraPredicate }
  | {
      op: 'project';
      id: string;
      input: RelationName;
      columns: readonly { from: string; as?: string }[];
    }
  | {
      op: 'product';
      id: string;
      left: RelationName;
      right: RelationName;
      columns?: readonly Projection[];
    }
  | {
      op: 'join';
      id: string;
      left: RelationName;
      right: RelationName;
      on: readonly { left: string; right: string }[];
      columns: readonly Projection[];
    }
  | {
      op: 'group';
      id: string;
      input: RelationName;
      by: readonly string[];
      aggregates: readonly Aggregate[];
    }
  | {
      op: 'choose';
      id: string;
      input: RelationName;
      keyColumns: readonly string[];
      weightColumn: string;
      seed: number;
      priorities?: readonly { columns: readonly string[]; rank: number }[];
      reference?: RelationName;
    }
  | {
      op: 'take' | 'remove' | 'transfer';
      id: string;
      input: RelationName;
      destination?: RelationName;
      reference?: RelationName;
      keyColumns: readonly string[];
      weightColumn: string;
      amount: number;
      priorities?: readonly { columns: readonly string[]; rank: number }[];
    };

export interface AlgebraQuery {
  readonly inputs: Readonly<Record<RelationName, AlgebraTable>>;
  readonly operations: readonly AlgebraOperation[];
}

export interface AlgebraQueryResult {
  readonly tables: Readonly<Record<string, AlgebraTable>>;
  readonly values: Readonly<Record<string, boolean>>;
  readonly selections: Readonly<
    Record<string, { selected: AlgebraTable; remaining: AlgebraTable; destination?: AlgebraTable }>
  >;
}

interface AlgebraResponse {
  ok: boolean;
  result?: AlgebraQueryResult;
  error?: { name?: string; message?: string };
}

/**
 * Передаёт весь запрос бинарному ядру. В этой обвязке нет обхода строк и
 * вычислительных операций: C++ выполняет составной запрос целиком.
 */
export function runAlgebraQuery(query: AlgebraQuery): AlgebraQueryResult {
  const request = JSON.stringify(query, serializeValue);
  if (request === undefined) {
    throw new TypeError('Некорректный дескриптор запроса алгебры');
  }
  const encoded = getBinaryMathKernel().algebraQuery(request);
  const response = JSON.parse(encoded, reviveValue) as AlgebraResponse;
  if (!response || typeof response !== 'object' || typeof response.ok !== 'boolean') {
    throw new Error('Бинарное ядро вернуло некорректный ответ алгебры');
  }
  if (!response.ok) {
    const message = response.error?.message ?? 'Ошибка бинарной алгебры';
    if (response.error?.name === 'RangeError') throw new RangeError(message);
    if (response.error?.name === 'TypeError') throw new TypeError(message);
    throw new Error(message);
  }
  if (!response.result) {
    throw new Error('Бинарное ядро не вернуло результат алгебры');
  }
  return response.result;
}

function serializeValue(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return { $bigint: value.toString() };
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return { $invalidAlgebraValue: String(value) };
  }
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
    return { $invalidAlgebraValue: typeof value };
  }
  return value;
}

function reviveValue(_key: string, value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const object = value as Record<string, unknown>;
  if (
    Object.keys(object).length === 1 &&
    typeof object.$bigint === 'string'
  ) {
    return BigInt(object.$bigint);
  }
  return value;
}
