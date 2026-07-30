# Design — Feature 156 (Generar guía SIN asignar mensajero)

> Fullstack · **Sin migración** · Secuencia de implementación: **backend → frontend**
> (una sola entrega; el contrato de la Server Action cambia y las dos capas viajan juntas).

## 1. Decisión de fondo

Generar guía deja de ser una operación de tres efectos (numerar + asignar + rutear) y pasa a
ser una operación de un solo efecto:

```
en_preparacion  --[generacion_guia]-->  en_bodega_central   (+ num_guia si falta)
```

Todo lo demás que hoy hace `generarGuia` **no se traslada a ninguna parte nueva**: ya existe.
La asignación a mensajero central vive en `asignarDesdeBodega`, el envío a satélite en
`rutearABodegaSatelite`, y la asignación en satélite en `AsignacionSateliteService`. Esta
feature es, en su mayor parte, **retiro de código y de guardas que dejan de aplicar**.

## 2. Modelo de datos

**No cambia nada.** Sin migración, sin columnas nuevas, sin RLS nuevo.

- `order_status`: los `value` que esta feature usa (`en_preparacion`, `en_bodega_central`)
  ya existen; la 154 es quien tocó el catálogo.
- `orden.num_guia`: se sigue asignando con `siguiente_num_guia()` y la guarda idempotente
  `WHERE num_guia IS NULL` dentro de la transacción del lote (`OrdenRepository.generarGuiaLote`).
- `orden.mensajero_asignado_id` y `orden.asignado_at`: dejan de escribirse por esta vía. La
  columna y sus índices siguen igual (los escriben `asignarDesdeBodega` y
  `AsignacionSateliteService`).
- `orden_historial_estado`: se sigue escribiendo con `origen_tipo = generacion_guia` (enum
  existente), desde el mismo choke point (`appendCambioEstado`), que valida la arista contra
  `TRANSICIONES` (feature 140). Tras la 154 la única arista de `generacion_guia` viva es
  `en_preparacion → en_bodega_central`.
- `orden.mensajero_sugerido_id`: **permanece** (lo retira la 159). Esta feature solo deja de
  leerlo en el modal.

## 3. Backend

### 3.1 Contrato de entrada (cambio de forma)

`generarGuia` pasa del contrato "decisión por orden" al contrato "lote de ids", idéntico en
forma al de `rutearABodegaSatelite`:

```ts
// lib/interfaces/services/IGuiaAsignacionService.ts
export interface GenerarGuiaInput {
  ordenIds: string[];
}
// `GenerarGuiaDecision` se ELIMINA (no lo importa nadie más; verificado en el repo).

export interface GenerarGuiaResultadoItem {
  ordenId: string;
  numGuia: number;
  estado: string; // siempre "en_bodega_central"
}
```

```ts
// lib/types/orden-guia.ts
export const generarGuiaSchema = z.object({
  ordenIds: z.array(z.string().min(1)),
});
```

`GenerarGuiaServiceResult` / `GenerarGuiaResult` conservan sus cuatro variantes
(`ok` | `forbidden` | `validation_error` | `conflict` con `detalle` por orden) y
`unauthenticated` en el borde: la UI ya sabe traducirlas (`guia-decision-error-messages.ts`,
que **no se toca**).

El borde (`lib/actions/ordenes-guia.ts::generarGuia`) **no cambia de estructura**: sigue
resolviendo actor → zod → service. La fábrica `buildGuiaService()` tampoco cambia: el
servicio sigue necesitando `IZonaRepository` (guarda GAM de `asignarDesdeBodega` y del
ruteo) y `IAsignabilidadCoordenadasService` (gate de `asignarDesdeBodega`). **Ninguna
dependencia del constructor se retira** — retirarlas desactivaría gates de los otros dos
métodos.

### 3.2 Constantes de origen (`lib/services/GuiaAsignacionService.ts`)

| Constante | Antes | Después |
| --- | --- | --- |
| `ORIGEN_GENERAR_GUIA` | `Set{en_fulfillment, en_preparacion}` | `"en_preparacion"` (string) |
| `ORIGEN_RUTEO_SATELITE` (línea ~35) | `Set{en_fulfillment, en_preparacion, en_bodega_central}` | `"en_bodega_central"` (string) |
| `ORIGEN_BODEGA` | `"en_bodega_central"` | sin cambios |

Se deja `ORIGEN_RUTEO_SATELITE` y `ORIGEN_BODEGA` como **dos constantes distintas con el
mismo valor**: documentan dos acciones distintas y evitan que un cambio futuro en una
arrastre a la otra por accidente.

### 3.3 `generarGuia` después del cambio (forma final)

```
generarGuia({ ordenIds }, actor):
  1. autorización: !esAccesoTotal(actor.rol) -> forbidden            (R9)
  2. ordenIds = distinct(...); vacío -> ok con resultados: []
  3. repo.findByIdsForTransicion(ordenIds); por orden:               (R4/R7)
       no existe            -> "orden no existe"
       deletedAt != null    -> "orden borrada"
       estatus reprogramada -> MSG_ORDEN_REPROGRAMADA_BLOQUEADA
       estatus != en_preparacion -> "estado de origen no permitido: <value>"
     detalle no vacío -> conflict (aborta sin efectos)               (R6)
  4. estatusBodegaId = repo.findEstatusIdByValue("en_bodega_central")
     null -> validation_error { estatus: ["catalogo de estados incompleto (seed pendiente)"] }
  5. repo.generarGuiaLote(
        ordenIds.map(id => ({ ordenId: id, estatusId: estatusBodegaId,
                              mensajeroAsignadoId: null })),          (R2)
        { actorUsuarioId: actor.usuarioId, origenTipo: "generacion_guia" })  (R8)
  6. ok: [{ ordenId, numGuia, estado: "en_bodega_central" }]          (R1/R3/R5)
```

Se **retiran del cuerpo de `generarGuia`** (y solo de ahí):

- la resolución de `centralZonaId` y la guarda `GAM_NO_CONFIGURADA` (R13);
- `findMensajeroIdsValidosByZona` y la validación GAM/no-GAM del mensajero (R2);
- la guarda `findMensajerosBloqueados` (R10);
- la guarda `zonasSateliteBloqueadas` (R11);
- la llamada a `gateCoordenadas` (R12);
- la función local `estatusDestino` y la resolución de `por_recoger` /
  `en_ruta_bodega_satelite`.

Se **conservan como miembros privados** porque los usan los otros métodos:
`gateCoordenadas` (usado por `asignarDesdeBodega`), `zonasSateliteBloqueadas` (usado por
`rutearABodegaSatelite`), `GAM_NO_CONFIGURADA`, `MSG_MENSAJERO_BLOQUEADO`,
`MSG_BODEGA_SATELITE_BLOQUEADA`, `ESTATUS_EN_ESPERA_ACEPTACION`,
`ESTATUS_EN_RUTA_BODEGA_SATELITE`.

> **Guarda de no-regresión (R19):** tras el cambio quedan exactamente DOS escritores de
> `mensajero_asignado_id` y ambos deben conservar su `gateCoordenadas` /
> `asignabilidad.evaluar`. El reviewer debe verificarlo explícitamente: retirar el gate de
> `generarGuia` es correcto **porque esa vía ya no asigna a nadie**, no porque el gate
> sobre.

### 3.4 `rutearABodegaSatelite`

Único cambio: `if (!ORIGEN_RUTEO_SATELITE.has(...))` pasa a
`if (orden.estatusValue !== ORIGEN_RUTEO_SATELITE)`, con el mismo motivo
`estado de origen no permitido: <value>` (R15/R16). El resto (guarda GAM, solo no-GAM, zonas
bloqueadas, `num_guia` idempotente) queda intacto.

### 3.5 `asignarDesdeBodega` y `AsignacionSateliteService`

**Cero cambios de código.** Su cobertura se conserva tal cual y se usa como test de
no-regresión (R17/R18).

### 3.6 Repositorio

`OrdenRepository.generarGuiaLote` **no se toca**. Sigue recibiendo
`GenerarGuiaDecisionData { ordenId, estatusId, mensajeroAsignadoId }`; el servicio pasa
siempre `mensajeroAsignadoId: null`, lo que además desactiva de forma natural el estampado
de `asignado_at` (`...(d.mensajeroAsignadoId != null ? { asignadoAt: new Date() } : {})`).
Ver alternativa E (§6) y pregunta abierta 2 de `requirements.md`.

## 4. Frontend

### 4.1 `GenerarGuiaModal.tsx` — confirmación de lote

**Props después:**

```ts
export interface GenerarGuiaModalProps {
  open: boolean;
  ordenes: OrdenListItemDTO[];
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}
```

Se retiran `mensajeros` y `mensajerosBloqueadosIds` (R30), y con ellos: `Select`,
`toMensajeroOptions`, `seleccionInicial`, el estado `seleccion`, `handleRowChange`, `esGam`,
`groupByZona`, `SIN_MENSAJERO_LABEL`, `SATELITE_ZONA_DESCONOCIDA` y las columnas con
selector.

**Fase edición:** una sola `DataTable` con `numRemision` + `destinatario`
(`ariaLabel="Órdenes por numerar"`), sin agrupaciones (R20/R21). Descripción del modal:
*"Se numerarán N órdenes y pasarán a la bodega central. El mensajero se asigna después,
desde la bodega."*

**Confirmar (R22):**

```ts
const result = await generarGuia({ ordenIds: ordenes.map((o) => o.id) });
if (result.status !== "ok") throw result;               // (R26) el Modal invoca onError
toast.success(`Guía generada para ${result.resultados.length} orden(es): quedan en bodega central.`); // (R23)
setResultado({ ordenIds: result.resultados.map((r) => r.ordenId), mensaje });                          // (R24)
```

**Fase resultado (R24/R25/R27):** intacta. Se conservan `closeOnConfirm={false}`,
`hideConfirm`, `ManifiestoResultado flujo="generacion_guia"` y `handleOpenChange`, que es el
que difiere `onSuccess()` al cierre de la fase — de ahí cuelga el encadenado a etiquetas del
padre. **No se toca esa mecánica**: `tests/components/ManifiestoFlujos.test.tsx` y
`tests/components/OrdenesListadoEtiquetasChain.test.tsx` la fijan y deben seguir pasando con
el único ajuste de sus fixtures (ver §7).

El `prevOpen`/reset al reabrir se conserva, pero solo resetea `resultado` (ya no hay
`seleccion` que reiniciar).

### 4.2 `OrdenesListado.tsx`

1. `ESTADOS_ASIGNACION` pasa de `{en_fulfillment, en_preparacion, en_bodega_central}` a
   `{en_bodega_central}` (R28), y su comentario se reescribe: el único apartado que asigna
   por lote es la bodega central.
2. `<GenerarGuiaModal>` deja de recibir `mensajeros` (R30). El `useSWR` de mensajeros se
   conserva: lo necesita `AsignarBodegaModal`.
3. `accionesDe("en_preparacion")` sigue devolviendo `[{ key: "guia", label: "Generar guía" }]`.
   `en_fulfillment` se deja como está (lo resuelve la 155); no se le añade ni quita acción en
   esta feature más allá de lo que exige R28/R29.
4. `encadenarEtiquetas` / `cerrarModal` / `cerrarEtiquetas`: **sin cambios** (R27).

### 4.3 `OrdenesRevisionMaestro.tsx` (vista legacy, no montada por ninguna página)

Se ajusta al mínimo para que compile y no ofrezca caminos muertos:

- `<GenerarGuiaModal>` deja de recibir `mensajeros` / `mensajerosBloqueadosIds`.
- Los apartados `en_fulfillment` y `en_preparacion` pierden
  `secondaryActionLabel="Rutear a bodega satélite"` / `onSecondaryAction` (R29). El apartado
  `en_bodega_central` la conserva.

## 5. Contratos I/O resultantes

| Superficie | Entrada | Salida |
| --- | --- | --- |
| `generarGuia` (Server Action) | `{ ordenIds: string[] }` | `ok{resultados:[{ordenId,numGuia,estado:"en_bodega_central"}]}` \| `unauthenticated` \| `forbidden` \| `validation_error{fieldErrors}` \| `conflict{detalle:[{ordenId,motivo}]}` |
| `asignarDesdeBodega` | `{ ordenIds, mensajeroId }` | sin cambios |
| `rutearABodegaSatelite` | `{ ordenIds }` | sin cambios (solo cambia qué orígenes acepta) |
| `obtenerManifiesto` | `{ flujo:"generacion_guia", ordenIds }` | sin cambios |
| `generarEtiquetas` | `{ ordenIds }` | sin cambios |

## 6. Alternativas descartadas

**A. Conservar el contrato `decisiones: [{ordenId, mensajeroId}]` y rechazar (o ignorar)
`mensajeroId != null`.** — *Descartada.* Mantener un campo que el servidor debe rechazar
siempre es una trampa: obliga a escribir una guarda nueva (más código, no menos), deja un
contrato que miente sobre lo que la operación hace, y el día que alguien lo rellene desde
otro cliente el fallo aparece como `conflict` genérico en vez de como un error de tipos en
build. El cambio a `{ ordenIds }` es **más pequeño en producción** (borra tipos, borra zod,
borra el `map` del modal) y alinea la firma con las otras dos acciones por lote del mismo
servicio. Coste asumido: hay que actualizar los tests que arman `decisiones` (§7) y las dos
capas deben entregarse juntas.

**B. Dejar que `generarGuia` siga ruteando a satélite las órdenes no-GAM (atajo de un solo
clic para el maestro).** — *Descartada.* Es exactamente el camino que el flujo v2 cierra: la
154 ya retiró las aristas `en_preparacion|en_fulfillment → en_ruta_bodega_satelite`, así que
conservarlo produciría `TransicionIlegalError` en el choke point de historial, es decir un
error de sistema en vez de una regla de negocio. Además reintroduciría en el numerado la
guarda de "bodega satélite bloqueada" que R11 retira. El atajo sigue existiendo, pero desde
la bodega central (`rutearABodegaSatelite`), que es donde el paquete está físicamente.

**C. Conservar la guarda "zona GAM no configurada" en `generarGuia`.** — *Descartada.* Su
única razón de ser era clasificar GAM/no-GAM para decidir destino y validar el mensajero.
Sin clasificación, la guarda solo aportaría un modo de fallo que bloquea una operación que
no necesita el dato (numerar y mover a la bodega central es correcto para cualquier zona).
Se conserva íntegra en `asignarDesdeBodega` y `rutearABodegaSatelite`, que sí clasifican.

**D. Borrar la vista legacy `OrdenesRevisionMaestro` (y su test) en esta feature.** —
*Descartada.* Ninguna página la monta, así que borrarla es tentador, pero es una decisión de
producto/limpieza independiente y aumentaría el diff de una feature cuyo valor está en el
servicio. Se ajusta al mínimo (§4.3) y la decisión queda como pregunta abierta 3.

**E. Quitar `mensajeroAsignadoId` de `GenerarGuiaDecisionData` en el repositorio.** —
*Descartada en esta feature.* El parámetro queda muerto (siempre `null`), pero limpiarlo
toca la interfaz del repositorio, `OrdenRepository.generarGuiaLote`, su test dedicado
(`orden-repository.guia.test.ts`) y el estampado de `asignado_at`, sin ningún cambio de
comportamiento a cambio. Se documenta como muerto y se agrupa con el barrido de la 159
(pregunta abierta 2).

## 7. Impacto en la suite existente (mapa para el implementer)

| Archivo | Qué pasa |
| --- | --- |
| `tests/unit/services/guia-asignacion-service.test.ts` | Reescritura parcial: los bloques de `generarGuia` sobre mensajero (R21/R22/R24/R28 de la 17), clasificación GAM (R6/R8/R9/R11 de la 30), zona GAM (R4) y zonas satélite bloqueadas migran a casos NUEVOS que afirman lo contrario (R10-R13) o se retiran. Los bloques de `asignarDesdeBodega` y `rutearABodegaSatelite` se conservan; el de ruteo suma el caso "origen `en_preparacion` → conflict" (R16). |
| `tests/unit/services/guia-asignacion-gate-coordenadas.test.ts` | Los casos de gate sobre `generarGuia` se invierten (ahora pasa) o se retiran; los de `asignarDesdeBodega` se conservan como no-regresión (R19). |
| `tests/integration/actions/ordenes-guia-action.test.ts` | Ajuste del contrato de entrada de `generarGuia` (`ordenIds`), incluido el caso zod (R14). |
| `tests/components/GenerarGuiaModal.test.tsx` | Reescritura: sin selector, sin agrupaciones, una sola llamada con `ordenIds`, toast nuevo, mapeo de errores conservado. Los casos de coordenadas (`direccion_no_geocodificable`, etc.) se mueven al modal de asignación desde bodega o se retiran de este archivo. |
| `tests/components/ManifiestoFlujos.test.tsx` | Solo ajuste de fixtures/props del render de `GenerarGuiaModal` (deja de pasar `mensajeros`). **Las aserciones sobre el diferido de `onSuccess`, el manifiesto y el fallo de descarga NO se relajan.** |
| `tests/components/OrdenesListadoEtiquetasChain.test.tsx` | Ajuste de fixtures (órdenes en `en_preparacion` en vez de `en_fulfillment`); el flujo confirmar → "Cerrar" → etiquetas se mantiene idéntico (R27). |
| `tests/components/OrdenesListadoBloqueoCierre.test.tsx` | Los casos que bloquean el checkbox se reencuadran sobre `en_bodega_central`; se agrega el caso "orden en `en_preparacion` con zona en cierre → checkbox habilitado" (R28). |
| `tests/components/OrdenesRevisionMaestro.test.tsx` | Ajuste por props del modal y por la acción secundaria retirada (R29). |
| `tests/fixtures/inventario-transiciones-140.ts` | Lo actualiza la **154** (retiro de #1-#6, #7b/#7c). Esta feature no debería tocarlo; si al correr la suite aparece drift, es señal de que la 154 no está completa. |

## 8. Riesgo y rollback

- **Sin migración** ⇒ el rollback es revertir código. Las órdenes ya numeradas quedan en
  `en_bodega_central` con `num_guia`, que es un estado legal antes y después del cambio: no
  hay dato que reparar.
- **Riesgo real:** una entrega parcial (backend sin frontend) deja el modal enviando
  `decisiones` contra un zod que espera `ordenIds` ⇒ `validation_error` en cada intento. Por
  eso las dos capas van en la MISMA entrega y las tasks de frontend dependen de las de
  backend (ver `tasks.md`).
- **Riesgo de secuencia con la 155:** ver pregunta abierta 1 de `requirements.md`.

## 9. Trazabilidad propuesta (R → prueba)

| R | Prueba |
| --- | --- |
| R1, R3, R5, R6 | `tests/unit/services/guia-asignacion-service.test.ts` (nuevo bloque "generarGuia v2") |
| R2 | idem: aserción sobre el `mensajeroAsignadoId` recibido por `generarGuiaLote` (siempre `null`) |
| R4 | idem: origen `en_fulfillment` / `en_bodega_central` / `por_recoger` → `conflict` |
| R7, R9 | idem (guardas existentes, casos conservados) |
| R8 | `tests/unit/repositories/orden-historial-cobertura.test.ts` + unit del service (origenTipo) |
| R10, R11, R12, R13 | idem: casos que ahora terminan en `ok` |
| R14 | `tests/integration/actions/ordenes-guia-action.test.ts` |
| R15, R16 | `tests/unit/services/guia-asignacion-service.test.ts` (bloque ruteo satélite) |
| R17, R18, R19 | `guia-asignacion-service.test.ts` + `guia-asignacion-gate-coordenadas.test.ts` + tests de `AsignacionSateliteService` (sin cambios) |
| R20-R23, R26 | `tests/components/GenerarGuiaModal.test.tsx` |
| R24, R25 | `tests/components/ManifiestoFlujos.test.tsx` |
| R27 | `tests/components/OrdenesListadoEtiquetasChain.test.tsx` |
| R28 | `tests/components/OrdenesListadoBloqueoCierre.test.tsx` |
| R29, R30 | `tests/components/OrdenesRevisionMaestro.test.tsx` + `OrdenesListadoEtiquetasChain.test.tsx` |
