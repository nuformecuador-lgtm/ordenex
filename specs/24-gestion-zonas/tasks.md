# Feature 24 — Gestión de zonas (configuración) · tasks.md

> Checklist verificable. `[P]` = paralelizable (sin dependencia con otras `[P]`
> del mismo bloque). Cada task ata sus `R` y su criterio de "hecho". El código NO
> se toca hasta la aprobación humana F1.4 (estado `spec_ready`).

## Bloque 0 — Puerta de aprobación (bloquea todo lo demás)

- [ ] **T0** Resolver las 7 "Preguntas abiertas" de `requirements.md` en F1.4.
  - Ata: todas (define D2/D4/D5, obligatoriedad zona_id, formato Excel).
  - Hecho: decisiones registradas; feature pasa a `spec_ready` → aprobada.

## Bloque 1 — Migración y esquema (base de todo el backend)

- [ ] **T1** Editar `db/schema.prisma`: añadir `pagoEntrega/pagoRechazo/esGam` +
  `@unique` en `zona`, `zonaId` en `usuario` con relación e índice.
  - Ata: R1, R2. Dep: T0.
  - Hecho: `prisma validate` OK; nombres/tipos = design §2.2.
- [ ] **T2** Crear `migration.sql` (columnas, índices únicos zona_nombre + es_gam
  parcial, `usuario.zona_id` + FK RESTRICT + índice, RLS geografía).
  - Ata: R1, R2, R4, R5, R6. Dep: T1.
  - Hecho: migración aplica limpia sobre DB con datos existentes.
- [ ] **T3** Crear `down.sql` que revierte exacto en orden inverso (patrón
  postulacion_mensajero/down.sql), sin tocar `orden.zona_id`.
  - Ata: R3. Dep: T2.
  - Hecho: up→down→up reproducible; `orden.zona_id` intacto.

## Bloque 2 — Tipos, config e interfaces (paralelizables entre sí)

- [ ] **T4** `[P]` `lib/types/zona.ts`: schemas Zod (crear/actualizar/listar) + DTO
  + tipos de resultado discriminados por `status`.
  - Ata: R11, R16, R17. Dep: T0.
  - Hecho: `crearZonaSchema.strict()` rechaza campos extra/monto negativo/sin distritos.
- [ ] **T5** `[P]` `lib/config/zonas.ts`: `DEFAULT_PAGE_SIZE`, `MAX_PAGE_SIZE`.
  - Ata: R15. Dep: T0.
  - Hecho: constantes usadas por el schema de listado.
- [ ] **T6** `[P]` `lib/interfaces/repositories/IZonaRepository.ts` +
  `lib/interfaces/services/IZonaService.ts`.
  - Ata: R9, R12, R14, R15, R18. Dep: T4.
  - Hecho: interfaces compilan; firmas cubren create/find/list/update/setGam/listLight.

## Bloque 3 — Repository y Service

- [ ] **T7** `lib/repositories/ZonaRepository.ts`: create/update en `$transaction`
  (zona+provincia+canton+distritos), findById/findByNombre/list/setGam/listLight.
  - Ata: R9, R10, R12, R14, R15, R18. Dep: T1, T6.
  - Hecho: tests de repo verifican atomicidad y enlaces FK.
- [ ] **T8** `lib/services/ZonaService.ts`: autorización (WRITE=maestro,
  READ=maestro+admin), unicidad nombre, invariante es_gam único, validación
  geografía mínima, resultados discriminados.
  - Ata: R8, R9, R11, R12, R13, R14, R15. Dep: T6, T7.
  - Hecho: tests cubren forbidden/conflict/not_found/ok por operación.

## Bloque 4 — Server Actions

- [ ] **T9** `lib/actions/zonas.ts`: crearZona/obtenerZona/listarZonas/
  actualizarZona/marcarZonaGam/listarZonasLight con `withErrorHandler`,
  `resolveActorFromSession`, `UnauthenticatedError`, `toActionError`.
  - Ata: R7, R16, R17, R18. Dep: T4, T8.
  - Hecho: tests de action verifican unauthenticated antes del service y contrato `status`.

## Bloque 5 — Integración con usuarios (feature 25)

- [ ] **T10** Extender `UsuarioService`/schema para aceptar `zonaId` opcional y
  validar existencia (roles mensajero/adminSatelite); otros roles → null.
  - Ata: R19, R20. Dep: T1, T7.
  - Hecho: tests: zonaId válido persiste; inexistente → validation_error; rol no aplicable → null.

## Bloque 6 — Frontend (configuración)

- [ ] **T11** `app/(app)/configuracion/_components/ZonasModule.tsx`: DataTable +
  Pagination + Modal + Toast, precarga por props.
  - Ata: R22, R24. Dep: T9.
  - Hecho: test renderiza listado; éxito/error disparan Toast + refresco.
- [ ] **T12** `[P]` `.../_components/ZonaForm.tsx`: campos nombre/provincia/canton/
  distritos(>=1)/pagos/esGam + render de `fieldErrors`.
  - Ata: R23, R25. Dep: T4, T9.
  - Hecho: test captura todos los campos y muestra errores sin perder valores.
- [ ] **T13** `[P]` `.../_components/zonas-columns.tsx`: columnas + badge GAM.
  - Ata: R15, R22. Dep: T4.
  - Hecho: test de columnas mapea DTO correctamente.
- [ ] **T14** Ajustar `app/(app)/configuracion/page.tsx`: sección/tab de zonas con
  autorización server-side (solo maestro) y precarga `listarZonas`.
  - Ata: R21, R22. Dep: T11.
  - Hecho: rol no-maestro no ve módulo; maestro ve listado precargado.

## Bloque 7 — Seed (gate)

- [ ] **T15** `[P]` `scripts/seed-zonas.ts`: parser XLSX (`exceljs`) + upsert
  idempotente por nombre en transacción; ejecutable por `tsx`, no auto-corre al importar.
  - Ata: R26, R28. Dep: T7.
  - Hecho: test con fixture XLSX sintético crea geografía; doble corrida sin duplicados.
- [ ] **T16** **GATE**: ejecutar el seed contra el Excel real del humano.
  - Ata: R27. Dep: T15 + Excel provisto (pregunta abierta 7).
  - Hecho: BLOQUEADA hasta recibir el archivo; documentar en progress al desbloquear.

## Bloque 8 — Verificación final

- [ ] **T17** Mapa R→test completo en `progress/impl_24-gestion-zonas.md`; `./init.sh`
  y suite en verde (docs/verification.md, CHECKPOINTS.md).
  - Ata: todas. Dep: T1–T15.
  - Hecho: cada R1..R28 mapeado a un test que pasa (R27 documental/gate).
