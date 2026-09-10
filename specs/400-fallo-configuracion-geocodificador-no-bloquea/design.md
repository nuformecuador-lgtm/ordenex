# Feature 400 — Diseño

> El QUÉ está en `requirements.md`; el desglose en `tasks.md`. Este documento decide el CÓMO.
> Regla que gobierna todo el diseño: **arreglar lo evidenciado, no rediseñar.** El modo degradado
> río abajo ya existe (92/R37, R28, R30); lo único roto es que el gate no distingue la causa.

---

## §0 — La decisión, en cuatro frases

> **Corrección 2026-09-09:** este diseño se escribió durante el incidente. La credencial ya funciona
> (medido a las 15:41 UTC) y el leader ya resucitó a mano las 42 órdenes afectadas — el rescate fue
> manual, y evitarlo la próxima vez es el argumento de fondo de §7 y de la ficha 401. Las decisiones
> 1-3 de abajo no cambian: siguen siendo el arreglo para el PRÓXIMO corte, no para el de hoy. La
> decisión 4 es nueva: la añadió el humano en la puerta de aprobación (antes "Q1"/alternativa A6).

1. El desenlace «fallo de configuración propia» pasa a viajar con un **marcador estable** dentro del
   mensaje de error que la cola ya persiste en `jobs.last_error` — un **prefijo constante**
   declarado en un módulo propio, no una frase que alguien pueda reescribir.
2. El gate de asignabilidad gana **un paso** en su árbol de decisión, colocado entre los pasos que no
   tocan la cola y los que clasifican por estado del job: si el job de la dirección vigente lleva el
   marcador, la orden es **`asignable_sin_ubicacion`** y la asignación pasa.
3. `EstadoAsignabilidad` se parte en dos subconjuntos con nombre —**asignables** y
   **bloqueantes**— y el mapa de mensajes de la UI se tipa por el segundo, de modo que un estado
   nuevo sin clasificar no puede colarse en silencio. `geocodificacion_agotada` deja de compartir
   mensaje con `direccion_no_geocodificable`.
4. Los dos writers (`asignarDesdeBodega`, `AsignacionSateliteService.asignar`) cuentan, dentro del
   mismo gate que ya evalúan, cuántas órdenes del lote salieron `asignable_sin_ubicacion`, y lo
   exponen como una cifra agregada (R31) — nunca una lista de órdenes (R32) — en un campo nuevo de
   su resultado `ok`/`partial`. Los dos modales de asignación la muestran en el mismo bloque donde
   ya confirman el resultado (R34). Detalle completo en §6.5.

**Nada más.** Sin migración, sin proveedor de respaldo, sin cambiar la cola.

---

## §1 — Modelo de datos: no cambia nada

| Aspecto | Decisión |
| --- | --- |
| Tablas nuevas | **Ninguna.** |
| Columnas nuevas | **Ninguna.** El dato necesario ya existe: `jobs.last_error`, expuesto como `JobDTO.lastError` (`lib/interfaces/repositories/IJobRepository.ts:19`). |
| Enums nuevos | **Ninguno.** No se toca `JobTipo` ni `JobEstado`, así que **no hay `down.sql` de enum que revisar** (memoria «enum nuevo y los down.sql previos» no aplica). |
| Migraciones | **Ninguna.** Consecuencia: el gate rápido `./init.sh --rapido` **no** se ve forzado al completo por tocar cimientos… salvo por lo que se dice en `tasks.md` T14 (`lib/interfaces/` sí es cimiento: la unión de tipos vive ahí, así que el gate completo **es obligatorio** en esta ficha). |
| RLS | Sin cambios. No se crea tabla; `jobs` conserva su política vigente. |
| Índices | Sin cambios. El gate sigue resolviendo el lote con **una** consulta por igualdad sobre `dedupe_key` (índice único ya existente); el marcador se lee de una columna que esa misma consulta ya devuelve — **cero consultas nuevas, cero joins nuevos**. |
| Escrituras nuevas en caliente | **Ninguna.** El marcador lo escribe la cola en el mismo `UPDATE` de `fail()` que ya hacía. |

### Rutas y endpoints

**Ninguno nuevo.** No hay route handler, no hay Server Action nueva. Las dos existentes
(`lib/actions/ordenes-guia.ts`, `lib/actions/recepcion-satelite.ts`) son passthrough puro del
resultado del service y **no cambian de código** — pero el TIPO que devuelven sí gana un campo
(R31, revisado el 2026-09-09): `ok` y `partial` de `AsignarBodegaServiceResult` /
`AsignarSateliteServiceResult` (y sus espejos de acción, `AsignarBodegaResult` en
`lib/types/orden-guia.ts` y `AsignarSateliteResult` en `lib/types/recepcion-satelite.ts`) suman un
campo **opcional** `sinUbicacion?: number`, presente solo cuando es mayor que cero (mismo patrón
aditivo que `AsignarBodegaInput.dia?`, §5). `forbidden` / `validation_error` / `conflict` no cambian
de forma. La única diferencia observable además de la de siempre (algunas órdenes que antes caían en
`conflict`/`bloqueadas` ahora caen en `resultados`) es esa cifra nueva, ausente cuando vale cero.

### Integraciones externas

`lib/clients/google-geocode.ts` (Google Geocoding API) **no se modifica**. Es una decisión, no una
omisión: ese archivo lleva tres invariantes de privacidad escritos (strip de zod sobre la respuesta,
credencial en query param, mensajes sin URL/credencial/dirección) y R15 prohíbe aflojarlos. El
marcador se añade **una capa más adentro**, en `GeocodificacionService`, que es donde ya vive la
política (el propio cliente lo dice: «NO decide politica: la tabla de desenlace vive en
`GeocodificacionService`»). El cliente ya distingue el caso —devuelve
`{ status: "config_invalida", detalle }`—; lo que faltaba era que esa distinción sobreviviera al
salto por la cola.

---

## §2 — El marcador

### 2.1 Módulo y contrato

Módulo nuevo, sin dependencias, junto a los helpers de geo que **ambos lados ya importan**
(`AsignabilidadCoordenadasService` importa `hashDireccion` de `lib/geo/direccion-query`;
`GeocodificacionService` también):

```
lib/geo/fallo-config-geocode.ts
```

```ts
/** Prefijo estable que identifica «fallo de configuracion NUESTRA» en `jobs.last_error`. */
export const MARCADOR_FALLO_CONFIG_GEOCODE = "[geocode:config]";

/** Envuelve el detalle del fallo con el marcador. UNICA forma de producirlo. */
export function marcarFalloConfigGeocode(detalle: string): string;

/** UNICA forma de detectarlo. `null`/`undefined` -> false. */
export function esFalloConfigGeocode(lastError: string | null | undefined): boolean;
```

### 2.2 Cuatro invariantes, y por qué cada uno

| Invariante | Por qué |
| --- | --- |
| **Es un PREFIJO, y se detecta con `startsWith`.** | `JobQueueService.mensajeError` recorta a 500 caracteres **desde el principio** (`:20-24`). Un marcador al final se perdería con un detalle largo; uno al principio es indestructible por ese recorte (R12). `startsWith` además no puede confundirse con una mención del marcador dentro del texto de otro error. |
| **Es un literal constante, no una plantilla con datos.** | R14: no lleva dirección, ni id, ni credencial, ni URL. Es la misma cadena siempre, así que ningún dato personal puede colarse por ahí. |
| **Se declara en UN sitio y las dos puntas lo importan.** | R13. Un literal copiado en el gate se desincroniza el día que alguien cambie el prefijo, y el fallo sería **mudo**: el gate simplemente dejaría de reconocer el caso y volveríamos al bug de origen sin que ningún test rojo lo diga. Lo protege un guard que **lee el árbol real** (patrón del guard de la 368), no una copia del texto. |
| **No depende de la prosa.** | Es el requisito explícito de la ficha. La frase «el proveedor rechazo la peticion (REQUEST_DENIED)» puede reescribirse mañana sin romper nada; el prefijo no, porque hay un guard y un test de contrato que lo afirman. |

### 2.3 ¿Por qué el marcador cabe en un `string` y no hace falta un campo?

Porque el único consumidor necesita una respuesta **booleana** («¿la causa fue nuestra?»), no una
taxonomía. Un campo estructurado (`error_codigo`) tendría sentido si hubiera que enrutar por N
causas; hoy hay una, y añadirlo cuesta una migración sobre una tabla compartida por **nueve tipos de
job** y tres features (90, 91, 92). Ver §8-A2.

---

## §3 — Dónde se emite el marcador

En `lib/services/GeocodificacionService.ts`, y **solo** en los dos caminos que son fallo nuestro:

| Camino | Hoy | Con esta ficha |
| --- | --- | --- |
| `case "config_invalida"` (`:168-173`) — el proveedor rechaza la petición | lanza `GeocodeIntentoFallidoError(outcome.detalle)` | lanza **`GeocodeConfigInvalidaError(outcome.detalle)`**, cuyo `message` es `marcarFalloConfigGeocode(detalle)` |
| credencial ausente (`:114-118`) — `GOOGLE_MAPS_API_KEY === null` | lanza `GeocodeNoConfiguradoError()` | igual, pero su `message` pasa por `marcarFalloConfigGeocode(...)` |
| `case "transitorio"` (`:164-167`) — red, timeout, 5xx, cuota, estado desconocido | lanza `GeocodeIntentoFallidoError` | **sin cambios, y sin marcador** (R16) |
| payload inválido, `GeocodeRespuestaInvalidaError`, handler no registrado | error normal | **sin cambios, y sin marcador** (R16) |

`GeocodeIntentoFallidoError` deja de ser el error de dos causas distintas y queda **solo** para el
transitorio; su docstring («El proveedor rechazo la peticion (REQUEST_DENIED) **o** hubo un fallo
transitorio») se reescribe. Esa ambigüedad documentada es, literalmente, el bug.

**El resto del camino no se toca:** `JobQueueService.drenar` captura el error, `mensajeError` lo
recorta, `manejarFallo` decide backoff o dead-letter y `repo.fail(id, mensaje, runAfter)` lo persiste
en `last_error`. Ni la cola ni el repositorio se enteran de que hay un marcador — y eso es
deliberado: la cola es genérica y no debe conocer el vocabulario de la geocodificación.

---

## §4 — El árbol de decisión del gate

La cabecera de `AsignabilidadCoordenadasService.ts` declara su orden **NORMATIVO** y explica dos
razonamientos que esta ficha **respeta y no toca**:

- **por qué R3 va antes que la cola:** los desenlaces deterministas dejan el job en `done`, no en
  `failed`, así que «dirección no encontrada» **nunca** llega por la cola; su fuente de verdad es la
  ORDEN. Si se mirara primero la cola, se re-encolaría en bucle pagando llamadas.
- **por qué «intentos agotados» ⇔ `estado === 'failed'` y nada más:** `claimBatch` incrementa
  `intentos` **al reclamar**, así que `intentos >= maxIntentos` bloquearía órdenes que están
  corriendo su último intento y aún pueden resolverse.

### 4.1 El árbol vigente y dónde entra el paso nuevo

```
  R2   coordenadas presentes                         -> asignable                    (sin tocar `jobs`)
  R3   geocode_status DETERMINISTA                   -> direccion_no_geocodificable  (sin tocar `jobs`)
  R4   clave EXACTA reconstruida -> una consulta por lote
  ▶ NUEVO (400/R1)  job.lastError lleva el marcador
                    Y job.estado ∈ {failed, pending, processing}
                                                     -> asignable_sin_ubicacion
  R5     job.estado === 'failed'                     -> geocodificacion_agotada
  R6     job.estado pending|processing               -> geocodificacion_en_curso
  R7   sin job (o `done` sin resultado)              -> encolar puntual
```

### 4.2 Por qué ese sitio exacto, y no otro

- **Después de R2 y R3, sin excepción.** Es lo que preserva el razonamiento de la cabecera: la
  ORDEN sigue siendo la fuente de verdad de «la dirección no existe». Una orden con
  `geocode_status = ZERO_RESULTS` **sigue bloqueando** aunque un job posterior haya muerto por
  configuración (R4). Sin esta precedencia, un corte de credencial podría **enmascarar** una
  dirección genuinamente mala y meterla en la ruta de un mensajero.
- **Antes de R5 y R6, no dentro de R5.** Porque el criterio nuevo es la **causa**, no el estado del
  job — y ese es exactamente el enunciado de la puerta que el humano ya decidió. Meterlo dentro de
  R5 lo ataría al estado `failed` y dejaría fuera la mitad del incidente medido (§8-A4).
- **No altera R7.** Un job `done` sin resultado y sin status determinista sigue re-encolándose, con
  marcador o sin él: si terminó `done`, el último intento **no** murió por configuración; su
  `last_error` (si lo tiene) es la fotografía de un intento anterior ya superado. Restringir el paso
  nuevo a los tres estados no-`done` evita esa lectura obsoleta, y es la razón de que el predicado
  incluya el estado además del marcador.
- **Coste: cero consultas.** `lastError` viene en el mismo `JobDTO` que `findByDedupeKeys` ya
  devuelve.

### 4.3 El marcador no se queda pegado para siempre

Tres salidas, todas ya existentes:
- el job se ejecuta con éxito → la orden gana coordenadas → **R2 gana** y el gate ni llega a la cola;
- el job vuelve a fallar por otra causa → `fail()` **sobrescribe** `last_error` sin marcador;
- la dirección se corrige → cambia el hash → cambia la `dedupe_key` → el gate busca **otra** clave y
  el job viejo deja de responder por esa orden (mecanismo de la 92, `design §0.2`).

---

## §5 — Contrato de tipos

En `lib/interfaces/services/IAsignabilidadCoordenadasService.ts`:

```ts
export type EstadoAsignabilidad =
  | "asignable"
  | "asignable_sin_ubicacion"        // ← NUEVO (400/R1)
  | "direccion_no_geocodificable"
  | "geocodificacion_agotada"
  | "geocodificacion_en_curso"
  | "geocodificacion_encolada"
  | "geocodificacion_no_encolable";

/** Los estados que DEJAN PASAR la asignacion. Unico sitio donde se decide eso. */
export type EstadoAsignable = "asignable" | "asignable_sin_ubicacion";

/** Los que la BLOQUEAN, y por tanto viajan como `motivo` y necesitan mensaje de usuario. */
export type EstadoBloqueante = Exclude<EstadoAsignabilidad, EstadoAsignable>;
```

- `esAsignable(estado)` pasa a aceptar los dos valores de `EstadoAsignable` (R6). Su docstring
  vigente («`asignable` es el ÚNICO estado que deja pasar la asignación») se reescribe con la fecha
  de esta ficha (R30).
- **La decisión de asignabilidad no cambia de sitio.** `GuiaAsignacionService.gateCoordenadas` y el
  bloque `4b` de `AsignacionSateliteService.asignar` preguntan `esAsignable(estado)` y siguen
  adelante; el estado nuevo simplemente no entra en el `detalle` (R10). Esto es lo que hace que el
  arreglo sea barato: **la decisión vive en una función, no repartida en tres services.** Lo único
  que esos dos gates ganan (revisado el 2026-09-09, R31) es **contar**, sobre el mismo `Map` que ya
  devuelve `this.asignabilidad.evaluar(filas)`, cuántas de las órdenes que SÍ pasan (`esAsignable`)
  lo hicieron por `asignable_sin_ubicacion`. Cero consultas nuevas: es una segunda lectura del mismo
  dato ya cargado. Ver §6.5.
- `motivoAsignabilidad(estado)` (identidad) no cambia. Nunca se le pasará un estado asignable porque
  los dos llamadores ya hacen `if (esAsignable(estado)) continue;` antes.
- **El «exhaustive check» que el comentario prometía y que hoy no existe** (precisión 8 de
  `requirements.md`) se hace real en §6.1 tipando el mapa de mensajes por `EstadoBloqueante`.

---

## §6 — UI: el mensaje deja de mentir

### 6.1 Un solo módulo, tipado para que no se pueda olvidar un caso

`app/(app)/_components/geocodificacion-motivo-messages.ts` pasa de dos arrays de literales sueltos a
un mapa **exhaustivo por tipo**:

```ts
import type { EstadoBloqueante } from "@/lib/interfaces/services/IAsignabilidadCoordenadasService";

const MOTIVO_A_MENSAJE: Record<EstadoBloqueante, string> = {
  direccion_no_geocodificable: MSG_DIRECCION_NO_ENCONTRADA,
  geocodificacion_agotada:     MSG_UBICACION_NO_VERIFICADA,   // ← ya no miente
  geocodificacion_en_curso:    MSG_DIRECCION_EN_VALIDACION,
  geocodificacion_encolada:    MSG_DIRECCION_EN_VALIDACION,
  geocodificacion_no_encolable:MSG_DIRECCION_EN_VALIDACION,
};
```

`Record<EstadoBloqueante, string>` es lo que convierte «añadir un estado» en **un error de
compilación** en vez de un silencio (R25). El `import type` no crea acoplamiento en tiempo de
ejecución: es un tipo, desaparece en el build. Se exporta además `MOTIVOS_BLOQUEANTES` (las claves)
para que el guard y los tests comparen contra **una** lista, no contra una copia.

`asignable_sin_ubicacion` **no** aparece en el mapa, por construcción del tipo: no es un motivo de
bloqueo, nunca llega al `detalle` (R10).

### 6.2 Los mensajes

| Constante | Motivos | Texto | Estado |
| --- | --- | --- | --- |
| `MSG_DIRECCION_NO_ENCONTRADA` | `direccion_no_geocodificable` | «Dirección no encontrada» | **Sin cambios** (R20). Ahora es el único que lo usa. |
| `MSG_UBICACION_NO_VERIFICADA` | `geocodificacion_agotada` | **«No se pudo verificar la ubicación por un fallo del servicio de mapas. La dirección no es el problema; vuelve a intentarlo más tarde.»** | **NUEVO** (R19). Texto fijado el 2026-09-09 (antes "Q4"); contrato de test afirmado a mano. |
| `MSG_DIRECCION_EN_VALIDACION` | los tres transitorios | «La dirección aún se está validando. Vuelve a intentarlo en unos minutos.» | **Sin cambios** (R21). |

Criterios del texto nuevo: (a) no culpa a la dirección ni pide corregirla —el operador de la 09-09
fue enviado a arreglar seis direcciones que estaban bien—; (b) literal fijo, sin PII (R24);
(c) lenguaje claro, sin siglas ni jerga interna («servicio de mapas», no «geocodificador» ni
«REQUEST_DENIED»).

### 6.3 Precedencia del mensaje agregado

`geocodificacionMotivoMessage(error)` agrega los motivos de un lote en un mensaje «ganador». Hoy son
dos clases (definitivo > transitorio); pasan a ser tres, con este orden (R22):

```
direccion_no_geocodificable  >  geocodificacion_agotada  >  los tres transitorios
```

Criterio: **gana el que exige una acción del operador sobre el dato**. Si en el lote hay una
dirección genuinamente mala, esa es la que hay que arreglar y el mensaje debe decirlo; si no la hay,
el operador merece saber que el problema es nuestro y no suyo.

Se implementa con una tabla ordenada de clases, no con `if` anidados, para que añadir una cuarta
clase mañana no obligue a releer una escalera.

### 6.4 Que no quede ningún consumidor atrás

Dos mappers y cuatro modales de asignación, verificados en el árbol:

| Consumidor | Cómo recibe el cambio |
| --- | --- |
| `ordenes/_components/guia-decision-error-messages.ts` | llama a `geocodificacionMotivoMessage` antes de su switch por `status` — **sin cambios de código**, hereda el mapa nuevo |
| `recepcion-satelite/_components/asignacion-satelite-error-messages.ts` | idem — **sin cambios de código** |
| `GenerarGuiaModal`, `AsignarRecoleccionModal`, `RutearSateliteModal`, `QuitarRecoleccionModal` | usan `guiaDecisionErrorMessage` — heredan |
| `AsignarBodegaModal.tsx:186`, `AsignarSateliteModal.tsx:160` | usan `mensajeDireccionPorMotivo(b.motivo)` (368/R11) — heredan; su fallback `?? "No se pudo asignar."` sigue siendo el defensivo |

Es decir: **el cambio de mensaje se hace en un archivo y llega a los seis**. Eso ya estaba diseñado
así por la 93/R9 y la 368/T8, y esta ficha se limita a no romperlo. El guard vigente
(`geocodificacion-motivo-por-orden-mismo-modulo.guardia.test.ts`) se extiende para que su lista de
literales prohibidos en los modales cubra la unión completa, incluido `asignable_sin_ubicacion`
(R23): un modal que empezara a tratar ese caso a mano sería exactamente la divergencia que el guard
existe para cazar.

### 6.5 — El aviso de R31-R36: cuántas quedaron sin ubicación

**Añadido el 2026-09-09** (antes Q1, resuelta en la puerta de aprobación; alternativa A6 de §8
revisada de "descartada" a "en alcance"). Tres piezas:

**a) El conteo, en el gate de cada writer.** `gateCoordenadas` (el helper privado de
`GuiaAsignacionService`) y su equivalente en `AsignacionSateliteService` ya recorren
`estados = await this.asignabilidad.evaluar(filas)` para armar `detalle`/`bloqueadas`. Ganan una
segunda cuenta sobre el mismo `Map`, sin tocar la DB otra vez:

```ts
let sinUbicacion = 0;
for (const ordenId of ordenIds) {
  const estado = estados.get(ordenId);
  if (estado === "asignable_sin_ubicacion") sinUbicacion++;
  if (esAsignable(estado)) continue;
  detalle.push({ ordenId, motivo: /* ... */ });
}
return { bloqueadas: detalle, sinUbicacion }; // el helper cambia de forma de retorno (privado, no es
                                               // el contrato de R27 — no toca IJobRepository)
```

El writer expone `sinUbicacion` **solo si es mayor que cero** (mismo patrón aditivo que
`AsignarBodegaInput.dia?`, §5), en `ok` y en `partial`:

```ts
export type AsignarBodegaServiceResult =
  | { status: "ok"; resultados: AsignarBodegaResultadoItem[]; sinUbicacion?: number }
  | {
      status: "partial";
      resultados: AsignarBodegaResultadoItem[];
      bloqueadas: DetalleConflicto[];
      sinUbicacion?: number;
    }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "conflict"; detalle: DetalleConflicto[] };
```

Espejo exacto en `AsignarSateliteServiceResult` (`IAsignacionSateliteService.ts`) y en los dos DTOs
de acción que hoy duplican esta forma a mano (`AsignarBodegaResult` en `lib/types/orden-guia.ts`,
`AsignarSateliteResult` en `lib/types/recepcion-satelite.ts`) — los cuatro sitios donde ya vive
`bloqueadas` ganan el mismo campo, por la misma razón por la que hoy están duplicados: los DTOs de
acción son la forma que cruza el borde server→cliente y no importan el tipo del service directamente
(mismo patrón que `DetalleConflicto`, declarado dos veces a propósito).

**Por qué el campo es opcional y no `sinUbicacion: number` obligatorio:** para que ningún test
existente que compare el resultado con `toEqual({ status: "ok", resultados })` se rompa por una
ficha que no le concierne. Es exactamente el criterio que ya usa `AsignarBodegaInput.dia?` (patrón
aditivo del repo): ausente significa "cero", nunca "desconocido".

**b) El mensaje, en el módulo compartido.** Nueva función en
`app/(app)/_components/geocodificacion-motivo-messages.ts` — el mismo módulo que ya declara
`MSG_DIRECCION_NO_ENCONTRADA` y `mensajeDireccionPorMotivo`, porque es el vocabulario compartido de
cara al operador y los dos modales ya importan de ahí:

```ts
/** R31/R36 (400, 2026-09-09): cifra agregada, nunca identifica la orden (R32). */
export function mensajeAsignadasSinUbicacion(n: number): string {
  if (n <= 0) return "";
  return n === 1
    ? "1 orden se asignó sin ubicación en el mapa por un problema del sistema, no de la dirección. Se ubicará más tarde."
    : `${n} órdenes se asignaron sin ubicación en el mapa por un problema del sistema, no de la dirección. Se ubicarán más tarde.`;
}
```

Vocabulario (R36): sin siglas, sin "geocodificación", sin "config_invalida", sin "API"; dice que el
problema es del sistema y no de la dirección; y, a diferencia del mensaje de `geocodificacion_agotada`
(§6.2, que SÍ sigue bloqueando), aquí la orden ya se asignó — el texto lo dice en pasado ("se
asignó") y anticipa que la ubicación llegará después, sin pedirle nada al operador.

**c) Dónde se ve.** `AsignarBodegaModal.tsx` y `AsignarSateliteModal.tsx` ya construyen a mano, en
`handleConfirm`, el `mensaje` que va al toast Y al `<ManifiestoResultado>` del bloque de resultado
(la MISMA cadena sirve para los dos, hoy: `` `Mensajero asignado a ${a} de ${a+b} orden(es).
${b} bloqueada(s).` ``). R31/R34 se resuelven **concatenando** la frase de `mensajeAsignadasSinUbicacion`
a esa misma cadena, cuando `result.sinUbicacion` está presente:

```ts
const mensaje =
  (result.status === "partial"
    ? `Mensajero asignado a ${result.resultados.length} de ${
        result.resultados.length + bloqueadas.length
      } orden(es). ${bloqueadas.length} bloqueada(s).`
    : `Mensajero asignado a ${result.resultados.length} orden(es).`) +
  (result.sinUbicacion ? ` ${mensajeAsignadasSinUbicacion(result.sinUbicacion)}` : "");
```

**No hace falta ningún bloque de UI nuevo** (nada de un segundo `role="status"`/`role="alert"`): el
aviso viaja dentro del MISMO `mensaje` que ya se muestra en el toast y en el `<ManifiestoResultado>`
del panel de resultado — que es literalmente "el mismo lugar donde hoy ve la confirmación" que pide
R34. Y como es una frase aparte de la lista `bloqueadas` (que sigue siendo su propio `<ul
role="alert">`), R35 se cumple por construcción: nunca comparten contenedor ni se mezclan sus
números.

---

## §7 — Retro-compatibilidad: recuperación idempotente para el PRÓXIMO incidente (hoy sin sujetos)

> **Corrección 2026-09-09, 15:41 UTC:** esta sección se escribió durante el incidente, asumiendo que
> el backfill era la vía para desbloquear las 42 órdenes. No lo fue: **el leader las desbloqueó a
> mano**, resucitando los 47 jobs afectados directamente en producción (`intentos=0`,
> `last_error=null`, `run_after` adelantado). Medido después: 0 `failed`, 0 `pending`, 42
> geocodificaciones nuevas, y las órdenes vivas sin coordenadas bajaron de 43 a 1 (NA-817,
> `ZERO_RESULTS`, legítimamente bloqueada). **El `WHERE` de abajo hoy no encuentra ninguna fila.**
>
> **Decisión: se conserva (alternativa (a) sobre (b)).** El costo de mantenerla es el que ya estaba
> pagado — diseño, script y test de integración completos, con datos que el propio test siembra, no
> con datos de producción—. El costo de retirarla es real: la próxima vez que el proveedor rechace
> peticiones, sin este script la única vía de recuperar los jobs `failed` acumulados vuelve a ser
> exactamente lo que pasó hoy — alguien entrando a la base de producción a mano, sin ensayar, bajo
> presión. Eso es precisamente lo que la ficha 401 quiere volver innecesario (con la alerta y el
> reencolado automático), pero 401 no está planificada todavía. Mientras tanto, este script es la
> única red probada. Se conserva con su alcance sin cambios; lo único que cambia es la expectativa:
> **no desbloquea nada hoy** (R17 lo dice explícitamente), es una operación lista para la próxima
> vez que sí haya sujetos.

**El problema, medido:** los 25 jobs `failed` del incidente llevan en `last_error` la frase legada
(«…el proveedor rechazo la peticion (REQUEST_DENIED)»), **sin marcador** —el marcador no existía
cuando se escribieron—. Un job `failed` **no vuelve a ejecutarse nunca** (el reencolado es la 401).
Sin hacer nada, esta ficha se desplegaría y **esas órdenes seguirían bloqueadas**: el arreglo no
llegaría a las órdenes que lo motivan.

> **Corrección 2026-09-09 (implementación, `menor-8` de la revisión): los textos legados son DOS,
> no uno.** Esta sección nombraba solo la frase de `REQUEST_DENIED`, pero `requirements.md`
> (precisión 3) ya decía que el desenlace de configuración está aislado en **dos** sitios del
> dominio, y el segundo escribe su propio texto: `GeocodeNoConfiguradoError` persiste
> «`geocodificacion: GOOGLE_MAPS_API_KEY no esta configurada`» cuando falta la credencial. Un
> `WHERE` que solo mirara `REQUEST_DENIED` dejaría fuera todos los jobs muertos por credencial
> ausente —el caso de un despliegue mal configurado, que es igual de nuestro—. El script
> implementado reconoce los dos fragmentos, y el test de integración siembra una fila candidata de
> **cada** texto, no una sola.

**Los `pending`/`processing` se curan solos** y no necesitan intervención: su próximo intento corre
con el código nuevo, falla otra vez por la misma causa y `fail()` reescribe `last_error` **con**
marcador. Con `JOBS_BACKOFF_BASE_MS = 60_000` y `JOBS_BACKOFF_CAP_MS = 3_600_000`, eso ocurre a lo
sumo ~1 h después del despliegue, siempre que el cron de jobs esté corriendo.

**La decisión:** un script de un solo uso (R17/R18), no una migración:

```
scripts/backfill-marcador-config-geocode.ts
```

- **Solo-lectura por defecto** (`--dry-run` implícito): imprime el número de filas candidatas y su
  desglose por `estado`. Escribe únicamente con `--apply`. Memoria del repo: *medir el backfill antes
  de desplegar y decir el número antes*.
- **Alcance del `WHERE`:** `tipo = 'geocodificacion'` **y** `estado = 'failed'` **y** `last_error`
  coincide con **alguno de los dos** textos legados del fallo de configuración —el del proveedor
  (`…el proveedor rechazo la peticion (REQUEST_DENIED)`) **o** el de la credencial ausente
  (`…GOOGLE_MAPS_API_KEY no esta configurada`)— **y** `last_error` **no** empieza ya por el
  marcador (idempotencia, R17).
- **Efecto:** prefija el marcador. **No toca** `estado`, `intentos`, `run_after`, `dedupe_key` ni
  `payload` (R18).
- **Aquí sí se compara por prosa, y es correcto:** el script corre **una vez**, contra una fotografía
  conocida, con el número medido antes. La prohibición de la ficha es sobre el **predicado en
  caliente** del gate —el que se ejecuta en cada asignación y tiene que sobrevivir a cualquier
  reescritura futura del mensaje—, no sobre una reparación puntual de datos históricos. El script se
  borra o se marca como consumido tras ejecutarse.
- **Verificación:** test de integración contra DB (`tests/integration/db/`) que siembra filas legadas
  + filas testigo (otro tipo, otro error, ya marcada), corre el backfill **dos veces** y comprueba
  idempotencia y no-daño colateral. Ojo con la memoria «test de integración verde sin datos»: el test
  debe fallar si no encuentra las filas sembradas, nunca hacer `return` silencioso.

---

## §8 — Alternativas descartadas

**A1 — Detectar la causa buscando `"REQUEST_DENIED"` por substring en `last_error`.**
Es lo más corto de escribir y **es lo que la ficha prohíbe**. El predicado más caliente del gate
quedaría atado a la redacción de un mensaje que vive en otro archivo, escrito para humanos; el primer
cambio de copy —o un cambio de nomenclatura del proveedor— lo rompería **en silencio**: sin test
rojo, sin log, y con el bug de origen de vuelta. Descartada.

**A2 — Columna `error_codigo` (o `causa`) en `jobs`.**
Sería el modelado «correcto» en abstracto, y es rediseño en concreto: migración up/down sobre una
tabla compartida por nueve tipos de job, cambio del contrato `IJobRepository.fail` (features 90, 91,
92), backfill igualmente necesario para las filas históricas, y `./init.sh` completo obligatorio en
cada iteración. Todo eso para responder a **una** pregunta booleana con **un** consumidor. La ficha
dice explícitamente «sin migración». Descartada.

**A3 — Que el gate consulte el estado del proveedor (p. ej. «¿hubo algún geocode con éxito en la
última hora?») en vez de la causa del job.**
Es la heurística que uno escribe mirando el incidente: durante el corte, ningún geocode tuvo éxito.
Pero clasifica por **correlación temporal**, no por causa: dejaría pasar también órdenes cuyo job
murió por una causa distinta que sí merece bloqueo, y exigiría una consulta agregada nueva (y un
índice) en el camino de cada asignación. Además inventa un concepto de «salud del proveedor» que no
existe en el modelo. Descartada.

**A4 — Aplicar el paso nuevo SOLO a jobs `failed` (dentro de R5), no a `pending`/`processing`.**
Es la versión conservadora y tiene un argumento real: un job `pending` puede estar a minutos de
resolverse, y dejar pasar la asignación gastaría la oportunidad de tener coordenadas. **Se descarta
por lo medido:** en el incidente, **23 de los 48 jobs estaban en `pending`** — casi la mitad de las
órdenes seguirían bloqueadas hasta ~2 h después de que su job muriera del todo, con el operador
mirando el mismo mensaje. Y el coste del falso positivo es **casi nulo**: la orden asignada sin
ubicación no se pierde (92/R37, R28, R30) y **puede recibir coordenadas después de asignada**
(`guardarResultado` hace `updateMany` por `id` sin mirar estatus ni mensajero), con lo que la
siguiente optimización ya la coloca. Bloquear no protegía nada; solo paraba al operador. *(Antes
"Q3" en `requirements.md`; confirmado por el humano el 2026-09-09 el criterio amplio de R1
—`failed`/`pending`/`processing`—. Esta alternativa queda solo como conservadora descartada, con su
coste medido arriba.)*

**A5 — Dejar pasar CUALQUIER `geocodificacion_agotada`, sin mirar la causa.**
Sería aún más simple y arreglaría el incidente. La descarta el humano en la ficha: la puerta se abre
**solo** cuando la causa es nuestra. Un job agotado por cuota o por red repetida es un caso distinto
y sigue bloqueando. Descartada por decisión, no por técnica.

**A6 — Un canal informativo nuevo en la respuesta de los writers: «asignadas: N, de las cuales M sin
ubicación».** *(Revisada el 2026-09-09: el humano la pidió explícitamente en la puerta de
aprobación — antes descartada como "fuera del arreglo mínimo", ahora es R31-R36 y está DENTRO del
alcance. Se deja el razonamiento original porque sigue explicando el COSTE, que resultó menor de lo
temido.)*
Lo que se temía: cambiar el contrato de `asignarDesdeBodega` y de `AsignacionSateliteService.asignar`,
sus tipos de resultado, las dos Server Actions y los dos modales —justo después de que la 368 acabara
de tocar esos mismos cuatro puntos—. Medido al diseñarlo (§6.5): el costo real es un campo
**opcional** en cuatro tipos ya existentes (dos contratos de service, dos DTOs de acción — los mismos
cuatro que ya duplican `bloqueadas`), cero Server Actions nuevas (siguen siendo passthrough), y CERO
bloques de UI nuevos (la frase se concatena al `mensaje` que el modal ya construye para el toast y el
panel de resultado). El aviso de órdenes sin posición río abajo (92/R30, en el módulo de ruta) sigue
existiendo y sigue siendo el que importa cuando la orden ya está en reparto — este aviso nuevo cubre
el momento ANTERIOR, el de "acabo de asignar": el humano decidió que quiere los dos.

**A7 — Re-encolar los jobs muertos desde el propio gate cuando detecte el marcador.**
Convertiría el gate en un writer de la cola por una causa nueva, y es literalmente el enunciado de la
**ficha 401** (`depends_on: 400`). Además, mientras la credencial siga rota, reencolar quema llamadas
al proveedor sin ganar nada. Descartada por alcance.

**A8 — Proveedor de geocodificación de respaldo.**
Rediseño puro, y no arregla lo evidenciado: con un segundo proveedor, el gate seguiría sin distinguir
la causa el día que fallen los dos. Descartada.

**A9 — Marcar cada item de `resultados` con un booleano (`{ ordenId, estado, sinUbicacion: boolean }`)
en vez de un conteo agregado en el resultado.** *(Añadida el 2026-09-09, R31/R32.)*
Es la forma "obvia" si uno piensa en términos de lista: cada orden ya sabe si tiene ubicación o no.
**Se descarta** porque el humano fue explícito — "sigue sin PII: nunca la dirección ni el id" — y
esto SÍ identifica: el modal ya resuelve `ordenId → numRemision` con su propio snapshot (mismo
mecanismo que usa para `bloqueadas`, `AsignarBodegaModal.tsx:180`), así que un booleano por item le
regala al modal la lista exacta de qué guías quedaron sin ubicación, con cero fricción. Eso es
precisamente la granularidad que R32 prohíbe: lo que el humano pidió es "cuántas", no "cuáles". Un
`number` agregado no se puede des-agregar; un array de booleanos, sí.

**A10 — Reusar el canal `bloqueadas`/`DetalleConflicto` de la 368 para reportar las órdenes sin
ubicación (viajarían con un `motivo` nuevo, p. ej. `"asignada_sin_ubicacion"`).** *(Añadida el
2026-09-09, R31/R35.)*
Es la opción de "no inventar un canal nuevo", y la ficha 368 ya construyó exactamente esa
infraestructura (identificar por guía, mensaje por motivo). **Se descarta** por tres razones: (i)
`DetalleConflicto` exige `ordenId` — reusarlo choca con la misma restricción de R32 que tumba a A9;
(ii) `bloqueadas` significa, en el contrato vigente y en la UI (`AsignarBodegaModal.tsx:268-279`,
`role="alert"`, borde rojo), "esta orden NO recibió el efecto pedido" — una orden asignada sin
ubicación SÍ lo recibió, así que reportarla ahí sería, literalmente, mentir sobre el resultado; (iii)
el propio nombre `bloqueadas` dejaría de significar "bloqueada" el día que conviva con un motivo que
no bloquea nada, y el guard de la 368 (`geocodificacion-motivo-por-orden-mismo-modulo`) tendría que
aprender a diferenciar motivos-bloqueo de motivos-informativos dentro del mismo array — más
acoplamiento, no menos. Un campo hermano (`sinUbicacion`, un número) es más barato y no arrastra
ninguna de las tres.

---

## §9 — Riesgos y cómo se cierran

| Riesgo | Cierre |
| --- | --- |
| **El fallo mudo clásico de este repo:** el marcador se escribe pero nadie lo lee (o al revés), y la suite sigue verde. | El test de contrato de R11 **recorre las dos puntas en una sola prueba**: `GeocodificacionService` lanza → se recorta como lo hace la cola → se arma el `JobDTO` → el gate clasifica. No hay doble intermedio que pueda mentir. Complementado por el guard de declaración única (R13). |
| Un futuro corte de credencial deja jobs `failed` sin marcador (p. ej. si el rollout del marcador tuviera un hueco) y nadie los recupera sin entrar a mano a producción — lo que pasó el 2026-09-08/09. | §7: el backfill queda listo y probado (test de integración con datos propios), aunque hoy no tenga sujetos reales. Es la red para que el PRÓXIMO incidente no repita el rescate manual. |
| El campo `sinUbicacion` se olvida en uno de los dos writers (bodega central sí, satélite no, o viceversa). | Los dos gate-tests (`guia-asignacion-gate-coordenadas.test.ts`, `asignacion-satelite-gate-coordenadas.test.ts`) llevan el mismo caso espejado (R31); un olvido en un solo lado deja ese test rojo, no ambos. |
| El estado nuevo se cuela en el `detalle` y la UI enseña `asignable_sin_ubicacion` en crudo. | R10 + el tipo `Record<EstadoBloqueante, string>` (§6.1): el estado nuevo no puede tener entrada en el mapa, y los writers lo filtran con `esAsignable` antes de construir el `detalle`. Test en los dos gate-tests de writer. |
| Un corte de credencial enmascara una dirección realmente mala. | Imposible por el orden del árbol: R3 (la ORDEN) va antes que la cola. Test explícito en R4, parametrizado sobre los tres status deterministas. |
| El marcador se queda pegado y el gate deja pasar para siempre. | §4.3: tres salidas naturales, ninguna requiere código nuevo. |
| Cambiar el `message` de `GeocodeNoConfiguradoError` rompe un test que afirmaba ese literal. | `tasks.md` T4 exige buscar los tests que afirman ese literal y actualizarlos **conscientemente** (memoria «literal: contrato o polizón»: comprobar si el literal ES el contrato antes de tocarlo). |
| Base local compartida entre worktrees al correr el test de integración del backfill. | El test siembra y limpia sus propias filas con un prefijo propio de `dedupe_key`; no asume una base vacía. |

---

## §10 — Fronteras con otras fichas

- **401** (`la caida del geocodificador no se avisa a nadie ni se recupera sola`, `depends_on: 400`):
  la **alerta** y el **reencolado automático** cuando el proveedor vuelve. Esta ficha **no** los
  toca (R28). Lo que 400 le deja hecho a 401: un marcador estable con el que 401 puede seleccionar
  exactamente los jobs a reencolar y exactamente la condición que debe alertar, sin volver a mirar
  la prosa del error.
- **270** (`geocode_precision se escribe y no lo lee nadie`, `pending`): trata la **calidad** de una
  coordenada que **sí existe** (un centroide de distrito haciéndose pasar por la casa del cliente).
  400 trata la **ausencia** de coordenada. Ni un archivo de decisión en común: 270 vive en el
  consumidor de `geocode_precision`; 400 vive en el gate de asignabilidad y en el mapa de mensajes.
  No se pisan.
- **368** (done): el éxito parcial por lote. 400 **se apoya** en él (las órdenes que ahora pasan
  simplemente engordan `resultados` en vez de `bloqueadas`) y no lo rehace. El aviso nuevo de R31-R36
  (§6.5) es un campo **hermano** de `bloqueadas`, no una extensión de su forma — ver A10 en §8 sobre
  por qué no se reusa ese canal.
- **92** (done): el gate y el modo degradado. 400 **añade un paso** a su árbol normativo y **no
  reordena** el resto; sus R37/R28/R30 son el fundamento de que dejar pasar sea seguro.

---

## §11 — Archivos que esta ficha toca

| Archivo | Qué |
| --- | --- |
| `lib/geo/fallo-config-geocode.ts` | **nuevo** — marcador + productor + detector (§2) |
| `lib/services/GeocodificacionService.ts` | emite el marcador en los dos caminos de configuración; `GeocodeIntentoFallidoError` queda solo para transitorio (§3) |
| `lib/interfaces/services/IAsignabilidadCoordenadasService.ts` | estado nuevo + `EstadoAsignable` / `EstadoBloqueante` (§5) |
| `lib/services/AsignabilidadCoordenadasService.ts` | paso nuevo en el árbol + `esAsignable` + cabecera normativa reescrita (§4) |
| `app/(app)/_components/geocodificacion-motivo-messages.ts` | mapa tipado, mensaje nuevo, precedencia de tres clases (§6); añade `mensajeAsignadasSinUbicacion` (§6.5, R31/R36) |
| `scripts/backfill-marcador-config-geocode.ts` | **nuevo** — reparación de un solo uso, sin sujetos hoy (§7) |
| `lib/interfaces/services/IGuiaAsignacionService.ts` | `AsignarBodegaServiceResult` gana `sinUbicacion?: number` en `ok`/`partial` (§6.5, R31) |
| `lib/services/GuiaAsignacionService.ts` | `gateCoordenadas` cuenta además `asignable_sin_ubicacion` sobre el mismo `Map` (§6.5, R31) |
| `lib/interfaces/services/IAsignacionSateliteService.ts` | mismo campo en `AsignarSateliteServiceResult` (§6.5, R31) |
| `lib/services/AsignacionSateliteService.ts` | mismo conteo en su gate equivalente (§6.5, R31) |
| `lib/types/orden-guia.ts` | `AsignarBodegaResult` (DTO de acción, espejo del contrato de service) gana el mismo campo (§6.5, R31) |
| `lib/types/recepcion-satelite.ts` | `AsignarSateliteResult` (DTO de acción) gana el mismo campo (§6.5, R31) |
| `app/(app)/ordenes/_components/AsignarBodegaModal.tsx` | el `mensaje` de `handleConfirm` concatena el aviso de R31 cuando `sinUbicacion > 0` (§6.5, R31/R34) |
| `app/(app)/recepcion-satelite/_components/AsignarSateliteModal.tsx` | idem, espejo exacto (§6.5, R31/R34) |
| **No se tocan** | `lib/clients/google-geocode.ts`, `lib/services/JobQueueService.ts`, `lib/repositories/JobRepository.ts`, `lib/interfaces/repositories/IJobRepository.ts`, `db/schema.prisma`, `db/migrations/`, `lib/actions/ordenes-guia.ts` y `lib/actions/recepcion-satelite.ts` (passthrough, sin cambio de código), los dos mappers de error, y los otros cuatro modales (`GenerarGuiaModal`, `AsignarRecoleccionModal`, `RutearSateliteModal`, `QuitarRecoleccionModal`) — ninguno tiene desenlace `partial`/`sinUbicacion` |
