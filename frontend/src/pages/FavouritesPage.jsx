import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import api from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import PropertyCard from '../components/PropertyCard'

const FavouritesPage = () => {
  const { isLoggedIn } = useAuth()
  const { t } = useLanguage()
  const [properties, setProperties] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isLoggedIn) { setLoading(false); return }
    api.get('/users/favourites')
      .then(r => setProperties(r.data.favourites || r.data || []))
      .catch(() => setProperties([]))
      .finally(() => setLoading(false))
  }, [isLoggedIn])

  if (!isLoggedIn) return (
    <div className="min-h-screen flex flex-col items-center justify-center pt-20 px-6 text-center bg-slate-50">
      <svg className="h-16 w-16 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
      <h2 style={{ fontFamily: 'Cinzel, serif' }} className="mt-4 text-2xl font-semibold text-[#202a36]">{t.favouritesPage?.signInHeading || 'Sign in to view favourites'}</h2>
      <p className="mt-2 text-slate-500">{t.favouritesPage?.signInDesc || 'Save your favourite properties and access them anytime.'}</p>
      <Link to="/login" className="mt-6 rounded-full bg-[#202a36] px-8 py-3 text-sm font-semibold text-white hover:bg-[#4b6741]">{t.favouritesPage?.signIn || 'Sign In'}</Link>
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-50 pt-28 pb-16">
      <div className="container mx-auto px-6">
        <div className="mb-10">
          <p className="text-sm uppercase tracking-[0.4em] text-slate-500">{t.favouritesPage?.label || 'Saved'}</p>
          <h1 style={{ fontFamily: 'Cinzel, serif' }} className="mt-2 text-4xl font-bold text-[#202a36]">{t.favouritesPage?.heading || 'My Favourite Properties'}</h1>
        </div>
        {loading ? (
          <div className="flex justify-center py-20"><div className="h-10 w-10 animate-spin rounded-full border-4 border-[#4b6741] border-t-transparent" /></div>
        ) : properties.length === 0 ? (
          <div className="flex flex-col items-center py-20 text-center">
            <svg className="h-16 w-16 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
            <h3 className="mt-4 text-xl font-semibold text-slate-700">{t.favouritesPage?.empty || 'No favourites yet'}</h3>
            <p className="mt-2 text-slate-500">{t.favouritesPage?.emptyDesc || 'Start browsing and save properties you love.'}</p>
            <Link to="/properties" className="mt-4 rounded-full bg-[#4b6741] px-6 py-2.5 text-sm font-semibold text-white">{t.favouritesPage?.browse || 'Browse Properties'}</Link>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {properties.map(p => <PropertyCard key={p._id} property={p} />)}
          </div>
        )}
      </div>
    </div>
  )
}

export default FavouritesPage
