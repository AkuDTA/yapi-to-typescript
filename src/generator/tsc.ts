import { exec } from 'child_process'
import { platform } from 'os'

interface Option {
  /** current work directory */
  cwd: string
  /** target file path which will be compiled */
  file: string
}
/**
 *
 * @param option.cwd current work directory
 * @param option.file target file path which will be compiled
 * @param cb
 */
export const cmd = (
  { cwd, file }: Option,
  cb: (value: void | PromiseLike<void>) => void,
) => {
  const TS_WORK_PATH = JSON.stringify(require.resolve(`typescript/bin/tsc`))
  const COMMAND = `${platform() === 'win32' ? 'node ' : ''}${TS_WORK_PATH}`
  const FILE_PATH = JSON.stringify(file)

  exec(
    `${COMMAND} --target ES2019 --module ESNext --declaration --esModuleInterop ${FILE_PATH}`,
    {
      cwd,
      env: process.env,
    },
    () => cb(),
  )
}
