# 184 — la parte FRONTEND de la Tanda G (listados 11 y 12: wallet)

> Rama: `feature/184-deuda-170-listados` · Fecha: 2026-08-04 · Rol: FRONTEND_DEV
>
> Alcance entregado: **G.2 y G.3**, los DOS últimos listados del Anexo III. Punto de partida:
> `47836bd2` (backend de la tanda G, con los dos servicios, los dos schemas derivados y los dos
> bordes). `lib/**`, `db/**` y los tests de backend **no se tocan**.
>
> **Veredicto en una línea: las dos pantallas de wallet pasan a su lectura dedicada,
> `PENDIENTES_184` queda VACÍO y no queda ni una llamada a `filasDelConjuntoCompleto(` bajo
> `app/`; 16 mutaciones ejecutadas, las 16 rojas — y de ahorro, ninguno, porque no lo hay.**

---

## 1. Lo que esta tanda gana, sin adornarlo

El backend lo midió y lo escribió tal cual, y aquí no se va a mejorar la foto para que esta
bitácora se parezca a las seis anteriores:

| | Listado 11 — Plantillas de gasto fijo | Listado 12 — Saldos de tiendas |
| --- | --- | --- |
| Consultas antes → después | 1 → **la misma** | 2 → **las mismas** |
| Filas leídas antes → después | **iguales** | **iguales** |
| Ahorro | **ninguno** | **ninguno** |
| Lo que sí cambia | el tope se decide en el SERVIDOR y el conjunto deja de cruzar al navegador | lo anterior **+ el archivo pasa a salir ORDENADO como la tabla** |

En las tandas B–F la propiedad de cliente era «la pantalla ya no arrastra la otra mitad del
listado compuesto». **Aquí no hay listado compuesto**: `listarPlantillasAction` y
`listarSaldosTiendasAction` devuelven exactamente las mismas filas que sus lecturas dedicadas.
Con dobles, el xlsx sale idéntico por los dos caminos: **ni una celda cambia**. Eso obliga a
cambiar la mutación que discrimina (§3, **MG3/MG11**) y a decir qué queda vigilado por qué.

**Lo que un test de cliente puede probar aquí, y ningún test de servicio puede:**

1. que la pantalla **pide la lectura dedicada y no la relectura** (contar llamadas: es lo único
   que separa los dos caminos, porque el archivo no los distingue);
2. que **el tope lo entiende el cliente como lo manda el servidor** — `limite_excedido` con solo
   conteos y **cero filas**. El adaptador viejo no sabe leer esa forma (`limite_excedido` no es
   un `ActionError`), así que el aviso saldría sin el total ni el tope, que es lo que lo hace
   accionable;
3. que la pantalla **no recorta ni reordena** lo que el servidor entregó;
4. que **montar no descarga** (R8) y que la entrada viaja **vacía** (R3/R4/R17).

La mitad de servidor del orden del listado 12 —la que de verdad arregla el defecto— vive en
`tests/unit/services/saldos-tiendas-completo.test.ts` (tanda G backend, killer M9). Desde el
cliente es indistinguible: el doble devuelve lo que se le programa.

---

## 2. Qué se hizo, y en qué commits

Dos commits, uno por listado, cada uno con **la pantalla y sus DOS censos dentro**. Es lo que
`tasks.md > Notas de ejecución` exige y lo que impide que un censo mienta entre dos commits;
**MG2** y **MG10** miden justamente esa mitad.

| Commit | Listado | Pantalla |
| --- | --- | --- |
| `164b4f99` | 12 — «Saldos de tiendas» | `app/(app)/wallet/tiendas/_components/SaldosTiendasTable.tsx` |
| `21757476` | 11 — «Plantillas de gasto fijo» | `app/(app)/wallet/_components/GastosFijosPlantillasPanel.tsx` |

| Antes (T I.2) | Ahora (T G.2) |
| --- | --- |
| `filasDelConjuntoCompleto(listarSaldosTiendasAction().then(res => …res.tiendas), …)` | `filasDesdeResultado(listarSaldosTiendasCompletoAction(), filaDescargaSaldoTienda)` |
| `filasDelConjuntoCompleto(listarPlantillasAction().then(res => …res.plantillas), …)` | `filasDesdeResultado(listarPlantillasCompletoAction(), filaDescargaGastoFijo)` |
| tope de 5000 evaluado en el **cliente** (`filasLocales` dentro del adaptador) | tope evaluado en el **servidor** (R6): por encima no viaja ni una fila |

En los dos casos el comentario que defendía la relectura **no se borró, se corrigió**: lo que
seguía siendo cierto —el archivo es el CONJUNTO, no la página, y el acotamiento lo pone el
servidor desde la sesión— sigue escrito; lo que cambia es de dónde sale y dónde se decide el
tope. En el 12 se añade además, con su motivo, el defecto de ORDEN que la relectura arrastraba.

**G.3 — los DOS censos, en el mismo commit que cada pantalla.** Los listados 11 y 12 pasan a
`adaptador: "completo"` en `paginacion-transversal.test.tsx` **y** en el segundo censo
(`WalletPropsDescarga.test.tsx`), y salen de `PENDIENTES_184`, **que queda vacío**.

**Comprobado contra el árbol, no deducido:**

```
$ grep -rn "filasDelConjuntoCompleto(" app/ | wc -l
0
$ grep -rn "filasDelConjuntoCompleto" app/ | wc -l      # ni siquiera en comentarios
0
```

`filasDelConjuntoCompleto` sigue existiendo en `components/shared/descarga-resultado.ts` y
mencionado en tres archivos de test (`ControlDescargaTransversal`, y los dos censos, que lo
usan como el patrón NEGATIVO). Retirarlo es **H.2**, no esta tanda.

**La lista vacía no se borra**, y es deliberado: es el ancla del caso de R52, que la contrasta
contra el campo `adaptador` de los trece. Lo que una lista vacía deja de vigilar es el ORDEN, así
que se añadió al lado la cuenta de los que YA migraron (`toHaveLength(13)`): sin ella, borrar la
lista y borrar un listado del censo pasarían las dos igual de verdes.

---

## 3. Las 16 mutaciones, con su salida

Cada una: se rompe el código de verdad, se corre, y **se restaura desde una copia en memoria**
(bytes exactos, con tres reintentos y **verificando que el contenido volvió a ser el original**),
nunca con `git checkout`/`restore`/`stash`. El guion imprime tras cada mutación qué archivos MÍOS
quedan sucios: salió `[]` las 16 veces. Guion: `scratchpad/tandaG_front_mutar.py`.

Suites de la medición (**103 casos**): `WalletPropsDescarga`, `paginacion-transversal`,
`BajoRiesgoPaginacion`, `wallet-tiendas-desglose`, `wallet-tiendas-pago`,
`wallet-gastos-fijos-panel` y `wallet-page`.

### Lote del listado 12 — saldos de tiendas (8)

```
=== MG1 (G.2/R1) la pantalla de SALDOS vuelve a releer el listado sin recorte
  × ninguno de los TRECE proyecta el array de la página: el archivo va al servidor 7ms
  × las tres paginan y NINGUNA proyecta la página: releen el conjunto completo 5ms
  × por encima del tope rechaza con un error accionable y NO produce archivo 1069ms
  × el archivo de los saldos sale de su lectura DEDICADA, no de releer el listado (R1/R8) 56ms
  × la pantalla NO recorta ni reordena los saldos que devolvió el servidor (R2) 53ms
  × un fallo de la lectura de los saldos no produce archivo y el mensaje no lleva cifras… (R7) 1050ms
  Tests  6 failed | 97 passed (103)

=== MG2 (G.3/R30) el CENSO declara el listado 12 pendiente aunque su pantalla ya migro
  × las tres paginan y NINGUNA proyecta la página: releen el conjunto completo 5ms
  × ninguno de los TRECE proyecta el array de la página: el archivo va al servidor 7ms
  Tests  2 failed | 101 passed (103)

=== MG3 (G.2/R6) MEDIA MIGRACION en SALDOS: la accion nueva, pero el tope se evalua en el CLIENTE
  × las tres paginan y NINGUNA proyecta la página: releen el conjunto completo 7ms
  × por encima del tope rechaza con un error accionable y NO produce archivo 70ms
  × ninguno de los TRECE proyecta el array de la página: el archivo va al servidor 9ms
  Tests  3 failed | 100 passed (103)

=== MG4 (G.2/R1) la pantalla de SALDOS relee ADEMAS el listado viejo y TIRA el resultado
  × por encima del tope rechaza con un error accionable y NO produce archivo 72ms
  × el archivo de los saldos sale de su lectura DEDICADA, no de releer el listado (R1/R8) 52ms
  Tests  2 failed | 101 passed (103)

=== MG5 (G.2/R2) la pantalla de SALDOS RECORTA en el navegador lo que devolvio el servidor
  × la descarga sigue entregando el dataset completo, no la página (R52) 1636ms
  × la pantalla NO recorta ni reordena los saldos que devolvió el servidor (R2) 70ms
  × descargar desde la ÚLTIMA página entrega el conjunto, no lo que se ve 654ms
  Tests  3 failed | 100 passed (103)

=== MG6 (G.2/R2) la pantalla de SALDOS REORDENA en el navegador lo que devolvio el servidor
  × los montos viajan TAL CUAL, sin recalcularlos ni adornarlos 94ms
  × la pantalla NO recorta ni reordena los saldos que devolvió el servidor (R2) 61ms
  Tests  2 failed | 101 passed (103)

=== MG7 (G.2/R8) la pantalla de SALDOS ejecuta la lectura del conjunto AL MONTAR
  × el archivo de los saldos sale de su lectura DEDICADA, no de releer el listado (R1/R8) 15ms
  Tests  1 failed | 102 passed (103)

=== MG8 (G.2/R3/R4/R17) la descarga de SALDOS viaja con el recorte de pagina
  × el archivo de los saldos sale de su lectura DEDICADA, no de releer el listado (R1/R8) 70ms
  Tests  1 failed | 102 passed (103)
```

### Lote del listado 11 — plantillas de gasto fijo (8)

```
=== MG9 (G.2/R1) la pantalla de PLANTILLAS vuelve a releer el listado sin recorte
  × ninguno de los TRECE proyecta el array de la página: el archivo va al servidor 7ms
  × las tres paginan y NINGUNA proyecta la página: releen el conjunto completo 5ms
  × el tope de las plantillas también lo decide el servidor (R6) 1057ms
  × el archivo de las plantillas sale de su lectura DEDICADA, no de releer el listado (R1/R8) 70ms
  × la pantalla NO recorta ni reordena las plantillas que devolvió el servidor (R2) 43ms
  × un fallo de la lectura de las plantillas no produce archivo y el mensaje no lleva datos… (R7) 1076ms
  Tests  6 failed | 97 passed (103)

=== MG10 (G.3/R30) el CENSO declara el listado 11 pendiente aunque su pantalla ya migro
  × las tres paginan y NINGUNA proyecta la página: releen el conjunto completo 5ms
  × ninguno de los TRECE proyecta el array de la página: el archivo va al servidor 6ms
  Tests  2 failed | 101 passed (103)

=== MG11 (G.2/R6) MEDIA MIGRACION en PLANTILLAS: la accion nueva, pero el tope en el CLIENTE
  × las tres paginan y NINGUNA proyecta la página: releen el conjunto completo 5ms
  × el tope de las plantillas también lo decide el servidor (R6) 73ms
  × ninguno de los TRECE proyecta el array de la página: el archivo va al servidor 9ms
  Tests  3 failed | 100 passed (103)

=== MG12 (G.2/R1) la pantalla de PLANTILLAS relee ADEMAS el listado viejo y TIRA el resultado
  × el tope de las plantillas también lo decide el servidor (R6) 77ms
  × el archivo de las plantillas sale de su lectura DEDICADA, no de releer el listado (R1/R8) 83ms
  Tests  2 failed | 101 passed (103)

=== MG13 (G.2/R2) la pantalla de PLANTILLAS RECORTA en el navegador lo que devolvio el servidor
  × la pantalla NO recorta ni reordena las plantillas que devolvió el servidor (R2) 50ms
  × la descarga sigue entregando el dataset completo, no la página (R52) 1922ms
  Tests  2 failed | 101 passed (103)

=== MG14 (G.2/R2) la pantalla de PLANTILLAS REORDENA en el navegador lo que devolvio el servidor
  × la pantalla NO recorta ni reordena las plantillas que devolvió el servidor (R2) 75ms
  Tests  1 failed | 102 passed (103)

=== MG15 (G.2/R8) la pantalla de PLANTILLAS ejecuta la lectura del conjunto AL MONTAR
  × lista concepto, monto STRING y estado; muestra la nota del cron 41ms
  × Nueva plantilla abre el diálogo y crea con concepto + monto 4ms
  × … y cuatro más de `wallet-gastos-fijos-panel`, que no declara el export nuevo
  × el archivo de las plantillas sale de su lectura DEDICADA, no de releer el listado (R1/R8) 16ms
  Tests  7 failed | 96 passed (103)

=== MG16 (G.2/R3/R4/R17) la descarga de PLANTILLAS viaja con el recorte de pagina
  × el archivo de las plantillas sale de su lectura DEDICADA, no de releer el listado (R1/R8) 102ms
  Tests  1 failed | 102 passed (103)

=== arbol restaurado; sucios: []
```

### Qué mide cada par, y por qué la mutación de esta tanda NO es la de las anteriores

**MG1/MG9 son las mutaciones que miden la tanda entera**: revierten cada pantalla al estado del
2026-08-03 y ponen rojos **a la vez** los cuatro casos de conducta y **los dos censos** (la
pantalla declara `completo` y llama al otro adaptador). **MG2/MG10 son su espejo exacto**: mover
las tres líneas de censo sin tocar la pantalla también es rojo. Las dos mitades del encargo,
medidas.

**MG3/MG11 son LA mutación propia de esta tanda, y son distintas a las de B–F.** Allí la
mutación indistinguible era «releer el compuesto y tirar el resultado», porque el compuesto traía
una mitad de más. Aquí eso **no discrimina igual**: los dos listados devuelven las mismas filas,
así que releer y tirar (MG4/MG12) solo lo caza el conteo de llamadas — sigue siendo un `expect`
load-bearing, pero no es «la» mutación de la tanda.

La que sí lo es es **la MEDIA MIGRACIÓN**: la pantalla llama a la acción NUEVA —el censo
positivo pasaría, el conteo de llamadas pasaría, el archivo es idéntico byte a byte— pero pasa el
resultado por el adaptador VIEJO, o sea **evalúa el tope en el cliente**. Es exactamente el único
beneficio que esta tanda tiene en estos dos listados, y por eso es lo único que la distingue.
La matan dos cosas: el caso del tope (el mensaje pierde el total y el tope, porque el adaptador
viejo no sabe leer `limite_excedido`) y la **mitad negativa** de los dos censos.

**MG5/MG13 (recortar) vs MG6/MG14 (reordenar) — por qué el caso de R2 existe** además de las
guardias viejas: recortar lo cazan también ellas (se ve en los rojos de R52 y de «descargar desde
la ÚLTIMA página»); **reordenar no**, porque el archivo sigue teniendo todas sus filas. Solo el
caso de R2 lo mata en las plantillas; en los saldos cae además un caso viejo por casualidad del
fixture (`los montos viajan TAL CUAL`, cuya primera fila cambia al ordenar por nombre).

**MG7 vs MG15 (leer el conjunto AL MONTAR): la asimetría es informativa.** MG7 cae en **1** caso
y MG15 en **7**. El motivo es el peaje de §4: las suites que montan la tabla de saldos ya declaran
el export nuevo (lo pulsan), y `wallet-gastos-fijos-panel` monta el panel **sin declararlo**,
porque hoy no lo necesita: la acción **no se llama nunca salvo al pulsar**, que es exactamente lo
que R8 pide.

**Ninguna mutación quedó verde**, así que no hubo código propio inalcanzable que retirar en un
commit aparte ni ningún mutante equivalente que declarar.

### Las dos trampas del fixture, MEDIDAS (guion `scratchpad/tandaG_trampa.py`)

El encargo avisa de las dos caras. Se comprobaron en vez de suponerlas, las dos sobre el caso de
R2 de los saldos:

**Trampa 1 — fixture pequeño finge killers.** El caso usa un doble de **30 filas** con la tabla
pintando **3** y el `pageSize` del dominio en **25**. Con el fixture de tres filas a secas y
**MG5 aplicada** (recorte a 25):

```
      Tests  12 passed (12)      ← la mutación SOBREVIVE entera
```

La página *sería* el conjunto, y recortar no se vería en ninguna parte del archivo.

**Trampa 2 — fixture grande tampoco basta.** Con las 30 filas pero **homogeneizando
`tiendaNombre`** y quitando la afirmación de la secuencia absoluta, con **MG6 aplicada**
(reordenación):

```
      Tests  1 failed | 11 passed (12)
      (el caso «la pantalla NO recorta ni reordena los saldos… (R2)» PASA)
```

El único rojo es `los montos viajan TAL CUAL`, que es **otro** caso y lo caza por casualidad. El
caso de R2 —el que existe para esto— **deja de discriminar**: con los nombres iguales, un `sort`
estable no mueve nada. Las dos mitades del fixture son load-bearing: **(a)** las filas difieren en
el campo por el que el servidor ordena **y que la fila de descarga proyecta**
(`tiendaNombre` → `tienda`; en las plantillas, `concepto`), y **(b)** el caso fija la secuencia
absoluta. En las plantillas se aplicó lo mismo por adelantado, y además los **montos se mueven en
un orden distinto al de los conceptos**, para que reordenar por la otra columna de datos tampoco
reproduzca la secuencia esperada.

---

## 4. El peaje de los `vi.mock` ajenos: **cuatro archivos**

La tanda F lo anticipó («los dos listados de la tanda G viven los dos en `BajoRiesgoPaginacion`,
y esa suite sí pulsa sus controles: peaje seguro»). **Confirmado, y con dos archivos más de los
previstos.**

La corrección de B–F sigue valiendo: el fallo **no** es un error de importación, es
`expected "vi.fn()" to be called 1 times, but got 0 times` en el caso de descarga, así que
`vitest related` no basta — hay que buscar **quién pulsa el control**. Y los nombres de botón se
**interpolan** (`Descargar ${listado.descarga}` / `Descargar ${caso.control}`), así que la
búsqueda se hizo por el campo `descarga`/`control` del censo de cada suite.

| Archivo | ¿Pulsa alguno de los dos controles? | ¿Peaje? |
| --- | --- | --- |
| `tests/components/paginacion/BajoRiesgoPaginacion.test.tsx` | **sí**, los DOS, desde la página 2 | **sí** (los dos listados) |
| `tests/components/paginacion/paginacion-transversal.test.tsx` | **sí**, el de saldos (está en su `MUESTRA`) | **sí** (listado 12) |
| `tests/integration/wallet-tiendas-desglose.test.tsx` | **sí**, el de saldos | **sí** (listado 12) |
| `tests/integration/wallet-tiendas-pago.test.tsx` | **sí**, el de saldos | **sí** (listado 12) |
| `tests/components/descarga/WalletPropsDescarga.test.tsx` | sí, los dos | es el archivo que esta tanda escribe |
| `tests/unit/components/wallet-gastos-fijos-panel.test.tsx` | no (ni una aparición de `Descargar`) | no — verificado corriéndolo, y medido por **MG15** |
| `tests/integration/wallet-page.test.tsx` | no | no — verificado |
| `tests/integration/wallet-tiendas-page.test.tsx`, `mi-wallet-page`, `WalletDescarga` | no | no — verificados |

En los cuatro el arreglo es el de siempre: declarar el export nuevo en la factoría con **su
propio doble** y programarlo en el montaje. **El doble de la relectura vieja se conserva en los
cuatro**: que el archivo ya no salga de ella tiene que ser una decisión de la pantalla, no una
consecuencia de que el doble no responda.

---

## 5. El flake de jsdom

Los siete casos nuevos dependen del reloj de `waitFor` (**1.000 ms**, no el `testTimeout` de 20 s):

- **Anclas positivas.** Los cuatro casos de éxito anclan a la **entrega del blob**
  (`waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1))`); los cuatro de fallo o
  tope —que por definición no producen archivo— al **toast**, que es una presencia. Ninguna espera
  es «que no haya X»: eso lo cumple también el estado transitorio de antes de empezar. Las
  afirmaciones negativas (`not.toHaveBeenCalled`) van **después** del ancla, nunca dentro.
- **Nada anclado a trabajo pesado real.** `exceljs` (`buildXlsxRows`) y `descargarBlob` ya estaban
  aislados en este archivo. Las 30 filas de los dos casos de R2 no cuestan nada real: no se
  renderizan (la tabla pinta la página del doble paginado) y el generador está mockeado.
- **Medido dos veces seguidas** (§6), más las **16 pasadas** del runner de mutaciones y las 2 del
  guion de trampas sobre las mismas suites.

**Rojos ajenos avisados (`LoginForm`, `RegistrarPagoDialog`): no aparecieron.** No entran en los
archivos que corrí.

---

## 6. Puertas (medición real)

```
$ pnpm run typecheck
> tsc --noEmit
(sin salida: exit 0)

$ pnpm exec vitest run tests/components/descarga/WalletPropsDescarga.test.tsx \
    tests/components/paginacion/{paginacion-transversal,BajoRiesgoPaginacion}.test.tsx \
    tests/integration/{wallet-tiendas-desglose,wallet-tiendas-pago,wallet-page}.test.tsx \
    tests/unit/components/wallet-gastos-fijos-panel.test.tsx
 Test Files  7 passed (7) · Tests  103 passed (103)     # dos pasadas seguidas, las dos verdes

$ pnpm exec vitest run guard
 Test Files  61 passed (61)
      Tests  830 passed (830)

$ pnpm exec eslint <mis 7 archivos>
(sin salida: 0 errores, 0 warnings)
```

**Rojos propios: cero. Rojos ajenos: cero.**

**La suite completa NO se corre aquí**: el gate (`./init.sh`) lo corre el LEADER.

---

## 7. Archivos

**Producción (2)**

- `app/(app)/wallet/tiendas/_components/SaldosTiendasTable.tsx` — el adaptador, los dos imports y
  el comentario corregido (con el defecto de orden documentado).
- `app/(app)/wallet/_components/GastosFijosPlantillasPanel.tsx` — ídem.

**Tests (5)**

- `tests/components/descarga/WalletPropsDescarga.test.tsx` — **+7 casos (5 → 12)** y el caso del
  tope reescrito a `limite_excedido` del servidor; el **segundo censo** con los tres módulos de
  wallet en `completo`; los dos dobles nuevos.
- `tests/components/paginacion/paginacion-transversal.test.tsx` — G.3 (los dos `adaptador`,
  `PENDIENTES_184` vacío, la cuenta de los trece) + **peaje**.
- `tests/components/paginacion/BajoRiesgoPaginacion.test.tsx` — **peaje** (los dos listados).
- `tests/integration/wallet-tiendas-desglose.test.tsx` — **peaje**.
- `tests/integration/wallet-tiendas-pago.test.tsx` — **peaje**.

**Cero** cambios en `lib/**`, `db/**`, `components/**`, `feature_list.json` ni en la configuración
de `useSWR` de ninguna pantalla (**R33**: los objetos de opciones de las dos pantallas no aparecen
en el diff).

---

## 8. Las dos relecturas SÍ se quedan sin consumidor de producción

El backend lo anotó y el encargo pedía confirmarlo. **Confirmado, y con el matiz de la tanda F
delante** (allí `listarIncidentes` **sí** conservaba consumidor, así que no cae por analogía):

```
$ grep -rn "listarPlantillasAction"     app/ components/ lib/
app/(app)/wallet/_components/GastosFijosPlantillasPanel.tsx:241   ← COMENTARIO
lib/actions/gasto-fijo-plantilla.ts:134                           ← definición
lib/actions/gasto-fijo-plantilla.ts:149,170                       ← COMENTARIOS

$ grep -rn "listarSaldosTiendasAction"  app/ components/ lib/
app/(app)/wallet/tiendas/_components/SaldosTiendasTable.tsx:161   ← COMENTARIO
lib/actions/wallet-tienda.ts:144                                  ← definición
lib/actions/wallet-tienda.ts:159,181                              ← COMENTARIOS
```

**Cero llamadas de producción** a las dos, y detrás de ellas a `GastoFijoPlantillaService.listarPlantillas`
y `WalletTiendaService.listarSaldosTiendas`. No se retiran aquí: son `lib/**`, fuera del alcance
de FRONTEND_DEV, y **H.2 solo contempla borrar `filasDelConjuntoCompleto`**. Las dos siguen
teniendo consumo en la SUITE, como contraprueba de que la tabla y el archivo no divergen y como
doble vivo en los cuatro archivos del peaje: **borrarlas no es gratis, es una tarea con tests que
rehacer**. Queda anotado para la tanda H o para quien recoja la deuda.

Para el inventario: son el **séptimo y octavo** listados reducidos por este patrón, y el **segundo
y tercero que llegan a cero consumidores** (el primero fue `listarCierresBodegaAdmin`, tanda E).

---

## 9. Mapa `R<n>` → archivo + nombre del caso

Construido **leyendo el caso**, no contando `R\d+` en títulos: los espacios de nombres de la 170,
la 171/172 y la 184 se cruzan en estos archivos (`R52`, `R44`, `R43`, `R26`, `R28`, `R30` de los
títulos viejos son de la 170). Solo se listan los requisitos que esta entrega toca; los del
servidor están en `progress/impl_188_tandaG_backend.md §6`.

| R | Archivo | Caso | Estado |
| --- | --- | --- | --- |
| R1 | `WalletPropsDescarga.test.tsx` + los dos censos | «el archivo de los saldos / de las plantillas sale de su lectura DEDICADA, no de releer el listado (R1/R8)»: la acción nueva con 1 llamada, la vieja con **ninguna**, y el doble de la vieja **vivo** respondiendo el conjunto entero. La mitad estática es «cada módulo declara `completo` y **debe** contener `filasDesdeResultado(`», en los DOS censos. Killers: **MG1**, **MG4**, **MG9**, **MG12** | ✔ **cierra aquí**, y con él los TRECE del Anexo III |
| R2 | `WalletPropsDescarga.test.tsx` + los dos censos | «la pantalla NO recorta ni reordena los saldos / las plantillas que devolvió el servidor (R2)»: doble de **30** filas con la tabla pintando 3 —`pageSize` 25—, en un orden que ningún orden de cliente reproduce **en el campo que cada fila de descarga proyecta** (`tienda` / `concepto`, y los montos en otro orden). La mitad estática es la negativa de T0.2: los módulos **no pueden** contener `filasDelConjuntoCompleto(`. Killers: **MG5**/**MG13** (recorte, que las guardias viejas también cazan) y **MG6**/**MG14** (reorden, que **no**) | ✔ |
| R3 | — | **no aplica a estos dos listados, y es medible**: ninguno tiene filtros (sus schemas de página solo llevaban `page`/`pageSize`). Lo afirmable es que **no viaja ninguna clave**, y se afirma: `expect(mock.calls[0]).toEqual([])` en los dos casos de R1. Killers: **MG8**, **MG16** | ✔ como «no hay filtros que llevar» |
| R4 | `WalletPropsDescarga.test.tsx` | el mismo `toEqual([])`: la entrada no lleva `tiendaId`, la única clave que convertiría el saldo de TODAS las tiendas en el de una elegida por quien pide. El guard de rol es del servicio (tanda G backend) | ✔ cliente |
| R6 | `WalletPropsDescarga.test.tsx` | «por encima del tope rechaza con un error accionable y NO produce archivo» (saldos, reescrito) y «el tope de las plantillas también lo decide el servidor (R6)»: el doble responde `limite_excedido` con **solo conteos y ninguna fila**, el aviso lleva total y tope, no hay xlsx ni blob, y la relectura vieja **no** se pide por detrás. Killers: **MG3**, **MG11** (la media migración) | ✔ **cierra aquí** la mitad de cliente |
| R7 | `WalletPropsDescarga.test.tsx` | «un fallo de la lectura de los saldos / de las plantillas no produce archivo y el mensaje no lleva cifras de nadie (R7)»: mensaje accionable, sin el nombre de la tienda, sin su saldo, sin el concepto, sin el monto y sin identificadores internos; no hay blob ni xlsx. Killers: **MG1**, **MG9** | ✔ **cierra aquí** |
| R8 | `WalletPropsDescarga.test.tsx` | los dos casos de R1 afirman la acción del conjunto **sin llamar** hasta que se pulsa. Killers: **MG7**, **MG15** | ✔ **cierra aquí** |
| R12 | `WalletPropsDescarga.test.tsx` + `ControlDescargaTransversal.test.tsx` | «las tres ofrecen su control y el archivo trae lo que la tabla pinta» y «los montos viajan TAL CUAL», **sin cambios**: mismas columnas, mismo orden, mismos textos. `saldos-tiendas-descarga-columnas.ts` y `gastos-fijos-descarga-columnas.ts` no se tocaron | ✔ sin cambios |
| R13 | `paginacion-transversal.test.tsx` | el caso del censo: cada uno de los trece **debe** contener el adaptador que declara y **no** el contrario | ✔ |
| R29 | los dos censos | los dos sentidos, ya existentes (lo declarado existe; lo que existe está declarado), verdes tras mover los dos listados | ✔ |
| R30 | `paginacion-transversal.test.tsx` | `PENDIENTES_184` **VACÍO**, contrastado contra el árbol (0 llamadas a `filasDelConjuntoCompleto(` bajo `app/`), más la cuenta nueva de los trece `completo`. Medido en los dos sentidos: **MG1**/**MG9** (pantalla sin censo) y **MG2**/**MG10** (censo sin pantalla) | ✔ **cierra aquí** |
| R33 | — | los objetos de opciones de `useSWR` de las dos pantallas no se tocan: ni `fallbackData` ni ninguna opción aparecen en el diff. Su caso vive en `paginacion-transversal.test.tsx` («los TRECE pre-cargan su página») y sigue verde | ✔ |
| R34 | este archivo | el mapa de arriba | ✔ |

**Lo que NO se puede cubrir aquí, con su motivo:** R5, R14, R15, R16 y R17 son de repositorio,
servicio o borde (`lib/**`, fuera del alcance de FRONTEND_DEV) y están cerrados por `47836bd2`;
el ORDEN del listado 12 (R5) es de servidor y desde el cliente es **indistinguible** —el doble
devuelve lo que se le programa—, por eso su killer es M9 y no una mutación de aquí. **R9** (URL
firmadas) no aplica: ninguno de estos dos DTO tiene evidencia. **R10** es de la tanda B, **R11**
del listado 10 y **R18–R28** son la poda de la selección satélite, cerrada en la tanda A.
**R31 y R32** son de la **tanda H**: la guardia nueva ya puede correr, porque A–G están dentro.

---

## 10. Notas para la tanda H

- **`filasDelConjuntoCompleto` no tiene ya ningún consumidor bajo `app/`** (0 llamadas, 0
  menciones). H.1 puede escribir su guardia contra un árbol que ya la cumple, y H.2 puede borrar
  el adaptador; lo que hay que actualizar al borrarlo son **cuatro** archivos de test que lo
  nombran como patrón: `ControlDescargaTransversal.test.tsx` (la alternancia) y **los dos censos**
  (`paginacion-transversal`, `WalletPropsDescarga`), donde es la mitad NEGATIVA de la guardia. Si
  se borra el adaptador, esa mitad se queda sin nada que vigilar: hay que decidir si el censo
  conserva el campo `adaptador` o si el patrón pasa a ser «ninguno de los trece contiene una
  llamada al adaptador retirado».
- **`PENDIENTES_184` queda vacío pero NO se borra** (§2), y al lado se afirma la cuenta de los
  trece. Borrar la lista es una decisión de H, no un descuido de G.
- **Las dos relecturas de wallet llegan a cero consumidores de producción** (§8), a diferencia de
  `listarIncidentes` en la F. No son código muerto trivial: cuatro archivos de test las usan como
  doble vivo y dos como contraprueba de que tabla y archivo no divergen.
- **La media migración es el modo de fallo que queda vivo** mientras `filasDelConjuntoCompleto`
  exista (§3, MG3/MG11): una pantalla puede usar la acción nueva y seguir evaluando el tope en el
  cliente sin que el conteo de llamadas ni el archivo lo noten. Hoy lo cazan el caso del tope y la
  mitad negativa del censo; si H.2 borra el adaptador, deja de ser posible por construcción.
- **Higiene del worktree compartido, respetada y sin incidentes.** Ninguna orden de git sin ruta
  explícita; ningún `--amend`; los dos guiones restauran **desde copia en memoria** con reintento y
  verificación del contenido, y el de mutaciones comprueba `git status` sobre **mis siete rutas**
  después de cada una (`[]` las 16 veces). Los archivos de otros agentes no se tocaron: los dos
  commits se hicieron con `git add` de rutas explícitas.
