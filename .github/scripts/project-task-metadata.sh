#!/usr/bin/env bash

# Метаданные .tasks поддерживают все связи Issues: blocked_by, blocking,
# relates_to, parent и sub_issue. Дубликат не является связью.

parse_task_file() {
  local commit="$1"
  local path="$2"
  local content
  local line key value relation_type relation_target subtask_id subtask_title subtask_body
  local subtask_issue_number seen_id=0 seen_title=0 seen_issue_number=0

  content="$(git show "${commit}:${path}")"
  awk '/^---[[:space:]]*$/ { count++; next } END { exit !(count >= 2) }' <<< "$content" ||
    fail "в ${path} нет корректной пары разделителей заголовка"

  TASK_META_FILE="$work_dir/task-meta.txt"
  TASK_BODY_FILE="$work_dir/task-body.md"
  awk '
    /^---[[:space:]]*$/ { count++; if (count == 1) next; if (count == 2) exit }
    count == 1 { print }
  ' <<< "$content" > "$TASK_META_FILE"
  awk '
    /^---[[:space:]]*$/ { count++; next }
    count >= 2 { print }
  ' <<< "$content" > "$TASK_BODY_FILE"

  TASK_ID=""
  TASK_TITLE=""
  TASK_ISSUE_NUMBER=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" ]] && continue
    key="${line%%:*}"
    value="${line#*:}"
    value="${value# }"
    case "$key" in
      id)
        ((seen_id += 1))
        TASK_ID="$value"
        ;;
      title)
        ((seen_title += 1))
        TASK_TITLE="$value"
        ;;
      issue_number)
        ((seen_issue_number += 1))
        TASK_ISSUE_NUMBER="$value"
        [[ "$TASK_ISSUE_NUMBER" =~ ^[1-9][0-9]*$ ]] ||
          fail "некорректный issue_number в ${path}"
        ;;
      relationship|remove_relationship)
        IFS='|' read -r relation_type relation_target <<< "$value"
        case "$relation_type" in
          blocked_by|blocking|relates_to|parent|sub_issue) ;;
          *) fail "неподдерживаемый тип связи '${relation_type}' в ${path}" ;;
        esac
        [[ -n "$relation_target" ]] || fail "пустая цель связи в ${path}"
        ;;
      subtask_remove_relationship)
        IFS='|' read -r subtask_id relation_type relation_target <<< "$value"
        [[ "$subtask_id" =~ ^[a-z0-9][a-z0-9-]*$ ]] ||
          fail "некорректный идентификатор подзадачи в ${path}"
        case "$relation_type" in
          blocked_by|blocking|relates_to|parent|sub_issue) ;;
          *) fail "неподдерживаемый тип связи '${relation_type}' в ${path}" ;;
        esac
        [[ -n "$relation_target" ]] || fail "пустая цель связи в ${path}"
        ;;
      subtask)
        IFS='|' read -r subtask_id subtask_title subtask_body subtask_issue_number <<< "$value"
        [[ "$subtask_id" =~ ^[a-z0-9][a-z0-9-]*$ ]] ||
          fail "некорректный идентификатор подзадачи в ${path}"
        [[ -n "$subtask_title" && -n "$subtask_body" ]] ||
          fail "у подзадачи в ${path} должны быть заголовок и описание"
        if [[ -n "$subtask_issue_number" ]]; then
          [[ "$subtask_issue_number" =~ ^[1-9][0-9]*$ ]] ||
            fail "некорректный номер Issue у подзадачи в ${path}"
        fi
        ;;
      *)
        fail "неизвестное поле '${key}' в метаданных ${path}"
        ;;
    esac
  done < "$TASK_META_FILE"

  [[ "$seen_id" -eq 1 && "$TASK_ID" =~ ^[a-z0-9][a-z0-9-]*$ ]] ||
    fail "некорректный или повторяющийся id в ${path}"
  [[ "$seen_title" -eq 1 && -n "$TASK_TITLE" ]] ||
    fail "некорректный или повторяющийся title в ${path}"
  [[ "$seen_issue_number" -le 1 ]] ||
    fail "повторяется issue_number в ${path}"
}

find_subtask_issue_number() {
  local task_id="$1"
  local subtask_id="$2"
  local marker="<!-- task-subtask-id:${task_id}:${subtask_id} -->"
  local issues matches count

  issues="$(gh issue list --repo "$repo" --state all --limit 1000 --json number,body)"
  matches="$(jq --arg marker "$marker" '[.[] | select((.body // "") | contains($marker))]' <<< "$issues")"
  count="$(jq 'length' <<< "$matches")"
  [[ "$count" -le 1 ]] || fail "найдено несколько подзадач '${task_id}/${subtask_id}'"
  jq -r '.[0].number // empty' <<< "$matches"
}

resolve_issue_number() {
  local reference="$1"
  local issue_number

  if [[ "$reference" =~ ^#([0-9]+)$ ]]; then
    issue_number="${BASH_REMATCH[1]}"
    gh api "repos/${repo}/issues/${issue_number}" --jq '.number' >/dev/null ||
      fail "Issue ${reference} не найден в ${repo}"
  else
    issue_number="$(find_issue_number "$reference")"
    [[ -n "$issue_number" ]] || fail "Issue для идентификатора '${reference}' не найден"
  fi
  printf '%s\n' "$issue_number"
}

issue_database_id() {
  local issue_number="$1"
  gh api "repos/${repo}/issues/${issue_number}" --jq '.id'
}

relation_list_contains_id() {
  local endpoint="$1"
  local target_id="$2"
  local matches

  matches="$(gh api --paginate --slurp \
    "repos/${repo}/issues/${endpoint}?per_page=100" |
    jq --argjson target "$target_id" '[flatten[] | select(.id == $target)] | length')"
  [[ "$matches" -gt 0 ]]
}

ensure_relationship() {
  local action="$1"
  local relation_type="$2"
  local source_number="$3"
  local target_reference="$4"
  local target_number target_id source_id endpoint write_number write_endpoint write_id current_parent

  target_number="$(resolve_issue_number "$target_reference")"
  [[ "$target_number" != "$source_number" ]] || fail "Issue не может быть связан сам с собой"
  target_id="$(issue_database_id "$target_number")"
  source_id="$(issue_database_id "$source_number")"

  case "$relation_type" in
    blocked_by|blocking|relates_to)
      case "$relation_type" in
        blocked_by)
          endpoint="dependencies/blocked_by"
          write_number="$source_number"
          write_endpoint="$endpoint"
          write_id="$target_id"
          ;;
        blocking)
          # GitHub записывает блокировку через blocked_by; blocking — обратное представление.
          endpoint="dependencies/blocking"
          write_number="$target_number"
          write_endpoint="dependencies/blocked_by"
          write_id="$source_id"
          ;;
        relates_to)
          endpoint="relates_to"
          write_number="$source_number"
          write_endpoint="$endpoint"
          write_id="$target_id"
          ;;
      esac
      if relation_list_contains_id "${source_number}/${endpoint}" "$target_id"; then
        [[ "$action" == "add" ]] && return 0
        gh api --method DELETE \
          "repos/${repo}/issues/${write_number}/${write_endpoint}/${write_id}" >/dev/null
      else
        [[ "$action" == "remove" ]] && return 0
        gh api --method POST "repos/${repo}/issues/${write_number}/${write_endpoint}" \
          -F "issue_id=${write_id}" >/dev/null
      fi
      ;;
    parent)
      current_parent="$(gh api "repos/${repo}/issues/${source_number}/parent" \
        --jq '.number' 2>/dev/null || true)"
      if [[ "$action" == "add" ]]; then
        [[ "$current_parent" == "$target_number" ]] && return 0
        gh api --method POST "repos/${repo}/issues/${target_number}/sub_issues" \
          -F "sub_issue_id=${source_id}" -F replace_parent=true >/dev/null
      elif [[ "$current_parent" == "$target_number" ]]; then
        gh api --method DELETE "repos/${repo}/issues/${target_number}/sub_issue" \
          -F "sub_issue_id=${source_id}" >/dev/null
      fi
      ;;
    sub_issue)
      endpoint="${source_number}/sub_issues"
      if relation_list_contains_id "$endpoint" "$target_id"; then
        [[ "$action" == "add" ]] && return 0
        gh api --method DELETE "repos/${repo}/issues/${source_number}/sub_issue" \
          -F "sub_issue_id=${target_id}" >/dev/null
      else
        [[ "$action" == "remove" ]] && return 0
        gh api --method POST "repos/${repo}/issues/${source_number}/sub_issues" \
          -F "sub_issue_id=${target_id}" -F replace_parent=true >/dev/null
      fi
      ;;
    *)
      fail "неподдерживаемый тип связи '${relation_type}'"
      ;;
  esac
}

sync_task_subtasks() {
  local parent_issue_number="$1"
  local row subtask_id subtask_title subtask_body subtask_issue_number marker issue_number
  local body_file existing current_title current_body current_state
  declare -A seen_subtasks=()

  while IFS= read -r row; do
    [[ -n "$row" ]] || continue
    IFS='|' read -r subtask_id subtask_title subtask_body subtask_issue_number <<< "$row"
    [[ -z "${seen_subtasks[$subtask_id]-}" ]] ||
      fail "повторяется подзадача '${TASK_ID}/${subtask_id}'"
    seen_subtasks["$subtask_id"]=1

    marker="<!-- task-subtask-id:${TASK_ID}:${subtask_id} -->"
    body_file="$work_dir/subtask-body.md"
    printf '%s\n\n%s\n' "$subtask_body" "$marker" > "$body_file"
    if [[ -n "$subtask_issue_number" ]]; then
      issue_number="$subtask_issue_number"
      gh api "repos/${repo}/issues/${issue_number}" --jq '.number' >/dev/null ||
        fail "Issue #${issue_number} подзадачи не найден в ${repo}"
    else
      issue_number="$(find_subtask_issue_number "$TASK_ID" "$subtask_id")"
    fi

    if [[ -z "$issue_number" ]]; then
      local url
      url="$(gh issue create --repo "$repo" --title "$subtask_title" --body-file "$body_file")"
      issue_number="${url##*/}"
      [[ "$issue_number" =~ ^[0-9]+$ ]] || fail "GitHub вернул неожиданный адрес подзадачи: ${url}"
      printf 'Создана подзадача #%s для Issue #%s: %s\n' \
        "$issue_number" "$parent_issue_number" "$subtask_title"
    else
      existing="$(gh api "repos/${repo}/issues/${issue_number}" \
        --jq '{title,body,state}')"
      current_title="$(jq -r '.title' <<< "$existing")"
      current_body="$(jq -r '.body // ""' <<< "$existing")"
      current_state="$(jq -r '.state' <<< "$existing")"
      if [[ "$current_title" != "$subtask_title" || "$current_body" != "$(cat "$body_file")" ]]; then
        gh issue edit "$issue_number" --repo "$repo" \
          --title "$subtask_title" --body-file "$body_file"
        if [[ "$current_state" == "closed" ]]; then
          gh issue reopen "$issue_number" --repo "$repo"
        fi
        printf 'Обновлена подзадача #%s: %s\n' "$issue_number" "$subtask_title"
      fi
    fi

    ensure_relationship add sub_issue "$parent_issue_number" "#${issue_number}"
  done < <(sed -n 's/^subtask:[[:space:]]*//p' "$TASK_META_FILE")

  while IFS= read -r row; do
    [[ -n "$row" ]] || continue
    IFS='|' read -r subtask_id relation_type target_reference <<< "$row"
    issue_number="$(find_subtask_issue_number "$TASK_ID" "$subtask_id")"
    [[ -n "$issue_number" ]] ||
      fail "подзадача '${TASK_ID}/${subtask_id}' для снятия связи не найдена"
    ensure_relationship remove "$relation_type" "$issue_number" "$target_reference"
  done < <(sed -n 's/^subtask_remove_relationship:[[:space:]]*//p' "$TASK_META_FILE")
}

sync_task_relationships() {
  local issue_number="$1"
  local row relation_type target_reference

  while IFS= read -r row; do
    [[ -n "$row" ]] || continue
    IFS='|' read -r relation_type target_reference <<< "$row"
    [[ "$target_reference" == "none" ]] && continue
    ensure_relationship add "$relation_type" "$issue_number" "$target_reference"
  done < <(sed -n 's/^relationship:[[:space:]]*//p' "$TASK_META_FILE")

  while IFS= read -r row; do
    [[ -n "$row" ]] || continue
    IFS='|' read -r relation_type target_reference <<< "$row"
    [[ "$target_reference" == "none" ]] && continue
    ensure_relationship remove "$relation_type" "$issue_number" "$target_reference"
  done < <(sed -n 's/^remove_relationship:[[:space:]]*//p' "$TASK_META_FILE")
}

find_task_path_by_id() {
  local commit="$1"
  local requested_id="$2"
  local path candidate_id found=""

  while IFS= read -r path; do
    candidate_id="$(git show "${commit}:${path}" |
      sed -n 's/^id:[[:space:]]*//p' | head -n 1 | tr -d '\r')"
    if [[ "$candidate_id" == "$requested_id" ]]; then
      [[ -z "$found" ]] || fail "идентификатор '${requested_id}' повторяется в .tasks"
      found="$path"
    fi
  done < <(git ls-tree -r --name-only "$commit" -- .tasks | sort)

  printf '%s\n' "$found"
}

sync_changed_task_relationships() {
  local commit="$1"
  local task_id path issue_number

  ((${#changed_task_ids[@]} > 0)) || return 0
  while IFS= read -r task_id; do
    [[ -n "$task_id" ]] || continue
    path="$(find_task_path_by_id "$commit" "$task_id")"
    [[ -n "$path" ]] || continue
    parse_task_file "$commit" "$path"
    issue_number="$(find_issue_number "$TASK_ID")"
    [[ -n "$issue_number" ]] || fail "Issue для связи '${TASK_ID}' не найден"
    sync_task_relationships "$issue_number"
  done < <(printf '%s\n' "${!changed_task_ids[@]}" | sort)
}
