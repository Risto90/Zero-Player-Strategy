#include "zero_kernel.h"

#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstdint>
#include <limits>

namespace {
bool close(double left, double right, double tolerance = 1e-10) {
  return std::abs(left - right) <= tolerance *
      std::max({1.0, std::abs(left), std::abs(right)});
}
}

int main() {
  const double a[] = {4, 1, 2, 3};
  const double b[] = {1, 2, 3, 4};
  double output[16] = {};
  uint32_t rows = 0, columns = 0;
  assert(zk_matrix_execute(ZK_MATRIX_MATMUL, ZK_MATRIX_F64, a, 2, 2, b, 2,
                           2, output, 16, &rows, &columns) == ZK_OK);
  assert(rows == 2 && columns == 2);
  assert(close(output[0], 7) && close(output[1], 12) &&
         close(output[2], 11) && close(output[3], 16));

  assert(zk_matrix_execute(ZK_MATRIX_DETERMINANT, ZK_MATRIX_F64, a, 2, 2,
                           nullptr, 0, 0, output, 16, &rows, &columns) ==
         ZK_OK);
  assert(close(output[0], 10) && rows == 1 && columns == 1);
  assert(zk_matrix_execute(ZK_MATRIX_INVERSE, ZK_MATRIX_F64, a, 2, 2,
                           nullptr, 0, 0, output, 16, &rows, &columns) ==
         ZK_OK);
  assert(close(output[0], 0.3) && close(output[1], -0.1) &&
         close(output[2], -0.2) && close(output[3], 0.4));

  const double right_hand_side[] = {1, 0};
  assert(zk_matrix_execute(ZK_MATRIX_SOLVE, ZK_MATRIX_F64, a, 2, 2,
                           right_hand_side, 2, 1, output, 16, &rows,
                           &columns) == ZK_OK);
  assert(rows == 2 && columns == 1);
  assert(close(4 * output[0] + output[1], 1));
  assert(close(2 * output[0] + 3 * output[1], 0));

  const double rectangular[] = {1, 0, 0, 1, 1, 1};
  double u[16] = {}, singular[16] = {}, v[16] = {};
  uint32_t ur = 0, uc = 0, sr = 0, sc = 0, vr = 0, vc = 0;
  assert(zk_matrix_factorize(
             ZK_MATRIX_SVD, ZK_MATRIX_F64, rectangular, 3, 2, u, 16, &ur,
             &uc, singular, 16, &sr, &sc, v, 16, &vr, &vc) == ZK_OK);
  assert(ur == 3 && uc == 3 && sr == 2 && sc == 2 && vr == 2 && vc == 2);
  for (uint32_t row = 0; row < 3; ++row) {
    for (uint32_t column = 0; column < 2; ++column) {
      double reconstructed = 0;
      for (uint32_t i = 0; i < 2; ++i)
        reconstructed += u[row * 3 + i] * singular[i * 2 + i] *
                         v[column * 2 + i];
      assert(close(reconstructed, rectangular[row * 2 + column], 1e-8));
    }
  }

  const double spd[] = {4, 2, 2, 3};
  double factor_a[4] = {}, unused_b[4] = {}, unused_c[4] = {};
  assert(zk_matrix_factorize(
             ZK_MATRIX_CHOLESKY, ZK_MATRIX_F64, spd, 2, 2, factor_a, 4, &ur,
             &uc, unused_b, 4, &sr, &sc, unused_c, 4, &vr, &vc) == ZK_OK);
  assert(close(factor_a[0] * factor_a[0], 4));
  assert(close(factor_a[2] * factor_a[0], 2));
  assert(close(factor_a[2] * factor_a[2] + factor_a[3] * factor_a[3], 3));

  const double eigen_input[] = {2, 1, 1, 2};
  assert(zk_matrix_factorize(
             ZK_MATRIX_SYMMETRIC_EIGEN, ZK_MATRIX_F64, eigen_input, 2, 2,
             factor_a, 4, &ur, &uc, unused_b, 4, &sr, &sc, unused_c, 4, &vr,
             &vc) == ZK_OK);
  assert(ur == 2 && uc == 1 && close(factor_a[0], 1) &&
         close(factor_a[1], 3));

  const uint32_t row_offsets[] = {0, 2, 3};
  const uint32_t column_indices[] = {0, 2, 1};
  const double sparse_values[] = {2, 1, 3};
  const double vector[] = {4, 5, 6};
  assert(zk_sparse_matvec(ZK_MATRIX_F64, 2, 3, row_offsets, column_indices,
                          sparse_values, 3, vector, output, 2) == ZK_OK);
  assert(close(output[0], 14) && close(output[1], 15));
  const double dense_rhs[] = {1, 2, 3, 4, 5, 6};
  assert(zk_sparse_matmul(ZK_MATRIX_F64, 2, 3, row_offsets, column_indices,
                           sparse_values, 3, dense_rhs, 2, output, 4) ==
         ZK_OK);
  assert(close(output[0], 7) && close(output[1], 10) &&
         close(output[2], 9) && close(output[3], 12));
  assert(zk_sparse_matmul(ZK_MATRIX_F64, 2, 3, row_offsets, column_indices,
                          sparse_values, 3, dense_rhs, 2, output, 3) ==
         ZK_ERROR_OUT_OF_RANGE);
  const uint32_t zero_row_offsets[] = {0, 1};
  const uint32_t zero_column_indices[] = {0};
  const double zero_value[] = {0};
  const double one_value[] = {1};
  assert(zk_sparse_matvec(ZK_MATRIX_F64, 1, 1, zero_row_offsets,
                          zero_column_indices, zero_value, 1, one_value,
                          output, 1) == ZK_ERROR_INVALID_ARGUMENT);

  const double batch_left[] = {1, 2, 3, 4, 5, 6, 7, 8};
  const double batch_right[] = {2, 0, 0, 2};
  assert(zk_matrix_batch_matmul(ZK_MATRIX_F64, batch_left, 2, 2, 2,
                                batch_right, 1, 2, 2, output, 8) == ZK_OK);
  for (uint32_t index = 0; index < 8; ++index)
    assert(close(output[index], batch_left[index] * 2));

  const float f32[] = {1, 2, 3, 4};
  float f32_output[4] = {};
  assert(zk_matrix_execute(ZK_MATRIX_TRANSPOSE, ZK_MATRIX_F32, f32, 2, 2,
                           nullptr, 0, 0, f32_output, 4, &rows, &columns) ==
         ZK_OK);
  assert(f32_output[0] == 1 && f32_output[1] == 3 &&
         f32_output[2] == 2 && f32_output[3] == 4);

  const double singular_matrix[] = {1, 2, 2, 4};
  output[0] = 99;
  rows = 77;
  assert(zk_matrix_execute(ZK_MATRIX_INVERSE, ZK_MATRIX_F64, singular_matrix,
                           2, 2, nullptr, 0, 0, output, 16, &rows,
                           &columns) == ZK_ERROR_CONFLICT);
  assert(output[0] == 99 && rows == 77);
  const double nan_matrix[] = {1, std::numeric_limits<double>::quiet_NaN(),
                               3, 4};
  assert(zk_matrix_execute(ZK_MATRIX_SUM, ZK_MATRIX_F64, nan_matrix, 2, 2,
                           nullptr, 0, 0, output, 16, &rows, &columns) ==
         ZK_ERROR_INVALID_ARGUMENT);
  assert(output[0] == 99 && rows == 77);
  return 0;
}
