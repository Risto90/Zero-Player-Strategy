import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { publish } from './publish.mjs';

test('Отправка в main изолирована от кода, индекса и ветки; повтор не делает коммит', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'github-task-test-'));
  const remote = path.join(directory, 'remote.git');
  const root = path.join(directory, 'workspace');
  const git = (...args) => execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8', env: { ...process.env, DANGEROUSLY_ALLOW_GIT: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
  try {
    fs.mkdirSync(root);
    execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' });
    git('init', '-b', 'main');
    git('config', 'user.name', 'Проверка');
    git('config', 'user.email', 'test@example.invalid');
    fs.writeFileSync(path.join(root, 'app.txt'), 'Исходный код');
    git('add', 'app.txt');
    git('commit', '-m', 'Исходное состояние');
    git('remote', 'add', 'origin', remote);
    git('push', 'origin', 'main');
    git('checkout', '-b', 'working');
    fs.writeFileSync(path.join(root, 'app.txt'), 'Незавершённая работа');
    git('add', 'app.txt');
    const initialStatus = git('status', '--porcelain', '--untracked-files=no');
    const outbox = path.join(root, '.local/tasks/github-outbox');
    fs.mkdirSync(outbox, { recursive: true });
    const task = {
      sourceTask: 194, title: 'Алгебра множеств', description: 'Полное описание',
      dependsOn: [], updatedAt: '2026-10-29T20:00:00.000Z',
    };
    fs.writeFileSync(path.join(outbox, '194.json'), JSON.stringify(task));
    const first = publish(root);
    assert.equal(first.changed, true);
    assert.equal(git('branch', '--show-current'), 'working');
    assert.equal(git('status', '--porcelain', '--untracked-files=no'), initialStatus);
    assert.equal(git('show', `${first.commit}:app.txt`), 'Исходный код');
    assert.equal(JSON.parse(git('show', `${first.commit}:.github/replit-tasks/194.json`)).sourceTask, 194);
    assert.equal(publish(root).changed, false);

    task.updatedAt = '2026-10-30T20:00:00.000Z';
    task.description = 'Новое описание';
    fs.writeFileSync(path.join(outbox, '194.json'), JSON.stringify(task));
    assert.equal(publish(root).changed, true);
    task.updatedAt = '2026-10-29T20:00:00.000Z';
    task.description = 'Устаревшая копия';
    fs.writeFileSync(path.join(outbox, '194.json'), JSON.stringify(task));
    assert.equal(publish(root).changed, false);

    fs.writeFileSync(path.join(root, '.git/index.lock'), 'Проверка блокировки');
    assert.throws(() => publish(root), /index.lock/);
    assert(fs.existsSync(path.join(root, '.git/index.lock')));
    fs.unlinkSync(path.join(root, '.git/index.lock'));
    git('remote', 'set-url', 'origin', path.join(directory, 'missing.git'));
    assert.throws(() => publish(root), /fetch/);
    assert(fs.existsSync(path.join(outbox, '194.json')));
    assert(!fs.existsSync(path.join(root, '.local/github-task-sync/publisher.lock')));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
