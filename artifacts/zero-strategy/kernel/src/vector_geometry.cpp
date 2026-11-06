#include "zero_kernel.h"

#include <boost/geometry/algorithms/correct.hpp>
#include <boost/geometry/algorithms/difference.hpp>
#include <boost/geometry/algorithms/equals.hpp>
#include <boost/geometry/algorithms/intersection.hpp>
#include <boost/geometry/algorithms/is_valid.hpp>
#include <boost/geometry/algorithms/point_on_surface.hpp>
#include <boost/geometry/algorithms/sym_difference.hpp>
#include <boost/geometry/algorithms/union.hpp>
#include <boost/geometry/algorithms/within.hpp>
#include <boost/geometry/geometries/geometries.hpp>

#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <iomanip>
#include <initializer_list>
#include <limits>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>

namespace bg = boost::geometry;
namespace {

constexpr uint32_t kCommandStride = 8;
constexpr double kPi = 3.141592653589793238462643383279502884;
constexpr double kTwoPi = 2.0 * kPi;
constexpr uint32_t kMaximumCommands = 4'000'000;
constexpr uint32_t kMaximumFlattenedPoints = 16'000'000;

struct Point {
  double x;
  double y;
};

using BoostPoint = bg::model::d2::point_xy<double>;
using BoostRing = bg::model::ring<BoostPoint>;
using BoostPolygon = bg::model::polygon<BoostPoint>;
using BoostMultiPolygon = bg::model::multi_polygon<BoostPolygon>;

struct Subpath {
  std::vector<Point> points;
  bool closed = false;
};

struct ArcCenter {
  double cx;
  double cy;
  double rx;
  double ry;
  double rotation;
  double start_angle;
  double delta_angle;
};

double square(double value) { return value * value; }

double distance(Point first, Point second) {
  return std::hypot(first.x - second.x, first.y - second.y);
}

Point add(Point first, Point second) {
  return {first.x + second.x, first.y + second.y};
}

Point scale(Point point, double factor) {
  return {point.x * factor, point.y * factor};
}

Point midpoint(Point first, Point second) {
  return {(first.x + second.x) * 0.5, (first.y + second.y) * 0.5};
}

Point apply_affine(const double affine[6], Point point) {
  return {affine[0] * point.x + affine[2] * point.y + affine[4],
          affine[1] * point.x + affine[3] * point.y + affine[5]};
}

bool finite_point(Point point) {
  return std::isfinite(point.x) && std::isfinite(point.y);
}

bool valid_path(const uint32_t *types, const double *values, uint32_t count) {
  if (count > kMaximumCommands ||
      (count != 0 && (types == nullptr || values == nullptr)))
    return false;
  for (uint32_t index = 0; index < count; ++index) {
    const double *value = values + static_cast<size_t>(index) * kCommandStride;
    uint32_t used = 0;
    switch (types[index]) {
    case ZK_PATH_MOVE:
    case ZK_PATH_LINE:
      used = 2;
      break;
    case ZK_PATH_QUADRATIC:
      used = 4;
      break;
    case ZK_PATH_CUBIC:
      used = 6;
      break;
    case ZK_PATH_ARC:
      used = 7;
      if (value[0] < 0.0 || value[1] < 0.0 ||
          (value[3] != 0.0 && value[3] != 1.0) ||
          (value[4] != 0.0 && value[4] != 1.0))
        return false;
      break;
    case ZK_PATH_CLOSE:
      break;
    default:
      return false;
    }
    for (uint32_t offset = 0; offset < used; ++offset)
      if (!std::isfinite(value[offset]))
        return false;
  }
  return true;
}

class SvgParser {
public:
  SvgParser(const char *data, uint32_t length) : text_(data, length) {}
  bool invalid_flags() const { return invalid_flags_; }
  bool unsupported_command() const { return unsupported_command_; }

  bool parse(std::vector<uint32_t> &types,
             std::vector<double> &values) {
    char command = '\0';
    Point current{0.0, 0.0};
    Point subpath_start{0.0, 0.0};
    Point last_cubic_control{0.0, 0.0};
    Point last_quadratic_control{0.0, 0.0};
    char previous_command = '\0';
    bool has_current = false;
    while (true) {
      skip_separators();
      if (position_ >= text_.size())
        return true;
      if (is_command(text_[position_]))
        command = text_[position_++];
      else if (std::isalpha(static_cast<unsigned char>(text_[position_]))) {
        unsupported_command_ = true;
        return false;
      }
      else if (command == '\0')
        return false;

      const bool relative = command >= 'a' && command <= 'z';
      const char upper = relative ? static_cast<char>(command - 'a' + 'A') : command;
      if (upper == 'Z') {
        if (!has_current)
          return false;
        append(types, values, ZK_PATH_CLOSE, {});
        current = subpath_start;
        previous_command = 'Z';
        command = '\0';
        continue;
      }

      bool first_group = true;
      bool consumed = false;
      do {
        const size_t before = position_;
        if (upper == 'M' || upper == 'L') {
          Point end;
          if (!read_point(end, relative, current))
            break;
          if (upper == 'M' && first_group) {
            append(types, values, ZK_PATH_MOVE, {end.x, end.y});
            subpath_start = end;
            has_current = true;
          } else {
            if (!has_current)
              return false;
            append(types, values, ZK_PATH_LINE, {end.x, end.y});
          }
          current = end;
        } else if (upper == 'H' || upper == 'V') {
          double coordinate;
          if (!read_number(coordinate))
            break;
          if (!has_current)
            return false;
          const Point end = upper == 'H'
                                ? Point{relative ? current.x + coordinate : coordinate,
                                        current.y}
                                : Point{current.x,
                                        relative ? current.y + coordinate : coordinate};
          append(types, values, ZK_PATH_LINE, {end.x, end.y});
          current = end;
        } else if (upper == 'Q' || upper == 'T') {
          Point control;
          Point end;
          if (upper == 'Q') {
            if (!read_point(control, relative, current) ||
                !read_point(end, relative, current))
              break;
          } else {
            if (!read_point(end, relative, current))
              break;
            control = previous_command == 'Q' || previous_command == 'T'
                          ? Point{2.0 * current.x - last_quadratic_control.x,
                                  2.0 * current.y - last_quadratic_control.y}
                          : current;
          }
          if (!has_current)
            return false;
          append(types, values, ZK_PATH_QUADRATIC,
                 {control.x, control.y, end.x, end.y});
          current = end;
          last_quadratic_control = control;
        } else if (upper == 'C' || upper == 'S') {
          Point first_control;
          Point second_control;
          Point end;
          if (upper == 'C') {
            if (!read_point(first_control, relative, current) ||
                !read_point(second_control, relative, current) ||
                !read_point(end, relative, current))
              break;
          } else {
            if (!read_point(second_control, relative, current) ||
                !read_point(end, relative, current))
              break;
            first_control = previous_command == 'C' || previous_command == 'S'
                                ? Point{2.0 * current.x - last_cubic_control.x,
                                        2.0 * current.y - last_cubic_control.y}
                                : current;
          }
          if (!has_current)
            return false;
          append(types, values, ZK_PATH_CUBIC,
                 {first_control.x, first_control.y, second_control.x,
                  second_control.y, end.x, end.y});
          current = end;
          last_cubic_control = second_control;
        } else if (upper == 'A') {
          double rx;
          double ry;
          double rotation;
          double large_arc;
          double sweep;
          Point end;
          if (!read_number(rx) || !read_number(ry) || !read_number(rotation) ||
              !read_number(large_arc) || !read_number(sweep) ||
              !read_point(end, relative, current))
            break;
          if (!has_current || rx < 0.0 || ry < 0.0)
            return false;
          if ((large_arc != 0.0 && large_arc != 1.0) ||
              (sweep != 0.0 && sweep != 1.0)) {
            invalid_flags_ = true;
            return false;
          }
          append(types, values, ZK_PATH_ARC,
                 {rx, ry, rotation, large_arc, sweep, end.x, end.y});
          current = end;
        } else {
          unsupported_command_ = true;
          return false;
        }
        consumed = true;
        first_group = false;
        previous_command = upper;
        if (upper == 'M' && !first_group)
          command = relative ? 'l' : 'L';
        skip_separators();
        if (position_ >= text_.size() || is_command(text_[position_]))
          break;
        if (position_ == before)
          return false;
      } while (true);
      if (!consumed)
        return false;
    }
  }

private:
  bool invalid_flags_ = false;
  bool unsupported_command_ = false;
  std::string text_;
  size_t position_ = 0;

  static bool is_command(char value) {
    return (value >= 'A' && value <= 'Z') || (value >= 'a' && value <= 'z');
  }

  void skip_separators() {
    while (position_ < text_.size() &&
           (text_[position_] == ',' || text_[position_] == ' ' ||
            text_[position_] == '\n' || text_[position_] == '\r' ||
            text_[position_] == '\t'))
      ++position_;
  }

  bool read_number(double &value) {
    skip_separators();
    if (position_ >= text_.size())
      return false;
    char *end = nullptr;
    value = std::strtod(text_.c_str() + position_, &end);
    if (end == text_.c_str() + position_ || !std::isfinite(value))
      return false;
    position_ = static_cast<size_t>(end - text_.c_str());
    return true;
  }

  bool read_point(Point &point, bool relative, Point origin) {
    double x;
    double y;
    if (!read_number(x) || !read_number(y))
      return false;
    point = relative ? Point{origin.x + x, origin.y + y} : Point{x, y};
    return finite_point(point);
  }

  static void append(std::vector<uint32_t> &types, std::vector<double> &values,
                     uint32_t type, std::initializer_list<double> data) {
    types.push_back(type);
    const size_t offset = values.size();
    values.resize(offset + kCommandStride, 0.0);
    std::copy(data.begin(), data.end(), values.begin() + offset);
  }
};

bool arc_center(Point start, Point end, double rx, double ry, double rotation,
                bool large_arc, bool sweep, ArcCenter &result) {
  if (rx == 0.0 || ry == 0.0 || distance(start, end) == 0.0)
    return false;
  rx = std::abs(rx);
  ry = std::abs(ry);
  const double phi = rotation * kPi / 180.0;
  const double cosine = std::cos(phi);
  const double sine = std::sin(phi);
  const double dx = (start.x - end.x) * 0.5;
  const double dy = (start.y - end.y) * 0.5;
  const double x_prime = cosine * dx + sine * dy;
  const double y_prime = -sine * dx + cosine * dy;
  double scale_factor = square(x_prime) / square(rx) +
                        square(y_prime) / square(ry);
  if (scale_factor > 1.0) {
    const double scale = std::sqrt(scale_factor);
    rx *= scale;
    ry *= scale;
  }
  const double numerator = std::max(
      0.0, square(rx) * square(ry) - square(rx) * square(y_prime) -
               square(ry) * square(x_prime));
  const double denominator =
      square(rx) * square(y_prime) + square(ry) * square(x_prime);
  const double sign = large_arc == sweep ? -1.0 : 1.0;
  const double coefficient =
      denominator == 0.0 ? 0.0 : sign * std::sqrt(numerator / denominator);
  const double cx_prime = coefficient * (rx * y_prime / ry);
  const double cy_prime = coefficient * (-ry * x_prime / rx);
  const double cx = cosine * cx_prime - sine * cy_prime + (start.x + end.x) * 0.5;
  const double cy = sine * cx_prime + cosine * cy_prime + (start.y + end.y) * 0.5;
  const double ux = (x_prime - cx_prime) / rx;
  const double uy = (y_prime - cy_prime) / ry;
  const double vx = (-x_prime - cx_prime) / rx;
  const double vy = (-y_prime - cy_prime) / ry;
  double start_angle = std::atan2(uy, ux);
  double delta = std::atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  if (!sweep && delta > 0.0)
    delta -= kTwoPi;
  else if (sweep && delta < 0.0)
    delta += kTwoPi;
  result = {cx, cy, rx, ry, phi, start_angle, delta};
  return true;
}

Point arc_point(const ArcCenter &arc, double angle) {
  const double cosine = std::cos(arc.rotation);
  const double sine = std::sin(arc.rotation);
  const double x = arc.rx * std::cos(angle);
  const double y = arc.ry * std::sin(angle);
  return {arc.cx + cosine * x - sine * y,
          arc.cy + sine * x + cosine * y};
}

double point_line_distance(Point point, Point start, Point end) {
  const double dx = end.x - start.x;
  const double dy = end.y - start.y;
  const double length_squared = dx * dx + dy * dy;
  if (length_squared == 0.0)
    return distance(point, start);
  const double cross = std::abs((point.x - start.x) * dy -
                                (point.y - start.y) * dx);
  return cross / std::sqrt(length_squared);
}

void flatten_quadratic(Point start, Point control, Point end, double tolerance,
                       uint32_t depth, std::vector<Point> &output) {
  if (depth >= 16 || point_line_distance(control, start, end) <= tolerance) {
    output.push_back(end);
    return;
  }
  const Point first = midpoint(start, control);
  const Point second = midpoint(control, end);
  const Point center = midpoint(first, second);
  flatten_quadratic(start, first, center, tolerance, depth + 1, output);
  flatten_quadratic(center, second, end, tolerance, depth + 1, output);
}

void flatten_cubic(Point start, Point first_control, Point second_control,
                   Point end, double tolerance, uint32_t depth,
                   std::vector<Point> &output) {
  if (depth >= 16 ||
      std::max(point_line_distance(first_control, start, end),
               point_line_distance(second_control, start, end)) <= tolerance) {
    output.push_back(end);
    return;
  }
  const Point a = midpoint(start, first_control);
  const Point b = midpoint(first_control, second_control);
  const Point c = midpoint(second_control, end);
  const Point d = midpoint(a, b);
  const Point e = midpoint(b, c);
  const Point center = midpoint(d, e);
  flatten_cubic(start, a, d, center, tolerance, depth + 1, output);
  flatten_cubic(center, e, c, end, tolerance, depth + 1, output);
}

bool flatten_path(const uint32_t *types, const double *values, uint32_t count,
                 double tolerance, std::vector<Subpath> &subpaths) {
  if (!valid_path(types, values, count) || !std::isfinite(tolerance) ||
      tolerance <= 0.0)
    return false;
  Point current{0.0, 0.0};
  Point start{0.0, 0.0};
  bool has_current = false;
  Subpath active;
  auto finish = [&]() {
    if (!active.points.empty())
      subpaths.push_back(std::move(active));
    active = {};
  };
  for (uint32_t index = 0; index < count; ++index) {
    const uint32_t type = types[index];
    const double *value = values + static_cast<size_t>(index) * kCommandStride;
    if (type == ZK_PATH_MOVE) {
      finish();
      current = {value[0], value[1]};
      start = current;
      active.points.push_back(current);
      has_current = true;
    } else if (type == ZK_PATH_LINE) {
      if (!has_current)
        return false;
      current = {value[0], value[1]};
      active.points.push_back(current);
      active.closed = false;
    } else if (type == ZK_PATH_QUADRATIC) {
      if (!has_current)
        return false;
      const Point control{value[0], value[1]};
      const Point end{value[2], value[3]};
      flatten_quadratic(current, control, end, tolerance, 0, active.points);
      current = end;
      active.closed = false;
    } else if (type == ZK_PATH_CUBIC) {
      if (!has_current)
        return false;
      const Point first{value[0], value[1]};
      const Point second{value[2], value[3]};
      const Point end{value[4], value[5]};
      flatten_cubic(current, first, second, end, tolerance, 0, active.points);
      current = end;
      active.closed = false;
    } else if (type == ZK_PATH_ARC) {
      if (!has_current)
        return false;
      const Point end{value[5], value[6]};
      ArcCenter arc{};
      if (!arc_center(current, end, value[0], value[1], value[2], value[3] != 0.0,
                      value[4] != 0.0, arc)) {
        active.points.push_back(end);
      } else {
        const double radius = std::max(arc.rx, arc.ry);
        const double ratio =
            std::max(-1.0, std::min(1.0, 1.0 - tolerance / radius));
        const double max_angle = std::max(0.01, 2.0 * std::acos(ratio));
        const uint32_t segments = std::max<uint32_t>(
            1, std::min<uint32_t>(65536,
                                  static_cast<uint32_t>(std::ceil(
                                      std::abs(arc.delta_angle) / max_angle))));
        for (uint32_t part = 1; part <= segments; ++part) {
          const double amount =
              static_cast<double>(part) / static_cast<double>(segments);
          active.points.push_back(
              part == segments ? end
                               : arc_point(arc, arc.start_angle +
                                                    arc.delta_angle * amount));
        }
      }
      current = end;
      active.closed = false;
    } else if (type == ZK_PATH_CLOSE) {
      if (!has_current)
        return false;
      if (!active.points.empty() &&
          distance(active.points.back(), start) > 1e-12)
        active.points.push_back(start);
      current = start;
      active.closed = true;
    }
    if (active.points.size() > kMaximumFlattenedPoints)
      return false;
  }
  finish();
  return true;
}

std::string format_number(double value) {
  if (value == 0.0)
    value = 0.0;
  std::ostringstream stream;
  stream << std::setprecision(15) << value;
  return stream.str();
}

std::string serialize_path(const uint32_t *types, const double *values,
                           uint32_t count) {
  std::ostringstream stream;
  for (uint32_t index = 0; index < count; ++index) {
    const double *value = values + static_cast<size_t>(index) * kCommandStride;
    if (index != 0)
      stream << ' ';
    switch (types[index]) {
    case ZK_PATH_MOVE:
      stream << 'M' << format_number(value[0]) << ' ' << format_number(value[1]);
      break;
    case ZK_PATH_LINE:
      stream << 'L' << format_number(value[0]) << ' ' << format_number(value[1]);
      break;
    case ZK_PATH_QUADRATIC:
      stream << 'Q' << format_number(value[0]) << ' ' << format_number(value[1])
             << ' ' << format_number(value[2]) << ' ' << format_number(value[3]);
      break;
    case ZK_PATH_CUBIC:
      stream << 'C' << format_number(value[0]) << ' ' << format_number(value[1])
             << ' ' << format_number(value[2]) << ' ' << format_number(value[3])
             << ' ' << format_number(value[4]) << ' ' << format_number(value[5]);
      break;
    case ZK_PATH_ARC:
      stream << 'A' << format_number(value[0]) << ' ' << format_number(value[1])
             << ' ' << format_number(value[2]) << ' '
             << (value[3] == 0.0 ? 0 : 1) << ' '
             << (value[4] == 0.0 ? 0 : 1) << ' ' << format_number(value[5])
             << ' ' << format_number(value[6]);
      break;
    case ZK_PATH_CLOSE:
      stream << 'Z';
      break;
    default:
      return {};
    }
  }
  return stream.str();
}

double ring_area(const std::vector<Point> &points) {
  if (points.size() < 3)
    return 0.0;
  double area = 0.0;
  for (size_t index = 0; index < points.size(); ++index) {
    const Point first = points[index];
    const Point second = points[(index + 1) % points.size()];
    area += first.x * second.y - second.x * first.y;
  }
  return area * 0.5;
}

BoostPolygon make_polygon(const std::vector<Point> &points) {
  BoostPolygon polygon;
  auto &outer = polygon.outer();
  outer.reserve(points.size() + 1);
  for (Point point : points)
    outer.emplace_back(point.x, point.y);
  if (!points.empty() && distance(points.front(), points.back()) > 1e-12)
    outer.emplace_back(points.front().x, points.front().y);
  bg::correct(polygon);
  return polygon;
}

BoostMultiPolygon polygonize(const std::vector<Subpath> &subpaths,
                             zk_fill_rule fill_rule) {
  std::vector<std::vector<Point>> rings;
  std::vector<double> areas;
  for (const Subpath &subpath : subpaths) {
    if (subpath.points.size() < 3)
      continue;
    std::vector<Point> ring = subpath.points;
    if (distance(ring.front(), ring.back()) <= 1e-12)
      ring.pop_back();
    if (ring.size() < 3)
      continue;
    const double area = ring_area(ring);
    if (std::abs(area) <= 1e-12)
      continue;
    rings.push_back(std::move(ring));
    areas.push_back(area);
  }
  BoostMultiPolygon result;
  if (fill_rule == ZK_FILL_EVENODD) {
    for (const auto &ring : rings) {
      BoostMultiPolygon one;
      one.push_back(make_polygon(ring));
      if (result.empty()) {
        result = std::move(one);
      } else {
        BoostMultiPolygon combined;
        bg::sym_difference(result, one, combined);
        result = std::move(combined);
      }
    }
    return result;
  }

  std::vector<size_t> order(rings.size());
  for (size_t index = 0; index < order.size(); ++index)
    order[index] = index;
  std::stable_sort(order.begin(), order.end(), [&](size_t left, size_t right) {
    return std::abs(areas[left]) > std::abs(areas[right]);
  });
  std::vector<size_t> processed;
  for (size_t ring_index : order) {
    const BoostPolygon polygon = make_polygon(rings[ring_index]);
    BoostPoint sample;
    bg::point_on_surface(polygon, sample);
    int winding = 0;
    for (size_t parent : processed)
      if (bg::within(sample, make_polygon(rings[parent])))
        winding += areas[parent] > 0.0 ? 1 : -1;
    const int after = winding + (areas[ring_index] > 0.0 ? 1 : -1);
    BoostMultiPolygon one;
    one.push_back(polygon);
    if (winding == 0 && after != 0) {
      if (result.empty()) {
        result = std::move(one);
      } else {
        BoostMultiPolygon combined;
        bg::union_(result, one, combined);
        result = std::move(combined);
      }
    } else if (winding != 0 && after == 0) {
      BoostMultiPolygon difference;
      bg::difference(result, one, difference);
      result = std::move(difference);
    }
    processed.push_back(ring_index);
  }
  return result;
}

bool append_ring(const auto &ring, std::vector<Point> &points) {
  if (ring.size() < 4)
    return false;
  const size_t end = ring.size() - 1;
  for (size_t index = 0; index < end; ++index)
    points.push_back({bg::get<0>(ring[index]), bg::get<1>(ring[index])});
  return points.size() >= 3;
}

void flatten_multi_polygon(const BoostMultiPolygon &multi,
                           std::vector<Point> &points,
                           std::vector<uint32_t> &ring_offsets,
                           std::vector<uint32_t> &polygon_offsets) {
  ring_offsets.clear();
  polygon_offsets.clear();
  ring_offsets.push_back(0);
  polygon_offsets.push_back(0);
  for (const BoostPolygon &polygon : multi) {
    const size_t before = points.size();
    if (append_ring(polygon.outer(), points)) {
      ring_offsets.push_back(static_cast<uint32_t>(points.size()));
      for (const auto &inner : polygon.inners())
        if (append_ring(inner, points))
          ring_offsets.push_back(static_cast<uint32_t>(points.size()));
      if (ring_offsets.back() > ring_offsets[ring_offsets.size() - 2]) {
        polygon_offsets.push_back(
            static_cast<uint32_t>(ring_offsets.size() - 1));
      } else {
        points.resize(before);
      }
    }
  }
}

bool write_polygon_output(const BoostMultiPolygon &multi, double *output_xy,
                          uint32_t point_capacity,
                          uint32_t *output_ring_offsets,
                          uint32_t ring_capacity,
                          uint32_t *output_polygon_offsets,
                          uint32_t polygon_capacity, uint32_t *point_count,
                          uint32_t *ring_count, uint32_t *polygon_count) {
  std::vector<Point> points;
  std::vector<uint32_t> ring_offsets;
  std::vector<uint32_t> polygon_offsets;
  flatten_multi_polygon(multi, points, ring_offsets, polygon_offsets);
  const uint32_t points_needed = static_cast<uint32_t>(points.size());
  const uint32_t rings_needed =
      static_cast<uint32_t>(ring_offsets.size() - 1);
  const uint32_t polygons_needed =
      static_cast<uint32_t>(polygon_offsets.size() - 1);
  *point_count = points_needed;
  *ring_count = rings_needed;
  *polygon_count = polygons_needed;
  if (point_capacity < points_needed || ring_capacity < rings_needed + 1 ||
      polygon_capacity < polygons_needed + 1 ||
      (points_needed != 0 && output_xy == nullptr) ||
      output_ring_offsets == nullptr || output_polygon_offsets == nullptr)
    return false;
  for (uint32_t index = 0; index < points_needed; ++index) {
    output_xy[index * 2] = points[index].x;
    output_xy[index * 2 + 1] = points[index].y;
  }
  std::copy(ring_offsets.begin(), ring_offsets.end(), output_ring_offsets);
  std::copy(polygon_offsets.begin(), polygon_offsets.end(),
            output_polygon_offsets);
  return true;
}

bool parse_geometry_offsets(const double *xy, uint32_t point_count,
                            const uint32_t *ring_offsets,
                            uint32_t ring_count,
                            const uint32_t *polygon_offsets,
                            uint32_t polygon_count,
                            const uint32_t *geometry_offsets,
                            uint32_t geometry_count,
                            std::vector<BoostMultiPolygon> &geometries) {
  if ((point_count != 0 && xy == nullptr) || ring_offsets == nullptr ||
      polygon_offsets == nullptr || geometry_offsets == nullptr ||
      ring_offsets[0] != 0 || polygon_offsets[0] != 0 ||
      geometry_offsets[0] != 0 || ring_offsets[ring_count] != point_count ||
      polygon_offsets[polygon_count] != ring_count ||
      geometry_offsets[geometry_count] != polygon_count)
    return false;
  for (uint32_t ring = 0; ring < ring_count; ++ring)
    if (ring_offsets[ring] > ring_offsets[ring + 1] ||
        ring_offsets[ring + 1] > point_count ||
        ring_offsets[ring + 1] - ring_offsets[ring] < 3)
      return false;
  for (uint32_t polygon = 0; polygon < polygon_count; ++polygon)
    if (polygon_offsets[polygon] >= polygon_offsets[polygon + 1] ||
        polygon_offsets[polygon + 1] > ring_count)
      return false;
  for (uint32_t geometry = 0; geometry < geometry_count; ++geometry)
    if (geometry_offsets[geometry] > geometry_offsets[geometry + 1] ||
        geometry_offsets[geometry + 1] > polygon_count)
      return false;

  for (uint32_t geometry = 0; geometry < geometry_count; ++geometry) {
    BoostMultiPolygon multi;
    for (uint32_t polygon_index = geometry_offsets[geometry];
         polygon_index < geometry_offsets[geometry + 1]; ++polygon_index) {
      const uint32_t first_ring = polygon_offsets[polygon_index];
      const uint32_t last_ring = polygon_offsets[polygon_index + 1];
      BoostPolygon polygon;
      auto append_points = [&](auto &ring, uint32_t ring_index) {
        for (uint32_t point = ring_offsets[ring_index];
             point < ring_offsets[ring_index + 1]; ++point) {
          const double x = xy[point * 2];
          const double y = xy[point * 2 + 1];
          if (!std::isfinite(x) || !std::isfinite(y))
            return false;
          ring.emplace_back(x, y);
        }
        if (!ring.empty() &&
            !bg::equals(ring.front(), ring.back()))
          ring.push_back(ring.front());
        return true;
      };
      if (!append_points(polygon.outer(), first_ring))
        return false;
      for (uint32_t ring = first_ring + 1; ring < last_ring; ++ring) {
        polygon.inners().emplace_back();
        if (!append_points(polygon.inners().back(), ring))
          return false;
      }
      bg::correct(polygon);
      if (!bg::is_valid(polygon))
        return false;
      multi.push_back(std::move(polygon));
    }
    geometries.push_back(std::move(multi));
  }
  return true;
}

Point subtract_points(Point first, Point second) {
  return {first.x - second.x, first.y - second.y};
}

double cross_points(Point first, Point second) {
  return first.x * second.y - first.y * second.x;
}

Point normalize_point(Point point) {
  const double length = std::hypot(point.x, point.y);
  return length == 0.0 ? Point{0.0, 0.0}
                       : Point{point.x / length, point.y / length};
}

void append_stroke_ring(BoostMultiPolygon &output,
                        const std::vector<Point> &points) {
  if (points.size() < 3)
    return;
  BoostPolygon polygon;
  for (Point point : points)
    polygon.outer().emplace_back(point.x, point.y);
  polygon.outer().emplace_back(points.front().x, points.front().y);
  bg::correct(polygon);
  if (std::abs(bg::area(polygon)) > 1e-12)
    output.push_back(std::move(polygon));
}

void append_stroke_disk(BoostMultiPolygon &output, Point center, double radius,
                        uint32_t count) {
  std::vector<Point> ring;
  ring.reserve(count);
  for (uint32_t index = 0; index < count; ++index) {
    const double angle = static_cast<double>(index) * kTwoPi / count;
    ring.push_back(
        {center.x + radius * std::cos(angle),
         center.y + radius * std::sin(angle)});
  }
  append_stroke_ring(output, ring);
}

bool build_stroke_polyline(const double *input_xy, uint32_t point_count,
                           double width, double tolerance, zk_stroke_cap cap,
                           zk_stroke_join join, double miter_limit,
                           bool closed, BoostMultiPolygon &output) {
  if ((point_count != 0 && input_xy == nullptr) ||
      point_count > kMaximumFlattenedPoints || !std::isfinite(width) ||
      width < 0.0 || !std::isfinite(tolerance) || tolerance <= 0.0 ||
      !std::isfinite(miter_limit) || miter_limit < 1.0 ||
      (cap != ZK_STROKE_CAP_BUTT && cap != ZK_STROKE_CAP_SQUARE &&
       cap != ZK_STROKE_CAP_ROUND) ||
      (join != ZK_STROKE_JOIN_MITER && join != ZK_STROKE_JOIN_BEVEL &&
       join != ZK_STROKE_JOIN_ROUND))
    return false;

  output.clear();
  const double half = width * 0.5;
  if (half == 0.0 || point_count < 2)
    return true;
  std::vector<Point> source;
  source.reserve(point_count);
  for (uint32_t index = 0; index < point_count; ++index) {
    Point point{input_xy[index * 2], input_xy[index * 2 + 1]};
    if (!finite_point(point))
      return false;
    if (source.empty() || distance(source.back(), point) > 1e-12)
      source.push_back(point);
  }
  if (closed && source.size() > 1 &&
      distance(source.front(), source.back()) <= 1e-12)
    source.pop_back();
  if (source.size() < 2)
    return true;

  uint32_t circle_points = 8;
  const double ratio = std::min(1.0, tolerance / half);
  const double angle = std::acos(std::max(-1.0, 1.0 - ratio));
  if (angle > 0.0) {
    const double requested = std::ceil(kPi / angle);
    if (!std::isfinite(requested) || requested > kMaximumFlattenedPoints)
      return false;
    circle_points = std::max<uint32_t>(8, static_cast<uint32_t>(requested));
  }

  const uint32_t line_count =
      static_cast<uint32_t>(source.size()) - 1 + (closed ? 1 : 0);
  for (uint32_t index = 0; index < line_count; ++index) {
    Point first = source[index];
    Point second = source[(index + 1) % source.size()];
    const Point tangent = normalize_point(subtract_points(second, first));
    if (tangent.x == 0.0 && tangent.y == 0.0)
      continue;
    if (!closed && cap == ZK_STROKE_CAP_SQUARE) {
      if (index == 0) {
        first.x -= tangent.x * half;
        first.y -= tangent.y * half;
      }
      if (index + 1 == line_count) {
        second.x += tangent.x * half;
        second.y += tangent.y * half;
      }
    }
    const Point normal{-tangent.y * half, tangent.x * half};
    append_stroke_ring(output, {
        {first.x + normal.x, first.y + normal.y},
        {second.x + normal.x, second.y + normal.y},
        {second.x - normal.x, second.y - normal.y},
        {first.x - normal.x, first.y - normal.y},
    });
    if (!closed && cap == ZK_STROKE_CAP_ROUND) {
      if (index == 0)
        append_stroke_disk(output, source.front(), half, circle_points);
      if (index + 1 == line_count)
        append_stroke_disk(output, source.back(), half, circle_points);
    }
  }

  const uint32_t first_join = closed ? 0 : 1;
  const uint32_t last_join =
      closed ? static_cast<uint32_t>(source.size())
             : static_cast<uint32_t>(source.size() - 1);
  for (uint32_t index = first_join; index < last_join; ++index) {
    const Point point = source[index];
    const Point before = source[(index + source.size() - 1) % source.size()];
    const Point after = source[(index + 1) % source.size()];
    const Point first = normalize_point(subtract_points(point, before));
    const Point second = normalize_point(subtract_points(after, point));
    if ((first.x == 0.0 && first.y == 0.0) ||
        (second.x == 0.0 && second.y == 0.0))
      continue;
    if (join == ZK_STROKE_JOIN_ROUND) {
      append_stroke_disk(output, point, half, circle_points);
      continue;
    }
    for (double side : {-1.0, 1.0}) {
      const Point normal1{-first.y * half * side, first.x * half * side};
      const Point normal2{-second.y * half * side, second.x * half * side};
      const Point point1{point.x + normal1.x, point.y + normal1.y};
      const Point point2{point.x + normal2.x, point.y + normal2.y};
      const double denominator = cross_points(first, second);
      if (std::abs(denominator) < 1e-12)
        continue;
      const Point delta = subtract_points(point2, point1);
      const double t = cross_points(delta, second) / denominator;
      const Point miter{point1.x + first.x * t, point1.y + first.y * t};
      const bool use_miter =
          join == ZK_STROKE_JOIN_MITER &&
          distance(point, miter) <= half * miter_limit;
      append_stroke_ring(output,
                         {point1, use_miter ? miter : point, point2});
    }
  }
  return true;
}

} // пространство имён

extern "C" zk_error zk_geometry_path_parse(
    const char *svg, uint32_t svg_length, uint32_t *command_types,
    uint32_t type_capacity, double *command_values,
    uint32_t value_capacity, uint32_t *command_count) {
  if (command_count == nullptr || (svg_length != 0 && svg == nullptr) ||
      svg_length > 16 * 1024 * 1024)
    return ZK_ERROR_INVALID_ARGUMENT;
  try {
    std::vector<uint32_t> types;
    std::vector<double> values;
    SvgParser parser(svg, svg_length);
    if (!parser.parse(types, values)) {
      if (parser.invalid_flags()) return ZK_ERROR_INVALID_PATH_FLAGS;
      if (parser.unsupported_command()) return ZK_ERROR_UNSUPPORTED_PATH_COMMAND;
      return ZK_ERROR_INVALID_ARGUMENT;
    }
    *command_count = static_cast<uint32_t>(types.size());
    if (type_capacity < types.size() || value_capacity < values.size() ||
        (!types.empty() && (command_types == nullptr || command_values == nullptr)))
      return ZK_ERROR_OUT_OF_RANGE;
    if (!types.empty()) {
      std::copy(types.begin(), types.end(), command_types);
      std::copy(values.begin(), values.end(), command_values);
    }
    return ZK_OK;
  } catch (const std::bad_alloc &) {
    return ZK_ERROR_OUT_OF_MEMORY;
  } catch (...) {
    return ZK_ERROR_INTERNAL;
  }
}

extern "C" zk_error zk_geometry_path_serialize(
    const uint32_t *command_types, const double *command_values,
    uint32_t command_count, char *output, uint32_t output_capacity,
    uint32_t *output_length) {
  if (output_length == nullptr ||
      !valid_path(command_types, command_values, command_count))
    return ZK_ERROR_INVALID_ARGUMENT;
  try {
    const std::string serialized =
        serialize_path(command_types, command_values, command_count);
    *output_length = static_cast<uint32_t>(serialized.size());
    if (output_capacity < serialized.size() ||
        (!serialized.empty() && output == nullptr))
      return ZK_ERROR_OUT_OF_RANGE;
    if (!serialized.empty())
      std::memcpy(output, serialized.data(), serialized.size());
    return ZK_OK;
  } catch (const std::bad_alloc &) {
    return ZK_ERROR_OUT_OF_MEMORY;
  } catch (...) {
    return ZK_ERROR_INTERNAL;
  }
}

extern "C" zk_error zk_geometry_path_transform(
    const uint32_t *command_types, const double *command_values,
    uint32_t command_count, const double affine[6], double tolerance,
    uint32_t *output_types, uint32_t type_capacity, double *output_values,
    uint32_t value_capacity, uint32_t *output_count) {
  if (output_count == nullptr || affine == nullptr ||
      !valid_path(command_types, command_values, command_count) ||
      !std::isfinite(tolerance) || tolerance <= 0.0)
    return ZK_ERROR_INVALID_ARGUMENT;
  for (uint32_t index = 0; index < 6; ++index)
    if (!std::isfinite(affine[index]))
      return ZK_ERROR_INVALID_ARGUMENT;
  try {
    std::vector<uint32_t> types;
    std::vector<double> values;
    if (command_count != 0) {
      types.assign(command_types, command_types + command_count);
      values.assign(command_values,
                    command_values + command_count * kCommandStride);
    }
    const double aa = affine[0] * affine[0] + affine[1] * affine[1];
    const double bb = affine[2] * affine[2] + affine[3] * affine[3];
    const double ab = affine[0] * affine[2] + affine[1] * affine[3];
    const double maximum_scale = std::sqrt(std::max(
        0.0, (aa + bb + std::hypot(aa - bb, 2.0 * ab)) * 0.5));
    const double source_tolerance =
        maximum_scale > 0.0 ? tolerance / maximum_scale : tolerance;
    std::vector<uint32_t> expanded_types;
    std::vector<double> expanded_values;
    Point source_current{0.0, 0.0};
    Point source_start{0.0, 0.0};
    bool source_has_current = false;
    for (uint32_t index = 0; index < command_count; ++index) {
      const uint32_t type = types[index];
      const double *value =
          values.data() + static_cast<size_t>(index) * kCommandStride;
      if (type == ZK_PATH_ARC) {
        if (!source_has_current)
          return ZK_ERROR_INVALID_ARGUMENT;
        const uint32_t arc_types[2] = {ZK_PATH_MOVE, ZK_PATH_ARC};
        double arc_values[kCommandStride * 2]{};
        arc_values[0] = source_current.x;
        arc_values[1] = source_current.y;
        std::copy(value, value + kCommandStride, arc_values + kCommandStride);
        std::vector<Subpath> arc_subpaths;
        if (!flatten_path(arc_types, arc_values, 2, source_tolerance,
                          arc_subpaths))
          return ZK_ERROR_INVALID_ARGUMENT;
        for (const Subpath &subpath : arc_subpaths) {
          for (size_t point = 1; point < subpath.points.size(); ++point) {
            const Point next = subpath.points[point];
            expanded_types.push_back(ZK_PATH_LINE);
            expanded_values.insert(expanded_values.end(),
                                   {next.x, next.y, 0.0, 0.0,
                                    0.0, 0.0, 0.0, 0.0});
          }
        }
        source_current = {value[5], value[6]};
        source_has_current = true;
        continue;
      }

      expanded_types.push_back(type);
      expanded_values.insert(expanded_values.end(), value,
                             value + kCommandStride);
      if (type == ZK_PATH_MOVE) {
        source_current = {value[0], value[1]};
        source_start = source_current;
        source_has_current = true;
      } else if (type == ZK_PATH_LINE) {
        source_current = {value[0], value[1]};
      } else if (type == ZK_PATH_QUADRATIC) {
        source_current = {value[2], value[3]};
      } else if (type == ZK_PATH_CUBIC) {
        source_current = {value[4], value[5]};
      } else if (type == ZK_PATH_CLOSE) {
        source_current = source_start;
      }
    }
    types = std::move(expanded_types);
    values = std::move(expanded_values);
    const uint32_t transformed_count = static_cast<uint32_t>(types.size());
    const double determinant = affine[0] * affine[3] - affine[1] * affine[2];
    const double scale_x = std::hypot(affine[0], affine[1]);
    const double scale_y = std::hypot(affine[2], affine[3]);
    const double scale_product = scale_x * scale_y;
    const double scale_reference = std::max({1.0, scale_x, scale_y});
    const bool uniform_scale =
        std::abs(scale_x - scale_y) <= scale_reference * 1e-12 &&
        std::abs(affine[0] * affine[2] + affine[1] * affine[3]) <=
            std::max(1.0, scale_product) * 1e-12;
    Point current{0.0, 0.0};
    Point start{0.0, 0.0};
    bool has_current = false;
    for (uint32_t index = 0; index < transformed_count; ++index) {
      double *value = values.data() + static_cast<size_t>(index) * kCommandStride;
      switch (types[index]) {
      case ZK_PATH_MOVE:
      case ZK_PATH_LINE:
        current = {value[0], value[1]};
        current = apply_affine(affine, current);
        value[0] = current.x;
        value[1] = current.y;
        if (types[index] == ZK_PATH_MOVE)
          start = current;
        has_current = true;
        break;
      case ZK_PATH_QUADRATIC: {
        for (uint32_t offset = 0; offset < 4; offset += 2) {
          const Point point = apply_affine(affine, {value[offset], value[offset + 1]});
          value[offset] = point.x;
          value[offset + 1] = point.y;
        }
        current = {value[2], value[3]};
        has_current = true;
        break;
      }
      case ZK_PATH_CUBIC: {
        for (uint32_t offset = 0; offset < 6; offset += 2) {
          const Point point = apply_affine(affine, {value[offset], value[offset + 1]});
          value[offset] = point.x;
          value[offset + 1] = point.y;
        }
        current = {value[4], value[5]};
        has_current = true;
        break;
      }
      case ZK_PATH_ARC: {
        if (!has_current)
          return ZK_ERROR_INVALID_ARGUMENT;
        const Point old_start = current;
        const Point old_end{value[5], value[6]};
        ArcCenter arc{};
        if (!arc_center(old_start, old_end, value[0], value[1], value[2],
                        value[3] != 0.0, value[4] != 0.0, arc)) {
          const Point end = apply_affine(affine, old_end);
          value[0] = 0.0;
          value[1] = 0.0;
          value[2] = 0.0;
          value[5] = end.x;
          value[6] = end.y;
        } else if (std::abs(determinant) <= 1e-14 || !uniform_scale) {
          std::vector<Subpath> flattened;
          const double source_tolerance =
              std::max(scale_x, scale_y) > 0.0
                  ? tolerance / std::max(scale_x, scale_y)
                  : tolerance;
          if (!flatten_path(command_types, command_values, command_count,
                            source_tolerance, flattened))
            return ZK_ERROR_INVALID_ARGUMENT;
          std::vector<uint32_t> rebuilt_types;
          std::vector<double> rebuilt_values;
          for (const Subpath &subpath : flattened) {
            if (subpath.points.empty())
              continue;
            rebuilt_types.push_back(ZK_PATH_MOVE);
            rebuilt_values.insert(rebuilt_values.end(),
                                  {apply_affine(affine, subpath.points.front()).x,
                                   apply_affine(affine, subpath.points.front()).y});
            for (size_t point = 1; point < subpath.points.size(); ++point) {
              const Point transformed =
                  apply_affine(affine, subpath.points[point]);
              rebuilt_types.push_back(ZK_PATH_LINE);
              rebuilt_values.insert(rebuilt_values.end(),
                                    {transformed.x, transformed.y});
            }
            if (subpath.closed)
              rebuilt_types.push_back(ZK_PATH_CLOSE);
          }
          std::vector<double> padded(rebuilt_types.size() * kCommandStride, 0.0);
          size_t coordinate = 0;
          for (size_t command = 0; command < rebuilt_types.size(); ++command) {
            const uint32_t used = rebuilt_types[command] == ZK_PATH_CLOSE ? 0 : 2;
            for (uint32_t offset = 0; offset < used; ++offset)
              padded[command * kCommandStride + offset] =
                  rebuilt_values[coordinate++];
          }
          types = std::move(rebuilt_types);
          values = std::move(padded);
          index = command_count;
          break;
        } else {
          const double phi = arc.rotation;
          const double cosine = std::cos(phi);
          const double sine = std::sin(phi);
          const double s00 = affine[0] * cosine * arc.rx +
                             affine[2] * sine * arc.rx;
          const double s01 = affine[0] * -sine * arc.ry +
                             affine[2] * cosine * arc.ry;
          const double s10 = affine[1] * cosine * arc.rx +
                             affine[3] * sine * arc.rx;
          const double s11 = affine[1] * -sine * arc.ry +
                             affine[3] * cosine * arc.ry;
          const double xx = s00 * s00 + s01 * s01;
          const double xy = s00 * s10 + s01 * s11;
          const double yy = s10 * s10 + s11 * s11;
          const double eigen_distance =
              std::hypot(xx - yy, 2.0 * xy);
          const double major = std::sqrt(std::max(0.0, (xx + yy + eigen_distance) * 0.5));
          const double minor = std::sqrt(std::max(0.0, (xx + yy - eigen_distance) * 0.5));
          const double rotation =
              0.5 * std::atan2(2.0 * xy, xx - yy) * 180.0 / kPi;
          const Point end = apply_affine(affine, old_end);
          value[0] = major;
          value[1] = minor;
          value[2] = rotation;
          value[4] = determinant < 0.0 ? 1.0 - value[4] : value[4];
          value[5] = end.x;
          value[6] = end.y;
          current = end;
          has_current = true;
        }
        break;
      }
      case ZK_PATH_CLOSE:
        current = start;
        has_current = true;
        break;
      }
    }
    for (double value : values)
      if (!std::isfinite(value))
        return ZK_ERROR_OVERFLOW;
    *output_count = static_cast<uint32_t>(types.size());
    if (type_capacity < types.size() || value_capacity < values.size() ||
        (!types.empty() && (output_types == nullptr || output_values == nullptr)))
      return ZK_ERROR_OUT_OF_RANGE;
    if (!types.empty()) {
      std::copy(types.begin(), types.end(), output_types);
      std::copy(values.begin(), values.end(), output_values);
    }
    return ZK_OK;
  } catch (const std::bad_alloc &) {
    return ZK_ERROR_OUT_OF_MEMORY;
  } catch (...) {
    return ZK_ERROR_INTERNAL;
  }
}

extern "C" zk_error zk_geometry_path_measure(
    zk_path_measure_operation operation, const uint32_t *command_types,
    const double *command_values, uint32_t command_count, double tolerance,
    double *output, uint32_t output_capacity, uint32_t *output_count) {
  if (output_count == nullptr ||
      (operation != ZK_PATH_LENGTH && operation != ZK_PATH_BOUNDS))
    return ZK_ERROR_INVALID_ARGUMENT;
  try {
    std::vector<Subpath> subpaths;
    if (!flatten_path(command_types, command_values, command_count, tolerance,
                      subpaths))
      return ZK_ERROR_INVALID_ARGUMENT;
    double result[4]{};
    uint32_t count = 0;
    if (operation == ZK_PATH_LENGTH) {
      double length = 0.0;
      for (const Subpath &subpath : subpaths)
        for (size_t index = 1; index < subpath.points.size(); ++index)
          length += distance(subpath.points[index - 1], subpath.points[index]);
      result[0] = length;
      count = 1;
    } else {
      bool first = true;
      for (const Subpath &subpath : subpaths) {
        for (Point point : subpath.points) {
          if (first) {
            result[0] = result[2] = point.x;
            result[1] = result[3] = point.y;
            first = false;
          } else {
            result[0] = std::min(result[0], point.x);
            result[1] = std::min(result[1], point.y);
            result[2] = std::max(result[2], point.x);
            result[3] = std::max(result[3], point.y);
          }
        }
      }
      count = first ? 0 : 4;
    }
    *output_count = count;
    if (output_capacity < count || (count != 0 && output == nullptr))
      return ZK_ERROR_OUT_OF_RANGE;
    if (count != 0)
      std::copy(result, result + count, output);
    return ZK_OK;
  } catch (const std::bad_alloc &) {
    return ZK_ERROR_OUT_OF_MEMORY;
  } catch (...) {
    return ZK_ERROR_INTERNAL;
  }
}

extern "C" zk_error zk_geometry_path_flatten(
    const uint32_t *command_types, const double *command_values,
    uint32_t command_count, double tolerance, double *output_xy,
    uint32_t point_capacity, uint32_t *output_subpath_offsets,
    uint32_t subpath_capacity, uint8_t *output_closed,
    uint32_t closed_capacity, uint32_t *point_count,
    uint32_t *subpath_count) {
  if (point_count == nullptr || subpath_count == nullptr)
    return ZK_ERROR_INVALID_ARGUMENT;
  try {
    std::vector<Subpath> subpaths;
    if (!flatten_path(command_types, command_values, command_count, tolerance,
                      subpaths))
      return ZK_ERROR_INVALID_ARGUMENT;
    uint32_t points_needed = 0;
    for (const Subpath &subpath : subpaths)
      points_needed += static_cast<uint32_t>(subpath.points.size());
    const uint32_t subpaths_needed = static_cast<uint32_t>(subpaths.size());
    *point_count = points_needed;
    *subpath_count = subpaths_needed;
    if (point_capacity < points_needed ||
        subpath_capacity < subpaths_needed + 1 ||
        closed_capacity < subpaths_needed ||
        (points_needed != 0 && output_xy == nullptr) ||
        output_subpath_offsets == nullptr ||
        (subpaths_needed != 0 && output_closed == nullptr))
      return ZK_ERROR_OUT_OF_RANGE;

    uint32_t offset = 0;
    output_subpath_offsets[0] = 0;
    for (uint32_t index = 0; index < subpaths_needed; ++index) {
      const Subpath &subpath = subpaths[index];
      if (!subpath.points.empty()) {
        for (Point point : subpath.points) {
          output_xy[offset * 2] = point.x;
          output_xy[offset * 2 + 1] = point.y;
          ++offset;
        }
      }
      output_closed[index] = subpath.closed ? 1 : 0;
      output_subpath_offsets[index + 1] = offset;
    }
    return ZK_OK;
  } catch (const std::bad_alloc &) {
    return ZK_ERROR_OUT_OF_MEMORY;
  } catch (...) {
    return ZK_ERROR_INTERNAL;
  }
}

extern "C" zk_error zk_geometry_path_intersections(
    const uint32_t *first_types, const double *first_values,
    uint32_t first_count, const uint32_t *second_types,
    const double *second_values, uint32_t second_count, double tolerance,
    double *output_xy, uint32_t point_capacity, uint32_t *point_count) {
  if (point_count == nullptr || !std::isfinite(tolerance) || tolerance <= 0.0)
    return ZK_ERROR_INVALID_ARGUMENT;
  try {
    std::vector<Subpath> first;
    std::vector<Subpath> second;
    if (!flatten_path(first_types, first_values, first_count, tolerance, first) ||
        !flatten_path(second_types, second_values, second_count, tolerance, second))
      return ZK_ERROR_INVALID_ARGUMENT;
    std::vector<Point> intersections;
    const double epsilon = std::max(1e-10, tolerance * 1e-8);
    auto append_unique = [&](Point point) {
      if (std::none_of(intersections.begin(), intersections.end(),
                       [&](Point existing) { return distance(existing, point) <= epsilon; }))
        intersections.push_back(point);
    };
    for (const Subpath &left : first) {
      for (const Subpath &right : second) {
        for (size_t a = 1; a < left.points.size(); ++a) {
          const Point p = left.points[a - 1];
          const Point p2 = left.points[a];
          for (size_t b = 1; b < right.points.size(); ++b) {
            const Point q = right.points[b - 1];
            const Point q2 = right.points[b];
            const double rx = p2.x - p.x;
            const double ry = p2.y - p.y;
            const double sx = q2.x - q.x;
            const double sy = q2.y - q.y;
            const double denominator = rx * sy - ry * sx;
            const double qpx = q.x - p.x;
            const double qpy = q.y - p.y;
            if (std::abs(denominator) <= epsilon) {
              if (std::abs(qpx * ry - qpy * rx) <= epsilon) {
                for (Point candidate : {p, p2, q, q2})
                  if (point_line_distance(candidate, p, p2) <= epsilon &&
                      candidate.x >= std::min(p.x, p2.x) - epsilon &&
                      candidate.x <= std::max(p.x, p2.x) + epsilon &&
                      candidate.y >= std::min(p.y, p2.y) - epsilon &&
                      candidate.y <= std::max(p.y, p2.y) + epsilon &&
                      candidate.x >= std::min(q.x, q2.x) - epsilon &&
                      candidate.x <= std::max(q.x, q2.x) + epsilon &&
                      candidate.y >= std::min(q.y, q2.y) - epsilon &&
                      candidate.y <= std::max(q.y, q2.y) + epsilon)
                    append_unique(candidate);
              }
              continue;
            }
            const double t = (qpx * sy - qpy * sx) / denominator;
            const double u = (qpx * ry - qpy * rx) / denominator;
            if (t >= -epsilon && t <= 1.0 + epsilon &&
                u >= -epsilon && u <= 1.0 + epsilon)
              append_unique({p.x + std::max(0.0, std::min(1.0, t)) * rx,
                             p.y + std::max(0.0, std::min(1.0, t)) * ry});
          }
        }
      }
    }
    *point_count = static_cast<uint32_t>(intersections.size());
    if (point_capacity < intersections.size() ||
        (!intersections.empty() && output_xy == nullptr))
      return ZK_ERROR_OUT_OF_RANGE;
    for (uint32_t index = 0; index < intersections.size(); ++index) {
      output_xy[index * 2] = intersections[index].x;
      output_xy[index * 2 + 1] = intersections[index].y;
    }
    return ZK_OK;
  } catch (const std::bad_alloc &) {
    return ZK_ERROR_OUT_OF_MEMORY;
  } catch (...) {
    return ZK_ERROR_INTERNAL;
  }
}

extern "C" zk_error zk_geometry_path_to_polygons(
    const uint32_t *command_types, const double *command_values,
    uint32_t command_count, double tolerance, zk_fill_rule fill_rule,
    double *output_xy, uint32_t point_capacity,
    uint32_t *output_ring_offsets, uint32_t ring_capacity,
    uint32_t *output_polygon_offsets, uint32_t polygon_capacity,
    uint32_t *point_count, uint32_t *ring_count, uint32_t *polygon_count) {
  if (point_count == nullptr || ring_count == nullptr || polygon_count == nullptr ||
      (fill_rule != ZK_FILL_EVENODD && fill_rule != ZK_FILL_NONZERO))
    return ZK_ERROR_INVALID_ARGUMENT;
  try {
    std::vector<Subpath> subpaths;
    if (!flatten_path(command_types, command_values, command_count, tolerance,
                      subpaths))
      return ZK_ERROR_INVALID_ARGUMENT;
    const BoostMultiPolygon polygons = polygonize(subpaths, fill_rule);
    if (write_polygon_output(polygons, output_xy, point_capacity,
                             output_ring_offsets, ring_capacity,
                             output_polygon_offsets, polygon_capacity,
                             point_count, ring_count, polygon_count))
      return ZK_OK;
    return ZK_ERROR_OUT_OF_RANGE;
  } catch (const std::bad_alloc &) {
    return ZK_ERROR_OUT_OF_MEMORY;
  } catch (...) {
    return ZK_ERROR_INVALID_ARGUMENT;
  }
}

extern "C" zk_error zk_geometry_polygon_boolean(
    zk_polygon_boolean_operation operation, const double *input_xy,
    uint32_t input_point_count, const uint32_t *input_ring_offsets,
    uint32_t input_ring_count, const uint32_t *input_polygon_offsets,
    uint32_t input_polygon_count, const uint32_t *input_geometry_offsets,
    uint32_t input_geometry_count, double *output_xy, uint32_t point_capacity,
    uint32_t *output_ring_offsets, uint32_t ring_capacity,
    uint32_t *output_polygon_offsets, uint32_t polygon_capacity,
    uint32_t *point_count, uint32_t *ring_count, uint32_t *polygon_count) {
  if (point_count == nullptr || ring_count == nullptr || polygon_count == nullptr ||
      operation < ZK_POLYGON_UNION || operation > ZK_POLYGON_XOR ||
      input_geometry_count > 10000 || input_polygon_count > 1'000'000 ||
      input_ring_count > 4'000'000 || input_point_count > kMaximumFlattenedPoints)
    return ZK_ERROR_INVALID_ARGUMENT;
  try {
    std::vector<BoostMultiPolygon> geometries;
    geometries.reserve(input_geometry_count);
    if (!parse_geometry_offsets(input_xy, input_point_count, input_ring_offsets,
                                input_ring_count, input_polygon_offsets,
                                input_polygon_count, input_geometry_offsets,
                                input_geometry_count, geometries))
      return ZK_ERROR_INVALID_ARGUMENT;

    BoostMultiPolygon result;
    bool initialized = false;
    for (const BoostMultiPolygon &geometry : geometries) {
      if (!initialized) {
        result = geometry;
        initialized = true;
        continue;
      }
      if (result.empty() &&
          (operation == ZK_POLYGON_INTERSECTION ||
           operation == ZK_POLYGON_DIFFERENCE))
        continue;
      if (geometry.empty() &&
          (operation == ZK_POLYGON_INTERSECTION ||
           operation == ZK_POLYGON_DIFFERENCE)) {
        result.clear();
        continue;
      }
      BoostMultiPolygon next;
      switch (operation) {
      case ZK_POLYGON_UNION:
        bg::union_(result, geometry, next);
        break;
      case ZK_POLYGON_INTERSECTION:
        bg::intersection(result, geometry, next);
        break;
      case ZK_POLYGON_DIFFERENCE:
        bg::difference(result, geometry, next);
        break;
      case ZK_POLYGON_XOR:
        bg::sym_difference(result, geometry, next);
        break;
      }
      result = std::move(next);
    }
    if (operation == ZK_POLYGON_DIFFERENCE && geometries.empty())
      result.clear();
    if (write_polygon_output(result, output_xy, point_capacity,
                             output_ring_offsets, ring_capacity,
                             output_polygon_offsets, polygon_capacity,
                             point_count, ring_count, polygon_count))
      return ZK_OK;
    return ZK_ERROR_OUT_OF_RANGE;
  } catch (const std::bad_alloc &) {
    return ZK_ERROR_OUT_OF_MEMORY;
  } catch (...) {
    return ZK_ERROR_INVALID_ARGUMENT;
  }
}

extern "C" zk_error zk_geometry_stroke_polyline(
    const double *input_xy, uint32_t input_point_count, double width,
    double tolerance, zk_stroke_cap cap, zk_stroke_join join,
    double miter_limit, uint8_t closed, double *output_xy,
    uint32_t point_capacity, uint32_t *output_ring_offsets,
    uint32_t ring_capacity, uint32_t *output_polygon_offsets,
    uint32_t polygon_capacity, uint32_t *output_point_count,
    uint32_t *output_ring_count, uint32_t *output_polygon_count) {
  if (output_point_count == nullptr || output_ring_count == nullptr ||
      output_polygon_count == nullptr || closed > 1)
    return ZK_ERROR_INVALID_ARGUMENT;
  try {
    BoostMultiPolygon polygons;
    if (!build_stroke_polyline(input_xy, input_point_count, width, tolerance,
                               cap, join, miter_limit, closed != 0, polygons))
      return ZK_ERROR_INVALID_ARGUMENT;
    if (write_polygon_output(polygons, output_xy, point_capacity,
                             output_ring_offsets, ring_capacity,
                             output_polygon_offsets, polygon_capacity,
                             output_point_count, output_ring_count,
                             output_polygon_count))
      return ZK_OK;
    return ZK_ERROR_OUT_OF_RANGE;
  } catch (const std::bad_alloc &) {
    return ZK_ERROR_OUT_OF_MEMORY;
  } catch (...) {
    return ZK_ERROR_INTERNAL;
  }
}
