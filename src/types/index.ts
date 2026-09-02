export type EnquiryStatus =
  | 'new_lead'
  | 'assigned'
  | 'contact_attempted'
  | 'interested'
  | 'confused'
  | 'follow_up_required'
  | 'negotiation'
  | 'ready_to_buy'
  | 'payment_pending'
  | 'sale_completed'
  | 'after_sales'
  | 'repeat_customer'
  | 'not_interested'
  | 'lost'
  | 'spam'
  | 'duplicate'

export interface Customer {
  id: string
  phone: string
  name: string
  assignedTo: string | null
  tags: string[]
  aiAutoreply: boolean
  email?: string | null
  shopifyCustomerId?: string | null
  createdAt: string
  updatedAt: string
}

export interface Enquiry {
  id: string
  customerId: string
  status: EnquiryStatus
  stage: string
  assignedTo: string | null
  value: number
  createdAt: string
}

export interface Conversation {
  id: string
  customerId: string
  lastMessage: string
  unreadCount: number
  updatedAt: string
}

export interface Message {
  id: string
  conversationId: string
  sender: 'customer' | 'agent'
  type: 'text' | 'image' | 'audio' | 'video' | 'document'
  text: string
  media?: string
  status: 'sent' | 'delivered' | 'read'
  timestamp: string
  starred?: boolean
}

export interface Note {
  id: string
  enquiryId: string
  author: string
  content: string
  createdAt: string
}

export interface Activity {
  id: string
  enquiryId: string
  type: string
  description: string
  createdBy: string
  createdAt: string
}

export interface Followup {
  id: string
  enquiryId: string
  dueDate: string
  completed: boolean
  completedAt?: string | null
  note: string
  assignedTo: string
  createdAt?: string
}

export interface EnrichedFollowup extends Followup {
  customerId: string | null
  customerName: string
  customerPhone: string | null
}
