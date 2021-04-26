
import * as browserCrypto from './src/crypto/browser'
import * as browserStorage from './src/storage/browser'

import { setDependencies } from './src/setup'

// node implementation of webcrypto
import { webcrypto } from 'crypto'

// only sha256 is tested so far
export const sha256 = async (bytes: Uint8Array): Promise<Uint8Array> => {
  const buf = bytes.buffer
  const hash = await webcrypto.subtle.digest('SHA-256', buf)
  return new Uint8Array(hash)
}

export const JEST_IMPLEMENTATION = {
  hash: {
    sha256: sha256
  },
  aes: {
    encrypt: browserCrypto.encrypt,
    decrypt: browserCrypto.decrypt,
    genKeyStr: browserCrypto.genKeyStr,
    decryptGCM: browserCrypto.decryptGCM,
  },
  rsa: {
    verify: browserCrypto.rsaVerify
  },
  ed25519: {
    verify: browserCrypto.ed25519Verify
  },
  keystore: {
    publicReadKey: browserCrypto.ksPublicReadKey,
    publicWriteKey: browserCrypto.ksPublicWriteKey,
    decrypt: browserCrypto.ksDecrypt,
    sign: browserCrypto.ksSign,
    importSymmKey: browserCrypto.ksImportSymmKey,
    exportSymmKey: browserCrypto.ksExportSymmKey,
    keyExists: browserCrypto.ksKeyExists,
    getAlg: browserCrypto.ksGetAlg,
    clear: browserCrypto.ksClear,
  },
  storage: {
    getItem: browserStorage.getItem,
    setItem: browserStorage.setItem,
    removeItem: browserStorage.removeItem,
    clear: browserStorage.clear,
  }
}

setDependencies(JEST_IMPLEMENTATION)