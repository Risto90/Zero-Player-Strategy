#include "zero_kernel.h"
#include "../../src/native/serial_queue.hpp"

#include <node_api.h>

#include <cmath>
#include <cstdint>
#include <cstring>
#include <new>
#include <string>
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
      {"createBuffer", nullptr, create_buffer, nullptr, nullptr, nullptr,
       napi_default, nullptr},
  };
  napi_define_properties(env, exports,
                         sizeof(properties) / sizeof(properties[0]),
                         properties);
  return exports;
}
