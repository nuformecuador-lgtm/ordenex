# 458-C — Recorrido por rol (design §10: pasos 2, 3, 5, 6, 7 + R47; adminTienda y mensajero) · 2026-09-26

Playwright ad hoc (`chromium` de `@playwright/test`, scripts en el scratchpad, fuera del árbol) contra
UN dev server (`next dev -p 3458`, apagado al terminar) sobre la base propia `ordenex_458c` (clon de la
local). Usuarios: `maestro.qa`, `admin.qa`, `tienda.qa` (Tania), `mensajero.qa` — seeds idempotentes
corridos SOLO contra el clon (la contraseña QA del clon quedó rotada). Salida cruda: `maestro.json`,
`maestro-sin7.json`, `maestro-solo7.json`, `admin.json`, `otros-roles.json`, `asistente.json`.

## ⚠️ BLOQUEANTE encontrado al levantar la app (de la 458-B, ya en `dev`)

`/wallet` NO compila: «**Server Actions must be async functions.**»
(`bloqueante-458B-build-error-wallet.png`). La 458-B dejó en cinco archivos `"use server"` firmas de
sobrecarga declaradas `export function` (sin `async`): `registrarPagoTiendaAction` y
`registrarRepartoMensajeroAction` (`lib/actions/liquidacion.ts:149,153,221,225`),
`registrarEgresoAdministrativoAction` (`wallet-egresos.ts:86,90`), `registrarCobroTiendaAction`
(`wallet-tienda.ts:513,517`) y `registrarMovimientoManualAction` (`wallet.ts:377,381`). El compilador de
Next rechaza el módulo en cuanto un componente de cliente lo importa. **No es de esta hija:** el diálogo
de antes ya importaba tres de esas actions y `PagoTiendaAcciones` la cuarta; y el PR de la 458-B
(**#829**) tiene el check de **Vercel en FAILURE** («Deployment has failed», `gh pr checks 829`) y se
mergeó igual. Es decir: `dev` no despliega desde `ae6394c5`.

Arreglo medido (NO commiteado: es un cambio de servidor y el leader lo prohibió en esta hija): poner
`async` en esas diez firmas de sobrecarga (`export async function X(…): Promise<…>;` — TypeScript lo
admite, `tsc` verde) y ajustar el contador de la guardia `liquidacion-reparto-bloqueos.guardia` (la
única que cae: cuenta `export async function` del reparto y pasaría a ver las dos sobrecargas). Con ese
parche aplicado EN LOCAL, `/wallet` compila y se hizo este recorrido; al terminar se revirtió (`git
checkout -- lib/actions/…`, `git status` limpio).

## Resultado

| Rol | Paso | Resultado | Números |
| --- | --- | --- | --- |
| maestro | 2 «Registrar un movimiento»: diez conceptos en tres grupos + enlace a plantillas | OK | 10 radios; «Sale dinero de Ordenex» 6 · «Llega dinero a la caja» 3 · «Se descuenta del saldo de una tienda» 1; enlace `/wallet#gastos-fijos` |
| maestro | 2 «Sueldo»: pide a quién, monto, fecha, motivo, comprobante; «Así queda» | OK | campos «A quién se le pagó*», «Monto*», «Fecha*», «Trabajador y periodo*», «Referencia (opcional)», «Comprobante (opcional)»; cifra 13.473.932,72 → 13.448.932,72 y ganancia 13.336.262,62 → 13.311.262,62 (−25.000 las dos); «De las tiendas» y capital «no cambia» |
| maestro | 2 registrar con un PDF | **NO VERIFICABLE en local** (nota 1) — R76 sí, en vivo | «No se pudo guardar el comprobante, así que no se registró nada. Probá de nuevo.»; **0** filas escritas; el diálogo sigue abierto con lo escrito. Registrado después sin archivo: «Movimiento registrado correctamente.» |
| maestro | 3 la fila nueva: A quién, Registró, «Cómo quedó» | OK | panel: «A quién María Solano», «Registró Maestro QA», «Estado Vigente», «Cómo quedó: Flujo de dinero registrado ₡13.448.932,72 · Ganancia ₡13.311.262,62 · De las tiendas ₡137.670,10 · Capital ₡0»; «Adjuntar comprobante» ofrecido (sin comprobante) |
| maestro | 3 «Anular…» con motivo | OK | aviso «Anulado. Se registró el movimiento contrario.»; la fila queda `line-through`; contra-asiento `ingreso_ajuste` «Anulación de: Sueldo de septiembre (recorrido 458-C, maestro)» ₡25.000; cifra, ganancia, De las tiendas y capital de vuelta a 13.473.932,72 / 13.336.262,62 / 137.670,10 / 0 («Entró» y «Salió» suben 25.000 cada una: son brutos, como desde la 45) |
| maestro | 3 segundo intento (otra pestaña con la vista vieja) | OK | «Ya estaba anulado; no se registró nada más.»; en la base, **1** contra-asiento y **1** constancia por sueldo (medido por `origen_id`, las dos corridas) |
| maestro | 5 «Ordenex le cobra a la tienda» 5.000 | OK | «Así queda»: saldo de Tania 137.670,10 → 132.670,10; ganancia +5.000; De las tiendas −5.000; cifra «no cambia»; aviso «Cobro registrado. El saldo de Tania Tienda queda en ₡132.670,10 · A favor.»; fila de `/wallet/tiendas`: «Tania Tienda ₡132.670,10 A favor» (= base) |
| maestro | 6 «Ordenex paga un gasto de una tienda» a Facebook 10.000 | OK | «Así queda»: cifra −10.000, De las tiendas −10.000, saldo −10.000 (132.670,10 → 122.670,10), ganancia «no cambia» (sin aviso de contra: Tania sigue a favor) |
| maestro | R47 aviso de saldo en contra (cobro de 200.000, sin registrar) | OK | «Así, Tania Tienda queda con el saldo en contra: -₡82.329,90. Le deberá ese dinero a Ordenex.» |
| maestro | «Llega»: Corrección de caja (suma) 1.000 con «a quién» → anular | OK | panel «A quién Cajero»; anulada desde el panel |
| maestro | «Se descuenta»: el cobro de 5.000 → anular | OK | anulado desde el panel; saldo de la tienda y De las tiendas +5.000, ganancia −5.000 |
| maestro | 7 cobro por rechazo (sembrado pendiente, aprobado con «Cobrar» en su cola) → «Ver» → «Anular…» | OK | panel: «Es un cobro a la tienda por el flete de un rechazo: la ganancia de Ordenex sube y el saldo de la tienda baja, sin dinero nuevo en la caja.» (R100); caja: `egreso_reverso_flete_devolucion` 1.800,00 + `egreso_reverso_iva_flete_devolucion` 234,00; tienda: `flete_devolucion_anulado` 1.800,00 + `iva_flete_devolucion_anulado` 234,00; ganancia **−2.034,00**, De las tiendas **+2.034,00**, «Entró» 13.550.733,22 → 13.550.733,22; `estado` sigue `aprobado`; la cola ya no se monta (0 secciones) |
| admin | 2, 3, 5, 6, «Llega», «Se descuenta» | los mismos OK | sueldo de 24.000 (cifra y ganancia −24.000), anulado, segundo intento «Ya estaba anulado» con 1 contra-asiento; cobro 5.000; pago de un gasto 10.000; corrección registrada y anulada |
| adminTienda | 6 `/mi-wallet` | OK | fila «2026-09-26 Débito **Ordenex pagó un gasto por ti** ₡10.000 Pago de un gasto de una tienda · Tania Tienda · a Facebook · A Facebook · Pauta de septiembre…»; 0 botones de registrar/anular/adjuntar |
| adminTienda | `/wallet`, `/wallet/tiendas` | OK | HTTP 404 y 404 |
| mensajero | `/wallet`, `/mi-wallet` | OK | HTTP 404 y 404 |
| adminTienda / mensajero | las actions (sonda con el actor inyectado, contra el clon) | OK | registrar sueldo, corrección, cobro, pago a tienda, pago a mensajero, pago de un gasto, aporte, pago de la tienda; «Así queda»; anular; adjuntar (con archivo); «Cómo quedó»; autoría → **`forbidden`** los dos roles; ver comprobante de una fila de caja → `no_encontrado` (tienda, R77) / `forbidden` (mensajero); adjuntar SIN archivo → `validation_error` (la forma va antes que el rol). Filas antes/después: caja 61/61, tienda 40/40, pagos 3/3, anotaciones 6/6, comprobantes 0/0, constancias 6/6 |

## R7 / R8 — `c458c-1.sql` (la C457-1 de `progress/contraste_457.md` + los dos reversos de cargo de la 458-B en `es_cargo`)

27 mediciones, **todas `diferencia_r7 = 0,00` y `diferencia_r8 = 0,00`** (detalle por paso en los
`*.json`). Extremos:

| Momento | cifra | ganancia | De las tiendas | Σ saldos tiendas | R8 | R7 |
| --- | --- | --- | --- | --- | --- | --- |
| antes de todo | 13.483.932,72 | 13.336.262,62 | 147.670,10 | 147.670,10 | 0,00 | 0,00 |
| tras aprobar el cobro por rechazo | 13.473.932,72 | 13.338.296,62 | 135.636,10 | 135.636,10 | 0,00 | 0,00 |
| tras anular el cobro por rechazo | 13.473.932,72 | 13.336.262,62 | 137.670,10 | 137.670,10 | 0,00 | 0,00 |
| final (admin, tras anular su cobro) | 13.453.932,72 | 13.336.262,62 | 117.670,10 | 117.670,10 | 0,00 | 0,00 |

## Asistente — cuatro preguntas reales en local (R103)

| Rol / pantalla | Pregunta | Respuesta (resumen literal) |
| --- | --- | --- |
| maestro · `/wallet` | ¿Cómo registro un sueldo y qué me pide? ¿Tengo que poner a quién se le pagó? | «entrás a Wallet · Caja y usás Registrar un movimiento. Ahí elegís el concepto Sueldo […] Te pide: el monto, la fecha, el motivo, A quién se le pagó — la persona, con su nombre libre. Esto es obligatorio en el caso de Sueldo. La referencia — opcional. Un comprobante — opcional […] el recuadro «Así queda» te muestra el antes y el después» |
| maestro · `/wallet` | ¿Qué es el recuadro «Así queda» y qué significa «no cambia»? | «En cuanto escribís el monto (y elegís la cuenta, si el concepto la lleva), te muestra antes y después: el saldo de la cuenta, la cifra grande de la caja, la ganancia, lo que Ordenex les debe a las tiendas, el saldo inicial y aportes […] «no cambia» significa que el concepto que elegiste no la mueve» |
| admin · `/wallet` | Registré un gasto de Ordenex por error, ¿cómo lo anulo? ¿Se borra? | «buscá la fila de ese gasto y tocá Ver. Ahí vas a encontrar el botón Anular…. El motivo es obligatorio […] No se borra nada […] la fila pasa a decir Anulado. Se registra […] una Corrección de caja (suma) […] Una anulación no se puede deshacer» |
| admin · `/wallet` | ¿Cómo le adjunto un comprobante a un movimiento que registré sin él? | «Entrás al detalle de ese movimiento con Ver […] te va a aparecer la opción Adjuntar comprobante. Solo podés hacerlo una vez […] Si el movimiento ya está anulado, no admite […] JPEG, PNG, WebP o PDF, hasta 4 MB» |

Las cuatro citan «Wallet · Caja» y ninguna nombra un identificador ni «Reversar».

## Notas

1. **El comprobante no se puede subir desde local.** El `.env` apunta el almacenamiento a un proyecto
   Supabase remoto y la subida falla; el servidor responde `comprobante_no_guardado` y NO registra (R76,
   medido: 0 filas). Por eso «abrir el comprobante» del paso 3 queda sin verificar en navegador; lo
   cubren `tests/unit/components/wallet-comprobante-campo.test.tsx` (la pantalla pide el enlace por
   `verComprobanteAction({ destino })` y lo abre) y `tests/integration/db/wallet-comprobante-alcance.test.ts`
   (servidor, 458-B). No se reintentó para no escribir objetos en un bucket remoto.
2. El cobro por rechazo del paso 7 se SEMBRÓ pendiente con un `INSERT` en el clon (una gestión de Tania
   sin cobro, flete 1.800 + IVA 234, las cifras de ejemplo del design) y se aprobó por la pantalla real
   (cola «Cobros por rechazo de tienda por aprobar» → «Cobrar»), que escribe las líneas de caja y los
   débitos por el servicio.
3. «Entró» y «Salió» suben con cada anulación de un egreso: el contra-asiento es un ingreso. Es la regla
   bruta de la 45 (las cifras netas —cifra, ganancia, De las tiendas, capital— vuelven a su valor).
