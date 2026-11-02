#ifndef ZERO_KERNEL_H
#define ZERO_KERNEL_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define ZK_ABI_VERSION 1u
#define ZK_MEMORY_LIMIT_BYTES (256u * 1024u * 1024u)
#define ZK_MAX_BUFFER_SLOTS 65536u

typedef enum zk_execution_type {
  ZK_EXECUTION_SINGLE_THREAD = 1,
  ZK_EXECUTION_WASM_THREADS = 2
} zk_execution_kind;

typedef uint64_t zk_handle;

typedef enum zk_error {
  ZK_OK = 0,
  ZK_ERROR_INVALID_ARGUMENT = 1,
  ZK_ERROR_OUT_OF_MEMORY = 2,
  ZK_ERROR_INVALID_HANDLE = 3,
  ZK_ERROR_STALE_HANDLE = 4,
  ZK_ERROR_TYPE_MISMATCH = 5,
  ZK_ERROR_OUT_OF_RANGE = 6,
  ZK_ERROR_OVERFLOW = 7,
  ZK_ERROR_UNSUPPORTED = 8,
  ZK_ERROR_CONFLICT = 9,
  ZK_ERROR_INTERNAL = 10
} zk_error;

typedef enum zk_buffer_type {
  ZK_BUFFER_U8 = 1,
  ZK_BUFFER_U16 = 2,
  ZK_BUFFER_I32 = 3,
  ZK_BUFFER_U32 = 4,
  ZK_BUFFER_F32 = 5,
  ZK_BUFFER_F64 = 6,
  ZK_BUFFER_I64 = 7,
  ZK_BUFFER_U64 = 8
} zk_buffer_type;

typedef enum zk_set_operation {
  ZK_SET_UNION = 1,
  ZK_SET_INTERSECTION = 2,
  ZK_SET_DIFFERENCE = 3,
  ZK_SET_SYMMETRIC_DIFFERENCE = 4,
  ZK_SET_COMPLEMENT = 5
} zk_set_operation;

typedef enum zk_measure_operation {
  ZK_MEASURE_UNION = 1,
  ZK_MEASURE_INTERSECTION = 2,
  ZK_MEASURE_DIFFERENCE = 3,
  ZK_MEASURE_SYMMETRIC_DIFFERENCE = 4,
  ZK_MEASURE_COMPLEMENT = 5
} zk_measure_operation;

enum { ZK_POPULATION_KEY_WIDTH = 4 };

/* Версия ABI и верхняя граница размера одного экземпляра ядра. */
uint32_t zk_abi_version(void);
uint32_t zk_memory_limit_bytes(void);
zk_execution_kind zk_execution_mode(void);
const char *zk_error_name(zk_error error);
const char *zk_error_message(zk_error error);

/* Переполнение возвращает ZK_ERROR_OVERFLOW и не записывает результат. */
zk_error zk_i32_add(int32_t left, int32_t right, int32_t *result);

/*
 * Буфер принадлежит ядру. Адрес действителен до освобождения дескриптора.
 * На WASM указатель является смещением в линейной памяти; в нативной сборке —
 * обычным адресом. Размер буфера не может превышать лимит ядра.
 */
zk_error zk_buffer_create(zk_buffer_type type, uint32_t count, zk_handle *result);
zk_error zk_buffer_release(zk_handle handle);
void *zk_buffer_data(zk_handle handle, uint32_t *byte_length, zk_error *error);
zk_error zk_buffer_size(zk_handle handle, uint32_t *byte_length);

/* Сумма читает заданный диапазон без создания копии и проверяет переполнение. */
zk_error zk_i32_sum(const int32_t *values, uint32_t count, int64_t *result);
zk_error zk_buffer_i32_sum(zk_handle handle, uint32_t start, uint32_t count, int64_t *result);

/*
 * Множества uint32 должны быть отсортированы и не содержать повторов.
 * Для дополнения right — явный универсум, результат равен right \ left.
 * Результат не меняется при ошибке; result_count обязателен.
 */
zk_error zk_set_binary(zk_set_operation operation,
                       const uint32_t *left, uint32_t left_count,
                       const uint32_t *right, uint32_t right_count,
                       uint32_t *output, uint32_t output_capacity,
                       uint32_t *result_count);

/*
 * Популяционные группы хранят совместные ключи четырёх измерений в плоском
 * массиве uint32 и массу в отдельном f64-массиве. Неверующая группа обозначает
 * веру значением UINT32_MAX. Повторные ключи явно суммируются.
 */
zk_error zk_measure_binary(zk_measure_operation operation,
                           const uint32_t *left_keys, const double *left_mass,
                           uint32_t left_count, const uint32_t *right_keys,
                           const double *right_mass, uint32_t right_count,
                           uint32_t *output_keys, double *output_mass,
                           uint32_t output_capacity, uint32_t *result_count);
zk_error zk_measure_sum(const uint32_t *keys, const double *mass,
                        uint32_t count, uint32_t *output_keys,
                        double *output_mass, uint32_t output_capacity,
                        uint32_t *result_count);

#ifdef __cplusplus
}
#endif

#endif
