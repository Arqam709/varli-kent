import React, { useState } from 'react'
import { toast } from 'react-toastify'
import { useAdminAuth } from '../contexts/AdminAuthContext'

const Contact = () => {
  const [formState, setFormState] = useState({
    name: '',
    email: '',
    phone: '',
    interest: 'Buying',
    message: '',
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { addLead } = useAdminAuth()

  const handleChange = (event) => {
    const { name, value } = event.target
    setFormState((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    setIsSubmitting(true)

    const lead = {
      id: Date.now(),
      name: formState.name,
      email: formState.email,
      phone: formState.phone,
      interest: formState.interest,
      message: formState.message,
      status: 'New',
    }

    addLead(lead)
    toast.success('Your request has been submitted. Our team will contact you soon.')
    setFormState({ name: '', email: '', phone: '', interest: 'Buying', message: '' })
    setIsSubmitting(false)
  }

  return (
    <section id='contact' className='bg-slate-950 py-20 text-white'>
      <div className='container mx-auto px-6'>
        <div className='grid gap-10 lg:grid-cols-[1.25fr_0.9fr] items-start'>
          <div>
            <p className='text-sm uppercase tracking-[0.4em] text-slate-400'>Contact & Leads</p>
            <h2 className='mt-4 text-4xl font-semibold'>Request a private showing or start your luxury transaction.</h2>
            <p className='mt-6 max-w-2xl text-slate-300'>Our team is ready to assist with buying, selling, and rental inquiries. Submit your details and we will connect with you promptly.</p>

            <div className='mt-12 space-y-4 rounded-[2rem] border border-slate-800 bg-slate-900/80 p-8'>
              <div>
                <p className='text-sm uppercase tracking-[0.4em] text-slate-400'>Office</p>
                <p className='mt-2 text-lg font-semibold text-white'>Istanbul Luxury Realty</p>
              </div>
              <div>
                <p className='text-sm uppercase tracking-[0.4em] text-slate-400'>Email</p>
                <p className='mt-2 text-slate-300'>info@luxre.co</p>
              </div>
              <div>
                <p className='text-sm uppercase tracking-[0.4em] text-slate-400'>WhatsApp</p>
                <a href='https://wa.me/905301234567' target='_blank' rel='noreferrer' className='mt-2 inline-block text-slate-100 hover:text-white'>+90 530 123 4567</a>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className='rounded-[2rem] bg-white p-8 text-slate-900 shadow-2xl'>
            <div className='grid gap-6'>
              <div>
                <label htmlFor='name' className='block text-sm font-semibold'>Name</label>
                <input
                  id='name'
                  name='name'
                  value={formState.name}
                  onChange={handleChange}
                  type='text'
                  placeholder='Your name'
                  className='mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-400'
                  required
                />
              </div>
              <div className='grid gap-6 md:grid-cols-2'>
                <div>
                  <label htmlFor='email' className='block text-sm font-semibold'>Email</label>
                  <input
                    id='email'
                    name='email'
                    value={formState.email}
                    onChange={handleChange}
                    type='email'
                    placeholder='you@example.com'
                    className='mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-400'
                    required
                  />
                </div>
                <div>
                  <label htmlFor='phone' className='block text-sm font-semibold'>Phone</label>
                  <input
                    id='phone'
                    name='phone'
                    value={formState.phone}
                    onChange={handleChange}
                    type='tel'
                    placeholder='+90 5xx xxx xxxx'
                    className='mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-400'
                    required
                  />
                </div>
              </div>
              <div>
                <label htmlFor='interest' className='block text-sm font-semibold'>Interested In</label>
                <select
                  id='interest'
                  name='interest'
                  value={formState.interest}
                  onChange={handleChange}
                  className='mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-400'
                >
                  <option>Buying</option>
                  <option>Selling</option>
                  <option>Renting</option>
                  <option>Other</option>
                </select>
              </div>
              <div>
                <label htmlFor='message' className='block text-sm font-semibold'>Message</label>
                <textarea
                  id='message'
                  name='message'
                  value={formState.message}
                  onChange={handleChange}
                  rows='5'
                  placeholder='Tell us how we can help'
                  className='mt-2 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-400'
                  required
                />
              </div>
              <button
                type='submit'
                disabled={isSubmitting}
                className='rounded-full bg-slate-950 px-6 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-white shadow-lg transition hover:bg-slate-800 disabled:opacity-60'
              >
                {isSubmitting ? 'Sending...' : 'Submit Request'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  )
}

export default Contact
