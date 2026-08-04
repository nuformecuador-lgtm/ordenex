# chore — deuda dirigida de la feature 170 (Q-I5 / Q-K4 / Q-K6 / Q-L4)

> Rama: `chore/deuda-170-listados` (desde `origin/dev`) · Fecha: 2026-08-03 · Rol: BACKEND_DEV
>
> Encargo: cerrar la deuda que las tandas I/J/K/L/M de la 170 dejaron declarada. Tres bloques:
> los `listarXCompleto` que faltan (Q-I5 + Q-K4), las tres lecturas por render de la satélite
> (Q-K6) y los acentos de la búsqueda de cuentas por pagar (Q-L4).
>
> **Resultado en una línea: Q-L4 CERRADA; Q-I5/Q-K4/Q-K6 NO se implementan y se devuelven al
> LEADER con el inventario medido, porque las dos condiciones de parada que el propio encargo
> fijaba se cumplen las dos.**

---

## 1. PASO 1 — el inventario, verificado contra el código de HOY

La deuda es de hace días. Se re-verificó punto por punto contra el árbol, no contra las
bitácoras. **Sigue viva, entera, y es más grande de lo que decía la nota de partida.**

### 1.1 El número: no son 8, son **12**

La nota decía «los 8 que faltan». **El 8 es real pero cuenta otra cosa.** Sale de
`impl_170-fase2-tanda-m.md:306`, y ahí «8 métodos de servicio + 8 de repositorio + 8 schemas +
8 actions» es el número de **dominios** (acciones-fuente distintas que hoy se releen), no el de
**listados**.

Lo que hay que entregar se cuenta por LISTADO, porque cada listado tiene su propio control de
descarga, su propio dataset y su propio conjunto. Y el patrón vigente ya separa cola e histórico
en dos métodos distintos (`findColaPaginada` / `findHistoricoPaginado`,
`listarPendientesCierresAdminPaginado` / `listarHistoricoCierresAdminPaginado`). El censo de
`tests/components/paginacion/paginacion-transversal.test.tsx:913` lo afirma como número:

```ts
expect(ANEXO_III.filter((l) => l.adaptador === "conjunto")).toHaveLength(12);
```

**Son 12 listados sin `listarXCompleto`, repartidos en 8 dominios.** Verificado en los dos
sentidos: 12 llamadas vivas a `filasDelConjuntoCompleto(` en `app/`, una por listado.

### 1.2 Tabla del inventario, listado a listado

| # | Listado (Anexo III) | Qué relee hoy la descarga | Coste de esa relectura | ¿Método de repo nuevo? |
| --- | --- | --- | --- | --- |
| 1 | Cierres solicitados por el mensajero | `listarCierreDia()` → `.cierresPasados` | **CARO**: firma las URL de evidencia de TODAS las gestiones del día (`CierreDiaService:190/281`, `createSignedUrls`) | No — `findCierresByMensajero` ya existe |
| 2 | Cierres del día — histórico | `listarCierresAdmin()` → `.historico` | trae cola + histórico del alcance entero | **Sí** — `findHistoricoCompleto(alcance)` |
| 3 | Cierres del día pendientes | `listarCierresAdmin()` → `.pendientes` | ídem | **Sí** — `findColaCompleta(alcance)` |
| 4 | Cierres de bodega pendientes | `listarCierresBodegaAdmin()` → `.pendientes` | trae los dos conjuntos | **Sí** |
| 5 | Cierres de bodega resueltos | `listarCierresBodegaAdmin()` → `.historico` | ídem | **Sí** |
| 6 | Cierres de bodega solicitados | `listarConsolidacion()` → `.cierresBodegaPasados` | **CARO**: 4 consultas + los 5 agregados de dinero + `repartirEfectivo` | No — `findCierresBodegaByZona` ya existe |
| 7 | Cierres del día a consolidar | `listarConsolidacion()` → `.consolidables` | **CARO**, ídem | No — `findCierresDiaConsolidables` ya existe |
| 8 | Incidentes pendientes | `listarIncidentes()` → `.pendientes` | trae los dos conjuntos | **Sí** |
| 9 | Incidentes — histórico | `listarIncidentes()` → `.historico` | ídem | **Sí** |
| 10 | Órdenes de la bodega satélite | `conjuntoFiltrado(filtro)` → `listarRecepcionSatelite()` **y filtra en memoria** | **CARO** + es Q-K4 | **Sí** — SQL crudo con filtros |
| 11 | Plantillas de gasto fijo | `listarPlantillasAction()` → `.plantillas` | barato (lista pequeña) | No — `listar()` ya existe |
| 12 | Saldos de tiendas | `listarSaldosTiendasAction()` → `.tiendas` | agrega el libro de todas las tiendas | No — `listarSaldosTodasTiendas()` ya existe |

**Q-K4 confirmada viva** (`RecepcionSateliteModule.tsx:113-124`): `conjuntoFiltrado()` concatena
los cinco grupos y llama a `filtrarOrdenesSatelite(conjunto, filtro)` **en el navegador**. Es el
único de los doce que además duplica el criterio de filtrado en dos capas.

**Q-K6 confirmada viva** (`app/(app)/recepcion-satelite/page.tsx`): el Server Component hace
`listarRecepcionSatelite()` (:30), `listarOrdenesBodegaPaginado({})` (:70) y
`obtenerCatalogoFiltrosSatelite()` (:88) — **tres lecturas del mismo dominio por render**, más
otras tres de dominios vecinos.

### 1.3 El tamaño real del trabajo

| Pieza | Cantidad |
| --- | --- |
| Métodos de **repositorio** nuevos (+ su interfaz) | **7** (2 cierres-admin, 2 bodega-admin, 2 incidentes, 1 satélite) |
| Métodos de **servicio** nuevos (+ su interfaz) | **12** |
| **Schemas** zod nuevos | **12** |
| **Server Actions** nuevas | **12** |
| Archivos de **pantalla** (`app/**`) a tocar | **12** |
| Archivos de test que referencian las 8 acciones-fuente | **45** |
| Censos/guardias que hay que venir a actualizar | **1** (`paginacion-transversal.test.tsx`, el 12/1 declarado dos veces) |

### 1.4 Por qué me paro aquí — las dos condiciones de parada, cumplidas

El encargo decía: *«Si son bastantes más de 8, o si alguno exige tocar una pantalla y no solo el
repositorio, párate y repórtame el inventario antes de implementar.»* **Se cumplen las dos, y la
segunda no admite matiz:**

1. **12 en vez de 8**, un 50 % más, con el detalle de que 7 de los 12 sí exigen método de
   repositorio nuevo y 5 no (esos 5 son servicio + borde + pantalla).
2. **Los 12 exigen tocar una pantalla, por construcción y sin excepción.** El adaptador de
   descarga vive en el componente: cerrar un listado es cambiar
   `filasDelConjuntoCompleto(releer(...))` por `filasDesdeResultado(nuevaAction(...))` en su
   `.tsx`. Es literalmente lo que hizo T M.1 para cerrar Q-L2 (tocó
   `CuentasPorPagarTable.tsx`). **Y `app/**` está fuera del alcance de BACKEND_DEV**, que es el
   rol con el que se lanzó este chore. Un backend que entregue los 12 métodos sin tocar pantalla
   deja 12 Server Actions muertas y la deuda intacta: el archivo lo sigue produciendo la
   relectura cara.

**Q-K6 tampoco es implementable desde aquí, y por una razón distinta**: su salida no es «añadir
un método» sino **decidir** entre dos contratos —o «Por recibir» sale de su propia acción
acotada, o `listarRecepcionSatelite()` deja de devolver los cinco grupos—. La segunda cambia una
superficie que consumen otras pantallas. Ninguna task ha tomado esa decisión y no me corresponde
tomarla.

### 1.5 Lo que recomiendo al LEADER (medido, no opinado)

- **No es un chore: es una tanda `fullstack` del tamaño de la I**, con la secuencia
  backend → frontend que el repo ya usa. El molde está hecho y medido (T M.1 §3), así que el
  riesgo es bajo pero el volumen no.
- **Si hay que priorizar, el orden por coste real medido es**: (10) satélite —es la única que
  además borra una duplicación de criterio—, (6) y (7) consolidación —comparten la relectura más
  cara del repo—, (1) cierres pasados del mensajero —firma URL de evidencia que nadie usa en el
  archivo—. Los demás son higiene: el tope de 5000 pasa al servidor (R29) y el conjunto deja de
  cruzar al navegador, pero la consulta cuesta lo mismo que antes de paginar.
- **Los 12 no se pueden cerrar «uno por PR» sin cuidado**: el censo del transversal afirma el
  reparto 12/1 en dos aserciones, así que cada cierre parcial obliga a actualizarlo. Eso es
  bueno (la deuda se ve), pero hay que contarlo en el plan.
- **Q-M1 sigue abierta y toca los mismos trece módulos**: si se abre la tanda, entra ahí o se
  paga dos veces.

---

## 2. PASO 2 — no ejecutado

Cero métodos de `listarXCompleto` implementados. Cero cambios en repositorios, servicios,
interfaces de dominio, schemas de listado o Server Actions de listado. **Cero archivos de
`app/` tocados.** El motivo está en §1.4 y es el que el propio encargo fijó.

---

## 3. PASO 3 — Q-L4, los acentos: **CERRADA**

### 3.1 La decisión, y de quién es

**Decisión del LEADER**, tomada en el encargo de este chore y asumida por él: la búsqueda de
«Cuentas por pagar a mensajeros» **debe ignorar los acentos**. En español es lo que espera
cualquiera —buscar «Ramirez» tiene que encontrar «Ramírez»— y hoy el resultado dependía de cómo
se tecleara el nombre.

No era un defecto que la 170 introdujera: T L.1 lo conservó **a propósito**, porque R45 le pedía
reproducir el conjunto del filtro que corría en el navegador, y aquel era accent-sensible.
`impl_170-fase2-tanda-l.md:351` lo dejó como **pregunta abierta**, no como fallo, y la tanda M la
dirigió al humano. Ahora está respondida.

**Es una DESVIACIÓN declarada de la letra de R45**, y conviene decir por qué ya no muerde: el
filtro de cliente **dejó de existir** cuando T M.1 (cierre de Q-L2) llevó la descarga al
servidor. `CuentasPorPagarTable.tsx` ya no importa `filtrarPorBusquedaMensajero`. R45 exigía que
dos implementaciones coincidieran; hoy solo hay una.

### 3.2 El índice: **no hay ninguno que degradar, y está medido**

Era la pregunta con la que el encargo condicionaba el cómo. La respuesta es concreta:

**El filtro por nombre NUNCA llega a SQL.** `PagoMensajeroMovimientoRepository`:

- `listarCuentasPorPagarTodos()` hace `groupBy(["mensajeroId","tipo"])` **sin `where`**, y luego
  `usuario.findMany({ where: { id: { in: [...] } } })` — un `IN` por clave primaria, no un
  predicado sobre el nombre;
- `listarCuentasPorPagarCompleto()` aplica `filtrarPorBusquedaMensajero` **en Node**, sobre el
  resultado ya materializado;
- `listarCuentasPorPagarPaginado()` es un `slice` de lo anterior.

Es la deuda **Q-L1** («este listado recorta fuera de la base»), que sigue abierta y dirigida al
humano por otra vía. Aquí juega a favor: **no hay predicado sobre la columna, luego no hay
índice al que una función pueda dejar sin usar.** No hacía falta columna generada, ni `unaccent`,
ni índice funcional. Postgres 17.6 no interviene en esta búsqueda.

Y no es una afirmación de prosa: hay un test que la fija. Tras plegar acentos, la agregación
**sigue sin `where`** y siguen siendo **las mismas dos consultas** (R54). Si alguien «optimizara»
el filtro empujándolo a un `contains` de SQL —que es cuando un índice entraría en juego y podría
degradarse—, ese test se pone rojo por dos vías a la vez.

### 3.3 Cómo se implementó

En **el servidor** y en **un solo sitio**: `lib/utils/cuentas-por-pagar-listado.ts`, el módulo
puro que ya declaraba el criterio una vez (`T L.1 §9.1`) y que usan las **dos** lecturas del
repositorio. Por eso la tabla y el archivo no pueden discrepar por construcción.

Se plegan **las dos caras** —el texto tecleado y el nombre— con la misma función. Plegar solo una
es el fallo clásico: «Ramírez» dejaría de encontrarse a sí mismo. Hay test explícito de los dos
sentidos.

**Qué plegado, y por qué no los otros dos que ya viven en el repo:**

| Candidato | Por qué NO / SÍ |
| --- | --- |
| `normalizarTerminoBusqueda` (`lib/utils/busqueda-orden.ts`, feature 169) | **No.** Es el espejo en TypeScript de un `translate()` con mapa explícito de 48 caracteres, escrito así porque su contraparte la calcula **Postgres** en una columna generada e indexada. Aquí no hay columna que espejar: copiar la restricción de un espejo inexistente plegaría MENOS caracteres sin ganar nada. |
| `normalizeName` (`lib/utils/normalize.ts`) | **No.** Pliega los acentos igual, pero además **colapsa los espacios interiores**. Eso es un segundo cambio de comportamiento que nadie pidió, y rompería el caso «espacio INTERIOR» de la batería de T L.1. |
| NFD + descarte de marcas combinantes, local al módulo | **Sí.** Mínimo y suficiente: solo toca los acentos. |

**Qué NO cambia, y por eso el cambio es acotado:** el recorte de extremos, el `includes`
(subcadena en cualquier posición), los espacios interiores, la caja y el trato de `%` y `_` como
TEXTO. Sigue sin haber comodines. El **orden** tampoco se toca.

### 3.4 El delta, medido caso a caso en vez de reescrito para pasar

La batería de **25 textos** de T L.1 se conserva **entera**, y con ella la búsqueda
accent-sensible copiada del navegador, ahora como **línea base histórica**. Cada caso declara a
mano su columna nueva `extraPorAcentos`: las filas que ahora devuelve y antes no.

- **8 de los 25 cambian de conjunto**; los otros **17 devuelven exactamente lo mismo** — y esa
  mitad es la que impide que «ignorar acentos» se lleve por delante los comodines, los espacios
  interiores o la caja.
- Se afirma además una **propiedad general sobre los 25**: plegar **solo puede añadir, nunca
  perder** una fila. Es cierta porque el plegado es carácter a carácter y conserva la relación de
  subcadena; si alguien lo implementara de otro modo, el test lo detecta.
- **Anti-vacuidad del delta**: si `extraPorAcentos` estuviera vacío en los 25, la comparación
  sería una tautología. El test exige que sean exactamente 8.

**El precio se declara, no se esconde:** «ñ» se pliega a «n», así que buscar «ñ» deja de traer
solo a «Núñez». Es la contrapartida de que «nunez» sí lo encuentre, y en un buscador por
subcadena de UNA letra el ruido ya existía («o», «z»). Está escrito en el propio test.

---

## 4. Archivos

**Nuevos (1)**

- `tests/unit/utils/cuentas-por-pagar-listado.test.ts` — 16 tests. El módulo puro **no tenía test
  propio**: se probaba de rebote, a través del servicio y del repositorio.

**Modificados — producción (1)**

- `lib/utils/cuentas-por-pagar-listado.ts` — `plegarAcentos` + las dos caras de la búsqueda.

**Modificados — tests (2)**

- `tests/unit/repositories/cuentas-por-pagar-paginado-where.test.ts` — +3 casos (§5).
- `tests/unit/services/wallet-cuentas-paginado.test.ts` — batería actualizada con `extraPorAcentos`.

**Cero** cambios en `lib/services`, `lib/repositories`, `lib/actions`, `lib/interfaces`,
`app/**`, migraciones, RLS y esquema. **`feature_list.json` no se toca.**

---

## 5. Mapa de tests — «probar el `WHERE` donde vive»

La regla del repo nació de un hallazgo medido **cuatro tandas seguidas**: los tests de servicio
usan dobles del repositorio y **no ven la traducción a SQL**, así que 7+ mutaciones del `WHERE`
pasaron verdes en servicio y solo las detuvieron los cuatro `*-where.test.ts`.

En este cambio **el filtro no es un `WHERE` de SQL: vive en Node, dentro del repositorio** (§3.2).
Así que «donde vive» son dos sitios, y hay test en los dos:

| Qué se prueba | Dónde vive | Test | Casos |
| --- | --- | --- | --- |
| La REGLA pura (plegado, dos sentidos, lo que no cambia) | `lib/utils/cuentas-por-pagar-listado.ts` | `tests/unit/utils/cuentas-por-pagar-listado.test.ts` | **16** |
| Que el repositorio la aplica **en las dos lecturas** y **sin generar consulta** | `PagoMensajeroMovimientoRepository` | `tests/unit/repositories/cuentas-por-pagar-paginado-where.test.ts` | **+3** |
| Que el conjunto que ve el maestro es el declarado, con el delta medido | `WalletMensajeroService` | `tests/unit/services/wallet-cuentas-paginado.test.ts` | 20 (2 reescritos) |

El de repositorio corre el **código real** contra un delegado Prisma falso y afirma sobre los
**argumentos** de la consulta, no sobre su resultado — la forma que el repo ya usa en sus cuatro
`*-where.test.ts`. Los 3 casos nuevos:

1. la **página** pliega (8 textos, con anti-vacuidad);
2. el **conjunto de la descarga** pliega **exactamente igual** que la página (R11/R52: si el
   plegado se hubiera escrito en un solo camino, la fila que se ve y la que se descarga
   discreparían justo en los nombres acentuados);
3. plegar **no añade consultas** y la agregación **sigue sin `where`** (R54) — que es, literalmente,
   la comprobación de que ningún índice entra en juego.

---

## 6. Puertas (medición real)

```
$ npx tsc --noEmit
=== typecheck exit: 0 ===

$ npx eslint
✖ 44 problems (0 errors, 44 warnings)
=== lint exit: 0 ===

$ npx vitest related --run lib/utils/cuentas-por-pagar-listado.ts \
    tests/unit/utils/cuentas-por-pagar-listado.test.ts \
    tests/unit/repositories/cuentas-por-pagar-paginado-where.test.ts \
    tests/unit/services/wallet-cuentas-paginado.test.ts
 Test Files  33 passed (33)
      Tests  541 passed (541)
   Duration  28.10s

$ npx vitest run guard
 Test Files  57 passed (57)
      Tests  793 passed (793)
   Duration  4.62s

$ npx vitest run tests/integration/db
 Test Files  94 passed (94)
      Tests  1148 passed (1148)
   Duration  8.82s
```

**Rojos: cero, ni propios ni ajenos.**

**Las 44 warnings de lint son AJENAS y PREEXISTENTES**, medido con `git stash -u` sobre el árbol
limpio: **44 antes y 44 después, delta cero.** (La bitácora de la tanda M anotaba 27; la
diferencia es deriva de `dev` en los dos días transcurridos, no de este chore.)

**La suite completa NO se corre aquí**: el encargo la reserva al LEADER, que la corre en el gate.

---

## 7. Qué queda abierto, y por qué

| # | Estado | Razón |
| --- | --- | --- |
| **Q-L4** (acentos) | **CERRADA** | §3. Servidor, un solo sitio, sin índice implicado, delta medido en 8 de 25 textos. |
| **Q-I5 + Q-K4** (los `listarXCompleto`) | **ABIERTA — devuelta al LEADER con inventario** | Son **12** listados, no 8, y **los 12 exigen tocar `app/**`**, fuera del alcance de BACKEND_DEV. §1.4. Es una tanda fullstack, no un chore. |
| **Q-K6** (3 lecturas por render en la satélite) | **ABIERTA — devuelta al LEADER** | Su salida no es añadir un método sino **decidir** entre dos contratos, uno de los cuales cambia una superficie que consumen otras pantallas. Ninguna task ha tomado esa decisión. |
| **Q-L1** (recorta fuera de la base) | ABIERTA, sin tocar | No es de este chore. Aquí solo se hizo notar que es la razón por la que no hay índice implicado en Q-L4. |
| **Q-M1** (la revalidación de entrada de SWR) | ABIERTA, sin tocar | Toca los mismos trece módulos que Q-I5/Q-K4: si se abre esa tanda, entra ahí o se paga dos veces. |

---

## 8. Veredicto

Q-L4 queda cerrada en el servidor y en el único sitio donde el criterio está escrito, con la
pregunta del índice respondida por medición y no por suposición —el filtro nunca llega a SQL, así
que no había plan que degradar, y hay un test que se pone rojo si alguien lo empuja a la base—;
la batería de 25 textos de la tanda L sobrevive entera y el cambio de semántica queda medido fila
a fila contra la línea base accent-sensible, incluido su precio. Q-I5, Q-K4 y Q-K6 no se
implementan y se devuelven con el inventario real: **12 listados y no 8**, los doce con una
pantalla por medio, que es la condición de parada que el propio encargo fijó — un inventario
honesto antes que media implementación.
