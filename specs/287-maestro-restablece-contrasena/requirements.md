# Feature 287 — El maestro restablece la contraseña de un usuario

> **Zona:** fullstack · **SDD:** sí · **Estado del spec:** `spec_ready` (pendiente de aprobación humana)
> **Fecha:** 2026-08-26 · **Depende de:** feature 285 (colisión de archivos, ver `tasks.md`)

## Problema

Un usuario que pierde su contraseña no tiene hoy forma de recuperar el acceso. La vía
existente (feature 20, recuperación por correo con OTP) **depende del correo, y el correo
está caído en producción** (Gmail rechaza la credencial SMTP con 535). El maestro tampoco
puede hacer nada: el módulo de usuarios no toca la contraseña, por decisión escrita.

## Alcance firmado por el humano (2026-08-26)

El maestro **RESTABLECE**: dispara una contraseña **generada por el sistema** que se muestra
**una sola vez** en pantalla. El maestro **NUNCA escribe** una contraseña elegida por él.
**No hay campo de contraseña en esta ficha.**

Esa distinción no es cosmética: es lo que impide que el maestro fije una credencial que
conozca de antemano, que es exactamente lo que la Decisión 5 de la feature 25 protegía
(ver §6 y `design.md` §9).

---

## §1 — Autorización y borde

- **R1** — MIENTRAS el actor no tenga una sesión válida, el sistema DEBE responder
  `unauthenticated` a la petición de restablecimiento y NO DEBE leer ni modificar dato
  alguno del usuario objetivo.
- **R2** — SI el rol del actor no es `maestro`, ENTONCES el sistema DEBE responder
  `forbidden` y NO DEBE leer ni modificar dato alguno del usuario objetivo.
- **R3** — El sistema DEBE decidir la autorización del restablecimiento con la MISMA
  fuente de roles autorizados que el resto de operaciones del módulo de usuarios, sin
  declarar una lista de roles propia para esta operación.
- **R4** — SI el identificador recibido no corresponde a un usuario existente, ENTONCES el
  sistema DEBE responder `not_found` sin efectos de ningún tipo.
- **R5** — SI el usuario objetivo es el propio actor, ENTONCES el sistema DEBE rechazar la
  operación con un resultado distinguible de `forbidden` y NO DEBE cambiar la contraseña ni
  revocar sesión alguna.
- **R6** — SI la petición contiene cualquier campo además del identificador del usuario
  objetivo —en particular un valor de contraseña—, ENTONCES el sistema DEBE responder
  `validation_error` sin efectos.
- **R7** — El sistema DEBE restablecer la contraseña de un usuario objetivo cualquiera sea
  su `estado` (`activo`, `inactivo`, `pendiente` o `bloqueado`), sin alterar ese estado.

## §2 — El acto de restablecer

- **R8** — CUANDO un actor `maestro` restablece la contraseña de un usuario existente
  distinto de sí mismo, el sistema DEBE generar una contraseña nueva con el MISMO generador
  que usa el alta de usuarios, sin recibir del actor ningún valor de contraseña.
- **R9** — La contraseña generada DEBE cumplir la política de contraseña fuerte vigente del
  sistema (la misma que valida el alta y la recuperación por correo).
- **R10** — El sistema NUNCA DEBE aceptar un valor de contraseña procedente del actor en
  ninguna capa de este flujo (borde, servicio ni repositorio).
- **R11** — CUANDO el restablecimiento se ejecuta, el sistema DEBE revocar las sesiones del
  usuario objetivo ANTES de persistir el nuevo hash, de modo que un fallo a mitad deje un
  estado MÁS restrictivo (sesiones cerradas, contraseña sin rotar) y nunca uno más permisivo
  (contraseña rotada con sesiones vivas).
- **R12** — CUANDO el restablecimiento tiene éxito, el sistema DEBE persistir ÚNICAMENTE el
  hash de la contraseña generada, y NUNCA la contraseña en claro.
- **R13** — CUANDO el restablecimiento tiene éxito, el hash persistido en la base de datos
  DEBE verificar la contraseña mostrada al maestro, y la contraseña anterior del usuario
  NO DEBE seguir verificando.
- **R14** — CUANDO el restablecimiento tiene éxito, el sistema NO DEBE modificar ningún otro
  campo del usuario objetivo (nombre, email, teléfono, cédula, tipo de identificación, rol,
  estado, zona, vehículo ni `fulfillment`).
- **R15** — SI cualquiera de los dos pasos (revocación o persistencia del hash) falla,
  ENTONCES el sistema DEBE responder error y su respuesta NO DEBE contener contraseña alguna.

## §3 — Sesiones activas y dispositivos de confianza

- **R16** — CUANDO el restablecimiento tiene éxito, el sistema DEBE eliminar TODAS las
  sesiones del usuario objetivo, incluidas las que aún no han expirado.
- **R17** — CUANDO el restablecimiento tiene éxito, el sistema NO DEBE eliminar ni alterar
  las sesiones de ningún otro usuario.
- **R18** — CUANDO el restablecimiento tiene éxito, el sistema NO DEBE eliminar ni alterar
  los dispositivos de confianza del usuario objetivo.
- **R19** — CUANDO el restablecimiento tiene éxito, el sistema DEBE informar al maestro
  cuántas sesiones revocó.
- **R20** — SI el componente que revoca sesiones no está disponible en tiempo de ejecución,
  ENTONCES el sistema DEBE fallar la operación de forma visible y NO DEBE completar un
  restablecimiento sin haber revocado.

> El porqué de R16 frente a R18 —revocar portadores de acceso, no señales de riesgo— está
> razonado con las cifras medidas del motor de riesgo en `design.md` §7 (D3).

## §4 — La contraseña generada: una sola vez y en ningún otro sitio

- **R21** — CUANDO el restablecimiento tiene éxito, el sistema DEBE devolver la contraseña
  generada EXACTAMENTE UNA vez, en la respuesta de esa misma operación.
- **R22** — Ninguna otra lectura del sistema (listado de usuarios, detalle, descarga del
  listado completo, catálogos) DEBE incluir la contraseña en claro ni el hash.
- **R23** — El sistema NUNCA DEBE registrar (log) la contraseña generada ni el hash
  resultante, en ninguna capa ni por ningún canal.
- **R24** — El sistema NUNCA DEBE persistir la contraseña generada en claro en ningún
  almacén (base de datos, cookie, caché, almacenamiento del navegador ni archivo).

## §5 — Interfaz

- **R25** — DONDE el listado de usuarios muestra acciones por fila, el sistema DEBE ofrecer
  al maestro una acción de restablecer contraseña, y NO DEBE ofrecer en ningún punto de esta
  ficha un campo para escribir una contraseña.
- **R26** — CUANDO el maestro activa esa acción, el sistema DEBE pedir confirmación explícita
  que nombre al usuario afectado y advierta que su contraseña actual dejará de servir y que
  se cerrarán sus sesiones abiertas, ANTES de ejecutar nada.
- **R27** — SI el maestro cancela la confirmación, ENTONCES el sistema NO DEBE ejecutar el
  restablecimiento.
- **R28** — CUANDO el restablecimiento termina con éxito, la interfaz DEBE mostrar la
  contraseña generada una sola vez, con una acción para copiarla y con la advertencia de que
  no volverá a mostrarse.
- **R29** — CUANDO el maestro cierra el panel de la contraseña, el sistema NO DEBE ofrecer
  ninguna vía para volver a mostrarla.
- **R30** — SI el restablecimiento falla, ENTONCES la interfaz DEBE informar el error y NO
  DEBE mostrar contraseña alguna.
- **R31** — El sistema NO DEBE exponer el restablecimiento desde el formulario de alta ni de
  edición de usuario.

## §6 — Reversión, a sabiendas, de la Decisión 5 de la feature 25

Texto original, firmado en la puerta F1.4 el **2026-07-10**
(`specs/25-gestion-usuarios/requirements.md`, «Decisiones firmes», punto 5):

> 5. **Campos editables:** editable = `nombre`, `telefono`, `rolId`,
>    `tipoIdentificacionId`; NO editable = `email`, `cedula`. Reset de contraseña desde
>    edición: FUERA de alcance. (R16)

Y su eco en el código, hoy, en `lib/interfaces/repositories/IUserRepository.ts:98`:

> `// Feature 25/R16: solo los campos editables por el maestro. NUNCA email, cedula`
> `// ni passwordHash (Decision 5).`

**Lo que esta ficha revierte:** la cláusula de alcance «Reset de contraseña desde edición:
FUERA de alcance». El humano lo pidió con ese dato delante y acotó el alcance en el mismo
mensaje. Queda escrito que se revierte a sabiendas.

**Lo que esta ficha NO revierte, y por qué el motivo original queda protegido:** la
Decisión 5 protegía dos cosas distintas que conviene no confundir.

1. Que el maestro no pudiera **fijar** una credencial de otra persona (una que él conociera
   de antemano y pudiera reusar en silencio). Eso **sigue intacto**: el maestro no escribe
   ninguna contraseña; el sistema la genera (R8/R10) y solo se guarda su hash (R12).
2. Que `email`, `cedula` y el hash no fueran campos de la edición genérica de usuario. Eso
   **también sigue intacto** (R35): esta ficha no añade la contraseña a la vía de edición;
   usa una operación propia y un método de repositorio distinto, el que la feature 20 ya
   creó para el reset por correo.

Además, el propio diseño de la 25 ya apuntaba a esta ficha:
`specs/25-gestion-usuarios/design.md:180-184` descarta guardar la contraseña generada y
dice que «si se pierde, el flujo correcto es **un reset futuro** (fuera de alcance,
Decisión 5)». Lo que cambia hoy es la palabra «futuro».

- **R32** — El contrato donde hoy se declara la Decisión 5 DEBE declarar la reversión con
  todas estas piezas, cada una comprobable por separado: (a) el nombre de la decisión;
  (b) la fecha en que se adoptó (2026-07-10); (c) la fecha de la reversión (la de esta
  ficha); (d) una palabra que la marque como revertida/acotada; (e) el motivo original que
  protegía; (f) el alcance exacto de lo revertido (restablecer, no fijar) y de lo que se
  conserva; (g) el puntero a `specs/287-maestro-restablece-contrasena`.
- **R33** — El sistema DEBE conservar el texto original de la Decisión 5 en
  `specs/25-gestion-usuarios/` VERBATIM, sin reescribirlo, y añadirle un apéndice fechado
  que apunte a esta ficha.
- **R34** — El árbol NO DEBE contener ninguna afirmación de que el maestro no puede tocar
  ni restablecer la contraseña de un usuario, una vez esta ficha esté implementada.
- **R35** — El sistema DEBE seguir impidiendo que `email`, `cedula` o el hash de contraseña
  se modifiquen por la vía de edición de usuario.

## §7 — Fuera de alcance (dicho por el humano, y verificable)

- **R36** — El sistema NO DEBE exigir al usuario cambiar la contraseña en su siguiente
  ingreso como consecuencia de un restablecimiento.
- **R37** — El sistema NO DEBE enviar correo ni ninguna otra notificación al usuario como
  consecuencia de un restablecimiento.
- **R38** — El restablecimiento DEBE completarse con éxito con el proveedor de correo
  indisponible: no DEBE depender del correo en ningún paso.

> R37 y R38 no son la misma frase: R37 dice que no se avisa (decisión del humano), R38 dice
> que el camino no toca el correo ni para fallar (condición operativa: SMTP caído en
> producción hoy). Ver el riesgo RS1 en `design.md` §12.

---

## Trazabilidad

Cada `R<n>` se mapea a un test concreto en `tasks.md`, con la **mutación que mataría** cada
test clave. El implementer replica ese mapa en `progress/impl_287-maestro-restablece-contrasena.md`.

---

## Decisiones firmes de esta ficha

1. **Restablecer, no fijar.** El maestro no escribe contraseñas. Firmado por el humano el
   2026-08-26. (R8/R10/R25)
2. **Se muestra una sola vez, en pantalla.** Misma forma que el alta. No hay reenvío, no hay
   copia guardada, no hay correo. (R21/R28/R29)
3. **Sesiones: se revocan todas.** Un restablecimiento que deja viva una sesión de hasta 24 h
   no restablece nada. (R16)
4. **Dispositivos de confianza: no se tocan.** Borrarlos empuja el siguiente ingreso a un OTP
   por correo que hoy no llega, y dejaría fuera justo a quien queríamos dejar entrar. Razonado
   con los pesos medidos del motor de riesgo en `design.md` §7 (D3). (R18)
5. **Auto-restablecimiento rechazado.** El maestro no se restablece a sí mismo por esta vía.
   (R5, alternativa descartada A4 en `design.md`)
6. **Sin migración.** No hay tabla ni columna nueva. (`design.md` §4)

---

## Preguntas abiertas

1. **Auto-restablecimiento (R5).** Se decide rechazarlo: revocar las sesiones del propio
   actor a mitad del flujo puede cerrarle la sesión antes de que copie la contraseña que solo
   se muestra una vez, y si es el único maestro se queda fuera con el correo caído. La
   alternativa (permitirlo preservando la sesión que hace la petición) exige bajar el
   identificador de sesión hasta el servicio. **Efecto colateral que hay que aceptar
   conscientemente:** hoy un maestro logueado no tiene NINGUNA vía para rotar su propia
   contraseña mientras el correo esté caído. ¿Se confirma el rechazo, o se prefiere pagar la
   fontanería de preservar la sesión propia?
2. **Desafío OTP pendiente.** Un desafío OTP vivo mina una sesión **sin volver a pedir la
   contraseña** (`AuthService.verifyChallenge`). Si alguien tiene un desafío en curso en el
   instante del restablecimiento, puede convertirlo en sesión durante hasta
   `AUTH_OTP_TTL_MINUTES` (10 min por defecto) pese a la revocación. Esta ficha lo deja
   FUERA de alcance y lo documenta como riesgo RS2. ¿Se cierra también, o se acepta la
   ventana de 10 minutos?
3. **Rastro de la acción.** No existe hoy tabla de auditoría de acciones del maestro
   (`login_attempt` registra ingresos, no acciones administrativas). Tal como queda, un
   restablecimiento **no deja rastro de quién lo hizo ni cuándo**. Esta ficha no crea esa
   tabla. ¿Se quiere una ficha aparte para la auditoría del módulo de usuarios?
4. **Panel de «contraseña generada» duplicado.** La maqueta de mostrar-una-vez vive hoy
   dentro de `UsuarioForm.tsx`, que es de la ficha 286 y no se puede tocar aquí. Esta ficha
   crea su propio panel (archivo nuevo, sin colisión) y deja la unificación para después.
   ¿Se registra una ficha de seguimiento para unificar las dos maquetas cuando la 286 aterrice?
5. **Texto exacto de la confirmación (R26).** Se propone: «Se generará una contraseña nueva
   para <nombre>. La actual dejará de servir y se cerrarán sus sesiones abiertas. La verás
   una sola vez.» ¿Se aprueba ese texto?
