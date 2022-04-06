import http from 'http'

type METHOD = 'POST' | 'GET' | 'get' | 'post'

export interface Options {
  method?: METHOD
  path: string
  host: string
}

const request = async <T = any>(config: Options): Promise<T> => {
  const { host, path, method } = config
  const options: http.RequestOptions = {
    method,
  }
  const response = await new Promise<T>((resolve, reject) => {
    const request = http.request(
      {
        host: host.replace(/^http(s?):\/\//g, ''),
        path,
        ...options,
      },
      res => {
        const RESPONSE: Uint8Array[] = []
        res.on('data', d => {
          RESPONSE.push(d)
        })
        res.on('end', () => {
          const response = JSON.parse(Buffer.concat(RESPONSE).toString())
          resolve(response)
        })
      },
    )
    request.on('error', e => {
      console.log('error', e)
      reject(e)
    })
    request.end()
  })
  return response
}

export default request
