import request from '../util/request'
import { CategoryListWithInterface, Project } from '../types'

interface RequestParams {
  /** 服务地址 */
  host: string
  /** 项目Token */
  token: string
}

export const getProject = async ({ host, token }: RequestParams) => {
  const project = await request<Project>({
    host,
    path: `/api/project/get?token=${token}`,
    method: 'GET',
  })
  const { basepath = '/' } = project
  project.basepath = `/${basepath}`.replace(/\/+$/, '').replace(/^\/+/, '/')
  project._url = `${host}/project/${project._id}/interface/api`
  return project
}
/** 根据 projectToken + projectId 获取当前项目下的所有 interface 详情 */
export const getCategoryList = async ({
  host,
  token,
  project_id,
}: RequestParams & { project_id: number }) => {
  const categoryList = await request<CategoryListWithInterface>({
    host,
    // path: `/api/plugin/export?token=${token}&type=json&status=all&isWiki=false`,
    path: `/api/interface/list_menu?token=${token}&project_id=${project_id}`,
    method: 'GET',
  })
  return categoryList
  // return categoryList.map(category => {
  //     if (category.list.length > 0) {
  //         const { project_id, catid } = category.list[0];
  //         category._url = `${host}/project/${project_id}/interface/api/cat_${catid}`;
  //         category.list.map((item) => {
  //             // item._url = `${host}/project/${project_id}/interface/api/${item._id}`;
  //             // item.path = `${basePath}${item.path}`;
  //             return item;
  //         })
  //     }
  //     return category;
  // })
}

/** 获取分类的接口列表 */
