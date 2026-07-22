# Feature 107 — Plantillas de mensajes (Configuración → Plantillas)

Requisitos en notación EARS. Cada `R<n>` termina mapeado a un test concreto en
`tasks.md` (columna `R<n>→test`, `docs/specs.md` §Trazabilidad). Sin detalles de
implementación: el CÓMO vive en `design.md`.

**Alcance (fullstack):** nuevo subítem "Plantillas" en el menú Configuración
(ruta `/configuracion/plantillas`, SOLO rol `maestro`). CRUD de plantillas de
mensaje con cuerpo que admite CAMPOS VARIABLES tipo `{{usuario}}` / `{{cod}}`, un
catálogo ABIERTO y extensible de variables (data-driven, mínimo `usuario` y `cod`),
persistencia del conjunto de variables usadas por cada plantilla como un ARRAY,
vista previa del mensaje renderizado y un estado con cuatro valores
(`activo`, `inactivo`, `pending`, `refused`). Al crear desde el front la plantilla
nace en `pending` (Decisión humana 1). Desde el front el maestro SOLO puede
DESACTIVAR: la ÚNICA transición de estado expuesta tiene destino `inactivo`
(Corrección humana). ACTIVAR (`pending → activo`) NO existe en este alcance y
`refused` queda RESERVADO en el enum sin productor; ambas son transiciones de backend
futuras. La eliminación es SOFT DELETE (columna `deletedAt`); los listados filtran
`deletedAt IS NULL`.

**Reutiliza (verificado contra el código, no supuesto):**
- Menú: `lib/auth/menu-visibility.ts` → `SIDEBAR_ITEMS`, ítem "Configuración"
  (`roles: ["maestro"]`) que ya tiene `children` (Usuarios, Tarifas, API).
- Autorización server-side de página: patrón de
  `app/(app)/configuracion/page.tsx` y `.../api/page.tsx`
  (`resolveActorFromSession()` + `actor?.rol !== "maestro"`).
- Capas Controller→Service→Repository con interfaces y Server Actions:
  `lib/actions/usuarios.ts`, `lib/services/UsuarioService.ts`,
  `lib/interfaces/services/IUsuarioService.ts` (`ALLOWED_ROLES = {"maestro"}`).
- Errores: `lib/errors` + `lib/actions/_shared/to-action-error` (feature 10).
- Enum Postgres nativo + `@@map`: patrón `EstadoTarifa`/`RolValue` del
  `db/schema.prisma`; RLS habilitada sin policies (patrón `api_key`).

**Fuera de alcance (follow-up, declarado):** envío real del mensaje por cualquier
canal (WhatsApp/SMS/email); la máquina de estados de moderación que produce
`pending`/`refused` desde el backend; versionado/historial de plantillas;
internacionalización de las etiquetas de variables; búsqueda/filtrado avanzado del
listado.

---

## Bloque A — Visibilidad y acceso

- **R1 (Opcional/De estado):** DONDE el actor autenticado tiene rol `maestro`, el
  sistema DEBE mostrar en el menú Configuración el subítem "Plantillas" apuntando a
  `/configuracion/plantillas`.
- **R2 (De estado):** MIENTRAS el actor autenticado NO tiene rol `maestro`, el
  sistema DEBE ocultar el subítem "Plantillas" del menú.
- **R3 (Condicional):** SI se solicita `/configuracion/plantillas` con una sesión de
  rol distinto de `maestro`, ENTONCES el sistema DEBE denegar el acceso server-side
  (no renderizar el módulo de plantillas) y mostrar un aviso de sin permiso.
- **R4 (Condicional):** SI cualquier Server Action de plantillas se invoca sin sesión
  válida, ENTONCES el sistema DEBE responder `unauthenticated` sin tocar la base de
  datos.
- **R5 (Condicional):** SI cualquier Server Action de plantillas se invoca con un
  actor cuyo rol no es `maestro`, ENTONCES el sistema DEBE responder `forbidden` sin
  ejecutar la operación.

## Bloque B — Listado

- **R6 (Ubicuo):** El sistema DEBE listar las plantillas de mensaje con su nombre,
  su estado actual y su cuerpo, ordenadas de forma determinista (por defecto por
  fecha de creación descendente).
- **R7 (Ubicuo):** El listado DEBE ser paginado con un tamaño de página por defecto y
  una cota máxima configurables, sin exponer consultas sin límite.

## Bloque C — Creación

- **R8 (Por evento):** CUANDO el maestro crea una plantilla con un nombre y un cuerpo
  válidos, el sistema DEBE persistirla y devolver la plantilla creada.
- **R9 (Condicional):** SI el nombre de la plantilla está vacío, ENTONCES el sistema
  DEBE rechazar la creación con error de validación sobre el campo `nombre`.
- **R10 (Condicional):** SI ya existe una plantilla con el mismo nombre, ENTONCES el
  sistema DEBE rechazar la creación con conflicto sobre el campo `nombre`.
- **R11 (Condicional):** SI el cuerpo de la plantilla está vacío, ENTONCES el sistema
  DEBE rechazar la creación con error de validación sobre el campo `cuerpo`.
- **R12 (Por evento):** CUANDO se crea una plantilla desde el front, el sistema DEBE
  persistirla con el estado inicial `pending` (Decisión humana 1).

## Bloque D — Campos variables (catálogo abierto y persistencia del array)

- **R13 (Ubicuo):** El sistema NO DEBE traer variables predefinidas: por defecto el
  catálogo semilla está VACÍO (Corrección humana 2026-07-22). El usuario DEBE poder
  INGRESAR/DEFINIR en el cuerpo TANTAS variables como necesite (CERO o más), sin límite
  y sin lista fija. Cualquier `{{clave}}` bien formada (R14) es una variable válida; el
  modelo de variables es totalmente ABIERTO/data-driven (sin tipo cerrado ni catálogo
  fijo de `usuario`/`cod`, que fueron solo un ejemplo del pedido). Una plantilla con CERO
  variables (cuerpo sin placeholders) es válida.
- **R14 (Ubicuo):** El sistema DEBE reconocer los campos variables en el cuerpo con la
  sintaxis `{{clave}}` (se admiten espacios internos, p. ej. `{{ clave }}`, que se
  normalizan; `clave` con formato `[a-z0-9_]+`).
- **R15 (Por evento):** CUANDO se crea o edita una plantilla, el sistema DEBE ACEPTAR
  cualquier placeholder `{{clave}}` bien formado (sin lista blanca cerrada) y DEBE
  persistir, en un ARRAY de claves, el conjunto de variables detectadas en el cuerpo
  (sin duplicados), manteniéndolo sincronizado con el cuerpo.
- **R16 (Condicional):** SI el cuerpo contiene una llave doble mal formada (p. ej.
  `{{}}` o `{{ }}` sin clave, o una clave con caracteres fuera de `[a-z0-9_]`),
  ENTONCES el sistema DEBE rechazarlo con error de validación sobre el campo `cuerpo`.
- **R17 (Opcional):** DONDE el usuario edita el cuerpo en la UI, el sistema DEBE
  permitirle DEFINIR una variable escribiendo su clave (formato `[a-z0-9_]+`) e
  INSERTARLA como `{{clave}}` en la posición del cursor, tantas veces como quiera (0 o
  más), sin depender de un catálogo predefinido. Rechaza en la UI una clave con formato
  inválido antes de insertarla.

## Bloque E — Vista previa / render

- **R18 (Por evento):** CUANDO se solicita la vista previa de una plantilla, el
  sistema DEBE devolver el cuerpo con cada placeholder cuya clave está en el catálogo
  sustituido por el valor de ejemplo de esa variable; una clave bien formada pero
  fuera del catálogo se sustituye por un marcador legible derivado de la clave (p. ej.
  la clave en mayúsculas) SIN romper la preview.
- **R19 (Ubicuo):** La sustitución de la vista previa DEBE reemplazar TODAS las
  ocurrencias de cada placeholder y NO DEBE alterar el texto que no sea un
  placeholder.

## Bloque F — Edición

- **R20 (Por evento):** CUANDO el maestro edita el nombre y/o el cuerpo de una
  plantilla existente con datos válidos, el sistema DEBE persistir los cambios y
  devolver la plantilla actualizada.
- **R21 (Condicional):** SI se edita una plantilla inexistente, ENTONCES el sistema
  DEBE responder `not_found`.
- **R22 (Ubicuo):** La edición DEBE aplicar las mismas validaciones de nombre y de
  cuerpo/placeholders que la creación (R9, R11, R15, R16), el mismo recálculo del array
  de variables (R15) y el mismo control de unicidad de nombre (R10) excluyendo la
  propia plantilla.

## Bloque G — Estado y máquina de transiciones

- **R23 (Ubicuo):** El sistema DEBE modelar el estado de una plantilla como un enum
  persistido con EXACTAMENTE los cuatro valores `activo`, `inactivo`, `pending`,
  `refused`.
- **R24 (Por evento):** CUANDO el maestro DESACTIVA una plantilla desde el front, el
  sistema DEBE moverla a `inactivo` y persistir el cambio. Es la ÚNICA transición de
  estado expuesta en el front (Corrección humana). ACTIVAR (`pending`/`inactivo` →
  `activo`) NO está en este alcance.
- **R25 (Condicional):** SI una Server Action de cambio de estado recibe un destino
  distinto de `inactivo` (p. ej. `activo`, `pending` o `refused`), ENTONCES el sistema
  DEBE rechazarlo con error de validación (el destino del front está acotado a
  `inactivo`; `activo`/`pending`/`refused` no son destinos expuestos en este alcance).
- **R26 (Condicional):** SI se cambia el estado de una plantilla inexistente (o ya
  eliminada), ENTONCES el sistema DEBE responder `not_found`.

## Bloque H — Eliminación (soft delete)

- **R27 (Por evento):** CUANDO el maestro elimina una plantilla existente, el sistema
  DEBE marcarla como eliminada fijando `deletedAt` (SOFT DELETE, Decisión humana 3) y
  devolver un resultado de éxito, sin borrar la fila físicamente.
- **R28 (Ubicuo):** Los listados y las lecturas por id DEBEN excluir por defecto las
  plantillas con `deletedAt IS NOT NULL`.
- **R29 (Condicional):** SI se elimina una plantilla inexistente o ya eliminada,
  ENTONCES el sistema DEBE responder `not_found`.

## Bloque I — Persistencia y seguridad

- **R30 (Ubicuo):** La tabla de plantillas DEBE tener Row Level Security habilitada
  (patrón de las tablas nuevas del repo), con la autorización de negocio (`maestro`)
  aplicada en el service.
- **R31 (Ubicuo):** La migración que crea la tabla y el enum DEBE ser reversible
  (`migration.sql` UP + `down.sql` DOWN que revierte exactamente).

---

## Preguntas abiertas (requieren decisión humana)

Las 4 decisiones humanas quedaron incorporadas (estado inicial `pending`, máquina de
transiciones del front con origen `pending`/`inactivo` → `activo`, soft delete con
`deletedAt`, catálogo abierto + array de variables persistido). Sigue abierto:

1. **Semántica de `pending`/`refused` en el backend.** El enum los reserva pero este
   alcance NO tiene productor de la transición a `refused`. ¿Qué evento del backend la
   dispara (revisión humana, integración de un canal externo)? Queda como follow-up
   salvo indicación.
2. **Catálogo de variables inicial.** Se entrega el mínimo `usuario` y `cod` en la
   fuente data-driven. ¿Se quieren más desde el día uno (p. ej. `direccion`, `tienda`,
   `telefono`)? Al ser abierto, solo se añaden filas a la constante, sin migrar código.
