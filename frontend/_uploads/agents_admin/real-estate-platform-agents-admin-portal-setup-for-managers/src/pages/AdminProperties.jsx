import React, { useEffect, useState } from 'react'
import { useAdminAuth } from '../contexts/AdminAuthContext'
import AdminLayout from '../components/AdminLayout'

const AdminProperties = () => {
  const { properties, addProperty, updateProperty, deleteProperty } = useAdminAuth()
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [formData, setFormData] = useState({
    title: '',
    address: '',
    location: '',
    price: '',
    type: 'Sale',
    status: 'For Sale',
    beds: '',
    baths: '',
    area: '',
  })

  useEffect(() => {
    if (!formOpen) {
      setEditingId(null)
      setFormData({
        title: '',
        address: '',
        location: '',
        price: '',
        type: 'Sale',
        status: 'For Sale',
        beds: '',
        baths: '',
        area: '',
      })
    }
  }, [formOpen])

  const handleEdit = (property) => {
    setEditingId(property.id)
    setFormData({
      title: property.title,
      address: property.address,
      location: property.location,
      price: property.price,
      type: property.type,
      status: property.status,
      beds: property.beds,
      baths: property.baths,
      area: property.area,
    })
    setFormOpen(true)
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const payload = {
      ...formData,
      id: editingId || Date.now(),
      image: properties[0]?.image || '',
      gallery: properties[0]?.gallery || [],
      description: properties[0]?.description || 'A luxury property listing managed by our team.',
      amenities: properties[0]?.amenities || ['Prime location', 'Luxury finishes', 'Secure property'],
      agent: properties[0]?.agent || { name: 'Property Manager', phone: '+90 500 000 0000', email: 'contact@luxre.co' },
    }

    if (editingId) {
      updateProperty(payload)
    } else {
      addProperty(payload)
    }

    setFormOpen(false)
  }

  return (
    <AdminLayout>
      <div className='space-y-8'>
        <div className='rounded-3xl bg-white p-8 shadow-lg border border-slate-200'>
          <div className='flex flex-col gap-4 md:flex-row md:items-center md:justify-between'>
            <div>
              <h2 className='text-2xl font-semibold text-slate-900'>Property Management</h2>
              <p className='mt-2 text-slate-600'>Manage your property listings in one place. Add new entries or update existing details.</p>
            </div>
            <button
              onClick={() => setFormOpen((prev) => !prev)}
              className='rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-800 transition'
            >
              {formOpen ? 'Close Form' : 'Add Property'}
            </button>
          </div>

          {formOpen && (
            <form onSubmit={handleSubmit} className='mt-8 grid gap-6'>
              <div className='grid gap-6 md:grid-cols-2'>
                <input
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder='Property title'
                  className='w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3'
                  required
                />
                <input
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder='Address'
                  className='w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3'
                  required
                />
              </div>
              <div className='grid gap-6 md:grid-cols-3'>
                <input
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  placeholder='Location'
                  className='w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3'
                  required
                />
                <input
                  value={formData.price}
                  onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                  placeholder='Price'
                  className='w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3'
                  required
                />
                <input
                  value={formData.area}
                  onChange={(e) => setFormData({ ...formData, area: e.target.value })}
                  placeholder='Area'
                  className='w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3'
                  required
                />
              </div>
              <div className='grid gap-6 md:grid-cols-3'>
                <input
                  value={formData.beds}
                  onChange={(e) => setFormData({ ...formData, beds: e.target.value })}
                  placeholder='Beds'
                  className='w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3'
                  required
                />
                <input
                  value={formData.baths}
                  onChange={(e) => setFormData({ ...formData, baths: e.target.value })}
                  placeholder='Baths'
                  className='w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3'
                  required
                />
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                  className='w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3'
                >
                  <option value='Sale'>Sale</option>
                  <option value='Rent'>Rent</option>
                </select>
              </div>
              <div className='grid gap-6 md:grid-cols-2'>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  className='w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3'
                >
                  <option value='For Sale'>For Sale</option>
                  <option value='For Rent'>For Rent</option>
                  <option value='Featured'>Featured</option>
                </select>
                <button type='submit' className='rounded-3xl bg-slate-900 px-6 py-3 font-semibold text-white hover:bg-slate-800 transition'>
                  {editingId ? 'Update Listing' : 'Save Listing'}
                </button>
              </div>
            </form>
          )}
        </div>

        <div className='grid gap-6 lg:grid-cols-2'>
          {properties.map((property) => (
            <div key={property.id} className='rounded-3xl border border-slate-200 bg-white p-6 shadow-sm'>
              <div className='grid gap-4 sm:grid-cols-[1fr_2fr]'>
                <img src={property.image} alt={property.title} className='h-40 w-full rounded-3xl object-cover' />
                <div className='space-y-3'>
                  <div className='flex items-center justify-between'>
                    <p className='text-lg font-semibold text-slate-900'>{property.title}</p>
                    <span className='rounded-full bg-slate-100 px-3 py-1 text-xs uppercase tracking-[0.2em] text-slate-600'>{property.status}</span>
                  </div>
                  <p className='text-slate-500'>{property.address} · {property.location}</p>
                  <p className='text-slate-700 font-semibold'>{property.price}</p>
                  <div className='flex flex-wrap gap-2 text-sm text-slate-600'>
                    <span>{property.beds} beds</span>
                    <span>{property.baths} baths</span>
                    <span>{property.area}</span>
                  </div>
                  <div className='flex flex-wrap gap-3'>
                    <button onClick={() => handleEdit(property)} className='rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100 transition'>Edit</button>
                    <button onClick={() => deleteProperty(property.id)} className='rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100 transition'>Delete</button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AdminLayout>
  )
}

export default AdminProperties
