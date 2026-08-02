import { useEffect, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { useEnquiries } from '../hooks/useEnquiries'
import { useCustomers } from '../hooks/useCustomers'
import { updateEnquiryStatusFn } from '../lib/functions'
import { toast } from '../components/Toast'
import type { Enquiry, EnquiryStatus } from '../types'

const STAGES: { key: EnquiryStatus; label: string; header: string }[] = [
  { key: 'new_lead',            label: 'New Lead',        header: 'bg-gray-100 text-gray-700' },
  { key: 'assigned',            label: 'Assigned',        header: 'bg-blue-100 text-blue-700' },
  { key: 'interested',          label: 'Interested',      header: 'bg-yellow-100 text-yellow-700' },
  { key: 'follow_up_required',  label: 'Follow-up',       header: 'bg-orange-100 text-orange-700' },
  { key: 'negotiation',         label: 'Negotiation',     header: 'bg-purple-100 text-purple-700' },
  { key: 'ready_to_buy',        label: 'Ready to Buy',    header: 'bg-teal-100 text-teal-700' },
  { key: 'sale_completed',      label: 'Completed',       header: 'bg-green-100 text-green-700' },
]

const LOST: EnquiryStatus[] = ['not_interested', 'lost', 'spam', 'duplicate']

export default function Pipeline() {
  const { enquiries, loading } = useEnquiries()
  const { customers } = useCustomers()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [optimisticStatuses, setOptimisticStatuses] = useState<Record<string, EnquiryStatus>>({})

  // Clear optimistic entries once real data catches up
  useEffect(() => {
    setOptimisticStatuses((prev) => {
      const next = { ...prev }
      for (const [id, status] of Object.entries(next)) {
        const e = enquiries.find((e) => e.id === id)
        if (e && e.status === status) delete next[id]
      }
      return next
    })
  }, [enquiries])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )

  const displayEnquiries = enquiries.map((e) =>
    optimisticStatuses[e.id] ? { ...e, status: optimisticStatuses[e.id] } : e
  )

  const active = displayEnquiries.find((e) => e.id === activeId) ?? null
  const activeEnquiries = displayEnquiries.filter((e) => !LOST.includes(e.status))

  const customerName = (customerId: string) =>
    customers.find((c) => c.id === customerId)?.name ?? '…'

  const onDragStart = ({ active }: DragStartEvent) => setActiveId(active.id as string)

  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    setActiveId(null)
    if (!over) return
    const enquiry = enquiries.find((e) => e.id === active.id)
    const newStatus = over.id as EnquiryStatus
    if (!enquiry || (optimisticStatuses[enquiry.id] ?? enquiry.status) === newStatus) return

    setOptimisticStatuses((prev) => ({ ...prev, [enquiry.id]: newStatus }))

    try {
      await updateEnquiryStatusFn({ enquiryId: enquiry.id, status: newStatus })
    } catch {
      setOptimisticStatuses((prev) => {
        const next = { ...prev }
        delete next[enquiry.id]
        return next
      })
      toast('Failed to move card — try again', 'error')
    }
  }

  if (loading) return <div className="p-6 text-sm text-gray-400">Loading…</div>

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-gray-800">Sales Pipeline</h2>
        <span className="text-sm text-gray-400">{activeEnquiries.length} active</span>
      </div>

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-4">
          {STAGES.map((stage) => (
            <StageColumn
              key={stage.key}
              stage={stage}
              enquiries={activeEnquiries.filter((e) => e.status === stage.key)}
              customerName={customerName}
              isDragging={!!activeId}
            />
          ))}
        </div>

        <DragOverlay>
          {active && (
            <EnquiryCard
              enquiry={active}
              customerName={customerName(active.customerId)}
              overlay
            />
          )}
        </DragOverlay>
      </DndContext>
    </div>
  )
}

function StageColumn({
  stage,
  enquiries,
  customerName,
  isDragging,
}: {
  stage: (typeof STAGES)[number]
  enquiries: Enquiry[]
  customerName: (id: string) => string
  isDragging: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.key })

  return (
    <div className="min-w-[200px] flex-shrink-0 flex flex-col">
      <div className={`rounded-lg px-3 py-2 ${stage.header} mb-2 flex items-center justify-between`}>
        <p className="text-sm font-medium truncate">{stage.label}</p>
        <span className="text-xs font-bold ml-1">{enquiries.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className={`flex-1 min-h-[120px] rounded-lg p-1.5 space-y-2 transition-colors ${
          isOver ? 'bg-green-50 ring-2 ring-green-300' : isDragging ? 'bg-gray-50' : ''
        }`}
      >
        {enquiries.map((e) => (
          <EnquiryCard key={e.id} enquiry={e} customerName={customerName(e.customerId)} />
        ))}
        {enquiries.length === 0 && !isDragging && (
          <div className="border-2 border-dashed border-gray-200 rounded-lg p-3 text-center text-xs text-gray-300">
            Drop here
          </div>
        )}
      </div>
    </div>
  )
}

function EnquiryCard({
  enquiry,
  customerName,
  overlay = false,
}: {
  enquiry: Enquiry
  customerName: string
  overlay?: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: enquiry.id })

  const style = overlay
    ? undefined
    : { transform: CSS.Translate.toString(transform) }

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      style={style}
      {...(overlay ? {} : { ...listeners, ...attributes })}
      className={`bg-white rounded-lg border border-gray-200 p-3 cursor-grab active:cursor-grabbing select-none transition-shadow ${
        isDragging ? 'opacity-40' : 'hover:shadow-md shadow-sm'
      } ${overlay ? 'rotate-1 shadow-lg' : ''}`}
    >
      <p className="font-medium text-sm text-gray-800 truncate">{customerName}</p>
      {enquiry.value > 0 && (
        <p className="text-xs text-gray-500 mt-0.5">₹{enquiry.value.toLocaleString('en-IN')}</p>
      )}
      <p className="text-xs text-gray-400 mt-0.5">{enquiry.assignedTo ?? 'Unassigned'}</p>
    </div>
  )
}
