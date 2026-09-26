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
