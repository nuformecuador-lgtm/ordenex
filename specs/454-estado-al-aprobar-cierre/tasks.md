# Feature 454 — Tareas

> Requisitos: `requirements.md` (R1-R65). Diseño: `design.md` (§ citados). Censo: `medicion.md`.
> **Orden obligatorio: Fase 0 → Fase 1 (backend_dev) → Fase 2 (frontend_dev) → Fases 3-4 → Fase 5 (solo por
> orden del humano, junto con SF-001).** Nada de la Fase 1 empieza hasta que la Fase 0 esté cerrada y
> registrada.
>
> Convenciones: `[P]` = paralelizable con las otras `[P]` de su bloque (sin archivos en común). `Dep:` =
> dependencias. **Hecho** = criterio verificable. Un commit por tarea (`test(454): …`, `feat(454): …`).
> El worktree nace de `dev`: primer paso `git checkout --detach <SHA dado>` + `git merge-base` (memoria).
>
> **Estado al 2026-09-24 (arreglo de la revisión T4.3).** T0.0–T3.3 hechas, con su evidencia en
> `progress/impl_454_fase0.md`, `impl_454_backend.md`, `impl_454_datos.md`, `impl_454_frontend.md`,
> `contraste_454.md` e `impl_454_fix_review.md`. Donde el **Hecho** se cumplió por otra vía que la escrita:
> T1.16 «test de avisos diarios» → R65 es vacuo y medido (ver `requirements.md`, R65); T1.18 → su test llegó
> en el arreglo de la revisión (`454/carga-mensajero-pendiente-sql-real.test.ts`); T1.20 → los tests reales
> son los de la tabla R32/R36 de abajo (no existe un `ApiOrdenLecturaService` aparte); T1.21 → el DTO y la
> clase `evento_orden` los cerró la Fase 2 (BLOQUEO-3 del backend); T3.2 → las mutaciones están repartidas
> en las bitácoras y en la revisión (12) más las del arreglo. Pendientes: T4.1 (gate completo, lo corre el
> leader), T4.2 (recorrido en curso), T4.3 (re-revisión) y la Fase 5.

---

## FASE 0 — Caracterización ANTES de tocar nada (backend_dev)

Objetivo: fijar con tests de integración **contra base real** (`tests/integration/db`) el comportamiento de
hoy en cada punto delicado. Deben estar **en verde sobre el código actual**. Cada test separa:

- **Invariantes** — lo que tiene que seguir siendo verdad después de la ficha (dinero, conteos, bloqueos,
  destinos finales). **No se editan nunca** en fases posteriores. Si se ponen rojos, es regresión.
- **`[INTERMEDIO]`** — un `describe` aparte con lo que la ficha cambia por diseño (p. ej. «tras gestionar la
  orden está en `entregada`»). Es lo único que la Fase 1 puede reescribir, con nota fechada.

**Autocomprobación obligatoria por test** (memoria «arnés de mutaciones que miente», «test de integración
verde sin datos», «gate sin .env salta la integración»), anotada en `progress/impl_454_fase0.md`:
1. comando exacto y salida con **nombre del test, `passed ≥ 1` y `skipped = 0`**;
2. la mutación aplicada (archivo:línea y diff de una línea);
3. la salida **roja** con el nombre del test que cae;
4. confirmación de que la mutación se revirtió (`git diff --stat` vacío en `lib/`).
Un test que no pueda ponerse rojo con su mutación **no cuenta**. Cada test afirma sus precondiciones (que el
escenario existe) antes de afirmar el resultado: nada de `if (!x) return;`.

- [x] **T0.0 — Preparación.** Base local migrada a `dev` (`prisma migrate status` en verde, host local), `.env`
  presente, `pnpm vitest run tests/integration/db --reporter=verbose` con `skipped = 0` en una suite de control.
  Avisar en `progress/current.md` antes de migrar la base local compartida (memoria).
  **Hecho:** salida pegada en `progress/impl_454_fase0.md`.
- [x] **T0.1 — Escenario compartido** `tests/integration/db/454/_escenario.ts`. Construye un mundo con tienda,
  zona central y zona satélite, dos mensajeros, tarifas, suscripción de webhook activa y órdenes en
  `por_recoger`/`en_reparto`, y expone **verbos que llaman a los servicios reales** (no a Prisma):
  `gestionar`, `pedirAyuda`, `recuperar`, `habilitar`, `habilitarPorApi`, `gestionarDesdeAyuda`, `deshacer`,
  `solicitarCierre`, `correrCorte`, `aprobar(alcance)`, `rechazar`, `reabrir`, `corregirResultado`,
  `traspasar`, `cambiarDia`, `correrCronSla(now)`, `correrLiberacion(now)`, `rechazoTienda`. Reloj inyectable.
  Así el mismo test ejercita el código nuevo en la Fase 1 sin reescribirse. Dep: T0.0.
  **Hecho:** smoke test verde; limpieza por prefijo (base compartida).

Tests de caracterización (todos `[P]` entre sí, Dep: T0.1). Archivo: `tests/integration/db/454/caracterizacion/<nombre>.test.ts`.

| Id | Archivo | Escenario e invariantes | Mutación que lo pone rojo (sobre el código de HOY) | R |
|---|---|---|---|---|
| C01 | `corte-no-barre-gestionadas` | Mensajero con O1 `entregada`, O2 `rechazada` (sin cierre), O3 en mano, O4 con ayuda, O5 reservada para mañana. Corte: O3 y O4 barridas + `cierre_sin_gestion`; O1, O2, O5 no barridas, sin gestión sintética, sin fila de vínculo; cierre `vencido` con g1 y g2. Tras aprobar: O1 `entregada`, O2 `por_devolver*`, **una sola** gestión `rechazada` en O2. | `CierreDiaRepository.crearCierre`: quitar `estatusId: origenEstatusId` del pre-SELECT y del `updateMany` del corte. | R43 |
| C02 | `corte-concurrencia` | Transacción A registra una gestión sobre O sin confirmar; B corre el corte; A confirma. Nunca a la vez gestión vigente de O **y** fila `cierre_sin_gestion` de O. 20 repeticiones con intercalado forzado. | Quitar la guarda de estado del `updateMany` del corte. | R44 |
| C03 | `intentos-conteo` | O con `devuelta` (cierre aprobado), `reprogramada` (aprobado), `rechazada` (solicitado), una gestión sintética de escalado vinculada y aprobada y una anulada. Conteo = 2; tras aprobar el 3.º = 3. | (a) Quitar la 6.ª condición de `whereIntentosVigentes`; (b) quitar `cierre: { estado: "aprobado" }`. Las dos, por separado. | R45 |
| C04 | `tope-276` | O en el umbral, barrida y aprobada: `rechazada`, gestión sintética con `cierre_id NULL`, mensajero conservado, `por_devolver*` en la misma aprobación, y en el siguiente cierre `ingreso_bodega_rechazo` = tarifa. O' bajo el umbral → bodega + `prioridad`. | `>=` → `>` en el filtro `enElTope` (`CierresAdminRepository.ts:1987-1989`). | R46 |
| C05 | `sla-devolucion-reloj` | Gestión `devuelta` en t0, aprobación en t1 = t0+20 h. Cron en t1+ventana−1 min: no escala; en t1+ventana+1 min: escala a `rechazada` con gestión sintética que cobra en el siguiente cierre. | Anclar en `gestion.createdAt` (cambiar `PROYECCION_ANCLAJE_DEVOLUCION`). | R47 |
| C06 | `correccion-69` | `entregada` con pagos en cierre `solicitado`; corrección: seis totales recalculados (números esperados), desglose borrado, bitácora; al aprobar: sin crédito COD de esa orden, `ingreso_bodega_rechazo` de la tarifa, orden en `por_devolver*`. `[INTERMEDIO]`: estado justo tras corregir. | Saltar el `gestionOrdenPago.deleteMany` (`:1668`). | R18, R19 |
| C07 | `no-doble-gestion` | Gestionar O dos veces seguidas → la 2.ª `conflict`, 1 fila de gestión. Doble envío concurrente (`Promise.all`) → exactamente 1. | Quitar el `if (orden.estatusValue !== ORIGEN_GESTION)` (`MisAsignacionesService.ts:768`). | R3, R4 |
| C08 | `solicitar-cierre` | Todo gestionado → solicita; 1 en mano → bloqueado; 1 con ayuda → bloqueado; 1 reservada para mañana → solicita. | Quitar `en_reparto` de `ESTADOS_PENDIENTES`. | R52 |
| C09 | `liberacion-por-cierre` | C1 `vencido` barre A y B; C2 `vencido` barre C. Aprobar C1: A y B a bodega; C sigue `sin_gestionar` con mensajero. | Quitar `id: { in: barridasDeEsteCierre }` (`:1947`). | R50, R59 |
| C10 | `devolucion-rechazadas-139` | Aprobar C1 mueve su `rechazada`, un rechazo de escritorio (240) y un escalado del mismo mensajero. (La `rechazada` legada de otro cierre abierto **no se afirma aquí**: es el cambio declarado de R51 y se prueba en T1.8.) | Comentar el bloque 139. | R51 |
| C11 | `dinero-aprobacion` | Cierre con `entregada` (efectivo + SINPE), `rechazada`, `devuelta`, `reprogramada`, `incidente` con indemnización. Totales congelados al solicitar y movimientos de 42/43/173/44/158 **con importes exactos**. Re-aprobar: sin duplicados. | Saltar el feed de contra-entrega (173) o cambiar su guarda `acreditoCod`. | R49, R12 |
| C12 | `kpi-portal` | Jornada: 2 entregadas (COD 10 000 y 5 000), 1 rechazada (7 000), 2 en mano (3 000 y 4 000), 1 con ayuda (2 000). `pendientes = 3`, `entregadas = 2`, `porCobrar = 9 000`, `totalACobrar = 31 000`. | Quitar `montoGestionadas` del `totalACobrar`. | R53 |
| C13 | `portal-listas-mapa-ruta` | Gestionadas fuera de `porGestionar`, `conAyuda` y `findParadasEnReparto`; la de ayuda en `conAyuda` sin `secuenciaRuta`. | Añadir `entregada` a los estados de `findMisAsignaciones`. | R6, R22 |
| C14 | `traspaso` | Gestionada: no traspasable. En mano y con ayuda: traspasables; la de ayuda sigue con ayuda. | Añadir `entregada` a `ESTADOS_TRASPASABLES`. | R54, R28 |
| C15 | `cambio-dia` | Gestionada: no se cambia el día. En mano: sí, con las reglas de hoy. | Ampliar la lista de `CorreccionDiaRepartoService.ts:56` con `entregada`. | R55 |
| C16 | `dos-gestiones-vivas` | Fixture SQL: dos `devuelta` vigentes de O en C1 y C2 (C2 más reciente). Aprobar C1: O no se mueve; aprobar C2: se ancla. | Quitar el filtro `masRecientePorOrden` (`:2280-2282`). | R57 |
| C17 | `cierre-rechazado` | Solicitar → rechazar: sin cambios de estado ni dinero. Reabrir → aprobar: dinero una vez, estados una vez. | Cambiar `res.count === 1 && nuevoEstado === "aprobado"` por `res.count === 1`. | R13, R58 |
| C18 | `multi-dia-271` | C1 `vencido` (g1 de ayer + barrida A), C2 `solicitado` (g2 de hoy). Aprobar C2 no toca A ni g1; aprobar C1 después libera A. | La misma de C09. | R59 |
| C19 | `reprogramadas-liberacion` | `reprogramada` para hoy: el timbre de la aprobación la libera; para mañana no; el reloj de las 00:00 la libera al llegar el día. | Quitar el `continue` de fecha futura (`LiberacionReprogramadaRepository.ts:180`). | R48 |
| C20 | `notificacion-n1` | `rechazada` del mensajero → 4 filas (maestro, admin, adminTienda dueña, adminSatelite de la zona) una sola vez; `rechazada` de la tienda desde ayuda → 0; aprobar → 0 filas nuevas. `[INTERMEDIO]`: ninguno. | `ORIGEN_RECHAZO_DEL_DESTINATARIO = "x"`. | R35 |
| C21 | `deshacer` | Deshacer sin cierre → gestión anulada, orden gestionable; el cierre no la vincula; aprobar no la cobra. Gestión de la tienda: el mensajero no puede. Gestión en cierre: no se deshace. | Quitar `anuladaAt: null` de `gestionesDelCierreWhere`. | R15-R17 |
| C22 | `ayuda-ciclo` | Pedir ayuda → pestaña ayuda de la tienda dueña (y no de otra), `conAyuda`, no gestionable, bloquea cierre, hilo escribible por la tienda dueña; Recuperar → gestionable; Habilitar → gestionable; API habilitar (ramas A y B); la tienda reprograma desde ayuda → cuenta intento tras aprobar y va al cierre del mensajero; corte con ayuda → `sin_gestionar`. `[INTERMEDIO]`: los estados `ayuda_tienda`. | Cambiar el grupo `ayuda` de `ESTATUS_POR_GRUPO` a otro estado. | R21-R28, R65 |
| C23 | `confirmacion-fisica-238` | La aprobación exige y marca exactamente las gestiones que vuelven; un `incidente` no se marca. | Quitar `resultado: { in: RESULTADOS_QUE_VUELVEN }` del `WHERE` (`:2196`). | R60 |
| C24 | `alcance-satelite-y-sf001` | adminSatelite aprueba un cierre de su zona con los mismos desenlaces; no puede aprobar uno de la central; el cierre de bodega (431) creado sobre esos aprobados da los mismos totales. | Hacer que `alcanceWhere` ignore el alcance. | R61, R64 |
| C25 | `tablero-dia` | Contadores por resultado del día y buckets de sin resultado para una jornada mixta. | Cambiar la fuente del contador a `orden.estatus_id`. | R62 |
| C26 | `webhook-estado` | Con suscripción activa: al final de gestión + aprobación hay exactamente **un** `orden.estado_actualizado` `entregada` por entrega; payload sin PII. `[INTERMEDIO]`: el instante (hoy al gestionar). | Quitar `entregada` de `EVENTOS_PUBLICOS`. | R33 |
| C27 | `rastreo-y-historial-legado` | Tras aprobar, el rastreo muestra el hito confirmado; una fila histórica con destino `devolucion_por_confirmar` se lee `no_entregado` y una con `ayuda_tienda` `en_reparto`. `[INTERMEDIO]`: el hito justo tras gestionar. | Cambiar el hito de `devolucion_por_confirmar` en `HITO_POR_ESTATUS`. | R31, R40 |
| C28 | `rechazos-tienda-425` | Un rechazo de tienda suelto se incorpora como material de revisión al cierre del mensajero sin `cierre_id` y sin importe. | Quitar el 2.º cerrojo (`historialEstados some rechazo_tienda`). | R63 |

- [x] **T0.2 — Cierre de la Fase 0.** Las 28 filas en verde sobre el código actual y cada una con su rojo
  registrado. Dep: C01-C28. **Hecho:** `progress/impl_454_fase0.md` con 28 bloques completos; commit
  `test(454): caracterizacion del comportamiento actual`.

---

## FASE 1 — Backend (backend_dev). Dep: T0.2

### Cimientos

- [x] **T1.1 — Tipos de dominio.** `lib/types/orden-evento.ts` (SEED + exhaustividad); `order-status.ts`
  (fuera los dos valores, comentario fechado); `order-status-transiciones.ts` (§2); `gestion-destino.ts`
  (`devuelta → devuelta`, fuera `ESTATUS_DEVOLUCION_POR_CONFIRMAR`); `rastreo-publico.ts`
  (`HITO_POR_ESTATUS_RETIRADO`); `webhook-eventos.ts`; `tablero-dia.ts`; comentarios de familias sin
  productor en `orden-historial.ts`. **Hecho:** `pnpm typecheck` rojo **solo** en los consumidores de §11
  (lista pegada en `progress/impl_454.md`), que se resuelven en las tareas siguientes.
- [x] **T1.2 — Esquema y migraciones M1 y M2.** `db/schema.prisma` (modelo `OrdenEvento`, enum, relación
  `GestionOrden.eventos`, valor de `job_tipo`). DDL con `prisma migrate diff … --script`, pegado a mano (no
  `db:migrate:create`). `down.sql` de las dos. Dep: T1.1.
  **Hecho:** `prisma migrate deploy` local verde; `down` + `deploy` otra vez verde; test
  `tests/integration/db/454/orden-evento-migration.test.ts` (tabla, CHECKs, índice único parcial, RLS activa).
- [x] **T1.3 — Predicados únicos.** `lib/repositories/gestion-pendiente.ts` y `lib/repositories/ayuda-abierta.ts`
  (§3, §4.1), en forma Prisma y SQL. Dep: T1.2.
  **Hecho:** `gestion-pendiente-sql-real.test.ts` y `ayuda-abierta-sql-real.test.ts` cubren cada fila de la
  tabla de §4.1 y cada estado de cierre (sin cierre, solicitado, vencido, rechazado, aprobado), con una
  mutación registrada por condición; guardias `gestion-pendiente-unica-fuente.guardia.test.ts` y
  `ayuda-abierta-unica-fuente.guardia.test.ts` (ningún `where` fuera de los módulos menciona
  `gestion_registrada`/`ayuda_solicitada`).

### Registro, aplicación y dinero

- [x] **T1.4 — Registro de la gestión** (§6): `registrarGestionPendiente` con el protocolo de §5;
  `MisAsignacionesService.gestionar` y `escogerParaGestion` con el predicado; compensación de evidencias en
  conflicto. Dep: T1.3. **Hecho:** `registro-gestion-sin-transicion-sql-real.test.ts` (R1, R2, R5) y
  `registro-gestion-concurrencia-sql-real.test.ts` (R4: doble envío, mensajero+tienda) verdes; C07 verde sin
  editar sus invariantes.
- [x] **T1.5 — Webhooks de eventos** (§12.1): job `webhook_evento`, encolador en la misma tx, handler,
  `WebhookEventoOrdenService` reusando sender/firma/pausa, alta en el procesador de jobs. `[P]` con T1.6.
  Dep: T1.4. **Hecho:** `webhook-evento-sql-real.test.ts` (encola solo con suscripción activa, dedupe por id,
  payload `{ ordenEventoId }` sin PII) y `tests/unit/services/WebhookEventoOrdenService.test.ts` (cuerpo por
  tipo, firma, reintento, pausa).
- [x] **T1.6 — N1 al registrar** (DD). `[P]` con T1.5. Dep: T1.4. **Hecho:** C20 verde sin editar; test de que
  la aprobación no crea filas `orden_rechazada`.
- [x] **T1.7 — Aplicación en `resolverCierre`** (§7): bloque nuevo en su sitio, `RETURNING`, familias y actores
  de R8, `aplicacionGestiones` obligatorio, retiro del bloque de anclaje, servicio que resuelve ids y falla
  cerrado. Dep: T1.4. **Hecho:** `aplicacion-al-aprobar-sql-real.test.ts` (R7-R12, R14, R19, R57, R59 con
  una mutación registrada por guarda), `cierres-admin-caja-cod.test.ts` verde **sin tocar**, C04, C09, C11,
  C16, C17, C18, C23 verdes sin editar invariantes.
- [x] **T1.8 — Selección de la 139** (§8). Dep: T1.7. **Hecho:** `devolucion-rechazadas-seleccion-sql-real.test.ts`
  (propia, escritorio 240, escalado, tope y **legada de otro cierre abierto: no se mueve**); C10 verde.
- [x] **T1.9 — Intentos** (§10). `[P]` con T1.8. Dep: T1.7. **Hecho:**
  `intentos-segunda-via-sql-real.test.ts` (una `devuelta` nueva cuenta 1 tras aprobar y 0 antes; una
  sintética nunca), guardia `sinteticas-sin-evento-registro.guardia.test.ts`, las dos guardias del criterio
  actualizadas con nota fechada, `anclaje-vs-intentos.guardia.test.ts` **sin tocar** y verde; C03, C04, C05,
  C19 verdes.
- [x] **T1.10 — Corte nocturno** (§9) con bloqueo. Dep: T1.3. **Hecho:** C01 y C02 verdes sin editar sus
  invariantes; `corte-excluye-pendientes-sql-real.test.ts` con cierre `rechazado` y `vencido`.

### Operaciones del mensajero, la tienda y el admin

- [x] **T1.11 — Deshacer** (rama nueva + legada, §11 U4). Dep: T1.4. **Hecho:** C21 verde;
  `deshacer-ramas-sql-real.test.ts` (nueva: sin transición, evento, webhook; legada: aristas de hoy).
- [x] **T1.12 — Portal del mensajero** (listas, KPI, mapa, paradas). Confirmar si `contarEntregadas` cuenta
  por gestión o por estado y ajustarlo para que dé lo mismo que hoy. `[P]` con T1.13. Dep: T1.3. **Hecho:**
  C12 y C13 verdes sin editar.
- [x] **T1.13 — Precondición de solicitar cierre** (U3). `[P]` con T1.12. Dep: T1.3. **Hecho:** C08 verde.
- [x] **T1.14 — Corrección #69** (ramas nueva y legada). Dep: T1.7. **Hecho:** C06 verde sin editar
  invariantes; `correccion-ramas-sql-real.test.ts` (nueva: sin transición, evento, aplica `rechazada` al
  aprobar con familia `gestion`; legada: la de hoy).
- [x] **T1.15 — Ayuda como evento** (§4.2): solicitar, rescatar (Recuperar/Habilitar), habilitar por API
  (respuesta con `ayudaCerrada`), gestión desde ayuda (237). Dep: T1.4. **Hecho:** C22 verde sin editar
  invariantes; `ayuda-evento-sql-real.test.ts` (R21-R28 incluida la reapertura imposible tras un nuevo ciclo).
- [x] **T1.16 — Novedades, avisos, hilo, chat** (U11-U13, P4). `[P]` con T1.17. Dep: T1.15. **Hecho:**
  `novedades-predicado-sql-real.test.ts` y `hilo-ventana-alcanzable.guardia` verdes; test de avisos diarios.
- [x] **T1.17 — Traspaso y cambio de día** (U5, U6) con bloqueo. `[P]` con T1.16. Dep: T1.3. **Hecho:** C14 y
  C15 verdes; `traspaso-mensajero` y `correccion-dia-reparto(-efectos)` de integración verdes.
- [x] **T1.18 — Carga del mensajero** (U7, U8). `[P]`. Dep: T1.3. **Hecho:** tests de `GuiaAsignacionService`
  y `RepartoMananaRepository` con una orden pendiente que no cuenta.

### Publicación y lectores

- [x] **T1.19 — Rastreo público** (§12.3). `[P]`. Dep: T1.4. **Hecho:** `rastreo-pendiente-sql-real.test.ts`
  (aparece, se anula, se corrige, se confirma; sin actor/motivo); C27 verde; `rastreo-frontera.guardia` verde.
- [x] **T1.20 — API detalle y OpenAPI** (§12.2, R36). `[P]`. Dep: T1.4, T1.5, T1.15. **Hecho:** tests de
  `ApiOrdenLecturaService` (pendiente/aplicada), `openapi-spec` válido y sin los dos valores, eventos nuevos
  documentados.
- [x] **T1.21 — Línea de tiempo (DTO) y lectores de `cierre_sin_gestion`.** Clase `evento_orden` en el DTO y en
  `OrdenHistorialService` (`RANGO_POR_CLASE`). Medir quién lee `estatus_origen_id` de `cierre_sin_gestion`
  (Pregunta abierta 4) y, si alguien distingue la ayuda, derivarla del evento. `[P]`. Dep: T1.2.
  **Hecho:** test de servicio del historial con las cuatro clases; nota en `progress/impl_454.md`.
- [x] **T1.22 — SF-001.** Verificar conciliación de bodega y cierres de bodega (431) con el código nuevo.
  `[P]`. Dep: T1.7. **Hecho:** C24 verde; test de `resolverCierreBodega` sobre cierres aprobados con gestiones
  nuevas.
- [x] **T1.23 — Barrido de literales.** `exclude-por-rol.ts`, `estados-bodega-satelite.ts`, `cohorte-carga.ts`,
  `order-status-eliminables.ts`, `correccion-datos-cliente.ts`, `habilitacion-api.ts`, `gestion-retorno.ts`,
  `gestion-orden.ts`, `novedad*.ts`, `CierreDiaRepository.marcarDesdeAyudaTienda` (425). Dep: T1.4-T1.21.
  **Hecho:** `grep -rn "devolucion_por_confirmar\|ayuda_tienda" lib app components` = solo comentarios
  fechados y `HITO_POR_ESTATUS_RETIRADO`; guardia nueva `sin-estados-retirados.guardia.test.ts` que lo afirma;
  C28 verde.

### Migración de datos

- [x] **T1.24 — M3 backfill y retiro** (§1.6). Dep: T1.2, T1.15. **Hecho:**
  `tests/integration/db/454/retiro-estados-migration.test.ts`: (a) órdenes en los dos estados → `en_reparto` con
  rastro, las de ayuda con ayuda abierta y la de devolución con gestión pendiente; (b) idempotencia;
  (c) retiro condicional (con y sin referencias); (d) sin jobs ni notificaciones nuevos; (e) `RAISE` si falta
  la fila de solicitud; (f) **down**: vuelve lo intacto, aplica al modelo viejo las pendientes y las ayudas
  abiertas, repone catálogo; (g) up → down → up verde. Revisar los `down.sql` previos de `job_tipo` (no se
  tocan; se documenta el rollback encadenado).

### Cierre del backend

- [x] **T1.25 — Fase 0 contra el código nuevo.** Las 28 suites verdes; **ninguna invariante editada** (diff
  de esos bloques vacío, comprobado con `git diff dev -- tests/integration/db/454/caracterizacion` filtrado
  por `describe` no `[INTERMEDIO]`); los `[INTERMEDIO]` reescritos con nota fechada. Dep: T1.1-T1.24.
  **Hecho:** tabla en `progress/impl_454.md`.
- [x] **T1.26 — Gate completo** `./init.sh` (el rápido se niega: hay migraciones y `lib/types`), con
  `INIT_EXIT=$?` escrito dentro del log y `skipped` de `integration/db` = 0. Dep: T1.25.

---

## FASE 2 — Frontend (frontend_dev). Dep: T1.26

Ninguna pantalla nueva (si surge una, `/design` antes). Sin «SLA» en textos. Sin renombrar estados (455).

- [x] **T2.1 — Portal del mensajero** (`app/(app)/mis-asignaciones/**`, `RepartoModule`, `RutaMapa*`,
  `pos-estado`, `chat-contactos`): grupos servidos por el servidor; las pendientes no aparecen; «con ayuda»
  igual que hoy. `[P]`. **Hecho:** tests de componentes; recorrido rol mensajero (T4.2).
- [x] **T2.2 — Órdenes** (`OrdenesListado.tsx`, detalle, `EstatusBadge.tsx`, filtro de estados): chip
  «<resultado> — pendiente de confirmación»; los dos valores fuera. `[P]`. **Hecho:**
  `EstatusBadgeCatalogoV2.test.tsx` actualizado con nota; test del chip.
- [x] **T2.3 — Línea de tiempo** (`HistorialOrdenTimeline.tsx`): clase `evento_orden` en el `switch`
  exhaustivo. `[P]`. **Hecho:** test de render de las cuatro clases.
- [x] **T2.4 — Rastreo público**: hito pendiente con su texto. `[P]`. **Hecho:** test de página con y sin
  pendiente.
- [x] **T2.5 — Novedades** (`NovedadesModule/Tabs/Acciones`, `HabilitarNovedadModal`, `HiloNotasAyudaModal`,
  `novedad-acciones-catalogo`, `ayuda-descarga-columnas`). `[P]`. **Hecho:** `novedad-acciones-una-tabla.guardia`
  y `ayuda-columna-retirada.guardia` verdes.
- [x] **T2.6 — Satélite** (`SateliteOrdenesListado`, `CambiarDiaRepartoSateliteModal`, recepción). `[P]`.
- [x] **T2.7 — Cierres admin** (`cierre-factura`, corrección de resultado: el aviso dice que el estado se
  aplica al aprobar). `[P]`.
- [x] **T2.8 — Gate** `./init.sh --rapido` (o completo si toca cimientos). Dep: T2.1-T2.7.

---

## FASE 3 — Verificación independiente. Dep: T2.8

- [x] **T3.1 — Contraste histórico** (§14): `scripts/contraste-454.sql` (solo `SELECT`) y
  `scripts/contraste-454.ts`. Correr en local y en producción (MCP de Supabase, solo lectura).
  **Hecho:** `progress/contraste_454.md` con K1-K8: diferencia **0** o explicada fila a fila; ninguna diferencia
  de dinero (K4, K8) sin explicar.
- [x] **T3.2 — Mutaciones sobre el código nuevo.** Repetir, adaptada, la mutación de cada C01-C28 y de cada
  test nuevo de T1.3-T1.24; cada una debe poner rojo su test. **Hecho:** tabla con test, mutación, rojo y
  reversión en `progress/impl_454.md`.
- [x] **T3.3 — Población legada.** Consulta de gestiones legadas vivas (sin evento, no anuladas, cierre no
  aprobado) en local y producción. **Hecho:** número anotado; se re-mide en T5.4.

---

## FASE 4 — Gate y recorrido. Dep: T3.1-T3.3

- [ ] **T4.1 — Gate completo** `./init.sh` sobre la rama con `dev` mergeado (SF-001 incluido). Log sin `tail`.
- [ ] **T4.2 — Recorrido en navegador por rol** (local, usuarios QA, un dev server: memoria «dos dev servers se
  pisan»). Guion abajo. **Hecho:** `progress/recorrido_454.md` con captura o respuesta de la action por caso;
  duración de la aprobación con 14 gestiones; `max(updated_at)` por tipo de job.

### Guion del recorrido

| Caso | maestro | admin | adminTienda | adminSatelite | mensajero | rastreo público | API key |
|---|---|---|---|---|---|---|---|
| Gestionar (cada resultado) | ve «En reparto» + chip; timeline con evento | ídem | ve su orden con chip; no ve órdenes ajenas | ídem en su zona | la orden sale de «por gestionar», mapa y ruta; KPI iguales a hoy | «<resultado> — pendiente de confirmación» | `gestiones[]` con `pendienteConfirmacion: true`; llega `orden.gestion_registrada` |
| Deshacer | chip desaparece; evento «anulada» | ídem | ídem | ídem | vuelve a «por gestionar» | hito pendiente desaparece | llega `orden.gestion_anulada` |
| Pedir cierre | — | — | — | — | permitido con todo gestionado; bloqueado con una en mano o con ayuda | — | — |
| Corte nocturno (forzado en local) | las gestionadas **no** aparecen barridas | ídem | — | — | cierre `vencido` correcto | — | — |
| Aprobar | estado aplicado; `rechazada` → `por_devolver*`; dinero igual al de hoy | ídem | ve el estado final | aprueba los de su zona; no los de la central | — | hito confirmado | `orden.estado_actualizado` |
| Rechazar cierre | nada se mueve | ídem | sigue viendo chip | ídem | reabre y re-solicita | sigue pendiente | nada nuevo |
| Corregir resultado | totales recalculados; evento «corregida» | ídem | chip cambia a rechazada | — | — | muestra el corregido | `orden.gestion_corregida` |
| Traspasar | gestionada: rechazada con mensaje; en mano / con ayuda: ok | ídem | — | ídem en su zona | recibe/entrega | — | — |
| Cambiar día | gestionada: rechazado; resto como hoy | ídem | — | ídem (modal satélite) | — | — | — |
| Tope de intentos | barrida en el tope termina `rechazada` y cobra en el siguiente cierre | ídem | — | — | la card dice «en el tope» como hoy | — | `orden.estado_actualizado rechazada` |
| Ayuda y rescate | ve evento de ayuda | ídem | pestaña ayuda; Habilitar; reprogramar/rechazar desde ayuda; hilo escribible | ve la orden de su zona | «con ayuda»; Recuperar; no gestionable; cierre bloqueado | sin cambio (en reparto) | `orden.ayuda_solicitada` / `orden.ayuda_resuelta`; habilitar responde `ayudaCerrada` |

- [ ] **T4.3 — Revisión** (reviewer): trazabilidad R→test completa, Fase 0 sin invariantes editadas,
  contraste 0/explicado. El informe se **commitea** (memoria).

---

## FASE 5 — Release (solo por orden del humano, junto con SF-001)

- [ ] **T5.1 — Audiencia del contrato.** Solo lectura en producción: suscripciones activas, keys con tráfico en
  30 días, uso de `habilitar`. **Hecho:** número en la nota de release (Pregunta abierta 2).
- [ ] **T5.2 — Aviso a integradores** (eventos nuevos, momento del `estado_actualizado`, fin de `ayuda_tienda`
  y `devolucion_por_confirmar`, `pendienteConfirmacion`, `ayudaCerrada`). Dep: T5.1.
- [ ] **T5.3 — Pre-vuelo.** Re-medir órdenes en los dos estados y población legada; comparar SHA medido con
  `origin/dev`; gate completo sobre `prod` + `dev` (`docs/release.md`). Merge sin squash.
- [ ] **T5.4 — Post-despliegue.** Re-ejecutar el backfill idempotente de M3 (ventana de despliegue, design
  §1.6) vía MCP y comprobar **0** órdenes en los dos estados; verificar que la release creó build (memoria
  «release mergeada sin despliegue»); jobs `webhook_evento` procesándose; logs de Vercel sin errores nuevos en
  7 días de ventana (`get_runtime_errors`).

---

## Trazabilidad R → test

> **Reescrita el 2026-09-24 (revisión T4.3, m1).** La tabla original citaba 9 archivos que nunca se crearon
> (`MisAsignacionesService.gestionable`, `ApiHabilitacionService`, `unit/services/OrdenesListado.gestion-pendiente`,
> `ApiOrdenLecturaService.pendiente`, `openapi-spec`, `rastreo-publico.retirados`, `GuiaAsignacionService.carga`,
> `RepartoMananaRepository`, `AvisoAgregadoRepository.ayuda`). Esta es la consolidada de
> `progress/impl_454_backend.md`, `impl_454_datos.md`, `impl_454_frontend.md` e `impl_454_fix_review.md`:
> **cada ruta existe** (comprobado sobre el árbol, ver la bitácora del arreglo). Rutas relativas a `tests/`;
> `454/` = `tests/integration/db/454/`; `C<nn>` = el archivo de caracterización de la tabla de la Fase 0.

| R | Test(s) |
|---|---|
| R1 | `454/registro-gestion-sin-transicion-sql-real.test.ts` |
| R2 | `454/registro-gestion-sin-transicion-sql-real.test.ts` |
| R3 | C07 `454/caracterizacion/no-doble-gestion.test.ts`; C22 `454/caracterizacion/ayuda-ciclo.test.ts` (no gestionable con ayuda); `454/gestion-pendiente-sql-real.test.ts` |
| R4 | C07; `454/registro-gestion-concurrencia-sql-real.test.ts` |
| R5 | `454/registro-gestion-sin-transicion-sql-real.test.ts` |
| R6 | C13 `454/caracterizacion/portal-listas-mapa-ruta.test.ts` |
| R7 | `454/aplicacion-al-aprobar-sql-real.test.ts`; `unit/repositories/cierres-admin-aplicacion-gestiones.test.ts` |
| R8 | `454/aplicacion-al-aprobar-sql-real.test.ts` (una fila por resultado y vía); `unit/repositories/cierres-admin-aplicacion-gestiones.test.ts` |
| R9 | `454/aplicacion-al-aprobar-sql-real.test.ts` |
| R10 | `454/aplicacion-al-aprobar-sql-real.test.ts`; C04 `454/caracterizacion/tope-276.test.ts` |
| R11 | `454/aplicacion-al-aprobar-sql-real.test.ts` («R11», fallo inyectado tras el bloque) |
| R12 | C11 `454/caracterizacion/dinero-aprobacion.test.ts`; `454/aplicacion-al-aprobar-sql-real.test.ts` |
| R13 | C17 `454/caracterizacion/cierre-rechazado.test.ts`; `454/aplicacion-al-aprobar-sql-real.test.ts` |
| R14 | `454/aplicacion-al-aprobar-sql-real.test.ts` (gestión legada) |
| R15 | C21 `454/caracterizacion/deshacer.test.ts`; `454/deshacer-ramas-sql-real.test.ts` |
| R16 | C21; `454/deshacer-ramas-sql-real.test.ts` |
| R17 | C21; `454/deshacer-ramas-sql-real.test.ts` |
| R18 | C06 `454/caracterizacion/correccion-69.test.ts`; `454/correccion-ramas-sql-real.test.ts` |
| R19 | C06; `454/correccion-ramas-sql-real.test.ts` |
| R20 | `454/deshacer-ramas-sql-real.test.ts`; `454/correccion-ramas-sql-real.test.ts` |
| R21 | C22; `454/ayuda-evento-sql-real.test.ts` |
| R22 | C22; C13; C08 `454/caracterizacion/solicitar-cierre.test.ts`; `454/ayuda-abierta-sql-real.test.ts`; `454/novedades-predicado-sql-real.test.ts` |
| R23 | C22; `454/ayuda-evento-sql-real.test.ts` |
| R24 | C22; `454/ayuda-evento-sql-real.test.ts`; `unit/services/api-habilitacion-service.test.ts`; `integration/api/ordenes-api-key-habilitar.route.test.ts` |
| R25 | C22; `454/ayuda-evento-sql-real.test.ts` |
| R26 | `454/ayuda-abierta-sql-real.test.ts`; `454/ayuda-evento-sql-real.test.ts` |
| R27 | C01 `454/caracterizacion/corte-no-barre-gestionadas.test.ts`; C22; `454/ayuda-evento-sql-real.test.ts` |
| R28 | C14 `454/caracterizacion/traspaso.test.ts`; `454/ayuda-evento-sql-real.test.ts` |
| R29 | `454/senales-gestion-lectores-sql-real.test.ts` (L1 `/ordenes`, L2 satélite, L3 detalle, con alcance); `components/OrdenesListado.gestion-pendiente.test.tsx`; `components/SateliteOrdenesListado.gestion-pendiente.test.tsx`; `components/HistorialOrdenSheet.gestion-pendiente.test.tsx`; `components/NotaGestionPendiente.test.tsx` |
| R30 | `unit/services/OrdenHistorialService.evento-orden.test.ts`; `components/HistorialOrdenTimeline.evento-orden.test.tsx` |
| R31 | C27 `454/caracterizacion/rastreo-y-historial-legado.test.ts`; `454/rastreo-pendiente-sql-real.test.ts`; `unit/types/rastreo-publico.nombre-resultado.test.ts`; `components/RastreoDialog.pendiente.test.tsx` |
| R32 | `integration/api/ordenes-api-key-orden-consulta.route.test.ts`; `integration/db/gestiones-detalle-api-405.test.ts`; `unit/api/openapi-405-gestiones.test.ts` |
| R33 | C26 `454/caracterizacion/webhook-estado.test.ts`; `454/webhook-evento-sql-real.test.ts`; `unit/services/WebhookEventoOrdenService.test.ts` |
| R34 | `unit/types/webhook-eventos.test.ts`; `unit/api/openapi-webhook-contrato.test.ts` |
| R35 | C20 `454/caracterizacion/notificacion-n1.test.ts`; `unit/repositories/notificacion-orden-rechazada.test.ts` |
| R36 | `unit/api/openapi-454-eventos.test.ts`; `unit/api/openapi-webhook-contrato.test.ts` |
| R37 | `unit/guards/sin-estados-retirados.guardia.test.ts`; `unit/domain/order-status-transiciones.guardia.test.ts`; `unit/types/order-status.test.ts` |
| R38 | `454/retiro-estados-migration.test.ts` (a) |
| R39 | `454/retiro-estados-migration.test.ts` (c) |
| R40 | C27; `unit/guards/rastreo-hitos-exhaustivo.guardia.test.ts` («454/R40»); `components/EstatusBadgeCatalogoV2.test.tsx` («454/R40»); `unit/repositories/cierres-admin-repository.test.ts` (barridas históricas) |
| R41 | `454/retiro-estados-migration.test.ts` (f, g) |
| R42 | `454/retiro-estados-migration.test.ts` (d) |
| R43 | C01; `454/corte-excluye-pendientes-sql-real.test.ts` |
| R44 | C02 `454/caracterizacion/corte-concurrencia.test.ts` |
| R45 | C03 `454/caracterizacion/intentos-conteo.test.ts`; `454/intentos-segunda-via-sql-real.test.ts` |
| R46 | C04 |
| R47 | C05 `454/caracterizacion/sla-devolucion-reloj.test.ts` |
| R48 | C19 `454/caracterizacion/reprogramadas-liberacion.test.ts` |
| R49 | C11; `unit/repositories/cierres-admin-caja-cod.test.ts` (sin tocar); T3.1 K8 (`progress/contraste_454.md`) |
| R50 | C09 `454/caracterizacion/liberacion-por-cierre.test.ts` |
| R51 | C10 `454/caracterizacion/devolucion-rechazadas-139.test.ts`; `454/devolucion-rechazadas-seleccion-sql-real.test.ts` |
| R52 | C08 |
| R53 | C12 `454/caracterizacion/kpi-portal.test.ts` |
| R54 | C14 |
| R55 | C15 `454/caracterizacion/cambio-dia.test.ts` |
| R56 | `454/carga-mensajero-pendiente-sql-real.test.ts` (ocupado/«Generar guía» y reparto de mañana, con control positivo; MUT-R10 en rojo) |
| R57 | C16 `454/caracterizacion/dos-gestiones-vivas.test.ts`; `454/aplicacion-al-aprobar-sql-real.test.ts` («R57») |
| R58 | C17 |
| R59 | C18 `454/caracterizacion/multi-dia-271.test.ts`; C09; `454/corte-excluye-pendientes-sql-real.test.ts` |
| R60 | C23 `454/caracterizacion/confirmacion-fisica-238.test.ts` |
| R61 | C24 `454/caracterizacion/alcance-satelite-y-sf001.test.ts`; `454/cierre-bodega-sf001-sql-real.test.ts` |
| R62 | C25 `454/caracterizacion/tablero-dia.test.ts` |
| R63 | C28 `454/caracterizacion/rechazos-tienda-425.test.ts` |
| R64 | C24; `454/senales-gestion-lectores-sql-real.test.ts` (alcance de los lectores nuevos; denegados sin datos por servicio y por Server Action, MUT-R6 en rojo); `454/correccion-ayuda-abierta-sql-real.test.ts`; `unit/actions/orden-historial-action.test.ts` |
| R65 | **Se cumple por vacuidad, medido** (ver `requirements.md`, R65): ningún aviso diario cuenta `ayuda_tienda`. El conteo de la pestaña de ayuda sí pasa por la derivación: `454/novedades-predicado-sql-real.test.ts` |
