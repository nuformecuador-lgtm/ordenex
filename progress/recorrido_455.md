# Recorrido en navegador — feature 455 (T3.2), 2026-09-24

- **Código recorrido:** `fd5b64de` (rama `feature/455-recorrido`, sin cambios de app).
- **Base:** clon local `ordenex_455` en `localhost:5432` (`prisma migrate status`: 212 migraciones, «up to date»).
- **Servidor:** UN solo `next dev -p 3455`, salida a archivo; OTP leído del log.
- **Herramienta:** Playwright (`@playwright/test` por `createRequire`) + `innerText` de cada pantalla,
  con regex de palabra completa para los nombres de §0.3 y los códigos (anteriores y vigentes).
  Mensajero en viewport móvil 390×844 con geolocalización concedida.
- **Evidencia:** `progress/recorrido_455/` (`<rol>_<pantalla>.txt` = innerText citado, `.png` = captura,
  `.xlsx` = descargas, `api_*.json` = respuestas de la API con la key y los tokens firmados redactados,
  `webhooks_encolados_cuerpos.json` = cuerpos de 40 webhooks encolados).

## Escrituras hechas en `ordenex_455` (solo el clon local)

- **Contraseñas QA rotadas**: `seed-usuarios-qa.ts` (las 4 cuentas QA) y `db:seed:maestro` sobre
  `maestro.qa@ordenex.test`. El valor NO se versiona; se le pasó al coordinador por chat.
- Plantilla de WhatsApp de tienda `recorrido_455_estatus` (cuerpo con `{{estatus}}`).
- API keys «Recorrido 455» (×2, la primera perdida sin usar) y «Recorrido 455 c», todas con tienda destino Tania.
- Vista guardada del maestro «Recorrido 455 novedad interna» en `/ordenes`.
- Guía `97865841` (QA-R-0017) recogida por el mensajero: pasó de «Mensajero recogiendo en la bodega» a «En reparto».
  Se abrió la pantalla de gestión, pero no se registró ninguna gestión.
- Los webhooks encolados se construyeron con el servicio real, un emisor falso que no manda nada y un repositorio de solo lectura,
  mediante un script temporal que ya se borró. No se envió nada ni cambió ningún contador.

## Tabla superficie × rol

M = maestro · A = admin · T = adminTienda · S = adminSatelite · X = mensajero (móvil) · P = rastreo público · K = API key.
«—» = el rol no tiene esa superficie o no se recorrió.

| # | Superficie | M | A | T | S | X | P | K |
|---|---|---|---|---|---|---|---|---|
| 1 | `/ordenes`: chip, filtro de estado (20 opciones; T 16 por `EXCLUDE_POR_ROL`), vista guardada | OK | OK | OK | — | — | — | — |
| 2 | `/ordenes`: cabecera de columnas | FALLO F1 | FALLO F1 | FALLO F1 | — | — | — | — |
| 3 | Descarga xlsx (columna «Estado» leída del archivo; no hay CSV) | OK | OK | OK | OK (en bodega) | — | — | — |
| 4 | Historial de la orden (línea de tiempo, retirados, pendiente) | FALLO F10 | OK | OK | — | — | — | — |
| 5 | `/monitoreo` (contadores y buckets) | FALLO F2 | FALLO F2 | — | OK (sin datos) | — | — | — |
| 6 | Satélite: por recibir, en bodega, filtro, URL vieja `estado=por_devolver`, escáner | — | — | — | OK | — | — | — |
| 7 | Escáner de recepción central (mensaje con estado) | — | OK | — | — | — | — | — |
| 8 | Cierres: detalle y origen de las novedades internas | FALLO F3 | — | — | FALLO F3 | — | — | — |
| 9 | Cierres: pestañas de resultado y descarga xlsx | OK | — | — | — | — | — | — |
| 10 | `/cierre-dia` del mensajero | — | — | — | — | FALLO F3 | — | — |
| 11 | `/incidentes` | OK (vacío) | OK (vacío) | — | — | — | — | — |
| 12 | `/novedades`, pestaña «Novedad» (tarjetas, detalle, xlsx) | — | — | OK | — | — | — | — |
| 13 | `/novedades`: pestaña «Rechazadas por plazo vencido» y modal «Rechazar» | — | — | FALLO F4 | — | — | — | — |
| 14 | WhatsApp `{{estatus}}`: vista previa en plantillas y mensaje real | OK | — | OK | — | — | — | — |
| 15 | Analítica: los dos donuts | OK | OK | OK | — | — | — | — |
| 16 | Analítica: KPIs y títulos | FALLO F5 | FALLO F5 | FALLO F5 | — | — | — | — |
| 17 | `/ranking` | FALLO F6 | FALLO F6 | — | — | — | — | — |
| 18 | «Recoger en bodega» (menú, chips, detalle) | — | — | — | — | OK | — | — |
| 19 | Tarjeta del reparto (chip «En reparto» + marca aparte «Abierta en detalle») | — | — | — | — | OK | — | — |
| 20 | Chat del mensajero | — | — | — | — | FALLO F7 | — | — |
| 21 | Recolección | — | — | — | — | FALLO F8 | — | — |
| 22 | Pantalla de gestión (acciones en verbo) | — | — | — | — | OK | — | — |
| 23 | Rastreo público: 17 guías (una por tramo, 4 pendientes y 2 con retirados) | — | — | — | — | — | FALLO F9 | — |
| 24 | API: listado, filtro vigente→200, filtro viejo→422, detalle con `gestiones[]` | — | — | — | — | — | — | OK |
| 25 | Webhook encolado (`orden.estado_actualizado` y `orden.gestion_registrada`) | — | — | — | — | — | — | OK |
| 26 | `/ayuda` (docs del rol) | OK | — | FALLO F11 | OK | FALLO F11 | — | — |
| 27 | Asistente (SF-001) | OK | — | OK | — | FALLO F11 | — | — |
| 28 | Notificaciones | OK (obs. O2) | — | OK (obs. O2) | — | OK | — | — |

**Resultado: 33 OK de 54 celdas y 21 FALLO, agrupados en 11 hallazgos (F1–F11).**
Todas las celdas en FALLO se deben a una etiqueta de grupo o a un texto fijo. En **ningún chip, celda, filtro,
descarga, API ni webhook apareció un código crudo ni un nombre de estado viejo**. Tampoco apareció ningún «B.».

## Qué se verificó y dio bien (con el texto citado)

- **Filtro de estado** (M/A): 20 opciones, todas con el nombre definitivo, entre ellas «Mensajero recogiendo en la bodega»,
  «Devolución a origen por rechazo», «Novedad interna» y «Por devolver a bodega central»
  (`maestro_ordenes_filtro_estado_opciones.txt`). Vista guardada → «Estado: Novedad interna».
- **xlsx de órdenes**: la columna «Estado» contiene solo nombres del §0.1, por ejemplo `{"Entregado":18,"Por devolver a bodega central":1,
  "Novedad interna":5,"Mensajero recogiendo en la bodega":6,…}` (`maestro_ordenes_completa_*.xlsx`).
- **Historial**: los retirados se muestran como «Devolución por confirmar (estado retirado)», «Ayuda solicitada a la tienda
  (estado retirado)» y «En fulfillment (estado retirado)» (R11). La pendiente, como «Novedad · pendiente de confirmación».
- **Satélite**: la URL vieja `/recepcion-satelite/en-bodega?estado=por_devolver` muestra el chip «Estado: Por devolver a bodega central».
- **Escáner central (A)**: «No se puede recibir: la orden está en "Entregado".», «… "Devolviendo a tienda".»
  y «… "En reparto".».
- **WhatsApp**: «Hola Cliente Recorrido 9, tu envio 44203146 esta: Novedad.» (`tienda_novedades_whatsapp_con_plantilla.txt`).
- **Tarjeta del mensajero**: chip «En reparto» y la marca «Abierta en detalle» por separado (R8). En el chat, el chip muestra el estado real
  («Mensajero recogiendo en la bodega», «En reparto»). No hay «Asignada», «En gestión», «En ayuda» ni «Por recolectar» como estado.
- **Rastreo público**: nombres reales en cada tramo y la señal en su formato, por ejemplo «Devolución a origen por rechazo · pendiente
  de confirmación», «Novedad · pendiente de confirmación» y «Reprogramado · pendiente de confirmación». El retirado
  `ayuda_tienda` no aparece (se pliega).
- **API**: `?estado=entregado` → 200, con `"estado":"entregado","estadoNombre":"Entregado"`. `?estado=entregada` → **422** con
  «'entregada' ya no existe: ahora se llama 'entregado' («Entregado»). Ver docs/api/CHANGELOG.md.».
  `?estado=por_recoger` → 422 y nombra «mensajero_recogiendo_en_bodega». Los 14 pares `estado => estadoNombre` del listado son correctos.
  El detalle trae `gestiones[].resultado` + `resultadoNombre` + `pendienteConfirmacion`.
- **Webhook**: 40 cuerpos construidos. `data` = `numGuia,numRemision,estado,estadoNombre,motivo,mensajero`, con `estadoNombre` justo después de
  `estado`. En `gestion_registrada`, `resultado => resultadoNombre` es correcto para los 5 resultados. No queda ningún código anterior.

## FALLOS

Cada uno lleva su ruta, el rol, el texto citado, la evidencia y los pasos para reproducirlo.

- **F1 — `/ordenes` (M, A, T): la cabecera de columna «Reprogramada para» usa el nombre retirado «Reprogramada».**
  Texto: `… Fecha de creación	Tiempo	Reprogramada para	Acciones`. La descarga llama a esa misma columna
  «Fecha de reprogramación», así que la tabla y el archivo no coinciden. Evidencia: `maestro_ordenes.txt`, `admin_ordenes.txt`,
  `tienda_ordenes.txt`. Pasos: entrar a `/ordenes` con cualquier rol de oficina o de tienda.
- **F2 — `/monitoreo` (M, A): el contador del día se llama «Asignadas», un nombre retirado de §0.3 usado como etiqueta (R6).**
  Texto: `Totales del día 16 Asignadas RESULTADOS DEL DÍA Entregado 6 …`, y también en cada tarjeta de mensajero
  (`Rita Recorrido 14 Asignadas`). Evidencia: `maestro_monitoreo.txt/.png`, `admin_monitoreo.txt`. Pasos: `/monitoreo`.
- **F3 — Cierres (M `/cierres-admin`, S `/cierres-admin`, X `/cierre-dia`): el apartado de las futuras novedades internas se
  titula «Órdenes sin gestionar», con el nombre retirado «Sin gestionar».**
  Texto: `ÓRDENES SIN GESTIONAR 3 El corte del día las cerró sin gestión. No tienen dinero asociado.` y la lista muestra
  `· En reparto`. En cierres antiguos: «Este cierre es anterior al registro de órdenes sin gestionar». En el mensajero:
  «Tenes ordenes sin gestionar; gestionalas antes de cerrar.», que además escribe «ordenes» sin tilde. Evidencia:
  `maestro_cierres_admin_decidir.txt`, `satelite_cierre_ver_mensajero_test.txt`, `mensajero_cierre_dia.txt`,
  `mensajero_cierre_dia_ver.txt`. Pasos: `/cierres-admin` → «Ver / decidir» (M), o «Ver el cierre de Mensajero test» (S);
  mensajero → `/cierre-dia`.
- **F4 — `/novedades` (T): la pestaña se llama «Rechazadas por plazo vencido» y el modal «Rechazar» dice «la orden se cierra como
  rechazada».** Son nombres retirados en una pestaña (R6) y en un mensaje (R2). El vacío de la pestaña dice además «Cuando una de tus
  órdenes en devolución llegue a rechazo…», con «En devolución», también retirado. Evidencia: `tienda_novedades_tab_rechazadas_plazo.txt`,
  `tienda_novedades_modal_rechazar.txt`. Pasos: `/novedades` → pestaña 3; o pestaña «Novedad» → «Rechazar la orden de Cliente Recorrido 9».
- **F5 — Analítica (M, A, T): los KPIs usan nombres retirados y títulos sin tilde.** Textos: «35,3% de las 51 órdenes con desenlace terminaron
  entregadas», «Efectividad de la gestión (entregadas y rechazadas de 85 órdenes)», «Detalle - Movimiento de las ordenes» y
  «Detalle de las ordenes · 85» (título del segundo donut, **sin tilde**). Los nombres dentro de los dos donuts están bien.
  Evidencia: `maestro_analitica.txt/.png`, `admin_analitica.txt`, `tienda_analitica.txt`. Pasos: `/analitica`.
- **F6 — `/ranking` (M, A): la columna y el subtítulo dicen «Entregadas / asignadas».** Texto: «Efectividad · entregadas / asignadas · hoy»
  y la cabecera «Entregadas / asignadas». Evidencia: `maestro_ranking.txt`, `admin_ranking.txt`. Pasos: `/ranking`.
- **F7 — Chat del mensajero (X): la cabecera de la lista dice «4 asignadas».** Los chips están bien. Evidencia: `mensajero_chat_lista.txt`.
  Pasos: `/mis-asignaciones/reparto` → «Abrir chat con clientes» teniendo órdenes para recoger.
- **F8 — `/recoleccion` (X): el apartado se llama «Recolectadas hoy», con el nombre retirado «Recolectada» (R6).** Evidencia:
  `mensajero_recoleccion.txt`. Pasos: mensajero → Recolección.
- **F9 — Rastreo público, guía `990012` (factor `0005`): el mismo evento sale dos veces y fuera de orden, y React avisa de una clave duplicada.**
  La línea queda así: `… Novedad 2026-08-20 · 17:48 · En reparto 2026-09-23 · 20:14 · Novedad · pendiente de confirmación 2026-08-20 · 17:48`.
  El tramo retirado `devolucion_por_confirmar` se pliega a «Novedad» (R34), y la gestión pendiente de ese mismo
  momento añade «Novedad · pendiente de confirmación». Resultado: el destinatario ve una Novedad que parece definitiva y la misma como pendiente,
  y la última entrada tiene fecha anterior a la penúltima. En dev: «Encountered two children with the same key,
  `Novedad-2026-08-20T17:48-06:00`» (`app/_landing/RastreoDialog.tsx:297`). Evidencia:
  `publico_rastreo_990012_retirado_dev_por_confirmar_en_historial.txt/.png`. Pasos: landing → «Rastrear envío» → guía 990012, dígitos 0005.
  (No es un problema de nombres. Lo produce el cruce R33×R34 en órdenes que tenían `devolucion_por_confirmar` con la gestión aún
  sin confirmar.)
- **F10 — Historial de la orden (M): el motivo de las filas de migración muestra el código crudo.** Textos: «Motivo: migracion 454:
  retiro de devolucion_por_confirmar» y «Motivo: migracion 155: retiro de en_fulfillment» (R3). Es texto guardado por las
  migraciones, no generado por la pantalla. Evidencia: `maestro_historial_QA-R-0012_retirado_dev_por_confirmar.txt`,
  `maestro_historial_111117_novedad_interna.txt`. Pasos: `/ordenes` → buscar QA-R-0012 → «Ver historial».
- **F11 — `/ayuda` y asistente (T, X): la documentación repite las etiquetas de F3, F4, F6, F7 y F8, y el asistente del mensajero las repite
  a su vez.** `docs/ayuda/mensajero/recoleccion.md:30` «## Recolectadas hoy»; `mensajero/reparto.md:60-61` «Asignadas, todavía en
  bodega…»; `tienda/novedades.md:30` «**Rechazadas por plazo vencido.**»; `mensajero/cierre-del-dia.md:55` «## Órdenes que quedaron
  sin gestionar»; `mensajero/ranking.md:17,22,28` «entregadas / asignadas». Asistente (X): «las órdenes que te quedan sin
  gestionar al momento de pedir el cierre…» (`mensajero_asistente_respuesta_resultados.txt`). Pasos: preguntarle al asistente en
  Reparto «¿Qué resultados puedo registrar…?». Si se corrigen las pantallas, la ayuda tiene que cambiar a la vez: la
  guardia G2 no detecta estas etiquetas.

## Observaciones que no son fallo de la 455

- **O1 — Rastreo de la guía `53521827`**: la cabecera dice «En bodega central» y en `/ordenes` el estado es «En bodega satélite». La orden llegó a satélite
  sin fila en `orden_historial_estado` (dato sembrado), y el rastreo toma la cabecera de la línea. No es un problema de nombres.
- **O2 — Notificaciones (M, T)**: las filas ya emitidas dicen «Una orden fue rechazada por el destinatario.». Es texto guardado. El
  código vigente emite «Devolución a origen por rechazo: el destinatario rechazó una orden.» (`lib/notificaciones/emitir.ts:63`)
  y no reescribe las anteriores (decisión del diseño). En producción, el historial de avisos seguirá mostrando la frase vieja.
- **O3 — Filtro de estado de la tienda**: no ofrece «Novedad», porque `EXCLUDE_POR_ROL` excluía `devuelta` y ahora excluye `novedad`. Sus órdenes sí
  aparecen como «Novedad» en el chip y en el xlsx. Es una decisión previa a la 455; la tienda las gestiona en `/novedades`.
- **O4 — URL de evidencias en la API**: el nombre del archivo guardado lleva el código viejo (`…/rechazada-1790233015333-0.jpg`). Es la ruta
  histórica en Storage y no es texto de la interfaz.
- **O5 — «Sara Satelite»** (sin tilde) es el nombre de la cuenta QA, no un texto de la app.
