# Feature 146 — Bloque C (frontend) · bitácora de implementación

Alcance de este documento: **sólo el bloque C (C1–C4) de `tasks.md`** → requisitos
**R40–R50** (campana) y **R39** (cierre de la carga masiva por interfaz, lado cliente).
El bloque A/B (modelo, migración, repositorio, servicio, Server Actions y productores) lo
implementó el agente de backend; aquí no se tocó `db/`, `lib/repositories/`, `lib/services/`,
`lib/actions/`, `lib/notificaciones/`, `db/schema.prisma` ni ninguna migración.

## Archivos

| archivo | estado |
| --- | --- |
| `hooks/useNotificaciones.ts` | nuevo (C1) |
| `components/shared/NotificationsBell.tsx` | modificado (C2) |
| `app/(app)/ordenes/_components/lote-id.ts` | nuevo (C4) |
| `app/(app)/ordenes/_components/OrdenesCargaMasivaButton.tsx` | modificado (C4) |
| `tests/components/NotificationsBell.test.tsx` | nuevo (C3, 19 tests) |
| `tests/components/OrdenesCargaMasivaNotificacion.test.tsx` | nuevo (C4, 7 tests) |

`components/shared/PageHeader.tsx` **no se modificó** (criterio de "hecho" de C2).

## Trazabilidad R → test

Todos los tests de la tabla viven en `tests/components/`.

| R | comportamiento | test |
| --- | --- | --- |
| R39 | uuid v4 válido para `z.uuid()` del backend | `OrdenesCargaMasivaNotificacion.test.tsx` › "R39: genera un uuid v4 válido para el backend (z.uuid)" |
| R39 | dos lotes no comparten identificador | idem › "R39: dos lotes distintos no comparten identificador" |
| R39 | una sola invocación al terminar la carga real, con `creadas`/`total`/`loteId` | idem › "R39: al terminar la carga real invoca la acción UNA sola vez con creadas, total y loteId" |
| R39 | ninguna invocación en `dryRun` | idem › "R39: la validación en dry-run NO avisa (nada persistido todavía)" |
| R39 | un reintento reusa el MISMO `loteId` | idem › "R39: un reintento de la confirmación reusa el MISMO loteId (idempotencia)" |
| R39 | cada carga nueva estrena su `loteId` | idem › "R39: cada carga nueva estrena su propio loteId" |
| R39/R25 | el fallo del aviso no afecta a la carga ni al resumen | idem › "R39/R25: si la acción de aviso falla, la carga y su resumen no se ven afectados" |
| R40 | sin ejemplos quemados en el componente | `NotificationsBell.test.tsx` › "R40: no queda ninguna notificación de ejemplo quemada en el componente" |
| R40 | se puebla sólo con el resultado de listar | idem › "R40: se puebla exclusivamente con el resultado de la acción de listar" |
| R40 | no inventa contenido antes de resolver | idem › "R40: sin llamada resuelta la lista no inventa contenido (estado vacío por defecto)" |
| R41 | distintivo con la cantidad de no leídas | idem › "R41: muestra el distintivo con la cantidad de no leídas" |
| R42 | `+99` por encima de 99 | idem › "R42: con más de 99 no leídas el distintivo muestra +99" |
| R43 | sin no leídas, sin distintivo | idem › "R43: sin no leídas no se muestra ningún distintivo" |
| R44 | estado vacío en lugar de la lista | idem › "R44: listado vacío → muestra 'No tienes notificaciones.' en lugar de la lista" |
| R45 | control deshabilitado sin no leídas | idem › "R45: sin no leídas el control está deshabilitado" |
| R45 | invoca la acción y deja el contador en cero sin recargar | idem › "R45: invoca la acción y deja el contador en cero sin recargar la página" |
| R46 | la X invoca descartar y retira el elemento | idem › "R46: la X invoca descartarNotificacion y retira el elemento de la lista" |
| R47 | abrir el popover revalida | idem › "R47: abrir el popover revalida el listado" |
| R47 | `refreshInterval` sale de la config (60 s) | idem › "R47: el polling usa refreshInterval de la config (60 s), no un literal suelto" |
| R47 | sin Realtime ni canal de suscripción | idem › "R47: no hay Supabase Realtime ni canal de suscripción en vivo en la campana" |
| R48 | `unauthenticated` → sin distintivo, sin romper | idem › "R48: unauthenticated → la campana renderiza sin distintivo y sin romper" |
| R48 | la acción lanza → la campana sigue en pie | idem › "R48: la acción lanza → la campana sigue en pie, sin distintivo" |
| R48 | el fallo no rompe el resto de la cabecera | idem › "R48: un fallo del listado no impide seguir mostrando el resto de la cabecera" |
| R49 | icono por tipo + descripción + anexo | idem › "R49: muestra el icono de su tipo, la descripción y el anexo" |
| R50 | `NotificationItem` es alias de `NotificacionDTO` | idem › "R50: NotificationItem es alias de NotificacionDTO y es asignable en ambos sentidos" |
| R50 | `notifications` sigue siendo prop válida (datos iniciales) | idem › "R50: `notifications` se usa como datos iniciales y la campana renderiza con ellos" |

R1–R38 quedan cubiertos por el bloque B (ver la bitácora del backend); no son alcance de este
documento.

## Decisiones de implementación

1. **El hook devuelve conjunto vacío ante error.** `useNotificaciones` usa
   `keepPreviousData` y `fallbackData`, así que `data` puede seguir poblada tras un fallo. R48
   exige explícitamente "sin distintivo", de modo que el hook fuerza `items: []` y
   `noLeidas: 0` cuando `error != null`. Se prefiere el requisito literal sobre el anti-flicker.
2. **`noLeidas` viene del servidor, no se recalcula.** El badge usa el contador de la acción
   (R30: calculado sobre el mismo conjunto filtrado). Sólo se recalcula localmente durante la
   actualización optimista de descartar/marcar todas, hasta que la revalidación lo confirma.
3. **Actualización optimista con `mutate(updater, { optimisticData, rollbackOnError })`.**
   Encapsulada en `mutateOptimista` para que el componente no conozca la API de SWR. Los
   `catch` vacíos del componente llevan comentario explicando por qué se descarta el error
   (R48: la campana no puede interrumpir al usuario ni romper la cabecera).
4. **C4 vive en `OrdenesCargaMasivaButton.tsx`, no en `OrdenesCargaUpload.tsx`.** `tasks.md`
   señalaba `OrdenesCargaUpload.tsx`, pero ese componente **sólo hace dry-run**
   (`procesarEnChunks({ dryRun: true })`); el único punto con `dryRun: false` — la carga real
   con fin de lote — es `handleConfirmar` de `OrdenesCargaMasivaButton.tsx`. Poner el aviso en
   Upload habría notificado una carga que aún no persistió nada. `tasks.md` se corrigió en su
   línea de C4.
5. **`loteId` se acuña al validar, no al confirmar.** Así un reintento de la confirmación
   (tras un fallo de red en los chunks) reusa el mismo identificador y la dedupe del servidor
   (§1.4 del design) convierte el segundo aviso en no-op. Se resetea al cerrar el modal.
6. **`nuevoLoteId` en su propio módulo** (`lote-id.ts`) con fallback manual a uuid v4: jsdom y
   los contextos no seguros pueden no exponer `crypto.randomUUID`, y el backend valida el
   formato con `z.uuid()`.
7. **No se añadió interacción de "marcar una como leída".** `marcarNotificacionLeida` existe en
   el backend (R31), pero R40–R50 no piden ese control y C2 exige "sin cambios en el JSX de la
   lista". Ver deudas.
8. **Guardias por código fuente.** Tres tests leen el fuente (ausencia de
   `EXAMPLE_NOTIFICATIONS`, `refreshInterval` desde la config, ausencia de Realtime/canal). Son
   la única forma de fijar un requisito de "NO debe existir X" (R40, R47).

## Verificación

- `pnpm typecheck`: **2 errores**, ambos **preexistentes de `dev`** y ajenos a esta feature
  (`tests/components/GestionarOrdenPanelEvidencias.test.tsx:84` y
  `tests/components/NotaPrivadaMensajero.test.tsx:253`, prop `count`). Delta 0.
- Suite de `tests/components` + las páginas de `tests/integration` que montan `PageHeader`
  (110 archivos, 999 tests): **14 fallos en 4 archivos**, todos preexistentes de `dev`
  (`DataTable`, `MarcarLuegoToggle`, `MisAsignacionesModule`, `NotaPrivadaMensajero`).
  Delta 0 en rojos; +26 tests verdes nuevos.
- `tests/components/NotificationsBell.test.tsx`: 19/19 verdes.
- `tests/components/OrdenesCargaMasivaNotificacion.test.tsx`: 7/7 verdes.
- `tests/components/OrdenesCargaMasivaButton.test.tsx` (existente, no modificado): sigue verde
  con el productor añadido.

## Deudas conocidas

1. **Sin control de "marcar una como leída" en la UI.** La acción `marcarNotificacionLeida`
   queda sin consumidor de interfaz. Hoy una notificación sólo pasa a leída vía "marcar todas"
   o al descartarla. Es coherente con el JSX congelado por C2, pero deja una acción del backend
   sin superficie.
2. **La campana hace I/O en toda página** (está en `PageHeader`, Riesgo 6 del design). Mitigado
   con `fallbackData`, fallo silencioso y una consulta indexada, pero cada página autenticada
   arranca un polling de 60 s por pestaña abierta.
3. **`components/shared/PageHeader.tsx` no pasa `notifications`**, así que el primer render de
   cada página muestra la campana sin datos hasta que resuelve la acción. Servir los datos
   desde un Server Component padre exigiría mover la campana a `components/private/`, lo que el
   design descarta explícitamente (§2) por incompatibilidad con el polling en cliente.
4. **Sin paginación ni "ver todas"** (fuera de alcance, design §7): con `PAGE_SIZE = 50` el
   popover trunca en silencio si un usuario acumula más de 50 sin descartar.
