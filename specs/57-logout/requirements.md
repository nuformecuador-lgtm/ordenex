# Feature 57 — Botón "Cerrar sesión" (logout) · requirements.md

> Notación EARS. Cada requisito es testeable y sin detalles de implementación.
> Contexto verificado en código: la sesión se crea en el login RBA (features 1/2)
> como una fila `Session` cuyo id viaja en la cookie `session` (helper
> `SESSION_COOKIE_NAME`, `lib/constants/auth.ts`). El **backend de logout ya
> existe** (`logout` en `lib/actions/auth.ts` → `AuthService.logout` →
> `SessionRepository.deleteById`, marcado R24 de la feature 6). Esta feature
> **reutiliza** ese backend y añade la pieza de UI + el cierre del flujo
> (visibilidad para todos los roles, redirección y no-acceso al volver atrás).

## Alcance

Añadir un control de logout ("Salir") en el shell autenticado, ubicado en el
**topbar del `PageHeader` compartido** (`components/shared/PageHeader.tsx`,
esquina superior derecha), presente en toda página del grupo `app/(app)` para
cualquier rol logueado, que invalide la sesión en el servidor, expire la cookie
de sesión y lleve al usuario a `/login` sin dejar acceso a rutas protegidas al
volver atrás. Sin tablas nuevas ni migraciones.

## Requisitos

- **R1 — Ubicuo.** El sistema DEBE mostrar un control de logout ("Salir") dentro
  del shell autenticado (el topbar del `PageHeader` compartido, que renderiza toda
  página del grupo `app/(app)`), de modo que esté presente en todas las páginas
  protegidas.

- **R2 — De estado (todos los roles).** MIENTRAS exista una sesión válida, el
  sistema DEBE mostrar el control de logout ("Salir") con independencia del rol del
  usuario autenticado (maestro, admin, mensajero, adminTienda, adminSatelite).

- **R3 — De estado (solo autenticado).** MIENTRAS no exista una sesión válida
  (rutas públicas como `/login`), el sistema NO DEBE renderizar el control de
  logout (el shell/`PageHeader` autenticado no se monta en rutas públicas).

- **R4 — Por evento.** CUANDO el usuario activa el control de logout ("Salir"), el
  sistema DEBE invocar la Server Action de logout que invalida la sesión en el
  servidor (no una petición GET ni una ruta pública).

- **R5 — Condicional (invalidación server-side).** SI al ejecutarse la Server
  Action de logout la cookie de sesión contiene un id de sesión, ENTONCES el
  sistema DEBE invalidar/eliminar en el servidor esa MISMA sesión creada en el
  login (la fila `Session` identificada por dicho id).

- **R6 — Por evento (cookie).** CUANDO la Server Action de logout termina, el
  sistema DEBE expirar/eliminar la cookie de sesión usando el mismo nombre de
  cookie que fija el login (`SESSION_COOKIE_NAME`), de modo que el navegador deje
  de enviar una cookie de sesión válida.

- **R7 — Por evento (redirección).** CUANDO el logout finaliza con éxito, el
  sistema DEBE redirigir al usuario a `/login`.

- **R8 — Por evento (no-acceso al volver atrás).** CUANDO el usuario, ya
  deslogueado, intenta acceder a una ruta protegida —incluido pulsar el botón
  "Atrás" del navegador—, el sistema DEBE redirigirlo a `/login` y NO DEBE mostrar
  contenido de rutas protegidas.

- **R9 — Condicional (idempotencia).** SI la Server Action de logout se invoca sin
  una sesión válida (ya deslogueado, o sesión expirada), ENTONCES el sistema DEBE
  completar sin error, dejar igualmente la cookie de sesión limpia y llevar al
  usuario a `/login`.

- **R10 — Condicional (manejo de error).** SI la Server Action de logout falla de
  forma inesperada, ENTONCES el sistema NO DEBE navegar a `/login` como si el
  cierre hubiese tenido éxito, DEBE dejar el control en un estado accionable de
  nuevo y DEBE dar feedback del fallo al usuario.

- **R11 — De estado (anti doble envío).** MIENTRAS el logout está en curso, el
  sistema DEBE indicar el progreso (texto "Saliendo…") y DEBE impedir envíos
  duplicados del control (deshabilitarlo hasta que la operación resuelva).

- **R12 — Ubicuo (accesibilidad).** El sistema DEBE exponer el control de logout
  como un elemento operable por teclado y con nombre accesible "Salir".

- **R13 — Ubicuo (sin nuevo esquema).** El sistema NO DEBE introducir tablas,
  columnas ni migraciones nuevas; DEBE reutilizar la infraestructura de sesión
  existente (`Session`, `SessionRepository`, `AuthService.logout`, la Server
  Action `logout` y el guard de `middleware.ts`).

- **R14 — Ubicuo (sin duplicar el control).** El sistema DEBE exponer un único
  control de logout ("Salir") en el shell autenticado (el topbar del `PageHeader`);
  NO DEBE quedar además el botón ad-hoc previo de `app/(app)/page.tsx` (afordancia
  mínima de la feature 6, marcada en su propio comentario como "to be
  moved/replaced").

## Preguntas abiertas F1.4 (decisiones del humano)

Ambas requieren decisión antes de implementar. Se incluye recomendación y
trade-off anclados a lo que YA existe en el código.

### (a) Ubicación exacta del botón — DECISIÓN FINAL: topbar del PageHeader

- **DECIDIDO por el humano: topbar del `PageHeader` compartido**
  (`components/shared/PageHeader.tsx`, esquina superior derecha), con etiqueta
  "Salir" + icono `LogOut`. Esta ubicación se **recupera del PR #54
  ("adjustments")** —que había puesto el logout en el topbar y luego fue
  revertido—: el humano vio ese topbar y lo prefirió a la ubicación en el sidebar.
  Se recupera SOLO el logout de #54 (la campana de notificaciones queda como
  feature aparte; no se agrega aquí).
- **Historia (recomendación inicial, ya superada):** el diseño recomendó
  inicialmente el `SidebarFooter` del `Sidebar` (mínima superficie nueva, sin
  dropdown de usuario). Se implementó así en una primera versión, pero el humano
  cambió la decisión a favor del topbar del `PageHeader` (más visible, alineado
  con #54). El `SidebarFooter` quedó **descartado** y revertido; el sidebar vuelve
  a tener solo header + nav.
- **Por qué el `PageHeader` es válido para esto:** solo se usa bajo el grupo
  `app/(app)` (páginas autenticadas); nunca en rutas públicas (login/postulación/
  recuperar-contraseña viven fuera de `(app)` y no lo usan). Así el logout queda
  visible para todos los roles en toda página protegida (R1, R2) y ausente en
  público (R3). El `PageHeader` sigue siendo Server Component y renderiza el
  `LogoutButton` (client) en su zona derecha.

### (b) Confirmación antes de cerrar — modal (feature 13) vs. logout directo (un click)

- **Recomendación: logout directo (un click)**, conservando el indicador de
  progreso "Cerrando sesión…" y el bloqueo anti-doble-click (R11) que ya tiene el
  `LogoutButton` actual.
- **Motivo/trade-off:** cerrar sesión es una acción de bajo riesgo y trivialmente
  reversible (basta volver a iniciar sesión), por lo que un paso de confirmación
  añade fricción a una acción frecuente. Coste: un click accidental cierra la
  sesión. Si el humano prefiere una red de seguridad, el `Modal` compartido
  (`components/shared/Modal.tsx`, feature 13) ya soporta `onConfirm` asíncrono con
  spinner y bloqueo (`confirmVariant="destructive"`), por lo que envolver el
  logout en confirmación es trivial y no cambia el backend. Decisión binaria del
  humano; el diseño contempla ambas rutas (ver `design.md`, "Impacto de F1.4(b)").
