# Discogs Explorer

App web de una sola página para explorar música electrónica usando la API pública de Discogs.

## Objetivo y público

**Público objetivo:** DJs que quieren descubrir música para tocar en sus sets.

La app permite explorar por géneros, artistas y sellos; escuchar una preview del álbum encontrado; y guardar releases en colecciones personales para posteriormente descargarlos por su cuenta (la descarga no es responsabilidad de la app). Una vez guardados releases, la app genera recomendaciones basadas en los artistas y sellos de la colección.

**Estado actual:** en desarrollo, probándose localmente. La intención es abrirla al público en el futuro, por lo que las decisiones de arquitectura deben contemplar ese camino (ej: no hardcodear rutas locales, manejar cuotas de APIs, etc.).

**La app está abierta a nuevas ideas** — se prioriza utilidad para el DJ por encima de cualquier otra consideración.

---

## Stack

- Vanilla HTML + CSS + JavaScript (sin frameworks, sin build tools)
- API REST de Discogs (`https://api.discogs.com`)
- Persistencia en `localStorage` del navegador
- Groq API para ordenamiento y sanitización de la playlist con IA (opcional)
- YouTube IFrame API para reproducción + YouTube Data API v3 como fallback de búsqueda (opcional)

## Archivos

- `index.html` — estructura completa de la UI, incluye el template `<card-tpl>` para tarjetas de releases
- `app.js` — toda la lógica: estado, llamadas a la API, renderizado, colecciones, wantlist, recomendaciones, player
- `style.css` — estilos

## Arquitectura

Estado global en el objeto `S` (app.js línea 4). No hay módulos ni bundler; todo corre en el browser directamente.

### Secciones de la app
| Sección | ID | Descripción |
|---|---|---|
| Descubrir | `section-discover` | Búsqueda principal con paginación |
| Colecciones | `section-collection` | Listas personalizadas de releases |
| Wantlist | `section-wantlist` | Releases deseados |
| Recomendaciones | `section-recommendations` | Sugerencias basadas en las colecciones |
| Configuración | `section-settings` | Tokens/keys y borrado de datos |

### API de Discogs
Requiere un token personal guardado en `localStorage` (`dg_token`). Sin token la app redirige a Settings.

Endpoints usados:
- `GET /database/search` — búsqueda por estilo, sello o artista
- `GET /labels/:id/releases` — releases de un sello específico
- `GET /artists/:id/releases` — releases de un artista específico
- `GET /masters/:id` — metadata de master release (usado por el player)
- `GET /releases/:id` — release específico con tracklist y videos (usado por el player)

Rate limit: 60 req/min sin autenticación, 240 req/min con token. Las recomendaciones usan `delay(350ms)` entre requests para evitar 429.

### Persistencia (localStorage)
| Clave | Contenido |
|---|---|
| `dg_token` | Token de Discogs |
| `dg_cols` | Array de colecciones (JSON) |
| `dg_want` | Array de wantlist (JSON) |
| `yt_key` | YouTube Data API v3 key (opcional, fallback del player) |
| `groq_key` | Groq API key (opcional, IA para ordenar y limpiar playlist) |

### Player de YouTube (`Player` en app.js)

Módulo IIFE que encapsula todo el reproductor. Estado privado: `yt`, `ytReady`, `pendingId`, `playlist`, `trackIdx`, `currentRel`.

**Flujo de reproducción al hacer click en Play de una card:**
1. `fetchDiscogsVideos(rel)` — busca videos en `/masters/{id}` o `/releases/{id}` según la URL. Si el master no tiene videos, intenta con `main_release`. Devuelve `{ videos, tracklist }`.
2. Si Discogs tiene videos y hay `S.groq_key` → `aiSortPlaylist()` ordena y limpia los títulos con IA.
3. Si Discogs tiene videos sin key de Groq → se usan tal cual.
4. Si no hay videos en Discogs y hay `S.yt_key` → fallback a YouTube Data API search.
5. Si no hay ninguna key → abre YouTube en nueva pestaña.

**`aiSortPlaylist(tracklist, videos, rel)`:**
Llama a Groq (`llama-3.1-8b-instant`) con un prompt que clasifica cada video como:
- `track` — coincide con un track del tracklist → título exacto del tracklist de Discogs
- `version` — remix, live, instrumental, etc. de un track → nombre del tracklist + sufijo limpio
- excluido — reacciones, reviews, rips, contenido no relacionado → no aparece en la playlist

El modelo devuelve `{ thinking, result: [{ id, title, type, trackIndex }] }`. El ordenamiento final lo hace JavaScript: primero todos los `track` por `trackIndex`, luego todos los `version` por `trackIndex`. El campo `thinking` se descarta.

**Tiempos en el player:**
- Izquierda: tiempo transcurrido `H:MM:SS` (sube desde 0)
- Derecha: tiempo restante `-H:MM:SS` (baja hacia `-0:00:00`)

**Elementos HTML del player:**
| ID | Descripción |
|---|---|
| `player-bar` | Barra fija inferior (90px) |
| `player-tracklist` | Panel de tracklist sobre la barra (oculto por defecto) |
| `player-tracklist-btn` | Botón ≡ que abre/cierra el panel |
| `player-prev` / `player-next` | Navegación entre tracks |
| `player-play` | Play/Pausa |
| `player-seek` | Barra de progreso (range 0-100) |
| `player-current` / `player-duration` | Displays de tiempo |
| `yt-iframe` | Div reemplazado por el iframe de YouTube API (posicionado fuera de pantalla) |

**YouTube IFrame API:** se carga dinámicamente en `Player.init()`. El player se crea en `window.onYouTubeIframeAPIReady`. Si se llama `play()` antes de que esté listo, el videoId queda en `pendingId` y se carga en `onReady`.

**Auto-avance:** cuando un video termina (`onStateChange` estado 0), avanza automáticamente al siguiente track.

### API de YouTube (opcional)
Solo se usa como fallback cuando Discogs no tiene videos vinculados.
- Cuota gratuita: 10.000 unidades/día. Cada búsqueda cuesta 100 unidades + 1 de `videos.list`.
- Sin key: abre YouTube en nueva pestaña.

### Groq API (opcional)
Ordena y limpia la playlist del player con IA. Free tier más que suficiente para uso normal.

**Límites del free tier (modelo `llama-3.1-8b-instant`):**
- 30 requests/minuto
- 14.400 requests/día
- 131.072 tokens/minuto
- 500.000 tokens/día

**Consumo por reproducción:** ~700-1.100 tokens (prompt + respuesta). Equivale a ~500 reproducciones/día dentro del free tier.

**Importante para cuando se abra al público:** el límite es por API key, no por usuario. Si muchos usuarios comparten la misma key, la cuota se agota más rápido. Soluciones a futuro: cachear resultados por release ID, o pedirle a Groq más cuota.

---

## Cómo correr

**Requiere servidor HTTP local** (no doble-click en el archivo — con `file://` la YouTube IFrame API no funciona):

```powershell
cd C:\Users\PC-01\Desktop\Pablo\discogs-app
python -m http.server 8000
```

Abrir `http://localhost:8000`. Dejar la terminal abierta mientras se usa la app.

**Keys necesarias** (todas opcionales excepto el token de Discogs):
- Discogs token: `discogs.com/settings/developers` → "Generate new token"
- YouTube API key: Google Cloud Console → YouTube Data API v3 → Credentials
- Groq API key: `console.groq.com` → API Keys → Create API Key

---

## Convenciones del código

- `$('id')` es shorthand para `document.getElementById`
- `qs('selector')` es shorthand para `document.querySelector`
- `mapRelease(r)` y `mapDirectRelease(r)` normalizan los objetos de la API al formato interno
- Las colecciones siempre incluyen `favorites` (id fijo); las demás tienen id `col_<timestamp>`
- Todas las llamadas a la API de Discogs pasan por `apiGet(path, params)` que maneja auth y errores
- El módulo `Player` es un IIFE con estado privado; solo expone `{ init, play }`
- Las búsquedas usan `type: 'master'` por defecto — los IDs son master IDs. URLs de master contienen `/master/`, las de release contienen `/release/`
