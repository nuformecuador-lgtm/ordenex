# Bitácora de implementación — Feature 55

**Feature:** completar `ZonaForm` (setear `esCentral`) + reconciliar drift `provincia.zonaId`
**Rama:** `feature/55-zonaform-escentral` (← `dev` a3af913)
**Puerta F1.4:** APROBADA por el humano 2026-07-12 (A reasignar-con-confirmación · B reconstrucción completa · C schema-only · D seed no toca es_central)
**Fecha implementación:** 2026-07-12

## Veredicto: VERDE

Todas las tasks T0..T10 completadas y marcadas en `tasks.md`. Gate del arnés en verde.

## Verificación ejecutable (salida real)
| Comando | Resultado |
|---|---|
| `npx prisma validate` | OK — "The schema at db/schema.prisma is valid" |
| `pnpm run db:generate` | OK (backend) |
| `prisma migrate status` | "Database schema is up to date!" (25 migraciones, 0 nuevas → decisión C schema-only) |
| `pnpm run typecheck` | 0 errores |
| `pnpm run lint` | 0 errores (135 warnings, todos preexistentes en `.claude/skills/`) |
| `pnpm test` | 1614 passed / 1614 (185 archivos) |
| `./init.sh` | EXIT 0 — `== init OK ==`, todas las migraciones con down.sql, .env presente |

Baseline `dev` era 1565/1565 → ahora 1614/1614 (+49 tests netos: ~37 backend nuevos, +21 frontend reescritos que reemplazan los del stub).

## Runtime desbloqueado
Con una zona marcada `esCentral` desde la UI reconstruida, `IZonaRepository.findCentralZonaId()` deja de devolver `null` (cubierto por `zona-service.test.ts` / `zona-repository.test.ts`). Se levanta el bloqueo de la guardia R4 de feature 30 y el runtime de 34/37.

## Archivos creados
- `lib/interfaces/services/IGeoService.ts` — contrato GeoService (gate maestro)
- `lib/services/GeoService.ts` — service delgado sobre `IGeoRepository`
- `lib/actions/geo.ts` — Server Actions `listarProvincias` / `listarCantones` / `listarDistritos`
- `tests/integration/db/provincia-schema-drift.test.ts` — anti-regresión drift schema (R13)
- `tests/unit/services/geo-service.test.ts`
- `tests/integration/actions/geo-action.test.ts`

## Archivos modificados
- `db/schema.prisma` — elimina `Provincia.zonaId`, `Provincia.zona`, `Zona.provincias`; comentario coherente (T0/R13)
- `lib/repositories/ZonaRepository.ts` — reasignación transaccional de central + traducción `P2002`(es_central)→`ConflictError` (T2/R5,R6)
- `lib/types/zona.ts` — `GeoActionError` (alias de `ZonaActionError`) + `Listar{Provincias,Cantones,Distritos}Result`
- `app/(app)/configuracion/_components/ZonaForm.tsx` — RECONSTRUIDO (nombre + provincia/cantón/distritos N:M + cobroVehiculo + toggle esCentral + tarifas + confirmación reasignación) (T4–T8)
- `app/(app)/configuracion/_components/ZonasModule.tsx` — deriva y pasa `centralActual` al form
- `tests/unit/repositories/zona-repository.test.ts` — +casos reasignación / P2002
- `tests/unit/services/zona-service.test.ts` — +casos esCentral (2ª central, false/true)
- `tests/unit/components/zona-form.test.tsx` — reescrito para el form reconstruido
- `tests/unit/components/zonas-module.test.tsx` — reescrito (centralActual + éxito refresca)

## Mapa de trazabilidad R → test
| R | Requisito | Test que lo cubre |
|---|---|---|
| R1 | CRUD/lectura solo maestro (unauth/forbidden) | `tests/integration/actions/geo-action.test.ts` (unauthenticated/forbidden) · `tests/integration/actions/zonas-action.test.ts` |
| R2 | Mutación server-side + zod en el borde | `tests/integration/actions/geo-action.test.ts` (provinciaId/cantonId inválido → validation_error) · `zonas-action.test.ts` |
| R3 | Persistir `esCentral=true` | `tests/unit/services/zona-service.test.ts` · `tests/unit/repositories/zona-repository.test.ts` · `tests/unit/components/zona-form.test.tsx` (submit envía esCentral) |
| R4 | Persistir `esCentral=false` | `tests/unit/services/zona-service.test.ts` (esCentral false persiste false) |
| R5 | Invariante ≤1 central | `tests/unit/repositories/zona-repository.test.ts` (desmarca previa antes de escribir) · `tests/integration/db/zonas-migration.test.ts` (índice único parcial) |
| R6 | Reasignar sin filtrar P2002/500 | `tests/unit/services/zona-service.test.ts` (2ª central → ok reasignando) · `tests/unit/repositories/zona-repository.test.ts` (P2002 es_central→conflict) · `tests/unit/components/zona-form.test.tsx` (aviso + confirmación UI) |
| R7 | Prefill toggle central en editar | `tests/unit/components/zona-form.test.tsx` (prefila esCentral en editar) |
| R8 | Crear con todos los campos + regla cobroVehiculo↔tarifas | `tests/unit/components/zona-form.test.tsx` (cobroVehiculo false/true; violación→validation_error) · `tests/unit/types/zona-schema.test.ts` |
| R9 | Editar = reemplazo completo + prefill | `tests/unit/components/zona-form.test.tsx` (edición prefila tarifas y llama actualizarZona(id,...)) · `tests/unit/services/zona-service.test.ts` |
| R10 | Selector catálogo global + distrito ajeno deshabilitado + pre-marcado | `tests/integration/actions/geo-action.test.ts` · `tests/unit/services/geo-service.test.ts` · `tests/unit/components/zona-form.test.tsx` (navegación; distrito ajeno deshabilitado con zonaNombre; pre-marcado en edición) |
| R11 | validation_error/conflict → mensaje por campo, valores conservados, modal abierto | `tests/unit/components/zona-form.test.tsx` (validation_error/conflict conservan valores) |
| R12 | Éxito → toast + mutate + cierre | `tests/unit/components/zonas-module.test.tsx` (éxito → mutate + toast + cierre) |
| R13 | Schema sin `Provincia.zonaId`/`Provincia.zona`/`Zona.provincias` | `tests/integration/db/provincia-schema-drift.test.ts` |
| R14 | RLS intacta, sin tablas nuevas | `tests/integration/db/zonas-migration.test.ts` + revisión estática (sin migración nueva; catálogo geo vía Server Action con gate maestro) |

## Decisiones / desviaciones tomadas
- **Reasignación en el repo (no en el service):** la desmarca de la central previa se hace inline con `tx.zona.updateMany` dentro de la `$transaction` existente de `create`/`update`; no se añadió método público a `IZonaRepository`. Firmas de `IZonaService`/actions intactas.
- **`GeoActionError`** reusa el shape de `ZonaActionError` (alias en `lib/types/zona.ts`); `toGeoActionError` es espejo local de `toZonaActionError` (este no está exportado).
- **Confirmación de reasignación (F1.4-A, lado UI):** checkbox inline "Entiendo que reasignaré la zona central". `ZonasModule` deriva `centralActual` escaneando `data.items` por `esCentral` y lo pasa como prop; si el usuario activa esCentral existiendo otra central (`id !== zona?.id`) y no marca el checkbox, `submit()` devuelve `validation_error` en `esCentral` sin llamar al backend. (Se eligió inline sobre Modal anidado por testabilidad; ambos válidos por F1.4-A.)
- **`conflict` sin payload:** el `ZonaActionError.conflict` no trae `reason`/`distritoIds`, así que la UI muestra un mensaje genérico visible ("Revisa el nombre o los distritos…") conservando valores.

## Limitaciones conocidas (documentadas, no re-litigadas)
- **Divergencia escalar↔N:M de distritos (deuda feature-24):** el seed (`scripts/seed-zonas.ts`) asigna distritos por el escalar `distrito.zonaId`, mientras el CRUD/`listarDistritos` usan el N:M `ZonaDistrito`. Una zona SEMBRADA (no creada por el CRUD) tendría sus distritos NO pre-marcados en edición. Documentado en el JSDoc de `ZonaForm`; fuera de alcance de la feature 55.
- **`centralActual` fiable solo si la central está en la página cargada** del listado; el backend garantiza la invariante igualmente (reasignación transaccional). Comentado en `ZonasModule`.

## Alcance NO tocado
Sin migración nueva (decisión C). Sin PR ni merge a `dev` (pendiente reviewer). Seed NO toca `es_central` (decisión D, sin cambios en `seed-zonas.ts`).
