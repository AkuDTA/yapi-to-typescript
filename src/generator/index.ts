import * as changeCase from 'change-case'
import dayjs from 'dayjs'
import fs from 'fs-extra'
import got from 'got'
import path from 'path'
import prettier from 'prettier'
import { castArray } from '../util'
import { cmd } from './tsc'

import {
  CategoryList,
  CommentConfig,
  Config,
  ExtendedInterface,
  Interface,
  InterfaceList,
  Method,
  Project,
  ProjectConfig,
  QueryStringArrayFormat,
  RequestBodyType,
  ServerConfig,
  SyntheticalConfig,
} from '../types'
import {
  cloneDeepFast,
  dedent,
  groupBy,
  isEmpty,
  isFunction,
  last,
  memoize,
  noop,
  uniq,
  values,
} from 'vtils'

import {
  getCachedPrettierOptions,
  getNormalizedRelativePath,
  getRequestDataJsonSchema,
  getResponseDataJsonSchema,
  jsonSchemaToType,
  sortByWeights,
  throwError,
} from '../utils'

interface OutputFileList {
  [outputFilePath: string]: {
    syntheticalConfig: SyntheticalConfig
    content: string[]
    requestFunctionFilePath: string
  }
}

export interface GeneratorOptions {
  cwd: string
}

export class Generator {
  /** 配置 */
  private config: ServerConfig[] = []

  constructor(config: Config, private options: GeneratorOptions) {
    // config 可能是对象或数组，统一为数组
    this.config = castArray(config)
  }

  async prepare(): Promise<void> {
    this.config = await Promise.all(
      // config 可能是对象或数组，统一为数组
      this.config.map(async item => {
        if (item.serverUrl) {
          item.serverUrl = item.serverUrl.replace(/\/+$/, '')
        }
        return item
      }),
    )
  }

  async generate(): Promise<OutputFileList> {
    const outputFileList: OutputFileList = Object.create(null)

    await Promise.all(
      this.config.map(async (serverConfig, serverIndex) => {
        const projects = serverConfig.projects.reduce<ProjectConfig[]>(
          (projects, project) => {
            projects.push(
              ...castArray(project.token).map(token => ({
                ...project,
                token: token,
              })),
            )
            return projects
          },
          [],
        )
        return Promise.all(
          projects.map(async (projectConfig, projectIndex) => {
            const projectInfo = await this.fetchProjectInfo({
              ...serverConfig,
              ...projectConfig,
            })
            await Promise.all(
              projectConfig.categories.map(
                async (categoryConfig, categoryIndex) => {
                  // 分类处理
                  // 数组化
                  let categoryIds = castArray(categoryConfig.id)
                  // 全部分类
                  if (categoryIds.includes(0)) {
                    categoryIds.push(...projectInfo.cats.map(cat => cat._id))
                  }
                  // 唯一化
                  categoryIds = uniq(categoryIds)
                  // 去掉被排除的分类
                  const excludedCategoryIds = categoryIds
                    .filter(id => id < 0)
                    .map(Math.abs)
                  categoryIds = categoryIds.filter(
                    id => !excludedCategoryIds.includes(Math.abs(id)),
                  )
                  // 删除不存在的分类
                  categoryIds = categoryIds.filter(
                    id => !!projectInfo.cats.find(cat => cat._id === id),
                  )
                  // 顺序化
                  categoryIds = categoryIds.sort()

                  const codes = (
                    await Promise.all(
                      categoryIds.map<
                        Promise<
                          Array<{
                            outputFilePath: string
                            code: string
                            weights: number[]
                          }>
                        >
                      >(async (id, categoryIndex2) => {
                        categoryConfig = {
                          ...categoryConfig,
                          id: id,
                        }
                        const syntheticalConfig: SyntheticalConfig = {
                          ...serverConfig,
                          ...projectConfig,
                          ...categoryConfig,
                        }
                        syntheticalConfig.target =
                          syntheticalConfig.target || 'typescript'

                        // 接口列表
                        let interfaceList = await this.fetchInterfaceList(
                          syntheticalConfig,
                        )
                        interfaceList = interfaceList
                          .map(interfaceInfo => {
                            const { cats: _ignored, ...project } = projectInfo
                            // 实现 _project 字段
                            interfaceInfo._project = project
                            // 预处理
                            const _interfaceInfo = isFunction(
                              syntheticalConfig.preproccessInterface,
                            )
                              ? syntheticalConfig.preproccessInterface(
                                  cloneDeepFast(interfaceInfo),
                                  changeCase,
                                  syntheticalConfig,
                                )
                              : interfaceInfo

                            return _interfaceInfo
                          })
                          .filter(Boolean) as any
                        interfaceList.sort((a, b) => a._id - b._id)

                        const interfaceCodes = await Promise.all(
                          interfaceList.map<
                            Promise<{
                              categoryUID: string
                              outputFilePath: string
                              weights: number[]
                              code: string
                            }>
                          >(async interfaceInfo => {
                            const outputFilePath = path.resolve(
                              this.options.cwd,
                              typeof syntheticalConfig.outputFilePath ===
                                'function'
                                ? syntheticalConfig.outputFilePath(
                                    interfaceInfo,
                                    changeCase,
                                  )
                                : syntheticalConfig.outputFilePath!,
                            )
                            const categoryUID = `_${serverIndex}_${projectIndex}_${categoryIndex}_${categoryIndex2}`
                            const code = await this.generateInterfaceCode(
                              syntheticalConfig,
                              interfaceInfo,
                            )
                            const weights: number[] = [
                              serverIndex,
                              projectIndex,
                              categoryIndex,
                              categoryIndex2,
                            ]
                            return {
                              categoryUID,
                              outputFilePath,
                              weights,
                              code,
                            }
                          }),
                        )

                        const groupedInterfaceCodes = groupBy(
                          interfaceCodes,
                          item => item.outputFilePath,
                        )
                        return Object.keys(groupedInterfaceCodes).map(
                          outputFilePath => {
                            const categoryCode = [
                              ...sortByWeights(
                                groupedInterfaceCodes[outputFilePath],
                              ).map(item => item.code),
                            ]
                              .filter(Boolean)
                              .join('\n\n')
                            if (!outputFileList[outputFilePath]) {
                              outputFileList[outputFilePath] = {
                                syntheticalConfig,
                                content: [],
                                requestFunctionFilePath:
                                  syntheticalConfig.requestFunctionFilePath
                                    ? path.resolve(
                                        this.options.cwd,
                                        syntheticalConfig.requestFunctionFilePath,
                                      )
                                    : path.join(
                                        path.dirname(outputFilePath),
                                        'request.ts',
                                      ),
                              }
                            }
                            return {
                              outputFilePath: outputFilePath,
                              code: categoryCode,
                              weights: last(
                                sortByWeights(
                                  groupedInterfaceCodes[outputFilePath],
                                ),
                              )!.weights,
                            }
                          },
                        )
                      }),
                    )
                  ).flat()

                  for (const groupedCodes of values(
                    groupBy(codes, item => item.outputFilePath),
                  )) {
                    sortByWeights(groupedCodes)
                    outputFileList[groupedCodes[0].outputFilePath].content.push(
                      ...groupedCodes.map(item => item.code),
                    )
                  }
                },
              ),
            )
          }),
        )
      }),
    )

    return outputFileList
  }

  async write(outputFileList: OutputFileList) {
    return Promise.all(
      Object.keys(outputFileList).map(async outputFilePath => {
        let {
          // eslint-disable-next-line prefer-const
          content,
          requestFunctionFilePath,
          // eslint-disable-next-line prefer-const
          syntheticalConfig,
        } = outputFileList[outputFilePath]

        const rawRequestFunctionFilePath = requestFunctionFilePath

        // 支持 .jsx? 后缀
        outputFilePath = outputFilePath.replace(/\.js(x)?$/, '.ts$1')
        requestFunctionFilePath = requestFunctionFilePath.replace(
          /\.js(x)?$/,
          '.ts$1',
        )

        if (!syntheticalConfig.typesOnly) {
          if (!(await fs.pathExists(rawRequestFunctionFilePath))) {
            await fs.outputFile(
              requestFunctionFilePath,
              dedent`
                import type { RequestFunctionParams } from 'yapi-to-typescript'

                export interface RequestOptions {
                  /**
                   * 使用的服务器。
                   *
                   * - \`prod\`: 生产服务器
                   * - \`dev\`: 测试服务器
                   * - \`mock\`: 模拟服务器
                   *
                   * @default prod
                   */
                  server?: 'prod' | 'dev' | 'mock',
                }

                export default function request<TResponseData>(
                  payload: RequestFunctionParams,
                  options: RequestOptions = {
                    server: 'prod',
                  },
                ): Promise<TResponseData> {
                  return new Promise<TResponseData>((resolve, reject) => {
                    // 基本地址
                    const baseUrl = options.server === 'mock'
                      ? payload.mockUrl
                      : options.server === 'dev'
                        ? payload.devUrl
                        : payload.prodUrl

                    // 请求地址
                    const url = \`\${baseUrl}\${payload.path}\`

                    // 具体请求逻辑
                  })
                }
              `,
            )
          }
        }

        // 始终写入主文件
        const rawOutputContent = dedent`
          /* tslint:disable */
          /* eslint-disable */

          /* 该文件由 yapi-to-typescript 自动生成，请勿直接修改！！！ */

          ${
            syntheticalConfig.typesOnly
              ? dedent`
                // @ts-ignore
                type FileData = File

                ${content.join('\n\n').trim()}
              `
              : dedent`
                // @ts-ignore
                // prettier-ignore
                import { QueryStringArrayFormat, Method, RequestBodyType, ResponseBodyType, FileData, prepare } from 'yapi-to-typescript'
                // @ts-ignore
                // prettier-ignore
                import type { RequestConfig, RequestFunctionRestArgs } from 'yapi-to-typescript'
                // @ts-ignore
                import request from ${JSON.stringify(
                  getNormalizedRelativePath(
                    outputFilePath,
                    requestFunctionFilePath,
                  ),
                )}

                type UserRequestRestArgs = RequestFunctionRestArgs<typeof request>

                // Request: 目前 React Hooks 功能有用到
                export type Request<TRequestData, TRequestConfig extends RequestConfig, TRequestResult> = (
                  TRequestConfig['requestDataOptional'] extends true
                    ? (requestData?: TRequestData, ...args: RequestFunctionRestArgs<typeof request>) => TRequestResult
                    : (requestData: TRequestData, ...args: RequestFunctionRestArgs<typeof request>) => TRequestResult
                ) & {
                  requestConfig: TRequestConfig
                }

                ${content.join('\n\n').trim()}
              `
          }
        `
        // ref: https://prettier.io/docs/en/options.html
        const prettyOutputContent = prettier.format(rawOutputContent, {
          ...(await getCachedPrettierOptions()),
          filepath: outputFilePath,
        })
        const outputContent = `${dedent`
          /* prettier-ignore-start */
          ${prettyOutputContent}
          /* prettier-ignore-end */
        `}\n`
        await fs.outputFile(outputFilePath, outputContent)

        // 如果要生成 JavaScript 代码，
        // 则先对主文件进行 tsc 编译，主文件引用到的其他文件也会被编译，
        // 然后，删除原始的 .tsx? 文件。
        if (syntheticalConfig.target === 'javascript') {
          await this.tsc(outputFilePath)
          await Promise.all([
            fs.remove(requestFunctionFilePath).catch(noop),
            fs.remove(outputFilePath).catch(noop),
          ])
        }
      }),
    )
  }
  // 使用 tsc 将 typescript 编译为 JavaScript
  tsc = async (file: string) =>
    new Promise(resolve => {
      cmd({ cwd: this.options.cwd, file }, resolve)
    })

  async fetchApi<T = any>(url: string, query: Record<string, any>): Promise<T> {
    const { body: res } = await got.get<{
      errcode: any
      errmsg: any
      data: any
    }>(url, {
      searchParams: query,
      responseType: 'json',
      https: {
        rejectUnauthorized: false,
      },
    })
    /* istanbul ignore next */
    if (res && res.errcode) {
      throwError(res.errmsg)
    }
    return res.data || res
  }

  fetchProject = memoize(
    async ({ serverUrl, token }: SyntheticalConfig) => {
      const projectInfo = await this.fetchApi<Project>(
        `${serverUrl}/api/project/get`,
        {
          token: token!,
        },
      )
      const basePath = `/${projectInfo.basepath || '/'}`
        .replace(/\/+$/, '')
        .replace(/^\/+/, '/')
      projectInfo.basepath = basePath
      // 实现项目在 YApi 上的地址
      projectInfo._url = `${serverUrl}/project/${projectInfo._id}/interface/api`
      return projectInfo
    },
    ({ serverUrl, token }: SyntheticalConfig) => `${serverUrl}|${token}`,
  )

  fetchExport = memoize(
    async ({ serverUrl, token }: SyntheticalConfig) => {
      const projectInfo = await this.fetchProject({ serverUrl, token })
      const categoryList = await this.fetchApi<CategoryList>(
        `${serverUrl}/api/plugin/export`,
        {
          type: 'json',
          status: 'all',
          isWiki: 'false',
          token: token!,
        },
      )
      return categoryList.map(cat => {
        const projectId = cat.list?.[0]?.project_id || 0
        const catId = cat.list?.[0]?.catid || 0
        // 实现分类在 YApi 上的地址
        cat._url = `${serverUrl}/project/${projectId}/interface/api/cat_${catId}`
        cat.list = (cat.list || []).map(item => {
          const interfaceId = item._id
          // 实现接口在 YApi 上的地址
          item._url = `${serverUrl}/project/${projectId}/interface/api/${interfaceId}`
          item.path = `${projectInfo.basepath}${item.path}`
          return item
        })
        return cat
      })
    },
    ({ serverUrl, token }: SyntheticalConfig) => `${serverUrl}|${token}`,
  )

  /** 获取分类的接口列表 */
  async fetchInterfaceList({
    serverUrl,
    token,
    id,
  }: SyntheticalConfig): Promise<InterfaceList> {
    const category = (
      (await this.fetchExport({ serverUrl, token })) || []
    ).find(
      cat => !isEmpty(cat) && !isEmpty(cat.list) && cat.list[0].catid === id,
    )

    if (category) {
      const { list, ...other } = category
      list.forEach(interfaceInfo => {
        // 实现 _category 字段
        interfaceInfo._category = other
      })
    }

    return category ? category.list : []
  }

  /** 获取项目信息 */
  async fetchProjectInfo(syntheticalConfig: SyntheticalConfig) {
    const projectInfo = await this.fetchProject(syntheticalConfig)
    const projectCats = await this.fetchApi<CategoryList>(
      `${syntheticalConfig.serverUrl}`,
      {
        token: syntheticalConfig.token!,
        project_id: projectInfo._id,
      },
    )
    return {
      ...projectInfo,
      cats: projectCats,
    }
  }

  /** 生成接口代码 */
  async generateInterfaceCode(
    syntheticalConfig: SyntheticalConfig,
    interfaceInfo: Interface,
  ) {
    const extendedInterfaceInfo: ExtendedInterface = {
      ...interfaceInfo,
      parsedPath: path.parse(interfaceInfo.path),
    }
    const requestFunctionName = isFunction(
      syntheticalConfig.getRequestFunctionName,
    )
      ? await syntheticalConfig.getRequestFunctionName(
          extendedInterfaceInfo,
          changeCase,
        )
      : changeCase.camelCase(extendedInterfaceInfo.parsedPath.name)
    const requestConfigName = changeCase.camelCase(
      `${requestFunctionName}RequestConfig`,
    )
    const requestConfigTypeName = changeCase.pascalCase(requestConfigName)
    const requestDataTypeName = isFunction(
      syntheticalConfig.getRequestDataTypeName,
    )
      ? await syntheticalConfig.getRequestDataTypeName(
          extendedInterfaceInfo,
          changeCase,
        )
      : changeCase.pascalCase(`${requestFunctionName}Request`)
    const responseDataTypeName = isFunction(
      syntheticalConfig.getResponseDataTypeName,
    )
      ? await syntheticalConfig.getResponseDataTypeName(
          extendedInterfaceInfo,
          changeCase,
        )
      : changeCase.pascalCase(`${requestFunctionName}Response`)
    const requestDataJsonSchema = getRequestDataJsonSchema(
      extendedInterfaceInfo,
      {},
    )
    const requestDataType = await jsonSchemaToType(
      requestDataJsonSchema,
      requestDataTypeName,
    )
    const responseDataJsonSchema = getResponseDataJsonSchema(
      extendedInterfaceInfo,
      {},
      syntheticalConfig.dataKey,
    )
    const responseDataType = await jsonSchemaToType(
      responseDataJsonSchema,
      responseDataTypeName,
    )
    const isRequestDataOptional = /(\{\}|any)$/s.test(requestDataType)
    // 支持路径参数
    const paramNames = (
      extendedInterfaceInfo.req_params /* istanbul ignore next */ || []
    ).map(item => item.name)
    const paramNamesLiteral = JSON.stringify(paramNames)
    const paramNameType =
      paramNames.length === 0 ? 'string' : `'${paramNames.join("' | '")}'`

    // 支持查询参数
    const queryNames = (
      extendedInterfaceInfo.req_query /* istanbul ignore next */ || []
    ).map(item => item.name)
    const queryNamesLiteral = JSON.stringify(queryNames)
    const queryNameType =
      queryNames.length === 0 ? 'string' : `'${queryNames.join("' | '")}'`

    // 接口注释
    const genComment = (genTitle: (title: string) => string) => {
      const {
        enabled: isEnabled = true,
        title: hasTitle = true,
        category: hasCategory = true,
        tag: hasTag = true,
        requestHeader: hasRequestHeader = true,
        updateTime: hasUpdateTime = true,
        link: hasLink = true,
        extraTags,
      } = {
        ...syntheticalConfig.comment,
      } as CommentConfig
      if (!isEnabled) {
        return ''
      }
      // 转义标题中的 /
      const escapedTitle = String(extendedInterfaceInfo.title).replace(
        /\//g,
        '\\/',
      )
      const description = hasLink
        ? `[${escapedTitle}↗](${extendedInterfaceInfo._url})`
        : escapedTitle
      const summary: Array<
        | false
        | {
            label: string
            value: string | string[]
          }
      > = [
        hasCategory && {
          label: '分类',
          value: hasLink
            ? `[${extendedInterfaceInfo._category.name}↗](${extendedInterfaceInfo._category._url})`
            : extendedInterfaceInfo._category.name,
        },
        hasTag && {
          label: '标签',
          value: extendedInterfaceInfo.tag.map(tag => `\`${tag}\``),
        },
        hasRequestHeader && {
          label: '请求头',
          value: `\`${extendedInterfaceInfo.method.toUpperCase()} ${
            extendedInterfaceInfo.path
          }\``,
        },
        hasUpdateTime && {
          label: '更新时间',
          value: process.env.JEST_WORKER_ID // 测试时使用 unix 时间戳
            ? String(extendedInterfaceInfo.up_time)
            : /* istanbul ignore next */
              `\`${dayjs(extendedInterfaceInfo.up_time * 1000).format(
                'YYYY-MM-DD HH:mm:ss',
              )}\``,
        },
      ]
      if (typeof extraTags === 'function') {
        const tags = extraTags(extendedInterfaceInfo)
        for (const tag of tags) {
          ;(tag.position === 'start' ? summary.unshift : summary.push).call(
            summary,
            {
              label: tag.name,
              value: tag.value,
            },
          )
        }
      }
      const titleComment = hasTitle
        ? dedent`
            * ${genTitle(description)}
            *
          `
        : ''
      const extraComment: string = summary
        .filter(item => typeof item !== 'boolean' && !isEmpty(item.value))
        .map(item => {
          const _item: Exclude<typeof summary[0], boolean> = item as any
          return `* @${_item.label} ${castArray(_item.value).join(', ')}`
        })
        .join('\n')
      return dedent`
        /**
         ${[titleComment, extraComment].filter(Boolean).join('\n')}
         */
      `
    }

    // 请求参数额外信息
    const requestFunctionExtraInfo = {}

    return dedent`
      ${genComment(title => `接口 ${title} 的 **请求类型**`)}
      ${requestDataType.trim()}

      ${genComment(title => `接口 ${title} 的 **返回类型**`)}
      ${responseDataType.trim()}

      ${
        syntheticalConfig.typesOnly
          ? ''
          : dedent`
            ${genComment(title => `接口 ${title} 的 **请求配置的类型**`)}
            type ${requestConfigTypeName} = Readonly<RequestConfig<
              ${JSON.stringify(extendedInterfaceInfo.path)},
              ${JSON.stringify(syntheticalConfig.dataKey) || 'undefined'},
              ${paramNameType},
              ${queryNameType},
              ${JSON.stringify(isRequestDataOptional)}
            >>

            ${genComment(title => `接口 ${title} 的 **请求配置**`)}
            const ${requestConfigName}: ${requestConfigTypeName} = {
              path: ${JSON.stringify(extendedInterfaceInfo.path)},
              method: Method.${extendedInterfaceInfo.method},
              requestHeaders: ${JSON.stringify(
                (extendedInterfaceInfo.req_headers || [])
                  .filter(item => item.name.toLowerCase() !== 'content-type')
                  .reduce<Record<string, string>>((res, item) => {
                    res[item.name] = item.value
                    return res
                  }, {}),
              )},
              requestBodyType: RequestBodyType.${
                extendedInterfaceInfo.method === Method.GET
                  ? RequestBodyType.query
                  : extendedInterfaceInfo.req_body_type /* istanbul ignore next */ ||
                    RequestBodyType.none
              },
              responseBodyType: ResponseBodyType.${
                extendedInterfaceInfo.res_body_type
              },
              paramNames: ${paramNamesLiteral},
              queryNames: ${queryNamesLiteral},
              dataKey: ${
                JSON.stringify(syntheticalConfig.dataKey) || 'undefined'
              },
              requestDataOptional: ${JSON.stringify(isRequestDataOptional)},
              requestFunctionName: ${JSON.stringify(requestFunctionName)},
              queryStringArrayFormat: QueryStringArrayFormat.${
                syntheticalConfig.queryStringArrayFormat ||
                QueryStringArrayFormat.brackets
              },
              extraInfo: ${JSON.stringify(requestFunctionExtraInfo)},
            }

            ${genComment(title => `接口 ${title} 的 **请求函数**`)}
            export const ${requestFunctionName} = (
              requestData${
                isRequestDataOptional ? '?' : ''
              }: ${requestDataTypeName},
              ...args: UserRequestRestArgs
            ) => {
              return request<${responseDataTypeName}>(
                prepare(${requestConfigName}, requestData),
                ...args,
              )
            }

            ${requestFunctionName}.requestConfig = ${requestConfigName}

          `
      }
    `
  }
}