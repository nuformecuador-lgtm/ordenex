# Ficha 474 — Envíos automáticos por WhatsApp — bitácora de implementación (BACKEND)

> Alcance de este agente (backend_dev): F0–F9 de `tasks.md`. F10 (pantallas) es de frontend_dev, con
> el contrato de abajo. T11.2 (`gh pr checks`), T11.3 (nota de release) y T11.4 (recorrido contra la
> API real de Meta, exige despliegue) quedan para el cierre.

## T0.1 — Arranque

- **SHA de partida:** `9a9e37a8` (`origin/dev`, «docs(474): spec aprobado con D1-D4»). Rama
  `feature/474-envios-automaticos-whatsapp` creada con `git checkout -B … origin/dev`;
  `git merge-base --is-ancestor 9a9e37a8 HEAD` → OK.
- **Base propia:** clon `ordenex_474` (`CREATE DATABASE ordenex_474 TEMPLATE ordenex`), `.env` del
  worktree copiado del principal cambiando SOLO el nombre de la base (gitignorado, sin imprimir la
  credencial). `prisma migrate status` → «Database schema is up to date!» antes de migrar. La base
  local compartida `ordenex` NO se tocó.
- **`node_modules` propio** (`pnpm install --frozen-lockfile`, no junction): `prisma generate` de esta
  rama no pisa el cliente del árbol principal ni el de la 473.

### `job_tipo` en `origin/dev` @ 9a9e37a8 (11 valores, en orden)

`liberar_reprogramadas`, `geocodificacion`, `optimizacion_ruta`, `webhook_estado`,
`whatsapp_template_sync`, `whatsapp_chat_envio`, `analitica_rollup_diario`,
`analitica_invalidacion_cache`, `whatsapp_bienvenida`, `push_web`, `webhook_evento`.

### `NotificacionEvento` en `origin/dev` @ 9a9e37a8 (18 valores)

`orden_rechazada`, `carga_masiva_terminada`, `postulacion_mensajero_pendiente`,
`cierre_dia_por_aprobar`, `postulacion_recurso_pendiente`, `dia_reparto_corregido`,
`cierre_dia_vencido`, `mensajero_bloqueado_por_cierres`, `gasto_fijo_cobro_pendiente`,
`webhook_suscripcion_pausada`, `geocodificacion_caida`, `novedades_sin_gestionar`,
`devoluciones_represadas`, `cierre_dia_rechazado`, `reparto_manana`, `traspaso_ordenes_recibido`,
`traspaso_ordenes_cedido`, `reprogramadas_esperan_cierre`. Los mismos 18 de design §2.2: ningún
evento nuevo que declarar.

## F1 — Base de datos

| Migración | Qué |
| --- | --- |
| `20261005120000_job_tipo_whatsapp_envios` | 5 valores de `job_tipo`. `down.sql` recrea el tipo con los 11 de arriba (foto, índice parcial de la 401 incluido). |
| `20261005120100_whatsapp_envios` | 4 enums, 4 tablas, 2 columnas + 2 CHECKs en `plantilla_mensaje`, 9 índices parciales, CHECKs de forma, RLS sin policies. |
| `20261005120200_seed_whatsapp_envio_mantenimiento` | Siembra el job recurrente (próxima 09:30 UTC). `down.sql` borra las filas de ese tipo. |

Medido en `ordenex_474`:

- `prisma migrate deploy` de las tres → OK.
- `prisma migrate diff --from-config-datasource --to-schema db/schema.prisma` → «This is an empty migration».
- Los tres `down.sql` en orden inverso → OK; tras ellos `job_tipo` vuelve a los 11 valores, 0 tipos
  `whatsapp_e*`, 0 columnas nuevas en `plantilla_mensaje`, el índice parcial de la 401 existe.
- Re-deploy → OK y diff vacío otra vez (repetido tras renombrar dos estados de entrega, ver desvíos).
- Siembra: 1 fila `pending` (`run_after 2026-10-06 09:30`, `dedupe_key whatsapp_envio_mantenimiento:2026-10-06`);
  re-ejecutar el `INSERT` a mano → sigue habiendo 1. Lo mide además
  `tests/integration/db/siembra-whatsapp-envio-mantenimiento-idempotente.test.ts` (migración + script +
  recurrencia → UNA fila).
- T2.6: quitar `novedades_sin_gestionar` de `EVENTOS_ENVIO_WHATSAPP` → `tsc` rojo
  (`TS1360 … does not satisfy the expected type 'Record<NotificacionEvento, PerfilEventoEnvio>'`);
  restaurado → `tsc` verde.

## Contrato para frontend_dev (F10)

**Regla:** las pantallas consumen SOLO `lib/actions/envios-whatsapp.ts`, `lib/actions/plantillas.ts` y
los tipos de `lib/types/envios-whatsapp.ts` / `lib/types/plantilla-mensaje.ts`. NO importar
`lib/whatsapp-envios/informes/catalogo.ts` en un componente cliente: arrastra `jspdf` y `emitir.ts`.
Las variables por informe (picker, vista previa, «De dónde sale cada dato») vienen en
`listarInformesWhatsapp()` → `informes[].variables` (ya incluye la común `destinatario_nombre`).

Las 16 actions nuevas llevan `/** @sin-superficie FICHA 474 … */` (guardia `superficie-de-uso`): al
importarlas desde la página, la guardia exige **retirar** la anotación (si no, sale roja por
«anotación que sobrevive a su motivo»).

### `lib/actions/envios-whatsapp.ts` (todas: sesión → zod → `forbidden` si no es maestro)

| Action | Entrada | Resultado (`lib/types/envios-whatsapp.ts`) | R |
| --- | --- | --- | --- |
| `listarEnvios()` | — | `ListarEnviosResult` → `items: EnvioListItemDTO[]` | R11/R15/R25/R42 |
| `obtenerEnvio(id)` | `string` | `ObtenerEnvioResult` → `envio: EnvioDetalleDTO` | R11 |
| `crearEnvio(input)` | `GuardarEnvioInput` | `GuardarEnvioResult` (`ok` / `validation_error` por campo / `conflict:nombre`) | R11-R16 |
| `actualizarEnvio(id, input)` | `string`, `GuardarEnvioInput` | `GuardarEnvioResult` | R11-R16, R20 |
| `encenderEnvio(id)` | `string` | `EncenderEnvioResult` (`no_encendible` con `motivos[]`) | R18, R22 |
| `apagarEnvio(id)` | `string` | `ApagarEnvioResult` | R19 |
| `reprogramarEnvio(id)` | `string` | `ReprogramarEnvioResult` (botón «Reprogramar» del aviso) | R25 |
| `borrarEnvio(id)` | `string` | `BorrarEnvioResult` | R21 |
| `previsualizarDestinatarios(sel)` | `{ roles, usuarioIds }` | `PreviewDestinatariosDTO` (avisos, `excedeTope`, teléfono enmascarado) — NO escribe | R17, R16 |
| `listarEventosDisponibles()` | — | `eventos: { clave, nombre, descripcion }[]` (los 10) | R14, R49 |
| `listarInformesWhatsapp()` | — | `informes: InformeResumen[]` (`parametrosPorDefecto`, `descriptores`, `variables`, `eventos`, `generaDocumento`, `aptoParaAdminTienda`, `soloPorEvento`) | R4, R13, R14, R53 |
| `probarEnvioWhatsapp(id)` | `string` | `ProbarEnvioResultado`: `ok` (estado, motivo, entrega) / `telefono_invalido` / `demasiado_pronto` (`segundosRestantes`) | R39-R41, R52 |
| `listarEjecuciones(f)` | `{ envioId?, page?, pageSize? }` | `items: EjecucionItemDTO[]` (conteos por estado, `pdf: { nombre, caducado } \| null`) + paginación | R42, R44 |
| `obtenerEjecucion(id)` | `string` | `ejecucion` + `entregas: EntregaDetalleDTO[]` (`telefonoEnmascarado`) | R42 |
| `firmarPdfEjecucion(id)` | `string` | `ok: url` (300 s) / `caducado` / `sin_pdf` | R43, R44 |

`GuardarEnvioInput` = `{ nombre, informeClave, plantillaId, parametros, disparo: "hora_fija"|"evento",
diasSemana: number[] (ISO 1=lun…7=dom), hora: "HH:mm"|null, eventoClave: string|null,
destinatarios: { roles: RolValue[], usuarioIds: string[] } }`. Los `fieldErrors` usan esas claves
(`parametros.<campo>` para R13; `destinatarios` para R16; `disparo` cuando el informe es solo por evento).

`EnvioListItemDTO.activo` es el interruptor (columna `activo`). `proximaEjecucion` / `avisoSinProxima`
pintan R25. `eventoNombre` es el nombre en español claro (R49).

Estados de ejecución: `pendiente`, `generando`, `enviando`, `completada`, `vacia` («Sin novedades»),
`sin_destinatarios`, `omitida`, `error`. Estados de entrega: `pendiente`, `en_curso` (si se queda así
es **«Resultado desconocido»**, R37), `aceptada`, `enviada`, `recibida`, `leida`, `rechazo_permanente`,
`fallida`, `telefono_invalido`.

### `lib/actions/plantillas.ts` (cambios)

- `crearPlantilla` / `actualizarPlantilla`: aceptan `informeClave?: string | null` y `llevaDocumento?: boolean`
  (omitidos al editar = no se tocan). Errores por campo `informeClave` / `llevaDocumento` (R3, R6, R7).
- `cambiarEstadoPlantilla` / `eliminarPlantilla`: nuevo resultado `{ status: "en_uso", envios: string[] }` (R10).
- `enviarPlantillaAprobacion`: nuevo resultado `{ status: "documento_no_disponible", mensaje, codigo? }` (R9).
- `marcarPlantillaBienvenida`: `no_aplica` también para plantillas de informe (R8).
- **Nueva** `estadoAppMeta()` → `{ status: "ok", estado: "identificada" }` o
  `{ status: "ok", estado: "no_identificada", mensaje }` (R48). Llamarla al activar «Lleva documento adjunto».
- `PlantillaListItem` / `PlantillaPublica` llevan `informeClave` y `llevaDocumento` (siempre rellenos por el repo).

## Mapa R → test

Rutas bajo `tests/`. «int» = `tests/integration/db/` contra Postgres (`ordenex_474`). Lo de pantalla
(R2 menú; la parte visual de R1, R4, R17, R25, R42, R48, R49) es de frontend_dev.

| R | Test(s) |
| --- | --- |
| R1 | `unit/services/whatsapp-envio-service.test.ts` (admin/mensajero/adminTienda: forbidden en los 11 métodos sin tocar repo ni cola); `unit/actions/envios-whatsapp-actions.test.ts` (unauthenticated antes de todo; forbidden); `unit/services/ejecucion-envio-prueba.test.ts`; `unit/actions/estado-app-meta.test.ts` |
| R2 | frontend (T10.2) |
| R3 | `unit/services/plantilla-mensaje-informe.test.ts`; int `plantilla-mensaje-informe-checks.test.ts` |
| R4 | `unit/whatsapp-envios/catalogo-de-variables.test.ts`; `unit/services/whatsapp-template-port-documento.test.ts` (ejemplos del informe a Meta) |
| R5 | `unit/utils/whatsapp-template-documento.test.ts`; `unit/services/whatsapp-template-port-documento.test.ts`; `unit/clients/whatsapp-subida-reanudable.test.ts` |
| R6 | `unit/services/plantilla-mensaje-informe.test.ts`; int `plantilla-mensaje-informe-checks.test.ts` |
| R7 | `unit/services/plantilla-mensaje-informe.test.ts` |
| R8 | int `plantilla-enviables-excluye-informe.test.ts` (los tres lectores); `unit/services/plantilla-bienvenida-informe.test.ts` |
| R9 | `unit/services/plantilla-enviar-aprobacion-sin-app-id.test.ts` |
| R10 | `unit/services/plantilla-mensaje-informe.test.ts`; `unit/actions/plantillas-composition-root-474.test.ts` |
| R11 | `unit/services/whatsapp-envio-service.test.ts`; int `whatsapp-envio-defaults.test.ts` (único entre vigentes) |
| R12 | `unit/services/whatsapp-envio-service.test.ts`; int `plantilla-enviables-excluye-informe.test.ts` (`findEnviableDeInformeById`) |
| R13 | `unit/services/whatsapp-envio-service.test.ts` (error por campo, defaults) |
| R14 | `unit/services/whatsapp-envio-service.test.ts` (no disponible / no ofrecido / ok / solo por evento) |
| R15 | `unit/services/whatsapp-envio-service.test.ts`; int `whatsapp-envio-defaults.test.ts`; int `whatsapp-envios-migration.test.ts` |
| R16 | `unit/services/whatsapp-envio-service.test.ts` (adminTienda sí, apiKey no, tope 50, **enmienda: informe no apto + adminTienda ⇒ rechazo**, por rol y por usuario); int `whatsapp-envio-resolver-destinatarios.test.ts` |
| R17 | `unit/services/previsualizar-destinatarios.test.ts`; int `whatsapp-envio-resolver-destinatarios.test.ts` |
| R18 | `unit/services/whatsapp-envio-service.test.ts` (plantilla, parámetros, sin teléfono válido) |
| R19 | `unit/services/jobs/whatsapp-envio-handlers.test.ts` (programado apagado; evento sin encendidos); int `whatsapp-envio-idempotencia-evento.test.ts` (apagado ⇒ 0); `unit/services/ejecucion-envio-service.test.ts` (omitida al ejecutar) |
| R20 | `unit/services/whatsapp-envio-service.test.ts`; `unit/services/jobs/whatsapp-envio-handlers.test.ts` (obsoleto); `unit/whatsapp-envios/proxima-ocurrencia.test.ts` |
| R21 | `unit/services/jobs/whatsapp-envio-handlers.test.ts` (borrado); int `whatsapp-envio-defaults.test.ts` |
| R22 | `unit/whatsapp-envios/proxima-ocurrencia.test.ts`; `unit/api/procesar-jobs-registro-envios.test.ts`; `unit/services/jobs/whatsapp-envio-handlers.test.ts` |
| R23 | int `whatsapp-envio-idempotencia-programado.test.ts` (dos conexiones concurrentes ⇒ 1 ejecución, 1 entrega por usuario; prueba no consume cupo) |
| R24 | `unit/services/jobs/whatsapp-envio-handlers.test.ts` (61 min ⇒ omitida; 59 ⇒ ejecuta); int `whatsapp-envio-idempotencia-programado.test.ts` (omitida ocupa el día) |
| R25 | `unit/services/jobs/whatsapp-envio-handlers.test.ts` (mantenimiento); int `whatsapp-envio-cadena-rota.test.ts`; `unit/services/whatsapp-envio-service.test.ts` (próxima / aviso, descarta obsoletos) |
| R26 | int `whatsapp-envio-puente-aviso.test.ts` (binding REAL `notificarGeocodificacionCaidaReal`: encendido ⇒ 1 job; re-emitir ⇒ 1; apagado ⇒ 0); `unit/notificaciones/notificacion-repo-con-envios-whatsapp.test.ts`; `unit/guards/envios-whatsapp-cableado.guardia.test.ts` |
| R27 | int `whatsapp-envio-idempotencia-evento.test.ts` (handler real ×2 ⇒ 1 por envío; dos envíos ⇒ 2); `unit/services/jobs/whatsapp-envio-handlers.test.ts` |
| R28 | int `whatsapp-envio-resolver-destinatarios.test.ts`; `unit/services/ejecucion-envio-service.test.ts` |
| R29 | `unit/services/ejecucion-envio-service.test.ts`; `unit/whatsapp-envios/telefono.test.ts` |
| R30 | `unit/services/ejecucion-envio-service.test.ts` (sin generar el informe) |
| R31 | `unit/services/ejecucion-envio-service.test.ts`; `unit/whatsapp-envios/informe-prueba-envio.test.ts` |
| R32 | `unit/services/ejecucion-envio-service.test.ts` (variable faltante, orden, saneado); `unit/whatsapp-envios/sanear-valor.test.ts` |
| R33 | `unit/services/ejecucion-envio-service.test.ts` (un PDF, una subida, cabecera a todos); `unit/utils/whatsapp-template-documento.test.ts` |
| R34 | `unit/services/ejecucion-envio-service.test.ts` |
| R35 | `unit/services/ejecucion-envio-service.test.ts` (reintento reutiliza y no regenera) |
| R36 | `unit/services/ejecucion-envio-service.test.ts` (aceptada / rechazo_permanente / transitorio + reintento; reintentar 5/5 ⇒ fallida); `unit/services/jobs/whatsapp-envio-handlers.test.ts`; int `whatsapp-envio-entrega-reclamo.test.ts` |
| R37 | `unit/services/ejecucion-envio-service.test.ts` (excepción ⇒ en_curso, nunca reenvía); int `whatsapp-envio-entrega-reclamo.test.ts` |
| R38 | int `whatsapp-envio-entrega-estado-webhook.test.ts` (no retrocede); `unit/services/entrega-estado-service.test.ts`; `unit/api/webhook-whatsapp-entregas.test.ts` (cableado + 200 aunque falle) |
| R39 | `unit/services/ejecucion-envio-prueba.test.ts`; `unit/actions/envios-whatsapp-actions.test.ts` |
| R40 | `unit/services/ejecucion-envio-prueba.test.ts` |
| R41 | `unit/services/ejecucion-envio-prueba.test.ts`; int `whatsapp-envio-prueba-limite.test.ts` |
| R42 | int `whatsapp-envio-historial.test.ts` (orden, filtro, conteos, teléfono enmascarado) |
| R43 | `unit/storage/supabase-almacen-envios-whatsapp.test.ts`; `unit/actions/envios-whatsapp-actions.test.ts`; int `whatsapp-envio-historial.test.ts` (`pdfDe`) |
| R44 | int `whatsapp-envio-purga-seleccion.test.ts`; `unit/services/jobs/whatsapp-envio-handlers.test.ts`; `unit/actions/envios-whatsapp-actions.test.ts` (caducado) |
| R45 | `unit/whatsapp-envios/motivo-meta.test.ts`; `unit/services/ejecucion-envio-sin-pii.test.ts`; `unit/clients/whatsapp-app-id.test.ts`; `unit/clients/whatsapp-subida-reanudable.test.ts`; `unit/services/entrega-estado-service.test.ts` |
| R46 | `unit/whatsapp-envios/catalogo-informes.test.ts` |
| R47 | `unit/whatsapp-envios/informe-prueba-envio.test.ts` |
| R48 | `unit/clients/whatsapp-app-id.test.ts`; `unit/actions/estado-app-meta.test.ts` (UI del aviso: frontend T10.1) |
| R49 | `unit/whatsapp-envios/eventos-envio.test.ts` (+ typecheck, medido en T2.6); `unit/actions/envios-whatsapp-actions.test.ts` |
| R50 | `unit/notificaciones/notificacion-repo-con-envios-whatsapp.test.ts`; `unit/whatsapp-envios/fila-puenteable.test.ts`; `unit/guards/envios-whatsapp-cableado.guardia.test.ts` |
| R51 | `unit/whatsapp-envios/informe-aviso-interno.test.ts`; `unit/notificaciones/notificacion-repo-con-envios-whatsapp.test.ts`; int `whatsapp-envio-puente-aviso.test.ts` (claves del payload) |
| R52 | `unit/whatsapp-envios/informe-aviso-interno.test.ts`; `unit/services/ejecucion-envio-prueba.test.ts` |
| R53 | `unit/services/ejecucion-envio-service.test.ts`; `unit/whatsapp-envios/catalogo-de-variables.test.ts`; `unit/services/ejecucion-envio-prueba.test.ts` |

## Mutaciones (medidas)

Medidas el 2026-10-05 contra `ordenex_474`, con un arnés de un solo uso (fuera del árbol) que por cada
mutación: (1) corre el test SIN mutar y exige verde, (2) aplica la mutación y comprueba que el
archivo cambió, (3) corre el test, (4) restaura el contenido ORIGINAL y comprueba el revert. Tras la
corrida, `git status` limpio (solo esta bitácora).

**Autocomprobación que falló, y se midió a mano:** la mutación M1 es SQL y el arnés la reportó
«aplicada» y SUPERVIVIENTE. No se había aplicado: desde Python en Windows, `bash` resuelve a otro
intérprete que no ve las rutas de Git Bash, y el arnés marcaba `aplicada=True` sin comprobarlo
(memoria «arnés de mutaciones que miente»). Se repitió A MANO: índice recreado sin predicado →
`pg_indexes` lo confirma → el test sale ROJO (1 failed | 9 passed) → índice restaurado →
`pg_indexes` con su `WHERE`, test verde (10 passed) y `prisma migrate diff` vacío.

| # | Mutación | Test que la mata | Base | Mutado | Veredicto |
| --- | --- | --- | --- | --- | --- |
| M1 | índice `whatsapp_envio_ejecucion_programado_key` SIN `WHERE origen='programado'` (T1.5) | int `whatsapp-envios-migration` | 10 passed | **1 failed** \| 9 passed (a mano) | MATADA |
| M2 | `listarEnviables` sin `informeClave: null` (T5.2/R8) | int `plantilla-enviables-excluye-informe` | 5 passed | 1 failed | MATADA |
| M3 | `findEnviableById` sin `informeClave: null` (T5.2/R8) | int `plantilla-enviables-excluye-informe` | 5 passed | 1 failed | MATADA |
| M4 | `resolverDestinatariosDe` sin `estado: "activo"` (T6.1/R28) | int `whatsapp-envio-resolver-destinatarios` | 4 passed | 1 failed | MATADA |
| M5 | `resolverDestinatariosDe` sin filtro de roles permitidos (R16/R28) | int `whatsapp-envio-resolver-destinatarios` | 4 passed | 2 failed | MATADA |
| M6 | cadena rota sin `j.estado = 'pending'` (T6.1/R25) | int `whatsapp-envio-cadena-rota` | 1 passed | 1 failed | MATADA |
| M7 | `insertarProgramada` sin `ON CONFLICT` (R23) | int `whatsapp-envio-idempotencia-programado` | 4 passed | 2 failed | MATADA |
| M8 | `insertarEntregas` sin `ON CONFLICT` (R23) | int `whatsapp-envio-idempotencia-programado` | 4 passed | 1 failed | MATADA |
| M9 | referencia del evento = id de la notificación (alternativa J, R27) | int `whatsapp-envio-idempotencia-evento` | 2 passed | 1 failed | MATADA |
| M10 | `encendidosConEvento` sin `activo` (R19) | int `whatsapp-envio-idempotencia-evento` | 2 passed | 1 failed | MATADA |
| M11 | reclamo sin `estado = 'pendiente'` (R37) | int `whatsapp-envio-entrega-reclamo` | 4 passed | 2 failed | MATADA |
| M12 | webhook sin rango (puede retroceder, R38) | int `whatsapp-envio-entrega-estado-webhook` | 4 passed | 2 failed | MATADA |
| M13 | historial devuelve el teléfono completo (R42) | int `whatsapp-envio-historial` | 2 passed | 1 failed | MATADA |
| M14 | historial en orden ascendente (R42) | int `whatsapp-envio-historial` | 2 passed | 1 failed | MATADA |
| M15 | última prueba sin `solicitadaPor` (R41) | int `whatsapp-envio-prueba-limite` | 1 passed | 1 failed | MATADA |
| M16 | purga sin `pdf_purgado_at IS NULL` (R44) | int `whatsapp-envio-purga-seleccion` | 1 passed | 1 failed | MATADA |
| M17 | **`repoReal()` sin `conEnviosWhatsapp`** (obligatoria §10/R26) | int `whatsapp-envio-puente-aviso` | 2 passed | 1 failed | MATADA |
| M18 | **`hayEncendidosConEvento` sin `activo`** (obligatoria §10/R26) | int `whatsapp-envio-puente-aviso` | 2 passed | 1 failed | MATADA |
| M19 | `buildPlantillaService` sin `envios:` (T5.3) | `unit/actions/plantillas-composition-root-474` | 6 passed | 1 failed | MATADA |
| M20 | `repoReal()` sin `conEnviosWhatsapp` (guardia estática) | `unit/guards/envios-whatsapp-cableado.guardia` | 5 passed | 2 failed | MATADA |
| T2.6 | quitar una entrada de `EVENTOS_ENVIO_WHATSAPP` | `tsc --noEmit` | 0 errores | TS1360 | MATADA |

20/20 + T2.6 matadas; ninguna superviviente.

## Desvíos del spec y decisiones técnicas

Ninguno cambia un requisito; todos están en el código con su porqué. Para que el revisor los mire:

1. **`activo` → campo Prisma `encendido` (`@map("activo")`).** La columna en la base se llama
   `activo`, como dice design §1.2 (índices parciales y CHECKs intactos). En TS el campo es
   `encendido` porque la guardia 374 (`geografia-predicado-unico`) prohíbe el literal
   `activo: true/false` en `lib/` fuera de `geografia-activa.ts`. Los DTOs de pantalla siguen
   exponiendo `activo`.
2. **Dos estados de entrega renombrados:** `entregada` → `recibida` y `rechazada` →
   `rechazo_permanente`. La guardia 455 (`censo-order-status-rename`) prohíbe esos dos literales:
   son códigos RETIRADOS de `order_status`. Semántica idéntica a design §1.5 / §5.4.
3. **`push-cableado-unico.guardia` tocada en UNA aserción.** El spec pedía dejarla intacta, pero
   exigía el literal `return conPushWeb(` en `repoReal()`, incompatible con envolverlo por fuera
   (design §4.2). Ahora acepta `return conEnviosWhatsapp(conPushWeb(`; el resto de la guardia
   (censo, una sola construcción, bindings) sin cambios, y la nueva `envios-whatsapp-cableado` la amplía.
4. **Siembra del mantenimiento también en `SIEMBRAS_RECURRENTES`** (`scripts/seed-jobs-whatsapp-envio-mantenimiento.ts`),
   porque la guardia 313 exige registrar todo recurrente ahí (`migrate-deploy` la re-siembra en cada
   despliegue). Misma `dedupe_key` que la migración: probado que juntas dejan UNA fila.
5. **`soloPorEvento` en el contrato de informe** (design §2.3 decía «el service ya lo impide» sin decir
   cómo): `aviso_interno` lo declara y el service rechaza guardarlo a hora fija (`disparo`).
6. **Enmienda R16 (adminTienda):** campo `aptoParaAdminTienda` en el contrato. `aviso_interno` = no
   apto; `prueba_envio` = apto (solo fecha y hora, sin datos de tiendas). Se rechaza si se elige el
   ROL `adminTienda` (aunque hoy no resuelva usuarios activos) o un USUARIO con ese rol: más estricto
   que «entre los resueltos», a propósito.
7. **Timestamps `TIMESTAMP(3)`** (convención del repo / Prisma), no `timestamptz` como escribe §1.4.
8. **CHECK del disparo `evento`:** acepta `dias_semana` NULL o `{}` (Prisma puede escribir cualquiera
   de las dos para una lista omitida).
9. **`ILectorPlantillaDeInforme`** es una interfaz aparte (no un método más de
   `IPlantillaMensajeRepository`) y `informeClave`/`llevaDocumento` son opcionales en
   `PlantillaPublica`/`PlantillaListItem`: así las suites existentes de plantillas no se tocan
   (331 tests verdes sin cambios). El repositorio siempre los rellena.
10. **Al ejecutar, un envío apagado/borrado** entre la creación de su ejecución y su turno → ejecución
    `omitida` con motivo (R19; el design no fijaba el estado).
11. **«Probar ahora» en línea:** un fallo transitorio al subir el PDF deja la prueba en `error`
    visible (no hay cola que la reintente); un transitorio al enviar sí encola el reintento de la
    entrega.
12. **Sin credencial de WhatsApp:** la ejecución queda `error` «WhatsApp no está configurado (falta X)»
    Y el job lanza (queda en `last_error`); los reintentos ven el estado terminal y no hacen nada.
13. **PDF ya guardado** (corrida que murió entre guardar y fijar): error tipado `PdfYaGuardadoError`
    → se reutiliza la ruta, nunca se sobrescribe (R43).
14. **`whatsapp-subida-reanudable` usa `TIMEOUT_SUBIDA_MS`** (la guardia R47 de analítica prohíbe el
    literal `20_000` fuera de su constante).
15. **Censos ampliados** (la lista crece con cada ficha, no se relaja): `orden-traspaso-migration`
    (migraciones posteriores), fixture `api-key-dependencias-usuario` (5 relaciones nuevas hacia
    `usuario`, todas `no_alcanzable` con motivo), `jobs-handler-por-tipo`, `jobs-recurrentes-con-siembra`,
    `procesar-jobs-registro`, `jobs-registro`. Y un comentario del schema sin la palabra «campana»
    (guardia `no-migration-102`).
16. **16 actions con `@sin-superficie`** hasta que frontend_dev las conecte (ver contrato).

**No hecho por este agente (fuera de su alcance o dependiente de despliegue):** F10 (pantallas, menú),
T11.2 (`gh pr checks`), T11.3 (nota de release), T11.4 (recorrido contra la API real de Meta:
`GET /app` y la subida reanudable NUNCA se han ejecutado contra Meta; están probados con `fetch` doble).

## Gate

`./init.sh` COMPLETO (la ficha toca migraciones y `db/schema.prisma`), en el worktree, con su `.env`
apuntando a `ordenex_474`. Log íntegro en `progress/gate_474_backend.log`, con `INIT_EXIT` dentro.

Salida real (corrida 3, SHA `3f6a512c`):

```
✓ dependencias: 58 declaradas, todas presentes
✓ feature_list.json: sin ids duplicados (471 fichas), cupo por zona respetado (in_progress=2) y specs en su sitio
✓ typecheck paso                       (pnpm run typecheck → tsc --noEmit, 0 errores)
✖ 235 problems (0 errors, 235 warnings)
✓ lint paso
 Test Files  2437 passed (2437)
      Tests  33432 passed | 26 skipped (33458)
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 2437 ejecutado(s), todos en el baseline conocido)
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at   (ajenas, previas)
✓ .env presente
== init OK ==
INIT_EXIT=0
```

**`skipped`:** los 26 son de `tests/components/AnaliticaPage.test.tsx` (17) y
`tests/components/AnaliticaShell.test.tsx` (9). NINGÚN archivo de `tests/integration/db` se saltó (no
aparece el aviso «sin DATABASE_URL»); los 446 resultados de `integration/db` corrieron contra el clon.

**Las dos corridas rojas anteriores, y por qué:**

1. Corrida 1 (`INIT_EXIT=1`): `tests/integration/api/procesar-jobs-geocodificacion.test.ts` y
   `procesar-jobs-webhook-estado.test.ts` — censos EXACTOS de handlers/recurrencias que no incluían los
   cinco tipos nuevos. Míos: ampliados (commit `7e3b5018`).
2. Corrida 2 (`INIT_EXIT=1`): `tests/integration/db/cierre-bloqueo-nv-sql-real.test.ts`, FK
   `cierre_dia_mensajero_id_fkey`. Aislado: verde. Causa probable y eliminada: su `beforeAll` toma
   `usuario.findMany({ take: 3 })` sin orden, y mi test de R23 commiteaba dos usuarios y los borraba en
   `afterAll`; si los elegía, su FK reventaba. El test de R23 usa ahora usuarios QUE YA EXISTEN y solo
   commitea/borra filas de tablas de la 474 (commit `3f6a512c`; M7/M8 re-medidas: siguen MATADAS).
3. Corrida 3: verde (arriba).

**Veredicto:** backend de la 474 (F0–F9) implementado, 53 R con test (los de pantalla, en frontend),
20/20 mutaciones obligatorias y propias MATADAS, gate completo verde contra base propia.

---

# FRONTEND (frontend_dev, F10 — T10.1/T10.2/T10.3 y lo de T11.1 que es de pantalla)

Rama `feature/474-envios-automaticos-whatsapp` (local `fe-474`), sobre `60c1a1fb`
(`merge-base --is-ancestor 60c1a1fb HEAD` OK). Búsqueda de código: grep/Read (el MCP de grafo no se
usó: lo que había que leer eran los archivos nuevos del backend, enteros).

## Qué se construyó

- **Menú (T10.2, R2):** «Envíos automáticos» en Configuración, JUSTO DESPUÉS de «Plantillas» como la
  maqueta (design §7 lo permite: no es el primer hijo). Censos ampliados: `menu-visibility.test.ts`
  (hijos de Configuración) y `pwa-manifiesto-atajos.guardia` (maestro 22 → 23, nadie más).
- **Páginas (T10.3):** `/configuracion/envios-whatsapp` (lista), `/nuevo`, `/[id]` (editar),
  `/historial?envio=<id>`. Server Components, solo `maestro` (otro rol → «sin permiso», sin leer nada).
  Componentes en `app/(app)/configuracion/envios-whatsapp/_components/`.
- **Plantillas (T10.1):** «Tipo de plantilla» (de orden / de informe), «Lleva documento adjunto» con
  bloqueos R6/R7, aviso R48 bajo el interruptor (llama a `estadoAppMeta` al ENCENDER), selector y vista
  previa por catálogo del informe (local, con los ejemplos; `previewPlantilla` sigue para las de
  orden), sin «plantilla de tienda» ni «bienvenida» en las de informe, toasts de
  `documento_no_disponible` (R9) y `en_uso` (R10). Las variables llegan por `listarInformesWhatsapp()`
  desde el servidor; el catálogo NO se importa en cliente.
- **16 actions montadas → 16 `@sin-superficie` retirados** (15 en `envios-whatsapp.ts` +
  `estadoAppMeta`). `superficie-de-uso.guardia` verde.

## Mapa R → test (frontend)

| R | Test |
| --- | --- |
| R1 | `tests/components/ConfiguracionEnviosWhatsappPage.test.tsx` (las 4 páginas × 6 actores sin permiso: aviso y cero lecturas) |
| R2 | `tests/unit/auth/menu-visibility-envios-whatsapp.test.ts`; `menu-visibility.test.ts` (censo); `destino-post-login.test.ts` intacto |
| R3, R6, R7 | `tests/components/PlantillasInforme.test.tsx` |
| R4, R53 | `PlantillasInforme.test.tsx` (selector y vista previa del informe, clave desconocida); `envios-whatsapp-formulario.test.tsx` (vista previa + «De dónde sale cada dato», nombre del 1.er destinatario) |
| R8, R9, R10 | `PlantillasInforme.test.tsx` (listado) |
| R11, R13, R15 | `envios-whatsapp-formulario.test.tsx` (payload exacto, defaults, error por campo, «Se guarda apagado», no enciende) |
| R12 | `envios-whatsapp-formulario.test.tsx` (solo plantillas del informe; plantilla sin documento + informe con PDF ⇒ no guarda ni prueba); `ConfiguracionEnviosWhatsappPage.test.tsx` (solo de informe aprobadas, recorre páginas) |
| R14, R49 | `envios-whatsapp-formulario.test.tsx` (solo eventos disponibles ∩ del informe, por su nombre, sin «SLA») |
| R16 | `envios-whatsapp-formulario.test.tsx` («Admin de tienda» con conteo; informe no apto ⇒ aviso y rechazo del servidor visible) |
| R17 | `envios-whatsapp-formulario.test.tsx` (lista resuelta, teléfono inválido y compartido, guarda igual; búsqueda de personas) |
| R18, R19, R25 | `EnviosWhatsappLista.test.tsx`; R18/R21 también en `envios-whatsapp-formulario.test.tsx` |
| R37, R42, R43, R44 | `EnviosWhatsappHistorial.test.tsx` |
| R39, R40, R41 | `envios-whatsapp-formulario.test.tsx` (solo lo guardado; guarda antes si hay cambios; nuevo ⇒ crea apagado y prueba) |
| R48 | `tests/components/plantillas-aviso-app-meta.test.tsx` |

## Mutaciones de UI (medidas: test verde antes, mutación aplicada y comprobada con `git diff --stat`, test, `git checkout --` y árbol limpio)

| # | Mutación | Test | Resultado |
| --- | --- | --- | --- |
| F1 | `bloqueado` sin `faltaDocumento` (EnvioForm) | formulario | 1 failed — MATADA |
| F2 | avisos de teléfono inválido vacíos (DestinatariosField) | formulario (R17) | 1 failed — MATADA |
| F3 | no pintar el mensaje de `estadoAppMeta` (PlantillaInformeFields) | aviso-app-meta (R48) | 2 failed — MATADA |
| F4 | ignorar `avisoSinProxima` (EnviosModule) | lista (R25) | 1 failed — MATADA |
| F5 | bienvenida visible en plantilla de informe (plantillas-columns) | PlantillasInforme (R8) | 1 failed — MATADA |
| F6 | editar manda tipo/documento aunque esté bloqueado (EditarPlantillaForm) | PlantillasInforme (R7) | 1 failed — MATADA |

## Verificación visual

Sin base de datos (ver Gate) el middleware no deja pasar a ninguna página privada. Se capturaron los
componentes REALES con datos de ejemplo en un arnés temporal bajo una ruta pública (borrado, nunca
commiteado), un solo dev server, apagado al terminar. Capturas (fuera del repo):
`%TEMP%/claude/.../scratchpad/capturas/{lista,vacio,nuevo,editar,historial}-{escritorio,movil}.png`.
Arreglado tras mirarlas: días en una fila a 390 px, hora sin cortar, barra fija móvil más corta.

Diferencias con la maqueta (decididas):
- Lista sin columna «Destinatarios» (el DTO `EnvioListItemDTO` no la trae) y el último envío dice el
  estado de la ejecución, no «4 de 5 enviados» (tampoco hay conteos en el DTO).
- «Informe adjunto» = selector de INFORMES del catálogo (no «Ninguno/Tránsito/Picking»): design §7.
- «Enviar aunque no haya nada que informar» no se pinta (design §7: es de 475/476).
- Historial: una fila por EJECUCIÓN con «Ver destinatarios» desplegable (el contrato es por ejecución),
  no una fila por persona; filtro por envío; sin filtros de fecha/resultado/persona.
- Sin la barra lateral en las capturas (el arnés no pasa por el layout autenticado).

## Gate

Ver `progress/gate_474_frontend.log` (con `INIT_EXIT` dentro). Resumen en el informe al leader.

Sobre HEAD `090a2efe`, con el `init.sh` de `origin/dev` (6d919734; la rama todavía no trae la regla
nueva del rápido ampliado, y no se mergeó `dev` en la rama):

- `./init.sh --rapido` → clasifica «AMPLIADO» (la rama toca migraciones y `lib/types/`), typecheck y
  lint pasan, y **FALLA** con `INIT_EXIT=1`: «el modo ampliado existe para medir contra Postgres y no
  hay DATABASE_URL». El worktree no tiene `.env` y copiarlo/leerlo fue denegado por el clasificador de
  permisos: la integración contra `ordenex_474` NO se ha corrido desde frontend.
- Parcial sin base (NO es el gate), mismo HEAD: relacionados `--changed origin/dev` 406 archivos
  verdes / 119 saltados (los de Postgres); guardias 272 verdes / 2 saltados. Sin intermitentes.

**Pendiente para cerrar:** repetir `./init.sh --rapido` con `DATABASE_URL` de `ordenex_474` exportada
(lo único que cambia frente a la corrida del backend son pantallas; ningún archivo de
`tests/integration/db` ni de `lib/repositories` se tocó).

## Arreglos menores de la revisión (rama `fix/474-m12`, 2026-10-05)

- **m2** (`HistorialEnvios.tsx`): la pestaña del PDF se abre EN el clic, antes del `await` (patrón de `VerComprobanteMiMovimiento`), y recibe la URL al resolver; si el navegador no la deja abrir, se dice y queda el enlace «Abrir el PDF» a un clic; si el servidor falla o caducó, se cierra y avisa. Mutación (mover `window.open` tras el `await`) → muere 1 test.
- **m1** (`EnvioForm.tsx`): en un envío ENCENDIDO con cambios sin guardar, «Probar ahora» queda deshabilitado con «Guarda los cambios antes de probar…» (`aria-describedby`) y no guarda; apagado, igual que antes. Lo guardado pasa de ref a estado porque ahora decide el render (`react-hooks/refs`). Mutación (`probarPideGuardar = false && …`) → muere 1 test.
- Gate: `vitest related --run` sobre los 4 archivos → 3 archivos / 34 tests verdes; eslint de los 4 limpio; `tsc --noEmit` sin errores.
