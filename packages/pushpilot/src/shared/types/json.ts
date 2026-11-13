/**
 * Any value that survives `JSON.stringify` unchanged: strings, finite numbers,
 * booleans, `null`, arrays, and plain objects of those. No `undefined`,
 * functions, class instances, `NaN`, `Infinity`, or circular references.
 */
export type Json =
	| string
	| number
	| boolean
	| null
	| readonly Json[]
	| { readonly [key: string]: Json };
