# 458-D — Recorrido por rol (design §10: pasos 4–6 y 8–11; adminTienda; mensajero y adminSatelite sin acceso) · 2026-09-26

Playwright ad hoc (`chromium` de `@playwright/test`, scripts en el scratchpad, fuera del árbol) contra UN dev
server (`next dev -p 3478`, con `AUTH_RISK_THRESHOLD=999` SOLO en la línea de comando del servidor para no
pedir el segundo factor; apagado al terminar) sobre la base propia `ordenex_458d` (clon de `ordenex`, 0
conexiones a la plantilla al clonar). Usuarios: `maestro.qa`, `admin.qa`, `tienda.qa` (Tania),
`mensajero.qa`, `satelite.qa` — contraseñas QA rotadas SOLO en el clon (`seed-usuarios-qa`, `seed-maestro`
con `MAESTRO_EMAIL=maestro.qa@ordenex.test`). Datos sembrados en el clon para el paso 11: dos consolidaciones
`solicitado` de Quepos (₡25.000 y ₡18.000 de efectivo). Salida cruda: `admin-desde4c.json`, `maestro.json`,
`maestro-desde11.json`, `tienda.json`, `otros.json`, `sondas-roles.json`, `asistente.json`.

Hecho sobre `e19d1974` (antes de mergear `origin/dev` con el cierre de la 458-C); tras el merge
(`d5790177`) el build y el gate se repiten (ver `progress/impl_458-D.md`) y los tests de estas pantallas
siguen verdes: el merge no tocó ningún archivo de la 458-D.

**Nota de la primera corrida:** el admin ve al entrar el aviso «Confirmá el SINPE de GAM» (ficha 429), que
tapa la pantalla; el script lo cierra con «Ahora no». La primera corrida del admin (pasos 4–6 y 4b) quedó
solo en la consola porque el `.json` se sobrescribió con la segunda (desde 4c): sus números son los de la
consola y coinciden con los del maestro (mismo flujo, 15.000 menos por el cobro y el pago de un gasto del
admin).

## Resultado

| Rol | Paso | Resultado | Números |
| --- | --- | --- | --- |
| maestro | 4 `/wallet/tiendas` → «Ver estado de cuenta de Tania» | OK | fila del listado «Tania Tienda ₡132.670,10 A favor»; tarjeta «Saldo actual ₡132.670,10 · Ordenex le debe ₡132.670,10 a Tania Tienda · Saldo inicial ₡0 · Abonos ₡191.400 · Cargos ₡58.729,90 · Saldo al final ₡132.670,10»; primera fila «— Saldo inicial ₡0»; última fila de la última página con saldo corrido **₡132.670,10** (= tarjeta = listado); acciones «Ordenex le cobra a la tienda · Ordenex le paga a la tienda» (habilitado), «La tienda le paga a Ordenex» **no** aparece (a favor); 0 uuid en texto y nombres accesibles |
| maestro | 5 «Ordenex le cobra a la tienda» 5.000 desde el estado de cuenta | OK | «Así queda»: saldo de Tania 132.670,10 → 127.670,10; cifra 13.473.932,72 «no cambia»; ganancia 13.341.262,62 → 13.346.262,62; «Lo que Ordenex les debe a las tiendas» 132.670,10 → 127.670,10 (`maestro-05-cobro-asi-queda.png`); tarjeta tras registrar ₡127.670,10 sin recargar; **al volver al listado la fila dice ₡127.670,10** |
| maestro | 6 «Ordenex paga un gasto de una tienda» a Facebook 10.000 (registro único de `/wallet`) | OK | «Así queda»: saldo 127.670,10 → 117.670,10, cifra 13.473.932,72 → 13.463.932,72 (`maestro-06-…png`); en `/mi-wallet` de Tania se lee «Ordenex pagó un gasto por ti» (`tienda.json`) |
| maestro | 4b Tania EN CONTRA (cobro de 200.000) | OK | «Saldo actual -₡82.329,90 · **Tania Tienda le debe ₡82.329,90 a Ordenex**»; «La tienda le paga a Ordenex» visible; «Ordenex le paga a la tienda» **deshabilitado** con «Ordenex no le debe nada a Tania Tienda: sin saldo a favor no hay nada que pagarle.» |
| maestro | 4c/4d «Ver» → «Anular…» el cobro de 200.000 desde el estado de cuenta | OK | panel: «A quién Tania Tienda · Por qué … · Registró Maestro QA · Estado Vigente · Cómo quedó …»; tras anular, tarjeta ₡117.670,10 sin recargar; la fila queda «Anulado el 2026-09-26 por … · Recorrido 458-D…» y su contra-asiento como fila «Anulación» |
| maestro | 9 descargar el estado de cuenta | OK | `maestro-09-estado-de-cuenta-de-tania-tienda-2026-09-26.xlsx`: columnas Fecha · Movimiento · Motivo · Origen · Registró · Cargo · Abono · Saldo · Estado; primera fila «Saldo inicial 0.00»; saldo corrido fila a fila; última fila = saldo de la tarjeta; **0 uuid** (leído con exceljs) |
| maestro | 10 `/wallet/mensajeros` → Marco → «Ordenex le paga al mensajero» 1.000 | OK | tarjeta ₡5.100 → **₡4.100** tras el reparto (previsualización «Se aplica ₡1.000 · Pendiente hoy ₡3.400…») |
| maestro | 10 «Anular…» ese pago desde su estado de cuenta (R70) | OK | tarjeta vuelve a **₡5.100**; fila «Anulado el … · Recorrido 458-D: anular el pago desde la wallet»; `/cierres-admin` responde 200 (su anulación no se tocó) |
| maestro | 11 `/wallet/satelites/Quepos` → marcar recibido 24.000 de 18.000 | OK | «Por entregar hoy ₡19.000» → **«-₡5.000 · Quepos entregó ₡5.000 de más»**; la fila del listado cambia con él |
| admin | 4c/4d, 9, 10, 11 (y 4–6, 4b en la primera corrida) | los mismos OK | cobro 200.000 anulado → ₡132.670,10; descarga con 33 filas y 0 uuid; reparto 5.100 → 4.100 → anulado 5.100; Quepos 25.000 → marcado 24.000 → «Por entregar hoy ₡1.000» y la fila del listado «Recibido incompleto ₡1.000 · ₡24.000 de ₡25.000» |
| adminTienda | `/mi-wallet` | OK | lecturas «Ordenex te cobró» y «Ordenex pagó un gasto por ti» presentes («Le pagaste a Ordenex»: la tienda no tiene ningún pago a Ordenex en la base); **6** botones «Ver comprobante» (solo en cobros y pagos); **0** botones de registrar/anular/adjuntar; 0 uuid; «Ver comprobante» de un cobro sin archivo → «Este registro no tiene comprobante.» |
| adminTienda | 8 selector de cierre de `/mi-wallet` | OK | «Cierre del 2026-09-24 · 7 movimientos», «Cierre del 2026-08-13 14:22 · 5 movimientos»…; ningún texto pide un ID |
| adminTienda | `/wallet`, `/wallet/tiendas`, `/wallet/tiendas/<Tania>`, `/wallet/mensajeros/<Marco>`, `/wallet/satelites/<Quepos>` | OK | 404 las cinco |
| adminTienda | comprobante de la caja / de un destino inexistente (sonda con el actor inyectado, contra el clon) | OK | `no_encontrado` los dos, sin distinguir (R77); el de SU cobro → `sin_comprobante` |
| mensajero / adminSatelite | `/wallet`, `/wallet/tiendas`, las tres páginas de estado de cuenta, `/mi-wallet` | OK | 404 las seis, los dos roles |
| adminTienda / mensajero / adminSatelite | `verEstadoCuentaAction` y `anularMovimientoAction` (sonda) | OK | `forbidden` los tres; filas del libro de la tienda antes/después: 35/35 |

**Paso 8 en la oficina: NO se puede hacer.** El estado de cuenta de tienda y mensajero no filtra por cierre
(su borde no acepta un cierre: pendiente de servidor, ver `progress/impl_458-D.md`). El selector de cierre
de la 458-A sigue vivo en `/mi-wallet` (arriba) y su composición se conserva con sus tests
(`WalletFiltros458.test.tsx`).

## R7 / R8 — `progress/recorrido_458-C/c458c-1.sql` y el saldo corrido

| Momento | cifra | ganancia | De las tiendas | Σ saldos tiendas | R8 | R7 |
| --- | --- | --- | --- | --- | --- | --- |
| antes del recorrido | 13.483.932,72 | 13.336.262,62 | 147.670,10 | 147.670,10 | 0,00 | 0,00 |
| tras admin y maestro (2 cobros de 5.000, 2 pagos de un gasto de 10.000, 2 cobros de 200.000 anulados, 2 repartos anulados, 3 marcas) | 13.463.932,72 | 13.346.262,62 | 117.670,10 | 117.670,10 | **0,00** | **0,00** |

Saldo de Tania en la base 117.670,10 = saldo corrido de su último movimiento (ventana `ORDER BY
fecha_movimiento, created_at, id`) = tarjeta del estado de cuenta = fila del listado. Cuenta por pagar de
Marco en la base 5.100,00 = tarjeta. Pendiente de Quepos en la base (Σ efectivo − recibido, sin rechazadas)
-5.000,00 = tarjeta («entregó ₡5.000 de más»).

## Asistente — cuatro preguntas reales en local (R103), una desde la tienda

| Rol / pantalla | Pregunta | Respuesta (resumen literal) |
| --- | --- | --- |
| maestro · `/wallet/tiendas` | ¿Cómo veo cuánto le debo a una tienda y qué significa el saldo de cada fila de su estado de cuenta? | «Vas a Wallet · Tiendas… una fila por tienda, con su signo… Para el detalle, tocás **Ver estado de cuenta**… extracto completo, del movimiento más antiguo al más reciente: la primera fila es el saldo inicial del periodo…» |
| admin · `/wallet/mensajeros` | Registré un pago a un mensajero por error. ¿Cómo lo anulo desde la wallet? | «Se anula desde el estado de cuenta de ese mensajero… tocá Ver estado de cuenta… ubicá la fila del pago (podés filtrar con el chip Pagos) y tocá Ver. Ahí tenés **Anular…**… el motivo es obligatorio… Es la misma anulación que existe en Cierres» |
| admin · `/wallet/satelites` | ¿Dónde marco que llegó el efectivo de una bodega satélite y qué pasa con su estado de cuenta? | «…tocás Ver estado de cuenta. Ahí abajo están las consolidaciones de esa bodega… Tocás **Marcar recibido**… con el monto ya puesto…» |
| adminTienda · `/mi-wallet` | ¿Puedo ver el comprobante del pago que Ordenex hizo por mí a Facebook? | «Sí, podés verlo… la línea «Ordenex pagó un gasto por ti»… tocá **Ver comprobante** y se te abre en otra pestaña con un enlace que dura poco. Si esa fila no tiene comprobante… «Este registro no tiene comprobante.»» |

Ninguna nombra un identificador ni el desglose retirado. Capturas `asistente-1..4-*.png`.

## Notas

1. **El comprobante no se puede subir desde local** (mismo límite que la 458-C: el almacenamiento del
   `.env` es un proyecto remoto que rechaza la subida), así que «Ver comprobante» con archivo no se abrió en
   navegador; lo cubren `MiWalletComprobante458.test.tsx` (enlace temporal abierto, `no_encontrado`,
   `sin_comprobante`) y `wallet-comprobante-alcance.test.ts` de la 458-B.
2. Los datos que el recorrido dejó en el clon (cobros, pagos de un gasto, anulaciones, marcas y las dos
   consolidaciones sembradas) mueren con el clon, que se borra al terminar.

---

# Cierre de PANTALLA de la 458-D (frontend, 2026-09-26) — recorrido

Playwright ad hoc (`chromium` de `@playwright/test`, script en el scratchpad, fuera del árbol) contra UN dev
server (`next dev -p 3491`, `AUTH_RISK_THRESHOLD=999` solo en la línea de comando; apagado al terminar) sobre
el clon `ordenex_458dc` (0 conexiones a la plantilla al clonar; `migrate deploy`: «No pending migrations»).
Usuarios `maestro.qa`, `admin.qa`, `tienda.qa` (Tania), con la contraseña QA rotada SOLO en el clon
(`seed-usuarios-qa`, `seed-maestro` con `MAESTRO_EMAIL=maestro.qa@ordenex.test`). Salida cruda:
`cierre-maestro.json`, `cierre-admin.json`, `cierre-tienda.json`; capturas y xlsx `cierre-*`.

| Rol | Paso | Resultado | Números |
| --- | --- | --- | --- |
| maestro / admin | estado de cuenta de Tania | OK | «Saldo actual ₡147.670,10 · Ordenex le debe ₡147.670,10 a Tania Tienda · Saldo inicial ₡0 · Abonos ₡191.400 · Cargos ₡43.729,90 · Saldo al final ₡147.670,10»; 0 uuid en texto ni nombres accesibles (`cierre-*-01`) |
| maestro / admin | **origen con entidad y enlace (R6/R7)** | OK | 20 enlaces en la página 1; texto visible «Ver», nombre accesible «Ver el cierre del 2026-08-12 de Marco Mensajero», uuid SOLO en `href` (`/cierres-admin?cierre=…`), que responde 200; la fila dice «Cierre del día · 2026-08-12 · Marco Mensajero» |
| maestro / admin | **desplegar órdenes de una fila de cierre (R19)** | OK | «Ver las órdenes que componen Contra-entrega cobrado a los clientes de la tienda del 2026-08-12» → panel «Cierre del día 2026-08-12 · Mensajero: Marco Mensajero · 6 de 12 órdenes del cierre aportan · Importe ₡124.100», seis guías (990001 … 990009) con su aporte; 0 uuid (`cierre-*-03`) |
| maestro / admin | **filtro por cierre (R10/R11)** | OK | opciones «Cierre del 2026-09-24 · Quino QUEPOS · 7 movimientos», «… · Rita Recorrido · 5 movimientos», «Cierre del 2026-08-13 14:22 · Marco Mensajero · 5 movimientos»…; buscar «Quino QUEPOS» → 2 opciones; buscar «2026-09-24» → 3; elegido el de Quino → 8 filas (saldo inicial + 7), todas del 2026-09-24; el disparador dice el rótulo, ningún uuid (`cierre-*-04`) |
| maestro / admin | **descarga completa (TD.6)** | OK | con el cierre: 9 filas (saldo inicial + 7), columnas Fecha · Movimiento · Motivo · Origen · Cómo se pagó · Registró · Cargo · Abono · Saldo · Estado; sin cierre: 29 filas (maestro) / 31 (admin, tras el pago del maestro y su anulación); última fila del archivo = última de la pantalla = tarjeta = **147.670,10**; **0 uuid** (`cierre-*-05*.xlsx`) |
| maestro / admin | **método y referencia** | OK | «Ordenex le paga a la tienda» 1.000 por SINPE con referencia `REC458D-<rol>` → la fila dice «Cómo se pagó: SINPE · referencia REC458D-<rol>» y el panel «Ver» la línea **Cómo** igual; tarjeta 147.670,10 → 146.670,10; anulado desde el panel → 147.670,10 (`cierre-*-07*`) |
| maestro / admin | mensajero Marco | OK | «Ordenex le debe ₡5.100 a Marco Mensajero»; la fila de cierre se abre y dice «Este importe es el total que el cierre del día dejó anotado para pagarle al mensajero. No se acumula orden por orden…» (`snapshot_del_cierre` en palabras); 4 enlaces de origen al cierre; su selector ofrece SUS 3 cierres («… · 1 movimiento», «… · 2 movimientos») y filtra a 2 filas (`cierre-*-06*`) |
| adminTienda | **/mi-wallet = su estado de cuenta (R34/R35)** | OK | «Saldo actual ₡147.670,10 · **Ordenex te debe ₡147.670,10** · …»; primera fila «— Saldo inicial ₡0»; **sin «Registró»**; **0 botones de registrar/anular/adjuntar/cobrar/pagar**; 0 enlaces de origen al cierre (R8); 20 filas que despliegan SUS órdenes, sin el mensajero; 0 uuid (`cierre-tienda-01`, `-05`) |
| adminTienda | selector de cierre de siempre | OK | «Cierre del 2026-09-24 · 7 movimientos» (sin mensajero) → 8 filas; descarga 9 filas SIN la columna «Registró», 0 uuid (`cierre-tienda-02`, `-03`) |
| adminTienda | **saldo corrido = tarjeta** | OK | última fila de la última página «₡147.670,10» = tarjeta = saldo de Tania en la base (147.670,10) |

**`limite_excedido`:** el clon no tiene una cuenta con más de 5.000 movimientos; el aviso («El estado de cuenta
tiene N movimientos con estos filtros y la descarga admite hasta 5000…») lo mide
`tests/unit/descarga/estado-cuenta-descarga-columnas.test.ts` (literal) y su mutación M8.

**Observación (servidor, no tocado):** la fila «Comisión de contra-entrega cobrada a la tienda del 2026-08-12»
(₡4.343,50) despliega «0 de 12 órdenes del cierre aportan a este concepto» en la oficina y en `/mi-wallet`: la
derivación de la 344 no encuentra aporte por orden para esa comisión en los datos del clon. No es de pantalla.

## R7 / R8 — `c458c-1.sql` (cierre de pantalla)

| Momento | entró | salió | cifra | ganancia | De las tiendas | Σ saldos tiendas | R8 | R7 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| antes (`cierre-r7r8-antes.json`) | 13.524.733,22 | 40.800,50 | 13.483.932,72 | 13.336.262,62 | 147.670,10 | 147.670,10 | **0,00** | **0,00** |
| después (`cierre-r7r8-despues.json`; 2 pagos a Tania y sus 2 anulaciones) | 13.526.733,22 | 42.800,50 | 13.483.932,72 | 13.336.262,62 | 147.670,10 | 147.670,10 | **0,00** | **0,00** |
