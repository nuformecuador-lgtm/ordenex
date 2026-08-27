# Feature 287 — bitácora de implementación (BACKEND)

> **Alcance de esta bitácora:** la parte **backend** de la ficha (T1–T8, T11, T12, T13, T14).
> El **frontend (T9, T10) NO está hecho** y no lo hace este agente: lo monta otro sobre este
> trabajo. Los requisitos de interfaz **R25–R31 quedan SIN cubrir** a propósito, y así se
> declaran abajo. Un mapa `R1..R38 → test` que los diera por buenos sería falso.

- **Rama:** `worktree-agent-a52bf1f556dfead28` (worktree aislado, parte de `origin/dev` @ `b9422108`)
- **Fecha:** 2026-08-26

---

## 1. Lo que hay que leer antes que nada: **T0 NO se cumplió**

`tasks.md` abre con una precondición explícita:

> **T0** — Comprobar que la **feature 285 está mergeada en `dev`** y rebasar sobre ella. […]
> Si la 285 no está, la ficha **no arranca**: se dice y se espera.

**La 285 no está en `dev`.** Medido, no supuesto: `origin/dev` @ `b9422108` no contiene
`specs/285-usuarios-filtro-y-buscador`, su `feature_list.json` termina en el id **284**, y no
existe ninguna rama remota `*285*`. Se implementó igualmente porque el encargo del agente que
lanzó esta tarea lo pedía de forma explícita y acotada.

**Qué significa el riesgo, en concreto.** No es un problema de corrección —lo implementado es
correcto y está verificado— sino de **merge**: según `design.md` §11, la 285 escribe en tres de
los archivos que esta tanda toca (`lib/actions/usuarios.ts`, `lib/services/UsuarioService.ts`,
`lib/types/usuario.ts`). Quien mergee segundo resuelve conflictos a mano. Conviene decidir el
orden antes de abrir los PR.

## 2. Segundo aviso: **el spec 287 no está en el repositorio**

`specs/287-maestro-restablece-contrasena/{requirements,design,tasks}.md` existe **solo como
archivos sin commitear en el checkout compartido** (`R:\job\singularis\projects\ordenex\specs\`).
No está en `origin/dev` ni en ninguna rama remota, y por eso no está en este worktree.

Se leyó entero desde el checkout compartido y se implementó al pie de la letra, pero **no se
commitea aquí**: es trabajo en curso de otro agente y copiarlo podría pisarlo.

**Consecuencia que hay que cerrar antes del merge:** el código y la guardia nueva apuntan a
`specs/287-maestro-restablece-contrasena` (lo exige R32(g)). Si ese directorio nunca llega al
repositorio, el puntero apunta a nada. La guardia no lo detecta —comprueba que la cadena esté
escrita, no que la ruta exista—, así que esto depende de una decisión humana, no de un test.

---

## 3. Archivos

### Creados

| Archivo | Qué es |
| --- | --- |
| `tests/unit/services/usuario-restablecer-contrasena.test.ts` | El servicio, con dobles (T6) |
| `tests/unit/actions/usuarios-composition.test.ts` | El composition root **pasa** el revocador (T8) |
| `tests/integration/db/restablecer-contrasena-sql-real.test.ts` | Lo que solo Postgres prueba (T11) |
| `tests/unit/guards/decision5-revertida.guardia.test.ts` | La reversión de la Decisión 5 (T12) |
| `tests/unit/guards/contrasena-generada-superficie.guardia.test.ts` | La superficie del secreto (T13) |

### Modificados

| Archivo | Qué cambió |
| --- | --- |
| `lib/interfaces/repositories/ISessionRepository.ts` | `deleteAllByUserId(userId): Promise<number>` (T1) |
| `lib/repositories/SessionRepository.ts` | Implementación con `deleteMany({ where: { userId } })` (T2) |
| `lib/interfaces/services/IUsuarioService.ts` | `RestablecerContrasenaServiceResult` + método (T4) |
| `lib/types/usuario.ts` | `RestablecerContrasenaResult` (T5) — **el archivo que obliga al gate completo** |
| `lib/services/UsuarioService.ts` | `restablecerContrasena` + 4.º parámetro de constructor (T6) |
| `lib/actions/usuarios.ts` | `restablecerContrasenaUsuario` + cableado del `SessionRepository` (T7/T8) |
| `lib/interfaces/repositories/IUserRepository.ts` | Nota de reversión de la Decisión 5, sin borrar la original (T12a) |
| `specs/25-gestion-usuarios/requirements.md` | Apéndice fechado; texto original intacto (T12b) |
| `specs/25-gestion-usuarios/design.md` | Apéndice: el «reset futuro» de A6 ya existe (T12b) |
| `tests/unit/services/auth-service.test.ts` | Doble de `ISessionRepository` actualizado (T3) |
| `tests/unit/services/postulacion-login-regresion.test.ts` | Ídem (T3) |
| `tests/unit/repositories/session-repository.test.ts` | Dos casos para `deleteAllByUserId` (T2) |
| `tests/unit/actions/usuarios.test.ts` | Bloque del restablecimiento en el borde (T7) |

### Contrato para el agente de frontend

```ts
// lib/actions/usuarios.ts
export async function restablecerContrasenaUsuario(
  id: unknown,
  deps: UsuarioActionDeps = {},
): Promise<RestablecerContrasenaResult>;

// lib/types/usuario.ts
export type RestablecerContrasenaResult =
  | { status: "ok"; usuarioId: string; generatedPassword: string; sesionesRevocadas: number }
  | { status: "self_reset_forbidden" }
  | ActionError; // unauthenticated | forbidden | not_found | validation_error
```

**Tres cosas que el frontend tiene que saber:**

1. **La acción recibe SOLO el `id`.** No hay objeto de entrada y no debe haberlo: es R6/R10.
   No existe ningún campo de contraseña que pintar.
2. **`generatedPassword` solo existe en la rama `ok`.** El tipo impide leerlo en cualquier otra;
   `self_reset_forbidden` es una negativa aparte de `forbidden` y merece su propio mensaje (R5).
3. **Hay que RETIRAR la anotación `@sin-superficie`** de `restablecerContrasenaUsuario` al
   cablear T10. Está puesta como transitoria y **la guardia de superficie se pondrá roja por
   caducada** en cuanto un módulo alcanzable importe la acción. Es la señal, no un estorbo.

---

## 4. Mapa `R<n> → test`

### Cubiertos por esta tanda (backend)

| R | Test |
| --- | --- |
| R1 | `usuarios.test.ts` › «todas las acciones rechazan sin sesion» (incluye el restablecimiento) |
| R2 | `usuario-restablecer-contrasena.test.ts` › «rol `%s` -> forbidden sin llamar a NINGUN repositorio» (5 roles) |
| R3 | ídem + «el guard NO es "que niegue a todos" — `maestro` si pasa» |
| R4 | `usuario-restablecer-contrasena.test.ts` › «not_found sin revocar ni escribir» |
| R5 | `usuario-restablecer-contrasena.test.ts` › «objetivo = actor -> self_reset_forbidden…» |
| R6 | `usuarios.test.ts` › «id $que -> validation_error sin llamar al service» (4 casos, uno con `{ password }`) |
| R7 | `usuario-restablecer-contrasena.test.ts` › «un usuario `%s` se restablece igual…» (4 estados) |
| R8 | `usuario-restablecer-contrasena.test.ts` › «cumple `strongPasswordSchema`» + «dos seguidas dan distintas» |
| R9 | ídem («cumple `strongPasswordSchema`», con el generador REAL, sin mock) |
| R10 | `usuario-restablecer-contrasena.test.ts` › «acepta EXACTAMENTE dos argumentos» + `usuarios.test.ts` › «la firma admite exactamente `(id, deps)`» |
| R11 | `usuario-restablecer-contrasena.test.ts` › los DOS casos de orden (`invocationCallOrder`, y «si revoca falla, no escribe») |
| R12 | `usuario-restablecer-contrasena.test.ts` › «el argumento NO es la contrasena…» **+** `restablecer-contrasena-sql-real.test.ts` › R12/R13 |
| R13 | `restablecer-contrasena-sql-real.test.ts` › «el hash guardado verifica la MOSTRADA, y la anterior ya no» |
| R14 | `restablecer-contrasena-sql-real.test.ts` › «ninguna otra columna cambia» (11 columnas) + el caso de servicio «no llama a `update` ni `setEstado`» |
| R15 | `usuario-restablecer-contrasena.test.ts` › R11/R15 + `usuarios.test.ts` › «`%s` llega al borde sin `generatedPassword`» (3 ramas) |
| R16 | `restablecer-contrasena-sql-real.test.ts` › «CERO sesiones» (siembra 1 caducada + 2 vivas) |
| R17 | ídem › «el otro usuario conserva las suyas» (por id, no por conteo) |
| R18 | `restablecer-contrasena-sql-real.test.ts` › «el dispositivo de confianza SIGUE existiendo» |
| R19 | `usuario-restablecer-contrasena.test.ts` › «devuelve el count (0/1/7), no un fijo» + el de Postgres |
| R20 | `usuario-restablecer-contrasena.test.ts` › «sin revocador lanza» **+** `usuarios-composition.test.ts` |
| R21 | `usuarios.test.ts` › «propaga la contrasena y el numero de sesiones» |
| R22 | `contrasena-generada-superficie.guardia.test.ts` › (b), 4 tipos de lectura + columnas de descarga + censo cerrado del árbol |
| R23 | `usuario-restablecer-contrasena.test.ts` › «ningun metodo de `console`…» + guardia (a), `console.*` completo |
| R24 | Cubierto **parcialmente**: la mitad de servidor (no se persiste el claro) es R12; la mitad de cliente (`localStorage`, cookie) es de T9/T10 y **no está** |
| R32 | `decision5-revertida.guardia.test.ts` › (a), las 7 piezas por separado + regresión M16 |
| R33 | ídem › (b) apéndice en los dos specs + (c) 3 testigos VERBATIM |
| R34 | ídem › (d) censo de código, 4 patrones, con la distinción citar/afirmar |
| R35 | `usuario-service.test.ts` (existente) sobre `actualizarUsuarioSchema.strict()` + guardia (b) sobre `UpdateUsuarioData` |
| R37 | `usuario-restablecer-contrasena.test.ts` › «el constructor no admite ningun emisor» |
| R38 | ídem › «termina en `ok` sin ningun colaborador de notificacion inyectado» |

### **NO cubiertos** — son del frontend (T9/T10), que no es de esta tanda

| R | Por qué |
| --- | --- |
| R25 | Acción por fila y ausencia de campo de contraseña en la UI |
| R26 | Modal de confirmación que nombra al usuario y advierte del cierre de sesiones |
| R27 | Cancelar no ejecuta |
| R28 | Panel de «una sola vez» con copiar |
| R29 | Al cerrar, no hay vía de volver a mostrarla |
| R30 | Error → toast sin contraseña |
| R31 | No se expone desde el alta ni la edición |
| R24 (mitad) | Que el cliente no la guarde en `localStorage`/cookie |

---

## 5. Mutaciones: **22/22 muertas**, y una que sobrevivió primero

Arnés en `scratchpad/f287_mutar.mjs`. **Con autocomprobación**, porque en este repo ya hubo un
arnés que reportó «9/9 supervivientes» dos veces sin haber ejecutado un test: por cada mutación
verifica que (1) el ancla existe y es única, (2) el archivo cambió de verdad, (3) vitest reportó
una línea `Tests N …` —si no, sale **ERROR**, no «superviviente»— y (4) el archivo quedó
idéntico al restaurar. **La comprobación (3) sirvió de verdad**: la primera corrida usaba
`--reporter=basic`, que no existe en vitest 4, y las 22 mutaciones habrían salido como
«supervivientes» sin haber ejecutado nada.

| # | Mutación | Qué la mató |
| --- | --- | --- |
| M1 | `ALLOWED_ROLES` → `actor.rol === "invitado"` | los 5 roles de R2 |
| M2 | quitar la comparación de auto-restablecimiento | R5 |
| M3 | `generateStrongPassword()` → literal fuerte | «dos seguidas dan distintas» (el schema solo NO bastaba) |
| M4 | invertir el orden hash ↔ revocar | los dos casos de R11 |
| M5 | persistir el CLARO | R12 (servicio) **y** R12/R13 (Postgres) |
| M6 | `update` → `updateMany where: { id: { not } }` (otra fila) | **solo** el de Postgres |
| M7 | `deleteMany({ where: {} })` | **solo** el de Postgres (R16/R17) |
| M8 | `deleteMany` filtrando por `expiresAt` | **solo** el de Postgres (R16) |
| M9 | borrar también los `trusted_device` | **solo** el de Postgres (R18) |
| M10 | `sesionesRevocadas: 0` fijo | R19 (2 de 3 valores) y el de Postgres |
| M11 | `?? { deleteAllByUserId: async () => 0 }` (degradar en silencio) | R20 |
| M12 | el composition root deja de pasar el 4.º argumento, el import sigue | `usuarios-composition` |
| M13 | `console.log(plain)` en el servicio | guardia (a) + humo de R23 |
| M14 | `console.error(salida)` en la acción | guardia (a) — el canal que la guardia vieja NO mira |
| M15 | `generatedPassword` en `UsuarioListItem` | guardia (b), dos casos |
| M16 | la nota de reversión pierde el motivo original | **SOBREVIVIÓ** → ver abajo |
| M17 | reescribir la Decisión 5 «para dejarla coherente» | testigos VERBATIM |
| M18 | frase caducada nueva en el módulo | (d) R34 |
| M19 | la acción crece un parámetro de entrada | «la firma admite exactamente `(id, deps)`» |
| M20 | la acción deja de exigir sesión | R1 |
| M21 | el `UPDATE` toca además `estado` | **solo** el de Postgres (R14) |
| M22 | añadir un emisor de notificación al constructor | R37 |

### El agujero real que encontró M16

El detector de R32(e) pedía «FIJAR … credencial» dentro de una ventana. Eso lo satisfacía
**otra** frase de la propia nota —«Restablecer no es fijar: ni siquiera el maestro elige qué
credencial queda»—, así que **borrar la frase que dice el motivo dejaba la guardia en verde**.
Es exactamente el modo de fallo que la autocomprobación sintética no ve: mi texto de control no
tenía la segunda frase.

Arreglado en dos sitios, no en uno:

1. El patrón ahora exige la carga semántica que **solo** el motivo tiene —que el maestro
   conociera la credencial **de antemano** o pudiera **reusarla en silencio**—, que es
   precisamente lo que hay que seguir protegiendo y lo que no se deduce de «no es fijar».
2. Se añadió el caso **«(e) REGRESIÓN M16»**, que aplica la mutación **al archivo real** y
   exige que la pieza salga como faltante. Una autocomprobación contra texto sintético habría
   vuelto a pasar por alto el agujero; contra el archivo de verdad, no.

### Cinco mutaciones que **solo** Postgres mató

M6, M7, M8, M9 y M21 pasan **en verde** por el test de servicio con dobles. Es la lección que
este repo tiene medida cuatro veces, comprobada otra vez aquí: un doble no ve el `WHERE`. El
archivo de servicio lo dice en su cabecera para que nadie lo confunda con una red que no es.

---

## 6. T14 — la medición de `Session`: **hecha en local, NO en producción**

`design.md` §4 anota que `Session.userId` **no tiene índice**, y T14 pide medir en producción
**antes de desplegar** cuántas filas tiene la tabla.

**No pude medir producción**: este agente no tiene expuestas las herramientas del MCP de
Supabase, y la `DATABASE_URL` de producción es «sensitive» (no recuperable por CLI). **T14 queda
abierta** y hay que cerrarla antes del despliegue.

Lo que sí se midió, contra la base **local** (`localhost:5432`, `2026-08-26`), solo lectura:

| Métrica | Valor |
| --- | --- |
| filas en `Session` | **420** |
| no expiradas | 0 |
| usuarios distintos con sesión | 5 |
| máximo de sesiones de UN usuario | **194** |

**Dos lecturas, y la segunda no es la que se buscaba.** (a) A esta escala el recorrido
secuencial es irrelevante y la decisión A7 (no añadir el índice aquí) se sostiene. (b) Más
interesante: **194 sesiones de un solo usuario, y 0 vivas**. Las filas de `Session` **no se
purgan al expirar** — sólo se borran en el logout explícito. En producción eso crece con cada
ingreso y nunca baja. No es de esta ficha, pero conviene mirarlo: es la clase de tabla que
alguien descubre grande el día equivocado, y es justo la que esta feature recorre sin índice.

---

## 7. Gate

Se corrió **`./init.sh` completo** (no `--rapido`), como manda `design.md` §11: la ficha toca
`lib/types/usuario.ts`, y `lib/types/**` está en la lista por la que el modo rápido se niega.
`INIT_EXIT` se captura **dentro** del log.

### Baseline (ANTES de tocar nada), sobre `origin/dev` @ `b9422108`

```
Test Files  1 failed | 1409 passed (1410)
     Tests  1 failed | 19209 passed | 26 skipped (19236)
INIT_EXIT=1
```

El único fallo es el **rojo ajeno y preexistente** que el encargo avisaba:

```
FAIL tests/unit/guards/superficie-de-uso.guardia.test.ts
  > ninguna Server Action de `lib/actions/**` es inalcanzable sin su anotación `@sin-superficie`
  + [ "lib/actions/tarifas.ts:67 obtenerTarifa" ]
```

No se tocó, no se silenció, no se anotó. Es de la ficha 275 (`pending`).

### Después

```
Test Files  1 failed | 1414 passed (1415)
     Tests  1 failed | 19285 passed | 26 skipped (19312)
INIT_EXIT=1
```

El unico fallo es **el mismo, con el mismo unico elemento en la lista**:

```
+ [ "lib/actions/tarifas.ts:67 obtenerTarifa" ]
```

Que siga habiendo **uno solo** no es casualidad: la accion nueva
`restablecerContrasenaUsuario` habria entrado en esa misma lista, porque hoy no la importa
ningun modulo alcanzable (su pantalla es T10). Lleva por eso una anotacion
`@sin-superficie` **transitoria**, que es el mecanismo que la propia guardia documenta, y que
el frontend tiene que **retirar** al cablearla.

#### La primera corrida salio con dos fallos MAS, y eran del entorno

Se deja escrito porque un rojo tampoco prueba nada por si solo. La corrida anterior
(`f287_gate_despues.log`) trajo dos **suites que no cargaron**:

```
FAIL tests/unit/actions/webhooks-action.test.ts
  Error: Cannot find module '...\.prisma\client\index.js'
FAIL tests/unit/services/tablero-dia-cache-aislamiento.guardia.test.ts
  TypeError: Cannot read properties of undefined (reading 'maestro')   <- RolValue undefined
```

Las dos son **la misma causa** y ninguna es mia: el cliente de Prisma GENERADO desaparecio a
mitad de corrida. Este worktree monta `node_modules` por junction desde el repo principal, asi
que un `prisma generate` lanzado desde otro worktree en paralelo **escribe en el mismo sitio** y
deja un hueco. Es un modo de fallo ya conocido en este repo.

Comprobado antes de descartarlo, no supuesto: (a) ninguno de los dos archivos esta en mi diff;
(b) los dos **pasan en aislado** (`2 passed | 24 tests`); (c) el directorio
`.prisma/client/` volvia a estar completo; y (d) **la corrida limpia de arriba los da en verde**.
Por eso el delta se mide contra esta segunda corrida.

### Delta

| | Baseline (antes) | Despues | Delta |
| --- | --- | --- | --- |
| Test files fallando | 1 | 1 | **0** |
| Tests fallando | 1 | 1 | **0** |
| Tests pasando | 19 209 | 19 285 | **+76** |
| Test files totales | 1 410 | 1 415 | +5 |
| `INIT_EXIT` | 1 | 1 | = |

**Fallos nuevos introducidos por este trabajo: 0.** El gate sigue en `INIT_EXIT=1` por el
**mismo y unico** rojo ajeno de la ficha 275, que estaba ahi antes de tocar nada.
`typecheck` y `lint` pasaron en las dos corridas.

---

## 8. Lo que queda abierto

1. **T0 incumplida**: la 285 no está en `dev`. Riesgo de conflicto en 3 archivos (§1).
2. **El spec 287 no está en el repo** (§2). El puntero de R32(g) apunta a un directorio que hoy
   solo existe sin commitear en el checkout compartido.
3. **T14 sin cerrar**: falta la medición en producción (§6). Y el hallazgo lateral: `Session` no
   se purga al expirar.
4. **Frontend (T9/T10) pendiente**: R25–R31 y la mitad de cliente de R24 sin cubrir (§4). Al
   cablearlo hay que **retirar** `@sin-superficie` de la acción.
5. **Las cinco preguntas abiertas de `requirements.md` siguen abiertas**, y dos tienen
   consecuencia operativa real que conviene no perder de vista:
   - **RS6 / pregunta 1** — un maestro logueado **no tiene hoy ninguna vía** de rotar su propia
     contraseña mientras el SMTP esté caído. Es consecuencia directa de R5, que se implementó
     como manda el spec.
   - **RS2 / pregunta 2** — un desafío OTP vivo puede convertirse en sesión hasta 10 min
     **después** del restablecimiento, pese a R16. Fuera de alcance por decisión del spec.
6. **RS1 sigue en pie y es deliberado**: al usuario **no se le avisa** y **no se le obliga** a
   cambiarla. Decisión firmada por el humano el 2026-08-26; queda escrito para que sea revisable.

## Veredicto

**Backend de la 287 implementado y verificado: 22/22 mutaciones muertas —incluida una que
sobrevivio y obligo a endurecer un detector—, 0 fallos nuevos en el gate completo (1 -> 1, el
rojo ajeno de la 275), y tres cosas SIN cerrar que hay que mirar antes de mergear: T0 (la 285 no
esta en `dev`), el spec 287 sin commitear, y T14 (la medicion de `Session` en produccion) que
este agente no pudo hacer.**
