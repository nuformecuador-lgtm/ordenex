# Feature 24 — Gestión de zonas (configuración) · tasks.md

> Checklist verificable. `[P]` = paralelizable (sin dependencia con otras `[P]`
> del mismo bloque). Cada task ata sus `R` y su criterio de "hecho". El código NO
> se toca hasta la RE-aprobación humana F1.4 (el spec cambió de modelo).

## Bloque 0 — Puerta de RE-aprobación (APROBADA por el humano 2026-07-10)

- [x] **T0** Modelo corregido APROBADO en F1.4: catálogo geográfico GLOBAL +
  `distrito.zona_id`, eliminación de `provincia.zona_id`; seed de dos fuentes (mapa
  oficial completo = geografía; Excel original = hints de zona); `es_gam` NO
  sembrado (toggle de UI). Decisiones D1–D8 fijadas en `requirements.md`.
  - Ata: todas (fija D1–D8 y normalización de zona).
  - Hecho: decisiones registradas; feature en `spec_ready`.

## Bloque 1 — Migración y esquema (base de todo el backend)

> **BLOCKER R4 (decisión humana pendiente).** El DROP total de `provincia.zona_id`
> rompe la carga masiva (feature 15), que deriva `orden.zona_id` (NOT NULL) desde
> `provincia.zona_id` con tests que lo fijan. Se implementó todo lo ADITIVO de la 24
> y, como paso intermedio, `provincia.zona_id` se **relajó a NULLABLE** (no se
> eliminó). El drop total + migrar la derivación de zona de carga masiva al modelo
> por-distrito queda para un paso posterior. R11 se ajusta: el DOWN restaura el
> NOT NULL de `provincia.zona_id` (no recrea la columna, que nunca se eliminó).

- [x] **T1** Editar `db/schema.prisma`: en `zona` añadir
  `pagoEntrega/pagoRechazo/esGam` + `@unique` en `nombre` y relaciones inversas
  `distritos`/`usuarios`; en `provincia` **quitar** `zonaId`, su FK y `@@index`; en
  `distrito` y `usuario` añadir `zonaId String? @map("zona_id")` + relación +
  `@@index([zonaId])`.
  - Ata: R1, R2, R4, R5, R6, R9. Dep: T0.
  - Hecho: `prisma validate` OK; nombres/tipos = design §2.2.
- [x] **T2** Crear `migration.sql` (columnas de zona, índices únicos `zona_nombre` +
  `es_gam` parcial, DROP de `provincia.zona_id`+FK+índice, ADD `distrito.zona_id` y
  `usuario.zona_id` + FK RESTRICT + índices; verificar RLS de geografía ya activo).
  - Ata: R1, R2, R3, R4, R5, R6, R7, R8, R12. Dep: T1.
  - Hecho: migración aplica limpia; `orden` sin cambios (R10).
- [x] **T3** Crear `down.sql` que revierte exacto en orden inverso (patrón
  `usuario_fulfillment/down.sql`): restaura `provincia.zona_id`+FK+índice, elimina
  `distrito.zona_id`/`usuario.zona_id`/columnas e índices de `zona`. **Sin tocar
  `orden`.**
  - Ata: R10, R11. Dep: T2.
  - Hecho: up→down→up reproducible; `orden` intacto; provincia.zona_id restaurado.

## Bloque 2 — Tipos, config, normalización e interfaces (paralelizables entre sí)

- [x] **T4** `[P]` `lib/types/zona.ts`: schemas Zod (crear/actualizar/listar) + DTO
  (`distritosCount`, montos number) + tipos de resultado discriminados por `status`.
  - Ata: R19, R25, R26. Dep: T0.
  - Hecho: `crearZonaSchema.strict()` rechaza campos extra/monto negativo/sin distritos.
- [x] **T5** `[P]` `lib/config/zonas.ts`: `DEFAULT_PAGE_SIZE`, `MAX_PAGE_SIZE`.
  - Ata: R24. Dep: T0.
  - Hecho: constantes usadas por el schema de listado.
- [x] **T6** `[P]` `lib/geo/normalize.ts`: `normalizeZonaKey` (dedup) y
  `canonicalZonaNombre` (display), con excepción de acrónimo `GAM` (design §5.1).
  - Ata: R2, R21, R35. Dep: T0.
  - Hecho: tests: `GAM`/`Gam`→misma clave; `LIMÓN ABAJO`/`LIMON ABAJO`→misma; canónico correcto.
- [x] **T7** `[P]` `lib/interfaces/repositories/IZonaRepository.ts` +
  `IGeoRepository.ts` + `lib/interfaces/services/IZonaService.ts`.
  - Ata: R14, R15, R17, R20, R22, R23, R24. Dep: T4.
  - Hecho: interfaces compilan; firmas cubren catálogo + create/find/list/update/setGam/assignDistritos/listLight.

## Bloque 3 — Repository y Service

- [x] **T8** `lib/repositories/GeoRepository.ts`: `listProvincias`,
  `listCantones(provinciaId)`, `listDistritos(cantonId)` (con `zonaId`/`zonaNombre`).
  - Ata: R14. Dep: T1, T7.
  - Hecho: tests devuelven jerarquía y marca de zona por distrito.
- [x] **T9** `lib/repositories/ZonaRepository.ts`: create/update en `$transaction`
  (fila zona + validar distritos + `updateMany` distrito.zona_id asignar/liberar +
  desmarcar GAM previo), findById/findByNombreKey/list/setGam/listLight.
  - Ata: R17, R18, R20, R22, R23, R24, R15. Dep: T1, T7.
  - Hecho: tests: atomicidad, asignación/liberación de distritos, GAM único en tx.
- [x] **T10** `lib/services/ZonaService.ts`: autorización (WRITE=maestro,
  READ=maestro+admin), unicidad por clave normalizada, distrito ya asignado →
  conflict, invariante es_gam, validación de entrada, resultados discriminados.
  - Ata: R16, R19, R20, R21, R22, R23, R24. Dep: T6, T7, T9.
  - Hecho: tests cubren forbidden/conflict(nombre|distrito)/not_found/ok por operación.

## Bloque 4 — Server Actions

- [x] **T11** `lib/actions/zonas.ts`: crearZona/obtenerZona/listarZonas/
  actualizarZona/marcarZonaGam/listarZonasLight + listarProvincias/Cantones/Distritos,
  con `withErrorHandler`, `resolveActorFromSession`, `UnauthenticatedError`,
  `toActionError`.
  - Ata: R13, R14, R15, R25, R26. Dep: T4, T8, T10.
  - Hecho: tests verifican unauthenticated antes del service y contrato `status`.

## Bloque 5 — Integración con usuarios (feature 25)

- [x] **T12** Extender `UsuarioService`/schema para aceptar `zonaId` opcional y
  validar existencia (roles mensajero/adminSatelite); otros roles → null.
  - Ata: R27, R28. Dep: T1, T9.
  - Hecho: tests: zonaId válido persiste; inexistente → validation_error; rol no aplicable → null.

## Bloque 6 — Frontend (configuración)

- [x] **T13** `.../_components/ZonaForm.tsx`: campos nombre/pagos/esGam + selector de
  distritos que navega provincia→cantón→distrito (consume listarProvincias/Cantones/
  Distritos) y marca/desmarca; render de `fieldErrors`/conflicto.
  - Ata: R31, R33. Dep: T4, T11.
  - Hecho: test navega catálogo, marca distritos y muestra errores sin perder valores.
- [x] **T14** `.../_components/ZonasModule.tsx`: DataTable + Pagination + Modal +
  Toast, precarga por props.
  - Ata: R30, R32. Dep: T11, T13.
  - Hecho: test renderiza listado; éxito/error disparan Toast + refresco.
- [x] **T15** `[P]` `.../_components/zonas-columns.tsx`: columnas (nombre, nº
  distritos, pagos) + badge GAM.
  - Ata: R24, R30. Dep: T4.
  - Hecho: test de columnas mapea DTO (distritosCount, esGam) correctamente.
- [x] **T16** Ajustar `app/(app)/configuracion/page.tsx`: sección/tab de zonas con
  autorización server-side (solo maestro) y precarga `listarZonas`.
  - Ata: R29, R30. Dep: T14.
  - Hecho: rol no-maestro no ve módulo; maestro ve listado precargado.

## Bloque 7 — Seed (dos fuentes: mapa completo + hints de zona)

- [x] **T17** `[P]` `scripts/seed-zonas.ts`: dos parsers XLSX (`exceljs`) —
  (a) mapa oficial completo → upsert provincia/canton/distrito por nombre dentro
  del padre; (b) Excel original (hoja "Jerarquía (revisar)") → dedup de zonas
  normalizadas (T6) con pagos 0 y `es_gam=false`. Cruce por terna normalizada
  provincia+cantón+distrito → asigna `distrito.zona_id` o NULL. NUNCA setea
  `es_gam`. Idempotente (no pisa pagos/es_gam editados). Omite huecos con resumen;
  no auto-corre al importar.
  - Ata: R34, R35, R36, R37, R38, R39. Dep: T1, T6, T9.
  - Hecho: tests con dos fixtures XLSX sintéticos pueblan catálogo, dedup GAM, cruce
    por terna, NULL sin zona, doble corrida sin duplicados; resumen impreso; todas
    las zonas `es_gam=false`.
- [ ] **T18** **GATE de despliegue**: ejecutar el seed contra el mapa oficial
  completo (`public/`, nombre a confirmar) + `public/mapa-geografico-costa-rica.xlsx`
  + DB real (service role).
  - Ata: R40. Dep: T17 + ambos XLSX en `public/` + DB real.
  - Hecho: BLOQUEADA hasta entorno con DB real y mapa completo; documentar conteos en
    progress al correr.

## Bloque 8 — Verificación final

- [ ] **T19** Mapa R→test completo en `progress/impl_24-gestion-zonas.md`; `./init.sh`
  y suite en verde (docs/verification.md, CHECKPOINTS.md).
  - Ata: todas. Dep: T1–T17.
  - Hecho: cada R1..R40 mapeado a un test que pasa (R40 documental/gate de despliegue).
