# ADF T-Statistic Calculation Steps for Euclidean Model

## 🚨 CRITICAL BUG IDENTIFIED: DOUBLE ROLLING WINDOW EFFECT

**The Primary Issue**: We discovered the "double rolling window" effect in spread Z-score calculations!

**The Double Rolling Window Effect**: 
For a 60-day lookback window:
1. **First Rolling Window**: Individual Z-scores need 60 days → Valid from day 60
2. **Second Rolling Window**: Spread Z-scores need 60 valid spread values → Valid from day 119 (60 + 59)

**Problem**: For 60-day lookback with 1000 data points:
- ❌ **Before**: Spread Z-scores starting from day 60 (using invalid values in rolling calculation)
- ✅ **After**: Spread Z-scores starting from day 119 (using only valid spread values)

**Root Cause**: 
- Individual Z-scores: `TCS_Rolling_ZScore`, `HCLTECH_Rolling_ZScore` → Valid from day 60
- Spread values: `Z_A - Z_B` → Valid from day 60  
- **Spread Z-scores**: Need 60 valid spread values → Valid from day 119 (NOT day 60!)

**Impact**: Our spread Z-scores were 10-15x larger because we included invalid values in the rolling mean/std dev calculations.

**Formula for Double Warmup**:
```
Double Warmup Period = 2 × lookbackWindow - 2
For 60-day: 2 × 60 - 2 = 118 days
For 180-day: 2 × 180 - 2 = 358 days
```

## 📊 Complete Step-by-Step Process

### **Phase 1: Data Preparation**

#### Step 1.1: Individual Z-Score Calculation
For each stock (A and B), calculate rolling Z-scores:
```javascript
for (let i = 0; i < prices.length; i++) {
  if (i < lookbackWindow - 1) {
    zScores.push(0) // Not enough data - will be excluded later
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
// Valid from day 60 onwards (when individual Z-scores become valid)
```

#### Step 1.3: Spread Z-Score Calculation (Final Trading Signal) - CRITICAL FIX
```javascript
for (let i = 0; i < spreads.length; i++) {
  // DOUBLE ROLLING EFFECT: Need to account for two warmup periods
  const firstValidSpreadIndex = lookbackWindow - 1  // Day 60 for 60-day lookback
  const firstValidSpreadZScoreIndex = firstValidSpreadIndex + lookbackWindow - 1  // Day 119 for 60-day lookback
  
  if (i < firstValidSpreadZScoreIndex) {
    spreadZScores.push(0) // Not enough valid spread data
    continue
  }
  
  // Get rolling window of VALID spreads only (skip initial zeros/NaNs)
  const validSpreadsStartIndex = firstValidSpreadIndex
  const windowStart = Math.max(validSpreadsStartIndex, i - lookbackWindow + 1)
  const windowSpreads = spreads.slice(windowStart, i + 1)
  
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

#### Step 2.2: CRITICAL - Remove Double Warmup Period
```javascript
// DOUBLE ROLLING EFFECT: Remove both warmup periods before ADF test
if (modelType === "euclidean") {
  const lookbackWindow = euclideanLookbackWindow
  const doubleWarmupPeriod = 2 * lookbackWindow - 2  // e.g., 118 for 60-day lookback
  
  // Start from first valid spread Z-score calculation
  seriesForADF = zScores.slice(doubleWarmupPeriod).filter(val => isFinite(val) && !isNaN(val))
  
  // Expected lengths:
  // 60-day lookback: 1000 - 118 = 882 valid data points
  // 180-day lookback: 1000 - 358 = 642 valid data points
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

## 🔍 Key Insights from Double Rolling Window Fix

### **Timeline for 60-day Lookback:**
- **Days 1-59**: Individual Z-scores = 0 (first warmup)
- **Day 60**: First valid individual Z-scores → First valid spread value
- **Days 60-118**: Valid spreads accumulating (second warmup)
- **Day 119**: First valid spread Z-score calculation

### **Timeline for 180-day Lookback:**
- **Days 1-179**: Individual Z-scores = 0 (first warmup)
- **Day 180**: First valid individual Z-scores → First valid spread value
- **Days 180-358**: Valid spreads accumulating (second warmup)
- **Day 359**: First valid spread Z-score calculation

### **Why This Matters:**
1. **Gemini's Individual Z-scores**: Match our values exactly ✅
2. **Gemini's Spread values**: Match our values exactly ✅ 
3. **Gemini's Spread Z-scores**: NOW should match our values ✅
4. **ADF Test Results**: Should now be very close to Gemini's ✅

## 🎯 Expected Results After Fix

After implementing the double rolling window fix:
- **Spread Z-scores should start from the correct day** (119 for 60-day, 359 for 180-day)
- **Values should be in similar magnitude** to Gemini's (-0.8 to -1.2 range, not -10 to -15)
- **ADF test input should contain proper number of valid points**
- **T-statistic should be much closer** to Gemini's results

This fix addresses the fundamental calculation error that was causing the 10-15x magnitude difference!