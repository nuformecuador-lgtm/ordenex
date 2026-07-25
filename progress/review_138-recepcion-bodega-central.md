# Review — Feature 138 · Recepción en bodega central

> Reviewer (verifica, no edita). Rama `feature/138-recepcion-bodega-central`
> (commits `ba44bdf` backend, `7a13e28` frontend). Re-verificado de forma independiente.

## Veredicto: **APROBADO-CON-NOTAS**

Sin bloqueantes técnicos. R1–R18 trazados a tests reales que ejercen lo que afirman.
Capas separadas, guardas correctas, migración aditiva reversible. Quedan notas de
bookkeeping/deuda a cerrar antes de flipear a `done` (no requieren tocar código).

---

## Checklist CHECKPOINTS

- [x] requirements.md con R1–R18 (EARS numerados).
- [x] design.md con alternativas descartadas (§6.1/6.2/6.3).
- [ ] **tasks.md con todas las tasks `[x]`** — TODAS (T0–T12) siguen `[ ]` (menor/bookkeeping).
- [x] Cada `R<n>` mapea a ≥1 test concreto (ver tabla).
- [x] `progress/impl_138-...md` contiene el mapa `R<n> → test`.
- [x] `pnpm run typecheck` → 0 errores (re-corrido).
- [x] `pnpm run lint` sobre archivos de la feature → limpio (re-corrido).
- [x] `pnpm test` de los archivos de 138 + terceros modificados → verdes (51+73+126 re-corridos).
- [~] E2E de flujo crítico: sin spec Playwright. Consistente con precedente reciente
      (106 cancelacion-api, 109 corte NO tienen E2E dedicado; los stubs 33/devolucion-origen
      no se ejecutan en CI). Nota, no bloqueante.
- [x] RLS: sin tabla nueva; `orden`/`orden_historial_estado` conservan su RLS (feature 49). Sin concern nuevo.
- [x] Migración con `down.sql`; reversibilidad verificada por test estático (round-trip real = deuda, ver nota).
- [x] Sin secretos hardcodeados; sin hardcode de país/moneda/contexto.
- [x] Webhook: vía choke point existente `appendCambioEstado` (misma tx, outbox); sin punto de emisión nuevo.
- [x] Controller sin queries/negocio; Service sin HTTP/Prisma; Repo solo Prisma; interfaces en `lib/interfaces/`.
- [x] Página protegida valida rol server-side (`page.tsx` gate `esAccesoTotal`); mutación por Server Action.

## Trazabilidad R1–R18 (COMPLETA)

Dominio/borde (R1–R11,R17,R18) en `tests/unit/services/recepcion-bodega-central-service.test.ts`,
`tests/unit/repositories/orden-repository.recepcion-bodega-central.test.ts`,
`tests/unit/actions/recepcion-bodega-central-action.test.ts`,
`tests/integration/db/orden-historial-origen-recepcion-bodega-central-migration.test.ts`.
UI (R12–R16) en `tests/components/EscanerRecepcionBodegaCentral.test.tsx` y
`tests/components/OrdenesPage.test.tsx`.

| R | Estado | Test |
|---|--------|------|
| R1 | OK | service `R2: ok — transiciona ...` |
| R2 | OK | service ok (maestro+admin) · repo `R2/R11/R18: UPDATE guardado ... true si 1 fila` |
| R3 | OK | repo `R3/R17: deja 1 historial ...` + `R3: envuelve en UNA transaccion` |
| R4 | OK | service it.each adminTienda/adminSatelite/mensajero → forbidden, sin escritura |
| R5 | OK | action `R5: sin actor -> unauthenticated, sin tocar el service` |
| R6 | OK | service no_encontrada (inexistente + borrada) |
| R7 | OK | service `R7: ya_recibida ... idempotente, sin escritura` |
| R8 | OK | service estado_invalido (en_ruta + en_bodega_satelite) lleva el estado |
| R9 | OK | service (pierde carrera → ya_recibida / conflict) · repo `false si count 0; NO deja rastro` |
| R10 | OK | action it.each (no numérico/cero/negativo/decimal/ausente) + componente corte cliente |
| R11 | OK | service CUALQUIER zona/tienda · repo where + pre-lectura SIN zonaId/tiendaId |
| R12 | OK | componente R13 (cámara) + R12b (manual) |
| R13 | OK | componente decodifica `/paquete/<numGuia>` → numGuia |
| R14 | OK | componente onRecibida en ok/ya_recibida; wiring `onRecibida={handleSuccess}` |
| R15 | OK | componente toast por los 8 estados |
| R16 | OK | page: visible maestro/admin, NO adminTienda ni sin sesión |
| R17 | OK | repo origenTipo `recepcion_bodega_central` + migración SEED/UP + cobertura #21 |
| R18 | OK | repo: data sin mensajeroAsignadoId ni numGuia |

## Verificación de las guardas del service (orden exigido)

`RecepcionBodegaCentralService.ts`: rol(forbidden) → no_encontrada → ya_recibida(idempotente,
sin escritura) → estado_invalido(con estado) → catálogo(validation_error) → transición → race
(re-lee: ya_recibida/conflict). SIN guarda de zona/tienda (R11). La defensa real de concurrencia
va en el `updateMany` guardado por estado de origen + `deletedAt: null` del repo (append de
historial SOLO si `count === 1`; nunca doble entrada). Espejo correcto de `recibirEnOrigen` sin la
guarda de tienda. No toca `num_guia`/`mensajero_asignado_id`.

## Consistencia de la migración de enum

- `migration.sql`: `ADD VALUE IF NOT EXISTS 'recepcion_bodega_central'` (va sola, aditiva).
- `down.sql`: recrea el tipo con los 20 valores previos (sin el nuevo) + `USING`; lista verificada
  contra el SEED (fuente única) por el test estático.
- `db/schema.prisma` (enum Prisma) + `lib/types/orden-historial.ts` (SEED, `satisfies`/`_EnsureExhaustive`) al día.
- Terceros consistentes: 5 fakes de `IOrdenRepository`, cobertura punto #21 (20→21),
  types-test (20→21), 4 tests estáticos de down previos (67/99/100/106 excluyen el nuevo),
  allowlist `zonas-migration`. Todos re-corridos en verde.

## Dictamen de los 2 puntos a evaluar

1. **Migración real diferida (up/down contra Postgres NO aplicado).** ACEPTABLE como deuda
   post-merge documentada. Es un `ADD VALUE` aditivo (el tipo de migración de menor riesgo), el
   `down.sql` copia un patrón ya aplicado (`carga_api`/`resolver_novedad`), la lista de valores
   está verificada contra la fuente única por test estático, y es el mismo criterio con que la
   dependencia 137 (y 106/100/99) entraron a dev. No bloquea. Debe descargarse post-merge (aplicar
   `db:migrate`/`db:rollback` con DB real).

2. **`<Input type="number">` sin `min`/`step`.** CORRECTO, no es hueco. Quitar `min`/`step` evita
   que la validación nativa del form bloquee el submit de "0"/negativos ANTES del guard JS; la
   validación de entero positivo la hace `enviarManual` (`Number.isSafeInteger && > 0`), coherente
   con el borde zod de la action (R10). Los tests confirman el corte cliente de "0"/vacío/decimal
   sin llamar a la acción. `type="number"` conserva el teclado numérico.

## Hallazgos

- **menor (bookkeeping):** `specs/138-recepcion-bodega-central/tasks.md:9-86` — T0–T12 siguen `[ ]`
  pese a estar hechos (cada uno con su "Hecho:" cumplido y verificado). CHECKPOINTS exige todas
  `[x]`: marcarlas antes de `done`. Solo edición del md, sin código.
- **menor:** sin spec E2E Playwright. Los hermanos antiguos (recepción satélite 33, devolución
  origen) tienen stub E2E, pero no se ejecuta en CI y las features de transición recientes (106,
  109) no traen E2E. Consistente con el precedente actual; opcional añadir un stub por paridad.
- **menor (cosmético):** cuerpos de `design.md`/`tasks.md` citan numeración vieja (136/135) y
  `impl_136...md`; artefacto de la renumeración ya advertido en `requirements.md`. Sin impacto.
- **pendiente de done (leader):** entrada en `progress/history.md`.

