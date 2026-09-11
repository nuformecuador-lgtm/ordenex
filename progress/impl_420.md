# Bitácora — Feature 420: el gate decía "dependencias presentes" sin mirar `package.json`

> Rama `fix/420-gate-dependencias-presentes`, worktree `R:/wt/wt420`, base `origin/dev` @ `5fa73fa6`.
> La ficha llegó **sin spec**: se escribió antes de tocar código, en
> `specs/420-gate-dependencias-presentes/` (requirements EARS + design + tasks).

---

## 1. El defecto, reproducido antes de tocar nada

`init.sh:38-43` preguntaba si existía el **directorio** `node_modules` y, si existía, imprimía
`✓ dependencias presentes`. El `ok` colgaba del `if` exterior, no del interior: se imprimía
**siempre** que hubiera `package.json`, y la única condición que llegaba a evaluarse es cierta en
cuanto se ha instalado **una vez**, para siempre.

**Reproducción, en este worktree, con el `init.sh` original (SHA256
`05c3282b2d01bd21aca7fb0d263976a8209119b74320d353eb812fcb0d0ae0d0`) y `node_modules/web-push`
borrado:**

```
== Arnes SDD :: init (modo: completo) ==
✓ node v24.13.0
✓ dependencias presentes          <-- VERDE, con web-push fuera del arbol
```

y el paso que sí lo notaba, dos más tarde:

```
lib/push/web-push-sender.ts(11,21): error TS2307: Cannot find module 'web-push' o...
TYPECHECK_EXIT=2
```

Idéntico al incidente medido sobre `dev` tras mergear la 410.

### Hallazgo que agranda el agujero (no estaba en la ficha)

Borrando **solo** `node_modules/web-push` y dejando `node_modules/@types/web-push`, el
**typecheck pasa en VERDE** (`TYPECHECK_EXIT=0`): TypeScript resuelve las declaraciones desde
`@types/` y nunca mira si el paquete de runtime existe. El `TS2307` de arriba **solo** aparece
cuando faltan los dos. O sea: para el caso "falta el paquete pero están sus tipos", **el gate
entero pasaba** y el fallo salía en **ejecución**. El typecheck no es la red de seguridad de esto.

---

## 2. La medición que decidió el arreglo

Windows 11, pnpm 10.10.0, 58 dependencias declaradas, árbol ya instalado:

| qué | tiempo | notas |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` idempotente, corrida 1 | **1.711 ms** | |
| idem, corrida 2 | **1.573 ms** | |
| idem, corrida 3 | **1.772 ms** | |
| idem con registro inalcanzable (`npm_config_registry=http://127.0.0.1:1/`) | **1.584 ms**, **exit 0** | **no necesita red** |
| idem con 2 paquetes ausentes (reparación real) | **1.705 ms** | |
| `node scripts/verificar-dependencias.mjs`, 3 corridas | **114 / 126 / 130 ms** | casi todo arranque de node |

También se comprobó que el `pnpm install` idempotente **NO** destruye el cliente Prisma generado
(`node_modules/.pnpm/@prisma+client@…/node_modules/.prisma/client/client.d.ts`: mismo tamaño y
mismo mtime antes y después).

**Decisión: NO se instala incondicionalmente.** El precio no era el problema —1,7 s sobre ~58 s de
gate rápido es un 3 %— y el riesgo de red tampoco existe. Se descarta por dos razones que el
número no toca:

1. **Un `install` incondicional no produce el rojo, y el rojo es el entregable.** Repararía en
   silencio y el paso saldría verde: nadie llegaría a saber que el árbol estaba mal. Se cambiaría
   un fallo mudo por otro más callado todavía — y, por el hallazgo de §1, **sin typecheck detrás
   que grite**.
2. **Un paso que MIDE no debe ESCRIBIR en lo medido.** El gate corre en el worktree de cada
   agente, sobre un árbol que otros pasos (`prisma generate`) preparan.

La comprobación elegida cuesta **~13x menos** (114-130 ms), no toca la red y no modifica nada. El
árbol **vacío** sí se instala (es un arranque, no hay nada que reportar), ahora con
`--frozen-lockfile` y con `|| fail`.

**Riesgo de red: ninguno en el camino verde** — la comprobación es `readFileSync` y nada más.
El único punto que podría necesitar red es el `pnpm install` de arranque, que solo corre cuando
**no hay** `node_modules`, y ahí hace falta de todos modos.

---

## 3. EL ROJO — el entregable, demostrado

Mismo árbol, mismo instante, `node_modules/web-push` borrado. Los dos logs llevan
`INIT_EXIT=$?` **escrito dentro del log**.

### 3.a CON el arreglo (`/r/wt/wt420_rojo_con_arreglo.log`)

```
== Arnes SDD :: init (modo: completo) ==
✓ node v24.13.0
falta 1 de las 58 dependencias declaradas en package.json:
    - web-push
  Reparalo con: pnpm install --frozen-lockfile
  (medido el 2026-09-11: ~1,7 s sobre un arbol ya instalado)
✗ faltan dependencias declaradas (el detalle esta justo arriba)
INIT_EXIT=1
```

Corta **en el paso 2**, antes de typecheck, y **cita el nombre**.

### 3.b SIN el arreglo (`/r/wt/wt420_verde_falso_sin_arreglo.log`)

Ejecutando el `init.sh` original guardado aparte, sobre **el mismo árbol roto**:

```
== Arnes SDD :: init (modo: completo) ==
✓ node v24.13.0
✓ dependencias presentes
```

Ese es el contraste: la misma situación, un verde y un rojo.

---

## 4. Mutaciones de CONTROL — diseñadas para morir, y murieron

Ninguna revertida con `git checkout --`: copia byte a byte desde `/r/wt/wt420_backup/` y SHA256
comparado después.

| # | mutación | resultado | tests que la mataron |
| --- | --- | --- | --- |
| 420-A | en el verificador: `faltantes` nunca detecta nada (`false && …`) | **MUERTA** | **6 de 13** (`R1/R2` ausente nombrada, `R2` todas las ausentes, `R1` carpeta sin manifiesto, `R1` enlace roto, `R5` árbol sin instalar, `R3` comando de reparación) |
| 420-B | en `init.sh`: quitar la llamada al verificador y volver a `ok "dependencias presentes"` | **MUERTA** | **2 de 13** (`R6` init.sh lo invoca y falla con él, `R2` el visto bueno ya no cuelga de la carpeta) |

SHA256 antes y después de cada mutación:

```
e894ce9bee8c12071759b414100abe868ab2a4e977627da8e9850bd49eb4bd06 *scripts/verificar-dependencias.mjs
01106d91aa3bd7b52477cfec022169c907d6cd989c72867b0c90f621838a9be9 *init.sh
```

(el SHA del script cambió después, al corregir la concordancia "falta 1" / "faltan 2"; el de
`init.sh` es el definitivo.)

---

## 4-bis. El superviviente que encontro la revision, y como se cerro

**El hallazgo (M2).** La primera version de la guardia afirmaba sobre el TEXTO de `init.sh`:
buscaba la linea que invoca el verificador y pedia que contuviera la palabra `fail`. Se burla sin
esfuerzo. Sustituyendo

```sh
DEPENDENCIAS=$(node scripts/verificar-dependencias.mjs)  || fail "faltan dependencias declaradas..."
```

por

```sh
DEPENDENCIAS=$(node scripts/verificar-dependencias.mjs)  || DEPENDENCIAS="no se pudo verificar (el fail se silencio)"
```

—que conserva la palabra— los **13 tests seguian en VERDE** (reproducido antes de arreglar nada) y
el gate, sobre un arbol al que le falta `web-push`, imprimia:

```
falta 1 de las 58 dependencias declaradas en package.json:
    - web-push
✓ dependencias: no se pudo verificar (el fail se silencio)      <-- VERDE, y SIGUE ADELANTE
```

La guardia que existe para que el gate deje de mentir se podia silenciar sin que nada se pusiera
rojo. La misma ironia que la ficha vino a cerrar, un piso mas abajo.

**Que se hizo: se defendio LA PROPIEDAD, no se atornillo la mutacion.** El arreglo propuesto era
anclar la asercion a la forma exacta de la invocacion; eso habria matado *esa* linea y dejado viva
la siguiente. En su lugar, `init.sh` lleva ahora marcadores `>>> INICIO/FIN PASO 2 <<<`, y la
guardia **recorta el paso 2 real y lo EJECUTA con bash** contra un arbol de mentira al que le falta
un paquete, exigiendo (a) codigo de salida no-cero, (b) que se nombre el paquete y (c) que **no**
se imprima el visto bueno. Se ejecuta el prefijo entero del archivo, asi que corren el
`set -euo pipefail` y las funciones `fail`/`ok`/`warn` **reales**: no es una copia de la cosa.

**Medido: 7 variantes aplicadas una a una, cada una revertida por copia con SHA256 comparado.**

| variante | ¿muere? | lectura |
| --- | --- | --- |
| **M2** — `\|\| DEPENDENCIAS="…(el fail se silencio)"` (la del reviewer) | **MUERE** | el hallazgo, cerrado |
| **V2** — `\|\| true` | **MUERE** | |
| **V3** — `fail` degradado a `warn` | **MUERE** | |
| **V4** — `if ! node …; then echo "aviso"; fi` (sin `\|\|`, sin `fail`) | **MUERE** (2 tests) | otra ESTRUCTURA, no otra redaccion |
| **V5** — la llamada partida en dos lineas con `\` y silenciada | **MUERE** | |
| **V1** — espacios y tabuladores distintos, codigo **correcto** | **sobrevive** | **correcto**: no es una mutacion de comportamiento |
| **V6** — sin `\|\|` ninguno, confiando en `set -e` | **sobrevive** | **superviviente legitimo, ver abajo** |

**V6 es un limite declarado, no un agujero.** `DEPENDENCIAS=$(…)` a secas, bajo `set -e`, **sigue
cortando**: la asignacion hereda el codigo de la sustitucion, `set -e` dispara y el `ok` no llega a
imprimirse. La guardia lo midio -no lo dedujo- y por eso lo deja pasar: el comportamiento que
protege se mantiene. Lo que se pierde con V6 es el **mensaje** `✗ faltan dependencias declaradas`,
no el corte. Esta guardia defiende «el paso corta y no da el visto bueno», **no** «el mensaje de
`fail` es exactamente ese»; pedir lo segundo volveria a ser una asercion sobre texto, que es de
donde venimos.

**Otro limite declarado:** el bloque se ejecuta **en aislamiento**. No se prueba que el `exit 1` de
`fail` detenga al `init.sh` completo (de eso responden `set -e` y el propio `exit`), ni se cubren
los demas pasos del gate. Y si alguien borra los marcadores, la guardia **lanza y se pone roja** en
vez de quedarse sin nada que medir.

**Fuera de alcance por decision del coordinador:** `peerDependencies` y la comprobacion de
versiones siguen sin cubrirse (ya estaban declarados como limite en `design.md`). Si se corrigio la
errata de «90 paquetes» -> **58**, en dos sitios de `design.md`.

---

## 5. Archivos

**Creados**
- `specs/420-gate-dependencias-presentes/requirements.md` — R1…R7 en EARS.
- `specs/420-gate-dependencias-presentes/design.md` — con la medición y las 3 alternativas descartadas.
- `specs/420-gate-dependencias-presentes/tasks.md`
- `scripts/verificar-dependencias.mjs` — la medición. Solo `node:fs` y `node:path`.
- `tests/unit/guards/dependencias-declaradas-presentes.guardia.test.ts` — 13 casos.
- `progress/impl_420.md` — esto.

**Modificados**
- `init.sh` — paso 2 reescrito.
- `docs/verification.md` — sección nueva con el incidente, la medición y el límite.

**NO tocados, a propósito:** `feature_list.json` (lo lleva el leader) y
`tests/integration/db/*-migration.test.ts` (ficha 421, en paralelo).

---

## 6. Mapa `R<n>` → test

Todos en `tests/unit/guards/dependencias-declaradas-presentes.guardia.test.ts`.

| R | requisito | test |
| --- | --- | --- |
| R1 | comprueba paquete por paquete, no la carpeta | `R1/R2 — una dependencia declarada que NO esta en el arbol pone el paso en ROJO y la nombra` · `R1 — una carpeta sin manifiesto NO cuenta como paquete instalado` · `R1 — un enlace simbolico ROTO (la forma real de pnpm) tampoco cuenta` · `R1 — el arbol REAL de este repo tiene todas sus dependencias declaradas` |
| R2 | rojo, corta el gate y nombra cada ausente | `R1/R2 — …la nombra` · `R2 — nombra TODAS las ausentes, de dependencies y de devDependencies, incluidas las de scope` · `R2 — el visto bueno de dependencias ya no cuelga solo de que exista la carpeta` · §3.a |
| R3 | el rojo trae el comando de reparación | `R3 — el rojo trae el comando de reparacion ya escrito` |
| R4 | verde sin instalar/sin red/sin mutar, y dice la cifra | `R4 — con todas las dependencias declaradas presentes pasa, y dice CUANTAS comprobo` (+ R7, que prueban que no puede instalar: no lanza procesos) |
| R5 | árbol vacío → instala con `--frozen-lockfile`, y rojo si falla | `R5 — un arbol sin node_modules se reporta como arbol sin instalar, no como 58 ausencias` · `R5/R6 — la instalacion de arranque usa el lockfile y corta el gate si falla` |
| R6 | `init.sh` lo INVOCA y falla con él | `R6 — init.sh invoca scripts/verificar-dependencias.mjs y FALLA con el` · `R5/R6 — la instalacion de arranque…` |
| R7 | solo `node:*`, sin procesos ni red | `R7 — solo importa modulos node:, nunca un paquete de node_modules` · `R7 — no lanza procesos ni toca la red` |

---

## 7. Verificación

### `pnpm run typecheck`

```
> ordenex@0.1.0 typecheck R:\wt\wt420
> tsc --noEmit

TYPECHECK_EXIT=0
```

### `pnpm run lint`

```
✖ 184 problems (0 errors, 184 warnings)
LINT_EXIT=0
```

(184 warnings preexistentes en `dev`, ninguna en archivos de esta ficha.)

### `./init.sh` completo — DOS corridas

`init.sh` está en `RUTAS_SENSIBLES`, así que el modo rápido **se niega solo** ante este diff: el
gate de esta ficha es el completo, sin atajo. **Tres** corridas, todas con `INIT_EXIT=$?` **escrito
dentro del log**. La que vale es la tercera: es la única posterior al arreglo del superviviente
(§4-bis) y al merge de `origin/dev` @ `9dca942a` (la 421, 31 archivos, cero solape).

| | corrida 1 (`/r/wt/wt420_gate_completo.log`) | corrida 2 (`/r/wt/wt420_gate_completo_2.log`) |
| --- | --- | --- |
| paso 2 | `✓ dependencias: 58 declaradas, todas presentes` | idem |
| typecheck / lint | pasan | pasan |
| Test Files | 1 failed, 1812 passed, 129 skipped (1942) | 1 failed, 1812 passed, 129 skipped (1942) |
| Tests | 1 failed, 26715 passed, 1487 skipped (28203) | idem |
| archivo rojo | `tests/integration/recuperar-contrasena-form.test.tsx` | `tests/components/descarga/CierresDescargaColumnas.test.tsx` |
| `INIT_EXIT` | 1 | 1 |
| duración | 828 s | 1406 s (máquina más cargada) |

### Corrida 3 — la definitiva, VERDE (`/r/wt/wt420_gate_completo_3.log`)

Tras cerrar el superviviente y mergear `origin/dev` @ `9dca942a`:

```
== Arnes SDD :: init (modo: completo) ==
✓ node v24.13.0
✓ dependencias: 58 declaradas, todas presentes
✓ feature_list.json: sin ids duplicados (416 fichas), cupo por zona respetado (in_progress=0) y specs en su sitio
...
 Test Files  1814 passed | 130 skipped (1944)
      Tests  26725 passed | 1493 skipped (28218)
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1944 ejecutado(s), todos en el baseline conocido)
== init OK ==
INIT_EXIT=0
```

**Cero rojos, ni propios ni flakes.** El paso 3 ya no bloquea: el coordinador arregló en `dev` las
fichas `in_progress` sin spec, así que **no se necesitó ningún marcador local** en esta corrida.
Las suites de migración de la 421 (`notificacion-evento-*`) pasan.

### Corridas 1 y 2 — anteriores al arreglo del superviviente

**Los dos rojos son flakes de saturación, no míos, y NO se han baselineado.** Es lo que
`docs/verification.md` describe («2-5 flakes que cambian de sitio entre corridas») y lo que el
propio comparador aconseja: *corre ese archivo AISLADO*. Medido, 3 veces cada uno:

```
tests/integration/recuperar-contrasena-form.test.tsx         -> 11/11 passed  (x3)
tests/components/descarga/CierresDescargaColumnas.test.tsx   -> 10/10 passed  (x3)
```

El segundo es literalmente `Error: Test timed out in 20000ms`. **Cada corrida tumbó un archivo
DISTINTO**, ninguno relacionado con este diff: aquí se toca `init.sh`, un `.mjs` que nadie importa,
un test nuevo, `docs/` y `specs/`. Ni un formulario de contraseña ni un selector de columnas de
cierres importa nada de eso. Añadirlos a `tests/baseline-rojos.json` sería justo lo que ese archivo
prohíbe («nunca solo para pasar el gate»).

### La guardia nueva, aislada

```
 Test Files  1 passed (1)
      Tests  13 passed (13)
```

### ⚠️ HUECO DECLARADO: este verde NO cubre la capa de datos

```
! sin DATABASE_URL: 171 archivos de tests contra Postgres NO se van a ejecutar.
! recuerda: este verde NO incluye los 171 archivos de tests contra Postgres (sin DATABASE_URL se saltaron).
```

De los **130 archivos saltados en la corrida 3, los 130 son de `tests/integration/`** (cero fuera
de ahí). Los otros tests saltados son los de siempre (17 `AnaliticaPage` + 9 `AnaliticaShell`). No se pudo conseguir una
`DATABASE_URL`: el worktree no hereda el `.env` (vive solo en el árbol principal) y **leerlo está
bloqueado por el clasificador de permisos de esta sesión**. No se copió ni se enlazó el `.env`, que
es la política del repo.

**CERRADO POR LA REVISION (2026-09-11).** El reviewer copió el `.env` al worktree —y lo borró al
terminar— y corrió el gate completo **con base de datos**:

```
✓ DATABASE_URL resuelta: los 170 archivos de tests contra Postgres SI se ejecutan
 Test Files  1942 passed (1942)
      Tests  28177 passed | 26 skipped (28203)
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1942 ejecutado(s), todos en el baseline conocido)
== init OK ==
INIT_EXIT=0
```

**26 saltados** —los 17 de `AnaliticaPage` + 9 de `AnaliticaShell` de siempre— y **cero de
`integration/db`**. Ese verde sí cubre la capa de datos. Mi corrida 3 (posterior, ya con el
superviviente cerrado) sigue sin base, así que lo de abajo se mantiene como está escrito para esa
corrida en concreto.

Se dice, no se tapa. Lo que este hueco significa para ESTA ficha en concreto: el diff no toca ni
una línea de la capa de datos —`init.sh`, `scripts/verificar-dependencias.mjs`, un test de guardia,
`docs/` y `specs/`—, así que ninguna de las 129 suites saltadas puede alcanzarlo por imports ni por
SQL. Pero eso es un razonamiento, no una medición: si el leader quiere el gate con base, hay que
correrlo desde el árbol principal o exportando `DATABASE_URL` en la sesión.

### Nota sobre la ficha 421 (ya resuelta)

`scripts/validar-feature-list.mjs` exige carpeta de specs a toda ficha `in_progress`, y la **421**
—que no es mía y se está escribiendo a la vez— todavía no la tiene en `origin/dev`. Eso deja el
**paso 3** del gate en rojo para cualquiera:

```
  - falta la carpeta de specs de la ficha 421 (...)
✗ feature_list.json invalido (el detalle esta justo arriba)
```

Para poder correr las corridas 1 y 2 se usó un marcador **local y temporal**
(`specs/421-TEMPORAL-NO-COMMITEAR/`), **borrado antes de commitear** y verificado con
`git status`. No se tocó `feature_list.json` ni se escribió nada en el spec real de la 421.

**Ya no hace falta:** el coordinador corrigió las fichas `in_progress` sin spec en `dev`, y la 421
se mergeó. La corrida 3 pasa el paso 3 sin marcador de ningún tipo.

---

## 8. Veredicto

**Hecho y demostrado con el rojo:** quitar una dependencia del árbol ahora corta el gate **en el
paso de dependencias**, citando el paquete por su nombre, en vez de pasar en verde y reventar dos
pasos más tarde (o, peor y también medido, no reventar en absoluto). El superviviente que encontró
la revisión está cerrado **defendiendo la propiedad, no atornillando la mutación**: el paso 2 se
EJECUTA, y con él mueren M2 y cuatro variantes más —incluida una de estructura distinta—; los dos
supervivientes que quedan son legítimos y están declarados. Gate completo **VERDE, `INIT_EXIT=0`,
cero rojos**. El hueco de `DATABASE_URL` (130 archivos de `tests/integration/`) queda declarado, no
tapado.
