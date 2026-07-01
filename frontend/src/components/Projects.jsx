import React from 'react'
import { Link } from 'react-router-dom'
import { propertiesData } from '../assets/assets'

const Projects = () => {
  return (
    <section className='bg-slate-50 py-20'>
      <div className='container mx-auto px-6'>
        <div className='text-center'>
          <p className='text-sm uppercase tracking-[0.4em] text-slate-500'>Featured Properties</p>
          <h2 className='mt-4 text-4xl font-semibold text-slate-900'>Exclusive homes curated for sophisticated buyers.</h2>
          <p className='mx-auto mt-4 max-w-2xl text-slate-600'>Our portfolio highlights premium properties with exceptional design, location, and investment potential.</p>
        </div>

        <div className='mt-12 grid gap-8 lg:grid-cols-3'>
          {propertiesData.slice(0, 3).map((property) => (
            <div key={property.id} className='group overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-lg transition hover:-translate-y-1'>
              <div className='relative'>
                <img src={property.image} alt={property.title} className='h-80 w-full object-cover transition duration-500 group-hover:scale-105' />
                <span className={`absolute left-4 top-4 rounded-full px-4 py-2 text-sm font-semibold ${property.status === 'For Rent' ? 'bg-emerald-100 text-emerald-900' : property.status === 'Featured' ? 'bg-slate-900 text-white' : 'bg-blue-100 text-blue-900'}`}>
                  {property.status}
                </span>
              </div>
              <div className='p-8'>
                <div className='flex items-center justify-between gap-4'>
                  <p className='text-xl font-semibold text-slate-900'>{property.price}</p>
                  <span className='rounded-full bg-slate-100 px-3 py-1 text-xs uppercase tracking-[0.2em] text-slate-600'>{property.type}</span>
                </div>
                <h3 className='mt-4 text-2xl font-semibold text-slate-900'>{property.title}</h3>
                <p className='mt-2 text-slate-600'>{property.address}</p>
                <div className='mt-6 grid grid-cols-3 gap-3 text-sm text-slate-500'>
                  <div className='rounded-3xl bg-slate-100 p-3 text-center'>
                    <p className='font-semibold'>{property.beds}</p>
                    <p>Beds</p>
                  </div>
                  <div className='rounded-3xl bg-slate-100 p-3 text-center'>
                    <p className='font-semibold'>{property.baths}</p>
                    <p>Baths</p>
                  </div>
                  <div className='rounded-3xl bg-slate-100 p-3 text-center'>
                    <p className='font-semibold'>{property.area}</p>
                    <p>Area</p>
                  </div>
                </div>
                <Link to={`/properties/${property.id}`} className='mt-8 inline-flex w-full items-center justify-center rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800'>
                  View Details
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export default Projects
