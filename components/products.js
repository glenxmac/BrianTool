// components/products.js
import * as api from '../api.mock.js'

let products = []

export function initProducts () {
  setupHandlers()
  refreshProducts()
}

async function refreshProducts () {
  try {
    products = await api.getProducts()
  } catch (err) {
    console.error('Failed to load products', err)
    products = []
  }
  renderProductsTable()
}

/* ------------ DOM wiring ------------ */

function setupHandlers () {
  const form = document.getElementById('products-form')
  const resetBtn = document.getElementById('btn-product-reset')
  const table = document.getElementById('products-table')

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

function renderProductsTable () {
  const tbody = document.querySelector('#products-table tbody')
  if (!tbody) return

  if (!products.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="text-muted small text-center py-3">
          No products yet. Add blinds, shutters, etc. on the left.
        </td>
      </tr>
    `
    return
  }

  tbody.innerHTML = products
    .map(p => {
      return `
        <tr data-product-id="${p.id}">
          <td>${escapeHtml(p.productId || '')}</td>
          <td>${escapeHtml(p.name)}</td>
          <td>${escapeHtml(p.category || '')}</td>
          <td>${escapeHtml(p.subType || '')}</td>
          <td class="text-end">
            <button
              type="button"
              class="btn btn-sm btn-outline-danger"
              data-action="delete-product"
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
  const idInput = document.getElementById('product-id')
  const nameInput = document.getElementById('product-name')
  const categoryInput = document.getElementById('product-category')
  const subTypeInput = document.getElementById('product-subtype')
  const productIdInput = document.getElementById('product-code')

  const id = idInput.value || null
  const name = nameInput.value.trim()
  const category = categoryInput.value.trim()
  const subType = subTypeInput.value.trim()
  const productId = productIdInput.value.trim()

  if (!name) {
    nameInput.focus()
    return
  }

  const payload = { id, name, category, subType, productId }

  try {
    if (id) {
      await api.updateProduct(payload)
    } else {
      await api.createProduct(payload)
    }
    clearForm()
    await refreshProducts()
  } catch (err) {
    console.error('Failed to save product', err)
    alert('Unable to save product.')
  }
}

function onTableClick (e) {
  const deleteBtn = e.target.closest('[data-action="delete-product"]')
  const row = e.target.closest('tr[data-product-id]')
  if (!row) return

  const id = row.dataset.productId
  const product = products.find(p => String(p.id) === String(id))
  if (!product) return

  if (deleteBtn) {
    handleDeleteProduct(product)
  } else {
    // click row -> load into form
    fillForm(product)
  }
}

async function handleDeleteProduct (product) {
  if (!confirm(`Delete ${product.name}?`)) return
  try {
    await api.deleteProduct(product.id)
    await refreshProducts()
    const idInput = document.getElementById('product-id')
    if (idInput && idInput.value === String(product.id)) {
      clearForm()
    }
  } catch (err) {
    console.error('Failed to delete product', err)
    alert('Unable to delete product.')
  }
}

/* ------------ Form helpers ------------ */

function fillForm (product) {
  const idInput = document.getElementById('product-id')
  const nameInput = document.getElementById('product-name')
  const categoryInput = document.getElementById('product-category')
  const subTypeInput = document.getElementById('product-subtype')
  const productIdInput = document.getElementById('product-code')

  if (!idInput) return

  idInput.value = product.id
  nameInput.value = product.name || ''
  categoryInput.value = product.category || ''
  subTypeInput.value = product.subType || ''
  productIdInput.value = product.productId || ''
}

function clearForm () {
  const idInput = document.getElementById('product-id')
  const nameInput = document.getElementById('product-name')
  const categoryInput = document.getElementById('product-category')
  const subTypeInput = document.getElementById('product-subtype')
  const productIdInput = document.getElementById('product-code')

  if (!idInput) return

  idInput.value = ''
  nameInput.value = ''
  categoryInput.value = ''
  subTypeInput.value = ''
  productIdInput.value = ''
}

/* ------------ Small utils ------------ */

function escapeHtml (str) {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
