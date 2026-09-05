# Ficha 374 — bitácora de implementación · **BACKEND** (bloques 0, A–G, I)

> **Alcance de esta bitácora:** los bloques **0, A, B, C, D, E, F, G e I** de `tasks.md`.
> El **bloque H (la pantalla)** y el **bloque J (cierre)** NO están hechos: los toma `frontend_dev`
> sobre esta misma rama. Las filas de la matriz que le corresponden se marcan **`PENDIENTE (H)`**
> en vez de dejarse en blanco — un `R` sin test es un fallo de la feature, y lo que aquí se afirma
> es de quién es el turno, no que esté cubierto.

---

## 0 · Preparación

### T0.1 — Base local al día

`pnpm exec prisma migrate status` antes de tocar nada:

```
Datasource "db": PostgreSQL database "ordenex", schema "public" at "localhost:5432"
176 migrations found in prisma/migrations
Database schema is up to date!
```

Tras aplicar las dos migraciones de esta ficha: **178 migraciones**, «All migrations have been
successfully applied», y `migrate status` vuelve a decir «up to date» (sin drift).

### T0.2 — Los cinco símbolos NO existían

Verificado **en el archivo real**, no solo en el grafo. El MCP `codebase-memory` devolvió `total: 0`
para el patrón `(GeografiaService|crearNodoGeografico|geografia-activa|cambiarActivacion|contarSinEntregarPorNodoGeografico)`,
y cada caso se confirmó aparte:

| Símbolo | Cómo se confirmó | Resultado |
| --- | --- | --- |
| `activo` en `Provincia`/`Canton`/`Distrito` | `db/schema.prisma`, modelos leídos enteros | no existía |
| `GeografiaService` | `grep -rn "GeografiaService"` en todo el árbol menos `specs/` | cero coincidencias |
| `_shared/geografia-activa.ts` | `ls lib/repositories/_shared/` → `prisma-fk.ts`, `prisma-unique.ts`, `zona-colapso.ts` | no existía |
| `crearNodoGeografico` | `grep -rn` en `lib`, `app`, `tests` | cero coincidencias |
| ruta `app/(app)/configuracion/geografia/` | `ls app/(app)/configuracion/` → `_components`, `api`, `page.tsx`, `plantillas`, `tarifas`, `vehiculos` | no existía |

### T0.3 — Duplicados medidos ANTES de aplicar los tres `UNIQUE`

**Local (`localhost:5432/ordenex`)**, en solo lectura, con los tres `GROUP BY … HAVING count(*) > 1`:

```
DUPLICADOS provincia: 0 canton: 0 distrito: 0
FILAS      provincia: 7 canton: 84 distrito: 494
```

**Producción:** 0 en los tres niveles, medido por el spec_author el 2026-09-05 (`design.md §2.1`).

> ⚠️ **PREVIEW NO SE MIDIÓ, y hay que decirlo.** La tarea T0.3 lo pedía. No tengo credencial de la
> base de preview: el MCP de Supabase está fijado al ref de **producción** y no hay `DIRECT_URL` de
> preview alcanzable desde aquí. **Antes de desplegar a preview hay que correr esos tres `GROUP BY`
> allí**; si alguno no es 0, el `CREATE UNIQUE INDEX` falla y la migración no debe aplicarse hasta
> decidir qué hacer con los duplicados.

---

## 1 · Archivos creados

### Producción

| Archivo | Qué es |
| --- | --- |
| `db/migrations/20260906120000_geografia_activo_y_unicidad/migration.sql` + `down.sql` | `activo` en los tres niveles y los tres `UNIQUE` por padre |
| `db/migrations/20260906120100_historial_accion_nodo_geografico/migration.sql` + `down.sql` | los 2 tipos de acción y las 3 entidades del registro |
| `lib/repositories/_shared/geografia-activa.ts` | **el predicado, en un solo sitio**: `estaDisponible`, los tres `WHERE_*_DISPONIBLE`, `SELECT_FLAG_PROPIO`, `SELECT_CADENA_*` y los dos `disponibleDesdeCadena*` |
| `lib/types/geografia-nodo.ts` | vocabulario del nivel, `normalizarNombreGeografico`, los tres schemas zod y los tres DTO del árbol |
| `lib/interfaces/services/IGeografiaService.ts` | contrato del servicio |
| `lib/services/GeografiaService.ts` | la regla: rol → hermanos → comparación normalizada → alta; y los tres desenlaces de la activación |

### Tests

`tests/integration/db/`: `geografia-activo-migration`, `geografia-unicidad`,
`geografia-registro-migration`, `geografia-catalogo-activo`, `geografia-cascada-reversible`,
`geografia-registro-accion`, `geografia-alta`, `geografia-historico-intacto`,
`geografia-ordenes-sin-entregar`.

`tests/unit/`: `repositories/geografia-activa`, `repositories/geo-repository.escrituras`,
`types/geografia-nodo`, `services/geografia-service`, `services/geo-resolucion-retirados`,
`services/corregir-datos-cliente-geo-retirada`, `actions/geografia-action`,
`actions/geografia.composition-root`, `api/openapi-374-nodo-retirado`.

`tests/unit/guards/`: `geografia-sin-borrado-fisico`, `geografia-predicado-unico`,
`geografia-sin-renombrado`, `geografia-terminales-una-sola-fuente`.

## 2 · Archivos modificados (los que importan)

| Archivo | Qué cambia |
| --- | --- |
| `db/schema.prisma` | `activo` + `@@unique` en los tres modelos; 2 valores en `HistorialAccionTipo` y 3 en `HistorialAccionEntidad` |
| `lib/repositories/GeoRepository.ts` | deja de ser «solo lectura»: los tres `list*Lite` proyectan `disponible`, y entran `listArbol`, `findHermanos`, `crear` y `cambiarActivacion` |
| `lib/repositories/OrdenRepository.ts` | las cuatro lecturas geográficas PROYECTAN la cadena (ni un `WHERE` nuevo) y entra `contarSinEntregarPorNodoGeografico` |
| `lib/services/geo-resolucion.ts` | los tres rechazos por nodo retirado, cada uno detrás de su `lookup` |
| `lib/services/CorregirDatosClienteService.ts` | un rechazo más, con motivo propio |
| `lib/repositories/ConteosPublicosRepository.ts` | los conteos de la landing SÍ recortan |
| `lib/actions/geografia.ts` | delega en el service; tres Server Actions nuevas + el composition root |
| `lib/types/historial-accion.ts` · `historial-accion-etiquetas.ts` | catálogo cerrado 47/20 y los tres constructores de etiqueta geográfica |
| `lib/types/filtros-ordenes.ts` | `OpcionGeografica` / `OpcionGeograficaConPadre` |
| `lib/api/openapi-spec.ts` · `docs/api/api-key-openapi.yaml` · `docs/api/CHANGELOG.md` | el motivo de fila nuevo, en los dos artefactos + entrada fechada |

**Colateral (fixtures de suites ajenas):** 22 archivos de test ganan `disponible`/`activo` en sus
filas geográficas. Y **dos suites de fichas anteriores se actualizaron a propósito**, no por
comodidad:

- `api-key-eliminada-migration.test.ts` fijaba «el enum tiene 45» y «el último valor es
  `api_key_eliminada`». El conteo pasa a compararse **contra el catálogo** (el número duro sigue
  vivo en la guardia del censo, que además obliga a censar el productor), y «el último» pasa a
  medir la **posición relativa** —que es lo que la 373 necesitaba demostrar: que `ADD VALUE`
  apende—. Un literal ahí obligaba a cada ficha futura a venir a editar la suite de la anterior.
- `historial-accion-orden-zona-reconciliada-migration.test.ts` tiene una lista `POSTERIORES`
  pensada exactamente para esto: se le añaden los dos valores.

---

## 3 · Matriz `R<n> → test`

| R | Test que lo cubre | Archivo |
| --- | --- | --- |
| R1 | «las tres tablas ganan `activo` NOT NULL con default true» + «TODAS las filas previas quedan en `true`» + «Postgres RECHAZA un NULL» | `tests/integration/db/geografia-activo-migration.test.ts` |
| R2 | «las tres tablas quedan SIN la columna» + «NINGUNA fila se borró ni se modificó» + «los nombres siguen siendo los mismos, fila a fila» + idempotencia | `tests/integration/db/geografia-activo-migration.test.ts` |
| R3 | «una provincia / un cantón / un distrito repetidos violan la unicidad» | `tests/integration/db/geografia-unicidad.test.ts` |
| R4 | «`pg_indexes` no lista NINGÚN índice cuya definición sea solo `(activo)`» + el estático sobre el SQL | `tests/integration/db/geografia-activo-migration.test.ts` |
| R5 | «cero hallazgos de `delete`/`deleteMany` en `lib/`», con contraprueba sobre cuerpo mutado + «la clase no expone ningún método que hable de borrar» | `tests/unit/guards/geografia-sin-borrado-fisico.guardia.test.ts` · `tests/unit/repositories/geo-repository.escrituras.test.ts` |
| R6 | «los ids de `list*Lite` son los de un `findMany` SIN `where`» + «con todo disponible, la terna resuelve igual que siempre» | `tests/integration/db/geografia-catalogo-activo.test.ts` · `tests/unit/services/geo-resolucion-retirados.test.ts` |
| R7 | las 8 combinaciones de los tres flags | `tests/unit/repositories/geografia-activa.test.ts` |
| R8 | «los tres flags son los mismos antes y después, fila a fila» + «el `update` toca UNA tabla y UNA fila» | `tests/integration/db/geografia-cascada-reversible.test.ts` · `tests/unit/repositories/geo-repository.escrituras.test.ts` |
| R9 | «⭑ el distrito que ya estaba retirado POR SU CUENTA sigue retirado» | `tests/integration/db/geografia-cascada-reversible.test.ts` |
| R10 | «el distrito ACTIVO bajo el cantón INACTIVO está en el árbol, con su flag propio en `true`» + «NINGUNA consulta lo corrige en la base» | `tests/integration/db/geografia-catalogo-activo.test.ts` · `tests/unit/repositories/geografia-activa.test.ts` |
| R11 | «ningún archivo de `lib/` fuera del módulo compartido escribe `activo: true`», con contraprueba | `tests/unit/guards/geografia-predicado-unico.guardia.test.ts` |
| R12 | «provincia, cantón y distrito: las tres filas existen bajo su padre» | `tests/integration/db/geografia-alta.test.ts` · `tests/unit/repositories/geo-repository.escrituras.test.ts` |
| R13 | «los tres nacen ACTIVOS, por el DEFAULT de la columna» | `tests/integration/db/geografia-alta.test.ts` |
| R14 | «padre inexistente → `not_found` y CERO filas creadas» (unitario y contra Postgres) | `tests/unit/services/geografia-service.test.ts` · `tests/integration/db/geografia-alta.test.ts` |
| R15 | «⭑ el alta bajo un cantón retirado es `ok`, con flag propio `true` y disponibilidad efectiva `false`» | `tests/integration/db/geografia-alta.test.ts` |
| R16 | «`"  San   José  "` → `"San José"`» + «el nombre llega a la COLUMNA con su acento» | `tests/unit/types/geografia-nodo.test.ts` · `tests/integration/db/geografia-alta.test.ts` |
| R17 | «`san jose` / `SAN JOSE` / `San  José` → `conflict`», incluido el hermano INACTIVO | `tests/unit/services/geografia-service.test.ts` · `tests/integration/db/geografia-alta.test.ts` |
| R18 | «⭑ llamando al repositorio dos veces, la base rechaza la segunda y NO deja fila» + «el borde traduce a `conflict`» | `tests/integration/db/geografia-alta.test.ts` · `tests/unit/actions/geografia-action.test.ts` |
| R19 | «dos cantones homónimos en provincias distintas» + «"Buenos Aires" cantón de Puntarenas Y distrito de Palmares» | `tests/integration/db/geografia-unicidad.test.ts` · `tests/integration/db/geografia-alta.test.ts` |
| R20 | «provincia, cantón y distrito, ida y vuelta» | `tests/integration/db/geografia-cascada-reversible.test.ts` |
| R21 | «`sin_cambio` NO escribe nada, y el corte va ANTES del update» | `tests/unit/services/geografia-service.test.ts` · `tests/unit/repositories/geo-repository.escrituras.test.ts` · `tests/integration/db/geografia-registro-accion.test.ts` |
| R22 | «id inexistente → `not_found`, sin escrituras» | `tests/unit/services/geografia-service.test.ts` · `tests/unit/repositories/geo-repository.escrituras.test.ts` · `tests/integration/db/geografia-cascada-reversible.test.ts` |
| R23 | «sin sesión → `unauthenticated` sin instanciar el service», **una por cada una de las cuatro acciones** | `tests/unit/actions/geografia-action.test.ts` |
| R24 | «rol ≠ `maestro` → `forbidden` sin llamar al repositorio», una por operación × 4 roles | `tests/unit/services/geografia-service.test.ts` |
| R25 | «nivel desconocido, padre ausente, nombre corto y clave desconocida → `validation_error` sin tocar el service» | `tests/unit/actions/geografia-action.test.ts` · `tests/unit/types/geografia-nodo.test.ts` |
| R26 | «el árbol trae la provincia retirada y su `activo`» | `tests/integration/db/geografia-catalogo-activo.test.ts` · `tests/unit/services/geografia-service.test.ts` |
| R27 | «con UNA zona la muestra; con CERO `null`; **con DOS `null` también**» | `tests/integration/db/geografia-catalogo-activo.test.ts` |
| R28 | «los tres `list*Lite` devuelven el nodo retirado con `disponible: false`» + «⭑ devuelven EXACTAMENTE lo que hay en la tabla» | `tests/integration/db/geografia-catalogo-activo.test.ts` · `tests/unit/repositories/catalogo-filtros-ordenes.test.ts` |
| R29 | **PENDIENTE (H9)** — desplegables de la corrección | `tests/unit/components/corregir-ubicacion-inactivos.test.tsx` |
| R30 | «⭑ el motivo es DISTINTO del de "el distrito indicado no existe"» + «no se escribe nada» | `tests/unit/services/corregir-datos-cliente-geo-retirada.test.ts` |
| R31 | «`findDistritosByCantonIds` y `findDistritoParaCorreccion` devuelven el retirado con su disponibilidad» | `tests/integration/db/geografia-catalogo-activo.test.ts` |
| R32 | un caso por nivel, con su mensaje propio + «los tres NO son "no encontrado" ni "ambiguo"» | `tests/unit/services/geo-resolucion-retirados.test.ts` |
| R33 | «con los TRES retirados gana la PROVINCIA» + los dos casos restantes + «siempre UN solo campo» | `tests/unit/services/geo-resolucion-retirados.test.ts` |
| R34 | «deja de contar en cuanto se retira», con contraprueba ANTES + «un distrito SIN zona sigue sin contar» | `tests/integration/db/geografia-catalogo-activo.test.ts` · `tests/unit/actions/conteos-publicos.test.ts` |
| R35 | «sigue en el listado y sigue saliendo al filtrar por su `distritoId`», con la cadena entera retirada | `tests/integration/db/geografia-historico-intacto.test.ts` |
| R36 | «lote de 2 filas con una retirada → 200, una cotizada y una en `errores`» | `tests/integration/cotizacion-api-key.test.ts` |
| R37 | «los DOS artefactos lo dicen y dicen lo mismo» + «la entrada fechada existe y dice las tres cosas» | `tests/unit/api/openapi-374-nodo-retirado.test.ts` |
| R38 | **PENDIENTE (H5)** | `tests/unit/components/geografia-admin-page.test.tsx` |
| R39 | **PENDIENTE (H1/H6)** | `tests/unit/utils/filtrar-arbol-geografico.test.ts` · `tests/unit/components/geografia-admin.ui.test.tsx` |
| R40 | **PENDIENTE (H6)** | `tests/unit/components/geografia-admin.ui.test.tsx` |
| R41 | **PENDIENTE (H6)** | `tests/unit/components/geografia-admin.ui.test.tsx` |
| R42 | **PENDIENTE (H6)** | `tests/unit/components/geografia-admin.ui.test.tsx` |
| R43 | **PENDIENTE (H7)** | `tests/unit/components/geografia-admin.ui.test.tsx` |
| R44 | **PENDIENTE (H1/H7)** | `tests/unit/utils/zonas-sin-distritos.test.ts` · `tests/unit/components/geografia-admin.ui.test.tsx` |
| R45 | **PENDIENTE (H7)** | `tests/unit/components/geografia-admin.ui.test.tsx` |
| R46 | **PENDIENTE (H8)** | `tests/unit/auth/menu-visibility.test.ts` · `tests/unit/auth/destino-post-login.test.ts` |
| R47 | **PENDIENTE (H3)** | `tests/unit/components/geografia-selector-inactivos.test.tsx` |
| R48 | **PENDIENTE (H4)** | `tests/integration/db/zona-guardado-conserva-inactivos.test.ts` |
| R49 | «ninguna escritura de `lib/` cambia el nombre de un nodo», con contraprueba + «ni la interfaz ni el service ni la acción declaran nada que renombre» | `tests/unit/guards/geografia-sin-renombrado.guardia.test.ts` |
| R50 | «tras un alta, una desactivación y una reactivación, la puente tiene las MISMAS filas» | `tests/integration/db/geografia-cascada-reversible.test.ts` |
| R51 | «una fila, con la acción y la entidad del nivel» + la entrada del censo | `tests/integration/db/geografia-registro-accion.test.ts` · `tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts` |
| R52 | «las dos operaciones dejan dos filas, cada una con su tipo, y son valores distintos» | `tests/integration/db/geografia-registro-accion.test.ts` · `tests/unit/repositories/geo-repository.escrituras.test.ts` |
| R53 | «un alta NO escribe fila» + «⭑ pedir desactivar lo YA inactivo no escribe ni el `update` ni la fila» | `tests/integration/db/geografia-registro-accion.test.ts` · `tests/unit/repositories/geo-repository.escrituras.test.ts` |
| R54 | «⭑ la etiqueta es `Cabagra · Buenos Aires · Puntarenas`» + el actor congelado + la guardia de datos de cliente sobre el archivo nuevo | `tests/integration/db/geografia-registro-accion.test.ts` · `tests/unit/guards/historial-accion-sin-datos-cliente.guardia.test.ts` · `tests/unit/historial-accion/catalogo-y-choke-point.test.ts` |
| R55 | «⭑ el flag sigue como estaba, y no queda fila», con savepoint REAL y contraprueba con el registro sano | `tests/integration/db/geografia-registro-accion.test.ts` |
| R56 | «los dos tipos en `hace_desaparecer`, con etiqueta legible y como valor de filtro», con contraprueba del borde | `tests/unit/historial-accion/catalogo-y-choke-point.test.ts` |
| R57 | «el enum de la base ES el catálogo» + «el down devuelve los dos enums a la lista previa, valor a valor y EN ORDEN» + «con una fila que use un valor nuevo, el rollback ABORTA y no la borra» | `tests/integration/db/geografia-registro-migration.test.ts` |
| R58 | **PENDIENTE (H1/H10)** | `tests/unit/utils/filtrar-arbol-geografico.test.ts` |
| R59 | **PENDIENTE (H1/H10)** | `tests/unit/utils/filtrar-arbol-geografico.test.ts` |
| R60 | «devuelve lo que dice el repositorio» + «sin sesión / rol ajeno no consulta» + «⭑ el composition root lo PASA» | `tests/unit/services/geografia-service.test.ts` · `tests/unit/actions/geografia-action.test.ts` · `tests/unit/actions/geografia.composition-root.test.ts` · `tests/integration/db/geografia-ordenes-sin-entregar.test.ts` |
| R61 | «una `en_reparto` cuenta; una `entregada`, una `devuelta_a_tienda`, una `incidente` y una BORRADA no» + «⭑ una orden sin `distrito_id` cuenta para su cantón» + «la lista se importa, no se declara» | `tests/integration/db/geografia-ordenes-sin-entregar.test.ts` · `tests/unit/guards/geografia-terminales-una-sola-fuente.guardia.test.ts` |
| R62 | **PENDIENTE (H7)** | `tests/unit/components/geografia-admin.ui.test.tsx` |
| R63 | **PENDIENTE (H7)** | `tests/unit/components/geografia-admin.ui.test.tsx` |

**Cubiertos por el backend: 45 de 63.** Los 18 restantes son del bloque H y de la mitad de UI de
R44/R60.

---

## 4 · Las mutaciones, con su resultado LITERAL

Siete mutaciones **ejecutadas**, una por una: se aplica al código de producción, se corre la suite
que la vigila, se copia el mensaje real y se revierte con `git checkout --`. Después de cada una se
comprobó con `grep -c MUTACION` que no quedaba residuo.

### M1 · El eslabón del cantón en el predicado de la cadena

`lib/repositories/_shared/geografia-activa.ts` — `canton: fila.canton.activo` → `canton: true`.

**3 rojos:**

```
FAIL tests/unit/repositories/geografia-activa.test.ts > 374/R7 — `disponibleDesdeCadena` sobre la fila que proyecta Prisma > compone los tres niveles de la fila proyectada
AssertionError: expected true to be false

FAIL tests/integration/db/geografia-catalogo-activo.test.ts > 374/R28 … > `listDistritosLite` trae los cinco, con la disponibilidad EFECTIVA de cada uno
AssertionError: expected true to be false

FAIL tests/integration/db/geografia-catalogo-activo.test.ts > 374/R31 … > el distrito heredado (activo bajo canton inactivo) sale por su canton y NO esta disponible
AssertionError: expected true to be false
```

### M2 · El `appendAccion` FUERA de la `$transaction`

`GeoRepository.cambiarActivacion` — la transacción devuelve el estado previo y el registro se
escribe después, con `this.prisma`. Compila y pasa los tests de comportamiento del cambio de flag.

**2 rojos, y son los dos que tienen que caer:**

```
FAIL tests/integration/db/geografia-registro-accion.test.ts > 374/R55 — si `appendAccion` falla, el cambio del flag se deshace > ⭑ el flag sigue como estaba, y no queda fila de registro
AssertionError: el flag quedo cambiado con el registro caido: expected false to be true

FAIL tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts > 362/R9 — los 47 tipos se registran DENTRO de la transaccion de su accion > GeoRepository.ts#cambiarActivacion registra su accion en la misma transaccion que la escribe
AssertionError: lib/repositories/GeoRepository.ts#cambiarActivacion (nodo_geografico_desactivado, nodo_geografico_activado): una accion que se escribe sin su registro deja el modulo mintiendo en silencio: expected [ …(2) ] to deeply equal []
```

### M3 · El `WHERE` de un `list*Lite`

`GeoRepository.listDistritosLite` gana `where: WHERE_DISTRITO_DISPONIBLE`.

**5 rojos en 3 archivos:**

```
FAIL geografia-catalogo-activo > 374/R28 > `listDistritosLite` trae los cinco…
AssertionError: expected undefined to be false

FAIL geografia-catalogo-activo > 374/R28 > ⭑ MUTACION VIGILADA: los tres `list*Lite` devuelven EXACTAMENTE lo que hay en la tabla
AssertionError: expected 497 to be 499

FAIL geografia-catalogo-activo > 374/R6 > los ids de `list*Lite` son los de un `findMany` SIN `where`
AssertionError: expected [ …(497) ] to deeply equal [ …(499) ]

FAIL geografia-historico-intacto > y el catalogo de filtros SIGUE ofreciendo ese distrito, marcado como no disponible
AssertionError: el distrito retirado desaparecio del catalogo de filtros: expected undefined to be defined

FAIL tests/unit/repositories/catalogo-filtros-ordenes.test.ts > R48: cada distrito trae su PADRE (canton) como `padreId`, sin la zona
AssertionError: expected "vi.fn()" to be called with arguments: [ Array(1) ]
```

### M4 · El `WHERE` de `findDistritosByCantonIds`

`OrdenRepository.findDistritosByCantonIds` gana `...WHERE_DISTRITO_DISPONIBLE`.

**3 rojos:**

```
FAIL geografia-catalogo-activo > 374/R31 > `findDistritosByCantonIds` devuelve el distrito RETIRADO, con `disponible: false`
AssertionError: el distrito retirado NO salio: hay un `where` de mas: expected undefined to be defined

FAIL geografia-catalogo-activo > 374/R31 > ⭑ MUTACION VIGILADA: devuelve TODOS los distritos del canton, retirados incluidos
AssertionError: expected [ { …(7) }, { …(7) }, { …(7) } ] to have a length of 4 but got 3

FAIL geografia-catalogo-activo > 374/R31 > el distrito heredado (activo bajo canton inactivo) sale por su canton y NO esta disponible
AssertionError: expected [] to have a length of 1 but got +0
```

### M5 · Materializar la cascada con un `updateMany` a los hijos

`GeoRepository.cambiarActivacion`, rama del cantón: `await tx.distrito.updateMany({ where: { cantonId: id }, data: { activo } })`.

**3 rojos:**

```
FAIL geografia-cascada-reversible > 374/R8 > los tres flags son los mismos antes y despues, fila a fila
AssertionError: expected { …(3) } to deeply equal { …(3) }

FAIL geografia-cascada-reversible > 374/R9 > ⭑ el distrito que ya estaba retirado POR SU CUENTA sigue retirado
AssertionError: expected { …(3) } to deeply equal { …(3) }

FAIL tests/unit/repositories/geo-repository.escrituras.test.ts > 374/R8/R51/R52 > la etiqueta de un CANTON es su cadena de dos, y la de una PROVINCIA solo su nombre
```

### M6 · El `WHERE` de los conteos públicos

`ConteosPublicosRepository.contar` pierde `...WHERE_DISTRITO_DISPONIBLE`.

**3 rojos:**

```
FAIL geografia-catalogo-activo > 374/R34 > un distrito con zona deja de contar en cuanto se retira (con contraprueba ANTES)
AssertionError: expected 304 to be 303

FAIL geografia-catalogo-activo > 374/R34 > un distrito activo bajo un CANTON retirado tampoco cuenta
AssertionError: expected 304 to be 305

FAIL tests/unit/actions/conteos-publicos.test.ts > cobertura: cuenta DISTRITOS distintos por la tabla puente…
AssertionError: expected { where: { zonas: { some: {} } } } to deeply equal { Object (where) }
```

### M7 · El `deletedAt: null` del conteo de órdenes sin entregar

`OrdenRepository.contarSinEntregarPorNodoGeografico` pierde `deletedAt: null`.

**4 rojos en 3 archivos:**

```
FAIL geografia-ordenes-sin-entregar > 374/R61 > ⭑ una orden BORRADA no cuenta, aunque su estado sea vivo
AssertionError: expected 1 to be +0

FAIL geografia-ordenes-sin-entregar > 374/R61 > las cuatro juntas: solo la viva y no borrada cuenta
AssertionError: expected 2 to be 1

FAIL tests/unit/actions/geografia.composition-root.test.ts > el conteo llega al `where` por la columna CONGELADA del nivel, y con el criterio de vivas
AssertionError: expected { cantonId: 'c-1', estatus: { …(1) } } to match object { cantonId: 'c-1', deletedAt: null }

FAIL tests/unit/guards/geografia-terminales-una-sola-fuente.guardia.test.ts > el `where` del conteo lleva ademas `deletedAt: null`
AssertionError: expected '{\n    const porNivel =\n      nivel …' to match /deletedAt:\s*null/
```

> La séptima mutación declarada en `tasks.md` J2 —«el filtro de `initialSelected` en el selector de
> Tarifas»— **no se ejecutó porque su código no existe todavía**: es el bloque H3/H4.

---

## 5 · Gate

`./init.sh` **completo** (el modo rápido se niega solo: el diff toca `db/migrations/**`,
`db/schema.prisma` y `lib/types/**`). Log en `gate.log`, con el exit code escrito DENTRO:

```
INIT_EXIT=0
```

```
✓ lint paso                     (154 problems, 0 errors, 154 warnings — todos preexistentes)
✓ DATABASE_URL resuelta: los 124 archivos de tests contra Postgres SI se ejecutan
 Test Files  1749 passed (1749)
      Tests  24933 passed | 26 skipped (24959)
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1749 ejecutado(s), todos en el baseline conocido)
== init OK ==
```

**Los `skipped`, mirados y explicados (26):** son 17 de `tests/components/AnaliticaPage.test.tsx` y
9 de `tests/components/AnaliticaShell.test.tsx` — condicionales internos de esas dos suites, ajenos
a esta ficha. **Cero saltados por falta de base**: el gate confirma en su propia línea que los
**124** archivos contra Postgres SÍ se ejecutaron (eran 115 antes; esta ficha añade 6 y el resto
sube por el conteo que el gate mide en cada corrida). Sin `.env` esos 124 se habrían saltado y el
veredicto no valdría.

`tests/baseline-rojos.json` sigue **vacío** y no se le añadió nada.

---

## 6 · Lo que queda para el frontend (bloque H)

### Server Actions listas, con su firma exacta

Todas viven en `lib/actions/geografia.ts` y aceptan un segundo argumento `deps` opcional
(`{ geografiaService?, getActor? }`) que existe **solo para probarlas sin base**.

```ts
listarArbolGeografico(deps?): Promise<
  | { status: "ok"; provincias: ProvinciaArbolDTO[] }
  | { status: "forbidden" }
  | { status: "unauthenticated" }
>

crearNodoGeografico(input: unknown, deps?): Promise<
  | { status: "ok"; id: string; nivel: NivelGeografico }
  | { status: "conflict" }        // el nombre ya existe bajo ese padre (forma normalizada)
  | { status: "not_found" }       // el PADRE no existe
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
>

cambiarActivacionGeografica(input: unknown, deps?): Promise<
  | { status: "ok"; nivel: NivelGeografico; id: string; activo: boolean }
  | { status: "not_found" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
>

contarOrdenesSinEntregarDeNodo(input: unknown, deps?): Promise<
  | { status: "ok"; ordenes: number }
  | { status: "not_found" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
>
```

Entradas que aceptan (schemas en `lib/types/geografia-nodo.ts`, todos `.strict()`):

- alta: `{ nivel: "provincia", nombre }` · `{ nivel: "canton", nombre, provinciaId }` ·
  `{ nivel: "distrito", nombre, cantonId }`;
- activación: `{ nivel, id, activo }` — `activo` es el **estado deseado**, no un toggle;
- conteo: `{ nivel, id }`.

### DTOs

```ts
// lib/types/geografia-nodo.ts — re-exportados como tipos desde lib/actions/geografia.ts
interface ProvinciaArbolDTO { id; nombre; activo; cantones: CantonArbolDTO[] }
interface CantonArbolDTO    { id; nombre; activo; distritos: DistritoArbolDTO[] }
interface DistritoArbolDTO  { id; nombre; zonaId; zonaNombre; zonaEspecial; activo }

// lib/types/filtros-ordenes.ts — el catálogo de filtros
interface OpcionGeografica         extends OpcionCatalogo { disponible: boolean }
interface OpcionGeograficaConPadre extends OpcionConPadre { disponible: boolean }
```

⚠️ **`activo` en el árbol es el flag PROPIO; `disponible` en el catálogo plano es la EFECTIVA.**
No son lo mismo y la distinción es la que sostiene R40/R41: la pantalla deriva «inactivo por su
cantón» mirando al padre en el mismo árbol, con `estaDisponible` de
`lib/repositories/_shared/geografia-activa.ts`, que es una función pura y se puede importar desde
un componente.

⚠️ **`zonaId`/`zonaNombre` del distrito ya NO son «la primera zona»**: son la zona **utilizable**
(colapso 1/0/>1). Un distrito con dos zonas llega con `null` en las dos, que es lo que la marca
«sin zona» de R42 necesita para no heredar la mentira vieja.

### Textos que YA existen y hay que usar (no reescribir)

| Dónde | Texto |
| --- | --- |
| `ACCION_LABELS.nodo_geografico_desactivado` | «Retiró un nodo del catálogo geográfico» |
| `ACCION_LABELS.nodo_geografico_activado` | «Devolvió un nodo al catálogo geográfico» |
| `ENTIDAD_LABELS` | «Provincia» · «Cantón» · «Distrito» |
| `NIVEL_LABELS` (`lib/types/geografia-nodo.ts`) | «Provincia» · «Cantón» · «Distrito» |
| Rechazo de la corrección | «Ese distrito fue retirado del catalogo: elige otro o pide que lo reactiven» |
| `MSG_PROVINCIA_RETIRADA` / `MSG_CANTON_RETIRADO` / `msgDistritoRetirado(n)` (`lib/services/geo-resolucion.ts`) | los tres mensajes del canal público |

### Lo que el frontend tiene que quitar cuando llegue

Las tres Server Actions nuevas llevan **`@sin-superficie`** en su JSDoc, con el motivo escrito: la
pantalla es el bloque H. **La anotación CADUCA**: `superficie-de-uso.guardia` exige quitarla en
cuanto el módulo de la pantalla las importe, así que se pone roja sola y no hay que acordarse.

### Otras piezas que H necesita y NO existen todavía

`filtrar-arbol-geografico.ts`, `geografia-estado-label.ts` y `zonasQueQuedarianSinDistritos` son
tareas **H1**: son módulos puros de presentación y por eso no entran en el backend.

---

## 7 · Verdicto

**Backend completo y verde.** Bloques 0, A–G e I hechos; gate completo `INIT_EXIT=0` con los 124
archivos contra Postgres ejecutados y siete mutaciones muertas con su mensaje literal. Queda
pendiente el bloque H (pantalla) y, dentro del bloque 0, **medir los duplicados en preview antes
de aplicar la migración allí**.
