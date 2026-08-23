# Feature 267 — analítica de la propia tienda por API key

> Rama: `feature/267-analitica-api-key` (worktree `C:/w267`, desde `origin/dev` @ `b16c8c8e`).
> Zona: `backend` · SDD: sí · Complejidad: ALTA · Migración: **no**.

## Qué es esta ficha, en una frase

Publicar por el canal integrador (API key) la analítica **ya existente**, recortada a las órdenes
de esa tienda y con los mismos filtros de fecha que la 257. Para hacerlo hay que **revertir una
decisión de diseño firmada** (122/R11–D9: «`apiKey` denegado POR DISEÑO») y **modificar dos
guardias estructurales** que hoy prohíben cualquier superficie de analítica bajo `app/api`. No es
un hueco olvidado: son tres decisiones escritas que esta feature deroga a propósito y con fecha.

## Contexto normativo (verificado leyendo el código de `C:/w267` el 2026-08-22)

Todo lo de esta lista se comprobó abriendo el archivo; nada se re-investigó más allá.

- **El muro nº 1 — `ROLES_SIN_ANALITICA`.** `lib/analytics/alcance.ts:103` declara
  `ROLES_SIN_ANALITICA = ["apiKey"] as const` y su comentario (`:92-102`) dice literal: «denegada
  POR DISEÑO: si algún día se quiere reporting por API será ficha propia con su puerta». Esta es
  esa ficha. `resolverAlcance` la aplica en `:162-165`, ANTES de mirar la métrica.
- **El invariante de exhaustividad.** `tests/unit/analytics/alcance-fuente-unica.guardia.test.ts:132-147`
  exige tres cosas: (a) `ROLES_ANALITICA` no contiene `apiKey` y tiene 5 elementos;
  (b) `ROLES_ANALITICA ∪ ROLES_SIN_ANALITICA` == los 6 `RolValue`; (c) **ninguna métrica del
  catálogo declara alcance para `apiKey`**. Mover `apiKey` de lista pone (b) rojo, y eso es lo
  correcto.
- **El recorte por tienda encaja exacto.** `alcance.ts:207-211`: `adminTienda` →
  `{ tipo: "tienda", tiendaId: actor.usuarioId }`, porque «en este esquema el `adminTienda` ES la
  tienda» (`orden.tienda_id` es FK a `usuario`). El usuario dedicado de la API key es otro
  `usuario` distinto, con su propio id, y `orden.tienda_id` apunta a ÉL. Misma variante, otro
  sujeto: no comparten filas ni clave de caché con ningún `adminTienda`.
- **La clave de caché no se toca.** `lib/analytics/cache-clave.ts:85-96` — `switch` exhaustivo sin
  `default` sobre las CUATRO variantes de `AlcanceDatos`, vigilado por
  `cache-clave-alcance.guardia.test.ts`. Reusando `tipo: "tienda"` sigue siendo correcta.
- **El punto de entrada único.** `lib/analytics/consulta.ts:79-122` —
  `prepararConsultaAnalitica(raw, actor, metricaId, now)`: parsea → resuelve rango → resuelve
  alcance → **interseca** el filtro con el alcance, en ese orden y sin vías alternativas. Devuelve
  un tipo OPACO (`marcaConsulta`, `:40`) que no se puede fabricar desde fuera.
- **El filtro público de la analítica** (`lib/analytics/filters.ts:66-116`) es `.strict()`:
  `rango` (obligatorio, 4 presets), `desde`/`hasta` (`YYYY-MM-DD`, sólo con `personalizado`),
  `zona_id`, `tienda_id`, `mensajero_id`. Tope de ventana `RANGO_TOPE_DIAS = 366`
  (`types.ts:213`).
- **Identidad.** `lib/analytics/identidad.ts:39-49` — `politicaIdentidadMensajero` es un `switch`
  exhaustivo sobre los CINCO roles; `adminTienda` → `seudonima` porque «no es su empleador».
  `consulta.ts:181-184` tiene un fallback `return "real"` para el rol que no sea de analítica: hoy
  inalcanzable, mañana **peligroso** si `apiKey` llega hasta ahí.
- **El oráculo ya está cerrado.** `lib/actions/analitica-operativa.ts:132-134` +
  `lib/analytics/oraculo-mensajero.ts`: con política `seudonima`, un filtro que nombre
  `mensajero_id` es `forbidden` auditado.
- **`cobertura` es obligatoria** (`lib/types/analitica-operativa.ts:108-109`, R34 de la 126) y
  **nada de `BigInt`** (`:8-11`: `JSON.stringify` de un `BigInt` LANZA).
- **El muro nº 2 — dos guardias prohíben una superficie de analítica en `app/api`.**
  - `tests/unit/analytics/operativa-frontera.guardia.test.ts:45-58` — ningún archivo de `app/api`
    puede mencionar `AnaliticaOperativaService`, `AnaliticaOperativa*Repository` ni
    `consultarAnaliticaOperativa`.
  - `tests/unit/analytics/tablero-operativo-frontera.guardia.test.ts:194-200` — **ningún archivo
    bajo `app/api` cuya RUTA case con `/analitica/i`**. Un handler en
    `app/api/ordenes/api-key/analitica/route.ts` pone este guardia rojo por el solo hecho de
    llamarse así.
  La razón escrita en ambos es la misma: «las lecturas internas van por Server Action; los route
  handlers son para webhooks y **API pública**». Este canal ES API pública, así que la excepción
  cabe dentro del motivo declarado — pero se escribe como allowlist nominal, no se borra el
  guardia.
- **El OpenAPI está congelado en OCHO paths.** `tests/unit/api/openapi-177-paths-pdf-y-carga-id.test.ts:81-98`
  y `:228-238` (el objeto TS y el `.yaml` deben declarar los mismos 8, en el mismo orden). Publicar
  la analítica lo sube a **NUEVE**, en el mismo commit y en los dos artefactos.
- **`intentos` está prohibido en el OpenAPI serializado** (`tests/unit/types/intentos-no-alcance.test.ts:36-42`).
- **Middleware: nada que tocar.** `middleware.ts:32` — `SELF_AUTH_ROUTES` incluye
  `/api/ordenes/api-key` y `matches` compara por PREFIJO (`:47`), así que un subpath nuevo pasa sin
  darse de alta en `PUBLIC_ROUTES` y la guardia de la 229 sigue verde. Confirmado; no re-investigar.
- **Sin migración**: ninguna tabla, columna ni RLS.

---

## Requisitos

Notación EARS. Cada `R<n>` termina mapeado a un test en la tabla de trazabilidad de `design.md`.

### A · La reversión de la decisión firmada, y sus límites

**R1** — CUANDO un actor con rol `apiKey` consulta una métrica publicable por el canal de API key,
el sistema DEBE resolver su alcance como la variante `{ tipo: "tienda", tiendaId: <usuarioId del
actor> }` de `AlcanceDatos`.

**R2** — El sistema NO DEBE declarar una quinta variante de `AlcanceDatos`: las cuatro variantes
(`global`, `zona`, `tienda`, `mensajero`) y el `switch` exhaustivo de `claveDeAlcance` DEBEN quedar
tal cual.

**R3** — El sistema NO DEBE incluir `apiKey` en `ROLES_ANALITICA` ni en el tipo `RolAnalitica`.

**R4** — El sistema DEBE mantener el invariante de exhaustividad de roles: cada uno de los seis
`RolValue` del esquema DEBE pertenecer a **exactamente una** de las listas de política de analítica
declaradas en `lib/analytics/alcance.ts`, y esas listas DEBEN ser disjuntas dos a dos.

**R5** — El sistema DEBE conservar el mecanismo de denegación por rol (la constante exportada
`ROLES_SIN_ANALITICA`, su restricción de tipo y su uso en `resolverAlcance`) aunque su contenido
quede vacío: un `RolValue` futuro DEBE seguir teniendo dónde declararse denegado.

**R6** — MIENTRAS un actor con rol `apiKey` llegue por el canal de **sesión** (cookie), el sistema
DEBE denegarle la analítica: `consultarAnaliticaOperativa` y `consultarAgregadoOperativo` DEBEN
responder `forbidden`, sin datos y sin motivo.

**R7** — El sistema NO DEBE conceder al rol `apiKey` acceso al tablero de analítica:
`ROLES_ACCESO_ANALITICA` (`lib/auth/menu-visibility.ts:155`) DEBE seguir teniendo exactamente los
cuatro roles de hoy, el ítem de menú «Analítica» DEBE seguir sin `apiKey`, y la ruta
`app/(app)/analitica` DEBE seguir devolviendo `notFound()` para ese rol.

### B · Recorte multi-tenant y aislamiento

**R8** — El sistema DEBE devolver exclusivamente cifras derivadas de órdenes cuyo `tienda_id` sea
el `usuarioId` del actor autenticado por la key.

**R9** — El sistema NO DEBE leer de la petición ningún identificador de tienda, dueño, usuario,
zona ni mensajero: el sujeto del recorte sale SIEMPRE del actor autenticado.

**R10** — SI la petición trae un filtro que nombra una tienda distinta de la propia, ENTONCES el
sistema DEBE responder `403` y NO DEBE responder `200` con serie vacía.

**R11** — SI el actor autenticado no tiene un `usuarioId` útil (cadena no vacía), ENTONCES el
sistema DEBE denegar y NO DEBE consultar la base de datos.

**R12** — El sistema DEBE producir una clave de caché distinta para dos actores `apiKey` distintos
y para cualquier alcance distinto, sin modificar `claveDeConsulta` ni `claveDeAlcance`.

**R13** — El sistema NO DEBE introducir ninguna excepción nueva en
`alcance-obligatorio.guardia.test.ts`: toda lectura nueva DEBE viajar dentro del tipo opaco
`ConsultaAnalitica`, sin SQL crudo ni reconstrucción del filtro a mano.

**R14** — El sistema DEBE obtener cada consulta por una única llamada a
`prepararConsultaAnalitica(...)` —**una por métrica pedida y ninguna más** (P4-bis)— y NO DEBE
exponer ninguna función pública que devuelva un filtro parseado sin alcance.

### C · Qué métricas se publican (lista BLANCA)

**R15** — El sistema DEBE publicar por este canal únicamente las métricas declaradas en una lista
blanca explícita y única; una métrica ausente de esa lista NO se publica.

**R16** — CUANDO se pide una métrica que no está en la lista blanca, el sistema DEBE responder
`403` **con la misma respuesta byte a byte** que para una métrica que no existe en el catálogo: la
respuesta NO DEBE permitir distinguir «existe pero no es tuya» de «no existe». CUANDO se piden
varias y **alguna** no es publicable, el sistema DEBE denegar **el lote entero** con ese mismo
`403` y NO DEBE servir las demás: un éxito parcial diría por omisión qué ids están en la lista
blanca, y bastaría UNA petición para reconstruirla.

**R17** — El sistema NO DEBE admitir en la lista blanca ninguna métrica de `dominio: "financiera"`.

**R18** — El sistema NO DEBE admitir en la lista blanca ninguna métrica cuyo alcance para
`adminTienda` sea `"prohibido"`: el integrador nunca ve más de lo que ve la tienda dueña de sus
órdenes.

**R19** — El sistema NO DEBE admitir en la lista blanca ninguna métrica con
`estadoProduccion: "declarada"` (una métrica sin productor devolvería ceros que el integrador
leería como datos).

**R20** — CUANDO se añade una métrica nueva al catálogo, el sistema NO DEBE publicarla por este
canal mientras no se dé de alta explícitamente en la lista blanca.

**R21** — La lista blanca NO DEBE ser una segunda tabla de alcance por rol: DEBE contener
únicamente identificadores de métrica, y el alcance por rol DEBE seguir saliendo exclusivamente de
`lib/analytics/metrics.ts`.

### D · Contrato HTTP del canal

**R22** — El sistema DEBE exponer la analítica en un endpoint del canal por API key autenticado con
`Authorization: Bearer ordx_...`, resolviendo la autenticación **antes** de parsear la query.

**R23** — CUANDO la petición no trae key, o la key no corresponde a ninguna fila, el sistema DEBE
responder `401`; CUANDO la key existe pero su usuario dedicado no está activo, DEBE responder
`403`. Ambas respuestas DEBEN preceder a cualquier `422` de validación.

**R24** — El sistema DEBE aceptar la ventana temporal como `desde` y `hasta`, fechas calendario de
Costa Rica en formato `YYYY-MM-DD`, con `hasta` **inclusivo**: exactamente los mismos nombres,
formato y semántica que publicó la 257 en `GET /api/ordenes/api-key`.

**R25** — SI `desde` es posterior a `hasta`, ENTONCES el sistema DEBE responder `422` con el error
bajo `fieldErrors.hasta` y NO DEBE responder `200` con serie vacía.

**R26** — SI la ventana pedida supera `RANGO_TOPE_DIAS` días contando ambos extremos, ENTONCES el
sistema DEBE responder `422`.

**R27** — El sistema DEBE leer la query **clave por clave** y NO DEBE admitir como entrada del
schema ninguna clave que no esté declarada; una clave desconocida no puede alterar el resultado.

**R28** — CUANDO la consulta es válida y concedida, el sistema DEBE responder `200` con un objeto
que declare el rango efectivo (`desde`/`hasta` como `YYYY-MM-DD` CR) y un array `metricas`, y cada
entrada de ese array DEBE declarar, como mínimo: el id de la métrica, su unidad, su unidad de
conteo, la serie de puntos y el bloque `cobertura`.

**R29** — El bloque `cobertura` DEBE ser OBLIGATORIO en toda respuesta `200`: «cero» y «no se sabe»
no pueden ser el mismo número para el integrador.

**R30** — Todo valor numérico de la respuesta DEBE ser `number | null` y todo instante DEBE ser una
cadena ISO: el sistema NO DEBE serializar ningún `BigInt` ni ningún `Date` crudo.

**R31** — El sistema DEBE construir la respuesta por **proyección explícita campo a campo** desde
el resultado interno; NO DEBE serializar el objeto interno tal cual, de modo que un campo nuevo en
el contrato interno no se publique solo.

**R32** — CUANDO la consulta se deniega, el sistema DEBE responder `403` sin datos y sin motivo, y
DEBE registrar el motivo en el log de auditoría del servidor por el mismo camino que ya usa el
canal de sesión.

**R33** — El sistema NO DEBE escribir en ningún log ni en ninguna respuesta la API key, su hash ni
el header `Authorization`.

**R34** — El sistema NO DEBE devolver importes en este canal (consecuencia de R17). SI alguna vez
se publicara una métrica con importes, ENTONCES DEBERÍA conservar los céntimos, por la convención
de la 230 para contratos de máquina.

### E · Identidad del mensajero

**R35** — El sistema DEBE aplicar la política de identidad `seudonima` a toda consulta de este
canal.

**R36** — El sistema NO DEBE incluir ningún identificador real de mensajero en la respuesta
serializada completa, ni siquiera en campos que el integrador no lea.

**R37** — CUANDO la petición intenta filtrar por mensajero, el sistema DEBE responder `403`
auditado (el oráculo de identidad de 126/R24 aplica a este canal sin duplicar el predicado).

**R38** — El sistema NO DEBE degradar la política de identidad a `real` por defecto: el camino que
no sepa decir qué política corresponde DEBE fallar cerrado en `seudonima`.

### F · Documentación pública, guardias y no-regresión

**R39** — El sistema DEBE publicar el endpoint en `lib/api/openapi-spec.ts` y en
`docs/api/api-key-openapi.yaml`, con los mismos paths, en el mismo orden y en la misma posición: el
canal pasa de OCHO a NUEVE endpoints en los dos artefactos, en el mismo commit.

**R40** — El sistema NO DEBE introducir la subcadena `intentos` en el OpenAPI serializado (ni en
descripciones, ni en ejemplos, ni en nombres de campo).

**R41** — El sistema NO DEBE modificar `middleware.ts`: `PUBLIC_ROUTES` DEBE quedar intacta y la
guardia de la 229 DEBE seguir verde sin cambios.

**R42** — Las dos guardias de frontera (126/R1 y 131/R1) DEBEN quedar como **allowlist nominal**:
el único handler y el único borde autorizados son los de esta feature, con su nombre escrito, y
cualquier otro archivo nuevo de `app/api` que consulte analítica DEBE seguir poniéndolas rojas
(comprobado con código sintético en el propio guardia).

**R43** — El sistema NO DEBE cambiar el comportamiento observable del canal de sesión: las cifras,
la serie, la agregación, la caché y la seudonimización de los cinco roles lectores DEBEN quedar
idénticas.

**R44** — El sistema NO DEBE requerir migración, ni cambio en `db/schema.prisma`, ni cambio de RLS.

### G · El lote de métricas (P4-bis, 2026-08-23)

**R45** — El sistema DEBE aceptar VARIAS métricas en una sola llamada, por el parámetro `metricas`
como lista separada por comas, y DEBE responder con la MISMA forma —el sobre `{ rango, metricas[] }`—
se pida una métrica o diez: la forma de la respuesta NO DEBE depender de cuántas se pidieron.

**R46** — El sistema DEBE aceptar el valor especial `all` como «todas las publicables», expandido
desde la MISMA lista blanca de R15; `all` NO DEBE combinarse con ids (`all,entregas` es `422`), y
NINGUNA métrica del catálogo puede llamarse `all` (comprobado por test contra el catálogo).

**R47** — El sistema DEBE conservar el ORDEN pedido en el array de la respuesta (el de la lista
blanca cuando se pidió `all`) y DEBE servir UNA sola vez un id repetido, conservando su primera
posición.

**R48** — El sistema DEBE leer el reloj **una sola vez por petición**: todas las series de un lote
DEBEN compartir el rango resuelto y el mismo instante de corte. El sistema NO DEBE publicar un
rango en la raíz si alguna serie no lo comparte (fallar es correcto; publicarlo, mentir).

---

## Preguntas abiertas

Ninguna de estas está resuelta. Cada una lleva mi recomendación razonada; la decisión es del
humano y se toma en la puerta. **Si alguna se responde distinto, se corrigen los requisitos
afectados antes de implementar** (se nombra cuáles).

### P1 · ¿Qué métricas entran en la lista blanca? (afecta R15–R21)

Recomendación: empezar **corto** y ampliar por petición, con estas y sólo estas, todas operativas,
`producida` y con `adminTienda: "acotado"`: `ordenes_creadas`, `ordenes_por_estado`, `entregas`,
`devoluciones`, `rechazos`, `reprogramaciones`, y las tasas/tiempos equivalentes que cumplan R17–R19.
**No he verificado uno a uno los 25 ids del catálogo contra R17/R18/R19**: la lista definitiva debe
salir de esa comprobación (es una task, T3) y de lo que el humano quiera publicar. Razón de ir
corto: quitar una métrica ya publicada es romper el contrato de un integrador; añadirla, no.

### P2 · ¿La dimensión `mensajero` se ofrece seudonimizada o se prohíbe entera? (afecta R35–R37)

Recomendación: **prohibirla entera** en este canal — ni desagregación ni filtro. Al integrador le
sirve el QUÉ pasó con sus órdenes, no el QUIÉN de nuestra operación; y D5 de la 122 anonimizó al
mensajero frente al `adminTienda` porque «no es su empleador», argumento que se aplica con más
fuerza a un tercero. La política `seudonima` se mantiene igualmente como defensa en profundidad
(R35/R38), aunque la dimensión no se ofrezca. Si se decide ofrecerla seudonimizada, R36/R37 no
cambian y hay que añadir un requisito nuevo sobre la estabilidad de las etiquetas (que
`identidad.ts:55-73` promete **sólo dentro de una respuesta**: el integrador no puede correlacionar
«Mensajero 1» entre dos llamadas, y eso hay que documentarlo o se leerá como un bug).

### P3 · ¿`desde`/`hasta` como la 257, y los presets como azúcar opcional? (afecta R24)

Recomendación: **sí**, `desde`/`hasta` idénticos a la 257 y traducidos por dentro a
`EntradaRango.personalizado`; **no ofrecer presets en v1**. Dos convenciones de fecha en el mismo
canal es una trampa para el integrador, y un preset depende del reloj del servidor: dos llamadas
idénticas devuelven conjuntos distintos (mismo argumento con el que la 257 descartó los presets,
`specs/257/design.md §8.6`). Pendiente adicional: ¿`desde`/`hasta` son **obligatorios** o hay
default? Recomendación: **obligatorios ambos**, para que el rango de una respuesta nunca dependa de
cuándo se llamó.

### P4 · Ruta y granularidad del endpoint (afecta R22, R28, R39)

Recomendación: `GET /api/ordenes/api-key/analitica?metrica=<id>&desde=&hasta=`, **una métrica por
llamada**, que es como funciona por dentro (`prepararConsultaAnalitica` recibe un `metricaId`) y lo
que hace que el 403 por métrica no publicable sea trivialmente correcto. Un endpoint multi-métrica
obligaría a decidir qué hacer cuando una de las cinco pedidas está prohibida (¿403 del lote? ¿éxito
parcial?), que es una decisión de contrato que nadie ha pedido. Sub-pregunta: ¿se publica también
un endpoint que **liste** las métricas disponibles? Recomendación: **no**; el catálogo publicable se
documenta como `enum` en el OpenAPI, que es donde un integrador lo busca.

### P5 · ¿Se documenta el marcador `parcial: true` del día en curso? (afecta R28)

Recomendación: **sí**, publicarlo con su `corteAt`. Sin él, el día de hoy se lee como un día
cerrado y el integrador verá una caída que no existe — exactamente el aviso que
`lib/types/analitica-operativa.ts:19-22` dirige a la 131/133. Es un campo opcional y aditivo: quien
lo ignore no se rompe.

### P6 · (HALLAZGO — no estaba en la ficha) ¿Se acepta modificar las DOS guardias de frontera?

`operativa-frontera.guardia.test.ts:45-58` y `tablero-operativo-frontera.guardia.test.ts:194-200`
prohíben hoy **cualquier** superficie de analítica bajo `app/api`, la segunda incluso por el
NOMBRE del archivo. Esta feature no puede existir sin tocar ambas. Recomendación: convertirlas en
allowlist nominal de un solo camino (R42) y dejar la app/api-ban intacta para todo lo demás, con la
decisión fechada escrita en el propio guardia. **Alternativa que NO recomiendo:** llamar a la ruta
de otra forma para esquivar el regex — sería pasar el guardia sin pasar su motivo.

### P7 · (HALLAZGO) ¿La lista blanca de métricas se acepta como «segunda lista» pese a R8 de la 122?

La 122 prohíbe una segunda tabla de alcance por rol. Una lista blanca de ids **no** es una tabla de
alcance (no dice qué ve nadie, sólo qué se publica), igual que `ROLES_SIN_ANALITICA` no lo era; y
el censo de `alcance-fuente-unica.guardia.test.ts` busca literales `{ maestro: ..., mensajero: ...}`,
que una lista de ids no produce. Recomendación: aceptar la lista blanca de ids, y atarla al
catálogo por test (R17/R18/R19) en vez de por confianza. La alternativa —declarar una columna
`apiKey` en las 25 métricas— está evaluada y descartada en `design.md §7.1` por su radio de
explosión.

### P8 · (HALLAZGO) ¿Rate limit / coste?

Este canal sirve agregaciones sobre el rollup, más caras que un listado paginado. No he encontrado
en el repo ningún rate limit para el canal por API key (no lo he buscado exhaustivamente: es un
desconocido, no una ausencia comprobada). Recomendación: **no** introducir rate limit en esta
ficha —el tope de 366 días y una métrica por llamada acotan el peor caso— y anotarlo como decisión
consciente para que no se reabra como olvido.

---

## PUERTA — decisiones cerradas el 2026-08-23

El humano dio la orden de continuar. **Las ocho preguntas se cierran TOMANDO LA RECOMENDACIÓN
RAZONADA DEL SPEC**, sin variarla. Se dejan escritas aquí, una por una, para que sea auditable qué
se congeló y con qué motivo — y para que cualquiera pueda vetar una sin releer el análisis entero.

| # | decisión cerrada | requisitos afectados |
| --- | --- | --- |
| **P1** | Lista blanca **CORTA** y ampliable por petición. La lista definitiva sale de la comprobación uno a uno de los 25 ids del catálogo contra R17–R19 (es la task T1), **no de una copia a ojo de esta recomendación**. Se va corto a propósito: retirar una métrica ya publicada rompe el contrato de un integrador; añadirla, no. | R15–R21 |
| **P2** | La dimensión `mensajero` se **PROHÍBE ENTERA** en este canal: ni desagregación ni filtro. La política `seudonima` se mantiene igualmente como defensa en profundidad. | R35–R38 |
| **P3** | `desde`/`hasta` **idénticos a la 257** (`YYYY-MM-DD`, calendario CR), traducidos por dentro a `EntradaRango.personalizado`. **Sin presets en v1** y **ambos OBLIGATORIOS**: el rango de una respuesta nunca depende de cuándo se llamó. | R24 |
| **P4** | `GET /api/ordenes/api-key/analitica?metrica=<id>&desde=&hasta=`, **una métrica por llamada**. **No** se publica endpoint que liste métricas: el catálogo publicable se documenta como `enum` en el OpenAPI. | R22, R28, R39 |
| **P5** | **Sí** se publica `parcial: true` con su `corteAt`. Campo opcional y aditivo. | R28 |
| **P6** | **SÍ se autoriza tocar las dos guardias de frontera**, convirtiéndolas en **allowlist nominal de UN SOLO camino**, con la decisión fechada escrita dentro del propio guardia. La prohibición de `app/api` sigue intacta para todo lo demás. **Queda EXPRESAMENTE PROHIBIDA** la alternativa de renombrar la ruta para esquivar el regex: eso sería pasar el guardia sin pasar su motivo. | R42 |
| **P7** | Se **acepta** la lista blanca de ids: no es una tabla de alcance (no dice qué ve nadie, sólo qué se publica). Se ata al catálogo **por test**, no por confianza. | R17–R19 |
| **P8** | **Sin rate limit** en esta ficha. Decisión consciente, no olvido: el tope de 366 días y una métrica por llamada acotan el peor caso. Si se reabre, es ficha nueva. | — |

---

## PUERTA — P4-bis, decidida el 2026-08-23 (posterior, y REVIERTE P4)

Pedido literal del humano: «que pueda pasarle las métricas como `string[]`, que pueda traer todas
las métricas en conjunto en lugar de una por una; con el array puede traer solo las seleccionadas
y `all` trae todo».

**Esto deroga la mitad de P4.** La ruta no cambia; la granularidad, sí: el endpoint pasa de UNA
métrica por llamada a un LOTE. Se deja escrito lo que P4 argumentaba, porque su objeción era buena
y hay que responderla, no taparla:

> «Un endpoint multi-métrica obligaría a decidir qué hacer cuando una de las cinco pedidas está
> prohibida (¿403 del lote? ¿éxito parcial?), que es una decisión de contrato que nadie ha pedido.»

Ahora sí se ha pedido, y la decisión es **403 del lote entero** (R16). El éxito parcial queda
EXPRESAMENTE DESCARTADO, y no por gusto: un lote que sirve «las que puede» y calla las demás
responde, con una sola petición, a la pregunta «¿qué ids están en la lista blanca?» — que es
exactamente el oráculo que R16 existe para cerrar. La objeción de P4 no era que el lote fuera malo:
era que la pregunta estuviera sin responder.

| # | decisión cerrada | requisitos afectados |
| --- | --- | --- |
| **P4-bis.a** | `metricas` es una **lista separada por comas** (`metricas=a,b,c`), no una clave repetida. Mantiene la lectura CLAVE POR CLAVE de 106/R8: `sp.get` sigue devolviendo un `string` y no se abre el multivalor para una sola clave. | R45, R27 |
| **P4-bis.b** | **`all`** trae todas las publicables, expandido desde `METRICAS_API_KEY`. No se combina con ids. Se comprueba por test que ningún id del catálogo se llama `all`: si naciera, el centinela lo eclipsaría en silencio. | R46 |
| **P4-bis.c** | La respuesta es **siempre el sobre** `{ rango, metricas[] }`, también con una sola métrica. Dos formas para el mismo endpoint obligarían al integrador a escribir dos parsers y a elegir mirando su propia petición. | R45, R28 |
| **P4-bis.d** | El **`rango` se publica UNA vez, en la raíz**; la **`cobertura` NO se hoistea** y va en cada serie. No es una asimetría descuidada: el rango es idéntico por construcción (mismo `raw`, mismo instante), pero `fechasNoComparables` depende del historial que cada métrica necesita, así que dos métricas del mismo rango pueden no ser comparables en los mismos días. | R28, R29, R48 |
| **P4-bis.e** | **Lote todo-o-nada**: una sola métrica no publicable deniega la petición entera, con el mismo 403 mudo y CERO consultas a la base. | R16, R45 |
| **P4-bis.f** | **Duplicados deduplicados** (primera aparición gana) y **orden pedido conservado**. Rechazar un duplicado con 422 sería antipático sin ganar nada; servirlo dos veces, trabajo pagado dos veces contra el rollup. | R47 |
| **P4-bis.g** | El resolutor de la lista vive en **`lib/api/analitica-api-key-metricas.ts`**, no en el handler: expandir `all` exige leer la lista blanca (`@/lib/analytics/**`) y la guardia de 134/R3 prohíbe ese import desde CUALQUIER archivo de `app/api`, también desde el camino nominalmente autorizado por P6. La guardia se respeta entera; no se estrecha una tercera vez. | R42, R46 |

⚠️ **P8 QUEDA TOCADA Y HAY QUE DECIRLO.** Su argumento era «el tope de 366 días **y una métrica por
llamada** acotan el peor caso». La segunda mitad ya no vale: el peor caso pasa de 1 a
`METRICAS_API_KEY.length` consultas al rollup por petición (hoy **10**), un factor 10. **La decisión
se mantiene —sin rate limit en esta ficha—** con dos mitigaciones escritas: (a) el lote está acotado
POR CONSTRUCCIÓN, porque tras deduplicar cualquier id fuera de la lista blanca deniega la petición
entera, así que nunca hay más consultas que métricas publicables; (b) las consultas se ejecutan en
SERIE, no con `Promise.all`, para no multiplicar por 10 la concurrencia contra la base desde un
canal público. Si el rate limit se reabre, sigue siendo ficha nueva.

⚠️ **La más delicada es P6**, y conviene decirlo en voz alta: autoriza modificar dos guardias
ARQUITECTÓNICAS. El argumento que la sostiene es que el propio guardia dice que los route handlers
son «para webhooks y **API pública**», y este canal ES la API pública: la guardia se escribió para
impedir una segunda superficie **interna**, no para cerrar el canal por API key. Por eso se
ESTRECHA a un camino nominal y no se deroga. Si esta lectura no se comparte, la feature entera
cambia de forma y hay que parar antes de T7.
