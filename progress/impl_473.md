# 473 — Corregir la recepción de dinero de una satélite · bitácora de implementación (BACKEND)

> Alcance de esta entrega: T1-T4 (backend). T5 (UI) queda para frontend_dev. Rama
> `feature/473-corregir-recepcion-satelite`, nacida de `origin/dev` @ `02fb4bee`.
> Spec aprobado con D1 (reusar `cierre_bodega_conciliado`, sin migración) y D3/D2 (la corrección
> mueve `conciliado_at`/`resuelto_at`).

## Archivos

Código:
- `lib/interfaces/repositories/ICierresBodegaAdminRepository.ts` — `CorregirConciliacionInput` y `corregirConciliacion(...)`.
- `lib/repositories/CierresBodegaAdminRepository.ts` — `corregirConciliacion` (tx propia: lee previo → `updateMany` con `estado: aprobado`, `conciliadoAt: {not: null}`, `montoRecibido: previo` → `appendAccion(tx, …)` con `valorAnterior`/`valorNuevo`, sin nota).
- `lib/interfaces/services/IConciliacionSatelitesService.ts` — `corregirRecibida`.
- `lib/services/ConciliacionSatelitesService.ts` — `Pick` ampliado + `corregirRecibida` (guard primero).
- `lib/actions/conciliacion-satelites.ts` — `corregirConsolidacionRecibidaAction`.

Tests:
- `tests/integration/db/corregir-conciliacion.int.test.ts` (NUEVO, 10 casos).
- `tests/unit/repositories/cierres-bodega-admin-marca.test.ts` (+7 casos 473/T1).
- `tests/unit/services/conciliacion-satelites-service.test.ts` (+11 casos 473/T3, fake ampliado).
- `tests/unit/actions/conciliacion-satelites-actions.test.ts` (+11 casos 473/T4, fake ampliado).
- `tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts` (entrada `corregirConciliacion`; el 65 NO cambia).
- Fakes que dejaban de compilar: `tests/unit/services/cierres-bodega-admin-service.test.ts`, `tests/integration/db/_fixtures/wallet-458.ts`.

Sin migraciones, sin `lib/types/`, sin tablas ni columnas nuevas.

## Contrato de la action para frontend_dev (T5)

```ts
import { corregirConsolidacionRecibidaAction } from "@/lib/actions/conciliacion-satelites";
import type { MarcaConciliacionActionResult } from "@/lib/actions/conciliacion-satelites";

corregirConsolidacionRecibidaAction(input: unknown): Promise<MarcaConciliacionActionResult>
```

- **Input**: el MISMO de `marcarConsolidacionRecibidaAction` (mismo schema `marcarConsolidacionRecibidaSchema`, `.strict()`):
  `{ cierreBodegaId: string /* uuid */, montoRecibido: string /* > 0, ≤ 2 decimales */, nota?: string /* trim, 1..500 */ }`.
  Ninguna clave más (una clave extra → `validation_error`).
- **Resultados** (`MarcaConciliacionActionResult`, sin tipo nuevo):
  - `{ status: "ok", cierreBodegaId }` — corregido; la consolidación sigue conciliada con el monto nuevo.
  - `{ status: "conflict" }` — ya no estaba conciliada (alguien la desmarcó/está pendiente/rechazada) o su monto cambió entre lectura y escritura.
  - `{ status: "no_encontrada" }` — el id no existe.
  - `{ status: "forbidden" }` — el actor no es `esAccesoTotal`.
  - `{ status: "unauthenticated" }` — sin sesión.
  - `{ status: "validation_error", fieldErrors }` — entrada inválida. Ojo: la clave colada la reporta zod como error de formulario, así que en ese caso `fieldErrors` llega `{}` (mismo comportamiento que hoy tiene marcar).
- La guardia `superficie-de-uso` está **roja** hasta que T5 monte la action en `ConciliacionAcciones.tsx` (previsto en `tasks.md` T4). No se añadió `@sin-superficie` (design §2.3 lo prohíbe).
- Mocks a actualizar en T5: `tests/integration/wallet-satelites.test.tsx` y, si el gate lo pide, los `vi.mock("@/lib/actions/conciliacion-satelites")` de `tests/components/*` y `tests/unit/guards/wallet-sin-uuid.guardia.test.tsx`.

## Mapa R → test (backend)

| R | Test | Resultado |
|---|---|---|
| R1 | `corregir-conciliacion.int.test.ts` · «R1: corregir una incompleta cambia el monto y la deja conciliada…» + unit «R1/R2/R3: escribe monto nuevo… NO toca `estado`» | verde |
| R2 | int · «R2: la corrección reescribe conciliado_por/conciliado_at y el espejo resuelto_*» (dos usuarios distintos, marca envejecida a 2026-01-01) | verde |
| R3 | int · «R3: la nota se sustituye; sin nota queda NULL» + unit «R3: sin nota, la escribe como NULL» | verde |
| R4 | int · «R4: deja exactamente UNA fila cierre_bodega_conciliado…» + unit «R4: corregirConciliacion registra el monto nuevo y el anterior y no la nota» | verde |
| R5 | guardia del censo · `CierresBodegaAdminRepository.ts#corregirConciliacion registra su accion en la misma transaccion que la escribe` | verde (roja con mutación 4) |
| R6 | int · «R6: sobre una pendiente…» y «R6: sobre una rechazada responde conflict y no escribe nada» | verde |
| R7 | int · «R7: sobre un id inexistente responde fuera_de_alcance» + unit repo «R7: la fila no existe…» + servicio «R7 corregir: fuera_de_alcance se traduce a no_encontrada» | verde |
| R8 | unit repo · «R8: el WHERE de corregirConciliacion exige aprobado, conciliadoAt no nulo y el monto leido» + «R8: count 0 tras leer responde conflict sin appendAccion» | verde |
| R9 | servicio · «R9 corregir: un actor sin acceso total (adminSatelite/mensajero/adminTienda) recibe forbidden y no se llama al repositorio» | verde |
| R10 | action · «R10 corregir sin sesion responde unauthenticated sin llamar al servicio» | verde |
| R11 | action · «R11 corregir con monto ausente/0/negativo/tres decimales/no numérico/clave extra/nota de 501 responde validation_error sin llamar al servicio» | verde |
| R12 | int · «R12: corregir no escribe en wallet_movimiento, wallet_tienda_movimiento ni pago_mensajero_movimiento» + unit «R12: no toca ningun libro de dinero» | verde |
| R13 | int · «R13: corregida a lo declarado: SaldosSatelitesRepository devuelve faltaPorRecibir 0.00 y conciliado» y «R13: corregida por debajo: faltante recalculado» (parte servidor; la de UI, `wallet-satelites.test.tsx` L530, es de T5) | verde |
| R14-R17 | UI — T5, frontend_dev | ver «FRONTEND (T5)» abajo |

`corregir-conciliacion.int.test.ts` aislado contra la base local migrada (`localhost:5432`, `migrate status`: up to date): **10 passed, 0 skipped**.

## Mutaciones medidas (aplicar → correr → revertir; restauración comprobada con `cmp`)

| # | Mutación en `corregirConciliacion` | Archivo(s) corridos | Resultado real |
|---|---|---|---|
| 1 | `estado: ESTADO_APROBADO` → `ESTADO_SOLICITADO` | `corregir-conciliacion.int.test.ts` | **ROJO** — 7 failed / 3 passed (R1, R2, R3, R4, R12, R13×2) |
| 2 | quitar `estado` y `conciliadoAt` del `WHERE` | `corregir-conciliacion.int.test.ts` | **ROJO** — 2 failed / 8 passed (R6 pendiente y R6 rechazada; Postgres: `viola la restricción «check» «cierre_bodega_conciliacion_coherente»`) |
| 3 | quitar `montoRecibido: previo.montoRecibido` del `WHERE` | unit repo + int | **ROJO** — 1 failed (unit R8 «el WHERE … exige … el monto leido»); la integración sigue verde, como declara el design §6 |
| 4 | borrar el `appendAccion` de `corregirConciliacion` | guardia del censo + unit repo + int | **ROJO** — 3 failed (guardia `#corregirConciliacion`, unit R4, int R4) |

## Gate

`./init.sh` COMPLETO (el diff toca `CierresBodegaAdminRepository.ts`). Log: `progress/gate_473_backend.log`
(con `INIT_EXIT` dentro, sin `tail`), base local `localhost:5432` migrada.

Corrida final (la del log): typecheck verde, lint 0 errores, **Test Files 1 failed | 2390 passed (2391);
Tests 1 failed | 33167 passed | 26 skipped (33194); `INIT_EXIT=1`**.
- Los 26 skipped son de `tests/components/AnaliticaPage.test.tsx` (17) y `AnaliticaShell.test.tsx` (9);
  **0 skipped en `tests/integration/db`** (el `.env` estaba; `corregir-conciliacion.int.test.ts`: 10 tests).
- El único rojo es `tests/unit/guards/superficie-de-uso.guardia.test.ts`
  (`lib/actions/conciliacion-satelites.ts:198 corregirConsolidacionRecibidaAction` sin superficie). ESPERADO
  y declarado en `tasks.md` T4: se cierra en T5 cuando `ConciliacionAcciones.tsx` monte la action.

Rojos de corridas anteriores, ya resueltos:
1. Corrida 1: `censo-order-status-rename` censó el literal `"rechazada"` en la etiqueta del `it.each`
   de R6 del test nuevo → etiqueta cambiada a `en-rechazo`. Mutaciones re-medidas tras el cambio (mismo resultado).
2. Corrida 2: `marca-conciliacion.int.test.ts` R14 (431, código NO tocado) vio `tienda` 27→28: conteo
   de tabla entera en READ COMMITTED con otro archivo commiteando en paralelo. Aislado (con el test nuevo
   al lado) 3/3 verde, y verde en las corridas 1 y 3 → flake ajeno. El R12 del test nuevo, que tiene la
   misma forma, se blindó con `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ` como primera sentencia.

## FRONTEND (T5) — frontend_dev

Código (commit `44849eae`):
- `components/shared/conciliacion/conciliacion-labels.ts` — `MARCAR_RECIBIDO_TEXTO.confirmarCorregir`, `CONCILIACION_RESPUESTA.corregida(monto)`. El texto de `conflicto` NO cambia (con R17 pasa a ser verdad).
- `components/shared/conciliacion/MarcarRecibidoDialog.tsx` — `confirmLabel` por modo; prop opcional `onConflicto` (en `conflict`: cierra y delega; sin ella, aviso en el diálogo como antes).
- `components/shared/conciliacion/ConciliacionAcciones.tsx` — `enviar` por modo (`incompleto` → `corregirConsolidacionRecibidaAction`, `pendiente` → marcar), toast `corregida`/`marcada`, `trasConflicto` = toast de conflicto + `onCambio()`.
- Las pantallas que montan el componente (`ConciliacionSatelite.tsx`, `CierresBodegaAdminModule.tsx`) no se tocan. Money-safe: sin `Number(`/`parseFloat`/restas.

Tests: `tests/integration/wallet-satelites.test.tsx` (mock con `corregirConsolidacionRecibidaAction`; describe nuevo «473 — corregir el monto recibido (R14-R17)»). Los demás `vi.mock` de la action (BusquedaPorGuia469, EstadoCuenta463, EstadoCuentaBarra467, EstadoCuentaSatelite, WalletListados464, wallet-sin-uuid) no hizo falta tocarlos: verdes sin cambio.

| R | Test (`wallet-satelites.test.tsx`) | Resultado |
|---|---|---|
| R13 (UI) | «R27 — sin permiso NO se monta…» / «sobre una INCOMPLETA se ofrece «Corregir»…» (existentes, se conservan) | verde |
| R14 | «R14 — Corregir llama a la action de corregir y nunca a la de marcar» + en «marcar por MENOS…» `expect(corregirMock).not.toHaveBeenCalled()` | verde |
| R15 | «R15 — el diálogo de Corregir arranca con el monto registrado (485000.00, no el declarado) y su botón dice Corregir» | verde |
| R16 | «R16 — corrección ok: cierra el diálogo, avisa el monto corregido y refresca» (toast «Monto recibido corregido a ₡500.000.» en el visor, diálogo cerrado, `onCambio` llamado y `listarConsolidacionesSateliteAction` releída) | verde |
| R17 | «R17 — conflict al corregir / al marcar: cierra el diálogo, muestra el aviso y refresca» (`it.each`, mismas cuatro comprobaciones) | verde |

Mutaciones (aplicar → correr → restaurar con `cp` + `cmp`):

| # | Mutación en `ConciliacionAcciones.tsx` | Resultado real |
|---|---|---|
| 5 | modo corrección llama a `marcarConsolidacionRecibidaAction` | **ROJO** — 2 failed (R14, R17 al corregir) |
| 6 | quitar `onConflicto={trasConflicto}` | **ROJO** — 2 failed (R17 al corregir, R17 al marcar) |

Gate: `./init.sh` COMPLETO, log `progress/gate_473_frontend.log` (sin `tail`, `INIT_EXIT` dentro), base
`localhost:5432` (`migrate status`: up to date). **Test Files 2391 passed (2391); Tests 33173 passed | 26
skipped; `INIT_EXIT=0`**. Los 26 skipped son `AnaliticaPage.test.tsx` (17) y `AnaliticaShell.test.tsx` (9);
**0 skipped en `tests/integration/db`** (`corregir-conciliacion.int.test.ts`: 10 tests). La guardia
`superficie-de-uso` pasa a verde (la action ya está montada) sin `@sin-superficie`. El flake de
`marca-conciliacion.int.test.ts` R14 no apareció. La primera corrida del gate cayó en el paso 2
(`node_modules` del worktree vacío): `pnpm install --frozen-lockfile` + `prisma generate` y se relanzó.

Herramientas (frontend): sin consultar el grafo; los archivos venían citados en design §2.4 y se
leyeron enteros. La rama local se llama `fe-473` (la de nombre `feature/473-…` estaba tomada por otro
worktree) y empuja a `origin/feature/473-corregir-recepcion-satelite`.

## Herramientas

El grafo `codebase-memory` no se consultó: los símbolos estaban citados con archivo:línea en el
design y se confirmaron leyendo los archivos con grep/sed. Las ediciones se hicieron con scripts
Python que preservan los finales de línea del archivo.
