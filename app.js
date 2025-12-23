// app.js
import { initScheduleGrid } from './components/scheduleGrid.js'
import { initPeople } from './components/people.js'
import { initProducts } from './components/products.js'

import { supabase, getSession, signInWithPassword, signOut } from './api.supabase.js'

let appStarted = false
let loginModal

function startAppOnce () {
  if (appStarted) return
  appStarted = true
  initScheduleGrid()
  initPeople()
  initProducts()
}

function setLoginError (msg) {
  const el = document.getElementById('loginError')
  if (!el) return
  if (!msg) {
    el.classList.add('d-none')
    el.textContent = ''
  } else {
    el.classList.remove('d-none')
    el.textContent = msg
  }
}

function updateAuthBar (session) {
  const label = document.getElementById('authUserLabel')
  const btn = document.getElementById('btnSignOut')
  const email = session?.user?.email

  if (label) label.textContent = email ? `Signed in: ${email}` : 'Not signed in'
  if (btn) btn.classList.toggle('d-none', !email)
}

async function ensureSignedIn () {
  let session = null
  try {
    session = await getSession()
  } catch (e) {
    // ignore; we'll just show the login modal
  }

  updateAuthBar(session)

  if (session) {
    setLoginError('')
    if (loginModal) loginModal.hide()
    startAppOnce()
  } else {
    if (loginModal) loginModal.show()
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // Bootstrap modal instance
  const modalEl = document.getElementById('loginModal')
  if (modalEl && window.bootstrap?.Modal) {
    loginModal = new window.bootstrap.Modal(modalEl, {
      backdrop: 'static',
      keyboard: false
    })
  }

  // Login form
  const loginForm = document.getElementById('loginForm')
  if (loginForm) {
    loginForm.addEventListener('submit', async e => {
      e.preventDefault()
      setLoginError('')

      const email = document.getElementById('loginEmail')?.value?.trim()
      const password = document.getElementById('loginPassword')?.value

      if (!email || !password) return

      const btn = document.getElementById('btnLoginSubmit')
      if (btn) btn.disabled = true
      try {
        await signInWithPassword(email, password)
        await ensureSignedIn()
      } catch (err) {
        setLoginError(err?.message || 'Unable to sign in.')
      } finally {
        if (btn) btn.disabled = false
      }
    })
  }

  // Sign out button
  const signOutBtn = document.getElementById('btnSignOut')
  if (signOutBtn) {
    signOutBtn.addEventListener('click', async () => {
      try {
        await signOut()
      } finally {
        await ensureSignedIn()
      }
    })
  }

  // Keep UI in sync if tabs refresh or token refresh happens
  supabase.auth.onAuthStateChange(() => {
    ensureSignedIn()
  })

  // First check
  ensureSignedIn()
})
