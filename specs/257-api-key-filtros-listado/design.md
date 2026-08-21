# Feature 257 — Diseño técnico

Contrato: `GET /api/ordenes/api-key` (canal integrador por API key, features 106/177).
Cubre `requirements.md` R1–R26.

## 0. Estado del árbol verificado (2026-08-21, rama de trabajo desde `dev`)

Confirmado leyendo el código, no re-investigado más allá de eso:

- `app/api/ordenes/api-key/route.ts:41` — `listadoQuerySchema` = `limit` (1..100, default 50),
  `offset` (>=0, default 0), `estado` (`z.enum(ORDER_STATUS_SEED)` opcional) y nada más.
  El armado de `raw` (líneas 60–64) lee **clave por clave a propósito** (106/R8).
- `lib/services/ApiOrdenLecturaService.ts:55` — `listar` resuelve `estado` → `estatusId` con
  `findEstatusIdByValue` y devuelve página vacía si el value no está en el catálogo; pasa
  `ownerId: actor.usuarioId` al repo.
- `lib/repositories/OrdenRepository.ts:1624` — `listByOwner` construye el `where` con
  `tiendaId: ownerId` + `deletedAt: null` (+ `estatusId` opcional), ordena por
  `createdAt: "desc"` y hace `findMany` + `count` con **el mismo objeto `where`**.
- `db/schema.prisma:486-487` — `numGuia Int? @unique @map("num_guia")`,
  `numRemision String @unique @map("num_remision")`. Ambos **UNIQUE GLOBALES**.
- `lib/utils/fecha-cr.ts:118,129` — `inicioDelDiaCREnUtc` (`${fecha}T06:00:00.000Z`) y
  `inicioDelDiaSiguienteCREnUtc` (+24 h). El propio archivo (líneas 27–29 y 110–116) advierte
  que `startOfDayCR` NO sirve contra columnas `timestamp`.
- `lib/analytics/ranges.ts:40-59` — bloque `(c) LA TRAMPA startOfDayCR`, VIVA.
- `lib/api/openapi-spec.ts:200-222` — bloque `parameters` del listado con `limit`/`offset`/
  `estado`; `docs/api/api-key-openapi.yaml` es su espejo textual.
- Índices de `orden`: `@@index([tiendaId])` y `@@index([createdAt])` **separados**.

**No se encontró evidencia en contra de ninguna de las decisiones recomendadas por el leader**
(nombres, formato `YYYY-MM-DD`, filtrar por `created_at`, `num_remision` exacto, `desde > hasta`
→ 422). Se adoptan tal cual. La única desviación es que este spec **no propone tope de ancho de
rango** y lo deja como pregunta abierta (§7).

## 1. Nombres y forma de los parámetros

| Parámetro | Tipo público | Obligatorio | Semántica |
| --- | --- | --- | --- |
| `desde` | `string` `YYYY-MM-DD` | no | fecha calendario CR, cota inferior inclusiva |
| `hasta` | `string` `YYYY-MM-DD` | no | fecha calendario CR, cota superior **inclusiva** |
| `num_guia` | entero > 0 | no | igualdad exacta |
| `num_remision` | string no vacío | no | igualdad exacta |

`desde`/`hasta` en español, como `estado`, y sin prefijo `fecha_` porque en esta query no hay otra
dimensión temporal con la que confundirse. `num_guia`/`num_remision` en `snake_case`, igual que el
contrato público de la carga (`num_remision`, `monto_cobrar`).

## 2. Borde HTTP (`app/api/ordenes/api-key/route.ts`)

### 2.1 Lectura de la query — se MANTIENE clave por clave (R2, 106/R8)

Se añaden cinco líneas del mismo patrón (`if (sp.has("desde")) raw.desde = sp.get("desde") ?? ""`,
etc.). No se sustituye por `Object.fromEntries(sp)`: ese cambio convertiría cualquier clave futura
en entrada del schema y es justo lo que 106/R8 impide.

### 2.2 Schema zod

`listadoQuerySchema` gana cuatro campos opcionales:

- `desde` / `hasta`: `z.string()` con validación de fecha calendario REAL, no solo de forma. Se
  reutiliza `esFechaCalendarioValida` de `lib/utils/fecha-cr.ts` vía `.refine(...)`, que ya hace el
  round-trip que caza `2026-02-31` (V8 la rueda al 3 de marzo en silencio). Esto cubre R10 y R11
  sin escribir un regex nuevo.
- `num_guia`: `z.coerce.number().int().positive()`. `Int` en Postgres, entero positivo en el
  borde (R13/R14). `z.coerce` es coherente con `limit`/`offset`, que ya lo usan.
- `num_remision`: `z.string().trim().min(1)` (R16/R17). Sin `max`: la columna no tiene longitud
  declarada y poner un tope inventado rechazaría remisiones legítimas de un integrador.

La comprobación cruzada `desde <= hasta` va como `.superRefine` a nivel de objeto, emitiendo el
issue en `path: ["hasta"]` para que salga en `fieldErrors.hasta` (R12). Comparación de cadenas
`YYYY-MM-DD` (lexicográfica == cronológica), sin construir `Date`.

El fallo sigue traduciéndose con `z.flattenError(parsed.error).fieldErrors` →
`ValidationError(MSG.VALIDATION_ERROR, { fieldErrors })` → `422`, como ya hace la ruta. La
autenticación sigue ANTES del parseo, así que 401/403 ganan a 422 (R3), y no hay que cambiar nada
para eso.

### 2.3 Respuestas

Sin formas nuevas. `200` con el mismo `ApiOrdenListadoDTO`, `422` con la shape global de error.
No se introduce ningún `404` en el listado (R19/R21/R22).

## 3. Service (`ApiOrdenLecturaService.listar` + `ApiOrdenListarParams`)

`ApiOrdenListarParams` (`lib/interfaces/services/IApiOrdenLecturaService.ts`) gana:

```
desde?: string;        // YYYY-MM-DD ya validada en el borde
hasta?: string;        // YYYY-MM-DD ya validada en el borde
numGuia?: number;
numRemision?: string;
```

Los nombres del **contrato interno** van en `camelCase` (convención del repo); el `snake_case`
vive solo en la query pública, y la traducción ocurre en el borde, en el mismo `service.listar({...})`
que ya mapea `parsed.data`.

El service es quien **convierte fecha calendario → instante UTC**, porque es la decisión de
negocio ("el día operativo es el día natural de Costa Rica") y el repo debe quedarse hablando de
instantes:

```
createdAtDesde = desde ? inicioDelDiaCREnUtc(desde) : undefined
createdAtHasta = hasta ? inicioDelDiaSiguienteCREnUtc(hasta) : undefined   // EXCLUSIVA
```

⚠️ **`startOfDayCR` NO se importa en esta feature.** `orden.created_at` es `timestamp`, no
`@db.Date`; usarla desplazaría la ventana seis horas y produciría el rango 18:00–18:00 hora CR
(ver `lib/analytics/ranges.ts` bloque `(c)` y el aviso en `fecha-cr.ts:27`). Los helpers de la
convención 144 dejan ambos bordes en `...T06:00:00.000Z` (R7).

El corto-circuito actual (estado válido pero ausente del catálogo → página vacía) se conserva tal
cual y se evalúa antes de llamar al repo.

## 4. Repositorio (`OrdenRepository.listByOwner`)

Firma ampliada con campos opcionales `createdAtDesde?: Date`, `createdAtHasta?: Date`,
`numGuia?: number`, `numRemision?: string`. El `where` pasa a:

```
tiendaId: params.ownerId,            // FORZADO, no negociable (106/R6/R7)
deletedAt: null,                     // R23
...(estatusId ? { estatusId } : {}),
...(numGuia !== undefined ? { numGuia } : {}),
...(numRemision !== undefined ? { numRemision } : {}),
...(createdAtDesde || createdAtHasta
      ? { createdAt: { ...(createdAtDesde ? { gte: createdAtDesde } : {}),
                       ...(createdAtHasta ? { lt: createdAtHasta } : {}) } }
      : {}),
```

Claves del diseño:

- **`gte` / `lt`** (nunca `lte` en la cota superior): ventana semiabierta, `hasta` inclusivo
  (R6/R8).
- **`tiendaId: ownerId` y `deletedAt: null` se escriben PRIMERO y de forma INCONDICIONAL**, nunca
  detrás de un spread condicional. No es estilo: en un object literal de JavaScript, **si un spread
  posterior repitiera la clave `tiendaId`, la ganaría** —el último valor escrito manda— y el
  listado devolvería órdenes de otra tienda sin que nada fallara ruidosamente. Por eso el owner va
  arriba y los filtros van después: un filtro futuro mal escrito puede como mucho añadir una
  condición, jamás pisar el scope (R20).
- **El repo nunca recibe un `WhereInput` parcial desde afuera**: los filtros llegan como escalares
  tipados (`Date`, `number`, `string`), no como fragmentos de `where`. Si algún día se aceptara un
  fragmento, un integrador podría inyectar `tiendaId` y esta defensa caería. Regla para cualquier
  filtro que se añada después de esta feature.
- `numGuia` es igualdad estricta sobre una columna nullable: Prisma traduce a `num_guia = $1`, que
  en SQL **no casa con NULL**; por eso R15 sale gratis y se testea en vez de codificarse aparte.
- `findMany` y `count` siguen compartiendo **el mismo objeto `where`** (R25) y el `orderBy` no se
  toca (R24).

### 4.1 Por qué la filtración de existencia ajena queda cerrada (R21/R22)

`num_guia` y `num_remision` son UNIQUE **globales**. Filtrar por el número de otra tienda genera
`tienda_id = <owner> AND num_guia = <ajeno>`, que devuelve cero filas y `total = 0`: la respuesta
es **byte a byte idéntica** a la de un número inexistente. No hay rama de código que distinga los
dos casos, precisamente porque el filtro nunca se resuelve como "buscar y luego comprobar dueño".
El anti-patrón prohibido es hacer `findUnique(num_guia)` y comparar `tiendaId` después: aunque el
resultado final fuera el mismo, dejaría un camino de código donde la fila ajena existe en memoria
y una diferencia de latencia observable.

## 5. Documentación pública (R26)

`lib/api/openapi-spec.ts`, bloque `parameters` de `"/api/ordenes/api-key" → get` (líneas
200–222): se añaden cuatro entradas con `example` cada una:

- `desde`: `{ type: "string", format: "date", example: "2026-08-01" }`
- `hasta`: `{ type: "string", format: "date", example: "2026-08-21" }` — descripción explícita:
  *inclusivo; el día se mide en hora de Costa Rica (UTC-6)*.
- `num_guia`: `{ type: "integer", minimum: 1, example: 100234 }`
- `num_remision`: `{ type: "string", minLength: 1, example: "REM-0001" }`

Y la `description` del endpoint gana una línea: los filtros solo acotan; un número de guía o
remisión de otro dueño devuelve página vacía, no 404. `docs/api/api-key-openapi.yaml` se actualiza
como espejo textual en el mismo commit. La colección Postman
(`docs/api/ordenex-api-key.postman_collection.json`) queda como está: es de ejemplos, no de
contrato, y añadir cuatro query params opcionales no la invalida.

## 6. Migraciones y RLS

**Ninguna.** No hay tabla nueva, columna nueva ni cambio de RLS. Ver §7 para el índice.

## 7. Rendimiento e índices

`orden` tiene `@@index([tiendaId])` y `@@index([createdAt])` por separado. Para el volumen actual:

- `num_guia` / `num_remision` resuelven por el índice **UNIQUE** de cada columna: una fila, coste
  constante, el `tienda_id` es un filtro residual. Ideal.
- El rango de fechas dentro de un owner usa `orden_tienda_id_idx` y filtra `created_at` en el
  heap. Con el tamaño actual de una tienda es aceptable.

**Decisión: NO se añade el índice compuesto `(tienda_id, created_at)` en esta feature.** Es
aditivo y puede llegar después con una medición que lo justifique; añadirlo ahora obligaría a una
migración con `down.sql`, arrastraría el gate COMPLETO `./init.sh` y encarecería cada `INSERT` de
`orden` sin una sola cifra que respalde la ganancia. Si el humano lo pide en la puerta, entra como
task aparte, marcada como bloqueante del gate completo.

**Tope de ancho de rango: NINGUNO — DECISIÓN FIRMADA en la puerta (2026-08-21, humano).**
Razonamiento: la respuesta ya está acotada a 100 items por `limit`; lo que un rango ancho encarece
es el `count`, y un tope de N días no lo evita (un integrador pediría N días repetidos, con el
mismo coste total y más llamadas). Se deja escrito aquí para que la ausencia de tope **no se
reabra dentro de tres meses como si fuera un olvido**: fue evaluada, propuesta y aprobada. Para
revertirla hace falta una medición que muestre el `count` como cuello de botella real.

## 8. Alternativas descartadas

### 8.1 Aceptar fechas ISO-8601 completas (`2026-08-01T00:00:00-06:00`) — DESCARTADA

Parecía más "estándar" y más expresiva (permitiría rangos por hora). Se descarta porque traslada
la responsabilidad del huso horario al integrador: un cliente que mande `...T00:00:00Z` creyendo
que es medianoche local recibiría un día desplazado seis horas y el bug sería **suyo, invisible y
nuestro de reputación**. `YYYY-MM-DD` es un tipo sin ambigüedad ("día calendario de CR"), el
servidor es la única autoridad sobre el huso, y es lo mismo que ya usa el filtro del panel
(feature 144). Precio aceptado: no hay rangos sub-diarios; si algún día hacen falta, entran como
parámetros nuevos sin romper estos.

### 8.2 Usar `startOfDayCR` para las cotas — DESCARTADA (la trampa)

Es la función con el nombre más "obvio" del repo y la equivocada aquí. Devuelve la medianoche
**UTC** de la fecha calendario CR, correcta para columnas `@db.Date` (feature 46,
`fecha_reprogramacion`), pero contra un `timestamp` como `created_at` produce la ventana
18:00–18:00 hora CR. Es el off-by-one que cerró la ficha 166. Se usan
`inicioDelDiaCREnUtc`/`inicioDelDiaSiguienteCREnUtc` y se testea con reloj fijo que los bordes
caen en `T06:00:00.000Z`.

### 8.3 Cota superior con `lte inicioDelDiaCREnUtc(hasta)` — DESCARTADA

Haría que `desde=hasta` devolviera solo las órdenes creadas exactamente a las 00:00:00.000 CR,
es decir, casi siempre nada. El error clásico ya está documentado en `fecha-cr.ts:122-128`.

### 8.4 Redirigir `num_guia` al endpoint de detalle (301/302 o proxy interno) — DESCARTADA

Tentador por evitar "dos caminos al mismo dato". Se descarta porque son contratos distintos: el
detalle devuelve **evidencias con URLs firmadas** y `404` cuando no encuentra; el listado devuelve
una **página** y nunca 404. Fundirlos rompería a los clientes de 106/177 y forzaría a un
integrador que combina `num_guia` con `estado` a hacer dos llamadas. Ambos coexisten.

### 8.5 Devolver `404` cuando la guía existe pero es de otra tienda — DESCARTADA

Sería "más informativo" y es exactamente el oráculo de existencia ajena que R21/R22 prohíben: con
404-vs-vacío un tercero enumera qué números de guía están emitidos en la plataforma. La respuesta
es siempre página vacía.

### 8.6 Presets tipo `created_preset=ultimos_7_dias` (feature 144) — DESCARTADA aquí

`inicioDeUltimosNDiasCREnUtc` ya existe y sería barato. Se descarta porque un preset depende del
reloj del servidor: dos llamadas idénticas del integrador devuelven conjuntos distintos y su
paginación se vuelve inestable a medianoche CR. Para una API de terceros, fechas explícitas.
Nada impide añadirlo después como azúcar del cliente.

### 8.7 Búsqueda por prefijo/`contains` en `num_remision` — DESCARTADA

Sería útil para una UI, pero `num_remision` es un identificador único, no un campo de búsqueda; un
`contains` sin índice adecuado escanearía la tabla y además haría que `total` dependiera del
formato de remisión de cada tienda. Igualdad exacta. La búsqueda de texto del panel es otra
superficie y no se toca.

## 9. Archivos que se tocan

| Archivo | Cambio |
| --- | --- |
| `app/api/ordenes/api-key/route.ts` | schema zod + lectura clave por clave + paso al service |
| `lib/interfaces/services/IApiOrdenLecturaService.ts` | `ApiOrdenListarParams` + 4 campos |
| `lib/services/ApiOrdenLecturaService.ts` | fecha calendario → instantes UTC; passthrough |
| `lib/interfaces/repositories/IOrdenRepository.ts` | firma de `listByOwner` |
| `lib/repositories/OrdenRepository.ts` | `where` de `listByOwner` |
| `lib/api/openapi-spec.ts` | 4 parámetros + descripción |
| `docs/api/api-key-openapi.yaml` | espejo textual |

Sin tocar: endpoints de detalle, webhook, `db/schema.prisma`, migraciones.
