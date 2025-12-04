// app.js
import { initScheduleGrid } from './components/scheduleGrid.js'
import { initPeople } from './components/people.js'
import { initProducts } from './components/products.js'

document.addEventListener('DOMContentLoaded', () => {
  initScheduleGrid()
  initPeople()
  initProducts()
})
