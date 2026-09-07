# Ficha 377 — Design

## 0. Contexto técnico confirmado en el árbol real (leído, no consultado al grafo)

El índice del MCP `codebase-memory` miente por exceso —el 2026-08-28 dio por vivos símbolos borrados
el 2026-08-07—, así que todo lo de abajo se verificó abriendo el archivo. Las líneas son de
`origin/dev` en `988c1345`.

- **`lib/repositories/ZonaRepository.ts:196-345`** — `update(id, data, actorUsuarioId)`. El `WHERE` de
  elegibilidad de la 366 está en **291-305**; sus cuatro condiciones son `distritoId in`,
  `zonaId: { not: zonaResueltaId }`, `deletedAt: null`, `cierreDetalles: { none: {} }` y
  `gestiones: { none: { anuladaAt: null, resultado: { in: [...] } } }`. **Ninguna mira el estado.**
  Todo corre dentro del `$transaction` que ya existía (202).
- **`lib/repositories/OrdenRepository.ts:1156-1162`** — `condicionesSatelite`: el acotamiento del
  listado de la bodega es `o."zona_id" = ${filtro.zonaId}` ∧ `deleted_at IS NULL` ∧
  `condicionPasoPorBodegaSatelite()` ∧ la lista blanca de estados. La zona es la mitad que decide
  QUÉ bodega, y `estados-bodega-satelite.ts:55-57` dice literalmente que **no se toca**.
- **`lib/services/AsignacionSateliteService.ts:206` y `:343`** — `orden.zonaId !== zonaId` ⇒ motivo
  `zona_ajena`, en la validación previa y otra vez en la detección de carrera.
- **`lib/types/order-status-transiciones.ts:170-181`** — las TRES únicas salidas de
  `en_bodega_satelite`. Y en **158-160**, para `en_ruta_bodega_satelite`, el propio repo escribe: «el
  paquete sigue bajo custodia de la central, por eso el destino es la central». Esa frase es la
  autoridad de la distinción que esta ficha formaliza; no hace falta inventar vocabulario.
- **`lib/services/DeshacerAsignacionService.ts:154-172`** — autoriza por `orden.zonaId !== zonaActor`
  (línea 170) pero deriva el destino desde `orden_historial_estado` (línea 214, «jamás desde la
  zona»). Las dos mitades ya discrepan sobre qué es la zona: una la usa como permiso, la otra la
  rechaza como fuente.
- **`lib/repositories/OrdenRepository.ts:3695-3736`** — `recibirEnSatelite` guarda su `updateMany` por
  `{ id, zonaId, deletedAt: null, estatus: { value: "en_ruta_bodega_satelite" } }`. Es la razón por la
  que reconciliar EN TRÁNSITO es correcto: sin eso, la bodega correcta no puede recibir el paquete.
- **`db/schema.prisma:712`** — `orden.estatus` es una relación a `OrderStatus` (`@@map("order_status")`,
  con `value @unique`). **`db/schema.prisma:782` — `orden` ya tiene `@@index([estatusId])`.** No hace
  falta ningún índice nuevo.
- **`lib/utils/estados-bodega-satelite.ts`** — módulo PURO (sin Prisma, sin React) que declara la
  premisa del área y dos listas: `ESTADOS_CUSTODIA_SATELITE` (la EVIDENCIA de haber pasado por una
  satélite) y `ESTADOS_BODEGA_SATELITE` (el CONTRATO de la pantalla). `ESTADOS_BODEGA_SATELITE` se
  recalcula desde `TRANSICIONES` en `tests/unit/utils/estados-bodega-satelite.test.ts` **en las dos
  direcciones**: cualquier arista nueva mueve ese test.
- **`lib/types/correccion-datos-cliente.ts:92-95`** — `ESTADOS_SIN_CORRECCION` son solo
  `entregada`, `devuelta_a_tienda`, `incidente` y `rechazada`. `en_bodega_satelite` NO está: la
  corrección manual es la segunda puerta al mismo agujero (Q3 de `requirements.md`).
- **`tests/integration/db/zona-reconciliacion-ordenes.test.ts:143-164`** — `crearOrden` escribe
  siempre `estatusId: FKS.estatusId`, y `FKS` sale de `fksDeOrden` (`_postgres-real.ts:285-296`), que
  es un `findFirst` sobre `orden` sin `orderBy`: **un estado arbitrario y no determinista, el mismo
  para las 17 órdenes semilla**. El eje del estado nunca se varía. Ese es el hueco por el que este
  defecto entró en `dev` con la suite en verde.

## 1. La distinción, y por qué es la única decisión de fondo

`orden.zona_id` hace **dos trabajos a la vez** y esta ficha es la factura de esa ambigüedad:

1. **A qué zona geográfica pertenece la dirección** (de ahí sale la tarifa). Este trabajo lo corrige
   la reconciliación de la 366 y hay que dejarlo intacto.
2. **Qué bodega tiene el paquete** (de ahí sale el permiso: listado, asignación, deshacer, recepción).
   Este trabajo NO puede cambiar por un guardado de configuración: el paquete no se teletransporta.

Los dos trabajos coinciden mientras nadie mueva el mapa. Cuando alguien lo mueve, el estado de la
orden dice cuál de los dos manda:

- **`en_ruta_bodega_satelite`** — el paquete lo tiene la central, que aún decide adónde lo manda. El
  trabajo (1) manda, y reconciliar **desbloquea** la recepción. Es el caso medido de la 366 (41 de 42
  órdenes represadas el 2026-09-03) y se conserva sin tocar.
- **`en_bodega_satelite`** — el paquete está en el estante de una bodega concreta, que lo recibió con
  su propia transición y su propia fila de historial. El trabajo (2) manda, y reconciliar le quita el
  permiso a quien lo tiene sin dárselo a nadie que pueda usarlo.

**No se introduce ninguna entidad nueva ni ninguna columna de «bodega»**: la distinción se expresa con
el estado, que es un dato que ya existe y que ya es la fuente del permiso en el resto del área.

## 2. Las tres salidas, con su coste, y la recomendación

### (a) Excluir `en_bodega_satelite` del corte de elegibilidad — **RECOMENDADA**

**Qué cuesta.** Una condición más en el `WHERE` de `ZonaRepository.update` y su constante en el módulo
que ya declara la premisa. Sin migración, sin tabla, sin transición nueva, sin pantalla nueva, sin
tocar la autorización de nadie. El grueso del trabajo es de tests: variar el eje del estado en
`tests/integration/db/zona-reconciliacion-ordenes.test.ts`, que hoy no lo varía.

**Qué deja pendiente.** La orden en el estante conserva la zona vieja, y con ella su tarifa. Cuando se
entregue, su `cierre_detail` congelará la zona vieja.

**Por qué esa deuda es la correcta, y no un mal menor a regañadientes.** El paquete pasó de verdad por
la bodega de la zona vieja y lo despachará un mensajero de la zona vieja: la tarifa que se congela
describe lo que ocurrió. Y la deuda no es una clase nueva: es exactamente la «deriva residual no
resuelta» que la 366 ya declaró y aceptó en su `design.md` §8, ampliada en un estado más. Además se
**cierra sola**: en cuanto la orden se gestiona, adquiere una gestión vigente `entregada`/`rechazada`
y deja de ser elegible para siempre; nunca se queda en un limbo de re-evaluación indefinida.

**Qué NO resuelve.** Si el negocio quiere que el paquete se mueva de verdad a la bodega nueva, (a) no
lo mueve. Esa es la Q1 de `requirements.md`, y es de negocio.

### (b) Permitir la reconciliación y añadir una transición de traspaso entre bodegas

**Qué cuesta.** Mucho más de lo que parece, y el coste no es de código:

1. **Una arista nueva** desde `en_bodega_satelite` (hacia `en_ruta_bodega_central` o hacia
   `en_ruta_bodega_satelite`) en `TRANSICIONES`, con familia propia en el enum
   `OrdenHistorialOrigenTipo`. Eso mueve el cierre del grafo que calcula
   `alcanceDerivadoDelGrafo()` y, con él, `ESTADOS_BODEGA_SATELITE` y su test bidireccional. Si la
   arista apunta a `en_ruta_bodega_central`, ese estado está PODADO como nodo en
   `ESTADOS_FUERA_DEL_LISTADO_SATELITE`, así que el cierre no se ensancha; si apunta a
   `en_ruta_bodega_satelite`, tampoco (también está podado). Es abordable, pero es un cambio en la
   pieza que este repo declara como contrato de pantalla, con su migración de enum asociada.
2. **La autorización no se puede escribir.** Quien tiene que ejecutar el traspaso es la bodega que
   PERDIÓ la orden, y en ese instante `orden.zonaId` ya apunta a la otra. Todo el área satélite
   autoriza con `orden.zonaId === usuario.zonaId` (`AsignacionSateliteService:206`,
   `EnvioDevolucionCentralService:60`, `DeshacerAsignacionService:170`). Habría que autorizar por
   **custodia leída del historial** —el patrón que ya existe en `condicionPasoPorBodegaSatelite()` y
   que `DeshacerAsignacionService:214` usa para el destino—, es decir, sustituir la frontera entre
   inquilinos del área. `estados-bodega-satelite.ts:55-57` la declara explícitamente intocable.
3. **Y el paquete sigue teniendo que viajar.** El traspaso es una operación física con coste de
   transporte. Eso no lo decide un spec.

**Por qué se descarta como respuesta a ESTA ficha.** Es un rediseño, y el encargo del repo es arreglar
lo evidenciado. Además no es urgente: la deriva medida hoy es **0** y el volumen expuesto (47 órdenes
en estante) es pequeño y rotativo. Si la Q1 se responde «el paquete sí tiene que moverse», (b) es la
ficha siguiente y (a) sigue siendo su precondición correcta (mientras no exista el traspaso, no se
puede orfanar a nadie).

### (c) Avisar o bloquear al guardar la zona, listando las órdenes en estante afectadas

**Qué cuesta.** En su versión **bloqueante**: una consulta previa al guardado, un modal con la lista de
órdenes y una confirmación. El formulario ya tiene el molde (`CrearZonaForm.tsx:293`, el modal de
conflicto de zona central). Pero bloquear no arregla nada: si el humano confirma, la orden se queda
huérfana igual, y ahora con su firma encima. Convierte un fallo mudo en un fallo consentido.

En su versión **informativa** —contar cuántas se quedaron atrás y decirlo en el mismo toast del
guardado— cuesta una consulta `count` y un argumento más en el mensaje, y NO consiente nada porque no
hay nada que consentir: con (a) aplicada, esas órdenes no se mueven.

**Recomendación: (a) como el arreglo, más la mitad INFORMATIVA de (c).** La mitad bloqueante se
descarta por lo dicho arriba. La informativa es lo que impide que este arreglo se convierta en otro
fallo mudo —«el sistema no falla, aparenta» es la familia de defectos más cara de este repo—: sin ella,
un maestro mueve un distrito, ve «Zona actualizada (12 órdenes reubicadas)» y no se entera de que otras
39 se quedaron donde estaban, ni de por qué. Va como R8-R10, y como **Q2** en `requirements.md`, porque
la 366 cerró su propia `Q2` diciendo que no quería un segundo conteo en esa respuesta.

## 3. El corte, en concreto

### 3.1 Dónde vive la constante

Un `export const` nuevo en **`lib/utils/estados-bodega-satelite.ts`**, que es el módulo que declara la
premisa «la bodega satélite ES la zona» y por tanto el único sitio donde esta regla no queda huérfana:

```ts
/**
 * FICHA 377 — LOS ESTADOS EN LOS QUE EL PAQUETE ESTA FISICAMENTE EN EL ESTANTE DE UNA SATELITE.
 *
 * OJO, NO CONFUNDIR CON `ESTADOS_CUSTODIA_SATELITE`, dos declaraciones arriba: aquella es la
 * EVIDENCIA de haber PASADO por una satelite (se lee del historial, es para siempre) y ESTA es
 * la custodia FISICA ACTUAL (se lee del estado de la orden, y se acaba en cuanto el paquete sale).
 *
 * `en_ruta_bodega_satelite` NO esta aqui, y esa ausencia es la ficha entera: en transito el paquete
 * lo tiene la CENTRAL —lo dice `order-status-transiciones.ts:158-160` por su cuenta— y por eso
 * reconciliar su zona es correcto y DESBLOQUEA la recepcion (366/design §8).
 */
export const ESTADOS_PAQUETE_EN_ESTANTE = [
  "en_bodega_satelite",
] as const satisfies readonly OrderStatusValue[];
```

Añadir esta constante **no mueve** `tests/unit/utils/estados-bodega-satelite.test.ts`: ese test compara
`ESTADOS_BODEGA_SATELITE` contra `alcanceDerivadoDelGrafo()`, y ni la función ni la tupla se tocan.

**Alternativa descartada — el literal `"en_bodega_satelite"` inline en `ZonaRepository`.** Lo consumen
dos sitios (la exclusión y el conteo de R8) y su justificación es de dominio, no de repositorio: un
literal en el `WHERE` deja la razón sin domicilio y hace que el día que aparezca un segundo estado de
estante nadie sepa dónde añadirlo.

### 3.2 Cómo se expresa en el `WHERE`

En `ZonaRepository.update`, el `where` de elegibilidad gana **una** condición:

```ts
estatus: { value: { notIn: [...ESTADOS_PAQUETE_EN_ESTANTE] } },
```

**Por qué por `value` y no por `estatusId` resuelto antes.** El repo declara su regla en
`order-status-transiciones.ts:6-7`: «Se indexa por `value` del catalogo, NUNCA por los ids internos».
Resolver el id primero obligaría además a una rama de `config_error` si la fila del catálogo falta
—decisión de negocio en un método que hoy no la tiene— y `orden` ya tiene `@@index([estatusId])`, así
que el join a `order_status` sobre un candidato ya acotado por `distrito_id` es irrelevante en coste.

**Por qué en el `WHERE` y no en un `filter` de JavaScript sobre el resultado.** Es la lección más
repetida de este repo: los tests de servicio usan dobles y no ven el SQL, y una mutación de un `WHERE`
pasó en verde cuatro veces medidas. El corte tiene que vivir donde se pueda matar con una mutación y
que el test lo note contra Postgres real (T5).

### 3.3 Cómo se cuenta lo retenido (R8/R9) sin escribir dos veces el mismo `WHERE`

El `where` base —distritos del grupo, zona distinta de la resuelta, no borrada, sin cierre, sin gestión
vigente que decida dinero— se construye **una sola vez** en una función local del archivo, y las dos
consultas le añaden cláusulas de estado **complementarias**:

```ts
function whereBaseElegible(distritoIds: string[], zonaResueltaId: string): Prisma.OrdenWhereInput {
  return {
    distritoId: { in: distritoIds },
    zonaId: { not: zonaResueltaId },
    deletedAt: null,
    cierreDetalles: { none: {} },
    gestiones: { none: { anuladaAt: null, resultado: { in: RESULTADOS_QUE_DECIDEN_DINERO } } },
  };
}
```

- **las que se mueven** — `findMany({ where: { ...base, estatus: { value: { notIn: ESTANTE } } }, select: { id, numGuia, numRemision } })`
- **las que se quedan** — `count({ where: { ...base, estatus: { value: { in: ESTANTE } } } })`

Las dos leen la MISMA declaración: si un día cambia el corte de la 366, cambia para las dos a la vez y
el conteo no puede quedarse contando otra cosa. Es la regla de `OrdenRepository`/184-R16 aplicada aquí
(«si el `WHERE` de la página y el del conjunto se despegaran, la pantalla y el archivo mostrarían filas
distintas para el mismo filtro y no fallaría nada»).

**Alternativa descartada — una sola consulta que traiga también el estado y particione en JS.** Ahorra
un round-trip por grupo y elimina por construcción el riesgo de que las dos cláusulas divergan. Se
descarta porque saca de SQL el corte que decide quién se mueve: la exclusión pasaría a ser un `if`
sobre filas ya traídas, que es exactamente la forma de corte que este repo ya midió que sobrevive a
las mutaciones. El coste que se paga —un `count` extra por zona resuelta, en un camino `maestro`-only
de baja frecuencia— es despreciable frente a esa garantía.

## 4. Modelo de datos

**Sin tablas nuevas. Sin columnas nuevas. Sin migración. Sin cambios de RLS. Sin índices nuevos.**

- `orden` ya tiene `@@index([estatusId])` (`schema.prisma:782`) y `@@index([distritoId])` /
  `@@index([zonaId])` (802/805). El candidato se acota primero por `distrito_id`; el filtro de estado
  es un join a un catálogo de 20 filas.
- No hace falta ningún tipo nuevo en el enum `historial_accion_tipo`: R6 dice que una orden retenida
  **no** deja fila de historial, y las que sí se mueven siguen escribiendo `orden_zona_reconciliada`
  tal cual (366/§7). El conteo de R8 es un dato de la RESPUESTA, no una fila persistida.
- **Sin backfill.** Medido en producción el 2026-09-07: **0 órdenes con deriva de zona**, así que no
  hay nada que reparar. Lo que sí hay que hacer es **volver a medirlo justo antes de desplegar** (T9):
  la medición caduca, y entre la aprobación del spec y el despliegue alguien puede guardar una zona.

## 5. Contratos I/O

### 5.1 `lib/interfaces/repositories/IZonaRepository.ts`

```ts
export interface UpdateZonaResult {
  zona: ZonaDTO;
  /** 366/R12 — cuántas órdenes CAMBIARON de zona en este guardado. */
  ordenesReconciliadas: number;
  /**
   * 377/R8 — cuántas habrían cambiado pero se quedan porque el paquete ya está en el estante de
   * una bodega satélite. Cero es lo normal. NO es un subconjunto de `ordenesReconciliadas`: los dos
   * conjuntos son disjuntos por construcción (§3.3).
   */
  ordenesRetenidasEnBodegaSatelite: number;
}
```

`update(id, data, actorUsuarioId)` conserva su firma. `create` no cambia (R13).

### 5.2 `lib/interfaces/services/IZonaService.ts` + `lib/services/ZonaService.ts`

```ts
export type ActualizarZonaServiceResult =
  | {
      status: "ok";
      zona: ZonaDTO;
      ordenesReconciliadas: number;
      ordenesRetenidasEnBodegaSatelite: number;
    }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "forbidden" }
  | { status: "not_found" };
```

`ZonaService.actualizar` reenvía el campo nuevo tal cual, sin interpretarlo. Sin cambios de
autorización: sigue siendo `maestro`-only.

### 5.3 `lib/types/zona.ts` y `lib/actions/zonas.ts`

`ActualizarZonaResult` gana el mismo campo en su rama `"ok"`. `actualizarZona` (Server Action) ya
reenvía el resultado del service tal cual: no cambia de lógica, solo fluye un campo más sin `any`.

### 5.4 UI — `app/(app)/configuracion/tarifas/_components/CrearZonaForm.tsx`

Única superficie tocada, y es un mensaje. `mensajeGuardado(esEditar, reconciliadas)` (línea 440) pasa a
`mensajeGuardado(esEditar, reconciliadas, retenidas)`:

| `esEditar` | reconciliadas | retenidas | mensaje |
| --- | --- | --- | --- |
| `false` | — | — | `Zona creada` (sin cambios, R13) |
| `true` | 0 | 0 | `Zona actualizada` (sin cambios) |
| `true` | 12 | 0 | `Zona actualizada (12 órdenes reubicadas)` (sin cambios) |
| `true` | 0 | 3 | `Zona actualizada` + la frase de retenidas |
| `true` | 12 | 3 | las dos frases |

El texto exacto lo decide quien implemente, en español y sin jerga (`docs/conventions.md`), con dos
restricciones que sí son del spec: **no puede decir «sin dueño»** (describe un defecto que este cambio
ya impide) y tiene que decir la causa en términos operativos, del estilo «3 órdenes se quedaron en la
bodega que ya las tiene». **Sin modal, sin confirmación previa, sin bloqueo** (R11).

## 6. Flujo transaccional (delta sobre el §6 de la 366 — el resto no se toca)

Dentro del mismo `$transaction` que ya existe en `ZonaRepository.update`:

1-9. **Sin cambios.** Actualizar la zona, leer distritos previos, reemplazar la N:M y las tarifas,
     calcular la unión de distritos afectados, agrupar por zona resuelta con `zonaUnicaDeDistrito`.

10. Para cada `(zonaResueltaId, distritoIds)`:
    - `base = whereBaseElegible(distritoIds, zonaResueltaId)` (§3.3) — **una sola declaración**.
    - **[377]** `retenidas += tx.orden.count({ where: { ...base, estatus: { value: { in: ESTANTE } } } })`.
      Se cuenta **siempre**, también cuando no hay nada que mover: R8 no depende de que el guardado
      reconcilie algo.
    - `elegibles = tx.orden.findMany({ where: { ...base, estatus: { value: { notIn: ESTANTE } } }, select: {...} })`.
    - Si `elegibles.length === 0`, siguiente grupo (el `loteId` y el actor ya resueltos siguen
      valiendo; no se escribe nada, R6).
    - `updateMany` de `zonaId` + `appendAccion` — **sin cambios respecto de la 366**.
11-12. **Sin cambios**, salvo que el retorno lleva el campo nuevo.

**El `loteId` y `resolverActorCongelado` siguen resolviéndose una sola vez por guardado** (366/R11) y
solo si hay al menos un grupo con zona resuelta. Que un guardado retenga órdenes y no mueva ninguna NO
produce ninguna fila de historial (R6).

**Riesgo de concurrencia:** el `count` y el `findMany` son dos lecturas separadas dentro de la misma
transacción, así que ven la misma instantánea; la ventana entre lectura y escritura es la ya declarada
y aceptada por la 366 (§6), y esta ficha no la ensancha.

## 7. Qué NO se toca (y hay que poder demostrarlo)

- **`TRANSICIONES`** — ni una arista (R14). El grafo de `en_bodega_satelite` queda con sus tres
  salidas. `alcanceDerivadoDelGrafo()` devuelve exactamente lo mismo y
  `tests/unit/utils/estados-bodega-satelite.test.ts` sigue verde **sin tocarlo**.
- **`ESTADOS_BODEGA_SATELITE`, `ESTADOS_CUSTODIA_SATELITE`, `ESTADOS_FUERA_DEL_LISTADO_SATELITE`** —
  las tres tuplas quedan literalmente iguales. Solo se AÑADE una constante nueva al módulo.
- **`OrdenRepository.condicionesSatelite`** — el acotamiento del listado no cambia. Sigue siendo
  `zona ∧ evidencia de custodia`; lo que cambia es que la zona deja de moverse bajo sus pies.
- **`AsignacionSateliteService`** — ni una línea. `zona_ajena` sigue significando lo mismo.
- **`DeshacerAsignacionService`** — ni una línea (su colateral es la Q4).
- **`OrdenRepository.recibirEnSatelite`** — ni una línea. La reconciliación en tránsito, que es lo que
  lo desbloquea, se conserva íntegra (R3).
- **`CorregirDatosClienteService`** — ni una línea (Q3).
  > ⚠️ **DEROGADO el 2026-09-07 por la task T10** (`tasks.md`), que cierra Q3 DENTRO de esta
  > ficha. **Decisión del leader, NO firmada por el humano** (`requirements.md` §Decisiones).
  > **Motivo:** este servicio es **la segunda puerta al mismo `orden.zona_id`** —
  > `en_bodega_satelite` no está en `ESTADOS_SIN_CORRECCION`, así que un maestro podía cambiar el
  > distrito de una orden en estante y re-derivar la zona igual, con el MISMO desenlace que esta
  > ficha arregla. Un arreglo que cierra una de las dos puertas al mismo agujero no es un arreglo.
  > **Lo que se tocó: un `if`** (rechazo si el paquete está en el estante *y* la zona derivada
  > difiere de la estampada), antes del gate del dinero; vuelta atrás: quitarlo. NO se tocó
  > `ESTADOS_SIN_CORRECCION` (R16), así que nombre, teléfono, producto, notas, peso y **dirección**
  > se siguen corrigiendo con el paquete en el estante. Cubierto por 8 casos en
  > `tests/unit/services/corregir-datos-cliente-bodega-satelite.test.ts`.
  > Se anota **aquí** —y no solo en los otros cuatro sitios— porque este es el documento al que
  > deroga, y es donde el próximo lector va a buscar si el diseño se incumplió (menor-5 de
  > `progress/review_377.md`). Lo de arriba se conserva sin borrar: es lo que se decidió el día
  > que se escribió el diseño.
- **La guardia `tests/unit/guards/zona-reconciliacion-no-retarifa.guardia.test.ts`** (T8 de la 366)
  tiene que seguir verde sin editarla: esta ficha reduce lo que la reconciliación toca, nunca lo
  amplía.

## 8. El hueco de verificación, y cómo se cierra

`tests/integration/db/zona-reconciliacion-ordenes.test.ts` tiene 17 casos —medido el 2026-09-07:
12 `it(` mas 2 `it.each` que expanden a 3 y a 2— y **ninguno varía el
estado**: `crearOrden` escribe siempre `FKS.estatusId`, tomado de un `findFirst` sin `orderBy` sobre
`orden`. Es decir, las 17 órdenes semilla comparten un estado **arbitrario y no determinista**. Ese es
el motivo exacto por el que este defecto llegó a `dev` con la suite en verde, y es lo primero que hay
que reparar: mientras `crearOrden` no acepte un estado, ningún test de esta ficha puede existir.

El eje nuevo se abre así (T5): `crearOrden` acepta `estatusValue?: OrderStatusValue`, lo resuelve con
`tx.orderStatus.findUniqueOrThrow({ where: { value } })` —fallo RUIDOSO si el catálogo no está
sembrado, nunca un `if (!x) return;` que reporte `passed` sin comprobar nada— y cae a `FKS.estatusId`
si no se pasa, de modo que **los 17 casos existentes no se tocan**. (Comprobado al cerrar: el
archivo pasa de **17** tests a **28**, y el `git diff` de esos 17 no toca ni un `expect`.)

Y el corte se prueba matándolo: quitar `estatus: { value: { notIn: ESTANTE } }` del `where` tiene que
poner en rojo el caso «en el estante NO se mueve», y cambiar `notIn` por `in` tiene que poner en rojo
el caso «en tránsito SÍ se mueve». Las dos mutaciones se ejecutan a mano durante el desarrollo y se
dejan dichas en el PR (T5).

## 9. Riesgos declarados

- **La orden en estante conserva la tarifa de la zona vieja.** Consecuencia buscada de (a) y explicada
  en §2. Se cierra sola cuando la orden se gestiona.
- **`por_recoger` sigue expuesto.** Una orden asignada desde la bodega A y aún no recogida se
  reconcilia igual, y A pierde el deshacer. Daño menor (el mensajero sí puede seguir), pero real.
  Declarado, no escondido: **Q4**.
- **La corrección manual de ubicación sigue pudiendo orfanar una orden en estante.** Segunda puerta,
  con un humano confirmando importes que no dicen nada de la bodega. Declarado: **Q3**.
- **Si Q2 se responde «no informar», el arreglo queda mudo.** Las órdenes no se orfanan, pero quien
  mueve el distrito no sabe cuántas se quedaron atrás ni por qué su tarifa no se actualizó. Es una
  decisión legítima; queda escrita aquí para que no parezca un olvido.
- **Los números de producción caducan.** 47 en estante / 215 en tránsito / 0 de deriva, medido el
  2026-09-07. Hay que re-medir antes de desplegar (T9), no citar estas cifras como vigentes.
  > **RE-MEDIDO el 2026-09-07 por el leader (T9), en solo lectura: 37 en estante / 215 en tránsito
  > / 0 desalineadas / 0 desalineadas EN EL ESTANTE.** La cifra de **47** de arriba queda
  > **CADUCADA**; la vigente es **37**. Deriva 0 = luz verde: no hay orden huérfana que este
  > cambio vaya a congelar. Detalle en `tasks.md` T9.

## 10. Fuera de alcance (y por qué)

- **Transición de traspaso entre bodegas** — salida (b), §2. Depende de Q1 y de sustituir la frontera
  de autorización del área satélite. Ficha propia.
- **Cambiar la autorización del área satélite de `orden.zonaId` a la custodia del historial** — es el
  rediseño que (b) arrastra. `estados-bodega-satelite.ts:55-57` lo declara intocable en esta capa.
- **Modal de confirmación bloqueante al guardar la zona** — mitad descartada de (c), §2: convierte un
  fallo mudo en uno consentido sin arreglar nada.
- **Backfill o reparación de datos** — 0 órdenes con deriva medidas; nada que reparar (§4).
- **`ZonaRepository.create`** — 366/R13 sigue vigente: crear una zona no reconcilia (R13).
- **`CorregirDatosClienteService`** y **`DeshacerAsignacionService`** — Q3 y Q4.
  > ⚠️ **La mitad de Q3 quedó DEROGADA el 2026-09-07 por la task T10**: `CorregirDatosClienteService`
  > **sí se tocó** —un `if`— y ya NO está fuera de alcance. Motivo y vuelta atrás, en §7.
  > Decisión del leader, **no firmada por el humano**. `DeshacerAsignacionService` (Q4) sigue
  > intacto, y esa mitad del «fuera de alcance» sigue vigente.

## 11. Alternativas descartadas (resumen, con su sección)

| Alternativa | Sección | Por qué se descarta |
| --- | --- | --- |
| (b) Reconciliar + transición de traspaso entre bodegas | §2 | Rediseño: arista nueva + enum + sustituir la autorización del área (que el propio módulo declara intocable) + movimiento físico del paquete, que es decisión de negocio (Q1). Deriva medida hoy: 0. |
| (c) bloqueante: modal de confirmación antes de guardar | §2 | No arregla nada: si el humano confirma, la orden se orfana igual y ahora con su firma. Convierte un fallo mudo en uno consentido. |
| Literal `"en_bodega_satelite"` inline en `ZonaRepository` | §3.1 | Dos consumidores y una justificación de dominio: el literal deja la razón sin domicilio. |
| Resolver `estatusId` con `findEstatusIdByValue` y filtrar por id | §3.2 | El repo indexa por `value` a propósito, y resolver el id añade una rama de `config_error` a un método que hoy no la tiene. `@@index([estatusId])` ya existe: no hay ganancia de plan. |
| Filtrar el estado en JS después del `findMany` | §3.2 | Saca de SQL el corte que decide quién se mueve. Este repo ya midió cuatro veces que una mutación de un corte así sobrevive en verde. |
| Una sola consulta con el estado en el `select` y partición en JS | §3.3 | Ahorra un round-trip y evita dos cláusulas, pero por el mismo motivo que la anterior: el corte deja de ser medible contra Postgres con una mutación. |
| Persistir el conteo de retenidas como fila de `historial_accion` | §4 | Exigiría un valor nuevo de enum (migración) para registrar algo que NO ocurrió. R6 dice justo lo contrario: una orden retenida no deja rastro porque no se le hizo nada. |
| Excluir también `por_recoger` en esta ficha | §9 / Q4 | El estado no dice desde qué bodega se asignó (también se llega desde la central): cubrirlo exige leer la custodia del historial, más superficie que este arreglo mínimo. Queda como pregunta. |
