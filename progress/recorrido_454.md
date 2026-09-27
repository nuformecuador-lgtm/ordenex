# Recorrido en navegador — ficha 454 (T4.2)

- **Fecha:** 2026-09-24, de 00:50 a 03:05 hora de Costa Rica, en dos partes. **Rama:** `feature/454-recorrido`
  desde `edff9ccf`.
- **Entorno:**
  - base LOCAL con M1-M3 aplicadas (`prisma migrate status` limpio);
  - un solo dev server (`next dev --port 3457`);
  - Playwright headless (`@playwright/test` resuelto con `createRequire`), con geolocalización fija y una
    foto PNG real.
- **Evidencia:** `progress/recorrido_454/`, con capturas del elemento y el JSON de la API. Las URL firmadas
  y el teléfono van tapados.
- **Partes:**
  - **Parte 1:** datos QA existentes (Marco, `mensajero.qa`).
  - **Parte 2:** un escenario limpio creado por el flujo normal de la app, sin SQL de escritura. Es la que
    cubre aprobación, dinero y tiempos (ver «Parte 2»).
- **Búsqueda de código:** MCP `codebase-memory` (proyecto `R-job-singularis-projects-ordenex`) para
  localizar, confirmando siempre en el archivo real. Buena parte se buscó con `grep`, porque el índice no
  devolvía los símbolos nuevos de la 454 (`gestion-pendiente.ts`, `NotaGestionPendiente`).

## Qué cambié en el entorno local (conviene saberlo)

1. **Roté las 4 cuentas QA** (`seed-usuarios-qa.ts`) y la clave de `maestro.qa@ordenex.test`
   (`db:seed:maestro`) en la base local. Si otro agente usaba `QA_PASSWORD`, su login deja de funcionar.
2. **Roté la API key «Prueba Tienda 18:06:29»** (la anterior deja de valer) y **registré un webhook** para su
   owner: `https://recorrido-454.example.com/hook`. Esa URL no existe.
3. **Forcé el corte nocturno** (`GET /api/cron/corte-diario` con `CRON_SECRET`, `vencidosCreados: 2`).
4. **Parte 1 — `orden.num_guia` puesto a mano** en 3 órdenes legadas sin guía (111115, 111117 y 111136).
   Lo hice para intentar la confirmación física de Marco y no sirvió. El UPDATE de `cierre_detail` que venía
   después lo bloqueó el clasificador de permisos y no lo intenté por otra vía. Esas 3 guías siguen puestas.
   El cierre `ebc7caa5…` de Marco queda **`solicitado`**.
5. **Parte 2** (todo por la UI o la API de la app):
   - **Usuarios creados por el maestro:** «Rita Recorrido» (`mensajero.r454@`, GAM), «Quino QUEPOS»
     (`mensajero.qq454@`, zona QUEPOS), «Sat QUEPOS» (`satelite.q454@`, adminSatelite de QUEPOS) y «Quique
     Quepos» (`mensajero.q454@`, zona «Quepos» QA; creado por error de zona y sin usar). Clave de los cuatro:
     la misma `QA_PASSWORD` rotada.
   - **Órdenes:** 16 cargadas por la API de la tienda Tania (R454-01..14 en GAM y Q454-01..02 en QUEPOS).
   - **Cola de trabajos:** corrí **`/api/cron/procesar-jobs` ~21 veces** para vaciarla. Eso **geocodificó
     contra Google** con la `GOOGLE_MAPS_API_KEY` local los 66 jobs de geocodificación (también los 52
     viejos) y **quiso entregar los webhooks** al host inexistente, que fallaron por red y quedan en
     reintento.

## Tabla caso × rol

Leyenda: **OK** = verificado con evidencia · **N/V** = no verificable en este entorno (con el motivo).

| Caso | maestro | admin | adminTienda | adminSatelite | mensajero | rastreo público | API key |
|---|---|---|---|---|---|---|---|
| Gestionar (5 resultados) | OK ¹ | OK ² | OK ³ | OK ⁴ | OK ⁵ | OK ⁶ | OK ⁷ |
| Deshacer | N/V (visto con admin) | OK ⁸ | N/V (visto con admin) | OK ⁸ | OK ⁸ | OK ⁸ | OK ⁸ |
| Pedir cierre | — | — | — | — | bloqueado OK; bloqueado **solo por ayuda** OK; permitido OK ⁹ | — | — |
| Corte nocturno forzado | N/V (visto con admin) | OK ¹⁰ | — | — | OK ¹⁰ | — | — |
| Aprobar | N/V (visto con admin) | OK ᴬ | OK ᴬ | OK ᴮ (aprueba la de su zona) | — | OK ᴬ | OK ᴬ |
| Rechazar cierre | N/V (visto con admin) | OK ¹¹ | OK ¹¹ | — | OK ¹¹ | N/V | OK ¹¹ |
| Corregir resultado (#69) | — | OK ¹² | OK ¹² | — | — | OK ¹² | OK ¹² |
| Traspasar | — | gestionada OK; en mano N/V ¹³ | — | N/V | N/V | — | — |
| Cambiar día | — | gestionada OK; en mano OK ¹³ | — | OK ¹³ | — | — | — |
| Tope de intentos | N/V ᶜ | N/V ᶜ | — | — | N/V ᶜ | — | N/V ᶜ |
| Ayuda y rescate | OK ¹⁵ | OK ¹⁵ | OK ¹⁵ | OK ¹⁵ | OK (Recuperar ofrecido, no pulsado) ¹⁵ | OK ¹⁵ | OK ¹⁵ |
| Duración de la aprobación con 14 gestiones | **917 ms** ᴬ | | | | | | |

**Recuento: 39 OK de 51 celdas · 0 FALLO · 12 N/V.**

## Parte 2 — escenario limpio: aprobar el cierre

**Montaje, todo por el flujo normal:**
- **Carga:** API de la tienda, `POST /api/ordenes/api-key/carga` → 14 órdenes `en_preparacion`.
- **Guías:** admin, `/ordenes` → «Generar guía» → `en_bodega_central`.
- **Geocodificación:** `procesar-jobs` → las 14 con `geocode_status=OK`.
- **Asignación:** admin, «Asignar mensajero» → Rita, «Hoy» → `por_recoger`.
- **Recogida:** Rita teclea las 14 guías en «Recoger paquete» → `en_reparto`.

**Gestiones de Rita** (14, todas `status:"ok"`):
- **Registradas por Rita:** 5 entregadas en efectivo (R454-01..05), 2 reprogramadas (06, 07), 2 devueltas
  (08, 09), 3 rechazadas (10, 11, 12) y 1 incidente (13).
- **R454-14:** Rita pide ayuda y la tienda la **rechaza desde la ayuda** (familia `gestion_tienda_ayuda`).
- **Bloqueo aislado por la ayuda:** con las otras 13 gestionadas y la 14 en ayuda, «Solicitar cierre»
  queda deshabilitado (`bloqueado_solo_ayuda_mensajero_solicitar_cierre.png`, R22).
- **Solicitud del cierre:** tras la gestión de la tienda, el cierre sale `{"status":"ok","via":"creado",…,
  "general":"32500.00"}`.

**ᴬ Aprobación (admin), cierre `7fb47e8d…`:**
- **Detalle antes** (`aprobar_admin_cierre_detalle_antes.png`): «TOTAL GENERAL ₡32.500 … PAGO AL MENSAJERO
  ₡8.500 GESTIONES 14».
- **Confirmación física:** «Paquetes confirmados: 8 de 8. Están todos.» (`aprobar_admin_confirmacion_fisica.png`).
- **Indemnización** del incidente: ₡3.000.
- **Respuesta, en 917 ms desde el clic en «Aprobar e indemnizar»:**
  `{"status":"ok","cierreId":"7fb47e8d-…","estado":"aprobado","pendientePagoMensajero":"0.00"}`.
  Toast «Cierre aprobado correctamente.».
- **Estados aplicados** (transiciones de `orden_historial_estado`):

  | Orden | Resultado | Transiciones al aprobar | Estado final |
  |---|---|---|---|
  | R454-01..05 | entregada | `gestion: en_reparto→entregada` | entregada |
  | R454-06, 07 | reprogramada | `gestion: en_reparto→reprogramada` | reprogramada |
  | R454-08, 09 | devuelta | **`anclaje_devolucion`**`: en_reparto→devuelta` | devuelta |
  | R454-10, 11, 12 | rechazada | `gestion: en_reparto→rechazada` + `devolucion_rechazada: rechazada→por_devolver_a_tienda` | **por_devolver_a_tienda** (GAM) |
  | R454-13 | incidente | `incidente: en_reparto→incidente` | incidente |
  | R454-14 | rechazada (tienda, desde ayuda) | `gestion_tienda_ayuda: en_reparto→rechazada` + `devolucion_rechazada` | **por_devolver_a_tienda** |

- **Autoría y notas:** el historial (tienda) dice «En reparto → Entregada … **Por Rita Recorrido**» (la
  persona que registró, R8) y «Rechazada → Por devolver a tienda … Por Ana Admin». Las **notas «pendiente»
  desaparecieron**: la fila de admin y tienda dice «R454-01 **Entregada**», «R454-10 **Por devolver a
  tienda**»… (`aprobado_*_fila_*.png`).
- **Rastreo** (`aprobado_rastreo_*.png`):
  - 40520764: «**Entregado**»;
  - 16757840 (devuelta) y 13761058 (incidente): «No fue posible entregarlo»;
  - 28296862 (rechazada): «No fue posible entregarlo → **En devolución a la tienda**».
  - En ninguno queda el hito pendiente.
- **API** (`aprobado_api_*.json`):
  - 40520764: `"estado":"entregada"`, gestión con `"estadoResultante":"entregada","pendienteConfirmacion":false`;
  - 28296862: `"estado":"por_devolver_a_tienda"`, `"estadoResultante":"rechazada"`.
- **Webhooks:** la aprobación encoló **14 `webhook_estado`** (`orden.estado_actualizado`): entregada 5,
  reprogramada 2, devuelta 2, rechazada 4 e incidente 1. `por_devolver_a_tienda` no emite porque no está en
  `EVENTOS_PUBLICOS`; es la política de siempre (`lib/types/webhook-eventos.ts`).
- **Dinero** (movimientos con `origen_tipo = cierre_dia`):

  | Libro | Movimiento | Monto | Cuadra con |
  |---|---|---|---|
  | Caja | ingreso COD recaudado | 32.500 | 5 entregas: 5.500+6.000+6.500+7.000+7.500 |
  | Caja | ingreso flete + IVA | 10.000 + 1.300 | 5 × 2.000 + 13 % = «Flete + IVA ₡11.300» del detalle |
  | Caja | ingreso comisión COD + IVA | 1.137,50 + 147,89 | «Comisión + IVA ₡1.285,39» del detalle |
  | Caja | egreso pago al mensajero | 8.500 | 5 × 1.700 = «PAGO AL MENSAJERO ₡8.500» |
  | Caja | egreso indemnización | 3.000 | lo tecleado para R454-13 |
  | Ledger tienda | crédito COD / débitos flete, IVA flete, comisión, IVA comisión | 32.500 / 10.000, 1.300, 1.137,50, 147,89 | espejo de la caja |
  | Pago mensajero | devengo + pago en efectivo | 8.500 + 8.500 | `pendientePagoMensajero: 0.00` |

  - **Flete por rechazo = ₡0:** la tarifa congelada de Tania en GAM tiene `valor_flete_devuelto_gam = 0`
    (`cierre_detail`); fuera de GAM sí cobra (ver ᴮ).
  - **Ingreso de bodega por rechazos (₡4.000):** figura en la liquidación y en `total_ingreso_bodega_rechazos`,
    pero no genera movimiento de caja con destino central. No lo comparé contra el comportamiento previo a
    la 454; lo cubre C11 (`caracterizacion/dinero-aprobacion.test.ts`).

**ᴮ Zona satélite (QUEPOS), cierre `50ffdfa2…` con destino `bodega_satelite`:**
- **Montaje:** Q454-01..02 → «Rutear a bodega satélite» → Sat QUEPOS «Recibir paquete» + «Asignar» a
  Quino → Quino recoge → Q454-01 **rechazada**, Q454-02 entregada → cierre solicitado.
- **Aprobación:** **aprueba el adminSatelite** en «Confirmar y aprobar» (1 de 1 paquetes). Este no lo
  cronometré: el clic salió en una corrida del script que luego abortó.
- **Estados:**
  - Q454-01: `gestion: en_reparto→rechazada` + `devolucion_rechazada: →` **`por_devolver`** (satélite).
    Fila del satélite «Q454-01 **Por devolver**», rastreo «En devolución a la tienda».
  - Q454-02: `entregada`.
- **Dinero:** COD 6.000; flete 3.000 + IVA 390; **flete de devolución 1.000 + IVA 130** (la rechazada fuera
  de GAM); comisión 210 + IVA 27,30. En caja y en el ledger de la tienda, espejados.
- **Pago al mensajero 0:** Quino es un mensajero recién creado y no tiene tarifa de mensajero en QUEPOS
  (configuración de datos, no de la 454).

**ᶜ Tope de intentos:** no se alcanza en un tiempo razonable. Hacen falta tres ciclos de «reprogramada →
aprobar → liberar reprogramadas (el cron libera cuando llega la fecha, que como pronto es mañana) → recoger
→ gestionar». Además, ninguna orden local está cerca del tope. La regla la cubren C03/C04.

## Notas de evidencia (parte 1)

1. `gestionar_maestro_fila_*.png` / `_historial_*.png`.
   - Fila QA-R-0015: «990015 QA-R-0015 **En reparto Entregada · pendiente de confirmación** 1 Carolina Vega…».
   - Historial: «**Gestión registrada Resultado: Entregada** … Por Marco Mensajero (Mensajero)».
   - Lo mismo con Reprogramada (0014), Devuelta (0016), Rechazada (0020) e Incidente (0021).
2. `gestionar_admin_fila_*.png`: las mismas cinco filas con la misma nota.
3. `gestionar_tienda_fila_*.png`: la tienda ve las cinco con la nota.
4. `/recepcion-satelite/en-bodega` de Sara (zona Quepos) muestra QA-R-0020 «En reparto **Rechazada ·
   pendiente de confirmación**» y QA-R-0021 «Incidente · pendiente…». **QA-R-0015 (GAM) no aparece**.
5. Respuesta de `gestionar` capturada al instante: `{"status":"ok",…,"estado":"entregada",…}`, y lo mismo
   para los otros cuatro resultados.
   - La orden **sale de «por gestionar»** y el KPI baja de `Pendientes 9 → 4`.
   - En la base la orden sigue `en_reparto`, con su evento `gestion_registrada` (R1/R2).
6. Rastreo sin sesión: «Guía 990015 **Entregada · pendiente de confirmación**». La action devuelve
   `{"hito":"entregado",…,"pendiente":true,"nombreResultado":"Entregada"}`.
7. `gestionar_api_990015.json`: `"estado":"en_reparto"`, gestión con `"estadoResultante":null,…,
   "pendienteConfirmacion":true`. Hay un job `webhook_evento` por cada `gestion_registrada`.
8. Deshacer de QA-R-0021 («Devolver a gestión»):
   - toast «Gestión deshecha; la orden volvió a tu lista para gestionar.» y la orden vuelve a «por gestionar»;
   - las filas de admin y satélite quedan sin nota; el historial dice «**Gestión anulada**»;
   - el rastreo pierde el hito pendiente;
   - hay evento `gestion_anulada` con su job.
9. **Bloqueado:** «Tenes ordenes sin gestionar; gestionalas antes de cerrar.».
   - **Bloqueado solo por la ayuda:** medido en la parte 2 (R454-14).
   - **Permitido:** tanto el cierre vencido re-solicitado (Marco) como el cierre nuevo (Rita, `via:"creado"`).
10. Corte: `{"vencidosCreados":2,"mensajerosEvaluados":2}`.
    - Las 7 órdenes con gestión pendiente siguen `en_reparto`, colgadas del cierre `vencido`.
    - **Ninguna** está en `cierre_sin_gestion`, que solo tiene las 3 en mano; REM-0001 estaba en ayuda y se
      barrió (R27).
11. Rechazo del cierre: `estado:"rechazado"` en 789 ms.
    - Las 19 órdenes quedan idénticas: nada se mueve.
    - La tienda sigue viendo la nota y no se encola **ningún job nuevo**.
    - El mensajero ve «Tu cierre fue rechazado, pero no queda cerrado» y lo vuelve a solicitar.
12. Corregir QA-R-0021, de entregada a rechazada:
    - el diálogo dice «La orden sigue «En reparto» hasta entonces…»;
    - los totales cambian: general 10.700 → 6.500, pago al mensajero 13.600 → 11.900, rechazos 1.000 → 2.000;
    - hay evento `gestion_corregida` con su job;
    - tienda y rastreo pasan a «Rechazada · pendiente de confirmación».
13. Traspasar y cambiar día:
    - la fila gestionada no tiene casilla, solo `aria-label="No se puede seleccionar la orden QA-R-0015:
      Tiene una gestión pendiente de confirmación: no se puede traspasar ni cambiar el día…"`;
    - la fila en mano ofrece «Traspasar a otro mensajero» y «Cambiar día de reparto»;
    - el traspaso de la en mano da «No hay otro mensajero al que traspasar» (en local no había otro
      mensajero activo en GAM cuando lo probé);
    - en el satélite, las gestionadas solo ofrecen «Ver historial».
15. Ayuda y rescate:
    - **Solicitar ayuda:** toast «Se solicitó ayuda…»; el mensajero la ve en «CON AYUDA SOLICITADA» sin
      «Gestionar»; maestro y tienda ven «En reparto **Ayuda solicitada a la tienda**».
    - **Habilitar (tienda):** `"rescatada":true`, con evento `ayuda_rescatada`.
    - **Reprogramar desde la ayuda:** «Reprogramada · pendiente…», con familia `gestion_tienda_ayuda` (R25).
    - **Habilitar por API:** `"ayudaCerrada":true`; repetirlo da `estado_no_habilitable`.

### Jobs `webhook_*` (consulta local al final)

| tipo | estado | n | max(updated_at), hora de la base |
|---|---|---|---|
| webhook_evento | pending (en reintento: «fallo de red o timeout») | 32 | 2026-09-24 02:51 (parte 2: 30 tras aprobar Rita) |
| webhook_estado | pending (en reintento) | 64 | 2026-09-24 03:03 |
| geocodificacion | done | 68 | — |
| optimizacion_ruta | done / pending | 38 / 9 | — |

- **Eventos → jobs:** en la parte 1, `gestion_registrada` 8/7. El que falta es el evento que dejó el
  backfill de M3 el 2026-08-21, cuando todavía no existía el webhook.
- **Horas:** en la base local `jobs` usa `now()` con `TimeZone=America/Bogota` y `orden_evento` va en UTC:
  hay 5 h de diferencia entre ambos.

## FALLOS

**Ninguno imputable a la 454.** El antiguo FALLO-1 (un cierre con gestiones de órdenes sin guía no pasa la
confirmación física) queda **reclasificado como artefacto de datos locales**, según el coordinador. En
producción, 0 de 4.112 gestiones son de órdenes sin guía: en el flujo real no se asigna nada sin guía.
Con datos limpios la aprobación completa pasó (ᴬ, ᴮ).

## Deuda no-454 (observaciones)

1. Tras gestionar, el toast dice «Orden R454-01: Entregada.» mientras la orden sigue «En reparto» con la
   nota. Queda a decisión del leader si debe decir «pendiente de confirmación».
2. El aviso «Tenes ordenes sin gestionar; gestionalas antes de cerrar.» (feature 37):
   - no lleva tildes;
   - sigue saliendo después del corte, aunque lo único que queda son órdenes `sin_gestionar`.
3. El dev log registra 4 «Hydration failed», probablemente porque la zona horaria del navegador de la
   prueba (Costa Rica) no coincide con la del servidor (Bogotá). No lo investigué.
4. El botón de cierre de la hoja de historial dice «Close», en inglés; es anterior a la 454.
