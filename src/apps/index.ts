import * as did from '../did'
import * as ucan from '../ucan'
import { api, Maybe, isString } from '../common'
import { setup } from '../setup/internal'
import { CID } from '../ipfs'


export type App = {
  domain: string
}



/**
 * Get A list of all of your apps and their associated domain names
 */
export async function index(): Promise<Array<App>> {
  const apiEndpoint = setup.endpoints.api

  const localUcan = await ucan.dictionary.lookupAppUcan("*")
  if (localUcan === null) {
    throw "Could not find your local UCAN"
  }

  const jwt = ucan.encode(await ucan.build({
    audience: await api.did(),
    issuer: await did.ucan(),
    proof: localUcan,
    potency: null
  }))

  const response = await fetch(`${apiEndpoint}/app`, {
    method: 'GET',
    headers: {
      'authorization': `Bearer ${jwt}`
    }
  })

  const data = await response.json()
  return Object
    .values(data)
    .filter(v => (v as Array<string>).length > 0)
    .map(v => ({ domain: (v as Array<string>)[0] }))
}

/**
 * Creates a new app, assigns an initial subdomain, and sets an asset placeholder
 *
 * @param subdomain Subdomain to create the fission app with
 */
export async function create(
  subdomain: Maybe<string>
): Promise<App> {
  const apiEndpoint = setup.endpoints.api

  const localUcan = await ucan.dictionary.lookupAppUcan("*")
  if (localUcan === null) {
    throw "Could not find your local UCAN"
  }

  const jwt = ucan.encode(await ucan.build({
    audience: await api.did(),
    issuer: await did.ucan(),
    proof: localUcan,
    potency: null
  }))

  const url = isString(subdomain)
    ? `${apiEndpoint}/app?subdomain=${encodeURIComponent(subdomain)}`
    : `${apiEndpoint}/app`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${jwt}`
    }
  })
  const data = await response.json()
  return { domain: data }
}

/**
 * Destroy app by any associated domain
 *
 * @param domain The domain associated with the app we want to delete
 */
export async function deleteByDomain(
  domain: string
): Promise<void> {
  const apiEndpoint = setup.endpoints.api

  const localUcan = await ucan.dictionary.lookupAppUcan(domain)
  if (localUcan === null) {
    throw new Error("Could not find your local UCAN")
  }

  const jwt = ucan.encode(await ucan.build({
    audience: await api.did(),
    issuer: await did.ucan(),
    proof: localUcan,
    potency: null
  }))

  const appIndexResponse = await fetch(`${apiEndpoint}/app`, {
    method: 'GET',
    headers: {
      'authorization': `Bearer ${jwt}`
    }
  })

  const index = await appIndexResponse.json() as { [_: string]: string[] }
  const appToDelete = Object.entries(index).find(([_, domains]) => domains.includes(domain))
  if (appToDelete == null) {
    throw new Error(`Couldn't find an app with domain ${domain}`)
  }

  await fetch(`${apiEndpoint}/app/${encodeURIComponent(appToDelete[0])}`, {
    method: 'DELETE',
    headers: {
      'authorization': `Bearer ${jwt}`
    }
  })
}

/**
 * Updates an app by CID
 *
 * @param subdomain Subdomain to create the fission app with
 */
export async function publish(
  domain: string,
  cid: CID,
): Promise<void> {
  const apiEndpoint = setup.endpoints.api

  const localUcan = await ucan.dictionary.lookupAppUcan(domain)
  if (localUcan === null) {
    throw "Could not find your local UCAN"
  }

  const jwt = ucan.encode(await ucan.build({
    audience: await api.did(),
    issuer: await did.ucan(),
    proof: localUcan, 
    potency: null
  }))

  const url = `${apiEndpoint}/app/${domain}/${cid}`

  await fetch(url, {
    method: 'PATCH',
    headers: {
      'authorization': `Bearer ${jwt}`
    }
  })
}
