import * as cidLog from './common/cid-log'
import * as common from './common'
import * as base64 from './common/base64'
import * as did from './did'
import * as path from './path'
import * as crypto from './crypto'
import * as storage from './storage'
import * as ucan from './ucan/store'

import { USERNAME_STORAGE_KEY, Maybe, VERSION } from './common'
import { FileSystem } from './fs/filesystem'
import { Permissions } from './ucan/permissions'
import { setup } from './setup/internal'


// FUNCTIONS


/**
 * Retrieve the authenticated username.
 */
export async function authenticatedUsername(): Promise<string | null> {
  return common.authenticatedUsername()
}

/**
 * Leave.
 *
 * Removes any trace of the user and redirects to the lobby.
 */
export async function leave({ withoutRedirect }: { withoutRedirect?: boolean } = {}): Promise<void> {
  await storage.removeItem(USERNAME_STORAGE_KEY)
  await ucan.clearStorage()
  await cidLog.clear()
  await crypto.keystore.clear()

  ;((globalThis as any).filesystems || []).forEach((f: FileSystem) => f.deactivate())

  if (!withoutRedirect && globalThis.location) {
    globalThis.location.href = setup.endpoints.lobby
  }
}

/**
 * Redirects to a lobby.
 *
 * NOTE: Only works on the main thread, as it uses `window.location`.
 *
 * @param permissions The permissions from `initialise`.
 *                    Pass `null` if working without permissions.
 * @param redirectTo Specify the URL you want users to return to.
 *                   Uses the current url by default.
 */
export async function redirectToLobby(
  permissions: Maybe<Permissions>,
  redirectTo?: string
): Promise<void> {
  const app = permissions?.app
  const fs = permissions?.fs
  const platform = permissions?.platform
  const raw = permissions?.raw

  const exchangeDid = await did.exchange()
  const writeDid = await did.write()
  const sharedRepo = !!document.body.querySelector("iframe#webnative-ipfs") && typeof SharedWorker === "function"

  redirectTo = redirectTo || window.location.href

  // Compile params
  const params = [
    [ "didExchange", exchangeDid ],
    [ "didWrite", writeDid ],
    [ "redirectTo", redirectTo ],
    [ "sdk", VERSION.toString() ],
    [ "sharedRepo", sharedRepo ? "t" : "f" ]

  ].concat(
    app           ? [[ "appFolder", `${app.creator}/${app.name}` ]] : [],
    fs?.private   ? fs.private.map(p => [ "privatePath", path.toPosix(p, { absolute: true }) ]) : [],
    fs?.public    ? fs.public.map(p => [ "publicPath", path.toPosix(p, { absolute: true }) ]) : [],
    raw           ? [["raw", base64.urlEncode(JSON.stringify(raw))]]  : []

  ).concat((() => {
    const apps = platform?.apps

    switch (typeof apps) {
      case "string": return [[ "app", apps ]]
      case "object": return apps.map(a => [ "app", a ])
      default: return []
    }

  })())

  // And, go!
  window.location.href = setup.endpoints.lobby + "?" +
    params
      .map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v))
      .join("&")
}
