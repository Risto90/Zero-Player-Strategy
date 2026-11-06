#ifndef ZERO_KERNEL_H
#define ZERO_KERNEL_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define ZK_ABI_VERSION 1u
#define ZK_MEMORY_LIMIT_BYTES (256u * 1024u * 1024u)
#define ZK_MAX_BUFFER_SLOTS 65536u

typedef enum zk_execution_type {
  ZK_EXECUTION_SINGLE_THREAD = 1,
  ZK_EXECUTION_WASM_THREADS = 2
} zk_execution_kind;

typedef uint64_t zk_handle;

typedef enum zk_error {
  ZK_OK = 0,
  ZK_ERROR_INVALID_ARGUMENT = 1,
  ZK_ERROR_OUT_OF_MEMORY = 2,
  ZK_ERROR_INVALID_HANDLE = 3,
  ZK_ERROR_STALE_HANDLE = 4,
  ZK_ERROR_TYPE_MISMATCH = 5,
  ZK_ERROR_OUT_OF_RANGE = 6,
  ZK_ERROR_OVERFLOW = 7,
  ZK_ERROR_UNSUPPORTED = 8,
  ZK_ERROR_CONFLICT = 9,
  ZK_ERROR_INTERNAL = 10,
  ZK_ERROR_INVALID_PATH_FLAGS = 11,
  ZK_ERROR_UNSUPPORTED_PATH_COMMAND = 12
} zk_error;

typedef enum zk_buffer_type {
  ZK_BUFFER_U8 = 1,
  ZK_BUFFER_U16 = 2,
  ZK_BUFFER_I32 = 3,
  ZK_BUFFER_U32 = 4,
  ZK_BUFFER_F32 = 5,
  ZK_BUFFER_F64 = 6,
  ZK_BUFFER_I64 = 7,
  ZK_BUFFER_U64 = 8
} zk_buffer_type;

typedef enum zk_set_operation {
  ZK_SET_UNION = 1,
  ZK_SET_INTERSECTION = 2,
  ZK_SET_DIFFERENCE = 3,
  ZK_SET_SYMMETRIC_DIFFERENCE = 4,
  ZK_SET_COMPLEMENT = 5
} zk_set_operation;

typedef enum zk_measure_operation {
  ZK_MEASURE_UNION = 1,
  ZK_MEASURE_INTERSECTION = 2,
  ZK_MEASURE_DIFFERENCE = 3,
  ZK_MEASURE_SYMMETRIC_DIFFERENCE = 4,
  ZK_MEASURE_COMPLEMENT = 5
} zk_measure_operation;

typedef enum zk_matrix_type {
  ZK_MATRIX_F32 = 5,
  ZK_MATRIX_F64 = 6
} zk_matrix_type;

typedef enum zk_matrix_operation {
  ZK_MATRIX_TRANSPOSE = 1,
  ZK_MATRIX_ADD = 2,
  ZK_MATRIX_SUBTRACT = 3,
  ZK_MATRIX_HADAMARD = 4,
  ZK_MATRIX_DIVIDE = 5,
  ZK_MATRIX_MATMUL = 6,
  ZK_MATRIX_MATVEC = 7,
  ZK_MATRIX_DOT = 8,
  ZK_MATRIX_OUTER = 9,
  ZK_MATRIX_SUM = 10,
  ZK_MATRIX_MEAN = 11,
  ZK_MATRIX_NORM_L1 = 12,
  ZK_MATRIX_NORM_FROBENIUS = 13,
  ZK_MATRIX_TRACE = 14,
  ZK_MATRIX_DETERMINANT = 15,
  ZK_MATRIX_RANK = 16,
  ZK_MATRIX_INVERSE = 17,
  ZK_MATRIX_PSEUDOINVERSE = 18,
  ZK_MATRIX_SOLVE = 19,
  ZK_MATRIX_MINIMUM = 20,
  ZK_MATRIX_MAXIMUM = 21,
  ZK_MATRIX_LOGICAL_AND = 22,
  ZK_MATRIX_LOGICAL_OR = 23,
  ZK_MATRIX_LOGICAL_XOR = 24,
  ZK_MATRIX_EQUAL = 25,
  ZK_MATRIX_LESS_THAN = 26,
  ZK_MATRIX_REDUCE_MIN = 27,
  ZK_MATRIX_REDUCE_MAX = 28,
  ZK_MATRIX_SEEDED_RANDOM = 29,
  ZK_MATRIX_SAMPLE_INDICES = 30,
  ZK_MATRIX_STENCIL_ZERO = 31,
  ZK_MATRIX_STENCIL_CLAMP = 32,
  ZK_MATRIX_BILINEAR_INTERPOLATE = 33
} zk_matrix_operation;

typedef enum zk_matrix_factorization {
  ZK_MATRIX_LU = 1,
  ZK_MATRIX_QR = 2,
  ZK_MATRIX_CHOLESKY = 3,
  ZK_MATRIX_SVD = 4,
  ZK_MATRIX_SYMMETRIC_EIGEN = 5
} zk_matrix_factorization;

typedef enum zk_vector_operation {
  ZK_VECTOR_ADD = 1,
  ZK_VECTOR_SUBTRACT = 2,
  ZK_VECTOR_SCALE = 3,
  ZK_VECTOR_DOT = 4,
  ZK_VECTOR_CROSS = 5,
  ZK_VECTOR_LENGTH = 6,
  ZK_VECTOR_DISTANCE = 7,
  ZK_VECTOR_NORMALIZE = 8,
  ZK_VECTOR_PERPENDICULAR = 9,
  ZK_VECTOR_LERP = 10
} zk_vector_operation;

typedef enum zk_affine_operation {
  ZK_AFFINE_IDENTITY = 1,
  ZK_AFFINE_CREATE = 2,
  ZK_AFFINE_TRANSLATION = 3,
  ZK_AFFINE_SCALING = 4,
  ZK_AFFINE_ROTATION = 5,
  ZK_AFFINE_MULTIPLY = 6,
  ZK_AFFINE_INVERT = 7,
  ZK_AFFINE_APPLY = 8
} zk_affine_operation;

typedef enum zk_contour_span_operation {
  ZK_CONTOUR_NORMALIZE = 1,
  ZK_CONTOUR_INTERSECTION = 2,
  ZK_CONTOUR_UNION = 3,
  ZK_CONTOUR_DIFFERENCE = 4,
  ZK_CONTOUR_BORDER = 5,
  ZK_CONTOUR_OFFSET = 6
} zk_contour_span_operation;

typedef enum zk_path_command_type {
  ZK_PATH_MOVE = 1,
  ZK_PATH_LINE = 2,
  ZK_PATH_QUADRATIC = 3,
  ZK_PATH_CUBIC = 4,
  ZK_PATH_ARC = 5,
  ZK_PATH_CLOSE = 6
} zk_path_command_type;

typedef enum zk_fill_rule {
  ZK_FILL_EVENODD = 1,
  ZK_FILL_NONZERO = 2
} zk_fill_rule;

typedef enum zk_polygon_boolean_operation {
  ZK_POLYGON_UNION = 1,
  ZK_POLYGON_INTERSECTION = 2,
  ZK_POLYGON_DIFFERENCE = 3,
  ZK_POLYGON_XOR = 4
} zk_polygon_boolean_operation;

typedef enum zk_stroke_cap {
  ZK_STROKE_CAP_BUTT = 1,
  ZK_STROKE_CAP_SQUARE = 2,
  ZK_STROKE_CAP_ROUND = 3
} zk_stroke_cap;

typedef enum zk_stroke_join {
  ZK_STROKE_JOIN_MITER = 1,
  ZK_STROKE_JOIN_BEVEL = 2,
  ZK_STROKE_JOIN_ROUND = 3
} zk_stroke_join;

typedef enum zk_path_measure_operation {
  ZK_PATH_LENGTH = 1,
  ZK_PATH_BOUNDS = 2
} zk_path_measure_operation;

typedef enum zk_geometry_primitive_operation {
  ZK_GEOMETRY_BOUNDS_OF_POINTS = 1,
  ZK_GEOMETRY_BOUNDS_DISTANCE = 2,
  ZK_GEOMETRY_BOUNDS_INTERSECT = 3,
  ZK_GEOMETRY_BOUNDS_CIRCLE = 4,
  ZK_GEOMETRY_CLOSEST_POINT_SEGMENT = 5,
  ZK_GEOMETRY_DISTANCE_SEGMENT = 6,
  ZK_GEOMETRY_SEGMENT_LENGTH = 7,
  ZK_GEOMETRY_SEGMENT_TANGENT = 8,
  ZK_GEOMETRY_INTERSECT_SEGMENTS = 9,
  ZK_GEOMETRY_POLYLINE_LENGTH = 10,
  ZK_GEOMETRY_CLOSEST_POINT_POLYLINE = 11,
  ZK_GEOMETRY_POLYLINE_INTERSECTIONS = 12,
  ZK_GEOMETRY_QUADRATIC_AT = 13,
  ZK_GEOMETRY_CUBIC_AT = 14,
  ZK_GEOMETRY_QUADRATIC_TANGENT = 15,
  ZK_GEOMETRY_CUBIC_TANGENT = 16,
  ZK_GEOMETRY_CIRCLE_INTERSECTIONS = 17,
  ZK_GEOMETRY_CIRCLE_SEGMENT_INTERSECTIONS = 18,
  ZK_GEOMETRY_DISTANCE_CIRCLE_BOUNDARY = 19,
  ZK_GEOMETRY_CLOSEST_POINT_CIRCLE_BOUNDARY = 20,
  ZK_GEOMETRY_POINT_IN_RING = 21,
  ZK_GEOMETRY_RING_SIGNED_AREA = 22,
  ZK_GEOMETRY_ARC_PARAMETERS = 23,
  ZK_GEOMETRY_ARC_AT = 24,
  ZK_GEOMETRY_ARC_TANGENT = 25,
  ZK_GEOMETRY_NEAREST_SPATIAL = 26,
  ZK_GEOMETRY_NEAREST_POINTS = 27,
  ZK_GEOMETRY_GRID_PATH_SAMPLES = 28,
  ZK_GEOMETRY_GRID_PATH_WEIGHTED_SUM = 29,
  ZK_GEOMETRY_CIRCLE_POINTS = 30,
  ZK_GEOMETRY_CLIP_POLYGON_RECT = 31
} zk_geometry_primitive_operation;

typedef struct zk_contour_span {
  int32_t y;
  int32_t start;
  int32_t end;
} zk_contour_span;

enum { ZK_POPULATION_KEY_WIDTH = 4 };

/* Версия ABI и верхняя граница размера одного экземпляра ядра. */
uint32_t zk_abi_version(void);
uint32_t zk_memory_limit_bytes(void);
zk_execution_kind zk_execution_mode(void);
const char *zk_error_name(zk_error error);
const char *zk_error_message(zk_error error);

/* Переполнение возвращает ZK_ERROR_OVERFLOW и не записывает результат. */
zk_error zk_i32_add(int32_t left, int32_t right, int32_t *result);

/*
 * Буфер принадлежит ядру. Адрес действителен до освобождения дескриптора.
 * На WASM указатель является смещением в линейной памяти; в нативной сборке —
 * обычным адресом. Размер буфера не может превышать лимит ядра.
 */
zk_error zk_buffer_create(zk_buffer_type type, uint32_t count, zk_handle *result);
zk_error zk_buffer_release(zk_handle handle);
void *zk_buffer_data(zk_handle handle, uint32_t *byte_length, zk_error *error);
zk_error zk_buffer_size(zk_handle handle, uint32_t *byte_length);

/* Сумма читает заданный диапазон без создания копии и проверяет переполнение. */
zk_error zk_i32_sum(const int32_t *values, uint32_t count, int64_t *result);
zk_error zk_buffer_i32_sum(zk_handle handle, uint32_t start, uint32_t count, int64_t *result);

/*
 * Множества uint32 должны быть отсортированы и не содержать повторов.
 * Для дополнения right — явный универсум, результат равен right \ left.
 * Результат не меняется при ошибке; result_count обязателен.
 */
zk_error zk_set_binary(zk_set_operation operation,
                       const uint32_t *left, uint32_t left_count,
                       const uint32_t *right, uint32_t right_count,
                       uint32_t *output, uint32_t output_capacity,
                       uint32_t *result_count);

/*
 * Популяционные группы хранят совместные ключи четырёх измерений в плоском
 * массиве uint32 и массу в отдельном f64-массиве. Неверующая группа обозначает
 * веру значением UINT32_MAX. Повторные ключи явно суммируются.
 */
zk_error zk_measure_binary(zk_measure_operation operation,
                           const uint32_t *left_keys, const double *left_mass,
                           uint32_t left_count, const uint32_t *right_keys,
                           const double *right_mass, uint32_t right_count,
                           uint32_t *output_keys, double *output_mass,
                           uint32_t output_capacity, uint32_t *result_count);
zk_error zk_measure_sum(const uint32_t *keys, const double *mass,
                        uint32_t count, uint32_t *output_keys,
                        double *output_mass, uint32_t output_capacity,
                        uint32_t *result_count);
zk_error zk_measure_take_priority(
    const uint32_t *source_keys, const double *source_mass,
    uint32_t source_count, const uint32_t *reference_keys,
    const double *reference_mass, uint32_t reference_count,
    const uint32_t priority_order[3], double amount,
    uint32_t *selected_keys, double *selected_mass,
    uint32_t selected_capacity, uint32_t *selected_count,
    uint32_t *remaining_keys, double *remaining_mass,
    uint32_t remaining_capacity, uint32_t *remaining_count);
zk_error zk_measure_product(
    const uint32_t *left_keys, const double *left_mass, uint32_t left_count,
    const uint32_t *right_keys, const double *right_mass,
    uint32_t right_count, const uint32_t output_sources[4],
    double product_divisor, double multiplier, double final_divisor,
    uint32_t divide_by_right_total, uint32_t drop_zero_mass,
    uint32_t *output_keys, double *output_mass, uint32_t output_capacity,
    uint32_t *result_count);
/*
 * Декларативный запрос передаётся целиком и исполняется внутри C++-ядра.
 * При малой выходной ёмкости response_length возвращает требуемый размер;
 * частичный ответ не записывается.
 */
zk_error zk_algebra_query(const char *request, uint32_t request_length,
                          char *response, uint32_t response_capacity,
                          uint32_t *response_length);

/* Пакетные векторные и аффинные операции выполняются в бинарном ядре. */
zk_error zk_vector_execute(zk_vector_operation operation,
                           const double *input, uint32_t input_count,
                           double *output, uint32_t output_capacity,
                           uint32_t *output_count);
zk_error zk_affine_execute(zk_affine_operation operation,
                           const double *input, uint32_t input_count,
                           double *output, uint32_t output_capacity,
                           uint32_t *output_count);
zk_error zk_geometry_primitive_execute(
    zk_geometry_primitive_operation operation, const double *input,
    uint32_t input_count, double *output, uint32_t output_capacity,
    uint32_t *output_count);
/*
 * SVG-команды передаются типами и массивом с фиксированным шагом из восьми
 * double. Координаты команды занимают первые 2, 4, 6 или 7 ячеек по её типу.
 */
zk_error zk_geometry_path_parse(
    const char *svg, uint32_t svg_length, uint32_t *command_types,
    uint32_t type_capacity, double *command_values,
    uint32_t value_capacity, uint32_t *command_count);
zk_error zk_geometry_path_serialize(
    const uint32_t *command_types, const double *command_values,
    uint32_t command_count, char *output, uint32_t output_capacity,
    uint32_t *output_length);
zk_error zk_geometry_path_transform(
    const uint32_t *command_types, const double *command_values,
    uint32_t command_count, const double affine[6], double tolerance,
    uint32_t *output_types, uint32_t type_capacity, double *output_values,
    uint32_t value_capacity, uint32_t *output_count);
zk_error zk_geometry_path_measure(
    zk_path_measure_operation operation, const uint32_t *command_types,
    const double *command_values, uint32_t command_count, double tolerance,
    double *output, uint32_t output_capacity, uint32_t *output_count);
zk_error zk_geometry_path_flatten(
    const uint32_t *command_types, const double *command_values,
    uint32_t command_count, double tolerance, double *output_xy,
    uint32_t point_capacity, uint32_t *output_subpath_offsets,
    uint32_t subpath_capacity, uint8_t *output_closed,
    uint32_t closed_capacity, uint32_t *point_count,
    uint32_t *subpath_count);
zk_error zk_geometry_path_intersections(
    const uint32_t *first_types, const double *first_values,
    uint32_t first_count, const uint32_t *second_types,
    const double *second_values, uint32_t second_count, double tolerance,
    double *output_xy, uint32_t point_capacity, uint32_t *point_count);

/*
 * Контуры кодируются координатами xy, смещениями колец и смещениями
 * полигонов. Все смещения начинаются с нуля и заканчиваются числом элементов.
 */
zk_error zk_geometry_path_to_polygons(
    const uint32_t *command_types, const double *command_values,
    uint32_t command_count, double tolerance, zk_fill_rule fill_rule,
    double *output_xy, uint32_t point_capacity,
    uint32_t *output_ring_offsets, uint32_t ring_capacity,
    uint32_t *output_polygon_offsets, uint32_t polygon_capacity,
    uint32_t *point_count, uint32_t *ring_count, uint32_t *polygon_count);
zk_error zk_geometry_polygon_boolean(
    zk_polygon_boolean_operation operation, const double *input_xy,
    uint32_t input_point_count, const uint32_t *input_ring_offsets,
    uint32_t input_ring_count, const uint32_t *input_polygon_offsets,
    uint32_t input_polygon_count, const uint32_t *input_geometry_offsets,
    uint32_t input_geometry_count, double *output_xy, uint32_t point_capacity,
    uint32_t *output_ring_offsets, uint32_t ring_capacity,
    uint32_t *output_polygon_offsets, uint32_t polygon_capacity,
    uint32_t *point_count, uint32_t *ring_count, uint32_t *polygon_count);
zk_error zk_geometry_stroke_polyline(
    const double *input_xy, uint32_t point_count, double width,
    double tolerance, zk_stroke_cap cap, zk_stroke_join join,
    double miter_limit, uint8_t closed, double *output_xy,
    uint32_t point_capacity, uint32_t *output_ring_offsets,
    uint32_t ring_capacity, uint32_t *output_polygon_offsets,
    uint32_t polygon_capacity, uint32_t *output_point_count,
    uint32_t *output_ring_count, uint32_t *output_polygon_count);

/*
 * Контурные строки задаются полуоткрытыми интервалами [start, end).
 * Входы для бинарных операций должны быть нормализованы; результат всегда
 * упорядочен, обрезан размерами растра и не содержит пересечений.
 */
zk_error zk_contour_spans_execute(
    zk_contour_span_operation operation,
    const zk_contour_span *left, uint32_t left_count,
    const zk_contour_span *right, uint32_t right_count,
    uint32_t width, uint32_t height, double distance,
    zk_contour_span *output, uint32_t output_capacity,
    uint32_t *output_count);
zk_error zk_contour_replace_region(
    const zk_contour_span *source, uint32_t source_count,
    const zk_contour_span *replacement, uint32_t replacement_count,
    int32_t x0, int32_t y0, int32_t x1, int32_t y1,
    uint32_t width, uint32_t height, zk_contour_span *output,
    uint32_t output_capacity, uint32_t *output_count);
zk_error zk_contour_rasterize_polygons(
    const double *coordinates, uint32_t point_count,
    const uint32_t *ring_offsets, uint32_t ring_count,
    const uint32_t *polygon_offsets, uint32_t polygon_count,
    uint32_t width, uint32_t height, zk_contour_span *output,
    uint32_t output_capacity, uint32_t *output_count);
zk_error zk_contour_link_rings(
    const uint32_t *codes, uint32_t code_count, uint32_t width,
    uint32_t height, int32_t *output_xy, uint32_t point_capacity,
    uint32_t *output_ring_offsets, uint32_t ring_capacity,
    uint32_t *output_point_count, uint32_t *output_ring_count);
zk_error zk_contour_trace_scalar_chunk(
    const double *values, const uint8_t *include, uint32_t local_pixel_count,
    uint32_t source_row_start, uint32_t process_row_start,
    uint32_t process_row_end, uint32_t width, uint32_t height,
    uint8_t has_skip, double skip_value, double *output_values,
    uint32_t value_capacity, uint32_t *output_offsets,
    uint32_t offset_capacity, uint32_t *output_codes,
    uint32_t code_capacity, uint32_t *output_group_count,
    uint32_t *output_code_count);
zk_error zk_contour_trace_composition_chunk(
    const uint16_t *compositions, uint32_t local_pixel_count,
    const uint32_t *composition_offsets, uint32_t composition_count,
    const uint32_t *entity_ids, const double *shares, uint32_t entry_count,
    uint32_t source_row_start, uint32_t process_row_start,
    uint32_t process_row_end, uint32_t width, uint32_t height,
    uint32_t *output_entities, double *output_shares,
    uint32_t group_capacity, uint32_t *output_offsets,
    uint32_t offset_capacity, uint32_t *output_codes,
    uint32_t code_capacity, uint32_t *output_group_count,
    uint32_t *output_code_count);
/* Группирует интервалы по точным тройкам влажности, температуры и дренажа. */
zk_error zk_contour_classify_spans(
    const uint8_t *humidity, const float *temperature,
    const uint8_t *drainage, const zk_contour_span *spans,
    uint32_t span_count, uint32_t width, uint32_t height,
    double *output, uint32_t output_capacity, uint32_t *output_count);

/*
 * Плотные матрицы хранятся построчно; вычисления принимают только f32/f64.
 * Для операций используются построчные двумерные представления; вектор —
 * матрица с одной строкой или одним столбцом. Пакетные вызовы идут через
 * отдельную функцию ниже.
 */
zk_error zk_matrix_execute(zk_matrix_operation operation, zk_matrix_type type,
                           const void *left, uint32_t left_rows,
                           uint32_t left_columns, const void *right,
                           uint32_t right_rows, uint32_t right_columns,
                           void *output, uint32_t output_capacity,
                           uint32_t *output_rows, uint32_t *output_columns);

/*
 * factorize возвращает до трёх построчных выходов. Неиспользуемый выход можно
 * передать как null с нулевой ёмкостью; все указатели размеров обязательны.
 * Размеры записываются только при успехе. LU: P, L, U; SVD: U, диагональ
 * сингулярных значений, V; Eigen: собственные значения и векторы симметричной
 * матрицы. Невырожденность и формы проверяются явно.
 */
zk_error zk_matrix_factorize(
    zk_matrix_factorization factorization, zk_matrix_type type,
    const void *input, uint32_t rows, uint32_t columns,
    void *output_a, uint32_t capacity_a, uint32_t *rows_a, uint32_t *columns_a,
    void *output_b, uint32_t capacity_b, uint32_t *rows_b, uint32_t *columns_b,
    void *output_c, uint32_t capacity_c, uint32_t *rows_c, uint32_t *columns_c);

zk_error zk_matrix_batch_matmul(
    zk_matrix_type type, const void *left, uint32_t left_batches,
    uint32_t left_rows, uint32_t left_columns, const void *right,
    uint32_t right_batches, uint32_t right_rows, uint32_t right_columns,
    void *output, uint32_t output_capacity);
zk_error zk_matrix_label_components(
    const uint8_t *mask, uint32_t width, uint32_t height,
    int32_t *labels, uint32_t output_capacity,
    uint32_t *component_count);

/* CSR: row_offsets имеет rows + 1 элементов; столбцы отсортированы в строке. */
zk_error zk_sparse_matvec(zk_matrix_type type, uint32_t rows, uint32_t columns,
                          const uint32_t *row_offsets,
                          const uint32_t *column_indices, const void *values,
                          uint32_t nonzero_count, const void *vector,
                          void *output, uint32_t output_capacity);
zk_error zk_sparse_matmul(zk_matrix_type type, uint32_t left_rows,
                          uint32_t inner, const uint32_t *row_offsets,
                          const uint32_t *column_indices, const void *values,
                          uint32_t nonzero_count, const void *right,
                          uint32_t right_columns, void *output,
                          uint32_t output_capacity);

#ifdef __cplusplus
}
#endif

#endif
