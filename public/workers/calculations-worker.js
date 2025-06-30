// public/workers/calculations-worker.js

// Import the WASM module and its initialization function
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
    self.postMessage({ type: "debug", message: `[ADF] Starting calculateAdfTestStatistic for modelType: ${modelType}, data length: ${data.length}` });
    const n = data.length;
    if (n < 5) {
        self.postMessage({ type: "debug", message: `[ADF] Not enough data for ADF test (${n} points). Minimum 5 required. Returning 0.` });
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
    self.postMessage({ type: "debug", message: `[ADF] Lags to test: min=${minLagsToTest}, max=${maxLagsToTest}` });

    let minCriterionValue = Number.POSITIVE_INFINITY;
    let optimalTestStatistic = 0;

    for (let currentLags = minLagsToTest; currentLags <= maxLagsToTest; currentLags++) {
        self.postMessage({ type: "debug", message: `[ADF] Testing currentLags: ${currentLags}` });

        const diffData = data.slice(1).map((val, i) => val - data[i]);
        const effectiveStartIndex = currentLags;

        if (diffData.length <= effectiveStartIndex) {
            self.postMessage({ type: "debug", message: `[ADF] Skipping lags ${currentLags}: Not enough differenced data after lags. diffData length: ${diffData.length}, effectiveStartIndex: ${effectiveStartIndex}` });
            continue;
        }

        const Y = [];
        for (let i = effectiveStartIndex; i < diffData.length; i++) {
            Y.push(diffData[i]);
        }
        self.postMessage({ type: "debug", message: `[ADF] Y length for lags ${currentLags}: ${Y.length}` });


        const X_matrix_rows = [];
        for (let i = effectiveStartIndex; i < diffData.length; i++) {
            const row = [1, data[i]];
            for (let j = 1; j <= currentLags; j++) {
                row.push(diffData[i - j]);
            }
            X_matrix_rows.push(row);
        }
        self.postMessage({ type: "debug", message: `[ADF] X_matrix_rows length for lags ${currentLags}: ${X_matrix_rows.length}` });


        const k_params = 1 + 1 + currentLags;

        if (Y.length < k_params || X_matrix_rows.length === 0 || X_matrix_rows[0].length !== k_params) {
            self.postMessage({ type: "debug", message: `[ADF] Skipping lags ${currentLags}: Insufficient data or mismatched dimensions for regression. Y.length=${Y.length}, X_rows.length=${X_matrix_rows.length}, X_rows[0].length=${X_matrix_rows[0] ? X_matrix_rows[0].length : 'N/A'}, k_params=${k_params}` });
            continue;
        }

        // Prepare X_matrix for WASM: Flatten it
        const X_matrix_flat = X_matrix_rows.flat();
        const num_rows = X_matrix_rows.length;
        const num_cols = X_matrix_rows[0].length; // k_params
        self.postMessage({ type: "debug", message: `[ADF] Calling WASM regression for lags ${currentLags}. Y length=${Y.length}, X_flat_length=${X_matrix_flat.length}, num_rows=${num_rows}, num_cols=${num_cols}` });

        let regressionResults;
        try {
            await initializeWasm(); // Ensure WASM is initialized (already checked at worker start)
            regressionResults = await run_multi_linear_regression_wasm(Y, X_matrix_flat, num_rows, num_cols);
            self.postMessage({ type: "debug", message: `[ADF] WASM regression completed for lags ${currentLags}.` });
        } catch (e) {
            self.postMessage({ type: "error", message: `[ADF] WASM Regression Error for lags ${currentLags}: ${e.message || String(e)}` });
            continue;
        }

        // Access results via getter methods as per updated Rust struct
        const SSR = regressionResults.ssr();
        const N_obs = regressionResults.nobs();
        const K_params = regressionResults.nparams();
        const coefficients = regressionResults.coefficients();
        const stdErrors = regressionResults.stdErrors();

        self.postMessage({ type: "debug", message: `[ADF] Results for lags ${currentLags}: SSR=${SSR}, N_obs=${N_obs}, K_params=${K_params}, Coeffs=${JSON.stringify(Array.from(coefficients))}, StdErrors=${JSON.stringify(Array.from(stdErrors))}` });


        let currentAIC;
        if (N_obs > 0 && SSR >= 0) {
            currentAIC = N_obs * Math.log(SSR / N_obs) + 2 * K_params;
        } else {
            currentAIC = Number.POSITIVE_INFINITY;
        }
        self.postMessage({ type: "debug", message: `[ADF] AIC for lags ${currentLags}: ${currentAIC}` });


        if (currentAIC < minCriterionValue) {
            minCriterionValue = currentAIC;
            const beta_coefficient = coefficients[1];
            const beta_std_error = stdErrors[1];

            if (beta_std_error !== 0 && isFinite(beta_std_error)) {
                optimalTestStatistic = beta_coefficient / beta_std_error;
                self.postMessage({ type: "debug", message: `[ADF] New optimal test statistic found for lags ${currentLags}: ${optimalTestStatistic}` });
            } else {
                optimalTestStatistic = 0;
                self.postMessage({ type: "warn", message: `[ADF] Standard error for beta coefficient is zero or infinite for lags ${currentLags}. Test statistic set to 0.` });
            }
        }
    }
    self.postMessage({ type: "debug", message: `[ADF] Finished calculateAdfTestStatistic. Final optimalTestStatistic: ${optimalTestStatistic}` });
    return optimalTestStatistic;
};

// Main message handler for the worker
self.onmessage = async (event) => {
  // --- ADDED THIS LINE FOR INITIAL DEBUGGING ---
  self.postMessage({ type: "debug", message: `[Worker Main] Message received, type: ${event.data.type}` });
  // --- END ADDED LINE ---

  const { type, payload } = event.data;

  if (type === "startAnalysis") {
    self.postMessage({ type: "debug", message: "[Worker] Received startAnalysis message." });
    const { stockAPrices, stockBPrices, modelType, windowSize } = payload;

    let analysisData = null;
    let error = null;

    try {
      await initializeWasm(); // Already called globally, but safe to await again.

      let spreads = [];
      self.postMessage({ type: "debug", message: `[Worker] Model type: ${modelType}` });

      if (modelType === "ols") {
        if (!stockAPrices || stockAPrices.length === 0 || !stockBPrices || stockBPrices.length === 0 || stockAPrices.length !== stockBPrices.length) {
            throw new Error("Invalid or empty stock price data for OLS spread calculation. Ensure both stocks have data of equal length.");
        }
        self.postMessage({ type: "debug", message: `[Worker] Starting OLS spread calculation. Stock A length: ${stockAPrices.length}, Stock B length: ${stockBPrices.length}` });

        const minLength = Math.min(stockAPrices.length, stockBPrices.length);
        const Y_ols = stockAPrices.slice(0, minLength).map(p => p.close);
        const X_ols_rows = stockBPrices.slice(0, minLength).map(p => [1, p.close]);

        if (X_ols_rows.length === 0) {
            throw new Error("Insufficient data for OLS regression to calculate spreads (X_ols_rows empty).");
        }

        const X_ols_flat = X_ols_rows.flat();
        const X_ols_num_rows = X_ols_rows.length;
        const X_ols_num_cols = X_ols_rows[0].length;

        self.postMessage({ type: "debug", message: `[Worker] Calling WASM for OLS regression to get alpha/beta. Y_ols length: ${Y_ols.length}, X_flat length: ${X_ols_flat.length}, X_rows: ${X_ols_num_rows}, X_cols: ${X_ols_num_cols}` });

        try {
            const olsRegressionResults = await run_multi_linear_regression_wasm(
                Y_ols, X_ols_flat, X_ols_num_rows, X_ols_num_cols
            );

            const alpha = olsRegressionResults.coefficients()[0];
            const beta = olsRegressionResults.coefficients()[1];

            spreads = stockAPrices.slice(0, minLength).map((priceA, i) => {
                const priceB = stockBPrices[i].close;
                return priceA.close - (beta * priceB + alpha);
            });
            self.postMessage({ type: "debug", message: `[Worker] OLS spread calculated. Beta: ${beta}, Alpha: ${alpha}, Spreads length: ${spreads.length}` });
        } catch (e) {
            console.error("[Worker] Error during OLS regression WASM call:", e);
            throw new Error(`Failed to calculate OLS spread using WASM: ${e.message || String(e)}`);
        }
      } else {
         self.postMessage({ type: "debug", message: `[Worker] Starting non-OLS spread calculation for model: ${modelType}` });
         if (!stockAPrices || stockAPrices.length === 0 || !stockBPrices || stockBPrices.length === 0) { // Fix: Changed stockBPPrices to stockBPrices
             throw new Error("No price data for non-OLS calculation.");
         }
         const minLength = Math.min(stockAPrices.length, stockBPrices.length);
         if (modelType === "ratio") {
             spreads = stockAPrices.slice(0, minLength).map((priceA, i) => {
                 const priceB = stockBPrices[i].close;
                 return priceB !== 0 ? priceA.close / priceB : 0;
             });
             self.postMessage({ type: "debug", message: `[Worker] Ratio spreads calculated. Length: ${spreads.length}` });
         } else if (modelType === "euclidean") {
             spreads = stockAPrices.slice(0, minLength).map((priceA, i) => {
                 const priceB = stockBPrices[i].close;
                 return Math.sqrt(Math.pow(priceA.close - priceB, 2));
             });
             self.postMessage({ type: "debug", message: `[Worker] Euclidean spreads calculated. Length: ${spreads.length}` });
         } else if (modelType === "kalman") {
             throw new Error("Kalman filter spread calculation not implemented in this example.");
         } else {
             throw new Error(`Unsupported model type: ${modelType}`);
         }
      }

      self.postMessage({ type: "debug", message: `[Worker] Calling calculateAdfTestStatistic with spreads length: ${spreads.length}` });
      const adfTestStatistic = await calculateAdfTestStatistic(spreads, modelType);
      self.postMessage({ type: "debug", message: `[Worker] Calculated ADF Test Statistic: ${adfTestStatistic}` });

      const adfResults = get_adf_p_value_and_stationarity(adfTestStatistic);
      self.postMessage({ type: "debug", message: `[Worker] ADF Results: ${JSON.stringify(adfResults)}` });

      // Calculate other statistics needed for analysisData
      const { mean, stdDev, zScores } = calculateZScore(spreads);
      self.postMessage({ type: "debug", message: `[Worker] Calculated Z-Scores and stats. Mean: ${mean}, StdDev: ${stdDev}, Z-Scores length: ${zScores.length}` });


      analysisData = {
        modelType: modelType,
        adfResults: {
          statistic: adfResults.statistic,
          pValue: adfResults.p_value,
          criticalValues: adfResults.critical_values(), // Access via getter
          isStationary: adfResults.is_stationary,
        },
        correlation: 0,
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
      self.postMessage({ type: "debug", message: "[Worker] Analysis data structured successfully." });

    } catch (e) {
      console.error("[Worker] Main analysis error caught:", e);
      error = e.message || "An unknown error occurred during analysis.";
    } finally {
      self.postMessage({ type: "analysisComplete", analysisData, error });
      self.postMessage({ type: "debug", message: "[Worker] Final analysisComplete message posted." });
    }
  }
};
