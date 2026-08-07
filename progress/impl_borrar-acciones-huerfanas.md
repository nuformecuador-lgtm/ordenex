# Borrar las siete acciones huérfanas — cierre de la deuda `@sin-superficie`

**Rama:** `chore/borrar-acciones-huerfanas` (desde `origin/dev` @ `02f46b15`)
**Fecha:** 2026-08-07 · **Decisión:** humana, tomada hoy: borrar las siete en bloque.
**Precedente:** `progress/impl_borrar-codigo-muerto.md` (PRs #312 y #313, cuatro tandas). Este
chore aplica su método y sus reglas; no las redescubre. Lo que sí añade está en §7.

**Commits (uno por frente):**

| # | Hash | Frente |
|---|------|--------|
| 1 | `cb12aa0e` | `chore(actions): borra el CRUD de andamiaje de ordenes, que nacio sin pantalla` |
| 2 | `f0c13fbb` | `chore(actions): borra obtenerPlantilla, lectura de un detalle que nunca se construyo` |
| 3 | `9d77786e` | `chore(actions): borra obtenerVehiculo, que nunca tuvo pantalla de vehiculos` |
| 4 | `bb2df921` | `chore(actions): borra listarCatalogoEstatus, segunda victima del commit 54757be4` |

---

## 1 · Línea base, medida antes de tocar nada

| Medida | Antes |
|---|---|
| Anotaciones `@sin-superficie` en `app/`+`components/`+`lib/`+`hooks/`+`providers/` | **12** |
| `pnpm run typecheck` | **limpio** |
| `pnpm test:guardias` (`vitest run guard`) | **72 archivos / 996 tests, verde** |

> Nota para quien compare con la bitácora anterior: allí la cifra de guardias era **70/958**.
> El repo ha crecido desde entonces (PRs #307/#311/#313). **72/996 es la línea base de HOY**,
> medida en este árbol, no heredada. La disciplina es medir, no arrastrar el número.

---

## 2 · Verificación de las premisas, una a una — ANTES de borrar

El encargo pedía verificar cada premisa y **parar** si alguna de las siete tenía un consumidor
vivo. **Ninguna lo tenía.** Las siete se confirmaron con el mismo método: importadores reales
del módulo (no `grep` del nombre suelto, que cuenta homónimos y prosa).

| # | Símbolo | Consumidores de producción | Único consumidor vivo |
|---|---|---|---|
| 1 | `ordenes.ts#crearOrden` | **0** | su propio test |
| 2 | `ordenes.ts#obtenerOrden` | **0** | su propio test |
| 3 | `ordenes.ts#actualizarOrden` | **0** | su propio test |
| 4 | `ordenes.ts#borrarOrden` | **0** | su propio test |
| 5 | `plantillas.ts#obtenerPlantilla` | **0** | su propio test |
| 6 | `vehiculos.ts#obtenerVehiculo` | **0** | su propio test |
| 7 | `ordenes-guia.ts#listarCatalogoEstatus` | **0** | su propio test |

La consulta que lo decide, para que se pueda repetir:

```
grep -rn 'from "@/lib/actions/ordenes"' --include=*.ts --include=*.tsx \
  app components lib hooks providers tests e2e scripts
```

De los **14** importadores de `@/lib/actions/ordenes`, **13 importan solo `listarOrdenes` o
`listarOrdenesCompleto`** (el único de producción es `ordenes/_components/OrdenesModule.tsx`)
y el catorceavo es `tests/integration/actions/ordenes-action.test.ts`. Confirmadas también las
tres afirmaciones del encargo sobre por qué no es capacidad perdida: `app/api/ordenes/api-key/**`
instancia `BulkOrdenService`/`ApiOrdenLecturaService` **directamente** (no pasa por estas
acciones), el detalle se sirve por props desde la página, y las ediciones van por las acciones
de dominio.

### La trampa de los homónimos: apareció, y era real

`grep "crearOrden"` devuelve **también** `tests/integration/db/_semilla-rollup.ts:171`, que
**exporta un helper de siembra llamado igual** y lo usan `analytics-daily-job.test.ts`,
`analytics-daily-backfill.test.ts` y `analitica-operativa-equivalencia.test.ts`. No tiene
ninguna relación con la Server Action. Es el mismo modo de fallo que `geo.ts` vs `geografia.ts`
del PR #312, esta vez **dentro de `tests/`**. Se dejó escrito el aviso en la lápida de
`lib/actions/ordenes.ts` para que el próximo `grep` no vuelva a tropezar.

El otro par comprobado: `buildOrdenRepoParaCatalogo` existe **en dos archivos**
(`ordenes-guia.ts` y `order-status.ts`). Son funciones locales homónimas e independientes. Se
borró la de `ordenes-guia.ts`; **la de `order-status.ts` está viva** y se quedó.

---

## 3 · `git log -S`: seis nacieron muertas, una la mató un borrado

La consulta es `git log -S "<símbolo>" -- app components`, que responde «¿existió alguna vez una
pantalla que nombrara esto?».

| Símbolo | Veredicto | Nace en | Muere en |
|---|---|---|---|
| `crearOrden` | **nació muerta** | `07c63d8b` (2026-07-09, «feat(order crud)») | — |
| `obtenerOrden` | **nació muerta** | `07c63d8b` | — |
| `actualizarOrden` | **nació muerta** | `07c63d8b` | — |
| `borrarOrden` | **nació muerta** | `07c63d8b` | — |
| `obtenerPlantilla` | **nació muerta** | `1de7605c` (2026-07-22, feature 107) | — |
| `obtenerVehiculo` | **nació muerta** | `fc64e88d` (2026-07-10, feature 50) | — |
| `listarCatalogoEstatus` | **LO MATÓ UN BORRADO** | `7615cfe2` (2026-07-11, feature 17) | **`54757be4`** (2026-07-31) |

Para las **seis** primeras la lista de `-S` sobre `app components` sale **VACÍA**: ni un solo
commit, en toda su vida, en `app/` ni en `components/`. No hay ambigüedad — no es que se
perdiera el consumidor, es que nunca se escribió. Ninguna capacidad de usuario se retira hoy con
ellas, porque ningún usuario pudo llegar nunca a ellas.

`ordenes.ts` es el caso extremo: **cuatro acciones que llevaban 29 días** sosteniendo un service,
seis tipos y 20 tests en verde sin que existiera un camino para invocarlas.

### 3.1 · El rastro de `54757be4`, explícito

Es el único caso de «muerte de segundo orden» de este chore, y es el que el encargo pidió dejar
escrito. `git log --oneline -S "listarCatalogoEstatus" -- app components` da **dos** commits:

```
54757be4 2026-07-31 chore(ordenes): borrar la vista legacy del listado, que nadie montaba
7615cfe2 2026-07-11 feat(17-revision-maestro-generar-guia): generar guia + asignacion mensajero...
```

El segundo la crea; **el primero la mata**. Y el `git show` lo confirma en el sitio exacto:

```
54757be4  app/(app)/ordenes/_components/OrdenesRevisionMaestro.tsx -> /dev/null
  -416:  listarCatalogoEstatus,            <- el import
  -452:  const res = await listarCatalogoEstatus();   <- la única llamada que tuvo
```

`OrdenesRevisionMaestro.tsx` era su **único** consumidor y `54757be4` lo borró entero.

**Lo que hace que este caso merezca quedar escrito:** es el mismo commit que dejó a
`rutearABodegaSatelite` sin botón y provocó el incidente de producción. Y su propio mensaje
demuestra que el autor *sí* buscó los daños colaterales — declara «CONSERVADO a propósito:
`RutearSateliteModal`. […] tras este borrado la acción se queda sin UI» — pero **encontró uno
de los dos**. De `listarCatalogoEstatus` no dice una palabra. No fue descuido de no mirar: fue
una búsqueda que se quedó corta. Aquel borrado dejó **dos** cosas colgando, se reparó una, y la
otra ha estado siete días más en el árbol. **Hoy se cierra.**

Que exista sustituta viva es lo que hace seguro el borrado, y aquí la sustituta es **mejor** que
la muerta: `listarOrderStatus` (`lib/actions/order-status.ts`), montada desde
`ordenes/_components/OrdenesListado.tsx:164`, autoriza a **todos menos mensajero** frente al
`maestro`/`admin` de la borrada.

---

## 4 · Qué se borró exactamente — la unidad es el símbolo, no el fichero

**Los cuatro archivos siguen existiendo y los cuatro conservan código vivo.** Ninguno se borró
entero, y en `ordenes.ts` la mitad del archivo estaba viva.

### Frente 1 (`cb12aa0e`) — `lib/actions/ordenes.ts`

| Se va | Se queda (VIVO) |
|---|---|
| `crearOrden`, `obtenerOrden`, `actualizarOrden`, `borrarOrden` | **`listarOrdenes`**, **`listarOrdenesCompleto`** (los usa `OrdenesModule.tsx`) |
| `idSchema` + el import de `zod` (solo lo usaban las 3 con id) | `buildOrdenService`, `OrdenActionDeps` |
| 6 imports de tipo/schema y `ValidationError`/`MSG` | `withErrorHandler`, `isAppErrorShape`, `UnauthenticatedError`, `toActionError` |

### Frente 2 (`f0c13fbb`) — `lib/actions/plantillas.ts`

Solo `obtenerPlantilla` y su tipo importado `ObtenerPlantillaResult`. **`idSchema` NO se toca:
lo comparten las otras tres acciones con id, que están vivas** (`actualizarPlantilla`,
`cambiarEstadoPlantilla`, `eliminarPlantilla`). Es exactamente el caso que obliga a medir por
símbolo: borrar el `idSchema` «que usaba la acción muerta» habría roto tres acciones vivas.

### Frente 3 (`9d77786e`) — `lib/actions/vehiculos.ts`

`obtenerVehiculo` y lo que solo ella usaba: el tipo `ObtenerVehiculoResult`, `idSchema` y los
imports de `zod` y `ObtenerVehiculoServiceResult`. **`listarVehiculos` sigue viva** y la consume
`configuracion/tarifas/page.tsx`.

### Frente 4 (`bb2df921`) — `lib/actions/ordenes-guia.ts`

`listarCatalogoEstatus`, `ListarCatalogoEstatusDeps`, `buildOrdenRepoParaCatalogo` (el de **este**
archivo) y el import del tipo. **Las otras siete acciones del módulo siguen vivas y montadas**
(`generarGuia`, `asignarDesdeBodega`, `asignarRecoleccion`, `desasignarRecoleccion`,
`rutearABodegaSatelite`, `listarMensajerosParaAsignacion`, `listarZonasBloqueadasPorCierre`).

---

## 5 · Los tests: qué se fue, qué se REAPUNTÓ y por qué

La regla del PR #312 aplicada: **aserción-sobre-lo-muerto ≠ montaje-para-lo-vivo**. Borrar todo
test que *nombre* el símbolo habría dejado propiedades vivas sin ningún testigo.

**Cuatro afirmaciones se reapuntaron en vez de borrarse:**

| Aserción | Antes | Ahora | Por qué NO es de la acción muerta |
|---|---|---|---|
| R19-R24: `forbidden` se propaga tal cual | `crearOrden` | **`listarOrdenes`** | prueba el borde (`isAppErrorShape(r) ? toActionError(r) : r`), idéntico en las acciones vivas |
| R11: error de dominio por nombre → `conflict` | `crearOrden` | **`listarOrdenes`** | prueba la cadena `withErrorHandler`→`normalize`→`toActionError`. **Único test end-to-end de esa cadena desde una Server Action**: `normalize.test.ts` y `with-error-handler.test.ts` prueban las piezas por separado, no el borde entero |
| INTERNAL: throw inesperado se re-lanza | `crearOrden` | **`listarOrdenes`** | ídem |
| «id vacío → `validation_error` con solo la clave `id`» | `obtenerPlantilla` | **`actualizarPlantilla`** | prueba el guard `idSchema` **compartido** por las cuatro acciones con id del módulo, no `obtener` |

Las tres primeras se reapuntaron a `listarOrdenes` y la cuarta a `actualizarPlantilla`, ambos
**código vivo y central** — corolario de la §15 de la bitácora anterior: un ancla viva no vuelve
a caer en la próxima limpieza. A la cuarta se le añadió además `expect(service.actualizar).not
.toHaveBeenCalled()`, que la versión original no tenía.

**Qué SÍ se fue con la acción, y con qué justificación:**

- **R9 «conserva la clave `id` en fieldErrors» (3 casos de `ordenes.ts`)** — era el requisito
  **DE** esas tres acciones (`specs/notificaciones-fix/requirements.md` R9 las nombra una a una).
  La *propiedad* no queda desnuda: conserva testigos vivos en `tarifas-action.test.ts`,
  `usuarios.test.ts`, `api-keys.test.ts` y ahora `plantillas-actions.test.ts`.
- **R25/R27/R28/R29/R35-R41, R14b/R42** — afirmaciones sobre crear/obtener/actualizar/borrar.
- **`obtenerVehiculo` «id vacío → not_found»** — el `idSchema` que lo producía era **código
  exclusivo de la acción borrada** y en ese módulo no queda ninguna acción viva con id a la que
  reapuntarlo. R10 y R9/R11 conservan su testigo en los dos casos de `listarVehiculos`.
- **Los 4 casos de `listarCatalogoEstatus`** — **no se reapuntan porque no hace falta**:
  `tests/unit/actions/order-status.test.ts` ya prueba sobre la sustituta viva las mismas tres
  propiedades **y más** (catálogo `{id,value}`, los **cuatro** roles autorizados vía `it.each`,
  sin sesión, mensajero → `forbidden` y **rol desconocido → `forbidden`**, que la borrada no
  cubría). Se comprobó leyendo el archivo, no suponiendo.

---

## 6 · Comentarios que pasaban a mentir: cuatro, corregidos

Como en el PR #312, borrar dejó prosa falsa. Se corrigió y se declara:

| Archivo | Decía | Problema |
|---|---|---|
| `lib/actions/order-status.ts:32` | «independiente de `listarCatalogoEstatus()` […] NO relaja la autorización **de esa (que sigue en maestro/admin)**» | afirmaba en presente sobre una acción que dejaba de existir. Reescrito en pasado, con el hash del borrado y la constatación de que ahora es la única lectura del catálogo |
| `tests/integration/actions/ordenes-action.test.ts` | «Fixture de geografía (R14b) […] se ejercita vía el caso *geografía inexistente → validation_error*» | citaba un caso de test que se borraba. Sustituido por la explicación real de por qué el doble sigue implementando la interfaz entera |
| `tests/integration/actions/vehiculos-action.test.ts` | (sin nota) el doble declara `obtener` sin que nada lo ejercite | añadida la razón, para que nadie lo tome por resto muerto |
| `tests/unit/plantillas/plantillas-actions.test.ts` | el caso reapuntado | añadida la nota de por qué prueba el guard compartido y no `obtener` |

Además se dejaron **cuatro lápidas** (`ordenes.ts`, `plantillas.ts`, `vehiculos.ts`,
`ordenes-guia.ts`) con el hash de nacimiento, el veredicto `nació muerta` / `lo mató un borrado`
y qué queda vivo — para que el próximo `grep` no confunda prosa con uso.

### Un detalle que casi contamina la medición

La primera versión de la lápida de `ordenes.ts` contenía el literal `@sin-superficie` dentro del
texto («chore `@sin-superficie`»). La **guardia no lo cuenta** (su regex solo mira el bloque de
comentario pegado a un `export`, y esto es un `//` suelto seguido de línea en blanco), así que
`test:guardias` seguía verde — pero **`grep -c "@sin-superficie"` sí lo contaba**, y ése es el
instrumento con el que se mide este chore. Habría reportado 6 en vez de 5. Se reescribió a
«chore de deuda de superficie». **Lección: la lápida de un borrado de anotaciones no debe
contener el token que se está contando.**

---

## 7 · Guardias: antes / después

| Medida | Antes | Después |
|---|---|---|
| Anotaciones `@sin-superficie` | **12** | **5** |
| `pnpm test:guardias` | **72 archivos / 996 tests ✅** | **72 / 996 ✅** |
| Contadores de censo (`cobertura-tablas`, `contadores-cabecera`) | — | **ninguno se movió** |

**12 → 5, exactamente lo previsto.** Las 7 que desaparecen son las 7 acciones borradas, ni una
más. **Ninguna huérfana**: el caso «ninguna anotación `@sin-superficie` de acción sobrevive a su
motivo» está verde, y las anotaciones se quitaron **con** el código, en el mismo commit.

**Ningún contador de censo se movió, y no es suerte.** `cobertura-tablas` y
`contadores-cabecera` miden componentes con `<DataTable>` y `<Pagination>`; este chore no ha
tocado un solo componente. `72 / 996` en la línea base, tras cada frente y en el gate final: el
mismo número las seis veces. **No se ajustó ninguna cifra, ni en silencio ni de otro modo.**

### La comprobación de anclas, hecha bien — y por qué la primera vez estuvo mal

El encargo mandaba `grep` en **todos** los ficheros `*guard*`. El primer intento usó
`grep -r --include=*guard*`, que filtra **por nombre de fichero** — y eso **se deja fuera** a
`tests/unit/guards/censo-order-status-rename.test.ts`, `censo-catalogo-estados-v2.test.ts`,
`no-embalaje.test.ts` y otras 10 más, que están en la carpeta pero no llevan «guard» en el
nombre. Justo las que más probable era que citaran `listarCatalogoEstatus`.

La forma correcta es preguntárselo a vitest, que es quien selecciona:

```
pnpm exec vitest list guard | sed 's/ >.*//' | sort -u    # -> los 72 ficheros reales
grep -Hn "<símbolo>" $(cat esa-lista)
```

Resultado sobre los **72**: **ninguna guardia ancla en ninguno de los siete símbolos.** Salió
limpio, pero por la vía buena. La regla de la §15 anterior («no busques solo en una carpeta»)
necesita este corolario: **tampoco busques solo por nombre de fichero — `vitest run guard`
selecciona por RUTA.**

---

## 8 · Verificación

| Paso | Resultado |
|---|---|
| `pnpm run typecheck` línea base | **limpio** |
| `pnpm run typecheck` tras cada uno de los 4 frentes | **limpio** las cuatro veces |
| `pnpm test:guardias` línea base | 72 archivos / 996 tests ✅ |
| `pnpm test:guardias` tras frente 1 y tras frente 4 | **72 / 996 ✅** |
| `vitest run` ordenes-action + ordenes-descarga-action | 2 archivos / 11 tests ✅ |
| `vitest run plantilla` | 19 / 173 ✅ |
| `vitest run vehiculo` | 5 / 30 ✅ |
| `vitest run` ordenes-guia-action + order-status | 2 / 39 ✅ |
| `eslint` sobre los 9 archivos tocados | **0 errores** |
| **`./init.sh --rapido`** | **`== init OK ==`, exit 0** |
| — `typecheck` | ✓ pasó |
| — `lint` | ✓ **0 errores**, 49 advertencias |
| — `test:cambiados` | **38 archivos / 377 tests ✅** |
| — `test:guardias` | **72 archivos / 996 tests ✅** |
| — `down.sql` de todas las migraciones | ✓ (no se tocó ninguna migración) |

Sin flakes: ningún test de componente necesitó repetirse en aislado, ni hubo timeouts de jsdom.

### Las 49 advertencias de lint: preexistentes, y comprobado

La bitácora anterior midió **48**; hoy salen **49**. La diferencia **no la introduce este
chore**, y no es una suposición: se cruzaron los 22 archivos que emiten advertencia contra los 9
que este chore toca (`git diff --name-only origin/dev`), y la **intersección es VACÍA**. Las
advertencias caen en `Sidebar.tsx`, `ZonaRepository.ts`, `cache-nula.ts`, varios
`*-where.test.ts` y otros; ninguno se ha tocado aquí. La 49ª llegó con algún PR posterior al
#313 (`origin/dev` @ `02f46b15` ya la traía).

**Los 9 archivos de este chore emiten 0 errores y 0 advertencias.**

---

## 9 · Lo que queda ABIERTO — huérfanos NUEVOS, nombrados y NO borrados

Borrar una acción deja colgando lo que solo ella usaba. Se midió uno a uno. **Nada de esto se ha
borrado**, porque no está en la decisión humana de hoy (que era «las siete acciones»), y porque
el precedente de este repo es nombrar los huérfanos de capa y dejar que el humano decida.

### 9.1 · Seis tipos exportados sin ninguna referencia

| Tipo | Dónde | Referencias hoy |
|---|---|---|
| `CrearOrdenResult` | `lib/types/orden.ts:331` | **solo su definición** |
| `ObtenerOrdenResult` | `lib/types/orden.ts:332` | ídem |
| `ActualizarOrdenResult` | `lib/types/orden.ts:347` | ídem |
| `BorrarOrdenResult` | `lib/types/orden.ts:348` | ídem |
| `ObtenerPlantillaResult` | `lib/types/plantilla-mensaje.ts:85` | ídem |
| `ListarCatalogoEstatusResult` | `lib/types/orden-guia.ts:161` | ídem |

Son inertes (un tipo sin uso no se compila a nada y no dispara lint), pero son deuda.

### 9.2 · Seis métodos de servicio sin llamador de PRODUCCIÓN

`OrdenService.crear` / `.obtener` / `.actualizar` / `.borrar`,
`PlantillaMensajeService.obtener` y `VehiculoService.obtener` — con sus declaraciones en
`IOrdenService`, `IPlantillaMensajeService` e `IVehiculoService`.

**Conservan sus tests**, y ahí está el matiz que el PR #312 aprendió: *un test que prueba código
que nadie llama da cobertura falsa y mantiene vivo el código muerto*. En particular
`rol-admin-satelite-authz.test.ts` y `orden-service.test.ts` prueban a fondo la autorización de
`OrdenService.crear`, una capacidad a la que **ya no se puede llegar desde ninguna superficie**.

**Cuidado antes de tirar de este hilo:** `OrdenService` como clase **NO** está muerta —
`listarOrdenes` y `listarOrdenesCompleto` la instancian. Es otra vez «un mismo archivo medio
vivo y medio muerto». Y `crearOrdenSchema`/`actualizarOrdenSchema` (`lib/types/orden.ts`)
**tampoco**: `crearOrdenSchema` lo usa la carga masiva y los dos tienen tests propios en
`orden-schemas.test.ts`.

Esto es exactamente el patrón de las tandas 2→3 del PR #312: borrar el consumidor deja huérfano
al proveedor. **Cerrarlo requiere una decisión humana nueva.**

### 9.3 · Deuda `@sin-superficie` que sobrevive: las 5, y ninguna es huérfana

| Módulo | Qué es | ¿Deuda? |
|---|---|---|
| `cierre-bodega.ts:149` | testigo de tres casos de R1 (features 170/184) | **no**, decisión declarada |
| `gasto-fijo-plantilla.ts:149` | doble vivo de R1 en el censo de descarga (feature 184) | **no**, decisión declarada |
| `wallet-tienda.ts:162` | testigo de anti-vacuidad de R1 (feature 184) | **no**, decisión declarada |
| `wallet-mensajero.ts:139` | lectura sin recorte para los tests de paridad del listado paginado | **no**, decisión declarada |
| `analitica-operativa.ts:155` | modo agregado sin cablear | **tiene dueño: ficha 182**, `pending` |

**Lectura honesta: de las 5 que quedan, CERO son deuda huérfana.** Cuatro son testigos
declarados a propósito y la quinta tiene ficha con dueño. La anotación `@sin-superficie` vuelve
a significar lo que debe significar —«esto está así porque alguien lo decidió»— y deja de ser un
cajón de sastre. Es la primera vez que ocurre desde que existe la guardia.

Balance del día completo, sumando los tres chores: **24 → 5**.

---

## 10 · Lo que hay que saber mañana

1. **`tests/integration/db/_semilla-rollup.ts` exporta un helper `crearOrden`.** Homónimo de la
   Server Action borrada, sin ninguna relación. Avisado en la lápida de `lib/actions/ordenes.ts`.
2. **`buildOrdenRepoParaCatalogo` existe en `order-status.ts` y está VIVO.** Su gemelo de
   `ordenes-guia.ts` es el que se borró.
3. **`listarOrderStatus` es la única lectura del catálogo `order_status` desde hoy.** Si alguien
   busca `listarCatalogoEstatus` por un spec antiguo (features 17/63/137 la nombran), está aquí.
4. **`vitest run guard` selecciona por RUTA, no por nombre de fichero.** Auditar guardias con
   `--include=*guard*` deja fuera 13 de las 72 (§7).
5. **La lápida de un borrado de anotaciones no debe contener el token que se cuenta** (§6).
6. **`54757be4` queda cerrado.** Sus dos víctimas están reparadas: `rutearABodegaSatelite` el
   2026-07-31 y `listarCatalogoEstatus` hoy. Si vuelve a aparecer algo colgando de ese commit,
   es una tercera y no estaba prevista.
