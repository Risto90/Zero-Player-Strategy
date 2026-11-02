#include "zero_kernel.h"

#include <limits>

extern "C" uint32_t zk_abi_version(void) { return ZK_ABI_VERSION; }

extern "C" uint32_t zk_memory_limit_bytes(void) { return ZK_MEMORY_LIMIT_BYTES; }

extern "C" zk_execution_kind zk_execution_mode(void) {
#if defined(__EMSCRIPTEN_PTHREADS__)
  return ZK_EXECUTION_WASM_THREADS;
#else
  return ZK_EXECUTION_SINGLE_THREAD;
#endif
}

extern "C" const char *zk_error_name(zk_error error) {
  switch (error) {
  case ZK_OK:
    return "OK";
  case ZK_ERROR_INVALID_ARGUMENT:
    return "INVALID_ARGUMENT";
  case ZK_ERROR_OUT_OF_MEMORY:
    return "OUT_OF_MEMORY";
  case ZK_ERROR_INVALID_HANDLE:
    return "INVALID_HANDLE";
  case ZK_ERROR_STALE_HANDLE:
    return "STALE_HANDLE";
  case ZK_ERROR_TYPE_MISMATCH:
    return "TYPE_MISMATCH";
  case ZK_ERROR_OUT_OF_RANGE:
    return "OUT_OF_RANGE";
  case ZK_ERROR_OVERFLOW:
    return "OVERFLOW";
  case ZK_ERROR_UNSUPPORTED:
    return "UNSUPPORTED";
  case ZK_ERROR_CONFLICT:
    return "CONFLICT";
  case ZK_ERROR_INTERNAL:
    return "INTERNAL";
  }
  return "INTERNAL";
}

extern "C" const char *zk_error_message(zk_error error) {
  switch (error) {
  case ZK_OK:
    return "Успешно";
  case ZK_ERROR_INVALID_ARGUMENT:
    return "Недопустимый аргумент";
  case ZK_ERROR_OUT_OF_MEMORY:
    return "Недостаточно памяти";
  case ZK_ERROR_INVALID_HANDLE:
    return "Нулевой или недопустимый дескриптор";
  case ZK_ERROR_STALE_HANDLE:
    return "Дескриптор устарел";
  case ZK_ERROR_TYPE_MISMATCH:
    return "Тип данных не совпадает";
  case ZK_ERROR_OUT_OF_RANGE:
    return "Диапазон выходит за границы";
  case ZK_ERROR_OVERFLOW:
    return "Переполнение";
  case ZK_ERROR_UNSUPPORTED:
    return "Режим не поддерживается";
  case ZK_ERROR_CONFLICT:
    return "Конфликт ревизии";
  case ZK_ERROR_INTERNAL:
    return "Внутренняя ошибка ядра";
  }
  return "Неизвестная ошибка ядра";
}

extern "C" zk_error zk_i32_add(int32_t left, int32_t right, int32_t *result) {
  if (result == nullptr)
    return ZK_ERROR_INVALID_ARGUMENT;
  const int64_t sum = static_cast<int64_t>(left) + static_cast<int64_t>(right);
  if (sum < std::numeric_limits<int32_t>::min() ||
      sum > std::numeric_limits<int32_t>::max())
    return ZK_ERROR_OVERFLOW;
  *result = static_cast<int32_t>(sum);
  return ZK_OK;
}

extern "C" zk_error zk_i32_sum(const int32_t *values, uint32_t count,
                                int64_t *result) {
  if (result == nullptr || (count != 0 && values == nullptr))
    return ZK_ERROR_INVALID_ARGUMENT;

  int64_t total = 0;
  for (uint32_t index = 0; index < count; ++index) {
    const int64_t value = values[index];
    if ((value > 0 && total > std::numeric_limits<int64_t>::max() - value) ||
        (value < 0 && total < std::numeric_limits<int64_t>::min() - value))
      return ZK_ERROR_OVERFLOW;
    total += value;
  }
  *result = total;
  return ZK_OK;
}
