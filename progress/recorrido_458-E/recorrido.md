# 458-E — Recorrido del libro de caja (design §10, pasos que tocan `/wallet`) · 2026-09-26

Playwright ad hoc (`@playwright/test`, script fuera del árbol) contra UN dev server (`next dev -p 3471`,
`.next` borrado antes, apagado al terminar) sobre la base propia `ordenex_458e` (clon de `ordenex`).
Usuarios `maestro.qa`, `admin.qa`, `tienda.qa`, con las claves QA rotadas SOLO en el clon. Salida cruda:
`maestro.json`, `admin.json`, `tienda.json`. Sobre `c36b2efc` (458-E + la revisión de la 458-C);
`maestro-09` sobre `e35d3c01`.

| Rol | Paso | Resultado | Números |
| --- | --- | --- | --- |
| maestro | E.1 columnas | OK | `Desglose · Fecha · Movimiento y motivo · A quién · Monto · Registró · Ver` (`maestro-01-libro.png`) |
| maestro | E.1 «A quién» / «Registró» | OK | cierre: «Quino QUEPOS» (enlace, nombre accesible «Quino QUEPOS · estado de cuenta del mensajero», `href /wallet/mensajeros/<uuid>`) · «Automático · Aprobación del cierre por Sat QUEPOS»; sueldo nuevo: «Pedro Recorrido maestro» · «Maestro QA» |
| maestro | E.1 sin ids | OK | uuid en el texto de la tabla: no; en `aria-label`: no (solo en `href`) |
| maestro | 1 tarjetas | OK | «Flujo de dinero registrado ₡13.483.932,72» · Entró 13.524.733,22 · Salió 40.800,50 · 36 movimientos = la SQL (cifra 13.483.932,72, entró 13.524.733,22, salió 40.800,50) |
| maestro | E.2 «Entra» | OK | `aria-pressed=true`; 29 movimientos (1-20 de 29), todas las filas «Entra»; tarjeta «Movimiento neto del periodo ₡13.524.733,22», Salió ₡0 |
| maestro | E.2 «Sale» | OK | 7 movimientos, todas «Sale»; «Movimiento neto del periodo -₡40.800,50», Entró ₡0 |
| maestro | E.2 «Todo» | OK | 36 de nuevo; «Flujo de dinero registrado ₡13.483.932,72» |
| maestro | 1 concepto con cuenta | OK | «Flete cobrado a la tienda (5)», «Corrección de caja (suma) (2)», «Ordenex le paga a un mensajero (4)»…; con «Entra» solo los de entrada (8 conceptos); «Otro gasto de Ordenex» no aparece |
| maestro | E.2 periodo (hoy CR) | OK | 0 movimientos, tarjeta «Movimiento neto del periodo En cero ₡0» |
| maestro | 2/3 registrar sueldo 12.345 a «Pedro Recorrido maestro» | OK | fila nueva arriba SIN recargar: «Sueldo · Sueldo recorrido 458-E (maestro)» · «Pedro Recorrido maestro» · «Sale ₡12.345 Ordenex» · «Maestro QA»; tarjeta 13.483.932,72 → 13.471.587,72 |
| maestro | 3 «Ver» | OK | panel: A quién, Por qué, De dónde sale, Cómo «—», Comprobante, Registró «Maestro QA», Estado «Vigente», «Cómo quedó» ₡13.471.587,72 / ganancia ₡13.323.917,62 |
| maestro | 3 «Anular…» | OK | sin recargar: contra-asiento «Corrección de caja (suma) · Anulación de: Sueldo recorrido 458-E (maestro)» ₡12.345 arriba; el original tachado con la insignia «Anulado» (no tachada, `maestro-09`) ; tarjeta de vuelta a ₡13.483.932,72 |
| maestro | 3 panel del anulado (pendiente de la 458-C) | OK | «Estado Anulado el 2026-09-26 por Maestro QA · Recorrido 458-E (maestro): registrado para probar»; 0 botones «Anular…» |
| maestro | 9 descarga | OK | `libro-de-movimientos-2026-09-26.xlsx`; cabecera `Fecha · Movimiento · Motivo y origen · A quién · Entra o sale · Monto · Dueño · Registró`; 38 filas; uuid en celdas o nombre: **no**; monto «12345.00» (texto del servidor) |
| admin | los mismos pasos | OK | 38 movimientos; «Entra» 30, «Sale» 8; sueldo 11.111 «Pedro Recorrido admin» · «Ana Admin»; anulado «Anulado el 2026-09-26 por Ana Admin · …»; descarga 40 filas sin uuid |
| adminTienda | `/wallet`, `/wallet/tiendas` | OK | HTTP 404 y 404 («No encontramos esta página»), 0 tablas del libro |

## R7 / R8 — `progress/recorrido_458-C/c458c-1.sql` (solo lectura, contra el clon)

| Momento | cifra | ganancia | De las tiendas | Σ saldos | R8 | R7 |
| --- | --- | --- | --- | --- | --- | --- |
| antes (maestro) | 13.483.932,72 | 13.336.262,62 | 147.670,10 | 147.670,10 | 0,00 | 0,00 |
| tras registrar el sueldo (maestro) | 13.471.587,72 | 13.323.917,62 | 147.670,10 | 147.670,10 | 0,00 | 0,00 |
| tras anularlo (maestro) | 13.483.932,72 | 13.336.262,62 | 147.670,10 | 147.670,10 | 0,00 | 0,00 |
| tras registrar (admin) | 13.472.821,72 | 13.325.151,62 | 147.670,10 | 147.670,10 | 0,00 | 0,00 |
| tras anular (admin) | 13.483.932,72 | 13.336.262,62 | 147.670,10 | 147.670,10 | 0,00 | 0,00 |

Seis medidas, todas `0,00`. «Entró» sube 12.345 / 11.111 al anular (bruto, como desde la 45).

## Hallazgo del recorrido, arreglado

La insignia «Anulado» que la revisión de la 458-C puso en la celda de «Ver» salía TACHADA (la celda era
`flex` y hereda el tachado de la fila). Pasa a `inline-flex` (`e35d3c01`): medido
`text-decoration-line: none` en la insignia y fila con `line-through` (`maestro-09-fila-anulada-insignia.png`).

## Notas

- «Movimiento y motivo» del sueldo dice «Sueldo» dos veces («Sueldo» concepto + «Sueldo · <motivo>» origen de la 458-A): es la composición del design, no un error; se anota por si se quiere acortar.
- El contra-asiento de un sueldo dice «A quién: —» (no lleva anotación): es lo que fija design §3.4.
- El botón de cerrar del panel (`Sheet` de shadcn) se anuncia «Close» en inglés: ajeno a la 458-E.
- Un aviso ajeno («Confirmá el SINPE de GAM») se abre al entrar a `/wallet` con el maestro; el script lo cierra con «Ahora no».
- El cobro por rechazo anulado (TE.4) no se re-midió en vivo: lo midió la 458-C (paso 7) y aquí lo cubre `WalletLibroCaja458E.test.tsx` (T E.4) + `wallet-anulacion-458.test.ts` (R73, contra Postgres).


---

# Cierre de la pantalla — filtro «A quién» (R59), «Cerrar» y el panel sin relectura · 2026-09-26

Playwright ad hoc (fuera del árbol) contra UN dev server (`next dev -p 3487`, apagado al terminar) sobre
la base propia `ordenex_458ec` (`CREATE DATABASE … TEMPLATE ordenex`, `migrate deploy` sin pendientes),
sobre `6c773e73`. Claves QA rotadas SOLO en el clon (`seed-usuarios-qa` + `seed-maestro` con
`maestro.qa`). Salida cruda: `maestro-aquien.json`, `admin-aquien.json`, `asistente.json`.

El clon no tenía ninguna fila de la caja atribuida a una tienda ni ningún nombre anotado a mano, así que
cada rol registró POR LA UI un sueldo con «a quién» libre, un cobro a «Tania Tienda» y un pago de un
gasto de «Tania Tienda» (a «Imprenta Recorrido», efectivo).

**Oráculo independiente del filtro:** el libro SIN filtro descargado entero, quedándose con las filas
cuya columna «A quién» (la otra lectura, `autoriaDelLibroCajaAction`) es ese nombre; contra él, el libro
CON filtro descargado entero y las tarjetas pintadas. «Entró»/«Salió» de la tarjeta = Σ de las filas
de efectivo (sin los cargos a una tienda, que no son dinero nuevo: `LIQUIDEZ_MOVIMIENTO`).

| Rol | Filtro (cómo se eligió) | Filas filtro / oráculo | Entra · Sale del libro | Tarjeta: Movimientos · Entró · Salió | Coinciden |
| --- | --- | --- | --- | --- | --- |
| maestro | Tienda «Tania Tienda» (buscando «tania» → 1 opción) | 2 / 2 | 1.500,00 (cargo) · 2.345,67 | 2 · ₡0 · ₡2.345,67 | sí (5/5) |
| maestro | Mensajero «Marco Mensajero» | 19 / 19 | 179.287,21 (152.900,00 efectivo) · 27.800,00 | 19 · ₡152.900 · ₡27.800 | sí (5/5) |
| maestro | Nombre anotado «Proveedora Ñandú Recorrido» (buscando «provee») | 2 / 2 | 0,00 · 15.555,40 | 2 · ₡0 · ₡15.555,40 | sí (5/5) |
| admin | Tienda «Tania Tienda» | 4 / 4 | 2.400,50 (cargo) · 3.456,78 | 4 · ₡0 · ₡3.456,78 | sí (5/5) |
| admin | Mensajero «Marco Mensajero» | 19 / 19 | 179.287,21 · 27.800,00 | 19 · ₡152.900 · ₡27.800 | sí (5/5) |
| admin | Nombre anotado «Transportes Solano Recorrido» | 1 / 1 | 0,00 · 4.321,09 | 1 · ₡0 · ₡4.321,09 | sí (5/5) |

- Opciones del selector: maestro 5 + «Todos» («Marco Mensajero · Mensajero · 19 movimientos», «Proveedora
  Ñandú Recorrido · Nombre anotado · 2 movimientos», «Quino QUEPOS · Mensajero · 7 movimientos», «Rita
  Recorrido · Mensajero · 7 movimientos», «Tania Tienda · Tienda · 2 movimientos»); admin 6 + «Todos».
  Ningún uuid en las opciones, en los `aria-label` ni en las dos descargas. El disparador dice lo elegido
  («A quién: Tania Tienda · Tienda · 2 movimientos»); con filtro la cifra grande pasa a «Movimiento neto
  del periodo». «Todos» devuelve las tarjetas EXACTAS de antes de filtrar (40 / 43 movimientos).
- El panel «Ver»: botones `Anular…`, `Cerrar` (antes «Close»); «Cerrar» lo cierra (0 diálogos).
- Capturas: `<rol>-aquien-01-opciones.png`, `-02-busqueda-tienda.png`, `-{tienda,mensajero,nombre}-{libro,tarjetas}.png`.

## R7 / R8 — `progress/recorrido_458-C/c458c-1.sql` (solo lectura, contra el clon)

| Momento | cifra | ganancia | De las tiendas | Σ saldos | R8 | R7 |
| --- | --- | --- | --- | --- | --- | --- |
| antes de todo (primera pasada del maestro) | 13.483.932,72 | 13.336.262,62 | 147.670,10 | 147.670,10 | 0,00 | 0,00 |
| tras su sueldo con nombre = antes de la segunda pasada | 13.476.155,02 | 13.328.484,92 | 147.670,10 | 147.670,10 | 0,00 | 0,00 |
| tras el sueldo con nombre (maestro) | 13.468.377,32 | 13.320.707,22 | 147.670,10 | 147.670,10 | 0,00 | 0,00 |
| tras el cobro y el pago de Tania (maestro) | 13.466.031,65 | 13.322.207,22 | 143.824,43 | 143.824,43 | 0,00 | 0,00 |
| tras filtrar (maestro, sin escribir) | 13.466.031,65 | 13.322.207,22 | 143.824,43 | 143.824,43 | 0,00 | 0,00 |
| tras el sueldo con nombre (admin) | 13.461.710,56 | 13.317.886,13 | 143.824,43 | 143.824,43 | 0,00 | 0,00 |
| tras el cobro y el pago de Tania (admin) | 13.460.599,45 | 13.318.786,63 | 141.812,82 | 141.812,82 | 0,00 | 0,00 |
| tras filtrar (admin) | 13.460.599,45 | 13.318.786,63 | 141.812,82 | 141.812,82 | 0,00 | 0,00 |

Todas `0,00`. (La primera pasada del maestro no encontró ninguna tienda en el selector; se le añadió
registrar lo de la tienda y se repitió entera: por eso el maestro tiene dos sueldos «Proveedora Ñandú».)

## Asistente — cuatro preguntas reales en local (R103), sobre la ayuda nueva

| Rol / pantalla | Pregunta | Respuesta (resumen literal) |
| --- | --- | --- |
| maestro · `/wallet` | ¿Cómo veo solo los movimientos de una tienda en el libro de la caja? ¿Las tarjetas de arriba cambian? | «en la barra de filtros arriba del libro, usá A quién: elegís de la lista (podés buscar por el nombre de la tienda) y se aplica al elegirlo. Y sí, las tarjetas cambian […] la cifra grande […] pasa a "Movimiento neto del periodo" […] Lo mismo pasa con la composición de la ganancia y el desglose de egresos» |
| maestro · `/wallet` | ¿Qué significa la columna «Registró» cuando dice «Automático»? | «ese movimiento no lo tecleó nadie a mano […] te dice además qué lo produjo: «Automático · Aprobación del cierre por Ana», «Automático · Plantilla de gasto fijo»» |
| admin · `/wallet` | Le pagué un sueldo a Juan Pérez, ¿cómo encuentro ese pago en el libro? | «En Concepto, elegí Sueldo […] En A quién, buscá por el nombre que se anotó al registrar el pago […] Tocando Ver en esa fila vas a ver el detalle completo» |
| admin · `/wallet` | ¿Cómo sé si un movimiento del libro está anulado, y quién lo anuló? | «una fila anulada aparece tachada y dice Anulado al lado del botón Ver. Para saber quién la anuló y por qué, tocá Ver […] el día en que se anuló, quién lo anuló, el motivo que escribió y cómo se anuló» |

Las cuatro citan «Wallet · Caja»; ninguna nombra un identificador. Capturas `<rol>-asistente-e<n>.png`.
