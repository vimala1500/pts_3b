use wasm_bindgen::prelude::*;
use nalgebra::{DMatrix, DVector};

/// Performs Ordinary Least Squares (OLS) regression.
///
/// Takes flattened feature data `x_data`, target data `y_data`, and the number of features
/// per observation `num_features`.
///
/// `x_data` should be a flat array where each `num_features` consecutive elements
/// represent one observation's features.
///
/// Returns a `Box<[f64]>` containing the regression coefficients, where the first
/// coefficient is the intercept, followed by the coefficients for each feature.
///
/// # Arguments
/// * `x_data` - A slice of f64 representing the flattened feature data.
/// * `y_data` - A slice of f64 representing the target data.
/// * `num_features` - The number of features (independent variables) per observation.
///
/// # Errors
/// Returns a `JsValue` error if:
/// - `x_data` length is not a multiple of `num_features`.
/// - Number of observations in `x_data` and `y_data` do not match.
/// - The matrix (X^T * X) is singular and cannot be inverted.
#[wasm_bindgen]
pub fn ols(x_data: &[f64], y_data: &[f64], num_features: usize) -> Result<Box<[f64]>, JsValue> {
    if x_data.len() % num_features != 0 {
        return Err(JsValue::from_str("x_data length must be a multiple of num_features"));
    }
    let num_observations = x_data.len() / num_features;
    if num_observations != y_data.len() {
        return Err(JsValue::from_str("Number of observations in x_data and y_data must match"));
    }

    let num_coeffs = num_features + 1; // +1 for the intercept

    // Create the design matrix X
    // X will have dimensions (num_observations x num_coeffs)
    // First column is all ones for the intercept
    // Subsequent columns are the features from x_data
    let mut x_matrix_data = Vec::with_capacity(num_observations * num_coeffs);
    for i in 0..num_observations {
        x_matrix_data.push(1.0); // Intercept term
        for j in 0..num_features {
            x_matrix_data.push(x_data[i * num_features + j]);
        }
    }
    let x = DMatrix::from_vec(num_observations, num_coeffs, x_matrix_data);

    // Create the dependent variable vector y
    let y = DVector::from_vec(y_data.to_vec());

    // Calculate X^T * X
    let xt_x = x.transpose() * &x;

    // Calculate (X^T * X)^-1
    let xt_x_inv = xt_x.try_inverse()
        .ok_or_else(|| JsValue::from_str("Matrix (X^T * X) is singular and cannot be inverted."))?;

    // Calculate X^T * y
    let xt_y = x.transpose() * y;

    // Calculate coefficients beta = (X^T * X)^-1 * X^T * y
    let beta = xt_x_inv * xt_y;

    Ok(beta.as_slice().to_vec().into_boxed_slice())
}
