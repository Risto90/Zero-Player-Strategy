// Заготовка адаптера для собственного Expo-модуля с React Native JSI.
// Этот файл намеренно не входит в браузерную сборку приложения и требует JSI-заголовки RN.
#include "zero_kernel.h"
#include "../../src/native/serial_queue.hpp"

#include <jsi/jsi.h>

#include <cmath>
#include <cstdint>
#include <limits>
#include <memory>
#include <string>
#include <unordered_map>

namespace zero_kernel {

using facebook::jsi::Function;
using facebook::jsi::Runtime;
using facebook::jsi::String;
using facebook::jsi::Value;

struct RuntimeBuffers {
  std::unordered_map<std::string, zk_handle> handles;
  SerialQueue queue;

  ~RuntimeBuffers() {
    for (const auto &[key, handle] : handles) {
      (void)key;
      zk_buffer_release(handle);
    }
  }
};

void install(Runtime &runtime, const std::shared_ptr<RuntimeBuffers> &buffers) {
  auto add = Function::createFromHostFunction(
      runtime, facebook::jsi::PropNameID::forAscii(runtime, "zeroKernelAddI32"), 2,
      [](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count != 2 || !args[0].isNumber() || !args[1].isNumber())
          throw facebook::jsi::JSError(rt, "Ожидаются два числа");
        const double left = args[0].asNumber();
        const double right = args[1].asNumber();
        if (!std::isfinite(left) || !std::isfinite(right) ||
            left < std::numeric_limits<int32_t>::min() ||
            left > std::numeric_limits<int32_t>::max() ||
            right < std::numeric_limits<int32_t>::min() ||
            right > std::numeric_limits<int32_t>::max() ||
            left != static_cast<int32_t>(left) ||
            right != static_cast<int32_t>(right))
          throw facebook::jsi::JSError(rt, "Аргументы должны быть целыми числами int32");
        int32_t result = 0;
        const auto status =
            zk_i32_add(static_cast<int32_t>(left), static_cast<int32_t>(right),
                       &result);
        if (status != ZK_OK)
          throw facebook::jsi::JSError(rt, zk_error_message(status));
        return Value(result);
      });
  runtime.global().setProperty(runtime, "zeroKernelAddI32", std::move(add));

  auto create = Function::createFromHostFunction(
      runtime, facebook::jsi::PropNameID::forAscii(runtime, "zeroKernelCreateBuffer"), 2,
      [buffers](Runtime &rt, const Value &, const Value *args,
                size_t count) -> Value {
        if (count != 2 || !args[0].isString() || !args[1].isNumber())
          throw facebook::jsi::JSError(rt, "Ожидаются тип буфера и число элементов");
        const std::string type_name = args[0].asString(rt).utf8(rt);
        const double requested_count = args[1].asNumber();
        if (!std::isfinite(requested_count) || requested_count < 0 ||
            requested_count > UINT32_MAX ||
            requested_count != static_cast<uint32_t>(requested_count))
          throw facebook::jsi::JSError(rt, "Количество должно быть целым числом uint32");

        const std::unordered_map<std::string, zk_buffer_type> types = {
            {"u8", ZK_BUFFER_U8},   {"u16", ZK_BUFFER_U16},
            {"i32", ZK_BUFFER_I32}, {"u32", ZK_BUFFER_U32},
            {"f32", ZK_BUFFER_F32}, {"f64", ZK_BUFFER_F64},
            {"i64", ZK_BUFFER_I64}, {"u64", ZK_BUFFER_U64}};
        const auto type = types.find(type_name);
        if (type == types.end())
          throw facebook::jsi::JSError(rt, "Неизвестный тип буфера");

        zk_handle handle = 0;
        const auto status = zk_buffer_create(
            type->second, static_cast<uint32_t>(requested_count), &handle);
        if (status != ZK_OK)
          throw facebook::jsi::JSError(rt, zk_error_message(status));
        const std::string key = std::to_string(handle);
        buffers->handles.emplace(key, handle);
        return String::createFromUtf8(rt, key);
      });
  runtime.global().setProperty(runtime, "zeroKernelCreateBuffer",
                               std::move(create));

  auto release = Function::createFromHostFunction(
      runtime, facebook::jsi::PropNameID::forAscii(runtime, "zeroKernelRelease"), 1,
      [buffers](Runtime &rt, const Value &, const Value *args,
                size_t count) -> Value {
        if (count != 1 || !args[0].isString())
          throw facebook::jsi::JSError(rt, "Ожидается строковый дескриптор");
        const std::string key = args[0].asString(rt).utf8(rt);
        const auto found = buffers->handles.find(key);
        if (found == buffers->handles.end())
          throw facebook::jsi::JSError(rt, "Дескриптор не найден");
        const auto status = zk_buffer_release(found->second);
        buffers->handles.erase(found);
        if (status != ZK_OK)
          throw facebook::jsi::JSError(rt, zk_error_message(status));
        return Value::undefined();
      });
  runtime.global().setProperty(runtime, "zeroKernelRelease", std::move(release));
}

} // namespace zero_kernel
