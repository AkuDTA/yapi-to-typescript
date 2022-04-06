export const castArray = <T extends unknown>(v: T | ReadonlyArray<T>) => {
  if (Array.isArray(v)) {
    return v
  }
  return [v]
}
