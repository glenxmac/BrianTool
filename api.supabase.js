// api.supabase.js
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// 1) Put these in a small config file if you want, but they are NOT secrets.
const SUPABASE_URL = 'https://pfjysbwyppfqfnbxycrl.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_AckELx1SL_QWcAbnSBDT7w_jsVCauQp'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// --- helpers ---
function unwrap (res) {
  if (res.error) throw res.error
  return res.data
}

function toLocalISO (date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Map your JS shape <-> DB shape.
// Assumes your DB columns are snake_case (recommended).
function bookingToRow (b) {
  return {
    id: b.id,
    date: b.date,
    team_id: b.teamId,
    start_time: b.startTime,
    duration_hours: b.durationHours,
    customer_name: b.customerName,
    job_type: b.jobType,
    notes: b.notes,
    address: b.address,
    client_phone: b.clientPhone,
    order_numbers: b.orderNumbers,
    crew: b.crew ?? [],
    products: b.products ?? [],
    salesperson_id: b.salesperson_id ?? null
  }
}


function rowToBooking (r) {
  // Strip seconds from time if present (e.g., "08:30:00" -> "08:30")
  let startTime = r.start_time
  if (startTime && startTime.length > 5) {
    startTime = startTime.substring(0, 5)
  }

  return {
    id: r.id,
    date: r.date,
    teamId: r.team_id,
    startTime: startTime,
    durationHours: r.duration_hours,
    customerName: r.customer_name,
    jobType: r.job_type,
    notes: r.notes,
    address: r.address,
    clientPhone: r.client_phone,
    orderNumbers: r.order_numbers,
    crew: r.crew ?? [],
    products: r.products ?? [],
    salesperson_id: r.salesperson_id ?? null
  }
}

// -------------------- AUTH --------------------

export async function signInWithPassword (email, password) {
  const res = await supabase.auth.signInWithPassword({ email, password })
  return unwrap(res)
}

export async function signOut () {
  const res = await supabase.auth.signOut()
  return unwrap(res)
}

export async function getSession () {
  const res = await supabase.auth.getSession()
  return unwrap(res).session
}

// -------------------- employees --------------------
// (Only if you actually use employees directly; otherwise ignore.)
export async function getEmployees () {
  const res = await supabase.from('employees').select('*').order('name')
  return unwrap(res)
}

// -------------------- teams --------------------

export async function getTeams () {
  const res = await supabase.from('teams').select('*').order('name')
  return unwrap(res)
}

export async function createTeam (payload) {
  const res = await supabase.from('teams').insert([payload]).select('*').single()
  return unwrap(res)
}

export async function updateTeam (id, patch) {
  const res = await supabase.from('teams').update(patch).eq('id', id).select('*').single()
  return unwrap(res)
}

export async function deleteTeam (id) {
  const res = await supabase.from('teams').delete().eq('id', id)
  return unwrap(res)
}

// -------------------- bookings --------------------

export async function getBookingsForDay (isoDate) {
  const res = await supabase
    .from('bookings')
    .select('*')
    .eq('date', isoDate)

  return unwrap(res).map(rowToBooking)
}

// Supports BOTH call styles:
// - getBookingsForWeek(weekStartDate)  (what your scheduleGrid.js calls)
// - getBookingsForWeek('YYYY-MM-DD', 'YYYY-MM-DD')
export async function getBookingsForWeek (start, end) {
  let startIsoDate
  let endIsoDate

  if (start instanceof Date) {
    const s = new Date(start)
    const e = new Date(start)
    e.setDate(e.getDate() + 6)
    startIsoDate = toLocalISO(s)
    endIsoDate = toLocalISO(e)
  } else {
    startIsoDate = start
    endIsoDate = end
  }

  // endIsoDate is inclusive (UI expects inclusive)
  const res = await supabase
    .from('bookings')
    .select('*')
    .gte('date', startIsoDate)
    .lte('date', endIsoDate)

  return unwrap(res).map(rowToBooking)
}

export async function createBooking (payload) {
  const row = bookingToRow(payload)
  delete row.id // let DB generate if uuid default is set
  const res = await supabase.from('bookings').insert([row]).select('*').single()
  return rowToBooking(unwrap(res))
}

// Supports BOTH call styles:
// - updateBooking(fullBookingObject)   (what your scheduleGrid.js calls)
// - updateBooking(id, patch)
export async function updateBooking (idOrPayload, patch) {
  let id
  let data

  if (typeof idOrPayload === 'object' && idOrPayload) {
    id = idOrPayload.id
    data = { ...idOrPayload }
    delete data.id
  } else {
    id = idOrPayload
    data = patch || {}
  }

  if (!id) throw new Error('updateBooking requires an id')

  const row = bookingToRow({ id, ...data })
  delete row.id
  const res = await supabase.from('bookings').update(row).eq('id', id).select('*').single()
  return rowToBooking(unwrap(res))
}

export async function deleteBooking (id) {
  const res = await supabase.from('bookings').delete().eq('id', id)
  return unwrap(res)
}

// -------------------- people --------------------

export async function getPeople () {
  const res = await supabase.from('people').select('*').order('name')
  return unwrap(res)
}

export async function createPerson (payload) {
  const res = await supabase.from('people').insert([payload]).select('*').single()
  return unwrap(res)
}

// Supports BOTH call styles:
// - updatePerson({id, ...fields})   (what your people.js calls)
// - updatePerson(id, patch)
export async function updatePerson (idOrPayload, patch) {
  let id
  let data
  if (typeof idOrPayload === 'object' && idOrPayload) {
    id = idOrPayload.id
    data = { ...idOrPayload }
    delete data.id
  } else {
    id = idOrPayload
    data = patch || {}
  }
  if (!id) throw new Error('updatePerson requires an id')
  const res = await supabase.from('people').update(data).eq('id', id).select('*').single()
  return unwrap(res)
}

export async function deletePerson (id) {
  const res = await supabase.from('people').delete().eq('id', id)
  return unwrap(res)
}

// -------------------- products --------------------

export async function getProducts () {
  const res = await supabase.from('products').select('*').order('name')
  return unwrap(res)
}

export async function createProduct (payload) {
  const res = await supabase.from('products').insert([payload]).select('*').single()
  return unwrap(res)
}

// Supports BOTH call styles:
// - updateProduct({id, ...fields})   (what your products.js calls)
// - updateProduct(id, patch)
export async function updateProduct (idOrPayload, patch) {
  let id
  let data
  if (typeof idOrPayload === 'object' && idOrPayload) {
    id = idOrPayload.id
    data = { ...idOrPayload }
    delete data.id
  } else {
    id = idOrPayload
    data = patch || {}
  }
  if (!id) throw new Error('updateProduct requires an id')
  const res = await supabase.from('products').update(data).eq('id', id).select('*').single()
  return unwrap(res)
}

export async function deleteProduct (id) {
  const res = await supabase.from('products').delete().eq('id', id)
  return unwrap(res)
}