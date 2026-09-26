# 458-A — Detalles y guardias · parte BACKEND (backend_dev, 2026-09-26)

Rama `feature/458-A` desde `origin/dev` = `752e40df` (contiene la 461 y la 457). Base propia
`ordenex_458a` (`CREATE DATABASE … TEMPLATE ordenex` + `prisma migrate deploy`: 225 migraciones, «No
pending migrations»). Sin migraciones ni `schema.prisma` (los toca la 458-B). Búsqueda: MCP
`codebase-memory` disponible (índice rancio para la 461/457: `etiquetaDePersona` no aparecía); cada
símbolo se confirmó en el archivo real.

Alcance de esta entrega: TA.0, TA.1, TA.2 completa, TA.3 (servicio/repo/action), TA.4
(servicio/schemas/WHERE), TA.6 completa y las guardias de servidor que no dependen de la UI. El
consumo en pantallas (filtros, `SelectorBuscable`, `EnlaceCierre`, render con `origen`) y las
guardias que dependen de ese cambio de UI (R93, R95, R96) quedan para la parte frontend (§6).

## 1. TA.0 — lo confirmado en `dev` (752e40df) y lo que difiere del design

| Pieza (design §0.2 / §1.1 / §1.4) | Estado real | Difiere |
| --- | --- | --- |
| `ORIGEN_LABEL` | `Record<WalletOrigenTipo, string>` TOTAL con los textos de la 461 §7.3 + `abono_tienda` (457) | no |
| `ORIGEN_TIENDA_LABEL` | `Record<string, string>` de 7 claves + `origenLabel` con `?? origenTipo` (C2.1 vivo) | no |
| `ORIGEN_PAGO_LABEL` | `Record<string, string>` con «Liquidación» (`pago_mensajero`) y «Manual» (`manual`, nombre retirado; la guardia `nombres-wallet-461` lo tenía como PENDIENTE «458») | sí: además de parcial, rotulaba con nombres retirados |
| `cargosHint` de `/wallet/tiendas` | «Fletes, comisión, IVA, los cobros de Ordenex a la tienda y sus pagos a Ordenex anulados» (461 + 457) | no: R90 anterior resuelto |
| C1.1 | vivo: `DesgloseMovimientosTienda.tsx:379-386`, `<Input>` placeholder «ID del cierre» (`desglose-tienda-labels.ts:121`) | líneas |
| C1.2 | vivo: `DesglosePagosMensajero.tsx:335` «Pegá el identificador» + ayuda `wallet-mensajeros-labels.ts:214-216` | no |
| C1.3 | vivo: `cierreId: z.string().min(1)` en `wallet-tienda.ts:185` y `wallet-mensajero.ts:159`; el T1 de la 461 (`desdeDiaCRSchema`/`hastaDiaCRSchema`) SÍ está | líneas |
| C3.1 | vivo: `CATEGORIA_OPTIONS` (`wallet-labels.ts:453`), `CATEGORIA_TIENDA_OPTIONS` (`desglose-tienda-labels.ts:71`) y, en `/mi-wallet`, **`CATEGORIA_MI_WALLET_OPTIONS`** (`mi-wallet-labels.ts:159`) | sí: el de `/mi-wallet` se llama `CATEGORIA_MI_WALLET_OPTIONS`, no `CATEGORIA_TIENDA_OPTIONS` |
| C4.1 | vivo, pero el `sr-only` con el uuid se pinta en **`RepartoPrevisualizacion.tsx:119`** (`CIERRE_ENLACE.identificacion`, definido en `wallet-mensajeros-labels.ts`) | sí: archivo |
| C4.2 | vivo en **`WalletEgresoService.ts:133`** | línea (no 123) |
| m1 | `listarMovimientosTiendaSchema` sin `.strict()` (`wallet-tienda.ts:182-191`) | no |
| T1 | vivo en `desglose-tienda-labels.ts:83-86` | líneas (no 35-38) |
| T2 | vivo en `lib/types/wallet-tienda.ts:233-239` | no |
| T3/T4 | vivos en `db/schema.prisma:1798, 1810, 1859, 1934` | no — NO tocados (458-B, TB.14) |
| T5 | vivo: cabecera de `WalletFiltros.tsx` y `DesgloseMovimientosTienda.tsx:390-393` | no — para el frontend (describen el código que él retira) |
| T6 | vivo: `wallet-mensajeros-labels.ts:200-211` | no — para el frontend (ídem) |
| T9 | vivo: `app/(app)/wallet/page.tsx:110` | no |
| `DocumentoCajaDTO.tipo` | incluye `cobro_tienda`, `ajuste_caja` (461) y `abono_tienda` (457) | no |
| Enlace a la orden por guía (design §3.3 «parámetro a confirmar») | `/ordenes?${PARAM_TERMINO_DEFAULT}=<guía>` (`lib/utils/filtros-url.ts:44`, `"q"`), precedente `EnlaceOrden` de `DetalleMovimientoCierre.tsx:144` | confirmado |
| Ranking del día | `/ranking/historico?fecha=YYYY-MM-DD` (`PARAM_FECHA`, constante PRIVADA de la página; un test lee la fuente) | confirmado |
| Día del cierre | `cierre_dia` NO tiene columna `fecha`: se usa `solicitado_at` en día CR | sí |
| Estado de cuenta (`/wallet/tiendas/[id]`…) | no existe (458-D) → los orígenes de pagos, cobros, abonos y pago por cuenta van **sin enlace** hasta entonces | sí (previsto) |

Fotografía `caja-caracterizacion-459`: **18/18 verde** en `752e40df` (antes) y en `1d938439` (después),
sin tocar un literal.

## 2. Archivos

Nuevos (servidor): `lib/utils/etiqueta-cuenta.ts`; `lib/types/wallet-origen.ts`,
`lib/types/wallet-filtros.ts`; `lib/interfaces/{repositories/IOrigenLegibleRepository,
repositories/IFiltrosWalletRepository, services/IOrigenLegibleService, services/IFiltrosWalletService}.ts`;
`lib/repositories/{OrigenLegibleRepository,FiltrosWalletRepository}.ts`;
`lib/services/{OrigenLegibleService,FiltrosWalletService,origen-en-resultado}.ts`;
`lib/actions/wallet-filtros.ts`; `app/(app)/wallet/_components/origen-legible-labels.ts` (textos puros).

Modificados: repos de lectura de la wallet con `etiquetaDeCuenta` (`WalletTiendaMovimiento`,
`PagoMensajeroMovimiento`, `AbonoTienda`, `PagoPorCuentaTienda`, `SaldosSatelites`); los 9 bordes de los
libros en `lib/actions/{wallet,wallet-tienda,wallet-mensajero}.ts`; `lib/types/{wallet,wallet-tienda,
wallet-mensajero}.ts` (DTO `origenTipo: WalletOrigenTipo`, resultados completos `ConOrigen`, `cierreId`
`.uuid()`, `.strict()`, comentario T2); `WalletEgresoService.ts` (R4); `mi-wallet-labels.ts` y
`wallet-mensajeros-labels.ts` (diccionarios totales, `origenLabel` sin caída); las 4 `*-descarga-columnas.ts`
(sin `?? origenTipo`); `desglose-tienda-labels.ts` (T1); `wallet/page.tsx` (T9).

Commits: `68dc8d42` TA.1 · `bef2d2f8` TA.2 · `8cd41703` TA.3 · `251274de` TA.4 · `1d938439` TA.6 · `2d33365b` fixtures uuid · (este informe).

## 3. R → test

| R | Parte cubierta aquí | Test |
| --- | --- | --- |
| R1 | servidor: ningún `texto`/`etiqueta` de origen lleva uuid; el id solo en `href` | `tests/unit/services/wallet-origen-legible.test.ts` («R1: …»), `tests/integration/db/wallet-origen-legible.test.ts` |
| R2 | servidor: el cierre se elige de `cierresDeLaCuenta`; el borde ya no acepta texto libre | `tests/integration/db/wallet-cierres-selector.test.ts` («R12 borde») — la UI (fuera los `<Input>`) es del frontend |
| R4 | reverso sin descripción → nombre del concepto | `tests/unit/services/wallet-egreso-reverso-legible.test.ts` + `wallet-textos-458.guardia` (R4) |
| R5, R6 | un caso por origen (14/14), `gestion_orden` en el libro de la tienda, mensajero con su diccionario | `tests/unit/services/wallet-origen-legible.test.ts`, `tests/integration/db/wallet-origen-legible.test.ts` (Postgres, por la action) |
| R7, R8 | enlace con y sin acceso (maestro/admin, adminTienda, mensajero) | `wallet-origen-legible.test.ts` (describe «R7/R8») |
| R9, R94 | diccionarios `Record<WalletOrigenTipo>`, DTO tipados, sin `??`, composition root | `tests/unit/guards/wallet-origen-total.guardia.test.ts` (+ contraprueba) |
| R10, R11 | cierres de la cuenta (tienda y mensajero), día CR + mensajero, búsqueda por día o nombre | `tests/integration/db/wallet-cierres-selector.test.ts`, `tests/unit/services/filtros-wallet-service.test.ts` |
| R12 | cierre ajeno → 0 filas (tienda y mensajero); borde `.uuid()` | `wallet-cierres-selector.test.ts` («R12 …»), `filtros-wallet-service.test.ts` («bordes») |
| R13, R14 | conceptos con movimientos por periodo y cuenta; `egreso_gasto`/`ajuste_debito` ausentes sin filas | `tests/integration/db/wallet-conceptos-con-movimientos.test.ts` |
| R15 | servidor: el conteo no depende del concepto elegido (no se admite `categoria`); conservar el elegido en 0 es del cliente | `wallet-conceptos-con-movimientos.test.ts` («R15»), `filtros-wallet-service.test.ts` |
| R16 (selectores) | día CR del cierre y de la búsqueda (el 13 UTC es el 12 CR) | `wallet-cierres-selector.test.ts` («R10»), `filtros-wallet-service.test.ts` |
| R33 | una función `etiquetaDeCuenta` + guardia de fuente (cliente y servidor) | `tests/unit/utils/etiqueta-cuenta.test.ts`, `tests/unit/guards/wallet-etiqueta-cuenta.guardia.test.ts` |
| R36 | paginado de `/mi-wallet` `.strict()`: `tiendaId` ajeno → `validation_error` sin leer | `tests/unit/types/wallet-tienda-schemas.test.ts` |
| R84, R90 | fotografía 459 verde antes/después; ningún importe nuevo (solo cardinales) | `tests/integration/db/caja-caracterizacion-459.test.ts` |
| R97 | `nombres-wallet-461` barre `components/shared/{estado-cuenta,wallet}` (≥ 0 hoy) y `ORIGEN_PAGO_LABEL` | `tests/unit/guards/nombres-wallet-461.guardia.test.ts` (+ contraprueba nueva) |
| R99 | contraprueba y no-vacuidad en las 4 guardias nuevas/ampliadas | las mismas guardias |
| R101 (parte) | T1, T2, T9 | `tests/unit/guards/wallet-textos-458.guardia.test.ts`, `tests/integration/wallet-page.test.tsx` («R59/R101») |

## 4. Mutaciones (una a una con `mutar.sh`: aplica, comprueba que el archivo cambió, corre, restaura byte a byte)

| # | Mutación | Resultado |
| --- | --- | --- |
| 1 | `contarConceptosTienda` sin `tiendaId` en el WHERE | ROJO: 3 casos de `wallet-conceptos-con-movimientos` |
| 2 | `cierresDeTienda` sin la tienda en el WHERE | ROJO: «R11 tienda», «R10» |
| 3 | `listarPorTienda` sin `tiendaId` en el WHERE | ROJO: «R12 tienda» |
| 4 | `cierresDeMensajero` sin el mensajero en el WHERE | ROJO: «R11 mensajero» |
| 5 | `listarPorMensajero` sin `mensajeroId` en el WHERE | ROJO: «R12 mensajero» |
| 6 | `listarMovimientosTiendaSchema` sin `.strict()` | ROJO: 3 casos de `wallet-tienda-schemas` |
| 7 | reverso con `?? original.id` | ROJO: 2 de `wallet-egreso-reverso-legible` + guardia R4 |
| 8 | `OrigenLegibleService` consulta aunque no haya ids | ROJO: 2 casos del lote |
| 9 | acceso al cierre para cualquier rol (`cierres: true`) | ROJO: 3 casos R7/R8 |
| 10 | saldos de tiendas con `u.nombre` a secas | ROJO: `wallet-etiqueta-cuenta.guardia` |
| 11 | `ORIGEN_TIENDA_LABEL: Record<string, string>` | ROJO: `wallet-origen-total.guardia` |

Las 11 restauradas; `git status` limpio tras cada una.

## 5. Tests reescritos o ampliados (ninguno retirado)

| Test | Cambio | R que lo sustituye/justifica |
| --- | --- | --- |
| `tests/integration/wallet-page.test.tsx` «R59: y nombra las dos cifras…» | afirmaba «dinero en caja» en el subtítulo; ahora afirma que NO lo dice | R101 (T9) |
| `tests/unit/components/mi-wallet-labels.test.ts` (literal de `ORIGEN_TIENDA_LABEL`) | + las 7 claves del catálogo, escritas a mano | R9 |
| `tests/components/DesglosePagosMensajero.test.tsx` | «Liquidación · …» → «Pago de Ordenex a un mensajero · …»; «Manual · …» → «Registrado a mano · …» | R5 |
| `tests/unit/guards/nombres-wallet-461.guardia.test.ts` | PENDIENTE «Manual» caducado y retirado; 16 → 17 diccionarios; + carpetas compartidas | R97 |
| 6 tests de borde (`tests/unit/actions/wallet-*.test.ts`) | inyectan `origenes: ORIGENES_FALSOS`; `toEqual` con `origen` | R5 (el borde adjunta `origen`) |
| `wallet-mensajero-actions`, `wallet-mensajero-descarga-action`, `wallet-tienda-desglose-schema` | `cierreId` de prueba pasa a uuid | R12 |
| `mi-wallet-page`, `wallet-mensajeros-page`, `wallet-page`, `wallet-mensajero-service` | fixtures con `origen` / `origenTipo` tipado | R9 |

## 6. Contratos para el FRONTEND (458-A)

**6.1 Filas con origen legible** (9 actions): `listarMovimientosAction`, `listarMovimientosCompletoAction`,
`listarMovimientosDeFilaAction` (caja); `listarMisMovimientosAction`, `listarMisMovimientosCompletoAction`,
`listarMovimientosDeTiendaAction`, `listarMovimientosDeTiendaCompletoAction` (tienda);
`listarPagosDeMensajeroAction`, `listarPagosDeMensajeroCompletoAction` (mensajero). En la rama `ok`
cada fila trae además:

```ts
origen: { texto: string; enlace: { etiqueta: string; href: string } | null } // lib/types/wallet-origen.ts
```

- Pintar `origen.texto` donde hoy se pinta `ORIGEN_*_LABEL[origenTipo]` (+ la descripción como hoy); si
  `enlace` no es `null`, un `<Link href={enlace.href} aria-label={enlace.etiqueta}>`. Las descargas usan
  `origen.texto` (sin id). El id va SOLO en `href`.
- Ejemplos reales: «Cierre del día · 2026-09-12 · Juan Pérez Mora» (la tienda ve «Cierre del día ·
  2026-09-12», sin mensajero), «Gestión de orden · cobro por rechazo · guía 4321», «Pago de Ordenex a una
  tienda · Tania Tienda · 2026-09-12 · SINPE», «Premio del ranking · podio del 2026-09-10».

**6.2 Conceptos con movimientos** — `conceptosConMovimientosAction(input)` (`lib/actions/wallet-filtros.ts`):

```ts
input = { libro: "caja", tipo?, desde?: "YYYY-MM-DD", hasta?: "YYYY-MM-DD" }          // WalletFiltros
      | { libro: "tienda", tiendaId: uuid, cierreId?: uuid, desde?, hasta? }             // DesgloseMovimientosTienda
      | { libro: "mi_tienda", cierreId?: uuid, desde?, hasta? }                          // MiWalletFiltros (sin id)
→ { status: "ok"; conceptos: { categoria: string; movimientos: number }[] }  // orden del catálogo
  | { status: "forbidden" | "unauthenticated" } | { status: "validation_error"; fieldErrors }
```

Opciones = «Todos…» + `conceptos.map(c => ({ value: c.categoria, label: \`${DICC[c.categoria]} (${c.movimientos})\` }))`
con el diccionario de SU superficie (`CATEGORIA_LABEL`, `CATEGORIA_TIENDA_LABEL`, `CATEGORIA_MI_WALLET_LABEL`);
si el elegido no está, añadirlo con 0 (R15). NO mandar `categoria` (el `.strict()` lo rechaza). Retirar
`CATEGORIA_OPTIONS`, `CATEGORIA_TIENDA_OPTIONS`, `CATEGORIA_MI_WALLET_OPTIONS` y los comentarios T5.

**6.3 Cierres de la cuenta** — `cierresDeLaCuentaAction(input)` (solo acceso total; `/mi-wallet` conserva
`listarMisCierresAction`):

```ts
input = { cuenta: "tienda", tiendaId: uuid, busqueda?: string } | { cuenta: "mensajero", mensajeroId: uuid, busqueda?: string }
→ { status: "ok"; opciones: { cierreId: string; dia: "YYYY-MM-DD"; hora: "HH:mm"; mensajero: string; movimientos: number }[]; hayMas: boolean }
```

`busqueda` = un día `YYYY-MM-DD` (franja CR) o un texto (nombre/apellidos del mensajero). Rótulo sugerido:
`Cierre del ${dia} · ${mensajero} · ${n} movimiento(s)` (+ `hora` si dos rótulos coinciden, como la 335).
El `cierreId` elegido va al filtro existente (`listarMovimientosDeTiendaAction` / `listarPagosDeMensajeroAction`),
que ahora exige `.uuid()`: el `<Input>` de texto libre de hoy produciría `validation_error`.

**6.4 `SelectorBuscable` (props esperadas por estos contratos):** `{ id; etiqueta (nombre accesible);
opciones: { value: string; label: string }[]; valor: string | null; onCambiar(v: string | null);
onBuscar?(texto: string) /* con retardo → cierresDeLaCuentaAction({ …, busqueda }) */; estado: "listo" |
"cargando" | "error" | "vacio"; hayMas?: boolean /* avisar que solo se ofrecen los más recientes */ }`.
Nunca pintar `value`.

**6.5 Otros cambios de contrato:** `listarMovimientosTiendaSchema` es `.strict()` (mandar solo `page`,
`pageSize`, `cierreId`, `categoria`, `desde`, `hasta`); `origenLabel(origenTipo: WalletOrigenTipo)` sin
caída; `ORIGEN_PAGO_LABEL` dice «Pago de Ordenex a un mensajero» y «Registrado a mano»; los nombres de
cuenta en saldos/desgloses salen de `etiquetaDeCuenta` (p. ej. «Tania Tienda», antes «Tania»).

**6.6 Guardias que añade el frontend** (dependen de su cambio de UI): `wallet-sin-campo-id` (R93),
`wallet-conceptos-sin-seed` (R95), `wallet-sin-uuid` de render (R96, contraprueba con el `EnlaceCierre`
/`RepartoPrevisualizacion.tsx:119` de hoy), y las entradas T5/T6 en `AFIRMACIONES` de
`wallet-textos-458.guardia` en el mismo commit que retire ese código. Usar el censo
`tests/unit/guards/_wallet-458-archivos.ts`. Borrar las dos anotaciones `@sin-superficie` de
`lib/actions/wallet-filtros.ts` al cablearlas (la guardia de superficie lo exige).

## 7. Pendiente

- Frontend 458-A: §6 entero (TA.3 consumo, TA.4 selector y pantallas, TA.5, TA.7, TA.8, TA.9) y las guardias R93, R95, R96.
- T3/T4 (`schema.prisma`) quedan para la 458-B (TB.14).
- Enlaces a los estados de cuenta (pagos, cobros, abonos, pago por cuenta) cuando existan las rutas de la 458-D.

## 8. Gate completo (`./init.sh`, base `ordenex_458a`, log `progress/gate_458A_backend.log`)

Primera corrida (sobre `1d938439`): `INIT_EXIT=1` con **2 rojos propios** —`wallet-desglose-mensajero-descarga`
y `wallet-tienda-desglose` parseaban `cierreId: "c1"`/`"cierre-2"` con el schema que TA.4 pasó a `.uuid()`—.
Arreglados en `2d33365b` (fixture en forma de uuid). No hubo rojos ajenos que aislar.

Segunda corrida (sobre `2d33365b`), salida real:

```
✓ dependencias: 58 declaradas, todas presentes
✓ typecheck paso
✓ lint paso
✓ DATABASE_URL resuelta: los 298 archivos de tests contra Postgres SI se ejecutan
 Test Files  2269 passed (2269)
      Tests  31856 passed | 26 skipped (31882)
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 2269 ejecutado(s), todos en el baseline conocido)
INIT_EXIT=0
```

Los 26 `skipped` son `it.skip` preexistentes de `tests/components/AnaliticaPage.test.tsx` (17) y
`AnaliticaShell.test.tsx` (9); **0 en `tests/integration/db`**.

Veredicto: backend de la 458-A entregado (TA.0–TA.4 servidor, TA.6), gate completo verde; falta la parte frontend (§6).

---

# 458-A — parte FRONTEND (frontend_dev, 2026-09-26)

Rama `feature/458-A` desde `fbe61761` (checkout `wt/458-A-front`). Base propia `ordenex_458af`
(`CREATE DATABASE … TEMPLATE ordenex` + `migrate deploy`: 225, «up to date»); `.env` copiado con la
base apuntando al clon; `pnpm install` propio. Búsqueda: MCP `codebase-memory` disponible y usado para
orientar (`search_code`); cada símbolo confirmado en el archivo real.

## 10. Lo entregado (§6 entero)

| Tarea | Qué | Commit |
| --- | --- | --- |
| TA.2 (pantalla) | `OrigenMovimiento` + `textoDeOrigen` (`components/shared/wallet/`): la celda «Origen» de los 5 libros (`WalletLedger`, `DetalleFilaComposicion`, `DesgloseTiendaLedger`, `DesgloseMovimientosTienda`, `DesglosePagosMensajero`) pinta `origen.texto` (+ descripción) y, si `enlace ≠ null`, un «Ver» con `aria-label = enlace.etiqueta`; las 4 descargas usan el MISMO texto (R3, R5–R8) | `1ceab0a6` |
| TA.3 | `useConceptosConMovimientos` + `opcionesDeConceptos`: `WalletFiltros` (`libro: caja`, tipo y periodo del borrador), `DesgloseMovimientosTienda` (`tienda`, tiendaId, cierre y periodo) y `MiWalletFiltros` (`mi_tienda`, sin id) con «(n)» y el elegido conservado con «(0)»; aviso si la lectura falla. Fuera `CATEGORIA_OPTIONS`, `CATEGORIA_TIENDA_OPTIONS`, `CATEGORIA_MI_WALLET_OPTIONS` y los comentarios T5 | `1ceab0a6` |
| TA.4 | `components/shared/SelectorBuscable.tsx` (popover + campo `role=combobox` + `listbox`, `aria-activedescendant`, ↓/↑/Inicio/Fin/Intro/Escape, foco al abrir y de vuelta al cerrar, anillo opaco, estados cargando/error/vacío/«solo los más recientes», nunca pinta `value`) + `useCierresDeLaCuenta` (lectura PEREZOSA, al abrir) + `cierres-selector.ts` (rótulo «Cierre del día · mensajero · n movimientos», hora si se repite). Sustituye los `<Input>` de `DesgloseMovimientosTienda` y `DesglosePagosMensajero`; fuera `cierrePlaceholder`, `cierreAyuda` y T6. Borradas las 2 `@sin-superficie` de `lib/actions/wallet-filtros.ts` | `1ceab0a6` |
| TA.5 | `EnlaceCierre({ cierreId, nombre })`: el `sr-only` ya no lleva el uuid; se nombra por día CR y mensajero (`CIERRE_ENLACE.delDia` en la previsualización, `RepartoPrevisualizacion.tsx`), por la fila (`deLaFila`, desglose) o por lo aplicado (`delPago`, reparto aplicado) | `1ceab0a6` |
| Guardias | `wallet-sin-campo-id` (R93), `wallet-conceptos-sin-seed` (R95), `wallet-sin-uuid` de render (R96, 7 superficies); T5×3 y T6 en `AFIRMACIONES` de `wallet-textos-458` | `e46f3f16`, `1ceab0a6` |
| TA.7 | `cargarTableroFinanciero` rotula `dinero_en_caja` con `rotuloCifraPrincipal({ periodoFiltrado: true, estado })` → «Movimiento neto del periodo» | `f7fe9471` |
| TA.8 | `docs/ayuda/oficina/wallet-tiendas.md`, `wallet-mensajeros.md`, `tienda/mi-wallet.md` (selector, conceptos con cuenta, origen con nombre; `actualizado` y `fuentes`); `tests/unit/asistente/contexto-458.test.ts` bloque A | `12444e25` |
| TA.9 | recorrido `progress/recorrido_458-A/` (pasos 1, 8, 12, accesibilidad; maestro, admin, tienda; 4 preguntas al asistente) | este commit |

## 11. R → test (parte frontend)

| R | Test |
| --- | --- |
| R1 | `tests/unit/guards/wallet-sin-uuid.guardia.test.tsx` (render de 7 superficies); `tests/components/RepartoPrevisualizacion.test.tsx` y `DesglosePagosMensajero.test.tsx` («Ver el cierre» sin id); `tests/components/SelectorBuscable.test.tsx` («nunca el valor») |
| R2 | `tests/unit/guards/wallet-sin-campo-id.guardia.test.ts`; `tests/components/WalletFiltros458.test.tsx` (sin campo de texto, sin «Pegá»/ayuda) |
| R3 | `tests/components/OrigenMovimiento.test.tsx` («las cuatro descargas… sin id») |
| R5, R6 | `tests/components/OrigenMovimiento.test.tsx`; `tests/integration/mi-wallet-page.test.tsx` (origen por fila) |
| R7, R8 | `tests/components/OrigenMovimiento.test.tsx` («Ver» con `aria-label`, id solo en `href`; sin enlace si `null`) |
| R10, R11 | `tests/components/WalletFiltros458.test.tsx` (selector al abrir, búsqueda por nombre/día, rótulo día · mensajero); `tests/integration/wallet-tiendas-desglose.test.tsx`, `wallet-mensajeros-page.test.tsx`, `wallet-tiendas-pago.test.tsx` (eligen `c1` por su rótulo) |
| R12 (pantalla) | `tests/components/WalletFiltros458.test.tsx` (el cierre elegido viaja como `cierreId` al listado y al conteo) |
| R13, R14 | `tests/unit/components/conceptos-filtro.test.ts`; `tests/components/WalletFiltros458.test.tsx`; `tests/unit/components/wallet-indemnizacion-libro.test.tsx`; `tests/unit/components/desglose-tienda-ledger.test.tsx`; `tests/integration/wallet-tiendas-desglose.test.tsx` («R44») |
| R15 | `tests/unit/components/conceptos-filtro.test.ts`; `tests/components/WalletFiltros458.test.tsx` («se conserva, con 0») |
| R16 (selectores) | el día CR lo pone el servidor (`dia`); `tests/components/WalletFiltros458.test.tsx` pinta ese día tal cual |
| R62 | `tests/unit/analitica/panel-mensual-rotulo.test.ts`; `tests/unit/analytics/tablero-financiero-cargar.test.ts` (reescrito) |
| R93 | `wallet-sin-campo-id.guardia.test.ts` (+ contraprueba C1.1/C1.2) |
| R95 | `wallet-conceptos-sin-seed.guardia.test.ts` (+ contraprueba `CATEGORIA_OPTIONS`) |
| R96 | `wallet-sin-uuid.guardia.test.tsx` (+ contraprueba `EnlaceCierre` de antes) |
| R99 | las tres guardias: contraprueba + no-vacuidad (censo ≥ 40 archivos, `<Input>` vistos ≥ 3; 3 filtros en el censo; ≥ 7 superficies y ids en `href`) |
| R101 (T5, T6) | `tests/unit/guards/wallet-textos-458.guardia.test.ts` (8 afirmaciones) |
| R102, R103 | `tests/unit/asistente/contexto-458.test.ts` (bloque A) + 4 preguntas en `progress/recorrido_458-A/recorrido.md` |
| R104 | `progress/recorrido_458-A/` |

## 12. Tests reescritos (ninguno retirado sin sustituto)

| Test | Cambio | R |
| --- | --- | --- |
| `tests/components/descarga/WalletDescarga.test.tsx` «T G.2 (R61)» | afirmaba que el filtro ES el SEED; ahora pasa todo el SEED por `opcionesDeConceptos` y exige rótulo legible con «(1)» | R13, R95 |
| `WalletLedgerAcciones457/459/461.test.tsx` «el filtro por concepto…» | `CATEGORIA_OPTIONS` → `opcionesDeConceptos` con los conceptos del caso | R13 |
| `DesgloseTiendaAbono457.test.tsx` (2 casos de filtro) | ídem con los diccionarios de tienda y de `/mi-wallet`; «(2)», «(1)» | R13 |
| `tests/unit/components/wallet-labels.test.ts`, `desglose-tienda-labels.test.ts`, `mi-wallet-labels.test.ts` (opciones) | del SEED a `opcionesDeConceptos`; los rótulos esperados siguen escritos a mano | R13 |
| `tests/unit/guards/incidente-exhaustividad.test.ts` «R31» | ídem | R13 |
| `tests/unit/components/wallet-indemnizacion-libro.test.tsx` «las opciones salen del SEED» | ahora: las del servidor, con su número, sin `egreso_gasto` | R13, R14 |
| `tests/unit/components/desglose-movimientos-tienda.test.tsx`, `desglose-tienda-ledger.test.tsx` (381/R35) | la opción es «… (1)» y la lista es la del servidor | R13 |
| `tests/integration/wallet-tiendas-desglose.test.tsx` (6 casos), `wallet-mensajeros-page.test.tsx` (2), `wallet-tiendas-pago.test.tsx` (1) | teclear «c1» en «Cierre» → elegir el cierre en el selector (`tests/fixtures/selector-buscable.ts`); «R44: pago_tienda es una opción» → la lista del servidor | R2, R10, R13 |
| `tests/integration/mi-wallet-page.test.tsx` (fixture) | el doble del borde ponía «Registrado a mano» como origen de TODA fila; ahora el rótulo de su origen | R5 |
| `tests/components/DesglosePagosMensajero.test.tsx`, `RepartoPrevisualizacion.test.tsx` (R43/R44) | el nombre accesible afirmaba «Ver el cierre (<uuid>)»; ahora día/mensajero/fila y sin id | R1 |
| `tests/unit/analytics/tablero-financiero-cargar.test.ts` (459 m3, 3 casos) | «Flujo de dinero registrado»/«Dinero en caja» → «Movimiento neto del periodo» | R62 |
| `tests/unit/asistente/contexto-457.test.ts`, `contexto-461.test.ts` («actualizado el 2026-09-25») | fijaban la fecha EXACTA; ahora «el 2026-09-25 o después» (R102 obliga a actualizarla) | R102 |

## 13. Mutaciones (arnés con autocomprobación: el archivo cambia, se ejecutan > 0 tests, se restaura byte a byte)

| # | Mutación | Tests | Resultado |
| --- | --- | --- | --- |
| M1 | vuelve `cierrePlaceholder: "ID del cierre"` | guardia R93 | ROJO 1/3 |
| M2 | `WalletFiltros` puebla la categoría del SEED | guardia R95 + `WalletFiltros458` | ROJO 4/15 |
| M3 | `EnlaceCierre` vuelve a poner el uuid en el `sr-only` | guardia R96 | ROJO 2/10 (desglose y previsualización) |
| M4 | selector sin `aria-activedescendant` | `SelectorBuscable` | ROJO 1/11 |
| M5 | selector busca en el servidor en cada tecla | `SelectorBuscable` | ROJO 1/11 |
| M6 | el disparador pinta el VALOR | `SelectorBuscable` | ROJO 1/11 |
| M7 | Intro no elige | `SelectorBuscable` | ROJO 1/11 |
| M8 | R15: el elegido sin movimientos desaparece | `conceptos-filtro` + `WalletFiltros458` | ROJO 3/15 |
| M9 | la celda ignora `origen.texto` | `OrigenMovimiento` | ROJO 6/7 |
| M10 | los cierres se leen al montar, no al abrir | `WalletFiltros458` | ROJO 1/9 |
| M11 | el desglose del mensajero ignora el cierre elegido | `WalletFiltros458` | ROJO 1/9 |
| M12 | vuelve la ayuda «copiá su dirección y pegala» | `wallet-textos-458` (T6) | ROJO 1/10 |

Las 12 restauradas; `git status` limpio al terminar. Gate y mutaciones NO en paralelo.

## 14. Recorrido y gate

Recorrido (`progress/recorrido_458-A/recorrido.md`): maestro y admin OK en los pasos 1, 8 y 12 (árbol
de «Ver el cierre» sin uuid) y en accesibilidad; tienda OK en `/mi-wallet` (7 conceptos, Σ 27 = su
libro) y `/wallet` → 404. Σ de las cuentas del filtro de la caja = 36 = filas de la caja del clon.
El panel mensual de `/analitica` NO se ve (región `financiero` comentada en `AnaliticaShell`).
Una falsa alarma de la sonda (el `input` oculto de Base UI) anotada y medida.

Gate completo (`./init.sh`, base `ordenex_458af`, log `progress/gate_458A.log`, sin `tail`), salida real:

```
✓ dependencias: 58 declaradas, todas presentes
✓ typecheck paso
✓ lint paso
✓ DATABASE_URL resuelta: los 298 archivos de tests contra Postgres SI se ejecutan
 Test Files  2278 passed (2278)
      Tests  31928 passed | 26 skipped (31954)
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 2278 ejecutado(s), todos en el baseline conocido)
INIT_EXIT=0
```

Los 26 `skipped` son los `it.skip` de `AnaliticaPage.test.tsx` (17) y `AnaliticaShell.test.tsx` (9);
**0 en `tests/integration/db`**. Fotografía `caja-caracterizacion-459` verde dentro del gate (ningún
literal tocado).

## 15. Pendiente (frontend)

- `/analitica`: la región `financiero` está comentada en `AnaliticaShell`; el rótulo nuevo no se ve
  hasta que vuelva (el cargador y su test ya lo dicen).
- Enlaces del origen a los estados de cuenta (pagos, cobros, abonos, pago por cuenta): 458-D.
- `SelectorBuscable` se reutiliza en 458-C/E (cuenta y «A quién»).

---

# 458-A — cierre tras la revisión RECHAZADA (backend_dev, 2026-09-26)

Rama `wt/458-A-fix` desde `origin/feature/458-A` = `cd91bcf4` + merge de `origin/review/458-A`
(`6f2bef71`, `progress/review_458-A.md`). Base propia `ordenex_458ax` (`CREATE DATABASE … TEMPLATE
ordenex` + `migrate deploy`: 225, «No pending migrations»; `migrate status` → `ordenex_458ax` en
`localhost:5432`); `.env` copiado del checkout principal con la base apuntando al clon; `pnpm install`
propio. Búsqueda: MCP `codebase-memory` disponible (`search_code` para `etiquetaDePersona`); cada
símbolo confirmado en el archivo real.

## 16. Lo arreglado, punto por punto

| Punto de la revisión | Commit | Qué | Test |
| --- | --- | --- | --- |
| **B1** (R33) | `dde7ac7e` | `CobroTiendaAnulacionRepository.anular`, `LiquidacionPagoRepository` (registro `nombreDelBeneficiario` y anulación) y `LiquidacionRepartoRepository` (registro y anulación): `CUENTA_USUARIO_SELECT` + `etiquetaDeCuenta` (sin cuenta, `null` → «(sin identificar)» como antes). Comentarios desfasados de `IWalletTiendaMovimientoRepository.ts` y `descripcion-cobro-tienda.ts`. | `tests/integration/db/wallet-etiqueta-historial-458.test.ts` (Postgres: «Tania Tienda» igual en registro, anulación y tabla; mensajero «Juan Pérez Mora» igual en pago, su anulación, reparto, su anulación y la tabla de `/wallet/mensajeros`); guardia `wallet-etiqueta-cuenta` ampliada |
| **B1** guardia | `dde7ac7e` | El censo del servidor suma, POR CONTENIDO, todo archivo de `lib/{repositories,services}` que etiqueta el historial de una cuenta de la wallet (`etiquetaDeEntidad` de `wallet_tienda_movimiento`, `liquidacion_pago`, `liquidacion_reparto`, `pago_por_cuenta_tienda`, `abono_tienda`); patrones nuevos: el `nombre` a secas en `tiendaNombre`/`beneficiarioNombre`/`mensajeroNombre` y la cuenta leída sin apellidos. No-vacuidad: los tres repositorios en el censo, ≥ 11 archivos. | contraprueba con la fuente de `cd91bcf4` de la anulación y de los pagos |
| **m1** | `3def2353` + este commit | TA.0–TA.9 `[x]` con `*Evidencia:*`; entrada en `progress/history.md`. | — |
| **m2** capas | `031300ff` | `lib/constants/wallet-rotulos.ts` (`CATEGORIA_LABEL`, `ORIGEN_LABEL`, `ORIGEN_TIENDA_LABEL`, `ORIGEN_PAGO_LABEL`, `etiquetaVerOrden`), `lib/constants/origen-legible-rotulos.ts` (antes en `app/(app)/wallet/_components/`), `lib/constants/metodo-pago-label.ts`, `lib/utils/hora-cr.ts`, `lib/utils/cierre-enlace.ts`. Las pantallas re-exportan el MISMO objeto. Los censos de `_wallet-458-archivos` y `nombres-wallet-461` suman los rótulos de `lib/constants`; `caja-173-alcance` declara el catálogo. | guardia nueva `tests/unit/guards/lib-no-importa-app.guardia.test.ts` (+ contraprueba) |
| **m3** | `4b1ddecc` | Comentario de `WalletTiendaService.listarMovimientosDeTienda` (y el del test del servicio): el borde ES estricto por el `.extend` de un `.strict()` (medido en zod: clave extra → `success: false`). | `wallet-tienda-schemas.test.ts` («por la action del desglose: una clave colada → validation_error»); afirmación `m3` en `wallet-textos-458` |
| **m4** | `069b7ca2` | `cierresDeTienda`/`cierresDeMensajero`: la búsqueda va en la MISMA consulta (`JOIN` al cierre y a su mensajero, la cuenta primera en el `WHERE`, `LIMIT`), sin la lectura previa sin tope ni el `IN`; `ILIKE` con `%`, `_` y `\` escapados. | `wallet-cierres-selector.test.ts` «m4: 33.000 cierres que casan…» y «m4: el texto buscado es literal» |
| **m5** | `1eb205dc` | `/analitica` ya no llama a `verResumenCajaAction`: con periodo el rótulo no depende del estado. | `panel-mensual-rotulo.test.ts` «m5…», `tablero-financiero-cargar.test.ts` (`not.toHaveBeenCalled()`) |
| **m6** | `aed9f27a` | Las dos aserciones pasan a literales escritos a mano, con mensajeros de segundo apellido: «Anacleta Zúñiga458 Mora458» y «Cierre del día · 2026-09-12 · Juan Pérez Mora»; + búsqueda por segundo apellido. | `wallet-cierres-selector.test.ts`, `wallet-origen-legible.test.ts` |

Fuera de alcance, anotado: `CierresAdminRepository.ts:2441` (historial del `cierre_dia`, pantalla de
cierres, no wallet) y `RechazoTiendaCobroRepository` (cola de rechazos de `/cierres-admin`) siguen con
su composición; m7 (cobertura contra Postgres de 6 de 8 lectores del origen), m8 (ayuda) y m9
(`conciliadoPorNombre`) no se pidieron en este cierre. Lo persistido (nota de B1): las líneas de caja del
cobro ya usaban `etiquetaDeCuenta` desde `cd91bcf4`; contar en producción las tiendas con
`segundo_apellido` no nulo sigue pendiente antes de desplegar (dato del leader: ninguna tienda tiene
apellidos).

## 17. Mutaciones (una a una: el archivo cambia —`git diff --stat` no vacío—, se corre, se restaura con `git checkout HEAD --`, `git status` limpio)

| # | Mutación | Tests | Resultado |
| --- | --- | --- | --- |
| C1 | `CobroTiendaAnulacionRepository.ts` de `cd91bcf4` | guardia R33 + historial Postgres | ROJO 2/7 |
| C2 | `LiquidacionPagoRepository.ts` de `cd91bcf4` | ídem | ROJO 2/7 (guardia + mensajero) |
| C3 | `LiquidacionRepartoRepository.ts` de `cd91bcf4` | ídem | ROJO 2/7 (guardia + mensajero) |
| C4 | `FiltrosWalletService` vuelve a importar `horaCostaRica` de `app/…/textos` | `lib-no-importa-app` | ROJO 1/3 |
| C5 | `ORIGEN_PAGO_LABEL: Record<string, string>` en `lib/constants/wallet-rotulos.ts` | `wallet-origen-total` | ROJO 1/6 (el diccionario mudado sigue vigilado) |
| C6 | `WalletTiendaService.ts` de `cd91bcf4` (comentario viejo) | `wallet-textos-458` | ROJO 1/11 (m3) |
| C7 | `listarMovimientosDeTiendaSchema = …Schema.strip().extend(…)` | `wallet-tienda-schemas` | ROJO 2/5 |
| C8 | `FiltrosWalletRepository.ts` de `cd91bcf4` (lectura previa + `IN`) | `wallet-cierres-selector` | ROJO 2/8 (33.000 → `PrismaClientKnownRequestError`; `%` casaba todo) |
| C9 | sin la tienda en el `WHERE` crudo de `cierresDeTienda` | ídem | ROJO 2/8 (R11 tienda, R10) |
| C10 | sin el mensajero en el `WHERE` crudo de `cierresDeMensajero` | ídem | ROJO 1/8 (R11 mensajero) |
| C11 | sin escapar los comodines del `ILIKE` | ídem | ROJO 1/8 (texto literal) |
| C12 | `financiero/cargar.ts` de `cd91bcf4` (vuelve `verResumenCajaAction`) | `panel-mensual-rotulo` + `tablero-financiero-cargar` | ROJO 2/14 |
| C13 | `etiquetaDeCuenta` sin segundo apellido | origen, selector e historial contra Postgres | ROJO 3/11 (con la aserción contra `etiquetaDeCuenta(...)` de antes, las dos de m6 habrían seguido verdes) |

## 18. Gate completo (`./init.sh`, base `ordenex_458ax`, log `progress/gate_458A_cierre.log` sin `tail`, `INIT_EXIT` escrito dentro), sobre `3def2353`

```
✓ dependencias: 58 declaradas, todas presentes
✓ typecheck paso
✓ lint paso
✓ DATABASE_URL resuelta: los 299 archivos de tests contra Postgres SI se ejecutan
 Test Files  2280 passed (2280)
      Tests  31939 passed | 26 skipped (31965)
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 2280 ejecutado(s), todos en el baseline conocido)
INIT_EXIT=0
```

Los 26 `skipped` son los `it.skip` de `tests/components/AnaliticaPage.test.tsx` (17) y
`AnaliticaShell.test.tsx` (9); **0 en `tests/integration/db`**. Antes del gate, `tests/unit` +
`tests/components` completos: 1779 archivos, 26746 verdes, 26 saltados (los mismos).

Veredicto: los puntos B1 y m1–m6 de la revisión cerrados con test y mutación en rojo; gate completo verde; lista para nueva revisión.
