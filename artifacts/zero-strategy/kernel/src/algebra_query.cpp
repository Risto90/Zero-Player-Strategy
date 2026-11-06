#include "zero_kernel.h"

#include <boost/json.hpp>
#include <boost/json/src.hpp>

#include <algorithm>
#include <charconv>
#include <cmath>
#include <cstdint>
#include <limits>
#include <map>
#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace {

namespace json = boost::json;
using Scalar = json::value;
using Row = std::vector<Scalar>;
using Key = std::vector<Scalar>;
constexpr size_t kMaximumRows = 10'000'000;

struct QueryFailure {
  const char *name;
  std::string message;
};

[[noreturn]] void fail(const char *name, std::string message) {
  throw QueryFailure{name, std::move(message)};
}

struct Table {
  std::vector<std::string> columns;
  std::vector<Row> rows;
  std::optional<std::string> weight_column;
};

struct KeyLess {
  bool operator()(const Key &left, const Key &right) const;
};

bool is_bigint(const Scalar &value) {
  if (!value.is_object())
    return false;
  const auto &object = value.as_object();
  return object.size() == 1 && object.if_contains("$bigint") != nullptr &&
         object.at("$bigint").is_string();
}

std::string string_value(const Scalar &value) {
  const auto &string = value.as_string();
  return std::string(string.c_str(), string.size());
}

std::string normalize_bigint(std::string value) {
  if (value.empty())
    fail("TypeError", "Предикат содержит недопустимое значение");
  bool negative = value.front() == '-';
  size_t start = negative ? 1 : 0;
  if (start == value.size())
    fail("TypeError", "Предикат содержит недопустимое значение");
  for (size_t index = start; index < value.size(); ++index) {
    if (value[index] < '0' || value[index] > '9')
      fail("TypeError", "Предикат содержит недопустимое значение");
  }
  while (start + 1 < value.size() && value[start] == '0')
    ++start;
  std::string digits = value.substr(start);
  if (digits == "0")
    return digits;
  return negative ? "-" + digits : digits;
}

Scalar read_scalar(const json::value &value, uint32_t row,
                   const std::string &column) {
  if (value.is_null() || value.is_bool() || value.is_string())
    return value;
  if (value.is_number()) {
    double number = 0.0;
    if (value.is_double())
      number = value.as_double();
    else if (value.is_int64())
      number = static_cast<double>(value.as_int64());
    else
      number = static_cast<double>(value.as_uint64());
    if (!std::isfinite(number))
      fail("TypeError", "Недопустимое значение в строке " +
                            std::to_string(row) + ", столбце " + column);
    return Scalar(number);
  }
  if (is_bigint(value)) {
    json::object encoded;
    encoded.emplace("$bigint",
                    normalize_bigint(string_value(value.as_object().at("$bigint"))));
    return Scalar(std::move(encoded));
  }
  fail("TypeError", "Недопустимое значение в строке " +
                        std::to_string(row) + ", столбце " + column);
}

std::string scalar_type(const Scalar &value) {
  if (value.is_null())
    return "object";
  if (value.is_bool())
    return "boolean";
  if (value.is_number())
    return "number";
  if (value.is_string())
    return "string";
  if (is_bigint(value))
    return "bigint";
  return "object";
}

std::string bigint_string(const Scalar &value) {
  return normalize_bigint(string_value(value.as_object().at("$bigint")));
}

std::string scalar_string(const Scalar &value) {
  if (value.is_null())
    return "null";
  if (value.is_bool())
    return value.as_bool() ? "true" : "false";
  if (value.is_string())
    return string_value(value);
  if (is_bigint(value))
    return bigint_string(value);
  if (value.is_number()) {
    double number = value.is_double()
                        ? value.as_double()
                        : value.is_int64()
                              ? static_cast<double>(value.as_int64())
                              : static_cast<double>(value.as_uint64());
    if (number == 0.0)
      return "0";
    char buffer[64];
    const auto result = std::to_chars(buffer, buffer + sizeof(buffer), number);
    if (result.ec == std::errc{})
      return std::string(buffer, result.ptr);
  }
  return {};
}

std::vector<uint16_t> utf16_units(std::string_view text) {
  std::vector<uint16_t> result;
  result.reserve(text.size());
  for (size_t index = 0; index < text.size();) {
    const auto first = static_cast<uint8_t>(text[index]);
    uint32_t codepoint = 0xfffd;
    size_t width = 1;
    if (first < 0x80) {
      codepoint = first;
    } else if ((first & 0xe0) == 0xc0 && index + 1 < text.size()) {
      codepoint = ((first & 0x1f) << 6) |
                  (static_cast<uint8_t>(text[index + 1]) & 0x3f);
      width = 2;
    } else if ((first & 0xf0) == 0xe0 && index + 2 < text.size()) {
      codepoint = ((first & 0x0f) << 12) |
                  ((static_cast<uint8_t>(text[index + 1]) & 0x3f) << 6) |
                  (static_cast<uint8_t>(text[index + 2]) & 0x3f);
      width = 3;
    } else if ((first & 0xf8) == 0xf0 && index + 3 < text.size()) {
      codepoint = ((first & 0x07) << 18) |
                  ((static_cast<uint8_t>(text[index + 1]) & 0x3f) << 12) |
                  ((static_cast<uint8_t>(text[index + 2]) & 0x3f) << 6) |
                  (static_cast<uint8_t>(text[index + 3]) & 0x3f);
      width = 4;
    }
    index += width;
    if (codepoint <= 0xffff) {
      result.push_back(static_cast<uint16_t>(codepoint));
    } else {
      codepoint -= 0x10000;
      result.push_back(static_cast<uint16_t>(0xd800 + (codepoint >> 10)));
      result.push_back(static_cast<uint16_t>(0xdc00 + (codepoint & 0x3ff)));
    }
  }
  return result;
}

int compare_text(std::string_view left, std::string_view right) {
  const auto a = utf16_units(left);
  const auto b = utf16_units(right);
  if (std::lexicographical_compare(a.begin(), a.end(), b.begin(), b.end()))
    return -1;
  if (std::lexicographical_compare(b.begin(), b.end(), a.begin(), a.end()))
    return 1;
  return 0;
}

int compare_bigint(const std::string &left, const std::string &right) {
  const bool left_negative = !left.empty() && left.front() == '-';
  const bool right_negative = !right.empty() && right.front() == '-';
  if (left_negative != right_negative)
    return left_negative ? -1 : 1;
  const std::string_view a(left_negative ? left.data() + 1 : left.data(),
                           left.size() - (left_negative ? 1 : 0));
  const std::string_view b(right_negative ? right.data() + 1 : right.data(),
                           right.size() - (right_negative ? 1 : 0));
  int order = 0;
  if (a.size() != b.size())
    order = a.size() < b.size() ? -1 : 1;
  else if (a != b)
    order = a < b ? -1 : 1;
  return left_negative ? -order : order;
}

double number_value(const Scalar &value) {
  if (value.is_double())
    return value.as_double();
  if (value.is_int64())
    return static_cast<double>(value.as_int64());
  if (value.is_uint64())
    return static_cast<double>(value.as_uint64());
  fail("TypeError", "Ожидается числовое значение");
}

int compare_value(const Scalar &left, const Scalar &right) {
  const std::string left_type = scalar_type(left);
  const std::string right_type = scalar_type(right);
  if (left_type == right_type) {
    if (left.is_null())
      return 0;
    if (left.is_bool()) {
      const bool a = left.as_bool(), b = right.as_bool();
      return a == b ? 0 : a ? 1 : -1;
    }
    if (left.is_number()) {
      const double a = number_value(left), b = number_value(right);
      return a == b ? 0 : a < b ? -1 : 1;
    }
    if (left.is_string())
      return compare_text(string_value(left), string_value(right));
    if (is_bigint(left))
      return compare_bigint(bigint_string(left), bigint_string(right));
  }
  const std::string a = left_type + ":" + scalar_string(left);
  const std::string b = right_type + ":" + scalar_string(right);
  return compare_text(a, b);
}

bool same_type(const Scalar &left, const Scalar &right) {
  return scalar_type(left) == scalar_type(right);
}

bool KeyLess::operator()(const Key &left, const Key &right) const {
  const size_t common = std::min(left.size(), right.size());
  for (size_t index = 0; index < common; ++index) {
    const int order = compare_value(left[index], right[index]);
    if (order != 0)
      return order < 0;
  }
  return left.size() < right.size();
}

bool key_equal(const Key &left, const Key &right) {
  KeyLess less;
  return !less(left, right) && !less(right, left);
}

double stable_sum(std::vector<double> values) {
  std::sort(values.begin(), values.end(), [](double left, double right) {
    if (std::abs(left) != std::abs(right))
      return std::abs(left) < std::abs(right);
    return left < right;
  });
  double sum = 0.0;
  double correction = 0.0;
  for (const double value : values) {
    const double adjusted = value - correction;
    const double next = sum + adjusted;
    correction = (next - sum) - adjusted;
    sum = next;
  }
  if (!std::isfinite(sum))
    fail("RangeError", "Переполнение суммы меры");
  return sum;
}

void assert_unique_columns(const std::vector<std::string> &columns) {
  std::set<std::string> unique;
  for (const auto &column : columns) {
    if (column.empty() || !unique.insert(column).second)
      fail("TypeError", "Имена столбцов должны быть непустыми и уникальными");
  }
}

size_t column_index(const Table &table, const std::string &name) {
  const auto found = std::find(table.columns.begin(), table.columns.end(), name);
  if (found == table.columns.end())
    fail("TypeError", "Неизвестный столбец «" + name + "»");
  return static_cast<size_t>(found - table.columns.begin());
}

std::vector<std::string> string_array(const json::value &value,
                                      const char *message) {
  if (!value.is_array())
    fail("TypeError", message);
  std::vector<std::string> result;
  result.reserve(value.as_array().size());
  for (const auto &item : value.as_array()) {
    if (!item.is_string())
      fail("TypeError", message);
    result.push_back(string_value(item));
  }
  return result;
}

const json::object &object_value(const json::value &value,
                                 const char *message) {
  if (!value.is_object())
    fail("TypeError", message);
  return value.as_object();
}

const json::array &array_value(const json::value &value,
                               const char *message) {
  if (!value.is_array())
    fail("TypeError", message);
  return value.as_array();
}

const json::value *property(const json::object &object, const char *name) {
  return object.if_contains(name);
}

std::string required_string(const json::object &object, const char *name) {
  const auto *value = property(object, name);
  if (value == nullptr || !value->is_string())
    fail("TypeError", std::string("Поле «") + name + "» должно быть строкой");
  return string_value(*value);
}

std::optional<std::string> optional_string(const json::object &object,
                                           const char *name) {
  const auto *value = property(object, name);
  if (value == nullptr || value->is_null())
    return std::nullopt;
  if (!value->is_string())
    fail("TypeError", std::string("Поле «") + name + "» должно быть строкой");
  return string_value(*value);
}

double required_number(const json::object &object, const char *name) {
  const auto *value = property(object, name);
  if (value == nullptr || !value->is_number())
    fail("TypeError", std::string("Поле «") + name + "» должно быть числом");
  const double result = number_value(*value);
  if (!std::isfinite(result))
    fail("TypeError", std::string("Поле «") + name + "» должно быть конечным");
  return result;
}

const json::value &required_property(const json::object &object,
                                    const char *name) {
  const auto *value = property(object, name);
  if (value == nullptr)
    fail("TypeError", std::string("Не задано поле «") + name + "»");
  return *value;
}

Table read_table(const json::value &value) {
  const auto &object = object_value(value, "Таблица должна содержать столбцы и строки");
  const auto *columns_value = property(object, "columns");
  const auto *rows_value = property(object, "rows");
  if (columns_value == nullptr || rows_value == nullptr ||
      !columns_value->is_array() || !rows_value->is_array())
    fail("TypeError", "Таблица должна содержать столбцы и строки");
  Table table;
  table.columns = string_array(*columns_value, "Имена столбцов должны быть строками");
  assert_unique_columns(table.columns);
  const auto weight = optional_string(object, "weightColumn");
  if (weight.has_value()) {
    column_index(table, *weight);
    table.weight_column = *weight;
  }
  const auto &rows = rows_value->as_array();
  if (rows.size() > kMaximumRows)
    fail("RangeError", "Таблица превышает лимит строк");
  table.rows.reserve(rows.size());
  for (size_t row_index = 0; row_index < rows.size(); ++row_index) {
    if (!rows[row_index].is_array() ||
        rows[row_index].as_array().size() != table.columns.size())
      fail("TypeError", "Строка " + std::to_string(row_index) +
                            " имеет неверную ширину");
    Row row;
    row.reserve(table.columns.size());
    const auto &input_row = rows[row_index].as_array();
    for (size_t column = 0; column < input_row.size(); ++column)
      row.push_back(read_scalar(input_row[column],
                                static_cast<uint32_t>(row_index),
                                table.columns[column]));
    if (table.weight_column.has_value()) {
      const Scalar &weight_value = row[column_index(table, *table.weight_column)];
      if (!weight_value.is_number() || number_value(weight_value) < 0.0)
        fail("RangeError", "Масса в строке " + std::to_string(row_index) +
                               " должна быть конечным неотрицательным числом");
    }
    table.rows.push_back(std::move(row));
  }
  return table;
}

json::value scalar_json(const Scalar &value) {
  if (is_bigint(value)) {
    json::object encoded;
    encoded.emplace("$bigint", bigint_string(value));
    return encoded;
  }
  if (value.is_number())
    return number_value(value);
  return value;
}

json::value table_json(const Table &table) {
  json::object object;
  json::array columns;
  columns.reserve(table.columns.size());
  for (const auto &column : table.columns)
    columns.emplace_back(column);
  json::array rows;
  rows.reserve(table.rows.size());
  for (const auto &row : table.rows) {
    json::array output_row;
    output_row.reserve(row.size());
    for (const auto &value : row)
      output_row.push_back(scalar_json(value));
    rows.push_back(std::move(output_row));
  }
  object.emplace("columns", std::move(columns));
  object.emplace("rows", std::move(rows));
  if (table.weight_column.has_value())
    object.emplace("weightColumn", *table.weight_column);
  return object;
}

std::vector<size_t> normalize_columns(const Table &table,
                                     const std::optional<std::vector<std::string>> &requested,
                                     std::vector<std::string> *names = nullptr) {
  const std::vector<std::string> &columns =
      requested.has_value() ? *requested : table.columns;
  if (columns.empty() ||
      std::set<std::string>(columns.begin(), columns.end()).size() != columns.size())
    fail("TypeError", "Ключ должен содержать неповторяющиеся столбцы");
  std::vector<size_t> indices;
  indices.reserve(columns.size());
  for (const auto &column : columns)
    indices.push_back(column_index(table, column));
  if (names != nullptr)
    *names = columns;
  return indices;
}

Key row_key(const Row &row, const std::vector<size_t> &indices) {
  Key key;
  key.reserve(indices.size());
  for (const size_t index : indices)
    key.push_back(row[index]);
  return key;
}

void assert_same_columns(const Table &left, const Table &right) {
  if (left.columns != right.columns)
    fail("TypeError", "Таблицы должны иметь одинаковые столбцы и порядок");
}

bool complete_measure_key(const Table &table,
                          const std::vector<std::string> &key_columns,
                          const std::string &weight_column) {
  if (!table.weight_column.has_value() ||
      *table.weight_column != weight_column ||
      key_columns.size() + 1 != table.columns.size() ||
      std::find(key_columns.begin(), key_columns.end(), weight_column) !=
          key_columns.end())
    return false;
  for (const auto &column : table.columns) {
    if (column != weight_column &&
        std::find(key_columns.begin(), key_columns.end(), column) ==
            key_columns.end())
      return false;
  }
  return true;
}

void assert_complete_measure_key(const Table &table,
                                 const std::vector<std::string> &key_columns,
                                 const std::string &weight_column) {
  if (!complete_measure_key(table, key_columns, weight_column))
    fail("TypeError",
         "Операция над группами требует ключ из всех совместных измерений");
}

std::map<Key, std::vector<double>, KeyLess>
measure_buckets(const std::vector<Table> &tables,
                const std::vector<size_t> &key_indices,
                const std::string &weight_column) {
  std::map<Key, std::vector<double>, KeyLess> totals;
  for (const auto &table : tables) {
    if (!table.weight_column.has_value() ||
        *table.weight_column != weight_column)
      fail("TypeError", "Столбец массы не совпадает");
    const size_t weight_index = column_index(table, weight_column);
    for (const auto &row : table.rows)
      totals[row_key(row, key_indices)].push_back(number_value(row[weight_index]));
  }
  return totals;
}

Table sum_measures_preserving_schema(const std::vector<Table> &tables,
                                     const std::vector<std::string> &key_columns,
                                     const std::string &weight_column) {
  if (tables.empty())
    fail("TypeError", "Сложение меры требует хотя бы одной таблицы");
  const Table &first = tables.front();
  if (!first.weight_column.has_value() ||
      *first.weight_column != weight_column)
    fail("TypeError", "Столбец массы не совпадает с описанием таблицы");
  const auto indices = normalize_columns(first, key_columns);
  const size_t weight_index = column_index(first, weight_column);
  for (const auto &table : tables) {
    assert_same_columns(first, table);
    if (!table.weight_column.has_value() ||
        *table.weight_column != weight_column)
      fail("TypeError", "Столбец массы не совпадает");
  }
  const auto buckets = measure_buckets(tables, indices, weight_column);
  if (buckets.size() > kMaximumRows)
    fail("RangeError", "Результат суммы меры превышает лимит строк");
  Table result = first;
  result.rows.clear();
  result.rows.reserve(buckets.size());
  for (const auto &[key, values] : buckets) {
    const double weight = stable_sum(values);
    if (weight <= 0.0)
      continue;
    Row row(first.columns.size());
    for (size_t index = 0; index < indices.size(); ++index)
      row[indices[index]] = key[index];
    row[weight_index] = weight;
    result.rows.push_back(std::move(row));
  }
  return result;
}

Table sum_measures_projected(const std::vector<Table> &tables,
                             const std::vector<std::string> &key_columns,
                             const std::string &weight_column) {
  if (tables.empty())
    fail("TypeError", "Сложение меры требует хотя бы одной таблицы");
  const Table &first = tables.front();
  const auto indices = normalize_columns(first, key_columns);
  const size_t weight_index = column_index(first, weight_column);
  for (const auto &table : tables) {
    assert_same_columns(first, table);
    if (!table.weight_column.has_value() ||
        *table.weight_column != weight_column)
      fail("TypeError", "Столбец массы не совпадает с описанием таблицы");
  }
  const auto buckets = measure_buckets(tables, indices, weight_column);
  if (buckets.size() > kMaximumRows)
    fail("RangeError", "Результат суммы меры превышает лимит строк");
  Table result;
  result.columns = key_columns;
  result.columns.push_back(weight_column);
  result.weight_column = weight_column;
  result.rows.reserve(buckets.size());
  for (const auto &[key, values] : buckets) {
    const double weight = stable_sum(values);
    if (weight <= 0.0)
      continue;
    Row row = key;
    row.emplace_back(weight);
    result.rows.push_back(std::move(row));
  }
  return result;
}

enum class SetKind { Union, Intersection, Difference, SymmetricDifference, Complement };
enum class SetMode { Set, Multiset, Measure };

SetMode parse_set_mode(const std::string &mode) {
  if (mode == "set") return SetMode::Set;
  if (mode == "multiset") return SetMode::Multiset;
  if (mode == "measure") return SetMode::Measure;
  fail("TypeError", "Неизвестная семантика множества");
}

SetKind parse_set_kind(const std::string &kind) {
  if (kind == "union") return SetKind::Union;
  if (kind == "intersection") return SetKind::Intersection;
  if (kind == "difference") return SetKind::Difference;
  if (kind == "symmetricDifference") return SetKind::SymmetricDifference;
  if (kind == "complement") return SetKind::Complement;
  fail("TypeError", "Неизвестная операция множества");
}

Table set_operation(const Table &left, const Table &right, SetKind kind,
                    SetMode mode,
                    const std::optional<std::vector<std::string>> &requested) {
  assert_same_columns(left, right);
  std::vector<std::string> columns;
  const auto indices = normalize_columns(left, requested, &columns);
  Table result;
  result.columns = columns;

  if (mode == SetMode::Measure) {
    const auto weight_column = left.weight_column;
    if (!weight_column.has_value() ||
        right.weight_column != weight_column)
      fail("TypeError", "Мере нужны одинаковые столбцы массы");
    const auto dimensions = requested.has_value()
                                ? *requested
                                : [&]() {
                                    std::vector<std::string> all;
                                    for (const auto &column : left.columns)
                                      if (column != *weight_column)
                                        all.push_back(column);
                                    return all;
                                  }();
    const auto dimensions_set =
        std::set<std::string>(dimensions.begin(), dimensions.end());
    if (dimensions_set.contains(*weight_column))
      fail("TypeError", "Столбец массы не может входить в ключ меры");
    if (dimensions.size() + 1 != left.columns.size()) {
      fail("TypeError",
           "Операции над мерой сохраняют все совместные измерения; проекция выполняется отдельно");
    }
    for (const auto &column : left.columns) {
      if (column != *weight_column && !dimensions_set.contains(column))
        fail("TypeError",
             "Операции над мерой сохраняют все совместные измерения; проекция выполняется отдельно");
    }
    std::vector<std::string> key_names;
    const auto key_indices = normalize_columns(left, dimensions, &key_names);
    const auto a = measure_buckets({left}, key_indices, *weight_column);
    const auto b = measure_buckets({right}, key_indices, *weight_column);
    std::set<Key, KeyLess> keys;
    for (const auto &[key, _] : a) keys.insert(key);
    for (const auto &[key, _] : b) keys.insert(key);
    result.columns = key_names;
    result.columns.push_back(*weight_column);
    result.weight_column = *weight_column;
    for (const auto &key : keys) {
      const auto left_found = a.find(key), right_found = b.find(key);
      const double av = left_found == a.end() ? 0.0 : stable_sum(left_found->second);
      const double bv = right_found == b.end() ? 0.0 : stable_sum(right_found->second);
      double weight = 0.0;
      switch (kind) {
      case SetKind::Union: weight = std::max(av, bv); break;
      case SetKind::Intersection: weight = std::min(av, bv); break;
      case SetKind::Difference: weight = std::max(0.0, av - bv); break;
      case SetKind::SymmetricDifference: weight = std::abs(av - bv); break;
      case SetKind::Complement: weight = std::max(0.0, bv - av); break;
      }
      if (weight <= 0.0)
        continue;
      Row row = key;
      row.emplace_back(weight);
      result.rows.push_back(std::move(row));
    }
    return result;
  }

  if (left.weight_column.has_value() || right.weight_column.has_value())
    fail("TypeError", "Обычные множества не могут неявно терять столбец массы");
  std::map<Key, uint32_t, KeyLess> a, b;
  for (const auto &row : left.rows)
    ++a[row_key(row, indices)];
  for (const auto &row : right.rows)
    ++b[row_key(row, indices)];
  std::set<Key, KeyLess> keys;
  for (const auto &[key, _] : a) keys.insert(key);
  for (const auto &[key, _] : b) keys.insert(key);
  for (const auto &key : keys) {
    const uint32_t ac = a.contains(key) ? a.at(key) : 0;
    const uint32_t bc = b.contains(key) ? b.at(key) : 0;
    uint64_t count = 0;
    if (mode == SetMode::Set) {
      switch (kind) {
      case SetKind::Union: count = (ac > 0 || bc > 0) ? 1 : 0; break;
      case SetKind::Intersection: count = (ac > 0 && bc > 0) ? 1 : 0; break;
      case SetKind::Difference: count = (ac > 0 && bc == 0) ? 1 : 0; break;
      case SetKind::SymmetricDifference: count = ((ac > 0) != (bc > 0)) ? 1 : 0; break;
      case SetKind::Complement: count = (bc > 0 && ac == 0) ? 1 : 0; break;
      }
    } else {
      switch (kind) {
      case SetKind::Union: count = std::max(ac, bc); break;
      case SetKind::Intersection: count = std::min(ac, bc); break;
      case SetKind::Difference: count = ac > bc ? ac - bc : 0; break;
      case SetKind::SymmetricDifference: count = ac > bc ? ac - bc : bc - ac; break;
      case SetKind::Complement: count = bc > ac ? bc - ac : 0; break;
      }
    }
    if (result.rows.size() + count > kMaximumRows)
      fail("RangeError", "Результат множества превышает лимит строк");
    for (uint64_t index = 0; index < count; ++index)
      result.rows.push_back(key);
  }
  return result;
}

enum class PredicateKind {
  And, Or, Not, Equal, NotEqual, Less, LessEqual, Greater, GreaterEqual,
  In, NotIn, IsNull, NotNull
};

struct Predicate {
  PredicateKind kind;
  size_t column = 0;
  Scalar value;
  std::vector<Scalar> values;
  std::vector<Predicate> children;
};

Scalar predicate_scalar(const json::value &value) {
  if (value.is_null() || value.is_bool() || value.is_string())
    return value;
  if (value.is_number()) {
    const double number = number_value(value);
    if (!std::isfinite(number))
      fail("TypeError", "Предикат содержит недопустимое значение");
    return number;
  }
  if (is_bigint(value)) {
    json::object encoded;
    encoded.emplace("$bigint",
                    normalize_bigint(string_value(value.as_object().at("$bigint"))));
    return encoded;
  }
  fail("TypeError", "Предикат содержит недопустимое значение");
}

Predicate read_predicate(const json::value &value, const Table &table) {
  const auto &object =
      object_value(value, "Некорректный предикат");
  const std::string op = required_string(object, "op");
  if (op == "and" || op == "or") {
    const auto &parts = array_value(required_property(object, "predicates"),
                                    "Составной предикат должен содержать список условий");
    Predicate result{op == "and" ? PredicateKind::And : PredicateKind::Or};
    result.children.reserve(parts.size());
    for (const auto &part : parts)
      result.children.push_back(read_predicate(part, table));
    return result;
  }
  if (op == "not") {
    Predicate result{PredicateKind::Not};
    result.children.push_back(
        read_predicate(required_property(object, "predicate"), table));
    return result;
  }
  Predicate result;
  if (op == "eq") result.kind = PredicateKind::Equal;
  else if (op == "ne") result.kind = PredicateKind::NotEqual;
  else if (op == "lt") result.kind = PredicateKind::Less;
  else if (op == "lte") result.kind = PredicateKind::LessEqual;
  else if (op == "gt") result.kind = PredicateKind::Greater;
  else if (op == "gte") result.kind = PredicateKind::GreaterEqual;
  else if (op == "in") result.kind = PredicateKind::In;
  else if (op == "notIn") result.kind = PredicateKind::NotIn;
  else if (op == "isNull") result.kind = PredicateKind::IsNull;
  else if (op == "notNull") result.kind = PredicateKind::NotNull;
  else fail("TypeError", "Неизвестный оператор предиката");
  result.column = column_index(table, required_string(object, "column"));
  if (result.kind == PredicateKind::IsNull ||
      result.kind == PredicateKind::NotNull)
    return result;
  const auto &input = required_property(object, "value");
  if (result.kind == PredicateKind::In || result.kind == PredicateKind::NotIn) {
    if (!input.is_array())
      fail("TypeError", "Оператор in требует список значений");
    result.values.reserve(input.as_array().size());
    for (const auto &item : input.as_array())
      result.values.push_back(predicate_scalar(item));
    return result;
  }
  result.value = predicate_scalar(input);
  if ((result.kind == PredicateKind::Less ||
       result.kind == PredicateKind::LessEqual ||
       result.kind == PredicateKind::Greater ||
       result.kind == PredicateKind::GreaterEqual) &&
      !result.value.is_number() && !result.value.is_string() &&
      !is_bigint(result.value))
    fail("TypeError", "Сравнение порядка требует число, строку или целое bigint");
  return result;
}

int ordered_comparison(const Scalar &left, const Scalar &right) {
  const std::string type = scalar_type(left);
  if (type != scalar_type(right) ||
      (type != "number" && type != "string" && type != "bigint"))
    fail("TypeError",
         "Сравнение порядка требует значения одного числового или строкового типа");
  return compare_value(left, right);
}

bool test_predicate(const Predicate &predicate, const Row &row) {
  const Scalar &value = row[predicate.column];
  switch (predicate.kind) {
  case PredicateKind::And:
    return std::all_of(predicate.children.begin(), predicate.children.end(),
                       [&](const Predicate &child) {
                         return test_predicate(child, row);
                       });
  case PredicateKind::Or:
    return std::any_of(predicate.children.begin(), predicate.children.end(),
                       [&](const Predicate &child) {
                         return test_predicate(child, row);
                       });
  case PredicateKind::Not:
    return !test_predicate(predicate.children.front(), row);
  case PredicateKind::IsNull:
    return value.is_null();
  case PredicateKind::NotNull:
    return !value.is_null();
  case PredicateKind::In:
  case PredicateKind::NotIn: {
    const bool found = std::any_of(
        predicate.values.begin(), predicate.values.end(),
        [&](const Scalar &candidate) {
          return same_type(value, candidate) &&
                 compare_value(value, candidate) == 0;
        });
    return predicate.kind == PredicateKind::In ? found : !found;
  }
  case PredicateKind::Equal:
    return same_type(value, predicate.value) &&
           compare_value(value, predicate.value) == 0;
  case PredicateKind::NotEqual:
    return !same_type(value, predicate.value) ||
           compare_value(value, predicate.value) != 0;
  case PredicateKind::Less:
    return ordered_comparison(value, predicate.value) < 0;
  case PredicateKind::LessEqual:
    return ordered_comparison(value, predicate.value) <= 0;
  case PredicateKind::Greater:
    return ordered_comparison(value, predicate.value) > 0;
  case PredicateKind::GreaterEqual:
    return ordered_comparison(value, predicate.value) >= 0;
  }
  return false;
}

std::set<Key, KeyLess> table_key_set(const Table &table,
                                    const std::vector<size_t> &indices) {
  std::set<Key, KeyLess> result;
  for (const auto &row : table.rows)
    result.insert(row_key(row, indices));
  return result;
}

bool compare_sets(const std::string &operation, const Table &left,
                  const Table &right,
                  const std::optional<std::vector<std::string>> &requested) {
  std::vector<std::string> names;
  const auto left_indices = normalize_columns(left, requested, &names);
  std::vector<size_t> right_indices;
  right_indices.reserve(names.size());
  for (const auto &name : names)
    right_indices.push_back(column_index(right, name));
  const auto a = table_key_set(left, left_indices);
  const auto b = table_key_set(right, right_indices);
  if (operation == "contains") {
    if (right.rows.size() != 1)
      return false;
    return a.contains(row_key(right.rows.front(), right_indices));
  }
  if (operation == "subset")
    return std::all_of(a.begin(), a.end(),
                       [&](const Key &key) { return b.contains(key); });
  if (operation == "equal")
    return a.size() == b.size() &&
           std::all_of(a.begin(), a.end(),
                       [&](const Key &key) { return b.contains(key); });
  if (operation == "disjoint")
    return std::none_of(a.begin(), a.end(),
                        [&](const Key &key) { return b.contains(key); });
  fail("TypeError", "Неизвестная операция сравнения множеств");
}

struct Projection {
  bool from_left = true;
  size_t column = 0;
  std::string name;
};

std::vector<Projection> read_projections(const json::value &value,
                                         const Table &left,
                                         const Table &right) {
  const auto &items = array_value(value, "Проекции должны быть списком");
  std::vector<Projection> result;
  std::vector<std::string> names;
  result.reserve(items.size());
  for (const auto &item : items) {
    const auto &projection = object_value(item, "Проекция должна быть объектом");
    const std::string from = required_string(projection, "from");
    if (from != "left" && from != "right")
      fail("TypeError", "Проекция должна указывать левую или правую таблицу");
    const std::string column_name = required_string(projection, "column");
    const Table &table = from == "left" ? left : right;
    std::string name = optional_string(projection, "as").value_or(column_name);
    names.push_back(name);
    result.push_back(
        Projection{from == "left", column_index(table, column_name), name});
  }
  assert_unique_columns(names);
  return result;
}

Table join_tables(const Table &left, const Table &right,
                  const std::vector<std::pair<size_t, size_t>> &on,
                  const std::vector<Projection> &projections,
                  bool cartesian) {
  if (!cartesian && on.empty())
    fail("TypeError", "Соединение требует хотя бы один ключ");
  std::map<Key, std::vector<const Row *>, KeyLess> right_buckets;
  for (const auto &row : right.rows) {
    Key key;
    if (!cartesian) {
      key.reserve(on.size());
      for (const auto &[left_index, right_index] : on) {
        (void)left_index;
        key.push_back(row[right_index]);
      }
    }
    right_buckets[key].push_back(&row);
  }
  if (cartesian) {
    const uint64_t estimate =
        static_cast<uint64_t>(left.rows.size()) * right.rows.size();
    if (estimate > kMaximumRows)
      fail("RangeError", "Произведение превышает лимит результата");
  }
  Table result;
  for (const auto &projection : projections)
    result.columns.push_back(projection.name);
  assert_unique_columns(result.columns);
  for (const auto &left_row : left.rows) {
    Key key;
    if (!cartesian) {
      key.reserve(on.size());
      for (const auto &[left_index, right_index] : on) {
        (void)right_index;
        key.push_back(left_row[left_index]);
      }
    }
    const auto found = right_buckets.find(key);
    if (found == right_buckets.end())
      continue;
    if (result.rows.size() + found->second.size() > kMaximumRows)
      fail("RangeError", "Соединение превышает лимит результата");
    for (const Row *right_row : found->second) {
      Row row;
      row.reserve(projections.size());
      for (const auto &projection : projections)
        row.push_back(projection.from_left
                          ? left_row[projection.column]
                          : (*right_row)[projection.column]);
      result.rows.push_back(std::move(row));
    }
  }
  return result;
}

struct Aggregate {
  std::string operation;
  std::string name;
  std::optional<size_t> column;
};

Scalar aggregate_value(const Aggregate &aggregate,
                       const std::vector<const Row *> &rows) {
  if (aggregate.operation == "count") {
    if (!aggregate.column)
      return static_cast<uint64_t>(rows.size());
    const size_t index = *aggregate.column;
    const uint64_t count = std::count_if(
        rows.begin(), rows.end(),
        [&](const Row *row) { return !(*row)[index].is_null(); });
    return count;
  }
  std::vector<double> values;
  values.reserve(rows.size());
  for (const Row *row : rows) {
    const Scalar &value = (*row)[*aggregate.column];
    if (value.is_number())
      values.push_back(number_value(value));
  }
  if (values.empty())
    return nullptr;
  if (aggregate.operation == "sum")
    return stable_sum(values);
  if (aggregate.operation == "mean") {
    double scale = 0.0;
    for (const double value : values)
      scale = std::max(scale, std::abs(value));
    if (scale == 0.0)
      return 0.0;
    std::vector<double> normalized;
    normalized.reserve(values.size());
    for (const double value : values)
      normalized.push_back(value / scale);
    return scale * (stable_sum(std::move(normalized)) / values.size());
  }
  const auto bounds = std::minmax_element(values.begin(), values.end());
  return aggregate.operation == "min" ? *bounds.first : *bounds.second;
}

Table group_table(const Table &input, const std::vector<std::string> &by,
                  const json::array &aggregate_specs) {
  std::vector<size_t> group_indices;
  group_indices.reserve(by.size());
  for (const auto &column : by)
    group_indices.push_back(column_index(input, column));
  std::vector<Aggregate> aggregates;
  std::vector<std::string> output_columns = by;
  aggregates.reserve(aggregate_specs.size());
  for (const auto &item : aggregate_specs) {
    const auto &spec = object_value(item, "Агрегат должен быть объектом");
    Aggregate aggregate;
    aggregate.operation = required_string(spec, "op");
    aggregate.name = required_string(spec, "as");
    if (aggregate.operation != "count" && aggregate.operation != "sum" &&
        aggregate.operation != "min" && aggregate.operation != "max" &&
        aggregate.operation != "mean")
      fail("TypeError", "Неизвестный агрегат");
    if (const auto *column = property(spec, "column")) {
      if (!column->is_string())
        fail("TypeError", "Столбец агрегата должен быть строкой");
      aggregate.column = column_index(input, string_value(*column));
    } else if (aggregate.operation != "count") {
      fail("TypeError", "Агрегат требует указать столбец");
    }
    if (aggregate.operation == "count" && aggregate.column.has_value() == false &&
        property(spec, "column") != nullptr)
      fail("TypeError", "Столбец агрегата должен быть строкой");
    if (aggregate.operation != "count") {
      for (const auto &row : input.rows) {
        if (!row[*aggregate.column].is_number())
          fail("TypeError", "Агрегат «" + aggregate.name +
                                "» требует числовой столбец");
      }
    }
    output_columns.push_back(aggregate.name);
    aggregates.push_back(std::move(aggregate));
  }
  assert_unique_columns(output_columns);

  std::map<Key, std::vector<const Row *>, KeyLess> groups;
  for (const auto &row : input.rows)
    groups[row_key(row, group_indices)].push_back(&row);
  if (groups.size() > kMaximumRows)
    fail("RangeError", "Группировка превышает лимит результата");
  Table result;
  result.columns = std::move(output_columns);
  result.rows.reserve(groups.size());
  for (const auto &[key, members] : groups) {
    Row row = key;
    row.reserve(key.size() + aggregates.size());
    for (const auto &aggregate : aggregates)
      row.push_back(aggregate_value(aggregate, members));
    result.rows.push_back(std::move(row));
  }
  return result;
}

struct Priority {
  std::vector<std::string> columns;
  double rank = 0.0;
};

std::vector<Priority> read_priorities(
    const json::object &operation,
    const std::vector<std::string> &key_columns) {
  std::vector<Priority> result;
  const auto *input = property(operation, "priorities");
  if (input == nullptr || input->is_null())
    return result;
  const auto &items = array_value(*input, "Приоритеты должны быть списком");
  result.reserve(items.size());
  for (const auto &item : items) {
    const auto &object =
        object_value(item, "Приоритет должен быть объектом");
    Priority priority;
    priority.columns =
        string_array(required_property(object, "columns"),
                     "Приоритет должен содержать список столбцов");
    const auto *rank = property(object, "rank");
    if (rank == nullptr || !rank->is_number())
      fail("TypeError", "Приоритет должен содержать конечный ранг");
    priority.rank = number_value(*rank);
    if (!std::isfinite(priority.rank) || priority.columns.empty())
      fail("TypeError", "Приоритет должен содержать конечный ранг и ключевые измерения");
    for (const auto &column : priority.columns) {
      if (std::find(key_columns.begin(), key_columns.end(), column) ==
          key_columns.end())
        fail("TypeError", "Приоритет должен содержать конечный ранг и ключевые измерения");
    }
    result.push_back(std::move(priority));
  }
  std::stable_sort(result.begin(), result.end(),
                   [](const Priority &left, const Priority &right) {
                     return left.rank < right.rank;
                   });
  return result;
}

struct PreparedPriority {
  std::vector<size_t> source_indices;
  std::set<Key, KeyLess> reference_keys;
};

std::vector<PreparedPriority> prepare_priorities(
    const std::vector<Priority> &priorities, const Table &source,
    const std::optional<Table> &reference, const std::string &weight_column) {
  std::vector<PreparedPriority> prepared;
  prepared.reserve(priorities.size());
  for (const auto &priority : priorities) {
    PreparedPriority item;
    for (const auto &column : priority.columns)
      item.source_indices.push_back(column_index(source, column));
    if (reference.has_value()) {
      const size_t reference_weight = column_index(*reference, weight_column);
      std::vector<size_t> reference_indices;
      for (const auto &column : priority.columns)
        reference_indices.push_back(column_index(*reference, column));
      for (const auto &row : reference->rows) {
        if (number_value(row[reference_weight]) > 0.0)
          item.reference_keys.insert(row_key(row, reference_indices));
      }
    }
    prepared.push_back(std::move(item));
  }
  return prepared;
}

uint32_t priority_of(const Row &row,
                     const std::vector<PreparedPriority> &priorities,
                     bool has_reference) {
  for (size_t index = 0; index < priorities.size(); ++index) {
    if (!has_reference ||
        priorities[index].reference_keys.contains(
            row_key(row, priorities[index].source_indices)))
      return static_cast<uint32_t>(index);
  }
  return static_cast<uint32_t>(priorities.size());
}

void validate_measure_source(const Table &source, const Table *reference,
                             const std::vector<std::string> &key_columns,
                             const std::string &weight_column) {
  if (!source.weight_column.has_value() ||
      *source.weight_column != weight_column ||
      (reference != nullptr &&
       (!reference->weight_column.has_value() ||
        *reference->weight_column != weight_column)))
    fail("TypeError", "Извлечение требует согласованный столбец массы");
  assert_complete_measure_key(source, key_columns, weight_column);
  if (reference != nullptr)
    assert_complete_measure_key(*reference, key_columns, weight_column);
}

struct MeasureSplit {
  Table selected;
  Table remaining;
};

MeasureSplit take_measure(Table source, std::optional<Table> reference,
                          const std::vector<std::string> &key_columns,
                          const std::string &weight_column, double amount,
                          const std::vector<Priority> &priorities) {
  if (!std::isfinite(amount) || amount < 0.0)
    fail("RangeError",
         "Количество извлечения должно быть конечным и неотрицательным");
  validate_measure_source(source,
                          reference.has_value() ? &*reference : nullptr,
                          key_columns, weight_column);
  if (!reference.has_value() && !priorities.empty())
    fail("TypeError", "Приоритеты извлечения требуют таблицу сравнения");
  source = sum_measures_preserving_schema({source}, key_columns, weight_column);
  if (reference.has_value())
    reference = sum_measures_preserving_schema({*reference}, key_columns,
                                               weight_column);

  const size_t weight_index = column_index(source, weight_column);
  const auto prepared = prepare_priorities(priorities, source, reference,
                                           weight_column);
  std::vector<uint32_t> ranks;
  std::vector<double> masses;
  ranks.reserve(source.rows.size());
  masses.reserve(source.rows.size());
  for (const auto &row : source.rows) {
    ranks.push_back(priority_of(row, prepared, reference.has_value()));
    masses.push_back(number_value(row[weight_index]));
  }
  double left = std::min(amount, stable_sum(masses));
  std::vector<double> selected(source.rows.size(), 0.0);
  std::set<uint32_t> unique_ranks(ranks.begin(), ranks.end());
  for (const uint32_t rank : unique_ranks) {
    if (left <= 0.0)
      break;
    std::vector<size_t> bucket;
    std::vector<double> weights;
    for (size_t index = 0; index < ranks.size(); ++index) {
      if (ranks[index] == rank) {
        bucket.push_back(index);
        weights.push_back(masses[index]);
      }
    }
    if (bucket.empty())
      continue;
    const double total = stable_sum(weights);
    const double taken = std::min(left, total);
    if (taken <= 0.0 || total <= 0.0)
      continue;
    const double ratio = taken / total;
    double allocated = 0.0;
    for (size_t offset = 0; offset < bucket.size(); ++offset) {
      const size_t index = bucket[offset];
      const double value = offset + 1 == bucket.size()
                               ? taken - allocated
                               : masses[index] * ratio;
      selected[index] =
          std::min(masses[index], std::max(0.0, value));
      allocated += value;
    }
    left -= taken;
  }
  MeasureSplit result{source, source};
  result.selected.rows.clear();
  result.remaining.rows.clear();
  for (size_t index = 0; index < source.rows.size(); ++index) {
    const double taken = selected[index];
    const double rest = masses[index] - taken;
    if (taken > 0.0) {
      Row row = source.rows[index];
      row[weight_index] = taken;
      result.selected.rows.push_back(std::move(row));
    }
    if (rest > 0.0) {
      Row row = source.rows[index];
      row[weight_index] = rest;
      result.remaining.rows.push_back(std::move(row));
    }
  }
  return result;
}

Table choose_measure(Table source, std::optional<Table> reference,
                     const std::vector<std::string> &key_columns,
                     const std::string &weight_column, uint32_t seed,
                     const std::vector<Priority> &priorities) {
  validate_measure_source(source,
                          reference.has_value() ? &*reference : nullptr,
                          key_columns, weight_column);
  if (!reference.has_value() && !priorities.empty())
    fail("TypeError", "Приоритеты выбора требуют таблицу сравнения");
  source = sum_measures_preserving_schema({source}, key_columns, weight_column);
  if (reference.has_value())
    reference = sum_measures_preserving_schema({*reference}, key_columns,
                                               weight_column);
  const size_t weight_index = column_index(source, weight_column);
  const auto prepared =
      prepare_priorities(priorities, source, reference, weight_column);
  std::vector<size_t> candidates;
  uint32_t best_rank = static_cast<uint32_t>(priorities.size());
  for (size_t index = 0; index < source.rows.size(); ++index) {
    if (number_value(source.rows[index][weight_index]) <= 0.0)
      continue;
    candidates.push_back(index);
    best_rank = std::min(best_rank,
                         priority_of(source.rows[index], prepared,
                                     reference.has_value()));
  }
  if (candidates.empty()) {
    source.rows.clear();
    return source;
  }
  if (!priorities.empty()) {
    candidates.erase(
        std::remove_if(candidates.begin(), candidates.end(),
                       [&](size_t index) {
                         return priority_of(source.rows[index], prepared,
                                            reference.has_value()) != best_rank;
                       }),
        candidates.end());
  }
  const auto key_indices = normalize_columns(source, key_columns);
  std::sort(candidates.begin(), candidates.end(),
            [&](size_t left, size_t right) {
              return KeyLess{}(row_key(source.rows[left], key_indices),
                               row_key(source.rows[right], key_indices));
            });
  std::vector<double> weights;
  weights.reserve(candidates.size());
  for (const size_t index : candidates)
    weights.push_back(number_value(source.rows[index][weight_index]));
  const double total = stable_sum(weights);
  const uint32_t state = seed * 1'664'525u + 1'013'904'223u;
  const double draw =
      (static_cast<double>(state) / 4'294'967'296.0) * total;
  double running = 0.0;
  size_t selected = candidates.back();
  for (const size_t index : candidates) {
    running = stable_sum(
        {running, number_value(source.rows[index][weight_index])});
    if (draw < running) {
      selected = index;
      break;
    }
  }
  Row row = source.rows[selected];
  source.rows.assign(1, std::move(row));
  return source;
}

std::vector<std::string> optional_columns(const json::object &object,
                                          const char *name) {
  const auto *value = property(object, name);
  if (value == nullptr || value->is_null())
    return {};
  return string_array(*value, "Список ключевых столбцов должен содержать строки");
}

std::optional<Table> optional_relation(
    const json::object &operation,
    const std::map<std::string, Table> &relations,
    const char *field) {
  const auto name = optional_string(operation, field);
  if (!name.has_value())
    return std::nullopt;
  const auto found = relations.find(*name);
  if (found == relations.end())
    fail("TypeError", "Неизвестная таблица «" + *name + "»");
  return found->second;
}

const Table &require_relation(const std::map<std::string, Table> &relations,
                              const std::string &name) {
  const auto found = relations.find(name);
  if (found == relations.end())
    fail("TypeError", "Неизвестная таблица «" + name + "»");
  return found->second;
}

json::object error_response(const char *name, const std::string &message) {
  json::object error;
  error.emplace("name", name);
  error.emplace("message", message);
  json::object result;
  result.emplace("ok", false);
  result.emplace("error", std::move(error));
  return result;
}

json::object success_response(json::object result) {
  json::object response;
  response.emplace("ok", true);
  response.emplace("result", std::move(result));
  return response;
}

json::object run_query(const json::value &query) {
  const auto &query_object =
      object_value(query, "Некорректный дескриптор запроса алгебры");
  const auto *inputs_value = property(query_object, "inputs");
  const auto *operations_value = property(query_object, "operations");
  if (inputs_value == nullptr || !inputs_value->is_object() ||
      operations_value == nullptr || !operations_value->is_array())
    fail("TypeError", "Некорректный дескриптор запроса алгебры");

  std::map<std::string, Table> relations;
  for (const auto &entry : inputs_value->as_object()) {
    const std::string name(entry.key_c_str());
    if (name.empty())
      fail("TypeError", "имя входной таблицы должно быть непустой строкой");
    relations.emplace(name, read_table(entry.value()));
  }
  json::object tables;
  json::object values;
  json::object selections;
  std::set<std::string> result_ids;

  for (const auto &operation_value : operations_value->as_array()) {
    const auto &operation =
        object_value(operation_value, "Операция должна быть объектом");
    const std::string id = required_string(operation, "id");
    if (id.empty())
      fail("TypeError", "имя результата должно быть непустой строкой");
    if (relations.contains(id) || result_ids.contains(id))
      fail("TypeError", "Повторяется имя результата «" + id + "»");
    result_ids.insert(id);
    const std::string op = required_string(operation, "op");

    if (op == "set") {
      const Table &left = require_relation(
          relations, required_string(operation, "left"));
      const std::string mode_text = required_string(operation, "mode");
      const SetMode mode = parse_set_mode(mode_text);
      const std::string kind_text = required_string(operation, "kind");
      const SetKind kind = parse_set_kind(kind_text);
      const auto requested = optional_columns(operation, "keyColumns");
      std::optional<std::vector<std::string>> key_columns;
      if (!requested.empty())
        key_columns = requested;
      else if (property(operation, "keyColumns") != nullptr) {
        const auto &value = *property(operation, "keyColumns");
        if (!value.is_array())
          fail("TypeError", "Список ключевых столбцов должен содержать строки");
        key_columns = requested;
      }
      const char *other_field = kind == SetKind::Complement ? "universe" : "right";
      const std::string other_name =
          optional_string(operation, other_field).value_or("");
      const Table &right = require_relation(relations, other_name);
      Table result = set_operation(left, right, kind, mode, key_columns);
      relations[id] = result;
      tables.emplace(id, table_json(result));
      continue;
    }
    if (op == "measureSum") {
      const auto &input_names =
          array_value(required_property(operation, "inputs"),
                      "Список входных таблиц должен быть массивом");
      std::vector<Table> inputs;
      inputs.reserve(input_names.size());
      for (const auto &name_value : input_names) {
        if (!name_value.is_string())
          fail("TypeError", "Имя входной таблицы должно быть строкой");
        inputs.push_back(require_relation(relations, string_value(name_value)));
      }
      const auto keys = string_array(
          required_property(operation, "keyColumns"),
          "Список ключевых столбцов должен содержать строки");
      const std::string weight = required_string(operation, "weightColumn");
      Table result = sum_measures_projected(inputs, keys, weight);
      relations[id] = result;
      tables.emplace(id, table_json(result));
      continue;
    }
    if (op == "contains" || op == "subset" || op == "equal" ||
        op == "disjoint") {
      const Table &left = require_relation(
          relations, required_string(operation, "left"));
      const Table &right = require_relation(
          relations, required_string(operation, "right"));
      const auto requested = optional_columns(operation, "keyColumns");
      std::optional<std::vector<std::string>> key_columns;
      if (!requested.empty())
        key_columns = requested;
      else if (property(operation, "keyColumns") != nullptr)
        key_columns = requested;
      values.emplace(id, compare_sets(op, left, right, key_columns));
      continue;
    }
    if (op == "filter" || op == "partition") {
      const std::string input_name = required_string(operation, "input");
      const Table &input = require_relation(relations, input_name);
      const Predicate predicate =
          read_predicate(required_property(operation, "where"), input);
      Table yes = input, no = input;
      yes.rows.clear();
      no.rows.clear();
      for (const auto &row : input.rows)
        (test_predicate(predicate, row) ? yes.rows : no.rows).push_back(row);
      if (op == "filter") {
        relations[id] = yes;
        tables.emplace(id, table_json(yes));
      } else {
        relations[id + ":true"] = yes;
        relations[id + ":false"] = no;
        tables.emplace(id + ":true", table_json(yes));
        tables.emplace(id + ":false", table_json(no));
        json::object selection;
        selection.emplace("selected", table_json(yes));
        selection.emplace("remaining", table_json(no));
        selections.emplace(id, std::move(selection));
      }
      continue;
    }
    if (op == "project") {
      const Table &input = require_relation(
          relations, required_string(operation, "input"));
      const auto &specs =
          array_value(required_property(operation, "columns"),
                      "Проекции должны быть списком");
      std::vector<std::string> columns;
      std::vector<size_t> indices;
      for (const auto &item : specs) {
        const auto &projection =
            object_value(item, "Проекция должна быть объектом");
        const std::string from = required_string(projection, "from");
        const std::string as =
            optional_string(projection, "as").value_or(from);
        columns.push_back(as);
        indices.push_back(column_index(input, from));
      }
      assert_unique_columns(columns);
      Table result;
      result.columns = columns;
      if (input.weight_column.has_value()) {
        const size_t weight_index =
            column_index(input, *input.weight_column);
        const auto found = std::find(indices.begin(), indices.end(), weight_index);
        if (found != indices.end())
          result.weight_column = columns[static_cast<size_t>(found - indices.begin())];
      }
      result.rows.reserve(input.rows.size());
      for (const auto &source : input.rows) {
        Row row;
        row.reserve(indices.size());
        for (const size_t index : indices)
          row.push_back(source[index]);
        result.rows.push_back(std::move(row));
      }
      relations[id] = result;
      tables.emplace(id, table_json(result));
      continue;
    }
    if (op == "product" || op == "join") {
      const Table &left = require_relation(
          relations, required_string(operation, "left"));
      const Table &right = require_relation(
          relations, required_string(operation, "right"));
      std::vector<std::pair<size_t, size_t>> on;
      if (op == "join") {
        const auto &keys =
            array_value(required_property(operation, "on"),
                        "Соединение требует список ключей");
        for (const auto &pair_value : keys) {
          const auto &pair =
              object_value(pair_value, "Ключ соединения должен быть объектом");
          on.emplace_back(
              column_index(left, required_string(pair, "left")),
              column_index(right, required_string(pair, "right")));
        }
      }
      std::vector<Projection> projections;
      if (const auto *columns = property(operation, "columns")) {
        projections = read_projections(*columns, left, right);
      } else {
        for (size_t index = 0; index < left.columns.size(); ++index)
          projections.push_back(Projection{true, index,
                                           "left." + left.columns[index]});
        for (size_t index = 0; index < right.columns.size(); ++index)
          projections.push_back(Projection{false, index,
                                           "right." + right.columns[index]});
        std::vector<std::string> names;
        for (const auto &projection : projections)
          names.push_back(projection.name);
        assert_unique_columns(names);
      }
      Table result = join_tables(left, right, on, projections, op == "product");
      relations[id] = result;
      tables.emplace(id, table_json(result));
      continue;
    }
    if (op == "group") {
      const Table &input = require_relation(
          relations, required_string(operation, "input"));
      const auto by = string_array(
          required_property(operation, "by"),
          "Список группировки должен содержать строки");
      const auto &aggregates =
          array_value(required_property(operation, "aggregates"),
                      "Агрегаты должны быть списком");
      Table result = group_table(input, by, aggregates);
      relations[id] = result;
      tables.emplace(id, table_json(result));
      continue;
    }
    if (op == "choose") {
      const std::string input_name = required_string(operation, "input");
      Table source = require_relation(relations, input_name);
      std::optional<Table> reference =
          optional_relation(operation, relations, "reference");
      const auto keys = string_array(
          required_property(operation, "keyColumns"),
          "Список ключевых столбцов должен содержать строки");
      const std::string weight = required_string(operation, "weightColumn");
      const double seed_number = required_number(operation, "seed");
      if (seed_number < 0.0 || seed_number > UINT32_MAX ||
          std::floor(seed_number) != seed_number)
        fail("RangeError", "Начальное значение выбора должно быть uint32");
      const auto priorities = read_priorities(operation, keys);
      Table result = choose_measure(std::move(source), std::move(reference),
                                    keys, weight,
                                    static_cast<uint32_t>(seed_number),
                                    priorities);
      relations[id] = result;
      tables.emplace(id, table_json(result));
      continue;
    }
    if (op == "take" || op == "remove" || op == "transfer") {
      const std::string input_name = required_string(operation, "input");
      Table source = require_relation(relations, input_name);
      std::optional<Table> reference =
          optional_relation(operation, relations, "reference");
      const auto keys = string_array(
          required_property(operation, "keyColumns"),
          "Список ключевых столбцов должен содержать строки");
      const std::string weight = required_string(operation, "weightColumn");
      const double amount = required_number(operation, "amount");
      const auto priorities = read_priorities(operation, keys);
      MeasureSplit split = take_measure(std::move(source), std::move(reference),
                                        keys, weight, amount, priorities);
      std::optional<Table> destination;
      if (op == "transfer") {
        const std::string destination_name =
            required_string(operation, "destination");
        destination = require_relation(relations, destination_name);
        destination = sum_measures_preserving_schema(
            {*destination, split.selected}, keys, weight);
      }
      relations[id] = split.remaining;
      relations[id + ":selected"] = split.selected;
      relations[id + ":remaining"] = split.remaining;
      tables.emplace(id + ":selected", table_json(split.selected));
      tables.emplace(id + ":remaining", table_json(split.remaining));
      json::object selection;
      selection.emplace("selected", table_json(split.selected));
      selection.emplace("remaining", table_json(split.remaining));
      if (destination.has_value()) {
        relations[id + ":destination"] = *destination;
        tables.emplace(id + ":destination", table_json(*destination));
        selection.emplace("destination", table_json(*destination));
      }
      selections.emplace(id, std::move(selection));
      continue;
    }
    fail("TypeError", "Неизвестная операция алгебры: " + op);
  }

  json::object result;
  result.emplace("tables", std::move(tables));
  result.emplace("values", std::move(values));
  result.emplace("selections", std::move(selections));
  return result;
}

} // namespace

extern "C" zk_error zk_algebra_query(const char *request,
                                      uint32_t request_length,
                                      char *response,
                                      uint32_t response_capacity,
                                      uint32_t *response_length) {
  if (response_length == nullptr ||
      (request_length != 0 && request == nullptr) ||
      (response_capacity != 0 && response == nullptr) ||
      request_length > ZK_MEMORY_LIMIT_BYTES ||
      response_capacity > ZK_MEMORY_LIMIT_BYTES)
    return ZK_ERROR_INVALID_ARGUMENT;
  try {
    json::object response_object;
    boost::system::error_code parse_error;
    const auto parsed = json::parse(
        std::string_view(request == nullptr ? "" : request, request_length),
        parse_error);
    if (parse_error) {
      response_object = error_response(
          "TypeError", "Некорректный дескриптор запроса алгебры");
    } else {
      try {
        response_object = success_response(run_query(parsed));
      } catch (const QueryFailure &failure) {
        response_object = error_response(failure.name, failure.message);
      }
    }
    const std::string encoded = json::serialize(response_object);
    if (encoded.size() > ZK_MEMORY_LIMIT_BYTES ||
        encoded.size() > std::numeric_limits<uint32_t>::max())
      return ZK_ERROR_OUT_OF_RANGE;
    *response_length = static_cast<uint32_t>(encoded.size());
    if (response_capacity < encoded.size())
      return ZK_ERROR_OUT_OF_RANGE;
    if (!encoded.empty())
      std::copy(encoded.begin(), encoded.end(), response);
    return ZK_OK;
  } catch (const std::bad_alloc &) {
    return ZK_ERROR_OUT_OF_MEMORY;
  } catch (...) {
    return ZK_ERROR_INTERNAL;
  }
}
