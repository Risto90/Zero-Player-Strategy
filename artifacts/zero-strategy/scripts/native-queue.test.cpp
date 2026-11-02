#include "../kernel/src/native/serial_queue.hpp"

#include <array>
#include <future>
#include <mutex>
#include <vector>

int main() {
  zero_kernel::SerialQueue queue;
  std::mutex result_mutex;
  std::vector<int> execution_order;
  std::array<std::future<int>, 6> completions;

  for (int task = 0; task < static_cast<int>(completions.size()); ++task) {
    completions[task] = queue.submit([task, &result_mutex, &execution_order] {
      std::lock_guard<std::mutex> lock(result_mutex);
      execution_order.push_back(task);
      return task;
    });
  }

  for (int task = 0; task < static_cast<int>(completions.size()); ++task) {
    if (completions[task].get() != task)
      return 1;
  }
  if (execution_order.size() != completions.size())
    return 1;
  for (int task = 0; task < static_cast<int>(execution_order.size()); ++task) {
    if (execution_order[task] != task)
      return 1;
  }
  return 0;
}
