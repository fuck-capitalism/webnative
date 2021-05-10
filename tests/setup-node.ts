
import { Storage } from '../src/storage/jest'

import { Dependencies, setDependencies } from '../src/setup/dependencies'

import * as ed25519 from 'noble-ed25519'
import crypto from "crypto"
import utils, { normalizeUnicodeToBuf } from "keystore-idb/utils"
import { DEFAULT_CHAR_SIZE, DEFAULT_CTR_LEN, DEFAULT_HASH_ALG, DEFAULT_SYMM_ALG, DEFAULT_SYMM_LEN, RSA_READ_ALG, RSA_WRITE_ALG, SALT_LENGTH } from 'keystore-idb/constants'
import { CharSize, CipherText, Config, CryptoSystem, HashAlg, KeyStore, KeyUse, Msg, PrivateKey, PublicKey, RsaSize, SymmAlg, SymmKey, SymmKeyLength, SymmKeyOpts } from 'keystore-idb/types'
import config from "keystore-idb/config"
import aes from 'keystore-idb/aes'
import rsa from 'keystore-idb/rsa'


// FIXME Upgr ade @types/node as soon as webcrypto types are included
// @ts-ignore
const webcrypto: Crypto = crypto.webcrypto
globalThis.crypto = webcrypto

const inMemoryStorage = new Storage()



//-------------------------------------
// Crypto node implementations
//-------------------------------------

const encrypt = async (data: Uint8Array, keyStr: string): Promise<Uint8Array> => {
  const key = await aes.importKey(keyStr, { length: SymmKeyLength.B256 })
  const encrypted = await aes.encryptBytes(data.buffer, key)
  return new Uint8Array(encrypted)
}

const decrypt = async (encrypted: Uint8Array, keyStr: string): Promise<Uint8Array> => {
  const key = await aes.importKey(keyStr, { length: SymmKeyLength.B256 })
  const decryptedBuf = await aes.decryptBytes(encrypted.buffer, key)
  return new Uint8Array(decryptedBuf)
}

const genKeyStr = async (): Promise<string> => {
  const key = await aes.makeKey({ length: SymmKeyLength.B256 })
  return aes.exportKey(key)
}

const decryptGCM = async (encrypted: string, keyStr: string, ivStr: string): Promise<string> => {
  const iv = utils.base64ToArrBuf(ivStr)
  const sessionKey = await webcrypto.subtle.importKey(
    "raw",
    utils.base64ToArrBuf(keyStr),
    "AES-GCM",
    false,
    [ "encrypt", "decrypt" ]
  )

  // Decrypt secrets
  const decrypted = await webcrypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv
    },
    sessionKey,
    utils.base64ToArrBuf(encrypted)
  )
  return utils.arrBufToStr(decrypted, CharSize.B8)
}

const sha256 = async (bytes: Uint8Array): Promise<Uint8Array> => {
  const buf = bytes.buffer
  const hash = await webcrypto.subtle.digest('SHA-256', buf)
  return new Uint8Array(hash)
}

const rsaVerify = (message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): Promise<boolean> => {
  const keyStr = utils.arrBufToBase64(publicKey.buffer)
  return rsa.verify(message, signature, keyStr)
}

const ed25519Verify = (message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): Promise<boolean> => {
  return ed25519.verify(signature, message, publicKey)
}




//-------------------------------------
// Node RSA Keystore
//-------------------------------------

class InMemoryRSAKeyStore implements KeyStore {

  store: Record<string, any>;
  cfg: Config;

  constructor(cfg: Config, store: Record<string, any>) {
    this.cfg = cfg
    this.store = store
  }

  static async init(maybeCfg?: Partial<Config>): Promise<InMemoryRSAKeyStore> {
    const cfg = config.normalize({
      ...(maybeCfg || {}),
      type: CryptoSystem.RSA
    })

    const { rsaSize, hashAlg, readKeyName, writeKeyName } = cfg

    let store: Record<string, any> = {}

    store[readKeyName] = await rsa.makeKeypair(rsaSize, hashAlg, KeyUse.Read);
    store[writeKeyName] = await rsa.makeKeypair(rsaSize, hashAlg, KeyUse.Write)

    return new InMemoryRSAKeyStore(cfg, store)
  }

  async readKey() {
    return this.store[this.cfg.readKeyName]
  }

  async writeKey() {
    return this.store[this.cfg.writeKeyName]
  }

  async getSymmKey(keyName: string, cfg?: Partial<Config>): Promise<CryptoKey> {
    const mergedCfg = config.merge(this.cfg, cfg)
    const maybeKey = this.store[keyName]
    if(maybeKey !== null) {
      return maybeKey
    }
    const key = await aes.makeKey(config.symmKeyOpts(mergedCfg))
    this.store[keyName] = key
    return key
  }

  async keyExists(keyName: string): Promise<boolean> {
    const key = this.store[keyName]
    return key !== null
  }

  async deleteKey(keyName: string): Promise<void> {
    delete this.store[keyName]
  }

  async destroy(): Promise<void> {
    this.store = {}
  }

  async importSymmKey(keyStr: string, keyName: string, cfg?: Partial<Config>): Promise<void> {
    const mergedCfg = config.merge(this.cfg, cfg)
    const key = await aes.importKey(keyStr, config.symmKeyOpts(mergedCfg))
    this.store[keyName] = key
  }

  async exportSymmKey(keyName: string, cfg?: Partial<Config>): Promise<string> {
    const key = await this.getSymmKey(keyName, cfg)
    return await aes.exportKey(key)
  }

  async encryptWithSymmKey(msg: string, keyName: string, cfg?: Partial<Config>): Promise<string> {
    const mergedCfg = config.merge(this.cfg, cfg)
    const key = await this.getSymmKey(keyName, cfg)
    const cipherText = await aes.encryptBytes(
      utils.strToArrBuf(msg, mergedCfg.charSize),
      key,
      config.symmKeyOpts(mergedCfg)
    )
    return utils.arrBufToBase64(cipherText)
  }

  async decryptWithSymmKey(cipherText: string, keyName: string, cfg?: Partial<Config>): Promise<string> {
    const mergedCfg = config.merge(this.cfg, cfg)
    const key = await this.getSymmKey(keyName, cfg)
    const msgBytes = await aes.decryptBytes(
      utils.base64ToArrBuf(cipherText),
      key,
      config.symmKeyOpts(mergedCfg)
    )
    return utils.arrBufToStr(msgBytes, mergedCfg.charSize)
  }



  async sign(msg: Msg, cfg?: Partial<Config>): Promise<string> {
    const mergedCfg = config.merge(this.cfg, cfg)
    const writeKey = await this.writeKey()

    return utils.arrBufToBase64(await rsa.sign(
      msg,
      writeKey.privateKey,
      mergedCfg.charSize
    ))
  }

  async verify(
    msg: string,
    sig: string,
    publicKey: string | PublicKey,
    cfg?: Partial<Config>
  ): Promise<boolean> {
    const mergedCfg = config.merge(this.cfg, cfg)

    return await rsa.verify(
      msg,
      sig,
      publicKey,
      mergedCfg.charSize,
      mergedCfg.hashAlg
    )
  }

  async encrypt(
    msg: Msg,
    publicKey: string | PublicKey,
    cfg?: Partial<Config>
  ): Promise<string> {
    const mergedCfg = config.merge(this.cfg, cfg)

    return utils.arrBufToBase64(await rsa.encrypt(
      msg,
      publicKey,
      mergedCfg.charSize,
      mergedCfg.hashAlg
    ))
  }

  async decrypt(
    cipherText: Msg,
    publicKey?: string | PublicKey, // unused param so that keystore interfaces match
    cfg?: Partial<Config>
  ): Promise<string> {
    const readKey = await this.readKey()
    const mergedCfg = config.merge(this.cfg, cfg)

    return utils.arrBufToStr(
      await rsa.decrypt(
        cipherText,
        readKey.privateKey,
      ),
      mergedCfg.charSize
    )
  }

  async publicReadKey(): Promise<string> {
    const readKey = await this.readKey()
    return rsa.getPublicKey(readKey)
  }

  async publicWriteKey(): Promise<string> {
    const writeKey = await this.writeKey()
    return rsa.getPublicKey(writeKey)
  }
}



//-------------------------------------
// Dependency Injection Implementation
//-------------------------------------

const getKeystore = (() => {
  let keystore = null;

  return async function get() {
    if (keystore == null) {
      keystore = await InMemoryRSAKeyStore.init()
    }
    return keystore
  }
})()

export const NODE_IMPLEMENTATION: Dependencies = {
  hash: {
    sha256: sha256
  },
  aes: {
    encrypt: encrypt,
    decrypt: decrypt,
    genKeyStr: genKeyStr,
    decryptGCM: decryptGCM,
  },
  rsa: {
    verify: rsaVerify
  },
  ed25519: {
    verify: ed25519Verify
  },
  keystore: {
    async publicReadKey(): Promise<string> {
      const ks = await getKeystore()
      return ks.publicReadKey()
    },
    async publicWriteKey(): Promise<string> {
      const ks = await getKeystore()
      return ks.publicWriteKey()
    },
    async decrypt(encrypted: string): Promise<string> {
      const ks = await getKeystore()
      return ks.decrypt(encrypted)
    },
    async sign(message: string, charSize: number): Promise<string> {
      const ks = await getKeystore()
      return ks.sign(message, { charSize })
    },
    async importSymmKey(key: string, name: string): Promise<void> {
      const ks = await getKeystore()
      return ks.importSymmKey(key, name)
    },
    async exportSymmKey(name: string): Promise<string> {
      const ks = await getKeystore()
      return ks.exportSymmKey(name)
    },
    async keyExists(name:string): Promise<boolean> {
      const ks = await getKeystore()
      return ks.keyExists(name)
    },
    async getAlg(): Promise<string> {
      const ks = await getKeystore()
      return ks.cfg.type
    },
    async clear(): Promise<void> {
    },
  },
  storage: {
    getItem: inMemoryStorage.getItem,
    setItem: inMemoryStorage.setItem,
    removeItem: inMemoryStorage.removeItem,
    clear: inMemoryStorage.clear,
  }
}

setDependencies(NODE_IMPLEMENTATION)
