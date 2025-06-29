/* tslint:disable */
/* eslint-disable */
/**
 * Performs Ordinary Least Squares (OLS) regression.
 *
 * Takes flattened feature data `x_data`, target data `y_data`, and the number of features
 * per observation `num_features`.
 *
 * `x_data` should be a flat array where each `num_features` consecutive elements
 * represent one observation's features.
 *
 * Returns a `Box<[f64]>` containing the regression coefficients, where the first
 * coefficient is the intercept, followed by the coefficients for each feature.
 *
 * # Arguments
 * * `x_data` - A slice of f64 representing the flattened feature data.
 * * `y_data` - A slice of f64 representing the target data.
 * * `num_features` - The number of features (independent variables) per observation.
 *
 * # Errors
 * Returns a `JsValue` error if:
 * - `x_data` length is not a multiple of `num_features`.
 * - Number of observations in `x_data` and `y_data` do not match.
 * - The matrix (X^T * X) is singular and cannot be inverted.
 */
export function ols(x_data: Float64Array, y_data: Float64Array, num_features: number): Float64Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly ols: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
  readonly __wbindgen_export_0: WebAssembly.Table;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
