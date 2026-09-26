# 458-C «Registrar un movimiento y panel Ver» — bitácora del frontend_dev

**Rama:** `feature/458-C` con `git checkout -B feature/458-C origin/dev` sobre `d5db5d63` (contiene la
458-A, la 458-B, la 457 y la 461; comprobado con `git merge-base --is-ancestor d5db5d63 HEAD`).
**Base:** clon propio `ordenex_458c` (`CREATE DATABASE … TEMPLATE ordenex`, 0 conexiones a la plantilla
medidas antes; `prisma migrate deploy`: «No pending migrations»; `migrate status` → `ordenex_458c` en
`localhost:5432`). `.env` del checkout principal con la base cambiada y SIN `DATABASE_URL_PREVIEW`,
copiado sin imprimirlo. `pnpm install --frozen-lockfile` propio, sin junction. La base `ordenex` solo
como plantilla; `feature_list.json` sin tocar. **Búsqueda:** MCP `codebase-memory` disponible, pero su
índice está rancio para la 458-B (`search_graph` no conoce `comoQuedoAction`, `verComprobanteAction` ni
`DocumentoCajaAcciones`; solo devolvió `reversarEgresoAdministrativoAction`): cada símbolo se confirmó con
`grep`/lectura del archivo real.

**Fotografías antes** (`progress/fotografias_458C_antes.log`): `caja-caracterizacion-459` +
`wallet-caracterizacion-458` → 2 archivos, **36/36** verdes, `EXIT=0`.

## TC.0 — Lo que esta hija da por hecho, confirmado en `dev` (`d5db5d63`)

| Pieza | En `dev` | Difiere |
| --- | --- | --- |
| Actions de la 457 | `registrarAbonoTiendaAction(FormData)`, `anularAbonoTiendaAction({abonoId, motivo})`, `obtenerComprobanteAbonoAction({abonoId})` en `lib/actions/abono-tienda.ts:107/125/142` | no |
| Textos reservados de la 457 | `NOMBRES_TOMADOS_457` de `tests/unit/guards/nombres-wallet-461.guardia.test.ts`: «Una tienda le paga a Ordenex» (caja + concepto), «Pago de una tienda a Ordenex anulado», «La tienda le paga a Ordenex», «Le pagaste a Ordenex» | no |
| El test que fija «siete conceptos» (461 R39) | Ya no decía siete: la 457 lo llevó a OCHO en `tests/unit/components/wallet-conceptos-manuales.test.ts` («son exactamente OCHO … 461-R39 / 457-R54») y en el test del diálogo («ofrece los ocho conceptos») | sí: son ocho, no siete. Se reescriben con la lista de DIEZ como contrato (R37) |
| Contratos de la 458-B | `previsualizarMovimientoAction` (`lib/actions/efecto-movimiento.ts`, clave `ConceptoRegistro`), `comoQuedoAction` (`{destino: {libro, movimientoId}}`), `anularMovimientoAction` (`{destino, motivo}`; enruta TODA fila de la caja por su camino), `adjuntarComprobanteAction(FormData destino JSON + comprobante)`, `verComprobanteAction({destino})` con `rotulo {fuente, categoria, fecha}`, `autoriaDelLibroCajaAction({movimientoIds})`; registros con `FormData` (egreso, corrección, cobro, pago a tienda, reparto) | no |
| `SelectorBuscable` (458-A) | `components/shared/SelectorBuscable.tsx`; el disparador es un `PopoverTrigger` y su `disabled` no llega como atributo `disabled` (Base UI) | sí: con la cuenta FIJA el diálogo pinta un campo de solo lectura en vez del selector |
| D5 en el servidor | `lib/types/wallet-laterales.ts`: «a quién» opcional en sueldo y gasto (TB.11) | se cierra aquí (excepción autorizada por el leader) |

## TC.1 — `RegistrarMovimientoDialog` (R37–R43, R48, R49, R51, R52) y D5 en el servidor

**Piezas:** `components/shared/wallet/RegistrarMovimientoDialog.tsx` (catálogo en tres `radiogroup` a la
izquierda, formulario a la derecha, «Así queda» debajo; `Modal size="xl"`), `registrar-movimiento-labels.ts`
(textos; los heredados de 381/459/457 byte a byte), `ComprobanteCampo.tsx`, `AsiQueda.tsx`. El catálogo
sigue en `app/(app)/wallet/_components/wallet-conceptos-manuales.ts`, ampliado a DIEZ: `pago_a_tienda`
(clase `pago_tienda`, caja `egreso_pago_tienda` + tienda `pago_tienda`) y `pago_a_mensajero` (clase
`pago_mensajero`, sin línea de caja, libro del mensajero `liquidacion`), `CONCEPTO_REGISTRO_DE`
(`Record` total → `ConceptoRegistro` del servidor), `cuentaDelConcepto`, `aQuienDelConcepto`.
`RegistrarMovimientoCajaDialog.tsx` se BORRA; `WalletModule` y `PagoTiendaAcciones` (457 D8, con
`cuentaFija`) montan el nuevo. El enlace a plantillas va a `/wallet#gastos-fijos` (la sección gana `id`).

Frases de efecto: las siete de la 461 y la de la 457 sin tocar un byte (el test las afirma literales);
las dos nuevas: «Sale dinero de Ordenex hacia la tienda y baja lo que Ordenex le debe; la ganancia no
cambia.» y «Ordenex le paga al mensajero lo que le debe por sus cierres y baja su cuenta por pagar; la
ganancia no cambia.» (ninguna frase retirada de la 461; la guardia `nombres-wallet-461` verde).

`FormData` por concepto (R39; se afirma la lista ENTERA de claves en el test):

| Concepto | Action | Claves |
| --- | --- | --- |
| Gasto de Ordenex / Sueldo | `registrarEgresoAdministrativoAction` | `claveIdempotencia, monto, tipoEgreso, descripcion, [fecha], contraparteNombre, [referencia], [comprobante]` |
| Corrección (suma/resta) | `registrarMovimientoManualAction` | `claveIdempotencia, monto, tipo, categoria, descripcion, [fecha], [contraparteNombre], [referencia], [comprobante]` |
| Cobro a una tienda | `registrarCobroTiendaAction` | `claveIdempotencia, monto, tiendaId, descripcion, [fecha], [comprobante]` |
| Pago de un gasto de una tienda | `registrarPagoPorCuentaTiendaAction` | las de la 459, sin cambio |
| Aporte | `registrarAporteCapitalAction` | las de la 459, sin cambio |
| Una tienda le paga a Ordenex | `registrarAbonoTiendaAction` | las de la 457, sin cambio |
| Ordenex le paga a una tienda | `registrarPagoTiendaAction` | `claveIdempotencia, monto, tiendaId, metodo, [referencia], nota, fechaPago, [comprobante]` |
| Ordenex le paga a un mensajero | `registrarRepartoMensajeroAction` | `claveIdempotencia, monto, mensajeroId, metodo, [referencia], nota, fechaPago, [comprobante]` |

**D5 (servidor, excepción autorizada):** `registrarEgresoConLateralesSchema` gana un `superRefine`: sin
«a quién» (ausente, vacío o solo espacios, que el preprocess ya vuelve ausente) → `validation_error` en
`contraparteNombre` con «Escribí a quién se le pagó.»; la corrección sigue opcional. Tests del borde:
bloque «458-C D5» de `tests/unit/actions/wallet-egresos-actions.test.ts` (6 casos + FormData + control) y,
contra Postgres, `wallet-registro-comprobante-458.test.ts` (C2: sin «a quién» → 0 filas).

### Tests retirados o reescritos en TC.1 (cada uno con su sustituto)

`tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx` se REESCRIBE entero (su componente
se borra). Bloque a bloque:

| Bloque del archivo anterior | Sustituto (mismo archivo, nuevo) | R |
| --- | --- | --- |
| «el selector ofrece los ocho conceptos…», «no ofrece Gasto fijo», «un movimiento no es periódico» | «R37/R38 — el catálogo…» (diez en tres `radiogroup`; sin gasto fijo; enlace a plantillas). Lo de la periodicidad lo cubre que el único campo de fecha es «Fecha» (bloque «la fecha») | R37, R38 |
| «dice con qué nombre saldrá en el libro (R4)» | «R52: dice en qué libro cae…» | R52 |
| «el enrutado por concepto (R5–R8)» | «R39/R42/R43/R51 — cada concepto…» (lista ENTERA de claves por concepto) | R39 |
| «validación de cliente (R13/R14)» | «R43: monto, fecha y motivo en los diez…» | R43 |
| «la fecha del movimiento (R19–R23, R32)» | bloque «458-C — la fecha del movimiento» (hoy CR, no viaja si no se toca, viaja tal cual, futura rechazada, pagos sin ventana) y «R49: …cada motivo bajo SU campo» (fecha del borde) | R43, R49 |
| «tras registrar avisa al módulo y refresca (R18)» | «R48: tras registrar avisa, cierra, avisa al módulo y refresca» | R48 |
| «los avisos hablan de vos (R31)», «los cuatro campos por su etiqueta (R32)» | los textos se leen literales en todo el archivo; cada campo se alcanza por su etiqueta (`getByLabelText`) | R43 |
| 381: campo de tienda condicional, catálogo, catálogo caído, sin tienda, payload del cobro, doble clic, éxito con saldo, rechazos | «R40/R41 — la cuenta…» (lista al abrir, filtro por nombre, lista caída bloquea SOLO ese concepto, sin cuenta no llama) + «cobro a una tienda: …FormData sin tipo ni categoría» (aviso con el saldo del servidor en negativo). El doble clic lo sigue cubriendo `Modal` (fase `pending`) y la clave (R51). **Corregido en el cierre (B1):** el doble ENVÍO (`ya_registrado`, 461 R68) no lo medía nada; ahora «458-C B1 — 461 R68: `ya_registrado`… en los ocho caminos» (aviso literal, sin toast de error, cierra) | R41, R48, R51, 461 R68 |
| 459: frase del efecto, pago por cuenta (R61–R63), cobro sin claves de más (R64), aporte (R27/R68/R70) | «R39/R52 — la frase…» (las diez literales), «pago de un gasto de una tienda…», «aporte: … monto vacío, sin ejemplo, fecha SIEMPRE». **Corregido en el cierre (B1):** esos dos casos solo miraban las claves del `FormData`; el aviso de éxito del pago de un gasto con el saldo y su signo (R63, en contra y a favor), el del saldo inicial («Registrado. Saldo inicial de ₡2.500.000,50.», R68), el del aporte y `ya_hay_saldo_inicial` bajo la clase (R70) se miden ahora en los bloques «458-C B1 — los avisos de éxito…» y «…los rechazos del servidor…» | R39, R43, 459 R63/R68/R70 |
| 457: el pago de una tienda en el diálogo (R54–R58) y el diálogo con concepto y tienda FIJOS (D8) | «una tienda le paga a Ordenex: …`fechaPago`, siempre» y «R40: con concepto y cuenta fijos…» (+ `PagoTiendaAccionesAbono457.test.tsx` adaptado). **Corregido en el cierre (B1):** el primero solo mira las claves del `FormData`, no R57/R58; ahora el aviso de éxito con el saldo del servidor y «todavía debe» (y sin «debe» en cero), `ya_registrado` con el importe que QUEDÓ (m7), `sin_deuda` bajo la tienda y `excede` bajo el monto con la deuda del servidor, en «458-C B1 — …» | R40, R50, 457 R57/R58 |

Otros tests tocados en TC.1: `wallet-conceptos-manuales.test.ts` (ampliado; «OCHO» → «DIEZ» como contrato
nuevo, R37 supera 461-R39), `wallet-egresos-actions.test.ts` (D5; cuatro entradas ganan «a quién»),
`wallet-registro-comprobante-458.test.ts` (C deja de ser «gasto sin campos nuevos»: D5 lo supera; C2
nuevo), `wallet-documento-comprobante-458.test.ts` y `wallet-comprobante-alcance.test.ts` (sus sueldos
ganan «a quién»; lo que miden no cambia), `wallet-page.test.tsx` («Registrar movimiento» → «Registrar
un movimiento», R37), `PagoTiendaAccionesAbono457.test.tsx` (el concepto fijo es un radio; la tienda fija,
un campo de solo lectura), `caja-textos-459.guardia` (la regla R27 apunta al diálogo nuevo),
`lib/actions/efecto-movimiento.ts` (fuera `@sin-superficie`: la guardia de superficie lo exige).

**Nota de commits:** el borrado de `RegistrarMovimientoCajaDialog.tsx` (TC.1) viajó en el commit de TC.0
(`9a5bd951`) y los de `DocumentoCajaAcciones.tsx`, `WalletLedgerAcciones458.test.tsx` y
`wallet-ledger-reversa.test.tsx` (TC.5) en el de TC.4 (`5bb04fb8`): ya estaban en el índice por `git rm`.
Los mensajes de TC.1/TC.5 lo dicen; el contenido de la rama es el mismo.

## TC.2 — «Así queda» (R44–R47, R90)

`components/shared/wallet/AsiQueda.tsx`: pide `previsualizarMovimientoAction({ concepto, cuentaId?, monto })`
con retardo (400 ms) y con SWR por clave `(concepto, cuenta, monto)`; nunca sin un monto válido ni, si el
concepto la lleva, sin la cuenta. Cargando («Calculando cómo queda…»), error sin ninguna cifra (R46),
«no cambia» por línea (R45), aviso de saldo en contra con el saldo y su signo (R47), tope decidido por el
servidor (`superaDisponible`, pago a una tienda y pago de la tienda). La cifra principal se rotula con
`rotuloCifraPrincipal` sobre el ESTADO que manda el servidor. Guardia nueva
`tests/unit/guards/wallet-money-safe-458.guardia.test.ts` (R90): ningún archivo de
`components/shared/wallet/**` convierte a número (`Number(`, `parseFloat(`, `parseInt(`, `Number.parse*`,
`+monto`), con contraprueba y no-vacuidad (≥ 8 archivos; las tres piezas nuevas en el censo).

## TC.3 — Comprobante (R74–R76, R79, R80)

`ComprobanteCampo.tsx`: opcional en los DIEZ conceptos; `problemaDeComprobante` avisa tipo y tamaño antes
de enviar y el archivo que no pasa no viaja (R75); `comprobante_no_guardado` es un aviso general y el
diálogo sigue abierto (R76). En el panel: «Adjuntar comprobante» solo sin comprobante, en filas cuyo
comprobante es lateral (egreso, corrección, cobro, indemnización) y NO anuladas (m6 de la 458-B);
`FormData { destino (JSON), comprobante }`; `ya_tiene`, `no_admite` (sus tres motivos, incluido `anulado`),
`comprobante_no_guardado`, `no_encontrado` en palabras. **Heredado de la 458-B (M1):** «Ver comprobante»
va SIEMPRE al servidor por `verComprobanteAction({ destino })` —ya no hay rama que responda «sin
comprobante» sin preguntar— y se nombra por un rótulo legible («Comprobante de «Sueldo» del 2026-09-12»),
nunca por la ruta (R80).

## TC.4 — Panel «Ver» y «Anular…» (R58, R63–R67, R71, R72, R100)

`DetalleMovimientoPanel.tsx` (Sheet, compartido): quién (`autoriaDelLibroCajaAction`, una fila por
lectura), por qué, de dónde sale, cómo (si la superficie lo conoce), comprobante, registró («Automático ·
<acción> por <quién>» para lo automático), estado decidido por el servidor («Vigente», «Anulado»,
«Anulado · motivo no registrado», o con fecha/quién/motivo si la superficie los trae), «Cómo quedó» por
`comoQuedoAction` (cargando / error sin cifras / «no tiene línea en la caja») y «Anular…» solo si la fila
es `anulable`. `AnularMovimientoDialog.tsx` (molde `AnularPagoDialog`): `anularMovimientoAction({ destino,
motivo })` sin monto; `ya_anulado` cierra con «Ya estaba anulado; no se registró nada más.»;
`no_anulable` con sus seis motivos en palabras, dentro del diálogo. R100/R73: el cobro por rechazo dice
que es un cargo y, anulado, que la ganancia bajó y que no se vuelve a ofrecer.

**Anotado (sin cambio de servidor, como se pidió):** para las filas del libro de la caja
`WalletMovimientoDTO` no trae (a) quién anuló y cuándo —el panel dice «Anulado» y, si aplica, «motivo no
registrado»; el motivo, quién y cuándo los pinta si la superficie los manda (`FilaEstadoCuentaDTO.anulacion`
de la 458-D ya los trae)—, (b) el método y la referencia de los documentos, (c) el instante de registro
(«cuándo lo registró»: se pinta la fecha del movimiento). Cerrarlo pide ampliar el DTO del libro: 458-E o
una ficha propia.

## TC.5 — El libro de la caja actual con «Ver» (D11)

`WalletLedger`: la columna «Acciones» pasa a «Ver» en TODA fila (`VerMovimientoCaja`, con el nombre
accesible «Ver <concepto> del <día> por <importe>»); fuera «Reversar», su `Modal` y la deducción EN EL
CLIENTE de «ya reversado» (461 P3) —el estado viaja en la fila desde la 458-B—; la fila anulada se pinta
`line-through` + `text-muted-foreground` por `rowClassName` con el `documento` del servidor.
`DocumentoCajaAcciones.tsx` se borra; toda anulación del libro va por `anularMovimientoAction({ destino:
{ libro: "caja", movimientoId: <id de la fila> } })` y el servidor elige el camino. `WalletModule` pasa
`onCambio` (relee libro, tarjetas, composición y desglose). `REVERSA_EGRESO_ACCION` sale de
`wallet-labels.ts`.

Cambios de comentario en `lib/actions` que la guardia `superficie-de-uso` exige (ningún cambio de código):
fuera `@sin-superficie` de `previsualizarMovimientoAction`, `comoQuedoAction`, `adjuntarComprobanteAction`,
`verComprobanteAction` y `autoriaDelLibroCajaAction` (ya tienen superficie); `@sin-superficie` NUEVO en
`reversarEgresoAdministrativoAction` (D11) y en `obtenerComprobanteAbonoAction`,
`obtenerComprobanteAporteCapitalAction` y `obtenerComprobantePagoPorCuentaAction` (el panel pide todo
comprobante por `verComprobanteAction`; la 458-D decide si `/mi-wallet` las usa); comentarios de
`anularEgresoCajaAction`, `anularMovimientoAction` y `anularCobroTiendaAction` al día.

### Tests retirados o reescritos en TC.3–TC.6 (cada uno con su sustituto)

| Test retirado / reescrito | Sustituto | R |
| --- | --- | --- |
| `tests/components/WalletLedgerAcciones458.test.tsx` (entero: qué filas nuevas ofrecen «Anular…», la acción única con el id de la fila, `ya_anulado`, `no_anulable`) | `tests/components/WalletLedgerVer458C.test.tsx` («R63/R64 — «Anular…» desde el panel…», las diez filas anulables incluidas indemnización y cobro por rechazo; «R65 …NO ofrece») + `AnularMovimientoDialog.test.tsx` (`ya_anulado`, `no_anulable` ×6) | R63–R66 |
| `tests/unit/components/wallet-ledger-reversa.test.tsx` (entero: «Reversar» visible en egresos administrativos; confirmar la reversa) | `WalletLedgerVer458C.test.tsx` («TODA fila tiene «Ver»…; no quedan «Reversar» ni «Anular…»», «sueldo»/«gasto de Ordenex» anulables por el panel con motivo) | R63, D11 |
| `WalletLedgerAcciones457.test.tsx` — «457/R41 — qué filas del pago ofrecen acciones», «anular un pago desde el libro», «ver el comprobante del pago» | `WalletLedgerVer458C.test.tsx` («pago de una tienda a Ordenex» anulable por la acción única; «R71 … tachada»; «TC.3 Ver comprobante… por el destino de la fila»). **Corregido en el cierre (B2):** «tachada» solo miraba `className`; el literal «Anulado» en la fila (457 R41) lo mide «458-C revisión B2 — la fila anulada del libro DICE «Anulado»» | R63, R71, R80, 457 R41 |
| `WalletLedgerAcciones459.test.tsx` — «FICHA 459 — qué filas ofrecen acciones», «anular desde el libro», «ver el comprobante» | ídem («pago de un gasto de una tienda» y «aporte» por la acción única; «R65: un contra-asiento… NO ofrece»; «Ver comprobante» del pago de un gasto). **Corregido en el cierre (B2):** el literal «Anulado» de la fila (459 R66), en «458-C revisión B2 — …» | R63, R65, R80, 459 R66 |
| `WalletLedgerAcciones461.test.tsx` — «461 — qué líneas del cobro ofrecen acciones», «anular un cobro desde el libro», «la corrección de caja ofrece «Anular…»», «auditoría P3 (461) — Reversado» | ídem («cobro de Ordenex» y «cobro completado por la migración», «corrección»; «R71/R72 …«Anulado · motivo no registrado» (lo trae SU fila)»; el contra-asiento no se tacha) + guardia R98 existente. **Corregido en el cierre (B2):** «Anulado · motivo no registrado» es el PANEL, no la fila; el literal «Anulado» en la fila (461 R20/R71) lo mide «458-C revisión B2 — …» | R63, R71, R72, 461 R20 |
| `wallet-indemnizacion-libro.test.tsx` «R30 — la indemnización NO ofrece reversa» | reescrito en el mismo archivo: ninguna fila trae «Reversar»; las dos se abren con «Ver»; el criterio de la 45 sigue | R63, D11 |
| `WalletFechaCostaRica459.test.tsx` «el nombre accesible de «Anular…» dice el 24» | reescrito: el de «Ver» dice el 24 | R16 |
| `descarga/WalletDescarga.test.tsx` `ENCABEZADOS_ANTERIORES` («Acciones») | contrato nuevo: «Ver» | R58 |
| `contexto-457.test.ts` «ocho conceptos», `contexto-461.test.ts` fila «Sale dinero de Ordenex», `contexto-458.test.ts` bloque B (fuente `DocumentoCajaAcciones`) | «diez conceptos», la fila con los dos pagos, la fuente `DetalleMovimientoPanel` + bloque C | R37, R102 |

## TC.6 — Ayuda y asistente (R102, R103)

`docs/ayuda/oficina/wallet-caja.md` (actualizado 2026-09-26, fuentes al día: fuera las dos piezas
retiradas, dentro el diálogo, «Así queda», el panel, la anulación y `VerMovimientoCaja`): el registro
único con diez conceptos y lo que pide cada uno, «Así queda», «Ver un movimiento», «Anular…» uniforme
(también sueldo, gasto y gasto fijo, sin «Reversar»), adjuntar el comprobante una vez.
`tests/unit/asistente/contexto-458.test.ts` bloque C (frases literales para maestro/admin; nada de eso en
tienda, mensajero ni bodega; fuentes declaradas). Cuatro preguntas reales: `progress/recorrido_458-C/recorrido.md`.

## TC.7 — Recorrido, fotografías, mutaciones y gate

**Recorrido:** `progress/recorrido_458-C/recorrido.md` (pasos 2, 3, 5, 6, 7, R47; maestro y admin OK;
adminTienda y mensajero: páginas 404 y actions `forbidden` sin escribir; R7/R8 = 0,00 en 27 medidas con
`c458c-1.sql`, la C457-1 ampliada con los dos reversos de cargo de la 458-B).

### ⚠️ BLOQUEANTE (de la 458-B, ya en `dev`): PARADO, no arreglado aquí

`/wallet` y `/wallet/tiendas` no compilan: «Server Actions must be async functions». Las firmas de
sobrecarga `export function` (sin `async`) que la 458-B puso en `lib/actions/liquidacion.ts:149,153,221,225`,
`wallet-egresos.ts:86,90`, `wallet-tienda.ts:513,517` y `wallet.ts:377,381` rompen el módulo `"use server"`
en cuanto un componente de cliente lo importa (ya lo importaban `RegistrarMovimientoCajaDialog` y
`PagoTiendaAcciones`). El PR #829 de la 458-B tiene **Vercel en FAILURE** y se mergeó: `dev` no despliega.
Es un cambio de servidor y el leader los prohibió en esta hija fuera de D5, así que **no se commitea**.
Arreglo medido en local: `async` en esas diez firmas (TypeScript lo admite; `tsc` verde; con él `/wallet`
compila) + el contador de `tests/unit/guards/liquidacion-reparto-bloqueos.guardia.test.ts` («las Server
Actions del reparto son TRES»), que pasaría a contar las dos sobrecargas: es la ÚNICA prueba que cae
(3.711/3.712 de guardias + actions + diálogo). El recorrido se hizo con ese parche aplicado en local y
revertido al terminar (`git status` limpio).

### Mutaciones (19, una a una; arnés con autocomprobación: el archivo cambia, se corren > 0 tests, se restaura byte a byte y `git diff` limpio) — `progress/mutaciones_458-C.json`

| # | Mutación | Tests | Rojos |
| --- | --- | --- | --- |
| M1 | «a quién» no viaja en el `FormData` | diálogo | 1/36 |
| M2 | una clave de más (`tiendaId` siempre) | diálogo | 4/36 |
| M3 | «a quién» deja de ser obligatorio en el diálogo | diálogo | 1/36 |
| M4 | la clave se genera en cada envío, no al abrir | diálogo | 1/36 |
| M5 | D5 en el servidor: sin el `superRefine` de «a quién» | `wallet-egresos-actions` | 7/28 |
| M6 | «Así queda» se pide aunque falte la cuenta | diálogo | 1/36 |
| M7 | «Así queda» sin «no cambia» | diálogo | 2/36 |
| M8 | «Así queda» con error sigue enseñando cifras | diálogo | 2/36 |
| M9 | «Así queda» sin aviso de saldo en contra | diálogo | 1/36 |
| M10 | `CONCEPTO_REGISTRO_DE` del cobro apunta a la corrección | diálogo + catálogo | 2/68 |
| M11 | el panel ofrece «Anular…» aunque la fila no sea anulable | panel + libro | 3/35 |
| M12 | la fila del libro anula por el `origenId` (no por su id) | libro | 8/21 |
| M13 | el libro ya no tacha la fila anulada | libro | 1/21 |
| M14 | «Adjuntar» ofrecido en una fila anulada | comprobante + panel | 2/28 |
| M15 | anular manda también el monto | anular | 1/12 |
| M16 | `ya_anulado` se trata como fallo | anular | 1/12 |
| M17 | el campo deja pasar un tipo no admitido | comprobante | 2/14 |
| M18 | «Ver comprobante» no va al servidor | comprobante + libro | 2/35 |
| M19 | «Así queda» convierte el monto a número | guardia money-safe | 1/3 |

## Mapa R → test (458-C)

| R | Test |
| --- | --- |
| R37, R38 | `tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx` («R37/R38 — el catálogo…»), `tests/unit/components/wallet-conceptos-manuales.test.ts` («son exactamente DIEZ…»), `contexto-458` bloque C |
| R39 | diálogo («R39/R52 — la frase…», «R39/R42/R43/R51 — cada concepto…» con la lista ENTERA de claves por concepto) |
| R40, R41 | diálogo («R40/R41 — la cuenta…»), `PagoTiendaAccionesAbono457.test.tsx` (cuenta fija desde el desglose) |
| R42 (+ D5 servidor) | diálogo («R42 (D5)…»), `wallet-conceptos-manuales.test.ts` («R42 (D5)…»), `tests/unit/actions/wallet-egresos-actions.test.ts` (bloque «458-C D5»), `tests/integration/db/wallet-registro-comprobante-458.test.ts` (C2: sin «a quién» → 0 filas) |
| R43 | diálogo («R43: monto, fecha y motivo en los diez…», «R43: la referencia…», bloque de la fecha) |
| R44–R47 | diálogo (bloque «R44–R47 — «Así queda»…»); recorrido (maestro/admin, R47 en vivo) |
| R48, R49 | diálogo (bloque «R48/R49/R76…») |
| R50 | `tests/integration/db/efecto-movimiento-predice.test.ts` (458-B) + recorrido: 27 medidas R7/R8 = 0,00 |
| R51 | diálogo («R51: la clave es la MISMA…») |
| R52 | diálogo («R52: dice en qué libro cae…»), catálogo («la frase del diálogo nombra los libros») |
| R58 | `tests/components/DetalleMovimientoPanel.test.tsx` («458-C R58 — lo que dice el panel»), `tests/components/WalletLedgerVer458C.test.tsx` («lo demás del panel desde el libro») |
| R60 | `WalletLedgerVer458C.test.tsx` (`onCambio` tras anular), diálogo (`onRegistrado`) |
| R63–R67 | `WalletLedgerVer458C.test.tsx` (diez caminos por la acción única; R65), `AnularMovimientoDialog.test.tsx` (R64 motivo y sin monto; R66 `ya_anulado`; R65 `no_anulable` ×6); R67 en el servidor (458-B, `wallet-anulacion-concurrencia`); recorrido (segundo intento: 1 contra-asiento) |
| R71, R72 | `DetalleMovimientoPanel.test.tsx` («R63/R65/R71/R72…»), `WalletLedgerVer458C.test.tsx` («R71: …tachada»; «R71/R72: …motivo no registrado») |
| R74–R76, R79, R80 | `tests/unit/components/wallet-comprobante-campo.test.tsx`, diálogo («R74…», «R76…»); recorrido (R76 en vivo: 0 filas) |
| R90 | `tests/unit/guards/wallet-money-safe-458.guardia.test.ts` |
| R100 | `DetalleMovimientoPanel.test.tsx` («R100/R73…»), `WalletLedgerVer458C.test.tsx` («R100…»); recorrido paso 7 |
| R102, R103 | `tests/unit/asistente/contexto-458.test.ts` (bloque C) + cuatro preguntas en `progress/recorrido_458-C/recorrido.md` |
| R104 | `progress/recorrido_458-C/` |
| R82 (pantalla de roles sin acceso) | recorrido: sonda de las actions con actor adminTienda y mensajero → `forbidden`, 0 filas |

### Gate completo (`./init.sh` contra `ordenex_458c`, log sin `tail`, `INIT_EXIT` dentro del log)

1.ª corrida (`progress/gate_458C_1.log`, sobre `17e70f32`): `INIT_EXIT=1`, 2 rojos. (a) PROPIO:
`tests/unit/tablero-dia/primitivas.guardia.test.ts` (R20 de la 258) veía `mensajeroId` en una primitiva
compartida (`RegistrarMovimientoDialog`): la clave de la cuenta del `FormData` pasó al catálogo
(`CLAVE_DE_LA_CUENTA`, que es quien lleva el enrutado), `4257d25f`. (b) AJENO:
`tests/integration/db/abono-tienda-457-concurrencia.test.ts`, deadlock 40P01 (modo de flake conocido);
aislado 3 de 3 verdes, 8/8 cada vez (`progress/rerun_458C_aislado.log`).

2.ª corrida (`progress/gate_458C.log`, sobre `4257d25f`), salida real:

```
✓ typecheck paso
✓ lint paso
✓ DATABASE_URL resuelta: los 314 archivos de tests contra Postgres SI se ejecutan
 Test Files  2307 passed (2307)
      Tests  32145 passed | 26 skipped (32171)
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 2307 ejecutado(s), todos en el baseline conocido)
INIT_EXIT=0
```

Los 26 `skipped` son `AnaliticaPage.test.tsx` (17) y `AnaliticaShell.test.tsx` (9); **0 en
`tests/integration/db`**. Fotografías después, dentro del gate: `caja-caracterizacion-459` 23/23 y
`wallet-caracterizacion-458` 13/13 = **36/36**, las mismas que antes, sin tocar un literal.

## Pendiente

1. **BLOQUEANTE de la 458-B (no de esta hija):** `async` en las diez firmas de sobrecarga de
   `lib/actions/{liquidacion,wallet-egresos,wallet-tienda,wallet}.ts` + el contador de
   `liquidacion-reparto-bloqueos.guardia`. Sin eso `/wallet` y `/wallet/tiendas` no compilan y el build
   de Vercel de `dev` sigue en rojo (#829 FAILURE). Arreglo medido; espera la autorización del leader.
2. El comprobante no se pudo abrir en navegador (el almacenamiento del `.env` local es un proyecto
   remoto que rechaza la subida); lo cubren los tests de pantalla y de servidor.
3. El panel del libro de la caja no puede decir quién anuló, cuándo ni el método/referencia de los
   documentos, ni el instante de registro: `WalletMovimientoDTO` no los trae (458-E o ficha propia).
4. `obtenerComprobante{Abono,AporteCapital,PagoPorCuenta}Action` quedan con `@sin-superficie`: la 458-D
   decide si `/mi-wallet` las usa (TD.5) o si se retiran.
5. `reversarEgresoAdministrativoAction` queda sin superficie (D11), anotada; retirarla es servidor.

## Veredicto

458-C implementada (TC.0–TC.7): diálogo único de diez conceptos con «Así queda», panel «Ver» y
«Anular…» uniforme en el libro actual, D5 en el servidor; recorrido OK con R7/R8 = 0,00; 19 mutaciones
rojas; gate completo `INIT_EXIT=0` con 0 saltados en integration/db. Bloqueada para desplegar por el
build roto que dejó la 458-B (pendiente 1).
