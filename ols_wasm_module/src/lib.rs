// src/lib.rs
use wasm_bindgen::prelude::*;
use ndarray::{Array2, Array1, Axis};
use ndarray_linalg::Solve; // Provides .solve() for linear equations, or .inv() for inverse

#[wasm_bindgen]
pub struct RegressionResults {
    pub coefficients: Vec<f64>,
    pub std_errors: Vec<f64>,
    pub ssr: f64,
    pub nobs: usize,
    pub nparams: usize,
}

#[wasm_bindgen]
pub fn run_multi_linear_regression_wasm(
    y_values_js: &[f64],
    x_matrix_js: &[f64],
    num_observations: usize,
    num_predictors: usize,
) -> Result<RegressionResults, JsValue> {
    // Convert JS arrays to ndarray types
    // Note: This assumes x_matrix_js is flattened (row-major order)
    let y = Array1::from_vec(y_values_js.to_vec());
    let x = Array2::from_shape_vec((num_observations, num_predictors), x_matrix_js.to_vec())
        .map_err(|e| JsValue::from_str(&format!("Failed to create X matrix: {}", e)))?;

    // Perform OLS using ndarray-linalg (solves X'X * beta = X'Y)
    // XtX = X.t() * X
    let xt = x.t();
    let xtx = xt.dot(&x);

    // XtY = X.t() * Y
    let xty = xt.dot(&y);

    // Solve for coefficients: beta = (XtX)^-1 * XtY
    // Using .solve() is generally more numerically stable than explicit inversion (.inv())
    // because it avoids explicitly calculating the inverse.
    let coefficients = xtx.solve_into(xty)
        .map_err(|e| JsValue::from_str(&format!("Failed to solve OLS: {}", e)))?;

    // Calculate predicted Y values
    let predicted_y = x.dot(&coefficients);

    // Calculate residuals
    let residuals = &y - &predicted_y;

    // Calculate Residual Sum of Squares (SSR)
    let ssr: f64 = residuals.mapv(|x| x * x).sum();

    // Calculate Mean Squared Error (MSE)
    let mse = ssr / ((num_observations - num_predictors) as f64);
    if mse.is_nan() || mse.is_infinite() || mse < 0.0 {
        return Err(JsValue::from_str("MSE calculation resulted in invalid value."));
    }

    // Calculate standard errors of coefficients
    // We need the diagonal elements of (XtX)^-1
    let xtx_inv = xtx.inv() // Explicit inversion for std errors
        .map_err(|e| JsValue::from_str(&format!("Failed to invert XtX for std errors: {}", e)))?;

    let mut std_errors = Vec::with_capacity(num_predictors);
    for i in 0..num_predictors {
        let diag_val = xtx_inv[(i, i)];
        if diag_val.is_nan() || diag_val.is_infinite() || diag_val < 0.0 {
            std_errors.push(f64::INFINITY); // Indicate invalid standard error
        } else {
            std_errors.push(mse.sqrt() * diag_val.sqrt());
        }
    }

    Ok(RegressionResults {
        coefficients: coefficients.to_vec(),
        std_errors,
        ssr,
        nobs: num_observations,
        nparams: num_predictors,
    })
}
