#ifndef ZERO_KERNEL_SERIAL_QUEUE_HPP
#define ZERO_KERNEL_SERIAL_QUEUE_HPP

#include <condition_variable>
#include <functional>
#include <future>
#include <mutex>
#include <queue>
#include <stdexcept>
#include <thread>
#include <type_traits>
#include <utility>

namespace zero_kernel {

/* Однопоточная FIFO-очередь для нативных вычислительных запросов. */
class SerialQueue {
public:
  SerialQueue() : worker_([this] { run(); }) {}

  SerialQueue(const SerialQueue &) = delete;
  SerialQueue &operator=(const SerialQueue &) = delete;

  ~SerialQueue() {
    {
      std::lock_guard<std::mutex> lock(mutex_);
      stopping_ = true;
    }
    ready_.notify_one();
    if (worker_.joinable())
      worker_.join();
  }

  template <class Task>
  auto submit(Task &&task) -> std::future<std::invoke_result_t<Task>> {
    using Result = std::invoke_result_t<Task>;
    auto packaged = std::make_shared<std::packaged_task<Result()>>(
        std::forward<Task>(task));
    auto result = packaged->get_future();
    {
      std::lock_guard<std::mutex> lock(mutex_);
      if (stopping_)
        throw std::runtime_error("Нативная очередь уже остановлена");
      if (tasks_.size() >= kMaxPendingTasks)
        throw std::runtime_error("Достигнут предел задач в очереди");
      tasks_.emplace([packaged] { (*packaged)(); });
    }
    ready_.notify_one();
    return result;
  }

private:
  static constexpr size_t kMaxPendingTasks = 4096;

  void run() {
    for (;;) {
      std::function<void()> task;
      {
        std::unique_lock<std::mutex> lock(mutex_);
        ready_.wait(lock, [this] { return stopping_ || !tasks_.empty(); });
        if (stopping_ && tasks_.empty())
          return;
        task = std::move(tasks_.front());
        tasks_.pop();
      }
      task();
    }
  }

  std::mutex mutex_;
  std::condition_variable ready_;
  std::queue<std::function<void()>> tasks_;
  bool stopping_ = false;
  std::thread worker_;
};

} // namespace zero_kernel

#endif
