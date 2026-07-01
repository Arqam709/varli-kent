// src/components/About.jsx
import React from 'react'
import { assets } from '../assets/assets'

const About = () => {
  return (
    <section id='About' className='bg-slate-50 py-20'>
      <div className='container mx-auto px-6'>
        <div className='grid gap-10 lg:grid-cols-[1.2fr_0.8fr] items-center'>
          <div>
            <p className='text-sm uppercase tracking-[0.4em] text-slate-500'>About Us</p>
            <h2 className='mt-4 text-4xl font-semibold text-slate-900'>A refined approach to luxury real estate.</h2>
            <p className='mt-6 text-lg leading-8 text-slate-600'>We bring together market insight, local expertise, and exceptional service to help buyers and sellers make confident, premium decisions.</p>

            <div className='mt-12 grid gap-6 sm:grid-cols-2'>
              <div className='rounded-3xl border border-slate-200 bg-white p-8 shadow-sm'>
                <p className='text-4xl font-semibold text-slate-900'>10+</p>
                <p className='mt-2 text-slate-600'>Years Experience</p>
              </div>
              <div className='rounded-3xl border border-slate-200 bg-white p-8 shadow-sm'>
                <p className='text-4xl font-semibold text-slate-900'>120+</p>
                <p className='mt-2 text-slate-600'>Happy Clients</p>
              </div>
              <div className='rounded-3xl border border-slate-200 bg-white p-8 shadow-sm'>
                <p className='text-4xl font-semibold text-slate-900'>50+</p>
                <p className='mt-2 text-slate-600'>Properties Listed</p>
              </div>
              <div className='rounded-3xl border border-slate-200 bg-white p-8 shadow-sm'>
                <p className='text-4xl font-semibold text-slate-900'>25+</p>
                <p className='mt-2 text-slate-600'>Ongoing Projects</p>
              </div>
            </div>
          </div>

          <div className='overflow-hidden rounded-[2rem] bg-slate-900 shadow-2xl'>
            <img src={assets.brand_img} alt='Luxury real estate experience' className='h-full w-full object-cover' />
          </div>
        </div>
      </div>
    </section>
  )
}

export default About

