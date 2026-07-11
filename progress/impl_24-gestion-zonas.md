# Bitacora de implementacion - Feature 24: Gestion de zonas (configuracion)

Rama: feature/24-gestion-zonas (desde dev, al dia).
Fecha: 2026-07-10. Coordinado por implementer (backend_dev + frontend_dev, modelo opus).
Estado: implementacion CASI COMPLETA - suite verde (1159 tests), typecheck/lint/init.sh OK.
HAY UN BLOCKER DE PRODUCTO EN R4 (ver seccion "Blocker / decision humana"). Pendiente de revision por reviewer y de decision humana sobre R4/R11.

Decisiones humanas respetadas: D1-D8 (F1.4, aprobadas 2026-07-10). es_gam NUNCA se siembra
(toggle de UI, R37); geografia = catalogo global; zona a nivel de distrito.zona_id; escritura solo
maestro, lectura de catalogo maestro+admin; sin borrado de zona.

---

## Archivos creados

### Backend - datos / migracion (T1-T3)
- db/migrations/20260711120000_zonas_catalogo_global_pagos/migration.sql (UP)
- db/migrations/20260711120000_zonas_catalogo_global_pagos/down.sql (DOWN)
- db/schema.prisma (modificado): Zona +pagoEntrega/pagoRechazo/esGam +unique nombre +relaciones inversas distritos/usuarios; Distrito +zonaId nullable; Usuario +zonaId nullable; Provincia.zonaId RELAJADO a nullable (ver blocker, NO eliminado).

### Backend - tipos / config / normalizacion / interfaces (T4-T7)
- lib/types/zona.ts (schemas Zod crear/actualizar/listar strict + ZonaDTO montos number + resultados por status)
- lib/config/zonas.ts (DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
- lib/geo/normalize.ts (normalizeZonaKey, canonicalZonaNombre, excepcion acronimo GAM)
- lib/interfaces/repositories/IZonaRepository.ts, IGeoRepository.ts
- lib/interfaces/services/IZonaService.ts

### Backend - repositorios / servicio / actions (T8-T11)
- lib/repositories/GeoRepository.ts (listProvincias/listCantones/listDistritos con zonaId/zonaNombre)
- lib/repositories/ZonaRepository.ts (create/update en transaction; findById/findByNombreKey/list/setGam/listLight/assignDistritos)
- lib/services/ZonaService.ts (WRITE maestro, READ maestro+admin; unicidad normalizada; conflict distrito/nombre; invariante es_gam)
- lib/actions/zonas.ts (crear/obtener/listar/actualizar/marcarGam/listLight/listarProvincias/Cantones/Distritos)

### Backend - integracion usuarios (T12)
- lib/types/usuario.ts, lib/interfaces/repositories/IUserRepository.ts, lib/repositories/UserRepository.ts, lib/services/UsuarioService.ts, lib/actions/usuarios.ts (aceptan zonaId opcional, validan existencia; roles mensajero/adminSatelite)

### Backend - seed (T17, gate de despliegue T18 diferido)
- scripts/seed-zonas.ts (dos parsers exceljs: mapa completo -> geografia; Excel original hoja Jerarquia revisar -> dedup zonas + cruce por terna; idempotente; no auto-corre al importar)

### Adaptaciones por el blocker R4
- lib/interfaces/repositories/IOrdenRepository.ts, lib/services/BulkOrdenService.ts (ProvinciaRow.zonaId -> nullable + guard en resolveGeo: provincia sin zona -> fila con error)

### Frontend (T13-T16)
- app/(app)/configuracion/_components/ZonaForm.tsx (nombre/pagos/toggle esGam + selector distritos navegando provincia->canton->distrito; fieldErrors/conflicto)
- app/(app)/configuracion/_components/ZonasModule.tsx (DataTable + Pagination + Modal + Toast + refresco)
- app/(app)/configuracion/_components/zonas-columns.tsx (nombre, distritosCount, pagos, badge GAM)
- app/(app)/configuracion/page.tsx (modificado): seccion Zonas con auth server-side solo maestro + precarga listarZonas

### Tests creados
- tests/integration/db/zonas-migration.test.ts
- tests/unit/geo/normalize.test.ts, tests/unit/types/zona-schema.test.ts
- tests/unit/repositories/geo-repository.test.ts, tests/unit/repositories/zona-repository.test.ts
- tests/unit/services/zona-service.test.ts, tests/unit/services/usuario-zona.test.ts
- tests/integration/actions/zonas-action.test.ts
- tests/unit/scripts/seed-zonas.test.ts
- tests/unit/components/zonas-columns.test.tsx, tests/unit/components/zona-form.test.tsx, tests/unit/components/zonas-module.test.tsx
- tests/integration/configuracion/zonas-page.test.tsx
- Ajustes en 3 tests de migracion preexistentes y en tests/integration/configuracion/usuarios-page.test.tsx (mock de actions/zonas + stub ZonasModule).

### Limpieza de entorno
- Eliminado worktree huerfano .claude/worktrees/agent-abfa9c471e0ca0e4d (de otra sesion, commit c4530c4) que hacia fallar el guard tests/unit/guards/no-embalaje.test.ts (feature 28). No es de la feature 24.

---

## Trazabilidad R -> test

| R | Test (archivo::caso) |
|---|---|
| R1 | zonas-migration.test.ts :: agrega pago_entrega/pago_rechazo/es_gam con defaults |
| R2 | zonas-migration.test.ts :: indice unico zona_nombre_key ; normalize.test.ts :: normalizeZonaKey |
| R3 | zonas-migration.test.ts :: indice unico parcial zona_es_gam_unico |
| R4 | DIFERIDO/BLOQUEADO - zonas-migration.test.ts :: relaja provincia.zona_id a nullable (DROP total NO ejecutado; ver blocker) |
| R5 | zonas-migration.test.ts :: distrito.zona_id nullable + FK RESTRICT + indice |
| R6 | zonas-migration.test.ts :: usuario.zona_id nullable + FK RESTRICT + indice |
| R7 | zonas-migration.test.ts :: FK ON DELETE RESTRICT + nullable |
| R8 | zonas-migration.test.ts :: FK ON DELETE RESTRICT |
| R9 | zonas-migration.test.ts :: no altera FK canton/distrito |
| R10 | zonas-migration.test.ts :: ni UP ni DOWN tocan orden |
| R11 | zonas-migration.test.ts :: DOWN revierte lo aditivo (restaura provincia NOT NULL) - parcial, ver blocker |
| R12 | zonas-migration.test.ts :: RLS geografia habilitado / no deshabilita |
| R13 | zonas-action.test.ts :: sin sesion -> unauthenticated |
| R14 | geo-repository.test.ts ; zona-service.test.ts catalogo ; zonas-action.test.ts |
| R15 | zona-repository.test.ts listLight ; zona-service.test.ts ; zonas-action.test.ts |
| R16 | zona-service.test.ts :: rol no-write -> forbidden |
| R17 | zona-repository.test.ts :: crea y asigna distrito.zona_id ; zona-service.test.ts |
| R18 | zona-repository.test.ts :: distrito inexistente aborta (rollback) |
| R19 | zona-schema.test.ts :: crearZonaSchema ; zona-service.test.ts :: validation_error |
| R20 | zona-repository.test.ts ya asignado ; zona-service.test.ts :: conflict(distrito) |
| R21 | zona-repository.test.ts findByNombreKey ; zona-service.test.ts :: nombre duplicado -> conflict |
| R22 | zona-repository.test.ts update libera/asigna ; zona-service.test.ts :: actualizar/not_found |
| R23 | zona-repository.test.ts setGam ; zona-service.test.ts :: marcarGam desmarca anterior |
| R24 | zona-repository.test.ts list ; zona-service.test.ts listar paginado ; zona-schema.test.ts clamp ; zonas-columns.test.tsx |
| R25 | zonas-action.test.ts :: contrato discriminado por status |
| R26 | zonas-action.test.ts :: DTO montos number, sin internos |
| R27 | usuario-zona.test.ts :: zona por rol |
| R28 | usuario-zona.test.ts :: zonaId inexistente -> validation_error |
| R29 | zonas-page.test.tsx :: rol no-maestro no ve modulo + mensaje sin permiso |
| R30 | zonas-module.test.tsx DataTable+Pagination ; zonas-page.test.tsx precarga |
| R31 | zona-form.test.tsx :: navega provincia->canton->distrito, marca/desmarca + toggle esGam |
| R32 | zonas-module.test.tsx :: exito -> toast ok + refresco / error -> toast error |
| R33 | zona-form.test.tsx :: conflicto nombre/distrito + validation_error junto a campos sin perder valores |
| R34 | seed-zonas.test.ts :: parseGeografiaRows + puebla geografia |
| R35 | seed-zonas.test.ts :: GAM+Gam -> una zona, pagos 0, es_gam=false |
| R36 | seed-zonas.test.ts :: cruce por terna asigna zona_id; sin match/vacia -> NULL |
| R37 | seed-zonas.test.ts :: ninguna zona con es_gam=true |
| R38 | seed-zonas.test.ts :: resumen ternasSinCorrespondencia/filasOmitidas, no falla |
| R39 | seed-zonas.test.ts :: idempotencia sin duplicados, no pisa pagos/es_gam |
| R40 | Gate de despliegue (T18) - sin test automatizado; deuda documentada abajo |

---

## Verificacion ejecutable (salida real)

- pnpm db:generate: OK (Prisma Client 7.8.0).
- pnpm run typecheck: 0 errores.
- pnpm run lint: 0 errores, 135 warnings (todas preexistentes en .claude/skills/impeccable/scripts).
- pnpm test: 1159 passed / 1159 (144 files, 0 fallos).
- ./init.sh: == init OK == (todas las migraciones con down.sql; .env presente).

---

## Deuda de despliegue documentada
- T18 / R40 (gate): ejecutar scripts/seed-zonas.ts contra DB real (service role) + los dos XLSX en public/ (public/geografia-cr-completa.xlsx - mapa oficial completo, aun por generar - y public/mapa-geografico-costa-rica.xlsx). NO ejecutado aqui (sin DB). Parser/seed testeados con fixtures XLSX sinteticos.
- La migracion 20260711120000_zonas_catalogo_global_pagos NO se aplico contra Postgres real (sin DB). Deuda de despliegue, igual que otras features del repo.

---

## Blocker / decision humana (R4 / R11) - IMPORTANTE

El spec (D3/R4) manda ELIMINAR provincia.zona_id, afirmando que no afecta a orden. Es cierto a nivel de FK del schema, PERO la carga masiva (feature 15) deriva orden.zona_id (NOT NULL) desde provincia.zona_id en BulkOrdenService.resolveGeo (con ~15 tests que lo fijan). Eliminar la columna rompe la compilacion y la semantica de la 15; migrar esa derivacion al modelo por-distrito choca con que orden.zona_id es NOT NULL y distrito/distrito.zona_id son opcionales.

Accion tomada (paso intermedio minimo y reversible, para no inventar producto ni romper la 15): todo lo aditivo de la 24 implementado y provincia.zona_id RELAJADO a NULLABLE en vez de eliminado; guard en resolveGeo (provincia sin zona -> fila con error). Consecuencia a ratificar: con el seed nuevo de la 24 las provincias nacen sin zona, por lo que la carga masiva no podria fijar orden.zona_id hasta que su derivacion migre al modelo por-distrito.

Decision que el humano debe tomar para cerrar R4/R11 - como debe fijar la carga masiva orden.zona_id bajo el modelo por-distrito:
- (a) hacer orden.zona_id nullable;
- (b) derivarlo del distrito y exigir distrito con zona;
- (c) una zona por defecto.

Hasta esa decision, el DROP total de provincia.zona_id queda diferido (documentado en migration.sql, schema.prisma y tasks.md). El reviewer debe evaluar esto como hallazgo de trazabilidad en R4/R11.
