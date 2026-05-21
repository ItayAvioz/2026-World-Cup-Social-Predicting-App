import { createContext, useContext, useRef, useCallback, useMemo } from 'react'

const DataCacheContext = createContext(null)

const DEFAULT_TTL_MS = 60_000

export function DataCacheProvider({ children }) {
  const storeRef = useRef(new Map())

  const get = useCallback((key) => {
    const entry = storeRef.current.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expiresAt) {
      storeRef.current.delete(key)
      return undefined
    }
    return entry.value
  }, [])

  const set = useCallback((key, value, ttlMs = DEFAULT_TTL_MS) => {
    storeRef.current.set(key, { value, expiresAt: Date.now() + ttlMs })
  }, [])

  const invalidate = useCallback((key) => {
    if (key === undefined) {
      storeRef.current.clear()
    } else {
      storeRef.current.delete(key)
    }
  }, [])

  const value = useMemo(() => ({ get, set, invalidate }), [get, set, invalidate])

  return (
    <DataCacheContext.Provider value={value}>
      {children}
    </DataCacheContext.Provider>
  )
}

export function useDataCache() {
  const ctx = useContext(DataCacheContext)
  if (!ctx) throw new Error('useDataCache must be used inside DataCacheProvider')
  return ctx
}
