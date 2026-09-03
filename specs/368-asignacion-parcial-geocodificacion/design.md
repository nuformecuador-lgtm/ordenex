# Feature 368 — Diseño

> Lee antes `requirements.md`. Este archivo decide **cómo**, y se aparta de él solo para explicar
> por qué una alternativa razonable se descartó.

## §0 — Fuentes leídas (código real, no el grafo a secas)

`lib/services/AsignabilidadCoordenadasService.ts` (entero),
`lib/interfaces/services/IAsignabilidadCoordenadasService.ts` (entero),
`lib/services/GuiaAsignacionService.ts` (entero, foco en `gateCoordenadas` y `asignarDesdeBodega`),
`lib/services/AsignacionSateliteService.ts` (entero),
`lib/interfaces/services/IGuiaAsignacionService.ts`,
`lib/interfaces/services/IAsignacionSateliteService.ts`,
`lib/repositories/OrdenRepository.ts` (`asignarBodegaLote`, `asignarSateliteLote`,
`findByIdsForTransicion`, `findParaAsignabilidad`),
`lib/types/orden-guia.ts`, `lib/types/recepcion-satelite.ts`,
`lib/actions/ordenes-guia.ts`, `lib/actions/recepcion-satelite.ts`,
`app/(app)/_components/geocodificacion-motivo-messages.ts`,
`app/(app)/ordenes/_components/guia-decision-error-messages.ts`,
`app/(app)/ordenes/_components/AsignarBodegaModal.tsx`,
`app/(app)/recepcion-satelite/_components/asignacion-satelite-error-messages.ts`,
`app/(app)/recepcion-satelite/_components/AsignarSateliteModal.tsx`,
`lib/types/orden.ts` (`OrdenListItemDTO`), `components/shared/ManifiestoResultado.tsx`,
`tests/unit/services/guia-asignacion-gate-coordenadas.test.ts`,
`tests/unit/services/asignacion-satelite-gate-coordenadas.test.ts`,
`tests/components/AsignarBodegaModal.test.tsx`, `tests/components/AsignarSateliteModal.test.tsx`,
`docs/specs.md`, `docs/architecture.md`, `docs/conventions.md`, `progress/current.md`.

## §1 — La forma del cambio, en una frase

**No hay migración, no hay tabla nueva, no hay endpoint nuevo.** Es un cambio de forma de respuesta
(`"ok" | "conflict"` → `"ok" | "partial" | "conflict"`, solo para los dos métodos que consultan el
gate de coordenadas) más el filtrado del lote que ya se manda al método de escritura existente, más
la superficie de UI que hoy lanza el `conflict` entero a un mensaje genérico y pasa a mostrar un
resultado parcial con detalle por orden.

| Ancla | Hoy | Después |
| --- | --- | --- |
| `GuiaAsignacionService.gateCoordenadas` | Devuelve `DetalleConflicto[]` de las NO asignables; el llamador aborta si `length > 0`. | Se conserva igual (no cambia su firma); el llamador (`asignarDesdeBodega`) deja de abortar y filtra. |
| `GuiaAsignacionService.asignarDesdeBodega` | `if (detalleCoords.length > 0) return conflict`. | Filtra `asignables`; si `asignables.length === 0` → `conflict` (igual que hoy); si no, escribe solo `asignables` y devuelve `ok` o `partial`. |
| `AsignacionSateliteService.asignar` (bloque 4b) | Igual patrón. | Igual cambio, más el ajuste del chequeo de carrera existente (§5). |
| `IGuiaAsignacionService.AsignarBodegaServiceResult` | `"ok" \| "forbidden" \| "validation_error" \| "conflict"`. | Gana `"partial"`. |
| `IAsignacionSateliteService.AsignarSateliteServiceResult` | `"ok" \| "forbidden" \| "sin_zona" \| "bodega_bloqueada" \| "validation_error" \| "conflict"`. | Gana `"partial"`. |
| `lib/types/orden-guia.ts` / `lib/types/recepcion-satelite.ts` | Espejo de los dos de arriba (los server actions hacen passthrough directo del resultado de dominio). | Mismo espejo, con `"partial"`. |
| `AsignarBodegaModal.tsx` / `AsignarSateliteModal.tsx` | `if (result.status !== "ok") throw result` — el `Modal` enruta todo lo no-`"ok"` al canal de error. | Rama nueva para `"partial"`: no lanza, pasa a la fase "resultado" con el detalle de bloqueadas. |

---

## §2 — El contrato de datos

### §2.1 — Por qué un estado nuevo (`"partial"`) y no reusar `"conflict"`

Decisión: **se añade `"partial"` como variante nueva**, y `"conflict"` conserva exactamente su forma
y su significado de hoy: cero efectos sobre datos.

```ts
// lib/interfaces/services/IGuiaAsignacionService.ts
export type AsignarBodegaServiceResult =
  | { status: "ok"; resultados: AsignarBodegaResultadoItem[] }
  | { status: "partial"; resultados: AsignarBodegaResultadoItem[]; bloqueadas: DetalleConflicto[] } // NUEVO (368)
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "conflict"; detalle: DetalleConflicto[] };
```

```ts
// lib/interfaces/services/IAsignacionSateliteService.ts
export type AsignarSateliteServiceResult =
  | { status: "ok"; resultados: { ordenId: string; estado: "por_recoger" }[] }
  | { status: "partial"; resultados: { ordenId: string; estado: "por_recoger" }[]; bloqueadas: { ordenId: string; motivo: string }[] } // NUEVO (368)
  | { status: "forbidden" }
  | { status: "sin_zona" }
  | { status: "bodega_bloqueada"; causa: BodegaBloqueadaCausa }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "conflict"; detalle: { ordenId: string; motivo: string }[] };
```

Mismo espejo en `lib/types/orden-guia.ts` (`AsignarBodegaResult`) y `lib/types/recepcion-satelite.ts`
(`AsignarSateliteResult`): los server actions (`asignarDesdeBodega`, `asignarDesdeSatelite`) hacen
`return service.asignarX(data, actor)` directo — sin traducción — así que el tipo de la action tiene
que llevar exactamente la misma unión que el tipo de dominio o el compilador lo rechaza. No hace
falta tocar la lógica de las actions: `withErrorHandler`/`isAppErrorShape` solo interceptan
`UnauthenticatedError`/`ZodError`, nunca los resultados de dominio (`forbidden`/`conflict`/`ok`/
`partial` los devuelve el service directamente).

**Por qué NO reusar `"conflict"` cargándolo con `resultados` + `detalle` (alternativa descartada,
A1):** `"conflict"` significa hoy, en TODO el árbol de guardas de los dos services (mensajero
bloqueado, tope de intentos, orden reprogramada, etc.) y en toda la UI que lo consume,
**"cero efectos sobre datos"**. Es una invariante que varios comentarios afirman explícitamente
("aborta el LOTE COMPLETO... Ninguna orden cambia de estado", feature 271; "TODO-O-NADA (R19)...
Ninguna orden cambia de estado", feature 276) y que los mappers de error (`guiaDecisionErrorMessage`,
`asignacionSateliteErrorMessage`) asumen sin comprobarlo: tratan cualquier `conflict` como un fallo
sin `onSuccess()`. Cargar `resultados` dentro de `conflict` obligaría a auditar y tocar cada uno de
esos consumidores para que dejen de asumir "cero efectos", multiplicando el riesgo de esta ficha muy
por encima de su alcance real (un problema medido en 2 de 958 órdenes). Un estado nuevo mantiene el
significado de `"conflict"` intacto para todo lo demás y hace que el compilador obligue a tratar el
caso nuevo en cada `switch`/`if` exhaustivo — el patrón que ya sigue este repo para todo cambio de
forma de respuesta (`bodega_bloqueada` de la 41, `sin_zona` de la 34).

### §2.2 — Por qué el identificador visible NO viaja en `DetalleConflicto`

`DetalleConflicto` (`{ ordenId, motivo }`) no gana un campo `numRemision`. Los dos modales ya reciben
`ordenes: OrdenListItemDTO[] / RecepcionSateliteDTO[]` como snapshot al abrirse (precisión 6 de
`requirements.md`), y ambos DTOs **ya traen `numRemision`**. El cliente arma
`Map<ordenId, numRemision>` con ese mismo snapshot — el que generó los `ordenIds` que se mandaron —
y lo cruza con `bloqueadas`. Evita tocar `IOrdenRepository.findByIdsForTransicion` /
`findParaAsignabilidad` (que no seleccionan `numRemision` hoy) y evita ensanchar `DetalleConflicto`
para los otros motivos que lo usan (orden no existe, zona ajena, etc.), que no lo necesitan.

---

## §3 — La lógica en los dos servicios

### §3.1 — `GuiaAsignacionService.asignarDesdeBodega`

Cambia solo el tramo final (después de la puerta del tope de intentos, feature 276, que no se
toca):

```ts
// ANTES
const detalleCoords = await this.gateCoordenadas(ordenIds);
if (detalleCoords.length > 0) return { status: "conflict", detalle: detalleCoords };
// ... resuelve estatusEsperaId, fechaReparto ...
await this.repo.asignarBodegaLote(ordenIds, input.mensajeroId, estatusEsperaId, historial, fechaReparto);
const resultados = ordenIds.map((ordenId) => ({ ordenId, estado: ESTATUS_EN_ESPERA_ACEPTACION }));
return { status: "ok", resultados };
```

```ts
// DESPUÉS
const detalleCoords = await this.gateCoordenadas(ordenIds);
const bloqueadasIds = new Set(detalleCoords.map((d) => d.ordenId));
const asignables = ordenIds.filter((id) => !bloqueadasIds.has(id));
if (asignables.length === 0) return { status: "conflict", detalle: detalleCoords }; // R3, sin cambios
// ... resuelve estatusEsperaId, fechaReparto (sin cambios) ...
await this.repo.asignarBodegaLote(asignables, input.mensajeroId, estatusEsperaId, historial, fechaReparto);
const resultados = asignables.map((ordenId) => ({ ordenId, estado: ESTATUS_EN_ESPERA_ACEPTACION }));
return detalleCoords.length > 0
  ? { status: "partial", resultados, bloqueadas: detalleCoords } // R1
  : { status: "ok", resultados }; // R4, sin cambios
```

`gateCoordenadas` (el método privado) **no cambia**: sigue devolviendo el `detalle` de las NO
asignables, en el mismo orden que `ordenIds`. El filtro `asignables` preserva ese mismo orden porque
recorre `ordenIds` una vez. `asignarBodegaLote` no cambia de firma: recibe un array de ids más corto,
y su `WHERE id IN (...)` + su `$transaction` únicos siguen siendo la fuente de atomicidad (§4).

### §3.2 — `AsignacionSateliteService.asignar`

Mismo cambio en el bloque `4b`, más el ajuste al chequeo de carrera existente del paso 6-7 (§5):

```ts
// DESPUÉS (bloque 4b)
const filas = await this.repo.findParaAsignabilidad(ordenIds);
const estados = await this.asignabilidad.evaluar(filas);
const detalleCoords: { ordenId: string; motivo: string }[] = [];
for (const id of ordenIds) {
  const estado = estados.get(id);
  if (esAsignable(estado)) continue;
  detalleCoords.push({ ordenId: id, motivo: estado === undefined ? "no_encontrada" : motivoAsignabilidad(estado) });
}
const bloqueadasIds = new Set(detalleCoords.map((d) => d.ordenId));
const asignables = ordenIds.filter((id) => !bloqueadasIds.has(id));
if (asignables.length === 0) return { status: "conflict", detalle: detalleCoords }; // R3, sin cambios

// paso 5 (catálogo) sin cambios

// paso 6: ESCRIBE SOLO `asignables`, no `ordenIds`
const count = await this.repo.asignarSateliteLote(
  asignables, input.mensajeroId, zonaId, destinoId, origenId, historial, fechaReparto,
);

// paso 7 (chequeo de carrera): compara contra `asignables.length`, no `ordenIds.length` — §5
if (count !== asignables.length) {
  const actuales = await this.repo.findByIdsForTransicion(asignables);
  // ... mismo bucle que hoy, sobre `asignables` ...
  return { status: "conflict", detalle: [...detalleCarrera, ...detalleCoords] }; // R17
}

const resultados = asignables.map((ordenId) => ({ ordenId, estado: ESTADO_ASIGNADA as "por_recoger" }));
return detalleCoords.length > 0
  ? { status: "partial", resultados, bloqueadas: detalleCoords } // R2
  : { status: "ok", resultados }; // R4, sin cambios
```

---

## §4 — Por qué NO hace falta ningún mecanismo transaccional nuevo

Alternativa que se consideró y se descartó: escribir cada orden asignable en su propia transacción
(o en un `Promise.allSettled` de escrituras individuales) para poder reportar éxito/fallo por orden
con precisión total.

**Descartada.** No hace falta: `asignarBodegaLote` y `asignarSateliteLote` ya son
`WHERE id IN (subconjunto)` dentro de una única `$transaction` cada una (precisión 7 de
`requirements.md`). Pasarles el subconjunto `asignables` en vez del lote completo escribe
exactamente ese subconjunto, atómicamente: si la transacción falla (error de DB), NINGUNA orden del
subconjunto cambia — el mismo comportamiento de "todo o nada" que ya tenían para el lote completo,
ahora aplicado al subconjunto asignable. Introducir transacciones por-orden:

1. multiplicaría los round-trips a la base por el tamaño del lote (hoy es una sola escritura
   `IN (...)`, con su único `appendCambioEstado` dentro de la misma transacción);
2. no resuelve ningún problema real: el gate de coordenadas ya decidió, ANTES de escribir, cuáles
   entran al lote de escritura y cuáles no — no hay ninguna razón de negocio para que una orden
   asignable falle su escritura individual y otra no, salvo un fallo de DB que hoy también tumbaría
   el `updateMany`/`UPDATE ... IN (...)` completo;
3. contradice el patrón ya establecido en este mismo repositorio para escrituras por lote
   (`asignarRecoleccionLote`, `desasignarRecoleccionLote`, `rutearBodegaSateliteLote`): todas son
   `IN (...)` de una sola pasada.

---

## §5 — El caso de carrera en la bodega satélite (R17), y por qué no se endurece aquí

`asignarSateliteLote` ya tenía, antes de esta ficha, un chequeo `count !== ordenIds.length` para
detectar que alguna orden cambió de estado o de zona entre la lectura (`findByIdsForTransicion`) y
la escritura guardada (`UPDATE ... WHERE estatus_id = origen AND zona_id = zona ...`). El comentario
del service dice "reporta conflict SIN efectos parciales" — pero como `asignarSateliteLote` corre
dentro de su propia `$transaction` que **confirma al retornar**, las órdenes que sí ganaron la
guarda **ya quedaron escritas** en el instante en que el service compara los counts. Es una
imprecisión preexistente (feature 34/241/271), no introducida por esta ficha, y **no se toca aquí**:
tocar el mecanismo de detección de carrera está fuera del problema medido (2/958 órdenes, un motivo
de coordenadas) y se arriesgaría a romper la guarda anti-TOCTOU que blindó el incidente del 18/08
(feature 271, §7.2 de su design).

Lo único que esta ficha ajusta es **contra qué compara** ese chequeo: antes comparaba contra
`ordenIds.length` (el lote completo pedido), y ahora debe comparar contra `asignables.length` (el
subconjunto que de verdad se intentó escribir, tras filtrar por coordenadas) — si comparara contra
`ordenIds.length` con órdenes ya bloqueadas por coordenadas en el lote, el chequeo de carrera
dispararía SIEMPRE que hay bloqueadas, incluso sin ninguna carrera real.

Cuando el chequeo detecta una carrera (caso compuesto, extremadamente raro: requiere que la MISMA
llamada tenga a la vez órdenes bloqueadas por coordenadas Y una carrera de concurrencia sobre las
que sí pasaron el gate), el `detalle` que se devuelve **combina** las que perdieron la carrera con
las que ya venían bloqueadas por coordenadas (R17): así el operador no pierde la información de
motivo de coordenadas por el hecho de que, además, algo más cambió a mitad de camino. El desenlace
sigue siendo `"conflict"`, nunca `"partial"` ni `"ok"`, para no reportar más éxito del que
realmente hay garantizado en ese camino raro.

---

## §6 — La UI: los dos modales y el mapper por-motivo

### §6.1 — Un mapeo motivo→mensaje POR ORDEN, nuevo y pequeño

`geocodificacion-motivo-messages.ts` gana una función exportada nueva, junto a
`geocodificacionMotivoMessage` (que sigue existiendo tal cual, para el caso de fallo total):

```ts
/** R11 (368): el mensaje de UN motivo de coordenadas, sin agregar. `null` si no es un motivo
 *  reconocido del gate (defensivo; no debería ocurrir con los literales de `EstadoAsignabilidad`). */
export function mensajeDireccionPorMotivo(motivo: string): string | null {
  return MOTIVO_A_MENSAJE.get(motivo) ?? null;
}
```

Reusa el `MOTIVO_A_MENSAJE` que ya existe en el módulo (hoy privado); no duplica el vocabulario.

### §6.2 — Los dos modales: rama nueva para `"partial"`, sin tocar el resto

`AsignarBodegaModal.tsx` y `AsignarSateliteModal.tsx` siguen el mismo patrón de fase
"resultado" que ya usan (feature 148, §9.7). Cambia `handleConfirm`:

```ts
// ANTES
const result = await asignarDesdeBodega({ ordenIds, mensajeroId, dia });
if (result.status !== "ok") throw result;
const mensaje = `Mensajero asignado a ${result.resultados.length} orden(es).`;
toast.success(mensaje);
setResultado({ ordenIds: result.resultados.map((r) => r.ordenId), mensaje, confirmacionDia });
```

```ts
// DESPUÉS
const result = await asignarDesdeBodega({ ordenIds, mensajeroId, dia });
if (result.status !== "ok" && result.status !== "partial") throw result; // solo "partial" se suma a "ok"

const numRemisionPorId = new Map(ordenes.map((o) => [o.id, o.numRemision])); // R10: ya en el snapshot
const bloqueadas =
  result.status === "partial"
    ? result.bloqueadas.map((b) => ({
        numRemision: numRemisionPorId.get(b.ordenId) ?? b.ordenId, // fallback defensivo
        mensaje: mensajeDireccionPorMotivo(b.motivo) ?? "No se pudo asignar.",
      }))
    : [];

const mensaje =
  result.status === "partial"
    ? `Mensajero asignado a ${result.resultados.length} de ${result.resultados.length + bloqueadas.length} orden(es). ${bloqueadas.length} bloqueada(s).`
    : `Mensajero asignado a ${result.resultados.length} orden(es).`;
toast.success(mensaje);
setResultado({ ordenIds: result.resultados.map((r) => r.ordenId), mensaje, confirmacionDia, bloqueadas });
```

El bloque JSX de la fase "resultado" gana, cuando `resultado.bloqueadas.length > 0`, una lista
adicional (mismo estilo que el bloque `role="alert"` de "sinOrdenes" ya existente en
`AsignarBodegaModal`) con una entrada por orden bloqueada: `{numRemision} — {mensaje}`.
`ManifiestoResultado` **no cambia**: sigue recibiendo `seleccion={{ ordenIds: resultado.ordenIds }}`,
que ya es solo el subconjunto asignado (R13) porque `resultado.ordenIds` sale de
`result.resultados`, no de `ordenIds` completo.

### §6.3 — Literales propuestos (Q1 de `requirements.md` — contrato de test, a confirmar)

Lenguaje claro, sin siglas, sin dirección ni ids (R14):

**Toast (éxito parcial):**
> «Mensajero asignado a 3 de 4 orden(es). 1 bloqueada.»

**Bloque de detalle, en el panel de resultado, `role="alert"` (una entrada por orden bloqueada):**
> «NA-138 — Dirección no encontrada»

*(motivo transitorio, ejemplo):*
> «NA-140 — La dirección aún se está validando. Vuelve a intentarlo en unos minutos.»

Mismo texto y misma estructura en `AsignarBodegaModal.tsx` y `AsignarSateliteModal.tsx` (R5).

---

## §7 — Alcance: por qué SOLO el motivo de coordenadas (alternativa descartada, A2)

**Alternativa considerada:** generalizar el comportamiento parcial a TODOS los motivos por-orden de
`DetalleConflicto` en los dos métodos — incluyendo "orden no existe", "orden borrada", "orden
reprogramada", "estado de origen no permitido" y "zona ajena / zona no-GAM" — ya que en el código
son, técnicamente, verificaciones por-orden dentro de un `for` que hoy también abortan el lote
entero con el primer `detalle.length > 0`.

**Descartada**, por tres razones verificadas en el código (no supuestas):

1. **No es lo que se midió ni lo que se pidió.** El origen de esta ficha es un motivo específico
   (coordenadas), con una tasa medida de 2/958 órdenes en 14 días. Generalizar sin evidencia de que
   los otros motivos tengan el mismo patrón de "unas sí, otras no en el mismo lote por una razón
   ajena a la selección del operador" es exactamente lo que `MEMORY.md` de este repo marca como
   antipatrón repetido: "arreglar lo evidenciado, no rediseñar".
2. **Los otros motivos por-orden de estado/pertenencia no son un dato intrínseco de la orden, como
   sí lo es la geocodificación de su dirección — son una señal de que la SELECCIÓN completa del
   operador está obsoleta.** Si una orden "no existe" o está "borrada" o cambió de "estado de
   origen" entre que se pintó la tabla y se confirmó la acción, lo más probable es que la pantalla
   entera esté desactualizada (alguien más la movió, o la pestaña lleva rato abierta) — el mensaje
   genérico ya existente ("Actualiza la lista y vuelve a intentarlo") es la respuesta correcta y
   accionable, y partir el lote en ese caso no ayuda al operador tanto como decirle que refresque.
   La geocodificación, en cambio, es una propiedad de LA DIRECCIÓN de esa orden en particular, sin
   ninguna relación con el resto del lote — es la asimetría real detrás de por qué el gate de
   coordenadas siempre ha sido ya-por-orden (feature 92) mientras las demás guardas nunca lo fueron.
3. **El costo de generalizar es mucho mayor que el de esta ficha, y toca superficies fuera de su
   alcance decidido.** `zona no-GAM` / `zona ajena` y `estado de origen no permitido` son
   compartidos por CUATRO métodos entre los dos services (`generarGuia`, `asignarDesdeBodega`,
   `asignarRecoleccion`, `rutearABodegaSatelite`), cada uno con su propia semántica de qué significa
   "parcial" para ESE flujo (por ejemplo, `generarGuia` no asigna mensajero — ¿qué sentido tiene un
   "parcial" ahí?). Generalizar exigiría re-derivar esa decisión método por método, sin evidencia de
   que la resuelva el mismo criterio, y ensancharía el blast radius muy por encima de lo que esta
   ficha necesita resolver.

**Sí se deja documentado, sin implementarlo:** si en el futuro se mide el mismo patrón (varias
órdenes de un lote bloqueadas por un motivo ajeno a las demás, con una tasa que justifique el
trabajo) para "zona ajena" o el tope de intentos, el mecanismo de este diseño (filtrar antes de
escribir, un estado `"partial"` nuevo) se reutiliza sin cambios de forma — solo hace falta decidir,
con evidencia, cuáles de esos motivos entran.

---

## §8 — Comentarios que se reescriben (R19)

| Archivo | Qué dice hoy | Qué debe decir |
| --- | --- | --- |
| `GuiaAsignacionService.ts`, docstring de `gateCoordenadas` (`:159-172`) | «TODO-O-NADA POR LOTE: es el contrato ya vigente de estos services... no se cambia aqui.» | Debe nombrar la ficha 368 y decir que el motivo de coordenadas pasa a asignación parcial; el resto de motivos de `DetalleConflicto` en este método sigue todo-o-nada. |
| `GuiaAsignacionService.ts`, comentario sobre el gate en `asignarDesdeBodega` (`:462-471`) | Describe el gate como el último paso antes de un `if (detalleCoords.length > 0) return conflict`. | Debe describir el filtrado y los tres desenlaces (`ok`/`partial`/`conflict`). |
| `AsignacionSateliteService.ts`, bloque `4b` (`:253-268`) | «Este writer SI asigna mensajero a todo el lote... Todo-o-nada, con el mismo detalle por orden que las demas guardas.» | Mismo ajuste que arriba, más la nota del §5 sobre el chequeo de carrera. |
| `AsignacionSateliteService.ts`, paso 7 (`:300-321`) | «R14: si alguna orden cambio de estado/zona... reporta conflict SIN efectos parciales.» | Debe aclarar que compara contra `asignables.length`, no `ordenIds.length`, y citar la imprecisión preexistente del §5 (no se corrige aquí). |

---

## §9 — Riesgos

| # | Riesgo | Mitigación |
| --- | --- | --- |
| 1 | Confundir "conflict" con efectos parciales en algún consumidor que no se auditó. | `"conflict"` no cambia de forma (R16); el compilador obliga a tratar `"partial"` en cada `switch`/`if` exhaustivo sobre el tipo de unión — cualquier consumidor que no lo maneje falla en build, no en runtime. |
| 2 | Ensanchar el alcance a otros motivos "porque ya que estamos" durante la implementación. | §7 documenta la decisión y su razón; R6-R8 lo fijan como requisito testeable. |
| 3 | El caso de carrera de la bodega satélite (§5) se malinterpreta como "hay que arreglarlo también". | R17 lo acota explícitamente a "tratarlo como el fallo total ya vigente", sin pedir un mecanismo nuevo. |
| 4 | Literales de UI (§6.3) no confirmados por el humano antes de escribir tests que los fijen. | Q1 en `requirements.md`; no bloquea el resto de tasks.md, que puede avanzar con el contenido obligatorio (R10-R14) antes de fijar el texto exacto. |
