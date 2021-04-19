import FileSystem from './fs'
import * as cidLog from './common/cid-log'
import * as debug from './common/debug'
import * as dataRoot from './data-root'
import * as ucan from './ucan/internal'
import { Maybe, authenticatedUsername } from './common'
import { Permissions } from './ucan/permissions'


/**
 * Load a user's file system.
 *
 * @param permissions The permissions from initialise.
 *                    Pass `null` if working without permissions
 * @param username Optional, username of the user to load the file system from.
 *                 Will try to load the file system of the authenticated user
 *                 by default. Throws an error if there's no authenticated user.
 * @param rootKey Optional, AES key to be the root key of a new filesystem.
 *                Will be used if a filesystem hasn't been created yet.
 */
export async function loadFileSystem(
  permissions: Maybe<Permissions>,
  username?: string,
  rootKey?: string
): Promise<FileSystem> {
  let cid, fs

  // Look for username
  username = username || (await authenticatedUsername() || undefined)
  if (!username) throw new Error("User hasn't authenticated yet")

  // Ensure internal UCAN dictionary
  await ucan.store([])

  // Determine the correct CID of the file system to load
  const dataCid = navigator.onLine ? await dataRoot.lookup(username) : null
  const [ logIdx, logLength ] = dataCid ? await cidLog.index(dataCid) : [ -1, 0 ]

  if (!navigator.onLine) {
    // Offline, use local CID
    cid = await cidLog.newest()

  } else if (!dataCid) {
    // No DNS CID yet
    cid = await cidLog.newest()
    if (cid) debug.log("📓 No DNSLink, using local CID:", cid)
    else debug.log("📓 Creating a new file system")

  } else if (logIdx === 0) {
    // DNS is up to date
    cid = dataCid
    debug.log("📓 DNSLink is up to date:", cid)

  } else if (logIdx > 0) {
    // DNS is outdated
    cid = await cidLog.newest()
    const idxLog = logIdx === 1 ? "1 newer local entry" : logIdx + " newer local entries"
    debug.log("📓 DNSLink is outdated (" + idxLog + "), using local CID:", cid)

  } else {
    // DNS is newer
    cid = dataCid
    await cidLog.add(cid)
    debug.log("📓 DNSLink is newer:", cid)

  }

  // If a file system exists, load it and return it
  const p = permissions || undefined

  fs = cid ? await FileSystem.fromCID(cid, { permissions: p }) : null
  if (fs) return fs

  // Otherwise make a new one
  if (!rootKey) throw new Error("Can't make new filesystem without a root AES key")
  fs = await FileSystem.empty({ permissions: p, rootKey })
  await addSampleData(fs)

  // Fin
  return fs
}



// ㊙️


async function addSampleData(fs: FileSystem): Promise<void> {
  await fs.mkdir("private/Apps")
  await fs.mkdir("private/Audio")
  await fs.mkdir("private/Documents")
  await fs.mkdir("private/Photos")
  await fs.mkdir("private/Video")
  await fs.publish()
}
