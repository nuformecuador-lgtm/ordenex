# 184 — la parte FRONTEND de la Tanda B (consolidación: listados 6 y 7)

> Rama: `feature/184-deuda-170-listados` · Fecha: 2026-08-04 · Rol: FRONTEND_DEV
>
> Alcance entregado: **B.2 y B.3**. Punto de partida: `progress/impl_188_tandaB_backend.md` (las
> dos Server Actions ya estaban, verdes y con 18 mutaciones). `lib/**`, `db/**` y los tests de
> backend **no se tocan**.
>
> **Veredicto en una línea: los dos listados más caros del inventario ya usan su lectura
> dedicada, así que la relectura de cuatro consultas + cinco agregados + reparto de efectivo
> queda desconectada de verdad y no solo escrita — 14 mutaciones ejecutadas, las 14 rojas, y
> `PENDIENTES_184` baja de once a NUEVE.**

---

## 1. Qué se hizo

Dos commits, uno por listado, cada uno con **la pantalla y su línea del censo dentro**. Es lo que
`tasks.md > Notas de ejecución` exige y lo que impide que el censo mienta entre dos commits; las
mutaciones M2 y M9 lo miden en el sentido que faltaba (mover el censo sin mover la pantalla).

### B.2 — listado 6, «Cierres de bodega solicitados»

`app/(app)/cierres-admin/_components/CierresBodegaSolicitadosTabla.tsx`:

| Antes (T I.2) | Ahora (T B.2) |
| --- | --- |
| `filasDelConjuntoCompleto(listarConsolidacion().then(res => …cierresBodegaPasados), …)` | `filasDesdeResultado(listarCierresBodegaSolicitadosCompleto(), filaDescargaBodegaSolicitado)` |
| el archivo salía del listado **compuesto**: 4 consultas, los 5 agregados de dinero y el reparto del efectivo, para quedarse con **un** campo | una lectura dedicada: una consulta, cero aritmética de dinero |
| tope de 5000 evaluado en el **cliente** (`filasLocales` dentro del adaptador) | tope evaluado en el **servidor** (R6): por encima no viaja ni una fila |

### B.2 — listado 7, «Cierres del día a consolidar»

`app/(app)/cierres-admin/_components/ConsolidacionBodegaModule.tsx`: idéntico, con
`listarConsolidablesCompleto()` y `filaDescargaConsolidable`.

El comentario que había allí defendía la relectura con un argumento real —«el archivo y los
totales de la cabecera hablan del mismo conjunto»— y por eso **no se borró, se corrigió**: siguen
hablando del mismo conjunto (los consolidables de la zona), solo que ahora cada uno lo lee por su
lado. Lo que se deja de pagar es el reparto del efectivo entre TODOS los pagos individuales de la
zona, ordenados de menor a mayor, que es de donde salen `totalNetoAgregado` y
`totalCentralDebeAgregado` y que **el archivo no usa para nada**.

**Los cinco agregados de dinero NO se tocaron.** Siguen siendo props calculadas por
`listarConsolidacion` sobre el conjunto completo (R49/R50 de la 170). Tampoco se tocó el contador
`({pagina.total})` de la sección, que sale del `total` del servidor.

### B.3 — el censo, en el MISMO commit que cada pantalla

`tests/components/paginacion/paginacion-transversal.test.tsx`: los dos listados pasan a
`adaptador: "completo"` y salen de `PENDIENTES_184`. **Quedan nueve.**

### Efecto colateral, medido y anotado

Tras B.2, **`listarConsolidacion()` tiene un solo consumidor de producción**:
`app/(app)/cierres-admin/page.tsx:73`, el Server Component que resuelve la pantalla. Los dos
consumidores de cliente desaparecen aquí. Es el mismo patrón que la tanda A dejó con
`listarRecepcionSatelite()`, y **no se actúa sobre él**: reducir ese contrato es un cambio de
superficie que ningún requisito de esta feature necesita. Queda anotado para quien lo decida.

---

## 2. Archivos

**Producción (2)**

- `app/(app)/cierres-admin/_components/CierresBodegaSolicitadosTabla.tsx` — el adaptador, el
  import de la acción nueva y el comentario que explica qué se dejó de pagar.
- `app/(app)/cierres-admin/_components/ConsolidacionBodegaModule.tsx` — ídem.

**Tests (4)**

- `tests/components/descarga/CierresDescarga.test.tsx` — **+8 casos (6 → 14)**, cuatro por
  listado, más los dos dobles nuevos y un doble de `useToast` inspeccionable.
- `tests/components/paginacion/paginacion-transversal.test.tsx` — B.3 (los dos `adaptador` y las
  dos líneas de `PENDIENTES_184`).
- `tests/components/paginacion/BajoRiesgoPaginacion.test.tsx` — **peaje** (§4).
- `tests/components/paginacion/ColasPaginacion.test.tsx` — **peaje** (§4).

**Cero** cambios en `lib/**`, `db/**`, `components/**`, `feature_list.json` ni en la
configuración de `useSWR` de ninguna pantalla (**R33**: el objeto de opciones de `useSWR` de las
dos pantallas no aparece en el diff).

---

## 3. Las 14 mutaciones, con su salida

Cada una: se rompe el código de verdad, se corre, se restaura **solo el archivo mutado**. El
guion imprime al final de cada una qué archivos míos quedan sucios; salió `[]` las 14 veces.

### Lote del listado 6 (7)

```
=== M1 (B.2/R1) la pantalla del listado 6 vuelve a sacar el archivo del listado COMPUESTO
     × el archivo de los cierres de bodega solicitados sale de su lectura DEDICADA, no del listado compuesto (R1/R8) 72ms
     × descargar los cierres de bodega solicitados no cuesta los agregados de dinero de la cabecera (R10) 148ms
     × la pantalla NO recorta ni reordena el conjunto que devolvió el servidor (R2) 113ms
     × un fallo de la lectura del conjunto no produce archivo y el mensaje no lleva datos personales (R7) 1113ms
     × ninguno de los TRECE proyecta el array de la página: el archivo va al servidor 9ms
AssertionError: Cierres de bodega solicitados: su descarga no va al servidor por el conjunto (R52):
              expected '"use client";…' to match /filasDesdeResultado\(/
      Tests  5 failed | 19 passed (24)

=== M2 (B.3/R30) el censo declara el listado 6 pendiente aunque su pantalla ya migro
     × ninguno de los TRECE proyecta el array de la página: el archivo va al servidor 12ms
AssertionError: Cierres de bodega solicitados: su descarga no va al servidor por el conjunto (R52):
              expected '"use client";…' to match /filasDelConjuntoCompleto\(/
      Tests  1 failed | 23 passed (24)

=== M3 (B.2/R4/R17) la descarga del 6 viaja con el recorte de pagina
     × el archivo de los cierres de bodega solicitados sale de su lectura DEDICADA… (R1/R8) 135ms
AssertionError: expected [ { page: 1, pageSize: 25 } ] to deeply equal []
      Tests  1 failed | 23 passed (24)

=== M4 (B.2/R10) se relee ADEMAS el listado compuesto: mismo archivo, con los agregados de vuelta
     × el archivo de los cierres de bodega solicitados sale de su lectura DEDICADA… (R1/R8) 104ms
     × descargar los cierres de bodega solicitados no cuesta los agregados de dinero de la cabecera (R10) 117ms
AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times
      Tests  2 failed | 22 passed (24)

=== M5 (B.2/R2) la pantalla del 6 recorta en el navegador lo que devolvio el servidor
     × la descarga sigue entregando el dataset completo, no la página (R52) 1632ms
AssertionError: Cierres de bodega solicitados: el archivo trae la PÁGINA, no el conjunto:
              expected [ Array(25) ] to have a length of 60 but got 25
      Tests  1 failed | 23 passed (24)

=== M6 (B.2/R7) un fallo del 6 se degrada a la pagina visible en vez de no producir archivo
     × un fallo de la lectura del conjunto no produce archivo y el mensaje no lleva datos personales (R7) 1102ms
AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
      Tests  1 failed | 23 passed (24)

=== M7 (B.2/R2) la pantalla del 6 REORDENA en el navegador lo que devolvio el servidor
     × la pantalla NO recorta ni reordena el conjunto que devolvió el servidor (R2) 124ms
AssertionError: expected [ 'Aprobado', 'Rechazado' ] to deeply equal [ 'Rechazado', 'Aprobado' ]
      Tests  1 failed | 29 passed (30)
```

### Lote del listado 7 (7)

```
=== M8 (B.2/R1) la pantalla del listado 7 vuelve a sacar el archivo del listado COMPUESTO
     × el archivo de los consolidables sale de su lectura DEDICADA, no del listado compuesto (R1/R8) 115ms
     × descargar los consolidables no cambia el contador ni los agregados de la cabecera (R10/R26) 107ms
     × la pantalla NO recorta ni reordena el conjunto de consolidables que devolvió el servidor (R2) 98ms
     × un fallo de la lectura de los consolidables no produce archivo y el mensaje no lleva datos personales (R7) 1117ms
     × ninguno de los TRECE proyecta el array de la página: el archivo va al servidor 13ms
      Tests  5 failed | 29 passed (34)

=== M9 (B.3/R30) el censo declara el listado 7 pendiente aunque su pantalla ya migro
     × ninguno de los TRECE proyecta el array de la página: el archivo va al servidor 20ms
AssertionError: Cierres del día a consolidar: su descarga no va al servidor por el conjunto (R52):
              expected '"use client";…' to match /filasDelConjuntoCompleto\(/
      Tests  1 failed | 33 passed (34)

=== M10 (B.2/R4/R17) la descarga del 7 viaja con el recorte de pagina
     × el archivo de los consolidables sale de su lectura DEDICADA… (R1/R8) 111ms
AssertionError: expected [ { page: 1, pageSize: 25 } ] to deeply equal []
      Tests  1 failed | 33 passed (34)

=== M11 (B.2/R10) se relee ADEMAS el listado compuesto en el 7
     × el archivo de los consolidables sale de su lectura DEDICADA… (R1/R8) 210ms
     × descargar los consolidables no cambia el contador ni los agregados de la cabecera (R10/R26) 155ms
AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times
      Tests  2 failed | 32 passed (34)

=== M12 (B.2/R2) la pantalla del 7 proyecta la PAGINA que pinta en vez del conjunto
     × la pantalla NO recorta ni reordena el conjunto de consolidables que devolvió el servidor (R2) 160ms
     × la descarga sigue entregando el dataset completo (R52) 2028ms
AssertionError: Cierres del día a consolidar: el archivo trae la PÁGINA, no el conjunto:
              expected [ …(25) ] to have a length of 60 but got 25
      Tests  2 failed | 32 passed (34)

=== M13 (B.2/R7) un fallo del 7 se degrada a la pagina visible
     × un fallo de la lectura de los consolidables no produce archivo… (R7) 1501ms
AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
      Tests  1 failed | 33 passed (34)

=== M14 (B.2/R2) la pantalla del 7 REORDENA en el navegador lo que devolvio el servidor
     × la pantalla NO recorta ni reordena el conjunto de consolidables que devolvió el servidor (R2) 185ms
AssertionError: expected [ 'Mensajero 1', 'Mensajero 2', …(1) ] to deeply equal [ Array(3) ]
      Tests  1 failed | 33 passed (34)
```

### Qué mide cada par, y por qué hacen falta las dos mitades

**M1/M8 son las mutaciones que miden la tanda entera**: revierten la pantalla al estado del
2026-08-03 y ponen rojos **a la vez** los casos de conducta (el archivo vuelve al listado
compuesto) y el **censo** (la pantalla declara `completo` pero llama al otro adaptador).

**M2/M9 son su espejo**: mover la línea del censo sin tocar la pantalla también es rojo. Sin esta
mitad, el censo podría quedar diciendo que un listado está cerrado cuando no lo está — que es
exactamente el riesgo por el que `tasks.md` obliga a que pantalla y censo vayan juntas.

**M4/M11 son las que miden lo que esta tanda AHORRA, y no el archivo que produce.** El código
mutado llama a `listarConsolidacion()` **y tira el resultado**: mismo archivo, mismas filas, mismo
orden, misma pantalla. Es indistinguible por el xlsx. Lo único que lo caza es el caso que cuenta
las llamadas al listado compuesto, y por eso ese `expect` no es decorado: si se quita, la deuda
puede volver sin que nada falle.

**M7/M14 justifican que el caso de R2 exista** además del R52 de `BajoRiesgoPaginacion`. M5 y M12
—«recortar a la página»— las caza también la guardia vieja, así que por sí solas no probarían que
el caso nuevo sirva de algo. M7 y M14 no recortan: **reordenan** en el navegador (un orden
alfabético de cliente, que es el defecto que Q-I2/Q-L3 ya dejaron escrito en este repo), y ahí la
guardia vieja pasa verde porque el archivo sigue teniendo 60 filas. **Solo el caso de R2 las
mata.**

**Ninguna mutación quedó verde**, así que no hubo código inalcanzable que retirar (la tanda A sí
tuvo una, `SIN_FILAS`).

---

## 4. El peaje de los `vi.mock` ajenos, y su forma exacta

El backend dejó enumerados tres candidatos. Medidos uno a uno, **el peaje se cobró en dos**:

| Archivo | ¿Rompió? | Por qué |
| --- | --- | --- |
| `tests/components/paginacion/BajoRiesgoPaginacion.test.tsx` | **sí**, con el listado 6 | descarga esa tabla desde la página 2 (su caso de R52) |
| `tests/components/paginacion/ColasPaginacion.test.tsx` | **sí**, con el listado 7 | descarga la tabla de consolidables |
| `tests/components/CierresAdminPage.test.tsx` | **no** | renderiza la pantalla pero no pulsa ninguno de los dos controles |

**La forma del fallo no es la que el aviso anticipaba, y conviene que la siguiente tanda lo sepa.**
El archivo **no** revienta al importar: con la transformación de vite, `import { x } from "m"` se
resuelve en el punto de uso, así que un export no declarado en la factoría solo se nota **cuando
se llama**. El síntoma es un `AssertionError: expected "vi.fn()" to be called 1 times, but got 0
times` en el caso de descarga —el control llama a `undefined`, la promesa se rompe y no sale
archivo—, no un error de módulo. Es peaje igual, pero se busca en otro sitio.

Corolario práctico: `pnpm exec vitest related --run <pantalla>` **no basta** para enumerarlo; hay
que mirar además cuáles de esos archivos **pulsan el control de descarga**. `CierresAdminPage`
está en la lista de `related` y no se rompió; si mañana alguien le añade un caso de descarga, se
romperá.

En los dos archivos el arreglo es el mismo: declarar el export nuevo en la factoría con **su
propio doble** (`completo.bodegaSolicitados`, `completo.consolidables`) y programarlo en el
montaje. El doble del listado compuesto **se conserva** en los dos: que el archivo ya no salga de
él tiene que ser una decisión de la pantalla, no una consecuencia de que el doble no responda.

---

## 5. El flake de jsdom

Los cuatro casos nuevos por listado dependen del reloj de `waitFor` (**1.000 ms**, no el
`testTimeout` de 20 s), así que se aplicaron los tres mecanismos:

- **Anclas positivas.** Los tres casos de éxito anclan a la **entrega del blob**
  (`waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1))`) y el de fallo —que por
  definición no produce archivo— al **toast**, una presencia. Por eso el doble de `useToast` de
  este archivo pasó a ser inspeccionable (`vi.hoisted`), como ya lo era el de la tanda A. Ninguna
  espera es «que no haya X»: eso se cumple también antes de empezar.
- **Nada anclado a trabajo pesado real.** `exceljs` (`buildXlsxRows`) y `descargarBlob` siguen
  aislados en este archivo; el ancla es la entrega del blob, no la generación de la hoja.
- **Verificado bajo carga**, no en aislado: §6.1.

---

## 6. Puertas (medición real)

```
$ pnpm run typecheck
> tsc --noEmit
=== typecheck exit: 0

$ pnpm exec eslint .
✖ 44 problems (0 errors, 44 warnings)     # AJENAS y preexistentes; en mis 6 archivos: 0

$ pnpm exec eslint <los 6 archivos tocados>
(sin salida: 0 errores, 0 warnings)

$ pnpm exec vitest run tests/components/descarga/CierresDescarga.test.tsx
 Test Files  1 passed (1) · Tests  14 passed (14)

$ pnpm exec vitest run tests/components/descarga/CierresDescarga.test.tsx \
    tests/components/paginacion/{paginacion-transversal,ColasPaginacion,BajoRiesgoPaginacion}.test.tsx
 Test Files  4 passed (4) · Tests  34 passed (34)

$ pnpm exec vitest run guard
 Test Files  61 passed (61)
      Tests  830 passed (830)
   Duration  20.75s
```

**Rojos propios: cero.** La suite completa NO se corre aquí: el gate (`./init.sh`) lo corre el
LEADER.

### 6.1 Bajo carga

```
$ pnpm exec vitest run tests/components        # pasada 1
 Test Files  1 failed | 157 passed (158)
      Tests  2 failed | 1908 passed (1910)
   Duration  577.87s

$ pnpm exec vitest run tests/components        # pasada 2
 Test Files  158 passed (158)
      Tests  1910 passed (1910)
   Duration  144.66s
```

**Los dos rojos de la pasada 1 son AJENOS y son flakes de jsdom, no una regresión.** Detalle,
porque «ajeno» sin evidencia no vale:

- `tests/components/LoginForm.test.tsx` → «R15: invoca verifyChallenge con { challengeId, code }
  cuando el codigo es valido» (`expected "vi.fn()" to be called 1 times, but got 0 times`).
- `tests/components/RegistrarPagoDialog.test.tsx` → «también conserva la clave si el diálogo se
  CIERRA y se vuelve a abrir tras fallar».

Ninguno de los dos archivos aparece en mi diff, ninguno importa las pantallas ni las acciones de
esta tanda, y su último commit es de la feature 172. Los dos **pasan en aislado** (`2 archivos,
70 casos verdes`) y los dos **pasan en la pasada 2**. La pasada 1 duró **577 s frente a 145 s de
la pasada 2** —cuatro veces más— porque el worktree estaba compartido con otro agente corriendo
su propia suite: es exactamente el escenario en que vence el presupuesto de 1.000 ms de
`waitFor`. **No los arreglo**: son rojos ajenos y el encargo dice reportarlos.

---

## 7. Mapa `R<n>` → archivo + nombre del caso

Construido **leyendo el caso**, no contando `R\d+` en títulos. Solo se listan los requisitos que
esta entrega toca; los del servidor están en `progress/impl_188_tandaB_backend.md §5`.

| R | Archivo | Caso | Estado |
| --- | --- | --- | --- |
| R1 | `tests/components/descarga/CierresDescarga.test.tsx` + `paginacion-transversal.test.tsx` | «el archivo de los cierres de bodega solicitados sale de su lectura DEDICADA, no del listado compuesto (R1/R8)» y «el archivo de los consolidables sale de su lectura DEDICADA…» (afirman la acción nueva con 1 llamada y `listarConsolidacion` con **ninguna**), + «ninguno de los TRECE proyecta el array de la página» (estático: los dos módulos declaran `completo` y **deben** contener `filasDesdeResultado(`) | ✔ **cierra aquí** para los listados 6 y 7 |
| R2 | `CierresDescarga.test.tsx` + el censo | «la pantalla NO recorta ni reordena el conjunto que devolvió el servidor (R2)» y su gemelo de consolidables: el doble devuelve **una fila más** de las que la tabla pinta y en un orden que un orden de cliente cambiaría; el archivo trae todas, en ESE orden. La mitad estática es la negativa de T0.2: los módulos **no pueden** contener `filasDelConjuntoCompleto(`. Medido con M7/M14, que el R52 viejo NO caza | ✔ |
| R3 | — | **no aplica a estos dos listados, y es medible**: ninguno tiene filtros (su schema de página solo llevaba `page`/`pageSize`). Lo afirmable en su lugar es que **no viaja ninguna clave**, y eso sí se afirma: `expect(mock.calls[0]).toEqual([])` en los dos casos de R1 | ✔ como «no hay filtros que llevar» |
| R4 | `CierresDescarga.test.tsx` | el mismo `toEqual([])`: la entrada no lleva `zonaId` ni ninguna otra clave de alcance. El guard de rol y la zona son del servicio (backend §5) | ✔ cliente |
| R6 | — | el tope lo evalúa el servidor y lo redacta `filasDesdeResultado`; sus casos viven en `consolidacion-completo.test.ts` y `ControlDescargaTransversal.test.tsx`, verdes sin tocar | ✔ sin cambios |
| R7 | `CierresDescarga.test.tsx` | «un fallo de la lectura del conjunto no produce archivo y el mensaje no lleva datos personales (R7)» y su gemelo: el mensaje es accionable y no contiene quién solicitó, zona, montos ni identificadores; no hay blob ni xlsx | ✔ **cierra aquí** |
| R8 | `CierresDescarga.test.tsx` | los dos casos de R1 afirman la acción del conjunto **sin llamar** hasta que se pulsa, y que la lectura de página sigue costando UNA (`listarConsolidablesPaginado`/`listarCierresBodegaSolicitadosPaginado` con 1 llamada) | ✔ |
| R10 | `tests/unit/services/consolidacion-completo.test.ts` (servidor) + `CierresDescarga.test.tsx` (cliente) | la mitad de cliente: «descargar los cierres de bodega solicitados no cuesta los agregados de dinero de la cabecera (R10)» y «descargar los consolidables no cambia el contador ni los agregados de la cabecera (R10/R26)» — cero llamadas al listado que los calcula, y los números de la cabecera idénticos antes y después. Medida con M4/M11, que producen el MISMO archivo | ✔ **la mitad de cliente cierra aquí** |
| R12 | `CierresDescarga.test.tsx` | «cada tabla de cierres ofrece su control…», «el archivo trae las filas de SU tabla, en el orden de la pantalla» y «el archivo del adminSatelite solo trae los cierres de su zona», **sin cambios**: mismas columnas, mismo orden, mismos valores crudos y mismos títulos. `cierres-bodega-descarga-columnas.ts` no se tocó | ✔ sin cambios |
| R13 | `paginacion-transversal.test.tsx` | el mismo caso del censo: los NUEVE que siguen declarados `conjunto` **deben** contener `filasDelConjuntoCompleto(` | ✔ |
| R29 | `paginacion-transversal.test.tsx` | los dos sentidos del censo, ya existentes (lo declarado existe; lo que existe está declarado), verdes tras mover los dos listados | ✔ |
| R30 | `paginacion-transversal.test.tsx` | `PENDIENTES_184` con **nueve** nombres, contrastado contra el árbol. Medido en los dos sentidos: M1/M8 (pantalla sin censo) y M2/M9 (censo sin pantalla) | ✔ |
| R33 | — | el objeto de opciones de `useSWR` de las dos pantallas no se toca: ni `fallbackData` ni ninguna opción aparecen en el diff. Su caso vive en `paginacion-transversal.test.tsx` («los TRECE pre-cargan su página») y sigue verde | ✔ |
| R34 | este archivo | el mapa de arriba | ✔ |

**Lo que NO se puede cubrir aquí, con su motivo:** R5, R9, R11, R14, R15, R16 y R17 son de
repositorio, servicio o borde (`lib/**`, fuera del alcance de FRONTEND_DEV) y están cerrados en
`impl_188_tandaB_backend.md` —salvo R9 (tanda C) y R11 (tanda A, cerrado)—. **R18–R28** son la
poda de la selección satélite, cerrada en la tanda A. **R31 y R32** son de la **tanda H**: la
guardia nueva solo puede correr cuando A–G estén dentro, y hoy quedan nueve listados. **R3** no
aplica a estos dos listados por lo dicho en la tabla.

---

## 8. Notas para quien siga

- **Un commit por listado, con su línea del censo dentro.** Los dos listados viven en archivos
  distintos (`CierresBodegaSolicitadosTabla.tsx` y `ConsolidacionBodegaModule.tsx`), así que el
  censo se puede mover uno a uno sin dejar ningún commit intermedio incoherente. Si dos listados
  compartieran archivo, tendrían que ir en el mismo commit.
- **El peaje se busca por «quién pulsa el control», no por `vitest related`.** Ver §4: el fallo no
  es un error de importación sino una descarga que no ocurre.
- **`listarConsolidacion()` queda con un solo consumidor de producción** (`cierres-admin/page.tsx`).
  Igual que `listarRecepcionSatelite()` tras la tanda A. No se actúa: es un cambio de contrato que
  ningún requisito de esta feature necesita.
- **Aviso operativo, aprendido a la mala en esta tanda.** Este worktree se compartió con otro
  agente (la tanda C) trabajando a la vez. Dos consecuencias, las dos con coste real:
  1. **`git checkout -- .` en un guion de mutaciones borró trabajo sin commitear** —el mío— y pudo
     haber borrado el suyo. El guion de esta tanda restaura **solo el archivo mutado**
     (`git checkout -- "$archivo"`) y **se commitea antes de mutar**. La tanda A pudo usar
     `-- .` porque tenía el árbol para ella sola; eso ya no se cumple.
  2. **El scratchpad es compartido**: un `mutar.py` genérico fue sobrescrito por el otro agente a
     mitad de trabajo. Los guiones de esta tanda llevan el nombre de la tanda dentro
     (`mutar_184_tandaB_front.py`).
- **Para las tandas C–G**, el molde de pantalla sigue siendo el de la tanda A, y el de los tests
  el de este `CierresDescarga.test.tsx`: cuatro casos por listado —de qué lectura sale el
  conjunto (R1/R8), que la pantalla no lo vuelva a tocar (R2), lo que se deja de pagar (R10 u
  otro coste propio) y el fallo (R7)— más las dos mutaciones del censo, que son las que impiden
  que mienta.
