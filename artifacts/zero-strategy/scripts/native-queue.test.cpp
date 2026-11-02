#include "../kernel/src/native/serial_queue.hpp"
#include "../kernel/src/native/thread_pool.hpp"

#include <array>
#include <atomic>
#include <chrono>
#include <future>
#include <mutex>
#include <stdexcept>
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

  if (zero_kernel::ThreadPool::recommended_workers(0, 0) != 1 ||
      zero_kernel::ThreadPool::recommended_workers(128, 1024u * 1024u * 1024u) != 8)
    return 1;

  zero_kernel::ThreadPool pool(3, 8);
  std::atomic<int> active{0};
  std::atomic<int> peak{0};
  std::array<std::future<int>, 6> parallel;
  for (int task = 0; task < static_cast<int>(parallel.size()); ++task) {
    parallel[task] = pool.submit([task, &active, &peak] {
      const int current = active.fetch_add(1) + 1;
      int observed = peak.load();
      while (observed < current && !peak.compare_exchange_weak(observed, current)) {}
      std::this_thread::sleep_for(std::chrono::milliseconds(25));
      active.fetch_sub(1);
      return task * 2;
    });
  }
  for (int task = 0; task < static_cast<int>(parallel.size()); ++task)
    if (parallel[task].get() != task * 2)
      return 1;
  if (peak.load() < 2 || peak.load() > 3)
    return 1;

  zero_kernel::ThreadPool bounded(1, 1);
  std::promise<void> release;
  auto ready = release.get_future().share();
  auto blocked = bounded.submit([ready] { ready.wait(); return 1; });
  std::this_thread::sleep_for(std::chrono::milliseconds(5));
  auto waiting = bounded.submit([] { return 2; });
  bool rejected = false;
  try {
    (void)bounded.submit([] { return 3; });
  } catch (const std::runtime_error &) {
    rejected = true;
  }
  release.set_value();
  if (!rejected || blocked.get() != 1 || waiting.get() != 2)
    return 1;
  return 0;
}
