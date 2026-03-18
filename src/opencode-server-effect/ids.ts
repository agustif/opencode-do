let lastTimestamp = 0
let counter = 0

function randomBase62(length: number) {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("")
}

export function generateId(prefix: "msg" | "prt" | "ses"): string {
  const currentTimestamp = Date.now()
  if (currentTimestamp !== lastTimestamp) {
    lastTimestamp = currentTimestamp
    counter = 0
  }
  counter += 1

  const sortable = BigInt(currentTimestamp) * BigInt(0x1000) + BigInt(counter)
  const timeBytes = new Uint8Array(6)
  for (let i = 0; i < 6; i += 1) {
    timeBytes[i] = Number((sortable >> BigInt(40 - 8 * i)) & BigInt(0xff))
  }
  const timeHex = Array.from(timeBytes, (byte) => byte.toString(16).padStart(2, "0")).join("")

  return `${prefix}_${timeHex}${randomBase62(14)}`
}
