#include "zero_kernel.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <utility>
#include <vector>

namespace {

bool finite_values(const double *values, uint32_t count) {
  if (count != 0 && values == nullptr)
    return false;
  for (uint32_t index = 0; index < count; ++index)
    if (!std::isfinite(values[index]))
      return false;
  return true;
}

zk_error write_values(const double *values, uint32_t count, double *output,
                      uint32_t capacity, uint32_t *output_count) {
  *output_count = count;
  if (count > capacity || (count != 0 && output == nullptr))
    return ZK_ERROR_OUT_OF_RANGE;
  if (count != 0)
    std::copy(values, values + count, output);
  return ZK_OK;
}

bool read_count(double value, uint32_t maximum, uint32_t &count) {
  if (value < 0.0 || value > maximum || std::floor(value) != value)
    return false;
  count = static_cast<uint32_t>(value);
  return true;
}

struct Point2 {
  double x;
  double y;
};

struct ArcParameters {
  Point2 center;
  double rx;
  double ry;
  double rotation;
  double start_angle;
  double delta_angle;
};

constexpr double kPi = 3.141592653589793238462643383279502884;
double square(double value) { return value * value; }

Point2 point_at(const double *input, uint32_t index) {
  return {input[index * 2], input[index * 2 + 1]};
}

double point_distance(Point2 first, Point2 second) {
  return std::hypot(first.x - second.x, first.y - second.y);
}

Point2 closest_segment_point(Point2 point, Point2 start, Point2 end) {
  const double dx = end.x - start.x;
  const double dy = end.y - start.y;
  const double denominator = dx * dx + dy * dy;
  const double amount =
      denominator == 0.0
          ? 0.0
          : std::max(0.0, std::min(1.0, ((point.x - start.x) * dx +
                                         (point.y - start.y) * dy) /
                                            denominator));
  return {start.x + amount * dx, start.y + amount * dy};
}

double point_cross(Point2 first, Point2 second) {
  return first.x * second.y - first.y * second.x;
}

Point2 point_subtract(Point2 first, Point2 second) {
  return {first.x - second.x, first.y - second.y};
}

bool resolve_arc(Point2 start, Point2 end, double rx, double ry,
                 double rotation_degrees, bool large_arc, bool sweep,
                 ArcParameters &arc) {
  rx = std::abs(rx);
  ry = std::abs(ry);
  if (rx == 0.0 || ry == 0.0 || point_distance(start, end) == 0.0)
    return false;
  const double rotation = rotation_degrees * kPi / 180.0;
  const double cosine = std::cos(rotation);
  const double sine = std::sin(rotation);
  const double dx = (start.x - end.x) * 0.5;
  const double dy = (start.y - end.y) * 0.5;
  const double x_prime = cosine * dx + sine * dy;
  const double y_prime = -sine * dx + cosine * dy;
  const double scale =
      square(x_prime) / square(rx) + square(y_prime) / square(ry);
  if (scale > 1.0) {
    const double factor = std::sqrt(scale);
    rx *= factor;
    ry *= factor;
  }
  const double numerator =
      std::max(0.0, square(rx) * square(ry) - square(rx) * square(y_prime) -
                        square(ry) * square(x_prime));
  const double denominator =
      square(rx) * square(y_prime) + square(ry) * square(x_prime);
  const double sign = large_arc == sweep ? -1.0 : 1.0;
  const double coefficient =
      denominator == 0.0 ? 0.0 : sign * std::sqrt(numerator / denominator);
  const double cx_prime = coefficient * rx * y_prime / ry;
  const double cy_prime = coefficient * -ry * x_prime / rx;
  const Point2 center{
      cosine * cx_prime - sine * cy_prime + (start.x + end.x) * 0.5,
      sine * cx_prime + cosine * cy_prime + (start.y + end.y) * 0.5};
  const double ux = (x_prime - cx_prime) / rx;
  const double uy = (y_prime - cy_prime) / ry;
  const double vx = (-x_prime - cx_prime) / rx;
  const double vy = (-y_prime - cy_prime) / ry;
  const double start_angle = std::atan2(uy, ux);
  double delta_angle = std::atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  if (!sweep && delta_angle > 0.0)
    delta_angle -= 2.0 * kPi;
  else if (sweep && delta_angle < 0.0)
    delta_angle += 2.0 * kPi;
  arc = {center, rx, ry, rotation, start_angle, delta_angle};
  return true;
}

Point2 point_on_arc(const ArcParameters &arc, double angle) {
  const double cosine = std::cos(arc.rotation);
  const double sine = std::sin(arc.rotation);
  const double x = arc.rx * std::cos(angle);
  const double y = arc.ry * std::sin(angle);
  return {arc.center.x + cosine * x - sine * y,
          arc.center.y + sine * x + cosine * y};
}

std::vector<Point2> segment_hits(Point2 a, Point2 b, Point2 c, Point2 d,
                                 double epsilon) {
  const Point2 r = point_subtract(b, a);
  const Point2 s = point_subtract(d, c);
  const Point2 ca = point_subtract(c, a);
  const double denominator = point_cross(r, s);
  if (std::abs(denominator) <= epsilon) {
    if (std::abs(point_cross(ca, r)) > epsilon)
      return {};
    if (std::hypot(r.x, r.y) <= epsilon) {
      return point_distance(a, closest_segment_point(a, c, d)) <= epsilon
                 ? std::vector<Point2>{a}
                 : std::vector<Point2>{};
    }
    const double rr = r.x * r.x + r.y * r.y;
    const double t0 = (ca.x * r.x + ca.y * r.y) / rr;
    const double t1 = t0 + (s.x * r.x + s.y * r.y) / rr;
    const double low = std::max(0.0, std::min(t0, t1));
    const double high = std::min(1.0, std::max(t0, t1));
    if (high < low - epsilon)
      return {};
    const Point2 first{a.x + std::max(0.0, std::min(1.0, low)) * r.x,
                       a.y + std::max(0.0, std::min(1.0, low)) * r.y};
    const Point2 last{a.x + std::max(0.0, std::min(1.0, high)) * r.x,
                      a.y + std::max(0.0, std::min(1.0, high)) * r.y};
    if (point_distance(first, last) <= epsilon)
      return {first};
    return {first, last};
  }
  const double t = point_cross(ca, s) / denominator;
  const double u = point_cross(ca, r) / denominator;
  if (t < -epsilon || t > 1.0 + epsilon ||
      u < -epsilon || u > 1.0 + epsilon)
    return {};
  const double clamped = std::max(0.0, std::min(1.0, t));
  return {{a.x + clamped * r.x, a.y + clamped * r.y}};
}

bool finite_input(const double *input, uint32_t count) {
  return finite_values(input, count);
}

} // пространство имён

extern "C" zk_error zk_geometry_primitive_execute(
    zk_geometry_primitive_operation operation, const double *input,
    uint32_t input_count, double *output, uint32_t output_capacity,
    uint32_t *output_count) {
  if (output_count == nullptr || !finite_input(input, input_count))
    return ZK_ERROR_INVALID_ARGUMENT;
  std::vector<double> result;
  auto exact = [&](uint32_t count) { return input_count == count; };
  auto read_polyline = [&](uint32_t offset, uint32_t count,
                           std::vector<Point2> &points) {
    if (count > 1'000'000 ||
        static_cast<uint64_t>(offset) + static_cast<uint64_t>(count) * 2 >
            input_count)
      return false;
    points.reserve(count);
    for (uint32_t index = 0; index < count; ++index)
      points.push_back({input[offset + index * 2],
                        input[offset + index * 2 + 1]});
    return true;
  };
  auto add_unique = [&](Point2 point, double epsilon) {
    for (size_t index = 0; index < result.size(); index += 2) {
      if (std::hypot(result[index] - point.x, result[index + 1] - point.y) <=
          epsilon)
        return;
    }
    result.push_back(point.x);
    result.push_back(point.y);
  };
  switch (operation) {
  case ZK_GEOMETRY_BOUNDS_OF_POINTS: {
    if (input_count < 2 || input_count % 2 != 0)
      return ZK_ERROR_INVALID_ARGUMENT;
    double min_x = input[0], min_y = input[1];
    double max_x = input[0], max_y = input[1];
    for (uint32_t index = 2; index < input_count; index += 2) {
      min_x = std::min(min_x, input[index]);
      min_y = std::min(min_y, input[index + 1]);
      max_x = std::max(max_x, input[index]);
      max_y = std::max(max_y, input[index + 1]);
    }
    result = {min_x, min_y, max_x, max_y};
    break;
  }
  case ZK_GEOMETRY_BOUNDS_DISTANCE: {
    if (!exact(6) || input[0] > input[2] || input[1] > input[3])
      return ZK_ERROR_INVALID_ARGUMENT;
    const double dx = std::max({input[0] - input[4], 0.0, input[4] - input[2]});
    const double dy = std::max({input[1] - input[5], 0.0, input[5] - input[3]});
    result = {std::hypot(dx, dy)};
    break;
  }
  case ZK_GEOMETRY_BOUNDS_INTERSECT:
    if (!exact(8) || input[0] > input[2] || input[1] > input[3] ||
        input[4] > input[6] || input[5] > input[7])
      return ZK_ERROR_INVALID_ARGUMENT;
    result = {input[0] <= input[6] && input[2] >= input[4] &&
                      input[1] <= input[7] && input[3] >= input[5]
                  ? 1.0
                  : 0.0};
    break;
  case ZK_GEOMETRY_BOUNDS_CIRCLE:
    if (!exact(3) || input[2] < 0.0)
      return ZK_ERROR_INVALID_ARGUMENT;
    result = {input[0] - input[2], input[1] - input[2],
              input[0] + input[2], input[1] + input[2]};
    break;
  case ZK_GEOMETRY_CIRCLE_POINTS: {
    uint32_t samples = 0;
    if (!exact(5) || input[2] < 0.0 ||
        !read_count(input[3], 4096, samples) || samples < 3)
      return ZK_ERROR_INVALID_ARGUMENT;
    result.reserve(static_cast<size_t>(samples) * 2);
    for (uint32_t index = 0; index < samples; ++index) {
      const double angle =
          (input[4] + static_cast<double>(index) * 360.0 / samples) *
          kPi / 180.0;
      result.push_back(input[0] + input[2] * std::cos(angle));
      result.push_back(input[1] + input[2] * std::sin(angle));
    }
    break;
  }
  case ZK_GEOMETRY_CLIP_POLYGON_RECT: {
    uint32_t count = 0;
    if (input_count < 11 || input[0] > input[2] || input[1] > input[3] ||
        !read_count(input[4], 1'000'000, count) || count < 3 ||
        static_cast<uint64_t>(count) * 2 + 5 != input_count)
      return ZK_ERROR_INVALID_ARGUMENT;
    std::vector<Point2> points;
    points.reserve(count);
    for (uint32_t index = 0; index < count; ++index)
      points.push_back({input[5 + index * 2], input[6 + index * 2]});
    struct Boundary {
      bool vertical;
      double value;
      bool keep_greater;
    };
    const std::array<Boundary, 4> boundaries{{
        {true, input[0], true},
        {true, input[2], false},
        {false, input[1], true},
        {false, input[3], false},
    }};
    for (const Boundary &boundary : boundaries) {
      if (points.empty())
        break;
      std::vector<Point2> clipped;
      clipped.reserve(points.size() + 2);
      Point2 previous = points.back();
      bool previous_inside =
          boundary.keep_greater
              ? (boundary.vertical ? previous.x >= boundary.value
                                   : previous.y >= boundary.value)
              : (boundary.vertical ? previous.x <= boundary.value
                                   : previous.y <= boundary.value);
      for (const Point2 current : points) {
        const bool current_inside =
            boundary.keep_greater
                ? (boundary.vertical ? current.x >= boundary.value
                                     : current.y >= boundary.value)
                : (boundary.vertical ? current.x <= boundary.value
                                     : current.y <= boundary.value);
        if (current_inside != previous_inside) {
          if (boundary.vertical) {
            const double amount =
                (boundary.value - previous.x) / (current.x - previous.x);
            clipped.push_back(
                {boundary.value,
                 previous.y + (current.y - previous.y) * amount});
          } else {
            const double amount =
                (boundary.value - previous.y) / (current.y - previous.y);
            clipped.push_back(
                {previous.x + (current.x - previous.x) * amount,
                 boundary.value});
          }
        }
        if (current_inside)
          clipped.push_back(current);
        previous = current;
        previous_inside = current_inside;
      }
      points = std::move(clipped);
    }
    result.reserve(points.size() * 2);
    for (const Point2 point : points) {
      result.push_back(point.x);
      result.push_back(point.y);
    }
    break;
  }
  case ZK_GEOMETRY_CLOSEST_POINT_SEGMENT:
  case ZK_GEOMETRY_DISTANCE_SEGMENT: {
    if (!exact(6))
      return ZK_ERROR_INVALID_ARGUMENT;
    const Point2 point{input[0], input[1]};
    const Point2 start{input[2], input[3]};
    const Point2 end{input[4], input[5]};
    const Point2 closest = closest_segment_point(point, start, end);
    if (operation == ZK_GEOMETRY_CLOSEST_POINT_SEGMENT)
      result = {closest.x, closest.y};
    else
      result = {point_distance(point, closest)};
    break;
  }
  case ZK_GEOMETRY_SEGMENT_LENGTH:
  case ZK_GEOMETRY_SEGMENT_TANGENT: {
    if (!exact(4))
      return ZK_ERROR_INVALID_ARGUMENT;
    const Point2 direction{input[2] - input[0], input[3] - input[1]};
    if (operation == ZK_GEOMETRY_SEGMENT_LENGTH) {
      result = {std::hypot(direction.x, direction.y)};
    } else {
      const double length = std::hypot(direction.x, direction.y);
      result = length == 0.0
                   ? std::vector<double>{0.0, 0.0}
                   : std::vector<double>{direction.x / length,
                                         direction.y / length};
    }
    break;
  }
  case ZK_GEOMETRY_INTERSECT_SEGMENTS: {
    if (input_count != 8 && input_count != 9)
      return ZK_ERROR_INVALID_ARGUMENT;
    const double epsilon = input_count == 9 ? input[8] : 1e-9;
    if (epsilon < 0.0)
      return ZK_ERROR_INVALID_ARGUMENT;
    for (Point2 hit : segment_hits({input[0], input[1]},
                                   {input[2], input[3]},
                                   {input[4], input[5]},
                                   {input[6], input[7]}, epsilon))
      add_unique(hit, epsilon);
    break;
  }
  case ZK_GEOMETRY_POLYLINE_LENGTH: {
    if (input_count < 1 || (input_count - 1) % 2 != 0 ||
        (input[0] != 0.0 && input[0] != 1.0))
      return ZK_ERROR_INVALID_ARGUMENT;
    std::vector<Point2> points;
    if (!read_polyline(1, (input_count - 1) / 2, points))
      return ZK_ERROR_INVALID_ARGUMENT;
    double length = 0.0;
    for (size_t index = 1; index < points.size(); ++index)
      length += point_distance(points[index - 1], points[index]);
    if (input[0] != 0.0 && points.size() > 1)
      length += point_distance(points.back(), points.front());
    result = {length};
    break;
  }
  case ZK_GEOMETRY_CLOSEST_POINT_POLYLINE: {
    if (input_count < 4 || (input[2] != 0.0 && input[2] != 1.0))
      return ZK_ERROR_INVALID_ARGUMENT;
    const double count_value = input[3];
    if (!std::isfinite(count_value) || count_value < 0.0 ||
        std::floor(count_value) != count_value)
      return ZK_ERROR_INVALID_ARGUMENT;
    const uint32_t count = static_cast<uint32_t>(count_value);
    if (input_count != 4 + count * 2)
      return ZK_ERROR_INVALID_ARGUMENT;
    std::vector<Point2> points;
    if (!read_polyline(4, count, points))
      return ZK_ERROR_INVALID_ARGUMENT;
    if (points.empty())
      break;
    const Point2 point{input[0], input[1]};
    Point2 best = points.front();
    double best_distance = point_distance(point, best);
    const uint32_t segment_count =
        count > 1 ? count - 1 + (input[2] != 0.0 ? 1 : 0) : 0;
    for (uint32_t index = 0; index < segment_count; ++index) {
      const Point2 candidate = closest_segment_point(
          point, points[index], points[(index + 1) % count]);
      const double candidate_distance = point_distance(point, candidate);
      if (candidate_distance < best_distance) {
        best = candidate;
        best_distance = candidate_distance;
      }
    }
    result = {best.x, best.y};
    break;
  }
  case ZK_GEOMETRY_POLYLINE_INTERSECTIONS: {
    if (input_count < 4)
      return ZK_ERROR_INVALID_ARGUMENT;
    uint32_t offset = 0;
    const double closed_first = input[offset++];
    const double first_count_value = input[offset++];
    if ((closed_first != 0.0 && closed_first != 1.0) ||
        first_count_value < 0.0 ||
        std::floor(first_count_value) != first_count_value)
      return ZK_ERROR_INVALID_ARGUMENT;
    const uint32_t first_count = static_cast<uint32_t>(first_count_value);
    std::vector<Point2> first;
    if (!read_polyline(offset, first_count, first))
      return ZK_ERROR_INVALID_ARGUMENT;
    offset += first_count * 2;
    if (offset + 2 > input_count)
      return ZK_ERROR_INVALID_ARGUMENT;
    const double closed_second = input[offset++];
    const double second_count_value = input[offset++];
    if ((closed_second != 0.0 && closed_second != 1.0) ||
        second_count_value < 0.0 ||
        std::floor(second_count_value) != second_count_value)
      return ZK_ERROR_INVALID_ARGUMENT;
    const uint32_t second_count = static_cast<uint32_t>(second_count_value);
    std::vector<Point2> second;
    if (!read_polyline(offset, second_count, second) ||
        offset + second_count * 2 != input_count)
      return ZK_ERROR_INVALID_ARGUMENT;
    const uint32_t first_segments =
        first_count > 1 ? first_count - 1 + (closed_first != 0.0 ? 1 : 0) : 0;
    const uint32_t second_segments =
        second_count > 1 ? second_count - 1 + (closed_second != 0.0 ? 1 : 0) : 0;
    for (uint32_t a = 0; a < first_segments; ++a)
      for (uint32_t b = 0; b < second_segments; ++b)
        for (Point2 hit : segment_hits(first[a], first[(a + 1) % first_count],
                                       second[b], second[(b + 1) % second_count],
                                       1e-9))
          add_unique(hit, 1e-8);
    break;
  }
  case ZK_GEOMETRY_QUADRATIC_AT:
  case ZK_GEOMETRY_QUADRATIC_TANGENT: {
    if (!exact(7))
      return ZK_ERROR_INVALID_ARGUMENT;
    const double t = input[6];
    const double u = 1.0 - t;
    if (operation == ZK_GEOMETRY_QUADRATIC_AT) {
      result = {u * u * input[0] + 2.0 * u * t * input[2] +
                    t * t * input[4],
                u * u * input[1] + 2.0 * u * t * input[3] +
                    t * t * input[5]};
    } else {
      Point2 tangent{2.0 * u * (input[2] - input[0]) +
                         2.0 * t * (input[4] - input[2]),
                     2.0 * u * (input[3] - input[1]) +
                         2.0 * t * (input[5] - input[3])};
      const double length = std::hypot(tangent.x, tangent.y);
      if (length != 0.0) {
        tangent.x /= length;
        tangent.y /= length;
      }
      result = {tangent.x, tangent.y};
    }
    break;
  }
  case ZK_GEOMETRY_CUBIC_AT:
  case ZK_GEOMETRY_CUBIC_TANGENT: {
    if (!exact(9))
      return ZK_ERROR_INVALID_ARGUMENT;
    const double t = input[8];
    const double u = 1.0 - t;
    if (operation == ZK_GEOMETRY_CUBIC_AT) {
      const double u2 = u * u;
      const double t2 = t * t;
      result = {u2 * u * input[0] + 3.0 * u2 * t * input[2] +
                    3.0 * u * t2 * input[4] + t2 * t * input[6],
                u2 * u * input[1] + 3.0 * u2 * t * input[3] +
                    3.0 * u * t2 * input[5] + t2 * t * input[7]};
    } else {
      Point2 tangent{
          3.0 * u * u * (input[2] - input[0]) +
              6.0 * u * t * (input[4] - input[2]) +
              3.0 * t * t * (input[6] - input[4]),
          3.0 * u * u * (input[3] - input[1]) +
              6.0 * u * t * (input[5] - input[3]) +
              3.0 * t * t * (input[7] - input[5])};
      const double length = std::hypot(tangent.x, tangent.y);
      if (length != 0.0) {
        tangent.x /= length;
        tangent.y /= length;
      }
      result = {tangent.x, tangent.y};
    }
    break;
  }
  case ZK_GEOMETRY_CIRCLE_INTERSECTIONS: {
    if (!exact(7) && !exact(6))
      return ZK_ERROR_INVALID_ARGUMENT;
    const double epsilon = input_count == 7 ? input[6] : 1e-9;
    const double r1 = input[2];
    const double r2 = input[5];
    const Point2 a{input[0], input[1]};
    const Point2 b{input[3], input[4]};
    const double dx = b.x - a.x;
    const double dy = b.y - a.y;
    const double d = std::hypot(dx, dy);
    if (r1 < 0.0 || r2 < 0.0 || epsilon < 0.0)
      return ZK_ERROR_INVALID_ARGUMENT;
    if (d <= epsilon && std::abs(r1 - r2) <= epsilon)
      break;
    if (d > r1 + r2 + epsilon || d < std::abs(r1 - r2) - epsilon ||
        d <= epsilon)
      break;
    const double along = (r1 * r1 - r2 * r2 + d * d) / (2.0 * d);
    const double height = std::sqrt(std::max(0.0, r1 * r1 - along * along));
    const Point2 middle{a.x + along * dx / d, a.y + along * dy / d};
    const Point2 offset{-dy * height / d, dx * height / d};
    add_unique({middle.x + offset.x, middle.y + offset.y}, epsilon);
    add_unique({middle.x - offset.x, middle.y - offset.y}, epsilon);
    break;
  }
  case ZK_GEOMETRY_CIRCLE_SEGMENT_INTERSECTIONS: {
    if (!exact(8) && !exact(7))
      return ZK_ERROR_INVALID_ARGUMENT;
    const double epsilon = input_count == 8 ? input[7] : 1e-9;
    const Point2 center{input[0], input[1]};
    const double radius = input[2];
    const Point2 start{input[3], input[4]};
    const Point2 end{input[5], input[6]};
    const Point2 direction = point_subtract(end, start);
    const Point2 offset = point_subtract(start, center);
    const double a = direction.x * direction.x + direction.y * direction.y;
    const double b = 2.0 * (offset.x * direction.x + offset.y * direction.y);
    const double c = offset.x * offset.x + offset.y * offset.y - radius * radius;
    if (radius < 0.0 || epsilon < 0.0)
      return ZK_ERROR_INVALID_ARGUMENT;
    if (a == 0.0) {
      if (std::abs(point_distance(start, center) - radius) <= epsilon)
        add_unique(start, epsilon);
      break;
    }
    const double discriminant = b * b - 4.0 * a * c;
    if (discriminant < -epsilon)
      break;
    const double root = std::sqrt(std::max(0.0, discriminant));
    for (double t : {(-b - root) / (2.0 * a), (-b + root) / (2.0 * a)})
      if (t >= -epsilon && t <= 1.0 + epsilon) {
        t = std::max(0.0, std::min(1.0, t));
        add_unique({start.x + t * direction.x,
                    start.y + t * direction.y},
                   epsilon);
      }
    break;
  }
  case ZK_GEOMETRY_DISTANCE_CIRCLE_BOUNDARY:
  case ZK_GEOMETRY_CLOSEST_POINT_CIRCLE_BOUNDARY: {
    if (!exact(5) || input[4] < 0.0)
      return ZK_ERROR_INVALID_ARGUMENT;
    const Point2 point{input[0], input[1]};
    const Point2 center{input[2], input[3]};
    const double radius = input[4];
    const double dx = point.x - center.x;
    const double dy = point.y - center.y;
    const double length = std::hypot(dx, dy);
    if (operation == ZK_GEOMETRY_DISTANCE_CIRCLE_BOUNDARY) {
      result = {std::abs(length - radius)};
    } else if (length == 0.0) {
      result = {center.x + radius, center.y};
    } else {
      result = {center.x + dx / length * radius,
                center.y + dy / length * radius};
    }
    break;
  }
  case ZK_GEOMETRY_POINT_IN_RING: {
    if (input_count < 3)
      return ZK_ERROR_INVALID_ARGUMENT;
    const double count_value = input[2];
    uint32_t count = 0;
    if (!read_count(count_value, (input_count - 3) / 2, count))
      return ZK_ERROR_INVALID_ARGUMENT;
    if (input_count != 3 + count * 2)
      return ZK_ERROR_INVALID_ARGUMENT;
    const Point2 point{input[0], input[1]};
    bool inside = false;
    for (uint32_t index = 0, previous = count == 0 ? 0 : count - 1;
         index < count; previous = index++) {
      const Point2 a{input[3 + index * 2], input[4 + index * 2]};
      const Point2 b{input[3 + previous * 2], input[4 + previous * 2]};
      const Point2 closest = closest_segment_point(point, a, b);
      if (point_distance(point, closest) <= 1e-10) {
        inside = true;
        break;
      }
      if ((a.y > point.y) != (b.y > point.y) &&
          point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x)
        inside = !inside;
    }
    result = {inside ? 1.0 : 0.0};
    break;
  }
  case ZK_GEOMETRY_RING_SIGNED_AREA: {
    if (input_count < 1)
      return ZK_ERROR_INVALID_ARGUMENT;
    const double count_value = input[0];
    uint32_t count = 0;
    if (!read_count(count_value, (input_count - 1) / 2, count))
      return ZK_ERROR_INVALID_ARGUMENT;
    if (input_count != 1 + count * 2)
      return ZK_ERROR_INVALID_ARGUMENT;
    double area = 0.0;
    for (uint32_t index = 0; index < count; ++index) {
      const Point2 first{input[1 + index * 2], input[2 + index * 2]};
      const Point2 second{input[1 + ((index + 1) % count) * 2],
                          input[2 + ((index + 1) % count) * 2]};
      area += point_cross(first, second);
    }
    result = {area * 0.5};
    break;
  }
  case ZK_GEOMETRY_ARC_PARAMETERS: {
    if (!exact(9) || (input[7] != 0.0 && input[7] != 1.0) ||
        (input[8] != 0.0 && input[8] != 1.0) || input[4] < 0.0 ||
        input[5] < 0.0)
      return ZK_ERROR_INVALID_ARGUMENT;
    ArcParameters arc{};
    if (resolve_arc({input[0], input[1]}, {input[2], input[3]}, input[4],
                    input[5], input[6], input[7] != 0.0,
                    input[8] != 0.0, arc)) {
      result = {arc.center.x, arc.center.y, arc.rx, arc.ry, arc.rotation,
                arc.start_angle, arc.delta_angle};
    }
    break;
  }
  case ZK_GEOMETRY_ARC_AT:
  case ZK_GEOMETRY_ARC_TANGENT: {
    if (!exact(10) || (input[7] != 0.0 && input[7] != 1.0) ||
        (input[8] != 0.0 && input[8] != 1.0) || input[4] < 0.0 ||
        input[5] < 0.0)
      return ZK_ERROR_INVALID_ARGUMENT;
    const Point2 start{input[0], input[1]};
    const Point2 end{input[2], input[3]};
    ArcParameters arc{};
    if (!resolve_arc(start, end, input[4], input[5], input[6],
                     input[7] != 0.0, input[8] != 0.0, arc)) {
      if (operation == ZK_GEOMETRY_ARC_AT) {
        const double t = input[9];
        result = {start.x + (end.x - start.x) * t,
                  start.y + (end.y - start.y) * t};
      } else {
        Point2 tangent = point_subtract(end, start);
        const double length = std::hypot(tangent.x, tangent.y);
        if (length != 0.0) {
          tangent.x /= length;
          tangent.y /= length;
        }
        result = {tangent.x, tangent.y};
      }
      break;
    }
    const double angle = arc.start_angle + arc.delta_angle * input[9];
    if (operation == ZK_GEOMETRY_ARC_AT) {
      const Point2 point = point_on_arc(arc, angle);
      result = {point.x, point.y};
    } else {
      const double cosine = std::cos(arc.rotation);
      const double sine = std::sin(arc.rotation);
      Point2 tangent{
          arc.delta_angle *
              (-cosine * arc.rx * std::sin(angle) -
               sine * arc.ry * std::cos(angle)),
          arc.delta_angle *
              (-sine * arc.rx * std::sin(angle) +
               cosine * arc.ry * std::cos(angle))};
      const double length = std::hypot(tangent.x, tangent.y);
      if (length != 0.0) {
        tangent.x /= length;
        tangent.y /= length;
      }
      result = {tangent.x, tangent.y};
    }
    break;
  }
  case ZK_GEOMETRY_NEAREST_SPATIAL: {
    if (input_count < 3)
      return ZK_ERROR_INVALID_ARGUMENT;
    uint32_t entry_count = 0;
    if (!read_count(input[2], (input_count - 3) / 3, entry_count) ||
        entry_count == 0)
      return ZK_ERROR_INVALID_ARGUMENT;
    const Point2 query{input[0], input[1]};
    uint32_t cursor = 3;
    double best_distance = std::numeric_limits<double>::infinity();
    Point2 best_point{};
    uint32_t best_index = 0;
    for (uint32_t index = 0; index < entry_count; ++index) {
      if (cursor >= input_count)
        return ZK_ERROR_INVALID_ARGUMENT;
      uint32_t type = 0;
      if (!read_count(input[cursor++], 3, type) || type == 0)
        return ZK_ERROR_INVALID_ARGUMENT;
      double distance = std::numeric_limits<double>::infinity();
      Point2 closest = query;
      if (type == 1) {
        if (input_count - cursor < 3 || input[cursor + 2] < 0.0)
          return ZK_ERROR_INVALID_ARGUMENT;
        const Point2 center{input[cursor], input[cursor + 1]};
        const double radius = input[cursor + 2];
        cursor += 3;
        const double dx = query.x - center.x;
        const double dy = query.y - center.y;
        const double length = std::hypot(dx, dy);
        distance = std::max(0.0, length - radius);
        if (length > radius && length != 0.0) {
          closest = {center.x + dx * radius / length,
                     center.y + dy * radius / length};
        }
      } else if (type == 2) {
        if (input_count - cursor < 2)
          return ZK_ERROR_INVALID_ARGUMENT;
        const double closed_value = input[cursor++];
        const double count_value = input[cursor++];
        uint32_t count = 0;
        if ((closed_value != 0.0 && closed_value != 1.0) ||
            !read_count(count_value, (input_count - cursor) / 2, count) ||
            count == 0)
          return ZK_ERROR_INVALID_ARGUMENT;
        std::vector<Point2> points;
        points.reserve(count);
        for (uint32_t point_index = 0; point_index < count; ++point_index) {
          points.push_back({input[cursor], input[cursor + 1]});
          cursor += 2;
        }
        if (count == 1) {
          closest = points[0];
          distance = point_distance(query, closest);
        } else {
          const uint32_t segments =
              count - 1 + (closed_value == 1.0 ? 1 : 0);
          for (uint32_t segment = 0; segment < segments; ++segment) {
            const Point2 candidate = closest_segment_point(
                query, points[segment], points[(segment + 1) % count]);
            const double candidate_distance = point_distance(query, candidate);
            if (candidate_distance < distance) {
              distance = candidate_distance;
              closest = candidate;
            }
          }
        }
      } else {
        if (input_count - cursor < 4)
          return ZK_ERROR_INVALID_ARGUMENT;
        const double min_x = input[cursor++];
        const double min_y = input[cursor++];
        const double max_x = input[cursor++];
        const double max_y = input[cursor++];
        if (min_x > max_x || min_y > max_y)
          return ZK_ERROR_INVALID_ARGUMENT;
        closest = {std::max(min_x, std::min(max_x, query.x)),
                   std::max(min_y, std::min(max_y, query.y))};
        distance = point_distance(query, closest);
      }
      if (distance < best_distance) {
        best_distance = distance;
        best_point = closest;
        best_index = index;
      }
    }
    if (cursor != input_count)
      return ZK_ERROR_INVALID_ARGUMENT;
    result = {static_cast<double>(best_index), best_distance,
              best_point.x, best_point.y};
    break;
  }
  case ZK_GEOMETRY_NEAREST_POINTS: {
    if (input_count < 3)
      return ZK_ERROR_INVALID_ARGUMENT;
    uint32_t count = 0;
    if (!read_count(input[2], (input_count - 3) / 2, count) || count == 0 ||
        input_count != 3 + count * 2)
      return ZK_ERROR_INVALID_ARGUMENT;
    const Point2 query{input[0], input[1]};
    double best_distance = std::numeric_limits<double>::infinity();
    Point2 best_point{};
    uint32_t best_index = 0;
    for (uint32_t index = 0; index < count; ++index) {
      const Point2 candidate{input[3 + index * 2], input[4 + index * 2]};
      const double distance = point_distance(query, candidate);
      if (distance < best_distance) {
        best_distance = distance;
        best_point = candidate;
        best_index = index;
      }
    }
    result = {static_cast<double>(best_index), best_distance,
              best_point.x, best_point.y};
    break;
  }
  case ZK_GEOMETRY_GRID_PATH_SAMPLES: {
    if (!exact(4))
      return ZK_ERROR_INVALID_ARGUMENT;
    const Point2 start{input[0], input[1]};
    const Point2 end{input[2], input[3]};
    const double distance = point_distance(start, end);
    const double steps_value = std::max(1.0, std::ceil(distance));
    if (!std::isfinite(steps_value) || steps_value > 8'000'000.0)
      return ZK_ERROR_OUT_OF_RANGE;
    const uint32_t steps = static_cast<uint32_t>(steps_value);
    const double step = distance / steps;
    result.reserve(2 + steps * 2);
    result.push_back(step);
    result.push_back(static_cast<double>(steps));
    for (uint32_t index = 1; index <= steps; ++index) {
      const double ratio = static_cast<double>(index) / steps;
      result.push_back(std::floor(start.x + (end.x - start.x) * ratio + 0.5));
      result.push_back(std::floor(start.y + (end.y - start.y) * ratio + 0.5));
    }
    break;
  }
  case ZK_GEOMETRY_GRID_PATH_WEIGHTED_SUM: {
    if (input_count < 1 || input[0] < 0.0)
      return ZK_ERROR_INVALID_ARGUMENT;
    double total = 0.0;
    for (uint32_t index = 1; index < input_count; ++index) {
      if (input[index] < 0.0)
        return ZK_ERROR_INVALID_ARGUMENT;
      total += input[0] * input[index];
    }
    result = {total};
    break;
  }
  default:
    return ZK_ERROR_INVALID_ARGUMENT;
  }
  if (result.size() > std::numeric_limits<uint32_t>::max())
    return ZK_ERROR_OVERFLOW;
  for (double value : result)
    if (!std::isfinite(value))
      return ZK_ERROR_OVERFLOW;
  return write_values(result.data(), static_cast<uint32_t>(result.size()), output,
                      output_capacity, output_count);
}

extern "C" zk_error zk_vector_execute(zk_vector_operation operation,
                                        const double *input,
                                        uint32_t input_count, double *output,
                                        uint32_t output_capacity,
                                        uint32_t *output_count) {
  if (output_count == nullptr || !finite_values(input, input_count))
    return ZK_ERROR_INVALID_ARGUMENT;

  double result[2]{};
  uint32_t result_count = 0;
  switch (operation) {
  case ZK_VECTOR_ADD:
  case ZK_VECTOR_SUBTRACT:
  case ZK_VECTOR_DOT:
  case ZK_VECTOR_CROSS:
  case ZK_VECTOR_DISTANCE:
    if (input_count != 4)
      return ZK_ERROR_INVALID_ARGUMENT;
    if (operation == ZK_VECTOR_ADD) {
      result[0] = input[0] + input[2];
      result[1] = input[1] + input[3];
      result_count = 2;
    } else if (operation == ZK_VECTOR_SUBTRACT) {
      result[0] = input[0] - input[2];
      result[1] = input[1] - input[3];
      result_count = 2;
    } else if (operation == ZK_VECTOR_DOT) {
      result[0] = input[0] * input[2] + input[1] * input[3];
      result_count = 1;
    } else if (operation == ZK_VECTOR_CROSS) {
      result[0] = input[0] * input[3] - input[1] * input[2];
      result_count = 1;
    } else {
      result[0] = std::hypot(input[0] - input[2], input[1] - input[3]);
      result_count = 1;
    }
    break;
  case ZK_VECTOR_SCALE:
    if (input_count != 3)
      return ZK_ERROR_INVALID_ARGUMENT;
    result[0] = input[0] * input[2];
    result[1] = input[1] * input[2];
    result_count = 2;
    break;
  case ZK_VECTOR_LENGTH:
    if (input_count != 2)
      return ZK_ERROR_INVALID_ARGUMENT;
    result[0] = std::hypot(input[0], input[1]);
    result_count = 1;
    break;
  case ZK_VECTOR_NORMALIZE: {
    if (input_count != 2)
      return ZK_ERROR_INVALID_ARGUMENT;
    const double length = std::hypot(input[0], input[1]);
    if (length != 0.0) {
      result[0] = input[0] / length;
      result[1] = input[1] / length;
    }
    result_count = 2;
    break;
  }
  case ZK_VECTOR_PERPENDICULAR:
    if (input_count != 2)
      return ZK_ERROR_INVALID_ARGUMENT;
    result[0] = -input[1];
    result[1] = input[0];
    result_count = 2;
    break;
  case ZK_VECTOR_LERP:
    if (input_count != 5)
      return ZK_ERROR_INVALID_ARGUMENT;
    result[0] = input[0] + (input[2] - input[0]) * input[4];
    result[1] = input[1] + (input[3] - input[1]) * input[4];
    result_count = 2;
    break;
  default:
    return ZK_ERROR_INVALID_ARGUMENT;
  }

  if (!finite_values(result, result_count))
    return ZK_ERROR_OVERFLOW;
  return write_values(result, result_count, output, output_capacity,
                      output_count);
}

extern "C" zk_error zk_affine_execute(zk_affine_operation operation,
                                        const double *input,
                                        uint32_t input_count, double *output,
                                        uint32_t output_capacity,
                                        uint32_t *output_count) {
  if (output_count == nullptr || !finite_values(input, input_count))
    return ZK_ERROR_INVALID_ARGUMENT;

  double result[6]{};
  uint32_t result_count = 0;
  switch (operation) {
  case ZK_AFFINE_IDENTITY:
    if (input_count != 0)
      return ZK_ERROR_INVALID_ARGUMENT;
    result[0] = 1.0;
    result[3] = 1.0;
    result_count = 6;
    break;
  case ZK_AFFINE_CREATE:
    if (input_count != 6)
      return ZK_ERROR_INVALID_ARGUMENT;
    std::copy(input, input + 6, result);
    result_count = 6;
    break;
  case ZK_AFFINE_TRANSLATION:
    if (input_count != 2)
      return ZK_ERROR_INVALID_ARGUMENT;
    result[0] = 1.0;
    result[3] = 1.0;
    result[4] = input[0];
    result[5] = input[1];
    result_count = 6;
    break;
  case ZK_AFFINE_SCALING:
    if (input_count != 1 && input_count != 2)
      return ZK_ERROR_INVALID_ARGUMENT;
    result[0] = input[0];
    result[3] = input_count == 1 ? input[0] : input[1];
    result_count = 6;
    break;
  case ZK_AFFINE_ROTATION:
    if (input_count != 1)
      return ZK_ERROR_INVALID_ARGUMENT;
    result[0] = std::cos(input[0]);
    result[1] = std::sin(input[0]);
    result[2] = -result[1];
    result[3] = result[0];
    result_count = 6;
    break;
  case ZK_AFFINE_MULTIPLY:
    if (input_count != 12)
      return ZK_ERROR_INVALID_ARGUMENT;
    result[0] = input[0] * input[6] + input[2] * input[7];
    result[1] = input[1] * input[6] + input[3] * input[7];
    result[2] = input[0] * input[8] + input[2] * input[9];
    result[3] = input[1] * input[8] + input[3] * input[9];
    result[4] = input[0] * input[10] + input[2] * input[11] + input[4];
    result[5] = input[1] * input[10] + input[3] * input[11] + input[5];
    result_count = 6;
    break;
  case ZK_AFFINE_INVERT: {
    if (input_count != 6)
      return ZK_ERROR_INVALID_ARGUMENT;
    const double determinant = input[0] * input[3] - input[1] * input[2];
    if (!std::isfinite(determinant))
      return ZK_ERROR_OVERFLOW;
    if (std::abs(determinant) <= 1e-12)
      return ZK_ERROR_INVALID_ARGUMENT;
    result[0] = input[3] / determinant;
    result[1] = -input[1] / determinant;
    result[2] = -input[2] / determinant;
    result[3] = input[0] / determinant;
    result[4] = (input[2] * input[5] - input[3] * input[4]) / determinant;
    result[5] = (input[1] * input[4] - input[0] * input[5]) / determinant;
    result_count = 6;
    break;
  }
  case ZK_AFFINE_APPLY:
    if (input_count != 8)
      return ZK_ERROR_INVALID_ARGUMENT;
    result[0] = input[0] * input[6] + input[2] * input[7] + input[4];
    result[1] = input[1] * input[6] + input[3] * input[7] + input[5];
    result_count = 2;
    break;
  default:
    return ZK_ERROR_INVALID_ARGUMENT;
  }
  if (!finite_values(result, result_count))
    return ZK_ERROR_OVERFLOW;
  return write_values(result, result_count, output, output_capacity,
                      output_count);
}
