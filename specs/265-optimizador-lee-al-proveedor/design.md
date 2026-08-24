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
| Degradar a Haversine en ese desenlace, con la secuencia **completa** | ~~Distinguir en la UI una ruta local de una optimizada~~ → **ENTRA** desde el 2026-08-22 (P3): §13 y §14 |
| **Que el mensajero sepa que su orden es aproximado** (P3): columna, DTO y dos avisos | Cambiar la escalera del origen o el aviso de origen aproximado de la 92 (§14.4) |
| **Que el límite del origen viva en un solo sitio y se declare sin calibrar** (P2): §15 | Calibrar ese límite con datos reales — **M1 no se pudo medir** y así queda escrito |
| **Apagar la traza de diagnóstico** (P4) y que nada dependa de ella: §16 | ~~Invertir el valor por defecto de `RUTA_DEBUG_LOG` en el código~~ → **ENTRA** desde el 2026-08-22 (P7): §16.1 |
| Una guarda de coherencia del origen **antes** de la llamada facturada | Validar las paradas entre sí → límite declarado 4 |
| Que el fallo del proveedor deje de llegar crudo a la pantalla del mensajero | La **calidad de la geocodificación** → hallazgo **H1**, ficha aparte |
| Anexar la premisa caducada con su guardia | El `console.log` del token → hallazgo **H2**, hotfix aparte |

### Modelo de datos: **ninguno**

> ⏳ **ANEXO 2026-08-22 — YA NO ES «NINGUNO»: hay UNA columna.** P3 obliga a que el mensajero sepa
> que su orden es aproximado **después de recargar** y **cuando el orden lo calculó el cron**, y eso
> no se puede saber sin un dato persistido. El modelo de datos real de la ficha está en **§13**:
> **una columna nullable en una tabla que ya existe, sin tabla nueva, sin RLS nueva y sin backfill**.
> Lo de abajo se conserva verbatim porque sigue siendo cierto **para los bloques §A-§F**, que es el
> alcance con el que se escribió.

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

> ## 📍 AQUÍ SE INTERCALAN LAS DECISIONES DE LA PUERTA HUMANA (2026-08-22)
>
> Las cuatro que siguen —**§13 D7**, **§14 D8**, **§15 D9**, **§16 D10**— se escribieron **después**
> de §1-§8 y **van numeradas altas a propósito**: renumerar las viejas habría roto todas las
> referencias cruzadas de este archivo y de `tasks.md`, que es exactamente el género de cambio
> silencioso que esta ficha persigue. Se colocan **antes** de §9-§12 porque los contratos (§9), la
> verificación (§10), las alternativas (§11) y los riesgos (§12) **ya las recogen**: leer §9 sin
> haber leído §13 dejaría media tabla sin explicación.
>
> **Orden de lectura:** §1 → §8.1 → **§13 → §16** → §9 → §12.

## 13 · D7 — La procedencia del ORDEN se persiste (P3, parte 1)

> Numerada 13 y no 8.2 a propósito: es una decisión **nueva**, tomada después de la puerta humana, y
> tiene que verse como tal.

### 13.1 · El problema, medido — por qué no basta con devolverlo en la respuesta

Un orden aproximado se produce por **dos caminos**, y sólo uno de ellos tiene a alguien mirando:

| Camino | Quién lo dispara | ¿Hay una respuesta que devolverle a alguien? |
| --- | --- | --- |
| Botón «Sincronizar ruta» | el mensajero | **Sí**: `sincronizarRuta` devuelve un valor a su pantalla |
| Job `optimizacion_ruta` | el cron, tras recoger o gestionar | **No**: `crearOptimizacionRutaHandler` no devuelve nada a nadie (`optimizacion-ruta-handler.ts:33-53`) |

Y la pantalla de reparto es **server-driven**: `RepartoModule` recibe `ruta: RutaResumenDTO` por
props desde un Server Component y no usa SWR (`RepartoModule.tsx:89`, y el comentario de
`lib/actions/ruta-mensajero.ts:8-12` lo dice con todas sus letras). O sea: **lo que no esté
persistido no existe en el primer render**, y un `F5` se lleva por delante cualquier señal que viva
en estado de cliente — exactamente lo que ya le pasa al `trazado`, declarado «ES EFÍMERO» en
`lib/types/ruta-mensajero.ts:50-52`.

**Conclusión:** sin un dato persistido, un orden calculado en local por el cron sería **invisible**,
y con la traza apagada (P4/P7) lo sería también para el operador (límite declarado 5). Por eso hay
columna.

> ⏳ **2026-08-23 — aquí decía «con `RUTA_DEBUG_LOG=0`».** Caducado: P7 se cerró **invirtiendo el
> default en el código**, así que la traza nace apagada y `RUTA_DEBUG_LOG=1` es lo que la enciende.
> El argumento no cambia —de hecho se refuerza: ahora el estado apagado es el **normal**, no el que
> alguien tiene que acordarse de configurar—. Copia superviviente del barrido de `m5`.

### 13.2 · La columna

```
ruta_optimizada.secuencia_fuente TEXT NULL     -- 'proveedor' | 'local'
```

- **Nombre.** `secuencia_fuente`, **no** `orden_fuente`. En este repo `orden` es una **entidad** (la
  guía del destinatario): una columna llamada `orden_fuente` en `ruta_optimizada` se leería como «de
  dónde salió la orden», que es otra cosa. `reemplazarSecuencia` ya llama «secuencia» a lo que esta
  columna califica.
- **TEXT, no enum.** Mismo criterio, escrito, que sus dos hermanas de esta misma tabla:
  `origen_fuente` (`schema.prisma:2004`) y `trazado_fuente`
  (`20260814120000_ruta_optimizada_trazado/migration.sql:45-47`: «TEXT y no enum, mismo criterio que
  `origen_fuente`: el vocabulario es nuestro y la columna la escribe un único repositorio»). Además
  evita la mina conocida de este repo: un enum nuevo obliga a mirar cómo lo recrean los `down.sql`
  previos.
- **Nullable y sin DEFAULT.** `ADD COLUMN` nullable sin default **no reescribe la tabla** en Postgres
  (sólo toca el catálogo), igual que la migración del trazado. `NULL` significa «no consta», y es
  el estado correcto tanto para las rutas antiguas como para el caso trivial de 0/1 parada
  (**R37**).
- **Sin backfill.** No hay forma de saber quién ordenó una secuencia ya persistida sin volver a
  pagar una llamada por mensajero. Se curan solas en la siguiente sincronización (límite 6).
- **Sin CHECK del vocabulario.** Mismo motivo que la migración del trazado declara para sus cuatro
  columnas: la invariante la garantiza el repositorio, que es el único escritor, y un CHECK sólo
  rompería filas históricas que este diseño manda dejar en `NULL`.
- **RLS: sin superficie nueva.** `ruta_optimizada` tiene RLS habilitada **sin policies** (sólo
  service role) desde su migración original, y añadir una columna no la toca. Citado tal cual en
  `20260814120000_ruta_optimizada_trazado/migration.sql:26-31`.
- **PII: ninguna.** El valor es una de dos palabras de nuestro vocabulario. No es una coordenada, no
  es un identificador y no dice nada de ningún destinatario.

**Migración:** `db/migrations/20260822140000_ruta_secuencia_fuente/` con `migration.sql` **y
`down.sql`** (`ALTER TABLE "ruta_optimizada" DROP COLUMN "secuencia_fuente";`).

> ⚠️ **El `down.sql` se escribe, y no es opcional aunque el gate sólo avise.** `init.sh` (paso 6,
> `:198-209`) **advierte** —no falla— cuando una migración no lo tiene, y por ese hueco las **tres**
> migraciones `ruta_*` del 2026-08-14 se quedaron sin `down.sql` (verificado: los directorios
> `20260814120000_ruta_optimizada_trazado`, `20260814140000_ruta_parada_tramo` y
> `20260814160000_ruta_tramo_vivo_at` sólo contienen `migration.sql`). `docs/architecture.md` lo
> declara **OBLIGATORIO**; esta ficha lo cumple y **no toca las tres viejas** (arreglarlas es otra
> ficha, y editar una migración ya aplicada es la trampa del *drift*).
> Criterio de «hecho» honesto para el gate: la lista de «migraciones sin down.sql» que imprime
> `init.sh` **no crece**.

**Nombre del directorio:** contiene `ruta_secuencia_fuente`, **no** `ruta_optimizada`. No es
cosmético: `tests/integration/db/ruta-optimizada-migracion.test.ts:14-23` resuelve su directorio con
`^\d+_<nombre>$` y **lanza si hay más de una coincidencia**; un nombre como
`..._ruta_optimizada_fuente` no colisiona con ese regex anclado, pero acercarse a él sin necesidad
es pedir un rojo raro dentro de un año.

### 13.3 · Quién sabe la procedencia, y cómo llega a la fila

Hoy **nadie** la sabe: `OptimizarOutcome.ok` es `{ status: "ok"; secuencia: string[] }`
(`IRouteOptimizationClient.ts:29`) y el compuesto degrada de forma **transparente** —el servicio
recibe un `ok` idéntico venga de Google o de Haversine—. Esa transparencia era una virtud del
aislamiento y ahora es justo el fallo mudo que hay que cerrar.

```ts
export type SecuenciaFuente = "proveedor" | "local";

| { status: "ok"; secuencia: string[]; fuente: SecuenciaFuente }
```

**Campo REQUERIDO, no opcional.** Un `fuente?:` dejaría que un cliente nuevo (o el de un test) no
dijera de dónde viene su orden y que el sistema lo interpretara como «del proveedor» por omisión:
sería sembrar exactamente el fallo que la ficha persigue. Requerido, el compilador obliga a los
**tres** productores a pronunciarse:

| Productor | Qué devuelve | Por qué |
| --- | --- | --- |
| `GoogleRouteOptimizationClient` | `"proveedor"` | la secuencia la ordenó el proveedor |
| `HaversineRouteOptimizationClient` | `"local"` | **siempre**: ese cliente no habla con nadie (su cabecera lo declara: «NO toca la red… sólo puede devolver `ok`») |
| `FallbackRouteOptimizationClient` | lo que le devuelva el que haya usado | no inventa: **propaga**. Si degradó, lo que llega es `"local"` porque lo dice Haversine, no porque el compuesto lo suponga |

**El servicio no decide**, sólo transporta: `outcome.fuente` entra en
`ReemplazarSecuenciaMeta.secuenciaFuente` y de ahí a la fila, dentro de la **misma transacción** que
ya escribe `origen_fuente`, `huella_set` y limpia `ultimo_error`
(`RutaOptimizadaRepository.ts:135-153`). Eso da **R36** gratis: la marca se reescribe siempre junto a
la secuencia que describe, y no puede quedar una marca vieja pegada a un orden nuevo.

**Los dos casos que escriben `null`:**

1. La rama trivial de R35 de la 92 (0 ó 1 parada, `OptimizacionRutaService.ts:166-215`): no hubo
   ordenación, así que no hay procedencia que afirmar (**R37**).
2. `marcarDesactualizada`: **no toca la columna**. Correcto y deliberado — la marca describe **la
   secuencia persistida**, que en ese caso es la vieja y sigue siendo tan buena o tan mala como era.
   Un intento fallido no cambia de dónde salió el orden que el mensajero está viendo.

### 13.4 · Cómo llega a la pantalla

Dos caminos, uno por cada superficie, y **ninguno inventa vocabulario nuevo**:

```
ruta_optimizada.secuencia_fuente
  ├─ RutaOptimizadaDTO.secuenciaFuente        (repo → dominio)
  │    └─ MisAsignacionesService              → RutaResumenDTO.secuenciaFuente   → primer render
  └─ EjecutarOptimizacionResult.ok            → SincronizarRutaResult.ok         → toast inmediato
```

- `RutaResumenDTO` (`lib/interfaces/services/IMisAsignacionesService.ts:162-177`) gana
  `secuenciaFuente: "proveedor" | "local" | null`, **al lado de `origenFuente` y con la misma forma**
  (requerido y nullable). En `MisAsignacionesService.ts:346-354` es una línea más:
  `secuenciaFuente: ruta?.secuenciaFuente ?? null`.
- `SincronizarRutaResult` (`lib/types/ruta-mensajero.ts:54`) gana el mismo campo **sólo en la rama
  `ok`**. Va a `null` cuando la ejecución fue `omitida`: el toast habla de **lo que acaba de pasar**,
  y si no se recalculó nada no tiene nada que decir — el aviso persistente ya está en pantalla, y
  `router.refresh()` (`SincronizarRutaButton.tsx:85`) lo trae al día.
- **El repositorio no importa de `lib/interfaces/services/`**: la unión se declara en el productor
  (`IRouteOptimizationClient.ts`) y se **espeja** como literal en el contrato del repositorio, que es
  exactamente lo que ese archivo ya hace y razona para `TrazadoPersistido`
  (`IRutaOptimizadaRepository.ts:45-49`: «es un ESPEJO… el repositorio no debe importar de
  `lib/interfaces/services/`»).

⚠️ **`lib/types/ruta-mensajero.ts` entra en el diff, y eso NIEGA el gate rápido.** Es el motivo
principal —hay tres más— por el que esta ficha corre `./init.sh` completo. Ver §10.1.

---

## 14 · D8 — La superficie que ve el mensajero (P3, parte 2)

### 14.1 · Dos avisos, porque son dos momentos distintos

| # | Dónde | Cuándo | Por qué ahí |
| --- | --- | --- | --- |
| **A** | `RepartoModule`, hermano del aviso «El orden mostrado no está actualizado» (`RepartoModule.tsx:667-676`) | **siempre** que `ruta.secuenciaFuente === "local"` | Es el aviso que sobrevive al `F5`, el que cubre el orden calculado por el **cron**, y el que está **junto a la lista que el mensajero sigue** |
| **B** | El toast de `SincronizarRutaButton` (`:82-85`) | justo tras pulsar, si el orden que acaba de salir es local | Feedback inmediato. Hoy ese toast dice **«Ruta sincronizada.»** pase lo que pase: con un orden local, eso es una **media verdad** dicha en el peor momento |

**El aviso A no va dentro del mapa.** El bloque del mapa es un acordeón que sólo se monta si hay
paradas con coordenadas y si está abierto (`RepartoModule.tsx:685-722`), y ahí vive el aviso del
origen aproximado (`:707-712`). El orden de las paradas manda **en la lista**, que se ve siempre; un
aviso sobre el orden escondido dentro de un mapa plegado es un aviso que no existe. Se usa `Alert`
con `variant="default"` (existe: `components/ui/alert.tsx:9-19`) — **no `destructive`**: esto no es
un error, es una ruta utilizable que conviene revisar. El `destructive` está reservado a
«El orden mostrado no está actualizado».

### 14.2 · Las palabras exactas

**Aviso A (persistente):**

> **El orden de las paradas es aproximado**
> Lo calculamos en la app, por cercanía en línea recta: no toma en cuenta calles ni tráfico. Revísalo
> antes de salir.

**Aviso B (toast, `toast.warning`, que ya se usa en ese mismo `switch`):**

> Ruta ordenada de forma aproximada: revisa el orden de las paradas.

**Qué se comprueba de esos textos, y por qué cada cosa:**

| Regla | Motivo |
| --- | --- |
| Dice **qué** pasa («el orden es aproximado») y **qué hacer** («revísalo antes de salir») | Un aviso que no dice qué hacer es ruido; el de origen aproximado de la 92 ya sigue ese molde |
| **No** dice *por qué* (credencial, proveedor, saltos) | Al mensajero no le sirve y no puede hacer nada con ello. La causa va al dato persistido y al motivo registrado, que es donde la operación la busca |
| **Prohibidas** «degradar», «degradación», «fallback», «Haversine», «proveedor», «optimizador», y cualquier sigla (**R41**) | Convención de la casa: en la UI se habla claro. Este repo ya arrastra deuda por meter una sigla en una pantalla |
| **Prohibidas** coordenadas, direcciones, guías e ids (**R42**) | R14 de la 92, y aquí no hay ninguna razón para acercarse a ese borde |
| «en la app» / «línea recta» **sí** valen | Describen lo que pasó sin nombrar nada interno. Y son literalmente ciertas: vecino más cercano sobre distancia de círculo máximo (`haversine-route-optimization.ts:1-17`) |

### 14.3 · La ruta local por FALTA DE CREDENCIAL deja de ser invisible

Es el caso que hoy se degrada en silencio (`fallback-route-optimization.ts:42-53`: degrada, escribe
un `optlog` y un `logger.warn`… que no llega a nadie, límite declarado 5). **No hace falta ningún
código nuevo para cubrirlo**: Haversine devuelve `"local"` sea cual sea el motivo, así que el mismo
aviso aparece. Y **no se le nombra la causa al mensajero** (**R44**): «falta la credencial de Route
Optimization» no es información que él pueda usar.

Eso hace que esta ficha **cierre el límite declarado 1 entero**, no sólo su mitad nueva.

### 14.4 · Tres señales parecidas que NO se pueden confundir

Ya hay dos avisos de «esto es aproximado» en esa pantalla, y ahora entra un tercero. Son **tres
hechos distintos** y el diseño exige que sigan siéndolo (**R43**):

| Señal | Qué dice | Dónde vive hoy |
| --- | --- | --- |
| Punto de partida aproximado | *desde dónde* se calculó | `RepartoModule.tsx:293-295` y `:707-712`, a partir de `origenFuente` |
| Línea punteada en el mapa | el **dibujo** no es por calles | `RutaMapaInner.tsx:120-122` y `:158`, a partir de `trazado.fuente` |
| **Orden de paradas aproximado** ← nuevo | el **orden** no lo calculó el proveedor | `secuenciaFuente` |

**Pueden darse las tres a la vez**, y entonces se muestran las tres. Fundirlas en un solo mensaje
—«todo esto es aproximado»— sería más corto y **más falso**: un orden local con trazado por calles
es un caso real, y un origen aproximado con orden del proveedor también. El test lo fija: con las
tres señales activas, los tres textos están presentes y son distintos.

### 14.5 · Lo que NO cambia en la UI

- La escalera del origen, su aviso y su texto: **intactos**.
- El punteado del mapa: **intacto**.
- El aviso `destructive` de ruta desactualizada: **intacto**.
- Ningún componente nuevo, ninguna primitiva nueva: se usa el `Alert` que ya está importado en ese
  archivo. `docs/architecture.md` § «sin sobre-ingeniería»: esto se usa en un solo sitio.

---

## 15 · D9 — El límite del origen: un solo sitio, y declarado sin calibrar (P2)

**El número queda en `RUTA_ORIGEN_MAX_KM = 200`** (§6.4), y la puerta humana añadió dos exigencias
que el diseño tiene que hacer verificables.

### 15.1 · Un solo sitio (**R46**)

`lib/config/route-optimization.ts`, dentro de `loadRouteOptimizationConfig`, con `readPositiveInt`
—la misma función que ya sirve a `RUTA_MAX_PARADAS`, `RUTA_DEBOUNCE_S`, `RUTA_ORIGEN_TTL_MIN` y
`RUTA_SYNC_MIN_INTERVALO_S` (`:164-168`)—. El servicio lee `this.config.RUTA_ORIGEN_MAX_KM` y **el
literal `200` no aparece en ningún otro módulo de `lib/`, `app/` o `components/`**.

Lo vigila la misma guardia de §15.2, con una autocomprobación: se le da un árbol simulado con el
literal duplicado y **tiene que ponerse roja**. Los tests **sí** pueden fijar valores propios —los
inyectan por config, que es como se prueba un umbral sin depender del default.

### 15.2 · Declarado sin calibrar, por escrito y con guardia (**R47**)

El campo lleva, en su comentario de contrato, las **cuatro piezas** que la guardia comprueba por
separado (para que el rojo diga cuál falta):

1. el marcador `🧭` o la palabra `PROPUESTO`;
2. la frase que dice que **no está calibrado con datos de producción**;
3. la **fecha** `2026-08-22` y el motivo: **M1 no se pudo medir** —`ruta_optimizada_parada` vacía y
   0 órdenes en `en_reparto`—, y el caso de ≈1.040 km que lo inspiró es **una prueba del propio
   humano**, no evidencia de campo;
4. el **puntero**: `specs/265-optimizador-lee-al-proveedor`.

Molde: el mismo de la guardia de la premisa (§8.1), y por la misma razón que allí — **una guardia de
prosa que no puede fallar nunca no cuenta**. Detector puro, con un texto que infringe y otro que no,
y normalización de espacios (estos comentarios van partidos en varias líneas).

**Por qué una guardia y no «confiar en el comentario»:** el precedente exacto es
`RUTA_MAX_PARADAS = 100`, declarado sin base documental por la 92 con la nota «fijar y revisar con
datos reales». Nadie lo revisó, y hoy sigue ahí sin que nada lo recuerde. La diferencia entre un
número provisional y un número de verdad es **que alguien lo pueda saber al leerlo**.

### 15.3 · Lo que esto NO es

No es calibrar. **M1 no se pudo medir y no se sustituye por una estimación**: con
`ruta_optimizada_parada` vacía no hay centroide contra el que medir nada. La task de re-medición
sigue viva para antes de desplegar, y si M1 devuelve algo que se acerque a 200, **se para y se
pregunta**.

---

## 16 · D10 — Apagar la traza, y que eso no rompa nada (P4)

### 16.1 · Qué es exactamente el cambio

> ⏳ **CORREGIDO 2026-08-23 (m6 de la revisión) — ESTE PÁRRAFO DECÍA LO CONTRARIO DE LO QUE HACE EL
> CÓDIGO.** Lo que decía: «`RUTA_DEBUG_LOG=0` en el entorno. **Cero líneas de código**: `activo()` ya
> lee esa variable en cada llamada». Describía el plan **antes de P7**, y **P7 se cerró al revés**:
> «se **INVIERTE EL DEFAULT EN EL CÓDIGO**» (segunda puerta de `requirements.md`). O sea: `activo()`
> **sí se tocó**, y lo correcto es el código, no este párrafo.

**Qué es el cambio hoy:** `activo()` (`lib/logging/optimizer-log.ts`) sólo devuelve `true` cuando
`RUTA_DEBUG_LOG` vale `1` o `true`. La traza **nace apagada en todo entorno** —incluido cualquiera
que se cree mañana— sin depender de que alguien se acuerde de poner una variable, y la variable pasa
a ser el interruptor para **encenderla** a propósito cuando haya que diagnosticar.

Lo que sigue en pie del párrafo original: se documenta el **nombre** en `.env.example` —que es
para lo que ese archivo existe, y donde ya vive su hermano `WHATSAPP_DEBUG_LOG` (`:13-15`)—, junto a
`RUTA_ORIGEN_MAX_KM`.

> Nota medida: hoy `.env.example` **no documenta ni una** variable `RUTA_*` ni `GOOGLE_ROUTE_OPT_*`.
> Esta ficha añade **las dos que decide** y no se mete con el resto de la familia: documentar
> credenciales que no toca no es su trabajo y ensancharía el diff en un archivo que ya niega el gate
> rápido.

**En qué entornos** lo decide el humano (**P7**). Y se fija **por entorno**, nunca de una vez para
Production y Preview: en este repo una variable puesta en los dos a la vez ya apuntó al proyecto
Supabase equivocado en uno de ellos.

> ⏳ **ANEXO 2026-08-23 (m6).** Con el default ya invertido, **poner la variable no hace falta para
> apagar nada**: los dos entornos nacen apagados. Lo único que queda de este párrafo es la
> precaución de **no** ponerla en Production y Preview a la vez el día que alguien la use para
> **encender** la traza. La task **C7** queda en gran parte superada por lo mismo, y así está
> anotada dentro de ella.

### 16.2 · Lo que se pierde, dicho sin adornos

| Se pierde | Consecuencia asumida |
| --- | --- |
| `client/google — respuesta cruda del proveedor` (`google-route-optimization.ts:210`) | **P1 y P5 se quedan sin resolver.** No se verá la forma interna de `skippedShipments` ni si `validationErrors` trae texto libre |
| `client/google — ENTRADA` (`:106-111`) | Ya no se podrá contrastar «qué le enviamos» contra «qué contestó» leyendo el log |
| Toda la traza `service — …` de las guardas de coste | Se deja de ver por log qué guarda cortó |

**Lo que se gana, y por eso el humano tiene razón en apagarla:** esa traza **imprime coordenadas de
entrega de destinatarios en el log de Vercel**, que es exportación de dato personal a un tercero
fuera de la base. Su propio módulo manda apagarla cuando el diagnóstico termine
(`optimizer-log.ts:4-19`), y esta ficha **es** el final del diagnóstico.

### 16.3 · Qué lo sustituye — el diseño no puede quedar colgado de un log

**Regla de diseño (R48): ninguna decisión, ningún motivo y ningún aviso pasa por `optlog`.**

| Lo que antes se veía en la traza | Dónde vive ahora |
| --- | --- |
| que se degradó y por qué | el **motivo** de §3.2, que va a `OptimizarOutcome.detalle` y a `ruta_optimizada.ultimo_error` cuando corresponde |
| que el orden de una ruta es local | **`secuencia_fuente`** (§13): una columna, consultable con un `SELECT` |
| que el mensajero está viendo un orden aproximado | el **aviso A** de §14 |

**Esto ya está verificado por construcción, no de palabra:** `tests/setup/jest-dom.ts` pone
`process.env.RUTA_DEBUG_LOG = "0"` para **toda** la suite. Es decir, cada test de esta ficha corre
**con la traza apagada**, y cualquier lógica que dependiese de ella saldría roja. Se añade además un
test explícito que lo afirma, para que la propiedad tenga nombre y no dependa de que nadie toque esa
línea del setup.

### 16.4 · Y por eso la verificación **F6** cambia de fuente

La `F6` original mandaba «leer los logs de runtime de preview (`optimizer***:`)». Con P4 eso puede no
existir. **F6 se rediseña para verificar por lo observable**: la pantalla del mensajero y una
consulta de **sólo lectura** a `ruta_optimizada.secuencia_fuente`. Leer el log queda como extra si
la traza sigue encendida en preview (**P7**). Ver `tasks.md`.

### 16.5 · P6, cerrada: no se re-encola nada

M2 midió **6** jobs `optimizacion_ruta` en `failed` de esta familia, **todos del mismo día**, y **0**
rutas en `desactualizada`. El flujo normal (recoger → gestionar → sincronizar) vuelve a encolar por
evento, así que **no hay task de re-encolado** y no debe aparecer ninguna. Lo que sí queda es
**comprobar después del despliegue** que no nacen jobs nuevos con ese mismo error: eso es lo que
prueba que el arreglo funcionó.

---

## 9 · Contratos I/O — todo lo que cambia de forma

| Archivo | Cambio | Por qué así |
| --- | --- | --- |
| `lib/interfaces/external/IRouteOptimizationClient.ts` | `OptimizarOutcome` gana `{ status: "sin_solucion"; detalle: string; servidas: number; enviadas: number }` | Un desenlace, no un error (§4). Al ser una unión discriminada, **todos** los `switch` dejan de compilar hasta tratarlo: ese rojo es el objetivo. |
| `lib/clients/google-route-optimization.ts` | `respuestaSchema` amplía tres campos; `traducirSecuencia` deja de lanzar **sólo** en el caso «no cubre todas» y pasa a devolver el desenlace | §3, §4.1. Los otros tres `throw` **no se tocan**. |
| `lib/clients/fallback-route-optimization.ts` | `sin_solucion` → Haversine, con su `optlog` y su `warn` | §5.3. La regla de «cualquier otro error se re-lanza» **no se toca**. |
| `lib/services/OptimizacionRutaService.ts` | Guarda de coherencia del origen; `centroide()` extraído; `try/catch` alrededor de `client.optimizar`; rama `sin_solucion` como fallo del proveedor | §6, §7, §5.3. |
| `lib/config/route-optimization.ts` | `RUTA_ORIGEN_MAX_KM: number`, `readPositiveInt("RUTA_ORIGEN_MAX_KM", 200)` 🧭 | §6.4. Misma función, mismo comportamiento ante valor ausente/vacío/inválido (**R21**). |
| `.env.example` | Documentar `RUTA_ORIGEN_MAX_KM` **y** `RUTA_DEBUG_LOG` | §16.1. ⚠️ **Este archivo está en la lista que niega el gate rápido.** Ver §10.1. |
| ~~`lib/actions/ruta-mensajero.ts`~~ | ~~**Sin cambios de tipo.**~~ | §7. Deliberado: no se toca `lib/types/`. **⏳ Caducado el 2026-08-22: P3 obliga a tocarlo** (fila de abajo). |

### 9.1 · Lo que añade la puerta humana del 2026-08-22 (§13-§16)

| Archivo | Cambio | Por qué así |
| --- | --- | --- |
| `db/migrations/20260822140000_ruta_secuencia_fuente/` | `migration.sql` (`ADD COLUMN "secuencia_fuente" TEXT`) **+ `down.sql`** | §13.2. Nullable, sin default, sin backfill, sin CHECK, sin RLS nueva. |
| `db/schema.prisma` | `RutaOptimizada.secuenciaFuente String? @map("secuencia_fuente")` | §13.2. Junto a `origenFuente` y `trazadoFuente`, que son sus hermanas de criterio. |
| `lib/interfaces/external/IRouteOptimizationClient.ts` | `SecuenciaFuente = "proveedor" \| "local"`; la rama `ok` gana `fuente: SecuenciaFuente` **requerido** | §13.3. Requerido para que ningún cliente pueda callarse de dónde salió su orden. |
| `lib/clients/{google,haversine,fallback}-route-optimization.ts` | cada uno declara su `fuente`; el compuesto **propaga**, no supone | §13.3. |
| `lib/interfaces/repositories/IRutaOptimizadaRepository.ts` | `RutaOptimizadaDTO.secuenciaFuente` y `ReemplazarSecuenciaMeta.secuenciaFuente` | §13.3. La unión se **espeja** como literal: el repo no importa de `lib/interfaces/services/` (`:45-49`). |
| `lib/repositories/RutaOptimizadaRepository.ts` | escribe la columna en la **misma transacción** que la secuencia; la proyecta en `findByMensajero` | §13.3. `marcarDesactualizada` **no** la toca. |
| `lib/services/OptimizacionRutaService.ts` | pasa `outcome.fuente` a `reemplazarSecuencia`; `null` en la rama trivial de 0/1 parada | §13.3. El servicio transporta, no decide. |
| `lib/interfaces/services/IOptimizacionRutaService.ts` | `EjecutarOptimizacionResult.ok` gana `secuenciaFuente` | §13.4. |
| **`lib/types/ruta-mensajero.ts`** | `SincronizarRutaResult` rama `ok` gana `secuenciaFuente: "proveedor" \| "local" \| null` | §13.4. ⚠️ **`lib/types/**` NIEGA el gate rápido.** Ver §10.1. |
| `lib/actions/ruta-mensajero.ts` | reenvía `secuenciaFuente` en la rama `ok` | §13.4. |
| `lib/interfaces/services/IMisAsignacionesService.ts` · `lib/services/MisAsignacionesService.ts` | `RutaResumenDTO.secuenciaFuente`, servido tal cual desde la fila | §13.4. Una línea, al lado de `origenFuente`. |
| `app/(app)/mis-asignaciones/_components/RepartoModule.tsx` | **Aviso A**: `Alert variant="default"`, hermano del de ruta desactualizada | §14.1-§14.2. |
| `app/(app)/mis-asignaciones/_components/SincronizarRutaButton.tsx` | **Aviso B**: el toast deja de decir «Ruta sincronizada.» cuando el orden es local | §14.1-§14.2. |
| `lib/config/route-optimization.ts` | `RUTA_ORIGEN_MAX_KM` con su declaración de «no calibrado» completa (4 piezas) | §15.2. |

---

## 10 · Verificación — qué prueba qué, y qué mutación mata cada test

### 10.1 · El gate

> ⏳ **REESCRITO EL 2026-08-22.** Lo de abajo se conserva porque su conclusión —gate completo— no
> cambia; lo que cambia es que **ya no depende de un solo archivo**. Con §13-§16 el diff toca
> **cuatro** entradas de la lista de `docs/verification.md:37-43`:
>
> | ruta tocada | por qué está en la lista |
> | --- | --- |
> | `db/migrations/**` | «una migración no la importa nadie»: ningún test sale seleccionado por tocarla |
> | `db/schema.prisma` | ídem |
> | **`lib/types/**`** (`ruta-mensajero.ts`) | «un catálogo lo importa medio repo; los relacionados son casi todos» |
> | `.env.example` | «cambian cómo se construye y se ejecuta todo» |
>
> **`./init.sh --rapido` se niega solo, y es un `fail`, no un aviso.** No hay escape ni hay que
> acordarse: el gate lo decide. **El gate de esta ficha es `./init.sh` COMPLETO**, y es criterio de
> «hecho» de la task **C1**.
>
> Se comprobó además, nombre a nombre, que **ningún** archivo del diff lleva nombre de dinero
> (`cierre`, `tarifa`, `pago`, `wallet`, `liquidacion`, `ingreso`, `egreso`, `caja`, `comision`,
> `flete`, `moneda`, `cobro`, `factura`, `premio`).

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
| Las cinco guardas de coste siguen igual **y en el mismo orden** (R33) | Los tests que ya existen **+ uno nuevo para el orden** | `optimizacion-ruta-service.test.ts`, `optimizacion-ruta-origen.test.ts`. ⏳ **AMPLIADO 2026-08-23 (m7):** «los tests que ya existen» cubrían la mitad «cortan igual» —cada guarda con su **0 llamadas**— pero **no la mitad «en el mismo orden»**, que descansaba en el comentario normativo de la cabecera del servicio, y un comentario no se pone rojo. Lo fija `describe("265/R33 — las guardas cortan EN ESTE ORDEN…")`: escenarios donde **dos** guardas cortarían a la vez, afirmando **cuál gana** por su `razon` y por lo que se ahorra (con el intervalo mínimo, `findParadasEnReparto` no llega a llamarse). |
| **La columna existe, es nullable y tiene `down.sql` (R35)** | Test estático de migración | Molde de `tests/integration/db/ruta-optimizada-migracion.test.ts`: lee el SQL por regex, sin levantar Postgres. |
| **El repo escribe y proyecta la procedencia (R35, R36)** | Integración de repositorio | `tests/integration/repositories/ruta-optimizada-repo.test.ts` **ya existe**: afirma los **argumentos** con los que el repositorio llama a Prisma (el `where`, y el `update` y el `create` del `upsert`) y que la escritura ocurre **dentro de la misma transacción**. ⏳ **CORREGIDO 2026-08-23 (m4):** aquí decía «es el único sitio donde el `WHERE` y el `UPDATE` **reales** se miran de verdad», y **eso es falso**: `tests/integration/repositories/**` **no levanta Postgres** —Prisma va mockeado, patrón de toda esa carpeta—, así que el SQL real **no lo ejecuta nadie ahí**. Un `WHERE` mutado que Prisma acepte pasa este test en verde. Quien sí mira el SQL: el **test estático de la migración** (por regex sobre el `.sql`), el `@map` de `db/schema.prisma` y **F6** contra el Postgres local. |
| **La procedencia viaja del cliente a la fila (R35, R36, R37)** | Unitario del servicio, con dobles | Se afirma el **argumento** con el que se llamó a `reemplazarSecuencia`, no el resultado. |
| **Degradar marca `local`; el proveedor marca `proveedor` (R35)** | Unitario del compuesto | Cubre el camino de la credencial ausente **y** el de `sin_solucion` con el mismo aserto. |
| **El aviso persistente aparece y desaparece según el dato (R38, R45)** | Componente | `tests/components/RepartoModule.test.tsx` **ya existe** y ya tiene el fixture `RUTA_VIGENTE`. |
| **El texto no lleva jerga ni PII (R40, R41, R42)** | Componente | Aserción sobre el **DOM renderizado** (`/degrad|fallback|haversine|proveedor|optimizador/i` no aparece), no sobre una constante: comparar un texto contra la función que lo genera siempre sale verde. |
| **Las tres señales conviven y siguen distintas (R43)** | Componente ×2 | Origen `centroide` + trazado `local` + orden `local` a la vez. ⏳ **CORREGIDO 2026-08-23 (m3):** aquí decía «los **tres textos** presentes» y en el DOM sólo hay **dos**: la tercera señal es una **línea punteada**, no una frase. Se prueba en dos sitios y por eso son dos tests: `RepartoModule.test.tsx` afirma los dos textos y que la geometría `local` llega a las props del mapa; `RutaMapaInner.test.tsx` afirma que **esas props se convierten en `dashArray`** y que con `fuente: "routes"` la línea sale **continua**. Sin el segundo, la señal se quedaba a medio camino y nadie la miraba. |
| **La falta de credencial también avisa (R44)** | Unitario del compuesto + componente | El compuesto marca `local`; el componente avisa igual. Sin nombrar la causa. |
| **El toast dice la verdad (R39)** | Unitario de la action + componente del botón | La action devuelve `secuenciaFuente`; el botón no dice «Ruta sincronizada.» a secas. |
| **El límite vive en un solo sitio y se declara sin calibrar (R46, R47)** | Guardia de prosa + barrido del árbol | §15. Con autocomprobación: un árbol simulado con el literal duplicado **tiene que** ponerla roja. |
| **Nada depende de la traza (R48)** | Toda la suite + un test explícito | `tests/setup/jest-dom.ts` ya pone `process.env.RUTA_DEBUG_LOG = "0"` para todos los tests (línea sin número a propósito: los números rotan). El explícito le pone nombre a la propiedad. |
| **Sin códigos de motivo, el motivo sigue completo (R49)** | Unitario del cliente | Fixture **sin** ningún código → el motivo nombra causa y conteos, y no contiene `undefined` ni un hueco. |

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
| M-s | Escribir siempre `"proveedor"` en la columna | test del servicio y del repo (R35) |
| M-t | No escribir la columna al reemplazar la secuencia (dejar la marca vieja) | test del repo: recalcular de local a proveedor **cambia** la marca (R36) |
| M-u | Escribir una procedencia en la rama trivial de 0/1 parada | test del servicio (R37) |
| M-v | Mostrar el aviso persistente siempre | test de componente con `secuenciaFuente: "proveedor"` y con `null` (R38, R45) |
| M-w | Mostrar el aviso sólo cuando falta la credencial | test del compuesto + componente (R44) |
| M-x | Fundir el aviso del orden con el del punto de partida | test de componente de las tres señales (R43) |
| M-y | Dejar el toast en «Ruta sincronizada.» con orden local | test de la action + del botón (R39) |
| M-z | Meter «fallback» / «Haversine» / una coordenada en el texto del aviso | test de componente sobre el DOM (R41, R42) |
| M-aa | Repetir el literal del umbral en otro módulo de `lib/` | guardia del límite (R46) |
| M-ab | Borrar la declaración de «no calibrado» del comentario del umbral | guardia del límite (R47) |
| M-ac | Hacer que el motivo o el aviso se emitan **sólo** por `optlog` | los tests, que corren con `RUTA_DEBUG_LOG=0` (R48) |
| M-ad | Imprimir `códigos: undefined` cuando la respuesta no trae ninguno | test del cliente sin códigos (R49) |
| **M-ae** | Mover el `optlog` de «informa saltos» **dentro de la rama de `sin_solucion`** (avisar sólo cuando ya es tarde) | test del cliente «R8: una respuesta UTILIZABLE … Y QUEDA ESCRITA» |
| **M-af** | Borrar el `dashArray` de la línea del mapa (`RutaMapaInner`) | `RutaMapaInner.test.tsx`: la tercera señal de R43 (2 de 3 rojos) |
| **M-ag** | Invertir la condición del `dashArray` (puntear lo que **sí** sigue calles) | `RutaMapaInner.test.tsx` (3 de 3 rojos) |
| **M-ah** | Poner la guarda del intervalo mínimo **por delante** de la de obsolescencia | `optimizacion-ruta-service.test.ts` «265/R33 … R20 antes que R34» |
| **M-ai** | Bajar la guarda del intervalo mínimo **por detrás** de la lectura de paradas | «265/R33 … R34 antes que R35», por el `SELECT` que deja de ahorrarse |
| **M-aj** | Que la guarda de 0/1 parada deje de cubrir el caso de **una** (decide R36) | «265/R33 … R35 antes que R36» |
| **M-ak** | Calcular la coherencia del origen sobre las paradas **sin recortar** | «265/R33 … el recorte R38 va ANTES de la guarda del origen» |

⏳ **`M-ae` la añade la revisión del 2026-08-22** (`progress/review_265.md`, bloqueante **B1**): la
tabla salió con **treinta** mutaciones y **ninguna para R8**, así que el arnés no tapaba ese hueco.
Medido por el reviewer y confirmado al aplicarla: el test que se llamaba de R8 afirmaba **sólo**
`status: ok`, y el único que afirmaba la línea de traza (el de **R1**) usa una respuesta
`sin_solucion` — o sea **no utilizable**—, así que **sobrevive** a esta mutación. Con eso, mover el
`optlog` dejaba la suite entera en verde.

⏳ **`M-af` a `M-ak` las añade el cierre de menores del 2026-08-23** (`review_265.md`, menores **m3**
y **m7**). Cubren las dos propiedades que estaban escritas en el diseño y en un comentario pero **no
en un test**: la tercera señal de R43 —el dibujo punteado, que sólo se afirmaba hasta las *props* del
mapa— y el **orden** de las guardas de coste que R33 exige y que ningún test fijaba. Las seis se
corrieron una a una con su salida pegada en `progress/impl_265_backend.md`. Nótese lo que miden
`M-ah` y `M-ai`: cada una mata **un solo** test de los 40 del archivo, o sea que **todos los demás
sobreviven a reordenar las guardas** — que es exactamente el agujero que m7 describía. Son
**treinta y siete**.

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

### Alternativas descartadas de la puerta humana (§13-§16)

**A12 · Decirle al mensajero que su orden es local SÓLO en el toast, sin columna.** Es la opción
barata: no toca la base, no toca `db/`, y el diff se queda dentro del servicio y de la action.
**Descartada, y la medición es la que la descarta:** el orden lo calcula también el **cron**
(`optimizacion-ruta-handler.ts:33-53`, que no devuelve nada a nadie) y la pantalla es
**server-driven, sin SWR** (`RepartoModule.tsx:89`, `ruta-mensajero.ts:8-12`). Un aviso que sólo vive
en la respuesta del botón: (a) **no existe** cuando el orden lo calculó el cron —que es el camino
normal, el del debounce tras recoger—; (b) **muere en el primer `F5`**, igual que le pasa hoy al
trazado, declarado «ES EFÍMERO» en `lib/types/ruta-mensajero.ts:50-52`. Sería cerrar P3 sólo para el
mensajero que además pulsa el botón, que es la mitad más pequeña del problema.

**A13 · Reutilizar `ruta_optimizada.ultimo_error` para marcar el orden local.** Tentador: la columna
ya existe, es `TEXT` nullable, y `reemplazarSecuencia` la limpia sola (`RutaOptimizadaRepository.ts:
143-145`). **Descartada:** un orden local **no es un error** —es un desenlace correcto, y toda la §5
se apoya en esa distinción—, y esa columna alimenta el aviso de ruta desactualizada. Meter ahí un
no-error haría que la pantalla dijese que la ruta falló cuando no falló, y dejaría dos significados
en una columna que hoy tiene uno. El precio de la columna nueva es una migración aditiva; el de esta
es un campo ambiguo para siempre.

**A14 · Deducir la procedencia al leer, sin persistir nada.** **Descartada porque no se puede:** una
secuencia persistida es una lista de `ordenId` con su posición, idéntica venga de Google o de
Haversine. No hay nada en la fila —ni en las paradas— de lo que inferirlo. Se comprobó campo a campo
en `RutaOptimizadaDTO` (`IRutaOptimizadaRepository.ts:12-43`).

**A15 · Un solo aviso que diga «esta ruta es aproximada» y sirva para las tres señales.** Es más
corto y **es más falso** (§14.4): «punto de partida aproximado», «dibujo no navegable» y «orden
aproximado» son tres hechos independientes que se dan por separado a diario. Fundirlos convierte tres
avisos accionables en uno que no dice qué revisar.

**A16 · Marcar el orden local como `desactualizada` para que la UI lo avise sin columna nueva.**
**Descartada por la misma medición que A4**: la guarda de «mismo conjunto y mismo origen» exige
`estado === "vigente"` (`OptimizacionRutaService.ts:245`), así que marcarlo `desactualizada` volvería
a disparar la llamada facturada en cada ciclo — justo la sangría que esta ficha viene a cortar. Y
además mentiría: el orden **no** está desactualizado, es aproximado. Dos cosas distintas.

**A17 · Aprovechar que se toca la config para calibrar `RUTA_ORIGEN_MAX_KM` con una estimación.**
**Descartada por la regla 6:** M1 **no se pudo medir** (`ruta_optimizada_parada` vacía, 0 órdenes en
`en_reparto`) y el caso de ≈1.040 km resultó ser **una prueba del propio humano**. Un número
«estimado» con esos dos datos delante sería un número inventado con aspecto de medido, que es peor
que uno declarado provisional. Se declara sin calibrar y se vigila con una guardia (§15.2).

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
| Los jobs ya en `failed` no se recuperan solos | **M2** lo midió (6, todos del mismo día) y **P6** lo cerró: **no se re-encola nada** (§16.5). |
| La migración se aplica en un entorno y en otro no, y el código lee una columna que no existe | La lectura es `secuenciaFuente ?? null` en todos los saltos, así que el peor caso sería un fallo de Prisma, no un dato mal interpretado. Se verifica con `prisma migrate status` **antes** de desplegar, y el despliegue de Vercel migra en el build. |
| El aviso nuevo se vuelve ruido: aparece siempre porque el proveedor falla a menudo | Es información honesta, no ruido — y si aparece siempre, **el problema es que la ruta siempre es local**, que es justo lo que se quiere ver. La cuenta se puede sacar con un `SELECT` sobre `secuencia_fuente` (§16.3). |
| El texto del aviso se «mejora» luego y se cuela jerga o una guía | El test afirma sobre el **DOM renderizado**, no sobre una constante: un cambio de copy que meta jerga o PII se pone rojo (§10.2). |
| Con la traza apagada, un fallo nuevo del proveedor se diagnostica a ciegas | Asumido y declarado (§16.2). Lo que queda: el motivo en `ultimo_error`, la columna de §13 y los estados de la cola. Si hace falta volver a mirar, se vuelve a encender **por entorno** y se apaga al terminar. |
| Los 5 fixtures `RutaResumenDTO` de los tests de componente dejan de compilar al añadir el campo | **Es el objetivo**: el campo es requerido para que nadie lo omita. `pnpm typecheck` los señala uno a uno (`RepartoModule`, `RepartoAyuda`, `RepartoAyudaResueltaPorLaTienda`, `MarcarLuegoToggle`, `GestionarOrdenPanelHilo`). |
