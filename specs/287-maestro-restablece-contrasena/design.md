# Feature 287 — Diseño

> Lee primero `requirements.md`. Aquí solo está el CÓMO, y por qué se descartó lo demás.

## §1 — Forma de la solución en una frase

Una operación nueva en el servicio de usuarios que ya es exclusivo del maestro: genera una
contraseña con el generador del alta, **primero** borra todas las sesiones del usuario
objetivo, **después** guarda el hash, y devuelve la contraseña en claro **una sola vez** en
el resultado de esa llamada. Sin migración, sin correo, sin campo de contraseña.

## §2 — Lo que YA existe y se reusa (medido en `dev`, 2026-08-26)

| Pieza | Dónde | Qué aporta aquí |
| --- | --- | --- |
| `ALLOWED_ROLES = new Set(["maestro"])` | `lib/services/UsuarioService.ts:35` | La autorización. **No se crea ninguna nueva** (R3). |
| `generateStrongPassword()` | `lib/utils/password-generator.ts:45` | La generación (R8). Valida su propia salida contra `strongPasswordSchema` antes de devolverla (R9). |
| `hashPassword()` | `lib/utils/password.ts:6` | bcrypt, 10 rondas (R12). |
| `updatePasswordHash(usuarioId, hash)` | `IUserRepository.ts:139` → `UserRepository.ts:98` | La escritura. Actualiza SOLO `password_hash` y no devuelve el hash — ya probado por `tests/integration/user-repository-update-password.test.ts` (R12/R14). |
| El camino de `generatedPassword` del alta | `UsuarioService.ts:116-118` → `IUsuarioService.ts:21` → `lib/types/usuario.ts:136` → `UsuarioForm.tsx:314-345` | El molde de «mostrar una vez» que se calca (R21/R28). |
| `resolveActorFromSession()` | `lib/auth/resolve-actor.ts:15` | Actor `{ usuarioId, rol, zonaId }`. `usuarioId` es lo que hace comprobable R5. |
| `withErrorHandler` + `toActionError` | `lib/errors`, `lib/actions/_shared/to-action-error.ts` | El borde de la Server Action, idéntico al resto del módulo. |
| `crearPrismaDeTest` / `enTransaccionRevertida` / `serializarEscriturasReales` | `tests/integration/db/_postgres-real.ts` | El único arnés honesto para probar que el hash **se guarda de verdad** (R13). |

## §3 — Relación con `PasswordResetService` (feature 20): **independiente**

Se leyó entero antes de diseñar. **No se toca, no se llama, no se extiende.**

| | Reset por correo (feature 20) | Restablecimiento por el maestro (287) |
| --- | --- | --- |
| Quién actúa | el propio usuario, anónimo | el maestro, autenticado |
| Prueba de identidad | OTP por correo (`email_otp_challenge`) | sesión + rol `maestro` |
| Quién elige la contraseña | el usuario la escribe | la genera el sistema |
| Dependencia de SMTP | total | **ninguna** (R38) |
| Respuestas | genéricas, para no filtrar si un email existe | específicas (`not_found`), porque el actor ya es el administrador |

Lo único compartido son dos primitivas que ya eran compartidas antes de esta ficha:
`hashPassword` y `IUserRepository.updatePasswordHash`. Reusar `PasswordResetService`
obligaría a emitir y consumir un desafío OTP artificial (con envío de correo incluido) para
un flujo que no tiene ni usuario anónimo ni correo: ver alternativa descartada **A2**.

## §4 — Modelo de datos

**No hay migración. No hay tabla ni columna nueva.** Esta ficha solo escribe en dos tablas
que ya existen:

| Tabla | Operación | Nota |
| --- | --- | --- |
| `usuario` | `UPDATE ... SET password_hash = $1 WHERE id = $2` | Vía `updatePasswordHash`, que ya existe. RLS habilitada desde `20260708212416_login_usuario_rba`. |
| `Session` | `DELETE FROM "Session" WHERE "userId" = $1` | Método nuevo de repositorio (no de esquema). |

Dos hechos medidos sobre `Session`, que se anotan porque afectan a decisiones y no se
inventan soluciones para ellos en esta ficha:

1. **`Session.userId` no tiene índice.** Medido en `db/migrations/20260709194415_add_session_table/migration.sql`:
   la tabla se crea con la PK y nada más. Un `deleteMany` por `userId` es un recorrido
   secuencial. Se acepta: el restablecimiento es una acción manual y rara, no una ruta
   caliente ni un cron (el anti-patrón de `docs/architecture.md` habla de esas dos). **Antes
   de desplegar se mide** el número de filas de `Session` en producción y se deja escrito
   (tarea T14); si resultara ser grande, el índice es una ficha aparte con su migración —
   añadirlo aquí obligaría además a la corrida completa del gate por tocar el esquema.
2. **`Session` no tiene RLS.** También medido: no aparece en ningún `ENABLE ROW LEVEL
   SECURITY` de `db/migrations/**`. Es un hallazgo previo a esta ficha (la tabla es
   preexistente al bloque de migraciones que activó RLS en el resto) y **esta ficha no lo
   cambia ni lo empeora**: se accede exactamente por donde ya se accedía, desde el servidor.
   Queda anotado como riesgo RS3 para una ficha de seguridad propia.

## §5 — Capas y flujo

```
app/(app)/configuracion/_components/UsuariosModule.tsx      ← confirmación + panel de una vez
  ↓ Server Action
lib/actions/usuarios.ts  ·  restablecerContrasenaUsuario(id)
  ↓ (resolveActorFromSession + zod en el borde)
lib/services/UsuarioService.ts  ·  restablecerContrasena(id, actor)
  ├─ ALLOWED_ROLES        (R2/R3)   ← el MISMO Set, no una copia
  ├─ repo.findById        (R4)
  ├─ actor.usuarioId===id (R5)
  ├─ generateStrongPassword + hashPassword   (R8/R9)
  ├─ sessionRepo.deleteAllByUserId(id)       (R11/R16) ← PRIMERO
  └─ repo.updatePasswordHash(id, hash)       (R12)     ← DESPUÉS
```

### Por qué revocar antes de guardar el hash (R11)

Los dos pasos no son atómicos (dos tablas, dos llamadas). El orden decide qué queda si el
proceso muere en medio:

| Orden | Si falla el 2.º paso | Veredicto |
| --- | --- | --- |
| hash → revocar | contraseña rotada **y sesiones vivas**: quien tuviera una sesión sigue dentro, y el legítimo ya no puede entrar sin la contraseña nueva | estado **más permisivo**: inaceptable |
| **revocar → hash** | sesiones cerradas y contraseña sin rotar: nadie gana acceso, el maestro reintenta | estado **más restrictivo**: es el elegido |

El coste del orden elegido es que un fallo intermedio cierra sesiones sin haber cambiado
nada. Es un coste barato y visible (el usuario vuelve a entrar con su contraseña de siempre
si aún la tiene) frente a la alternativa, que es una falsa sensación de revocación.

## §6 — Contratos de entrada/salida

**Repositorio de sesiones** — `lib/interfaces/repositories/ISessionRepository.ts`:

```ts
/** Feature 287/R16: borra TODAS las sesiones del usuario. Devuelve cuántas borró (R19). */
deleteAllByUserId(userId: string): Promise<number>;
```

Implementación en `SessionRepository`: `deleteMany({ where: { userId } })`, devolviendo
`count`. Idempotente por construcción: cero filas es un `0`, no un error.

> Añadir un método a `ISessionRepository` **rompe por typecheck** los dos objetos literales
> que hoy la implementan en test (`tests/unit/services/auth-service.test.ts:75` y
> `tests/unit/services/postulacion-login-regresion.test.ts:69`). Que rompan es la señal
> correcta, no un daño colateral: se actualizan (tarea T3).

**Servicio** — `lib/interfaces/services/IUsuarioService.ts`:

```ts
export type RestablecerContrasenaServiceResult =
  | { status: "ok"; usuarioId: string; generatedPassword: string; sesionesRevocadas: number }
  | { status: "forbidden" }        // R2
  | { status: "not_found" }        // R4
  | { status: "self_reset_forbidden" }; // R5

restablecerContrasena(id: string, actor: Actor): Promise<RestablecerContrasenaServiceResult>;
```

`generatedPassword` es **obligatorio** en la rama `ok` y **no existe** en ninguna otra rama:
es el tipo el que impide devolverla junto a un error (R15).

**Borde** — `lib/types/usuario.ts` + `lib/actions/usuarios.ts`:

```ts
export type RestablecerContrasenaResult =
  | { status: "ok"; usuarioId: string; generatedPassword: string; sesionesRevocadas: number }
  | { status: "self_reset_forbidden" }
  | ActionError;                    // unauthenticated | forbidden | not_found | validation_error

export async function restablecerContrasenaUsuario(
  id: unknown,
  deps: UsuarioActionDeps = {},
): Promise<RestablecerContrasenaResult>;
```

- La firma **solo recibe el identificador**. No hay objeto de entrada, luego no hay dónde
  meter una contraseña (R6/R10): la ausencia del parámetro es la garantía, no una validación
  que alguien pueda relajar. El `id` se valida con el mismo `idSchema` que las demás acciones.
- La inyección `deps` sigue el patrón exacto de las otras seis acciones del archivo.

**Inyección del revocador.** `UsuarioService` recibe un cuarto parámetro opcional
`sessionRepo?: Pick<ISessionRepository, "deleteAllByUserId">`, para no romper las decenas de
`new UsuarioService(repo)` de los tests existentes. **Opcional en el constructor, obligatorio
en el uso**: si `restablecerContrasena` se invoca sin él, lanza (R20). Ese `throw` es
deliberado y va acompañado de un test sobre el composition root (`buildUsuarioService`) que
comprueba que **alguien lo pasa de verdad** — un servicio que acepta un colaborador opcional
y sigue adelante sin él es exactamente el modo de fallo que ya costó notificadores muertos
con la suite en verde en este repo.

## §7 — Decisiones

### D1 — La operación vive en `UsuarioService`, no en un servicio nuevo

Porque la autorización es literalmente la misma constante (`ALLOWED_ROLES`, R3). Un servicio
aparte tendría que declarar su propia lista de roles, y ese es el sitio exacto por donde
empieza una divergencia de permisos. Ver alternativa descartada **A1**.

### D2 — Sesiones activas: **se revocan todas** (R16)

1. El restablecimiento es hoy **la única** vía para devolver el acceso (SMTP caído), así que
   también es la única palanca del maestro cuando la causa no es un olvido sino una sospecha
   (una cuenta compartida, alguien que se fue, un teléfono perdido). Si la sesión sobrevive,
   el maestro cree haber cortado el acceso y no ha cortado nada.
2. La sesión es un **portador de acceso**: una cookie con el `id` de la fila de `Session`
   basta para actuar como esa persona hasta `AUTH_SESSION_TTL_HOURS` (24 h por defecto,
   `lib/config/auth.ts:41`). Rotar la contraseña sin borrar sesiones deja un agujero de hasta
   24 horas en el que la contraseña vieja «sigue sirviendo» en la práctica.
3. El coste es exactamente el esperado por quien pulsa el botón: cerrar la sesión de la
   persona a la que le estás restableciendo la contraseña **es** lo que significa
   restablecer.

### D3 — Dispositivos de confianza: **no se tocan** (R18)

Aquí la respuesta intuitiva («si revocas, revoca todo») es la equivocada, y se puede
demostrar con las cifras que ya están en el código:

- `RiskEngine` (`lib/services/RiskEngine.ts:12-14`): dispositivo no reconocido **+40**, IP no
  reconocida **+30**, fallos consecutivos recientes **+40**.
- Umbral: `RISK_THRESHOLD = 50` (`lib/config/auth.ts:43`).
- Por encima del umbral, `AuthService` **no concede sesión**: emite un OTP **por correo**
  (`AuthService.ts:131-137`). Y el correo está caído.

Ahora el caso real: alguien que perdió su contraseña casi con seguridad acaba de fallar
varios ingresos, así que llega con **+40 de fallos recientes**. Con su dispositivo de
confianza intacto suma 40 < 50 y entra con la contraseña nueva. **Si le borramos el
dispositivo, suma 80 ≥ 50 → OTP por correo → correo caído → no entra.** Borrar dispositivos
de confianza dejaría fuera justo a la persona a la que esta feature existe para dejar entrar.

Y el beneficio que se pierde es pequeño: **un dispositivo de confianza no es una credencial**.
No abre nada por sí solo; solo evita el segundo factor a quien **ya presentó la contraseña
correcta** — que tras el restablecimiento es la nueva, que solo el maestro ha visto.

La línea queda así, y es una regla que se puede repetir: **se revoca lo que porta acceso
(sesiones), no lo que solo puntúa riesgo (dispositivos)**.

### D4 — El maestro no se restablece a sí mismo (R5)

Revocar las sesiones del propio actor a mitad del flujo puede tumbarle la sesión antes de que
copie la contraseña que solo se muestra una vez (R21), y si es el único maestro se queda
fuera del sistema con el correo caído. Un maestro con sesión abierta no ha perdido su
contraseña en el sentido que esta ficha resuelve. La alternativa (preservar la sesión que
hace la petición) está en **A4**, y la consecuencia aceptada está en la pregunta abierta 1.

### D5 — La contraseña generada se muestra una vez y no se guarda en ningún sitio

Calcado del alta: el servicio devuelve el claro **solo** en la rama `ok`; el cliente lo pone
en un estado de React efímero y lo pinta en un panel de solo lectura con botón de copiar. Al
cerrar el panel el estado se descarta. No se guarda en `localStorage`, ni en SWR, ni en una
cookie, ni se vuelve a pedir (R24/R29). El panel se monta en un archivo nuevo
(`ContrasenaGeneradaPanel.tsx`) porque el molde existente vive dentro de `UsuarioForm.tsx`,
que es de la ficha 286 y no se toca aquí; la duplicación de maqueta es deuda **consciente y
anotada** (pregunta abierta 4).

### D6 — Sin auditoría, y dicho en voz alta

No existe tabla de rastro de acciones administrativas y esta ficha no la crea (no está en el
alcance firmado). Consecuencia: un restablecimiento **no deja constancia**. Es la pregunta
abierta 3 y el riesgo RS4.

## §8 — Alternativas descartadas

- **A1. Un `RestablecerContrasenaService` propio.** Descartada: tendría que declarar su
  propia lista de roles autorizados, y dos listas de permisos para el mismo módulo divergen
  en cuanto alguien toque una. Reusar `UsuarioService` hace que R3 sea comprobable de
  verdad (el mismo `Set`, no «uno igual»). El coste —que `UsuarioService` crezca un método
  más y un colaborador más— es menor que el de duplicar una decisión de permisos.

- **A2. Reusar `PasswordResetService` emitiendo un OTP y consumiéndolo en nombre del
  maestro.** Descartada por dos motivos, cada uno suficiente: (a) emitir un desafío dispara
  un envío de correo, y el correo es exactamente lo que está roto (R38); (b) obligaría a que
  el maestro conociera o esquivara un código pensado como prueba de que *el propio usuario*
  lee su buzón, degradando el significado de ese servicio para todos sus usuarios actuales.
  Se deja **intacto** (§3).

- **A3. Que el maestro escriba la contraseña (la petición original, antes de acotarla).**
  Descartada por el propio humano en el mismo mensaje, y es la decisión que sostiene toda la
  ficha: una contraseña elegida por el administrador es una credencial que él conoce y puede
  reusar sin dejar rastro, y es justo lo que la Decisión 5 protegía. Con generación, ni
  siquiera el maestro puede *elegir* qué credencial queda: solo verla una vez.

- **A4. Permitir el auto-restablecimiento preservando la sesión del actor.** Descartada por
  coste/beneficio: exige bajar el `sessionId` de la cookie hasta el servicio (hoy
  `resolveActorFromSession` devuelve el actor sin él), y crea una excepción en la regla
  «se revocan TODAS» que habría que probar y mantener. Beneficio real medido: cero casos
  operativos hoy (un maestro con sesión abierta no ha perdido su contraseña). Ver la
  consecuencia aceptada en la pregunta abierta 1.

- **A5. Ejecutar los dos escritos en una transacción.** Descartada: obligaría a crear un
  método de repositorio nuevo que escribiera en `usuario` **y** en `Session` a la vez,
  mezclando dos repositorios en una unidad de trabajo solo para esta operación, y dejaría sin
  usar el `updatePasswordHash` que el humano pidió reusar. El orden revocar→hash (§5) resuelve
  el mismo problema —que ningún estado intermedio sea más permisivo— sin ampliar la superficie.

- **A6. Añadir `passwordHash` a `UpdateUsuarioData` y restablecer desde la edición.**
  Descartada: sería revertir la Decisión 5 **entera** en vez de solo su cláusula de alcance, y
  convertiría un campo que hoy es imposible de tocar por error en uno más del formulario. La
  operación separada mantiene el invariante de R35 y hace que el acto sea explícito y
  confirmable (R26).

- **A7. Añadir un índice a `Session.userId` en esta ficha.** Descartada: obliga a migración
  (con su `down.sql`), fuerza el gate completo por tocar `db/schema.prisma` y resuelve un
  problema que todavía nadie ha medido. Primero se mide (T14); si hace falta, ficha propia.

- **A8. Marcar al usuario para que cambie la contraseña en su siguiente ingreso.**
  Descartada por decisión explícita del humano (fuera de alcance, R36). Se registra en §12
  como riesgo RS1 en vez de colarla en el alcance.

## §9 — Cómo queda documentada la reversión de la Decisión 5

Tres soportes, porque una decisión revertida envejece por separado en cada uno. El molde es
`tests/unit/guards/d5-revertida.guardia.test.ts` (feature 261), que este repo ya usó para
exactamente este problema.

1. **El código** — `lib/interfaces/repositories/IUserRepository.ts`. El comentario de la
   línea 98 **no se borra**: se amplía con la nota de reversión (R32) y, junto a
   `updatePasswordHash` (línea 139), se apunta que ahora también la usa el maestro. Borrador
   del texto (el implementer ajusta la redacción, no las piezas):

   > `// Feature 25/R16: solo los campos editables por el maestro. NUNCA email, cedula ni`
   > `// passwordHash (Decision 5, firmada el 2026-07-10).`
   > `//`
   > `// ⚠️ DECISION 5 — ACOTADA Y PARCIALMENTE REVERTIDA EL 2026-08-26 (feature 287,`
   > `// specs/287-maestro-restablece-contrasena). Se revierte SOLO su clausula de alcance`
   > `// («Reset de contrasena desde edicion: FUERA de alcance»): el maestro YA PUEDE`
   > `// RESTABLECER la contrasena de un usuario. NO se revierte lo demas, y el motivo`
   > `// original queda protegido: el maestro no ESCRIBE ninguna contrasena —el sistema la`
   > `// genera y se muestra una sola vez—, asi que sigue sin poder fijar una credencial que`
   > `// conozca de antemano. Este tipo (`UpdateUsuarioData`) sigue SIN admitir email, cedula`
   > `// ni passwordHash: el restablecimiento va por `updatePasswordHash`, no por `update`.`

2. **El spec de la 25** — `specs/25-gestion-usuarios/requirements.md` y `design.md`: apéndice
   fechado que apunta a esta ficha, **sin tocar una coma del texto original** (R33). Un spec
   es la foto de su momento; reescribirlo «para que quede coherente» borra la prueba de que
   aquella decisión se tomó a conciencia.

3. **Una guardia** — `tests/unit/guards/decision5-revertida.guardia.test.ts`, calcada de la
   d5 de la 261: comprueba (a) que el contrato lleva las siete piezas de R32 por separado,
   (b) que el texto original de la Decisión 5 sigue VERBATIM en el spec de la 25, (c) que el
   apéndice existe con fecha y puntero, y (d) que no queda en el árbol ninguna frase que
   afirme que el maestro no puede tocar la contraseña (R34). Con autocomprobación: cada
   detector se prueba contra un texto que SÍ infringe y otro que no, o la guardia se queda
   verde por vacía en cuanto un rename deje de encajar.

## §10 — Verificación: qué mutación mata cada test clave

| Requisito | Test | Mutación que lo mata |
| --- | --- | --- |
| R2/R3 | `usuario-service` · rol no maestro → `forbidden` sin tocar repos | cambiar el guard por `if (actor.rol === "invitado")` o borrarlo: el test ve la llamada al repo. |
| R5 | `usuario-service` · actor = objetivo → `self_reset_forbidden` | quitar la comparación `actor.usuarioId === id`: pasa a devolver `ok`. |
| R8/R9 | `usuario-service` · la contraseña devuelta pasa `strongPasswordSchema` | sustituir `generateStrongPassword()` por un literal débil. |
| R11 | `usuario-service` · con `updatePasswordHash` que rechaza, `deleteAllByUserId` YA se llamó | invertir el orden de las dos llamadas: el test lo caza. |
| R11 | `usuario-service` · con `deleteAllByUserId` que rechaza, `updatePasswordHash` NO se llama | mover la revocación después del hash. |
| **R12/R13** | **integración con Postgres real**: restablecer y leer `password_hash` de la fila; `verifyPassword(mostrada, hash) === true` y `verifyPassword(anterior, hash) === false` | guardar el claro en vez del hash; guardar el hash de otra cosa; escribir en otra fila (`where` mutado). **Un test con dobles sobrevive a las tres.** |
| R14 | mismo test de integración: el resto de columnas de la fila no cambia | añadir cualquier otro campo al `data` del update. |
| R16/R17 | integración: dos usuarios con sesiones; tras restablecer a uno, las suyas son 0 y las del otro siguen | mutar el `where` de `deleteMany` a `{}` (borra todas) o a un id fijo. **El servicio con dobles no ve ese `where`.** |
| R18 | integración: el `trusted_device` del objetivo sigue existiendo tras el restablecimiento | añadir un borrado de dispositivos: el test se pone rojo. |
| R19 | `usuario-service` · `sesionesRevocadas` es lo que devolvió el repo | devolver `0` fijo. |
| R20 | `usuario-service` · sin `sessionRepo` inyectado, la llamada lanza y NO llama a `updatePasswordHash` | «arreglarlo» con un `if (!this.sessionRepo) return ok`: el test exige el fallo visible. |
| R20 | composition root: `buildUsuarioService()` construye con un `SessionRepository` real | borrar el argumento en `lib/actions/usuarios.ts`: el test lo caza aunque el import siga ahí. |
| R21/R22 | guardia de superficie: `generatedPassword` solo aparece en el tipo de resultado del restablecimiento y del alta | añadirlo a `UsuarioPublico`, `UsuarioListItem` o al DTO de descarga. |
| R23 | test de humo: se espían **todos** los métodos de `console` durante un restablecimiento completo y ninguno recibe un texto que contenga la contraseña | meter un `console.log(plain)` en cualquier capa del camino. |
| R23 | guardia estática: censo cerrado de los archivos del camino, prohibido `console.*` | igual que arriba, pero además caza el que nadie ejecuta en test. |
| R6/R10 | `usuarios.test` (acción) · la firma no admite payload; un `id` inválido → `validation_error` | ampliar la firma con un segundo parámetro de entrada: el test de tipos/forma falla. |
| R26/R27 | componente: sin confirmar no se llama a la acción; al confirmar se llama una vez | ejecutar la acción en el `onClick` del botón de la fila. |
| R28/R29 | componente: la contraseña aparece una vez; al cerrar, no hay ningún control que la reponga | dejar el valor en un estado que sobreviva al cierre del panel. |
| R32/R33/R34 | guardia `decision5-revertida` | borrar el comentario de reversión, reescribir el spec 25, o dejar la frase caducada en el árbol. |
| R37/R38 | `usuario-service` · el flujo completo sin ningún cliente de correo inyectado, y ningún emisor de notificación llamado | añadir un envío de aviso: el test se pone rojo (y así R37 no se pierde por olvido). |

**Regla que atraviesa la tabla:** todo lo que es una afirmación sobre **el SQL** (qué fila se
actualiza, qué filas se borran, qué no se toca) se prueba **donde vive**, contra Postgres. Un
test de servicio con dobles pasa en verde con el `WHERE` mutado — medido cuatro veces en este
repo. Y el test de integración **debe reventar** si los catálogos que necesita no están
sembrados: un `if (!datos) return;` reporta `passed` sin haber comprobado nada.

## §11 — Colisión con otras fichas y orden

| Archivo | 285 | 286 | 287 |
| --- | --- | --- | --- |
| `lib/actions/usuarios.ts` | ✏️ | — | ✏️ |
| `lib/services/UsuarioService.ts` | ✏️ | — | ✏️ |
| `app/(app)/configuracion/_components/UsuariosModule.tsx` | ✏️ | — | ✏️ |
| `lib/types/usuario.ts` | ✏️ | — | ✏️ |
| `app/(app)/configuracion/_components/UsuarioForm.tsx` | — | ✏️ | **NO** |

**La implementación de la 287 va DESPUÉS de que la 285 esté en `dev`.** Escribir este spec no
molesta a nadie; tocar esos cuatro archivos en paralelo sí. Con la 286 no hay colisión: no
comparten un solo archivo, y esta ficha no tiene ningún input de contraseña al que ponerle
el ojito.

**El gate:** esta feature toca `lib/types/usuario.ts`, y `lib/types/**` está en la lista por
la que `./init.sh --rapido` **se niega** (`docs/verification.md`). El gate de esta ficha es
`./init.sh` **completo**, y no es opcional.

## §12 — Riesgos

- **RS1 — Nadie avisa al usuario, y nada le obliga a cambiarla.** Fuera de alcance por
  decisión del humano (R36/R37). Consecuencia real: la contraseña que el maestro vio en
  pantalla **sigue siendo válida indefinidamente** y el maestro la conoce. Mitigación
  disponible sin código: que el maestro se la entregue por un canal directo y le pida
  cambiarla; el flujo de recuperación por correo servirá para eso **cuando el SMTP vuelva**.
  Se deja escrito para que la decisión sea revisable, no para colarla en el alcance.
- **RS2 — Ventana del desafío OTP pendiente.** Un desafío vivo mina sesión sin volver a pedir
  la contraseña (`AuthService.verifyChallenge`), así que puede convertirse en sesión hasta
  `AUTH_OTP_TTL_MINUTES` (10 min) después del restablecimiento, pese a R16. Requiere que
  alguien esté a mitad de un ingreso justo en ese instante. Pregunta abierta 2.
- **RS3 — `Session` sin RLS.** Hallazgo previo, medido en las migraciones; esta ficha no lo
  introduce ni lo agrava. Ficha de seguridad aparte.
- **RS4 — Sin rastro de quién restableció qué.** Pregunta abierta 3.
- **RS5 — Maqueta duplicada del panel «una sola vez»** mientras la 286 tenga tomado
  `UsuarioForm.tsx`. Pregunta abierta 4.
- **RS6 — Un maestro logueado no puede rotar su propia contraseña** por ninguna vía mientras
  el correo esté caído (consecuencia de D4). Pregunta abierta 1.
