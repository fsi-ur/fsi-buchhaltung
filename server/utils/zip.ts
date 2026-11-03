import { deflateRawSync } from 'zlib'
import type { LocalDateTime } from '~/shared/time'

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(data: Buffer) {
  let crc = 0xFFFFFFFF
  for (let index = 0; index < data.length; index += 1) {
    crc = CRC_TABLE[(crc ^ data[index]!) & 0xFF]! ^ (crc >>> 8)
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

/** ZIP entry times are zone-less DOS wall clocks; fill them from a wall clock in the app time zone. */
function dosDateTime(value: LocalDateTime) {
  const [year, month, day, hour, minute, second] = value.split(/[- :]/).map(Number) as [number, number, number, number, number, number]
  const time = (hour << 11) | (minute << 5) | Math.floor(second / 2)
  const date = ((Math.max(year, 1980) - 1980) << 9) | (month << 5) | day
  return { time, day: date }
}

/** Builds a deflated ZIP archive — the container format of .xlsx and the receipt bundle export. */
export function buildZip(entries: Array<{ name: string, data: Buffer }>, modifiedAt: LocalDateTime) {
  const { time, day } = dosDateTime(modifiedAt)
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8')
    // General-purpose bit 11 tells unzip tools the name is UTF-8 (umlauts in company names); pure-ASCII names stay flag-free.
    const flags = /^[ -~]*$/.test(entry.name) ? 0 : 0x0800
    const compressed = deflateRawSync(entry.data)
    const checksum = crc32(entry.data)

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034B50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(flags, 6)
    localHeader.writeUInt16LE(8, 8)
    localHeader.writeUInt16LE(time, 10)
    localHeader.writeUInt16LE(day, 12)
    localHeader.writeUInt32LE(checksum, 14)
    localHeader.writeUInt32LE(compressed.length, 18)
    localHeader.writeUInt32LE(entry.data.length, 22)
    localHeader.writeUInt16LE(nameBytes.length, 26)
    localHeader.writeUInt16LE(0, 28)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014B50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(flags, 8)
    centralHeader.writeUInt16LE(8, 10)
    centralHeader.writeUInt16LE(time, 12)
    centralHeader.writeUInt16LE(day, 14)
    centralHeader.writeUInt32LE(checksum, 16)
    centralHeader.writeUInt32LE(compressed.length, 20)
    centralHeader.writeUInt32LE(entry.data.length, 24)
    centralHeader.writeUInt16LE(nameBytes.length, 28)
    centralHeader.writeUInt32LE(offset, 42)

    localParts.push(localHeader, nameBytes, compressed)
    centralParts.push(centralHeader, nameBytes)
    offset += localHeader.length + nameBytes.length + compressed.length
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054B50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([...localParts, ...centralParts, end])
}
