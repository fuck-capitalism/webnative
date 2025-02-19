import * as crypto from '../crypto'
import { publicKeyToDid } from './transformers'
import { toKeyType } from './util'


/**
 * Create a DID based on the exchange key-pair.
 */
export async function exchange(): Promise<string> {
  const pubKeyB64 = await crypto.keystore.publicReadKey()
  const ksAlg = await crypto.keystore.getAlg()

  return publicKeyToDid(
    pubKeyB64,
    toKeyType(ksAlg)
  )
}

/**
 * Alias `write` to `ucan`
 */
export { write as ucan }

/**
 * Create a DID based on the write key-pair.
 */
export async function write(): Promise<string> {
  const pubKeyB64 = await crypto.keystore.publicWriteKey()
  const ksAlg = await crypto.keystore.getAlg()

  return publicKeyToDid(
    pubKeyB64,
    toKeyType(ksAlg)
  )
}
