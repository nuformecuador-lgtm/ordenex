# Feature 217 — Tareas

> Rama `feature/217-factura-oscurece-con-el-tema` desde `origin/dev`. El worktree lo
> decide el leader (no trabajar sobre un checkout con WIP ajeno).
> Cada tanda cierra con **`./init.sh --rapido`**. La feature cierra con **`./init.sh`
> completo, obligatorio antes del PR** (`docs/verification.md`).
> `[P]` = paralelizable con las tareas de su misma tanda.
> **El gate y las mutaciones NO corren en paralelo**: una guardia leída sobre un árbol
> que otro proceso está mutando no dice nada.

> **Versión 2 — 2026-08-13, tras la puerta humana.** Las cinco decisiones (D5-D9) están
> plegadas. **La Tanda 0 cambió por completo**: ya no monta un medidor de navegador
> (D9 lo prohíbe), sino que **saca a un fixture compartido la aritmética que ya está
> commiteada y validada** en `tests/unit/guards/contraste-tokens.guardia.test.ts`.

> **Estado al cerrar (2026-08-13): las 23 hechas.** Dos notas de honestidad sobre el orden y
> sobre una de ellas:
>
> - **T16 se adelantó de la Tanda 4 a la Tanda 2.** T10 censa **0 `tema-claro` en TODO el
>   archivo, comentarios incluidos** (R19), y el bloque de cabecera de la 208 nombraba el pin
>   nueve veces: o se movía T16, o T10 quedaba rojo dos tandas.
> - **T20 se dio por hecha una vez y no lo estaba.** Su fila 13 —«borrar la declaración del
>   límite `dark:`»— se reportó roja, pero el caso que debía morder anclaba en el primer
>   literal `@media print` del archivo, que es **prosa** del comentario de `.tema-claro`, no la
>   regla. El reviewer lo destapó; está corregido y **vuelto a medir de verdad**. El detalle,
>   en `progress/impl_217.md`.

## Puerta: PASADA

No queda ninguna pregunta abierta. Las cinco quedaron así, y ya están en el articulado:

| Q | Cierre | Efecto en estas tareas |
| --- | --- | --- |
| Q1 | La nota de «Ingreso bruto» **ENTRA** (D5) | **T7** deja de ser condicional: es obligatoria |
| Q2 | La impresión se **ACOTA** a las dos hojas (D6) | T4/T5 sin cambios de alcance; **no** se reexpresa `tema-encendido:101` |
| Q3 | `dark:` al imprimir **se ACEPTA** (D7) | **T13** escribe la declaración junto al bloque; la raíz sale a ficha aparte |
| Q4 | **NO** hay botón «Imprimir» (D8) | **T13** escribe también qué NO cubre la impresión |
| Q5 | El medidor **sí está commiteado**, no es el detector de `.claude/skills` (D9) | **Tanda 0 reescrita**; Tanda 3 pasa a ser el inventario de pares |

---

## Tanda 0 — El instrumento: una sola aritmética, compartida (R25, R26)

Todo lo que mide en esta feature cuelga de aquí. No toca código de producción.

- [x] **T1.** Crear `tests/fixtures/contraste.ts` (patrón de
  `tests/fixtures/sin-comentarios.ts`, feature 209) exportando la aritmética que hoy
  vive encerrada en `contraste-tokens.guardia.test.ts`: `aRgb` (`:72`), `luminancia`
  (`:80`), `contraste` (`:88`), `componer` (`:100`), **y el lector de tokens de
  `app/globals.css`** — `partirPorTema` (`:126`), `token` (`:140`), `paleta` (`:161`)
  —. Sin cambiar una sola línea de su lógica en esta tarea.
  **Hecho:** `pnpm run typecheck` verde; el fixture no importa nada de `app/` ni de
  producción; el módulo no ejecuta nada al importarse salvo la lectura del CSS.
  *(R25)*
- [x] **T2.** `contraste-tokens.guardia.test.ts` pasa a **importar** del fixture y
  borra sus copias locales. **Sus tres autocontroles se conservan intactos** —tres
  razones publicadas de WCAG (`:176`), los dos extremos de la composición alfa
  (`:183`), el lector devolviendo el token vigente y no un hex de un comentario
  (`:188`)— y a partir de ahora validan la copia compartida. Depende de T1.
  **Hecho:** la guardia entera verde **sin que ninguno de sus casos cambie de nombre ni
  de aserción**; `git diff` de ese archivo sólo quita definiciones y añade un `import`.
  *(R25, R26)*
- [x] **T3.** **El arreglo del lector ante `@media print`**, dentro del fixture: quitar
  los bloques `@media print { … }` del CSS **antes** de `partirPorTema`, con el
  comentario que nombre el fallo concreto que evita (§6.2 del design: si el bloque cae
  detrás de `.dark`, `token("oscuro", …)` devuelve los hexes **claros** y las ocho
  comprobaciones de oscuro pasan a medir el tema equivocado **en verde**). Depende de
  T2.
  **Hecho:** la guardia de la 210 sigue verde con el CSS de hoy; el comentario dice qué
  evita y por qué está en el fixture y no en una guardia. *(R25, habilita R6/R7)*
- [x] **T4.** `[P]` Censo: **cero** segundas copias de la aritmética de contraste en
  `tests/` (buscar `0.2126`, `0.7152`, `+ 0.05`), y **cero** referencias a
  `.claude/skills/impeccable/scripts/detector/` en `tests/` y en la verificación de
  esta feature. Depende de T2.
  **Hecho:** el censo pasa y queda como aserción de una guardia, no como una
  comprobación manual de una vez. *(R25, R26)*

> Cierre de tanda: `./init.sh --rapido`.

---

## Tanda 1 — El CSS (depende de la Tanda 0: primero el lector, después el bloque)

**El orden entre T3 y T5 no es negociable.** Si T5 aterriza sin T3, la guardia de
contraste empieza a medir los pares claros creyendo que son los oscuros **y sigue en
verde**.

- [x] **T5.** `app/globals.css`: bloque `@media print { .papel-al-imprimir { … } }` con
  **todas** las declaraciones del bloque `:root, .tema-claro` (`:149-192`), sin
  excepción, colocado **inmediatamente después de ese bloque y antes de `.dark`**
  (`:210`). Sin `print-color-adjust`. **No se toca** `.dark`, ni `.tema-sistema`, ni
  `@custom-variant dark` (D6). Depende de T3.
  **Hecho:** `pnpm run lint` verde; el bloque copia el otro clave a clave (lo comprueba
  T6, no el ojo); `git diff` de `globals.css` no muestra ninguna línea de los bloques
  `.dark` / `.tema-sistema` / `@custom-variant`. *(R9, R10, R11, R12, R13)*
- [x] **T6.** `tema-encendido.guardia.test.ts`: casos nuevos del bloque de impresión
  usando el parser que ya vive ahí (`reglasDe`, `:71`) — **no un parser nuevo**:
  exactamente una regla `.papel-al-imprimir`; sus ancestros contienen `@media print`;
  sus declaraciones son **`toEqual`** a las de la regla que incluye `:root` y
  `.tema-claro`; el bloque declara `--foreground` y `--card-foreground` y tiene más de
  20 declaraciones; cero `print-color-adjust` en `globals.css`. Depende de T5.
  **Hecho:** los casos verdes, los casos preexistentes de `.dark` / `.tema-sistema` /
  variant **verdes sin haber sido tocados**, y los nuevos **vistos rojos** con: borrar
  el bloque, cambiar un hex dentro de él, y quitarle el `@media print` dejando la regla
  suelta. *(R9, R10, R11, R12, R13, R24)*

> Cierre de tanda: `./init.sh --rapido`.

---

## Tanda 2 — El componente (depende de la Tanda 1)

- [x] **T7.** `cierre-factura.tsx`: quitar `tema-claro` de **las dos** hojas (`:313` y
  `:503`) y estampar `papel-al-imprimir` en su lugar, en las dos.
  **Hecho:** typecheck y lint verdes; ninguna de las dos `<Card>` contiene ya
  `tema-claro`. *(R1, R9)*
- [x] **T8.** `cierre-factura.tsx`: migrar las **16** utilidades fijas exactamente según
  la tabla de `design.md §2` — quince `text-navy` → `text-foreground` y el `border-navy`
  de `:854` → `border-foreground`. Ni un token de marca (`primary` / `brand`), ni un
  `-strong`. Depende de T7.
  **Hecho:** censo con los comentarios quitados = **0** `text-navy` y **0**
  `border-navy`; typecheck y lint verdes; el diff **sólo** cambia utilidades de color
  (ningún tamaño, peso, espaciado ni estructura). *(R2, R3, R4, R5)*
- [x] **T9.** *(D5 — ya no es condicional.)* `cierre-factura.tsx:818`:
  `text-success-strong/80` → `text-success-strong`. Depende de T7.
  **Hecho:** el archivo no contiene ninguna opacidad aplicada sobre un token `-strong`
  (`text-*-strong/NN`), y el par P9 del inventario queda medible sin caso especial.
  *(R8)*
- [x] **T10.** `tests/unit/guards/factura-contraste.guardia.test.ts` (nueva), parte
  **censo de fuente**, con el quitador **compartido**
  (`tests/fixtures/sin-comentarios.ts`): las nueve aserciones de `design.md §6.4`, con
  la excepción `brand` **escrita con su motivo** (wordmark exento por WCAG 1.4.3 +
  franja `aria-hidden`). Depende de T8 y T9.
  **Hecho:** verde, y **vista roja** al devolver un `text-navy`, al devolver
  `tema-claro` a una hoja, al devolver el `/80` a `:818` y al meter un `bg-white`.
  *(R1, R2, R3, R8, R11, R14, R19, R24)*
- [x] **T11.** `[P]` Test de componente: sobre `CierreFacturaDetalle` y
  `CierreFacturaResumen`, localizar el `<Card>` por `role="region"` + `aria-label`
  (nunca por clase) y afirmar que **no** lleva `tema-claro`, que **sí** lleva
  `papel-al-imprimir`, y que la pestaña activa lleva `border-foreground` y
  `text-foreground`. Con la advertencia escrita **en el propio test** de que jsdom sólo
  lee la cadena de clases: no compone color ni aplica `@media`. Depende de T8.
  **Hecho:** verde, y visto rojo al devolver el pin a una sola de las dos hojas.
  *(R1, R3, R9)*

> Cierre de tanda: `./init.sh --rapido`.

---

## Tanda 3 — El inventario CERRADO de pares (depende de T8, T9 y la Tanda 0)

Es el corazón de la verificación. Sustituye al barrido de navegador que D9 descartó.

- [x] **T12.** **Cerrar el inventario** de `design.md §6.3` recorriendo
  `cierre-factura.tsx` de arriba abajo: confirmar los 16 pares de partida, **añadir los
  que falten** y **quitar los que no ocurran**. No transcribir la tabla del design: el
  design puede tener un error y esta tarea existe para encontrarlo. Incluir los pares
  de **hover** (`:922` mueve P4, P8 y P14) y dejar P15/P16 **marcados como exentos**,
  no ausentes. Depende de T8, T9.
  **Hecho:** la lista final, con su ancla por par, está en `progress/impl_217.md`, y
  cada utilidad de color del archivo mapea a exactamente un par. *(R6, R7, R16)*
- [x] **T13.** **Lo que entra a la hoja por props, no por el archivo.** El censo de T12
  lee `cierre-factura.tsx`, pero las hojas reciben subárboles ajenos: `acciones`
  (`:391`), `rotulo` (`:398`), `extra` y los `children` de `HojaFactura`. Enumerar qué
  monta cada llamador —`CierresAdminModule.tsx:749,827` y
  `CierreDiaModule.tsx:730`— dentro de la hoja, y clasificar cada pieza: (a) usa tokens
  que giran → cae en un par del inventario; (b) es una variante de primitiva → **se
  declara como deuda 210/216, no se parchea** (R18); (c) trae color propio fijo →
  **hallazgo**, y hay que decidirlo antes de cerrar. Depende de T12.
  **Hecho:** la lista por llamador está en `progress/impl_217.md`, sin ninguna pieza sin
  clasificar; si aparece un caso (c), se detiene y se consulta. *(R7, R18)*
- [x] **T14.** `factura-contraste.guardia.test.ts`, parte **aritmética**: medir cada par
  del inventario con el fixture de la Tanda 0, en **los dos temas**, componiendo las
  capas de opacidad (`muted/40`, `muted/50`, `success/15`, `warning/15`) sobre lo que
  hay debajo. Umbral 4,5 para texto, **3,0** para el borde de la pestaña (P12), y
  **suelo por par** con el valor medido al cerrarlo. Depende de T12.
  **Hecho:** todos los pares verdes con umbral **y** suelo; los exentos aparecen en la
  salida marcados como exentos y no como aprobados; **vista roja** al empeorar
  `--foreground` oscuro por debajo de 4,5 sobre `--card`, y al pintar un texto de la
  hoja con un par no listado. *(R4, R6, R7, R8, R16, R24)*
- [x] **T15.** **La mutación obligatoria de esta ficha.** Mover el bloque `@media print`
  **detrás** de `.dark` y revertir T3; comprobar que la guardia de contraste se pone
  **roja**. Restaurar. **No correr en paralelo con nada.** Depende de T14.
  **Hecho:** el rojo queda pegado en `progress/impl_217.md`. Si sale **verde**, T3 no
  está haciendo nada y hay que volver a T3 antes de seguir. *(R24)*

> Cierre de tanda: `./init.sh --rapido`.

---

## Tanda 4 — La prosa, la declaración y la guardia que congela lo contrario

- [x] **T16.** Reescribir el bloque `cierre-factura.tsx:73-128` y los comentarios de
  `:308-309` y `:496-499`. El bloque nuevo debe decir: que la hoja **gira** con el
  tema; que al **imprimir** vuelve a claro y **por qué el mecanismo es fijar tokens y no
  pintar un fondo** (la medición de los 116); **qué NO apaga la regla de impresión**
  —el variant `dark:`, con su razón: el resultado impreso es idéntico al que la hoja ya
  muestra hoy, no es una regresión (D7)—; **qué NO cubre la impresión** —no hay botón,
  y desde el modal se arrastra el resto de la página (D8)—; y que
  `progress/impl_208_modo-oscuro.md` describe la decisión **anterior** y no se edita.
  Depende de T8.
  **Hecho:** cero afirmaciones de que la factura se fija a claro; T10 sigue verde (busca
  `tema-claro` en **todo** el archivo, prosa incluida). *(R14, R15, R19)*
- [x] **T17.** `[P]` `app/globals.css`: (a) reescribir la **viñeta 2** de `:121-127` —la
  factura deja de ser consumidora de `.tema-claro`— y el párrafo «LÍMITE MEDIDO»
  (`:139-147`) en la parte que habla de la hoja; (b) escribir **junto al bloque de
  impresión** su límite declarado (R15): el variant `dark:` sigue disparando al
  imprimir desde tema oscuro, no es regresión, y la raíz sale a ficha aparte.
  **Hecho:** quien lea la regla de impresión encuentra ahí su límite, sin abrir este
  spec. *(R15, R19)*
- [x] **T18.** `[P]` **Reexpresar** `tema-encendido.guardia.test.ts:162`: el título
  nombra la landing (`app/page.tsx:50`) y la elección «claro» del portal
  (`lib/tema/tema.ts:64`), **no la factura**, y las aserciones del cuerpo **no se
  debilitan**.
  **Hecho:** la guardia sigue verde y sigue defendiendo `.tema-claro`; ningún caso
  borrado, ninguna aserción relajada. *(R20, R21)*

> Cierre de tanda: `./init.sh --rapido`.

---

## Tanda 5 — Cerrar

- [x] **T19.** Declarar por escrito lo que queda fuera, con ancla y número fechado
  (2026-08-13): lo preexistente ajeno al pin y a R8 que aparezca al cerrar el
  inventario (R17), y las variantes de primitivas que sigan bajo el umbral dentro de la
  hoja (R18) —hoy, por lectura de código, el candidato vivo es `Button` variant
  `destructive`, `button.tsx:24`—, remitiendo a las fichas 210/216. Depende de T12.
  **Hecho:** la lista está en `progress/impl_217.md` y **ninguna** de esas variantes se
  corrigió con clases locales: `git diff --name-only` no incluye `components/ui/`.
  *(R17, R18)*
- [x] **T20.** Bitácora de mutaciones completa (`design.md §6.7`, las diez) con su
  resultado. Secuencial, nunca en paralelo con el gate.
  **Hecho:** las diez vistas rojas y el árbol restaurado (`git status` limpio salvo el
  trabajo de la feature). *(R24, R26)*
- [x] **T21.** Frontera: `git diff --name-only` **acotado** al inventario de
  `design.md §0` —cero archivos de `db/`, `lib/`, `app/api/`, `components/ui/`— y los
  tests de componente y E2E de la factura **verdes sin haber sido modificados**.
  **Hecho:** el listado pegado en `progress/impl_217.md`; si un test de la factura se
  puso rojo, se corrige el **código**, no el test (sería una violación de R23).
  *(R5, R22, R23)*
- [x] **T22.** Mapa `R1..R26 → test` completo en `progress/impl_217.md` y **`./init.sh`
  completo en verde** antes de abrir el PR. Comprobar además que `origin/dev` no se
  movió desde la última medición del pre-vuelo.
  **Hecho:** los 26 requisitos con dueño; ninguna fila «pendiente». *(CHECKPOINTS.md)*
- [x] **T23.** Avisar al leader de las **dos fichas que esta feature da de alta**
  (`design.md §9`): apagar el variant `dark:` al imprimir en toda la app, y un flujo de
  impresión de la factura (`@page`, ocultar el resto, paginar).
  **Hecho:** las dos comunicadas con su motivo de separación. *(D7, D8)*

---

## Mapa R → verificación (propuesto; se cierra en `progress/impl_217.md`)

| R | Cómo se verifica | Dónde |
| --- | --- | --- |
| R1 | censo: 0 `tema-claro` en el archivo · Card sin la clase en jsdom | T10, T11 |
| R2 | censo: 0 `text-navy` / `border-navy` + lista negra de utilidades fijas | T10 |
| R3 | censo (`border-foreground` presente, lista negra) · jsdom (pestaña activa) · pares P1/P12 | T10, T11, T14 |
| R4 | par P1 en **claro** con umbral y suelo | T14 |
| R5 | el diff sólo cambia utilidades de color · tests de componente existentes verdes sin tocar | T8, T21 |
| R6 | **el inventario cerrado, medido en los dos temas**, con composición de capas | T12, T14 |
| R7 | cierre del inventario (utilidad sin par = rojo) + lo que entra por props + **suelo por par** | T12, T13, T14 |
| R8 | censo: 0 `text-*-strong/NN` · par P9 medible sin caso especial | T9, T10, T14 |
| R9 | regla `.papel-al-imprimir` única + 2 apariciones en el TSX + jsdom | T6, T10, T11 |
| R10 | el bloque declara `--foreground` y `--card-foreground`, no sólo `--card` | T6 |
| R11 | 0 `print-color-adjust` en el TSX y en `globals.css` | T10, T6 |
| R12 | espejo `toEqual` contra el bloque `:root, .tema-claro` | T6 |
| R13 | ancestro `@media print` obligatorio · `.dark`/`.tema-sistema`/variant intactos | T5, T6 |
| R14 | 0 `window.print` y 0 rótulo «Imprimir» · lo no cubierto, escrito | T10, T16 |
| R15 | `@custom-variant dark` intacto · la declaración escrita junto al bloque | T5, T6, T16, T17 |
| R16 | P15/P16 en el inventario **marcados exentos** · excepción `brand` con motivo | T12, T10, T14 |
| R17 | declaración con ancla y número fechado | T19 |
| R18 | `git diff --name-only` sin `components/ui/` · deuda declarada, incluida la que entra por props | T13, T19 |
| R19 | 0 `tema-claro` en todo el archivo, prosa incluida · prosa de `globals.css` reescrita | T10, T16, T17 |
| R20 | caso `tema-encendido:162` reexpresado, sin borrar ni relajar | T18 |
| R21 | `.tema-claro` intacta y sus tests de tema verdes sin tocar | T6, T18 |
| R22 | `git diff --name-only` acotado al inventario de `design.md §0` | T21 |
| R23 | tests de componente y E2E de la factura verdes **sin modificar** | T21 |
| R24 | bitácora de las diez mutaciones, cada una vista roja, con la de `@media print` detrás de `.dark` como obligatoria | T6, T10, T11, T14, T15, T20 |
| R25 | fixture compartido · la 210 importa de él · 0 segundas copias en `tests/` | T1, T2, T3, T4 |
| R26 | los tres autocontroles verdes sobre la copia compartida y rojos al romper la fórmula · 0 uso del detector de `.claude/skills` | T2, T4, T20 |

---

## Dependencias, de un vistazo

```
T1 → T2 → T3 → T5 → T6 ──┐
      └→ T4 [P]           │
                          ├→ T7 → T8 ─┬→ T10 ──┐
                          │           ├→ T9 ───┤
                          │           └→ T11[P]│
                          │                    ├→ T12 ─┬→ T13 ──┐
                          │                    │       └→ T14 → T15
                          │                    │                └→ T19
                          │           T16 ─────┤
                          │           T17 [P] ─┤
                          │           T18 [P] ─┘
                          └──────────────────────→ T20 → T21 → T22 → T23
```

**Sin bloqueos externos:** la puerta humana está pasada y no queda ninguna pregunta
abierta. Si al cerrar el inventario (T12) aparece un par que la aritmética **no sepa
resolver** —una opacidad sobre otra opacidad, o un color en una notación que el lector
no parsee—, la regla es **abstenerse**: se marca *indeterminado*, no se le pone un
número plausible, y se vuelve a la puerta con esa pregunta.
