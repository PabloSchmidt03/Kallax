/* ============================================================
   STATE
   ============================================================ */
const CFG = window.APP_CONFIG || {}

// Si config.js tiene keys, las escribe en localStorage para que toda la app las use
if (CFG.dg_token)  localStorage.setItem('dg_token',  CFG.dg_token)
if (CFG.yt_key)    localStorage.setItem('yt_key',    CFG.yt_key)
if (CFG.groq_key)  localStorage.setItem('groq_key',  CFG.groq_key)

const S = {
  token:    localStorage.getItem('dg_token')  || '',
  yt_key:   localStorage.getItem('yt_key')    || '',
  groq_key: localStorage.getItem('groq_key')  || '',
  collections: null,   // loaded below
  pagination:  { page: 1, pages: 1, items: 0 },
  lastSearch:  null,
  recsLoaded:  false,
  selectedStyles: ['Techno'],
  activeColId: 'favorites',
}

/* Load / migrate collections */
;(function loadCollections() {
  const stored = localStorage.getItem('dg_cols')
  if (stored) {
    S.collections = JSON.parse(stored)
    // Ensure favorites always exists
    if (!S.collections.find(c => c.id === 'favorites')) {
      S.collections.unshift({ id: 'favorites', name: 'Favoritos', items: [] })
    }
  } else {
    // Migrate old single collection
    const oldItems = JSON.parse(localStorage.getItem('dg_col') || '[]')
    S.collections = [{ id: 'favorites', name: 'Favoritos', items: oldItems }]
    localStorage.setItem('dg_cols', JSON.stringify(S.collections))
  }
})()

/* ============================================================
   PERSISTENCE
   ============================================================ */
const saveCols = () => localStorage.setItem('dg_cols', JSON.stringify(S.collections))

function updateBadges() {
  const allReleaseIds = new Set(S.collections.flatMap(c => c.items.map(r => r.id)))
  $('col-count').textContent = allReleaseIds.size
}

/* ============================================================
   HELPERS
   ============================================================ */
const $  = id  => document.getElementById(id)
const qs = sel => document.querySelector(sel)

function delay(ms) { return new Promise(r => setTimeout(r, ms)) }

/* ============================================================
   DISCOGS API
   ============================================================ */
const BASE = 'https://api.discogs.com'

async function apiGet(path, params = {}) {
  const url = new URL(BASE + path)
  url.searchParams.set('per_page', params.per_page || 24)
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '' || v === null) continue
    if (Array.isArray(v)) v.forEach(item => { if (item) url.searchParams.append(k, item) })
    else url.searchParams.set(k, v)
  }
  const res = await fetch(url.toString(), {
    headers: { 'Authorization': `Discogs token=${S.token}` }
  })
  if (!res.ok) {
    if (res.status === 401) throw new Error('Token inválido. Revisá la configuración.')
    if (res.status === 429) throw new Error('Límite de requests alcanzado. Esperá un momento.')
    throw new Error(`Error ${res.status} al conectar con Discogs`)
  }
  return res.json()
}

function getSortParams() {
  const val = $('sort-by')?.value || 'have|desc'
  if (val === 'surprise') return { sort: undefined, sort_order: undefined }
  const [sort, sort_order] = val.split('|')
  return { sort, sort_order }
}

const searchStyle  = (styles, year, country, page) => {
  const { sort, sort_order } = getSortParams()
  return apiGet('/database/search', {
    style: styles, year: year || undefined,
    country: country || undefined,
    type: 'master', sort, sort_order, page
  })
}
const searchLabel  = (label, page) => {
  const { sort, sort_order } = getSortParams()
  return apiGet('/database/search', { label, genre: 'Electronic', sort, sort_order, page })
}
const searchArtist = (artist, page) => {
  const { sort, sort_order } = getSortParams()
  return apiGet('/database/search', { artist, genre: 'Electronic', type: 'master', sort, sort_order, page })
}
const getLabelReleases  = (id, page) => {
  const { sort, sort_order } = getSortParams()
  const s = ['year','title','catno','format'].includes(sort) ? sort : 'year'
  return apiGet(`/labels/${id}/releases`, { sort: s, sort_order, page })
}
const getArtistReleases = (id, page) => {
  const { sort, sort_order } = getSortParams()
  const s = ['year','title'].includes(sort) ? sort : 'year'
  return apiGet(`/artists/${id}/releases`, { sort: s, sort_order, page })
}
const searchRelease = (q, page) => {
  const { sort, sort_order } = getSortParams()
  return apiGet('/database/search', { q, type: 'master', sort, sort_order, page })
}
const searchAC = (q, type) => apiGet('/database/search', { q, type, per_page: 8 })


/* ============================================================
   MAP API RESULT → LOCAL OBJECT
   ============================================================ */
function mapRelease(r) {
  const thumb = (r.cover_image || r.thumb || '')
  const img = thumb && !thumb.includes('spacer') ? thumb : ''
  const artist = r.artist || extractArtist(r.title) || ''
  const label = Array.isArray(r.label) ? r.label[0] : (r.label || '')
  return {
    id:     r.id,
    title:  r.title  || 'Sin título',
    artist, year: r.year || '', label, img,
    styles:  r.style   || [],
    country: r.country || '',
    url:    r.uri ? `https://www.discogs.com${r.uri}` : `https://www.discogs.com/release/${r.id}`,
  }
}

function mapDirectRelease(r) {
  const thumb = r.thumb || ''
  const img = thumb && !thumb.includes('spacer') ? thumb : ''
  return {
    id:     r.id,
    title:  r.title  || 'Sin título',
    artist: r.artist || '',
    year:   r.year   || '',
    label:  Array.isArray(r.label) ? r.label[0] : (r.label || ''),
    styles:  [],
    country: r.country || '',
    img,
    url:    `https://www.discogs.com/release/${r.id}`,
  }
}

function extractArtist(title = '') {
  const parts = title.split(' - ')
  return parts.length > 1 ? parts[0].trim() : ''
}

/* ============================================================
   COLLECTIONS
   ============================================================ */
const getCollection  = id  => S.collections.find(c => c.id === id)
const inCollection   = (releaseId, colId) =>
  (getCollection(colId)?.items || []).some(r => r.id === releaseId)
const inFavorites    = id  => inCollection(id, 'favorites')
const inAnyCol       = id  => S.collections.some(c => c.items.some(r => r.id === id))

function createCollection(name) {
  const col = { id: 'col_' + Date.now(), name, items: [] }
  S.collections.push(col)
  saveCols()
  return col
}

function deleteCollection(id) {
  if (id === 'favorites') return
  S.collections = S.collections.filter(c => c.id !== id)
  if (S.activeColId === id) S.activeColId = 'favorites'
  saveCols()
}

function toggleFavorite(rel) {
  const col = getCollection('favorites')
  if (!col) return
  const idx = col.items.findIndex(r => r.id === rel.id)
  if (idx >= 0) col.items.splice(idx, 1)
  else col.items.push(rel)
  saveCols()
  updateBadges()
  refreshCollectionIfVisible()
}

function toggleInCollection(rel, colId) {
  const col = getCollection(colId)
  if (!col) return
  const idx = col.items.findIndex(r => r.id === rel.id)
  if (idx >= 0) col.items.splice(idx, 1)
  else col.items.push(rel)
  saveCols()
  updateBadges()
  refreshCollectionIfVisible()
}

function refreshCollectionIfVisible() {
  if (!$('section-collection').classList.contains('hidden')) refreshCollectionSection()
}

/* ============================================================
   COLLECTION PICKER
   ============================================================ */
function showColPicker(rel, triggerBtn) {
  document.querySelector('.col-picker')?.remove()

  const picker = document.createElement('div')
  picker.className = 'col-picker'

  // Position: fixed relative to viewport
  const rect = triggerBtn.getBoundingClientRect()
  picker.style.position = 'fixed'
  picker.style.left = Math.min(Math.max(8, rect.left), window.innerWidth - 260) + 'px'
  if (window.innerHeight - rect.bottom >= 220) {
    picker.style.top    = (rect.bottom + 4) + 'px'
    picker.style.bottom = 'auto'
  } else {
    picker.style.bottom = (window.innerHeight - rect.top + 4) + 'px'
    picker.style.top    = 'auto'
  }

  let html = '<div class="col-picker-title">Guardar en colección</div>'
  S.collections.forEach(col => {
    const active = col.items.some(r => r.id === rel.id)
    html += `<div class="col-picker-item${active ? ' active' : ''}" data-id="${col.id}">
      <span class="col-picker-check">${active ? '✓' : ''}</span>
      <span class="col-picker-name">${col.name}</span>
      <span class="col-picker-n">${col.items.length}</span>
    </div>`
  })
  html += `<div class="col-picker-new-wrap">
    <input class="col-picker-input" id="col-new-input" placeholder="Nueva colección...">
    <button class="col-picker-add" id="col-new-add">+</button>
  </div>`

  picker.innerHTML = html
  document.body.appendChild(picker)

  // Toggle collection membership
  picker.querySelectorAll('.col-picker-item').forEach(item => {
    item.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation()
      toggleInCollection(rel, item.dataset.id)
      const nowIn = getCollection(item.dataset.id)?.items.some(r => r.id === rel.id)
      item.classList.toggle('active', nowIn)
      item.querySelector('.col-picker-check').textContent = nowIn ? '✓' : ''
      item.querySelector('.col-picker-n').textContent =
        getCollection(item.dataset.id)?.items.length || 0
      triggerBtn.classList.toggle('in-col', inAnyCol(rel.id))
    })
  })

  // Create new collection and add release to it
  const addNew = () => {
    const name = $('col-new-input').value.trim()
    if (!name) return
    const col = createCollection(name)
    toggleInCollection(rel, col.id)
    showColPicker(rel, triggerBtn)
  }
  $('col-new-add').addEventListener('mousedown', e => { e.preventDefault(); addNew() })
  $('col-new-input').addEventListener('keydown', e => { if (e.key === 'Enter') addNew() })

  // Close on outside click
  const close = e => {
    if (!picker.contains(e.target) && e.target !== triggerBtn) {
      picker.remove()
      document.removeEventListener('mousedown', close)
    }
  }
  setTimeout(() => document.addEventListener('mousedown', close), 0)
}

/* ============================================================
   CARD RENDERING
   ============================================================ */
const TPL = document.getElementById('card-tpl')

function buildCard(rel) {
  const card = TPL.content.cloneNode(true).querySelector('.card')

  // Cover
  const img = card.querySelector('.card-cover')
  // Reemplaza SOLO el <img> por el placeholder; reemplazar el innerHTML del
  // contenedor borraría el overlay (.btn-yt, .btn-like, etc.) y el siguiente
  // querySelector('.btn-yt') devolvería null → crash al renderizar la card.
  const showNoCover = () => {
    const ph = document.createElement('div')
    ph.className = 'no-cover'
    ph.innerHTML = '&#9834;'
    img.replaceWith(ph)
  }
  if (rel.img) {
    img.src = rel.img; img.alt = rel.title
    img.onerror = showNoCover
  } else {
    showNoCover()
  }

  // Info
  card.querySelector('.card-title').textContent      = rel.title
  card.querySelector('.card-artist').textContent     = rel.artist
  card.querySelector('.card-year').textContent       = rel.year
  card.querySelector('.card-label-name').textContent = rel.label

  // Play button
  card.querySelector('.btn-yt').addEventListener('click', () => Player.play(rel))

  // Discogs detail link
  card.querySelector('.btn-detail').href = rel.url

  // Flip info panel
  const coverWrap = card.querySelector('.card-cover-wrap')
  const faceBack  = card.querySelector('.card-face-back')
  const infoBtn   = card.querySelector('.card-info-btn')
  const MAX_STYLES = 3
  const shown  = rel.styles.slice(0, MAX_STYLES)
  const extra  = rel.styles.length - MAX_STYLES
  const tagsHtml = shown.map(s => `<span class="info-tag">${s}</span>`).join('')
    + (extra > 0 ? `<span class="info-tag info-tag-more">+${extra}</span>` : '')
  faceBack.innerHTML =
    `<div class="info-row"><span class="info-label">Año</span><span>${rel.year || '—'}</span></div>`
    + (rel.country ? `<div class="info-row"><span class="info-label">País</span><span>${rel.country}</span></div>` : '')
    + (rel.styles.length ? `<div class="info-row info-row-tags"><span class="info-label">Estilos</span><div class="info-tags">${tagsHtml}</div></div>` : '')

  infoBtn.addEventListener('click', e => {
    e.stopPropagation()
    coverWrap.classList.add('flipped')
  })
  faceBack.addEventListener('click', () => coverWrap.classList.remove('flipped'))

  // Like (favorites)
  const btnLike = card.querySelector('.btn-like')
  if (inFavorites(rel.id)) btnLike.classList.add('liked')
  btnLike.addEventListener('click', () => {
    toggleFavorite(rel)
    btnLike.classList.toggle('liked', inFavorites(rel.id))
  })

  // Save to collection (picker)
  const btnCol = card.querySelector('.btn-col')
  if (inAnyCol(rel.id)) btnCol.classList.add('in-col')
  btnCol.addEventListener('click', e => {
    e.stopPropagation()
    showColPicker(rel, btnCol)
  })

  return card
}

function renderGrid(releases, containerId) {
  const container = $(containerId)
  container.innerHTML = ''
  if (!releases.length) {
    container.innerHTML =
      '<p style="color:var(--dim);padding:32px;text-align:center;font-size:13px">Sin resultados para esta búsqueda.</p>'
    return
  }
  const frag = document.createDocumentFragment()
  releases.forEach(r => frag.appendChild(buildCard(r)))
  container.appendChild(frag)
}

/* ============================================================
   COLLECTION SECTION
   ============================================================ */
function refreshCollectionSection() {
  renderCollectionTabs()
  const col   = getCollection(S.activeColId) || S.collections[0]
  const empty = $('collection-empty')
  if (!col || !col.items.length) {
    empty.classList.remove('hidden')
    $('collection-grid').innerHTML = ''
  } else {
    empty.classList.add('hidden')
    renderGrid(col.items, 'collection-grid')
  }
}

function renderCollectionTabs() {
  const container = $('collections-tabs')
  container.innerHTML = ''

  S.collections.forEach(col => {
    const tab = document.createElement('button')
    tab.className = 'col-tab' + (col.id === S.activeColId ? ' active' : '')

    const nameSpan  = document.createElement('span')
    nameSpan.textContent = col.name
    const countSpan = document.createElement('span')
    countSpan.className = 'col-tab-count'
    countSpan.textContent = col.items.length
    tab.appendChild(nameSpan)
    tab.appendChild(countSpan)

    if (col.id !== 'favorites') {
      const del = document.createElement('span')
      del.className = 'col-tab-del'
      del.textContent = '×'
      del.title = 'Eliminar colección'
      del.addEventListener('click', e => {
        e.stopPropagation()
        if (confirm(`¿Eliminar la colección "${col.name}"?`)) {
          deleteCollection(col.id)
          refreshCollectionSection()
        }
      })
      tab.appendChild(del)
    }

    tab.addEventListener('click', () => {
      S.activeColId = col.id
      refreshCollectionSection()
    })
    container.appendChild(tab)
  })

  // "Nueva colección" button
  const newBtn = document.createElement('button')
  newBtn.className = 'col-tab col-tab-new'
  newBtn.textContent = '+ Nueva'
  newBtn.addEventListener('click', () => {
    const name = prompt('Nombre de la nueva colección:')
    if (name?.trim()) {
      const col = createCollection(name.trim())
      S.activeColId = col.id
      refreshCollectionSection()
    }
  })
  container.appendChild(newBtn)
}

/* ============================================================
   SEARCH / DISCOVER
   ============================================================ */
function setLoading(on) {
  $('loader').classList.toggle('hidden', !on)
  $('discover-welcome').classList.add('hidden')
  if (on) $('results-grid').innerHTML = ''
}

function setResultsMeta(pagination) {
  const meta = $('results-meta')
  meta.classList.remove('hidden')
  $('results-info').textContent = `${(pagination.items || 0).toLocaleString('es-AR')} resultados`
  $('page-info').textContent    = `Pág. ${pagination.page} / ${pagination.pages}`
  $('btn-prev').disabled        = pagination.page <= 1
  $('btn-next').disabled        = pagination.page >= pagination.pages
  S.pagination = pagination
}

async function runSearch(page = 1) {
  if (!S.token) { showSection('settings'); return }
  if (!S.lastSearch) return

  const isSurprise = $('sort-by')?.value === 'surprise'

  // In surprise mode: probe page 1 to get total pages, then jump to a random one
  const fetchPage = async (fetchFn) => {
    if (!isSurprise) return fetchFn(page)
    const probe = await fetchFn(1)
    const maxPage = Math.min(probe.pagination?.pages || 1, 30)
    const rndPage = Math.floor(Math.random() * maxPage) + 1
    if (rndPage === 1) return probe
    return fetchFn(rndPage)
  }

  setLoading(true)
  try {
    const s = S.lastSearch
    let data, releases

    if (s.type === 'style') {
      data = await fetchPage(p => searchStyle(s.styles, s.year, s.country, p))
      releases = (data.results || []).map(mapRelease)
      if (s.styles.length > 1) {
        releases = releases.filter(r =>
          s.styles.every(st =>
            r.styles.map(x => x.toLowerCase()).includes(st.toLowerCase())
          )
        )
      }
    } else if (s.type === 'label') {
      if (s.id) {
        data = await fetchPage(p => getLabelReleases(s.id, p))
        releases = (data.releases || []).map(mapDirectRelease)
      } else {
        data = await fetchPage(p => searchLabel(s.label, p))
        releases = (data.results || []).map(mapRelease)
      }
    } else if (s.type === 'artist') {
      if (s.id) {
        data = await fetchPage(p => getArtistReleases(s.id, p))
        releases = (data.releases || []).map(mapDirectRelease)
      } else {
        data = await fetchPage(p => searchArtist(s.artist, p))
        releases = (data.results || []).map(mapRelease)
      }
    } else if (s.type === 'release') {
      data = await fetchPage(p => searchRelease(s.q, p))
      releases = (data.results || []).map(mapRelease)
    }

    setLoading(false)
    renderGrid(releases, 'results-grid')
    if (data.pagination) setResultsMeta(data.pagination)
  } catch (e) {
    setLoading(false)
    $('results-grid').innerHTML =
      `<p style="color:var(--err);padding:32px;text-align:center;font-size:13px">${e.message}</p>`
  }
}

/* ============================================================
   RECOMMENDATIONS
   ============================================================ */
async function loadRecs() {
  const insufficient = $('recs-insufficient')
  const prompt_      = $('recs-prompt')
  const loader       = $('recs-loader')
  const meta         = $('recs-meta')
  const grid         = $('recs-grid')

  insufficient.classList.add('hidden')
  prompt_.classList.add('hidden')
  meta.classList.add('hidden')
  grid.innerHTML = ''

  // All releases across all collections
  const allItems = S.collections.flatMap(c => c.items)
  const uniqueItems = [...new Map(allItems.map(r => [r.id, r])).values()]

  if (uniqueItems.length < 3) {
    insufficient.classList.remove('hidden')
    return
  }

  loader.classList.remove('hidden')

  try {
    const artistFreq = {}
    uniqueItems.forEach(r => { if (r.artist) artistFreq[r.artist] = (artistFreq[r.artist] || 0) + 1 })
    const topArtists = Object.entries(artistFreq).sort((a,b) => b[1]-a[1]).slice(0,4).map(e => e[0])

    const labelFreq = {}
    uniqueItems.forEach(r => { if (r.label) labelFreq[r.label] = (labelFreq[r.label] || 0) + 1 })
    const topLabels = Object.entries(labelFreq).sort((a,b) => b[1]-a[1]).slice(0,3).map(e => e[0])

    const seen = new Set(uniqueItems.map(r => r.id))
    const results = []

    for (const artist of topArtists.slice(0, 3)) {
      try {
        await delay(350)
        const data = await searchArtist(artist, 1)
        if (data.results) results.push(...data.results.map(mapRelease))
      } catch { /* skip on rate limit */ }
    }
    for (const label of topLabels.slice(0, 2)) {
      try {
        await delay(350)
        const data = await searchLabel(label, 1)
        if (data.results) results.push(...data.results.map(mapRelease))
      } catch { /* skip */ }
    }

    const filtered = []
    for (const r of results) {
      if (!seen.has(r.id)) { seen.add(r.id); filtered.push(r) }
    }

    loader.classList.add('hidden')
    S.recsLoaded = true

    if (!filtered.length) {
      insufficient.querySelector('p').textContent =
        'No se encontraron nuevas recomendaciones. Agregá más releases variados.'
      insufficient.classList.remove('hidden')
      return
    }

    $('recs-info').textContent =
      `${filtered.length} recomendaciones basadas en ${topArtists.length} artistas y ${topLabels.length} sellos`
    meta.classList.remove('hidden')
    renderGrid(filtered.slice(0, 48), 'recs-grid')

  } catch (e) {
    loader.classList.add('hidden')
    insufficient.querySelector('p').textContent = `Error: ${e.message}`
    insufficient.classList.remove('hidden')
  }
}

function showRecsSection() {
  const insufficient = $('recs-insufficient')
  const prompt_      = $('recs-prompt')

  insufficient.classList.add('hidden')
  prompt_.classList.add('hidden')

  const allItems = S.collections.flatMap(c => c.items)
  const unique   = new Set(allItems.map(r => r.id))

  if (unique.size < 3) {
    insufficient.classList.remove('hidden')
    return
  }
  if (!S.recsLoaded) {
    $('recs-col-count').textContent = unique.size
    prompt_.classList.remove('hidden')
  }
}

/* ============================================================
   NAVIGATION
   ============================================================ */
function showSection(id) {
  document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'))
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'))
  $(`section-${id}`)?.classList.remove('hidden')
  qs(`[data-section="${id}"]`)?.classList.add('active')

  if (id === 'collection')      refreshCollectionSection()
  if (id === 'recommendations') showRecsSection()
}

/* ============================================================
   SETTINGS
   ============================================================ */
function initSettings() {
  if (S.token)    $('token-input').value    = S.token
  if (S.yt_key)   $('yt-key-input').value   = S.yt_key
  if (S.groq_key) $('groq-key-input').value = S.groq_key

  $('btn-save-yt-key').addEventListener('click', () => {
    const key = $('yt-key-input').value.trim()
    const fb  = $('yt-key-feedback')
    const setFb = (type, icon, msg) => {
      fb.className = `token-feedback ${type}`
      $('yt-key-icon').textContent = icon
      $('yt-key-msg').textContent  = msg
      fb.classList.remove('hidden')
    }
    if (!key) { setFb('err', '✗', 'Pegá tu YouTube API key antes de guardar.'); return }
    S.yt_key = key
    localStorage.setItem('yt_key', key)
    setFb('ok', '✓', 'YouTube API key guardada.')
  })

  $('btn-save-groq-key').addEventListener('click', () => {
    const key = $('groq-key-input').value.trim()
    const fb  = $('groq-key-feedback')
    const setFb = (type, icon, msg) => {
      fb.className = `token-feedback ${type}`
      $('groq-key-icon').textContent = icon
      $('groq-key-msg').textContent  = msg
      fb.classList.remove('hidden')
    }
    if (!key) { setFb('err', '✗', 'Pegá tu Groq API key antes de guardar.'); return }
    S.groq_key = key
    localStorage.setItem('groq_key', key)
    setFb('ok', '✓', 'Groq API key guardada. La IA ordenará la playlist automáticamente.')
  })

  $('btn-save-token').addEventListener('click', async () => {
    const tok = $('token-input').value.trim()
    const btn = $('btn-save-token')
    const lbl = $('btn-save-label')
    const spn = $('btn-save-spinner')
    const fb  = $('token-feedback')

    const setFeedback = (type, icon, msg) => {
      fb.className = `token-feedback ${type}`
      $('token-feedback-icon').textContent = icon
      $('token-feedback-msg').textContent  = msg
    }

    if (!tok) {
      setFeedback('err', '✗', 'Pegá tu token antes de guardar.')
      fb.classList.remove('hidden'); return
    }

    fb.classList.add('hidden')
    btn.disabled = true
    lbl.textContent = 'Verificando...'
    spn.classList.remove('hidden')

    try {
      const res = await fetch(
        `${BASE}/database/search?q=electronic&per_page=1`,
        { headers: { 'Authorization': `Discogs token=${tok}` } }
      )
      spn.classList.add('hidden')
      lbl.textContent = 'Verificar y guardar'
      btn.disabled = false

      if (res.ok) {
        S.token = tok
        localStorage.setItem('dg_token', tok)
        $('token-banner').classList.add('hidden')
        setFeedback('ok', '✓', 'Token válido y guardado. Redirigiendo...')
        fb.classList.remove('hidden')
        setTimeout(() => showSection('discover'), 1500)
      } else if (res.status === 401) {
        setFeedback('err', '✗', 'Token inválido. Copialo completo desde discogs.com/settings/developers.')
        fb.classList.remove('hidden')
      } else {
        setFeedback('err', '✗', `Error ${res.status}. Intentá de nuevo.`)
        fb.classList.remove('hidden')
      }
    } catch (e) {
      spn.classList.add('hidden')
      lbl.textContent = 'Verificar y guardar'
      btn.disabled = false
      setFeedback('err', '✗', 'No se pudo conectar con Discogs.')
      fb.classList.remove('hidden')
    }
  })

  $('btn-clear-data').addEventListener('click', () => {
    if (!confirm('¿Borrar todas las colecciones, wantlist y token? No se puede deshacer.')) return
    S.collections = [{ id: 'favorites', name: 'Favoritos', items: [] }]
    S.activeColId = 'favorites'
    saveCols(); updateBadges()
    S.recsLoaded = false
    localStorage.removeItem('dg_token')
    localStorage.removeItem('dg_want')
    localStorage.removeItem('yt_key')
    localStorage.removeItem('groq_key')
    S.token = ''; S.yt_key = ''; S.groq_key = ''
    $('token-input').value = ''
    $('yt-key-input').value = ''
    $('groq-key-input').value = ''
    alert('Datos borrados.')
  })
}

/* ============================================================
   STYLE TAG PICKER
   ============================================================ */
function renderStyleTags() {
  const container = $('style-tags')
  container.innerHTML = ''
  S.selectedStyles.forEach(style => {
    const tag = document.createElement('div')
    tag.className = 'style-tag'
    tag.innerHTML = `<span>${style}</span><button class="style-tag-x" title="Quitar">×</button>`
    tag.querySelector('.style-tag-x').addEventListener('click', () => {
      S.selectedStyles = S.selectedStyles.filter(s => s !== style)
      renderStyleTags()
    })
    container.appendChild(tag)
  })
}

/* ============================================================
   YEAR FILTER
   ============================================================ */
function buildYearParam() {
  const mode = $('year-mode').value
  const from = $('year-from').value.trim()
  const to   = $('year-to').value.trim()
  if (!mode)             return undefined
  if (mode === 'exact')  return from || undefined
  if (mode === 'gte')    return from ? `${from}-2026` : undefined
  if (mode === 'lte')    return from ? `1960-${from}` : undefined
  if (mode === 'range')  return (from && to) ? `${from}-${to}` : (from || undefined)
  return undefined
}

function updateYearInputs() {
  const mode = $('year-mode').value
  $('year-from').classList.toggle('hidden', !mode)
  $('year-to').classList.toggle('hidden', mode !== 'range')
  const labels = { exact: 'Año', gte: 'Desde', lte: 'Hasta', range: 'Desde' }
  $('year-from').placeholder = labels[mode] || 'Año'
}

/* ============================================================
   AUTOCOMPLETE
   ============================================================ */
function initAutocomplete(inputId, suggestionsId, acType, onSelect) {
  const input = $(inputId)
  const sug   = $(suggestionsId)
  let timer = null, activeIdx = -1

  const showStatus = msg => {
    sug.innerHTML = `<div class="sug-status">${msg}</div>`
    sug.classList.remove('hidden')
  }
  const closeSug = () => { sug.classList.add('hidden'); activeIdx = -1 }

  function renderItems(items) {
    sug.innerHTML = ''
    if (!items.length) { showStatus('Sin resultados'); return }
    items.forEach((item, i) => {
      const div = document.createElement('div')
      div.className = 'sug-item'
      div.dataset.idx = i
      const thumb = item.thumb && !item.thumb.includes('spacer')
        ? `<img class="sug-thumb" src="${item.thumb}" onerror="this.outerHTML='<div class=sug-ph>&#9834;</div>'">`
        : '<div class="sug-ph">&#9834;</div>'
      const sub = [item.country, item.year].filter(Boolean).join(' · ')
      div.innerHTML = `${thumb}
        <div class="sug-info">
          <div class="sug-name">${item.title}</div>
          ${sub ? `<div class="sug-sub">${sub}</div>` : ''}
        </div>`
      div.addEventListener('mousedown', e => {
        e.preventDefault()
        input.value = item.title
        onSelect(item.id, item.title)
        closeSug()
      })
      sug.appendChild(div)
    })
    sug.classList.remove('hidden')
  }

  input.addEventListener('input', () => {
    clearTimeout(timer)
    onSelect(null, input.value)
    const q = input.value.trim()
    if (q.length < 2) { closeSug(); return }
    showStatus('Buscando...')
    timer = setTimeout(async () => {
      try {
        const data = await searchAC(q, acType)
        renderItems(data.results || [])
      } catch { showStatus('Error al buscar') }
    }, 380)
  })

  input.addEventListener('keydown', e => {
    const items = sug.querySelectorAll('.sug-item')
    if (!items.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      activeIdx = Math.min(activeIdx + 1, items.length - 1)
      items.forEach((el, i) => el.classList.toggle('active', i === activeIdx))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      activeIdx = Math.max(activeIdx - 1, 0)
      items.forEach((el, i) => el.classList.toggle('active', i === activeIdx))
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault()
      items[activeIdx].dispatchEvent(new MouseEvent('mousedown'))
    } else if (e.key === 'Escape') {
      closeSug()
    }
  })

  input.addEventListener('blur', () => setTimeout(closeSug, 150))
}

/* ============================================================
   YOUTUBE PLAYER  (YT IFrame API, pre-initialized on load)
   ============================================================ */
const Player = (() => {
  let yt         = null
  let ytReady    = false
  let pendingId  = null
  let timer      = null
  let isSeeking  = false
  let prevVol    = 80
  let playlist   = []   // [{ videoId, title, duration }]
  let trackIdx   = 0
  let currentRel = null

  const fmt = s => {
    if (!isFinite(s) || s < 0) return '0:00:00'
    const h   = Math.floor(s / 3600)
    const m   = Math.floor((s % 3600) / 60)
    const sec = Math.floor(s % 60)
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  }

  const fillRange = el => {
    const pct = (parseFloat(el.value) / parseFloat(el.max || 100)) * 100
    el.style.background = `linear-gradient(to right,#fff ${pct}%,#535353 ${pct}%)`
  }

  function setPauseIcon() {
    $('player-play-icon').innerHTML = '<rect x="3" y="2" width="4" height="12" rx="1"/><rect x="9" y="2" width="4" height="12" rx="1"/>'
  }
  function setPlayIcon() {
    $('player-play-icon').innerHTML = '<polygon points="3,1 13,8 3,15"/>'
  }

  function updateVolIcon(v) {
    const p = $('player-vol-icon')
    if (v === 0)
      p.innerHTML = '<path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>'
    else if (v < 50)
      p.innerHTML = '<path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"/>'
    else
      p.innerHTML = '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>'
  }

  function updateNavBtns() {
    $('player-prev').disabled = trackIdx <= 0
    $('player-next').disabled = trackIdx >= playlist.length - 1
  }

  function tick() {
    if (!yt || isSeeking) return
    try {
      const cur = yt.getCurrentTime() || 0
      const dur = yt.getDuration()    || 0
      $('player-current').textContent  = fmt(cur)
      $('player-duration').textContent = dur > 0 ? '-' + fmt(dur - cur) : '-0:00:00'
      const seek = $('player-seek')
      seek.value = dur > 0 ? (cur / dur) * 100 : 0
      fillRange(seek)
    } catch (_) {}
  }

  function onStateChange(e) {
    const s = e.data
    if (s === 1) {        // PLAYING
      setPauseIcon()
      clearInterval(timer)
      timer = setInterval(tick, 500)
    } else if (s === 2) { // PAUSED
      setPlayIcon()
    } else if (s === 0) { // ENDED
      clearInterval(timer)
      const seek = $('player-seek'); seek.value = 0; fillRange(seek)
      $('player-current').textContent  = '0:00:00'
      $('player-duration').textContent = '-0:00:00'
      if (trackIdx < playlist.length - 1) {
        loadTrack(trackIdx + 1)
      } else {
        setPlayIcon()
      }
    }
  }

  // Called by YouTube API once its script is fully loaded
  window.onYouTubeIframeAPIReady = function() {
    yt = new YT.Player('yt-iframe', {
      height: '113', width: '200',
      playerVars: { controls: 0, rel: 0, playsinline: 1, origin: location.origin },
      events: {
        onReady(ev) {
          ytReady = true
          try { ev.target.getIframe().setAttribute('allow', 'autoplay; encrypted-media') } catch (_) {}
          ev.target.setVolume(parseInt($('player-vol').value))
          if (pendingId) { yt.loadVideoById(pendingId); pendingId = null }
        },
        onStateChange,
        onError(e) {
          $('player-title').textContent = $('player-title').textContent.replace(/  ·  .*/, '') + '  ·  error ' + e.data
        }
      }
    })
  }

  function renderTracklist() {
    const container = $('tracklist-items')
    container.innerHTML = ''
    playlist.forEach((track, i) => {
      const row = document.createElement('div')
      row.className = 'tracklist-item' + (i === trackIdx ? ' active' : '')
      row.innerHTML =
        `<span class="tracklist-num">${i + 1}</span>` +
        `<span class="tracklist-title">${track.title}</span>` +
        `<span class="tracklist-dur">${track.duration > 0 ? fmt(track.duration) : '—'}</span>`
      row.addEventListener('click', () => loadTrack(i))
      container.appendChild(row)
    })
  }

  function loadTrack(idx) {
    if (!playlist.length) return
    trackIdx = idx
    const track = playlist[idx]
    $('player-title').textContent = track.title
    if (ytReady) yt.loadVideoById(track.videoId)
    else pendingId = track.videoId
    renderTracklist()
    updateNavBtns()
    // Scroll active track into view in the panel
    const items = $('tracklist-items').querySelectorAll('.tracklist-item')
    items[idx]?.scrollIntoView({ block: 'nearest' })
  }

  function showBar(rel) {
    const thumb = $('player-thumb')
    thumb.src = rel.img || ''; thumb.style.opacity = rel.img ? '1' : '0'
    $('player-title').textContent  = rel.title
    $('player-artist').textContent = rel.artist
    $('player-bar').classList.remove('hidden')
    document.body.classList.add('player-open')
    setPlayIcon()
    const seek = $('player-seek'); seek.value = 0; fillRange(seek)
    $('player-current').textContent  = '0:00:00'
    $('player-duration').textContent = '-0:00:00'
  }

  async function fetchDiscogsVideos(rel) {
    const ytIdFromUri = uri => {
      const m = uri.match(/[?&]v=([^&]+)/)
      return m ? m[1] : null
    }
    const parseVideos = videos =>
      (videos || [])
        .filter(v => v.embed && v.uri && v.uri.includes('youtube'))
        .map(v => ({ videoId: ytIdFromUri(v.uri), title: v.title || '', duration: v.duration || 0 }))
        .filter(v => v.videoId)

    const parseTracklist = tl =>
      (tl || []).filter(t => t.title && t.type_ !== 'heading' && t.type_ !== 'index').map(t => t.title)

    try {
      if (rel.url.includes('/master/')) {
        const master = await apiGet(`/masters/${rel.id}`)
        const vids = parseVideos(master.videos)
        if (vids.length) return { videos: vids, tracklist: parseTracklist(master.tracklist) }
        if (master.main_release) {
          const release = await apiGet(`/releases/${master.main_release}`)
          return { videos: parseVideos(release.videos), tracklist: parseTracklist(release.tracklist) }
        }
        return { videos: [], tracklist: [] }
      } else {
        const release = await apiGet(`/releases/${rel.id}`)
        return { videos: parseVideos(release.videos), tracklist: parseTracklist(release.tracklist) }
      }
    } catch (_) {
      return { videos: [], tracklist: [] }
    }
  }

  async function aiSortPlaylist(tracklist, videos, rel) {
    if (!S.groq_key || !videos.length) return videos
    try {
      const prompt =
`You are a music metadata assistant. Filter and clean YouTube videos for an album.

ARTIST: "${rel.artist}"
ALBUM: "${rel.title}"

OFFICIAL TRACKLIST:
${tracklist.length ? tracklist.map((t, i) => `${i + 1}. ${t}`).join('\n') : '(no tracklist available)'}

YOUTUBE VIDEOS:
${JSON.stringify(videos.map(v => ({ id: v.videoId, title: v.title })))}

STEP 1 — For each video, reason: does it match a tracklist track (exact or remix/version)?
Ignore noise in YouTube titles: artist name, album name, [HQ], [HD], [Official], [Audio], [Video], [Remaster], year numbers, channel names, etc.

STEP 2 — Classify each video as one of:
  A) TRACK — matches a tracklist entry directly (possibly with noise)
  B) VERSION — is a remix, live, instrumental, extended, radio edit, etc. of a tracklist track
  C) EXCLUDE — unrelated (reaction, review, full album rip, playlist, unrelated content, or can't determine which track it belongs to)

STEP 3 — Build the title:
  A) TRACK   → use EXACTLY the tracklist entry name, character by character. Nothing added, nothing changed.
  B) VERSION → [exact tracklist entry name] + " (version descriptor)"
               Version descriptor = remixer name + "Remix", or version type. Keep it short and clean.
               Examples: "Xtal (Polygon Window Remix)", "Tha (Live)", "Pulsewidth (Extended Mix)"
  C) EXCLUDE → do not include in result

Return a JSON object:
- "thinking": one line per video explaining your classification
- "result": [{"id": "videoId", "title": "Final Title", "type": "track"|"version", "trackIndex": N}]
  · type: "track" for A, "version" for B — never include C
  · trackIndex: 1-based position of the matched tracklist entry (same number as in the list above)`

      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${S.groq_key}`
        },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
          max_tokens: 2048,
          response_format: { type: 'json_object' }
        })
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error.message)

      const parsed = JSON.parse(data.choices[0].message.content)
      const arr = parsed.result || parsed.videos || parsed.playlist || Object.values(parsed)[0]
      if (!Array.isArray(arr)) throw new Error('unexpected format')

      const videoMap = new Map(videos.map(v => [v.videoId, v]))
      return arr
        .filter(item => videoMap.has(item.id))
        .map(item => ({
          ...videoMap.get(item.id),
          title:      item.title || videoMap.get(item.id).title,
          _type:      item.type       || 'version',
          _trackIdx:  item.trackIndex || 999,
        }))
        .sort((a, b) => {
          // Tracks before versions; within each group, sort by tracklist position
          const typeOrder = { track: 0, version: 1 }
          const ta = typeOrder[a._type] ?? 1
          const tb = typeOrder[b._type] ?? 1
          if (ta !== tb) return ta - tb
          return a._trackIdx - b._trackIdx
        })
        .map(({ _type, _trackIdx, ...item }) => item)
    } catch (err) {
      console.warn('[Groq] aiSortPlaylist falló:', err.message)
      return videos  // fallback: orden original
    }
  }

  async function play(rel) {
    currentRel = rel
    showBar(rel)
    playlist = []
    trackIdx = 0
    $('player-title').textContent = rel.title + '  ·  cargando...'
    $('tracklist-album-title').textContent = rel.artist + ' — ' + rel.title

    // 1. Try Discogs videos
    const { videos: discogsVideos, tracklist } = await fetchDiscogsVideos(rel)

    if (discogsVideos.length) {
      if (S.groq_key) $('player-title').textContent = rel.title + '  ·  ordenando con IA...'
      playlist = await aiSortPlaylist(tracklist, discogsVideos, rel)
      renderTracklist()
      updateNavBtns()
      loadTrack(0)
      return
    }

    // 2. Fallback: YouTube Data API search
    if (S.yt_key) {
      try {
        const q = encodeURIComponent(`${rel.artist} ${rel.title} full album`)
        const searchRes = await fetch(
          `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${q}&type=video&maxResults=5&videoEmbeddable=true&key=${S.yt_key}`
        )
        const searchData = await searchRes.json()
        if (searchData.error) throw new Error(searchData.error.message)
        if (!searchData.items?.length) throw new Error('Sin resultados en YouTube')

        const ids = searchData.items.map(i => i.id.videoId).join(',')
        const statsRes = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids}&key=${S.yt_key}`
        )
        const statsData = await statsRes.json()
        const viewCount = {}
        statsData.items?.forEach(v => { viewCount[v.id] = parseInt(v.statistics?.viewCount || 0) })

        const AVOID   = /reaction|review|remix|cover|live|tribute|bootleg|commentary/i
        const PREFER  = /full[\s_-]*album/i
        const artLow  = rel.artist.toLowerCase()

        const scored = searchData.items.map(item => {
          const title   = item.snippet.title
          const channel = item.snippet.channelTitle
          const vid     = item.id.videoId
          let score = 0
          if (PREFER.test(title))                         score += 3
          if (channel.includes('- Topic'))                score += 2
          if (channel.toLowerCase().includes(artLow))     score += 1
          if (AVOID.test(title))                          score -= 2
          score += (viewCount[vid] || 0) / 1e9
          return { vid, title: item.snippet.title, score }
        })
        scored.sort((a, b) => b.score - a.score)

        playlist = [{ videoId: scored[0].vid, title: scored[0].title, duration: 0 }]
        renderTracklist()
        updateNavBtns()
        loadTrack(0)
        return
      } catch (err) {
        $('player-title').textContent = rel.title + '  ·  ' + err.message
        return
      }
    }

    // 3. Fallback: open YouTube in new tab
    $('player-title').textContent = rel.title + '  ·  sin videos'
    window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(rel.artist + ' ' + rel.title + ' full album')}`, '_blank')
  }

  function init() {
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(s)

    const vol = $('player-vol')
    fillRange(vol)

    $('player-play').addEventListener('click', () => {
      if (!yt || !ytReady) return
      try { yt.getPlayerState() === 1 ? yt.pauseVideo() : yt.playVideo() } catch (_) {}
    })

    $('player-prev').addEventListener('click', () => {
      if (trackIdx > 0) loadTrack(trackIdx - 1)
    })
    $('player-next').addEventListener('click', () => {
      if (trackIdx < playlist.length - 1) loadTrack(trackIdx + 1)
    })

    $('player-tracklist-btn').addEventListener('click', () => {
      $('player-tracklist').classList.toggle('hidden')
    })
    $('tracklist-close').addEventListener('click', () => {
      $('player-tracklist').classList.add('hidden')
    })

    vol.addEventListener('input', () => {
      fillRange(vol)
      const v = parseInt(vol.value)
      updateVolIcon(v)
      if (yt && ytReady) try { yt.setVolume(v) } catch (_) {}
      if (v > 0) prevVol = v
    })

    $('player-mute').addEventListener('click', () => {
      if (!yt || !ytReady) return
      const v = parseInt(vol.value)
      if (v === 0) { vol.value = prevVol || 80; try { yt.unMute(); yt.setVolume(prevVol || 80) } catch (_) {} }
      else         { prevVol = v; vol.value = 0; try { yt.mute();  yt.setVolume(0)             } catch (_) {} }
      fillRange(vol); updateVolIcon(parseInt(vol.value))
    })

    const seek = $('player-seek')
    seek.addEventListener('mousedown',  () => { isSeeking = true })
    seek.addEventListener('touchstart', () => { isSeeking = true }, { passive: true })
    seek.addEventListener('input', () => {
      fillRange(seek)
      if (yt && ytReady) {
        try {
          const cur = (parseFloat(seek.value) / 100) * (yt.getDuration() || 0)
          const dur = yt.getDuration() || 0
          $('player-current').textContent  = fmt(cur)
          $('player-duration').textContent = dur > 0 ? '-' + fmt(dur - cur) : '-0:00:00'
        } catch (_) {}
      }
    })
    seek.addEventListener('change', () => {
      if (yt && ytReady) try { yt.seekTo((parseFloat(seek.value) / 100) * (yt.getDuration() || 0), true) } catch (_) {}
      isSeeking = false
    })

    $('player-close').addEventListener('click', () => {
      $('player-bar').classList.add('hidden')
      $('player-tracklist').classList.add('hidden')
      document.body.classList.remove('player-open')
      if (yt && ytReady) try { yt.stopVideo() } catch (_) {}
      clearInterval(timer)
    })
  }

  return { init, play }
})()

/* ============================================================
   INIT
   ============================================================ */
function init() {
  updateBadges()
  if (!S.token) $('token-banner').classList.remove('hidden')

  // Nav
  document.querySelectorAll('.nav-btn').forEach(btn =>
    btn.addEventListener('click', () => showSection(btn.dataset.section))
  )

  // Search type tabs
  document.querySelectorAll('.stab').forEach(tab =>
    tab.addEventListener('click', () => {
      document.querySelectorAll('.stab').forEach(t => t.classList.remove('active'))
      tab.classList.add('active')
      document.querySelectorAll('.search-input-group').forEach(g => g.classList.add('hidden'))
      $(`search-${tab.dataset.type}`)?.classList.remove('hidden')
    })
  )

  $('year-mode').addEventListener('change', updateYearInputs)

  $('style-add').addEventListener('change', () => {
    const val = $('style-add').value
    if (!val) return
    if (!S.selectedStyles.includes(val)) {
      S.selectedStyles.push(val)
      renderStyleTags()
    }
    $('style-add').value = ''
  })
  renderStyleTags()

  $('btn-search-style').addEventListener('click', () => {
    if (!S.selectedStyles.length) {
      $('style-tags').style.outline = '2px solid var(--err)'
      setTimeout(() => { $('style-tags').style.outline = '' }, 1200)
      return
    }
    S.lastSearch = {
      type:    'style',
      styles:  [...S.selectedStyles],
      year:    buildYearParam(),
      country: $('country-filter').value || undefined,
    }
    runSearch(1)
  })

  const acState = { label: { id: null }, artist: { id: null } }

  initAutocomplete('label-input', 'label-sug', 'label', (id, name) => {
    acState.label = { id, name }
  })
  initAutocomplete('artist-input', 'artist-sug', 'artist', (id, name) => {
    acState.artist = { id, name }
  })

  $('btn-search-label').addEventListener('click', () => {
    const v = $('label-input').value.trim()
    if (!v) return
    S.lastSearch = { type: 'label', label: v, id: acState.label.id }
    runSearch(1)
  })

  $('btn-search-artist').addEventListener('click', () => {
    const v = $('artist-input').value.trim()
    if (!v) return
    S.lastSearch = { type: 'artist', artist: v, id: acState.artist.id }
    runSearch(1)
  })

  $('btn-search-release').addEventListener('click', () => {
    const v = $('release-input').value.trim()
    if (!v) return
    S.lastSearch = { type: 'release', q: v }
    runSearch(1)
  })

  $('release-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('btn-search-release').click()
  })

  $('btn-prev').addEventListener('click', () => runSearch(S.pagination.page - 1))
  $('btn-next').addEventListener('click', () => runSearch(S.pagination.page + 1))

  ;['label-input', 'artist-input'].forEach(id => {
    $(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') $(`btn-search-${id.split('-')[0]}`).click()
    })
  })

  $('btn-load-recs').addEventListener('click', loadRecs)
  $('btn-recs-refresh').addEventListener('click', () => { S.recsLoaded = false; loadRecs() })

  initSettings()
  Player.init()
}

document.addEventListener('DOMContentLoaded', init)
