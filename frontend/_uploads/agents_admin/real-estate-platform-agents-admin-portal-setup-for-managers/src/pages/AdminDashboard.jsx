import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useAdminAuth } from '../contexts/AdminAuthContext'
import AdminLayout from '../components/AdminLayout'

const AdminDashboard = () => {
  const navigate = useNavigate()
  const { properties, messages } = useAdminAuth()

  const totalProperties = properties.length
  const propertiesForSale = properties.filter((property) => property.type === 'Sale').length
  const propertiesForRent = properties.filter((property) => property.type === 'Rent').length
  const totalMessages = messages.length
  const newMessages = messages.filter((message) => message.status === 'New').length

  return (
    <AdminLayout>
      <div className='space-y-10'>
        <div className='grid gap-6 md:grid-cols-2 xl:grid-cols-4'>
          <div className='rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm'>
            <p className='text-sm uppercase tracking-[0.4em] text-slate-500'>Total Properties</p>
            <p className='mt-4 text-4xl font-semibold text-slate-950'>{totalProperties}</p>
          </div>
          <div className='rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm'>
            <p className='text-sm uppercase tracking-[0.4em] text-slate-500'>For Sale</p>
            <p className='mt-4 text-4xl font-semibold text-slate-950'>{propertiesForSale}</p>
          </div>
          <div className='rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm'>
            <p className='text-sm uppercase tracking-[0.4em] text-slate-500'>For Rent</p>
            <p className='mt-4 text-4xl font-semibold text-slate-950'>{propertiesForRent}</p>
          </div>
          <div className='rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm'>
            <p className='text-sm uppercase tracking-[0.4em] text-slate-500'>Total Leads</p>
            <p className='mt-4 text-4xl font-semibold text-slate-950'>{totalMessages}</p>
          </div>
        </div>

        <div className='grid gap-6 lg:grid-cols-[1fr_0.85fr]'>
          <div className='rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm'>
            <div className='flex items-center justify-between gap-4'>
              <div>
                <p className='text-sm uppercase tracking-[0.4em] text-slate-500'>Recent Leads</p>
                <h2 className='mt-4 text-3xl font-semibold text-slate-950'>Latest inquiries</h2>
              </div>
              <button
                onClick={() => navigate('/admin/messages')}
                className='rounded-full border border-slate-200 bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 transition'
              >
                View All
              </button>
            </div>
            <div className='mt-8 space-y-5'>
              {messages.slice(0, 4).map((message) => (
                <div key={message.id} className='rounded-3xl border border-slate-200 bg-slate-50 p-5'>
                  <div className='flex items-center justify-between gap-4'>
                    <div>
                      <h3 className='text-lg font-semibold text-slate-950'>{message.name}</h3>
                      <p className='text-sm text-slate-600'>{message.interest} inquiry</p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${message.status === 'New' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                      {message.status}
                    </span>
                  </div>
                  <p className='mt-3 text-slate-600'>{message.message}</p>
                  <p className='mt-3 text-sm text-slate-500'>Email: {message.email} · Phone: {message.phone}</p>
                </div>
              ))}
              {messages.length === 0 && <p className='text-sm text-slate-500'>No leads are available yet.</p>}
            </div>
          </div>

          <div className='rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm'>
            <p className='text-sm uppercase tracking-[0.4em] text-slate-500'>Manager Insights</p>
            <h2 className='mt-4 text-3xl font-semibold text-slate-950'>Today&apos;s view</h2>
            <p className='mt-4 text-slate-600'>Review active listings, manage new property submissions, and respond to inbound leads through the admin portal.</p>
            <div className='mt-8 space-y-4'>
              <button
                onClick={() => navigate('/admin/properties')}
                className='w-full rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 transition'
              >
                Manage Properties
              </button>
              <button
                onClick={() => navigate('/admin/messages')}
                className='w-full rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-slate-100 transition'
              >
                Review Leads
              </button>
              <div className='rounded-3xl bg-slate-50 p-5 text-sm text-slate-600'>
                <p className='font-semibold text-slate-900'>Note</p>
                <p className='mt-2'>This admin portal uses frontend-only state and localStorage as a temporary development prototype. For production, use a backend with JWT/session authentication, hashed passwords, and protected API routes.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  )
}

export default AdminDashboard
