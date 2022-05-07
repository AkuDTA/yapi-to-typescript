import path from 'path'

export const castArray = <T extends unknown>(v: T | ReadonlyArray<T>) => {
  if (Array.isArray(v)) {
    return v
  }
  return [v]
}

export const noop = () => void 0

export const isEmpty = <T extends any>(v: T): boolean => {
  if (v == null) {
    return true
  }
  // const type = typeof v;
  if (typeof v === 'undefined') {
    return true
  } else if (typeof v === 'number') {
    return false
  } else if (typeof v === 'string') {
    return false
  } else if (typeof v === 'object') {
    if (Array.isArray(v)) {
      return v.length === 0
    }
    return Object.keys(v as Record<string, unknown>).length === 0
  }
  return false
}

/**
 * 抛出错误。
 *
 * @param msg 错误信息
 */
export const throwError = (...msg: string[]): never => {
  /* istanbul ignore next */
  throw new Error(msg.join(''))
}

export const last = <T extends unknown>(v: T) => {
  if (typeof v === 'string') {
    return v[v.length - 1]
  } else if (typeof v === 'object') {
    if (Array.isArray(v)) {
      return v[v.length - 1]
    }
  }
  return undefined
}

type PartialShallow<T> = {
  [P in keyof T]?: T[P] extends object ? object : T[P]
}

type GroupByCallback<T extends any[]> =
  | string
  | number
  | symbol
  | PartialShallow<T>
  | ((item: T[0]) => unknown)

export const groupBy = <T extends any[]>(
  v: T,
  cb: GroupByCallback<T>,
): Record<string, T> => {
  return v.reduce((pre, current) => {
    const key = (typeof cb === 'function' ? cb(current) : cb) as string
    if (pre[key]) {
      pre[key].push(current)
    } else {
      pre[key] = [current]
    }
    return pre
  }, {} as Record<string, T>)
}
export const isFunction = (v: any): v is (...args: any[]) => any => {
  return v instanceof Function
}

/**
 * 将路径统一为 unix 风格的路径。
 *
 * @param path 路径
 * @returns unix 风格的路径
 */
export function toUnixPath(path: string) {
  return path.replace(/[/\\]+/g, '/')
}

/**
 * 获得规范化的相对路径。
 *
 * @param from 来源路径
 * @param to 去向路径
 * @returns 相对路径
 */
export function getNormalizedRelativePath(from: string, to: string) {
  return toUnixPath(path.relative(path.dirname(from), to))
    .replace(/^(?=[^.])/, './')
    .replace(/\.(ts|js)x?$/i, '')
}
