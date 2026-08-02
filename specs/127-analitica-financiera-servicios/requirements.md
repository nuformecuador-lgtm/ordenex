# Feature 127 — analítica: servicios financieros · requirements

Backend. Repositorios + servicios + Server Actions que sirven **las ocho métricas de dominio
`financiera` que la 135 ya declaró** (`lib/analytics/metrics.ts:385-545`), leyendo **exclusivamente**
los tres ledgers append-only y los dos snapshots de cierre, con `ConsultaAnalitica` (122) como única
puerta de entrada.

Esta feature **no inventa métricas**: parte del catálogo. Lo que el catálogo declara y las fuentes
permitidas no pueden servir se reporta abajo como **contradicción declarada** (§ PUERTA T0), no se
maquilla.

---

## PUERTA T0 — decisiones que necesitan al humano

Ninguna de estas la puede tomar el spec_author: o son de producto (qué significa una cifra de
dinero), o son contradicciones entre el catálogo y el esquema real. **Se contestan antes de escribir
una línea de código.** Cada `R` que dependa de una decisión lo dice explícitamente.

---

### D1 — «COD recaudado» cuando hay anulaciones: ¿bruto, neto o ambos?

El ledger es append-only: una corrección no borra, **compensa** con `ajuste_credito` /
`ajuste_debito` / `ajuste_devengo` / `ajuste_pago`. La 172 (`specs/172-liquidacion/design.md §6.4`,
N1 en `progress/current.md`) ya dejó abierto el problema hermano: el par pago + anulación deja el
**saldo exacto pero los importes brutos inflados**, porque el contraasiento cae en una categoría
`ajuste_*` distinta de la original.

| Opción | Consecuencia real |
|---|---|
| (a) **Bruto** — sumar solo las categorías nominales de cada métrica | «COD recaudado» y «pagado a tiendas» cuentan movimientos que ya fueron revertidos; el tablero financiero muestra más dinero del que se movió. Consistente con lo que hoy ve `/wallet/tiendas` (171) |
| (b) **Neto** — restar los `ajuste_*` de la métrica que corrigen | La cifra cuadra con la realidad, pero **el ledger no dice qué corrige cada ajuste**: `ajuste_credito` no lleva puntero a la fila original. Netear exige o dos valores de enum nuevos (migración sobre tabla append-only con datos en producción) o inferir por `origen_tipo/origen_id`, que es adivinar |
| (c) **Ambos** — servir `bruto` y `neto` como dos campos del mismo DTO | El consumidor decide y la diferencia queda visible (es, de hecho, un indicador de calidad). Cuesta un campo más por métrica y un `neto` que hoy solo puede calcularse por el signo agregado (créditos − débitos), no por trazabilidad fila a fila |

**Recomendación: (c), con `neto` derivado por signo agregado y NO por emparejamiento.** Es lo único
honesto con el esquema vigente: la resta crédito − débito **sí** es exacta (es la misma aritmética
que ya usan `derivarSaldoTienda` y `derivarCuentaPorPagar`), mientras que decir «este ajuste anula
aquel movimiento» hoy sería inventado. Servir los dos hace visible el problema de la 172 en vez de
esconderlo detrás de una cifra sola que nadie sabe cómo interpretar.

---

### D2 — ¿Qué instante fecha cada métrica financiera, y con qué frontera?

Los ledgers tienen `fecha_movimiento` (timestamp). Los cierres **no tienen fecha de negocio**:
`cierre_dia` tiene `solicitado_at` y `resuelto_at` (`db/schema.prisma:870-872`), que pueden caer en
días distintos. `resolverRango` produce `[desde, hasta)` con frontera **día natural CR**
(`...T06:00:00.000Z`), la del rollup.

| Opción | Consecuencia real |
|---|---|
| (a) Ledgers por `fecha_movimiento`, cierres por `solicitado_at`, frontera CR 06:00Z | Una sola convención temporal en toda la analítica; el cierre se cuenta el día en que el mensajero lo pidió (que es el día que trabajó) |
| (b) Cierres por `resuelto_at` | El dinero aparece el día en que el admin aprobó, que puede ser dos días después; casa con el instante en que el ledger recibió los movimientos (el feed dispara al aprobar) y por tanto **ledger y cierre cuadrarían por fecha** |
| (c) Frontera del cierre (el corte diario operativo) en vez del día natural CR | Exige que la 127 conozca la ventana del corte; hoy no hay una columna que la exprese |

**Recomendación: (b) para `conciliacion_cierres` y `cod_recaudado`, (a) para las cinco de ledger,
frontera CR 06:00Z en todos los casos.** Razón concreta: si el cierre se fecha por `solicitado_at` y
el ledger por `fecha_movimiento` (que nace al aprobar), un cierre solicitado el lunes y aprobado el
miércoles hace que la conciliación del lunes **nunca cuadre** — y esa discrepancia sería puro
artefacto de fechado, no un problema de dinero. Con (b) las dos caras miran el mismo instante.
**Consecuencia asumida que hay que aceptar explícitamente:** un cierre `solicitado` o `vencido` no
tiene `resuelto_at` y por tanto **no tiene fecha** con la que entrar en ningún rango → ver D4.

---

### D3 — Las dos cuentas por pagar son un SALDO, no un flujo: ¿qué hace el rango con ellas?

`cuenta_por_pagar_tienda` y `cuenta_por_pagar_mensajero` son acumulados (Σ crédito − Σ débito sobre
**todo** el libro, que es como las derivan la 43 y la 44). El catálogo les asigna grano `fecha`.

| Opción | Consecuencia real |
|---|---|
| (a) **Saldo a la fecha de corte**: ignorar `desde`, aplicar `fecha_movimiento < hasta` | Es la cifra que la gente entiende por «lo que debemos». No es sumable entre fechas y el tablero no debe graficarla como serie acumulativa |
| (b) **Flujo del periodo**: aplicar `[desde, hasta)` completo | Responde «cuánta deuda se generó esta semana», que es una pregunta distinta y también útil; pero llamarlo «cuenta por pagar» induce a error: nadie debe la deuda *de la semana*, se debe el acumulado |
| (c) Servir las dos (`saldoAlCorte` + `variacionDelPeriodo`) | Cubre ambas lecturas; duplica la consulta (dos agregaciones) y obliga a la UI a explicar la diferencia |

**Recomendación: (a), y que el DTO declare `esAcumulado: true`.** El nombre de la métrica lo fija el
catálogo y dice «cuenta por pagar»; servir un flujo bajo ese nombre es la clase de error que se
descubre cuando alguien paga de menos. La marca en el DTO existe para que la 132 no la sume entre
fechas ni la ponga en una serie temporal.

---

### D4 — Cierres **no resueltos** dentro del rango consultado

Con D2-(b), un cierre `solicitado` o `vencido` no tiene `resuelto_at`. Y su dinero (los `total_*`)
existe, pero **todavía no entró a ningún ledger**: el feed dispara al aprobar.

| Opción | Consecuencia real |
|---|---|
| (a) **Excluirlos** de toda métrica financiera | Las cifras solo cuentan dinero confirmado; un día con 10 cierres pendientes se ve vacío y nadie sabe por qué |
| (b) **Excluirlos del dinero pero contarlos en `conciliacion_cierres`** por `solicitado_at`, con su estado | La conciliación cumple su función real: *avisar de que hay dinero en el aire*. El dinero sigue siendo solo el confirmado |
| (c) Incluir sus `total_*` en `cod_recaudado` | El COD «recaudado» incluiría cierres que aún podrían rechazarse; y sumaría el mismo dinero dos veces el día que se aprueben |

**Recomendación: (b).** Es la única que no miente en ninguna de las dos direcciones. `conciliacion_cierres`
pasa a tener **dos coordenadas temporales declaradas** (los resueltos por `resuelto_at`, los pendientes
por `solicitado_at`) y eso va escrito en el DTO, no implícito.

---

### D5 — La conciliación, ¿**reporta** discrepancias o **falla**?

«Conciliar» es comparar los `total_*` snapshot de los cierres aprobados de un rango contra lo que los
ledgers registraron por esos mismos cierres (`origen_tipo = cierre_dia`, `origen_id = cierre.id`).

| Opción | Consecuencia real |
|---|---|
| (a) **Reportar**: el DTO devuelve `cuadra: boolean` + la diferencia + los cierres implicados | La analítica es de lectura: nunca tumba una pantalla por un dato viejo. El riesgo es que el descuadre se vea y nadie actúe |
| (b) **Fallar** la consulta (error) cuando no cuadra | Imposible ignorarlo, pero un descuadre histórico de hace seis meses deja el tablero financiero **permanentemente caído**, y la reacción probable es apagar la comprobación |
| (c) Reportar + emitir por el `ErrorLogger` cuando la diferencia supere un umbral configurable | Deja rastro investigable sin romper la lectura. Cuesta una constante en `lib/config/` que nadie ha medido |

**Recomendación: (a) + (c) con el umbral en `lib/config/`**, comentado como provisional (mismo patrón
que `lib/config/analitica-rollup.ts`). Un módulo de *analítica* que lanza excepciones por el estado de
los datos que mide es un módulo que se acaba desactivando.

---

### D6 — CONTRADICCIÓN DECLARADA: `cod_recaudado` no es servible en el grano que declara

El catálogo declara `granos: ["fecha", "tienda", "metodo_pago"]` y fuente
`["cierre_dia", "wallet_tienda_movimiento"]` (`lib/analytics/metrics.ts:391-405`). El esquema dice:

- El **método de pago** solo existe desagregado en `cierre_dia.total_efectivo / total_simpe /
  total_transferencia` (`db/schema.prisma:864-866`). El ledger de tienda **no tiene columna de método**.
- La **tienda** no existe en `cierre_dia`: un cierre es de un **mensajero**
  (`cierre_dia.mensajero_id`), y sus órdenes pueden ser de varias tiendas.

⇒ El cubo (tienda × método de pago) **no se puede construir con las fuentes permitidas**. Cruzarlo
exigiría bajar a `gestion_orden`/`orden`, que es exactamente lo que la consigna prohíbe.

| Opción | Consecuencia real |
|---|---|
| (a) Servir **dos vistas separadas**: `cod_recaudado` por (fecha × método) desde `cierre_dia`, y `cod_recaudado` por (fecha × tienda) desde `wallet_tienda_movimiento.cod_recaudado` | Ambas correctas, ambas de fuente legal, y **no suman lo mismo por construcción** (una es lo que el mensajero entregó, la otra lo acreditado a tiendas). Hay que explicarlo en la UI |
| (b) Recortar el catálogo: quitar el grano `tienda` de `cod_recaudado` | Una sola cifra sin ambigüedad, pero se pierde «cuánto COD es de cada tienda», que es una pregunta legítima y **sí** es servible por el ledger de tienda |
| (c) Añadir método de pago al ledger de tienda | Migración + backfill sobre tabla append-only con datos en producción. Fuera del alcance de una feature de lectura |

**Recomendación: (a), con dos ids distintos en el DTO y la advertencia de no-sumabilidad explícita.**
Es lo que el esquema permite decir con verdad. Si el humano prefiere (b), hay que **modificar el
catálogo de la 135**, que es decisión suya y fechada, no un retoque de paso.

---

### D7 — `cod_recaudado` tiene DOS fuentes que pueden diferir: ¿cuál manda?

Ligado a D6 pero distinto. El mismo hecho («se recaudó COD») está en `cierre_dia.total_general`
(snapshot congelado al solicitar) y en `wallet_tienda_movimiento` categoría `cod_recaudado`
(escrito al aprobar). Pueden diferir: rechazos, indemnizaciones, ajustes posteriores.

| Opción | Consecuencia real |
|---|---|
| (a) Manda el **snapshot del cierre** | Es lo que el mensajero declaró y el admin aprobó: el documento |
| (b) Manda el **ledger de tienda** | Es lo que efectivamente se acreditó a alguien: el dinero |
| (c) Se sirven las dos y la diferencia es, precisamente, `conciliacion_cierres` | La discrepancia deja de ser un bug oculto y pasa a ser la métrica |

**Recomendación: (c).** Es coherente con D5 y con el hecho de que el catálogo cite **las dos** tablas
en la misma métrica: el propio catálogo ya está diciendo que aquí hay dos caras.

---

### D8 — `egresos` está `estadoProduccion: "declarada"`: ¿la produce la 127 o no?

El propio catálogo anota que «la ficha de la 127 compromete ingresos, cuentas por pagar y
conciliación; los egresos NO aparecen ahí» (`lib/analytics/metrics.ts:462-464`).

| Opción | Consecuencia real |
|---|---|
| (a) **No producirla**: el servicio devuelve un estado explícito `no_producida` | Honesto y barato. La 132 tiene que saber pintar ese estado (y no un cero) |
| (b) **Producirla**: es una agregación por categoría sobre `wallet_movimiento`, la misma forma que los tres ingresos | Coste marginal muy bajo (mismo repositorio, mismas 8 categorías `egreso_*`), y sin ella el tablero financiero no tiene el otro lado de la caja |

**Recomendación: (b), y actualizar `estadoProduccion` a `producida` en el catálogo como parte de esta
feature.** Servir ingresos sin egresos deja un tablero que solo sabe sumar. El cambio de una línea en
`metrics.ts` es un cambio del catálogo, así que **necesita este visto bueno**, no se hace de paso.

---

### D9 — Qué ve el cliente en un 403 de métrica financiera prohibida

La 122 ya decidió lo grueso (R41): `forbidden` → **403**, nunca `ok` con ceros, nunca `200` con
`data: []`. Lo que queda abierto es el **cuerpo**.

| Opción | Consecuencia real |
|---|---|
| (a) Código genérico `FORBIDDEN`, sin motivo | No revela si la métrica existe ni por qué se denegó; la 133 solo puede decir «no tenés acceso» |
| (b) Motivo literal del dominio cerrado de la 122 (`metrica_prohibida`, `metrica_desconocida`, `sin_zona_asignada`…) | La UI puede distinguir «no existe» de «no podés» y «tu usuario no tiene zona» — este último es un **fallo de configuración** que hoy se vería como un genérico |
| (c) (a) hacia el cliente + (b) completo en el log de auditoría | El cliente no puede sondear el catálogo; el operador sí puede investigar |

**Recomendación: (c).** El motivo va íntegro a `describirDenegado` (que R40 ya obliga a emitir) y al
cliente le llega el código genérico. Coincide con el borde que el guardia de la 122 ya declara
correcto (`tests/unit/analytics/alcance-bordes.guardia.test.ts:40-48`, `body: { code: "FORBIDDEN" }`).

---

## Supuestos tomados (declarados, no preguntados)

- **S1.** Todo importe entra y sale como **STRING escala 2**, con `Prisma.Decimal` como única
  aritmética en el servidor. Es la convención money-safe ya vigente en 42/43/44/171 y no se
  renegocia aquí.
- **S2.** La moneda se resuelve por `lib/config/moneda.ts`; ningún símbolo ni código se hardcodea.
- **S3.** Los Server Actions de esta feature viven en `lib/actions/analitica-financiera.ts` y **no**
  en `lib/actions/analitica.ts`, que la ficha de la 126 reserva para lo operativo. Evita colisión de
  archivos entre dos features de la misma zona.
- **S4.** La 127 **no** añade caché: `cacheTag`/`revalidateTag` son de la 128, que depende de ésta.

---

## Requisitos

### A. Fuente exclusiva y fronteras heredadas

**R1.** El sistema DEBE derivar toda cifra financiera exclusivamente de `wallet_movimiento`,
`wallet_tienda_movimiento`, `pago_mensajero_movimiento`, `cierre_dia` y `cierre_bodega`.
*Mutación que lo pone rojo:* sustituir la agregación de `cod_recaudado` por una suma sobre
`orden.montoCobrar` → el guardia de fuente falla nombrando la tabla intrusa.

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
*Mutación:* dejar que `entregas` caiga en la rama por defecto y se sirva con ceros → el test que pide
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

**R12.** CUANDO el punto de entrada devuelva `forbidden`, el borde DEBE responder **403** (o el estado
equivalente de Server Action) y **NO DEBE** responder `ok` con ceros, lista vacía ni 200.
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
> Nota de diseño, no supuesto: la seudonimización (R38/R39) es **inalcanzable** en esta feature —
> `adminTienda` es el único rol con política `seudonima` y tiene las ocho financieras `prohibido`.
> Por eso R14 no seudonimiza: **prohíbe el campo**, que es más fuerte y sí es verificable.

**R15.** El borde DEBE obtener el actor únicamente con `resolveActorFromSession()` y **NO DEBE** leer
la cookie de sesión por ningún otro camino.
*Mutación:* leer `cookies()` directamente en la acción → el guardia de origen del actor (censo de
`next/headers` fuera de `lib/auth/`) falla.

### D. Las ocho métricas

**R16.** CUANDO se consulte `ingreso_flete`, `ingreso_comision_cod` o `ingreso_iva`, el sistema DEBE
devolver la Σ de `wallet_movimiento.monto` de **exactamente** las categorías que la métrica declara en
`definicion.categorias`, con `fecha_movimiento` dentro de `[rango.desde, rango.hasta)`.
*Mutación:* incluir `ingreso_ajuste` en `ingreso_flete` → el test con un movimiento de ajuste en el
rango ve la cifra inflada.

**R17.** El sistema DEBE tomar la lista de categorías de cada métrica **del catálogo**
(`metrica.definicion.categorias`) y **NO DEBE** repetirla escrita a mano en el repositorio ni en el
servicio.
*Mutación:* clavar el array `["ingreso_flete","ingreso_flete_devolucion"]` en el repositorio → el test
que altera la definición del catálogo en memoria y espera que la consulta cambie no ve el cambio.

**R18.** CUANDO se consulte `egresos`, el sistema DEBE comportarse según **D8**: con D8-(b), devolver
la Σ de las ocho categorías `egreso_*` declaradas; con D8-(a), devolver un estado explícito
`no_producida`.
*Mutación (D8-b):* omitir `egreso_indemnizacion` de la suma → el test con una indemnización en el
rango ve la cifra corta. *Mutación (D8-a):* devolver `"0.00"` en vez del estado → el test distingue
cero de no-producida y falla.

**R19.** CUANDO se consulte `cod_recaudado`, el sistema DEBE servir las **dos vistas** de **D6**
(por método de pago desde los `total_*` del cierre; por tienda desde el crédito `cod_recaudado` del
ledger de tienda) y DEBE marcarlas como **no sumables entre sí** en el DTO.
*Mutación:* devolver una sola cifra que sume las dos vistas → el test de la doble contabilización
(un cierre de un mensajero con órdenes de dos tiendas) ve el doble del dinero real.

**R20.** CUANDO se consulte `cuenta_por_pagar_tienda` o `cuenta_por_pagar_mensajero`, el sistema DEBE
derivar el importe **reutilizando** `derivarSaldoTienda` (`lib/utils/saldo-tienda.ts`) y
`derivarCuentaPorPagar` (`lib/utils/cuenta-por-pagar.ts`), y **NO DEBE** reimplementar la resta.
*Mutación:* calcular `creditos - debitos` a mano en el servicio → el test que compara el resultado del
servicio contra la función compartida, para un caso de signo negativo, falla en el `signo`.

**R21.** MIENTRAS D3 esté resuelta como (a), la cuenta por pagar DEBE agregarse con
`fecha_movimiento < rango.hasta` **sin** cota inferior, y el DTO DEBE declararse como acumulado.
*Mutación:* añadir `fecha_movimiento >= rango.desde` → el test con un devengo anterior al rango ve el
saldo mutilado (y el que verifica la marca de acumulado, ausente).

**R22.** CUANDO se consulte `conciliacion_cierres`, el sistema DEBE devolver, por cada estado de
`CierreEstado` (`solicitado`, `aprobado`, `rechazado`, `vencido`), el **conteo** de cierres y sus
`total_*` snapshot, para `cierre_dia` y `cierre_bodega` por separado.
*Mutación:* fundir los dos niveles de cierre en un solo total → el test con un `cierre_bodega` que
consolida tres `cierre_dia` ve el dinero contado dos veces.

**R23.** `conciliacion_cierres` DEBE comparar los `total_*` de los cierres **aprobados** del rango
contra lo registrado en los ledgers con `origen_tipo = cierre_dia` y `origen_id` de esos cierres, y
DEBE reportar la diferencia según **D5** (`cuadra`, `diferencia`, cierres implicados).
*Mutación:* comparar contra la Σ de **todos** los movimientos del rango en vez de los de ese origen →
el test con un ajuste manual dentro del rango declara un descuadre que no existe.

**R24.** SI la diferencia de conciliación supera el umbral configurado, ENTONCES el sistema DEBE
emitirla por el `ErrorLogger` y **NO DEBE** lanzar ni degradar el resultado (D5).
*Mutación:* lanzar un error → el test con datos descuadrados deja de recibir el DTO y recibe una
excepción; el tablero quedaría caído.

**R25.** MIENTRAS D4 esté resuelta como (b), los cierres no resueltos **NO DEBEN** aportar importe a
ninguna métrica de dinero, pero **DEBEN** aparecer en `conciliacion_cierres` con su estado, fechados
por `solicitado_at`.
*Mutación:* sumar `total_general` de los `solicitado` a `cod_recaudado` → el test del cierre pendiente
ve dinero que aún no existe, y el mismo test tras aprobarlo lo ve **dos veces**.

**R26.** El sistema DEBE fechar cada métrica según **D2** y DEBE hacerlo con la frontera de día natural
CR que produce `resolverRango`, sin construir ninguna ventana temporal propia.
*Mutación:* usar `new Date(fecha)` (medianoche UTC) en vez de `rango.desde` → el test del movimiento
de las 22:00 CR del día anterior lo mete en el día equivocado (el off-by-one de 6 horas del repo).

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
*Mutación:* mover `derivarSaldoTienda` dentro del repositorio → la revisión de capas (y el test que
instancia el servicio con un repositorio mock y espera la derivación **en el servicio**) falla.

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
*Mutación:* aflojar el detector para que acepte al infractor de SQL crudo → el fixture infractor
pasa a devolver `null` y su propio test falla.

**R35.** El sistema DEBE incluir un guardia que compare, métrica a métrica, el `alcance` del catálogo
contra lo que el servicio sirve, y falle si alguna financiera dejara de ser `total`/`prohibido`.
*Mutación:* cambiar `adminTienda: "prohibido"` por `"acotado"` en `ALCANCE_FINANCIERA` → el guardia se
pone rojo, que es exactamente el aviso de la 122: hay que **diseñar el recorte del dinero antes** de
tocar la métrica.

**R36.** Cada requisito `R1`–`R36` DEBE tener al menos un test nombrado por el comportamiento (no por
la función) y mapeado en `progress/impl_127.md`.
*Mutación:* borrar el mapa o dejar un `R` sin test → el reviewer lo marca como hallazgo bloqueante
(`docs/verification.md`, regla del reviewer).

---

## Preguntas abiertas (no bloquean el spec; sí la implementación de la parte que tocan)

1. **¿Existe un caso real de `cierre_bodega` con `total_*` distintos de la suma de sus `cierre_dia`?**
   Si nunca puede pasar por construcción, la conciliación de nivel bodega es redundante y R22 se
   simplifica. No lo pude determinar leyendo `CierreBodegaService`; no lo supongo.
2. **`total_ingreso_bodega_rechazos` y `total_pago_mensajero`** son snapshots de cierre que **ninguna
   de las ocho métricas del catálogo nombra**. ¿Se quedan fuera (y entonces el tablero financiero no
   los ve nunca), o son una métrica nueva que exige decisión del catálogo?
3. **`SINPE` vs `simpe`.** La ficha y la descripción del catálogo escriben «SINPE»; la columna real es
   `total_simpe` y el enum `MetodoPagoValue` habría que confirmarlo antes de fijar la etiqueta de
   salida. Es cosmético, pero el CSV de la 134 lo va a heredar.
4. **Retención / volumen.** Un rango `personalizado` admite hasta 366 días
   (`RANGO_TOPE_DIAS`). Nadie ha medido cuántas filas tiene el ledger a un año, y esta feature agrega
   sin `LIMIT` por definición. ¿Se mide antes de exponerlo, o se acepta y se observa?
