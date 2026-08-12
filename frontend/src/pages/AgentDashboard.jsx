import { Link } from 'react-router-dom'
import AgentLayout from '../components/AgentLayout'
import AgentPropertyCard from '../components/AgentPropertyCard'
import { useAuth } from '../contexts/AuthContext'
import { useAgentProperties, summarise } from '../lib/useAgentProperties'

const StatCard = ({ label, value, color = '#202a36' }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
    <p className="text-xs uppercase tracking-widest text-slate-500">{label}</p>
    <p style={{ fontFamily: 'Cinzel, serif', color }} className="mt-3 text-4xl font-bold">{value}</p>
  </div>
)

/** How many assigned listings the "Recently Assigned" strip shows. */
const RECENT_LIMIT = 4

const AgentDashboard = () => {
  const { user } = useAuth()
  const { properties, status } = useAgentProperties()

  const stats = summarise(properties)
  // The API sorts newest first, so the head of the list is the recent slice.
  const recent = properties.slice(0, RECENT_LIMIT)
  const firstName = user?.name?.split(' ')[0] || ''

  return (
    <AgentLayout>
      <div className="space-y-8">
        <div>
          <h1 style={{ fontFamily: 'Cinzel, serif' }} className="text-2xl font-bold text-[#202a36]">Agent Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">
            {firstName ? `Welcome back, ${firstName}.` : 'Welcome back.'} Here is an overview of the listings assigned to you.
          </p>
        </div>

        {status === 'loading' && (
          <div className="flex justify-center py-16">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#4b6741] border-t-transparent" />
          </div>
        )}

        {status === 'error' && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6">
            <p className="font-semibold text-red-700">Could not load your properties</p>
            <p className="mt-1 text-sm text-red-600">
              Something went wrong reaching the server. Please refresh the page to try again.
            </p>
          </div>
        )}

        {status === 'success' && (
          <>
            <div className="grid gap-5 sm:grid-cols-3">
              <StatCard label="Assigned Properties" value={stats.total} />
              <StatCard label="For Sale" value={stats.sale} color="#4b6741" />
              <StatCard label="For Rent" value={stats.rent} color="#4b6741" />
            </div>

            {/*
              Only meaningful once something is assigned — a status breakdown
              of four zeroes tells a new agent nothing.
            */}
            {stats.total > 0 && (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 style={{ fontFamily: 'Cinzel, serif' }} className="mb-5 text-lg font-semibold text-[#202a36]">Property Status</h2>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  {stats.byStatus.map(({ status: label, count }) => (
                    <div key={label} className="rounded-xl bg-slate-50 px-4 py-3">
                      <p className="text-xs uppercase tracking-widest text-slate-500">{label}</p>
                      <p className="mt-1 text-2xl font-bold text-[#202a36]">{count}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {stats.total === 0 ? (
              <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white p-12 text-center">
                <p className="font-semibold text-slate-700">No properties assigned yet</p>
                <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
                  An administrator assigns listings to agent accounts. Once a property is
                  assigned to you it will appear here and under My Properties.
                </p>
              </div>
            ) : (
              <div>
                <div className="mb-4 flex items-center justify-between">
                  <h2 style={{ fontFamily: 'Cinzel, serif' }} className="text-lg font-semibold text-[#202a36]">Recently Assigned</h2>
                  {stats.total > RECENT_LIMIT && (
                    <Link to="/agent/properties" className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50">
                      View all {stats.total}
                    </Link>
                  )}
                </div>
                <div className="grid gap-4 xl:grid-cols-2">
                  {recent.map(property => (
                    <AgentPropertyCard key={property._id} property={property} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AgentLayout>
  )
}

export default AgentDashboard
