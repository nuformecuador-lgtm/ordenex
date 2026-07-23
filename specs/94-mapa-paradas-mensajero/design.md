# Feature 94 — Mapa de paradas + ubicación viva del mensajero · design

Base: `origin/dev` **tras** el merge de la 92 (PR #98) y la 93. Zona `fullstack`, dominante-frontend.
El grueso es UI (primer componente de mapa del repo). El backend es mínimo: +2 campos en el DTO del
mensajero, **sin migración** (las columnas `latitud`/`longitud` ya existen desde la 91).

Proveedor: **Google Maps JavaScript API** (decisión del humano, 2026-07-21). Es un SKU/producto
distinto del Geocoding (91) y del Route Optimization (92): requiere habilitar *Maps JavaScript API*
en GCP y una **API key de navegador** restringida por HTTP referrer, expuesta al cliente
(`NEXT_PUBLIC_...`). NO reutiliza `GOOGLE_MAPS_API_KEY` (server-side) ni la service account.

---

## §1 — Toque backend: `latitud`/`longitud` en el DTO del mensajero (R1/R2)

Único cambio de datos. Las coordenadas ya se leen en la misma query; solo hay que seleccionarlas y
mapearlas.

- `lib/repositories/GestionOrdenRepository.ts`
  - `WITH_ASIGNACION.select`: añadir `latitud: true, longitud: true`.
  - `toMiAsignacionRow`: `latitud: row.latitud ? row.latitud.toNumber() : null` y el equivalente para
    `longitud` (mismo patrón que `peso`/`montoCobrar`, verificado `:61-62`). Prisma entrega los
    `Decimal(10,7)` como objeto `Decimal`; `toNumber()` los serializa. Aceptar la pérdida de
    precisión de `number` es correcto aquí: 7 decimales de grado caben de sobra en `double`.
- `MiAsignacionRow` (tipo interno del repo): + `latitud: number | null`, `longitud: number | null`.
- `lib/interfaces/services/IMisAsignacionesService.ts` → `MiAsignacionDTO`: + `latitud`/`longitud`
  con el mismo tipo y comentario de origen. `MisAsignacionesService` los propaga sin transformarlos
  (ya vienen serializados del repo); no cambia el reordenado ni los KPIs.

**Contrato resultante** (lo consume el mapa): cada `MiAsignacionDTO` de `porGestionar` trae
`{ ...existente, secuenciaRuta: number|null, latitud: number|null, longitud: number|null }`.

Sin índice nuevo sobre `(latitud, longitud)`: el acceso es por `mensajeroAsignadoId` (ya indexado) y
las coordenadas se leen de las filas ya seleccionadas (misma decisión que la 92 §1.3).

## §2 — Configuración de la key (R15)

`lib/config/maps.ts` → `loadMapsConfig()`, clon estructural de `lib/config/route-optimization.ts`:
lee `process.env` en cada llamada, **nunca lanza**, key ausente/vacía → `null`.

```ts
export interface MapsConfig { googleMapsJsApiKey: string | null; }
export function loadMapsConfig(): MapsConfig {
  const raw = process.env.NEXT_PUBLIC_GOOGLE_MAPS_JS_API_KEY;
  return { googleMapsJsApiKey: raw !== undefined && raw !== "" ? raw : null };
}
```

Matiz de Next.js: las vars `NEXT_PUBLIC_*` se **inlinean en build**; `process.env.NEXT_PUBLIC_...` es
legible en el cliente. El componente lee la config (o la recibe por prop desde el Server Component
padre, ver §4) y decide entre renderizar el mapa o el placeholder degradado (R15).

Documentación de la key: **añadir entrada comentada a `.env.example`** (que SÍ existe, ver
`requirements.md` corrección 1), en una sección nueva "Google Maps JavaScript API (Feature 94)":

```
# NEXT_PUBLIC_GOOGLE_MAPS_JS_API_KEY="AIza..."   # API key de NAVEGADOR, restringida por HTTP referrer.
#   Habilitar "Maps JavaScript API" en GCP. Distinta de GOOGLE_MAPS_API_KEY (Geocoding, server-side).
```

Restricción por referrer y habilitación del SKU: pasos de despliegue en GCP Console, se documentan
aquí; no son testeables en el repo.

## §3 — Carga del SDK (R16)

`lib/maps/loader.ts`: wrapper delgado sobre `@googlemaps/js-api-loader` (`Loader`) que expone
`loadGoogleMaps(apiKey): Promise<typeof google.maps>`. El `Loader` es idempotente por diseño (cachea
la promesa; una segunda llamada con la misma key no reinyecta el `<script>`), lo que satisface R16
sin lógica propia de deduplicación. `fetch`/objeto `google` se dejan mockeables para el test del
componente (se inyecta un loader falso o se stubbea el módulo).

**No se carga en `app/layout.tsx`** (no todas las páginas necesitan el mapa; sería peso muerto para
maestro/tienda). Se carga bajo demanda cuando se monta el componente del mapa.

## §4 — Componente del mapa

`app/(app)/mis-asignaciones/_components/MapaParadasMensajero.tsx` (`"use client"`). Vive junto a la
página (regla anti-sobre-ingeniería de `docs/architecture.md`: se usa en un solo lugar).

Props:
```ts
interface MapaParadasMensajeroProps {
  paradas: MiAsignacionDTO[];   // = porGestionar (ya ordenado por el servidor)
  apiKey: string | null;        // de loadMapsConfig, bajado por el Server Component padre
}
```

Se inserta en `MisAsignacionesModule.tsx`, dentro de la sección `aria-label="En reparto / por
gestionar"`, sobre la grilla de cards. El módulo ya recibe `porGestionar` y `rol`; el mapa se
renderiza dentro del mismo guard `rol === "mensajero"` que el botón de sync (R3). La `apiKey` se
añade como prop del módulo, resuelta en `page.tsx` con `loadMapsConfig()` (Server Component) y bajada
por props (patrón de datos server→props del repo).

Lógica interna (imperativa, vía `useRef` + `useEffect`):
1. Si `apiKey === null` → render del **placeholder degradado** (R15), sin cargar nada.
2. `loadGoogleMaps(apiKey)` → crear `google.maps.Map` sobre el `div` referenciado.
3. **Marcadores de parada (R4/R5/R6):** por cada `parada` con `latitud`/`longitud` no nulas, un
   marcador (`AdvancedMarkerElement` o `Marker`) etiquetado con `secuenciaRuta` cuando no es `null`;
   cuando es `null`, un marcador de estilo distinto (sin número, atenuado) → "pendiente de optimizar".
4. **Paradas sin coordenadas (R7):** se excluyen del bucle de marcadores; se cuenta cuántas y se
   muestra un aviso (`role="status"`) del tipo "N parada(s) sin ubicación en el mapa".
5. **Encuadre (R8/R9):** con ≥1 parada con coordenadas → `LatLngBounds` + `fitBounds`. Sin ninguna
   coordenada ni ubicación viva → `center`/`zoom` por defecto (Q3, p. ej. Gran Área Metropolitana).
6. **Ubicación viva (R10-R14):** hook `useUbicacionEnVivo` (§5). Un marcador propio distinto de los
   de parada; se reposiciona en cada actualización (R11); ausente si el permiso se denegó o falló
   (R12/R13), con aviso no bloqueante.

El componente NO reordena nada ni deriva estado de ruta: solo pinta `paradas` en el orden recibido.

## §5 — Hook de ubicación viva (R10-R14)

`hooks/useUbicacionEnVivo.ts` (`"use client"`), NUEVO — **no** se reutiliza `useUbicacionActual`
(one-shot `getCurrentPosition`, ver `requirements.md` corrección 2). Contrato:

```ts
interface UbicacionEnVivo {
  coords: { lat: number; lng: number } | null;  // null hasta la 1a fix; o si denegado/timeout
  estado: "inactivo" | "siguiendo" | "denegado" | "error";
}
function useUbicacionEnVivo(): UbicacionEnVivo;
```

- Al montar: `navigator.geolocation.watchPosition(onOk, onErr, opts)`.
- `onOk` → actualiza `coords` (R11), `estado = "siguiendo"`.
- `onErr` con `code === 1` (PERMISSION_DENIED) → `estado = "denegado"` (R12); otros códigos /
  timeout → `estado = "error"` (R13). En ambos `coords` queda `null` y **no** se lanza ni bloquea.
- Al desmontar: `clearWatch(watchId)` (R14). `watchId` guardado en `useRef`; guard para no llamar
  `clearWatch` si nunca se inició o si `geolocation` no existe.
- `navigator.geolocation` se mockea en el test de componente.

Igual que el hook de la 93, este hook **nunca** aborta el resto del módulo: la ausencia de ubicación
viva solo quita el marcador propio, jamás las paradas.

## §6 — Fuera de alcance (features futuras, anotadas)

- Polilínea de la ruta entre paradas.
- Indicaciones giro-a-giro (Directions API / Navigation SDK).
- Botón "Cómo llegar" que abra Google Maps / Waze externo.
- Mapa en otras pantallas (maestro, adminTienda, `/paquete/[numGuia]`).
- Cualquier cambio en el gate de asignabilidad, la optimización de ruta, el encolado o el cliente de
  Route Optimization (todo eso es 92).

---

## §7 — Alternativas descartadas

### A. Wrapper React (`@vis.gl/react-google-maps` / `@react-google-maps/api`) — DESCARTADA

Ergonómico: componentes `<Map>`/`<Marker>` declarativos, sin `useEffect`/`useRef` imperativos.
Descartada para el primer y único mapa del repo: añade una dependencia mayor (y su ciclo de
versiones) sobre `@googlemaps/js-api-loader`, que es lo mínimo para cargar el SDK. El alcance
"modo navegación" (paradas + un marcador vivo, sin polilínea ni rutas) es simple y no justifica la
abstracción. Si en el futuro entran polilínea/turn-by-turn (features futuras §6), se puede
reconsiderar: el cambio quedaría contenido en `MapaParadasMensajero.tsx`. → **Q6**.

### B. Cargar el SDK global en `app/layout.tsx` con `next/script` — DESCARTADA

Reutilizaría el patrón `Script` que el layout ya usa para el service worker. Descartada por dos
motivos: (1) cargaría el SDK de Maps (y facturaría/pesaría) en **todas** las páginas, incluidas las
de maestro/tienda que no tienen mapa; (2) `next/script` no expone una promesa de "SDK listo" limpia:
habría que colgarse de un callback global y deduplicar a mano, justo lo que `js-api-loader` ya
resuelve. Se carga bajo demanda al montar el mapa (§3).

### C. Nueva Server Action / endpoint para las coordenadas — DESCARTADA

Exponer las coordenadas por un canal aparte (p. ej. `getCoordenadasParadas()`). Descartada: las
coordenadas viven en la MISMA fila que ya trae `listarMisAsignaciones` y llegan por el MISMO camino
Server Component → props que el resto del listado. Un segundo round-trip (o SWR de cliente)
duplicaría la query y rompería el patrón "el módulo no fetchea del cliente". Ampliar el DTO (§1) es
más barato y más coherente.

### D. Reutilizar `useUbicacionActual` (de la 93) para el marcador vivo — DESCARTADA

Menos código nuevo. Descartada porque ese hook usa `getCurrentPosition` (one-shot): no observa el
movimiento, así que el marcador nunca se actualizaría (rompería R11). Adaptarlo a `watchPosition`
cambiaría su contrato y afectaría al botón de sync de la 93, que depende de su forma actual. Un hook
hermano (`useUbicacionEnVivo`, §5) aísla el nuevo comportamiento sin tocar la 93. El permiso del
navegador se comparte por origen, así que no hay doble prompt (ver Q5).

### E. Persistir la posición viva en backend / mostrarla a terceros — DESCARTADA

Fuera de alcance: "modo navegación" es solo para el propio mensajero, en su cliente. La 92 ya
persiste una `origen_lat/lng` para calcular la ruta; el marcador vivo del mapa es efímero y no
necesita viajar al servidor. Enviarlo sería telemetría de ubicación de una persona sin caso de uso
pedido.

---

## §8 — Preguntas abiertas

Ver `requirements.md` → "Preguntas abiertas para el gate F1.4" (Q1-Q6). Las de mayor peso de diseño:
- **Q3** (centro/zoom fallback, criterio de negocio),
- **Q4** (`watchPosition` continuo vs puntual, coste de batería),
- **Q6** (loader oficial vs wrapper React).
</content>
