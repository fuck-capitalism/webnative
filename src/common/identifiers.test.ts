import { bareNameFilter } from './identifiers'

test('add', async () => {
  const result = await bareNameFilter({ path: 'test' })
  console.log(result)
})