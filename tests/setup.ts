/** Minimal browser globals for Node Vitest (translation / UI helpers). */
const memory = new Map<string, string>()

Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => memory.get(String(key)) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(String(key), String(value))
    },
    removeItem: (key: string) => {
      memory.delete(String(key))
    },
    clear: () => memory.clear(),
    get length() {
      return memory.size
    },
    key: (index: number) => [...memory.keys()][index] ?? null,
  },
  configurable: true,
})
