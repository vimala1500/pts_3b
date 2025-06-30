use wasm_bindgen::prelude::*;
use js_sys; // Now correctly imported via Cargo.toml

// --- Existing ADF P-Value Lookup Table ---
// KEEP ALL YOUR EXISTING ADF_P_VALUE_LOOKUP DATA HERE.
// I'm providing a placeholder for brevity, but make sure it's complete from your file.
const ADF_P_VALUE_LOOKUP: &[[f64; 2]] = &[
    [-4.98402287309096,0.00002],
    [-4.95836394213414,0.00004],
    [-4.92149631526284,0.00006],
    [-4.88686813085182,0.00008],
    [-4.79387782325644,0.0001],
    [-4.77479943392409,0.00012],
    [-4.75043987730202,0.00014],
    [-4.74723750103735,0.00016],
    [-4.73821861063937,0.00018],
    [-4.72735886630162,0.0002],
    // ... (rest of your ADF_P_VALUE_LOOKUP data) ...
];

// --- Helper functions for matrix operations in Rust ---

/// Transposes a matrix.
/// Assumes a non-empty, rectangular matrix.
fn transpose_matrix(matrix: &[Vec<f64>]) -> Vec<Vec<f64>> {
    if matrix.is_empty() || matrix[0].is_empty() {
        return Vec::new();
    }
    let rows = matrix.len();
    let cols = matrix[0].len();

    let mut result = vec![vec![0.0; rows]; cols];
    for i in 0..rows {
        for j in 0..cols {
            result[j][i] = matrix[i][j];
        }
    }
    result
}

/// Multiplies two matrices A and B.
/// Assumes compatible dimensions (colsA == rowsB).
fn multiply_matrices(a: &[Vec<f64>], b: &[Vec<f64>]) -> Vec<Vec<f64>> {
    let rows_a = a.len();
    let cols_a = a[0].len();
    let rows_b = b.len();
    let cols_b = b[0].len();

    if cols_a != rows_b {
        panic!("Matrix dimensions mismatch for multiplication.");
    }

    let mut result = vec![vec![0.0; cols_b]; rows_a];

    for i in 0..rows_a {
        for j in 0..cols_b {
            for k in 0..cols_a {
                result[i][j] += a[i][k] * b[k][j];
            }
        }
    }
    result
}

/// Inverts a square matrix using Gaussian elimination.
/// Returns a Result to indicate success or failure (e.g., singular matrix).
fn invert_matrix(matrix: &[Vec<f64>]) -> Result<Vec<Vec<f64>>, JsValue> {
    let n = matrix.len();
    if n == 0 || matrix[0].len() != n {
        return Err(JsValue::from_str("Matrix must be square and non-empty."));
    }

    // Create an augmented matrix [A | I]
    let mut augmented_matrix: Vec<Vec<f64>> = matrix
        .iter()
        .enumerate()
        .map(|(i, row)| {
            let mut new_row: Vec<f64> = row.clone();
            for j in 0..n {
                new_row.push(if i == j { 1.0 } else { 0.0 });
            }
            new_row
        })
        .collect();

    // Forward elimination
    for i in 0..n {
        // Find pivot
        let mut pivot_row = i;
        for k in i + 1..n {
            if augmented_matrix[k][i].abs() > augmented_matrix[pivot_row][i].abs() {
                pivot_row = k;
            }
        }
        augmented_matrix.swap(i, pivot_row);

        let pivot = augmented_matrix[i][i];
        if pivot.abs() < 1e-12 { // Check for near-zero pivot (singular matrix)
            return Err(JsValue::from_str("Matrix is singular or ill-conditioned, cannot invert."));
        }

        // Normalize row
        for j in i..2 * n {
            augmented_matrix[i][j] /= pivot;
        }

        // Eliminate other rows
        for k in 0..n {
            if k != i {
                let factor = augmented_matrix[k][i];
                for j in i..2 * n {
                    augmented_matrix[k][j] -= factor * augmented_matrix[i][j];
                }
            }
        }
    }

    // Extract inverse matrix
    let inverse: Vec<Vec<f64>> = augmented_matrix
        .into_iter()
        .map(|row| row[n..].to_vec())
        .collect();

    Ok(inverse)
}

// --- Regression Results Struct for WASM ---
// Fields are now private, with public getter methods for WASM binding
#[wasm_bindgen]
pub struct RegressionResults {
    coefficients: Vec<f64>,
    std_errors: Vec<f64>,
    ssr: f64,
    nobs: usize,
    nparams: usize,
}

#[wasm_bindgen]
impl RegressionResults {
    // These methods expose the private fields to JavaScript.
    // Box<[f64]> is used for efficient transfer of Vec<f64> to JavaScript's Float64Array.
    #[wasm_bindgen(getter)]
    pub fn coefficients(&self) -> Box<[f64]> {
        self.coefficients.clone().into_boxed_slice()
    }

    #[wasm_bindgen(getter, js_name = stdErrors)]
    pub fn std_errors(&self) -> Box<[f64]> {
        self.std_errors.clone().into_boxed_slice()
    }

    #[wasm_bindgen(getter)]
    pub fn ssr(&self) -> f64 {
        self.ssr
    }

    #[wasm_bindgen(getter)]
    pub fn nobs(&self) -> usize {
        self.nobs
    }

    #[wasm_bindgen(getter)]
    pub fn nparams(&self) -> usize {
        self.nparams
    }
}


// --- Main WASM function for Multi-Linear Regression ---

/// Runs a multi-linear regression using Ordinary Least Squares (OLS).
/// y_values: The dependent variable (1D array).
/// x_flat_data: The independent variables flattened into a 1D array (row-major order).
/// num_rows: Number of rows in the original X matrix.
/// num_cols: Number of columns in the original X matrix.
#[wasm_bindgen]
pub fn run_multi_linear_regression_wasm(
    y_values: Vec<f64>,
    x_flat_data: Vec<f64>,
    num_rows: usize,
    num_cols: usize,
) -> Result<RegressionResults, JsValue> {
    let num_observations = y_values.len();
    if num_observations == 0 {
        return Err(JsValue::from_str("Y values cannot be empty."));
    }
    if num_rows == 0 || num_cols == 0 {
        return Err(JsValue::from_str("X matrix dimensions cannot be zero."));
    }
    if x_flat_data.len() != num_rows * num_cols {
        return Err(JsValue::from_str("Flat X data size does not match dimensions."));
    }
    if num_rows != num_observations {
        return Err(JsValue::from_str("X matrix must have the same number of rows as Y values."));
    }

    // Reconstruct x_matrix from flat data
    let mut x_matrix: Vec<Vec<f64>> = Vec::with_capacity(num_rows);
    for i in 0..num_rows {
        let start_idx = i * num_cols;
        let end_idx = start_idx + num_cols;
        x_matrix.push(x_flat_data[start_idx..end_idx].to_vec());
    }

    // Build X transpose * X
    let xt = transpose_matrix(&x_matrix);
    let xtx = multiply_matrices(&xt, &x_matrix);

    // Build X transpose * Y
    let mut xt_y = vec![0.0; num_cols]; // num_cols is num_predictors
    for i in 0..num_cols {
        for k in 0..num_observations {
            xt_y[i] += xt[i][k] * y_values[k];
        }
    }

    let xtx_inv = match invert_matrix(&xtx) {
        Ok(inv) => inv,
        Err(e) => return Err(JsValue::from_str(&format!("Error inverting XtX matrix: {}", e.as_string().unwrap_or_else(|| "unknown error".to_string())))),
    };

    // Calculate coefficients (beta_hat = (XtX)^-1 * XtY)
    let mut coefficients = vec![0.0; num_cols];
    for i in 0..num_cols {
        for j in 0..num_cols {
            coefficients[i] += xtx_inv[i][j] * xt_y[j];
        }
    }

    // Calculate residuals
    let mut residuals = Vec::with_capacity(num_observations);
    for i in 0..num_observations {
        let mut predicted_y = 0.0;
        for j in 0..num_cols {
            predicted_y += coefficients[j] * x_matrix[i][j];
        }
        residuals.push(y_values[i] - predicted_y);
    }

    // Calculate Residual Sum of Squares (SSR)
    let ssr = residuals.iter().map(|r| r * r).sum();

    // Calculate Mean Squared Error (MSE)
    let mse = if num_observations > num_cols {
        ssr / (num_observations - num_cols) as f64
    } else {
        f64::INFINITY // Not enough observations for a meaningful MSE
    };


    // Calculate standard errors of coefficients
    let mut std_errors = vec![0.0; num_cols];
    for i in 0..num_cols {
        if mse.is_finite() && xtx_inv[i][i] >= 0.0 { // Ensure non-negative under root
            std_errors[i] = (mse * xtx_inv[i][i]).sqrt();
        } else {
            std_errors[i] = f64::INFINITY; // Indicate error or undefined
        }
    }

    Ok(RegressionResults {
        coefficients,
        std_errors,
        ssr,
        nobs: num_observations,
        nparams: num_cols, // num_cols is the number of parameters/predictors
    })
}


// --- Your existing `AdfResult` struct and `interpolate_p_value` function ---
// Fix: Made critical_values private and added a getter method
#[wasm_bindgen]
pub struct AdfResult {
    pub statistic: f64,
    pub p_value: f64,
    critical_values: js_sys::Object, // Made private
    #[wasm_bindgen(js_name = isStationary)]
    pub is_stationary: bool,
}

#[wasm_bindgen]
impl AdfResult {
    // New getter for critical_values
    #[wasm_bindgen(getter, js_name = criticalValues)]
    pub fn critical_values(&self) -> js_sys::Object {
        self.critical_values.clone() // Clone to return ownership, allows JS to use it
    }
}


// Linear interpolation function
fn interpolate_p_value(test_statistic: f64) -> f64 {
    if test_statistic <= ADF_P_VALUE_LOOKUP[0][0] {
        return ADF_P_VALUE_LOOKUP[0][1];
    }
    if test_statistic >= ADF_P_VALUE_LOOKUP[ADF_P_VALUE_LOOKUP.len() - 1][0] {
        return ADF_P_VALUE_LOOKUP[ADF_P_VALUE_LOOKUP.len() - 1][1];
    }

    let mut low = 0;
    let mut high = ADF_P_VALUE_LOOKUP.len() - 1;
    let mut idx = 0;

    // Find the interval using binary search
    while low <= high {
        let mid = low + (high - low) / 2;
        if ADF_P_VALUE_LOOKUP[mid][0] == test_statistic {
            return ADF_P_VALUE_LOOKUP[mid][1];
        }
        if ADF_P_VALUE_LOOKUP[mid][0] < test_statistic {
            idx = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    let x1 = ADF_P_VALUE_LOOKUP[idx][0];
    let y1 = ADF_P_VALUE_LOOKUP[idx][1];
    let x2 = ADF_P_VALUE_LOOKUP[idx + 1][0];
    let y2 = ADF_P_VALUE_LOOKUP[idx + 1][1];

    if x2 == x1 { // Avoid division by zero if two points have the same x value
        return y1;
    }

    y1 + (test_statistic - x1) * (y2 - y1) / (x2 - x1)
}

// --- Your existing `get_adf_p_value_and_stationarity` function ---
#[wasm_bindgen]
pub fn get_adf_p_value_and_stationarity(test_statistic: f64) -> AdfResult {
    let critical_1_percent = -3.43;
    let critical_5_percent = -2.86;
    let critical_10_percent = -2.57;

    let p_value = interpolate_p_value(test_statistic);

    let is_stationary = p_value < 0.05;

    let critical_values_js = js_sys::Object::new();
    js_sys::Reflect::set(&critical_values_js, &JsValue::from_str("1%"), &JsValue::from_f64(critical_1_percent)).unwrap();
    js_sys::Reflect::set(&critical_values_js, &JsValue::from_str("5%"), &JsValue::from_f64(critical_5_percent)).unwrap();
    js_sys::Reflect::set(&critical_values_js, &JsValue::from_str("10%"), &JsValue::from_f64(critical_10_percent)).unwrap();

    AdfResult {
        statistic: test_statistic,
        p_value,
        critical_values: critical_values_js, // No .into() needed here, just assign the Object
        is_stationary,
    }
}
