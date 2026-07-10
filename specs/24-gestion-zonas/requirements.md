# Feature 24 — Gestión de zonas (configuración) · requirements.md

> Notación EARS. Cada `R<n>` es testeable. Sin detalles de implementación
> (esos van en `design.md`). Basado en el esquema real (`db/schema.prisma`):
> `zona`, `provincia (zona_id)`, `canton (provincia_id)`, `distrito (canton_id)`,
> `usuario`, `orden (zona_id ya existe)`. La jerarquía NO se remodela
> (decisión humana 2026-07-10).

## Alcance verificable (resumen)

Gestión CRUD de zonas por el rol `maestro` dentro de `app/(app)/configuracion`,
poblando la geografía (provincia/cantón/distritos) como hijos de la zona,
añadiendo pago al mensajero por entrega/rechazo y un flag de zona GAM/central,
asignando `zona_id` a usuarios de rol `mensajero`/`adminSatelite`, con migración
Prisma (up + `down.sql` + RLS) y un seed desde Excel (gate de impl).

---

## A. Datos y migración

- **R1** — El sistema DEBE, mediante una migración Prisma con `migration.sql` y su
  `down.sql`, añadir a la tabla `zona` tres columnas: `pago_entrega` (monto,
  precisión fija, no negativo), `pago_rechazo` (monto, precisión fija, no negativo)
  y `es_gam` (booleano). Las columnas nuevas DEBEN tener valores por defecto que
  no rompan las filas existentes de `zona`.

- **R2** — El sistema DEBE, en la misma migración, añadir a la tabla `usuario` la
  columna `zona_id` como FK nullable hacia `zona(id)`, con índice de soporte, sin
  alterar columnas preexistentes de `usuario`.

- **R3** — CUANDO se ejecute el `down.sql` de esta migración, el sistema DEBE
  revertir exactamente sus cambios (eliminar `usuario.zona_id` con su FK e índice,
  y las tres columnas nuevas de `zona`) sin tocar `orden.zona_id` ni ninguna otra
  tabla o migración previa.

- **R4** — El sistema DEBE habilitar Row Level Security sobre `zona`, `provincia`,
  `canton` y `distrito` sin definir policies para `anon`/`authenticated` (acceso
  solo vía service role del servidor), coherente con `usuario`/`cobro`/`vehiculos`.

- **R5** — MIENTRAS la FK `usuario.zona_id` exista, el sistema DEBE impedir a nivel
  de base de datos que un usuario referencie una zona inexistente (integridad
  referencial), y DEBE permitir `zona_id` nulo.

- **R6** — MIENTRAS existan órdenes o usuarios que referencian una zona, el sistema
  DEBE impedir el borrado físico de esa zona a nivel de base de datos (FK
  `ON DELETE RESTRICT`).

## B. Backend — CRUD de zona y poblado de geografía

- **R7** — CUANDO un actor invoque cualquier acción de zonas sin sesión válida, el
  sistema DEBE responder con estado `unauthenticated` y NO tocar el service.

- **R8** — SI el actor autenticado no tiene rol de escritura de zonas (ver Decisión
  D2), ENTONCES el sistema DEBE responder `forbidden` y no crear/editar datos.

- **R9** — CUANDO el rol autorizado cree una zona con un nombre válido y una
  estructura de geografía (una provincia, un cantón y uno o más distritos), el
  sistema DEBE crear la fila `zona` y, atómicamente, las filas `provincia`,
  `canton` y `distrito` enlazadas por sus FKs (`zona_id`, `provincia_id`,
  `canton_id`), devolviendo estado `ok` con la zona creada.

- **R10** — SI la creación de la geografía hija falla a mitad, ENTONCES el sistema
  DEBE no persistir ninguna fila de esa operación (transacción todo-o-nada).

- **R11** — El sistema DEBE rechazar con estado `validation_error` una creación/edición
  de zona cuyo nombre esté vacío, cuyos montos de pago sean negativos o no numéricos,
  o que no incluya al menos un distrito bajo un cantón bajo una provincia.

- **R12** — SI ya existe una zona con el mismo nombre (normalizado), ENTONCES una
  creación/edición DEBE responder estado `conflict` y no duplicar (ver Decisión D4).

- **R13** — CUANDO el rol autorizado edite una zona existente, el sistema DEBE
  permitir cambiar su `nombre`, `pago_entrega`, `pago_rechazo` y `es_gam`, y
  actualizar el conjunto de provincia/cantón/distritos que le pertenecen,
  devolviendo estado `ok`; DEBE responder `not_found` si la zona no existe.

- **R14** — CUANDO el rol autorizado marque una zona con `es_gam = true`, el sistema
  DEBE garantizar que a lo sumo una zona tenga `es_gam = true` en todo el sistema
  (ver Decisión D5): al marcar una nueva, desmarca la anterior o rechaza con
  `conflict` según la decisión aprobada.

- **R15** — CUANDO el rol autorizado liste zonas, el sistema DEBE devolver estado
  `ok` con los ítems paginados (page/pageSize acotado a un máximo) y el total,
  exponiendo por zona: `id`, `nombre`, `pago_entrega`, `pago_rechazo`, `es_gam` y
  un resumen de su geografía (provincia/cantón/nº de distritos).

- **R16** — El sistema DEBE exponer las operaciones de zona como Server Actions cuyo
  contrato de salida sea un objeto discriminado por `status`
  (`ok` | `validation_error` | `unauthenticated` | `forbidden` | `not_found` |
  `conflict`), reusando el manejador de errores global (feature 10) y sin lanzar
  excepciones no controladas al cliente.

- **R17** — Las Server Actions de zona NUNCA DEBEN exponer campos internos no
  destinados al cliente (p. ej. timestamps de borrado si los hubiera); DEBEN
  devolver un DTO explícito con montos como `number` (no `Decimal` ni string).

- **R18** — DONDE el actor consulte el catálogo de zonas para asignación (selector),
  el sistema DEBE ofrecer una operación de listado ligero (id + nombre + es_gam)
  reutilizable por otras features (usuarios, órdenes).

## C. Asignación de zona a usuarios

- **R19** — CUANDO se cree o edite un usuario de rol `mensajero` o `adminSatelite`,
  el sistema DEBE permitir asignar un `zona_id` existente; para otros roles el
  `zona_id` DEBE permanecer nulo (ver Decisión abierta sobre obligatoriedad).

- **R20** — SI se intenta asignar a un usuario un `zona_id` que no corresponde a una
  zona existente, ENTONCES el sistema DEBE responder `validation_error` y no
  persistir el cambio.

## D. Frontend — pantalla en configuración

- **R21** — MIENTRAS un actor sin rol autorizado acceda a la sección de zonas dentro
  de `app/(app)/configuracion`, el sistema DEBE no renderizar el módulo de zonas y
  mostrar un mensaje de sin permiso (autorización server-side, patrón feature 25).

- **R22** — CUANDO el rol autorizado abra la sección de zonas, el sistema DEBE
  mostrar un listado de zonas con DataTable + paginación, precargado en el servidor.

- **R23** — CUANDO el rol autorizado pulse crear/editar zona, el sistema DEBE abrir
  un Modal con un formulario que capture: nombre, provincia, cantón, uno o más
  distritos, `pago_entrega`, `pago_rechazo` y el flag `es_gam`.

- **R24** — CUANDO una acción de crear/editar/marcar-GAM concluya, el sistema DEBE
  mostrar un Toast de éxito o de error según el `status` devuelto, y refrescar el
  listado en caso de éxito.

- **R25** — SI la Server Action devuelve `validation_error` con `fieldErrors`, el
  formulario DEBE mostrar los mensajes junto a los campos correspondientes sin
  perder los valores ya ingresados.

## E. Seed base (gate de impl)

- **R26** — El sistema DEBE proveer un script de seed idempotente (patrón
  `scripts/seed-*.ts` con `exceljs`) que, a partir de un archivo Excel provisto por
  el humano, cree/actualice las zonas de 'Orden X' con su geografía y sus montos de
  pago, sin duplicar en ejecuciones repetidas.

- **R27** — MIENTRAS el archivo Excel no esté disponible, el seed NO DEBE ejecutarse
  contra datos reales; la task de seed queda bloqueada (gate) hasta recibir el
  archivo con el formato definido en `design.md`.

- **R28** — CUANDO el seed encuentre una zona con nombre ya existente, el sistema
  DEBE actualizar (no duplicar) manteniendo el `id` existente (upsert por nombre).

---

## Trazabilidad
El mapa R→test propuesto vive en `design.md` (sección "Trazabilidad R→test"). El
implementer lo confirma en `progress/impl_24-gestion-zonas.md`.

---

## Preguntas abiertas (para la puerta de aprobación humana F1.4)

Cada una lleva mi **propuesta firme**; el humano confirma o corrige.

1. **Nombres/tipos de columnas de pago y flag GAM en `zona`.**
   Propuesta: `pago_entrega Decimal @db.Decimal(12,2)` default `0`,
   `pago_rechazo Decimal @db.Decimal(12,2)` default `0` (mismo tipo que
   `cobro.valor_flete`), y `es_gam Boolean` default `false`. Nombre del flag:
   `es_gam` (no `es_central`), por alinear con el vocabulario de la feature 30 y de
   `cobro.valor_flete_gam`.

2. **¿`admin` además de `maestro` gestiona zonas?**
   Propuesta: escritura SOLO `maestro` (igual que `CobroService.WRITE_ROLES` y
   feature 25). Lectura del catálogo ligero (R18): `maestro` + `admin`. Confirmar
   si `admin` debe además crear/editar.

3. **Selección de provincia/cantón/distritos con las tablas vacías.**
   Propuesta: creación **inline** dentro del formulario de zona (se escriben los
   nombres; el backend los inserta como hijos). No hay catálogo precargado de
   provincias/cantones de Ecuador; la geografía se puebla exclusivamente como hijos
   de una zona. En edición se reutilizan/renombran las filas ya creadas.
   ¿El humano quiere en su lugar un catálogo maestro precargado de Ecuador?

4. **Unicidad.**
   Propuesta: `nombre` de zona **único** (normalizado: trim + lowercase para
   comparación) → habilita el upsert idempotente del seed (R28). Y **un solo**
   `es_gam = true` en el sistema, forzando desmarcado de la anterior al marcar una
   nueva (R14). Confirmar si prefiere rechazar con `conflict` en vez de desmarcar.

5. **Borrado de zona con usuarios/órdenes asociados.**
   Propuesta: **no** exponer borrado en esta feature (solo crear/listar/editar,
   como pide el alcance). A nivel DB, FK `ON DELETE RESTRICT` (R6). Si más adelante
   se requiere borrado, será baja lógica (`deleted_at`) como `cobro`/`orden`, nunca
   físico con dependientes. Confirmar si se desea baja lógica ya en esta feature.

6. **Obligatoriedad de `zona_id` en usuarios mensajero/adminSatelite.**
   Propuesta: columna **nullable** en DB (R2) para no romper filas existentes; la
   obligatoriedad ("todo mensajero/adminSatelite debe tener zona") se valida en el
   servicio de usuarios como regla de negocio, no en el schema. Confirmar si debe
   ser obligatoria ya al crear, o puede quedar pendiente de asignación.

7. **Formato/columnas del Excel de seed (para que el humano lo prepare).**
   Propuesta de columnas (una fila por distrito, desnormalizado):
   `zona` | `provincia` | `canton` | `distrito` | `pago_entrega` | `pago_rechazo` |
   `es_gam`. `pago_entrega`/`pago_rechazo` numéricos; `es_gam` booleano
   (`true`/`false` o `1`/`0`), a lo sumo una zona con `true`. Hoja única. Confirmar
   nombres de encabezado y si habrá una zona GAM marcada en el propio Excel.

## Decisiones F1.4 (APROBADAS por el humano, 2026-07-10)

El humano aprobó el spec con las 7 propuestas firmes tal cual (respuesta "aprobado"):

- **P1** — `zona.pago_entrega`/`zona.pago_rechazo` `Decimal @db.Decimal(12,2)` default `0`;
  `zona.es_gam Boolean` default `false` (nombre `es_gam`).
- **P2** — Escritura de zonas SOLO rol `maestro`; lectura del catálogo ligero `maestro` + `admin`.
- **P3** — Geografía (provincia/cantón/distritos) por creación **inline** en el formulario de zona;
  sin catálogo nacional precargado.
- **P4** — `nombre` de zona **único** (normalizado trim+lowercase); **un solo** `es_gam=true`
  (al marcar una nueva se desmarca la anterior).
- **P5** — Sin borrado en esta feature (solo crear/listar/editar); FK `ON DELETE RESTRICT`.
- **P6** — `usuario.zona_id` **nullable** en DB; obligatoriedad para mensajero/adminSatelite como
  regla de negocio en el servicio de usuarios (no en el schema).
- **P7** — Excel de seed: una fila por distrito, columnas
  `zona | provincia | canton | distrito | pago_entrega | pago_rechazo | es_gam`, hoja única,
  a lo sumo una zona con `es_gam=true`.

### GATES de implementación (F2) — impl EN ESPERA
1. **No paralelizable con la feature 27** (también fullstack, `in_progress` en otra sesión que ya
   modifica `db/schema.prisma`, `UserRepository`/`IUserRepository` y la UI de configuración). La
   migración de `usuario` (zona_id) y los repos chocarían. La impl de la 24 arranca cuando la 27
   esté `done` (mergeada a `dev`), y entonces la 24 se sincroniza con ese `dev`.
2. **Seed (E / T de seed) necesita el Excel de zonas** que proveerá el humano. Todo lo demás
   (migración + backend CRUD + UI) puede implementarse sin el Excel; solo la carga de datos del
   seed queda como gate/deuda hasta recibirlo.
