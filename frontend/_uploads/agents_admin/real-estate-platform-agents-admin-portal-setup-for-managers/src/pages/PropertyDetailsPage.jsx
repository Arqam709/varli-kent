import React from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAdminAuth } from '../contexts/AdminAuthContext'

const PropertyDetailsPage = () => {
  const { id } = useParams()
  const { properties, isLoading } = useAdminAuth()

  const property = properties.find((item) => String(item.id) === id)

  if (isLoading) {
    return (
      <div className='min-h-screen bg-slate-50 flex items-center justify-center px-6'>
        <div className='bg-white p-12 rounded-3xl shadow-lg text-center'>
          <h1 className='text-3xl font-semibold text-slate-900'>Loading property...</h1>
        </div>
      </div>
    )
  }

  if (!property) {
    return (
      <div className='min-h-screen bg-slate-50 flex items-center justify-center px-6'>
        <div className='bg-white p-12 rounded-3xl shadow-lg text-center'>
          <h1 className='text-3xl font-semibold text-slate-900'>Property not found</h1>
          <p className='mt-4 text-slate-600'>Please return to the property listings and select a valid home.</p>
          <Link to='/properties' className='mt-6 inline-block bg-slate-900 text-white px-6 py-3 rounded-full'>
            Back to Properties
          </Link>
        </div>
      </div>
    )
  }

  const galleryImages = property.gallery?.length ? property.gallery : [property.image]
  const amenities = property.amenities?.length ? property.amenities : ['Prime location', 'Luxury finishes', 'Secure property']

  const agent = property.agent || {
    name: 'Property Manager',
    phone: '+90 500 000 0000',
    email: 'contact@luxre.co',
  }

  return (
    <div className='min-h-screen bg-slate-50 pb-16'>
      <section className='bg-white shadow-sm border-b border-slate-200'>
        <div className='container mx-auto px-6 py-12'>
          <Link to='/properties' className='text-slate-500 hover:text-slate-900'>
            ← Back to listings
          </Link>

          <div className='mt-6 grid gap-8 lg:grid-cols-[2fr_1fr] items-start'>
            <div>
              <p className='text-sm uppercase tracking-[0.2em] text-slate-500'>{property.status}</p>
              <h1 className='mt-4 text-4xl font-semibold text-slate-900'>{property.title}</h1>
              <p className='mt-3 text-slate-600'>{property.address}</p>
              <p className='mt-1 text-slate-500'>{property.location}</p>
            </div>

            <div className='rounded-full bg-slate-950 px-5 py-4 text-white inline-flex items-center justify-center text-sm font-semibold uppercase tracking-[0.2em]'>
              {property.type}
            </div>
          </div>
        </div>
      </section>

      <section className='container mx-auto px-6 py-12'>
        <div className='grid gap-10 lg:grid-cols-[2fr_1fr]'>
          <div>
            <div className='grid gap-4 sm:grid-cols-2'>
              {galleryImages.map((image, index) => (
                <img
                  key={index}
                  src={image}
                  alt={`${property.title} image ${index + 1}`}
                  className='w-full h-72 object-cover rounded-3xl shadow-lg'
                />
              ))}
            </div>

            <div className='mt-10 rounded-3xl bg-white p-8 shadow-lg border border-slate-200'>
              <div className='grid grid-cols-3 gap-4 text-center text-slate-700'>
                <div>
                  <p className='text-2xl font-semibold text-slate-900'>{property.beds}</p>
                  <p>Beds</p>
                </div>

                <div>
                  <p className='text-2xl font-semibold text-slate-900'>{property.baths}</p>
                  <p>Baths</p>
                </div>

                <div>
                  <p className='text-2xl font-semibold text-slate-900'>{property.area}</p>
                  <p>Area</p>
                </div>
              </div>

              <div className='mt-8'>
                <h2 className='text-2xl font-semibold text-slate-900'>Property Overview</h2>
                <p className='mt-4 text-slate-600'>
                  {property.description || 'A luxury property listing managed by our team.'}
                </p>
              </div>

              <div className='mt-8'>
                <h3 className='text-xl font-semibold text-slate-900'>Amenities</h3>

                <div className='mt-4 grid gap-3 sm:grid-cols-2'>
                  {amenities.map((amenity, index) => (
                    <div
                      key={index}
                      className='rounded-3xl border border-slate-200 px-4 py-3 bg-slate-50 text-slate-700'
                    >
                      {amenity}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <aside className='space-y-8'>
            <div className='rounded-3xl bg-white p-8 shadow-lg border border-slate-200'>
              <p className='text-sm uppercase tracking-[0.2em] text-slate-500'>Price</p>
              <p className='mt-3 text-4xl font-semibold text-slate-900'>{property.price}</p>

              <p className='mt-4 text-slate-600'>
                This residence is available for professionals and families seeking elevated living in a premium location.
              </p>

              <div className='mt-8'>
                <h3 className='text-lg font-semibold text-slate-900'>Contact Agent</h3>

                <div className='mt-4 space-y-3 text-slate-700'>
                  <p>
                    <span className='font-semibold'>Name:</span> {agent.name}
                  </p>
                  <p>
                    <span className='font-semibold'>Phone:</span> {agent.phone}
                  </p>
                  <p>
                    <span className='font-semibold'>Email:</span> {agent.email}
                  </p>
                </div>

                <a
                  href={`https://wa.me/${agent.phone.replace(/\D/g, '')}?text=I%20am%20interested%20in%20${encodeURIComponent(property.title)}`}
                  target='_blank'
                  rel='noreferrer'
                  className='mt-8 inline-flex w-full items-center justify-center rounded-full bg-emerald-600 px-6 py-3 text-white font-semibold shadow-lg hover:bg-emerald-700 transition'
                >
                  Contact on WhatsApp
                </a>
              </div>
            </div>

            <div className='rounded-3xl bg-white p-8 shadow-lg border border-slate-200'>
              <h3 className='text-lg font-semibold text-slate-900'>Quick Facts</h3>

              <div className='mt-4 space-y-4 text-slate-700'>
                <div className='flex items-center justify-between border-b border-slate-200 pb-3'>
                  <span>Property Type</span>
                  <span className='font-semibold'>{property.type}</span>
                </div>

                <div className='flex items-center justify-between border-b border-slate-200 pb-3'>
                  <span>Location</span>
                  <span className='font-semibold'>{property.location}</span>
                </div>

                <div className='flex items-center justify-between'>
                  <span>Bathrooms</span>
                  <span className='font-semibold'>{property.baths}</span>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </div>
  )
}

export default PropertyDetailsPage
