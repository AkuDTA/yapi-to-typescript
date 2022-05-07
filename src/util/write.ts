import fs from 'fs-extra'
import prettier from 'prettier'
import { getNormalizedRelativePath } from '.'
import { SyntheticalConfig } from '../types'

interface OutputFileList {
  [
    /**
     * 即将 输出的文件 路径
     * 后续 可以支持 jsx 格式
     */
    outputFilePath: string
  ]: {
    syntheticalConfig: SyntheticalConfig
    content: string[]
    /**
     * base request 的路径
     * 后续可以支持 jsx 格式
     */
    requestFunctionFilePath: string
  }
}
// 可以考虑 支持 .jsx? 后缀
// const replaceMIME = (v: string) => v.replace(/\.js(x)?$/, '.ts$1');

const getTypesPath = (path: string) => path

const run = async (cb: (...params: any[]) => any) => {
  try {
    const res = cb()
    if (res instanceof Promise) {
      return [null, await res]
    }
    return [null, res]
  } catch (e) {
    return [e, null]
  }
}

export const getPrettierOptions = async (): Promise<prettier.Options> => {
  const prettierOptions: prettier.Options = {
    parser: 'typescript',
    printWidth: 120,
    tabWidth: 2,
    singleQuote: true,
    semi: false,
    trailingComma: 'all',
    bracketSpacing: false,
    endOfLine: 'lf',
  }

  // 测试时跳过本地配置的解析
  if (process.env.JEST_WORKER_ID) {
    return prettierOptions
  }

  const [prettierConfigPathErr, prettierConfigPath] = await run(() =>
    prettier.resolveConfigFile(),
  )
  if (prettierConfigPathErr || !prettierConfigPath) {
    return prettierOptions
  }

  const [prettierConfigErr, prettierConfig] = await run(() =>
    prettier.resolveConfig(prettierConfigPath),
  )
  if (prettierConfigErr || !prettierConfig) {
    return prettierOptions
  }

  return {
    ...prettierOptions,
    ...prettierConfig,
    parser: 'typescript',
  }
}

const createFile = async (
  content: string[] | string,
  outputFilePath: string,
) => {
  const prettyContent = prettier.format(
    Array.isArray(content) ? content.join('\n\n').trim() : content,
    {
      ...(await getPrettierOptions()),
      filepath: outputFilePath,
    },
  )
  await fs.outputFile(getTypesPath(outputFilePath), prettyContent)
}

export const write = async (outputFileList: OutputFileList) =>
  Promise.all(
    Object.keys(outputFileList).map(async outputFilePath => {
      const { content, syntheticalConfig, requestFunctionFilePath } =
        outputFileList[outputFilePath]
      // todo 增加 当同名文件存在时 使用 内容 追加 而不是 覆盖，减少 git 上 提交内容的 对比

      // 在指定的 type folder 下创建与 请求函数 同名的 类型文件
      // todo 将 content 替换为 declaration content
      const declarationContent = content
      createFile(declarationContent, outputFilePath)

      if (!syntheticalConfig.declarationOnly) {
        // 在指定的 action folder 下创建与 请求函数 文件
        createFile(
          `
                    import request from ${JSON.stringify(
                      getNormalizedRelativePath(
                        outputFilePath,
                        requestFunctionFilePath,
                      ),
                    )}

                    ${content.join('\n\n').trim()}
                `,
          outputFilePath,
        )
        // 如果目标 类型是 js
        // 则用 tsc 编译 刚生成的 ts文件
        // 然后删除原始的 ts 文件。
      }
    }),
  )
