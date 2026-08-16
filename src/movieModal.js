import { createContext, useContext } from 'react'

// Provides the "open this movie in the detail modal" callback to any MovieCard,
// wherever it lives in the tree (home rails or search results).
export const MovieModalContext = createContext(() => {})
export const useOpenMovie = () => useContext(MovieModalContext)

// The same idea for people: a cast member inside the modal can hand control back
// to the filmography view without the modal knowing how that view is wired.
export const OpenPersonContext = createContext(() => {})
export const useOpenPerson = () => useContext(OpenPersonContext)

// Reaching for a signed-in feature while signed out asks for an account. A card
// deep in a rail should be able to raise that without knowing the sign-in panel
// exists, let alone how to open it.
export const RequestSignInContext = createContext(() => {})
export const useRequestSignIn = () => useContext(RequestSignInContext)
