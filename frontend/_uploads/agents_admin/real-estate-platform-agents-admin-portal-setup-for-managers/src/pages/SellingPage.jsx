import React from 'react'
import { sellingBenefits } from '../assets/assets'

const SellingPage = () => {
  return (
    <div className='min-h-screen bg-slate-50 pb-16'>
      <section className='bg-slate-950 text-white'>
        <div className='container mx-auto px-6 py-20'>
          <p className='text-sm uppercase tracking-[0.4em] text-slate-400'>Selling Services</p>
          <h1 className='mt-4 text-4xl font-semibold'>Sell with Confidence and Market-Leading Exposure</h1>
          <p className='mt-4 max-w-3xl text-slate-300'>Our approach is designed to maximize value, accelerate offers, and provide a seamless closing experience for sellers.</p>
        </div>
      </section>

      <section className='container mx-auto px-6 py-12'>
        <div className='grid gap-8 md:grid-cols-2 lg:grid-cols-3'>
          {sellingBenefits.map((benefit) => (
            <div key={benefit.title} className='rounded-3xl border border-slate-200 bg-white p-8 shadow-lg'>
              <div className='inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900 text-white text-2xl'>{benefit.icon}</div>
              <h2 className='mt-6 text-2xl font-semibold text-slate-900'>{benefit.title}</h2>
              <p className='mt-3 text-slate-600'>{benefit.description}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

export default SellingPage
