# Feature 455 — Tareas

> Requisitos: `requirements.md` (R1-R53). Diseño: `design.md` (§ citados).
> **Orden obligatorio: la 454 mergeada en `dev` → Fase 0 → Fase 1 (backend_dev) → Fase 2 (frontend_dev) →
> Fase 3 (verificación) → Fase 4 (revisión) → Fase 5 (solo por orden del humano, con SF-001 y la 454).**
> Nada de la Fase 1 empieza hasta que la Fase 0 esté cerrada y registrada.
>
> Convenciones: `[P]` = paralelizable con las otras `[P]` de su bloque (sin archivos en común). `Dep:` =
> dependencias. **Hecho** = criterio verificable. Un commit por tarea (`test(455): …`, `feat(455): …`,
> `docs(455): …`). El worktree nace de `dev`: primer paso `git checkout --detach <SHA dado>` + `git merge-base`
> (memoria «El worktree de agente nace de dev»). Gate: esta ficha toca migraciones, `db/schema.prisma` y
> `lib/types/` → **`./init.sh` completo**, el modo rápido se niega solo.

---

## FASE 0 — Medición y caracterización ANTES de tocar nada (backend_dev)

**Autocomprobación obligatoria por test de caracterización**, anotada en `progress/impl_455_fase0.md`
(memorias «arnés de mutaciones que miente», «test de integración verde sin datos», «gate sin .env salta la
integración»):
1. comando exacto y salida con el **nombre del test, `passed ≥ 1` y `skipped = 0`**;
2. la mutación aplicada (archivo:línea y diff de una línea);
3. la salida **roja** con el nombre del test que cae;
4. `git diff --stat` vacío en `lib/` y `app/` tras revertir.
Cada test afirma sus precondiciones antes del resultado: nada de `if (!x) return;`.

- [x] **T0.0 — Preparación.** 454 mergeada en `dev`; base local migrada (`prisma migrate status` en verde,
  host local); `.env` presente; `pnpm vitest run tests/integration/db --reporter=verbose` con `skipped = 0` en
  una suite de control. Aviso en `progress/current.md` antes de migrar la base local compartida.
  **Hecho:** salidas pegadas en `progress/impl_455_fase0.md`.

- [x] **T0.1 — Interruptor de códigos** `tests/fixtures/codigos-455.ts`. Exporta `C` con claves semánticas
  (`C.entregado`, `C.novedad`, `C.reprogramado`, `C.recogiendo`, `C.rechazo`, `C.novedadInterna`,
  `C.porDevolverCentral`, y los 13 que no cambian) y `R` para los 5 resultados. En la Fase 0 apuntan a los
  códigos **anteriores**; en T1.4 se cambia **solo este archivo**. Los tests de la Fase 0 usan `C`/`R`, nunca un
  literal. Dep: T0.0. **Hecho:** test de humo que siembra una orden por cada `C.*` contra Postgres real.

- [x] **T0.2 — (2026-09-24: local medido y SQL de prod listo en `progress/medicion_455.md`; FALTA correrlo en produccion por el MCP) Medición (solo lectura; producción por el MCP de Supabase, memoria «DATABASE_URL de prod es
  sensitive»)** `[P]` con T0.3. Anotar en `progress/medicion_455.md`:
  (a) órdenes vivas por cada uno de los 7 estados que cambian y gestiones por cada resultado;
  (b) referencias a `en_fulfillment` y `pendiente` en **toda** FK a `order_status` (lista sacada de
  `information_schema`), para decidir qué hará M3;
  (c) **barrido de datos**: por cada columna `text`/`varchar`/`json`/`jsonb` del esquema `public`, número de
  filas que contienen un código anterior como token (`~ '(^|[^a-z_])(entregada|…)([^a-z_]|$)'`);
  (d) audiencia del contrato: suscripciones de webhook activas y API keys con uso en 30 días;
  (e) el nombre visible que tenía `en_fulfillment` antes de la 155 (`git log -S` sobre `EstatusBadge.tsx`);
  (f) si `sin_gestionar` es una métrica publicada por `lib/analytics/publicacion-api-key.ts`.
  **Hecho:** seis bloques con consulta exacta, host (`prisma migrate status` o ref del MCP) y resultado.

- [x] **T0.3 — Inventario clasificado** `[P]` con T0.2. Ejecutar G1 y G2 (§6.1, §6.2) en **modo informe** sobre
  el árbol de `dev` y clasificar cada aparición con la regla de `design.md` §2.0 en
  `progress/inventario_455.md`: archivo, línea, texto, clase (1 orden concreta / 2 un estado / 3 grupo-acción-UI
  / 4 mensaje), decisión. Incluir: chips sin `estatusValue` en su DTO (recolección), parámetros de URL internos
  por código, lectores de `historial_accion.valor_*`, textos fijos del asistente en `dev`, PDFs y
  manifiestos, plantillas de WhatsApp de sistema, correos si los hay. **Hecho:** 0 apariciones sin clasificar;
  las de clase 3 con el texto nuevo propuesto (si alguno no está en `design.md` §2.1, se anota como decisión
  tomada y se sigue: memoria «Avanzar sin preguntar cada cosa»).

Tests de caracterización (todos `[P]` entre sí, Dep: T0.1). Carpeta `tests/integration/db/455/caracterizacion/`.
Cada fila separa **invariantes** (no se editan nunca después) de un `describe` **`[INTERMEDIO]`** con lo que la
ficha cambia por diseño (el texto visible o la forma de la respuesta), que es lo único que la Fase 1-2 reescribe
con nota fechada.

| Id | Archivo | Invariante (antes = después) | `[INTERMEDIO]` | Mutación que lo pone rojo HOY | R |
|---|---|---|---|---|---|
| C01 | `filtro-ordenes-por-estado` | `/ordenes` filtrando por el id de cada uno de los 7 estados devuelve exactamente las órdenes sembradas en él; una **vista guardada** (453) con dos de ellos aplicada devuelve las mismas filas. | — | En `listarOrdenes`, cambiar el filtro `estatusId` por `estatusId: { not: … }`. | R21, R45 |
| C02 | `filtro-satelite-por-codigo` | Listado satélite con `estados=[C.porDevolverCentral, C.rechazo]` → mismas órdenes. | El parámetro con el código anterior tras el cambio (R22). | Quitar un valor de la lista blanca de `estados-bodega-satelite.ts`. | R22, R45 |
| C03 | `sql-crudo-cron-devoluciones` | Candidatas del cron de plazo (`DevolucionSlaRepository`): mismas órdenes para un reloj dado. | — | Cambiar el literal del estado en la consulta cruda. | R46 |
| C04 | `sql-crudo-tablero-dia` | Contadores por resultado y buckets de una jornada mixta (`TableroDiaRepository`). | Rótulos. | Cambiar un literal de resultado en el SQL. | R46, R52 |
| C05 | `sql-crudo-analitica` | Rollup diario y operativo (`AnaliticaRollupRepository`, `AnaliticaOperativaRollupRepository`, `AnaliticaOperativaVivaRepository`), conteo por estado, ciclo de vida, cohorte y ranking: mismos números. | `label` de la dona. | Cambiar un literal en `AnaliticaRollupRepository`. | R46, R52 |
| C06 | `sql-crudo-avisos-y-corte` | Aviso agregado diario (`AvisoAgregadoRepository`) y corte nocturno (`CorteDiarioRepository`, `CierreDiaRepository.crearCierre`): mismas órdenes contadas y barridas. | — | Cambiar el literal del estado barrido. | R46, R53 |
| C07 | `sql-crudo-conteos` | `ConteoEntregasRepository`, `ConteoDevolucionesRepository`, `CicloVidaRepository`: mismos números. | — | Cambiar un literal de resultado. | R46 |
| C08 | `dinero-aprobacion` | Cierre con los 5 resultados: totales congelados y movimientos 42/43/173/44/158 con importes exactos. | — | Cambiar el resultado que alimenta el feed de flete. | R47 |
| C09 | `intentos-y-tope` | Conteo de intentos y decisión del tope 276 para un historial con las 5 clases de gestión. | — | Quitar un resultado de la lista de visita real. | R49 |
| C10 | `transiciones` | Las aristas de `TRANSICIONES` leídas con `C` (pares) = el inventario de la 140 leído con `C`. | — | Borrar una arista. | R48 |
| C11 | `webhook-estado` | Mismos eventos (orden, destino, instante, `eventoId`) para un ciclo completo; un job encolado con la fila del catálogo renombrada **después** entrega el código nuevo con el mismo `eventoId`. | Cuerpo (`estado`, `estadoNombre`). | Quitar un valor de `EVENTOS_PUBLICOS`. | R28, R50 |
| C12 | `api-lectura` | Listado filtrado por cada estado, detalle con `gestiones[]`, carga: mismas órdenes y mismos campos no afectados. | Códigos, `…Nombre`, `estatus`→`estado`, `422` por código anterior. | En `ApiOrdenLecturaService.listar`, ignorar `estado`. | R24, R26, R27 |
| C13 | `rastreo` | Número de entradas de la línea y fechas para un historial que recorre los 20 estados y los 4 retirados. | Los textos (hitos → nombres). | Cambiar un par en `HITO_POR_ESTATUS`. | R31, R34 |
| C14 | `novedades-y-ayuda` | Pestaña de novedad de la tienda dueña (y no de otra) lista las órdenes `C.novedad`; la de ayuda las de ayuda abierta (454). | Rótulos. | Cambiar el grupo `devolucion` a otro estado. | R53 |
| C15 | `plantilla-estatus` | La variable `{{estatus}}` se resuelve para una orden en cada estado sin fallar. | El texto producido. | `transform` que devuelve `""`. | R35 |
| C16 | `snapshot-correccion` | La corrección de un resultado (398) escribe `historial_accion` con valor anterior/nuevo y se lee en su pantalla. | El texto mostrado. | Escribir `valor_nuevo` vacío. | R23 |

- [ ] **T0.4 — (2026-09-24: C01-C16 verdes con su rojo en `progress/impl_455_fase0.md`; se cierra al completar T0.2 en prod) Cierre de la Fase 0.** 16 filas en verde sobre el código actual, cada una con su rojo registrado;
  T0.2 y T0.3 completos. Dep: T0.1-T0.3, C01-C16. **Hecho:** `progress/impl_455_fase0.md` con los 16 bloques;
  commit `test(455): caracterizacion antes del renombre`.

---

## FASE 1 — Backend (backend_dev). Dep: T0.4

### Cimientos

- [ ] **T1.1 — Fuente única** (`design.md` §1.1-§1.2). `lib/types/order-status.ts` (seed con códigos
  vigentes en las mismas posiciones, `NOMBRE_ESTADO`, `ESTADO_RETIRADO`, `CODIGO_VIGENTE_DE_ANTERIOR`,
  `nombreDeEstado`, `nombrePublicoDeEstado`, `codigoVigente`, comentario fechado); `lib/types/gestion-resultado.ts`
  (`nombreDeResultado`, `SENAL_PENDIENTE`, aserción de tipo). Tests unitarios: 20 nombres, retirado interno y
  público, código desconocido → «Estado no reconocido», traducción de los 7. Dep: T0.4.
  **Hecho:** tests verdes; G4 (T1.10) verde.
- [ ] **T1.2 — `schema.prisma`** (§3.2): enum `GestionResultado` con los códigos vigentes; comentarios fechados;
  `prisma generate`. Dep: T1.1. **Hecho:** `prisma validate` y `migrate diff` sin diferencias frente a M1-M3.
- [ ] **T1.3 — Migraciones M1, M2, M3 + `down.sql`** (§3.1) y `tests/integration/db/455/migracion.test.ts`
  (round-trip UP → UP → DOWN → UP con fotos comparadas, incluidos una vista guardada, un `orden_evento`, un job
  `webhook_estado` pendiente y un snapshot). M3 lista sus FK desde `information_schema` en el test, no a mano.
  Dep: T1.2. **Hecho:** test verde con `skipped = 0`; mutación: quitar un `UPDATE` de M1 → rojo; R16, R17, R19
  afirmados.
- [ ] **T1.4 — Interruptor** `tests/fixtures/codigos-455.ts` a los códigos vigentes (una sola edición) y
  reemplazo mecánico de los literales en `lib/`, `app/` (solo tipos/lógica, no textos), `scripts/`, `tests/`
  (excepto los de la Fase 0, que no se tocan salvo sus `[INTERMEDIO]`). Incluye SQL crudo, `EXCLUDE_POR_ROL`,
  `EVENTOS_PUBLICOS`, `TRANSICIONES`, `ESTATUS_POR_RESULTADO` (identidad), `tests/fixtures/inventario-transiciones-140.ts`,
  el mapa `Record<GestionResultado, keyof FilaTableroDia>` (§1.2). Dep: T1.3. **Hecho:** `tsc` limpio; C01-C16
  invariantes verdes **sin editarlos**; G1 (T1.10) verde.
- [ ] **T1.5 — Sembrado** (§3.3): comprobación de códigos anteriores en `seedOrderStatus` + test contra base con
  una fila `entregada` (falla, 0 inserciones). Dep: T1.1. `[P]` con T1.4. **Hecho:** R20 verde.

### Canal de integración (Dep: T1.4; `[P]` entre sí salvo T1.8)

- [ ] **T1.6 — API por API key** (§5.1-§5.2): `estadoNombre`, `resultadoNombre`, `estadoResultanteNombre` en
  listado, detalle, borrado, cancelación y habilitación; carga `estatus` → `estado` + `estadoNombre`; `422` por
  código anterior. Tests de servicio y de ruta por superficie con el literal esperado de una fila (no contra
  `nombreDeEstado`). **Hecho:** R24, R26, R27 verdes; C12 `[INTERMEDIO]` reescrito con fecha.
- [ ] **T1.7 — Webhooks** (§5.1): `estadoNombre` tras `estado` en `orden.estado_actualizado`; `resultadoNombre`
  y `resultadoAnteriorNombre` en los eventos de la 454. **Hecho:** R25, R28 verdes; C11 invariante intacto.
- [ ] **T1.8 — Contrato publicado** (§5.3): `openapi-spec.ts` derivado + `.yaml` espejo + Postman + entrada del
  CHANGELOG + `docs/ayuda/oficina/configuracion-api.md` + `docs/api/manual-metricas-por-mensajero.md`.
  Dep: T1.6, T1.7. **Hecho:** tests de contrato verdes; G5 verde; el CHANGELOG contiene la tabla de 7+4 filas.
- [ ] **T1.9 — Rastreo público** (§4): DTO de nombres, fusión de tramos, retirados plegados al equivalente,
  pendiente 454 con `SENAL_PENDIENTE`; `rastreo-sin-estatus-crudo.guardia` y `rastreo-hitos-exhaustivo.guardia`
  reescritas con fecha (la segunda se retira o pasa a afirmar la ausencia de hitos). `[P]` con T1.6-T1.8.
  **Hecho:** R31-R34 verdes; C13 invariante intacto.

### Resto del backend (Dep: T1.4; `[P]` entre sí)

- [ ] **T1.10 — Guardias G1-G4** (§6.1-§6.4), cada una con su caso de mutación en el propio archivo (R44).
  Se retiran de la allowlist de `censo-order-status-rename.test.ts` las entradas de la homonimia de hitos
  (§4). **Hecho:** las cuatro verdes; cada una roja ante su mutación (anotado en `progress/impl_455_backend.md`).
- [ ] **T1.11 — Textos que nacen en `lib/`**: `{{estatus}}` (`plantilla-datos.ts`), notificaciones
  (`emitir.ts`), `lib/services/mensajes-*.ts`, `label` de `AnaliticaOperativaRollupRepository`, métricas de
  `lib/analytics/metrics.ts` según T0.3. **Hecho:** R35, R36 verdes; C15 `[INTERMEDIO]` reescrito.
- [ ] **T1.12 — Snapshots y URLs internas** (§2.2, §3.4): `codigoVigente` en el lector de
  `historial_accion.valor_*` y en el parser del parámetro `estado` de la bodega satélite (y los demás de T0.3).
  **Hecho:** R22, R23 verdes; C02 y C16 `[INTERMEDIO]` reescritos.
- [ ] **T1.13 — Cierre de la Fase 1.** `./init.sh` completo verde (`INIT_EXIT=0` escrito dentro del log, sin
  `tail`; memorias «El exit code que tapa un echo», «Log largo sin tail»), `skipped` de `integration/db` = 0.
  **Hecho:** `progress/impl_455_backend.md` con la tabla de trazabilidad backend y los logs; commit y rama
  verificados (memoria «Verificar el blob commiteado»).

---

## FASE 2 — Frontend (frontend_dev). Dep: T1.13

Ninguna pantalla nueva: son textos y chips. Si alguien propone una pantalla nueva, pasa por `/design`.
Sin «SLA» en textos (memoria). Todas `[P]` entre sí salvo T2.1.

- [ ] **T2.1 — Presentación base**: `EstatusBadge` y `estatus-label` sobre la fuente única; se retira la derivación
  por zona; `filtro-estado-def.ts` sin `EXCLUDE_ESTADO_DEFAULT`. **Hecho:** R2, R10, R18 (selector) verdes;
  `EstatusBadgeCatalogoV2.test.tsx` reescrito con fecha.
- [ ] **T2.2 — Portal del mensajero**: `pos-estado.ts` (colores por código, marcador «Gestionando ahora»/«Abierta
  en detalle», nota de ayuda), `RepartoModule`, `RecogerModule`, recolección y recolectadas del día (con el
  `estatusValue` que T1.4/T0.3 añadió al DTO), chat (`chat-format.ts`), KPIs, menú y título «Recoger en bodega».
  **Hecho:** R7, R8, R12 verdes por componente.
- [ ] **T2.3 — Monitoreo y tablero**: `contadores.ts` (resultados y buckets). **Hecho:** R5, R6 verdes; C04
  `[INTERMEDIO]` reescrito.
- [ ] **T2.4 — Cierres** (mensajero, admin, bodega de SF-001): `cierre-labels.ts` a un solo mapa,
  `cierre-factura.tsx`, `CierreDiaModule`, `CorregirResultadoDialog`, confirmación física, descargas.
  **Hecho:** R4, R5, R39 verdes; las pestañas y la columna de la descarga dicen lo mismo (test).
- [ ] **T2.5 — Novedades de la tienda**: `novedad-grupo-textos.ts`, modales (reprogramar, rechazar, habilitar,
  gestionar desde ayuda), descargas. **Hecho:** R5, R6 verdes; C14 `[INTERMEDIO]` reescrito.
- [ ] **T2.6 — Analítica y ranking**: dona sin `etiquetaDeStatus`, cohorte, KPIs, productos, descargas, histórico
  de ranking. **Hecho:** R3, R5, R52 verdes; C05 `[INTERMEDIO]` reescrito.
- [ ] **T2.7 — Órdenes, satélite y mensajes de error**: `OrdenesListado`, `SateliteOrdenesListado`, recepción,
  escáneres, `*-error-messages.ts`, línea de tiempo (retirados con « (estado retirado)»). **Hecho:** R2, R11 verdes.
- [ ] **T2.8 — Página del rastreo público**: pinta `nombre` y la señal pendiente. **Hecho:** test de
  componente con los 20 nombres y un retirado.
- [ ] **T2.9 — Resto del inventario de T0.3** (lo que no cayó en T2.2-T2.8). **Hecho:** G2 y G3 verdes sin
  añadir ninguna excepción nueva a sus allowlists.
- [ ] **T2.10 — Ayuda y asistente (SF-001)** (§7): `docs/ayuda/**` con los nombres exactos, título «Recoger en
  bodega», slugs intactos; texto fijo del asistente si existe. **Hecho:** R37, R38 verdes (G2 sobre
  `contextoPara` para los 5 roles y el público).
- [ ] **T2.11 — Cierre de la Fase 2.** `./init.sh` completo verde con las mismas condiciones que T1.13.
  **Hecho:** `progress/impl_455_frontend.md`.

---

## FASE 3 — Verificación (leader + frontend_dev). Dep: T2.11

- [ ] **T3.1 — Mutaciones de cierre.** Sobre el árbol final, secuencial y **nunca en paralelo con el gate**
  (memoria «Gate y mutaciones no en paralelo»): (1) reintroducir `"Entregada"` en un chip → G2 rojo; (2) un
  `'devuelta'` en un `$queryRaw` → G1 rojo y C03-C07 rojos; (3) un `Record` código→texto en un componente → G3
  rojo; (4) quitar `estadoNombre` del webhook → T1.7 rojo; (5) cambiar un nombre en `NOMBRE_ESTADO` → G4 rojo.
  **Hecho:** cinco rojos con nombre del test, y `git diff --stat` vacío después.
- [ ] **T3.2 — Recorrido en navegador por rol** (Playwright MCP; memoria «Ver la app encuentra lo que la suite
  no»; un solo dev server, memoria «Dos dev servers se pisan»). Base local con una orden en **cada uno de los 20
  estados**, una con gestión pendiente de cada resultado (454), una con ayuda abierta, y una fila histórica de
  cada retirado. En cada pantalla: capturar el texto visible y buscar **cada** nombre de §0.3 y **cada** código
  (vigente y anterior); cero apariciones. Anotar en `progress/recorrido_455.md` con capturas.

  | Rol | Pantallas |
  |---|---|
  | maestro | `/ordenes` (chips, filtro de estado, vista guardada, detalle, línea de tiempo con retirados, descarga CSV), `/monitoreo` (8 contadores y sus ayudas), `/cierres-admin` (pestañas, factura, corrección de resultado, descarga), consolidación de bodega (SF-001), `/analitica` (dona, cohorte, KPIs, descargas), `/ranking`, `/incidentes`, histórico de acciones (corrección), notificaciones |
  | admin | Lo mismo que maestro en su alcance + recepción en bodega central (escáneres: mensaje con estado) |
  | adminTienda | `/ordenes` propias, `/novedades` (pestañas «Novedad» y «Ayuda solicitada», modales, descarga), su wallet si nombra estados, WhatsApp de prueba con `{{estatus}}` |
  | adminSatelite | `/recepcion-satelite` (listado, filtro por estado, **URL vieja con `estado=por_devolver`**), por recibir, en bodega, cierres y consolidación de SF-001, cambiar día de reparto |
  | mensajero | Reparto (chip de estado, marcadores de tarjeta activa/detalle, nota de ayuda, señal pendiente), «Recoger en bodega», Recolección y recolectadas del día, chat (chips), cierre del día, KPIs, ayuda y asistente |
  | rastreo público | Una guía por cada estado + una con pendiente + una con un retirado en el historial: solo nombres de §0.1 y la señal «· pendiente de confirmación» |
  | API key | `curl` a listado (con `estado=entregado` → 200 y `estado=entregada` → 422 con el mensaje), detalle con `gestiones[]`, carga (campo `estado`), borrado; un webhook real a un receptor local: `estado` + `estadoNombre` tras `estado` |

  **Hecho:** cero apariciones en todas las filas; lo que aparezca abre una tarea de la Fase 2 y el recorrido se
  repite entero en esa pantalla.

---

## FASE 4 — Revisión (reviewer). Dep: T3.2

- [ ] **T4.1** — Trazabilidad completa (tabla de abajo) verificada contra los tests reales; informe
  `progress/review_455.md` **commiteado** (memoria «Informe de revisión sin commitear»).

---

## FASE 5 — Release (solo por orden del humano, junto con SF-001 y la 454). Dep: T4.1

- [ ] **T5.1 — Re-medir** T0.2 (a), (b), (d) el día de la release; decidir con (b) qué hará M3 y anotarlo.
- [ ] **T5.2 — Aviso a integradores** con la entrada del CHANGELOG y la audiencia medida; si existe manual fuera
  del repo, reenviarlo actualizado. Bloquea la release, no el código.
- [ ] **T5.3 — Ventana**: desplegar fuera de horario de reparto (hora fijada por el humano); `./init.sh` completo
  sobre el SHA exacto de `dev` comparado con `origin/dev` justo antes (memoria «El pre-vuelo caduca»).
- [ ] **T5.4 — Verificación tras desplegar** (`design.md` §8.2): catálogo, `pg_enum`, barrido de T0.2 (c) con 0
  códigos anteriores fuera de snapshots, un webhook real, `get_runtime_errors` de la hora siguiente sin errores
  de enum. **Hecho:** anotado en `progress/release_455.md`.

---

## Trazabilidad R → test

| R | Test (archivo › caso) |
|---|---|
| R1 | `tests/unit/types/nombre-estado-catalogo.test.ts` › «20 códigos, un nombre cada uno, igual a la tabla aprobada» |
| R2 | `tests/unit/components/estatus-badge.test.tsx` › «pinta el nombre exacto de los 20, sin zona»; recorrido T3.2 |
| R3 | `tests/unit/guards/fuente-unica-nombre-estado.guardia.test.ts` (G3) › «nadie humaniza un código»; `estatus-label.test.ts` › «nunca devuelve el código» |
| R4 | `tests/unit/types/gestion-resultado.test.ts` › «el nombre del resultado es el del estado homónimo»; `cierre-labels.test.ts` |
| R5 | `contadores.test.ts`, `cierre-labels.test.ts`, `novedad-grupo-textos.test.ts`, `kpis-*.test.tsx` › «rotula con el nombre exacto» |
| R6 | `tests/unit/guards/nombres-estado-retirados.guardia.test.ts` (G2) › «ninguna etiqueta de grupo coincide con un nombre» |
| R7 | `pos-estado.test.ts`, `recoger-module.test.tsx`, `recoleccion-*.test.tsx`, `chat-format.test.ts` › «el chip es el estado de la orden» |
| R8 | `pos-order-card.test.tsx` › «activa: chip con el estado y marcador aparte» |
| R9 | G2 › «no hay B. por bodega» |
| R10 | `tests/unit/types/order-status.test.ts` › «código desconocido → Estado no reconocido» |
| R11 | `order-status.test.ts` › «retirado interno»; `historial-orden-timeline.test.tsx` |
| R12 | G3 › «ningún mapa de presentación indexado por texto visible» |
| R13 | G1 (`censo-order-status-rename.test.ts` brazo 455) |
| R14 | `tests/integration/db/455/migracion.test.ts` › «ids y FK preservados» |
| R15 | `migracion.test.ts` › «gestiones y eventos intactos salvo la etiqueta» |
| R16 | `migracion.test.ts` › «segunda pasada sin cambios» |
| R17 | `migracion.test.ts` › «down restaura la foto; sin CREATE TYPE» |
| R18 | `migracion.test.ts` › «huérfanos: borrado condicional»; `filtro-estado-def.test.ts` › «no se ofrecen» |
| R19 | `migracion.test.ts` › «0 jobs, 0 notificaciones, 0 historial» |
| R20 | `tests/integration/db/455/seed.test.ts` › «falla ante un código anterior sin insertar» |
| R21 | C01 |
| R22 | C02 `[INTERMEDIO]` + `satelite-ordenes-filtros.test.ts` › «URL vieja aplica el código vigente» |
| R23 | C16 `[INTERMEDIO]` |
| R24 | C12 `[INTERMEDIO]` + `api-orden-lectura-service.test.ts` › «cada código lleva su Nombre» |
| R25 | `webhook-estado-service.test.ts` y `webhook-evento-orden-service.test.ts` › «XNombre tras X» |
| R26 | `app/api/ordenes/api-key` route test › «código anterior → 422 con el vigente» |
| R27 | `carga-api-*.test.ts` › «filas[].estado + estadoNombre, sin estatus» |
| R28 | C11 |
| R29 | `openapi-contrato-en-reparto.test.ts`, `openapi-webhook-contrato.test.ts` (G5) |
| R30 | `tests/unit/api/changelog-455.test.ts` › «la entrada existe y tiene la tabla»; G1 sobre `docs/` |
| R31 | C13 + `rastreo-publico-service.test.ts` › «nombres y fusión de tramos» |
| R32 | `rastreo-sin-estatus-crudo.guardia.test.ts` (reescrita) |
| R33 | `gestion-resultado.test.ts` › «SENAL_PENDIENTE»; recorrido T3.2 |
| R34 | `rastreo-publico-service.test.ts` › «retirado plegado al equivalente» |
| R35 | C15 `[INTERMEDIO]` + `plantilla-datos.test.ts` |
| R36 | `notificacion-orden-rechazada.test.ts` › «el texto contiene el nombre» |
| R37 | G2 › «docs/ayuda sin nombres retirados» |
| R38 | G2 › «contexto del asistente por rol» |
| R39 | Tests de T2.4/T2.7 sobre pantallas de SF-001; recorrido T3.2 (adminSatelite) |
| R40 | G1 |
| R41 | G2 |
| R42 | G3 |
| R43 | G4 |
| R44 | Casos de mutación dentro de G1-G4 + T3.1 |
| R45 | C01, C02 |
| R46 | C03-C07 |
| R47 | C08 |
| R48 | C10 |
| R49 | C09 |
| R50 | C11 |
| R51 | `tests/unit/auth/menu-visibility.test.ts` (rutas y roles intactos) + recorrido T3.2 |
| R52 | C04, C05 |
| R53 | Suite de caracterización de la 454 (`tests/integration/db/454/**`) verde con los códigos vigentes |
