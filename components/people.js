// components/people.js
import * as api from '../api.mock.js'

let people = []

export function initPeople () {
  setupHandlers()
  refreshPeople()
}

async function refreshPeople () {
  try {
    people = await api.getPeople()
  } catch (err) {
    console.error('Failed to load people', err)
    people = []
  }
  renderPeopleTable()
}

/* ------------ DOM wiring ------------ */

function setupHandlers () {
  const form = document.getElementById('people-form')
  const resetBtn = document.getElementById('btn-person-reset')
  const table = document.getElementById('people-table')

  if (form) {
    form.addEventListener('submit', onFormSubmit)
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', e => {
      e.preventDefault()
      clearForm()
    })
  }

  if (table) {
    table.addEventListener('click', onTableClick)
  }
}

/* ------------ Rendering ------------ */

function renderPeopleTable () {
  const tbody = document.querySelector('#people-table tbody')
  if (!tbody) return

  if (!people.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="text-muted small text-center py-3">
          No people yet. Add your first fitter, sales person, or admin on the left.
        </td>
      </tr>
    `
    return
  }

  tbody.innerHTML = people
    .map(p => {
      const roleLabel = roleDisplay(p.role)
      const phone = p.phone || ''
      return `
        <tr data-person-id="${p.id}">
          <td>${escapeHtml(p.name)}</td>
          <td>
            <span class="badge bg-light border text-muted people-role-badge">
              ${roleLabel}
            </span>
          </td>
          <td>${escapeHtml(phone)}</td>
          <td class="text-end">
            <button
              type="button"
              class="btn btn-sm btn-outline-danger"
              data-action="delete-person"
            >
              &#128465;
            </button>
          </td>
        </tr>
      `
    })
    .join('')
}

/* ------------ Form handlers ------------ */

async function onFormSubmit (e) {
  e.preventDefault()
  const idInput = document.getElementById('person-id')
  const nameInput = document.getElementById('person-name')
  const roleSelect = document.getElementById('person-role')
  const phoneInput = document.getElementById('person-phone')

  const id = idInput.value || null
  const name = nameInput.value.trim()
  const role = roleSelect.value
  const phone = phoneInput.value.trim()

  if (!name) {
    nameInput.focus()
    return
  }

  const payload = { id, name, role, phone }

  try {
    if (id) {
      await api.updatePerson(payload)
    } else {
      await api.createPerson(payload)
    }
    clearForm()
    await refreshPeople()
  } catch (err) {
    console.error('Failed to save person', err)
    alert('Unable to save person.')
  }
}

function onTableClick (e) {
  const deleteBtn = e.target.closest('[data-action="delete-person"]')
  const row = e.target.closest('tr[data-person-id]')
  if (!row) return

  const id = row.dataset.personId
  const person = people.find(p => String(p.id) === String(id))
  if (!person) return

  if (deleteBtn) {
    handleDeletePerson(person)
  } else {
    // click row -> load into form
    fillForm(person)
  }
}

async function handleDeletePerson (person) {
  if (!confirm(`Delete ${person.name}?`)) return
  try {
    await api.deletePerson(person.id)
    await refreshPeople()
    // if the deleted person was being edited, clear form
    const idInput = document.getElementById('person-id')
    if (idInput && idInput.value === String(person.id)) {
      clearForm()
    }
  } catch (err) {
    console.error('Failed to delete person', err)
    alert('Unable to delete person.')
  }
}

/* ------------ Form helpers ------------ */

function fillForm (person) {
  const idInput = document.getElementById('person-id')
  const nameInput = document.getElementById('person-name')
  const roleSelect = document.getElementById('person-role')
  const phoneInput = document.getElementById('person-phone')

  if (!idInput) return

  idInput.value = person.id
  nameInput.value = person.name || ''
  roleSelect.value = person.role || 'fitter'
  phoneInput.value = person.phone || ''
}

function clearForm () {
  const idInput = document.getElementById('person-id')
  const nameInput = document.getElementById('person-name')
  const roleSelect = document.getElementById('person-role')
  const phoneInput = document.getElementById('person-phone')

  if (!idInput) return

  idInput.value = ''
  nameInput.value = ''
  roleSelect.value = 'fitter'
  phoneInput.value = ''
}

/* ------------ Small utils ------------ */

function roleDisplay (role) {
  switch (role) {
    case 'fitter':
      return 'Fitter'
    case 'sales':
      return 'Sales'
    case 'admin':
      return 'Admin'
    default:
      return 'Other'
  }
}

function escapeHtml (str) {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
