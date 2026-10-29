import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { completedTasks, renderTask, updateManagedBody, validateTask } from './model.mjs';

const reconcile = createRequire(import.meta.url)('./reconcile.cjs');
const task = (id, extra = {}) => ({
  sourceTask: id, title: `Проверка ${id}`, description: 'Полное описание задачи',
  dependsOn: [], updatedAt: '2026-10-29T20:00:00.000Z', resources: [], ...extra,
});

test('Распознаются только отдельные явные отметки завершения', () => {
  assert.deepEqual([...completedTasks([
    'Упоминание #194 и Replit-Task-Completed: 194 в середине строки',
    'Replit-Task-Completed: 194\nReplit-Task-Completed: #195\n',
    'Replit-Task-Completed: 0\nReplit-Task-Completed: 196 не завершено',
  ])], [194, 195]);
});

test('Проверяются номер, ссылки, время, длина и дополнительные документы', () => {
  assert.equal(validateTask(task(194)).sourceTask, 194);
  for (const invalid of [
    task(-1), task(1, { dependsOn: ['193'] }), task(1, { updatedAt: 'не дата' }),
    task(1, { description: 'я'.repeat(65001) }),
    task(1, { resources: [{ path: '../../profile.md', content: 'не экспортировать' }] }),
  ]) assert.throws(() => validateTask(invalid));
});

test('Обновление сохраняет пользовательский текст и вставляет документы плана', () => {
  const before = renderTask(task(194));
  const after = renderTask(task(194, {
    resources: [{ path: '.local/tasks/contract.md', content: 'Полный контракт' }],
  }));
  const result = updateManagedBody(`${before}\nПользовательское дополнение`, after);
  assert(result.includes('Полный контракт'));
  assert(result.endsWith('Пользовательское дополнение'));
  assert.equal((result.match(/replit-task:194/g) ?? []).length, 1);
});

function apiFixture(issues = []) {
  let nextId = 100;
  const changes = [];
  const github = {
    paginate: async () => structuredClone(issues),
    rest: { issues: {
      listForRepo() {},
      create: async payload => {
        const issue = {
          ...payload, number: nextId++, state: 'open',
          html_url: `https://example.invalid/issues/${nextId - 1}`,
        };
        issues.push(issue);
        return { data: issue };
      },
      update: async payload => {
        changes.push(payload);
        Object.assign(issues.find(issue => issue.number === payload.issue_number), payload);
        return {};
      },
    } },
  };
  const core = { notice() {}, summary: { addRaw: () => ({ async write() {} }) } };
  return {
    issues, changes,
    run: (tasks, completed = new Set()) => reconcile({
      github, core, context: { repo: { owner: 'проверка', repo: 'задачи' } }, tasks, completed,
    }),
  };
}

test('Повторная выгрузка не дублирует Issue; зависимости становятся ссылками', async () => {
  const api = apiFixture();
  const tasks = [task(194, { dependsOn: ['#193'] }), task(193)];
  await api.run(tasks);
  await api.run(tasks);
  assert.equal(api.issues.length, 2);
  assert(api.issues[0].body.includes(api.issues[1].html_url));
});

test('Старая тестовая задача подхватывается по метке; текст за блоком сохраняется', async () => {
  const api = apiFixture([{
    number: 1, title: 'Прежнее название', body: '<!-- replit-task:194 -->\nСтарый экспорт',
    state: 'open', html_url: 'https://example.invalid/issues/1',
  }]);
  await api.run([task(194)]);
  api.issues[0].body += '\nРучное примечание';
  await api.run([task(194, { description: 'Обновлённое описание' })]);
  assert.equal(api.issues.length, 1);
  assert(api.issues[0].body.endsWith('Ручное примечание'));
  assert(api.issues[0].body.includes('Обновлённое описание'));
});

test('Закрывается только явно завершённая задача; повторное закрытие не нужно', async () => {
  const api = apiFixture();
  await api.run([task(194), task(195)], new Set([194]));
  assert.equal(api.issues.find(issue => issue.body.includes('replit-task:194')).state, 'closed');
  assert.equal(api.issues.find(issue => issue.body.includes('replit-task:195')).state, 'open');
  const count = api.changes.length;
  await api.run([task(194), task(195)], new Set([194]));
  assert.equal(api.changes.length, count);
  await api.run([]);
  assert.equal(api.issues.length, 2);
});

test('Историческая отметка закрывает поздно созданный Issue', async () => {
  const api = apiFixture();
  await api.run([task(194)], completedTasks(['Replit-Task-Completed: 194']));
  assert.equal(api.issues[0].state, 'closed');
  assert.equal(api.issues[0].state_reason, 'completed');
});

test('Дубликаты постоянной метки выявляются вместо случайного выбора Issue', async () => {
  const api = apiFixture([
    { number: 1, body: '<!-- replit-task:194 -->' },
    { number: 2, body: '<!-- replit-task:194 -->' },
  ]);
  await assert.rejects(api.run([task(194)]), /дубликаты/);
});
