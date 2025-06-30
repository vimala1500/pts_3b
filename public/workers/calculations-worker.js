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

// Helper function to calculate Z-Score
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

// Helper function to calculate Correlation
const calculateCorrelation = (data1, data2) => {
    if (data1.length === 0 || data2.length === 0 || data1.length !== data2.length) {
        return 0; // Cannot calculate correlation
    }

    const n = data1.length;
    const sum1 = data1.reduce((a, b) => a + b, 0);
    const sum2 = data2.reduce((a, b) => a + b, 0);
    const sum1Sq = data1.reduce((a, b) => a + b * b, 0);
    const sum2Sq = data2.reduce((a, b) => a + b * b, 0);
    const pSum = data1.reduce((s, x, i) => s + x * data2[i], 0);

    const num = pSum - (sum1 * sum2 / n);
    const den = Math.sqrt((sum1Sq - (sum1 * sum1 / n)) * (sum2Sq - (sum2 * sum2 / n)));

    if (den === 0) {
        return 0; // Avoid division by zero
    }
    return num / den;
};

// Placeholder for Half-Life calculation (requires more complex regression, beyond scope for direct worker implementation now)
const calculateHalfLife = (data) => {
    // In a real scenario, this would involve regressing diff(data) on data(-1)
    // and then half-life = -ln(2) / ln(beta)
    return { halfLife: 0, isValid: false };
};

// Placeholder for Hurst Exponent calculation
const calculateHurstExponent = (data) => {
    // Requires specialized algorithm, placeholder for now
    return 0.5; // Default to random walk
};

// Placeholder for Practical Trade Half-Life
const calculatePracticalTradeHalfLife = (zScores, entry, exit) => {
    // This would simulate trades and measure time, placeholder for now
    return { tradeCycleLength: 0, successRate: 0, isValid: false };
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

    // Adjusted maxLagsToTest for ADF to avoid insufficient data for regression
    // The regression requires (Y.length >= k_params)
    // k_params = 2 (constant + lag 0) + currentLags
    // Y.length = n - 1 - effectiveStartIndex (which is currentLags)
    // So, (n - 1 - currentLags) >= (2 + currentLags)
    // n - 1 >= 2 + 2 * currentLags
    // n - 3 >= 2 * currentLags
    // (n - 3) / 2 >= currentLags
    // Max lags is floor((n - 3) / 2)
    maxLagsToTest = Math.min(12, Math.floor((n - 3) / 2));
    if (maxLagsToTest < minLagsToTest) maxLagsToTest = minLagsToTest;

    self.postMessage({ type: "debug", message: `[ADF] Lags to test: min=${minLagsToTest}, max=${maxLagsToTest}` });

    let minCriterionValue = Number.POSITIVE_INFINITY;
    let optimalTestStatistic = 0;

    for (let currentLags = minLagsToTest; currentLags <= maxLagsToTest; currentLags++) {
        self.postMessage({ type: "debug", message: `[ADF] Testing currentLags: ${currentLags}` });

        const diffData = data.slice(1).map((val, i) => val - data[i]);
        // The effective start index for Y and X is also impacted by `currentLags` for the lagged diff terms
        const effectiveStartIndex = currentLags; // for dY and lagged dY terms

        if (diffData.length <= effectiveStartIndex) {
            self.postMessage({ type: "debug", message: `[ADF] Skipping lags ${currentLags}: Not enough differenced data after lags. diffData length: ${diffData.length}, effectiveStartIndex: ${effectiveStartIndex}` });
            continue;
        }

        const Y = []; // Dependent variable (diff(data))
        for (let i = effectiveStartIndex; i < diffData.length; i++) {
            Y.push(diffData[i]);
        }
        self.postMessage({ type: "debug", message: `[ADF] Y length for lags ${currentLags}: ${Y.length}` });

        const X_matrix_rows = []; // Independent variables (constant, lagged data, lagged diffs)
        for (let i = effectiveStartIndex; i < data.length - 1; i++) { // data.length - 1 because diffData is one shorter than data
            const row = [1, data[i]]; // Constant and lagged data level
            for (let j = 1; j <= currentLags; j++) {
                row.push(diffData[i - j]); // Lagged diff terms
            }
            X_matrix_rows.push(row);
        }
        self.postMessage({ type: "debug", message: `[ADF] X_matrix_rows length for lags ${currentLags}: ${X_matrix_rows.length}` });

        // k_params: 1 (constant) + 1 (lagged level) + currentLags (lagged diffs)
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
            console.error(`[ADF] ERROR in WASM regression for lags ${currentLags}:`, e); // More direct error log
            self.postMessage({ type: "error", message: `[ADF] WASM Regression Error for lags ${currentLags}: ${e.message || String(e)}` });
            continue;
        }

        // Access results via PROPERTIES as per adf_test.js
        const SSR = regressionResults.ssr;
        const N_obs = regressionResults.nobs;
        const K_params = regressionResults.nparams;
        const coefficients = regressionResults.coefficients;
        const stdErrors = regressionResults.stdErrors;

        self.postMessage({ type: "debug", message: `[ADF] Results for lags ${currentLags}: SSR=${SSR}, N_obs=${N_obs}, K_params=${K_params}, Coeffs length=${coefficients.length}, StdErrors length=${stdErrors.length}` });

        let currentAIC;
        // Check for invalid values before Math.log
        if (N_obs > 0 && SSR > 0 && isFinite(SSR)) { // Ensure SSR is positive for log and finite
            currentAIC = N_obs * Math.log(SSR / N_obs) + 2 * K_params;
        } else {
            self.postMessage({ type: "warn", message: `[ADF] Invalid SSR or N_obs for AIC calculation at lags ${currentLags}. SSR: ${SSR}, N_obs: ${N_obs}. Setting AIC to Infinity.` });
            currentAIC = Number.POSITIVE_INFINITY;
        }
        self.postMessage({ type: "debug", message: `[ADF] AIC for lags ${currentLags}: ${currentAIC}` });


        if (currentAIC < minCriterionValue) {
            minCriterionValue = currentAIC;
            // The beta coefficient for ADF is typically the second coefficient (index 1) which corresponds to the lagged level term
            if (coefficients.length > 1 && stdErrors.length > 1) {
                const beta_coefficient = coefficients[1];
                const beta_std_error = stdErrors[1];

                if (beta_std_error !== 0 && isFinite(beta_std_error)) {
                    optimalTestStatistic = beta_coefficient / beta_std_error;
                    self.postMessage({ type: "debug", message: `[ADF] New optimal test statistic found for lags ${currentLags}: ${optimalTestStatistic}` });
                } else {
                    optimalTestStatistic = 0;
                    self.postMessage({ type: "warn", message: `[ADF] Standard error for beta coefficient (index 1) is zero or infinite for lags ${currentLags}. Test statistic set to 0.` });
                }
            } else {
                self.postMessage({ type: "warn", message: `[ADF] Coefficients or StdErrors array too short for beta at lags ${currentLags}. Lengths: Coeffs=${coefficients.length}, StdErrors=${stdErrors.length}. Test statistic set to 0.` });
                optimalTestStatistic = 0;
            }
        }
    }
    self.postMessage({ type: "debug", message: `[ADF] Finished calculateAdfTestStatistic. Final optimalTestStatistic: ${optimalTestStatistic}` });
    return optimalTestStatistic;
};

// Main message handler for the worker
self.onmessage = async (event) => {
  self.postMessage({ type: "debug", message: `[Worker Main] Message received, type: ${event.data.type}` });

  const { type, payload } = event.data;

  if (type === "runAnalysis") {
    self.postMessage({ type: "debug", message: "[Worker] Received runAnalysis message. Starting analysis..." });
    const { stockAPrices, stockBPrices, modelType, windowSize, entryThreshold, exitThreshold } = payload; // Destructure all expected payload items

    let analysisData = null;
    let error = null;

    try {
      await initializeWasm(); // Already called globally, but safe to await again.

      let spreads = [];
      let ratios = []; // For ratio model
      let distances = []; // For euclidean model
      let alphas = []; // For OLS/Kalman
      let hedgeRatios = []; // For OLS/Kalman
      let dates = []; // Store dates for charts/table
      let normalizedPricesA = []; // For Euclidean normalization visualization
      let normalizedPricesB = []; // For Euclidean normalization visualization

      const minLength = Math.min(stockAPrices.length, stockBPrices.length);

      // Populate dates
      for (let i = 0; i < minLength; i++) {
        dates.push(stockAPrices[i].date); // Assuming dates are consistent
      }


      self.postMessage({ type: "debug", message: `[Worker] Model type: ${modelType}` });

      if (modelType === "ols") {
        if (!stockAPrices || stockAPrices.length === 0 || !stockBPrices || stockBPrices.length === 0 || stockAPrices.length !== stockBPrices.length) {
            throw new Error("Invalid or empty stock price data for OLS spread calculation. Ensure both stocks have data of equal length.");
        }
        self.postMessage({ type: "debug", message: `[Worker] Starting OLS spread calculation. Stock A length: ${stockAPrices.length}, Stock B length: ${stockBPrices.length}` });

        // Perform OLS regression over the full data set to get overall alpha/beta for historical spreads
        const Y_ols = stockAPrices.slice(0, minLength).map(p => p.close);
        const X_ols_rows = stockBPrices.slice(0, minLength).map(p => [1, p.close]); // Add constant (intercept)

        if (X_ols_rows.length === 0) {
            throw new Error("Insufficient data for OLS regression to calculate spreads (X_ols_rows empty).");
        }

        const X_ols_flat = X_ols_rows.flat();
        const X_ols_num_rows = X_ols_rows.length;
        const X_ols_num_cols = X_ols_rows[0].length; // Should be 2 (constant + stockB price)

        self.postMessage({ type: "debug", message: `[Worker] Calling WASM for OLS regression to get alpha/beta. Y_ols length: ${Y_ols.length}, X_flat length: ${X_ols_flat.length}, X_rows: ${X_ols_num_rows}, X_cols: ${X_ols_num_cols}` });

        try {
            const olsRegressionResults = await run_multi_linear_regression_wasm(
                Y_ols, X_ols_flat, X_ols_num_rows, X_ols_num_cols
            );

            // Access as properties, not methods
            const overallAlpha = olsRegressionResults.coefficients[0];
            const overallBeta = olsRegressionResults.coefficients[1];

            // Calculate historical spreads using the overall alpha and beta
            spreads = stockAPrices.slice(0, minLength).map((priceA, i) => {
                const priceB = stockBPrices[i].close;
                const spread = priceA.close - (overallBeta * priceB + overallAlpha);
                // Also store individual alpha/beta for each point if needed, for rolling calculations etc.
                // For simplicity, we're using overall, but for rolling, you'd re-run OLS in a loop.
                alphas.push(overallAlpha);
                hedgeRatios.push(overallBeta);
                return spread;
            });
            self.postMessage({ type: "debug", message: `[Worker] OLS spread calculated. Overall Beta: ${overallBeta}, Overall Alpha: ${overallAlpha}, Spreads length: ${spreads.length}` });
        } catch (e) {
            console.error("[Worker] Error during OLS regression WASM call:", e); // Direct error log
            throw new Error(`Failed to calculate OLS spread using WASM: ${e.message || String(e)}`);
        }
      } else if (modelType === "ratio") {
         self.postMessage({ type: "debug", message: `[Worker] Starting Ratio calculation.` });
         if (!stockAPrices || stockAPrices.length === 0 || !stockBPrices || stockBPrices.length === 0) {
             throw new Error("No price data for Ratio calculation.");
         }
         ratios = stockAPrices.slice(0, minLength).map((priceA, i) => {
             const priceB = stockBPrices[i].close;
             return priceB !== 0 ? priceA.close / priceB : 0; // Avoid division by zero
         });
         spreads = ratios; // Z-score is calculated on ratios for this model
         self.postMessage({ type: "debug", message: `[Worker] Ratio spreads calculated. Length: ${ratios.length}` });
      } else if (modelType === "euclidean") {
         self.postMessage({ type: "debug", message: `[Worker] Starting Euclidean calculation.` });
         if (!stockAPrices || stockAPrices.length === 0 || !stockBPrices || stockBPrices.length === 0) {
             throw new Error("No price data for Euclidean calculation.");
         }
         // For Euclidean, we typically normalize prices first
         const pricesAOnly = stockAPrices.map(p => p.close);
         const pricesBOnly = stockBPrices.map(p => p.close);

         const { mean: meanA, stdDev: stdDevA } = calculateZScore(pricesAOnly);
         const { mean: meanB, stdDev: stdDevB } = calculateZScore(pricesBOnly);

         normalizedPricesA = pricesAOnly.map(p => stdDevA !== 0 ? (p - meanA) / stdDevA : 0);
         normalizedPricesB = pricesBOnly.map(p => stdDevB !== 0 ? (p - meanB) / stdDevB : 0);

         distances = normalizedPricesA.slice(0, minLength).map((normA, i) => {
             const normB = normalizedPricesB[i];
             return Math.sqrt(Math.pow(normA - normB, 2));
         });
         spreads = distances; // Z-score is calculated on distances for this model
         self.postMessage({ type: "debug", message: `[Worker] Euclidean distances calculated. Length: ${distances.length}` });
      } else if (modelType === "kalman") {
          // Kalman filter implementation (simplified placeholder for now)
          // This would be much more complex, involving state updates (alpha, beta, covariance matrix)
          // For now, we'll use OLS-like spreads but acknowledge it's not a full Kalman.
          self.postMessage({ type: "warn", message: "Kalman filter spread calculation is a placeholder; using static OLS for now." });

          const Y_kalman = stockAPrices.slice(0, minLength).map(p => p.close);
          const X_kalman_rows = stockBPrices.slice(0, minLength).map(p => [1, p.close]);

          if (X_kalman_rows.length === 0) {
              throw new Error("Insufficient data for Kalman regression (OLS placeholder).");
          }

          const X_kalman_flat = X_kalman_rows.flat();
          const X_kalman_num_rows = X_kalman_rows.length;
          const X_kalman_num_cols = X_kalman_rows[0].length;

          const kalmanRegressionResults = await run_multi_linear_regression_wasm(
              Y_kalman, X_kalman_flat, X_kalman_num_rows, X_kalman_num_cols
          );

          const kalmanAlpha = kalmanRegressionResults.coefficients[0];
          const kalmanBeta = kalmanRegressionResults.coefficients[1];

          spreads = stockAPrices.slice(0, minLength).map((priceA, i) => {
              const priceB = stockBPrices[i].close;
              alphas.push(kalmanAlpha);
              hedgeRatios.push(kalmanBeta);
              return priceA.close - (kalmanBeta * priceB + kalmanAlpha);
          });
          self.postMessage({ type: "debug", message: `[Worker] Kalman (OLS placeholder) spreads calculated. Length: ${spreads.length}` });

      } else {
         throw new Error(`Unsupported model type: ${modelType}`);
      }

      // Calculate correlation after spreads/ratios/distances are determined
      const pricesA_values = stockAPrices.slice(0, minLength).map(p => p.close);
      const pricesB_values = stockBPrices.slice(0, minLength).map(p => p.close);
      const correlation = calculateCorrelation(pricesA_values, pricesB_values);


      self.postMessage({ type: "debug", message: `[Worker] Calling calculateAdfTestStatistic with spreads length: ${spreads.length}` });
      const adfTestStatistic = await calculateAdfTestStatistic(spreads, modelType);
      self.postMessage({ type: "debug", message: `[Worker] Calculated ADF Test Statistic: ${adfTestStatistic}` });

      const adfResults = get_adf_p_value_and_stationarity(adfTestStatistic);
      self.postMessage({ type: "debug", message: `[Worker] ADF Results: ${JSON.stringify(adfResults)}` });

      // Calculate other statistics needed for analysisData
      const { mean: meanValue, stdDev: stdDevValue, zScores } = calculateZScore(spreads); // Renamed to avoid conflict with top-level 'mean' if used
      self.postMessage({ type: "debug", message: `[Worker] Calculated Z-Scores and stats. Mean: ${meanValue}, StdDev: ${stdDevValue}, Z-Scores length: ${zScores.length}` });

      const halfLifeResult = calculateHalfLife(spreads); // Placeholder
      const hurstExponent = calculateHurstExponent(spreads); // Placeholder
      const practicalTradeHalfLife = calculatePracticalTradeHalfLife(zScores, entryThreshold, exitThreshold); // Placeholder

      // Construct analysisData with 'statistics' nested object
      analysisData = {
        modelType: modelType,
        // Clone relevant data arrays to ensure they are plain JS arrays for transfer
        stockAPrices: stockAPrices.slice(0, minLength).map(p => ({ date: p.date, close: p.close })),
        stockBPrices: stockBPrices.slice(0, minLength).map(p => ({ date: p.date, close: p.close })),
        dates: [...dates], // Clone array
        spreads: [...spreads], // Clone array
        ratios: [...ratios], // Clone array
        distances: [...distances], // Clone array
        normalizedPricesA: [...normalizedPricesA], // Clone array
        normalizedPricesB: [...normalizedPricesB], // Clone array
        alphas: [...alphas], // Clone array
        hedgeRatios: [...hedgeRatios], // Clone array
        zScores: [...zScores], // Clone array

        statistics: { // <--- All stats are now nested here!
          correlation: correlation,
          meanRatio: modelType === "ratio" ? meanValue : undefined,
          stdDevRatio: modelType === "ratio" ? stdDevValue : undefined,
          meanSpread: (modelType === "ols" || modelType === "kalman") ? meanValue : undefined,
          stdDevSpread: (modelType === "ols" || modelType === "kalman") ? stdDevValue : undefined,
          meanDistance: modelType === "euclidean" ? meanValue : undefined,
          stdDevDistance: modelType === "euclidean" ? stdDevValue : undefined,
          minZScore: zScores.length > 0 ? Math.min(...zScores) : 0,
          maxZScore: zScores.length > 0 ? Math.max(...zScores) : 0,
          adfResults: {
            statistic: adfResults.statistic,
            pValue: adfResults.p_value,
            criticalValues: Object.assign({}, adfResults.criticalValues), // Explicitly clone the criticalValues object
            isStationary: adfResults.isStationary,
          },
          halfLife: halfLifeResult.halfLife,
          halfLifeValid: halfLifeResult.isValid,
          hurstExponent: hurstExponent,
          practicalTradeHalfLife: practicalTradeHalfLife,
          modelType: modelType, // Redundant but harmless, for easy access in UI
        },
        tableData: dates.map((date, i) => ({ // Populate tableData
            date: date,
            priceA: stockAPrices[i].close,
            priceB: stockBPrices[i].close,
            normalizedA: normalizedPricesA[i], // Will be undefined for non-euclidean
            normalizedB: normalizedPricesB[i], // Will be undefined for non-euclidean
            alpha: alphas[i], // Will be undefined for non-OLS/Kalman
            hedgeRatio: hedgeRatios[i], // Will be undefined for non-OLS/Kalman
            ratio: ratios[i], // Will be undefined for non-ratio
            distance: distances[i], // Will be undefined for non-euclidean
            spread: spreads[i], // Will be used for OLS/Kalman or overall for ratio/euclidean
            zScore: zScores[i],
            halfLife: halfLifeResult.halfLife, // Placeholder for row-specific half-life
        })),
        chartData: { // Populate chartData - these will be populated with actual rolling calculations in a later step
          rollingMean: spreads.map(() => meanValue), // Placeholder: use overall mean for now
          rollingUpperBand1: spreads.map(s => meanValue + stdDevValue), // Placeholder: +1 std dev
          rollingLowerBand1: spreads.map(s => meanValue - stdDevValue), // Placeholder: -1 std dev
          rollingUpperBand2: spreads.map(s => meanValue + 2 * stdDevValue), // Placeholder: +2 std dev
          rollingLowerBand2: spreads.map(s => meanValue - 2 * stdDevValue), // Placeholder: -2 std dev
        },
      }
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
