import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { assets } from '../assets/assets'

const Navbar = () => {
  const [showMobileMenu, setShowMobileMenu] = useState(false)

  useEffect(() => {
    if (showMobileMenu) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'auto'
    }
    return () => {
      document.body.style.overflow = 'auto'
    }
  }, [showMobileMenu])

  const links = [
    { name: 'Home', to: '/' },
    { name: 'Properties', to: '/properties' },
    { name: 'Communities', to: '/communities' },
    { name: 'Buying', to: '/buying' },
    { name: 'Selling', to: '/selling' },
    { name: 'About', to: '/about' },
    { name: 'Contact', to: '/contact' },
  ]

  return (
    <div className='absolute top-0 left-0 w-full z-20'>
      <div className='container mx-auto flex items-center justify-between px-6 py-4 md:px-10 lg:px-20'>
        <Link to='/'>
          <img src={assets.logo} alt='Luxury logo' className='h-10 w-auto' />
        </Link>

        <nav className='hidden items-center gap-8 md:flex'>
          {links.map((link) => (
            <Link key={link.to} to={link.to} className='text-sm font-medium text-white transition hover:text-slate-200'>
              {link.name}
            </Link>
          ))}
        </nav>

        <button className='hidden rounded-full bg-white px-6 py-2 text-sm font-semibold text-slate-950 md:inline-flex'>Contact Us</button>

        <img
          src={assets.menu_icon}
          alt='Open menu'
          className='md:hidden h-7 w-7 cursor-pointer'
          onClick={() => setShowMobileMenu(true)}
        />
      </div>

      {showMobileMenu && (
        <div className='fixed inset-0 z-30 bg-slate-950/95'>
          <div className='flex items-center justify-between px-6 py-5'>
            <Link to='/' onClick={() => setShowMobileMenu(false)}>
              <img src={assets.logo} alt='Logo' className='h-10 w-auto' />
            </Link>
            <img
              src={assets.cross_icon}
              alt='Close menu'
              className='h-6 w-6 cursor-pointer text-white'
              onClick={() => setShowMobileMenu(false)}
            />
          </div>
          <div className='mt-10 space-y-4 px-6'>
            {links.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                onClick={() => setShowMobileMenu(false)}
                className='block rounded-3xl bg-white px-5 py-4 text-base font-semibold text-slate-950'
              >
                {link.name}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default Navbar
