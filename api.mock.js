// api.mock.js
// Simple in-memory data store to simulate backend / Supabase

const employees = [
  { id: 'emp-1', name: 'Alice – Senior Fitter', role: 'Fitter' },
  { id: 'emp-2', name: 'Ben – Installer', role: 'Installer' },
  { id: 'emp-3', name: 'Cara – Installer', role: 'Installer' },
  { id: 'emp-4', name: 'Dan – Driver', role: 'Driver' },
  { id: 'emp-5', name: 'Eve – Junior Fitter', role: 'Fitter' }
]

let teams = [
  {
    id: 'team-1',
    name: 'Install Team A',
    teamLeadId: 'emp-1',
    memberIds: ['emp-1', 'emp-2', 'emp-4']
  },
  {
    id: 'team-2',
    name: 'Install Team B',
    teamLeadId: 'emp-3',
    memberIds: ['emp-3', 'emp-5']
  },
  {
    id: 'team-3',
    name: 'Install Team C',
    teamLeadId: 'emp-3',
    memberIds: ['emp-3', 'emp-5']
  }
]

// NOTE: let (not const) so we can reassign in deleteTeam, etc.
let bookings = [
  // example booking
  {
    id: 'b-1',
    date: todayISO(),
    teamId: 'team-1',
    startTime: '09:00',
    durationHours: 2,
    customerName: 'Smith Residence',
    jobType: 'measure',
    notes: 'Measure and quote – lounge windows',
    address: '',
    clientPhone: '',
    orderNumbers: '',
    crew: [],
    products: []
  }
]

let people = [
  // starter data is optional
  { id: 'p1', name: 'Alice', role: 'fitter', phone: '082 111 2222' }
]
let nextPersonId = 1

let products = [
  { id: '0001', name: 'Blind', subType: 'Wood' }
]

// numeric counter
let nextProductId = 2 // corresponds to "0002"

/* ------------- helpers ------------- */

function todayISO () {
  return toLocalISO(new Date())
}

function clone (obj) {
  return JSON.parse(JSON.stringify(obj))
}

function generateId (prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`
}

function toLocalISO (date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/* -------- employees (readonly) ----- */

export async function getEmployees () {
  return clone(employees)
}

/* ---------- teams & members -------- */

export async function getTeams () {
  // Attach member objects for convenience
  const enriched = teams.map(t => ({
    id: t.id,
    name: t.name,
    teamLeadId: t.teamLeadId,
    members: t.memberIds
      .map(id => employees.find(e => e.id === id))
      .filter(Boolean)
  }))
  return clone(enriched)
}

export async function createTeam ({ name, teamLeadId, memberIds }) {
  const id = generateId('team')
  const cleanMemberIds = Array.from(new Set(memberIds || []))

  const lead = teamLeadId || null
  if (lead && !cleanMemberIds.includes(lead)) {
    cleanMemberIds.push(lead)
  }

  const team = {
    id,
    name,
    teamLeadId: lead,
    memberIds: cleanMemberIds
  }
  teams.push(team)
  return clone({
    id: team.id,
    name: team.name,
    teamLeadId: team.teamLeadId,
    members: team.memberIds
      .map(mid => employees.find(e => e.id === mid))
      .filter(Boolean)
  })
}

export async function updateTeam ({ id, name, teamLeadId, memberIds }) {
  const team = teams.find(t => t.id === id)
  if (!team) throw new Error('Team not found')

  team.name = name ?? team.name
  team.teamLeadId = teamLeadId ?? team.teamLeadId
  if (memberIds) {
    team.memberIds = Array.from(new Set(memberIds))
    // ensure team lead is a member if specified
    if (team.teamLeadId && !team.memberIds.includes(team.teamLeadId)) {
      team.memberIds.push(team.teamLeadId)
    }
  }
  return clone(team)
}

/* -------------- bookings ------------ */

export async function getBookingsForWeek (weekStart) {
  // weekStart is a Date (Monday)
  const start = new Date(weekStart)
  const end = new Date(weekStart)
  end.setDate(end.getDate() + 6)

  const startISO = toLocalISO(start)
  const endISO = toLocalISO(end)

  const result = bookings.filter(b => b.date >= startISO && b.date <= endISO)
  return clone(result)
}

export async function getBookingsForDay (dateObj) {
  const dayISO = dateObj.toISOString().slice(0, 10)
  return clone(bookings.filter(b => b.date === dayISO))
}

export async function createBooking (payload) {
  const id = generateId('b')

  const booking = {
    id,
    date: payload.date,
    teamId: payload.teamId,
    startTime: payload.startTime,
    durationHours: Number(payload.durationHours ?? 0),
    customerName: payload.customerName || '',
    jobType: payload.jobType || 'other',
    notes: payload.notes || '',
    address: payload.address || '',
    clientPhone: payload.clientPhone || '',
    orderNumbers: payload.orderNumbers || '',
    crew: Array.isArray(payload.crew) ? payload.crew.slice() : [],
    products: Array.isArray(payload.products)
      ? payload.products.map(p => ({
        productId: p.productId,
        quantity: Number(p.quantity ?? 1)
      }))
      : []
  }

  // Very naive overlap check: same team, same date, same start time
  if (
    bookings.some(
      b =>
        b.teamId === booking.teamId &&
        b.date === booking.date &&
        b.startTime === booking.startTime
    )
  ) {
    throw new Error('This team already has a booking at that time.')
  }

  bookings.push(booking)
  return clone(booking)
}

export async function updateBooking (payload) {
  const booking = bookings.find(b => b.id === payload.id)
  if (!booking) throw new Error('Booking not found')

  const newDate = payload.date ?? booking.date
  const newStart = payload.startTime ?? booking.startTime
  const newTeam = payload.teamId ?? booking.teamId

  // simple overlap check if date/start/team changes
  if (
    bookings.some(
      b =>
        b.id !== booking.id &&
        b.teamId === newTeam &&
        b.date === newDate &&
        b.startTime === newStart
    )
  ) {
    throw new Error('This team already has a booking at that time.')
  }

  booking.date = newDate
  booking.teamId = newTeam
  booking.startTime = newStart
  booking.jobType = payload.jobType ?? booking.jobType
  booking.durationHours = Number(payload.durationHours ?? booking.durationHours)
  booking.customerName = payload.customerName ?? booking.customerName
  booking.notes = payload.notes ?? booking.notes
  booking.address = payload.address ?? booking.address
  booking.clientPhone = payload.clientPhone ?? booking.clientPhone
  booking.orderNumbers = payload.orderNumbers ?? booking.orderNumbers

  if (payload.crew) {
    booking.crew = Array.isArray(payload.crew) ? payload.crew.slice() : []
  }

  if (payload.products) {
    booking.products = Array.isArray(payload.products)
      ? payload.products.map(p => ({
        productId: p.productId,
        quantity: Number(p.quantity ?? 1)
      }))
      : []
  }

  return clone(booking)
}

export async function deleteBooking (id) {
  const index = bookings.findIndex(b => b.id === id)
  if (index === -1) throw new Error('Booking not found')
  bookings.splice(index, 1)
  return { success: true }
}

export async function deleteTeam (teamId) {
  // Remove the team
  teams = teams.filter(t => t.id !== teamId)
  // Remove any bookings for that team
  bookings = bookings.filter(b => b.teamId !== teamId)
  return { success: true }
}

/* -------------- people -------------- */

export async function getPeople () {
  // pretend API latency
  return [...people]
}

export async function createPerson (payload) {
  const newPerson = {
    id: String(nextPersonId++),
    name: payload.name,
    role: payload.role || 'fitter',
    phone: payload.phone || ''
  }
  people.push(newPerson)
  return newPerson
}

export async function updatePerson (payload) {
  const idx = people.findIndex(p => String(p.id) === String(payload.id))
  if (idx === -1) {
    throw new Error('Person not found')
  }
  people[idx] = {
    ...people[idx],
    name: payload.name,
    role: payload.role || people[idx].role,
    phone: payload.phone || ''
  }
  return people[idx]
}

export async function deletePerson (id) {
  people = people.filter(p => String(p.id) !== String(id))
}

/* ------------- products ------------- */

export async function getProducts () {
  return [...products]
}

export async function createProduct (payload) {
  // convert numeric counter → zero-padded string
  const id = String(nextProductId).padStart(4, '0')

  const newProduct = {
    id,
    name: payload.name,
    subType: payload.subType || ''
  }

  products.push(newProduct)

  // increment for next time
  nextProductId++

  return newProduct
}

export async function updateProduct (payload) {
  const idx = products.findIndex(p => String(p.id) === String(payload.id))
  if (idx === -1) throw new Error('Product not found')

  products[idx] = {
    ...products[idx],
    name: payload.name,
    category: payload.category || '',
    subType: payload.subType || '',
    productId: payload.productId || ''
  }
  return products[idx]
}

export async function deleteProduct (id) {
  products = products.filter(p => String(p.id) !== String(id))
}
