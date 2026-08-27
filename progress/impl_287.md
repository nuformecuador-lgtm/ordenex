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

---
---

# Feature 287 — bitácora de implementación (FRONTEND)

> **Alcance de esta parte:** **T9 y T10**. Cubre **R25–R31**, la **mitad de cliente de R24** y
> lleva **R19** hasta la pantalla. Es exactamente lo que la sección 4 de la bitácora del backend
> declaró **NO cubierto a propósito**; no se dio por bueno nada de aquella lista sin test propio.
>
> - **Rama:** `feature/287-restablecer-contrasena` (worktree aislado, parte de `3e0718cd`, que es
>   el merge del backend de esta misma ficha).
> - **Fecha:** 2026-08-26.
> - **No se tocó nada del backend.** Lo único que se modificó fuera de la capa de presentación es
>   la retirada de la anotación `@sin-superficie` (ver §F3), que el propio backend dejó pedida.

---

## §F1 — Archivos

### Creados

| Archivo | Qué es |
| --- | --- |
| `app/(app)/configuracion/_components/ContrasenaGeneradaPanel.tsx` | El panel de «una sola vez» (T9) |
| `tests/unit/components/contrasena-generada-panel.test.tsx` | Sus tests (T9) |
| `tests/unit/components/usuarios-restablecer.test.tsx` | El flujo completo de pantalla (T10) |

### Modificados

| Archivo | Qué cambió |
| --- | --- |
| `app/(app)/configuracion/_components/usuarios-columns.tsx` | Acción «Restablecer contraseña» por fila (T10/R25) |
| `app/(app)/configuracion/_components/UsuariosModule.tsx` | Confirmación (R26/R27), cableado de la acción, panel (R28/R29) y toast (R19/R30) |
| `lib/actions/usuarios.ts` | **Retirada** de la anotación `@sin-superficie` transitoria (§F3) |
| `tests/unit/components/usuarios-columns.test.tsx` | La prop nueva es obligatoria + 3 casos |
| `tests/unit/components/usuarios-module.test.tsx` | Doble de la acción nueva en el `vi.mock` |

**Lo que NO se tocó, y estaba prohibido tocar:** `UsuarioForm.tsx` (es de la ficha 286, PR #513
sin mergear), `lib/actions/tarifas.ts`, la guardia `superficie-de-uso` y el módulo de órdenes.
El diseño no llevó a ninguno de ellos: `design.md` §11 ya marcaba `UsuarioForm.tsx` con un **NO**
y por eso T9 crea archivo propio.

---

## §F2 — Cómo quedó la pantalla

```
fila del listado  ──[Restablecer contraseña]──▶  Modal de confirmación (R26)
                        (solo abre; no ejecuta)   │ nombra a la persona
                                                  │ «La actual dejará de servir»
                                                  │ «se cerrarán sus sesiones abiertas»
                                                  │ «La verás una sola vez»
                                     Cancelar/Esc ─┴─ Restablecer
                                          (R27)          │
                                       nada pasa         ▼
                                                restablecerContrasenaUsuario(id)
                                                    │              │
                                                   ok            error
                                                    │              │
                                    ContrasenaGeneradaPanel     toast, y el panel
                                    + toast con el nº de        NO se abre (R30)
                                    sesiones cerradas (R19)
```

Tres decisiones que conviene tener escritas:

1. **La llamada es `restablecerContrasenaUsuario(objetivo.id)` y nada más.** Hay un test que
   afirma la **forma** de la llamada (`mock.calls[0]` es `["u1"]`, un solo argumento). Esa es la
   mitad de cliente de R6/R10: si alguien le añade un objeto de entrada —por donde entraría una
   contraseña elegida por el maestro— el test se pone rojo. La mutación **F10** lo comprueba.
2. **La advertencia va en `description` del `Modal`, no en el cuerpo.** Así el `Modal` la cuelga
   de `aria-describedby` y la oye quien usa lector de pantalla, no solo quien la ve. Hay un test
   que sigue el `aria-describedby` hasta el nodo y comprueba que ahí dentro está el nombre.
3. **`self_reset_forbidden` tiene mensaje propio**, distinto de `forbidden`. Son dos negativas
   distintas (R5 / R2) y colapsarlas se detecta (mutación **F12**).

**Texto de la confirmación (pregunta abierta 5 de `requirements.md`):** se usó *literalmente* el
propuesto en el spec. Esa pregunta sigue **formalmente abierta**: nadie la aprobó por escrito; se
implementó la propuesta del spec porque era la única redacción disponible y cumple las piezas de
R26. Si el humano prefiere otra, es un cambio de una línea (y dos aserciones de test).

---

## §F3 — La anotación `@sin-superficie`: **retirada**, y comprobado que su ausencia importa

El backend dejó sobre `restablecerContrasenaUsuario` una anotación `@sin-superficie TRANSITORIA`
porque su pantalla —esta— aún no existía. **Se retiró al cablear T10**, sustituida por la
descripción de cuál es ahora su superficie.

No basta con decir que se quitó, así que se midió en las dos direcciones:

- **Ahora:** la guardia `superficie-de-uso` **no la lista** como huérfana (la acción es alcanzable
  desde `UsuariosModule` → `configuracion/page.tsx`) y **tampoco** se queja de anotación caducada.
  El único elemento de esa lista sigue siendo el rojo ajeno de la 275.
- **Mutación F9:** volver a poner la anotación con la pantalla ya cableada pone **roja** la guardia
  por el otro extremo — «ninguna anotación `@sin-superficie` de acción sobrevive a su motivo».
  Es decir: la excepción ya no se puede quedar ahí por olvido, y está demostrado, no supuesto.

---

## §F4 — Mapa `R<n> → test` de esta parte

| R | Test |
| --- | --- |
| **R19** (en pantalla) | `usuarios-restablecer` › «muestra el claro en el panel y dice cuantas sesiones cerro (R19/R28)» + «el numero se dice tal cual llega, tambien en 1 y en 0 (R19)» |
| **R24** (mitad de cliente) | `contrasena-generada-panel` › «tras pintar y copiar, `localStorage`, `sessionStorage` y la cookie siguen vacios» + «el CODIGO del componente no nombra ningun almacen persistente» · `usuarios-restablecer` › «no guarda el claro en ningun almacen del navegador» |
| **R25** | `usuarios-columns` › «la fila ofrece «Restablecer contraseña»…» + «no hay ningún campo donde escribir una contraseña en la fila» · `usuarios-restablecer` › «cada fila del listado ofrece la accion del maestro» + «la confirmacion no tiene ningun campo» + «el panel del resultado tiene UN campo y es de solo lectura» · `contrasena-generada-panel` › «escribir en el campo no cambia su valor» |
| **R26** | `usuarios-restablecer` › «el boton de la fila NO ejecuta…» + «la confirmacion NOMBRA al usuario y advierte de las DOS consecuencias» + «la advertencia esta ASOCIADA al dialogo» + «al confirmar llama a la accion UNA sola vez y SOLO con el id de la fila» |
| **R27** | `usuarios-restablecer` › «Cancelar cierra sin ejecutar nada» + «Escape tambien cancela sin ejecutar nada» |
| **R28** | `contrasena-generada-panel` › «pinta el valor, el encabezado y el aviso…» + «copia al portapapeles el valor EXACTO y lo confirma en pantalla» · `usuarios-restablecer` › «muestra el claro en el panel…» |
| **R29** | `usuarios-restablecer` › «en NINGUN momento del flujo existe un control de «volver a mostrarla»» + «cerrar con Escape tambien descarta el claro» + «al cerrar desaparece del DOM y NO queda ningun control nuevo que la reponga» · `contrasena-generada-panel` › «el unico control del panel es copiar» + «el componente no conoce al usuario ni importa ninguna Server Action» |
| **R30** | `usuarios-restablecer` › «`%s` -> toast con su mensaje y sin panel» (5 ramas de error) + «`self_reset_forbidden` NO se confunde con `forbidden`» |
| **R31** | `usuarios-restablecer` › «el modal de Crear usuario no ofrece la accion» + «el modal de Editar usuario tampoco» + «el CODIGO del formulario no conoce la accion» |

Con esto, la tabla «**NO cubiertos**» de la §4 de la bitácora del backend queda **cerrada entera**.

---

## §F5 — Mutaciones: **14/14 muertas**, y una que sobrevivió primero

Arnés en `scratchpad/f287_front_mutar.mjs`. **Con autocomprobación**, por el motivo que esta misma
ficha ya documentó: la primera corrida del backend usaba `--reporter=basic` —que no existe en
vitest 4— y sus 22 mutaciones habrían salido «supervivientes» sin ejecutar un test. Aquí, por cada
mutación: (1) el ancla debe aparecer **exactamente una vez** o es `ERROR`, no «superviviente»;
(2) el archivo debe **cambiar en disco**; (3) vitest debe reportar su línea `Tests …` o es `ERROR`;
(4) al restaurar, el archivo vuelve **byte a byte** al original o el arnés **aborta**.

Y el veredicto **no** es «hubo un rojo», sino «**hubo más rojos que en la línea base**»: la base ya
trae el rojo ajeno de la 275, y comparar contra cero habría dado por muerta cualquier cosa.
Línea base medida por el propio arnés: `1 failed | 77 passed (78)`.

| # | Mutación | Qué la mató |
| --- | --- | --- |
| F1 | el botón de la fila EJECUTA sin confirmar | «el boton de la fila NO ejecuta…» (R26/R27) y 20 más |
| F2 | Cancelar ejecuta igualmente | «Cancelar cierra sin ejecutar nada» (R27) |
| F3 | el panel se abre TAMBIÉN cuando la acción falla | las 5 ramas de «toast … y sin panel» (R30) |
| F4 | el nº de sesiones se inventa (`0` fijo) | los dos casos de R19 |
| F5 | salir por Escape/overlay deja de descartar el claro | «cerrar con Escape tambien descarta el claro» (R29) |
| F5b | aparece un control de «Ver contraseña de nuevo» | «en NINGUN momento del flujo existe un control de «volver a mostrarla»» (R29) |
| F6 | el panel guarda el claro en `localStorage` | los 3 detectores de R24 (dos en ejecución, uno estático) |
| F7 | el campo deja de ser de solo lectura | los dos de R25 |
| F8 | la confirmación deja de NOMBRAR al usuario | «…NOMBRA al usuario…» + «…ASOCIADA al dialogo» (R26) |
| F9 | la anotación `@sin-superficie` sobrevive al cableado | `superficie-de-uso` › «ninguna anotación … sobrevive a su motivo» |
| F10 | la llamada crece un objeto de entrada | «…UNA sola vez y SOLO con el id de la fila» (R6/R10 en cliente) |
| F11 | el panel deja de avisar de que no se volverá a mostrar | los dos de R28 |
| F12 | `self_reset_forbidden` colapsa en el mensaje genérico | los dos de R5 |
| F13 | la fila deja de ofrecer la acción | 24 tests: la superficie entera |

### El agujero real que encontró F5

**F5 sobrevivió en la primera corrida.** Anular el `onOpenChange` del panel no rompía nada, porque
el estado también se limpiaba desde `onConfirm`: el botón «Cerrar» tapaba el agujero. La
consecuencia práctica era concreta y no teórica: **nada afirmaba que salir por Escape o por el
overlay descartara el claro**, que son dos puertas de salida tan reales como el botón.

Arreglado con dos tests nuevos, no con uno: «cerrar con Escape tambien descarta el claro» (que es
la puerta que faltaba) y «en NINGUN momento del flujo existe un control de «volver a mostrarla»»
(que vigila la otra forma de infringir R29: no que el claro sobreviva, sino que alguien ponga un
control para reponerlo). Se añadió además la mutación **F5b** para probar que el segundo test
también mata, con su detector autocomprobado contra nombres que sí infringen y uno que no.

---

## §F6 — Gate

`./init.sh` **completo** (no `--rapido`: la ficha toca `lib/types/usuario.ts` y el modo rápido se
niega). `INIT_EXIT` capturado **dentro** del log, no por un `echo` posterior.

| | Antes (`3e0718cd`, sin tocar nada) | Después | Delta |
| --- | --- | --- | --- |
| Test files fallando | 2 | 2 | **0** |
| Tests fallando | 4 | 4 | **0** |
| Tests pasando | 18 776 | 18 812 | **+36** |
| Test files totales | 1 416 | 1 418 | +2 |
| `INIT_EXIT` | 1 | 1 | = |

**Fallos nuevos introducidos por este trabajo: 0.** `typecheck` y `lint` en verde en las dos
corridas. Los 4 rojos son **los mismos cuatro**, y ninguno es de esta tanda:

1. **`superficie-de-uso.guardia.test.ts`** → `[ "lib/actions/tarifas.ts:67 obtenerTarifa" ]`. Es el
   rojo ajeno de la ficha 275. **Un solo elemento antes y un solo elemento después**, y ése importa:
   si retirar la anotación hubiera dejado la acción sin superficie, `restablecerContrasenaUsuario`
   habría entrado en esa misma lista. No entró.
2. **`analytics-daily-migration.test.ts`** (3 tests) → `PrismaConfigEnvError: Cannot resolve
   environment variable: DATABASE_URL`. Es **del entorno, no del código**: este worktree no tiene
   `.env` y ese guardia deriva DDL con `prisma migrate diff`. Aparece **idéntico en las dos
   corridas**, antes y después de tocar nada. Por la misma razón, esta corrida tiene **545 tests
   saltados** (los de `tests/integration/db/**`) frente a los 26 de la corrida del backend, que sí
   tenía base: **el T11 del backend no se re-verificó aquí**, ya estaba verde en su tanda.

---

## §F7 — Lo que queda abierto de esta parte

1. **Maqueta duplicada (RS5 / pregunta abierta 4).** `ContrasenaGeneradaPanel.tsx` calca el panel
   que vive dentro de `UsuarioForm.tsx`. Es deuda **consciente**: `UsuarioForm.tsx` es de la ficha
   286 y no se podía tocar. Cuando la 286 aterrice, unificar los dos es una ficha de seguimiento.
   El motivo y el puntero están escritos en la cabecera del archivo nuevo, no solo aquí.
2. **Pregunta abierta 5 (texto de la confirmación) sigue sin aprobación explícita**; se implementó
   la redacción propuesta por el spec (§F2).
3. **`AGENTS.md`/CHECKPOINTS: no hay E2E.** Todo lo de arriba es jsdom. Que el modal se vea bien en
   un navegador de verdad no lo prueba ningún test de este repo; si se quiere, es «ver la app».
4. **Lo que la bitácora del backend dejó abierto sigue abierto** y no lo cierra esta parte: T0 (la
   285 no está en `dev`), T14 (medir `Session` en producción) y las preguntas 1–3.

## Veredicto (frontend)

**T9 y T10 implementadas y verificadas: R25–R31 + la mitad de cliente de R24 + R19 en pantalla,
14/14 mutaciones muertas —una sobrevivió y destapó que nada afirmaba el cierre por Escape—,
`@sin-superficie` retirada y demostrado que su vuelta pone roja la guardia, y 0 fallos nuevos en
el gate completo (4 → 4: 1 ajeno de la 275 y 3 de entorno por falta de `.env`).**
