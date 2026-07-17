# Feature 81 — API keys — requirements.md

## Contexto verificado contra el codigo real

Antes de escribir esto se leyo (no la bitacora, el codigo):

- `db/schema.prisma:82-113` — modelo `Usuario`. Campos NOT NULL sin default:
  `nombre`, `email` (`@unique`, linea 87), `telefono` (88), `passwordHash` (89),
  `cedula` (`@unique`, 91), `tipoIdentificacionId` (92), `rolId` (93).
  `estado` es `EstadoUsuario` con `@default(pendiente)` (90).
  Nullables: `primerApellido`, `segundoApellido`, `vehiculoId`, `placa`, `zonaId`,
  `ordenEnGestionId`. `fulfillment` Boolean default false (96).
- `db/schema.prisma:35-43` — `enum RolValue { maestro, admin, mensajero, adminTienda @map("Admin Tienda"), adminSatelite }`.
- `db/schema.prisma:73-80` — `enum EstadoUsuario { pendiente, activo, inactivo, bloqueado }`.
- `db/schema.prisma:16-23` — `TipoIdentificacion { id, value @unique }`, seed `"cedula" | "ruc" | "pasaporte"`.
- `lib/types/roles.ts:1-3` — `ROLES_SEED = Object.values(RolValue)`; no hay catalogo paralelo.
- `middleware.ts:3` — `PUBLIC_ROUTES = ["/login", "/api/health", "/postulacion"]`;
  el resto exige cookie `session` (lineas 11-16). **No se toca en esta feature.**
- `lib/utils/password.ts:3-12` — bcrypt (`bcryptjs`) con `SALT_ROUNDS = 10`;
  `hashPassword` / `verifyPassword`.
- `lib/utils/password-generator.ts:45-62` — `generateStrongPassword()`: 16 chars,
  `crypto.randomInt`, cumple `strongPasswordSchema`, no loguea ni persiste.
- `lib/services/UsuarioService.ts:29-31,52-91` — feature 25: solo `maestro` crea
  usuarios (`ALLOWED_ROLES`); `estado: "activo"` al crear (linea 80); modo
  `generate` devuelve `generatedPassword` una sola vez (85-87).
- `lib/repositories/UserRepository.ts:70-93` — `create()` valida las FK de catalogo
  y mapea P2002 a `UsuarioDuplicadoError("email" | "cedula")` (229-236).
- `lib/services/AuthService.ts:53-101` — login: `findByEmailWithHash(email)` →
  bcrypt compare → `estado !== "activo"` ⇒ `account_unavailable`.
- `lib/auth/resolve-actor.ts:15-31` — `resolveActorFromSession()` → `{ usuarioId, rol }`.
- `db/migrations/20260716130000_premio_ranking/{migration.sql,down.sql}` — patron de
  tabla nueva: `CREATE TABLE` + indices + `ENABLE ROW LEVEL SECURITY` sin policies
  (solo service role) + `down.sql` con `DROP TABLE IF EXISTS`.

## Alcance

**DENTRO:** generar una API key a partir de un identificador de entrada, crear el
usuario dedicado a esa key (nombre derivado del identificador, contrasena
aleatoria), persistir la key **hasheada**, devolver la key en claro **una sola vez**.

**FUERA (pedido explicito del humano "por ahora solo generar y asignar"):**
el consumo/verificacion de la key en peticiones (middleware, auth por header),
la UI de gestion, revocacion, expiracion y `last_used_at`. Ver
"Features hermanas sugeridas".

---

## Requisitos (EARS)

### Autorizacion

- **R1.** CUANDO se invoque la generacion de una API key sin una sesion valida, el
  sistema DEBE rechazar la operacion con `unauthenticated` y NO DEBE crear ninguna
  fila en `api_key` ni en `usuario`.
- **R2.** SI el actor autenticado no tiene el rol habilitado para administrar API
  keys (ver D2), ENTONCES el sistema DEBE rechazar la operacion con `forbidden` y
  NO DEBE crear ninguna fila en `api_key` ni en `usuario`.

### Entrada

- **R3.** El sistema DEBE aceptar como unica entrada obligatoria un `identificador`
  de texto, validado en el borde, con longitud entre 3 y 60 caracteres tras
  recortar espacios.
- **R4.** SI el `identificador` no cumple R3, ENTONCES el sistema DEBE responder
  `validation_error` con el detalle en el campo `identificador` y NO DEBE crear
  ninguna fila.
- **R5.** El sistema DEBE derivar del `identificador` un `slug` normalizado
  (minusculas, sin acentos, caracteres fuera de `[a-z0-9]` colapsados a `-`, sin
  `-` inicial ni final).
- **R6.** SI el `slug` derivado del `identificador` queda vacio, ENTONCES el sistema
  DEBE responder `validation_error` en el campo `identificador` y NO DEBE crear
  ninguna fila.

### Usuario dedicado

- **R7.** CUANDO se genere una API key valida, el sistema DEBE crear un usuario
  NUEVO dedicado a esa key, con `nombre` derivado del `identificador` recibido.
- **R8.** CUANDO se cree el usuario dedicado, el sistema DEBE asignarle una
  contrasena generada aleatoriamente con aleatoriedad criptografica, distinta en
  cada generacion, y DEBE persistir unicamente su hash bcrypt en
  `usuario.password_hash`.
- **R9.** El sistema NO DEBE devolver, loguear ni exponer por ningun canal la
  contrasena en claro del usuario dedicado.
- **R10.** CUANDO se cree el usuario dedicado, el sistema DEBE derivar del `slug`
  un `email` y una `cedula` en un espacio de nombres reservado que no colisione con
  los de usuarios reales (ver D4), respetando la unicidad NOT NULL de
  `usuario.email` y `usuario.cedula` (`db/schema.prisma:87,91`).
- **R11.** SI ya existe un usuario con el `email` o la `cedula` derivados del
  `slug`, ENTONCES el sistema DEBE responder `conflict` indicando el campo y NO DEBE
  crear la key ni el usuario.
- **R12.** CUANDO se cree el usuario dedicado, el sistema DEBE asignarle el rol
  definido en D1 y el `estado` definido en D5.
- **R13.** El sistema DEBE crear el usuario dedicado y la fila de `api_key` en una
  unica transaccion: SI falla cualquiera de los dos, ENTONCES no DEBE persistir
  ninguno de los dos.

### La key

- **R14.** CUANDO se genere una API key, el sistema DEBE producir un secreto con al
  menos 256 bits de entropia obtenida de un generador criptografico.
- **R15.** El sistema DEBE devolver la key en claro con un prefijo identificable
  fijo (ver D3), de forma que sea reconocible como credencial de esta aplicacion.
- **R16.** El sistema DEBE persistir unicamente el hash del secreto de la key en
  `api_key.key_hash` y NUNCA el secreto en claro.
- **R17.** El sistema DEBE persistir junto a la key un `key_prefix` no secreto que
  permita identificarla visualmente sin revelar el secreto.
- **R18.** CUANDO la generacion sea exitosa, el sistema DEBE devolver el secreto en
  claro exactamente UNA vez, en la respuesta de esa operacion.
- **R19.** El sistema NO DEBE ofrecer ninguna operacion que permita recuperar el
  secreto en claro de una key ya generada.
- **R20.** El sistema NO DEBE loguear el secreto en claro ni su hash en ningun nivel
  de log.
- **R21.** El sistema DEBE registrar en cada `api_key` el `usuario_id` de la cuenta
  dedicada, el `usuario_id` del actor que la genero y la fecha de creacion.
- **R22.** Dos generaciones consecutivas con el mismo `identificador` (tras
  eliminarse la anterior o no) DEBEN producir secretos distintos.

### Datos

- **R23.** La tabla `api_key` DEBE tener Row Level Security habilitado.
- **R24.** La migracion que crea `api_key` DEBE ser aditiva y DEBE tener su
  `down.sql` que la revierte exactamente.
- **R25.** El sistema DEBE garantizar unicidad de `api_key.key_hash`.

---

## Features hermanas sugeridas (fuera de alcance, registrar cuando el humano lo pida)

- **81a — consumo de API key:** verificacion por header en `middleware.ts` /
  route handlers, resolucion del actor desde la key, `last_used_at`.
- **81b — gestion de API keys:** listado, revocacion, expiracion, rotacion, UI.

---

## Decisiones abiertas para el gate F1.4

> ## ✅ GATE F1.4 RESUELTA POR EL HUMANO — 2026-07-16
>
> **APROBADAS LAS 8 CON LA RECOMENDACION DEL `spec_author`. CERO OVERRIDES.**
> Lo de abajo deja de ser una lista de preguntas: **son las decisiones vigentes** y
> el `backend_dev` las implementa tal cual. No re-abrir sin el humano.
>
> - **D1 — Rol:** valor NUEVO `apiKey` en el enum `RolValue`, **sin ninguna fila en
>   `rol_permiso`** (fallo seguro: la key no puede hacer nada hasta que el humano le
>   conceda permisos). El `down.sql` **debe recrear el tipo** — Postgres no soporta
>   `DROP VALUE`. Round-trip real obligatorio.
> - **D2 — Quien genera:** solo `maestro` (mismo criterio que `UsuarioService.ALLOWED_ROLES`).
> - **D3 — Formato:** `ordx_` + 32 bytes de `crypto.randomBytes(32)` en base64url;
>   `key_prefix` = los primeros 12 chars, en claro.
> - **D4 — Usuario sintetico:** `email = apikey+<slug>@apikey.invalid` (RFC 2606),
>   `cedula = APIKEY-<slug>`, `telefono = ""`, `tipoIdentificacionId` = lookup de
>   `value = "cedula"` (sin valor nuevo de catalogo).
>   **El cierre del login es "DE FACTO", NO por construccion** (la contrasena es
>   aleatoria y nadie la conoce). El rechazo duro en `AuthService.login` es **81a** y
>   **NO se implementa aca** — el humano lo dejo fuera a proposito al acotar el alcance.
> - **D5 — Estado inicial:** `activo`.
> - **D6 — Cardinalidad:** 1:1, indice UNIQUE sobre `api_key.usuario_id`.
> - **D7 — Hasheo de la key:** **SHA-256** (NO bcrypt). El leader habia pedido bcrypt
>   y el `spec_author` lo refuto con razon: una key de 256 bits aleatorios no tiene
>   diccionario que atacar; bcrypt costaria ~100 ms/request en 81a y no permite lookup
>   por hash. **La contrasena del usuario dedicado SI sigue en bcrypt** (`hashPassword`).
> - **D8 — `identificador`:** sin UNIQUE propio (la unicidad efectiva ya la imponen
>   `usuario.email`/`usuario.cedula` derivados del slug).

Regla 6: nada de esto esta en `docs/`, `specs/` ni el codigo. **No lo asumo.** Cada
una lleva mi recomendacion y su porque; el humano aprueba u ordena lo contrario.

### D1 — Rol del usuario generado por una key (bloqueante para R12)

El catalogo real es `RolValue { maestro, admin, mensajero, adminTienda, adminSatelite }`
(`db/schema.prisma:35-43`). Ninguno describe "cliente de API": cada uno arrastra
permisos y semantica de negocio (p. ej. `mensajero`/`adminSatelite` exigen `zona_id`
segun `UsuarioService.resolverZona`, lineas 232-257; `adminTienda` habilita
`fulfillment`).

**Recomendacion:** añadir un valor nuevo `apiKey` al enum `RolValue` **sin ningun
permiso asociado** en `rol_permiso`. Porque: (a) reutilizar `admin` o `maestro`
daria a toda key privilegios totales el dia que se implemente el consumo (81a);
(b) reutilizar `mensajero`/`adminSatelite` obliga a inventar una zona;
(c) un rol propio y vacio hace que la key no pueda hacer NADA hasta que el humano
le conceda permisos explicitos — fallo seguro por defecto.
**Coste:** migracion de enum (`ALTER TYPE ... ADD VALUE`) — no reversible por
`DROP VALUE` en Postgres; el `down.sql` tendria que recrear el tipo. Si el humano
lo considera demasiado, la alternativa es reutilizar un rol existente y aceptar el
riesgo en 81a.

### D2 — Quien puede generar keys (bloqueante para R2)

**Recomendacion:** solo `maestro`, identico a `UsuarioService.ALLOWED_ROLES`
(`lib/services/UsuarioService.ts:31`). Porque generar una key es crear un usuario,
y crear usuarios ya es exclusivo de `maestro` en la feature 25; abrirlo a `admin`
seria una escalada de privilegios silenciosa.

### D3 — Formato de la key (bloqueante para R14/R15/R17)

**Recomendacion:** `ordx_` + 32 bytes de `crypto.randomBytes(32)` en base64url
(43 chars) ⇒ `ordx_<43 chars>`, 256 bits de entropia. `key_prefix` = los primeros
12 caracteres del string completo (`ordx_` + 7 chars), guardado en claro.
Porque: prefijo identificable (patron `sk_`/`ghp_`, permite detectar la credencial
en secret-scanners), entropia suficiente para descartar fuerza bruta, y el prefijo
almacenado permite mostrar `ordx_ab12cd3…` en la futura UI (81b) sin exponer nada.

### D4 — Email / cedula del usuario sintetico (bloqueante para R10; lo mas delicado)

`usuario.email` y `usuario.cedula` son UNIQUE NOT NULL (`db/schema.prisma:87,91`)
y `AuthService.login` busca por email (`lib/services/AuthService.ts:60`).

**Recomendacion:**
- `email` = `apikey+<slug>@apikey.invalid`. El TLD `.invalid` esta reservado por
  RFC 2606: nunca sera un email real, ningun proveedor lo enruta, y no puede
  colisionar con un usuario humano. Un indice unico ya existente garantiza R11.
- `cedula` = `APIKEY-<slug>` (la columna es `String` libre, sin CHECK de formato
  en la DB — verificado en la migracion de `usuario`).
- `telefono` = cadena vacia `""` (NOT NULL sin default; el service dedicado no pasa
  por `crearUsuarioSchema`, asi que no hay validacion de formato que romper).
- `tipoIdentificacionId` = el del catalogo con `value = "cedula"` (seed existente,
  `db/schema.prisma:18`), resuelto por lookup, **sin** añadir un valor nuevo al
  catalogo. Porque un valor nuevo (`api`) obligaria a otra migracion de catalogo y
  a tocar los selects de la feature 25 sin beneficio real.
- El acceso por formulario de login queda cerrado **de facto**: la contrasena es
  aleatoria de 16 chars y se descarta tras hashear (nadie la conoce, R9).
  **Nota:** esto es "cerrado de facto", no "cerrado por construccion". El cierre
  duro (rechazar en `AuthService.login` a usuarios cuyo rol/email sea de API key)
  pertenece a 81a; si el humano lo quiere en esta feature, lo digo yo mismo:
  **no lo meto sin su orden.**

### D5 — Estado inicial del usuario dedicado (bloqueante para R12)

`EstadoUsuario` tiene default `pendiente` (`db/schema.prisma:90`); la feature 25
lo fuerza a `activo` porque lo crea un maestro (`UsuarioService.ts:80`); la
postulacion publica lo deja `pendiente`.

**Recomendacion:** `activo`. Porque lo crea un maestro (mismo criterio que la
feature 25) y `pendiente` implicaria un paso de verificacion por email que no
existe para una cuenta sin buzon real (D4). Contraargumento honesto: `pendiente`
daria un "fallo cerrado" por defecto si 81a chequea `estado === "activo"`.
Si el humano prefiere `pendiente`, la key nace inerte hasta que la active — es una
postura defendible y el cambio es de una linea.

### D6 — Cardinalidad key ↔ usuario (afecta al indice de `api_key.usuario_id`)

**Recomendacion:** **1:1 en esta feature** (indice UNIQUE sobre `usuario_id`).
Porque el pedido es "generar y asignar a un usuario" y cada generacion crea un
usuario nuevo: hoy no existe forma de pedir una segunda key para un usuario
existente. El indice UNIQUE es la restriccion mas fuerte compatible con el pedido y
se relaja a un indice normal en 81b si aparece la rotacion (drop + create index, sin
migracion de datos).

### D7 — Hasheo de la key: SHA-256 vs bcrypt (afecta a R16)

Resuelto en `design.md` §5 con su alternativa descartada, pero se anota aqui porque
**el humano pidio "alinear con el hasheo bcrypt del login"** y mi recomendacion se
aparta de eso.

**Recomendacion:** **SHA-256** (no bcrypt) para `key_hash`. Porque bcrypt existe
para proteger secretos de baja entropia (contrasenas humanas) haciendo caro el
ataque de diccionario; una key de 256 bits aleatorios no tiene diccionario que
atacar. Y bcrypt tiene dos costes reales aqui: (a) en 81a, verificar la key
requeriria ~100 ms de CPU **por request**, o bien un `bcrypt.compare` contra cada
fila (bcrypt no permite lookup por hash); SHA-256 permite `WHERE key_hash = $1`,
un unico indice; (b) bcrypt trunca a 72 bytes. La contrasena del usuario dedicado
**si** sigue usando `hashPassword` (bcrypt, `lib/utils/password.ts`) — ahi la
alineacion con el login se mantiene.
Si el humano prefiere bcrypt igualmente, R16 se cumple igual y solo cambia
`ApiKeyHasher`; el coste se paga en 81a.

### D8 — `identificador`: ¿unico?

No esta dicho. **Recomendacion:** no añadir un UNIQUE explicito sobre
`api_key.identificador`; la unicidad efectiva ya la imponen `usuario.email` y
`usuario.cedula` derivados del slug (R11), y duplicar la restriccion daria dos
errores distintos para la misma causa.
