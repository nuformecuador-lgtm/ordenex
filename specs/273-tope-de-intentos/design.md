# Feature 273 — design

> Cómo se cierra el tope de intentos sin rediseñar el modelo. Todo lo que aquí se afirma sobre el
> código vigente está leído de `dev` el 2026-08-24; lo medido contra producción viene de
> `feature_list.json#273` y de `progress/current.md`, y **no se re-deriva**.

---

## 1 · El problema, y por qué hay que tocar cinco sitios y no uno

La regla es una sola frase: **al alcanzar el umbral, la orden no vuelve a circulación.** Pero
«circulación» tiene cinco entradas, y hoy ninguna la comprueba:

| # | Vía | Qué pasa hoy | Qué la cierra |
| --- | --- | --- | --- |
| 1 | El mensajero gestiona `reprogramada` o `devuelta` en el intento del umbral | se acepta | la puerta en la gestión (§5.1) |
| 2 | La tienda resuelve desde la pestaña de ayuda | se acepta | la misma puerta, en la otra superficie (§5.2) |
| 3 | El cron libera la `reprogramada` cuando llega su fecha | libera **sin mirar el cierre** → contador viejo | la liberación espera la aprobación (§5.3) |
| 4 | Bodega central o satélite asigna la orden | `GuiaAsignacionService` **no mira el contador** | la puerta en la asignación (§5.4) |
| 5 | El corte barre la orden a `sin_gestionar` y la aprobación la devuelve a bodega | vuelve a bodega con el contador agotado | el rechazo en la aprobación (§5.5) |

Y una sexta que no es «volver a circulación» sino «tardar de más en terminar»: la rama
`wrong_number`/`wrong_address` del cron de SLA, que **escala solo por tiempo e ignora el contador**
(§5.6). Es la que dejó a la guía `28098171` con 3 intentos y 89,1 h de 120 esperando.

**La vía 3 es la raíz**, y conviene entender por qué las otras no bastan: aunque se pusiera la
puerta de la asignación (vía 4), la orden llega a bodega **antes** de que su intento se cuente, y en
ese instante la puerta la deja pasar porque el contador todavía dice el valor viejo. Cerrar la vía 4
sin cerrar la 3 es poner un guardia que mira un reloj parado.

---

## 2 · La decisión estructural: qué significa «`reprogramada` espera al cierre»

El humano dictó: *«solo se difiere `reprogramada`, que pasa a esperar la aprobación del cierre igual
que `devuelta`»*. Hay dos formas de cumplirlo y **no cuestan lo mismo**.

### 2.1 · Lo que se hace: diferir el EFECTO, no el estado (opción B)

La orden sigue entrando en `reprogramada` en el acto. Lo que espera a la aprobación del cierre es
**lo único que esa orden puede hacer**: volver a una bodega.

Esto se sostiene sobre un hecho del código vigente, no sobre una opinión: una orden en
`reprogramada` **ya está fuera de circulación**. Las dos únicas escrituras de
`mensajero_asignado_id` la rechazan explícitamente por estado
(`MSG_ORDEN_REPROGRAMADA_BLOQUEADA`, en `GuiaAsignacionService.asignarDesdeBodega` y en
`AsignacionSateliteService.asignar`),
y sus tres únicas salidas declaradas son las dos de `liberacion_reprogramada` (#25/#26) y el
deshacer del mensajero (#32). Así que **diferir la liberación ES diferir el efecto entero**.

Diferencia con la 239, que importa: allí el pre-estado era necesario porque `devuelta` arrastraba
**dos** consecuencias inmediatas que había que congelar —la visibilidad para la tienda y el reloj
del SLA que acaba cobrando—. `reprogramada` no arrastra ninguna de las dos: no es novedad, no corre
ningún reloj y no mueve dinero. Su única consecuencia es el retorno a bodega.

### 2.2 · Lo que NO se hace: un pre-estado `reprogramacion_por_confirmar` (opción A, DESCARTADA)

Era la lectura literal de «igual que `devuelta`»: un `order_status` nuevo, la gestión lo deja ahí y
la aprobación del cierre lo transiciona a `reprogramada`.

**Se descarta por tres razones, en orden de peso:**

1. **Superficie desproporcionada para el mismo efecto observable.** Un `value` nuevo de
   `order_status` obliga —239/R26 lo dejó escrito y su spec necesitó 35 requisitos para esto— a
   clasificarlo en *todas* las superficies que enumeran estados: etiqueta y badge, hito del rastreo
   público, política de eventos de webhook, filtros por rol (`exclude-por-rol.ts`), listado de la
   bodega satélite, buckets del tablero del día, tabla de estados esperados del deshacer, mapa de
   transiciones, seed y migración con su `down.sql`. Todo eso para conseguir exactamente lo mismo
   que una condición en el `WHERE` del cron.
2. **Rompe algo que hoy funciona: la reprogramación de escritorio de la tienda.** `devuelta ->
   reprogramada` (#22, `reprogramacion_tienda`, feature 100) crea una gestión **sintética** que
   **no cuenta como intento** (no está en `ORIGEN_TIPOS_VISITA_REAL`). Con un pre-estado, esa
   reprogramación quedaría congelada hasta que alguien apruebe el siguiente cierre de un mensajero
   —retraso medido mediana 8,2 h, p90 22,1 h, máx 48,2 h— **sin ganar nada**, porque su contador ya
   estaba al día. Se pagaría latencia por un invariante que en esa vía ya se cumple.
3. **La restricción de la ficha lo prohíbe:** «arregla lo evidenciado; no rediseñes el modelo». Lo
   evidenciado es literalmente *«`findOrdenesLiberables` selecciona por estado y fecha sin mirar el
   cierre en ningún punto»*. Eso se arregla mirando el cierre.

**Coste declarado de la opción B, para que no se descubra después:** durante la espera, la orden se
ve en las pantallas como `reprogramada` con su fecha ya vencida y no se mueve. No es un estado
nuevo que explique la espera. Se acepta a cambio de no abrir diez superficies; si algún día duele,
la salida es reabrir esta decisión, no colar una excepción en el cron.

---

## 3 · Modelo de datos

### 3.1 · Lo que NO se toca (y es la mitad del diseño)

- **Ninguna tabla nueva.** Ninguna columna nueva. En particular **no** existe ni existirá una
  columna «estado de intentos» / «tope alcanzado»: sería una segunda verdad junto a
  `contarIntentosVigentes`, y las dos divergirían el día que alguien anule una gestión.
- **Ningún `order_status` nuevo** (consecuencia directa de §2.1).
- **`whereIntentosVigentes` no se toca** (R33). Ni su lista de resultados, ni la de familias de
  visita real, ni el ancla `cierre.estado = 'aprobado'`, ni el `groupBy(["cierreId"])`.
- **RLS:** no hay tabla nueva, así que no hay política nueva. Las lecturas de conteo que se añaden
  van por Prisma en el servidor, dentro de servicios que ya autorizan por rol.

### 3.2 · Lo único que cambia en la base: un valor de enum

`orden_historial_origen_tipo` gana **un** valor: `rechazo_tope_intentos` (Q5), productor único el
bloque de la aprobación del cierre (§5.5). Precedentes exactos de forma y de convención:
`20260819110000_orden_historial_origen_anclaje_devolucion` (239) y
`20260820120000_orden_historial_origen_gestion_tienda_ayuda` (237).

Reglas que arrastra, todas ya escritas en `lib/types/orden-historial.ts`:

- Entra en `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED` **con su productor en el mismo commit** (la convención
  que la 154 rompió y costó el tren 154+155+156).
- **NO** entra en `ORIGEN_TIPOS_VISITA_REAL`: no es una visita; contarla subiría el número y
  cobraría de más.
- **NO** entra en `ORIGEN_TIPOS_CON_GESTION` aunque su fila nazca con `gestion_orden_id` poblado —
  mismo caso que `escalado_devuelta_sla` y `anclaje_devolucion`.
- **NO** entra en `ORIGENES_SIN_EVENTO_PUBLICO`: el integrador recibe `rechazada` como siempre.

⚠️ **Migración: los `down.sql` previos no se tocan** (son fotos históricas). Antes de escribir el
`down.sql` de ésta hay que **mirar cómo lo hace el `down` del propio enum en las dos migraciones
citadas** —si recrea el tipo con la lista o solo elimina— y copiar esa forma, no inventar una. Es
la trampa que ya mordió en este repo.

### 3.3 · Migración: qué NO hace

No mueve ninguna orden (R35). No hay backfill (decisión del humano). La única orden viva medida en
el umbral escala sola por el cron de SLA, ahora además sin esperar sus 5 días (§5.6).

---

## 4 · El punto único de la regla: `lib/types/tope-intentos.ts`

Módulo **puro** (sin Prisma en runtime, sin servicios, sin `next/*`), importable desde un Client
Component igual que `lib/types/gestion-destino.ts`. Contiene la regla entera y **nada más**:

```ts
/** R3 — lista de INCLUSION de lo que se puede registrar en el intento del umbral. */
export const RESULTADOS_PERMITIDOS_EN_EL_TOPE = [
  "entregada",
  "rechazada",
  "incidente",
] as const satisfies readonly GestionResultado[];

/** R1 — `true` si la gestión que se registre AHORA es la que alcanza el umbral (o ya lo pasó). */
export function alcanzaElTope(intentosVigentes: number, umbral: number): boolean;

/** R1/R3 — `true` si ese resultado se admite estando en el tope. */
export function permitidoEnElTope(resultado: GestionResultado): boolean;
```

Tres propiedades que son requisitos, no gustos:

- **Lista de INCLUSIÓN, jamás de exclusión.** Con lista negra, un `resultado` futuro del enum
  quedaría admitido solo y podría devolver la orden a circulación en silencio. Con lista blanca, lo
  que hace un resultado nuevo por defecto es **quedar bloqueado en el tope**, que es la dirección
  segura. Es el mismo argumento —y la misma forma— que `RESULTADOS_QUE_CUENTAN_COMO_INTENTO`.
- **`satisfies readonly GestionResultado[]`**: si el enum pierde un valor, no compila.
- **El umbral NO vive aquí**: entra como parámetro. Así el módulo puede cruzar al cliente sin
  llevarse la configuración con él (160/R20, que tiene test de contrato:
  `tests/unit/components/intentos-entrega.test.tsx` falla si un componente nombra
  `MIN_INTENTOS_ENTREGA`).

`alcanzaElTope` es `intentosVigentes >= umbral - 1`. Con `>=` y no `===` a propósito: los datos
heredados pueden estar por encima del umbral y esos también tienen que quedar bloqueados.

---

## 5 · Superficie por superficie: contratos de entrada y salida

### 5.1 · El panel del mensajero — `MisAsignacionesService.gestionar`

**Dónde va la guarda:** junto a las otras dos guardas «previsibles» del método —el bloqueo por
cierres (111/271) y la reserva para otro día (261)—, es decir **antes** de subir evidencia a Storage
y antes de abrir la transacción. Ése es el orden que garantiza R5 (sin fotos huérfanas, sin fila,
sin transición).

**Dependencia:** el servicio ya recibe `historial: Pick<IOrdenHistorialService,
"contarIntentosEnLote">`. Se **ensancha el `Pick`** a `| "contarIntentos"`. No hay dep nueva ni
riesgo de cableado olvidado.

**Contrato de salida:** `{ status: "conflict", motivo: MSG_TOPE_INTENTOS }` — `conflict` y no
`validation_error` porque no es un campo mal escrito: es el estado del mundo. Mismo molde que
`RESERVA_MOTIVO_SERVIDOR`.

### 5.2 · La pestaña de ayuda de la tienda — `GestionDesdeAyudaService.gestionar`

Mismo predicado, mismo texto, otro actor. Va en el **paso 5-ter**, inmediatamente después de la
guarda de reserva por día y **antes** de `subirEvidenciasCompensadas`, por el motivo que ese
servicio ya tiene escrito para el paso 3: *«un rechazo previsible pertenece ANTES del upload»*.

**Dependencia nueva y OBLIGATORIA** en `GestionDesdeAyudaDeps`:
`historial: Pick<IOrdenHistorialService, "contarIntentos">`. Obligatoria a propósito: opcional, un
composition root que se la olvide desactiva la puerta en silencio sobre la operación más delicada en
dinero de la pila de la ayuda. Con obligatoria, olvidarla es un rojo de `pnpm typecheck`. **El test
tiene que comprobar que el composition root la PASA, no que la importa.**

Consecuencia para la tienda: desde ayuda solo hay dos desenlaces (`reprogramada`, `rechazada`), así
que en el tope le queda **solo `rechazada`**. Es coherente: `incidente` no tiene productor desde
`ayuda_tienda` y el diseño firmado de la 237 no se lo concede.

### 5.3 · El cron de liberación — `LiberacionReprogramada*`

**La regla, en una frase:** una orden se libera cuando su gestión `reprogramada` vigente más
reciente **ya no puede subir el contador**.

Una gestión puede subir el contador ⇔ nace de una **visita real** Y **no** está en un cierre
aprobado. Y ese «⇔» no es una definición nueva: son dos de las seis condiciones del predicado
existente, aplicadas a una sola gestión.

**Reparto de responsabilidades (`docs/architecture.md`):**

- **Repositorio** (`findOrdenesLiberables`): trae los HECHOS. Al `select` de la gestión más reciente
  se le añaden `cierreId`, `cierre: { select: { estado: true } }` y una sonda de visita real
  —`historialEstados: { where: { origenTipo: { in: ORIGEN_TIPOS_VISITA_REAL } }, take: 1, select:
  { id: true } }`, array vacío o con un elemento—. **Sin decidir nada.** Conserva intacto su filtro
  por fecha y su `orderBy`/`take: 1`.
- **Servicio** (`ejecutarLiberacion`): aplica la regla y cuenta las que quedan esperando. El
  `LiberacionResult` gana un contador `esperandoCierre` (agregado, sin PII), que es lo que hace
  observable la población congelada de la que habla el «Riesgo declarado» de requirements.

**Por qué la decisión en el servicio y no en el `WHERE`:** porque es una regla de negocio y porque
así la prueban dobles sin base. Pero eso **no basta**, y en este repo está medido: un test de
servicio con dobles no ve el SQL, y una mutación del `WHERE`/`select` del repositorio los pasa en
verde. Por eso §T de tasks exige **además** un test de integración contra Postgres real sobre
`findOrdenesLiberables` (que traiga los tres hechos nuevos, y que el `take: 1` siga eligiendo la
gestión correcta).

**Idempotencia:** intacta. La guarda `estatusId = reprogramada` del `updateMany` sigue siendo la que
gana las carreras; esta feature solo reduce el conjunto de candidatas.

### 5.4 · La asignación — `GuiaAsignacionService.asignarDesdeBodega` y `AsignacionSateliteService.asignar`

Guarda por lote, **antes de cualquier escritura**, con el mismo contrato todo-o-nada y el mismo
`detalle` por orden que las guardas vecinas (mensajero bloqueado por cierres, dedicación,
coordenadas). Se resuelve con **una sola consulta**: `contarIntentosVigentesEnLote(ordenIds)` — el
método de la 215 que existe exactamente para no hacer N+1 en un listado.

- Dependencia nueva y **obligatoria** en los dos servicios:
  `Pick<IOrdenHistorialService, "contarIntentosEnLote">`, por `import type` (sin ciclo de módulos,
  patrón `MisAsignacionesService`).
- Motivo único en `lib/services/mensajes-bloqueo.ts` (donde ya viven
  `MSG_MENSAJERO_BLOQUEADO_POR_CIERRES` y `MSG_ORDEN_REPROGRAMADA_BLOQUEADA`), no dos literales
  gemelos. R20.
- **Dónde en el orden de guardas:** después de la validación por orden (existencia/estado/zona) y
  antes del gate de coordenadas. Motivo: el rechazo por tope es definitivo y el de coordenadas es
  corregible; enseñar primero el que no tiene arreglo evita que alguien capture coordenadas para
  una orden que no se va a asignar igual.
- `asignarRecoleccion` **queda fuera**: recolectar en tienda no es un intento de entrega y una orden
  en `por_recolectar_en_tienda` tiene cero intentos. `deshacer_gestion` también queda fuera: repone
  una asignación que ya existía, no crea una nueva, y bloquearlo dejaría la orden atrapada.

### 5.5 · La aprobación del cierre — `CierresAdminRepository.resolverCierre`

Aquí vive la decisión que absorbe la ficha **218**. El bloque de liberación de `sin_gestionar`
(feature 109, ya acotado a **este** cierre por la 271/R35 vía `cierre_sin_gestion`) se parte en dos
destinos:

```
órdenes sin_gestionar de ESTE cierre
  ├─ intentos < umbral  → en_bodega_central / en_bodega_satelite   (109, sin cambios)
  └─ intentos >= umbral → rechazada                                 (nuevo)
```

**El conteo se hace DENTRO de la transacción**, reusando `whereIntentosVigentes` sobre
`tx.gestionOrden.groupBy` (el `Pick` del cliente ya expone `gestionOrden`). No se calcula antes de
abrir la tx: entre la lectura y la escritura otra aprobación puede subir el contador, y el número
que decide tiene que ser el que ve la propia transacción. El **umbral** llega inyectado desde el
servicio dentro de la config `liberacionSinGestionar` —la regla de negocio y la configuración
siguen viviendo en el servicio (R7)—.

*Nota de corrección, no de estilo:* el `updateMany` del propio cierre ya se ejecutó cuando llega
este bloque, así que dentro de la tx **este** cierre ya está `aprobado`. Da igual para el caso: una
orden barrida a `sin_gestionar` no puede tener una gestión vigente en el cierre que la barrió (para
ser barrida tuvo que estar en `en_reparto`/`ayuda_tienda`, es decir sin desenlace registrado, y una
gestión deshecha lleva `anulada_at` y no cuenta). Hay que **probarlo**, no confiarlo: es una de las
aserciones de la prueba de integración.

**Lo que escribe la rama nueva, y en qué orden:**

1. `updateMany` guardado por `{ id IN ids, estatusId = sin_gestionar, deletedAt: null }` →
   `estatusId = rechazada`. `data` con **una sola clave**: no limpia mensajero, ni `asignado_at`, ni
   `fecha_reparto`, ni enciende `prioridad`. Diferencia deliberada con la liberación de al lado,
   que sí los limpia porque su orden va a re-reparto; ésta no vuelve a repartirse.
2. Gestión sintética `resultado = rechazada`, `cierre_id NULL`, `mensajero_id` = el del cierre,
   `motivo` fijo sin PII (R23/R38, pendiente de **Q1**).
3. `appendCambioEstado` por el choke point, actor = el admin que aprobó, `origen_tipo =
   rechazo_tope_intentos`, enlazando la gestión (R22).

**Efecto de segundo orden, buscado y que hay que declarar:** el bloque de la feature 139 corre
inmediatamente después en la misma transacción y selecciona por `{ mensajeroAsignadoId =
cierre.mensajeroId, estatusId = rechazada }`. Como el paso 1 **conserva** el mensajero, la orden
sale de la transacción ya en `por_devolver` / `por_devolver_a_tienda`, con su fila de historial
`devolucion_rechazada`. Es el destino correcto —el paquete vuelve a la tienda— y **no hace falta
código nuevo para conseguirlo**. Si el paso 1 limpiara el mensajero, la orden se quedaría en
`rechazada` sin nadie que la moviera de ahí.

**Transición nueva a declarar** en `lib/types/order-status-transiciones.ts`:
`sin_gestionar -> rechazada`, `via: "rechazo_tope_intentos"`, `rol: "admin (aprobar cierre)"`. Sin
ella, el choke point (140) rechaza la escritura y **revierte la aprobación entera**. Las cifras del
inventario se **re-derivan** en `tests/fixtures/inventario-transiciones-140.ts`, no se copian.

**Idempotencia (R26):** por construcción y sin código de idempotencia, igual que los otros cuatro
bloques de esa transacción: todo vive dentro de `res.count === 1 && aprobado`, y el `updateMany` del
cierre está guardado por `estado IN ["solicitado"]`. Una segunda aprobación no entra.

**Rechazo del cierre (R27):** el bloque vive dentro de la rama `aprobado`. Un rechazo no lo ejecuta,
igual que no ejecuta la liberación ni el anclaje.

### 5.6 · El cron de SLA — `DevolucionSlaService`

Dos cambios, y el segundo es una consecuencia del primero:

1. **La rama `wrong_number`/`wrong_address` consulta el contador** (R28): con `intentos >= umbral`
   escala a `rechazada` sin esperar la ventana de 5 días; por debajo del umbral, la ventana se
   aplica exactamente como hoy (R29).
2. **El conteo pasa a ser por lote, una vez por corrida** (`contarIntentosVigentesEnLote` sobre las
   candidatas), y las **dos** ramas leen del mismo `Map`. Si no, la rama `not_found` seguiría
   contando de a una dentro del bucle y habría **dos formas** de obtener el mismo número en el mismo
   servicio: la clase exacta de divergencia que la 215/R4 existe para impedir. De paso quita el N+1.

**Por qué la rama `wrong_*` pasa a mirar el contador — la justificación que la ficha pide:**

- **No cambia QUÉ pasa, solo CUÁNDO.** Esa rama **ya escala a `rechazada` de forma incondicional**
  al vencer sus 5 días (`DevolucionSlaService:159-164`). Consultar el contador no puede producir un
  desenlace distinto del que la orden iba a tener: adelanta hasta 5 días el mismo desenlace.
- **Con el tope puesto, esos 5 días dejan de poder producir algo útil.** Su función era darle a la
  tienda tiempo de corregir la dirección y reprogramar. Pero una orden en el umbral que se
  reprograme acaba en bodega y **R18 le niega la asignación**: la corrección ya no puede ejecutarse.
  Son 5 días de mercadería parada a cambio de una salida que el propio tope acaba de cerrar.
- **La dirección del error queda escrita:** es la primera vez que este sistema *adelanta* un cobro.
  Lo que lo hace aceptable es que el cobro es el mismo y era seguro; lo que lo hace peligroso es que
  depende del contador. Por eso R33 congela el criterio de conteo en esta ficha.

**Alternativa descartada aquí:** dejar la rama `wrong_*` intacta y cerrar el callejón bloqueando la
reprogramación de la tienda (Q2). Se descarta como **solución principal** porque no ataca lo medido
—la guía `28098171` lleva 89,1 h de 120 esperando un desenlace que ya está decidido— y porque deja
la mercadería parada igual. Q2 sigue abierta como medida **complementaria**, no sustitutiva.

---

## 6 · Contratos hacia el cliente

### 6.1 · El dato derivado (R10)

Ni el umbral ni la configuración cruzan al navegador. Cruza **una decisión ya tomada**:

- `MiAsignacionDTO` (`lib/interfaces/services/IMisAsignacionesService.ts`) gana
  `enElTope?: boolean` — opcional por el patrón aditivo del repo; el servicio **siempre** lo envía.
- El DTO de la pestaña de ayuda (`lib/types/novedad.ts`, que ya lleva `intentosEntrega`) gana el
  mismo campo con el mismo nombre.

Los dos se calculan en el servidor con `alcanzaElTope(intentosEntrega, reintentosConfig.MIN_INTENTOS_ENTREGA)`.

### 6.2 · Lo que hace la UI, y lo que no

- `GestionarOrdenPanel.tsx`: con `enElTope`, la grilla de desenlaces se filtra por
  `permitidoEnElTope` — importado del **mismo módulo puro** que usa el servidor, para que UI y
  guarda no puedan divergir— y aparece un texto que explica que a esta orden le queda el último
  intento y qué se puede registrar. «Reportar incidente» **sigue visible**: decisión 3 del humano,
  no es un desenlace de entrega.
- `GestionarDesdeAyudaModal.tsx`: idem; en el tope le queda «Rechazar».
- La UI **no decide nada**: si llegara una petición con un resultado prohibido, el servidor la
  rechaza igual (R11). El filtro de botones es cortesía, no seguridad.

### 6.3 · Rutas y endpoints

**Ninguna ruta nueva, ningún endpoint nuevo.** Las superficies tocadas son Server Actions ya
existentes (`lib/actions/gestion-desde-ayuda.ts`, las de asignación y la de gestión del mensajero) y
dos route handlers de cron que ya existen (`/api/cron/liberar-reprogramadas`,
`/api/cron/procesar-devueltas-sla`), cuyos contratos de respuesta solo ganan contadores agregados.

### 6.4 · Integraciones

- **Webhook:** ningún `value` nuevo en el vocabulario público. El integrador recibe `rechazada`, que
  ya maneja. **No hay cambio de contrato** y por tanto **no hay aviso a integradores que bloquee la
  release** (a diferencia de 239/P2 y 268/T8). Lo único observable para ellos es que algunas órdenes
  llegan a `rechazada` antes que antes.
- Supabase Storage, Meta, WhatsApp: sin cambios.

---

## 7 · Las guardas existentes que rozan esto, y qué pasa con cada una

| Guarda existente | Qué podría chocar | Resolución |
| --- | --- | --- |
| **Choke point `appendCambioEstado` (140)** | rechaza cualquier par `(origen, destino)` no declarado y revierte la tx | la arista `sin_gestionar -> rechazada` se declara **en el mismo commit** que su productor (§5.5). Sin esto, aprobar un cierre con una orden en el tope falla entero. |
| **Ventana de deshacer (67): muere con `gestion.cierre_id != null`** | con la liberación diferida, la orden pasa más tiempo en `reprogramada` | **no cambia nada**: la ventana ya dependía del cierre, no del estado. Mientras la gestión no esté en un cierre, se deshace (R17); en cuanto entra, no — igual que hoy. |
| **`ESTADOS_ESPERADOS` del deshacer (`CierreDiaService:122`)** | tabla `resultado -> estados válidos` | `reprogramada: ["reprogramada"]` **sigue siendo correcto**: con la opción B la orden no cambia de estado. Si se hubiera elegido la opción A, habría que haber tocado esta tabla, y olvidarlo era una regresión silenciosa (le pasó a la 239, ver su T1.5). |
| **Idempotencia de los crons** | dos crons ahora leen el contador | ninguno de los dos cambia su mecanismo: siguen guardados por `estatus_id` en el `updateMany`. Lo que cambia es el conjunto de candidatas. |
| **Guarda de bloqueo por cierres (111/271)** | el mensajero bloqueado no puede gestionar | ortogonal. Se conserva **antes** que la del tope: primero «no puedes gestionar nada», después «esta orden solo admite tres desenlaces». |
| **`MSG_ORDEN_REPROGRAMADA_BLOQUEADA`** | ya impide asignar una `reprogramada` | se conserva intacto y se comprueba **antes** que el tope: es más específico y más informativo. |
| **Aserciones de orden de `cierres-admin-caja-cod.test.ts`** | miden el orden de las llamadas dentro de la tx de aprobación, porque los feeds de dinero se leen unos a otros | la rama nueva vive **dentro** del bloque `sin_gestionar` que ya existe, en su misma posición: después de los cinco feeds y antes de la devolución de las `rechazada` (139). **Ningún feed se mueve.** Un rojo ahí es **regresión**, no una aserción que se actualiza. |

---

## 8 · Alternativas descartadas (además de la de §2.2 y la de §5.6)

**C · Contar el intento en el instante de la gestión (revertir el ancla de la 215).**
Resolvería el desfase de raíz: si el intento cuenta al gestionar, el contador nunca va por detrás.
Se descarta porque (i) invierte una decisión firmada y medida (D14, 2026-08-13/14) y esta ficha no
tiene mandato para eso; (ii) subiría el número de casi toda orden, adelantando escalados y cobros —
exactamente el daño que la 215 evitó—; y (iii) el radio de impacto es todo lo que consume el
contador (cron de SLA, drawer, badge, listados), frente a un `WHERE` en un cron.

**D · Poner solo la puerta de la asignación (vía 4) y no tocar el cron.**
Es la tentación barata: una guarda, dos servicios, cero migraciones. **No cierra nada**, y la razón
está en §1: la orden llega a bodega antes de que su intento se cuente, así que la puerta la deja
pasar con el contador viejo. Es el mismo error de leer un reloj parado.

**E · Marcar la orden con una columna `tope_alcanzado` al aprobar el cierre.**
Haría la lectura barata en todas las puertas. Se descarta por la restricción explícita de la ficha
(nada de columnas nuevas de estado de intentos) y porque crea una **segunda verdad**: el día que se
anule una gestión, la columna diría «tope» y el contador diría «no». La 239 ya pagó ese precio con
`gestion_aprobada` y lo retiró.

**F · Bloquear también el deshacer y la recuperación manual.**
Descartado: los dos son movimientos correctivos o físicos, no salidas a reparto, y bloquearlos
convierte una orden en el tope en una orden que nadie puede tocar. Ver Q3.

---

## 9 · Carreras y direcciones de error

1. **Aprobación de un cierre mientras el mensajero gestiona.** El contador que lee la puerta (§5.1)
   podría subir justo después. Dirección: la puerta **deja pasar** una gestión que un instante
   después estaría prohibida. Consecuencia máxima: un intento de más, que es exactamente el
   comportamiento de hoy y no cobra nada de más. Aceptada.
2. **Aprobación concurrente durante la corrida del cron de SLA.** Con el conteo por lote al inicio
   de la corrida, el número puede ser levemente antiguo. Dirección: **no escala**, o sea no cobra.
   Aceptada y declarada.
3. **Aprobación de dos cierres del mismo mensajero en paralelo (posible desde la 271).** El bloque
   de §5.5 está acotado a **este** cierre por `cierre_sin_gestion` (271/R35), así que cada
   aprobación decide solo sobre lo suyo. La orden barrida por el cierre A no la toca la aprobación
   del cierre B.
4. **Cierre `rechazado` que nadie re-solicita.** La orden `reprogramada` queda congelada. Válvula:
   `forzarSolicitudVencido` (`ESTADOS_REABRIBLES = ["vencido","rechazado"]`). Declarado en
   requirements como riesgo aceptado.

---

## 10 · Rendimiento

- Asignación: **+1 consulta por lote** (`groupBy`, no N+1). Techo medido de un lote de asignación:
  decenas de órdenes.
- Gestión: **+1 consulta** por gestión, sobre una ruta que ya hace subida de fotos y una
  transacción. Despreciable.
- Cron de liberación: el `select` de la gestión gana dos joins pequeños (`cierre` y una sonda
  `take: 1` sobre `orden_historial_estado`). La sonda se apoya en el mismo truco de índice que
  documenta `whereIntentosVigentes` (repetir el filtro por `orden_id` para entrar por
  `@@index([ordenId, createdAt])`, porque `gestion_orden_id` **no** tiene índice). Si el plan lo
  pidiera, **se para y se lleva al humano**: 215/D7 prohíbe la migración de índice.
- Cron de SLA: de N consultas de conteo a **1** por corrida.
- Aprobación del cierre: **+1 `groupBy`** dentro de la transacción más cara del sistema, solo cuando
  el cierre trae órdenes barridas. Techo medido de gestiones por cierre: 14.

---

## 11 · Orden de implementación y de despliegue

1. **Medir primero** (R37, y es bloqueante): SELECT de solo lectura contra producción con el
   predicado de intentos, agrupando por estado, para saber cuántas órdenes vivas están ya en el
   umbral y **dónde**. Si aparecen fuera de `devuelta`, se para (**Q6**).
2. El módulo puro y el enum/migración antes que sus consumidores.
3. Las cinco puertas pueden ir en paralelo entre sí; la de la aprobación (§5.5) es la única que
   necesita la migración dentro.
4. **Gate completo obligatorio**: el diff toca `db/migrations/`, `lib/types/` y archivos con nombre
   de dinero. `./init.sh --rapido` se niega solo, y es un `fail`.

---

## 12 · Límites conocidos de este diseño

- Una orden en el tope que llegue a bodega por `recuperacion_manual` (Q3) queda **inasignable**: la
  puerta de §5.4 la rechaza y el paquete se queda en el estante hasta que alguien lo devuelva a la
  tienda por otra vía. Es el precio de poner la última puerta donde se pone.
- La espera de §5.3 no se explica en pantalla: la orden se ve `reprogramada` con fecha vencida y
  quieta (§2.2, coste declarado).
- El contador **puede contar de menos** y esta ficha no lo arregla: medido el 2026-08-24 sobre la
  guía `53521827`, cuatro gestiones contables no anuladas cuentan **2** (dos cuelgan del mismo
  cierre —grano por cierre, 215/R29— y una `reprogramada` no tiene visita real enlazada). Contar de
  menos ahora significa **una puerta que se abre cuando debería estar cerrada**, no solo un escalado
  retrasado. Va a ficha aparte porque tocar el criterio es lo que R33 prohíbe aquí; pero queda
  escrito que el riesgo cambió de naturaleza con esta ficha.
