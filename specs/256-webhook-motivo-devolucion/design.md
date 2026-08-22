# Feature 256 — Diseño

Decisiones técnicas ANTES de tocar código. Cada afirmación sobre el árbol lleva archivo y
línea; el estado del árbol citado es idéntico en la rama actual y en `origin/dev`.

> **Puerta humana RESUELTA el 2026-08-21.** Firmado: el campo se llama **`motivo`**, plano en
> `data`, con el **value crudo** del enum; **siempre presente** (`null` fuera de `devuelta` y en
> una `devuelta` sin causa); alcance **solo `devuelta`**; la causa es la **vigente al entregar**
> (payload del job intacto, sin `historialId`); el evento **se publica** en el OpenAPI; el aviso
> a integradores **no** es parte de la feature. Las alternativas de §3 se conservan como
> registro de lo que se evaluó y descartó, no como opciones vivas.

---

## 0. Qué existe hoy (verificado en el código)

**El cuerpo de entrega** se arma en un solo punto,
`lib/services/WebhookEstadoService.ts:85-94`:

```ts
const cuerpo = JSON.stringify({
  evento: EVENTO_ESTADO,          // "orden.estado_actualizado" (:18)
  eventoId,                        // dedupeKey determinista (:84)
  ocurridoAt,                      // del payload del job
  data: { numGuia, numRemision, estado },
});
```

**La lectura** que lo alimenta es `IWebhookOrdenReader.findDatosEntrega`
(`lib/interfaces/repositories/IWebhookOrdenReader.ts:6-23`), implementada en
`lib/repositories/WebhookOrdenReader.ts:15-40` con DOS consultas: `orden.findUnique` (tiendaId,
numGuia, numRemision, deletedAt) y `orderStatus.findUnique` (el `value` del estatus DESTINO).
El cliente Prisma que recibe está acotado a `Pick<PrismaClient, "orden" | "orderStatus">`
(`WebhookOrdenReader.ts:10`).

**La causa** vive en `gestion_orden.causa_devolucion`, enum `GestionCausaDevolucion`
(`db/schema.prisma:765-771`, columna en `:823`), NULLABLE, sin CHECK en base (la obligatoriedad
vive en el borde zod, `lib/types/gestion-orden.ts:358`), y con el histórico previo a la feature
73 SIN backfillear (73/R16, comentario en `db/schema.prisma:816-822`). Los tres values van en
INGLÉS por decisión firmada en la puerta F1.4 de la 73; el enum hermano de incidente va en
español por decisión firmada en la 158 (`db/schema.prisma:741-757`). Ninguna de las dos se
toca aquí.

**Cómo lee este repo «la última gestión de devolución de una orden»** — el criterio ya existe y
está repetido en tres sitios, siempre igual:

| Sitio | Criterio |
| --- | --- |
| `lib/repositories/GestionOrdenRepository.ts:347-351` | `{ ordenId, resultado: 'devuelta', anuladaAt: null }`, `orderBy createdAt desc`, `findFirst` |
| `lib/repositories/OrdenRepository.ts:3260-3278` (`findCausasDevueltaVigentes`) | mismo `where`, en lote por `ordenIds`, se queda con la primera del `desc` y proyecta `causaDevolucion` |
| `lib/repositories/DevolucionSlaRepository.ts:71-77` | mismo `where` como relación ANIDADA con `take: 1` y `select: { causaDevolucion }` |

**Se reutiliza el CRITERIO, no el repositorio.** `OrdenRepository` es enorme y el reader de
webhooks existe justamente para no arrastrar esa superficie al handler
(`IWebhookOrdenReader.ts:1-3`). El molde que se copia es el de
`DevolucionSlaRepository:71-77`: relación anidada dentro de la lectura de la orden.

**Modelo de datos: NO hay migración.** Ni tabla nueva, ni columna nueva, ni RLS nueva, ni
`down.sql`. Se leen columnas que ya existen, con índices que ya existen
(`@@index([ordenId])`, `db/schema.prisma:898`).

---

## 1. Contrato de salida (el único cambio observable)

```jsonc
{
  "evento": "orden.estado_actualizado",
  "eventoId": "webhook_estado:<ordenId>:<estatusDestinoId>:<ocurridoAt>",
  "ocurridoAt": "2026-08-21T10:00:00.000Z",
  "data": {
    "numGuia": 100234,
    "numRemision": "REM-0001",
    "estado": "devuelta",
    "motivo": "not_found"   // ← NUEVO: "not_found" | "wrong_number" | "wrong_address" | null
  }
}
```

- Aditivo puro: ninguna clave existente cambia de nombre, tipo ni valor (R19).
- `motivo` está SIEMPRE presente (R6); es `null` en todo evento que no sea `devuelta`,
  y también en un `devuelta` sin causa registrable (R4/R5).
- El orden de las claves importa: `JSON.stringify` serializa en orden de inserción y la firma
  se calcula sobre esa cadena exacta. `motivo` va DETRÁS de `estado`, así que el
  prefijo del cuerpo de un consumidor que compare texto no cambia... y aun así, **nadie debe
  comparar el cuerpo como texto salvo para verificar la firma**, que se recalcula sobre el
  cuerpo ya ampliado (R16, `WebhookEstadoService.ts:96-98`).

---

## 2. Cambios por archivo

### 2.1 `lib/interfaces/repositories/IWebhookOrdenReader.ts`

`DatosEntregaOrden` gana un campo:

```ts
/**
 * Causa TIPIFICADA de la devolución vigente de la orden (256/R1-R5). `null` = la orden no
 * tiene gestión `devuelta` vigente, o la tiene sin causa (histórico previo a la 73, R16).
 * Value CRUDO del enum `GestionCausaDevolucion`; la traducción a etiqueta es cosa de la UI.
 */
causaDevolucion: CausaDevolucion | null;
```

Tipo importado de `lib/types/causa-devolucion.ts` (`CausaDevolucion`, respaldado por el doble
candado de exhaustividad de la 73, `causa-devolucion.ts:16-28`), **no** de `@prisma/client`
directamente: si el enum gana un cuarto valor, el build lo dice en un solo sitio.

Campo **requerido, no opcional**: un `?` dejaría pasar en silencio a un implementador que se
olvide de proyectarlo. Que esto ponga en rojo el typecheck de los fakes de los tests es
DELIBERADO (ver §5).

### 2.2 `lib/repositories/WebhookOrdenReader.ts`

La causa se resuelve DENTRO del `orden.findUnique` que ya se hace (R12), como relación anidada:

```ts
select: {
  tiendaId: true, numGuia: true, numRemision: true, deletedAt: true,
  gestiones: {
    where: { resultado: "devuelta", anuladaAt: null },  // R8/R9/R10
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { causaDevolucion: true },
  },
},
```

`gestiones` es la relación declarada en `db/schema.prisma:574`. Con `take: 1` + `orderBy`
Prisma emite un LATERAL sobre `gestion_orden` cubierto por `@@index([ordenId])`: **no hay
consulta nueva** y el `Pick<PrismaClient, "orden" | "orderStatus">` de `:10` NO cambia (la
relación anidada no exige el delegate `gestionOrden`). El literal `"devuelta"` se toma de una
constante local con el mismo molde que `RESULTADO_DEVUELTA` de
`OrdenRepository.ts:318`, tipada contra `GestionResultado`.

Resultado: `causaDevolucion: orden.gestiones[0]?.causaDevolucion ?? null`. Los dos caminos de
`null` (sin gestión vigente / gestión con causa nula) colapsan a propósito en el mismo valor:
el contrato público NO distingue «no hubo» de «no se registró» (R4/R5).

### 2.3 `lib/services/WebhookEstadoService.ts`

> ⚠️ **DOS `motivo` DISTINTOS QUE COMPARTEN NOMBRE. Léelo antes de tocar nada.**
> Decisión del humano firmada el 2026-08-21, tomada CON la colisión sobre la mesa:
>
> | Nombre | Qué es | Dónde vive | ¿Sale al webhook? |
> | --- | --- | --- | --- |
> | `data.motivo` (256) | La causa **TIPIFICADA** de la devolución: enum cerrado de 3 valores en inglés | `gestion_orden.causa_devolucion` (`db/schema.prisma:823`), enum en `:765-771` | **Sí**, es este campo |
> | `gestion_orden.motivo` (36/R7) | **TEXTO LIBRE** que escribe el mensajero (reprogramar/devolución/rechazo) | `db/schema.prisma:814`, validado en `lib/types/gestion-orden.ts:219,359` | **No, nunca** (R22) |
>
> No son el mismo dato, no se derivan uno del otro y **no se «unifican»**. El único punto donde
> el nombre público `motivo` se pega al dato de la base es la línea de abajo: en el resto del
> código el concepto sigue llamándose `causaDevolucion` (interfaz, repositorio, tipo), que es
> como lo llama el dominio (73). Si algún día se publica el texto libre, **necesitará otro
> nombre en el contrato** — este ya está ocupado.

Una línea en `data` (`:89-93`): `motivo: <la causa>`. El service NO deriva
nada ni ramifica por estado: si el estado no es `devuelta`, el reader ya devolvió `null` para
una orden que no tiene gestión de devolución vigente... **y si la tuviera** (orden que fue
`devuelta`, se recuperó y hoy transiciona a `en_bodega_central`), el service DEBE emitir `null`
igualmente. Por tanto la ramificación por estado destino vive en UN sitio y hay que elegirlo:

**Decisión: la ramificación va en el SERVICE**, no en el repositorio.
`motivo: datos.estado === "devuelta" ? datos.causaDevolucion : null` — nótese el cruce de
nombres, que es exactamente el punto de traducción descrito en el aviso de arriba. El repositorio
responde «cuál es la causa vigente de esta orden» (una pregunta de datos, siempre la misma) y
la POLÍTICA de contrato «solo se publica cuando el evento es de devolución» queda donde vive el
resto de la política del cuerpo. Alternativa descartada: pasarle el estado destino al `where`
del repositorio, que mezcla contrato con acceso a datos y deja el reader mintiendo según quién
lo llame.

### 2.4 `lib/api/openapi-spec.ts` + `docs/api/api-key-openapi.yaml` (APROBADO, decisión (f))

Sección `webhooks:` de OpenAPI 3.1, a NIVEL SUPERIOR (fuera de `paths:`), con el evento
`orden.estado_actualizado` COMPLETO —no solo el campo nuevo—, espejada en el `.yaml` en el mismo
cambio. Se documenta también que la causa es la vigente al entregar (R15/R24).

**Con una restricción dura**, ver §5.2: el campo `estado` del evento se documenta como
`type: string` con prosa que remite al catálogo, **sin `enum` literal de estados**. El `enum` de
los tres valores de `motivo` sí se escribe: es invisible para la heurística de la guardia.

### 2.5 Lo que NO se toca

`lib/services/jobs/webhook-estado-encolado.ts`, `lib/types/webhook-eventos.ts`,
`lib/services/jobs/webhook-estado-handler.ts` (la fábrica sigue construyendo el reader con el
mismo `prisma`), `lib/crypto/webhook-firma.ts`, `db/schema.prisma`, y cualquier migración.

---

## 3. Alternativas descartadas (obligatorio)

*(Registro de lo evaluado. Todas quedaron CERRADAS en la puerta del 2026-08-21; no son opciones
abiertas. A6 se añade tras la puerta, porque la decisión (a) descartó la recomendación del spec.)*

**A1 — Resolver la causa en el EMISOR y meterla en el payload del job.**
Descartada. El payload es MÍNIMO y sin PII por decisión de la 99/R13
(`webhook-estado-encolado.ts:132-138`) y la ficha lo cierra explícitamente. Además el emisor
corre DENTRO de la transacción del cambio de estado, en el choke point del historial: añadirle
una lectura de `gestion_orden` por cada transición de CADA orden (incluidas las de dueños sin
suscripción, que hoy salen por el no-op de `:103`) es trabajo dentro de una transacción caliente
para un dato que en el 90 % de los eventos es `null`.

**A2 — Anclar la causa a la transición vía `orden_historial_estado`.**
Descartada, pero es la que más se acercó y por eso se documenta. `orden_historial_estado` tiene
`gestion_orden_id` (`db/schema.prisma:1663`) y, desde la feature 239, la transición a `devuelta`
la escribe `CierresAdminRepository.ts:1620-1631` con `origenTipo: "anclaje_devolucion"` y
`gestionOrdenId` = la gestión ancla. Es una fila INMUTABLE (`db/schema.prisma:1665`): anclarse a
ella daría idempotencia PERFECTA. El problema es que **el job no sabe a qué fila del historial
pertenece**: su payload identifica el evento por `(ordenId, estatusDestinoId, ocurridoAt)`, y
ese `ocurridoAt` lo pone el reloj de la APLICACIÓN (`webhook-estado-encolado.ts:121`) mientras
`historial.created_at` lo pone el reloj de la BASE (`@default(now())`). Casar los dos exige un
`created_at <= ocurridoAt` que depende de que no haya deriva entre dos relojes de máquinas
distintas (app en Vercel, base en Supabase): un desfase de milisegundos elegiría la fila
equivocada o ninguna, y el fallo sería silencioso y raro. Para cerrarla haría falta llevar el
`historialId` en el payload — que es A1 con otro nombre. Si algún día el humano quiere
idempotencia estricta del cuerpo, **este es el camino, y empieza por el payload**.

**A3 — Emitir también la etiqueta en español (`motivoLabel`).**
Descartada en la puerta (decisión (b), 2026-08-21). Duplicaría la fuente de verdad del texto
(hoy única, en `causa-devolucion-options.ts`, 73/R3) y convertiría un cambio de copy en un
cambio de contrato público. `estado` ya viaja crudo; la simetría vale más que la comodidad de un
consumidor.

**A4 — Campo anidado `data.devolucion: { motivo }`.**
Descartada en la puerta (decisión (a)). Sus tres vecinos son planos, y anidar obliga al
consumidor a comprobar dos niveles de `null` para leer un enum. Se reabre solo el día que haya
un SEGUNDO dato de devolución que publicar (evidencia, intento, geo) — y ese día será una ficha
con su propia decisión.

**A5 — Publicar el campo solo cuando el estado es `devuelta` (omitirlo en el resto).**
Descartada en la puerta (decisión (c)). Un objeto de forma variable rompe a los consumidores con
tipado estricto y obliga a ramificar por estado. Coste asumido: un `null` de más en la mayoría
de los eventos.

**A6 — Llamar al campo `causaDevolucion` (la recomendación del spec).**
Descartada por el humano el 2026-08-21, con la colisión de nombres planteada explícitamente
sobre la mesa y reafirmada la elección. El nombre público es `motivo`. La convivencia con
`gestion_orden.motivo` (texto libre, que NO se emite) queda documentada en §2.3 y blindada por
R22 y su test. **Cerrado: no se reabre.**

---

## 4. Idempotencia: qué se promete exactamente (R13-R15)

La 99/R23 promete que **reejecutar un job produce el mismo `eventoId` y el mismo cuerpo**
(`WebhookEstadoService.ts:82-84`, test vigente en
`tests/unit/services/webhook-estado-service.test.ts:146-154`). Con el cuerpo resuelto AL
ENTREGAR, esa promesa nunca fue «el cuerpo está congelado desde el encolado»: `numGuia` y
`estado` ya se leen en el momento de la entrega. Este diseño NO cambia la promesa; la hace
explícita:

> **El cuerpo es una función determinista de (payload del job, estado de la base en el instante
> de la entrega).** Mismo payload + mismo estado leído ⇒ cuerpo byte-idéntico y mismo
> `eventoId`. No hay reloj, aleatoriedad ni contador de intentos dentro de `data`.

**FIRMADO el 2026-08-21:** la causa emitida es la **vigente al entregar**, no una foto del
instante del evento. El payload del job queda intacto (99/R13) y no se añade `historialId`.

**La ventana, declarada.** Entre el encolado y la entrega (o entre dos reintentos) el resultado
de la lectura de la causa PUEDE cambiar en exactamente dos escenarios:

1. **La gestión se anula** (`deshacer_gestion`, 67/R11 → `anulada_at`): el reintento emitiría
   `null` donde el primer intento emitió una causa.
2. **Se registra una gestión `devuelta` posterior** sobre la misma orden con otra causa: el
   reintento emitiría la nueva.

Ambos son estados de la base que ya cambian el resto de la aplicación (el panel de novedades y
el cron de SLA leen con ESTE MISMO criterio, `OrdenRepository.ts:3260-3278` y
`DevolucionSlaRepository.ts:71-77`). Elegir «vigente al entregar» significa que **el webhook
dice lo mismo que las pantallas**; elegir un ancla congelada (A2) significaría que el webhook
dice algo que ya nadie más dice. Y en los dos escenarios el evento se entrega igualmente, sin
error, sin reintento extra y sin evento adicional (R15): la única diferencia observable es el
valor de UN campo entre dos intentos del mismo `eventoId`, y el consumidor ya deduplica por
`eventoId` por contrato.

Esto **se publica como parte del contrato** (R24), en afirmativo: «el `motivo` es el vigente en
el momento de la entrega». No es una disculpa por una limitación — es la semántica elegida, y la
que hace que el webhook y las pantallas nunca se contradigan.

**Lo que se afirma en un test** (obligatorio, T7/T8 de `tasks.md`):

- Reejecutar el job con el mismo estado leído produce cuerpos byte-idénticos, campo nuevo
  incluido (R13) — se AMPLÍA el test de idempotencia existente (`:146-154`), no se sustituye.
- El campo no depende del número de intento ni del reloj inyectado (R14): con `now` distinto en
  cada ejecución, `data` es idéntico.
- El escenario 1 (anulación entre intentos) se ejercita explícitamente con un reader que cambia
  su respuesta entre llamadas: el segundo cuerpo lleva `null`, el `eventoId` NO cambia y NO se
  lanza error (R15). El test documenta la ventana en vez de esconderla.

---

## 5. Guardias y tests que esta feature pone en rojo (minas conocidas)

### 5.1 Rojos ESPERADOS, que se arreglan en el mismo PR

1. **`tests/unit/services/webhook-estado-service.test.ts:94`** —
   `expect(body.data).toEqual({ numGuia, numRemision, estado })`. `toEqual` es exacto: en cuanto
   `data` gana una clave, **este test se pone rojo**. Es el congelador del cuerpo y su trabajo
   es exactamente ese. Se actualiza con la clave nueva (`motivo: null` en el caso base, que es
   `en_reparto`).
2. **`tests/unit/services/webhook-estado-service.test.ts:27-33`** — `DATOS_BASE` está tipado
   como `DatosEntregaOrden`. Al hacer el campo REQUERIDO (§2.1), este literal deja de
   typecheckear y arrastra a `:139`, `:177` y `:204` (que lo esparcen). Se añade
   `causaDevolucion: null` al literal base — ojo: **en el DTO interno el campo sigue llamándose
   `causaDevolucion`; `motivo` es solo el nombre de cable** (§2.3). **Es el rojo que queremos**: obliga a mirar cada
   fake.
3. No hay ningún test unitario de `WebhookOrdenReader` hoy (`git grep WebhookOrdenReader` solo
   lo encuentra en la interfaz, el repo, el service, la fábrica y el test de service). Esta
   feature crea el primero (T4).

### 5.2 Guardia que hay que dejar VERDE sin editarla — la trampa del OpenAPI

`tests/unit/api/openapi-contrato-en-reparto.test.ts` recorre TODO el objeto `openApiSpec`
buscando arrays `enum` que sean «catálogo de estados» (heurística de `:29-36`: contiene
`entregada` **y** `por_recoger`) y afirma que hay **EXACTAMENTE 4** (`:74`, `:96`, `:124`), y
que el `.yaml` tiene los 4 bloques idénticos y en el mismo orden (`:94-100`).

⚠️ **Si al documentar el webhook (R24) se enumera el catálogo de estados para el campo
`estado`, aparece un 5.º bloque y esa guardia se pone ROJA en tres asserts**, en un test que NO
es de esta feature. Por eso §2.4 fija que en la sección `webhooks:` el campo `estado` se
documenta como `type: string` con prosa (y, si se quiere precisión, remitiendo al schema
`OrdenDetalle`), **sin `enum` literal**. El `enum` de los tres valores de `motivo` es invisible
para la heurística (no contiene `entregada` ni `por_recoger`) y no la afecta. Esta restricción
está confirmada por el humano en la puerta del 2026-08-21 junto con la decisión (f).

`tests/unit/api/openapi-177-paths-pdf-y-carga-id.test.ts:71-97` congela la lista de `paths` (7,
en orden) tanto en el TS como en el `.yaml`. Una sección `webhooks:` de NIVEL SUPERIOR no la
toca — el parser del `.yaml` (`:53-64`) corta al primer bloque con indentación 0 —, siempre que
se declare FUERA de `paths:` y que el `.yaml` se actualice a la vez que el TS.

### 5.3 Guardias que NO se tocan y deben seguir verdes

- `tests/unit/types/webhook-eventos.test.ts` — congela la política de emisión por igualdad
  (R17). Esta feature no la edita; si aparece roja, es que alguien tocó lo que no debía.
- `tests/integration/repositories/orden-webhook-enqueue.test.ts` y
  `tests/unit/services/webhook-estado-encolado.test.ts` — payload y dedupeKey del job (R18).
- `tests/integration/db/schema-drift-saneamiento.test.ts` — no hay migración, no debe moverse
  (ojo con los EOL: este repo escribe en LF).

---

## 6. Verificación

- Gate normal: `./init.sh --rapido` (typecheck + lint + tests relacionados + todas las
  guardias). El diff **no** toca migraciones, `db/schema.prisma`, `lib/types/` (salvo un import
  de tipo existente), configuración de build ni archivos de dinero, así que el modo rápido
  aplica; si el implementador acaba tocando alguno de esos, el arnés lo mandará al completo y
  eso es correcto.
- Sin DB nueva que sembrar. El caso `null` del histórico previo a la 73 se ejercita con un fake
  del reader (unitario) y con una gestión sin `causa_devolucion` en el test de repositorio.
- **Nota (no es tarea de esta feature):** el aviso a integradores lo maneja el humano
  (decisión (g), 2026-08-21). El cambio es aditivo y no bloquea el despliegue.
