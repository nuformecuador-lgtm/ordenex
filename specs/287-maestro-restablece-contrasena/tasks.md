# Feature 287 — Tareas

> `[P]` = paralelizable con las demás `[P]` de su bloque (no comparten archivo).
> Ninguna tarea de código arranca antes de **T0**.

## Bloque 0 — Precondición

- [ ] **T0** — Comprobar que la **feature 285 está mergeada en `dev`** y rebasar sobre ella.
  - Motivo: 285 y 287 escriben en los mismos cuatro archivos (`design.md` §11). Escribir el
    spec no molestaba; tocar el código en paralelo sí.
  - Dep: ninguna. Bloquea: **todas**.
  - **Hecho cuando:** `git log origin/dev` muestra el merge de la 285 y la rama de esta ficha
    parte de ese commit. Si la 285 no está, la ficha **no arranca**: se dice y se espera.

## Bloque 1 — Contratos y repositorio

- [ ] **T1** — `lib/interfaces/repositories/ISessionRepository.ts`: añadir
  `deleteAllByUserId(userId: string): Promise<number>` con su comentario (feature 287/R16/R19).
  - Cubre: R16, R19. Dep: T0.
  - **Hecho cuando:** compila la interfaz; el método devuelve el número de sesiones borradas.

- [ ] **T2** — `lib/repositories/SessionRepository.ts`: implementar `deleteAllByUserId` con
  `deleteMany({ where: { userId } })` devolviendo `count`.
  - Cubre: R16, R17, R19. Dep: T1.
  - **Hecho cuando:** cero sesiones devuelve `0` sin lanzar (idempotente); no hay lógica de
    negocio en el repositorio.
  - Test (dobles, solo forma): `tests/unit/repositories/session-repository.test.ts` —
    «deleteAllByUserId borra por userId y devuelve el count (R16/R19)». **Ojo:** este test NO
    prueba el `WHERE`; eso es T11.

- [ ] **T3** — Actualizar los dos objetos literales que implementan `ISessionRepository` en
  test: `tests/unit/services/auth-service.test.ts:75` y
  `tests/unit/services/postulacion-login-regresion.test.ts:69`.
  - Cubre: deuda de T1. Dep: T1.
  - **Hecho cuando:** `pnpm run typecheck` en verde. Que rompieran era la señal esperada.

- [ ] **T4** [P] — `lib/interfaces/services/IUsuarioService.ts`: añadir
  `RestablecerContrasenaServiceResult` y el método `restablecerContrasena(id, actor)` (forma
  exacta en `design.md` §6).
  - Cubre: R2, R4, R5, R15, R19, R21. Dep: T0.
  - **Hecho cuando:** `generatedPassword` es obligatorio en la rama `ok` y **no existe** en
    ninguna otra rama del union (que el tipo impida devolverla junto a un error).

- [ ] **T5** [P] — `lib/types/usuario.ts`: añadir `RestablecerContrasenaResult` reusando
  `ActionError` (`design.md` §6).
  - Cubre: R15, R21. Dep: T0.
  - **Hecho cuando:** compila y no se añade ningún schema zod de contraseña (no hay entrada
    que validar más allá del `id`: R6/R10).
  - ⚠️ Tocar `lib/types/**` **obliga al gate completo** (`docs/verification.md`). Ver T16.

## Bloque 2 — Servicio

- [ ] **T6** — `lib/services/UsuarioService.ts`: método `restablecerContrasena(id, actor)`.
  Cuarto parámetro de constructor `sessionRepo?: Pick<ISessionRepository,"deleteAllByUserId">`.
  Orden obligatorio: guard `ALLOWED_ROLES` → `findById` → auto-restablecimiento → generar +
  hashear → **`deleteAllByUserId`** → **`updatePasswordHash`**.
  - Cubre: R2, R3, R4, R5, R7, R8, R9, R10, R11, R12, R14, R15, R16, R19, R20, R21, R23, R24,
    R37, R38. Dep: T1, T4.
  - **Hecho cuando:** usa el MISMO `ALLOWED_ROLES` ya declarado en el archivo (no una copia);
    sin `any`; sin `console.*`; sin ningún parámetro por el que entre una contraseña; si
    `sessionRepo` no está inyectado, **lanza** (no degrada en silencio).
  - Test: `tests/unit/services/usuario-restablecer-contrasena.test.ts` (repos mock) —
    - «rol no maestro → forbidden sin llamar a ningún repositorio (R2/R3)»
    - «usuario inexistente → not_found sin revocar ni escribir (R4)»
    - «objetivo = actor → self_reset_forbidden sin efectos (R5)»
    - «usuario inactivo se restablece igual y su estado no cambia (R7/R14)»
    - «la contraseña devuelta cumple strongPasswordSchema y no viene del input (R8/R9/R10)»
    - «persiste el hash, nunca el claro: el argumento de updatePasswordHash no es la
      contraseña devuelta y `verifyPassword` contra él da true (R12)»
    - «revoca ANTES de escribir: si updatePasswordHash rechaza, deleteAllByUserId ya se llamó
      y el resultado no lleva contraseña (R11/R15)»
    - «si deleteAllByUserId rechaza, updatePasswordHash NO se llama (R11/R15)»
    - «devuelve el count de sesiones revocadas que dio el repositorio (R19)»
    - «sin sessionRepo inyectado lanza y no toca la contraseña (R20)»
    - «ningún método de console recibe la contraseña durante el flujo completo (R23)».
  - Mutaciones que deben matarlos: `design.md` §10.

## Bloque 3 — Server Action

- [ ] **T7** — `lib/actions/usuarios.ts`: `restablecerContrasenaUsuario(id, deps)` con el
  patrón idéntico a las otras seis acciones (`withErrorHandler` + `resolveActorFromSession` +
  `idSchema` + `toUsuarioActionError`). **Sin parámetro de entrada más allá del `id`.**
  - Cubre: R1, R6, R10, R15, R21. Dep: T5, T6.
  - **Hecho cuando:** sin sesión responde `unauthenticated` **antes** de instanciar el
    servicio; la firma no admite ningún objeto de entrada.
  - Test: `tests/unit/actions/usuarios.test.ts` (añadir bloque) —
    - «sin sesión → unauthenticated y no llama al servicio (R1)»
    - «id inválido → validation_error sin llamar al servicio (R6)»
    - «propaga generatedPassword y sesionesRevocadas del servicio (R19/R21)»
    - «un fallo del servicio no devuelve contraseña en ninguna rama (R15)».

- [ ] **T8** — `buildUsuarioService()` en el mismo archivo: pasar
  `new SessionRepository(prisma)` como cuarto argumento.
  - Cubre: R20. Dep: T2, T7.
  - **Hecho cuando:** el composition root **pasa** el repositorio (no basta con importarlo).
  - Test: `tests/unit/actions/usuarios-composition.test.ts` — «buildUsuarioService construye
    el servicio con un revocador de sesiones utilizable (R20)». Debe fallar si se borra el
    argumento aunque el import siga presente.

## Bloque 4 — Frontend

- [ ] **T9** [P] — `app/(app)/configuracion/_components/ContrasenaGeneradaPanel.tsx` (archivo
  **nuevo**): panel de solo lectura con la contraseña, botón de copiar y el aviso de que no
  volverá a mostrarse. Calcado del panel del alta (`UsuarioForm.tsx:314-345`), **sin tocar
  `UsuarioForm.tsx`** (es de la ficha 286).
  - Cubre: R28. Dep: T0.
  - **Hecho cuando:** el componente recibe la contraseña por props, no la guarda en ningún
    almacén persistente y no tiene ninguna vía para volver a pedirla (R24/R29). Lleva escrita
    en cabecera la razón de la duplicación de maqueta y el puntero a la pregunta abierta 4.
  - Test: `tests/unit/components/contrasena-generada-panel.test.tsx` — «muestra el valor y el
    aviso, y copia al portapapeles (R28)».

- [ ] **T10** — `usuarios-columns.tsx` + `UsuariosModule.tsx`: acción «Restablecer contraseña»
  por fila → modal de confirmación (nombra al usuario y advierte del cierre de sesiones) →
  ejecuta la acción → al `ok`, panel de T9 + toast con el número de sesiones cerradas; al
  error, toast sin contraseña.
  - Cubre: R25, R26, R27, R28, R29, R30, R31. Dep: T7, T9.
  - **Hecho cuando:** no existe ningún input de contraseña en ninguna de las dos superficies;
    el formulario de alta/edición no expone la acción (R31); el panel se descarta al cerrar.
  - Test: `tests/unit/components/usuarios-restablecer.test.tsx` —
    - «el botón de la fila NO ejecuta nada hasta confirmar (R26/R27)»
    - «al confirmar llama a la acción una sola vez con el id de la fila (R26)»
    - «con ok muestra la contraseña una vez y el número de sesiones cerradas (R19/R28)»
    - «al cerrar el panel no queda ningún control que la vuelva a mostrar (R29)»
    - «con error muestra el toast y ninguna contraseña (R30)»
    - «no hay ningún campo de contraseña en el flujo (R25)».

## Bloque 5 — Lo que solo Postgres puede probar

- [ ] **T11** — `tests/integration/db/restablecer-contrasena-sql-real.test.ts`, con
  `crearPrismaDeTest` + `serializarEscriturasReales` + `enTransaccionRevertida` de
  `tests/integration/db/_postgres-real.ts`.
  - Cubre: **R12, R13, R14, R16, R17, R18**. Dep: T2, T6.
  - Contenido: sembrar en la transacción revertida dos usuarios con contraseña conocida, con
    sesiones cada uno y un `trusted_device` para el objetivo; ejecutar el restablecimiento
    real (repositorios reales, sin dobles); comprobar contra la base:
    - `verifyPassword(contraseñaMostrada, password_hash) === true` **y**
      `verifyPassword(contraseñaAnterior, password_hash) === false` (R12/R13);
    - ninguna otra columna de la fila cambió (R14);
    - el objetivo tiene **0** sesiones y el otro usuario **conserva las suyas** (R16/R17);
    - el `trusted_device` del objetivo **sigue existiendo** (R18).
  - **Hecho cuando:** el test **revienta con mensaje** si faltan los catálogos que necesita
    (`tipo_identificacion`, `rol`) en vez de retornar en silencio. Solo se permite saltar por
    ausencia de `DATABASE_URL`, que es la convención del arnés.
  - ⚠️ **Antes de darlo por bueno:** matarlo a mano con las mutaciones de `design.md` §10
    (`where: {}` en el `deleteMany`, guardar el claro, escribir en otra fila) y comprobar que
    se pone rojo con cada una. Un verde sin datos no prueba nada.

## Bloque 6 — La reversión, escrita donde se lee

- [ ] **T12** [P] — Los tres soportes de `design.md` §9:
  (a) nota de reversión en `lib/interfaces/repositories/IUserRepository.ts` (líneas 98 y 139),
  **sin borrar** el comentario original;
  (b) apéndice fechado en `specs/25-gestion-usuarios/requirements.md` y `design.md`, **sin
  tocar** el texto original;
  (c) guardia `tests/unit/guards/decision5-revertida.guardia.test.ts` (molde:
  `tests/unit/guards/d5-revertida.guardia.test.ts`).
  - Cubre: R32, R33, R34, R35. Dep: T0 (independiente del resto del código).
  - **Hecho cuando:** la guardia exige las siete piezas de R32 **por separado** (el fallo dice
    cuál falta), verifica los testigos VERBATIM del texto original, y **cada detector lleva su
    autocomprobación** (un texto que infringe y otro que no). Sin eso se queda verde por vacía.
  - Test adicional: «la vía de edición sigue rechazando email, cedula y password (R35)» —
    reusar/extender el test existente del schema `.strict()` de `actualizarUsuarioSchema`.

- [ ] **T13** [P] — Guardia de superficie del secreto:
  `tests/unit/guards/contrasena-generada-superficie.guardia.test.ts`.
  - Cubre: R22, R23. Dep: T0.
  - Contenido: (a) censo cerrado de los archivos del camino del restablecimiento (servicio,
    acción, repositorio de sesiones, panel y módulo) donde **no puede haber `console.*`**
    —más estricto que la guardia de credenciales existente, que solo mira `console.log` en
    `lib/clients`/`lib/auth`—; (b) que el nombre del campo con la contraseña en claro solo
    aparece en los dos resultados que la llevan (alta y restablecimiento) y en ningún DTO de
    lectura (`UsuarioPublico`, `UsuarioListItem`, columnas de descarga).
  - **Hecho cuando:** control de no-vacuidad (el censo no está vacío y ningún archivo se leyó
    en blanco) + autocomprobación de los detectores.

## Bloque 7 — Cierre

- [ ] **T14** — Medir en producción, **antes de desplegar**, el número de filas de `Session`
  y dejarlo escrito en `progress/impl_287-maestro-restablece-contrasena.md`.
  - Motivo: `Session.userId` no tiene índice (`design.md` §4). Se acepta el recorrido
    secuencial **con el número delante**, no de oído. Si sale grande, se abre ficha para el
    índice; no se añade aquí.
  - Dep: T2. **Hecho cuando:** el número y la fecha de la medición están en el `progress/`.

- [ ] **T15** — Mapa `R1..R38 → test` completo en
  `progress/impl_287-maestro-restablece-contrasena.md`, con la salida real de los tests.
  - Dep: T6, T7, T10, T11, T12, T13.
  - **Hecho cuando:** los 38 requisitos tienen test nombrado. Un requisito sin test es
    hallazgo bloqueante del reviewer.

- [ ] **T16** — Gate: **`./init.sh` completo**, no `--rapido`.
  - Motivo: la ficha toca `lib/types/usuario.ts`, y `lib/types/**` está en la lista por la que
    el modo rápido **se niega** (`docs/verification.md`). Es un `fail`, no un aviso.
  - Dep: todas. **Hecho cuando:** el gate termina en verde con `INIT_EXIT` capturado dentro
    del log (un `echo` posterior puede tapar el código de salida).

- [ ] **T17** — Actualizar `feature_list.json` (estado y `status_note` en 3–6 líneas) y
  `progress/current.md`.
  - Dep: T16. **Hecho cuando:** la ficha refleja lo verificado y lo que quedó abierto (las
    cinco preguntas de `requirements.md`), sin duplicar el detalle que vive en `progress/`.

---

## Orden y paralelismo

```
T0
├─ T1 → T2 → T3
├─ T4 ─┐
├─ T5 ─┤
│      └→ T6 → T7 → T8
├─ T9 ─────────────┴→ T10
├─ T12  [P]
└─ T13  [P]
T2 + T6 → T11
todo → T14 → T15 → T16 → T17
```

`[P]` real: **T4, T5, T9, T12, T13** no comparten archivo entre sí. **T6, T7, T8 y T10 van en
serie**: los tres primeros tocan archivos que 285 también tocó y el cuarto depende de la
acción. Y el gate **nunca** corre en paralelo con un subagente que esté mutando el árbol: su
veredicto no valdría.
