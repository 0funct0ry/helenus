import { createContext } from 'react'

/**
 * Lets typed inputs nested anywhere inside an editor tell it whether they currently hold a valid value.
 * An input reports its own id with an error message, or null once it is valid (or gone). The editor
 * disables its save button while any input reports an error.
 */
export const InputValidity = createContext<(id: string, error: string | null) => void>(() => {})
