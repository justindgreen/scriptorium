/** A source of uniformly distributed numbers in [0, 1). */
export type Rng = () => number

/** Produces one face value (1..faces) per call. This is what the evaluator consumes. */
export type DieRoller = (faces: number) => number

type CryptoLike = { getRandomValues: (array: Uint32Array) => Uint32Array }

/** Cryptographically strong RNG for real rolls (Web Crypto: Node 20+ and every browser). */
export function createCryptoRng(): Rng {
  const cryptoApi = (globalThis as { crypto?: CryptoLike }).crypto
  if (!cryptoApi?.getRandomValues) throw new Error('Web Crypto is not available in this runtime')
  const buffer = new Uint32Array(1)
  return () => {
    cryptoApi.getRandomValues(buffer)
    return buffer[0]! / 4_294_967_296
  }
}

/** Deterministic RNG (mulberry32) for tests and reproducible fixtures. */
export function createSeededRng(seed: number): Rng {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

/** Turns a uniform RNG into a die roller. */
export function dieRoller(rng: Rng): DieRoller {
  return (faces) => {
    if (!Number.isInteger(faces) || faces < 1) throw new Error(`cannot roll a d${faces}`)
    return 1 + Math.floor(rng() * faces)
  }
}

/**
 * Replays fixed face values in order, for tests and for results supplied from physical dice.
 * Throws when a value is not a face of the die requested or when the script runs out.
 */
export function scriptedDice(values: readonly number[]): DieRoller & { remaining: () => number } {
  let index = 0
  const roller = ((faces: number) => {
    const value = values[index]
    if (value === undefined) throw new Error('scripted dice ran out of values')
    index += 1
    if (!Number.isInteger(value) || value < 1 || value > faces) {
      throw new Error(`scripted value ${value} is not a face of d${faces}`)
    }
    return value
  }) as DieRoller & { remaining: () => number }
  roller.remaining = () => values.length - index
  return roller
}
