import { useState, useEffect } from 'react'
import api from './api'

export const useAgentProperties = () => {
  const [properties, setProperties] = useState([])
  const [status, setStatus] = useState('loading') // loading | success | error

  useEffect(() => {
    let cancelled = false

    api.get('/agent/properties')
      .then(res => {
        if (cancelled) return
        setProperties(Array.isArray(res.data?.properties) ? res.data.properties : [])
        setStatus('success')
      })
      .catch(() => {
        if (cancelled) return
        setStatus('error')
      })

    return () => { cancelled = true }
  }, [])

  return { properties, status }
}

export const PROPERTY_STATUSES = ['Available', 'Pending', 'Sold', 'Rented']

export const summarise = (properties = []) => ({
  total: properties.length,
  sale: properties.filter(p => p.listingType === 'Sale').length,
  rent: properties.filter(p => p.listingType === 'Rent').length,
  byStatus: PROPERTY_STATUSES.map(status => ({
    status,
    count: properties.filter(p => p.status === status).length,
  })),
})
