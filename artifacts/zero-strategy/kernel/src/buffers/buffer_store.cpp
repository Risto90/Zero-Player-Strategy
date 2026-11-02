#include "zero_kernel.h"

#include <algorithm>
#include <cstring>
#include <memory>
#include <mutex>
#include <new>
#include <vector>

namespace {

struct BufferSlot {
  std::unique_ptr<uint8_t[]> bytes;
  uint32_t byte_length = 0;
  uint32_t generation = 1;
  zk_buffer_type type = ZK_BUFFER_U8;
  uint32_t count = 0;
  bool active = false;
  bool retired = false;
};

std::mutex registry_mutex;
std::vector<BufferSlot> slots;
uint64_t allocated_bytes = 0;

uint32_t element_size(zk_buffer_type type) {
  switch (type) {
  case ZK_BUFFER_U8:
    return 1;
  case ZK_BUFFER_U16:
    return 2;
  case ZK_BUFFER_I32:
  case ZK_BUFFER_U32:
  case ZK_BUFFER_F32:
    return 4;
  case ZK_BUFFER_F64:
  case ZK_BUFFER_I64:
  case ZK_BUFFER_U64:
    return 8;
  }
  return 0;
}

zk_handle make_handle(uint32_t slot, uint32_t generation) {
  return (static_cast<uint64_t>(generation) << 32u) |
         (static_cast<uint64_t>(slot) + 1u);
}

zk_error find_slot(zk_handle handle, BufferSlot **out) {
  if (handle == 0)
    return ZK_ERROR_INVALID_HANDLE;
  const uint32_t encoded_slot = static_cast<uint32_t>(handle);
  const uint32_t generation = static_cast<uint32_t>(handle >> 32u);
  if (encoded_slot == 0 || generation == 0)
    return ZK_ERROR_INVALID_HANDLE;
  const uint32_t index = encoded_slot - 1u;
  if (index >= slots.size())
    return ZK_ERROR_INVALID_HANDLE;
  BufferSlot &slot = slots[index];
  if (!slot.active)
    return ZK_ERROR_STALE_HANDLE;
  if (slot.generation != generation)
    return ZK_ERROR_STALE_HANDLE;
  *out = &slot;
  return ZK_OK;
}

} // namespace

extern "C" zk_error zk_buffer_create(zk_buffer_type type, uint32_t count,
                                      zk_handle *result) {
  if (result == nullptr)
    return ZK_ERROR_INVALID_ARGUMENT;
  const uint32_t size = element_size(type);
  if (size == 0)
    return ZK_ERROR_INVALID_ARGUMENT;
  const uint64_t byte_length = static_cast<uint64_t>(count) * size;
  if (byte_length > ZK_MEMORY_LIMIT_BYTES)
    return ZK_ERROR_OUT_OF_RANGE;

  std::lock_guard<std::mutex> lock(registry_mutex);
  if (allocated_bytes + byte_length > ZK_MEMORY_LIMIT_BYTES)
    return ZK_ERROR_OUT_OF_MEMORY;

  uint32_t index = 0;
  while (index < slots.size() && (slots[index].active || slots[index].retired))
    ++index;
  if (index == slots.size()) {
    if (slots.size() >= ZK_MAX_BUFFER_SLOTS)
      return ZK_ERROR_OUT_OF_MEMORY;
    try {
      slots.emplace_back();
    } catch (const std::bad_alloc &) {
      return ZK_ERROR_OUT_OF_MEMORY;
    }
  }

  std::unique_ptr<uint8_t[]> memory;
  if (byte_length != 0) {
    memory.reset(new (std::nothrow) uint8_t[static_cast<size_t>(byte_length)]());
    if (!memory)
      return ZK_ERROR_OUT_OF_MEMORY;
  }

  BufferSlot &slot = slots[index];
  slot.bytes = std::move(memory);
  slot.byte_length = static_cast<uint32_t>(byte_length);
  slot.type = type;
  slot.count = count;
  slot.active = true;
  allocated_bytes += byte_length;
  *result = make_handle(index, slot.generation);
  return ZK_OK;
}

extern "C" zk_error zk_buffer_release(zk_handle handle) {
  std::lock_guard<std::mutex> lock(registry_mutex);
  BufferSlot *slot = nullptr;
  const zk_error error = find_slot(handle, &slot);
  if (error != ZK_OK)
    return error;
  allocated_bytes -= slot->byte_length;
  slot->bytes.reset();
  slot->byte_length = 0;
  slot->count = 0;
  slot->active = false;
  if (slot->generation == UINT32_MAX)
    slot->retired = true;
  else
    ++slot->generation;
  return ZK_OK;
}

extern "C" void *zk_buffer_data(zk_handle handle, uint32_t *byte_length,
                                 zk_error *error) {
  if (byte_length == nullptr || error == nullptr) {
    if (error != nullptr)
      *error = ZK_ERROR_INVALID_ARGUMENT;
    return nullptr;
  }
  std::lock_guard<std::mutex> lock(registry_mutex);
  BufferSlot *slot = nullptr;
  *error = find_slot(handle, &slot);
  if (*error != ZK_OK)
    return nullptr;
  *byte_length = slot->byte_length;
  return slot->bytes.get();
}

extern "C" zk_error zk_buffer_size(zk_handle handle, uint32_t *byte_length) {
  if (byte_length == nullptr)
    return ZK_ERROR_INVALID_ARGUMENT;
  std::lock_guard<std::mutex> lock(registry_mutex);
  BufferSlot *slot = nullptr;
  const zk_error error = find_slot(handle, &slot);
  if (error != ZK_OK)
    return error;
  *byte_length = slot->byte_length;
  return ZK_OK;
}

extern "C" zk_error zk_buffer_i32_sum(zk_handle handle, uint32_t start,
                                       uint32_t count, int64_t *result) {
  if (result == nullptr)
    return ZK_ERROR_INVALID_ARGUMENT;
  std::lock_guard<std::mutex> lock(registry_mutex);
  BufferSlot *slot = nullptr;
  const zk_error error = find_slot(handle, &slot);
  if (error != ZK_OK)
    return error;
  if (slot->type != ZK_BUFFER_I32)
    return ZK_ERROR_TYPE_MISMATCH;
  if (start > slot->count || count > slot->count - start)
    return ZK_ERROR_OUT_OF_RANGE;
  const auto *values = reinterpret_cast<const int32_t *>(slot->bytes.get());
  return zk_i32_sum(count == 0 ? nullptr : values + start, count, result);
}
