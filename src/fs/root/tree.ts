import { BareNameFilter } from '../protocol/private/namefilter'
import { Branch, Links, Puttable, SimpleLink } from '../types'
import { AddResult, CID } from '../../ipfs'
import { Maybe } from '../../common'
import { Permissions } from '../../ucan/permissions'
import { SemVer } from '../semver'

import * as crypto from '../../crypto'
import * as identifiers from '../../common/identifiers'
import * as ipfs from '../../ipfs'
import * as link from '../link'
import * as pathUtil from '../path'
import * as protocol from '../protocol'
import * as semver from '../semver'
import * as storage from '../../storage'
import * as ucanPermissions from '../../ucan/permissions'

import BareTree from '../bare/tree'
import MMPT from '../protocol/private/mmpt'
import PublicTree from '../v1/PublicTree'
import PrivateTree from '../v1/PrivateTree'


export default class RootTree implements Puttable {

  links: Links
  mmpt: MMPT
  privateLog: Array<SimpleLink>

  publicTree: PublicTree
  prettyTree: BareTree
  privateTrees: Record<string, PrivateTree>

  constructor({ links, mmpt, privateLog, publicTree, prettyTree, privateTrees }: {
    links: Links,
    mmpt: MMPT,
    privateLog: Array<SimpleLink>,

    publicTree: PublicTree,
    prettyTree: BareTree,
    privateTrees: Record<string, PrivateTree>,
  }) {
    this.links = links
    this.mmpt = mmpt
    this.privateLog = privateLog

    this.publicTree = publicTree
    this.prettyTree = prettyTree
    this.privateTrees = privateTrees
  }


  // INITIALISATION
  // --------------

  static async empty({ rootKey }: { rootKey: string }): Promise<RootTree> {
    const publicTree = await PublicTree.empty()
    const prettyTree = await BareTree.empty()
    const mmpt = MMPT.create()

    // Private tree
    const rootTree = await PrivateTree.create(mmpt, rootKey, null)
    await rootTree.put()

    // Construct tree
    const tree = new RootTree({
      links: {},
      mmpt,
      privateLog: [],

      publicTree,
      prettyTree,
      privateTrees: {
        '/': rootTree
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
    const keys = permissions ? await permissionKeys(permissions) : {}

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

    let mmpt, privateTrees
    if (privateCID === null) {
      mmpt = await MMPT.create()
      privateTrees = {}
    } else {
      mmpt = await MMPT.fromCID(privateCID)
      privateTrees = await loadPrivateTrees(keys, mmpt)
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
      privateTrees
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
    const rootKeyId = await identifiers.readKey({ path: '/private/' })
    await crypto.keystore.importSymmKey(rootKey, rootKeyId)
  }

  findPrivateTree(path: string[]): [string, PrivateTree | null] {
    return findPrivateTree(this.privateTrees, path)
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


async function findBareNameFilter(
  map: Record<string, PrivateTree>,
  privatePathWithLeadingSlash: string
): Promise<Maybe<BareNameFilter>> {
  const privatePath = privatePathWithLeadingSlash.slice(1)
  const bareNameFilterId = await identifiers.bareNameFilter({ path: "/private/" + privatePath })
  const bareNameFilter: Maybe<BareNameFilter> = await storage.getItem(bareNameFilterId)
  if (bareNameFilter) return bareNameFilter

  const pathParts = pathUtil.splitParts(privatePath)
  const [treePath, tree] = findPrivateTree(map, pathParts)
  if (!tree) return null

  const relativePath = privatePath.replace(new RegExp("^" + treePath), "")
  if (!tree.exists(relativePath)) await tree.mkdir(relativePath)
  return tree.get(relativePath).then(t => t ? t.header.bareNameFilter : null)
}

function findPrivateTree(
  map: Record<string, PrivateTree>,
  path: string[]
): [string, PrivateTree | null] {
  const fullPath = pathUtil.join(path)
  const t = map['/' + fullPath]
  if (t) return [ fullPath, t ]

  return path.length > 0
    ? findPrivateTree(map, path.slice(0, -1))
    : [ fullPath, null ]
}

function loadPrivateTrees(
  keys: Record<string, string>,
  mmpt: MMPT
): Promise<Record<string, PrivateTree>> {
  return sortedKeys(keys).reduce((acc, [path, key]) => {
    return acc.then(async map => {
      const prop = removePrivatePrefix(path)

      let privateTree

      // if root, no need for bare name filter
      if (prop === "/" || prop === "") {
        privateTree = await PrivateTree.fromBaseKey(mmpt, key)

      } else {
        const bareNameFilter = await findBareNameFilter(map, prop)
        if (!bareNameFilter) throw new Error(`Was trying to load the PrivateTree for the path \`${path}\`, but couldn't find the bare name filter for it.`)

        privateTree = await PrivateTree.fromBareNameFilter(mmpt, bareNameFilter, key)

      }

      return { ...map, [prop]: privateTree }
    })
  }, Promise.resolve({}))
}

async function permissionKeys(
  permissions: Permissions
): Promise<Record<string, string>> {
  return ucanPermissions.paths(permissions).reduce(async (acc, p) => {
    if (p.startsWith('/public')) return acc
    const name = await identifiers.readKey({ path: p })
    return acc.then(async map => ({ ...map, [p]: (await crypto.keystore.exportSymmKey(name)) }))
  }, Promise.resolve({}))
}

function removePrivatePrefix(path: string): string {
  return '/' + path
    .replace(/^\/?private(\/|$)/, "")
    .replace(/^\/+/, "")
}

/**
 * Sort keys alphabetically.
 * This is used to sort paths by parent first.
 */
function sortedKeys(keys: Record<string, string>): Array<[string, string]> {
  return Object.entries(keys).sort(
    (a, b) => a[0].localeCompare(b[0])
  )
}
