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

Añadir un control "Cerrar sesión" en el shell autenticado (`app/(app)/layout.tsx`
→ `Sidebar`), visible para cualquier rol logueado y en cualquier página protegida,
que invalide la sesión en el servidor, expire la cookie de sesión y lleve al
usuario a `/login` sin dejar acceso a rutas protegidas al volver atrás. Sin tablas
nuevas ni migraciones.

## Requisitos

- **R1 — Ubicuo.** El sistema DEBE mostrar un control "Cerrar sesión" dentro del
  shell autenticado (el sidebar/layout del grupo `app/(app)`), de modo que esté
  presente en todas las páginas protegidas.

- **R2 — De estado (todos los roles).** MIENTRAS exista una sesión válida, el
  sistema DEBE mostrar el control "Cerrar sesión" con independencia del rol del
  usuario autenticado (maestro, admin, mensajero, adminTienda, adminSatelite).

- **R3 — De estado (solo autenticado).** MIENTRAS no exista una sesión válida
  (rutas públicas como `/login`), el sistema NO DEBE renderizar el control
  "Cerrar sesión" (el shell autenticado no se monta).

- **R4 — Por evento.** CUANDO el usuario activa el control "Cerrar sesión", el
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
  sistema DEBE indicar el progreso y DEBE impedir envíos duplicados del control
  (deshabilitarlo hasta que la operación resuelva).

- **R12 — Ubicuo (accesibilidad).** El sistema DEBE exponer el control "Cerrar
  sesión" como un elemento operable por teclado y con nombre accesible "Cerrar
  sesión".

- **R13 — Ubicuo (sin nuevo esquema).** El sistema NO DEBE introducir tablas,
  columnas ni migraciones nuevas; DEBE reutilizar la infraestructura de sesión
  existente (`Session`, `SessionRepository`, `AuthService.logout`, la Server
  Action `logout` y el guard de `middleware.ts`).

- **R14 — Ubicuo (sin duplicar el control).** El sistema DEBE exponer un único
  control "Cerrar sesión" en el shell autenticado; NO DEBE quedar además el botón
  ad-hoc previo de `app/(app)/page.tsx` (afordancia mínima de la feature 6,
  marcada en su propio comentario como "to be moved/replaced").

## Preguntas abiertas F1.4 (decisiones del humano)

Ambas requieren decisión antes de implementar. Se incluye recomendación y
trade-off anclados a lo que YA existe en el código.

### (a) Ubicación exacta del botón — sidebar directo vs. menú de usuario/perfil

- **Recomendación: sidebar directo**, en el `SidebarFooter` del componente
  `app/(app)/_components/Sidebar.tsx` (la primitiva `SidebarFooter` ya está
  disponible en `components/ui/sidebar.tsx` pero hoy no se usa; el sidebar solo
  tiene header + nav).
- **Motivo/trade-off:** hoy NO existe ningún menú de usuario/perfil ni un
  dropdown en el shell; construir uno (mostrar nombre + rol + menú desplegable)
  implica un componente nuevo (dropdown de shadcn) y estado extra, lo que es
  sobre-ingeniería para una feature de complejidad `low`. El botón en el footer
  del sidebar queda visible para todos los roles en todas las páginas con el
  mínimo de superficie nueva. Coste: es menos "vistoso" que un menú de perfil que
  muestre el usuario logueado; si en el futuro se quiere un menú de usuario, el
  botón puede migrar allí sin cambiar el backend.

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
