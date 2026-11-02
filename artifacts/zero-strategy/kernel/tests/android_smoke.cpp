#include "zero_kernel.h"

#include <cstdint>

int main() {
  if (zk_abi_version() != ZK_ABI_VERSION)
    return 1;

  int32_t sum = 0;
  if (zk_i32_add(19, 23, &sum) != ZK_OK || sum != 42)
    return 2;

  zk_handle handle = 0;
  if (zk_buffer_create(ZK_BUFFER_I32, 3, &handle) != ZK_OK)
    return 3;

  uint32_t bytes = 0;
  zk_error error = ZK_OK;
  void *data = zk_buffer_data(handle, &bytes, &error);
  if (error != ZK_OK || data == nullptr || bytes != 3 * sizeof(int32_t))
    return 4;

  auto *values = static_cast<int32_t *>(data);
  values[0] = 7;
  values[1] = 11;
  values[2] = 24;

  int64_t buffer_sum = 0;
  if (zk_buffer_i32_sum(handle, 0, 3, &buffer_sum) != ZK_OK ||
      buffer_sum != 42)
    return 5;

  if (zk_buffer_release(handle) != ZK_OK)
    return 6;
  uint32_t stale_size = 0;
  if (zk_buffer_size(handle, &stale_size) != ZK_ERROR_STALE_HANDLE)
    return 7;
  return 0;
}
