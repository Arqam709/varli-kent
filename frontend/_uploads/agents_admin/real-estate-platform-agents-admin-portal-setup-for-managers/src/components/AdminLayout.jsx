import React from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAdminAuth } from '../contexts/AdminAuthContext'

const AdminLayout = ({ children }) => {
  const { managerEmail, logoutManager } = useAdminAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logoutManager()
    navigate('/admin/login')
  }

  const linkClasses = ({ isActive }) =>
    `text-sm font-semibold ${isActive ? 'text-slate-950' : 'text-slate-500 hover:text-slate-900'}`

  return (
    <div className='min-h-screen bg-slate-100'>
      <header className='bg-white border-b border-slate-200'>
        <div className='container mx-auto flex flex-col gap-5 px-6 py-6 md:flex-row md:items-center md:justify-between'>
          <div>
            <p className='text-sm uppercase tracking-[0.4em] text-slate-500'>Manager Portal</p>
            <h1 className='mt-2 text-3xl font-semibold text-slate-900'>Manager Dashboard</h1>
            <p className='mt-1 text-sm text-slate-600'>Signed in as {managerEmail}</p>
          </div>
          <div className='flex flex-wrap items-center gap-3'>
            <button onClick={handleLogout} className='rounded-full bg-rose-600 px-5 py-3 text-sm font-semibold text-white hover:bg-rose-700 transition'>
              Logout
            </button>
          </div>
        </div>
      </header>

      <nav className='bg-slate-50 border-b border-slate-200'>
        <div className='container mx-auto px-6 py-4 flex flex-wrap gap-4'>
          <NavLink to='/admin/dashboard' className={linkClasses}>Dashboard</NavLink>
          <NavLink to='/admin/properties' className={linkClasses}>Properties</NavLink>
          <NavLink to='/admin/messages' className={linkClasses}>Messages</NavLink>
        </div>
      </nav>

      <main className='container mx-auto px-6 py-10'>{children}</main>
    </div>
  )
}

export default AdminLayout
