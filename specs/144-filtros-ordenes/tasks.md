# Feature 144 — Filtros de órdenes (zona, tienda, geografía y tiempo) · tasks.md

> Checklist de pasos discretos y verificables. `[P]` = paralelizable con las tareas
> marcadas igual dentro del mismo bloque. Cada task lleva su criterio de **hecho**.
> Nada se implementa antes de la aprobación humana de la puerta F1.4 (`docs/specs.md`).
> Convención de commits: `feat(144): …` / `test(144): …` / `chore(144): …`, uno por task.
>
> **Orden obligatorio: el bloque A (componente genérico) se construye y se testea
> ANTES del bloque B (cableado en órdenes).** B consume A; si A se define "a medida"
> de B, el componente nace acoplado y la feature 145 empieza con deuda.
>
> **Regla dura de review para A:** ni `FilterComponent` ni sus tests pueden importar
> nada de `lib/types/orden`, `lib/actions/*` ni `app/(app)/ordenes/*`. Los tests de
> R1–R20 usan filtros de fantasía (`color` → `talla`).

---

## Bloque 0 — Puerta

- [ ] **T0.1 — Cerrar F1.4.** El humano responde (a)…(n) de
  `design.md > Preguntas abiertas`. **Hecho:** las respuestas quedan anotadas al
  inicio de `requirements.md > Preguntas abiertas` (patrón de la feature 63) y
  `feature_list.json` pasa a `spec_ready` → `in_progress`.
  *Bloquea todo lo demás.* Concretamente: (j)(k)(l)(m)(n) fijan el contrato de A;
  (a) fija el dominio de `created_range`; (b) la columna del filtro de zona; (c) la
  vía del precargado; (i) si A lleva "Limpiar todo".

---

## Bloque A1 — Motor de dependencias (puro, sin dominio)

- [ ] **TA.1 — Utilidades de dependencias.** `lib/utils/filter-dependencies.ts`:
  `opcionesVisibles`, `seleccionEfectiva`, `podarSeleccion` (§A.4 del diseño).
  Funciones puras, sin React, sin dominio, con guarda de ciclos.
  **Hecho:** tests unitarios con filtros de fantasía que cubren: sin `dependsOn` →
  todas las opciones; padre con selección → hijo acotado; padre SIN selección → hijo
  acotado a las opciones visibles del padre; cadena de 3 niveles; `dependsOn` a clave
  inexistente → independiente; ciclo → no cuelga (R15, R16, R17, R19, y la parte de
  poda de R18).
  *Depende de T0.1 (m).*

## Bloque A2 — Componente

- [ ] **TA.2 — `FilterComponent`.** Componente en la ubicación que fije T0.1(n).
  Monta `MultiSelectFilter` para `kind: "multi"` y `Select` (shadcn) para
  `kind: "single"`; estado agregado interno; aplica TA.1 antes de emitir.
  **Hecho:** tests de componente (Testing Library) con filtros de fantasía:
  monta N filtros en el orden declarado; emite la selección agregada al seleccionar;
  NO emite al teclear en el buscador; `single` sustituye el valor anterior; tipo
  desconocido se ignora sin romper el resto; filtro sin opciones → deshabilitado;
  `disabled` global; claves sin selección ausentes de la salida; el hijo huérfano ya
  no aparece en lo emitido tras cambiar el padre; nombre accesible por filtro
  (R1–R14, R18, R20).
  *Depende de TA.1.*

- [ ] **TA.3 `[P]` — Documentar el contrato.** Bloque de comentario de cabecera en
  `FilterComponent` con el contrato de props, la semántica de `dependsOn` /
  `parentValue`, y la frase "la traducción al transporte es del consumidor".
  **Hecho:** el archivo compila y el reviewer puede leer el contrato sin abrir el spec.
  *Depende de TA.2.* `[P]` con el bloque B1.

> **Gate A→B:** ningún archivo del bloque B se toca hasta que TA.1 y TA.2 estén en
> verde. Con A cerrado, los bloques B1, B2 y B5 pueden avanzar en paralelo.

---

## Bloque B1 — Backend: contrato y consulta

- [ ] **TB1.1 — Ampliar el schema del filtro.** En `lib/types/orden.ts`:
  `ORDEN_FILTER_FIELDS` a 7 claves y `ordenFilterSchema` con `zona_id`, `tienda_id`,
  `provincia_id`, `canton_id`, `distrito_id` como `idList` (`.nonempty()`) y el
  filtro de tiempo como valor único (`z.enum` según T0.1(a)). Mantener `.strict()` y
  la unión escalar|lista de `status_id`.
  **Hecho:** `pnpm typecheck` verde; test unitario del schema pasa (R21, R22, R23,
  R29, R31).
  *Depende de T0.1.*

- [ ] **TB1.2 `[P]` — Helper de borde horario CR.** Añadir `inicioDelDiaCREnUtc()` (y
  el cálculo del preset) a `lib/utils/fecha-cr.ts`, con el ajuste de +6 h documentado.
  **Hecho:** tests de borde `2026-07-15T05:59:59Z` vs `2026-07-15T06:00:00Z` (R30).
  *Depende de T0.1(a).*

- [ ] **TB1.3 — Traducción en el service.** `OrdenService.listar`: `FILTER_TO_COLUMN`
  ampliado, `where` tipado a `string | string[]` donde toca, rango de tiempo a
  `createdAtDesde`, y **scoping por rol escrito al final** (pisa el filtro).
  **Hecho:** tests unitarios de service con repo mockeado que verifican el `where`
  construido (R24, R25, R27, R28, R34).
  *Depende de TB1.1, TB1.2.*

- [ ] **TB1.4 — `where` en el repositorio.** `OrdenRepository.list` +
  `ListOrdenesParams` (`lib/interfaces/repositories/IOrdenRepository.ts`): cada lista
  → `{ in: [...] }`, `createdAt: { gte }`, `deletedAt: null` intacto, `count` con el
  MISMO `where`.
  **Hecho:** test de repositorio (Prisma mockeado) que verifica el objeto `where` y la
  identidad `findMany.where === count.where` (R26, R32).
  *Depende de TB1.3.*

- [ ] **TB1.5 — Test de no regresión del contrato.** Sin `filter`, o con solo
  `status_id`, el input recibido por el service/repositorio es **idéntico** al previo
  a la feature (mismo criterio que usó la 63).
  **Hecho:** test verde comparando el `where` con el snapshot previo (R33).
  *Depende de TB1.4.*

---

## Bloque B2 — Backend: catálogo de opciones

- [ ] **TB2.1 `[P]` — Proyección plana de geografía.** `GeoRepository.listCatalogoPlano()`
  (+ `IGeoRepository`): provincias `{id,nombre}`, cantones `{id,nombre,padreId}`,
  distritos `{id,nombre,padreId}`, ordenados por nombre.
  **Hecho:** test unitario de repositorio con Prisma mockeado (R36, R37).

- [ ] **TB2.2 `[P]` — Cuentas tienda.** `UserRepository.listCuentasTienda()`:
  `rol.value IN ('adminTienda','apiKey')`, proyección `{id,nombre}` (sin PII), estado
  según T0.1(e).
  **Hecho:** test que verifica los dos roles incluidos, la ausencia de
  email/teléfono y el orden (R38, R41).

- [ ] **TB2.3 `[P]` — Zonas ligeras.** Método de proyección `{id,nombre}` en
  `ZonaRepository`, sin tarifas ni paginación.
  **Hecho:** test unitario verde (R36, R37).

- [ ] **TB2.4 — Service del catálogo.** `lib/services/FiltrosOrdenesService.ts` con DI
  por constructor: compone TB2.1–TB2.3 y autoriza `maestro`/`admin`/`adminTienda` →
  `ok`, resto → `forbidden`.
  **Hecho:** tests de autorización por rol, sin DB (R35, R39, R40).
  *Depende de TB2.1, TB2.2, TB2.3.*

- [ ] **TB2.5 — Server Action.** `lib/actions/ordenes-filtros.ts` →
  `listarCatalogoFiltrosOrdenes()` con `withErrorHandler` + `resolveActorFromSession`,
  patrón de `lib/actions/ordenes.ts` (deps inyectables para test).
  **Hecho:** test de integración: sin sesión → `unauthenticated`; rol `mensajero` →
  `forbidden`; `admin` → `ok` con las cinco colecciones (R35, R39, R40).
  *Depende de TB2.4.* Si T0.1(c) elige la prop desde el Server Component, esta task se
  convierte en "resolver el catálogo en `page.tsx` y pasarlo por props", con el mismo
  service y los mismos tests de autorización.

---

## Bloque B3 — Declaración y traducción (lo específico de órdenes)

- [ ] **TB3.1 — `construirFiltrosOrdenes`.** Función pura en
  `app/(app)/ordenes/_components/ordenes-filtros-def.ts`: catálogo + `incluirTienda`
  → `FilterDef[]`, con `dependsOn: "provincia_id"` en cantón y
  `dependsOn: "canton_id"` en distrito, y `parentValue` en cada opción.
  **Hecho:** test que verifica las 6 (o 5) declaraciones, sus `key`, sus `dependsOn` y
  que cada opción de cantón/distrito lleva su padre (R42, R43, R49).
  *Depende de TA.2 (contrato de `FilterDef`) y TB2.5 (forma del catálogo).*

- [ ] **TB3.2 `[P]` — `seleccionAFilter`.** Función pura en
  `app/(app)/ordenes/_components/seleccion-a-filter.ts`: `FilterSelection` →
  `Partial<OrdenFilterInput>` (listas tal cual; el filtro único a escalar; claves
  vacías fuera).
  **Hecho:** tests: selección vacía → `{}`; multi → lista; single → escalar (R45, R46).
  *Depende de TA.2.*

---

## Bloque B4 — Cableado del listado

- [ ] **TB4.1 — `OrdenesListado`.** SWR del catálogo con key fija, `FilterComponent`
  montado con `construirFiltrosOrdenes`, fusión de `status_id` + `seleccionAFilter` en
  un único `filter`, `incluirTienda` por rol, `disabled` si el catálogo no cargó.
  **Hecho:** tests: sin selección, `OrdenesModule` recibe `filter` sin las claves
  nuevas; con selección, las recibe como ids; `adminTienda` no monta el filtro de
  tienda; catálogo caído → filtros deshabilitados y tabla viva; la cadena geográfica
  acota de punta a punta sin llamadas extra al servidor
  (R34, R44, R45, R46, R49, R50).
  *Depende de TB3.1, TB3.2, TB2.5.*

- [ ] **TB4.2 — Key de SWR y reset.** En `OrdenesModule`, `statusKey`/`statusKeyPrevio`
  → `filterKey`/`filterKeyPrevio` con `serializarFiltro` (claves y valores ordenados);
  reset a página 1 + limpieza de selección ante cualquier cambio de filtro; `mutate`
  por prefijo `"ordenes:list"` intacto.
  **Hecho:** tests: dos selecciones equivalentes → misma key (sin refetch); cambiar un
  filtro vuelve a página 1 y vacía la selección; sin `filter`, la llamada a
  `listarOrdenes` es la previa (R47, R48, R33).
  *Depende de TB4.1.*

---

## Bloque B5 — Datos

- [ ] **TB5.1 `[P]` — Migración de índices.** `db/migrations/<ts>_orden_indices_filtros/`
  con `migration.sql` (4 `CREATE INDEX`) y `down.sql` (4 `DROP INDEX IF EXISTS`), más
  los `@@index` correspondientes en `db/schema.prisma`.
  **Hecho:** `pnpm db:migrate` aplica y `pnpm db:rollback` revierte sin residuos; test
  de integración de migración/rollback (patrón `tests/integration/db/*-migracion.test.ts`)
  verde. Sin tablas nuevas ⇒ sin RLS nueva.
  *Independiente del resto; puede correr desde el inicio del bloque B.*

---

## Bloque 6 — Cierre

- [ ] **T6.1 — No regresión de otras superficies.** El dashboard del `adminTienda`, el
  listado plano de `OrdenesModule` sin props y el resto de tablas se comportan igual;
  `MultiSelectFilter` no se modificó.
  **Hecho:** suite existente verde sin modificar sus asserts (R51).
  *Depende de B4.*

- [ ] **T6.2 — Aislamiento del bloque A.** Verificar que `FilterComponent`,
  `filter-dependencies.ts` y sus tests no importan dominio.
  **Hecho:** revisión de imports (o regla de lint/grep documentada en el impl) sin
  hallazgos; ningún test de R1–R20 menciona órdenes/zona/provincia/distrito.

- [ ] **T6.3 — Verificación ejecutable.** `./init.sh`, `pnpm typecheck`, `pnpm lint`,
  `pnpm test` en verde, medidos en este worktree limpio.
  **Hecho:** salida pegada en `progress/impl_144-filtros-ordenes.md` con el delta
  contra el baseline medido AL EMPEZAR (no citado de memoria).

- [ ] **T6.4 — Mapa R→test.** Rellenar la tabla de abajo con archivo y nombre exactos.
  **Hecho:** los 51 requisitos tienen test; el reviewer lo verifica.

---

## Trazabilidad R → test (a completar por el implementer)

### Bloque A — sin dominio (tests con filtros de fantasía)

| R | Qué prueba | Task | Test (archivo::nombre) |
| --- | --- | --- | --- |
| R1 | monta N filtros declarados por props | TA.2 | `tests/unit/components/filter-component.test.tsx` |
| R2 | cada filtro define clave, etiqueta, tipo y opciones | TA.2 | idem |
| R3 | orden de render = orden de declaración | TA.2 | idem |
| R4 | no hace fetch: todo llega por props | TA.2 | idem (sin mocks de red) |
| R5 | emite los valores declarados sin transformarlos | TA.2 | idem |
| R6 | tipo múltiple con buscador interno | TA.2 | idem |
| R7 | tipo único sustituye el valor anterior | TA.2 | idem |
| R8 | tipo desconocido se ignora sin romper el resto | TA.2 | idem |
| R9 | filtro sin opciones → deshabilitado | TA.2 | idem |
| R10 | `disabled` global | TA.2 | idem |
| R11 | emite la selección agregada al seleccionar | TA.2 | idem |
| R12 | NO emite al teclear en el buscador | TA.2 | idem |
| R13 | claves sin selección ausentes de la salida | TA.2 | idem |
| R14 | salida agnóstica (no construye consulta de nadie) | TA.2 | idem |
| R15 | `dependsOn` por clave, sin conocer el dominio | TA.1 | `tests/unit/utils/filter-dependencies.test.ts` |
| R16 | acotamiento por selección efectiva del padre | TA.1 | idem |
| R17 | transitividad en cadena de 3 niveles | TA.1 | idem |
| R18 | poda transitiva reflejada en lo emitido | TA.1 + TA.2 | idem + test de componente |
| R19 | `dependsOn` a clave inexistente → independiente | TA.1 | idem |
| R20 | nombre accesible y estado por opción | TA.2 | `tests/unit/components/filter-component.test.tsx` |

### Bloque B — órdenes

| R | Qué prueba | Task | Test (archivo::nombre) |
| --- | --- | --- | --- |
| R21 | el filtro acepta las 6 claves nuevas | TB1.1 | `tests/unit/types/orden-filter-schema.test.ts` |
| R22 | clave fuera de whitelist → `validation_error` sin consulta | TB1.1 | idem |
| R23 | lista vacía / id vacío → `validation_error` | TB1.1 | idem |
| R24 | AND entre filtros distintos | TB1.3 | `tests/unit/services/orden-service-filtros.test.ts` |
| R25 | OR (`IN`) dentro del mismo filtro | TB1.3 | idem |
| R26 | id inexistente → cero filas, nunca "sin filtro" | TB1.4 | `tests/unit/repositories/orden-repository-filtros.test.ts` |
| R27 | `adminTienda`: el filtro de tienda no amplía su alcance | TB1.3 | `tests/unit/services/orden-service-filtros.test.ts` |
| R28 | `mensajero`: sigue acotado a sus asignadas | TB1.3 | idem |
| R29 | tiempo es valor único; lista/valor inválido → `validation_error` | TB1.1 | `tests/unit/types/orden-filter-schema.test.ts` |
| R30 | bordes del día en CR (UTC−6) sobre `created_at` UTC | TB1.2 | `tests/unit/utils/fecha-cr-filtros.test.ts` |
| R31 | validación en el borde antes del `where` | TB1.1 | `tests/unit/types/orden-filter-schema.test.ts` |
| R32 | `count` con el mismo `where` que `findMany` | TB1.4 | `tests/unit/repositories/orden-repository-filtros.test.ts` |
| R33 | sin filtros nuevos, input idéntico al previo | TB1.5 / TB4.2 | `tests/unit/services/orden-service-filtros.test.ts` |
| R34 | combina con `status_id` sin anularse | TB1.3 / TB4.1 | idem + test de `OrdenesListado` |
| R35 | catálogo en una sola entrega | TB2.4 | `tests/unit/services/filtros-ordenes-service.test.ts` |
| R36 | cada opción con id, nombre y padre donde aplica | TB2.1 | `tests/unit/repositories/geo-repository.test.ts` |
| R37 | orden determinista | TB2.1/2.2/2.3 | tests de repositorio |
| R38 | tiendas incluyen cuentas `apiKey` | TB2.2 | `tests/unit/repositories/user-repository-tiendas.test.ts` |
| R39 | sin sesión → `unauthenticated`, sin datos | TB2.5 | `tests/integration/actions/ordenes-filtros-action.test.ts` |
| R40 | rol ajeno → `forbidden`, sin datos | TB2.4/TB2.5 | idem |
| R41 | sin PII más allá del nombre | TB2.2 | `tests/unit/repositories/user-repository-tiendas.test.ts` |
| R42 | la barra se declara sobre el componente genérico | TB3.1 | `tests/unit/components/ordenes-filtros-def.test.ts` |
| R43 | la cadena geográfica se declara con `dependsOn` | TB3.1 | idem |
| R44 | acotamiento en cliente, sin round-trip por selección | TB4.1 | `tests/unit/components/ordenes-listado-filtros.test.tsx` |
| R45 | la traducción a `filter` es del consumidor | TB3.2 | `tests/unit/components/seleccion-a-filter.test.ts` |
| R46 | sin selección, no se añaden claves al `filter` | TB3.2/TB4.1 | idem + test de `OrdenesListado` |
| R47 | cambio de filtro → página 1 + selección limpia | TB4.2 | `tests/unit/components/ordenes-module-filter-key.test.tsx` |
| R48 | key estable: selecciones equivalentes comparten caché | TB4.2 | idem |
| R49 | rol acotado a su tienda no declara el filtro de tienda | TB3.1/TB4.1 | `tests/unit/components/ordenes-listado-filtros.test.tsx` |
| R50 | catálogo caído → filtros deshabilitados, listado vivo | TB4.1 | idem |
| R51 | ninguna otra superficie cambia | T6.1 | suite existente de `DataTable`/dashboard |

*(Los nombres de archivo son la propuesta del spec; el implementer los fija y
actualiza esta tabla en `progress/impl_144-filtros-ordenes.md`.)*

---

## Orden de ejecución

```
T0.1
 └─ TA.1 → TA.2 ─┬─ TA.3 [P]
                 │
                 ├─ TB1.1 → TB1.3 → TB1.4 → TB1.5      (backend consulta)
                 │   └─ TB1.2 [P] con TB1.1
                 ├─ TB2.1 [P] TB2.2 [P] TB2.3 [P] → TB2.4 → TB2.5
                 ├─ TB5.1 [P]                           (migración, independiente)
                 └─ TB3.1 + TB3.2 [P] → TB4.1 → TB4.2
                                                → T6.1 → T6.2 → T6.3 → T6.4
```

**Total: 20 tasks** (1 de puerta, 3 del bloque A, 12 del bloque B, 4 de cierre);
8 marcadas `[P]`.
