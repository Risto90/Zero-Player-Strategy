#include "zero_kernel.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <map>
#include <new>
#include <stdexcept>
#include <unordered_map>
#include <vector>

namespace {

bool valid_input(const zk_contour_span *spans, uint32_t count,
                 uint32_t width, uint32_t height) {
  if (count != 0 && spans == nullptr)
    return false;
  if (width > static_cast<uint32_t>(std::numeric_limits<int32_t>::max()) ||
      height > static_cast<uint32_t>(std::numeric_limits<int32_t>::max()))
    return false;
  for (uint32_t index = 0; index < count; ++index) {
    const zk_contour_span &span = spans[index];
    if (span.y < 0 || span.y >= static_cast<int32_t>(height) ||
        span.start < 0 || span.end <= span.start ||
        span.end > static_cast<int32_t>(width))
      return false;
  }
  return true;
}

bool already_normalized(const zk_contour_span *spans, uint32_t count,
                        uint32_t width, uint32_t height) {
  if (count != 0 && spans == nullptr) return false;
  for (uint32_t index = 0; index < count; ++index) {
    const zk_contour_span &span = spans[index];
    if (span.y < 0 || span.y >= static_cast<int32_t>(height) ||
        span.start < 0 || span.end <= span.start ||
        span.end > static_cast<int32_t>(width))
      return false;
    if (index != 0) {
      const zk_contour_span &previous = spans[index - 1];
      if (previous.y > span.y ||
          (previous.y == span.y && previous.end >= span.start))
        return false;
    }
  }
  return true;
}

std::vector<zk_contour_span> normalize(const zk_contour_span *spans,
                                       uint32_t count, uint32_t width,
                                       uint32_t height) {
  if (already_normalized(spans, count, width, height)) {
    if (count == 0) return {};
    return std::vector<zk_contour_span>(spans, spans + count);
  }
  std::vector<zk_contour_span> result;
  result.reserve(count);
  for (uint32_t index = 0; index < count; ++index) {
    const zk_contour_span &span = spans[index];
    if (span.y < 0 || span.y >= static_cast<int32_t>(height))
      continue;
    const int32_t start = std::max<int32_t>(0, span.start);
    const int32_t end =
        std::min<int32_t>(static_cast<int32_t>(width), span.end);
    if (end > start)
      result.push_back({span.y, start, end});
  }
  std::sort(result.begin(), result.end(),
            [](const zk_contour_span &left, const zk_contour_span &right) {
              return left.y < right.y ||
                     (left.y == right.y && left.start < right.start);
            });
  std::vector<zk_contour_span> merged;
  merged.reserve(result.size());
  for (const zk_contour_span &span : result) {
    if (!merged.empty() && merged.back().y == span.y &&
        merged.back().end >= span.start) {
      merged.back().end = std::max(merged.back().end, span.end);
    } else {
      merged.push_back(span);
    }
  }
  return merged;
}

std::vector<zk_contour_span>
unite(const std::vector<zk_contour_span> &left,
      const std::vector<zk_contour_span> &right) {
  std::vector<zk_contour_span> result;
  result.reserve(left.size() + right.size());
  size_t a = 0;
  size_t b = 0;
  while (a < left.size() || b < right.size()) {
    const zk_contour_span *next = nullptr;
    if (b == right.size() ||
        (a < left.size() &&
         (left[a].y < right[b].y ||
          (left[a].y == right[b].y && left[a].start <= right[b].start)))) {
      next = &left[a++];
    } else {
      next = &right[b++];
    }
    if (!result.empty() && result.back().y == next->y &&
        result.back().end >= next->start) {
      result.back().end = std::max(result.back().end, next->end);
    } else {
      result.push_back(*next);
    }
  }
  return result;
}

std::vector<zk_contour_span>
intersect(const std::vector<zk_contour_span> &left,
          const std::vector<zk_contour_span> &right) {
  std::vector<zk_contour_span> result;
  uint32_t a = 0;
  uint32_t b = 0;
  while (a < left.size() && b < right.size()) {
    const zk_contour_span &first = left[a];
    const zk_contour_span &second = right[b];
    if (first.y < second.y ||
        (first.y == second.y && first.end <= second.start)) {
      ++a;
      continue;
    }
    if (second.y < first.y || second.end <= first.start) {
      ++b;
      continue;
    }
    result.push_back(
        {first.y, std::max(first.start, second.start),
         std::min(first.end, second.end)});
    if (first.end <= second.end)
      ++a;
    else
      ++b;
  }
  return result;
}

std::vector<zk_contour_span>
subtract(const std::vector<zk_contour_span> &left,
         const std::vector<zk_contour_span> &right) {
  std::vector<zk_contour_span> result;
  size_t cursor = 0;
  for (const zk_contour_span &span : left) {
    while (cursor < right.size() &&
           (right[cursor].y < span.y ||
            (right[cursor].y == span.y &&
             right[cursor].end <= span.start)))
      ++cursor;
    int32_t start = span.start;
    for (size_t index = cursor; index < right.size(); ++index) {
      const zk_contour_span &cut = right[index];
      if (cut.y != span.y || cut.start >= span.end)
        break;
      if (cut.start > start)
        result.push_back({span.y, start, std::min(cut.start, span.end)});
      start = std::max(start, cut.end);
      if (start >= span.end)
        break;
    }
    if (start < span.end)
      result.push_back({span.y, start, span.end});
  }
  return result;
}

std::vector<zk_contour_span>
offset(const std::vector<zk_contour_span> &spans, uint32_t width,
       uint32_t height, double distance) {
  std::vector<zk_contour_span> expanded;
  if (distance > static_cast<double>(std::max(width, height)))
    distance = static_cast<double>(std::max(width, height));
  const int32_t rows = static_cast<int32_t>(std::floor(distance));
  const double squared = distance * distance;
  for (int32_t dy = -rows; dy <= rows; ++dy) {
    const int32_t dx = static_cast<int32_t>(
        std::floor(std::sqrt(std::max(0.0, squared - dy * dy))));
    for (const zk_contour_span &span : spans) {
      const int64_t y = static_cast<int64_t>(span.y) + dy;
      if (y < 0 || y >= height)
        continue;
      const int64_t start = std::max<int64_t>(0, span.start - dx);
      const int64_t end =
          std::min<int64_t>(static_cast<int64_t>(width), span.end + dx);
      if (end > start)
        expanded.push_back({static_cast<int32_t>(y),
                            static_cast<int32_t>(start),
                            static_cast<int32_t>(end)});
    }
  }
  return normalize(expanded.data(), static_cast<uint32_t>(expanded.size()),
                   width, height);
}

} // пространство имён

extern "C" zk_error zk_contour_spans_execute(
    zk_contour_span_operation operation, const zk_contour_span *left,
    uint32_t left_count, const zk_contour_span *right, uint32_t right_count,
    uint32_t width, uint32_t height, double distance,
    zk_contour_span *output, uint32_t output_capacity,
    uint32_t *output_count) {
  if (output_count == nullptr || width == 0 || height == 0 ||
      width > static_cast<uint32_t>(std::numeric_limits<int32_t>::max()) ||
      height > static_cast<uint32_t>(std::numeric_limits<int32_t>::max()) ||
      (left_count != 0 && left == nullptr) ||
      (right_count != 0 && right == nullptr))
    return ZK_ERROR_INVALID_ARGUMENT;
  if (operation < ZK_CONTOUR_NORMALIZE || operation > ZK_CONTOUR_OFFSET)
    return ZK_ERROR_INVALID_ARGUMENT;
  if (operation == ZK_CONTOUR_OFFSET &&
      (!std::isfinite(distance) || distance < 0.0))
    return ZK_ERROR_INVALID_ARGUMENT;
  if (left_count > ZK_MAX_BUFFER_SLOTS * 1024u ||
      right_count > ZK_MAX_BUFFER_SLOTS * 1024u)
    return ZK_ERROR_OUT_OF_RANGE;

  try {
    if (operation != ZK_CONTOUR_NORMALIZE &&
        (!valid_input(left, left_count, width, height) ||
         (operation != ZK_CONTOUR_BORDER &&
          operation != ZK_CONTOUR_OFFSET &&
          !valid_input(right, right_count, width, height))))
      return ZK_ERROR_INVALID_ARGUMENT;

    const auto first = normalize(left, left_count, width, height);
    std::vector<zk_contour_span> result;
    switch (operation) {
    case ZK_CONTOUR_NORMALIZE:
      result = first;
      break;
    case ZK_CONTOUR_INTERSECTION:
      result = intersect(first, normalize(right, right_count, width, height));
      break;
    case ZK_CONTOUR_UNION: {
      const auto second = normalize(right, right_count, width, height);
      result = unite(first, second);
      break;
    }
    case ZK_CONTOUR_DIFFERENCE:
      result = subtract(first, normalize(right, right_count, width, height));
      break;
    case ZK_CONTOUR_BORDER: {
      std::vector<zk_contour_span> expanded;
      expanded.reserve(first.size() * 3);
      for (const zk_contour_span &span : first) {
        expanded.push_back({span.y, std::max<int32_t>(0, span.start - 1),
                            std::min<int32_t>(width, span.end + 1)});
        if (span.y > 0)
          expanded.push_back({span.y - 1, span.start, span.end});
        if (span.y + 1 < static_cast<int32_t>(height))
          expanded.push_back({span.y + 1, span.start, span.end});
      }
      result = subtract(normalize(expanded.data(),
                                  static_cast<uint32_t>(expanded.size()),
                                  width, height),
                        first);
      break;
    }
    case ZK_CONTOUR_OFFSET:
      result = offset(first, width, height, distance);
      break;
    }

    if (result.size() > output_capacity ||
        (!result.empty() && output == nullptr))
      return ZK_ERROR_OUT_OF_RANGE;
    std::copy(result.begin(), result.end(), output);
    *output_count = static_cast<uint32_t>(result.size());
    return ZK_OK;
  } catch (const std::bad_alloc &) {
    return ZK_ERROR_OUT_OF_MEMORY;
  } catch (...) {
    return ZK_ERROR_INTERNAL;
  }
}

extern "C" zk_error zk_contour_replace_region(
    const zk_contour_span *source, uint32_t source_count,
    const zk_contour_span *replacement, uint32_t replacement_count,
    int32_t x0, int32_t y0, int32_t x1, int32_t y1,
    uint32_t width, uint32_t height, zk_contour_span *output,
    uint32_t output_capacity, uint32_t *output_count) {
  if (output_count == nullptr || width == 0 || height == 0 ||
      width > static_cast<uint32_t>(std::numeric_limits<int32_t>::max()) ||
      height > static_cast<uint32_t>(std::numeric_limits<int32_t>::max()) ||
      (source_count != 0 && source == nullptr) ||
      (replacement_count != 0 && replacement == nullptr))
    return ZK_ERROR_INVALID_ARGUMENT;
  if (source_count > ZK_MAX_BUFFER_SLOTS * 1024u ||
      replacement_count > ZK_MAX_BUFFER_SLOTS * 1024u)
    return ZK_ERROR_OUT_OF_RANGE;

  try {
    const auto original = normalize(source, source_count, width, height);
    const auto incoming =
        normalize(replacement, replacement_count, width, height);
    const int64_t clipped_x0 = std::max<int64_t>(0, x0);
    const int64_t clipped_x_end =
        std::min<int64_t>(width, static_cast<int64_t>(x1) + 1);
    const int64_t clipped_y0 = std::max<int64_t>(0, y0);
    const int64_t clipped_y1 =
        std::min<int64_t>(static_cast<int64_t>(height) - 1, y1);

    std::vector<zk_contour_span> result;
    if (clipped_x_end <= clipped_x0 || clipped_y1 < clipped_y0) {
      result = original;
    } else {
      result.reserve(original.size() + incoming.size());
      for (const zk_contour_span &span : original) {
        if (span.y < clipped_y0 || span.y > clipped_y1 ||
            span.end <= clipped_x0 || span.start >= clipped_x_end) {
          result.push_back(span);
          continue;
        }
        if (span.start < clipped_x0)
          result.push_back({span.y, span.start,
                            static_cast<int32_t>(clipped_x0)});
        if (span.end > clipped_x_end)
          result.push_back({span.y, static_cast<int32_t>(clipped_x_end),
                            span.end});
      }
      for (const zk_contour_span &span : incoming) {
        if (span.y < clipped_y0 || span.y > clipped_y1) continue;
        const int32_t start = static_cast<int32_t>(
            std::max<int64_t>(clipped_x0, span.start));
        const int32_t end = static_cast<int32_t>(
            std::min<int64_t>(clipped_x_end, span.end));
        if (end > start) result.push_back({span.y, start, end});
      }
      result = normalize(result.data(), static_cast<uint32_t>(result.size()),
                         width, height);
    }

    *output_count = static_cast<uint32_t>(result.size());
    if (result.size() > output_capacity ||
        (!result.empty() && output == nullptr))
      return ZK_ERROR_OUT_OF_RANGE;
    if (!result.empty())
      std::copy(result.begin(), result.end(), output);
    return ZK_OK;
  } catch (const std::bad_alloc &) {
    return ZK_ERROR_OUT_OF_MEMORY;
  } catch (...) {
    return ZK_ERROR_INTERNAL;
  }
}

extern "C" zk_error zk_contour_classify_spans(
    const uint8_t *humidity, const float *temperature,
    const uint8_t *drainage, const zk_contour_span *spans,
    uint32_t span_count, uint32_t width, uint32_t height,
    double *output, uint32_t output_capacity, uint32_t *output_count) {
  if (output_count == nullptr || width == 0 || height == 0 ||
      width > static_cast<uint32_t>(std::numeric_limits<int32_t>::max()) ||
      height > static_cast<uint32_t>(std::numeric_limits<int32_t>::max()) ||
      !valid_input(spans, span_count, width, height))
    return ZK_ERROR_INVALID_ARGUMENT;
  const uint64_t pixel_count = static_cast<uint64_t>(width) * height;
  if (pixel_count > std::numeric_limits<size_t>::max() ||
      (pixel_count != 0 &&
       (humidity == nullptr || temperature == nullptr || drainage == nullptr)))
    return ZK_ERROR_INVALID_ARGUMENT;

  auto scan = [&](double *destination, uint64_t &count) {
    count = 0;
    for (uint32_t index = 0; index < span_count; ++index) {
      const zk_contour_span &span = spans[index];
      uint32_t x = static_cast<uint32_t>(span.start);
      const uint32_t end = static_cast<uint32_t>(span.end);
      const uint64_t row = static_cast<uint64_t>(span.y) * width;
      while (x < end) {
        const uint64_t pixel = row + x;
        const uint8_t h = humidity[pixel];
        const float t = temperature[pixel];
        const uint8_t d = drainage[pixel];
        if (!std::isfinite(t)) return false;
        uint32_t run_end = x + 1;
        while (run_end < end) {
          const uint64_t next = row + run_end;
          const float next_temperature = temperature[next];
          if (!std::isfinite(next_temperature)) return false;
          if (humidity[next] != h || next_temperature != t ||
              drainage[next] != d)
            break;
          ++run_end;
        }
        if (destination != nullptr) {
          const uint64_t offset = count * 6;
          destination[offset] = h;
          destination[offset + 1] = t;
          destination[offset + 2] = d;
          destination[offset + 3] = span.y;
          destination[offset + 4] = x;
          destination[offset + 5] = run_end;
        }
        ++count;
        x = run_end;
      }
    }
    return true;
  };

  uint64_t count = 0;
  if (!scan(nullptr, count)) return ZK_ERROR_INVALID_ARGUMENT;
  if (count > std::numeric_limits<uint32_t>::max())
    return ZK_ERROR_OUT_OF_RANGE;
  *output_count = static_cast<uint32_t>(count);
  if (count > output_capacity || (count != 0 && output == nullptr))
    return ZK_ERROR_OUT_OF_RANGE;
  uint64_t written = 0;
  if (!scan(output, written) || written != count) return ZK_ERROR_INTERNAL;
  return ZK_OK;
}

extern "C" zk_error zk_contour_rasterize_polygons(
    const double *coordinates, uint32_t point_count,
    const uint32_t *ring_offsets, uint32_t ring_count,
    const uint32_t *polygon_offsets, uint32_t polygon_count,
    uint32_t width, uint32_t height, zk_contour_span *output,
    uint32_t output_capacity, uint32_t *output_count) {
  if (output_count == nullptr || width == 0 || height == 0 ||
      width > static_cast<uint32_t>(std::numeric_limits<int32_t>::max()) ||
      height > static_cast<uint32_t>(std::numeric_limits<int32_t>::max()) ||
      (point_count != 0 && coordinates == nullptr) ||
      (ring_count != 0 && ring_offsets == nullptr) ||
      (polygon_count != 0 && polygon_offsets == nullptr))
    return ZK_ERROR_INVALID_ARGUMENT;
  if (point_count > ZK_MAX_BUFFER_SLOTS * 1024u ||
      ring_count > ZK_MAX_BUFFER_SLOTS * 1024u ||
      polygon_count > ZK_MAX_BUFFER_SLOTS * 1024u)
    return ZK_ERROR_OUT_OF_RANGE;

  if (ring_count == 0) {
    if (point_count != 0 ||
        (polygon_count != 0 &&
         (polygon_offsets[0] != 0 ||
          polygon_offsets[polygon_count] != 0)))
      return ZK_ERROR_INVALID_ARGUMENT;
    *output_count = 0;
    return ZK_OK;
  }
  if (polygon_count == 0 || ring_offsets[0] != 0 ||
      ring_offsets[ring_count] != point_count || polygon_offsets[0] != 0 ||
      polygon_offsets[polygon_count] != ring_count)
    return ZK_ERROR_INVALID_ARGUMENT;
  for (uint32_t ring = 0; ring < ring_count; ++ring) {
    if (ring_offsets[ring + 1] < ring_offsets[ring] ||
        ring_offsets[ring + 1] > point_count ||
        ring_offsets[ring + 1] - ring_offsets[ring] < 3)
      return ZK_ERROR_INVALID_ARGUMENT;
  }
  for (uint32_t polygon = 0; polygon < polygon_count; ++polygon) {
    if (polygon_offsets[polygon + 1] < polygon_offsets[polygon])
      return ZK_ERROR_INVALID_ARGUMENT;
    if (polygon_offsets[polygon + 1] > ring_count)
      return ZK_ERROR_INVALID_ARGUMENT;
  }
  for (uint32_t index = 0; index < point_count * 2; ++index) {
    if (!std::isfinite(coordinates[index]))
      return ZK_ERROR_INVALID_ARGUMENT;
  }

  try {
    std::vector<zk_contour_span> spans;
    std::vector<double> crossings;
    for (uint32_t polygon = 0; polygon < polygon_count; ++polygon) {
      double min_y = std::numeric_limits<double>::infinity();
      double max_y = -std::numeric_limits<double>::infinity();
      for (uint32_t ring = polygon_offsets[polygon];
           ring < polygon_offsets[polygon + 1]; ++ring) {
        for (uint32_t point = ring_offsets[ring];
             point < ring_offsets[ring + 1]; ++point) {
          const double y = coordinates[point * 2 + 1];
          min_y = std::min(min_y, y);
          max_y = std::max(max_y, y);
        }
      }
      if (!std::isfinite(min_y))
        continue;
      const int32_t first_y = static_cast<int32_t>(std::max(
          0.0, std::floor(min_y - 0.5)));
      const int32_t last_y = static_cast<int32_t>(std::min(
          static_cast<double>(height), std::ceil(max_y - 0.5)));
      for (int32_t y = first_y; y < last_y; ++y) {
        const double scan_y = static_cast<double>(y) + 0.5;
        crossings.clear();
        for (uint32_t ring = polygon_offsets[polygon];
             ring < polygon_offsets[polygon + 1]; ++ring) {
          const uint32_t first = ring_offsets[ring];
          const uint32_t last = ring_offsets[ring + 1];
          for (uint32_t point = first; point < last; ++point) {
            const uint32_t next = point + 1 == last ? first : point + 1;
            const double x1 = coordinates[point * 2];
            const double y1 = coordinates[point * 2 + 1];
            const double x2 = coordinates[next * 2];
            const double y2 = coordinates[next * 2 + 1];
            if ((y1 > scan_y) == (y2 > scan_y))
              continue;
            const double crossing = x1 + (scan_y - y1) * (x2 - x1) / (y2 - y1);
            if (!std::isfinite(crossing))
              return ZK_ERROR_OVERFLOW;
            crossings.push_back(crossing);
          }
        }
        std::sort(crossings.begin(), crossings.end());
        for (size_t index = 1; index < crossings.size(); index += 2) {
          const double start = std::max(0.0, std::ceil(crossings[index - 1] - 0.5));
          const double end = std::min(
              static_cast<double>(width), std::ceil(crossings[index] - 0.5));
          if (end > start)
            spans.push_back({y, static_cast<int32_t>(start),
                             static_cast<int32_t>(end)});
        }
      }
    }
    const auto result = normalize(spans.data(),
                                  static_cast<uint32_t>(spans.size()),
                                  width, height);
    *output_count = static_cast<uint32_t>(result.size());
    if (result.size() > output_capacity ||
        (!result.empty() && output == nullptr))
      return ZK_ERROR_OUT_OF_RANGE;
    std::copy(result.begin(), result.end(), output);
    return ZK_OK;
  } catch (const std::bad_alloc &) {
    return ZK_ERROR_OUT_OF_MEMORY;
  } catch (...) {
    return ZK_ERROR_INTERNAL;
  }
}

extern "C" zk_error zk_contour_link_rings(
    const uint32_t *codes, uint32_t code_count, uint32_t width,
    uint32_t height, int32_t *output_xy, uint32_t point_capacity,
    uint32_t *output_ring_offsets, uint32_t ring_capacity,
    uint32_t *output_point_count, uint32_t *output_ring_count) {
  if (output_point_count == nullptr || output_ring_count == nullptr ||
      width == 0 || height == 0 ||
      width > static_cast<uint32_t>(std::numeric_limits<int32_t>::max()) ||
      height > static_cast<uint32_t>(std::numeric_limits<int32_t>::max()) ||
      (code_count != 0 && codes == nullptr))
    return ZK_ERROR_INVALID_ARGUMENT;
  if (code_count > ZK_MAX_BUFFER_SLOTS * 1024u)
    return ZK_ERROR_OUT_OF_RANGE;

  const uint64_t vertex_width = static_cast<uint64_t>(width) + 1;
  const uint64_t vertex_height = static_cast<uint64_t>(height) + 1;
  const uint64_t vertex_count = vertex_width * vertex_height;
  for (uint32_t index = 0; index < code_count; ++index) {
    const uint32_t vertex = codes[index] >> 2;
    const uint32_t direction = codes[index] & 3u;
    if (vertex >= vertex_count)
      return ZK_ERROR_INVALID_ARGUMENT;
    const uint32_t x = static_cast<uint32_t>(vertex % vertex_width);
    const uint32_t y = static_cast<uint32_t>(vertex / vertex_width);
    if ((direction == 0 && x >= width) ||
        (direction == 1 && y >= height) ||
        (direction == 2 && x == 0) ||
        (direction == 3 && y == 0))
      return ZK_ERROR_INVALID_ARGUMENT;
  }

  try {
    std::unordered_map<uint32_t, std::vector<uint32_t>> outgoing;
    outgoing.reserve(code_count);
    for (uint32_t index = 0; index < code_count; ++index)
      outgoing[codes[index] >> 2].push_back(index);

    std::vector<uint8_t> used(code_count, 0);
    std::vector<int32_t> coordinates;
    std::vector<uint32_t> ring_offsets;
    coordinates.reserve(static_cast<size_t>(code_count) * 2);
    ring_offsets.reserve(static_cast<size_t>(code_count) + 1);
    ring_offsets.push_back(0);
    const int64_t steps[4] = {
        1, static_cast<int64_t>(vertex_width), -1,
        -static_cast<int64_t>(vertex_width)};

    for (uint32_t first = 0; first < code_count; ++first) {
      if (used[first])
        continue;
      const uint32_t start_vertex = codes[first] >> 2;
      std::vector<uint32_t> vertices;
      std::vector<uint32_t> directions;
      uint32_t current = first;
      int32_t previous_direction = -1;
      for (uint64_t guard = 0; guard <= code_count; ++guard) {
        used[current] = 1;
        const uint32_t code = codes[current];
        const uint32_t vertex = code >> 2;
        const uint32_t direction = code & 3u;
        if (static_cast<int32_t>(direction) != previous_direction) {
          vertices.push_back(vertex);
          directions.push_back(direction);
        }
        previous_direction = static_cast<int32_t>(direction);
        const int64_t end_vertex_signed =
            static_cast<int64_t>(vertex) + steps[direction];
        if (end_vertex_signed == start_vertex)
          break;
        if (end_vertex_signed < 0 ||
            static_cast<uint64_t>(end_vertex_signed) >= vertex_count)
          break;
        const auto found = outgoing.find(static_cast<uint32_t>(end_vertex_signed));
        if (found == outgoing.end())
          break;

        int64_t next = -1;
        const uint32_t preferred[3] = {
            (direction + 1u) & 3u, direction, (direction + 3u) & 3u};
        for (uint32_t preference : preferred) {
          for (uint32_t option : found->second) {
            if (!used[option] && (codes[option] & 3u) == preference) {
              next = option;
              break;
            }
          }
          if (next >= 0)
            break;
        }
        if (next < 0)
          break;
        current = static_cast<uint32_t>(next);
      }

      if (vertices.size() > 1 && !directions.empty() &&
          static_cast<int32_t>(directions.front()) == previous_direction)
        vertices.erase(vertices.begin());
      for (uint32_t vertex : vertices) {
        coordinates.push_back(static_cast<int32_t>(vertex % vertex_width));
        coordinates.push_back(static_cast<int32_t>(vertex / vertex_width));
      }
      ring_offsets.push_back(
          static_cast<uint32_t>(coordinates.size() / 2));
    }

    const uint32_t point_count =
        static_cast<uint32_t>(coordinates.size() / 2);
    const uint32_t ring_count =
        static_cast<uint32_t>(ring_offsets.size() - 1);
    *output_point_count = point_count;
    *output_ring_count = ring_count;
    if (point_count > point_capacity || ring_offsets.size() > ring_capacity ||
        (point_count != 0 && output_xy == nullptr) ||
        (ring_offsets.size() != 0 && output_ring_offsets == nullptr))
      return ZK_ERROR_OUT_OF_RANGE;
    if (!coordinates.empty())
      std::copy(coordinates.begin(), coordinates.end(), output_xy);
    std::copy(ring_offsets.begin(), ring_offsets.end(), output_ring_offsets);
    return ZK_OK;
  } catch (const std::bad_alloc &) {
    return ZK_ERROR_OUT_OF_MEMORY;
  } catch (...) {
    return ZK_ERROR_INTERNAL;
  }
}

extern "C" zk_error zk_contour_trace_scalar_chunk(
    const double *values, const uint8_t *include, uint32_t local_pixel_count,
    uint32_t source_row_start, uint32_t process_row_start,
    uint32_t process_row_end, uint32_t width, uint32_t height,
    uint8_t has_skip, double skip_value, double *output_values,
    uint32_t value_capacity, uint32_t *output_offsets,
    uint32_t offset_capacity, uint32_t *output_codes,
    uint32_t code_capacity, uint32_t *output_group_count,
    uint32_t *output_code_count) {
  if (output_group_count == nullptr || output_code_count == nullptr ||
      values == nullptr || width == 0 || height == 0 ||
      width > static_cast<uint32_t>(std::numeric_limits<int32_t>::max()) ||
      height > static_cast<uint32_t>(std::numeric_limits<int32_t>::max()) ||
      local_pixel_count % width != 0 ||
      (has_skip != 0 && !std::isfinite(skip_value)))
    return ZK_ERROR_INVALID_ARGUMENT;
  const uint32_t local_rows = local_pixel_count / width;
  const uint64_t source_row_end =
      static_cast<uint64_t>(source_row_start) + local_rows;
  if (local_rows == 0 || source_row_end > height ||
      process_row_start < source_row_start ||
      process_row_end < process_row_start ||
      process_row_end > source_row_end ||
      process_row_end > height)
    return ZK_ERROR_INVALID_ARGUMENT;
  if (local_pixel_count > ZK_MAX_BUFFER_SLOTS * 1024u)
    return ZK_ERROR_OUT_OF_RANGE;
  for (uint32_t index = 0; index < local_pixel_count; ++index) {
    if (!std::isfinite(values[index]))
      return ZK_ERROR_INVALID_ARGUMENT;
  }

  try {
    std::map<double, std::vector<uint32_t>> buckets;
    const uint32_t vertex_width = width + 1;
    const auto inside = [&](int64_t x, int64_t y) {
      if (x < 0 || y < 0 || x >= width || y >= height ||
          y < source_row_start || y >= static_cast<int64_t>(source_row_end))
        return false;
      const uint32_t local_index =
          static_cast<uint32_t>(y - source_row_start) * width +
          static_cast<uint32_t>(x);
      return (include == nullptr || include[local_index] == 1) &&
             (!has_skip || values[local_index] != skip_value);
    };
    const auto add_edge = [&](double value, uint32_t x, uint32_t y,
                              uint32_t side) {
      uint64_t vertex = 0;
      if (side == 0)
        vertex = static_cast<uint64_t>(y) * vertex_width + x;
      else if (side == 1)
        vertex = static_cast<uint64_t>(y) * vertex_width + x + 1;
      else if (side == 2)
        vertex = static_cast<uint64_t>(y + 1) * vertex_width + x + 1;
      else
        vertex = static_cast<uint64_t>(y + 1) * vertex_width + x;
      const uint64_t code = vertex * 4 + side;
      if (code > std::numeric_limits<uint32_t>::max())
        throw std::overflow_error("contour edge code overflow");
      buckets[value].push_back(static_cast<uint32_t>(code));
    };

    for (uint32_t y = process_row_start; y < process_row_end; ++y) {
      for (uint32_t x = 0; x < width; ++x) {
        if (!inside(x, y))
          continue;
        const uint32_t local_index = (y - source_row_start) * width + x;
        const double value = values[local_index];
        if (!inside(x, static_cast<int64_t>(y) - 1) ||
            values[(y - 1 - source_row_start) * width + x] != value)
          add_edge(value, x, y, 0);
        if (!inside(static_cast<int64_t>(x) + 1, y) ||
            values[(y - source_row_start) * width + x + 1] != value)
          add_edge(value, x, y, 1);
        if (!inside(x, static_cast<int64_t>(y) + 1) ||
            values[(y + 1 - source_row_start) * width + x] != value)
          add_edge(value, x, y, 2);
        if (!inside(static_cast<int64_t>(x) - 1, y) ||
            values[(y - source_row_start) * width + x - 1] != value)
          add_edge(value, x, y, 3);
      }
    }

    uint64_t code_count = 0;
    for (const auto &entry : buckets)
      code_count += entry.second.size();
    if (code_count > std::numeric_limits<uint32_t>::max())
      return ZK_ERROR_OUT_OF_RANGE;
    const uint32_t group_count = static_cast<uint32_t>(buckets.size());
    const uint32_t total_codes = static_cast<uint32_t>(code_count);
    *output_group_count = group_count;
    *output_code_count = total_codes;
    if (group_count > value_capacity ||
        static_cast<uint64_t>(group_count) + 1 > offset_capacity ||
        total_codes > code_capacity ||
        (group_count != 0 && output_values == nullptr) ||
        output_offsets == nullptr ||
        (total_codes != 0 && output_codes == nullptr))
      return ZK_ERROR_OUT_OF_RANGE;

    uint32_t group = 0;
    uint32_t offset = 0;
    output_offsets[0] = 0;
    for (const auto &entry : buckets) {
      output_values[group] = entry.first;
      std::copy(entry.second.begin(), entry.second.end(), output_codes + offset);
      offset += static_cast<uint32_t>(entry.second.size());
      output_offsets[++group] = offset;
    }
    return ZK_OK;
  } catch (const std::bad_alloc &) {
    return ZK_ERROR_OUT_OF_MEMORY;
  } catch (...) {
    return ZK_ERROR_INTERNAL;
  }
}

extern "C" zk_error zk_contour_trace_composition_chunk(
    const uint16_t *compositions, uint32_t local_pixel_count,
    const uint32_t *composition_offsets, uint32_t composition_count,
    const uint32_t *entity_ids, const double *shares, uint32_t entry_count,
    uint32_t source_row_start, uint32_t process_row_start,
    uint32_t process_row_end, uint32_t width, uint32_t height,
    uint32_t *output_entities, double *output_shares,
    uint32_t group_capacity, uint32_t *output_offsets,
    uint32_t offset_capacity, uint32_t *output_codes,
    uint32_t code_capacity, uint32_t *output_group_count,
    uint32_t *output_code_count) {
  if (output_group_count == nullptr || output_code_count == nullptr ||
      compositions == nullptr || composition_offsets == nullptr ||
      composition_count == 0 || width == 0 || height == 0 ||
      width > static_cast<uint32_t>(std::numeric_limits<int32_t>::max()) ||
      height > static_cast<uint32_t>(std::numeric_limits<int32_t>::max()) ||
      local_pixel_count % width != 0 ||
      (entry_count != 0 && (entity_ids == nullptr || shares == nullptr)))
    return ZK_ERROR_INVALID_ARGUMENT;
  const uint32_t local_rows = local_pixel_count / width;
  const uint64_t source_row_end =
      static_cast<uint64_t>(source_row_start) + local_rows;
  if (local_rows == 0 || source_row_end > height ||
      process_row_start < source_row_start ||
      process_row_end <= process_row_start ||
      process_row_end > source_row_end || process_row_end > height ||
      (process_row_start > 0 && source_row_start == process_row_start) ||
      (process_row_end < height && process_row_end == source_row_end))
    return ZK_ERROR_INVALID_ARGUMENT;
  if (local_pixel_count > ZK_MAX_BUFFER_SLOTS * 1024u ||
      composition_count > 65536u ||
      entry_count > ZK_MAX_BUFFER_SLOTS * 1024u)
    return ZK_ERROR_OUT_OF_RANGE;
  if (composition_offsets[0] != 0 ||
      composition_offsets[1] != 0 ||
      composition_offsets[composition_count] != entry_count)
    return ZK_ERROR_INVALID_ARGUMENT;
  for (uint32_t composition = 0; composition < composition_count; ++composition) {
    const uint32_t begin = composition_offsets[composition];
    const uint32_t end = composition_offsets[composition + 1];
    if (end < begin || end > entry_count)
      return ZK_ERROR_INVALID_ARGUMENT;
    for (uint32_t index = begin; index < end; ++index) {
      if (!std::isfinite(shares[index]) || shares[index] <= 0 ||
          (index > begin && entity_ids[index - 1] >= entity_ids[index]))
        return ZK_ERROR_INVALID_ARGUMENT;
    }
  }
  for (uint32_t index = 0; index < local_pixel_count; ++index) {
    if (compositions[index] >= composition_count)
      return ZK_ERROR_INVALID_ARGUMENT;
  }

  try {
    std::map<std::pair<uint32_t, double>, std::vector<uint32_t>> buckets;
    const uint32_t vertex_width = width + 1;
    const auto composition_at = [&](int64_t x, int64_t y) -> uint32_t {
      if (x < 0 || x >= width || y < 0 || y >= height)
        return 0;
      return compositions[(static_cast<uint32_t>(y) - source_row_start) * width +
                          static_cast<uint32_t>(x)];
    };
    const auto add_edge = [&](uint32_t entity, double share, uint32_t x,
                              uint32_t y, uint32_t side) {
      uint64_t vertex = 0;
      if (side == 0)
        vertex = static_cast<uint64_t>(y) * vertex_width + x;
      else if (side == 1)
        vertex = static_cast<uint64_t>(y) * vertex_width + x + 1;
      else if (side == 2)
        vertex = static_cast<uint64_t>(y + 1) * vertex_width + x + 1;
      else
        vertex = static_cast<uint64_t>(y + 1) * vertex_width + x;
      const uint64_t code = vertex * 4 + side;
      if (code > std::numeric_limits<uint32_t>::max())
        throw std::overflow_error("composition contour edge code overflow");
      buckets[{entity, share}].push_back(static_cast<uint32_t>(code));
    };

    for (uint32_t y = process_row_start; y < process_row_end; ++y) {
      for (uint32_t x = 0; x < width; ++x) {
        const uint32_t current = composition_at(x, y);
        if (current == 0)
          continue;
        const uint32_t current_begin = composition_offsets[current];
        const uint32_t current_end = composition_offsets[current + 1];
        const uint32_t neighbors[4] = {
            composition_at(x, static_cast<int64_t>(y) - 1),
            composition_at(static_cast<int64_t>(x) + 1, y),
            composition_at(x, static_cast<int64_t>(y) + 1),
            composition_at(static_cast<int64_t>(x) - 1, y)};
        for (uint32_t side = 0; side < 4; ++side) {
          const uint32_t neighbor = neighbors[side];
          if (neighbor == current)
            continue;
          const uint32_t neighbor_begin = composition_offsets[neighbor];
          const uint32_t neighbor_end = composition_offsets[neighbor + 1];
          uint32_t neighbor_index = neighbor_begin;
          for (uint32_t index = current_begin; index < current_end; ++index) {
            const uint32_t entity = entity_ids[index];
            while (neighbor_index < neighbor_end &&
                   entity_ids[neighbor_index] < entity)
              ++neighbor_index;
            const double neighbor_share =
                neighbor_index < neighbor_end &&
                        entity_ids[neighbor_index] == entity
                    ? shares[neighbor_index]
                    : 0.0;
            if (shares[index] != neighbor_share)
              add_edge(entity, shares[index], x, y, side);
          }
        }
      }
    }

    uint64_t code_count = 0;
    for (const auto &entry : buckets)
      code_count += entry.second.size();
    if (code_count > std::numeric_limits<uint32_t>::max())
      return ZK_ERROR_OUT_OF_RANGE;
    const uint32_t group_count = static_cast<uint32_t>(buckets.size());
    const uint32_t total_codes = static_cast<uint32_t>(code_count);
    *output_group_count = group_count;
    *output_code_count = total_codes;
    if (group_count > group_capacity ||
        static_cast<uint64_t>(group_count) + 1 > offset_capacity ||
        total_codes > code_capacity ||
        (group_count != 0 &&
         (output_entities == nullptr || output_shares == nullptr)) ||
        output_offsets == nullptr ||
        (total_codes != 0 && output_codes == nullptr))
      return ZK_ERROR_OUT_OF_RANGE;

    uint32_t group = 0;
    uint32_t offset = 0;
    output_offsets[0] = 0;
    for (const auto &entry : buckets) {
      output_entities[group] = entry.first.first;
      output_shares[group] = entry.first.second;
      std::copy(entry.second.begin(), entry.second.end(), output_codes + offset);
      offset += static_cast<uint32_t>(entry.second.size());
      output_offsets[++group] = offset;
    }
    return ZK_OK;
  } catch (const std::bad_alloc &) {
    return ZK_ERROR_OUT_OF_MEMORY;
  } catch (...) {
    return ZK_ERROR_INTERNAL;
  }
}
