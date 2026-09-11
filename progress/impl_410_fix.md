# impl 410 (fix de revisión) — los dos bloqueantes de `progress/review_410.md`

- **Encargo:** `progress/review_410.md`, secciones `# BLOQUEANTES` y
  `## Qué hace falta para que esto pase a OK`. Veredicto de la revisión: **RECHAZADO**, 2
  bloqueantes de requisito (R7, R51) + 1 de checkpoint (`tasks.md`).
- **Rama:** `feat/410-notificaciones-push-frontend`, sobre `ebb1d946`. Worktree propio con su
  `.env` y sus `node_modules`.
- **⚠️ CERO LÍNEAS DE PRODUCCIÓN.** Lo dice la revisión y lo confirmo: «el canal, tal y como está
  escrito, es correcto». Lo que faltaban eran los tests que lo defiendan. `git status` de `lib/`,
  `app/` y `db/` al terminar: **limpio**.
- Los **7 menores** del informe quedan fuera a propósito, incluido el voseo de `public/sw.js` (m3),
  que el propio reviewer juzgó que se arregle en el primer trabajo que toque ese archivo.

## 1 · Archivos tocados

| Archivo | Qué |
| --- | --- |
| `tests/integration/db/push-cupo-carrera.test.ts` | **+1 caso** (B1) y sus dos ayudantes: la barrera y el envoltorio del cliente |
| `tests/unit/guards/push-cableado-unico.guardia.test.ts` | **+12 casos** (B2): el censo con lista blanca sobre `lib/` y `app/` |
| `specs/410-notificaciones-push/tasks.md` | B3: T6.4 y T6.6 marcadas; T6.5 **sin marcar**, con el motivo en su línea |
| `progress/history.md` | B3/T6.6: la entrada del 2026-09-11 |
| `progress/impl_410_fix.md` | esta bitácora |

**Ningún archivo de `lib/`, `app/`, `db/` ni `components/`.**

## 2 · B1 · R7 — el test que defiende la exclusión estructural

### Qué faltaba, y por qué los tests de antes no bastaban

El código de producción **ya era correcto**: `tomarCupoDelDia` inserta y traduce `P2002` a `false`,
sin `SELECT` previo. Lo que no existía era el test que se pusiera rojo si eso dejaba de ser así.

- El caso principal (`Promise.all` de dos emisiones) afirma «exactamente un cupo, exactamente un
  encolado». Eso **se cumple también si las dos llamadas se serializan solas**, y en esta máquina se
  serializan **siempre** (el reviewer lo midió 5 de 5). Nunca llegaba a medir la ventana.
- El caso de la barrera **no ejecutaba el código de producción**: reproducía el `SELECT` y el
  `INSERT` a pelo, con SQL escrito dentro del test. Demuestra una propiedad **del motor y del
  índice** —cierta y útil, **no la borré**— pero es indiferente a lo que haga `tomarCupoDelDia`.

### Lo que escribí

Un caso nuevo que **interpone la barrera dentro del camino real**:
`⭑⭑ R7: con las DOS conexiones retenidas en `create`, sale UN cupo y UN encolado`.

`PushSuscripcionRepository` recibe un `Pick<PrismaClient, "pushSuscripcion" | "pushEnvioDia">`, así
que hay costura sin tocar producción. El cliente se envuelve en un `Proxy` (misma técnica que
`clienteConSavepoint`, con el `bind` que las funciones de Prisma necesitan) de modo que
`pushEnvioDia.create` **espera a que las dos conexiones hayan llegado** antes de ejecutar. Todo lo
demás —repositorio, decorador, índice único— es el de producción.

**La barrera va en `create` y NO en `findFirst`, a propósito:** `create` lo llaman las dos
versiones, así que el caso no puede quedarse colgado contra la implementación buena.

**Lo que separa a las dos implementaciones no es el número de filas** —el índice único salva a las
dos— **sino el número de ENCOLADOS**, que es lo que el teléfono nota. Por eso la aserción que manda
es `toHaveLength(1)` sobre la cola.

**Autocomprobación, para que no se convierta en el caso que ya había:** el caso afirma
`barrera.abiertaPorLlegadas === true`. Si las dos conexiones se hubieran serializado —o si una no
hubiera llegado a `create`— la compuerta la habría abierto el tope de seguridad y esto sería
`false`: el caso falla **diciendo que no midió**, en vez de pasar en verde sin haber medido nada.
El tope es de **15 s** contra un `testTimeout` de **20 s** (`vitest.config.ts:66`), a propósito: así
gana mi aserción con nombre y no el timeout mudo de vitest.

### La mutación del reviewer, matada — **el rojo, no el cuento**

Apliqué **la misma mutación, literal**, en `lib/repositories/PushSuscripcionRepository.ts`
(`findFirst` → `if (previo !== null) return false` → `create` en un `try/catch` que se traga el
error → `return true`).

```
 FAIL  tests/integration/db/push-cupo-carrera.test.ts > 410/R7 — dos emisiones SIMULTANEAS dejan UN cupo y UN encolado
       > ⭑⭑ R7: con las DOS conexiones retenidas en `create`, sale UN cupo y UN encolado
AssertionError: EXACTAMENTE un encolado: si `tomarCupoDelDia` decidiera con un `SELECT` previo, las
dos emisiones se creerian ganadoras y el telefono sonaria dos veces:
expected [ { tipo: 'push_web', …(1) }, …(1) ] to have a length of 1 but got 2

- Expected
+ Received

- 1
+ 2

 ❯ tests/integration/db/push-cupo-carrera.test.ts:385:7
```

| Medición | Antes (lo del reviewer) | Ahora |
| --- | --- | --- |
| `push-cupo-carrera` con la mutación, **5 corridas seguidas** | 4/4 verdes las cinco veces | **1 failed \| 4 passed (5)**, las **5 de 5** |
| Los archivos del backend de la ficha, con la mutación | **157/157 verdes** | **1 failed \| 152 passed (153)** |
| `push-cupo-carrera` con el código **bueno** | 4 passed | **5 passed (5)** |

Las cinco corridas con la mutación puesta, una por línea:

```
corrida 1 CON MUTACION:       Tests  1 failed | 4 passed (5)
corrida 2 CON MUTACION:       Tests  1 failed | 4 passed (5)
corrida 3 CON MUTACION:       Tests  1 failed | 4 passed (5)
corrida 4 CON MUTACION:       Tests  1 failed | 4 passed (5)
corrida 5 CON MUTACION:       Tests  1 failed | 4 passed (5)
```

⚠️ **Los otros 4 casos del archivo siguieron verdes con la mutación puesta.** Es la confirmación
directa del diagnóstico del reviewer: ninguno de ellos era el control de R7, y el nuevo sí.

**Reversión:** la mutación se deshizo copiando de vuelta la **copia byte a byte** que saqué antes de
tocar nada (`cp`, **nunca `git checkout --`**), y lo verifiqué con `git diff --stat lib/` **vacío**.

## 3 · B2 · R51 — la guardia pasa de leer UN archivo a censar el árbol

### El punto ciego, reproducido

La guardia leía `RUTA_NOTIFICADORES` y nada más. Un productor nuevo **en otro archivo** se colaba
entero. Lo reproduje **con el archivo de verdad en el árbol** —el mismo que escribió el reviewer,
`lib/notificaciones/notificador-satelite.ts`, emitiendo `cierre_dia_por_aprobar`, que **sí** es
elegible para `admin` y `adminSatelite`—:

| `pnpm run test:guardias` con el intruso presente | Antes | Ahora |
| --- | --- | --- |
| Archivos | `213 passed (213)` | **`1 failed \| 212 passed (213)`** |
| Tests | `3124 passed (3124)` | **`2 failed \| 3134 passed (3136)`** |
| Salida | verde | **`GUARDIAS_EXIT=1`** |

El archivo intruso se **borró** al terminar; `git status` de `lib/` quedó limpio y la guardia volvió
a **22 passed (22)**.

### Lo que escribí: un censo con lista blanca sobre `lib/` y `app/`

`ARCHIVOS_DEL_CENSO` recorre las dos raíces (**1.386 archivos** `.ts`/`.tsx` hoy) y lee cada uno
**sin comentarios** (`quitarComentarios`), porque este árbol nombra en la prosa justo lo que el
código tiene prohibido y un censo sobre el texto crudo obligaría a borrar la explicación para pasar.

**⚠️ CUENTA APARICIONES, NO ARCHIVOS NI SÍMBOLOS.** Es la lección que este repo ya midió dos veces:
una guardia que decide «este archivo, sí o no» **se queda verde cuando borras UNA de varias
apariciones del mismo sitio**. Cada entrada declara **cuántas**, y una de más —o de menos— es
infracción.

**Las tres entradas, cada una con su motivo escrito en la lista:**

| Ruta | Apar. | Motivo, resumido (el largo va en el archivo) |
| --- | --- | --- |
| `lib/notificaciones/notificadores.ts` | 1 | **EL punto único.** Dentro de `repoReal()` y envuelta en `conPushWeb(...)` |
| `lib/notificaciones/emitir.ts` | 1 | `emisorNotificacionReal` construye el suyo con `tx`. Inofensivo **por dos razones independientes**: `orden_rechazada` no es elegible, y el decorador se retira solo cuando hay `tx` (R27) |
| `lib/actions/notificaciones.ts` | 1 | Composition root del panel (409) |

### Un dato del informe que el censo corrigió

El informe llama a `lib/actions/notificaciones.ts` **«solo lectura»**, y **no lo es**: por
`notificarCargaTerminada` → `NotificacionService` (línea 200) → `emitirCargaMasivaTerminada`, ese
repositorio **llega a CREAR** un aviso. **No es un agujero** —`carga_masiva_terminada` no es
elegible para push— pero el motivo correcto no era el que estaba escrito, y lo dejé escrito bien.

Y lo que el reviewer pedía expresamente («hoy nada afirma que siga siendo verdad»): los dos motivos
**ya no son prosa**. Tres casos los afirman con su control positivo:

```ts
expect(eventoPuedeEmpujar("orden_rechazada")).toBe(false);        // motivo de emitir.ts
expect(eventoPuedeEmpujar("carga_masiva_terminada")).toBe(false); // motivo de actions/notificaciones.ts
expect(eventoPuedeEmpujar("cierre_dia_por_aprobar")).toBe(true);  // control positivo: el predicado distingue
```

El día que uno de esos dos eventos se haga elegible, **la guardia se pone roja y manda releer el
motivo** — que es donde está escrito que ese repositorio no lleva el canal. Era, literalmente, el
agujero que el informe describía: «el día que un evento elegible se emita dentro de una
transacción, no habrá push y no fallará nada».

### Autocomprobación (sin ella una guardia no vale nada)

Este repo ya tuvo un arnés de mutaciones que **reportó 9/9 supervivientes dos veces sin haber
ejecutado un test**. El censo se comprueba a sí mismo con **inyección en el recorrido**, no en el
árbol:

1. **el productor en otro archivo** (el caso del informe) → lo caza, y la infracción que devuelve es
   exactamente `{ruta, apariciones: 1, autorizadas: 0}`;
2. **una segunda aparición dentro de un archivo YA autorizado** → `{apariciones: 2, autorizadas: 1}`.
   Éste es el que cierra el modo de fallo «mide por método, no por escritura»;
3. **una mención en un comentario** → **no** se dispara (si se disparara, la única salida sería
   borrar la explicación);
4. el detector **cuenta** (`2` cuando hay dos) y **no** confunde un `import` ni una anotación de tipo;
5. anti-vacuidad: el barrido lee más de 800 archivos y llega a las tres rutas de la lista;
6. control positivo: las tres entradas **de verdad** construyen, y la cuenta declarada es la real.

Las inyecciones miden un **delta** contra el árbol real (`nuevasInfracciones`), no un absoluto: así
el día que el censo se ponga rojo por un intruso de verdad, las autocomprobaciones siguen midiendo
lo suyo en vez de enrojecer en cadena. Un rojo que arrastra a otros tres esconde cuál de los cuatro
es la noticia.

**Lo que ya funcionaba NO lo toqué:** los tres `describe` que leen `notificadores.ts` y el que
ejecuta `repoReal()` de verdad siguen ahí. El archivo pasa de **10** a **22** casos.

## 4 · B3 · las tres casillas de `tasks.md`

`tasks.md` queda en **39 marcadas / 1 sin marcar**, y la que queda lo está a propósito.

- **T6.4 — MARCADA.** Las claves las dio de alta el humano el 2026-09-11 y lo verificó con
  `vercel env ls`: `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY`, con **par distinto por entorno** —uno
  en *Production*, otro en *Preview*—, **ninguna en Development** y **ninguna compartida**, que era
  justo el modo de fallo que la casilla vigilaba. **`VAPID_SUBJECT` no se puso, y lo comprobé
  contra el código:** `piezasVapidAusentes()` (`lib/config/push.ts:64`) solo filtra
  `[VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY]`; el *subject* cae a `DEFAULT_SUBJECT` en
  `loadPushConfig()`. No falta nada. Ninguna clave se pegó en ningún archivo.
- **T6.5 — SIN MARCAR, a propósito.** La hace el humano el 2026-09-12 con su teléfono. Ya no le
  falta nada (las claves están y el control está mergeado). El motivo va **escrito en su línea** y
  la ficha lo declara **límite abierto**: nadie ha visto todavía un push en un teléfono.
- **T6.6 — MARCADA.** Escrita la entrada del **2026-09-11 en `progress/history.md`**, con el estilo
  de las del 2026-09-10: qué se midió, qué se descubrió y **qué casi se cuela** (los dos
  bloqueantes, con sus números), no un changelog de archivos.

## 5 · El gate: **completo**, porque el rápido se negó

El rápido **se negó solo**, y con razón —el diff de la rama contra `dev` toca migraciones,
`db/schema.prisma`, `lib/types/push.ts` y `package.json`—:

```
Tu cambio toca cimientos, y para eso el modo rapido no alcanza:
    db/migrations/20260912120000_push_suscripcion/{migration,down}.sql
    db/migrations/20260912120100_job_tipo_push_web/{migration,down}.sql
    db/schema.prisma · lib/types/push.ts · package.json · pnpm-lock.yaml · .env.example
✗ esto exige el gate completo. Corre: ./init.sh
INIT_EXIT=1
```

Corrido el completo, con `INIT_EXIT` escrito **DENTRO** del log
(`progress/gate_410_fix.log`) y sin canalizar por `tail`:

```
✓ typecheck paso
✓ lint paso                          → ✖ 184 problems (0 errors, 184 warnings)
✓ DATABASE_URL resuelta: los 163 archivos de tests contra Postgres SI se ejecutan
 Test Files  1919 passed (1919)
      Tests  27779 passed | 26 skipped (27805)
   Duration  648.73s
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1919 ejecutado(s))
== init OK ==
INIT_EXIT=0
```

**Los `skipped` mirados, no solo el `INIT_EXIT`.** Los **26** son de siempre y **no son de
`integration/db`**: 17 de `AnaliticaPage.test.tsx` y 9 de `AnaliticaShell.test.tsx`, los dos
preexistentes. `DATABASE_URL` resolvió y los **163 archivos contra Postgres se ejecutaron**, así que
no hay un «init OK» barato por `.env` ausente.

**Comparación honesta con la corrida del reviewer:**

| | Reviewer (`ebb1d946`) | Esta |
| --- | --- | --- |
| `INIT_EXIT` | **1** | **0** |
| Archivos | 1 failed \| 1918 passed | **1919 passed (1919)** |
| Tests | 1 failed \| 27765 passed \| 26 skipped | **27779 passed \| 26 skipped** |
| Lint | 184 warnings, 0 errores | **184 warnings, 0 errores** (idéntico: mis archivos no añaden ninguno) |

**+13 tests** = 1 de B1 + 12 de B2. **El rojo ajeno conocido no salió esta vez**:
`historico-conversaciones.int` pasó en la corrida completa. No lo perseguí y **no lo metí en
`tests/baseline-rojos.json`**; es contención de la base local compartida y aislado pasa 27/27
(medido dos veces por el reviewer).

## 6 · Mapa `R<n> → test` de los dos requisitos que el informe rechazó

| R | Antes | Ahora |
| --- | --- | --- |
| **R7** — la exclusión DEBE ser estructural, no una comprobación previa que una carrera pueda burlar | `push-cupo-carrera` › «`Promise.all` …» y «MUTACION: `SELECT`-y-luego-`INSERT`…» — **ninguno se pone rojo** si la exclusión deja de ser estructural | **`push-cupo-carrera` › «⭑⭑ R7: con las DOS conexiones retenidas en `create`, sale UN cupo y UN encolado»** — rojo 5 de 5 con la mutación |
| **R51** — un productor nuevo que no pase por el punto único DEBE poner en rojo una guardia | `push-cableado-unico` — 4 casos, todos sobre **un solo archivo** | **`push-cableado-unico` › «⭑ ningun archivo de `lib/` ni de `app/` se sale de la lista blanca»** + 5 autocomprobaciones + 3 de motivos afirmados |

Los otros 50 requisitos ya tenían su test y el reviewer los recorrió uno a uno: no los toqué.

## 7 · Lo que NO hice, y por qué

- **Ni una línea de producción.** El informe lo dice y lo verifiqué: `git status` de `lib/`, `app/`
  y `db/` limpio al terminar. La única vez que toqué `lib/` fue para aplicar la mutación del
  reviewer, y la revertí desde una copia byte a byte.
- **No borré el caso de la barrera a pelo.** Demuestra una propiedad del motor y del índice que
  sigue siendo cierta y útil; lo que faltaba era el eslabón «y el código de producción es el que se
  apoya en ese índice», que es el caso nuevo.
- **Los 7 menores quedan fuera**, incluido el voseo de `public/sw.js` (m3): el propio reviewer juzgó
  que se arregle en el primer trabajo que toque ese archivo.
- **No toqué `feature_list.json`** (m4 es del leader) ni ningún `down.sql` histórico.
- **No perseguí el rojo ajeno** de `historico-conversaciones.int` ni lo metí en el baseline.

## 8 · Veredicto

**Los tres bloqueantes cerrados con medición: la mutación de R7 sale roja 5 de 5 en el camino real,
el productor en otro archivo pone la guardia en rojo con `exit 1`, y `tasks.md` queda 39/40 con la
única sin marcar declarada como límite abierto — gate completo `INIT_EXIT=0`, 1919/1919 archivos.**
