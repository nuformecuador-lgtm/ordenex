# Feature 265 — El optimizador de ruta lee lo que el proveedor le dice

> **Google respondió con precisión que no podía servir seis paradas, y el código lo tradujo a
> «respuesta del proveedor con forma inesperada». Desde ahí: error duro, el mensajero sin ruta, el
> job reintentando en bucle y una llamada facturada por minuto que no puede salir bien.**
>
> Medido contra producción el **2026-08-22** (logs de runtime de Vercel): el cron
> `/api/cron/procesar-jobs` falla en bucle desde el **2026-08-21 19:50** — **72 eventos, 24
> usuarios**. Antes de esa hora el error era otro (`RutaNoConfiguradoError`, faltaba
> `GOOGLE_ROUTE_OPT_PROJECT_ID`) y **ése sí degradaba bien**: «se usa el local». Cuando hacia las
> 19:40 alguien puso la credencial, el proveedor pasó a ser alcanzable de verdad y empezó el fallo
> actual. Es decir: **el defecto llevaba escrito desde el principio y sólo se ha visto ahora**, la
> primera vez que se habló con el proveedor real.
>
> Fuentes leídas para escribir esto (ninguna heredada de un informe):
> `lib/clients/google-route-optimization.ts`, `lib/clients/fallback-route-optimization.ts`,
> `lib/clients/haversine-route-optimization.ts`, `lib/services/OptimizacionRutaService.ts`,
> `lib/services/jobs/optimizacion-ruta-handler.ts`, `lib/config/route-optimization.ts`,
> `lib/interfaces/external/IRouteOptimizationClient.ts`,
> `lib/interfaces/repositories/IRutaOptimizadaRepository.ts`, `lib/logging/optimizer-log.ts`,
> `lib/actions/ruta-mensajero.ts`, `lib/types/ruta-mensajero.ts`, `lib/geo/polilinea.ts`,
> `lib/geo/direccion-query.ts`, `lib/services/GeocodificacionService.ts`,
> `lib/repositories/OrdenGeocodeRepository.ts`, `lib/repositories/OrdenRepository.ts`,
> `lib/services/AsignabilidadCoordenadasService.ts`, `db/schema.prisma`,
> `tests/unit/clients/google-route-optimization.test.ts`,
> `specs/92-optimizacion-ruta-mensajero/**`, `specs/261-dia-reparto-protege/**`.

---

## Vocabulario

| Término | Qué significa aquí |
| --- | --- |
| **el proveedor** | Google Cloud Route Optimization (`routeoptimization.googleapis.com`, método `optimizeTours`). El SEGUNDO cliente HTTP saliente del repo y el único que se factura por optimización. |
| **parada** | Una orden en `en_reparto` de ese mensajero **con coordenadas**. Las que no las tienen ya se excluyen antes (92/R37) y no llegan al proveedor. |
| **origen** | Punto de partida del vehículo. Se resuelve en tres escalones (92/R24): `gps` vigente → `ultima_conocida` → `centroide` de las paradas. La fuente se persiste y se muestra. |
| **saltar una parada** | Que el proveedor devuelva la parada en `skippedShipments` en vez de como visita de una ruta. Es una respuesta **válida** del proveedor, no un fallo suyo. |
| **degradar** | Ordenar con el cálculo local y gratis (`HaversineRouteOptimizationClient`, vecino más cercano sobre distancia de círculo máximo) en vez de con el proveedor. |
| **la traza** | `lib/logging/optimizer-log.ts`, prefijo `optimizer***:`. Es un **override consciente de la regla de PII**, pedido por el humano para diagnosticar, y se apaga con `RUTA_DEBUG_LOG=0`. |
| **el motivo** | El texto que viaja en `OptimizarOutcome.detalle` / en el mensaje del error / en `ruta_optimizada.ultimo_error`. Está sujeto a la regla de la casa: cita **campos y conteos**, nunca valores. |

---

## La evidencia, y qué hace el código con ella

### 1 · Lo que el proveedor contestó (traza `client/google — respuesta cruda del proveedor`)

```
json: {
  routes: [ {} ],
  skippedShipments: [ [Object], [Object], [Object], [Object], [Object], [Object] ],
  validationErrors: [ [Object] ],
  metrics: { skippedMandatoryShipmentCount: 6 }
}
```

Las **seis** paradas saltadas, con un error de validación adjunto y un contador explícito. El
proveedor está explicando el problema con precisión.

### 2 · Lo que se le había enviado (traza `client/google — ENTRADA`)

```
origen:  { lat: 6.3422343, lng: -75.514335, fuente: 'gps' }
paradas: i=0 → 9.9029459, -83.6815776
         i=1..5 → 9.9747225, -84.2068436   (las cinco, idénticas)
totalParadas: 6 · conCoordenadas: 6 · sinCoordenadas: 0
```

El origen está en **Medellín, Colombia**; las paradas, en **Costa Rica**. Aplicando
`distanciaHaversineKm` (`lib/geo/polilinea.ts`, la única definición del repo) a esas cifras salen
**≈1.040 km** de origen a parada.

> ⚠️ **Ese número está calculado a mano sobre las coordenadas del log; el reporte original decía
> «unos 1.400 km».** La diferencia no mueve ninguna decisión de esta ficha —los dos están dos
> órdenes de magnitud por encima de cualquier reparto de un día— pero **no se da por bueno**: la
> task **B0.2** lo recalcula ejecutando la función del repo y pega el resultado. Aquí no se afirma
> un número medido a ojo como si estuviera medido.

Y el dato que sí sirve de **cota inferior legítima**: las dos coordenadas de parada distintas
(`9.9029, -83.6816` y `9.9747, -84.2068`) distan entre sí **≈58 km**, dentro del mismo país y del
mismo día de reparto. Cualquier criterio de «el origen no cuadra» tiene que dejar pasar eso.

### 3 · Dónde muere la respuesta (medido, línea a línea)

| # | Dónde | Qué pasa |
| --- | --- | --- |
| 1 | `google-route-optimization.ts:71-73` | `respuestaSchema` parsea **sólo `routes`**. `skippedShipments`, `validationErrors` y `metrics` **no aparecen ni una vez en todo el repo** (`grep` = **0** ocurrencias, verificado). Zod hace *strip*: se tiran. |
| 2 | `google-route-optimization.ts:233-263` | `traducirSecuencia` recorre `routes[0].visits` (aquí: **cero visitas**) y remata en `if (secuencia.length !== paradas.length) throw new RutaRespuestaInvalidaError("la secuencia no cubre todas las paradas")`. |
| 3 | `fallback-route-optimization.ts:55-57` | El compuesto sólo degrada ante `RutaNoConfiguradoError`. Lo demás se re-lanza con el log `fallback — fallo REAL del proveedor; NO se cae a Haversine`. **No degrada.** |
| 4 | `OptimizacionRutaService.ts:265` | La excepción atraviesa el servicio **sin pasar por** `marcarDesactualizada` ni por `RutaIntentoFallidoError`: esos dos sólo cubren los desenlaces `transitorio`/`config_invalida`, no una excepción del cliente. |
| 5 | `ruta-mensajero.ts:100-106` y `:58` | El `catch` de la Server Action sólo conoce `RutaIntentoFallidoError`. Lo demás cae en `withErrorHandler` → `INTERNAL` → `throw new Error("ruta-mensajero: AppErrorCode inesperado INTERNAL")`. **Medido en producción: 6 veces sobre 2 usuarios en `/mis-asignaciones/reparto`.** |
| 6 | `optimizacion-ruta-handler.ts:47-51` | El job re-lanza; la cola aplica backoff y reintenta indefinidamente hasta agotar intentos. |
| 7 | `OptimizacionRutaService.ts:262` | Antes de todo eso: `service — ninguna guarda cortó: se LLAMA al proveedor (esto se factura) { paradas: 6 }`. **Se está pagando, cada minuto, por llamadas que no pueden salir bien.** |

### 4 · El razonamiento que ESTÁ BIEN y esta ficha no tumba

`traducirSecuencia` explica por qué lanza en vez de devolver una secuencia corta:

> «Persistir una secuencia parcial sería peor que no optimizar: borraría el último orden bueno y
> dejaría paradas fuera de la ruta sin que nadie se entere.»

**Eso sigue siendo verdad y esta ficha lo respeta entero.** Lo que ha caducado es la frase de la
línea 258-259:

> «El modelo enviado no lleva capacidades ni ventanas horarias: el proveedor no tiene motivo para
> saltarse paradas.»

Sí lo tiene, y el 2026-08-21 lo tuvo. Esa premisa **se anexa fechada, no se pisa** (sección **E**).

---

## A · Leer lo que el proveedor dice

**R1.** CUANDO el proveedor responda 2xx, el sistema DEBE leer de la respuesta, además de `routes`,
los campos `skippedShipments`, `validationErrors` y `metrics.skippedMandatoryShipmentCount`.

**R2.** SI alguno de esos tres campos está **ausente** de la respuesta, ENTONCES el sistema DEBE
seguir procesándola con normalidad y NO DEBE tratar la ausencia como una forma inválida.

**R3.** El sistema NO DEBE hacer depender de la forma **interna** de `skippedShipments` la decisión
de degradar: esa decisión se toma sobre la **cobertura de la secuencia** (§B), de modo que un campo
con una forma que el contrato no reconozca no pueda dejar al mensajero sin ruta.

**R4.** CUANDO el proveedor no sirva todas las paradas enviadas, el motivo que el sistema registre y
propague DEBE nombrar esa causa —**paradas saltadas por el proveedor**— y NO DEBE decir «forma
inesperada».

**R5.** Ese motivo DEBE incluir **cuántas** paradas se saltaron y **cuántas** se enviaron.

**R6.** Ese motivo NO DEBE contener coordenadas, ni `ordenId`, ni índices de parada, ni texto libre
devuelto por el proveedor.

**R7.** DONDE la respuesta traiga códigos de motivo del salto en un campo que el contrato reconozca,
el sistema DEBE incluir esos **códigos** (no sus valores acompañantes) en el motivo registrado.
> ⚠️ Este requisito depende de **P1**: hoy no se conoce la forma interna real de `skippedShipments`
> —el log la truncó a `[Object]`— y **no se inventa**. Se confirma en la task **B0.1** contra la
> respuesta cruda de producción; si la forma no trae códigos, R7 se retira con esa medición escrita
> al lado, no se cumple a medias.

**R8.** CUANDO el proveedor sirva todas las paradas pero informe igualmente errores de validación o
paradas saltadas, el sistema DEBE dejarlo escrito en la traza de diagnóstico aunque la respuesta sea
utilizable.

---

## B · Degradar cuando toca

**R9.** SI el proveedor responde 2xx con una forma válida pero la secuencia devuelta **no cubre todas
las paradas enviadas**, ENTONCES el sistema DEBE ordenar esas paradas con el **cálculo local**
(Haversine) y NO DEBE propagar un error.

**R10.** MIENTRAS se aplique esa degradación, el sistema NO DEBE persistir una secuencia parcial: la
secuencia persistida DEBE cubrir **todas** las paradas enviadas.

**R11.** El sistema DEBE aplicar esa degradación **tanto si el proveedor no sirvió ninguna parada
como si sirvió algunas**: el criterio es «la secuencia no las cubre todas», no «no cubre ninguna».

**R12.** CUANDO el sistema degrade por esa causa, DEBE emitir un aviso **agregado** para el operador
que diga que se está ordenando en local y **por qué**, sin coordenadas ni identificadores.

**R13.** CUANDO el sistema degrade por esa causa, el job encolado DEBE terminar **completado**: sin
reintento, sin backoff y sin dead-letter.

**R14.** La degradación NO DEBE alcanzar a los desenlaces `transitorio` ni `config_invalida`, ni a
una respuesta que **no cumpla el contrato de forma**: esos tres siguen conservando intacto el último
orden válido, marcando la ruta desactualizada y propagándose.

**R15.** La degradación NO DEBE alterar la secuencia previamente persistida hasta que haya una
secuencia nueva **completa** que escribir.

---

## C · Cortar antes de llamar cuando el origen no guarda relación con las paradas

**R16.** ANTES de llamar al proveedor, el sistema DEBE comprobar que el origen resuelto guarda
relación geográfica con el conjunto de paradas, medida como la **distancia de círculo máximo entre
el origen y el centroide de las paradas**.

**R17.** SI esa distancia supera el límite configurado, ENTONCES el sistema DEBE **descartar ese
origen** y usar en su lugar el **centroide de las paradas**, marcando la fuente `centroide`.

**R18.** El sistema DEBE aplicar esa comprobación cualquiera que sea la procedencia del origen
(`gps` vigente o `ultima_conocida`), y NO DEBE aplicarla cuando el origen ya sea el centroide.

**R19.** CUANDO el sistema descarte un origen por esa razón, DEBE emitir un aviso **agregado** con la
distancia redondeada y el número de paradas, y NO DEBE emitir coordenadas en ese aviso.

**R20.** El sistema DEBE calcular la huella de la guarda de «mismo conjunto y mismo origen» con el
origen **final**, el que efectivamente se envía al proveedor.

**R21.** El límite DEBE ser configurable por variable de entorno; una variable ausente, vacía o
inválida DEBE caer al valor por defecto **sin lanzar**.

**R22.** La comprobación NO DEBE producir ninguna llamada facturada adicional ni ninguna lectura
adicional de la base de datos.

**R23.** SI tras descartar el origen sigue habiendo al menos dos paradas con coordenadas, ENTONCES la
optimización DEBE continuar: descartar un origen malo NO DEBE cancelar el trabajo.

---

## D · El fallo del proveedor deja de llegar crudo a la pantalla

**R24.** CUANDO el cliente del proveedor lance una excepción durante una optimización, el sistema
DEBE conservar intacto el último orden válido, DEBE marcar la ruta desactualizada y DEBE propagar un
**fallo tipado único**, el mismo que ya producen los desenlaces `transitorio` y `config_invalida`.

**R25.** CUANDO la sincronización manual del mensajero termine en fallo del proveedor —de la forma
que sea—, la pantalla DEBE recibir un resultado de **dominio** accionable y el borde NO DEBE lanzar
una excepción no tipada al cliente.

**R26.** El fallo tipado DEBE seguir llegando a la cola como excepción, para que el backoff y el
dead-letter sigan viendo lo que hoy ven.

---

## E · La premisa caducada queda anotada, no borrada

**R27.** El sistema DEBE conservar **verbatim** el razonamiento que hoy explica por qué no se
persiste una secuencia parcial («borraría el último orden bueno y dejaría paradas fuera de la ruta
sin que nadie se entere»).

**R28.** El sistema DEBE **anexar** —sin reescribir el texto original— una nota fechada que declare
**caducada** la premisa «el proveedor no tiene motivo para saltarse paradas», con el motivo medido
(la respuesta del 2026-08-21 con `skippedMandatoryShipmentCount = 6`) y el puntero a esta ficha.

**R29.** El sistema DEBE tener una comprobación automática que se ponga **roja** si (a) desaparece o
se reescribe el texto original de R27, (b) falta la nota anexada, su fecha o su puntero, o (c)
reaparece en el árbol del optimizador una frase que afirme que el proveedor no puede saltarse
paradas.

---

## F · Lo que NO cambia (requisitos de no-regresión)

**R30.** El sistema DEBE seguir degradando al cálculo local cuando **falte la credencial**, con su
motivo actual y su aviso actual.

**R31.** El sistema DEBE seguir sin enviar `ordenId` al proveedor.

**R32.** El sistema DEBE seguir sin emitir el token, la URL, la clave privada ni coordenadas en
ningún **mensaje de error**.

**R33.** Las cinco guardas de coste existentes (job obsoleto, intervalo mínimo, 0 ó 1 parada, tope de
paradas y mismo conjunto+origen) DEBEN seguir cortando exactamente igual y en el mismo orden.

**R34.** Esta feature NO DEBE requerir migración de esquema, columna nueva ni relleno de datos.

---

## Límites declarados (no son controles, son honestidad)

1. **Una ruta degradada no se distingue de una optimizada para el mensajero.** El `fuente` que la UI
   muestra es el del **origen**, no el del **orden**. Hoy la degradación por credencial ausente ya se
   comporta así (`FallbackRouteOptimizationClient` persiste el orden Haversine como cualquier otro) y
   esta ficha **no cambia esa asimetría**: hacerlo es superficie de UI y contrato nuevo. Queda como
   **P3**.
2. **Tras degradar, la huella congela el orden local hasta que cambie el conjunto o el origen.** Es
   **deliberado** y es lo que corta la sangría de facturación (§3 de la evidencia): la guarda de
   «sin cambios» exige `estado === "vigente"`, así que persistir la degradación como vigente es
   justo lo que impide volver a pagar por el mismo modelo imposible. El precio: si la causa
   desaparece sola, la ruta sigue siendo local hasta el siguiente cambio de conjunto o de posición
   —y la posición del mensajero cambia constantemente, así que en la práctica se cura sola—. **No es
   el mismo caso que el trazado**, que a propósito NO se cachea cuando es local: allí congelar
   dibujaría líneas rectas que parecen calles; aquí el orden es aproximado pero **completo**.
3. **Esta ficha no arregla las coordenadas repetidas.** Ver «Hallazgos fuera de alcance».
4. **La guarda del origen no valida las paradas entre sí.** Sólo el origen. Motivo medido: las
   paradas salen todas del mismo geocodificador con el país **fijo** en la consulta
   (`direccion-query.ts`, `const PAIS = "Costa Rica"`), mientras que el origen viene del GPS del
   navegador y es la única entrada sin cota. Inventar un segundo criterio «paradas contra paradas»
   sin ningún caso medido sería exactamente lo que la regla 6 de `CLAUDE.md` prohíbe.

---

## Mediciones que faltan (se toman contra producción, **sólo lectura**)

| # | Qué mide | Qué decide |
| --- | --- | --- |
| **M1** | Distribución de `distanciaHaversineKm(origen, centroide(paradas))` sobre las optimizaciones reales: origen persistido en `ruta_optimizada` vs. centroide de las paradas en `en_reparto` de ese mensajero, para todos los mensajeros con ruta. | **El umbral de R21.** El valor por defecto se fija por encima del máximo legítimo observado. Sin M1 el número es 🧭 propuesto (ver **P2**). |
| **M2** | Cuántas rutas hay hoy en `estado = 'desactualizada'` con `ultimo_error` de esta familia, y cuántos jobs `optimizacion_ruta` hay en `failed`. | El tamaño del destrozo que este arreglo limpia, y si hace falta re-encolar algo tras desplegar. |
| **M3** | Cuántos mensajeros tienen origen persistido con `fuente = 'gps'` a más de M1-p100 del centroide de sus paradas. | Si el origen de Medellín fue **uno** o es un patrón. Decide si además hace falta abrir ficha para la captura de ubicación. |

⏳ **Caducan.** Son fotos: se re-miden justo antes de desplegar. Sus resultados se pegan en
`progress/impl_265_*.md`, con la consulta al lado.

### ✅ Tomadas el 2026-08-22 por el leader (producción, sólo lectura)

| # | Resultado |
| --- | --- |
| **M1** | **NO SE PUDO MEDIR.** `ruta_optimizada_parada` está **vacía** (0 filas) y hay **0 órdenes en `en_reparto`**: sin paradas no hay centroide contra el que medir el origen. Por eso el umbral de **P2** se fija declarado y no derivado. |
| **M2** | **6** jobs `optimizacion_ruta` en `failed` de esta familia —«respuesta del proveedor con forma inesperada (la secuencia no cubre todas las paradas)»—, todos de **hoy**, entre las 04:07 y las 05:26. **0** rutas en `desactualizada` y **0** con `ultimo_error`. |
| **M3** | De **2** rutas con origen persistido, **1 está en Medellín** (6,3 / −75,5) con `origen_at` de hoy 22:56, y la otra en Costa Rica (9,9 / −84,1). El humano confirmó que la primera **es una prueba suya**. |

⚠️ **DOS TRAMPAS DE MEDICIÓN, escritas para que no vuelvan a morder:**

1. **M3, tal como este spec la define, no habría visto nada.** Filtra por `origen_fuente = 'gps'` y
   **las dos rutas son `ultima_conocida`**. Habría devuelto 0 y concluido «no hay patrón».
2. **Un primer intento de M1 devolvió «20.015,1 km» y era basura.** `LEAST`/`GREATEST` en Postgres
   **ignoran los NULL**, así que con centroide nulo `greatest(-1, NULL)` da `-1`, `acos(-1)` da π y
   sale la antípoda: un número plausible que no mide nada y que habría fijado el umbral de R21
   sobre un fantasma. Cualquier haversine en SQL sobre columnas nullable tiene esta mina.

---

## Hallazgos fuera de alcance (para que se abran sus propias fichas)

### H1 · ⚠️ Cinco de las seis paradas comparten coordenada exacta — **es un defecto distinto, y está confirmado**

**Lo investigado, con lo que se leyó:**

1. **No existe ningún valor por defecto.** El **único** escritor de `orden.latitud`/`orden.longitud`
   en todo el repo es `OrdenGeocodeRepository.guardarResultado` (`:38-51`), alimentado sólo por
   `GeocodificacionService`. En los cuatro desenlaces sin resultado (`SIN_DIRECCION`,
   `ZERO_RESULTS`, `INVALID_REQUEST`, y el transitorio que no escribe nada) las columnas quedan
   **`NULL`**, nunca en un centroide de relleno. Descartada la hipótesis de «coordenada de relleno».
2. **La coincidencia exacta se explica por la cache, por diseño.** `hashDireccion` indexa la cache
   por la consulta normalizada `direccion, distrito, cantón, provincia, Costa Rica`
   (`direccion-query.ts:43-70`). Dos órdenes con el mismo texto de dirección **comparten
   necesariamente** la misma coordenada, hasta el último decimal. Eso puede ser legítimo (cinco
   entregas al mismo edificio) o puede ser una dirección genérica repetida.
3. **Y aquí está el defecto real: nadie decidió nunca el umbral de calidad.**
   `GeocodificacionService.ts:124` dice, con todas sus letras: *«se guarda SIEMPRE la precisión
   reportada, incluida APPROXIMATE (Q8); **el umbral de calidad lo decidirá el primer
   consumidor**»*. Medido: `orden.geocode_precision` se **escribe** (`OrdenGeocodeRepository:46`) y
   **no lo lee ni un solo consumidor** en `lib/` — ni `AsignabilidadCoordenadasService` (que da por
   `asignable` cualquier orden con coordenadas presentes, `:62-64`), ni `findParadasEnReparto` (que
   sólo proyecta `id, latitud, longitud, createdAt`, `OrdenRepository:1613`). **El primer consumidor
   llegó y no decidió nada.** Una coordenada `APPROXIMATE` —el centroide de un distrito— entra en la
   ruta indistinguible de una `ROOFTOP`.

**Por qué no entra en esta ficha:** el alcance aprobado por el humano son los tres puntos de abajo, y
esto no es «leer lo que el proveedor de rutas dice» sino «decidir qué calidad de geocodificación
merece entrar en una ruta». Toca otro servicio, otro proveedor y otro contrato.

**Lo que la ficha nueva tendría que medir primero:** cuántas órdenes en `en_reparto` tienen
`geocode_precision` distinta de `ROOFTOP`, y cuántos grupos de coordenada exactamente repetida hay
entre paradas de un mismo mensajero. Con eso se sabe si es marginal o si es la mitad del reparto.

### H2 · ⚠️ El token OAuth2 se imprime en claro en el log

`google-route-optimization.ts:154`: `console.log('optimizer***: token', token, url)`. Está **dos
líneas debajo** del `optlog` que usa `describirToken(token)` justo para no revelarlo, y contradice
frontalmente la cabecera del propio módulo de traza («LO QUE NO SE IMPRIME, NI CON LA TRAZA
ENCENDIDA: el `access_token` …»). Un token en un log es una credencial reutilizable por quien lo lea.

**No entra aquí, y probablemente ya está en marcha:** en los refs locales hay
`hotfix/token-en-logs-optimizer` y `fix/token-en-logs-optimizer-dev`. **Se verifica contra
`origin/dev` antes de tocar el archivo** (task B0.3): si en `dev` la línea ya no está, esto es ruido
de un árbol viejo; si sigue estando, es un hotfix, no una ficha.

---

## Preguntas abiertas

> ## ✅ PUERTA HUMANA PASADA — 2026-08-22
>
> Las respuestas del humano y las mediciones que las acompañan. **Las preguntas de abajo se
> conservan tal cual**: son el razonamiento con el que se decidió, no ruido a borrar.
>
> **P1 y P5 — SIGUEN ABIERTAS, y ahora con un bloqueo nuevo.** No se pudo obtener la respuesta
> cruda: la consulta de logs de Vercel expira aunque se acote a un deployment y a 90 minutos. Y la
> decisión de **apagar `RUTA_DEBUG_LOG` ya** (P4) retira la traza que era la única vía a esa
> respuesta. **Consecuencia asumida:** el schema se queda **defensivo** (todo opcional,
> `design.md` §3) y no se verá la forma real antes de implementar. Es admisible porque **R3** ya
> dice que la decisión de degradar NO depende de esa forma — pero **R7** (citar códigos de motivo)
> se queda sin insumo y debe implementarse tolerando que no haya ninguno.
>
> **P2 — CERRADA: `RUTA_ORIGEN_MAX_KM = 200`, declarado SIN base documental**, igual que la 92 hizo
> con `RUTA_MAX_PARADAS = 100`. Se escribe el número, se declara que no tiene base y se revisa con
> datos reales.
>
> ⚠️ **TENSIÓN QUE HAY QUE DECIR, no disimular.** El humano también respondió (ver M3) que el
> origen de Medellín **es una prueba suya**. O sea: el caso de ≈1.040 km que motiva R21 es un
> **artefacto de pruebas**, no una incoherencia de la operación real. R21 se implementa igual —deja
> de pagar una llamada condenada y le da al mensajero un orden local en vez de un error duro— pero
> su umbral **no está calibrado sobre datos de producción**, y su urgencia es menor de lo que este
> spec suponía cuando se escribió. Que nadie lea después los 1.040 km como evidencia de campo.
>
> **P3 — CERRADA: SÍ, entra.** El mensajero debe saber que su ruta se ordenó en local. Esto mete
> **UI** en una ficha que nació de backend: la `zone` de la 265 pasa de `backend` a `fullstack` y el
> límite declarado 1 deja de aplicar.
>
> **P4 — CERRADA: apagar `RUTA_DEBUG_LOG` YA**, antes de verificar el arreglo desplegado y en
> contra de la recomendación de este spec. Es decisión del humano, que es quien lo encendió. Ver
> arriba el coste: se lleva por delante P1.
>
> **P6 — CERRADA por la medición: no hace falta re-encolar nada a mano.** Son **6** jobs, todos de
> hoy; el flujo normal (recoger, gestionar, sincronizar) los vuelve a encolar.


**P1 — ¿Qué campos trae de verdad `skippedShipments`, y qué trae `validationErrors`?** El log de
producción los truncó a `[Object]` y en el repo hay **cero** referencias a esos nombres, así que la
forma interna es **desconocida** y no se rellena con un supuesto. De la respuesta depende **R7** (si
hay códigos de motivo que citar) y parte de **P5**.
*Recomendación:* obtener la respuesta cruda completa de un caso real (task **B0.1**) antes de fijar
el schema; hasta entonces el contrato se escribe **defensivo** (todo opcional, ver `design.md` §3) y
la decisión de degradar **no depende** de esa forma (**R3**).

**P2 — ¿Cuál es el límite de R21?** El repo **no contiene** ningún dato del que derivarlo: no hay
coordenadas de zona ni de bodega en el esquema —verificado, y es la razón por la que el escalón 3 del
origen es el centroide y no la bodega—, ni un radio operativo escrito en ninguna parte.
*Lo que sí está medido y acota la respuesta:* dos paradas legítimas de la misma llamada distan
**≈58 km**; el origen incoherente estaba a **≈1.040 km**. El umbral tiene que estar cómodamente por
encima de lo primero y muy por debajo de lo segundo.
*Recomendación:* 🧭 **`RUTA_ORIGEN_MAX_KM = 200`** como valor de partida —más del triple de la
dispersión legítima observada, cinco veces menor que la incoherencia medida— **declarado sin base
documental**, exactamente como la 92 declaró `RUTA_MAX_PARADAS = 100` (su Q7: «propuse 100 sin base
documental… fijar y revisar con datos reales»). **M1 lo sustituye antes de desplegar**; si el máximo
legítimo que devuelva M1 se acerca a 200, el número cambia y se escribe por qué.

**P3 — ¿El mensajero debe SABER que su ruta se ordenó en local?** Hoy no lo sabe ni cuando falta la
credencial: la degradación es invisible en la UI. Esta ficha multiplica los casos en que ocurre.
*Recomendación:* no en esta ficha (es contrato + UI, y el límite declarado 1 lo deja escrito), pero
**decidirlo el humano**: si la respuesta es «sí», es una ficha pequeña y conviene abrirla ya, porque
un orden aproximado presentado como óptimo es la clase de mentira silenciosa que este repo persigue.

**P4 — ¿Se apaga ya `RUTA_DEBUG_LOG`?** El módulo de traza dice de sí mismo que es un **override
consciente de la regla de PII** «para diagnosticar un problema abierto», que imprime las coordenadas
de entrega de los destinatarios en el log de Vercel —«exportación de dato personal a un tercero fuera
de la base»— y que hay que **apagarlo cuando el diagnóstico termine**. Esta ficha cierra ese
diagnóstico.
*Recomendación:* apagarlo (`RUTA_DEBUG_LOG=0` en producción) **después** de verificar el arreglo con
la ficha desplegada, no antes. Es un cambio de variable de entorno, no de código, y lo decide el
humano porque el que lo encendió fue él.

**P5 — ¿El texto libre del proveedor puede contener coordenadas?** `validationErrors` podría traer
mensajes que citen el modelo enviado (que **es** una lista de coordenadas de entrega). **R6** ya
prohíbe reenviar texto libre del proveedor a nuestro motivo, pero la traza `respuesta cruda del
proveedor` lo imprime **entero** hoy.
*Recomendación:* si P1 confirma que hay texto libre, tratarlo como PII y no sacarlo del `optlog`
(que ya es el override consentido) — y entonces P4 deja de ser opcional.

**P6 — ¿Hay que re-encolar algo tras desplegar?** M2 dirá cuántos jobs quedaron en `failed` y cuántas
rutas en `desactualizada` por esta causa. Un job en dead-letter no se re-intenta solo.
*Recomendación:* decidirlo con el número de M2 delante; si son pocos, el propio flujo (recoger,
gestionar, sincronizar) los vuelve a encolar sin que nadie haga nada.

---

### Lo que este spec NO ha inventado

Todo lo marcado «medido» se leyó en el árbol o en el log de producción citado, y lo que no se pudo
leer está arriba como pregunta abierta (P1, P2, P5) o como número a recalcular (B0.2). Si al
implementar aparece un dato que no está en `docs/`, en `specs/` ni en el código, **se para y se
pregunta** (`CLAUDE.md`, regla 6).
