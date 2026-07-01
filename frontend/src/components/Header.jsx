import React from 'react'
import { Link } from 'react-router-dom'
import { assets } from '../assets/assets'

const Header = () => {
  return (
    <div
      className='min-h-screen bg-cover bg-center relative overflow-hidden'
      style={{ backgroundImage: `linear-gradient(rgba(15, 23, 42, 0.55), rgba(15, 23, 42, 0.55)), url(${assets.header_img})` }}
    >
      <div className='absolute inset-0 bg-slate-950/50'></div>
      <div className='relative container mx-auto px-6 py-32 text-center text-white'>
      <p className='text-sm uppercase tracking-[0.4em] text-slate-300'>Luxury real estate</p>
      <h1 className='mt-6 text-5xl font-semibold tracking-tight sm:text-6xl'>Luxury Homes, Trusted Guidance</h1>
      <p className='mx-auto mt-6 max-w-3xl text-lg leading-8 text-slate-200'>Discover premium properties for buying, selling, and renting with expert real estate support.</p>

      <div className='mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row'>
        <Link to='/properties' className='rounded-full bg-amber-400 px-8 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-slate-950 shadow-lg shadow-amber-500/20 transition hover:bg-amber-300'>
          Explore Properties
        </Link>
        <Link to='/contact' className='rounded-full border border-white bg-white/10 px-8 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-white/20'>
          Contact Us
        </Link>
      </div>
      </div>
    </div>
  )
}

export default Header
