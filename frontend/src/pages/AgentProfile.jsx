import { Link } from 'react-router-dom'
import AgentLayout, { AGENT_ROLE_LABEL } from '../components/AgentLayout'
import { useAuth } from '../contexts/AuthContext'


const AgentProfile = () => {
  const { user } = useAuth()

  return (
    <AgentLayout>
      <div className="max-w-2xl space-y-6">
        <div>
          <h1 style={{ fontFamily: 'Cinzel, serif' }} className="text-2xl font-bold text-[#202a36]">Profile</h1>
          <p className="mt-1 text-sm text-slate-500">How you appear to customers on the properties assigned to you.</p>
        </div>

        {/* Mirrors the "Listed by" block on the public property page. */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Public preview</p>

          <div className="flex items-center gap-4 rounded-xl bg-slate-50 p-4">
            {user?.avatar ? (
              <img src={user.avatar} alt="" className="h-14 w-14 shrink-0 rounded-full object-cover" />
            ) : (
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#202a36] text-lg font-bold text-white">
                {user?.name?.[0]?.toUpperCase() || 'A'}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Listed by</p>
              <p className="truncate font-semibold text-[#202a36]">{user?.name}</p>
              <p className="truncate text-sm text-slate-500">{AGENT_ROLE_LABEL}</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 style={{ fontFamily: 'Cinzel, serif' }} className="text-lg font-semibold text-[#202a36]">Your details</h2>

          <dl className="mt-4 space-y-4 text-sm">
            <div>
              <dt className="font-semibold text-slate-700">Name and profile photo</dt>
              <dd className="mt-0.5 text-slate-500">
                These appear on your assigned listings. Change them, along with your
                email address and password, in Settings.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-700">Contact details on a listing</dt>
              <dd className="mt-0.5 text-slate-500">
                The phone and WhatsApp number shown to customers are set per property by
                an administrator.
              </dd>
            </div>
          </dl>

          <Link
            to="/settings"
            className="mt-6 inline-block rounded-full bg-[#202a36] px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-[#4b6741]"
          >
            Open Settings
          </Link>
        </div>
      </div>
    </AgentLayout>
  )
}

export default AgentProfile
