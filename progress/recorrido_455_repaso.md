# Repaso en navegador — feature 455 (T3.2, pantallas de F1–F11), 2026-09-24

- **Código:** `feature/455-final` = `7faebeff` + `origin/review/455` + `8ab6baae` (m9, contraste-454, m8).
- **Base:** clon local `ordenex_455` en `localhost:5432` (`prisma migrate status`: 212 migraciones, «up to date»).
  No se escribió nada en la base durante el repaso (sin seeds, sin rotar contraseñas: `QA_PASSWORD` ya era la del
  recorrido). El modal «Confirmá el SINPE de GAM» (SF-001) se cerró con «Ahora no», sin confirmar.
- **Servidor:** UN solo `next dev -p 3455`, salida a archivo. Al terminar se mató (`taskkill /T`) y se borró `.next/dev`.
  El log del servidor NO se versiona (lleva códigos OTP).
- **Herramienta:** Playwright (`@playwright/test` por `createRequire`), un script en el scratchpad. `innerText` de cada
  pantalla o diálogo en `progress/recorrido_455_repaso/<rol>_<pantalla>.txt` (+ `.png`). Mensajero en 390×844 con
  geolocalización concedida. El registro de la corrida está en `_registro.txt`: **0 `console.error`** en todas las
  pantallas (en particular, ya no sale el aviso de React de clave duplicada del rastreo).
- **Búsqueda:** `_escaneo.txt` — regex de palabra completa con límites Unicode (`(?<![\p{L}\p{N}_])…(?![\p{L}\p{N}_])`)
  para cada nombre de §0.3 (con las excepciones vigentes: «Devuelta a tienda», «Por devolver a …», «Por recolectar
  en tienda», «… (estado retirado)»), primero exacta y después sin distinguir mayúsculas; y cualquier código con
  guion bajo (`[a-z]+(_[a-z]+)+`). **50 archivos: 3 exactos, 7 en minúscula, 0 códigos crudos.** Clasificación abajo.

## F1–F11: antes → ahora

| F | Pantalla (rol) | Antes (recorrido_455.md) | Ahora (texto citado) | Evidencia | Estado |
|---|---|---|---|---|---|
| F1 | `/ordenes` (A) | «Reprogramada para» | cabecera `… Tiempo	Reprogramado para	Acciones` | `admin_ordenes.txt` | OK |
| F2 | `/monitoreo` (A) | «16 Asignadas» | «Totales del día 16 Asignados» | `admin_monitoreo.txt` | OK |
| F3 | `/cierres-admin` → «Ver / decidir» (A) | «ÓRDENES SIN GESTIONAR» | «PASARON A NOVEDAD INTERNA 3 · El corte del día las cerró sin gestión.» | `admin_cierres_admin_decidir.txt` | OK |
| F3 | cierre del mensajero (S) | ídem | «PASARON A NOVEDAD INTERNA» | `satelite_cierre_ver.txt` | OK |
| F3 | `/cierre-dia` (X) | «Tenes ordenes sin gestionar; gestionalas antes de cerrar.» | «Tenés paquetes en reparto que todavía no gestionaste; gestionalos antes de cerrar.» | `mensajero_cierre_dia.txt` | OK |
| F4 | `/novedades` (T), pestañas | «Rechazadas por plazo vencido» | pestañas «Ayuda solicitada · Novedad · Devolución a origen por plazo vencido»; vacío: «No tenés órdenes con devolución a origen por plazo vencido · Cuando una de tus órdenes en Novedad pase a Devolución a origen por rechazo por vencerse el plazo, aparecerá acá.» | `tienda_novedades_tab_1..3.txt` | OK |
| F4 | modal «Rechazar» (T) | «la orden se cierra como rechazada» | «… vuelve a tu bodega y la orden pasa a Devolución a origen por rechazo.» | `tienda_novedades_modal_rechazar.txt` | OK |
| F5 | `/analitica` (A) | «terminaron entregadas», «(entregadas y rechazadas de …)», «ordenes» sin tilde | «35,3% de las 51 órdenes con desenlace terminaron en Entregado», «Efectividad de la gestión (Entregado y Devolución a origen por rechazo de 85 órdenes)», «Detalle - Movimiento de las órdenes» | `admin_analitica.txt` | OK |
| F6 | `/ranking` (A) | «Entregadas / asignadas» | «Efectividad · entregados / asignados · hoy», cabecera «Entregados / asignados» | `admin_ranking.txt` | OK |
| F7 | chat del mensajero (X) | «4 asignadas» | «Conversaciones 4 asignados»; chips «En reparto», «Mensajero recogiendo en la bodega» | `mensajero_chat_lista.txt` | OK |
| F8 | `/recoleccion` (X) | «Recolectadas hoy» | «Recogidos en tienda hoy» | `mensajero_recoleccion.txt` | OK |
| F9 | rastreo público, guía `990012` (factor `0005`) | la gestión dos veces, la última con fecha anterior, clave React duplicada | `… En reparto 17:45 · Novedad 17:46 · En reparto 17:47 · Novedad · pendiente de confirmación 17:48` — una sola vez, en orden cronológico, sin aviso de clave (la «Novedad 17:46» es otra fila de historial, anterior) | `publico_rastreo_990012.txt` | OK |
| F10 | historial (A), `QA-R-0012`, `111117`, `111111` | «Motivo: migracion 454: retiro de devolucion_por_confirmar», «… 155: retiro de en_fulfillment» | «Motivo: Migración: retiro de Devolución por confirmar (estado retirado)», «Motivo: Migración: retiro de En fulfillment (estado retirado)» | `admin_historial_*.txt` | OK |
| F11 | `/ayuda` (X, T, S; cada página del rol) | «## Recolectadas hoy», «Asignadas, todavía en bodega…», «**Rechazadas por plazo vencido.**», «Órdenes que quedaron sin gestionar», «entregadas / asignadas» | «Recogidos en tienda hoy», «Asignados, todavía en bodega, los podés recoger hoy», «Devolución a origen por plazo vencido. …», «Órdenes que pasaron a Novedad interna», «entregados / asignados» | `mensajero_ayuda_*.txt`, `tienda_ayuda_*.txt`, `satelite_ayuda_*.txt` | OK |

**Resultado: F1–F11, 15 superficies, 15 OK. Ningún nombre de §0.3 como rótulo, ningún código crudo.**

No se repasó el asistente (F11 lo incluía como segunda superficie): el encargo acotaba el repaso a `/ayuda`, y el
asistente responde desde esos mismos documentos (G2 los cubre también como contexto por rol).

## Clasificación de las 10 coincidencias del escaneo

| Coincidencia | Archivo | Clasificación |
|---|---|---|
| «En reparto → Ayuda solicitada a la tienda (estado retirado)» y su vuelta (×2) | `admin_historial_111117.txt` | Permitido: retirado con su sufijo (R11) |
| «Ayuda solicitada a la tienda · 24 sept 2026 … Por Marco Mensajero» | `admin_historial_111117.txt` | Permitido: la NOTA de la ayuda (evento 454), la excepción declarada de G2 (review m2) |
| «En Ayuda solicitada: sin intentos de contacto…» | `tienda_ayuda_tienda_novedades.txt` | Falso positivo: «En» + nombre de la pestaña «Ayuda solicitada» |
| «dinero en tránsito» (×2) | `*_ayuda_compartido_analitica.txt` | Falso positivo: dinero, no un envío |
| «Tu cuenta todavía no está asignada a una bodega» | `satelite_ayuda_satelite_mi_bodega.txt` | Falso positivo: la cuenta, no una orden |
| «Todavía en proceso 34» (dona de cohortes) | `admin_analitica.txt` | **Observación O6** |
| «la marcaste entregada por error» | `mensajero_ayuda_mensajero_cierre_del_dia.txt` | **Observación O7** |
| «no corresponde a ninguna orden por recolectar» | `mensajero_ayuda_mensajero_recoleccion.txt` | **Observación O7** |

## Observaciones (no son F1–F11; no se tocaron: fuera del encargo)

- **O6 — analítica, dona de cohortes: grupo «Todavía en proceso».** Contiene en minúscula el hito retirado «En proceso»
  (§0.3). El recorrido anterior dio la dona por buena, y el aviso del desglose (F5) llama al mismo grupo «Sin desenlace
  todavía»: son dos nombres para un grupo en la misma pantalla. Propuesta: usar «Sin desenlace todavía» también en la
  dona. Decisión del leader.
- **O7 — prosa de `/ayuda` del mensajero en minúscula, por debajo del límite de G2** (como el m8 de la revisión):
  `docs/ayuda/mensajero/cierre-del-dia.md` «la marcaste entregada por error» (→ «la marcaste como Entregado») y
  `docs/ayuda/mensajero/recoleccion.md` «ninguna orden por recolectar» (→ «ninguna orden en Por recolectar en tienda»
  o «que tengas que recolectar»). Sugerencia, no obligación.

## T3.1 — mutaciones de cierre sobre el árbol final (`8ab6baae`)

Arnés propio (`mutaciones_t31/`): reemplazo comprobado aplicado en disco, cada test corrido ANTES sin mutación (verde,
`*.base.log`) y DESPUÉS con ella (`*.log`), restauración byte a byte comprobada y `git status` de `app lib components
tests` vacío al final (`_resumen.json`). Secuencial, sin gate en paralelo.

| # | Mutación | Base | Con mutación |
|---|---|---|---|
| 1 | `"Entregada"` en el módulo del chip (`pos-card/pos-estado.ts`) | verde 9/9 | **ROJO** G2 «ningun nombre retirado como texto visible…» |
| 2 | `'devuelta'` en un `$queryRaw` (`AnaliticaRollupRepository`, `devoluciones`) | verde 31/31 | **ROJO** G1 «ningun archivo … usa un codigo anterior» + C05 (analítica, Postgres real). C03/C04/C06/C07 no leen esa consulta y siguen verdes |
| 3 | `Record` código→texto en un componente (`EstatusBadge.tsx`) | verde 5/5 | **ROJO** G3 «ninguna segunda fuente de nombres…» |
| 4 | quitar `estadoNombre` del webhook (`WebhookEstadoService`) | verde 80/80 | **ROJO** 8 tests (T1.7): «`estadoNombre` pegado detras de `estado`», «R25: el nombre es el visible de cada destino», forma de `data` (256/R7, 268/R19) |
| 5 | `NOMBRE_ESTADO.novedad` = «Novedades» | verde 4/4 | **ROJO** G4 (3): «20 codigos … igual a la tabla aprobada», «… leidos del disco», «MUTACION (R44)» |

## Mutaciones de este arreglo (m9 y contraste-454)

| Pieza | Mutación | Resultado |
|---|---|---|
| F9 (rastreo) | W11 del revisor: quitar `transicion.estatusValue === POR_CONFIRMAR_RETIRADO` | **ROJO**: «m9: una fila de OTRO estado del mismo minuto … se ve» |
| F9 (rastreo) | volver a comparar por la fecha formateada (precisión de minuto) | **ROJO**: «m9: el par … a caballo de un cambio de minuto sigue fundido» |
| contraste-454 | K4b solo con el motivo viejo | autocomprobación **ROJA**: motivo nuevo 16/17 (viejo 17/17) |
| contraste-454 (árbol final) | — | autocomprobación **VERDE**: motivo viejo 17/17 y motivo nuevo 17/17, contra `ordenex_455` |

Medido para F9 (base local, las 5 filas `devolucion_por_confirmar` con su gestión enlazada): gestión y fila retirada
**nunca** tienen el mismo instante (12–39 ms de separación), por eso la ventana de 5 s sobre el instante real en vez del
instante exacto; `gestion_orden_id` no se puede leer desde el rastreo (frontera de la 229, `rastreo-frontera.guardia`).
