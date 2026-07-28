# Feature 144 — Filtros de órdenes (zona, tienda, geografía y tiempo) · tasks.md

> Checklist de pasos discretos y verificables. `[P]` = paralelizable con las tareas
> marcadas igual dentro del mismo bloque. Cada task lleva su criterio de **hecho**.
> **Puerta F1.4 CERRADA (2026-07-28)** + dos decisiones de cierre: ver `design.md §0`.
> Convención de commits: `feat(144): …` / `test(144): …` / `chore(144): …`, uno por task.
>
> **Orden obligatorio: el bloque A (componente genérico) se construye y se testea ANTES del
> bloque B (cableado en órdenes).** B consume A; si A se define "a medida" de B, el
> componente nace acoplado y la feature 145 empieza con deuda.
>
> **Regla dura de review para A:** ni `FilterComponent`, ni `DateRangeFilter`, ni
> `filter-dependencies.ts`, ni sus tests pueden importar `lib/types/orden`, `lib/actions/*`
> ni `app/(app)/ordenes/*`. Los tests de R1–R29 usan filtros de fantasía (`color` → `talla`).
>
> **Dependencias nuevas: NINGUNA** (`design.md §7`). El repo es **pnpm**. El rango de fechas
> son dos `<Input type="date">` al estilo de `WalletFiltros`; **no** se instala
> `react-day-picker`, **no** se instala Radix, **no** se corre `shadcn add`. Si al terminar
> `package.json` cambió, la task T6.3 falla.

---

## Bloque A1 — Motor de dependencias (puro, sin dominio)

- [ ] **TA.1 — Utilidades de dependencias.** `lib/utils/filter-dependencies.ts`:
  `opcionesVisibles`, `seleccionEfectiva`, `podarSeleccion` (`design.md §A.7`). Puras, sin
  React, sin dominio, con guarda de ciclos.
  **Hecho:** tests con filtros de fantasía: sin `dependsOn` → todas las opciones; padre con
  selección → hijo acotado; padre SIN selección → hijo acotado a las opciones visibles del
  padre; cadena de 3 niveles; `dependsOn` a clave inexistente → independiente; ciclo → no
  cuelga; poda idempotente (R23, R24, R25, R26-parcial, R27).

## Bloque A2 — Controles

- [ ] **TA.2 `[P]` — `group` en `MultiSelectFilter`.** Añadir `group?: string` a
  `MultiSelectOption` y render por secciones (`role="group"` + `aria-label`), preservando el
  orden de aparición de los grupos. Sin grupos → markup y ARIA **idénticos a hoy**.
  **Hecho:** tests nuevos de agrupado + **los tests existentes de `MultiSelectFilter` y del
  filtro de estado pasan SIN modificarlos** (R28, R65, riesgo §8.5).

- [ ] **TA.3 `[P]` — `DateRangeFilter`.** `components/shared/DateRangeFilter.tsx`: atajos
  (de `options`) + dos `<Input type="date">` (desde/hasta) + "Limpiar" propio, con la
  **exclusión mutua interna** (elegir atajo vacía las fechas; escribir una fecha vacía el
  atajo). `min`/`max` cruzados entre los dos inputs, `aria-invalid` + mensaje si queda
  invertido y **no emite** en ese caso. Alineado con el patrón de
  `app/(app)/wallet/_components/WalletFiltros.tsx` (Label + Input `type="date"` + Limpiar);
  **sin** botón "Aplicar" (aquí se emite en cada cambio de valor). **Sin dependencias
  nuevas.**
  **Hecho:** tests: elegir atajo emite `["30d","",""]` y vacía fechas; escribir `desde`
  emite `["","D",""]` y vacía el atajo; rango completo emite `["","D","H"]`; solo `hasta`
  emite `["","","H"]`; invertido no emite y marca inválido; "Limpiar" vacía las tres
  posiciones y emite; `disabled` no emite (R8, R9, R10, R11, R12, R21).

## Bloque A3 — Orquestador

- [ ] **TA.4 — `FilterComponent`.** `components/shared/FilterComponent.tsx`: monta
  `MultiSelectFilter` (`multi`), `Select` de `components/ui` (`single`) y `DateRangeFilter`
  (`dateRange`); estado agregado **no controlado**; aplica TA.1 antes de emitir;
  `showClearAll`.
  **Hecho:** tests con filtros de fantasía: monta N filtros en el orden declarado; emite la
  selección agregada al seleccionar; NO emite al teclear en el buscador; `single` sustituye
  el valor anterior; tipo desconocido se ignora sin romper el resto; filtro de opciones sin
  opciones → deshabilitado; `disabled` global; claves sin selección ausentes (incluida la
  del `dateRange` vacío); forma uniforme `Record<string,string[]>` con el tiempo como
  `[atajo, desde, hasta]` sin compactar; "Limpiar todo" vacía y emite `{}` una vez; el hijo
  huérfano ya no aparece en lo emitido tras cambiar el padre; nombre accesible por filtro
  (R1–R7, R13–R20, R22, R26, R29).
  *Depende de TA.1, TA.2, TA.3.*

- [ ] **TA.5 `[P]` — Documentar el contrato.** Cabecera JSDoc en `FilterComponent` con el
  contrato de props, la semántica de `dependsOn`/`parentValue`/`group`, el uso de `options`
  como atajos en `dateRange`, la **tabla de qué emite el filtro de tiempo en cada caso** y la
  frase "la traducción al transporte es del consumidor".
  **Hecho:** el reviewer puede leer el contrato sin abrir el spec.
  *Depende de TA.4.* `[P]` con el bloque B1.

> **Gate A→B:** ningún archivo del bloque B se toca hasta que TA.1–TA.4 estén en verde. Con
> A cerrado, B1, B2 y B5 avanzan en paralelo.

---

## Bloque B1 — Backend: contrato y consulta

- [x] **TB1.1 — Ampliar el schema del filtro.** `lib/types/orden.ts`:
  `ORDEN_FILTER_FIELDS` a 9 claves; los cinco de catálogo como `idList` (`.nonempty()`);
  `created_preset` como `z.enum`; `created_desde`/`created_hasta` como fecha `YYYY-MM-DD`;
  `.refine` de rango no invertido **y** `.refine` de exclusión preset↔rango. Mantener
  `.strict()` y la unión escalar|lista de `status_id`.
  **Hecho:** `pnpm typecheck` verde; tests del schema, incluido "preset + desde →
  `validation_error`" (R30, R31, R32, R38, R39, R40, R43).

- [x] **TB1.2 `[P]` — Helpers de borde horario CR.** `inicioDelDiaCREnUtc()` e
  `inicioDelDiaSiguienteCREnUtc()` en `lib/utils/fecha-cr.ts`, con el ajuste de +6 h
  documentado.
  **Hecho:** tests de borde `2026-07-15T05:59:59Z` vs `06:00:00Z`, y `hasta` inclusive
  (incluye `2026-07-16T05:59:59Z` para `hasta = 2026-07-15`) (R41, R42).

- [x] **TB1.3 — Traducción en el service.** `OrdenService.listar`: `FILTER_TO_COLUMN`
  ampliado; `where` tipado a `string | string[]`; preset/rango → `createdAt: {gte, lt}`;
  **scoping por rol escrito al final**.
  **Hecho:** tests con repo mockeado del `where` construido (R33, R34, R36, R37, R41, R42,
  R46).
  *Depende de TB1.1, TB1.2.*

- [x] **TB1.4 — `where` en el repositorio.** `OrdenRepository.list` + `ListOrdenesParams`:
  listas → `{ in: [...] }`, `createdAt: { gte, lt }`, `deletedAt: null` intacto, `count` con
  el MISMO `where`.
  **Hecho:** test (Prisma mockeado) del objeto `where` y de la identidad
  `findMany.where === count.where`; test de que una orden con `distrito_id = NULL` NO entra
  bajo el filtro de distrito (R35, R44, decisión (f)).
  *Depende de TB1.3.*

- [x] **TB1.5 — Test de no regresión del contrato.** Sin `filter`, o con solo `status_id`,
  el input recibido por service/repositorio es **idéntico** al previo (criterio de la 63).
  **Hecho:** test verde contra el snapshot previo (R45).
  *Depende de TB1.4.*

---

## Bloque B2 — Backend: catálogos

- [x] **TB2.1 `[P]` — Proyección plana de geografía.** `GeoRepository`: provincias
  `{id,nombre}`, cantones `{id,nombre,padreId}`, distritos `{id,nombre,padreId}`, ordenados
  por nombre, campos mínimos (`design.md §3.2`).
  **Hecho:** test unitario con Prisma mockeado (R48, R49).

- [x] **TB2.2 `[P]` — Cuentas tienda.** `UserRepository.listCuentasTienda()`:
  `rol.value IN ('adminTienda','apiKey')`, **sin filtrar por `estado`**, proyección
  `{id, nombre, esApiKey, activa}`.
  **Hecho:** test: incluye ambos roles, incluye inactivas, expone las dos banderas, no
  expone email/teléfono, orden por nombre (R50, R54).

- [x] **TB2.3 `[P]` — Zonas ligeras.** Proyección `{id,nombre}` en `ZonaRepository`.
  **Hecho:** test unitario verde (R48, R49).

- [x] **TB2.4 — `FiltrosOrdenesService`.** `obtenerCatalogo(actor)` con **`Promise.all`** de
  las cinco lecturas y autorización `maestro`/`admin`/`adminTienda` → `ok`, resto →
  `forbidden`, sin sesión → `unauthenticated`.
  **Hecho:** tests sin DB: las cinco lecturas se disparan **en paralelo** (los mocks se
  invocan antes de resolver el primero); autorización por rol (R47, R52, R53).
  *Depende de TB2.1, TB2.2, TB2.3.*

- [ ] **TB2.5 — Resolución en el Server Component.** `app/(app)/ordenes/page.tsx` llama al
  service tras las guardias de rol y pasa el catálogo por props (o `null` si falla), sin
  romper la página.
  **Hecho:** test de la page: `admin` recibe catálogo; fallo del service → props `null` y la
  página sigue renderizando; roles bloqueados siguen en `notFound()` (R47, R64).
  *Depende de TB2.4.*
  > **Queda para el `frontend_dev`:** es la única task de B2 que toca un `.tsx`. El
  > backend ya dejó listo su punto de entrada: `obtenerCatalogoFiltrosOrdenes()` en
  > `lib/actions/filtros-ordenes.ts` (resuelve el actor, autoriza y hace el `Promise.all`
  > dentro del service). La page solo tiene que llamarlo tras sus guardias de rol y pasar
  > `catalogo` (o `null` si el `status` no es `ok` o si lanza) por props.

---

## Bloque B3 — Declaración y traducción (lo específico de órdenes)

- [ ] **TB3.1 — `construirFiltrosOrdenes`.** Función pura en
  `_components/ordenes-filtros-def.ts`: catálogo + `incluirTienda` → `FilterDef[]` con
  **seis** filtros (cinco sin tienda), `dependsOn` en cantón/distrito, `parentValue` por
  opción, `group` por tipo de cuenta, sufijo "(inactiva)", y el filtro `created` de kind
  `dateRange` con los cuatro atajos como `options`.
  **Hecho:** tests: 6 declaraciones (5 sin tienda); `dependsOn` correctos; cada opción de
  cantón/distrito lleva padre; las cuentas `apiKey` caen en otro grupo; las inactivas se
  marcan en el label; el filtro de tiempo es UNO solo (R51, R55, R56, R62).
  *Depende de TA.4 y TB2.5.*

- [ ] **TB3.2 `[P]` — `seleccionAFilter`.** Función pura en
  `_components/seleccion-a-filter.ts`: `FilterSelection` → `Partial<OrdenFilterInput>`
  (listas tal cual; `created` posicional → `created_preset` **o** `created_desde`/
  `created_hasta`; claves vacías fuera).
  **Hecho:** tests de los cinco casos de la tabla de `requirements.md > Trazabilidad`:
  vacío → `{}`; `["30d","",""]` → `created_preset`; `["","D","H"]` → dos claves;
  `["","D",""]` → solo `created_desde`; `["","","H"]` → solo `created_hasta` (R58, R59).
  *Depende de TA.4.*

---

## Bloque B4 — Cableado del listado

- [ ] **TB4.1 — `OrdenesListado`.** Recibe `catalogoFiltros` por props, monta
  `FilterComponent` con `construirFiltrosOrdenes` y `showClearAll`, funde `status_id` +
  `seleccionAFilter` en un único `filter`, `incluirTienda` por rol, `disabled` si el
  catálogo es `null`.
  **Hecho:** tests: sin selección, `OrdenesModule` recibe `filter` sin las claves nuevas; con
  selección, las recibe; `adminTienda` no monta el filtro de tienda; catálogo `null` → barra
  deshabilitada y tabla viva; la cadena geográfica acota de punta a punta **sin llamadas al
  servidor**; "Limpiar todo" visible (R46, R57, R59, R62, R63, R64).
  *Depende de TB3.1, TB3.2, TB2.5.*

- [ ] **TB4.2 — Key de SWR y reset.** `statusKey`/`statusKeyPrevio` →
  `filterKey`/`filterKeyPrevio` con `serializarFiltro` (claves y valores ordenados); reset a
  página 1 + limpieza de selección ante cualquier cambio; `mutate` por prefijo
  `"ordenes:list"` intacto.
  **Hecho:** tests: dos selecciones equivalentes → misma key (sin refetch); cambiar un filtro
  vuelve a página 1 y vacía la selección; sin `filter`, la llamada a `listarOrdenes` es la
  previa (R60, R61, R45).
  *Depende de TB4.1.*

---

## Bloque B5 — Datos

- [x] **TB5.1 `[P]` — Migración de índices.** `db/migrations/<ts>_orden_indices_filtros/`
  con `migration.sql` (4 `CREATE INDEX`) y `down.sql` (4 `DROP INDEX IF EXISTS`), más los
  `@@index` en `db/schema.prisma`.
  **Hecho:** `pnpm db:migrate` aplica y `pnpm db:rollback` revierte sin residuos; test de
  migración/rollback (patrón `tests/integration/db/*-migracion.test.ts`) verde. Sin tablas
  nuevas ⇒ sin RLS nueva.
  *Independiente; puede correr desde el inicio del bloque B.*
  > **NO se aplicó contra la base.** El `.env` de este worktree apunta a una base
  > compartida con producción, así que la migración se validó **por forma estática**
  > (`tests/integration/db/orden-indices-filtros-migracion.test.ts`: 4 `CREATE INDEX`,
  > 4 `DROP INDEX IF EXISTS`, sin DDL de tablas/columnas, `@@index` en `schema.prisma`).
  > **Pendiente al desplegar: `prisma migrate deploy`.** Carpeta:
  > `db/migrations/20260728120000_orden_indices_filtros/`.

---

## Bloque 6 — Cierre

- [ ] **T6.1 — No regresión de otras superficies.** Dashboard del `adminTienda`, listado
  plano de `OrdenesModule` sin props, filtro de estado de la 63, `WalletFiltros` y resto de
  tablas se comportan igual.
  **Hecho:** suite existente verde **sin modificar sus asserts** (R65, riesgo §8.5).
  *Depende de B4.*

- [ ] **T6.2 — Aislamiento del bloque A.** Verificar que `FilterComponent`,
  `DateRangeFilter`, `filter-dependencies.ts` y sus tests no importan dominio.
  **Hecho:** revisión de imports (o regla de lint/grep documentada en el impl) sin hallazgos;
  ningún test de R1–R29 menciona órdenes/zona/provincia/distrito.

- [ ] **T6.3 — Verificación ejecutable.** `./init.sh`, `pnpm typecheck`, `pnpm lint`,
  `pnpm test` en verde, medidos en este worktree limpio. **`git diff package.json
  pnpm-lock.yaml` debe salir VACÍO** (dependencias nuevas: ninguna).
  **Hecho:** salida pegada en `progress/impl_144-filtros-ordenes.md` con el delta contra el
  baseline medido AL EMPEZAR (no citado de memoria).

- [ ] **T6.4 — Mapa R→test.** Rellenar la tabla de abajo con archivo y nombre exactos.
  **Hecho:** los 65 requisitos tienen test; el reviewer lo verifica.

---

## Trazabilidad R → test (a completar por el implementer)

### Bloque A — sin dominio (tests con filtros de fantasía)

| R | Qué prueba | Task | Test (archivo::nombre) |
| --- | --- | --- | --- |
| R1 | monta N filtros declarados por props | TA.4 | `tests/unit/components/filter-component.test.tsx` |
| R2 | cada filtro define clave, etiqueta, tipo y opciones | TA.4 | idem |
| R3 | orden de render = orden de declaración | TA.4 | idem |
| R4 | no hace fetch: todo llega por props | TA.4 | idem (sin mocks de red) |
| R5 | emite los valores declarados sin transformarlos | TA.4 | idem |
| R6 | múltiple con buscador interno | TA.4 | idem |
| R7 | único sustituye el valor anterior | TA.4 | idem |
| R8 | rango con dos extremos separados | TA.3 | `tests/unit/components/date-range-filter.test.tsx` |
| R9 | los atajos se ofrecen DENTRO del mismo filtro | TA.3 | idem |
| R10 | exclusión mutua atajo ↔ rango | TA.3 | idem |
| R11 | emite con un solo extremo (rango abierto) | TA.3 | idem |
| R12 | rango invertido → inválido y no emite | TA.3 | idem |
| R13 | tipo desconocido se ignora sin romper el resto | TA.4 | `filter-component.test.tsx` |
| R14 | filtro de opciones sin opciones → deshabilitado | TA.4 | idem |
| R15 | `disabled` global no emite | TA.4 | idem |
| R16 | emite la selección agregada al seleccionar | TA.4 | idem |
| R17 | NO emite al teclear en el buscador | TA.4 | idem |
| R18 | claves sin selección ausentes (incl. fechas vacías) | TA.4 | idem |
| R19 | forma uniforme; tiempo = `[atajo, desde, hasta]` sin compactar | TA.3 + TA.4 | `date-range-filter.test.tsx` + idem |
| R20 | salida agnóstica (no construye consulta de nadie) | TA.4 | idem |
| R21 | limpieza individual; en fechas vacía las 3 posiciones | TA.3 | `date-range-filter.test.tsx` |
| R22 | "Limpiar todo" vacía y emite `{}` una vez | TA.4 | `filter-component.test.tsx` |
| R23 | `dependsOn` por clave, sin conocer el dominio | TA.1 | `tests/unit/utils/filter-dependencies.test.ts` |
| R24 | acotamiento por selección efectiva del padre | TA.1 | idem |
| R25 | transitividad en cadena de 3 niveles | TA.1 | idem |
| R26 | poda transitiva reflejada en lo emitido | TA.1 + TA.4 | idem + `filter-component.test.tsx` |
| R27 | `dependsOn` a clave inexistente → independiente | TA.1 | idem |
| R28 | agrupado con cabecera accesible; sin grupo → plano | TA.2 | `tests/unit/components/multi-select-filter-grupos.test.tsx` |
| R29 | nombre accesible y estado por opción | TA.4 | `filter-component.test.tsx` |

### Bloque B — órdenes

| R | Qué prueba | Task | Test (archivo::nombre) |
| --- | --- | --- | --- |
| R30 | el filtro acepta las 8 claves nuevas | TB1.1 | `tests/unit/types/orden-filter-schema.test.ts` |
| R31 | clave fuera de whitelist → `validation_error` sin consulta | TB1.1 | idem |
| R32 | lista vacía / id vacío → `validation_error` | TB1.1 | idem |
| R33 | AND entre filtros distintos | TB1.3 | `tests/unit/services/orden-service-filtros.test.ts` |
| R34 | OR (`IN`) dentro del mismo filtro | TB1.3 | idem |
| R35 | id inexistente → cero filas, nunca "sin filtro" | TB1.4 | `tests/unit/repositories/orden-repository-filtros.test.ts` |
| R36 | `adminTienda`: el filtro de tienda no amplía su alcance | TB1.3 | `orden-service-filtros.test.ts` |
| R37 | `mensajero`: sigue acotado a sus asignadas | TB1.3 | idem |
| R38 | preset: valor único de dominio cerrado | TB1.1 | `orden-filter-schema.test.ts` |
| R39 | fechas `YYYY-MM-DD`; rango invertido → `validation_error` | TB1.1 | idem |
| R40 | preset + rango a la vez → `validation_error` (falla cerrado) | TB1.1 | idem |
| R41 | preset de N días → borde 00:00 CR de hace N−1 días | TB1.2/TB1.3 | `tests/unit/utils/fecha-cr-filtros.test.ts` |
| R42 | desde/hasta con `hasta` INCLUSIVE; rango abierto | TB1.2/TB1.3 | idem |
| R43 | validación en el borde; bordes calculados server-side | TB1.1/TB1.3 | `orden-filter-schema.test.ts` + service |
| R44 | `count` con el mismo `where` que `findMany` | TB1.4 | `orden-repository-filtros.test.ts` |
| R45 | sin filtros nuevos, input idéntico al previo | TB1.5 / TB4.2 | `orden-service-filtros.test.ts` |
| R46 | combina con `status_id` sin anularse | TB1.3 / TB4.1 | idem + test de `OrdenesListado` |
| R47 | catálogos resueltos en paralelo en el servidor y por props | TB2.4/TB2.5 | `tests/unit/services/filtros-ordenes-service.test.ts` |
| R48 | cada opción con id, nombre y padre donde aplica | TB2.1 | `tests/unit/repositories/geo-repository.test.ts` |
| R49 | orden determinista | TB2.1/2.2/2.3 | tests de repositorio |
| R50 | tiendas: incluye `apiKey` e inactivas | TB2.2 | `tests/unit/repositories/user-repository-tiendas.test.ts` |
| R51 | `apiKey` en grupo aparte; inactivas marcadas | TB3.1 | `tests/unit/components/ordenes-filtros-def.test.ts` |
| R52 | sin sesión → `unauthenticated`, sin datos | TB2.4 | `filtros-ordenes-service.test.ts` |
| R53 | rol ajeno → `forbidden`, sin datos | TB2.4 | idem |
| R54 | sin PII más allá del nombre | TB2.2 | `user-repository-tiendas.test.ts` |
| R55 | seis filtros declarados sobre el componente genérico | TB3.1 | `ordenes-filtros-def.test.ts` |
| R56 | la cadena geográfica se declara con `dependsOn` | TB3.1 | idem |
| R57 | acotamiento en cliente, sin round-trip por selección | TB4.1 | `tests/unit/components/ordenes-listado-filtros.test.tsx` |
| R58 | traducción del tiempo posicional a preset o desde/hasta | TB3.2 | `tests/unit/components/seleccion-a-filter.test.ts` |
| R59 | sin selección, no se añaden claves al `filter` | TB3.2/TB4.1 | idem + `ordenes-listado-filtros.test.tsx` |
| R60 | cambio de filtro → página 1 + selección limpia | TB4.2 | `tests/unit/components/ordenes-module-filter-key.test.tsx` |
| R61 | key estable: selecciones equivalentes comparten caché | TB4.2 | idem |
| R62 | rol acotado a su tienda no declara el filtro de tienda | TB3.1/TB4.1 | `ordenes-listado-filtros.test.tsx` |
| R63 | la barra ofrece "Limpiar todo" | TB4.1 | idem |
| R64 | catálogo no disponible → filtros deshabilitados, listado vivo | TB2.5/TB4.1 | test de la page + idem |
| R65 | ninguna otra superficie cambia | T6.1 / TA.2 | suite existente de `MultiSelectFilter`/`DataTable`/dashboard |

*(Los nombres de archivo son la propuesta del spec; el implementer los fija y actualiza esta
tabla en `progress/impl_144-filtros-ordenes.md`.)*

---

## Orden de ejecución

```
TA.1 ─┬─ TA.2 [P]
      └─ TA.3 [P]        →  TA.4  ─┬─ TA.5 [P]
                                   │
        ── gate A→B ───────────────┤
                                   ├─ TB1.1 → TB1.3 → TB1.4 → TB1.5
                                   │   └─ TB1.2 [P] con TB1.1
                                   ├─ TB2.1 [P] TB2.2 [P] TB2.3 [P] → TB2.4 → TB2.5
                                   ├─ TB5.1 [P]              (migración, independiente)
                                   └─ TB3.1 + TB3.2 [P] → TB4.1 → TB4.2
                                                     → T6.1 → T6.2 → T6.3 → T6.4
```

**Total: 22 tasks** (5 del bloque A, 13 del bloque B, 4 de cierre); **10** marcadas `[P]`.
Sin task de instalación de dependencias: **no hay dependencias nuevas**.
