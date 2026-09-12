# Ficha 422 — Bitácora de implementación (backend, tandas 1 a 4)

> Rama `feat/422-preferencia-push-recordada`, worktree `R:/wt/wt422`, base `origin/dev` @ `23c33f07`.
> **Alcance: tandas 1, 2, 3 y 4. La tanda 5 (la reactivación, frontend) NO está aquí** y la escribe
> otro agente sobre esta costura. Lo que esa tanda necesita saber está en §7, con nombre y apellido.

---

## 1. Las preguntas abiertas del spec, y por qué ninguna me bloqueó

El spec deja **cinco** preguntas abiertas. Ninguna bloquea las tandas 1-4, y lo digo una a una en vez
de darlo por hecho:

| # | Estado para estas tandas | Por qué |
| --- | --- | --- |
| **P1** — ¿apagar aquí apaga allá? | **Resuelta por la instrucción del encargo**, no por mí | El encargo dice literalmente «410/R19 no se toca: cerrar sesión sigue dando de baja **ese** dispositivo y no los otros», y el spec asume lo mismo. Implementado así, y **medido** contra Postgres (§4, caso de las dos suscripciones). Si el humano lo cambiara, lo que se toca es `lib/pwa/baja-push.ts` y el caso `410/R19 intacto` de `usuario-preferencia.test.ts` se pondría rojo — que es lo que se quiere. |
| **P2** — qué muestra el interruptor | **No la toco**: es tanda 5 | 410/R14 sigue intacto. El hook no cambia lo que pinta. |
| **P3** — texto exacto | **No la toco**: es T5.3 | `TEXTOS.ayuda` de `PushOptIn.tsx` no se ha tocado. |
| **P4** — nombre del lugar | **Seguido el diseño**: `usuario_preferencia` con columna `avisos_push` | El encargo fija la decisión 1 («tabla propia con columnas tipadas, no EAV») como no reabrible, y el diseño §2.1 fija el nombre. Si mañana hay pantalla de ajustes, **añadir una preferencia es una migración sobre una tabla estrecha que no lee nadie más** — no un rediseño. |
| **P5** — sin telemetría | **Sin efecto en el código** | Lo único que queda de un fallo es el `console.error`, como dice el spec. No he inventado contadores. |

---

## 2. Archivos

### Creados

```
db/migrations/20260915120000_usuario_preferencia/migration.sql
db/migrations/20260915120000_usuario_preferencia/down.sql
lib/interfaces/repositories/IUsuarioPreferenciaRepository.ts
lib/repositories/UsuarioPreferenciaRepository.ts
lib/pwa/alta-push.ts
tests/integration/db/usuario-preferencia-migration.test.ts
tests/integration/db/usuario-preferencia.test.ts
tests/unit/guards/push-intencion-de-baja.guardia.test.ts        (G1)
tests/unit/guards/push-alta-punto-unico.guardia.test.ts         (G2)
tests/unit/pwa/alta-push.test.ts
```

### Modificados

```
db/schema.prisma                          (+modelo `UsuarioPreferencia`, +relación `preferencia` en `Usuario`)
lib/actions/push.ts                       (registrar pone la preferencia; +`olvidarPreferenciaDeAvisos`)
lib/pwa/baja-push.ts                      (motivo obligatorio + switch exhaustivo + intención antes del corte)
hooks/usePushSuscripcion.ts               (`activar()` usa `alta-push`; `desactivar()` declara su motivo)
app/_components/LogoutButton.tsx          (declara su motivo, con el porqué escrito)
tests/fixtures/navegador-push.ts          (el doble actualiza `Notification.permission`, como un navegador real)
tests/unit/pwa/baja-push.test.ts          (ampliado: R7, R8, R9, R11, R12, R13)
tests/unit/actions/push-action.test.ts    (ampliado: R3, R7, R24)
tests/components/LogoutButton.push.test.tsx        (motivo literal + R19 intacto)
tests/unit/hooks/usePushSuscripcion.test.tsx       (motivo literal + el alta por `alta-push`)
tests/components/PushOptIn.test.tsx                (solo el doble del módulo de acciones)
tests/components/NotificationsBell.push.test.tsx   (solo el doble del módulo de acciones)
tests/fixtures/api-key-dependencias-usuario.ts     (censo de FKs hacia `Usuario`: +`UsuarioPreferencia.usuario`)
tests/integration/db/schema-drift-saneamiento.test.ts (censo de defaults de `updated_at`: de NUEVE a DIEZ)
specs/422-preferencia-push-recordada/tasks.md      (casillas de T1.1–T4.3)
```

> Los dos últimos son **guardias ajenas que el gate puso rojas con razón**; el detalle de por qué y
> qué se declaró en cada una está en §9.3.1.

**Por qué cuatro archivos de test ajenos tocan su `vi.mock`.** `lib/pwa/baja-push.ts` ahora importa
también `olvidarPreferenciaDeAvisos`, y esos cuatro archivos doblan `@/lib/actions/push` con una
factoría explícita. Sin añadir el export, el import se resuelve a `undefined` y el fallo sale como
«no es una función» — un rojo que no dice nada de lo que esos archivos miden. El cambio es aditivo:
ninguna aserción suya se ha tocado.

---

## 3. El nudo (tanda 3): cómo se impide que un productor nuevo se olvide

El encargo pedía que **lo impida el tipo, no un comentario**. Son tres capas, y las tres están
medidas:

1. **El motivo es un parámetro obligatorio de una unión cerrada.** Con `strict: true`, una tercera
   superficie que escriba `darDeBajaDeEsteDispositivo()` **no compila**. No hay valor por defecto, y
   eso es deliberado: un defecto convertiría «no dijo por qué» en «se asume que solo se va».
   → Medido: **M1b**, `TSC_EXIT=2`.
2. **El `switch` es exhaustivo** (`const _exhaustivo: never = motivo`). Añadir un tercer motivo sin
   decidir qué significa para la preferencia **tampoco compila**.
   → Medido: **M1c**, `TSC_EXIT=2`.
3. **La guardia G1 censa las llamadas** con lista blanca de dos entradas, cada una con **su cuenta,
   su motivo y su porqué escrito**. El tipo obliga a declarar *un* motivo; la guardia obliga a que
   alguien escriba *por qué ése*. Cuenta **apariciones, no archivos** (la lección medida dos veces
   en este repo), distingue la **declaración** de una llamada, y no se dispara con un comentario.
   → Medido: **M1**, seis tests rojos.

Y la decisión 3 del encargo —la intención **antes** del corte por «sin suscripción» (R11)— está en
la primera línea de la función, con su porqué al lado, y medida por **M4**.

---

## 4. 410/R19 sigue intacto, y aquí está el test que se pone rojo si alguien lo rompe

Tres niveles, porque uno solo se puede eludir:

| Dónde | Qué afirma |
| --- | --- |
| `tests/unit/pwa/baja-push.test.ts` › `con motivo «…» se manda UN endpoint, el de este navegador, y nada más` (los **dos** motivos) | La forma **exacta** del cuerpo que sale al servidor: `{ endpoint }` y nada más. Un `todosLosDispositivos: true` o un `usuarioId` lo pone rojo antes de llegar al servidor. |
| `tests/unit/pwa/baja-push.test.ts` › `borrar la preferencia NO es borrar suscripciones: la acción va SIN cuerpo` | `olvidarPreferenciaDeAvisos` se llama **sin argumentos**. Esa es la puerta por la que «apagar en el teléfono» podría retirar la suscripción de la computadora. |
| `tests/integration/db/usuario-preferencia.test.ts` › `dar de baja UN dispositivo deja vivo el otro de la misma persona` | **Contra Postgres**, con dos suscripciones reales de la misma persona: se da de baja el teléfono y **queda la de «Firefox en Windows»**; y borrar la preferencia sola no retira ninguna. Con control positivo (antes había 2). |

Ese último caso es la propiedad medida hoy en producción, escrita como test.

---

## 5. El backfill, y su medición contra producción

### 5.1 ANTES de aplicar (ejecutar en **solo lectura** contra producción)

```sql
SELECT COUNT(*) AS suscripciones, COUNT(DISTINCT usuario_id) AS personas FROM push_suscripcion;

SELECT u.email, s.etiqueta, s.created_at
FROM push_suscripcion s JOIN usuario u ON u.id = s.usuario_id
ORDER BY s.created_at;
```

**Lo que debe salir, medido hoy (2026-09-11) y escrito aquí ANTES de desplegar:**

| | valor esperado |
| --- | --- |
| `suscripciones` | **1** |
| `personas` | **1** |
| única fila | usuario `ecf6c289-9799-4558-be6d-ce5f8a12f5cd`, etiqueta **«Firefox en Windows»**, creada **2026-09-12 02:11:27 UTC** |

> Si al desplegar ese número **no es 1**, no es un problema: significa que alguien más activó los
> avisos entre medias. Lo que importa es que el número de `personas` que salga **antes** sea el mismo
> que las tres cifras de después. Un backfill sin su número medido no se despliega.

### 5.2 DESPUÉS de aplicar

```sql
SELECT COUNT(*) AS filas,
       COUNT(*) FILTER (WHERE avisos_push) AS puestas,
       COUNT(*) FILTER (WHERE updated_at = created_at) AS intactas
FROM usuario_preferencia;
```

**`filas = puestas = intactas = personas`** (o sea, **1 = 1 = 1 = 1** con la foto de hoy) demuestra
que el backfill hizo exactamente lo que dijo y que **nada más tocó esas filas**.

> `updated_at = created_at` sólo significa algo si el `update` del repositorio **no** reescribe
> `created_at`. Eso está medido aparte: `usuario-preferencia.test.ts` › `actualizar toca updated_at y
> NO created_at`. Sin ese caso, la comprobación de arriba sería verde siempre.

**No he ejecutado nada contra producción.** Las consultas quedan escritas, nada más.

### 5.3 Y por qué el backfill se mide igualmente con un test

Contra la base **local** hay **0 filas** en `push_suscripcion` (medido: `{"suscripciones":0,"personas":0}`),
así que la migración aplicada ahí insertó **0** y una consulta a `public` no distinguiría «el backfill
funciona» de «no había nada que copiar». Por eso
`usuario-preferencia-migration.test.ts` **siembra su propio escenario en un esquema desechable y
ejecuta ahí las sentencias del `migration.sql` REAL** (leídas del archivo, sin tocar el texto): Ana
con dos dispositivos, Beto con uno, Carla con ninguno → dos filas, las dos en `true`, las dos
`intactas`, y Carla **sin fila**. Borrar el `INSERT ... SELECT` del archivo pone ese caso rojo (M5).

---

## 6. Mapa `R<n> → test` (de mi alcance)

| R | Test que lo cubre |
| --- | --- |
| **R1** | `usuario-preferencia-migration.test.ts` › `R1: la tabla existe, con su forma EXACTA` (incluye: la tabla **no** tiene ninguna columna de dispositivo) · `baja-push.test.ts` › `cerrar sesión NO borra la preferencia` |
| **R2** | `usuario-preferencia.test.ts` › `sin fila, avisosPushDe devuelve false` (+ control positivo) · `usuario-preferencia-migration.test.ts` › `NO crea fila para quien no tenía ninguna` |
| **R3** | `push-action.test.ts` › `registrar deja la preferencia puesta` · `la suscripción se escribe ANTES que la preferencia` |
| **R4** | `usuario-preferencia-migration.test.ts` › `R4: la FK a usuario es CASCADE en la base` · `CASCADE de verdad, en un esquema desechable` |
| **R5** | `usuario-preferencia-migration.test.ts` › `quien ya tenía suscripción queda con la preferencia puesta` · `dos dispositivos de la MISMA persona dejan UNA sola fila` · `updated_at = created_at` · control positivo sin suscripciones |
| **R6** | `push-alta-punto-unico.guardia.test.ts` › `ni un archivo del camino del envío nombra la preferencia` · `el repositorio del canal sigue eligiendo destinatarios SOLO por suscripción` (con control positivo del detector) |
| **R7** | `baja-push.test.ts` › `apagar el interruptor borra la preferencia` · `push-action.test.ts` › `olvidarPreferenciaDeAvisos … escribe false` · `usePushSuscripcion.test.tsx` › `desactivar declara la-persona-apago-el-interruptor` |
| **R8** | `baja-push.test.ts` › `cerrar sesión NO borra la preferencia` (+ control positivo) · `LogoutButton.push.test.tsx` › `sale declarando que solo se va` |
| **R9** | `baja-push.test.ts` › `la huella sobre el dispositivo es IDÉNTICA con los dos motivos` · `y lo ÚNICO que cambia entre los dos es la preferencia` |
| **R10** | `push-intencion-de-baja.guardia.test.ts` (censo + intruso inyectado + motivo cambiado + motivo no literal) · `typecheck` (M1b, M1c) · el bloque `y el TIPO, que es la primera línea de defensa` |
| **R11** | `baja-push.test.ts` › `apagar sin suscripción viva borra la preferencia igual` · `y ni siquiera hace falta que haya service worker` (+ control positivo al salir) · `usePushSuscripcion.test.tsx` › `R11: y lo hace igual aunque este dispositivo ya no tenga suscripción viva` · G1 › `la intención se resuelve ANTES del corte` |
| **R12** | `baja-push.test.ts` › `la acción rechaza: la baja del dispositivo se hace entera y NADA lanza` · `la acción devuelve un error de acción` (+ control positivo) |
| **R13** | `baja-push.test.ts` › `con motivo «…» se manda UN endpoint` (los dos motivos) · `borrar la preferencia NO es borrar suscripciones` · `LogoutButton.push.test.tsx` › `la baja de ESTE dispositivo se hace igual` · `usuario-preferencia.test.ts` › `dar de baja UN dispositivo deja vivo el otro` |
| **R16** | `alta-push.test.ts` › `requestPermission no se llama en NINGUNO de los tres estados` · `push-alta-punto-unico.guardia.test.ts` › `una sola aparición, y está en activar()` · `alta-push.ts NO la contiene` |
| **R17** | `alta-push.test.ts` › `con el permiso en «default» NO se suscribe` · `con «denied» tampoco` (+ control positivo) · G2 › `la comprobación del permiso está ANTES del subscribe` |
| **R22** (mitad de la preferencia) | `usuario-preferencia.test.ts` › `dos escrituras CONCURRENTES dejan una fila` (**dos conexiones reales**, esquema desechable) · `MUTACIÓN M10, medida contra el MOTOR` |
| **R24** | `push-action.test.ts` › `SIN sesión: unauthenticated y CERO escrituras` · `registrar sin sesión deja las dos tablas intactas` (+ control positivo) · `push-alta-punto-unico.guardia.test.ts` › `PushReactivacion solo puede montarse en el layout autenticado` |

**Fuera de mi alcance (tanda 5):** R14, R15, R18, R19, R20, R21, R23 (todos `PushReactivacion.test.tsx`),
R25 y R26 (`PushOptIn.test.tsx`). R21 y R23 dependen del componente que no existe todavía.

---

## 7. ⚠️ La costura para la tanda 5 — lo que el agente de frontend NO tiene que adivinar

Todo esto está listo y estable; nada de lo de abajo hay que inventarlo.

1. **La función del alta, ya extraída:**
   ```ts
   import { suscribirYRegistrarEsteDispositivo } from "@/lib/pwa/alta-push";
   // (clavePublica: string) => Promise<{ estado: "suscrito" | "sin-permiso" | "sin-soporte" | "fallo" }>
   ```
   **Comprueba el permiso y no lo pide.** No consulta la preferencia: quien la consulta es el
   llamante. Registra ya el fallo con su operación y **sin** el `endpoint` ni las claves (R20/R23),
   así que `PushReactivacion` **no debe volver a registrarlo**.

2. **La lectura de la preferencia en el servidor** (para `app/(app)/layout.tsx`):
   ```ts
   import { UsuarioPreferenciaRepository } from "@/lib/repositories/UsuarioPreferenciaRepository";
   import { getPrismaClient } from "@/lib/db/prisma-client";
   const avisosRecordados = actor
     ? await new UsuarioPreferenciaRepository(getPrismaClient()).avisosPushDe(actor.usuarioId)
     : false;
   ```
   Sin actor, `false` (R24). `avisosPushDe` **no crea ninguna fila al leer**.

3. **La reafirmación cuando ya hay suscripción viva (R21)** se hace con la acción de siempre,
   `registrarSuscripcionPush(...)`, que además deja la preferencia puesta (R3) — **no hace falta**
   llamar a nada más para eso.

4. **La guardia G2 ya te está esperando, y hoy pasa con el componente ausente.** Su caso
   `PushReactivacion solo puede montarse en el layout autenticado` es **simétrico**: mientras
   `components/shared/PushReactivacion.tsx` no exista, exige que **nadie** escriba `<PushReactivacion`;
   **en cuanto crees ese archivo**, la otra rama entra sola y exige que el único montaje del árbol
   esté en `app/(app)/layout.tsx`. O sea: crear el componente y no montarlo, o montarlo dos veces, o
   montarlo en otro sitio, **pone la guardia roja**. No hay que tocarla.

5. **El fixture `tests/fixtures/navegador-push.ts` cambió una cosa** y te afecta:
   `requestPermission()` ahora **actualiza `Notification.permission`** con la respuesta, como hace un
   navegador de verdad. Antes resolvía «granted» y `permission` seguía diciendo «default» para
   siempre — con el alta comprobando el permiso, eso describía un navegador que no existe. Para
   `PushReactivacion` usa `montarNavegadorPush({ permiso: "granted" | "default" | "denied" })`; el
   `respuestaAlPedir` no te hace falta porque la reactivación **no pide nada**.

6. **Las mutaciones M3, M7 y M9 son tuyas** y no están ejecutadas aquí: las tres necesitan
   `PushReactivacion.tsx`. M2 está ejecutada **en su mitad de `alta-push`**; su otra mitad
   (`PushReactivacion.test.tsx › la preferencia puesta no se salta el permiso`) también es tuya.

7. **Una decisión mía que conviene que conozcas:** `activar()` ya **no espera a
   `navigator.serviceWorker.ready`** — `alta-push` usa `getRegistration()`, porque `ready` no
   resuelve nunca si no hay registro activo y dejaría el camino silencioso colgado para siempre
   (design §7). El efecto en `activar()` es favorable en los dos extremos y está escrito en el
   archivo; la peor consecuencia posible es un `{estado:"fallo"}` visible y reintentable, nunca un
   estado mentiroso.

---

## 8. Decisiones que tomé y NO estaban literalmente en el spec

Las escribo porque el spec no las cubre y alguien tiene que poder discutirlas:

1. **Si anotar la preferencia falla dentro de `registrarSuscripcionPush`, el registro sigue siendo
   `ok`** (el fallo se registra con su operación y su causa, no se absorbe). El spec sólo fija la
   semántica de fallo para el **borrado** (R12). Lo hice así porque es **medible**: quien llama
   (`lib/pwa/alta-push.ts`) **deshace la suscripción del navegador** cuando el registro no sale `ok`.
   Propagar el fallo dejaría sin avisos a un dispositivo perfectamente registrado, por culpa de una
   columna que —por R6— no decide a dónde sale un push. Hay un test que lo fija:
   `push-action.test.ts` › `si ANOTAR la preferencia falla, el registro sigue siendo ok`.
2. **`fijarAvisosPush(usuarioId, false)` es lo que el spec llama «borrar» la preferencia** (la fila
   queda con `avisos_push = false`, no se elimina). Es lo que el contrato del diseño §6.2 describe, y
   a efectos de comportamiento `false` y «sin fila» son lo mismo (R2). Conservar la fila deja además
   el rastro de que esa persona **decidió**, que es distinto de no haber decidido nunca.
3. **El fixture del navegador ahora actualiza `Notification.permission`** (§7.5). Es una corrección
   de fidelidad del doble, no un cambio de requisito.

---

## 9. Salidas reales

### 9.1 `pnpm run typecheck`

```
(sin salida)
```
Exit 0. Y **el typecheck es la primera línea de defensa de R10**: con el motivo quitado da
`TSC_EXIT=2` (M1b) y con un tercer motivo sin tratar, también (M1c).

### 9.2 `pnpm run lint`

```
✖ 184 problems (0 errors, 184 warnings)
```
**0 errores.** Los 184 avisos son `no-unused-vars` preexistentes de `dev` (variables `_algo` en
dobles de test), ninguno en archivos de esta ficha.

### 9.3 `./init.sh` (gate COMPLETO)

> El gate rápido **se niega solo** con este diff: toca `db/schema.prisma` y `db/migrations/**`.

```
✓ typecheck paso
✓ lint paso
...
 Test Files  1949 passed (1949)
      Tests  28296 passed | 26 skipped (28322)
   Duration  592.96s
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1949 ejecutado(s), todos en el baseline conocido)
== init OK ==
INIT_EXIT=0
```

**`INIT_EXIT=0` está escrito DENTRO del log**, no leído del código de salida del proceso. No es
manía: la herramienta que lanzó este mismo comando reportó **«exit code 0» en la corrida anterior,
que fue ROJA**. Sin el `INIT_EXIT` dentro del log me la habría creído.

**Los `skipped` son 26, y son los de siempre:**

```
tests/components/AnaliticaPage.test.tsx  (64 tests | 17 skipped)
tests/components/AnaliticaShell.test.tsx (15 tests |  9 skipped)
```

**Cero saltados de `tests/integration/db/`** (comprobado con un `grep -c` sobre el log: `0`). O sea
que la capa de datos **se ejecutó de verdad**, que es lo que aquí más importa. Mis cinco archivos
nuevos, con su cuenta:

```
tests/integration/db/usuario-preferencia-migration.test.ts  (19 tests)
tests/integration/db/usuario-preferencia.test.ts            (11 tests)
tests/unit/guards/push-intencion-de-baja.guardia.test.ts    (18 tests)
tests/unit/guards/push-alta-punto-unico.guardia.test.ts     (13 tests)
tests/unit/pwa/alta-push.test.ts                            (12 tests)
```

#### La primera corrida del gate salió ROJA, y los dos rojos eran míos

No lo escondo porque es la parte útil. `INIT_EXIT=1`, `7 failed`, dos archivos fuera del baseline:

- `tests/unit/guards/api-key-dependencias-usuario.guardia.test.ts` — exige que **toda** relación
  hacia `usuario` esté clasificada con su motivo, y `UsuarioPreferencia.usuario` era nueva.
- `tests/integration/db/schema-drift-saneamiento.test.ts` — su lista de tablas cuyo `CREATE TABLE`
  puso `DEFAULT` en `updated_at` **se mantiene a mano**, justo para que una tabla nueva no entre sin
  que alguien lo decida. Pasó de NUEVE a DIEZ.

Las dos son guardias ajenas **haciendo exactamente lo que existen para hacer**. Se resolvieron
**ampliando las listas con su motivo escrito**, sin relajar ni una aserción y sin tocar
`tests/baseline-rojos.json`. Commit `b8c73643`.

> Para quien venga detrás: **cualquier modelo nuevo en `db/schema.prisma` con relación a `Usuario` y
> con `updated_at` con default va a poner estas dos guardias rojas.** No es tu código roto; es la
> señal de que hay dos decisiones que declarar.

### 9.4 Las mutaciones

Cada mutación se aplicó **sola**, se corrió el gate acotado a lo que debía cazarla, se anotó qué se
puso rojo y se revirtió **verificando el SHA256** del archivo restaurado (nunca `git checkout --`).
Cada log lleva su `VITEST_EXIT=` / `TSC_EXIT=` escrito dentro.

**M0 es la mutación de CONTROL, diseñada para MORIR**, y va primera a propósito: en este repo un
arnés reportó «9/9 supervivientes» **dos veces sin haber ejecutado un solo test**. Si M0 hubiera
sobrevivido, nada del resto de esta tabla valdría.

| # | Mutación | Veredicto | Qué se puso rojo |
| --- | --- | --- | --- |
| **M0** (control) | `avisosPushDe` devuelve `true` cuando no hay fila | **MUERTA** (exit 1) | `usuario-preferencia.test.ts` › `sin fila, avisosPushDe devuelve false` · `la preferencia de OTRA persona no se cuela` |
| **M1** | `LogoutButton` declara `"la-persona-apago-el-interruptor"` | **MUERTA** (exit 1) — **6 tests** | `LogoutButton.push.test.tsx` › `sale declarando que solo se va` · `sin suscripción en este dispositivo, salir tampoco apaga la preferencia` · G1 › `ningún archivo se sale de la lista blanca` + 3 autocomprobaciones |
| **M1b** | Se quita el parámetro `motivo` | **MUERTA** (`TSC_EXIT=2`) | `pnpm run typecheck`: los dos sitios de llamada |
| **M1c** | Tercer motivo en la unión sin tratarlo | **MUERTA** (`TSC_EXIT=2`) | `pnpm run typecheck`: el `never` del `default` |
| **M1d** | La distinción borrada **dentro** del `switch` (salir pasa a borrar) | **MUERTA** (exit 1) — **8 tests** | `baja-push.test.ts` › `cerrar sesión NO borra la preferencia` · `lo ÚNICO que cambia entre los dos es la preferencia` · `control positivo: al SALIR sin suscripción no se toca la preferencia` + 5 más |
| **M2** | Se quita `Notification.permission !== "granted"` de `alta-push` | **MUERTA** (exit 1) | `alta-push.test.ts` › `con el permiso en «default» NO se suscribe` · `con «denied» tampoco` · G2 › `la comprobación del permiso está ANTES del subscribe` |
| **M4** | La intención, movida **detrás** del corte por «sin suscripción» | **MUERTA** (exit 1) | `baja-push.test.ts` › `apagar sin suscripción viva borra la preferencia igual` · `ni siquiera hace falta que haya service worker` · G1 › `la intención se resuelve ANTES del corte` |
| **M5** | Borrado el `INSERT ... SELECT` del `migration.sql` | **MUERTA** (exit 1) — **7 tests** | `usuario-preferencia-migration.test.ts` › `quien ya tenía suscripción queda con la preferencia puesta` · `NO crea fila para quien no tenía ninguna` · `updated_at = created_at` + 4 más |
| **M6** | El camino del envío filtra además por `avisosPush` | **MUERTA** (exit 1) | G2 › `ni un archivo del camino del envío nombra la preferencia` · `el repositorio del canal sigue eligiendo destinatarios SOLO por suscripción` |
| **M8** | `registrarSuscripcionPush` no pone la preferencia | **MUERTA** (exit 1) | `push-action.test.ts` › `registrar deja la preferencia puesta` + 3 más |
| **M10** | El índice de `usuario_id` deja de ser UNIQUE (**en la base**) | **MUERTA** (exit 1) — **8 tests** | `usuario-preferencia.test.ts` › `MUTACIÓN M10, medida contra el MOTOR` · `dos escrituras CONCURRENTES dejan una fila` · `el clon llevó consigo el ÍNDICE ÚNICO` · `usuario-preferencia-migration.test.ts` › `el índice de usuario_id es UNICO` |

**11 mutaciones, 11 muertas. Cero supervivientes, y el control murió.**

**Las dos que la ficha exigía por nombre, las dos cumplidas:**

- *«quitar la distinción entre salir y apagar debe romper un test por sí solo»* → **M1** (6 tests) y
  **M1d** (8 tests). Y quitarla del todo ni siquiera compila (**M1b**).
- *«la preferencia puesta no debe poder saltarse la comprobación del permiso»* → **M2**. La
  comprobación vive en `alta-push.ts`, **la preferencia ni siquiera entra en esa función**, y G2
  exige que `pushManager.subscribe(` aparezca **una sola vez** y ahí dentro: no hay un segundo camino
  por el que suscribir saltándosela.

**M10 se aplicó contra la base local compartida** (`DROP INDEX` + `CREATE INDEX` no único) y se
restauró en la misma corrida, **verificando el `indexdef` resultante**:

```
CREATE UNIQUE INDEX usuario_preferencia_usuario_id_key ON public.usuario_preferencia USING btree (usuario_id)
```

Es además la prueba de que el caso de la carrera **mide el índice** y no pasa por accidente: al
quitarlo, las dos conexiones dejan de estar excluidas y el caso cae.

#### Las tres mutaciones que NO están ejecutadas, y por qué

**M3, M7 y M9 son de la tanda 5**: las tres mutan `components/shared/PushReactivacion.tsx`, que **no
existe todavía** y no es de mi alcance. La mitad de **M2** que toca
`PushReactivacion.test.tsx › la preferencia puesta no se salta el permiso` es de esa misma tanda.
No las marco como «supervivientes» ni como «muertas»: **no se pueden ejecutar**, y decirlo es más
honesto que inventarles un veredicto.

---

## 10. Lo que hay que saber antes de tocar nada más

1. **La migración está aplicada en la base local compartida** (`prisma migrate deploy`, no `dev`, así
   que no hubo riesgo de reset). Los demás worktrees verán una tabla que su `schema.prisma` no
   conoce: es **aditiva** y no rompe nada, pero si alguien corre `prisma migrate dev` desde otra rama,
   Prisma detectará deriva y **ofrecerá resetear**. Que nadie acepte eso.
2. **`.env` se copió al worktree** (`sha256 0501fee3…`, idéntico al del árbol principal). Sin él,
   `prisma generate` **falla y sale con código 0** —me pasó en el primer intento— y deja un cliente
   Prisma rancio que llena el typecheck de errores falsos en archivos ajenos.
3. **`feature_list.json` NO se ha tocado.**

---

# 11. Segunda vuelta — B1 y B2 de `progress/review_422.md`

> La revisión salió **RECHAZADA** por dos bloqueantes, **los dos en mis guardias**. Tenía razón: G1
> y G2 decían «en todo el árbol» y no era verdad. Esta sección es lo que se arregló y, sobre todo,
> **lo que se midió** — incluido lo que sigue abierto.

## 11.1 Lo que estaba mal, dicho sin rodeos

| | Qué afirmaba la guardia | Qué pasaba de verdad |
| --- | --- | --- |
| **B1** | «`requestPermission` aparece una sola vez **en todo el árbol**» (R16); «nadie se da de baja sin declarar su motivo» (R10) | El censo leía **4 de 8 raíces**. `providers/` —donde vive el `ToastProvider` que **envuelve a `<PushReactivacion />`**— quedaba fuera. |
| **B2** | Lo mismo de R10, dentro de `components/` | El detector buscaba la **llamada**, así que un `import { … as bajar }` la esquivaba: en la cláusula `import` al nombre no le sigue un `(`. |

Las dos con `TSC_EXIT=0` y **145 archivos de guardia / 2.091 casos en verde**.

## 11.2 Por qué no bastaba con añadir `"providers"`

Porque eso repara el síntoma de hoy y deja **la causa** intacta: una lista de carpetas escrita a
mano **envejece sola y en silencio**, que es exactamente la familia de fallo que estas dos guardias
existen para cerrar. Dentro de seis meses aparece otra carpeta y volvemos aquí.

**Ahora las raíces se derivan del disco y se comparan contra un inventario declarado**
(`tests/fixtures/raices-de-codigo.ts`, molde de `api-key-dependencias-usuario.ts`):

- `raicesDelArbol()` recorre el repositorio. **No hay ninguna lista de carpetas ahí dentro**: una
  raíz es «de código» si contiene algún `.ts`/`.tsx`; se ignoran `node_modules` y lo que empieza por
  punto. Por eso una carpeta nueva **aparece sola**.
- `INVENTARIO_DE_RAICES` dice, para cada una, **si se censa y por qué**.
- `fallosDelInventario()` exige que coincidan. Una raíz sin clasificar —o una entrada que ya no
  existe— **pone las dos guardias rojas**.

**Las ocho raíces, con su decisión:** `app`, `components`, `e2e`, `hooks`, `lib`, `providers`,
`scripts` y `(raiz)` —los `.ts` sueltos, porque **`middleware.ts` corre en cada petición**— entran
al censo. La única fuera es **`tests/`**, y su motivo lleva escrito el **límite**: es el único sitio
con una razón legítima para nombrar lo que las guardias persiguen (`baja-push.test.ts` importa el
módulo para probarlo, el doble del navegador define `requestPermission`), y una «superficie» escrita
ahí no se despliega ni la ve nadie.

## 11.3 B2: la pregunta se invirtió

El censo de G1 **ya no persigue la llamada**. Persigue el **especificador del módulo**: para llamar
a la función hay que traerla, y traerla deja `lib/pwa/baja-push` escrito **literal**. El detector de
llamadas se conserva, pero solo se aplica **dentro de los dos archivos autorizados**, para leer su
motivo — y a esos dos se les exige además importar **sin alias**, porque de ahí sale el motivo.

En G2, el mismo criterio aplicado al receptor: `requestPermission` y `subscribe(` se censan como
**identificador desnudo**, no como `Notification.requestPermission(` ni `pushManager.subscribe(`.
Así `const N = Notification; N.requestPermission()` y `const pm = reg.pushManager; pm.subscribe()`
también caen. `hooks/use-mobile.ts` declara su `subscribe` (el de `useSyncExternalStore`, que no
tiene nada que ver con push) **con su porqué**, para no tener que aflojar la aguja.

## 11.4 Los intrusos, reaplicados **contra el árbol de verdad**

No inyectados en el recorrido: **escritos en los archivos**, con la suite de guardias entera
corriendo como la corrió el reviewer, y revertidos con copia byte a byte verificada por SHA256.
**I0 es el control, diseñado para morir.**

| # | Intruso | Veredicto | Qué se puso rojo |
| --- | --- | --- | --- |
| **I0** (control) | Se saca `providers` del censo en el inventario | **CAZADO** (exit 1) | 5 casos, entre ellos `providers/ … está DENTRO del censo` en las dos guardias |
| **I1** | **El de la revisión, tal cual**: `tercerAdios()` + `segundoCaminoDelAlta()` en `providers/ToastProvider.tsx` | **CAZADO** (exit 1) | **7 casos**: `NADIE MÁS del árbol censado trae ese módulo` · `ningún archivo de NINGUNA raíz censada se sale de la lista blanca` · `una sola aparición, y está en activar()` · `EL CASO DE LA REVISIÓN: un segundo camino escrito en providers/` · `el censo del NOMBRE DEL MÉTODO cuadra…` · `el del CANAL sigue siendo exactamente uno` |
| **I2** | **El de la revisión, tal cual**: alias en `components/shared/AvisoVersionNueva.tsx` (componente **ya montado**) | **CAZADO** (exit 1) | 3 casos, incluido `EL CASO DE LA REVISIÓN: alias en un componente YA montado` |
| **I3** | **Re-export** desde un barril (`export { … } from "@/lib/pwa/baja-push"`) | **CAZADO** (exit 1) | 3 casos |
| **I4** | **`import()` dinámico** con desestructuración renombrada, en `providers/TemaProvider.tsx` | **CAZADO** (exit 1) | 3 casos, incluido `un import() DINÁMICO también se caza` |
| **I5** | **Una raíz nueva entera** (`widgets/`) con alias + `requestPermission` | **CAZADO** (exit 1) | 3 casos: `toda raíz de código está clasificada` **en las dos guardias** + la anti-vacuidad de las ocho |

**Seis de seis, y el control murió.** Los seis con `TSC_EXIT=0`: a ninguno lo caza el compilador, que
es precisamente por lo que las guardias tienen que verlos.

> **Y una lección de la primera pasada, corregida:** en I5 las autocomprobaciones del inventario se
> ponían rojas **en cadena** (2 rojos de más) porque medían contra el disco. Ahora corren sobre un
> mundo **sintético**, así que el día que aparezca una raíz sin clasificar de verdad la noticia es
> un solo caso y no cuatro. Es la misma lección que `nuevasInfracciones` ya aplicaba.

## 11.5 Lo que NO se cierra, declarado en vez de tapado

**Un especificador compuesto en tiempo de ejecución** —`await import("@/lib/pwa/" + "baja-push")`—
no deja el módulo escrito literal en ninguna parte, así que **ninguna guardia de texto puede verlo**.
Tiene su propio caso en G1 (`EL LIMITE, DECLARADO`) que afirma justamente que el detector da cero
ahí, para que nadie lo descubra creyendo que es un fallo. Dos razones por las que se acepta:

1. **El tipo sigue en pie por su cuenta.** Esa superficie tendría que declarar igualmente **uno de
   los dos motivos** (unión cerrada, parámetro obligatorio): R10 conserva su mitad fuerte, la que no
   depende de ninguna guardia.
2. **Partir una cadena para esquivar un censo es deliberado**, y lo que estas guardias persiguen es
   a **quien se olvida**, no a quien se esconde. Un límite declarado vale más que una protección
   falsa.

## 11.6 El menor `m1`

La celda **M2** de `tasks.md` pedía un rojo en `PushReactivacion.test.tsx` que **no se produce, y es
correcto que no se produzca**: el componente corta el permiso por su cuenta *antes* de llamar a
`alta-push`, así que mutar una capa no puede caer en la otra. Se partió en **M2a / M2b / M2a+M2b**,
con los rojos reales de cada una (3 / 2 / 5). La propiedad —*la preferencia puesta no se salta la
comprobación del permiso*— está defendida por **dos cortes independientes**, y eso es más fuerte que
lo que la celda original describía, no más débil.

**P3** queda resuelta por el coordinador: **tuteo**, y no se toca.

## 11.7 Gate completo, después del arreglo

```
✓ typecheck paso
✓ lint paso
 Test Files  1950 passed (1950)
      Tests  28351 passed | 26 skipped (28377)
   Duration  584.97s
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1950 ejecutado(s), todos en el baseline conocido)
== init OK ==
INIT_EXIT=0
```

`INIT_EXIT=0` escrito **dentro** del log (`scratchpad/gate422_3.log`). Los `skipped` siguen siendo
los 26 de siempre —`AnaliticaPage` 17 + `AnaliticaShell` 9— y **cero de `tests/integration/db/`**
(`grep -c`: 0): la capa de datos se ejecutó.

**Los números suben respecto de la corrida que el reviewer reprodujo** (28.325 → 28.351, +26 casos),
y ese delta es exactamente lo añadido aquí: los casos nuevos del inventario de raíces y de las cuatro
vías de B2 en las dos guardias. Ni un archivo de test perdido, ni un `baseline-rojos.json` tocado.

---

# 12. Tercera vuelta — B3 de `progress/review_422_fix.md`

> La re-revisión confirma B1 y B2 cerrados y encuentra **una séptima vía**. Tenía razón otra vez, y
> ésta era peor que la anterior: **tumbaba también la defensa del tipo**.

## 12.1 B3 — la extensión del archivo

El censo definía «archivo de código» con la aguja `\.(ts|tsx)$`. Un `.js` **dentro de una raíz ya
censada** no se leía nunca. Medido con `components/shared/adios-legacy.js` importado desde un
componente que el layout **ya monta**: `145 archivos / 2.117 casos en verde`, `TSC_EXIT=0`,
`LINT_EXIT=0`.

**Y por qué es peor que el límite que yo había declarado** —el argumento lo acepto entero—:
`tsconfig.json` tiene `allowJs: true` **sin `checkJs`**, y su `include` no cubre `.js`. O sea que el
archivo **no se type-checkea** y la llamada puede escribirse literalmente
`await darDeBajaDeEsteDispositivo();` **sin ningún motivo**. En el límite de la cadena compuesta yo
me apoyaba en que «el tipo conserva su mitad»; aquí **caen las dos líneas de defensa a la vez**, así
que mi propio argumento no se sostenía.

Y no es una vía retorcida: escribir un `.js` es un acto ordinario, el repo ya tiene cinco y nada en
`docs/` lo prohíbe.

## 12.2 El arreglo: ampliar la aguja y dejar que el mecanismo trabaje

`EXTENSIONES_DE_CODIGO` pasa a `\.(ts|tsx|js|jsx|mjs|cjs)$`, en **un solo sitio** del fixture — antes
la aguja estaba copiada cuatro veces; ahora es una constante con su porqué. Y entonces el mecanismo
de B1 hace **solo** lo que hacía falta: **`public/` pasa a ser raíz de código** y el inventario
**reclama su motivo**.

**La decisión sobre `public/`: entra al censo.** Ahí vive **`public/sw.js`** —360 líneas,
**desplegado**, registrado en `app/layout.tsx`, con su `addEventListener("push", …)`—, que es el
sitio **idiomático** de un segundo `pushManager.subscribe()`: el manejador de
`pushsubscriptionchange` es la receta estándar para re-suscribir, y ahí no hay ninguna comprobación
de permiso. Hoy `sw.js` no lo tiene —medido—; el defecto era que **la guardia no lo vería**, que es
el mismo enunciado que hizo bloqueante a B1.

**Y si mañana aparece un `.js` de terceros minificado en `public/`:** el motivo de la entrada deja
escrito qué hacer — **declarar ese archivo con su porqué**, como `use-mobile` declara su `subscribe`,
**no aflojar la aguja**. Los artefactos de build no entran: viven en `.next/` y `.vitest/`, que son
dot-dirs y ya se ignoraban, y `node_modules` sigue excluido por nombre. Medido: las únicas raíces que
la aguja nueva añade son `public/` (1 archivo), cuatro `.mjs` en `scripts/` y dos en la raíz.

## 12.3 Los intrusos, contra el árbol de verdad

Escritos en los archivos, suite de guardias entera, revertidos con SHA256. **J0 es el control.**

| # | Intruso | Veredicto | Qué se puso rojo |
| --- | --- | --- | --- |
| **J0** (control) | La aguja vuelve a ser solo `.ts/.tsx` | **CAZADO** (exit 1) | 5 casos, entre ellos `public/sw.js está DENTRO del censo` en **las dos** guardias y `el censo llega a las NUEVE raíces` |
| **J1** | **El de la re-revisión, tal cual**: `adios-legacy.js` con la llamada **sin motivo**, importado desde un componente ya montado | **CAZADO** (exit 1) · `tsc 0`, `lint 0` | `NADIE MÁS del árbol censado trae ese módulo` · `ningún archivo de NINGUNA raíz censada se sale de la lista blanca` · `B3: un módulo .js dentro de una raíz censada tampoco se escapa` |
| **J2** | **Otra extensión**: un `.mjs` en `scripts/`, con alias | **CAZADO** (exit 1) | 3 casos, incluido `B3: y lo mismo con un .mjs` |
| **J3** | **El agujero concreto**: `pushsubscriptionchange` re-suscribiendo en `public/sw.js` | **CAZADO** (exit 1) | `B3: public/sw.js está en el censo, y su contenido se LEE` · `el censo del NOMBRE DEL MÉTODO cuadra con la lista blanca` · `el del CANAL sigue siendo exactamente uno` (+2 de las guardias de la 410 sobre `sw.js`, que también lo ven) |
| **J4** | Un `.jsx` con `const { requestPermission } = Notification` | **CAZADO** (exit 1) | `una sola aparición, y está en activar()` |

**Cinco de cinco, y el control murió.** Los cinco con `TSC_EXIT=0`: a ninguno lo caza el compilador.

## 12.4 `m3` y su recaída, cerrados

El reviewer señaló dos autocomprobaciones que **enrojecían en cadena** por usar un archivo real como
lienzo. Se pasaron a **lienzos sintéticos** (`providers/__lienzo-…__.tsx`,
`components/shared/__lienzo-alias__.tsx`), conservando sobre el archivo **real** la única afirmación
que lo necesita: que está censado y es alcanzable.

Y al medir J4 apareció **una recaída de la misma familia que él no había visto**: el caso del
`providers/` comparaba la lista **literal** de archivos que piden el permiso, así que un intruso en
*cualquier* raíz lo ponía rojo. Ahora **mide el delta** —qué aparece de más al inyectar el lienzo—.
Comprobado: J4 pasa de 3 rojos a 2, y el que queda es la noticia (el censo) más una guardia ajena
que caza legítimamente un componente inalcanzable.

## 12.5 `m2` — límite declarado, no arreglado

Un barril en `tests/fixtures/` que reexporte la baja, importado **con alias** desde producción, pasa
el censo. **No se cierra, y queda escrito en el motivo de `tests/`** con la redacción corregida: lo
que `tests/` no puede hacer es **desplegarse por sí sola**; reexportada **sí viaja**. Se acepta
porque exige **dos** actos deliberados (que producción importe de `@/tests/` y que además renombre) y
porque ahí **el tipo sí conserva su mitad** — el contraste exacto con B3, donde no la conservaba.

## 12.6 Gate completo, tercera vuelta

```
✓ typecheck paso
✓ lint paso
 Test Files  1950 passed (1950)
      Tests  28357 passed | 26 skipped (28383)
   Duration  586.78s
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1950 ejecutado(s), todos en el baseline conocido)
== init OK ==
INIT_EXIT=0
```

`INIT_EXIT=0` escrito **dentro** del log (`scratchpad/gate422_4.log`). Los `skipped` siguen siendo
los 26 de siempre —`AnaliticaPage` 17 + `AnaliticaShell` 9— y **cero de `tests/integration/db/`**
(`grep -c`: 0).

**28.351 → 28.357**: los seis casos nuevos de B3 (los canarios de `public/sw.js` y las dos
extensiones en las dos guardias). Ni un archivo de test perdido, ni un `baseline-rojos.json` tocado,
ni una línea de código de producción.

> **No perseguí `impresion-flujo` ni `factura-contraste`**, los dos rojos no reproducibles que el
> reviewer vio en una corrida: son de la ficha 223 y en este gate salen verdes.

---

## Los límites declarados, en un solo sitio

Tres, y los tres con su caso o su motivo escrito en el árbol:

1. **Especificador compuesto en ejecución** (`import("@/lib/pwa/" + "baja-push")`). No lo ve ninguna
   guardia de texto. El tipo **sí** defiende: el motivo sigue siendo obligatorio. *Aceptado por el
   reviewer.*
2. **Re-export desde `tests/` importado con alias.** Dos actos deliberados; el tipo **sí** defiende.
   *Declarado en el motivo de la entrada `tests`.*
3. **`tests/` fuera del censo.** Es el único sitio con razón legítima para nombrar lo prohibido;
   censarla convertiría a las guardias en infractoras.

**B3 no era un límite de esta familia**, y por eso se arregló en vez de declararse: el acto es
ordinario y el tipo **no** defendía.

---

## Veredicto

Tandas 1-4 implementadas y verificadas. Las tres vías que la revisión encontró —raíz no censada,
nombre local renombrado, extensión no leída— están cerradas **por la propiedad**: las raíces se
derivan del disco y hay que declararlas, el censo persigue el módulo y no el identificador, y
«archivo de código» ya no depende de una aguja copiada cuatro veces. Once intrusos reaplicados
contra el árbol real en dos rondas, once cazados, dos controles muertos, y los tres huecos que
quedan están escritos con su porqué.
