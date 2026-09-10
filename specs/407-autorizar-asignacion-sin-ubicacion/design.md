# 407 — Diseño: autorizar la asignación de una orden sin ubicación

> Todo lo que este documento afirma sobre el código vigente está **verificado en el archivo
> real**, no en el índice del grafo (que devuelve de más). Las citas llevan archivo y línea.
>
> **Versión 2 (2026-09-10), tras la puerta humana.** El humano decidió que **no hace falta
> rastro**: la autorización deja de persistirse y pasa a ser un **parámetro de la propia acción de
> asignar**. Esta versión elimina la tabla, la migración, el repositorio, el servicio y la Server
> Action que existían solo para guardarla. Lo que se decidió y por qué está en §8-A1.

---

## §0. El hallazgo que decide el diseño: aguas abajo YA está resuelto

`lib/services/OptimizacionRutaService.ts:223-229` (feature 92, R37):

```ts
const todas = await this.paradasRepo.findParadasEnReparto(mensajeroId);
// R37: las ordenes SIN coordenadas se EXCLUYEN de la optimizacion, no la abortan.
// Quedan como paradas sin posicion (R28) y la lectura las muestra al final.
const conCoordenadas = todas.filter(...)
```

Y `lib/interfaces/repositories/IOrdenRepository.ts:1552-1556`: «una orden sin coordenadas **NO se
excluye aquí**, el service la registra como parada sin posición». La lectura del mensajero
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
| `AsignarBodegaInput.dia?` | `lib/interfaces/services/IGuiaAsignacionService.ts:18-33` | el **patrón aditivo** que copia esta ficha para su campo nuevo |

**Esta ficha añade una SEGUNDA puerta de entrada a ese mismo carril.** La diferencia sustantiva
con la 400: aquella la abre **el sistema** por un fallo propio; ésta la abre **una persona a
sabiendas**. Por eso son dos estados distintos, dos cifras distintas y dos textos distintos (§5).

---

## §2. Forma de la solución, en una frase

La petición de asignación puede traer un **conjunto de ids autorizados**; el gate, **dentro de su
rama R3 y solo ahí**, convierte `direccion_no_geocodificable` en un estado **asignable nuevo** para
los ids de ese conjunto; los dos writers cuentan ese estado en una cifra propia; los dos modales
lo ofrecen tras un intento bloqueado y lo cuentan con un texto propio que no miente.

**Nada se guarda.** El conjunto vive lo que vive la petición.

**Lo que NO cambia:** el orden del árbol de decisión del gate, `findParaAsignabilidad`,
`OrdenRepository`, `IJobRepository`, `asignarBodegaLote`, `asignarSateliteLote`, el esquema de la
base, y el comportamiento entero del sistema mientras ninguna petición traiga la marca (R5).

---

## §3. Backend

### §3.1. El contrato del gate — `lib/interfaces/services/IAsignabilidadCoordenadasService.ts`

1. **Un valor más** en `EstadoAsignabilidad`:

```ts
/**
 * FICHA 407: no tiene coordenadas y su dirección es irresoluble, pero la petición de asignación
 * trae la autorización EXPLÍCITA de una persona para asignarla igual. Se puede asignar; entra en
 * el modo degradado que ya existe (92 R37/R28/R30). NO SE PERSISTE: vale para esta petición y
 * para ninguna más (R9).
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
   sigue compilando**. Olvidarse ahí es un fallo mudo: el gate devolvería el estado nuevo y los
   writers lo tratarían como bloqueante. Por eso hay un caso explícito en `tasks.md` T3.

3. **`evaluar` gana un segundo parámetro OPCIONAL**:

```ts
evaluar(
  ordenes: OrdenAsignabilidadRow[],
  /**
   * FICHA 407 — los ids que la petición autoriza a asignar SIN ubicación. Efímero por decisión
   * del humano (2026-09-10): no se persiste, no se lee de la base, no sobrevive a la llamada.
   * Ausente o vacío = comportamiento idéntico al previo a esta ficha (R5).
   */
  autorizadasSinUbicacion?: ReadonlySet<string>,
): Promise<Map<string, EstadoAsignabilidad>>;
```

   **Por qué un parámetro y no un campo en `OrdenAsignabilidadRow`:** esa fila es una **proyección
   de la base** (`findParaAsignabilidad`), y «esta persona lo autorizó» no es un hecho de la base.
   Meterlo ahí obligaría al repositorio a inventarse un campo que no puede leer, o al writer a
   mutar filas que no le pertenecen. Como parámetro opcional, además, **los dobles de test
   existentes siguen compilando**: en TypeScript una implementación con menos parámetros es
   asignable a una firma con más.

4. **La lista de motivos autorizables, en su único sitio**:

```ts
/**
 * FICHA 407 (R2/R17) — los estados del gate que una persona PUEDE autorizar. Vive aquí, en el
 * contrato, y NO en el servicio ni en el modal, porque lo consultan los DOS lados: el gate para
 * decidir y los modales para no ofrecer lo que el servidor va a negar (lección de la 271). Es un
 * módulo sin dependencias de runtime, así que un componente cliente puede importarlo sin
 * arrastrar Prisma ni `node:crypto`.
 *
 * Escrita a mano y NO derivada: el defecto seguro es «no autorizable». Un estado nuevo que nadie
 * clasifique se queda fuera, que es el lado correcto en el que equivocarse.
 */
export const MOTIVOS_AUTORIZABLES_SIN_UBICACION: readonly EstadoBloqueante[] = [
  "direccion_no_geocodificable",
];
export function esMotivoAutorizableSinUbicacion(motivo: string): boolean { ... }
```

   **Y no puede divergir del servidor por accidente**: `tasks.md` T3 exige un test que, para
   **cada** valor de `EstadoBloqueante`, compruebe que `esMotivoAutorizableSinUbicacion(m)` es
   `true` **si y solo si** alimentar al gate una fila en ese estado **con la marca** la vuelve
   asignable. Ata el predicado de la UI al comportamiento real del gate, sin copiar nada.

### §3.2. El paso del gate — `lib/services/AsignabilidadCoordenadasService.ts`

**Un `if` DENTRO de la rama R3**, y en ningún otro sitio:

```ts
if (orden.geocodeStatus !== null && STATUS_DETERMINISTAS.has(orden.geocodeStatus)) {
  // FICHA 407: la autorización explícita de una persona, válida SOLO para esta petición.
  resultado.set(
    orden.id,
    autorizadasSinUbicacion.has(orden.id)
      ? "asignable_sin_ubicacion_autorizada"
      : "direccion_no_geocodificable",
  );
  continue;
}
```

**Por qué DENTRO de R3 y no como paso propio.** Es la decisión estructural de la ficha, y con el
rastro fuera es aún más barata: **es todo lo que hay**.

- **No puede ganarle a R2.** Si la orden tiene coordenadas, R2 ya salió con `asignable` antes de
  llegar aquí, así que la marca no tiene ningún efecto observable (R4).
- **No puede tocar R5, R6 ni R7.** Un paso propio antes de la cola dejaría la puerta abierta a que
  la marca se comiera un `geocodificacion_en_curso`, que **no es definitivo** y todavía puede
  resolverse solo. Dentro de R3 eso es **estructuralmente imposible**: esos estados se calculan en
  otra rama a la que este código no llega (R2 del requirements).
- **R3 del requirements sale gratis:** el bucle solo recorre las órdenes recibidas, así que un id
  marcado que no esté en el lote **no tiene dónde aplicarse**.
- **Cero consultas nuevas y cero lecturas nuevas.** Es una consulta a un `Set` en memoria.
- **El orden del árbol de decisión sigue siendo normativo** y no se reordena. La cabecera del
  archivo se amplía con la fila nueva, como hicieron la 368 y la 400.

`esAsignable` gana el tercer valor en su lista. El parámetro se recibe con
`= new Set<string>()` por defecto, de modo que un llamador que no lo pase obtiene exactamente el
comportamiento previo (R5).

### §3.3. Qué **NO** puede hacer la marca — y por qué eso basta sin rastro

Este es el punto que hay que leer entero antes de aprobar un parámetro que desactiva una guarda.

| Riesgo | Por qué no se materializa |
| --- | --- |
| Saltarse el gate para órdenes ajenas | Los dos writers evalúan rol, zona, estado de origen, mensajero, cierres y tope de intentos **antes** del gate (`GuiaAsignacionService:405-490`, `AsignacionSateliteService:104-251`). La marca solo puede afectar a órdenes que ese actor **ya podía asignar** (R6/R7). |
| Saltarse OTRO motivo de bloqueo | El `if` vive dentro de la rama R3. Los estados de cola se calculan en otra rama a la que ese código **no llega** (R2). |
| Afectar a órdenes de otra petición | El conjunto se pasa por parámetro y el bucle solo recorre `ordenes`. No hay estado compartido entre llamadas (R3/R9). |
| Quedar «pegada» y desactivar la guarda para siempre | **Nada se persiste.** La siguiente petición sin marca vuelve a bloquear (R9). Es la propiedad que la decisión de no guardar rastro **regala**. |
| Colarse por un cliente fabricado | Puede, dentro de los límites de arriba: un `POST` a la Server Action con la marca hace lo mismo que el modal. Es aceptado: el actor ya podía asignar esas órdenes, y el efecto es una orden en ruta sin punto en el mapa, que el sistema soporta desde la feature 92. **Sin rastro, no habrá forma de saber quién lo hizo** — decisión del humano, §8-A1. |

### §3.4. Los dos writers

**Entrada.** `AsignarBodegaInput` (`IGuiaAsignacionService.ts:18-33`) y `AsignarSateliteInput`
(`IAsignacionSateliteService.ts:15-25`) ganan, con el **mismo patrón aditivo de `dia?`**:

```ts
/**
 * FICHA 407 — ids de este mismo lote que la persona autoriza a asignar SIN ubicación. Opcional:
 * ausente significa «ninguna», nunca «todas». Efímero: no se guarda en ningún sitio.
 */
autorizarSinUbicacionIds?: string[];
```

**Clasificación.** `gateCoordenadas` (`GuiaAsignacionService:197-220`) gana un segundo parámetro y
lo reenvía a `evaluar`; el bloque `4b` de `AsignacionSateliteService` (`:273-290`) hace lo mismo en
línea. Ambos construyen el `Set` con `new Set(input.autorizarSinUbicacionIds ?? [])`.

**Cuenta.** Sobre el **mismo `Map` que ya recorren**, antes del `if (esAsignable(estado)) continue;`:

```ts
if (estado === "asignable_sin_ubicacion_autorizada") sinUbicacionAutorizada += 1;
```

exactamente como la 400 hizo con `sinUbicacion`.

**Salida.** `ok` y `partial` ganan `sinUbicacionAutorizada?: number`, **campo hermano** de
`sinUbicacion` y de `bloqueadas` (nunca anidado), presente **solo si es mayor que cero** — así
ningún `toEqual({ status: "ok", resultados })` vigente se rompe (R5, patrón aditivo de la 400). Las
dos cifras son **disjuntas por construcción**: son dos estados distintos de una unión cerrada y
cada orden tiene exactamente uno (R11). `conflict` no lleva ninguna de las dos: ahí no se asignó
nada.

### §3.5. El borde

`lib/types/orden-guia.ts` (`asignarBodegaSchema`, `:29-42`) y `lib/types/recepcion-satelite.ts`
(`asignarSateliteSchema`, `:226-236`) ganan:

```ts
autorizarSinUbicacionIds: z.array(z.string().uuid()).default([]),
```

`.default([])` y no obligatorio, por el mismo motivo que `dia` lo tiene: una petición sin el campo
se comporta **exactamente** como antes de esta ficha (R5). Y los espejos cliente
(`AsignarBodegaResult`, `AsignarSateliteResult`) ganan `sinUbicacionAutorizada?: number`.

**No hay Server Action nueva.** Autorizar no es un acto separado: **es la misma llamada que
asigna**. Esa es la decisión del humano y es lo que hace que esta ficha no tenga borde propio, ni
servicio propio, ni repositorio propio.

**`lib/actions/ordenes-guia.ts` y `lib/actions/recepcion-satelite.ts` NO se tocan**: ambas hacen
`schema.parse(input)` y pasan el resultado al service tal cual, así que el campo nuevo viaja solo.

---

## §4. Frontend: los dos modales

### §4.1. Dónde aparece la autorización, y por qué en los dos caminos

En el caso medido el operador selecciona **una** orden, el gate la bloquea, `asignables.length ===
0` y el writer devuelve **`conflict`** — que hoy el modal **lanza** al canal de error del `Modal`
(`AsignarBodegaModal.tsx:176-178`). Si la autorización solo viviera en la fase «resultado» (la del
`partial`), **el caso que origina la ficha no la vería nunca**. Por eso R16 exige las dos rutas.

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
modal —`closeOnConfirm={false}`— sigue abierto con el panel pintado debajo.

**El modal NUNCA cita un literal del gate.** Usa `esMotivoAutorizableSinUbicacion`, importado del
módulo compartido. Esto no es preferencia estética: el guardia vigente
(`geocodificacion-motivo-por-orden-mismo-modulo.guardia.test.ts:89-101`) **falla en rojo** si el
código real de cualquiera de los dos modales contiene `"direccion_no_geocodificable"` como string.
Su lista (`MOTIVOS_DEL_GATE`, `:39-47`) está escrita a mano y hay que añadirle el octavo estado.

### §4.2. El panel, y la segunda petición

El panel muestra:

1. las órdenes autorizables por `numRemision` (nunca uuid, nunca dirección — R19/R15);
2. el literal de §5.1, visible **antes** de confirmar (R14), con `role="alert"`;
3. un control **«Autorizar y asignar sin ubicación»**.

Al pulsarlo se lanza **una sola** petición (R18) con:

```ts
{ ordenIds: autorizables.map(a => a.ordenId),
  mensajeroId,                       // el ya elegido, del estado del modal
  dia,                               // el ya elegido
  autorizarSinUbicacionIds: autorizables.map(a => a.ordenId) }
```

**Por qué acotada a las autorizables y no al lote entero.** En la ruta `partial` una parte del lote
**ya se asignó**: reenviar esas órdenes las encontraría en `por_recoger` y el writer abortaría el
lote entero con `estado de origen no permitido`. Acotar es lo único correcto en las dos rutas, así
que el modal hace lo mismo en ambas y no hay dos caminos que mantener.

**El manifiesto acumula** (R20): `ManifiestoResultado` recibe la **unión** de lo asignado en las
dos peticiones. Si solo recibiera lo de la última, el operador se descargaría un manifiesto al que
le faltan las órdenes de la primera — un fallo mudo, de los que este repo ya ha pagado varias
veces.

### §4.3. El aviso agregado tras asignar

Se concatena a la MISMA frase que ya construyen los dos modales (`AsignarBodegaModal.tsx:204-212`,
`AsignarSateliteModal.tsx:175-183`), junto al de la 400 y con el mismo criterio: solo si la cifra
es mayor que cero. Jamás dentro de la lista de `bloqueadas` — esas órdenes NO recibieron mensajero
y éstas SÍ.

---

## §5. Los textos. **Esto es contrato, no decoración**

El aviso vigente de la 400 dice: «…por un problema del sistema, **no de la dirección**»
(`geocodificacion-motivo-messages.ts:149-150`). **Aquí sí es la dirección**, así que reutilizarlo
sería **falso**. Los dos literales de abajo están **aprobados por el humano el 2026-09-10 tal
cual** y no se tocan.

Viven en `app/(app)/_components/geocodificacion-motivo-messages.ts`, que ya es el único
vocabulario compartido de los dos modales y está vigilado por un guardia.

### §5.1. Antes de confirmar (R14) — la consecuencia declarada

```
MSG_CONSECUENCIA_AUTORIZAR_SIN_UBICACION =
"El mapa no reconoce esta dirección, así que la orden no tiene un punto en el mapa. Si autorizas, se podrá asignar a un mensajero: aparecerá al final de su lista de entregas y no se tendrá en cuenta al calcular el orden del recorrido. Autoriza solo si el mensajero puede llegar con las indicaciones de la dirección."
```

Cada afirmación es verificable en el código: «no se tendrá en cuenta al calcular el orden del
recorrido» = `OptimizacionRutaService:226` (se excluye del cálculo, sin abortarlo); «aparecerá al
final de su lista de entregas» = paradas sin posición (92/R28). Sin siglas, sin jerga interna, sin
mencionar geocodificación ni proveedor: al operador le da igual cómo se llama el servicio.

### §5.2. Después de asignar (R10/R12/R13) — el aviso agregado

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
(R15). `n <= 0` → cadena vacía.

**Por qué existe este segundo aviso y no basta con el de §5.1**, ahora que el que autoriza y el que
asigna son la misma persona en la misma pulsación: porque el bloque de confirmación es **donde el
operador lee qué acaba de pasar**, y ahí solo caben tres opciones — callarlo (deja el lote
degradado sin decirlo), reutilizar el de la 400 (mentira), o el suyo propio. Es la tercera.

**Etiqueta del control:** `"Autorizar y asignar sin ubicación"`. Dice las dos cosas que hace, que
es exactamente lo que la decisión del humano convirtió en un solo acto. No es uno de los dos
literales aprobados, pero se fija aquí igual para que los tests puedan afirmar sobre él.

### §5.3. Los desenlaces por orden

**No hay vocabulario nuevo.** Los dos modales ya traducen el motivo de cada orden bloqueada con
`mensajeDireccionPorMotivo` (368/R11) y el panel solo filtra ese mismo listado. Al caer el acto de
autorización separado, cayeron con él los motivos `ya_autorizada`, `ya_asignable`, `zona_ajena` y
`orden_no_disponible` que la versión anterior de este diseño necesitaba: ahora los resuelven las
guardas que los writers ya tienen.

---

## §6. La vuelta atrás y el ciclo de vida

**No hay vuelta atrás que gestionar, y eso es la consecuencia buena de no guardar nada.**

1. **La marca no sobrevive a la petición.** No hay estado que invalidar, ni huella que comparar, ni
   fila que quede colgando (R9). La atadura a `hashDireccion` que la versión 1 de este diseño
   necesitaba **sobra**, y se ha retirado.
2. **Si alguien corrige la dirección** (ficha 327, `OrdenRepository.encolarSiCambiaDireccion`,
   `:1768-1776`), se encola una geocodificación nueva. Si tiene éxito, la orden gana coordenadas y
   **R2 del gate gana antes de llegar a nada de esto**: se asigna como cualquier otra.
3. **Si la orden se libera y vuelve a la bodega**, vuelve a estar bloqueada y **hay que volver a
   autorizarla** (R9). Es correcto y está escrito: cada asignación es una decisión nueva, y quien
   la toma la toma con el aviso de §5.1 delante.
4. **Lo que se pierde, dicho en voz alta:** nadie podrá responder «¿quién autorizó esta orden?»
   pasado el momento. Decisión del humano del 2026-09-10, §8-A1.

> **Dato verificado, y conviene decirlo porque sorprende:** corregir la dirección **no limpia**
> `geocode_status` (`OrdenRepository` no lo escribe en ningún camino de corrección; la única
> proyección que lo lee es `findParaAsignabilidad:2772`). Así que entre la corrección y el fin del
> job nuevo, el gate sigue viendo el `ZERO_RESULTS` viejo. **Es comportamiento preexistente del
> gate, no algo que esta ficha introduzca**, y **no se toca aquí**: es exactamente el
> arreglo-mínimo que este repo exige.

---

## §7. Verificación: lo que NO vale como evidencia aquí

- **El texto se compara contra el literal ESCRITO A MANO en el test**, copiado de §5.1/§5.2 —
  nunca contra la constante exportada. Comparar un texto contra la función que lo genera está
  **siempre verde** y ya dejó pasar un defecto en este repo.
- **`./init.sh --rapido` se va a negar igualmente**, y ahora por un solo motivo:
  `lib/types/orden-guia.ts` y `lib/types/recepcion-satelite.ts` están bajo `lib/types/**`
  (`docs/verification.md`, tabla «cuándo `--rapido` se niega»). El gate de esta ficha es
  **`./init.sh` completo**. Ver §9-3.
- **Esta ficha NO añade tests contra Postgres**, porque no toca ni una consulta: `findParaAsignabilidad`
  se queda como está. Aun así vale la advertencia general: si la corrida se hace sin
  `DATABASE_URL`, los archivos de `tests/integration/db` se **saltan** y hay que mirar los
  `skipped`, no solo el `INIT_EXIT`.
- **Un grep sobre un comentario no es un criterio de hecho.** Cada task cierra con una aserción que
  se pone roja si el código está mal.
- **Ojo con `not.toBeUndefined()` para la cifra ausente**: pasaría igual si la clave existiera con
  valor `undefined`. Se usa `expect(result).not.toHaveProperty("sinUbicacionAutorizada")`.

---

## §8. Alternativas descartadas

**A1 — Persistir la autorización en una tabla append-only con actor e instante.**
Es lo que proponía la versión 1 de este diseño: `orden_asignacion_sin_ubicacion` con `orden_id`,
`actor_usuario_id`, `created_at` y la huella de la dirección, siguiendo el patrón de
`orden_dia_reparto_cambio` (262) y `gestion_fecha_reprogramacion_cambio` (371).
**Descartada por el humano el 2026-09-10:** el fenómeno afecta a **2 órdenes en toda la base** y no
compensa una migración. Coste aceptado a sabiendas: **no se podrá responder «quién autorizó
esto»**.

Conviene conservar aquí **por qué no había una tercera opción barata**, porque es lo que hace que
la decisión sea entre «tabla nueva» y «nada», sin término medio:

- **`historial_accion` (ficha 362) no encajaba.** Autorizar **no mueve dinero**, **no hace
  desaparecer nada** y **no cambia quién puede hacer qué** — las tres categorías del catálogo—, y
  su R17 exige exactamente una categoría por tipo. Meterlo habría puesto una etiqueta falsa en el
  listado transversal.
- **`orden_historial_estado` (feature 49) tampoco.** Esa tabla registra **transiciones de estado**
  y autorizar **no es una transición**: la orden sigue exactamente donde estaba. La fila
  necesitaría un `estatus_destino_id` inventado, y una fila falsa `X -> X` es precisamente lo que
  el esquema documenta que rompe «Deshacer asignación» (`findOrigenesReversion` elige con
  `DISTINCT ON`) y el conteo de intentos.

Es decir: guardar el rastro costaba **una tabla nueva con su migración up/down, su RLS y su test
contra Postgres**, o nada. El humano eligió nada.

**A2 — Fijar las coordenadas a mano en un mapa.**
**Descartada por decisión del humano (2026-09-10):** la vía elegida es autorizar la asignación. Y
tiene su propio coste: exige una pantalla de mapa, decidir quién puede mover un pin, y produce un
dato que **parece** medido y no lo es. El propio repo ya rechazó esa clase de dato: «geocodificar
solo con catálogo devolvería el centroide del cantón, un APPROXIMATE inútil que cuesta dinero y
ensucia el dato con coordenadas que PARECEN válidas» (`lib/geo/direccion-query.ts:39-41`). Queda
**expresamente fuera de alcance**.

**A3 — Reutilizar `asignable_sin_ubicacion` (el estado de la 400).**
Descartada: es el corazón del problema. Ese estado arrastra el texto «por un problema del sistema,
**no de la dirección**», que aquí es **falso**; y las dos cifras quedarían indistinguibles, así que
nadie podría medir cuántas órdenes salen degradadas por decisión humana y cuántas por avería
nuestra. Dos causas distintas, dos estados, dos textos.

**A4 — Un acto de autorización separado del de asignar (dos peticiones).**
Descartada al caer el rastro: sin nada que guardar, una petición que solo «autoriza» **no tendría
ningún efecto que producir**. Autorizar y asignar pasan a ser el mismo acto, que además es más
honesto con el operador: pulsa una vez y ocurre una cosa.

**A5 — Un campo en `OrdenAsignabilidadRow` en vez de un parámetro de `evaluar`.**
Descartada: esa fila es una proyección de la base y «esta persona lo autorizó» no es un hecho de la
base. Obligaría al repositorio a inventarse un campo que no puede leer, o al writer a mutar filas
ajenas. Ver §3.1.3.

**A6 — Una familia nueva de `orden_historial_estado.origen_tipo`.**
Descartada por lo escrito en A1, y además **sin objeto** desde que no se guarda rastro.

**A7 — Reintentar la geocodificación de esas órdenes.**
Descartada: el desenlace es **determinista**. `GeocodificacionService` **completa** el job en los
tres casos deterministas —no lo deja `failed`—, y la cabecera del gate ya explica que un gate que
reintentara «volvería a encolar, el job volvería a terminar `done` sin coordenadas, y así en bucle
— PAGANDO una llamada al proveedor cada vez» (`AsignabilidadCoordenadasService:43-50`).

**A8 — Quitar `ZERO_RESULTS` de `STATUS_DETERMINISTAS`.**
Descartada: es un cambio de dos caracteres que mete **todas** las direcciones irresolubles en las
rutas sin que nadie decida nada, que es exactamente lo que el gate de la feature 92 existe para
impedir. La ficha quiere una **excepción explícita**, no la retirada de la regla.

**A9 — Restringir la autorización a `maestro`.**
Descartada por el humano (Q5): la guía del caso real está en **bodega satélite**, así que exigir
maestro convertiría la decisión en una escalada — y la escalada es lo que produjo los **cinco días
parada**. Además el juicio que se pide («¿el mensajero sabe llegar con estas indicaciones?») lo
tiene quien despacha esa bodega. El criterio queda: **quien ya puede asignar esa orden, puede
autorizarla** (R6).

---

## §9. Archivos de producción que toca esta ficha

**11 archivos**, frente a los 22 de la versión 1. Todo lo que cae es lo que existía para
persistir el rastro.

### Backend (van primero)

| # | Archivo | Cambio |
| --- | --- | --- |
| 1 | `lib/interfaces/services/IAsignabilidadCoordenadasService.ts` | estado nuevo, `EstadoAsignable`, 2.º parámetro de `evaluar`, lista de motivos autorizables |
| 2 | `lib/services/AsignabilidadCoordenadasService.ts` | el `if` dentro de R3, `esAsignable`, cabecera normativa |
| 3 | `lib/interfaces/services/IGuiaAsignacionService.ts` | `AsignarBodegaInput.autorizarSinUbicacionIds?` + `sinUbicacionAutorizada?` en `ok`/`partial` |
| 4 | `lib/interfaces/services/IAsignacionSateliteService.ts` | espejo exacto |
| 5 | `lib/services/GuiaAsignacionService.ts` | `gateCoordenadas` reenvía el conjunto y cuenta la 2.ª cifra |
| 6 | `lib/services/AsignacionSateliteService.ts` | lo mismo en el bloque `4b` |
| 7 | `lib/types/orden-guia.ts` | `asignarBodegaSchema` + `AsignarBodegaResult` |
| 8 | `lib/types/recepcion-satelite.ts` | `asignarSateliteSchema` + `AsignarSateliteResult` |

### Frontend (después del backend)

| # | Archivo | Cambio |
| --- | --- | --- |
| 9 | `app/(app)/_components/geocodificacion-motivo-messages.ts` | literales de §5.1/§5.2 + re-export del predicado |
| 10 | `app/(app)/ordenes/_components/AsignarBodegaModal.tsx` | panel de autorización, 2.ª petición, manifiesto acumulado, aviso agregado |
| 11 | `app/(app)/recepcion-satelite/_components/AsignarSateliteModal.tsx` | espejo exacto |

### Lo que la versión 1 tocaba y esta **NO**

`db/schema.prisma` · `db/migrations/**` · `lib/repositories/OrdenRepository.ts` ·
`lib/interfaces/repositories/IOrdenRepository.ts` · el repositorio, el servicio, las dos interfaces
y la Server Action de autorización · `lib/types/autorizacion-sin-ubicacion.ts` ·
`lib/actions/ordenes-guia.ts` · `lib/actions/recepcion-satelite.ts`.

### Tests (no producción, pero hay que tocarlos)

`tests/unit/guards/geocodificacion-motivo-por-orden-mismo-modulo.guardia.test.ts` (su
`MOTIVOS_DEL_GATE` escrito a mano gana el octavo estado), más los nuevos del mapa de
`requirements.md`.

**No se toca:** `feature_list.json`, `progress/`, `IJobRepository`, `findParaAsignabilidad`,
`asignarBodegaLote`, `asignarSateliteLote`, `OptimizacionRutaService`, `MisAsignacionesService`.

### §9-3. El gate sigue siendo el COMPLETO, y este es el archivo en la mano

Sin `db/schema.prisma` ni `db/migrations/**`, la pregunta es si el diff toca `lib/types/**`.
**Sí, dos archivos, y no hay forma de evitarlo:**

- `lib/types/orden-guia.ts` — ahí vive `asignarBodegaSchema` (`:29-42`), que es donde el campo
  nuevo tiene que entrar para que zod lo acepte, y `AsignarBodegaResult` (`:83-100`), el espejo
  cliente de la cifra;
- `lib/types/recepcion-satelite.ts` — `asignarSateliteSchema` (`:226-236`) y
  `AsignarSateliteResult` (`:241-263`).

`docs/verification.md` manda al completo por `lib/types/**` («un catálogo o un enum lo importa
medio repo»). **No tiene escape.** Ningún archivo del diff lleva nombre de dinero, y ninguno es
`init.sh`, `package.json` ni configuración de build: `lib/types/**` es el único disparador.

### §9-4. Solape con la 405: CERO

La 405 se está implementando ahora en `lib/services/ApiOrdenLecturaService.ts`,
`lib/repositories/OrdenRepository.ts`, `lib/types/api-orden.ts` y los tres artefactos del contrato
público. **Ninguno de esos archivos está en la lista de §9.** El solape de la versión 1 era
`findParaAsignabilidad` en `OrdenRepository.ts`, y al caer el rastro **ese archivo ya no se toca**.
La 406 (`lib/services/WebhookEstadoService.ts` + esos mismos artefactos) tampoco solapa.
</content>
