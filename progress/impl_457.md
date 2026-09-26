# Ficha 457 — «Una tienda le paga a Ordenex» · bitácora del BACKEND

**Rama:** `feature/457-backend` (worktree `agent-ab42699e91e6b6bbf`, rama local `wt/457-backend` que
empuja a `origin/feature/457-backend`; la rama con su nombre está tomada por el worktree
`agent-a97bb7d8335763b13`, del agente anterior, y desde este worktree no se puede tocar).
**Partida de esta sesión:** `c88c4eb9` (WIP del agente anterior, que se quedó sin cuota).
**Base:** clon `ordenex_457 @ localhost:5432` (`prisma migrate status` → «Database schema is up to date!»).
**Búsqueda de código:** el MCP `codebase-memory` NO está en el conjunto de herramientas de esta sesión:
todo se leyó con `grep`/lectura directa de los archivos reales.

## 1. Commits de la ficha (backend)

| SHA | Qué |
| --- | --- |
| `0d0c6ac1` | Fase 0 (`progress/fase0_457.md`) |
| `ae87cb46` | Las dos migraciones y `db/schema.prisma` |
| `4f47226c` | Tipos, clasificación, servicio, puerto de caja, repositorio, actions, documento en el libro, diccionarios |
| `c88c4eb9` | WIP: tests nuevos y reescrituras a medio aplicar |
| `6fe2acd0` | **fix R25** (la clave manda sobre la regla del dinero) + la guardia de alcance compila |
| `eb36c2dc` | tests: repositorio contra Postgres, puerto de caja, carpeta del comprobante, R25 concurrente |
| `a7bd1186` | bitácora y mutaciones |
| `8bcab3ab` | los cinco rojos del primer gate completo (§9) |

## 2. Timestamps y migraciones (T1.1–T1.4)

Último de `origin/dev` al escribirlas: `20260926120500_wallet_461_fechas_cr_pagos` (sigue siéndolo:
`origin/dev` = `be44df4f`, sin migraciones nuevas). Orden de aplicación:

1. `20260927120000_abono_tienda_457_enums` — ocho `ADD VALUE IF NOT EXISTS` sobre los cinco tipos.
   `down.sql`: `pg_temp.quitar_valores_de_enum_457`, la función de la 461 byte a byte salvo el sufijo
   (lo exige `abono-tienda-457-migration.test.ts` (e)).
2. `20260927120100_abono_tienda_457_tablas_y_checks` — `abono_tienda`, `abono_tienda_anulacion` (RLS
   activada, FK RESTRICT, CHECK del documento), los dos CHECK tipo↔categoría AMPLIADOS. `down.sql`:
   RAISE si hay un pago, una anulación o un movimiento de los cuatro conceptos; CHECK a las listas de
   la 461; `DROP TABLE` de las dos.

### Ciclo REAL up → down → up sobre el clon (R75), medido en esta sesión

Con `pg_enum`, `pg_constraint` y `to_regclass` (script de un solo uso, borrado):

| Momento | caja / tienda / origen / historial tipo / entidad | CHECK caja · tienda (md5 de `pg_get_constraintdef`) | tablas |
| --- | --- | --- | --- |
| Tras migrar | 25 / 16 / 14 / 63 / 24 | `2182276a…` · `d1a65d24…` (nombran `abono`) | las dos |
| `db:rollback` de la 2 + `down.sql` de la 1 (y su fila de `_prisma_migrations`) | **23 / 14 / 13 / 61 / 23**, los últimos valores = los de la 461 (= fase 0, T0.4) | `668cae78…` · `6248d021…` (sin `abono`) | ninguna |
| `prisma migrate deploy` otra vez | 25 / 16 / 14 / 63 / 24 | idénticos al primero (`diff` vacío) | las dos |

El caso «con un pago presente el `down` aborta sin borrar» vive en el test (d) (en transacción
revertida, con SAVEPOINT) y lo mata la mutación 14.

## 3. Catálogos antes y después

| Enum | Antes (461) | Después (457) | Valores nuevos (al final) |
| --- | --- | --- | --- |
| `wallet_movimiento_categoria` | 23 | 25 | `ingreso_abono_tienda`, `egreso_reverso_abono_tienda` |
| `wallet_tienda_movimiento_categoria` | 14 | 16 | `abono_tienda`, `abono_tienda_anulado` |
| `wallet_origen_tipo` | 13 | 14 | `abono_tienda` |
| `historial_accion_tipo` | 61 | 63 | `abono_tienda_registrado`, `abono_tienda_anulado` |
| `historial_accion_entidad` | 23 | 24 | `abono_tienda` |

CHECK: caja 12 ingresos + 11 egresos → 13 + 12; tienda 4 créditos + 10 débitos → 5 + 11 (listas de
`design.md` §3.3, verificadas contra el motor por `abono-tienda-457-migration.test.ts` (b) y (f) y por
`caja-tesoreria-migration.test.ts` 23 → 25).

## 4. Lo que esta sesión cambió respecto del WIP (y por qué)

1. **R25 estaba roto** (medido: `abono-tienda-457.test.ts` «R25» daba `excede`). `design.md` §5.1 pone
   el pre-chequeo del saldo (paso 4) y la regla bajo el candado (paso 8) ANTES de mirar la clave (paso
   13): reenviar un pago que YA salda la deuda (el doble clic del recorrido §17.4) respondía
   `excede`/`sin_deuda` y el diálogo habría pintado un error sobre un pago que sí quedó. Arreglo en
   `AbonoTiendaService.registrar`: la clave se mira después de validar la tienda y ANTES del
   pre-chequeo (sin subir el archivo ni abrir transacción), y otra vez si la regla rechaza bajo el
   candado (dos envíos simultáneos). Tests: tres casos unitarios nuevos, el de integración que ya
   existía y uno de concurrencia nuevo. **Desviación del orden de `design.md` §5.1**, a favor de R25.
2. `abono-tienda-alcance.guardia` importaba `sinComentarios`, que no existe (único error de typecheck
   del WIP): `quitarComentarios`.
3. Tests que faltaban según `tasks.md`: T3.1 (repositorio contra Postgres con dos documentos de dos
   tiendas: mata un `WHERE` que no filtre), T3.2 (puerto de caja con lista EXACTA de categorías y
   origen), T2.4 (`rutaDeComprobante("abono_tienda", …)`).
4. La concurrencia calculaba el saldo con `Number(...)`: ahora con `Prisma.Decimal`.

Revisé TODAS las reescrituras mecánicas del WIP (`git diff 0d0c6ac1 c88c4eb9 -- tests`): conteos,
colas de enum desplazadas un tramo (`slice`), listas POSTERIORES, diccionarios, dobles de
`LectoresDocumentosCaja`. Todas conservan lo que afirmaban y añaden lo de la 457; ninguna se quedó a
medias (typecheck verde, todos los archivos verdes).

## 5. Contratos de las Server Actions (para el `frontend_dev`)

Archivo: `lib/actions/abono-tienda.ts` (`"use server"`). Exporta EXACTAMENTE tres funciones (R40).
Tipos en `lib/types/abono-tienda.ts`. Orden en las tres: sesión (`unauthenticated`, antes de mirar la
entrada) → zod `.strict()` (`validation_error { fieldErrors }`) → servicio (el rol lo decide él:
`forbidden`). Montos SIEMPRE string con dos decimales.

### `registrarAbonoTiendaAction(formData: FormData): Promise<RegistrarAbonoTiendaResult>`

Claves del `FormData` (cualquier otra → `validation_error`, R12):

| Clave | Regla | Campo del error |
| --- | --- | --- |
| `claveIdempotencia` | uuid; generarla AL ABRIR el diálogo y reutilizarla en los reintentos | `claveIdempotencia` |
| `tiendaId` | uuid de una cuenta `adminTienda` (activa o no, D2) | `tiendaId` («Elegí la tienda que paga.» / «La tienda no existe» / «La cuenta elegida no es una tienda») |
| `monto` | texto decimal > 0, hasta 2 decimales, ≤ 9 999 999 999,99 | `monto` |
| `metodo` | `efectivo` \| `SINPE` \| `transferencia` | `metodo` |
| `referencia` | opcional; **obligatoria con SINPE y transferencia**; ≤ 60 tras recortar | `referencia` |
| `motivo` | 1–200 caracteres tras recortar | `motivo` |
| `fechaPago` | `YYYY-MM-DD`, existente y no posterior a hoy en CR; SIN límite hacia atrás (D3) | `fechaPago` |
| `comprobante` | opcional; `File` JPEG/PNG/WebP/PDF ≤ 4 MB; un `File` vacío (0 bytes) = sin comprobante | `comprobante` |

Respuestas:

| `status` | Carga | Qué pinta el diálogo (design §8.3) |
| --- | --- | --- |
| `ok` | `abono: AbonoTiendaDTO`, `saldo: SaldoTiendaDTO` | éxito con `saldo` (el del SERVIDOR, con signo) |
| `ya_registrado` | `abono` (el ORIGINAL), `saldo` (actual, de la tienda del original) | igual que `ok`: UN solo aviso |
| `sin_deuda` | `saldo: SaldoTiendaDTO` | bajo `tiendaId`: «Esta tienda no tiene saldo en contra…» |
| `excede` | `deuda: string` (valor ABSOLUTO, escala 2) | bajo `monto`: «La tienda debe {money(deuda)}…» sin recalcular |
| `comprobante_no_guardado` | — | aviso general; nada se registró |
| `forbidden` | — | sin acceso total (incluida la propia tienda) |
| `validation_error` | `fieldErrors: Record<string, string[]>` | bajo cada campo |
| `unauthenticated` | — | sesión |

`AbonoTiendaDTO = { id, tiendaNombre, monto, metodo, referencia, motivo, fechaPago (YYYY-MM-DD),
registradoPorNombre, registradoAt (ISO), anulado, tieneComprobante }` — sin `tiendaId`, sin ids de
usuario, sin clave, sin ruta del comprobante (R48). `SaldoTiendaDTO = { creditos, debitos, saldo,
signo: "positivo" | "cero" | "negativo" }`.

### `anularAbonoTiendaAction({ abonoId, motivo }): Promise<AnularAbonoTiendaResult>`

`.strict()`: **sin monto** (R34; mandarlo es `validation_error`). `abonoId` = el `origenId` de la
entrada original del libro (`documento.tipo === "abono_tienda"`). `motivo` no vacío tras recortar.
Respuestas: `ok { saldo }` (puede volver a ser negativo) · `ya_anulado` · `no_encontrado` ·
`forbidden` · `validation_error` · `unauthenticated`. Ya cableada en
`DocumentoCajaAcciones.ACCIONES.abono_tienda` (4f47226c).

### `obtenerComprobanteAbonoAction({ abonoId }): Promise<ObtenerComprobanteAbonoResult>`

`.strict()`. Acceso total → cualquiera; `adminTienda` → solo el suyo (un pago ajeno o inexistente →
`no_encontrado`, indistinguibles). Respuestas: `ok { url }` (URL firmada, TTL de
`walletComprobanteConfig.SIGNED_URL_TTL_SECONDS`) · `sin_comprobante` · `no_encontrado` · `forbidden` ·
`validation_error` · `unauthenticated`. Misma forma que el comprobante del pago de un gasto.

### El libro de la caja

`listarMovimientosAction` ya devuelve `documento = { tipo: "abono_tienda", anulado, tieneComprobante }`
en la ENTRADA original (`ingreso_abono_tienda` + origen `abono_tienda`) y `null` en su reverso
(integración R41). `LectoresDocumentosCaja.abonos` = `AbonoTiendaRepository` en `lib/actions/wallet.ts`.

## 6. Trazabilidad R → test (backend; lo de UI queda marcado para el `frontend_dev`)

`U` = `tests/unit/`, `I` = `tests/integration/db/`.

| R | Test(s) |
| --- | --- |
| R1 | `I/abono-tienda-457.test.ts` «R1/R5/R17/R18/R20/R21/R22» (por la action, cuatro filas en Postgres) |
| R2 | `U/services/abono-tienda-service.test.ts` «R2»; `I/abono-tienda-457.test.ts` «R2/R3/R4–R9/R12/R13» |
| R3 | `U/actions/abono-tienda-action.test.ts` «R3» (×2); integración ídem |
| R4–R9 | `U/types/abono-tienda-schema.test.ts` (R4, R4/R5, R6, R7, R8, R9); `U/actions/abono-tienda-action.test.ts` «R4/R6/R7/R9»; integración ídem |
| R10, R11 | `U/services/abono-tienda-service.test.ts` «R10», «R11 (D2)»; `I/abono-tienda-457.test.ts` «R10/R11» |
| R12, R13 | schema «R12», «R13»; action «R12», «R13»; integración |
| R14 | service «R14»; `I/abono-tienda-457.test.ts` «R14» |
| R15, R66 | service «R15», «R15/R66 (mutación 6)»; integración «R15/R66»; concurrencia «R16 (mutación 5)» (saldo −2 000, nunca > 0) |
| R16 | `I/abono-tienda-457-concurrencia.test.ts` (abono ∥ abono ×2, abono ∥ pago a tienda, abono ∥ pago de un gasto); service «R16», «R16/R17» (orden candado→saldo) |
| R17 | integración «R1/…/R22»; service «R16/R17», «R17/R22»; `I/caja-invariante-tiendas.test.ts` paso 11 |
| R18 | service «R18»; integración |
| R19 | `U/utils/caja-derivacion-457.test.ts` «R19»; `U/analytics/finanzas-diario.test.ts` (+1 caso); integración «R19/R39»; invariante `cambio(11)` |
| R20 | service «R20»; integración (06:00Z = `inicioDelDiaCREnUtc`); invariante «⭑ 457 (R17/R20/R31/R32)» |
| R21 | `U/utils/descripcion-abono.test.ts`; service «R21»; integración |
| R22 | integración (otra tienda, mensajeros, naturaleza «terceros»); `U/services/caja-abono-tienda-feed.test.ts` «R22» (lista cerrada) |
| R23 | `I/caja-invariante-tiendas.test.ts` (+3 pasos: cobro grande, pago, anulación; R7 y R8 tras cada uno); `caja-derivacion-457` identidad en 500 subconjuntos |
| R24 | `U/guards/caja-clasificacion-459.guardia.test.ts` (+3: propio → rojo, cargo → rojo, parejas); `U/utils/desglose-tienda.test.ts`; `U/utils/caja-tesoreria.test.ts`; `U/utils/aporte-por-orden.test.ts` |
| R25 | service «R25/R29» (choque en la tx), «R25 (reenvío…)», «R25 (dos envíos a la vez)»; integración «R25»; concurrencia «R25»; `I/abono-tienda-457-repositorio.test.ts` (P2002 → `clave_repetida`) |
| R26 | schema «R26»; service «R26» |
| R27 | service «R27»; `U/services/caja-abono-tienda-feed.test.ts` «T2.4» |
| R28, R29, R30 | service «R28», «R29» ×2, «R30»; action «R30» |
| R31–R33 | `U/services/abono-tienda-anulacion.test.ts`; integración «R31–R33/R36–R39»; invariante paso 12 |
| R34 | schema «R34»; action «R34»; anulación «R31/R34/R38 (mutaciones 7 y 8)» (la petición trae `monto: "1.00"`) |
| R35 | schema «R35»; action «R35»; integración |
| R36 | anulación «R36»; integración; concurrencia «R36»; repositorio (P2002 → `ya_anulado`) |
| R37 | anulación «R37» ×2; integración |
| R38 | anulación «R38»; integración; concurrencia «R36» (saldo −10 000) |
| R39 | `caja-derivacion-457` «R39»; integración «R19/R39»; invariante `cambio(12)` |
| R40 | `U/actions/abono-tienda-action.test.ts` «son tres»; service «la superficie pública son TRES métodos» |
| R41 | `U/services/wallet-service.test.ts` (b1/b1r, lector `abonos`); `I/abono-tienda-457.test.ts` «R41» (por `listarMovimientosAction`); repositorio `estadoDeDocumentos`. **UI: `C/WalletLedgerAcciones457.test.tsx`** («Anular…»/«Ver comprobante» solo en la original vigente; «Anulado»; nada en el reverso; `{ abonoId, motivo }` sin monto) |
| R42–R44 | `U/services/abono-tienda-comprobante.test.ts`; integración «R42–R44» |
| R45, R46, R47 | `U/components/wallet-labels.test.ts`, `desglose-tienda-labels.test.ts`, `mi-wallet-labels.test.ts` (diccionarios, 4f47226c). **Tablas, filtros y descargas: `C/WalletLedgerAcciones457.test.tsx` (caja, R45) y `C/DesgloseTiendaAbono457.test.tsx` (`/wallet/tiendas` R46 y `/mi-wallet` R47)** |
| R48 | service «R48» (DTO); integración (sin uuid en descripciones ni en historial). **Pantallas y descargas: `C/WalletLedgerAcciones457.test.tsx` «R48» (×2), `C/DesgloseTiendaAbono457.test.tsx` (tablas y descargas de los dos libros de la tienda, sin uuid ni valor técnico)** |
| R49 | `U/utils/desglose-tienda.test.ts` (`CUBETA` concuerda con el tipo; mutación 4); invariante (saldo de B) |
| R50 | `C/DesgloseTiendaAbono457.test.tsx` «R50» ×2 (pistas literales de las dos cabeceras); `U/components/desglose-tienda-labels.test.ts`, `mi-wallet-labels.test.ts`, `saldo-tienda-card.negativo.test.tsx`, `I/mi-wallet-page.test.tsx` (literales reescritos) |
| R51 | `C/DesgloseTiendaAbono457.test.tsx` (las filas del pago y de su anulación no ofrecen desplegar, en las dos pantallas) |
| R52 | `U/analytics/metrics-caja-naturaleza.guardia.test.ts` (7/25/9; `ganancia_ordenex` 16, `egresos` 10) |
| R53 | `U/guards/nombres-wallet-461.guardia.test.ts` («457/R53»: tomados exactamente por su clave —«Una tienda le paga a Ordenex» también por `CONCEPTOS_MANUALES.label.abono_tienda`, la fila «Diálogo: concepto» de design §2—; contrapruebas con un reservado ficticio) |
| R54, R55 | `U/components/wallet-conceptos-manuales.test.ts` (ocho conceptos, tres grupos, `entra` con tres, frase de efecto y cabecera literales; «⭑ FICHA 457»); `U/components/wallet-registrar-movimiento-dialog.test.tsx` «ofrece los ocho conceptos», «R55» |
| R56 | `wallet-registrar-movimiento-dialog.test.tsx` «R56 (mutación 9)» (claves EXACTAS del `FormData`, clave de idempotencia, `fechaPago`), «R56: la fecha viaja SIEMPRE…», «R56: pide tienda, monto…»; los otros seis payloads, con sus tests de siempre sin tocar |
| R57 | ídem «R57» ×2 (saldo del servidor con signo; «todavía le debe» solo si sigue en contra), «R25/R57: `ya_registrado`… UN solo aviso» |
| R58 | ídem «R58: `sin_deuda`… bajo la TIENDA», «R58: `excede`… bajo el MONTO con la deuda que devolvió el servidor» (aria-describedby del campo) |
| R59 | `C/PagoTiendaAccionesAbono457.test.tsx` (botón solo en contra; a favor y en cero no; concepto y tienda fijos y deshabilitados, sin catálogo; tras registrar relee desglose, comprobantes y tabla de saldos) — mutación 13; `wallet-registrar-movimiento-dialog.test.tsx` «⭑ FICHA 457 (D8)» (props) |
| R60 | registrar: `wallet-registrar-movimiento-dialog.test.tsx` «R57…» (`onRegistrado` + `router.refresh`); anular: `C/WalletLedgerAcciones457.test.tsx` «motivo obligatorio…; el módulo relee» (`onDocumentoAnulado`) |
| R61–R63 | `U/historial-accion/catalogo-y-choke-point.test.ts` («⭑ FICHA 457», 63/41/24); `U/guards/historial-accion-escrituras-cubiertas.guardia.test.ts` (+2 `recibe_tx`); repositorio (sin texto libre); integración |
| R64 | catálogo: el filtro admite los dos tipos. **Pantalla: `C/HistorialAccionesAbonoTienda457.test.tsx`** (opciones del filtro «Acción» con su texto; filas del registro y de la anulación sin nada técnico) |
| R65 | `U/guards/abono-tienda-alcance.guardia.test.ts` (1)(2); integración «R65 (T8.3)» (Σ por origen) |
| R67 | `U/guards/abono-tienda-alcance.guardia.test.ts` (3): **EXACTAMENTE uno** (`toEqual(["abono_tienda"])`, con su ingreso en la caja) + contraprueba sin el concepto; `wallet-conceptos-manuales.test.ts` |
| R68, R69 | `U/asistente/contexto-457.test.ts` (frases literales de design §11 por rol; mensajero/adminTienda/adminSatelite sin la caja; fuentes y fecha), `contexto-461.test.ts` (literal del grupo reescrito), `nombres-wallet-461.guardia` sobre `docs/ayuda/**`, guardias `ayuda-*`/`asistente-*`; cuatro preguntas reales (§11.4) |
| R70–R73 | fotografía `I/caja-caracterizacion-459.test.ts` verde SIN tocar literales; `progress/fase0_457.md` (a)–(e); `liquidacion-idempotencia`, `cobro-tienda-461`, `pago-por-cuenta-tienda` verdes sin tocar (gate) |
| R74 | integración «R74» |
| R75, R76 | `I/abono-tienda-457-migration.test.ts` (a)–(f) + ciclo real §2 |
| R77 | `progress/fase0_457.md` + §7 de esta bitácora |
| R78 | leader (`progress/contraste_457.md`) |
| R79 | recorrido por rol: leader (T9.3; no hecho por el frontend) |

## 7. Mutaciones de la ficha (design §13), con el rojo comprobado

Arnés `mutaciones_457.py` (scratchpad de la sesión) con AUTOCOMPROBACIÓN por mutación: el texto a
mutar aparece EXACTAMENTE una vez → el diff (`--numstat`) no está vacío → vitest SOLO sobre los tests
nombrados → se anotan los `FAIL` y la línea `Tests` (tests ejecutados ≠ 0) → `checkout` del archivo →
diff vacío (si no, aborta). Corrida final sobre la base LIMPIA: **12 de 12 ROJAS**, árbol limpio al
final. Las mutaciones 9 y 13 son de la UI (frontend).

| Mut. | Dónde · cambio | numstat | Resultado | Archivos en rojo | R |
| --- | --- | --- | --- | --- | --- |
| 1 | `AbonoTiendaService.registrar`: `await this.caja.emitirIngresoDeAbono(tx, {` → `await Promise.resolve({` | `1 1` | **ROJO** · `Tests 18 failed | 38 passed (56)` | `abono-tienda-457.test.ts`, `abono-tienda-alcance.guardia.test.ts`, `abono-tienda-service.test.ts`, `caja-invariante-tiendas.test.ts` | R17/R23 |
| 2 | `caja-tesoreria.ts` NATURALEZA: `ingreso_abono_tienda: "terceros"` → `"propio"` | `1 1` | **ROJO** · `Tests 11 failed | 35 passed (46)` | `abono-tienda-457.test.ts`, `caja-clasificacion-459.guardia.test.ts`, `caja-derivacion-457.test.ts`, `caja-invariante-tiendas.test.ts` | R19/R24 |
| 3 | `caja-tesoreria.ts` LIQUIDEZ: `ingreso_abono_tienda: "efectivo"` → `"cargo_a_tienda"` | `1 1` | **ROJO** · `Tests 11 failed | 35 passed (46)` | `abono-tienda-457.test.ts`, `caja-clasificacion-459.guardia.test.ts`, `caja-derivacion-457.test.ts`, `caja-invariante-tiendas.test.ts` | R19/R24 |
| 4 | `desglose-tienda.ts` CUBETA: `abono_tienda: "aFavor"` → `"cargos"` | `1 1` | **ROJO** · `Tests 1 failed | 51 passed (52)` | `desglose-tienda.test.ts` | R49 |
| 5 | `AbonoTiendaService.registrar`: `await this.candado.bloquearBeneficiario(…)` → `void input.tiendaId;` | `1 1` | **ROJO** · `Tests 4 failed | 28 passed (32)` | `abono-tienda-457-concurrencia.test.ts`, `abono-tienda-service.test.ts` | R16 |
| 6 | `reglaDelDinero`: `monto.gt(deuda)` → `monto.gte(deuda)` | `1 1` | **ROJO** · `Tests 4 failed | 34 passed (38)` | `abono-tienda-457.test.ts`, `abono-tienda-service.test.ts` | R15 |
| 7 | `AbonoTiendaService.anular`: `monto: abono.monto` → `(input as { monto?: string }).monto ?? abono.monto` (la petición trae `monto: "1.00"`) | `1 1` | **ROJO** · `Tests 1 failed | 28 passed (29)` | `abono-tienda-anulacion.test.ts` | R34 |
| 8 | `AbonoTiendaService.anular`: `await this.tiendaRepo.crearMovimientos(tx, [` → `await Promise.resolve([` (sin débito) | `1 1` | **ROJO** · `Tests 8 failed | 21 passed (29)` | `abono-tienda-457.test.ts`, `abono-tienda-anulacion.test.ts`, `caja-invariante-tiendas.test.ts` | R31/R23 |
| 10 | `WalletService.tipoDeDocumentoOriginal`: rama del abono → `if (false) {` | `1 1` | **ROJO** · `Tests 3 failed | 48 passed (51)` | `abono-tienda-457.test.ts`, `wallet-service.test.ts` | R41 |
| 11 | `CATEGORIA_MI_WALLET_LABEL`: `abono_tienda: "Le pagaste a Ordenex"` → `"La tienda le paga a Ordenex"` | `1 1` | **ROJO** · `Tests 6 failed | 42 passed (48)` | `mi-wallet-labels.test.ts`, `nombres-wallet-461.guardia.test.ts` | R47/R53 |
| 12 | `CobroTiendaService.ts`: +1 línea `export const MUTANTE_457 = { categoria: "abono_tienda" };` (segundo productor) | `1 0` | **ROJO** · `Tests 2 failed | 7 passed (9)` | `abono-tienda-alcance.guardia.test.ts` | R65 |
| 14 | `…_457_tablas_y_checks/down.sql`: `RAISE EXCEPTION 'rollback 457:` → `RAISE NOTICE …` (borra aunque haya filas) | `1 1` | **ROJO** · `Tests 1 failed | 5 passed (6)` | `abono-tienda-457-migration.test.ts` | R75 |

Casos en rojo (los primeros de cada una):

- **1:** «R1/R5/R17/R18/R20/R21/R22: una sola accion escribe documento, credito, entrada e historial»; «R19/R39: sobre las filas REALES, registrar sube «Entro», la cifra y «De las tiendas» en el»; «R25: la misma clave dos veces -> el pago original y el saldo actual, sin ninguna fila nuev»; «R31–R33/R36–R39: la anulacion deja constancia, debito y egreso por el monto DEL DOCUMENTO,» (+14 más)
- **2:** «R1/R5/R17/R18/R20/R21/R22: una sola accion escribe documento, credito, entrada e historial»; «R19/R39: sobre las filas REALES, registrar sube «Entro», la cifra y «De las tiendas» en el»; «R23–R26, R39/R48/R72/R75: cada camino mueve EXACTAMENTE su cifra»; «R8 (HD2): Δ«De las tiendas» = Σ saldos de las tiendas, SIN excepcion, tras CADA paso — sal» (+7 más)
- **3:** «R19/R39: sobre las filas REALES, registrar sube «Entro», la cifra y «De las tiendas» en el»; «R23–R26, R39/R48/R72/R75: cada camino mueve EXACTAMENTE su cifra»; «R8 (HD2): Δ«De las tiendas» = Σ saldos de las tiendas, SIN excepcion, tras CADA paso — sal»; «(4) literal del contrato: los ocho cargos a una tienda (seis del feed, el cobro y su rever» (+7 más)
- **4:** «R8: la cubeta CONCUERDA con el tipo con el que el sistema emite la categoria»
- **5:** «R16 (mutacion 5): el segundo pago de la MISMA tienda espera y se evalua sobre la deuda ya »; «R16: el segundo pago por EXACTAMENTE lo que queda entra tras esperar y deja el saldo en 0,»; «R16/R17 (mutaciones 1 y 5): candado ANTES de leer el saldo; luego documento, credito y ENT»; «R16: el saldo que DECIDE se lee BAJO el candado: si cambio entre el pre-chequeo y el canda»
- **6:** «R10/R11: tienda inexistente o cuenta que no es tienda -> error en tiendaId; una tienda INA»; «R15/R66: por encima de la deuda -> excede con la deuda del servidor; EXACTAMENTE la deuda »; «R25 (dos envios A LA VEZ): el segundo espera el candado, la regla lo rechazaria, y respond»; «R15/R66 (mutacion 6): pagar EXACTAMENTE la deuda entra y deja el saldo en 0,00; un centimo»
- **7:** «R31/R34/R38 (mutaciones 7 y 8): candado, constancia, DEBITO en la tienda y EGRESO en la ca»
- **8:** «R31–R33/R36–R39: la anulacion deja constancia, debito y egreso por el monto DEL DOCUMENTO,»; «R65 (T8.3): Σ creditos `abono_tienda` = Σ `ingreso_abono_tienda` por origen; tras anular, »; «R23–R26, R39/R48/R72/R75: cada camino mueve EXACTAMENTE su cifra»; «R8 (HD2): Δ«De las tiendas» = Σ saldos de las tiendas, SIN excepcion, tras CADA paso — sal» (+4 más)
- **10:** «R41: el libro de la caja trae `documento.tipo === "abono_tienda"` en la entrada original y»; «UNA consulta por tipo de documento presente, con solo los ids de los originales»; «solo los ORIGINALES llevan documento; contra-asientos, reclasificados y el resto van en nu»
- **11:** «R44: es DISTINTA del nombre desde Ordenex en todo concepto donde una parte actúa sobre la »; «dice exactamente los 16 textos aprobados (14 de la 461 + 2 de la 457), y el seed es exacta»; «las opciones del filtro salen del SEED con la lectura desde la tienda, tras «Todos los con»; «⭑ 457 (R46/R47): el pago de la tienda a Ordenex y su anulacion se leen distinto desde cada» (+2 más)
- **12:** «CONTRAPRUEBA (mutacion 12): un segundo productor se detecta»; «el censo de productores es EXACTAMENTE el servicio»
- **14:** «(d) R75: el down de la migracion 2 ABORTA con UNA fila que use el pago o su anulacion, sin»

**Lo que la invariante SOLA no ve** (medido aparte, solo con `caja-invariante-tiendas.test.ts`): 1, 2, 3
y 8 la ponen roja; **4 y 7 sobreviven a la invariante** y las matan otros: la 4 (`CUBETA`) no cambia ni
la caja ni el saldo derivado —la mata `desglose-tienda.test.ts` «R8: la cubeta CONCUERDA con el tipo»—, y
la 7 es inalcanzable por la action (`.strict()` rechaza el `monto`, R34) —la mata
`abono-tienda-anulacion.test.ts`, que llama al servicio con `monto: "1.00"`—.

**Una corrida intermedia CONTAMINADA, descartada y explicada.** La primera pasada corría la
concurrencia con la mutación 1: sin `emitirIngresoDeAbono` la pausa del test no llega nunca, los tests
agotan su tiempo y su `finally` (limpiar las personas) no corre. Quedaron 19 personas `459e` y una deuda
`cobro_manual` sembrada en el clon, y el paso «cobro completado» de la invariante (que corre el SQL REAL
de la 461 sobre toda la base) completó esa deuda ajena: la invariante dio rojo SIN mutación. Se limpió
el clon con `limpiar459` (script de un solo uso, borrado), la invariante y la fotografía volvieron a
verde (27/27) y el arnés se repitió entero: la tabla de arriba es esa repetición.

## 8. Tests reescritos (ninguno desaparece; cada uno con su R)

| Test | Qué cambió | R |
| --- | --- | --- |
| `U/historial-accion/catalogo-y-choke-point.test.ts` | 61→63, 39→41, 23→24; `not.toContain("abono_tienda_registrado")` → `toContain` con la reapertura de D3 (2026-09-24); caso nuevo «⭑ FICHA 457» | R61–R64 |
| `U/guards/historial-accion-escrituras-cubiertas.guardia.test.ts` | +2 entradas `recibe_tx`; 61→63 | R61, R62 |
| `U/analytics/metrics-caja-naturaleza.guardia.test.ts` | terceros 5→7, `dinero_en_caja` 23→25, diferencia 7→9 | R52 |
| `U/guards/caja-clasificacion-459.guardia.test.ts` | literales intactos; +3 contrapruebas | R24 |
| `U/guards/nombres-wallet-461.guardia.test.ts` | `NOMBRES_RESERVADOS_457` → `NOMBRES_TOMADOS_457`; contrapruebas con `RESERVADO_FICTICIO` | R53 |
| `U/components/wallet-labels.test.ts`, `mi-wallet-labels.test.ts`, `desglose-tienda-labels.test.ts` | +2 categorías, +1 origen, +1 `DOCUMENTO_CAJA_NOMBRE`; 14→16 lecturas desde la tienda | R45–R47 |
| `U/services/wallet-service.test.ts`, `wallet-caja-descarga.test.ts` | lector `abonos`; filas b1/b1r | R41 |
| `U/utils/caja-tesoreria.test.ts`, `desglose-tienda.test.ts` | +2 categorías en los recorridos | R24, R49 |
| `U/analytics/finanzas-diario.test.ts` | +1 caso | R19, R39 |
| `I/caja-invariante-tiendas.test.ts` | +3 pasos (cobro grande, pago, anulación) | R23 |
| `I/caja-459-migration`, `cobro-tienda-461-migration`, `wallet-461-migration` | colas de enum un tramo más atrás (`slice`) | R75 |
| `I/caja-tesoreria-migration` | 23→25 y `AGREGADAS_459` +2 | R75 |
| `I/liquidacion-migration`, `wallet-tienda-cobro-migration`, `historial-accion-cobro-tienda-migration`, `historial-accion-*-migration` (4), `orden-traspaso-migration`, `correccion-resultado-gestion-migration`, `reclasificacion-459-migration` | +2 carpetas / valores POSTERIORES | R75 |
| `I/cobro-tienda-461-completar-migration`, `aporte-capital`, `composicion-detalle-postgres`, `wallet-fecha-elegida` | lector `abonos` en el composition root de prueba | R41 |
| `I/_fixtures/caja-459.ts`, `escrituras-459.ts` | `s.abonoTienda`; `limpiar459` borra los pagos y sus anulaciones; `endeudar457` | — |

## 9. Verificación

Gate COMPLETO `./init.sh` sobre `8bcab3ab`, log `progress/gate_457_backend.log` (sin `tail`, con
`INIT_EXIT=$?` escrito dentro):

```
✓ typecheck paso
✓ lint paso                      (0 errores; 218 avisos, ninguno en archivos de la 457)
✓ DATABASE_URL resuelta: los 295 archivos de tests contra Postgres SI se ejecutan
 Test Files  2252 passed (2252)
      Tests  31715 passed | 26 skipped (31741)
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 2252 ejecutado(s), todos en el baseline conocido)
! migraciones sin down.sql: 20260814120000_… 20260814140000_… 20260814160000_…   (previo, ajeno)
== init OK ==
INIT_EXIT=0
```

**`tests/integration/db`: 0 saltados** (383 archivos `✓`, ninguno `↓`; los 26 `skipped` son
`tests/components/AnaliticaPage.test.tsx` (17) y `AnaliticaShell.test.tsx` (9), ajenos).

**La primera corrida del gate (sobre `a7bd1186`) fue ROJA: 5 archivos, 10 tests, todos de esta
ficha**, y se arreglaron en `8bcab3ab`:

| Rojo | Causa | Arreglo |
| --- | --- | --- |
| `orden-incidente-migration` (R40 del down) | censo de orígenes POSTERIORES sin `abono_tienda` (el WIP no lo alineó) | `+ "abono_tienda"` |
| `premio-ranking-devengo-migration` | ídem | ídem |
| `api-key-dependencias-usuario.guardia` (×6) | tres FK nuevas hacia `usuario` sin clasificar | `AbonoTienda.tienda` (R10: rol `adminTienda`), `.registrador` y `AbonoTiendaAnulacion.anulador` (solo operador), `no_alcanzable` |
| `catalogo-postgres-acota-esquema.guardia` | el test (f) de migración leía `pg_constraint` sin acotar el esquema | `JOIN pg_namespace … nspname = 'public'` |
| `superficie-de-uso.guardia` | `registrarAbonoTiendaAction` aún no tiene pantalla (Fase 6) | `@sin-superficie` TRANSITORIA con su motivo; **la T6.4 del frontend la borra** |

Los cinco archivos, aislados tras el arreglo: 6/6 archivos, 99/99 tests.

Antes del gate, fuera de él: `pnpm run typecheck` → exit 0; `pnpm run lint` → exit 0 (0 errores).
Fotografía `caja-caracterizacion-459.test.ts` e invariante: verdes (27/27) sin tocar los literales de
la fotografía.

## 10. Pendiente

- **Frontend (Fase 6 y 7 de `tasks.md`):** concepto en el diálogo, botón del desglose, pistas de
  cabecera (R50), descargas, historial en pantalla, ayuda y asistente (R68/R69), y apretar la guardia
  de alcance (3) a «exactamente uno». Mutaciones 9 y 13 (y la 11 sobre tablas/descargas).
  **Y borrar el `@sin-superficie` transitorio de `registrarAbonoTiendaAction`** al cablear el diálogo.
- **Leader:** R78 (contraste en producción antes/después), R79 (recorrido por rol).
- El `design.md` §5.1 debería reflejar el orden nuevo de la clave (R25) —anotado aquí, no lo toco—.

**Veredicto:** backend de la 457 completo y verde (gate completo `INIT_EXIT=0`, 0 saltados en `integration/db`, 12/12 mutaciones del dinero rojas); falta la UI (Fase 6-7) y R78/R79 del leader.

**Entorno al cerrar:** el clon `ordenex_457` se BORRÓ (0 conexiones vivas medidas antes del `DROP DATABASE`) y el `.env` de este worktree también. El `.env` del worktree del agente anterior (`agent-a97bb7d8335763b13`) apunta a esa base, que ya no existe. El `frontend_dev` necesita su propio clon (`CREATE DATABASE … TEMPLATE ordenex` + `prisma migrate deploy`) para su gate.

## 11. Frontend (Fases 6 y 7) — `frontend_dev`, worktree `agent-a5ac5d03ce3d25807`

**Rama:** `wt/457-frontend` (de `origin/feature/457-backend` @ `11d6993c`), empujada a
`origin/feature/457-backend`. **Base:** clon `ordenex_457f` (`TEMPLATE ordenex` + `prisma migrate deploy`:
las dos migraciones de la ficha aplicadas); `.env` del worktree = el del checkout principal con la base
cambiada (copiado sin imprimirlo). `pnpm install` propio, sin junction. **Búsqueda:** el MCP
`codebase-memory` NO estaba en el conjunto de herramientas de esta sesión: todo se leyó con `grep` y
lectura directa de los archivos reales. Ningún dev server levantado.

### 11.1 Commits

| SHA | Qué |
| --- | --- |
| `efe15944` | Octavo concepto, diálogo (`formDataAbono`, respuestas, props D8), botón del desglose, pistas R50, borra el `@sin-superficie`, guardia de alcance (3) a EXACTAMENTE uno |
| `72d02fb3` | Tests nuevos: `PagoTiendaAccionesAbono457`, `WalletLedgerAcciones457`, `DesgloseTiendaAbono457`, `HistorialAccionesAbonoTienda457` |
| `f312a6f5` | Ayuda (caja, tiendas, Mi wallet) con las frases de design §11 + `contexto-457.test.ts` |
| (este) | bitácora |

### 11.2 Lo que cambió en la UI (pantallas)

- **`/wallet` — «Registrar movimiento»** (`wallet-conceptos-manuales.ts`, `RegistrarMovimientoCajaDialog.tsx`):
  ocho conceptos; «Llega dinero a la caja» = Aporte de dinero a la caja · **Una tienda le paga a Ordenex** ·
  Corrección de caja (suma). Con el concepto: frase de efecto de §8.2, frase del libro con los dos nombres,
  cabecera de §8.1, campos tienda («Tienda que paga» + pista), monto, fecha SIN ventana hacia atrás (`min`
  ausente, `max` hoy), «Motivo del pago», método, referencia (solo SINPE/transferencia), comprobante
  opcional. `formDataAbono()` = SOLO `claveIdempotencia, tiendaId, monto, metodo, referencia?, motivo,
  fechaPago, comprobante?` (la fecha viaja SIEMPRE). `ok`/`ya_registrado` → un aviso con el saldo del
  servidor (`TEXTO_ABONO.registrado`); `sin_deuda` → bajo la tienda; `excede` → bajo el monto con
  `money(res.deuda)`; `comprobante_no_guardado` → aviso general; `validation_error` con `fechaPago` → bajo la
  fecha. Props D8 `conceptoInicial`, `tiendaFija`, `etiquetaBoton`; sin props, el diálogo es byte a byte el
  de antes (los tests existentes, sin tocar salvo el conteo 7→8, lo fijan).
- **`/wallet` — el libro**: nada de código nuevo (la rama `ACCIONES.abono_tienda` la cableó el backend en
  `4f47226c`); ahora con test de pantalla propio.
- **`/wallet/tiendas` — desglose** (`PagoTiendaAcciones.tsx`): «Registrar pago de la tienda a Ordenex»
  (`ABONO_TIENDA_TEXTO.abrir`) solo con `signo === "negativo"`, que monta el MISMO diálogo con
  `conceptoInicial="abono_tienda"`, `tiendaFija` y `onRegistrado = refrescarEstaTienda` (desglose,
  comprobantes y tabla de saldos). Pistas de cabecera nuevas (R50).
- **`/mi-wallet`**: pistas de cabecera nuevas (R50). Tabla, filtro y descarga ya decían «Le pagaste a
  Ordenex» / «Ordenex anuló el pago que le hiciste» por el diccionario (backend); ahora con test de pantalla.
- **`/historico/acciones`**: sin código nuevo (catálogo del backend); test de pantalla propio (R64).
- **Ayuda**: `docs/ayuda/oficina/wallet-caja.md`, `oficina/wallet-tiendas.md`, `tienda/mi-wallet.md`.
- `lib/actions/abono-tienda.ts`: borrado el `@sin-superficie` transitorio (solo el comentario).

**L2 medido (T6.4):** `WalletTiendaMovimientoRepository.listarSaldosTodasTiendas` agrupa
`wallet_tienda_movimiento` por `tienda_id` y lee `usuario` SIN filtrar por estado: **una tienda inactiva con
movimientos SÍ sale en `/wallet/tiendas`**, así que su deuda se paga desde su desglose (`tiendaFija`). El
catálogo del diálogo (`listarAdminTiendas`) sigue siendo solo de tiendas activas.

### 11.3 Tests reescritos (ninguno desaparece; cada uno con su R)

| Test | Qué cambió | R |
| --- | --- | --- |
| `U/components/wallet-conceptos-manuales.test.ts` | siete → ocho (ids, nombres, libros, categorías de caja 7→8, grupos, frases); +describe «⭑ FICHA 457»; `nombreEnElLibroDeLaTienda` del abono | R54, R55, R67 |
| `U/components/wallet-registrar-movimiento-dialog.test.tsx` | «ofrece los ocho conceptos» (+«Una tienda le paga a Ordenex»), 7→8 opciones en el caso 85/R25; +mock de `abono-tienda`; +15 casos 457 | R54–R58 |
| `U/guards/abono-tienda-alcance.guardia.test.ts` | (3) «como mucho uno» → `toEqual(["abono_tienda"])` + contraprueba sin el concepto | R67 |
| `U/guards/nombres-wallet-461.guardia.test.ts` | `NOMBRES_TOMADOS_457[].tambien` (la fila «Diálogo: concepto» de §2); `CONCEPTOS_MANUALES.label` por id en `DICCIONARIOS_POR_NOMBRE`; +1 caso | R53 |
| `U/components/desglose-tienda-labels.test.ts`, `mi-wallet-labels.test.ts`, `saldo-tienda-card.negativo.test.tsx`, `I/mi-wallet-page.test.tsx` | literales de las pistas de cabecera (design §2) | R50 |
| `U/asistente/contexto-461.test.ts:78` | el grupo «Llega dinero a la caja» con tres conceptos; «siete» → «ocho» en el nombre del caso | R68 |

### 11.4 El asistente, preguntado de verdad (T7.2)

Scripts de un solo uso (borrados; salida en el scratchpad de la sesión): mismo
`instruccionesDelSistema(rol)` + `contextoPara(docs, rol)` que `/api/asistente`, `AnthropicAsistenteClient`,
`ANTHROPIC_API_KEY` del `.env` (no impresa), modelo `claude-sonnet-5`.

- **[maestro] «¿cómo registro que Nuform me pagó?»** — correcta: los dos caminos (desglose de la tienda con
  **Registrar pago de la tienda a Ordenex**, «solo aparece si Nuform tiene saldo **en contra**»; y
  **Registrar movimiento** → **Una tienda le paga a Ordenex** en «Llega dinero a la caja»), monto hasta lo
  que debe, fecha real, referencia obligatoria en SINPE/transferencia. `[[doc:oficina/wallet-tiendas]]
  [[doc:oficina/wallet-caja]]`
- **[maestro] «¿sube la ganancia si una tienda me paga?»** — correcta: «No, la ganancia no se mueve […]
  **Entró** y la cifra grande suben […] **Lo que Ordenex les debe a las tiendas** sube […] esa plata ya se
  había contado como ganancia cuando se aprobaron los cierres». `[[doc:oficina/wallet-caja]]`
- **[admin] «¿cómo anulo un pago de una tienda?»** — correcta en lo que llega a decir (distingue el pago de
  Ordenex a la tienda, que se anula en **Wallet · Tiendas**, del pago de un gasto y del pago de la tienda a
  Ordenex, que se anulan en la caja) **pero se CORTA a media frase las dos veces que se preguntó**: la
  segunda corrida informó `tokens salida 1024` = `MAX_TOKENS_DEFAULT` de
  `lib/clients/anthropic-asistente.ts:37`. **Hallazgo fuera del alcance de esta ficha:** con el tope de
  1024 y `claude-sonnet-5`, una respuesta que enumera tres casos se trunca también en producción. No lo
  toco (es `lib/clients`, no UI); queda para el leader.
- **[adminTienda] «¿qué es Le pagaste a Ordenex?»** — correcta: «cuando tu saldo había quedado en contra […]
  **sube tu saldo** […] "Ordenex anuló el pago que le hiciste" […] el comprobante de ese pago lo guarda la
  oficina». `[[doc:tienda/mi-wallet]]` (7 documentos en el contexto, ninguno de la oficina: R69).

### 11.5 Mutaciones de la UI (design §13), con el rojo comprobado

Arnés `mutaciones_457f.py` (scratchpad) con autocomprobación: el texto a mutar aparece EXACTAMENTE una vez →
`git diff --numstat` no vacío → vitest SOLO sobre los tests nombrados → línea `Tests` → `git checkout` →
diff vacío (si no, aborta). Árbol limpio al final (`git status --porcelain -- app` vacío).

| Mut. | Dónde · cambio | numstat | Resultado | Casos en rojo | R |
| --- | --- | --- | --- | --- | --- |
| 9 | `formDataAbono`: se quita `fd.set("claveIdempotencia", clave);` | `0 1` | **ROJO** · `Tests 3 failed \| 67 passed (70)` | «R56 (mutación 9): el FormData lleva EXACTAMENTE sus claves…», «R56: la fecha viaja SIEMPRE…», «(D8) registra con el id de la tienda FIJA…» | R56 |
| 13 | `PagoTiendaAcciones`: `const tiendaDebe = signo === "negativo";` → `const tiendaDebe = false;` | `1 1` | **ROJO** · `Tests 3 failed \| 39 passed (42)` (con `pago-tienda-acciones` y `wallet-tiendas-pago`, que siguen verdes) | «con saldo negativo, el desglose ofrece…», «concepto… y tienda… deshabilitados», «tras registrar, se releen…» | R59 |
| 11 (tablas/descargas) | `CATEGORIA_MI_WALLET_LABEL.abono_tienda` → «La tienda le paga a Ordenex» | `1 1` | **ROJO** · `Tests 3 failed \| 5 passed (8)` sobre `DesgloseTiendaAbono457` | tabla, descarga y filtro de `/mi-wallet` | R47 |

### 11.6 Verificación

Gate COMPLETO `./init.sh` contra `ordenex_457f`, sobre `fd471b7e`, log `progress/gate_457_frontend.log`
(sin `tail`, con `INIT_EXIT=$?` escrito dentro):

```
✓ typecheck paso
✓ lint paso
✓ DATABASE_URL resuelta: los 295 archivos de tests contra Postgres SI se ejecutan
 Test Files  2257 passed (2257)
      Tests  31782 passed | 26 skipped (31808)
== init OK ==
INIT_EXIT=0
```

**`tests/integration/db`: 0 saltados.** Los 26 `skipped` (leídos de `.vitest/rojos.json`) son
`tests/components/AnaliticaPage.test.tsx` (17) y `AnaliticaShell.test.tsx` (9), ajenos y los mismos que
en el gate del backend.

**La primera corrida (`progress/gate_457_frontend_a.log`) fue ROJA por 4 archivos AJENOS a la ficha**, los
modos de flake bajo carga ya conocidos: `censo-simpe.test.ts` y `buckets-estatus.guardia.test.ts`
(timeout de 20 s en un barrido del árbol), `455/seed.test.ts` (deadlock `40P01`) y
`ajuste-caja-anulacion-461.test.ts` (conteo global 40 ≠ 41 por un test concurrente). Aislados, 3 de 3
corridas verdes (4/4 archivos, 39/39 tests) sin tocar nada; la segunda corrida completa, arriba, verde.

### 11.7 Pendiente

- **Leader:** R78 (contraste en producción) y R79 (recorrido por rol de design §17, T9.3), T9.1 (repetir las
  14 mutaciones sobre el árbol final: aquí se corrieron las de la UI, 9 y 13, y la 11 sobre tablas).
- El tope de 1024 tokens del asistente (§11.4): trunca respuestas de tres casos. Fuera de la ficha.
- `design.md` §5.1 y el orden de la clave (R25): sigue anotado en §10, sin tocar.

