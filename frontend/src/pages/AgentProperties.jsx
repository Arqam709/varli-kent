import AgentLayout from '../components/AgentLayout'
import AgentPropertyCard from '../components/AgentPropertyCard'
import { useAgentProperties } from '../lib/useAgentProperties'


const AgentProperties = () => {
  const { properties, status } = useAgentProperties()

  return (
    <AgentLayout>
      <div className="space-y-6">
        <div>
          <h1 style={{ fontFamily: 'Cinzel, serif' }} className="text-2xl font-bold text-[#202a36]">My Properties</h1>
          <p className="mt-1 text-sm text-slate-500">
            {status === 'success'
              ? `${properties.length} ${properties.length === 1 ? 'listing' : 'listings'} assigned to you`
              : 'Listings assigned to you'}
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
          properties.length === 0 ? (
            // An empty portfolio is a normal state for a newly promoted agent,
            // so this explains rather than looking like a failed request.
            <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white p-12 text-center">
              <p className="font-semibold text-slate-700">No properties assigned yet</p>
              <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
                An administrator assigns listings to agent accounts. Once a property is
                assigned to you it will appear here.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {properties.map(property => (
                <AgentPropertyCard key={property._id} property={property} />
              ))}
            </div>
          )
        )}
      </div>
    </AgentLayout>
  )
}

export default AgentProperties
