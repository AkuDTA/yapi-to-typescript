import * as changeCase from 'change-case'
import path from 'path'
import { getCategoryList, getProject } from "./service"
import { ServerConfig, SyntheticalConfig } from "../types"

interface OutputFileList {
    [outputFilePath: string]: {
        syntheticalConfig: SyntheticalConfig
        content: string[]
        requestFunctionFilePath: string
    }
}
export const generate = async (config: ServerConfig[], cwd: string) => {
    const outputFileList: OutputFileList = Object.create(null);
    const tasks: (() => Promise<void>)[] = [];
    config.forEach((item) => {
        const { outputFilePath } = item;
        item.projects.map((info) => {
            const BASE_PARAM = {
                host: item.serverUrl,
                token: info.token
            };
            tasks.push(async () => {
                const project = await getProject(BASE_PARAM);
                const categories = await getCategoryList({
                    ...BASE_PARAM,
                    project_id: project._id,
                });

                const codes = await Promise.all(
                    // 根据 categories 生成文件
                    categories.map(async (category) => {
                        const interfaceList = await category.list
                            .map(info => {
                                const filePath = path.resolve(
                                    cwd,
                                    typeof outputFilePath ===
                                        'function'
                                        ? outputFilePath(
                                            info,
                                            changeCase,
                                        )
                                        : outputFilePath!,
                                )
                                return {
                                    filePath
                                }
                            })
                        return interfaceList
                    })
                )
            });
        })
    })
    await Promise.all(
        tasks.map(async (task) => {
            await task();
        })
    )

    await Promise.all(
        config.map(async ({ serverUrl, projects }, index) => {
            
return Promise.all(
projects.map(async (projectConfig, projectIndex) => {
const projectInfo = await this.fetchProjectInfo({
...serverConfig,
...projectConfig,
})
await Promise.all(
projectConfig.categories.map(
async (categoryConfig, categoryIndex) => {

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
                    const { cats: _ignored, ...project } = projectInfo;
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