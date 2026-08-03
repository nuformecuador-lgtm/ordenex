# Feature 127 — analítica: servicios financieros · design

> **Puerta T0 CERRADA el 2026-08-02.** Las nueve decisiones están contestadas en `requirements.md`;
> **D7 se cerró por implicación y no fue contestada directamente** (se reabre si el humano no la ve
> así). Este diseño ya no tiene ramas condicionales: las marcas `⟨D_n⟩` que quedan son
> **trazabilidad** —de dónde sale cada decisión de forma—, no incertidumbre.

---

## 1. Qué hace y qué no

| Hace | No hace | Quién lo hace |
|---|---|---|
| Servir las **8 métricas `financiera`** del catálogo de la 135 | Declarar métricas nuevas | 135 (con decisión humana) |
| Leer ledgers + snapshots de cierre | Leer `orden`, `gestion_orden`, `analytics_daily` | 126 (operativa) |
| Recibir `ConsultaAnalitica` y traducirla a `where` | Resolver alcance, parsear filtros, resolver rango | 122 / 135 |
| Los tres pasos del borde (auditar → 403 → identidad) | Definir el patrón del borde | 122 (`alcance-bordes.guardia.test.ts`) |
| Devolver DTOs money-safe | Cachear, invalidar por tag | 128 |
| — | Pintar el tablero | 129 / 132 |

**Consigna estructural:** el dinero **nunca** se recalcula desde órdenes. No es una preferencia: es
lo que hace que la cifra del tablero y la cifra que alguien cobra vengan del mismo sitio.

---

## 2. Modelo de datos

**Ninguna tabla nueva, ninguna columna nueva, ninguna migración, ningún cambio de RLS.** Esta feature
es de **lectura**. Las cinco tablas que toca ya tienen RLS habilitada sin policies (solo service role,
patrón `wallet_movimiento`/`cierre_dia`), y esta feature no la altera.

### 2.0 El único cambio de contenido: el catálogo de la 135 ⟨D8⟩

Esta feature **modifica un archivo ajeno**: `lib/analytics/metrics.ts`, propiedad de la 135. Pasa
`egresos` de `estadoProduccion: "declarada"` a `"producida"`.

> **Con visto bueno humano explícito, fechado el 2026-08-02 (D8 → (b)).** Es una línea, pero es **el
> catálogo**, que es la fuente única de trece features. No es un retoque de paso, no es una
> consecuencia técnica del código y **no se repite para ninguna otra métrica sin su propia decisión
> fechada**. Quien lea el diff después tiene que poder llegar hasta aquí y encontrar de dónde salió.

`R41` lo verifica por los dos lados: el catálogo declara `producida` **y** el servicio la produce de
verdad; ninguna financiera queda `declarada` sin productor al cerrar la feature.

### 2.1 Las cinco tablas y las columnas que importan

| Tabla | Coordenada temporal | Importe | Cubo |
|---|---|---|---|
| `wallet_movimiento` | `fecha_movimiento` | `monto` (Decimal 12,2), signo por `tipo` | `categoria` |
| `wallet_tienda_movimiento` | `fecha_movimiento` | `monto`, signo por `tipo` | `tienda_id` × `categoria` |
| `pago_mensajero_movimiento` | `fecha_movimiento` | `monto`, signo por `tipo` | `mensajero_id` × `categoria` |
| `cierre_dia` | **`resuelto_at`** para dinero; `solicitado_at` solo para los no resueltos ⟨D2/D4⟩ | `total_efectivo`, `total_simpe`, `total_transferencia`, `total_general`, `total_pago_mensajero`, `total_ingreso_bodega_rechazos` | `estado` |
| `cierre_bodega` | ídem ⟨D2/D4⟩ | los mismos seis `total_*` agregados | `estado`, `zona_id` |

**Hechos del esquema que condicionan el diseño** (verificados, con archivo:línea):

1. **`cierre_dia` es de un MENSAJERO, no de una tienda** (`db/schema.prisma:860`). No hay forma legal
   de repartir sus `total_*` por tienda. Origen de ⟨D6⟩.
2. **El ledger de tienda no tiene método de pago** (`db/schema.prisma:1129-1150`). El método solo
   existe en los tres `total_*` del cierre. Origen de ⟨D6⟩.
3. **Los ledgers son append-only sin `deleted_at`** (`:1078`, `:1141`, `:1203`). No hay filas a
   excluir por borradas; las correcciones son filas `ajuste_*` **sin puntero al original**. Origen de
   ⟨D1⟩ y razón por la que el `neto` se deriva por signo y no por emparejamiento.
4. **`cierre_dia` no tiene fecha de negocio.** Solo `solicitado_at` y `resuelto_at`, que pueden caer
   en días distintos. Origen de ⟨D2⟩ y ⟨D4⟩. Con D2(b), **el dinero del cierre se fecha por
   `resuelto_at`**, que es el mismo instante en que el feed escribe en los ledgers: las dos caras de
   la conciliación miran el mismo día y un descuadre deja de poder ser un artefacto de fechado.
5. **El vínculo cierre↔ledger existe y es explícito:** `origen_tipo = cierre_dia` + `origen_id`, con
   índice `(origen_tipo, origen_id)` en las tres tablas. Es lo que hace la conciliación **barata y
   exacta** en vez de heurística.
6. **`CierreEstado` tiene cuatro valores** (`:833-840`), incluido `vencido` que crea el corte diario.
   El catálogo de la 135 no puede citarlos en `definicion.categorias` (R9 de la 135 no lo permite);
   viven en la descripción. Aquí sí se enumeran, porque aquí son datos, no vocabulario declarado.

### 2.2 Índices: qué hay y qué falta

Existen: `(fecha_movimiento)` en la caja; `(tienda_id, fecha_movimiento)` y `(tienda_id, categoria)`
en el de tienda; `(mensajero_id, fecha_movimiento)` en el de mensajero; `(origen_tipo, origen_id)` en
las tres; `(estado)` en ambos cierres.

**Lo que no existe:** un índice `(categoria, fecha_movimiento)` en `wallet_movimiento`. Las tres
métricas de ingreso filtran exactamente por eso. Con el volumen actual (35 movimientos en producción,
medido y anotado en `progress/current.md`) es irrelevante; a un año de operación puede no serlo. **No
se añade en esta feature** — sería una migración especulativa sobre un volumen no medido — pero queda
escrito aquí y en la pregunta abierta 4: si la 128 (caché) no basta, el índice es el siguiente paso y
tiene que medirse antes.

---

## 3. Módulos y archivos

Nombres por el **hecho de negocio**, no por la tabla (`docs/conventions.md`). Nadie se llama
`WalletMovimientoAnaliticaRepository`.

```
lib/interfaces/repositories/
  IRecaudoAnaliticaRepository.ts          # COD recaudado (cierre + ledger de tienda)
  IIngresosAnaliticaRepository.ts         # flete, comisión COD, IVAs, egresos (caja principal)
  ICuentasPorPagarAnaliticaRepository.ts  # saldo a tiendas y devengado a mensajeros
  IConciliacionCierresAnaliticaRepository.ts

lib/interfaces/services/
  IAnaliticaFinancieraService.ts          # UNA fachada: (consulta) -> ResultadoFinanciero

lib/repositories/
  RecaudoAnaliticaRepository.ts
  IngresosAnaliticaRepository.ts
  CuentasPorPagarAnaliticaRepository.ts
  ConciliacionCierresAnaliticaRepository.ts

lib/services/
  AnaliticaFinancieraService.ts           # despacha por metrica.id, deriva, no habla Prisma

lib/actions/
  analitica-financiera.ts                 # 'use server': los TRES pasos del borde

lib/types/
  analitica-financiera.ts                 # DTOs (importes STRING escala 2), sin zod propio

lib/config/
  analitica-financiera.ts                 # umbral de descuadre ⟨D5⟩, provisional y comentado

tests/unit/analytics/
  financiera-fuente.guardia.test.ts       # R33/R34 (autocomprobado con fixtures)
  financiera-alcance.guardia.test.ts      # R35
tests/unit/services/analitica-financiera-*.test.ts
tests/integration/actions/analitica-financiera-action.test.ts
```

**Por qué `lib/actions/analitica-financiera.ts` y no `analitica.ts`:** la ficha de la 126 reserva
`lib/actions/analitica.ts` para lo operativo. Dos features de zona `backend` escribiendo el mismo
archivo es exactamente el conflicto que la validación de paralelismo de `AGENTS.md` intenta evitar.
Coste asumido: el consumidor importa de dos módulos en vez de uno. La 129/132 ya importan de varios.

**Por qué cuatro repositorios y un solo servicio:** los cuatro repositorios tienen consultas
estructuralmente distintas (agregación por categoría, agregación por tienda, agregación de snapshots,
join por origen). Un repositorio único sería un cajón con cuatro responsabilidades. El servicio, en
cambio, es uno: la lógica compartida —validar dominio, leer el catálogo, derivar con las funciones
money-safe, marcar sumabilidad— es la misma para las ocho métricas, y partirla en cuatro servicios
duplicaría esa lógica cuatro veces (que es como se desincronizan las cifras).

---

## 4. Cómo entra `ConsultaAnalitica`

La cadena, sin vías alternativas:

```
Server Action (lib/actions/analitica-financiera.ts)
  resolveActorFromSession()                      ← el ÚNICO origen del actor (R15)
  prepararConsultaAnalitica(raw, actor, metricaId)   ← parsea + rango + alcance, en UNA llamada
    ├─ validation_error → 400 con fieldErrors, SIN auditar (R13)
    ├─ forbidden        → logError(describirDenegado(...)) → 403 { code: "FORBIDDEN" } (R11/R12/⟨D9⟩)
    └─ ok               → AnaliticaFinancieraService.consultar(consulta)
                            ├─ metrica.dominio !== "financiera" → error explícito (R5)
                            ├─ despacha al repositorio por metrica.id
                            ├─ repositorio: Prisma puro, WHERE por rango + categorías DEL CATÁLOGO
                            └─ servicio: deriva con Prisma.Decimal y devuelve DTO STRING
```

**Lo que el repositorio recibe es `ConsultaAnalitica`, no un filtro.** No porque quede elegante: es lo
único que hace que «olvidarse del recorte» sea un error de compilación (R17 de la 122). Del objeto
opaco esta feature usa `consulta.metrica` (para las categorías declaradas) y `consulta.rango` (para la
ventana). **No usa `consulta.alcance`** — y eso es correcto y está probado por R9: con el catálogo
vigente, el alcance de una financiera concedida es siempre `{ tipo: "global" }`.

> **Consecuencia de no usar `alcance`:** el guardia `alcance-obligatorio.guardia.test.ts` mira que el
> archivo mencione `ConsultaAnalitica`, no que use el alcance, así que sigue verde. Pero **R35** existe
> precisamente para que el día que una financiera pase a `acotado`, el silencio se vuelva rojo en vez
> de convertirse en una fuga de datos entre inquilinos.

**Ergonomía en tests:** `ConsultaAnalitica` no se puede construir a mano (marca por `unique symbol`).
Los tests la obtienen llamando a `prepararConsultaAnalitica` con un actor `maestro` y un `now` fijo.
Eso es deliberado (§7 alternativa 5 de la 122) y no se elude con un cast.

---

## 5. Contratos de I/O

Todos los importes son **STRING escala 2**. Ningún `number` cruza ninguna frontera.

### 5.1 Entrada (Server Action)

```ts
// lib/actions/analitica-financiera.ts
'use server';
export async function consultarMetricaFinanciera(
  metricaId: string,
  filtroRaw: unknown,       // se valida ENTERO dentro de prepararConsultaAnalitica; no se pre-parsea
): Promise<RespuestaFinanciera>;
```

No hay `rol`, ni `usuarioId`, ni campo de alcance en la entrada: el filtro de la 135 es `.strict()` y
cualquier clave así es un **error de validación**, no un vector de escalada.

### 5.2 Salida

```ts
type RespuestaFinanciera =
  | { status: "ok"; datos: ResultadoFinanciero }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "forbidden"; code: "FORBIDDEN" }            // sin motivo ⟨D9⟩ — R42
  | { status: "error"; mensaje: string };                 // con contexto, sin ids ajenos ni PII
```

**No hay estado `no_producida`.** ⟨D8(b)⟩ cerró esa rama: la 127 produce las ocho métricas, así que un
estado para «declarada sin productor» sería código muerto que invita a rellenarlo. Si algún día vuelve
a haber una financiera sin productor, el estado se añade **con la decisión que lo cree**.

**El cuerpo del `forbidden` no lleva `motivo`** (R42): el dominio cerrado de `MotivoDenegacion` viaja
íntegro a `describirDenegado` y de ahí al `ErrorLogger`, y **solo ahí**. Un cliente que recibiera
`metrica_desconocida` vs `metrica_prohibida` podría enumerar el catálogo y los permisos de cada rol
preguntando.

```ts
interface ImporteAnalitico {
  readonly bruto: string;        // Σ de las categorías nominales                      ⟨D1⟩ R37
  readonly neto: string;         // Σ CON SIGNO (crédito − débito / ingreso − egreso)  ⟨D1⟩ R37
  readonly moneda: string;       // de lib/config/moneda.ts — nunca literal
}

interface ResultadoFinanciero {
  readonly metricaId: string;
  readonly etiqueta: string;                     // del catálogo, no escrita aquí
  readonly unidad: MetricaUnidad;                // del catálogo
  readonly rango: { desdeFecha: string; hastaFecha: string };
  readonly esAcumulado: boolean;                 // true EXACTAMENTE en las dos cuentas por pagar ⟨D3⟩ R43
  readonly vistas: readonly VistaFinanciera[];   // 1, salvo cod_recaudado que trae 2 ⟨D6⟩ R38
}

interface VistaFinanciera {
  readonly id: string;                           // p.ej. "cod_recaudado__por_metodo"
  readonly grano: DimensionAnalitica;            // "metodo_pago" | "tienda" | "fecha"
  readonly fuente: TablaDinero;                  // de qué tabla salió ESTA cifra
  readonly sumableCon: readonly string[];        // ids de vistas con las que SÍ suma; [] = con ninguna
  readonly filas: readonly {
    readonly cubo: string;                       // valor del grano (id de tienda, "efectivo", fecha…)
    readonly importe: ImporteAnalitico;
  }[];
  readonly total: ImporteAnalitico;
}
```

**`sumableCon` no es decoración.** ⟨D6(a)⟩ produce dos vistas de `cod_recaudado` con **ids distintos**
—`cod_recaudado__por_metodo` y `cod_recaudado__por_tienda`— que **no suman entre sí** (una es lo que
el mensajero entregó; la otra, lo acreditado a tiendas). Ambas declaran `sumableCon: []`. Sin ese
campo, la primera pantalla que las ponga juntas las va a sumar y va a mostrar el doble del dinero. Es
el mismo razonamiento de `sonSumables()` del catálogo, aplicado **dentro** de una métrica (R38).

**Por qué dos vistas y no dos métricas nuevas:** el catálogo de la 135 **no se recorta ni se amplía**
(D6). `cod_recaudado` sigue siendo una métrica con sus tres granos; lo que la 127 declara es que ese
cubo se sirve en dos proyecciones legales, porque el cubo cruzado no existe en las fuentes permitidas.
Crear ids de métrica nuevos sería cambiar el catálogo sin decisión que lo respalde.

**Ningún DTO lleva `mensajeroId`** (R14). `cuenta_por_pagar_mensajero` no declara grano `mensajero` en
el catálogo, así que sirve **un total**, no filas por persona.

### 5.3 Conciliación

```ts
interface ResultadoConciliacion {
  readonly porEstado: readonly {
    readonly nivel: "cierre_dia" | "cierre_bodega";
    readonly estado: "solicitado" | "aprobado" | "rechazado" | "vencido";
    readonly cantidad: number;                   // conteo: aquí sí es un entero, no dinero
    readonly totales: Record<"efectivo"|"simpe"|"transferencia"|"general", string>;
    readonly fechadoPor: "resuelto_at" | "solicitado_at";   // ⟨D2/D4⟩ explícito por fila — R39
  }[];
  readonly cuadre: {
    readonly cuadra: boolean;
    readonly totalSnapshot: string;              // Σ total_general de los aprobados del rango
    readonly totalLedger: string;                // Σ de los movimientos con origen en esos cierres
    readonly diferencia: string;                 // snapshot − ledger, con signo
    readonly cierresDescuadrados: readonly string[];   // ids de cierre; NO ids de persona
  };
}
```

**La doble coordenada temporal es un DATO, no un sobreentendido** (R39). Con ⟨D2(b)⟩ + ⟨D4(b)⟩, las
filas de estado `aprobado` se fechan por `resuelto_at` y las de `solicitado`/`vencido`/`rechazado` por
`solicitado_at` — porque **no tienen** `resuelto_at`. Que cada fila lo declare evita que el consumidor
tenga que saberse la regla, y hace que clavar el campo a un valor único se detecte con un test en vez
de con un informe raro seis meses después.

**Los cierres no resueltos no aportan importe a ninguna métrica de dinero** (R25): aparecen aquí, con
su conteo y sus `total_*`, precisamente para que «hay dinero en el aire» sea visible sin que ese
dinero se cuele en `cod_recaudado` — y sin que se cuente dos veces el día que se aprueben.

**El descuadre se reporta, nunca revienta** (⟨D5⟩, R24): si `|diferencia|` supera el umbral de
`lib/config/analitica-financiera.ts` (R40), se emite por el `ErrorLogger` y el DTO **igual se
devuelve**. Un tablero financiero que se cae por un descuadre histórico es un tablero que alguien
apaga.

`cierresDescuadrados` lleva ids de **cierre**, nunca de mensajero ni de tienda: R14 y el criterio de
la 122 sobre no reenviar ids ajenos por canales de diagnóstico.

---

## 6. Las consultas, una a una

| Métrica | Repositorio | Consulta | Derivación (servicio) |
|---|---|---|---|
| `ingreso_flete` | Ingresos | `groupBy(categoria)` + `_sum(monto)` sobre `wallet_movimiento`, `categoria IN definicion.categorias`, `fecha_movimiento ∈ [desde,hasta)` | `derivarBalance` |
| `ingreso_comision_cod` | Ingresos | idem, 1 categoría | `derivarBalance` |
| `ingreso_iva` | Ingresos | idem, 3 categorías | `derivarBalance` |
| `egresos` ⟨D8(b)⟩ | Ingresos | idem, 8 categorías `egreso_*` | `derivarBalance` |
| `cod_recaudado__por_metodo` ⟨D6(a)⟩ | Recaudo | `aggregate` de `total_efectivo/simpe/transferencia` sobre `cierre_dia` **resueltos** (`resuelto_at ∈ [desde,hasta)`, estado `aprobado`) | suma Decimal |
| `cod_recaudado__por_tienda` ⟨D6(a)⟩ | Recaudo | `groupBy(tiendaId)` + `_sum` sobre `wallet_tienda_movimiento`, `categoria = cod_recaudado`, `fecha_movimiento ∈ [desde,hasta)` | suma Decimal |
| `cuenta_por_pagar_tienda` | CuentasPorPagar | `groupBy(tiendaId, tipo)` + `_sum`, **`fecha_movimiento < hasta` sin cota inferior** ⟨D3(a)⟩ | `derivarSaldoTienda` |
| `cuenta_por_pagar_mensajero` | CuentasPorPagar | `groupBy(tipo)` + `_sum`, **`fecha_movimiento < hasta` sin cota inferior** ⟨D3(a)⟩ | `derivarCuentaPorPagar` |
| `conciliacion_cierres` | Conciliación | `groupBy(estado)` sobre ambos cierres (aprobados por `resuelto_at`, resto por `solicitado_at` ⟨D2/D4⟩) **+** `groupBy(origenId)` sobre los tres ledgers filtrado por los ids aprobados | comparación Decimal |

**Las dos vistas de `cod_recaudado` no se suman** (R38): la de método sale de lo que los mensajeros
entregaron en cierres aprobados; la de tienda, de lo acreditado en el ledger. Un mismo cierre puede
contener órdenes de varias tiendas, así que sumarlas contaría el mismo colón dos veces.

**Las dos cuentas por pagar ignoran `desde` a propósito** (R21/R43): son un **saldo al corte**, y el
DTO lo declara con `esAcumulado: true` para que nadie las grafique como serie acumulativa.

**Cada fila lleva `bruto` y `neto`** (R37). El `neto` sale de la resta con signo que ya hacen las tres
funciones de derivación; **no** de emparejar `ajuste_*` con su original, que el esquema no permite
saber.

**Las categorías salen del catálogo, siempre** (R17): `consulta.metrica.definicion.categorias`. Ningún
array literal de categorías vive en un repositorio de esta feature. Es la diferencia entre «el
catálogo describe» y «el catálogo manda»; solo la segunda sobrevive a que alguien añada un valor al
enum.

**El reuso no es opcional** (R20). `derivarSaldoTienda`, `derivarCuentaPorPagar` y `derivarBalance` ya
existen, ya son money-safe y ya tienen tests. Volver a escribir `creditos.sub(debitos)` aquí crearía
una **segunda** definición de «saldo» que puede divergir de la que ve la tienda en `/mi-wallet`. Ese
es el bug caro de esta feature: no una consulta lenta, dos cifras del mismo dinero.

---

## 7. Alternativas descartadas

1. **Leer `analytics_daily` y añadirle columnas de dinero.** Sería la consulta más barata del lote y
   la caché saldría gratis. **Descartada por tres razones acumuladas:** (a) el rollup se deriva de
   `orden`/`gestion_orden`, así que el dinero pasaría a recalcularse desde órdenes — la consigna que
   la ficha prohíbe en mayúsculas; (b) la 123 excluyó explícitamente las columnas de dinero de esa
   tabla («Sin columnas de dinero: la financiera lee ledgers directos»); (c) **el guardia R42 de la
   124** (no confundir con el R42 *de esta* feature) prohíbe que **cualquiera** lea
   `analytics_daily`. Que los tres apunten al mismo sitio no es
   coincidencia: es la decisión ya tomada tres veces. **Si algún día este diseño la necesitara, eso
   es una contradicción declarada que va al bloque T0, no una prohibición que se afloja de paso.**

2. **Un `AnaliticaFinancieraRepository` único con nueve métodos.** Menos archivos y un solo punto de
   cableado. Descartada: mezclaría cuatro formas de consulta sin nada en común salvo «son dinero», y
   el archivo crecería hasta ser el sitio donde nadie mira. Además rompe el criterio de nombrar por el
   hecho de negocio: no habría hecho, habría un dominio entero.

3. **Materializar las cifras financieras en una tabla `financiera_daily` propia.** Rendimiento
   garantizado y series históricas baratas. Descartada por **precio de corrección**: los ledgers
   admiten movimientos con `fecha_movimiento` retroactiva (ajustes, y el contraasiento de la 172 que
   se fecha el día de la anulación), así que cualquier materialización quedaría rancia sin que nada
   fallara. Un tablero financiero equivocado en silencio es peor que uno lento. Si el volumen lo
   exige, la respuesta es la **128** (caché con invalidación por tag), que expira; no una copia.

4. **Recortar las cuentas por pagar por tienda/mensajero para que cada uno vea la suya.** Es la
   funcionalidad que uno esperaría. Descartada por **D7 de la 135**, ya decidida por el humano: el
   dinero es de `maestro` y `admin`; `adminTienda` no ve su cuenta por pagar **en analítica** (la ve en
   `/mi-wallet`, que es otra superficie con otra puerta). Construirla aquí exigiría un adaptador de
   alcance para las tablas de dinero, que **R25 de la 122 prohíbe** con guardia en los dos sentidos.

5. **Hacer que la conciliación falle (excepción) cuando no cuadra.** Máxima visibilidad. **Descartada
   por el humano en ⟨D5⟩ (2026-08-02):** un descuadre histórico dejaría el tablero caído para siempre y
   la salida rápida sería desactivar la comprobación — se perdería justo lo que se quería ganar. Se
   reporta en el DTO **y** se emite por el `ErrorLogger` por encima del umbral de
   `lib/config/analitica-financiera.ts`.

   5-bis. **Fundir `cod_recaudado` en una sola cifra** cruzando tienda × método. **Descartada por el
   humano en ⟨D6(a)⟩:** el cruce no existe en las fuentes permitidas (`cierre_dia` es por mensajero;
   el ledger de tienda no tiene método) y construirlo exigiría bajar a `orden`/`gestion_orden`. La
   alternativa que también se descartó es **recortar el catálogo** (quitarle el grano `tienda`): se
   perdería una pregunta legítima que el ledger **sí** puede contestar.

   5-ter. **Dejar `egresos` sin producir** (estado `no_producida`). **Descartada por el humano en
   ⟨D8(b)⟩:** servir ingresos sin egresos deja un tablero que solo sabe sumar, y el coste marginal es
   el mismo repositorio con otra lista de categorías. El precio pagado es tocar el catálogo ajeno, y
   por eso llevó decisión fechada (§2.0).

6. **Route handlers en `app/api/analitica/financiera/`** en vez de Server Actions. Descartada por
   `docs/architecture.md`: no hay consumidor externo, no hay webhook y no hay cron. Lectura interna
   desde componentes propios ⇒ Server Action.

7. **Netear las anulaciones emparejando cada `ajuste_*` con su movimiento original.** Sería la cifra
   «de verdad». Descartada como **imposible con el esquema vigente**: no hay puntero del ajuste al
   movimiento que corrige, y la 172 lo dejó explícitamente abierto (N1). Inferirlo por
   `origen_tipo/origen_id` sería adivinar y produciría una cifra con aspecto de exacta. Se sirve
   `bruto` + `neto` por signo agregado ⟨D1⟩ y se deja la diferencia a la vista.

---

## 8. Riesgos

- **D7 se cerró por implicación, no por respuesta.** Si el humano lo reabre, cambia R23 (contra qué se
  concilia) y podría caer una de las dos vistas de R19. Es el único punto del spec que no descansa en
  una respuesta directa, y está marcado como tal en `requirements.md`.
- **Esta feature toca el catálogo de la 135** (`egresos` → `producida`, §2.0). Es un archivo ajeno,
  fuente única de trece features: el merge con `dev` tiene que mirar ese archivo con cuidado, y la
  autorización que lo respalda es del 2026-08-02, no genérica.
- **⟨D6(a)⟩ deja una asimetría visible en la UI:** dos vistas de la misma métrica que no suman. Si la
  132 no lo explica en pantalla, alguien las va a sumar mentalmente. `sumableCon` lo impide en el
  código, no en la cabeza del que mira.
- **La 128 depende de esta feature** (`depends_on: 127`). Las formas de DTO que se fijen aquí son las
  que esa feature va a cachear; un cambio posterior invalida su diseño. Ojo con `esAcumulado`: un
  saldo al corte cacheado con la clave de un rango es una trampa fácil.
- **El guardia R35 va a ponerse rojo el día que alguien abra un recorte financiero.** Eso es su
  trabajo. La reacción correcta es diseñar el recorte del dinero; la incorrecta es añadir una
  excepción nominal (mirar la nota de `alcance-obligatorio.guardia.test.ts:144-149` sobre por qué las
  exenciones generales amnistían a los infractores reales).
- **Volumen no medido a un año.** Ver pregunta abierta 4 y §2.2.
