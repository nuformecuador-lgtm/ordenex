# Feature 261 — Diseño

> Lee `requirements.md` antes que esto. Aquí sólo van las **decisiones**, con lo que se descartó y
> por qué. Todo lo que se afirma como «medido» se leyó en el árbol; la línea concreta está citada.

---

## 1 · Alcance

| Entra | No entra |
| --- | --- |
| Bloquear **recoger**, **escoger para gestión** y **gestionar** una orden reservada para un día posterior | El **corte diario** (ya filtra bien: `CorteDiarioRepository.ts:88`, `CierreDiaRepository.ts:554-556`) |
| Bloquear que **la tienda** resuelva desde la pestaña de ayuda (decisión P2, 2026-08-22) | El estampado de día en las **vías de asignación** (246/T3.3, correcto) |
| Que **deshacer una gestión** conserve una reserva **futura** | **Corregir** el día de una orden ya asignada → **ficha 262** (§7.2) |
| El texto que el mensajero y la tienda leen cuando la orden no es accionable | Cualquier **migración**: no hay ninguna (R23) |
| Escribir la **reversión de D5** en sus dos soportes, con guardia | Un **backfill** de las órdenes heredadas (§7.1) |

**Sin migración, sin backfill.** La columna existe desde la 246 y no cambia de tipo, de nulabilidad ni
de índice. Esta ficha sólo cambia **quién la lee** y **cómo se escribe en una vía**.

---

## 2 · MEDICIÓN — ¿`startOfDayCR` es correcta en el camino de la anulación, o es una segunda trampa horaria?

**Veredicto: es CORRECTA ahí. No es una segunda trampa. Pero en esa misma línea hay OTRO defecto,
distinto, y sí hay que arreglarlo.**

### 2.1 · Por qué es correcta (las cuatro lecturas que lo demuestran)

| # | Dónde | Qué dice |
| --- | --- | --- |
| 1 | `db/schema.prisma:511` | `fechaReparto DateTime? @map("fecha_reparto") @db.Date` — es una **fecha**, no un instante. |
| 2 | `lib/utils/fecha-cr.ts:14-30` | `startOfDayCR` devuelve «la medianoche UTC de la fecha CALENDARIO de Costa Rica», que es **la convención `@db.Date` del repo (feature 46)**, y lista a `orden.fecha_reparto` entre sus consumidores **por nombre**. |
| 3 | `lib/utils/dia-reparto.ts:19-32` | `resolverFechaReparto` —el único traductor de «hoy/mañana» a fecha— usa **`startOfDayCR`** y advierte con todas sus letras que `inicioDelDiaCREnUtc` (06:00Z) **NO sirve** para esta columna. |
| 4 | `lib/repositories/CierreDiaRepository.ts:19-23` | La cabecera del import ya lo declara: «`startOfDayCR` es el helper de la convención `@db.Date`, la misma que usa `fecha_reparto`; `inicioDelDiaCREnUtc` es la de las columnas `timestamp` y aquí desplazaría el día seis horas». |

### 2.2 · Por qué la guardia de la 192/259 lo prohíbe allí y no aquí

`tests/unit/tablero-dia/frontera.guardia.test.ts`, cláusula **(a)** (R17), prohíbe `startOfDayCR` en
el árbol del tablero. **Su propio mensaje de fallo dice por qué**, y el porqué es específico:

> «usarla como **inicio del día** convierte la **ventana** en 18:00-18:00 CR y una orden asignada a
> las 00:30 CR se contaría en el día anterior. La ventana de esta feature la calcula
> `lib/utils/ventana-dia-cr.ts`.»

Es decir: la prohibición es sobre usarla como **cota de una ventana contra columnas `timestamp`**
(`asignado_at`, `gestion_orden.created_at`). El árbol del tablero no escribe ninguna columna
`@db.Date`. **La anulación no calcula ninguna ventana: escribe una columna `DATE`.** Son dos trabajos
distintos con dos helpers distintos, y el repo ya tiene la trampa nombrada en los dos sentidos
(`fecha-cr.ts:27-29` y `fecha-cr.ts:108-116`).

**Conclusión que el implementer NO debe re-litigar:** no se sustituye el helper. Cambiarlo por
`inicioDelDiaCREnUtc` metería el off-by-one de seis horas que cerró la ficha 166 — por la otra puerta.

### 2.3 · El defecto que SÍ está en esa línea, y no es horario

`CierreDiaRepository.ts:912` llama **`startOfDayCR()` sin argumento**: el repositorio **lee el reloj
del proceso**. Eso choca de frente con la doctrina que la propia 246 escribió tres archivos más allá
(`dia-reparto.ts:25-28`: «`now` es un PARÁMETRO con default: el reloj se inyecta en los tests y jamás
se lee dentro del cálculo»), y tiene dos consecuencias concretas:

1. **No se puede probar** «deshacer a las 23:59 del 21» sin falsear el reloj global del proceso.
2. `CierreDiaService.deshacerGestion(gestionId, actor)` **no tiene `now`** (medido:
   `CierreDiaService.ts:561`), así que ni siquiera hay dónde inyectarlo.

→ **D3** lo corrige: el **servicio** resuelve el día y se lo pasa al repositorio ya resuelto, que es
exactamente el reparto que `dia-reparto.ts` describe para las dos vías de asignación. Tras eso,
`CierreDiaRepository` **deja de importar `startOfDayCR`**: ningún repositorio vuelve a leer el reloj
para decidir un día de reparto.

---

## 3 · D1 — Dónde va la puerta: **dos puertas, y una tercera declarada como ausente**

### Puerta A — el SERVICIO (`MisAsignacionesService`). Es la que responde.

Las tres operaciones (`recogerAsignaciones`, `escogerParaGestion`, `gestionar`) ganan la misma guarda,
en el mismo sitio donde ya viven **todas sus hermanas**: rol, propiedad, orden borrada, estado de
origen, bloqueo por cierre pendiente y `monto == montoCobrar`. No se inventa una capa.

- **Resultado: `conflict`, no `forbidden`.** La orden **sí** es suya; lo que falla es el momento. El
  repo ya usa esa distinción en este mismo servicio (`forbidden` = ajena o inexistente; `conflict` =
  estado/origen/bloqueo).
- **Posición dentro del método: antes de cualquier efecto.** En `gestionar`, la guarda va junto a la
  del cierre pendiente, **antes de subir la evidencia a Storage** — el comentario que hay ahí
  (`MisAsignacionesService.ts:420-431`) explica que ese orden es el que garantiza «ni upload, ni
  transición, ni fila `gestion_orden`». Es literalmente **R4**.

### Puerta B — el `WHERE` de la ESCRITURA de recoger (`recogerLote`). Es la que gana las carreras.

`GestionOrdenRepository.recogerLote` (línea 527) es un `UPDATE` crudo con `RETURNING id` dentro de una
transacción, y su `WHERE` **ya lleva** propiedad + origen + no-borrada. El día pertenece a esa misma
familia y entra ahí:

```sql
UPDATE "orden"
SET "estatus_id" = ${destinoEstatusId},
    "updated_at" = NOW()
WHERE "id" IN (${Prisma.join(ordenIds)})
  AND "mensajero_asignado_id" = ${mensajeroId}
  AND "estatus_id" = ${origenEstatusId}
  AND "deleted_at" IS NULL
  AND ("fecha_reparto" IS NULL OR "fecha_reparto" <= ${fechaRepartoComoTexto(diaEnCurso)}::date)
RETURNING "id"
```

Tres cosas, ninguna decorativa:

1. **El predicado es COPIADO, no reinventado.** `(IS NULL OR <= dia)` es exactamente el del corte
   (`CorteDiarioRepository.ts:88` y `CierreDiaRepository.ts:554-556`). Dos formas distintas de la
   misma pregunta acaban midiendo cosas distintas; ya pasó en este repo.
2. **El día entra como TEXTO `YYYY-MM-DD` con `::date` explícito**, vía `fechaRepartoComoTexto`. El
   porqué está escrito en `dia-reparto.ts:36-52` y no es teórico: el driver `pg` serializa un `Date`
   de JS como `timestamptz` y Postgres lo convierte a `date` con el **`TimeZone` de la sesión** — o
   sea, el día dependería de la configuración del servidor de base de datos.
3. **`RETURNING id` ya existe**, así que el `appendCambioEstado` y el encolado de reoptimización
   cubren exactamente las órdenes que ganaron la guarda. Una orden reservada **no deja rastro**.

### Puerta ausente, declarada con nombre: la escritura de la gestión

**Medido:** `GestionOrdenRepository.crearGestionYTransicionar` (línea 583) hace
`tx.orden.update({ where: { id: ordenId }, data: { estatusId } })`. Su `WHERE` **no re-comprueba
nada** — ni siquiera el estatus de origen. Las siete guardas de gestionar viven todas en el servicio.

**Esta ficha NO le añade una puerta sólo para el día**, por tres razones:

- Sería **la única de siete condiciones** re-comprobada en la escritura: quien lea el `WHERE`
  concluiría que las otras seis ya están cubiertas ahí, y no lo están.
- `update` lanza si afecta 0 filas; `updateMany` no. Cambiar la forma altera la semántica de fallo
  **dentro de la transacción que crea la fila de dinero** (`gestion_orden` + `gestion_orden_pago`).
  Es riesgo real por una carrera que **no puede ocurrir** (ver el punto siguiente).
- **La carrera no existe por construcción.** Para gestionar hay que estar en `en_reparto`. Las
  entradas a ese estado son **tres**, medidas una a una, y **ninguna baja** un día de reparto futuro:
  `recogerLote` (cuyo `WHERE` ya lleva el día), el **rescate desde ayuda** (`transicionarAyuda`, 235
  — no escribe `asignado_at` ni `fecha_reparto`: la orden vuelve **conservando** su día) y el
  **deshacer** (que tras D3 conserva la fecha futura en vez de bajarla). Y la única capa que
  *escribe* el día —las vías de asignación— exige que la orden esté en un estado de bodega, no en
  `en_reparto`, así que no puede cambiarlo bajo los pies de una gestión en curso. La población de la
  puerta A en gestionar es, en régimen, **sólo las órdenes heredadas** (R27, §7.1).

→ Deuda con nombre, en `progress/` y en el comentario del método. No se esconde.

### 3.bis · La puerta de LA TIENDA — y no va en el mismo sitio

**Decisión humana P2 (2026-08-22): la vía de la pestaña de ayuda entra en el alcance.** Su
razonamiento, que este diseño hace suyo: *si el problema es que se registre un resultado en un día
que no es, da igual quién lo registre*.

**No se reutiliza la puerta del mensajero, y no por comodidad.** `GestionDesdeAyudaService` existe
justamente porque **cuatro guardas** de `MisAsignacionesService.gestionar` lo impiden (rol
`mensajero`, `estaBloqueado`, origen `en_reparto` y `mensajeroId = actor.usuarioId`), y su propia
cabecera advierte que añadirle «un modo o un actor suplantado a un método money-critical deja los
cuatro candados a un `if` de abrirse». Se respeta.

**Medido: este camino ya tiene las dos capas montadas**, y mejor que el del mensajero:

| Capa | Dónde | Estado hoy |
| --- | --- | --- |
| **A — negocio** | `GestionDesdeAyudaService.gestionar`, pasos 3 y 4 | Ya comprueba `estatusValue === "ayuda_tienda"` **antes de subir nada**, «para no dejar fotos huérfanas en el bucket por el camino previsible» |
| **B — escritura** | `crearGestionDesdeAyuda`, `updateMany` con `where.estatusId` | Ya existe, ya es guardada, ya devuelve `null` → el servicio **compensa las evidencias** y responde `conflict` |

O sea que el día entra **en los dos sitios que ya están hechos**, sin inventar ninguna capa ni ningún
camino de fallo:

- **Puerta A** — un paso nuevo **entre el 5 y el 6** (después de «sin mensajero», **antes** de
  resolver el catálogo y **antes** del `subirEvidenciasCompensadas` del paso 7). Devuelve `conflict`,
  no `forbidden`: la orden **sí** es suya; lo que falla es el momento. Es **R29**.
- **Puerta B** — `OR: [{ fechaReparto: null }, { fechaReparto: { lte: diaEnCurso } }]` sumado al
  `where` del `updateMany` existente. Si la reserva cambia entre A y B, `result.count === 0` →
  `null` → el servicio **ya** compensa las fotos y responde `conflict`. Es **R30**, y **no hay que
  escribir su camino de fallo: existe**.

**De dónde sale la fecha en la puerta A.** De `OrdenParaHilo`, la fila mínima que
`autorizarSobreHilo` ya devuelve. Se le añade `fechaReparto: Date | null`. Objeción previsible —«es
la lectura MÍNIMA para autorizar y la comparte con notas y rescate»— y por qué no aplica:
`mensajeroAsignadoId` vive en esa misma fila y **lo consume un solo consumidor**, este mismo servicio
en su paso 5. El precedente está en el archivo. Y la pregunta que el campo responde («¿puede
resolverse hoy?») es exactamente del género que esa fila sirve.

### Lo que NO se hace, y por qué

- **NO en la Server Action.** `lib/actions/mis-asignaciones.ts` es un borde delgado (actor + zod +
  delegar, todo bajo `withErrorHandler`). Meter regla de negocio ahí la duplicaría en la capa que
  `docs/architecture.md` reserva para el borde, y el reviewer lo rechaza explícitamente («Controller
  no contiene lógica de negocio»). La action **no cambia**: sólo pasa el `now` por defecto.
- **NO sólo en el cliente.** Es exactamente el defecto que se arregla: el DTO **ya llevaba**
  `esParaManana` y aun así la guía 17496963 se gestionó. El cliente lleva **defensa suave** (D2), con
  el mismo reparto que el repo ya usa para el bloqueo por cierre: «defensa suave; el backend R1/R4 es
  la defensa real» (`reparto/page.tsx:33-36`).

---

## 4 · Contratos I/O — todo lo que cambia de forma

| Archivo | Cambio | Por qué así |
| --- | --- | --- |
| `lib/interfaces/repositories/IGestionOrdenRepository.ts` | `OrdenGestionRow.fechaReparto: Date | null` — **obligatorio, sin `?`** | Es insumo de una **puerta**. El patrón aditivo `?` del repo existe para no romper fixtures; aquí **romperlos es deseable**: un fixture que se olvide del campo debe romper el build, no apagar la guarda en silencio. |
| idem | `recogerLote(..., diaEnCurso: Date)` | El día lo resuelve el servicio y viaja resuelto (doctrina `dia-reparto.ts:4-9`). |
| `lib/interfaces/services/IMisAsignacionesService.ts` | `now?: Date` en `recogerAsignaciones`, `escogerParaGestion`, `gestionar` | Espejo exacto de `listarMisAsignaciones(actor, now?)`, que la 246 ya dejó así **para poder probar que la etiqueta caduca sola**. Sin esto, R6/R7 no son testeables. |
| idem | `DetalleConflicto.codigo?: "reservada_para_otro_dia"` | Aditivo y opcional. Para que la UI **no lea prosa**: hoy `motivo` mezcla texto humano («orden borrada») con jerga («estado de origen no permitido: en_bodega_central»). |
| idem | `MiAsignacionDTO.fechaRepartoISO?: string | null` (`YYYY-MM-DD`, resuelto en el servidor) | Para que la card pueda decir **qué día** (R11) sin leer ningún reloj (R14). `esParaManana` **se conserva intacto**: sigue siendo el booleano derivado (246/R26). |
| `lib/interfaces/repositories/ICierreDiaRepository.ts` | `AnularGestionInput` gana `asignadoAt: Date` y `diaEnCurso: Date` | **Dos campos, un solo reloj**: los dos salen del mismo `now` en el servicio. Ver §5.3. |
| `lib/interfaces/services/ICierreDiaService.ts` | `deshacerGestion(gestionId, actor, now?: Date)` | Es el sitio donde se puede inyectar el reloj (R19). |
| `lib/utils/dia-reparto-textos.ts` | `RESERVA_MOTIVO_SERVIDOR` + `avisoReservaParaOtroDia(fechaISO)` | R15. **Ese archivo existe justo para esto**: su cabecera dice que el vocabulario visible del día de reparto vive en un solo sitio «para que una pantalla no diga “Mañana” y otra “Día siguiente”». Y no importa `Date` ni `Intl` (R14). |
| `lib/interfaces/repositories/IOrdenNotaRepository.ts` | `OrdenParaHilo.fechaReparto: Date | null` | Puerta A de la tienda (§3.bis). Precedente en el mismo archivo: `mensajeroAsignadoId` también lo consume un solo consumidor. |
| `lib/interfaces/repositories/IGestionOrdenRepository.ts` | `CrearGestionDesdeAyudaInput.diaEnCurso: Date` | Puerta B de la tienda. Entra en un `updateMany` de Prisma, así que va como `Date` (la advertencia del texto `::date` es para el **SQL crudo**). |
| `lib/interfaces/services/IGestionDesdeAyudaService.ts` | `gestionar(input, actor, now?: Date)` | R31: el mismo criterio y el mismo día que la vía del mensajero, inyectable. |
| `lib/services/GestionDesdeAyudaService.ts` | Un `MSG_*` nuevo en `MENSAJES_GESTION_DESDE_AYUDA` | R32/R15. Ese objeto ya existe y está exportado «para que la pantalla y sus tests lean el MISMO string (D7)». El texto **sale de `dia-reparto-textos.ts`**, no se reescribe aquí. |

**Nada de esto toca `lib/types/**`**, así que el gate rápido no se niega por ahí — **pero sí se niega
igual**: `lib/repositories/CierreDiaRepository.ts` lleva nombre de dinero (`cierre`). El gate
**completo** es obligatorio. Ver §9.

---

## 5 · D2 — Qué ve el mensajero (y qué ve la tienda)

### 5.1 · La regla, en una frase — **firmada (P3, 2026-08-22)**

**Se restringe la ACCIÓN, no la visibilidad.** La orden se queda **en su grupo de siempre**, con su
marca, y se explica en palabras por qué todavía no se puede trabajar y desde cuándo se podrá.

Es el mismo reparto que el repo ya aplica al mensajero bloqueado por cierre pendiente
(`RepartoModule.tsx:413-418`: «la deshabilitación restringe la ACCIÓN, no la visibilidad: el detalle
completo sigue montado»). Copiar un patrón que el usuario ya conoce vale más que inventar uno — y ése
fue el motivo por el que el humano firmó esta opción y **no** la sección propia (alternativa **A7**).
**R9 no se reescribe.**

### 5.2 · Superficie por superficie

| Dónde | Qué cambia |
| --- | --- |
| **Card** (`PosOrderCard`, `PosOrderCardMosaico`, `PosOrderCardDetalle`) | El badge «Para mañana» **se queda** (R9). Debajo, una línea de aviso en palabras: `avisoReservaParaOtroDia(orden.fechaRepartoISO)` (R11). |
| **«Por recoger»** | **Medido: no hay botón «Recoger» por card.** La única vía es el escáner / número de guía (`RecogerPaqueteCard` → `useRecogerPorGuia`). Ahí el rechazo se hace **antes de llamar a la action**, con el mismo molde del que ya existe («La guía N no está entre tus órdenes por recoger») y con **el mismo texto** que el aviso de la card (R13). |
| **«Reparto»** | `GestionarOrdenCardButton` pasa a `disabled` cuando la orden está reservada (R12), en la misma expresión donde ya conviven `bloqueado` y «hay otra gestión activa». Con el aviso al lado: un botón gris sin explicación es un misterio. |
| **Carrera perdida** | Si el cliente deja pasar la acción y el servidor la rechaza, el `conflict` trae `codigo: "reservada_para_otro_dia"` y la UI pinta **el mismo texto**. Una regla, dos sitios, un texto. |
| **KPIs, ruta, mapa, chat** | **No se tocan** (R10). Una orden reservada ya en reparto sigue siendo parada y contacto: sigue en la moto. |

### 5.3 · El texto, y por qué lleva FECHA y no la palabra «mañana»

```
Esta orden es para el reparto del 22 de agosto. Ese día podrás recogerla y gestionarla.
```

Sin fecha disponible, la misma frase sin el día: *«Esta orden es para un día de reparto posterior.
Podrás recogerla y gestionarla ese día.»*

**Por qué no se escribe «mañana» a secas**, que sería más corto: el alcance del producto tope a
«mañana» (246/D2), pero `fecha_reparto` es un `DATE` libre y **un `UPDATE` a mano puede dejar +2** —
no es hipotético: en esta misma ficha ya hubo uno, autorizado, en producción. Si el texto dijera
«mañana», la app mentiría **justo en el caso en que un humano tocó la fila**. Con la fecha, la frase
es cierta siempre.

**Sin siglas y sin nombres de columna**, misma regla con la que el repo retiró «SLA» del frontend: no
dice «reserva», ni «corte», ni `fecha_reparto`, ni una fecha en `YYYY-MM-DD`. El `fechaLegible()` que
la compone ya existe en ese archivo, es **puro** y no toca ningún reloj (R14).

### 5.4 · La tienda: **el rechazo explicado, sin control deshabilitado** — y por qué la asimetría

En `/novedades` → «Ayuda solicitada», la tienda **sigue viendo el botón** y, al intentarlo, recibe el
rechazo con su texto: la misma frase, con el mismo día, desde la misma fuente (**R32**). El modal ya
tiene el cableado —`MENSAJES_GESTION_DESDE_AYUDA` está exportado precisamente «para que la pantalla y
sus tests lean el MISMO string»—, así que es un mensaje más en un objeto que ya existe.

**No se deshabilita el control, y es una decisión, no un olvido.** Para hacerlo habría que meter el
dato en `NovedadDTO` y derivar el booleano con un reloj en el servicio de novedades: una superficie
nueva —tipo compartido, consulta, derivación con reloj y sus tests— **para una población que M1 midió
en 2 órdenes**. La asimetría con el mensajero tiene un motivo concreto y no es de comodidad:

| | Mensajero | Tienda |
| --- | --- | --- |
| Dónde está | En la calle, **con el paquete en la mano** | En un escritorio |
| Coste de enterarse al intentarlo | Alto: ya se desplazó, o ya sacó la caja de la furgoneta | Nulo: es un clic y la respuesta es inmediata |
| Qué se le ofrece | **Control deshabilitado** + aviso, para que lo sepa **antes** | Rechazo explicado, con el día |

**Lo que NO cambia con esa asimetría: el bloqueo es igual de real.** Vive en el servidor y en dos
capas (**R28-R31**). Lo que se ahorra es superficie de UI, no defensa. Y queda **declarado** como
límite en `requirements.md`, no escondido: si mañana la población crece, meter el flag en
`NovedadDTO` es un cambio pequeño y localizado.

---

## 6 · D3 — Deshacer una gestión: conservar el motivo original, resolver sólo el caso que se le escapó

### 6.1 · El motivo original **sobrevive entero**

> «Las dos columnas no pueden contar historias distintas. Si `asignado_at` dijera “te la acabo de
> reasignar” y `fecha_reparto` conservara la reserva de ayer, el corte de esta misma noche la
> protegería o la barrería según un dato que ya no describe nada.»
> — `CierreDiaRepository.ts:902-907`

Eso es **cierto**, y lo sigue siendo. Lo que no contempló es la reserva a **FUTURO**, donde la
combinación «reasignada ahora, para un día que aún no llega» **no es una incoherencia**: es
exactamente lo que produce la vía de asignación cuando bodega elige «mañana» (`asignado_at = NOW()`,
`fecha_reparto = mañana`, `OrdenRepository.ts:2805-2812`). Bajarla ahí no repara nada: **cancela una
decisión que alguien tomó a propósito**, sin avisar, y entrega la orden al corte de esa misma noche.

**La regla nueva dice lo mismo, con una excepción nombrada:**

> El día de reparto se escribe **siempre** en la misma escritura que `asignado_at`. Al deshacer, ese
> día es el de Costa Rica **en curso**, **salvo** que la orden ya esté reservada para un día
> **posterior**: una reserva futura no se cancela por reponer una asignación.

### 6.2 · Cómo — el `CASE`, en la propia sentencia

```sql
UPDATE "orden"
SET "estatus_id" = ${estatusEnRepartoId},
    "mensajero_asignado_id" = ${mensajeroId},
    "asignado_at" = ${asignadoAt},
    "fecha_reparto" = CASE
      WHEN "fecha_reparto" > ${diaTexto}::date THEN "fecha_reparto"
      ELSE ${diaTexto}::date
    END,
    "updated_at" = NOW()
WHERE "id" = ${ordenId}
  AND "estatus_id" = ${estatusEsperadoId}
  AND "deleted_at" IS NULL
RETURNING "id"
```

`diaTexto = fechaRepartoComoTexto(diaEnCurso)`. Tres propiedades que hay que ver:

1. **Decide sobre la fila, no sobre una lectura previa.** No hay ventana entre leer y escribir, así
   que no hay nada que quedarse obsoleto (R17/R18).
2. **El `NULL` cae por el `ELSE` sin caso especial.** `NULL > x` es `NULL`, que no es `TRUE`, así que
   una orden sin día queda con el día de hoy — que es exactamente **R18** y lo que hoy ya hace.
3. **Sigue siendo UNA escritura para las dos columnas** (R16): la invariante de la 246/R10 no se
   toca, y la guardia que la vigila la sigue viendo (§6.4).

### 6.3 · Un solo reloj

El servicio (`CierreDiaService.deshacerGestion(gestionId, actor, now = new Date())`) calcula:

```
asignadoAt = now
diaEnCurso = startOfDayCR(now)     // ← el helper correcto, §2
```

y los pasa **los dos** en `AnularGestionInput`. `asignado_at` va como parámetro y no como `NOW()` del
motor **a propósito**: si el instante saliera del reloj de Postgres y el día del reloj de la
aplicación, las dos columnas podrían caer a distinto lado de la medianoche de CR — que es la clase
exacta de segunda-definición-del-día que este repo persigue. `updated_at` sí se queda en `NOW()`: es
auditoría y sigue la convención del archivo.

> ⚠️ El parámetro `${asignadoAt}` es un `Date` contra una columna **`timestamp`**, no `DATE`. La
> advertencia de `fechaRepartoComoTexto` es **específica de `DATE`** (ahí interviene el `TimeZone` de
> la sesión). Aun así **no se da por supuesto**: `tasks.md` (B7) exige comprobar el SQL emitido con el
> cliente espía (`crearPrismaDeTestConEspia`) y afirmar el valor persistido.

### 6.4 · Compatibilidad con la guardia existente — comprobada línea a línea

`tests/unit/guards/fecha-reparto-acompana-asignado-at.guardia.test.ts` censa `lib/` entero. El `SET`
nuevo entra en el censo (asigna `"asignado_at" =`) y cumple:

| Cláusula de la guardia | Cómo queda |
| --- | --- |
| Toda escritura de `asignado_at` toca `fecha_reparto` | ✔ el `CASE` está en el mismo `SET` |
| Una escritura que **limpia** `asignado_at` limpia el día | N/A: ésta lo **fija** |
| El `SET` no usa `NOW()::date`, `CURRENT_DATE`, `AT TIME ZONE`, `interval '` | ✔ el día entra como parámetro; `NOW()` a secas (para `updated_at`) no lo caza el patrón |
| El extractor corta de `SET` al primer `WHERE`/`RETURNING` | ✔ el `CASE` usa `WHEN`, no `WHERE` |
| El censo tiene ≥ 6 escrituras | ✔ se convierte una escritura Prisma en una SQL; el total no baja |

### 6.5 · Efecto sobre el corte de esa misma noche (R20)

Con la fecha futura conservada, la fila sigue cumpliendo **NO** el predicado
`(fecha_reparto IS NULL OR fecha_reparto <= diaCerrado)` → el corte no la barre → no hay
`sin_gestionar` ni transición. Es el defecto (3) cerrado en su consecuencia, no sólo en su síntoma.

---

## 7.1 · D4 — Las órdenes que ya están reservadas a futuro **y ya en reparto**

> **FIRMADO (P1, 2026-08-22): se dejan correr. Sin backfill, sin `UPDATE` previo.**
>
> **Y la decisión se apoya en un número, no en un adjetivo.** Medido contra producción el
> 2026-08-21: **exactamente 2 órdenes, de un solo mensajero, ambas reservadas para el 22** — son las
> de la prueba del humano. Se escribe el número y no «son pocas» a propósito: la recomendación
> **dependía** de esa medición, y quien la relea dentro de seis meses tiene que poder juzgarla en vez
> de creerla. Si M1 hubiera dado decenas de órdenes repartidas entre varios mensajeros, la
> recomendación se caía y la salida era el `UPDATE` autorizado.
>
> **Se re-mide antes de desplegar** (task B0.3). Si el número creció, la decisión se re-abre: es una
> foto y caduca.

**Sí las alcanza el bloqueo (R27), y son su única población real.** Medido: para gestionar hay que
estar en `en_reparto`, y tras esta ficha nadie nuevo llega ahí estando reservado (§3, «la carrera no
existe por construcción»). O sea que el bloqueo de gestionar es, en régimen, una **defensa en
profundidad**; hoy su población son las órdenes heredadas —y las que un `UPDATE` a mano pueda crear,
que ya ocurrió dos veces—.

**Recomendación del spec: dejarlas correr, sin backfill.** Tres razones, en orden de peso:

1. **Se desbloquean solas.** El máximo reservable por la app es «mañana»: al día siguiente la fila
   deja de estar reservada sin que nadie escriba nada.
2. **El corte no se las lleva.** Están protegidas exactamente por el mecanismo que esta ficha no
   toca. No hay `sin_gestionar`, no hay cierre `vencido`, no hay dinero en juego.
3. **Un backfill inventa un día que nadie eligió**, que es justo lo que la 246 se negó a hacer al
   crear la columna («sin default y sin backfill», R19 de aquella ficha).

**No se automatiza nada de esto.** Un script de reparación que corra solo al desplegar es una
escritura nueva sobre el día de reparto sin nadie mirando — exactamente lo que **R22** prohíbe.

---

## 7.2 · ⚠️ El agujero que este bloqueo abre — riesgo ACEPTADO, escrito con todas sus letras

> **FIRMADO (P4, 2026-08-22): se bloquea AHORA; la corrección va en la ficha 262.**

**Lo que es cierto desde el momento en que esto se despliegue, y no se suaviza:**

> Si bodega marca un lote para el día equivocado, **ese lote no se puede corregir desde ninguna
> pantalla de la aplicación**. Ni bodega, ni el maestro, ni el admin, ni el mensajero. La orden queda
> inalcanzable —no se puede recoger, ni escoger, ni gestionar, ni resolver desde ayuda— **hasta que
> llegue el día que alguien escribió por error**. La única salida es un `UPDATE` a mano en
> producción, con autorización humana explícita: exactamente el que hubo que hacer el 2026-08-21 con
> la guía 17496963.

**Medido dos veces, por el spec y por el leader, y las dos coinciden:** `fechaReparto` **no aparece
en un solo componente de escritura**. Las únicas escrituras del día en todo el árbol son las dos vías
de asignación (`asignarBodegaLote`, `asignarSateliteLote`), cinco limpiezas
(`DevolucionSlaRepository`, `LiberacionReprogramadaRepository`, `RecuperacionBodegaRepository`,
`CierresAdminRepository`, `OrdenRepository.deshacerAsignacionLote`) y el estampado del deshacer que
esta ficha corrige. Ninguna es una pantalla de corrección.

**Por qué el agujero lo abre ESTA ficha y no existía antes:** con D5 vigente, **el escape era el
propio mensajero**. Recogía y entregaba igual, y el error de bodega se quedaba en una estadística
torcida. Al cerrar esa puerta —que es lo que el humano pidió— el error de bodega pasa de «molesto» a
**bloqueante**.

**Por qué se acepta igual:** el defecto que se arregla es que se registren resultados —y se mueva
dinero— **en el día que no es**, y eso pasa hoy, en producción, con evidencia. El error de bodega es
corregible por un humano en minutos; un cobro atribuido al día equivocado no se ve hasta que alguien
cuadra la caja.

**Cómo se evita que esto se olvide:** **R33**. La nota vive **en el sitio donde se decide el
bloqueo** —no sólo en este spec, que nadie relee— con el puntero a la **ficha 262**, y la guardia de
§8 la vigila. El día que la 262 aterrice, esa nota se retira **por la puerta**: con su fecha y su
motivo, como se está haciendo aquí con D5.

---

## 8 · D5 (261) — La reversión de D5 (246), escrita en los dos soportes

Molde: `tests/unit/tablero-dia/d10-revertida.guardia.test.ts`, que la 259 escribió para el mismo
problema. Una decisión revertida vive en **dos soportes que pueden envejecer por separado**.

### 8.1 · Soporte 1 — el código

`lib/interfaces/services/IMisAsignacionesService.ts:103-105` afirma D5 **con autoridad**. Ese
párrafo se sustituye por la reversión, con las piezas que la guardia exige por separado (para que el
fallo diga **cuál** falta):

- la decisión por su nombre (**D5**);
- la fecha en que se adoptó (**2026-08-20**);
- la fecha de la reversión (**2026-08-21** — **firmado en P5**: la fecha de la *decisión humana*, no
  la del merge, porque es la que da sentido al motivo. Si la implementación aterriza otro día, la
  fecha **no cambia**);
- la palabra que dice que está superada (`REVERTIDA` / `SUPERSEDIDA`);
- el **motivo**: la medición **M3** quedó refutada por una prueba humana en producción (guía
  **17496963**, gestionada `entregada` a las 22:10 CR del 21 estando reservada para el 22);
- el **puntero**: `specs/261-dia-reparto-protege`.

Y **no puede quedar en el árbol del portal** ninguna frase que la afirme como vigente. Censo:
`lib/interfaces/services/IMisAsignacionesService.ts`, `lib/services/MisAsignacionesService.ts`,
`lib/utils/dia-reparto-textos.ts` y **todo** `app/(app)/mis-asignaciones/**`. Frases testigo ya
localizadas (hay más; el censo las busca, no las asume):

| Archivo | Frase |
| --- | --- |
| `IMisAsignacionesService.ts:103` | `NO oculta ni bloquea nada` |
| idem | `la reserva protege del CRON, no del mensajero` |
| idem | `que la medicion M3 cerro` |
| `PosOrderCardMosaico.tsx:187-189` | `no oculta ni bloquea nada` · `se puede recoger y gestionar igual` · `La reserva protege del corte de la noche, no del mensajero` |
| `PosOrderCardDetalle.tsx:117` | `No oculta ni bloquea nada (R23/R24, decisión D5)` |

> El detector **normaliza los espacios** antes de comparar: en JSX estas frases están partidas en
> varias líneas con sangría, y un patrón literal no las vería. La autocomprobación de la guardia lo
> demuestra con una frase partida a mano.

### 8.2 · Soporte 2 — el spec donde D5 se firmó

`specs/246-asignacion-por-dia/requirements.md` recibe un **apéndice fechado** al pie de §D5, con el
mismo formato que el que la 259 le puso a §D10 (línea 528-533 de ese archivo). **El texto original no
se toca.**

La guardia comprueba **las dos direcciones** — y ésta es la mitad que se olvida: si sólo exigiera el
puntero, un «ya que estamos» podría reescribir §D5 «para dejarlo coherente» y borraría la prueba de
que aquella decisión se tomó a conciencia y con sus razones. Testigos **verbatim** (copiar del
archivo, no de aquí):

- `**D5 · ¿El mensajero puede recoger y gestionar hoy una orden reservada para mañana?**`
- `**Recomendación: sí — visible, etiquetada y trabajable** (R22-R24). La reserva protege del **cron**,`
- `3. **La reserva no impide entregar hoy.** Por **D5**, un mensajero puede recoger y entregar hoy una`
- `**R24.** El sistema NO DEBE impedirle al mensajero recoger ni gestionar una orden reservada para`

⛔ Si uno de éstos se pone rojo, la respuesta **no** es actualizar el testigo: es que alguien
reescribió el spec de la 246 en vez de anexarle el apéndice.

### 8.2.bis · Soporte 3 — la nota del agujero abierto (**R33**)

La misma guardia vigila una tercera cosa, y no es decorativa: que junto a la reversión de D5 esté
escrito que **hoy no hay ninguna superficie para corregir el día** de una orden ya asignada, con el
puntero a la **ficha 262**. Piezas exigidas: la frase que lo dice, y `262`.

**Por qué en la guardia y no sólo en este spec:** un riesgo aceptado que sólo vive en un spec es un
riesgo que nadie vuelve a leer. Éste tiene que estar delante de quien abra el archivo donde se decide
el bloqueo. Y cuando la 262 aterrice, la nota se retira **por la puerta** —con fecha y motivo—, no
por un «ya que estamos».

### 8.3 · La guardia no puede ser vacía

Cada detector es una **función pura** con su autocomprobación: se le da un texto que **sí** infringe y
otro que no. Sin eso, una guardia de prosa se queda verde por vacía en cuanto un rename deja de
encajar — y este repo ya tuvo una guardia que **no podía fallar nunca** protegiendo justo lo que la
ficha decidía.

---

## 9 · Verificación — qué prueba qué, y qué mutación mata cada test

**El gate COMPLETO (`./init.sh`) es obligatorio y no es una elección.** `--rapido` **se niega solo**:
el diff toca `lib/repositories/CierreDiaRepository.ts`, y `cierre` está en la lista de nombres de
dinero de `docs/verification.md`.

### 9.1 · El reparto, y por qué no vale con uno solo

| Qué se prueba | Dónde | Por qué **ahí** |
| --- | --- | --- |
| Las tres guardas de negocio (R1-R8, R10, R27) | **Servicio, con dobles** | La regla vive en el servicio; una mutación que borre el `if` deja el test rojo. Aquí los dobles **sí** son la herramienta correcta. |
| El `WHERE` de `recogerLote` (R1, R4, R5, R7, R8) | **Postgres real** | ⚠️ Un test de servicio con dobles **no ve el SQL**. Medido cuatro veces seguidas en este repo: una mutación del `WHERE` deja once tests de servicio en verde. |
| La puerta A de **la tienda** (R28, R29, R31) | Servicio, con dobles | La guarda es un paso del método; una mutación que lo borre deja el test rojo. Se afirma además que **`storage.subir` no se llamó**: R29 es «antes de subir nada». |
| El `where` de `crearGestionDesdeAyuda` (R30) | **Postgres real** | Es un `updateMany` de Prisma, pero sigue siendo la decisión **en la escritura**: con dobles, quitar el `OR` no rompe nada. Y hay que afirmar la **compensación** de las fotos. |
| El `CASE` del deshacer (R16-R20) | **Postgres real** | Igual: la decisión vive **dentro de la sentencia**. Ningún doble puede ejecutarla. |
| Los textos (R11, R13, R14, R15) | Unitario + componente | Que el módulo de textos no importe `Date`/`Intl`, y que la frase que pinta la card sea la misma que devuelve el servidor. |
| La reversión (R24-R26) | Guardia de prosa | §8. |
| Que no se rompió el corte (R21, R22) | Los tests que ya existen | `corte-diario-service.test.ts` y `fecha-reparto-acompana-asignado-at.guardia.test.ts`. |

### 9.2 · El test que el defecto (3) exige, escrito como orden

> Siembra una orden con `fecha_reparto = mañana` y una gestión suya; deshace la gestión; **afirma que
> `fecha_reparto` SIGUE siendo mañana** y que `asignado_at` se reescribió. Y la mitad negativa, en el
> mismo archivo: con `fecha_reparto = ayer` y con `NULL`, tras deshacer queda en **hoy**.

Sin las dos mitades el test no dice nada: uno que sólo afirme «se conserva» pasaría también con un
`SET` que **no tocara la columna**, que es otro defecto.

### 9.3 · Ningún test puede saltarse en silencio

Los de Postgres real usan `tests/integration/db/_postgres-real.ts` (`HAY_BASE_DE_DATOS`,
`enTransaccionRevertida`, `serializarEscriturasReales`, `fksDeOrden`).

- Sin base: **`describe.skip` a nivel de archivo**, que se ve en la salida.
- Con base: **dentro** del `describe` **no puede haber un `return` temprano**. Si `fksDeOrden`
  devuelve `null`, el test **revienta** con un mensaje que lo diga. Un `if (!fks) return;` reporta
  `passed` sin haber comprobado nada — ya pasó aquí.
- Todo lo sembrado vive dentro de `enTransaccionRevertida`: ni una fila queda en la base.

### 9.4 · Mutaciones obligatorias (cada una debe producir un rojo con nombre)

| # | Mutación | Debe morir en |
| --- | --- | --- |
| M-a | Borrar la guarda de reserva de `recogerAsignaciones` | test de servicio (R1) |
| M-b | Borrar la guarda de `gestionar` | test de servicio (R2) |
| M-c | Borrar la guarda de `escogerParaGestion` | test de servicio (R3) |
| M-d | Quitar `AND ("fecha_reparto" IS NULL OR ...)` del `WHERE` de `recogerLote` | test **Postgres real** (R5) |
| M-e | Cambiar `<=` por `<` en ese `WHERE` | test Postgres real: la orden reservada **para hoy** debe seguir recogiéndose (R8) |
| M-f | Cambiar `>` por `>=` en la guarda del servicio | test de servicio: reservada **para hoy** no se bloquea |
| M-g | Sustituir el `CASE` por `${diaTexto}::date` a secas (el defecto original) | test Postgres real del deshacer (R17) |
| M-h | Sustituir el `CASE` por dejar la columna sin tocar | test Postgres real del deshacer, mitad negativa (R18) |
| M-i | Sustituir `startOfDayCR` por `inicioDelDiaCREnUtc` en el servicio | test con reloj a las 23:00 CR (R6/R19) |
| M-j | Borrar el apéndice de §D5 en el spec de la 246 | guardia (R25) |
| M-k | Reescribir el enunciado de §D5 «para dejarlo coherente» | guardia, testigos verbatim (R26) |
| M-l | Devolver el literal del aviso a la card en vez de importarlo | test de fuente única (R15) |
| M-m | Borrar la guarda de reserva de `GestionDesdeAyudaService` | test de servicio de la tienda (R28) |
| M-n | Mover esa guarda **después** de `subirEvidenciasCompensadas` | test que afirma «`storage.subir` no se llamó» (R29) |
| M-o | Quitar el `OR` de `fechaReparto` del `where` de `crearGestionDesdeAyuda` | test **Postgres real** de la tienda (R30) |
| M-p | Borrar la nota del agujero abierto / el puntero a la 262 | guardia (R33) |

El arnés de mutaciones **debe autocomprobarse**: en este repo ya reportó «9/9 supervivientes» dos
veces **sin haber ejecutado un solo test**. Cada mutación se pega con su salida en
`progress/impl_261_*.md`.

### 9.5 · Ver la app

Playwright manual con la cuenta de un mensajero de QA, en preview: una orden reservada para mañana
en «Por recoger» (escanear → mensaje), una en «Reparto» (botón gris + aviso), y una de hoy (todo
funciona). En este repo, mirar la app encontró siete textos rotos que doce mil tests daban por
buenos.

---

## 10 · Alternativas descartadas

**A1 · Poner la guarda sólo en la Server Action.** Descartada: `docs/architecture.md` reserva esa capa
para el borde (actor + zod + delegar) y el reviewer rechaza lógica de negocio ahí. Además dejaría
fuera a cualquier otro llamador del servicio.

**A2 · Poner la guarda sólo en el cliente.** Descartada por evidencia directa: el DTO **ya llevaba**
`esParaManana` y la guía 17496963 se gestionó igual, en producción. Es el defecto, no el remedio.

**A3 · `GREATEST("fecha_reparto", ${dia}::date)` en vez del `CASE`.** Funciona —Postgres **ignora los
`NULL`** en `GREATEST`, así que `GREATEST(NULL, hoy) = hoy`, que es justo lo que queremos— pero se
descarta: esa semántica es **específica de Postgres** y contraria a lo que la mayoría espera (en
MySQL/Oracle el `NULL` se propaga). Quien lea la línea creyendo lo segundo concluirá que la invariante
está rota y «la arreglará». El `CASE` dice la regla en voz alta y no depende de ninguna sutileza.

**A4 · Leer `fecha_reparto` en TypeScript y decidir el valor antes del `UPDATE`** (añadiéndolo a
`GestionDeshacerRow`, o con una segunda lectura dentro de la transacción). Descartada: el `WHERE` del
`UPDATE` sólo protege `estatus_id`, así que una fecha que cambiara entre la lectura y la escritura
sería **pisada en silencio con una decisión rancia** — el mismo género de defecto que esta ficha
arregla. El `CASE` decide sobre la fila.

**A5 · Conservar Prisma `updateMany` y meter `fechaReparto: <leída>` en el `WHERE`** como guarda
optimista. Descartada: convierte una carrera imposible en un `conflict` visible cuyo mensaje («la
orden se movió») sería **falso**, y sigue necesitando la lectura extra.

**A6 · Añadir el día al `WHERE` de `crearGestionYTransicionar`.** Descartada, con nombre y deuda
declarada: §3, «Puerta ausente».

**A7 · Mover las órdenes reservadas a un grupo propio «Para mañana».** Descartada, y **el humano la
descartó también al firmar P3**: obliga a decidir, para una cuarta lista, si cuenta en los KPI, si es
parada del mapa, si entra en el chat y si el buscador la alcanza — cuatro decisiones nuevas para un
cambio que la deshabilitación resuelve con el patrón que el usuario ya conoce del bloqueo por cierre.
Y roza R9: lo que se saca del grupo de siempre está a un paso de esconderse.

**A8 · Que el texto diga «mañana» en vez de la fecha.** Descartada: §5.3. `fecha_reparto` es un `DATE`
libre y un `UPDATE` a mano puede dejar +2 — ya ocurrió en producción en esta misma ficha.

**A9 · Backfill automático de las órdenes heredadas al desplegar.** Descartada: §7. Sería una
escritura nueva sobre el día de reparto sin nadie mirando (R22), inventando un día que nadie eligió.

**A10 · Sustituir `startOfDayCR` por `inicioDelDiaCREnUtc` en la anulación** «porque una guardia la
prohíbe en otro árbol». Descartada **midiendo**: §2. Metería el off-by-one de seis horas que cerró la
ficha 166.

**A11 · Reutilizar `MisAsignacionesService.gestionar` para la vía de la tienda** en vez de poner una
puerta propia. Descartada, y no por esta ficha: `GestionDesdeAyudaService` existe **porque cuatro
guardas de aquel método lo impiden**, y su cabecera advierte que añadirle «un modo o un actor
suplantado a un método money-critical deja los cuatro candados a un `if` de abrirse, y con un solo
juego de tests». La puerta va donde la operación vive (§3.bis).

**A12 · Poner la guarda de la tienda SÓLO en el `where` del `updateMany`.** Funcionaría —el camino de
compensación existe— pero cada intento bloqueado **subiría N fotos a Storage para borrarlas acto
seguido**. El propio servicio ya dice por qué comprueba el estado en el paso 3 y no sólo en el 8:
«antes de subir nada, para no dejar fotos huérfanas en el bucket **por el camino previsible**». Un
rechazo previsible pertenece antes del upload. Por eso van **las dos** (R29 + R30).

**A13 · Deshabilitar también el control de la tienda**, metiendo el flag en `NovedadDTO`. Descartada
con su motivo y su número en §5.4: tipo compartido + consulta + derivación con reloj + tests, para
una población que M1 midió en **2 órdenes**, y con un coste de enterarse-al-intentarlo que para la
tienda es **nulo** (está en un escritorio, no en la calle con el paquete). Declarada como límite, no
escondida.

**A14 · Dejar el agujero de P4 sólo escrito en este spec.** Descartada: un riesgo aceptado que vive
sólo en un spec es un riesgo que nadie vuelve a leer. Va **en el código, en el sitio donde se decide
el bloqueo**, con puntero a la ficha 262 y vigilado por la guardia (**R33**, §8.2.bis).

---

## 11 · Riesgos

| Riesgo | Mitigación |
| --- | --- |
| El bloqueo deja a alguien con un paquete en la mano y sin botón | Medido: **2 órdenes, un mensajero** (§7.1). Se re-mide en B0.3; si crece, la decisión se re-abre. |
| **Un lote mal marcado queda inalcanzable para todos** | **Riesgo ACEPTADO** (§7.2). No se mitiga en esta ficha: se **escribe en el código** con puntero a la **ficha 262** y lo vigila la guardia (**R33**). La única salida mientras tanto es un `UPDATE` a mano en producción. |
| La tienda ve un botón que va a fallar | Rechazo inmediato y explicado, con el día (**R32**). Asimetría decidida y declarada (§5.4, A13). |
| `tests/unit/repositories/cierre-dia-repository.test.ts` usa dobles y **deja de ver** lo que hace el `SET` al pasar a SQL crudo | Task B14: ese archivo se revisa explícitamente; lo que pierda se recupera en el test contra Postgres, y lo que quede en dobles no puede seguir afirmando el valor de `fecha_reparto` (sería una aserción contra su propia fuente). |
| El parámetro `Date` de `asignado_at` en SQL crudo | B7 lo comprueba con el cliente espía y afirmando el valor persistido, no razonando sobre el driver. |
| Otra sesión mueve `dev` mientras esto se implementa | Pre-vuelo contra `origin/dev` justo antes del PR. |

---

## 12 · Decisiones firmadas — **no quedan preguntas abiertas**

Las cinco de la primera versión están resueltas (registro completo en
`requirements.md § PUERTA HUMANA`). Dónde vive cada una en este documento:

| # | Decisión | Dónde |
| --- | --- | --- |
| **P1** | Se **dejan correr** las órdenes heredadas. Medido: **2 órdenes, un mensajero, ambas para el 22**. | §7.1 · R27 |
| **P2** | **La tienda TAMBIÉN entra.** Puerta propia, en dos capas, en el camino donde la operación vive. | §3.bis · §5.4 · R28-R32 |
| **P3** | Se queda **en su grupo**, con la acción deshabilitada. R9 no se reescribe. | §5.1 · A7 |
| **P4** | Se bloquea **ahora**; la corrección va en la **ficha 262**. Riesgo aceptado y escrito en el código. | §7.2 · §8.2.bis · R33 |
| **P5** | La fecha de la reversión es **2026-08-21**, la de la decisión humana. | §8.1 |

**Regla que sigue en pie para la implementación:** si aparece un dato que no está en `docs/`, en
`specs/` ni en el código, **se para y se pregunta** (CLAUDE.md, regla 6). Ninguna de estas decisiones
autoriza a rellenar un hueco nuevo con un supuesto.
