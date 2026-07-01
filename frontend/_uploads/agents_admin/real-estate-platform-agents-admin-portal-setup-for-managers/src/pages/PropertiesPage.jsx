import React from 'react'
import { Link } from 'react-router-dom'
import { useAdminAuth } from '../contexts/AdminAuthContext'

const PropertiesPage = () => {

  const { properties, isLoading } = useAdminAuth()

if (isLoading) {
  return <div className='p-10 text-center'>Loading properties...</div>
}


  return (
    <div className='min-h-screen bg-slate-50 pb-16'>
      <section className='bg-white shadow-sm border-b border-slate-200'>
        <div className='container mx-auto px-6 py-16'>
          <p className='text-sm uppercase tracking-[0.4em] text-slate-500'>Properties</p>
          <h1 className='mt-4 text-4xl font-semibold text-slate-900'>Discover Premium Residences</h1>
          <p className='mt-4 text-slate-600 max-w-2xl'>Explore luxury homes and curated rental residences across Istanbul’s finest neighborhoods.</p>
        </div>
      </section>

      <section className='container mx-auto px-6 py-12'>
        <div className='grid gap-8 lg:grid-cols-3'>
          {properties.map((property) => (
            <div key={property.id} className='group bg-white shadow-lg rounded-3xl overflow-hidden border border-slate-200 transition hover:-translate-y-1'>
              <div className='relative'>
                <img src={property.image} alt={property.title} className='w-full h-72 object-cover' />
                <span className={`absolute left-4 top-4 rounded-full px-4 py-2 text-sm font-semibold ${property.status === 'For Rent' ? 'bg-emerald-100 text-emerald-800' : property.status === 'Featured' ? 'bg-slate-900 text-white' : 'bg-blue-100 text-blue-800'}`}>
                  {property.status}
                </span>
              </div>
              <div className='p-6'>
                <div className='flex items-center justify-between'>
                  <p className='text-xl font-semibold text-slate-900'>{property.price}</p>
                  <p className='text-sm uppercase tracking-[0.2em] text-slate-500'>{property.type}</p>
                </div>
                <h2 className='mt-4 text-2xl font-semibold text-slate-900'>{property.title}</h2>
                <p className='mt-2 text-slate-600'>{property.address}</p>
                <p className='mt-1 text-slate-500'>{property.location}</p>
                <div className='mt-6 grid grid-cols-3 gap-3 text-sm text-slate-600'>
                  <div className='rounded-2xl bg-slate-100 p-3 text-center'>
                    <p className='font-semibold'>{property.beds}</p>
                    <p>Beds</p>
                  </div>
                  <div className='rounded-2xl bg-slate-100 p-3 text-center'>
                    <p className='font-semibold'>{property.baths}</p>
                    <p>Baths</p>
                  </div>
                  <div className='rounded-2xl bg-slate-100 p-3 text-center'>
                    <p className='font-semibold'>{property.area}</p>
                    <p>Area</p>
                  </div>
                </div>
                <Link to={`/properties/${property.id}`} className='mt-6 inline-flex items-center justify-center w-full rounded-full bg-slate-900 text-white py-3 text-sm font-semibold transition hover:bg-slate-800'>
                  View Details
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

export default PropertiesPage
