# impl_184 — analitica financiera: export de la serie

> Rama `feature/184-analitica-financiera-export`, worktree `C:/w184`. Escrito al cerrar **T6.1,
> T6.2 y T7.1**. Todo lo que se afirma aqui se midio EN ESTE WORKTREE y su salida esta pegada
> abajo; lo que no se midio se dice que no se midio.
>
> ⚠ **AVISO DE NUMERACION.** «184» en 111 comentarios, en la constante `PENDIENTES_184` y en ~60
> mensajes de commit de este arbol se refiere a **la 188** (aquella ficha era la 184 y se
> renumero). Los artefactos de ESTA feature se rotulan con nombre, no solo con numero.

---

## 1. Archivos que toca la feature

**Produccion — TRES archivos nuevos, todos en el subarbol propio:**

| Archivo | Tarea |
|---|---|
| `app/(app)/analitica/_components/export-financiero/analitica-financiera-descarga-columnas.ts` | T2.1 |
| `app/(app)/analitica/_components/export-financiero/export-financiero.ts` | T3.1 |
| `app/(app)/analitica/_components/export-financiero/ExportarVistaFinanciera.tsx` | T4.1 |

**Produccion — UN archivo ajeno modificado (D6), con una sola insercion:**

- `app/(app)/analitica/_components/financiero/TableroFinanciero.tsx` — `+19` lineas: el import y
  **un** `<ExportarVistaFinanciera …/>` dentro de `SeccionVista`, con props planas. Sin
  `"use client"`, sin prop-funcion. `tests/unit/guards/tablero-financiero.guardia.test.ts` queda
  **verde sin tocarlo** (R28) — comprobado en la corrida de §4.

**Tests:**

| Archivo | Tarea |
|---|---|
| `tests/unit/analytics/_fake-financiera-export.ts` (fixture, no es suite) | T1.1 |
| `tests/unit/descarga/analitica-financiera-descarga-columnas.test.ts` | T2.2 |
| `tests/unit/analytics/export-financiero-columnas.test.ts` | T2.3 |
| `tests/unit/analytics/export-financiero-forma.test.ts` | T2.3 |
| `tests/unit/analytics/export-financiero-grano.test.ts` | T2.3 |
| `tests/unit/analytics/export-financiero-equivalencia.test.ts` | T3.2 |
| `tests/unit/analytics/export-financiero-puerta.test.ts` | T4.2 |
| `tests/unit/analytics/export-financiero-denegado.test.ts` (BLINDADO, T-A) | T4.3 |
| `tests/unit/analytics/export-financiero-vacio.test.ts` | T4.4 |
| `tests/components/descarga/AnaliticaFinancieraExport.test.tsx` | T4.4 / T5.2 |
| `tests/components/TableroFinanciero.test.tsx` (`+24`, ampliado) | T5.2 |
| **`tests/unit/analytics/export-financiero-frontera.guardia.test.ts`** | **T6.1 (nuevo)** |
| **`tests/unit/analytics/export-financiero-alcance.guardia.test.ts`** | **T6.2 (nuevo, BLINDADO)** |

**Cero** cambios en `lib/**`, `components/**`, `lib/utils/descarga-dataset.ts`,
`lib/utils/csv-template.ts` y el resto de `_components/financiero/**`. Verificado por el bloque (8)
del guardia de frontera (censo del arbol, no del diff) y por `git status --porcelain -- lib/
components/` vacio tras las mutaciones de §3.

---

## 2. Mapa `R1..R30 -> test` (T7.1)

**Como se construyo, y por que no de la otra forma.** Cada linea sale de **leer el caso citado** y
comprobar que mide lo que el requisito pide. **NO** se contaron menciones `R\d+` en titulos de
test: esa tecnica cruza espacios de nombres entre features —hay `R10` en la 122, en la 132, en la
134 y aqui— y en este repo ya produjo un falso `68/68`. Donde el caso mide algo mas debil que el
requisito, se dice en la columna de nota.

| R | Test / guardia (caso concreto) | Que se comprobo al leerlo |
|---|---|---|
| R1 | `export-financiero-puerta.test.ts` › *las filas del archivo salen de consultarMetricaFinanciera y de ninguna otra fuente* | Espia la accion: **1** llamada, con el `metricaId` de la seccion, y las filas llevan un **centinela** (`424242.42`) que solo existe en la respuesta espiada. + guardia frontera bloque (1). |
| R2 | `export-financiero-puerta.test.ts` › *el filtro que envia el export es el MISMO objeto…* | `toBe` (identidad referencial) contra `FILTRO_FINANCIERO_POR_DEFECTO` importado, y `Object.isFrozen`. Un literal equivalente falla. + guardia frontera bloque (5). |
| R3 | `export-financiero-frontera.guardia.test.ts` › *ninguna ruta de app/api sirve el export de analitica financiera* | Recorre `app/api/**`: censo por RUTA (analitica + export/descarga/financiera/csv/xlsx) y por CODIGO (importa el subarbol, o consulta el borde y llama a `construirDescarga`). |
| R4 | idem › *ningun modulo "use server" invoca construirDescarga* | Censa `app/`, `lib/`, `components/`, `scripts/`; contrapeso: existen modulos `use server` **y** modulos que arman archivos, asi que no pasa por vacio. |
| R5 | idem › *produccion invoca el borde con dos argumentos* + `puerta.test.ts` › *el borde se invoca con DOS argumentos* | El guardia cuenta argumentos con escaner de parentesis y descubre el **alias** del borde (`consultar = consultarMetricaFinanciera`); el test lo confirma en ejecucion (`calls[0]` tiene longitud 2). |
| R6 | `export-financiero-denegado.test.ts` › *un forbidden no produce archivo y su mensaje no es el de sin datos* | Borde REAL con actor de rol prohibido; mensaje habla de acceso, **no** de «no hay datos» ni de «ajusta los filtros», y no filtra `metrica_prohibida`. |
| R7 | idem › *el intento de descarga denegado deja rastro en el logger ANTES de responder* | Afirma la **secuencia** `["auditoria","respuesta"]` sobre un array compartido, no un conteo, y atraviesa el borde real (criterios 1 y 2 de §9.1 T-A). Su mutacion se ejecuto aqui: §3.3. |
| R8 | idem › *un validation_error no produce archivo y no llama al logger* | Provoca el 400 con un preset invalido en el doble; `secuencia` vacia; sanidad: la constante de produccion SI valida. |
| R9 | idem › *un error del borde no produce archivo y transporta el mensaje ya saneado* | Compara contra el mensaje que devuelve **el propio borde** en la misma condicion, no contra un literal. |
| R10 | `export-financiero-alcance.guardia.test.ts` bloques (a), (b) y (c) | (a) censo del vocabulario del alcance sobre el subarbol; (b) claves y encabezados contra lista **escrita a mano** + ninguna es un id; (c) asercion sobre el **TEXTO** CSV: sin forma de uuid, sin vocabulario, primera linea = cabecera declarada y `filas+1` lineas exactas. |
| R11 | `export-financiero-columnas.test.ts` › *toda celda del archivo procede de un campo del DTO salvo la limitacion declarada* | Proyecta con dos DTO **sin un campo en comun** y exige que las celdas invariantes sean exactamente `["limitacion_conocida"]`: una segunda celda constante falla. |
| R12 | `export-financiero-alcance.guardia.test.ts` bloque (d) | Fixture con **uuids de verdad**: la seleccion devuelve `null`, el control responde con el texto de R12 y **no** produce filas; el uuid se busca literalmente. Contrapeso: una vista temporal SI produce archivo. |
| R13 | `export-financiero-forma.test.ts` › *una vista solo_bruto no emite ninguna columna de neto* y › *una vista bruto_y_neto emite las dos, distinguibles* | `"neto" in fila` es `false` (no vacia, no en cero); y con neto, bruto ≠ neto por fixture. |
| R14 | `export-financiero-frontera.guardia.test.ts` › *el subarbol de export no decide por el id de ninguna metrica financiera* + `forma.test.ts` › *la eleccion del juego de columnas la hace la FORMA…* | Mismo mecanismo y **mismos ids importados** (`IDS_FINANCIERAS_SERVIDAS`) que el censo (f) del guardia del tablero; cuatro formas de decision. |
| R15 | `export-financiero-grano.test.ts` › *cada fila declara el grano del cubo…* | Dos rangos que **producen** granos distintos (`dia` vs `semana`) por la misma funcion pura que el servidor; sanidad de que difieren. |
| R16 | idem › *la fila de una metrica acumulada se declara saldo al corte…* | `esAcumulado` derivado por el mismo `esMetricaAcumulada` del contrato; los dos valores del vocabulario son distinguibles. |
| R17 | `export-financiero-columnas.test.ts` › *la moneda de cada fila sale del importe y no de un literal* | La fixture usa un codigo **distinto** del de produccion; ademas se comprueba que sale de SU importe y no del primero. |
| R18 | idem › *el importe se escribe literal, sin conversion a number ni reformateo* + guardia frontera bloque (8a) | Cifra por encima de `2^53` con **sanidad del centinela** (`String(Number(x)) !== x`), tipo `string`, sin separadores. |
| R19 | `export-financiero-equivalencia.test.ts` › *las filas del archivo son fila por fila las del DTO…* | Cardinalidad y orden contra los cubos derivados del mismo troceo; y un cubo en cero sigue siendo fila en su sitio. |
| R20 | idem › *el export no reordena, no agrupa la cola ni rellena cubos* | Se compara contra lo que `agruparCola` HARIA con el techo del tablero (con sanidad de que ese techo recorta de verdad); sin claves repetidas ni ajenas. |
| R21 | `export-financiero-vacio.test.ts` › *sin filas no se genera archivo y se avisa sin datos* | Control MONTADO: espia `buildCsvRows` **sin sustituirlo** y `descargarBlob`; ninguno se invoca. |
| R22 | idem › *superar el tope no produce archivo truncado sino el mensaje accionable* | `MAX_FILAS + 1`: mensaje con total y tope, cero archivo; contrapeso con `MAX_FILAS` exactas que SI descarga. |
| R23 | `export-financiero-frontera.guardia.test.ts` bloque (8): *el subarbol contiene EXACTAMENTE los tres archivos declarados* · *fuera de la analitica nadie importa su subarbol* · *el unico que lo monta es TableroFinanciero.tsx, con UNA insercion* · *ningun archivo de la analitica declara un generador de archivo propio* | Censo del **arbol**, no del diff: sigue siendo cierto despues de mergear. |
| R24 | `AnaliticaFinancieraExport.test.tsx` › *el nombre del archivo lo produce nombreArchivoDescarga…* | Se compara contra la salida de la MISMA funcion del patron 151, no contra un literal. |
| R25 | idem › *el control ofrece CSV y XLSX y no declara un dialecto propio* | Los dos items del menu, sin BOM, sin `;`, MIME comun, e importe literal en el texto. |
| R26 | `export-financiero-frontera.guardia.test.ts` bloque (9) | El modulo cumple la convencion `*-descarga-columnas.ts`; los **patrones literales** de la guardia de la 170 se leen de SU fuente y se comprueba que cubren la ruta; y el modulo se importa para ver que publica lo que la sonda ejecuta. |
| R27 | idem bloque (7) + `AnaliticaFinancieraExport.test.tsx` › *el control cuelga de la seccion de la vista y no se monta fuera de ella* | Censo de roles derivado de `RolValue` + condiciones de permiso; y en el arbol montado hay **tres** controles (uno por vista temporal) y ninguno en la no temporal. |
| R28 | `tests/unit/guards/tablero-financiero.guardia.test.ts` (**vivo, no se toco**) | Verde en la corrida de §4, y `git status` no lo lista como modificado: la condicion integra de D6 se cumple. |
| R29 | `analitica-financiera-descarga-columnas.test.ts` › *las columnas con neto se declaran en su orden* y › *las columnas solo bruto…* | Molde de la 189: clave **y** encabezado con el esperado escrito a mano, en los dos juegos, mas un contrapeso de que la unica diferencia es `neto`. |
| R30 | `export-financiero-grano.test.ts` › *todas las filas declaran la limitacion del ultimo cubo…* | Un solo valor en todas las filas, es `string`, y no cambia al proyectar otro rango (una marca calculada cambiaria). |

**Cobertura: 30/30.** Ningun requisito se quedo sin test y ningun test citado mide algo distinto de
lo que su requisito pide. Las dos observaciones que si aparecieron al leer estan en §5, y **no** se
taparon reasignandoles el test mas parecido.

---

## 3. Las mutaciones ejecutadas (no descritas)

Todas se aplicaron al arbol, se corrio el test, se leyo la salida y se **revirtio** copiando la
copia de seguridad del archivo (nunca `git checkout`). Tras las tres,
`git status --porcelain -- lib/ components/ app/` quedo **vacio**.

### 3.1 T6.2 (a) — anadir una fila de metadatos con el alcance del actor

Mutacion en `export-financiero.ts` › `filasDeVistaFinanciera`: se antepone una fila
`{ periodo: "Alcance", grano: "tiendaId: 3f8c1a2b-4d5e-4f60-9a71-8b2c3d4e5f60", … }`.

```
 ❯ tests/unit/analytics/export-financiero-alcance.guardia.test.ts (12 tests | 4 failed)
   × ningun archivo del subarbol nombra el alcance de quien descarga
   × el texto del archivo no contiene ninguna forma de uuid ni ninguna palabra del alcance
   × el archivo empieza por la cabecera de columnas: no hay cabecera de metadatos
   × y una vista TEMPORAL si produce archivo: la exclusion es de las no temporales, no de todo
 Tests  4 failed | 8 passed (12)
```

**Veredicto: ROJO en cuatro casos**, incluidos los dos que miden el TEXTO. Revertida.

### 3.2 T6.2 (b) — aceptar cualquier vista con filas

Mutacion en `vistaTemporalDelResultado`: `vista.filas.length > 0 ? vista : null` en lugar de
`esVistaTemporal(vista) ? vista : null`.

```
 ❯ tests/unit/analytics/export-financiero-alcance.guardia.test.ts (12 tests | 1 failed)
   × una vista no temporal no produce archivo aunque sus cubos vengan con identificadores
     AssertionError: expected { id: 'cuenta_por_pagar_tienda', …(6) } to be null
 Tests  1 failed | 11 passed (12)
```

**Veredicto: ROJO.** Y la autocomprobacion (d) del propio guardia demuestra que si esa vista
pasara, el texto del archivo contendria el uuid literal. Revertida.

### 3.3 T-A (R7) — invertir las dos sentencias del borde

**No constaba en ninguna bitacora** (este archivo no existia), asi que se ejecuto ahora, aunque
T4.3 estuviera marcada como hecha: el criterio 3 de §9.1 T-A exige la salida pegada. Mutacion en
`lib/actions/analitica-financiera.ts`: responder el `forbidden` **antes** de `logger.logError(...)`.

```
 ❯ tests/unit/analytics/export-financiero-denegado.test.ts (5 tests | 1 failed)
   × el intento de descarga denegado deja rastro en el logger ANTES de responder
     AssertionError: expected [ 'respuesta' ] to deeply equal [ 'auditoria', 'respuesta' ]
 Tests  1 failed | 4 passed (5)
```

**Veredicto: ROJO, y por la razon correcta** (la secuencia, no el conteo). Revertida; el archivo
de `lib/` volvio byte a byte a su estado y el test vuelve verde (5/5).

---

## 4. Lo que se corrio en esta tanda (salida real)

```
$ pnpm typecheck
> tsc --noEmit
(sin salida: verde)

$ pnpm exec eslint tests/unit/analytics/export-financiero-{frontera,alcance}.guardia.test.ts
(sin salida: verde)

$ pnpm exec vitest run <los 13 archivos de la feature + los 2 guardias vivos + modulo-puro>
 Test Files  15 passed (15)
      Tests  234 passed (234)
   Duration  31.11s

$ pnpm run test:guardias        # vitest run guard
 Test Files  85 passed (85)
      Tests  1155 passed (1155)
   Duration  30.46s
```

Los 15 archivos de la corrida: los nueve `export-financiero-*` (siete tests + los dos guardias
nuevos), `analitica-financiera-descarga-columnas.test.ts`, `AnaliticaFinancieraExport.test.tsx`,
`TableroFinanciero.test.tsx`, y los tres guardias que no deben caer al añadir esto:
`tablero-financiero.guardia.test.ts` (R28), `columnas-sensibles.guardia.test.ts` (R26) y
`modulo-puro.guardia.test.ts` (R35 de la 122).

**Un hallazgo de esa corrida, ya corregido:** la primera version del guardia de frontera reusaba
los nombres de constante del guardia de pureza de `lib/analytics`, y `modulo-puro.guardia.test.ts`
se puso **rojo** — con razon: R35 de la 122 exige **un solo** guardia de pureza y lo hace cumplir
censando esta misma carpeta. Se renombraron (`CAPAS_SIN_PASO_DESDE_EL_EXPORT`,
`MODULOS_QUE_LEEN_LA_PETICION`) con el motivo escrito en el fuente. Es exactamente el tipo de cosa
que `related` **no** habria detectado: los guardias no se seleccionan por grafo de imports.

**NO se corrio la suite completa** en esta tanda (la corre el leader antes del PR, T7.3).

---

## 5. Lo que NO esta hecho, dicho con todas las letras

1. **El baseline de T0.2 NUNCA se midio en esta rama, y yo no lo reconstrui.** T0.2 pedia
   `pnpm typecheck` verde **y una corrida de la suite medida en este worktree, con el numero total
   de archivos anotado aqui**. Lo unico que puedo afirmar hoy es lo de §4: typecheck verde y 234
   tests de la vecindad + 1155 de guardias en verde. **El numero total de archivos de la suite no
   se ha medido en `C:/w184`**, ni antes ni ahora, asi que cualquier comparacion «antes/despues»
   de esta feature seria un baseline heredado — y los heredados caducan con cualquier PR ajeno.
   No lo medi porque una corrida completa desde este subagente rompe el stream; **queda para el
   leader en T7.3**, donde el gate completo es obligatorio de todas formas. Al medirlo, comparar
   el **numero total de archivos** (~649 en `dev`): una corrida con «unhandled errors» de workers
   omite archivos enteros y parece casi verde.

2. ~~**`pnpm lint` esta ROJO en la rama.**~~ **CERRADO en la tanda siguiente — ver §7.** Se deja
   escrito porque la decision importa: el error venia de `e05df155` (T4.1), **no** de los guardias,
   y se cerro **sin tocar el diseño ni añadir una excepcion**.

3. **T7.2 (anotar las specs de la 134 y la 132) sigue pendiente**: no entraba en esta tanda.

---

## 6. Nota sobre los dos guardias nuevos (por que no caducan)

Los dos **censan el arbol, no el diff**, asi que no llevan cabecera de caducidad y no se vuelven
verdes por vacio al mergear (leccion de `frontera.guardia.test.ts`, retirado en el PR #232). El
subarbol se **recorre**: un archivo nuevo entra en el censo solo. Y **cada bloque trae su
autocomprobacion por fixture sintetico** —un fragmento infractor da positivo, una mencion en prosa
da negativo—, que es el criterio de «NO hecho» de T6.1: sin ella, un regex que dejara de casar
seguiria en verde para siempre.

Dos decisiones del guardia de alcance que conviene no «arreglar» sin leer esto:

- la firma de identificador interno se escribe **sensible a mayusculas**
  (`/^id$|_id$|[a-z0-9]Id$/`) y **no** se reusa la de la guardia de la 170: aquella lleva `/i`, y
  con esa bandera su lookbehind `(?<![a-z])` casa la `a` de `tienda**Id**`, asi que el camel se le
  escapa. La autocomprobacion de (b) lo demuestra sobre `tiendaId`;
- el bloque (c) mide **sobre el string** que devuelve `construirDescarga`, y su autocomprobacion
  construye un archivo que SI lleva la fuga para probar que la sonda la ve. Sin eso, «no hay
  uuids» seria verde por incapacidad.

---

## 7. Cierre del lint rojo de `ExportarVistaFinanciera.tsx` (tanda posterior)

**Que estaba mal.** `react-hooks/refs` marcaba `columnas={columnas.current}`: leer `ref.current`
DURANTE el render. La regla tiene razon —un valor leido en render que cambia sin re-render es justo
lo que no debe pintarse—, pero el diagnostico fino es mas estrecho: **el patron no estaba mal, lo
estaba su expresion**. Ese array no se pinta; se pasa por props para que el generador comun lo lea
mas tarde, en el mismo tick en que `obtenerFilas` resuelve.

**Que se cambio, y es todo:**

```diff
-import { useRef } from "react";
+import { useState } from "react";
...
-  const columnas = useRef<DescargaColumna[]>([...COLUMNAS_DESCARGA_ANALITICA_FINANCIERA]);
+  const [columnas] = useState<DescargaColumna[]>(() => [
+    ...COLUMNAS_DESCARGA_ANALITICA_FINANCIERA,
+  ]);
...
-    columnas.current.splice(0, columnas.current.length, ...preparado.columnas);
+    columnas.splice(0, columnas.length, ...preparado.columnas);
...
-      columnas={columnas.current}
+      columnas={columnas}
```

**Que NO cambio, y es lo importante.** El diseño se conserva entero: sigue habiendo **UNA** sola
instancia estable durante toda la vida del componente (el inicializador perezoso de `useState` se
evalua en el primer render y no vuelve a evaluarse), `obtenerFilas` la sigue **reescribiendo en
sitio** con `splice` justo antes de que el generador la lea, y **nunca se llama al `setState`** —no
es estado que se pinte, es un buzon estable compartido con el control comun—. Un `setState` de
verdad programaria un re-render que llegaria DESPUES del click, y el archivo saldria con las
columnas anteriores; esa alternativa sigue descartada y sigue escrita en el fuente, igual que la
otra (declarar las ocho columnas siempre, que dejaria una «Neto» VACIA donde la verdad es «no
aplica», R13).

El comentario de la cabecera se reescribio para describir lo que el codigo hace **de verdad** (ya
no habla de un ref) sin perder el porque ni las dos alternativas descartadas, y añade la razon de
`useState` sobre `useRef` para que nadie lo revierta creyendolo un despiste.

**No hizo falta ningun `eslint-disable`.**

**Verificacion de esta tanda:**

```
$ pnpm exec eslint app/(app)/analitica/_components/export-financiero/ExportarVistaFinanciera.tsx
(sin salida: verde)

$ pnpm lint
✖ 52 problems (0 errors, 52 warnings)      # los 52 warnings son preexistentes y de otros archivos

$ pnpm typecheck
(sin salida: verde)

$ pnpm exec vitest related --run app/(app)/analitica/_components/export-financiero/ExportarVistaFinanciera.tsx
 Test Files  7 passed (7)
      Tests  174 passed (174)

$ pnpm exec vitest run AnaliticaFinancieraExport.test.tsx TableroFinanciero.test.tsx \
    export-financiero-frontera.guardia.test.ts export-financiero-alcance.guardia.test.ts \
    tablero-financiero.guardia.test.ts
 Test Files  5 passed (5)
      Tests  171 passed (171)
```

Los casos que de verdad juzgan este cambio siguen verdes: *una vista solo_bruto descarga con SU
juego de columnas, sin una columna de neto vacia* (el que fallaria si la instancia dejara de ser
estable o si la mutacion llegara tarde) y los dos censos de frontera RSC del tablero (R28), que el
cambio no toca porque el componente sigue siendo de cliente y sus props siguen siendo planas.

---

## 8. Cierre (leader, 2026-08-10)

**Reviewer: APROBADO** (`progress/review_184.md`) — 30/30 requisitos trazados a tests que miden lo
que piden, verificados **leyendo los treinta**, no por muestreo. Cero bloqueantes, 7 menores.

**T7.2 hecha en este commit**: las dos notas al margen fechadas.
- `specs/134-analitica-export-csv/requirements.md` — su **D1 queda CONSUMIDA**: la ficha propia que
  proponía es esta, y las dos condiciones que puso (la 180 y la 183) se cumplieron antes de empezar.
- `specs/132-analitica-tablero-financiero/design.md` — su región gana un **control de cliente** que
  aquel diseño no previó. `TableroFinanciero` sigue siendo Server Component; lo que deja de ser
  cierto es que bajo esa región no haya nada de cliente.

**`feature_list.json` NO se toca en esta rama, a propósito.** La ficha 184 pasa a `in_progress` en
el **PR #329** (el que repara el JSON inválido de `dev`), con su nota completa. Escribirla también
aquí garantizaría un conflicto textual entre dos PRs abiertos sobre el mismo bloque del mismo
archivo, que es exactamente el ruido que ese PR viene a quitar. El menor 4.2 del review queda así
cubierto, pero por otra rama.

**Menores que NO se cierran aquí, y por qué:**
- **4.5 — la rama XLSX no se ejecuta en ningún caso de esta feature.** R25 comprueba que el menú
  ofrece los dos formatos, pero todos los casos que descargan pulsan CSV: el generador `xlsx` con
  **estas** columnas —incluida la celda larga de `limitacion_conocida`— nunca corre aquí, y la
  aserción de R10 sobre el TEXTO se mide sobre el CSV, no sobre el libro. No es una fuga (el XLSX
  recibe las mismas columnas y filas), pero **es una línea sin recorrer en la feature que la
  introduce**. Merece un caso, y cabe en una tanda corta; se deja anotado en vez de colarlo sin
  spec después del review.
- **4.6 — mutar en sitio un array guardado en `useState` es correcto pero frágil.** Depende de que
  `DescargarDatasetButton` no copie ni memoize la prop. Hoy no lo hace y está comprobado. Si el
  patrón se repite en otra feature, que `obtenerFilas` devuelva **también** sus columnas en vez de
  compartir un buzón mutable.
- **4.7 — el baseline de T0.2 no existe y ya no se puede reconstruir.** Lo cubre de hecho el
  `./init.sh` completo del leader (**1037/1039 archivos · 12.822/12.824 tests**, typecheck y lint
  limpios; los 2 rojos —`descarga-dataset-roundtrip` y el guard `no-embalaje`— verificados **verdes
  en aislado**: flakes por saturación). Lo que no existe es la comparación «antes/después» propia de
  esta rama.
