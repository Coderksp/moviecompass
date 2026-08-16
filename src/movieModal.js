import { createContext, useContext } from 'react'

// Provides the "open this movie in the detail modal" callback to any MovieCard,
// wherever it lives in the tree (home rails or search results).
export const MovieModalContext = createContext(() => {})
export const useOpenMovie = () => useContext(MovieModalContext)

// The same idea for people: a cast member inside the modal can hand control back
// to the filmography view without the modal knowing how that view is wired.
export const OpenPersonContext = createContext(() => {})
export const useOpenPerson = () => useContext(OpenPersonContext)
