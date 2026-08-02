# impl — Feature 170, FASE 2, Tanda H (base de paginación)

**Rama:** `feature/170-fase2-paginacion` · **Fecha:** 2026-08-01 · **Rol:** `backend_dev`
**Alcance:** T H.1, T H.2 y T H.3. **Nada de las tandas I/J/K/L.**

La tanda H no pagina ninguna pantalla: pone la base que las cuatro tandas siguientes copian
(configuración, contrato y la guardia del contador). Todo lo que sigue está MEDIDO, no
prometido; las tres mutaciones que se pedían se ejecutaron y se revirtieron.

---

## 0. Baseline medido AL EMPEZAR

```
$ git branch --show-current
feature/170-fase2-paginacion          (rama ya creada; no se hizo checkout de ninguna otra)
$ git status --short
(limpio)
$ npx tsc --noEmit
=== typecheck exit: 0 ===
```

FASE 1 leída en `progress/impl_170-export-todas-las-tablas.md` (1248 líneas). De ahí sale la
decisión más importante de esta tanda: **reusar el molde que la FASE 1 ya dejó** —
`lib/types/descarga-listado.ts` (T0.1) hizo exactamente esto con el modo «dataset completo»,
y `tests/unit/descarga/censo-tablas.ts` + `cobertura-tablas.guardia.test.ts` (T0.5) son el
idioma del repo para «registro declarado contrastado contra el árbol». Las tres entregas de
abajo son la aplicación de esos dos moldes a la paginación, no invenciones nuevas.

---

## 1. T H.1 — Configuración de tamaño de página por dominio (R40)

**Seis dominios, todos 25/100**, que son los valores que ya usan órdenes, usuarios, plantillas
y API keys. **Q2 queda instrumentada como se propuso**: uno por dominio, no un tamaño único
global; así las opciones 10/25/50 del control siguen siendo válidas en las 13 pantallas.

| Dominio | Archivo | Env | Listados del Anexo III que cubre |
| --- | --- | --- | --- |
| cierres del día | `lib/config/cierre.ts` (ampliado) | `CIERRE_*` | 4 |
| cierre de bodega | `lib/config/cierre-bodega.ts` (nuevo) | `CIERRE_BODEGA_*` | 3 |
| incidentes | `lib/config/incidentes.ts` (nuevo) | `INCIDENTES_*` | 2 |
| wallet-tienda | `lib/config/wallet-tienda.ts` (ampliado) | `WALLET_TIENDA_*` | 1 (saldos de tiendas) |
| gasto fijo | `lib/config/gasto-fijo.ts` (nuevo) | `GASTO_FIJO_*` | 1 |
| recepción satélite | `lib/config/recepcion-satelite.ts` (nuevo) | `RECEPCION_SATELITE_*` | 1 |

**12 de los 13.** El que falta es «Cuentas por pagar a mensajeros» → ver §5, pregunta abierta.

### Un efecto colateral que se resolvió con `Pick`, no con churn de tests

Ampliar `WalletTiendaConfig` rompía el typecheck de **4 dobles de test** que construyen
`{ TIENDA_DEBITA_FLETE_DEVOLUCION: true }` y lo pasan a `WalletTiendaFeedService`. En vez de
tocar esos cuatro tests, el servicio pasa a declarar
`Pick<WalletTiendaConfig, "TIENDA_DEBITA_FLETE_DEVOLUCION">`: el feed del ledger depende de UN
interruptor, no del módulo de config entero, y ahora está escrito. Cero cambios en tests
ajenos.

### La guardia del criterio «ningún literal de tamaño en `app/`»

El criterio de «Hecho» de T H.1 pide que el tamaño no se invente en la pantalla. Se instrumenta
sobre las **9 pantallas del Anexo III**: hoy está verde **por ausencia** (ninguna pagina aún) y
ese es su valor — se pone roja en cuanto una tanda escriba `pageSize: 20` en vez de leer la
config. Se verificó que DETECTA, apuntándola a un archivo que sí tiene el literal:

```
AssertionError: el tamano de pagina sale de lib/config/<dominio>.ts, no de un literal en la
pantalla: expected [ Array(1) ] to deeply equal []
+   "app/(app)/wallet/mensajeros/_components/DesglosePagosMensajero.tsx: DESGLOSE_PAGE_SIZE = 20"
```

Esa primera ejecución también **corrigió el detector**: el `\b` delante de `PAGE_SIZE` no veía
`DESGLOSE_PAGE_SIZE` (el `_` es carácter de palabra). Sin la mutación, la guardia habría
nacido ciega al único nombre que el repo usa de verdad.

**Deuda PREEXISTENTE declarada (no se tocó, está fuera del Anexo III):**
`DESGLOSE_PAGE_SIZE = 20` en `DesglosePagosMensajero.tsx` y `DesgloseMovimientosTienda.tsx`;
`PAGE_SIZE = 100` en `TiendasModule.tsx` y `ZonasTarifasModule.tsx`; `pageSize: 100` en
`UsuarioForm.tsx` y `configuracion/tarifas/page.tsx`; `pageSize: 10` de fallback en
`novedades/page.tsx`.

---

## 2. T H.2 — Contrato común de listado paginado (R41)

`lib/types/listado-paginado.ts` **EXTRAE** el contrato que ya existía escrito a mano cuatro
veces. Es el hermano de `lib/types/descarga-listado.ts`: juntos cubren las dos lecturas de un
mismo listado (`listar` → una página + el total; `listarCompleto` → el dataset sin recorte).

```
PaginaListado<T>                  { items, page, pageSize, total }
PaginaListadoOk<T>                { status: "ok" } & PaginaListado<T>
ListarPaginadoResult<T, E = ActionError>   borde
ListarPaginadoServiceResult<T>             servicio (| { status: "forbidden" })
```

**Reexpresados sobre él, sin cambiar su forma pública** (7): `ListarOrdenesResult`,
`ListarUsuariosResult`, `ListarPlantillasResult`, `ListarApiKeysResult`,
`ListarOrdenesServiceResult`, `ListarUsuariosServiceResult`, `ListarPlantillasServiceResult`.

### Por qué el union de error es un parámetro y no `ActionError` a secas

Porque **no todos los listados declaran los mismos errores** y ensanchárselos no es unificar,
es obligar a su pantalla a manejar ramas que ese listado no produce:

- `lib/types/usuario.ts` y `lib/types/plantilla-mensaje.ts` tienen **su propio** `ActionError`
  (su `conflict` lleva `campo`), distinto del de `lib/types/orden.ts`.
- `ListarApiKeysResult` usa `ApiKeyActionErrorResult`, deliberadamente más estrecho (sin
  `not_found` ni `conflict`).

Con el parámetro, los cuatro conservan su union exacto. **Hallazgo, no corregido:** la FASE 1
sí ensanchó el de usuarios/plantillas al reexpresar `ListarXCompletoResult` sobre
`ListarCompletoResult<T>` (que fija el `ActionError` de órdenes). No se toca aquí: es de la
fase anterior, está en verde y arreglarlo no es de esta tanda.

### Tres formas paginadas conviven en el repo, y solo una es el contrato

Medido con el propio test: **13** declaraciones `*Result` con paginación.

1. `{ status, items, page, pageSize, total }` — el contrato (órdenes, usuarios, plantillas, API
   keys, zonas, tarifas, postulaciones, novedades, rechazos SLA).
2. `{ movimientos, total, page, pageSize }` — los ledgers de dinero (features 41/43).
3. `{ status: "ok", data: Payload }` — anidada (wallet).

Las dos últimas **no** están en el Anexo III y **no** se reescriben (sería churn en dinero).
Lo que sí se les exige, y cumplen, es el invariante de R41: si hay página, hay total.

---

## 3. T H.3 — Guardia de contadores de cabecera (R42)

`tests/unit/descarga/contadores-cabecera.guardia.test.ts`.

**Pantalla paginada** = archivo de `app/` que monta `<Pagination>` **más los componentes de
tabla que importa** — 17 hoy = 13 + 4 hijos (`WalletLedger`, `GastosFijosPlantillasPanel`,
`DesgloseTiendaLedger`, `DesglosePagos`). Sin seguir el import, un contador en el hijo se
escaparía: en tres pantallas del repo el control vive en el módulo y el `<DataTable>` en otro
archivo.

**La guardia NO prohíbe `.length` a secas**, y eso es lo que la hace sostenible. Las dos vistas
AGRUPADAS del Anexo IV no se paginan a propósito y su contador por grupo seguirá siendo
correcto. Sin esa distinción, el test se pondría rojo **en la tanda I** en cuanto
`CierreDiaModule` —que tiene una tabla que se pagina («Cierres solicitados») y un grupo que no—
reciba su control. Un test que hay que desactivar en la tanda siguiente no es una guardia.

De ahí el registro de los **6** contadores del árbol (mismo idioma que `censo-tablas.ts`),
contrastado contra el código en los dos sentidos:

| Archivo | Contador | Estado | Por qué |
| --- | --- | --- | --- |
| `CierreDiaModule.tsx` | `({filas.length})` | `sin_paginar` | Anexo IV: vista agrupada, acotada por la jornada de UN mensajero |
| `cierre-detalle-shared.tsx` | `({filas.length})` | `sin_paginar` | Anexo IV: agrupada dentro de un modal de detalle |
| `CierresAdminModule.tsx` | `({pendientes.length})` | `pendiente` | tanda J |
| `CierresBodegaAdminModule.tsx` | `({pendientes.length})` | `pendiente` | tanda J |
| `ConsolidacionBodegaModule.tsx` | `({consolidables.length})` | `pendiente` | tanda J |
| `IncidentesAdminModule.tsx` | `({pendientes.length})` | `pendiente` | tanda J |

Coincide exactamente con la tabla de riesgo MEDIO de `design.md §11.3` (4) más las 2
exclusiones del Anexo IV.

---

## 4. Las mutaciones, con su salida real

Ninguna guardia se dio por buena sin verla roja. **Las seis están revertidas** (`git status`
limpio salvo lo entregado).

| # | Mutación | Resultado medido |
| --- | --- | --- |
| 1 | `PANTALLAS_ANEXO_III` apuntando a `DesglosePagosMensajero` (que tiene `DESGLOSE_PAGE_SIZE = 20`) | **ROJO**: `+ "…/DesglosePagosMensajero.tsx: DESGLOSE_PAGE_SIZE = 20"` — y descubrió que el detector no veía el prefijo |
| 2 | `UsuarioService.listar` devuelve `total: items.length` | **ROJO**: `Usuarios: el total es el del conjunto: expected +0 to be 57` |
| 3 | `ListarTarifasResult` pierde su `total` | **ROJO**: `+ "lib/types/tarifa.ts :: ListarTarifasResult"` |
| 4 | `ListarUsuariosResult` vuelve a escribirse a mano | **ROJO**: `debe expresarse sobre ListarPaginadoResult` |
| 5 | **La pedida:** `({(data?.items ?? []).length})` en `UsuariosModule` (pantalla que YA pagina) | **ROJO en 2 tests**: `+ "app/(app)/configuracion/_components/UsuariosModule.tsx :: ({(data?.items ?? []).length})"` |
| 6 | `<Pagination>` en `CierresAdminModule` (la tanda J de verdad) | **ROJO**: `+ "…/CierresAdminModule.tsx :: ({pendientes.length})"` |
| 7 | Entrada del registro renombrada (deja de existir en el código) | **ROJO**: `hay contadores sin registrar…` |

**La mutación 5 cambió el código entregado.** La primera versión del patrón exigía un
identificador simple (`({pendientes.length})`) y **pasó verde** ante
`({(data?.items ?? []).length})`, que es la misma mentira escrita distinto. El patrón se
ensanchó a «cualquier expresión seguida de `.length` dentro del contenedor JSX». Sin ejecutar
la mutación, la guardia habría entrado en `dev` con ese agujero.

---

## 5. Mapa `R<n> → archivo::test`

| R | Test |
| --- | --- |
| **R40** | `tests/unit/config/paginacion-dominios.test.ts::cada dominio nuevo declara default y máximo, y el default no supera el máximo` |
| **R40** | `tests/unit/config/paginacion-dominios.test.ts::los seis dominios cubren 12 de los 13 listados del Anexo III` |
| **R40** | `tests/unit/config/paginacion-dominios.test.ts::respeta overrides validos de entorno, dominio a dominio` |
| **R40** | `tests/unit/config/paginacion-dominios.test.ts::ignora env no positivo o no numerico y cae al default de 25/100` |
| **R40** | `tests/unit/config/paginacion-dominios.test.ts::ninguna pantalla del Anexo III declara un literal de tamano de pagina` |
| **R41** | `tests/unit/descarga/contrato-paginado.test.ts::todo listado paginado devuelve el total junto a la pagina` |
| **R41** | `tests/unit/descarga/contrato-paginado.test.ts::ningun resultado del repo declara la pagina sin declarar el total` |
| **R41** | `tests/unit/descarga/contrato-paginado.test.ts::los listados que ya paginaban se expresan sobre el contrato comun, no a mano` |
| **R42** | `tests/unit/descarga/contadores-cabecera.guardia.test.ts::ninguna pantalla con listado paginado deriva su contador de la longitud del array` |
| **R42** | `tests/unit/descarga/contadores-cabecera.guardia.test.ts::el registro de contadores no se despega del codigo` |
| **R42** | `tests/unit/descarga/contadores-cabecera.guardia.test.ts::las cuatro colas de la tanda J siguen contando el array, y por eso siguen pendientes` |

R43–R54 **no entran en esta tanda** (son I/J/K/L/M) y no se declaran cubiertos.

---

## 6. Archivos

**Nuevos (7)**

- `lib/config/cierre-bodega.ts` · `lib/config/incidentes.ts` · `lib/config/gasto-fijo.ts` ·
  `lib/config/recepcion-satelite.ts` — configuración de paginación (T H.1).
- `lib/types/listado-paginado.ts` — el contrato común (T H.2).
- `tests/unit/config/paginacion-dominios.test.ts` — 5 tests (T H.1).
- `tests/unit/descarga/contrato-paginado.test.ts` — 3 tests (T H.2).
- `tests/unit/descarga/contadores-cabecera.guardia.test.ts` — 3 tests (T H.3).

(7 archivos + 3 de test = 10; los cuatro `lib/config/*` nuevos van contados arriba.)

**Modificados (9)**

- `lib/config/cierre.ts` · `lib/config/wallet-tienda.ts` — + `DEFAULT_PAGE_SIZE`/`MAX_PAGE_SIZE`.
- `lib/services/WalletTiendaFeedService.ts` — depende de `Pick<…, "TIENDA_DEBITA_FLETE_DEVOLUCION">`.
- `lib/types/orden.ts` · `lib/types/usuario.ts` · `lib/types/plantilla-mensaje.ts` ·
  `lib/types/api-key.ts` — alias de borde sobre el contrato.
- `lib/interfaces/services/IOrdenService.ts` · `IUsuarioService.ts` ·
  `IPlantillaMensajeService.ts` — alias de servicio sobre el contrato.
- `specs/170-export-todas-las-tablas/tasks.md` — T H.1/H.2/H.3 marcadas, con lo medido.

**Cero UI, cero migraciones, cero RLS.** No se tocó `app/**`, `components/**` ni la base: la
tanda H no pagina ninguna pantalla. Las dos mutaciones que sí tocaron `app/` (5 y 6) están
revertidas y verificadas con `git status`.

**Ningún test existente se modificó.** El único riesgo de churn (los 4 dobles de
`WalletTiendaConfig`) se evitó con el `Pick`.

---

## 7. Puertas (medición final, salida real)

```
$ npx tsc --noEmit
=== typecheck exit: 0 ===

$ npx eslint
✖ 18 problems (0 errors, 18 warnings)
=== lint exit: 0 ===
(las 18 son `_args`/`_items` sin usar en tests ajenos, preexistentes)

$ npx vitest run
 Test Files  726 passed (726)
      Tests  8794 passed (8794)
   Duration  213.27s
```

Suite completa **en verde a la primera**, sin flakes de saturación en esta corrida (el
conocido `OrdenesModuleReuse` pasó).

---

## 8. Decisiones tomadas al implementar

1. **El contrato se EXTRAE, no se inventa.** El repo ya tenía la forma en 4 sitios; hacer un
   contrato nuevo habría creado un quinto. Molde: lo que la FASE 1 hizo con `descarga-listado`.
2. **El union de error va parametrizado.** Ver §2: unificar el éxito no puede ensanchar los
   errores de nadie.
3. **La guardia de R42 usa registro declarado, no prohibición ciega.** Ver §3: sin él, el test
   moriría en la tanda I por un falso positivo del Anexo IV.
4. **La guardia sigue los imports un nivel.** Bastó para las 3 pantallas del repo donde control
   y tabla no comparten archivo. **Hueco conocido:** un contador en un archivo que *importa* la
   pantalla paginada (p. ej. `OrdenesListado` importa `OrdenesModule`) no cuenta como pantalla
   paginada; lo tapa el segundo test, que exige que **todo** `({X.length})` del árbol esté
   registrado con su decisión.
5. **`Pick` en `WalletTiendaFeedService`** en vez de tocar 4 tests ajenos.
6. **El literal de tamaño en `app/` se acota al Anexo III.** Limpiar los preexistentes es
   trabajo de otras features (son de wallet, tarifas y novedades) y esta tanda es de backend.

---

## 9. Preguntas abiertas (NO se rellenaron con supuestos)

1. **«Cuentas por pagar a mensajeros» no tiene dominio de configuración.** Es el 13.º del
   Anexo III (tanda L) y el dominio `wallet-mensajero` no figura en la lista de seis de T H.1
   ni existe `lib/config/wallet-mensajero.ts`. Quien haga la tanda L debe decidir si nace ese
   módulo o si el listado se cuelga de otro. El test lo deja visible (`toHaveLength(12)`), no
   escondido.
2. **Q2 se instrumentó como se PROPUSO** (uno por dominio, 25/100), porque es lo que dice
   `tasks.md` T H.1 y lo que ya hace el repo. Si el humano quería un tamaño único global, la
   pregunta sigue sin respuesta escrita en `requirements.md`.
3. **Q5 (catálogos de filtro del satélite) no se toca aquí:** es K.2.
4. **`ListarOrdenesCompletoServiceResult` escrito a mano** — deuda D5.2 declarada por la FASE 1
   «para quien toque ese servicio, probablemente la FASE 2». Esta tanda no toca `OrdenService`
   (solo el alias de su interfaz), así que sigue abierta para la tanda I.
5. **Las dos formas paginadas no-contrato** (ledgers `movimientos` y payload anidado `data`) no
   se unifican. Cumplen R41; reescribirlas es churn en dinero sin requisito que lo pida.

---

## 10. Para el que siga (tandas I–L)

- El molde a copiar es **una línea**: `ListarPaginadoServiceResult<TuDTO>` en la interfaz y
  `ListarPaginadoResult<TuDTO, TuActionError>` en el borde.
- El tamaño de página sale de `<dominio>Config.DEFAULT_PAGE_SIZE`; escribir un literal en la
  pantalla pone roja la guardia de T H.1.
- Al cablear `<Pagination>` en una de las 4 colas de la tanda J, **la guardia de T H.3 se pone
  roja a propósito**: es el recordatorio de sustituir `({array.length})` por el `total` del
  servidor. Después hay que borrar esa entrada del registro (pasa a no existir en el código).
- `CierreDiaModule` es el caso delicado de la tanda I: pagina UNA de sus dos tablas. Su
  contador `({filas.length})` está declarado `sin_paginar` y **debe seguir estándolo**.
