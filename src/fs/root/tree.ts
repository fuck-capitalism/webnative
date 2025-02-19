import { AddResult, CID } from '../../ipfs'
import { BareNameFilter } from '../protocol/private/namefilter'
import { Links, Puttable, SimpleLink } from '../types'
import { Branch, DistinctivePath } from '../../path'
import { Maybe } from '../../common'
import { Permissions } from '../../ucan/permissions'
import { SemVer } from '../semver'

import * as crypto from '../../crypto'
import * as identifiers from '../../common/identifiers'
import * as ipfs from '../../ipfs'
import * as link from '../link'
import * as pathing from '../../path'
import * as protocol from '../protocol'
import * as semver from '../semver'
import * as storage from '../../storage'
import * as ucanPermissions from '../../ucan/permissions'
import * as check from '../protocol/private/types/check'

import BareTree from '../bare/tree'
import MMPT from '../protocol/private/mmpt'
import PublicTree from '../v1/PublicTree'
import PrivateTree from '../v1/PrivateTree'
import PrivateFile from '../v1/PrivateFile'


type PrivateNode = PrivateTree | PrivateFile


export default class RootTree implements Puttable {

  links: Links
  mmpt: MMPT
  privateLog: Array<SimpleLink>

  publicTree: PublicTree
  prettyTree: BareTree
  privateNodes: Record<string, PrivateNode>

  constructor({ links, mmpt, privateLog, publicTree, prettyTree, privateNodes }: {
    links: Links,
    mmpt: MMPT,
    privateLog: Array<SimpleLink>,

    publicTree: PublicTree,
    prettyTree: BareTree,
    privateNodes: Record<string, PrivateNode>,
  }) {
    this.links = links
    this.mmpt = mmpt
    this.privateLog = privateLog

    this.publicTree = publicTree
    this.prettyTree = prettyTree
    this.privateNodes = privateNodes
  }


  // INITIALISATION
  // --------------

  static async empty({ rootKey }: { rootKey: string }): Promise<RootTree> {
    const publicTree = await PublicTree.empty()
    const prettyTree = await BareTree.empty()
    const mmpt = MMPT.create()

    // Private tree
    const rootPath = pathing.toPosix(pathing.directory(pathing.Branch.Private))
    const rootTree = await PrivateTree.create(mmpt, rootKey, null)
    await rootTree.put()

    // Construct tree
    const tree = new RootTree({
      links: {},
      mmpt,
      privateLog: [],

      publicTree,
      prettyTree,
      privateNodes: {
        [rootPath]: rootTree
      }
    })

    // Store root key
    await RootTree.storeRootKey(rootKey)

    // Set version and store new sub trees
    tree.setVersion(semver.v1)

    await Promise.all([
      tree.updatePuttable(Branch.Public, publicTree),
      tree.updatePuttable(Branch.Pretty, prettyTree),
      tree.updatePuttable(Branch.Private, mmpt)
    ])

    // Fin
    return tree
  }

  static async fromCID(
    { cid, permissions }: { cid: CID, permissions?: Permissions }
  ): Promise<RootTree> {
    const links = await protocol.basic.getLinks(cid)
    const keys = permissions ? await permissionKeys(permissions) : []

    // Load public parts
    const publicCID = links[Branch.Public]?.cid || null
    const publicTree = publicCID === null
      ? await PublicTree.empty()
      : await PublicTree.fromCID(publicCID)

    const prettyTree = links[Branch.Pretty]
                         ? await BareTree.fromCID(links[Branch.Pretty].cid)
                         : await BareTree.empty()

    // Load private bits
    const privateCID = links[Branch.Private]?.cid || null

    let mmpt, privateNodes
    if (privateCID === null) {
      mmpt = await MMPT.create()
      privateNodes = {}
    } else {
      mmpt = await MMPT.fromCID(privateCID)
      privateNodes = await loadPrivateNodes(keys, mmpt)
    }

    const privateLogCid = links[Branch.PrivateLog]?.cid
    const privateLog = privateLogCid
      ? await ipfs.dagGet(privateLogCid)
          .then(dagNode => dagNode.Links.map(link.fromDAGLink))
          .then(links => links.sort((a, b) => {
            return parseInt(a.name, 10) - parseInt(b.name, 10)
          }))
      : []

    // Construct tree
    const tree = new RootTree({
      links,
      mmpt,
      privateLog,

      publicTree,
      prettyTree,
      privateNodes
    })

    // Fin
    return tree
  }


  // MUTATIONS
  // ---------

  async put(): Promise<CID> {
    const { cid } = await this.putDetailed()
    return cid
  }

  async putDetailed(): Promise<AddResult> {
    return protocol.basic.putLinks(this.links)
  }

  updateLink(name: string, result: AddResult): this {
    const { cid, size, isFile } = result
    this.links[name] = link.make(name, cid, isFile, size)
    return this
  }

  async updatePuttable(name: string, puttable: Puttable): Promise<this> {
    return this.updateLink(name, await puttable.putDetailed())
  }


  // PRIVATE TREES
  // -------------

  static async storeRootKey(rootKey: string): Promise<void> {
    const path = pathing.directory(pathing.Branch.Private)
    const rootKeyId = await identifiers.readKey({ path })
    await crypto.keystore.importSymmKey(rootKey, rootKeyId)
  }

  findPrivateNode(path: DistinctivePath): [DistinctivePath, PrivateNode | null] {
    return findPrivateNode(this.privateNodes, path)
  }


  // PRIVATE LOG
  // -----------
  // CBOR array containing chunks.
  //
  // Chunk size is based on the default IPFS block size,
  // which is 1024 * 256 bytes. 1 log chunk should fit in 1 block.
  // We'll use the CSV format for the data in the chunks.
  static LOG_CHUNK_SIZE = 1020 // Math.floor((1024 * 256) / (256 + 1))


  async addPrivateLogEntry(cid: string): Promise<void> {
    const log = [...this.privateLog]
    let idx = Math.max(0, log.length - 1)

    // get last chunk
    let lastChunk = log[idx]?.cid
      ? (await ipfs.cat(log[idx].cid)).split(",")
      : []

    // needs new chunk
    const needsNewChunk = lastChunk.length + 1 > RootTree.LOG_CHUNK_SIZE
    if (needsNewChunk) {
      idx = idx + 1
      lastChunk = []
    }

    // add to chunk
    const hashedCid = await crypto.hash.sha256Str(cid)
    const updatedChunk = [...lastChunk, hashedCid]
    const updatedChunkDeposit = await protocol.basic.putFile(
      updatedChunk.join(",")
    )

    log[idx] = {
      name: idx.toString(),
      cid: updatedChunkDeposit.cid,
      size: updatedChunkDeposit.size
    }

    // save log
    const logDeposit = await ipfs.dagPutLinks(
      log.map(link.toDAGLink)
    )

    this.updateLink(Branch.PrivateLog, {
      cid: logDeposit.cid,
      isFile: false,
      size: await ipfs.size(logDeposit.cid)
    })

    this.privateLog = log
  }


  // VERSION
  // -------

  async setVersion(version: SemVer): Promise<this> {
    const result = await protocol.basic.putFile(semver.toString(version))
    return this.updateLink(Branch.Version, result)
  }

}



// ㊙️


type PathKey = { path: DistinctivePath, key: string }


async function findBareNameFilter(
  map: Record<string, PrivateNode>,
  path: DistinctivePath
): Promise<Maybe<BareNameFilter>> {
  const bareNameFilterId = await identifiers.bareNameFilter({ path })
  const bareNameFilter: Maybe<BareNameFilter> = await storage.getItem(bareNameFilterId)
  if (bareNameFilter) return bareNameFilter

  const [nodePath, node] = findPrivateNode(map, path)
  if (!node) return null

  const unwrappedPath = pathing.unwrap(path)
  const relativePath = unwrappedPath.slice(pathing.unwrap(nodePath).length)

  if (PrivateFile.instanceOf(node)) {
    return relativePath.length === 0 ? node.header.bareNameFilter : null
  }

  if (!node.exists(relativePath)) {
    if (pathing.isDirectory(path)) await node.mkdir(relativePath)
    else await node.add(relativePath, "")
  }

  return node.get(relativePath).then(t => t ? t.header.bareNameFilter : null)
}

function findPrivateNode(
  map: Record<string, PrivateNode>,
  path: DistinctivePath
): [DistinctivePath, PrivateNode | null] {
  const t = map[pathing.toPosix(path)]
  if (t) return [ path, t ]

  const parent = pathing.parent(path)

  return parent
    ? findPrivateNode(map, parent)
    : [ path, null ]
}

function loadPrivateNodes(
  pathKeys: PathKey[],
  mmpt: MMPT
): Promise<Record<string, PrivateNode>> {
  return sortedPathKeys(pathKeys).reduce((acc, { path, key }) => {
    return acc.then(async map => {
      let privateNode

      const unwrappedPath = pathing.unwrap(path)

      // if root, no need for bare name filter
      if (unwrappedPath.length === 1 && unwrappedPath[0] === pathing.Branch.Private) {
        privateNode = await PrivateTree.fromBaseKey(mmpt, key)

      } else {
        const bareNameFilter = await findBareNameFilter(map, path)
        if (!bareNameFilter) throw new Error(`Was trying to load the PrivateTree for the path \`${path}\`, but couldn't find the bare name filter for it.`)
        if (pathing.isDirectory(path)) {
          privateNode = await PrivateTree.fromBareNameFilter(mmpt, bareNameFilter, key)
        } else {
          privateNode = await PrivateFile.fromBareNameFilter(mmpt, bareNameFilter, key)
        }
      }

      const posixPath = pathing.toPosix(path)
      return { ...map, [posixPath]: privateNode }
    })
  }, Promise.resolve({}))
}

async function permissionKeys(
  permissions: Permissions
): Promise<PathKey[]> {
  return ucanPermissions.paths(permissions).reduce(async (
    acc: Promise<PathKey[]>,
    path: DistinctivePath
  ): Promise<PathKey[]> => {
    if (pathing.isBranch(pathing.Branch.Public, path)) return acc

    const name = await identifiers.readKey({ path })
    const key = await crypto.keystore.exportSymmKey(name)
    const pk: PathKey = { path: path, key: key }

    return acc.then(
      list => [ ...list, pk ]
    )
  }, Promise.resolve(
    []
  ))
}

/**
 * Sort keys alphabetically by path.
 * This is used to sort paths by parent first.
 */
function sortedPathKeys(list: PathKey[]): PathKey[] {
  return list.sort(
    (a, b) => pathing.toPosix(a.path).localeCompare(pathing.toPosix(b.path))
  )
}
