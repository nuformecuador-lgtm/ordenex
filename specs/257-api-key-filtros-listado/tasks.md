# Feature 257 — Tasks

Orden por dependencias. `[P]` = paralelizable con las tareas de su mismo bloque.
Cada task tiene criterio de "hecho" verificable.

> **Gate:** este cambio NO toca migraciones, `db/schema.prisma`, `lib/types/` ni configuración de
> build, así que el gate normal es **`./init.sh --rapido`**, también para abrir el PR.
> ✅ Decidido en la puerta (2026-08-21): el índice compuesto opcional (T11) **queda fuera**,
> así que no hay migración y el gate rápido NO se niega. `--rapido` es el gate, y punto.

---

## Bloque 0 — Preparación

- [x] **T0. Rama y baseline.** Crear `feature/257-api-key-filtros-listado` desde `dev` y medir el
      baseline de rojos ANTES de tocar nada (`dev` puede venir rojo: los 20 rojos de `ux` ya están
      en `dev`).
      **Hecho:** el número de rojos previos está anotado en `progress/impl_257.md`; ningún rojo
      posterior se atribuye a esta feature sin comparar contra él.

## Bloque 1 — Contratos internos (de dentro hacia fuera)

- [x] **T1. Ampliar `ApiOrdenListarParams`.** En
      `lib/interfaces/services/IApiOrdenLecturaService.ts`, añadir `desde?: string`,
      `hasta?: string`, `numGuia?: number`, `numRemision?: string`, con comentario de que las
      fechas llegan ya validadas como `YYYY-MM-DD`. Depende de: T0.
      **Hecho:** `pnpm typecheck` verde (los campos son opcionales, nada existente se rompe).

- [x] **T2. Ampliar la firma de `listByOwner`.** En
      `lib/interfaces/repositories/IOrdenRepository.ts` y en `OrdenRepository.listByOwner`
      (`lib/repositories/OrdenRepository.ts:1624`), añadir `createdAtDesde?: Date`,
      `createdAtHasta?: Date`, `numGuia?: number`, `numRemision?: string`.
      Depende de: T0. `[P]` con T1.
      **Hecho:** typecheck verde y los llamadores actuales siguen compilando sin cambios.

## Bloque 2 — Implementación

- [x] **T3. `where` de `listByOwner`.** Aplicar los filtros con spreads condicionales según
      `design.md` §4: `createdAt: { gte, lt }` (**`lt`, nunca `lte`**), `numGuia`, `numRemision`.
      `tiendaId` y `deletedAt: null` se escriben primero y no se tocan; `findMany` y `count`
      siguen compartiendo el MISMO objeto `where`; el `orderBy` no cambia. Depende de: T2.
      **Hecho:** T7 en verde; revisión visual confirma que ningún parámetro externo entra al
      `where` como fragmento de objeto.

- [x] **T4. Conversión de fecha en el service.** En `ApiOrdenLecturaService.listar`, traducir
      `desde`/`hasta` a instantes con `inicioDelDiaCREnUtc` / `inicioDelDiaSiguienteCREnUtc` de
      `lib/utils/fecha-cr` y pasar `numGuia`/`numRemision` al repo. Depende de: T1, T3.
      **Hecho:** T6 en verde **y** `grep -r "startOfDayCR" lib/services/ApiOrdenLecturaService.ts`
      no devuelve nada (la trampa de `design.md` §8.2).

- [x] **T5. Borde HTTP.** En `app/api/ordenes/api-key/route.ts`: añadir las cuatro lecturas
      `if (sp.has(...))` **manteniendo el patrón clave por clave**, ampliar `listadoQuerySchema`
      (`desde`/`hasta` con `.refine(esFechaCalendarioValida)`, `num_guia` entero positivo,
      `num_remision` `trim().min(1)`), añadir el `superRefine` de `desde <= hasta` con
      `path: ["hasta"]`, y mapear al service. Depende de: T4.
      **Hecho:** T8 en verde; no aparece ningún `Object.fromEntries(searchParams)`.

## Bloque 3 — Tests (uno por requisito; el reviewer rechaza si falta alguno)

- [x] **T6. `tests/unit/services/api-orden-lectura-service.filtros-257.test.ts`** — service con
      repo mockeado, **reloj fijo**, asertando los `Date` exactos que recibe el repo.
      Depende de: T4.
      Cubre: **R5, R6, R7, R8, R9**.
      **Hecho:** el test afirma literalmente `2026-08-01T06:00:00.000Z` como `gte` y
      `2026-08-22T06:00:00.000Z` como `lt` para `desde=2026-08-01&hasta=2026-08-21`, y con
      `desde=hasta=2026-08-10` la ventana mide exactamente 24 h.

- [x] **T7. `tests/unit/repositories/orden-repository.listado-filtros-257.test.ts`** — repo con
      Prisma mockeado, asertando la forma del `where` y que `count` recibe el mismo.
      Depende de: T3. `[P]` con T6.
      Cubre: **R15, R18, R20, R23, R24, R25**.
      **Hecho:** hay un caso que pasa los cuatro filtros a la vez y afirma que `where.tiendaId`
      sigue siendo EXACTAMENTE el owner recibido (`ownerId`) y que ningún parámetro de entrada
      puede alterarlo —incluido un intento explícito de colar un `tiendaId` ajeno, que no debe
      llegar al `where`—; y otro caso que comprueba `lt` (no `lte`).

- [x] **T8. `tests/integration/api/ordenes-api-key-listado-filtros.route.test.ts`** — mismo patrón
      de DI que `ordenes-api-key-listado.route.test.ts` (`handleListadoApi` + `ListadoApiDeps`).
      Depende de: T5. `[P]` con T6/T7.
      Cubre: **R1, R2, R3, R4, R10, R11, R12, R13, R14, R16, R17, R19**.
      **Hecho:** incluye los casos `2026-02-31` → 422 (no rueda a marzo), `desde > hasta` → 422 con
      `fieldErrors.hasta`, `?tiendaId=otra` ignorado, y query inválida con key ausente → **401, no
      422**.

- [x] **T9. `tests/integration/api/ordenes-api-key-filtros-scope-ajeno.route.test.ts`** — el test
      de seguridad, en archivo propio para que se vea al listar la suite. Depende de: T5.
      Cubre: **R21, R22**.
      **Hecho:** filtrar por un `num_guia` y por un `num_remision` que existen en OTRA tienda
      devuelve `200` con `items: []` y `total: 0`, y la respuesta es **idéntica** (mismo status,
      mismo body) a la de un número que no existe en ninguna tienda. Comparación explícita entre
      ambos bodies en el assert, no dos asserts separados.

- [x] **T10. `tests/unit/api/openapi-257-filtros-listado.test.ts`** — guardia de documentación,
      al estilo de `openapi-177-paths-pdf-y-carga-id.test.ts`. Depende de: T12. `[P]` con T8/T9.
      Cubre: **R26**.
      **Hecho:** afirma que los cuatro parámetros existen en
      `paths["/api/ordenes/api-key"].get.parameters` con su `example`, y que el YAML espejo
      `docs/api/api-key-openapi.yaml` los menciona.

## Bloque 4 — Documentación pública

- [x] **T12. OpenAPI + espejo YAML.** Añadir los cuatro parámetros en `lib/api/openapi-spec.ts`
      (§5 del design) y replicarlos en `docs/api/api-key-openapi.yaml`, incluida la nota de que
      `hasta` es inclusivo en hora de Costa Rica y de que un número ajeno da página vacía, no 404.
      Depende de: T5.
      **Hecho:** T10 en verde y `/api-docs` renderiza los cuatro parámetros.

## Bloque 5 — DESCARTADO en la puerta

- [~] **T11. [DESCARTADO] Índice compuesto `(tienda_id, created_at)`.** El humano lo rechazó
      explícitamente al aprobar la fase 2 el 2026-08-21: **"aprobado, sin el índice compuesto"**.
      NO se crea la migración, NO se toca `db/schema.prisma`. Consecuencia directa: **el gate de
      esta feature es `./init.sh --rapido`**, incluido para abrir el PR.
      Si alguna vez se retoma, será con una medición que lo justifique y en su propia ficha, no
      colándolo aquí.

## Bloque 6 — Cierre

- [x] **T13. Mapa de trazabilidad.** Escribir `progress/impl_257.md` con la tabla `R<n>` → archivo
      de test → nombre del `it(...)`, para los 26 requisitos. Depende de: T6–T10.
      **Hecho:** ningún `R<n>` de `requirements.md` queda sin fila.

- [ ] **T14. Gate y PR.** `./init.sh --rapido` verde (T11 descartado: no hay migración), commit
      por task lógica (`feat(257): ...`, `test(257): ...`, `docs(257): ...`) y PR contra `dev`.
      Depende de: T13.
      **Hecho:** gate en verde con delta 0 contra el baseline de T0 y PR abierto.

---

## Mapa R → test (resumen para el reviewer)

| R | Test |
| --- | --- |
| R1, R2, R3 | T8 |
| R4 | T8 |
| R5, R6, R7, R8, R9 | T6 |
| R10, R11, R12 | T8 |
| R13, R14 | T8 |
| R15 | T7 |
| R16, R17 | T8 |
| R18 | T7 |
| R19 | T8 |
| R20 | T7 |
| R21, R22 | T9 |
| R23, R24, R25 | T7 |
| R26 | T10 |
