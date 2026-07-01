import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import api from '../lib/api'
import { useAuth } from '../contexts/AuthContext'

const FavouritesContext = createContext(null)

export const FavouritesProvider = ({ children }) => {
  const { isLoggedIn, user } = useAuth()
  const [favouriteIds, setFavouriteIds] = useState(new Set())

  const loadFavourites = useCallback(async () => {
    if (!isLoggedIn) {
      setFavouriteIds(new Set())
      return
    }
    try {
      const res = await api.get('/users/favourites')
      const data = res.data
      const ids = new Set(
        (Array.isArray(data) ? data : data.favourites || []).map((item) =>
          String(item._id || item.id || item)
        )
      )
      setFavouriteIds(ids)
    } catch {
      setFavouriteIds(new Set())
    }
  }, [isLoggedIn])

  useEffect(() => {
    loadFavourites()
  }, [loadFavourites, user])

  const isFavourite = (id) => favouriteIds.has(String(id))

  const toggleFavourite = async (id) => {
    if (!isLoggedIn) {
      alert('Please log in to save favourites.')
      return
    }
    const strId = String(id)
    if (isFavourite(strId)) {
      try {
        await api.delete(`/users/favourites/${strId}`)
        setFavouriteIds((prev) => {
          const next = new Set(prev)
          next.delete(strId)
          return next
        })
      } catch {
        // ignore error
      }
    } else {
      try {
        await api.post(`/users/favourites/${strId}`)
        setFavouriteIds((prev) => new Set([...prev, strId]))
      } catch {
        // ignore error
      }
    }
  }

  return (
    <FavouritesContext.Provider value={{ favouriteIds, isFavourite, toggleFavourite, loadFavourites }}>
      {children}
    </FavouritesContext.Provider>
  )
}

export const useFavourites = () => {
  const context = useContext(FavouritesContext)
  if (!context) throw new Error('useFavourites must be used within FavouritesProvider')
  return context
}

export default FavouritesContext
