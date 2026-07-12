# Impl 37 — Cierre del día (mensajero) — BLOQUEADO (no implementado)

Fecha: 2026-07-11 · Coordinador: implementer · Rama: `feature/37-cierre-dia-mensajero`

## Veredicto
**BLOQUEADO antes de codificar.** No se delegó a `backend_dev`/`frontend_dev` ni se
escribió código de producción. El baseline heredado del merge base `3cd85d5`
(PR #40 "adjustments") está roto y hace inviable e inverificable la feature 37.

## Diagnóstico (todo pre-existente; los 3 commits de esta rama solo tocan specs/bookkeeping)

1. **`db/schema.prisma` NO valida.** `pnpm run db:generate` falla con P1012:
   > Error validating field `zona` in model `Usuario`: the relation field `zona` on
   > model `Usuario` is missing an opposite relation field on model `Zona`.
   El cliente Prisma no se puede regenerar → cliente generado quedó stale (sin
   `Tarifa`/`TarifaZonaMensajero`/`ZonaDistrito` que sí están en el schema).

2. **`pnpm run typecheck` = ROJO: 86 errores** (56 en código de producción):
   - `lib/repositories/ZonaRepository.ts` (21), `TarifaRepository.ts` (12),
     `GeoRepository.ts` (3), `OrdenRepository.ts` (1)
   - `lib/actions/ordenes-guia.ts` (6), `zonas.ts`, `usuarios.ts`, `tarifas.ts`
   - `lib/services/GuiaAsignacionService.ts` (3), `UsuarioService.ts`
   - `lib/interfaces/repositories/IGeoRepository.ts` (3)
   - `app/(app)/configuracion/_components/zonas-columns.tsx` (3)
   Causa: refactor a medias de zonas/tarifas/geografía. Se removieron de `Zona`
   (schema y `ZonaDTO`) los campos `esGam`, `pagoEntrega`, `pagoRechazo` (ahora solo
   `cobroVehiculo`), y se eliminaron exports de `lib/types/zona.ts`
   (`CantonLightDTO`/`DistritoCatalogoDTO`/`ProvinciaLightDTO`), pero el código y los
   tests que los usaban NO se actualizaron.

3. **Bloqueo directo de la feature 37 (R15/decisión F1.4-e):** el diseño manda rutear
   el destino con el resolver existente **`IZonaRepository.findGamZonaId()`**. Ese
   método **no existe** ni en la interfaz `lib/interfaces/repositories/IZonaRepository.ts`
   ni en `lib/repositories/ZonaRepository.ts`, y la columna `Zona.esGam` de la que se
   derivaba fue **eliminada** por el refactor. Producción (`GuiaAsignacionService`,
   `ordenes-guia.ts`) aún lo llama vía `Pick<IZonaRepository,"findGamZonaId">` → error de
   tipo. R15 es inimplementable como está especificada hasta reponer el resolver.

## Por qué se para (reglas del arnés)
- **Regla #5 (verificación ejecutable):** `./init.sh`/`typecheck`/`test` ya están en
  rojo por causas ajenas a la 37 → sería imposible reportar verde para la feature.
- **Regla #6 (no inventes) + design §6 "notas de riesgo":** el diseño ya anticipó este
  drift y ordenó *"sincronizar el schema antes (fuera del alcance de esta feature) y
  avisar al leader"*. No se improvisa.
- **Regla #1 (una feature por zona):** `progress/current.md` avisa que otra sesión
  trabaja el refactor de zonas/menú (ramas `adjustments`/`worktree-menu-config-submenu`).
  Arreglar zonas/tarifas/geo aquí colisionaría con ese trabajo.

## Qué se necesita antes de arrancar la 37 (decisión del leader/humano)
1. Una **fix-feature previa** que reconcilie el refactor de zonas/tarifas/geografía:
   dejar `db/schema.prisma` válido (`prisma validate`/`generate` verde), actualizar
   `ZonaRepository`/`TarifaRepository`/`GeoRepository`/`OrdenRepository`, `ordenes-guia`,
   `zonas-columns.tsx` y tests, y **reponer `IZonaRepository.findGamZonaId()`** (+ la
   columna/flag GAM en `Zona`) del que dependen la 30/17 y ahora la 37.
2. Con typecheck/test en verde y `findGamZonaId()` disponible, la impl de la 37 puede
   arrancar contra el diseño tal cual (tabla `cierre_dia` + enum + FK `cierre_id` + RLS +
   servicio/ruteo/snapshot + módulo + histórico + E2E). El spec de la 37 NO necesita cambios.

## Trazabilidad R→test
No aplica todavía: 0 tests escritos (implementación no iniciada por el bloqueo).
