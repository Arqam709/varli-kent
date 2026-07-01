import React from 'react'
import { assets, testimonialsData } from '../assets/assets'

const Testimonials = () => {
  return (
    <section className='bg-white py-20'>
      <div className='container mx-auto px-6'>
        <div className='text-center'>
          <p className='text-sm uppercase tracking-[0.4em] text-slate-500'>Client Stories</p>
          <h2 className='mt-4 text-4xl font-semibold text-slate-900'>Trusted by buyers and sellers across Istanbul.</h2>
          <p className='mx-auto mt-4 max-w-2xl text-slate-600'>Read feedback from clients who experienced exceptional service, smart strategy, and luxurious results.</p>
        </div>

        <div className='mt-12 grid gap-8 md:grid-cols-3'>
          {testimonialsData.map((testimonial, index) => (
            <div key={index} className='rounded-[2rem] border border-slate-200 bg-slate-50 p-8 shadow-lg'>
              <img className='h-20 w-20 rounded-full object-cover' src={testimonial.image} alt={testimonial.alt} />
              <h3 className='mt-6 text-xl font-semibold text-slate-900'>{testimonial.name}</h3>
              <p className='mt-2 text-sm uppercase tracking-[0.16em] text-slate-500'>{testimonial.title}</p>
              <div className='mt-4 flex gap-1'>
                {Array.from({ length: testimonial.rating }, (_, starIndex) => (
                  <img key={starIndex} src={assets.star_icon} alt='Star' className='h-4 w-4' />
                ))}
              </div>
              <p className='mt-6 text-slate-600'>{testimonial.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export default Testimonials
