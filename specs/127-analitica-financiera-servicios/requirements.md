# Feature 127 — analítica: servicios financieros · requirements

Backend. Repositorios + servicios + Server Actions que sirven **las ocho métricas de dominio
`financiera` que la 135 ya declaró** (`lib/analytics/metrics.ts:385-545`), leyendo **exclusivamente**
los tres ledgers append-only y los dos snapshots de cierre, con `ConsultaAnalitica` (122) como única
puerta de entrada.

Esta feature **no inventa métricas**: parte del catálogo. Lo que el catálogo declaraba y las fuentes
permitidas no podían servir se reportó como **contradicción declarada** (D6) y **ya está resuelto**.

---

## PUERTA T0 — CERRADA el 2026-08-02

Las nueve decisiones las contestó el humano el **2026-08-02** — con la excepción explícita de **D7**,
que se cerró **por implicación y no fue contestada directamente** (ver su ficha). Los requisitos de
abajo son afirmaciones cerradas: ninguno queda condicionado a una decisión pendiente.

---

### D1 — «COD recaudado» y anulaciones · **(c) AMBOS** · humano, 2026-08-02

Se sirven **`bruto` y `neto` en el mismo DTO**. El `neto` se deriva **por signo agregado**
(créditos − débitos, ingresos − egresos), **nunca** emparejando cada `ajuste_*` con el movimiento que
corrige.

*Por qué importa que quede escrito:* el ledger **no tiene puntero** del ajuste al original
(`specs/172-liquidacion/design.md §6.4`, N1 de `progress/current.md`). Inferir el emparejamiento por
`origen_tipo`/`origen_id` sería adivinar y produciría una cifra con aspecto de exacta. La resta con
signo, en cambio, **sí** es exacta y es la misma aritmética que ya usan `derivarSaldoTienda` y
`derivarCuentaPorPagar`. Servir los dos hace visible el problema abierto de la 172 en vez de
esconderlo. → **R16, R20, R37**

---

### D2 — Coordenada temporal · **(b)** · humano, 2026-08-02

- Las cinco métricas de ledger se fechan por **`fecha_movimiento`**.
- Las de cierre (`cod_recaudado` vista A, `conciliacion_cierres`) se fechan por **`resuelto_at`**.
- **Frontera día natural CR `[D 06:00Z, D+1 06:00Z)`** en todos los casos, la que produce
  `resolverRango`. Ninguna ventana temporal propia.

*Consecuencia asumida:* un cierre sin `resuelto_at` no tiene fecha con la que entrar en un rango de
dinero. Eso es exactamente lo que D4 resuelve. → **R26, R25, R22**

---

### D3 — Las cuentas por pagar son un SALDO · **(a) saldo al corte** · humano, 2026-08-02

`cuenta_por_pagar_tienda` y `cuenta_por_pagar_mensajero` se agregan con `fecha_movimiento < hasta`,
**ignorando `desde`**, y el DTO declara **`esAcumulado: true`**.

*Por qué:* el nombre lo fija el catálogo y dice «cuenta por pagar»; servir el flujo del periodo bajo
ese nombre es el error que se descubre cuando alguien paga de menos. La marca existe para que la 132
no la sume entre fechas ni la ponga en una serie acumulativa. → **R21, R43**

---

### D4 — Cierres no resueltos · **(b)** · humano, 2026-08-02

Los cierres `solicitado`, `vencido` y `rechazado` quedan **fuera de toda cifra de dinero** y **dentro
de `conciliacion_cierres`**, fechados por **`solicitado_at`** y con su estado. Las **dos coordenadas
temporales van declaradas en el DTO** (campo por fila), no implícitas. → **R25, R39**

---

### D5 — La conciliación · **(a)+(c) reportar y emitir** · humano, 2026-08-02

Devuelve `cuadra` + `diferencia` + cierres implicados, y **emite por el `ErrorLogger`** cuando la
diferencia supera un **umbral configurable** que vive en `lib/config/`, comentado como **provisional
y no medido** (patrón `lib/config/analitica-rollup.ts`). **La consulta nunca falla por un descuadre.**

*Por qué:* un módulo de analítica que lanza excepciones por el estado de los datos que mide es un
módulo que se acaba desactivando, y con él la comprobación que se quería ganar. → **R23, R24, R40**

---

### D6 — CONTRADICCIÓN DECLARADA, resuelta · **(a) dos vistas** · humano, 2026-08-02

El catálogo declara `cod_recaudado` con `granos: ["fecha","tienda","metodo_pago"]`, y ese cubo **no
existe** en las fuentes permitidas: el método de pago solo está en `cierre_dia.total_efectivo /
total_simpe / total_transferencia` (`db/schema.prisma:864-866`), y `cierre_dia` es de un **mensajero**
(`:860`), no de una tienda; el ledger de tienda, a su vez, **no tiene columna de método**.

Se sirven **dos vistas separadas con dos ids distintos**:

| id de vista | grano | fuente |
|---|---|---|
| `cod_recaudado__por_metodo` | fecha × método de pago | `cierre_dia` (`total_*`, resueltos) |
| `cod_recaudado__por_tienda` | fecha × tienda | `wallet_tienda_movimiento`, categoría `cod_recaudado` |

**La no-sumabilidad entre ambas es explícita en el DTO.** No suman por construcción: una es lo que el
mensajero entregó; la otra, lo acreditado a tiendas.

**El catálogo de la 135 NO se recorta:** `cod_recaudado` conserva sus tres granos. Lo que cambia es
que la 127 los sirve en dos vistas en vez de en un cubo imposible. → **R19, R38**

---

### D7 — Qué fuente manda en `cod_recaudado` · **(c) las dos, y la diferencia es la conciliación**

> ⚠ **RESUELTO POR IMPLICACIÓN, NO CONTESTADO DIRECTAMENTE.** El humano no respondió esta pregunta:
> se dio por cerrada al deducirla de **D6(a) + D5**, porque al servir de todos modos las dos fuentes,
> la diferencia entre ellas **es** `conciliacion_cierres`. Está avisado y **se reabre si no lo ve
> así**. Se deja marcada para que no parezca una respuesta más de la lista.

Consecuencia si se reabriera: cambiaría R23 (contra qué se concilia) y podría desaparecer una de las
dos vistas de R19. Nada más del contrato. → **R19, R23**

---

### D8 — `egresos` · **(b) la 127 la produce** · humano, 2026-08-02

La 127 sirve `egresos` (Σ de las ocho categorías `egreso_*` de `wallet_movimiento`) y **actualiza
`estadoProduccion` de `"declarada"` a `"producida"`** en `lib/analytics/metrics.ts`.

> **Esto es un cambio del catálogo de la 135, con visto bueno humano fechado el 2026-08-02.** No es un
> retoque de paso ni una consecuencia técnica: el catálogo se cambia con decisión humana fechada, y
> ésta lo es. Queda dicho aquí y en `design.md §2` para que el siguiente que lo lea no tenga que
> reconstruir de dónde salió. → **R18, R41**

---

### D9 — Cuerpo del 403 · **(c)** · humano, 2026-08-02

Al cliente le llega **`FORBIDDEN` genérico, sin motivo**. El motivo íntegro (dominio cerrado de
`MotivoDenegacion`) va a `describirDenegado` y al canal de auditoría que **R40 de la 122** ya obliga a
emitir. Así el cliente no puede sondear el catálogo ni los permisos, y el operador sí puede
investigar. Coincide con el borde que el guardia de la 122 ya declara correcto
(`tests/unit/analytics/alcance-bordes.guardia.test.ts:40-48`). → **R12, R42**

---

## Supuestos tomados (declarados, no preguntados) — todos siguen vigentes

- **S1.** Todo importe entra y sale como **STRING escala 2**, con `Prisma.Decimal` como única
  aritmética en el servidor. Convención money-safe vigente en 42/43/44/171; no se renegocia aquí.
- **S2.** La moneda se resuelve por `lib/config/moneda.ts`; ningún símbolo ni código se hardcodea.
- **S3.** Los Server Actions viven en `lib/actions/analitica-financiera.ts` y **no** en
  `lib/actions/analitica.ts`, que la ficha de la 126 reserva para lo operativo. Evita colisión de
  archivos entre dos features de la misma zona.
- **S4.** La 127 **no** añade caché: `cacheTag`/`revalidateTag` son de la 128, que depende de ésta.

Ninguna de las nueve decisiones invalida ni absorbe estos cuatro supuestos.

---

## Requisitos

43 requisitos. Cada uno con la **mutación concreta que lo pone rojo**: un test que no se pone rojo
cuando se muta lo que dice medir es una aserción vacía, no cobertura.

### A. Fuente exclusiva y fronteras heredadas

**R1.** El sistema DEBE derivar toda cifra financiera exclusivamente de `wallet_movimiento`,
`wallet_tienda_movimiento`, `pago_mensajero_movimiento`, `cierre_dia` y `cierre_bodega`.
*Mutación:* sustituir la agregación de `cod_recaudado` por una suma sobre `orden.montoCobrar` → el
guardia de fuente falla nombrando la tabla intrusa.

**R2.** El sistema **NO DEBE** leer `analytics_daily` por ninguna vía (Prisma o SQL crudo).
*Mutación:* añadir `prisma.analyticsDaily.groupBy(...)` en cualquier repositorio de la 127 → el
guardia R42 de la 124 (`tests/integration/db/analytics-daily-guards.test.ts`) se pone rojo.

**R3.** El sistema **NO DEBE** leer `orden`, `gestion_orden` ni `orden_historial_estado` en ningún
archivo de esta feature.
*Mutación:* resolver el nombre de la tienda con un `include: { orden: true }` → guardia rojo.

**R4.** Para cada métrica servida, el conjunto de tablas que su repositorio consulta DEBE estar
**contenido** en `metrica.fuente.tablas` del catálogo.
*Mutación:* hacer que el repositorio de `ingreso_flete` consulte también `cierre_dia` → el test de
correspondencia fuente↔consulta falla, porque `ingreso_flete` solo declara `wallet_movimiento`.

**R5.** SI el `metricaId` recibido no pertenece al dominio `financiera` del catálogo, ENTONCES el
servicio financiero DEBE devolver un resultado de error explícito y **NO DEBE** consultar ninguna
tabla.
*Mutación:* dejar que `entregas` caiga en una rama por defecto y se sirva con ceros → el test que pide
`entregas` al servicio financiero deja de ver el error y ve un `ok`.

**R6.** El sistema DEBE servir **las ocho** métricas de dominio `financiera` del catálogo, sin añadir
ni renombrar ninguna.
*Mutación:* añadir un id propio (`margen_bruto`) al servicio → el test que compara los ids servidos
contra `listarMetricas({ dominio: "financiera" })` falla por exceso; borrar `ingreso_iva`, por defecto.

### B. La puerta obligatoria: `ConsultaAnalitica`

**R7.** Toda función pública de repositorio y de servicio de esta feature DEBE aceptar
`ConsultaAnalitica` y **NO DEBE** aceptar `AnaliticaFiltroInput`, un rango suelto, un rol ni un
`usuarioId`.
*Mutación:* cambiar una firma a `(filtro: AnaliticaFiltroInput)` → deja de compilar (R17 de la 122) y
además cae `alcance-obligatorio.guardia.test.ts`.

**R8.** El sistema **NO DEBE** construir un adaptador de alcance (`where…`) para ninguna de las cinco
tablas de dinero.
*Mutación:* añadir `whereWalletTienda(alcance)` a `lib/analytics/alcance-columnas.ts` →
`alcance-dinero.guardia.test.ts` (R25 de la 122) se pone rojo por los dos lados.

**R9.** MIENTRAS el catálogo declare las ocho financieras como `total` para `maestro`/`admin` y
`prohibido` para los otros tres roles, el sistema **NO DEBE** contener ninguna rama que recorte una
cifra financiera por zona, tienda o mensajero del **actor**.
*Mutación:* recortar `cuenta_por_pagar_tienda` por `alcance.tiendaId` cuando el alcance no es global →
el test de R9 falla, porque con el catálogo vigente ese alcance es inalcanzable y la rama es código
muerto que anuncia un recorte no diseñado.

**R10.** CUANDO el punto de entrada devuelva `forbidden`, el sistema **NO DEBE** ejecutar ninguna
consulta a base de datos.
*Mutación:* mover la llamada al repositorio antes de la comprobación de `status` → el test con
repositorio espiado ve una llamada que no debía existir.

### C. Los tres pasos del borde (R40 / R41 / R39 de la 122)

**R11.** CUANDO el punto de entrada devuelva `forbidden`, el borde DEBE registrar el intento con una
llamada **explícita** a `ErrorLogger.logError(describirDenegado(...))`, **antes** de responder.
*Mutación:* sustituir la llamada explícita por `throw new ForbiddenError()` confiando en
`withErrorHandler` → el 403 sigue saliendo pero el espía del logger no recibe nada (la trampa que
`alcance-bordes.guardia.test.ts:143-158` ya tiene documentada).

**R12.** *(cerrado por D9)* CUANDO el punto de entrada devuelva `forbidden`, el borde DEBE responder
**403** con el cuerpo genérico `{ code: "FORBIDDEN" }`, y **NO DEBE** responder `ok` con ceros, lista
vacía ni 200.
*Mutación:* devolver `{ status: "ok", total: "0.00" }` ante `metrica_prohibida` → el test del borde
falla comparando el estado, no el cuerpo.

**R13.** CUANDO el punto de entrada devuelva `validation_error`, el borde DEBE responder **400** con
`fieldErrors` y **NO DEBE** auditar por el canal de denegados.
*Mutación:* auditar también los 400 → el test que envía `{ rango: "no_valido" }` ve una llamada al
logger que no debe ocurrir (y con ella se pierde la señal de los denegados reales entre el ruido).

**R14.** El sistema DEBE garantizar que **ninguna** respuesta financiera contiene un identificador de
mensajero: ni columna, ni clave, ni valor, ni anidado.
*Mutación:* añadir `mensajeroId` al DTO de `cuenta_por_pagar_mensajero` → el test que inspecciona la
**cadena serializada completa** (patrón R39 de la 122) encuentra el uuid y falla.
> Nota de diseño, no supuesto: la seudonimización (R38/R39 de la 122) es **inalcanzable** aquí —
> `adminTienda` es el único rol con política `seudonima` y tiene las ocho financieras `prohibido`.
> Por eso R14 no seudonimiza: **prohíbe el campo**, que es más fuerte y sí es verificable.

**R15.** El borde DEBE obtener el actor únicamente con `resolveActorFromSession()` y **NO DEBE** leer
la cookie de sesión por ningún otro camino.
*Mutación:* leer `cookies()` directamente en la acción → el guardia de origen del actor (censo de
`next/headers` fuera de `lib/auth/`) falla.

### D. Las ocho métricas

**R16.** *(cerrado por D1 y D2)* CUANDO se consulte `ingreso_flete`, `ingreso_comision_cod` o
`ingreso_iva`, el sistema DEBE devolver la Σ de `wallet_movimiento.monto` de **exactamente** las
categorías que la métrica declara en `definicion.categorias`, con `fecha_movimiento` dentro de
`[rango.desde, rango.hasta)`, **en sus dos campos `bruto` y `neto`**.
*Mutación:* incluir `ingreso_ajuste` en `ingreso_flete` → el test con un movimiento de ajuste en el
rango ve el `bruto` inflado.

**R17.** El sistema DEBE tomar la lista de categorías de cada métrica **del catálogo**
(`metrica.definicion.categorias`) y **NO DEBE** repetirla escrita a mano en el repositorio ni en el
servicio.
*Mutación:* clavar el array `["ingreso_flete","ingreso_flete_devolucion"]` en el repositorio → el test
que altera la definición del catálogo en memoria y espera que la consulta cambie no ve el cambio.

**R18.** *(cerrado por D8)* CUANDO se consulte `egresos`, el sistema DEBE devolver la Σ de **las ocho**
categorías `egreso_*` declaradas por el catálogo, y **NO DEBE** devolver un estado `no_producida`.
*Mutación:* omitir `egreso_indemnizacion` de la suma → el test con una indemnización en el rango ve
la cifra corta.

**R19.** *(cerrado por D6 y D7)* CUANDO se consulte `cod_recaudado`, el sistema DEBE servir **dos
vistas**: `cod_recaudado__por_metodo` (fecha × método, desde los `total_*` de los `cierre_dia`
**resueltos** del rango) y `cod_recaudado__por_tienda` (fecha × tienda, desde el crédito
`cod_recaudado` de `wallet_tienda_movimiento`).
*Mutación:* devolver una sola cifra que sume las dos vistas → el test del cierre de un mensajero con
órdenes de dos tiendas ve el doble del dinero real.

**R20.** *(cerrado por D1)* CUANDO se consulte `cuenta_por_pagar_tienda` o
`cuenta_por_pagar_mensajero`, el sistema DEBE derivar el importe **reutilizando** `derivarSaldoTienda`
(`lib/utils/saldo-tienda.ts`) y `derivarCuentaPorPagar` (`lib/utils/cuenta-por-pagar.ts`), que son las
que producen el `neto` por signo, y **NO DEBE** reimplementar la resta.
*Mutación:* calcular `creditos - debitos` a mano en el servicio → el test que compara el resultado del
servicio contra la función compartida, para un caso de signo negativo, falla en el `signo`.

**R21.** *(cerrado por D3)* La cuenta por pagar DEBE agregarse con `fecha_movimiento < rango.hasta`
**sin cota inferior**, ignorando `rango.desde`.
*Mutación:* añadir `fecha_movimiento >= rango.desde` → el test con un devengo anterior al rango ve el
saldo mutilado.

**R22.** *(cerrado por D2 y D4)* CUANDO se consulte `conciliacion_cierres`, el sistema DEBE devolver,
por cada estado de `CierreEstado` (`solicitado`, `aprobado`, `rechazado`, `vencido`), el **conteo** de
cierres y sus `total_*` snapshot, para `cierre_dia` y `cierre_bodega` **por separado**.
*Mutación:* fundir los dos niveles de cierre en un solo total → el test con un `cierre_bodega` que
consolida tres `cierre_dia` ve el dinero contado dos veces.

**R23.** *(cerrado por D5 y D7)* `conciliacion_cierres` DEBE comparar los `total_*` de los cierres
**aprobados** del rango (por `resuelto_at`) contra lo registrado en los ledgers con
`origen_tipo = cierre_dia` y `origen_id` de **esos** cierres, y DEBE devolver `cuadra`, `diferencia` y
los ids de los cierres descuadrados.
*Mutación:* comparar contra la Σ de **todos** los movimientos del rango en vez de los de ese origen →
el test con un ajuste manual dentro del rango declara un descuadre que no existe.

**R24.** *(cerrado por D5)* SI la diferencia de conciliación supera el umbral configurado, ENTONCES el
sistema DEBE emitirla por el `ErrorLogger` y **NO DEBE** lanzar, degradar ni vaciar el resultado.
*Mutación:* lanzar un error → el test con datos descuadrados deja de recibir el DTO y recibe una
excepción; el tablero quedaría caído.

**R25.** *(cerrado por D4)* Los cierres **no resueltos** (`solicitado`, `vencido`, `rechazado`)
**NO DEBEN** aportar importe a ninguna métrica de dinero, pero **DEBEN** aparecer en
`conciliacion_cierres` con su estado, fechados por `solicitado_at`.
*Mutación:* sumar `total_general` de los `solicitado` a `cod_recaudado` → el test del cierre pendiente
ve dinero que aún no existe, y el mismo test tras aprobarlo lo ve **dos veces**.

**R26.** *(cerrado por D2)* El sistema DEBE fechar las cinco métricas de ledger por
`fecha_movimiento` y las dos de cierre por `resuelto_at`, siempre con la frontera de día natural CR
que produce `resolverRango`, sin construir ninguna ventana temporal propia.
*Mutación:* usar `new Date(fecha)` (medianoche UTC) en vez de `rango.desde` → el test del movimiento
de las 22:00 CR del día anterior lo mete en el día equivocado (el off-by-one de 6 horas del repo).
Segunda mutación: fechar los cierres por `solicitado_at` → el test del cierre solicitado el lunes y
aprobado el miércoles lo cuenta en la semana equivocada.

### E. Money-safe, determinismo y capas

**R27.** El sistema **NO DEBE** representar ningún importe como `number` en ningún punto: entrada,
agregación, DTO y serialización usan STRING escala 2 con `Prisma.Decimal` como aritmética.
*Mutación:* `parseFloat` en la agregación → el test con `0.1 + 0.2` (o con un total de 7 dígitos) ve
un importe con error de coma flotante.

**R28.** Dadas la misma consulta y los mismos datos, el sistema DEBE producir exactamente la misma
salida: **sin** `Date.now()`, `Math.random()` ni orden dependiente de la base.
*Mutación:* quitar el `orderBy` de un listado agregado → el test que ejecuta dos veces y compara el
orden de las filas falla de forma reproducible con más de una fila.

**R29.** El sistema **NO DEBE** hardcodear moneda, país ni símbolo: se resuelven por
`lib/config/moneda.ts`.
*Mutación:* escribir `"₡"` en un DTO → el guardia de literales de moneda falla.

**R30.** Los repositorios DEBEN contener **solo** consultas Prisma, sin derivación de negocio; los
servicios **NO DEBEN** conocer Prisma ni HTTP; los Server Actions **NO DEBEN** contener consultas.
*Mutación:* mover `derivarSaldoTienda` dentro del repositorio → el test que instancia el servicio con
un repositorio mock y espera la derivación **en el servicio** falla.

**R31.** Toda dependencia DEBE entrar por interfaz en `lib/interfaces/{repositories,services}/`, de
modo que cada servicio sea testeable sin base de datos.
*Mutación:* instanciar el repositorio concreto dentro del servicio → el test unitario del servicio
pasa a exigir `DATABASE_URL` y falla en CI sin base.

**R32.** El sistema **NO DEBE** silenciar errores: ningún `catch` vacío; un fallo de consulta se
propaga con contexto (qué métrica, qué rango) y **sin** filtrar ids ajenos ni PII.
*Mutación:* envolver la consulta en `try { } catch { return "0.00" }` → el test que fuerza el fallo
del repositorio ve un cero en vez de un error, que es la peor mentira posible en dinero.

### F. Guardias estructurales (lo que los tipos no alcanzan)

**R33.** El sistema DEBE incluir un guardia que falle si algún archivo de esta feature nombra una
tabla **fuera** del universo permitido (`TablaDinero` de `lib/analytics/types.ts`), incluido en
`$queryRaw`.
*Mutación:* meter `FROM orden` dentro de un template de `$queryRaw` → el guardia lo detecta por la
ventana de texto del patrón ya usado en `alcance-obligatorio.guardia.test.ts:80-83`.

**R34.** El guardia de R33 DEBE **autocomprobarse** con fixtures (uno legítimo y al menos dos
infractores, uno de ellos con SQL crudo) para no quedar verde por vacío.
*Mutación:* aflojar el detector para que acepte al infractor de SQL crudo → el fixture infractor pasa
a devolver `null` y su propio test falla.

**R35.** El sistema DEBE incluir un guardia que compare, métrica a métrica, el `alcance` del catálogo
contra lo que el servicio sirve, y falle si alguna financiera dejara de ser `total`/`prohibido`.
*Mutación:* cambiar `adminTienda: "prohibido"` por `"acotado"` en `ALCANCE_FINANCIERA` → el guardia se
pone rojo, que es exactamente el aviso de la 122: hay que **diseñar el recorte del dinero antes** de
tocar la métrica.

**R36.** Cada requisito `R1`–`R43` DEBE tener al menos un test nombrado por el comportamiento (no por
la función) y mapeado en `progress/impl_127.md`.
*Mutación:* borrar el mapa o dejar un `R` sin test → el reviewer lo marca como hallazgo bloqueante
(`docs/verification.md`, regla del reviewer).

### G. Consecuencias directas de la puerta T0 (requisitos nuevos, 2026-08-02)

**R37.** *(D1)* Toda métrica de ledger DEBE devolver **dos** importes en el mismo DTO: `bruto` (Σ de
las categorías nominales) y `neto` (Σ con signo: créditos − débitos / ingresos − egresos). El `neto`
**NO DEBE** derivarse emparejando un movimiento `ajuste_*` con el movimiento que corrige.
*Mutación:* devolver `neto === bruto` copiando el campo → el test del par pago + contraasiento
`ajuste_*` en el mismo rango ve `neto` distinto de cero cuando debería cancelarse. Segunda mutación:
implementar el emparejamiento por `origen_id` → el test del ajuste manual (`origen_id NULL`) revienta
o produce un neto arbitrario.

**R38.** *(D6)* Las dos vistas de `cod_recaudado` DEBEN llevar **ids distintos**
(`cod_recaudado__por_metodo`, `cod_recaudado__por_tienda`) y DEBEN declararse **mutuamente no
sumables** en el DTO (`sumableCon` vacío entre ellas).
*Mutación:* declarar `sumableCon: ["cod_recaudado__por_tienda"]` en la vista por método → el test de
no-sumabilidad falla; y con él caería el único aviso que impide que la primera pantalla que las pinte
juntas las sume.

**R39.** *(D4)* Cada fila de `conciliacion_cierres` DEBE declarar **explícitamente** su coordenada
temporal (`fechadoPor: "resuelto_at" | "solicitado_at"`), de modo que la doble convención sea un dato
del DTO y no un conocimiento implícito del consumidor.
*Mutación:* eliminar el campo, o clavarlo a `"resuelto_at"` para todas las filas → el test del cierre
`solicitado` (que no tiene `resuelto_at`) ve una coordenada que su fila no puede tener.

**R40.** *(D5)* El umbral de descuadre DEBE vivir en **un único** archivo de `lib/config/`, con un
comentario que declare que es **provisional y no está medido**, y **NO DEBE** aparecer como literal en
ningún servicio ni repositorio.
*Mutación:* escribir el número directamente en el servicio → el test que censa literales de umbral
fuera del archivo de configuración falla; y ajustarlo dejaría de ser un one-liner con su test para
volverse una cacería de números sueltos.

**R41.** *(D8)* El catálogo DEBE declarar `egresos` con `estadoProduccion: "producida"`, y **ninguna**
métrica de dominio `financiera` DEBE quedar como `declarada` sin productor al cerrar esta feature.
*Mutación:* revertir `egresos` a `"declarada"` dejando el servicio sirviéndola → el test que cruza
`listarMetricas({ dominio: "financiera", estadoProduccion: "declarada" })` contra los ids que el
servicio produce encuentra una incoherencia entre catálogo y realidad.

**R42.** *(D9)* La respuesta que cruza al cliente ante un `forbidden` **NO DEBE** contener ninguno de
los siete literales de `MotivoDenegacion`, y el registro emitido por el `ErrorLogger` **SÍ** DEBE
contenerlo.
*Mutación:* propagar `motivo` al cuerpo de la respuesta → el test que inspecciona la cadena
serializada encuentra `metrica_prohibida` y falla; el cliente podría sondear qué métricas existen y
qué ve cada rol.

**R43.** *(D3)* El campo `esAcumulado` DEBE ser `true` **exactamente** en `cuenta_por_pagar_tienda` y
`cuenta_por_pagar_mensajero`, y `false` en las otras seis financieras.
*Mutación:* poner `esAcumulado: true` en `ingreso_flete` (o `false` en una cuenta por pagar) → el test
que recorre las ocho métricas y compara el mapa exacto falla; sin él, la 132 podría graficar un saldo
como serie acumulativa y sumar el mismo dinero N veces.

---

## Preguntas abiertas (revisadas tras la puerta T0; las cuatro primeras siguen vivas)

1. **¿Existe un caso real de `cierre_bodega` con `total_*` distintos de la suma de sus `cierre_dia`?**
   Si nunca puede pasar por construcción, la conciliación de nivel bodega es redundante y R22 se
   simplifica. **D4 y D5 la vuelven más urgente, no menos:** ahora la conciliación es una cifra que se
   emite por el `ErrorLogger`, y un descuadre estructural entre niveles la haría gritar todos los días.
   No lo pude determinar leyendo `CierreBodegaService`; no lo supongo.
2. **`total_ingreso_bodega_rechazos` y `total_pago_mensajero`** son snapshots de cierre que **ninguna**
   de las ocho métricas del catálogo nombra. ¿Se quedan fuera (y el tablero financiero no los ve
   nunca), o son métrica nueva que exige decisión del catálogo? **D8 sienta el precedente** de cómo se
   toca el catálogo (decisión humana fechada), pero no contesta esta pregunta.
3. **`SINPE` vs `simpe`.** La ficha y la descripción del catálogo escriben «SINPE»; la columna real es
   `total_simpe`. **D6(a) la vuelve visible**, porque `cod_recaudado__por_metodo` sirve exactamente
   esos tres cubos y su etiqueta la hereda el CSV de la 134. Cosmético, pero hay que fijarlo.
4. **Retención / volumen.** Un rango `personalizado` admite hasta 366 días (`RANGO_TOPE_DIAS`) y esta
   feature agrega sin `LIMIT` por definición. Nadie ha medido el ledger a un año. **D3 la agrava un
   poco**: el saldo al corte ignora `desde`, así que escanea **todo** el libro hasta `hasta`, no solo
   la ventana. ¿Se mide antes de exponerlo, o se acepta y se observa con la 128?
5. **Cinco de las ocho métricas se sirven sin desglose por día, pese a declarar `granos: ["fecha"]`.**
   *(Añadida al IMPLEMENTAR, 2026-08-02 — era el supuesto **S16** de `progress/impl_127_D.md`, y sube
   aquí por el menor 3 del review: una limitación de este tamaño no puede vivir solo en una bitácora.)*
   `ingreso_flete`, `ingreso_comision_cod`, `ingreso_iva`, `egresos` y las dos cuentas por pagar llegan
   con `filas: []` y solo `total`, porque `DimensionAnalitica` no tiene «categoría» y el repositorio
   agrega la ventana entera de una vez. **No viola ningún requisito** —ninguno exige el corte— pero
   tiene dos consecuencias que el siguiente que lea esto necesita ver:
   - **La 132 no podrá pintar serie temporal de esas cinco.** Si el tablero las quiere como línea y no
     como número único, hay que rediseñar C.1 y C.3 para agrupar por día. Eso **no** está en el
     `design.md` actual y no se hizo de paso.
   - **El barrido de identidad de E.4 es trivial para esas cinco**, porque un DTO sin filas casi no
     tiene por dónde filtrar un id. La cobertura real de R14 se apoya en las tres que **sí** traen
     filas (`cod_recaudado` en sus dos vistas y `conciliacion_cierres`) — que es, no por casualidad,
     donde apareció la fuga C8. Si alguna de esas cinco gana filas, **su barrido deja de ser trivial y
     hay que volver a mirarlo**.
