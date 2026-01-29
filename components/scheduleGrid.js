// components/scheduleGrid.js
import * as api from '../api.supabase.js'
import {
  getMonday,
  addDays,
  formatDateISO,
  formatDateShort
} from './dateUtils.js'

const START_HOUR = 8
const END_HOUR = 18
const SLOT_MINUTES = 30
const TIME_SLOTS = buildTimeSlots() // ["08:00","08:30",...]

let teams = []
let bookings = []
let people = []
let products = []

let viewMode = 'day'
let currentDate = new Date()

// job search (filters jobs by customer name and sorts results by closest date to today)
let jobSearchQuery = ''
let pendingOpenBookingId = null


let scheduleGridContainer
let labelEl
let dayPickerEl
let bookingModal
let bookingForm
let resizeState = null

// drag state (mouse-based, no HTML5 DnD)
let dragState = null
const DRAG_THRESHOLD = 4 // pixels before we treat as a drag

let shouldScrollToToday = false

// --- shape guards / compatibility ---
// api.supabase.js already maps DB snake_case <-> JS camelCase.
// This keeps the UI resilient if anything upstream returns raw rows or legacy fields.
function normalizeBooking (b) {
  if (!b || typeof b !== 'object') return b

  const out = { ...b }

  // teamId
  if (out.teamId == null) {
    if (out.team_id != null) out.teamId = out.team_id
    else if (out.team != null && !Array.isArray(out.team) && typeof out.team !== 'object') out.teamId = out.team
  }

  // startTime / durationHours
  if (out.startTime == null && out.start_time != null) out.startTime = out.start_time
  if (out.durationHours == null && out.duration_hours != null) out.durationHours = out.duration_hours

  // customer fields
  if (out.customerName == null && out.customer_name != null) out.customerName = out.customer_name
  if (out.jobType == null && out.job_type != null) out.jobType = out.job_type
  if (out.clientPhone == null && out.client_phone != null) out.clientPhone = out.client_phone
  if (out.clientEmail == null && out.client_email != null) out.clientEmail = out.client_email
  if (out.orderNumbers == null && out.order_numbers != null) out.orderNumbers = out.order_numbers

  // crew: support either `crew` or legacy `team` array
  if (!Array.isArray(out.crew)) {
    if (Array.isArray(out.team)) out.crew = out.team
    else out.crew = []
  }

  // salespersonId (allocated salesperson for this job)
  // Support both DB snake_case and upstream camelCase.
  if (out.salespersonId == null && out.salesperson_id != null) {
    out.salespersonId = out.salesperson_id
  }

  // products: default empty array
  if (!Array.isArray(out.products)) out.products = []

  // Clean up raw snake_case props (optional, but keeps console logs tidy)
  delete out.team_id
  delete out.start_time
  delete out.duration_hours
  delete out.customer_name
  delete out.job_type
  delete out.client_phone
  delete out.client_email
  delete out.order_numbers
  // NOTE: we intentionally KEEP `salesperson_id` as well, because api.supabase.js
  // may still expect snake_case when writing to PostgREST.

  return out
}

export function initScheduleGrid () {
  scheduleGridContainer = document.getElementById('scheduleGridContainer')
  labelEl = document.getElementById('scheduleLabel')
  dayPickerEl = document.getElementById('dayDatePicker')

  bookingModal = new bootstrap.Modal(document.getElementById('bookingModal'))
  bookingForm =
    document.getElementById('booking-form') ||
    document.getElementById('bookingForm')

  setupToolbar()
  setupModalHandlers()
  setupJobSearch()

  window.addEventListener('teamsUpdated', refreshData)
  window.addEventListener('bookingsUpdated', refreshData)

  // global mouse listeners for drag
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)

  document.addEventListener('mousemove', onResizeMove)
  document.addEventListener('mouseup', onResizeEnd)

  window.addEventListener('peopleUpdated', refreshData)
  window.addEventListener('productsUpdated', refreshData)

  refreshData()
}

/* ---------------- data & label ---------------- */

async function refreshData () {
  try {
    // load teams
    teams = await api.getTeams()

    // optional: load people & products if those API functions exist
    if (typeof api.getPeople === 'function') {
      people = await api.getPeople()
    }
    if (typeof api.getProducts === 'function') {
      products = await api.getProducts()
    }

    // load bookings for the current week
    const weekStart = getMonday(currentDate)
    const rawBookings = await api.getBookingsForWeek(weekStart)
    bookings = (rawBookings || []).map(normalizeBooking)

    // debug: see what we actually got
    console.log(
      '[refreshData]',
      'currentDate =',
      currentDate.toISOString().slice(0, 10),
      'weekStart =',
      weekStart.toISOString().slice(0, 10),
      'bookings =',
      bookings
    )

    populateModalOptions()
    renderLabel()
    renderGrid()
    renderSearchResults()

    // If user clicked a search result, open that booking after the grid refresh
    if (pendingOpenBookingId) {
      const b = bookings.find(x => String(x.id) === String(pendingOpenBookingId))
      pendingOpenBookingId = null
      if (b) openModalForEdit(b)
    }
  } catch (err) {
    console.error('refreshData failed', err)
  }
}

function renderLabel () {
  if (viewMode === 'day') {
    labelEl.textContent = currentDate.toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    })
  } else {
    const weekStart = getMonday(currentDate)
    const weekEnd = addDays(weekStart, 4)
    labelEl.textContent = `Week of ${formatDateShort(
      weekStart
    )} – ${formatDateShort(weekEnd)}`
  }
  if (dayPickerEl) {
    if (viewMode === 'day') {
      dayPickerEl.disabled = false
      dayPickerEl.value = formatDateISO(currentDate)
    } else {
      dayPickerEl.disabled = true
    }
  }
}

/* ---------------- grid rendering ---------------- */
/* ---------------- job search ---------------- */

function setupJobSearch () {
  const input = document.getElementById('jobSearchInput')
  const clearBtn = document.getElementById('jobSearchClear')
  if (!input) return

  let t = null
  const apply = () => {
    jobSearchQuery = (input.value || '').trim()
    renderGrid()          // filter grid immediately (no DB fetch)
    renderSearchResults() // show results list
  }

  input.addEventListener('input', () => {
    if (t) window.clearTimeout(t)
    t = window.setTimeout(apply, 120)
  })

  if (clearBtn) {
    clearBtn.addEventListener('click', e => {
      e.preventDefault()
      input.value = ''
      jobSearchQuery = ''
      renderGrid()
      renderSearchResults()
      input.focus()
    })
  }
}

function matchesJobSearch (booking) {
  if (!jobSearchQuery) return true
  const q = jobSearchQuery.toLowerCase()
  const name = String(booking?.customerName || '').toLowerCase()
  return name.includes(q)
}

function isoToDateMs (iso) {
  // treat YYYY-MM-DD as local midnight
  if (!iso) return 0
  const d = new Date(String(iso) + 'T00:00:00')
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function bookingDistanceFromToday (booking) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const ms = isoToDateMs(booking?.date)
  return Math.abs(ms - today.getTime())
}

function renderSearchResults () {
  const container = document.getElementById('jobSearchResults')
  if (!container) return

  if (!jobSearchQuery) {
    container.innerHTML = ''
    return
  }

  const results = (bookings || [])
    .filter(b => matchesJobSearch(b))
    .sort((a, b) => {
      const da = bookingDistanceFromToday(a)
      const db = bookingDistanceFromToday(b)
      if (da !== db) return da - db

      const aMs = isoToDateMs(a.date)
      const bMs = isoToDateMs(b.date)
      if (aMs !== bMs) return aMs - bMs

      // tie-break by time
      return String(a.startTime || '').localeCompare(String(b.startTime || ''))
    })
    .slice(0, 30)

  if (!results.length) {
    container.innerHTML = '<div class="text-muted small">No matching jobs.</div>'
    return
  }

  container.innerHTML = `
    <div class="list-group list-group-flush">
      ${results
        .map(b => {
          const dateLabel = b.date || ''
          const timeLabel = b.startTime || ''
          const teamName = (teams || []).find(t => String(t.id) === String(b.teamId))?.name || ''
          const cust = (b.customerName || 'Job').trim() || 'Job'
          const sub = [teamName, timeLabel].filter(Boolean).join(' • ')
          return `
            <button
              type="button"
              class="list-group-item list-group-item-action py-2"
              data-action="jump-to-job"
              data-booking-id="${escapeHtml(String(b.id))}"
              title="Jump to this job"
            >
              <div class="d-flex justify-content-between">
                <div class="fw-semibold">${escapeHtml(cust)}</div>
                <div class="text-muted small">${escapeHtml(dateLabel)}</div>
              </div>
              <div class="text-muted small">${escapeHtml(sub)}</div>
            </button>
          `
        })
        .join('')}
    </div>
  `

  // delegated click
  container.onclick = e => {
    const btn = e.target.closest('[data-action="jump-to-job"]')
    if (!btn) return
    const id = btn.dataset.bookingId
    const booking = (bookings || []).find(x => String(x.id) === String(id))
    if (!booking) return

    // jump to the day that contains this booking, refresh data for that period
    pendingOpenBookingId = booking.id
    currentDate = new Date(String(booking.date) + 'T00:00:00')

    // Switching to day view makes "jump" obvious, and avoids confusion in week view.
    viewMode = 'day'
    document.getElementById('btnViewDay')?.classList.add('active')
    document.getElementById('btnViewWeek')?.classList.remove('active')

    refreshData()
  }
}

/* ---------------- end job search ---------------- */



function scrollToCurrentDayInWeek () {
  if (!scheduleGridContainer) return

  // Use whatever day we're currently viewing
  const currentIso = formatDateISO(currentDate)

  // Find that day's table
  const table = scheduleGridContainer.querySelector(
    `table.schedule-grid[data-day="${currentIso}"]`
  )
  if (!table) return

  const daySection = table.closest('.day-section') || table

  // Scroll that section to the top of the viewport
  daySection.scrollIntoView({ behavior: 'auto', block: 'start' })
}

function renderGrid () {
  if (!scheduleGridContainer) return
  scheduleGridContainer.innerHTML = ''

  const days = []
  if (viewMode === 'day') {
    const d = new Date(currentDate)
    days.push({
      date: d,
      iso: formatDateISO(d),
      label: d.toLocaleDateString(undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      })
    })
  } else {
    const weekStart = getMonday(currentDate)
    for (let i = 0; i < 6; i++) {
      const d = addDays(weekStart, i)
      days.push({
        date: d,
        iso: formatDateISO(d),
        label: d.toLocaleDateString(undefined, {
          weekday: 'long',
          day: 'numeric',
          month: 'short',
          year: 'numeric'
        })
      })
    }
  }

  let html = ''

  days.forEach(day => {
    const bookingsForDay = bookings.filter(b => b.date === day.iso).filter(matchesJobSearch)

    // grid[teamId][timeIdx] => null | {type:'booking'|'skip', booking, rowSpan}
    const grid = {}
    teams.forEach(t => {
      grid[t.id] = Array(TIME_SLOTS.length).fill(null)
    })

    bookingsForDay.forEach(b => {
      const teamId = b.teamId
      if (!grid[teamId]) return
      const startIndex = TIME_SLOTS.indexOf(b.startTime)
      if (startIndex === -1) return
      const span = Math.max(
        1,
        Math.round((toNumber(b.durationHours) || 0.5) * 2)
      )
      const endIndex = Math.min(TIME_SLOTS.length, startIndex + span)

      grid[teamId][startIndex] = {
        type: 'booking',
        booking: b,
        rowSpan: endIndex - startIndex
      }
      for (let i = startIndex + 1; i < endIndex; i++) {
        grid[teamId][i] = { type: 'skip' }
      }
    })

    html += `
      <div class="day-section mb-3">
        <div class="day-header">${day.label}</div>
        <div class="table-responsive">
          <table class="schedule-grid" data-day="${day.iso}">
            <thead>
              <tr>
                <th class="time-col">Time</th>
                ${teams
                  .map(
                    t =>
                      `<th class="text-center mechanic-col" data-team-id="${t.id}">${t.name}</th>`
                  )
                  .join('')}
              </tr>
            </thead>
            <tbody>
    `

    TIME_SLOTS.forEach(slotTime => {
      html += `
        <tr>
          <td class="time-cell">${slotTime}</td>
      `
      teams.forEach(team => {
        const cell = grid[team.id][TIME_SLOTS.indexOf(slotTime)]
        if (!cell) {
          html += `
            <td
              class="schedule-slot"
              data-date="${day.iso}"
              data-team-id="${team.id}"
              data-time="${slotTime}"
            ></td>
          `
        } else if (cell.type === 'booking') {
          const b = cell.booking
          const cssClass = jobTypeClass(b.jobType)

          const customerBits = [
            b.customerName && b.customerName.trim(),
            b.clientPhone && b.clientPhone.trim(),
            b.address && b.address.split('\n')[0].trim()
          ].filter(Boolean)

          const customerLabel = customerBits.length
            ? customerBits.join(' | ')
            : 'Booking'

          // summary/meta line
          const metaLine = buildBookingMetaLine(b)

          html += `
            <td
                class="schedule-slot"
                data-date="${day.iso}"
                data-team-id="${team.id}"
                data-time="${slotTime}"
                rowspan="${cell.rowSpan}"
            >
                <div
                class="booking-block ${cssClass}"
                data-booking-id="${b.id}"
                >
                <div class="booking-line-time">
                    ${slotTime}
                </div>
                <div class="booking-line-customer">
                    ${customerLabel}
                </div>
                ${
                    metaLine
                    ? `<div class="booking-line-meta">${metaLine}</div>`
                    : ''
                }
                <div class="booking-resize-handle"></div>
                </div>
            </td>
            `
        }
      })
      html += '</tr>'
    })

    html += `
            </tbody>
          </table>
        </div>
      </div>
    `
  })

  scheduleGridContainer.innerHTML = html
  attachGridHandlers()

  if (viewMode === 'week' && shouldScrollToToday) {
    shouldScrollToToday = false
    scrollToCurrentDayInWeek()
  }
}

function jobTypeLabel (jobType) {
  switch (jobType) {
    case 'measure':
      return 'Measure / Quote'
    case 'install':
      return 'Install'
    case 'service':
      return 'Service'
    case 'transit':
      return 'Transit / Travel'
    case 'other':
      return 'Other'
    default:
      return ''
  }
}

function onResizeMove (e) {
  if (!resizeState) return

  e.preventDefault()

  const { startY, originalSpan, slotHeight, booking, ghost, blockTop } = resizeState
  const dy = e.clientY - startY

  const deltaSlots = Math.round(dy / slotHeight)
  let newSpan = originalSpan + deltaSlots
  if (newSpan < 1) newSpan = 1

  const startIndex = TIME_SLOTS.indexOf(booking.startTime)
  if (startIndex === -1) return

  if (startIndex + newSpan > TIME_SLOTS.length) {
    newSpan = TIME_SLOTS.length - startIndex
  }

  resizeState.newSpan = newSpan

  // 🔹 VISUAL: update ghost height
  if (ghost) {
    const newHeight = newSpan * slotHeight
    ghost.style.height = `${newHeight}px`
    ghost.style.top = `${blockTop}px` // keep top anchored
  }
}

async function onResizeEnd () {
  if (!resizeState) return

  const { booking, newSpan, originalSpan, ghost } = resizeState
  resizeState = null

  if (ghost) ghost.remove()

  // remove "resizing" tint from all blocks just in case
  document
    .querySelectorAll('.booking-block.resizing')
    .forEach(b => b.classList.remove('resizing'))

  if (!newSpan || newSpan === originalSpan) return

  const newDurationHours = (newSpan * SLOT_MINUTES) / 60

  const updated = {
    ...booking,
    durationHours: newDurationHours
  }

  if (!fitsInDay(updated)) {
    alert('Outside working hours.')
    return
  }
  if (hasOverlap(updated, bookings)) {
    alert('New length would overlap another booking.')
    return
  }

  try {
    await api.updateBooking(updated)
    window.dispatchEvent(new CustomEvent('bookingsUpdated'))
  } catch (err) {
    console.error(err)
    alert('Unable to update booking duration.')
  }
}

/* ---------------- interactions (click + drag) ---------------- */

function attachGridHandlers () {
  if (!scheduleGridContainer) return

  // Delegated click handler:
  // - booking click (edit)
  // - empty slot click (new)
  scheduleGridContainer.onclick = e => {
    // if the resize handle was clicked, its own listener will handle it
    if (e.target.closest('.booking-resize-handle')) return

    const block = e.target.closest('.booking-block')
    if (block && !dragState) {
      const booking = findBookingByBlock(block)
      if (booking) openModalForEdit(booking)
      return
    }

    const slot = e.target.closest('.schedule-slot')
    if (slot && !dragState) {
      const { date, teamId, time } = slot.dataset
      openModalForNew(date, teamId, time)
    }
  }

  // Per-block mousedown to start DRAG-TO-MOVE (this is the bit you already have working)
  const blocks = scheduleGridContainer.querySelectorAll('.booking-block')
  blocks.forEach(block => {
    block.removeEventListener('mousedown', onBlockMouseDown) // avoid dupes
    block.addEventListener('mousedown', onBlockMouseDown)
  })

  const handles = scheduleGridContainer.querySelectorAll('.booking-resize-handle')
  handles.forEach(handle => {
    // click-to-step resize (already there)
    handle.onclick = async e => {
      e.stopPropagation()
      e.preventDefault()

      const block = handle.closest('.booking-block')
      if (!block) return

      const booking = findBookingByBlock(block)
      if (!booking) return

      const direction = e.shiftKey ? -1 : 1
      await handleResizeClick(booking, direction)
    }

    handle.onmousedown = e => {
      e.stopPropagation()
      e.preventDefault()

      const block = handle.closest('.booking-block')
      if (!block) return

      const booking = findBookingByBlock(block)
      if (!booking) return

      const td = block.closest('td')
      const rowSpan = Number(td.getAttribute('rowspan') || 1)
      const rect = td.getBoundingClientRect()
      const slotHeight = rect.height / rowSpan

      // account for scroll: rect is viewport, ghost is in document coords
      const scrollX = window.scrollX || window.pageXOffset
      const scrollY = window.scrollY || window.pageYOffset
      const docLeft = rect.left + scrollX
      const docTop = rect.top + scrollY

      // 🔹 create a ghost overlay
      const ghost = block.cloneNode(true)
      ghost.classList.add('booking-resize-ghost')
      ghost.style.position = 'absolute'
      ghost.style.left = `${docLeft}px`
      ghost.style.top = `${docTop}px`
      ghost.style.width = `${rect.width}px`
      ghost.style.height = `${rect.height}px`
      ghost.style.pointerEvents = 'none'

      document.body.appendChild(ghost)
      block.classList.add('resizing')

      resizeState = {
        booking,
        startY: e.clientY,
        originalSpan: rowSpan,
        slotHeight,
        newSpan: rowSpan,
        ghost,
        blockTop: docTop // 👈 store doc-space top
      }
    }
  })
}

function onBlockMouseDown (e) {
  // ignore if clicking on resize handle
  if (e.target.closest('.booking-resize-handle')) return

  const block = e.currentTarget
  const booking = findBookingByBlock(block)
  if (!booking) return

  e.preventDefault()

  const rect = block.getBoundingClientRect()

  dragState = {
    booking,
    block,
    startX: e.clientX,
    startY: e.clientY,
    ghost: null,
    didDrag: false,
    offsetX: e.clientX - rect.left,
    offsetY: e.clientY - rect.top
  }
}

/* ---- document-level drag move / end ---- */

function onDragMove (e) {
  if (!dragState) return

  const dx = e.clientX - dragState.startX
  const dy = e.clientY - dragState.startY

  if (!dragState.didDrag) {
    if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) {
      return
    }
    // start actual drag
    dragState.didDrag = true
    dragState.block.classList.add('dragging')

    const rect = dragState.block.getBoundingClientRect()
    const ghost = dragState.block.cloneNode(true)
    ghost.classList.add('booking-drag-ghost')
    ghost.style.width = `${rect.width}px`
    ghost.style.height = `${rect.height}px`
    document.body.appendChild(ghost)
    dragState.ghost = ghost
  }

  if (dragState.ghost) {
    dragState.ghost.style.left = `${e.clientX - dragState.offsetX}px`
    dragState.ghost.style.top = `${e.clientY - dragState.offsetY}px`
  }

  highlightDropTargets(e.clientX, e.clientY, dragState.booking)
}

async function onDragEnd (e) {
  if (!dragState) return

  const state = dragState
  dragState = null

  clearDropTargets()
  state.block.classList.remove('dragging')
  if (state.ghost) state.ghost.remove()

  if (!state.didDrag) {
    // treat as normal click; do nothing here (container onclick handles edit)
    return
  }

  // find drop slot under cursor
  const target = document.elementFromPoint(e.clientX, e.clientY)
  if (!target) return
  const slot = target.closest('.schedule-slot')
  if (!slot) return

  const updated = {
    ...state.booking,
    date: slot.dataset.date,
    teamId: slot.dataset.teamId,
    startTime: slot.dataset.time
  }

  if (!fitsInDay(updated)) {
    alert('Outside working hours.')
    return
  }
  if (hasOverlap(updated, bookings)) {
    alert('Overlaps with another booking for that team.')
    return
  }

  try {
    await api.updateBooking(updated)
    window.dispatchEvent(new CustomEvent('bookingsUpdated'))
  } catch (err) {
    console.error(err)
    alert('Could not move booking.')
  }
}

/* ---- drop target highlighting ---- */

function highlightDropTargets (x, y, booking) {
  clearDropTargets()
  const el = document.elementFromPoint(x, y)
  if (!el) return
  const slot = el.closest('.schedule-slot')
  if (!slot) return

  const targetSlot = scheduleGridContainer.querySelector(
    `.schedule-slot[data-date="${slot.dataset.date}"][data-team-id="${slot.dataset.teamId}"][data-time="${slot.dataset.time}"]`
  )
  if (targetSlot) targetSlot.classList.add('drop-target')
}

function clearDropTargets () {
  if (!scheduleGridContainer) return
  scheduleGridContainer
    .querySelectorAll('.schedule-slot.drop-target')
    .forEach(el => el.classList.remove('drop-target'))
}

/* ---------------- resize by click (handle) ---------------- */

async function handleResizeClick (booking, direction) {
  const deltaHours = 0.5 * direction
  const current = toNumber(booking.durationHours) || 0.5
  const next = Math.max(0.5, current + deltaHours)

  const updated = { ...booking, durationHours: next }

  if (!fitsInDay(updated)) {
    // would run past 18:00 — ignore
    return
  }
  if (hasOverlap(updated, bookings)) {
    alert('New length would overlap another booking.')
    return
  }

  try {
    await api.updateBooking(updated)
    window.dispatchEvent(new CustomEvent('bookingsUpdated'))
  } catch (err) {
    console.error(err)
    alert('Unable to change duration.')
  }
}

/* ---------------- toolbar / nav ---------------- */

function setupToolbar () {
  document
    .getElementById('btnViewDay')
    .addEventListener('click', () => {
      viewMode = 'day'
      document.getElementById('btnViewDay').classList.add('active')
      document.getElementById('btnViewWeek').classList.remove('active')
      refreshData()
    })

  document
    .getElementById('btnViewWeek')
    .addEventListener('click', () => {
      viewMode = 'week'
      document.getElementById('btnViewWeek').classList.add('active')
      document.getElementById('btnViewDay').classList.remove('active')
      shouldScrollToToday = true // 🔹 after render, scroll to today
      refreshData()
    })

  document
    .getElementById('btnPrevPeriod')
    .addEventListener('click', () => {
      currentDate = addDays(currentDate, viewMode === 'day' ? -1 : -7)
      refreshData()
    })

  document
    .getElementById('btnNextPeriod')
    .addEventListener('click', () => {
      currentDate = addDays(currentDate, viewMode === 'day' ? 1 : 7)
      refreshData()
    })

  document
    .getElementById('btnTodayPeriod')
    .addEventListener('click', () => {
      currentDate = new Date()
      if (viewMode === 'week') {
        shouldScrollToToday = true // only matters in week view
      }
      refreshData()
    })


  if (dayPickerEl) {
    dayPickerEl.addEventListener('change', () => {
      const v = (dayPickerEl.value || '').trim()
      if (!v) return

      // If user picks a day while in week view, jump to that day (day view).
      if (viewMode !== 'day') {
        viewMode = 'day'
        document.getElementById('btnViewDay')?.classList.add('active')
        document.getElementById('btnViewWeek')?.classList.remove('active')
      }

      // Create local date (avoid UTC shifting).
      currentDate = new Date(`${v}T00:00:00`)
      refreshData()
    })
  }

  const printBtn = document.getElementById('btnPrintDay')
  if (printBtn) {
    printBtn.addEventListener('click', handlePrintDay)
  }
}

function handlePrintDay () {
  const printArea = document.getElementById('printArea')
  if (!printArea) return

  const dayISO = formatDateISO(currentDate)
  const dayLabel = currentDate.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })

  // All bookings for this date
  const dayBookings = bookings
    .filter(b => b.date === dayISO)
    .sort((a, b) => (a.startTime > b.startTime ? 1 : -1))

  let html = `
    <div class="print-day-header">
      <h1>Job cards for ${escapeHtml(dayLabel)}</h1>
      <div class="small">
        Generated ${escapeHtml(new Date().toLocaleString())}
      </div>
    </div>
  `

  if (!dayBookings.length) {
    html += '<p>No bookings for this day.</p>'
  } else {
    teams.forEach(team => {
      const teamBookings = dayBookings.filter(b => b.teamId === team.id)
      if (!teamBookings.length) return

      // Crew for this team on this day = union of crew from all jobs
      const crewIdSet = new Set()
      teamBookings.forEach(b => {
        if (Array.isArray(b.crew)) {
          b.crew.forEach(id => crewIdSet.add(String(id)))
        }
      })
      const crewList = [...crewIdSet]
        .map(id => people.find(p => String(p.id) === String(id)))
        .filter(Boolean)
      const crewNames =
        crewList.length > 0
          ? crewList.map(p => p.name).join(', ')
          : 'No crew assigned yet'

      html += `
        <div class="print-team-page">
          <div class="print-team-header">
            <h2>${escapeHtml(team.name)} – ${escapeHtml(dayLabel)}</h2>
            <div class="small">
              Crew for the day: ${escapeHtml(crewNames)}
            </div>
          </div>
      `

      teamBookings.forEach((b, idx) => {
        const jobLabel = jobTypeLabel(b.jobType) || 'Job'

        // Salesperson for THIS job (separate from crew)
        const salespersonId = b.salesperson_id ?? b.salespersonId ?? null
        const salespersonName = salespersonId
          ? (people.find(p => String(p.id) === String(salespersonId)) || {}).name
          : ''
        const salespersonLabel = salespersonName || (salespersonId ? String(salespersonId) : '')

        // Crew for THIS job
        const jobCrewNames = Array.isArray(b.crew)
          ? b.crew
            .map(id => {
              const person = people.find(p => String(p.id) === String(id))
              return person ? person.name : ''
            })
            .filter(Boolean)
            .join(', ')
          : ''

        // Products for this job
        const productLines = Array.isArray(b.products)
          ? b.products
            .map(item => {
              const prod = products.find(
                p => String(p.id) === String(item.productId)
              )
              if (!prod) return ''
              const sub = prod.subType || prod.sub_type || ''
              const label = sub ? `${prod.name} – ${sub}` : prod.name
              const qty = item.quantity != null ? item.quantity : 1
              return `${qty}× ${label}`
            })
            .filter(Boolean)
            .join('; ')
          : ''

        html += `
          <div class="print-jobcard">
            <div class="print-jobcard-header">
              <span>${escapeHtml(jobLabel)} #${idx + 1}</span>
              <span>
                ${escapeHtml(b.startTime || '')}
                (${escapeHtml(String(b.durationHours ?? ''))} h)
              </span>
            </div>

            <div class="print-jobcard-row">
              <div class="print-jobcard-label">Customer</div>
              <div class="print-jobcard-value">
                ${escapeHtml(b.customerName || '')}
              </div>
            </div>

            <div class="print-jobcard-row">
              <div class="print-jobcard-label">Sales</div>
              <div class="print-jobcard-value">
                ${escapeHtml(salespersonLabel || '')}
              </div>
            </div>

            <div class="print-jobcard-row">
              <div class="print-jobcard-label">Phone</div>
              <div class="print-jobcard-value">
                ${escapeHtml(b.clientPhone || '')}
              </div>
            </div>

            <div class="print-jobcard-row">
              <div class="print-jobcard-label">Address</div>
              <div class="print-jobcard-value">
                ${escapeHtml((b.address || '').replace(/\n/g, ', '))}
              </div>
            </div>

            <div class="print-jobcard-row">
              <div class="print-jobcard-label">Order #</div>
              <div class="print-jobcard-value">
                ${escapeHtml(b.orderNumbers || '')}
              </div>
            </div>

            <div class="print-jobcard-row">
              <div class="print-jobcard-label">Products</div>
              <div class="print-jobcard-value">
                ${escapeHtml(productLines)}
              </div>
            </div>

            <div class="print-jobcard-row">
              <div class="print-jobcard-label">Crew</div>
              <div class="print-jobcard-value">
                ${escapeHtml(jobCrewNames || '')}
              </div>
            </div>

            <div class="print-jobcard-row">
              <div class="print-jobcard-label">Notes</div>
              <div class="print-jobcard-value">
                ${escapeHtml(b.notes || '')}
              </div>
            </div>
          </div>
        `
      })

      html += '</div>' // end .print-team-page
    })
  }

  printArea.innerHTML = html

  // Browser print dialog; choose "Save as PDF" for a file
  window.print()
}

/* ---------------- modal wiring ---------------- */

function populateModalOptions () {
  const teamSelect = document.getElementById('booking-team')
  if (teamSelect) {
    const prev = teamSelect.value
    teamSelect.innerHTML = ''
    teams.forEach(t => {
      const opt = document.createElement('option')
      opt.value = t.id
      opt.textContent = t.name
      teamSelect.appendChild(opt)
    })
    if (prev && teams.some(t => t.id === prev)) {
      teamSelect.value = prev
    }
  }

  const startSelect = document.getElementById('booking-start')
  if (startSelect) {
    const prev = startSelect.value
    startSelect.innerHTML = ''
    TIME_SLOTS.forEach(t => {
      const opt = document.createElement('option')
      opt.value = t
      opt.textContent = t
      startSelect.appendChild(opt)
    })
    if (prev && TIME_SLOTS.includes(prev)) {
      startSelect.value = prev
    }
  }

  // Salesperson (separate from crew; can overlap across teams)
  const salespersonSelect = document.getElementById('booking-salesperson')
  if (salespersonSelect) {
    const prev = salespersonSelect.value
    salespersonSelect.innerHTML = ''

    const salesPeople = (people || []).filter(
      p => String(p.role || '').toLowerCase() === 'sales'
    )

    const noneOpt = document.createElement('option')
    noneOpt.value = ''
    noneOpt.textContent = '— None —'
    salespersonSelect.appendChild(noneOpt)

    salesPeople.forEach(p => {
      const opt = document.createElement('option')
      opt.value = p.id
      opt.textContent = p.name
      salespersonSelect.appendChild(opt)
    })

    // preserve selection if still valid
    if (prev && salesPeople.some(p => String(p.id) === String(prev))) {
      salespersonSelect.value = prev
    } else {
      salespersonSelect.value = ''
    }
  }
}

function setupModalHandlers () {
  if (!bookingForm) return

  // Keep the Email/WhatsApp links in sync with whatever is typed into the modal
  const modalEl = document.getElementById('bookingModal')
  if (modalEl) {
    modalEl.addEventListener('shown.bs.modal', updateBookingContactLinks)
  }
  for (const id of ['booking-customer', 'booking-phone', 'booking-email', 'booking-date', 'booking-orderNumbers', 'booking-notes', 'booking-address']) {
    const el = document.getElementById(id)
    if (!el) continue
    el.addEventListener('input', updateBookingContactLinks)
    el.addEventListener('change', updateBookingContactLinks)
  }

  bookingForm.addEventListener('submit', async evt => {
    evt.preventDefault()

    const idInput = document.getElementById('booking-id')
    const dateInput = document.getElementById('booking-date')
    const teamSelect = document.getElementById('booking-team')
    const startSelect = document.getElementById('booking-start')
    const durationInput = document.getElementById('booking-duration')
    const customerInput = document.getElementById('booking-customer')
    const notesInput = document.getElementById('booking-notes')
    const jobTypeSelect = document.getElementById('booking-jobType')
    const addressInput = document.getElementById('booking-address')
    const phoneInput = document.getElementById('booking-phone')
    const emailInput = document.getElementById('booking-email')
    const orderInput = document.getElementById('booking-orderNumbers')
    const salespersonSelect = document.getElementById('booking-salesperson')
    const crewContainer = document.getElementById('booking-crew')
    const productsContainer = document.getElementById('booking-products')
    const errorEl = document.getElementById('booking-error')

    const rawDuration = durationInput.value.replace(',', '.')
    const durationHours = toNumber(rawDuration) || 1.5

    // crew (people ticked for this job)
    let crew = []
    if (crewContainer) {
      crew = Array.from(
        crewContainer.querySelectorAll('input[type="checkbox"]:checked')
      ).map(cb => cb.value)
    }

    // products (selected lines)
    const productsPayload = []
    if (productsContainer) {
      const rows = productsContainer.querySelectorAll('.booking-product-row')
      rows.forEach(row => {
        const select = row.querySelector('.booking-product-select')
        const qtyInput = row.querySelector('.booking-product-qty')
        if (!select) return
        const productId = select.value
        if (!productId) return
        const quantity = parseInt(qtyInput?.value || '1', 10) || 1
        productsPayload.push({ productId, quantity })
      })
    }

    const payload = {
      id: idInput.value || null,
      date: dateInput.value,
      teamId: teamSelect.value,
      startTime: startSelect.value,
      durationHours,
      customerName: customerInput.value.trim(),
      notes: notesInput.value.trim(),
      jobType: jobTypeSelect ? jobTypeSelect.value : 'other',
      address: addressInput ? addressInput.value.trim() : '',
      clientPhone: phoneInput ? phoneInput.value.trim() : '',
      clientEmail: emailInput ? emailInput.value.trim() : '',
      orderNumbers: orderInput ? orderInput.value.trim() : '',
      salesperson_id: salespersonSelect ? (salespersonSelect.value || null) : null,
      crew,
      products: productsPayload
    }

    try {
      if (payload.id) {
        await api.updateBooking(payload)
      } else {
        await api.createBooking(payload)
      }
      if (errorEl) errorEl.classList.add('d-none')
      bookingModal.hide()
      window.dispatchEvent(new CustomEvent('bookingsUpdated'))
    } catch (err) {
      console.error(err)
      if (errorEl) {
        errorEl.textContent = err.message || 'Unable to save booking.'
        errorEl.classList.remove('d-none')
      } else {
        alert('Unable to save booking.')
      }
    }
  })

  const deleteBtn = document.getElementById('btn-delete-booking')
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      const idInput = document.getElementById('booking-id')
      const id = idInput.value
      if (!id) return
      if (!confirm('Delete this booking?')) return
      try {
        await api.deleteBooking(id)
        bookingModal.hide()
        window.dispatchEvent(new CustomEvent('bookingsUpdated'))
      } catch (err) {
        console.error(err)
        alert('Unable to delete booking.')
      }
    })
  }
}

function openModalForNew (dateISO, teamId, startTime) {
  const idInput = document.getElementById('booking-id')
  const dateInput = document.getElementById('booking-date')
  const teamSelect = document.getElementById('booking-team')
  const startSelect = document.getElementById('booking-start')
  const durationInput = document.getElementById('booking-duration')
  const customerInput = document.getElementById('booking-customer')
  const notesInput = document.getElementById('booking-notes')
  const deleteBtn = document.getElementById('btn-delete-booking')
  const errorEl = document.getElementById('booking-error')
  const jobTypeSelect = document.getElementById('booking-jobType')
  const addressInput = document.getElementById('booking-address')
  const phoneInput = document.getElementById('booking-phone')
  const emailInput = document.getElementById('booking-email')
  const orderInput = document.getElementById('booking-orderNumbers')
  const salespersonSelect = document.getElementById('booking-salesperson')

  if (idInput) idInput.value = ''
  if (deleteBtn) deleteBtn.classList.add('d-none')
  if (errorEl) errorEl.classList.add('d-none')

  dateInput.value = dateISO
  teamSelect.value = teamId
  startSelect.value = startTime
  durationInput.value = '1.5'
  customerInput.value = ''
  notesInput.value = ''
  if (jobTypeSelect) jobTypeSelect.value = 'install'
  if (addressInput) addressInput.value = ''
  if (phoneInput) phoneInput.value = ''
  if (emailInput) emailInput.value = ''
  if (orderInput) orderInput.value = ''
  if (salespersonSelect) salespersonSelect.value = ''

  renderCrewAndProducts(null)

  document.getElementById('bookingModalLabel').textContent = 'New booking'
  updateBookingContactLinks()
  bookingModal.show()
}

function openModalForEdit (booking) {
  const idInput = document.getElementById('booking-id')
  const dateInput = document.getElementById('booking-date')
  const teamSelect = document.getElementById('booking-team')
  const startSelect = document.getElementById('booking-start')
  const durationInput = document.getElementById('booking-duration')
  const customerInput = document.getElementById('booking-customer')
  const notesInput = document.getElementById('booking-notes')
  const deleteBtn = document.getElementById('btn-delete-booking')
  const errorEl = document.getElementById('booking-error')
  const jobTypeSelect = document.getElementById('booking-jobType')
  const addressInput = document.getElementById('booking-address')
  const phoneInput = document.getElementById('booking-phone')
  const emailInput = document.getElementById('booking-email')
  const orderInput = document.getElementById('booking-orderNumbers')
  const salespersonSelect = document.getElementById('booking-salesperson')

  if (idInput) idInput.value = booking.id
  if (deleteBtn) deleteBtn.classList.remove('d-none')
  if (errorEl) errorEl.classList.add('d-none')

  dateInput.value = booking.date
  teamSelect.value = booking.teamId
  startSelect.value = booking.startTime
  durationInput.value = String(toNumber(booking.durationHours) || 1.5)
  customerInput.value = booking.customerName || ''
  notesInput.value = booking.notes || ''
  if (jobTypeSelect) jobTypeSelect.value = booking.jobType || 'other'
  if (addressInput) addressInput.value = booking.address || ''
  if (phoneInput) phoneInput.value = booking.clientPhone || ''
  if (emailInput) emailInput.value = booking.clientEmail || ''
  if (orderInput) orderInput.value = booking.orderNumbers || ''
  if (salespersonSelect) {
    const sp = booking.salesperson_id ?? booking.salespersonId
    salespersonSelect.value = sp != null ? String(sp) : ''
  }

  renderCrewAndProducts(booking)

  document.getElementById('bookingModalLabel').textContent = 'Edit booking'
  updateBookingContactLinks()
  bookingModal.show()
}

/* ---------------- contact actions (Email / WhatsApp) ---------------- */

function extractEmailFromText (...parts) {
  const text = parts.filter(Boolean).join(' ')
  const m = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
  return m ? m[0] : ''
}

function normalizeWhatsappNumber (raw) {
  if (!raw) return ''
  let digits = String(raw).replace(/\D/g, '')

  // handle 00CC... -> CC...
  if (digits.startsWith('00')) digits = digits.slice(2)

  // SA-friendly: 0XXXXXXXXX -> 27XXXXXXXXX
  if (digits.startsWith('0') && digits.length === 10) digits = '27' + digits.slice(1)

  // if they typed +27... it becomes 27..., which is correct for wa.me
  return digits
}

function setLinkEnabled (a, enabled, href) {
  if (!a) return
  if (enabled) {
    a.classList.remove('disabled')
    a.removeAttribute('aria-disabled')
    a.removeAttribute('tabindex')
    a.setAttribute('href', href || '#')
  } else {
    a.classList.add('disabled')
    a.setAttribute('aria-disabled', 'true')
    a.setAttribute('tabindex', '-1')
    a.setAttribute('href', '#')
  }
}

function updateBookingContactLinks () {
  const aWa = document.getElementById('booking-whatsapp-link')
  const aMail = document.getElementById('booking-email-link')
  const hint = document.getElementById('booking-contact-hint')

  const customer = document.getElementById('booking-customer')?.value?.trim() || ''
  const phoneRaw = document.getElementById('booking-phone')?.value?.trim() || ''
  const emailRaw = document.getElementById('booking-email')?.value?.trim() || ''
  const dateIso = document.getElementById('booking-date')?.value || ''
  const orderNumbers = document.getElementById('booking-orderNumbers')?.value?.trim() || ''
  const notes = document.getElementById('booking-notes')?.value?.trim() || ''
  const address = document.getElementById('booking-address')?.value?.trim() || ''

  const dateStr = dateIso ? formatDateShort(new Date(dateIso)) : 'your booking date'
  const subject = encodeURIComponent(`Booking: ${customer || 'Client'} (${dateStr})`)
  const body = encodeURIComponent(
    `Hi ${customer || ''}${customer ? ',' : ''}\n\n` +
    `Just following up on your booking scheduled for ${dateStr}.\n` +
    (orderNumbers ? `Order no(s): ${orderNumbers.replace(/\n+/g, ', ')}\n` : '') +
    (address ? `Address: ${address}\n` : '') +
    (notes ? `Notes: ${notes}\n` : '') +
    `\nThanks,\n`
  )

  const detectedEmail = extractEmailFromText(notes, address, orderNumbers)
  const email = emailRaw || detectedEmail
  const waNumber = normalizeWhatsappNumber(phoneRaw)

  // WhatsApp
  if (waNumber) {
    const msg = encodeURIComponent(
      `Hi ${customer || ''}${customer ? ',' : ''}\n` +
      `Just following up on your booking scheduled for ${dateStr}.` +
      (orderNumbers ? `\nOrder no(s): ${orderNumbers.replace(/\n+/g, ', ')}` : '')
    )
    setLinkEnabled(aWa, true, `https://wa.me/${waNumber}?text=${msg}`)
  } else {
    setLinkEnabled(aWa, false)
  }

  // Email
  if (email) {
    setLinkEnabled(aMail, true, `mailto:${email}?subject=${subject}&body=${body}`)
  } else {
    // If no email provided, still allow opening composer (no TO) so user can paste email
    setLinkEnabled(aMail, true, `mailto:?subject=${subject}&body=${body}`)
  }

  if (hint) {
    const bits = []
    if (phoneRaw) bits.push(`WhatsApp: ${waNumber ? waNumber : 'invalid number'}`)
    if (email) bits.push(`Email: ${email}`)
    if (!phoneRaw && !email) bits.push('Tip: add a mobile number and/or client email to enable one-click contact.')
    hint.textContent = bits.join(' • ')
  }
}

/* ---------------- helpers ---------------- */

function renderCrewAndProducts (booking) {
  renderCrewList(booking)
  renderProductLines(booking)
}

function renderCrewList (booking) {
  const container = document.getElementById('booking-crew')
  if (!container) return

  if (!people || !people.length) {
    container.innerHTML =
      '<div class="text-muted small">No people yet. Add them on the People tab.</div>'
    return
  }

  // Current date + team from booking or from the modal fields
  const dateInput = document.getElementById('booking-date')
  const teamSelect = document.getElementById('booking-team')

  const dateISO =
    (booking && booking.date) ||
    (dateInput && dateInput.value) ||
    null

  const teamId =
    (booking && booking.teamId) ||
    (teamSelect && teamSelect.value) ||
    null

  // People already booked on another team for this date
  const unavailableIds = new Set()

  if (dateISO && teamId) {
    bookings.forEach(b => {
      if (b.date !== dateISO) return
      if (b.teamId === teamId) return // same team is allowed
      if (!Array.isArray(b.crew)) return
      b.crew.forEach(pid => unavailableIds.add(String(pid)))
    })
  }

  // Which people are already selected for THIS booking
  const selectedIds = new Set(
    (booking && booking.crew ? booking.crew : []).map(String)
  )

  container.innerHTML = people
    .map(p => {
      const idStr = String(p.id)
      const checked = selectedIds.has(idStr) ? 'checked' : ''

      // Disable if booked on another team this day and not already selected here
      const isUnavailable =
        unavailableIds.has(idStr) && !selectedIds.has(idStr)
      const disabled = isUnavailable ? 'disabled' : ''

      const roleText = p.role
        ? ` <span class="text-muted small">(${escapeHtml(p.role)})</span>`
        : ''

      const unavailableNote = isUnavailable
        ? ' <span class="text-danger small ms-1">(Booked on another team today)</span>'
        : ''

      return `
        <div class="form-check form-check-sm">
          <input
            class="form-check-input"
            type="checkbox"
            value="${p.id}"
            id="crew-${p.id}"
            ${checked}
            ${disabled}
          />
          <label class="form-check-label" for="crew-${p.id}">
            ${escapeHtml(p.name)}${roleText}${unavailableNote}
          </label>
        </div>
      `
    })
    .join('')
}

function renderProductLines (booking) {
  const container = document.getElementById('booking-products')
  const addBtn = document.getElementById('booking-add-product')
  if (!container) return

  let rows = booking && booking.products && booking.products.length
    ? booking.products
    : []

  if (!rows.length) {
    rows = [{ productId: '', quantity: 1 }]
  }

  container.innerHTML = rows
    .map((row, idx) => buildProductRow(row, idx))
    .join('')

  // add line button
  if (addBtn && !addBtn._wired) {
    addBtn.addEventListener('click', () => {
      const idx = container.querySelectorAll('.booking-product-row').length
      const empty = { productId: '', quantity: 1 }
      container.insertAdjacentHTML('beforeend', buildProductRow(empty, idx))
    })
    addBtn._wired = true
  }

  // delete line (delegated)
  container.onclick = e => {
    const removeBtn = e.target.closest('.booking-product-remove')
    if (!removeBtn) return
    const rowEl = removeBtn.closest('.booking-product-row')
    if (!rowEl) return
    rowEl.remove()
  }
}

function buildProductRow (row, index) {
  const selectedId = row.productId || ''
  const qty = row.quantity != null ? row.quantity : 1

  const options =
    '<option value="">Select product…</option>' +
    (products || [])
      .map(p => {
        const label = p.subType
          ? `${p.name} – ${p.subType}`
          : p.name
        const selected = String(p.id) === String(selectedId) ? ' selected' : ''
        return `<option value="${p.id}"${selected}>${escapeHtml(label)}</option>`
      })
      .join('')

  return `
    <div class="d-flex align-items-center mb-1 booking-product-row" data-row-index="${index}">
      <select class="form-select form-select-sm booking-product-select">
        ${options}
      </select>
      <input
        type="number"
        min="1"
        step="1"
        class="form-control form-control-sm ms-1 booking-product-qty"
        value="${qty}"
      />
      <button
        type="button"
        class="btn btn-sm btn-outline-danger ms-1 booking-product-remove"
        aria-label="Remove product line"
      >
        &times;
      </button>
    </div>
  `
}

// tiny utility for safe text
function escapeHtml (str) {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildBookingMetaLine (b) {
  const bits = []

  // Job type label (Install, Measure, etc.)
  const jobLabel = jobTypeLabel(b.jobType)
  if (jobLabel) bits.push(jobLabel)

  // Salesperson name (if assigned)
  const salesperson = b.salesperson_id ?? b.salespersonId
  if (salesperson != null && people && people.length) {
    const sp = people.find(p => String(p.id) === String(salesperson))
    if (sp && sp.name) bits.push(`Sales: ${sp.name}`)
  }

  // Notes / address / order numbers – same priority as before
  const notesSummary = (b.notes || '').split('\n')[0].trim()
  const orderSummary = (b.orderNumbers || '').split('\n')[0].trim()

  if (notesSummary) {
    bits.push(notesSummary)
  } else if (orderSummary) {
    bits.push(orderSummary)
  }

  // Product summary – first product only, e.g. "2× Blind – Wood"
  if (Array.isArray(b.products) && b.products.length && products && products.length) {
    const first = b.products[0]
    const prod = products.find(p => String(p.id) === String(first.productId))
    if (prod) {
      const label = prod.subType
        ? `${prod.name} – ${prod.subType}`
        : prod.name
      const qty = first.quantity != null ? first.quantity : 1
      bits.push(`${qty}× ${label}`)
    }
  }

  // Crew count
  if (Array.isArray(b.crew) && b.crew.length) {
    bits.push(`${b.crew.length} crew`)
  }

  return bits.join(' – ')
}

function buildTimeSlots () {
  const slots = []
  for (let h = START_HOUR; h < END_HOUR; h++) {
    slots.push(`${String(h).padStart(2, '0')}:00`)
    slots.push(`${String(h).padStart(2, '0')}:30`)
  }
  return slots
}

function jobTypeClass (jobType) {
  switch (jobType) {
    case 'measure':
      return 'booking-service-pro'
    case 'install':
      return 'booking-service-major'
    case 'service':
      return 'booking-service-expert'
    case 'transit':
      return 'booking-service-transit'
    default:
      return 'booking-service-min'
  }
}

function findBookingByBlock (block) {
  const id = block.dataset.bookingId
  return bookings.find(b => String(b.id) === String(id))
}

function hasOverlap (booking, all) {
  const { teamId, date, startTime, durationHours } = booking
  if (!teamId || !date || !startTime || !durationHours) return false

  const [sh, sm] = startTime.split(':').map(Number)
  const startMinutes = sh * 60 + sm
  const endMinutes = startMinutes + toNumber(durationHours) * 60

  return all.some(b => {
    if (b.id === booking.id) return false
    if (b.teamId !== teamId || b.date !== date) return false
    if (!b.startTime || !b.durationHours) return false

    const [bh, bm] = b.startTime.split(':').map(Number)
    const bStart = bh * 60 + bm
    const bEnd = bStart + toNumber(b.durationHours) * 60

    return startMinutes < bEnd && endMinutes > bStart
  })
}

function fitsInDay (booking) {
  const { startTime, durationHours } = booking
  if (!startTime || !durationHours) return false
  const startIndex = TIME_SLOTS.indexOf(startTime)
  if (startIndex === -1) return false
  const span = Math.round(toNumber(durationHours) * 2)
  const endIndex = startIndex + span
  return endIndex <= TIME_SLOTS.length
}

function toNumber (val) {
  if (typeof val === 'number') return val
  if (!val) return NaN
  return parseFloat(String(val).replace(',', '.'))
}