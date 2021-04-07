import * as config from './config'
export * from './config'


export const getKeyByName = async (keyName: string): Promise<string> => {
  const ks = await config.get()
  return ks.exportSymmKey(keyName)
}
