# 454 — Paso 0: censo medido (NO es el spec)

> Medido el 2026-09-23 sobre el árbol del worktree (base `dev`, HEAD `849bc012` según el snapshot de sesión).
> Búsqueda: MCP `codebase-memory` (`R-job-singularis-projects-ordenex`) + confirmación en archivo real.
> El índice está rancio en números de línea (p. ej. `findParadasEnReparto` lo da en :2056, está en :3230):
> **todas las líneas de abajo son del archivo real**.
> Conteos de producción (órdenes vivas en `devolucion_por_confirmar` / `ayuda_tienda`): **ABIERTO**. Este
> agente no tenía el MCP de Supabase. Recordatorio: producción se vació a propósito el 2026-08-25.

## 0. El mecanismo de hoy, en una línea

`MisAsignacionesService.gestionar` (lib/services/MisAsignacionesService.ts:536) → `GestionOrdenRepository.crearGestionYTransicionar`
(lib/repositories/GestionOrdenRepository.ts:660): **en la misma tx** inserta `gestion_orden` (+hijas), `orden.update estatusId` (:679),
limpia el puntero 1-a-1 (:684), `appendCambioEstado` (:710) y `encolarOptimizacionInmediata` (:734).
`appendCambioEstado` (lib/repositories/registrar-cambio-estado.ts:177) es el choke point: valida `TRANSICIONES`, escribe
`orden_historial_estado` y en la **misma tx** encola webhook (:201), notificaciones (:211) y WhatsApp de bienvenida (:222).
Consecuencia: **todo lo que cuelga del choke point se mueve solo al instante de la aprobación** si la transición se mueve allí.

## 1. Qué reacciona hoy al gestionar (o lee lo que la gestión deja)

Leyenda "Lee": **E** = `orden.estatus_id`, **H** = `orden_historial_estado`, **G** = `gestion_orden`, **C** = `cierre_dia`.

### 1.a Dinero (lo más delicado)

| # | Qué | Dónde | Lee | Si el estado cambia recién al aprobar |
|---|---|---|---|---|
| D1 | 5 feeds de wallet al aprobar (42 caja, 43 tienda, 173 COD, 44 pago mensajero, 158 indemnización) | CierresAdminRepository.ts:1823-1885; feeds `WalletFeedService.ts:70`, `WalletTiendaFeedService.ts:103`, `WalletMensajeroFeedService.ts:32`, `WalletIndemnizacionFeedService.ts:30` | G por `cierreId`, C | **No cambia.** Ningún feed lee `orden.estatus_id` (confirmado por grep; lo afirma también el comentario :2198-2200). |
| D2 | Snapshot de pago al mensajero e ingreso de bodega por rechazo al solicitar | CierreDiaService.ts:605-621 (`computeTotales`, `derivarPagos`, `derivarIngresoBodega`); CierreDiaRepository.ts:1052 (vincular), :1123-1145 | G `resultado` | **No cambia.** |
| D3 | **Conteo de intentos** (`whereIntentosVigentes`) → tope 276, rechazo sintético con `cobroRechazado` (56), escalado, liberación de reprogramadas, eliminabilidad | OrdenHistorialRepository.ts:192-216 (6.ª condición :214-216); `ORIGEN_TIPOS_VISITA_REAL` lib/types/orden-historial.ts:323; LiberacionReprogramadaRepository.ts:162 | G + **H** (exige fila de historial con `gestion_orden_id` y `origen_tipo ∈ {gestion, gestion_tienda_ayuda}`) | **ROMPE en silencio** si la fila de historial de la gestión deja de escribirse al gestionar o se escribe al aprobar con otra familia: el conteo cae a 0, nadie llega al tope y no se cobra. Hay que decidir: o se sigue escribiendo una fila `H` por gestión (¿con qué destino, si la orden no cambia?), o se cambia el predicado (tocar 215/R4, dinero). |
| D4 | **Corte nocturno** barre `en_reparto`+`ayuda_tienda` → `sin_gestionar` | CorteDiarioRepository.ts:59,111; CierreDiaRepository.ts:932-981 | E | **ROMPE CON DINERO.** Una orden gestionada y aún `en_reparto` sería barrida a `sin_gestionar`; al aprobar, la rama 276 (CierresAdminRepository.ts:1995-2056) puede terminarla en `rechazada` con gestión sintética que **cobra**. El barrido tiene que excluir órdenes con gestión vigente no aprobada. |
| D5 | Liberación `sin_gestionar` y tope al aprobar | CierresAdminRepository.ts:1892-2098 | E + `cierre_sin_gestion` | Precedente directo (ver §3). Hay que decidir si `sin_gestionar` sigue siendo estado (ABIERTO, §5). |
| D6 | Devolución de `rechazada` al aprobar (139) | CierresAdminRepository.ts:2111-2164 | E por **`mensajeroAsignadoId`**, no por cierre | Con el modelo nuevo la `rechazada` nace en esta misma tx; el bloque tendría que seleccionar por **gestiones de este cierre** (mismo fallo mudo que M7 de la 271 si se deja por mensajero con 2 cierres abiertos). Money-neutral hoy. |
| D7 | Anclaje `devolucion_por_confirmar → devuelta` | CierresAdminRepository.ts:2241-2319 | G del cierre + E | Pasa a ser `en_reparto → devuelta`. Es la plantilla del modelo nuevo (§3). |
| D8 | Plazo de la tienda (cron SLA de `devuelta`) → escalado a `rechazada` + cobro | DevolucionSlaRepository.ts:20,42 | **H familia `anclaje_devolucion`** | La transición al aprobar debe seguir escribiéndose con `origen_tipo = anclaje_devolucion` o el cron deja de ver el reloj. |
| D9 | Liberación de reprogramadas: timbre al aprobar (315) + reloj 00:00 | CierresAdminService.ts:1061; LiberacionReprogramadaRepository.ts:44-47,113 | E `reprogramada` + G + H | Natural: `reprogramada` aparece en la tx de aprobación y el timbre corre justo después. Ver D3 (la condición de visita real está en :162). |
| D10 | Corrección de resultado #69 (`entregada → rechazada`) | CierresAdminRepository.ts:1567; `orden.updateMany … estatusId: entregada` :1672-1676; append :1681 | G + **E** | **ROMPE**: con cierre abierto la orden estará `en_reparto`, `count !== 1` → `throw` → la corrección falla siempre. Pasa a ser solo sello sobre G (+ evento), sin transición. Arista #69 sobra. |
| D11 | KPI "Total a cobrar" del mensajero | GestionOrdenRepository.ts:36,120; MisAsignacionesService.ts:362-378 | E (`notIn en_reparto, ayuda_tienda`) | **Descuadra**: las gestionadas seguirían `en_reparto` y saldrían del sumando "gestionadas" y entrarían en "porCobrar" (COD de una entrega ya cobrada). No es ledger, es pantalla. |
| D12 | Rechazo por tienda desde `devuelta` (240/337) y reprogramación desde `devuelta` (100) | GestionOrdenRepository.ts:780,844 | E `devuelta` | No cambia (operan tras el anclaje). |

### 1.b Plazos, crons, colas

| # | Qué | Dónde | Lee | Efecto |
|---|---|---|---|---|
| P1 | Cron `procesar-devueltas-sla` | app/api/cron/procesar-devueltas-sla | H anclaje (D8) | Ver D8. |
| P2 | Cron `liberar-reprogramadas` | app/api/cron/liberar-reprogramadas | E+G+H | Ver D9. |
| P3 | Cron `corte-diario` | app/api/cron/corte-diario; CorteDiarioService.ts:32,166 | E | Ver D4. |
| P4 | Cron `avisos-diarios` (novedades sin gestionar, devoluciones represadas) | AvisoAgregadoRepository.ts:81,195 | E vía `ESTATUS_POR_GRUPO` | El grupo `ayuda` desaparece como estado (§2). |
| P5 | Cola `optimizacion_ruta` inmediata al gestionar | GestionOrdenRepository.ts:734; paradas `OrdenRepository.findParadasEnReparto` :3230 | E `en_reparto` | La reoptimización se encola, pero la orden gestionada **seguiría siendo parada**. Filtrar por "sin gestión vigente". |
| P6 | Cola `webhook_estado` | registrar-cambio-estado.ts:201; webhook-estado-encolado.ts:82-177 | H (destino ∈ `EVENTOS_PUBLICOS`) | Los eventos `entregada/reprogramada/rechazada/incidente` pasan a llegar al aprobar (como ya pasó con `devuelta` en la 239: mediana 8,2 h · p90 22,1 h · máx 48,2 h). Ver §4. |
| P7 | Rollup analítico diario | AnaliticaRollupRepository.ts:110-133 (estatus al corte, terminal en ventana), :212-232 (gestiones) | H + G | Medidas de gestión: **no cambian** (G por `created_at`). Estatus al corte, embudo y tiempo de ciclo: **se desplazan** a la fecha de aprobación. |
| P8 | Analítica operativa viva | AnaliticaOperativaVivaRepository.ts:60-76,243-273 | H | Igual que P7: la orden "vive" en reparto hasta aprobar. |
| P9 | Tablero del día | TableroDiaRepository.ts:298-374; lib/types/tablero-dia.ts | G "resultado del día" + E solo para sin resultado | **Robusto**: el contador sale de la última gestión vigente, no del estado. Revisar el bucket `en_reparto` (`r.resultado IS NULL`). |
| P10 | Analítica recaudo / API analítica | RecaudoAnaliticaRepository.ts:91 | C aprobados | No cambia. |
| P11 | Ranking | RankingRepository.ts:51 | G `entregada` | No cambia. |

### 1.c Notificaciones y mensajes

| # | Qué | Dónde | Efecto |
|---|---|---|---|
| N1 | In-app "orden rechazada por el destinatario" | lib/notificaciones/emitir.ts:204-285 (filtro `origenTipo === "gestion"` y destino `rechazada`) | Se retrasa a la aprobación y **se apaga** si el append de aprobación usa otra familia. Decidir si el aviso sale al gestionar (evento) o al aprobar. |
| N2 | WhatsApp de bienvenida | whatsapp-bienvenida-encolado.ts:55,132 (familia `recoleccion`) | No cambia. |
| N3 | "Cierre por aprobar" / "bloqueado" / "rechazado" | CierreDiaService.ts:555,639,644; CierresAdminService.ts:358-398 | No cambia. |
| N4 | Push web | push-web-handler (sale de `notificacion`) | Sigue a N1. ABIERTO si hay push atado a estado. |

### 1.d Pantallas, guardias y operación por rol

| # | Qué | Dónde | Lee | Efecto |
|---|---|---|---|---|
| U1 | **Guardia de gestionabilidad** | MisAsignacionesService.ts:115,756-772 (`estatusValue === "en_reparto"`) | E | **ROMPE**: una orden gestionada seguiría gestionable → segunda gestión. Hace falta "en_reparto **y** sin gestión vigente no aprobada" (también en `escogerParaGestion` :503). |
| U2 | Portal del mensajero: por recoger / por gestionar / con ayuda + KPIs | MisAsignacionesService.ts:256-260,314-323,362-378; reparto-mensajero-estados.ts:52-55 | E | Las gestionadas reaparecen en "por gestionar" y en el mapa (`RutaMapa*` se alimenta de `porGestionar`). Grupo `conAyuda` pierde su estado. |
| U3 | **Precondición para solicitar el cierre** | CierreDiaService.ts:68,563-568 (`ESTADOS_PENDIENTES = por_recoger, en_reparto, ayuda_tienda`) | E | **ROMPE**: con gestionadas en `en_reparto` el mensajero nunca puede solicitar. Mismo arreglo que U1. |
| U4 | Deshacer gestión (67) | CierreDiaService.ts:122-140 (`ESTADOS_ESPERADOS`), :740 ventana `cierre_id IS NULL`; CierreDiaRepository.ts:1441-1536 | G + E | Se simplifica: la orden ya está `en_reparto`; deshacer = anular G (+ evento "gestión anulada"), **sin transición**. Aristas #31/#32/#33/#53/#61 quedan sin productor (quedan #34/#35/#36 legadas → ABIERTO). |
| U5 | Traspaso entre mensajeros | TraspasoMensajeroService.ts:73 (`en_reparto, ayuda_tienda`) | E | Riesgo: traspasar una gestionada pendiente a otro mensajero (su G y su cierre son del primero). Excluir. |
| U6 | Corrección de día de reparto | CorreccionDiaRepartoService.ts:56 | E | Riesgo: cambiar el día de una ya gestionada. Excluir. |
| U7 | Asignación/aviso de mensajero ocupado; "Generar guía" | GuiaAsignacionService.ts:140; lib/actions/ordenes-guia.ts:226 | E | Cuenta gestionadas como carga pendiente. |
| U8 | Aviso "tu reparto de mañana" | RepartoMananaRepository.ts:98 | E | Idem. |
| U9 | Listado de órdenes y filtro por estado (maestro/admin/adminTienda) | app/(app)/ordenes/exclude-por-rol.ts:33; OrdenesListado.tsx; EstatusBadge.tsx | E | Tienda/admin ven "En reparto" hasta aprobar; hace falta la señal "gestión pendiente de confirmar" en la fila. |
| U10 | Satélite: estados visibles | lib/utils/estados-bodega-satelite.ts:196 | E | Quitar los dos estados. |
| U11 | `/novedades` de la tienda (pestañas ayuda / devolución) | lib/types/novedad-grupo.ts:63-69; `OrdenRepository.novedadWhere` | E | Pestaña "ayuda" pierde su discriminante de estado (§2, riesgo R-A). "Devolución" (`devuelta`) no cambia. |
| U12 | Hilo de notas por ventana de estado | lib/types/ventana-hilo-notas.ts:57,62 | E | adminTienda solo escribe en `devuelta`/`ayuda_tienda`; sin el estado, su ventana en ayuda desaparece. |
| U13 | Chat del mensajero (contacto de la tienda) | app/(app)/mis-asignaciones/_components/chat/chat-contactos.ts | E | Idem ayuda. |
| U14 | Recaudo "por API" | No existe ruta de recaudo en `app/api/**`; lo más cercano es `api-key/analitica` (C aprobados, no cambia) y `api-key/orden/[id]` (detalle, §4). ABIERTO qué se quería decir. |
| U15 | Cierres de bodega satélite (431/SF-001, en `dev`) | CierreBodegaRepository.crearCierreBodega; CierresBodegaAdminRepository.resolverCierreBodega | C (solo `cierre_dia` aprobados) | **No toca órdenes.** Compatible. |

## 2. Consumidores de `devolucion_por_confirmar` y `ayuda_tienda`

Conteo por grep (excluye `specs/`, `progress/`, `docs/`):
- `devolucion_por_confirmar`: **175 apariciones en 84 archivos** (incl. tests).
- `ayuda_tienda` / `ESTADO_AYUDA` / `ayudaEstatusId`: **275 en 93 archivos de producción/migraciones** + **565 en 121 archivos de test**.

| Capa | `devolucion_por_confirmar` | `ayuda_tienda` |
|---|---|---|
| Dominio `lib/types` | order-status.ts, order-status-transiciones.ts (#59-#61), gestion-destino.ts:48,67, webhook-eventos.ts (comentarios), rastreo-publico.ts:100, tablero-dia.ts, novedad-grupo.ts, ventana-hilo-notas.ts, cohorte-carga.ts, order-status-eliminables.ts, orden-historial.ts | order-status.ts:108, order-status-transiciones.ts (#62-#66), webhook-eventos.ts:102, rastreo-publico.ts:107, novedad-grupo.ts:65, ventana-hilo-notas.ts:57,62, habilitacion-api.ts:32, novedad.ts, novedad-habilitar.ts, gestion-desde-ayuda.ts, gestion-retorno.ts, gestion-orden.ts, correccion-datos-cliente.ts, tablero-dia.ts, orden-historial.ts (5 familias) |
| Servicios | MisAsignacionesService, CierreDiaService, DevolucionSlaService, RechazoTiendaService | **Productores**: SolicitudAyudaService.ts:116, rescate-ayuda.ts:84, HabilitarNovedadService, ApiHabilitacionService.ts:189 (API key `habilitar`), GestionDesdeAyudaService (237). **Lectores**: MisAsignacionesService, CierreDiaService, CorteDiarioService, TraspasoMensajeroService, CorreccionDiaRepartoService, GuiaAsignacionService, NovedadesService, OrdenNotaService |
| Repos | CierresAdminRepository (anclaje), DevolucionSlaRepository | OrdenRepository.transicionarAyuda :5283, GestionOrdenRepository.crearGestionDesdeAyuda :910/:960, CierreDiaRepository :932, CorteDiarioRepository :59, CierresAdminRepository, RepartoMananaRepository |
| API pública | openapi-spec.ts (2) | openapi-spec.ts:55 (estado de webhook documentado), ruta `app/api/ordenes/api-key/habilitar` |
| UI | EstatusBadge, exclude-por-rol, novedad-acciones-catalogo | RepartoModule, HiloNotasAyudaModal, pos-estado, NovedadesModule/Tabs/Acciones, HabilitarNovedadModal, ayuda-descarga-columnas, OrdenesListado (6), SateliteOrdenesListado, CambiarDiaRepartoSateliteModal, cierre-factura |
| Esquema/migraciones | alta: `20260819120000_order_status_devolucion_por_confirmar`; + `20260819110000`, `20260819130000` | alta: `20260819140000_order_status_ayuda_tienda`; familias de historial `20260819150000`, `20260820120000`, `20260823120000`; `cierre_sin_gestion.estatus_origen_id` (264) referencia el id de ayuda |
| Guardias que fijan listas (hay que tocarlas a propósito) | order-status-transiciones.guardia, registrar-cambio-estado.guardia, fixture inventario-transiciones-140, rastreo-hitos-exhaustivo.guardia, buckets-estatus.guardia, gestiones-detalle-lista-blanca.guardia, definiciones-catalogo.guardia, webhook-eventos.test | + carga-del-mensajero.guardia, hilo-ventana-alcanzable.guardia, novedad-acciones-una-tabla.guardia, ayuda-columna-retirada.guardia, estados-reparto-mensajero-unica-fuente.guardia, origenes-admitidos-en-cierre.guardia, aprobacion-escrituras-cubiertas.guardia, orden-nota-frontera.guardia, rastreo-sin-estatus-crudo.guardia |
| Integración (DB real) relevantes | anclaje-devolucion-migration, cierre-sin-gestion-tope-sql-real, cierre-descarga-intentos-entrega-sql-real, gestiones-detalle-api-405, cohorte-carga-desenlaces, resolver-novedad-*-sla, wallet-idempotencia, order-status-v2-migration | ayuda-tienda-migration, corte-diario-segundo-cierre-sql-real, novedades-predicado-sql-real, gestion-desde-ayuda-dia-reserva, gestion-tienda-ayuda-migration, traspaso-mensajero, correccion-dia-reparto(-efectos), satelite-bodega-alcance-real, corregir-datos-cliente.repo, e2e/reintentos-escalado.spec |

**Cómo se retira un estado del catálogo (precedente 155):** `order_status` es TABLA, no enum. La 155 (`20260729140000_order_status_retiro_en_fulfillment`) hizo backfill con fila de historial `ajuste_estado` por orden movida + `DELETE` **condicional** del catálogo que en producción es no-op porque el historial lo referencia (append-only, FK obligatoria). Aquí además referencia `cierre_sin_gestion.estatus_origen_id`. Las familias del enum `orden_historial_origen_tipo` (`solicitud_ayuda_tienda`, `rescate_ayuda_tienda`, `gestion_tienda_ayuda`, `habilitacion_api`, `anclaje_devolucion`) **no se pueden borrar** (filas históricas); `gestion_tienda_ayuda` además cuenta intentos (D3).

## 3. Quién aprueba cierres y precedente transaccional

| Vía | Quién | Dónde | ¿Aplica estado hoy? |
|---|---|---|---|
| Aprobar cierre del día | maestro/admin → alcance `bodega_central`; adminSatelite → `bodega_satelite` de su zona; resto `forbidden` | lib/actions/cierres-admin.ts:334 → CierresAdminService.aprobarCierre :900 (resolveAlcance :410) → CierresAdminRepository.resolverCierre :1758 | **Sí, en UNA `$transaction`** (:1780): dinero (D1) → `sin_gestionar`→bodega/`rechazada` (D5) → `rechazada`→`por_devolver*` (D6) → confirmación física → anclaje `devolucion_por_confirmar`→`devuelta` (D7) → bitácora. Única vía de aprobación de `cierre_dia` (grep `nuevoEstado: "aprobado"`). |
| Rechazar cierre | mismos | CierresAdminService.rechazarCierre :1495 | No mueve nada. Con el modelo nuevo la orden se quedaría `en_reparto` hasta re-solicitud + aprobación. |
| Cierre vencido (corte nocturno) | sistema | CierreDiaRepository.crearCierre con `corteSinGestionar` | `ESTADOS_RESOLUBLES = ["solicitado"]` (CierresAdminRepository.ts:121): un `vencido` **no se aprueba directo**; pasa a `solicitado` por re-solicitud del mensajero (CierreDiaService.ts:544) o `forzarSolicitudVencido` (:2391) y luego se aprueba por la vía 1. |
| Satélite autónoma (431/SF-001) | adminSatelite / central | CierresBodegaAdminRepository.resolverCierreBodega | Nivel 2 (`cierre_bodega`), **no toca órdenes** y solo agrupa `cierre_dia` ya aprobados. No es una vía de aprobación de órdenes. |
| Incidente de admin (158) | maestro/admin/adminSatelite | IncidenteAdminService.ts:448 | Reporte de bodega, no es gestión del mensajero. Fuera. |

Precedente: la 239 ya hace exactamente "estado real al aprobar" para devoluciones, guardado por pre-estado, con la carrera de "gestión más reciente" resuelta dentro de la tx (:2255-2282) y money-neutral. El modelo nuevo generaliza ese bloque a los 5 resultados con origen `en_reparto`. Ojo al orden medido por `cierres-admin-caja-cod.test.ts`: los bloques de estado van **después** de los feeds.

## 4. Qué existe ya para mostrar la gestión al instante

| Fuente | Qué da | Límite |
|---|---|---|
| `gestion_orden` (+ evidencias, pagos, `anulada_at`, `cierre_id`) | resultado, motivo, fotos, hora; ya es la verdad del dinero | No tiene "confirmada"; se deriva de `cierre.estado = aprobado`. |
| `orden_historial_estado` | una fila por transición; la leen rastreo, analítica, intentos, SLA | Hoy la gestión **es** una transición; sin transición no hay fila (D3). |
| Rastreo público | `RastreoPublicoRepository.ts:44` lee **solo H**; mapa `HITO_POR_ESTATUS` (rastreo-publico.ts:75-108) | Para ver la gestión al instante tendría que leer también G. `devolucion_por_confirmar`→`no_entregado` y `ayuda_tienda`→`en_reparto` ya colapsan. |
| API key detalle (405) | `gestiones[]` con `createdAt, resultado, estadoResultante, motivo, mensajero` (ApiOrdenLecturaService.ts:233-242) | **Ya publica la gestión al instante por consulta**; `estadoResultante` hoy puede decir `devolucion_por_confirmar`. |
| Webhooks | un solo evento `orden.estado_actualizado` (WebhookEstadoService.ts:39), payload `{ordenId, estatusDestinoId, ocurridoAt}`, filtro `EVENTOS_PUBLICOS` (webhook-eventos.ts:90-104) | **No existen** `gestion_registrada` ni `estado_cambiado`: son nombres nuevos → contrato nuevo (tipo de evento, payload con `resultado`). Hoy `ayuda_tienda` y el `en_reparto` del rescate SÍ se emiten (268): quitarlos **reduce** el contrato. |
| Notificaciones in-app | tabla `notificacion` | Solo N1 atado a gestión. |

## 5. Riesgos y casos borde

| Caso | Riesgo |
|---|---|
| mensajero | U1/U3 son bloqueantes: sin "en_reparto y sin gestión pendiente" puede gestionar dos veces y no puede cerrar. Portal, mapa y ruta (U2, P5) le devuelven paradas ya hechas. |
| mensajero, deshacer | Sin transición que revertir; las aristas de deshacer (#31-#33, #53, #61) quedan sin productor. El integrador ya recibió el evento "gestión registrada" → hace falta evento de anulación (ABIERTO). |
| admin/maestro | Corrección #69 rompe (D10). Aprobación se vuelve la tx más cargada (5 destinos + webhooks + notificaciones dentro). 139 debe pasar a seleccionar por gestiones del cierre (D6). |
| adminSatelite | Aprueba los `cierre_dia` de su zona: el retraso del estado depende de él. 431 no cambia la regla. |
| adminTienda | Ve "En reparto" hasta la aprobación (hoy ve `entregada` al instante). `/novedades` pestaña ayuda, hilo (U12) y "gestionar desde ayuda" (237) pierden su estado. |
| apiKey / integrador | `entregada/reprogramada/rechazada/incidente` llegan con el retraso de aprobación (dato de la 239: mediana 8,2 h, máx 48,2 h); evento nuevo; `ayuda_tienda` deja de llegar; `habilitar` (266) pierde su objeto. Obligación de avisar antes de desplegar (precedente 239 T0.3/268) — medir audiencia primero. |
| Corte nocturno | D4: barrer gestionadas = cobro indebido. Decidir si `sin_gestionar` se conserva (hoy es estado intermedio que la aprobación resuelve) o si el corte solo marca y la aprobación aplica `en_reparto → bodega/rechazada` directo (ABIERTO). Una orden en ayuda al corte: hoy va a `sin_gestionar` desde `ayuda_tienda` (#64). |
| Reprogramada liberada por cron | La liberación ya espera a cierre aprobado (276 puerta + 315 timbre); compatible. Condición de visita real (LiberacionReprogramadaRepository.ts:162) depende de D3. |
| Cierre rechazado | La orden queda `en_reparto` con G vinculada a un cierre rechazado; no gestionable (U1), no barrible (D4), no traspasable (U5) hasta re-solicitar y aprobar. |
| Cierre vencido / multi-día | La orden puede pasar días `en_reparto` con gestión pendiente; con 271 hay hasta N cierres abiertos por mensajero — todo filtro debe ir **por cierre/gestión**, nunca por mensajero (lección M7). |
| Gestión desde ayuda por la tienda (237) | Hoy transiciona `ayuda_tienda → reprogramada/rechazada` y cuenta intento vía familia `gestion_tienda_ayuda` (D3). |
| Dos gestiones vivas de la misma orden | Ya pasa en producción (memoria); el anclaje ya elige la más reciente vigente — replicar para los 5 resultados. |
| Órdenes vivas en los estados a borrar | Necesitan backfill (`devolucion_por_confirmar`→`en_reparto`, `ayuda_tienda`→`en_reparto` + evento de ayuda) con fila de historial. **Conteo en prod: ABIERTO.** |

## 6. Tamaño honesto

| Capa | Archivos de producción afectados (aprox., medido por grep + lectura) | De ellos, dinero |
|---|---|---|
| Dominio `lib/types` / constantes | ~20 (transiciones, gestion-destino, webhook-eventos, rastreo, novedad-grupo, ventana-hilo, tablero-dia, habilitacion-api, orden-historial, order-status, reparto-mensajero-estados…) | orden-historial (`ORIGEN_TIPOS_VISITA_REAL`) |
| Repositorios | ~12 (GestionOrden, CierreDia, CierresAdmin, CorteDiario, Orden, OrdenHistorial, DevolucionSla, LiberacionReprogramada, RastreoPublico, AvisoAgregado, RepartoManana, AnaliticaRollup/Viva) | **CierresAdmin.resolverCierre + corregirResultado, CierreDia.crearCierre (corte), OrdenHistorial.whereIntentosVigentes, DevolucionSla** |
| Servicios | ~15 (MisAsignaciones, CierreDia, CierresAdmin, CorteDiario, SolicitudAyuda, rescate-ayuda, HabilitarNovedad, ApiHabilitacion, GestionDesdeAyuda, Novedades, OrdenNota, Traspaso, CorreccionDiaReparto, GuiaAsignacion, WebhookEstado + emisor) | CierresAdmin, CierreDia |
| Notificaciones/jobs | 3 (emitir.ts, webhook-estado-encolado, WebhookEstadoService) | — |
| API pública | openapi-spec + ruta `habilitar` + contrato webhook | — |
| UI | ~20 componentes (mis-asignaciones, novedades, ordenes, recepcion-satelite, cierres-admin) | cierre-factura (solo lectura) |
| Migraciones | ≥1 nueva (backfill + retiro condicional del catálogo, 155 como plantilla) | — |
| Tests | ~84 archivos tocan `devolucion_por_confirmar` y ~121 `ayuda_tienda`; ~19 guardias con listas fijadas | suites de `resolverCierre`, tope, intentos, SLA |

**Lo delicado (dinero), en orden:** D4 (corte que barre gestionadas → cobro), D3 (intentos atados a una fila de historial por gestión → tope/escalado/`cobroRechazado`), D10 (corrección #69 lanza), D8 (reloj SLA por familia `anclaje_devolucion`), D5/D6 (bloques de la aprobación seleccionados por mensajero). Los feeds de wallet (D1/D2) **no** cambian.

## Preguntas abiertas para el spec

1. ¿Se sigue escribiendo una fila de historial por gestión (evento sin cambio de estado) o se reescribe el predicado de intentos? (D3)
2. ¿`sin_gestionar` sobrevive como estado o el corte pasa a ser evento y la aprobación aplica `en_reparto → bodega/rechazada`? (D4/D5)
3. ¿Dónde vive la "ayuda abierta" si deja de ser estado? `novedad-grupo.ts` prohíbe marcas persistidas (D1 de la 236) — ¿tabla de eventos, `orden_nota`, otra? (U11/U12)
4. Contrato de webhooks: nombres y payload de `gestion_registrada` / `estado_cambiado` frente al único `orden.estado_actualizado` de hoy; ¿se emite anulación/corrección de gestión? ¿Se retira `ayuda_tienda` del contrato? (§4)
5. ¿El rastreo público muestra la gestión pendiente ("Entregado — por confirmar") o solo el hito tras aprobar?
6. ¿La notificación N1 sale al gestionar o al aprobar?
7. Conteo en producción de órdenes vivas en `devolucion_por_confirmar` / `ayuda_tienda` y de integradores con suscripción activa (audiencia del cambio de contrato).
8. "Recaudo por API": no existe ruta con ese nombre (U14) — ¿a qué se refería?

## Anexo del leader — conteo en producción (solo lectura, 2026-09-23)

Órdenes por estado en el catálogo de prod: `ayuda_tienda` **27**, `devolucion_por_confirmar` **1**,
`en_reparto` **116**, `sin_gestionar` 0. El catálogo de prod conserva además `en_fulfillment` y
`pendiente` con **0** órdenes (huérfanos; la 455 debe contarlos al renombrar).
La pregunta 8 («recaudo por API») era una expresión del leader, no una ruta: se descarta.
