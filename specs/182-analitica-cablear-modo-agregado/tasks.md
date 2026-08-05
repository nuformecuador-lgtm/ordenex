# 182 — analitica: cablear el modo agregado al tablero operativo · tasks

> `[P]` = paralelizable con las de su misma tanda. Cada tarea lleva **hecho** y, donde un verde
> barato es facil, **NO HECHO** explicito: si se cumple alguna de esas condiciones, la tarea esta
> sin hacer aunque los tests esten verdes.
>
> **Puerta T0 CERRADA el 2026-08-05** (`requirements.md §6`). No hay tanda de decision: se
> implementa lo decidido — sin panel de aging (Q1 = B), una sola oleada con los dos granos
> (Q2 = A), `lunesDeLaSemana` acotada **y vigilada** (Q4 = A), nota en la 131 (Q6 = A) y
> `rango_excedido` retirado (Q7).

---

## Tanda 1 — el nucleo puro (sin React, sin red)

- [x] **T1.1** En `agregacion.ts`: entrada pura que prepara un panel **a partir de cubos**
      (`readonly CuboAgregado[]`) — serie con `categoria = cubo.fecha` y `valor = cubo.valor`
      (R2), y total desde el cubo `periodo` (R4-R7).
  - **hecho:** `pnpm typecheck` limpio y la funcion no importa nada nuevo de `lib/analytics/**`
    salvo tipos ya permitidos por el guardia de frontera.
  - **NO HECHO** si en algun punto del modulo aparece una **division** de `numerador`/`denominador`
    (D2: la UI no divide), o si se re-ancla la fecha del cubo con `lunesDeLaSemana`.

- [x] **T1.2** En `agregacion.ts`: R3 (fallo ruidoso si llegan puntos de `porcentaje`/`segundos`
      por encima del techo sin cubos), R15 (`agregarPorSemana` rechaza toda unidad que no sea
      `conteo`) y **R16**: retirada de la rama `modo: "rango_excedido"` y del tipo/estado que la
      sostiene.
  - **depende de:** T1.1
  - **hecho:** `lunesDeLaSemana` y `agregarPorSemana` **siguen existiendo** (D5), solo son
    alcanzables desde el camino de `conteo`, y `rango_excedido` no aparece en el subarbol.
  - **NO HECHO** si el fallo se sustituye por un `return` silencioso; si se borra
    `lunesDeLaSemana` (romperia R16 de la 131 para los tres paneles de conteo); o si el
    acotamiento se deja como **comentario** en vez de como comprobacion ejecutable — un comentario
    no lo rompe ninguna mutacion.

- [x] **T1.3 [P]** `tests/unit/analytics/tablero-agregado-cableado.test.ts` con los casos nombrados
      de R2, R3, R5 y el de comportamiento de R15.
  - **depende de:** T1.1, T1.2
  - **hecho:** los cuatro casos pasan y sus nombres son **exactamente** los de la tabla de §3 de
    `requirements.md`.
  - **NO HECHO** si el caso de R5 usa dias de **volumen igual** (sumar-antes-de-dividir y
    media-de-medias darian el mismo numero y el test no probaria nada), o si afirma solo el valor
    correcto y **no** niega el 0,55 de la media de medias. Las dos aserciones son obligatorias.

- [x] **T1.4 [P]** Reescribir los dos casos de `rango_excedido` en
      `tests/unit/analytics/tablero-agregacion.test.ts:198-220` (R16).
  - **depende de:** T1.2
  - **hecho:** afirman el comportamiento nuevo (serie por cubos + total del periodo) y siguen
    afirmando que **el cliente no promedia cocientes**.
  - **NO HECHO** si se **borran** en vez de reescribirse: la propiedad que protegian —nunca media
    de medias— sigue viva, solo cambia como se cumple.

---

## Tanda 2 — el catalogo y su ancla

- [x] **T2.1** Anadir `consultarAgregadoOperativo: vi.fn()` a la factoria de `vi.mock` de
      `tests/components/TableroOperativo.test.tsx` y de `TableroOperativoLatencia.test.tsx`.
  - **hecho:** los dos archivos siguen verdes **antes** de tocar `PanelOperativo.tsx`.
  - **Por que va primero:** en cuanto el componente importe el simbolo, esos dos archivos se ponen
    rojos por la factoria incompleta, y ese rojo se confunde con una regresion propia.

- [x] **T2.2** `catalogo-paneles.ts`: declarar `unidad` por metrica (R9).
  - **hecho:** typecheck limpio; el archivo **sigue sin importar** `lib/analytics/metrics`; y el
    catalogo **sigue teniendo SEIS paneles** (Q1 = B).
  - **NO HECHO** si la unidad se deriva en tiempo de ejecucion de la respuesta del servidor (D4:
    se declara, y se ancla por test), o si se anade cualquier panel nuevo — incluido el de aging,
    que tiene ficha propia (`requirements.md §5.1`).

- [x] **T2.3 [P]** Caso de R9 en `tests/unit/analytics/tablero-catalogo-paneles.test.ts`.
  - **depende de:** T2.2
  - **hecho:** el caso compara la unidad declarada contra `getMetrica(metricaId).unidad` para
    **todas** las metricas del catalogo de paneles.
  - **NO HECHO** si solo comprueba las dos metricas de tasa/tiempo: una metrica nueva mal declarada
    pasaria sin ruido.

---

## Tanda 3 — el cableado

- [x] **T3.1** `PanelOperativo.tsx`: las dos consultas SWR agregadas (`periodo` y `semana`) en la
      **misma oleada** que la serie (R11), con el grano en la clave (R10), y solo para las unidades
      declaradas `porcentaje`/`segundos` (R8).
  - **depende de:** T1.1, T2.1, T2.2
  - **hecho:** las tres claves comparten el prefijo `CLAVE_TABLERO` y el boton «Actualizar» las
    revalida sin tocar `PanelesOperativos.tsx`.
  - **NO HECHO** si aparece un `await` de la serie antes de pedir el agregado; si el grano no entra
    en la clave (la cifra del filtro anterior sobreviviria al cambio de filtro); o si se decide el
    grano resolviendo el rango en el cliente (Q2 descarto justamente eso).

- [x] **T3.2** `PanelOperativo.tsx`: reduccion de estado unificada (R13), render de la serie por
      cubos (R1, R14) y **retirada** del bloque `rango_excedido` con sus dos imports (R16).
  - **depende de:** T3.1
  - **hecho:** los cinco estados que ya distinguia el panel siguen distinguiendose, ahora tambien
    para la respuesta agregada; `TITULO_RANGO_EXCEDIDO`/`TEXTO_RANGO_EXCEDIDO` ya no se importan.
  - **NO HECHO** si un `forbidden` del agregado se traduce en «no hay cifra» o en el vacio de la
    grafica.

- [x] **T3.3** `textos.ts`: textos del total, del total parcial y del denominador cero (R4, R6,
      R7); **borrado** de `TEXTO_RANGO_EXCEDIDO` y `TITULO_RANGO_EXCEDIDO` (R16).
  - **depende de:** T3.2
  - **hecho:** el total parcial dice su hora de corte; el denominador cero tiene texto **propio**,
    distinto del vacio de la metrica; los dos textos muertos ya no estan en el archivo.
  - **NO HECHO** si el denominador cero se pinta como `0`, si reusa `VACIO_PANEL` (serian el mismo
    pixel para dos afirmaciones distintas), o si los textos muertos se dejan «por si acaso»:
    exportados y sin uso son exactamente lo que Q7 mando retirar.

---

## Tanda 4 — los tests de pantalla y el guardia

- [x] **T4.1** Casos de R1, R4, R6, R7, R10, R13 y R14 en
      `tests/components/TableroOperativo.test.tsx`; **reescritura** del caso de R27 de la 131
      (`:315-330`) y **retirada** de la asercion de `:342`, que queda vacua al desaparecer la
      constante (R16).
  - **depende de:** T3.3
  - **hecho:** cada caso lleva **el nombre exacto** de la tabla de §3; el archivo ya no importa
    `TITULO_RANGO_EXCEDIDO`.
  - **NO HECHO** si algun caso afirma solo «hay una cifra en pantalla» sin afirmar **cual**; o si
    la asercion de `:342` se deja viva contra una constante que ya no existe (verde por vacio).

- [x] **T4.2 [P]** Casos de R8 y R11 en `tests/components/TableroOperativoLatencia.test.tsx`, con
      el presupuesto de invocaciones actualizado a la oleada de tres claves por metrica de
      tasa/tiempo.
  - **depende de:** T3.1
  - **hecho:** el presupuesto queda **escrito como numero afirmado**, no como comentario; la
    dispersion de arranques se mide sobre el lote completo (serie + los dos granos); y el
    `expect(PANELES_OPERATIVOS.length).toBeLessThanOrEqual(6)` de `:106` **sigue intacto**.
  - **NO HECHO** si se relaja la cota de dispersion para que pase (esa cota es lo unico que
    distingue solapar de encadenar), o si se toca el tope de seis paneles: Q1 lo dejo en pie a
    proposito y subirlo aqui seria reabrir la D4 de la 131 de pasada.

- [x] **T4.3 [P]** `tests/unit/analytics/tablero-agregado-frontera.guardia.test.ts`: R12, el censo
      de R15 (**`lunesDeLaSemana` con un unico llamador**) y R16 (ni el modo ni sus dos textos
      viven en el subarbol).
  - **depende de:** T3.3
  - **hecho:** censa **el arbol** (nunca el diff), y tiene caso de **discriminacion**: un fixture
    infractor sintetico da positivo y la misma frase en un comentario da negativo.
  - **NO HECHO** si el caso de R15 se limita a comprobar que `lunesDeLaSemana` existe —el humano lo
    prohibio expresamente al cerrar Q4: lo que se afirma es el **acotamiento**—; si algun patron no
    casa con nada existente (un patron muerto da el mismo verde que un arbol limpio, la leccion de
    `export-csv-frontera.guardia.test.ts:210-227`); o si el censo puede quedar verde por vacio.

---

## Tanda 5 — cierre

- [x] **T5.1** Aplicar **las 16 mutaciones** de `requirements.md §3`, una a una: comprobar el rojo,
      revertir y pegar la salida en `progress/impl_182.md`.
  - **depende de:** T4.1, T4.2, T4.3
  - **hecho:** las 16 filas tienen su rojo pegado, con el **nombre del caso** que cayo. R15 lleva
    **dos** rojos (comportamiento y censo) y R16 el suyo propio (reponer los textos borrados).
  - **NO HECHO** si bajo alguna mutacion cae un caso **hermano** y no el nombrado: eso es anclaje
    silencioso (paso en la 125, la 126 y la 131) y la fila hay que reescribirla, no aprobarla.

- [x] **T5.2** Nota aditiva y fechada en `specs/131-.../requirements.md §6.1` y en la fila R27 de
      su trazabilidad (Q6 = A).
  - **depende de:** T5.1
  - **hecho:** la nota es **aditiva** (no reescribe la historia de la 131), dice **donde** vive
    ahora el comportamiento y lleva fecha.
  - **NO HECHO** si se edita un test de la 131 desde esta tarea: los tests de la 131 que cambian ya
    estan nombrados en T1.4 y T4.1, con su motivo.

- [x] **T5.3** Mapa `R<n> -> test` completo en `progress/impl_182.md` + lista definitiva de
      archivos tocados contrastada contra `design.md §1`.
  - **depende de:** T5.1
  - **hecho:** los **16** requisitos tienen al menos un test nombrado; la lista de archivos
    **coincide exactamente** con §1; y consta que `feature_list.json`, `progress/history.md` y el
    tope de seis paneles **no** se tocaron.
  - **NO HECHO** si algun archivo tocado no esta en §1 sin que §1 se haya actualizado antes con su
    motivo.

- [ ] **T5.4** Gate. `./init.sh --rapido` al cerrar cada tanda; **`./init.sh` completo** antes del
      PR (lo corre el leader, no el implementer).
  - **depende de:** T5.3
  - **hecho:** verde, con la salida pegada.
  - **NO HECHO** si se cierra la feature con solo `--rapido`: este cambio toca tests de componente
    de otra feature, borra simbolos exportados y depende de guardias que ningun grafo de imports
    selecciona.
  - **ESTADO (implementer, 2026-08-05): A MEDIAS, y por eso la casilla sigue vacia.**
    `./init.sh --rapido` corrido y **verde** (12 archivos / 129 casos por el grafo de cambios +
    63 archivos / 851 casos de guardias), mas `pnpm typecheck` limpio y
    `vitest run tests/unit/analytics tests/components/descarga` en verde (122 archivos / 1181
    casos). **El `./init.sh` completo NO lo ha corrido el implementer**: lo corre el leader tras
    mergear `dev`, que es donde esta escrito que se hace. Marcar esta casilla sin esa corrida
    seria exactamente lo que paso en la 134.
