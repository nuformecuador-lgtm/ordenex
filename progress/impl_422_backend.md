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
specs/422-preferencia-push-recordada/tasks.md      (casillas de T1.1–T4.3)
```

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

PENDIENTE_GATE

### 9.4 Las mutaciones

PENDIENTE_MUTACIONES

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

## Veredicto

Tandas 1-4 implementadas y verificadas: la preferencia vive aparte del dispositivo, toda baja declara
su motivo y el compilador impide que una superficie nueva se lo salte; 410/R19 sigue intacto y hay un
test contra Postgres que se pone rojo si alguien lo erosiona.
