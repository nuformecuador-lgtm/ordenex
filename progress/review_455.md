# Revisión independiente — Feature 455 «Un solo nombre por estado»

## Veredicto FINAL (re-revisión, 2026-09-24): **APROBADO** — sobre `origin/feature/455-fix` @ `7faebeff` (código `f2e7ff99`)

Los 4 mayores de la primera revisión (M1–M4) y los 11 fallos del recorrido (F1–F11) están corregidos y cada uno tiene una red que se pone ROJA si vuelve. Sin bloqueantes. Quedan tareas previas a la release (§R5), que no son de código de esta ficha.

## Re-revisión

> Árbol: `7faebeff` en modo detached (contiene `79d0a0b6` = esta revisión y el recorrido `721f25ec`). Base `ordenex_455` (la misma). No se repitió el gate completo: `progress/gate_455_fix.log` dice 2164/2164 archivos, 30 656 tests, 26 skipped preexistentes, `== init OK ==`, `INIT_EXIT=0`. Búsqueda con grep y lectura de archivos; el grafo MCP no se usó.

### R1. M1–M4 y F1–F11

| Punto | Estado | Evidencia |
|---|---|---|
| M1 | ✅ | `envio-devolucion-central-error-messages.ts:23` interpola `nombreDeEstado(por_devolver_a_bodega_central)`; mutación W2 → G2 ROJO |
| M2 | ✅ | «Devolución a origen por plazo vencido», «Reprogramado para», «Entregados / asignados», «Recogido a las», «Recogidos en tienda hoy», `docs/ayuda/tienda/novedades.md:30`; mutaciones W3–W8 → G2 ROJO |
| M3 | ✅ | G2 con `“”`, brazo «contiene» de palabra completa, plurales en minúscula y excepciones acotadas por TEXTO (`textos: [...]`, ya no por número); `PENDIENTES_FASE_2` vacío |
| M4 | ✅ | `tasks.md`: T1.9, T1.13, T2.1–T2.11 marcadas; tabla R→test reescrita. Quedan sin marcar T3.1, T3.2, T4.1 y T5.x (ver §R5) |
| F1–F8, F11 | ✅ | textos de `impl_455_fix.md` confirmados en los archivos; test nuevo `tests/unit/components/textos-455-recorrido.test.ts` con literales a mano |
| F9 | ✅ | §R3 |
| F10 | ✅ | `motivo-historial.ts` (solo presentación) + `HistorialOrdenTimeline.motivo-migracion.test.tsx` |

**Grep propio de palabra completa** (app/, components/, lib/, hooks/, docs/ayuda; nombres de §0.3 en mayúscula de rótulo y sus plurales): todo lo que queda está en comentarios, en `ESTADO_RETIRADO` (excepción declarada) o en «Devuelta a tienda»/«Por recolectar en tienda» (vigentes). En minúscula dentro de prosa quedan dos, por debajo del límite declarado de G2 (m8).

### R2. G2 reforzada: mutaciones repetidas (todas sobre G2, restauración byte a byte comprobada, árbol limpio al final)

| Id | Mutación | Resultado |
|---|---|---|
| W1 (= V9) | `NOTA_AYUDA_SOLICITADA = Sin gestionar` | ROJO (2) — antes sobrevivía |
| W2 (M1) | el error vuelve a «“Por devolver”» | ROJO |
| W3 (M2) | pestaña «Rechazadas por plazo vencido» | ROJO |
| W4 (M2) | columna «Reprogramada para» | ROJO |
| W5 (M2) | ranking «Entregadas / asignadas» | ROJO |
| W6 (M2) | «Recolectada a las» | ROJO |
| W7 (M2) | título «Recolectadas hoy» | ROJO |
| W8 (M2) | `docs/ayuda/tienda/novedades.md` «**Rechazadas por plazo vencido.**» | ROJO (2: árbol + contexto del asistente) |
| W9 | el texto de la excepción («Ayuda solicitada a la tienda») en OTRO archivo (`pos-estado.ts`) | ROJO: la excepción no se filtra fuera de su archivo |

### R3. F9 (rastreo)

- `tests/integration/db/455/rastreo-retirado-y-pendiente-sql-real.test.ts` (Postgres real): afirma precondiciones (no es un verde sin datos), la gestión UNA vez como pendiente, orden cronológico, claves sin repetir y el control sin pendiente (R34). Redes 454+455 con él: **70 archivos / 351 tests, 0 skipped, exit 0** (corrida propia).
- W10 (apagar el descarte: `fechaPendiente !== null &&` → `false &&`) → ROJO: F9 «UNA vez» y «cronológico».
- W11 (quitar la condición de estado: descarta CUALQUIER fila del mismo minuto que la pendiente) → **VERDE, sobrevive** (m9).

### R4. Cambios fuera del frontend y guardias de otras fichas

- `CierreDiaService.MSG_PENDIENTES`: solo texto; lo devuelven `motivoBloqueo` y el `conflict`, nadie lo compara. `CierreBodegaService` tiene su propio mensaje, sin nombres retirados.
- `CierresAdminRepository.MOTIVO_RECHAZO_TOPE_INTENTOS`: ahora se arma con `nombreDeEstado`. En código de `app/` y `lib/` solo se ESCRIBE (línea 2081); los tests lo comparan contra la constante y `textos-455-recorrido` contra el literal. Confirmo lo que dijo el leader: nadie lo lee… salvo los scripts de contraste (§R5).
- `RastreoPublicoService`: el cambio F9 de arriba; DTO igual (lista blanca intacta, `rastreo-dto-lista-blanca` verde).
- `lib/analytics/metrics.ts`: solo la `descripcion` de `novedad_interna` (prosa); etiqueta y valores sin cambio.
- **Las 3 guardias retocadas NO se debilitan:** `catalogo-universo` cambia la regex «sin gestionar … hoy» por «en novedad interna … hoy» (misma forma, texto nuevo); `etiquetas-visibles` cambia un literal del `toEqual` por el título nuevo (mismo tamaño de la lista); `EstatusBadgeRetiroFulfillment` pasa de una regex parcial a `getByText` exacto MÁS `queryByText(migracion 155)` nulo: queda más estricta.
- Guardias completas sobre `7faebeff`: 249 archivos / 3520 tests, exit 0.

### R5. Pendiente antes de la release (no bloquea el código)

- **`scripts/contraste-454.sql:63` y `scripts/contraste-454.ts:84,152`** reconocen las gestiones sintéticas del tope por el motivo VIEJO («rechazada al aprobar el cierre: sin gestionar y sin intentos de entrega disponibles»). Desde la 455 las filas nuevas llevan «Devolución a origen por rechazo al aprobar el cierre: estaba en Novedad interna y sin intentos de entrega disponibles». Deben aceptar **los dos textos** (las filas viejas conservan el anterior); si no, tras el despliegue el contraste deja de ver las sintéticas nuevas en silencio. Tarea previa a la release.
- T3.2: repetir el recorrido en las pantallas de F1–F11 (su criterio de «Hecho»), y marcar T3.1 con la evidencia existente (mis V1/V7/V8 y W1–W9, y las del `impl_455_fix.md` cubren los cinco casos que pide).
- T5.x como estaban (re-medir, aviso a integradores con la fecha en el CHANGELOG, ventana, verificación posterior).

### Menores nuevos

- **m8 —** prosa en minúscula con nombres retirados, por debajo del límite de G2: `RecuperarABodegaModal.tsx:72` «… orden(es) en devolución a la bodega central …» y `cierre-factura.tsx:1876` nombre accesible «Lista de órdenes rechazadas por la tienda» (rechazo de la TIENDA, 425: concepto distinto del estado). Sugerencia, no obligación.
- **m9 —** F9 compara la fila retirada y la pendiente por la fecha FORMATEADA (precisión de minuto): si caen en minutos distintos, el duplicado vuelve; y W11 muestra que ningún test fija que solo se descarta `devolucion_por_confirmar` (una fila de otro estado en el mismo minuto se ocultaría). Añadir un caso con otro estado en el mismo minuto.
- **m10 —** F10 cubre solo el patrón «migracion <n>: retiro de <retirado>» (deuda ya anotada en `impl_455_fix.md`).

---

# Primera revisión (sobre `fd5b64de`) — se conserva como historial

> Reviewer · 2026-09-24 · árbol revisado: `origin/feature/455-frontend` @ `fd5b64de` (Fase 0 + backend `9f1a0d37` + frontend).
> Base de datos: clon `ordenex_455` (`prisma migrate status` → `ordenex_455` en `localhost:5432`, 212 migraciones, al día). `.env` copiado sin imprimir; `node_modules` por junction; `prisma generate` hecho.
> NO se corrió `./init.sh` completo (orden del leader: el recorrido en navegador usa el mismo clon). Se usó `grep` y lectura directa de archivos; el grafo MCP no se consultó en esta revisión (los símbolos se verificaron en el archivo real).

## Veredicto de la primera revisión: **RECHAZADO** (superado: ver arriba)

El núcleo está bien hecho y medido (migraciones, API, webhooks, rastreo, fuente única, redes 454/455 verdes, 8 mutaciones propias en lógica todas rojas). Se rechaza porque **quedan nombres retirados de §0.3 como texto visible** (R41/R2, R39), en sitios que la guardia G2 no puede ver por diseño, y que el recorrido T3.2 marcará igual (su criterio es «cero apariciones de cada nombre de §0.3»). El arreglo es pequeño y está listado en §6.

## Checklist

| # | Punto | Resultado |
|---|---|---|
| 1 | Trazabilidad R1–R53 → test existente y verde | ✅ con reservas: todo R tiene test que existe y pasa; varios archivos de la tabla de `tasks.md` no existen y los sustituyen los de los mapas de `impl_455_backend.md`/`impl_455_frontend.md` (m7). R41 está mapeado a G2, que verifica una propiedad MÁS ESTRECHA que la del requisito (M3). |
| 2 | Redes: fuera de `[INTERMEDIO]` solo lo registrado | ✅ (§2) |
| 3 | Migraciones up→down→up en clon nuevo; M2 final desde cero | ✅ (§3) |
| 4 | Mutaciones propias (≥6) rojas y revertidas | ✅ 8/8 rojas en lógica; 1 superviviente sobre la excepción de G2 (m1, mitigada) |
| 5 | Contrato: CHANGELOG, `.yaml` ↔ `openapi-spec.ts`, Postman | ✅ (§5) |
| 6 | Excepción `NOTA_AYUDA_SOLICITADA` de G2 | ✅ justificada (m2); ⚠️ acotada por archivo+número, no por texto (m1) |
| 7 | Ningún nombre viejo visible en la UI | ❌ 6 textos visibles + 1 doc de ayuda (M1, M2) |
| — | `tasks.md` todo marcado (CHECKPOINTS) | ❌ desincronizado (M4) |
| — | typecheck | ✅ `tsc --noEmit` exit 0 sobre `fd5b64de` |
| — | Guardias (`pnpm run test:guardias`) | ✅ 249 archivos / 3517 tests, exit 0 |
| — | `./init.sh` completo | no corrido (orden del leader); el de la Fase 2 (`progress/gate_455_frontend.log`) dice `INIT_EXIT=0`, 2161/2161 archivos, 26 skipped preexistentes, `integration/db` sin skipped |
| — | RLS / tablas nuevas | N/A: la ficha no crea tablas |
| — | Webhooks: firma e idempotencia | mecanismo sin cambios; `eventoId` igual (C11/R28 verde); la firma cubre el cuerpo con `estadoNombre` (declarado en el CHANGELOG) |
| — | Secretos / hardcode de país | ninguno nuevo |
| — | Capas | el 422 vive en el schema zod del controlador; nombres en `lib/types`; servicios sin HTTP |
| — | E2E | sin harness en el repo; lo cubre el recorrido T3.2, pendiente |

## Hallazgos

### Mayores

- **M1 · BLOQUEANTE — mensaje de error con el nombre retirado «Por devolver».** `app/(app)/ordenes/_components/envio-devolucion-central-error-messages.ts:21`: `conflict: Alguna orden ya no está en estado “Por devolver”.` Se pinta en `/recepcion-satelite` (SF-001, R39). Es clase 4 de design §2.0 (mensaje que nombra un estado → interpolar `nombreDeEstado(por_devolver_a_bodega_central)`). Viola R2, R41 y R39. G2 no lo ve porque su detector solo reconoce `«»` y comillas rectas, no las tipográficas `“ ”`. No aparece en `progress/inventario_455.md` (T0.3 decía «0 apariciones sin clasificar»).
- **M2 · BLOQUEANTE — rótulos visibles que contienen un nombre retirado de §0.3** (§0.3: «no pueden reaparecer como nombre de nada»; R41 dice «contiene»). Ninguno está en el inventario T0.3:
  - `app/(app)/novedades/_components/NovedadesTabs.tsx:41` pestaña «Rechazadas por plazo vencido» (y `docs/ayuda/tienda/novedades.md:30` la cita en negrita). El subtítulo de la misma pantalla ya dice «Devolución a origen por rechazo por vencerse el plazo»: dos nombres para lo mismo en la misma vista.
  - `app/(app)/ordenes/_components/ordenes-columns.tsx:252` columna «Reprogramada para».
  - `app/(app)/ranking/_components/ranking-labels.ts:41` columna «Entregadas / asignadas» (design §2.1 cambió a «Entregado» la descarga y el histórico del ranking, no la tabla).
  - `app/(app)/recoleccion/_components/RecolectadasHoyLista.tsx:104` «Recolectada a las …» y `:38` título «Recolectadas hoy».
  Qué falta: reescribirlos con la regla de design §2.0 (nombre exacto si es un solo estado/resultado; texto propio sin palabras de §0.3 si es grupo/acción), o que el humano acepte por escrito cada uno como excepción.
- **M3 — G2 verifica menos que R41.** Detecta igualdad exacta (tras `trim`) o cita entre `«»`/comillas rectas; por diseño no mira «contiene» (para no marcar «Devuelta a tienda»). Resultado: M1 y M2 pasan verdes. Propuesta mínima: añadir `“”` a las comillas reconocidas y un brazo de palabra completa sobre los retirados en plural/participio (Entregadas?, Rechazadas?, Reprogramadas?, Devueltas?, Recolectadas?, «Por devolver» no seguido de « a »), con los vigentes que los contienen como lista blanca y su caso de mutación (R44).
- **M4 — `tasks.md` desincronizado** (CHECKPOINTS: todas marcadas). T1.9 y T2.1–T2.11 están hechas según `impl_455_frontend.md` pero sin marcar; T1.13 sin marcar (su gate fue `INIT_EXIT=1` por el BLOQUEO-2 y lo cerró el gate de la Fase 2); T3.1/T3.2 pendientes (T3.2 en curso).

### Menores

- **m1 — la excepción de G2 se acota por archivo y número, no por texto.** Mutación V9: `NOTA_AYUDA_SOLICITADA = Sin gestionar` → G2 sigue VERDE (1 hallazgo = máximo 1). La atrapan 7 tests de componente que fijan el literal «Ayuda solicitada a la tienda» (`HistorialOrdenTimeline.evento-orden`, `NotaGestionPendiente` ×2, `OrdenesListado.gestion-pendiente`, `RepartoAyuda` ×2, `SateliteOrdenesListado.gestion-pendiente`): no hay agujero real hoy. Mejor que la excepción declare el TEXTO permitido.
- **m2 — la excepción está justificada:** §0.3 retira «Ayuda solicitada a la tienda» *como estado*; design §2.1 (fila `pos-estado.ts`) y `specs/456-tooltip-estados/textos-aprobados.md` (líneas 39 y 48) fijan ese texto para la NOTA de la ayuda (evento de la 454), que se pinta junto al chip y no en su lugar (`PosOrderCard.estado-455` › «la NOTA del consumidor … nunca en su lugar»). Falta la confirmación del humano que pide la bitácora.
- **m3 — R18 (selector):** no hay test que siembre `en_fulfillment`/`pendiente` literales y afirme que no se ofrecen; lo cubre el mecanismo general (`estadosOfrecidos` filtra por `ORDER_STATUS_SEED`, probado con `en_fulfillment_bodega` en `satelite-filtro-estado.test.ts`). `EXCLUDE_POR_ROL` de maestro/admin sigue listando `pendiente` (inocuo).
- **m4 — la pendiente del rastreo solo la vigilan los tests con Postgres.** V6 cae en C13 y en `454/rastreo-pendiente-sql-real`, pero no en `rastreo-publico-service.test.ts` ni en `RastreoDialog.pendiente.test.tsx` (sus fixtures usan `entregado`).
- **m5 — red 454:** en `rastreo-pendiente-sql-real.test.ts` desaparece la aserción de que tras aprobar ninguna entrada lleva `nombreResultado`; el campo ya no existe y la aserción hermana sobre `pendiente` se conserva: traducción aceptable. `retiro-estados-migration.test.ts` cambia 5 llamadas `executeRawUnsafe(UP/DOWN)` por `enLaEraAnterior455(...)`: fuera de la lista autorizada por el leader, pero registrado en `impl_455_backend.md` (Reconciliación 1) y necesario (el SQL histórico dice `devuelta`).
- **m6 — el `down.sql` de M3 repone `pendiente` con un id NUEVO** (medido). Declarado en el archivo y en design §3.1; inocuo porque solo se borra sin referencias.
- **m7 —** la tabla de trazabilidad de `tasks.md` cita archivos que no existen (`estatus-label.test.ts`, `gestion-resultado.test.ts`, `cierre-labels.test.ts`, `novedad-grupo-textos.test.ts`, `pos-estado.test.ts`, `recoger-module.test.tsx`, `chat-format.test.ts`, `pos-order-card.test.tsx`, `historial-orden-timeline.test.tsx`, `filtro-estado-def.test.ts`, `satelite-ordenes-filtros.test.ts`); los reales están en los mapas de las bitácoras y en §1.

## 1. Trazabilidad (verificada ejecutando)

Corridas propias sobre `fd5b64de`: redes `tests/integration/db/454` + `455` → **68 archivos / 339 tests, 0 skipped, exit 0**; guardias → 249/3517, exit 0; tests citados (65 archivos, 1102 tests), exit 0; y `tests/components` + `tests/unit` completos corrieron dentro de la mutación V9b con solo los 7 rojos que la mutación provoca.

| R | Test que lo verifica (existe y pasa) |
|---|---|
| R1, R43 | `tests/unit/types/nombre-estado-catalogo.test.ts` (G4; lee `textos-aprobados.md` del disco) |
| R2 | `tests/unit/components/estatus-badge.test.tsx` «los 20, sin zona»; `PorRecibirModule.test.tsx`; `nombre-de-estado.test.ts` |
| R3 | G3 `fuente-unica-nombre-estado.guardia`; `estatus-badge` R10; C05 INTERMEDIO |
| R4 | `nombre-de-estado.test.ts` «R4»; `textos-estado-455` (cierres); `cierre-resultado-fila-label` |
| R5, R6 | `textos-estado-455.test.tsx`; C04/C14 INTERMEDIO; G2 — **ver M2** |
| R7, R8 | `PosOrderCard.estado-455.test.tsx`; `RepartoAyuda`; `textos-estado-455` (chat) |
| R9 | `estatus-badge` «bodega siempre entera»; G2 (abreviatura) |
| R10, R11 | `nombre-de-estado.test.ts`; `estatus-badge`; `HistorialOrdenTimeline.evento-orden`; `CierreFacturaSinGestionar` |
| R12 | `PosOrderCard.estado-455` «R12»; `textos-estado-455` chat; G3 |
| R13, R40 | G1 `censo-order-status-rename.test.ts` (brazo 455) |
| R14–R19 | `tests/integration/db/455/migracion.test.ts` + prueba propia en clon nuevo (§3) |
| R18 selector | `SateliteFiltroEstadoAlcance`, `satelite-filtro-estado` (ver m3) |
| R20 | `tests/integration/db/455/seed.test.ts` |
| R21, R45 | C01, C02 |
| R22 | C02 INTERMEDIO; `nombre-de-estado` «codigoVigente» |
| R23 | C16 INTERMEDIO; `455/snapshot-lectura.test.ts` |
| R24, R27 | C12 INTERMEDIO; `ordenes-api-key-orden-consulta.route.test.ts`; `orden-repository.carga-api` / `carga-api-*` |
| R25 | C11 INTERMEDIO; `WebhookEventoOrdenService.test.ts`; `webhook-estado-service*.test.ts` |
| R26 | `tests/integration/api/ordenes-api-key-listado-codigo-anterior.route.test.ts`; C12 |
| R28, R50 | C11 invariantes |
| R29 | `openapi-nombres-455.guardia` (G5), `openapi-contrato-en-reparto`, `openapi-webhook-contrato` |
| R30 | `tests/unit/api/changelog-455.test.ts`; G1 sobre los docs de integradores |
| R31–R34 | C13; `454/rastreo-pendiente-sql-real`; `rastreo-publico-service`; `RastreoDialog.pendiente`; `rastreo-sin-estatus-crudo.guardia`; `rastreo-hitos-exhaustivo.guardia` |
| R35 | C15 INTERMEDIO; `plantilla-datos.test.ts` |
| R36 | `notificacion-orden-rechazada.test.ts` |
| R37, R38, R41 | G2 (árbol, `docs/ayuda`, `contextoPara` por rol) — **ver M1–M3** |
| R39 | `PorRecibirModule`, `SateliteFiltroEstadoAlcance`, `SateliteOrdenesListado.gestion-pendiente` + G2/G3 sobre todo el árbol; recorrido T3.2 pendiente — **M1 cae en SF-001** |
| R42 | G3; `estatus-badge` «R42» |
| R44 | casos MUTACION dentro de G1–G5 + tablas de mutaciones de las bitácoras + §4 |
| R46 | C03–C07 |
| R47 | C08 |
| R48 | C10 |
| R49 | C09 |
| R51 | `tests/unit/auth/menu-visibility.test.ts` (ruta `/mis-asignaciones/recoger` intacta) |
| R52 | C04, C05 |
| R53 | `tests/integration/db/454/**` (49 archivos) verde con los códigos vigentes |

## 2. Redes de caracterización

Método: cada archivo de la red en su versión base (454: `0bd66809`; 455: `33ef583c`, cierre de la Fase 0, porque `0bd66809` no contiene la Fase 0), normalizado con la tabla §0.1 (los 7 códigos, como literal y como palabra completa, en ambos lados) y comparado con `fd5b64de`.

- **Red 454 (49 archivos):** 1 idéntico, **45 solo renombre de código** (literales, claves, nombres de test y comentarios), 3 con cambios reales: `caracterizacion/rastreo-y-historial-legado.test.ts` y `rastreo-pendiente-sql-real.test.ts` (autorizados; traducción hito→nombre 1:1, misma forma `toEqual`, nota fechada; ver m5) y `retiro-estados-migration.test.ts` (envoltorio `enLaEraAnterior455`, registrado; ver m5). Ninguna aserción de invariante cambió fuera de eso.
- **Red 455 (21 archivos):** 8 idénticos, 4 nuevos (`migracion`, `seed`, `snapshot-lectura`, `_era-anterior`), 9 cambiados. En los 9, todo cambio de ASERCIÓN está dentro del bloque INTERMEDIO con nota fechada. Fuera de él solo hay: la línea de C12 que lee `estado` (autorizada), extracción aditiva de campos nuevos en los `beforeAll` (C11 `estadoNombre`; C12 `nombrePorClave`, `anteriores`, `nombresGestion`, `nombreFila`; C02 `desdeUrlVieja`, `urlVieja`) y, en C13, las dos líneas de extracción que leían `hito` (el DTO ya no lo tiene: `l.nombre`). Los invariantes (conteos, fechas, órdenes devueltas) no se tocaron.

## 3. Migraciones (clon nuevo, medido)

`CREATE DATABASE ordenex_455_rev TEMPLATE ordenex` (la base compartida, SIN la 455) → `prisma migrate deploy` aplicó M1–M3 con los archivos FINALES desde cero (exit 0). Los checksums registrados en `ordenex_455` coinciden con el sha256 de los archivos actuales (M2 `8e71ed27…`): la edición posterior de M2 no dejó drift. Fotos comparadas: catálogo id→value, etiquetas y OID de `gestion_resultado`, OID del tipo, md5 de `orden.id:estatus_id`, md5 de `gestion_orden.id:resultado`, md5 del historial, conteo de `jobs` y `notificacion`.

| Paso | Resultado |
|---|---|
| base → UP | 7 filas renombradas con el MISMO id; `pendiente` borrado (sin referencias), `en_fulfillment` conservado (el historial lo cita); 4 etiquetas renombradas con los MISMOS OID de valor y de tipo; órdenes, historial, jobs (211) y notificaciones (76) idénticos (R14, R15, R19) |
| UP → DOWN (M3, M2, M1) | idéntico a la base salvo `pendiente` repuesto con id nuevo (m6); enum y OID idénticos, sin `CREATE TYPE` (R17) |
| DOWN → UP | idéntico al primer UP |
| UP → UP | sin cambios, sin error (R16) |
| valor añadido después + DOWN de M2 | `ALTER TYPE … ADD VALUE z_revisor_455` y DOWN → la etiqueta nueva sobrevive (R17) |

M2: `ALTER TYPE … RENAME VALUE` en un `DO` idempotente acotado a `current_schema()`; su down renombra al revés sin recrear el tipo. M1: `UPDATE` por igualdad con guardia de choque. M3: FK leídas de `pg_constraint`. El clon `ordenex_455_rev` se BORRÓ al terminar (quedan `ordenex`, `ordenex_rel`, `ordenex_455`).

## 4. Mutaciones propias

Harness propio: reemplazo literal comprobado, vitest, restauración byte a byte comprobada; el árbol de trabajo quedó limpio al final (comprobado).

| Id | Pieza | Mutación | Resultado |
|---|---|---|---|
| V1 | Fuente única `NOMBRE_ESTADO` | «Por devolver a tienda» → «Por devolver a la tienda» | ROJO: `nombre-estado-catalogo` (3) |
| V2 | 422 con mensaje | `mensajeCodigoAnterior(...)` → `undefined` en `app/api/ordenes/api-key/route.ts` | ROJO: `ordenes-api-key-listado-codigo-anterior.route` + C12 R26 |
| V3 | `…Nombre` en la API | `estadoResultanteNombre` calculado con `g.resultado` en vez de `g.estadoResultante` | ROJO: `ordenes-api-key-orden-consulta.route` (405/R1) |
| V4 | `…Nombre` en el webhook | `resultadoAnteriorNombre` calculado con `data.resultado` | ROJO: `WebhookEventoOrdenService` «gestion corregida» |
| V5 | Filtro SQL por código nuevo | `AnaliticaRollupRepository`: `rechazos` filtra `novedad` en vez de `devolucion_a_origen_por_rechazo` | ROJO: C05 (2) |
| V6 | Lector del rastreo | pendiente con nombre fijo «Entregado» | ROJO: C13 + `454/rastreo-pendiente-sql-real` (ver m4) |
| V7 | G1 | `export const __MUT_REVISOR = por_devolver` (literal) en `lib/types/gestion-resultado.ts` | ROJO: G1 brazo 455 |
| V8 | G2 | `export const __MUT_REVISOR = En detalle` (literal) en `pos-estado.ts` | ROJO: G2 árbol |
| V9 | Excepción de G2 | `NOTA_AYUDA_SOLICITADA = Sin gestionar` | G2 **VERDE** (sobrevive); con `tests/components` + `tests/unit`: ROJO en 7 tests de componente (m1) |

## 5. Contrato

- `docs/api/CHANGELOG.md`: entrada «2026-09-24 — ⚠️ RUPTURA» con la tabla de 7 estados y la de 4 resultados, campos `…Nombre` por superficie, `filas.estatus` → `filas.estado`, el `422` con ejemplo, `eventoId` igual y fecha de despliegue marcada PENDIENTE (se completa en T5.2).
- `.yaml` ↔ `openapi-spec.ts` comparados estructuralmente (js-yaml contra el objeto TS): 4 diferencias, todas en descripciones de `CotizacionEscenarioDevuelto` y PREEXISTENTES (esas líneas no cambian entre `0bd66809` y `fd5b64de`). Enum de estado = los 20 de `ORDER_STATUS_SEED`; el `.yaml` no cita ningún código anterior.
- Postman: ejemplo del filtro `estado=en_reparto`, descripción del 422 y test de la respuesta con `estadoNombre`. Sin códigos anteriores ni `estatus`.

## 6. Qué falta para aprobar

1. M1: `envio-devolucion-central-error-messages.ts:21` interpolando el nombre vigente (o texto sin nombre de estado), con test.
2. M2: los cinco rótulos y `docs/ayuda/tienda/novedades.md:30` reescritos (o aceptados por el humano por escrito, uno por uno).
3. M3: G2 con `“”` y el brazo de palabra completa, con su caso de mutación, para que R41 quede verificado como está escrito.
4. M4: `tasks.md` sincronizado (y la tabla de trazabilidad con los archivos reales, m7).
5. Después: T3.1, T3.2 y el `./init.sh` completo que hará el leader.
