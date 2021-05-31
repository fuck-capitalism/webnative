import { IPFS } from 'ipfs-core'

import { createInMemoryIPFS } from '../helpers/in-memory-ipfs'

import FileSystem from '../../src/fs/filesystem'
import { File } from '../../src/fs/types'
import * as ipfsConfig from '../../src/ipfs'
import * as path from '../../src/path'
import * as identifiers from '../../src/common/identifiers'
import * as crypto from '../../src/crypto'
import { PublicTree } from '../../src/fs/v1/PublicTree'


let ipfs: IPFS | null = null

beforeAll(async () => {
  ipfs = await createInMemoryIPFS()
  ipfsConfig.set(ipfs)
})

afterAll(async () => {
  if (ipfs == null) return
  await ipfs.stop()
})

type Files = { path: path.FilePath; content: string }[]

const setupFiles: Files =
  [ { path: path.file("public", "index.html"), content: "<h1>Hello</h1>" }
  , { path: path.file("public", "doc.md"), content: "# Hello" }
  , { path: path.file("public", "test", "doc.md"), content: "---" }
  , { path: path.file("public", "test", "index.html"), content: "<p>Hi</p>" }
  , { path: path.file("public", "test.txt"), content: "x" }
  ]

const remoteFiles: Files =
  [ { path: path.file("public", "index.html"), content: "written by remote" }
  , { path: path.file("public", "index.html"), content: "<h1>written by remote again</h1>" }
  , { path: path.file("public", "test", "index.html"), content: "<p>written by remote</p>" }
  ]

const localFiles: Files =
  [ { path: path.file("public", "index.html"), content: "something else" }
  , { path: path.file("public", "test", "doc.md"), content: "# Hello World" }
  ]

async function writeFiles(fs: FileSystem, files: Files) {
  for (const file of files) {
    await fs.write(file.path, file.content)
  }
}

describe("conflict detection", () => {
  it("detects a conflict", async () => {
    // const rootKey = "PUF+vTVbIQjxTJeFVu+qPQC7GiTA4sGC4M3Nqx1xRbc="
    const commonFs = await FileSystem.empty({ localOnly: true })
    await writeFiles(commonFs, setupFiles)
    const commonCID = await commonFs.root.put()
    const commonPublicCID = commonFs.root.publicTree.cid
    
    const remoteFs = await FileSystem.fromCID(commonCID, { localOnly: true })
    await writeFiles(remoteFs, remoteFiles)
    const localFs = await FileSystem.fromCID(commonCID, { localOnly: true })
    await writeFiles(localFs, localFiles)

    const divPoint = await divergencePoint(localFs.root.publicTree, remoteFs.root.publicTree)
    expect(divPoint.common.cid).toEqual(commonPublicCID)
  })
})

interface DivergencePoint {
  futureLocal: PublicTree[]
  futureRemote: PublicTree[]
  common: PublicTree
}

async function divergencePoint(local: PublicTree, remote: PublicTree): Promise<DivergencePoint | null> {
  const historyLocal = [local]
  const historyRemote = [remote]

  // eslint-disable-next-line no-constant-condition
  while (true) {

    const currentLocal = historyLocal[historyLocal.length - 1]
    const currentRemote = historyRemote[historyRemote.length - 1]
    
    // See whether the current heads are CIDs that were already contained
    // the other history respectively
    
    const currentLocalCID = currentLocal?.cid
    const localCIDIndex = indexOfCID(currentLocalCID, historyRemote)
    if (localCIDIndex != null) {
      return {
        futureLocal: historyLocal.slice(0, historyLocal.length - 1),
        futureRemote: historyRemote.slice(0, historyRemote.length - 1),
        common: currentLocal
      }
    }

    const currentRemoteCID = currentRemote?.cid
    const remoteCIDIndex = indexOfCID(currentRemoteCID, historyLocal)
    if (remoteCIDIndex != null) {
      return {
        futureLocal: historyLocal.slice(0, historyLocal.length - 1),
        futureRemote: historyRemote.slice(0, historyRemote.length - 1),
        common: currentRemote
      }
    }

    // Add the 'previous' history entries to historyLocal and historyRemote

    if (currentLocal.header.previous == null) {
      return null
    }
    const nextLocal = await PublicTree.fromCID(currentLocal.header.previous)
    historyLocal.push(nextLocal)

    if (currentRemote.header.previous == null) {
      return null
    }
    const nextRemote = await PublicTree.fromCID(currentRemote.header.previous)
    historyRemote.push(nextRemote)
  }
}

function indexOfCID(cid: string, history: PublicTree[]): number | null {
  let index = 0
  for (const item of history) {
    const itemCID = item?.cid
    if (itemCID === cid) {
      return index
    }
    index++
  }
  return null
}
