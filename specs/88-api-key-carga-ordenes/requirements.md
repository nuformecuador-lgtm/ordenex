# Feature 88 — API key: carga de órdenes por API (consumo; "81a")

> Requisitos en notación EARS. Cada `R<n>` es testeable y se mapea a un test en
> `tasks.md`. Esta feature agrega el **consumo** de la API key que la feature 81
> dejó fuera a propósito: autenticación por key en una petición HTTP + un endpoint
> que carga órdenes desde el sistema del integrador, genera la guía en el acto y
> devuelve cada orden con su `num_guia`.

## Contexto verificado contra el código (no supuesto)

- La feature 81 solo **genera/asigna** keys. No existe ningún lookup por key
  presentada: `IApiKeyRepository` (`lib/interfaces/repositories/IApiKeyRepository.ts`)
  solo expone `createConUsuario`. Esta feature agrega la validación.
- El secreto se persiste como **SHA-256 hex** en `api_key.key_hash` UNIQUE
  (`db/schema.prisma:998-1014`, `lib/utils/api-key-hash.ts`). La cuenta dedicada es
  1:1 (`usuario_id` UNIQUE), rol `apiKey`, creada `estado: "activo"`
  (`lib/repositories/ApiKeyRepository.ts:71`).
- El estado que pidió el humano ("en ruta a bodega_central") = el valor de enum
  **existente** `en_ruta_bodega_principal` (`lib/types/order-status.ts:25`). No hace
  falta un valor de enum nuevo.
- `num_guia` es NULLABLE y hoy se asigna diferido vía la secuencia
  `orden_num_guia_seq` con `nextval(...) WHERE num_guia IS NULL` (idempotente) en
  `OrdenRepository.generarGuiaLote` / `rutearBodegaSateliteLote` (feature 17/30).
- La validación de fila (`filaCargaSchema`, `lib/types/carga-masiva.ts`) y la
  persistencia batch (`BulkOrdenService.cargarMasiva` +
  `OrdenRepository.createManyOrdenes`) ya existen y se **reutilizan**.

---

## Autenticación por API key

- **R1** — CUANDO el sistema recibe una petición al endpoint de carga por API, el
  sistema DEBE extraer el secreto de la key presentada del header acordado
  (`Authorization: Bearer <key>`, ver `design.md §3`) antes de tocar el cuerpo.

- **R2** — SI la petición no presenta ningún secreto de key, ENTONCES el sistema
  DEBE rechazarla con `401` y NO crear ninguna orden.

- **R3** — CUANDO el sistema recibe un secreto de key, el sistema DEBE calcular su
  hash con el MISMO algoritmo SHA-256 hex usado al generarla (`hashApiKey`,
  `lib/utils/api-key-hash.ts`) y buscar la fila `api_key` por `key_hash`. El sistema
  DEBE realizar el lookup por hash y NUNCA comparar el secreto en claro contra la DB.

- **R4** — SI ninguna fila `api_key` coincide con el hash calculado, ENTONCES el
  sistema DEBE rechazar la petición con `401` y NO crear ninguna orden.

- **R5** — MIENTRAS el `estado` del usuario dedicado de la key NO sea `activo`
  (es decir `pendiente`, `inactivo` o `bloqueado`, enum `EstadoUsuario`
  `db/schema.prisma:74-81`), el sistema DEBE rechazar la petición con `403` y NO
  crear ninguna orden.

- **R6** — El sistema DEBE realizar toda la autenticación y validación de la key en
  el servidor. El sistema NUNCA DEBE registrar (log) ni el secreto de la key ni su
  hash, en ninguna ruta de éxito o de error.

## Carga de órdenes

- **R7** — CUANDO una petición autenticada (R3-R5) trae un lote de órdenes con
  cuerpo válido, el sistema DEBE validar cada fila con las mismas reglas de la carga
  masiva existente (campos obligatorios, resolución geográfica provincia→cantón→
  distrito, derivación de zona desde el distrito, deduplicación por `num_remision`
  contra la base y dentro del lote).

- **R8** — CUANDO el sistema crea una orden por esta vía, el sistema DEBE fijar su
  estado inicial en `en_ruta_bodega_principal`, en lugar del default de la carga
  normal (`en_preparacion` / `en_fulfillment`).

- **R9** — CUANDO el sistema crea una orden por esta vía, el sistema DEBE asignarle
  inmediatamente un `num_guia` único, en la MISMA transacción de la creación,
  consumiendo la secuencia `orden_num_guia_seq` (la misma fuente que "Generar guía"),
  de modo que ninguna guía pueda colisionar con las emitidas por la feature 17/30.

- **R10** — CUANDO el sistema termina de procesar el lote, el sistema DEBE devolver,
  por cada orden creada, al menos `num_remision`, `num_guia`, `estado` e `id`.

- **R11** — SI una fila del lote es un duplicado (por `num_remision`, contra la base o
  dentro del mismo lote), ENTONCES el sistema DEBE NO crear una orden nueva para ella,
  NO consumir un `num_guia`, y reportarla como duplicada en la respuesta.

- **R12** — SI una fila del lote no supera la validación (R7), ENTONCES el sistema
  DEBE NO crearla y reportar sus errores de campo en la respuesta, sin abortar las
  filas válidas del mismo lote (misma semántica por-fila que la carga masiva actual).

## Validación del valor

- **R13** — SI una fila no trae `monto_cobrar` o su `monto_cobrar` no es numérico
  válido, ENTONCES el sistema DEBE reportar esa fila como error de campo y NO crearla
  (ver Decisión Abierta §F1.4-3 sobre "obligatorio" vs "opcional").

## No-regresión

- **R14** — El sistema DEBE preservar intacta la carga masiva por sesión existente
  (`app/api/ordenes/carga-masiva/chunk`): mismo default de estado, sin asignación
  inmediata de `num_guia`, autenticada por sesión y restringida a `adminTienda`.

- **R15** — MIENTRAS la petición no esté autenticada por API key válida y activa, el
  sistema NUNCA DEBE permitir crear órdenes en el endpoint de esta feature (la sesión
  de navegador no es una vía de acceso a este endpoint).

---

## Decisiones abiertas para el gate F1.4

> ## ✅ GATE F1.4 RESUELTA POR EL HUMANO — 2026-07-17
>
> Ya no son preguntas: son las decisiones vigentes. Implementar tal cual.
>
> - **D1/D2 — "validar el ESTADO":** el usuario dedicado de la key **DEBE estar
>   `activo`**; inactivo/bloqueado → la carga se rechaza (esta es la palanca de
>   revocación). CON la recomendación.
> - **D3 — "validar el VALOR": OVERRIDE del humano.** NO se endurece el `monto_cobrar`:
>   se **HEREDA la regla actual** de la carga masiva (`carga-masiva.ts`), que **permite
>   el monto vacío/null** y valida solo que, si viene, sea numérico y no negativo. Es
>   decir: el "validar el valor" del pedido se satisface con la validación estándar del
>   `BulkOrdenService`, **NO** con un `monto` obligatorio. **No agregar un requisito de
>   obligatoriedad** (ajustar/eliminar el R13 original si lo exigía). El humano eligió
>   esto con la nota explícita de que "no cumple del todo el 'validar el valor' del
>   pedido" — es deliberado.
> - **D4 — dueño (`orden.tienda_id`):** el **usuario dedicado de la key**. CON la
>   recomendación. Sin mapeo key→adminTienda (no existe en el modelo).
> - **D7 — `origenTipo`: OVERRIDE — valor NUEVO `carga_api`.** El humano quiere
>   distinguir el canal API en métricas. **ESTO AÑADE UNA MIGRACIÓN** que la
>   recomendación evitaba: `ALTER TYPE "OrdenTipoOrigen" ADD VALUE 'carga_api'` **con su
>   `down.sql`**. ⚠️ Postgres **no soporta `DROP VALUE`** → el `down.sql` debe **recrear
>   el tipo** (mismo patrón que la feature 81 con el rol `apiKey`; round-trip real
>   obligatorio). El historial de la primera transición de estas órdenes usa
>   `origen_tipo = carga_api`.
> - **D5 — header:** `Authorization: Bearer ordx_...` (recomendación).
> - **D6 — campos opcionales (`mensajero_sugerido_id` etc.):** aceptarlos si vienen
>   (reuso de la validación); documentar que el integrador típico no los manda
>   (recomendación).
> - **D8 — respuesta:** `BulkSummary` existente, extendiendo las filas creadas con
>   `numGuia` (recomendación).

Regla 6 del arnés (no inventar). Cada una lleva mi recomendación y su porqué. Las
tres lecturas de "api key, estado y valor" del pedido literal van aquí.

1. **Lectura de "validar api key, estado y valor"** (interpretación central).
   Mi lectura: (a) **api key** = existe y su hash coincide (R3-R4); (b) **estado** =
   el `EstadoUsuario` del usuario dedicado debe ser `activo`, si no la key no carga
   (R5) — la 81 dejó el cierre del login "de facto"; este es el momento correcto para
   validar el estado; (c) **valor** = el `monto_cobrar` de cada orden debe estar
   presente y ser válido (R13). **Recomendación: confirmar esta lectura tal cual.**
   Porqué: es la interpretación que respeta los tres sustantivos del pedido y no
   inventa validaciones extra. Si el humano quiso otra cosa por "estado" o "valor",
   corregir aquí antes de implementar.

2. **¿La key requiere estado `activo`, o basta con que exista?** Recomendación:
   exigir `activo` (R5). Porqué: una cuenta `inactivo`/`bloqueado` es precisamente el
   mecanismo para **revocar** el acceso de un integrador; si una key siguiera cargando
   con la cuenta inactiva, no habría forma de cortarla (la 81 no modela `revoked_at`).
   Riesgo si se descarta: no hay palanca de revocación hasta la 81b.

3. **`monto_cobrar`: ¿obligatorio y positivo, o se hereda la regla actual
   (`>= 0` o vacío→null)?** El schema actual (`carga-masiva.ts:62-73`) lo permite
   vacío. Recomendación: en la vía API exigirlo **presente y numérico `>= 0`**
   (no negativo), pero **NO** exigir `> 0`. Porqué: "validar el valor" del pedido
   implica no aceptar órdenes sin monto por API; pero `> 0` rechazaría entregas sin
   cobro (COD $0), que son legítimas. Abierto: ¿el integrador puede mandar $0?

4. **¿Quién es la `tienda` (`orden.tienda_id`) de estas órdenes?** En la carga normal
   `tiendaId = actor.usuarioId` (el `adminTienda`). El usuario de la API key tiene rol
   `apiKey` sin semántica de tienda. Recomendación: usar el **propio usuario dedicado
   de la key** como `tienda_id` (es un `Usuario` válido y `orden.tienda_id` es un FK
   genérico a `Usuario`). Porqué: cada key representa a un integrador; sus órdenes le
   pertenecen y quedan trazables por ese usuario, sin inventar un mapeo key→tienda que
   no existe en el modelo. Abierto: ¿el negocio necesita atar la key a una tienda
   `adminTienda` real ya existente? Si sí, hace falta un dato nuevo (fuera de alcance).

5. **Header de presentación de la key.** Recomendación: `Authorization: Bearer ordx_...`
   (R1). Porqué: es el estándar de facto para tokens portadores, lo entienden todos los
   clientes HTTP y evita inventar un header propietario. Alternativa `X-API-Key`
   descartada en `design.md §3`.

6. **`mensajero_sugerido_id` y otros campos opcionales de la carga masiva por esta
   vía.** Recomendación: **aceptarlos si vienen** (reuso literal de `resolveFila`), pero
   documentar que el integrador externo típicamente NO los envía; una orden por API sin
   `mensajero_sugerido_id` es el caso normal. Porqué: reutilizar la validación evita
   divergencia; no imponer el campo evita pedir datos que el sistema externo no tiene.
   Abierto: ¿se prohíbe explícitamente `mensajero_sugerido_id` por API (no tiene sentido
   con estado `en_ruta_bodega_principal`)? Recomiendo ignorarlo/rechazarlo; confirmar.

7. **`origenTipo` del historial de la primera transición.** El enum `OrdenTipoOrigen`
   (`db/schema.prisma:865+`) tiene `carga_masiva`, `generacion_guia`, etc. Recomendación:
   **reusar `carga_masiva`** para no requerir migración. Porqué: evita una migración por
   un matiz de trazabilidad; el origen "es estado inicial en una creación batch" encaja.
   Alternativa (migración con `down.sql` para un valor `carga_api`) queda como follow-up
   si el negocio necesita distinguir el canal en las métricas.

8. **Formato exacto de la respuesta y códigos de duplicado/error por fila.** Ver
   `design.md §5`. Recomendación: reusar el `BulkSummary` existente
   (`total/creadas/duplicadas/conError/filas`) y **extender solo las filas creadas** con
   `numGuia`. Confirmar los campos exactos que el integrador espera.
