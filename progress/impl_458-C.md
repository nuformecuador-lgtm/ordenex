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
| 381: campo de tienda condicional, catálogo, catálogo caído, sin tienda, payload del cobro, doble clic, éxito con saldo, rechazos | «R40/R41 — la cuenta…» (lista al abrir, filtro por nombre, lista caída bloquea SOLO ese concepto, sin cuenta no llama) + «cobro a una tienda: …FormData sin tipo ni categoría» (aviso con el saldo del servidor en negativo). El doble clic lo sigue cubriendo `Modal` (fase `pending`) y la clave (R51) | R41, R48, R51 |
| 459: frase del efecto, pago por cuenta (R61–R63), cobro sin claves de más (R64), aporte (R27/R68/R70) | «R39/R52 — la frase…» (las diez literales), «pago de un gasto de una tienda…», «aporte: … monto vacío, sin ejemplo, fecha SIEMPRE» | R39, R43 |
| 457: el pago de una tienda en el diálogo (R54–R58) y el diálogo con concepto y tienda FIJOS (D8) | «una tienda le paga a Ordenex: …`fechaPago`, siempre» y «R40: con concepto y cuenta fijos…» (+ `PagoTiendaAccionesAbono457.test.tsx` adaptado) | R40, R50 |

Otros tests tocados en TC.1: `wallet-conceptos-manuales.test.ts` (ampliado; «OCHO» → «DIEZ» como contrato
nuevo, R37 supera 461-R39), `wallet-egresos-actions.test.ts` (D5; cuatro entradas ganan «a quién»),
`wallet-registro-comprobante-458.test.ts` (C deja de ser «gasto sin campos nuevos»: D5 lo supera; C2
nuevo), `wallet-documento-comprobante-458.test.ts` y `wallet-comprobante-alcance.test.ts` (sus sueldos
ganan «a quién»; lo que miden no cambia), `wallet-page.test.tsx` («Registrar movimiento» → «Registrar
un movimiento», R37), `PagoTiendaAccionesAbono457.test.tsx` (el concepto fijo es un radio; la tienda fija,
un campo de solo lectura), `caja-textos-459.guardia` (la regla R27 apunta al diálogo nuevo),
`lib/actions/efecto-movimiento.ts` (fuera `@sin-superficie`: la guardia de superficie lo exige).
