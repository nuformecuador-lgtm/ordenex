# R34 — RETIRADO de la feature 125 · cuerpo para la ficha **174**

> **Qué es este archivo.** El requisito **R34** salió de la feature 125 por decisión humana del
> **2026-08-02**, tras el rechazo del reviewer. Aquí queda todo lo necesario para especificar la
> ficha nueva —la **174**— sin volver a investigar nada. Este documento **no es una spec**: no tiene
> requisitos EARS ni tasks. Es el expediente de traspaso.
>
> **Alcance de la verificación.** Todos los hechos de inventario de este archivo están comprobados
> leyendo los archivos del worktree **`C:/w125`**. Cada uno va con ruta y línea. Nada citado de
> memoria, de otra sesión ni de un scratchpad.
>
> **Dónde queda esto en la 125:** `requirements.md > R34` (entrada retirada), `requirements.md > L7`
> (limitación declarada), `requirements.md > Contradicciones #8`, `design.md §4` (los tres anclajes)
> y `design.md > A8` (alternativa descartada), `tasks.md > T6` (retirado).

---

## 1. El problema

`lib/config/analitica-rollup.ts` declara `UMBRAL_AVISO_FILAS_CORRIDA = 20000`: el aviso de volumen
del rollup diario de analítica. Su propio comentario dice, sin eufemismos, que la cifra es
**provisional y no medida**, y anuncia que «la feature 125 fijará los umbrales de verdad»
(líneas 1-15 del archivo).

Eso no ocurrió. La 125 cierra dejando la cifra tal cual. **R34 pedía sustituirla por una cifra con
procedencia documentada y hacer que el comentario dejara de decir «no medida».** La ficha 174 hereda
ese encargo entero.

Texto original del requisito retirado:

> **R34.** CUANDO exista la medición de la corrida real (R35), el sistema DEBE sustituir
> `UMBRAL_AVISO_FILAS_CORRIDA` por una cifra **con procedencia documentada**, manteniéndola en **una
> sola constante**, y DEBE dejar en verde el allowlist `AJENAS_A_R47` del guardia de cifra única, que
> hoy exime dos ocurrencias de `20_000` usadas como timeout en
> `lib/clients/google-route-optimization.ts` y `lib/config/route-optimization.ts` y que **caduca en
> cuanto el valor cambie**.

**Nota importante sobre el riesgo real.** La cifra es un **aviso**, no un límite: el propio guardia
exige que el comentario diga que «nada se rechaza ni se trunca por superarla»
(`tests/unit/analytics/rollup-guards.test.ts:737`). Dejarla provisional **no produce comportamiento
incorrecto**; produce un log poco informativo. La 174 es deuda de observabilidad, no un bug abierto.
Conviene que la ficha lo diga, para que nadie le asigne una urgencia que no tiene.

---

## 2. Los TRES anclajes de la cifra (verificados)

La spec de la 125 contaba **dos** puntos de edición. Son **tres archivos** y **cuatro puntos**. Este
es el hallazgo que encarece la ficha nueva.

### Anclaje 1 — la declaración (código de producción)

**`lib/config/analitica-rollup.ts`**

- **Línea 16:** `export const UMBRAL_AVISO_FILAS_CORRIDA = 20000;`
- **Líneas 1-15:** el comentario de cabecera. Contiene, literalmente:
  - línea 8: `⚠️ PROVISIONAL Y NO MEDIDA. La cifra de abajo es un aviso, no un limite: nada se rechaza`
  - línea 9: `ni se trunca por superarla.`
  - línea 6: `real la feature 125 fijara los umbrales de verdad.` ← **este texto queda obsoleto**: la
    174 tendrá que reescribirlo aunque no cambiara el número.
  - líneas 14-15: recuerdan que la constante vive **solo** ahí (R47 de la 124).

En el mismo archivo conviven `FALLOS_CONSECUTIVOS_QUE_ABORTAN = 3` (línea 32, aportada por la 125) y
`TIMEOUT_TX_ROLLUP_MS = 120_000` (línea 40). La 174 **no debe tocar** ninguna de las dos.

### Anclaje 2 — el guardia de cifra única (test ajeno, de la 124)

**`tests/unit/analytics/rollup-guards.test.ts`** — dos puntos distintos, con naturalezas distintas:

- **Líneas 681-684 — el allowlist `AJENAS_A_R47`.** Dos entradas de **una** ocurrencia cada una:
  `lib/clients/google-route-optimization.ts` y `lib/config/route-optimization.ts`. El guardia solo
  las admite si **todas** sus ocurrencias caen en una línea que case `/timeout/i` (líneas 761-771), y
  su propio comentario (líneas 672-680) avisa de que el allowlist **caduca si el umbral cambia de
  valor**. Al cambiar la cifra, esas dos entradas quedan **muertas** y el guardia se pone rojo.
  → Esto es un **allowlist**, y R33 de la 125 lo autorizaba.
- **Líneas 710-738 — la aserción del caso «(a) el comentario declara que la cifra es PROVISIONAL y NO
  MEDIDA (D9)».** Aplana la prosa anterior a la declaración y exige **dos** coincidencias:
  `/provisional/i` (línea 729) y `/\bno\s+(?:est[aá]\s+|esta\s+)?medid[ao]\b/i` (línea 734); y además
  `/aviso|no es un l[ií]mite|nada se rechaza/i` (línea 737).
  → Esto es una **aserción**, no un allowlist. **R33 NO lo autorizaba.** Aquí está el choque.

Ojo al alcance de la segunda: la tercera coincidencia (línea 737, «aviso / no es un límite / nada se
rechaza») **debe seguir cumpliéndose** aunque la cifra pase a estar medida — sigue siendo un aviso.
Solo la exigencia de «NO MEDIDA» es la que hay que retirar.

### Anclaje 3 — el test de servicio de la 124 (el que nadie había documentado)

**`tests/unit/analytics/rollup-service.test.ts`** — también dos puntos:

- **Línea 1047:**
  `const literal = new RegExp(\`\\b${UMBRAL_AVISO_FILAS_CORRIDA}\\b|\\b20_000\\b\`);`
  El `20_000` está **tecleado a mano** junto a la interpolación de la constante. Consecuencia: si la
  constante cambia a otro valor, la regex **sigue buscando el 20 000 viejo** por todo `lib/`, con dos
  efectos posibles —falsos positivos sobre módulos ajenos que usen 20 000 como timeout, y una
  cobertura que ya no vigila la cifra vigente—. El caso vive en el `describe` «R47 — la cifra de
  volumen vive en UN solo archivo» (línea 1042) y recorre `lib` filtrando por
  `/analitica-rollup|AnaliticaRollup|rollup-dia/i` (línea 1058).
- **Línea 1072:** `expect(config).toMatch(/PROVISIONAL Y NO MEDIDA/i);`, dentro del caso «la constante
  esta declarada como provisional y no medida» (líneas 1070-1073). Es **una segunda aserción de prosa
  ajena**, independiente de la del anclaje 2 y en otro archivo.

### Resumen de ediciones que necesitará la 174

| # | Archivo | Punto | Tipo | ¿R33 de la 125 lo autorizaba? |
|---|---|---|---|---|
| 1 | `lib/config/analitica-rollup.ts` | línea 16 + comentario líneas 1-15 | producción (config) | Sí |
| 2 | `tests/unit/analytics/rollup-guards.test.ts` | líneas 681-684 (`AJENAS_A_R47`) | allowlist ajeno | Sí |
| 3 | `tests/unit/analytics/rollup-guards.test.ts` | líneas 710-738 (caso (a)) | **aserción ajena** | **No** |
| 4 | `tests/unit/analytics/rollup-service.test.ts` | líneas 1047 y 1072 | **aserción ajena** | **No** |

### Lo que NO es un anclaje

`tests/unit/analytics/backfill-guards.test.ts:359` —guardia **propio** de la 125— comprueba solo que
la **declaración exista** (`expect(config).toMatch(/export\s+const\s+UMBRAL_AVISO_FILAS_CORRIDA\b/)`),
no su valor ni su prosa. **No se opone** a que la 174 cambie la cifra y no hay que tocarlo.

---

## 3. Por qué no se puede medir en local

La 125 hizo la corrida real exigida por su R35 y la dejó documentada en `progress/backfill_125.md`.
Lo que salió:

- Rango medido: **2026-07-10 … 2026-08-01**, 23 fechas; 20 comparables y 3 bajo el horizonte del
  historial (T7.4, líneas 104-116). Resultado: 278 filas escritas, 0 retiradas, 689 ms, código 0.
- **El universo entero de la base local eran 58 órdenes**, con un **pico de 24 filas en una sola
  fecha** (T7.5, líneas 120-123).

De 24 filas/fecha no sale un umbral de producción. Para llegar a uno haría falta un **multiplicador**
—cuántas veces más grande es producción que la base local— y ese multiplicador **nadie lo ha medido**;
ponerlo a ojo es exactamente lo que **D5 de la 125** («medir primero, fijar el tope después») prohíbe.
El propio `progress/backfill_125.md` lo dice en la línea 122: «seria inventar una cifra con un
multiplicador imaginario, que es justo lo que D5 prohibe».

**Consecuencia para la 174: la ficha nueva empieza por conseguir el dato, no por editar la
constante.** Mientras no exista una medición de volumen real —producción, o un entorno con volumen
representativo— la 174 **no puede cerrarse**, exactamente por el mismo motivo por el que R34 no pudo
cerrarse en la 125. Esto hay que escribirlo en la ficha como precondición explícita; si no, la 174
reproduce el bloqueo de la 125 en vez de resolverlo. Fuentes de dato posibles, ninguna verificada
todavía por quien escribe esto:

- La propia 125 deja la herramienta: `scripts/backfill-analitica.ts` con `--verificar` y su reporte
  JSON por fecha (`filasEscritas`, `filasRetiradas`, `ms`), y un runbook para correrla contra
  producción (`progress/backfill_125.md`, T7.6, desde la línea 131). Una corrida real contra
  producción **sí** produciría el dato.
- El job diario de la 124 registra `filasEscritas` y `ms` por corrida. Acumular unas semanas de esas
  corridas da una distribución, no un solo pico.

Cuál de las dos vías se usa, y con qué criterio se convierte una distribución en un umbral (¿el
máximo observado?, ¿un percentil?, ¿el máximo por un factor declarado?), **es la primera pregunta
abierta de la 174** y no se decide aquí.

---

## 4. Autorización explícita que necesitará la ficha 174

Esto es lo que distingue a la 174 de una tarea trivial de «cambiar un número», y **tiene que estar
escrito en su spec como decisión de puerta, no darse por supuesto**:

1. **Autorización para editar ASERCIONES de guardias ajenos**, no solo allowlists. Concretamente, los
   puntos 3 y 4 de la tabla del §2: la aserción de prosa en `rollup-guards.test.ts` (líneas 710-738)
   y las dos de `rollup-service.test.ts` (líneas 1047 y 1072). Ambos archivos son **de la feature
   124**. Un permiso equivalente a R33 de la 125 —que solo cubría config + allowlist— **es
   insuficiente** y fue justamente lo que bloqueó la 125.
2. **Delimitación del permiso.** La autorización debería ser nominal —«estas cuatro líneas, en estos
   dos archivos, y ninguna otra»— y no genérica («los tests de la 124»). El resto de
   `rollup-guards.test.ts` y de `rollup-service.test.ts` vigila la semántica del agregador y **no se
   toca**.
3. **Obligación de no debilitar el guardia.** Sustituir «no medida» por «medida el <fecha> sobre
   <base>» debe seguir dejando una aserción **igual de fuerte**: que la prosa cite la procedencia. Si
   la 174 se limita a **borrar** la comprobación, habrá cambiado una garantía por nada, y eso hay que
   prohibirlo explícitamente en la ficha.
4. **Corregir el literal a mano de la línea 1047.** No basta con cambiar el valor: mientras el
   `20_000` siga tecleado ahí, el anclaje volverá a caducar en el próximo cambio. La 174 debería
   dejar ese test dependiendo **solo** de la constante importada.
5. **Actualizar la promesa obsoleta.** El comentario de `lib/config/analitica-rollup.ts:6` dice que
   «la feature 125 fijara los umbrales de verdad». Es falso desde el 2026-08-02.

---

## 5. Alternativas descartadas

**AR-1 — Cumplir R34 dentro de la 125, ensanchando R33.** *Descartada.* Es la alternativa A8 de
`design.md` de la 125. Dos razones independientes: (a) R33 existe para que la 125 no pueda reescribir
los tests que la vigilan, y convertirlo en licencia para editar aserciones ajenas destruye la garantía
entera —además, las aserciones a tocar son dos, en dos archivos, no un retoque puntual—; (b) aunque
se concediera el permiso, **no hay dato**: se habría abierto el guardia para escribir un número tan
infundado como el actual, pero **sin** el comentario que hoy avisa de que no está medido. Peor que no
hacer nada.

**AR-2 — Retirar R33 y quedarse con R34.** *Descartada.* R33 es el requisito que **se cumplió y se
verificó** en la implementación de la 125; R34 es el que quedó sin ejecutar. Retirar el cumplido para
salvar el incumplido invierte la realidad del entregable y obliga a rehacer la trazabilidad `R→test`
del implementer y del reviewer.

**AR-3 — Renumerar los requisitos de la 125 para cerrar el hueco de R34.** *Descartada.* La
trazabilidad `R<n>` → test ya está escrita y verificada con los números actuales (`progress/impl_125.md`
y el informe del reviewer). Renumerar invalida ambos documentos y obliga a reauditar 34 mapeos para
ahorrar un hueco cosmético. **R34 queda como número muerto en la 125 y no se reasigna jamás.**

**AR-4 — Poner una cifra «razonable» ahora y medir después.** *Descartada por D5* de la 125, y la
ficha 174 debería heredar la prohibición. Un número inventado que **ya no lleva** la etiqueta «no
medida» es peor que el actual: hoy el comentario avisa de su propia debilidad; mañana se leería como
si alguien lo hubiera medido. La etiqueta es la parte valiosa del arreglo, no el número.

**AR-5 — Borrar `UMBRAL_AVISO_FILAS_CORRIDA` y el aviso de volumen entero.** *No descartada: es una
opción viva que la 174 debe evaluar en su puerta.* Si tras conseguir el dato resulta que el aviso no
aporta nada operativo —nadie lee ese log, o el volumen real nunca se acerca a ningún umbral útil—,
retirar la constante y sus tres anclajes es una salida legítima y **más barata** que mantener una
cifra que nadie usa. Quien escriba la 174 debe plantearla como alternativa explícita antes de asumir
que el encargo es «poner un número mejor».

---

## 6. Estado en el que la 125 deja el terreno

- `lib/config/analitica-rollup.ts` — **sin cambios en `UMBRAL_AVISO_FILAS_CORRIDA`**; sigue en
  `20000`, provisional y no medida. La 125 **solo sumó** `FALLOS_CONSECUTIVOS_QUE_ABORTAN`.
- `tests/unit/analytics/rollup-guards.test.ts` y `tests/unit/analytics/rollup-service.test.ts` —
  **intactos**, ni una aserción ni una entrada de allowlist tocadas. Verdes.
- La 125 cierra con **34/34** requisitos vigentes. R34 no cuenta como cubierto ni como incumplido:
  cuenta como **retirado**.
- Dato disponible para la 174: `progress/backfill_125.md` (corrida real, tabla por fecha) y
  `progress/backfill_125_reporte.json` (verificado: ambos existen en el árbol de `C:/w125`).
