# Feature 178 — Tasks

Checklist de pasos discretos y verificables. `[P]` = paralelizable dentro de su bloque.
Cada task trae su criterio de "hecho" y los `R<n>` que cubre. Al final, el mapa de trazabilidad
`R<n>→test` que el reviewer verifica (`docs/specs.md` §Trazabilidad).

> **PUERTA F1.4 CERRADA.** (a) corte por **`carga.created_at`** + su índice, en alcance;
> (b) fallo parcial: **limpiar igual, best-effort, sin reintentos internos**; (c) **cron propio**
> en `vercel.json`, NO la cola de la 90; (d) órdenes con `carga_id` NULL **fuera**; (e) cadencia
> **DIARIA** a las **03:00 CR**; (f) `N ≥ 0`, default 7, sin tope, corte **inclusivo**.
>
> **Cambios respecto de la versión anterior de este spec:** **ningún requisito nació ni murió**
> —siguen siendo **26 (R1-R26)**—, pero **ocho cambiaron de contenido**: R2 y R3 (mínimo pasa de
> 1 a 0), R5 y R6 (columna `created_at` fijada y corte **inclusivo** `<=`), R18 (semanal → **diaria
> a las 03:00 CR**), R19 (de "re-agendar la siguiente ocurrencia en la cola" a "**la corrida del
> día siguiente** retoma el pendiente"), R22 (de "encolar la continuación" a "terminar en éxito
> declarando pendiente"), R23 (de "reintentos de la cola" a "**el código HTTP distingue éxito de
> fallo**") y R26 (la migración ya **no** incluye valor de enum: solo índices).
> **En tasks:** mueren T2 (enum `job_tipo`), T17/T19/T20/T21 (handler de cola, dedupe,
> continuación encolada, registro y semilla) y nacen T2' (ruta de cron), T17' (`vercel.json`) y
> T19' (tope + pendiente). La numeración se rehace entera abajo; esta es la lista vigente.

---

## Bloque 0 — Reconocimiento (bloqueante, primero)

- [x] **T1** — Verificar contra el código (no contra este spec) y anotar con `archivo:línea` en
  `progress/impl_178.md`: (i) `Carga.createdAt` existe y **no** está indexado; (ii)
  `IFileStorage.remove` sigue existiendo y `SupabaseFileStorage.remove` sigue descartando el
  error del SDK; (iii) `ApiPdfEtiquetaService` sigue decidiendo por `download_storage_path`;
  (iv) `vercel.json` no tiene ninguna entrada a las `0 9 * * *`; (v) el patrón de autorización de
  `procesar-devueltas-sla` (secreto, 401 antes de efectos, deps inyectables) sigue vigente.
  **Hecho:** los cinco puntos citados con `archivo:línea`.

## Bloque A — Migración de índices (depende de T1; commit propio)

- [x] **T2** — Crear `db/migrations/<ts>_purga_pdf_indices/` con `migration.sql` (los dos
  `CREATE INDEX` **parciales**: `carga_purga_pendiente_idx` sobre `created_at` y
  `orden_purga_pendiente_idx` sobre `carga_id`) y `down.sql` (los dos `DROP INDEX` en orden
  inverso). **Hecho:** test estático de migración (patrón
  `tests/integration/db/*-migration.test.ts`) que afirma que el UP **solo** crea índices —cero
  DDL sobre datos, ningún `ALTER TABLE`— y que el DOWN los suelta; `pnpm db:migrate` aplica y
  `pnpm db:rollback` revierte sin error. [R26]
- [x] **T3** — Medir el drift: `pnpm db:migrate:create` sobre una base con T2 aplicada.
  **Hecho:** si la migración propuesta viene vacía, se descarta; si propone `DROP INDEX` de los
  parciales (Prisma no los expresa), se documenta en el encabezado de `migration.sql` y en
  `progress/impl_178.md`. **Nunca** se resuelve borrando el índice.

## Bloque B — Configuración (independiente de A; `[P]`)

- [x] **T4 [P]** — `lib/config/purga-pdf.ts` con `loadPurgaPdfConfig()` y un
  `readNonNegativeInt` local (el `readPositiveInt` de `jobs.ts`/`etiquetas.ts` **rechaza el 0** y
  contradiría R3): `PURGA_PDF_RETENCION_DIAS` (default 7, mínimo 0, **sin clamp superior**) y
  `PURGA_PDF_MAX_CARGAS_POR_CORRIDA` (default 200). **Sin** singleton exportado.
  **Hecho:** test unitario: ausente→7, `""`→7, `"abc"`→7, `"-1"`→7, **`"0"`→0**, `"1"`→1,
  `"36500"`→36500 (no se acota), tope default 200 y override; más un test que afirma que el
  módulo **no** exporta una constante ya resuelta al importar. [R1, R2, R3, R21]
- [x] **T5 [P]** — Documentar las dos env en `.env.example` junto al bloque 136/177, indicando
  que `0` es válido y qué implica. **Hecho:** las dos claves presentes con default y significado,
  sin valor asignado.

## Bloque C — Repositorio (depende de A)

- [x] **T6** — `IPurgaPdfCargasRepository` + `PurgaPdfCargasRepository` con
  `findCargasPurgables(corte, limite)`. **Hecho:** test unitario con Prisma mockeado que afirma:
  el `where` usa **`createdAt`** (nunca `fechaCarga`) con comparación **inclusiva `<=`**; exige
  referencia viva (propia o vía `EXISTS` de órdenes); ordena **ASC**; respeta `limite`; y **no**
  filtra por `deleted_at` al recoger las órdenes del lote. [R5, R7, R8, R9]
- [x] **T7 [P]** — `existeAlgunaCandidata(corte)`, SIN `skip`. **Hecho:** test unitario: `true`
  cuando queda al menos una candidata, `false` cuando no; y el argumento a `findFirst` **no
  lleva clave `skip`** (fijado como contrato tras el bloqueante del review). [R22]
- [x] **T8** — `limpiarReferencias(cargaId)`: una transacción, `UPDATE orden` por `carga_id`
  (todas, incluidas las borradas) y `UPDATE carga` por `id`, poniendo a NULL **las cuatro**
  columnas. **Hecho:** test unitario que afirma que el `data` de ambos updates contiene
  **exactamente** `downloadUrl: null` y `downloadStoragePath: null` (ninguna otra clave), que no
  hay ningún `delete`, y que el update de órdenes no lleva `deletedAt` en el `where`.
  [R13, R14, R15, R9]

## Bloque D — Servicio (depende de B y C)

- [x] **T9** — `IPurgaPdfCargasService` + `PurgaPdfCargasService.ejecutar(now)` con el flujo de
  `design.md` §4.3, dependencias por constructor. **Hecho:** test unitario con repo y storage
  dobles: el corte es `now − N días` y la config se lee **en cada llamada** (dos llamadas con
  config distinta ⇒ dos cortes distintos). [R4, R5]
- [x] **T10 [P]** — Caso `N = 0`. **Hecho:** test que afirma que con retención 0 el corte es
  `now` y una carga creada esa misma mañana **entra** en la selección (consecuencia declarada en
  `requirements.md`). [R3, R5]
- [x] **T11** — Borrado en Storage: una sola llamada a `remove` por carga con
  `[cargaPath, ...ordenPaths]` sin nulos. **Hecho:** test unitario que afirma que las rutas
  enviadas incluyen la del consolidado **y** las de todas las órdenes del lote, y que con cero
  rutas **no se llama** a `remove`. [R10, R12]
- [x] **T12** — Orden de operaciones y política de fallo (decisión (b)): `remove` **antes** de
  `limpiarReferencias`; tras un `remove` que no lanza, se limpia **siempre**; si `remove` lanza,
  esa carga **no** se limpia, el error se propaga y **no hay reintento interno**. **Hecho:** test
  unitario que fija el orden de llamadas y ambos caminos, y que verifica que no existe ningún
  bucle/espera de reintento. [R20, R19]
- [x] **T13 [P]** — Respeto de la ventana de retención con corte inclusivo. **Hecho:** test con
  fixture de tres cargas (N−1 días, **exactamente N días**, N+1 días): entran la de N y la de
  N+1; la de N−1 **no**. [R6, R5]
- [x] **T14 [P]** — Órdenes sin lote. **Hecho:** test que afirma que ninguna consulta ni ningún
  `remove` alcanza a una orden con `carga_id` NULL y `download_storage_path` poblado. [R17]
- [x] **T15 [P]** — Conteos agregados y `quedaPendiente`. **Hecho:** test unitario que verifica
  `cargasPurgadas`/`ordenesAfectadas`/`objetosBorrados`/`quedaPendiente`, y que lo que se loguea
  **solo contiene números** (ni rutas, ni `carga_id`, ni ids de usuario). [R24]
- [x] **T16** — Idempotencia. **Hecho:** test que ejecuta dos veces sobre el mismo repo doble: la
  segunda corrida no encuentra candidatas, no llama a `remove` y no escribe columnas. [R20, R8]
- [x] **T17** — Tope por corrida y pendiente. **Hecho:** test con más candidatas que el tope: se
  procesan exactamente `PURGA_PDF_MAX_CARGAS_POR_CORRIDA`, la corrida termina **sin error** y
  devuelve `quedaPendiente: true`. [R21, R22]

## Bloque E — Cron propio (depende de D)

- [x] **T18** — `app/api/cron/purga-pdf-cargas/route.ts`, clon estructural de
  `procesar-devueltas-sla/route.ts`: `handlePurgaPdfCargas(req, deps)` con `getSecret`/`service`/
  `now` inyectables, `GET` como único verbo exportado, `withErrorHandler` +
  `appErrorToResponse`, `maxDuration` declarado. **Hecho:** test de integración del handler con
  service doble: `200` con el resumen agregado. [R23, R24]
- [x] **T19** — Autorización. **Hecho:** test que afirma `401` **sin construir el service ni
  tocar Storage** en los tres casos: sin header, con token incorrecto y con `CRON_SECRET` no
  configurado en el entorno. [R25]
- [x] **T20** — Composition root con el **bucket de etiquetas**:
  `new SupabaseFileStorage(undefined, etiquetasConfig.ETIQUETAS_BUCKET)`. **Hecho:** test que
  afirma que el storage se construye con `ETIQUETAS_BUCKET` y **no** con el default de
  postulaciones. [R11]
- [x] **T21** — Fallo observable. **Hecho:** test con un service que lanza: la respuesta **no** es
  `200`, el cuerpo no filtra el secreto ni PII, y el error queda registrado. [R23]
- [x] **T22** — `vercel.json`: sexta entrada
  `{ "path": "/api/cron/purga-pdf-cargas", "schedule": "0 9 * * *" }` (= 03:00 CR, UTC−6 fijo).
  **Hecho:** test estático que afirma que la entrada existe con ese `path` y ese `schedule`, que
  el `schedule` es **diario** y que no colisiona con las horas de `corte-diario` /
  `generar-gastos-fijos` / los jobs de la cola. [R18]

## Bloque F — Integración con la feature 177 (el requisito caro; depende de E)

- [x] **T23** — Test de integración **de extremo a extremo del estado de datos**: partir de una
  carga con `download_storage_path` poblado en la carga y en sus órdenes, ejecutar la purga y
  después invocar `POST /api/ordenes/api-key/carga/{cargaId}/generate` y
  `POST /api/ordenes/api-key/orden/{id}/generate`. **Hecho:** ambas respuestas son `200` con
  `generado: true`, se invocó al generador de PDF, y la URL devuelta corresponde a un objeto
  **subido en esa llamada** (no a la ruta purgada). Si este test no existe, la feature está
  incompleta aunque todo lo demás pase. [R16]
- [x] **T24 [P]** — Control discriminante del anterior: **antes** de la purga, `/generate`
  devuelve `generado: false` (reuso). Sin él, T23 pasaría aunque la purga no hiciera nada. [R16]

## Bloque G — Cierre

- [x] **T25** — `pnpm typecheck` y la suite completa en verde respecto del baseline **medido** de
  `dev` (medirlo, no citarlo). **Hecho:** delta 0 rojos.
- [x] **T26** — Mapa `R<n>→test` completo en `progress/impl_178.md`, con los riesgos declarados
  copiados: huérfanos de la 136/141 inalcanzables, órdenes con `carga_id` NULL fuera,
  `objetosBorrados` = "solicitados" y no "confirmados", y ausencia de reintentos/dead-letter por
  no usar la cola. **Hecho:** los 26 requisitos con un test nombrado cada uno.

---

## Mapa de trazabilidad `R<n>` → test

| R | Qué fija | Task | Test |
|---|---|---|---|
| R1 | retención desde env | T4 | `config/purga-pdf` — lee `PURGA_PDF_RETENCION_DIAS` |
| R2 | default 7 ante ausente/inválida/negativa | T4 | casos `undefined`/`""`/`"abc"`/`"-1"` |
| R3 | mínimo 0, sin tope superior | T4, T10 | `"0"`→0 y `"36500"`→36500; con N=0 entra lo del día |
| R4 | config resuelta por corrida | T9 | `PurgaPdfCargasService` — dos corridas, dos cortes |
| R5 | corte `created_at <= now − N días` | T6, T9, T10, T13 | repo (`createdAt`, `<=`), service, N=0, fixture N±1 |
| R6 | dentro de la ventana no se toca nada | T13 | la carga de N−1 días queda intacta |
| R7 | agrupación por `carga_id` | T6 | repo devuelve la unidad carga+órdenes |
| R8 | no reselecciona cargas ya purgadas | T6, T16 | predicado de referencia viva; 2.ª corrida vacía |
| R9 | incluye órdenes borradas | T6, T8 | sin `deleted_at` en `where` (lectura y update) |
| R10 | borra consolidado + individuales | T11 | rutas enviadas a `remove` |
| R11 | bucket de etiquetas | T20 | composition root con `ETIQUETAS_BUCKET` |
| R12 | sin rutas ⇒ sin `remove` | T11 | `remove` no invocado |
| R13 | NULL en las 2 columnas de `carga` | T8 | `data` exacto del update de carga |
| R14 | NULL en las 2 columnas de `orden` | T8 | `data` exacto del update de órdenes |
| R15 | ninguna otra columna, ninguna fila borrada | T8 | claves del `data` + ausencia de `delete` |
| R16 | `/generate` vuelve a generar tras la purga | **T23**, T24 | integración 177: `generado: true` (y `false` antes) |
| R17 | órdenes sin lote intactas | T14 | orden con `carga_id` NULL no alcanzada |
| R18 | cadencia diaria 03:00 CR | T22 | `vercel.json` con `0 9 * * *` para la ruta |
| R19 | recuperación en la corrida siguiente, sin reintentos | T12 | `remove` que lanza: no limpia, propaga, sin reintento |
| R20 | idempotencia | T12, T16 | orden de operaciones; 2.ª corrida sin efectos |
| R21 | tope configurable por corrida | T4, T17 | default/override; se procesan exactamente `tope` |
| R22 | pendiente declarado, no encolado | T7, T17 | `existeAlgunaCandidata` sin `skip`; caso AL LÍMITE 3 candidatas/tope 2 → `true` en `purga-pdf-queda-pendiente-r22.test.ts`; `quedaPendiente: true` sin error |
| R23 | éxito vs fallo distinguibles | T18, T21 | `200` con resumen / respuesta de error sin PII |
| R24 | conteos sin PII | T15, T18 | resumen solo numérico |
| R25 | 401 sin efectos sin `CRON_SECRET` | T19 | tres casos de secreto, sin construir el service |
| R26 | migración reversible, solo índices | T2, T3 | test estático UP/DOWN + `db:rollback` + drift medido |

**Dependencias:** T1 → (A, B) ; A → C ; (B, C) → D ; D → E ; E → F ; F → G.
Paralelizable dentro de cada bloque lo marcado `[P]`.
