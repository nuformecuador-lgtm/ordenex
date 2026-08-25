# Feature 283 — Tasks

> Checklist ejecutable. `[P]` = paralelizable con las tareas marcadas igual **dentro de su
> tanda**. Cada task lleva su criterio de «hecho» y sus dependencias.
>
> **Reglas duras de esta ficha:**
> - **T0 bloquea todo.** No se toca una línea del quitador antes de tener los números de hoy.
> - **El gate y las mutaciones nunca en paralelo**: el gate leería el árbol mutado y su
>   veredicto no valdría.
> - **Los scripts de un solo uso se escriben a archivo y se borran**, nunca inline: `node -e`,
>   heredocs con regex y backticks pierden una capa de escapado, y aquí todo son barras y
>   asteriscos. Se dejan en el scratchpad, no en el repo.
> - **Rama:** `feature/283-quitador-comentarios`. Un commit por task lógica.

---

## Tanda 0 — Medir el hoy (bloquea todas las demás)

Precedente explícito: la 279 escribió *«no se heredó el número: se volvió a medir»*. Aquí igual,
y con más motivo (ver `requirements.md`, P6: el spec_author no tuvo shell).

- [x] **T0.1 — Re-censar el daño con el quitador ACTUAL.**
  Script de un solo uso que pasa cada `.ts`/`.tsx` por el `quitarComentarios` del repo,
  excluyendo `node_modules`, `.next`, `.claude`, `dist`, `coverage` y `.design-work`, y cuenta
  las **líneas con código real** que desaparecen.
  **Hecho cuando:** en `progress/impl_283.md` están escritos (a) archivos analizados, (b)
  archivos que pierden código, (c) líneas perdidas, (d) los 10 peores con su cifra. Y está
  dicho si coinciden o no con los del leader (2.698 / 149 / 1.958). Script borrado.
  *(Ancla ya confirmada por lectura, para saber si el censo está midiendo lo que cree:
  `cotizacion-orden-service.test.ts` abre en **243** y cierra en **752**;
  `novedad-acciones-sin-maqueta.guardia.test.ts` abre en **295** y cierra en **543**. Si el
  censo no reproduce esos dos pares, el censo está mal, no el árbol.)*
  → **R17**

- [x] **T0.2 [P] — Línea base de rendimiento.**
  Tres corridas limpias de `pnpm run test:guardias` y una de `pnpm run typecheck`, sin nada más
  ejecutándose. Se anota la mediana, no la media.
  **Hecho cuando:** las tres cifras y su mediana están en `progress/impl_283.md`, con máquina y
  hora. **No se cita el ~8 s de `docs/verification.md`**: es de 2026-08-03.
  → **R25**

- [x] **T0.3 [P] — Censar las hermanas y confirmar (o corregir) la tabla de `design.md` §6.**
  Números a confirmar: `.sql` totales (**307**), `.sql` con `/*` dentro de un `--` (**8**),
  `.sql` con un `*/` posterior que haga casar el regex (**0**), `.sql` con `--` dentro de un
  literal (**0**), `.css` reales fuera de `node_modules`/`.claude` (**1**), `//` en
  `app/globals.css` (**0**), `/*` dentro de una cadena CSS (**0**).
  **Hecho cuando:** los siete números están re-medidos en `progress/impl_283.md`. **Si alguno
  sale distinto de 0, se PARA y se reabre P2/P3** antes de seguir: la decisión de dejar SQL y
  CSS fuera cuelga de que sean ceros.
  → **R23, R24**

- [x] **T0.4 [P] — Censar la prosa que quedará falsa.**
  Buscar en `tests/` las frases que afirman la limitación como vigente. Conjunto conocido de
  partida: `sin-comentarios.ts` (docstring de cabecera, ~líneas 30-36), `sin-comentarios.ts`
  (docstring de `quitarComentariosCss`, la cita «un `//` que abre una cadena si se lo lleva»),
  `quitador-comentarios.guardia.test.ts` (cabecera del `describe` de la 223, ~177-194),
  `quitador-comentarios.guardia.test.ts:292-297` (el cable trampa),
  `cotizacion-orden-service.test.ts:914-916`.
  **Hecho cuando:** la lista es **cerrada** (ruta:línea) y está en `progress/impl_283.md`, con
  marca de cuál requiere la autorización de P4.
  → **R21**

---

## Tanda 1 — Los casos rojos, antes del arreglo

*Depende de: T0.1.*

- [x] **T1.1 — Escribir el bloque «283 — el defecto» en `quitador-comentarios.guardia.test.ts`.**
  Un `describe` nuevo con `quitadorViejo` inlineado (el patrón que el archivo ya usa en sus
  líneas 277-289) y **un `it` por caso, cada uno en las dos caras**:
  1. `/*` dentro de un `//` → el viejo pierde el código de abajo, el nuevo lo conserva.
  2. `/*` dentro de una cadena → ídem.
  3. `//` dentro de una cadena → ídem, y la cadena sale entera.
  4. **No-regresión:** URL entre comillas seguida de código en la misma línea → **los dos**
     aciertan (el `[^:]` estaba ahí por algo).
  **Hecho cuando:** los casos 1-3 están **ROJOS** contra el quitador de hoy y las aserciones
  sobre `quitadorViejo` están VERDES; el 4 está verde entero. Salida pegada en el impl doc.
  → **R7, R8, R9, R10, R16**

---

## Tanda 2 — El escáner

*Depende de: T1.1. Secuencial dentro de la tanda: son ediciones del mismo archivo.*

- [x] **T2.1 — Sustituir el cuerpo de `quitarComentarios` por el escáner de un recorrido.**
  Estados y reglas en `design.md` §3. `espacioConSaltos` **se conserva tal cual**. Resultado por
  segmentos + `join("")`. Firma y exports intactos.
  **Hecho cuando:** T1.1 en verde; `pnpm run typecheck` en **0 errores**; los 33 casos que ya
  existían en `quitador-comentarios.guardia.test.ts` siguen verdes sin editarlos.
  → **R1, R2, R3, R5, R6, R7, R8, R9, R10**

- [x] **T2.2 — La regla de la comilla sin pareja.**
  Comilla simple/doble sin pareja no escapada **antes del fin de su línea** → no abre cadena.
  Backtick sin pareja en el resto del archivo → ídem.
  **Hecho cuando:** hay un caso con `<p>Don't panic</p>` seguido de `const vivo = 1;` y otro con
  un backtick suelto, y en los dos el código de abajo sobrevive. **Y** el caso muere si se quita
  la regla (se comprueba en T6.1(b)).
  → **R13**

- [x] **T2.3 — Escapes, plantillas multilínea y `${}` anidado.**
  Pila de profundidad, no bandera.
  **Hecho cuando:** hay caso para `'\''`, para una plantilla de 3 líneas con un `//` dentro, y
  para `` `a${b ? `x` : `y`}c` `` (la de fuera no se cierra en la de dentro).
  → **R11, R12**

- [x] **T2.4 — Re-fijar el número de líneas contra el escáner.**
  Los dos casos de «conserva el NUMERO DE LINEAS» que ya existen (líneas 129-150) **no se
  editan**: se comprueba que siguen verdes. Se añade uno con un bloque multilínea **abierto
  dentro de una cadena**, que con el quitador viejo desalineaba el archivo entero.
  **Hecho cuando:** los tres verdes, y `lineasSinComentarios(f).length === f.split("\n").length`
  afirmado sobre un fuente real del árbol.
  → **R4, R22**

- [x] **T2.5 — Reescribir el docstring del módulo.**
  El bloque «Que NO es» deja de afirmar que un `//` dentro de un literal se lleva la línea, y
  pasa a describir el escáner: qué contextos entiende, la regla de la comilla sin pareja y **qué
  sigue sin hacer** (expresiones regulares) con el motivo. La tabla de las cuatro semánticas de
  la 207 **se conserva**: sigue siendo el porqué de que haya un solo quitador.
  **Hecho cuando:** el docstring no contiene ninguna afirmación falsa, y el caso existente
  «`codigoSinComentarios` … devuelve el codigo del archivo, ya despiojado» sigue verde.
  → **R20**

- [x] **T2.6 — Afirmar la limitación que queda.**
  Un `it` con el formato de las limitaciones de la 209/223: una regex con `/*` sin escapar abre
  comentario, y se dice por qué no se cierra (haría falta un parser) y cómo se sabría si
  empezara a doler (el censo de T3.2).
  **Hecho cuando:** el caso existe y describe el comportamiento **real**, no el deseado.
  → **R14**

---

## Tanda 3 — Cable trampa, censo y hermanas

*Depende de: T2. T3.1 primero; T3.2, T3.3 y T3.4 en paralelo entre sí.*

- [x] **T3.1 — Reescribir el cable trampa (línea 292).**
  Contenido exacto en `design.md` §5. **No se borra**: se invierte, en su sitio y en su
  `describe`, y su comentario cierra la frase que la 209 dejó abierta, diciendo ficha y fecha, y
  **que no se cerró como la 209 preveía** (el parche a `[^:]` no habría tocado el daño grande).
  **Hecho cuando:** el caso afirma que `llamar()` sobrevive, que `"//"` se conserva **y** que un
  comentario de verdad al final de esa línea sí desaparece. Y muere en T6.1(a).
  → **R19**

- [x] **T3.2 — El censo diferencial de monotonía.**
  Recorrer los `.ts`/`.tsx` con las exclusiones de R15 y producir, por archivo, líneas
  recuperadas y **líneas perdidas** por el barrido nuevo respecto del viejo.
  **Hecho cuando:** la columna «perdidas» es **0 en todos los archivos**, y el total de
  recuperadas está escrito con su número (contraste con el 152 archivos / 4.599 líneas del
  leader). **Si algún archivo pierde algo, se PARA**: es un fallo de T2.2 o la limitación de
  T2.6 dejando de ser teórica, y hay que decir cuál con el archivo delante.
  → **R15, R17**

- [x] **T3.3 [P] — Cable trampa de SQL.**
  Caso en `quitador-comentarios.guardia.test.ts` que recorre `db/migrations/**/*.sql` y falla
  **nombrando el archivo** si alguno cumple la precondición del daño: un `/*` dentro de un `--`
  o de un literal **con** un `*/` posterior, o un `--` dentro de un literal de cadena. El mensaje
  de fallo explica que la deuda de `quitarComentariosSql` acaba de pasar de latente a viva y
  remite a `design.md` §6.2.
  **Hecho cuando:** verde hoy sobre los 307 archivos; y **rojo** al añadir un `/* nota */` a una
  copia temporal de uno de los 8 `down.sql` marcados (mutación, se revierte). `db/` no queda
  tocado: `git status db/` vacío.
  → **R23**

- [x] **T3.4 [P] — Cable trampa de CSS y deuda declarada.**
  (a) Caso que falla si `app/globals.css` estrena un `/*` dentro de una cadena.
  (b) Caso **sintético** que afirma que `quitarComentariosCss` sigue sin proteger cadenas —para
  que esa deuda no se vuelva invisible ahora que `quitarComentarios` deja de compartirla—.
  (c) El canario de equivalencia existente (línea 243) **no se edita**; solo se comprueba verde,
  y se añade a su comentario la nota de que desde la 283 ya no cubre el caso `url("//…")`
  entrecomillado, que es lo que (b) cubre ahora.
  **Hecho cuando:** (a) y (b) verdes, (c) verde sin cambios de aserción, y la CONTRAPRUEBA de la
  223 (línea 214, «el quitador de TS SÍ se la lleva») **sigue verde** — la URL de `url(//…)` va
  sin comillas, así que el escáner nuevo la sigue tratando como comentario, y si eso cambiara la
  separación de las dos pasadas dejaría de comprar nada.
  → **R24**

---

## Tanda 4 — La prosa que quedó falsa

*Depende de: T0.4 y T2. `[P]` entre sí.*

- [x] **T4.1 [P] — Actualizar el docstring de `quitarComentariosCss`.**
  Deja de citar la limitación de la 209 como vigente; dice que se cerró en la 283 y que **esta
  función no la comparte** (sigue sin proteger cadenas, a propósito, §6.3).
  **Hecho cuando:** ninguna afirmación falsa; ninguna aserción tocada.
  → **R21**

- [x] **T4.2 [P] — Actualizar la cabecera del `describe` de la 223** (líneas ~177-194) por lo
  mismo: la frase «Es la misma familia que la 209 dejó fijada arriba» ya no describe el estado.
  **Hecho cuando:** ídem.
  → **R21**

- [x] **T4.3 [P] — *(condicionada a la autorización de P4)*
  `cotizacion-orden-service.test.ts:914-916`.**
  El paréntesis explica un rodeo que ya no hace falta: desde la 283, `FUENTE_SERVICE` **sí**
  incluye el bloque de imports. Se reescribe **solo la prosa**.
  **Hecho cuando:** `git diff` de ese archivo muestra **únicamente líneas de comentario**, y sus
  tests siguen verdes sin haber cambiado una aserción. Si P4 no se autoriza: se anota como deuda
  en `progress/impl_283.md` y se marca la task N/A, con el motivo.
  → **R21**

---

## Tanda 5 — Rendimiento

*Depende de: T2, T3. No en paralelo con nada: la medida necesita la máquina quieta.*

- [x] **T5.1 — Re-medir `test:guardias`.**
  Tres corridas, mediana, mismo método y máquina que T0.2.
  **Hecho cuando:** en `progress/impl_283.md` está la tabla antes/después con las seis corridas
  y las dos medianas, y el veredicto contra el umbral de R26 (+15 % o +3 s).
  → **R25**

- [x] **T5.2 — *(condicionada: solo si T5.1 supera el umbral)* Mitigar y volver a medir.**
  En el orden de `design.md` §7: (1) memo por ruta en `codigoSinComentarios`, (2) atajo para
  fuentes sin comentarios ni comillas, (3) saltos por bloque.
  **Hecho cuando:** la nueva mediana está bajo umbral **y** T2.4 (número de líneas) y T3.2
  (monotonía) siguen verdes tras la mitigación. Si se llega a (3), se re-verifica R4 explícito.
  → **R26**

---

## Tanda 6 — Mutaciones y gate

*Depende de: todo lo anterior. **T6.1 y T6.2 estrictamente secuenciales.***

- [x] **T6.1 — Las tres mutaciones.**
  | # | mutación | rojo esperado |
  | --- | --- | --- |
  | (a) | Volver `quitarComentarios` a las dos pasadas de `replace` | los 3 casos de T1.1 + el cable trampa de T3.1 + el censo de T3.2 |
  | (b) | Quitar la regla de la comilla sin pareja (T2.2) | los dos casos de T2.2, y previsiblemente el censo de T3.2 con archivos nombrados |
  | (c) | Devolver `""` | la CONTRAPRUEBA existente (línea 120) + prácticamente todo |
  **Hecho cuando:** cada mutación tiene su salida real y su lista de tests muertos en el impl
  doc, y `git diff tests/fixtures/sin-comentarios.ts` está limpio tras revertirlas. **No se corre
  el gate mientras haya una mutación viva.**
  → **R18**

- [x] **T6.2 — Gate COMPLETO.**
  `./init.sh` (no `--rapido`), con `INIT_EXIT=$?` escrito **dentro** del log, no inferido de la
  consola. El log **no se canaliza por `tail`**: se escribe entero y se lee después.
  **Hecho cuando:** `INIT_EXIT=0`, o `INIT_EXIT != 0` **exclusivamente** por el rojo ajeno de
  `superficie-de-uso.guardia` sobre `obtenerTarifa` (ficha 275, `pending`), identificado por
  nombre en el log y **sin tocar, sin anotar y sin eximir**. Cualquier otro rojo se para y se
  reporta.
  → **R28, R29**

- [x] **T6.3 — Alcance verificado por diff.**
  **Hecho cuando:** `git diff --name-only origin/dev` devuelve **exactamente** los tres archivos
  esperados (`tests/fixtures/sin-comentarios.ts`,
  `tests/unit/guards/quitador-comentarios.guardia.test.ts`, y —si P4— el de cotización) más los
  tres del spec. Cero entradas de `app/`, `lib/`, `components/`, `hooks/`, `db/`, `scripts/`,
  `init.sh` o cualquier otra guardia. `tests/unit/auth/menu-visibility.test.ts` **sin tocar**.
  → **R27**

- [x] **T6.4 — Mapa de trazabilidad y cierre.**
  **Hecho cuando:** `progress/impl_283.md` contiene la tabla `R<n> → test` completa (abajo), sin
  ningún hueco, y el informe **está commiteado** (se ha perdido tres veces en un día por no
  hacerlo).

---

## Mapa R → test (a rellenar por el implementer con el nombre exacto del `it`)

Todos los `it` viven en `tests/unit/guards/quitador-comentarios.guardia.test.ts` salvo donde se
diga otra cosa.

| R | Qué lo verifica | Task |
| --- | --- | --- |
| R1 | los 4 casos existentes de «comentarios de BLOQUE y de JSX» (129-150 no editados) | T2.1 |
| R2 | los 4 casos existentes de «comentarios de LINEA» + el del `///` de Prisma | T2.1 |
| R3 | «el codigo que comparte linea con un comentario sobrevive» + «el bloque NO es avido» | T2.1 |
| R4 | los 2 casos de «conserva el NUMERO DE LINEAS» + el nuevo de bloque-abierto-en-cadena | T2.4 |
| R5 | «una division no es un comentario» | T2.1 |
| R6 | `pnpm run typecheck` en 0 errores + T6.3 (ningún consumidor en el diff) | T2.1, T6.3 |
| R7 | caso 1 de «283 — el defecto», las dos caras contra `quitadorViejo` | T1.1 |
| R8 | caso 2 de «283 — el defecto», las dos caras | T1.1 |
| R9 | caso 3 de «283 — el defecto», las dos caras | T1.1 |
| R10 | caso 4 de «283 — el defecto» + los 3 casos de URL existentes (45-64) | T1.1 |
| R11 | caso de comilla escapada | T2.3 |
| R12 | caso de plantilla multilínea + caso de `${}` con plantilla anidada | T2.3 |
| R13 | caso `<p>Don't panic</p>` + caso de backtick suelto · mutación **(b)** | T2.2, T6.1 |
| R14 | caso «LIMITACION QUE QUEDA: una regex con `/*` sin escapar» | T2.6 |
| R15 | censo diferencial: columna «perdidas» = 0 en todos los archivos | T3.2 |
| R16 | los 3 casos de T1.1, rojos contra el quitador de hoy antes de T2.1 (salida pegada) | T1.1, T2.1 |
| R17 | los números de T0.1 y T3.2 escritos en `progress/impl_283.md` | T0.1, T3.2 |
| R18 | las tres mutaciones con su lista de muertos | T6.1 |
| R19 | «CERRADA POR LA 283: un `//` dentro de una cadena YA NO se lleva el codigo…» · mutación **(a)** | T3.1, T6.1 |
| R20 | «`codigoSinComentarios` … ya despiojado» verde + lectura del docstring en revisión | T2.5 |
| R21 | T0.4 (censo cerrado) + `git diff` de T4.1/T4.2/T4.3 solo con líneas de comentario | T4.x |
| R22 | «`lineasSinComentarios(f)[i]` es la linea i+1 de `f`» + delegación verificada en revisión | T2.4 |
| R23 | cable trampa de SQL, verde sobre 307 archivos y rojo bajo su mutación | T3.3 |
| R24 | cable trampa de CSS (a) + caso sintético de deuda (b) + canario 243 y CONTRAPRUEBA 214 verdes | T3.4 |
| R25 | tabla antes/después de `test:guardias` con seis corridas y dos medianas | T0.2, T5.1 |
| R26 | el veredicto contra el umbral; si se supera, la nueva medida tras T5.2 | T5.1, T5.2 |
| R27 | `git diff --name-only origin/dev` == los tres archivos esperados | T6.3 |
| R28 | el log del gate nombra `superficie-de-uso`/`obtenerTarifa` y `git diff` no lo toca | T6.2, T6.3 |
| R29 | `INIT_EXIT` escrito dentro del log de `./init.sh` completo | T6.2 |

---

## Grafo de dependencias

```
T0.1 ──┬── T1.1 ── T2.1 ── T2.2 ── T2.3 ── T2.4 ── T2.5 ── T2.6 ──┬── T3.1 ──┐
T0.2 [P]                                                          ├── T3.2 [P]│
T0.3 [P]                                                          ├── T3.3 [P]├── T5.1 ─(cond)─ T5.2 ── T6.1 ── T6.2 ── T6.3 ── T6.4
T0.4 [P] ─────────────────────────────────────────────────────────┴── T3.4 [P]│
                                                    T4.1 [P] T4.2 [P] T4.3 [P]┘
```

**Puntos de parada obligatorios** (se para y se pregunta, no se decide sobre la marcha):

1. **T0.3**, si algún número de las hermanas sale distinto de 0 → se reabren P2/P3.
2. **T1.1**, si alguno de los tres casos sale **verde** contra el quitador de hoy → el caso no
   está reproduciendo el defecto y hay que rehacerlo antes de arreglar nada.
3. **T3.2**, si algún archivo pierde líneas con el barrido nuevo.
4. **T6.2**, si el gate da un rojo distinto del de `obtenerTarifa`.

---

## Marcado de las casillas — 2026-08-25

Las 24 se marcan **sobre evidencia ejecutada y arbitrada**, no a ojo.

- **El gate**, corrido por el implementer **tres veces** y por el reviewer **una** con
  `pnpm run db:generate` delante: `INIT_EXIT=1` con **1 fallo de 18.985**, y ese fallo es el
  **ajeno** (`obtenerTarifa`, ficha 275 de otra sesión). **Delta 0** contra un baseline medido en el
  árbol prístino, no supuesto.
- **La trazabilidad R1–R29** la verificó el reviewer abriendo cada test citado.
- **El censo fue arbitrado**: el reviewer lo sacó de un árbol prístino con `git archive` y confirmó
  **64 archivos / 1.387 líneas** — los números del implementer, **no los del leader**. Ver abajo.
- **La prueba de que el arreglo sirve** se reprodujo restaurando el quitador viejo **por hash de
  blob**: `3 failed | 33 passed`. Era imprescindible, porque **la suite ya estaba verde con el
  defecto dentro**.
- **Los cables trampa de `Sql` y `Css` se comprobaron rojos** mutando un `.sql` y `globals.css`. Un
  cable trampa verde no prueba que sepa cantar.
- **La negativa del gate rápido se midió de punta a punta** con el `init.sh` real: niega este
  archivo, deja pasar otros, y con el `init.sh` anterior **no negaba**.
- **Rendimiento**: mediana **−11,1 %**, y el reviewer juzgó justa la comparación porque los 15 casos
  extra **solo sesgan en contra** del cambio.

### Lo que esta ficha corrigió de sí misma, y conviene que no se pierda

**Los números que trajo el leader eran falsos.** Decía 149 archivos / 1.958 líneas y 4.599
recuperadas; lo real es **64 / 1.387** y **1.788 recuperadas en 126**. La causa está **medida**: al
script del leader le faltaba la regla de la comilla sin pareja, y reponer ese defecto hace saltar el
censo a **5.190/202** — el orden exacto de su cifra. Las **anclas** sí eran correctas.

Y el **bloqueante 1** fue un test que no discriminaba: su entrada tenía **seis** comillas invertidas
—número par—, así que emparejarlas mal consumía el mismo tramo que emparejarlas bien y la salida
era idéntica **byte a byte**. La lección quedó escrita en el propio `it`: **la entrada tiene que
estar elegida para que el mecanismo cambie el resultado, no para que se parezca al mecanismo.**

**Auditado después por mutación**: de los 15 casos, **ninguno queda sin al menos una mutación que lo
mate**. Con dos matices declarados sin que nadie los pidiera: R22 es tautológico hoy y solo
discrimina una divergencia futura, y R14 **no discrimina ningún mecanismo vivo ni debe** — es una
limitación afirmada, y su trabajo es ponerse roja el día que alguien la cierre.
