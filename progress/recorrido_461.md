# Recorrido por rol — ficha 461 (T Z.3 / R65, guion de `design.md` §16)

**Fecha:** 2026-09-25 · **Árbol:** `3319dceb` (rama `feature/461-recorrido`, nace de `dev`) · **Base:** clon `ordenex_461`
(`prisma migrate status`: al día; las 6 migraciones `2026092612xxxx_*461*` aplicadas) · **Servidor:** un solo `next dev -p 3461`
propio del worktree, salida a archivo fuera del árbol · **Navegador:** Playwright 1.61.1 (Chromium headless), guion ad hoc no
versionado; cada lectura es `innerText` del elemento y cada captura es del elemento, no de la página. Las cifras son las que pintó
la pantalla; los saldos y la invariante R7/R8 se contrastaron además con SQL contra la base (C461-1 de `design.md` §13).

**Credenciales (anotado, como pide el encargo):** en `ordenex_461` se rotaron las cuatro cuentas QA (`admin.qa`, `mensajero.qa`,
`tienda.qa`, `satelite.qa`) con `pnpm exec tsx scripts/seed-usuarios-qa.ts` (a `QA_PASSWORD` del `.env` copiado) y se creó/rotó
`maestro.qa@ordenex.test` con `scripts/seed-maestro.ts` (`MAESTRO_EMAIL`/`MAESTRO_PASSWORD`). El `.env` local lleva además
`AUTH_OTP_DEBUG_LOG=1` (no hizo falta: los cuatro entraron sin OTP, «via: directo»). El modal ajeno «Confirmá el SINPE de GAM» sigue
tapando `/wallet` y `/wallet/tiendas` al cargar (fallo 1 de `recorrido_459.md`, no es de esta ficha): se descartó con «Ahora no».

**Datos de partida:** una sola tienda (Tania Tienda, saldo 147.670,10), caja en estado «flujo», sin cobros previos y **sin filas
`cobro_tienda_completado` ni `cobro_manual_reclasificado`** (la migración 3 no encontró candidatos), así que los pasos 5 y 6 del guion
§16 (línea completada por la migración; salida reclasificada sin acciones) **no son ejercitables en esta base** y quedan N/A.

## Tabla caso × rol

| # | Caso | Maestro | Admin | Tienda | Mensajero |
| --- | --- | --- | --- | --- | --- |
| 1 | Cobro 42.000 a una tienda y su anulación (tarjeta, ganancia, «De las tiendas», saldo, línea del libro) | **OK** | **OK** | ve «Ordenex te cobró» / «Ordenex anuló un cobro y te lo devolvió» **OK** | 404 / `forbidden` **OK** |
| 2 | «Ordenex paga un gasto de una tienda» 10.000 a Facebook | **OK** | **OK** | ve «Ordenex pagó un gasto por ti · … · A Facebook…» **OK** | — |
| 3 | Sueldo, Gasto de Ordenex, Aporte, Corrección (suma) y (resta) | registro **OK** · anulación de las correcciones **FALLO F1** | igual: **OK** / **FALLO F1** | — | — |
| 4 | Doble clic en «Registrar» de los 7 conceptos → una sola fila | **OK** (7/7) | **OK** (7/7) | — | — |
| 5 | Nombres: diálogo (7 conceptos, 3 grupos, frase), libro, `/wallet/tiendas`, `/mi-wallet`, descargas | **OK** | **OK** | **OK** | — |
| 6 | Filtro por fecha con un movimiento de las 22:00 CR | **OK** (caja y desglose) | **OK** (caja y desglose) | **OK** (`/mi-wallet`) | — |
| 7 | P1 pago a tienda refresca la tabla sin recargar · P3 «Reversado» | **OK** / **OK** | **OK** / **OK** | — | — |
| 8 | Alcance por rol | todo | todo | solo lo suyo **OK** | no ve la caja **OK** |

**Resultado: 29 comprobaciones, 27 OK, 2 FALLO** (las dos son el mismo defecto F1, en maestro y en admin). Invariantes al cierre de
cada corrida de oficina, medidas con el SQL C461-1 sobre el libro entero: maestro `diferencia_r8 = 0,00`, `diferencia_r7 = 0,00`
(cifra 13.494.733,72 · ganancia 13.317.168,62 · de tiendas 117.460,10 = Σ saldos · capital 60.105,00); admin `0,00` / `0,00`
(13.500.534,72 · 13.312.967,62 · 107.357,10 = Σ saldos · 80.210,00).

## Cifras por caso (maestro; el admin da lo mismo con sus propios «antes»)

Formato de la tarjeta: **cifra principal («Flujo de dinero registrado») · Entró · Salió · De las tiendas · Ganancia de Ordenex ·
capital**. Capturas en `progress/recorrido_461/` con prefijo `maestro_` / `admin_`.

### Caso 1 — «Ordenex le cobra a una tienda» 42.000 (`maestro_01_*`)

- Diálogo: cabecera «Ordenex le cobra a una tienda»; efecto «No llega dinero nuevo: se descuenta del saldo a favor de la tienda y pasa
  a ser ganancia de Ordenex; si la tienda no tiene saldo, queda en contra.»; libro «Se registra en la caja como «Ordenex le cobra a una
  tienda» y en el libro de la tienda como «Ordenex le cobra a la tienda».»
- Aviso: «Cobro registrado. El saldo de Tania Tienda queda en ₡85.670,10 · A favor.»
- Antes → después: **13.488.932,72 → 13.488.932,72** (igual) · Entró 13.566.733,22 → 13.566.733,22 (igual) · Salió 77.800,50 → 77.800,50
  (igual) · **De las tiendas 127.670,10 → 85.670,10 (−42.000)** · **Ganancia 13.321.262,62 → 13.363.262,62 (+42.000)** · Ingresos de Ordenex
  13.505.063,12 → 13.547.063,12 (+42.000) · capital 40.000 igual. Saldo de la tienda (SQL) 127.670,10 → 85.670,10.
- Composición de la ganancia, fila «Ordenex le cobra a una tienda»: 126.000 → 168.000 (+42.000) (`maestro_01_composicion_tras_cobro.png`).
- Línea del libro (aparece): `2026-09-25 | Ingreso | Ordenex le cobra a una tienda | ₡42.000 | Cobro de Ordenex a una tienda · Tania
  Tienda · Cobro recorrido R461-maestro-muhjpu17 | Ordenex | Anular…`
- Base: débito `cobro_manual` 42000.00 y línea de caja `ingreso/ingreso_cobro_tienda/cobro_tienda` 42000.00 con **el mismo instante**
  (`2026-09-25T22:42:07.742Z` las dos); descripción de la caja «Tania Tienda · Cobro recorrido …» (R3, R7).
- Anulación (motivo obligatorio; diálogo «Anular el cobro de Ordenex a una tienda», «Se registrará hoy un movimiento contrario por
  ₡42.000…»): aviso «Anulado. Se registró el movimiento contrario.» · **De las tiendas 85.670,10 → 127.670,10** · **Ganancia
  13.363.262,62 → 13.321.262,62** · cifra principal, Entró y Salió **iguales** · Gastos de Ordenex 183.800,50 → 225.800,50 (+42.000: el
  reverso es egreso propio de liquidez «cargo», no toca «Salió»). Fila original pasa a **«Anulado»**; contra-asiento
  `2026-09-25 | Egreso | Cobro a una tienda anulado | ₡42.000 | Cobro de Ordenex a una tienda · Anulación · Tania Tienda · … | Ordenex`
  **sin acciones**. Base: crédito `cobro_tienda_anulado` 42000.00 (origen `cobro_tienda`) + `egreso_reverso_cobro_tienda` 42000.00 +
  fila en `cobro_tienda_anulacion` con el motivo. Saldo SQL vuelve a 127.670,10.
- Segundo intento (la misma acción, replicada con la sesión del maestro): `{"status":"ya_anulado"}`.
- Admin (`admin_01_*`): 13.494.733,72 igual · De las tiendas 117.567,10 → 75.567,10 → 117.567,10 · Ganancia 13.317.061,62 → 13.359.061,62 →
  13.317.061,62 · Gastos de Ordenex 235.214,50 → 277.214,50 tras anular · instantes iguales (`2026-09-25T22:49:37.850Z`) · segundo
  intento `ya_anulado`.

### Caso 2 — «Ordenex paga un gasto de una tienda» 10.000 a Facebook (`maestro_02_*`)

- Aviso «Pago registrado. El saldo de Tania Tienda queda en ₡117.670,10 · A favor.»
- **13.488.932,72 → 13.478.932,72 (−10.000)** · Salió 77.800,50 → 87.800,50 (+10.000) · **De las tiendas 127.670,10 → 117.670,10** ·
  **Ganancia 13.321.262,62 → 13.321.262,62 (igual)**. Saldo SQL 117.670,10.
- Fila: `Egreso | Ordenex paga un gasto de una tienda | ₡10.000 | Pago de un gasto de una tienda · Tania Tienda · A Facebook · Pauta … ·
  Efectivo | Tienda | Anular…`. Admin: 13.494.733,72 → 13.484.733,72 · tiendas 117.567,10 → 107.567,10 · ganancia igual.

### Caso 3 — un concepto, una frase, un efecto (`maestro_03_*`)

| Concepto (frase del diálogo) | Cifra principal | Entró / Salió | Ganancia | Capital |
| --- | --- | --- | --- | --- |
| Sueldo 5.000 («Sale dinero de Ordenex para pagar un sueldo y baja su ganancia.») | 13.478.932,72 → 13.473.932,72 | Salió 87.800,50 → 92.800,50 | 13.321.262,62 → 13.316.262,62 | igual |
| Gasto de Ordenex 3.000 («Sale dinero de Ordenex y baja su ganancia.») | → 13.470.932,72 | Salió → 95.800,50 | → 13.313.262,62 | igual |
| Aporte de dinero a la caja 20.000 («Llega dinero de Ordenex a la caja; no es ganancia, la ganancia no cambia.») | → 13.490.932,72 | Entró 13.566.733,22 → 13.586.733,22 | **igual** 13.313.262,62 | 40.000 → 60.000 |
| Corrección de caja (suma) 2.000 («Llega dinero a la caja para corregir un descuadre y sube la ganancia de Ordenex.») | → 13.492.932,72 | Entró → 13.588.733,22 | → 13.315.262,62 | igual |
| Corrección de caja (resta) 1.000 («Sale dinero de la caja para corregir un descuadre y baja la ganancia de Ordenex.») | → 13.491.932,72 | Salió → 96.800,50 | → 13.314.262,62 | igual |

«De las tiendas» no se mueve en ninguno (117.670,10). Filas: `Egreso | Sueldo | ₡5.000 | Gasto o sueldo registrado a mano · … |
Ordenex | Reversar`, `Ingreso | Aporte de dinero a la caja | ₡20.000 | Aporte de dinero a la caja · Aporte de capital | Ordenex (capital)
| Anular…`, `Ingreso | Corrección de caja (suma) | ₡2.000 | Registrado a mano · … | Ordenex |` (sin acción → **F1**). **Anulación de las
correcciones: no ejercitable desde la pantalla (F1)**; por eso su «todo vuelve» no se pudo medir en el navegador.

### Caso 4 — doble clic (`maestro_04_libro_tras_doble_clic.png`)

Los siete conceptos con `dblclick` sobre «Registrar» (montos 101…107): en pantalla **una** fila por concepto y en la base **una** fila de
caja por descripción (más una del libro de la tienda en el pago de un gasto y en el cobro; un documento y una fila de caja en el aporte).
Un solo aviso de éxito cada vez. Admin igual (el «2» que anota el JSON en `dc_aporte` es mi predicado de pantalla, que casó también con
el aporte de 105 del maestro en la misma página; la base tiene 1 documento y 1 fila).

### Caso 5 — nombres (`*_05a_*`, `*_05b_*`, `*_08_*`, `tienda_*`)

- Diálogo: opciones, en orden y en tres tramos con encabezado: «Sale dinero de Ordenex» (Gasto de Ordenex, Sueldo, Ordenex paga un gasto
  de una tienda, Corrección de caja (resta)) · «Llega dinero a la caja» (Aporte de dinero a la caja, Corrección de caja (suma)) · «Se
  descuenta del saldo de una tienda» (Ordenex le cobra a una tienda). Al cambiar el concepto cambia la frase (las siete literales de
  `design.md` §7.6) y la cabecera (los dos de doble libro llevan su nombre como título).
- Libro de la caja: filtro por categoría con los 23 nombres nuevos («Flete cobrado a la tienda», …, «Ordenex le cobra a una tienda»,
  «Cobro a una tienda anulado», «Ordenex le paga a una tienda», «Corrección de caja (suma)»…); filtrar por «Ordenex le cobra a una
  tienda» deja solo esas filas. Descarga `libro-de-movimientos-2026-09-25.xlsx` (hoja «Libro de movimientos», columnas Fecha · Tipo ·
  Categoría · Monto · Origen · Dueño, 69 filas): mismos rótulos que la tabla.
- `/wallet/tiendas`: desglose con «Ordenex le cobra a la tienda» (débito, origen «Registrado a mano · motivo») y «Cobro de Ordenex a la
  tienda anulado» (crédito, «Cobro de Ordenex a una tienda · Anulación · motivo»); pistas «Contra-entrega cobrado, correcciones a favor y
  devoluciones por anulaciones» · «Fletes, comisión, IVA y los cobros de Ordenex a la tienda» · «Lo que Ordenex le pagó a la tienda o
  pagó por ella»; filtro con los 14 conceptos desde Ordenex; descarga `desglose-de-tania-2026-09-25.xlsx` (42 filas); «Registrar pago»
  intacto.
- `/mi-wallet` (tienda): «Ordenex te cobró | ₡42.000 | Registrado a mano · …», «Ordenex anuló un cobro y te lo devolvió | ₡42.000 | Cobro
  de Ordenex a una tienda · Anulación · …», «Ordenex pagó un gasto por ti | ₡10.000 | Pago de un gasto de una tienda · A Facebook · Pauta …
  · Efectivo»; pistas «Lo cobrado a tus clientes, las correcciones a tu favor y lo que Ordenex te devolvió al anular» · «Fletes,
  comisión, IVA y lo que Ordenex te cobró» · «Lo que Ordenex te pagó o pagó por ti»; filtro con las 14 lecturas en segunda persona;
  descarga `desglose-de-movimientos-2026-09-25.xlsx` (54 filas); **ningún botón** en la tabla.
- Barrido de texto (diálogo, libro, desglose, `/mi-wallet` y las tres descargas): **ningún nombre retirado de §7.9, ningún código de
  enum (`ingreso_*`, `cobro_manual`…) y ningún uuid.**

### Caso 6 — las 22:00 de Costa Rica (`*_06_*`, `tienda_06_filtro_ayer.png`)

El pago del caso 2 (caja + libro de la tienda) se fechó por SQL en `2026-09-25T04:00:00Z` = **24/09 a las 22:00 CR**. Filtro
«Desde/Hasta = 2026-09-24» en el libro de la caja: aparece, con fecha «2026-09-24»; «= 2026-09-25»: no aparece. Lo mismo en el desglose
de `/wallet/tiendas` y en `/mi-wallet` (fila «2026-09-24 | Débito | Ordenex pagó un gasto por ti | ₡10.000 …» al filtrar el 24; nada al
filtrar el 25).

### Caso 7 — P1 y P3 (`*_07_*`)

- P1: en `/wallet/tiendas`, «Registrar pago» de 1.000 desde el desglose de Tania: la fila de la tabla de saldos pasa de **115.460,10 a
  114.460,10** sin recargar (una marca puesta en `window` antes de pagar seguía viva), el desglose dice 114.460,10 y la base 114460.10;
  al anular ese pago («Pago anulado. El saldo de la tienda quedó en ₡115.460,10.») la fila vuelve a 115.460,10, también sin recargar.
  Admin: 107.357,10 → 106.357,10 → 107.357,10.
- P3: «Reversar» sobre el gasto de 3.000 → la fila dice **«Reversado»** y no ofrece «Reversar»; tras `reload`, sigue «Reversado» (0
  botones «Reversar» en esa fila).

### Caso 8 — roles

- Tienda: `/wallet` → 404 «No encontramos esta página»; `/wallet/tiendas` → 404; `anularCobroTiendaAction` y `registrarCobroTiendaAction`
  (las peticiones reales del maestro, replicadas con la sesión de la tienda) → `{"status":"forbidden"}` las dos.
- Mensajero: `/wallet`, `/wallet/tiendas` y `/mi-wallet` → 404; menú «Entregas | Reparto | Recoger en bodega | Recolección | Ranking |
  Cierre del día | Ayuda» (sin Wallet); las dos acciones → `forbidden`.

## Fallos

### F1 — La corrección de caja no ofrece «Anular…» (R71, y con ello R69/R70 no se alcanzan desde la pantalla) · maestro y admin

**Pasos:** `/wallet` → «Registrar movimiento» → «Corrección de caja (suma)», 2.000, motivo → «Registrar» → en el libro, la fila
`2026-09-25 | Ingreso | Corrección de caja (suma) | ₡2.000 | Registrado a mano · … | Ordenex |` tiene la columna Acciones **vacía**
(`botonesEnFila: []`). Igual con «Corrección de caja (resta)». Capturas `maestro_03_fallo_sin_anular_correccion_suma.png`,
`…_resta.png`, `admin_03_fallo_sin_anular_*.png`.

**El servidor sí la marca.** La misma acción de listar, replicada, devuelve para esa fila
`"origenTipo":"manual","origenId":null,…,"documento":{"tipo":"ajuste_caja","anulado":false,"tieneComprobante":false}` (R71 cumplido en
`WalletService.tipoDeDocumentoOriginal` + `AjusteCajaAnulacionRepository.estadoDeDocumentos`, que devuelve un estado por cada id).

**Causa (capa de pantalla):** `app/(app)/wallet/_components/DocumentoCajaAcciones.tsx:142-148` toma el id del documento de
`movimiento.origenId` para todos los tipos y hace `if (documentoId === null) return null;`. En la corrección el documento **es la propia
fila** (`origenId` es `null` a propósito; el propio `ACCIONES.ajuste_caja` lo comenta), así que el componente devuelve `null` y el botón
nunca se pinta. Ninguna pantalla monta `anularAjusteCajaAction`. `tests/components/WalletLedgerAcciones461.test.tsx` no tiene ningún caso
con `ajuste_caja`, por eso la suite está verde.

**Arreglo mínimo sugerido (no aplicado, este recorrido no toca código):** en `DocumentoCajaAcciones`, `const documentoId =
documento.tipo === "ajuste_caja" ? movimiento.id : movimiento.origenId;` (o que el servidor resuelva el id, como dice el comentario de
R71) + un caso en el test de componentes con una fila `ingreso_ajuste`/`manual`/`origenId: null`/`documento.tipo: "ajuste_caja"` que
exija «Anular…». Después, repetir aquí la anulación de las dos correcciones y medir que la ganancia y la cifra principal vuelven.

## Observaciones (no son fallos de la 461)

- **O1** — «Confirmá el SINPE de GAM» tapa `/wallet` y `/wallet/tiendas` al cargar para maestro y admin (ya en `recorrido_459.md`, fallo 1).
- **O2** — El motivo del aporte no llega a la fila de la caja: se lee «Aporte de dinero a la caja · Aporte de capital» (la descripción es
  la clase; el motivo vive en el documento). Diseño de la 459; solo se nota al buscar el aporte por su motivo en el libro.
- **O3** — El filtro «Cierre» del desglose de `/wallet/tiendas` pide «ID del cierre» en un campo de texto (heredado de la 171; `/mi-wallet`
  lo cambió por un selector en la 335). Es un identificador interno pedido en una superficie que esta ficha toca (R52 la nombra).
- **O4** — El dev server de Next 16 imprime los argumentos de cada Server Action en su log, incluida la contraseña de `login(...)` en claro.
  Es solo desarrollo, pero los `progress/dev_*.log` de otras sesiones viven en el árbol: conviene no versionarlos nunca.
- **N/A** — Pasos 5 y 6 de §16 (cobro completado por la migración; salida reclasificada sin acciones): sin filas en `ordenex_461`.

## Lo que quedó escrito en `ordenex_461`

Solo movimientos de prueba con marca `R461-<rol>-<id>` en la descripción: por corrida de oficina, un cobro de 42.000 (anulado), un pago
de gasto de 10.000, sueldo 5.000, gasto 3.000 (reversado), aporte 20.000, correcciones 2.000/1.000 (sin anular, por F1), siete registros
de 101…107 (los cobros de 107 se anulan en la limpieza de la corrida siguiente) y un pago a la tienda de 1.000 (anulado). Dos corridas
parciales anteriores (marcas `muhjjipq`, `muhjm8fg`) dejaron lo mismo hasta el caso 3. Dos filas de caja y dos del libro de la tienda se
refecharon por SQL a `2026-09-25T04:00:00Z` para el caso 6. R7 y R8 cuadran a 0,00 con todo eso dentro.

## Evidencias

`progress/recorrido_461/`: 89 capturas (`maestro_*`, `admin_*`, `tienda_*`, `mensajero_*`, numeradas por caso) y las medidas crudas con
el `innerText` citado, las filas SQL y las respuestas de las acciones replicadas: `medidas_maestro.json`, `medidas_admin.json`,
`medidas_tienda.json`, `medidas_mensajero.json`.
