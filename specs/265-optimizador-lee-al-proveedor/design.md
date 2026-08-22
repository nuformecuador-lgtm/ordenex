# Feature 265 — Diseño

> Lee `requirements.md` antes que esto. Aquí sólo van las **decisiones**, con lo que se descartó y
> por qué. Todo lo que se afirma como «medido» se leyó en el árbol o en el log de producción; la
> línea concreta está citada.

---

## 1 · Alcance

| Entra | No entra |
| --- | --- |
| Parsear `skippedShipments`, `validationErrors` y `metrics.skippedMandatoryShipmentCount` | Cambiar el **modelo** que se envía (`shipments`/`vehicles`): no se tocan capacidades ni ventanas horarias |
| Un desenlace nuevo para «el proveedor contestó bien pero no pudo servirlas todas» | El **trazado** (`google-routes.ts`): otro SKU, otro cliente, otro camino de fallo |
| Degradar a Haversine en ese desenlace, con la secuencia **completa** | Distinguir en la UI una ruta local de una optimizada → límite declarado 1, **P3** |
| Una guarda de coherencia del origen **antes** de la llamada facturada | Validar las paradas entre sí → límite declarado 4 |
| Que el fallo del proveedor deje de llegar crudo a la pantalla del mensajero | La **calidad de la geocodificación** → hallazgo **H1**, ficha aparte |
| Anexar la premisa caducada con su guardia | El `console.log` del token → hallazgo **H2**, hotfix aparte |

### Modelo de datos: **ninguno**

**Sin tablas, sin columnas, sin RLS, sin migración** (**R34**). Se verificó qué haría falta y no hace
falta nada:

- El desenlace nuevo es un **tipo de TypeScript**, no un valor persistido.
- La degradación se persiste con `reemplazarSecuencia`, que ya existe y ya es atómica.
- El motivo de la degradación cabe en `ruta_optimizada.ultimo_error`, que ya es `TEXT` nullable.
- El umbral del origen es una **variable de entorno**, como sus cinco hermanas.

Y como no hay migración, **no hay `down.sql` que escribir** y el checkpoint de migraciones
reversibles no aplica. Se dice explícitamente para que el reviewer no lo busque.

---

## 2 · La cadena, medida — dónde muere hoy la respuesta

```
Google 200 { routes:[{}], skippedShipments:[x6], metrics:{ skippedMandatoryShipmentCount: 6 } }
   ↓ respuestaSchema (google-route-optimization.ts:71)   ← STRIP: sólo sobrevive `routes`
   ↓ traducirSecuencia (:233)                            ← 0 visitas, 6 paradas
   ✗ throw RutaRespuestaInvalidaError("la secuencia no cubre todas las paradas")   (:261)
   ↓ FallbackRouteOptimizationClient (:55)               ← "fallo REAL del proveedor; NO se cae a Haversine"
   ↓ OptimizacionRutaService.ejecutar (:265)             ← la excepción NO pasa por marcarDesactualizada
   ├─ job  → optimizacion-ruta-handler:49 → re-lanza → backoff → dead-letter → BUCLE
   └─ UI   → ruta-mensajero.ts:58 → "AppErrorCode inesperado INTERNAL" → pantalla rota
```

**Cuatro decisiones distintas fallan en la misma línea**, y por eso la ficha tiene cuatro bloques:
se lee mal (§3), se decide mal (§4-5), se paga de más (§6) y se rompe la pantalla (§7).

---

## 3 · D1 — El contrato de respuesta se amplía, y se amplía **defensivo**

### 3.1 · El schema

```ts
const skippedShipmentSchema = z.object({}).catchall(z.unknown());   // forma interna DESCONOCIDA (P1)

const respuestaSchema = z.object({
  routes: z.array(routeSchema).optional(),
  skippedShipments: z.array(skippedShipmentSchema).optional(),
  validationErrors: z.array(z.object({}).catchall(z.unknown())).optional(),
  metrics: z.object({ skippedMandatoryShipmentCount: z.number().int().nonnegative().optional() })
    .optional(),
});
```

Tres propiedades, ninguna decorativa:

1. **Todo opcional, todo tolerante.** Es la misma lección que la cabecera del archivo ya escribió
   en mayúsculas sobre `shipmentIndex`: las APIs protobuf de Google **omiten los campos con valor
   por defecto** al serializar a JSON. Un `skippedShipments` declarado obligatorio haría fallar el
   parseo de **toda** respuesta sana — que son casi todas (**R2**).
2. **La forma interna no se declara**, porque **no se conoce**: el log la truncó a `[Object]` y en
   el repo hay cero referencias a esos nombres. Declararla de memoria sería inventar. Cuando
   **B0.1** traiga la respuesta real, el `catchall` se sustituye por los campos concretos que
   hagan falta para **R7** — y ni uno más.
3. **Sigue sin `.passthrough()` en el nivel raíz.** La razón original no ha cambiado: `routePolyline`
   es una traza de coordenadas, es decir PII. Lo que se añade son **tres campos nombrados**, no una
   puerta abierta.

> ⚠️ **`.catchall(z.unknown())` no es `.passthrough()` disfrazado.** Se aplica a los elementos de dos
> arrays cuyo contenido **no se lee**: sólo se cuentan y se comprueba si están. Nada de lo que caiga
> ahí dentro llega a un mensaje, a la base ni a la UI (**R6**). Cuando P1 se resuelva, esto se
> aprieta.

### 3.2 · La regla de la casa: se citan **campos y conteos**, nunca valores

El archivo ya la sigue (`:215-218`: «Se citan los CAMPOS que fallan, NUNCA sus valores (serían
coordenadas)»). Aquí se extiende con una precisión que hacía falta escribir:

| Se puede citar | No se puede citar |
| --- | --- |
| El **nombre** del campo (`skippedShipments`, `metrics.skippedMandatoryShipmentCount`) | Cualquier valor de coordenada |
| **Conteos**: cuántas saltadas, cuántas enviadas (**R5**) | Índices de parada — se traducen a `ordenId` con la tabla que el cliente tiene delante |
| **Códigos** de motivo del proveedor, si existen (**R7**) | Texto libre del proveedor (**R6**, y ver **P5**) |
| Si `validationErrors` **está presente** (un booleano) | El contenido de `validationErrors` |

Un conteo es un agregado: es lo mismo que el repo ya emite en `totalParadas` / `conCoordenadas`. Un
índice **no** lo es: `paradas[i].ordenId` está a un paso.

### 3.3 · Dónde vive esto

En `GoogleRouteOptimizationClient`, que es el **borde tipado** (`docs/architecture.md`, principio 2).
El servicio no ve JSON del proveedor y no va a empezar a verlo.

---

## 4 · D2 — Un desenlace nuevo: `sin_solucion`

```ts
export type OptimizarOutcome =
  | { status: "ok"; secuencia: string[] }
  | { status: "transitorio"; detalle: string }
  | { status: "config_invalida"; detalle: string }
  /** El proveedor CONTESTÓ BIEN y no pudo servir todas las paradas. No es un fallo suyo. */
  | { status: "sin_solucion"; detalle: string; servidas: number; enviadas: number };
```

**Por qué un desenlace y no un error.** Los tres desenlaces que ya existen describen **fallos**
(red, cuota, credencial). Esto no lo es: es una **respuesta correcta a una pregunta imposible**. Un
`Error` obliga a quien lo reciba a distinguir «se rompió algo» de «no hay solución» leyendo el
nombre de una clase; un desenlace lo dice en el tipo, y el `switch` deja de compilar hasta que
alguien lo trate. Ese rojo del compilador **es el objetivo**.

**`servidas` y `enviadas` van en el desenlace, no sólo dentro del texto**, para que el consumidor
pueda decidir sin parsear prosa. Son conteos: no son PII (§3.2).

### 4.1 · Quién lo produce

`traducirSecuencia` deja de lanzar **en un solo caso**: cuando la secuencia es válida pero
**incompleta**. Los otros tres siguen lanzando exactamente igual, y esto no es un detalle:

| Caso | Hoy | Después |
| --- | --- | --- |
| `sin routes` | `throw RutaRespuestaInvalidaError` | **igual** — el proveedor no devolvió ni el sobre |
| `shipmentIndex` fuera de rango | `throw` | **igual** — el contrato asumido no sería el real |
| `shipmentIndex` repetido | `throw` | **igual** — ídem |
| **la secuencia no cubre todas las paradas** | `throw` | **`{ status: "sin_solucion", … }`** |

La cuarta fila es la única que cambia, y es la única de las cuatro donde el proveedor **explicó** lo
que hizo.

---

## 5 · D3 — Degradar: el caso «ninguna» y el caso «algunas» reciben el mismo trato

> **Ésta es la decisión que el humano pidió razonar, y va con su alternativa descartada.**

### 5.1 · La regla

**Si la secuencia devuelta no cubre TODAS las paradas enviadas, se ordenan TODAS en local.** No hay
un caso «ninguna» y otro «algunas»: hay un solo criterio, la **cobertura**.

### 5.2 · Por qué el caso intermedio no merece un tratamiento propio

El razonamiento original del archivo **sigue siendo válido y es la razón de esta regla**, no una
excepción a ella:

> «Persistir una secuencia parcial sería peor que no optimizar: borraría el último orden bueno y
> **dejaría paradas fuera de la ruta sin que nadie se entere**.»

Una parada que el proveedor saltó y que no entra en la secuencia persistida **desaparece del mapa y
del orden del mensajero**, y es indistinguible de una parada sin geocodificar (92/R28). El mensajero
lleva el paquete en la mano y la app no se lo nombra. Eso es exactamente el género de fallo mudo que
este repo persigue.

Frente a eso, el orden local **cubre las seis**. Es aproximado —línea recta, sin calles, sin
tráfico— pero **completo**, y completo es la propiedad que no se puede sacrificar. Un orden
subóptimo cuesta minutos; una parada que se cae de la ruta cuesta una entrega.

Y hay un segundo motivo, más frío: **una secuencia parcial no es comparable con la anterior**. La
huella de la guarda de coste se calcula sobre el **conjunto** de paradas; persistir un subconjunto
dejaría la huella describiendo algo que no es lo que se envió, y la guarda de «sin cambios»
empezaría a mentir.

### 5.3 · Dónde se decide degradar: en el **compuesto**, no en el servicio

```
FallbackRouteOptimizationClient.optimizar
  ├─ primary.optimizar()
  │    ├─ throw RutaNoConfiguradoError          → Haversine   (regla que YA existía)
  │    ├─ throw <cualquier otro>                → re-lanza    (regla que YA existía)
  │    └─ return { status: "sin_solucion", … }  → Haversine   ← REGLA NUEVA
  └─ los demás desenlaces pasan tal cual
```

**Por qué ahí.** Esa clase existe **para una sola cosa**: decidir cuándo se usa el calculador local.
Ya tiene una regla de ese género y ésta es la segunda. La alternativa —dar al servicio un segundo
cliente— duplica el concepto de fallback en dos capas y deja al servicio decidiendo qué proveedor
usa, que es justo lo que la interfaz aísla (**A3**).

**Y el servicio sigue siendo defensa en profundidad.** Si algún día alguien cablea el cliente de
Google **sin** el compuesto (los tests lo hacen), el servicio recibirá un `sin_solucion` que no
esperaba. Trato: **como fallo del proveedor** — conserva el orden previo, marca `desactualizada` y
lanza el fallo tipado. Nunca persiste parcial, nunca cae en silencio. El `switch` del servicio no
compila hasta que ese caso está escrito.

### 5.4 · Qué se persiste, y por qué como `vigente`

La secuencia local se persiste con `reemplazarSecuencia` **igual que cualquier otra**: `calculadaAt`,
origen, huella, estado `vigente`. Consecuencia buscada: la guarda de «mismo conjunto y mismo origen»
—que exige `estado === "vigente"`— **cortará la siguiente llamada**. Eso es lo que detiene la
sangría de facturación medida en la evidencia §3.

Marcarla `desactualizada` habría sido lo intuitivo y es **exactamente lo contrario de lo que se
quiere**: esa guarda no cortaría, y volveríamos a pagar cada minuto por el mismo modelo imposible.

> El precio está declarado (límite 2 de `requirements.md`) y **no es simétrico con el trazado**. El
> trazado local **no** se cachea a propósito, porque una línea recta *parece* una calle y congelarla
> miente. Un orden local no miente sobre su naturaleza: es un orden, y los cubre a todos. Además la
> posición del mensajero cambia constantemente, así que la huella se invalida sola.

### 5.5 · Qué ve la cola

El job **completa** (**R13**). Es correcto y es el mismo criterio que la 91 escribió para sus
desenlaces deterministas: reintentar una respuesta determinista gasta llamadas **pagadas** por algo
que nunca va a cambiar y contamina el dead-letter con ruido permanente. El caso medido lo demuestra:
72 eventos con la misma entrada y la misma respuesta.

---

## 6 · D4 — La guarda de coherencia del origen

### 6.1 · Dónde va, exactamente

En `OptimizacionRutaService.ejecutar`, entre `resolverOrigen` y el cálculo de la huella:

```
 R20  job obsoleto                          -> 0 llamadas
 R34  intervalo mínimo                      -> 0 llamadas
 R35  0 ó 1 parada                          -> 0 llamadas de optimización
 R38  tope de paradas                       -> recorte
      resolverOrigen(...)
 ★    coherencia del origen                 -> se SUSTITUYE el origen, 0 llamadas de más   ← NUEVA
      huella(paradas, origen FINAL)                                                        ← R20 del spec
 R36  mismo conjunto y mismo origen         -> 0 llamadas
      client.optimizar(...)                 -> ESTO SE FACTURA
```

**El orden importa y no es negociable:** la guarda va **antes** de la huella (**R20** del spec). Si
se calculara la huella con el origen viejo y se enviara el nuevo, la huella describiría una llamada
que no se hizo — y la guarda de «sin cambios» empezaría a cortar por el motivo equivocado.

Va **después** de `resolverOrigen` porque necesita un origen ya resuelto, y **después** del recorte
del tope porque el centroide debe calcularse sobre las paradas que **de verdad** se envían.

### 6.2 · El criterio, medible y con una sola definición

```ts
const centro = centroide(paradas);                      // la misma cuenta del escalón 3
const km = distanciaHaversineKm(origen, centro);         // lib/geo/polilinea.ts
if (origen.fuente !== "centroide" && km > config.RUTA_ORIGEN_MAX_KM) { … }
```

- **La fórmula ya existe y es única en el repo** (`distanciaHaversineKm`, `lib/geo/polilinea.ts`),
  usada por el fallback Haversine y por el trazado local. No se escribe una segunda.
- **El centroide ya existe**: es la cuenta del escalón 3 de `resolverOrigen`. Se extrae a una función
  para no tener dos aritméticas del mismo punto — que es exactamente el género de divergencia que
  este repo ya pagó en otras features.
- **Es puro y gratis**: dos sumas y una raíz sobre datos ya cargados. Cero llamadas, cero lecturas
  (**R22**).
- **No aplica al `centroide`** (**R18**): sería comparar un punto consigo mismo, siempre `0`. Y
  garantiza que la sustitución **no puede entrar en bucle**.

### 6.3 · Qué se hace con el origen malo: **se descarta y se usa el centroide**

No se corta el job. No se falla. Se **baja un escalón** en la escalera que la 92 ya diseñó:

```
gps vigente  →  ultima_conocida  →  centroide
                                    ↑ aquí cae un origen incoherente, sea cual sea su fuente
```

Cinco razones, en orden de peso:

1. **Las paradas siguen siendo buenas.** Lo que está roto es el punto de partida, no el trabajo. Un
   mensajero con seis entregas en Costa Rica **tiene** una ruta razonable aunque no sepamos desde
   dónde arranca; cortar el job le deja sin ninguna.
2. **El centroide no es un escalón inventado**: es el tercero, documentado, con su motivo escrito
   («el esquema NO tiene coordenadas de zona ni de bodega, verificado») y con su fuente
   **persistida y visible en la UI**. Es decir: el mensajero ya tiene la señal de que el punto de
   partida es aproximado, sin añadir superficie nueva.
3. **La llamada deja de ser imposible.** Con el origen dentro del racimo de paradas, el modelo es
   resoluble y la llamada que se paga **sirve para algo**. No se paga por lo imposible, que es lo
   que pedía el punto 3 del alcance.
4. **La frescura y la coherencia son cosas distintas.** El origen del incidente tenía
   `fuente: 'gps'`: era **reciente y equivocado**. Por eso la guarda **no mira el TTL** (**R18**):
   un TTL caducado ya tiene su tratamiento (baja a `ultima_conocida`) y no dice nada sobre si el
   punto está en el país correcto.
5. **Se avisa** (**R19**): línea de traza + `logger.warn` agregado, con la distancia redondeada y el
   número de paradas. Un descarte silencioso sería cambiar un fallo mudo por otro.

### 6.4 · De dónde sale el umbral — y por qué no es un número inventado

**Los límites de esta feature se declaran así**, y hay precedente literal: `RUTA_MAX_PARADAS`,
`RUTA_DEBOUNCE_S`, `RUTA_ORIGEN_TTL_MIN` y `RUTA_SYNC_MIN_INTERVALO_S` son enteros positivos leídos
de `process.env` con `readPositiveInt`, con default, que **nunca lanzan** y que la 92 marcó 🧭
(«criterio propuesto») en su spec. Su Q7 lo dice sin adornos: *«propuse 100 sin base documental…
fijar y revisar con datos reales»*.

`RUTA_ORIGEN_MAX_KM` entra en esa familia, en la misma función y con la misma lectura.

**Tres caminos para el número, y por qué el tercero:**

| # | Camino | Veredicto |
| --- | --- | --- |
| 1 | Un **recuadro del país de operación** (Costa Rica) | ❌ `docs/architecture.md`, principio 4: «Sin hardcode de contexto. País, moneda, cuenta y credenciales se resuelven por configuración». Y el esquema **no tiene** coordenadas de zona ni de bodega de las que derivarlo (verificado; es la razón de que el escalón 3 sea el centroide). Sería hardcode de contexto, que el reviewer rechaza. |
| 2 | Un **múltiplo del radio del propio conjunto** de paradas | ❌ **Lo mata la propia medición**: cinco de las seis paradas comparten coordenada exacta, así que el radio del conjunto es ≈0 y cualquier múltiplo de cero rechazaría un origen legítimo a tres kilómetros. Un criterio que se rompe con el primer caso real no es un criterio. |
| 3 | **Distancia absoluta configurable, calibrada con producción** | ✔ Elegido. |

**Las dos anclas medidas que acotan el número:**

- **Cota inferior:** dos paradas legítimas de esa **misma llamada** distan **≈58 km**
  (`9.9029,-83.6816` ↔ `9.9747,-84.2068`). Un umbral cerca de ahí rompería repartos que hoy
  funcionan.
- **Cota superior:** el origen incoherente estaba a **≈1.040 km** del centroide. *(Calculado a mano
  con la fórmula del repo; el reporte original decía «unos 1.400 km». **B0.2 lo recalcula
  ejecutando `distanciaHaversineKm` y pega el número**; la decisión no depende del dígito, pero el
  número escrito sí tiene que ser el verdadero.)*

**Propuesta 🧭: `RUTA_ORIGEN_MAX_KM = 200`.** Más del triple de la dispersión legítima observada y
cinco veces menor que la incoherencia medida. **Se declara sin base documental**, como hizo la 92, y
**M1 lo sustituye antes de desplegar** (`requirements.md` § Mediciones, y **P2**). Si el máximo
legítimo de M1 se acerca a 200, el número cambia y se escribe por qué.

---

## 7 · D5 — Un solo fallo tipado, y la pantalla deja de romperse

**El defecto, medido:** `OptimizacionRutaService` sólo produce `RutaIntentoFallidoError` para los
desenlaces `transitorio`/`config_invalida`. Una **excepción** del cliente (respuesta con forma
inválida, HTTP 400, error del proveedor de token) lo atraviesa **sin pasar por
`marcarDesactualizada`** y llega cruda a `ruta-mensajero.ts`, cuyo `default:` la convierte en
`throw new Error("ruta-mensajero: AppErrorCode inesperado INTERNAL")`. **6 veces sobre 2 usuarios en
producción.**

**El arreglo, en el sitio donde vive la política:**

```
try   { outcome = await this.client.optimizar({ … }) }
catch (error) {
  opterror("service — el proveedor LANZÓ; se conserva el orden previo (R27)", error);
  await this.rutas.marcarDesactualizada(mensajeroId, <motivo saneado>);
  throw new RutaIntentoFallidoError(<motivo saneado>);
}
```

Tres propiedades:

1. **R27 de la 92 se cumple ahora también por esta puerta**: el último orden válido queda intacto y
   la ruta queda `desactualizada`, que es lo que alimenta el aviso de la UI. Hoy, con una excepción,
   **ni siquiera eso pasaba**.
2. **La cola sigue viendo una excepción** (**R26**): el backoff y el dead-letter no cambian.
3. **La action ya sabe tratarla**: su `catch` de `RutaIntentoFallidoError` devuelve un `conflict` con
   motivo. **No hace falta tocar `lib/types/ruta-mensajero.ts`** — `{ status: "conflict"; motivo:
   string }` ya existe. Es deliberado: mantiene el diff **fuera de `lib/types/`** y por tanto fuera
   de la lista que niega el gate rápido (§10).

**El motivo saneado** sale del propio error sólo si es una de **nuestras** clases (sus mensajes ya
están saneados por contrato: citan la operación y el estado, nunca el token, la URL ni una
coordenada). Ante un error de librería se usa un texto fijo: `error.message` de
`google-auth-library` o de `fetch` puede traer la petición completa colgada, y ahí es donde aparecen
las cabeceras con el `Bearer` — la misma trampa que `opterror` ya documenta.

---

## 8 · D6 — La premisa caducada se **anexa**, no se pisa

**Molde: el que la 261 usó** en `PosOrderCardMosaico.tsx:186-197`. El comentario original se queda
entero y debajo va un bloque que empieza por `⏳ FEATURE <n> (<fecha>) — …`.

En `google-route-optimization.ts:226-262`:

- **Se conserva verbatim** (**R27** del spec): *«Persistir una secuencia parcial sería peor que no
  optimizar: borraría el último orden bueno y dejaría paradas fuera de la ruta sin que nadie se
  entere.»* Es la razón de la regla nueva, no un resto histórico.
- **Se anexa, sin borrar la frase caducada** (**R28**), un bloque con **cinco piezas** que la
  guardia comprueba por separado (para que el fallo diga **cuál** falta):
  1. el marcador `⏳ FEATURE 265`;
  2. la **fecha**: `2026-08-22`;
  3. la palabra que dice que está superada (`CADUCADA` / `SUPERSEDIDA`);
  4. el **motivo medido**: el proveedor devolvió `skippedMandatoryShipmentCount = 6` con un origen
     a otro país, el 2026-08-21;
  5. el **puntero**: `specs/265-optimizador-lee-al-proveedor`.
- **La frase caducada no se borra.** Un spec —y un comentario— son la foto de su momento: quien lea
  el archivo tiene que poder ver qué se creía y por qué dejó de ser cierto. Borrarla dejaría la
  regla nueva sin historia.

### 8.1 · La guardia (**R29**)

`tests/unit/guards/premisa-saltos-caducada.guardia.test.ts`, molde de
`tests/unit/tablero-dia/d10-revertida.guardia.test.ts` (la 259) y de `d5-revertida` (la 261). Tres
mitades:

| Cláusula | Qué exige |
| --- | --- |
| (a) | El testigo **verbatim** del razonamiento que sobrevive sigue en el archivo. Si se pone roja, la respuesta **no** es actualizar el testigo: es que alguien reescribió el razonamiento en vez de anexarle la nota. |
| (b) | Las **cinco piezas** de la nota están, y el mensaje de fallo dice **cuál** falta. |
| (c) | En el árbol del optimizador (`lib/clients/*route*`, `lib/services/OptimizacionRutaService.ts`, `lib/interfaces/external/IRouteOptimizationClient.ts`) **no reaparece** ninguna frase que afirme que el proveedor no puede saltarse paradas. |

**Cada detector es una función pura con autocomprobación**: se le da un texto que **sí** infringe y
otro que no. Sin eso, una guardia de prosa se queda verde por vacía en cuanto un rename deja de
encajar — y este repo ya tuvo una guardia que **no podía fallar nunca** protegiendo justo lo que la
ficha decidía. El detector **normaliza espacios** antes de comparar: estos comentarios están
partidos en varias líneas con sangría.

---

## 9 · Contratos I/O — todo lo que cambia de forma

| Archivo | Cambio | Por qué así |
| --- | --- | --- |
| `lib/interfaces/external/IRouteOptimizationClient.ts` | `OptimizarOutcome` gana `{ status: "sin_solucion"; detalle: string; servidas: number; enviadas: number }` | Un desenlace, no un error (§4). Al ser una unión discriminada, **todos** los `switch` dejan de compilar hasta tratarlo: ese rojo es el objetivo. |
| `lib/clients/google-route-optimization.ts` | `respuestaSchema` amplía tres campos; `traducirSecuencia` deja de lanzar **sólo** en el caso «no cubre todas» y pasa a devolver el desenlace | §3, §4.1. Los otros tres `throw` **no se tocan**. |
| `lib/clients/fallback-route-optimization.ts` | `sin_solucion` → Haversine, con su `optlog` y su `warn` | §5.3. La regla de «cualquier otro error se re-lanza» **no se toca**. |
| `lib/services/OptimizacionRutaService.ts` | Guarda de coherencia del origen; `centroide()` extraído; `try/catch` alrededor de `client.optimizar`; rama `sin_solucion` como fallo del proveedor | §6, §7, §5.3. |
| `lib/config/route-optimization.ts` | `RUTA_ORIGEN_MAX_KM: number`, `readPositiveInt("RUTA_ORIGEN_MAX_KM", 200)` 🧭 | §6.4. Misma función, mismo comportamiento ante valor ausente/vacío/inválido (**R21**). |
| `.env.example` | Documentar la variable nueva | ⚠️ **Este archivo está en la lista que niega el gate rápido.** Ver §10. |
| `lib/actions/ruta-mensajero.ts` | **Sin cambios de tipo.** Sólo se beneficia de que el servicio ahora emite `RutaIntentoFallidoError` | §7. Deliberado: no se toca `lib/types/`. |

---

## 10 · Verificación — qué prueba qué, y qué mutación mata cada test

### 10.1 · El gate

**`./init.sh --rapido` es suficiente… salvo por `.env.example`.** El diff **no** toca migraciones,
`db/schema.prisma`, `lib/types/**` ni ningún archivo con nombre de dinero (`cierre`, `tarifa`, `pago`,
`wallet`, `liquidacion`, `ingreso`, `egreso`, `caja`, `comision`, `flete`, `moneda`, `cobro`,
`factura`, `premio`) — se comprobó nombre a nombre contra la lista de `docs/verification.md`. Pero
**`.env.example` sí está en esa lista**, así que documentar `RUTA_ORIGEN_MAX_KM` allí **niega el modo
rápido** y obliga al completo. No es un problema: es el gate haciendo su trabajo, y **se asume**. La
task **C1** exige el completo.

### 10.2 · El reparto

| Qué se prueba | Dónde | Por qué **ahí** |
| --- | --- | --- |
| El schema lee los tres campos y tolera su ausencia (R1, R2) | Unitario del cliente, con `fetchImpl` inyectado | El cliente ya es 100 % testeable sin red ni credencial: es la invariante 1 del archivo. |
| «No cubre todas» → `sin_solucion` con conteos (R4, R5, R9, R11) | Unitario del cliente | Con **la respuesta real del incidente como fixture** (`routes:[{}]` + 6 saltadas + `metrics`). |
| La decisión no depende de la forma interna (R3) | Unitario del cliente | Fixture con `skippedShipments: [{ loQueSea: 1 }]` → el desenlace es el mismo. |
| El motivo no filtra nada (R6, R32) | Unitario del cliente | Molde del `describe("R14 …")` que ya existe en ese archivo. |
| `sin_solucion` → Haversine, con secuencia **completa** (R9, R10, R12) | Unitario del compuesto | Se afirma que la secuencia devuelta tiene **exactamente** los `ordenId` de entrada, todos. |
| El resto de errores **siguen** re-lanzándose (R14, R30) | Unitario del compuesto | Es la mitad negativa: sin ella, un `catch` demasiado ancho pasa desapercibido. |
| La guarda del origen sustituye y no corta (R16-R20, R23) | Unitario del servicio, con dobles | La guarda es lógica de negocio pura sobre datos ya cargados. |
| El origen final es el que viaja **y** el que entra en la huella (R20) | Unitario del servicio | Se afirma el argumento con el que se llamó a `client.optimizar` **y** que la huella cambió. |
| Ausente/vacío/inválido → default, sin lanzar (R21) | Unitario de config | `tests/unit/config/route-optimization-config.test.ts` **ya existe**: se le suma el caso. |
| El job **completa** al degradar (R13) | Unitario del handler | Se afirma que `crearOptimizacionRutaHandler` **no lanza**. |
| Una excepción del cliente marca `desactualizada` y lanza el tipado (R24, R26) | Unitario del servicio | Se afirma `marcarDesactualizada` llamada **y** el tipo del error. |
| La pantalla recibe `conflict`, no una excepción (R25) | Unitario de la action | `tests/unit/actions/…`: molde de los `rejects.toThrow(/AppErrorCode inesperado/)` que ya existen — aquí la aserción es **la contraria**. |
| La premisa anexada y el razonamiento intacto (R27-R29) | Guardia de prosa | §8.1. |
| Las cinco guardas de coste siguen igual (R33) | Los tests que ya existen | `optimizacion-ruta-service.test.ts`, `optimizacion-ruta-origen.test.ts`. |

### 10.3 · ⚠️ El test que hay que **cambiar**, y por qué eso no puede pasar en silencio

`tests/unit/clients/google-route-optimization.test.ts:113` dice hoy:

> `it("una secuencia que no cubre TODAS las paradas -> lanza (nunca se persiste parcial)")`

Ese test **está bien escrito** y protege una invariante que sigue viva. Lo que cambia es **cómo** se
protege: ya no lanzando, sino degradando. La aserción se reescribe para afirmar el desenlace nuevo…
**y la invariante que el nombre prometía tiene que quedarse cubierta en otro sitio**, o el arreglo
habría borrado una red.

Por eso se exige, en el mismo PR: un test **del compuesto** que afirme que la secuencia degradada
cubre **todas** las paradas, y un test **del servicio** que afirme que un `sin_solucion` que llegue
sin compuesto **no** persiste nada parcial. Es la lección del repo sobre borrar un componente y
llevarse por delante su test.

### 10.4 · Mutaciones obligatorias (cada una debe producir un rojo **con nombre**)

| # | Mutación | Debe morir en |
| --- | --- | --- |
| M-a | Quitar `skippedShipments` del schema | test del cliente (R1) |
| M-b | Declarar `skippedShipments` **obligatorio** | test del cliente con respuesta sana sin ese campo (R2) |
| M-c | Hacer que la decisión de degradar mire `skippedShipments.length` en vez de la cobertura | test del cliente con forma interna desconocida (R3) |
| M-d | Devolver el motivo genérico «forma inesperada» | test del cliente que afirma el motivo real (R4) |
| M-e | Meter un índice de parada en el motivo | test de saneo (R6) |
| M-f | En el compuesto, re-lanzar `sin_solucion` en vez de degradar | test del compuesto (R9) |
| M-g | Degradar **sólo** cuando `servidas === 0` | test del compuesto con 4 de 6 servidas (R11) |
| M-h | Degradar también ante `transitorio` | test del compuesto, mitad negativa (R14) |
| M-i | Persistir la secuencia parcial en vez de la local | test del servicio (R10) |
| M-j | Borrar la guarda de coherencia del origen | test del servicio (R16) |
| M-k | Cambiar `>` por `>=` en el umbral | test del servicio con distancia **exactamente** igual al límite (R17) |
| M-l | Aplicar la guarda **sólo** a `fuente === "gps"` | test del servicio con `ultima_conocida` incoherente (R18) |
| M-m | Calcular la huella con el origen **viejo** | test del servicio que afirma la huella (R20) |
| M-n | Cortar el job en vez de sustituir el origen | test del servicio: la optimización continúa (R23) |
| M-o | Quitar el `try/catch` alrededor de `client.optimizar` | test del servicio (R24) y test de la action (R25) |
| M-p | Marcar la ruta degradada como `desactualizada` | test del servicio: la guarda de «sin cambios» corta la siguiente llamada (§5.4) |
| M-q | Reescribir el razonamiento original en vez de anexar | guardia (R27, R29) |
| M-r | Borrar el puntero a la ficha de la nota anexada | guardia (R28, R29) |

⚠️ **El arnés de mutaciones debe autocomprobarse.** En este repo ya reportó «9/9 supervivientes» dos
veces **sin haber ejecutado un solo test**. Cada mutación se pega con **su salida real** en
`progress/impl_265_backend.md`; «todas mueren» sin una corrida por mutación **no cuenta**.

### 10.5 · Ver la app (F6)

No hay harness E2E ejecutable en este repo; **F6 es el sustituto** y no es opcional. Ver `tasks.md`.

---

## 11 · Alternativas descartadas

**A1 · Persistir la secuencia parcial y dejar el resto «sin posición».** Descartada por el
razonamiento que ya estaba escrito en el archivo y que esta ficha **respeta**: dejaría paradas fuera
de la ruta sin que nadie se entere, indistinguibles de las que no tienen coordenadas. El mensajero
lleva el paquete y la app no se lo nombra. Y rompería la huella, que describe el **conjunto**
enviado. **Ésta es la alternativa del punto 2 del alcance, y queda descartada por escrito.**

**A2 · Tratar `sin_solucion` como `transitorio` y dejar que la cola reintente.** Descartada por la
medición: **72 eventos con la misma entrada y la misma respuesta**. Es determinista; reintentar no
lo arregla, cuesta dinero en cada intento y llena el dead-letter de ruido permanente. Es exactamente
el error que la 91 ya razonó para `ZERO_RESULTS`.

**A3 · Dar al servicio un segundo cliente (Google + Haversine) y que decida él.** Descartada:
duplica el concepto de fallback en dos capas y devuelve al servicio la decisión de **qué proveedor**
usa, que es justo lo que `IRouteOptimizationClient` aísla («si el SKU resultara inasumible, volver a
`computeRoutes` queda contenido en `lib/clients/` + `lib/config/`»). La regla nueva va donde ya vive
su hermana.

**A4 · Marcar la ruta degradada como `desactualizada`.** Descartada **midiendo la consecuencia**: la
guarda de «mismo conjunto y mismo origen» exige `estado === "vigente"`, así que marcarla
`desactualizada` **no cortaría** la siguiente llamada y seguiríamos pagando cada minuto por el mismo
modelo imposible. El coste de la decisión contraria está declarado (límite 2).

**A5 · Un recuadro geográfico del país de operación como criterio del origen.** Descartada:
`docs/architecture.md` principio 4 prohíbe el hardcode de país, y el esquema no tiene coordenadas de
zona ni de bodega de las que derivarlo — verificado, y es la razón de que el escalón 3 del origen sea
el centroide. **Ésta es la alternativa del umbral del punto 3, y queda descartada por escrito.**

**A6 · Un múltiplo del radio del propio conjunto de paradas.** Descartada **por la propia medición**:
cinco de las seis paradas comparten coordenada exacta, así que el radio es ≈0 y cualquier múltiplo
de cero rechazaría un origen legítimo a tres kilómetros. Un criterio que se rompe con el primer caso
real no es un criterio.

**A7 · Cortar el job cuando el origen no cuadra.** Descartada: deja al mensajero sin ninguna ruta
cuando existe una razonable entre sus paradas, y convierte un dato de partida malo en una operación
fallida. Además reintroduciría el bucle de reintentos que esta ficha viene a cerrar. Se sustituye el
origen y se avisa (§6.3).

**A8 · Poner la guarda del origen en el cliente, junto a la llamada.** Descartada: es **política de
coste**, y las cinco guardas de coste viven en el servicio con su orden documentado como normativo.
El cliente ni siquiera conoce `RouteOptimizationConfig`.

**A9 · Traducir `INTERNAL` a `conflict` en `toRutaActionError`.** Descartada: taparía **cualquier**
bug interno de esa action detrás de un mensaje amable, que es lo contrario de lo que el `default:`
existe para hacer. El arreglo va en el servicio, donde el fallo se conoce y se puede tipar (§7).

**A10 · Reescribir el comentario caducado «para dejarlo coherente».** Descartada: es la práctica que
esta casa ya rechazó explícitamente en la 261 (y antes en la 259). Un comentario que ya no es cierto
**se anexa, no se pisa**, y una guardia lo vigila en los dos sentidos (§8).

**A11 · Declarar la forma interna de `skippedShipments` de memoria.** Descartada por la regla 6 de
`CLAUDE.md`: no está en `docs/`, ni en `specs/`, ni en el código (**cero** ocurrencias). Se escribe
defensivo, se mide (B0.1) y se aprieta después.

---

## 12 · Riesgos

| Riesgo | Mitigación |
| --- | --- |
| El umbral 🧭 rechaza orígenes legítimos y degrada rutas sanas al centroide | **M1 antes de desplegar** (task B0.4). Y el fallo es benigno: se pierde precisión del punto de partida, no la ruta. |
| La forma real de `skippedShipments` no encaja con el schema | El schema es **tolerante** y la decisión **no depende** de él (**R3**): el peor caso es que el motivo sea menos específico, nunca que el mensajero se quede sin ruta. |
| Al degradar se congela un orden local hasta que cambie el conjunto | Declarado (límite 2). En la práctica la posición del mensajero cambia y la huella se invalida sola. Si M2/M3 dicen otra cosa, se re-abre. |
| El test que hoy afirma «lanza» se reescribe y se pierde la invariante | §10.3: **dos tests nuevos** cubren lo que ese nombre prometía, en el mismo PR. |
| Otra sesión mueve `dev` mientras esto se implementa | Pre-vuelo contra `origin/dev` justo antes del PR (**C2**). |
| El `console.log` del token (**H2**) se arregla en dos sitios a la vez y colisiona | **B0.3** lo comprueba contra `origin/dev` **antes** de tocar el archivo. |
| Los jobs ya en `failed` no se recuperan solos | **M2** lo mide y **P6** lo decide. |
