# 407 — Diseño: autorizar la asignación de una orden sin ubicación

> Todo lo que este documento afirma sobre el código vigente está **verificado en el archivo
> real**, no en el índice del grafo (que devuelve de más). Las citas llevan archivo y línea.

---

## §0. El hallazgo que decide el diseño: aguas abajo YA está resuelto

`lib/services/OptimizacionRutaService.ts:223-229` (feature 92, R37):

```ts
const todas = await this.paradasRepo.findParadasEnReparto(mensajeroId);
// R37: las ordenes SIN coordenadas se EXCLUYEN de la optimizacion, no la abortan.
// Quedan como paradas sin posicion (R28) y la lectura las muestra al final.
const conCoordenadas = todas.filter(...)
```

Y `lib/interfaces/repositories/IOrdenRepository.ts:1552-1556`: «una orden sin coordenadas **NO
se excluye aquí**, el service la registra como parada sin posición». La lectura del mensajero
(`lib/services/MisAsignacionesService.ts:255-257`) deja «sin posición» a las que no están en la
secuencia y conserva su orden.

**Conclusión:** una orden sin coordenadas asignada a un mensajero **no se pierde**. El modo
degradado existe desde la feature 92 y la feature 400 ya lo usó en producción. **El único punto de
toda la cadena que se planta es el gate de asignación.** Eso es lo que hace barata esta ficha: no
hay que construir el carril, hay que abrirle una segunda puerta.

---

## §1. Lo que ya existe y se reutiliza (verificado)

| Pieza | Dónde | Qué hace hoy |
| --- | --- | --- |
| `STATUS_DETERMINISTAS` | `lib/services/AsignabilidadCoordenadasService.ts:87` | `{ZERO_RESULTS, INVALID_REQUEST, SIN_DIRECCION}` → `direccion_no_geocodificable` (paso R3, sin tocar la cola) |
| `EstadoAsignable` | `lib/interfaces/services/IAsignabilidadCoordenadasService.ts:45` | `"asignable" \| "asignable_sin_ubicacion"` — el carril de salida que abrió la 400 |
| `EstadoBloqueante` | idem `:56` | `Exclude<EstadoAsignabilidad, EstadoAsignable>` — **derivado**, no escrito a mano |
| `esAsignable` | `lib/services/AsignabilidadCoordenadasService.ts:225-229` | los dos writers preguntan por esto, nunca por un literal |
| `mensajeAsignadasSinUbicacion(n)` | `app/(app)/_components/geocodificacion-motivo-messages.ts:146-151` | el aviso agregado de la 400 |
| `gateCoordenadas` | `lib/services/GuiaAsignacionService.ts:197-220` | devuelve `{ bloqueadas, sinUbicacion }` |
| bloque `4b` | `lib/services/AsignacionSateliteService.ts:253-290` | el gemelo del anterior, en línea |
| `hashDireccion(query)` | `lib/geo/direccion-query.ts:67-70` | SHA-256 hex, insensible a mayúsculas/acentos/espacios |
| guarda de re-geocodificación | `lib/repositories/OrdenRepository.ts:1768-1776` | ficha 327: si la escritura cambia efectivamente la dirección, encola geocodificación |

**Esta ficha añade una SEGUNDA puerta de entrada a ese mismo carril.** La diferencia sustantiva
con la 400: aquella la abre **el sistema** por un fallo propio; ésta la abre **una persona a
sabiendas**. Por eso son dos estados distintos y dos textos distintos (§6).

---

## §2. Forma de la solución, en una frase

Una persona registra una **autorización** sobre una orden concreta; la autorización queda escrita
en una tabla append-only, **atada a la huella de la dirección** que se autorizó; el gate, dentro
de su rama `direccion_no_geocodificable`, la consulta y devuelve un estado **asignable nuevo**;
los dos writers cuentan ese estado en una cifra propia; los dos modales lo cuentan con un texto
propio que no miente.

**Lo que NO cambia:** el orden del árbol de decisión del gate, las firmas de los dos writers, los
esquemas de entrada de las dos asignaciones, `IJobRepository`, `asignarBodegaLote`,
`asignarSateliteLote`, y el comportamiento entero del sistema mientras no exista ninguna
autorización (R27).

---

## §3. Quién autoriza, y por qué

| Rol | Puede autorizar |
| --- | --- |
| `maestro`, `admin` | sí, cualquier orden (`esAccesoTotal`, `lib/auth/acceso-total.ts:7`) |
| `adminSatelite` | sí, **solo órdenes de su propia zona** (`findUsuarioZonaId`, igual que `AsignacionSateliteService.asignar` en `:107`) |
| cualquier otro | no (`forbidden`) |

**Por qué NO se exige `maestro` y punto.** El caso medido es una orden `en_bodega_satelite` en la
zona «FGAM San Ramón»: quien la tiene delante es el `adminSatelite`. Exigir un `maestro`
convertiría la decisión en una escalada, y la escalada es exactamente lo que produjo los **cinco
días parada**. Además el juicio que se pide —«¿el mensajero sabe llegar con estas
indicaciones?»— lo tiene quien despacha esa bodega, no quien está en la central.

**Por qué NO se abre a `mensajero` ni a `adminTienda`.** No son quienes asignan, así que la
capacidad no les serviría de nada y ampliaría la superficie sin ningún caso que la pida.

**El criterio general es: quien ya puede asignar esa orden, puede autorizarla.** No se crea un
permiso nuevo ni una tabla de permisos; se reusan los dos predicados que ya gobiernan los dos
writers. Lo que hace responsable la decisión no es un rol más estrecho, es **el rastro** (§4).

---

## §4. Modelo de datos

### §4.1. Tabla nueva `orden_asignacion_sin_ubicacion`

Append-only, fila **inmutable** (patrón `orden_historial_estado` / `orden_dia_reparto_cambio` /
`gestion_fecha_reprogramacion_cambio`).

```prisma
model OrdenAsignacionSinUbicacion {
  id      String @id @default(uuid())
  ordenId String @map("orden_id")

  /// La huella de la dirección LIBRE vigente en el instante de autorizar, calculada con
  /// `hashDireccion` — la MISMA función con la que el gate reconstruye la clave del job
  /// (`AsignabilidadCoordenadasService:121`). Es lo que ata la autorización a UNA dirección
  /// concreta: si alguien la corrige, la huella cambia y esta fila deja de responder por la
  /// orden, exactamente como el `dedupe_key` del job deja de responder (400, §4.3).
  direccionHash String @map("direccion_hash") @db.VarChar(64)

  /// NOT NULL, al revés que `orden_historial_estado.actor_usuario_id`: AQUÍ SIEMPRE HAY UNA
  /// PERSONA. Ese es el punto entero de la ficha. FK `Restrict`, mismo criterio que
  /// `orden_dia_reparto_cambio.actor_usuario_id`: la autoría es evidencia y no se pierde al dar
  /// de baja al usuario.
  actorUsuarioId String @map("actor_usuario_id")

  createdAt DateTime @default(now()) @map("created_at")
  // SIN updated_at / deleted_at: fila INMUTABLE.

  orden Orden   @relation(fields: [ordenId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  actor Usuario @relation("AutorizacionSinUbicacionActor", fields: [actorUsuarioId], references: [id], onDelete: Restrict, onUpdate: Cascade)

  @@index([ordenId, createdAt])
  @@index([actorUsuarioId])
  @@map("orden_asignacion_sin_ubicacion")
}
```

Back-relations nuevas: `Orden.autorizacionesSinUbicacion` y
`Usuario.autorizacionesSinUbicacionAutorizadas`.

**SIN índice único.** Una autorización sobre otra dirección de la misma orden es un hecho nuevo y
debe verse. La idempotencia de R12 la resuelve el servicio (§5.3), no un constraint: el constraint
tendría que ser sobre `(orden_id, direccion_hash)` y convertiría un reintento inocente en un error
de base de datos.

**RLS habilitada SIN policies** (solo service role), patrón `orden_dia_reparto_cambio` /
`gestion_fecha_reprogramacion_cambio`. Este repo no usa Supabase Auth, así que una policy no
tendría a quién preguntar; lo que la RLS garantiza es que a estas filas no se llega si no es por
el servidor de la aplicación. R13.

### §4.2. Migración

`db/migrations/20260910120000_orden_asignacion_sin_ubicacion/`
  - `migration.sql` — UP: `CREATE TABLE` + dos índices + tres constraints + `ENABLE ROW LEVEL
    SECURITY`. **Aditiva**: no toca ninguna tabla, columna, índice ni enum preexistente. **Sin
    backfill**: las 2 órdenes afectadas se autorizan a mano por una persona, que es el punto de
    la ficha.
  - `down.sql` — DOWN: `DROP TABLE IF EXISTS "orden_asignacion_sin_ubicacion";` y nada más (no hay
    enum que recrear, así que **no se hereda la trampa** de los `down.sql` que recrean-con-lista).
    Destructivo y sin vuelta: se lleva el rastro escrito. Se dice en voz alta en el propio
    archivo.

**Este cambio obliga a `./init.sh` completo**, no al rápido: toca `db/schema.prisma`,
`db/migrations/**` y `lib/types/**` (`docs/verification.md`, tabla «cuándo `--rapido` se niega»).
No es una molestia evitable, es la regla.

---

## §5. Backend

### §5.1. El contrato del gate — `lib/interfaces/services/IAsignabilidadCoordenadasService.ts`

1. **Un valor más** en `EstadoAsignabilidad`:

```ts
/**
 * FICHA 407: no tiene coordenadas y su dirección es irresoluble, pero UNA PERSONA autorizó
 * asignarla igual. Se puede asignar; entra en el modo degradado que ya existe (92 R37/R28/R30).
 */
| "asignable_sin_ubicacion_autorizada"
```

2. **Se añade a `EstadoAsignable`**:
   `"asignable" | "asignable_sin_ubicacion" | "asignable_sin_ubicacion_autorizada"`.
   `EstadoBloqueante` se deriva por `Exclude`, así que el `Record<EstadoBloqueante, string>` de
   `geocodificacion-motivo-messages.ts` **sigue compilando con sus cinco entradas** y no gana un
   mensaje que nadie podría ver. Si alguien añadiera el valor solo a `EstadoAsignabilidad` y se
   olvidara de `EstadoAsignable`, ese `Record` **dejaría de compilar** — el tripwire de la 400
   sigue funcionando y ahora nos protege a nosotros.

   ⚠️ **El tripwire no cubre `esAsignable`.** Su lista interna
   (`AsignabilidadCoordenadasService:227`) es `readonly EstadoAsignable[]` y **un array más corto
   sigue compilando**. Olvidarse de añadir el valor ahí es un fallo mudo: el gate devolvería el
   estado nuevo y los writers lo tratarían como bloqueante. Por eso hay un caso explícito
   (`esAsignable("asignable_sin_ubicacion_autorizada") === true`) en `tasks.md` T6.

3. **`OrdenAsignabilidadRow` gana una proyección**:

```ts
/** FICHA 407: las huellas de dirección autorizadas para esta orden. Vacío = ninguna. */
autorizacionesSinUbicacion: readonly string[];
```

4. **La lista de motivos autorizables, en su único sitio**:

```ts
/**
 * FICHA 407 (R2/R9/R24) — los estados del gate que una persona PUEDE autorizar. Vive aquí, en el
 * contrato, y NO en el servicio ni en el modal, porque lo consultan los DOS lados: el servidor
 * para decidir, y los modales para no ofrecer lo que el servidor va a negar (lección de la 271).
 * Es un módulo sin dependencias de runtime, así que un componente cliente puede importarlo sin
 * arrastrar Prisma ni `node:crypto`.
 *
 * Escrita a mano y NO derivada: el defecto seguro es «no autorizable». Un estado nuevo que
 * nadie clasifique se queda fuera, que es el lado correcto en el que equivocarse.
 */
export const MOTIVOS_AUTORIZABLES_SIN_UBICACION: readonly EstadoBloqueante[] = [
  "direccion_no_geocodificable",
];
export function esMotivoAutorizableSinUbicacion(motivo: string): boolean { ... }
```

### §5.2. El gate — `lib/services/AsignabilidadCoordenadasService.ts`

**Un `if` DENTRO de la rama R3**, y en ningún otro sitio:

```ts
if (orden.geocodeStatus !== null && STATUS_DETERMINISTAS.has(orden.geocodeStatus)) {
  // FICHA 407: la autorización solo vale para la dirección que se autorizó.
  const huellaVigente = hashDireccion(orden.direccion ?? "");
  resultado.set(
    orden.id,
    orden.autorizacionesSinUbicacion.includes(huellaVigente)
      ? "asignable_sin_ubicacion_autorizada"
      : "direccion_no_geocodificable",
  );
  continue;
}
```

**Por qué DENTRO de R3 y no como paso propio.** Es la decisión estructural de la ficha:

- **No puede ganarle a R2.** Si la orden tiene coordenadas, R2 ya salió con `asignable` antes de
  llegar aquí. La autorización queda **inerte sola** el día que la orden se geocodifique (R15) —
  el mismo mecanismo con el que la 400 evita que su marcador se quede pegado.
- **No puede tocar R5, R6 ni R7.** Meterlo como paso propio antes de la cola dejaría abierta la
  puerta a que una autorización vieja se comiera un `geocodificacion_en_curso`, que **no es
  definitivo** y todavía puede resolverse sola. Dentro de R3 eso es **estructuralmente
  imposible**: esos estados se calculan en otra rama a la que este código no llega (R9).
- **Cero consultas nuevas.** La huella se calcula en memoria con una función que este archivo ya
  importa (`hashDireccion`, `:75`) y la lista de autorizaciones viaja en la fila que
  `findParaAsignabilidad` ya devolvía.
- **El orden del árbol de decisión sigue siendo normativo** y no se reordena. La cabecera del
  archivo se amplía con la fila nueva, como hicieron la 368 y la 400.

`esAsignable` gana el tercer valor en su lista.

### §5.3. El servicio de autorización — `lib/services/AutorizarAsignacionSinUbicacionService.ts` (nuevo)

```
autorizar(input: { ordenIds: string[] }, actor: Actor): Promise<AutorizarSinUbicacionServiceResult>
```

Pasos:

1. **Rol** (R3/R4/R5): `esAccesoTotal(actor.rol)` → alcance total; `actor.rol === "adminSatelite"`
   → `findUsuarioZonaId(actor.usuarioId)`, sin zona → `sin_zona`; cualquier otro → `forbidden`,
   **antes de leer una sola orden**.
2. **Existencia y zona**: `findByIdsForTransicion(ordenIds)` (ya existe, ya devuelve `deletedAt` y
   `zonaId`). No existe o borrada → `orden_no_disponible`. `adminSatelite` con
   `zonaId !== zonaActor` → `zona_ajena`.
3. **Clasificación**: `findParaAsignabilidad(ordenIds)` + `asignabilidad.evaluar(filas)`. **Se
   reusa el gate entero**, no se re-deriva la regla. Traducción del estado a desenlace:

   | estado del gate | desenlace |
   | --- | --- |
   | `direccion_no_geocodificable` | **autorizable** → se escribe |
   | `asignable_sin_ubicacion_autorizada` | `ya_autorizada` (R12: no se escribe nada) |
   | `asignable`, `asignable_sin_ubicacion` | `ya_asignable` |
   | `geocodificacion_en_curso`, `_encolada`, `_no_encolable` | `todavia_se_esta_ubicando` |
   | `geocodificacion_agotada` | `fallo_del_servicio_de_mapas` |

   La condición se escribe con `esMotivoAutorizableSinUbicacion` (§5.1.4), **nunca** con el
   literal suelto.

   > **Efecto colateral declarado:** `evaluar` puede **encolar** una geocodificación puntual
   > (paso R7 del gate, `:169-180`). Es el mismo efecto que provoca hoy un intento de asignación,
   > y es deseable: si la orden se puede resolver sola, se intenta antes de que nadie autorice
   > nada.

4. **Escritura**: una sola llamada `registrar(filas)` con las autorizables, cada una con
   `hashDireccion(orden.direccion ?? "")` tomado de la MISMA fila que clasificó el gate — no de
   una segunda lectura, que podría ver otra dirección.
5. **Resultado**: un item por cada id recibido, en el orden de entrada (R7/R8).

`sin_zona` / `forbidden` no llevan detalle (R5: no se revela nada de las órdenes pedidas).

### §5.4. Repositorio nuevo

`lib/interfaces/repositories/IAutorizacionSinUbicacionRepository.ts` +
`lib/repositories/AutorizacionSinUbicacionRepository.ts`, con un solo método:

```ts
registrar(filas: { ordenId: string; direccionHash: string; actorUsuarioId: string }[]): Promise<number>
```

`createMany` en una sentencia. Sin lógica de negocio, sin validación de permisos.

**La LECTURA no vive aquí**: la hace `findParaAsignabilidad` (§5.5), porque el gate necesita la
huella en la misma fila que ya lee y una segunda consulta sería una consulta nueva en el camino
caliente de las dos asignaciones.

### §5.5. `findParaAsignabilidad` — `lib/repositories/OrdenRepository.ts:2763-2782`

Gana la relación en el `select`:

```ts
autorizacionesSinUbicacion: { select: { direccionHash: true } },
```

y el `map` la aplana a `readonly string[]`. **Un join sobre un índice
(`orden_asignacion_sin_ubicacion(orden_id, created_at)`), cero consultas nuevas.** La tabla tendrá
del orden de unidades de filas por orden en el peor caso imaginable.

> ⚠️ **Esto es SQL y los dobles no lo ven.** Un test de servicio con un doble de
> `findParaAsignabilidad` devuelve lo que le digas, así que **no puede** demostrar que el `select`
> proyecte la relación. La verificación real de este `select` va en
> `tests/integration/db/orden-asignacion-sin-ubicacion-migration.test.ts` contra Postgres, junto
> con la de R16 (huella distinta → la fila existe pero no aplica). Sin `DATABASE_URL` ese archivo
> se **salta**, no falla: hay que mirar los `skipped` del gate, no solo el `INIT_EXIT`.

### §5.6. Los dos writers — un contador más, nada más

`GuiaAsignacionService.gateCoordenadas` (`:197-220`) y el bloque `4b` de
`AsignacionSateliteService.asignar` (`:273-290`) añaden, **sobre el mismo `Map` que ya recorren**:

```ts
if (estado === "asignable_sin_ubicacion_autorizada") sinUbicacionAutorizada += 1;
```

antes del `if (esAsignable(estado)) continue;`, exactamente como la 400 hizo con `sinUbicacion`.

Los resultados `ok` y `partial` ganan `sinUbicacionAutorizada?: number`, **campo hermano** de
`sinUbicacion` y de `bloqueadas` (nunca anidado), presente **solo si es mayor que cero** — así
ningún `toEqual({ status: "ok", resultados })` vigente se rompe (R27, patrón aditivo de la 400).

Las dos cifras son **disjuntas por construcción**: son dos estados distintos de una unión cerrada
y cada orden tiene exactamente uno (R17).

**`conflict` no lleva ninguna de las dos**: ahí no se asignó nada.

### §5.7. Borde — Server Action nueva

`lib/actions/autorizar-asignacion-sin-ubicacion.ts`:

```ts
"use server";
export async function autorizarAsignacionSinUbicacion(
  input: unknown,
  deps: AutorizarSinUbicacionDeps = {},
): Promise<AutorizarSinUbicacionResult>
```

Mismo molde que `asignarDesdeBodega` (`lib/actions/ordenes-guia.ts:123-135`): sesión **antes** del
schema (R6), `withErrorHandler`, zod en el borde, `forbidden`/`conflict` como resultados de
dominio y nunca como excepción, y `deps` para inyectar el service en tests.

Es una **Server Action** y no un route handler: es una mutación interna desde un componente propio
(`docs/architecture.md`, tabla «Server Actions vs Route Handlers»).

Schema y tipos del contrato cliente: `lib/types/autorizacion-sin-ubicacion.ts` (nuevo).

```ts
export const autorizarSinUbicacionSchema = z.object({
  ordenIds: z.array(z.string().uuid()).min(1),
}).strict();
```

`.strict()` (precedente: `obtenerUbicacionOrdenSchema`, `lib/actions/corregir-datos-cliente.ts:69`)
para que nadie cuele campos por aquí. `.min(1)`: un lote vacío no es una petición válida —misma
cota que el resto de acciones de lote del repo—.

---

## §6. Los textos. **Esto es contrato, no decoración**

El aviso vigente de la 400 dice: «…por un problema del sistema, **no de la dirección**»
(`geocodificacion-motivo-messages.ts:149-150`). **Aquí sí es la dirección**, así que reutilizarlo
sería **falso**. Esta ficha necesita texto propio, y va fijado a mano.

Todos los literales viven en `app/(app)/_components/geocodificacion-motivo-messages.ts`, que ya es
el único vocabulario compartido de los dos modales y está vigilado por un guardia
(`geocodificacion-motivo-por-orden-mismo-modulo.guardia.test.ts`).

### §6.1. Antes de confirmar la autorización (R21) — la consecuencia declarada

```
MSG_CONSECUENCIA_AUTORIZAR_SIN_UBICACION =
"El mapa no reconoce esta dirección, así que la orden no tiene un punto en el mapa. Si autorizas, se podrá asignar a un mensajero: aparecerá al final de su lista de entregas y no se tendrá en cuenta al calcular el orden del recorrido. Autoriza solo si el mensajero puede llegar con las indicaciones de la dirección."
```

Cada afirmación es verificable en el código: «no se tendrá en cuenta al calcular el orden del
recorrido» = `OptimizacionRutaService:226` (se excluye del cálculo, sin abortarlo); «aparecerá al
final de su lista de entregas» = paradas sin posición (92/R28). Sin siglas, sin jerga interna, sin
mencionar geocodificación ni proveedor: al operador le da igual cómo se llama el servicio.

### §6.2. Después de asignar (R18/R19/R20) — el aviso agregado

```ts
export function mensajeAsignadasSinUbicacionAutorizada(n: number): string {
  if (n <= 0) return "";
  return n === 1
    ? "1 orden se asignó sin ubicación en el mapa porque se autorizó hacerlo. Aparecerá al final de la lista de entregas del mensajero."
    : `${n} órdenes se asignaron sin ubicación en el mapa porque se autorizó hacerlo. Aparecerán al final de la lista de entregas del mensajero.`;
}
```

Espejo estructural de `mensajeAsignadasSinUbicacion` y **cifra agregada y nada más**: la función
recibe un `number`, así que por este canal **no puede** viajar una guía, un id ni una dirección
(R22). `n <= 0` → cadena vacía: sin órdenes en esa condición no hay aviso.

**Por qué existe este segundo aviso y no basta con el de §6.1.** Tres razones medibles: (a) quien
autoriza y quien asigna pueden ser personas distintas y la autorización **persiste** entre
sesiones; (b) callarlo dejaría al que asigna sin saber que ese lote entra degradado; (c)
reutilizar el de la 400 sería mentir. Las tres se cierran con una cifra propia y un texto propio.

### §6.3. Los desenlaces por orden (R25)

Vocabulario **cerrado**, con el mismo patrón de exhaustividad que la 400 (`Record<…, string>`, de
forma que un motivo nuevo sin texto **no compile**):

| motivo | mensaje |
| --- | --- |
| `ya_autorizada` | `"Esta orden ya estaba autorizada."` |
| `ya_asignable` | `"Esta orden ya se puede asignar: no hace falta autorizar nada."` |
| `todavia_se_esta_ubicando` | **reusa** `MSG_DIRECCION_EN_VALIDACION` («La dirección aún se está validando. Vuelve a intentarlo en unos minutos.») — cierto aquí |
| `fallo_del_servicio_de_mapas` | **reusa** `MSG_UBICACION_NO_VERIFICADA` — cierto aquí |
| `zona_ajena` | `"Esta orden es de otra zona. Solo puedes autorizar órdenes de la tuya."` |
| `orden_no_disponible` | `"No se encontró esta orden."` |

Etiqueta del control: `"Autorizar asignación sin ubicación"`.

---

## §7. Frontend: los dos modales

### §7.1. Dónde aparece la autorización, y por qué en los dos caminos

En el caso medido el operador selecciona **una** orden, el gate la bloquea, `asignables.length ===
0` y el writer devuelve **`conflict`** — que hoy el modal **lanza** al canal de error del `Modal`
(`AsignarBodegaModal.tsx:176-178`). Si la autorización solo viviera en la fase «resultado» (la del
`partial`), **el caso que origina la ficha no la vería nunca**. Por eso R23 exige las dos rutas.

Cambio en `handleConfirm`, **aditivo y sin alterar el comportamiento de error**:

```ts
const bloqueadasDelGate = result.status === "partial" ? result.bloqueadas
  : result.status === "conflict" ? result.detalle : [];
setAutorizables(
  bloqueadasDelGate
    .filter((b) => esMotivoAutorizableSinUbicacion(b.motivo))
    .map((b) => ({ ordenId: b.ordenId, numRemision: numRemisionPorId.get(b.ordenId) ?? b.ordenId })),
);
if (result.status !== "ok" && result.status !== "partial") throw result;   // ← intacto
```

El `setState` ocurre **antes** del `throw`, así que el toast de error sigue saliendo igual y el
modal —`closeOnConfirm={false}`— sigue abierto con el panel de autorización pintado debajo.

**El modal NUNCA cita un literal del gate.** Usa `esMotivoAutorizableSinUbicacion`, importado del
módulo compartido. Esto no es preferencia estética: el guardia vigente
(`geocodificacion-motivo-por-orden-mismo-modulo.guardia.test.ts:89-101`) **falla en rojo** si el
código real de cualquiera de los dos modales contiene `"direccion_no_geocodificable"` como
string. La lista de ese guardia (`MOTIVOS_DEL_GATE`, `:39-47`) está escrita a mano y hay que
añadirle el octavo estado (T13).

### §7.2. El panel

1. La lista de órdenes autorizables por `numRemision` (nunca uuid, nunca dirección — R25/R22).
2. El literal de §6.1, visible **antes** de confirmar (R21), con `role="alert"`.
3. Un control «Autorizar asignación sin ubicación» que llama a la Server Action.
4. Al volver: una entrada por orden con su desenlace (§6.3), y la indicación de que ya se puede
   volver a pulsar «Asignar».

**Autorizar NO asigna** (R26): no se dispara ninguna llamada a `asignarDesdeBodega` /
`asignarDesdeSatelite` como efecto de autorizar. Ver §9 alternativa A8.

### §7.3. El aviso agregado tras asignar

Se concatena a la MISMA frase que ya construyen los dos modales (`AsignarBodegaModal.tsx:204-212`,
`AsignarSateliteModal.tsx:175-183`), junto al de la 400 y con el mismo criterio: solo si la cifra
es mayor que cero. Jamás dentro de la lista de `bloqueadas` — esas órdenes NO recibieron mensajero
y éstas SÍ.

---

## §8. La vuelta atrás: qué pasa si alguien corrige la dirección

La ficha 327 dejó una sola implementación del guard
(`OrdenRepository.encolarSiCambiaDireccion`, `:1768-1776`): si la escritura cambia **efectivamente**
la dirección, se encola una geocodificación. Con eso, y sin escribir una línea más:

1. **La autorización deja de aplicar en el acto.** La huella guardada es la de la dirección vieja;
   `hashDireccion` de la nueva no coincide, y el gate vuelve a `direccion_no_geocodificable`
   (R16). **Es la dirección correcta del error**: nadie ha juzgado la dirección nueva.
2. **La fila NO se borra ni se toca** (R11). Sigue diciendo quién autorizó qué dirección y cuándo.
   Un `UPDATE`/`DELETE` aquí sería exactamente la «corrupción muda» que el propio esquema
   documenta.
3. **Si la geocodificación nueva tiene éxito**, la orden gana coordenadas y **R2 gana antes de
   llegar a nada de esto** (R15): la autorización queda inerte sola, sin ningún acto de limpieza.
4. **Si vuelve a fallar de forma determinista**, la orden queda bloqueada otra vez y hace falta
   una autorización nueva sobre la dirección nueva — que deja **su propia fila**.

> **Dato verificado, y conviene decirlo porque sorprende:** corregir la dirección **no limpia**
> `geocode_status` (`OrdenRepository` no lo escribe en ningún camino de corrección; la única
> proyección que lo lee es `findParaAsignabilidad:2772`). Así que entre la corrección y el fin del
> job nuevo, el gate sigue viendo el `ZERO_RESULTS` viejo y clasifica
> `direccion_no_geocodificable`. **Es comportamiento preexistente del gate, no algo que esta ficha
> introduzca**, y **no se toca aquí**: es exactamente el arreglo-mínimo que este repo exige. Lo que
> sí importa para nosotros es que en esa ventana la autorización **tampoco** aplica, porque la
> huella ya no coincide. El lado seguro.

---

## §9. Alternativas descartadas

**A1 — Fijar las coordenadas a mano en un mapa.**
**Descartada por decisión del humano (2026-09-10):** la vía elegida es autorizar la asignación. Y
tiene su propio coste: exige una pantalla de mapa, decidir quién puede mover un pin, y produce un
dato que **parece** medido y no lo es —un `APPROXIMATE` inventado que después alimenta la
optimización de ruta y el cobro por distrito—. El propio repo ya rechazó esa clase de dato:
«geocodificar solo con catálogo devolvería el centroide del cantón, un APPROXIMATE inútil que
cuesta dinero y ensucia el dato con coordenadas que PARECEN válidas»
(`lib/geo/direccion-query.ts:39-41`). Queda **expresamente fuera de alcance**.

**A2 — Autorización efímera dentro de la propia llamada de asignación**
(`asignarBodegaSchema` gana `autorizarSinUbicacionIds: string[]`).
Descartada por tres razones. (i) Mete «sáltate el gate» **en el contrato de entrada de la
asignación**: una petición fabricada podría desactivar la guarda para un lote arbitrario en un
solo acto. Con la vía elegida, saltarse el gate exige un acto **aparte, autorizado y registrado**.
(ii) Obligaría a cambiar la firma de `IAsignabilidadCoordenadasService.evaluar` y los dos esquemas
de entrada — más superficie, no menos. (iii) Perdería el rastro entre reintentos: si la asignación
se cae por una carrera, la decisión humana se evapora.

**A3 — Reutilizar `asignable_sin_ubicacion` (el estado de la 400).**
Descartada: es el corazón del problema. Ese estado arrastra el texto «por un problema del sistema,
**no de la dirección**», que aquí es **falso**; y las dos cifras quedarían indistinguibles, así que
nadie podría medir cuántas órdenes salen degradadas por decisión humana y cuántas por avería
nuestra. Dos causas distintas, dos estados, dos textos.

**A4 — Dos columnas en `orden` (`autorizada_por`, `autorizada_at`).**
Descartada: la evidencia sería **mutable**. Habría que ponerlas a `NULL` al corregir la dirección
—borrando en silencio quién decidió qué— y una segunda autorización pisaría la primera. Es
literalmente el patrón que el esquema de este repo llama corrupción muda. Además ensancha la tabla
más caliente del sistema para un fenómeno de 2 filas.

**A5 — Una fila en `historial_accion` (ficha 362) como ÚNICO rastro.**
Descartada **con pregunta abierta** (Q1 de `requirements.md`): autorizar no mueve dinero, no hace
desaparecer nada y no cambia quién puede hacer qué, y R17 de la 362 exige exactamente una
categoría por tipo. Forzar una categoría pondría una etiqueta falsa en el listado transversal. La
tabla propia es el camino que ya tomaron la 262 y la 371 por un motivo emparentado. **Lo que no se
hace es decidirlo solo**: si el humano quiere además la fila transversal, hay que elegir su
categoría, y eso es suyo.

**A6 — Una familia nueva de `orden_historial_estado.origen_tipo`.**
Descartada: esa tabla registra **transiciones de estado** y autorizar **no es una transición** —la
orden sigue exactamente donde estaba—. La fila necesitaría un `estatus_destino_id` inventado, y
una fila falsa `en_bodega_satelite -> en_bodega_satelite` es precisamente lo que el esquema
documenta que rompe «Deshacer asignación» (`findOrigenesReversion` elige con `DISTINCT ON`) y el
conteo de intentos.

**A7 — Reintentar la geocodificación de esas órdenes (o cambiar de proveedor para ellas).**
Descartada: el desenlace es **determinista**. `GeocodificacionService` **completa** el job en los
tres casos deterministas —no lo deja `failed`—, y la cabecera del gate ya explica que un gate que
reintentara «volvería a encolar, el job volvería a terminar `done` sin coordenadas, y así en bucle
— PAGANDO una llamada al proveedor cada vez» (`AsignabilidadCoordenadasService:43-50`). Reintentar
cuesta dinero y no cambia nada.

**A8 — Reasignar automáticamente después de autorizar.**
Descartada: escondería **dos escrituras detrás de un clic**, con el mensajero y el día que
quedaron en el estado del modal, y en la ruta `partial` una parte del lote ya está asignada. El
operador vuelve a pulsar «Asignar», que es un acto explícito y ya existente. Coste declarado: una
pulsación más.

**A9 — Quitar `ZERO_RESULTS` de `STATUS_DETERMINISTAS`.**
Descartada: es un cambio de dos caracteres que mete **todas** las direcciones irresolubles en las
rutas sin que nadie decida nada, que es exactamente lo que el gate de la feature 92 existe para
impedir. La ficha quiere una **excepción con nombre y apellido**, no la retirada de la regla.

---

## §10. Archivos de producción que toca esta ficha

**Para que el leader pueda secuenciar.** La **405** está viva en
`lib/services/ApiOrdenLecturaService.ts`, `lib/repositories/OrdenRepository.ts`,
`lib/types/api-orden.ts` y los tres artefactos del contrato público; la **406** entrará después en
`lib/services/WebhookEstadoService.ts` y esos mismos artefactos.

**Solapamiento real: exactamente uno — `lib/repositories/OrdenRepository.ts`** (esta ficha toca
`findParaAsignabilidad`, `:2763-2782`; la 405 toca la lectura de gestiones). Son métodos
distintos del mismo archivo: conflicto de merge posible, conflicto semántico no. **Todo lo demás
es disjunto.**

### Backend (van primero)

| # | Archivo | Cambio |
| --- | --- | --- |
| 1 | `db/schema.prisma` | modelo `OrdenAsignacionSinUbicacion` + 2 back-relations |
| 2 | `db/migrations/20260910120000_orden_asignacion_sin_ubicacion/migration.sql` | **nuevo** |
| 3 | `db/migrations/20260910120000_orden_asignacion_sin_ubicacion/down.sql` | **nuevo** |
| 4 | `lib/interfaces/services/IAsignabilidadCoordenadasService.ts` | estado nuevo, `EstadoAsignable`, `OrdenAsignabilidadRow`, lista de motivos autorizables |
| 5 | `lib/services/AsignabilidadCoordenadasService.ts` | el `if` dentro de R3 + `esAsignable` + cabecera |
| 6 | `lib/repositories/OrdenRepository.ts` | `findParaAsignabilidad` proyecta la relación ⚠️ **solapa con la 405** |
| 7 | `lib/interfaces/repositories/IOrdenRepository.ts` | docstring de `findParaAsignabilidad` |
| 8 | `lib/interfaces/repositories/IAutorizacionSinUbicacionRepository.ts` | **nuevo** |
| 9 | `lib/repositories/AutorizacionSinUbicacionRepository.ts` | **nuevo** |
| 10 | `lib/interfaces/services/IAutorizarAsignacionSinUbicacionService.ts` | **nuevo** |
| 11 | `lib/services/AutorizarAsignacionSinUbicacionService.ts` | **nuevo** |
| 12 | `lib/types/autorizacion-sin-ubicacion.ts` | **nuevo** (zod + tipo resultado cliente) |
| 13 | `lib/actions/autorizar-asignacion-sin-ubicacion.ts` | **nuevo** (Server Action + composition root) |
| 14 | `lib/services/GuiaAsignacionService.ts` | segundo contador en `gateCoordenadas` |
| 15 | `lib/services/AsignacionSateliteService.ts` | segundo contador en el bloque `4b` |
| 16 | `lib/interfaces/services/IGuiaAsignacionService.ts` | `sinUbicacionAutorizada?: number` |
| 17 | `lib/interfaces/services/IAsignacionSateliteService.ts` | idem |
| 18 | `lib/types/orden-guia.ts` | idem (espejo cliente) |
| 19 | `lib/types/recepcion-satelite.ts` | idem (espejo cliente) |

### Frontend (después del backend)

| # | Archivo | Cambio |
| --- | --- | --- |
| 20 | `app/(app)/_components/geocodificacion-motivo-messages.ts` | literales de §6.1/§6.2/§6.3 + re-export del predicado |
| 21 | `app/(app)/ordenes/_components/AsignarBodegaModal.tsx` | panel de autorización + aviso agregado |
| 22 | `app/(app)/recepcion-satelite/_components/AsignarSateliteModal.tsx` | espejo exacto |

### Tests (no producción, pero hay que tocarlos)

`tests/unit/guards/geocodificacion-motivo-por-orden-mismo-modulo.guardia.test.ts` (su
`MOTIVOS_DEL_GATE` escrito a mano gana el octavo estado), más los nuevos listados en el mapa de
`requirements.md`.

**No se toca:** `feature_list.json`, `progress/`, `IJobRepository`, `asignarBodegaLote`,
`asignarSateliteLote`, `OptimizacionRutaService`, `MisAsignacionesService`, ni nada de la 405/406
salvo el archivo 6.

---

## §11. Verificación: lo que NO vale como evidencia aquí

- **Los tests de servicio con dobles no ven el `select` de Prisma.** La proyección de §5.5 se
  verifica **solo** en `tests/integration/db/`. Un doble que devuelva `autorizacionesSinUbicacion:
  ["abc"]` demuestra que el gate sabe leer un array, no que el repositorio lo traiga.
- **El texto se compara contra el literal ESCRITO A MANO en el test**, copiado de §6.1/§6.2 —
  nunca contra la constante exportada. Comparar un texto contra la función que lo genera está
  **siempre verde** y ya dejó pasar un defecto en este repo.
- **`./init.sh --rapido` se va a negar** (toca `db/schema.prisma`, `db/migrations/**` y
  `lib/types/**`). El gate de esta ficha es `./init.sh` completo, y hay que **mirar los
  `skipped`**: sin `DATABASE_URL` los archivos de `tests/integration/db` se saltan y el test que
  demuestra R10/R11/R13/R16/R28 **no se ejecuta**, aunque la corrida termine en verde.
- **Un grep sobre un comentario no es un criterio de hecho.** Cada task de `tasks.md` cierra con
  una aserción que se pone roja si el código está mal.
</content>
