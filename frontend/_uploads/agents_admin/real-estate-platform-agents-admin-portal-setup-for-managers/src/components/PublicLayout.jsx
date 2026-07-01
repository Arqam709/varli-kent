import React from 'react'
import Navbar from './Navbar'

const PublicLayout = ({ children }) => {
  return (
    <div className='min-h-screen bg-slate-50 text-slate-900'>
      <Navbar />
      <main>{children}</main>
    </div>
  )
}

export default PublicLayout
