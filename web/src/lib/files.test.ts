import { blobText } from '../test/queriesFixture'
import { downloadText, MAX_FILE_BYTES, readTextFile } from './files'

describe('downloadText', () => {
  it('downloads the text unchanged under the given name', async () => {
    let blob: Blob | undefined
    URL.createObjectURL = vi.fn((b: Blob) => ((blob = b), 'blob:x'))
    URL.revokeObjectURL = vi.fn()
    let name = ''
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      name = this.download
    })
    downloadText('daily.cql', 'SELECT 1;\r\nSELECT é;\n')
    expect(name).toBe('daily.cql')
    expect(click).toHaveBeenCalled()
    expect(await blobText(blob)).toBe('SELECT 1;\r\nSELECT é;\n')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x')
    click.mockRestore()
  })
})

describe('readTextFile', () => {
  it('reads UTF-8 text', async () => {
    await expect(readTextFile(new File(['SELECT é;\r\n'], 'a.cql'))).resolves.toBe('SELECT é;\r\n')
  })
  it('rejects files over 1 MiB', async () => {
    await expect(readTextFile(new File([new Uint8Array(MAX_FILE_BYTES + 1)], 'big.cql'))).rejects.toThrow('larger than 1 MiB')
  })
  it('rejects invalid UTF-8', async () => {
    await expect(readTextFile(new File([new Uint8Array([0xff, 0xfe, 0xfd])], 'bin.cql'))).rejects.toThrow('not valid UTF-8')
  })
  it('accepts exactly 1 MiB', async () => {
    await expect(readTextFile(new File(['a'.repeat(MAX_FILE_BYTES)], 'ok.cql'))).resolves.toHaveLength(MAX_FILE_BYTES)
  })
})
