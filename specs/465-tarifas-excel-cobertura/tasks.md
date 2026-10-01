# 465 — Tasks: Excel de cobertura por distrito

Zona: fullstack → se secuencia **backend (T1–T6) → frontend (T7–T10)**. Sin migraciones.
Gate: `./init.sh` **completo** (el diff toca `lib/types/`, así que `--rapido` se niega solo).

## Archivos

Nuevos:
- `lib/types/cobertura.ts`
- `lib/interfaces/repositories/ICoberturaRepository.ts`
- `lib/repositories/CoberturaRepository.ts`
- `lib/utils/cobertura-distrito.ts`
- `lib/interfaces/services/ICoberturaService.ts`
- `lib/services/CoberturaService.ts`
- `lib/actions/cobertura.ts`
- `app/(app)/configuracion/tarifas/_components/cobertura-descarga-columnas.ts`
- `app/(app)/configuracion/tarifas/_components/DescargarCoberturaButton.tsx`
- tests en `tests/unit/...` y `tests/integration/db/...` (ver cada task)

Editado (único existente): `app/(app)/configuracion/tarifas/page.tsx`.

**NO tocar** (conflicto con la 275, pending): `TiendasModule.tsx`, `CrearTiendaForm.tsx`; tampoco
`ZonasTarifasModule.tsx`, `GeoRepository.ts`, `geo-resolucion.ts`, `zona-colapso.ts`,
`geografia-activa.ts`, `cascada-tarifa.ts` ni nada de `components/shared/` (se reutilizan, no se editan).

## Backend

- [x] **T1 — Tipos de dominio.** Crear `lib/types/cobertura.ts` con `MotivoSinCobertura` y
  `CoberturaDistritoDTO` (design §3.1), sin textos de UI.
  *Hecho:* `pnpm typecheck` verde; el módulo no importa Prisma, React ni `app/`.

- [x] **T2 — Regla pura** (dep. T1). `lib/utils/cobertura-distrito.ts`: `clasificarCobertura` y
  `compararCobertura` usando `zonaUnicaDeDistrito`; `DistritoCoberturaRow` se importa de la interfaz
  del repo (T3) o se declara allí primero.
  *Hecho:* `tests/unit/utils/cobertura-distrito.test.ts` cubre R6, R7, R8, R9 (precedencia con
  provincia+cantón+distrito retirados a la vez, retirado con 0 zonas → «distrito retirado»), zonas
  ordenadas, `zonaEspecial` null/true/false, tarifa general sí/no.

- [x] **T3 [P con T2] — Interfaz + repositorio.** `ICoberturaRepository` y `CoberturaRepository`
  (design §3.2): `listDistritos()` con activos e inactivos, zonas SIN colapsar y `disponible` vía
  `disponibleDesdeCadena`; `listZonaIdsConTarifaGeneral()` con `tiendaId: null, zonaId: { not: null }`.
  *Hecho:* `tests/integration/db/cobertura-repository.test.ts` con datos sembrados (falla si no hay
  filas, sin `if (!x) return`): tarifas (NULL,Z1), (T,Z2), (T,NULL), (NULL,NULL) → solo Z1;
  distritos con 0/1/2 zonas, uno inactivo por su cantón → `disponible=false` con `activo=true`.
  Comprobar el test matándolo con una mutación del `where` (p. ej. quitar `tiendaId: null`).

- [x] **T4 — Equivalencia con `resolveGeo`** (dep. T2). `tests/unit/utils/cobertura-vs-resolve-geo.test.ts`
  (design §4): para cada fixture, `cobertura === resolveGeo(...).ok` y el motivo casa con el campo
  del error.
  *Hecho:* verde; una mutación que invierta el orden distrito-retirado/sin-zona en T2 lo pone rojo (R15).

- [x] **T5 — Servicio** (dep. T2, T3). `ICoberturaService` + `CoberturaService.listar(actor)`
  (design §3.4).
  *Hecho:* `tests/unit/services/CoberturaService.test.ts`: rol ≠ maestro → `forbidden` con 0
  llamadas al repo (R2); maestro → items ordenados y clasificados; > `MAX_FILAS` →
  `limite_excedido`; el doble del repo solo expone los 2 métodos de lectura (R21).

- [x] **T6 — Server Action** (dep. T5). `lib/actions/cobertura.ts` → `listarCoberturaDistritos(deps?)`
  con composition root `buildCoberturaService()`.
  *Hecho:* `tests/unit/actions/cobertura.test.ts`: sin actor → `unauthenticated` sin construir el
  servicio (R3); `forbidden` se propaga; `tests/unit/actions/cobertura.composition-root.test.ts`
  comprueba que el servicio recibe un `CoberturaRepository` real (no solo que se importa).

## Frontend

- [x] **T7 — Columnas y proyección** (dep. T1). `cobertura-descarga-columnas.ts`:
  `AMBITO_DESCARGA_COBERTURA`, `COLUMNAS_DESCARGA_COBERTURA`, `filaCobertura` (design §3.6).
  *Hecho:* `tests/unit/app/tarifas/cobertura-descarga-columnas.test.ts` con LITERALES (son el
  contrato): claves y encabezados en el orden de R5; textos de R9-R14 («Sí», «No», «Sin zona»,
  «Varias zonas: A, B», «Sin definir», `null` donde va vacío).

- [x] **T8 — Botón** (dep. T6, T7). `DescargarCoberturaButton.tsx` envolviendo
  `DescargarDatasetButton` con título «Cobertura por distrito», `formatos={["xlsx"]}`,
  `ambitoColumnas`, `label="Descargar cobertura"` y `obtenerFilas` vía `filasDesdeResultado`.
  *Hecho:* `tests/unit/app/tarifas/DescargarCoberturaButton.test.tsx` (RTL, action inyectada o
  mockeada): texto del botón y ayuda (R1); dos clics → dos llamadas a la action (R4); props
  `ambitoColumnas`/`formatos`/`titulo` llegan al control común (R16, R17); `unauthenticated` y
  error → toast sin archivo (R3, R18); 0 filas → aviso sin archivo (R19).

- [x] **T9 — Montaje en la página** (dep. T8). Editar `app/(app)/configuracion/tarifas/page.tsx`:
  bloque «Cobertura» con el botón y la línea de ayuda antes de `<ZonasTarifasModule>`.
  *Hecho:* test de la página (o el existente ampliado): maestro ve «Descargar cobertura»; otro rol
  ve solo el aviso de permiso (R1).

- [x] **T10 — Verificación visible** (dep. T9). Con el dev server (uno solo), entrar como maestro
  a `/configuracion/tarifas`, descargar, abrir el `.xlsx` y comparar con números: total de filas =
  `SELECT count(*) FROM distrito`; filas «Cobertura = Sí» = distritos disponibles con exactamente
  una fila en `zona_distrito`. Anotar los números en `progress/impl_465.md`.
  *Hecho:* números coinciden; nombre `cobertura-por-distrito-AAAA-MM-DD.xlsx`; tildes correctas.

## Cierre

- [x] **T11** (dep. T1–T10). `progress/impl_465.md` con el mapa R1–R21 → test concreto y
  `./init.sh` completo en verde (revisar `skipped` de `integration/db`, no solo el exit code).
  *Hecho:* cada R tiene al menos un test; gate completo verde con la integración ejecutada.
