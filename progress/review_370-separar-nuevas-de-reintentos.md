# Review — ficha 370 · separar en bodega las nuevas de las que ya salieron

- **Rama:** `fix/370-separar-nuevas-de-reintentos` · **HEAD revisado:** `cd9eca0e`
- **Diff:** `git diff origin/dev...HEAD` — 22 archivos, +1634 / −12
- **Contrato:** el plan aprobado por el humano (`~/.claude/plans/tengo-un-problema-que-logical-moore.md`,
  `sdd: false`: el plan hace de spec) + la ficha 370 en `feature_list.json`
- **Fecha:** 2026-09-03

---

## VEREDICTO: **APROBADO**

**0 bloqueantes · 4 menores.** Ninguno de los cuatro es de código: son de registro
(`progress/impl_370.md` ausente, la `status_note` de la ficha desalineada con las etiquetas
entregadas, la mitigación que el plan pedía en la UI, y un hueco de cobertura preexistente en la
puerta de rol de la página). El predicado, sus dos dialectos, las tres consultas del satélite, la
descarga, el borde y la puerta de rol están implementados como manda el contrato y —lo importante—
**medidos**: 13 mutaciones aplicadas una a una sobre el árbol real, 13 muertas, 0 supervivientes.

---

## Lo que ejecuté yo (no la bitácora del implementer)

No corrí `./init.sh` (instrucción explícita; consta `INIT_EXIT=0` en dos tandas, 1699 archivos y
24 181 tests). Lo que sí corrí, acotado:

| Comando | Resultado |
|---|---|
| `vitest run tests/integration/db/salida-a-reparto-sql-real.test.ts --reporter=verbose` | **6 passed**, los seis con nombre en el reporte: **no skipped**. El `.env` del árbol principal está presente, así que `HAY_BASE_DE_DATOS` es cierto y el `WHERE` se ejecutó contra Postgres de verdad. |
| `vitest run` sobre los 6 archivos unitarios de la ficha | 124 passed |
| `vitest run tests/unit/components/ordenes-listado-filtros.test.tsx` | 20 passed |
| `vitest run` de 3 guardias relevantes (`superficie-de-uso`, `anclaje-vs-intentos`, `test-citado-desaparecido`) | 50 passed |
| `pnpm run typecheck` | limpio |
| `eslint` sobre los 13 archivos de producción y test tocados | limpio |

Comprobación anti-vacuidad del propio arnés: el archivo de integración **no** se salta en silencio
—sin base, `describeSiHayBase` lo marcaría `skipped`, no `passed`— y lo verifiqué leyendo el
reporte `verbose`, no el conteo.

---

## Cobertura: qué comprueba cada test y qué mutación lo mata

Las 13 mutaciones se aplicaron **de una en una** sobre el árbol de trabajo, se corrió la suite
acotada y se restauró el archivo desde una copia de respaldo. `git status` quedó limpio al terminar
(solo el `design-etiquetas/` sin seguimiento que ya estaba antes).

### El predicado y sus dos dialectos

| # | Mutación aplicada | Dónde | Qué cayó | Resultado |
|---|---|---|---|---|
| A | `some` a `every` en la rama «ya» (la trampa de la vacuidad) | `OrdenRepository.ts:1109-1114` | 5 de 6 casos, incluido «CERO filas de historial es NUEVA» | **MUERTA** |
| B | `none` a `every` en la rama «nunca» | `OrdenRepository.ts:1113` | 4 de 6 | **MUERTA** |
| C | invertir el sentido del ternario (Prisma) | `OrdenRepository.ts:1111-1113` | 5 de 6 | **MUERTA** |
| D | otro estado destino, **solo en Prisma** (`en_reparto` por `por_recoger`) | `OrdenRepository.ts:1110` | 5 de 6, incluido el de los dos dialectos | **MUERTA** |
| E | invertir el sentido del ternario **en el SQL crudo** | `OrdenRepository.ts:1126` | 2 de 6 (satélite y dialectos) | **MUERTA** |
| F | no empujar la condición en `condicionesSatelite` (el satélite deja de filtrar) | `OrdenRepository.ts:1183-1185` | 2 de 6 | **MUERTA** |

La D es la que importa para el riesgo de divergencia: **rompiendo un solo dialecto**, el test «los
dos dialectos del criterio dicen lo mismo» se pone rojo. No es una aserción contra su propia
fuente: un lado sale de `OrdenService.listar()` (API de modelo de Prisma) y el otro de
`RecepcionSateliteService.listarOrdenesBodegaCompleto()` (`$queryRaw`), sobre **las mismas cuatro
filas** de la zona satélite, y el test afirma la no-vacuidad (4 / 2 / 2) **antes** de comparar los
conjuntos.

### Las tres consultas del satélite y la descarga

| # | Mutación aplicada | Qué cayó | Resultado |
|---|---|---|---|
| G | la **vigencia de la selección** se queda sin el filtro (`findIdsVigentesEnBodega`) | 1 de 6: el bloque (d), «preguntando por las cuatro solo siguen vigentes las dos nuevas» | **MUERTA** |
| H | el filtro llega a `listar` pero **no** a `listarCompleto` | 1 de 6: «la DESCARGA devuelve exactamente lo mismo que la pantalla» | **MUERTA** |

Las tres consultas del satélite (`findRecepcionSatelitePaginada:3503`,
`findRecepcionSateliteCompleta:3553`, `findIdsVigentesEnBodega:3587`) pasan **todas** por
`condicionesSatelite`, y los tres métodos de servicio por `filtroDeRepo`
(`RecepcionSateliteService.ts:112`). La tercera —la que decide sobre qué filas se puede ACTUAR—
está cubierta por partida doble: estructuralmente en
`tests/unit/services/recepcion-satelite-salida-reparto.test.ts:63` (las tres, por nombre, con
no-vacuidad explícita) y contra Postgres en el bloque (d) del archivo de integración.

En `/ordenes` **no existe** una consulta equivalente de vigencia de selección: el listado central
selecciona sobre los DTO de la página visible (`OrdenesListado.tsx:384-454`), así que no hay una
tercera superficie que se haya quedado fuera. Verificado por búsqueda, no supuesto.

### El borde y la UI

| # | Mutación aplicada | Dónde | Qué cayó | Resultado |
|---|---|---|---|---|
| I | la etiqueta vuelve a decir «Intentos previos» | `ordenes-filtros-def.ts:120` | 1 | **MUERTA** |
| J | las opciones vuelven a «Con/Sin intentos previos» | `ordenes-filtros-def.ts:122-125` | 1 | **MUERTA** |
| K | el valor viaja como **lista** en vez de escalar | `seleccion-a-filter.ts:78` | 3 | **MUERTA** |
| L | el centinela «Todas» viaja al servidor | `seleccion-a-filter.ts:73-79` | 5 | **MUERTA** |
| M | el control se declara por defecto (`?? false` pasa a `?? true`) | `ordenes-filtros-def.ts:301` | 5 | **MUERTA** |

---

## Recorrido punto por punto del encargo

### 1. El predicado es el correcto y no se puede falsear — **OK**

`criterioSalidaAReparto` (`lib/repositories/OrdenRepository.ts:1109`) usa `some` / **`none`**, y
`condicionSalidaAReparto` (`:1118`) `EXISTS` / **`NOT EXISTS`**. La confusión con `every` no está
solo comentada: hay un caso de test cuya única razón de existir es matarla —una orden con **cero**
filas de historial, con la premisa afirmada por conteo (`ordenHistorialEstado.count(...)` es 0) y
no supuesta— y las mutaciones A y B lo confirman en rojo.

El índice que sostiene el `EXISTS` existe y es el declarado en el plan:
`@@index([ordenId, estatusDestinoId])`, `db/schema.prisma:2140`. **Sin migración**, como exigía el
contrato.

### 2. Las dos rutas no pueden divergir — **OK**

El test de los dos dialectos existe, ejercita de verdad los dos motores de SQL y muere con una
mutación en cualquiera de los dos lados (mutaciones D y E). No es una tautología. El razonamiento
de por qué son dos expresiones y no una está escrito en el propio módulo (`:1080-1096`) y es
correcto: el `where` de Prisma es un objeto y el del satélite un `Prisma.Sql`, y unificarlos
exigiría un traductor entero. Lo que sí se comparte —constante del estado, tipo `SalioAReparto`,
vocabulario público— se comparte de hecho.

### 3. Los tests miden — **OK**, buscando las cicatrices de este repo una por una

- **El `if (!datos) return;`**: no aparece. El sembrado hace lo contrario: `sembrar()` lanza
  `Error("la base local no tiene catalogos ...")`
  (`tests/integration/db/salida-a-reparto-sql-real.test.ts:135-137`) y `estatus()` lanza si falta
  un valor del catálogo. Un catálogo incompleto sale **rojo**, no `passed`.
- **Aserción contra su propia fuente**: la única sombra son
  `tests/unit/components/salida-a-reparto-filtro.test.ts:132` y `:223`, que comparan contra las
  constantes de etiqueta. Son **redundantes, no vacías**: las mismas etiquetas quedan clavadas como
  **literales** en `:125-130` («Salida a reparto», «Todas», «Ya salió», «Nunca ha salido»), y las
  mutaciones I y J lo prueban.
- **El `toEqual` literal: contrato o polizón.** Comprobé el argumento del autor en los dos censos,
  no lo acepté:
  - `tests/unit/types/orden-filter-144.test.ts:31` es **el contrato**: enumera
    `ORDEN_FILTER_FIELDS` entero para que ampliarlo sea una decisión explícita. Añadir
    `salio_a_reparto` es la actualización que corresponde, y el archivo **gana** dos casos nuevos
    (dominio cerrado y ausencia sin huella) en vez de solo mover el censo.
  - `tests/unit/components/filtros-acotados-por-rol.test.ts:104` también es censo, y la
    actualización es correcta **y además refuerza**: el caso del `adminTienda` pasa ahora
    `incluirSalioAReparto: false` de forma **explícita** (para medir la puerta y no el valor por
    defecto) y añade un `not.toContain`. La mutación M —poner el valor por defecto en `true`— lo
    pone rojo, así que el censo sigue mordiendo.
  - `tests/unit/components/ordenes-filtros-def.test.ts:250` sube de 9 a 11 porque ahora pide
    también las dos claves opcionales; el cambio va acompañado de una aserción nueva (el control
    conserva sus 3 opciones con el catálogo vacío, porque no salen del catálogo).
- **El `WHERE` probado solo con dobles**: no ocurre. El corte se ejercita contra Postgres real y lo
  verifiqué corriendo el archivo y matándolo con 8 mutaciones. Los dos archivos que sí usan dobles
  (`orden-service-filtros`, `recepcion-satelite-salida-reparto`) **declaran en su cabecera** que no
  miran el SQL y remiten al de integración.

### 4. Las TRES consultas del satélite — **OK** (ver la tabla de arriba, mutación G)

### 5. La pantalla y el archivo dicen lo mismo — **OK** (mutación H)

`construirWhere` es compartido, así que el filtro llega solo; pero el plan exigía **probarlo**, y
está probado con los tres valores (sin filtro / `nunca_salio` / `ya_salio`) y con no-vacuidad
(5 / 3 / 2) antes del `toEqual`.

### 6. El borde — **OK**

- **Escalar**: `seleccion-a-filter.ts:73-79` baja de lista a escalar; probado contra
  `listarOrdenesSchema` de verdad, no contra una copia de las reglas
  (`salida-a-reparto-filtro.test.ts:153-155`). La mutación K lo mata.
- **El centinela «Todas» omite la clave**: sí, y con las dos mitades cubiertas (la traducción y la
  siembra desde la URL). La mutación L lo mata.
- **Un solo dominio de valores**: las opciones se derivan de `SALIO_A_REPARTO_VALORES`
  (`lib/types/orden.ts:230`), la misma constante que cierra el `z.enum` del borde (`:232`) y de la
  que come también el schema del satélite vía `ordenFilterBase.pick({ salio_a_reparto: true })`
  (`lib/types/recepcion-satelite.ts:75`). El centinela «todas» **no** es un segundo dominio: no
  viaja nunca, y hay un test que vigila que no colisione con ninguno de los dos valores del
  contrato (`salida-a-reparto-filtro.test.ts:113`).

### 7. La puerta de rol — **OK**

`app/(app)/ordenes/page.tsx:139` calca la de «Reasignables» (`rol !== RolValue.adminTienda`), y en
esa página el `mensajero` y el `adminSatelite` ya caen antes por `notFound()` (`:55`), así que el
control lo reciben exactamente `maestro` y `admin`. La barra del satélite lo enciende a propósito
(`satelite-ordenes-filtros.ts:147`), que es donde está el grueso del valor. Ninguna otra superficie
lo gana: `OrdenesListado` tiene un solo consumidor y la prop nace en `false`.

Un detalle bien resuelto: `incluirFiltroSalioAReparto` está en las **dependencias del `useMemo`**
(`OrdenesListado.tsx:843`), con un test que lo vigila haciendo `rerender`. Es el fallo mudo clásico
de este repo y aquí está tapado.

### 8. La desviación deliberada del plan (etiquetas sin «intento») — **bien ejecutada, a medio documentar**

La ejecución es correcta y está **blindada por test**: `salida-a-reparto-filtro.test.ts:119-138`
clava los cuatro literales y además recorre todos los textos exigiendo que ninguno contenga
«intento». Las mutaciones I y J lo confirman. El porqué está escrito en los dos sitios donde
alguien lo va a leer al tocarlo: `lib/types/orden.ts:203-217` y
`app/(app)/ordenes/_components/ordenes-filtros-def.ts:107-119`, con el número medido (76 órdenes
con «Intentos» en 0 que sí salieron).

Lo que falta es lo de fuera del código: ver los hallazgos **M2** y **M3**.

### 9. Alcance — **OK**

`git diff --name-only origin/dev...HEAD` no toca `db/`, ni `ordenes-columns.tsx` /
`recibidas-columns.tsx` (la columna «Intentos»), ni el predicado de `reasignables`. Cero
migraciones, cero `down.sql`, cero cambios de esquema. Los 22 archivos son todos de la ficha.

---

## Recorrido de `CHECKPOINTS.md`

| Bloque | Estado |
|---|---|
| Especificación (`specs/<f>/requirements + design + tasks`) | **No aplica.** `sdd: false` declarado a propósito en la ficha; el plan aprobado es el contrato, y trae criterio medido, puntos de enganche, casos de test y tabla de mutaciones exigidas. |
| Trazabilidad: `R<n>` a test | Sin `R<n>` que mapear. La correspondencia contrato-test la doy en la tabla de arriba: **los 6 casos y las 4 mutaciones que el plan exigía están todos cubiertos**, más 9 mutaciones extra que añadí yo. |
| Trazabilidad: `progress/impl_<feature>.md` | **FALTA** → hallazgo **M1** |
| `pnpm run typecheck` | OK, limpio (corrido) |
| `pnpm run lint` | OK, limpio sobre los archivos tocados (corrido) |
| `pnpm test` | OK: los archivos de la ficha, corridos por mí; el `./init.sh` completo consta verde en dos tandas |
| E2E de flujo crítico | **No aplica**: no toca auth, pagos, recaudo, ingesta ni webhooks; es una lectura. Y este repo no tiene harness E2E operativo. |
| RLS en tablas nuevas | **No aplica**: sin tablas nuevas |
| Migraciones versionadas con `down.sql` | **No aplica**: sin migración (verificado sobre el diff, no supuesto) |
| Secretos hardcodeados | OK, ninguno |
| Webhooks (firma / idempotencia) | **No aplica** |
| Controller sin queries ni lógica | OK: la página solo decide qué se OFRECE; el alcance lo impone el servicio |
| Service sin HTTP | OK |
| Repository sin lógica de negocio | OK: recibe el modo ya traducido y solo emite el predicado |
| Interfaces en `lib/interfaces/` por categoría | OK: `SalioAReparto` en `IOrdenRepository.ts:251`; el valor público en `lib/types/orden.ts` |
| Páginas protegidas validan permisos server-side | OK: `app/(app)/ordenes/page.tsx:55` |
| Componentes `private/` por props | OK |
| Mutaciones por Server Actions | **No aplica** (solo lectura) |
| Sin hardcode de país, moneda ni cuenta | OK |
| `./init.sh` en verde | OK: consta `INIT_EXIT=0` dos veces (no lo corrí yo, por instrucción). Nota: el diff toca `lib/types/`, o sea **cimientos**, así que el modo rápido no habría bastado; el completo era obligatorio y se hizo. |
| `progress/review_<feature>.md` con veredicto OK | OK: este archivo |
| Entrada en `progress/history.md` | Pendiente al cerrar y mergear (hoy no hay entrada de la 370) |

---

## Hallazgos

### M1 · `menor` — falta `progress/impl_370.md`

`CHECKPOINTS.md`, bloque «Trazabilidad», lo exige, y las fichas **360, 362, 363, 364, 365, 366 y
368 lo tienen**. Aquí no existe (ni siquiera sin seguimiento: `git status` solo muestra
`design-etiquetas/`).

Consecuencia concreta: las mediciones que sostienen la ficha —qué mutaciones se probaron, qué
números salieron en pantalla con el filtro puesto (el plan pedía **2 y 19** en la central y
**44 y 4** en satélite), qué se decidió y por qué— viven solo en el chat y en los comentarios del
código. Este repo ya perdió tres veces el informe del reviewer por no quedar en disco; el del
implementer corre el mismo riesgo.

**Qué falta para cumplirlo:** un `progress/impl_370.md` con el mapa criterio-test, la tabla de
mutaciones medidas y los conteos de pantalla, si es que se comprobaron.

### M2 · `menor` — la `status_note` de la ficha contradice la UI entregada

La `status_note` de la ficha 370 en `feature_list.json` sigue diciendo que una orden puede salir
en «con intentos previos» mientras la columna «Intentos» marca 0, y que **hay que explicarlo en el
filtro**. Ese vocabulario es el **anterior** a la desviación: la UI entregada dice «Salida a
reparto» / «Ya salió» / «Nunca ha salido», y ningún texto dice «intento».

La desviación está documentada de forma ejemplar **dentro del código**
(`lib/types/orden.ts:203-217`, `ordenes-filtros-def.ts:107-119`) y clavada por test, pero **no** en
el registro que el humano lee, que es la ficha. Quien abra `feature_list.json` dentro de tres meses
concluirá que la implementación se desvió sin avisar.

**Qué falta:** una línea en la `status_note` que registre el cambio de etiqueta y su motivo (la
colisión con la columna «Intentos», que cuenta otra cosa).

### M3 · `menor` — la mitigación que el plan pedía en la UI no se entregó, y hoy no es entregable

El plan, en «Riesgos», exigía explicar el desajuste **en el texto de ayuda del filtro**. No hay tal
texto. Y no es un olvido barato de arreglar: `FilterDef`
(`components/shared/FilterComponent.tsx:51-78`) **no tiene campo de ayuda ni de tooltip** —solo
`label`, `placeholder`, `searchPlaceholder` y `emptyMessage`—, así que añadirlo significaría
ampliar el componente genérico que comparten todas las barras del sistema.

El renombrado ataca la **causa** del riesgo (ya no hay dos textos que digan cosas distintas sobre
lo mismo) y es una respuesta mejor que un cartel explicativo. Pero el residuo sigue existiendo: un
operador que filtre «Ya salió» verá filas con la columna «Intentos» en 0 y no tiene dónde leer por
qué. Lo dejo en `menor` y no en bloqueante porque el riesgo pasó de «contradicción declarada» a
«dos columnas que miden cosas distintas», que es un grado menos de daño.

**Qué falta para cerrarlo del todo:** decidir explícitamente si el residuo se acepta —y anotarlo—
o si se abre ficha para dar ayuda contextual a `FilterComponent`.

### M4 · `menor` — la puerta de rol de la página no la cubre ningún test (deuda preexistente)

Lo que los tests miden es `construirFiltrosOrdenes` **con el flag ya puesto**
(`salida-a-reparto-filtro.test.ts:67-77`, `filtros-acotados-por-rol.test.ts:126-141`). La línea que
de verdad decide, `app/(app)/ordenes/page.tsx:139`, no la toca ningún test: cambiarla por `true`
pasaría el gate en verde. El comentario del propio test lo reconoce.

**No lo introduce esta ficha**: `incluirFiltroReasignables` (`:135`) e `incluirFiltroMensajero`
(`:138`) tienen exactamente el mismo hueco desde antes, y el filtro nuevo solo **acota** —el
acotamiento por rol se escribe **después** en `construirWhere` y pisa lo que el filtro hubiera
puesto—, así que el peor caso de esa mutación es ofrecerle a la tienda un control que no le sirve,
nunca ensancharle el alcance. Se anota por completitud, no como deuda de esta ficha.

---

## Lo que comprobé y salió bien

- **El `none` está donde tiene que estar**, y la trampa que el encargo señalaba (`every` vacuamente
  cierto sobre el conjunto vacío) tiene un caso de test dedicado que **muere** al introducirla, con
  la premisa del caso afirmada por conteo en vez de supuesta.
- **El criterio ingenuo se mide en la misma corrida** en vez de descartarse de palabra: el caso
  estrella ejecuta `gestiones: { some: {} }` sobre las mismas filas y demuestra la discrepancia,
  con no-vacuidad de los dos lados (el conjunto con gestión **no** contiene la cortada sin
  gestionar y **sí** contiene la reprogramada).
- **Aislamiento del test de integración**: todo dentro de `enTransaccionRevertida`, sembrado con
  sufijo aleatorio y zonas propias, así que las aserciones de conjunto (`toEqual(new Set(...))`) no
  dependen del contenido de la base local. Corrí el archivo diez veces (limpio y bajo mutación) sin
  dejar residuo.
- **Los tres `total` se afirman aparte de los `items`**: si el filtro se aplicara a las filas pero
  no al `COUNT`, la paginación mentiría y los `items` no lo delatarían. Cubierto en la central
  (3 y 2) y en el satélite (4, 2 y 2).
- **El caso «asignada y desasignada antes de salir»** —decisión explícita del humano— tiene su fila
  sembrada en las dos bodegas y se afirma en el grupo «nueva».
- **Ausencia igual a no filtrar**, en las cuatro capas y probado en cada una: el schema
  (`orden-filter-144.test.ts:66`), el service (`orden-service-filtros.test.ts`, con
  `Object.hasOwn`), el repositorio del satélite (`recepcion-satelite-salida-reparto.test.ts:87`) y
  Postgres (el caso «sin filtro salen los dos grupos»).
- **La clave no puede pisar ni ser pisada**: va hermana en el `AND`, sobre una relación
  (`historialEstados`) que ningún otro filtro toca, y el acotamiento por rol se sigue escribiendo
  al final. Probado con `reasignables` y con el actor `mensajero`.
- **Traducción pública a repositorio en un solo sitio**
  (`lib/utils/filtros-listado-ordenes.ts:114-124`), compartida por las dos superficies, con un
  `Record` exhaustivo en vez de un `else`: un tercer valor futuro rompería el typecheck en lugar de
  caer en silencio a una rama.
- **Caché del satélite**: el escalar serializa como `salio_a_reparto=ya_salio` en
  `serializarFiltroSatelite`, y «Todas» vuelve a `FILTRO_SATELITE_VACIO` (cadena vacía), así que no
  colisiona con la página que pre-carga el servidor ni la reutiliza mal.
- **`git status` limpio tras las 13 mutaciones**: ningún residuo de la verificación quedó en el
  árbol.

---

*El reviewer no editó código. Las mutaciones se aplicaron y se revirtieron una a una; el árbol
quedó en `cd9eca0e` sin cambios. Este informe queda escrito en disco; lo commitea el humano.*
