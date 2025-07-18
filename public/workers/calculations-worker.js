// public/workers/calculations-worker-ENHANCED.js

// Import BOTH the old and enhanced WASM functions
import init, { 
  get_adf_p_value_and_stationarity, 
  calculate_complete_adf_test  // NEW enhanced function
} from "../wasm/adf_test.js"

let wasmInitialized = false

// Initialize WASM module once
async function initializeWasm() {
  if (!wasmInitialized) {
    self.postMessage({ type: "debug", message: "🔧 Initializing Enhanced WASM..." })
    try {
      await init()
      wasmInitialized = true
      self.postMessage({ type: "debug", message: "✅ Enhanced WASM initialized with calculate_complete_adf_test function." })
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

const calculateZScore = (data, lookback) => {
  if (data.length < lookback) {
    return Array(data.length).fill(0) // Not enough data for initial z-score
  }

  const zScores = []
  for (let i = 0; i < data.length; i++) {
    const windowStart = Math.max(0, i - lookback + 1)
    const windowData = data.slice(windowStart, i + 1)

    if (windowData.length === lookback) {
      const mean = windowData.reduce((sum, val) => sum + val, 0) / windowData.length
      const variance =
        windowData.length > 1
          ? windowData.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (windowData.length - 1) // Sample variance
          : 0 // Handle case where windowData.length is 1
      const stdDev = Math.sqrt(variance)
      zScores.push(stdDev > 0 ? (data[i] - mean) / stdDev : 0)
    } else {
      zScores.push(0) // Not enough data in window yet
    }
  }
  return zScores
}

// Helper function for matrix multiplication
const multiplyMatrices = (A, B) => {
  const rowsA = A.length
  const colsA = A[0].length
  const rowsB = B.length
  const colsB = B[0].length

  if (colsA !== rowsB) {
    throw new Error("Matrix dimensions mismatch for multiplication.")
  }

  const result = Array(rowsA)
    .fill(0)
    .map(() => Array(colsB).fill(0))

  for (let i = 0; i < rowsA; i++) {
    for (let j = 0; j < colsB; j++) {
      for (let k = 0; k < colsA; k++) {
        result[i][j] += A[i][k] * B[k][j]
      }
    }
  }
  return result
}

// Helper function for matrix transpose
const transposeMatrix = (matrix) => {
  const rows = matrix.length
  const cols = matrix[0].length
  const result = Array(cols)
    .fill(0)
    .map(() => Array(rows).fill(0))
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      result[j][i] = matrix[i][j]
    }
  }
  return result
}

// Gaussian elimination for matrix inversion
const invertMatrix = (matrix) => {
  const n = matrix.length
  if (n === 0 || matrix[0].length !== n) {
    throw new Error("Matrix must be square and non-empty.")
  }

  // Create an augmented matrix [A | I]
  const augmentedMatrix = Array(n)
    .fill(0)
    .map((_, i) =>
      Array(2 * n)
        .fill(0)
        .map((_, j) => {
          if (j < n) return matrix[i][j]
          return i === j - n ? 1 : 0
        }),
    )

  // Forward elimination
  for (let i = 0; i < n; i++) {
    // Find pivot
    let pivotRow = i
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(augmentedMatrix[k][i]) > Math.abs(augmentedMatrix[pivotRow][i])) {
        pivotRow = k
      }
    }
    ;[augmentedMatrix[i], augmentedMatrix[pivotRow]] = [augmentedMatrix[pivotRow], augmentedMatrix[i]]

    const pivot = augmentedMatrix[i][i]
    if (Math.abs(pivot) < 1e-12) {
      // Check for near-zero pivot
      throw new Error("Matrix is singular or ill-conditioned, cannot invert.")
    }

    // Normalize row
    for (let j = i; j < 2 * n; j++) {
      augmentedMatrix[i][j] /= pivot
    }

    // Eliminate other rows
    for (let k = 0; k < n; k++) {
      if (k !== i) {
        const factor = augmentedMatrix[k][i]
        for (let j = i; j < 2 * n; j++) {
          augmentedMatrix[k][j] -= factor * augmentedMatrix[i][j]
        }
      }
    }
  }

  // Extract inverse matrix
  const inverse = Array(n)
    .fill(0)
    .map((_, i) =>
      Array(n)
        .fill(0)
        .map((_, j) => augmentedMatrix[i][j + n]),
    )
  return inverse
}

// Updated runMultiLinearRegression
const runMultiLinearRegression = (y_values, x_matrix) => {
  const numObservations = y_values.length
  const numPredictors = x_matrix[0].length // Includes intercept

  // Build X transpose * X
  const Xt = transposeMatrix(x_matrix)
  const XtX = multiplyMatrices(Xt, x_matrix)

  // Build X transpose * Y
  const XtY = Array(numPredictors).fill(0)
  for (let i = 0; i < numPredictors; i++) {
    for (let k = 0; k < numObservations; k++) {
      XtY[i] += Xt[i][k] * y_values[k]
    }
  }

  let XtX_inv
  try {
    XtX_inv = invertMatrix(XtX)
  } catch (e) {
    console.error("Error inverting XtX matrix:", e.message)
    return {
      coefficients: Array(numPredictors).fill(0),
      stdErrors: Array(numPredictors).fill(Number.POSITIVE_INFINITY),
      SSR: Number.POSITIVE_INFINITY,
      nobs: numObservations,
      nparams: numPredictors,
    }
  }

  // Calculate coefficients (beta_hat = (XtX)^-1 * XtY)
  const coefficients = Array(numPredictors).fill(0)
  for (let i = 0; i < numPredictors; i++) {
    for (let j = 0; j < numPredictors; j++) {
      coefficients[i] += XtX_inv[i][j] * XtY[j]
    }
  }

  // Calculate residuals
  const residuals = []
  for (let i = 0; i < numObservations; i++) {
    let predictedY = 0
    for (let j = 0; j < numPredictors; j++) {
      predictedY += coefficients[j] * x_matrix[i][j]
    }
    residuals.push(y_values[i] - predictedY)
  }

  // Calculate Residual Sum of Squares (RSS)
  const SSR = residuals.reduce((sum, r) => sum + r * r, 0)
  // Calculate Mean Squared Error (MSE)
  const MSE = SSR / (numObservations - numPredictors)

  // Calculate standard errors of coefficients
  const stdErrors = Array(numPredictors).fill(0)
  for (let i = 0; i < numPredictors; i++) {
    stdErrors[i] = Math.sqrt(MSE * XtX_inv[i][i])
  }

  return {
    coefficients,
    stdErrors,
    SSR,
    nobs: numObservations,
    nparams: numPredictors,
  }
}

// Matrix operations for 2x2 matrices
const matrixMultiply2x2 = (A, B) => {
  return [
    [A[0][0] * B[0][0] + A[0][1] * B[1][0], A[0][0] * B[0][1] + A[0][1] * B[1][1]],
    [A[1][0] * B[0][0] + A[1][1] * B[1][0], A[1][0] * B[0][1] + A[1][1] * B[1][1]],
  ]
}

const matrixSubtract2x2 = (A, B) => {
  return [
    [A[0][0] - B[0][0], A[0][1] - B[0][1]],
    [A[1][0] - B[1][0], A[1][1] - B[1][1]],
  ]
}

const scalarInverse = (x) => {
  return Math.abs(x) < 1e-10 ? 1.0 : 1.0 / x
}

// OLS regression for hedge ratio calculation
const calculateHedgeRatio = (pricesA, pricesB, currentIndex, windowSize) => {
  const startIdx = Math.max(0, currentIndex - windowSize + 1)
  const endIdx = currentIndex + 1

  let sumA = 0,
    sumB = 0,
    sumAB = 0,
    sumB2 = 0
  let count = 0

  for (let i = startIdx; i < endIdx; i++) {
    const priceA = typeof pricesA[i].close === "string" ? Number.parseFloat(pricesA[i].close) : pricesA[i].close
    const priceB = typeof pricesB[i].close === "string" ? Number.parseFloat(pricesB[i].close) : pricesB[i].close

    if (isNaN(priceA) || isNaN(priceB)) {
      continue
    }

    sumA += priceA
    sumB += priceB
    sumAB += priceA * priceB
    sumB2 += priceB * priceB
    count++
  }

  if (count === 0 || count * sumB2 - sumB * sumB === 0) {
    return { beta: 1, alpha: 0 }
  }

  const numerator = count * sumAB - sumA * sumB
  const denominator = count * sumB2 - sumB * sumB
  const beta = numerator / denominator
  const alpha = sumA / count - beta * (sumB / count)

  return { beta, alpha }
}

// Corrected Kalman filter implementation
const kalmanFilter = (pricesA, pricesB, processNoise, measurementNoise, initialLookback) => {
  const n = pricesA.length

  if (n < initialLookback) {
    return { hedgeRatios: Array(n).fill(1), alphas: Array(n).fill(0) }
  }

  // Initialize with OLS regression on first initialLookback days
  let sumA = 0, sumB = 0, sumAB = 0, sumB2 = 0
  for (let i = 0; i < initialLookback; i++) {
    const priceA = typeof pricesA[i].close === "string" ? Number.parseFloat(pricesA[i].close) : pricesA[i].close
    const priceB = typeof pricesB[i].close === "string" ? Number.parseFloat(pricesB[i].close) : pricesB[i].close
    sumA += priceA
    sumB += priceB
    sumAB += priceA * priceB
    sumB2 += priceB * priceB
  }

  const meanA = sumA / initialLookback
  const meanB = sumB / initialLookback
  const numerator = initialLookback * sumAB - sumA * sumB
  const denominator = initialLookback * sumB2 - sumB * sumB
  const initialBeta = Math.abs(denominator) > 1e-10 ? numerator / denominator : 1.0
  const initialAlpha = meanA - initialBeta * meanB

  // Calculate measurement noise R - use provided value or estimate from OLS residuals
  let R = measurementNoise
  if (!R || R <= 0) {
    let residualSumSquares = 0
    for (let i = 0; i < initialLookback; i++) {
      const priceA = typeof pricesA[i].close === "string" ? Number.parseFloat(pricesA[i].close) : pricesA[i].close
      const priceB = typeof pricesB[i].close === "string" ? Number.parseFloat(pricesB[i].close) : pricesB[i].close
      const predicted = initialAlpha + initialBeta * priceB
      const residual = priceA - predicted
      residualSumSquares += residual * residual
    }
    // Use sample variance: sum of squared residuals divided by degrees of freedom
    const degreesOfFreedom = Math.max(1, initialLookback - 2) // n - 2 for OLS with intercept and slope
    R = residualSumSquares / degreesOfFreedom
    
    // Debug logging for comparison with other implementations
    self.postMessage({ 
      type: "debug", 
      message: `📊 Kalman R calculation: RSS=${residualSumSquares.toFixed(6)}, DOF=${degreesOfFreedom}, R=${R.toFixed(6)}` 
    })
  }
  
  // Ensure R is positive and reasonable
  R = Math.max(R, 1e-8)
  
  // Additional debug info for initial parameters
  self.postMessage({ 
    type: "debug", 
    message: `🔧 Kalman Init: α=${initialAlpha.toFixed(6)}, β=${initialBeta.toFixed(6)}, R=${R.toFixed(6)}, Q=${processNoise}, n=${n}, lookback=${initialLookback}` 
  })
  
  self.postMessage({ 
    type: "debug", 
    message: `📊 WORKER VERSION CHECK: Kalman Debug v2024-12-23 15:45:00 - MEASUREMENT NOISE FIX - Ready to process ${n - initialLookback} Kalman steps` 
  })

  // Initialize state vector [alpha, beta]
  let x = [initialAlpha, initialBeta]
  
  // Initialize covariance matrix P to match standard implementations
  let P = [
    [0.1, 0],     // Standard initial uncertainty for alpha
    [0, 0.1]      // Standard initial uncertainty for beta
  ]
  
  // Process noise matrix Q
  const Q = [
    [processNoise, 0],
    [0, processNoise]
  ]

  const hedgeRatios = []
  const alphas = []

  // Fill initial values for the first initialLookback days
  for (let i = 0; i < initialLookback; i++) {
    hedgeRatios.push(initialBeta)
    alphas.push(initialAlpha)
  }

  // Process remaining data points with Kalman filter
  for (let i = initialLookback; i < n; i++) {
    const priceA = typeof pricesA[i].close === "string" ? Number.parseFloat(pricesA[i].close) : pricesA[i].close
    const priceB = typeof pricesB[i].close === "string" ? Number.parseFloat(pricesB[i].close) : pricesB[i].close

    // Prediction step
    // x_pred = F @ x (F is identity, so x_pred = x)
    const x_pred = [...x]
    
    // P_pred = F @ P @ F.T + Q (F is identity, so P_pred = P + Q)
    const P_pred = matrixAdd2x2(P, Q)

    // Update step
    // Observation matrix H_t = [1, priceB]
    const H_t = [1, priceB]
    
    // Innovation: y - H @ x_pred
    const predicted_y = H_t[0] * x_pred[0] + H_t[1] * x_pred[1] // H_t @ x_pred
    const innovation = priceA - predicted_y

    // Innovation covariance: H @ P_pred @ H.T + R
    // H @ P_pred = [P_pred[0][0] + priceB*P_pred[1][0], P_pred[0][1] + priceB*P_pred[1][1]]
    const H_P_pred_0 = P_pred[0][0] + priceB * P_pred[1][0]
    const H_P_pred_1 = P_pred[0][1] + priceB * P_pred[1][1]
    
    // (H @ P_pred) @ H.T = H_P_pred_0 * 1 + H_P_pred_1 * priceB
    const innovation_covariance = H_P_pred_0 + H_P_pred_1 * priceB + R // scalar

    // Safety check: prevent division by very small numbers
    if (innovation_covariance < 1e-10) {
      self.postMessage({ 
        type: "debug", 
        message: `⚠️ WARNING: Innovation covariance too small (${innovation_covariance.toExponential(3)}) at step ${i}. This may cause numerical instability.` 
      })
    }

    // Kalman gain: P_pred @ H.T @ inv(innovation_covariance)
    const K_0 = (P_pred[0][0] + P_pred[0][1] * priceB) / innovation_covariance
    const K_1 = (P_pred[1][0] + P_pred[1][1] * priceB) / innovation_covariance
    const K = [K_0, K_1]
    
    // Debug: Check if Kalman gains are too small (indicating overfitting)
    if (Math.abs(K[0]) < 1e-6 && Math.abs(K[1]) < 1e-6) {
      self.postMessage({ 
        type: "debug", 
        message: `⚠️ WARNING: Kalman gains extremely small at step ${i}. Filter may be overfitting. Consider increasing measurement noise R.` 
      })
    }

    // Update state: x = x_pred + K @ innovation
    x = [x_pred[0] + K[0] * innovation, x_pred[1] + K[1] * innovation]
    
    // Safety check: prevent NaN/Infinity in state values
    if (isNaN(x[0]) || isNaN(x[1]) || !isFinite(x[0]) || !isFinite(x[1])) {
      self.postMessage({ 
        type: "debug", 
        message: `⚠️ CRITICAL: State values became NaN/Infinity at step ${i}. Resetting to OLS values.` 
      })
      x = [initialAlpha, initialBeta]
    }

    // Update covariance: P = (I - K @ H) @ P_pred
    // K @ H where K is 2x1 and H is 1x2, result is 2x2
    const K_H = [
      [K[0] * H_t[0], K[0] * H_t[1]], // [K[0] * 1, K[0] * priceB]
      [K[1] * H_t[0], K[1] * H_t[1]]  // [K[1] * 1, K[1] * priceB]
    ]
    
    const I_minus_KH = matrixSubtract2x2(
      [
        [1, 0],
        [0, 1]
      ],
      K_H
    )
    P = matrixMultiply2x2(I_minus_KH, P_pred)
    
    // CRITICAL FIX: Ensure covariance matrix stays positive definite
    // Check for numerical instability
    if (P[0][0] < 1e-12 || P[1][1] < 1e-12 || isNaN(P[0][0]) || isNaN(P[1][1])) {
      self.postMessage({ 
        type: "debug", 
        message: `⚠️ CRITICAL: Covariance matrix becoming singular at step ${i}. Resetting to prevent numerical collapse.` 
      })
      P = [
        [0.01, 0],
        [0, 0.01]
      ]
    }

    // Enhanced debug output for first few iterations + periodic updates
    if (i < initialLookback + 5 || i % 20 === 0) {
      const currentSpread = priceA - (x[0] + x[1] * priceB)
      const predictedPrice = x[0] + x[1] * priceB
      self.postMessage({ 
        type: "debug", 
        message: `🔄 Kalman Step ${i}: PA=${priceA.toFixed(2)}, PB=${priceB.toFixed(2)}, predicted=${predictedPrice.toFixed(8)}, spread=${currentSpread.toFixed(8)}, α=${x[0].toFixed(6)}, β=${x[1].toFixed(6)}` 
      })
      self.postMessage({ 
        type: "debug", 
        message: `   Details: innovation=${innovation.toFixed(6)}, inn_cov=${innovation_covariance.toFixed(2)}, R=${R.toFixed(6)}` 
      })
      
      // Additional debug for covariance matrix
      if (i < initialLookback + 3) {
        self.postMessage({ 
          type: "debug", 
          message: `   P_matrix: [[${P[0][0].toFixed(8)}, ${P[0][1].toFixed(8)}], [${P[1][0].toFixed(8)}, ${P[1][1].toFixed(8)}]]` 
        })
        self.postMessage({ 
          type: "debug", 
          message: `   K_gains: [${K[0].toFixed(8)}, ${K[1].toFixed(8)}]` 
        })
      }
    }

    // Store results
    alphas.push(x[0])
    hedgeRatios.push(x[1])
  }

  return { hedgeRatios, alphas }
}

const calculateCorrelation = (pricesA, pricesB) => {
  const n = pricesA.length
  let sumA = 0,
    sumB = 0,
    sumAB = 0,
    sumA2 = 0,
    sumB2 = 0

  for (let i = 0; i < n; i++) {
    sumA += pricesA[i].close
    sumB += pricesB[i].close
    sumAB += pricesA[i].close * pricesB[i].close // Corrected: A * B
    sumA2 += pricesA[i].close * pricesA[i].close
    sumB2 += pricesB[i].close * pricesB[i].close
  }

  const numerator = n * sumAB - sumA * sumB
  const denominator = Math.sqrt((n * sumA2 - sumA * sumA) * (n * sumB2 - sumB * sumB))

  return denominator === 0 ? 0 : numerator / denominator
}

const calculateHalfLife = (spreads) => {
  const n = spreads.length
  if (n < 20) return { halfLife: 0, isValid: false }

  const y = []
  const x = []

  for (let i = 1; i < n; i++) {
    y.push(spreads[i] - spreads[i - 1])
    x.push(spreads[i - 1])
  }

  let sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumX2 = 0
  for (let i = 0; i < y.length; i++) {
    sumX += x[i]
    sumY += y[i]
    sumXY += x[i] * y[i]
    sumX2 += x[i] * x[i]
  }

  const beta = (y.length * sumXY - sumX * sumY) / (y.length * sumX2 - sumX * sumX)
  const halfLife = -Math.log(2) / beta

  return {
    halfLife: beta < 0 ? halfLife : 0,
    isValid: halfLife > 0 && halfLife < 252,
  }
}

const calculateRollingHalfLife = (data, windowSize) => {
  const result = []
  if (data.length < windowSize + 1) {
    return Array(data.length).fill(null)
  }

  for (let i = 0; i < data.length; i++) {
    if (i < windowSize - 1) {
      result.push(null)
      continue
    }

    const windowData = data.slice(Math.max(0, i - windowSize + 1), i + 1)
    const mean = windowData.reduce((sum, val) => sum + val, 0) / windowData.length

    const y = []
    const x = []

    for (let j = 1; j < windowData.length; j++) {
      y.push(windowData[j] - windowData[j - 1])
      x.push(windowData[j - 1] - mean)
    }

    let sumX = 0,
      sumY = 0,
      sumXY = 0,
      sumX2 = 0
    for (let j = 0; j < y.length; j++) {
      sumX += x[j]
      sumY += y[j]
      sumXY += x[j] * y[j]
      sumX2 += x[j] * x[j]
    }

    if (sumX2 === 0) {
      result.push(null)
      continue
    }

    const beta = (y.length * sumXY - sumX * sumY) / (y.length * sumX2 - sumX * sumX)
    const halfLife = beta < 0 ? -Math.log(2) / beta : null

    if (halfLife !== null && halfLife > 0) {
      result.push(halfLife)
    } else {
      result.push(null)
    }
  }
  return result
}

const calculatePracticalTradeHalfLife = (zScores, entryThreshold = 2.0, exitThreshold = 0.5) => {
  const tradeCycles = []
  let inTrade = false
  let entryDay = 0
  let entryDirection = ""

  for (let i = 0; i < zScores.length; i++) {
    const currentZScore = zScores[i]

    if (!inTrade && Math.abs(currentZScore) >= entryThreshold) {
      inTrade = true
      entryDay = i
      entryDirection = currentZScore > 0 ? "positive" : "negative"
    }

    if (inTrade) {
      if (
        (entryDirection === "positive" && currentZScore <= exitThreshold) ||
        (entryDirection === "negative" && currentZScore >= -exitThreshold)
      ) {
        const cycleLength = i - entryDay + 1
        tradeCycles.push(cycleLength)
        inTrade = false
      }
    }
  }

  if (tradeCycles.length === 0) {
    return {
      tradeCycleLength: 0,
      isValid: false,
      sampleSize: 0,
      successRate: 0,
      medianCycleLength: 0,
    }
  }

  const avgCycleLength = tradeCycles.reduce((sum, val) => sum + val, 0) / tradeCycles.length
  const totalPotentialTrades = tradeCycles.length + (inTrade ? 1 : 0)
  const successRate = totalPotentialTrades > 0 ? tradeCycles.length / totalPotentialTrades : 0

  const sortedCycles = [...tradeCycles].sort((a, b) => a - b)
  const medianCycleLength = sortedCycles[Math.floor(sortedCycles.length / 2)]

  return {
    tradeCycleLength: avgCycleLength,
    medianCycleLength,
    successRate,
    sampleSize: tradeCycles.length,
    isValid: tradeCycles.length >= 5 && successRate > 0.7,
  }
}

const calculateHurstExponent = (data) => {
  const n = data.length
  if (n < 100) return 0.5

  const maxLag = Math.min(100, Math.floor(n / 2))
  const lags = []
  const rs = []

  for (let lag = 10; lag <= maxLag; lag += 10) {
    const rsValues = []

    for (let i = 0; i < n - lag; i += lag) {
      const series = data.slice(i, i + lag)
      const mean = series.reduce((sum, val) => sum + val, 0) / lag

      const cumDevs = []
      let sum = 0
      for (let j = 0; j < series.length; j++) {
        sum += series[j] - mean
        cumDevs.push(sum)
      }

      const range = Math.max(...cumDevs) - Math.min(...cumDevs)
      const stdDev = Math.sqrt(series.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (lag > 1 ? lag - 1 : lag))

      if (stdDev > 0) {
        rsValues.push(range / stdDev)
      }
    }

    if (rsValues.length > 0) {
      lags.push(Math.log(lag))
      rs.push(Math.log(rsValues.reduce((sum, val) => sum + val, 0) / rsValues.length))
    }
  }

  let sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumX2 = 0
  for (let i = 0; i < lags.length; i++) {
    sumX += lags[i]
    sumY += rs[i]
    sumXY += lags[i] * rs[i]
    sumX2 += lags[i] * lags[i]
  }

  const hurstExponent = (lags.length * sumXY - sumX * sumY) / (lags.length * sumX2 - sumX * sumX)
  return hurstExponent
}

// ===== ENHANCED ADF TEST FUNCTION (WASM-Powered) =====
const adfTestWasmEnhanced = async (data, seriesType, modelType) => {
  // Filter out NaN and Infinity values
  const cleanData = data.filter((val) => typeof val === "number" && isFinite(val))

  self.postMessage({
    type: "debug",
    message: `🧪 Enhanced ADF Test: Received ${data.length} raw data points for ${seriesType}. Cleaned to ${cleanData.length} points.`,
  })

  if (cleanData.length < 5) {
    self.postMessage({
      type: "debug",
      message: `⚠️ Enhanced ADF Test: Not enough clean data points (${cleanData.length}) for ADF test. Returning default.`,
    })
    return { statistic: 0, pValue: 1, criticalValues: { "1%": 0, "5%": 0, "10%": 0 }, isStationary: false }
  }

  try {
    await initializeWasm() // Ensure WASM is loaded

    self.postMessage({ 
      type: "debug", 
      message: `🚀 Enhanced ADF: Using complete WASM calculation (NOT JavaScript) for ${seriesType} with model: ${modelType}` 
    })

    // *** KEY CHANGE: Use the enhanced WASM function that calculates EVERYTHING ***
    self.postMessage({ 
      type: "debug", 
      message: `🔧 WASM ADF Call: Series length=${cleanData.length}, modelType='${modelType}', first 5 values=[${cleanData.slice(0, 5).map(v => v.toFixed(6)).join(', ')}]` 
    })
    
    const result = calculate_complete_adf_test(new Float64Array(cleanData), modelType)

    self.postMessage({ 
      type: "debug", 
      message: `✅ Enhanced ADF Result: t-stat=${result.test_statistic.toFixed(8)}, lags=${result.optimal_lags}, AIC=${result.aic_value.toFixed(3)}, p-value=${result.p_value.toFixed(6)}` 
    })
    
    // Log critical values for comparison
    const criticalVals = result.critical_values
    self.postMessage({ 
      type: "debug", 
      message: `🎯 ADF Critical Values: 1%=${criticalVals['1%']?.toFixed(6)}, 5%=${criticalVals['5%']?.toFixed(6)}, 10%=${criticalVals['10%']?.toFixed(6)}` 
    })

    return {
      statistic: result.test_statistic,  // This is now calculated with nalgebra precision!
      pValue: result.p_value,
      criticalValues: result.critical_values,
      isStationary: result.is_stationary,
      // Additional enhanced information
      optimalLags: result.optimal_lags,
      aicValue: result.aic_value,
      calculationMethod: "Enhanced WASM with nalgebra"
    }
  } catch (error) {
    console.error("Error running Enhanced ADF test with WASM:", error)
    self.postMessage({ type: "error", message: `Enhanced ADF Test WASM error: ${error.message}` })
    
    // Fallback to old method
    self.postMessage({ type: "debug", message: "⚠️ Falling back to basic p-value lookup method..." })
    return { statistic: 0, pValue: 1, criticalValues: { "1%": 0, "5%": 0, "10%": 0 }, isStationary: false }
  }
}

// ===== GEMINI'S Z-SCORE BASED EUCLIDEAN MODEL FUNCTIONS =====

/**
 * Calculate individual Z-scores for a single stock using rolling windows
 * Z-score = (Current_Price - Rolling_Mean) / Rolling_StdDev
 */
const calculateIndividualZScores = (prices, lookbackWindow) => {
  const zScores = []
  
  self.postMessage({ 
    type: "debug", 
    message: `🔍 Individual Z-Score Debug: Processing ${prices.length} prices with lookback ${lookbackWindow}. First 5 prices: [${prices.slice(0, 5).join(', ')}]` 
  })
  
  for (let i = 0; i < prices.length; i++) {
    if (i < lookbackWindow - 1) {
      // Not enough data for rolling calculation
      zScores.push(0)
      continue
    }
    
    // Get rolling window of prices
    const windowStart = Math.max(0, i - lookbackWindow + 1)
    const windowPrices = prices.slice(windowStart, i + 1)
    
    // Calculate rolling mean
    const rollingMean = windowPrices.reduce((sum, price) => sum + price, 0) / windowPrices.length
    
    // Calculate rolling standard deviation (use SAMPLE std dev to match pandas default)
    const variance = windowPrices.length > 1 
      ? windowPrices.reduce((sum, price) => sum + Math.pow(price - rollingMean, 2), 0) / (windowPrices.length - 1)  // N-1 for sample std dev
      : 0
    const rollingStdDev = Math.sqrt(variance)
    
    // VERIFY: Double-check that we're using sample std dev for first calculation
    if (i === lookbackWindow - 1) {
      const sumSquaredDiffs = windowPrices.reduce((sum, price) => sum + Math.pow(price - rollingMean, 2), 0)
      const populationStd = Math.sqrt(sumSquaredDiffs / windowPrices.length)  // N
      const sampleStd = Math.sqrt(sumSquaredDiffs / (windowPrices.length - 1))  // N-1
      self.postMessage({ 
        type: "debug", 
        message: `🔍 STD DEV VERIFICATION: Population (÷${windowPrices.length})=${populationStd.toFixed(6)}, Sample (÷${windowPrices.length - 1})=${sampleStd.toFixed(6)}, Using=${rollingStdDev.toFixed(6)}` 
      })
    }
    
    // Calculate Z-score for current price
    const currentPrice = prices[i]
    const zScore = rollingStdDev > 0 ? (currentPrice - rollingMean) / rollingStdDev : 0
    
    // Debug first few calculations with MORE detail
    if (i >= lookbackWindow - 1 && i < lookbackWindow + 5) {
      self.postMessage({ 
        type: "debug", 
        message: `🔢 Z-Score[${i}]: price=${currentPrice.toFixed(2)}, mean=${rollingMean.toFixed(6)}, std=${rollingStdDev.toFixed(6)}, z=${zScore.toFixed(6)} | window length=${windowPrices.length}` 
      })
      if (i === lookbackWindow - 1) {
        self.postMessage({ 
          type: "debug", 
          message: `   📊 First calculation window [${i - lookbackWindow + 1} to ${i}]: [${windowPrices.map(p => p.toFixed(2)).join(', ')}]` 
        })
      }
    }
    
    zScores.push(zScore)
  }
  
  self.postMessage({ 
    type: "debug", 
    message: `✅ Individual Z-Score Complete: Generated ${zScores.length} z-scores. Range: [${Math.min(...zScores.filter(z => !isNaN(z) && isFinite(z))).toFixed(3)}, ${Math.max(...zScores.filter(z => !isNaN(z) && isFinite(z))).toFixed(3)}]` 
  })
  
  return zScores
}

/**
 * Calculate Gemini's Z-Score Based Euclidean Model
 * 
 * IMPORTANT CHANGES TO MATCH GEMINI AI IMPLEMENTATION:
 * 1. Uses SAMPLE standard deviation (÷N-1) instead of population std dev (÷N) to match pandas default
 * 2. ADF test is performed on Z-score of spread (spreadZScores) not raw spread (Z_A - Z_B)
 * 
 * Steps:
 * 1. Calculate individual Z-scores for both stocks using sample std dev
 * 2. Calculate spread = Z_A - Z_B  
 * 3. Calculate Z-score of the spread (final signal)
 * 4. Run ADF test on the Z-score of spread to test for stationarity
 */
const calculateGeminiEuclideanModel = (stockAPrices, stockBPrices, lookbackWindow) => {
  self.postMessage({ 
    type: "debug", 
    message: `🧬 Gemini Euclidean Model: Processing ${stockAPrices.length} price points with ${lookbackWindow} day lookback (using SAMPLE std dev to match pandas)` 
  })
  
  // Step 1: Calculate individual Z-scores for each stock
  const zScoresA = calculateIndividualZScores(stockAPrices, lookbackWindow)
  const zScoresB = calculateIndividualZScores(stockBPrices, lookbackWindow)
  
  // Step 2: Calculate spread = Z_A - Z_B
  const spreads = zScoresA.map((zA, i) => zA - zScoresB[i])
  
  // DETAILED DEBUG: Individual Z-scores at first valid calculation point
  const firstValidIndex = lookbackWindow - 1
  self.postMessage({ 
    type: "debug", 
    message: `🔍 INDIVIDUAL Z-SCORES at first valid index (${firstValidIndex}):` 
  })
  self.postMessage({ 
    type: "debug", 
    message: `   Stock A Z-scores (first 10 valid): [${zScoresA.slice(firstValidIndex, firstValidIndex+10).map(z => z.toFixed(6)).join(', ')}]` 
  })
  self.postMessage({ 
    type: "debug", 
    message: `   Stock B Z-scores (first 10 valid): [${zScoresB.slice(firstValidIndex, firstValidIndex+10).map(z => z.toFixed(6)).join(', ')}]` 
  })
  self.postMessage({ 
    type: "debug", 
    message: `   Raw spreads (Z_A - Z_B, first 10): [${spreads.slice(firstValidIndex, firstValidIndex+10).map(s => s.toFixed(6)).join(', ')}]` 
  })
  
  // DEBUG: Check the raw prices used for first few calculations
  self.postMessage({ 
    type: "debug", 
    message: `🔍 RAW PRICES at first valid calculation:` 
  })
  self.postMessage({ 
    type: "debug", 
    message: `   Stock A prices [${firstValidIndex-4} to ${firstValidIndex+5}]: [${stockAPrices.slice(firstValidIndex-4, firstValidIndex+6).map(p => p.toFixed(2)).join(', ')}]` 
  })
  self.postMessage({ 
    type: "debug", 
    message: `   Stock B prices [${firstValidIndex-4} to ${firstValidIndex+5}]: [${stockBPrices.slice(firstValidIndex-4, firstValidIndex+6).map(p => p.toFixed(2)).join(', ')}]` 
  })
  
  // Step 3: Calculate Z-score of the spread (final trading signal)
  const spreadZScores = []
  
  for (let i = 0; i < spreads.length; i++) {
    // CRITICAL FIX: Need double lookback window for spread Z-scores
    // First lookback for individual Z-scores, second lookback for spread Z-scores
    const requiredValidSpreads = lookbackWindow
    const firstValidSpreadIndex = lookbackWindow - 1  // When spreads start being valid
    const firstValidSpreadZScoreIndex = firstValidSpreadIndex + lookbackWindow - 1  // When we have enough valid spreads
    
    if (i < firstValidSpreadZScoreIndex) {
      // Not enough VALID spread data for rolling calculation
      spreadZScores.push(0)
      continue
    }
    
    // Get rolling window of VALID spreads only (skip the initial zeros/NaNs)
    const validSpreadsStartIndex = firstValidSpreadIndex  // Index 59 for 60-day lookback
    const windowStart = Math.max(validSpreadsStartIndex, i - lookbackWindow + 1)
    const windowSpreads = spreads.slice(windowStart, i + 1)
    
    // Debug the double rolling effect
    if (i === firstValidSpreadZScoreIndex) {
      self.postMessage({ 
        type: "debug", 
        message: `🚨 DOUBLE ROLLING FIX: First valid spread Z-score at index ${i} (day ${i + 1}). lookbackWindow=${lookbackWindow}, firstValidSpread=${firstValidSpreadIndex}, windowStart=${windowStart}` 
      })
      self.postMessage({ 
        type: "debug", 
        message: `   Using spread window [${windowStart}:${i}], length=${windowSpreads.length}, values=[${windowSpreads.map(s => s.toFixed(6)).join(', ')}]` 
      })
    }
    
    // Calculate rolling mean of spreads
    const rollingMeanSpread = windowSpreads.reduce((sum, spread) => sum + spread, 0) / windowSpreads.length
    
            // Calculate rolling standard deviation of spreads (use SAMPLE std dev to match pandas default)
        const spreadVariance = windowSpreads.length > 1
          ? windowSpreads.reduce((sum, spread) => sum + Math.pow(spread - rollingMeanSpread, 2), 0) / (windowSpreads.length - 1)  // N-1 for sample std dev
          : 0
        const rollingStdDevSpread = Math.sqrt(spreadVariance)
        
        // VERIFY: Double-check that we're using sample std dev for spread calculation too
        if (i === lookbackWindow - 1) {
          const sumSquaredDiffs = windowSpreads.reduce((sum, spread) => sum + Math.pow(spread - rollingMeanSpread, 2), 0)
          const populationStd = Math.sqrt(sumSquaredDiffs / windowSpreads.length)  // N
          const sampleStd = Math.sqrt(sumSquaredDiffs / (windowSpreads.length - 1))  // N-1
          self.postMessage({ 
            type: "debug", 
            message: `🔍 SPREAD STD DEV VERIFICATION: Population (÷${windowSpreads.length})=${populationStd.toFixed(6)}, Sample (÷${windowSpreads.length - 1})=${sampleStd.toFixed(6)}, Using=${rollingStdDevSpread.toFixed(6)}` 
          })
        }
    
    // Calculate Z-score of current spread (this is our trading signal!)
    const currentSpread = spreads[i]
    const spreadZScore = rollingStdDevSpread > 0 ? (currentSpread - rollingMeanSpread) / rollingStdDevSpread : 0
    
    // Debug first few spread Z-score calculations with MORE detail
    if (i >= firstValidSpreadZScoreIndex && i < firstValidSpreadZScoreIndex + 5) {
      self.postMessage({ 
        type: "debug", 
        message: `🎯 SpreadZ[${i}] (Day ${i + 1}): spread=${currentSpread.toFixed(6)}, meanSpr=${rollingMeanSpread.toFixed(6)}, stdSpr=${rollingStdDevSpread.toFixed(6)}, zSpr=${spreadZScore.toFixed(6)} | window length=${windowSpreads.length}` 
      })
      if (i === firstValidSpreadZScoreIndex) {
        self.postMessage({ 
          type: "debug", 
          message: `   📊 FIRST VALID spread Z-score calculation window [${windowStart} to ${i}]: [${windowSpreads.map(s => s.toFixed(6)).join(', ')}]` 
        })
      }
    }
    
    spreadZScores.push(spreadZScore)
  }
  
  self.postMessage({ 
    type: "debug", 
    message: `✅ Gemini Model Complete: Generated ${spreadZScores.length} spread Z-scores. Range: [${Math.min(...spreadZScores.filter(z => !isNaN(z))).toFixed(3)}, ${Math.max(...spreadZScores.filter(z => !isNaN(z))).toFixed(3)}]` 
  })
  
  return {
    individualZScoresA: zScoresA,
    individualZScoresB: zScoresB,
    spreads: spreads,
    spreadZScores: spreadZScores
  }
}

// KALMAN FILTER DEBUG VERSION - Updated at 2024-12-23 20:30:00
console.log("🚀 ENHANCED WORKER LOADED - Version 2024-12-23 20:30:00 - DOUBLE ROLLING WINDOW FIX: SPREAD Z-SCORES NOW PROPERLY CALCULATED")

// Main message handler for the worker
self.onmessage = async (event) => {
  const {
    type,
    data: { pricesA, pricesB },
    params,
    selectedPair,
  } = event.data

  if (type === "runAnalysis") {
    // Ensure WASM is ready before proceeding with analysis
    await initializeWasm()

    const {
      modelType,
      ratioLookbackWindow,
      olsLookbackWindow,
      kalmanProcessNoise,
      kalmanMeasurementNoise,
      kalmanInitialLookback,
      euclideanLookbackWindow,
      zScoreLookback,
      entryThreshold,
      exitThreshold,
    } = params

    let analysisData = null
    let error = ""

    try {
      const minLength = Math.min(pricesA.length, pricesB.length)
      const dates = pricesA.map((d) => d.date).slice(0, minLength)
      const stockAPrices = pricesA.map((d) => d.close).slice(0, minLength)
      const stockBPrices = pricesB.map((d) => d.close).slice(0, minLength)

      let spreads = []
      let ratios = []
      let distances = []
      let hedgeRatios = []
      let alphas = []
      let zScores = []
      let rollingHalfLifes = []
      let meanValue = 0
      let stdDevValue = 0

      if (modelType === "ratio") {
        ratios = stockAPrices.map((priceA, i) => priceA / stockBPrices[i])
        zScores = calculateZScore(ratios, ratioLookbackWindow)
        rollingHalfLifes = calculateRollingHalfLife(ratios, ratioLookbackWindow)
        if (ratios.length > 0) {
          meanValue = ratios.reduce((sum, val) => sum + val, 0) / ratios.length
          const stdDevDenominator = ratios.length > 1 ? ratios.length - 1 : ratios.length
          stdDevValue = Math.sqrt(
            ratios.reduce((sum, val) => sum + Math.pow(val - meanValue, 2), 0) / stdDevDenominator,
          )
        }
      } else if (modelType === "ols") {
        for (let i = 0; i < minLength; i++) {
          const { beta, alpha } = calculateHedgeRatio(pricesA, pricesB, i, olsLookbackWindow)
          const currentPriceA =
            typeof pricesA[i].close === "string" ? Number.parseFloat(pricesA[i].close) : pricesA[i].close
          const currentPriceB =
            typeof pricesB[i].close === "string" ? Number.parseFloat(pricesB[i].close) : pricesB[i].close
          const spread = currentPriceA - (alpha + beta * currentPriceB)
          hedgeRatios.push(beta)
          alphas.push(alpha)
          spreads.push(spread)
        }
        zScores = calculateZScore(spreads, zScoreLookback)
        rollingHalfLifes = calculateRollingHalfLife(spreads, olsLookbackWindow)
        const warmedUpSpreads = spreads.slice(olsLookbackWindow - 1)
        if (warmedUpSpreads.length > 0) {
          meanValue = warmedUpSpreads.reduce((sum, val) => sum + val, 0) / warmedUpSpreads.length
          const stdDevDenominator = warmedUpSpreads.length > 1 ? warmedUpSpreads.length - 1 : warmedUpSpreads.length
          stdDevValue = Math.sqrt(
            warmedUpSpreads.reduce((sum, val) => sum + Math.pow(val - meanValue, 2), 0) / stdDevDenominator,
          )
        }
      } else if (modelType === "kalman") {
        const kalmanResults = kalmanFilter(
          pricesA,
          pricesB,
          kalmanProcessNoise,
          kalmanMeasurementNoise,
          kalmanInitialLookback,
        )
        hedgeRatios = kalmanResults.hedgeRatios
        alphas = kalmanResults.alphas
        spreads = stockAPrices.map((priceA, i) => priceA - (alphas[i] + hedgeRatios[i] * stockBPrices[i]))
        zScores = calculateZScore(spreads, zScoreLookback)
        rollingHalfLifes = calculateRollingHalfLife(spreads, kalmanInitialLookback)
        const warmedUpSpreads = spreads.slice(kalmanInitialLookback - 1)
        if (warmedUpSpreads.length > 0) {
          meanValue = warmedUpSpreads.reduce((sum, val) => sum + val, 0) / warmedUpSpreads.length
          const stdDevDenominator = warmedUpSpreads.length > 1 ? warmedUpSpreads.length - 1 : warmedUpSpreads.length
          stdDevValue = Math.sqrt(
            warmedUpSpreads.reduce((sum, val) => sum + Math.pow(val - meanValue, 2), 0) / stdDevDenominator,
          )
        }
      } else if (modelType === "euclidean") {
        // *** GEMINI'S Z-SCORE BASED EUCLIDEAN MODEL ***
        self.postMessage({ type: "debug", message: "🧬 Using Gemini's Z-Score Based Euclidean Model" })
        
        const geminiResults = calculateGeminiEuclideanModel(stockAPrices, stockBPrices, euclideanLookbackWindow)
        
        // Extract results from Gemini model
        const individualZScoresA = geminiResults.individualZScoresA
        const individualZScoresB = geminiResults.individualZScoresB
        spreads = geminiResults.spreads  // This is Z_A - Z_B
        zScores = geminiResults.spreadZScores  // This is the Z-score of the spread (our trading signal!)
        
        // Store individual Z-scores in distances array for compatibility with existing code
        distances = spreads  // Use spreads instead of old distance calculation
        
        // Calculate rolling half-lives using the spreads
        rollingHalfLifes = calculateRollingHalfLife(spreads, euclideanLookbackWindow)
        
        // GEMINI FIX: Calculate statistics only on the valid portion (excluding warm-up period zeros)
        const firstValidSpreadIndex = euclideanLookbackWindow - 1 // First index where individual Z-scores are valid
        const warmedUpSpreadsForStats = spreads.slice(firstValidSpreadIndex)
        
        if (warmedUpSpreadsForStats.length > 0) {
          meanValue = warmedUpSpreadsForStats.reduce((sum, val) => sum + val, 0) / warmedUpSpreadsForStats.length
          const stdDevDenominator = warmedUpSpreadsForStats.length > 1 ? warmedUpSpreadsForStats.length - 1 : warmedUpSpreadsForStats.length
          stdDevValue = Math.sqrt(
            warmedUpSpreadsForStats.reduce((sum, val) => sum + Math.pow(val - meanValue, 2), 0) / stdDevDenominator,
          )
        } else {
          meanValue = 0
          stdDevValue = 0
        }
        
        // Store individual Z-scores for table display
        alphas = individualZScoresA  // Reusing alphas array to store individual Z-scores for Stock A
        hedgeRatios = individualZScoresB  // Reusing hedgeRatios array to store individual Z-scores for Stock B
        
        self.postMessage({ 
          type: "debug", 
          message: `📊 Gemini Results (WARM-UP EXCLUDED): Mean spread=${meanValue.toFixed(6)}, StdDev=${stdDevValue.toFixed(6)}, Signal range=[${Math.min(...zScores.filter(z => !isNaN(z))).toFixed(3)}, ${Math.max(...zScores.filter(z => !isNaN(z))).toFixed(3)}]` 
        })
        
        self.postMessage({ 
          type: "debug", 
          message: `🔧 GEMINI FIX: Using warmed-up data only. Total spreads: ${spreads.length}, Valid spreads (excluding ${firstValidSpreadIndex} warm-up): ${warmedUpSpreadsForStats.length}` 
        })
        
        self.postMessage({ 
          type: "debug", 
          message: `🔍 Data Check: spreads.length=${spreads.length}, alphas.length=${alphas.length}, hedgeRatios.length=${hedgeRatios.length}, zScores.length=${zScores.length}` 
        })
      }

      const validZScores = zScores.filter((z) => !isNaN(z))
      const minZScore = validZScores.length > 0 ? Math.min(...validZScores) : 0
      const maxZScore = validZScores.length > 0 ? Math.max(...validZScores) : 0

      const correlation = calculateCorrelation(pricesA.slice(0, minLength), pricesB.slice(0, minLength))
      
      // *** KEY CHANGE: Use Enhanced WASM ADF Test ***
      // For euclidean model, use Z-score of the spread (spreadZScores) not raw spread, to match Gemini's approach
      let seriesForADF = modelType === "ratio" ? ratios : modelType === "euclidean" ? zScores : spreads
      const seriesTypeForADF = modelType === "ratio" ? "ratios" : modelType === "euclidean" ? "spread_z_scores" : "spreads"
      
      // CRITICAL FIX: For euclidean model, remove the DOUBLE warmup period before ADF test
      // This matches Gemini's approach of using .dropna() to exclude NaN values
      if (modelType === "euclidean") {
        const lookbackWindow = euclideanLookbackWindow
        // DOUBLE ROLLING EFFECT: Need to remove (2 * lookbackWindow - 2) initial values
        // First warmup: individual Z-scores need (lookbackWindow - 1) values
        // Second warmup: spread Z-scores need another (lookbackWindow - 1) valid spread values
        const doubleWarmupPeriod = 2 * lookbackWindow - 2  // e.g., 2*60-2 = 118 for 60-day lookback
        const firstValidSpreadZScoreIndex = doubleWarmupPeriod  // Index 118 for 60-day lookback (day 119)
        
        // Start from the first valid spread Z-score calculation
        seriesForADF = zScores.slice(firstValidSpreadZScoreIndex).filter(val => isFinite(val) && !isNaN(val))
        
        self.postMessage({ 
          type: "debug", 
          message: `🚨 DOUBLE ROLLING FIX FOR ADF: Original length: ${zScores.length}, Double warmup removed: ${doubleWarmupPeriod}, Valid ADF series length: ${seriesForADF.length}` 
        })
        self.postMessage({ 
          type: "debug", 
          message: `🚨 Expected valid length should be: ${zScores.length - doubleWarmupPeriod} (1000 - 118 = 882 for 60-day lookback, 1000 - 358 = 642 for 180-day lookback)` 
        })
        self.postMessage({ 
          type: "debug", 
          message: `🚨 First valid spread Z-score should appear at day ${doubleWarmupPeriod + 1} (index ${doubleWarmupPeriod})` 
        })
      }
      
      // Convert model type to standard ADF model specification
      // The WASM function likely expects standard econometric model types, not our custom model names
      const adfModelType = modelType === "euclidean" ? "constant" : modelType === "ratio" ? "constant" : "constant"
      
      if (modelType === "euclidean") {
        self.postMessage({ 
          type: "debug", 
          message: `🔬 ADF Test Input: Using VALID spread Z-scores (warmup period removed) for euclidean model. Series length: ${seriesForADF.length}, ADF model type: '${adfModelType}'` 
        })
        
        // Log detailed ADF input for debugging
        const firstFew = seriesForADF.slice(0, 10)
        const lastFew = seriesForADF.slice(-10)
        
        self.postMessage({ 
          type: "debug", 
          message: `📊 ADF Input Data (VALID ONLY): Valid points: ${seriesForADF.length}, First 10: [${firstFew.map(v => v.toFixed(6)).join(', ')}]` 
        })
        self.postMessage({ 
          type: "debug", 
          message: `📊 ADF Input Data (VALID ONLY): Last 10: [${lastFew.map(v => v.toFixed(6)).join(', ')}]` 
        })
        
        // Calculate and log first differences for manual verification
        const firstDifferences = []
        for (let i = 1; i < seriesForADF.length; i++) {
          firstDifferences.push(seriesForADF[i] - seriesForADF[i-1])
        }
        const firstDiffSample = firstDifferences.slice(0, 10)
        self.postMessage({ 
          type: "debug", 
          message: `📊 First Differences (Δy) VALID ONLY: First 10: [${firstDiffSample.map(v => v.toFixed(6)).join(', ')}]` 
        })
        
        // Log basic statistics of the VALID series only
        const mean = seriesForADF.reduce((sum, val) => sum + val, 0) / seriesForADF.length
        const variance = seriesForADF.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / seriesForADF.length
        const stdDev = Math.sqrt(variance)
        
        self.postMessage({ 
          type: "debug", 
          message: `📊 ADF Series Stats (VALID ONLY): Mean=${mean.toFixed(6)}, StdDev=${stdDev.toFixed(6)}, Min=${Math.min(...seriesForADF).toFixed(6)}, Max=${Math.max(...seriesForADF).toFixed(6)}` 
        })
      }
      
      const adfResults = await adfTestWasmEnhanced(seriesForADF, seriesTypeForADF, adfModelType)
      
             // GEMINI FIX: Use warmed-up data for euclidean model statistical calculations
       let dataForHalfLife, dataForHurst
       if (modelType === "euclidean") {
         // Use DOUBLE warm-up period (same as ADF test) - NOT single warm-up
         const lookbackWindow = euclideanLookbackWindow
         const doubleWarmupPeriod = 2 * lookbackWindow - 2  // Same logic as ADF test
         const warmedUpSpreadsForStats = spreads.slice(doubleWarmupPeriod).filter(val => isFinite(val) && !isNaN(val))
         
         dataForHalfLife = warmedUpSpreadsForStats
         dataForHurst = warmedUpSpreadsForStats
         
         self.postMessage({ 
           type: "debug", 
           message: `🔧 GEMINI FIX (CORRECTED): Half-life & Hurst using DOUBLE warm-up exclusion. Original: ${spreads.length}, Warmed-up: ${warmedUpSpreadsForStats.length} (excluded ${doubleWarmupPeriod} double warm-up points)` 
         })
       } else {
         dataForHalfLife = modelType === "ratio" ? ratios : spreads
         dataForHurst = modelType === "ratio" ? ratios : spreads
       }
       
       const halfLifeResult = calculateHalfLife(dataForHalfLife)
       const hurstExponent = calculateHurstExponent(dataForHurst)
      const practicalTradeHalfLife = calculatePracticalTradeHalfLife(zScores, entryThreshold, exitThreshold)

      const tableData = []
      for (let i = 0; i < dates.length; i++) {
        const row = {
          date: dates[i],
          priceA: stockAPrices[i],
          priceB: stockBPrices[i],
          zScore: zScores[i],
          halfLife: rollingHalfLifes[i] !== null ? rollingHalfLifes[i].toFixed(2) : "N/A",
        }
        if (modelType === "ratio") {
          row.ratio = ratios[i]
        } else if (modelType === "ols" || modelType === "kalman") {
          row.alpha = alphas[i]
          row.hedgeRatio = hedgeRatios[i]
          row.spread = spreads[i]
        } else if (modelType === "euclidean") {
          // Show Gemini model values: individual Z-scores, spread, and spread Z-score
          row.zScoreA = alphas[i]  // Individual Z-score for Stock A
          row.zScoreB = hedgeRatios[i]  // Individual Z-score for Stock B
          row.spread = spreads[i]  // Z_A - Z_B
          row.spreadZScore = zScores[i]  // Z-score of the spread (our trading signal)
        }
        tableData.push(row)
      }

      const rollingMean = []
      const rollingUpperBand1 = []
      const rollingLowerBand1 = []
      const rollingUpperBand2 = []
      const rollingLowerBand2 = []

      const dataForBands = modelType === "ratio" ? ratios : modelType === "euclidean" ? spreads : spreads
      const rollingStatsWindow =
        modelType === "ratio"
          ? ratioLookbackWindow
          : modelType === "euclidean"
            ? euclideanLookbackWindow
            : olsLookbackWindow

      for (let i = 0; i < dataForBands.length; i++) {
        const windowStart = Math.max(0, i - rollingStatsWindow + 1)
        const window = dataForBands.slice(windowStart, i + 1)
        const mean = window.reduce((sum, val) => sum + val, 0) / window.length
        const stdDev = Math.sqrt(window.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (window.length > 1 ? window.length - 1 : window.length))

        rollingMean.push(mean)
        rollingUpperBand1.push(mean + stdDev)
        rollingLowerBand1.push(mean - stdDev)
        rollingUpperBand2.push(mean + 2 * stdDev)
        rollingLowerBand2.push(mean - 2 * stdDev)
      }

      analysisData = {
        dates,
        ratios,
        spreads,
        distances,
        hedgeRatios,
        alphas,
        zScores,
        stockAPrices,
        stockBPrices,
        statistics: {
          correlation,
          meanRatio: modelType === "ratio" ? meanValue : undefined,
          stdDevRatio: modelType === "ratio" ? stdDevValue : undefined,
          meanSpread: modelType === "ols" || modelType === "kalman" ? meanValue : undefined,
          stdDevSpread: modelType === "ols" || modelType === "kalman" ? stdDevValue : undefined,
          meanEuclideanSpread: modelType === "euclidean" ? meanValue : undefined,
          stdDevEuclideanSpread: modelType === "euclidean" ? stdDevValue : undefined,
          minZScore,
          maxZScore,
          adfResults,
          halfLife: halfLifeResult.halfLife,
          halfLifeValid: halfLifeResult.isValid,
          hurstExponent,
          practicalTradeHalfLife,
          modelType,
        },
        tableData,
        chartData: {
          rollingMean,
          rollingUpperBand1,
          rollingLowerBand1,
          rollingUpperBand2,
          rollingLowerBand2,
        },
      }
    } catch (e) {
      console.error("Error in enhanced calculations worker:", e)
      error = e.message || "An unknown error occurred during analysis."
    } finally {
      self.postMessage({ type: "analysisComplete", analysisData, error })
    }
  }
}

// Helper for matrix addition (needed by Kalman)
const matrixAdd2x2 = (A, B) => {
  return [
    [A[0][0] + B[0][0], A[0][1] + B[0][1]],
    [A[1][0] + B[1][0], A[1][1] + B[1][1]],
  ]
}
