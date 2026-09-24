# Recorrido en navegador — ficha 454 (T4.2)

- **Fecha:** 2026-09-24 (00:50–02:25 hora de Costa Rica). **Rama:** `feature/454-recorrido` desde `edff9ccf`.
- **Entorno:** base LOCAL (M1-M3 aplicadas, `prisma migrate status` limpio), un solo dev server
  (`next dev --port 3457`), Playwright headless (`@playwright/test` resuelto con `createRequire`),
  contexto con geolocalización fija, foto PNG real. Evidencia en `progress/recorrido_454/`
  (76 archivos: capturas del elemento + JSON de la API con las URL firmadas y el teléfono tapados).
- **Búsqueda de código:** MCP `codebase-memory` (proyecto `R-job-singularis-projects-ordenex`) para
  localizar; confirmado siempre en el archivo real. Buena parte se buscó con `grep` porque el índice no
  devolvía los símbolos nuevos de la 454 (`gestion-pendiente.ts`, `NotaGestionPendiente`).

## Qué toqué del entorno local (y hay que saberlo)

1. **Rotadas las 4 cuentas QA** (`seed-usuarios-qa.ts`) y la clave de `maestro.qa@ordenex.test`
   (`db:seed:maestro`), en la base local. Si otro agente usaba `QA_PASSWORD`, su login deja de funcionar.
2. **API key «Prueba Tienda 18:06:29» rotada** (la anterior deja de valer) y **webhook registrado** para su
   owner (`https://recorrido-454.example.com/hook`, no existe: los jobs quedan `pending`; no corrí
   `procesar-jobs`).
3. **Corte nocturno forzado** (`GET /api/cron/corte-diario` con `CRON_SECRET`): barrió los dos mensajeros
   locales (`vencidosCreados: 2`).
4. **`orden.num_guia` puesto a mano en 3 órdenes sin guía** (111115→990115, 111117→990117, 111136→990136)
   para intentar la confirmación física. No sirvió (la guía está congelada en `cierre_detail`) y el paso
   siguiente —actualizar `cierre_detail`— **lo bloqueó el clasificador de permisos**; no lo forcé. Esas 3
   guías siguen puestas en local.
5. El cierre `ebc7caa5…` de Marco queda **`solicitado`**, sin aprobar (ver FALLO-1).

## Tabla caso × rol

Leyenda: **OK** verificado con evidencia · **FALLO** · **N/V** no verificable en este entorno (motivo) ·
**N/E** no ejecutado porque un paso previo lo bloquea.

| Caso | maestro | admin | adminTienda | adminSatelite | mensajero | rastreo público | API key |
|---|---|---|---|---|---|---|---|
| Gestionar (5 resultados) | OK ¹ | OK ² | OK ³ | OK ⁴ | OK ⁵ | OK ⁶ | OK ⁷ |
| Deshacer | N/V (visto con admin) | OK ⁸ | N/V (visto con admin) | OK ⁸ | OK ⁸ | OK ⁸ | OK ⁸ |
| Pedir cierre | — | — | — | — | bloqueado OK; permitido OK; «bloqueado por ayuda» N/V ⁹ | — | — |
| Corte nocturno forzado | N/V (visto con admin) | OK ¹⁰ | — | — | OK ¹⁰ | — | — |
| Aprobar | N/E | **N/E — FALLO-1** | N/E | N/E | — | N/E | N/E |
| Rechazar cierre | N/V (visto con admin) | OK ¹¹ | OK ¹¹ | — | OK ¹¹ | N/V | OK ¹¹ |
| Corregir resultado (#69) | — | OK ¹² | OK ¹² | — | — | OK ¹² | OK ¹² |
| Traspasar | — | gestionada OK; en mano N/V ¹³ | — | N/V | N/V | — | — |
| Cambiar día | — | gestionada OK; en mano OK ¹³ | — | OK ¹³ | — | — | — |
| Tope de intentos | N/V ¹⁴ | N/V | — | — | N/V | — | N/V |
| Ayuda y rescate | OK ¹⁵ | OK ¹⁵ | OK ¹⁵ | OK ¹⁵ | OK (Recuperar ofrecido, no pulsado) ¹⁵ | OK ¹⁵ | OK ¹⁵ |
| Duración de la aprobación (~14 gestiones) | N/E — FALLO-1 | | | | | | |

**Recuento: 34 celdas OK · 0 FALLO en el código de la 454 medido · 12 N/V · 7 N/E (todas por FALLO-1).**

### Notas de evidencia

1. `gestionar_maestro_fila_*.png` / `_historial_*.png`. Fila QA-R-0015: «990015 QA-R-0015 **En reparto
   Entregada · pendiente de confirmación** 1 Carolina Vega…». Historial: «… En reparto → Entregada 13 ago
   2026 … **Gestión registrada Resultado: Entregada** 24 sept 2026, 12:53 a. m. Por Marco Mensajero
   (Mensajero)». Lo mismo con Reprogramada (0014), Devuelta (0016), Rechazada (0020) e Incidente (0021).
2. `gestionar_admin_fila_*.png`: mismas cinco filas con la misma nota.
3. `gestionar_tienda_fila_*.png`: la tienda (dueña de las cinco) ve las cinco con la nota.
4. `/recepcion-satelite/en-bodega` de Sara (zona Quepos): «990016 QA-R-0020 En reparto **Rechazada ·
   pendiente de confirmación**…» y «990017 QA-R-0021 En reparto **Incidente · pendiente de
   confirmación**…»; **QA-R-0015 (GAM) no aparece** («(sin fila)»): no ve órdenes ajenas.
5. Respuesta de `gestionar`, capturada al instante: `{"status":"ok","ordenId":"f5641784-…","estado":"entregada",…}`
   (y `reprogramada`, `devuelta`, `rechazada`, `incidente`). Toast: «Orden QA-R-0014: Reprogramada.».
   Tras cada una, la orden **sale de «por gestionar»** (el botón «Gestionar la orden X» desaparece) y los
   KPI bajan: `Pendientes 9 → 8 → 7 → 6 → 5 → 4`, «Por cobrar ₡99.244 → ₡92.744 → … → ₡47.244».
   En base: la orden sigue `en_reparto` y la gestión tiene su evento `gestion_registrada` (R1/R2).
6. `gestionar_rastreo_*.png` (sin sesión, landing → «Rastrear envío»): «Guía 990015 **Entregada ·
   pendiente de confirmación** … Entregada · pendiente de confirmación 2026-09-24 · 00:53»; la action
   devuelve `{"hito":"entregado",…,"pendiente":true,"nombreResultado":"Entregada"}`. Igual con las otras 4.
7. `gestionar_api_990015.json`: `"estado":"en_reparto"`, `gestiones:[…{"resultado":"entregada",
   "estadoResultante":null,…,"pendienteConfirmacion":true}]`; la gestión legada anterior sale con
   `pendienteConfirmacion:false`. Un job `webhook_evento` por cada `gestion_registrada`.
8. Deshacer de QA-R-0021 desde `/cierre-dia` («Devolver a gestión»): respuesta `{"status":"ok",…}`, toast
   «Gestión deshecha; la orden volvió a tu lista para gestionar.»; vuelve a «por gestionar»
   (`deshacer_mensajero_reparto_QA-R-0021.png`), fila de admin y satélite ya **sin nota**, historial con
   «**Gestión anulada** Resultado: Incidente … Por Marco Mensajero», rastreo sin el hito pendiente,
   evento `gestion_anulada` con su job.
9. `bloqueado_mensajero_solicitar_cierre.png`: botón deshabilitado, «Tenes ordenes sin gestionar;
   gestionalas antes de cerrar.» (texto de la feature 37, no de la 454). **Permitido:** tras el corte,
   «Solicitar aprobación del cierre vencido» → `{"status":"ok","via":"resolicitado"}`. **N/V «bloqueado
   solo por la ayuda»:** las órdenes en mano que quedaban no tienen guía y el portal no deja gestionarlas
   («Esta orden aún no tiene guía asignada; no se puede gestionar.»), así que el bloqueo no se pudo aislar.
10. Corte → `{"vencidosCreados":2,"mensajerosEvaluados":2}`. Las 7 órdenes con gestión pendiente siguen
    `en_reparto` con su gestión colgada del cierre `vencido`; **ninguna** en `cierre_sin_gestion`, que
    solo tiene las 3 en mano (63241, 111117 y REM-0001, esta con ayuda abierta: R27). Detalle de admin
    (`solicitado_admin_cierre_detalle.png`): «GESTIONES 16 … ÓRDENES SIN GESTIONAR 3 … 111117 · …
    63241 · … REM-0001». Mensajero: «Tu cierre venció sin enviarse a aprobación.»
11. Rechazo: `{"status":"ok","cierreId":"ebc7caa5-…","estado":"rechazado"}` en 789 ms; el snapshot de las
    19 órdenes es idéntico antes/después salvo el estado del cierre (nada se mueve); la tienda sigue
    viendo «Entregada · pendiente de confirmación»; **0 jobs nuevos** (15 antes y después); el mensajero
    ve «Tu cierre fue rechazado, pero no queda cerrado» y re-solicita (`via: resolicitado`).
12. Corregir QA-R-0021 entregada→rechazada: el diálogo dice «La orden sigue «En reparto» hasta entonces:
    su estado pasa a «Rechazada» al aprobar el cierre.»; respuesta `totales.general 10700 → 6500`, pago al
    mensajero 13600 → 11900, ingreso de bodega por rechazos 1000 → 2000; evento `gestion_corregida`
    (`entregada → rechazada`, actor admin) con su job; la tienda y el rastreo pasan a «Rechazada ·
    pendiente de confirmación».
13. En `/ordenes` (admin) la gestionada no tiene casilla sino
    `aria-label="No se puede seleccionar la orden QA-R-0015: Tiene una gestión pendiente de confirmación: no
    se puede traspasar ni cambiar el día hasta que se apruebe el cierre del mensajero."`; la en mano (63241)
    ofrece «Traspasar a otro mensajero» y «Cambiar día de reparto». El traspaso en mano no se pudo ejecutar:
    el modal dice «No hay otro mensajero al que traspasar estas órdenes» (Marco es el único mensajero
    activo de GAM en local). Satélite: las gestionadas solo ofrecen «Ver historial».
14. Ninguna orden local está cerca del tope y llegar exige aprobar cierres (FALLO-1).
15. Ayuda sobre 111117: toast «Se solicitó ayuda. Tu tienda lo verá en Novedades.»; el mensajero la ve en
    «CON AYUDA SOLICITADA … 111117 En ayuda … Recuperar» y sin botón «Gestionar»; maestro/tienda ven
    «En reparto **Ayuda solicitada a la tienda**» y el evento en el historial; `/novedades` de la tienda
    la lista en «Ayuda solicitada». **Habilitar** (tienda): `{"status":"ok",…,"rescatada":true}`, «La orden
    volvió a la ruta.», evento `ayuda_rescatada`. **Reprogramar desde la ayuda** (tienda, 111136):
    `{"status":"ok","resultado":"reprogramada"}` → «Reprogramada · pendiente de confirmación», evento
    `gestion_registrada` con familia `gestion_tienda_ayuda` (R25). **Habilitar por API** (990017):
    `{"resultado":"habilitada","estado":"en_reparto","ayudaCerrada":true}`; repetir da
    `estado_no_habilitable`. Satélite ve la nota en QA-R-0021; el rastreo no cambia («En nuestras
    instalaciones»).

### Jobs `webhook_evento` (consulta local al final)

| tipo | estado | n | max(updated_at) |
|---|---|---|---|
| webhook_evento | pending | 15 | 2026-09-24 02:20:24 (hora de la base) |
| optimizacion_ruta | pending | 30 | 2026-09-24 02:11:11 |
| geocodificacion | pending | 52 | 2026-09-04 13:06:52 |

Eventos → jobs: `gestion_registrada` 8/7 (el que falta es el del backfill de M3 del 2026-08-21, anterior al
webhook), `gestion_anulada` 1/1, `gestion_corregida` 1/1, `ayuda_solicitada` 4/4, `ayuda_rescatada` 1/1,
`ayuda_habilitada_api` 1/1. Ojo al leer las horas: en la base local `jobs.created_at` usa `now()` con
`TimeZone=America/Bogota` y `orden_evento.created_at` va en UTC (5 h de diferencia). Es configuración local,
no de la 454.

## FALLOS

**FALLO-1 — El cierre no se puede aprobar desde la UI si trae una gestión de una orden sin guía.**
Es lo que bloqueó «Aprobar», el dinero, `rechazada→por_devolver*`, el tope y la medición de ~14
gestiones. No lo puedo atribuir con seguridad a la 454: dos de las tres filas son datos legados del seed.
Pero la tercera la creó en este recorrido una vía de la propia 454.
Pasos (base local):
1. Mensajero: en «Reparto», «Gestionar la orden 111136» → «Aceptar» → «Solicitar ayuda con la orden de
   Roger…» (la orden **no tiene guía**; el modal lo dice: «(sin guía asignada)») → motivo → «Solicitar ayuda».
2. Tienda: `/novedades` → «Reprogramar la orden de Roger Francisco Maradiaga paiz» → fecha, foto y
   motivo → «Reprogramar». Respuesta `{"status":"ok","resultado":"reprogramada"}`. La gestión entra en el
   cierre del mensajero como **retornable**.
3. Admin: `/cierres-admin` → «Ver / decidir» → «Aprobar» abre «Confirmar los paquetes que vuelven», y la fila
   dice «Nº Guía — · 111136 Reprogramada Pendiente … **Sin número de guía: no se puede confirmar. Avisá a
   un administrador.**»; «Continuar» queda deshabilitado (5 de 8 confirmadas). La guía de la fila sale de
   `cierre_detail`, congelada al crear el cierre, así que ponerle guía a la orden después no lo arregla.
   El único camino es rechazar, y el mensajero no puede sacar esa gestión de un cierre rechazado: no aparece
   «Devolver a gestión».
Pregunta abierta para el leader: ¿antes de la 454 se podía reprogramar desde la ayuda una orden sin guía?
Si sí, el fallo es anterior (feature 238). En cualquier caso, **con los datos locales la aprobación queda por
recorrer**. Para seguir hacen falta datos limpios (un mensajero con solo órdenes con guía) o permiso para
completar `cierre_detail.num_guia` en local.

### Observaciones (no son fallos de la 454)

- Tras gestionar, el toast dice «Orden QA-R-0015: Entregada.» mientras la orden sigue «En reparto». Es
  coherente con la nota, pero el leader decide si el texto debe decir «pendiente de confirmación».
- «Tenes ordenes sin gestionar; gestionalas antes de cerrar.» no lleva tildes (feature 37) y se queda
  puesto después del corte aunque lo único que queda son órdenes `sin_gestionar`.
- El dev log registra 4 «Hydration failed»: probablemente por la zona horaria del navegador de la sonda
  (Costa Rica) frente a la del servidor (Bogotá). No lo investigué.
- La hoja de historial tiene el botón de cierre con el texto «Close», en inglés (anterior a la 454).
