import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { validateTask } from './model.mjs';

function git(root, args, { input, env = {} } = {}) {
  // Фоновый процесс не наследует настройки Git из интерактивного инструмента агента.
  const proxy = fs.existsSync('/repl')
    ? ['-c', 'url.https://github.replit.internal/.insteadOf=https://github.com/']
    : [];
  const result = spawnSync('git', ['-C', root, ...proxy, ...args], {
    input, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, DANGEROUSLY_ALLOW_GIT: '1', GIT_TERMINAL_PROMPT: '0', ...env },
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Операция Git «${args[0]}» не выполнена (код ${result.status ?? 'нет ответа'})`);
  }
  return result.stdout.trim();
}

export function publish(root = process.cwd()) {
  const outbox = path.join(root, '.local/tasks/github-outbox');
  if (!fs.existsSync(outbox)) return { changed: false, count: 0 };
  const entries = fs.readdirSync(outbox).filter(name => /^\d+\.json$/.test(name)).sort();
  const tasks = entries.map(name => {
    const task = validateTask(JSON.parse(fs.readFileSync(path.join(outbox, name), 'utf8')));
    if (name !== `${task.sourceTask}.json`) throw new Error('Номер задачи не совпадает с именем файла');
    return task;
  });
  if (!tasks.length) return { changed: false, count: 0 };
  const indexLock = git(root, ['rev-parse', '--git-path', 'index.lock']);
  if (fs.existsSync(path.resolve(root, indexLock))) {
    throw new Error('Git заблокирован: сначала необходимо проверить причину index.lock');
  }
  const stateDir = path.join(root, '.local/github-task-sync');
  fs.mkdirSync(stateDir, { recursive: true });
  const lock = path.join(stateDir, 'publisher.lock');
  let descriptor;
  try {
    descriptor = fs.openSync(lock, 'wx');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(fs.readFileSync(lock, 'utf8'));
    try { process.kill(pid, 0); } catch (check) {
      if (check.code === 'ESRCH') {
        fs.unlinkSync(lock);
        return publish(root);
      }
    }
    throw new Error('Другой процесс уже публикует задачи');
  }
  fs.writeFileSync(descriptor, String(process.pid));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'replit-task-index-'));
  const env = { GIT_INDEX_FILE: path.join(temporary, 'index') };
  try {
    // Собственный индекс исключает захват незакоммиченного кода и чужих staged-файлов.
    for (let attempt = 0; attempt < 3; attempt++) {
      git(root, ['fetch', '--no-tags', 'origin', 'refs/heads/main']);
      const parent = git(root, ['rev-parse', 'FETCH_HEAD']);
      git(root, ['read-tree', parent], { env });
      const treeFiles = new Set(git(root, ['ls-tree', '-r', '--name-only', parent]).split('\n'));
      for (const task of tasks) {
        const filename = `.github/replit-tasks/${task.sourceTask}.json`;
        if (treeFiles.has(filename)) {
          const current = JSON.parse(git(root, ['show', `${parent}:${filename}`]));
          if (Date.parse(current.updatedAt) > Date.parse(task.updatedAt)) continue;
        }
        const blob = git(root, ['hash-object', '-w', '--stdin'], {
          input: JSON.stringify(task, null, 2) + '\n',
        });
        git(root, ['update-index', '--add', '--cacheinfo', `100644,${blob},${filename}`], { env });
      }
      const tree = git(root, ['write-tree'], { env });
      if (tree === git(root, ['rev-parse', `${parent}^{tree}`])) {
        return { changed: false, count: tasks.length };
      }
      const commit = git(root, ['commit-tree', tree, '-p', parent, '-m',
        'Синхронизировать описания задач Replit с GitHub'], { env: {
        GIT_AUTHOR_NAME: 'Синхронизация задач Replit',
        GIT_AUTHOR_EMAIL: '41898282+github-actions[bot]@users.noreply.github.com',
        GIT_COMMITTER_NAME: 'Синхронизация задач Replit',
        GIT_COMMITTER_EMAIL: '41898282+github-actions[bot]@users.noreply.github.com',
      } });
      try {
        git(root, ['push', 'origin', `${commit}:refs/heads/main`]);
        console.log(`Задачи опубликованы в main: ${commit}`);
        return { changed: true, count: tasks.length, commit };
      } catch (error) {
        // Обычный push никогда не переписывает чужие изменения; повтор берёт свежий main.
        if (attempt === 2) throw error;
      }
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
    fs.closeSync(descriptor);
    fs.unlinkSync(lock);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const watch = process.argv.includes('--watch');
  let lastPublished;
  const once = () => {
    try {
      const directory = path.join(process.cwd(), '.local/tasks/github-outbox');
      const digest = createHash('sha256');
      if (fs.existsSync(directory)) {
        for (const name of fs.readdirSync(directory).filter(name => /^\d+\.json$/.test(name)).sort()) {
          digest.update(name).update(fs.readFileSync(path.join(directory, name)));
        }
      }
      const signature = digest.digest('hex');
      if (signature === lastPublished) return;
      publish();
      lastPublished = signature;
    } catch (error) {
      console.error(`Синхронизация задач: ${error.message}`);
      if (!watch) process.exitCode = 1;
    }
  };
  once();
  // Отдельный процесс продолжает отправку при следующей попытке после сетевой ошибки.
  if (watch) {
    console.log('Наблюдение за исходящей очередью задач запущено; проверка каждые 15 секунд.');
    setInterval(once, 15000);
  }
}
