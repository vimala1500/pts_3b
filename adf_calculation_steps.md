# ADF T-Statistic Calculation Steps for Euclidean Model

## � CRITICAL BUG IDENTIFIED BY GEMINI AI

**The Primary Issue**: We were including initial warmup period zeros in the ADF test input!

**Problem**: For 180-day lookback with 1000 data points:
- ❌ **Before**: Passing all 1000 values (including 179 zeros) to ADF test
- ✅ **After**: Passing only 821 valid calculated spread Z-scores to ADF test

**Root Cause**: Our rolling Z-score calculation sets initial values to 0 for the warmup period, but we were feeding these zeros to the ADF test instead of excluding them like pandas `.dropna()` does.

**Impact**: This severely distorts ADF results, explaining the large difference in t-statistics (-7.1754 vs -3.3985).

## �📊 Complete Step-by-Step Process

### **Phase 1: Data Preparation**

#### Step 1.1: Individual Z-Score Calculation
For each stock (A and B), calculate rolling Z-scores:
```javascript
for (let i = 0; i < prices.length; i++) {
  if (i < lookbackWindow - 1) {
    zScores.push(0) // Not enough data
    continue
  }
  
  // Get rolling window of prices
  windowPrices = prices.slice(i - lookbackWindow + 1, i + 1)
  
  // Calculate rolling mean
  rollingMean = sum(windowPrices) / windowPrices.length
  
  // Calculate rolling standard deviation (SAMPLE std dev - ÷N-1)
  variance = sum((price - rollingMean)²) / (windowPrices.length - 1)  // N-1 for sample std dev
  rollingStdDev = sqrt(variance)
  
  // Calculate Z-score
  zScore = (currentPrice - rollingMean) / rollingStdDev
}
```

#### Step 1.2: Spread Calculation
```javascript
// Create spread series: Z_A - Z_B
spreads = zScoresA.map((zA, i) => zA - zScoresB[i])
```

#### Step 1.3: Spread Z-Score Calculation (Final Trading Signal)
```javascript
for (let i = 0; i < spreads.length; i++) {
  if (i < lookbackWindow - 1) {
    spreadZScores.push(0)
    continue
  }
  
  // Get rolling window of spreads
  windowSpreads = spreads.slice(i - lookbackWindow + 1, i + 1)
  
  // Calculate rolling mean of spreads
  rollingMeanSpread = sum(windowSpreads) / windowSpreads.length
  
  // Calculate rolling standard deviation of spreads (SAMPLE std dev - ÷N-1)
  spreadVariance = sum((spread - rollingMeanSpread)²) / (windowSpreads.length - 1)
  rollingStdDevSpread = sqrt(spreadVariance)
  
  // Calculate Z-score of current spread (FINAL TRADING SIGNAL)
  currentSpread = spreads[i]
  spreadZScore = (currentSpread - rollingMeanSpread) / rollingStdDevSpread
  
  spreadZScores.push(spreadZScore)
}
```

### **Phase 2: ADF Test Preparation**

#### Step 2.1: Input Series Selection
```javascript
// For Euclidean model: Use spread Z-scores (NOT raw spread)
seriesForADF = spreadZScores  // The final trading signal series
```

#### Step 2.2: CRITICAL - Remove Warmup Period
```javascript
// GEMINI IDENTIFIED ISSUE: Remove initial zeros/placeholder values from warmup period
// For 180-day lookback: Remove first 179 values, keep only valid calculated Z-scores
if (modelType === "euclidean") {
  const lookbackWindow = euclideanLookbackWindow
  // Start from first valid calculation (skip warmup period)
  seriesForADF = zScores.slice(lookbackWindow - 1).filter(val => isFinite(val) && !isNaN(val))
  // Expected length: totalDataPoints - (lookbackWindow - 1)
  // Example: 1000 - 179 = 821 valid data points for ADF test
}
```

#### Step 2.3: Data Cleaning
```javascript
// The filtering above already handles NaN and Infinity values
// Only valid, calculated spread Z-scores are passed to ADF test
```

#### Step 2.4: Model Type Conversion
```javascript
// Convert from custom model type to standard econometric model type
adfModelType = "constant"  // Standard ADF model with constant term
```

### **Phase 3: ADF Test Execution (WASM)**

#### Step 3.1: WASM Function Call
```javascript
result = calculate_complete_adf_test(new Float64Array(cleanData), "constant")
```

#### Step 3.2: ADF Regression Model (Internal to WASM)
The WASM function performs the following regression:
```
Δy_t = α + βy_{t-1} + Σ(i=1 to p) γ_i Δy_{t-i} + ε_t
```

Where:
- `y_t` = spread Z-score at time t (our trading signal)
- `Δy_t` = first difference: `y_t - y_{t-1}` 
- `y_{t-1}` = lagged level of the spread Z-score
- `p` = optimal number of lags (selected by AIC criterion)
- `α` = constant term
- `β` = coefficient of lagged level (THIS IS WHAT WE TEST)
- `γ_i` = coefficients of lagged differences
- `ε_t` = error term

#### Step 3.3: Hypothesis Testing
- **Null Hypothesis (H0)**: β = 0 (unit root exists, series is non-stationary)
- **Alternative Hypothesis (H1)**: β < 0 (no unit root, series is stationary)

#### Step 3.4: T-Statistic Calculation
```
t-statistic = β̂ / SE(β̂)
```

Where:
- `β̂` = estimated coefficient of y_{t-1} from OLS regression
- `SE(β̂)` = standard error of β̂

The standard error is calculated as:
```
SE(β̂) = sqrt(s² * (X'X)⁻¹[β,β])
```

Where:
- `s²` = residual variance from the regression
- `(X'X)⁻¹[β,β]` = diagonal element corresponding to β in the variance-covariance matrix

### **Phase 4: Result Interpretation**

#### Step 4.1: Statistical Decision
```javascript
// Compare t-statistic to critical values
if (t_statistic < critical_value_5%) {
  isStationary = true  // Reject H0, series is stationary
} else {
  isStationary = false // Fail to reject H0, series is non-stationary
}
```

#### Step 4.2: P-Value Calculation
The p-value is calculated based on the distribution of the ADF statistic under the null hypothesis.

## 🔍 Key Debugging Points

### **1. Data Differences**
- **Individual Z-scores**: Check if sample std dev (÷N-1) vs population std dev (÷N) matches Gemini
- **Spread values**: Verify Z_A - Z_B calculations match exactly
- **Spread Z-scores**: Ensure final trading signal calculation is identical

### **2. ADF Input Series**
- **Series used**: Spread Z-scores (not raw spread, not individual Z-scores)
- **Data cleaning**: How NaN/Infinity values are handled
- **Series length**: Number of valid data points going into ADF test

### **3. WASM ADF Implementation**
- **Model type**: "constant" (regression with constant term)
- **Lag selection**: AIC-based optimal lag selection
- **Regression method**: OLS estimation
- **Critical values**: MacKinnon (1996) critical value tables

### **4. Potential Sources of Divergence**
1. **Standard deviation method** (sample vs population)
2. **ADF model specification** (constant vs trend vs none)
3. **Lag selection criteria** (AIC vs BIC vs fixed lags)
4. **Critical value tables** (different statistical references)
5. **Numerical precision** (WASM vs Python/R floating point)

## 📊 Debug Output Analysis

When running the Euclidean model, the debug output will show:

1. **Individual Z-score ranges** for both stocks
2. **Spread values** (Z_A - Z_B) sample
3. **Spread Z-score values** (final trading signal) sample
4. **ADF input data** (first/last 10 values)
5. **First differences** (Δy) calculation
6. **Series statistics** (mean, std dev, min, max)
7. **ADF results** (t-statistic, lags, AIC, p-value, critical values)

Compare these debug values with Gemini's intermediate calculations to identify the exact point of divergence.

## 🎯 Expected Alignment

After the fixes:
- Individual Z-scores should match Gemini's using pandas `.rolling().std()` default
- ADF test should use the same input series as Gemini's "Spread_ZScore_Rolling"
- T-statistic should be calculated using standard econometric methods
- Results should converge to within numerical precision limits