#include "zero_kernel.h"

#include <cassert>
#include <cmath>
#include <cstdint>
#include <limits>

int main() {
  const uint32_t left[] = {1, 3, 9};
  const uint32_t right[] = {2, 3, 8};
  uint32_t output[6] = {};
  uint32_t count = 0;

  assert(zk_set_binary(ZK_SET_UNION, left, 3, right, 3, output, 6, &count) ==
         ZK_OK);
  assert(count == 5);
  assert(output[0] == 1 && output[1] == 2 && output[2] == 3 &&
         output[3] == 8 && output[4] == 9);

  const uint32_t invalid[] = {2, 1};
  output[0] = 77;
  count = 88;
  assert(zk_set_binary(ZK_SET_UNION, invalid, 2, right, 3, output, 6,
                       &count) == ZK_ERROR_INVALID_ARGUMENT);
  assert(output[0] == 77 && count == 88);
  assert(zk_set_binary(ZK_SET_UNION, left, 3, right, 3, output, 1, &count) ==
         ZK_ERROR_OUT_OF_RANGE);
  assert(output[0] == 77 && count == 88);

  const uint32_t a_keys[] = {
      1, UINT32_MAX, 4, 2, 1, 7, 4, 2, 1, 7, 4, 2,
  };
  const double a_mass[] = {0.125, 5.5, 1.75};
  const uint32_t b_keys[] = {
      1, UINT32_MAX, 4, 2, 1, 7, 4, 2, 2, 7, 4, 3,
  };
  const double b_mass[] = {0.5, 0.25, 3.25};
  uint32_t group_keys[24] = {};
  double group_mass[6] = {};

  assert(zk_measure_binary(ZK_MEASURE_UNION, a_keys, a_mass, 3, b_keys,
                           b_mass, 3, group_keys, group_mass, 6, &count) ==
         ZK_OK);
  assert(count == 3);
  assert(group_keys[0] == 1 && group_keys[1] == 7);
  assert(group_keys[4] == 1 && group_keys[5] == UINT32_MAX);
  assert(std::abs(group_mass[0] - 7.25) < 1e-12);
  assert(std::abs(group_mass[1] - 0.5) < 1e-12);
  assert(group_mass[2] == 3.25);

  const uint32_t duplicate_keys[] = {
      2, 7, 4, 2, 1, 7, 4, 2, 2, 7, 4, 2, 1, UINT32_MAX, 4, 2,
  };
  const double duplicate_mass[] = {0.2, 0.3, 0.5, 0.1};
  assert(zk_measure_sum(duplicate_keys, duplicate_mass, 4, group_keys,
                        group_mass, 6, &count) == ZK_OK);
  assert(count == 3);
  assert(group_keys[0] == 1 && group_keys[1] == 7);
  assert(group_keys[4] == 1 && group_keys[5] == UINT32_MAX);
  assert(group_keys[8] == 2 && group_keys[9] == 7);
  assert(std::abs(group_mass[0] - 0.3) < 1e-12);
  assert(std::abs(group_mass[1] - 0.1) < 1e-12);
  assert(std::abs(group_mass[2] - 0.7) < 1e-12);

  uint32_t single_key[] = {1, 2, 3, 4};
  const double zero_mass[] = {0.0};
  assert(zk_measure_sum(single_key, zero_mass, 1, nullptr, nullptr, 0, &count) ==
         ZK_OK);
  assert(count == 0);

  const double invalid_mass[] = {-1.0};
  group_mass[0] = 91.0;
  count = 92;
  assert(zk_measure_sum(single_key, invalid_mass, 1, group_keys, group_mass, 6,
                        &count) == ZK_ERROR_INVALID_ARGUMENT);
  assert(group_mass[0] == 91.0 && count == 92);

  const double overflowing_mass[] = {std::numeric_limits<double>::max(),
                                      std::numeric_limits<double>::max()};
  const uint32_t overflowing_keys[] = {1, 2, 3, 4, 1, 2, 3, 4};
  assert(zk_measure_sum(overflowing_keys, overflowing_mass, 2, group_keys,
                        group_mass, 6, &count) == ZK_ERROR_OVERFLOW);
  assert(group_mass[0] == 91.0 && count == 92);
  return 0;
}
