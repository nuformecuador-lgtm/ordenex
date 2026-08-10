# 184 — la parte FRONTEND de la Tanda F (listados 8 y 9: «Incidentes»)

> Rama: `feature/184-deuda-170-listados` · Fecha: 2026-08-04 · Rol: FRONTEND_DEV
>
> Alcance entregado: **F.3 y F.4**. Punto de partida: los tres commits de backend de la tanda
> (`944072ef`, `31271302`, `8f724553`) — los dos métodos de repositorio, los dos servicios, los
> dos schemas derivados y los dos bordes ya estaban, verdes. `lib/**`, `db/**` y los tests de
> backend **no se tocan**.
>
> **Veredicto en una línea: las dos tablas de incidentes dejan de releer el listado COMPUESTO
> —que trae la cola de pendientes de decisión y el histórico de resueltos juntos— para pedir cada
> una su mitad, y `PENDIENTES_184` baja de cuatro a DOS; 16 mutaciones ejecutadas, las 16 rojas.**

---

## 1. Qué se hizo

Dos commits, uno por listado, cada uno con **la pantalla y su línea del censo dentro**. Es lo que
`tasks.md > Notas de ejecución` exige y lo que impide que el censo mienta entre dos commits; las
mutaciones **MF2** y **MF10** miden justamente la mitad que faltaría si no fuera así (mover el
censo sin mover la pantalla).

| Commit | Listado | Pantalla |
| --- | --- | --- |
| `4806f94f` | 8 — «Incidentes pendientes de decisión» | `app/(app)/incidentes/_components/IncidentesAdminModule.tsx` |
| `b699b282` | 9 — «Incidentes — histórico» | `app/(app)/incidentes/_components/IncidentesHistoricoTabla.tsx` |

### F.3 — listado 8, la cola de pendientes de decisión

| Antes (T J.2) | Ahora (T F.3) |
| --- | --- |
| `filasDelConjuntoCompleto(listarIncidentes().then(res => …res.pendientes), …)` | `filasDesdeResultado(listarPendientesIncidentesCompleto(), filaDescargaIncidentePendiente)` |
| el archivo salía del listado **compuesto**: la cola **y** el histórico entero de incidentes resueltos del alcance, para quedarse con una de las dos mitades | una lectura dedicada que corta por estado **en la base**, con el mismo `where` y el mismo `orderBy` que la página |
| tope de 5000 evaluado en el **cliente** (`filasLocales` dentro del adaptador) | tope evaluado en el **servidor** (R6): por encima no viaja ni una fila |

Es el lado caro de la asimetría: **la cola son los incidentes sin decidir —un puñado— y el
histórico que arrastraba crece sin techo con los días**, así que descargar la cola costaba el
alcance entero.

### F.3 — listado 9, el histórico de resueltos

Idéntico, con `listarHistoricoIncidentesCompleto()` y `filaDescargaIncidenteHistorico`. Es la otra
mitad del MISMO listado compuesto: aquí lo que se arrastraba era la cola.

En los dos casos el comentario que defendía la relectura **no se borró, se corrigió**: la frase que
valía —el archivo es el CONJUNTO, el acotamiento lo pone el servidor desde la sesión por la zona de
la ORDEN, y las URL firmadas de evidencia siguen sin viajar (R22)— sigue siendo cierta; lo que
cambia es de dónde sale ese conjunto y dónde se evalúa el tope.

### F.4 — el censo, en el MISMO commit que cada pantalla

`tests/components/paginacion/paginacion-transversal.test.tsx`: los dos listados pasan a
`adaptador: "completo"` y salen de `PENDIENTES_184`. **Quedan DOS** (11 `completo` + 2
`conjunto` = los 13 del Anexo III), y son los de la tanda G: las plantillas de gasto fijo y los
saldos de tiendas. Contrastado contra el árbol: quedan exactamente **dos** llamadas a
`filasDelConjuntoCompleto(` bajo `app/`, una por listado pendiente.

---

## 2. Archivos

**Producción (2)**

- `app/(app)/incidentes/_components/IncidentesAdminModule.tsx` — el adaptador, los dos imports y
  el comentario corregido. Deja de importar `listarIncidentes`: no le quedaba ningún uso.
- `app/(app)/incidentes/_components/IncidentesHistoricoTabla.tsx` — ídem.

**Tests (4)**

- `tests/components/descarga/IncidentesDescarga.test.tsx` — **+8 casos (5 → 13)**, cuatro por
  listado, más los dos dobles nuevos y el `errorToastMock` hoisteado (§5).
- `tests/components/paginacion/paginacion-transversal.test.tsx` — F.4 (los dos `adaptador` y las
  dos líneas de `PENDIENTES_184`).
- `tests/components/paginacion/ColasPaginacion.test.tsx` — **peaje** (§4).
- `tests/components/paginacion/BajoRiesgoPaginacion.test.tsx` — **peaje** (§4).

**Cero** cambios en `lib/**`, `db/**`, `components/**`, `app/(app)/incidentes/page.tsx`,
`feature_list.json` ni en la configuración de `useSWR` de ninguna pantalla (**R33**: el objeto de
opciones de `useSWR` de la cola —en `IncidentesAdminModule`— y el del histórico —en
`IncidentesHistoricoTabla`— no aparecen en el diff).

---

## 3. Las 16 mutaciones, con su salida

Cada una: se rompe el código de verdad, se corre, y **se restaura desde una copia en memoria**
(bytes exactos, con reintento y **verificando que el contenido volvió a ser el original**), nunca
con `git checkout`/`restore`/`stash`. El guion imprime al final de cada mutación qué archivos MÍOS
quedan sucios: salió `[]` las 16 veces, y al terminar `git diff` sobre mis seis rutas está vacío.
Guion: `scratchpad/tandaF_front_mutar.py`.

> **Detalle del guion que casi lo estropea:** el árbol usa **CRLF** y los fragmentos del guion,
> LF. La primera pasada abortó en «fragmento no encontrado» —el fallo seguro— en vez de mutar
> mal. Se normaliza **solo la copia de trabajo**; la restauración escribe siempre los bytes
> originales, con sus CRLF. Verificado: `git diff` sobre mis seis rutas queda **vacío**.

Suites de la medición: `IncidentesDescarga`, `ColasPaginacion`, `BajoRiesgoPaginacion`,
`paginacion-transversal`, `IncidentesAdminModule`, `IncidentesAdminR51` e `IncidentesPage` —
**88 casos**.

### Lote del listado 8 — la cola de incidentes (8)

```
=== MF1 (F.3/R1) la pantalla de la COLA vuelve a sacar el archivo del listado COMPUESTO
  × el archivo de la cola de incidentes sale de su lectura DEDICADA, no del listado compuesto (R1/R8) 103ms
  × descargar los incidentes pendientes ya no arrastra el HISTÓRICO: el compuesto trae las dos mitades y ya no se pide (R1) 125ms
  × la pantalla NO recorta ni reordena la cola de incidentes que devolvió el servidor (R2) 116ms
  × un fallo de la lectura de la cola de incidentes no produce archivo y el mensaje no lleva datos personales (R7) 1102ms
  × ninguno de los TRECE proyecta el array de la página: el archivo va al servidor 6ms
  Tests  5 failed | 83 passed (88)

=== MF2 (F.4/R30) el CENSO declara el listado 8 pendiente aunque su pantalla ya migro
  × ninguno de los TRECE proyecta el array de la página: el archivo va al servidor 6ms
  Tests  1 failed | 87 passed (88)

=== MF3 (F.3/R1) la pantalla de la COLA relee ADEMAS el compuesto y TIRA el resultado
  × el archivo de la cola de incidentes sale de su lectura DEDICADA… (R1/R8) 131ms
  × descargar los incidentes pendientes ya no arrastra el HISTÓRICO… (R1) 127ms
  Tests  2 failed | 86 passed (88)

=== MF4 (F.3/R2) la pantalla de la COLA RECORTA en el navegador lo que devolvio el servidor
  × la pantalla NO recorta ni reordena la cola de incidentes… (R2) 96ms
  × la descarga sigue entregando el dataset completo (R52) 1056ms
  Tests  2 failed | 86 passed (88)

=== MF5 (F.3/R2) la pantalla de la COLA REORDENA en el navegador lo que devolvio el servidor
  × la pantalla NO recorta ni reordena la cola de incidentes… (R2) 100ms
  Tests  1 failed | 87 passed (88)

=== MF6 (F.3/R7) un fallo de la COLA se degrada a la pagina visible en vez de no producir archivo
  × un fallo de la lectura de la cola de incidentes… (R7) 1104ms
  Tests  1 failed | 87 passed (88)

=== MF7 (F.3/R4/R17) la descarga de la COLA viaja con el recorte de pagina
  × el archivo de la cola de incidentes sale de su lectura DEDICADA… (R1/R8) 116ms
  Tests  1 failed | 87 passed (88)

=== MF8 (F.3/R8) la pantalla de la COLA ejecuta la lectura del conjunto AL MONTAR
  × el archivo de la cola de incidentes sale de su lectura DEDICADA… (R1/R8) 25ms
  × cada archivo trae SU tabla entera, en el orden de la pantalla 1125ms
  × la descarga sigue entregando el dataset completo, no la página (R52) 1146ms
  × cada listado navega entre páginas y el control tiene nombre accesible (R43) 1660ms
  × el usuario ve exactamente las mismas filas que antes en la página 1 (R44) 406ms
  × … y 52 más de las tres suites que montan la pantalla sin declarar el export nuevo
  Tests  57 failed | 31 passed (88)
```

### Lote del listado 9 — el histórico de incidentes (8)

```
=== MF9 (F.3/R1) la pantalla del HISTORICO vuelve a sacar el archivo del listado COMPUESTO
  × el archivo del histórico de incidentes sale de su lectura DEDICADA, no del listado compuesto (R1/R8) 101ms
  × descargar el histórico de incidentes ya no arrastra la COLA: el compuesto trae las dos mitades y ya no se pide (R1) 95ms
  × la pantalla NO recorta ni reordena el histórico de incidentes que devolvió el servidor (R2) 90ms
  × un fallo de la lectura del histórico de incidentes no produce archivo y el mensaje no lleva datos personales (R7) 1093ms
  × ninguno de los TRECE proyecta el array de la página: el archivo va al servidor 9ms
  Tests  5 failed | 83 passed (88)

=== MF10 (F.4/R30) el CENSO declara el listado 9 pendiente aunque su pantalla ya migro
  × ninguno de los TRECE proyecta el array de la página: el archivo va al servidor 8ms
  Tests  1 failed | 87 passed (88)

=== MF11 (F.3/R1) la pantalla del HISTORICO relee ADEMAS el compuesto y TIRA el resultado
  × el archivo del histórico de incidentes sale de su lectura DEDICADA… (R1/R8) 101ms
  × descargar el histórico de incidentes ya no arrastra la COLA… (R1) 102ms
  Tests  2 failed | 86 passed (88)

=== MF12 (F.3/R2) la pantalla del HISTORICO RECORTA en el navegador lo que devolvio el servidor
  × la pantalla NO recorta ni reordena el histórico de incidentes… (R2) 103ms
  × la descarga sigue entregando el dataset completo, no la página (R52) 1559ms
  Tests  2 failed | 86 passed (88)

=== MF13 (F.3/R2) la pantalla del HISTORICO REORDENA en el navegador lo que devolvio el servidor
  × la pantalla NO recorta ni reordena el histórico de incidentes… (R2) 105ms
  Tests  1 failed | 87 passed (88)

=== MF14 (F.3/R7) un fallo del HISTORICO se degrada a la pagina visible en vez de no producir archivo
  × un fallo de la lectura del histórico de incidentes… (R7) 1103ms
  Tests  1 failed | 87 passed (88)

=== MF15 (F.3/R4/R17) la descarga del HISTORICO viaja con el recorte de pagina
  × el archivo del histórico de incidentes sale de su lectura DEDICADA… (R1/R8) 106ms
  Tests  1 failed | 87 passed (88)

=== MF16 (F.3/R8) la pantalla del HISTORICO ejecuta la lectura del conjunto AL MONTAR
  × el archivo del histórico de incidentes sale de su lectura DEDICADA… (R1/R8) 31ms
  × el contador de cabecera muestra el total del servidor, no el tamaño de página (R42) 978ms
  × cada cola navega entre páginas y su control tiene nombre accesible (R43) 998ms
  × el usuario ve exactamente las mismas filas que antes en la página 1 (R44) 286ms
  × la descarga sigue entregando el dataset completo (R52) 884ms
  × … y 52 más, por el mismo motivo que MF8
  Tests  57 failed | 31 passed (88)

=== arbol restaurado; sucios: []
```

### Qué mide cada par, y las dos trampas que el encargo avisaba

**MF1/MF9 son las mutaciones que miden la tanda entera**: revierten cada pantalla al estado del
2026-08-03 y ponen rojos **a la vez** los cuatro casos de conducta y el **censo** (la pantalla
declara `completo` pero llama al otro adaptador).

**MF2/MF10 son su espejo**: mover la línea del censo sin tocar la pantalla también es rojo. Sin
esta mitad, el censo podría decir que un listado está cerrado cuando no lo está.

**MF3/MF11 son LA mutación propia de esta tanda, y son el equivalente en cliente de la que el
backend midió sobre su servicio.** El código mutado llama a `listarIncidentes()` —el listado
compuesto, que trae la cola Y el histórico— **y tira el resultado**: mismo archivo, mismas filas,
mismo orden, mismo xlsx byte a byte. Es indistinguible por el resultado, y en el backend el
movimiento equivalente dejaba **84 de 85** casos en verde.

Lo que le toca al componente, sin duplicar lo del backend: el backend vigila **cuántas filas leyó
su servicio** (`incidentes-completo.test.ts` cuenta 7 filas leídas para producir 5 o 2); lo que
ningún test de servicio puede ver es **si la pantalla sigue pidiendo el camino caro**. Un servicio
que lee su mitad no sirve de nada mientras el módulo llame al compuesto — y ése era exactamente el
estado del que salimos. La mitad de aquí es `expect(listarIncidentes).not.toHaveBeenCalled()`
**después** de que la descarga se haya completado.

Y su **anti-vacuidad**, en dos pasos, porque «cero llamadas» pasa igual con un doble muerto o con
una descarga que nunca ocurrió:

1. la descarga SÍ ocurrió y produjo sus filas (`filas` con la longitud del conjunto);
2. el doble del compuesto **está vivo y trae LAS DOS MITADES** — el test lo invoca al final y
   comprueba que devuelve la otra mitad *además* de la suya. No llamarlo es una decisión de la
   pantalla, no del arnés.

**El tamaño del fixture, atendiendo al aviso (trampa nº1).** El caso de R2 de cada listado usa un
doble de **30 filas** con la tabla pintando **2** (el fixture de esta pantalla trae dos filas por
tabla), y el `pageSize` del dominio es **25**: así un recorte a la página *o* al `pageSize` se
distingue del bueno. Con el fixture original de dos filas, MF4/MF12 habrían pasado verdes en el
caso nuevo —la página *sería* el conjunto—. Medido: MF4 y MF12 caen, y arrastran además el caso de
R52 de las dos suites de paginación, que montan 60 filas.

**El campo por el que difieren las filas, atendiendo al aviso (trampa nº2).** No basta con 30
filas: tienen que **diferir en el campo que la mutación toca**. Las dos tablas ordenan por campos
distintos —la cola por `createdAt` (→ columna `fecha`), el histórico por `resueltoAt` (→ columna
`fechaResuelta`)— y las mutaciones de reordenación se escribieron **cada una contra el campo que
SU fila de descarga proyecta**, con las tres primeras filas del doble en fechas distintas (12, 19,
11) y las 27 de relleno en una intermedia (15). Así ningún orden de cliente reproduce el orden del
servidor: ni ascendente (11, 12, 15…) ni descendente (19, 15, 15…). Es la lección que la tanda E
pagó con ME13, aplicada por adelantado: si el histórico se hubiera reordenado por `createdAt`
—idéntico en las treinta filas del doble—, el `sort` estable no habría movido nada y **MF13 habría
sobrevivido por un defecto del fixture, no del código**.

**MF5/MF13 —reordenar— son las que justifican que el caso de R2 exista** además de la guardia
vieja de R52. Recortar lo caza también aquélla (se ve en MF4/MF12, que ponen rojos los dos
archivos); reordenar **no**, porque el archivo sigue teniendo todas sus filas. Solo el caso de R2
las mata.

**MF8/MF16 (leer el conjunto al montar) caen en 57 casos**, y el rojo extra es informativo: las
tres suites que montan estas pantallas sin pulsar nada (`IncidentesAdminModule`,
`IncidentesAdminR51`, `IncidentesPage`) **no declaran el export nuevo en su `vi.mock`**, así que
llamarlo en el montaje revienta el render. Hoy pasan verdes porque la acción **no se llama nunca
salvo al pulsar** — que es exactamente lo que R8 pide, y confirma la forma del peaje de §4.

**Ninguna mutación quedó verde**, así que no hubo código propio inalcanzable que retirar ni ningún
mutante equivalente que declarar.

---

## 4. El peaje de los `vi.mock` ajenos: **DOS archivos**, los que la tanda E predijo

La tanda E lo anticipó (`impl_188_tandaE_frontend.md §9`): «el mismo par de suites
(`ColasPaginacion` y `BajoRiesgoPaginacion`) hospeda los dos listados de incidentes». **Confirmado
midiéndolo.**

La corrección de las tandas B, C, D y E —el fallo **no** es un error de importación, es
`expected "vi.fn()" to be called 1 times, but got 0 times` en el caso de descarga, porque vite
resuelve el named import en el punto de uso— implica que `vitest related` no basta: hay que mirar
**quién pulsa el control de descarga**. Y aquí, como avisaba el encargo, los dos nombres de
control («Descargar Incidentes pendientes» y «Descargar Incidentes resueltos») **no aparecen
literalmente en las suites de paginación**: las construyen por interpolación
(`Descargar ${cola.descarga}` / `${listado.descarga}`), así que la búsqueda tuvo que hacerse por el
campo `descarga` del censo de cada suite, no por el texto del botón.

| Archivo | ¿Pulsa alguno de los dos controles? | ¿Rompió? |
| --- | --- | --- |
| `tests/components/paginacion/ColasPaginacion.test.tsx` | **sí**, el de la cola desde la página 2 (su caso de R52) | **sí** → peaje pagado (listado 8) |
| `tests/components/paginacion/BajoRiesgoPaginacion.test.tsx` | **sí**, el del histórico desde la página 2 | **sí** → peaje pagado (listado 9) |
| `tests/components/descarga/IncidentesDescarga.test.tsx` | sí, los dos | es el archivo que esta tanda escribe |
| `tests/components/IncidentesAdminModule.test.tsx` | no (ni una aparición de `Descargar`) | no — verificado corriéndolo |
| `tests/components/IncidentesAdminR51.test.tsx` | no | no — verificado |
| `tests/components/IncidentesPage.test.tsx` | no | no — verificado |
| `tests/components/paginacion/paginacion-transversal.test.tsx` | no: los dos de incidentes no están en su `MUESTRA` de conducta | no (solo cambia su censo) |

En los dos el arreglo es el de siempre: declarar el export nuevo en la factoría con **su propio
doble** (`completo.incidentesPendientesCompleto`, `completo.incidentesHistoricoCompleto`) y
programarlo en el montaje. El doble del listado compuesto (`completo.incidentes`) **se conserva en
los dos**: que el archivo ya no salga de él tiene que ser una decisión de la pantalla, no una
consecuencia de que el doble no responda.

**Nota para la tanda G:** sus dos listados (`Plantillas de gasto fijo` y `Saldos de tiendas`) viven
los dos en `BajoRiesgoPaginacion`, y esa suite **sí** pulsa sus controles. Es peaje seguro.

---

## 5. El flake de jsdom

Los ocho casos nuevos dependen del reloj de `waitFor` (**1.000 ms**, no el `testTimeout` de 20 s),
así que se aplicaron los tres mecanismos:

- **Anclas positivas.** Los seis casos de éxito anclan a la **entrega del blob**
  (`waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1))`) y los dos de fallo —que por
  definición no producen archivo— al **toast**, una presencia. Ninguna espera es «que no haya X»:
  eso lo cumple también el estado transitorio de antes de empezar. Las afirmaciones negativas
  (`not.toHaveBeenCalled`) van **después** del ancla, nunca dentro de ella.
- **Nada anclado a trabajo pesado real.** `exceljs` (`buildXlsxRows`) y `descargarBlob` ya estaban
  aislados en este archivo; el ancla es la entrega del blob, no la generación de la hoja. Las 30
  filas de los dos casos de R2 tampoco cuestan nada real: no se renderizan (la tabla pinta la
  página del doble paginado) y el generador está mockeado.
- **Medido dos veces seguidas** (§6), más las **16 pasadas** del runner de mutaciones sobre las
  mismas siete suites.

**Un cambio de arnés que hizo falta para R7:** la factoría de `useToast` de este archivo devolvía
un `vi.fn()` **nuevo en cada render**, así que no había forma de leer qué se le dijo al usuario.
Se hoistea `errorToastMock` (patrón ya usado en `CierresDescarga.test.tsx`), que es además lo que
da el **ancla positiva** de los dos casos de fallo.

**Rojos ajenos avisados (`LoginForm`, `RegistrarPagoDialog`): no aparecieron.** No entran en los
archivos que corrí.

---

## 6. Puertas (medición real)

```
$ pnpm run typecheck
> tsc --noEmit
(sin salida: exit 0)

$ pnpm exec vitest run tests/components/descarga/IncidentesDescarga.test.tsx \
    tests/components/paginacion/{ColasPaginacion,BajoRiesgoPaginacion,paginacion-transversal}.test.tsx \
    tests/components/{IncidentesAdminModule,IncidentesAdminR51,IncidentesPage}.test.tsx
 Test Files  7 passed (7) · Tests  88 passed (88)      # dos pasadas seguidas, las dos verdes

$ pnpm exec vitest run guard
 Test Files  61 passed (61)
      Tests  830 passed (830)
   Duration  7.39s

$ pnpm exec eslint <mis 6 archivos>
(sin salida: 0 errores, 0 warnings)
```

**Rojos propios: cero.**

**Un rojo AJENO de typecheck, transitorio y ya cerrado por su dueño.** A mitad del trabajo,
`pnpm run typecheck` salió en `exit 2` con dos errores —`lib/services/WalletTiendaService.ts(45,28)`
(`Cannot find name 'SaldoTiendaAgregadoRow'`) y
`tests/unit/actions/gasto-fijo-plantilla-actions.test.ts(35,3)`
(`listarPlantillasCompleto` opcional en un doble)— dentro del `git diff` **sin commitear** del
otro agente (la tanda G, en `lib/**`) y en archivos que esta tanda no toca. Se reportó, no se
arregló. La medición final, ya con esa tanda commiteada, es **`typecheck` en verde**.

**La suite completa NO se corre aquí**: el gate (`./init.sh`) lo corre el LEADER.

---

## 7. Mapa `R<n>` → archivo + nombre del caso

Construido **leyendo el caso**, no contando `R\d+` en títulos: los espacios de nombres de la 170 y
la 184 se cruzan en estos archivos (`R52`, `R44`, `R43`, `R42`, `R22`, `R8` de los títulos viejos
son de la 170). Solo se listan los requisitos que esta entrega toca; los del servidor están en los
tests de la tanda F de backend (`incidentes-completo.test.ts`, `incidentes-descarga-action.test.ts`,
`historicos-paginados-where.test.ts`, `colas-paginadas-where.test.ts`).

| R | Archivo | Caso | Estado |
| --- | --- | --- | --- |
| R1 | `tests/components/descarga/IncidentesDescarga.test.tsx` + `paginacion-transversal.test.tsx` | «el archivo de la cola de incidentes sale de su lectura DEDICADA, no del listado compuesto (R1/R8)» y su gemelo del histórico (la acción nueva con 1 llamada y `listarIncidentes` con **ninguna**), más **«descargar los incidentes pendientes ya no arrastra el HISTÓRICO…»** / **«descargar el histórico de incidentes ya no arrastra la COLA…»**, que es la mitad que el xlsx no distingue; y la mitad estática «ninguno de los TRECE proyecta el array de la página» (los dos módulos declaran `completo` y **deben** contener `filasDesdeResultado(`). Killers: **MF1**, **MF3**, **MF9**, **MF11** | ✔ **cierra aquí** para los listados 8 y 9 |
| R2 | `IncidentesDescarga.test.tsx` + el censo | «la pantalla NO recorta ni reordena la cola / el histórico de incidentes que devolvió el servidor (R2)»: el doble devuelve **30** filas con la tabla pintando 2 —y el `pageSize` del dominio es 25—, y las tres primeras en un orden que ningún orden de cliente reproduce, **en el campo que cada fila de descarga proyecta** (`fecha` / `fechaResuelta`). La mitad estática es la negativa de T0.2: los módulos **no pueden** contener `filasDelConjuntoCompleto(`. Killers: **MF4**/**MF12** (recorte) y **MF5**/**MF13** (reorden, que la guardia vieja de R52 NO caza) | ✔ |
| R3 | — | **no aplica a estos dos listados, y es medible**: ninguno tiene filtros (su schema de página solo llevaba `page`/`pageSize`). Lo afirmable es que **no viaja ninguna clave**, y eso sí se afirma: `expect(mock.calls[0]).toEqual([])` en los dos casos de R1. Killers: **MF7**, **MF15** | ✔ como «no hay filtros que llevar» |
| R4 | `IncidentesDescarga.test.tsx` | el mismo `toEqual([])`: la entrada no lleva `zonaId` ni `estado`, que son las dos claves que, aceptadas, convertirían el archivo de un `adminSatelite` en el de la zona vecina. El guard de rol y el `resolveAlcance` son del servicio (tanda F backend) | ✔ cliente |
| R6 | — | el tope lo evalúa el servidor y lo redacta `filasDesdeResultado`; sus casos viven en `incidentes-completo.test.ts` y `ControlDescargaTransversal.test.tsx`, verdes sin tocar | ✔ sin cambios |
| R7 | `IncidentesDescarga.test.tsx` | «un fallo de la lectura de la cola / del histórico de incidentes no produce archivo y el mensaje no lleva datos personales (R7)»: mensaje accionable, sin destinatario, sin quién reportó, sin zona, sin el motivo del incidente, sin el monto indemnizado, sin quién lo decidió y sin identificadores —cada fila de estas tablas nombra a una persona y el paquete que perdió—; no hay blob ni xlsx. Killers: **MF6**, **MF14** | ✔ **cierra aquí** |
| R8 | `IncidentesDescarga.test.tsx` | los dos casos de R1 afirman la acción del conjunto **sin llamar** hasta que se pulsa, y que la lectura de página sigue costando UNA (`listarPendientesIncidentesPaginado` / `listarHistoricoIncidentesPaginado` con 1 llamada). Killers: **MF8**, **MF16** | ✔ **cierra aquí** |
| R9 | `IncidentesDescarga.test.tsx` (caso viejo de la 170) + backend | «ninguna URL firmada ni ruta de almacenamiento llega al archivo», **sin cambios y verde**: el camino nuevo tampoco firma nada, y el backend lo midió con espías en cero (`incidentes-completo.test.ts`). Es el requisito que la tanda C cerró para el listado 1; aquí se conserva porque el DTO de incidente **sí** trae `evidenciaUrls` | ✔ sin cambios |
| R12 | `IncidentesDescarga.test.tsx` + `ControlDescargaTransversal.test.tsx` | «las dos tablas ofrecen su control, con nombres accesibles distintos», «cada archivo trae SU tabla entera, en el orden de la pantalla» y «estados y causas salen como etiqueta legible», **sin cambios**: mismas columnas, mismo orden y mismos textos. `incidentes-descarga-columnas.ts` no se tocó y las dos filas de descarga siguen tomando `IncidenteAdminDTO` | ✔ sin cambios |
| R13 | `paginacion-transversal.test.tsx` | el mismo caso del censo: los DOS que siguen declarados `conjunto` **deben** contener `filasDelConjuntoCompleto(`, y los once `completo`, `filasDesdeResultado(` | ✔ |
| R29 | `paginacion-transversal.test.tsx` | los dos sentidos del censo, ya existentes (lo declarado existe; lo que existe está declarado), verdes tras mover los dos listados | ✔ |
| R30 | `paginacion-transversal.test.tsx` | `PENDIENTES_184` con **dos** nombres, contrastado contra el árbol. Medido en los dos sentidos: **MF1**/**MF9** (pantalla sin censo) y **MF2**/**MF10** (censo sin pantalla) | ✔ |
| R33 | — | los objetos de opciones de `useSWR` de las dos pantallas (cola e histórico) no se tocan: ni `fallbackData` ni ninguna opción aparecen en el diff. Su caso vive en `paginacion-transversal.test.tsx` («los TRECE pre-cargan su página») y sigue verde | ✔ |
| R34 | este archivo | el mapa de arriba | ✔ |

**Lo que NO se puede cubrir aquí, con su motivo:** R5, R14, R15, R16 y R17 son de repositorio o
borde (`lib/**`, fuera del alcance de FRONTEND_DEV) y están cerrados por los tres commits de
backend de esta tanda. **R10** es de la tanda B (los agregados de la consolidación) y no aplica:
el camino del archivo de incidentes no agrega nada. **R11** es del listado 10 y **R18–R28** son la
poda de la selección satélite, las dos cerradas en la tanda A. **R31 y R32** son de la **tanda H**:
la guardia nueva solo puede correr cuando A–G estén dentro, y hoy quedan **dos** listados (tanda G).

---

## 8. La relectura compuesta de incidentes **NO** se queda sin consumidores

A diferencia de la tanda E —donde `listarCierresBodegaAdmin` llegó a **cero** consumidores de
producción—, aquí el listado compuesto **conserva uno**, y hay que decirlo para que la tanda H no
lo borre por analogía:

```
$ grep -rn "listarIncidentes" app/
app/(app)/incidentes/page.tsx:7    ← import
app/(app)/incidentes/page.tsx:40   ← LLAMADA REAL (Server Component)
app/(app)/incidentes/_components/IncidentesAdminModule.tsx:397    ← COMENTARIO
app/(app)/incidentes/_components/IncidentesHistoricoTabla.tsx:120 ← COMENTARIO
```

El Server Component lo sigue llamando, y **solo para dos cosas**: el guard
(`result.status !== "ok" → notFound()`) y el booleano `sinZona={result.sinZona}`. Las dos tablas
ya le llegan como PÁGINA desde `listarPendientesIncidentesPaginado` /
`listarHistoricoIncidentesPaginado` desde la 170, y el archivo ya no sale de él desde hoy.

**Deuda que queda anotada, no cerrada aquí:** la página paga la lectura del **alcance entero**
(cola + histórico, sin recorte) **para obtener un booleano**. Es el mismo patrón de derroche que
esta feature persigue, pero cerrarlo exige una lectura nueva en `lib/**` (un `sinZona` sin
consulta, que el servicio de la tanda F ya sabe calcular) y por tanto **está fuera del alcance de
FRONTEND_DEV**. Candidato para la tanda H o para una feature propia; **no** es «código muerto que
se borra», porque su consumidor existe y es real.

Y para el inventario de la H: es el **sexto** listado compuesto reducido por el mismo patrón
(`listarRecepcionSatelite` tras la A, `listarConsolidacion` tras la B, `listarCierreDia` tras la
C, `listarCierresAdmin` tras la D, `listarCierresBodegaAdmin` tras la E) — y el **quinto que
conserva consumidor**: solo el de bodega llegó a cero, porque la T M.1 de la 170 ya lo había
sacado de su render.

---

## 9. Notas para quien siga (tanda G)

- **El peaje se busca por «quién pulsa el control», no por `vitest related`** (§4), y **el nombre
  del botón no aparece literal** en las suites de paginación: lo interpolan desde su campo
  `descarga`. Los dos listados de la tanda G (`Plantillas de gasto fijo` y `Saldos de tiendas`)
  están los dos en `BajoRiesgoPaginacion`, que **sí** los pulsa: peaje seguro. Y son los únicos
  dos que además tocan el **segundo** censo (`WalletPropsDescarga.test.tsx`).
- **El fixture del caso de R2 tiene que diferir en el campo que la mutación toca**, no solo tener
  filas de sobra. Aquí se aplicó por adelantado: la cola se reordena por `createdAt` y el
  histórico por `resueltoAt`, cada uno el campo que SU fila de descarga proyecta. Con el campo
  equivocado, MF13 habría sobrevivido igual que casi le pasó a ME13 en la tanda E.
- **`listarIncidentes` NO se queda en cero consumidores** (§8): el Server Component lo usa para
  `sinZona`. No lo borréis por analogía con la tanda E.
- **CRLF vs LF en los guiones de mutación** (§3): el árbol es CRLF. Un guion con fragmentos LF
  aborta en «fragmento no encontrado» —que es el fallo seguro—, pero conviene normalizar solo la
  copia de trabajo y restaurar siempre los bytes originales.
- **Higiene del worktree compartido, respetada y sin incidentes.** Ninguna orden de git sin ruta
  explícita; ningún `--amend`; el guion de mutaciones restaura **desde una copia en memoria** con
  reintento y verificación del contenido, y comprueba `git status` sobre **mis seis rutas** después
  de cada mutación (`[]` las 16 veces). Los archivos del otro agente (la tanda G, en `lib/**` y
  `tests/unit/**`) no se tocaron ni se commitearon: los commits de esta tanda se hicieron con
  `git add` de rutas explícitas.
