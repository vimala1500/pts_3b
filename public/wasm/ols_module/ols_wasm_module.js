import * as wasm from "./ols_wasm_module_bg.wasm"

const lTextDecoder = typeof TextDecoder === "undefined" ? (0, module.require)("util").TextDecoder : TextDecoder

const cachedTextDecoder = new lTextDecoder("utf-8", { ignoreBOM: true, fatal: true })

cachedTextDecoder.decode()

let cachegetUint8Memory0 = null
function getUint8Memory0() {
  if (cachegetUint8Memory0 === null || cachegetUint8Memory0.buffer !== wasm.memory.buffer) {
    cachegetUint8Memory0 = new Uint8Array(wasm.memory.buffer)
  }
  return cachegetUint8Memory0
}

function getStringFromWasm0(ptr, len) {
  return cachedTextDecoder.decode(getUint8Memory0().subarray(ptr, ptr + len))
}

const heap = new Array(32).fill(undefined)

heap.push(undefined, undefined, undefined)

let heap_next = heap.length

function addHeapObject(obj) {
  if (heap_next === heap.length) heap.push(heap.length + 1)
  const idx = heap_next
  heap_next = heap[idx]

  heap[idx] = obj
  return idx
}

function getObject(idx) {
  return heap[idx]
}

function dropObject(idx) {
  if (idx < 36) return
  heap[idx] = heap_next
  heap_next = idx
}

function takeObject(idx) {
  const ret = getObject(idx)
  dropObject(idx)
  return ret
}

let WASM_VECTOR_LEN = 0

const lTextEncoder = typeof TextEncoder === "undefined" ? (0, module.require)("util").TextEncoder : TextEncoder

const cachedTextEncoder = new lTextEncoder("utf-8")

const encodeString =
  typeof cachedTextEncoder.encodeInto === "function"
    ? (arg, view) => cachedTextEncoder.encodeInto(arg, view)
    : (arg, view) => {
        const buf = cachedTextEncoder.encode(arg)
        view.set(buf)
        return {
          read: arg.length,
          written: buf.length,
        }
      }

function passStringToWasm0(arg, malloc, realloc) {
  if (realloc === undefined) {
    const buf = cachedTextEncoder.encode(arg)
    const ptr = malloc(buf.length)
    getUint8Memory0()
      .subarray(ptr, ptr + buf.length)
      .set(buf)
    WASM_VECTOR_LEN = buf.length
    return ptr
  }

  let len = arg.length
  let ptr = malloc(len)

  const mem = getUint8Memory0()

  let offset = 0

  for (; offset < len; offset++) {
    const code = arg.charCodeAt(offset)
    if (code > 0x7f) break
    mem[ptr + offset] = code
  }

  if (offset !== len) {
    if (offset !== 0) {
      arg = arg.slice(offset)
    }
    ptr = realloc(ptr, len, (len = offset + arg.length * 3))
    const view = getUint8Memory0().subarray(ptr + offset, ptr + len)
    const ret = encodeString(arg, view)

    offset += ret.written
  }

  WASM_VECTOR_LEN = offset
  return ptr
}

let cachegetFloat64Memory0 = null
function getFloat64Memory0() {
  if (cachegetFloat64Memory0 === null || cachegetFloat64Memory0.buffer !== wasm.memory.buffer) {
    cachegetFloat64Memory0 = new Float64Array(wasm.memory.buffer)
  }
  return cachegetFloat64Memory0
}

function getArrayF64FromWasm0(ptr, len) {
  return getFloat64Memory0().subarray(ptr / 8, ptr / 8 + len)
}
/**
 */
export class RegressionResults {
  static __wrap(ptr) {
    const obj = Object.create(RegressionResults.prototype)
    obj.ptr = ptr

    return obj
  }

  __destroy_into_raw() {
    const ptr = this.ptr
    this.ptr = 0

    return ptr
  }

  free() {
    const ptr = this.__destroy_into_raw()
    wasm.__wbg_regressionresults_free(ptr)
  }
  /**
   * @returns {Float64Array}
   */
  get coefficients() {
    try {
      const retptr = wasm.__wbg_get_regressionresults_coefficients(this.ptr)
      const retlen = wasm.__wbg_get_array_f64_length(retptr)
      const realRet = getArrayF64FromWasm0(retptr, retlen).slice()
      wasm.__wbg_free_array_f64(retptr, retlen)
      return realRet
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(-16)
    }
  }
  /**
   * @param {Float64Array} arg0
   */
  set coefficients(arg0) {
    const ptr0 = passArrayF64ToWasm0(arg0, wasm.__wbindgen_malloc)
    const len0 = WASM_VECTOR_LEN
    wasm.__wbg_set_regressionresults_coefficients(this.ptr, ptr0, len0)
  }
  /**
   * @returns {Float64Array}
   */
  get std_errors() {
    try {
      const retptr = wasm.__wbg_get_regressionresults_std_errors(this.ptr)
      const retlen = wasm.__wbg_get_array_f64_length(retptr)
      const realRet = getArrayF64FromWasm0(retptr, retlen).slice()
      wasm.__wbg_free_array_f64(retptr, retlen)
      return realRet
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(-16)
    }
  }
  /**
   * @param {Float64Array} arg0
   */
  set std_errors(arg0) {
    const ptr0 = passArrayF64ToWasm0(arg0, wasm.__wbindgen_malloc)
    const len0 = WASM_VECTOR_LEN
    wasm.__wbg_set_regressionresults_std_errors(this.ptr, ptr0, len0)
  }
  /**
   * @returns {number}
   */
  get ssr() {
    const ret = wasm.__wbg_get_regressionresults_ssr(this.ptr)
    return ret
  }
  /**
   * @param {number} arg0
   */
  set ssr(arg0) {
    wasm.__wbg_set_regressionresults_ssr(this.ptr, arg0)
  }
  /**
   * @returns {number}
   */
  get nobs() {
    const ret = wasm.__wbg_get_regressionresults_nobs(this.ptr)
    return ret >>> 0
  }
  /**
   * @param {number} arg0
   */
  set nobs(arg0) {
    wasm.__wbg_set_regressionresults_nobs(this.ptr, arg0)
  }
  /**
   * @returns {number}
   */
  get nparams() {
    const ret = wasm.__wbg_get_regressionresults_nparams(this.ptr)
    return ret >>> 0
  }
  /**
   * @param {number} arg0
   */
  set nparams(arg0) {
    wasm.__wbg_set_regressionresults_nparams(this.ptr, arg0)
  }
}

let cachegetInt32Memory0 = null
function getInt32Memory0() {
  if (cachegetInt32Memory0 === null || cachegetInt32Memory0.buffer !== wasm.memory.buffer) {
    cachegetInt32Memory0 = new Int32Array(wasm.memory.buffer)
  }
  return cachegetInt32Memory0
}

function passArrayF64ToWasm0(arg, malloc) {
  const ptr = malloc(arg.length * 8)
  getFloat64Memory0().set(arg, ptr / 8)
  WASM_VECTOR_LEN = arg.length
  return ptr
}
/**
 * @param {Float64Array} y_values_js
 * @param {Float64Array} x_matrix_js
 * @param {number} num_observations
 * @param {number} num_predictors
 * @returns {RegressionResults}
 */
export function run_multi_linear_regression_wasm(y_values_js, x_matrix_js, num_observations, num_predictors) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16)
    const ptr0 = passArrayF64ToWasm0(y_values_js, wasm.__wbindgen_malloc)
    const len0 = WASM_VECTOR_LEN
    const ptr1 = passArrayF64ToWasm0(x_matrix_js, wasm.__wbindgen_malloc)
    const len1 = WASM_VECTOR_LEN
    wasm.run_multi_linear_regression_wasm(retptr, ptr0, len0, ptr1, len1, num_observations, num_predictors)
    var r0 = getInt32Memory0()[retptr / 4 + 0]
    var r1 = getInt32Memory0()[retptr / 4 + 1]
    var r2 = getInt32Memory0()[retptr / 4 + 2]
    if (r2) {
      throw takeObject(r1)
    }
    return RegressionResults.__wrap(r0)
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16)
  }
}

function handleError(f, args) {
  try {
    return f.apply(this, args)
  } catch (e) {
    wasm.__wbindgen_exn_store(addHeapObject(e))
  }
}

export const __wbindgen_string_new = (arg0, arg1) => {
  const ret = getStringFromWasm0(arg0, arg1)
  return addHeapObject(ret)
}

export const __wbindgen_object_drop_ref = (arg0) => {
  takeObject(arg0)
}

export const __wbindgen_realloc = (arg0, arg1, arg2) => {
  const ret = wasm.__wbindgen_realloc(arg0, arg1, arg2)
  return ret
}

export const __wbindgen_malloc = (arg0) => {
  const ret = wasm.__wbindgen_malloc(arg0)
  return ret
}

export const __wbindgen_array_new = (arg0, arg1) => {
  const ret = new Array(arg1)
  return addHeapObject(ret)
}

export const __wbindgen_error_new = (arg0, arg1) => {
  const ret = new Error(getStringFromWasm0(arg0, arg1))
  return addHeapObject(ret)
}

function debugString(val) {
  // Custom debug string implementation
  return val.toString()
}

export const __wbindgen_jsval_eq = (arg0, arg1) => {
  const ret = getObject(arg0) === getObject(arg1)
  return ret
}

export const __wbindgen_boolean_get = (arg0) => {
  const ret = typeof getObject(arg0) === "boolean" ? (getObject(arg0) ? 1 : 0) : 2
  return ret
}

export const __wbindgen_number_get = (arg0, arg1) => {
  const obj = getObject(arg1)
  const ret = typeof obj === "number" ? obj : undefined
  getFloat64Memory0()[arg0 / 8 + 0] = ret === undefined ? 0 : ret
  getInt32Memory0()[arg0 / 4 + 2] = ret === undefined ? 0 : 1
}

export const __wbindgen_is_object = (arg0) => {
  const ret = typeof getObject(arg0) === "object" && getObject(arg0) !== null
  return ret
}

export const __wbindgen_is_function = (arg0) => {
  const ret = typeof getObject(arg0) === "function"
  return ret
}

export const __wbindgen_is_undefined = (arg0) => {
  const ret = getObject(arg0) === undefined
  return ret
}

export const __wbindgen_object_clone_ref = (arg0) => {
  const ret = getObject(arg0)
  return addHeapObject(ret)
}

export const __wbg_call_f604d3a345195784 = () =>
  handleError((arg0, arg1, arg2) => {
    const ret = getObject(arg0).call(getObject(arg1), getObject(arg2))
    return addHeapObject(ret)
  })

export const __wbg_new_59cb74e4237e6998 = (arg0) => {
  const ret = new Error(getStringFromWasm0(arg0, 0)) // Updated to use 0 as arg1
  return addHeapObject(ret)
}

export const __wbg_stack_558ba59f466fc348 = (arg0, arg1) => {
  const ret = getObject(arg1).stack
  const ptr0 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc)
  const len0 = WASM_VECTOR_LEN
  getInt32Memory0()[arg0 / 4 + 1] = len0
  getInt32Memory0()[arg0 / 4 + 0] = ptr0
}

export const __wbg_error_4bb6c2a97407129a = (arg0, arg1) => {
  try {
    console.error(getStringFromWasm0(arg0, arg1))
  } finally {
    wasm.__wbindgen_free(arg0, arg1)
  }
}

export const __wbindgen_debug_string = (arg0, arg1) => {
  const ret = debugString(getObject(arg1))
  const ptr0 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc)
  const len0 = WASM_VECTOR_LEN
  getInt32Memory0()[arg0 / 4 + 1] = len0
  getInt32Memory0()[arg0 / 4 + 0] = ptr0
}

export const __wbindgen_throw = (arg0, arg1) => {
  throw new Error(getStringFromWasm0(arg0, arg1))
}

export const __wbindgen_memory = () => {
  const ret = wasm.memory
  return addHeapObject(ret)
}
