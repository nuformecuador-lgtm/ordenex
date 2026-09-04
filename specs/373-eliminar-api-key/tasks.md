# Ficha 373 — Eliminar una API key · tasks

> **Orden de ejecución:** los bloques **A–F** los hace `backend_dev`; el bloque **G**, después y
> sobre lo ya mergeado en la rama, `frontend_dev`. El bloque **H** cierra.
> `[P]` = puede correr en paralelo con las tareas de su mismo bloque marcadas igual.
> Cada tarea nombra los `R<n>` que cubre; el mapa completo `R → test` está en
> `requirements.md §3` y el implementer lo confirma en `progress/impl_373.md`.
> **Un commit por tarea lógica completada** (`docs/conventions.md`), no un mega-commit final.

---

## Bloque 0 · Preparación

- [x] **T0.1 — Rama y base local al día.**
      Ramificar de `origin/dev` a `feat/373-eliminar-api-key`; `pnpm exec prisma migrate deploy`
      contra la base local **antes** de tocar nada.
      *Hecho cuando:* `pnpm exec prisma migrate status` dice «up to date» y nombra el host
      esperado (no se lee el `.env`).
      *Depende de:* —

- [x] **T0.2 — Confirmar que el símbolo no existe ya.**
      Verificar **en el archivo real** (no solo en el grafo) que no hay `eliminarApiKey`,
      `api_key_eliminada` ni `motivoNoEliminable` en el camino de API keys.
      *Hecho cuando:* queda escrito en `progress/impl_373.md` que los cuatro archivos de la
      cadena (`lib/actions/api-keys.ts`, `ApiKeyService.ts`, `ApiKeyRepository.ts`,
      `IApiKeyRepository.ts`) no los declaran.
      *Depende de:* T0.1

---

## Bloque A · Base de datos y catálogo de acciones (backend)

- [x] **A1 — Migración del valor de enum.**
      Crear `db/migrations/20260904120000_historial_accion_api_key_eliminada/migration.sql` con el
      único `ALTER TYPE "historial_accion_tipo" ADD VALUE IF NOT EXISTS 'api_key_eliminada';` y su
      comentario de cabecera (design §2.1). Ajustar el timestamp si otra migración ya ocupa ese
      minuto en `origin/dev`.
      *Hecho cuando:* la migración aplica en local y `\dT+ historial_accion_tipo` lista 45 valores.
      *Cubre:* R25 (parte), R39
      *Depende de:* T0.1

- [x] **A2 — `down.sql` de esa migración.**
      Recrear el tipo con los **44** valores previos: la lista del `down.sql` de
      `20260903150000_correccion_fecha_reprogramacion` (43) **más**
      `'gestion_fecha_reprogramacion_corregida'`. Incluir la nota de precondición
      («ninguna fila con `api_key_eliminada`») y la de que ningún `down.sql` anterior se toca.
      *Hecho cuando:* `pnpm run db:rollback` revierte en una base sin filas de esa acción, y
      **falla ruidosamente** si se inserta una antes.
      *Cubre:* R27
      *Depende de:* A1

- [x] **A3 — `db/schema.prisma`: el valor en el enum de Prisma.**
      Añadir `api_key_eliminada` al bloque `enum HistorialAccionTipo`, junto a
      `api_key_desactivada`.
      *Hecho cuando:* `pnpm exec prisma generate` pasa y `PrismaHistorialAccionTipo` incluye el
      valor.
      *Cubre:* R25
      *Depende de:* A1

- [x] **A4 — Catálogo cerrado (`lib/types/historial-accion.ts`).**
      Tres ediciones (design §2.2): `HISTORIAL_ACCION_TIPOS` (bloque A.3, tras
      `api_key_desactivada`), `CATEGORIA_POR_ACCION: "cambia_permisos"`, `ACCION_LABELS: "Eliminó
      una API key"`. Actualizar el comentario de cabecera de 44 a 45 tipos.
      *Hecho cuando:* `tsc` pasa (los dos cierres `satisfies` / `_AsegurarExhaustivo` no se
      quejan) y `tests/unit/historial-accion/catalogo-y-choke-point.test.ts` verde tras subir sus
      dos `toHaveLength(44)` a 45.
      *Cubre:* R25
      *Depende de:* A3

- [x] **A5 [P] — Test de migración.**
      `tests/integration/db/api-key-eliminada-migration.test.ts`: (a) el enum de la base coincide
      exactamente con `HISTORIAL_ACCION_TIPOS`; (b) el `migration.sql` de esta ficha **solo**
      contiene `ALTER TYPE … ADD VALUE` (ni `CREATE TABLE` ni `ALTER TABLE`); (c) el `down.sql`
      recrea la lista de 44 y no incluye el valor nuevo.
      *Hecho cuando:* los tres casos pasan contra Postgres real y ninguno reporta `passed` por un
      `return` temprano sin datos.
      *Cubre:* R27, R39
      *Depende de:* A2, A4

---

## Bloque B · Contratos y tipos (backend)

- [x] **B1 — Vocabulario y función de precedencia (`lib/types/api-key.ts`).**
      Añadir `MOTIVOS_NO_ELIMINABLE` —**los cinco**: `ordenes`, `dinero`, `tarifas`, `activa`,
      `otros_datos`—, `MotivoNoEliminable`, `DependenciasCuentaDedicada` y la función pura
      `motivoNoEliminable(estado, dependencias)` con la precedencia **órdenes > dinero > tarifas >
      activa** y su motivo escrito (design §4.3). Módulo puro: sin Prisma en runtime.
      *Hecho cuando:* `tests/unit/types/api-key-motivo-no-eliminable.test.ts` cubre las 16
      combinaciones (2 estados × 8 de los tres booleanos), fija el orden y comprueba que
      `otros_datos` **no** lo devuelve nunca esta función.
      *Cubre:* R13
      *Depende de:* T0.2

- [x] **B2 — DTO del listado y resultado de la acción.**
      `ApiKeyListItemDTO = ApiKeyListItem & { eliminable; motivoNoEliminable }`,
      `eliminarApiKeySchema = apiKeyIdSchema.strict()`, `EliminarApiKeyResult` (design §5.1/§5.4).
      **`ApiKeyListItem` y `apiKeyIdSchema` no se modifican** (`ApiKeyListItem` ya trae `estado`).
      *Hecho cuando:* `tsc` pasa en todo el árbol y
      `tests/unit/descarga/api-keys-descarga-columnas.test.ts` sigue verde sin cambios (R37).
      *Cubre:* R20, R37
      *Depende de:* B1

- [x] **B3 [P] — Interfaces.**
      `IApiKeyRepository`: `dependenciasDeCuentasDedicadas` y `eliminar` con sus contratos
      documentados (design §5.3, incluido el `estado` en la rama `bloqueada`). `IApiKeyService`:
      `eliminar` (design §5.2).
      *Hecho cuando:* `tsc` pasa; las implementaciones aún no existen y los tipos ya obligan.
      *Cubre:* R2, R12, R21
      *Depende de:* B2

---

## Bloque C · Repositorio (backend)

- [x] **C1 — `dependenciasDeCuentasDedicadas`.**
      El `$queryRaw` de design §4.2 (cuatro `EXISTS`, `unnest(…::text[])`), lista vacía → `Map`
      vacío **sin consultar**. Ampliar el `Pick` de `ApiKeyPrismaClient` con `$queryRaw`.
      *Hecho cuando:* `tests/integration/db/api-key-eliminabilidad.test.ts` (Postgres real) cubre:
      cuenta limpia; con orden **viva**; con orden **borrada** (`deleted_at` no nulo); con
      movimiento de libro de tienda; con pago de liquidación; con tarifa. Y una **mutación** del
      `WHERE` (cambiar `tienda_id` por otra columna) pone el test rojo.
      *Cubre:* R8, R9, R10
      *Depende de:* B3

- [x] **C2 — `eliminar`, la transacción.**
      Los siete pasos de design §6, en ese orden, **con el corte por `estado === "activa"` en el
      paso 2, antes del `EXISTS` y antes de cualquier escritura**. Captura de
      `identificador`/`estado` antes de borrar; `deleteMany` para el webhook acotado a
      `ownerUsuarioId` = cuenta dedicada; `appendAccion` con `valorAnterior = estado previo` y
      `valorNuevo = null`. `P2025` → `not_found`; `P2003` → `bloqueada` con `dependencias: null`.
      Ampliar el `Pick` con `webhookSuscripcion`.
      *Hecho cuando:* `tests/unit/repositories/api-key-repository.eliminar.test.ts` verifica con
      un doble el **orden** de llamadas (estado y guard antes de cualquier `delete`), que una key
      `activa` no llega ni a ejecutar el `EXISTS`, y que ninguna otra tabla se toca.
      *Cubre:* R2, R3, R11, R15, R21, R22, R24
      *Depende de:* C1

- [x] **C3 — Test de integración del borrado.**
      `tests/integration/db/api-key-eliminar.test.ts`: sobre una key **`inactiva`** borra las tres
      filas; una key `activa` con los mismos datos sale `bloqueada` y **nada se borra**, y al
      desactivarla pasa a borrarse (R11); deja intacta una segunda key y su cuenta (R3); escribe
      **exactamente una** fila de historial con la acción, la etiqueta, el actor congelado y
      `valor_anterior = 'inactiva'` (R22/R24); esa fila **no** contiene secreto, `key_hash` ni
      `key_prefix` en ninguna columna (R23); sigue listándose en el registro de acciones tras el
      borrado (R26); y **generar otra key con el mismo identificador devuelve `ok`** (R6). Más un
      caso de fallo forzado que comprueba que no queda nada persistido (R4).
      *Hecho cuando:* los ocho casos pasan y ninguno se salta por falta de datos.
      *Cubre:* R2, R3, R4, R6, R11, R22, R23, R24, R26
      *Depende de:* C2

- [x] **C4 [P] — Test de la tienda destino.**
      `tests/integration/db/api-key-eliminar-tienda-destino.test.ts`: una key `inactiva` con
      `tienda_destino_id`, con órdenes de la TIENDA y con un webhook de la TIENDA, se elimina; la
      tienda, sus órdenes y su suscripción siguen ahí.
      *Hecho cuando:* pasa, y una mutación que quite el filtro `ownerUsuarioId` del `deleteMany`
      lo pone rojo.
      *Cubre:* R5
      *Depende de:* C2

- [x] **C5 [P] — Test de la FK inesperada.**
      `tests/integration/db/api-key-eliminar-fk-inesperada.test.ts`: insertar a mano una fila en
      una tabla que el guard **no** mira y que apunta a la cuenta dedicada (p. ej.
      `orden_habilitacion_api.actor_usuario_id`, `Restrict`), y comprobar que el borrado responde
      `bloqueada` y que **nada** se borró.
      *Hecho cuando:* pasa y deja escrito en el test por qué esa tabla no está en el guard.
      *Cubre:* R16
      *Depende de:* C2

- [x] **C6 — El listado no gana consultas por fila.**
      No se toca `LIST_SELECT` (sigue sin `key_hash` y ya trae `estado`). Solo se comprueba que el
      conteo de consultas del listado no depende del tamaño de página.
      *Hecho cuando:* `tests/unit/repositories/api-key-repository.list.test.ts` gana el caso «una
      página de 25 filas hace las mismas consultas que una de 1» con un espía.
      *Cubre:* R38
      *Depende de:* C1

---

## Bloque D · Servicio (backend)

- [x] **D1 — `ApiKeyService.eliminar`.**
      `ALLOWED_ROLES` (el mismo `Set`, no una copia) antes de tocar la base; traducción de los
      desenlaces del repositorio con `motivoNoEliminable(estado, dep)`; `bloqueada` sin
      dependencias → `otros_datos` (design §5.2).
      *Hecho cuando:* `tests/unit/services/api-key-service.eliminar.test.ts` cubre: rol no
      `maestro` → `forbidden` **sin llamar al repositorio**; id inexistente → `not_found`;
      bloqueada por cada uno de los cuatro motivos, incluido `activa` con cero datos; el caso
      «la misma key, desactivada → ok»; y que el servicio no expone ningún método de restauración.
      *Cubre:* R7, R11, R12, R18, R21
      *Depende de:* C2

- [x] **D2 — `listar` y `listarCompleto` enriquecen los items.**
      Tras `repo.list(...)`, una sola llamada a `dependenciasDeCuentasDedicadas` con los
      `usuarioId` de la página, y `motivoNoEliminable(item.estado, dep)` por fila.
      *Hecho cuando:* `tests/unit/services/api-key-service.listar.test.ts` comprueba que el
      repositorio recibe **una** lista de ids (no una llamada por fila) y que cada item sale con
      `eliminable`/`motivoNoEliminable` coherentes, incluida una fila `activa` sin datos.
      *Cubre:* R38
      *Depende de:* D1, C6

---

## Bloque E · Borde (backend)

- [x] **E1 — Server Action `eliminarApiKey`.**
      Calcada de `desactivarApiKey`: actor → `UnauthenticatedError`; `eliminarApiKeySchema.parse`;
      `service.eliminar`; `toApiKeyLifecycleActionError` para lo lanzado. Sin lógica de negocio ni
      Prisma (design §5.1).
      *Hecho cuando:* `tests/unit/actions/api-keys-eliminar.test.ts` cubre: sin sesión →
      `unauthenticated` **sin instanciar el service**; id no uuid → `validation_error`; clave
      desconocida → `validation_error`; delegación correcta en el caso feliz.
      *Cubre:* R19, R20
      *Depende de:* D1

---

## Bloque F · Guardias (backend)

- [x] **F1 — Guardia de clasificación de FKs hacia `usuario`.**
      `tests/unit/guards/api-key-dependencias-usuario.guardia.test.ts`: lee `db/schema.prisma`,
      extrae **toda** relación hacia `Usuario`, y exige que cada una figure en un módulo de
      clasificación con categoría (`bloquea` | `se_borra_con_ella` | `no_alcanzable`) y, en el
      tercer caso, **motivo escrito**. Con **contraprueba**: aplicada a un esquema mutado en
      memoria que añade una relación nueva, la guardia tiene que fallar.
      *Hecho cuando:* pasa con el árbol real, y la contraprueba demuestra que detecta el hueco.
      *Cubre:* R17
      *Depende de:* C2

- [x] **F2 — Censo del punto único de auditoría.**
      Añadir a `CENSO` de `tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts`
      la entrada de `api_key_eliminada` (`lib/repositories/ApiKeyRepository.ts`, método
      `eliminar`, forma `abre_tx`, con la regex de la mutación) y subir su `toHaveLength(44)` a 45.
      *Hecho cuando:* la guardia pasa **y** falla si se quita el `appendAccion` del método.
      *Cubre:* R22
      *Depende de:* C2, A4

---

## Bloque G · Pantalla (`frontend_dev`, después del backend)

- [x] **G1 — Textos de motivo, módulo puro.**
      `app/(app)/configuracion/api/_components/api-key-eliminable-label.ts` con el `Record`
      cerrado de los **cinco** motivos (design §7.1). Sin React.
      *Hecho cuando:* `tsc` pasa y el `Record` es exhaustivo sobre `MotivoNoEliminable`.
      *Cubre:* R28
      *Depende de:* E1

- [x] **G2 — El tercer botón en `ApiKeyAccionCell`.**
      «Eliminar», `variant="destructive"`, `disabled={!row.eliminable}`, con el motivo en el
      `aria-label` **y** en el `title` (design §7.1). No se toca Rotar ni Activar/Desactivar.
      *Hecho cuando:* `tests/unit/components/api-key-eliminar.ui.test.tsx` comprueba: el botón
      existe (R1); en una fila no eliminable está deshabilitado y su nombre accesible dice el
      motivo, **un caso por cada uno de los cuatro motivos**, incluido el de la key `activa` sin
      datos (R28); y los otros dos botones siguen habilitados (R14).
      *Cubre:* R1, R14, R28
      *Depende de:* G1

- [x] **G3 — El modal de confirmación (destructivo simple).**
      `Modal` con `closeOnConfirm={false}`. **Sin campo de teclear el identificador y sin
      `confirmDisabled`**: la fricción la puso el paso previo de desactivar. Cuerpo con las tres
      consecuencias y la línea que recuerda que la key ya está desactivada (design §7.2).
      *Hecho cuando:* el test cubre: abrir no llama a la acción (R29); nombra la key y enuncia las
      tres consecuencias (R30); dice que ya está desactivada y que dejarla así revoca el acceso
      (R31); Cancelar no llama a nada (R32); ninguna cadena renderizada contiene prefijo completo
      ni hash (R36).
      *Cubre:* R29, R30, R31, R32, R36
      *Depende de:* G2

- [x] **G4 — Desenlaces: refresco, avisos y paginación.**
      `onMutated()` antes de cerrar + toast de éxito; `mensajeError` gana el caso `bloqueada`
      (texto del motivo); `ApiKeysModule` retrocede de página cuando el borrado deja vacía una
      página que no es la primera (design §7.3).
      *Hecho cuando:* el test cubre los cuatro mensajes de error distintos (R34), el refresco y el
      aviso de éxito (R33), y `tests/unit/components/api-keys-module.eliminar.test.tsx` cubre el
      retroceso de página (R35).
      *Cubre:* R33, R34, R35
      *Depende de:* G3

- [x] **G5 [P] — La descarga no cambia.**
      Verificar que `COLUMNAS_DESCARGA_API_KEYS` y `filaDescargaApiKey` siguen igual pese al DTO
      más ancho.
      *Hecho cuando:* `tests/unit/descarga/api-keys-descarga-columnas.test.ts` pasa sin
      modificaciones y con un caso que afirma que la fila emitida **no** tiene claves nuevas.
      *Cubre:* R37
      *Depende de:* G2

---

## Bloque H · Cierre

- [x] **H1 — Mapa `R → test` en `progress/impl_373.md`.**
      Las 39 filas, con el nombre real del test y del archivo. Un `R` sin test es un fallo de la
      feature.
      *Hecho cuando:* el archivo existe, está **commiteado** (no solo escrito) y las 39 filas
      apuntan a tests que existen.
      *Depende de:* G4, F2, A5

- [x] **H2 — Gate.**
      `./init.sh` **completo**: el diff toca `db/schema.prisma` y una migración, así que el modo
      rápido se negará. Con `.env` presente —si `tests/integration/db/**` sale `skipped`, el
      veredicto no vale—. Escribir `INIT_EXIT=$?` dentro del log.
      *Hecho cuando:* el log dice `INIT_EXIT=0` y el número de `skipped` está anotado y explicado.
      *Depende de:* H1

- [x] **H3 — Verificación en la pantalla real.**
      Con la app levantada y sesión `maestro`, en `Configuración > API`: (a) una key `activa`
      muestra el botón deshabilitado con «Está activa. Desactívala antes de eliminarla»;
      (b) al desactivarla, el botón se habilita; (c) se elimina tras confirmar y desaparece del
      listado; (d) el registro de acciones muestra la fila «Eliminó una API key»; (e) generar de
      nuevo una key con ese mismo identificador funciona; (f) una key con órdenes sigue con el
      botón deshabilitado por «Tiene órdenes a su nombre».
      *Hecho cuando:* los seis puntos quedan anotados en `progress/impl_373.md` con lo que se vio,
      no con lo que se esperaba.
      *Depende de:* H2
