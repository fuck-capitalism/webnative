import * as check from './fs/types/check'
import * as debug from './common/debug'
import * as did from './did'
import * as dns from './dns'
import * as ucan from './ucan'
import { CID } from './ipfs'
import { api } from './common'
import { Ucan } from './ucan'
import { setup } from './setup/internal'

/**
 * CID representing an empty string. We use to to speed up DNS propagation
 * However, we treat that as a null value in the code
 */
const EMPTY_CID = 'Qmc5m94Gu7z62RC8waSKkZUrCCBJPyHbkpmGzEePxy2oXJ'

/**
 * Get the CID of a user's data root.
 * First check Fission server, then check DNS
 *
 * @param username The username of the user that we want to get the data root of.
 */
export async function lookup(
  username: string
): Promise<CID | null> {
  const maybeRoot = await lookupOnFisson(username)
  if(maybeRoot === EMPTY_CID) return null
  if(maybeRoot !== null) return maybeRoot

  try {
    const cid = await dns.lookupDnsLink(username + '.files.' + setup.endpoints.user)
    return cid === EMPTY_CID ? null : cid
  } catch(err) {
    console.error(err)
    throw new Error('Could not locate user root in dns')
  }
}

/**
 * Get the CID of a user's data root from the Fission server.
 *
 * @param username The username of the user that we want to get the data root of.
 */
export async function lookupOnFisson(
  username: string
): Promise<CID | null> {
  try {
    const resp = await fetch(
      `${setup.endpoints.api}/user/data/${username}`,
      { cache: 'reload' } // don't use cache
    )
    const cid = await resp.json()
    if (!check.isCID(cid)) {
      throw new Error("Did not receive a CID")
    }
    return cid

  } catch(err) {
    debug.log('Could not locate user root on Fission server: ', err.toString())
    return null

  }
}

/**
 * Update a user's data root.
 *
 * @param cid The CID of the data root.
 * @param proof The proof to use in the UCAN sent to the API.
 */
export async function update(
  cid: CID | string,
  proof: string
): Promise<{ success: boolean }> {
  const apiEndpoint = setup.endpoints.api

  // Debug
  debug.log("🌊 Updating your DNSLink:", cid)

  // Make API call
  return await fetchWithRetry(`${apiEndpoint}/user/data/${cid}`, {
    headers: async () => {
      const jwt = ucan.encode(await ucan.build({
        audience: await api.did(),
        issuer: await did.ucan(),
        potency: "APPEND",
        proof,

        // TODO: Waiting on API change.
        //       Should be `username.fission.name/*`
        resource: ucan.decode(proof).payload.rsc
      }))

      return { 'authorization': `Bearer ${jwt}` }
    },
    retries: 100,
    retryDelay: 5000,
    retryOn: [ 502, 503, 504 ],

  }, {
    method: 'PATCH'

  }).then((response: Response) => {
    if (response.status < 300) debug.log("🪴 DNSLink updated:", cid)
    else debug.log("🔥 Failed to update DNSLink for:", cid)
    return { success: response.status < 300 }

  }).catch(err => {
    debug.log("🔥 Failed to update DNSLink for:", cid)
    console.error(err)
    return { success: false }

  })
}



// ㊙️


type RetryOptions = {
  headers: () => Promise<{ [_: string]: string }>
  retries: number
  retryDelay: number
  retryOn: Array<number>
}


async function fetchWithRetry(
  url: string,
  retryOptions: RetryOptions,
  fetchOptions: RequestInit,
  retry: number = 0
): Promise<Response> {
  const headers = await retryOptions.headers()
  const response = await fetch(url, {
    ...fetchOptions,
    headers: { ...fetchOptions.headers, ...headers }
  })

  if (retryOptions.retryOn.includes(response.status)) {
    if (retry < retryOptions.retries) {
      return await new Promise((resolve, reject) => setTimeout(
        () => fetchWithRetry(url, retryOptions, fetchOptions, retry + 1).then(resolve, reject),
        retryOptions.retryDelay
      ))
    } else {
      throw new Error("Too many retries for fetch")
    }
  }

  return response
}
