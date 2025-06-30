// public/workers/calculations-worker.js

// Import the WASM module and its initialization function
// Adjust the path based on where you placed your 'pkg' folder in the public directory
// Make sure to include run_multi_linear_regression_wasm in the import list
import init, { get_adf_p_value_and_stationarity, run_multi_linear_regression_wasm } from "../wasm/adf_test.js"

let wasmInitialized = false

// Initialize WASM module once
async function initializeWasm() {
  if (!wasmInitialized) {
    self.postMessage({ type: "debug", message: "Initializing WASM..." })
    try {
      await init()
      wasmInitialized = true
      self.postMessage({ type: "debug", message: "WASM initialized." })
    } catch (e) {
      console.error("Failed to initialize WASM:", e)
      self.postMessage({
        type: "error",
        message: `WASM initialization error: ${e instanceof Error ? e.message : String(e)}`,
      })
      throw e
    }
  }
}

// Call this immediately to start loading WASM in the background
initializeWasm()

// Helper function to calculate Z-Score (re-included as it might be needed by other parts)
const calculateZScore = (data) => {
  if (data.length === 0) return { mean: 0, stdDev: 0, zScores: [] };

  const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
  // Calculate sample standard deviation (N-1)
  const stdDev = Math.sqrt(
    data.map((val) => (val - mean) ** 2).reduce((sum, sq) => sum + sq, 0) / (data.length > 1 ? data.length - 1 : 1)
  );

  const zScores = data.map((val) => (stdDev === 0 ? 0 : (val - mean) / stdDev));
  return { mean, stdDev, zScores };
};


// ADF Test Statistic Calculation with Optimal Lag Selection
// This function will now use the WASM-based linear regression
const calculateAdfTestStatistic = async (data, modelType) => {
    const n = data.length;
    if (n < 5) {
        self.postMessage({ type: "debug", message: `Not enough data for ADF test (${n} points). Minimum 5 required.` });
        return 0;
    }

    let minLagsToTest = 0;
    let maxLagsToTest = 0;

    if (modelType === "ols") {
        minLagsToTest = 0;
        maxLagsToTest = Math.min(12, Math.floor((n - 3) / 2));
        if (maxLagsToTest < minLagsToTest) maxLagsToTest = minLagsToTest;
    } else {
        minLagsToTest = 0;
        maxLagsToTest = 1;
    }

    let minCriterionValue = Number.POSITIVE_INFINITY;
    let optimalTestStatistic = 0;

    for (let currentLags = minLagsToTest; currentLags <= maxLagsToTest; currentLags++) {
        const diffData = data.slice(1).map((val, i) => val - data[i]);

        const effectiveStartIndex = currentLags;

        if (diffData.length <= effectiveStartIndex) {
            self.postMessage({ type: "debug", message: `Skipping lags ${currentLags}: Not enough differenced data after lags.` });
            continue;
        }

        const Y = [];
        for (let i = effectiveStartIndex; i < diffData.length; i++) {
            Y.push(diffData[i]);
        }

        const X_matrix_rows = []; // Will store rows of the X matrix
        for (let i = effectiveStartIndex; i < diffData.length; i++) {
            const row = [1, data[i]]; // Constant and lagged level (y_{t-1})
            for (let j = 1; j <= currentLags; j++) {
                row.push(diffData[i - j]);
            }
            X_matrix_rows.push(row);
        }

        const k_params = 1 + 1 + currentLags; // 1 (constant) + 1 (lagged level) + currentLags (lagged differences)

        if (Y.length < k_params || X_matrix_rows.length === 0 || X_matrix_rows[0].length !== k_params) {
            self.postMessage({ type: "debug", message: `Skipping lags ${currentLags}: Insufficient data or mismatched dimensions for regression. Y.length=${Y.length}, k_params=${k_params}` });
            continue;
        }

        // --- Prepare X_matrix for WASM: Flatten it ---
        const X_matrix_flat = X_matrix_rows.flat(); // Flatten the 2D array into a 1D array
        const num_rows = X_matrix_rows.length;
        const num_cols = X_matrix_rows[0].length; // k_params

        // --- CALL THE WASM FUNCTION FOR LINEAR REGRESSION ---
        let regressionResults;
        try {
            await initializeWasm();
            // Pass flattened X data along with its original dimensions
            regressionResults = await run_multi_linear_regression_wasm(Y, X_matrix_flat, num_rows, num_cols);
        } catch (e) {
            self.postMessage({ type: "error", message: `WASM Regression Error for lags ${currentLags}: ${e.message || String(e)}` });
            continue;
        }

        // Access results via getter methods as per updated Rust struct
        const SSR = regressionResults.ssr();
        const N_obs = regressionResults.nobs();
        const K_params = regressionResults.nparams();
        const coefficients = regressionResults.coefficients(); // This returns a Float64Array
        const stdErrors = regressionResults.stdErrors();       // This returns a Float64Array

        let currentAIC;
        if (N_obs > 0 && SSR >= 0) {
            currentAIC = N_obs * Math.log(SSR / N_obs) + 2 * K_params;
        } else {
            currentAIC = Number.POSITIVE_INFINITY;
        }

        if (currentAIC < minCriterionValue) {
            minCriterionValue = currentAIC;
            const beta_coefficient = coefficients[1]; // Access using index
            const beta_std_error = stdErrors[1];     // Access using index

            if (beta_std_error !== 0 && isFinite(beta_std_error)) {
                optimalTestStatistic = beta_coefficient / beta_std_error;
            } else {
                optimalTestStatistic = 0;
                self.postMessage({ type: "warn", message: `Standard error for beta coefficient is zero or infinite for lags ${currentLags}. Test statistic set to 0.` });
            }
        }
    }
    return optimalTestStatistic;
};

// Main message handler for the worker
self.onmessage = async (event) => {
  const { type, payload } = event.data;

  if (type === "startAnalysis") {
    const { stockAPrices, stockBPrices, modelType, windowSize } = payload;

    let analysisData = null;
    let error = null;

    try {
      await initializeWasm(); // Ensure WASM is initialized before starting analysis

      let spreads = [];
      if (modelType === "ols") {
        if (stockAPrices.length !== stockBPrices.length || stockAPrices.length === 0) {
            throw new Error("Stock A and B prices must have the same length and be non-empty for OLS spread calculation.");
        }

        const minLength = Math.min(stockAPrices.length, stockBPrices.length);
        const Y_ols = stockAPrices.slice(0, minLength).map(p => p.close);
        const X_ols_rows = stockBPrices.slice(0, minLength).map(p => [1, p.close]); // [intercept, stockB_price]

        if (X_ols_rows.length === 0) {
            throw new Error("Insufficient data for OLS regression to calculate spreads.");
        }

        // Flatten X_ols_rows for WASM
        const X_ols_flat = X_ols_rows.flat();
        const X_ols_num_rows = X_ols_rows.length;
        const X_ols_num_cols = X_ols_rows[0].length; // Should be 2 ([1, priceB])

        try {
            // Run the OLS regression using WASM to get alpha and beta
            const olsRegressionResults = await run_multi_linear_regression_wasm(
                Y_ols, X_ols_flat, X_ols_num_rows, X_ols_num_cols
            );

            const alpha = olsRegressionResults.coefficients()[0]; // Intercept
            const beta = olsRegressionResults.coefficients()[1]; // Coefficient for Stock B

            spreads = stockAPrices.slice(0, minLength).map((priceA, i) => {
                const priceB = stockBPrices[i].close;
                return priceA.close - (beta * priceB + alpha);
            });
            self.postMessage({ type: "debug", message: `OLS beta: ${beta}, alpha: ${alpha}` });
        } catch (e) {
            console.error("Error calculating OLS spread:", e);
            throw new Error(`Failed to calculate OLS spread using WASM: ${e.message || String(e)}`);
        }
      } else {
         self.postMessage({ type: "debug", message: `Model type ${modelType} requested. Spread calculation for OLS only.` });
         if (stockAPrices.length === 0 || stockBPrices.length === 0) {
             throw new Error("No price data for non-OLS calculation.");
         }
         const minLength = Math.min(stockAPrices.length, stockBPrices.length);
         if (modelType === "ratio") {
             spreads = stockAPrices.slice(0, minLength).map((priceA, i) => {
                 const priceB = stockBPrices[i].close;
                 return priceB !== 0 ? priceA.close / priceB : 0;
             });
         } else if (modelType === "euclidean") {
             spreads = stockAPrices.slice(0, minLength).map((priceA, i) => {
                 const priceB = stockBPrices[i].close;
                 return Math.sqrt(Math.pow(priceA.close - priceB, 2));
             });
         } else if (modelType === "kalman") {
             throw new Error("Kalman filter spread calculation not implemented in this example.");
         } else {
             throw new Error(`Unsupported model type: ${modelType}`);
         }
      }

      const adfTestStatistic = await calculateAdfTestStatistic(spreads, modelType);
      self.postMessage({ type: "debug", message: `Calculated ADF Test Statistic: ${adfTestStatistic}` });

      const adfResults = get_adf_p_value_and_stationarity(adfTestStatistic);
      self.postMessage({ type: "debug", message: `ADF Results: ${JSON.stringify(adfResults)}` });

      // Calculate other statistics needed for analysisData
      const { mean, stdDev, zScores } = calculateZScore(spreads);

      analysisData = {
        modelType: modelType,
        adfResults: {
          statistic: adfResults.statistic,
          pValue: adfResults.p_value,
          criticalValues: adfResults.critical_values,
          isStationary: adfResults.is_stationary,
        },
        correlation: 0, // You would calculate correlation separately if needed
        meanRatio: modelType === "ratio" ? mean : undefined,
        stdDevRatio: modelType === "ratio" ? stdDev : undefined,
        meanSpread: (modelType === "ols" || modelType === "kalman") ? mean : undefined,
        stdDevSpread: (modelType === "ols" || modelType === "kalman") ? stdDev : undefined,
        meanDistance: modelType === "euclidean" ? mean : undefined,
        stdDevDistance: modelType === "euclidean" ? stdDev : undefined,
        minZScore: zScores.length > 0 ? Math.min(...zScores) : 0,
        maxZScore: zScores.length > 0 ? Math.max(...zScores) : 0,
        halfLife: 0,
        halfLifeValid: false,
        hurstExponent: 0,
        practicalTradeHalfLife: 0,
        tableData: [],
        chartData: {
          rollingMean: [],
          rollingUpperBand1: [],
          rollingLowerBand1: [],
          rollingUpperBand2: [],
          rollingLowerBand2: [],
        },
        zScores: zScores,
      };

    } catch (e) {
      console.error("Error in calculations worker:", e);
      error = e.message || "An unknown error occurred during analysis.";
    } finally {
      self.postMessage({ type: "analysisComplete", analysisData, error });
    }
  }
};
