# Feature 405 — diseño técnico

> Lee primero `requirements.md`. Este documento decide el CÓMO.
> **Nada de esto se implementa hasta que Q1 esté confirmada y el humano apruebe el spec.**

## 1. Qué se toca y qué no

| Capa | Archivo | Cambio |
| --- | --- | --- |
| Tipos públicos | `lib/types/api-orden.ts` | **+** `ApiOrdenGestionDTO`; `ApiOrdenDetalleDTO` gana `gestiones` |
| Interfaz de repo | `lib/interfaces/repositories/IOrdenRepository.ts` | **+** `ApiOrdenGestionRow`; `ApiOrdenDetalleRow` gana `gestiones` |
| Repositorio | `lib/repositories/OrdenRepository.ts` | `API_ORDEN_DETALLE_SELECT` gana dos relaciones; `toApiOrdenDetalleRow` las mapea |
| Servicio | `lib/services/ApiOrdenLecturaService.ts` | `toDetalleDTO` copia `gestiones` fila → DTO |
| Contrato | `lib/api/openapi-spec.ts` + `docs/api/api-key-openapi.yaml` | **+** schema `OrdenGestion`, `OrdenDetalle` lo referencia |
| Aviso | `docs/api/CHANGELOG.md` | **+** entrada fechada |
| Controller | `app/api/ordenes/api-key/orden/[id]/route.ts` | **ninguno** |
| Base de datos | — | **ninguno**: sin migración, sin índice, sin escritura |

`gestion_orden` **no se modifica**. `middleware.ts` **no se toca** (`SELF_AUTH_ROUTES` ya cubre el
prefijo `/api/ordenes/api-key` y hay una guardia, 229, que compara esas listas contra una firmada).

**Verificado contra el árbol real (el índice del grafo devolvió de más):** el único endpoint de
detalle que existe hoy es `GET /api/ordenes/api-key/orden/{id}`. El grafo aún reporta
`app/api/ordenes/api-key/[numGuia]/route.ts` con `handleDetalleApi`; **ese archivo NO existe**, y el
propio `ApiOrdenLecturaService.ts:91-94` documenta su baja el 2026-08-31. No hay un segundo detalle
que ampliar ni un segundo mapeo que mantener en paralelo.

## 2. El contrato de salida

### 2.1 `gestiones[]`

```jsonc
{
  "numGuia": 100234,
  "numRemision": "REM-0001",
  "estado": "entregada",
  "…": "los nueve campos de la 106, intactos",
  "evidencias": [ /* … intacto … */ ],

  "gestiones": [
    {
      "createdAt": "2026-09-02T15:41:07.000Z",
      "resultado": "reprogramada",
      "estadoResultante": "reprogramada",
      "motivo": null,
      "mensajero": { "id": "…", "nombre": "Carlos Jiménez Mora" }
    },
    {
      "createdAt": "2026-09-04T18:02:55.000Z",
      "resultado": "devuelta",
      "estadoResultante": "devolucion_por_confirmar",
      "motivo": "wrong_address",
      "mensajero": { "id": "…", "nombre": "Ana Solís" }
    }
  ]
}
```

**Las cinco claves están SIEMPRE presentes** (R3), con `null` donde no aplica. Es la convención que
el canal ya firmó para `data.motivo` del webhook (256, pregunta (c) resuelta: «siempre presente,
`null` cuando no aplica; el consumidor no ramifica por estado para saber si la clave existe»). No se
introduce una segunda convención de ausencia.

### 2.2 Nombres: por qué `createdAt` y `resultado`, y no `fecha` y `tipo`

El integrador escribió `fecha` y `tipo`. **Se traducen a los nombres que el canal ya tiene para esos
mismos conceptos**, por la misma regla que obliga a reutilizar la forma de `mensajero` de la 404: un
concepto, un nombre.

- `createdAt` — es como se llama el instante de creación de un registro en `OrdenListItem`. Y `fecha`
  sería ambiguo con `gestion_orden.fecha_reprogramacion` (`@db.Date`), que es OTRA fecha. Este repo
  ya paga el precio de dos cosas llamadas `motivo`; no se compra la tercera.
- `resultado` — es como se llama ese mismo enum en el schema público `Evidencia`, que ya publica
  tres de sus cinco values (`entregada`, `rechazada`, `incidente`).
- `estadoResultante` — camelCase de lo que pidió; no colisiona con nada.
- `motivo` y `mensajero` — se conservan tal cual: son los nombres de cable que ya existen (el primero
  en el webhook, el segundo en la 404).

El CHANGELOG se lo dice con estas palabras, para que el mapeo no haya que deducirlo.

### 2.3 `motivo`: la política, y dónde vive

`motivo` transporta **la causa TIPIFICADA y nada más** (R8, R12). La política es la misma que la del
webhook, expresada por resultado de gestión en vez de por estado destino del evento:

| `resultado` | `motivo` |
| --- | --- |
| `devuelta` | `gestion_orden.causa_devolucion` (o `null` si la gestión es anterior a la 73) |
| `incidente` | `gestion_orden.causa_incidente` (o `null` si es anterior a la 158) |
| `entregada`, `reprogramada`, `rechazada` | `null` |

**No se reutiliza `WebhookEstadoService.motivoPublicado`** y no es un descuido: aquel método decide
por `estado` **destino del evento**, un dato que aquí no existe —una gestión no es un evento— y cuya
firma (`DatosEntregaOrden`) es la del webhook. Copiar su cuerpo tampoco: la decisión se toma **una
vez**, en un helper puro propio junto al mapeo (`causaTipificadaDeGestion`), tipado
`CausaDevolucion | CausaIncidente | null` con los tipos ya existentes
(`lib/types/causa-devolucion.ts`, `lib/types/causa-incidente.ts`). Lo que SÍ se ata es la **lista
publicada**: R21 exige un test que compare valor a valor el `enum` del detalle con el del webhook,
así que las dos no pueden divergir en silencio.

⛔ `gestion_orden.motivo` (el texto libre) **no entra en el `select` de Prisma**. No se proyecta, no
se mapea y no se filtra: la forma más barata de no filtrar un dato es no leerlo. La guardia de R12 lo
comprueba por lista blanca, no por buena voluntad.

### 2.4 `mensajero`: se reutiliza el tipo de la 404, no su forma

`specs/404-mensajero-en-webhook-y-api/` **no existía al escribir esto** (comprobado en disco el
2026-09-09). La dependencia se resuelve **estructuralmente**:

- La 404 exporta el DTO del mensajero público en `lib/types/api-orden.ts` (nombre asumido:
  `ApiMensajeroDTO`, forma `{ id: string; nombre: string }`, `nombre` vía `nombreCompletoUsuario`).
- La 405 **importa ese tipo** y lo usa como el tipo de `ApiOrdenGestionDTO["mensajero"]`. No declara
  un segundo objeto con las mismas claves.
- **Diferencia declarada:** en el listado/detalle de la 404 el mensajero puede ser `null` (la orden
  puede no tener asignado). En una **gestión** nunca lo es: `gestion_orden.mensajero_id` es NOT NULL
  (`db/schema.prisma:1034`). Aquí el tipo es `ApiMensajeroDTO`, sin `| null`. Es una restricción del
  mismo tipo, no un tipo nuevo.
- Si la 404 aterriza con otra forma, esto **deja de compilar** o la sigue sola. Es el mismo mecanismo
  que la 268 usó entre `ApiOrdenEvidenciaDTO` y `ApiOrdenEvidenciaRow` («si uno crece y el otro no,
  `toDetalleDTO` deja de compilar, que es la idea»).

**Orden de implementación:** la 404 primero. Si por lo que sea la 405 se implementara antes, la task
T2 crea el tipo en el mismo sitio y con el mismo nombre, y la 404 lo reutiliza — nunca al revés y
nunca dos.

## 3. Lectura de datos

### 3.1 La proyección: dos relaciones sobre el MISMO `findFirst`

`findDetalleByOrdenIdForOwner` ya hace **un** `prisma.orden.findFirst` con
`where: { id, tiendaId: ownerId, deletedAt: null }` y `select: API_ORDEN_DETALLE_SELECT`. Ese select
gana dos entradas, y **ninguna consulta nueva** (R19):

```ts
gestiones: {
  where: { anuladaAt: null },                       // R11
  select: {
    id: true,
    createdAt: true,
    resultado: true,
    causaDevolucion: true,
    causaIncidente: true,
    mensajero: { select: { id: true, nombre: true,
                           primerApellido: true, segundoApellido: true } },
  },
  orderBy: [{ createdAt: "asc" }, { id: "asc" }],   // R10
},
historialEstados: {
  where: { gestionOrdenId: { not: null } },
  select: { gestionOrdenId: true, createdAt: true, id: true,
            estatusDestino: { select: { value: true } } },
  orderBy: [{ createdAt: "asc" }, { id: "asc" }],
},
```

⚠️ **El `where` de la relación `gestiones` que ya existe NO se toca.** Hoy trae
`resultado in (entregada, rechazada, incidente) AND evidencia_storage_path IS NOT NULL` para
alimentar `evidencias[]`, y **no filtra `anuladaAt`** por una decisión explícita de la 268 (§b:
«"arreglar" lo de `anuladaAt` aquí sería un cambio de comportamiento fuera de alcance»). La relación
`gestiones` se pide **una segunda vez con otro alias en el mapeo**, no se fusiona con aquella: fundir
los dos `where` cambiaría `evidencias[]`, que es contrato vigente y funciona. En Prisma esto se
resuelve pidiendo el superconjunto una sola vez y derivando las dos listas en `toApiOrdenDetalleRow`;
la task T4 lo fija con un test de no-regresión sobre `evidencias[]` (R15).

### 3.2 🔴 `estadoResultante` NO se lee por `gestion_orden_id`, y esto es lo importante del diseño

La forma obvia sería `gestiones: { select: { historialEstados: … } }`. **Está descartada y no por
estilo:** `orden_historial_estado` **no tiene índice por `gestion_orden_id`** —y en Postgres una FK
no crea índice—. Sus tres índices son `[ordenId, createdAt]`, `[ordenId, estatusDestinoId]` y
`[actorUsuarioId, origenTipo, createdAt]`. El propio repositorio lo tiene medido y documentado
(`lib/repositories/OrdenHistorialRepository.ts:172-181`), y por eso `whereIntentosVigentes` **repite
el `ordenId` dentro del `EXISTS`**: «sin ese truco el `EXISTS` recorre entera una tabla append-only
que crece con CADA transición del sistema».

Por eso el historial se pide **como relación de `Orden`** (`Orden.historialEstados`), que Prisma
filtra por `orden_id` y entra por `@@index([ordenId, createdAt])`, con `gestion_orden_id` como filtro
residual sobre el puñado de filas de esa orden. El emparejamiento gestión↔transición se hace **en
memoria**, con un `Map<gestionId, string>` construido en una pasada:

1. recorrer el historial ya ordenado ascendente y quedarse con la **primera** entrada de cada
   `gestionOrdenId` → ese es el `estatusDestino.value` (R6);
2. por cada gestión, `map.get(g.id) ?? null` (R7).

Un `Map`, **no** un `find` dentro del bucle: son decenas de filas, pero el `find` en bucle es el
O(n²) escondido que este repo mide y persigue, y no hay ninguna razón para escribirlo.

**Consecuencia declarada:** el `null` de `estadoResultante` es real y esperable en gestiones LEGADAS
anteriores al historial de la feature 49 —el mismo caso limite que `whereIntentosVigentes` declara
(«una gestión legada … no tiene fila que la respalde y, por tanto, NO cuenta»)—. No es un fallo del
canal y el contrato lo dice.

### 3.3 Alcance multi-tenant: sin regla nueva

`gestion_orden` y `orden_historial_estado` **no tienen dueño propio**: cuelgan de `orden` por FK. El
scope sigue siendo el `tienda_id = ownerId AND deleted_at IS NULL` del `findFirst` (R13). Es el mismo
argumento, palabra por palabra, con el que la 268 metió `orden_incidente` en esta proyección: **no
hay una segunda regla de alcance que escribir**, y por eso no se pide una válvula nueva.

## 4. Contrato publicado (OpenAPI)

Schema nuevo `OrdenGestion`, referenciado desde `OrdenDetalle`, que pasa a exigir `gestiones`:

- `createdAt` — `string`, `format: date-time`.
- `resultado` — `string`, `enum` **derivado** del catálogo de resultados de gestión, jamás una lista
  copiada a mano (mismo patrón que `WEBHOOK_ESTADO_ENUM`, derivado de `EVENTOS_PUBLICOS`).
- `estadoResultante` — `["string","null"]`, **sin `enum`**. Ver requirements Q8: el enum `estado` que
  el contrato publica hoy está incompleto por deuda declarada desde la 109 y `estadoResultante` sí
  alcanza los values que faltan; publicar aquí una lista cerrada haría que dos listas del mismo
  contrato se contradijeran. La descripción dice que es un `value` del catálogo de estados y remite a
  `estado`.
- `motivo` — `["string","null"]`, `enum` derivado de `CAUSA_DEVOLUCION_SEED` + `CAUSA_INCIDENTE_SEED`
  + `null`. La descripción **repite la advertencia de los dos `motivo`** y la asimetría de idioma
  (inglés en devolución, español en incidente, sin traducir, 73/F1.4-g y 158/Q-B).
- `mensajero` — `$ref` al schema que publica la 404. Un solo schema para el concepto.

`docs/api/api-key-openapi.yaml` es **espejo textual manual** (no hay generador): se edita a mano y el
test de R20 comprueba que sigue siendo espejo, con el mismo molde que
`tests/unit/api/openapi-contrato-en-reparto.test.ts`.

## 5. Volumen: por qué NO hay límite ni paginación — MEDIDO

### 5.1 La medición (producción, 2026-09-10)

No es una inferencia del esquema: es un conteo sobre la base de **producción**, en solo lectura.

```sql
with g as (select orden_id, count(*) as n from gestion_orden group by orden_id)
select count(*) as ordenes_con_gestiones, max(n) as maximo, round(avg(n),2) as promedio,
       count(*) filter (where n > 10) as con_mas_de_10,
       count(*) filter (where n > 50) as con_mas_de_50
from g;
```

| Métrica | Valor |
| --- | --- |
| Órdenes con al menos una gestión | **1.163** |
| Máximo de gestiones en **una** orden | **5** |
| Promedio | **1,40** |
| Órdenes con más de 10 | **0** |
| Órdenes con más de 50 | **0** |

**Conclusión: no hay límite, no hay paginación, y esto queda decidido con un número, no con un
argumento.** El peor caso real son **5 elementos** (~750 bytes); el caso típico, 1. Un tope o una
paginación hoy serían código sin ningún caso que atender.

⚠️ **El número es real pero es una foto joven.** La base de producción se vació a propósito el
2026-08-25 por el arranque comercial, así que esas 1.163 órdenes son de las últimas semanas. Nadie
debe leer «máximo 5» como una garantía permanente: si el negocio cambia el patrón de reintentos, el
techo sube. Por eso la válvula de §5.3 **se queda escrita**.

### 5.2 Por qué el esquema ya acotaba el número (y por qué la medición encaja)

La estimación previa desde el esquema era **≈10**; la realidad es la mitad. Las razones estructurales
siguen siendo las que hacen que el número no pueda dispararse:

1. `gestion_orden` **no** tiene `@@unique(ordenId)` a propósito: una orden acumula gestiones por
   reintentos (36, comentario del modelo). No hay tope en la tabla.
2. Pero el despacho **se detiene**: `GuiaAsignacionService.asignarDesdeBodega`,
   `AsignacionSateliteService.asignar` y `ReprogramacionTiendaService.reprogramar` rechazan la orden
   cuando `intentos >= MIN_INTENTOS_ENTREGA` (`lib/config/reintentos.ts`, **default 3**), y
   `MisAsignacionesService.gestionar` / `GestionDesdeAyudaService.gestionar` rechazan en el tope los
   resultados no permitidos. Una orden no puede volver a la calle indefinidamente.
3. A esos ~3 ciclos contables se les suman, como mucho, las gestiones **sintéticas** de §Q7 (99, 100,
   237, 240, 276) — de las que a lo sumo aplican una o dos por orden. El máximo medido de 5 es
   exactamente eso.
4. Las **anuladas quedan fuera** por R11, que es justo la cola larga (una anulación permite
   re-registrar). El máximo de 5 es **sobre la tabla entera, sin filtrar anuladas**: lo que el
   contrato emite es igual o menor.

### 5.3 Truncar en silencio, y la válvula

**Truncar en silencio sería peor que no hacer nada:** el integrador contaría reintentos sobre un array
recortado y obtendría un número mal **sin ninguna señal**. Un array completo o un mecanismo explícito;
nada intermedio.

**Válvula declarada — contingencia, NO trabajo pendiente.** El día que una orden real supere **50**
gestiones vigentes, la salida es un **sub-recurso paginado** (`GET …/orden/{id}/gestiones` con
`limit`/`offset`/`total`, el molde de `Pagination` que el canal ya publica), **no** un recorte del
array. Sería otra ficha, y hoy no hay nada que hacer: cero órdenes por encima de 10.

## 6. Alternativas descartadas

### 6.1 ⛔ Sub-recurso paginado `GET /api/ordenes/api-key/orden/{id}/gestiones` (la más seria)

Un endpoint propio: paginación gratis, el detalle no engorda, y el volumen deja de ser una
preocupación para siempre.

**Descartada porque:** (a) el integrador pidió el array **en el detalle**, y esto le obliga a una
segunda llamada autenticada por cada orden que quiera medir —justo el coste que la fase 1 le quitaba—;
(b) es una URL nueva, un handler nuevo, un service nuevo y su propia batería de 401/403/404/422, o
sea el opuesto exacto del «arreglo mínimo y aditivo» que la ficha exige; (c) §5.1 **mide en
producción** que el problema que resolvería no existe: máximo 5 gestiones en una orden, cero por
encima de 10. Queda escrita como **la** salida si algún día el techo de §5 se rompe: no hay que
rediseñar, solo mover el mapeo.

### 6.2 ⛔ Leer `estadoResultante` navegando `gestion.historialEstados`

Es la escritura obvia y la más corta. **Descartada por medida ajena, no por gusto:** hace que el
`WHERE` entre por `gestion_orden_id`, que **no está indexado**, sobre una tabla append-only que crece
con cada transición del sistema (§3.2). El repositorio ya documenta este seq scan y la contorsión que
hizo para evitarlo. Añadir el índice tampoco es salida: exigiría migración, y esta ficha es de solo
lectura sobre una tabla que no se toca.

### 6.3 ⛔ Derivar `estadoResultante` mapeando `resultado` → estado

Una tabla `entregada→entregada`, `devuelta→devuelta`, … sin tocar el historial. Cero coste.
**Descartada porque es falsa:** una gestión `devuelta` deja hoy la orden en `devolucion_por_confirmar`
y solo el anclaje posterior al aprobar el cierre la lleva a `devuelta` (239/P8). El mapeo publicaría
un estado en el que la orden **nunca estuvo** en ese instante, y encima el error sería invisible.
El historial es el único que sabe dónde quedó la orden.

### 6.4 ⛔ Fundir `gestiones[]` con `evidencias[]` en un solo array

«Una gestión con sus fotos dentro» es más bonito. **Descartada porque rompe contrato vigente:**
`evidencias[]` mezcla a propósito las dos procedencias del incidente (gestión del mensajero y reporte
del admin) porque «el consumidor no distingue —ni debe— quién subió la foto» (268/R27), y los
incidentes del admin **no son gestiones ni tienen mensajero**. Además cambiaría la forma de un array
que integradores ya consumen. Los dos arrays son hermanos independientes.

### 6.5 ⛔ Emitir también el texto libre `gestion_orden.motivo` (aunque fuera en otra clave)

**Descartada de raíz.** Contradice **256/R22**, que es un requisito vigente, y es texto escrito a mano
por un empleado sobre un cliente. No hay versión «pero solo si el integrador lo pide» de esto.

### 6.6 ⛔ Excluir las gestiones sintéticas de §Q7

Dejaría `gestiones[]` como «solo visitas de calle», que es más limpio para medir por mensajero.
**Descartada porque escondería cambios de estado reales** —un rechazo decidido por la propia tienda
(240) o el escalado por plazo vencido (99) desaparecerían del historial que el integrador mira para
entender por qué su orden acabó como acabó—, y porque la lista de familias sintéticas es de
INCLUSIÓN y crece: una familia nueva empezaría a **desaparecer** sola del contrato. Se emiten todas y
se avisa (R22-b).

## 7. Riesgos y cómo se cierran

| Riesgo | Cierre |
| --- | --- |
| El integrador quería el texto libre | **Q1 bloqueante**: se confirma ANTES de escribir código |
| Se cuela el texto libre por un spread | Guardia de lista blanca R12 (molde `rastreo-dto-lista-blanca.guardia.test.ts`): conjunto EXACTO de claves + valores `FUGA-…` |
| La 404 aterriza con otra forma de `mensajero` | Tipo compartido (§2.4): deja de compilar |
| El `WHERE` de `anuladaAt` se rompe sin que nada se ponga rojo | R11 se prueba **contra Postgres real** (`tests/integration/db/`), no con dobles: en este repo una mutación del `WHERE` sobrevivió en verde cuatro veces |
| Se degrada `evidencias[]` al tocar la proyección | R15 con test de no-regresión sobre el DTO completo |
| Seq scan en `orden_historial_estado` | §3.2; R19 cuenta las consultas contra base real |
