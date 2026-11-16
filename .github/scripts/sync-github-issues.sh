#!/usr/bin/env bash
set -euo pipefail

# Явные директивы в описании коммита:
# Issue-Task-ID: stable-task-id
# Issue-Subtask-ID: stable-subtask-id
# Issue-Status: open|closed
# Issue-Comment: Однострочный комментарий к Issue.
# Issue-Discard-Number: 123
repo="${GITHUB_REPOSITORY:?Не задан репозиторий GitHub}"
before="${TASKS_BEFORE:?Не задан предыдущий коммит}"
after="${TASKS_AFTER:?Не задан текущий коммит}"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
declare -A seen_blobs=()
declare -A changed_task_ids=()

fail() {
  printf 'Ошибка синхронизации задач: %s\n' "$*" >&2
  exit 1
}

find_issue_number() {
  local task_id="$1"
  local marker="<!-- task-id:${task_id} -->"
  local issues matches count

  issues="$(gh issue list --repo "$repo" --state all --limit 1000 --json number,body)"
  matches="$(jq --arg marker "$marker" '[.[] | select((.body // "") | contains($marker))]' <<< "$issues")"
  count="$(jq 'length' <<< "$matches")"
  [[ "$count" -le 1 ]] || fail "найдено несколько Issues для идентификатора '$task_id'"
  jq -r '.[0].number // empty' <<< "$matches"
}

source .github/scripts/project-task-metadata.sh

read_task_file() {
  local commit="$1"
  local path="$2"
  local issue_number state url

  parse_task_file "$commit" "$path"
  printf '\n\n<!-- task-id:%s -->\n' "$TASK_ID" >> "$TASK_BODY_FILE"
  changed_task_ids["$TASK_ID"]=1

  if [[ -n "$TASK_ISSUE_NUMBER" ]]; then
    issue_number="$TASK_ISSUE_NUMBER"
    gh api "repos/${repo}/issues/${issue_number}" --jq '.number' >/dev/null ||
      fail "Issue #${issue_number} не найден в ${repo}"
  else
    issue_number="$(find_issue_number "$TASK_ID")"
  fi

  if [[ -z "$issue_number" ]]; then
    url="$(gh issue create --repo "$repo" --title "$TASK_TITLE" --body-file "$TASK_BODY_FILE")"
    issue_number="${url##*/}"
    [[ "$issue_number" =~ ^[0-9]+$ ]] || fail "GitHub вернул неожиданный адрес Issue: ${url}"
    printf 'Создан Issue #%s: %s\n' "$issue_number" "$TASK_TITLE"
  else
    gh issue edit "$issue_number" --repo "$repo" --title "$TASK_TITLE" --body-file "$TASK_BODY_FILE"
    state="$(gh issue view "$issue_number" --repo "$repo" --json state --jq '.state')"
    if [[ "$state" == "CLOSED" ]]; then
      gh issue reopen "$issue_number" --repo "$repo"
      printf 'Обновлён и снова открыт Issue #%s: %s\n' "$issue_number" "$TASK_TITLE"
    else
      printf 'Обновлён Issue #%s: %s\n' "$issue_number" "$TASK_TITLE"
    fi
  fi

  sync_task_subtasks "$issue_number"
}

apply_issue_discards() {
  local message="$1"
  local issue_number current_state

  while IFS= read -r issue_number; do
    [[ -n "$issue_number" ]] || continue
    [[ "$issue_number" =~ ^[1-9][0-9]*$ ]] ||
      fail "некорректный Issue-Discard-Number в описании коммита"
    current_state="$(gh api "repos/${repo}/issues/${issue_number}" --jq '.state')"
    if [[ "$current_state" == "open" ]]; then
      gh issue close "$issue_number" --repo "$repo" --reason "not planned"
      printf 'Issue #%s закрыт явной директивой коммита\n' "$issue_number"
    fi
  done < <(sed -n 's/^Issue-Discard-Number:[[:space:]]*//p' <<< "$message" |
    sed 's/[[:space:]].*$//' | tr -d '\r')
}

apply_commit_directives() {
  local commit="$1"
  local message task_id subtask_id status comment issue_number current_state
  local status_count comment_count subtask_count

  message="$(git show -s --format=%B "$commit")"
  task_id="$(sed -n 's/^Issue-Task-ID:[[:space:]]*//p' <<< "$message" | tail -n 1 | tr -d '\r')"
  subtask_id="$(sed -n 's/^Issue-Subtask-ID:[[:space:]]*//p' <<< "$message" | tail -n 1 | tr -d '\r')"
  status="$(sed -n 's/^Issue-Status:[[:space:]]*//p' <<< "$message" | tail -n 1 | tr -d '\r')"
  comment="$(sed -n 's/^Issue-Comment:[[:space:]]*//p' <<< "$message" | tail -n 1 | tr -d '\r')"
  status_count="$(grep -c '^Issue-Status:' <<< "$message" || true)"
  comment_count="$(grep -c '^Issue-Comment:' <<< "$message" || true)"
  subtask_count="$(grep -c '^Issue-Subtask-ID:' <<< "$message" || true)"

  [[ "$status_count" -le 1 ]] || fail "в коммите ${commit} указано несколько Issue-Status"
  [[ "$comment_count" -le 1 ]] || fail "в коммите ${commit} указано несколько Issue-Comment"
  [[ "$subtask_count" -le 1 ]] || fail "в коммите ${commit} указано несколько Issue-Subtask-ID"
  if [[ -z "$task_id" && ( -n "$subtask_id" || -n "$status" || -n "$comment" || "$status_count" -gt 0 || "$comment_count" -gt 0 ) ]]; then
    fail "директивам статуса или комментария нужен Issue-Task-ID в коммите ${commit}"
  fi
  if [[ -z "$task_id" ]]; then
    apply_issue_discards "$message"
    return 0
  fi
  [[ "$task_id" =~ ^[a-z0-9][a-z0-9-]*$ ]] || fail "некорректный Issue-Task-ID в коммите ${commit}"
  if [[ "$subtask_count" -gt 0 ]]; then
    [[ -n "$subtask_id" ]] || fail "Issue-Subtask-ID не должен быть пустым в коммите ${commit}"
  fi
  if [[ -n "$subtask_id" ]]; then
    [[ "$subtask_id" =~ ^[a-z0-9][a-z0-9-]*$ ]] || fail "некорректный Issue-Subtask-ID в коммите ${commit}"
  fi
  if [[ "$status_count" -gt 0 ]]; then
    [[ "$status" == "open" || "$status" == "closed" ]] ||
      fail "Issue-Status должен быть open или closed в коммите ${commit}"
  fi
  if [[ "$comment_count" -gt 0 ]]; then
    [[ -n "$comment" ]] || fail "Issue-Comment не должен быть пустым в коммите ${commit}"
  fi

  if [[ -n "$subtask_id" ]]; then
    issue_number="$(find_subtask_issue_number "$task_id" "$subtask_id")"
    [[ -n "$issue_number" ]] || fail "подзадача '${task_id}/${subtask_id}' не найдена"
  else
    issue_number="$(find_issue_number "$task_id")"
    [[ -n "$issue_number" ]] || fail "Issue для идентификатора '$task_id' не найден"
  fi
  if [[ "$status_count" -gt 0 ]]; then
    current_state="$(gh issue view "$issue_number" --repo "$repo" --json state --jq '.state')"
    if [[ "$status" == "closed" && "$current_state" != "CLOSED" ]]; then
      gh issue close "$issue_number" --repo "$repo"
      printf 'Закрыт Issue #%s по директиве коммита\n' "$issue_number"
    elif [[ "$status" == "open" && "$current_state" != "OPEN" ]]; then
      gh issue reopen "$issue_number" --repo "$repo"
      printf 'Открыт Issue #%s по директиве коммита\n' "$issue_number"
    fi
  fi
  if [[ "$comment_count" -gt 0 ]]; then
    gh issue comment "$issue_number" --repo "$repo" --body "$comment"
    printf 'Добавлен комментарий к Issue #%s\n' "$issue_number"
  fi
  apply_issue_discards "$message"
}

process_changed_files() {
  local commit="$1"
  local diff_file="$work_dir/changed-files.txt"
  local change path blob

  if git rev-parse "${commit}^1" >/dev/null 2>&1; then
    git diff --name-status --no-renames "${commit}^1" "$commit" -- .tasks > "$diff_file"
  else
    git diff-tree --root --no-commit-id --name-status -r --no-renames "$commit" -- .tasks > "$diff_file"
  fi

  while IFS=$'\t' read -r change path; do
    [[ "$path" == .tasks/*.md ]] || continue
    if [[ "$change" == "D" ]]; then
      unset 'seen_blobs[$path]'
      continue
    fi
    [[ "$change" == "A" || "$change" == "M" || "$change" == "T" ]] || continue
    blob="$(git rev-parse "${commit}:${path}")"
    [[ "${seen_blobs[$path]-}" == "$blob" ]] && continue
    seen_blobs["$path"]="$blob"
    read_task_file "$commit" "$path"
  done < <(sort -k2,2 "$diff_file")
}

if [[ "$before" =~ ^0+$ ]]; then
  while IFS= read -r path; do
    [[ "$path" == .tasks/*.md ]] || continue
    seen_blobs["$path"]="$(git rev-parse "${after}:${path}")"
    read_task_file "$after" "$path"
  done < <(git ls-tree -r --name-only "$after" -- .tasks | sort)
  apply_commit_directives "$after"
else
  while IFS= read -r commit; do
    process_changed_files "$commit"
    apply_commit_directives "$commit"
  done < <(git rev-list --reverse --topo-order "${before}..${after}")
fi

sync_changed_task_relationships "$after"
