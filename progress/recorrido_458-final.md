# 458 — Recorrido COMPLETO por rol, ya integrada en `dev` (design §10, pasos 1–12 + accesibilidad) · 2026-09-26

**Árbol:** `fa6f71a9` (`origin/dev`, rama `wt/458-recorrido-final`; durante el recorrido `dev` avanzó a
`d2363d4b` con 4 archivos de `progress/` y ninguno de código, así que el resultado vale para ese SHA) · **Base:** clon propio `ordenex_458w`
(`CREATE DATABASE … TEMPLATE ordenex`; `prisma migrate deploy`: 227 migraciones, «No pending migrations») ·
**Servidor:** UN solo `next dev -p 3521` (`AUTH_RISK_THRESHOLD=999` solo en su línea de comando), `pnpm install`
propio sin junction, apagado al terminar · **Navegador:** Playwright 1.61.1 (Chromium headless), scripts ad hoc
fuera del árbol; cada lectura es `innerText` del elemento; axe-core 4.12.1 inyectado para WCAG 2.1 A/AA.
**Usuarios:** `maestro.qa`, `admin.qa`, `tienda.qa` (Tania), `mensajero.qa` (Marco), `satelite.qa` (Sara, Quepos);
claves QA rotadas SOLO en el clon (`seed-usuarios-qa`, `seed-maestro`). Evidencia cruda en
`progress/recorrido_458-final/` (105 capturas, 20 `.json`, 4 árboles de accesibilidad).

**Siembra (solo en el clon, marca `R458F-`):** dos cobros por rechazo PENDIENTES de Tania (guías 57202592 ₡1.800+₡234
y 32670963 ₡1.500+₡195) que se aprobaron por la pantalla («Cobrar»); dos incidentes `solicitado` reportados por el
mensajero (guías 75067153 y 35371107) que se aprobaron por `/incidentes` («Aprobar e indemnizar» ₡4.000 / ₡3.500);
una plantilla de gasto fijo «R458F- Alquiler de bodega» ₡7.000 con un cobro pendiente (no se llamó al cron para no
disparar avisos reales); dos consolidaciones `solicitado` de Quepos (₡25.000 y ₡18.000). Todo lo demás se escribió
por la interfaz, con `R458F-<rol>` en el motivo.

## Resultado

**Total: 93 OK · 3 FALLO · 13 N/A** (cada celda de resultado de las tablas cuenta una vez; la fila «Asistente»
de «Transversales» remite a su propia tabla y no se cuenta dos veces). Los tres fallos son F1–F3, abajo; ninguno
toca dinero: R7/R8 cuadró a 0,00 en las 46 medidas.

### Maestro y admin — design §10 pasos 1–12

| # | Paso | Maestro | Admin | Cifras (innerText citado) |
| --- | --- | --- | --- | --- |
| 1 | Tarjetas = fotografía SQL (C458C-1) | OK | OK | maestro «Flujo de dinero registrado ₡13.483.932,72 · Entró ₡13.524.733,22 · Salió ₡40.800,50 · Movimientos 36 · De las tiendas ₡147.670,10 · De Ordenex ₡13.336.262,62 · Saldo inicial y aportes ₡0» = SQL `13483932.72 / 13524733.22 / 40800.50 / 147670.10 / 13336262.62 / 0` (`maestro-01-tarjetas.png`); admin igual con 54 movimientos |
| 1 | Filtro de concepto con su cuenta; sin «Otro gasto de Ordenex» | OK | OK | 11 conceptos, Σ cuentas **36 = 36** filas de la caja («Flete cobrado a la tienda (5)» … «Indemnización que Ordenex paga por un incidente (2)»); admin Σ **54 = 54**; ninguno «Otro gasto» (`maestro-01-conceptos.png`) |
| 2 | Diez conceptos en tres grupos + enlace a plantillas | OK | OK | «SALE DINERO DE ORDENEX» 6 · «LLEGA DINERO A LA CAJA» 3 · «SE DESCUENTA DEL SALDO DE UNA TIENDA» 1 · «Ver las plantillas de gasto fijo» |
| 2 | «Sueldo» con «Así queda» (grupo Sale) | OK | OK | maestro 25.000: «Flujo de dinero registrado Antes: ₡13.483.932,72 Después: ₡13.458.932,72 · Ganancia de Ordenex Antes: ₡13.336.262,62 Después: ₡13.311.262,62 · Lo que Ordenex les debe a las tiendas ₡147.670,10 · no cambia · Saldo inicial y aportes ₡0 · no cambia»; admin 24.000: 13.483.932,72 → 13.459.932,72 y 13.336.262,62 → 13.312.262,62 (`*-02-sueldo-asi-queda.png`) |
| 2 | Registrar con un PDF | N/A | N/A | el almacenamiento del `.env` es remoto y rechaza la subida: «No se pudo guardar el comprobante, así que no se registró nada. Probá de nuevo.» y 0 filas (R76 se cumple); registrado después sin archivo: «Movimiento registrado correctamente.» |
| 3 | Fila nueva: A quién y Registró; «Ver» con «Cómo quedó» | OK | OK | fila «2026-09-26 Sueldo Sueldo · Sueldo R458F-maestro septiembre Pedro R458F-maestro Sale ₡25.000 Ordenex Maestro QA»; panel «A quién Pedro R458F-maestro · Registró Maestro QA · el 2026-09-26 a las 19:58 · Estado Vigente · Cómo quedó Flujo de dinero registrado ₡13.458.932,72 Ganancia de Ordenex ₡13.311.262,62…» (admin «Ana Admin») |
| 3 | «Anular…» → original tachado «Anulado» + contra-asiento; tarjetas de vuelta | OK | OK | «Anulado. Se registró el movimiento contrario.»; original `line-through` «… Maestro QA Anulado Ver»; contra-asiento «Corrección de caja (suma) Gasto o sueldo registrado a mano · Anulación de: Sueldo R458F-maestro…»; cifra y ganancia de vuelta a 13.483.932,72 / 13.336.262,62 (`*-02-sueldo-tras-anular.png`) |
| 3 | Segundo intento desde otra pestaña | OK | OK | «Ya estaba anulado; no se registró nada más.» en los cuatro conceptos y los dos roles |
| 3 | El comprobante se abre | N/A | N/A | sin comprobante subido (ver «Registrar con un PDF»); el panel ofrece «Adjuntar comprobante» |
| 2/3 | «Gasto de Ordenex» 3.000: registrar y anular | OK | OK | «Así queda» 13.483.932,72 → 13.480.932,72 y 13.336.262,62 → 13.333.262,62; anulado, «Ya estaba anulado» al repetir |
| 2/3 | «Corrección de caja (suma)» 1.000 (grupo Llega): registrar y anular | OK | OK | 13.483.932,72 → 13.484.932,72; «Anular la corrección de caja»; tras anular 13.483.932,72 |
| 2/3 | «Ordenex le cobra a una tienda» 5.000 (grupo Se descuenta): registrar y anular | OK | OK | «Saldo de Tania Tienda Antes: ₡147.670,10 Después: ₡142.670,10 · Flujo… ₡13.483.932,72 · no cambia · Ganancia… Después: ₡13.341.262,62 · Lo que Ordenex les debe a las tiendas … Después: ₡142.670,10»; «Cobro registrado. El saldo de Tania Tienda queda en ₡142.670,10 · A favor.»; anulado → 147.670,10 |
| 4 | Estado de cuenta: saldo inicial arriba; saldo corrido de la última fila = tarjeta = listado | OK | OK | maestro «Tania Tienda ₡147.670,10 A favor» = «Saldo actual ₡147.670,10 · Ordenex le debe ₡147.670,10 a Tania Tienda» = última fila «… ₡147.670,10» = SQL 147670.10; primera fila «— Saldo inicial ₡0»; admin 132.670,10 los cuatro |
| 4 | Tienda en contra: frase, «La tienda le paga» visible, «Ordenex le paga» deshabilitado con motivo | OK | OK | cobro de 200.000 → «Saldo actual -₡67.329,90 · Tania Tienda le debe ₡67.329,90 a Ordenex»; acciones «La tienda le paga a Ordenex · Ordenex le cobra a la tienda · Ordenex le paga a la tienda (deshabilitado) · Ordenex no le debe nada a Tania Tienda: sin saldo a favor no hay nada que pagarle.»; admin -₡82.329,90 (`*-04b-tania-en-contra.png`) |
| 4 | «Ver» → «Anular…» el cobro de 200.000 desde el estado de cuenta | OK | OK | fila «… Anulado el 2026-09-26 … · R458F-maestro devolver la tienda a favor» + su «Anulación»; tarjeta de vuelta a ₡132.670,10 / ₡117.670,10 |
| 5 | «Ordenex le cobra a la tienda» 5.000 desde el estado de cuenta; el listado cambia | OK | OK | maestro «Saldo actual ₡142.670,10»; al volver al listado «Tania Tienda ₡142.670,10 A favor»; admin 132.670,10 → 127.670,10, listado «₡127.670,10 A favor» |
| 6 | «Ordenex paga un gasto de una tienda» a Facebook 10.000 | OK | OK | «Saldo de Tania Tienda Antes: ₡142.670,10 Después: ₡132.670,10 · Flujo… Después: ₡13.473.932,72 · Ganancia de Ordenex ₡13.341.262,62 · no cambia»; en la caja `egreso_pago_por_cuenta_tienda` 10000.00 «Tania Tienda · A Facebook · Pauta R458F-maestro · Efectivo» (el `.json` del maestro dice FALLO porque el script leyó el aviso «Procesando…»; la fila está en la base y el admin leyó «Pago registrado. El saldo de Tania Tienda queda en ₡117.670,10 · A favor.») |
| 7 | Cobro por rechazo aprobado → «Ver» → «Anular…» | OK | OK | «Cobro aprobado: ya está en la caja y en el libro de la tienda.»; panel «Es un cobro a la tienda por el flete de un rechazo…»; reversos «Flete por rechazo cobrado a la tienda anulado … Sale ₡1.800» e «IVA del flete por rechazo cobrado a la tienda anulado … Sale ₡234»; créditos `flete_devolucion_anulado` 1800.00 + `iva_flete_devolucion_anulado` 234.00; ganancia 13.338.296,62 → 13.336.262,62 (−2.034), De las tiendas 145.636,10 → 147.670,10 (+2.034), Entró 13.581.733,22 igual; la cola ya no lo ofrece (0 filas). Admin: −1.695 / +1.695 |
| — | Anular una **indemnización** (incidente aprobado por la pantalla) | OK | OK | «Incidente aprobado; la indemnización salió de la caja principal.»; panel «Registró Automático · Incidente resuelto por Maestro QA»; contra-asiento «Corrección de caja (suma) Incidente de orden · guía 75067153 · Anulación de: Indemnización que Ordenex paga por un incidente … Entra ₡4.000»; cifra 13.479.932,72 → 13.483.932,72; admin ₡3.500 |
| — | Anular un **gasto fijo** cobrado | OK | — | aprobado por el maestro desde «Cobros de gasto fijo por aprobar»; fila «Gasto fijo de Ordenex … Sale ₡7.000 Ordenex Maestro QA»; anulado con su «Anulación»; cifra 13.476.932,72 → 13.483.932,72 |
| — | Cola de gastos fijos: el admin la ve y NO la decide | — | OK | admin: «Cobros de gasto fijo por aprobar … 1 por aprobar … R458F- Alquiler de bodega septiembre de 2026 ₡7.000», **0 botones**; maestro: «Aprobar · Rechazar» |
| 8 | Filtro de cierre: por nombre y por día; ningún control pide un ID (tienda) | OK | OK | «Cierre del 2026-09-24 · Rita Recorrido · 5 movimientos», buscar «Rita» → 1, «2026-08-13» → 2 («… 14:22 · Marco Mensajero» / «… 08:59 …»); elegido → **5 filas = 5** del rótulo |
| 8 | Filtro de cierre del mensajero | OK | OK | «Cierre del 2026-08-13 · Marco Mensajero · 3 movimientos» → 3 filas |
| 8 | Órdenes de un cierre (tienda) | OK | OK | «Cierre del día 2026-09-24 · Mensajero: Rita Recorrido · 5 de 14 órdenes del cierre aportan a este concepto · Importe del movimiento: ₡32.500», guías 40520764 … 92987981 |
| 8 | Órdenes de un cierre (mensajero) | OK | OK | la fila «Pago devengado» explica «Este importe es el total que el cierre del día dejó anotado para pagarle al mensajero. No se acumula orden por orden…» (snapshot, como fija la 458-D) |
| 9 | Descarga del libro de la caja | OK | OK | `libro-de-movimientos-2026-09-26.xlsx`, «Fecha · Movimiento · Motivo y origen · A quién · Entra o sale · Monto · Dueño · Registró», 55 / 69 filas, 0 uuid, 0 códigos |
| 9 | Descarga del estado de cuenta de la tienda (con cierre y completa) | OK | OK | 7 y 45 / 49 filas; «Fecha · Movimiento · Motivo · Origen · Cómo se pagó · Registró · Cargo · Abono · Saldo · Estado»; primera «Saldo inicial 0.00»; última fila `117670.10` = tarjeta ₡117.670,10; 0 uuid |
| 9 | Descargas de mensajero y bodega | OK | OK | `estado-de-cuenta-de-marco-mensajero-…xlsx` (5 filas), `estado-de-cuenta-de-quepos-…xlsx` (5 / 6 filas), 0 uuid |
| 9 | Descarga «Pagos registrados» de la tienda | N/A | N/A | la tabla está vacía («Todavía no hay pagos registrados.»); el botón está habilitado y no descarga nada (observación O4) |
| 10 | «Ordenex le paga al mensajero» 1.000 y «Anular…» desde la wallet; `/cierres-admin` sigue | OK | OK | «Se aplica ₡1.000 · Pendiente hoy: ₡3.400 · Queda pendiente: ₡2.400»; tarjeta ₡5.100 → ₡4.100 → **₡5.100**; panel «Este movimiento no tiene línea en la caja: la caja no cambió con él.»; `/cierres-admin` HTTP 200 |
| 11 | Bodega: marcar recibido; el pendiente y la fila del listado cambian | OK | OK | maestro 24.000 de 25.000: «Por entregar hoy ₡43.000» → «₡19.000»; listado «Quepos ₡43.000 hoy» → «Quepos ₡19.000 hoy 26 sept · ₡24.000 de ₡25.000»; admin 18.000: → «₡1.000», listado «Quepos Recibido incompleto ₡1.000 …»; SQL pendiente 19000.00 / 1000.00 |
| 11 | Chips de la bodega «Todo · Declarado · Recibido» | OK | OK | Declarado 2 filas, Recibido 1 / 2, Todo 3 / 4 (+ saldo inicial) |
| 8 | Filtro por cierre y órdenes de un cierre en la bodega | N/A | N/A | R10 lo pide solo para tienda y mensajero; la bodega lleva chips (R24) y sus filas son consolidaciones |
| 12 | Árbol de accesibilidad de «Ver el cierre»: sin uuid | OK | OK | «Ver el cierre del 2026-08-12 de Marco Mensajero»; 0 nombres con uuid (solo en `/url:`); libro de la caja igual (`*-12-arbol-accesibilidad-*.txt`) |
| 12 | `/analitica`: «Movimiento neto del periodo» | N/A | N/A | la región financiera sigue comentada en `AnaliticaShell` (como en la 458-A): 0 textos «Movimiento neto…» y 0 del rótulo viejo |

### El libro con cada filtro (R54, R59)

| Filtro | Maestro | Admin |
| --- | --- | --- |
| «Entra» | OK — 38 movimientos, todas «Entra», «Movimiento neto del periodo ₡13.585.733,22», Salió ₡0 | OK — 45 |
| «Sale» | OK — 16, todas «Sale», «-₡101.800,50», Entró ₡0 | OK — 23 |
| «Todo» | OK — 54, tarjetas iguales a las de partida | OK — 68 |
| Categoría «Sueldo (2)» + «Aplicar» | OK — 2 filas, «-₡50.000» | OK — «Sueldo (3)» → 3 filas |
| Periodo 2026-09-24 | OK — 14 filas = 14 de SQL (día CR) | OK — 14 |
| A quién «Tania Tienda · Tienda · 8 movimientos» | OK — 8 filas, 8 movimientos | OK — 16 / 16 |
| A quién «Marco Mensajero · Mensajero · 19 movimientos» | OK — 19 / 19 | OK — 19 / 19 |
| «Limpiar» | OK — vuelve a 54 y ₡13.483.932,72 | OK — 68 |

### adminTienda (`/mi-wallet`)

| Paso | Resultado | Cifras |
| --- | --- | --- |
| Resumen de tres cifras = tarjeta = saldo corrido | OK | «A tu favor ₡605.129 − Cargos de Ordenex ₡467.458,90 − Ya pagado ₡20.000 = Saldo a favor ₡117.670,10» = «Saldo actual ₡117.670,10 · Ordenex te debe ₡117.670,10» = última fila de la última página = SQL 117670.10 |
| «Anulado por Ordenex», sin nombres del personal | OK | «Ordenex te cobró Cobro R458F-maestro para dejarla en contra … Anulado por Ordenex el 2026-09-26 a las 20:14 · R458F-maestro devolver la tienda a favor ₡200.000»; 0 «Maestro QA»/«Ana Admin» |
| «Ordenex te cobró» / «Ordenex pagó un gasto por ti · A Facebook» | OK | «Ordenex pagó un gasto por ti A Facebook · Pauta R458F-maestro · Efectivo … ₡10.000» |
| «Le pagaste a Ordenex» | N/A | la tienda no tiene ningún pago a Ordenex en la base |
| Sin botones de registrar/anular/adjuntar | OK | 0 |
| Abrir el comprobante que subió Ordenex | N/A | no se puede subir en local; «Ver comprobante» de una fila sin archivo → «Este registro no tiene comprobante.» |
| Descarga de su estado de cuenta | OK | 29 filas, sin columna «Registró», 0 uuid |
| 404 en la oficina | OK | `/wallet`, `/wallet/tiendas`, `/wallet/tiendas/<Tania>`, `/wallet/mensajeros`, `/wallet/mensajeros/<Marco>`, `/wallet/satelites`, `/wallet/satelites/<Quepos>`: 404 las siete |
| Comprobante de otra tienda | N/A | la base tiene una sola tienda (lo midió la 458-D con sonda: `no_encontrado`) |

### Mensajero y adminSatelite (sin acceso)

| Paso | Mensajero | adminSatelite |
| --- | --- | --- |
| Las 7 rutas de la oficina y `/mi-wallet` → 404 | OK (8/8) | OK (8/8) |
| El menú no ofrece Wallet | OK («Entregas Recolección Ranking Cierre del día Ayuda») | OK («Analítica Monitoreo Órdenes Cierres del día Incidentes Mi bodega Ayuda») |
| Actions de previsualizar, registrar y anular (capturadas del maestro y ABORTADAS antes de salir; repetidas con la sesión del rol) → `forbidden` sin escribir | OK (3/3 `{"status":"forbidden"}`) | OK (3/3); también adminTienda 3/3; filas caja/tienda/anulaciones 78/47/4 antes y después |

### Transversales

| Paso | Resultado | Cifras |
| --- | --- | --- |
| **Cuadre R7/R8** con `progress/recorrido_458-C/c458c-1.sql` al principio, tras cada escritura y al final | OK | **46 medidas, todas `diferencia_r7 = 0,00` y `diferencia_r8 = 0,00`**. Inicio: cifra 13.483.932,72 · ganancia 13.336.262,62 · De las tiendas 147.670,10 = Σ saldos 147.670,10 · capital 0. Final (`r7r8-final.json`): 13.463.932,72 · 13.346.262,62 · 117.670,10 = 117.670,10 · 0 |
| **Sin uuids ni códigos crudos** (texto, `aria-label`, `title`, `placeholder`) | OK | 7 pantallas × 2 roles + los paneles «Ver» + las 11 descargas: 0 uuid, 0 código (`barrido.json`); los uuid del árbol de accesibilidad están solo en `/url:` |
| **Asistente** — 4 preguntas | (se cuenta en su tabla) | 3 OK · 1 FALLO, ver abajo |
| **Accesibilidad** — teclado | OK | «Registrar un movimiento» abre con Intro, el foco entra, Escape lo devuelve al botón; «Ver» abre el panel con nombre («Cobro a una tienda anulado») y Escape devuelve el foco a su «Ver» |
| **Accesibilidad** — axe WCAG 2.1 A/AA del panel «Ver» | OK | 0 violaciones |
| **Accesibilidad** — contraste | FALLO (F3) | ver abajo |
| **Accesibilidad** — «Ayuda de esta pantalla» en los tres estados de cuenta | FALLO (F1) | ver abajo |

## Asistente — cuatro preguntas reales (R103)

| Rol / pantalla | Pregunta | Respuesta (literal, recortada) | Resultado |
| --- | --- | --- | --- |
| maestro · `/wallet` | Registré un sueldo por error. ¿Cómo lo anulo y qué pasa con la ganancia de Ordenex? | «Buscá la fila del sueldo y tocá Ver. Tocá Anular… y escribí el motivo (es obligatorio). […] Se registra automáticamente una Corrección de caja (suma) por el mismo monto […] La caja y la ganancia de Ordenex vuelven a subir en ese monto. […] Si al intentarlo te dice «Ya estaba anulado; no se registró nada más», es que alguien se te adelantó.» | OK |
| maestro · `/wallet/tiendas` | En el estado de cuenta de una tienda, ¿qué es el saldo corrido de cada fila y por qué la primera fila dice «Saldo inicial»? | «Cada fila trae […] el saldo de la tienda justo después de ese movimiento: es un saldo corrido […] La primera fila dice «Saldo inicial» porque […] es el saldo que la tienda tenía al terminar el día anterior al periodo […] saldo inicial más abonos del periodo menos cargos del periodo da el saldo final» | OK (preguntada desde el listado: en el estado de cuenta no hay «?», F1) |
| admin · `/wallet` | Veo «Cobros de gasto fijo por aprobar». ¿Los puedo aprobar yo? | «No lo sé con certeza qué acción específica tenés disponible ahí. […] No tengo el detalle de si ese panel pide una aprobación manual […] Te recomiendo […] preguntarle a alguien de la oficina» | **FALLO (F2)** |
| adminTienda · `/mi-wallet` | ¿Por qué una fila dice «Anulado por Ordenex» y cómo cambia eso mi saldo? | «Un movimiento anulado no desaparece de tu extracto: se queda en su lugar, pero tachado, con la leyenda «Anulado por Ordenex» […] Si Ordenex anuló un cobro que te había hecho, ves «Ordenex anuló un cobro y te lo devolvió» […] El número que ya tiene todo esto descontado y es el correcto es tu Saldo a favor.» | OK |

Ninguna respuesta nombra un identificador ni un código (`asistente.json`, `asistente-2.json`).

## Fallos

### F1 — Los tres estados de cuenta nuevos no tienen «Ayuda de esta pantalla» (y por tanto tampoco asistente)

`/wallet/tiendas/<tienda>`, `/wallet/mensajeros/<mensajero>` y `/wallet/satelites/<bodega>` (páginas de la 458-D)
pintan el encabezado sin el «?» (medido: 0 botones «Ayuda de esta pantalla» en las tres, 1 en cada listado;
`maestro-a11y-encabezado-*-sin-ayuda.png`). Causa: `components/shared/AyudaBoton.tsx:94`
(`const slug = pathname === null ? undefined : mapa[pathname];`) compara la ruta EXACTA con el `pantalla:` del
documento, y los documentos solo declaran los listados (`docs/ayuda/oficina/wallet-tiendas.md:4`,
`wallet-mensajeros.md:4`, `wallet-satelites.md:4`). El propio comentario del componente (líneas 22–24) afirma que
«ninguna [ruta] se queda sin «?»», que dejó de ser cierto con las tres rutas dinámicas. Como el «?» es la única
puerta al asistente, en el estado de cuenta —la pantalla donde más se va a preguntar por el saldo corrido— no se
puede preguntar nada.

### F2 — El asistente no sabe que el admin ve la cola de gastos fijos pero no la decide

La pantalla se comporta como pide el design (admin: 0 botones; maestro: «Aprobar · Rechazar»), pero la ayuda no
lo dice: `docs/ayuda/oficina/wallet-caja.md:200-202` solo cuenta que «Los que quedan pendientes de cobrar aparecen
en su propio panel», y el asistente contestó «No lo sé con certeza». Además el panel le dice al admin
«…esperan tu decisión.» (`app/(app)/wallet/_components/cobro-gasto-fijo-labels.ts:29`) cuando él no tiene cómo
decidir.

### F3 — Contraste: los enlaces en color de marca de las pantallas nuevas miden 2,99:1

axe (WCAG 1.4.3, «serious») sobre colores computados exactos: texto `rgb(242, 100, 25)` (`text-primary`,
`#f26419`) sobre `rgb(247, 248, 252)` = **2,99:1** a 14 px (necesita 4,5:1). En las páginas nuevas: el enlace
«Volver a los saldos por tienda / por mensajero / a las bodegas satélite»
(`app/(app)/wallet/tiendas/[tiendaId]/page.tsx:40`, `app/(app)/wallet/mensajeros/[mensajeroId]/page.tsx:39`,
`app/(app)/wallet/satelites/[zonaId]/page.tsx:36`) y los «Ver» de origen de 12 px del extracto
(`components/shared/estado-cuenta/EstadoCuenta.tsx:504`). También salen, pero son del sistema y no de la 458: el
botón primario blanco sobre `#f26419` (3,17:1: «Registrar un movimiento», «Registrar», «Aplicar»), el «Descargar»
de las tablas y la insignia «4 por hacer» del encabezado (2,46:1). `DESIGN.md:14` ya dice que el color base «NO sirve
para body text».

## Observaciones (no cuentan como fallo)

- **O1 — Origen con el nombre repetido.** «Cobro de Ordenex a una tienda · Tania Tienda · Tania Tienda · Cobro
  R458F-maestro material» (libro y «De dónde sale»): el origen añade la tienda (`lib/services/OrigenLegibleService.ts:218`)
  y la descripción guardada por la 461 ya empieza por ella. Igual en el gasto fijo: «Gasto fijo de Ordenex · R458F-
  Alquiler de bodega — 2026-09 · R458F- Alquiler de bodega — 2026-09» (`OrigenLegibleService.ts:130` une la
  descripción al origen y la columna la vuelve a pintar como motivo), y en `/mi-wallet` «A Facebook · Pauta … ·
  Efectivo · Pago de un gasto de una tienda · Tania Tienda · a Facebook».
- **O2 — La categoría del libro se aplica con «Aplicar»; «Entra/Sale» y «A quién» al elegir.** Medido: tras elegir
  «Sueldo (2)» las tarjetas siguen en 54 movimientos hasta pulsar «Aplicar» (`WalletFiltros.tsx`, borrador).
- **O3 — Selector de cierre del mensajero:** dos cierres del mismo día se distinguen solo por la cuenta («Cierre
  del 2026-08-13 · Marco Mensajero · 3 movimientos» / «· 9 movimientos»); la hora se añade solo cuando el rótulo
  entero se repite (`mi-wallet-cierres.ts`, regla 2). Es la regla escrita, no un error.
- **O4 — «Descargar» de «Pagos registrados» con la tabla vacía** está habilitado y no hace nada (sin archivo ni
  aviso). Es del componente compartido `PagosRegistradosTabla`, no de la 458.
- **O5 — `<dl role="group">`** en «Cómo se compone la ganancia» (`app/(app)/wallet/_components/ComposicionGananciaCard.tsx:179-180`):
  axe «dlitem» (los `dt/dd` pierden su `dl`). Es de la 461.
- **O6 — Panel del cobro en el estado de cuenta de la tienda** dice «Ordenex le cobra a la tienda … · Sale ₡200.000»
  (lado de la tienda) mientras que en el libro de la caja la misma escritura se lee «Entra ₡5.000»; y ahí «Registró»
  no lleva la hora que sí lleva en la caja.
- La primera corrida del gasto fijo quedó en la consola y está transcrita en `gasto-fijo.json` (la segunda, que solo
  anuló, sobrescribió su archivo antes de renombrarlo a `gasto-fijo-anular.json`).
- El aviso ajeno «Confirmá el SINPE de GAM» se cerró con «Ahora no» cuando apareció.

## Lo que quedó escrito en el clon

Todo con `R458F-`: por rol, un sueldo, un gasto, una corrección (suma) y un cobro anulados (dos veces el sueldo y el
gasto del maestro por una corrida repetida), un cobro por rechazo aprobado y anulado, una indemnización aprobada y
anulada, dos cobros de 5.000 y dos pagos de un gasto de 10.000 vigentes, dos cobros de 200.000 anulados, dos pagos al
mensajero anulados, dos marcas de recibido en Quepos y el gasto fijo aprobado y anulado. El clon se borró al terminar.
