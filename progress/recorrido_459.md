# Recorrido en navegador por rol — feature 459 (design §16)

- **Fecha:** 2026-09-24 (noche en Costa Rica; ~03:30 UTC del 25).
- **Árbol:** `66549de6` (rama `feature/459-recorrido`), `pnpm install` propio, `prisma generate`.
- **Base:** clon local `ordenex_459` (`prisma migrate status`: 216 migraciones, «up to date», `localhost:5432`).
- **Servidor:** un solo `pnpm dev` en el puerto 3459, salida a archivo; al terminar se mató y se borró `.next/dev`.
- **Cómo:** Playwright ad hoc (`@playwright/test` vía `createRequire`), login con email + clave y OTP leído del log.
  Evidencia citada = `innerText`; capturas y descargas en `progress/recorrido_459/`.
- **Credenciales:** se rotó `QA_PASSWORD` en `ordenex_459` (las 4 cuentas QA con `seed-usuarios-qa.ts`) y
  la clave de `maestro.qa@ordenex.test` con `seed-maestro.ts`. Solo afecta a ese clon.
- **No se tocó código de la app.**

## Resultado

**40 OK / 45 casos verificados · 5 FALLO (2 defectos distintos) · 3 no verificables en local.**

## Tabla caso × rol

Cifras: F = cifra principal · T = «De las tiendas» · G = ganancia · C = «Saldo inicial y aportes» · S = saldo de Tania en `/wallet/tiendas`.

### Maestro (`maestro.qa@ordenex.test`)

| # | Caso | Resultado | Números / evidencia |
|---|---|---|---|
| M1 | `/wallet` sin saldo inicial: rótulo, pista y ausencia de barra | OK | «Flujo de dinero registrado · Positivo · ₡13.483.932,72 · Lo que entró menos lo que salió desde el 11 de agosto de 2026. No es el saldo del banco: la app no sabe con cuánto dinero empezó Ordenex.» Ni el HTML de la tarjeta ni sus `aria-label` contienen «Dinero en caja» ni «Reparto». Textos de «De las tiendas», «Saldo inicial y aportes» («Dinero de Ordenex que no es ganancia.») y nota de diferencia iguales a §3.3. Identidad: 147.670,10 + 13.336.262,62 + 0 = 13.483.932,72. `maestro_wallet_tarjeta_flujo_final.png` |
| M2 | «De las tiendas» = Σ saldos + Σ cobros de un costo | OK | Inicio: T 147.670,10 = S 147.670,10 (sin cobros). Tras cobro de 5.000: T −52.329,90 = S −57.329,90 + 5.000. En negativo sale «Las tiendas le deben a Ordenex ₡52.329,90.» |
| M3 | «Registrar movimiento»: 7 conceptos, 3 grupos, frase del efecto | OK | Lista: «Sale dinero de la caja: Gasto variable · Sueldo · Pago por cuenta de una tienda · Ajuste que resta dinero / Entra dinero a la caja: Saldo inicial o aporte de capital · Ajuste que suma dinero / No mueve la caja: Cobrar un costo a una tienda». Pago por cuenta: «Sale dinero de la caja: Ordenex le paga a otro en nombre de la tienda y se lo descuenta de su saldo. La ganancia de Ordenex no cambia.» Cobro: «No sale ni entra dinero: es un cobro de Ordenex a la tienda que baja su saldo. La caja y la ganancia no cambian.» Las 7 frases = §9.2. `maestro_dialogo_grupos.png`, `maestro_dialogo_*.png` |
| M4 | Pago por cuenta a «Facebook», 10.000,00, SINPE, referencia, motivo | OK | Antes F 13.483.932,72 · T 147.670,10 · G 13.336.262,62 · S 147.670,10 → después F 13.473.932,72 · T 137.670,10 · G 13.336.262,62 · S 137.670,10 |
| M4b | Aviso de éxito con saldo y signo | OK | Pago de 200.000: «Pago registrado. El saldo de Tania Tienda queda en -₡52.329,90 · En contra. La tienda le debe ese dinero a Ordenex.» F 13.283.932,72 · T −52.329,90 · G igual |
| M4c | Comprobante PDF y «Ver comprobante» | NO VERIFICABLE | No existe el bucket `wallet-comprobantes` en el Supabase del `.env` local. Con PDF el diálogo dice «No se pudo guardar el comprobante, así que no se registró nada. Probá de nuevo.» y la base queda con 0 filas (comprobado): la atomicidad sí se cumple. |
| M4d | Fila del libro de la caja | OK | «Egreso · Pago por cuenta de una tienda · ₡10.000 · Pago por cuenta de tienda · Tania Tienda · A Facebook · Recorrido 459: … · SINPE · REC459-SINPE-001 · Tienda · Anular…» `maestro_pago_fila.png` |
| M4e | Fecha de la fila | **FALLO (F1)** | Pago con fecha 24/09 (CR) → la fila dice `2026-09-25` |
| M5 | Doble clic en «Registrar» | OK | Una sola llamada a `registrarPagoPorCuentaTiendaAction` en el log y una sola fila (`pago_por_cuenta_tienda` 0 → 1) |
| M6 | «Anular…» con motivo y segundo intento | OK | Sin motivo el botón está deshabilitado. Aviso: «Anulado. Se registró el movimiento contrario.» Contra-asiento «Ingreso · Pago por cuenta anulado · ₡10.000 · Pago por cuenta de tienda · Anulación · …», original «Anulado». Libro de la tienda: «crédito · pago_por_cuenta_anulado». Cifras de vuelta a F 13.483.932,72 · T 147.670,10 · S 147.670,10. Segundo intento (pestaña vieja): «Ya estaba anulado; no se registró nada más.» `maestro_pago_tras_anular.png` |
| M7 | Cobrar un costo de 5.000 | OK | «Cobro registrado. El saldo de Tania Tienda queda en -₡57.329,90 · En contra.» F 13.283.932,72 → 13.283.932,72 · T −52.329,90 → −52.329,90 · G igual · S −52.329,90 → −57.329,90 |
| M8a | Saldo inicial: el monto arranca vacío y sin ejemplo | OK | `value=""`, `placeholder=null` (los otros conceptos traen «0.00») |
| M8b | Saldo inicial con fecha posterior al primer día | **FALLO (F2)** | Se rechaza, pero el texto dice «El saldo inicial no puede ser posterior al 2026-08-11, el primer dia con movimientos en la caja.» |
| M8c | Saldo inicial válido (1.000.000, 10/08) | OK | «Registrado. Saldo inicial de ₡1.000.000.» Tarjeta «Dinero en caja · ₡14.283.932,72 · El saldo inicial registrado más todo lo que entró menos todo lo que salió desde entonces, incluido el dinero de las tiendas.» Barra: «Reparto del dinero en caja. De las tiendas: -₡52.329,90. De Ordenex: ₡14.336.262,62 (ganancia y aportes).» C 1.000.000 · G igual. `maestro_wallet_tarjeta_saldo.png` |
| M8d | Segundo saldo inicial | OK | «Ya hay un saldo inicial registrado y solo puede haber uno. Si hay que cambiarlo, anulá el vigente desde el libro de la caja.» |
| M8e | Anular el saldo inicial | OK | Contra-asiento «Egreso · Saldo inicial o aporte anulado · ₡1.000.000 · Ordenex (capital)». La tarjeta vuelve a «Flujo de dinero registrado · ₡13.283.932,72», sin barra |
| M9 | Aporte de capital sin saldo inicial (50.000) | OK | «Registrado. Aporte de capital de ₡50.000.» Sigue en «Flujo»: F 13.283.932,72 → 13.333.932,72 · C 0 → 50.000 · G igual |
| M10 | Descarga del libro de caja | OK | 0 celdas con uuid y 0 valores crudos `x_y`. «Pago por cuenta de una tienda / Pago por cuenta anulado», dueño «Tienda»; «Saldo inicial o aporte de capital», dueño «Ordenex (capital)». `maestro_libro_caja_*.xlsx` |
| M11 | Filtro por periodo (01–30/09) | OK | «Movimiento neto del periodo» en estado saldo (con barra) y en estado flujo (sin barra). `maestro_filtro_periodo_*.png` |
| M12 | `/wallet/tiendas` → «Ver desglose de Tania»: tabla y descarga | OK | «Débito · Pago por cuenta de la tienda · ₡200.000 · Pago por cuenta de tienda · A Facebook · …», «Crédito · Pago por cuenta anulado». Fila `gestion_orden` sembrada → «Gestión de orden». Sin uuid. `maestro_desglose_libro_tienda.png`, `maestro_desglose_tania_*.xlsx` |

### Admin (`admin.qa@ordenex.test`)

| # | Caso | Resultado | Números / evidencia |
|---|---|---|---|
| A1 | Tarjeta en «flujo» | OK | «Flujo de dinero registrado · ₡13.333.932,72 · … desde el 10 de agosto de 2026 …», sin barra |
| A2 | «De las tiendas» | OK | T −52.329,90 = S −57.329,90 + 5.000 (cobro del maestro) |
| A3 | Diálogo, grupos y frases | OK | Igual que M3 |
| A4 | Pago por cuenta 10.000 | OK | F 13.333.932,72 → 13.323.932,72 · T −52.329,90 → −62.329,90 · G 13.336.262,62 igual · S −57.329,90 → −67.329,90 |
| A4b | Aviso con signo | OK | «Pago registrado. El saldo de Tania Tienda queda en -₡67.329,90 · En contra. La tienda le debe ese dinero a Ordenex.» |
| A4e | Fecha de la fila | **FALLO (F1)** | `2026-09-25` para un pago del 24/09 |
| A5 | Doble clic | OK | `pago_por_cuenta_tienda` 2 → 3 (una sola fila) |
| A6 | Anular y segundo intento | OK | Cifras de vuelta a F 13.333.932,72 · T −52.329,90 · S −57.329,90; «Ya estaba anulado; no se registró nada más.» |
| A7 | Cobro de 5.000 | OK | F y T iguales; S −57.329,90 → −62.329,90 |
| A8a | Monto vacío | OK | `value=""`, sin placeholder |
| A8b | Fecha posterior | **FALLO (F2)** | Mismo texto que M8b |
| A8c | Saldo inicial válido | OK | «Dinero en caja · ₡14.333.932,72»; barra «De Ordenex: ₡14.386.262,62 (ganancia y aportes)» |
| A8d | Segundo saldo inicial | OK | «Ya hay un saldo inicial registrado…» |
| A8e | Anular | OK | Vuelve a «Flujo de dinero registrado · ₡13.333.932,72» |
| A10 | Descarga | OK | 0 uuid; rótulos legibles |
| A11 | Filtro por periodo | OK | «Movimiento neto del periodo» |

(M9 no se repitió con admin.)

### adminTienda (`tienda.qa@ordenex.test`, Tania, con OTP)

| # | Caso | Resultado | Evidencia |
|---|---|---|---|
| T1 | `/mi-wallet`: el pago por cuenta con nombre propio y beneficiario | OK | «Débito · Pago por cuenta de la tienda · ₡200.000 · Pago por cuenta de tienda · A Facebook · Recorrido 459: … · SINPE · REC459-SINPE-001». Ninguna fila de Facebook dice «Cobro de Ordenex». (El texto «Pago que Ordenex hizo por tu cuenta a…» del encargo no está en el spec; la app sigue design §16.) `tienda_miwallet_libro_tienda.png` |
| T2 | Contra-asiento visible | OK | «Crédito · Pago por cuenta anulado · ₡10.000 · … Anulación · A Facebook …» |
| T3 | `gestion_orden` legible | OK | Fila sembrada (se borró después) → «Flete por rechazo · ₡1 · Gestión de orden · …» |
| T4 | Ningún uuid ni valor crudo | OK | Escaneo del `innerText` y de la descarga: 0 |
| T5 | Sin acciones de registrar o anular | OK | Los botones son solo filtros, descarga y «Ver las órdenes que componen …» |
| T6 | Filtro por concepto | OK | Opciones: «… Cobro de Ordenex · Pago por cuenta de la tienda · Pago por cuenta anulado»; al filtrar salen solo los 2 pagos |
| T7 | Descarga del desglose | OK | 0 uuid, conceptos con nombre. `tienda_miwallet_*.xlsx` |
| T8 | `/wallet` y `/wallet/tiendas` | OK | HTTP 404 «No encontramos esta página» |
| T9 | Comprobante de un pago de otra tienda | NO VERIFICABLE | En local hay una sola tienda y no hay bucket |
| T10 | Fecha de las filas | **FALLO (F1)** | Movimientos del 24/09 (CR) salen como `2026-09-25` |

### Mensajero (`mensajero.qa@ordenex.test`)

| # | Caso | Resultado | Evidencia |
|---|---|---|---|
| X1 | `/wallet`, `/wallet/tiendas`, `/mi-wallet` | OK | HTTP 404 en las tres, sin cifras de caja. `mensajero_acceso_*.png` |
| X2 | Las seis actions → `forbidden` | NO VERIFICADO | Desde el navegador no hay forma de llamarlas sin una página que las importe; queda cubierto por la integración |

## Fallos

### F1 — El libro pone el día UTC, no el de Costa Rica (previo a la 459, pero visible en todo su flujo)

**Pasos:** después de las 18:00 de Costa Rica, registrar un pago por cuenta con la fecha por defecto (hoy, 24/09) → en
`/wallet` la fila, su `aria-label` («Anular Pago por cuenta de una tienda del 2026-09-25 por ₡10.000») y el diálogo de
anulación («… · 2026-09-25 · ₡10.000») dicen **25/09**. Lo mismo pasa en el desglose de `/wallet/tiendas`, en `/mi-wallet` y en
las tres descargas. El documento guarda `fecha_pago = 2026-09-24`; `wallet_movimiento.fecha_movimiento` guarda `2026-09-25 03:28`
(UTC). Los contra-asientos «fechados hoy» también salen como 25/09.
**Causa probable:** `app/(app)/wallet/_components/WalletLedger.tsx:242` pinta `m.fechaMovimiento.slice(0, 10)` sobre el ISO en UTC
(blame `06a46b7a`, 2026-08-11), y los desgloses de tienda hacen lo mismo. No lo introduce la 459.

### F2 — El texto de rechazo de R71 (saldo inicial tardío)

**Pasos:** «Registrar movimiento» → «Saldo inicial o aporte de capital» → «Saldo inicial», monto 1000000.00, fecha 2026-09-01 →
«Registrar». Sale «El saldo inicial no puede ser posterior al 2026-08-11, el primer dia con movimientos en la caja.»:
**«dia» sin tilde** y la fecha en ISO, cuando la tarjeta la escribe «11 de agosto de 2026». La regla funciona (rechaza y dice
el último día). Origen: `lib/services/AporteCapitalService.ts:118`.

## Observaciones (no son fallos del spec)

1. **Un modal de otra feature tapa la caja:** «Confirmá el SINPE de GAM» se abre sobre `/wallet` para maestro y admin y deja la
   página `aria-hidden`: «Registrar movimiento» no se puede pulsar hasta cerrar el modal con «Ahora no».
2. El subtítulo de `/wallet` dice «…libro de movimientos, **dinero en caja** y ganancia de Ordenex» también en estado «flujo».
   Está fuera de la tarjeta, así que §16 no lo cubre.
3. Un saldo inicial anulado sigue en el libro, y el «desde el {día}» pasa a su fecha: dice 10 de agosto en vez de 11. Es
   coherente con §2.5 (MIN de todo el libro), pero el día lo decide un documento anulado. R71, en cambio, lo ignora y sigue
   diciendo 2026-08-11.
4. La descarga del libro no tiene columna de estado: un saldo inicial anulado y uno vigente salen como filas idénticas (filas 45
   y 46 de `admin_libro_caja_*.xlsx`).
5. En el diálogo, la cabecera de «Saldo inicial o aporte» dice «El movimiento es inmutable una vez registrado.», aunque se puede
   anular desde el libro.
6. En el desglose de `/wallet/tiendas`, la pista de «Cargos de Ordenex» dice «Fletes, comisión e IVA», pero la cifra incluye los
   cobros de Ordenex; `/mi-wallet` sí dice «…y cobros de Ordenex». Es un texto de la 171.
7. Operaciones: sin el bucket `wallet-comprobantes`, cualquier registro con comprobante se rechaza entero (design §15.6).

## Estado en que queda `ordenex_459`

Siguen vigentes un pago por cuenta de 200.000 (Tania, «Facebook»), dos cobros de 5.000 y un aporte de capital de 50.000.
Los pagos de 10.000 y los tres saldos iniciales están anulados, así que no hay ningún saldo inicial vigente y la tarjeta
queda en «Flujo de dinero registrado · ₡13.333.932,72». La fila `gestion_orden` de prueba se borró. Las cuentas QA
tienen la clave rotada.
