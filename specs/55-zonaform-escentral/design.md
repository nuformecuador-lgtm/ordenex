# Feature 55 — Diseño técnico

> El CÓMO. Respeta `docs/architecture.md` (Controller→Service→Repository, borde tipado,
> migraciones up/down) y `docs/conventions.md`. La superficie exacta depende de F1.4-B
> (alcance) y F1.4-A (UX de reasignación); el diseño describe la ruta RECOMENDADA
> (reconstrucción completa + reasignar con confirmación) y marca lo condicional.

## 0. Resumen de decisiones
- **Sin tablas nuevas.** El modelo `esCentral` y el índice único parcial ya existen
  (feature 54). La feature 55 es principalmente **frontend** + **una acción/servicio de
  lectura de catálogo geográfico** + **endurecer la invariante de central en el service**
  + **limpieza de drift schema-only** en `provincia.zonaId`.
- **Reconciliación del drift = schema-only** (F1.4-C): no hay migración nueva por el drift.
- La única migración/`down.sql` que podría aparecer es si F1.4-A elige *reasignar* y se
  decide expresarlo en SQL (no necesario; se resuelve en el service dentro de la
  transacción del repo). → **No se prevé migración nueva.**

## 1. Modelo de datos (estado actual, NO se altera salvo drift)
```
Zona {
  id, nombre @unique,
  cobroVehiculo @map("cobro_vehiculo"),
  esCentral @map("es_central")           // índice único parcial zona_es_central_unico
  distritos ZonaDistrito[] (N:M)
  tarifaZonaMensajeros TarifaZonaMensajero[]
}
ZonaDistrito { zonaId, distritoId, @@unique([zonaId, distritoId]) }  // CASCADE ambos lados
TarifaZonaMensajero { cobroEntregado, cobroRechazado, vehiculoId?, zonaId, @@unique([zonaId, vehiculoId]) }
Distrito { id, nombre, cantonId, zonaId? (escalar, usado por seed) , zonas ZonaDistrito[] }
```
### Cambio de esquema (R13, F1.4-C) — schema-only
`db/schema.prisma`, modelo `Provincia`: eliminar
```
  zonaId String? @map("zona_id")
  zona   Zona?   @relation(fields: [zonaId], references: [id])
```
y en modelo `Zona`, eliminar la relación inversa `provincias Provincia[]`.
Actualizar el comentario del bloque `Zona` para reflejar que `provincia.zona_id` ya no
existe (ya lo afirma). **No** se crea migración: la DB ya dropeó la columna en
`20260711120000`. Verificación: `prisma validate` + diff schema↔migraciones vacío.

## 2. Invariante "a lo sumo una central" (R5/R6)
Estado actual: sólo el índice único parcial `zona_es_central_unico` la garantiza; el
`ZonaService` NO valida y el `ZonaRepository` NO captura `P2002` en create/update → un
segundo `esCentral=true` se filtraría como error INTERNAL (500). Endurecer:

**Ruta recomendada (F1.4-A = reasignar):** en `ZonaService.crear`/`actualizar`, cuando
`input.esCentral === true`, delegar al repo un reemplazo transaccional que
`UPDATE zona SET es_central=false WHERE es_central=true AND id <> :id` ANTES de setear la
nueva central, dentro de la MISMA `$transaction` del create/update. Así el índice nunca se
viola. Requiere un pequeño método de repo (p. ej. `unsetCentralExcept(txId?)`) o incluirlo
inline en la transacción de `create`/`update`.

**Ruta alternativa (F1.4-A = rechazar):** en el service, antes de escribir, si
`input.esCentral === true` y `findCentralZonaId()` devuelve un id distinto del que se edita
→ devolver `{ status: "conflict" }` (o `validation_error` con `fieldErrors.esCentral`).
No requiere tocar el repo.

En ambos casos, blindar el repo contra `P2002` sobre `es_central` traduciéndolo a
`conflict` (defensa en profundidad), en vez de dejarlo escapar como INTERNAL.

## 3. Capas y contratos

### 3.1 Server Actions de catálogo geográfico (NUEVAS, R10 — sólo Opción A)
`GeoRepository`/`IGeoRepository` ya existen pero no hay actions. Añadir en
`lib/actions/` (p. ej. `lib/actions/geo.ts`) tres acciones `'use server'` para maestro,
con el patrón de `lib/actions/zonas.ts` (`withErrorHandler` + `resolveActorFromSession` +
`isAppErrorShape`/`toZonaActionError` o un `toGeoActionError` equivalente):
```
listarProvincias(): Promise<{status:"ok"; items: ProvinciaLightDTO[]} | ZonaActionError>
listarCantones(provinciaId: unknown): Promise<{status:"ok"; items: CantonLightDTO[]} | ...>
listarDistritos(cantonId: unknown): Promise<{status:"ok"; items: DistritoCatalogoDTO[]} | ...>
```
- Autorización: maestro (patrón configuración). Validar `provinciaId`/`cantonId` con zod.
- Necesitan un service delgado `GeoService` (o reusar un `IZonaService.catalogo…`) que
  reciba `IGeoRepository` por constructor (DI, testeable sin DB) y aplique el gate maestro.
  Preferir `GeoService` nuevo para no engordar `ZonaService`.
- `DistritoCatalogoDTO` ya expone `{ id, nombre, zonaId, zonaNombre }` (una zona asignada
  vía N:M) → suficiente para deshabilitar distritos de otra zona (R10).

> **Nota (riesgo F1.4-B):** `GeoRepository.listDistritos` lee la asignación por el N:M
> `ZonaDistrito`, no por `distrito.zonaId` escalar (que usa el seed). El prefill de
> distritos en edición sólo verá los asignados por CRUD (N:M). Documentar; no resolver aquí.

### 3.2 Contrato de mutación de zona (SIN cambios de firma)
Reusar tal cual:
```
crearZona(input: unknown): Promise<CrearZonaResult>
actualizarZona(id: unknown, input: unknown): Promise<ActualizarZonaResult>
obtenerZona(id: unknown): Promise<ObtenerZonaResult>   // ya devuelve tarifas (includeTarifas=true)
```
`input` = `{ nombre, cobroVehiculo, esCentral?, distritoIds: string[]≥1, tarifas: [...] }`
(zod `crearZonaSchema`/`actualizarZonaSchema`, `.strict()`, `esCentral` default false).
El `id` viaja aparte en `actualizarZona` (ya es así).

### 3.3 UI — `ZonaForm.tsx` (reconstrucción, Opción A)
Patrón `UsuarioForm`/stub actual: `forwardRef<ZonaFormHandle>` con `submit()` imperativo
que el `Modal` de `ZonasModule` dispara (`closeOnConfirm={false}`, `onConfirm`). Campos:
- `nombre` (Input, ya existe).
- `cobroVehiculo` (Switch).
- `esCentral` (Switch "Marcar como zona central / GAM"); prefill desde `zona.esCentral` (R7).
- **Selector de distritos** (fieldset provincia→cantón→distrito): SWR sobre las nuevas
  actions `listarProvincias/listarCantones/listarDistritos`; checkbox por distrito;
  deshabilitar los que tienen `zonaId` de otra zona mostrando `zonaNombre`; en edición,
  pre-marcar los de ESTA zona; enviar el conjunto COMPLETO (`distritoIds`). Reactivar el
  bloque comentado del stub adaptado a los símbolos vigentes.
- **Editor de tarifas**: filas `{ cobroEntregado, cobroRechazado, vehiculoId? }`.
  - `cobroVehiculo=false`: a lo sumo 1 tarifa, sin `vehiculoId`.
  - `cobroVehiculo=true`: ≥1 tarifa, todas con `vehiculoId` (de `listarVehiculos`,
    feature 50), sin vehículos repetidos.
  - La regla ya la impone `applyTarifaRules` (zod) en cliente y servidor.
- `validate()`: `schema.safeParse(candidate)`; en fallo → `fieldErrors` por campo (R11).
- `submit()`: llama `crearZona(input)` / `actualizarZona(zona.id, input)`; mapea
  `validation_error`/`conflict` a errores por campo, conserva valores, no cierra el modal
  (R11); en `ok` deja que `ZonasModule` haga toast + `mutate` + cierre (R12, ya cableado).

### 3.4 UI — Opción B (alternativa mínima, si F1.4-B = mínimo)
- Acción nueva `marcarZonaCentral(id: unknown, esCentral: boolean): Promise<...>` en
  `lib/actions/zonas.ts` → `ZonaService.marcarCentral(id, esCentral, actor)` que hace el
  reemplazo transaccional de la central (§2) sin tocar distritos/tarifas.
- UI mínima: un control en `zonas-columns.tsx`/`ZonasModule.tsx` (toggle o botón "Marcar
  como central") con confirmación. `crearZona`/`ZonaForm` completos quedan como follow-up.

## 4. Autorización, RLS y seguridad (R1, R2, R14)
- Todas las mutaciones y lecturas de catálogo son Server Actions `'use server'` con gate
  `maestro` (patrón `lib/actions/zonas.ts`). Sin ruta API interna fetcheada desde el cliente.
- Sin tablas nuevas → sin RLS nueva. zona/provincia/cantón/distrito ya tienen RLS
  habilitado (sólo service role). El cliente nunca consulta Postgres directo.
- Validación zod en el borde de toda entrada (R2).

## 5. Verificación / migraciones
- Cambio de esquema = schema-only (R13). `prisma validate` OK; diff schema↔migraciones
  vacío; `prisma migrate status` sigue "up to date" (no se añaden migraciones).
- Si por alguna razón F1.4 exigiera SQL (no previsto), toda migración llevaría
  `migration.sql` + `down.sql` y round-trip de rollback (`pnpm run db:rollback`).
- Gate final: `./init.sh` verde (typecheck 0, lint 0, `pnpm test` 100%).

## 6. Alternativas descartadas (obligatorio)
1. **Añadir migración para re-crear `provincia.zona_id` nullable** (en vez de limpiar el
   schema). *Descartada*: contradice feature 24/R4 (zona ya no cuelga de provincia) y
   reintroduce esquema muerto; el trabajo correcto es alinear el schema a la DB.
2. **Validar la invariante de central sólo con el índice único de DB** (dejar que `P2002`
   suba). *Descartada*: produce un 500 genérico y mala UX (R6); la lógica de negocio
   ("una central") debe vivir en el service con feedback tipado.
3. **Reusar `arbolZonas` como fuente del selector de distritos.** *Descartada*: `arbolZonas`
   sólo devuelve distritos YA asignados a zonas; no permite elegir distritos libres ni
   navegar el catálogo global → no cumple R10. Se exponen las lecturas de `GeoRepository`.
4. **Meter las lecturas de catálogo geo dentro de `ZonaService`.** *Descartada*: mezcla
   responsabilidades; se prefiere un `GeoService` delgado sobre `IGeoRepository` (una
   responsabilidad, testeable), coherente con la separación de capas.
5. **Formulario "toggle `esCentral`" sin distritos/tarifas** como única entrega.
   *Descartada como diseño base* (queda como F1.4-B alternativa): el contrato de
   `actualizar` es reemplazo completo con `distritoIds.min(1)`, así que un toggle-only no
   puede editar zonas reales ni crearlas; se recomienda reconstrucción completa.

## 7. Notas de riesgo para el implementer
- **Divergencia escalar↔N:M de distritos** (§3.1 nota): seed usa `distrito.zonaId`; CRUD
  usa `ZonaDistrito`. No re-litigar feature 24; sólo documentar el efecto en el prefill.
- Al quitar `Provincia.zonaId`/`Zona.provincias`: `prisma generate` + typecheck deben
  quedar 0; hacer grep en `app/`, `lib/`, `tests/`, `scripts/` por `.provincias`,
  `provincia.zonaId`, `zona: { ... provincia ... }` antes de borrar (grep de `lib/` ya
  mostró que sólo hay usos de la relación `orden.provincia`, ajena a esto).
- Reusar componentes existentes: `Modal` (feature 13), `useToast` (feature 11),
  `DataTable`/`Pagination` (feature 7), `Switch`/`Select`/`Input`/`Label` de
  `components/ui/`, `withErrorHandler` (`lib/errors`). No crear primitivas nuevas.
- `obtenerZona` ya trae `tarifas` (includeTarifas=true) → sirve para prefill de tarifas en
  edición; los distritos de la zona NO vienen en `ZonaDTO` (sólo `distritosCount`) → el
  prefill de distritos se resuelve navegando el catálogo y pre-marcando por `zonaId`.
