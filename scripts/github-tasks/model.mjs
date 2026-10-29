export function validateTask(task) {
  if (!task || !Number.isSafeInteger(task.sourceTask) || task.sourceTask <= 0 ||
      typeof task.title !== 'string' || !task.title.trim() ||
      typeof task.description !== 'string' || !task.description.trim() ||
      !Array.isArray(task.dependsOn) || task.dependsOn.some(ref => !/^#\d+$/.test(ref)) ||
      typeof task.updatedAt !== 'string' || !Number.isFinite(Date.parse(task.updatedAt))) {
    throw new Error('Некорректное описание задачи для GitHub');
  }
  for (const resource of task.resources ?? []) {
    if (typeof resource.path !== 'string' || !resource.path.startsWith('.local/tasks/') ||
        resource.path.includes('..') || typeof resource.content !== 'string') {
      throw new Error('Некорректный дополнительный план задачи');
    }
  }
  if (task.title.length > 256 || renderTask(task).length > 60000) {
    throw new Error('Название или описание задачи превышает ограничение GitHub');
  }
  return task;
}

export function marker(id) {
  return `<!-- replit-task:${id} -->`;
}

export function renderTask(task, links = new Map()) {
  const dependencies = task.dependsOn.length
    ? task.dependsOn.map(ref => links.get(Number(ref.slice(1))) ?? `Replit ${ref}`).join(', ')
    : 'нет';
  const resources = (task.resources ?? []).map(resource =>
    `\n\n## Приложение: ${resource.path}\n\n${resource.content}`).join('');
  return `${marker(task.sourceTask)}\n<!-- replit-managed:start -->\n` +
    `Исходная задача Replit: №${task.sourceTask}.\n\nЗависимости: ${dependencies}.\n\n` +
    task.description + resources + '\n<!-- replit-managed:end -->';
}

export function updateManagedBody(previous, next) {
  const start = previous?.indexOf('<!-- replit-managed:start -->') ?? -1;
  const endMarker = '<!-- replit-managed:end -->';
  const end = previous?.indexOf(endMarker, start) ?? -1;
  if (start < 0 || end < 0) return next;
  return previous.slice(0, start) +
    next.slice(next.indexOf('<!-- replit-managed:start -->')) +
    previous.slice(end + endMarker.length);
}

export function completedTasks(messages) {
  const ids = new Set();
  for (const message of messages) {
    for (const match of message.matchAll(/^Replit-Task-Completed:\s*#?([1-9]\d*)\s*$/gm)) {
      const id = Number(match[1]);
      if (Number.isSafeInteger(id)) ids.add(id);
    }
  }
  return ids;
}
