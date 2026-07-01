import React from 'react'
import { useAdminAuth } from '../contexts/AdminAuthContext'
import AdminLayout from '../components/AdminLayout'

const AdminMessages = () => {
  const { messages, markMessageReplied } = useAdminAuth()

  return (
    <AdminLayout>
      <div className='space-y-8'>
        <div className='rounded-3xl bg-white p-8 shadow-lg border border-slate-200'>
          <h2 className='text-2xl font-semibold text-slate-900'>Lead Inbox</h2>
          <p className='mt-2 text-slate-600'>Review submitted inquiries and mark them as replied once followed up.</p>
        </div>

        <div className='overflow-x-auto rounded-3xl bg-white shadow-lg border border-slate-200'>
          <table className='min-w-full divide-y divide-slate-200'>
            <thead className='bg-slate-950 text-white'>
              <tr>
                <th className='px-6 py-4 text-left text-sm font-semibold uppercase tracking-[0.2em]'>Name</th>
                <th className='px-6 py-4 text-left text-sm font-semibold uppercase tracking-[0.2em]'>Email</th>
                <th className='px-6 py-4 text-left text-sm font-semibold uppercase tracking-[0.2em]'>Phone</th>
                <th className='px-6 py-4 text-left text-sm font-semibold uppercase tracking-[0.2em]'>Interest</th>
                <th className='px-6 py-4 text-left text-sm font-semibold uppercase tracking-[0.2em]'>Message</th>
                <th className='px-6 py-4 text-left text-sm font-semibold uppercase tracking-[0.2em]'>Status</th>
                <th className='px-6 py-4 text-left text-sm font-semibold uppercase tracking-[0.2em]'>Action</th>
              </tr>
            </thead>
            <tbody className='divide-y divide-slate-200 bg-white'>
              {messages.map((message) => (
                <tr key={message.id} className='hover:bg-slate-50'>
                  <td className='whitespace-nowrap px-6 py-4 text-sm text-slate-900'>{message.name}</td>
                  <td className='px-6 py-4 text-sm text-slate-600'>{message.email}</td>
                  <td className='px-6 py-4 text-sm text-slate-600'>{message.phone}</td>
                  <td className='px-6 py-4 text-sm text-slate-600'>{message.interest}</td>
                  <td className='px-6 py-4 max-w-sm text-sm text-slate-600'>{message.message}</td>
                  <td className='px-6 py-4'>
                    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${message.status === 'New' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                      {message.status}
                    </span>
                  </td>
                  <td className='px-6 py-4'>
                    {message.status === 'New' ? (
                      <button onClick={() => markMessageReplied(message.id)} className='rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 transition'>
                        Mark Replied
                      </button>
                    ) : (
                      <span className='text-sm text-slate-500'>Completed</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AdminLayout>
  )
}

export default AdminMessages
