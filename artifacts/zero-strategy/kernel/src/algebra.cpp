#include "zero_kernel.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <map>
#include <new>
#include <set>
#include <utility>
#include <vector>

namespace {

using PopulationKey = std::array<uint32_t, ZK_POPULATION_KEY_WIDTH>;
using PopulationMap = std::map<PopulationKey, std::vector<double>>;

bool valid_set(const uint32_t *values, uint32_t count) {
  if (count != 0 && values == nullptr)
    return false;
  for (uint32_t index = 1; index < count; ++index) {
    if (values[index - 1] >= values[index])
      return false;
  }
  return true;
}

double stable_sum(std::vector<double> values) {
  std::sort(values.begin(), values.end());
  double sum = 0.0;
  double correction = 0.0;
  for (const double value : values) {
    const double adjusted = value - correction;
    const double next = sum + adjusted;
    correction = (next - sum) - adjusted;
    sum = next;
  }
  return sum;
}

zk_error populate_map(const uint32_t *keys, const double *mass,
                     uint32_t count, PopulationMap *result) {
  if (count != 0 && (keys == nullptr || mass == nullptr))
    return ZK_ERROR_INVALID_ARGUMENT;
  for (uint32_t index = 0; index < count; ++index) {
    if (!std::isfinite(mass[index]) || mass[index] < 0.0)
      return ZK_ERROR_INVALID_ARGUMENT;
    PopulationKey key{};
    for (uint32_t field = 0; field < ZK_POPULATION_KEY_WIDTH; ++field)
      key[field] = keys[static_cast<size_t>(index) * ZK_POPULATION_KEY_WIDTH + field];
    (*result)[key].push_back(mass[index]);
  }
  for (auto iterator = result->begin(); iterator != result->end();) {
    const double total = stable_sum(std::move(iterator->second));
    if (!std::isfinite(total))
      return ZK_ERROR_OVERFLOW;
    iterator->second.clear();
    iterator->second.push_back(total);
    ++iterator;
  }
  return ZK_OK;
}

double mass_at(const PopulationMap &groups, const PopulationKey &key) {
  const auto found = groups.find(key);
  return found == groups.end() ? 0.0 : found->second.front();
}

bool valid_measure_operation(zk_measure_operation operation) {
  return operation >= ZK_MEASURE_UNION &&
         operation <= ZK_MEASURE_COMPLEMENT;
}

} // пространство имён

extern "C" zk_error zk_set_binary(zk_set_operation operation,
                                    const uint32_t *left,
                                    uint32_t left_count,
                                    const uint32_t *right,
                                    uint32_t right_count,
                                    uint32_t *output,
                                    uint32_t output_capacity,
                                    uint32_t *result_count) {
  if (result_count == nullptr)
    return ZK_ERROR_INVALID_ARGUMENT;
  if (operation < ZK_SET_UNION || operation > ZK_SET_COMPLEMENT ||
      !valid_set(left, left_count) || !valid_set(right, right_count))
    return ZK_ERROR_INVALID_ARGUMENT;
  if (left_count > UINT32_MAX - right_count)
    return ZK_ERROR_OUT_OF_RANGE;

  try {
    std::vector<uint32_t> result;
    result.reserve(static_cast<size_t>(left_count) + right_count);
    uint32_t a = 0;
    uint32_t b = 0;
    while (a < left_count || b < right_count) {
      if (a == left_count) {
        if (operation == ZK_SET_UNION || operation == ZK_SET_SYMMETRIC_DIFFERENCE ||
            operation == ZK_SET_COMPLEMENT)
          result.push_back(right[b]);
        ++b;
      } else if (b == right_count) {
        if (operation == ZK_SET_UNION || operation == ZK_SET_DIFFERENCE ||
            operation == ZK_SET_SYMMETRIC_DIFFERENCE)
          result.push_back(left[a]);
        ++a;
      } else if (left[a] == right[b]) {
        if (operation == ZK_SET_UNION || operation == ZK_SET_INTERSECTION)
          result.push_back(left[a]);
        ++a;
        ++b;
      } else if (left[a] < right[b]) {
        if (operation == ZK_SET_UNION || operation == ZK_SET_DIFFERENCE ||
            operation == ZK_SET_SYMMETRIC_DIFFERENCE)
          result.push_back(left[a]);
        ++a;
      } else {
        if (operation == ZK_SET_UNION || operation == ZK_SET_SYMMETRIC_DIFFERENCE ||
            operation == ZK_SET_COMPLEMENT)
          result.push_back(right[b]);
        ++b;
      }
    }
    if (result.size() > output_capacity ||
        (!result.empty() && output == nullptr))
      return ZK_ERROR_OUT_OF_RANGE;
    if (!result.empty())
      std::copy(result.begin(), result.end(), output);
    *result_count = static_cast<uint32_t>(result.size());
    return ZK_OK;
  } catch (const std::bad_alloc &) {
    return ZK_ERROR_OUT_OF_MEMORY;
  }
}

extern "C" zk_error zk_measure_binary(
    zk_measure_operation operation, const uint32_t *left_keys,
    const double *left_mass, uint32_t left_count, const uint32_t *right_keys,
    const double *right_mass, uint32_t right_count, uint32_t *output_keys,
    double *output_mass, uint32_t output_capacity, uint32_t *result_count) {
  if (result_count == nullptr)
    return ZK_ERROR_INVALID_ARGUMENT;
  if (!valid_measure_operation(operation))
    return ZK_ERROR_INVALID_ARGUMENT;

  try {
    PopulationMap left;
    PopulationMap right;
    zk_error error =
        populate_map(left_keys, left_mass, left_count, &left);
    if (error != ZK_OK)
      return error;
    error = populate_map(right_keys, right_mass, right_count, &right);
    if (error != ZK_OK)
      return error;

    std::vector<std::pair<PopulationKey, double>> result;
    auto a = left.begin();
    auto b = right.begin();
    while (a != left.end() || b != right.end()) {
      PopulationKey key{};
      double left_value = 0.0;
      double right_value = 0.0;
      if (b == right.end() || (a != left.end() && a->first < b->first)) {
        key = a->first;
        left_value = a->second.front();
        ++a;
      } else if (a == left.end() || b->first < a->first) {
        key = b->first;
        right_value = b->second.front();
        ++b;
      } else {
        key = a->first;
        left_value = a->second.front();
        right_value = b->second.front();
        ++a;
        ++b;
      }
      double value = 0.0;
      switch (operation) {
      case ZK_MEASURE_UNION:
        value = std::max(left_value, right_value);
        break;
      case ZK_MEASURE_INTERSECTION:
        value = std::min(left_value, right_value);
        break;
      case ZK_MEASURE_DIFFERENCE:
        value = std::max(0.0, left_value - right_value);
        break;
      case ZK_MEASURE_SYMMETRIC_DIFFERENCE:
        value = std::abs(left_value - right_value);
        break;
      case ZK_MEASURE_COMPLEMENT:
        value = std::max(0.0, right_value - left_value);
        break;
      }
      if (!std::isfinite(value))
        return ZK_ERROR_OVERFLOW;
      if (value > 0.0)
        result.emplace_back(key, value);
    }

    if (result.size() > output_capacity ||
        (!result.empty() && (output_keys == nullptr || output_mass == nullptr)))
      return ZK_ERROR_OUT_OF_RANGE;
    for (size_t index = 0; index < result.size(); ++index) {
      for (uint32_t field = 0; field < ZK_POPULATION_KEY_WIDTH; ++field)
        output_keys[index * ZK_POPULATION_KEY_WIDTH + field] = result[index].first[field];
      output_mass[index] = result[index].second;
    }
    *result_count = static_cast<uint32_t>(result.size());
    return ZK_OK;
  } catch (const std::bad_alloc &) {
    return ZK_ERROR_OUT_OF_MEMORY;
  }
}

extern "C" zk_error zk_measure_sum(const uint32_t *keys, const double *mass,
                                     uint32_t count, uint32_t *output_keys,
                                     double *output_mass,
                                     uint32_t output_capacity,
                                     uint32_t *result_count) {
  if (result_count == nullptr)
    return ZK_ERROR_INVALID_ARGUMENT;
  try {
    PopulationMap groups;
    const zk_error error = populate_map(keys, mass, count, &groups);
    if (error != ZK_OK)
      return error;
    size_t nonzero_count = 0;
    for (const auto &[key, values] : groups) {
      (void)key;
      if (values.front() > 0.0)
        ++nonzero_count;
    }
    if (nonzero_count > output_capacity ||
        (nonzero_count != 0 && (output_keys == nullptr || output_mass == nullptr)))
      return ZK_ERROR_OUT_OF_RANGE;
    size_t index = 0;
    for (const auto &[key, values] : groups) {
      if (values.front() == 0.0)
        continue;
      for (uint32_t field = 0; field < ZK_POPULATION_KEY_WIDTH; ++field)
        output_keys[index * ZK_POPULATION_KEY_WIDTH + field] = key[field];
      output_mass[index] = values.front();
      ++index;
    }
    *result_count = static_cast<uint32_t>(index);
    return ZK_OK;
  } catch (const std::bad_alloc &) {
    return ZK_ERROR_OUT_OF_MEMORY;
  }
}

extern "C" zk_error zk_measure_take_priority(
    const uint32_t *source_keys, const double *source_mass,
    uint32_t source_count, const uint32_t *reference_keys,
    const double *reference_mass, uint32_t reference_count,
    const uint32_t priority_order[3], double amount,
    uint32_t *selected_keys, double *selected_mass,
    uint32_t selected_capacity, uint32_t *selected_count,
    uint32_t *remaining_keys, double *remaining_mass,
    uint32_t remaining_capacity, uint32_t *remaining_count) {
  if (selected_count == nullptr || remaining_count == nullptr ||
      priority_order == nullptr || !std::isfinite(amount) || amount < 0.0 ||
      (source_count != 0 && (source_keys == nullptr || source_mass == nullptr)) ||
      (reference_count != 0 &&
       (reference_keys == nullptr || reference_mass == nullptr)) ||
      source_count > ZK_MAX_BUFFER_SLOTS * 1024u ||
      reference_count > ZK_MAX_BUFFER_SLOTS * 1024u)
    return ZK_ERROR_INVALID_ARGUMENT;

  bool seen[3] = {false, false, false};
  for (uint32_t index = 0; index < 3; ++index) {
    if (priority_order[index] >= 3 || seen[priority_order[index]])
      return ZK_ERROR_INVALID_ARGUMENT;
    seen[priority_order[index]] = true;
  }

  try {
    struct Entry {
      PopulationKey key{};
      std::vector<double> parts;
      double mass = 0.0;
      double selected = 0.0;
      uint32_t tier = 2;
    };
    std::vector<Entry> entries;
    std::map<PopulationKey, size_t> positions;
    entries.reserve(source_count);
    for (uint32_t index = 0; index < source_count; ++index) {
      const double value = source_mass[index];
      if (!std::isfinite(value) || value < 0.0)
        return ZK_ERROR_INVALID_ARGUMENT;
      if (value == 0.0)
        continue;
      PopulationKey key{};
      for (uint32_t field = 0; field < ZK_POPULATION_KEY_WIDTH; ++field)
        key[field] = source_keys[static_cast<size_t>(index) *
                                     ZK_POPULATION_KEY_WIDTH +
                                 field];
      auto [found, inserted] = positions.emplace(key, entries.size());
      if (inserted)
        entries.push_back(Entry{key});
      entries[found->second].parts.push_back(value);
    }

    std::set<uint32_t> cultures;
    std::set<uint32_t> religions;
    std::set<std::pair<uint32_t, uint32_t>> pairs;
    for (uint32_t index = 0; index < reference_count; ++index) {
      const double value = reference_mass[index];
      if (!std::isfinite(value) || value < 0.0)
        return ZK_ERROR_INVALID_ARGUMENT;
      if (value == 0.0)
        continue;
      const uint32_t culture = reference_keys[
          static_cast<size_t>(index) * ZK_POPULATION_KEY_WIDTH];
      const uint32_t religion = reference_keys[
          static_cast<size_t>(index) * ZK_POPULATION_KEY_WIDTH + 1];
      cultures.insert(culture);
      religions.insert(religion);
      pairs.emplace(culture, religion);
    }

    std::vector<double> all_masses;
    all_masses.reserve(entries.size());
    for (Entry &entry : entries) {
      entry.mass = stable_sum(std::move(entry.parts));
      if (!std::isfinite(entry.mass))
        return ZK_ERROR_OVERFLOW;
      all_masses.push_back(entry.mass);
      const bool same_culture = cultures.contains(entry.key[0]);
      const bool same_religion = religions.contains(entry.key[1]);
      const bool same_pair = pairs.contains({entry.key[0], entry.key[1]});
      entry.tier = same_culture && same_religion && same_pair
                       ? 0u
                       : (same_culture || same_religion ? 1u : 2u);
    }
    double left = std::min(amount, stable_sum(std::move(all_masses)));
    for (uint32_t priority = 0; priority < 3; ++priority) {
      if (left <= 0.0)
        break;
      const uint32_t tier = priority_order[priority];
      std::vector<size_t> bucket;
      std::vector<double> weights;
      for (size_t index = 0; index < entries.size(); ++index) {
        if (entries[index].tier == tier) {
          bucket.push_back(index);
          weights.push_back(entries[index].mass);
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
      double selected_sum = 0.0;
      for (size_t offset = 0; offset < bucket.size(); ++offset) {
        Entry &entry = entries[bucket[offset]];
        const double value = offset + 1 == bucket.size()
                                 ? taken - allocated
                                 : entry.mass * ratio;
        entry.selected = std::min(entry.mass, std::max(0.0, value));
        allocated += value;
        selected_sum += entry.selected;
      }
      left -= selected_sum;
    }

    uint32_t selected_required = 0;
    uint32_t remaining_required = 0;
    for (const Entry &entry : entries) {
      if (entry.selected > 0.0)
        ++selected_required;
      if (entry.mass - entry.selected > 0.0)
        ++remaining_required;
    }
    *selected_count = selected_required;
    *remaining_count = remaining_required;
    if (selected_required > selected_capacity ||
        remaining_required > remaining_capacity ||
        (selected_required != 0 &&
         (selected_keys == nullptr || selected_mass == nullptr)) ||
        (remaining_required != 0 &&
         (remaining_keys == nullptr || remaining_mass == nullptr)))
      return ZK_ERROR_OUT_OF_RANGE;

    uint32_t selected_index = 0;
    uint32_t remaining_index = 0;
    for (const Entry &entry : entries) {
      if (entry.selected > 0.0) {
        for (uint32_t field = 0; field < ZK_POPULATION_KEY_WIDTH; ++field)
          selected_keys[static_cast<size_t>(selected_index) *
                            ZK_POPULATION_KEY_WIDTH +
                        field] = entry.key[field];
        selected_mass[selected_index++] = entry.selected;
      }
      const double remaining = entry.mass - entry.selected;
      if (remaining > 0.0) {
        for (uint32_t field = 0; field < ZK_POPULATION_KEY_WIDTH; ++field)
          remaining_keys[static_cast<size_t>(remaining_index) *
                             ZK_POPULATION_KEY_WIDTH +
                         field] = entry.key[field];
        remaining_mass[remaining_index++] = remaining;
      }
    }
    return ZK_OK;
  } catch (const std::bad_alloc &) {
    return ZK_ERROR_OUT_OF_MEMORY;
  }
}

extern "C" zk_error zk_measure_product(
    const uint32_t *left_keys, const double *left_mass, uint32_t left_count,
    const uint32_t *right_keys, const double *right_mass,
    uint32_t right_count, const uint32_t output_sources[4],
    double product_divisor, double multiplier, double final_divisor,
    uint32_t divide_by_right_total, uint32_t drop_zero_mass,
    uint32_t *output_keys, double *output_mass, uint32_t output_capacity,
    uint32_t *result_count) {
  if (result_count == nullptr || output_sources == nullptr ||
      (left_count != 0 && (left_keys == nullptr || left_mass == nullptr)) ||
      (right_count != 0 && (right_keys == nullptr || right_mass == nullptr)) ||
      !std::isfinite(product_divisor) || product_divisor <= 0.0 ||
      !std::isfinite(multiplier) || multiplier < 0.0 ||
      !std::isfinite(final_divisor) || final_divisor <= 0.0 ||
      divide_by_right_total > 1u || drop_zero_mass > 1u ||
      left_count > ZK_MAX_BUFFER_SLOTS * 1024u ||
      right_count > ZK_MAX_BUFFER_SLOTS * 1024u)
    return ZK_ERROR_INVALID_ARGUMENT;

  for (uint32_t field = 0; field < ZK_POPULATION_KEY_WIDTH; ++field) {
    if (output_sources[field] > 8u)
      return ZK_ERROR_INVALID_ARGUMENT;
  }
  const uint64_t product_count =
      static_cast<uint64_t>(left_count) * static_cast<uint64_t>(right_count);
  if (product_count > ZK_MAX_BUFFER_SLOTS * 1024ull)
    return ZK_ERROR_OUT_OF_RANGE;
  if (product_count > output_capacity ||
      (product_count != 0 && (output_keys == nullptr || output_mass == nullptr)))
    return ZK_ERROR_OUT_OF_RANGE;

  double right_total = 0.0;
  for (uint32_t index = 0; index < left_count; ++index) {
    if (!std::isfinite(left_mass[index]) || left_mass[index] < 0.0)
      return ZK_ERROR_INVALID_ARGUMENT;
  }
  for (uint32_t index = 0; index < right_count; ++index) {
    if (!std::isfinite(right_mass[index]) || right_mass[index] < 0.0)
      return ZK_ERROR_INVALID_ARGUMENT;
    if (divide_by_right_total) {
      right_total += right_mass[index];
      if (!std::isfinite(right_total))
        return ZK_ERROR_OVERFLOW;
    }
  }
  const double denominator =
      divide_by_right_total ? right_total : final_divisor;
  if (divide_by_right_total && denominator <= 0.0)
    return ZK_ERROR_INVALID_ARGUMENT;

  uint32_t output_index = 0;
  for (uint32_t left_index = 0; left_index < left_count; ++left_index) {
    const double left_value = left_mass[left_index];
    for (uint32_t right_index = 0; right_index < right_count; ++right_index) {
      const double right_value = right_mass[right_index];
      double value = left_value * right_value;
      if (!std::isfinite(value))
        return ZK_ERROR_OVERFLOW;
      value /= product_divisor;
      value *= multiplier;
      value /= denominator;
      if (!std::isfinite(value))
        return ZK_ERROR_OVERFLOW;
      if (drop_zero_mass && value == 0.0)
        continue;

      for (uint32_t field = 0; field < ZK_POPULATION_KEY_WIDTH; ++field) {
        const uint32_t source = output_sources[field];
        const uint32_t key = source < ZK_POPULATION_KEY_WIDTH
                                 ? left_keys[static_cast<size_t>(left_index) *
                                                 ZK_POPULATION_KEY_WIDTH +
                                             source]
                                 : source < 2u * ZK_POPULATION_KEY_WIDTH
                                       ? right_keys[
                                             static_cast<size_t>(right_index) *
                                                 ZK_POPULATION_KEY_WIDTH +
                                             (source - ZK_POPULATION_KEY_WIDTH)]
                                       : 0u;
        output_keys[static_cast<size_t>(output_index) *
                        ZK_POPULATION_KEY_WIDTH +
                    field] = key;
      }
      output_mass[output_index++] = value;
    }
  }
  *result_count = output_index;
  return ZK_OK;
}
