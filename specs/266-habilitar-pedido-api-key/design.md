# Feature 266 — design

Endpoint por LOTE del canal por API key que habilita pedidos con novedad.
Verificado contra `origin/dev` (`39115008`) en el worktree `C:/w266`.

---

## 0. Lo que ya está decidido y este diseño NO reabre

Tres decisiones firmadas por el humano llegan cerradas a este documento. Se
listan para que el reviewer las reconozca como restricciones y no como opciones:

1. **No se reusa el camino del botón «Habilitar» de la tienda y no se le añaden
   props.** Nada de ensanchar el hilo de notas (227) a `apiKey`, nada de meterle
   parámetros a `rescatarOrdenAyuda` ni a `HabilitarNovedadService.habilitar`. El
   endpoint autoriza como el resto del canal: owner = `actor.usuarioId`
   (patrón 106/R4), sin `autorizarSobreHilo` ni `estaEnVentanaDeEscritura`.
2. **La rama B solo deja log, sin webhook.** No se crea `orden.habilitada`, no se
   abre un segundo tipo de evento y no se toca el OpenAPI por ese motivo.
3. **La rama A sí notifica**, y hay que afirmarlo con un test de emisión.

Y las **seis decisiones de la puerta del 2026-08-23** (D1..D6 en
`requirements.md`), igual de cerradas: estados habilitables `{ayuda_tienda,
devuelta}` **sin `reprogramada`** (D1), tope de 100 filas por lote (D2), segunda
habilitación = `error` honesto y no acuse idempotente (D3), tabla nueva sin lector
aceptada como bitácora de auditoría (D4), familia `habilitacion_api` (D5), la nota
NO se copia al `motivo` del historial (D6).

Y un hecho que la ficha 266 todavía no recoge: **la 268 ya está en `dev`**.
`lib/types/webhook-eventos.ts:60-73` tiene `ayuda_tienda` e `incidente` en
`EVENTOS_PUBLICOS` y `ORIGENES_SIN_EVENTO_PUBLICO` está **vacía** (líneas
115-116). Consecuencia operativa: **este diseño NO toca `webhook-eventos.ts`**.
Con la lista de exención vacía basta con *no añadir* la familia nueva ahí, y eso
es exactamente lo que se hace: nada.

---

## 1. El discriminador: un invariante que el repo ya mantiene

«El paquete sigue asignado a un mensajero» = `orden.mensajero_asignado_id IS NOT
NULL`. No es una heurística: cada camino que devuelve el paquete a bodega pone la
columna a `NULL` y lo dice en su comentario —`LiberacionReprogramadaRepository:93`,
`DevolucionSlaRepository:136`, `RecuperacionBodegaRepository:50`,
`CierresAdminRepository:1443`— y pedir ayuda **no** desasigna
(`OrdenRepository.ts:3171`, «el paquete sigue con él»).

De ahí sale, sin margen, el mapa de ramas:

| Estado actual  | `mensajero_asignado_id` | Rama | Desenlace |
| --- | --- | --- | --- |
| `ayuda_tienda` | NOT NULL | **A** | `ayuda_tienda -> en_reparto` + log + webhook |
| `ayuda_tienda` | NULL | **B** | solo log (defensa: no debería ocurrir) |
| `devuelta` | NULL siempre | **B** | solo log |
| `reprogramada` | — | **no habilitable** (D1) | `error` / `estado_no_habilitable` |
| cualquier otro | — | error | `estado_no_habilitable` |

**La rama A solo puede darse desde `ayuda_tienda`, y `devuelta` cae SIEMPRE en la
rama B**, porque su paquete está físicamente en bodega. Mandar una `devuelta` a
`en_reparto` sería publicar una mentira al integrador, y además la guardia de
transiciones (`lib/types/order-status-transiciones.ts`) rechazaría el par en el
choke point.

⚠️ **Lo que eso significa para el contrato, dicho aquí y en el OpenAPI:** de los
DOS estados habilitables, **uno solo** puede producir `habilitada`. Un integrador
que mande un lote de `devuelta`s recibirá `habilitada_sin_cambio_de_estado` en el
100 % de las filas, y eso es correcto, no una degradación. Ver `requirements.md`,
bloque de vocabulario.

Constante nueva, en un módulo puro hermano del que declara los grupos:

```ts
// lib/types/habilitacion-api.ts (nuevo, módulo puro: sin Prisma, sin Next)
// D1 (puerta del 2026-08-23): los DOS grupos que el repo ya declara en
// `novedad-grupo.ts` (`ayuda` -> ayuda_tienda, `devolucion` -> devuelta), y
// ninguno más. `reprogramada` QUEDA FUERA a propósito: es novedad para Dropi,
// pero no es un grupo de `/novedades`, y añadirla «por simetría» abriría una
// segunda lista que alguien tendría que mantener de acuerdo con la primera.
// Fuera también `rechazada`, `incidente` y `sin_gestionar`.
export const ESTADOS_HABILITABLES_API = [
  ESTATUS_POR_GRUPO.ayuda, // "ayuda_tienda"
  ESTATUS_POR_GRUPO.devolucion, // "devuelta"
] as const satisfies readonly OrderStatusValue[];
```

Se **derivan de `ESTATUS_POR_GRUPO`** (`lib/types/novedad-grupo.ts:63`) y no se
reescriben como literales: dos literales son dos verdades, y el día que un value
cambie ahí este endpoint dejaría de habilitar lo que la pantalla llama novedad.
El `satisfies` rompe el build si un value deja de existir en `ORDER_STATUS_SEED`.
Es lista de **inclusión**: un estado nuevo del catálogo NO se vuelve habilitable
solo, y un grupo nuevo de `/novedades` tampoco entra sin una decisión aquí.

---

## 2. Modelo de datos

### 2.1 Familia de historial nueva: `habilitacion_api`

Value nuevo del enum nativo `orden_historial_origen_tipo`. Migración:

```
db/migrations/2026XXXXXXXXXX_orden_historial_origen_habilitacion_api/
  migration.sql   -- ALTER TYPE "orden_historial_origen_tipo"
                  --   ADD VALUE IF NOT EXISTS 'habilitacion_api';
  down.sql        -- recrea el tipo sin el value (Postgres no tiene DROP VALUE)
```

Patrón idéntico al de `rechazo_tienda`
(`20260820190000_orden_historial_origen_rechazo_tienda`): el `ADD VALUE` va
**solo** en su migración —Postgres prohíbe usar un value recién añadido en la
misma transacción (55P04) y Prisma Migrate corre cada `migration.sql` en una— y
el `down.sql` recrea el enum con la lista previa (31 valores, los 30 del down de
la 240 más `rechazo_tienda`) y hace `ALTER COLUMN ... USING`. Si queda alguna
fila con `habilitacion_api`, el `USING` falla ruidosamente y el rollback aborta:
comportamiento correcto y buscado.

Y tres consecuencias que este diseño **declara explícitamente**:

- **`habilitacion_api` NO entra en `ORIGEN_TIPOS_VISITA_REAL`**
  (`lib/types/orden-historial.ts:222`). Esa lista es de INCLUSIÓN a propósito:
  una familia nueva por defecto no cuenta como visita real, que es la dirección
  segura del error. Habilitar no es una visita: nadie fue a ninguna puerta.
  Meterla ahí «por simetría» subiría el conteo de intentos, adelantaría el
  escalado del cron SLA (99) y dispararía `cobroRechazado` (56) —dinero real—
  antes de tiempo y en silencio. **No se agrega.**
- **`habilitacion_api` NO entra en `ORIGEN_TIPOS_CON_GESTION`**: su fila nace con
  `gestion_orden_id` NULO.
- **`habilitacion_api` NO entra en `ORIGENES_SIN_EVENTO_PUBLICO`**: la lista está
  vacía desde la 268 y así se queda. Por eso la rama A emite (R17/R27).

Además, `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED` (`lib/types/orden-historial.ts:14`) y
el `enum OrdenHistorialOrigenTipo` de `db/schema.prisma:1628` ganan el value: el
`satisfies` y el `_EnsureExhaustive` rompen el build si falta en cualquiera de
los dos.

### 2.2 Tabla nueva: `orden_habilitacion_api`

El registro de la habilitación, **común a las dos ramas**.

```sql
CREATE TABLE "orden_habilitacion_api" (
  "id"                TEXT NOT NULL,
  "orden_id"          TEXT NOT NULL,
  "actor_usuario_id"  TEXT NOT NULL,   -- el usuario dedicado de la key (= tienda_id)
  "nota"              TEXT NOT NULL,   -- tope de 200 en el borde (zod), como orden_nota.cuerpo
  "cambio_de_estado"  BOOLEAN NOT NULL,-- true = rama A; false = rama B
  "estado_resultante" TEXT NOT NULL,   -- order_status.value en el que quedó la orden
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "orden_habilitacion_api_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "orden_habilitacion_api_orden_id_fkey" FOREIGN KEY ("orden_id")
    REFERENCES "orden"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "orden_habilitacion_api_actor_usuario_id_fkey"
    FOREIGN KEY ("actor_usuario_id")
    REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "orden_habilitacion_api_orden_id_created_at_idx"
  ON "orden_habilitacion_api"("orden_id", "created_at");
CREATE INDEX "orden_habilitacion_api_actor_usuario_id_idx"
  ON "orden_habilitacion_api"("actor_usuario_id");
ALTER TABLE "orden_habilitacion_api" ENABLE ROW LEVEL SECURITY;
```

Decisiones y su porqué:

- **Append-only, sin `updated_at` ni `deleted_at`** (R24). Es una bitácora: una
  segunda habilitación con otra nota es un hecho nuevo, no una corrección.
  Mismo criterio que `orden_historial_estado`.
- **`ON DELETE CASCADE` sobre la orden, `RESTRICT` sobre el usuario**: patrón
  literal de `orden_nota` (`20260815120000_orden_nota`). La autoría es evidencia
  y no se pierde al dar de baja a un usuario.
- **`estado_resultante` es `TEXT` y no FK a `order_status`**: es un SNAPSHOT de
  lo que se le respondió al integrador en ese instante, no una referencia viva.
  Si mañana un value se renombra, la bitácora debe seguir diciendo lo que dijo.
- **RLS habilitada SIN policies** (solo service role): patrón
  `orden_nota` / `orden_historial_estado` / `gestion_orden`. Toda la autorización
  de negocio vive en el service.
- **`cambio_de_estado` es un booleano y no se deriva**: se deriva del par
  (estado anterior, estado resultante) solo si alguien recuerda cómo; escrito,
  la fila se explica sola y el test lo puede afirmar.

Modelo Prisma correspondiente en `db/schema.prisma` (`@@map("orden_habilitacion_api")`),
más las relaciones inversas en `Orden` y `Usuario`.

> ⚠️ Esta migración crea tabla → **toca `db/migrations` y `db/schema.prisma`**.

### 2.3 El único cambio al contrato compartido del repositorio

`TransicionAyudaInput.origenTipo`
(`lib/interfaces/repositories/IOrdenRepository.ts:367`) es hoy
`Extract<OrdenHistorialOrigenTipo, "solicitud_ayuda_tienda" | "rescate_ayuda_tienda">`.
Gana un tercer miembro:

```ts
origenTipo: Extract<
  OrdenHistorialOrigenTipo,
  "solicitud_ayuda_tienda" | "rescate_ayuda_tienda" | "habilitacion_api"
>;
```

Es **aditivo y no cambia el comportamiento de ningún llamador existente**: los
dos services actuales siguen pasando su literal de siempre. No es «añadir props»
en el sentido prohibido por la decisión (1): no se toca la firma de
`rescatarOrdenAyuda`, ni la de `HabilitarNovedadService.habilitar`, ni ningún
parámetro de comportamiento; se amplía el censo de familias que el punto único
sabe registrar, que es literalmente para lo que ese campo existe.

**No se añade `motivo` a `TransicionAyudaInput`.** Ver §7, alternativa A2.

---

## 3. Ruta y contrato I/O

### 3.1 Ruta

```
POST /api/ordenes/api-key/habilitar
```

`POST` y no `PUT`: es un lote sin recurso identificable en la URL y el efecto no
es idempotente a nivel de bitácora (cada llamada válida añade filas de log).
No cuelga de `[numGuia]` porque el pedido literal del humano es un lote.

`middleware.ts` **no se toca**: `SELF_AUTH_ROUTES` ya contiene el prefijo
`/api/ordenes/api-key` (`middleware.ts:32`) y la guardia 229 compara las tres
listas del middleware posicionalmente — añadir una ruta ahí la pondría roja sin
necesidad.

`export const runtime = "nodejs"` (Prisma + hash de la key).

### 3.2 Entrada

```jsonc
{
  "ordenes": [
    { "num_guia": 100234, "nota": "el cliente pidió reintento mañana" },
    { "num_guia": 100235, "nota": "dirección corregida por el call center" }
  ]
}
```

Validación en **dos niveles**, y la división es deliberada:

- **Envoltorio (zod, 422 global, R6):** el cuerpo es JSON, `ordenes` es un array,
  `1 <= length <= TOPE_FILAS_HABILITAR`, y cada elemento es un objeto. Un cuerpo
  que ni siquiera tiene la forma de un lote no se puede procesar «por filas».
  **`TOPE_FILAS_HABILITAR = 100`** (D2, firmada 2026-08-23), declarado en
  `lib/config/` junto al resto de topes y no como número suelto en el schema. No
  se reusa `cargaMasivaConfig.MAX_CHUNK_ROWS`: aquel dimensiona UN insert masivo
  y este dimensiona N transacciones cortas independientes; compartir la constante
  ataría dos presupuestos que no tienen nada que ver.
- **Campos de cada fila (por fila, R7):** `num_guia` entero positivo; `nota`
  string, `trim`, no vacía, `<= 200` caracteres (el mismo tope de
  `orden_nota.cuerpo`). Una fila mal formada NO tumba el lote: se marca
  `fila_invalida` y el resto sigue. Esto es lo que hace cierta la promesa de
  «nunca un 4xx global que tire el lote entero».

`nota` es **obligatoria**: sin motivo, el log de la rama B no sirve para nada, que
es justo lo único que la rama B produce.

### 3.3 Salida — HTTP 200

```jsonc
{
  "resumen": {
    "total": 3,
    "habilitadas": 1,
    "habilitadasSinCambioDeEstado": 1,
    "conError": 1
  },
  "resultados": [
    { "numGuia": 100234, "resultado": "habilitada",
      "estado": "en_reparto", "error": null },
    { "numGuia": 100235, "resultado": "habilitada_sin_cambio_de_estado",
      "estado": "devuelta", "error": null },
    { "numGuia": 999999, "resultado": "error",
      "estado": null,
      "error": { "codigo": "no_encontrada",
                 "mensaje": "no existe una orden viva con esa guía" } }
  ]
}
```

`resultados` conserva **orden y cardinalidad** del array de entrada (R11): el
integrador puede casar por índice sin depender de `numGuia`.

Códigos de error por fila (conjunto cerrado, se documenta en el OpenAPI):

| código | cuándo |
| --- | --- |
| `fila_invalida` | `num_guia` o `nota` no cumplen R7 |
| `duplicada_en_lote` | segunda o posterior aparición de la misma guía (R8) |
| `no_encontrada` | no hay orden viva con esa guía **para este owner** (R4) |
| `estado_no_habilitable` | el estado actual no está en `ESTADOS_HABILITABLES_API` (incluye `reprogramada`, R13-b, y la segunda habilitación de una orden ya en `en_reparto`, R31), o la carrera de R18 |

**Idempotencia, escrita en el contrato (D3):** habilitar dos veces la misma orden
de la rama A devuelve `error` / `estado_no_habilitable` en la segunda llamada,
con cero escrituras. No se devuelve `habilitada`: un acuse falso es peor que un
error honesto. En la rama B, en cambio, cada llamada válida añade una fila de
bitácora —el estado no cambia, pero una segunda nota es un hecho nuevo y la
bitácora es append-only (R24)—.

`no_encontrada` es deliberadamente **opaco**: no distingue «no existe» de «es de
otra tienda». Mismo criterio que `cancelarViaApi` (106/R23-R24). El borde no es
un oráculo del estado de una guía ajena.

**HTTP 200 aunque todas las filas fallen** (R9). El único 4xx global son 401, 403
y el 422 del envoltorio.

---

## 4. Capas

```
app/api/ordenes/api-key/habilitar/route.ts        Controller
  ↓  IApiHabilitacionService
lib/services/ApiHabilitacionService.ts            Service (puerta + guarda + orquestación)
  ↓  Pick<IOrdenRepository, ...>   +   IOrdenHabilitacionApiRepository
lib/repositories/OrdenRepository.ts               (lectura + PUNTO ÚNICO de escritura de estado)
lib/repositories/OrdenHabilitacionApiRepository.ts (registro append-only)
```

### 4.1 Controller

Calco de `handleCancelarApi` (`app/api/ordenes/api-key/[numGuia]/cancelar/route.ts`):
`extraerBearer` + `buildAutenticar` (`lib/api/api-key-request`), `withErrorHandler`,
`UnauthenticatedError` → 401, `ForbiddenError` → 403, `ValidationError` → 422.
Exporta `handleHabilitarApi(req, deps)` con `deps` inyectables (autenticar +
service) para tests sin DB, y un `POST` fino encima. Cero lógica de negocio.

### 4.2 Repositorio — lectura

Método nuevo, **solo lectura**, en `OrdenRepository`:

```ts
findParaHabilitacionApi(numGuia: number, ownerId: string): Promise<{
  id: string;
  estatusId: string;
  estatusValue: string;
  mensajeroAsignadoId: string | null;
} | null>;
```

`where: { numGuia, tiendaId: ownerId, deletedAt: null }` — el owner se fuerza en
el `where`, igual que en `cancelarViaApi` (`OrdenRepository.ts:1963`), no en un
`if` posterior.

### 4.3 Repositorio — registro

`OrdenHabilitacionApiRepository` implementa
`IOrdenHabilitacionApiRepository` con un único método
`registrar(input: { ordenId; actorUsuarioId; nota; cambioDeEstado; estadoResultante }): Promise<void>`.
Sin autorización propia (patrón del repo): la puerta la pone el service.

### 4.4 Service — `ApiHabilitacionService`

Dependencias por interfaz, y la forma del `Pick` **es parte del diseño**:

```ts
constructor(
  private readonly ordenRepo: Pick<
    IOrdenRepository,
    "findParaHabilitacionApi" | "findEstatusIdByValue" | "transicionarAyuda"
  >,
  private readonly logRepo: IOrdenHabilitacionApiRepository,
) {}
```

El service **no tiene acceso a `prisma`** ni a ningún método de escritura de
estado que no sea `transicionarAyuda`. Un segundo `updateMany` sobre el estado no
es que esté prohibido por convención: **no compila**.

Algoritmo por fila (el lote se recorre en orden, secuencialmente):

1. Valida los campos de la fila → `fila_invalida`.
2. `num_guia` ya vista en este lote → `duplicada_en_lote`; si no, se marca vista.
3. `findParaHabilitacionApi(numGuia, actor.usuarioId)` → `null` → `no_encontrada`.
4. **GUARDA DE ESTADO PROPIA (R14).** `estatusValue ∈ ESTADOS_HABILITABLES_API`,
   si no → `estado_no_habilitable`. Va **aquí**, en este llamador, y no se delega
   en el `WHERE` de `transicionarAyuda`. Es explícito porque el punto único
   declara su riesgo #1 al revés («la guarda de estado vive AQUÍ, en el punto
   único, y no en los llamadores», `lib/services/rescate-ayuda.ts:18-20`) y este
   endpoint **no pasa por `rescatarOrdenAyuda`**: si no trae la suya, no tiene
   ninguna primera red. El `WHERE` del repo sigue siendo la segunda.
5. **Rama A** si `estatusValue === "ayuda_tienda" && mensajeroAsignadoId !== null`:
   1. `findEstatusIdByValue("ayuda_tienda")` y `findEstatusIdByValue("en_reparto")`.
      Si alguno es `null` → **fallo cerrado**, la fila se rechaza sin escribir
      nada (R19). Mismo criterio que `rescate-ayuda.ts:76-80`.
   2. `transicionarAyuda({ ordenId, estatusOrigenId, estatusDestinoId,
      actorUsuarioId: actor.usuarioId, origenTipo: "habilitacion_api" })`.
      Devuelve `false` si la orden se movió entre 3 y 5.2 → `estado_no_habilitable`
      (R18), sin log y sin efectos parciales: el `updateMany` guardado por origen
      afectó 0 filas y el append no ocurrió.
   3. `logRepo.registrar({ ..., cambioDeEstado: true, estadoResultante: "en_reparto" })`.
   4. → `habilitada`, `estado: "en_reparto"`.
6. **Rama B** en cualquier otro caso habilitable:
   1. `logRepo.registrar({ ..., cambioDeEstado: false, estadoResultante: estatusValue })`.
   2. → `habilitada_sin_cambio_de_estado`, `estado: estatusValue`.
      **Ninguna escritura de estado. Ningún webhook.** (R20/R22)

### 4.5 Cómo se respetan a la vez 235/R8 y la decisión (1)

235/R8 exige «un solo punto de escritura, y ese punto debe ser el que usen tanto
el mensajero como la tienda», y existe porque hasta el 2026-08-19 hubo DOS
apagadores divergiendo. Este diseño no lo rompe:

- El punto único **real** de escritura es el repositorio,
  `OrdenRepository.transicionarAyuda` (`OrdenRepository.ts:3415`): guardado por el
  estado de origen, con su append por el choke point en la MISMA transacción.
  Este endpoint llama a **ese** método.
- Lo que se duplica es **la puerta** (autorización), y es legítimamente distinta:
  una sesión de tienda y una API key no se autorizan igual. Lo que **no** se
  duplica es la **escritura**.
- **Si aparece un segundo `updateMany` sobre `orden.estatus_id`, es un fallo de
  diseño y un hallazgo mayor del reviewer.** El `Pick` de §4.4 lo hace
  estructuralmente imposible.

---

## 5. Webhook (rama A)

No hay código de emisión nuevo. La transición pasa por `appendCambioEstado`
(`lib/repositories/registrar-cambio-estado.ts:173`), que en la MISMA transacción
llama al emisor; el emisor pregunta a
`esTransicionEmitible(estadoDestino, origenTipo)`
(`lib/types/webhook-eventos.ts:139`) y encola `webhook_estado`.

Con `dev` de hoy: `esEventoPublico("en_reparto") === true` y
`esFamiliaSinEventoPublico("habilitacion_api") === false` (lista vacía desde la
268) ⇒ **emite**. Esto se **afirma con un test**, no se asume (§6, T-E1/T-E2):
la ficha llevaba esa advertencia desde su alta y sigue en pie.

El evento es el de siempre, `orden.estado_actualizado` con destino `en_reparto`.
**No se crea ningún evento nuevo y no se toca el OpenAPI de `webhooks:`.**

Rama B: sin transición ⇒ el choke point no se invoca ⇒ no hay nada que encolar.
Deuda declarada (ver requirements, «Fuera de alcance»).

---

## 6. Documentación pública

- `lib/api/openapi-spec.ts`: path nuevo `/api/ordenes/api-key/habilitar`, con su
  `requestBody`, su `200`, el `enum` de `resultado`, el `enum` de `error.codigo`
  y los `401/403/422`. La `description` DEBE decir tres cosas que el integrador no
  puede adivinar: (a) los estados habilitables son **`ayuda_tienda` y `devuelta`**
  y ningún otro —`reprogramada` incluida, que devuelve `estado_no_habilitable`—;
  (b) **una `devuelta` NUNCA cambia de estado**, siempre responde
  `habilitada_sin_cambio_de_estado`, porque su paquete ya está en bodega; (c) el
  tope de **100 filas** por lote.
- `docs/api/api-key-openapi.yaml`: espejo textual (hay tests que lo leen como
  texto, p. ej. `tests/unit/api/openapi-webhook-contrato.test.ts:22`).
- `docs/api/ordenex-api-key.postman_collection.json`: request de ejemplo.
- `docs/api/CHANGELOG.md`: entrada del endpoint nuevo.

---

## 7. Alternativas descartadas

### A1 — Escribir el log de la rama B en `orden_nota` (hilo de la 227), con `rol_autor = 'apiKey'`

Es el candidato natural: la tabla ya existe, ya tiene autor, cuerpo, orden y
borrado lógico, y el tope de 200 de `nota` viene de ahí.

**Descartada.** El hilo está cerrado a `adminTienda` y `mensajero`
(`lib/types/ventana-hilo-notas.ts:39-43`, 227/R12 excluye `apiKey` explícitamente).
Meter filas con `rol_autor = 'apiKey'` es ensanchar el hilo *de facto* aunque no
se toque una línea de `OrdenNotaService`: esas notas aparecerían en el hilo que
lee el mensajero, con un rol que la tabla de ventana no contempla y que la
interfaz no sabe etiquetar. Además choca de frente con la decisión firmada (1).
Y arrastra el precedente «ventana de escritura vs superficie visible», que ya
mordió dos veces en la 221: acotar por estatus sin mirar dónde ve la orden cada
rol concede permisos inejercitables — o, aquí, publica texto en una superficie
que nadie autorizó.

### A2 — No crear tabla: guardar la nota en el `motivo` de la fila de historial

`CambioEstadoEntrada` ya tiene `motivo`, y hay precedente exacto:
`cancelacion_api` persiste `motivo: 'cancelada por tienda'`
(`OrdenRepository.ts:1983`). Sería atómico con la transición, gratis, y encima
visible en la línea de tiempo de la 49/262.

**Descartada.** Solo funciona para la rama A. **La rama B no tiene fila de
historial y no puede tenerla**: el choke point valida el par contra
`TRANSICIONES` y `devuelta -> devuelta` no es una arista; fabricar una transición
a sí misma para colgarle un texto es exactamente la clase de mentira que esta
feature evita. Usar `motivo` solo para la rama A dejaría el mismo dato en dos
hogares según la rama, y «leer todas las habilitaciones de una orden» pasaría a
ser una consulta a dos fuentes que alguien tendría que recordar unir. Una tabla,
una historia. **FIRMADO en la puerta el 2026-08-23 (D6): la nota NO se copia al
`motivo`.** Se acepta el coste declarado —la nota no se ve en la línea de tiempo
de la 49/262— a cambio de un único hogar del dato. No se deja gancho para ello.

### A3 — Reusar la familia `rescate_ayuda_tienda` y ahorrarse la migración

Es la opción barata: la transición es la misma arista y ya existe una familia
para ella.

**Descartada.** Borraría la única distinción entre «el mensajero recuperó / la
tienda pulsó Habilitar» y «el integrador habilitó por API». Y `actor_usuario_id`
**no** la recupera: el usuario dedicado de la key ES la tienda
(`tiendaId: ownerId`, `OrdenRepository.ts:1963`), el mismo sujeto que el
`adminTienda` del botón. Precedente literal en este repo: `rechazo_tienda` (240)
nació como familia propia frente a `escalado_devuelta_sla` por este mismo
argumento —el historial es la única evidencia de *quién* decidió—, y el
`migration.sql` de la 240 lo deja escrito.

### A4 — Emitir un evento propio `orden.habilitada` para la rama B

Recomendado por la propia ficha en su primera tanda.

**Descartada por decisión firmada del humano (2026-08-22, decisión B):** «si no
está asignada a un mensajero deja el log no más, mientras se define ese flujo».
No se crea el evento, no se abre un segundo tipo de evento en el canal y no se
toca el OpenAPI por este motivo. El integrador se entera por la **respuesta
síncrona**, que por eso distingue los desenlaces fila por fila (R10). Queda como
**deuda declarada**: el evento de estado no puede representar una habilitación
sin cambio de estado sin mentir —y su `eventoId` determinista por
(ordenId, estatusDestinoId, instante) haría indistinguibles dos habilitaciones
seguidas—, así que cuando se defina será ficha aparte.

### A5 — Un endpoint por guía (`PUT /api/ordenes/api-key/{numGuia}/habilitar`)

Encajaría mejor con el vecino `cancelar` y sería idempotente de libro.

**Descartada.** El pedido literal es un lote (`[{num_guia}, {nota}]`) y el patrón
del canal para el trabajo por volumen ya es el lote con resultado por fila
(`POST /api/ordenes/api-key/carga`). N peticiones HTTP para resolver N novedades
es justo lo que el integrador pidió evitar.

### A6 — Un repositorio nuevo que escriba estado y log en UNA transacción

Cerraría el hueco de atomicidad de §8.

**Descartada.** Exige un segundo `updateMany` sobre `orden.estatus_id` fuera de
`transicionarAyuda`: es exactamente el fallo que 235/R8 existe para impedir y que
esta ficha declara hallazgo mayor. El hueco de §8 es más barato que dos
apagadores divergiendo otra vez.

---

## 8. Riesgos y limitaciones declaradas

1. **Hueco de atomicidad en la rama A (aceptado).** `transicionarAyuda` abre su
   propia `$transaction`, así que la fila de `orden_habilitacion_api` se escribe
   **después** del commit de la transición. Si el proceso muere entre las dos, la
   orden queda en `en_reparto` sin su fila de log. Lo que **no** se pierde: la
   fila de historial (`habilitacion_api`, `actor_usuario_id` = usuario de la key)
   sigue probando quién y cuándo; lo único que se pierde es el texto de la nota.
   El orden es deliberado —transición primero, log después— para que **nunca**
   exista una fila de log que afirme un cambio de estado que no ocurrió (R25).
   Cerrarlo cuesta A6, que es peor.
2. **La tabla nace SIN LECTOR, y se acepta: es una bitácora de auditoría** (D4,
   firmada 2026-08-23). Ninguna superficie la consulta y esta feature no le
   inventa ninguna. **Exponerla es ficha aparte.** Se escribe aquí, en voz alta y
   con esas palabras, por el precedente de la 270: allí una columna que nadie
   leía pasó inadvertida justamente porque nadie la había declarado write-only.
3. **`en_reparto` repetido.** Un integrador puede recibir `en_reparto` dos veces
   sobre la misma orden (ida y vuelta del ciclo de ayuda). No es de esta ficha:
   es el coste que la 268 ya aceptó por escrito, y la clave de idempotencia lleva
   el instante, así que el consumidor deduplica.
4. **Lote secuencial.** Las filas se procesan una a una: N transacciones cortas.
   Es lo que fuerza el tope de 100 filas por lote (D2) y la razón de
   no paralelizar: dos transiciones concurrentes sobre la misma orden del mismo
   lote las evita el dedupe de R8, pero el coste en conexiones no.

---

## 9. Gate

**`./init.sh` COMPLETO, sin excepción.** El diff toca `db/migrations/` y
`db/schema.prisma`, así que `--rapido` **se niega solo** — es un `fail`, no un
aviso. No es una elección del implementer.
