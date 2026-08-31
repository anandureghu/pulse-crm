export interface PackingSlipMoney {
  amount: string
  currencyCode: string
}

export interface PackingSlipAddress {
  name: string | null
  company: string | null
  address1: string | null
  address2: string | null
  city: string | null
  province: string | null
  zip: string | null
  country: string | null
  phone: string | null
}

export interface PackingSlipData {
  generated: boolean
  generatedAt: string
  shop: { name: string; domain: string }
  order: {
    id: string
    name: string
    createdAt: string
    cancelled: boolean
    financialStatus: string | null
    fulfillmentStatus: string | null
    note: string | null
    tags: string[]
    email: string | null
    phone: string | null
    customerName: string | null
    isCod: boolean
    totals: {
      subtotal: PackingSlipMoney | null
      shipping: PackingSlipMoney | null
      discounts: PackingSlipMoney | null
      total: PackingSlipMoney | null
    }
    shippingMethod: string | null
    shippingAddress: PackingSlipAddress | null
    billingAddress: PackingSlipAddress | null
    lineItems: Array<{
      name: string
      sku: string | null
      quantity: number
      variantTitle: string | null
      unitPrice: PackingSlipMoney | null
      lineTotal: PackingSlipMoney | null
    }>
    fulfillments: Array<{
      status: string | null
      createdAt: string | null
      tracking: Array<{ company: string | null; number: string | null; url: string | null }>
    }>
  }
}

function esc(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatMoney(m: PackingSlipMoney | null): string {
  if (!m) return '—'
  const n = Number(m.amount)
  const amount = Number.isFinite(n) ? n.toFixed(2) : m.amount
  if (m.currencyCode === 'INR') return `₹${amount}`
  return `${m.currencyCode} ${amount}`
}

function addressLines(a: PackingSlipAddress | null): string[] {
  if (!a) return []
  return [
    a.name,
    a.company,
    a.address1,
    a.address2,
    [a.city, a.province, a.zip].filter(Boolean).join(', ') || null,
    a.country,
    a.phone ? `Phone: ${a.phone}` : null,
  ].filter((x): x is string => Boolean(x?.trim()))
}

export function packingSlipHtml(data: PackingSlipData): string {
  const { shop, order } = data
  const ship = addressLines(order.shippingAddress)
  const rows = order.lineItems.map((li) => `
    <tr>
      <td>${esc(String(li.quantity))}</td>
      <td>
        <div>${esc(li.name)}</div>
        ${li.variantTitle ? `<div class="muted">${esc(li.variantTitle)}</div>` : ''}
      </td>
      <td>${esc(li.sku || '—')}</td>
      <td class="right">${esc(formatMoney(li.unitPrice))}</td>
      <td class="right">${esc(formatMoney(li.lineTotal))}</td>
    </tr>`).join('')

  const collect = order.isCod && !order.cancelled
  const tracking = order.fulfillments.flatMap((f) => f.tracking).filter((t) => t.number)

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Packing slip ${esc(order.name)}</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; color: #111; margin: 24px; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    h2 { font-size: 14px; margin: 0; letter-spacing: 0.08em; text-transform: uppercase; color: #555; }
    .row { display: flex; justify-content: space-between; gap: 24px; margin: 18px 0; }
    .muted { color: #666; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #e5e5e5; font-size: 13px; vertical-align: top; }
    th { color: #555; font-weight: 600; }
    .right { text-align: right; }
    .badge { display: inline-block; border: 1px solid #111; padding: 2px 8px; font-size: 11px; font-weight: 700; }
    .totals { margin-left: auto; width: 240px; }
    .totals div { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; }
    .collect { font-size: 16px; font-weight: 700; border-top: 2px solid #111; margin-top: 6px; padding-top: 8px; }
    @media print { body { margin: 12px; } .no-print { display: none !important; } }
  </style>
</head>
<body>
  <div class="row">
    <div>
      <h1>${esc(shop.name)}</h1>
      <h2>Packing slip</h2>
    </div>
    <div class="right">
      <div style="font-size:22px;font-weight:700">${esc(order.name)}</div>
      <div class="muted">${esc(new Date(order.createdAt).toLocaleString())}</div>
      ${order.cancelled ? '<div class="badge">CANCELLED</div>' : ''}
      ${collect ? '<div class="badge">COD</div>' : ''}
    </div>
  </div>
  <div class="row">
    <div>
      <div class="muted">Ship to</div>
      ${ship.length ? ship.map((l) => `<div>${esc(l)}</div>`).join('') : `<div>${esc(order.customerName || '—')}</div>`}
      ${order.phone && !ship.some((l) => l.includes(order.phone!)) ? `<div>Phone: ${esc(order.phone)}</div>` : ''}
    </div>
    <div>
      <div class="muted">Order</div>
      <div>Payment: ${esc(order.financialStatus || '—')}${collect ? ' (collect on delivery)' : ''}</div>
      <div>Fulfillment: ${esc(order.fulfillmentStatus || '—')}</div>
      ${order.shippingMethod ? `<div>Shipping: ${esc(order.shippingMethod)}</div>` : ''}
      ${order.email ? `<div>Email: ${esc(order.email)}</div>` : ''}
      ${order.tags.length ? `<div>Tags: ${esc(order.tags.join(', '))}</div>` : ''}
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Qty</th>
        <th>Item</th>
        <th>SKU</th>
        <th class="right">Price</th>
        <th class="right">Total</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    <div><span>Subtotal</span><span>${esc(formatMoney(order.totals.subtotal))}</span></div>
    <div><span>Shipping</span><span>${esc(formatMoney(order.totals.shipping))}</span></div>
    <div><span>Discount</span><span>${esc(formatMoney(order.totals.discounts))}</span></div>
    <div class="${collect ? 'collect' : ''}"><span>${collect ? 'Collect' : 'Total'}</span><span>${esc(formatMoney(order.totals.total))}</span></div>
  </div>
  ${order.note ? `<p><strong>Note:</strong> ${esc(order.note)}</p>` : ''}
  ${tracking.length ? `<p><strong>Tracking:</strong> ${esc(tracking.map((t) => [t.company, t.number].filter(Boolean).join(' ')).join(', '))}</p>` : ''}
  <p class="muted">Generated ${esc(new Date(data.generatedAt).toLocaleString())} from Shopify order data.</p>
</body>
</html>`
}

export function printPackingSlip(data: PackingSlipData) {
  const w = window.open('', '_blank', 'noopener,noreferrer,width=900,height=1100')
  if (!w) throw new Error('Pop-up blocked — allow pop-ups to print the packing slip')
  w.document.open()
  w.document.write(packingSlipHtml(data))
  w.document.close()
  w.focus()
  setTimeout(() => {
    try { w.print() } catch { /* closed */ }
  }, 300)
}
