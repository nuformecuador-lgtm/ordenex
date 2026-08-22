# Feature 259 — bitácora del BLOQUE FRONTEND (T7)

> **Rama:** `feat/259-tablero-por-reparto` · **Fecha:** 2026-08-21 · **Alcance ejecutado:** T7 y
> sólo T7 (T7.1, T7.2, T7.3).
> **NO ejecutado a propósito:** T8 (aviso operativo, tarea de release) y T9 (gate completo y PR).
> **Sin commit, sin PR, sin cambio de rama.**
>
> El bloque backend vive en `progress/impl_259_backend.md` y no se ha tocado: este archivo es
> nuevo para no pisarlo.

---

## Lo que se cambió, y por qué esto no es cosmética

El backend (T0–T6) cambió el criterio: el tablero cuenta por el día **para el que** se asignó la
orden. Cuatro sitios de la pantalla seguían describiendo el criterio viejo, y uno de ellos no
sólo describía mal: **prometía** algo que ya no ocurre. Es la familia de defectos que este repo
persigue —el sistema no falla, aparenta—: ningún test se enteraba, `eslint` tampoco, y sólo se ve
abriendo la app.

---

## T7.0 — El censo, hecho contra el árbol (no contra la lista del encargo)

Se barrió `app/(app)/monitoreo/**` buscando `hoy` / `asignadas` en texto visible. **El censo
coincide exactamente con R24: cuatro SITIOS, cinco literales.** No apareció ningún sitio que el
spec no tuviera.

⚠️ **Hallazgo sobre el encargo, no sobre el spec.** El mensaje que abrió esta tanda enumeraba tres
literales y pedía censar «el cuarto». Los cuatro **sitios** de R24 contienen **cinco literales**,
porque el estado vacío son dos (`VACIO_TITULO` + `VACIO_DESCRIPCION`) y R24 los cuenta como un
sitio. Enumerándolos por literal —como hacía el encargo— faltaban **dos**, no uno: el `aria-label`
de `MensajeroCard` **y** la cabecera de `DetalleMensajeroPanel`. Los dos estaban en el spec y los
dos entraron. Se dice aquí en vez de arreglarlo callando.

Lo que se miró y **se dejó como estaba**, con su motivo:

| Literal | Dónde | Por qué NO entra |
| --- | --- | --- |
| `SIN_COINCIDENCIAS_DESCRIPCION` — «El día sí tiene órdenes asignadas: lo que no encuentra nada es el texto que escribiste.» | `TableroDiaEstados.tsx` | Habla del filtro de texto, no del día (D2). Hay un caso que lo **fija** para que nadie lo arrastre. |
| `ETIQUETA_ASIGNADAS` — «Asignadas» | `MensajeroCard.tsx` | ⛔ R25: lo que dejó de ser cierto es el «hoy» que la acompaña, no el contador. |
| `ACCION_TARJETA` — «ver el detalle de sus órdenes **de hoy**» | `MensajeroCard.tsx` | Ya decía «de hoy»: es lenguaje correcto con el criterio nuevo. |
| `AVISO_SIN_ORDENES` — «No hay órdenes que mostrar para esta selección **de hoy**.» | `DetalleMensajeroPanel.tsx` | Igual: ya era «de hoy». |
| Ayudas de cubo — «Sin gestión de hoy: …» | `contadores.ts` | Describen el cubo dentro del día, no el criterio del día. |
| «Todavía no hay entregas hoy» | `TableroDiaTotales.tsx` | Habla de entregas ocurridas hoy, que sigue siendo cierto. |

---

## T7.1 / T7.2 — Los cinco literales, ANTES y DESPUÉS

### 1. `TableroDiaEstados.tsx` · `VACIO_TITULO`

- **Antes:** `Sin órdenes asignadas hoy`
- **Después:** `Sin órdenes asignadas para hoy`

### 2. `TableroDiaEstados.tsx` · `VACIO_DESCRIPCION` — el peor de los cinco

- **Antes:** `Ningún mensajero tiene órdenes asignadas hoy dentro de tu alcance. En cuanto se
  asigne la primera, aparecerá aquí.`
- **Después:** `Ningún mensajero tiene órdenes asignadas para hoy dentro de tu alcance. El tablero
  muestra el trabajo de hoy: lo que se asigne para otro día aparecerá en el tablero de ese día.`

La segunda frase no se sustituye por otra promesa: se sustituye por **qué cuenta la pantalla** y
**dónde va a parar lo demás**. Las dos mitades importan:

- «En cuanto se asigne la primera, aparecerá aquí» es **falsa** con el criterio nuevo si esa
  primera se asigna para otro día (R23);
- decir dónde SÍ aparece es lo que evita que quien reserve trabajo por adelantado lo lea como «se
  perdieron». Es cierto por R22: el tablero se sirve por su clave de caché por fecha CR, así que
  la orden aparece en el tablero de su día sin ninguna invalidación manual.

### 3. `MensajeroCard.tsx` · `aria-label` de la tarjeta

- **Antes:** `Ana Rojas: 21 asignadas hoy — ver el detalle de sus órdenes de hoy`
- **Después:** `Ana Rojas: 21 asignadas **para** hoy — ver el detalle de sus órdenes de hoy`

Sólo cambia el «hoy». `ETIQUETA_ASIGNADAS` (`"Asignadas"`), de donde sale ese «asignadas», **no se
toca** (R25) y hay un caso que lo vigila.

### 4. `DetalleMensajeroPanel.tsx` · cabecera del modal

- **Antes:** `2 órdenes asignadas hoy` / `1 orden asignada hoy`
- **Después:** `2 órdenes asignadas para hoy` / `1 orden asignada para hoy`

Esta cifra y la de la tarjeta son **la misma** (R14): describirlas con criterios distintos haría
que la pantalla dijera dos cosas del mismo número.

### 5. `TableroDiaModule.tsx` · `DESAPARECIDO_DESCRIPCION` — el cuarto sitio

- **Antes:** `El mensajero que estabas viendo ya no tiene órdenes asignadas hoy dentro de tu
  alcance, así que su tarjeta salió del tablero.`
- **Después:** `El mensajero que estabas viendo ya no tiene órdenes asignadas para hoy dentro de tu
  alcance, así que su tarjeta salió del tablero.`

---

## T7.3 — Lenguaje claro (R25), revisado sobre las cuatro frases finales

- Ni una dice «día de reparto», ni nombra `fecha_reparto` o `asignado_at`, ni usa una sigla.
- Todas hablan como quien opera: **«para hoy»** (lo que está asignado para el día) y **«de hoy»**
  (donde ya estaba y sigue siendo correcto).
- El criterio es **uno solo en las cuatro**: se corrige el «hoy», no el sustantivo. Eso mantiene
  «Asignadas» intacto y evita inventar vocabulario nuevo en cuatro sitios por separado.
- Lo que este repaso **no** puede demostrar: que se entienda y que quepa. Eso se ve abriendo la
  app (`tasks.md`, «Lo que este spec NO puede demostrar»).

---

## Los tests: qué se añadió y qué se actualizó a conciencia

**Actualizado (no aflojado).** `tests/components/TableroDiaTarjetas.test.tsx`, caso *«R33: el vacío
se dice de forma EXPLÍCITA y no como error»*, era el único anclado a los textos viejos:

| Antes | Después |
| --- | --- |
| `getByText(/Sin órdenes asignadas hoy/i)` | `getByText(/Sin órdenes asignadas para hoy/i)` — misma exigencia, frase nueva |
| `getByText(/aparecerá aquí/i)` **presente** | `queryByText(/aparecerá aquí/i)` **null** (R23) **+** `getByText(/aparecerá en el tablero de ese día/i)` presente |

La segunda aserción **cambia de signo a propósito**: lo que antes se exigía presente ahora se
exige ausente, y en su lugar se afirma —con la misma exigencia— la frase que sí es cierta. No se
sustituyó por un `toBeTruthy` ni por una expresión más laxa.

**Nuevo:**

| Archivo | Casos | Requisitos |
| --- | --- | --- |
| `tests/components/TableroDiaEstados.test.tsx` | el vacío dice qué cuenta y la promesa vieja NO está · el vacío dice dónde aparece lo de otro día · el vacío dice «para hoy» · el aviso de «se cerró el detalle» dice «para hoy» · ⛔ el vacío del FILTRO sigue intacto · censo de jerga sobre los CUATRO archivos · autocomprobación del detector | R23, R24, R25 |
| `tests/components/TableroDiaTarjetas.test.tsx` | el `aria-label` anuncia «N asignadas para hoy» y ya no «N asignadas hoy» · ⛔ la etiqueta del contador sigue siendo «Asignadas» | R24, R25 |
| `tests/components/DetalleMensajeroPanel.test.tsx` | la cabecera en plural y en singular dice «para hoy» | R24, R25 |

Dos apuntes sobre la forma de esos tests:

- El censo de jerga de R25 se hace **por fuente** (los cuatro archivos, con los comentarios
  quitados por `tests/fixtures/sin-comentarios`) y no sobre lo renderizado, porque dos de las
  cuatro frases —el `aria-label` y la cabecera del detalle— no se pintan desde ese archivo.
- Ese censo lleva **autocomprobación** en el mismo archivo: el detector marca cuatro textos que sí
  infringen y no marca uno que no. Sin eso, la cláusula podría estar verde por no detectar nada.

---

## Verificación

```
$ pnpm run typecheck
> tsc --noEmit
(sin salida: verde)

$ pnpm run lint
✖ 99 problems (0 errors, 99 warnings)
(0 errores; los 99 avisos son preexistentes de `no-unused-vars` en tests ajenos —el mismo
número antes y después del cambio— y ninguno cae en un archivo de esta tanda)

$ pnpm exec vitest run tests/components tests/unit/tablero-dia
 Test Files  231 passed (231)
      Tests  3129 passed | 26 skipped (3155)
   Duration  203.47s
```

Las guardias de `tests/unit/tablero-dia` —incluida `frontera.guardia.test.ts`, que censa todo
`app/(app)/monitoreo`— siguen verdes **sin editarlas**: la tanda no nombra `badgeVariants`, no
declara mapas estatus→etiqueta ni estatus→color y no lee el rol.

**El gate completo (`./init.sh --rapido`, T9.1) NO se corrió aquí**, por encargo y porque no debe
correr en paralelo con un subagente que está mutando el árbol.

---

## MUTACIONES — cada texto nuevo, matado con el literal viejo

> Regla de la casa: un test que afirma un texto no vale nada hasta que se demuestra que se pone
> **rojo** cuando el texto vuelve atrás. Cada mutación se aplicó **sola** sobre el fuente, se corrió
> lo indicado, y se **revirtió** desde una copia intacta. Los cuatro archivos se compararon con
> `diff` al final: idénticos a antes de mutar.

| # | Mutación (se restaura el literal viejo) | Rojo | Test que cayó · mensaje real |
| --- | --- | --- | --- |
| **MT1** | `VACIO_TITULO` → `"Sin órdenes asignadas hoy"` | **3 tests** | `R33: el vacío se dice de forma EXPLÍCITA…` → `TestingLibraryElementError: Unable to find an element with the text: /Sin órdenes asignadas para hoy/i`; `dice qué cuenta la pantalla…` → `expected 'Sin órdenes asignadas hoyNingún mensa…' to contain 'Sin órdenes asignadas para hoy'`; `el estado vacío` → `volvió el criterio viejo: «asignadas hoy»: expected … not to match /asignadas hoy/i` |
| **MT2** | `VACIO_DESCRIPCION` → «…En cuanto se asigne la primera, aparecerá aquí.» | **4 tests** | `R33: el vacío se dice de forma EXPLÍCITA…` → `expected <p …(1)></p> to be null` (la promesa volvió); `dice qué cuenta la pantalla…` → `to contain 'Ningún mensajero tiene órdenes asigna…'`; `en vez de prometer, dice DÓNDE aparece…` → `to contain 'lo que se asigne para otro día aparec…'`; `el estado vacío` → `not to match /asignadas hoy/i` |
| **MT3** | `aria-label` de `MensajeroCard` → `… asignadas hoy — …` | **1 test** | `anuncia «N asignadas para hoy»…` → `expected 'Ana Rojas: 21 asignadas hoy — ver el …' to contain 'Ana Rojas: 21 asignadas para hoy'` |
| **MT4** | cabecera de `DetalleMensajeroPanel` → `… órdenes asignadas hoy` | **2 tests** | `en plural…` → `Unable to find an element with the text: 2 órdenes asignadas para hoy`; `en singular también…` → `Unable to find an element with the text: 1 orden asignada para hoy` |
| **MT5** | `DESAPARECIDO_DESCRIPCION` → «…asignadas hoy dentro de tu alcance…» | **1 test** | `el aviso de «se cerró el detalle» — el CUARTO sitio…` → `expected 'Se cerró el detalleEl mensajero que e…' to contain 'ya no tiene órdenes asignadas para ho…'` |

Y **dos mutaciones más**, que no restauran un texto viejo sino que prueban las dos guardas de
alcance de R25 —sin ellas, esas dos cláusulas podrían estar verdes por vacías:

| # | Mutación | Rojo | Test que cayó · mensaje real |
| --- | --- | --- | --- |
| **MT6** | `ETIQUETA_ASIGNADAS` → `"Para hoy"` (pasarse de alcance renombrando el contador) | **2 tests** | `⛔ la etiqueta del contador sigue siendo «Asignadas»`; y `anuncia «N asignadas para hoy»…` → `expected 'Ana Rojas: 21 para hoy para hoy — ver…' to contain 'Ana Rojas: 21 asignadas para hoy'` |
| **MT7** | `VACIO_TITULO` → `"Sin órdenes con día de reparto hoy"` (jerga interna en la UI) | **2 tests** | `…TableroDiaEstados.tsx no nombra la jerga interna` → `un texto de esta pantalla nombra la idea interna, una columna o una sigla: expected [ 'd[ií]a de reparto' ] to deeply equal []`; y `dice qué cuenta la pantalla…` |

**Ninguna mutación sobrevivió.** Autocomprobación de que los tests **se ejecutaron** y no se
reportaron en falso: cada corrida imprimió su recuento (`Tests 3 failed | 65 passed (68)`,
`4 failed | 64 passed`, `1 failed | 39 passed (40)`, `2 failed | 23 passed (25)`,
`1 failed | 27 passed (28)`, `2 failed | 38 passed (40)`, `2 failed | 26 passed (28)`), y la
corrida final tras restaurar volvió a **3129 passed | 26 skipped**.

---

## Archivos tocados

**Fuente (5 literales, ni una línea de lógica, ni un cambio de props, ni un cambio del DOM):**

- `app/(app)/monitoreo/_components/TableroDiaEstados.tsx`
- `app/(app)/monitoreo/_components/MensajeroCard.tsx`
- `app/(app)/monitoreo/_components/DetalleMensajeroPanel.tsx`
- `app/(app)/monitoreo/_components/TableroDiaModule.tsx`

**Tests:**

- `tests/components/TableroDiaEstados.test.tsx`
- `tests/components/TableroDiaTarjetas.test.tsx`
- `tests/components/DetalleMensajeroPanel.test.tsx`

**Bitácora y spec:**

- `progress/impl_259_frontend.md` (este archivo)
- `specs/259-tablero-dia-por-reparto/tasks.md` (casillas de T7)

## Mapa `R<n> → test` de esta tanda

| R | Test que lo cubre |
| --- | --- |
| **R23** | `TableroDiaEstados.test.tsx` → «dice qué cuenta la pantalla, y la promesa vieja NO está» + «en vez de prometer, dice DÓNDE aparece…»; `TableroDiaTarjetas.test.tsx` → «R33: el vacío se dice de forma EXPLÍCITA…» (la promesa, exigida ausente). Matados por **MT1** y **MT2**. |
| **R24** | Un caso por sitio: vacío (`TableroDiaEstados`), `aria-label` (`TableroDiaTarjetas`), cabecera del detalle (`DetalleMensajeroPanel`), aviso de detalle cerrado (`TableroDiaEstados`). Matados por **MT1/MT2**, **MT3**, **MT4** y **MT5**. |
| **R25** | El censo de jerga sobre los cuatro archivos + su autocomprobación (**MT7**), y «⛔ la etiqueta del contador sigue siendo «Asignadas»» (**MT6**). |

## Lo que esta tanda NO demuestra, dicho aquí

- **Que la pantalla se lea bien.** Se comprueba que el texto **está**, no que se entienda ni que
  quepa. El vacío pasó de 114 a 176 caracteres de descripción: eso se ve abriendo la app.
- **Que el aviso operativo (T8) llegue a alguien.** Es tarea humana con fecha y **bloquea la
  release**, no el PR. La frase nueva del vacío ayuda a que el efecto no se lea como una pérdida,
  pero **no sustituye al aviso**: quien asigne para mañana verá desaparecer sus órdenes del tablero
  de hoy sin haber pasado nunca por el estado vacío.
