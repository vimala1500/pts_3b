use wasm_bindgen::prelude::*;
use js_sys;

#[wasm_bindgen]
pub struct AdfResult {
    pub statistic: f64,
    pub p_value: f64,
    pub is_stationary: bool,
    #[wasm_bindgen(js_name = criticalValues)]
    critical_values: JsValue, // Make private and provide getter
}

// Pre-computed lookup table for ADF p-values based on test statistic
// This is a simplified example. Real ADF critical values depend on sample size.
// Values are approximate for demonstration.
const ADF_P_VALUE_LOOKUP: &[(f64, f64)] = &[
    (-4.0, 0.01),
    (-3.5, 0.025),
    (-3.0, 0.05),
    (-2.5, 0.10),
    (-2.0, 0.20),
    (-1.5, 0.50),
    (-1.0, 0.75),
    (0.0, 0.99),
];

fn interpolate_p_value(test_statistic: f64) -> f64 {
    if test_statistic <= ADF_P_VALUE_LOOKUP[0].0 {
        return ADF_P_VALUE_LOOKUP[0].1;
    }
    if test_statistic >= ADF_P_VALUE_LOOKUP[ADF_P_VALUE_LOOKUP.len() - 1].0 {
        return ADF_P_VALUE_LOOKUP[ADF_P_VALUE_LOOKUP.len() - 1].1;
    }

    for i in 0..ADF_P_VALUE_LOOKUP.len() - 1 {
        let (x1, y1) = ADF_P_VALUE_LOOKUP[i];
        let (x2, y2) = ADF_P_VALUE_LOOKUP[i + 1];

        if test_statistic >= x1 && test_statistic <= x2 {
            // Linear interpolation
            return y1 + (test_statistic - x1) * (y2 - y1) / (x2 - x1);
        }
    }
    0.5 // Should not be reached
}

#[wasm_bindgen]
impl AdfResult {
    // Getter for critical_values
    #[wasm_bindgen(getter)]
    pub fn critical_values(&self) -> JsValue {
        self.critical_values.clone()
    }
}

#[wasm_bindgen]
pub fn get_adf_p_value_and_stationarity(test_statistic: f64) -> AdfResult {
    let p_value = interpolate_p_value(test_statistic);

    // Simplified critical values for demonstration.
    // In a real application, these would depend on sample size and model type.
    let critical_values = js_sys::Object::new();
    js_sys::Reflect::set(&critical_values, &JsValue::from_str("1%"), &JsValue::from_f64(-3.43)).unwrap();
    js_sys::Reflect::set(&critical_values, &JsValue::from_str("5%"), &JsValue::from_f64(-2.86)).unwrap();
    js_sys::Reflect::set(&critical_values, &JsValue::from_str("10%"), &JsValue::from_f64(-2.57)).unwrap();

    let is_stationary = test_statistic < -2.86; // Using 5% critical value as a simple threshold

    AdfResult {
        statistic: test_statistic,
        p_value,
        is_stationary,
        critical_values: critical_values.into(),
    }
}
