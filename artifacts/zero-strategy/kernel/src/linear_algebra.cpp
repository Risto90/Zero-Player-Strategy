#include "zero_kernel.h"

#include <Eigen/Dense>
#include <Eigen/Eigenvalues>
#include <Eigen/Sparse>
#include <Eigen/SVD>

#if EIGEN_WORLD_VERSION != 3 || EIGEN_MAJOR_VERSION != 4 || EIGEN_MINOR_VERSION != 0
#error "Для матричного ядра требуется Eigen 3.4.0"
#endif

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <new>
#include <vector>

namespace {
using Index = Eigen::Index;
template <typename T>
using Matrix = Eigen::Matrix<T, Eigen::Dynamic, Eigen::Dynamic, Eigen::RowMajor>;
template <typename T>
using Vector = Eigen::Matrix<T, Eigen::Dynamic, 1>;

bool supported_type(zk_matrix_type type) {
  return type == ZK_MATRIX_F32 || type == ZK_MATRIX_F64;
}

bool valid_size(uint32_t rows, uint32_t columns, size_t *count) {
  if (rows == 0 || columns == 0 ||
      static_cast<size_t>(rows) > std::numeric_limits<size_t>::max() / columns)
    return false;
  *count = static_cast<size_t>(rows) * columns;
  return *count <= ZK_MEMORY_LIMIT_BYTES / sizeof(double);
}

bool checked_product3(uint32_t first, uint32_t second, uint32_t third,
                      uint64_t *product) {
  const uint64_t pair = static_cast<uint64_t>(first) * second;
  if (third != 0 && pair > std::numeric_limits<uint64_t>::max() / third)
    return false;
  *product = pair * third;
  return true;
}

template <typename T>
bool finite_input(const T *input, size_t count) {
  if (count != 0 && input == nullptr)
    return false;
  for (size_t i = 0; i < count; ++i)
    if (!std::isfinite(static_cast<double>(input[i])))
      return false;
  return true;
}

template <typename T>
Matrix<T> load_matrix(const void *input, uint32_t rows, uint32_t columns) {
  return Eigen::Map<const Matrix<T>>(static_cast<const T *>(input), rows, columns);
}

template <typename T>
zk_error write_matrix(const Matrix<T> &matrix, void *output,
                      uint32_t capacity, uint32_t *out_rows,
                      uint32_t *out_columns) {
  if (matrix.rows() < 0 || matrix.cols() < 0 ||
      matrix.rows() > UINT32_MAX || matrix.cols() > UINT32_MAX)
    return ZK_ERROR_OUT_OF_RANGE;
  const size_t count = static_cast<size_t>(matrix.size());
  if (count > capacity || (count != 0 && output == nullptr))
    return ZK_ERROR_OUT_OF_RANGE;
  for (Index i = 0; i < matrix.size(); ++i)
    if (!std::isfinite(static_cast<double>(matrix.data()[i])))
      return ZK_ERROR_OVERFLOW;
  if (count != 0)
    std::copy_n(matrix.data(), count, static_cast<T *>(output));
  if (out_rows != nullptr)
    *out_rows = static_cast<uint32_t>(matrix.rows());
  if (out_columns != nullptr)
    *out_columns = static_cast<uint32_t>(matrix.cols());
  return ZK_OK;
}

template <typename T>
T tolerance(const Matrix<T> &matrix) {
  return std::numeric_limits<T>::epsilon() *
         static_cast<T>(std::max(matrix.rows(), matrix.cols())) *
         matrix.cwiseAbs().maxCoeff();
}

template <typename T>
bool is_symmetric(const Matrix<T> &matrix) {
  const T scale = matrix.cwiseAbs().maxCoeff();
  if (scale == T(0))
    return true;
  const T allowed =
      std::numeric_limits<T>::epsilon() *
      static_cast<T>(std::max(matrix.rows(), matrix.cols())) * scale;
  return (matrix - matrix.transpose()).cwiseAbs().maxCoeff() <= allowed;
}

template <typename T>
zk_error execute(zk_matrix_operation operation, const void *left_data,
                 uint32_t left_rows, uint32_t left_columns,
                 const void *right_data, uint32_t right_rows,
                 uint32_t right_columns, void *output,
                 uint32_t output_capacity, uint32_t *output_rows,
                 uint32_t *output_columns) {
  size_t left_count = 0;
  size_t right_count = 0;
  if (!valid_size(left_rows, left_columns, &left_count) ||
      !finite_input(static_cast<const T *>(left_data), left_count))
    return ZK_ERROR_INVALID_ARGUMENT;
  const Matrix<T> left = load_matrix<T>(left_data, left_rows, left_columns);
  Matrix<T> result;
  const bool needs_right =
      operation == ZK_MATRIX_ADD || operation == ZK_MATRIX_SUBTRACT ||
      operation == ZK_MATRIX_HADAMARD || operation == ZK_MATRIX_DIVIDE ||
      operation == ZK_MATRIX_MATMUL || operation == ZK_MATRIX_MATVEC ||
      operation == ZK_MATRIX_DOT || operation == ZK_MATRIX_OUTER ||
      operation == ZK_MATRIX_SOLVE;
  Matrix<T> right;
  if (needs_right) {
    if (!valid_size(right_rows, right_columns, &right_count) ||
        !finite_input(static_cast<const T *>(right_data), right_count))
      return ZK_ERROR_INVALID_ARGUMENT;
    right = load_matrix<T>(right_data, right_rows, right_columns);
  }

  uint32_t result_rows = left_rows;
  uint32_t result_columns = left_columns;
  switch (operation) {
  case ZK_MATRIX_TRANSPOSE:
    result_rows = left_columns;
    result_columns = left_rows;
    break;
  case ZK_MATRIX_ADD:
  case ZK_MATRIX_SUBTRACT:
  case ZK_MATRIX_HADAMARD:
  case ZK_MATRIX_DIVIDE:
    if ((right_rows != left_rows && right_rows != 1) ||
        (right_columns != left_columns && right_columns != 1))
      return ZK_ERROR_INVALID_ARGUMENT;
    break;
  case ZK_MATRIX_MATMUL:
    if (left_columns != right_rows)
      return ZK_ERROR_INVALID_ARGUMENT;
    result_columns = right_columns;
    break;
  case ZK_MATRIX_MATVEC:
    if (right.size() != left_columns)
      return ZK_ERROR_INVALID_ARGUMENT;
    result_columns = 1;
    break;
  case ZK_MATRIX_DOT:
    if (left.size() != right.size())
      return ZK_ERROR_INVALID_ARGUMENT;
    result_rows = result_columns = 1;
    break;
  case ZK_MATRIX_OUTER:
    if (left_count > UINT32_MAX || right_count > UINT32_MAX)
      return ZK_ERROR_OUT_OF_RANGE;
    result_rows = static_cast<uint32_t>(left_count);
    result_columns = static_cast<uint32_t>(right_count);
    break;
  case ZK_MATRIX_SUM:
  case ZK_MATRIX_MEAN:
  case ZK_MATRIX_NORM_L1:
  case ZK_MATRIX_NORM_FROBENIUS:
  case ZK_MATRIX_DETERMINANT:
  case ZK_MATRIX_RANK:
    result_rows = result_columns = 1;
    break;
  case ZK_MATRIX_TRACE:
    if (left_rows != left_columns)
      return ZK_ERROR_INVALID_ARGUMENT;
    result_rows = result_columns = 1;
    break;
  case ZK_MATRIX_INVERSE:
    if (left_rows != left_columns)
      return ZK_ERROR_INVALID_ARGUMENT;
    break;
  case ZK_MATRIX_PSEUDOINVERSE:
    result_rows = left_columns;
    result_columns = left_rows;
    break;
  case ZK_MATRIX_SOLVE:
    if (left_rows != left_columns || right_rows != left_rows)
      return ZK_ERROR_INVALID_ARGUMENT;
    result_columns = right_columns;
    break;
  default:
    return ZK_ERROR_UNSUPPORTED;
  }
  size_t result_count = 0;
  if (!valid_size(result_rows, result_columns, &result_count) ||
      result_count > output_capacity || output == nullptr)
    return ZK_ERROR_OUT_OF_RANGE;
  const uint64_t working_elements =
      static_cast<uint64_t>(left_count) + right_count + result_count;
  if (working_elements > ZK_MEMORY_LIMIT_BYTES / sizeof(T))
    return ZK_ERROR_OUT_OF_MEMORY;

  switch (operation) {
  case ZK_MATRIX_TRANSPOSE:
    result = left.transpose();
    break;
  case ZK_MATRIX_ADD:
  case ZK_MATRIX_SUBTRACT:
  case ZK_MATRIX_HADAMARD:
  case ZK_MATRIX_DIVIDE: {
    if ((right_rows != left_rows && right_rows != 1) ||
        (right_columns != left_columns && right_columns != 1))
      return ZK_ERROR_INVALID_ARGUMENT;
    result.resize(left_rows, left_columns);
    for (uint32_t row = 0; row < left_rows; ++row) {
      for (uint32_t column = 0; column < left_columns; ++column) {
        const T a = left(row, column);
        const T b = right(right_rows == 1 ? 0 : row,
                          right_columns == 1 ? 0 : column);
        if (operation == ZK_MATRIX_ADD)
          result(row, column) = a + b;
        else if (operation == ZK_MATRIX_SUBTRACT)
          result(row, column) = a - b;
        else if (operation == ZK_MATRIX_HADAMARD)
          result(row, column) = a * b;
        else {
          if (b == T(0))
            return ZK_ERROR_INVALID_ARGUMENT;
          result(row, column) = a / b;
        }
      }
    }
    break;
  }
  case ZK_MATRIX_MATMUL:
    if (left_columns != right_rows)
      return ZK_ERROR_INVALID_ARGUMENT;
    result.noalias() = left * right;
    break;
  case ZK_MATRIX_MATVEC:
    if (right.size() != left_columns)
      return ZK_ERROR_INVALID_ARGUMENT;
    result = left * Eigen::Map<const Vector<T>>(right.data(), right.size());
    break;
  case ZK_MATRIX_DOT:
    if (left.size() != right.size())
      return ZK_ERROR_INVALID_ARGUMENT;
    result.resize(1, 1);
    result(0, 0) = Eigen::Map<const Vector<T>>(left.data(), left.size())
                       .dot(Eigen::Map<const Vector<T>>(right.data(),
                                                       right.size()));
    break;
  case ZK_MATRIX_OUTER: {
    const Eigen::Map<const Vector<T>> a(left.data(), left.size());
    const Eigen::Map<const Vector<T>> b(right.data(), right.size());
    result = a * b.transpose();
    break;
  }
  case ZK_MATRIX_SUM:
    result.resize(1, 1);
    result(0, 0) = left.sum();
    break;
  case ZK_MATRIX_MEAN:
    result.resize(1, 1);
    result(0, 0) = left.mean();
    break;
  case ZK_MATRIX_NORM_L1:
    result.resize(1, 1);
    result(0, 0) = left.cwiseAbs().sum();
    break;
  case ZK_MATRIX_NORM_FROBENIUS:
    result.resize(1, 1);
    result(0, 0) = left.norm();
    break;
  case ZK_MATRIX_TRACE:
    if (left_rows != left_columns)
      return ZK_ERROR_INVALID_ARGUMENT;
    result.resize(1, 1);
    result(0, 0) = left.trace();
    break;
  case ZK_MATRIX_DETERMINANT:
    if (left_rows != left_columns)
      return ZK_ERROR_INVALID_ARGUMENT;
    if (left.fullPivLu().rank() != left_rows)
      return ZK_ERROR_CONFLICT;
    result.resize(1, 1);
    result(0, 0) = left.determinant();
    if (result(0, 0) == T(0))
      return ZK_ERROR_OVERFLOW;
    break;
  case ZK_MATRIX_RANK:
    result.resize(1, 1);
    result(0, 0) =
        static_cast<T>(left.fullPivLu().rank());
    break;
  case ZK_MATRIX_INVERSE:
    if (left_rows != left_columns)
      return ZK_ERROR_INVALID_ARGUMENT;
    if (left.fullPivLu().rank() != left_rows)
      return ZK_ERROR_CONFLICT;
    result = left.inverse();
    break;
  case ZK_MATRIX_PSEUDOINVERSE: {
    Eigen::JacobiSVD<Matrix<T>> svd(left, Eigen::ComputeThinU | Eigen::ComputeThinV);
    if (svd.info() != Eigen::Success)
      return ZK_ERROR_INTERNAL;
    const auto singular = svd.singularValues();
    const T cutoff = tolerance(left);
    Vector<T> reciprocal = singular.unaryExpr(
        [cutoff](T value) { return value > cutoff ? T(1) / value : T(0); });
    result = svd.matrixV() * reciprocal.asDiagonal() * svd.matrixU().transpose();
    break;
  }
  case ZK_MATRIX_SOLVE:
    if (left_rows != left_columns || right_rows != left_rows)
      return ZK_ERROR_INVALID_ARGUMENT;
    if (left.fullPivLu().rank() != left_rows)
      return ZK_ERROR_CONFLICT;
    result = left.fullPivLu().solve(right);
    break;
  default:
    return ZK_ERROR_UNSUPPORTED;
  }
  return write_matrix(result, output, output_capacity, output_rows,
                      output_columns);
}

template <typename T>
zk_error factorize(zk_matrix_factorization operation, const void *input,
                   uint32_t rows, uint32_t columns, void *output_a,
                   uint32_t capacity_a, uint32_t *rows_a,
                   uint32_t *columns_a, void *output_b, uint32_t capacity_b,
                   uint32_t *rows_b, uint32_t *columns_b, void *output_c,
                   uint32_t capacity_c, uint32_t *rows_c,
                   uint32_t *columns_c) {
  size_t count = 0;
  if (!valid_size(rows, columns, &count) ||
      !finite_input(static_cast<const T *>(input), count))
    return ZK_ERROR_INVALID_ARGUMENT;
  uint64_t expected_a = 0, expected_b = 0, expected_c = 0;
  const uint32_t extent = std::min(rows, columns);
  switch (operation) {
  case ZK_MATRIX_LU:
    if (rows != columns) return ZK_ERROR_INVALID_ARGUMENT;
    expected_a = expected_b = expected_c = static_cast<uint64_t>(rows) * rows;
    break;
  case ZK_MATRIX_QR:
    expected_a = static_cast<uint64_t>(rows) * extent;
    expected_b = static_cast<uint64_t>(extent) * columns;
    break;
  case ZK_MATRIX_CHOLESKY:
    if (rows != columns) return ZK_ERROR_INVALID_ARGUMENT;
    expected_a = static_cast<uint64_t>(rows) * rows;
    break;
  case ZK_MATRIX_SVD:
    expected_a = static_cast<uint64_t>(rows) * rows;
    expected_b = static_cast<uint64_t>(extent) * extent;
    expected_c = static_cast<uint64_t>(columns) * columns;
    break;
  case ZK_MATRIX_SYMMETRIC_EIGEN:
    if (rows != columns) return ZK_ERROR_INVALID_ARGUMENT;
    expected_a = rows;
    expected_b = static_cast<uint64_t>(rows) * rows;
    break;
  default:
    return ZK_ERROR_UNSUPPORTED;
  }
  if (expected_a > capacity_a || expected_b > capacity_b ||
      expected_c > capacity_c ||
      (expected_a != 0 && output_a == nullptr) ||
      (expected_b != 0 && output_b == nullptr) ||
      (expected_c != 0 && output_c == nullptr))
    return ZK_ERROR_OUT_OF_RANGE;
  if (static_cast<uint64_t>(count) + expected_a + expected_b + expected_c >
      ZK_MEMORY_LIMIT_BYTES / sizeof(T))
    return ZK_ERROR_OUT_OF_MEMORY;
  const Matrix<T> matrix = load_matrix<T>(input, rows, columns);
  Matrix<T> a, b, c;
  switch (operation) {
  case ZK_MATRIX_LU: {
    if (rows != columns)
      return ZK_ERROR_INVALID_ARGUMENT;
    const Index rank = matrix.fullPivLu().rank();
    if (rank != rows)
      return ZK_ERROR_CONFLICT;
    Eigen::PartialPivLU<Matrix<T>> lu(matrix);
    a = lu.permutationP().toDenseMatrix().template cast<T>();
    b = Matrix<T>::Identity(rows, rows);
    b.template triangularView<Eigen::StrictlyLower>() =
        lu.matrixLU().template triangularView<Eigen::StrictlyLower>();
    c = lu.matrixLU().template triangularView<Eigen::Upper>();
    break;
  }
  case ZK_MATRIX_QR: {
    Eigen::HouseholderQR<Matrix<T>> qr(matrix);
    const Index extent = std::min(rows, columns);
    a = qr.householderQ() * Matrix<T>::Identity(rows, extent);
    b = qr.matrixQR().topRows(extent).template triangularView<Eigen::Upper>();
    break;
  }
  case ZK_MATRIX_CHOLESKY:
    if (rows != columns)
      return ZK_ERROR_INVALID_ARGUMENT;
    if (!is_symmetric(matrix))
      return ZK_ERROR_INVALID_ARGUMENT;
    {
      Eigen::LLT<Matrix<T>> llt(matrix);
      if (llt.info() != Eigen::Success)
        return ZK_ERROR_CONFLICT;
      a = llt.matrixL();
    }
    break;
  case ZK_MATRIX_SVD: {
    Eigen::JacobiSVD<Matrix<T>> svd(matrix, Eigen::ComputeFullU | Eigen::ComputeFullV);
    if (svd.info() != Eigen::Success)
      return ZK_ERROR_INTERNAL;
    a = svd.matrixU();
    b = svd.singularValues().asDiagonal();
    c = svd.matrixV();
    break;
  }
  case ZK_MATRIX_SYMMETRIC_EIGEN:
    if (rows != columns)
      return ZK_ERROR_INVALID_ARGUMENT;
    if (!is_symmetric(matrix))
      return ZK_ERROR_INVALID_ARGUMENT;
    {
      Eigen::SelfAdjointEigenSolver<Matrix<T>> solver(matrix);
      if (solver.info() != Eigen::Success)
        return ZK_ERROR_INTERNAL;
      a = solver.eigenvalues();
      b = solver.eigenvectors();
    }
    break;
  default:
    return ZK_ERROR_UNSUPPORTED;
  }

  const auto fits = [](const Matrix<T> &value, void *output,
                       uint32_t capacity) {
    return static_cast<size_t>(value.size()) <= capacity &&
           (value.size() == 0 || output != nullptr);
  };
  if (!fits(a, output_a, capacity_a) ||
      (b.size() != 0 && !fits(b, output_b, capacity_b)) ||
      (c.size() != 0 && !fits(c, output_c, capacity_c)))
    return ZK_ERROR_OUT_OF_RANGE;
  for (const Matrix<T> *value : {&a, &b, &c})
    for (Index i = 0; i < value->size(); ++i)
      if (!std::isfinite(static_cast<double>(value->data()[i])))
        return ZK_ERROR_OVERFLOW;
  if (a.size()) std::copy_n(a.data(), a.size(), static_cast<T *>(output_a));
  if (b.size()) std::copy_n(b.data(), b.size(), static_cast<T *>(output_b));
  if (c.size()) std::copy_n(c.data(), c.size(), static_cast<T *>(output_c));
  if (rows_a) *rows_a = static_cast<uint32_t>(a.rows());
  if (columns_a) *columns_a = static_cast<uint32_t>(a.cols());
  if (rows_b) *rows_b = static_cast<uint32_t>(b.rows());
  if (columns_b) *columns_b = static_cast<uint32_t>(b.cols());
  if (rows_c) *rows_c = static_cast<uint32_t>(c.rows());
  if (columns_c) *columns_c = static_cast<uint32_t>(c.cols());
  return ZK_OK;
}

template <typename T>
zk_error make_sparse(uint32_t rows, uint32_t columns,
                     const uint32_t *row_offsets,
                     const uint32_t *column_indices, const T *values,
                     uint32_t nonzero_count,
                     Eigen::SparseMatrix<T, Eigen::RowMajor> *matrix) {
  const uint64_t internal_bytes =
      (static_cast<uint64_t>(rows) + 1) * sizeof(uint32_t) +
      static_cast<uint64_t>(nonzero_count) *
          (sizeof(Eigen::Triplet<T>) + sizeof(T) + sizeof(int));
  if (rows == 0 || columns == 0 || rows > INT32_MAX ||
      columns > INT32_MAX || nonzero_count > INT32_MAX ||
      internal_bytes > ZK_MEMORY_LIMIT_BYTES)
    return ZK_ERROR_OUT_OF_MEMORY;
  if (row_offsets == nullptr || (nonzero_count != 0 &&
      (column_indices == nullptr || values == nullptr)))
    return ZK_ERROR_INVALID_ARGUMENT;
  if (row_offsets[0] != 0 || row_offsets[rows] != nonzero_count)
    return ZK_ERROR_INVALID_ARGUMENT;
  std::vector<Eigen::Triplet<T>> entries;
  entries.reserve(nonzero_count);
  for (uint32_t row = 0; row < rows; ++row) {
    if (row_offsets[row] > row_offsets[row + 1] ||
        row_offsets[row + 1] > nonzero_count)
      return ZK_ERROR_INVALID_ARGUMENT;
    uint32_t previous = 0;
    bool first = true;
    for (uint32_t index = row_offsets[row]; index < row_offsets[row + 1]; ++index) {
      if (column_indices[index] >= columns ||
          (!first && column_indices[index] <= previous) ||
          !std::isfinite(static_cast<double>(values[index])) ||
          values[index] == T(0))
        return ZK_ERROR_INVALID_ARGUMENT;
      first = false;
      previous = column_indices[index];
      entries.emplace_back(row, column_indices[index], values[index]);
    }
  }
  matrix->resize(rows, columns);
  matrix->setFromTriplets(entries.begin(), entries.end());
  return ZK_OK;
}

template <typename T>
zk_error sparse_matvec(uint32_t rows, uint32_t columns,
                       const uint32_t *row_offsets,
                       const uint32_t *column_indices, const T *values,
                       uint32_t nonzero_count, const T *vector, T *output,
                       uint32_t output_capacity) {
  if (vector == nullptr || output == nullptr || output_capacity < rows)
    return ZK_ERROR_OUT_OF_RANGE;
  Eigen::SparseMatrix<T, Eigen::RowMajor> matrix;
  const zk_error sparse_error = make_sparse(
      rows, columns, row_offsets, column_indices, values, nonzero_count,
      &matrix);
  if (sparse_error != ZK_OK)
    return sparse_error;
  if (!finite_input(vector, columns))
    return ZK_ERROR_INVALID_ARGUMENT;
  const Vector<T> result = matrix * Eigen::Map<const Vector<T>>(vector, columns);
  if (!result.allFinite())
    return ZK_ERROR_OVERFLOW;
  std::copy_n(result.data(), rows, output);
  return ZK_OK;
}

template <typename T>
zk_error sparse_matmul(uint32_t rows, uint32_t inner,
                       const uint32_t *row_offsets,
                       const uint32_t *column_indices, const T *values,
                       uint32_t nonzero_count, const T *right,
                       uint32_t right_columns, T *output,
                       uint32_t output_capacity) {
  size_t dense_count = 0;
  size_t right_count = 0;
  if (!valid_size(rows, right_columns, &dense_count) ||
      !valid_size(inner, right_columns, &right_count) ||
      !finite_input(right, right_count))
    return ZK_ERROR_INVALID_ARGUMENT;
  if (dense_count > output_capacity || output == nullptr)
    return ZK_ERROR_OUT_OF_RANGE;
  Eigen::SparseMatrix<T, Eigen::RowMajor> matrix;
  const zk_error sparse_error = make_sparse(
      rows, inner, row_offsets, column_indices, values, nonzero_count,
      &matrix);
  if (sparse_error != ZK_OK)
    return sparse_error;
  const Eigen::Map<const Matrix<T>> right_matrix(right, inner, right_columns);
  const Matrix<T> result = matrix * right_matrix;
  if (!result.allFinite())
    return ZK_ERROR_OVERFLOW;
  std::copy_n(result.data(), dense_count, static_cast<T *>(output));
  return ZK_OK;
}
} // namespace

extern "C" zk_error zk_matrix_execute(
    zk_matrix_operation operation, zk_matrix_type type, const void *left,
    uint32_t left_rows, uint32_t left_columns, const void *right,
    uint32_t right_rows, uint32_t right_columns, void *output,
    uint32_t output_capacity, uint32_t *output_rows,
    uint32_t *output_columns) {
  if (!supported_type(type) || output_rows == nullptr ||
      output_columns == nullptr)
    return ZK_ERROR_INVALID_ARGUMENT;
  try {
    return type == ZK_MATRIX_F32
        ? execute<float>(operation, left, left_rows, left_columns, right,
                         right_rows, right_columns, output, output_capacity,
                         output_rows, output_columns)
        : execute<double>(operation, left, left_rows, left_columns, right,
                         right_rows, right_columns, output, output_capacity,
                         output_rows, output_columns);
  } catch (const std::bad_alloc &) {
    return ZK_ERROR_OUT_OF_MEMORY;
  } catch (...) {
    return ZK_ERROR_INTERNAL;
  }
}

extern "C" zk_error zk_matrix_factorize(
    zk_matrix_factorization factorization, zk_matrix_type type,
    const void *input, uint32_t rows, uint32_t columns, void *output_a,
    uint32_t capacity_a, uint32_t *rows_a, uint32_t *columns_a,
    void *output_b, uint32_t capacity_b, uint32_t *rows_b,
    uint32_t *columns_b, void *output_c, uint32_t capacity_c,
    uint32_t *rows_c, uint32_t *columns_c) {
  if (!supported_type(type) || rows_a == nullptr || columns_a == nullptr ||
      rows_b == nullptr || columns_b == nullptr || rows_c == nullptr ||
      columns_c == nullptr)
    return ZK_ERROR_INVALID_ARGUMENT;
  try {
    return type == ZK_MATRIX_F32
        ? factorize<float>(factorization, input, rows, columns, output_a,
                           capacity_a, rows_a, columns_a, output_b, capacity_b,
                           rows_b, columns_b, output_c, capacity_c, rows_c,
                           columns_c)
        : factorize<double>(factorization, input, rows, columns, output_a,
                            capacity_a, rows_a, columns_a, output_b,
                            capacity_b, rows_b, columns_b, output_c,
                            capacity_c, rows_c, columns_c);
  } catch (const std::bad_alloc &) {
    return ZK_ERROR_OUT_OF_MEMORY;
  } catch (...) {
    return ZK_ERROR_INTERNAL;
  }
}

extern "C" zk_error zk_matrix_batch_matmul(
    zk_matrix_type type, const void *left, uint32_t left_batches,
    uint32_t left_rows, uint32_t left_columns, const void *right,
    uint32_t right_batches, uint32_t right_rows, uint32_t right_columns,
    void *output, uint32_t output_capacity) {
  if (!supported_type(type) ||
      (left_batches != right_batches && left_batches != 1 &&
       right_batches != 1) || left_columns != right_rows ||
      left_batches == 0 || right_batches == 0)
    return ZK_ERROR_INVALID_ARGUMENT;
  const uint32_t batches = std::max(left_batches, right_batches);
  uint64_t output_count = 0, a_count = 0, b_count = 0;
  if (!checked_product3(batches, left_rows, right_columns, &output_count) ||
      !checked_product3(left_batches, left_rows, left_columns, &a_count) ||
      !checked_product3(right_batches, right_rows, right_columns, &b_count))
    return ZK_ERROR_OUT_OF_RANGE;
  const uint64_t element_limit = ZK_MEMORY_LIMIT_BYTES /
      (type == ZK_MATRIX_F32 ? sizeof(float) : sizeof(double));
  if (output_count > output_capacity || output == nullptr ||
      a_count > element_limit || b_count > element_limit ||
      output_count > element_limit ||
      a_count + b_count + output_count > element_limit)
    return ZK_ERROR_OUT_OF_RANGE;
  const size_t a_elements = static_cast<size_t>(a_count);
  const size_t b_elements = static_cast<size_t>(b_count);
  if (!finite_input(static_cast<const float *>(type == ZK_MATRIX_F32 ? left : nullptr),
                    type == ZK_MATRIX_F32 ? a_elements : 0) ||
      !finite_input(static_cast<const float *>(type == ZK_MATRIX_F32 ? right : nullptr),
                    type == ZK_MATRIX_F32 ? b_elements : 0) ||
      (type == ZK_MATRIX_F64 &&
       (!finite_input(static_cast<const double *>(left), a_elements) ||
        !finite_input(static_cast<const double *>(right), b_elements))))
    return ZK_ERROR_INVALID_ARGUMENT;
  try {
    if (type == ZK_MATRIX_F32) {
      const auto *a = static_cast<const float *>(left);
      const auto *b = static_cast<const float *>(right);
      auto *out = static_cast<float *>(output);
      std::vector<float> result(output_count);
      for (uint32_t i = 0; i < batches; ++i) {
        const uint32_t ai = left_batches == 1 ? 0 : i;
        const uint32_t bi = right_batches == 1 ? 0 : i;
        const Eigen::Map<const Matrix<float>> am(a + static_cast<size_t>(ai) * left_rows * left_columns, left_rows, left_columns);
        const Eigen::Map<const Matrix<float>> bm(b + static_cast<size_t>(bi) * right_rows * right_columns, right_rows, right_columns);
        Eigen::Map<Matrix<float>>(result.data() + static_cast<size_t>(i) * left_rows * right_columns, left_rows, right_columns).noalias() = am * bm;
      }
      for (float value : result) if (!std::isfinite(value)) return ZK_ERROR_OVERFLOW;
      std::copy(result.begin(), result.end(), out);
    } else {
      const auto *a = static_cast<const double *>(left);
      const auto *b = static_cast<const double *>(right);
      auto *out = static_cast<double *>(output);
      std::vector<double> result(output_count);
      for (uint32_t i = 0; i < batches; ++i) {
        const uint32_t ai = left_batches == 1 ? 0 : i;
        const uint32_t bi = right_batches == 1 ? 0 : i;
        const Eigen::Map<const Matrix<double>> am(a + static_cast<size_t>(ai) * left_rows * left_columns, left_rows, left_columns);
        const Eigen::Map<const Matrix<double>> bm(b + static_cast<size_t>(bi) * right_rows * right_columns, right_rows, right_columns);
        Eigen::Map<Matrix<double>>(result.data() + static_cast<size_t>(i) * left_rows * right_columns, left_rows, right_columns).noalias() = am * bm;
      }
      for (double value : result) if (!std::isfinite(value)) return ZK_ERROR_OVERFLOW;
      std::copy(result.begin(), result.end(), out);
    }
    return ZK_OK;
  } catch (const std::bad_alloc &) {
    return ZK_ERROR_OUT_OF_MEMORY;
  } catch (...) {
    return ZK_ERROR_INTERNAL;
  }
}

extern "C" zk_error zk_sparse_matvec(
    zk_matrix_type type, uint32_t rows, uint32_t columns,
    const uint32_t *row_offsets, const uint32_t *column_indices,
    const void *values, uint32_t nonzero_count, const void *vector,
    void *output, uint32_t output_capacity) {
  if (!supported_type(type) || rows == 0 || columns == 0)
    return ZK_ERROR_INVALID_ARGUMENT;
  try {
    return type == ZK_MATRIX_F32
        ? sparse_matvec(rows, columns, row_offsets, column_indices,
                        static_cast<const float *>(values), nonzero_count,
                        static_cast<const float *>(vector),
                        static_cast<float *>(output), output_capacity)
        : sparse_matvec(rows, columns, row_offsets, column_indices,
                        static_cast<const double *>(values), nonzero_count,
                        static_cast<const double *>(vector),
                        static_cast<double *>(output), output_capacity);
  } catch (const std::bad_alloc &) {
    return ZK_ERROR_OUT_OF_MEMORY;
  } catch (...) {
    return ZK_ERROR_INTERNAL;
  }
}

extern "C" zk_error zk_sparse_matmul(
    zk_matrix_type type, uint32_t left_rows, uint32_t inner,
    const uint32_t *row_offsets, const uint32_t *column_indices,
    const void *values, uint32_t nonzero_count, const void *right,
    uint32_t right_columns, void *output, uint32_t output_capacity) {
  if (!supported_type(type) || left_rows == 0 || inner == 0 ||
      right_columns == 0)
    return ZK_ERROR_INVALID_ARGUMENT;
  try {
    return type == ZK_MATRIX_F32
        ? sparse_matmul(left_rows, inner, row_offsets, column_indices,
                        static_cast<const float *>(values), nonzero_count,
                        static_cast<const float *>(right), right_columns,
                        static_cast<float *>(output), output_capacity)
        : sparse_matmul(left_rows, inner, row_offsets, column_indices,
                        static_cast<const double *>(values), nonzero_count,
                        static_cast<const double *>(right), right_columns,
                        static_cast<double *>(output), output_capacity);
  } catch (const std::bad_alloc &) {
    return ZK_ERROR_OUT_OF_MEMORY;
  } catch (...) {
    return ZK_ERROR_INTERNAL;
  }
}
