# 134 — analitica: export CSV · bitacora de implementacion

Rama `feature/134-analitica-export-csv`, worktree `C:/w134`, nacida en `1af04e53`
(spec + puerta T0 cerrada) sobre `origin/dev` en `64957dca`.

**Migraciones: NINGUNA.** Esta feature no crea ni altera tablas ni columnas, y no se
ejecuto ninguna migracion ni rollback.

---

## 1. Baseline, medido aqui

| | Archivos de test | Tests | Rojos | Notas |
| --- | --- | --- | --- | --- |
| **Baseline** (antes de escribir codigo, `pnpm exec vitest run`) | 925 | 11485 | 0 | Sin *unhandled errors* de workers: corrida NO degradada. |
| **Final** (`pnpm exec vitest run`) | 934 | 11527 | 0 | +9 archivos (los 9 de esta feature), +42 tests. |

El baseline se midio en este worktree y no se tomo de ninguna cifra ajena. La comparacion
que vale es la de **ARCHIVOS**: una corrida degradada omite archivos enteros y parece casi
verde con un conteo de tests plausible.

---

## 2. Archivos tocados

**Coinciden EXACTO con `design.md §1`**, salvo la desviacion declarada en §5.

Nuevos:

- `app/(app)/analitica/_components/operativo/export-operativo.ts` — la proyeccion pura.
- `app/(app)/analitica/_components/operativo/ExportarOperativoPanel.tsx` — el control.
- `tests/unit/analytics/export-csv-frontera.guardia.test.ts` — el guardia (4 bloques).
- `tests/unit/analytics/export-csv-{columnas,nulos,cobertura,equivalencia,seudonimizacion,puerta,denegado}.test.ts`
  — los 7 archivos de test que declara el design.
- `tests/components/descarga/AnaliticaExportCsv.test.tsx` — el control montado.

Modificados:

- `app/(app)/analitica/_components/operativo/PanelOperativo.tsx` — **6 lineas anadidas, 0
  borradas** (`git diff --stat`): el import y una insercion de JSX bajo `estado.tipo === "ok"`.
  No se toco `reducirResultados`, ni la clave SWR, ni el contrato de `EstadoPanel`.
- Tres tests existentes del tablero — ver la desviacion §5.

### Comprobacion de frontera manual (T5.3)

`git diff --name-only 1af04e53` (todo lo que esta rama anadio sobre el commit del spec):

```
app/(app)/analitica/_components/operativo/ExportarOperativoPanel.tsx
app/(app)/analitica/_components/operativo/PanelOperativo.tsx
app/(app)/analitica/_components/operativo/export-operativo.ts
tests/components/TableroOperativo.test.tsx
tests/components/TableroOperativoLatencia.test.tsx
tests/components/FiltrosOperativos.test.tsx
tests/components/descarga/AnaliticaExportCsv.test.tsx
tests/unit/analytics/export-csv-cobertura.test.ts
tests/unit/analytics/export-csv-columnas.test.ts
tests/unit/analytics/export-csv-denegado.test.ts
tests/unit/analytics/export-csv-equivalencia.test.ts
tests/unit/analytics/export-csv-frontera.guardia.test.ts
tests/unit/analytics/export-csv-nulos.test.ts
tests/unit/analytics/export-csv-puerta.test.ts
tests/unit/analytics/export-csv-seudonimizacion.test.ts
```

**Ni un archivo de `lib/analytics/`, `lib/actions/`, `lib/services/`, `lib/repositories/`,
`lib/utils/`, `components/shared/`, `db/` ni del subarbol financiero.** Cero rutas nuevas
bajo `app/api/`. `lib/analytics/metrics.ts` (175) y `lib/analytics/consulta.ts` (122) sin
tocar, y no se entro en el subarbol de la 133.

---

## 3. Mapa R -> test NOMBRADO

El caso citado es **el que muere de verdad** con la mutacion de la columna derecha: se
comprobo uno a uno, no se dedujo del nombre.

| R | Archivo | Caso nombrado que cae |
| --- | --- | --- |
| R1 | `export-csv-frontera.guardia.test.ts` | `el subarbol de export no importa servicio, repositorio, Prisma ni el catalogo de servidor` |
| R2 | `export-csv-puerta.test.ts` | `el raw que envia el export es identico al que envia el panel para el mismo filtro` |
| R3 | `export-csv-frontera.guardia.test.ts` | `ninguna ruta de app/api sirve el export de analitica` |
| R4 | `export-csv-frontera.guardia.test.ts` | `ningun modulo "use server" invoca construirDescarga` |
| R5 | `export-csv-denegado.test.ts` | `un forbidden no produce archivo y su mensaje no es el de sin datos` |
| R6 | `export-csv-denegado.test.ts` | `el intento de descarga denegado deja rastro en el logger antes de responder` |
| R7 | `export-csv-columnas.test.ts` | `toda celda del CSV procede de un campo de SerieOperativa` |
| R8 | `export-csv-seudonimizacion.test.ts` | `el CSV de un adminTienda no contiene ningun uuid de mensajero` |
| R9 | `export-csv-seudonimizacion.test.ts` | `el archivo no incluye ningun mapa seudonimo→id ni valor derivado del uuid` |
| R10 | `export-csv-equivalencia.test.ts` | `las filas del CSV son punto por punto las de la serie que pinta el panel` |
| R11 | `export-csv-nulos.test.ts` | `un valor null se escribe como celda vacia y jamas como 0` |
| R12 | `export-csv-columnas.test.ts` | `cada fila declara la unidad de su metrica` |
| R13 | `export-csv-cobertura.test.ts` | `la fila del dia en curso se marca parcial y lleva su corte` |
| R14 | `export-csv-cobertura.test.ts` | `las fechas bajo el horizonte del historial se marcan no comparables en su fila` |
| R15 | `export-csv-cobertura.test.ts` | `el archivo declara la penumbra sin estimarla` |
| R16 | `tests/components/descarga/AnaliticaExportCsv.test.tsx` | `superar el tope no produce archivo truncado sino el mensaje accionable` |
| R17 | `tests/components/descarga/AnaliticaExportCsv.test.tsx` | `sin puntos no se genera archivo y se avisa sin datos` |
| R18 | `export-csv-denegado.test.ts` | `un validation_error no produce archivo y no llama al logger` |
| R19 | `export-csv-frontera.guardia.test.ts` | `el export vive en su subarbol y reusa el patron 151 sin reimplementarlo` |
| R20 | `export-csv-columnas.test.ts` | `el nombre del archivo lo produce nombreArchivoDescarga` (+ el bloque 4 del guardia, que censa el arbol) |
| R21 | `tests/components/descarga/AnaliticaExportCsv.test.tsx` | `el control ofrece CSV y XLSX y no declara un dialecto propio` |

**Nota sobre los nombres de archivo.** `requirements.md` cita `export-csv-tope.test.ts` y
`export-csv-vacio.test.ts` para R16/R17. `tasks.md > T4.3` los consolida en
`tests/components/descarga/AnaliticaExportCsv.test.tsx`, junto al resto de tests de descarga
del repo, porque los dos casos exigen el control MONTADO (el tope y el aviso de «sin datos»
los aplica `DescargarDatasetButton`, no la proyeccion). Queda anotado aqui, como pedia T4.3.

---

## 4. Mutaciones: 21 aplicadas, 21 muertas

> **REVERIFICACION EN CURSO tras el refactor `8f485b03`** (que extrajo las columnas y la
> proyeccion de una fila a `analitica-operativa-descarga-columnas.ts`). La tabla de abajo es la
> de ANTES del refactor y varios de sus anclajes ya no viven donde dice. La tabla buena, medida
> contra la disposicion de HOY, se esta escribiendo en §4bis. **No creerse esta hasta que §4bis
> este completa.**



Procedimiento para cada una: aplicar la mutacion → **comprobar con `grep` que aterrizo en
disco** → correr el caso NOMBRADO → comprobar el rojo → revertir. Ninguna mutacion quedo
commiteada; `git status` limpio y `git diff --stat` vacio despues de cada una.

| R | Mutacion aplicada | Aterrizo (grep) | Resultado |
| --- | --- | --- | --- |
| R1 | el modulo de export importa `AnaliticaOperativaService` | `AnaliticaOperativaService` en `export-operativo.ts` | **MUERTA** |
| R2 | el export construye su propio filtro (`{ rango: filtro.rango }`) en vez de `aRaw` | `const raw = { rango: filtro.rango }` | **MUERTA** |
| R3 | nace `app/api/analitica/export/route.ts` | el archivo existe | **MUERTA** |
| R4 | `lib/actions/analitica-operativa.ts` (`"use server"`) invoca `construirDescarga` | `const generar = construirDescarga` | **MUERTA** |
| R5 | el `forbidden` se traduce a `{ status: "ok", filas: [] }` | `return { status: "ok", filas: [] }` | **MUERTA** |
| R6 | un corte previo convierte el denegado en error generico ANTES de llamar a la accion | `m.metricaId === "egresos"` | **MUERTA** |
| R7 | se anade la columna «Mensajero (nombre)» | `"mensajero_nombre"` | **MUERTA** |
| R8 | se retira `seudonimizarPuntos` del servicio | el ancla desaparece de `AnaliticaOperativaService.ts` | **MUERTA** (salida en §4.1) |
| R9 | se emite una columna `mensajero_ref` | `"mensajero_ref"` | **MUERTA** |
| R10 | el export filtra los puntos con `valor === null` | `filter((p) => p.valor !== null)` | **MUERTA** |
| R11 | `valor: punto.valor ?? 0` | `punto.valor ?? 0` | **MUERTA** |
| R12 | se elimina la columna de unidad | el ancla desaparece de `export-operativo.ts` | **MUERTA** |
| R13 | deja de propagarse `corteAt` a la fila | `corte_at: null,` | **MUERTA** |
| R14 | se ignora `cobertura.fechasNoComparables` | `if (false) return COBERTURA_NO_COMPARABLE` | **MUERTA** |
| R15 | se omite la declaracion de la penumbra | `limitacion_conocida: null,` | **MUERTA** |
| R16 | `filas.slice(0, 5000)` antes del tope | `.slice(0, 5000)` | **MUERTA** |
| R17 | sin puntos se emite igualmente un archivo de cabecera sola | `proyectadas.length === 0 ? [{}]` | **MUERTA** |
| R18 | el borde audita tambien el `validation_error` | `motivo: "filtro_invalido"` | **MUERTA** |
| R19 | nace un `buildCsvRowsAnalitica` dentro del subarbol | `buildCsvRowsAnalitica` | **MUERTA** |
| R20 | el nombre del archivo se compone a mano en el subarbol | `nombreDelArchivo` | **MUERTA** |
| R21 | `formatos: ["csv"]` | `= ["csv"];` | **MUERTA** |

Dos apuntes de honestidad sobre COMO mueren:

- **R16 y R17** mueren por *timeout* de un `waitFor`, no por una asercion de igualdad: bajo la
  mutacion el control SI produce archivo, asi que el toast de error nunca llega y
  `expect(toastErrorMock).toHaveBeenCalledTimes(1)` no se cumple nunca. El rojo es real y por
  la razon correcta (y los mismos casos comprueban ademas que `buildCsvRows` y `descargarBlob`
  no se invocan), pero conviene saber que la forma del fallo es un timeout.
- **R9** se mata con una mutacion propia (`mensajero_ref`) y no reusando la de R8: la de R8
  tambien lo pone rojo, pero eso probaria R8 dos veces. La columna `mensajero_ref` es el mapa
  de vuelta que R9 prohibe, y cae por la comprobacion de cabecera palabra a palabra.


### 4bis. Reverificacion contra la disposicion de HOY (post-refactor)

Procedimiento por mutacion: aplicar -> **`grep` que aterrizo en disco** -> correr el CASO
NOMBRADO -> comprobar el rojo -> revertir y comprobar `git status` limpio.

| R | Archivo mutado HOY | Mutacion | Aterrizo (grep) | Caso nombrado | Resultado |
| --- | --- | --- | --- | --- | --- |
| R1 | `export-operativo.ts` | importa `AnaliticaOperativaService` | linea 17 | `el subarbol de export no importa servicio, repositorio, Prisma ni el catalogo de servidor` | **MUERTA** |
| R2 | `ExportarOperativoPanel.tsx` | `const raw = { rango: filtro.rango }` en vez de `aRaw` | linea 101 | `el raw que envia el export es identico al que envia el panel para el mismo filtro` | **MUERTA** |
| R3 | `app/api/analitica/export/route.ts` (nace) | ruta de api que sirve el export | el archivo existe | `ninguna ruta de app/api sirve el export de analitica` | **MUERTA** |
| R4 | `lib/actions/analitica-operativa.ts` | el modulo `"use server"` invoca `construirDescarga` | lineas 3-4 | `ningun modulo "use server" invoca construirDescarga` | **MUERTA** |
| R5 | `ExportarOperativoPanel.tsx` | el `forbidden` se traduce a `{ status: "ok", filas: [] }` | linea 121 | `un forbidden no produce archivo y su mensaje no es el de sin datos` | **MUERTA** |
| R6 | `ExportarOperativoPanel.tsx` | corte previo que evita la accion (`metricaId === "egresos"`) | linea 102 | `el intento de descarga denegado deja rastro en el logger antes de responder` | **MUERTA** |
| R16 | `ExportarOperativoPanel.tsx` | `.slice(0, 5000)` antes del tope | linea 153 | `superar el tope no produce archivo truncado sino el mensaje accionable` | **MUERTA** (timeout de `waitFor`) |
| R17 | `ExportarOperativoPanel.tsx` | sin puntos se emite igualmente una fila | linea 154 | `sin puntos no se genera archivo y se avisa sin datos` | **MUERTA** (timeout de `waitFor`) |
| R19 | `app/(app)/analitica/_components/operativo/generador-propio.ts` (nace) | `buildCsvRowsAnalitica` propio en el subarbol | el archivo existe | `el export vive en su subarbol y reusa el patron 151 sin reimplementarlo` | **MUERTA** |
| R21 | `ExportarOperativoPanel.tsx` | `FORMATOS_EXPORT_OPERATIVO = ["csv"]` | linea 58 | `el control ofrece CSV y XLSX y no declara un dialecto propio` | **MUERTA** |

**PENDIENTES de reverificar:** R7, R8, R9, R10, R11, R12, R13, R14, R15, R18, R20.

### 4.1 T3.1 — la task BLINDADA: salida de la mutacion

Mutacion aplicada en `lib/services/AnaliticaOperativaService.ts:503-505`, sustituyendo

```ts
    return dimension === "mensajero"
      ? seudonimizarPuntos(puntos, consulta.politicaIdentidad)
      : puntos;
```

por `return puntos;`. Comprobado en disco con `grep -n "seudonimizarPuntos"`: tras la
mutacion solo quedan la definicion (`:818`) y una mencion en comentario (`:760`); la llamada
de `:504` ya no esta.

Salida de `pnpm exec vitest run tests/unit/analytics/export-csv-seudonimizacion.test.ts`
CON la mutacion aplicada:

```
 ❯ tests/unit/analytics/export-csv-seudonimizacion.test.ts (4 tests | 2 failed)

 FAIL  Feature 134 (R8) — el archivo de un adminTienda no lleva identidades
       > el CSV de un adminTienda no contiene ningun uuid de mensajero
AssertionError: expected 'Fecha,Metrica,Desglose,Valor,Unidad,C…' not to contain
'3f0a7c62-1111-4a1e-9e21-aaaaaaaaaaaa'

- Expected
+ Received

- 3f0a7c62-1111-4a1e-9e21-aaaaaaaaaaaa
+ Fecha,Metrica,Desglose,Valor,Unidad,Cobertura,Corte,Limitacion conocida
+ 2026-08-01,Entregas,3f0a7c62-1111-4a1e-9e21-aaaaaaaaaaaa,5,conteo,completo,,ordenes_vivas_al_horizonte_sin_transicion_posterior
+ 2026-08-01,Entregas,3f0a7c62-2222-4a1e-9e21-bbbbbbbbbbbb,3,conteo,completo,,ordenes_vivas_al_horizonte_sin_transicion_posterior

 ❯ tests/unit/analytics/export-csv-seudonimizacion.test.ts:80:27
     78|
     79|     // (1) La asercion sobre EL TEXTO del archivo.
     80|     expect(contenido).not.toContain(UUID_A);
       |                           ^

 FAIL  Feature 134 (R9) — ninguna celda permite recuperar el id real
       > el archivo no incluye ningun mapa seudonimo→id ni valor derivado del uuid
AssertionError: expected 'Fecha,Metrica,Desglose,Valor,Unidad,C…' not to contain '3f0a'

 Test Files  1 failed (1)
      Tests  2 failed | 2 passed (4)
```

**Las dos lineas de datos del CSV con los uuids reales dentro son exactamente la fuga que
esta feature existe para impedir.** El servicio se restauro acto seguido (`git diff --stat`
vacio) y la mutacion NO esta commiteada.

Las cuatro reglas del criterio de «NO HECHO», una por una:

1. **Asercion sobre el STRING**, no sobre el objeto: `expect(contenido).not.toContain(UUID_A)`,
   `not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i)` y `toContain("Mensajero 1")` sobre
   lo que devuelve `construirDescarga({tipo:"csv", …})`.
2. **Fixture con uuids de verdad** (`3f0a7c62-1111-4a1e-9e21-aaaaaaaaaaaa` y su gemelo), y un
   caso propio —`y la fixture lleva uuids de verdad`— que cae si alguien la «simplifica» a
   etiquetas ya limpias.
3. **Cadena completa**: `rollupFalso` con uuids → `AnaliticaOperativaService` real →
   `consultarAnaliticaOperativa` con `getActor: adminTienda` → `filasDeSerie` →
   `construirDescarga`. Un tercer caso comprueba que el repositorio recibio llamadas, para que
   cortocircuitar el servicio se note.
4. **Mutacion ejecutada y su salida pegada aqui.**

---

## 5. Desviaciones respecto de `design.md`, con su motivo

**Unica desviacion: tres tests existentes del tablero se envuelven en `ToastProvider`.**

- Archivos: `tests/components/TableroOperativo.test.tsx`,
  `tests/components/TableroOperativoLatencia.test.tsx`,
  `tests/components/FiltrosOperativos.test.tsx`.
- Que se cambio: **solo el envoltorio del `render()`** (mas su import). Ni una asercion, ni un
  mock, ni un dato de fixture.
- Por que fue necesario: `PanelOperativo` monta ahora `ExportarOperativoPanel`, que envuelve
  `DescargarDatasetButton`, y ese control llama a `useToast()`, que **lanza** fuera de un
  `ToastProvider` (`hooks/useToast.ts:19`). En la app real el provider vive en el layout, asi
  que la pantalla funciona; eran esos tres tests los que renderizaban el tablero desnudo. Sin
  el envoltorio, 20 tests ajenos se ponian rojos por una excepcion de contexto.
- Por que NO se resolvio de otra forma: no hay manera limpia de que un componente detecte si
  existe un provider, y esconder el control cuando no lo hay seria escribir codigo de
  produccion para complacer a un test. Envolver el render es ademas **la convencion del
  repo**: todos los tests de descarga (`tests/components/descarga/*`) montan `ToastProvider`.
- **No se relajo ninguna asercion ni ningun guardia para poner nada en verde.**

Nada mas se aparta del design: la financiera queda fuera (D1), no hay cabecera de metadatos
(D4), el dialecto CSV no se toca y se ofrece XLSX (D5), la cobertura viaja en columnas por
fila (D3) y hay un archivo por panel (D6).

---

## 6. El guardia: por que NO caduca, y que se comprobo

`tests/unit/analytics/export-csv-frontera.guardia.test.ts` **no lleva cabecera de caducidad
porque no la necesita**: sus cuatro bloques censan EL ARBOL, no el diff contra ninguna rama.
Ninguno afirma nada sobre «lo que esta rama cambio», que es justo la clase de afirmacion que
se vuelve falsa —o verde por vacio— en cuanto la rama se mergea (leccion de
`frontera.guardia.test.ts`, retirado en el PR #232, y del bloque branch-scoped que la 131
retiro en su propio PR).

**Comprobacion exigida por la leccion de la 128 — ningun guardia perenne cuelga de otro que
caduque:** los cuatro bloques son independientes entre si. Ninguno lee el resultado de otro,
ninguno comparte estado y ninguno consume una lista construida por otro; cada uno recorre el
arbol por su cuenta. Retirar cualquiera de ellos dejaria a los otros tres diciendo exactamente
lo mismo que dicen hoy. Y no se movio ni se retiro ningun guardia ajeno: los de la 131
(`tablero-operativo-frontera.guardia.test.ts`) y los de la 126 siguen intactos y verdes.

Cada bloque trae su **autocomprobacion con fixture sintetico** (`el censo DISCRIMINA`): un
fragmento infractor en memoria da positivo y una mencion en prosa da negativo, de modo que
unas expresiones regulares que no casaran con nada no puedan pasar por un arbol limpio.
Ademas, cada bloque asierta que **el censo mira archivos de verdad** (`> 4`, `> 5`).

---

## 7. E2E (T5.5)

**No se escribe.** `design.md §8` lo declara opcional y `CHECKPOINTS.md` no lo exige para este
flujo, que no es auth, pagos, recaudo, ingesta ni webhook. Decision registrada aqui como pedia
la task; si el humano lo pide, el spec ya propone el caso minimo
(`e2e/analitica-export.spec.ts`: el click produce un `download` con el nombre esperado).

---

## 8. Verificacion final

- `pnpm exec tsc --noEmit`: **verde**, 0 errores.
- `pnpm exec eslint` sobre todos los archivos tocados: **0 errores, 0 warnings**.
- `pnpm exec vitest run` completo: **934 archivos, 11527 tests, 0 rojos**.
- `pnpm run test:guardias`: verde, con los cuatro bloques nuevos censando archivos de verdad.
- No se ejecuto `pnpm build` (encadena `migrate-deploy` contra una base real). No hizo falta
  build: esta feature no cambia ninguna frontera RSC —`ExportarOperativoPanel` es
  `"use client"` y lo monta un componente que ya lo era—.
