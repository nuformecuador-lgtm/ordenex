# 182 — analitica: cablear el modo agregado al tablero operativo · bitacora de implementacion

> Rama `feature/182-analitica-cablear-modo-agregado`, worktree `C:/w182`.
> Spec APROBADO y puerta T0 CERRADA (`specs/182-…/requirements.md §6`). Fecha: **2026-08-05**.

## 1. Archivos tocados, contrastados contra `design.md §1`

### 1.1 Produccion — los CUATRO de `§1.1`, ni uno mas

| Archivo | Que se le hizo |
|---|---|
| `app/(app)/analitica/_components/operativo/agregacion.ts` | Entrada por cubos (`CubosDelPanel`), `seriesDesdeCubos` (R1/R2), `totalDelPeriodo` (R4-R7), `CubosDelServidorRequeridosError` (R3), `agregarPorSemana(puntos, unidad)` con rechazo (R15), retirada del modo `rango_excedido` (R16) |
| `app/(app)/analitica/_components/operativo/PanelOperativo.tsx` | Dos `useSWR` agregados (`periodo` y `semana`) en la misma oleada (R11), grano en la clave (R10), solo unidades agregables (R8), `denegadoDe` unico para las tres lecturas (R13), render del total (R4/R6/R7) y del grano servido (R14), retirada del bloque de aviso (R16) |
| `app/(app)/analitica/_components/operativo/catalogo-paneles.ts` | `unidad` por metrica + `unidadDelPanel()` (R9). **Siguen SEIS paneles** |
| `app/(app)/analitica/_components/operativo/textos.ts` | `etiquetaTotalPeriodo`, `TEXTO_GRANO_SERVIDOR`, `TEXTO_SIN_GESTIONES`; **borrados** `TEXTO_RANGO_EXCEDIDO` y `TITULO_RANGO_EXCEDIDO` |

**No se toco** nada de `lib/**`, `db/**`, `app/api/**`, `components/private/analytics/**`,
`PanelesOperativos.tsx`, `FiltrosOperativos.tsx`, `filtro-tablero.ts`, `ExportarOperativoPanel.tsx`,
`export-operativo.ts`, `AnaliticaShell.tsx` ni `page.tsx`.
**No se toco `feature_list.json` ni `progress/history.md`.**
**El tope de seis paneles (`TableroOperativoLatencia.test.tsx:106`, hoy en otra linea) sigue intacto**
y no se anadio ningun panel: el de `aging_por_estado` sale en ficha aparte (Q1 = B).

### 1.2 Tests

| Archivo | Estado |
|---|---|
| `tests/unit/analytics/tablero-agregado-cableado.test.ts` | **nuevo** — R2, R3, R5, R15 (comportamiento) |
| `tests/unit/analytics/tablero-agregado-frontera.guardia.test.ts` | **nuevo** — R12, R15 (censo), R16 |
| `tests/components/TableroOperativo.test.tsx` | factoria de `vi.mock` + R1, R4, R6, R7, R10, R13, R14; reescritura del caso de R27 y **retirada** de la asercion vacua |
| `tests/components/TableroOperativoLatencia.test.tsx` | factoria de `vi.mock` + R8 y R11; presupuesto afirmado |
| `tests/unit/analytics/tablero-agregacion.test.ts` | los dos casos de `rango_excedido` **reescritos**; `agregarPorSemana` con unidad |
| `tests/unit/analytics/tablero-catalogo-paneles.test.ts` | R9 sobre TODAS las metricas |

### 1.3 Tres archivos FUERA de la lista original de `§1.2`, con su motivo

`tests/components/descarga/AnaliticaExportCsv.test.tsx`, `tests/unit/analytics/export-csv-denegado.test.ts`
y `tests/unit/analytics/export-csv-puerta.test.ts` (los tres, de la 134).

**Motivo, escrito en `design.md §1.2` ANTES de tocarlos:** R9 exige que la `unidad` este declarada
por **cada** metrica y su caso recorre **todas** (si el campo fuese opcional, una metrica nueva sin
declararla pasaria sin ruido — el «NO HECHO» de T2.3). Al ser obligatorio en `MetricaDePanel`, los
**fixtures de `PanelTablero`** de esos tres archivos dejan de compilar. El cambio es **mecanico y
solo en el fixture** (`unidad: "conteo" | "porcentaje" | "moneda"`): no se toco ni una asercion, ni
un nombre de caso, ni el comportamiento que la 134 vigila.

### 1.4 Documentacion

- `specs/131-analitica-tablero-operativo/requirements.md` — **nota aditiva y fechada** bajo R27 y en
  su fila de trazabilidad (Q6 = A). Solo prosa; **no se toco ni un test de la 131 desde ahi** (los
  que cambian estan nombrados en T1.4 y T4.1, con su motivo).
- `specs/182-…/design.md` — ampliacion de la frontera de §1.2 con su motivo (ver 1.3).
- `specs/182-…/tasks.md` — casillas.

---

## 2. Mapa `R<n>` → test nombrado

| R | Test (archivo › caso) |
|---|---|
| R1 | `tests/components/TableroOperativo.test.tsx` › «un panel de tasa con 90 dias pinta la serie por cubos semanales del servidor y ya no pide reducir el rango» |
| R2 | `tests/unit/analytics/tablero-agregado-cableado.test.ts` › «las categorias de la serie semanal son las `fecha` de los cubos del servidor, no una semana recalculada en el cliente» |
| R3 | `tests/unit/analytics/tablero-agregado-cableado.test.ts` › «una tasa larga sin cubos del servidor falla ruidosamente en vez de cubetearse en el cliente» |
| R4 | `tests/components/TableroOperativo.test.tsx` › «el panel de tasa muestra su cifra total del periodo tambien con el rango corto» |
| R5 | `tests/unit/analytics/tablero-agregado-cableado.test.ts` › «con dias de volumen desigual la cifra total es la del cubo periodo (2/11) y NO la media de los valores diarios (0,55)» |
| R6 | `tests/components/TableroOperativo.test.tsx` › «un total de periodo que incluye el dia en curso se anuncia parcial con su hora de corte» |
| R7 | `tests/components/TableroOperativo.test.tsx` › «un periodo con denominador cero dice que no hubo gestiones y no pinta un cero» |
| R8 | `tests/components/TableroOperativoLatencia.test.tsx` › «ninguna metrica de conteo invoca la Server Action agregada» |
| R9 | `tests/unit/analytics/tablero-catalogo-paneles.test.ts` › «la unidad declarada por cada metrica del catalogo de paneles es la que declara el catalogo de metricas» |
| R10 | `tests/components/TableroOperativo.test.tsx` › «al cambiar el filtro la cifra total se vuelve a pedir con el filtro nuevo» |
| R11 | `tests/components/TableroOperativoLatencia.test.tsx` › «una carga del tablero dispara la serie y los dos granos agregados SOLAPADOS, y ni una invocacion mas de las declaradas» |
| R12 | `tests/unit/analytics/tablero-agregado-frontera.guardia.test.ts` › «el subarbol operativo no recompone ninguna formula de negocio ni pide el agregado por otra puerta» |
| R13 | `tests/components/TableroOperativo.test.tsx` › «si el agregado responde `forbidden` el panel dice prohibido y no pinta ninguna cifra» |
| R14 | `tests/components/TableroOperativo.test.tsx` › «el panel de tasa por cubos semanales anuncia el grano usado» |
| R15 | (a) `tests/unit/analytics/tablero-agregado-cableado.test.ts` › «`agregarPorSemana` rechaza toda unidad que no sea conteo: la semana del cliente no toca tasas ni tiempos» · (b) `tests/unit/analytics/tablero-agregado-frontera.guardia.test.ts` › «`lunesDeLaSemana` tiene UN solo llamador en el subarbol y es la agregacion de conteos» |
| R16 | `tests/unit/analytics/tablero-agregado-frontera.guardia.test.ts` › «el subarbol no conserva el modo `rango_excedido` ni sus dos textos» |

Los 16 requisitos tienen al menos un test nombrado. **E2E:** no, y esta declarado en
`requirements.md §3` con su motivo (tablero de solo lectura, no es flujo critico de `CHECKPOINTS.md`).

---

## 3. Las 16 mutaciones — aplicadas, ROJAS, revertidas

Metodo: cada mutacion se aplico al archivo de **produccion**, se corrio el **archivo de test entero**
(`pnpm exec vitest run --reporter=verbose <archivo>`) para poder ver **que caso** caia —no solo que
algo caia— y se revirtio escribiendo de vuelta el contenido original (sin `git checkout`). Al
terminar, `git status` limpio y los 6 archivos de test **verdes otra vez** (72 casos).

Salida literal del reporter (linea de totales + los casos rojos):

```
== R1 ==  (PanelOperativo.tsx: `semana: cubosDe(semana.data)` -> `semana: undefined`)
Tests  2 failed | 20 passed (22)
    × TableroOperativo.test.tsx > Feature 182 (R1, R14) > un panel de tasa con 90 dias pinta la serie por cubos semanales del servidor y ya no pide reducir el rango
    × TableroOperativo.test.tsx > Feature 182 (R1, R14) > el panel de tasa por cubos semanales anuncia el grano usado

== R2 ==  (agregacion.ts: construir la serie con `agregarPorSemana(crudos)` en vez de con los cubos)
Tests  1 failed | 6 passed (7)
    × tablero-agregado-cableado.test.ts > Feature 182 (R2) > las categorias de la serie semanal son las `fecha` de los cubos del servidor, no una semana recalculada en el cliente

== R3 ==  (agregacion.ts: sustituir el `throw` por la ruta de conteo, que cubetea en el cliente)
Tests  1 failed | 6 passed (7)
    × tablero-agregado-cableado.test.ts > Feature 182 (R3) > una tasa larga sin cubos del servidor falla ruidosamente en vez de cubetearse en el cliente

== R4 ==  (agregacion.ts: restaurar `total: esAgregableTemporal(unidad) ? … : null`)
Tests  4 failed | 18 passed (22)
    × TableroOperativo.test.tsx > Feature 182 (R4, R6, R7) > el panel de tasa muestra su cifra total del periodo tambien con el rango corto
    × TableroOperativo.test.tsx > Feature 182 (R4, R6, R7) > un total de periodo que incluye el dia en curso se anuncia parcial con su hora de corte
    × TableroOperativo.test.tsx > Feature 182 (R4, R6, R7) > un periodo con denominador cero dice que no hubo gestiones y no pinta un cero
    × TableroOperativo.test.tsx > Feature 182 (R10) > al cambiar el filtro la cifra total se vuelve a pedir con el filtro nuevo

== R5 ==  (agregacion.ts: total = media aritmetica de los `valor` de los puntos diarios)
Tests  2 failed | 5 passed (7)
    × tablero-agregado-cableado.test.ts > Feature 182 (R5) > con dias de volumen desigual la cifra total es la del cubo periodo (2/11) y NO la media de los valores diarios (0,55)
    × tablero-agregado-cableado.test.ts > Feature 182 (R5) > el total sale del cubo `periodo` y no de los cubos semanales

== R6 ==  (agregacion.ts: descartar `parcial`/`corteAt` del cubo `periodo`)
Tests  1 failed | 21 passed (22)
    × TableroOperativo.test.tsx > Feature 182 (R4, R6, R7) > un total de periodo que incluye el dia en curso se anuncia parcial con su hora de corte

== R7 ==  (agregacion.ts: `valor: cubo.valor ?? 0`)
Tests  1 failed | 21 passed (22)
    × TableroOperativo.test.tsx > Feature 182 (R4, R6, R7) > un periodo con denominador cero dice que no hubo gestiones y no pinta un cero

== R8 ==  (PanelOperativo.tsx: `pideAgregado = true` para todas las metricas)
Tests  4 failed | 1 passed (5)
    × TableroOperativoLatencia.test.tsx > … > las invocaciones se SOLAPAN: no se serializan una tras otra
    × TableroOperativoLatencia.test.tsx > … > una carga del tablero dispara la serie y los dos granos agregados SOLAPADOS, y ni una invocacion mas de las declaradas
    × TableroOperativoLatencia.test.tsx > … > ninguna metrica de conteo invoca la Server Action agregada
    × TableroOperativoLatencia.test.tsx > … > un cambio de filtro rehace TODOS los paneles, tambien en paralelo

== R9 ==  (catalogo-paneles.ts: `tasa_entrega` declarada `unidad: "conteo"`)
Tests  1 failed | 10 passed (11)
    × tablero-catalogo-paneles.test.ts > Feature 131 (R21) > la unidad declarada por cada metrica del catalogo de paneles es la que declara el catalogo de metricas

== R10 ==  (PanelOperativo.tsx: sacar el filtro de la clave SWR del grano `periodo`)
Tests  1 failed | 21 passed (22)
    × TableroOperativo.test.tsx > Feature 182 (R10) > al cambiar el filtro la cifra total se vuelve a pedir con el filtro nuevo

== R11 ==  (PanelOperativo.tsx: encadenar el agregado tras la serie — `pideAgregado && data !== undefined`)
Tests  2 failed | 3 passed (5)
    × TableroOperativoLatencia.test.tsx > … > las invocaciones se SOLAPAN: no se serializan una tras otra
    × TableroOperativoLatencia.test.tsx > … > una carga del tablero dispara la serie y los dos granos agregados SOLAPADOS, y ni una invocacion mas de las declaradas

== R12 ==  (agregacion.ts: `const den = entregas + devoluciones + rechazos + incidentes;`)
Tests  1 failed | 6 passed (7)
    × tablero-agregado-frontera.guardia.test.ts > Feature 182 (R12) > el subarbol operativo no recompone ninguna formula de negocio ni pide el agregado por otra puerta

== R13 ==  (PanelOperativo.tsx: ignorar el agregado en la reduccion de estado)
Tests  1 failed | 21 passed (22)
    × TableroOperativo.test.tsx > Feature 182 (R13) > si el agregado responde `forbidden` el panel dice prohibido y no pinta ninguna cifra

== R14 ==  (PanelOperativo.tsx: no renderizar el texto de grano cuando la serie viene de cubos)
Tests  1 failed | 21 passed (22)
    × TableroOperativo.test.tsx > Feature 182 (R1, R14) > el panel de tasa por cubos semanales anuncia el grano usado

== R15 (a) ==  (agregacion.ts: invocar `agregarPorSemana(crudos, unidad)` desde la ruta de porcentaje)
Tests  4 failed | 3 passed (7)
    × tablero-agregado-cableado.test.ts > Feature 182 (R15) > `agregarPorSemana` rechaza toda unidad que no sea conteo: la semana del cliente no toca tasas ni tiempos
    × tablero-agregado-cableado.test.ts > Feature 182 (R2) > las categorias de la serie semanal son las `fecha` de los cubos del servidor, no una semana recalculada en el cliente
    × tablero-agregado-cableado.test.ts > Feature 182 (R3) > una tasa larga sin cubos del servidor falla ruidosamente en vez de cubetearse en el cliente
    × tablero-agregado-cableado.test.ts > Feature 182 (R5) > el total sale del cubo `periodo` y no de los cubos semanales

== R15 (b) ==  (agregacion.ts: SEGUNDO llamador de `lunesDeLaSemana`, dentro de `seriesDesdeCubos`)
Tests  1 failed | 6 passed (7)
    × tablero-agregado-frontera.guardia.test.ts > Feature 182 (R15) > `lunesDeLaSemana` tiene UN solo llamador en el subarbol y es la agregacion de conteos

== R16 ==  (textos.ts: reponer `TEXTO_RANGO_EXCEDIDO` y `TITULO_RANGO_EXCEDIDO`)
Tests  1 failed | 6 passed (7)
    × tablero-agregado-frontera.guardia.test.ts > Feature 182 (R16) > el subarbol no conserva el modo `rango_excedido` ni sus dos textos
```

### 3.1 Lectura honesta de los rojos: donde cae un HERMANO ademas del nombrado

En las 16 filas **cayo el caso NOMBRADO**. En cinco de ellas cayo ademas algun hermano, y no es
anclaje silencioso —eso seria que cayera el hermano **en vez** del nombrado—, pero se anota porque
el que lo lea sin la salida delante no puede saberlo:

- **R1** arrastra al caso de **R14**: la mutacion apaga el panel entero (sin cubos, `prepararPanel`
  lanza y se presenta el pixel de error), asi que tambien desaparece el texto de grano. Se
  distinguen igualmente porque **R14 tiene su propia mutacion** (no renderizar el texto), que deja
  **verde** el caso de R1: las dos filas no son intercambiables.
- **R4** arrastra a **R6**, **R7** y **R10**: los cuatro casos miran la MISMA cifra, y sin total no
  hay nada que anunciar como parcial, ni denominador cero que declarar, ni cifra que rehacer al
  cambiar el filtro. Las mutaciones de R6, R7 y R10 son estrictamente mas finas y dejan verde el
  caso de R4, que es lo que mantiene las cuatro filas separadas.
- **R5** arrastra a su hermano «el total sale del cubo `periodo` y no de los cubos semanales», que
  es el mismo requisito visto desde el otro lado.
- **R8** arrastra a los tres casos de conteo de invocaciones del archivo de latencia: pedir el
  agregado para las nueve metricas rompe **todos** los presupuestos, no solo el suyo.
- **R11** arrastra al caso de solape de la 131, que mide exactamente la misma propiedad sobre el
  lote completo.

### 3.2 La trampa de la aritmetica (R5), explicita

El fixture de R5 es **deliberadamente desigual**: `dia1 = 1/1` (valor 1,0) y `dia2 = 1/10`
(valor 0,1); el cubo `periodo` trae `2/11 = 0,1818…` y la media de los valores diarios es **0,55**.
El caso afirma **las dos cosas**: `toBeCloseTo(2/11)` **y** `not.toBeCloseTo(0.55)`. Con volumenes
iguales las dos formulas darian el mismo numero y el caso no probaria nada — es la leccion de la 176.

### 3.3 R16: que se hizo con las cuatro aserciones vivas

- `tablero-agregacion.test.ts` (los dos casos de `modo === "rango_excedido"`): **reescritos**.
  Ahora afirman el comportamiento nuevo (serie por cubos + total del periodo) y **siguen afirmando
  que el cliente no promedia cocientes** (`expect(() => agregarPorSemana(dias, "porcentaje")).toThrow()`).
- `TableroOperativo.test.tsx` (el caso que afirmaba el titulo del aviso): **reescrito** como el caso
  de R1.
- `TableroOperativo.test.tsx` (`queryByText(TITULO_RANGO_EXCEDIDO)).toBeNull()` en el panel de
  conteos): **RETIRADA**. Era la peligrosa: al desaparecer la constante se habria quedado **vacua**
  —verde sin medir nada— y ademas ya no compilaria. En su lugar, el caso de conteos afirma ahora
  algo que si tiene contenido: que anuncia la semana **del cliente** y **no** el texto de la semana
  del servidor (`TEXTO_GRANO_SERVIDOR`), que son dos afirmaciones distintas.
- Y la retirada del modo entero queda vigilada por su **mutacion propia** (R16): reponer los dos
  textos en `textos.ts` pone rojo el guardia.

### 3.4 R15: el guardia afirma el ACOTAMIENTO, no la existencia

El caso del guardia **no** comprueba que `lunesDeLaSemana` siga en el archivo. Cuenta sus
**llamadores en todo el subarbol** y exige que sean **exactamente uno**, que ese uno este **dentro
del cuerpo de `agregarPorSemana`**, y que ese cuerpo contenga el rechazo **ejecutable**
(`esAgregableTemporal(unidad)` + `throw`). Un segundo llamador —el modo en que esto se rompe de
verdad— lo pone rojo aunque el primero siga siendo correcto (mutacion R15 b). El contador se prueba
aparte contra codigo sintetico para que no pueda ser un patron muerto que da el mismo verde que un
arbol limpio.

---

## 4. Verificacion ejecutada

- `pnpm typecheck` → **limpio** (salida vacia).
- `pnpm exec vitest run tests/unit/analytics tests/components/descarga` → **122 archivos, 1181
  casos, todos verdes** (incluye los dos guardias de frontera del subarbol y toda la 134).
- Los 6 archivos de test tocados, tras revertir las 16 mutaciones → **6 archivos, 72 casos verdes**.
- `./init.sh --rapido` → ver §5.
- **`./init.sh` completo NO lo corrio el implementer**: lo corre el leader tras mergear `dev`.

## 5. Desviaciones declaradas

1. **Tres archivos de test de la 134 fuera de la lista original de `design.md §1.2`** (§1.3 de esta
   bitacora). Ampliacion anotada en `design.md` **antes** de escribir en ellos, con su motivo.
2. **`agregarPorSemana` cambia de firma** (`(puntos)` → `(puntos, unidad)`). Es lo que hace que el
   acotamiento de R15 sea **ejecutable** y no un comentario: con un parametro opcional, una ruta de
   `porcentaje` que la invocara sin pasar la unidad pasaria en silencio. Obliga a actualizar tres
   llamadas en `tablero-agregacion.test.ts` (archivo ya dentro de la frontera).
3. **La serie por cubos usa `cubo.fecha` como categoria, TAL CUAL**, sin la marca textual de
   parcialidad que `categoriaDePunto` anade a los puntos diarios. Motivo: el texto de esa marca dice
   «dia en curso» y aplicarlo a una semana seria falso; el spec solo exige que la categoria salga de
   la `fecha` del cubo (R2). La parcialidad **si** se anuncia donde el spec la pide: en el total (R6).
4. **La excepcion de R3 se presenta como el pixel de error del panel.** `prepararPanel` **lanza**
   (eso es lo que R3 pide y lo que su mutacion mata), pero el componente la captura y muestra
   `TEXTO_ERROR_PANEL`: una excepcion en render tumbaria el tablero entero y R24 de la 131 exige que
   un panel roto no tumbe a los demas. En el flujo normal la condicion no se alcanza —el panel
   espera a los cubos y mientras tanto esta en carga—; solo queda alcanzable si el servidor
   responde `ok` con cero cubos para un rango de mas de 62 fechas, que es una incoherencia real y no
   un estado de negocio.

---

## 6. Aterrizaje (2026-08-10, leader)

La rama llevaba desde el **2026-08-05** completa y **varada**: sin pushear, sin reviewer y sin
PR, con la ficha de `dev` diciendo `pending` y **221 commits** de retraso.

### 6.1 Merge de `dev` — dos conflictos, ninguno ambiguo

| Archivo | Choque | Resolucion |
|---|---|---|
| `catalogo-paneles.ts` | `dev` puso las **tildes** en las etiquetas; la 182 anadio **`unidad`** | Las DOS cosas. Quedarse con un lado borraba trabajo ajeno o desarmaba el acotamiento de R15 |
| `feature_list.json` | La ficha que esta rama dio de alta como **185** choca con la que `dev` publico ahi (el oraculo de conteo, cancelada) | Se renumera **la que nunca circulo -> 194**, conservando contenido. Mismo criterio que 185->186->187. Se salta el 193: otra sesion lo ocupo hoy |

Las notas de la **134** y la **176** se **unieron**: `dev` y esta rama cerraron la misma ficha con
evidencia distinta y complementaria. No se perdio ninguna de las dos.

### 6.2 Lo que solo aparecio con `dev` dentro

1. **`presentacion-etiquetas-mensajero.test.ts`** (llego con `dev` despues de que esta rama
   naciera) construia un `MetricaDePanel` sin `unidad`, que la 182 volvio obligatoria: rompia el
   **typecheck**. Lleva `conteo`, la unidad inocua — ese caso mide desagregacion, no unidad.
2. **`AnaliticaNoSustitucion.test.tsx`** (feature 133) doblaba el modulo de acciones exportando
   **solo** `consultarAnaliticaOperativa`. Desde la 182 el panel tambien pide
   `consultarAgregadoOperativo`, que en ese doble llegaba `undefined`: el panel caia en su pixel
   de error y **tapaba el denegado que el caso mide**. No bastaba con doblarla: **R21 afirma una
   NO-DIFERENCIA sobre «la puerta que toca el dato», y ahora son DOS**. `llamadasAlBorde()` recorre
   las dos —con el `grano` dentro de la normalizacion—, el conteo se **deriva del catalogo** en vez
   de ir tecleado, y `montar()` espera tambien a los cubos (sin esa espera la comparacion entre
   recortes compara **carreras**, no consultas).
3. **`consultarAgregadoOperativo` seguia anotada `@sin-superficie`** («nacio sin cablear y sigue
   asi»). **Esta feature ES su superficie.** La anotacion se retira aqui, no en un barrido
   posterior: una excusa que sobrevive a su motivo deja de avisar y pasa a mentir. Lo pone rojo
   `tests/unit/guards/superficie-de-uso.guardia.test.ts`, que hizo exactamente su trabajo.

### 6.3 Gate completo (`./init.sh`) sobre el arbol mergeado

**1015 de 1017 archivos verdes · 12.596 de 12.608 tests · typecheck y lint limpios · cero flakes.**

Los **12 rojos** son los dos archivos de `busqueda-*` de siempre, y esta vez **con causa raiz
identificada, que no es la que decian las bitacoras de la 187 y la 192**:

> La migracion **`20260808120000_orden_busqueda_producto` existe SOLO en la rama `ux`**
> (commit `f74462f9`, WIP del humano) y **esta aplicada a la base local compartida**. Por eso la
> columna generada viva incluye `producto` y el normalizador de Node de `dev` no.
> No es «drift de la base local» ni deuda de `dev`: es una rama sin mergear que ya toco la base.
> **Se va sola en cuanto esa migracion llegue a `dev`**; recrear la columna a mano la
> desincronizaria de `ux`.

Inocencia de esta rama, por construccion: no toca busqueda, ni SQL, ni una migracion.

### 6.4 Lo que falta

- **Reviewer (F2.2): NO ha corrido.** Es la puerta que verifica la trazabilidad `R<n> -> test`.
- **Push y PR**: la rama sigue siendo local.
