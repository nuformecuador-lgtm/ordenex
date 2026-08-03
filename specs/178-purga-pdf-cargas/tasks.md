# Feature 178 — Tasks

Checklist de pasos discretos y verificables. `[P]` = paralelizable dentro de su bloque.
Cada task trae su criterio de "hecho" y los `R<n>` que cubre. Al final, el mapa de trazabilidad
`R<n>→test` que el reviewer verifica (`docs/specs.md` §Trazabilidad).

> **PUERTA F1.4 ABIERTA.** Cuatro preguntas sin cerrar en `requirements.md`
> —(a) fecha de corte, (b) fallo parcial, (c) cola vs cron, (d) órdenes sin lote— más (e) día/hora.
> **T0 es bloqueante:** nada del bloque B en adelante se escribe antes de que el humano responda.
> Las tasks marcadas **[dep-(x)]** cambian de contenido según la respuesta a esa pregunta.

---

## Bloque 0 — Puerta y reconocimiento (bloqueante, primero)

- [ ] **T0** — Registrar en `progress/impl_178.md` las respuestas del humano a (a)-(e) y ajustar
  este archivo y `design.md` a la decisión tomada. **Hecho:** las cinco respuestas escritas con
  fecha; ninguna task **[dep-(x)]** queda ambigua.
- [ ] **T1 [P]** — Verificar contra el código (no contra este spec) y anotar con `archivo:línea`
  en `progress/impl_178.md`: (i) `Carga` sigue teniendo `created_at` y `fecha_carga` y ningún
  código escribe `fecha_carga`; (ii) `IFileStorage.remove` sigue existiendo y
  `SupabaseFileStorage.remove` sigue descartando el error; (iii) `ApiPdfEtiquetaService` sigue
  decidiendo por `download_storage_path`; (iv) `buildHandlers`/`buildRecurrencias` siguen
  exportadas en `procesar-jobs/route.ts`; (v) `job_tipo` tiene hoy 7 valores y en qué orden.
  **Hecho:** los cinco puntos citados con `archivo:línea`.

## Bloque A — Migraciones (depende de T0; dos carpetas, dos commits)

- [ ] **T2** — Migración `<ts>_job_tipo_purga_pdf_cargas/` con **una sola** sentencia
  `ALTER TYPE "job_tipo" ADD VALUE IF NOT EXISTS 'purga_pdf_cargas'` y su `down.sql`
  (DELETE de los jobs de ese tipo + recreación del enum con los 7 valores previos **en su orden
  exacto**). Añadir el valor al `enum JobTipo` de `db/schema.prisma`. **Hecho:** test estático de
  migración (patrón `tests/integration/db/job-tipo-analitica-rollup-migration.test.ts`) que
  afirma: carpeta con una única sentencia ejecutable, `IF NOT EXISTS`, `down.sql` con los 7
  valores y sin el nuevo; `pnpm db:migrate` aplica y `pnpm db:rollback` revierte. [R26]
- [ ] **T3 [dep-(a)]** — Migración `<ts>_purga_pdf_indices/` con los dos `CREATE INDEX` parciales
  (`carga_purga_pendiente_idx` sobre la columna de corte decidida en (a),
  `orden_purga_pendiente_idx` sobre `carga_id`) y `down.sql` con los dos `DROP INDEX` en orden
  inverso. **Hecho:** test estático que afirma que el UP solo crea índices (cero DDL sobre datos)
  y que el DOWN los suelta; migración aplicada y revertida sin error. [R26]
- [ ] **T4** — Medir el drift: `pnpm db:migrate:create` sobre una base con T2+T3 aplicadas.
  **Hecho:** si la migración propuesta viene vacía, se descarta; si propone `DROP INDEX` de los
  parciales (Prisma no los expresa), se documenta ese hecho en el encabezado de `migration.sql`
  de T3 y en `progress/impl_178.md`. **Nunca** se resuelve borrando el índice.

## Bloque B — Configuración (independiente de A; `[P]`)

- [ ] **T5 [P]** — `lib/config/purga-pdf.ts` con `loadPurgaPdfConfig()`:
  `PURGA_PDF_RETENCION_DIAS` (default 7, mínimo 1, **sin clamp superior**) y
  `PURGA_PDF_MAX_CARGAS_POR_CORRIDA` (default 200). **Sin** singleton exportado.
  **Hecho:** test unitario: ausente→7, `""`→7, `"0"`→7, `"-3"`→7, `"abc"`→7, `"1"`→1,
  `"36500"`→36500 (no se acota), `"200"`/default del tope; y un test que afirma que el módulo
  **no** exporta una constante ya resuelta. [R1, R2, R3, R21]
- [ ] **T6 [P]** — Documentar las dos env en `.env.example` junto al bloque 136/177.
  **Hecho:** las dos claves presentes con su default y su significado; sin valor asignado.

## Bloque C — Repositorio (depende de A)

- [ ] **T7 [dep-(a)]** — `IPurgaPdfCargasRepository` + `PurgaPdfCargasRepository` con
  `findCargasPurgables(corte, limite)`. **Hecho:** test unitario con Prisma mockeado que afirma:
  el `where` usa la columna de corte decidida con comparación **estricta** `<`; exige referencia
  viva (propia o vía `EXISTS` de órdenes); ordena ASC por la columna de corte; respeta `limite`;
  y **no** filtra por `deleted_at` al recoger las órdenes del lote. [R5, R7, R8, R9]
- [ ] **T8 [P]** — `quedanCargasPurgables(corte, limite)`. **Hecho:** test unitario: devuelve
  `true` cuando hay al menos una candidata más allá del tope y `false` cuando no. [R22]
- [ ] **T9** — `limpiarReferencias(cargaId)`: una transacción, `UPDATE orden` por `carga_id`
  (todas, incluidas las borradas) y `UPDATE carga` por `id`, poniendo a NULL **las cuatro**
  columnas. **Hecho:** test unitario que afirma que el `data` de ambos updates contiene
  **exactamente** `downloadUrl: null` y `downloadStoragePath: null` (ninguna otra clave), que no
  hay ningún `delete`, y que el update de órdenes no lleva `deletedAt` en el `where`.
  [R13, R14, R15, R9]

## Bloque D — Servicio (depende de B y C)

- [ ] **T10** — `IPurgaPdfCargasService` + `PurgaPdfCargasService.ejecutar(now)` con el flujo de
  `design.md` §4.3, dependencias por constructor. **Hecho:** test unitario con repo y storage
  dobles: calcula el corte como `now − N días` leyendo la config **en cada llamada** (dos llamadas
  con config distinta ⇒ dos cortes distintos). [R4, R5]
- [ ] **T11** — Borrado en Storage: una sola llamada a `remove` por carga con
  `[cargaPath, ...ordenPaths]` sin nulos. **Hecho:** test unitario que afirma que las rutas
  enviadas incluyen la del consolidado **y** las de todas las órdenes del lote, y que con cero
  rutas **no se llama** a `remove`. [R10, R12]
- [ ] **T12 [dep-(b)]** — Orden de operaciones: `remove` **antes** de `limpiarReferencias`, y
  limpieza incondicional tras un `remove` que no lanza. **Hecho:** test unitario que fija el orden
  de las llamadas y, con un `remove` que lanza, afirma que **no** se limpian columnas y que el
  error se propaga (para que la cola reintente). [R20]
- [ ] **T13 [P]** — Respeto de la ventana de retención. **Hecho:** test unitario con fixture de
  tres cargas (N−1 días, exactamente N días, N+1 días): solo la de N+1 entra; la de exactamente N
  **no** (comparación estricta). [R6]
- [ ] **T14 [P] [dep-(d)]** — Órdenes sin lote. **Hecho:** test que afirma que ninguna consulta ni
  ningún `remove` alcanza a una orden con `carga_id` NULL y con `download_storage_path` poblado.
  [R17]
- [ ] **T15 [P]** — Conteos agregados y `quedaPendiente`. **Hecho:** test unitario que verifica
  `cargasPurgadas`/`ordenesAfectadas`/`objetosBorrados`/`quedaPendiente`, y que lo que se loguea
  **solo contiene números** (ni rutas, ni `carga_id`, ni ids de usuario). [R24]
- [ ] **T16** — Idempotencia. **Hecho:** test que ejecuta dos veces sobre el mismo repo doble: la
  segunda corrida no encuentra candidatas, no llama a `remove` y no escribe columnas. [R20, R8]

## Bloque E — Handler, recurrencia y registro (depende de D) **[dep-(c)]**

- [ ] **T17 [dep-(e)]** — `lib/services/jobs/purga-pdf-cargas-encolado.ts` (módulo puro:
  `DEDUPE_PREFIX`, `dedupeKeyPurga`) y `purga-pdf-cargas-handler.ts` con
  `proximaCorridaPurgaCR(now)` (domingo 03:00 CR salvo (e)), `recurrenciaPurgaPdfCargas`,
  `crearPurgaPdfCargasHandler(service, now)` y `buildPurgaPdfCargasService()`.
  **Hecho:** test unitario del reloj: desde un lunes, un sábado y un domingo (antes y después de
  las 03:00 CR) devuelve siempre el **próximo** domingo 03:00 CR estricto, y la `dedupeKey` es la
  de esa fecha CR. El módulo de encolado **no importa** Prisma. [R18, R19]
- [ ] **T18** — Composition root con el **bucket de etiquetas**:
  `new SupabaseFileStorage(undefined, etiquetasConfig.ETIQUETAS_BUCKET)`. **Hecho:** test que
  afirma que el storage se construye con `ETIQUETAS_BUCKET` y **no** con el default de
  postulaciones. [R11]
- [ ] **T19** — Troceado: si `quedaPendiente`, el handler encola la continuación (`runAfter = now`,
  payload `{ continuacion: n+1 }`, `dedupeKey` con sufijo `:cont:<n+1>`); el payload entrante se
  valida con zod y un payload inesperado se trata como `{}`. **Hecho:** test unitario del handler
  con service doble: con pendiente ⇒ un `enqueue` con esos argumentos; sin pendiente ⇒ ninguno.
  [R22]
- [ ] **T20** — Registrar el tipo en `buildHandlers()` **y** en `buildRecurrencias()` de
  `app/api/cron/procesar-jobs/route.ts`. **Hecho:** ampliar
  `tests/unit/api/procesar-jobs-registro.test.ts`: `purga_pdf_cargas` está en ambos mapas y los
  tipos por evento siguen fuera de `buildRecurrencias()`. [R18, R19]
- [ ] **T21 [P]** — `scripts/seed-jobs-purga-pdf-cargas.ts` (idempotente, patrón
  `seed-jobs-analitica-rollup-diario.ts`) + script en `package.json`. **Hecho:** test que afirma
  que llama a `enqueue` con `runAfter` de la próxima corrida y su `dedupeKey`, y que una segunda
  ejecución no crea fila (`ON CONFLICT DO NOTHING` ⇒ `null`). [R18]
- [ ] **T22** — Autorización. **Hecho:** test que afirma que sin `Bearer <CRON_SECRET>` correcto
  el drenador responde 401 **sin construir** el service de purga (basta ampliar/reusar el test
  existente de `procesar-jobs`) y que no existe ninguna otra ruta que dispare la purga. [R25]
- [ ] **T23** — Reintentos y continuidad de la serie. **Hecho:** test que, con un handler que
  lanza, afirma que `JobQueueService` reintenta con backoff, tras agotar intentos marca `failed`
  y **aun así** re-agenda la ocurrencia semanal siguiente. [R23, R19]

## Bloque F — Integración con la feature 177 (el requisito caro; depende de E)

- [ ] **T24** — Test de integración **de extremo a extremo del estado de datos**: partir de una
  carga con `download_storage_path` poblado en la carga y en sus órdenes, ejecutar la purga y
  después invocar `POST /api/ordenes/api-key/carga/{cargaId}/generate` y
  `POST /api/ordenes/api-key/orden/{id}/generate`. **Hecho:** ambas respuestas son `200` con
  `generado: true`, se invocó al generador de PDF, y la URL devuelta corresponde a un objeto
  **subido en esa llamada** (no a la ruta purgada). Si este test no existe, la feature está
  incompleta aunque todo lo demás pase. [R16]
- [ ] **T25 [P]** — Test negativo del mismo par: **antes** de la purga, `/generate` devuelve
  `generado: false` (reuso). Es el control que hace discriminante a T24: sin él, T24 pasaría
  aunque la purga no hiciera nada. [R16]

## Bloque G — Cierre

- [ ] **T26** — `pnpm typecheck` y la suite completa en verde respecto del baseline medido de
  `dev` (medirlo, no citarlo). **Hecho:** delta 0 rojos.
- [ ] **T27** — Mapa `R<n>→test` completo en `progress/impl_178.md`, con los riesgos declarados
  copiados: huérfanos de la 136/141 inalcanzables, órdenes con `carga_id` NULL fuera,
  `objetosBorrados` = "solicitados" y no "confirmados". **Hecho:** los 26 requisitos con un test
  nombrado cada uno.

---

## Mapa de trazabilidad `R<n>` → test

| R | Qué fija | Task | Test |
|---|---|---|---|
| R1 | retención desde env | T5 | `config/purga-pdf` — lee `PURGA_PDF_RETENCION_DIAS` |
| R2 | default 7 ante ausente/inválida/`<1` | T5 | `config/purga-pdf` — casos `undefined`/`""`/`"0"`/`"-3"`/`"abc"` |
| R3 | sin tope superior | T5 | `config/purga-pdf` — `"36500"` se respeta |
| R4 | config resuelta por corrida | T10 | `PurgaPdfCargasService` — dos corridas, dos cortes |
| R5 | corte = `now − N días` | T7, T10 | repo: `where` con `<` estricto; service: cálculo del corte |
| R6 | dentro de la ventana no se toca nada | T13 | fixture N−1 / N / N+1 días |
| R7 | agrupación por `carga_id` | T7 | repo devuelve la unidad carga+órdenes |
| R8 | no reselecciona cargas ya purgadas | T7, T16 | predicado de referencia viva; 2.ª corrida vacía |
| R9 | incluye órdenes borradas | T7, T9 | sin `deleted_at` en `where` (lectura y update) |
| R10 | borra consolidado + individuales | T11 | rutas enviadas a `remove` |
| R11 | bucket de etiquetas | T18 | composition root con `ETIQUETAS_BUCKET` |
| R12 | sin rutas ⇒ sin `remove` | T11 | `remove` no invocado |
| R13 | NULL en las 2 columnas de `carga` | T9 | `data` exacto del update de carga |
| R14 | NULL en las 2 columnas de `orden` | T9 | `data` exacto del update de órdenes |
| R15 | ninguna otra columna, ninguna fila borrada | T9 | claves del `data` + ausencia de `delete` |
| R16 | `/generate` vuelve a generar tras la purga | **T24**, T25 | integración 177: `generado: true` (y `false` antes) |
| R17 | órdenes sin lote intactas | T14 | orden con `carga_id` NULL no alcanzada |
| R18 | cadencia semanal | T17, T20, T21 | reloj CR, registro, semilla |
| R19 | siguiente ocurrencia siempre agendada | T17, T20, T23 | recurrencia registrada; re-agenda tras `failed` |
| R20 | idempotencia | T12, T16 | orden de operaciones; 2.ª corrida sin efectos |
| R21 | tope configurable por corrida | T5 | default 200 y override por env |
| R22 | continuación del trabajo pendiente | T8, T19 | `quedanCargasPurgables`; `enqueue` de continuación |
| R23 | reintentos sin detener la serie | T23 | backoff → `failed` → re-agenda |
| R24 | conteos sin PII | T15 | resumen solo numérico |
| R25 | no disparable sin `CRON_SECRET` | T22 | 401 sin construir el service |
| R26 | migración reversible | T2, T3 | tests estáticos UP/DOWN + `db:rollback` |

**Dependencias:** T0 → (T1, A, B) ; A → C ; (B, C) → D ; D → E ; E → F ; F → G.
Paralelizable dentro de cada bloque lo marcado `[P]`.
