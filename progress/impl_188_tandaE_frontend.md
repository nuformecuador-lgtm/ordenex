# 184 — la parte FRONTEND de la Tanda E (listados 4 y 5: «Cierres de bodega» del admin)

> Rama: `feature/184-deuda-170-listados` · Fecha: 2026-08-04 · Rol: FRONTEND_DEV
>
> Alcance entregado: **E.3 y E.4**. Punto de partida: `progress/impl_184_tandaE_backend.md` (los
> dos métodos de repositorio, los dos servicios, los dos schemas derivados y los dos bordes ya
> estaban, verdes y con 19 mutaciones). `lib/**`, `db/**` y los tests de backend **no se tocan**.
>
> **Veredicto en una línea: las dos tablas de «Cierres de bodega» del admin dejan de releer el
> listado COMPUESTO —que trae la cola y el histórico de TODA la operación juntos— para pedir cada
> una su mitad, y `PENDIENTES_184` baja de seis a CUATRO; 16 mutaciones ejecutadas, las 16 rojas.**

---

## 1. Qué se hizo

Dos commits, uno por listado, cada uno con **la pantalla y su línea del censo dentro**. Es lo que
`tasks.md > Notas de ejecución` exige y lo que impide que el censo mienta entre dos commits; las
mutaciones **ME2** y **ME10** miden justamente la mitad que faltaría si no fuera así (mover el
censo sin mover la pantalla).

| Commit | Listado | Pantalla |
| --- | --- | --- |
| `10f2e3e6` | 4 — «Cierres de bodega pendientes» | `app/(app)/cierres-admin/_components/CierresBodegaAdminModule.tsx` |
| `d9783417` | 5 — «Cierres de bodega resueltos» | `app/(app)/cierres-admin/_components/CierresBodegaResueltosTabla.tsx` |

### E.3 — listado 4, la cola de pendientes

| Antes (T J.2) | Ahora (T E.3) |
| --- | --- |
| `filasDelConjuntoCompleto(listarCierresBodegaAdmin().then(res => …res.pendientes), …)` | `filasDesdeResultado(listarPendientesCierresBodegaCompleto(), filaDescargaBodegaPendiente)` |
| el archivo salía del listado **compuesto**: la cola **y** el histórico entero de la operación, para quedarse con una de las dos mitades (el backend lo midió: **7 filas leídas para producir 2**) | una lectura dedicada que corta por estado **en la base**, con el mismo `where` y el mismo `orderBy` que la página |
| tope de 5000 evaluado en el **cliente** (`filasLocales` dentro del adaptador) | tope evaluado en el **servidor** (R6): por encima no viaja ni una fila |

Es el lado caro de la asimetría, y por eso este listado se lleva la mutación de más valor: **la
cola son los cierres de bodega sin resolver —una decena— y el histórico que arrastraba crece sin
tope con los días**, así que descargar la cola costaba la operación entera.

### E.3 — listado 5, el histórico de resueltos

Idéntico, con `listarHistoricoCierresBodegaCompleto()` y `filaDescargaBodegaResuelto`. Es la otra
mitad del MISMO listado compuesto: aquí lo que se arrastraba era la cola.

En los dos casos el comentario que defendía la relectura **no se borró, se corrigió**: la frase que
valía —el archivo es el CONJUNTO y el acotamiento lo pone el servidor desde la sesión, así que
descargar no amplía lo que el actor podía ver (R14/R44)— sigue siendo cierta; lo que cambia es de
dónde sale ese conjunto y dónde se evalúa el tope.

### E.4 — el censo, en el MISMO commit que cada pantalla

`tests/components/paginacion/paginacion-transversal.test.tsx`: los dos listados pasan a
`adaptador: "completo"` y salen de `PENDIENTES_184`. **Quedan CUATRO** (9 `completo` + 4
`conjunto` = los 13 del Anexo III), y son los de las tandas F y G: los dos de incidentes, las
plantillas de gasto fijo y los saldos de tiendas. Contrastado contra el árbol: quedan exactamente
**cuatro** llamadas a `filasDelConjuntoCompleto(` bajo `app/`, una por listado pendiente.

---

## 2. Archivos

**Producción (3)**

- `app/(app)/cierres-admin/_components/CierresBodegaAdminModule.tsx` — el adaptador, los dos
  imports y el comentario corregido. Deja de importar `listarCierresBodegaAdmin`: no le quedaba
  ningún uso.
- `app/(app)/cierres-admin/_components/CierresBodegaResueltosTabla.tsx` — ídem.
- `app/(app)/cierres-admin/page.tsx` — **solo comentario** (§8): el bloque de T M.1 afirmaba que
  `listarCierresBodegaAdmin` «sigue haciendo falta: es de donde el control de descarga saca el
  conjunto completo». Desde E.3 eso es falso, y dejarlo escrito habría mandado a la tanda H en la
  dirección contraria. Ni una línea de código.

**Tests (4)**

- `tests/components/descarga/CierresDescarga.test.tsx` — **+8 casos (26 → 34)**, cuatro por
  listado, más los dos dobles nuevos.
- `tests/components/paginacion/paginacion-transversal.test.tsx` — E.4 (los dos `adaptador` y las
  dos líneas de `PENDIENTES_184`).
- `tests/components/paginacion/ColasPaginacion.test.tsx` — **peaje** (§4).
- `tests/components/paginacion/BajoRiesgoPaginacion.test.tsx` — **peaje** (§4).

**Cero** cambios en `lib/**`, `db/**`, `components/**`, `feature_list.json` ni en la configuración
de `useSWR` de ninguna pantalla (**R33**: el objeto de opciones de `useSWR` de la cola —en
`CierresBodegaAdminModule`— y el del histórico —en `CierresBodegaResueltosTabla`— no aparecen en el
diff).

---

## 3. Las 16 mutaciones, con su salida

Cada una: se rompe el código de verdad, se corre, y **se restaura desde una copia en memoria**
(bytes exactos, con reintento y **verificando que el contenido volvió a ser el original**), nunca
con `git checkout`/`restore`/`stash`. El guion imprime al final de cada mutación qué archivos MÍOS
quedan sucios: salió `[]` las 16 veces, y al terminar `git diff` sobre mis seis rutas está vacío.
Guion: `scratchpad/tandaE_front_mutar.py`.

Suites de la medición: `CierresDescarga`, `ColasPaginacion`, `BajoRiesgoPaginacion`,
`paginacion-transversal` y `CierresAdminPage` — **64 casos**.

### Lote del listado 4 — la cola de bodega (8)

```
=== ME1 (E.3/R1) la pantalla de la COLA vuelve a sacar el archivo del listado COMPUESTO
  × el archivo de la cola de cierres de bodega sale de su lectura DEDICADA, no del listado compuesto (R1/R8) 82ms
  × descargar la cola de bodega ya no arrastra el HISTÓRICO: el compuesto trae las dos mitades y ya no se pide (R1) 60ms
  × la pantalla NO recorta ni reordena la cola de cierres de bodega que devolvió el servidor (R2) 94ms
  × un fallo de la lectura de la cola de cierres de bodega no produce archivo y el mensaje no lleva datos personales (R7) 1087ms
  × ninguno de los TRECE proyecta el array de la página: el archivo va al servidor 6ms
  Tests  5 failed | 59 passed (64)

=== ME2 (E.4/R30) el CENSO declara el listado 4 pendiente aunque su pantalla ya migro
  × ninguno de los TRECE proyecta el array de la página: el archivo va al servidor 9ms
  Tests  1 failed | 63 passed (64)

=== ME3 (E.3/R1) la pantalla de la COLA relee ADEMAS el compuesto y TIRA el resultado
  × el archivo de la cola de cierres de bodega sale de su lectura DEDICADA… (R1/R8) 82ms
  × descargar la cola de bodega ya no arrastra el HISTÓRICO… (R1) 91ms
  Tests  2 failed | 62 passed (64)

=== ME4 (E.3/R2) la pantalla de la COLA RECORTA en el navegador lo que devolvio el servidor
  × la pantalla NO recorta ni reordena la cola de cierres de bodega… (R2) 81ms
  × la descarga sigue entregando el dataset completo (R52) 682ms
  Tests  2 failed | 62 passed (64)

=== ME5 (E.3/R2) la pantalla de la COLA REORDENA en el navegador lo que devolvio el servidor
  × la pantalla NO recorta ni reordena la cola de cierres de bodega… (R2) 83ms
  Tests  1 failed | 63 passed (64)

=== ME6 (E.3/R7) un fallo de la COLA se degrada a la pagina visible en vez de no producir archivo
  × un fallo de la lectura de la cola de cierres de bodega… (R7) 1091ms
  Tests  1 failed | 63 passed (64)

=== ME7 (E.3/R4/R17) la descarga de la COLA viaja con el recorte de pagina
  × el archivo de la cola de cierres de bodega sale de su lectura DEDICADA… (R1/R8) 107ms
  Tests  1 failed | 63 passed (64)

=== ME8 (E.3/R8) la pantalla de la COLA ejecuta la lectura del conjunto AL MONTAR
  × R1: el rol maestro ve el módulo con su título y secciones 71ms
  × R1 (feature 94, paridad adm↔maestro): el rol admin ve el módulo igual que el maestro 16ms
  × CONTRAPRUEBA — maestro: aprueba y SÍ recibe la oferta, con el pendiente del servidor 12ms
  × CONTRAPRUEBA — admin: aprueba y SÍ recibe la oferta, con el pendiente del servidor 14ms
  × cada listado navega entre páginas y el control tiene nombre accesible (R43) 1010ms
  × la descarga sigue entregando el dataset completo, no la página (R52) 561ms
  × el usuario ve exactamente las mismas filas que antes en la página 1 (R44) 196ms
  × el archivo de la cola de cierres de bodega sale de su lectura DEDICADA… (R1/R8) 25ms
  Tests  8 failed | 56 passed (64)
```

### Lote del listado 5 — el histórico de bodega (8)

```
=== ME9 (E.3/R1) la pantalla del HISTORICO vuelve a sacar el archivo del listado COMPUESTO
  × el archivo del histórico de cierres de bodega sale de su lectura DEDICADA, no del listado compuesto (R1/R8) 100ms
  × descargar el histórico de bodega ya no arrastra la COLA: el compuesto trae las dos mitades y ya no se pide (R1) 91ms
  × la pantalla NO recorta ni reordena el histórico de cierres de bodega que devolvió el servidor (R2) 96ms
  × un fallo de la lectura del histórico de cierres de bodega no produce archivo y el mensaje no lleva datos personales (R7) 1074ms
  × ninguno de los TRECE proyecta el array de la página: el archivo va al servidor 5ms
  Tests  5 failed | 59 passed (64)

=== ME10 (E.4/R30) el CENSO declara el listado 5 pendiente aunque su pantalla ya migro
  × ninguno de los TRECE proyecta el array de la página: el archivo va al servidor 6ms
  Tests  1 failed | 63 passed (64)

=== ME11 (E.3/R1) la pantalla del HISTORICO relee ADEMAS el compuesto y TIRA el resultado
  × el archivo del histórico de cierres de bodega sale de su lectura DEDICADA… (R1/R8) 78ms
  × descargar el histórico de bodega ya no arrastra la COLA… (R1) 72ms
  Tests  2 failed | 62 passed (64)

=== ME12 (E.3/R2) la pantalla del HISTORICO RECORTA en el navegador lo que devolvio el servidor
  × la pantalla NO recorta ni reordena el histórico de cierres de bodega… (R2) 76ms
  × la descarga sigue entregando el dataset completo, no la página (R52) 750ms
  Tests  2 failed | 62 passed (64)

=== ME13 (E.3/R2) la pantalla del HISTORICO REORDENA en el navegador lo que devolvio el servidor
  × la pantalla NO recorta ni reordena el histórico de cierres de bodega… (R2) 77ms
  Tests  1 failed | 63 passed (64)

=== ME14 (E.3/R7) un fallo del HISTORICO se degrada a la pagina visible en vez de no producir archivo
  × un fallo de la lectura del histórico de cierres de bodega… (R7) 1091ms
  Tests  1 failed | 63 passed (64)

=== ME15 (E.3/R4/R17) la descarga del HISTORICO viaja con el recorte de pagina
  × el archivo del histórico de cierres de bodega sale de su lectura DEDICADA… (R1/R8) 100ms
  Tests  1 failed | 63 passed (64)

=== ME16 (E.3/R8) la pantalla del HISTORICO ejecuta la lectura del conjunto AL MONTAR
  × R1: el rol maestro ve el módulo con su título y secciones 92ms
  × R1 (feature 94, paridad adm↔maestro): el rol admin ve el módulo igual que el maestro 29ms
  × CONTRAPRUEBA — maestro / admin: aprueba y SÍ recibe la oferta, con el pendiente del servidor
  × el contador de cabecera muestra el total del servidor, no el tamaño de página (R42) 841ms
  × cada cola navega entre páginas y su control tiene nombre accesible (R43) 644ms
  × el usuario ve exactamente las mismas filas que antes en la página 1 (R44) 235ms
  × la descarga sigue entregando el dataset completo (R52) 394ms
  × el archivo del histórico de cierres de bodega sale de su lectura DEDICADA… (R1/R8) 20ms
  Tests  9 failed | 55 passed (64)

=== arbol restaurado; sucios: []
```

### Qué mide cada par, y las dos trampas que el encargo avisaba

**ME1/ME9 son las mutaciones que miden la tanda entera**: revierten cada pantalla al estado del
2026-08-03 y ponen rojos **a la vez** los cuatro casos de conducta y el **censo** (la pantalla
declara `completo` pero llama al otro adaptador).

**ME2/ME10 son su espejo**: mover la línea del censo sin tocar la pantalla también es rojo. Sin
esta mitad, el censo podría decir que un listado está cerrado cuando no lo está.

**ME3/ME11 son LA mutación propia de esta tanda, y son el equivalente en cliente de la M8 del
backend.** El código mutado llama a `listarCierresBodegaAdmin()` —el listado compuesto, que trae la
cola Y el histórico— **y tira el resultado**: mismo archivo, mismas filas, mismo orden, mismo xlsx
byte a byte. Es indistinguible por el resultado, y en el backend el movimiento equivalente dejaba
**43 de 44** casos en verde.

Lo que le toca al componente, sin duplicar lo del backend: el backend vigila **cuántas filas leyó
su servicio** (`llamadas === ["findHistoricoCompleto"]`, `filasLeidas === [5]`); lo que ningún test
de servicio puede ver es **si la pantalla sigue pidiendo el camino caro**. Un servicio que lee su
mitad no sirve de nada mientras el módulo llame al compuesto — y ése era exactamente el estado del
que salimos. La mitad de aquí es `expect(listarCierresBodegaAdmin).not.toHaveBeenCalled()`
**después** de que la descarga se haya completado.

Y su **anti-vacuidad**, en dos pasos, porque «cero llamadas» pasa igual con un doble muerto o con
una descarga que nunca ocurrió:

1. la descarga SÍ ocurrió y produjo sus filas (`filas` con la longitud del conjunto);
2. el doble del compuesto **está vivo y trae LAS DOS MITADES** — el test lo invoca al final y
   comprueba que devuelve la otra mitad *además* de la suya. No llamarlo es una decisión de la
   pantalla, no del arnés.

**El tamaño del fixture, atendiendo al aviso.** El caso de R2 de cada listado usa un doble de
**30 filas** con la tabla pintando **1** (el fixture de esta pantalla trae una fila por tabla), y el
`pageSize` del dominio es **25**: así un recorte a la página *o* al `pageSize` se distingue del
bueno. Con la fila única del fixture original, ME4/ME12 habrían pasado verdes en el caso nuevo —la
página *sería* el conjunto—. Medido: ME4 y ME12 caen, y arrastran además el caso de R52 de las dos
suites de paginación, que montan 60 filas.

**ME5/ME13 —reordenar— son las que justifican que el caso de R2 exista** además de la guardia vieja
de R52. Recortar lo caza también aquélla (se ve en ME4/ME12, que ponen rojos los dos archivos);
reordenar **no**, porque el archivo sigue teniendo todas sus filas. Solo el caso de R2 las mata.

**Un detalle que casi deja vivo a ME13, y merece anotarse:** el histórico ordena por `resueltoAt`,
no por `solicitadoAt`. La primera versión de la mutación reordenaba por `solicitadoAt`, que en este
fixture es el MISMO valor en las treinta filas —el `sort` estable no movía nada y la mutación habría
sobrevivido por un defecto del fixture, no del código—. Se cambió al campo que la fila de descarga
proyecta (`fechaResuelta`), y entonces cae. Es la trampa nº1 del encargo con otra cara: **no basta
con que el doble tenga filas de sobra, tienen que diferir en el campo que la mutación toca**.

**ME8/ME16 (leer el conjunto al montar) caen en varios sitios**, y el rojo extra es informativo:
rompen las dos suites de paginación y `CierresAdminPage`, que renderizan estas pantallas y cuyos
casos no esperan una llamada en el montaje. Confirma la forma del peaje de §4.

**Ninguna mutación quedó verde**, así que no hubo código propio inalcanzable que retirar ni ningún
mutante equivalente que declarar. (El backend sí tuvo uno, **M14** sobre `toResumen`, y lo conservó
a propósito por simetría con la página; aquí no aparece el caso equivalente porque la pantalla no
mapea nada: proyecta con `filaDescargaBodega*`, que enumera las columnas una a una.)

---

## 4. El peaje de los `vi.mock` ajenos: **DOS archivos**

El backend dejó cuatro candidatos. La corrección de las tandas B, C y D —el fallo **no** es un error
de importación, es `expected "vi.fn()" to be called 1 times, but got 0 times` en el caso de
descarga, porque vite resuelve el named import en el punto de uso— implica que `vitest related` no
basta: hay que mirar **quién pulsa el control de descarga**. Y aquí los dos nombres de control
(«Descargar Cierres de bodega pendientes» y «Descargar Cierres de bodega resueltos») **no aparecen
literalmente en ningún test**: los tres archivos que los pulsan los construyen por interpolación
(`Descargar ${cola.descarga}`), así que la búsqueda tuvo que hacerse por el campo del censo de cada
suite, no por el texto del botón.

| Archivo | ¿Pulsa alguno de los dos controles? | ¿Rompió? |
| --- | --- | --- |
| `tests/components/paginacion/ColasPaginacion.test.tsx` | **sí**, el de la cola desde la página 2 (su caso de R52) | **sí** → peaje pagado (listado 4) |
| `tests/components/paginacion/BajoRiesgoPaginacion.test.tsx` | **sí**, el del histórico desde la página 2 | **sí** → peaje pagado (listado 5) |
| `tests/components/descarga/CierresDescarga.test.tsx` | sí, los dos | es el archivo que esta tanda escribe |
| `tests/components/CierresAdminPage.test.tsx` | no (ni una aparición de `Descargar`) | no — verificado corriéndolo |
| `tests/components/paginacion/paginacion-transversal.test.tsx` | no: los dos de bodega no están en su `MUESTRA` de conducta | no (solo cambia su censo) |

Los cuatro archivos restantes que referencian `@/lib/actions/cierre-bodega`
(`CierresAdminIndemnizacion`, `CierresAdminPagoMensajero`, `CierresAdminModule` y los unitarios de
servicio) no montan estas pantallas o no pulsan nada. Verificado corriendo los doce del dominio:
**183 casos verdes**.

En los dos el arreglo es el de siempre: declarar el export nuevo en la factoría con **su propio
doble** (`completo.bodegaPendientesCompleto`, `completo.bodegaHistoricoCompleto`) y programarlo en
el montaje. El doble del listado compuesto (`completo.bodegaAdmin`) **se conserva en los dos**: que
el archivo ya no salga de él tiene que ser una decisión de la pantalla, no una consecuencia de que
el doble no responda.

**Nota para la tanda F:** el mismo par de suites (`ColasPaginacion` y `BajoRiesgoPaginacion`)
hospeda los dos listados de incidentes, y por el mismo motivo —montan la pantalla Y pulsan su
control—. Van a ser su peaje, con toda probabilidad.

---

## 5. El flake de jsdom

Los ocho casos nuevos dependen del reloj de `waitFor` (**1.000 ms**, no el `testTimeout` de 20 s),
así que se aplicaron los tres mecanismos:

- **Anclas positivas.** Los seis casos de éxito anclan a la **entrega del blob**
  (`waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1))`) y los dos de fallo —que por
  definición no producen archivo— al **toast**, una presencia. Ninguna espera es «que no haya X»:
  eso lo cumple también el estado transitorio de antes de empezar. Las afirmaciones negativas
  (`not.toHaveBeenCalled`) van **después** del ancla, nunca dentro de ella.
- **Nada anclado a trabajo pesado real.** `exceljs` (`buildXlsxRows`) y `descargarBlob` siguen
  aislados en este archivo; el ancla es la entrega del blob, no la generación de la hoja. Las 30
  filas de los dos casos de R2 tampoco cuestan nada real: no se renderizan (la tabla pinta la página
  del doble paginado) y el generador está mockeado.
- **Medido dos veces seguidas** (§6), más las **16 pasadas** del runner de mutaciones sobre las
  mismas cinco suites.

**Rojos ajenos avisados (`LoginForm`, `RegistrarPagoDialog`): no aparecieron.** No entran en los
archivos que corrí.

---

## 6. Puertas (medición real)

```
$ pnpm run typecheck
> tsc --noEmit
=== typecheck exit: 0

$ pnpm exec vitest run tests/components/descarga/CierresDescarga.test.tsx \
    tests/components/paginacion/{ColasPaginacion,BajoRiesgoPaginacion,paginacion-transversal}.test.tsx \
    tests/components/CierresAdminPage.test.tsx
 Test Files  5 passed (5) · Tests  64 passed (64)      # dos pasadas seguidas, las dos verdes

$ pnpm exec vitest run <mis 5 + los 7 vecinos del dominio>
 Test Files  12 passed (12)
      Tests  183 passed (183)

$ pnpm exec vitest run guard
 Test Files  61 passed (61)
      Tests  830 passed (830)
   Duration  11.83s

$ pnpm exec eslint <mis 6 archivos>
(sin salida: 0 errores, 0 warnings)

$ pnpm exec eslint .
✖ 44 problems (0 errors, 44 warnings)     # AJENAS y preexistentes; delta propio: CERO
```

**Rojos propios: cero.**

**Un rojo AJENO de typecheck, transitorio y ya cerrado por su dueño.** A mitad del trabajo,
`pnpm run typecheck` salió en `exit 2` con dos errores en
`tests/unit/services/incidente-admin-service.test.ts(135,45)` e
`indemnizacion-tope-negocio-incidente.test.ts(84,45)` (`findHistoricoCompleto`/`findColaCompleta`
faltando en dos dobles de `IIncidenteAdminRepository`), dentro del `git diff` **sin commitear** del
otro agente (la tanda F) y en archivos que esta tanda no toca. Se reportó, no se arregló. La
medición final, ya con esa tanda commiteada, es **`typecheck exit: 0`**.

**La suite completa NO se corre aquí**: el gate (`./init.sh`) lo corre el LEADER.

---

## 7. Mapa `R<n>` → archivo + nombre del caso

Construido **leyendo el caso**, no contando `R\d+` en títulos: los espacios de nombres de la 170 y
la 184 se cruzan en estos archivos (`R52`, `R44`, `R43`, `R42` son de la 170). Solo se listan los
requisitos que esta entrega toca; los del servidor están en `progress/impl_184_tandaE_backend.md §6`.

| R | Archivo | Caso | Estado |
| --- | --- | --- | --- |
| R1 | `tests/components/descarga/CierresDescarga.test.tsx` + `paginacion-transversal.test.tsx` | «el archivo de la cola de cierres de bodega sale de su lectura DEDICADA, no del listado compuesto (R1/R8)» y su gemelo del histórico (la acción nueva con 1 llamada y `listarCierresBodegaAdmin` con **ninguna**), más **«descargar la cola de bodega ya no arrastra el HISTÓRICO…»** / **«descargar el histórico de bodega ya no arrastra la COLA…»**, que es la mitad que el xlsx no distingue; y la mitad estática «ninguno de los TRECE proyecta el array de la página» (los dos módulos declaran `completo` y **deben** contener `filasDesdeResultado(`). Killers: **ME1**, **ME3**, **ME9**, **ME11** | ✔ **cierra aquí** para los listados 4 y 5 |
| R2 | `CierresDescarga.test.tsx` + el censo | «la pantalla NO recorta ni reordena la cola / el histórico de cierres de bodega que devolvió el servidor (R2)»: el doble devuelve **30** filas con la tabla pintando 1 —y el `pageSize` del dominio es 25—, y las tres primeras en un orden que ningún orden de cliente reproduce. La mitad estática es la negativa de T0.2: los módulos **no pueden** contener `filasDelConjuntoCompleto(`. Killers: **ME4**/**ME12** (recorte) y **ME5**/**ME13** (reorden, que la guardia vieja de R52 NO caza) | ✔ |
| R3 | — | **no aplica a estos dos listados, y es medible**: ninguno tiene filtros (su schema de página solo llevaba `page`/`pageSize`). Lo afirmable es que **no viaja ninguna clave**, y eso sí se afirma: `expect(mock.calls[0]).toEqual([])` en los dos casos de R1. Killers: **ME7**, **ME15** | ✔ como «no hay filtros que llevar» |
| R4 | `CierresDescarga.test.tsx` | el mismo `toEqual([])`: la entrada no lleva `zonaId` ni `estado`, que son las dos claves que, aceptadas, convertirían el archivo del maestro en el de otra bodega. El guard de rol es del servicio (backend §6) | ✔ cliente |
| R6 | — | el tope lo evalúa el servidor y lo redacta `filasDesdeResultado`; sus casos viven en `cierres-bodega-admin-completo.test.ts` y `ControlDescargaTransversal.test.tsx`, verdes sin tocar | ✔ sin cambios |
| R7 | `CierresDescarga.test.tsx` | «un fallo de la lectura de la cola / del histórico de cierres de bodega no produce archivo y el mensaje no lleva datos personales (R7)»: mensaje accionable, sin quién solicitó, sin zona, sin montos y sin identificadores —cada fila de estas tablas ES el dinero agregado de una zona entera—; no hay blob ni xlsx. Killers: **ME6**, **ME14** | ✔ **cierra aquí** |
| R8 | `CierresDescarga.test.tsx` | los dos casos de R1 afirman la acción del conjunto **sin llamar** hasta que se pulsa, y que la lectura de página sigue costando UNA (`listarPendientesCierresBodegaPaginado` / `listarHistoricoCierresBodegaPaginado` con 1 llamada). Killers: **ME8**, **ME16** | ✔ **cierra aquí** |
| R12 | `CierresDescarga.test.tsx` + `ControlDescargaTransversal.test.tsx` | «cada tabla de cierres ofrece su control…», «el archivo trae las filas de SU tabla, en el orden de la pantalla» y «estados, causas y destinos salen como etiqueta legible», **sin cambios**: mismas columnas, mismo orden y mismos textos. `cierres-bodega-descarga-columnas.ts` no se tocó y las dos filas de descarga siguen tomando `CierreBodegaResumen` | ✔ sin cambios |
| R13 | `paginacion-transversal.test.tsx` | el mismo caso del censo: los CUATRO que siguen declarados `conjunto` **deben** contener `filasDelConjuntoCompleto(`, y los nueve `completo`, `filasDesdeResultado(` | ✔ |
| R29 | `paginacion-transversal.test.tsx` | los dos sentidos del censo, ya existentes (lo declarado existe; lo que existe está declarado), verdes tras mover los dos listados | ✔ |
| R30 | `paginacion-transversal.test.tsx` | `PENDIENTES_184` con **cuatro** nombres, contrastado contra el árbol. Medido en los dos sentidos: **ME1**/**ME9** (pantalla sin censo) y **ME2**/**ME10** (censo sin pantalla) | ✔ |
| R33 | — | los objetos de opciones de `useSWR` de las dos pantallas (cola e histórico) no se tocan: ni `fallbackData` ni ninguna opción aparecen en el diff. Su caso vive en `paginacion-transversal.test.tsx` («los TRECE pre-cargan su página») y sigue verde | ✔ |
| R34 | este archivo | el mapa de arriba | ✔ |

**Lo que NO se puede cubrir aquí, con su motivo:** R5, R14, R15, R16 y R17 son de repositorio o
borde (`lib/**`, fuera del alcance de FRONTEND_DEV) y están cerrados en
`impl_184_tandaE_backend.md`. **R9** es de la tanda C (las URL de evidencia del listado 1) y **R10**
de la tanda B (los agregados de la consolidación); ninguno aplica a estos dos listados —el camino
del archivo no firma ni agrega nada, y el backend lo midió con espías en cero—. **R11** es del
listado 10 y **R18–R28** son la poda de la selección satélite, las dos cerradas en la tanda A.
**R31 y R32** son de la **tanda H**: la guardia nueva solo puede correr cuando A–G estén dentro, y
hoy quedan **cuatro** listados (tandas F y G).

---

## 8. Confirmado: la relectura compuesta de bodega se queda SIN consumidores

El backend lo anticipó (`impl_184_tandaE_backend.md §8`) y pidió que se confirmara al terminar.
**Confirmado, y medido contra el árbol de hoy:**

```
$ grep -rn "listarCierresBodegaAdmin" app/
app/(app)/cierres-admin/page.tsx:91                       ← COMENTARIO
app/(app)/cierres-admin/_components/CierresBodegaAdminModule.tsx:310   ← COMENTARIO
app/(app)/cierres-admin/_components/CierresBodegaResueltosTabla.tsx:116 ← COMENTARIO
```

**Ni una llamada. Las tres apariciones que quedan bajo `app/` son prosa**, y las tres explican
precisamente que ya no se usa. Fuera de `app/` solo la nombran su propia definición
(`lib/actions/cierre-bodega.ts`, `lib/services/CierresBodegaAdminService.ts`,
`lib/repositories/CierresBodegaAdminRepository.ts`) y los tests que la ejercen.

Por lo tanto, **para la tanda H**:

| Candidato a retirada | Dónde | Por qué se deja hoy |
| --- | --- | --- |
| `listarCierresBodegaAdmin` (acción) | `lib/actions/cierre-bodega.ts` | sin lector de producción desde este commit |
| `listarCierresBodegaAdmin` (servicio) | `lib/services/CierresBodegaAdminService.ts` | ídem |
| `findCierresBodega` (repositorio) | `lib/repositories/CierresBodegaAdminRepository.ts` | ídem — y es la única lectura sin `where` de ese repositorio |

**No se retiran aquí, y con motivo:** (a) es `lib/**`, fuera del alcance de FRONTEND_DEV; (b) la
**anti-vacuidad del caso de R1 del backend se apoya en ejecutar esa relectura y contar sus 7 filas**
(`cierres-bodega-admin-completo.test.ts`), así que retirarla exige rehacer ese caso, no solo borrar
código. Quien lo haga tendrá que decidir con qué sustituye esa mitad del testigo.

Y para el inventario de la H: el **quinto** listado compuesto que queda reducido por el mismo patrón
(`listarRecepcionSatelite` tras la A, `listarConsolidacion` tras la B, `listarCierreDia` tras la C,
`listarCierresAdmin` tras la D) — pero es el **primero que se queda en cero**. Los otros cuatro
conservan un consumidor: su Server Component. Éste no tiene ninguno porque la T M.1 de la 170 ya lo
había sacado del render.

---

## 9. Notas para quien siga

- **El peaje se busca por «quién pulsa el control», no por `vitest related`** (§4). En esta tanda,
  además, **el nombre del botón no aparece literal en ningún test**: los tres archivos que lo pulsan
  lo interpolan. Buscar `"Descargar Cierres de bodega pendientes"` en `tests/` da **cero
  resultados** y habría hecho creer que no hay peaje.
- **El fixture del caso de R2 tiene que diferir en el campo que la mutación toca**, no solo tener
  filas de sobra: ME13 (reordenar el histórico) sobrevivía mientras la mutación ordenaba por
  `solicitadoAt`, que es idéntico en las treinta filas del doble. Con el campo que la fila de
  descarga proyecta (`resueltoAt` → `fechaResuelta`), cae.
- **`listarCierresBodegaAdmin` queda en CERO consumidores de producción** (§8). Es el primero de los
  cinco listados compuestos que llega a ese punto.
- **Higiene del worktree compartido, respetada y sin incidentes.** Ninguna orden de git sin ruta
  explícita; ningún `--amend`; el guion de mutaciones restaura **desde una copia en memoria** con
  reintento y verificación del contenido, y comprueba `git status` sobre **mis seis rutas** después
  de cada mutación (`[]` las 16 veces). Los archivos del otro agente (la tanda F, en `lib/**` y
  `tests/unit/**`) no se tocaron ni se commitearon: los commits de esta tanda se hicieron con
  `git add` de rutas explícitas.
