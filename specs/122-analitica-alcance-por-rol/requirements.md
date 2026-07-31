# Feature 122 — analítica: resolutor de alcance por rol · requirements

> **Esto es una frontera de seguridad multi-tenant.** Un fallo aquí no produce una cifra
> equivocada: filtra datos de una tienda a otra, de una zona a otra y de un mensajero a otro.
> Los requisitos NEGATIVOS (R25–R29, R38) tienen el mismo rango que los positivos.
>
> **Estado: puerta F1.4 CERRADA el 2026-07-31.** Las diez preguntas fueron respondidas por el
> humano; sus respuestas y las consecuencias asumidas están en `§2. Decisiones del humano`. No
> queda ningún requisito marcado `⧗Qn`. Requisitos: **R1–R41** (R35–R41 nacen de las decisiones).

## 0. Contexto heredado y defecto de la ficha

- **Defecto de redacción de la ficha (no perpetuar).** `feature_list.json:1394` dice «Depende de
  120». Ese id es **viejo**: la dependencia real registrada es `depends_on: 135`
  (`feature_list.json:1400`), ya `done` y mergeada en `dev @ 79056b24`. El mismo desfase de
  numeración está documentado por la 129 (`specs/129-analitica-ruta-shell-sidebar/design.md:256-263`:
  «Los `depends_on` son la referencia fiable; las descripciones, no»). Las fichas de 126, 127, 133
  y 134 citan a esta feature como «121»: se refieren a **esta** (122).
- **Contrato vigente que esta feature CONSUME, no reinventa** (feature 135, mergeada):
  `lib/analytics/types.ts`, `metrics.ts`, `ranges.ts`, `filters.ts` y sus 10 suites en
  `tests/unit/analytics/`.
- **Avisos dirigidos a esta feature** (`specs/135-analitica-catalogo-kpis-rangos/design.md:385-388`):
  D7 → el criterio de acceso total es `esAccesoTotal(rol)` (`lib/auth/acceso-total.ts:7-9`), que la
  135 **no duplica**; D9 → el recorte por zona del `adminSatelite` se aplica sobre `orden.zona_id`,
  **nunca** sobre la zona del mensajero.
- **R24 de la 135** (`lib/analytics/filters.ts:59-65`): el filtro validado **no es autorización** —
  no lleva rol, ni sesión, ni `usuario_id`, y `.strict()` lo garantiza. El orden invariante es
  **parsear → resolver alcance → consultar**, y hacerlo imposible de invertir es trabajo de esta
  feature (R14, R15).

---

## 1. Requisitos

### Resolución del alcance

**R1.** El sistema DEBE exponer una función pura de resolución de alcance que, dados un actor y el
id de una métrica del catálogo, devuelva un resultado **discriminado** —`ok` con la estructura de
alcance, o `denegado` con un motivo cerrado— y que **NO lance** en ningún caso, incluida una
entrada malformada.

**R2.** MIENTRAS la métrica declare `alcance[rol] === "total"`, el sistema DEBE resolver un alcance
**global** (sin recorte de filas).

**R3.** El sistema DEBE derivar el conjunto de roles de acceso total invocando `esAccesoTotal()` de
`lib/auth/acceso-total.ts` y **NO DEBE** declarar una segunda lista de roles totales propia. Un
guardia DEBE fallar si el conjunto `{rol : metrica.alcance[rol] === "total"}` de alguna métrica del
catálogo difiere de `{rol : esAccesoTotal(rol)}`.

**R4.** CUANDO el rol del actor sea `adminSatelite` y la métrica declare `acotado`, el sistema DEBE
resolver un alcance **de zona** cuyo valor sea `actor.zonaId`.

**R5.** El recorte de zona DEBE expresarse siempre sobre `orden.zona_id`
(`db/schema.prisma:469`, NOT NULL) y **NUNCA** sobre `usuario.zona_id` del mensajero que gestionó la
fila (D9 de la 135). Un guardia DEBE fallar si algún adaptador de esta feature nombra la zona del
usuario.

**R6.** CUANDO el rol del actor sea `adminTienda` y la métrica declare `acotado`, el sistema DEBE
resolver un alcance **de tienda** cuyo valor sea `actor.usuarioId`, porque en este esquema el
`adminTienda` **es** la tienda: `orden.tienda_id` es FK a `usuario`
(`db/schema.prisma:468,505`; mismo criterio ya usado en `lib/notificaciones/emitir.ts:110` y en
`OrdenService.crear` `lib/services/OrdenService.ts:122-127`).

**R7.** CUANDO el rol del actor sea `mensajero` y la métrica declare `acotado`, el sistema DEBE
resolver un alcance **de mensajero** cuyo valor sea `actor.usuarioId`, y ese alcance DEBE
expresarse **siempre** sobre `orden.mensajero_asignado_id` (`db/schema.prisma:478`), para **toda**
métrica y **sin excepción por `unidadDeConteo`** (D3). El sistema **NO DEBE** recortar por
`gestion_orden.mensajero_id` (`db/schema.prisma:651`) en ningún adaptador. Un guardia DEBE fallar si
`gestion_orden.mensajero_id` aparece como columna de recorte en `lib/analytics/**`.

**R8.** El sistema DEBE tomar la regla por rol **exclusivamente** de `metrica.alcance`
(`lib/analytics/metrics.ts:50-69`, `ALCANCE_OPERATIVA` / `ALCANCE_FINANCIERA`) y **NO DEBE**
mantener una segunda tabla de reglas por rol. Un guardia DEBE fallar si aparece en el repo otra
declaración `Record<RolAnalitica, …>` con semántica de alcance fuera de `lib/analytics/metrics.ts`.

### Fallo cerrado (requisitos negativos de primer rango)

**R9.** SI `metrica.alcance[rol] === "prohibido"`, ENTONCES el sistema DEBE devolver `denegado` con
motivo `metrica_prohibida` y **NO DEBE** devolver alcance alguno, ni siquiera recortado.

**R10.** SI no hay actor (sesión ausente, expirada o usuario no activo), ENTONCES el sistema DEBE
devolver `denegado` con motivo `sin_sesion`.

**R11.** SI el rol del actor no pertenece a `ROLES_ANALITICA` (`lib/analytics/types.ts:54-60`) —hoy
el único caso es `apiKey`, `db/schema.prisma:41`—, ENTONCES el sistema DEBE devolver `denegado` con
motivo `rol_sin_analitica`. La cuenta de integración `apiKey` **NUNCA** consume analítica (D9): el
sistema **NO DEBE** resolver alcance para ella en ninguna métrica, y un guardia DEBE fallar si
`apiKey` entra en `ROLES_ANALITICA` o si alguna métrica le declara alcance.

**R12.** SI el rol del actor no es ninguno de los seis valores de `RolValue`
(`db/schema.prisma:35-44`), ENTONCES el sistema DEBE devolver `denegado` con motivo
`rol_desconocido`. El sistema **NO DEBE** tener rama `default` que conceda alcance.

**R13.** SI el rol es `adminSatelite` y `actor.zonaId` es `null` o cadena vacía —posible: la
columna es nullable, `db/schema.prisma:98`, y `resolveActorFromSession` la normaliza a `null`,
`lib/auth/resolve-actor.ts:33`—, ENTONCES el sistema DEBE devolver `denegado` con motivo
`sin_zona_asignada`, y **NO DEBE** degradar a global, ni a «todas las zonas», ni a `ok` con cero
filas (D2). El borde DEBE traducirlo a **403** (R40): un `adminSatelite` sin zona no ve nada y el
dato faltante se ve como error de configuración, no como tablero vacío.

**R14.** SI el id de métrica no existe en el catálogo (`getMetrica` devuelve `undefined`,
`lib/analytics/metrics.ts`), ENTONCES el sistema DEBE devolver `denegado` con motivo
`metrica_desconocida`.

### Orden invariante e imposibilidad de olvidarlo

**R15.** El sistema DEBE exponer un **único punto de entrada** que reciba la entrada cruda del
cliente, el actor y el id de métrica, y que ejecute internamente y en este orden: (1) parsear el
filtro con `parseAnaliticaFiltro`, (2) resolver el rango con `resolverRango`, (3) resolver el
alcance, (4) devolver el resultado. **NO DEBE** existir vía pública que resuelva alcance sobre un
filtro no parseado, ni que devuelva un objeto consultable sin alcance resuelto.

**R16.** El sistema DEBE devolver, en el caso de éxito, un valor de tipo **opaco** (marcado con un
símbolo no exportado) que agrupe filtro parseado, rango resuelto, métrica y alcance. Construir ese
valor con un literal desde fuera del módulo **NO DEBE compilar**.

**R17.** Toda función de repositorio o servicio de analítica DEBE aceptar ese tipo opaco y **NO
DEBE** aceptar el filtro parseado suelto: omitir el recorte DEBE ser un **error de compilación**,
no una omisión silenciosa.

**R18.** El sistema DEBE incluir un **guardia estructural** (patrón `*.guardia.test.ts` de
`tests/unit/analytics/`) que falle si un archivo de `lib/repositories/`, `lib/services/` o
`lib/actions/` consulta una tabla de analítica (`analytics_daily`, `orden`, `gestion_orden`,
`orden_historial_estado`, los tres ledgers y los dos cierres) en contexto de analítica sin recibir
el tipo opaco. El guardia DEBE incluir **autocomprobación** con fixtures sintéticos, de modo que no
pueda quedar verde por vacío mientras 126 y 127 no existan.

**R19.** SI el parseo del filtro falla, ENTONCES el sistema DEBE devolver `validation_error` con
`fieldErrors` y **NO DEBE** resolver alcance ni revelar motivo de denegación: una entrada inválida
no puede usarse para sondear qué métricas existen o qué ve un rol.

### Precedencia del recorte sobre el filtro del cliente

**R20.** CUANDO el filtro del cliente nombre ids de la dimensión recortada (`zona_id`, `tienda_id`
o `mensajero_id`, `lib/analytics/filters.ts:77-79`), el sistema DEBE **intersecar** esos ids con el
alcance resuelto; el filtro del cliente **NO DEBE** poder ampliar el alcance en ningún caso.

**R21.** SI la intersección de R20 resulta vacía —el actor pidió explícitamente datos ajenos—,
ENTONCES el sistema DEBE fallar cerrado con motivo `filtro_fuera_de_alcance` y el borde DEBE
responder **403** (D1, R40). El sistema **NO DEBE** devolver `ok` con conjunto vacío ni recortar el
filtro en silencio, y el intento DEBE quedar auditado (R39).

**R22.** El sistema DEBE garantizar, para **toda** combinación de rol, métrica, grano y filtro, que
el conjunto de filas alcanzable es un **subconjunto** del alcance resuelto. Un test de propiedad
sobre una matriz exhaustiva (5 roles × 23 métricas × los filtros de las tres dimensiones) DEBE
comprobarlo.

### Traducción a consulta (sin tocar la DB)

**R23.** El sistema DEBE ofrecer adaptadores que traduzcan el alcance a un fragmento de `where`
para `orden`, `gestion_orden` y `analytics_daily`, y **NO DEBE** obligar a cada servicio a escribir
nombres de columna a mano. Las tres columnas canónicas son fijas y sin variantes por métrica:
zona ⇒ `orden.zona_id`, tienda ⇒ `orden.tienda_id`, mensajero ⇒ `orden.mensajero_asignado_id` (D3).

**R24.** CUANDO el adaptador sea el de `gestion_orden`, los tres recortes —zona, tienda **y
mensajero**— DEBEN expresarse **a través de la relación con `orden`**
(`{ orden: { zonaId | tiendaId | mensajeroAsignadoId } }`), porque `gestion_orden` no tiene columnas
de zona ni de tienda (`db/schema.prisma:648-694`: solo `orden_id` y `mensajero_id`) y porque
`gestion_orden.mensajero_id` **no** es la fuente de verdad del mensajero de una orden (D3, R7). El
adaptador **NO DEBE** usar `gestion_orden.mensajero_id` aunque exista, sea NOT NULL y esté a mano.

**R25.** El sistema **NO DEBE** ofrecer adaptador de alcance para las tablas de dinero
(`wallet_movimiento`, `wallet_tienda_movimiento`, `pago_mensajero_movimiento`, `cierre_dia`,
`cierre_bodega`): para toda métrica financiera el alcance es `total` o `prohibido`
(`lib/analytics/metrics.ts:63-69`), nunca `acotado`. Un guardia DEBE fallar si alguna métrica
financiera declara `acotado`, porque significaría que existe un recorte de dinero sin adaptador que
lo aplique.

### Aislamiento multi-tenant (lo que cada rol NO puede ver)

**R26.** MIENTRAS el actor sea `adminTienda`, el sistema **NO DEBE** hacer alcanzable ninguna fila
cuya `orden.tienda_id` sea distinta de `actor.usuarioId`, sea cual sea la métrica, el grano, el
rango o el filtro solicitado.

**R27.** MIENTRAS el actor sea `adminSatelite`, el sistema **NO DEBE** hacer alcanzable ninguna fila
cuya `orden.zona_id` sea distinta de su zona, ni siquiera para las órdenes gestionadas por un
mensajero cuya `usuario.zona_id` sí coincida (D9).

**R28.** MIENTRAS el actor sea `mensajero`, el sistema **NO DEBE** hacer alcanzable ninguna fila
cuya `orden.mensajero_asignado_id` sea distinta de `actor.usuarioId`, incluido el cubo
`MENSAJERO_SIN_ASIGNAR` (`lib/analytics/types.ts:82`): las órdenes sin mensajero asignado **no** son
«propias».

**Consecuencia asumida, escrita y probada (D3).** En el caso decisivo —orden asignada a **A**, que
A gestiona (queda una gestión vigente de A) y que el maestro **reasigna a B**— con
`orden.mensajero_asignado_id` el resultado es: **B alcanza la fila y la gestión desde el instante de
la reasignación** (ve una gestión que no ejecutó) y **A deja de alcanzarla**, perdiendo de sus cinco
métricas de gestión el trabajo que sí hizo. **A pierde el crédito de su propio trabajo.** El sistema
DEBE comportarse exactamente así y un test nombrado (`orden reasignada de A a B`) DEBE fijarlo como
comportamiento **esperado**, no como defecto, para que nadie lo «arregle» sin volver a la puerta.

**R29.** MIENTRAS el actor sea `adminSatelite`, `adminTienda` o `mensajero`, el sistema **NO DEBE**
hacer alcanzable ninguna métrica de dominio `financiera`, ni agregada, ni recortada, ni en cero.

### Sesión, pureza y frontera de la rama

**R30.** El borde (Server Action o Route Handler de analítica) DEBE obtener el actor con
`resolveActorFromSession()` (`lib/auth/resolve-actor.ts:15-34`) y **NO DEBE** leer la cookie de
sesión por su cuenta. El módulo resolutor DEBE aceptar una forma **estructural** compatible con
`Actor` (`lib/interfaces/services/IOrdenService.ts:13-24`: `usuarioId`, `rol`, `zonaId?`) sin
importar ese archivo, porque el segmento `services` está prohibido por el guardia de pureza
(`tests/unit/analytics/modulo-puro.guardia.test.ts:110`).

**R31.** El módulo **NO DEBE** importar `@/lib/db`, repositorios, servicios, acciones,
`next/headers` ni `@prisma/client` como valor; **NO DEBE** declarar `'use server'`; **NO DEBE** leer
`process.env`; y DEBE poder importarse sin `DATABASE_URL`. La verificación transitiva de esta
prohibición la fijan **R35** y **R36**.

**R32.** El sistema DEBE ser **determinista**: misma entrada, mismo resultado. El instante actual
DEBE ser inyectable (parámetro `now`, patrón `resolverRango`,
`specs/135-analitica-catalogo-kpis-rangos/design.md:266`) y **NO DEBE** haber `Date.now()` oculto.

**R33.** La rama de esta feature **NO DEBE** crear migraciones, esquema, rutas, páginas ni
componentes; los archivos tocados DEBEN limitarse a `lib/analytics/**` y `tests/unit/analytics/**`
—incluida la **única excepción autorizada**: la ampliación de
`tests/unit/analytics/modulo-puro.guardia.test.ts`, archivo heredado de la 135 (D8, R35)—.
Un guardia de frontera medido sobre el diff real DEBE comprobarlo (patrón
`tests/unit/analytics/frontera.guardia.test.ts`).

**R34.** El **módulo puro** de esta feature **NO DEBE** registrar nada en logs ni incluir en mensajes
de error ids ajenos, PII ni el contenido de la sesión; un motivo de denegación es un literal cerrado,
no un texto con datos. La auditoría de intentos denegados la emite el **borde** (R40), no el módulo.

### Guardia de pureza transitivo (D8)

**R35.** El guardia de pureza existente `tests/unit/analytics/modulo-puro.guardia.test.ts` DEBE
**ampliarse** para inspeccionar la **clausura transitiva** de imports de `lib/analytics/**`, y no
solo los directos como hoy (`:120-151`). El sistema **NO DEBE** contener un segundo guardia de
pureza propio de la 122: hay **un solo** guardia (D8).

**R36.** La ampliación de R35 DEBE convivir con `lib/auth/acceso-total.ts:1`, que importa `RolValue`
de `@prisma/client` **como valor** y que D7 de la 135 obliga a reutilizar. El guardia DEBE declarar
una **allowlist nominal de aristas** (no de archivos, no de patrones, no de directorios) con
exactamente **una** entrada —`lib/auth/acceso-total.ts → @prisma/client`, restringida al nombre
importado `RolValue`— y su motivo escrito en el propio archivo. El guardia DEBE fallar si:
(a) esa arista importa cualquier otro nombre, un import por defecto o uno de namespace;
(b) la allowlist tiene más de una entrada; (c) aparece cualquier otra arista transitiva prohibida
(autocomprobación con una arista infractora inyectada a mano). La excepción **NO DEBE** sustituir a
la comprobación empírica: la clausura completa DEBE seguir importándose en un proceso **sin
`DATABASE_URL`** y sin efectos observables al importar. Eso es lo que hace que la excepción no sea
un agujero: importar el enum trae un objeto congelado, no abre conexión (`PrismaClient` solo conecta
al construirse) y el import empírico lo demuestra en cada corrida.

### Granos por rol e identidad del mensajero (D4, D5, D6)

**R37.** El sistema **NO DEBE** recortar los granos de agregación por rol: todo rol al que la
métrica declare `total` o `acotado` puede desagregar por cualquiera de los `metrica.granos`
declarados en el catálogo (`lib/analytics/types.ts:188`). En particular, `adminSatelite` PUEDE
desagregar por `tienda` dentro de su zona (D4), `adminTienda` PUEDE desagregar por `mensajero` sobre
sus propias órdenes (D5) y `mensajero` PUEDE desagregar por `tienda` (D6). Un guardia DEBE fallar si
aparece en `lib/analytics/**` una segunda tabla de granos permitidos por rol: el recorte es de
**filas**, no de columnas de agrupación.

**R38.** CUANDO el rol del actor sea `adminTienda` y el grano solicitado sea `mensajero`, el sistema
DEBE marcar la consulta con **política de identidad seudónima** y DEBE sustituir cada identificador
real de mensajero por una **etiqueta ordinal estable dentro de la respuesta** (p. ej. `Mensajero 1`,
`Mensajero 2`), asignada de forma **determinista** para una misma entrada (R32). Para los demás
roles la política es `real`. La sustitución DEBE ocurrir **en el servidor**, antes de serializar la
respuesta.

**R39.** MIENTRAS la política de identidad sea seudónima, el payload que cruza al cliente **NO DEBE**
contener, en ningún campo, ni anidado, ni en metadatos, ni en claves de objeto: el `uuid` real del
mensajero, su nombre, su teléfono, su correo, ni la tabla de correspondencia seudónimo → id real. Un
`adminTienda` **NO DEBE** poder identificar a la persona a partir de la respuesta: no es su
empleador. Un test DEBE serializar el payload completo y afirmar que **ningún** id real de mensajero
aparece en la cadena resultante.

### Auditoría y traducción en el borde (D1, D2, D7, D10)

**R40.** CUANDO el punto de entrada devuelva `forbidden`, el borde DEBE registrar el intento por el
**canal de logging existente del repo** —la interfaz `ErrorLogger` de `lib/errors/logger.ts:6-8`,
cuya implementación por defecto `ConsoleErrorLogger` (`:13-21`) es el canal servidor que ya usan
crons y webhooks a través de `withErrorHandler` (`lib/errors/with-error-handler.ts:10-19`)— con
exactamente estos campos: rol del actor, `usuarioId` del actor, tienda o zona solicitada, filtro
rechazado y motivo. El registro **NO DEBE** contener nombres, teléfonos, correos ni el contenido de
la sesión: solo el rol, el propio id del actor y los ids que el propio actor envió (R34 se respeta
porque no hay dato ajeno que el actor no conociera ya).

> **Trampa verificada, no la pise el implementer.** Envolver el borde en `withErrorHandler` **no
> basta**: `normalizeError` devuelve la shape de un `AppError` (incluido `ForbiddenError`) en su
> primera línea (`lib/errors/normalize.ts:22`) y **solo llama a `logger.logError` en la rama del
> error desconocido** (`:45`). Un `forbidden` propagado como `ForbiddenError` **no dejaría rastro**.
> Por eso R40 exige una llamada **explícita** al `ErrorLogger` en el borde, y su test verifica que
> el logger recibe la llamada (espía), no que el request devuelva 403.

**R41.** El punto de entrada DEBE devolver `forbidden` (patrón existente del repo,
`lib/interfaces/services/IOrdenService.ts:31`) y el borde DEBE traducirlo a **HTTP 403** —o al
estado equivalente de Server Action—, y **NO DEBE** traducirlo a `ok` con ceros, a lista vacía ni a
200 con `data: []`, para que la 133 pueda distinguir «prohibido» de «sin datos» (D7).

---

## Trazabilidad requisito → prueba

Todas las rutas son de nueva creación salvo indicación. El mapa fino (nombre exacto del `it`) lo
cierra el implementer en `progress/impl_122.md`.

| R | Verificación (test concreto) |
|---|---|
| R1 | `alcance.test.ts`: resultado discriminado para las 5×23 combinaciones; `expect(() => …).not.toThrow()` con entradas basura (`null`, `{}`, rol numérico). |
| R2 | `alcance.test.ts`: para toda métrica con `alcance[rol]==="total"`, `resolver(...).alcance.tipo === "global"`. |
| R3 | `alcance-fuente-unica.guardia.test.ts`: `{rol: alcance[rol]==="total"}` ≡ `ROLES_ACCESO_TOTAL` para las 23 métricas; y censo: `esAccesoTotal` aparece importado en el módulo, sin lista literal de roles totales. |
| R4 | `alcance.test.ts`: `adminSatelite` + métrica acotada ⇒ `{tipo:"zona", zonaId:"z1"}`. |
| R5 | `alcance-columnas.guardia.test.ts`: los adaptadores nombran `zonaId` de `orden`; censo = 0 ocurrencias de la zona de `usuario` en `lib/analytics/**`. |
| R6 | `alcance.test.ts`: `adminTienda` ⇒ `{tipo:"tienda", tiendaId: actor.usuarioId}` (y ≠ un `tiendaId` traído del filtro). |
| R7 | `alcance.test.ts`: `mensajero` ⇒ `{tipo:"mensajero", mensajeroId: actor.usuarioId}`; `alcance-columnas.guardia.test.ts`: censo = 0 ocurrencias de `gestion_orden.mensajero_id`/`mensajeroId` propio de `gestion_orden` como columna de recorte en `lib/analytics/**`. |
| R8 | `alcance-fuente-unica.guardia.test.ts`: censo repo-wide de `Record<RolAnalitica` con valores `total\|acotado\|prohibido` fuera de `lib/analytics/metrics.ts` = 0. |
| R9 | `alcance.test.ts`: las 8 financieras × {adminSatelite, adminTienda, mensajero} ⇒ 24 casos `denegado/metrica_prohibida`. |
| R10 | `alcance.test.ts`: actor `null`/`undefined` ⇒ `denegado/sin_sesion`. |
| R11 | `alcance.test.ts`: `rol:"apiKey"` ⇒ `denegado/rol_sin_analitica` para las 23 métricas; `alcance-fuente-unica.guardia.test.ts`: `ROLES_ANALITICA` no contiene `apiKey` y ninguna métrica le declara alcance (D9, «nunca»). |
| R12 | `alcance.test.ts`: itera `Object.values(RolValue)` y exige veredicto explícito para los 6; `rol:"inventado"` ⇒ `denegado/rol_desconocido`. |
| R13 | `alcance.test.ts`: `adminSatelite` con `zonaId: null` y con `""` ⇒ `denegado/sin_zona_asignada`; nunca `global`. |
| R14 | `alcance.test.ts`: `metricaId:"no_existe"` ⇒ `denegado/metrica_desconocida`. |
| R15 | `consulta.test.ts`: espías sobre `parseAnaliticaFiltro`/`resolverRango`/resolutor comprobando el orden de llamada; y censo de exports del módulo = no hay función pública que acepte un filtro sin parsear. |
| R16 | `consulta.tipos.test-d.ts` (o `@ts-expect-error` en `consulta.test.ts`): un literal del tipo opaco no compila; `prepararConsultaAnalitica` sí lo produce. |
| R17 | Mismo test: una firma de repositorio simulada que acepte `AnaliticaFiltroInput` en vez del tipo opaco falla el `@ts-expect-error`. |
| R18 | `alcance-obligatorio.guardia.test.ts`: censo sobre `lib/{repositories,services,actions}` + autocomprobación con 3 fixtures sintéticos (uno legítimo, dos infractores). |
| R19 | `consulta.test.ts`: filtro con clave desconocida y con rango inválido ⇒ `validation_error`, y el resolutor de alcance no se invoca (espía). |
| R20 | `consulta.test.ts`: `adminTienda` + `tienda_id:[propia, ajena]` ⇒ solo la propia; `adminSatelite` + `zona_id:[ajena]` ⇒ no amplía. |
| R21 | `consulta.test.ts`: `adminTienda` + `tienda_id:[ajena]` ⇒ `denegado/filtro_fuera_de_alcance`. |
| R22 | `alcance-matriz.test.ts`: matriz exhaustiva 5×23 × {sin filtro, filtro propio, filtro ajeno, filtro mixto} afirmando pertenencia al alcance. |
| R23 | `alcance-adaptadores.test.ts`: fragmento `where` esperado para `orden` y `analytics_daily` en los cuatro tipos de alcance. |
| R24 | `alcance-adaptadores.test.ts`: el fragmento de `gestion_orden` recorta zona, tienda **y mensajero** vía la relación `orden` (`{orden:{mensajeroAsignadoId}}`), nunca por `gestion_orden.mensajeroId`. |
| R25 | `alcance-dinero.guardia.test.ts`: ninguna métrica `financiera` declara `acotado`; el módulo no exporta adaptador para las 5 tablas de dinero. |
| R26 | `aislamiento.guardia.test.ts`: para todo (métrica, grano, filtro), el `where` resultante de `adminTienda` contiene la igualdad de tienda; test negativo con dos tiendas. |
| R27 | `aislamiento.guardia.test.ts`: ídem zona, incluido el caso «mensajero de la zona A gestiona orden de la zona B» (D9). |
| R28 | `aislamiento.guardia.test.ts`: `mensajero` + métrica con grano `mensajero` ⇒ el cubo `MENSAJERO_SIN_ASIGNAR` queda fuera; **caso nombrado «orden reasignada de A a B»**: tras la reasignación el `where` de B alcanza la fila (y su gestión de A) y el de A no, afirmado como comportamiento esperado de D3. |
| R29 | `aislamiento.guardia.test.ts`: los 3 roles × 8 financieras ⇒ ningún `where` producido (denegado antes). |
| R30 | `actor.test.ts`: el tipo `Actor` de `IOrdenService` es asignable a la forma estructural del módulo (test de tipos); censo: `lib/analytics/**` no importa `interfaces/services` ni `next/headers`. |
| R31 | `modulo-puro.guardia.test.ts`: imports directos de `lib/analytics/**` sin capas prohibidas; import sin `DATABASE_URL`; sin `process.env`; sin `'use server'`. |
| R32 | `consulta.test.ts`: dos invocaciones con el mismo `now` inyectado dan resultado idéntico; censo de `Date.now()`/`new Date()` sin parámetro en el módulo. |
| R33 | `frontera-122.guardia.test.ts`: diff de la rama contra la base; 0 archivos en `db/migrations/`, `app/`, `components/`, y código solo en `lib/analytics/**` + `tests/unit/analytics/**` (más la ampliación autorizada de `modulo-puro.guardia.test.ts`, D8). |
| R34 | `alcance.test.ts`: todo motivo de denegación pertenece a la unión literal declarada y no contiene ids; espía de `console.*` en el módulo puro = 0 llamadas. |
| R35 | `modulo-puro.guardia.test.ts` (ampliado, **mismo archivo**): la clausura **transitiva** de `lib/analytics/**` se recorre y se censa; censo repo-wide = 0 guardias de pureza duplicados en `tests/unit/analytics/` (ningún otro archivo declara `CAPAS_PROHIBIDAS`). |
| R36 | `modulo-puro.guardia.test.ts`: la allowlist tiene `length === 1`; una arista `acceso-total → @prisma/client` con `PrismaClient` en los nombres pone el guardia rojo; una arista transitiva prohibida inyectada a mano pone el guardia rojo; import de la clausura completa con `delete process.env.DATABASE_URL` no lanza. |
| R37 | `alcance-granos.test.ts`: para cada rol con la métrica `total`/`acotado`, todos los `metrica.granos` son solicitables (incluidos `adminSatelite`+`tienda`, `adminTienda`+`mensajero`, `mensajero`+`tienda`); guardia: 0 tablas `Record<RolAnalitica, …granos…>` en `lib/analytics/**`. |
| R38 | `identidad.test.ts`: `adminTienda`+grano `mensajero` ⇒ `politicaIdentidad === "seudonima"` y la proyección devuelve etiquetas ordinales; los otros cuatro roles ⇒ `"real"`; dos invocaciones con la misma entrada dan las mismas etiquetas (determinismo). |
| R39 | `identidad.test.ts`: `JSON.stringify(payload)` de un resultado con política seudónima **no contiene** ninguno de los uuid reales de mensajero de la fixture, ni nombre/teléfono/correo, ni el mapa inverso (aserción sobre la cadena completa, no sobre campos concretos). |
| R40 | `auditoria.test.ts`: un `forbidden` invoca `logger.logError` (espía sobre `ErrorLogger`) con rol, `usuarioId`, tienda/zona pedida, filtro rechazado y motivo; y test de la trampa: `normalizeError(new ForbiddenError(), spy)` **no** llama al spy (`lib/errors/normalize.ts:22`), luego el borde no puede delegar en `withErrorHandler`. Guardia con autocomprobación sobre los bordes de 126/127/134 (hoy censo vacío, fixtures sintéticos). |
| R41 | `consulta.test.ts`: la unión de `PreparacionAnalitica` incluye `forbidden` y **no** un caso `ok` con datos vacíos para denegación; guardia sobre los bordes consumidores (fixtures): traducir `forbidden` a 200 pone el guardia rojo. |

**Cobertura: 41/41.** Ningún requisito queda sin test nombrado.

---

## 2. Decisiones del humano (puerta F1.4, 2026-07-31)

Diez preguntas, diez respuestas. Cada una con la **consecuencia asumida**: se documenta lo que
cuesta, no solo lo que se gana. Cambiar cualquiera de estas diez exige volver a la puerta.

**D1 (Q1) · Filtro que nombra datos ajenos ⇒ EXPLÍCITO SIEMPRE.** 403 con motivo
`filtro_fuera_de_alcance`. No se devuelve conjunto vacío ni se recorta en silencio.
*Consecuencia asumida:* un usuario legítimo que llegue con un filtro obsoleto (una tienda que dejó
de ser suya, un enlace guardado) recibirá un 403 y no un tablero vacío; se acepta porque un tablero
vacío se reporta como bug de datos y esconde el intento, y porque el id lo aportó el propio
solicitante. Fija **R21**; se audita por **R40**.

**D2 (Q2) · `adminSatelite` sin `zona_id` ⇒ EXPLÍCITO SIEMPRE.** 403 (`sin_zona_asignada`). Un
`adminSatelite` sin zona **no ve nada**: ni «todo» ni «vacío silencioso».
*Consecuencia asumida:* un usuario mal configurado queda **bloqueado** en analítica hasta que
alguien le asigne zona; se acepta porque el fallo de configuración se vuelve visible en vez de
disfrazarse de «no hay datos». Fija **R13**.

**D3 (Q3) · «Propio» del mensajero ⇒ `orden.mensajero_asignado_id`,** siempre y para toda métrica.
Se elige por coherencia con el precedente ya escrito de la feature 159 (`db/schema.prisma:478`:
«unica fuente de verdad del mensajero de una orden»), y **conociendo** la consecuencia.
*Consecuencia asumida, sin disimulo:* en el caso decisivo —orden asignada a **A**, gestionada por
**A**, luego **reasignada a B**— **A pierde el crédito del trabajo que sí hizo** (sus gestiones
dejan de ser alcanzables por él) y **B pasa a ver una gestión que no ejecutó**. Las cinco métricas
`unidadDeConteo: "gestion"` de la 135 dejan de cuadrar con el trabajo real del mensajero cuando hay
reasignaciones. Se acepta a cambio de **una sola** columna de recorte en todo el lote y de no
contradecir a la 159. Fija **R7**, **R23**, **R24**, **R28** (los cuatro pierden la marca `⧗Q3`).

> ⚠ **Discrepancia registrada al aplicar D3.** El enunciado que acompañó a la decisión describía la
> consecuencia como «A sigue viendo la orden aunque ya no es suya, y B no la ve hasta gestionarla».
> Eso es lo que produce `gestion_orden.mensajero_id` (la opción NO elegida). Con la columna elegida,
> `orden.mensajero_asignado_id`, el efecto es el **simétrico**: A deja de verla y B la ve de
> inmediato. La spec fija el comportamiento de la **columna elegida** —que es lo que el humano
> decidió— y deja constancia de la discrepancia; la frase compartida por ambos enunciados, «A pierde
> el crédito del trabajo que sí hizo», se cumple en las dos lecturas y es la consecuencia que el
> humano declaró asumir. Si lo que se quería era la otra opción, esta nota es el punto de vuelta.

**D4 (Q4) · `adminSatelite` ve el grano `tienda` de su zona ⇒ SÍ.**
*Consecuencia asumida:* un `adminSatelite` compara el volumen de tiendas que no son suyas dentro de
su zona; es un cruce multi-tenant **deliberado**, justificado por su función operativa sobre la
zona. Fija **R37**.

**D5 (Q5) · `adminTienda` ve el grano `mensajero` ⇒ SÍ, PERO ANONIMIZADO.** Ve la **distribución**
de su propia carga por mensajero, **sin poder identificar a la persona**: etiqueta ordinal estable
dentro de la consulta o id opaco; **nunca** nombre, teléfono, correo ni el `uuid` real del
mensajero. Un `adminTienda` **no es empleador** de esos mensajeros.
*Consecuencia asumida:* el `adminTienda` no puede reclamar «el mensajero X me falla» con nombre y
apellido, ni cruzar la etiqueta con otra fuente; a cambio conserva la información de negocio (su
carga está repartida entre N repartidores y cómo). Requisito **duro**, no nota: fija **R38**
(positivo) y **R39** (negativo, con test de que el identificador real no cruza al cliente).

**D6 (Q6) · `mensajero` ve el grano `tienda` ⇒ SÍ.**
*Consecuencia asumida:* el mensajero sabe qué tiendas le dan trabajo y en qué volumen —dato
comercial de la operación— restringido siempre a sus propias órdenes. Fija **R37**.

> D4–D6 juntas significan: **no hay recorte de granos por rol**. El catálogo de la 135 no necesita
> campo nuevo y la 133 no tiene que declarar nada: el recorte es de **filas** (R26–R28) y, para el
> caso de D5, de **identidad** (R38/R39). Por eso R37 prohíbe expresamente una segunda tabla de
> granos por rol.

**D7 (Q7) · Traducción del denegado en el borde ⇒ EXPLÍCITO SIEMPRE.** El servicio devuelve
`forbidden` (patrón existente del repo) y el borde lo traduce a **403**; nunca `ok` con ceros.
*Consecuencia asumida:* la UI de la 133 debe manejar el 403 (no puede limitarse a pintar «sin
datos»), y un rol al que se le prohíbe una métrica lo sabrá. Fija **R41**.

**D8 (Q8) · Guardia de pureza ⇒ AMPLIAR EL GUARDIA DE LA 135.** Queda **autorizado** tocar
`tests/unit/analytics/modulo-puro.guardia.test.ts` para que inspeccione la clausura **transitiva**
de imports. **Un solo guardia**, sin duplicar. **No** se elige la opción (c): `lib/auth/acceso-total.ts:1`
sigue importando `RolValue` como valor.
*Consecuencia asumida:* la 122 toca un archivo de test de otra feature (excepción explícita a R33) y
la ampliación tiene que convivir con esa arista mediante una **allowlist nominal de una sola
entrada**, justificada y verificada empíricamente (importar la clausura sin `DATABASE_URL`). No es
un agujero porque la excepción es de **una arista concreta y un nombre concreto** (`RolValue`), no
de un archivo ni de un paquete, y porque la prueba empírica se mantiene por encima de la lista. Fija
**R35** y **R36**; **R33** se relaja solo para ese archivo.

**D9 (Q9) · `apiKey` y analítica ⇒ CONFIRMADO, NUNCA.** La cuenta de integración queda denegada
**por diseño**.
*Consecuencia asumida:* si algún día se quiere reporting por API, será **ficha propia** con su
puerta: no se cuela por aquí. Fija **R11** (con guardia).

**D10 (Q10) · Auditoría de denegados ⇒ SÍ, EN EL CANAL EXISTENTE.** El borde registra rol,
tienda/zona pedida y filtro rechazado por el mismo canal servidor que ya usan webhooks y crons.
**Canal verificado en código** (no inventado): la interfaz `ErrorLogger`
(`lib/errors/logger.ts:6-8`) con su implementación por defecto `ConsoleErrorLogger` (`:13-21`),
inyectable, que es la que reciben `withErrorHandler` (`lib/errors/with-error-handler.ts:10-19`) y
`normalizeError` (`lib/errors/normalize.ts:20`) en los seis crons y en el webhook de WhatsApp
(`app/api/cron/*/route.ts`, `app/api/webhooks/whatsapp/route.ts`). Es la lectura concreta de
`docs/conventions.md:22` («el canal definido»), que no nombra ninguno.
*Consecuencia asumida:* el rastro es `console.error` en el servidor (Vercel), no una tabla
auditable ni una alerta; sirve para investigar, no para reportar. Si se quiere auditoría persistente
será otra ficha. El módulo puro **sigue sin loguear** (R31/R34): el rastro lo emite el borde. Fija
**R40**, con la trampa de `normalizeError` documentada allí.

---

## Preguntas abiertas

**Ninguna: la puerta F1.4 se cerró el 2026-07-31** con las diez decisiones D1–D10 de arriba.

Único punto **derivado** (no preguntado, no inventado) que conviene revisar en el review: D5 decide
la seudonimización para `adminTienda` con la razón expresa «un `adminTienda` no es empleador de esos
mensajeros». Nadie preguntó por `adminSatelite` + grano `mensajero`. R38 le asigna política
**`real`** aplicando la misma razón al revés —el `adminSatelite` **sí** opera a los mensajeros de su
zona—, y la decisión queda aquí señalada para que el humano la confirme o la revierta sin tener que
releer la spec entera.
