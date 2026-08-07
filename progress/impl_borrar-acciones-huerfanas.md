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

---
---

# Tanda 2 — cerrar los huérfanos de capa

**Rama:** la misma, `chore/borrar-acciones-huerfanas`, encima de los 5 commits de la tanda 1.
**Fecha:** 2026-08-07 · **Decisión:** humana, la misma del día. Los huérfanos que la tanda 1
nombró en §9 son consecuencia directa de retirar las siete capacidades, igual que la isla de
Meta lo fue en el PR #312: no se vuelve a preguntar, se cierran.

**Commits, uno por capa:**

| # | Hash | Capa |
|---|------|------|
| 6 | `cce3018b` | `chore(types): borra los seis tipos de retorno de las acciones ya borradas` |
| 7 | `e98876ae` | `chore(services): borra los seis metodos de servicio sin llamador, con sus tests` |
| 8 | `f0047301` | `chore(repositories): borra los cinco metodos de repositorio sin llamador` |

---

## 11 · Qué se borró, por capa — y qué NO

### Capa 1 (`cce3018b`) — tipos de retorno de las acciones

Los seis de §9.1, todos con **cero** referencias. Arrastra un séptimo, `EstatusLiteDTO`, que era
la fila de `ListarCatalogoEstatusResult` y no tenía otro usuario. Se verificó que la lectura viva
del catálogo **no** pasaba por él: `listarOrderStatus` tiene sus propios tipos en
`lib/types/order-status.ts`.

### Capa 2 (`e98876ae`) — servicios e interfaces

`OrdenService.crear/.obtener/.actualizar/.borrar` (+ el privado `buildUpdateData`),
`PlantillaMensajeService.obtener` y `VehiculoService.obtener`, con sus declaraciones de interfaz
y sus cuatro tipos de resultado de servicio. **`IOrdenService` queda con SOLO LECTURAS** y se le
reescribe la cabecera para que lo diga.

**Lo que NO se tocó, con su llamador comprobado:**

| Superviviente | Por qué |
|---|---|
| la **clase** `OrdenService` | `listar` y `listarCompleto` siguen vivas (`lib/actions/ordenes.ts`) |
| `KNOWN_ROLES` | lo usan las dos lecturas |
| `UpdateOrdenData` | lo usa `IOrdenRepository.update`, vivo |
| `PlantillaMensajeRepository.findById` | lo usan `actualizar` y `eliminar` |
| `buildUpdateData` de `TarifaService` y `UsuarioService` | **homónimos privados**, no son este |

### Capa 3 (`f0047301`) — repositorios

`IOrdenRepository.create`, `.softDelete`, `.existsGeo`, `.existsEstatus` y
`IVehiculoRepository.findById`, más el tipo `GeoExistence` y la función `mapCreateError`.

**El riesgo obvio, medido y descartado:** `IOrdenRepository.findById` y `.update` están **muy
vivos** — `findById` lo llaman seis servicios (devoluciones origen y central, historial, meta del
mensajero, recuperación de bodega, reprogramación) y `update` dos. Un `grep` apresurado de
«métodos CRUD del repositorio de órdenes» los habría barrido. `CreateOrdenData` y
`CreateOrdenOpciones` tampoco mueren: son también de `createManyOrdenes` y su hermana con guía.

---

## 12 · El veredicto sobre los tests de autorización

Esto es lo que el encargo pidió tratar con cuidado, así que va con su medición.

### `OrdenService.crear` en `rol-admin-satelite-authz.test.ts`

Ese archivo es un censo de **puertas de autorización** para la feature 19 (`adminSatelite` es un
rol SIN permisos nuevos). Tenía cuatro; pierde una.

**La regla NO se queda sin testigo, y no hace falta reapuntarla porque ya la había:** el tercer
bloque del mismo archivo afirma `BulkOrdenService.cargarMasiva` + `adminSatelite` -> `forbidden`.
Y esa **es la vía viva de creación** — se verificó en el código, no de memoria:
`BulkOrdenService.cargarMasiva:250` es `if (actor.rol !== "adminTienda") return forbidden`, y
`cargarMasivaViaApi:367` exige `apiKey`. Es decir, «un adminSatelite no puede crear órdenes»
sigue afirmado exactamente donde las órdenes se crean.

Reapuntar habría sido **duplicar**. Se borra el bloque y se corrige la cabecera del archivo, que
decía «cubre las cuatro puertas listadas en el spec»: ahora dice tres, con el motivo y la
remisión a esta bitácora.

**Lo que sí se pierde, y se dice:** el caso «no-regresión: maestro conserva su resultado exitoso».
No es reapuntable — tras este borrado **maestro/admin no tienen ninguna vía viva de crear una
orden** (la carga masiva por sesión es solo `adminTienda`). No es un test que se caiga: es una
capacidad que ya no existe.

### Los otros casos de autorización

- **Feature 155 (dónde NACE la orden)**, que se probaba vía `crear`: **tres testigos vivos** —
  `bulk-orden-service.test.ts` (R16, las dos ramas del flag `fulfillment`),
  `bulk-orden-service.carga-api.test.ts` (vía API key) y `destino-creacion.test.ts` (la función
  de decisión, aislada).
- **R24** (rol desconocido -> `forbidden`): conserva testigo en el bloque de `listar`.
- **R5 de plantillas**: era un **bucle sobre las siete operaciones**; se quita la línea de
  `obtener` y las otras seis siguen afirmando lo mismo. El test NO se borra.
- **R28** (la borrada no se lee): sigue mapeado al `listar` de su mismo caso.

---

## 13 · Cinco bloques de test REAPUNTADOS en la capa 3

Aquí es donde la regla «aserción-sobre-lo-muerto no es lo mismo que montaje-para-lo-vivo» rindió
más. Los cinco afirmaban propiedades de **helpers compartidos y vivos**; `create` era el vehículo.

| Bloque | Reapuntado a | Por qué NO era de `create` |
|---|---|---|
| `orden-geocode-enqueue` **R6** | `createManyOrdenes` | era el **único** testigo del `maxIntentos` = 8 (R34) y de la `dedupeKey` CON HASH. El bloque de carga masiva solo miraba el `payload` |
| `orden-geocode-enqueue` **R7** | `createManyOrdenes` | el encolado va DENTRO de la tx del writer (patrón **outbox**); nadie más lo afirmaba |
| `orden-geocode-enqueue` **R12/R13** | `createManyOrdenes` | la propiedad es de la `dedupeKey` con hash: sin ella, corregir una dirección chocaría contra una fila `done` (que no se purga) y **la corrección no se geocodificaría jamás** |
| `orden-historial-atomicidad` **mecanismo #2** | `createManyOrdenes` | el archivo es un **censo POR MECANISMO** de escritura; quitar la fila dejaría la inserción —viva— sin auditar la atomicidad de su rastro |
| `creacion-bifurcada` **R12** | `createManyOrdenesConGuia` | hace exactamente lo mismo: insertar, numerar, anexar historial y encolar en UNA tx |

`encolarGeocodificacion` es un helper **compartido** por `update`, `createManyOrdenes` y
`createManyOrdenesConGuia`: por eso el reapuntado es legítimo y no una maniobra para mantener el
verde.

**Lo que SÍ se borró, con su justificación medida:**

- **R3/R8** (`num_guia IS NULL`, la guarda idempotente de la numeración): tiene **cuatro
  testigos vivos** — `orden-repository.carga-api.test.ts:105`, `orden-repository.guia.test.ts`
  (dos casos) y `guia-asignacion-service.test.ts:310`.
- **155/R9** (la creación NUNCA escribe `mensajero_asignado_id`): pasa a estar garantizada
  **por el TIPO**, que es más fuerte que un test — `CreateOrdenData` **no tiene ese campo**, y el
  insert en lote se construye desde él con `toCreateManyInput`.
- **R39/R40** (`softDelete`): eran los requisitos DE la capacidad retirada. El predicado
  `deleted_at IS NULL` sigue vivo y probado en TODAS las lecturas.
- **R37** (el alta manual no toca el lote): requisito DEL alta manual. Hoy la afirmación sería
  vacua. R40 conserva testigo en el bloque del lote.
- **P2002 -> `NumRemisionDuplicadoError`**: se va con su traductor. La carga masiva **nunca
  provoca ese error**: detecta duplicados antes de insertar (`findExistingRemisiones`) y usa
  `skipDuplicates`.

---

## 14 · El hallazgo de la tanda: un valor de enum se queda sin productor

Es lo más importante de esta tanda y no estaba previsto en el encargo.

**`OrdenRepository.create` era el ÚNICO productor de la familia `creacion_manual`** del enum
`orden_historial_origen_tipo` (`lib/types/orden-historial.ts:13`, sembrado en la base).

**El valor NO se retira del seed, y es deliberado:** hay **filas históricas reales** en la base
apuntándolo. Quitarlo dejaría historial existente sin su familia. Lo que desaparece es la
capacidad de producir filas NUEVAS con esa familia, no las que ya hay.

Se modeló explícito en vez de esconderlo: nueva lista **`FAMILIAS_CON_PRODUCTOR_RETIRADO`** en
`orden-historial-cobertura.test.ts`, **distinta** de `FAMILIAS_SIN_PRODUCTOR`. La diferencia
importa: aquéllas *esperan a su feature* (`recoleccion_tienda` espera a la 157); ésta **ya no
espera a nadie**. Sin esa distinción, alguien leería el hueco como un olvido de implementación y
se pondría a «arreglarlo».

### El censo de puntos de escritura: 27 -> 26, dejando un HUECO a propósito

La guardia exigía numeración **contigua** `1..27`. Renumerar era la reacción obvia y habría sido
un error: **`n` es un identificador estable, no un índice**. Lo citan `design §2` y **cuatro
casos del propio archivo**, que buscan por `n === 12 / 24 / 25 / 26`. Renumerar sale barato
dentro del archivo y caro fuera.

Se cambió la aserción a la **lista explícita de números vigentes** (con el `2` ausente) y se
documentó que un punto retirado **jubila su número**. La guardia no se debilita: un hueco NO
declarado en esa lista sigue rompiendo.

### Y una lección de método, otra vez la misma

Esta guardia **no la cazó mi comprobación de anclas**. Verifiqué los 72 ficheros que selecciona
`vitest run guard` — pero `orden-historial-cobertura.test.ts` vive en `tests/unit/repositories/`
y **no lleva «guard» en la ruta**, así que no está entre los 72. Salió en rojo al correr la suite
de repositorios.

Es el error de la tanda 1 repetido un nivel más arriba: **medí con una herramienta que no cubría
lo que yo creía**. La regla completa, ya en tercera iteración:

> Un censo que se ancla en símbolos reales puede estar en CUALQUIER archivo de test, se llame
> como se llame y esté donde esté. `grep --include=*guard*` no basta; `vitest list guard` tampoco.
> Lo único que basta es **correr la suite** de la zona que tocas.

---

## 15 · Comentarios que pasaban a mentir: seis, corregidos

| Archivo | Qué decía |
|---|---|
| `lib/types/orden-historial.ts:13` | «feature 6: `OrdenService.crear`» — nombraba el símbolo borrado como productor vigente |
| `orden-historial-cobertura.test.ts` | «Los 24 puntos», «numeración 1..27 sin huecos», y `softDelete` en la lista de «no escriben estado» |
| `creacion-bifurcada` (cabecera) | «las **TRES** rutas de creación» — hoy son dos |
| `orden-repository.carga-lote.test.ts:20` | «R37 — el alta manual individual (`create`) deja carga_id NULL» |
| `orden-repository.test.ts` | «`create`/`update` ahora corren en `$transaction`» |
| **`ordenes-action.test.ts` y `vehiculos-action.test.ts`** | **los escribí YO en la tanda 1**: decían que el doble implementaba la interfaz entera «porque esos métodos siguen declarados en ella». Horas después ya no lo estaban |

Los dos últimos son el aviso útil: **una lápida también caduca**. Si documentas «esto sigue vivo
por tal razón», la razón puede morir en el commit siguiente — y ser el tuyo.

---

## 16 · Verificación

| Paso | Resultado |
|---|---|
| `pnpm run typecheck` tras cada capa | **limpio** las tres veces |
| `pnpm test:guardias` (72, por RUTA) | **72 archivos / 996 tests OK**, igual que la línea base |
| Anotaciones `@sin-superficie` | **5 antes y 5 después** — esta tanda no toca Server Actions |
| `vitest run` repositorios + integración | 98 archivos / 1249 tests OK (tras arreglar el censo) |
| `vitest run` orden-service + vehiculo + plantilla + ordenes-action + authz | 36 / 437 OK |
| `eslint` sobre los archivos tocados | **0 errores, 0 advertencias** |
| **`./init.sh --rapido`** | **`== init OK ==`, exit 0** |
| — `test:cambiados` | **236 archivos / 3076 tests OK** |
| — `test:guardias` | **72 / 996 OK** |
| — `lint` global | 0 errores, 49 advertencias (las mismas preexistentes de la tanda 1; ninguna en un archivo de este chore) |

Sin flakes: ningún test necesitó repetirse en aislado. El salto de `test:cambiados` (38 -> 236)
confirma lo que ya apuntaba el PR #312: el coste del gate rápido se mide por **capa**, no por
número de archivos. Tocar `lib/interfaces/` y `lib/types/` arrastra casi todo el grafo.

Que las anotaciones **no se muevan** es la comprobación de que la tanda no se salió del carril:
la guardia cuenta Server Actions de `lib/actions/**`, y aquí no se ha tocado ninguna — solo
`lib/types/`, `lib/interfaces/`, `lib/services/`, `lib/repositories/` y tests.

---

## 17 · Lo que queda ABIERTO — y por qué me paré aquí

Tres huérfanos nuevos que **no** son «un método de repositorio o una interfaz sin llamador», que
es hasta donde llegaba el encargo. Los nombro en vez de borrarlos:

| Huérfano | Estado | Por qué no lo toqué |
|---|---|---|
| **`NumRemisionDuplicadoError`** (`IOrdenRepository.ts:210`) | clase sin **ningún** lanzador desde que se fue `mapCreateError` | sigue en la tabla de contrato `DOMAIN_ERROR_CODE` de `lib/errors/normalize.ts:14`, que mapea **por nombre**. Borrarla toca la **taxonomía de errores**, otro subsistema. Además `normalize.test.ts` y el R11 que reapunté construyen la clase por nombre, así que el mapeo sigue probado |
| **`crearOrdenSchema` + `CrearOrdenInput`** | cero consumidores de producción | es un **contrato de validación** con test propio (`orden-schemas.test.ts`) y citado en prosa por `IOrdenRepository.ts:13` para explicar **por qué una columna es nullable**, y por cuatro specs |
| **`actualizarOrdenSchema` + `ActualizarOrdenInput`** | ídem | ídem: `IOrdenRepository.ts:47` y `OrdenRepository.ts:894` lo citan para explicar que un guard es **estructuralmente inalcanzable** — un invariante VIVO que se apoya en él |

La razón de fondo es la misma para los tres: **son documentación de invariantes de código vivo**.
Borrarlos no es quitar código muerto, es quitarle a código vivo la explicación de por qué es como
es. Merece su propia decisión, no el arrastre de ésta.

**Nada más quedó suelto.** Se comprobó que no queda ninguna referencia de código a lo borrado en
las tres capas; las únicas menciones son las lápidas dejadas a propósito.
