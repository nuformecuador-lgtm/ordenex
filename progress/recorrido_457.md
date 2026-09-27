# Recorrido por rol — ficha 457 «Una tienda le paga a Ordenex» (R79, guion de `design.md` §17)

**Fecha:** 2026-09-25 (hora de Costa Rica; en UTC ya era el 26, lo que puso a prueba las fechas) · **Árbol:** `0ab05a1d`
(`origin/feature/457-backend`, rama local `wt/457-recorrido`) · **Base:** clon `ordenex_457w` (`CREATE DATABASE … TEMPLATE ordenex`
+ `prisma migrate deploy`: aplicadas `20260927120000_abono_tienda_457_enums` y `20260927120100_abono_tienda_457_tablas_y_checks`)
· **Servidor:** un solo `next dev -p 3457` del worktree, con la salida a un archivo fuera del árbol · **Navegador:** Playwright
(Chromium headless, `locale es-CR`, `timezoneId America/Costa_Rica`) con un guion ad hoc que no se versiona. Cada lectura es el
`innerText` del elemento y cada captura es del elemento. Los saldos, las filas y el cuadre R7/R8 se contrastaron además con SQL
contra el clon.

**Cuentas:** en el clon, `seed-usuarios-qa.ts` rotó las cuatro cuentas QA a `QA_PASSWORD` del `.env` copiado, y `seed-maestro.ts`
dejó `maestro.qa@ordenex.test`. Las cinco entraron «via: directo», sin OTP. **Siembra:** una segunda tienda, `Bruno Tienda R457`
(`r457-tiendab@ordenex.test`, clonada de la de Tania por SQL), para que el admin recorra otra tienda y para probar el comprobante
«ajeno». Cada corrida de oficina dejó primero su tienda en −10.000,00 con un «Ordenex le cobra a una tienda» registrado desde el
diálogo, como pide el guion. Todos los textos de prueba llevan la marca `R457-<rol>-<id>`.

**Límite de entorno (comprobante):** el `.env` local apunta el almacenamiento al Supabase de **producción**
(`scfnwxqbsgkzwsdntdvd`), y ahí el bucket `wallet-comprobantes` **no existe**. Lo medí con una sola lectura
(`GET /storage/v1/bucket/wallet-comprobantes` → `NoSuchBucket`). No lo creé, porque habría sido escribir en producción. Por eso
«registrar CON comprobante» y «abrir el PDF» quedan **NO VERIFICABLES**. Lo que sí se midió es que el registro con comprobante
no deja nada escrito, y que el botón y la autorización de «Ver comprobante» funcionan (para eso se sembró una ruta en una fila).

## Resultado

**47 OK · 1 FALLO · 5 NO VERIFICABLE (sin bucket) · 1 N/A** (el historial del admin: `/historico/acciones` es solo del maestro,
por diseño, según `ROLES_HISTORIAL_ACCIONES`).

| # | Paso | Maestro (Tania) | Admin (Bruno) |
| --- | --- | --- | --- |
| 1 | Diálogo: tres grupos, ocho conceptos, frase y cabecera; tienda, método, referencia (con SINPE) y comprobante | OK | OK |
| 2 | Registrar 4.000 CON PDF | N/V (no se escribe nada: OK) | N/V (ídem) |
| 3 | Registrar 4.000 SIN comprobante, SINPE 123456, fecha de ayer → aviso | OK | OK |
| 4 | Tarjeta: cifra principal, Entró y «De las tiendas» +4.000; ganancia y capital iguales; saldo de la tienda +4.000 | OK | OK |
| 5 | Fila del libro: nombre, origen, dueño «Tienda», fecha de ayer, «Anular…» | OK | OK |
| 6 | Doble clic en «Registrar» → una sola fila | OK | OK |
| 7 | `excede` bajo el monto | OK | OK |
| 8 | Saldar la deuda → «En cero» | OK | OK |
| 9 | `sin_deuda` bajo la tienda | OK | OK |
| 10 | Filtro por concepto del libro, y filtro por fecha en hora de CR (ayer / hoy) | OK | OK |
| 11 | «Anular…» con motivo → todo vuelve a su sitio; el reverso sale fechado HOY en CR y sin acciones | OK | OK |
| 12 | Segundo intento → `ya_anulado` | OK | OK |
| 13 | «Ver comprobante»: el botón aparece solo con comprobante; abrir el PDF | botón OK · abrir N/V | botón OK · abrir N/V |
| 14 | `/wallet/tiendas` con deuda: filas, cabecera y botón «Registrar pago de la tienda a Ordenex» | OK | OK |
| 15 | Pagar desde el desglose (concepto y tienda fijos): la tabla se actualiza sin recargar y, con saldo 0, el botón desaparece | OK | OK |
| 16 | Descargas (libro y desglose) sin códigos crudos ni uuids | OK | OK |
| 17 | Historial: «Registró / Anuló un pago de una tienda a Ordenex», sin el motivo | OK | N/A |
| 18 | Cuadre R7/R8 = 0,00 al cierre de la corrida | OK | OK |

| Rol | Paso | Resultado |
| --- | --- | --- |
| Tienda (Tania) | `/mi-wallet`: «Le pagaste a Ordenex» y «Ordenex anuló el pago que le hiciste», con motivo y método en el origen | OK |
| | Pistas de «A tu favor» y «Cargos de Ordenex» | OK |
| | El saldo de `/mi-wallet` es igual al de `/wallet/tiendas` (₡0 = ₡0 = SQL 0,00) | OK |
| | Filtro con las dos lecturas nuevas | OK |
| | Descarga sin códigos ni uuids | OK |
| | Ningún botón de registrar ni de anular en la tabla | OK |
| | `obtenerComprobanteAbonoAction`: con un pago de OTRA tienda → `no_encontrado` | OK |
| | Ídem con SU pago: pasa la comprobación de dueño y cae al firmar la URL (no hay bucket) | N/V |
| | `registrarAbonoTiendaAction` y `anularAbonoTiendaAction` → `forbidden`; `/wallet` y `/wallet/tiendas` → 404 | OK |
| Mensajero | `/wallet`, `/wallet/tiendas` y `/mi-wallet` → 404 «No encontramos esta página» | OK |
| | Las tres actions → `forbidden` | OK |
| Satélite | `/wallet`, `/wallet/tiendas` y `/mi-wallet` → 404 | OK |
| | Las tres actions → `forbidden` | OK |
| Asistente | Las cuatro preguntas de §11 | OK ×4 |
| Spec | La consulta M8 de §14 contra producción | **FALLO F1** |

## Cifras y textos citados (maestro; el admin da lo mismo sobre Bruno)

**1 — Diálogo** (`maestro_01_conceptos.png`, `maestro_01_dialogo_abono.png`)
- La lista se lee así: «Sale dinero de Ordenex» (Gasto de Ordenex, Sueldo, Ordenex paga un gasto de una tienda, Corrección de
  caja (resta)) · «Llega dinero a la caja» (Aporte de dinero a la caja, **Una tienda le paga a Ordenex**, Corrección de caja
  (suma)) · «Se descuenta del saldo de una tienda» (Ordenex le cobra a una tienda). Son **8** opciones.
- Frase del efecto: «Llega dinero de la tienda a la caja: paga lo que debe y su saldo sube; la ganancia de Ordenex no cambia.»
- Frase del libro: «Se registra en la caja como «Una tienda le paga a Ordenex» y en el libro de la tienda como «La tienda le paga
  a Ordenex».»
- Cabecera: título «Una tienda le paga a Ordenex». Descripción: «Elegí la tienda, el monto, la fecha real y el método. Solo se
  admite si la tienda tiene saldo en contra y hasta lo que debe. El pago no se edita: si hay un error, se anula desde el libro de
  la caja con un motivo.»
- Campos: «Tienda que paga» (pista «Solo se admite si la tienda tiene saldo en contra, y hasta lo que debe.») · Monto · Fecha ·
  «Motivo del pago» · «Método de pago*» · «Comprobante (opcional)». La referencia aparece solo después de elegir SINPE (0 → 1
  campo).

**2 — Con PDF:** aviso en el diálogo, «No se pudo guardar el comprobante, así que no se registró nada. Probá de nuevo.». En la
base quedan 0 `abono_tienda` y el saldo sigue en −10.000,00 (`maestro_02a_con_pdf_aviso.png`).

**3 — Sin comprobante:** «Pago registrado. El saldo de Tania Tienda queda en -₡6.000 · En contra. La tienda todavía le debe ese
dinero a Ordenex.». Admin: «… Bruno Tienda R457 Tienda queda en -₡6.000 · En contra. …».

**4 — Tarjeta** (`maestro_00_caja_antes.png` → `maestro_03_caja_tras_pago.png`)

| Cifra | Maestro | Admin |
| --- | --- | --- |
| Cifra principal | 13.497.932,72 → 13.501.932,72 (+4.000) | 13.507.932,72 → 13.511.932,72 (+4.000) |
| Entró | 13.542.733,22 → 13.546.733,22 (+4.000) | 13.556.733,22 → 13.560.733,22 (+4.000) |
| Salió | 44.800,50, igual | 48.800,50, igual |
| De las tiendas | −10.000 → −6.000 (+4.000) | −10.000 → −6.000 (+4.000) |
| De Ordenex (ganancia) | 13.507.932,72, **igual** | 13.517.932,72, **igual** |
| Capital | 0, igual | 0, igual |

Saldo SQL de la tienda: −10.000,00 → −6.000,00.

**5 — Fila del libro:** `2026-09-24 | Ingreso | Una tienda le paga a Ordenex | ₡4.000 | Pago de una tienda a Ordenex · Tania
Tienda · R457-maestro-muhxvoms Pago de lo que debía por los fletes de septiembre · SINPE · 123456 | Tienda | Anular…`. El nombre
accesible del botón es «Anular Una tienda le paga a Ordenex del 2026-09-24 por ₡4.000».

En la base:
- `abono_tienda`: `fecha_pago` 2026-09-24, SINPE, referencia 123456.
- Caja: `ingreso/ingreso_abono_tienda` 4000.00, fecha `2026-09-24T06:00` (medianoche de CR), «Tania Tienda · … · SINPE · 123456».
- Tienda: `credito/abono_tienda` 4000.00, mismo instante, «… · SINPE · 123456».

**6 — Doble clic** (1.000 en efectivo, `dblclick` sobre «Registrar»):
- Un solo aviso: «Pago registrado. … queda en -₡5.000 · En contra. …».
- Una fila en pantalla.
- En la base: `documentos 1 · filas_caja 1 · filas_tienda 1 · historial 1`.
- Cifra principal 13.501.932,72 → 13.502.932,72.

**7/8/9 — Tope:**
- Con 7.000 sobre una deuda de 5.000, bajo el monto: «La tienda debe ₡5.000: el pago no puede superar ese importe.». El
  diálogo sigue abierto y el monto tecleado se conserva («7000»).
- Con 5.000: «Pago registrado. El saldo de Tania Tienda queda en ₡0 · En cero.».
- Con otro pago de 100, bajo la tienda: «Esta tienda no tiene saldo en contra: no hay nada que pagar.» (junto a la pista). El
  monto no muestra ningún error y en la base hay 0 filas.

**10 — Filtros del libro:**
- El filtro de categorías (26) ofrece «Una tienda le paga a Ordenex» y «Pago de una tienda a Ordenex anulado».
- Desde/Hasta = 2026-09-24 → aparece el pago de 4.000 fechado «2026-09-24».
- Desde/Hasta = 2026-09-25 → aparecen el de 5.000 y el de 1.000, y no el de ayer.

**11/12 — Anulación:**
- Diálogo: «Anular el pago de una tienda a Ordenex | Se registrará hoy un movimiento contrario por ₡4.000. El registro original,
  su comprobante y su historial quedan intactos: no se borra nada. | Una tienda le paga a Ordenex · 2026-09-24 · ₡4.000 | Motivo
  de la anulación* …». «Anular» está deshabilitado mientras el motivo esté vacío.
- Aviso: «Anulado. Se registró el movimiento contrario.».
- Cifras del maestro: principal 13.507.932,72 → 13.503.932,72 (−4.000) · Entró igual · **Salió 44.800,50 → 48.800,50 (+4.000)** ·
  De las tiendas 0 → −4.000 · **ganancia igual** · capital igual. Admin: principal −4.000, Salió 48.800,50 → 52.800,50, tiendas
  0 → −4.000, ganancia igual.
- La original queda `… | Tienda | Anulado`, sin botones.
- Reverso: `2026-09-25 | Egreso | Pago de una tienda a Ordenex anulado | ₡4.000 | Pago de una tienda a Ordenex · Anulación · Tania
  Tienda · … · SINPE · 123456 | Tienda`, **sin acciones**. En la base su fecha es `2026-09-25T06:00`: es HOY en CR, aunque el
  reloj UTC marcaba el 26.
- En la base: 1 `abono_tienda_anulacion`.
- Segundo intento (la misma action, replicada con la sesión): `{"status":"ya_anulado"}` en los dos roles.

**13 — Comprobante:** con una ruta sembrada por SQL en la fila de 1.000, la fila muestra «Ver comprobante [Ver comprobante de Una
tienda le paga a Ordenex del 2026-09-25]» junto a «Anular…». Las filas sin comprobante no muestran el botón. Al pulsarlo sale el
aviso «No se pudo abrir el comprobante ahora. Probá de nuevo.»: la firma de la URL falla porque no hay bucket, y la action
responde con el error 500 «abono-tienda: AppErrorCode inesperado INTERNAL» (ver O2).

**14/15 — `/wallet/tiendas`:**
- Fila de la tabla: `Tania | -₡4.000 | En contra`.
- Cabecera: «A favor de la tienda … Contra-entrega cobrado, correcciones a favor, pagos de la tienda a Ordenex y devoluciones por
  anulaciones» · «Cargos de Ordenex … Fletes, comisión, IVA, los cobros de Ordenex a la tienda y sus pagos a Ordenex anulados».
- Filas: «Crédito | La tienda le paga a Ordenex | ₡5.000 | Pago de una tienda a Ordenex · … salda la deuda · Efectivo» y «Débito
  | Pago de la tienda a Ordenex anulado | ₡4.000 | Pago de una tienda a Ordenex · Anulación · … · SINPE · 123456».
- Con deuda hay **1** botón «Registrar pago de la tienda a Ordenex».
- Al abrirlo: concepto y tienda deshabilitados, con la tienda «Tania», y la cabecera «Una tienda le paga a Ordenex».
- Pago de 4.000 → aviso «… queda en ₡0 · En cero.». La fila de la tabla pasa de **-₡4.000 a ₡0 sin recargar** (una marca puesta en
  `window` antes de pagar seguía viva). Con saldo 0 hay **0** botones. Admin: lo mismo.

**16 — Descargas:**
- `libro-de-movimientos-2026-09-25.xlsx`: hoja «Libro de movimientos», columnas Fecha · Tipo · Categoría · Monto · Origen · Dueño.
  Incluye la fila «2026-09-25 | Egreso | Pago de una tienda a Ordenex anulado | 4000.00 | … | Tienda».
- `desglose-de-tania-2026-09-25.xlsx`: Fecha · Tipo · Concepto · Monto · Origen.
- Barrido de la pantalla y de las dos descargas: sin códigos de enum y sin uuids.

**17 — Historial (maestro):**
- `25 sept 2026, 11:19 p. m. | Maestro QA | Maestro | Mueve dinero | Anuló un pago de una tienda a Ordenex | Pago de una tienda a
  Ordenex | Tania Tienda | ₡4.000 | — | —`.
- En total hay 9 «Registró…» y 2 «Anuló…», contando las corridas parciales anteriores. Ni el motivo ni la referencia aparecen.
- La hora está en CR.
- El filtro por tipo no se ejercitó.

**18 — Cuadre** (C461-1 al cierre de cada corrida; ver F1 para las dos categorías añadidas):

| Corrida | Entró | Salió | Cifra | Ganancia | De tiendas | Σ saldos | R8 | R7 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Maestro | 13.556.733,22 | 48.800,50 | 13.507.932,72 | 13.507.932,72 | 0,00 | 0,00 | **0,00** | **0,00** |
| Admin (y final) | 13.570.733,22 | 52.800,50 | 13.517.932,72 | 13.517.932,72 | 0,00 | 0,00 | **0,00** | **0,00** |

**Tienda** (`tienda_01_mi_wallet.png`, `tienda_02_desglose.png`)
- Filas: «Crédito | Le pagaste a Ordenex | ₡5.000 | Pago de una tienda a Ordenex · R457-maestro-… salda la deuda · Efectivo» y
  «Débito | Ordenex anuló el pago que le hiciste | ₡4.000 | Pago de una tienda a Ordenex · Anulación · … · SINPE · 123456». En la
  descarga también sale la del 24: «2026-09-24 | Crédito | Le pagaste a Ordenex | 4000.00 | … · SINPE · 123456».
- Pistas: «Lo cobrado a tus clientes, las correcciones a tu favor, lo que le pagaste a Ordenex y lo que Ordenex te devolvió al
  anular» · «Fletes, comisión, IVA, lo que Ordenex te cobró y los pagos a Ordenex que se anularon».
- Los únicos botones de la tabla son los «Ver las órdenes que componen …» de los cierres. No hay ninguno de registrar ni de anular.
- Comprobante de otra tienda → `{"status":"no_encontrado"}`. Registrar y anular → `{"status":"forbidden"}`.

**Asistente** (ANTHROPIC_API_KEY presente; `asistente_*.png`, las respuestas completas en `medidas_asistente.json`)
- «¿cómo registro que Nuform me pagó?» → describe los dos caminos: el concepto «Una tienda le paga a Ordenex» del grupo «Llega
  dinero a la caja» y «Registrar pago de la tienda a Ordenex» en Wallet · Tiendas. Añade el tope y la referencia obligatoria en
  SINPE y transferencia.
- «¿sube la ganancia si una tienda me paga?» → «No, la ganancia no sube. … sube lo que entró y la cifra grande, y sube lo que
  Ordenex les debe a las tiendas … lo que la tienda debía ya se había contado como ganancia cuando se aprobó cada cierre».
- «¿cómo anulo un pago de una tienda?» → distingue el pago A la tienda (en Wallet · Tiendas) del pago DE la tienda («Anular…» en el
  libro de la caja, con motivo obligatorio).
- Tienda, «¿qué es Le pagaste a Ordenex?» → lo explica y dice que la anulación aparece como «Ordenex anuló el pago que le hiciste» y
  que «El comprobante de ese pago lo guarda la oficina».

## Fallos

### F1 — El chequeo M8 de producción usa la C461-1 literal, y con la 457 daría R8 ≠ 0

**Dónde:** `specs/457-la-tienda-paga-a-ordenex/design.md:689-691` (M8, «es EXACTAMENTE C461-1 … diferencia_r8 = 0,00») y
`:696-697` («Tras el primer pago real de Nuform: … M8 en 0,00»).

**Qué pasa:** la C461-1 (`specs/461-…/design.md:651-652`) lista los terceros a mano y no incluye `ingreso_abono_tienda` ni
`egreso_reverso_abono_tienda`, así que los trata como «propio». Medido en el clon al cierre:
- La consulta **literal** da `ganancia 13.551.932,72 · de_tiendas −34.000,00 · diferencia_r8 −34.000,00` (R7 0,00).
- La misma consulta, con esas dos categorías añadidas a terceros (lo que dice §4 de la 457), da `diferencia_r8 0,00`.

La app cuadra: la tarjeta muestra la ganancia correcta (13.517.932,72, igual antes y después de cada pago). Pero el contraste de
producción que manda §14 saldría rojo después del primer pago real de Nuform, y parecería un fallo de la feature.

**Arreglo sugerido (no aplicado):** en M8, añadir `'ingreso_abono_tienda','egreso_reverso_abono_tienda'` a la lista de terceros de
la C461-1, o escribir una «C457-1» con esa lista.

## Observaciones (no son fallos de la 457)

- **O1** — «Confirmá el SINPE de …» tapa `/wallet` al cargar (se cerró con «Ahora no», una vez por corrida; ya está en
  `recorrido_459.md`).
- **O2** — «Ver comprobante» con fallo del almacenamiento: `obtenerComprobanteAbonoAction` **lanza** (500, «AppErrorCode inesperado
  INTERNAL», `lib/actions/abono-tienda.ts:76`) en vez de devolver un estado. Es el mismo molde que `pago-por-cuenta-tienda.ts:79`.
  La pantalla lo convierte en «No se pudo abrir el comprobante ahora. Probá de nuevo.», así que el usuario no ve un error crudo.
- **O3** — El nombre de las descargas usa la fecha **local del navegador** (`lib/utils/descarga-dataset.ts:114-115`), igual que el
  chip de fecha de la cabecera. En una primera corrida sin `timezoneId`, el navegador en la zona del equipo (UTC−5) nombró el libro
  `…-2026-09-26.xlsx` cuando en CR aún era el 25. El contenido (la columna Fecha) sí sale en hora de CR. Es anterior a esta ficha.
- **O4** — Las cifras de la tarjeta siguen el filtro del libro («Registros del periodo que estás viendo»). Una lectura con el libro
  filtrado no sirve de «antes». El «antes» del doble clic se tomó de la lectura sin filtro del paso 4.
- **O5** — El PDF no se pudo probar porque el `.env` local lleva el Storage de producción y el bucket no existe ahí. Crear el bucket
  en producción es un paso previo del despliegue de la 459. Mientras tanto, un registro con comprobante en local siempre dice «No se
  pudo guardar el comprobante…».

## Lo que quedó escrito en `ordenex_457w` (el clon se borró al terminar)

La tienda sembrada, las cuentas QA rotadas y, por corrida, lo siguiente con marca `R457-<rol>-<id>`:
- un cobro que deja la tienda en −10.000;
- el pago de 4.000 (anulado);
- el de 1.000 con doble clic (con la ruta de comprobante sembrada);
- el que salda la deuda;
- el de 4.000 desde el desglose.

Además, dos corridas parciales del maestro (`muhxkmcs`, `muhxmqij`, `muhxtlby`) dejaron cobros y pagos antes de fallar el guion. Al
final las dos tiendas están en 0,00 y R7/R8 cuadran a 0,00.

## Evidencias

En `progress/recorrido_457/`:
- 56 capturas de elementos: `maestro_*`, `admin_*`, `tienda_*`, `mensajero_*`, `satelite_*` y `asistente_*`.
- Las medidas crudas: `medidas_{maestro,admin,tienda,mensajero,satelite,asistente}.json`, con el `innerText` citado, las filas
  SQL, las respuestas de las actions replicadas y el cuadre (literal y con las dos categorías).
