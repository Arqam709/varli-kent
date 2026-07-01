import React from 'react'
import { Link } from 'react-router-dom'
import { communityData } from '../assets/assets'

const CommunitiesPage = () => {
  return (
    <div className='min-h-screen bg-slate-50 pb-16'>
      <section className='bg-white shadow-sm border-b border-slate-200'>
        <div className='container mx-auto px-6 py-16'>
          <p className='text-sm uppercase tracking-[0.4em] text-slate-500'>Communities</p>
          <h1 className='mt-4 text-4xl font-semibold text-slate-900'>Explore Istanbul’s Most Prestigious Neighborhoods</h1>
          <p className='mt-4 text-slate-600 max-w-2xl'>Discover unique lifestyle districts and find your ideal location in the city’s finest communities.</p>
        </div>
      </section>

      <section className='container mx-auto px-6 py-12'>
        <div className='grid gap-8 lg:grid-cols-3'>
          {communityData.map((community) => (
            <div key={community.id} className='group overflow-hidden rounded-3xl shadow-lg border border-slate-200 bg-white'>
              <img src={community.image} alt={community.name} className='h-72 w-full object-cover transition duration-500 group-hover:scale-105' />
              <div className='p-6'>
                <h2 className='text-2xl font-semibold text-slate-900'>{community.name}</h2>
                <p className='mt-3 text-slate-600'>{community.description}</p>
                <Link to='/properties' className='mt-6 inline-flex items-center text-sm font-semibold text-slate-900 hover:text-slate-700'>
                  Explore
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

export default CommunitiesPage
