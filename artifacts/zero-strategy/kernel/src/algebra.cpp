#include "zero_kernel.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <map>
#include <new>
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
