# impl — Feature 170, FASE 2, Tanda M (T M.1 y T M.2: cierre de la FASE 2)

> Rama: `feature/170-fase2-tanda-m` · Fecha: 2026-08-01 · Rol: BACKEND_DEV
> Tandas previas: H (#248), I (#249), J (#250), K (#253), L (#255), todas mergeadas en `dev`.
>
> Esta tanda cierra la FASE 2. Entrega tres cosas: el test de no-regresión transversal (T M.1),
> el cierre o la redirección **de cada una** de las preguntas abiertas que las cinco tandas
> anteriores dejaron, y la verificación final con la tabla `R1–R54` completa (T M.2).
>
> La tabla de trazabilidad canónica vive en `progress/impl_170-export-todas-las-tablas.md`
> §F2.1 —que es el `impl_<feature>.md` que `CHECKPOINTS.md` exige—; aquí está el detalle de lo
> que esta tanda hizo y midió.

---

## 0. Baseline medido AL EMPEZAR

```
$ npx tsc --noEmit
=== typecheck exit: 0 ===          (tras `pnpm install`: faltaba `recharts` en el worktree)

$ npx eslint
✖ 27 problems (0 errors, 27 warnings)

$ npx vitest run                   (arbol LIMPIO, medido con `git stash -u`)
 Test Files  3 failed | 768 passed (771)
      Tests  3 failed | 9229 passed (9232)
```

**Ninguno de los tres rojos del baseline es de la 170.** Dos son guardias de las features 122/123
(§13) y el tercero es el flake conocido `OrdenesModuleReuse`, que en la corrida final pasó.

---

## 1. Lo que esta tanda entrega

| # | Qué | Dónde |
| --- | --- | --- |
| 1 | El test transversal de las tres propiedades de la fase | `tests/components/paginacion/paginacion-transversal.test.tsx` (9) |
| 2 | **Q-L2 CERRADA**: nace `listarCuentasPorPagarCompleto` | servicio + repo + schema + Server Action + 3 archivos de test |
| 3 | **Q-J1/Q-I4 cerrada en 2 de 4 compuestos, redirigida en 2** | `app/(app)/cierres-admin/page.tsx` + §5 |
| 4 | Las 14 preguntas abiertas restantes, **cada una** cerrada o dirigida | §6 |
| 5 | La tabla `R1–R54` completa y el censo final | `impl_170-export-todas-las-tablas.md` §F2.1 |
| 6 | Las marcas de `tasks.md` de K, L y M, con su bloque MEDIDO | `specs/170-export-todas-las-tablas/tasks.md` |

---

## 2. T M.1 — el test transversal, y por qué es un CENSO

Las tandas I–L probaron cada listado por dentro. Lo que ninguna podía probar sola es que las
tres propiedades siguen siendo ciertas **en todo el árbol** y que un listado nuevo no pueda
escaparse de ellas. Por eso el archivo no es una batería de casos: es un **registro declarado**,
en el mismo idioma que `censo-tablas.ts` (T0.5) y `contadores-cabecera.guardia.test.ts` (T H.3),
contrastado contra el código **en los dos sentidos**.

**El ancla del censo es `export const PAGINACION_…_LABEL`**, la constante con la que cada listado
nombra su control de navegación (R43). Hay **exactamente trece** en `app/`, una por listado del
Anexo III, y esa igualdad —comprobada en las dos direcciones— es lo que hace que un listado
paginado nuevo no pueda entrar sin registrarse aquí. No se eligió `<Pagination>` a secas porque
ese patrón también lo montan pantallas que ya paginaban antes de la 170 (órdenes, usuarios,
plantillas, API keys, novedades…) y el censo dejaría de significar «el Anexo III».

### 2.1 R53 — los 3 del Anexo IV siguen completos

Por CONDUCTA sobre los tres, con **30 filas**: más que el `DEFAULT_PAGE_SIZE` de los siete
dominios paginados, que es 25 en todos. Si alguien los paginara con la configuración vigente, se
vería — faltarían cinco filas.

- **Ranking del día**: las 30 filas en la tabla, «Mensajero 029» presente y **cero** controles de
  navegación en la pantalla entera.
- **Gestiones del cierre del día (mensajero)**: las 30 dentro de la `region` del grupo, el
  contador de cabecera diciendo `(30)` y ningún control dentro. **Con contraprueba**: la MISMA
  pantalla sí monta el control de su OTRA tabla («Cierres solicitados»), que sí es del Anexo III.
  Sin esa contraprueba, un `queryAllByRole("navigation")` vacío podría significar «la pantalla no
  renderizó».
- **Gestiones de un cierre (detalle del admin)**: las 30, el contador, cero controles, y además
  que la sección con el grupo VACÍO **no se pinta** — que es la otra mitad de lo que paginar
  rompería (con páginas, una sección vacía podría ser sólo «esta página no trae ninguna»).

Y un cuarto caso de censo: los tres están declarados con su **motivo** (>40 caracteres, no un
`""`), los tres existen, los tres proyectan con `filasLocales` (R30: el dataset ya está en el
cliente, releerlo sería una consulta de más) y **ninguno figura también en el Anexo III**.

### 2.2 R54 — y la corrección que esta tanda tuvo que hacer

**La task daba por hecho algo que no es cierto, y medirlo es lo que ha aportado este caso.**

La hipótesis heredada de la tanda I era: con `fallbackData`, la pantalla pinta la página que el
Server Component ya resolvió **sin consultar nada**, o sea las mismas cero consultas por render
que antes de paginar. Se instrumentó, se midió con el contador de la Server Action y salió esto:

```
tras-render: []                                          ← el primer pintado no espera a nadie
tras-espera: [[{"page":1,"pageSize":25}]]                ← SWR revalida la página que YA tiene
tras-click:  [[{"page":1,…}],[{"page":2,…}]]
```

`fallbackData` compra el **primer PINTADO** (las filas del usuario están ahí, sin esqueleto y sin
esperar) pero **no evita la revalidación de entrada**. Cada una de las 13 pantallas hace hoy una
lectura de cliente que antes de paginar no hacía, **además** de la que resuelve el Server
Component. Queda como **Q-M1** (§6), declarada y no maquillada.

Lo que el test afirma, en consecuencia, es lo MEDIDO y no lo supuesto:

1. **estático, sobre los TRECE**: cada listado monta `<Pagination>`, lee con `useSWR` y declara
   `fallbackData`. Sin él, el primer pintado sería un esqueleto y la mutación de la tanda I
   —que **pasó VERDE**— volvería a pasar verde;
2. **el reparto declarado**: el lector es el mismo archivo salvo en UNO —el histórico de cierres
   del día, cuyo módulo padre resuelve las dos páginas de la pantalla—, que es exactamente el
   reparto que Q-I6 dejó escrito. Se declara en vez de aflojar el patrón;
3. **conducta, sobre una muestra de tres** (una por cada forma de cablear la página en este repo:
   control en el módulo con dos tablas · control junto a su tabla · control con búsqueda de
   servidor): el primer pintado no espera al servidor, la revalidación de entrada es **UNA** y de
   la **página 1**, y cambiar de página cuesta **exactamente una** lectura más, de la página 2.
   Ni cero (no navegaría) ni dos.

**El `dedupingInterval` se deja en su valor por defecto**, a diferencia del resto de la suite. Es
deliberado y es el punto del archivo: R54 habla de cuántas consultas cuesta un render, y el
deduplicado de SWR es parte de lo que hace que ese número sea el que es en producción. Con
`dedupingInterval: 0` un re-render de React dispara una lectura idéntica más y el test mediría el
arnés en vez de la pantalla (medido: con 0, la cola de cierres marcaba 2 donde debía marcar 1).

**La bodega satélite (K) se queda fuera de la parte de conducta** y está declarado: su módulo pide
siete props de dominio y su comportamiento lo mide `SatelitePaginacion.test.tsx` fila a fila. La
parte estática de este archivo sí la cubre, como a los trece.

### 2.3 R52 — la descarga entrega el conjunto

Estático sobre los trece, con el **adaptador declarado por listado**:

- `conjunto` (12): relee el listado SIN recorte con `filasDelConjuntoCompleto`;
- `completo` (1): tiene su `listarXCompleto` propio y usa `filasDesdeResultado`, con el tope
  aplicado en el servidor (R29). Es «Cuentas por pagar», y es lo que esta tanda cerró.

Y **ninguno** puede usar `filasLocales(loQueLaTablaPinta)`, con **una excepción declarada**:
`CierreDiaModule` hospeda las dos cosas —un listado del Anexo III y uno del Anexo IV—, y ahí
`filasLocales` es CORRECTO. Se declara en un `Set` con su razón en vez de aflojar el patrón para
los trece.

El reparto 12/1 se afirma como número: si una tanda futura cierra Q-I5, ese número sube y hay que
venir a decirlo aquí. Es la forma de que la deuda se vea en vez de olvidarse.

Más la CONDUCTA sobre la muestra: descargar **desde la página 2** entrega 60 filas con la tabla
enseñando 25. Los dos números son distintos a propósito.

### 2.4 Verificado por MUTACIÓN (5), todas revertidas

| # | Mutación | Resultado |
| --- | --- | --- |
| 1 | `RankingModule` pinta `ranking.slice(0, 25)` | **1 rojo** (R53, el ranking) |
| 2 | `SaldosTiendasTable` sin `fallbackData` | **3 rojos** (el estático de R54, la conducta y el de R52) |
| 3 | La descarga de cuentas por pagar proyecta `data?.items` con `filasLocales` | **2 rojos** (R52 estático y conducta) |
| 4 | `PAGINACION_INCIDENTES_LABEL` deja de exportarse | **1 rojo** (el censo, en los dos sentidos) |
| 5 | `CierresBodegaResueltosTabla`: `filasDelConjuntoCompleto` → `filasLocales` | **1 rojo** (R52 estático) |

La #2 es la que más dice: quitar el `fallbackData` de UNA pantalla rompe tres afirmaciones
distintas, incluida la de la descarga. Y la #4 demuestra que el censo no es prosa.

---

## 3. Q-L2 CERRADA — nace `listarCuentasPorPagarCompleto`

**Qué había.** T L.2 dejó la descarga releyendo `listarCuentasPorPagarAction()` —el listado
ENTERO, sin búsqueda— y volviendo a filtrarlo **en el navegador** con las funciones de
`lib/utils/`. Funcionaba y no era una regresión (es literalmente lo que la pantalla hacía antes de
paginar), pero dejaba tres cosas escritas que esta feature existe para evitar:

1. el conjunto completo cruzando al cliente para descartar la mayor parte;
2. el criterio de búsqueda con **dos implementaciones vivas**, en dos capas (R45 se cumplía por
   coincidencia, no por construcción);
3. el tope de 5000 aplicado **después** de que las filas viajaran, cuando R29 dice que el tope es
   del servidor y que por encima no se materializa ni se transporta de más.

**Qué se entrega.** Cinco piezas, ninguna nueva en su forma —todas copian el par
`listar`/`listarCompleto` que T H.2 dejó escrito como las DOS lecturas de un listado—:

| Capa | Qué |
| --- | --- |
| Repositorio | `listarCuentasPorPagarCompleto(filtro)`: el conjunto filtrado y ordenado, entero. **`listarCuentasPorPagarPaginado` pasa a ser un `slice` de él**, así que hay UNA sola lista y no dos que deban coincidir. |
| Servicio | `listarCuentasPorPagarCompleto(input, actor)`: guard `esAccesoTotal` ANTES del repositorio, el MISMO `aResumen` que la página (es dinero) y el tope evaluado aquí (R26/R27/R28). |
| Tipos | `listarCuentasPorPagarCompletoSchema` = el schema de la página **menos `page`/`pageSize`**, `.strict()`. Derivado, para que los dos caminos no entiendan cosas distintas por «búsqueda». |
| Borde | `listarCuentasPorPagarCompletoAction`, calcado del de su página. |
| Pantalla | `obtenerFilas` pasa de `filasDelConjuntoCompleto(relee + filtra aquí)` a `filasDesdeResultado(listarCuentasPorPagarCompletoAction({ busqueda }))`. La pantalla deja de importar `filtrarPorBusquedaMensajero` y `ordenarCuentasPorPagar`. |

**Lo que NO cambia, y es lo que hace que sea seguro:** el conjunto. La batería de **25 textos** de
T L.1 (acentos en los dos sentidos, mayúsculas, `%` y `_` de SQL, espacios interiores, sin
resultados) se vuelve a correr entera **contra el modo completo**, comparándola una a una con la
búsqueda de cliente copiada literal del componente. Mismo conjunto, mismo total, en los 25.

**El tope, medido en el borde exacto:** con 5001 filas devuelve `limite_excedido` con el total y el
tope y **ninguna fila**; con 5000 las entrega todas. Y mira el conjunto **FILTRADO**: con una
búsqueda que deja una fila, el archivo sale aunque el conjunto sin filtrar supere el tope.

**Dónde se prueba.** En las tres capas, y la de repositorio no sobra (§4):

- `tests/unit/services/wallet-cuentas-paginado.test.ts` — +7 casos.
- `tests/unit/actions/wallet-mensajero-actions.test.ts` — +5 casos de borde, incluido que
  `page`/`pageSize` **no** pertenecen a la lista blanca del dataset completo.
- `tests/unit/repositories/cuentas-por-pagar-paginado-where.test.ts` — +3 casos: que la agregación
  del archivo es **la misma consulta** que la de la página (sin `where`, `take` ni `skip`), que
  descargar cuesta las mismas dos consultas que leer la página, y que **la página es un prefijo
  EXACTO del conjunto** para el mismo texto — que es la propiedad que hace que la fila 26 esté en
  la página 2 y en el archivo.

---

## 4. El hallazgo transversal: una PROPIEDAD de esta suite

En **cuatro tandas seguidas** una mutación del `WHERE` sobrevivió a los tests de servicio y
**solo la detuvo el test de repositorio**. Está medido, tanda a tanda, en las cinco bitácoras:

| Tanda | Mutaciones del `WHERE`/SQL que pasaron VERDE en servicio | Quién las detuvo |
| --- | --- | --- |
| I | 1 (`notIn` → `in` en el repositorio del histórico) | `tests/unit/repositories/historicos-paginados-where.test.ts` — **nació de esa mutación** |
| J | 2 | `tests/unit/repositories/colas-paginadas-where.test.ts` |
| K | 3 (las del `Prisma.sql` con `array_position`) | `tests/unit/repositories/satelite-paginado-where.test.ts` |
| L | 1+ | `tests/unit/repositories/cuentas-por-pagar-paginado-where.test.ts` |

**Son 7+ mutaciones medidas, no una impresión.** Y la causa es estructural, no un descuido: los
tests de servicio usan **dobles** del repositorio, así que ven el resultado del `WHERE` pero no su
**traducción a SQL**. Un doble que devuelve las filas correctas sigue devolviéndolas correctas
aunque el `where` que se le pasó esté vacío, invertido o sin el acotamiento por zona — porque el
doble no lo ejecuta. El acotamiento por rol vive precisamente ahí.

**La respuesta que el repo encontró son esos cuatro archivos `*-where.test.ts`**, y conviene
nombrar la forma para que la siguiente feature la copie en vez de redescubrirla:

- reciben un **delegado Prisma falso** (`groupBy`/`findMany`/`$queryRaw` espiados) y afirman sobre
  los **ARGUMENTOS** de la consulta, no sobre su resultado;
- afirman también **cuántas** consultas se hacen, que es como R54 se vuelve comprobable;
- y afirman lo que el `WHERE` **no** lleva (`expect(args.where).toBeUndefined()`), que es la mitad
  que un test de resultado nunca puede ver.

Es más valioso que cualquier número de cobertura: la cobertura habría dicho «100 %» en las siete
mutaciones, porque la línea del `WHERE` se ejecutaba en todas.

**La tanda M extiende la propiedad a lo que entrega:** los 3 casos nuevos del modo completo de
cuentas por pagar viven en el archivo `*-where.test.ts`, no sólo en el de servicio, aunque su
prueba de servicio ya pasara.

---

## 5. Q-J1 / Q-I4 — cerrada en 2 de 4, redirigida en 2, con la medición

La pregunta era: **retirar del render los arrays de los listados compuestos, que ya no tienen
lector de tabla**. Se miró compuesto por compuesto, no en bloque.

Primero, lo que **ya estaba hecho** y conviene no volver a contar como deuda: desde T I.2/T J.2/T
K.3 esos arrays **ya no cruzan al cliente**. Las páginas los reciben en el servidor y no los pasan
a los módulos. Lo que quedaba abierto es la **lectura de base** que el compuesto sigue costando
por render.

| Compuesto | Qué le queda al render | Decisión |
| --- | --- | --- |
| `listarCierresBodegaAdmin()` | **Nada.** Sus dos arrays no tienen lector y su `status` no decidía nada que no decidiera ya el `esAccesoTotal(actor.rol)` de la misma línea, que es el MISMO guard que aplican sus dos listados paginados. | **CERRADA**: sale del render. Es una lectura de TODOS los cierres de bodega por render cuyo único efecto era un `if` redundante. La acción sigue existiendo: de ella sale el conjunto de la descarga (R52), y sólo corre al pulsar el control. |
| `listarConsolidacion()` | Los **cinco agregados de dinero** calculados sobre el conjunto COMPLETO (R49), el gate `puedesSolicitar`/`motivoBloqueo` y `sinZona`. | **CERRADA como «resuelta hasta donde puede»**, que es exactamente el aviso medido de la tanda J: su array **no** puede desaparecer —el dinero se calcula sobre él— pero ya no CRUZA al cliente. Queda anotado en la propia página. |
| `listarCierresAdmin()` | Sólo `sinZona`. | **REDIRIGIDA** (abajo). |
| `listarIncidentes()` | Sólo `sinZona`. | **REDIRIGIDA** (abajo). |

### Por qué los dos últimos NO se cierran aquí, con su razón

`sinZona` es `true` sólo para un `adminSatelite` sin zona asignada; para los roles de acceso total
es `false` **sin consultar nada**. Sacarlo del compuesto tiene exactamente dos salidas, y las dos
son decisiones que ninguna task ha tomado:

1. **ensanchar el contrato de T H.2** para que la página de la cola devuelva `sinZona` (coste real:
   **cero consultas** — el servicio ya lo calcula en `resolveAlcance` y hoy lo tira). Es la más
   barata, y es precisamente la que T I.1 §6.1 **rechazó por escrito**: «el contrato no gana
   campos… son cuatro campos y el aviso de "no tenés zona" es de la pantalla». Reabrirlo en la
   tanda de cierre, sin que nadie lo pida, sería deshacer una decisión declarada;
2. **una Server Action dedicada** por dominio (`findUsuarioZonaId`, una lectura indexada de una
   fila, frente al escaneo del compuesto). Es superficie pública nueva que ninguna task declara, y
   la regla del repo es no inventarla.

**El precio de dejarlo, medido:** `/cierres-admin` y `/incidentes` hacen **una** consulta de más
por render cada una —el compuesto entero de su dominio— para leer un booleano. No crece con el
tráfico ni con el tiempo, pero sí con el histórico del dominio, que es lo peor de las dos cosas.

**Dirigida a:** el LEADER, para que elija entre (1) y (2) —es una decisión de contrato, no de
implementación— y la registre como ticket propio. Con la elección hecha, el trabajo es de una
tarde y toca dos servicios y dos páginas.

`listarRecepcionSatelite()` **no entra en esta pregunta**: lo que el render le sigue pidiendo es
«Por recibir», el nombre de zona y `sinZona`, o sea datos de pantalla y no un array sin lector.
Eso es **Q-K6**, que sigue abierta con su propia razón (§6).

---

## 6. Estado de CADA pregunta abierta

Ninguna queda huérfana. Las que se redirigen llevan destinatario y razón.

### Cerradas en esta tanda (4)

| # | Qué era | Cómo queda |
| --- | --- | --- |
| **Q-L2** | Falta `listarCuentasPorPagarCompleto`; la descarga relee el listado entero y filtra en el cliente. | **CERRADA.** §3. Existe el método en las tres capas, la pantalla lo usa, la búsqueda deja de tener dos implementaciones y el tope pasa al servidor. |
| **Q-J1 / Q-I4** | Retirar del render los arrays de los compuestos. | **CERRADA en 2 de 4** (`listarCierresBodegaAdmin` sale del render; `listarConsolidacion` queda con el aviso medido de la tanda J). **Los otros 2, dirigidos al LEADER** con las dos salidas y el precio medido. §5. |
| **Q-K5** | Los arrays de `listarRecepcionSatelite()` cruzan enteros al cliente. | **CERRADA.** T K.3 ya los dejó en el servidor; lo que sigue cruzando es «Por recibir» (otra sección, no pagina) y el conjunto al pulsar «Descargar» — que es Q-K4, no ésta. |
| **Q1** (spec) | ¿Se acepta el Anexo IV? | **CERRADA de hecho por la entrega**: los tres se entregan sin paginar, con su motivo escrito, y T M.1 lo vigila. Si el humano la rechaza, el test dice exactamente qué hay que cambiar. |

### Dirigidas, con destinatario y razón (13)

| # | Qué es | A quién / por qué no aquí |
| --- | --- | --- |
| **Q-I5** + **Q-K4** | Doce de los trece listados descargan **releyendo su listado sin recorte**; tres de esas relecturas son caras (`listarCierreDia` firma las URL de evidencia del día, `listarConsolidacion` agrega la zona, `listarRecepcionSatelite` trae los cinco grupos). Cerrarlas es darles un `listarXCompleto` como el de Q-L2. | **A una TANDA PROPIA (N) de backend.** Son **8 métodos de servicio + 8 de repositorio + 8 schemas + 8 actions + sus tests**, uno de ellos sobre el camino del dinero (consolidación). No es una task de cierre: es una tanda del tamaño de la I. Lo que esta tanda deja hecho es el **molde medido** (§3) y el contador de deuda visible en el test (12 vs 1). |
| **Q-I1** + **Q-L1** | «Saldos de tiendas» y «Cuentas por pagar» recortan la página **fuera de la base**: correcto y sin consultas nuevas, pero sin reducción de trabajo en Postgres. | **AL HUMANO.** No es una decisión técnica: la alternativa (`$queryRaw` con `GROUP BY … LIMIT/OFFSET`) **cambia lo que el usuario ve** —`ILIKE` haría de `%` y `_` comodines, y la batería de 25 textos de T L.1 dice exactamente qué casos cambiarían—. Y hoy **no es verificable** con la suite: exige sembrar en un Postgres real. Si se quiere, viene con una vía para probarla. |
| **Q-I2** + **Q-L3** | El orden alfabético que se impuso a esos dos listados es una **DESVIACIÓN visible de R51**. | **AL HUMANO**, las dos juntas: si rechaza una debería rechazar las dos. Es la mínima que hace la paginación correcta (sin orden total, dos páginas se solapan y una fila se cae entre ellas — y aquí la fila es dinero que alguien tiene que liquidar). |
| **Q-I6** | La guardia de T H.3 mira hacia ABAJO, nunca hacia arriba: un contador del padre queda fuera de su vista si el listado está en un hijo. | **CERRADA POR CONSTRUCCIÓN en la tanda J** (las cuatro colas montan su control EN el módulo, para que la guardia las vea) y **ahora también vigilada por T M.1**, que declara el ÚNICO caso donde el lector está en otro archivo y falla si aparece un segundo. Queda como pregunta sólo para quien añada un listado nuevo: debe elegir dónde monta el control. |
| **Q-J2** | Los agregados de consolidación leen el conjunto entero desde Postgres. | **NO SE TOCA, y es la decisión correcta.** `repartirEfectivo` necesita todos los pagos individuales; el conjunto está acotado por los mensajeros de UNA zona con cierre aprobado sin consolidar, no crece con el tiempo. Optimizarlo sin pedido, sobre el camino del dinero, es exactamente lo que no se hace en una tanda de cierre. |
| **Q-J3** | Nueve schemas de página siguen escritos a mano (`api-key`, `cierre`, `gasto-fijo-plantilla`, `orden`, `plantilla-mensaje`, `tarifa`, `usuario`, `wallet-tienda`, `zona`). | **A un chore de higiene, fuera de la 170.** Son bordes de listados que YA paginaban antes de esta feature: ninguno es del Anexo III y ninguno cambió aquí. Algunos (órdenes) llevan filtros y no encajan tal cual en `paginaInputSchema`. |
| **Q-J4** | La forma `{ items, total, pageSize }` está declarada trece veces en `app/`, una por módulo. | **A un chore de UI, fuera de la 170.** Es un refactor transversal de tipos de pantalla que ninguna task pidió. Ojo: **no** es `PaginaListado<T>` de T H.2 —esa lleva además `page`, que la pantalla no necesita—. |
| **Q-K1** | El filtro de la bodega compara nombres EXACTOS; el cliente comparaba normalizado. | **SIN ACCIÓN, con su razón medida**: coinciden para todo valor que el desplegable puede ofrecer y el catálogo sembrado no tiene colisiones (vigilado por test). La vía para cerrarlo existe y está probada (la columna generada de la 169), pero sería maquinaria para un caso que hoy no existe. |
| **Q-K2** | El SQL crudo de la satélite no tiene test de integración contra Postgres. | **A `tests/integration/db/` cuando alguien retome esa carpeta.** Se verificó a mano contra la base local (K §4.1) y se vigila por unit test sobre el `Prisma.Sql`. **Deliberadamente NO se hizo aquí**: exige sembrar órdenes reales en una transacción revertida, que es una task en sí misma, y esta tanda no puede dejar la suite dependiendo de una base. |
| **Q-K6** | El Server Component de la satélite hace TRES lecturas del dominio por render. | **A la misma TANDA N que Q-I5/Q-K4**, porque la salida es la misma clase de trabajo: o «Por recibir» sale de su propia acción acotada, o `listarRecepcionSatelite()` deja de devolver los cinco grupos. R54 se cumple en el LISTADO (2+1 consultas, K §8); lo que lee de más es la PANTALLA. |
| **Q-K7** | La selección de la bodega no se avisa al cambiar de página. | **AL HUMANO, si lo ve en uso.** Con `pageSize` 25 y una bodega de 60 el caso es raro; la solución es una línea de texto en una barra que ya avisa de dos cosas, y añadirla sin pedido puede estorbar más que ayudar. |
| **Q-L4** | La búsqueda de cuentas por pagar no ignora acentos: «jose» no encuentra a «José Pérez». | **AL HUMANO.** Es un defecto **preexistente** que la paginación hace más visible (antes la fila seguía a la vista más abajo; ahora puede estar en otra página). R45 pedía conservar el conjunto, así que cambiarlo aquí habría sido violar el requisito que la tanda tenía que cumplir. La vía existe (169) y la mutación 1 de L §7 dice qué test habría que cambiar. |
| **Q-L5** + **Q-L7** | La espera de la búsqueda (debounce) y el contador que no dice «de cuántos» sin búsqueda. | **AL HUMANO, en la verificación en pantalla de Q4.** Las dos son de una línea y las dos cambian lo que el operador percibe; ninguna se toca sin que alguien la use. |
| **Q-L6** | `DESGLOSE_PAGE_SIZE = 20` sigue siendo un literal en los dos desgloses de wallet. | **SIN ACCIÓN, con la razón de T L.1 §2**: ese tamaño es el del DESGLOSE de una fila, no el del listado del Anexo III, y colgarlo de `walletMensajeroConfig` ataría dos cosas que crecen por motivos distintos. Si se quiere config, es un dominio propio y es un chore aparte. Misma familia: `PAGE_SIZE = 100` en `TiendasModule`/`ZonasTarifasModule` (deuda preexistente declarada en T H.1). |

### Nuevas de esta tanda (2)

**Q-M1 — La revalidación de entrada de SWR: R54 se cumple en el servidor, no en el navegador.**
Medido en §2.2. Cada una de las 13 pantallas paginadas hace, al montar, **una lectura de cliente de
la página que el Server Component ya resolvió**. Antes de paginar eran cero (la pantalla recibía su
array por props). La salida es `revalidateIfStale: false` (o `revalidateOnMount: false`) en el
`useSWR` cuando el `fallbackData` aplica, pero **no se hizo aquí y por una razón concreta**: esa
revalidación es hoy lo único que refresca la tabla después de un `router.refresh()`, porque SWR
conserva su caché y no vuelve a mirar el `fallbackData` nuevo. Apagarla sin resolver eso deja la
pantalla mostrando datos viejos después de aprobar un cierre — que es peor que una consulta de
más. **Dirigida al LEADER** para que decida si entra en la tanda N (junto a Q-I5/Q-K4, que toca los
mismos trece módulos) o como ticket propio.

**Q-M2 — `./init.sh` no llega a `== init OK ==` por un rojo AJENO y PREEXISTENTE.** §13. No es de
la 170 y no lo puede cerrar esta tanda sin tomar una decisión de otra feature. **Dirigida al
LEADER**, con el remedio exacto escrito.

---

## 7. Deudas heredadas que NO son preguntas

**D5.2** (backend, una línea, declarada desde la FASE 1) sigue abierta tal cual. No se tocó: no es
de la FASE 2 y su bitácora ya la describe.

---

## 8. Censo final de la feature

| Concepto | Nº | Dónde se vigila |
| --- | --- | --- |
| Tablas del árbol | **31** | `tests/unit/descarga/censo-tablas.ts` (30 `<DataTable>` + 1 `<table>` cruda) |
| **DENTRO del export (Anexo I)** | **25** | `cobertura-tablas.guardia.test.ts`, instancia a instancia y en los dos sentidos |
| FUERA del export (Anexo II) | **6** | ídem, cada una con su motivo |
| **PAGINADOS server-side (Anexo III)** | **13** | `paginacion-transversal.test.tsx`, anclado en las 13 `PAGINACION_…_LABEL` |
| **EXCLUSIONES del Anexo IV** | **3** | ídem, cada una con su motivo y su conducta |
| Instancias de `<DataTable>` | 30, en **29 archivos** | `censo-tablas.ts` (los 4 históricos se mudaron en T I.2) |
| Contadores `({X.length})` vivos | **2** | `contadores-cabecera.guardia.test.ts` (los 2 del Anexo IV; los 4 de las colas murieron en T J.2) |
| Dominios con `DEFAULT/MAX_PAGE_SIZE` | **7** | `tests/unit/config/paginacion-dominios.test.ts` |
| Listados con `listarCompleto` propio | **8** (7 de FASE 1 + 1 de T M.1) | los 12 restantes son Q-I5/Q-K4 |

**Medición de volumen (T G.2, sin cambios):** el archivo del tope —**5000 filas × 15 columnas**,
órdenes, la tabla MÁS ANCHA del rollout— pesa **0,34 MB (359 311 bytes)** y se genera y se relee en
~1 s. El número lo imprime el propio test (`tests/integration/descarga-170-volumen.test.ts`), para
poder recomprobarlo en vez de creerlo. Muy lejos de obligar a bajar `N`.

---

## 9. La tabla `R1 → R54`

Vive en `progress/impl_170-export-todas-las-tablas.md` **§F2.1**, que es el `impl_<feature>.md` que
`CHECKPOINTS.md` exige. **54 de 54 requisitos con al menos un test; cero huecos.**

---

## 10. E2E — declarado INAPLICABLE, con la razón y la cobertura del riesgo

`CHECKPOINTS.md` pide: «Si la feature toca flujos críticos (auth, pagos, recaudo, ingesta de
órdenes, webhooks), hay al menos un test E2E (Playwright) que lo cubre».

**Se declara INAPLICABLE**, por dos motivos y no por uno:

1. **La decisión del humano es «no más e2e, pruebas básicas nada más».** Es una decisión de
   proceso, vigente y anterior a esta tanda.
2. **No existe harness de Playwright en el repo.** No hay `playwright.config`, no hay `tests/e2e/`
   y ninguna de las cinco tandas anteriores escribió uno. Los specs previos lo declaran
   «NOT EXECUTED». Un E2E escrito hoy no lo correría nadie: sería un archivo, no una verificación.

**El riesgo concreto que el E2E cubriría, y cómo queda cubierto por otra vía.** La FASE 2 toca dos
flujos que sí son críticos —**recaudo** (cierres del día, cierres de bodega, consolidación) y
**pagos** (cuentas por pagar a mensajeros)— y el riesgo específico de paginar es que **un total de
dinero pase a calcularse sobre la página visible**. Se cubre así:

- **R49 en el servicio**: los cinco agregados de consolidación se calculan sobre el conjunto
  COMPLETO, afirmado con la página y el conjunto **con números distintos a propósito** (T J.1 §3);
- **R50 en la pantalla**: cambiar de página no altera los cinco agregados, ni los avisos de
  bloqueo, ni el monto tecleado en un sub-modal abierto (`ColasPaginacion.test.tsx`);
- **R49 fila a fila**: cada cuenta por pagar declara el libro ENTERO de su mensajero, medido con
  `pageSize: 1` y comparando la suma de todas las páginas contra el conjunto sin paginar
  (`2410.75`, con la página 1 sumando estrictamente menos);
- **R52 transversal**: T M.1 exige que el archivo traiga 60 filas con la tabla enseñando 25, en las
  tres formas de cablear la pantalla, y lo vigila en estático sobre los trece;
- **R44 en las dos capas**: el acotamiento por rol del listado paginado es el mismo que el del sin
  paginar, afirmado en los siete + cuatro + dos listados **y** en los cuatro `*-where.test.ts`, que
  son los que ven el `WHERE` de verdad (§4).

Lo que un E2E añadiría sobre eso es la **experiencia** de las dos pantallas de riesgo alto, que es
exactamente **Q4** y que el humano ya tiene declarada como pendiente de su revisión en pantalla.

---

## 11. Archivos

**Nuevos (1)**

- `tests/components/paginacion/paginacion-transversal.test.tsx` (9 tests).

**Modificados — producción (7)**

- `lib/interfaces/repositories/IPagoMensajeroMovimientoRepository.ts` — `listarCuentasPorPagarCompleto`.
- `lib/repositories/PagoMensajeroMovimientoRepository.ts` — el conjunto ordenado y filtrado se
  extrae; la página pasa a ser su `slice`.
- `lib/interfaces/services/IWalletMensajeroService.ts` — el contrato del modo completo.
- `lib/services/WalletMensajeroService.ts` — el método, con el guard antes del repo y el tope.
- `lib/types/wallet-mensajero.ts` — `listarCuentasPorPagarCompletoSchema` + su result de borde.
- `lib/actions/wallet-mensajero.ts` — `listarCuentasPorPagarCompletoAction`.
- `app/(app)/wallet/mensajeros/_components/CuentasPorPagarTable.tsx` — la descarga pide el
  conjunto YA filtrado; deja de importar el filtro y el orden.
- `app/(app)/cierres-admin/page.tsx` — `listarCierresBodegaAdmin()` sale del render (§5).

**Modificados — tests (11)**

- `tests/unit/services/wallet-cuentas-paginado.test.ts` — +7 casos del modo completo; el doble del
  repositorio corre el código de producción también del método nuevo.
- `tests/unit/repositories/cuentas-por-pagar-paginado-where.test.ts` — +3 casos (§4).
- `tests/unit/actions/wallet-mensajero-actions.test.ts` — +5 casos de borde.
- `tests/components/CuentasPorPagarTable.test.tsx`,
  `tests/components/paginacion/CuentasPorPagarPaginacion.test.tsx`,
  `tests/components/descarga/ControlDescargaTransversal.test.tsx` — el doble del conjunto pasa a
  filtrar en el servidor.
- `tests/components/descarga/WalletPropsDescarga.test.tsx` — el caso estático declara ahora **qué
  adaptador** usa cada una de las tres, para que el reparto no cambie sin que nadie lo note.
- `tests/integration/db/cierre-detail-congelado.test.ts`,
  `tests/integration/db/wallet-idempotencia.test.ts`,
  `tests/unit/repositories/cierres-admin-indemnizacion.test.ts`,
  `tests/unit/repositories/cierres-admin-repository.test.ts`,
  `tests/unit/repositories/CierresAdminRepository.resolverCierre.devolucion.test.ts` — los dobles
  implementan la interfaz completa.
- `tests/unit/guards/no-embalaje.test.ts` — alta de `specs/122-…/tasks.md` en el whitelist (§13).

**Modificados — spec / bitácora (2)**

- `specs/170-export-todas-las-tablas/tasks.md` — K, L y M marcadas con su bloque MEDIDO + FIN DE FASE 2.
- `progress/impl_170-export-todas-las-tablas.md` — §F2.1 con la tabla R1–R54 y el censo final.

**Cero migraciones, cero RLS, cero cambios de esquema.** El método nuevo no toca la base: reusa la
agregación que ya existía.

---

## 12. Patrón de capas y seguridad (CHECKPOINTS)

- **Controller** (`lib/actions/wallet-mensajero.ts`): sesión + zod `.strict()` + una llamada al
  servicio. Sin Prisma y sin lógica.
- **Service**: `esAccesoTotal` ANTES del repositorio (medido: con rol ajeno, `llamadas === []`), el
  tope de filas y el mapper del dinero. Sin `Request`/`Response`/`headers`.
- **Repository**: sólo consultas. El filtro y el orden salen de `lib/utils/cuentas-por-pagar-listado.ts`,
  el módulo puro que ya declaraba ese criterio una vez.
- **Interfaces**: en `lib/interfaces/{repositories,services}/`, un archivo por interfaz.
- **Mutaciones internas**: siguen siendo Server Actions; esta tanda no añade ninguna ruta de API.
- **Secretos**: ninguno; no se toca configuración de entorno.
- **RLS/migraciones**: sin tablas nuevas y sin migraciones, así que no aplica. `./init.sh` sigue
  confirmando que **todas las migraciones tienen `down.sql`**.

---

## 13. Puertas (medición final, salida real)

```
$ npx tsc --noEmit
=== typecheck exit: 0 ===

$ npx eslint
✖ 27 problems (0 errors, 27 warnings)     (baseline de T L.2: 27 warnings — SIN DELTA)

$ npx vitest run
 Test Files  1 failed | 771 passed (772)
      Tests  1 failed | 9255 passed (9256)
   Duration  225.46s

$ ./init.sh
== Arnes SDD :: init ==
✓ node v22.x
✓ dependencias presentes
✓ regla max-2-por-zona respetada
✓ specs presentes para features sdd en vuelo
✓ typecheck paso
✓ lint paso
✗ 'pnpm run test' fallo        ← NO llega a `== init OK ==`
```

### Los dos rojos: AJENOS y PREEXISTENTES, medidos con `git stash`

Se corrieron sobre el árbol **sin mis cambios** y fallan igual. **Delta de la tanda M: cero.**

| Test | Causa | De quién |
| --- | --- | --- |
| `tests/unit/guards/no-embalaje.test.ts` | `specs/122-analitica-alcance-por-rol/tasks.md:243` **narra en su bitácora que `./init.sh` cae por este guard** y, al escribir su nombre, se convierte en la causa de que siga cayendo. Prosa sobre la herramienta, no el value prohibido. | Feature **122** (PR #251) |
| `tests/integration/db/analytics-daily-guards.test.ts` | `lib/analytics/alcance-columnas.ts:67` nombra `analytics_daily` **en un comentario** («Fragmento de `where` para el rollup diario `analytics_daily`»). El guard R44 de la 123 dice «la tabla nace sin consumidores». | Features **122 / 123** |

**El primero SE DIO DE ALTA aquí**, y no por invadir otra feature: es el **sexto** caso idéntico
—`specs/155`, `specs/159` (×2), `specs/167` y `specs/135` ya están en ese mismo whitelist, todos
por citar el NOMBRE DE ARCHIVO del guard— y la regla escrita en el propio guard es que quien lo
encuentra lo da de alta en vez de declararlo deuda ajena y seguir. Verificado: verde tras el alta.

**El segundo NO se toca, y es deliberado.** No es prosa inocente como el anterior:
`alcance-columnas.ts` **construye un fragmento de `where` destinado a ese rollup**, que es
exactamente lo que la frontera R44 de la feature 123 prohíbe («las consultas son la 126»). O la 123
amplía su frontera porque la 122 la cambió legítimamente, o la 122 no debía nombrarla. **Es una
decisión de esas dos features y no de la 170**; tomarla yo sería aflojar el guard de otro para que
mi gate salga verde. Queda como **Q-M2**, dirigida al LEADER, con el remedio exacto: dar de alta
`lib/analytics/alcance-columnas.ts` en `ARCHIVOS_QUE_PUEDEN_NOMBRARLA` **si** el dueño confirma que
la referencia es declarativa —el tercer test del mismo archivo, el que comprueba que **nadie la lee
ni la escribe**, sigue verde y seguiría cubriéndola—.

**Suite, con los dos extremos medidos:**

| | Archivos | Tests | Rojos |
| --- | --- | --- | --- |
| Baseline (`dev`, árbol limpio) | 771 | 9232 | **3** (`no-embalaje` + `analytics-daily-guards` + el flake `OrdenesModuleReuse`) |
| Tras la tanda M | **772** | **9256** | **1** (`analytics-daily-guards`, ajeno) |

**+1 archivo y +24 tests**, y los +24 cuadran uno a uno: 9 (`paginacion-transversal`) + 7 (el modo
completo en el servicio) + 5 (su borde) + 3 (sus consultas en el repositorio). **Rojos nuevos:
cero**; se pasa de 3 a 1 porque esta tanda dio de alta uno de los dos ajenos y el flake conocido
`OrdenesModuleReuse` pasó en la corrida final.

---

## 14. Veredicto

La FASE 2 queda cerrada con las tres propiedades que la paginación ponía en riesgo vigiladas por un
censo que se contrasta contra el árbol en los dos sentidos —13 listados paginados y 3 exclusiones,
con los tres del Anexo IV entregando sus 30 filas, su contador por grupo y ni un control de
navegación—; la descarga de cuentas por pagar deja de releer el listado entero para filtrarlo en el
navegador y estrena el primer `listarCompleto` de la fase, con la batería de 25 textos de la tanda L
corrida otra vez contra él y el tope medido en el borde exacto de 5000/5001; el listado compuesto de
los cierres de bodega sale del render por ser una lectura de toda la tabla cuyo único efecto era un
`if` redundante; cinco mutaciones lo confirmaron en rojo y se revirtieron; y la suposición que las
tandas anteriores arrastraban sobre R54 se sustituye por lo que la medición dice —`fallbackData`
compra el primer pintado, no la revalidación—, declarada como Q-M1 en vez de maquillada. Los dos
rojos de `./init.sh` son ajenos, preexistentes y están medidos con el árbol limpio: uno se dio de
alta aquí siguiendo el precedente que el propio guard escribe, y el otro queda dirigido porque
cerrarlo es decidir la frontera de otra feature.
