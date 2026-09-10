import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { toast } from '../components/Toast'
import PlatformEvolutionSettings from '../components/PlatformEvolutionSettings'
import {
  useAdminOrganizations,
  useCreateOrganization,
  useSetOrganizationActive,
} from '../hooks/useAdminOrganizations'
import type { AdminOrgRow } from '../lib/manageOrg'

type AdminTab = 'integration' | 'organizations'

export default function Admin() {
  const isPlatformAdmin = useAuthStore((s) => s.isPlatformAdmin)
  const { data: orgs = [], isLoading: loading } = useAdminOrganizations()
  const createOrg = useCreateOrganization()
  const setOrgActive = useSetOrganizationActive()

  const [expanded, setExpanded] = useState<string | null>(null)
  const [tab, setTab] = useState<AdminTab>('integration')
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [adminEmail, setAdminEmail] = useState('')

  if (!isPlatformAdmin) return <Navigate to="/" replace />

  const handleCreate = async () => {
    if (!name.trim() || !adminEmail.trim()) {
      toast('Name and admin email required', 'error')
      return
    }
    try {
      await createOrg.mutateAsync({
        name: name.trim(),
        slug: slug.trim() || undefined,
        adminEmail: adminEmail.trim(),
      })
      toast('Organization created', 'success')
      setShowCreate(false)
      setName('')
      setSlug('')
      setAdminEmail('')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const toggleActive = async (org: AdminOrgRow) => {
    try {
      await setOrgActive.mutateAsync({ organizationId: org.id, active: !org.active })
      toast(org.active ? 'Organization disabled' : 'Organization enabled', 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto w-full">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-800">Platform Admin</h2>
        <p className="text-sm text-gray-500 mt-0.5">Global integration settings and organization management</p>
      </div>

      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {([
          ['integration', 'Platform integration'],
          ['organizations', 'Organizations'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === id
                ? 'border-green-600 text-green-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'integration' && <PlatformEvolutionSettings />}

      {tab === 'organizations' && (
        <>
      <div className="flex items-center justify-between gap-3 mb-6">
        <div>
          <h3 className="text-base font-semibold text-gray-800">Organizations</h3>
          <p className="text-sm text-gray-500 mt-0.5">Create and manage tenant organizations</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-green-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-green-700"
        >
          + Create organization
        </button>
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 space-y-3">
            <h3 className="text-base font-semibold text-gray-800">New organization</h3>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="Acme Corp"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Slug (optional)</label>
              <input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="acme"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">First org admin email</label>
              <input
                type="email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="admin@acme.com"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setShowCreate(false)}
                className="flex-1 border border-gray-300 rounded-lg py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={createOrg.isPending}
                className="flex-1 bg-green-600 text-white rounded-lg py-2 text-sm disabled:opacity-50"
              >
                {createOrg.isPending ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <p className="p-6 text-sm text-gray-400">Loading…</p>
        ) : orgs.length === 0 ? (
          <p className="p-6 text-sm text-gray-400">No organizations yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {orgs.map((org) => (
              <li key={org.id} className="p-4">
                <div className="flex flex-wrap items-center gap-3 justify-between">
                  <button
                    type="button"
                    className="text-left min-w-0"
                    onClick={() => setExpanded(expanded === org.id ? null : org.id)}
                  >
                    <p className="font-medium text-gray-800">
                      {org.name}{' '}
                      <span className="text-xs text-gray-400 font-normal">/{org.slug}</span>
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {org.memberCount} members · {org.instanceCount} instances ·{' '}
                      {org.active ? (
                        <span className="text-green-600">active</span>
                      ) : (
                        <span className="text-amber-600">disabled</span>
                      )}
                    </p>
                  </button>
                  <button
                    onClick={() => toggleActive(org)}
                    disabled={setOrgActive.isPending}
                    className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {org.active ? 'Disable' : 'Enable'}
                  </button>
                </div>
                {expanded === org.id && (
                  <div className="mt-3 pl-2 border-l-2 border-gray-100">
                    <p className="text-xs font-medium text-gray-500 mb-1">Instances</p>
                    {org.instances.length === 0 ? (
                      <p className="text-xs text-gray-400">None</p>
                    ) : (
                      <ul className="space-y-1">
                        {org.instances.map((inst) => (
                          <li key={inst.id} className="text-sm text-gray-700">
                            {inst.name}
                            {inst.evolution_instance_name && (
                              <span className="text-xs text-gray-400 ml-2">
                                evo: {inst.evolution_instance_name}
                              </span>
                            )}
                            {!inst.active && (
                              <span className="text-xs text-amber-600 ml-2">inactive</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
        </>
      )}
    </div>
  )
}
