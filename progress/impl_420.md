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
gate de esta ficha es el completo, sin atajo. Las dos corridas con `INIT_EXIT=$?` **escrito dentro
del log**.

| | corrida 1 (`/r/wt/wt420_gate_completo.log`) | corrida 2 (`/r/wt/wt420_gate_completo_2.log`) |
| --- | --- | --- |
| paso 2 | `✓ dependencias: 58 declaradas, todas presentes` | idem |
| typecheck / lint | pasan | pasan |
| Test Files | 1 failed, 1812 passed, 129 skipped (1942) | 1 failed, 1812 passed, 129 skipped (1942) |
| Tests | 1 failed, 26715 passed, 1487 skipped (28203) | idem |
| archivo rojo | `tests/integration/recuperar-contrasena-form.test.tsx` | `tests/components/descarga/CierresDescargaColumnas.test.tsx` |
| `INIT_EXIT` | 1 | 1 |
| duración | 828 s | 1406 s (máquina más cargada) |

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
! sin DATABASE_URL: 170 archivos de tests contra Postgres NO se van a ejecutar.
```

De los **129 archivos saltados, los 129 son de `tests/integration/`**. Los otros 26 tests saltados
son los de siempre (17 `AnaliticaPage` + 9 `AnaliticaShell`). No se pudo conseguir una
`DATABASE_URL`: el worktree no hereda el `.env` (vive solo en el árbol principal) y **leerlo está
bloqueado por el clasificador de permisos de esta sesión**. No se copió ni se enlazó el `.env`, que
es la política del repo.

Se dice, no se tapa. Lo que este hueco significa para ESTA ficha en concreto: el diff no toca ni
una línea de la capa de datos —`init.sh`, `scripts/verificar-dependencias.mjs`, un test de guardia,
`docs/` y `specs/`—, así que ninguna de las 129 suites saltadas puede alcanzarlo por imports ni por
SQL. Pero eso es un razonamiento, no una medición: si el leader quiere el gate con base, hay que
correrlo desde el árbol principal o exportando `DATABASE_URL` en la sesión.

### Nota sobre la ficha 421 (en paralelo)

`scripts/validar-feature-list.mjs` exige carpeta de specs a toda ficha `in_progress`, y la **421**
—que no es mía y se está escribiendo a la vez— todavía no la tiene en `origin/dev`. Eso deja el
**paso 3** del gate en rojo para cualquiera:

```
  - falta la carpeta de specs de la ficha 421 (...)
✗ feature_list.json invalido (el detalle esta justo arriba)
```

Para poder correr el gate completo se creó un marcador **local y temporal**
(`specs/421-TEMPORAL-NO-COMMITEAR/`), **borrado antes de commitear** y verificado con
`git status`. No se tocó `feature_list.json` ni se escribió nada en el spec real de la 421.

---

## 8. Veredicto

**Hecho y demostrado con el rojo:** quitar una dependencia del árbol ahora corta el gate **en el
paso de dependencias**, citando el paquete por su nombre, en vez de pasar en verde y reventar dos
pasos más tarde (o, peor y también medido, no reventar en absoluto). Las dos mutaciones de control
murieron; los únicos rojos del gate completo son flakes de saturación que pasan 3/3 aislados y no
se han baselineado; el hueco de `DATABASE_URL` queda declarado, no tapado.
