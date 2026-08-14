# Feature 223 — Tareas

> Rama `feature/223-flujo-impresion-factura` desde `origin/dev`. El worktree lo decide el
> leader (no trabajar sobre un checkout con WIP ajeno).
> Cada tanda cierra con **`./init.sh --rapido`**. La feature cierra con **`./init.sh`
> completo, obligatorio antes del PR** (`docs/verification.md`).
> `[P]` = paralelizable con las tareas de su misma tanda.
> **El gate y las mutaciones NO corren en paralelo**: una guardia leída sobre un árbol que
> otro proceso está mutando no dice nada.

## Puerta humana: **PASADA (2026-08-14)**

No queda ninguna pregunta abierta. Las siete se cerraron así y **ya están en el articulado**:

| Q | Cierre | Efecto en estas tareas |
| --- | --- | --- |
| Q1 | **Sin botón «Imprimir»** (D1) | No hay tanda de botón; `factura-contraste.guardia.test.ts:265-273` **no se toca** y debe seguir verde |
| Q2 | **`size: portrait` sin nombre de papel** (D2) | **T8** escribe el literal; **T10** lo congela y la mutación 10 lo muerde |
| Q3 | **12 mm**, en un solo sitio y con su porqué (D3) | **T8** + **T10** |
| Q4 | **Límite de las pestañas declarado** (D4) | **T9** lo escribe junto a la regla; la feature se queda en CSS |
| Q5 | **La compacta SÍ es documento propio** (D5) | **Cambia el alcance**: marca de candidatura condicionada (**T12**), reglas de elección por contexto (**T7**), censo y jsdom propios (**T14**, **T16**), y las mutaciones **3, 4, 5, 15 y 19** |
| Q6 | **Límite del KPI declarado** (D6) | **T17** |
| Q7 | **Censo + mutaciones con variante inocua + UNA comprobación manual fechada** (D7) | **T19**, **T20**; nada de E2E |

Y las tres correcciones del leader: **C1** las dos rutas recortan → el diseño ataca las capas
(**T7**); **C2** la guardia del `@page` se **reexpresa** (**T18**); **C3** los anclajes dejan
de ser **posicionales** (**T5**, y va **antes** de tocar el CSS).

---

## Tanda 0 — El instrumento, los anclajes y la única medición pendiente

No toca código de producción.

- [ ] **T1.** Crear `tests/fixtures/css-reglas.ts` exportando `reglasDe`, `selectoresDe` y
  `declaracionesDe` tal como viven hoy en `tema-encendido.guardia.test.ts:34-95`, **sin cambiar
  una línea de su lógica**, leyendo con `codigoSinComentarios`.
  **Hecho:** `pnpm run typecheck` verde; el fixture no importa nada de `app/`; no ejecuta nada
  al importarse salvo la lectura del CSS. *(R32, R30)*
- [ ] **T2.** `tema-encendido.guardia.test.ts` pasa a **importar** del fixture y borra sus
  copias locales. Depende de T1.
  **Hecho:** la guardia entera verde **sin que ningún caso cambie de nombre ni de aserción**;
  el `git diff` sólo quita definiciones y añade un `import`. *(R32)*
- [ ] **T3.** `[P]` Censo: **cero** segundas copias del parser en `tests/`. Depende de T2.
  **Hecho:** queda **como aserción de una guardia**, no como comprobación manual de una vez.
  *(R32)*
- [ ] **T4.** **MEDIR el scroll lock** (`design.md §4.4`, la única incógnita técnica): un caso
  que abre el `Modal` en jsdom y **lee** `document.body.style` y
  `document.documentElement.style`.
  **Hecho:** el caso afirma, con el valor medido, qué estilos en línea deja el diálogo abierto;
  el resultado queda en `progress/impl_223.md` y **decide** si `overflow` entra en la lista de
  `!important` de R13. Si no aparece ninguno, el caso lo congela igual. *(R10, R13)*
- [ ] **T5.** **Los anclajes dejan de ser posicionales** *(C3)*. Reexpresar
  `tema-encendido.guardia.test.ts:185` (y sus usos en `:264` y `:352`) e
  `impresion-sin-dark.guardia.test.ts:184` para que localicen el bloque de la 217 **por su
  contenido** —la regla que declara los tokens de `.papel-al-imprimir`—, no por ser el primer
  `@media print`. **Va ANTES de T7**: así los casos siguen verdes cuando aparezca el segundo
  bloque, en vez de haber una ventana en la que apuntan a lo que no es. Depende de T2.
  **Hecho:** las dos guardias verdes **con el CSS de hoy**, y vistas **rojas** al mover el
  bloque de tokens de la 217 detrás de `.dark` — que es justo lo que el ancla posicional
  dejaba de detectar en cuanto hubiera dos bloques. *(R24, R31)*
- [ ] **T6.** `[P]` Verificar que la utilidad **`break-inside-avoid` existe en la versión de
  Tailwind instalada** y sale al CSS compilado.
  **Hecho:** anotado con la versión exacta en `progress/impl_223.md`; si no existiera, se
  decide la alternativa **antes** de la Tanda 2 (`design.md §7-G`). *(R19)*

> Cierre de tanda: `./init.sh --rapido`.

---

## Tanda 1 — El CSS (depende de la Tanda 0: primero el parser y los anclajes)

- [ ] **T7.** `app/globals.css`: el bloque `@media print` del flujo tal como `design.md §3.4`
  —cadena (B), ocultamiento (A) con sus **tres ramas** (nivel 1 fuera y dentro del diálogo,
  nivel 2), hoja (C) y `~` entre candidatas (D)—, colocado **después del bloque de la 217 y
  antes de `.dark`**. Sin tocar `.papel-al-imprimir`, `.dark`, `.tema-sistema`, `.tema-claro`
  ni `@custom-variant dark`. Sin `@layer`. Sin ninguna propiedad `--…`. `!important` sólo en lo
  que T4 haya justificado. **(B) va antes que (A)**. Dentro de los `:not()`, sólo selectores
  simples. Depende de T4, T5.
  **Hecho:** `pnpm run lint` verde; el `git diff` de `globals.css` **no muestra ni una línea**
  de los bloques de la 217, `.dark`, `.tema-sistema` ni el variant. *(R1-R3, R6-R8, R10-R14,
  R18, R20, R23-R26)*
- [ ] **T8.** `@page { size: portrait; margin: 12mm }` **dentro** de ese bloque (D2, D3).
  Depende de T7.
  **Hecho:** una sola `@page` en el archivo, sus ancestros contienen `@media print`, sin nombre
  de papel y sin `margin: 0`. *(R15, R16)*
- [ ] **T9.** El comentario **pegado encima** del bloque: qué hace, **cómo se elige la hoja**
  (candidata + elegida, y qué pasa con cero y con varias), por qué lista blanca, de dónde sale
  el margen, **qué `@page` no controla** (encabezado/pie del navegador, escala, «gráficos de
  fondo», papel del usuario) y **qué no se promete** (cabeceras de columna repetidas; lo
  plegado y las pestañas no visitadas no se imprimen). Depende de T7.
  **Hecho:** existe, está pegado a la regla —el patrón que la 217 ya exige para su límite
  (`tema-encendido.guardia.test.ts:258-289`)— y sus afirmaciones tienen su caso en T10.
  *(R4, R17, R21, R22)*
- [ ] **T10.** `tests/unit/guards/impresion-flujo.guardia.test.ts` (nueva): el **censo del CSS**
  completo de `design.md §6.4`, consumiendo el fixture de T1. Depende de T7, T8, T9.
  **Hecho:** las catorce aserciones verdes, **y las filas 1-4 y 6-14 y 17 de la tabla de
  mutaciones (§6.7) vistas rojas, cada una con su variante inocua**, con el resultado anotado.
  *(R2, R3, R6-R8, R10, R13-R17, R21, R23-R26, R31)*

> Cierre de tanda: `./init.sh --rapido`. **Antes de cerrar**, comprobar que
> `tema-encendido.guardia.test.ts` y `impresion-sin-dark.guardia.test.ts` siguen enteras en
> verde: si alguna se puso roja, o el bloque está en el sitio equivocado, o T5 no hizo su
> trabajo.

---

## Tanda 2 — El componente y la candidatura (depende de la Tanda 1)

- [ ] **T11.** Comprobación de una línea de `design.md §3.4`/H4: **dónde monta
  `Dialog.Portal`** (`popup.parentElement`). `[P]`.
  **Hecho:** el dato queda en `progress/impl_223.md`; si el contenedor no es `document.body`,
  se releen las ramas A.1/A.2 **antes** de T14 y se añade la fila que falte a la enumeración de
  R4. *(R4, R6)*
- [ ] **T12.** `cierre-factura.tsx`: estampar `hoja-imprimible` en el `<Card>` de `HojaFactura`
  (`:306-310`) **siempre**, y en el de `HojaResumen` (`:496-500`) **condicionada a `open`**
  (`open && "hoja-imprimible"`). Depende de T7.
  **Hecho:** typecheck y lint verdes; exactamente dos apariciones en el archivo, una de ellas
  dentro de la condición; las dos `<Card>` conservan `papel-al-imprimir`. *(R5)*
- [ ] **T13.** `cierre-factura.tsx`: `break-inside-avoid` en las **cinco** piezas de la lista
  cerrada (`design.md §6.1`): fila de orden (`:913`), bloque de renglones, rejilla de KPI
  (`:249`), cabecera de la hoja y franja del pie (`:1317`). **En ninguna otra**, y en particular
  **no** en los `<Card>`, ni en la sección de órdenes (`:1272`), ni en el panel de la pestaña
  (`:1287`). Depende de T6.
  **Hecho:** el recuento coincide con la lista y el diff **no toca ninguna utilidad de color**
  —si el inventario cerrado de la 217 se pone rojo, se movió algo que no tocaba—. *(R19, R20)*
- [ ] **T14.** `impresion-flujo.guardia.test.ts`: el **censo del `.tsx`** y el de los dos
  módulos (`design.md §6.5`), con `codigoSinComentarios`. Depende de T11, T12, T13.
  **Hecho:** verde, y **las filas 5, 15, 16 y 18 de §6.7 vistas rojas con su variante inocua**.
  Incluye el caso de R12 (`max-h-[70vh]` y `overflow-y-auto` siguen en el módulo,
  `overflow-auto` sigue en `Modal.tsx`, ninguno estrena `print:`) y el que congela que dentro de
  `HojaResumen` haya **un solo** `aria-expanded`. *(R5, R12, R19, R20, R27, R31)*
- [ ] **T15.** `CierreFacturaPapel.test.tsx`: **la candidatura ejecutándose** — la hoja compacta
  plegada **no** lleva `hoja-imprimible`; tras pulsar su toggle («Ver detalles»), **sí**; la del
  detalle la lleva siempre. Depende de T12.
  **Hecho:** los casos de la 217 (`:135-151`) siguen verdes **sin ser tocados**; el archivo
  declara en su cabecera qué **no** demuestra jsdom. *(R5, R23, R33)*
- [ ] **T16.** **La forma del DOM que la regla de elección supone** (`design.md §6.6`): con el
  modal del detalle abierto y una compacta desplegada detrás — (a) el popup expone
  `role="dialog"`; (b) dentro del diálogo hay **exactamente una** candidata; (c) hay ≥1
  candidata **fuera**; (d) la de dentro **no** es descendiente de la de fuera. Depende de T12,
  T15.
  **Hecho:** verde, **y las filas 19 de §6.7 vistas rojas** (montar dos hojas en el mismo
  `Modal`; quitar el `role="dialog"`). El archivo dice, con esas palabras, que **no prueba que
  la regla elija bien**: prueba que el DOM es el que la regla supone. *(R6, R9, R33)*

> Cierre de tanda: `./init.sh --rapido`.

---

## Tanda 3 — Reexpresar lo que esta ficha vuelve falso

Va **después** de que el flujo exista: reexpresar antes deja una ventana en la que nada
defiende nada.

- [ ] **T17.** `cierre-factura.tsx`: (a) reescribir el párrafo `:111-117` —hoy dice que no hay
  `@page`, ni márgenes, ni paginación, ni ocultamiento—, remitiendo al bloque de esta ficha y
  conservando **lo que sigue siendo cierto** (no hay botón, la única vía es `Ctrl+P`); (b)
  escribir junto a `KpiFactura` (`:249-253`) el **límite de la cifra animada** (D6): una
  impresión disparada en esa ventana de milisegundos puede llevar al papel una cifra
  intermedia, y no se arregla aquí porque tocaría el DOM que vigila el inventario de la 217.
  Depende de T12.
  **Hecho:** el censo de T14 afirma las dos cosas; el resto del bloque de cabecera —color,
  217, inventario cerrado— **no se toca**. *(R28, R29)*
- [ ] **T18.** **REEXPRESAR** `tema-encendido.guardia.test.ts:331-339` («nada de `@page`»)
  *(C2)*. No se borra ni se relaja: pasa a defender que el formato **no se mezcla** con el
  bloque de tokens de la 217 y que **no aparece en un tercer sitio**, y remite a la guardia
  nueva. Depende de T10.
  **Hecho:** el caso sigue existiendo, con nombre nuevo, y **muerde**: rojo al meter un `@page`
  dentro de la regla `.papel-al-imprimir` y rojo al añadir un segundo `@page`. *(R28, R31)*
- [ ] **T19.** `[P]` `app/globals.css:281-287`: reescribir el párrafo «LO QUE ESTA REGLA NO
  CUBRE» de la 217, remitiendo al bloque nuevo y conservando lo que sigue siendo cierto (la 217
  garantiza el color; el resto del portal imprime como antes). Depende de T7.
  **Hecho:** el caso de la 217 que exige un comentario pegado a **su** regla nombrando
  `` `dark:` `` (`:258-289`) sigue verde; ninguna prosa del CSS afirma ya que no hay flujo.
  *(R28)*

> Cierre de tanda: `./init.sh --rapido`.

---

## Tanda 4 — Cierre: evidencia, mutaciones y lo que no se promete

- [ ] **T20.** Bitácora de mutaciones en `progress/impl_223.md`: las **19 filas** de
  `design.md §6.7`, **cada una con su variante inocua** y con el resultado de las dos. Depende
  de T10, T14, T16, T18.
  **Hecho:** ninguna fila queda sin su par; si alguna variante inocua sale **verde**, la
  guardia **no está terminada** y se arregla antes de seguir. *(R31)*
- [ ] **T21.** **UNA comprobación MANUAL fechada** en al menos un motor real (D7,
  `design.md §6.8`): abrir el detalle en las **dos** rutas, `Ctrl+P` → «Guardar como PDF», y
  mirar **seis** cosas: (1) sale sólo la hoja; (2) no está recortada; (3) un cierre con muchas
  órdenes continúa en la página siguiente; (4) **con el detalle abierto, las hojas compactas de
  detrás NO salen**; (5) con la lista sin modal y **dos compactas desplegadas**, salen las dos,
  una por página; (6) con la lista sin nada desplegado, la página imprime como antes. Depende
  de T16.
  **Hecho:** motor, versión, fecha, qué se vio y qué no, en `progress/impl_223.md`,
  **declarado como fuera del gate** y con la frase que impida leerlo como cobertura permanente.
  Si algo no coincide con el diseño, **se vuelve a la puerta**: no se ajusta el spec para que
  encaje con lo que salió. *(R33 — y es la única comprobación de R1, R6, R7 y R8 en un motor)*
- [ ] **T22.** Mapa **R → test** completo en `progress/impl_223.md`. Depende de todas.
  **Hecho:** los 33 requisitos con su archivo y su caso; los que sólo tienen verificación
  **estructural** marcados como tales, y los que **no se verifican** (R33) listados con su
  motivo, no omitidos. *(R33)*
- [ ] **T23.** `./init.sh` **completo** antes del PR. Depende de todas.
  **Hecho:** verde entero, con la salida pegada en `progress/impl_223.md`. Un check de Vercel
  en verde **no cuenta**: es un build y no corre tests.

---

## Mapa R → verificación (propuesto)

| R | Dónde se verifica |
| --- | --- |
| R1 | §6.4 (las tres ramas existen con su guarda) + T21 (manual, punto 1) |
| R2 | §6.4 — **todos** los selectores llevan guarda `:has()`; mutación 2 |
| R3 | §6.4 — cero selectores que nombren componentes |
| R4 | §6.5 + el comentario de T9 (lista declarada) |
| **R5** | §6.5 (dos apariciones, una condicionada) + **T15 (jsdom: aparece al desplegar)**; mutaciones 5 y 15 |
| **R6** | §6.4 (las dos ramas y su predicado exacto) + T16 (forma del DOM) + T21 (manual, puntos 4 y 5); mutaciones 3 y 4 |
| **R7** | §6.4 (guarda `:has()`) + T21 (manual, punto 6); mutación 2 |
| **R8** | §6.4 (regla `~` con `break-before: page`) + T21 (manual, punto 5) |
| **R9** | T16 — `role="dialog"` y **una sola** candidata por diálogo; mutación 19 |
| R10 | §6.4 — las 13 propiedades de la lista cerrada; T4 la completa |
| R11 | §6.4 (ningún contenedor nombrado) + T15/T16 (las dos rutas montan el mismo componente) |
| R12 | §6.5 — censo de los dos módulos y de `Modal.tsx`; mutación 18 |
| R13 | §6.4 — recuento de `!important` contra la lista; T4 la fija; mutación 17 |
| R14 | §6.4 — `display: block` en la cadena **y** el orden (A) después de (B); mutación 14 |
| R15, R16 | §6.4 — una `@page`, sin nombre de papel, margen literal; mutaciones 9 y 10 |
| R17 | §6.4 — el comentario pegado declara lo que no controla |
| R18 | §6.4 (`overflow: visible` en cadena y hoja) + §6.5 (sin `break-inside` en las raíces) |
| R19 | §6.5 (recuento y sitios) + §6.6 (jsdom sobre la fila); mutación 16 |
| R20 | §6.5 — lista de prohibidos; mutación 16 |
| R21, R22 | §6.4 — el comentario declara el límite. **No hay test que pueda afirmar más** |
| R23 | Los casos de la 217 y la 221 **verdes sin ser tocados** |
| R24 | **T5** (anclajes por contenido, vistos rojos) + §6.4 (dos `@media print`, los dos antes de `.dark`); mutación 13 |
| R25 | §6.4 — cero `--…` en el bloque; mutación 12 |
| R26 | §6.4 — ancestros sin `@layer`; mutación 11 |
| R27 | `factura-contraste.guardia.test.ts:265-273`, verde sin ser tocada |
| R28 | T18 (guardia reexpresada) + §6.5 (prosa del `.tsx`) + T19 |
| R29 | §6.5 — el límite está escrito junto a `KpiFactura` |
| R30 | Todos los censos usan `codigoSinComentarios`; mutaciones 6 y 8 (declaración escrita en un comentario → roja) |
| R31 | T20 — las 19 filas con su variante inocua |
| R32 | T1-T3 |
| R33 | T21 (manual, fuera del gate) + T22 (lista de lo no verificado) + las cabeceras de §6.6 |
