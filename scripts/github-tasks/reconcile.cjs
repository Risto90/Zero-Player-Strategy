module.exports = async function reconcile({ github, context, core, tasks, completed }) {
  const { validateTask, marker, renderTask, updateManagedBody } = await import('./model.mjs');
  tasks.forEach(validateTask);
  const issues = (await github.paginate(github.rest.issues.listForRepo, {
    ...context.repo, state: 'all', per_page: 100,
  })).filter(issue => !issue.pull_request);
  const byId = new Map();
  for (const issue of issues) {
    const id = issue.body?.match(/<!-- replit-task:([1-9]\d*) -->/)?.[1];
    if (!id) continue;
    if (byId.has(Number(id))) throw new Error(`Найдены дубликаты задачи Replit №${id}`);
    byId.set(Number(id), issue);
  }
  const summary = [];
  for (const task of tasks) {
    if (byId.has(task.sourceTask)) continue;
    const { data } = await github.rest.issues.create({
      ...context.repo, title: task.title, body: renderTask(task),
    });
    byId.set(task.sourceTask, data);
    summary.push(`Создана задача: ${data.html_url}`);
  }
  const links = new Map([...byId].map(([id, issue]) => [id, issue.html_url]));
  for (const task of tasks) {
    const issue = byId.get(task.sourceTask);
    const body = updateManagedBody(issue.body, renderTask(task, links));
    if (body.length > 65000) throw new Error(`Описание задачи №${task.sourceTask} слишком длинное`);
    const changes = {};
    if (body !== issue.body) changes.body = body;
    if (task.title !== issue.title) changes.title = task.title;
    // Отмена, архивирование или исчезновение из выгрузки не означают выполнение.
    if (completed.has(task.sourceTask) && issue.state !== 'closed') {
      changes.state = 'closed';
      changes.state_reason = 'completed';
    }
    if (Object.keys(changes).length) {
      await github.rest.issues.update({ ...context.repo, issue_number: issue.number, ...changes });
      summary.push(`Обновлена задача: ${issue.html_url}${changes.state ? ' — выполнена' : ''}`);
    }
    core.notice(`${marker(task.sourceTask)} ${issue.html_url}`);
  }
  await core.summary.addRaw(summary.join('\n') || 'Изменений задач нет.').write();
};
