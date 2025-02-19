import { loadWebnativePage } from "../helpers/page"


describe("FS", () => {
  it("creates the parent directories automatically", async () => {
    await loadWebnativePage()

    const string = await page.evaluate(async () => {
      const expected = "content"
      const wn = webnative

      const fs = await new wn.fs.empty({
        localOnly: true,
        permissions: {
          fs: { private: [ wn.path.root() ] }
        }
      })

      const privatePath = wn.path.file(wn.path.Branch.Private, "a", "b", "c.txt")
      const publicPath = wn.path.file(wn.path.Branch.Public, "a", "b", "c.txt")

      await fs.write(privatePath, expected)
      await fs.write(publicPath, expected)

      return [
        await fs.read(privatePath),
        await fs.read(publicPath)
      ].join("/")
    })

    expect(string).toEqual("content/content")
  })
});
