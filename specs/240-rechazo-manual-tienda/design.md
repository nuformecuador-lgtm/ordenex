# Feature 240 — Diseño técnico

> Requisitos en `requirements.md` (R1-R47) y decisiones D1-D10. **Molde de forma y de rigor:**
> `specs/238-confirmacion-fisica-cierre/design.md`. **Molde de fondo:** la pareja
> `ReprogramacionTiendaService` + `GestionOrdenRepository.reprogramarDesdeDevuelta` (feature 100),
> que ya hace **exactamente esta forma** desde el mismo estado de origen.
>
> **D1, D2, D5, D6, D7 y D9 cambian conducta o dinero y no se implementan sin firma.** Los textos
> están pendientes de D10; aquí se usan los recomendados.
>
> Todo lo que este documento afirma sobre el código está **leído en el árbol**, con archivo y línea.
> Donde falta un número, está declarado como **medición pendiente (T0)**, no rellenado.

---

## 0. El cambio, en una línea de causa y efecto

La devolución anclada tiene hoy **siete salidas** (`lib/types/order-status-transiciones.ts:312-326`)
y **ninguna** de las tres que llegan al rechazo o a bodega la decide una persona de la tienda: son el
cron, el cron, y un admin de bodega. La tienda sólo puede **reprogramar** (#22) o esperar. Esta ficha
declara **la octava salida** —`devuelta → rechazada` decidida por la tienda dueña— con su productor,
**borra la celda equivocada** que puso «Habilitar» donde el pedido decía que no, y **pone la guardia**
que impide que el próximo botón nazca sin nada detrás.

---

## 1. Modelo de datos

### 1.1 Tablas, columnas, índices y RLS: **ninguna, y es una decisión**

No hay tabla nueva, ni columna, ni política RLS, ni índice. Todo lo que esta ficha persiste cabe en
`gestion_orden` (una fila) y `orden_historial_estado` (una fila), las dos con la RLS que ya tienen.

Se dice explícitamente porque en esta pila la tentación de persistir «para no calcular» ya costó
**dos columnas retiradas** (`orden.ayuda`, `orden.gestion_aprobada`). En particular **no se persiste
«lo rechazó la tienda»**: ya está, y es `orden_historial_estado.actor_usuario_id` de la fila con la
familia nueva, enlazada a la gestión por `gestion_orden_id`.

**Índices: ninguno nuevo, y el acceso está medido de antemano.** La única lectura por familia que
esta ficha añade es la de D6 —«¿esta gestión la registró la tienda?»— y **entra por el mismo camino
que ya existe**: `CierreDiaRepository.findGestionParaDeshacer` ya lee
`orden_historial_estado` filtrando por `{ ordenId in …, gestionOrdenId in …, origenTipo }`
(`CierreDiaRepository.ts:342-349`), repitiendo el `ordenId` para entrar por
`@@index([ordenId, createdAt])`. Esta ficha **cambia un igual por un `in` de dos valores**, nada más.

### 1.2 Un valor de enum nuevo: la familia del rechazo manual (D8)

`db/migrations/<ts>_orden_historial_origen_rechazo_tienda/`, con `<ts>` **posterior al último
aplicado** (hoy `20260820120000`, el de la 237) y **posterior también al que registre la 246**
(ver `tasks.md` §Paralelismo).

- `migration.sql`: `ALTER TYPE "orden_historial_origen_tipo" ADD VALUE IF NOT EXISTS 'rechazo_tienda';`
  **Va sola, sin ningún uso del valor en la misma transacción** (Postgres 55P04: no se puede *usar* un
  valor de enum en la transacción que lo añadió, y Prisma Migrate corre cada `migration.sql` en una).
  Precedentes: `gestion_tienda_ayuda` (237), `solicitud_ayuda_tienda`/`rescate_ayuda_tienda` (235),
  `anclaje_devolucion` (239).
- `down.sql`: **recrea el tipo** con los **30** valores previos (los 29 anteriores a la 237 más
  `gestion_tienda_ayuda`), copia literal del molde de
  `db/migrations/20260820120000_orden_historial_origen_gestion_tienda_ayuda/down.sql`, **incluida su
  precondición**: si queda alguna fila con el valor nuevo, el `USING` **falla ruidosamente** y el
  rollback aborta. Es el comportamiento correcto (R47): esas filas son la única evidencia de quién
  decidió un rechazo que se cobró.
- `db/schema.prisma`: el valor entra en `enum OrdenHistorialOrigenTipo` (`:1588-1621`) con su
  comentario de una línea, igual que sus veintinueve hermanos.

⚠️ **Los `down.sql` de las migraciones anteriores de este enum NO se tocan**: son fotos históricas.
Varios recrean el tipo con lista cerrada (157 con 25 valores, 239 con 26, 235 con 27, 237 con 29), así
que aplicarlos **después** de ésta deja el enum sin los valores nuevos. Es el comportamiento esperado
de una cadena de rollbacks y está escrito así desde la 235.

**Índices que el `ALTER COLUMN ... TYPE` del down reconstruye solo:** los tres de
`orden_historial_estado` son btree **plenos**, sin `WHERE`, y sólo uno menciona `origen_tipo` (como
columna, no en un predicado). Re-verificado sobre `db/migrations/*/migration.sql`, no citado de la
237.

---

## 2. La arista, y el recuento que se mueve

En `lib/types/order-status-transiciones.ts`, dentro de `devuelta`:

```ts
{ to: "rechazada", via: "rechazo_tienda", rol: "adminTienda (dueña)" }, // #67 (240)
```

**Y ninguna más (R7).** El comentario del bloque `devuelta` (`:321-325`) dice hoy «las SIETE salidas
de `devuelta` se conservan INTACTAS»: **deja de ser cierto** y se reescribe conservando qué decía y
por qué — un comentario que describe un mundo que ya no existe es peor que ninguno.

**El inventario cambia, y de una forma que conviene mirar dos veces**
(`tests/fixtures/inventario-transiciones-140.ts:240-253`):

| Cifra | Hoy (tras la 237) | Después | Por qué |
| --- | --- | --- | --- |
| `aristasFlujo` | 61 | **62** | una arista nueva |
| `paresUnicos` | 59 | **59, sin cambio** | el par `devuelta → rechazada` **ya existe** (#21, familia `escalado_devuelta_sla`) |

Con eso la diferencia `aristas − pares` pasa de **2 a 3**: aparece un **tercer duplicado histórico**
(#21/#67), hermano exacto de los dos que ya hay (#19/#23 y #20/#24, SLA vs. recuperación manual). El
comentario del recuento explica esa diferencia una a una y **hay que actualizarlo**, no sólo la cifra.

---

## 3. El destino sale del catálogo, no de la identidad de nombre

El estatus destino se resuelve con `findEstatusIdByValue("rechazada")`, igual que
`ReprogramacionTiendaService:59-65` resuelve los suyos. **No se usa `ESTATUS_POR_RESULTADO`**
(`lib/types/gestion-destino.ts`) porque ese mapa es «de resultado de gestión a estatus» y para
`rechazada` devuelve `rechazada`: usarlo aquí funcionaría por coincidencia, no por significado —el
origen de esta transición es un estado, no un resultado—. La 239 rompió esa identidad de nombre para
`devuelta` y ese es justo el sitio donde apoyarse en ella cuesta caro.

---

## 4. La escritura: un helper compartido, no una tercera copia

### 4.1 Lo que ya existe, y por qué es el molde exacto

`GestionOrdenRepository.reprogramarDesdeDevuelta:580-639` hace, **en una transacción**:

```
1. updateMany guardado por { id, estatusId: devuelta, deletedAt: null } -> destino
   count === 0 -> return false, SIN efectos
2. findFirst de la última gestión `devuelta` VIGENTE -> de ahí sale el mensajero
   sin gestión -> throw (aborta la tx; no se inventa un actor)
3. create gestion_orden { mensajeroId derivado, resultado, motivo, cierreId: null }
4. appendCambioEstado { actorUsuarioId = el adminTienda, origenTipo propio, gestionOrdenId }
```

**Los cuatro pasos son idénticos para el rechazo.** Cambian tres cosas: el estatus destino, el
`resultado` de la gestión y la familia del append. La 237 escribió que **no** generalizaba aquel
método «porque su semántica —derivar el mensajero de la última `devuelta` vigente— es otra»
(`specs/237/design.md` §4.3). Aquí **es la misma**, así que el mismo argumento apunta en la dirección
contraria.

### 4.2 El método nuevo y el helper privado

```ts
// lib/interfaces/repositories/IGestionOrdenRepository.ts
export interface RechazarDesdeDevueltaInput {
  ordenId: string;
  estatusDevueltaId: string;   // GUARDA del updateMany (R3/R4)
  estatusRechazadaId: string;  // destino
  motivo: string;              // OBLIGATORIO (R12, D5) — a diferencia de la reprogramación
  actorUsuarioId: string;      // R11: el adminTienda que decide
}

/** `false` = la orden ya no estaba en `devuelta` (carrera perdida): ni gestión ni historial. */
rechazarDesdeDevuelta(input: RechazarDesdeDevueltaInput): Promise<boolean>;
```

Dentro, los pasos 1, 2 y 4 se extraen a **un helper privado del módulo**
(`transicionarDesdeDevuelta`) que `reprogramarDesdeDevuelta` pasa a usar **sin cambiar su firma
pública ni su conducta**. Lo único que cada llamador aporta es el destino, los datos de la gestión y
la familia.

**Por qué el helper y no renombrar el método público** (alternativa **B** de §12): renombrarlo mueve
los call-sites de una feature de dinero que ya está en producción y obliga a re-apuntar sus dobles de
test, a cambio de nada que el helper no dé. **Por qué el helper y no una tercera copia entera**
(alternativa **A**): serían **tres** transacciones con la misma guarda, la misma derivación de
mensajero y el mismo append; el día que alguien arregle una, las otras dos se enteran en producción.

**Lo que este camino NO hace, y cada ausencia es una decisión:**

- **NO** toca `mensajero_asignado_id` (R14). Es **paridad literal con el escalado del cron**
  (`DevolucionSlaRepository.ts:184`: «NO toca `mensajeroAsignadoId` — paridad con un rechazo directo
  del mensajero») y además es **carga**: el bloque 139 de la aprobación busca las `rechazada` **por
  `mensajeroAsignadoId = cierre.mensajeroId`** (`CierresAdminRepository.ts:1424-1431`). Limpiarlo
  dejaría el paquete sin ruta de vuelta a la tienda.
- **NO** enciende `prioridad` (R14): es la única salida de `devuelta` que no la enciende, y por la
  razón que ya está escrita — la orden **no vuelve a reasignarse**
  (`DevolucionSlaRepository.ts:120-124`).
- **NO** toca `usuario.ordenEnGestionId` ni encola reoptimización de ruta: la orden hace tiempo que
  salió de la ruta.
- **NO** escribe `causa_devolucion` ni ubicación (R16): la causa describe una devolución, y la tienda
  decide desde un escritorio.
- **NO** escribe ningún importe (R20). El `data` del `updateMany` toca **exclusivamente**
  `estatusId`.

**Idempotencia por construcción (R5/R21):** la guarda del `updateMany` **es** la barrera. Un segundo
envío encuentra la orden ya fuera de `devuelta`, `count = 0`, y no hay gestión ni historial. No se
escribe código de idempotencia, porque un segundo mecanismo puede divergir del primero.

---

## 5. El servicio

`lib/services/RechazoTiendaService.ts`, espejo estructural de `ReprogramacionTiendaService`:

```
1. ordenRepo.findById(ordenId)            -> null                      ⇒ not_found
2. rol !== adminTienda || orden.tiendaId !== actor.usuarioId           ⇒ forbidden   (R2)
3. orden.estatusValue !== "devuelta"                                   ⇒ conflict    (R3)
4. findEstatusIdByValue(devuelta) / (rechazada) -> alguno null         ⇒ config_error (fallo cerrado)
5. gestionRepo.rechazarDesdeDevuelta(...) -> false                     ⇒ conflict    (R3)
```

- **El paso 2 es la misma autorización que el listado de novedades**: `adminTienda` cuya
  `usuarioId` **es** el `orden.tienda_id`. No se escribe una segunda tabla de permisos.
- **El paso 3 es una lectura optimista y se sabe**: la barrera real está en el WHERE del paso 5
  (R4). Existe igualmente para poder devolver `conflict` con su motivo **sin** haber intentado
  escribir, que es lo que hace la pantalla legible.
- **NO se comprueba el bloqueo del mensajero.** Igual que `rescatarOrdenAyuda` y que
  `GestionDesdeAyudaService`: añadirlo crearía un deadlock —la tienda no podría resolver su orden
  porque el mensajero no cerró su día—.
- **NO se comprueba si el plazo venció** (D9/R25).

**Por qué un servicio nuevo y no un método de `ReprogramacionTiendaService`:** el nombre de esa clase
describe **lo que hace**, y meter dentro el rechazo la convertiría en «el servicio de las cosas que
la tienda hace desde novedades», que es un cajón. Dos clases de treinta líneas con una guarda cada
una son más baratas de leer que una de sesenta con dos caminos.

---

## 6. El borde

`lib/actions/resolver-novedad.ts` gana **una tercera acción**, junto a sus dos hermanas de la 100 —el
mismo archivo, el mismo `withErrorHandler`, el mismo `toResolverNovedadActionError`, el mismo
`BorderError`—:

```ts
const rechazarSchema = z.object({
  ordenId: z.string().uuid(),
  motivo: z.string().trim().min(1).max(MOTIVO_MAX),   // R12/D5: OBLIGATORIO
});

export type RechazarNovedadActionResult = RechazarNovedadResult | BorderError;
export async function rechazarNovedad(
  input: { ordenId: string; motivo: string },
  deps?: RechazarNovedadDeps,
): Promise<RechazarNovedadActionResult>;
```

- **`motivo` obligatorio en el borde y no sólo en el modal**: el modal es UI, esto es el borde.
  Rechazar sin motivo dejaría un cobro sin una línea que lo explique, que es justo lo que R12 viene a
  evitar. Mismo razonamiento, palabra por palabra, que la nota obligatoria de «Habilitar»
  (`lib/types/novedad-habilitar.ts:29-32`).
- **`MOTIVO_MAX` se reutiliza, no se inventa**: el motivo acaba en `gestion_orden.motivo`, así que el
  tope sale del mismo sitio que el de la gestión del mensajero (`lib/types/gestion-orden.ts`). Un
  tope propio sería una segunda verdad que el día que divergiera dejaría pasar en el borde un texto
  que la DB rechazaría después.
- **El actor NUNCA viaja en el input**: lo fija la sesión.

---

## 7. El dinero — verificado consumidor por consumidor

> La hipótesis cómoda es «sale solo porque los feeds leen `gestion_orden` por `cierre_id`». **Es
> cierta para los cinco feeds y produce, además, un cobro repetido que ya existe hoy.**

### 7.1 Lo que cobra un rechazo, con su dueño

| Concepto | Quién lo recibe | De qué tarifa sale | ¿Lo mueve esta ficha? |
| --- | --- | --- | --- |
| `cobroRechazado` → `ingreso_bodega_rechazo` | **la bodega** | `tarifa_zona_mensajero`, por **zona + vehículo del MENSAJERO** | sí, vía la gestión (D1) |
| `ingreso_flete_devolucion` + su IVA | **Ordenex** (crédito) y **la tienda** (débito) | `tarifas` de la **TIENDA**, congelada en `cierre_detail` | sí — **y por segunda vez**: ver §7.2 |
| `pago_mensajero` | el mensajero | — | **no**: `pagoPorResultado` sólo paga `entregada` |
| totales del cierre | — | — | **no**: `computeTotales` sólo suma `entregada` |

⚠️ **`cobroRechazado` NO es un cargo a la tienda.** No está en los seis conceptos del ledger de
tienda; sus únicos consumidores son `CierreBodegaRepository` y `CierreBodegaService`. La 237 tuvo que
corregir esta misma frase en su design el 2026-08-20; se repite aquí para que nadie la vuelva a
escribir al revés, y es la razón de que el aviso de D10 nombre **el flete** y no ese importe.

### 7.2 El cobro repetido del flete de devolución (D2)

`derivarIngresoOrden` (`lib/utils/ingreso-ordenex.ts:86-94`) emite `ingreso_flete_devolucion` + IVA
para **`devuelta` y `rechazada`**, y alimenta a la vez el ingreso de Ordenex (42,
`WalletFeedService`) y el débito a la tienda (43, `WalletTiendaFeedService:112-130`, con el
interruptor `TIENDA_DEBITA_FLETE_DEVOLUCION` en **`true` por defecto**,
`lib/config/wallet-tienda.ts`). La secuencia completa:

```
cierre A aprobado → gestión `devuelta` → flete de devolución cobrado (1.ª vez) → anclaje → `devuelta`
cierre B aprobado → gestión `rechazada` (del cron HOY, o de la tienda con esta ficha)
                  → flete de devolución cobrado (2.ª vez) + cobroRechazado
```

**No lo introduce esta ficha**: es la conducta del escalado desde la 99. Lo que esta ficha hace es
**volverlo frecuente** y **ponerle un número** (M3 de T0). Decisión y desenlace: **D2**, recomendación
(a) —paridad, medir, y ficha aparte si el número no es cero—.

### 7.3 El intento de entrega: la familia se queda FUERA de la lista

`whereIntentosVigentes` (`lib/repositories/OrdenHistorialRepository.ts:176-202`) exige seis cosas; la
sexta es que la gestión tenga una fila de historial de familia `ORIGEN_TIPOS_VISITA_REAL`. La familia
nueva **no entra** (R19), y el argumento es **literalmente el que ya está escrito** para
`reprogramacion_tienda` (`lib/types/orden-historial.ts:204-208`):

> «`reprogramacion_tienda` se hace sobre una orden que **YA TIENE** una gestión `devuelta` real
> contada. Sumarla dará el DOBLE CONTEO que 160/R2 evitaba.»

Y **no contradice** que `gestion_tienda_ayuda` sí entre (237/R6): aquella se hace sobre una orden en
la que el mensajero **no registró ningún desenlace** —pedir ayuda no cuenta—, así que sin ella esa
visita no la contaría nadie. Aquí la visita ya está contada. **Las dos ausencias tienen su test.**

### 7.4 El aviso interno que NO se emite

`lib/notificaciones/emitir.ts:131-132` filtra el aviso «Una orden fue rechazada **por el
destinatario**» por `destino === "rechazada" && origenTipo === "gestion"`. Con la familia nueva **no
se emite**, y es correcto: lo rechazó la tienda, no el destinatario. Es la misma decisión que la 237
firmó (su D4) y que dejó escrita en ese mismo archivo (`:134-150`). Se **añade el párrafo** de esta
ficha ahí, para que la ausencia sea decisión y no olvido, y **se afirma con un test** (R45).

### 7.5 El evento público SÍ se emite

`rechazada` está en `EVENTOS_PUBLICOS` y la familia nueva **no** se añade a
`ORIGENES_SIN_EVENTO_PUBLICO`, así que el integrador recibe el mismo evento que hoy (R44). El test
que fija esa lista por igualdad (`tests/unit/types/webhook-eventos.test.ts`) **sigue verde sin
tocarse**; si se pone rojo, alguien exceptuó la familia nueva.

---

## 8. El reloj de la 239 (D9)

**Se detiene por construcción, y hay que decir exactamente por qué.**
`DevolucionSlaRepository.findDevueltasSla:62-67` toma como candidatas
`{ deletedAt: null, estatus: { value: "devuelta" } }`. En cuanto la orden pasa a `rechazada` **deja de
estar en ese conjunto**: no hay que apagar nada, ni limpiar una marca, ni acordarse de un séptimo
sitio. Es la propiedad que la 239 compró al convertir la visibilidad y el reloj en **el mismo estado**
—y la razón de que esta ficha no necesite ni una línea para pararlo (R23)—.

**El ancla no se toca (R24).** La fila de `orden_historial_estado` con familia `anclaje_devolucion`
es historia inmutable: no se re-ancla, no se borra, no se modifica. Si esa orden volviera algún día a
`devuelta` (hoy no hay camino desde `rechazada` que lleve allí: sus tres salidas son `en_reparto` por
deshacer y `por_devolver*` al aprobar el cierre), el `orderBy createdAt desc` + `take 1` del ancla
tomaría **la más reciente**, que es R15 de la 239 y ya funciona.

**Y no se exige que el plazo haya vencido (R25, D9-a).** El plazo existe para que el sistema decida
cuando nadie decide.

⚠️ **La carrera con el cron está cerrada por la misma guarda que todo lo demás.** Si el cron escala
primero, el `updateMany` de la tienda encuentra `count = 0` y devuelve `conflict` sin efectos; si
gana la tienda, `escalarDevueltaSla` encuentra `count = 0` y devuelve `false` sin crear su gestión
sintética (`DevolucionSlaRepository.ts:186-188`). **En ninguna de las dos ramas se cobra dos veces el
`cobroRechazado`** (R21).

---

## 9. Dónde NO cae la escritura: la transacción de aprobación

**Esta ficha no escribe ni una línea dentro de `resolverCierre`.** La gestión se escribe en su propia
transacción, en el instante en que la tienda actúa, igual que `reprogramarDesdeDevuelta`. Lo que
ocurre en la aprobación son **consecuencias de filas que ya existen**:

| Bloque | Qué pasa con el rechazo manual | ¿Cambia el código? |
| --- | --- | --- |
| Los cinco feeds de dinero | leen por `cierreId`, como cualquier gestión | **No** |
| `devolucionRechazadas` (139) | la orden sigue con `mensajero_asignado_id` y en `rechazada` ⇒ pasa a `por_devolver`/`por_devolver_a_tienda` | **No** |
| **Confirmación física (238)** | `rechazada` está en `RESULTADOS_QUE_VUELVEN` ⇒ **bodega tendrá que escanear ese paquete** | **No** — y ver D7 |
| Anclaje (239) | no aplica: sólo mira `resultado: "devuelta"` | **No** |
| Indemnización (158) | no aplica: sólo `incidente` | **No** |

**Consecuencia buscada: el orden de los bloques no se mueve.**
`tests/unit/repositories/cierres-admin-caja-cod.test.ts` mide el orden de las llamadas dentro de la
transacción porque los feeds se leen unos a otros; esta ficha no inserta nada entre ellos. **Un rojo
ahí es regresión, no una aserción a actualizar.**

⚠️ **Lo que sí cambia de hecho, sin cambiar código (D7):** el conjunto de guías que la ventana del
238 pide escanear **crece** con los paquetes que la tienda rechazó a mano, **y esos paquetes ya
están en la bodega** desde el cierre anterior.
`findGestionesRetornablesDelCierre:786-794` filtra por `resultado`, **sin mirar la familia**, así que
no distingue una gestión sintética de una visita. Ya ocurre hoy con las sintéticas de la 99 y de la
100 — la palabra «sintética» **no aparece** en el spec de la 238—. Se declara, se mide (M6) y se
recorre en la tanda de «ver la app».

---

## 10. La pantalla

### 10.1 Una celda que se borra y una acción que se cablea

`app/(app)/novedades/_components/novedad-acciones-catalogo.ts:95-105`:

```ts
export const ACCIONES_POR_GRUPO = {
  ayuda: ["contacto", "reprogramarDesdeAyuda", "rechazarDesdeAyuda",
          "habilitar", "conversacion", "intentoContacto"],
- devolucion: ["contacto", "reprogramar", "habilitar", "rechazar"],
+ devolucion: ["contacto", "reprogramar", "rechazar"],
} as const satisfies Record<GrupoNovedad, readonly AccionNovedad[]>;
```

**Eso es el punto 12 entero** (R33). El comentario de `:63-68` que declara la deuda y nombra a esta
ficha **se sustituye** por lo que pasó: qué decía, por qué era falso y qué se hizo. La 236 lo dejó
preparado con esas palabras: «corregirlo pasa a ser borrar una palabra de esta línea».

`rechazar` **se queda** —es el botón que esta ficha cablea— y su JSDoc deja de decir «MAQUETA hasta la
ficha 240» (`:32-33`).

### 10.2 El cableado

- `NovedadAcciones.tsx`: la prop `onDevolver` pasa a llamarse **`onRechazar`**. No es cosmética: su
  comentario dice hoy «el prop conserva su nombre porque nombra la transición que falta decidir»
  (`:141-143`) — **ya está decidida**, así que el nombre pasa a decir la verdad. El rótulo, el
  tooltip, el icono (`Undo2`) y el nombre accesible **no cambian**.
- `NovedadesModule.tsx`: `avisarNoDisponible` **desaparece** (`:271-280`) y su hueco lo ocupa el
  estado `ordenARechazar` con el mismo patrón que sus tres hermanos —montaje condicional con
  `key={orden.id}`, para que el motivo arranque vacío en cada apertura: un motivo heredado de la
  orden anterior acabaría explicando un cobro que no le corresponde—.
- ⚠️ **`toast.info` se queda sin usuarios en este módulo.** El comentario del fixture de test que
  dice «el canal `info` deja de ser un `vi.fn()` anónimo porque los dos botones de MAQUETA avisan por
  él» (`tests/components/NovedadesModule.test.tsx:79-81`) **deja de ser cierto**: se reescribe, no se
  deja como folclore.

### 10.3 La ventana

`RechazarNovedadModal.tsx`, junto a la pantalla (un solo consumidor ⇒ no se promueve a `shared/`).
**Molde: `ReprogramarNovedadModal`** (feature 100), que ya resuelve el canal de error del `Modal`, el
`confirmDisabled` y la salida por toast.

- Un campo (**«Motivo del rechazo»**, obligatorio) y **el aviso fijo de D10 arriba, siempre
  visible**, no en un tooltip: es donde se dice el precio y que no se puede deshacer.
- `confirmDisabled` mientras falte el motivo, **y el motivo del bloqueo con palabras** (R29) — la
  regla que la ventana de la 238 y el sub-modal de la 158 ya siguen: se lee el texto, no el
  `disabled`.
- Tras `ok`: toast de éxito y la fila **sale de la lista con su total** (R30). Tras `conflict`: el
  texto de la carrera y **se recarga la página de la pestaña**, para que la fila desaparezca —o se
  quede— **por el dato** y no por optimismo de cliente. Es literalmente la lección de 236/D8 sobre
  esta misma card.
- **Sin selector de fotos** (R13/D5).

### 10.4 Lo que la tienda deja de ver, dicho aquí

Tras el rechazo la orden **no aparece en ninguna de las tres pestañas**: sale de «En devolución» por
estado, y **no entra** en «Rechazadas por plazo vencido», cuyo predicado es exactamente la familia del
cron (`OrdenRepository.ts:3282`, `historialEstados.some({ origenTipo: escalado_devuelta_sla })`) —
R26. Es correcto: esa pestaña afirma un plazo vencido que aquí no venció. Sigue estando en
`/ordenes`, con su estado. **No se crea ninguna pestaña nueva.**

---

## 11. La guardia contra la maqueta (D3, R37-R40)

### 11.1 Qué se declara, y dónde

En el **mismo módulo puro** que la tabla, porque es el mismo censo:

```ts
// app/(app)/novedades/_components/novedad-acciones-catalogo.ts
export type ProductorAccion =
  /** La Server Action que ESTA acción dispara, y el módulo donde vive. */
  | { readonly accionServidor: string; readonly modulo: string }
  /** O el motivo escrito de que no dispare ninguna. Mínimo 20 caracteres, sin relleno. */
  | { readonly sinOperacion: string };

export const PRODUCTOR_POR_ACCION = {
  contacto:              { sinOperacion: "abre el marcador del telefono y WhatsApp del navegador: no muta nada en el servidor" },
  reprogramar:           { accionServidor: "reprogramarNovedad",           modulo: "lib/actions/resolver-novedad" },
  rechazar:              { accionServidor: "rechazarNovedad",              modulo: "lib/actions/resolver-novedad" },      // 240
  habilitar:             { accionServidor: "habilitarNovedad",             modulo: "lib/actions/habilitar-novedad" },
  intentoContacto:       { accionServidor: "registrarIntentoContactoOrden", modulo: "lib/actions/orden-ayuda" },
  conversacion:          { accionServidor: "listarNotasOrden",             modulo: "lib/actions/orden-notas" },
  reprogramarDesdeAyuda: { accionServidor: "gestionarDesdeAyuda",          modulo: "lib/actions/gestion-desde-ayuda" },
  rechazarDesdeAyuda:    { accionServidor: "gestionarDesdeAyuda",          modulo: "lib/actions/gestion-desde-ayuda" },
} as const satisfies Record<AccionNovedad, ProductorAccion>;
```

El `satisfies Record<AccionNovedad, …>` **es R37 entero**: una acción nueva sin productor **no
compila**. Es el mismo mecanismo con el que la 236 hizo imposible añadir un grupo sin su juego de
botones.

Las ocho entradas están **verificadas contra el árbol**: los cinco módulos existen, exportan esos
símbolos, y **cada uno lo importa al menos un archivo de `app/(app)/novedades/`** (`IntentoContactoAccion.tsx:9`,
`HiloNotasNovedadModal.tsx:7-11`, `NovedadesModule.tsx:32`, `GestionarDesdeAyudaModal.tsx:10`,
`ReprogramarNovedadModal.tsx:10`).

### 11.2 La guardia

`tests/unit/guards/novedad-acciones-sin-maqueta.guardia.test.ts`, **hermana** de
`novedad-acciones-una-tabla.guardia.test.ts` y con su misma forma (censo del árbol +
autocomprobación + anti-vacuidad). Tres frentes:

1. **El productor existe (R38).** El módulo declarado está en `lib/actions/**`, lleva `"use server"`
   y exporta `export async function <accionServidor>`. Es el modo de fallo de
   `test-citado-desaparecido.guardia.test.ts`: una cita que ya no apunta a nada.
2. **El productor está cableado (R38).** Algún archivo de `app/(app)/novedades/` **importa ese
   símbolo de ese módulo** (arista nombrada, no mención en prosa: el fuente se lee **sin
   comentarios**, con `tests/fixtures/sin-comentarios`, que es lo que la guardia hermana ya hace).
   Éste es el frente que la maqueta **no habría pasado**: `rechazar` no habría podido citar ninguna
   acción.
3. **La excusa caduca y tiene que ser legible (R39).** `sinOperacion` con motivo ausente, de menos de
   20 caracteres o de relleno (`TODO`, `pendiente`, `-`) ⇒ roja. Es la regla, palabra por palabra, de
   `@sin-superficie` en `superficie-de-uso.guardia.test.ts:80-85`.

**Autocomprobación dentro del propio archivo (R40)**, en las dos direcciones y sobre datos
sintéticos: un productor inventado se denuncia; un productor real sin importador se denuncia; un
`sinOperacion` con «TODO» se denuncia; y la tabla real sale limpia. **Anti-vacuidad:** se afirma que
el censo leyó ≥ 8 archivos, que ninguno está vacío y que se encontraron las ocho entradas — una
guardia estática rota **no falla, calla**, y en esta misma pila ya pasó una vez.

⚠️ **El censo se escribe en un archivo de test, nunca por `node -e`**: ahí `\b` llega como backspace
y el censo miente en verde (lección literal de `specs/238/tasks.md` T1.2).

### 11.3 Por qué esto no es «otra guardia más»

**Porque la que había estuvo verde las dos semanas que el botón fue maqueta, y su verde era
correcto.** `superficie-de-uso` mide **alcanzabilidad de módulos y de handlers**; `avisarNoDisponible`
estaba declarada, referenciada y montada, así que sus tres capas (R-A, R-B, R-C) pasaban. Lo que
faltaba no era una capa más de alcanzabilidad: era **atar el censo de botones al censo de
operaciones**, y ese censo lo creó la 236 hace un día. La guardia nueva es el eslabón entre los dos.

---

## 12. La guarda del deshacer (D6)

`lib/utils/gestion-tienda-ayuda-flag.ts` declara hoy **un** valor
(`ORIGEN_TIPO_GESTION_TIENDA_AYUDA`) y un predicado (`esGestionDesdeAyudaTienda`). Pasa a declarar
**una lista** —`ORIGENES_GESTION_DE_LA_TIENDA`— y el predicado a preguntar por pertenencia. Con eso:

- `CierreDiaService.deshacerGestion:601-603` **no cambia una línea**: sigue leyendo
  `gestion.desdeAyudaTienda`. Lo que cambia es de dónde sale ese booleano.
- `CierreDiaRepository.ts:342-349` y `CierresAdminRepository.FAMILIAS_DERIVADAS_DEL_HISTORIAL:155-158`
  pasan de un igual a un `in`. **Ninguna consulta nueva.**
- El **nombre** del campo del DTO (`desdeAyudaTienda`) y el del predicado dejan de describir lo que
  contienen. Se renombran a **`registradaPorLaTienda`** / `esGestionDeLaTienda`, guiado por el
  typecheck. Es un rename de lectura, sin cambio de forma ni de dato.
- El **mensaje** deja de nombrar la pantalla de ayuda (D10, R43).

⚠️ **`reprogramacion_tienda` NO entra en esa lista** (D6): es alcance de la 100, es dinero neutro y
cambiar su conducta sin pedirlo sería lo que la ficha 241 está investigando en otro sitio. Queda
**medido** (M5) y **propuesto como ficha**, no en silencio.

---

## 13. Contratos I/O

**Rutas nuevas: ninguna** (ni endpoint, ni página: la acción vive en la card de `/novedades`).
**Tablas nuevas: ninguna. Índices nuevos: ninguno. Integraciones externas: ninguna.**

```ts
// lib/types/rechazo-tienda.ts  (NUEVO — borde zod, viaja al navegador: sin @prisma/client)
export const rechazarNovedadSchema = z.object({
  ordenId: z.string().uuid(),
  motivo: z.string().trim().min(1).max(MOTIVO_MAX),   // reutiliza el tope de `gestion-orden.ts`
});
```

```ts
// lib/interfaces/services/IRechazoTiendaService.ts  (NUEVO)
export type RechazarNovedadResult =
  | { status: "ok" }
  | { status: "not_found" }
  | { status: "forbidden" }
  | { status: "conflict"; motivo: string }
  | { status: "config_error" };

rechazar(ordenId: string, motivo: string, actor: Actor): Promise<RechazarNovedadResult>;
```

```ts
// lib/actions/resolver-novedad.ts        (+1 acción, el resto intacto)
+ export async function rechazarNovedad(input, deps?): Promise<RechazarNovedadActionResult>;
```

```ts
// lib/interfaces/repositories/IGestionOrdenRepository.ts
+ rechazarDesdeDevuelta(input: RechazarDesdeDevueltaInput): Promise<boolean>;
```

```ts
// lib/types/orden-historial.ts
  ORDEN_HISTORIAL_ORIGEN_TIPO_SEED += "rechazo_tienda"
  ORIGEN_TIPOS_VISITA_REAL:  SIN CAMBIOS   // R19 — y su literal en dos tests SIGUE VERDE
  ORIGEN_TIPOS_CON_GESTION:  SIN CAMBIOS
```

```ts
// lib/utils/gestion-tienda-ayuda-flag.ts  ->  gestion-de-la-tienda-flag.ts
- export const ORIGEN_TIPO_GESTION_TIENDA_AYUDA
+ export const ORIGENES_GESTION_DE_LA_TIENDA: readonly OrdenHistorialOrigenTipo[]
- export function esGestionDesdeAyudaTienda(...)
+ export function esGestionDeLaTienda(...)
```

```ts
// app/(app)/novedades/_components/novedad-acciones-catalogo.ts
  ACCIONES_POR_GRUPO.devolucion: sin "habilitar"            // R33
+ export type ProductorAccion, export const PRODUCTOR_POR_ACCION   // R37
```

**`NovedadDTO` no cambia. `HabilitarNovedadResult` NO SE TOCA (D4).** Que el contrato del DTO y el
del rescate salgan intactos de una ficha que cambia lo que la pantalla puede hacer es la señal de que
el corte está donde tiene que estar.

---

## 14. Alternativas descartadas

### A · Copiar entera la transacción de `reprogramarDesdeDevuelta` *(la más barata)*

Un tercer método con su propio `updateMany`, su propio `findFirst` del mensajero y su propio append.

**Descartada: serían tres copias de la misma transacción de dinero.** Las tres comparten la guarda de
estado, la derivación del mensajero (con su `throw` si falta) y el append por el choke point; el día
que alguien arregle una —un `deletedAt` que falta, un `orderBy` mal— **las otras dos se enteran en
producción**. El helper privado del §4.2 cuesta una función y deja un solo sitio donde eso vive.

### B · Generalizar el método público a `resolverDesdeDevuelta(resultado, …)`

**Descartada: mueve una superficie de dinero en producción sin ganar nada.** Renombrar el método
público obliga a re-apuntar los call-sites y los dobles de test de la feature 100 —que es dinero
vivo— a cambio de una deduplicación que el helper **privado** ya da. La señal del typecheck que un
rename produce es valiosa cuando hay algo que decidir en cada call-site; aquí no lo hay.

### C · Reutilizar `escalarDevueltaSla` del cron, pasándole un actor

Es el método que **ya hace** `devuelta → rechazada` con su gestión sintética.

**Descartada por tres razones y la primera basta.** (i) Su `origen_tipo` está **fijado dentro**
(`DevolucionSlaRepository.ts:211`) y es el predicado exacto de la pestaña «Rechazadas por plazo
vencido» (102) y de `esRechazoSla`: un rechazo manual entraría en esa pestaña afirmando un plazo que
no venció, y el detalle del cierre lo etiquetaría como escalado. (ii) Escribe `actorUsuarioId: null`
(«sistema/cron»), es decir **borraría la única evidencia de quién decidió el cobro** (R11). (iii)
Recibe el `mensajeroId` **ya resuelto** desde `findDevueltasSla`, que es una lectura del cron, no de
una petición de usuario; habría que darle una segunda forma de obtenerlo.

### D · Que el rechazo manual **no** cree gestión y sólo cambie el estado

**Descartada, y es D1-(b).** El paquete vuelve físicamente igual, así que la bodega perdería su
`cobroRechazado` por un trabajo que sí hace; y —peor— rechazar a mano saldría **gratis** mientras
esperar al plazo cuesta, sobre la misma orden. Además la decisión no aparecería en ningún cierre: no
habría fila que auditar el día de la disputa.

### E · Arreglar aquí el cobro repetido del flete de devolución

**Descartada, y es D2-(b).** Obliga a que una función **pura** —`(resultado, tarifa) → conceptos`—
necesite el historial de la orden para saber si ya se le cobró, y cambia lo que **el cron** lleva
cobrando desde la 99, sin ficha y sin firma. Se **mide** (M3) y, si el número no es cero, se abre
ficha el mismo día.

### F · Excluir las gestiones sintéticas de la ventana física de la 238

**Descartada, y es D7-(b).** El conjunto que la 238 exige confirmar y la columna que escribe son
suyos, con su guardia de «nace sin lectores» incluida. Tocarlos desde aquí sería cambiar el gesto de
aprobar un cierre sin la ficha que lo decidió. Se declara, se mide (M6) y se recorre.

### G · Un feature flag para desplegar por mitades

**Descartada: no hay punto intermedio útil.** Sin la pantalla, la acción no la llama nadie (y la
guardia nueva se pone roja, que es justo su trabajo); sin la acción, la pantalla ofrece un botón que
falla. El **único** corte obligatorio es la migración del valor de enum, que **no puede** ir en la
misma transacción que su primer uso (55P04) y es **inerte**. Todo lo demás, **un PR**.

---

## 15. Rojos esperados, y rojos que son REGRESIÓN

### Rojos POR DISEÑO (se actualizan con nota fechada; ninguno se «arregla» tocando el código)

| Suite (existe hoy, verificado) | Qué se pone rojo | Cómo se repara |
| --- | --- | --- |
| `tests/unit/types/novedad-acciones-catalogo.test.ts:48` | `devolucion: ["contacto","reprogramar","habilitar","rechazar"]` en `JUEGO_ESPERADO` | Se quita `"habilitar"`. ⚠️ **Ese literal ES el contrato** y su comentario `:44-48` dice que cambiará con esta ficha: se **actualiza a mano**, jamás se deriva de su propia fuente (quedaría verde para siempre) |
| ídem `:113-119` | «la conversación… no en devolución» | **Sigue verde**; se le añade el caso hermano de `habilitar` (R33) y el control positivo de ayuda (R34) |
| `tests/components/NovedadAcciones.test.tsx:125-131` | censo de la fila de DEVOLUCIÓN: cinco controles, con «Habilitar» | Pasa a **cuatro**. El comentario `:122-124` («aparece aquí por traducción literal… su dueño es la 240») se sustituye por lo que pasó |
| `tests/components/NovedadAcciones.test.tsx:287-295` | «y «Rechazar» de la fila de DEVOLUCIÓN sigue siendo la maqueta de la 240» | **Cambia de sentido a propósito: es el producto de esta ficha.** Se reescribe contra `onRechazar`, no se borra |
| `tests/components/NovedadesModule.test.tsx:79-81, 877-882` | el fixture del canal `info` y el censo de botones de la card de devolución | El canal `info` se queda sin usuarios; el censo pierde «Habilitar» |
| `tests/fixtures/inventario-transiciones-140.ts:244,251` | `aristasFlujo: 61` | **62**; `paresUnicos` **se queda en 59** (§2) y su comentario gana el tercer duplicado |
| `tests/unit/domain/order-status-transiciones.guardia.test.ts` · `.connectividad.test.ts` | censo de aristas y conectividad de `devuelta` | Una arista nueva, declarada y con productor (R6) |
| `tests/unit/repositories/orden-historial-cobertura.test.ts:391-421` | `PUNTOS_DE_ESCRITURA` (hoy 30) y la igualdad exacta contra el SEED | **31**, con la entrada `#32 GestionOrdenRepository.rechazarDesdeDevuelta / rechazo_tienda` |
| `tests/unit/types/orden-historial-types.test.ts` | el censo del SEED | Gana el valor nuevo. ⚠️ El literal de **`ORIGEN_TIPOS_VISITA_REAL` NO cambia** (R19): si alguien lo toca, es la mutación que hay que matar |
| `tests/unit/services/cierre-dia-*` / los del deshacer | el rename de `desdeAyudaTienda` → `registradaPorLaTienda` y el mensaje sin «pantalla de ayuda» | Guiado por el typecheck; **se añade** el caso de la familia nueva (R43) |
| `tests/unit/repositories/gestion-orden-reprogramar.test.ts` | si la extracción del helper (§4.2) cambia la **forma** de las llamadas | La conducta observable **no cambia**: si el test mira conducta sigue verde, y si mira estructura se re-apunta |
| `tests/integration/db/*` de migraciones de enum | el enum gana un valor | Test propio, molde de `tests/integration/db/gestion-tienda-ayuda-migration.test.ts` |

### Rojos que son REGRESIÓN (si aparecen, el cambio aterrizó mal — se arregla el CÓDIGO, no el test)

- `tests/unit/services/devolucion-sla-service.test.ts` · `tests/unit/repositories/devolucion-sla-repository.test.ts`
  · `tests/unit/services/devolucion-sla-dinero.test.ts` — **el cron no se toca** (R41).
- `tests/unit/repositories/cierres-admin-caja-cod.test.ts` — **mide el orden de las llamadas** dentro
  de la transacción de aprobación. Esta ficha no escribe ahí (§9).
- `tests/unit/repositories/cierres-admin-anclaje-devolucion.test.ts` ·
  `tests/unit/repositories/cierres-admin-confirmacion-fisica.test.ts` ·
  `tests/unit/repositories/cierres-admin-indemnizacion.test.ts` — los bloques de la 239/238/158.
- `tests/integration/db/wallet-idempotencia.test.ts` · `wallet-tienda-idempotencia.test.ts` ·
  `pago-mensajero-idempotencia.test.ts` · `caja-tesoreria-idempotencia.test.ts` — los cinco feeds.
- `tests/unit/services/intentos-entrega-criterio-unico.test.ts` ·
  `tests/unit/types/criterio-intento-entrega.test.ts` ·
  `tests/unit/guards/anclaje-vs-intentos.guardia.test.ts` ·
  `tests/unit/guards/deriva-primer-intento.guardia.test.ts` — **si se ponen rojos, alguien metió la
  familia nueva en `ORIGEN_TIPOS_VISITA_REAL` o fusionó el anclaje con el conteo de intentos.**
- `tests/unit/guards/ordenes-columnas-money-safe.guardia.test.ts` ·
  `tests/unit/guards/dinero-sin-centimos.guardia.test.ts` — money-safe (R20).
- `tests/unit/types/webhook-eventos.test.ts` — la lista de exclusión se fija por igualdad: un rojo
  significa que alguien exceptuó la familia nueva (R44).
- `tests/unit/guards/novedad-acciones-una-tabla.guardia.test.ts` — si se pone roja, la decisión de qué
  botón se ofrece volvió a salirse de la tabla.
- `tests/unit/services/habilitar-novedad-service.test.ts` · `tests/unit/services/rescate-ayuda-service.test.ts`
  · `tests/components/RepartoAyuda.test.tsx` — el rescate y el portal del mensajero **no cambian**
  (R35/R42).
- `tests/unit/repositories/orden-repository.novedades.test.ts` ·
  `tests/unit/repositories/orden-repository.rechazos-sla.test.ts` — los predicados de las tres
  pestañas no cambian (R26).
- `tests/unit/guards/superficie-de-uso.guardia.test.ts` — la acción nueva **tiene** superficie desde
  su primer commit útil; si sale huérfana, el modal no se montó.

---

## 16. Riesgos

1. **El cobro repetido del flete de devolución (D2).** Es el riesgo número uno porque **no es un
   riesgo de esta ficha, es uno que esta ficha multiplica**. Mitigación: M3 antes de firmar, y ficha
   aparte con el importe delante si el número no es cero.
2. **La ventana física del 238 pidiendo un paquete que ya está en la bodega (D7).** Con la regla «sin
   escapatoria» de la 238, una fricción mal entendida se lee como un cierre imposible de aprobar —que
   es exactamente el bloqueo duro que el recorrido de la 238 encontró y la suite no veía—. Mitigación:
   M6, y el recorrido de la tanda de «ver la app».
3. **El rechazo es irreversible por diseño (D6).** Un rechazo equivocado de la tienda **no tiene
   deshacer**. Mitigación: el aviso fijo lo dice **antes** (D10) y el motivo es obligatorio. Es el
   mismo precio que la 237 aceptó, con la misma razón: el peor caso es recuperable —el paquete vuelve
   a la tienda— mientras que lo contrario borra dinero sin consentimiento.
4. **La lista de familias del deshacer es una lista de dinero.** Ampliarla es lo más delicado del PR
   fuera del rechazo mismo; el rename `desdeAyudaTienda → registradaPorLaTienda` toca varios archivos
   y es fácil dejarse uno a medias. Mitigación: el typecheck lo guía y hay mutación propia.
5. **La guardia nueva puede nacer vacía.** Una guardia estática rota **no falla, calla**. Mitigación:
   anti-vacuidad + autocomprobación en el propio archivo, y una tanda que la pone roja a mano.
6. **El pre-vuelo caduca:** comparar el SHA medido contra `origin/dev` **justo antes** de abrir el
   PR; otra sesión puede haber empujado, y la **246** está en vuelo con su propia migración.

---

## 17. Despliegue

**Dos commits inertes y un PR.** Orden dentro del PR, y el porqué:

1. **La migración del enum, sola** (obligación técnica, 55P04). **Inerte**: nadie escribe ese valor
   todavía.
2. `lib/types/orden-historial.ts` + `schema.prisma` + el catálogo de transiciones + el inventario.
   Inerte: declarar una arista no la produce.
3. El helper, `rechazarDesdeDevuelta`, el servicio y el borde. A partir de aquí existe la operación,
   pero **nadie puede dispararla**: es el estado en el que la guardia nueva **se pone roja a
   propósito** (R38, «cableado»), así que este commit **no puede quedarse suelto**.
4. La tabla de acciones (la celda que se borra y el productor que se declara), la card y la ventana.
5. La guarda del deshacer y su mensaje.
6. Textos.

**Antes de desplegar**, no antes de mergear: re-medir M1/M2 (la foto de `devuelta` caduca en cuanto
la 239 lleve unos días en producción con volumen).

---

## 18. Consultas de verificación (solo lectura, MCP)

```sql
-- M1 (T0.1) — LA POBLACION DE LA VIA MANUAL: cuantas ordenes vivas hay en `devuelta` hoy, y
-- desde cuando. El denominador va incluido: un cero sin denominador no dice nada.
SELECT os."value" AS estatus, count(*) AS n
FROM "orden" o JOIN "order_status" os ON os."id" = o."estatus_id"
WHERE o."deleted_at" IS NULL
GROUP BY os."value" ORDER BY n DESC;
```

```sql
-- M2 (T0.1) — CUANTO RECHAZA EL CRON POR PLAZO VENCIDO. Junto con M1 dice si el rechazo manual
-- es la via principal o la excepcion, que es lo que decide cuanto pesa D2 y D7.
SELECT date_trunc('month', h."created_at") AS mes, count(*) AS escalados_por_plazo
FROM "orden_historial_estado" h
WHERE h."origen_tipo" = 'escalado_devuelta_sla'
GROUP BY 1 ORDER BY 1 DESC;
```

```sql
-- M3 (T0.1) — 💰 LA CONSULTA QUE DECIDE D2: cuantas ordenes YA pagaron el flete de devolucion
-- DOS VECES (una gestion `devuelta` y una `rechazada`, ambas vigentes y en cierres APROBADOS
-- DISTINTOS). Si esto no es cero, el cobro repetido no es teorico y la ficha aparte se abre hoy.
SELECT count(*) AS ordenes_con_doble_flete
FROM (
  SELECT g."orden_id"
  FROM "gestion_orden" g
  JOIN "cierre_dia" c ON c."id" = g."cierre_id"
  WHERE g."anulada_at" IS NULL AND c."estado" = 'aprobado'
    AND g."resultado" IN ('devuelta','rechazada')
  GROUP BY g."orden_id"
  HAVING count(DISTINCT g."resultado") = 2
     AND count(DISTINCT g."cierre_id") > 1
) t;
```

```sql
-- M4 (T0.1) — 💰 CUANTO CUESTA UN RECHAZO, por sus DOS dueños distintos (§7.1).
-- (a) ingreso de BODEGA, por zona+vehiculo del MENSAJERO:
SELECT min("cobro_rechazado") AS min, max("cobro_rechazado") AS max,
       round(avg("cobro_rechazado"), 2) AS media, count(*) AS tarifas
FROM "tarifa_zona_mensajero";
-- (b) lo que se le DEBITA A LA TIENDA (flete de devolucion + IVA), por tarifa vigente de tienda:
SELECT min("valor_flete_devuelto") AS min, max("valor_flete_devuelto") AS max,
       round(avg("valor_flete_devuelto"), 2) AS media,
       min("valor_flete_devuelto_gam") AS min_gam, max("valor_flete_devuelto_gam") AS max_gam,
       round(avg("iva_flete"), 2) AS iva_medio, count(*) AS tarifas
FROM "tarifas" WHERE "status" = 'activo' AND "deleted_at" IS NULL;
```

```sql
-- M5 (T0.1) — EL AGUJERO HERMANO DE D6: ¿se deshacen hoy las gestiones sinteticas de la tienda?
-- Cuenta las anuladas por familia. `reprogramacion_tienda` > 0 significa que el mensajero ya
-- revirtio decisiones de escritorio de la tienda; esa es la ficha que se propone, no se arregla aqui.
SELECT h."origen_tipo",
       count(*)                                              AS gestiones,
       count(*) FILTER (WHERE g."anulada_at" IS NOT NULL)    AS deshechas
FROM "orden_historial_estado" h
JOIN "gestion_orden" g ON g."id" = h."gestion_orden_id"
WHERE h."origen_tipo" IN ('reprogramacion_tienda','escalado_devuelta_sla','gestion_tienda_ayuda')
GROUP BY 1 ORDER BY 1;
```

```sql
-- M6 (T0.1) — DIMENSIONA D7: cuantas gestiones SINTETICAS ya cayeron en un cierre y, por tanto,
-- pasaron (o pasaran) por la ventana de confirmacion fisica de la 238 pidiendo escanear un
-- paquete que ya estaba en bodega.
SELECT h."origen_tipo",
       count(*) FILTER (WHERE g."cierre_id" IS NOT NULL) AS ya_en_un_cierre,
       count(*) FILTER (WHERE g."cierre_id" IS NULL AND g."anulada_at" IS NULL) AS esperando_cierre
FROM "orden_historial_estado" h
JOIN "gestion_orden" g ON g."id" = h."gestion_orden_id"
WHERE h."origen_tipo" IN ('reprogramacion_tienda','escalado_devuelta_sla')
GROUP BY 1 ORDER BY 1;
```

---

## 19. Documentación que esta feature deja al día

- `progress/auditoria_ayuda_tienda.md` §4 → **cae «Hace lo contrario (1): el punto 12»**, que es la
  última línea de esa sección con dueño; y §3 gana la nota de que la guardia que faltaba ya existe.
  De §4 queda **sólo el desenlace de las no gestionadas**.
- `progress/design_pila_ayuda_tienda.md` §F6 → anotar el aterrizaje con fecha, PR y las respuestas a
  D1-D10. ⚠️ **Y corregir su tercera viñeta**: «se cierra la ficha 228 como superada» — la 228 ya la
  declaró superada la **236** (`specs/236/requirements.md` §«La ficha 228 queda SUPERADA»), así que
  aquí no queda nada que cerrar.
- `app/(app)/novedades/_components/novedad-acciones-catalogo.ts:63-68` → el comentario que declara el
  punto 12 como deuda **con dueño**: se sustituye por lo que pasó, no se borra.
- `app/(app)/novedades/_components/NovedadAcciones.tsx:87-88, 141-143` → el JSDoc de `onDevolver`
  («MAQUETA… ficha 240») y la nota de que el prop conserva el nombre viejo.
- `lib/types/order-status-transiciones.ts:321-325` → «las SIETE salidas de `devuelta` se conservan
  INTACTAS» deja de ser cierto.
- `lib/types/orden-historial.ts` → el valor nuevo con **su razón de NO entrar** en
  `ORIGEN_TIPOS_VISITA_REAL` (§7.3), que es lo que un lector futuro va a querer saber.
- `lib/notificaciones/emitir.ts:134-150` → el párrafo de la 237 gana su hermano (§7.4).
- `tests/components/NovedadesModule.test.tsx:79-81` → el comentario del canal `info` «porque los dos
  botones de MAQUETA avisan por él».
- **Dos fichas propuestas, con su medición delante:** el cobro repetido del flete de devolución (D2,
  M3) y el deshacer de la reprogramación de escritorio (D6, M5). Se registran en `feature_list.json`
  **sólo tras el visto bueno del humano** — el leader las estampa, este spec sólo las declara.
