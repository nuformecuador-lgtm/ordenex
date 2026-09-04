# Ficha 373 — Eliminar una API key · requirements

> **Estado:** borrador para la puerta de aprobación humana (`spec_ready`).
> **Zona:** `fullstack` · **Complejidad:** media · **Rama:** `feat/373-eliminar-api-key`.
> **Frontera de alcance fijada por el humano el 2026-09-04** (§4): solo se elimina la key
> **desactivada y sin rastro de datos**. Para el resto, la revocación sigue siendo «Desactivar».

## 0. Contexto verificado (no supuesto)

### 0.1 Medido contra producción por el leader el 2026-09-04

| Key | Estado | Órdenes | Tarifas | Movimientos de wallet | Pagos de liquidación | Webhook |
| --- | --- | --- | --- | --- | --- | --- |
| API Nuform | `activa` | 0 | 0 | 0 | 0 | no |
| Api Pruebas | `activa` | 0 | 0 | 0 | 0 | no |

Las dos son del 2026-08-28. **Ninguna FK apunta a `api_key`** (cero constraints en
`information_schema`). Hoy hay **3** filas de `historial_accion` con `entidad_tipo = 'api_key'`.

**Consecuencia directa, y es la que gobierna esta ficha:** por datos, las dos keys serían
borrables. Por estado, **ninguna de las dos lo es hoy**, porque las dos están `activa` y R11 exige
desactivar antes. Eso es lo correcto y no un efecto colateral: «API Nuform» es la key **en uso**, y
sin la condición de estado un borrado accidental dejaría al integrador fuera sin ningún aviso.
El camino queda: desactivar (reversible y visible) → eliminar (irreversible).

Se toma también como dado, medido por el leader el mismo día:

- El rastro de auditoría **sobrevive al borrado físico por diseño**: `historial_accion.entidad_id`
  es opaco y sin FK, y `entidad_etiqueta` va denormalizada (`db/schema.prisma:3116`). La ficha 362
  ya contemplaba entidades que se borran en físico.
- Con `tienda_destino_id` (feature 302) las órdenes pertenecen a la TIENDA, no a la cuenta
  dedicada (`lib/utils/api-key-owner.ts`). Por eso las dos keys tienen 0 órdenes propias.

### 0.2 Confirmado leyendo el árbol, archivo por archivo, el 2026-09-04

| Afirmación | Dónde se confirmó |
| --- | --- |
| El ciclo de vida hoy es rotar / activar / desactivar. **No existe ningún borrado** de API key | `lib/services/ApiKeyService.ts` (6 métodos) · `lib/interfaces/repositories/IApiKeyRepository.ts` (6 métodos) · `lib/actions/api-keys.ts` (6 actions) |
| La celda de acciones pinta exactamente dos botones: «Rotar» y «Activar/Desactivar» | `app/(app)/configuracion/api/_components/ApiKeyAccionCell.tsx:80-101` |
| El `estado` propio de la key (`activa`/`inactiva`) ya viaja en el DTO del listado | `ApiKeyRepository.LIST_SELECT` (`:71-83`) · `IApiKeyRepository.ApiKeyListItem:109` |
| La cuenta dedicada se crea 1:1 con la key, con `email` y `cedula` derivados del identificador | `lib/repositories/ApiKeyRepository.ts:117-131` · `lib/services/ApiKeyService.ts:110-119` |
| Un identificador cuya cuenta ya existe da `conflict` por `email`/`cedula` | `lib/repositories/ApiKeyRepository.ts:360-367` (`mapDuplicadoError`) · `ApiKeyService.ts:125-128` |
| El listado proyecta un DTO acotado, sin secreto ni hash | `LIST_SELECT` (`:71-83`) · `ApiKeyListItem` (`:99-114`) |
| Autorización en dos capas: actor en la Server Action, rol `maestro` en el service | `lib/actions/api-keys.ts:151-158` · `ApiKeyService.ALLOWED_ROLES` (`:29`) |
| Desactivar es **la palanca de revocación** y es reversible: `estado='inactiva'` corta la carga en la autenticación | `ApiKeyService.desactivar` (`:223-229`) · `ApiKeyAutenticada.apiKeyEstado` (`IApiKeyRepository.ts:40-44`) |
| Las cuatro acciones de API key ya existentes están en la categoría «cambia permisos» | `lib/types/historial-accion.ts:206-209` |
| `historial_accion_tipo` es un enum NATIVO de Postgres y hoy tiene 44 valores | `lib/types/historial-accion.ts:40-122` · `db/migrations/20260902120000_historial_accion/migration.sql` |
| Un valor nuevo se añade con `ALTER TYPE … ADD VALUE`; el `down.sql` **recrea el tipo con la lista previa** (no existe `DROP VALUE`) | `db/migrations/20260903120000_historial_accion_orden_zona_reconciliada/{migration,down}.sql` |
| El registro de la acción se escribe SIEMPRE en la misma `$transaction` de la mutación, por el punto único `appendAccion` | `lib/repositories/registrar-accion.ts:49-79` · guardia `tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts` |
| La suscripción de webhook cuelga de `owner_usuario_id` (único), su FK a `usuario` es `Restrict` y hoy **no se borra nunca**, solo se marca `activa = false` | `db/schema.prisma:2360-2373` · `lib/repositories/WebhookSuscripcionRepository.ts:84` |
| Las órdenes usan **soft delete**: una orden borrada conserva su fila y su FK a la tienda | `db/schema.prisma` (`Orden.deletedAt`) · `OrdenRepository.softDeleteViaApi` |

## 1. Glosario

- **Key** — fila de la tabla `api_key`.
- **Cuenta dedicada** — la fila de `usuario` (rol `apiKey`) que la key crea 1:1 al generarse. Es
  QUIÉN ENTRA con la credencial. No es una persona.
- **Tienda destino** — la cuenta `adminTienda` REAL a la que apunta la key (feature 302), o
  ninguna. **No es la cuenta dedicada** y no se toca en esta ficha.
- **Eliminable** — la key cumple TODAS las condiciones del guard (§2.B): está desactivada y su
  cuenta dedicada no tiene rastro.
- **Rastro de datos** — filas de otras tablas que apuntan a la cuenta dedicada y que documentan
  actividad, dinero o configuración suya.
- **Registro de acciones** — la tabla `historial_accion` de la ficha 362.

---

## 2. Requisitos

### A · El borrado

- **R1** — El sistema DEBE ofrecer, en el listado de `Configuración > API`, una acción para
  ELIMINAR una API key, distinta de rotar, activar y desactivar.

- **R2** — CUANDO un usuario con rol `maestro` confirma la eliminación de una API key eliminable,
  el sistema DEBE borrar en FÍSICO, en una sola operación atómica: (a) la fila de `api_key`,
  (b) la fila de `usuario` de su cuenta dedicada, y (c) la suscripción de webhook cuyo owner sea
  esa cuenta dedicada, si existe.

- **R3** — CUANDO el sistema elimina una API key, DEBE borrar EXACTAMENTE las filas de esa key
  descritas en R2 y NO DEBE borrar ni modificar ninguna fila de ninguna otra key, de ninguna otra
  cuenta ni de ninguna otra suscripción.

- **R4** — SI cualquiera de los borrados de R2 falla, ENTONCES el sistema NO DEBE dejar
  persistido ninguno de ellos, NO DEBE dejar persistida la fila de auditoría de R22, y DEBE
  informar del fallo sin haber producido ningún efecto parcial.

- **R5** — El sistema NO DEBE borrar ni modificar la cuenta de la **tienda destino** de la key
  (feature 302), ni su suscripción de webhook, ni ninguna de sus órdenes, como consecuencia de
  eliminar la key.

- **R6** — CUANDO el sistema elimina una API key, el identificador de esa key DEBE quedar
  REUTILIZABLE: generar después una key nueva con el mismo identificador DEBE terminar en éxito y
  NO DEBE terminar en conflicto por email ni por cédula.

- **R7** — El sistema NO DEBE ofrecer ninguna forma de deshacer una eliminación ya ejecutada, y
  NO DEBE conservar la fila borrada en ninguna tabla.

### B · Qué key es eliminable (el guard)

- **R8** — El sistema DEBE considerar NO eliminable toda API key cuya cuenta dedicada tenga al
  menos una orden a su nombre, **contando también las órdenes borradas**.

- **R9** — El sistema DEBE considerar NO eliminable toda API key cuya cuenta dedicada tenga al
  menos un movimiento de dinero a su nombre (libro de tienda o pago de liquidación).

- **R10** — El sistema DEBE considerar NO eliminable toda API key cuya cuenta dedicada tenga al
  menos una tarifa configurada a su nombre.

- **R11** — El sistema DEBE considerar NO eliminable toda API key cuyo estado sea `activa`. En
  consecuencia, eliminar una key EXIGE desactivarla antes, y desactivar DEBE seguir siendo una
  operación reversible que no borra nada.

- **R12** — SI una API key no es eliminable, ENTONCES el sistema DEBE rechazar su eliminación sin
  borrar ni modificar ninguna fila, y DEBE indicar cuál de los motivos de R8–R11 la bloquea.

- **R13** — CUANDO más de un motivo de R8–R11 concurre sobre la misma key, el sistema DEBE
  indicar siempre el mismo motivo, según una precedencia fija y declarada: órdenes, luego dinero,
  luego tarifas, luego estado activo.

- **R14** — MIENTRAS una API key no sea eliminable, el sistema DEBE seguir mostrándola en el
  listado y DEBE seguir ofreciendo rotar, activar y desactivar con su comportamiento actual.

- **R15** — CUANDO el sistema ejecuta la eliminación, DEBE volver a evaluar el guard de R8–R11
  dentro de la misma transacción del borrado y ANTES de cualquier escritura, sin fiarse de la
  evaluación con la que se pintó el listado.

- **R16** — SI el borrado no puede completarse porque alguna fila de otra tabla sigue apuntando a
  la cuenta dedicada, ENTONCES el sistema DEBE revertir la operación entera, DEBE responder como
  bloqueada y NO DEBE producir un error no controlado ni un borrado parcial.

- **R17** — El sistema DEBE clasificar TODA relación declarada hacia `usuario` en el esquema en
  exactamente una de estas tres categorías: (a) bloquea el borrado, (b) se borra junto con la
  cuenta dedicada, (c) no alcanzable por una cuenta dedicada —con el motivo escrito—. Y la
  verificación DEBE fallar si aparece en el esquema una relación hacia `usuario` sin clasificar.

### C · Autorización y borde

- **R18** — SI el actor no tiene rol `maestro`, ENTONCES el sistema DEBE rechazar la eliminación
  como prohibida y NO DEBE consultar ni escribir en la base.

- **R19** — SI la petición llega sin sesión, ENTONCES el sistema DEBE rechazarla como no
  autenticada y NO DEBE llegar a evaluar la eliminación.

- **R20** — SI la entrada no identifica una key con un identificador válido, o trae claves
  desconocidas, ENTONCES el sistema DEBE rechazarla como error de validación en el borde y NO DEBE
  consultar la base.

- **R21** — SI la key identificada ya no existe cuando se ejecuta el borrado, ENTONCES el sistema
  DEBE responder «no encontrada», sin efectos secundarios y sin error no controlado.

### D · El rastro de auditoría

- **R22** — CUANDO el sistema elimina una API key, DEBE registrar en el registro de acciones
  EXACTAMENTE UNA fila con la acción `api_key_eliminada`, sobre la entidad `api_key`, dentro de la
  MISMA transacción del borrado.

- **R23** — La fila de R22 DEBE identificar la key por su identificador visible, y NO DEBE
  contener el secreto en claro, ni el `key_hash`, ni el `key_prefix`.

- **R24** — La fila de R22 DEBE registrar quién eliminó —con nombre y rol congelados en el
  momento del borrado— y el estado que la key tenía justo antes de eliminarse.

- **R25** — El sistema DEBE clasificar `api_key_eliminada` en la categoría «cambia permisos», la
  misma que las otras cuatro acciones de API key, y DEBE ofrecerla con etiqueta legible y como
  valor de filtro en el registro de acciones.

- **R26** — MIENTRAS existan filas del registro de acciones referidas a una key ya eliminada, el
  sistema DEBE seguir listándolas sin cambios, con su acción, su etiqueta de entidad, su actor y
  su fecha intactos.

- **R27** — SI se revierte la migración que añade `api_key_eliminada`, ENTONCES la reversión DEBE
  fallar ruidosamente mientras exista alguna fila del registro con esa acción, y NO DEBE borrar ni
  reescribir esas filas.

### E · Lo que ve el usuario

- **R28** — MIENTRAS una API key no sea eliminable, la acción de eliminar DEBE presentarse
  deshabilitada, y el motivo DEBE ser perceptible por el usuario sin llegar a pulsarla.

- **R29** — CUANDO un usuario con rol `maestro` pide eliminar una API key eliminable, el sistema
  DEBE pedir una confirmación explícita antes de ejecutar nada.

- **R30** — La confirmación DEBE nombrar la key por su identificador y DEBE enunciar las tres
  consecuencias del borrado: (a) es irreversible, (b) el secreto deja de funcionar de forma
  definitiva, y (c) desaparecen también su cuenta dedicada y su suscripción de webhook.

- **R31** — La confirmación DEBE recordar que la key ya está desactivada y que dejarla así revoca
  el acceso sin borrar nada, como alternativa no destructiva.

- **R32** — CUANDO el usuario cancela la confirmación, el sistema NO DEBE eliminar nada.

- **R33** — CUANDO la eliminación termina con éxito, el sistema DEBE releer el listado visible y
  DEBE avisar al usuario de que la key se eliminó.

- **R34** — SI la eliminación falla, ENTONCES el sistema DEBE avisar con un mensaje distinto para
  cada caso —sin permiso, sin sesión, no encontrada, bloqueada— y DEBE dejar el listado mostrando
  el estado que devuelve el servidor.

- **R35** — CUANDO una eliminación con éxito deja sin filas la página visible del listado y esa
  página no es la primera, el sistema DEBE mostrar la página anterior.

- **R36** — El sistema NO DEBE mostrar, en ninguna pantalla ni mensaje de esta ficha, el secreto
  en claro, el `key_hash` ni el `key_prefix` completo.

### F · Lo que no cambia

- **R37** — El sistema DEBE seguir emitiendo en la descarga del inventario de API keys
  exactamente las mismas columnas que hoy, sin añadir ninguna derivada de esta ficha.

- **R38** — El sistema DEBE resolver la eliminabilidad de una página del listado con un número de
  consultas INDEPENDIENTE del número de filas de esa página.

- **R39** — El sistema NO DEBE introducir tablas, columnas, estados de borrado lógico ni
  mecanismos de archivado o retención para las API keys.

---

## 3. Trazabilidad `R<n>` → test

Nombres de archivo propuestos; el implementer los confirma en `progress/impl_373.md`.

| R | Test que lo cubre | Archivo |
| --- | --- | --- |
| R1 | «la celda de acciones pinta un botón Eliminar además de Rotar y Activar/Desactivar» | `tests/unit/components/api-key-eliminar.ui.test.tsx` |
| R2 | «maestro + key eliminable → borra api_key, usuario dedicado y webhook en una sola transacción» | `tests/unit/repositories/api-key-repository.eliminar.test.ts` · `tests/integration/db/api-key-eliminar.test.ts` |
| R3 | «con dos keys en la base, eliminar una deja intacta la otra y su cuenta» | `tests/integration/db/api-key-eliminar.test.ts` |
| R4 | «si el borrado del usuario falla, ni la key ni el webhook ni la fila de historial persisten» | `tests/integration/db/api-key-eliminar.test.ts` |
| R5 | «una key con tienda destino se elimina sin tocar la tienda, sus órdenes ni su webhook» | `tests/integration/db/api-key-eliminar-tienda-destino.test.ts` |
| R6 | «tras eliminar la key X, generar otra con el mismo identificador devuelve ok y no conflict» | `tests/integration/db/api-key-eliminar.test.ts` |
| R7 | «el servicio no expone ningún método de restauración y la fila no existe tras el borrado» | `tests/unit/services/api-key-service.eliminar.test.ts` |
| R8 | «cuenta con una orden viva → no eliminable» + «cuenta con SOLO una orden borrada → no eliminable» | `tests/integration/db/api-key-eliminabilidad.test.ts` |
| R9 | «cuenta con un movimiento del libro de tienda → no eliminable» + «con un pago de liquidación → no eliminable» | `tests/integration/db/api-key-eliminabilidad.test.ts` |
| R10 | «cuenta con una tarifa → no eliminable» | `tests/integration/db/api-key-eliminabilidad.test.ts` |
| R11 | «key `activa` y sin ningún dato → no eliminable, motivo `activa`» + «la misma key, desactivada → eliminable» + «desactivar no borró nada» | `tests/unit/services/api-key-service.eliminar.test.ts` · `tests/integration/db/api-key-eliminar.test.ts` |
| R12 | «key no eliminable → status bloqueada con motivo y CERO escrituras» (un caso por motivo) | `tests/unit/services/api-key-service.eliminar.test.ts` |
| R13 | «órdenes + tarifas + activa a la vez → el motivo devuelto es órdenes» y las demás combinaciones de la precedencia | `tests/unit/types/api-key-motivo-no-eliminable.test.ts` |
| R14 | «una fila no eliminable sigue listada y sus botones Rotar/Desactivar siguen habilitados» | `tests/unit/components/api-key-eliminar.ui.test.tsx` |
| R15 | «el guard se evalúa dentro de la tx y antes de cualquier delete» (orden de llamadas sobre el doble) | `tests/unit/repositories/api-key-repository.eliminar.test.ts` |
| R16 | «una FK inesperada que apunta a la cuenta dedicada → bloqueada, sin borrado parcial» (fila real que el guard no mira) | `tests/integration/db/api-key-eliminar-fk-inesperada.test.ts` |
| R17 | «toda relación hacia Usuario del esquema está clasificada; una relación nueva sin clasificar pone la guardia roja» (con contraprueba sobre un esquema mutado en memoria) | `tests/unit/guards/api-key-dependencias-usuario.guardia.test.ts` |
| R18 | «rol distinto de maestro → forbidden sin tocar el repositorio» | `tests/unit/services/api-key-service.eliminar.test.ts` |
| R19 | «sin sesión → unauthenticated sin instanciar el service» | `tests/unit/actions/api-keys-eliminar.test.ts` |
| R20 | «id que no es uuid → validation_error» + «clave desconocida → validation_error», ambos sin llamar al service | `tests/unit/actions/api-keys-eliminar.test.ts` |
| R21 | «id inexistente → not_found, sin lanzar y sin escrituras» | `tests/unit/services/api-key-service.eliminar.test.ts` |
| R22 | «el borrado escribe exactamente una fila de historial con accion api_key_eliminada, en la misma tx» | `tests/integration/db/api-key-eliminar.test.ts` · `tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts` (censo) |
| R23 | «la fila de historial no contiene el secreto, ni key_hash, ni key_prefix, en ninguna de sus columnas» | `tests/integration/db/api-key-eliminar.test.ts` |
| R24 | «la fila congela actor_nombre y actor_rol del maestro y lleva el estado previo (`inactiva`) en valor_anterior» | `tests/integration/db/api-key-eliminar.test.ts` |
| R25 | «api_key_eliminada está en el catálogo, en la categoría cambia_permisos, con etiqueta legible» | `tests/unit/historial-accion/catalogo-y-choke-point.test.ts` |
| R26 | «las filas de historial de una key eliminada siguen apareciendo en el listado del registro» | `tests/integration/db/api-key-eliminar.test.ts` |
| R27 | «el enum en la base coincide con el catálogo» + «el down.sql recrea la lista previa y falla si hay filas con el valor nuevo» | `tests/integration/db/api-key-eliminada-migration.test.ts` |
| R28 | «fila no eliminable → el botón está deshabilitado y su nombre accesible dice el motivo» (un caso por cada uno de los cuatro motivos) | `tests/unit/components/api-key-eliminar.ui.test.tsx` |
| R29 | «pulsar Eliminar abre la confirmación y NO llama a la acción» | `tests/unit/components/api-key-eliminar.ui.test.tsx` |
| R30 | «la confirmación nombra la key y enuncia las tres consecuencias» | `tests/unit/components/api-key-eliminar.ui.test.tsx` |
| R31 | «la confirmación dice que la key ya está desactivada y que dejarla así revoca el acceso» | `tests/unit/components/api-key-eliminar.ui.test.tsx` |
| R32 | «Cancelar cierra sin llamar a la acción» | `tests/unit/components/api-key-eliminar.ui.test.tsx` |
| R33 | «tras ok, refresca el listado y muestra el aviso de éxito» | `tests/unit/components/api-key-eliminar.ui.test.tsx` |
| R34 | «cada estado de error muestra su propio mensaje» (4 casos) | `tests/unit/components/api-key-eliminar.ui.test.tsx` |
| R35 | «borrada la última fila de la página 2, el módulo pide la página 1» | `tests/unit/components/api-keys-module.eliminar.test.tsx` |
| R36 | «ninguna cadena renderizada por el flujo de borrado contiene el prefijo completo ni un hash» | `tests/unit/components/api-key-eliminar.ui.test.tsx` |
| R37 | «COLUMNAS_DESCARGA_API_KEYS sigue siendo la misma lista y la fila de descarga no gana claves» | `tests/unit/descarga/api-keys-descarga-columnas.test.ts` |
| R38 | «listar una página de 25 filas hace el mismo número de consultas que una de 1» (espía sobre el cliente Prisma) | `tests/unit/repositories/api-key-repository.list.test.ts` |
| R39 | «no hay migración de esta ficha que cree tablas o columnas: su SQL solo contiene ALTER TYPE … ADD VALUE» | `tests/integration/db/api-key-eliminada-migration.test.ts` |

---

## 4. Fuera de alcance

Decidido por el humano el 2026-09-04. **No se amplía sin una ficha nueva.**

- Archivar u ocultar del listado las keys que no se pueden eliminar. Se quedan visibles.
- Retención, purga automática o caducidad de API keys.
- Soft delete, papelera, `deleted_at` o cualquier modelo de datos nuevo para `api_key`.
- Borrado en cascada de las órdenes, cargas, movimientos o tarifas de la cuenta dedicada.
- Borrado masivo o por selección múltiple: se elimina de a una, desde su fila.
- Reasignar las órdenes de una cuenta dedicada a otra tienda para poder borrarla después.
- Un borrado que desactive por su cuenta: desactivar es un acto aparte y explícito del maestro
  (R11). El botón de eliminar **no** desactiva de paso.
- Tocar el ciclo de vida existente (rotar / activar / desactivar) más allá de convivir con el
  botón nuevo y de leer el `estado` que ya expone.

---

## 5. Decisiones cerradas por el humano (2026-09-04)

No queda ninguna pregunta abierta. Las cinco del borrador se resolvieron así:

1. **La key debe estar `inactiva` para poder eliminarse** → **R11**, con su motivo propio en el
   vocabulario cerrado del botón deshabilitado. Motivo: el guard por datos deja borrable una key
   recién creada y **en uso** (0 órdenes), que es el caso literal de «API Nuform»; desactivar es
   reversible y se nota, borrar no.
2. **La confirmación es destructiva simple**, patrón de la ficha 332: **no** se exige teclear el
   identificador. Con el paso previo de desactivar, la fricción ya es suficiente.
3. **Una tarifa configurada BLOQUEA** (R10). Se mantiene tal como estaba escrito; **no** se aplica
   la alternativa de borrarlas en la misma transacción (`design.md §8-A2` queda como descartada).
4. **La medición de producción** cierra la duda sobre las tarifas: ninguna de las dos keys tiene
   tarifas, ni movimientos, ni pagos (§0.1).
5. **La columna «Webhook» NO está rota.** El borrador la señaló por leer solo la celda; la cadena
   completa la desmiente: las cuatro Server Actions de `lib/actions/webhooks.ts` resuelven el owner
   **en el servidor** con `resolverOwnerWebhook`, que ante rol `apiKey` devuelve su tienda destino;
   y pasar `ownerUsuarioId` desde la celda tomaría la rama «cuenta que ES tienda destino de alguna
   key → ella misma» y llegaría **al mismo id**. Los dos caminos convergen en la tienda destino,
   que es la que consulta el despachador: es redundante, no un fallo. **No se abre ficha.**
6. **Sesiones e intentos de login de la cuenta dedicada no cuentan como rastro**, y se dice en voz
   alta en `design.md §3` (fila 18) en vez de esconderlo.
