import React, { createContext, useContext, useEffect, useState } from 'react'
import { assets } from '../assets/assets'

const PropertyContext = createContext()

const defaultProperties = [
  {
    id: '1',
    title: 'Istanbul Sky Residences',
    address: 'Levent, Istanbul',
    city: 'Istanbul',
    district: 'Levent',
    location: 'Levent, Istanbul',
    price: '$1,850,000',
    type: 'Sale',
    status: 'Featured',
    beds: 4,
    baths: 3,
    area: '3,200 sqft',
    description:
      'A premium residence located in one of Istanbul’s most desirable neighborhoods, offering modern comfort and elegant living.',
    amenities: ['Parking', 'Security', 'Balcony', 'Modern Kitchen'],
    images: [assets.project_img_1],
    mainImage: assets.project_img_1,
    agent: {
      name: 'Arda Aydin',
      phone: '+90 541 234 9876',
      email: 'arda@estate.com',
    },
    createdAt: new Date().toISOString(),
  },
  {
    id: '2',
    title: 'Beylikdüzü Garden Villas',
    address: 'Beylikdüzü, Istanbul',
    city: 'Istanbul',
    district: 'Beylikdüzü',
    location: 'Beylikdüzü, Istanbul',
    price: '$980,000',
    type: 'Sale',
    status: 'For Sale',
    beds: 5,
    baths: 4,
    area: '4,100 sqft',
    description:
      'A spacious family villa with a private garden, designed for peaceful and comfortable living.',
    amenities: ['Garden', 'Parking', 'Terrace', 'Security'],
    images: [assets.project_img_2],
    mainImage: assets.project_img_2,
    agent: {
      name: 'Arda Aydin',
      phone: '+90 541 234 9876',
      email: 'arda@estate.com',
    },
    createdAt: new Date().toISOString(),
  },
]

export const PropertyProvider = ({ children }) => {
  const [properties, setProperties] = useState(() => {
    const savedProperties = localStorage.getItem('properties')

    if (savedProperties) {
      return JSON.parse(savedProperties)
    }

    return defaultProperties
  })

  useEffect(() => {
    localStorage.setItem('properties', JSON.stringify(properties))
  }, [properties])

  const addProperty = (property) => {
    const newProperty = {
      ...property,
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
    }

    setProperties((prev) => [newProperty, ...prev])
  }

  const updateProperty = (id, updatedProperty) => {
    setProperties((prev) =>
      prev.map((property) =>
        property.id === id ? { ...property, ...updatedProperty } : property
      )
    )
  }

  const deleteProperty = (id) => {
    setProperties((prev) => prev.filter((property) => property.id !== id))
  }

  const getPropertyById = (id) => {
    return properties.find((property) => property.id === id)
  }

  return (
    <PropertyContext.Provider
      value={{
        properties,
        addProperty,
        updateProperty,
        deleteProperty,
        getPropertyById,
      }}
    >
      {children}
    </PropertyContext.Provider>
  )
}

export const useProperties = () => {
  return useContext(PropertyContext)
}