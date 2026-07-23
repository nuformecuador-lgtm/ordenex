# Feature 119 — Evidencias de gestión: de 1 a 1..N fotos · tasks.md

> Checklist verificable. `[P]` = paralelizable con las de su mismo bloque. Cada task con criterio de
> "hecho". La puerta de aprobación humana (`spec_ready`) va ANTES de la T1.

## Bloque A — Base de datos (fundacional, bloquea B/C/D)

- [ ] **T1 — Prisma: modelo `GestionOrdenEvidencia` + inverso en `GestionOrden`.**
  Añadir el modelo (design §1.1) y `evidencias GestionOrdenEvidencia[]` en `GestionOrden`.
  Hecho: `pnpm prisma generate` sin error; el cliente expone `prisma.gestionOrdenEvidencia`.

- [ ] **T2 — Migración UP + backfill + RLS** (depende de T1).
  `db/migrations/<ts>_gestion_orden_evidencia/migration.sql` con: CREATE TABLE, unique
  `(gestion_id, indice)`, index `gestion_id`, FK `ON DELETE CASCADE`, `ENABLE ROW LEVEL SECURITY`
  (sin policy) y el INSERT de backfill (design §1.2).
  Hecho: `pnpm run db:migrate` aplica limpio en local; una fila de `gestion_orden` con
  `evidencia_storage_path` produce exactamente una fila `indice 0`.

- [ ] **T3 — Migración DOWN** (depende de T2).
  `down.sql` con `DROP TABLE IF EXISTS "gestion_orden_evidencia";` (design §1.3).
  Hecho: `pnpm run db:rollback` deja la DB sin la tabla y `gestion_orden` intacta (portada viva).

## Bloque B — Contrato y backend (depende de A)

- [ ] **T4 [P] — Config: `MAX_EVIDENCIAS_POR_GESTION`.**
  `lib/config/gestion.ts`: campo nuevo con `readPositiveInt("GESTION_MAX_EVIDENCIAS", 5)` (design §3.2).
  Hecho: `gestionConfig.MAX_EVIDENCIAS_POR_GESTION === 5` sin env; override por env respetado.

- [ ] **T5 [P] — Tipos del service:** `GestionarInput.evidencias: EvidenciaArchivo[]` (3 ramas) y
  `GestionarServiceResult.evidenciaUrls?: string[]` en `IMisAsignacionesService.ts` (design §3.1).
  Hecho: type-check verde; `reprogramada` sigue sin evidencia.

- [ ] **T6 [P] — Tipos del repo:** `GestionOrdenData.evidencias?: {storagePath,contentType,indice}[]`
  en `IGestionOrdenRepository.ts` (design §3.6); columnas singulares conservadas.
  Hecho: type-check verde.

- [ ] **T7 — zod: `evidenciasSchema` (min 1 / max N) + ramas** (depende de T4).
  `lib/types/gestion-orden.ts`: `evidenciasSchema` y swap `evidencia`→`evidencias` en las 3 ramas de
  `gestionarSchema`; `validarEvidencia`/`evidenciaSchema` intactos (design §3.3). Añadir
  `evidenciaUrls?: string[]` en el `GestionarResult` de este archivo.
  Hecho: parse OK con 1..N fotos válidas; error de campo con 0, con >N y con una foto MIME/tamaño inválido.

- [ ] **T8 — Repo `crearGestionYTransicionar`: N filas + dual-write portada** (depende de T1/T6).
  `GestionOrdenRepository.ts`: dentro del `$transaction`, derivar portada (índice 0) a
  `evidenciaStoragePath/_content_type` y `createMany` de las N filas hijas; sumar
  `gestionOrden` → incluir `gestionOrdenEvidencia` en `GestionPrismaClient` (design §3.6).
  Hecho: unit con doble de tx confirma gestión + N evidencias + transición en la misma tx (R9/R12).

- [ ] **T9 — Service `gestionar`: subida atómica con compensación** (depende de T5/T8).
  `MisAsignacionesService.ts`: bucle de subida secuencial acumulando `uploaded`; compensación
  `storage.remove(uploaded)` ante fallo de subida (R10) y ante fallo de tx (R11); `buildGestionData`
  arma `evidencias`; `evidenciaUrls` vía `createSignedUrls` (design §3.5).
  Hecho: units R10 (falla subida #k → remove k-1, repo NO llamado) y R11 (tx lanza → remove N) verdes.

- [ ] **T10 — Borde `mis-asignaciones.ts`: `getAll` + `leerEvidencias`** (depende de T5/T7).
  `rawFromFormData` usa `formData.getAll("evidencia")`; `toGestionarInput` pasa `evidencias`;
  nueva `leerEvidencias` (design §3.4).
  Hecho: unit del action mapea N Files a N `EvidenciaArchivo` y delega al service.

## Bloque C — Frontend (depende de T7)

- [ ] **T11 — `GestionarOrdenPanel`: multi-select + previews + quitar.**
  Estado `evidencias: File[]`; componente local `EvidenciasField` (`multiple`, previews con
  `createObjectURL` + revoke, botón quitar, tope); `handleEvidenciaChange` concatena+comprime+recorta;
  `buildRaw`/`buildFormData` (`append` por foto); bloqueo de envío (R16/R17). Aplica a entregada/
  rechazada/devuelta (design §4).
  Hecho: test de componente cubre R14/R15/R16/R17; `reprogramada` sin cambios.

## Bloque D — Tests y verificación (depende de sus fuentes)

- [ ] **T12 [P] — Test estático de migración** (depende de T2/T3).
  `tests/integration/db/gestion-orden-evidencia-migration.test.ts` (patrón
  `gestion-orden-migration.test.ts`): tabla+columnas+FK+unique (R1/R2), RLS sin policy (R4), backfill
  `WHERE evidencia_storage_path IS NOT NULL ... indice 0` (R3), down `DROP TABLE` sin tocar
  `gestion_orden` (R4).
  Hecho: suite verde por regex sobre los .sql.

- [ ] **T13 [P] — Units backend** (depende de T7/T8/T9/T10).
  Casos R5/R6/R7/R8 (schema), R9/R12 (repo), R10/R11/R13 (service), action (T10). Nombre por
  comportamiento (docs/conventions §Tests).
  Hecho: cada R de requirements.md §Trazabilidad mapeado a ≥1 test.

- [ ] **T14 — `./init.sh` + suite completa verde** (depende de todo).
  Hecho: `./init.sh` en verde; `pnpm test` sin fallos; sin `any` no justificado ni `console.log` de PII.

- [ ] **T15 — Mapa de trazabilidad en `progress/impl_119...md`** (depende de T13).
  Hecho: tabla R→test completa; el reviewer puede verificar cada requisito.

## Archivos esperados (para validar conflictos de paralelismo)

**Nuevos:**
- `db/migrations/<ts>_gestion_orden_evidencia/migration.sql`
- `db/migrations/<ts>_gestion_orden_evidencia/down.sql`
- `tests/integration/db/gestion-orden-evidencia-migration.test.ts`
- (según T13) `tests/unit/services/mis-asignaciones-evidencias.test.ts`,
  `tests/unit/repositories/gestion-orden-evidencia.test.ts`,
  `tests/unit/types/gestion-orden-evidencias-schema.test.ts`,
  `tests/unit/actions/mis-asignaciones-evidencias.test.ts`,
  `tests/unit/components/GestionarOrdenPanel.evidencias.test.tsx` (o e2e equivalente)

**Modificados:**
- `db/schema.prisma` (modelo `GestionOrdenEvidencia` + inverso)
- `lib/config/gestion.ts`
- `lib/interfaces/services/IMisAsignacionesService.ts`
- `lib/interfaces/repositories/IGestionOrdenRepository.ts`
- `lib/types/gestion-orden.ts`
- `lib/repositories/GestionOrdenRepository.ts`
- `lib/services/MisAsignacionesService.ts`
- `lib/actions/mis-asignaciones.ts`
- `app/(app)/mis-asignaciones/_components/GestionarOrdenPanel.tsx`

**Conservados sin cambio (referencia):** `lib/interfaces/external/IFileStorage.ts`,
`lib/interfaces/external/ISignedUrlProvider.ts`, `lib/storage/SupabaseFileStorage.ts`,
`lib/storage/SupabaseSignedUrlProvider.ts`, y los consumidores de la portada (cierres 37/38/40,
API 106) — ver Pregunta abierta 1.

## Conflicto de paralelismo

Toca `MisAsignacionesService.ts`, `GestionOrdenRepository.ts`, `mis-asignaciones.ts`,
`gestion-orden.ts`, `GestionarOrdenPanel.tsx` y `schema.prisma` (feature 36/73/75/92/99/111). Cualquier
otra feature `in_progress` de zona fullstack/backend que edite estos archivos entra en conflicto:
serializar. Las features 117/118 en curso no tocan estos archivos (canton/distrito y rename SINPE).
