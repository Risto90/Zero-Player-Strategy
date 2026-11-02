#ifndef ZERO_KERNEL_THREAD_POOL_HPP
#define ZERO_KERNEL_THREAD_POOL_HPP

#include <algorithm>
#include <condition_variable>
#include <cstddef>
#include <functional>
#include <future>
#include <mutex>
#include <queue>
#include <stdexcept>
#include <thread>
#include <type_traits>
#include <utility>
#include <vector>

namespace zero_kernel {

/** Ограниченный FIFO-пул для независимых нативных расчётов. */
class ThreadPool {
public:
  explicit ThreadPool(std::size_t workers,
                      std::size_t max_pending = kDefaultMaxPending)
      : max_pending_(max_pending) {
    if (workers == 0 || max_pending_ == 0)
      throw std::invalid_argument("Число потоков и размер очереди должны быть больше нуля");
    if (workers > kMaxWorkers)
      throw std::invalid_argument("Превышен предел потоков нативного пула");
    workers_.reserve(workers);
    try {
      for (std::size_t index = 0; index < workers; ++index)
        workers_.emplace_back([this] { run(); });
    } catch (...) {
      close();
      throw;
    }
  }

  ThreadPool(const ThreadPool &) = delete;
  ThreadPool &operator=(const ThreadPool &) = delete;

  ~ThreadPool() { close(); }

  static std::size_t recommended_workers(
      std::size_t hardware_threads = std::thread::hardware_concurrency(),
      std::size_t memory_limit_bytes = 256u * 1024u * 1024u) {
    const std::size_t cpu_limit = hardware_threads > 1 ? hardware_threads - 1 : 1;
    const std::size_t memory_limit = std::max<std::size_t>(1, memory_limit_bytes / kMemoryPerWorker);
    return std::min({cpu_limit, memory_limit, kMaxWorkers});
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
        throw std::runtime_error("Нативный пул уже остановлен");
      if (tasks_.size() >= max_pending_)
        throw std::runtime_error("Достигнут предел задач нативного пула");
      tasks_.emplace([packaged] { (*packaged)(); });
    }
    ready_.notify_one();
    return result;
  }

  /** Закрывает приём и дожидается выполнения уже поставленных задач. */
  void close() noexcept {
    {
      std::lock_guard<std::mutex> lock(mutex_);
      if (stopping_) return;
      stopping_ = true;
    }
    ready_.notify_all();
    for (auto &worker : workers_)
      if (worker.joinable()) worker.join();
    workers_.clear();
  }

private:
  static constexpr std::size_t kDefaultMaxPending = 4096;
  static constexpr std::size_t kMaxWorkers = 8;
  static constexpr std::size_t kMemoryPerWorker = 64u * 1024u * 1024u;

  void run() {
    for (;;) {
      std::function<void()> task;
      {
        std::unique_lock<std::mutex> lock(mutex_);
        ready_.wait(lock, [this] { return stopping_ || !tasks_.empty(); });
        if (stopping_ && tasks_.empty()) return;
        task = std::move(tasks_.front());
        tasks_.pop();
      }
      task();
    }
  }

  std::size_t max_pending_;
  std::mutex mutex_;
  std::condition_variable ready_;
  std::queue<std::function<void()>> tasks_;
  bool stopping_ = false;
  std::vector<std::thread> workers_;
};

} // namespace zero_kernel

#endif
