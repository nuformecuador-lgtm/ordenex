# Ficha 373 — Eliminar una API key · design

> Cubre `requirements.md` R1–R39. Todo lo que sigue se apoya en el árbol leído el 2026-09-04;
> las referencias `archivo:línea` son verificables.

## 0. La decisión, en una frase

Se añade **una sexta operación** al ciclo de vida que ya existe —Server Action → `ApiKeyService`
→ `ApiKeyRepository`, DI por interfaces— que, **sobre una key ya desactivada y sin rastro de
datos**, borra en FÍSICO y en **una sola transacción** la fila de `api_key`, la fila de `usuario`
de su cuenta dedicada y la suscripción de webhook de esa cuenta, y escribe en esa misma
transacción **una** fila de `historial_accion` con una acción nueva `api_key_eliminada`.
**Sin esquema nuevo**: la única migración es un valor más en un enum.

El ciclo de vida queda así, y el orden es el punto:

```
generar → [activa] ⇄ desactivar/activar → [inactiva] → ELIMINAR (físico, irreversible)
                       ↑ reversible, visible                ↑ solo desde `inactiva` (R11)
```

---

## 1. Lo que NO se toca

| Decisión | Motivo |
| --- | --- |
| Ninguna tabla, columna ni índice nuevos | Ninguna FK apunta a `api_key` (medido); el borrado no necesita estructura |
| Ningún soft delete, papelera ni archivado | Frontera del humano (requirements §4) y lección de las dos specs descartadas por rediseñar |
| `rotar` / `activar` / `desactivar` | Siguen tal cual; «Desactivar» sigue siendo LA revocación, y ahora además es **el paso previo obligatorio** del borrado |
| `apiKeyIdSchema` | No se le añade `.strict()`: cambiaría el borde de sus tres consumidores actuales. La ficha deriva su propio schema (§5.1) |
| `WebhookSuscripcionRepository` | Su `darDeBaja` (`:84`) sigue marcando `activa=false`. El borrado FÍSICO de la suscripción vive dentro de la transacción de la key y en ningún otro sitio |
| Los `down.sql` de migraciones anteriores | Son fotos históricas |
| La columna «Webhook» del listado y `lib/actions/webhooks.ts` | Verificado el 2026-09-04: la celda pasa `row.usuarioId`, pero las cuatro Server Actions resuelven el owner **en el servidor** con `resolverOwnerWebhook`, que ante rol `apiKey` devuelve su tienda destino; pasar `ownerUsuarioId` llegaría al mismo id por la rama «cuenta que ES tienda destino → ella misma». Redundante, no roto |

---

## 2. Modelo de datos

### 2.1 La única migración: un valor de enum

`historial_accion.accion` es un enum **nativo** de Postgres (`historial_accion_tipo`), así que un
valor nuevo va por `ALTER TYPE … ADD VALUE`. Patrón idéntico al de las dos migraciones más
recientes que lo ampliaron.

**`db/migrations/20260904120000_historial_accion_api_key_eliminada/migration.sql`**

```sql
-- FICHA 373 — el tipo de accion `api_key_eliminada`.
-- QUE REGISTRA: que un maestro borro en fisico una API key YA DESACTIVADA, su cuenta dedicada y
-- su suscripcion de webhook. La fila NUNCA lleva el secreto, ni `key_hash`, ni `key_prefix` (R23).
-- VA SOLA: Postgres no permite USAR un valor de enum en la transaccion que lo anade (55P04).
-- ADITIVA: no crea ni altera tablas, columnas ni indices; la RLS de `historial_accion` no se toca.
ALTER TYPE "historial_accion_tipo" ADD VALUE IF NOT EXISTS 'api_key_eliminada';
```

**`down.sql`** — Postgres **no** tiene `ALTER TYPE … DROP VALUE`, así que el tipo se **recrea con
la lista previa**, que son **44** valores. De dónde sale esa lista, sin lugar a duda:

> la lista del `down.sql` de la última migración que amplió el enum
> —`20260903150000_correccion_fecha_reprogramacion/down.sql`, **43** valores, el último
> `'orden_zona_reconciliada'`— **más** `'gestion_fecha_reprogramacion_corregida'`, que es
> justamente el valor que **aquella** migración añadió y que su propio `down` no podía listar.

No se copia de `20260903120000_…_orden_zona_reconciliada/down.sql` (esa lista tiene 42 y va dos
pasos atrás), y **ningún `down.sql` anterior se toca**: son fotos históricas.

```sql
-- DOWN (ficha 373): se RECREA `historial_accion_tipo` con los 44 valores previos, sin
-- `api_key_eliminada`. Patron identico a
-- `20260903150000_correccion_fecha_reprogramacion/down.sql`.
-- ⚠️ PRECONDICION: NINGUNA fila de "historial_accion" con accion = 'api_key_eliminada'. Si
-- quedara alguna, el `USING` del `ALTER COLUMN` falla RUIDOSAMENTE y el rollback aborta:
-- comportamiento CORRECTO (R27) — borrar el rastro de keys ya eliminadas no es seguro.
-- La UNICA columna que usa este enum es "historial_accion"."accion".
ALTER TYPE "historial_accion_tipo" RENAME TO "historial_accion_tipo_old";
CREATE TYPE "historial_accion_tipo" AS ENUM ( /* los 44 previos, en el mismo orden */ );
ALTER TABLE "historial_accion"
  ALTER COLUMN "accion" TYPE "historial_accion_tipo"
  USING ("accion"::text::"historial_accion_tipo");
DROP TYPE "historial_accion_tipo_old";
```

`db/schema.prisma` gana el valor en el bloque `enum HistorialAccionTipo` (junto a
`api_key_desactivada`, ~línea 3045+), para que el cliente generado lo conozca.

### 2.2 El catálogo cerrado (`lib/types/historial-accion.ts`)

Tres ediciones, y el módulo se cierra solo en las dos direcciones (`satisfies` +
`_AsegurarExhaustivo`), así que olvidar una **no compila**:

1. `HISTORIAL_ACCION_TIPOS`: `"api_key_eliminada"` al final del bloque **A.3 · cambia quien puede
   hacer qué**, detrás de `api_key_desactivada`. El comentario de cabecera pasa de «44 tipos» a
   **45**.
2. `CATEGORIA_POR_ACCION`: `api_key_eliminada: "cambia_permisos"` — la misma categoría que sus
   cuatro hermanas (`:206-209`). **No** «hace desaparecer algo»: R17 de la 362 exige exactamente
   una categoría por tipo, y lo que esta acción documenta es un cambio de **quién puede entrar por
   la API**, que es el eje de las otras cuatro; partir el ciclo de vida de una credencial en dos
   familias rompería el filtro por categoría justo donde más se usa.
3. `ACCION_LABELS`: `api_key_eliminada: "Eliminó una API key"`.

`HISTORIAL_ACCION_ENTIDADES` **no cambia**: `api_key` ya está (`:144`), con su
`ENTIDAD_LABELS` y su `etiquetaDeEntidad("api_key", { identificador })`
(`lib/types/historial-accion-etiquetas.ts:94,161`).

Dos aserciones de conteo hay que subir de 44 a 45:
`tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts:521` y
`tests/unit/historial-accion/catalogo-y-choke-point.test.ts:72-73`. La primera guardia **exige
además** una entrada en su `CENSO` que declare el productor del tipo nuevo (§6.3 → tarea F2).

### 2.3 RLS

Sin cambios. `api_key`, `usuario`, `webhook_suscripcion` e `historial_accion` ya tienen su RLS
como está; un `DELETE` por Prisma corre con el rol de servicio. No hay tabla nueva que proteger.

---

## 3. El censo de FKs hacia `usuario`, y qué hace cada una

Esto es lo que el encargo pide enumerar. Cada relación declarada hacia `Usuario` en
`db/schema.prisma`, con su `onDelete` **efectivo** y su clasificación respecto de una **cuenta
dedicada** (rol `apiKey`).

**La clave de lectura:** las FK `Restrict`/`NoAction` **las bloquea Postgres solo** —el `DELETE`
falla y la transacción revierte entera (R16)—. Las `Cascade` y `SetNull` **no bloquean nada**:
borran o desconectan en silencio, y ahí el guard es la ÚNICA defensa. Por eso las de esa columna
llevan ⚠.

| # | Tabla · columna | `onDelete` | ¿Alcanzable por una cuenta dedicada? | Clasificación |
| --- | --- | --- | --- | --- |
| 1 | `orden.tienda_id` (`:665`) | Restrict | **SÍ** — es la dueña de sus órdenes cuando no hay tienda destino | **BLOQUEA** (R8) |
| 2 | `tarifa.tienda_id` (`:1384`) | ⚠ Cascade | **SÍ** — se le puede configurar tarifa sin haber cargado nada | **BLOQUEA** (R10) |
| 3 | `wallet_tienda_movimiento.tienda_id` (`:1613`) | Restrict | **SÍ** | **BLOQUEA** (R9) |
| 4 | `liquidacion_pago.tienda_id` (`:1759`) | Restrict | **SÍ** | **BLOQUEA** (R9) |
| 5 | `api_key.usuario_id` (`:2343`) | Restrict | **SÍ**, 1:1 | **SE BORRA CON ELLA** (R2-a) |
| 6 | `webhook_suscripcion.owner_usuario_id` (`:2370`) | Restrict | **SÍ**, 0..1 | **SE BORRA CON ELLA** (R2-c) |
| 7 | `carga.usuario_carga` (`:794`) | Restrict | Solo con ≥1 orden persistida (`Carga`, `:775-781`) | Bloquea vía #1; red de FK |
| 8 | `orden_habilitacion_api.actor_usuario_id` (`:894`) | Restrict | Solo si hubo órdenes que habilitar | Bloquea vía #1; red de FK |
| 9 | `orden_historial_estado.actor_usuario_id` (`:2136`) | ⚠ SetNull | Solo si actuó sobre una orden propia (`cancelarViaApi`, `:2956`) | Bloquea vía #1 |
| 10 | `historial_accion.actor_usuario_id` (`:3163`) | Restrict | Solo si borró una orden propia por API (`softDeleteViaApi`, `:4653-4663`) | Bloquea vía #1; red de FK |
| 11 | `cierre_detail.tienda_id` (`:2236`) | Restrict | Deriva de órdenes suyas | Bloquea vía #1; red de FK |
| 12 | `analytics_daily.tienda_id` (`:2725`) | Restrict | Deriva de órdenes suyas | Bloquea vía #1; red de FK |
| 13 | `rechazo_tienda_cobro.tienda_id` (`:2039`) | Restrict | Deriva de órdenes suyas | Bloquea vía #1; red de FK |
| 14 | `notificacion.tienda_id` / `.destinatario_usuario_id` (`:2606-2607`) | ⚠ Cascade | Deriva de órdenes suyas | Bloquea vía #1 |
| 15 | `api_key.tienda_destino_id` (`:2345`) | Restrict | **NO**: el service exige rol `adminTienda` (`ApiKeyService.ts:40`) | Red de FK |
| 16 | `api_key.created_by_id` (`:2344`) | Restrict | **NO**: solo un `maestro` genera keys | Red de FK |
| 17 | `trusted_device.usuario_id` (`:433`) · `email_otp_challenge.usuario_id` (`:451`) | Restrict | **NO**: la cuenta nunca autentica (su contraseña es aleatoria y no se revela) | Red de FK |
| 18 | `login_attempt.usuario_id` (`:418`) | ⚠ SetNull | Teóricamente sí (alguien probando el email sintético) | **NO bloquea, y se dice**: la fila conserva `email_usado`, `ip` y `risk_reason`; solo pierde el enlace. No es rastro que proteger |
| 19 | `orden.mensajero_asignado_id` (`:670`), `chat_conversacion.mensajero_id` (`:314`), `gestion_orden.*` (`:1066-1073`), `cierre_dia.*` (`:1274-1276`), `cierre_bodega.*` (`:1317-1318`), `pago_mensajero_movimiento.*` (`:1695-1696`), `liquidacion_reparto.*` (`:1824-1825`), `ranking_snapshot_fila.mensajero_id` (`:2812`), `ruta_optimizada.mensajero_id` (`:2497`), `orden_mensajero_meta.usuario_id` (`:823`), `mensajero_documento.usuario_id` (`:390`), `analytics_daily.mensajero_id` (`:2726`), `liquidacion_pago.mensajero_id` (`:1758`) | varias | **NO**: exigen rol `mensajero` | Red de FK |
| 20 | `plantilla_mensaje.created_by` (`:240`), `wallet_movimiento.registrado_por` (`:1545`), `wallet_tienda_movimiento.registrado_por` (`:1614`), `liquidacion_pago.registrado_por` (`:1761`), `liquidacion_anulacion.anulado_por` (`:1789`), `liquidacion_reparto.registrado_por` (`:1825`), `gasto_fijo_cobro.decidido_por` (`:1962`), `rechazo_tienda_cobro.decidido_por` (`:2040`), `orden_incidente.*` (`:1182-1183`), `postulacion_recurso.atendida_por` (`:2857`), `orden_nota.autor_id` (`:862`), `orden_dia_reparto_cambio.actor_usuario_id` (`:2906`), `gestion_fecha_reprogramacion_cambio.actor_usuario_id` (`:2967`), `notificacion_lectura.usuario_id` (`:2636`) | varias | **NO**: exigen un operador humano con sesión | Red de FK |

**Y lo que sostiene esta tabla en el tiempo (R17):** una **guardia** lee `db/schema.prisma`,
extrae toda relación `… Usuario … @relation(… references: [id] …)` y exige que cada una figure en
un módulo de clasificación con su categoría y —si es «no alcanzable»— su motivo escrito. Una
relación nueva sin clasificar pone la guardia **roja**. Es la respuesta concreta a «si el borrado
puede fallar por una FK que no previste»: no se confía en que alguien se acuerde.

---

## 4. El guard: una condición de estado, cuatro de datos y tres redes

### 4.0 La condición de estado (R11), que va primero en el tiempo y última en la precedencia

Una key **`activa` nunca es eliminable**, tenga los datos que tenga. Es la condición que el guard
por datos no puede dar: una key recién creada y **en uso** tiene 0 órdenes y sería borrable —es el
caso literal de «API Nuform» (`activa`, 0 órdenes, medida el 2026-09-04)—, y borrarla dejaría al
integrador fuera **sin ningún aviso ni vuelta atrás**. Desactivar es reversible y se nota en el
mismo listado; borrar no es ninguna de las dos cosas.

**Coste: cero consultas.** El `estado` ya viaja en `LIST_SELECT` (`:77`) y en la fila que la
transacción lee antes de escribir (§6, paso 1). No hay que pedirlo a nadie.

**Consecuencia medida:** con la foto de producción del 2026-09-04, **ninguna** de las dos keys es
borrable hoy sin desactivarla antes. Es el comportamiento buscado, no un efecto colateral.

### 4.1 Las cuatro comprobaciones de datos, y por qué esas cuatro

| Comprobación | Cubre | Índice que la resuelve |
| --- | --- | --- |
| `EXISTS orden WHERE tienda_id = <cuenta>` — **sin filtrar `deleted_at`** | #1 y, por implicación, #7–#14 | `@@index([tiendaId])` (`:733`) |
| `EXISTS wallet_tienda_movimiento WHERE tienda_id = <cuenta>` | #3 | `@@index([tiendaId, fechaMovimiento])` (`:1616`) |
| `EXISTS liquidacion_pago WHERE tienda_id = <cuenta>` | #4 | `@@index([tiendaId, fechaPago])` (`:1765`) |
| `EXISTS tarifa WHERE tienda_id = <cuenta>` | #2 | `@@index([tiendaId])` (`:1399`) |

**`deleted_at` NO se filtra, y es la sutileza que más importa.** Las órdenes usan soft delete: la
fila sigue existiendo y su FK a la tienda sigue apuntando. Contar solo las vivas dejaría eliminable
una key con 40 órdenes borradas, y el `DELETE` reventaría al pulsar el botón — exactamente el
«botón que falla al pulsarlo» que el encargo prohíbe.

**Por qué no se comprueban las 14:** #7–#14 solo pueden existir si existió una orden de esa cuenta,
y una orden nunca desaparece de la tabla. Comprobarlas otra vez sería coste sin información —y
`cierre_detail` **no declara índice por `tienda_id`** (solo `@@unique([cierreId, ordenId])` y
`@@index([ordenId])`, `:2244-2245`), así que un `EXISTS` sin coincidencias recorrería entera una
tabla que crece con cada cierre, en cada pintado del listado. Los de `notificacion` son PARCIALES y
van a mano en su migración (`:2612-2618`), es decir, no se puede dar por hecho que sirvan a este
predicado sin medirlo. Que esa implicación sea un **razonamiento** y no una medición es justo el
motivo por el que existen las tres redes de §4.4.

### 4.2 La consulta, y cómo evita el N+1 (R38)

Una sola consulta por página, con la lista de cuentas de esa página:

```sql
SELECT u.id AS "usuarioId",
       EXISTS (SELECT 1 FROM "orden" o WHERE o."tienda_id" = u.id)                    AS ordenes,
       (EXISTS (SELECT 1 FROM "wallet_tienda_movimiento" w WHERE w."tienda_id" = u.id)
        OR EXISTS (SELECT 1 FROM "liquidacion_pago" p WHERE p."tienda_id" = u.id))    AS dinero,
       EXISTS (SELECT 1 FROM "tarifa" t WHERE t."tienda_id" = u.id)                   AS tarifas
FROM unnest(${usuarioIds}::text[]) AS u(id)
```

- **`text[]`** y no `uuid[]`: `usuario.id` es `TEXT` en la base (`20260716150000_api_key/migration.sql:20`).
- `EXISTS` **corta en la primera fila** que casa, así que el coste real es un acceso por índice.
- Es `$queryRaw`, así que **se prueba contra Postgres de verdad** (`tests/integration/db/…`), no
  contra un doble: un doble no ve el `WHERE` (lección repetida del repo).
- Coste total del listado: `findMany` + `count` + **1**. Constante respecto al tamaño de página, y
  el estado no suma ninguna.

### 4.3 De estado + dependencias a motivo (fuente única, R13)

```ts
// lib/types/api-key.ts — modulo PURO
export const MOTIVOS_NO_ELIMINABLE = [
  "ordenes",
  "dinero",
  "tarifas",
  "activa",
  "otros_datos",
] as const;
export type MotivoNoEliminable = (typeof MOTIVOS_NO_ELIMINABLE)[number];

export interface DependenciasCuentaDedicada {
  ordenes: boolean;
  dinero: boolean;
  tarifas: boolean;
}

/**
 * Precedencia FIJA (R13): ordenes > dinero > tarifas > activa. `null` = eliminable.
 * Los motivos de DATOS van antes que el de ESTADO a proposito: los primeros son terminales
 * (no hay nada que el maestro pueda hacer para desbloquear) y el segundo es accionable. Al
 * reves, una key activa CON ordenes diria «desactivala», y despues de desactivarla el boton
 * seguiria apagado por las ordenes: dos pasos y una promesa incumplida.
 */
export function motivoNoEliminable(
  estado: EstadoApiKey,
  d: DependenciasCuentaDedicada,
): MotivoNoEliminable | null;
```

La **misma** función la usan el camino del listado y el del borrado. `otros_datos` **no lo produce
nunca** esta función: solo lo emite la red 2 (una `P2003` inesperada), y por eso el listado nunca
lo muestra.

### 4.4 Las tres redes

1. **El guard consultable (§4.0 + §4.1).** Es lo que apaga el botón con un motivo (R28) y lo que
   se vuelve a evaluar dentro de la transacción (R15).
2. **Las FK `Restrict` de Postgres.** Si algo que el guard no mira apunta a la cuenta, el `DELETE`
   revienta con `P2003`, la transacción revierte **entera** y el sistema responde `bloqueada` con
   motivo `otros_datos` (R16). Nunca un borrado parcial, nunca un 500.
3. **La guardia de esquema (§3).** Impide que el censo se quede viejo en silencio.

---

## 5. Capas y contratos

### 5.1 Borde — `lib/actions/api-keys.ts`

```ts
/** R20: `.strict()` propio; `apiKeyIdSchema` NO se toca (lo comparten rotar/activar/desactivar). */
export const eliminarApiKeySchema = apiKeyIdSchema.strict();

export type EliminarApiKeyResult =
  | { status: "ok"; identificador: string }
  | { status: "not_found" }                              // R21
  | { status: "bloqueada"; motivo: MotivoNoEliminable }  // R12
  | ApiKeyActionErrorResult;                             // forbidden | unauthenticated | validation_error

export async function eliminarApiKey(
  input: unknown,
  deps: ApiKeyActionDeps = {},
): Promise<EliminarApiKeyResult>;
```

Cuerpo calcado de `desactivarApiKey` (`:183-195`): `resolveActorFromSession` → sin actor,
`UnauthenticatedError` (R19) → `eliminarApiKeySchema.parse` (R20) → `service.eliminar(data, actor)`.
El mapeo de error es el que ya existe, `toApiKeyLifecycleActionError` (`:64-72`): admite
`not_found`, rechaza `conflict`. **`bloqueada` no pasa por ahí**: es un RETORNO del service, no un
error lanzado, así que ningún mapeador cambia.

### 5.2 Servicio — `lib/services/ApiKeyService.ts` (+ `IApiKeyService`)

```ts
eliminar(input: ApiKeyIdInput, actor: Actor): Promise<EliminarApiKeyServiceResult>;
```

- `ALLOWED_ROLES` (`:29`, solo `maestro`) **antes** de tocar la base → `forbidden` (R18). Es el
  MISMO `Set` que usan generar/listar/rotar/activar/desactivar, no una copia.
- Llama a `repo.eliminar(input.id, actor.usuarioId)` y traduce:
  `not_found` → `not_found`; `bloqueada` con `{estado, dependencias}` →
  `motivoNoEliminable(estado, dep)`; `bloqueada` sin dependencias (P2003) → `otros_datos`;
  `ok` → `ok` con el identificador.
- `listar` y `listarCompleto` enriquecen sus items: tras `repo.list(...)`, una llamada a
  `repo.dependenciasDeCuentasDedicadas(items.map(i => i.usuarioId))` y `motivoNoEliminable(item.estado, dep)`
  por fila. **Dos llamadas al repositorio, no una por fila** (R38).

### 5.3 Repositorio — `lib/repositories/ApiKeyRepository.ts` (+ `IApiKeyRepository`)

```ts
dependenciasDeCuentasDedicadas(
  usuarioIds: readonly string[],
): Promise<Map<string, DependenciasCuentaDedicada>>;

eliminar(
  id: string,
  actorUsuarioId: string | null,
): Promise<
  | { status: "ok"; identificador: string }
  | { status: "not_found" }
  | { status: "bloqueada"; estado: EstadoApiKey; dependencias: DependenciasCuentaDedicada }
  | { status: "bloqueada"; estado: null; dependencias: null }   // P2003 inesperada
>;
```

El repositorio **no clasifica**: devuelve el estado y las dependencias crudos y deja el motivo al
service (`docs/architecture.md`: el repositorio son queries; la regla vive en el servicio).

`ApiKeyPrismaClient` (`:21-25`) amplía su `Pick` con `webhookSuscripcion` y `$queryRaw`. Lista vacía
de ids → `Map` vacío **sin consultar** (`unnest('{}')` sería un viaje a la base para nada).

### 5.4 El DTO del listado (cómo viaja el dato sin ensancharse de más)

`ApiKeyListItem` (el tipo del **repositorio**) **no cambia**; ya trae el `estado` (`:109`). Lo que
cambia es el DTO de salida:

```ts
// lib/types/api-key.ts
export type ApiKeyListItemDTO = ApiKeyListItem & {
  /** `true` = la key esta `inactiva` y las cuatro comprobaciones del guard salieron a cero. */
  eliminable: boolean;
  /** El motivo que la bloquea, o `null` si es eliminable. NUNCA `otros_datos` por esta via. */
  motivoNoEliminable: MotivoNoEliminable | null;
};
```

**Dos campos, ninguno sensible**: un booleano y un valor de un vocabulario cerrado. No viajan
conteos (decir «tiene 412 órdenes» obligaría a contar de verdad, y el número no cambia ninguna
decisión), ni ids, ni nada que roce el secreto: la invariante 82/R6 sigue siendo estructural
porque `LIST_SELECT` sigue sin pedir `key_hash`.

La descarga (R37) no cambia: `COLUMNAS_DESCARGA_API_KEYS` y `filaDescargaApiKey`
(`_components/api-keys-descarga-columnas.ts:33-71`) enumeran columnas **una a una**, así que
ampliar el tipo no añade ninguna celda.

---

## 6. La transacción del borrado

`ApiKeyRepository.eliminar` abre **una** `$transaction` y hace, EN ESTE ORDEN:

| # | Sentencia | Por qué ahí |
| --- | --- | --- |
| 1 | `tx.apiKey.findUnique({ where:{id}, select:{ id, identificador, estado, usuarioId } })` | `null` → `not_found` (R21). Captura el `identificador` y el `estado` **antes** de que dejen de existir (R24), y el `estado` es además la condición de R11 |
| 2 | `estado === "activa"` → `bloqueada` **sin consultar nada más**; si no, el `EXISTS` de §4.2 sobre `usuarioId` | R15: **el guard se re-evalúa aquí, antes de la primera escritura**. Si algo casa → `bloqueada` y se sale **sin haber escrito nada** |
| 3 | `resolverActorCongelado(tx, actorUsuarioId)` | Congela nombre y rol del maestro (R24), dentro de la tx, como sus hermanas |
| 4 | `tx.webhookSuscripcion.deleteMany({ where:{ ownerUsuarioId: usuarioId } })` | `deleteMany` = idempotente: 0 filas es un caso normal, no un error. **Acotado a la cuenta dedicada**: si la key tiene tienda destino, la suscripción de la TIENDA no casa y sobrevive (R5) |
| 5 | `tx.apiKey.delete({ where:{ id } })` | Antes que el usuario: `api_key.usuario_id` es `Restrict` |
| 6 | `tx.usuario.delete({ where:{ id: usuarioId } })` | Libera el email y la cédula sintéticos → **R6**, el identificador vuelve a estar disponible |
| 7 | `appendAccion(tx, [{ accion:"api_key_eliminada", entidadTipo:"api_key", entidadId:<id de la key>, entidadEtiqueta: etiquetaDeEntidad("api_key",{identificador}), ...actor, valorAnterior:<estado previo, siempre `inactiva`>, valorNuevo:null }])` | Mismo punto único que sus cuatro hermanas. Va DESPUÉS de la mutación, como en `createConUsuario` (`:154`) y `rotar` (`:265`) |

**Por qué esto cumple R4 sin ningún `try` de rescate:** dentro de una transacción de Postgres, un
error de sentencia aborta la transacción entera. No hay orden de sentencias que deje la key borrada
y el registro sin escribir, ni al revés. Y si `appendAccion` falla —por ejemplo porque la migración
del enum no corrió—, **el borrado se deshace**: no hay desaparición sin rastro.

**Concurrencia.** Si otra transacción inserta una orden con `tienda_id` = la cuenta mientras ésta
corre, Postgres toma un `FOR KEY SHARE` sobre la fila del usuario: el `DELETE` del paso 6 espera y
después **falla** con violación de FK. Resultado: reversión completa y `bloqueada` (R16). El guard
del paso 2 no tiene que ser perfecto para que el invariante se cumpla; la base lo cierra. Y la
carrera «alguien reactiva la key entre el pintado y el borrado» la cierra el paso 2, que relee el
`estado` dentro de la misma transacción.

**Lo que la fila de auditoría NO lleva** (R23): ni `plainKey` —que no existe en este camino—, ni
`key_hash`, ni `key_prefix`, ni el email sintético. Solo el identificador visible, que es como se
nombra la key en pantalla. Es la misma frase que ya está escrita en `ApiKeyRepository.ts:150-152`.

---

## 7. La pantalla

### 7.1 `ApiKeyAccionCell.tsx` — el tercer botón

Se añade `Eliminar` (`variant="destructive"`) junto a Rotar y Activar/Desactivar (R1, R14).

```tsx
<Button
  type="button" size="sm" variant="destructive"
  disabled={!row.eliminable}
  title={row.eliminable ? undefined : MOTIVO_TEXTO[row.motivoNoEliminable!]}
  aria-label={
    row.eliminable
      ? `Eliminar la API key ${row.identificador}`
      : `No se puede eliminar la API key ${row.identificador}: ${MOTIVO_TEXTO[row.motivoNoEliminable!]}`
  }
  onClick={() => setConfirmEliminar(true)}
>
  Eliminar
</Button>
```

El motivo va en el **nombre accesible** y en el `title` (R28): un botón deshabilitado no recibe
foco, así que dejar el motivo solo en un tooltip lo haría invisible para media pantalla. Los textos
viven en un módulo PURO `_components/api-key-eliminable-label.ts`, hermano del que ya existe para
el estado (`api-key-estado-label.ts`), para que los tests los lean sin arrastrar React:

| motivo | texto |
| --- | --- |
| `ordenes` | «Tiene órdenes a su nombre. No se puede eliminar.» |
| `dinero` | «Tiene movimientos de dinero a su nombre. No se puede eliminar.» |
| `tarifas` | «Tiene tarifas configuradas. Bórralas primero desde Configuración › Tarifas.» |
| `activa` | «Está activa. Desactívala antes de eliminarla.» |
| `otros_datos` | «Tiene datos asociados.» *(solo aparece como toast tras un intento, nunca en el botón)* |

El caso `activa` es el único **accionable desde la misma fila**: el botón que lo resuelve
—«Desactivar»— está justo al lado.

### 7.2 La confirmación

`Modal` compartido, `closeOnConfirm={false}` (anti-doble-submit por su `pendingRef`). **Confirmación
destructiva simple, patrón de la ficha 332**: no se pide teclear nada. La fricción ya la puso el
paso previo obligatorio de desactivar (R11), que es un acto explícito, visible en el listado y
reversible.

- **Título:** «Eliminar la API key».
- **Cuerpo (R30):** nombra `{identificador}` y enuncia, en un `role="alert"`, las tres
  consecuencias: es **irreversible**; el secreto **deja de funcionar de forma definitiva**;
  desaparecen también **su cuenta dedicada** y **su suscripción de webhook**.
- **Alternativa no destructiva (R31):** una línea que dice que la key **ya está desactivada** y que
  dejarla así revoca el acceso sin borrar nada.
- **`confirmLabel`:** «Sí, eliminar», `confirmVariant="destructive"`; `cancelLabel` «Cancelar» (R32).

### 7.3 Después del borrado

`onMutated()` (el `mutate` de SWR que ya inyecta `ApiKeysModule`, `:175`) **antes** de cerrar, y
un toast de éxito «API key eliminada» (R33). Los errores reusan el `mensajeError` de la celda
(`:158-169`) con un caso más: `bloqueada` → el texto del motivo. Para R35 —última fila de una
página que no es la primera— `ApiKeysModule` compara `data.items.length === 1 && page > 1` tras un
borrado con éxito y hace `setPage(page - 1)`; el `onMutated` de la celda gana un parámetro opcional
o el módulo envuelve el suyo. **Se resuelve en el módulo, no en la celda**: la celda no conoce la
paginación.

---

## 8. Alternativas descartadas

**A1 · Soft delete / archivado / papelera de API keys.** Una columna `deleted_at` en `api_key` (o
una tabla de archivadas) resolvería «quitarla del listado» sin borrar nada, y permitiría deshacer.
**Descartada** porque (a) el humano fijó lo contrario el 2026-09-04 y ya se descartaron dos specs
por rediseñar en vez de arreglar, (b) no resuelve el problema real: el identificador seguiría
QUEMADO, porque la cuenta dedicada seguiría ocupando su email y su cédula, y (c) añade un estado
más a un ciclo de vida que ya tiene `activa`/`inactiva` y que nadie ha pedido ampliar.

**A2 · Borrar también las tarifas de la cuenta dedicada, en la misma transacción.** Es viable
—`tarifa.tienda_id` ya es `CASCADE`, y `tarifa_borrada` ya existe en el catálogo con su etiqueta—,
y sería más cómodo para el maestro. **Descartada, y el humano la ratificó el 2026-09-04**: una
tarifa es configuración de dinero, y hacerla desaparecer dentro de una acción llamada «eliminar una
API key» es un efecto lateral que el usuario no pidió; por cascada de base la borraría **sin fila
de auditoría** (borrarla desde su propia pantalla sí la deja). Bloquear cuesta un clic más en otra
pantalla y el botón lo dice. Medido el 2026-09-04: **ninguna** de las dos keys de producción tiene
tarifas, así que el coste real hoy es cero.

**A3 · Borrar la key y dejar viva la cuenta dedicada.** Es el borrado «mínimo» de verdad: una
sentencia, cero riesgo de huérfanos. **Descartada** porque deja el identificador quemado para
siempre: la cuenta conserva `apikey+<slug>@apikey.invalid` y `cedula` sintética, y volver a generar
esa key devolvería `conflict` por email/cédula (`ApiKeyRepository.ts:360-367`) sin que nada explique
por qué. Sería un fallo mudo de manual.

**A4 · Cambiar las FK a `ON DELETE CASCADE` y dejar que la base limpie.** Una migración y se acabó
el guard. **Descartada** de plano: convertiría «borro una key de pruebas» en «borro sus órdenes,
sus cargas, su analítica y su rastro de auditoría», en silencio y sin vuelta atrás. Las FK
`Restrict` de este esquema están puestas a propósito y con el motivo escrito al lado
(`db/schema.prisma:151,152,160`).

**A5 · Calcular `eliminable` con un `_count` anidado en `LIST_SELECT`.** Prisma sabe hacerlo y sería
una sola consulta sin SQL crudo. **Descartada** porque `_count` **cuenta** en vez de comprobar
existencia: sobre una cuenta con 40.000 órdenes recorre las 40.000 para responder «sí», y hay que
repetirlo por relación y por fila. El `EXISTS` corta en la primera.

**A6 · No calcular nada en el listado y dejar que el borrado falle con un mensaje.** Menos código.
**Descartada** por el encargo, y con razón: un botón que se ofrece y luego falla enseña al usuario
a desconfiar de todos los botones.

**A7 · Permitir eliminar una key `activa` (guard solo por datos).** Es lo que decía el borrador de
esta spec. **Descartada por el humano el 2026-09-04**: una key recién creada y en uso tiene 0
órdenes, así que el guard por datos la daría por borrable —el caso exacto de «API Nuform»— y el
integrador se quedaría fuera sin aviso ni vuelta atrás. Exigir `inactiva` (R11) mete un paso
reversible y visible antes del irreversible, sin coste de consulta.

**A8 · Confirmación reforzada tecleando el identificador.** Estaba en el borrador. **Descartada por
el humano el 2026-09-04**: con el paso previo de desactivar, la fricción ya es suficiente, y el
patrón de la casa para un borrado físico es la confirmación destructiva simple (ficha 332).

---

## 9. Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Una FK futura hacia `usuario` que nadie clasifique | La guardia de §3 (R17) + la red de FK (R16) |
| El guard del listado se queda rancio entre el pintado y el clic (incluido «alguien reactivó la key») | Se re-evalúa **estado y datos** dentro de la tx (R15, §6 paso 2) y, por debajo, Postgres cierra la ventana |
| Contar solo órdenes vivas | Explícitamente prohibido (§4.1, R8); test dedicado con una orden **borrada** |
| `$queryRaw` probado contra un doble | Su test es de integración contra Postgres real; un doble no ve el `WHERE` |
| El `down.sql` copia la lista de enum equivocada | La lista de partida está nombrada con archivo exacto (§2.1) y el test de migración compara el enum de la base contra el catálogo |
| Producción vacía desde el 2026-08-25 | Un cero medido hoy significa «aún no ha pasado»; por eso el guard no se justifica en los números de hoy sino en el esquema |
| Borrar por error una key en uso | R11 (hay que desactivarla antes, y eso se ve) + R30 (las tres consecuencias) + el guard por datos |

---

## 10. Verificación

- Gate: `./init.sh --rapido` para PR. **La migración toca `db/schema.prisma`**, así que el modo
  rápido se negará y mandará al completo: `./init.sh` entero antes de la release, y eso es lo
  esperado, no un problema.
- Los tests de `tests/integration/db/**` **necesitan `.env`**: si se saltan, el veredicto no vale.
  Mirar los `skipped`, no solo el `INIT_EXIT`.
- Aplicar la migración en local (`prisma migrate deploy`) antes de correr nada, y **reiniciar el
  dev server** tras regenerar el cliente Prisma.
- Verificación manual mínima en la pantalla real (`Configuración > API`, rol `maestro`): que una
  key `activa` muestre el botón deshabilitado diciendo «Está activa. Desactívala antes de
  eliminarla»; que al desactivarla el botón se habilite; y que tras eliminarla se pueda volver a
  generar una key con el mismo identificador. Ver la app encuentra lo que la suite no.
