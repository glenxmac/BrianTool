// components/teams.js
import * as api from '../api.mock.js'

let employees = []
let teams = []

export function initTeams () {
  setupEventHandlers()
  refreshTeamsData()
}

async function refreshTeamsData () {
  employees = await api.getEmployees()
  teams = await api.getTeams()

  renderTeamSelect()
  renderTeamForm()
  renderTeamLists()
}

/* -------------------- wiring --------------------- */

function setupEventHandlers () {
  document.getElementById('btn-new-team').addEventListener('click', () => {
    document.getElementById('team-select').value = ''
    document.getElementById('team-name-input').value = ''
    document.getElementById('team-lead-select').innerHTML = ''
    renderTeamLists()
    renderTeamForm() // make sure lead dropdown uses current members list (empty initially)
  })

  document.getElementById('team-select').addEventListener('change', () => {
    renderTeamForm()
    renderTeamLists()
  })

  document.getElementById('btn-save-team').addEventListener('click', async () => {
    const select = document.getElementById('team-select')
    const nameInput = document.getElementById('team-name-input')
    const leadSelect = document.getElementById('team-lead-select')

    const name = nameInput.value.trim()
    const leadId = leadSelect.value || null

    if (!name) {
      alert('Team name is required.')
      return
    }

    const selectedId = select.value || null
    const memberIds = getCurrentTeamMembers()

    if (!memberIds.length) {
      if (!confirm('This team has no members. Save anyway?')) return
    }

    if (selectedId) {
      await api.updateTeam({
        id: selectedId,
        name,
        teamLeadId: leadId,
        memberIds
      })
    } else {
      const newTeam = await api.createTeam({
        name,
        teamLeadId: leadId,
        memberIds
      })
      document.getElementById('team-select').value = newTeam.id
    }

    // Reload from API so we pick up enriched members
    teams = await api.getTeams()
    renderTeamSelect()
    renderTeamForm()
    renderTeamLists()

    // Let other components (schedule) know
    window.dispatchEvent(new CustomEvent('teamsUpdated'))
  })

  document
    .getElementById('btn-delete-team')
    .addEventListener('click', async () => {
      const select = document.getElementById('team-select')
      const teamId = select.value || null
      if (!teamId) {
        alert('No team selected.')
        return
      }
      const team = teams.find(t => t.id === teamId)
      const name = team ? team.name : 'this team'

      if (!confirm(`Delete "${name}" and all its bookings?`)) return

      await api.deleteTeam(teamId)

      // refresh local state
      teams = await api.getTeams()
      select.value = ''
      document.getElementById('team-name-input').value = ''
      document.getElementById('team-lead-select').innerHTML = ''

      renderTeamSelect()
      renderTeamForm()
      renderTeamLists()

      window.dispatchEvent(new CustomEvent('teamsUpdated'))
    })

  document
    .getElementById('available-employees-list')
    .addEventListener('click', evt => {
      const li = evt.target.closest('li[data-employee-id]')
      if (!li) return
      moveEmployeeToTeam(li.dataset.employeeId)
      renderTeamForm() // update lead dropdown options
    })

  document
    .getElementById('team-members-list')
    .addEventListener('click', evt => {
      const li = evt.target.closest('li[data-employee-id]')
      if (!li) return
      moveEmployeeToAvailable(li.dataset.employeeId)
      renderTeamForm() // update lead dropdown options
    })
}

/* ------------------- select / form ---------------- */

function renderTeamSelect () {
  const select = document.getElementById('team-select')
  const prevValue = select.value
  select.innerHTML = '<option value="">(New team)</option>'

  for (const t of teams) {
    const opt = document.createElement('option')
    opt.value = t.id
    opt.textContent = t.name
    select.appendChild(opt)
  }

  if (prevValue && teams.some(t => t.id === prevValue)) {
    select.value = prevValue
  }
}

function renderTeamForm () {
  const select = document.getElementById('team-select')
  const nameInput = document.getElementById('team-name-input')
  const leadSelect = document.getElementById('team-lead-select')

  const selectedId = select.value || null
  const team = selectedId ? teams.find(t => t.id === selectedId) : null

  nameInput.value = team ? team.name : ''

  // Team lead options:
  //  - if editing an existing team: its members from API
  //  - if creating new team: members from current UI list
  let members = []
  if (team) {
    members = team.members || []
  } else {
    const memberIds = new Set(getCurrentTeamMembers())
    members = employees.filter(e => memberIds.has(e.id))
  }

  const previousLead = team?.teamLeadId || leadSelect.value || null

  leadSelect.innerHTML = ''
  const placeholder = document.createElement('option')
  placeholder.value = ''
  placeholder.textContent = '(No lead)'
  leadSelect.appendChild(placeholder)

  for (const e of members) {
    const opt = document.createElement('option')
    opt.value = e.id
    opt.textContent = e.name
    leadSelect.appendChild(opt)
  }

  if (previousLead && members.some(m => m.id === previousLead)) {
    leadSelect.value = previousLead
  } else {
    leadSelect.value = ''
  }
}

/* ------------------- lists UI --------------------- */

function renderTeamLists () {
  const availableList = document.getElementById('available-employees-list')
  const teamList = document.getElementById('team-members-list')

  availableList.innerHTML = ''
  teamList.innerHTML = ''

  const select = document.getElementById('team-select')
  const selectedId = select.value || null
  const team = selectedId ? teams.find(t => t.id === selectedId) : null

  const memberIds = new Set((team?.members || []).map(m => m.id))

  const available = employees.filter(e => !memberIds.has(e.id))
  const members = employees.filter(e => memberIds.has(e.id))

  for (const e of available) {
    const li = document.createElement('li')
    li.className =
      'list-group-item d-flex justify-content-between align-items-center'
    li.dataset.employeeId = e.id
    li.dataset.clickable = 'true'
    li.textContent = e.name

    const badge = document.createElement('span')
    badge.className =
      'badge bg-secondary-subtle text-secondary-emphasis'
    badge.textContent = e.role || 'Staff'
    li.appendChild(badge)

    availableList.appendChild(li)
  }

  for (const e of members) {
    const li = document.createElement('li')
    li.className =
      'list-group-item d-flex justify-content-between align-items-center'
    li.dataset.employeeId = e.id
    li.dataset.clickable = 'true'
    li.textContent = e.name

    const badge = document.createElement('span')
    badge.className =
      'badge bg-primary-subtle text-primary-emphasis'
    badge.textContent = e.role || 'Team'
    li.appendChild(badge)

    teamList.appendChild(li)
  }
}

function getCurrentTeamMembers () {
  const teamList = document.getElementById('team-members-list')
  return Array.from(
    teamList.querySelectorAll('li[data-employee-id]')
  ).map(li => li.dataset.employeeId)
}

/* -------------- move between lists ---------------- */

function moveEmployeeToTeam (employeeId) {
  const availableList = document.getElementById('available-employees-list')
  const teamList = document.getElementById('team-members-list')

  const li = availableList.querySelector(
    `li[data-employee-id="${employeeId}"]`
  )
  if (!li) return
  availableList.removeChild(li)

  const badge = li.querySelector('.badge')
  if (badge) {
    badge.className =
      'badge bg-primary-subtle text-primary-emphasis'
    badge.textContent = 'Team'
  }

  teamList.appendChild(li)
}

function moveEmployeeToAvailable (employeeId) {
  const teamList = document.getElementById('team-members-list')
  const availableList = document.getElementById('available-employees-list')

  const li = teamList.querySelector(
    `li[data-employee-id="${employeeId}"]`
  )
  if (!li) return
  teamList.removeChild(li)

  const badge = li.querySelector('.badge')
  if (badge) {
    badge.className =
      'badge bg-secondary-subtle text-secondary-emphasis'
    badge.textContent = 'Staff'
  }

  availableList.appendChild(li)
}
