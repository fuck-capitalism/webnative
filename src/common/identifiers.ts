import * as crypto from '../crypto'


export async function bareNameFilter({ path }: { path: string }): Promise<string> {
  return `wnfs__bareNameFilter__${await crypto.hash.sha256Str(path)}`
}

export async function readKey({ path }: { path: string }): Promise<string> {
  return `wnfs__readKey__${await crypto.hash.sha256Str(path)}`
}
