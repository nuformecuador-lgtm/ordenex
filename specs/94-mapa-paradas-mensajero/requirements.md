# Feature 94 — Mapa de paradas + ubicación viva del mensajero · requirements

> Notación EARS (`docs/specs.md`). Sin detalles de implementación (esos van en `design.md`).
> Cada `R<n>` es testeable y está mapeado a un test en la tabla de trazabilidad.

Base asumida: `origin/dev` **después** del merge de la 92 (PR #98) y la 93. De ahí vienen
`MiAsignacionDTO.secuenciaRuta`, `ruta.paradasSinOptimizar` y el módulo `MisAsignacionesModule`
ya reordenado. Esta feature es el **primer consumidor** de `Orden.latitud/longitud` (escritas por
la 91) y añade su propio toque backend: exponerlas en el DTO del mensajero. **Sin migración** (las
columnas ya existen en `dev`).

Alcance "modo navegación" (decisión del humano, 2026-07-21): **ubicación viva + paradas numeradas**.
FUERA: polilínea de ruta, turn-by-turn / Directions/Navigation SDK, botón "Cómo llegar" externo.

---

## Backend — exponer coordenadas en el DTO del mensajero

**R1** — El sistema DEBE exponer `latitud` y `longitud` de cada orden en `MiAsignacionDTO`, como
`number | null`, serializadas desde `Decimal(10,7)` a `number` cuando la columna tiene valor y a
`null` cuando está vacía.

**R2** — MIENTRAS se listan las asignaciones del mensajero, el sistema DEBE poblar `latitud`/`longitud`
en cada DTO de `porGestionar` y `porRecoger` sin alterar el resto del contrato existente
(`secuenciaRuta`, `ruta`, orden de las cards).

## Render del mapa

**R3** — El sistema DEBE renderizar el mapa SOLO cuando el rol del actor es `mensajero` (mismo
criterio de visibilidad del resto del módulo).

**R4** — SI una orden en reparto tiene `latitud` y `longitud` no nulas, ENTONCES el sistema DEBE
mostrar en el mapa un marcador para esa parada situado en esas coordenadas.

**R5** — El sistema DEBE etiquetar cada marcador de parada con su `secuenciaRuta` (1-based),
coincidiendo con el número mostrado en la card correspondiente del listado.

**R6** — SI una parada tiene `secuenciaRuta = null` (entró después de la última optimización),
ENTONCES el sistema DEBE mostrar su marcador de forma visualmente distinguible de las que tienen
posición (sin número de secuencia), en coherencia con el tratamiento "pendiente de optimizar" del
listado.

**R7** — SI una orden en reparto NO tiene `latitud` o `longitud`, ENTONCES el sistema DEBE omitirla
del mapa y señalar de forma visible cuántas paradas quedaron sin ubicar, sin romper el render del
mapa ni del resto del módulo.

**R8** — MIENTRAS haya al menos una parada con coordenadas, el sistema DEBE ajustar el encuadre
(centro/zoom) para que todas las paradas con coordenadas queden visibles.

**R9** — SI no hay ninguna parada con coordenadas ni ubicación viva disponible, ENTONCES el sistema
DEBE mostrar el mapa con un encuadre por defecto definido (centro y zoom fallback), sin quedar en
blanco ni romper.

## Ubicación viva del mensajero

**R10** — MIENTRAS el mapa está montado y el permiso de geolocalización está concedido, el sistema
DEBE mostrar un marcador de la ubicación del mensajero obtenido de `navigator.geolocation.watchPosition`.

**R11** — CUANDO `watchPosition` entrega una nueva posición, el sistema DEBE reposicionar el marcador
de ubicación viva a las nuevas coordenadas.

**R12** — SI el permiso de geolocalización es denegado, ENTONCES el sistema DEBE seguir mostrando el
mapa con las paradas, omitir el marcador de ubicación viva y avisar de forma no bloqueante.

**R13** — SI la geolocalización falla o expira (timeout / posición no disponible), ENTONCES el
sistema DEBE comportarse igual que ante la denegación (paradas visibles, sin marcador propio) sin
romper.

**R14** — CUANDO el componente de mapa se desmonta, el sistema DEBE invocar `clearWatch` sobre el
watcher activo (si existe), sin fugar el watcher.

## Configuración y carga del SDK

**R15** — SI la API key de navegador de Google Maps no está configurada, ENTONCES el sistema DEBE
degradar a un placeholder/aviso visible en lugar del mapa y NO romper la pantalla ni el resto del
módulo (patrón `loadXConfig`: ausencia de key → estado degradado, nunca excepción).

**R16** — El sistema DEBE cargar el SDK de Google Maps JS de forma idempotente: aunque el componente
se monte/desmonte varias veces, el script del proveedor NO debe inyectarse ni evaluarse más de una
vez por sesión de página.

---

## Trazabilidad requisito → test

| Req | Comportamiento | Test |
| --- | --- | --- |
| R1 | DTO expone `latitud`/`longitud` (Decimal→number, null-safe) | `tests/unit/repositories/gestion-orden-repository-asignaciones.test.ts` |
| R2 | Poblado en `porGestionar`/`porRecoger` sin romper el resto del contrato | `tests/unit/services/mis-asignaciones-dto-coordenadas.test.ts` |
| R3 | Mapa solo para rol `mensajero` | `tests/components/MisAsignacionesModule.test.tsx` |
| R4 | Marcador por parada con coordenadas | `tests/components/MapaParadasMensajero.test.tsx` |
| R5 | Marcador numerado por `secuenciaRuta` | `tests/components/MapaParadasMensajero.test.tsx` |
| R6 | `secuenciaRuta = null` distinguible | `tests/components/MapaParadasMensajero.test.tsx` |
| R7 | Orden sin coordenadas omitida + señalada | `tests/components/MapaParadasMensajero.test.tsx` |
| R8 | Encuadre a las paradas con coordenadas | `tests/components/MapaParadasMensajero.test.tsx` |
| R9 | Encuadre fallback sin coordenadas ni ubicación | `tests/components/MapaParadasMensajero.test.tsx` |
| R10 | Marcador de ubicación viva (permiso concedido) | `tests/components/MapaParadasMensajero.test.tsx` |
| R11 | Reposiciona el marcador al llegar nueva posición | `tests/components/MapaParadasMensajero.test.tsx` |
| R12 | Permiso denegado → paradas sin marcador propio + aviso | `tests/components/MapaParadasMensajero.test.tsx` |
| R13 | Fallo/timeout → igual que denegado | `tests/components/MapaParadasMensajero.test.tsx` |
| R14 | `clearWatch` al desmontar | `tests/components/MapaParadasMensajero.test.tsx` |
| R15 | Sin key → placeholder, no rompe | `tests/components/MapaParadasMensajero.test.tsx` + `tests/unit/config/maps-config.test.ts` |
| R16 | Loader del SDK idempotente | `tests/unit/lib/maps-loader.test.ts` (o dentro del test de componente con loader mockeado) |

---

## Correcciones a la premisa del briefing (precedente 78/73/91/92)

1. **`.env.example` SÍ EXISTE** en `dev`. El briefing de la 94 afirma "la 91 halló que NO existe" —
   esa observación caducó: el archivo está presente y ya trae la sección "Google Route Optimization
   (Feature 92)". → La key de navegador de esta feature se documenta **añadiendo una entrada
   comentada** a ese archivo (task T2), no inventando uno nuevo.

2. **El hook `useUbicacionActual` NO sirve para la ubicación viva.** Verificado: usa
   `getCurrentPosition` (one-shot) y devuelve una única `Coords`; no observa el movimiento. La
   ubicación viva (R10/R11) exige `watchPosition`, que ese hook no expone. → Se necesita un hook
   nuevo (`useUbicacionEnVivo`), NO se "reutiliza" el de la 93 para el marcador vivo. El permiso del
   navegador sí se comparte por origen (una vez concedido para el botón de sync, `watchPosition` no
   vuelve a promptear), así que no hay doble solicitud de permiso, solo dos consumidores del mismo
   grant (ver Q5).

3. **La rama `flow` tiene WIP sucio** (marcadores de conflicto en `mis-asignaciones/page.tsx`,
   `console.log("xyz...")` en `MisAsignacionesModule.tsx`). La 94 nace de `origin/dev` limpio
   DESPUÉS del merge de la 93, en worktree aislado — NO sobre `flow`.

---

## Preguntas abiertas para el gate F1.4

- **Q1 (proceso)** — Ratificar **NO PARTIR** la feature: fullstack dominante-frontend, backend =
  +2 campos en el DTO (R1/R2), orquestada directo por el leader (patrón 69/73/82/89). Alternativa:
  partir en backend (R1/R2) + frontend (R3-R16).
- **Q2 (hecho + decisión)** — Nombre exacto de la key de navegador. Propuesto:
  `NEXT_PUBLIC_GOOGLE_MAPS_JS_API_KEY`. Es un SKU distinto: NO reutiliza `GOOGLE_MAPS_API_KEY`
  (server-side, Geocoding, 91) ni la service account (92). Se documenta añadiendo entrada comentada
  a `.env.example` (que SÍ existe, ver corrección 1). Restricción por HTTP referrer (dominio) es
  responsabilidad de despliegue (GCP Console), no del código → se documenta, no se testea.
- **Q3 (negocio)** — Centro/zoom del encuadre fallback (R9) cuando no hay ninguna coordenada ni
  ubicación viva. Propuesto: centrar en el área de operación (p. ej. San José / Gran Área
  Metropolitana) con un zoom medio. A confirmar por el humano.
- **Q4 (técnico)** — `watchPosition` continuo (R10/R11, marcador que sigue al mensajero, mayor coste
  de batería) vs `getCurrentPosition` puntual + refresco manual. Propuesto: `watchPosition` (es el
  "modo navegación" pedido), con `clearWatch` al desmontar (R14) para acotar el coste.
- **Q5 (hecho + decisión)** — Reúso del permiso de geolocalización con el botón de sync de la 93:
  ambos consumen el mismo grant por origen (no hay doble prompt), pero son mecanismos distintos
  (`getCurrentPosition` vs `watchPosition`). ¿Se acepta tener dos consumidores del permiso, o se
  quiere unificar la captura en un solo hook/provider? Propuesto: aceptar dos consumidores (acoplarlos
  añade estado compartido para poco beneficio); no se toca `useUbicacionActual` ni el botón de la 93.
- **Q6 (técnico)** — Librería de carga del mapa: `@googlemaps/js-api-loader` (oficial, imperativo)
  vs wrapper React (`@vis.gl/react-google-maps`). Propuesto: loader oficial (menos dependencia para
  el primer y único mapa del repo). Ver `design.md §Alternativas`.
</content>
</invoke>
