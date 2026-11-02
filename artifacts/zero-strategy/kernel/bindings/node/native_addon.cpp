#include "zero_kernel.h"
#include "../../src/native/serial_queue.hpp"

#include <node_api.h>

#include <cmath>
#include <algorithm>
#include <cstdint>
#include <cstring>
#include <new>
#include <string>
#include <type_traits>
#include <vector>

namespace {

zero_kernel::SerialQueue native_queue;

napi_value number(napi_env env, double value) {
  napi_value result;
  napi_create_double(env, value, &result);
  return result;
}

napi_value throw_error(napi_env env, const char *message) {
  napi_throw_error(env, "INVALID_ARGUMENT", message);
  return nullptr;
}

napi_value throw_kernel_error(napi_env env, zk_error error) {
  napi_throw_error(env, zk_error_name(error), zk_error_message(error));
  return nullptr;
}

bool read_operation(napi_env env, napi_value value, uint32_t *operation) {
  napi_valuetype type;
  napi_typeof(env, value, &type);
  if (type != napi_string)
    return false;
  char name[32] = {};
  size_t length = 0;
  napi_get_value_string_utf8(env, value, name, sizeof(name), &length);
  const char *names[] = {"union", "intersection", "difference",
                         "symmetricDifference", "complement"};
  for (uint32_t index = 0; index < 5; ++index) {
    if (std::string(name) == names[index]) {
      *operation = index + 1;
      return true;
    }
  }
  return false;
}

bool read_u32_array(napi_env env, napi_value value, const uint32_t **data,
                    size_t *length) {
  bool is_typed_array = false;
  napi_is_typedarray(env, value, &is_typed_array);
  if (!is_typed_array)
    return false;
  napi_typedarray_type type;
  void *pointer = nullptr;
  napi_value array_buffer;
  size_t byte_offset = 0;
  if (napi_get_typedarray_info(env, value, &type, length, &pointer,
                               &array_buffer, &byte_offset) != napi_ok ||
      type != napi_uint32_array)
    return false;
  *data = static_cast<const uint32_t *>(pointer);
  return true;
}

bool read_f64_array(napi_env env, napi_value value, const double **data,
                    size_t *length) {
  bool is_typed_array = false;
  napi_is_typedarray(env, value, &is_typed_array);
  if (!is_typed_array)
    return false;
  napi_typedarray_type type;
  void *pointer = nullptr;
  napi_value array_buffer;
  size_t byte_offset = 0;
  if (napi_get_typedarray_info(env, value, &type, length, &pointer,
                               &array_buffer, &byte_offset) != napi_ok ||
      type != napi_float64_array)
    return false;
  *data = static_cast<const double *>(pointer);
  return true;
}

bool read_f32_array(napi_env env, napi_value value, const float **data,
                    size_t *length) {
  bool is_typed_array = false;
  napi_is_typedarray(env, value, &is_typed_array);
  if (!is_typed_array)
    return false;
  napi_typedarray_type type;
  void *pointer = nullptr;
  napi_value array_buffer;
  size_t byte_offset = 0;
  if (napi_get_typedarray_info(env, value, &type, length, &pointer,
                               &array_buffer, &byte_offset) != napi_ok ||
      type != napi_float32_array)
    return false;
  *data = static_cast<const float *>(pointer);
  return true;
}

bool read_matrix_type(napi_env env, napi_value value, zk_matrix_type *type) {
  const float *f32 = nullptr;
  const double *f64 = nullptr;
  size_t length = 0;
  if (read_f32_array(env, value, &f32, &length)) {
    *type = ZK_MATRIX_F32;
    return true;
  }
  if (read_f64_array(env, value, &f64, &length)) {
    *type = ZK_MATRIX_F64;
    return true;
  }
  return false;
}

bool read_matrix_operation(napi_env env, napi_value value,
                           zk_matrix_operation *operation) {
  napi_valuetype type;
  napi_typeof(env, value, &type);
  if (type != napi_string)
    return false;
  char name[32] = {};
  size_t length = 0;
  napi_get_value_string_utf8(env, value, name, sizeof(name), &length);
  const char *names[] = {
      "", "transpose", "add", "subtract", "hadamard", "divide",
      "matmul", "matvec", "dot", "outer", "sum", "mean", "normL1",
      "normFrobenius", "trace", "determinant", "rank", "inverse",
      "pseudoinverse", "solve"};
  for (uint32_t index = 1; index < sizeof(names) / sizeof(names[0]); ++index) {
    if (std::string(name) == names[index]) {
      *operation = static_cast<zk_matrix_operation>(index);
      return true;
    }
  }
  return false;
}

bool read_u32_number(napi_env env, napi_value value, uint32_t *result) {
  napi_valuetype type;
  napi_typeof(env, value, &type);
  if (type != napi_number)
    return false;
  double number_value = 0;
  napi_get_value_double(env, value, &number_value);
  if (!std::isfinite(number_value) || number_value < 0 ||
      number_value > UINT32_MAX || number_value != std::floor(number_value))
    return false;
  *result = static_cast<uint32_t>(number_value);
  return true;
}

bool read_population_measure(napi_env env, napi_value value,
                            const uint32_t **keys, const double **mass,
                            uint32_t *count) {
  napi_value key_value;
  napi_value mass_value;
  if (napi_get_named_property(env, value, "keys", &key_value) != napi_ok ||
      napi_get_named_property(env, value, "mass", &mass_value) != napi_ok)
    return false;
  size_t key_count = 0;
  size_t mass_count = 0;
  if (!read_u32_array(env, key_value, keys, &key_count) ||
      !read_f64_array(env, mass_value, mass, &mass_count) ||
      mass_count > UINT32_MAX / ZK_POPULATION_KEY_WIDTH ||
      key_count != mass_count * ZK_POPULATION_KEY_WIDTH)
    return false;
  *count = static_cast<uint32_t>(mass_count);
  return true;
}

napi_value make_u32_array(napi_env env, const uint32_t *source,
                          uint32_t count) {
  napi_value array_buffer;
  void *data = nullptr;
  const size_t bytes = static_cast<size_t>(count) * sizeof(uint32_t);
  if (napi_create_arraybuffer(env, bytes, &data, &array_buffer) != napi_ok)
    return throw_error(env, "Не удалось создать массив uint32");
  if (bytes != 0)
    std::memcpy(data, source, bytes);
  napi_value result;
  if (napi_create_typedarray(env, napi_uint32_array, count, array_buffer, 0,
                             &result) != napi_ok)
    return throw_error(env, "Не удалось создать массив uint32");
  return result;
}

napi_value make_f64_array(napi_env env, const double *source,
                          uint32_t count) {
  napi_value array_buffer;
  void *data = nullptr;
  const size_t bytes = static_cast<size_t>(count) * sizeof(double);
  if (napi_create_arraybuffer(env, bytes, &data, &array_buffer) != napi_ok)
    return throw_error(env, "Не удалось создать массив f64");
  if (bytes != 0)
    std::memcpy(data, source, bytes);
  napi_value result;
  if (napi_create_typedarray(env, napi_float64_array, count, array_buffer, 0,
                             &result) != napi_ok)
    return throw_error(env, "Не удалось создать массив f64");
  return result;
}

napi_value make_f32_array(napi_env env, const float *source,
                          uint32_t count) {
  napi_value array_buffer;
  void *data = nullptr;
  const size_t bytes = static_cast<size_t>(count) * sizeof(float);
  if (napi_create_arraybuffer(env, bytes, &data, &array_buffer) != napi_ok)
    return throw_error(env, "Не удалось создать массив f32");
  if (bytes != 0)
    std::memcpy(data, source, bytes);
  napi_value result;
  if (napi_create_typedarray(env, napi_float32_array, count, array_buffer, 0,
                             &result) != napi_ok)
    return throw_error(env, "Не удалось создать массив f32");
  return result;
}

napi_value matrix_execute(napi_env env, napi_callback_info info) {
  size_t argc = 7;
  napi_value argv[7];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  zk_matrix_operation operation{};
  zk_matrix_type matrix_type{};
  uint32_t left_rows = 0, left_columns = 0, right_rows = 0, right_columns = 0;
  if (argc != 7 || !read_matrix_operation(env, argv[0], &operation) ||
      !read_matrix_type(env, argv[1], &matrix_type) ||
      !read_u32_number(env, argv[2], &left_rows) ||
      !read_u32_number(env, argv[3], &left_columns) ||
      !read_u32_number(env, argv[5], &right_rows) ||
      !read_u32_number(env, argv[6], &right_columns))
    return throw_error(env, "matrixExecute получил неверные операцию, тип или формы");
  if (matrix_type == ZK_MATRIX_F32) {
    const float *left = nullptr, *right = nullptr;
    size_t left_count = 0, right_count = 0;
    if (!read_f32_array(env, argv[1], &left, &left_count) ||
        !read_f32_array(env, argv[4], &right, &right_count) ||
        static_cast<uint64_t>(left_rows) * left_columns != left_count ||
        static_cast<uint64_t>(right_rows) * right_columns != right_count)
      return throw_error(env, "Формы матриц не совпадают с массивами f32");
    uint64_t capacity = std::max<uint64_t>(
        static_cast<uint64_t>(left_rows) * left_columns,
        static_cast<uint64_t>(left_rows) * right_columns);
    if (operation == ZK_MATRIX_OUTER) capacity =
        static_cast<uint64_t>(left_count) * right_count;
    if (operation == ZK_MATRIX_PSEUDOINVERSE) capacity =
        static_cast<uint64_t>(left_rows) * left_columns;
    if (capacity > ZK_MEMORY_LIMIT_BYTES / sizeof(float))
      return throw_error(env, "Результат превышает лимит памяти ядра");
    std::vector<float> output(capacity);
    uint32_t rows = 0, columns = 0;
    const zk_error error = zk_matrix_execute(
        operation, matrix_type, left, left_rows, left_columns, right,
        right_rows, right_columns, output.data(), static_cast<uint32_t>(capacity),
        &rows, &columns);
    if (error != ZK_OK) return throw_kernel_error(env, error);
    napi_value result, values, row_value, column_value;
    values = make_f32_array(env, output.data(), rows * columns);
    napi_create_object(env, &result);
    napi_create_uint32(env, rows, &row_value);
    napi_create_uint32(env, columns, &column_value);
    napi_set_named_property(env, result, "values", values);
    napi_set_named_property(env, result, "rows", row_value);
    napi_set_named_property(env, result, "columns", column_value);
    return result;
  }

  const double *left = nullptr, *right = nullptr;
  size_t left_count = 0, right_count = 0;
  if (!read_f64_array(env, argv[1], &left, &left_count) ||
      !read_f64_array(env, argv[4], &right, &right_count) ||
      static_cast<uint64_t>(left_rows) * left_columns != left_count ||
      static_cast<uint64_t>(right_rows) * right_columns != right_count)
    return throw_error(env, "Формы матриц не совпадают с массивами f64");
  uint64_t capacity = std::max<uint64_t>(
      static_cast<uint64_t>(left_rows) * left_columns,
      static_cast<uint64_t>(left_rows) * right_columns);
  if (operation == ZK_MATRIX_OUTER)
    capacity = static_cast<uint64_t>(left_count) * right_count;
  if (operation == ZK_MATRIX_PSEUDOINVERSE)
    capacity = static_cast<uint64_t>(left_rows) * left_columns;
  if (capacity > ZK_MEMORY_LIMIT_BYTES / sizeof(double))
    return throw_error(env, "Результат превышает лимит памяти ядра");
  std::vector<double> output(capacity);
  uint32_t rows = 0, columns = 0;
  const zk_error error = zk_matrix_execute(
      operation, matrix_type, left, left_rows, left_columns, right, right_rows,
      right_columns, output.data(), static_cast<uint32_t>(capacity), &rows,
      &columns);
  if (error != ZK_OK) return throw_kernel_error(env, error);
  napi_value result, values, row_value, column_value;
  values = make_f64_array(env, output.data(), rows * columns);
  napi_create_object(env, &result);
  napi_create_uint32(env, rows, &row_value);
  napi_create_uint32(env, columns, &column_value);
  napi_set_named_property(env, result, "values", values);
  napi_set_named_property(env, result, "rows", row_value);
  napi_set_named_property(env, result, "columns", column_value);
  return result;
}

bool read_factorization(napi_env env, napi_value value,
                        zk_matrix_factorization *factorization) {
  napi_valuetype type;
  napi_typeof(env, value, &type);
  if (type != napi_string)
    return false;
  char name[32] = {};
  size_t length = 0;
  napi_get_value_string_utf8(env, value, name, sizeof(name), &length);
  const char *names[] = {"", "lu", "qr", "cholesky", "svd", "symmetricEigen"};
  for (uint32_t index = 1; index < sizeof(names) / sizeof(names[0]); ++index) {
    if (std::string(name) == names[index]) {
      *factorization = static_cast<zk_matrix_factorization>(index);
      return true;
    }
  }
  return false;
}

template <typename T>
napi_value make_matrix_result(napi_env env, const T *values, uint32_t rows,
                              uint32_t columns) {
  napi_value result, array, row_value, column_value;
  array = nullptr;
  if constexpr (std::is_same_v<T, float>)
    array = make_f32_array(env, values, rows * columns);
  else
    array = make_f64_array(env, values, rows * columns);
  if (array == nullptr)
    return nullptr;
  napi_create_object(env, &result);
  napi_create_uint32(env, rows, &row_value);
  napi_create_uint32(env, columns, &column_value);
  napi_set_named_property(env, result, "values", array);
  napi_set_named_property(env, result, "rows", row_value);
  napi_set_named_property(env, result, "columns", column_value);
  return result;
}

template <typename T>
napi_value matrix_factorize_impl(
    napi_env env, zk_matrix_factorization operation, const T *input,
    uint32_t rows, uint32_t columns) {
  const uint32_t extent = std::min(rows, columns);
  uint64_t capacity_a = static_cast<uint64_t>(rows) * rows;
  uint64_t capacity_b = static_cast<uint64_t>(rows) * columns;
  uint64_t capacity_c = static_cast<uint64_t>(columns) * columns;
  if (operation == ZK_MATRIX_QR) {
    capacity_a = static_cast<uint64_t>(rows) * extent;
    capacity_b = static_cast<uint64_t>(extent) * columns;
    capacity_c = 0;
  } else if (operation == ZK_MATRIX_LU) {
    if (rows != columns) return throw_error(env, "LU требует квадратную матрицу");
    capacity_a = capacity_b = capacity_c = static_cast<uint64_t>(rows) * rows;
  } else if (operation == ZK_MATRIX_CHOLESKY) {
    if (rows != columns) return throw_error(env, "Cholesky требует квадратную матрицу");
    capacity_b = capacity_c = 0;
  } else if (operation == ZK_MATRIX_SVD) {
    capacity_a = static_cast<uint64_t>(rows) * rows;
    capacity_b = static_cast<uint64_t>(extent) * extent;
    capacity_c = static_cast<uint64_t>(columns) * columns;
  } else if (operation == ZK_MATRIX_SYMMETRIC_EIGEN) {
    if (rows != columns)
      return throw_error(env, "Собственные значения требуют квадратную матрицу");
    capacity_a = rows;
    capacity_b = static_cast<uint64_t>(rows) * rows;
    capacity_c = 0;
  }
  if (capacity_a + capacity_b + capacity_c >
      ZK_MEMORY_LIMIT_BYTES / sizeof(T))
    return throw_error(env, "Факторизация превышает лимит памяти ядра");
  try {
    std::vector<T> a(capacity_a), b(capacity_b), c(capacity_c);
    uint32_t ar = 0, ac = 0, br = 0, bc = 0, cr = 0, cc = 0;
    const zk_error error = zk_matrix_factorize(
        operation, std::is_same_v<T, float> ? ZK_MATRIX_F32 : ZK_MATRIX_F64,
        input, rows, columns, a.data(), static_cast<uint32_t>(capacity_a), &ar,
        &ac, b.data(), static_cast<uint32_t>(capacity_b), &br, &bc, c.data(),
        static_cast<uint32_t>(capacity_c), &cr, &cc);
    if (error != ZK_OK) return throw_kernel_error(env, error);
    napi_value result;
    napi_create_object(env, &result);
    napi_set_named_property(env, result, "a",
                            make_matrix_result(env, a.data(), ar, ac));
    napi_set_named_property(env, result, "b",
                            make_matrix_result(env, b.data(), br, bc));
    napi_set_named_property(env, result, "c",
                            make_matrix_result(env, c.data(), cr, cc));
    return result;
  } catch (const std::bad_alloc &) {
    return throw_kernel_error(env, ZK_ERROR_OUT_OF_MEMORY);
  }
}

napi_value matrix_factorize(napi_env env, napi_callback_info info) {
  size_t argc = 4;
  napi_value argv[4];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  zk_matrix_factorization operation{};
  uint32_t rows = 0, columns = 0;
  zk_matrix_type type{};
  if (argc != 4 || !read_factorization(env, argv[0], &operation) ||
      !read_matrix_type(env, argv[1], &type) ||
      !read_u32_number(env, argv[2], &rows) ||
      !read_u32_number(env, argv[3], &columns))
    return throw_error(env, "matrixFactorize получил неверные аргументы");
  if (type == ZK_MATRIX_F32) {
    const float *input = nullptr;
    size_t length = 0;
    if (!read_f32_array(env, argv[1], &input, &length) ||
        static_cast<uint64_t>(rows) * columns != length)
      return throw_error(env, "Форма не совпадает с массивом f32");
    return matrix_factorize_impl(env, operation, input, rows, columns);
  }
  const double *input = nullptr;
  size_t length = 0;
  if (!read_f64_array(env, argv[1], &input, &length) ||
      static_cast<uint64_t>(rows) * columns != length)
    return throw_error(env, "Форма не совпадает с массивом f64");
  return matrix_factorize_impl(env, operation, input, rows, columns);
}

napi_value matrix_batch_matmul(napi_env env, napi_callback_info info) {
  size_t argc = 8;
  napi_value argv[8];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  zk_matrix_type type{};
  uint32_t left_batches = 0, left_rows = 0, left_columns = 0;
  uint32_t right_batches = 0, right_rows = 0, right_columns = 0;
  if (argc != 8 || !read_matrix_type(env, argv[0], &type) ||
      !read_u32_number(env, argv[1], &left_batches) ||
      !read_u32_number(env, argv[2], &left_rows) ||
      !read_u32_number(env, argv[3], &left_columns) ||
      !read_u32_number(env, argv[5], &right_batches) ||
      !read_u32_number(env, argv[6], &right_rows) ||
      !read_u32_number(env, argv[7], &right_columns))
    return throw_error(env, "matrixBatchMatmul получил неверные формы");
  const uint64_t output_count =
      static_cast<uint64_t>(std::max(left_batches, right_batches)) *
      left_rows * right_columns;
  if (output_count > ZK_MEMORY_LIMIT_BYTES / sizeof(double))
    return throw_error(env, "Результат пакета превышает лимит памяти");
  try {
    uint32_t rows = 0;
    if (type == ZK_MATRIX_F32) {
      const float *left = nullptr, *right = nullptr;
      size_t left_count = 0, right_count = 0;
      if (!read_f32_array(env, argv[0], &left, &left_count) ||
          !read_f32_array(env, argv[4], &right, &right_count) ||
          static_cast<uint64_t>(left_batches) * left_rows * left_columns != left_count ||
          static_cast<uint64_t>(right_batches) * right_rows * right_columns != right_count)
        return throw_error(env, "Формы пакета не совпадают с массивами f32");
      std::vector<float> output(output_count);
      const zk_error error = zk_matrix_batch_matmul(
          type, left, left_batches, left_rows, left_columns, right,
          right_batches, right_rows, right_columns, output.data(),
          static_cast<uint32_t>(output_count));
      if (error != ZK_OK) return throw_kernel_error(env, error);
      napi_value result, values, rows_value, columns_value;
      values = make_f32_array(env, output.data(), output_count);
      napi_create_object(env, &result);
      rows = std::max(left_batches, right_batches) * left_rows;
      napi_create_uint32(env, rows, &rows_value);
      napi_create_uint32(env, right_columns, &columns_value);
      napi_set_named_property(env, result, "values", values);
      napi_set_named_property(env, result, "rows", rows_value);
      napi_set_named_property(env, result, "columns", columns_value);
      return result;
    }
    const double *left = nullptr, *right = nullptr;
    size_t left_count = 0, right_count = 0;
    if (!read_f64_array(env, argv[0], &left, &left_count) ||
        !read_f64_array(env, argv[4], &right, &right_count) ||
        static_cast<uint64_t>(left_batches) * left_rows * left_columns != left_count ||
        static_cast<uint64_t>(right_batches) * right_rows * right_columns != right_count)
      return throw_error(env, "Формы пакета не совпадают с массивами f64");
    std::vector<double> output(output_count);
    const zk_error error = zk_matrix_batch_matmul(
        type, left, left_batches, left_rows, left_columns, right, right_batches,
        right_rows, right_columns, output.data(),
        static_cast<uint32_t>(output_count));
    if (error != ZK_OK) return throw_kernel_error(env, error);
    napi_value result, values, rows_value, columns_value;
    values = make_f64_array(env, output.data(), output_count);
    napi_create_object(env, &result);
    rows = std::max(left_batches, right_batches) * left_rows;
    napi_create_uint32(env, rows, &rows_value);
    napi_create_uint32(env, right_columns, &columns_value);
    napi_set_named_property(env, result, "values", values);
    napi_set_named_property(env, result, "rows", rows_value);
    napi_set_named_property(env, result, "columns", columns_value);
    return result;
  } catch (const std::bad_alloc &) {
    return throw_kernel_error(env, ZK_ERROR_OUT_OF_MEMORY);
  }
}

napi_value sparse_matvec_napi(napi_env env, napi_callback_info info) {
  size_t argc = 6;
  napi_value argv[6];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  uint32_t rows = 0, columns = 0;
  zk_matrix_type type{};
  const uint32_t *row_offsets = nullptr, *column_indices = nullptr;
  size_t row_count = 0, index_count = 0;
  if (argc != 6 || !read_u32_number(env, argv[0], &rows) ||
      !read_u32_number(env, argv[1], &columns) ||
      !read_u32_array(env, argv[2], &row_offsets, &row_count) ||
      !read_u32_array(env, argv[3], &column_indices, &index_count) ||
      !read_matrix_type(env, argv[4], &type) ||
      row_count != static_cast<size_t>(rows) + 1)
    return throw_error(env, "sparseMatvec получил неверную CSR-форму");
  try {
    if (type == ZK_MATRIX_F32) {
      const float *values = nullptr, *vector = nullptr;
      size_t value_count = 0, vector_count = 0;
      if (!read_f32_array(env, argv[4], &values, &value_count) ||
          !read_f32_array(env, argv[5], &vector, &vector_count) ||
          value_count != index_count || vector_count != columns)
        return throw_error(env, "Длины массивов sparseMatvec не совпадают");
      std::vector<float> output(rows);
      const zk_error error = zk_sparse_matvec(
          type, rows, columns, row_offsets, column_indices, values,
          value_count, vector, output.data(), rows);
      if (error != ZK_OK) return throw_kernel_error(env, error);
      return make_f32_array(env, output.data(), rows);
    }
    const double *values = nullptr, *vector = nullptr;
    size_t value_count = 0, vector_count = 0;
    if (!read_f64_array(env, argv[4], &values, &value_count) ||
        !read_f64_array(env, argv[5], &vector, &vector_count) ||
        value_count != index_count || vector_count != columns)
      return throw_error(env, "Длины массивов sparseMatvec не совпадают");
    std::vector<double> output(rows);
    const zk_error error = zk_sparse_matvec(
        type, rows, columns, row_offsets, column_indices, values, value_count,
        vector, output.data(), rows);
    if (error != ZK_OK) return throw_kernel_error(env, error);
    return make_f64_array(env, output.data(), rows);
  } catch (const std::bad_alloc &) {
    return throw_kernel_error(env, ZK_ERROR_OUT_OF_MEMORY);
  }
}

napi_value sparse_matmul_napi(napi_env env, napi_callback_info info) {
  size_t argc = 7;
  napi_value argv[7];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  uint32_t rows = 0, columns = 0, right_columns = 0;
  zk_matrix_type type{};
  const uint32_t *row_offsets = nullptr, *column_indices = nullptr;
  size_t row_count = 0, index_count = 0;
  if (argc != 7 || !read_u32_number(env, argv[0], &rows) ||
      !read_u32_number(env, argv[1], &columns) ||
      !read_u32_array(env, argv[2], &row_offsets, &row_count) ||
      !read_u32_array(env, argv[3], &column_indices, &index_count) ||
      !read_matrix_type(env, argv[4], &type) ||
      !read_u32_number(env, argv[6], &right_columns) ||
      row_count != static_cast<size_t>(rows) + 1)
    return throw_error(env, "sparseMatmul получил неверную CSR-форму");
  const uint64_t output_count = static_cast<uint64_t>(rows) * right_columns;
  if (output_count > ZK_MEMORY_LIMIT_BYTES / sizeof(double))
    return throw_error(env, "Результат разреженного умножения превышает лимит памяти");
  try {
    if (type == ZK_MATRIX_F32) {
      const float *values = nullptr, *right = nullptr;
      size_t value_count = 0, right_count = 0;
      if (!read_f32_array(env, argv[4], &values, &value_count) ||
          !read_f32_array(env, argv[5], &right, &right_count) ||
          value_count != index_count ||
          static_cast<uint64_t>(columns) * right_columns != right_count)
        return throw_error(env, "Длины массивов sparseMatmul не совпадают");
      std::vector<float> output(output_count);
      const zk_error error = zk_sparse_matmul(
          type, rows, columns, row_offsets, column_indices, values,
          value_count, right, right_columns, output.data(), output_count);
      if (error != ZK_OK) return throw_kernel_error(env, error);
      napi_value result, values_array, rows_value, columns_value;
      values_array = make_f32_array(env, output.data(), output_count);
      napi_create_object(env, &result);
      napi_create_uint32(env, rows, &rows_value);
      napi_create_uint32(env, right_columns, &columns_value);
      napi_set_named_property(env, result, "values", values_array);
      napi_set_named_property(env, result, "rows", rows_value);
      napi_set_named_property(env, result, "columns", columns_value);
      return result;
    }
    const double *values = nullptr, *right = nullptr;
    size_t value_count = 0, right_count = 0;
    if (!read_f64_array(env, argv[4], &values, &value_count) ||
        !read_f64_array(env, argv[5], &right, &right_count) ||
        value_count != index_count ||
        static_cast<uint64_t>(columns) * right_columns != right_count)
      return throw_error(env, "Длины массивов sparseMatmul не совпадают");
    std::vector<double> output(output_count);
    const zk_error error = zk_sparse_matmul(
        type, rows, columns, row_offsets, column_indices, values, value_count,
        right, right_columns, output.data(), output_count);
    if (error != ZK_OK) return throw_kernel_error(env, error);
    napi_value result, values_array, rows_value, columns_value;
    values_array = make_f64_array(env, output.data(), output_count);
    napi_create_object(env, &result);
    napi_create_uint32(env, rows, &rows_value);
    napi_create_uint32(env, right_columns, &columns_value);
    napi_set_named_property(env, result, "values", values_array);
    napi_set_named_property(env, result, "rows", rows_value);
    napi_set_named_property(env, result, "columns", columns_value);
    return result;
  } catch (const std::bad_alloc &) {
    return throw_kernel_error(env, ZK_ERROR_OUT_OF_MEMORY);
  }
}

napi_value make_population_measure(napi_env env, const uint32_t *keys,
                                   const double *mass, uint32_t count) {
  if (count > UINT32_MAX / ZK_POPULATION_KEY_WIDTH)
    return throw_error(env, "Число групп превышает допустимый размер");
  napi_value result;
  napi_value key_array =
      make_u32_array(env, keys, count * ZK_POPULATION_KEY_WIDTH);
  if (key_array == nullptr)
    return nullptr;
  napi_value mass_array = make_f64_array(env, mass, count);
  if (mass_array == nullptr)
    return nullptr;
  napi_create_object(env, &result);
  napi_set_named_property(env, result, "keys", key_array);
  napi_set_named_property(env, result, "mass", mass_array);
  return result;
}

napi_value abi_version(napi_env env, napi_callback_info) {
  return number(env, zk_abi_version());
}

napi_value add_i32(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc != 2)
    return throw_error(env, "addI32 требует два целых числа");

  napi_valuetype left_type;
  napi_valuetype right_type;
  napi_typeof(env, argv[0], &left_type);
  napi_typeof(env, argv[1], &right_type);
  if (left_type != napi_number || right_type != napi_number)
    return throw_error(env, "Аргументы addI32 должны быть числами");
  double left_number = 0;
  double right_number = 0;
  napi_get_value_double(env, argv[0], &left_number);
  napi_get_value_double(env, argv[1], &right_number);
  if (!std::isfinite(left_number) || !std::isfinite(right_number) ||
      left_number < INT32_MIN || left_number > INT32_MAX ||
      right_number < INT32_MIN || right_number > INT32_MAX ||
      left_number != static_cast<int32_t>(left_number) ||
      right_number != static_cast<int32_t>(right_number))
    return throw_error(env, "Аргументы addI32 должны быть целыми числами int32");

  int32_t result = 0;
  const zk_error error =
      zk_i32_add(static_cast<int32_t>(left_number),
                 static_cast<int32_t>(right_number), &result);
  if (error != ZK_OK)
    return throw_kernel_error(env, error);
  return number(env, result);
}

struct AsyncAdd {
  napi_async_work work = nullptr;
  napi_deferred deferred = nullptr;
  int32_t left = 0;
  int32_t right = 0;
  int32_t result = 0;
  zk_error error = ZK_OK;
};

void queue_add_complete(napi_env env, napi_status status, void *data) {
  auto *context = static_cast<AsyncAdd *>(data);
  napi_value result;
  if (status == napi_ok && context->error == ZK_OK) {
    result = number(env, context->result);
    napi_resolve_deferred(env, context->deferred, result);
  } else {
    const char *message = context->error == ZK_OK
                              ? "Ошибка выполнения нативной очереди"
                              : zk_error_message(context->error);
    napi_value error_message;
    napi_value error;
    napi_value error_code;
    napi_create_string_utf8(env, message, NAPI_AUTO_LENGTH, &error_message);
    napi_create_error(env, nullptr, error_message, &error);
    napi_create_string_utf8(
        env,
        context->error == ZK_OK ? "INTERNAL" : zk_error_name(context->error),
        NAPI_AUTO_LENGTH, &error_code);
    napi_set_named_property(env, error, "code", error_code);
    napi_reject_deferred(env, context->deferred, error);
  }
  napi_delete_async_work(env, context->work);
  delete context;
}

void queue_add_execute(napi_env, void *data) {
  auto *context = static_cast<AsyncAdd *>(data);
  try {
    context->error = native_queue
                         .submit([context] {
                           return zk_i32_add(context->left, context->right,
                                             &context->result);
                         })
                         .get();
  } catch (...) {
    context->error = ZK_ERROR_INTERNAL;
  }
}

napi_value queue_add_i32(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc != 2)
    return throw_error(env, "queueAddI32 требует два целых числа");
  napi_valuetype left_type;
  napi_valuetype right_type;
  napi_typeof(env, argv[0], &left_type);
  napi_typeof(env, argv[1], &right_type);
  if (left_type != napi_number || right_type != napi_number)
    return throw_error(env, "Аргументы queueAddI32 должны быть числами");
  double left = 0;
  double right = 0;
  napi_get_value_double(env, argv[0], &left);
  napi_get_value_double(env, argv[1], &right);
  if (!std::isfinite(left) || !std::isfinite(right) ||
      left < INT32_MIN || left > INT32_MAX || right < INT32_MIN ||
      right > INT32_MAX || left != static_cast<int32_t>(left) ||
      right != static_cast<int32_t>(right))
    return throw_error(env, "Аргументы должны быть целыми числами int32");

  auto *context = new (std::nothrow) AsyncAdd{
      nullptr, nullptr, static_cast<int32_t>(left),
      static_cast<int32_t>(right), 0, ZK_OK};
  if (context == nullptr)
    return throw_error(env, "Недостаточно памяти");
  napi_value promise;
  napi_value resource_name;
  napi_create_string_utf8(env, "zero-kernel-native-queue", NAPI_AUTO_LENGTH,
                          &resource_name);
  if (napi_create_promise(env, &context->deferred, &promise) != napi_ok ||
      napi_create_async_work(env, nullptr, resource_name, queue_add_execute,
                             queue_add_complete, context,
                             &context->work) != napi_ok ||
      napi_queue_async_work(env, context->work) != napi_ok) {
    if (context->work != nullptr)
      napi_delete_async_work(env, context->work);
    delete context;
    return throw_error(env, "Не удалось поставить вычисление в очередь");
  }
  return promise;
}

napi_value sum_i32(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc != 1)
    return throw_error(env, "sumI32 требует Int32Array");

  bool is_typed_array = false;
  napi_is_typedarray(env, argv[0], &is_typed_array);
  if (!is_typed_array)
    return throw_error(env, "sumI32 принимает только Int32Array");

  napi_typedarray_type array_type;
  size_t length = 0;
  void *data = nullptr;
  napi_value array_buffer;
  size_t byte_offset = 0;
  napi_get_typedarray_info(env, argv[0], &array_type, &length, &data,
                           &array_buffer, &byte_offset);
  if (array_type != napi_int32_array || length > UINT32_MAX)
    return throw_error(env, "sumI32 принимает только Int32Array");

  int64_t result = 0;
  const zk_error error = zk_i32_sum(static_cast<const int32_t *>(data),
                                    static_cast<uint32_t>(length), &result);
  if (error != ZK_OK)
    return throw_kernel_error(env, error);
  napi_value bigint;
  napi_create_bigint_int64(env, result, &bigint);
  return bigint;
}

napi_value set_algebra(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  uint32_t operation = 0;
  const uint32_t *left = nullptr;
  const uint32_t *right = nullptr;
  size_t left_count = 0;
  size_t right_count = 0;
  if (argc != 3 || !read_operation(env, argv[0], &operation) ||
      !read_u32_array(env, argv[1], &left, &left_count) ||
      !read_u32_array(env, argv[2], &right, &right_count) ||
      left_count > UINT32_MAX || right_count > UINT32_MAX ||
      left_count > UINT32_MAX - right_count)
    return throw_error(env, "setAlgebra требует операцию и два массива uint32");
  try {
    std::vector<uint32_t> output(left_count + right_count);
    uint32_t result_count = 0;
    const zk_error error = zk_set_binary(
        static_cast<zk_set_operation>(operation), left,
        static_cast<uint32_t>(left_count), right,
        static_cast<uint32_t>(right_count), output.data(),
        static_cast<uint32_t>(output.size()), &result_count);
    if (error != ZK_OK)
      return throw_kernel_error(env, error);
    return make_u32_array(env, output.data(), result_count);
  } catch (const std::bad_alloc &) {
    return throw_kernel_error(env, ZK_ERROR_OUT_OF_MEMORY);
  }
}

napi_value measure_algebra(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  uint32_t operation = 0;
  const uint32_t *left_keys = nullptr;
  const uint32_t *right_keys = nullptr;
  const double *left_mass = nullptr;
  const double *right_mass = nullptr;
  uint32_t left_count = 0;
  uint32_t right_count = 0;
  if (argc != 3 || !read_operation(env, argv[0], &operation) ||
      !read_population_measure(env, argv[1], &left_keys, &left_mass,
                              &left_count) ||
      !read_population_measure(env, argv[2], &right_keys, &right_mass,
                              &right_count) ||
      right_count > UINT32_MAX / ZK_POPULATION_KEY_WIDTH ||
      left_count > UINT32_MAX / ZK_POPULATION_KEY_WIDTH - right_count)
    return throw_error(env, "measureAlgebra требует две совместные меры");
  try {
    const uint32_t capacity = left_count + right_count;
    std::vector<uint32_t> output_keys(
        static_cast<size_t>(capacity) * ZK_POPULATION_KEY_WIDTH);
    std::vector<double> output_mass(capacity);
    uint32_t result_count = 0;
    const zk_error error = zk_measure_binary(
        static_cast<zk_measure_operation>(operation), left_keys, left_mass,
        left_count, right_keys, right_mass, right_count, output_keys.data(),
        output_mass.data(), capacity, &result_count);
    if (error != ZK_OK)
      return throw_kernel_error(env, error);
    return make_population_measure(env, output_keys.data(), output_mass.data(),
                                   result_count);
  } catch (const std::bad_alloc &) {
    return throw_kernel_error(env, ZK_ERROR_OUT_OF_MEMORY);
  }
}

napi_value sum_population_measure(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  const uint32_t *keys = nullptr;
  const double *mass = nullptr;
  uint32_t count = 0;
  if (argc != 1 ||
      !read_population_measure(env, argv[0], &keys, &mass, &count))
    return throw_error(env, "sumPopulationMeasure требует совместную меру");
  try {
    std::vector<uint32_t> output_keys(
        static_cast<size_t>(count) * ZK_POPULATION_KEY_WIDTH);
    std::vector<double> output_mass(count);
    uint32_t result_count = 0;
    const zk_error error =
        zk_measure_sum(keys, mass, count, output_keys.data(),
                       output_mass.data(), count, &result_count);
    if (error != ZK_OK)
      return throw_kernel_error(env, error);
    return make_population_measure(env, output_keys.data(), output_mass.data(),
                                   result_count);
  } catch (const std::bad_alloc &) {
    return throw_kernel_error(env, ZK_ERROR_OUT_OF_MEMORY);
  }
}

struct BufferFinalizer {
  zk_handle handle;
};

void finalize_buffer(napi_env, void *, void *hint) {
  auto *finalizer = static_cast<BufferFinalizer *>(hint);
  if (finalizer != nullptr) {
    zk_buffer_release(finalizer->handle);
    delete finalizer;
  }
}

napi_value create_buffer(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc != 2)
    return throw_error(env, "createBuffer требует тип и количество");

  napi_valuetype type_of_type;
  napi_typeof(env, argv[0], &type_of_type);
  if (type_of_type != napi_string)
    return throw_error(env, "Тип буфера должен быть строкой");
  char type_name[16] = {};
  size_t type_length = 0;
  napi_get_value_string_utf8(env, argv[0], type_name, sizeof(type_name),
                             &type_length);
  const char *supported_names[] = {"u8", "u16", "i32", "u32", "f32", "f64",
                                   "i64", "u64"};
  const zk_buffer_type types[] = {ZK_BUFFER_U8,  ZK_BUFFER_U16, ZK_BUFFER_I32,
                                  ZK_BUFFER_U32, ZK_BUFFER_F32, ZK_BUFFER_F64,
                                  ZK_BUFFER_I64, ZK_BUFFER_U64};
  zk_buffer_type type = ZK_BUFFER_U8;
  bool known_type = false;
  for (size_t index = 0; index < sizeof(types) / sizeof(types[0]); ++index) {
    if (std::string(type_name) == supported_names[index]) {
      type = types[index];
      known_type = true;
      break;
    }
  }
  if (!known_type)
    return throw_error(env, "Неизвестный тип буфера");

  uint32_t count = 0;
  napi_get_value_uint32(env, argv[1], &count);
  double supplied_count = 0;
  napi_get_value_double(env, argv[1], &supplied_count);
  if (supplied_count < 0 || supplied_count > UINT32_MAX ||
      supplied_count != count)
    return throw_error(env, "Количество должно быть целым числом uint32");

  zk_handle handle = 0;
  const zk_error error = zk_buffer_create(type, count, &handle);
  if (error != ZK_OK)
    return throw_kernel_error(env, error);
  uint32_t byte_length = 0;
  zk_error data_error = ZK_OK;
  void *data = zk_buffer_data(handle, &byte_length, &data_error);
  if (data_error != ZK_OK) {
    zk_buffer_release(handle);
    return throw_kernel_error(env, data_error);
  }

  auto *finalizer = new (std::nothrow) BufferFinalizer{handle};
  if (finalizer == nullptr) {
    zk_buffer_release(handle);
    return throw_error(env, "Недостаточно памяти");
  }
  napi_value array_buffer;
  const napi_status status = napi_create_external_arraybuffer(
      env, data, byte_length, finalize_buffer, finalizer, &array_buffer);
  if (status != napi_ok) {
    finalize_buffer(env, finalizer, nullptr);
    return throw_error(env, "Не удалось создать типизированный буфер");
  }

  const napi_typedarray_type array_types[] = {
      napi_uint8_array, napi_uint16_array, napi_int32_array, napi_uint32_array,
      napi_float32_array, napi_float64_array, napi_bigint64_array,
      napi_biguint64_array};
  napi_value result;
  napi_create_typedarray(env, array_types[type - 1], count, array_buffer, 0,
                         &result);
  return result;
}

} // пространство имён

NAPI_MODULE_INIT() {
  napi_property_descriptor properties[] = {
      {"abiVersion", nullptr, abi_version, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"addI32", nullptr, add_i32, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"queueAddI32", nullptr, queue_add_i32, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"sumI32", nullptr, sum_i32, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"setAlgebra", nullptr, set_algebra, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"measureAlgebra", nullptr, measure_algebra, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"sumPopulationMeasure", nullptr, sum_population_measure, nullptr,
       nullptr, nullptr, napi_default, nullptr},
      {"matrixExecute", nullptr, matrix_execute, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"matrixFactorize", nullptr, matrix_factorize, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"matrixBatchMatmul", nullptr, matrix_batch_matmul, nullptr, nullptr,
       nullptr, napi_default, nullptr},
      {"sparseMatvec", nullptr, sparse_matvec_napi, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"sparseMatmul", nullptr, sparse_matmul_napi, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"createBuffer", nullptr, create_buffer, nullptr, nullptr, nullptr,
       napi_default, nullptr},
  };
  napi_define_properties(env, exports,
                         sizeof(properties) / sizeof(properties[0]),
                         properties);
  return exports;
}
