# Feature 180 — analitica financiera: desglose por fecha · design

> Lee primero `requirements.md`. Las decisiones `⟨D1⟩..⟨D8⟩` de aqui son la respuesta tecnica a
> esos requisitos; las `Q1..Q6` del final de `requirements.md` son lo que **no** se decide sin el
> humano.

---

## 1. Hallazgos (divergencias entre la ficha y el codigo)

Se escriben aqui en vez de silenciarse, tal como pide el arnes.

**H1 — «las cuatro metricas de caja» son SEIS.** La ficha (y la Q3 de la 132, que la origino) habla
de cuatro. Desde la feature 173 el mismo repositorio y el mismo material sirven ademas
`dinero_en_caja` y `ganancia_ordenex` (`AnaliticaFinancieraService.ts:143-144`,
`lib/types/analitica-financiera.ts:230-241`). Dejarlas fuera produciria un tablero donde cuatro
tarjetas tienen linea y dos identicas no. → **Q1**.

**H2 — la NOTA de la ficha queda cerrada por el codigo, en negativo.** La `status_note` pide
comprobar si el rollup de la 123 ya guarda el grano por fecha «porque entonces esto es exponerlo, no
recalcularlo». No lo guarda: `analytics_daily` no tiene **ninguna** columna de dinero
(`db/schema.prisma:1890-1899`, y la ficha 123 lo dice explicitamente), y ademas la 127 tiene
**prohibido** nombrar esa tabla (`financiera-fuente.guardia.test.ts:107-110`). Luego esta feature
**produce** el desglose desde los ledgers. No hay atajo.

**H3 — `cuenta_por_pagar_mensajero` no es una serie de flujo, y eso cambia el trabajo.** Es un saldo
al corte (`esAcumulado: true`, y su repositorio agrega **sin cota inferior**,
`CuentasPorPagarAnaliticaRepository.ts:56-92`). Su «serie por fecha» no es un `groupBy` por dia: es
un **acumulado corrido** que necesita el saldo anterior al rango. Un `groupBy` por dia sobre la
ventana daria el movimiento del dia, que es una cifra distinta y plausible — la peor combinacion.

**H4 — Prisma no puede agrupar por fecha calendario CR.** `fecha_movimiento` es `DateTime` (un
instante), no `@db.Date` (`db/schema.prisma:1103,1166,1228`), y `groupBy` de Prisma solo agrupa por
columnas. Agrupar por dia CR exige una expresion SQL. Ver ⟨D4⟩ y §5.

**H5 — el guardia de repositorios congela el numero de metodos publicos en 8**
(`financiera-repositorios.guardia.test.ts:238-242`, «cuando un repositorio gane un metodo, este caso
obliga a mirar la lista»). Cualquier metodo nuevo pone rojo ese test **a proposito**: hay que
ampliarlo, no rodearlo.

**H6 — el tablero de la 132 ya sabe consumir esto sin cambios.** `serieDeVista` y `filasDeVista`
(`adaptar.ts:72-113`) mapean `vista.filas[].cubo` a categoria y `importe.bruto|neto` a valor. Si el
`cubo` pasa a ser `YYYY-MM-DD`, el adaptador produce la serie temporal sin tocar una linea. Lo que
falta en el tablero es el **panel** que la pinte → Q4.

---

## 2. Decisiones

### ⟨D1⟩ Se rellena la vista que YA declara grano `fecha`; no se crea una vista nueva

`deCaja`, `deTesoreria` y `deCuentaDeMensajeros` ya publican `grano: "fecha"` con `filas: []`. El
cambio es **rellenar esas filas**, no anadir una segunda vista con un id nuevo.

Por que: una vista nueva (`<metricaId>__por_fecha`) obligaria a declarar un id estable mas,
su `sumableCon` (que seria `[]`, porque la serie y el total miden **el mismo dinero** y sumarlos lo
contaria dos veces) y a que todo consumidor decidiese cual de las dos vistas mira. La vista que ya
existe declara literalmente el grano que le falta cumplir: el DTO actual es esa vista **incompleta**,
no una vista distinta.

Consecuencia declarada: `R3` (metricas fuera del conjunto sin cambios) se vuelve verificable como
una regresion de igualdad estructural, y el hueco de la 132 se llena sin nuevas claves.

### ⟨D2⟩ La granularidad es una decision del SERVIDOR y viaja OBLIGATORIA en el DTO

`VistaFinanciera` gana un campo **requerido** `granularidad: "dia" | "semana" | "no_temporal"`.

Requerido y no opcional por la misma razon que `cobertura` es obligatoria en la 126
(`lib/types/analitica-operativa.ts:13-15`): un campo opcional se ignora por omision y entonces
«dia» y «semana» acaban siendo el mismo pixel. Las vistas de grano `tienda` y `metodo_pago`
declaran `no_temporal` explicitamente: obliga a nombrarlo en cada productor.

Regla (R18), con el tope tomado de una constante y no de un literal:

| dias del rango (inclusivos) | granularidad | cubos maximos |
|---|---|---|
| 1 … 62 | `dia` | 62 |
| 63 … 366 | `semana` | 53 |

366 dias es el maximo que el borde admite (`RANGO_TOPE_DIAS`), y 366/7 = 53 semanas. **Con estas dos
granularidades el techo de 62 puntos no se puede superar para ningun rango admisible** (R19), asi
que no hace falta un tercer escalon mensual ni un recorte. El propio `topes.ts:28-31` justifica el
62 como «53 semanas (el peor caso legitimo ya agregado en un rango de 366 dias) mas margen»: el
numero fue elegido dando por supuesta exactamente esta agregacion.

Donde vive el 62 en el servidor: `lib/analytics/types.ts` (junto a `RANGO_TOPE_DIAS`, que es el
precedente exacto de «tope declarado una vez»). **No** se importa `components/private/analytics/topes.ts`
desde `lib/`: seria una inversion de capas (un servicio dependiendo de un componente). La coherencia
entre los dos numeros se ata **por test** (R20), que es el patron ya usado en la 127 para
`IDS_FINANCIERAS_SERVIDAS` contra el catalogo: dos fuentes independientes que un test compara.

### ⟨D3⟩ La serie es DENSA, y el cero solo se afirma donde el libro lo garantiza

Una fila por cubo, siempre (R7). Los cubos sin movimiento valen cero en las metricas de flujo (R8) y
repiten el saldo anterior en las acumuladas (R9).

Esto **no contradice** la prosa de la 127 («inventar una fila con la fecha de inicio del rango
afirmaria que todo el dinero se movio ese dia», `AnaliticaFinancieraService.ts:206-210`). Lo que
aquella se negaba a hacer era **atribuir** un agregado a una fecha arbitraria. Aqui la atribucion es
real: cada movimiento se coloca en su dia por su propio `fecha_movimiento`. Y en un libro
append-only e inmutable (`db/schema.prisma:1105`, «SIN updatedAt/deletedAt: la fila es INMUTABLE»),
la ausencia de filas en un dia **es** la afirmacion de que ese dia no hubo movimiento: no es un
«no se sabe». Una serie con huecos, en cambio, se dibujaria como una linea que salta dias y se lee
como perdida de datos.

Limite declarado: eso vale **dentro** de la vida del ledger. Un rango anterior a la primera fila del
libro produce ceros legitimos («no habia libro»), igual que hoy el total de ese rango ya es cero.

### ⟨D4⟩ Las fronteras de dia se calculan en TypeScript y viajan a SQL como parametros

El troceo del rango en cubos lo hace un modulo **puro** nuevo, `lib/analytics/cubo-temporal.ts`, que
produce la lista de instantes frontera usando **exclusivamente** `inicioDelDiaCREnUtc` /
`inicioDelDiaSiguienteCREnUtc` (R11). El SQL recibe esas fronteras como parametros y **no sabe nada
de husos horarios**: no hay `AT TIME ZONE 'America/Costa_Rica'` ni `- interval '6 hours'` escrito en
ninguna consulta.

Es la unica forma de que la frontera del dia CR siga viviendo en un solo archivo
(`lib/utils/fecha-cr.ts`). Un `date_trunc` con zona horaria en SQL seria una **segunda** definicion
del dia operativo, invisible para todos los tests de `fecha-cr.ts` y para el guardia de modulo puro
— exactamente el off-by-one de seis horas que `ranges.ts:28-30` avisa de no reintroducir.

### ⟨D5⟩ El acumulado corrido se construye en el servicio, con las funciones derivadoras existentes

Para las acumuladas (H3) el repositorio devuelve **dos** cosas: (a) las sumas por `tipo` de todo lo
anterior a `rango.desde`, y (b) las sumas por `(cubo, tipo)` dentro del rango. El servicio acumula
los **componentes** (`devengo` y `pago` por separado, en `Prisma.Decimal`) cubo a cubo y llama a
`derivarCuentaPorPagar(devengoAcumulado, pagoAcumulado)` una vez por cubo.

Asi el servicio **suma**, que es lo unico que la 127 le permite hacer con dinero, y la resta con
signo la sigue haciendo la funcion compartida que `/mi-wallet` tambien usa (R17). No aparece ni un
`.sub(` nuevo, que es literalmente lo que el guardia de repositorios busca por texto
(`financiera-repositorios.guardia.test.ts:56`).

### ⟨D6⟩ Cubos semanales anclados al lunes CR, con el primero recortado al rango

Con granularidad `semana`, los cubos empiezan el lunes de Costa Rica (misma convencion que el preset
`semana` de la 135, D2). El **primer** cubo empieza en `desdeFecha` aunque no sea lunes, y su clave
es ese dia (R21): si su clave fuera el lunes anterior, la fila afirmaria contener dinero de dias que
el rango excluye. El ultimo cubo termina en `rango.hasta`.

### ⟨D7⟩ Un solo constructor de importe para el total y para cada fila (seguro anti-182)

Las filas se construyen con **la misma** funcion `importe(...)` que ya produce el total
(`AnaliticaFinancieraService.ts:83-89`). Cuando la 182 retire `neto` de las metricas de caja, el
cambio sigue siendo de un archivo y no se multiplica por el numero de filas (R27).

**Orden de aterrizaje recomendado: 182 antes que 180** (Q5). Motivo: la 182 es una decision humana ya
tomada y tocar el mismo DTO dos veces cuesta dos puertas y dos revisiones. Si el humano prefiere el
orden inverso, ⟨D7⟩ lo deja barato: lo unico que habria que reducir despues son los tests de
invariante R12/R13, que se escribirian sobre dos campos en vez de uno.

### ⟨D8⟩ Contrato de cubo temporal COMPARTIDO con la 176, declarado explicito

`lib/analytics/cubo-temporal.ts` se disena para que la feature **176** (modo agregado de tasas y
tiempos en la analitica operativa) use el **mismo** troceo. Lo que las dos features comparten no es
la carga util —la 176 necesita numerador/denominador por cubo y la 180 necesita importes— sino la
pregunta previa: *dado un `RangoResuelto`, ¿cuales son los cubos, con que clave y con que
fronteras?*. El modulo responde solo eso y no conoce ni dinero ni tasas:

```ts
// lib/analytics/cubo-temporal.ts  — PURO (sin Prisma, sin servicios, sin next/headers)
export type GranularidadTemporal = "dia" | "semana";

export interface CuboTemporal {
  /** Clave publicable: fecha calendario CR del PRIMER dia incluido (`YYYY-MM-DD`). */
  readonly clave: string;
  /** Instante UTC inclusivo de inicio (de `inicioDelDiaCREnUtc`). */
  readonly desde: Date;
  /** Instante UTC exclusivo de fin (de `inicioDelDiaSiguienteCREnUtc`). */
  readonly hasta: Date;
}

export function granularidadDe(rango: RangoResuelto): GranularidadTemporal;
export function trocear(rango: RangoResuelto): readonly CuboTemporal[];
```

Si la 176 acaba necesitando otra forma de cubo, la contradiccion aparece **en este archivo** y no
como dos contratos incompatibles descubiertos en la pantalla. Esta interaccion queda declarada aqui
y debe citarse en el spec de la 176.

---

## 3. Interacciones declaradas con las fichas hermanas vivas

| Ficha | Interaccion | Que hace esta feature |
|---|---|---|
| **176** (pending) | Necesita cubos temporales para sumar-antes-de-dividir | Publica `lib/analytics/cubo-temporal.ts` como contrato compartido ⟨D8⟩. Ninguna de las dos bloquea a la otra. |
| **179** (pending) | Cachea el dominio financiera | El DTO crece hasta ~62 filas por metrica: la 179 debe dimensionar la entrada de cache con ese tamano. **La invalidacion no cambia**: las filas por fecha salen de los mismos tres ledgers y de la misma consulta, luego los mismos escritores la invalidan. Esta feature **no** anade ni retira `cacheTag` (R30). |
| **181** (pending) | Etiquetas de tienda en los cubos por tienda | **Sin interseccion**: no se crean cubos `fecha x tienda` (R28). El `tiendaId` crudo sigue apareciendo exactamente donde aparece hoy. Si Q1 se resuelve como (b), la vista por fecha de `cuenta_por_pagar_tienda` **tampoco** llevaria tiendaId (seria una serie de la suma). |
| **182** (pending) | Retira `neto` de las 4 metricas de caja | ⟨D7⟩ + recomendacion de orden en Q5. Estos requisitos **no** dan por hecho que `neto` sobreviva: R12/R13 hablan de «campo a campo», no de dos campos concretos. |
| **132** (done) | Consumidor | R14/R16 (pinta `bruto` y `neto`), R20/R21 (agrupacion de cola) y el techo de 62 siguen cumpliendose sin tocar el tablero: la serie llega ya por debajo del techo ⟨D2⟩ y el adaptador ya sabe leer `filas` (H6). El panel de lineas es Q4. |
| **122/127** (done) | Frontera de alcance | R22-R25. La consulta sigue entrando entera; los metodos nuevos **no** aceptan filtros sueltos ni fechas sueltas. |

---

## 4. Modelo de datos

**Ninguna migracion. Ninguna tabla nueva. Ningun cambio de esquema, de RLS ni de indice.**

Lo que se lee y por que indice:

| Metrica | Tabla | Ventana | Indice que sirve |
|---|---|---|---|
| las 6 de caja | `wallet_movimiento` | `fecha_movimiento ∈ [desde, hasta)` + `categoria IN (catalogo)` | `@@index([fechaMovimiento])` (`schema.prisma:1109`) |
| `cuenta_por_pagar_mensajero` (dentro del rango) | `pago_mensajero_movimiento` | `fecha_movimiento ∈ [desde, hasta)` | `@@index([mensajeroId, fechaMovimiento])` — prefijo no util; ver nota |
| `cuenta_por_pagar_mensajero` (saldo anterior) | `pago_mensajero_movimiento` | `fecha_movimiento < desde` | idem |

**Nota de indice, declarada y no escondida:** `pago_mensajero_movimiento` solo tiene
`@@index([mensajeroId, fechaMovimiento])`, cuyo prefijo es el mensajero. Una agregacion **sin**
mensajero (R24: aqui no hay ids de persona, ni en el `where` ni en la salida) no usa ese indice y
cae en seq scan — **pero eso ya ocurre hoy** con `cuentaPorPagarMensajerosAlCorte`
(`CuentasPorPagarAnaliticaRepository.ts:81-86`), que agrega el libro entero sin cota inferior. Esta
feature **no empeora** el plan: anade una particion por cubo sobre la misma lectura. Si el volumen lo
exigiera, el arreglo es un indice por `fecha_movimiento` en ese ledger, y eso es una ficha propia con
su migracion up/down, no un anexo silencioso a esta.

---

## 5. Contratos y consultas

### 5.1 Como se agrupa por cubo sin duplicar la definicion de dia CR

Una sola consulta por metrica, con las fronteras **calculadas en TypeScript** y pasadas como array
de parametros (⟨D4⟩). La expresion de agrupacion es un indice de cubo, no una fecha:

```
-- forma (parametrizada con Prisma.sql; los limites vienen de trocear(rango))
SELECT width_bucket(fecha_movimiento, $limites) AS cubo, categoria, tipo, SUM(monto) AS suma
FROM   wallet_movimiento
WHERE  fecha_movimiento >= $desde AND fecha_movimiento < $hasta
  AND  categoria = ANY($categorias)
GROUP BY 1, categoria, tipo
ORDER BY 1, categoria, tipo
```

`$limites` es el array de instantes `desde` de cada cubo, en orden. El repositorio devuelve
`(indiceDeCubo, categoria, tipo, suma)`; **la clave publicable la pone el servicio** a partir de
`trocear(rango)`, de modo que el SQL nunca emite una fecha.

Hazards que el implementer debe verificar con un test de integracion, no suponer:

- `width_bucket(anyelement, anyarray)` exige PostgreSQL >= 14. Si no estuviera disponible, la
  alternativa equivalente es un `CASE` generado desde el mismo array de limites: misma propiedad
  (los limites siguen viniendo de TypeScript) y mismo resultado.
- `fecha_movimiento` es `timestamp(3)` sin zona (mapeo por defecto de Prisma). Los `Date` de
  JavaScript se enlazan como `timestamptz`: **hace falta el cast explicito** y hace falta el test de
  frontera (`T05:59:59.999Z` cae en el dia anterior, `T06:00:00.000Z` en el siguiente).
- El enum `categoria` requiere cast al comparar contra un array de texto.

### 5.2 Alternativas descartadas (obligatorio del proceso)

1. **Columna generada `fecha_cr date` en los tres ledgers, y `groupBy` de Prisma sobre ella.**
   *Descartada por inviable, no por gusto:* Prisma no tiene atributo para columnas
   `GENERATED ALWAYS AS ... STORED`; si el campo se declara en el datamodel, el cliente lo incluye
   en los `INSERT` y **rompe toda escritura** de los tres libros de dinero; si no se declara, `groupBy`
   no lo ve y no compra nada. Ademas anadiria una reescritura de tabla a tres tablas de dinero.

2. **`date_trunc('day', fecha_movimiento AT TIME ZONE 'America/Costa_Rica')` en SQL.** *Descartada:*
   crea una **segunda** definicion del dia operativo, fuera del alcance de `lib/utils/fecha-cr.ts` y
   de todos sus tests, y en un sitio donde el guardia de modulo puro no mira. Es el off-by-one de
   seis horas del que avisa `ranges.ts:28-30`, reintroducido por la puerta de atras. ⟨D4⟩ existe
   precisamente para no pagar esto.

3. **Traer las filas crudas (`findMany`) y agrupar en memoria.** *Descartada:* el volumen de un
   ledger append-only no esta acotado por el rango de forma util (un mes de operacion son decenas de
   miles de movimientos) y la lectura pasaria a crecer con el negocio, no con el numero de puntos que
   se van a pintar. Ademas obligaria al servicio a tocar filas individuales de dinero.

4. **Una tabla de rollup financiero diario (`analytics_daily_dinero`) alimentada por el cron.**
   *Descartada para esta feature:* duplica el dinero fuera del ledger, que es exactamente lo que la
   127 prohibe («fuente EXCLUSIVA: ledgers append-only»), y crea un segundo sitio del que puede salir
   una cifra distinta de la que alguien cobra. El coste por request lo resuelve la **179** (cache),
   que es donde el repo ya decidio resolverlo.

5. **Devolver siempre grano diario y dejar el techo al consumidor.** *Descartada:* es lo que hace hoy
   la operativa y el resultado documentado es la D3 de la 131 — el tablero **no pinta nada** en
   rangos largos y hace falta una ficha entera (la 176) para arreglarlo. Repetir ese diseno en el
   dominio del dinero seria reproducir a sabiendas un agujero conocido. Queda como opcion (b) de Q3
   por si el humano prefiere la simetria con el operativo.

6. **Una vista nueva `<metricaId>__por_fecha` en paralelo a la existente.** *Descartada:* ver ⟨D1⟩.
   Anade ids estables y `sumableCon` que nadie ha pedido, y deja la vista actual mintiendo sobre su
   propio grano.

### 5.3 Cambios de tipo (`lib/types/analitica-financiera.ts`)

```ts
/** ⟨D2⟩ — obligatoria en TODA vista. `no_temporal` en las de grano tienda / metodo_pago. */
export type GranularidadVista = "dia" | "semana" | "no_temporal";

export interface VistaFinanciera {
  // ... campos actuales, sin cambios ...
  readonly granularidad: GranularidadVista;   // NUEVO, requerido
}

/** ⟨D1⟩/R2 — las metricas cuyo desglose por fecha produce esta feature. Sujeto a Q1. */
export const IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA = [...] as const satisfies readonly MetricaFinancieraId[];
```

`FilaFinanciera` **no cambia**: su `cubo` ya esta documentado como «id de tienda, "efectivo",
"YYYY-MM-DD"…» (`analitica-financiera.ts:75`). Es el contrato ya escrito, cumpliendose por fin.

### 5.4 Repositorios (metodos nuevos)

```ts
// IIngresosAnaliticaRepository
sumarPorCuboYCategoria(
  consulta: ConsultaAnalitica,
  cubos: readonly CuboTemporal[],
): Promise<readonly AgregadoCuboCategoriaCaja[]>;   // { indiceCubo, categoria, tipo, suma }

// ICuentasPorPagarAnaliticaRepository
cuentaPorPagarMensajerosPorCubo(
  consulta: ConsultaAnalitica,
  cubos: readonly CuboTemporal[],
): Promise<readonly AgregadoCuboTipo[]>;            // { indiceCubo, tipo, suma } — dentro del rango
cuentaPorPagarMensajerosAntesDe(
  consulta: ConsultaAnalitica,
): Promise<readonly CuentaMensajeroAlCorte[]>;      // { tipo, suma } con `fecha_movimiento < desde`
```

Los tres reciben `ConsultaAnalitica` entera (R22) y `cubos` **derivado de esa misma consulta** por el
servicio: no son un canal alternativo para colar una ventana temporal propia — un test comprueba que
las fronteras usadas coinciden con `trocear(consulta.rango)`.

Los tres suman +3 al censo del guardia (H5): pasa de 8 a **11** metodos cubiertos por el test de
propagacion de errores (R25/R31).

### 5.5 Servicio

- `deCaja` y `deTesoreria`: una llamada mas al repositorio (en paralelo con la actual, o derivando el
  total de los mismos cubos — ver T3.2), `filas` construidas cubo a cubo con `derivarBalance` /
  `derivarCaja` **por cubo** y el mismo `importe(...)` del total ⟨D7⟩.
- `deCuentaDeMensajeros`: acumulado corrido ⟨D5⟩.
- `deRecaudo` y `deSaldoDeTiendas`: solo ganan `granularidad: "no_temporal"` en sus vistas (o su
  serie por fecha, si Q1 = (b)).
- `deConciliacion`: sin cambios (no tiene vistas).

---

## 6. Alcance por rol (frontera de seguridad)

Nada cambia y esa es la afirmacion que hay que probar, no suponer:

- Las diez financieras son `total` para `maestro`/`admin` y `prohibido` para los otros tres roles
  (`tests/unit/analytics/financiera-alcance.guardia.test.ts:39-51`). El desglose por fecha **no
  altera** el alcance de ninguna metrica.
- Los metodos nuevos no aceptan `tiendaId`, `zonaId` ni `mensajeroId` y no los emiten (R24): la clave
  del cubo es una fecha. **El desglose no puede convertirse en un canal de fuga por construccion**:
  no hay ninguna dimension de entidad en la salida que filtrar.
- El guardia `alcance-obligatorio.guardia.test.ts` seguira censando los archivos nuevos: cualquier
  consulta a `wallet_movimiento` o `pago_mensajero_movimiento` desde un archivo en contexto de
  analitica que **no** reciba `ConsultaAnalitica` cae, incluida la variante con SQL crudo
  (`:80-82`).
- Un test explicito: el mismo desglose pedido por un rol prohibido devuelve `forbidden` **antes** de
  tocar repositorio, igual que hoy.

---

## 7. Impacto en lo que ya esta verde

| Artefacto | Impacto | Accion |
|---|---|---|
| `financiera-repositorios.guardia.test.ts:241` | ROJO por diseno (8 → 11 metodos) | Ampliar la lista (T5.1) |
| `financiera-contratos.test.ts` (forma del DTO) | ROJO si comprueba las claves de `VistaFinanciera` | Anadir `granularidad` a la forma esperada |
| `analitica-financiera-service.test.ts`, `analitica-financiera-derivacion.test.ts` | ROJO donde aserten `filas: []` | Reescribir esas aserciones contra la serie real |
| `tests/unit/analytics/tablero-financiero-*.test.ts` (132) | Usan fixtures propios; el campo nuevo obliga a completarlos | Actualizar fixtures |
| `financiera-fuente.guardia.test.ts` | Censa por lista de archivos de la feature | Anadir los archivos nuevos al censo |
| `cache-financiera.guardia.test.ts` (128 R15) | Debe seguir VERDE sin tocarlo | R30 |

**Dos dobles conocidos que NO se tocan aqui:** `financiera-ingresos-repo.test.ts:124` y
`analitica-financiera-derivacion.test.ts:177` tienen filas cruzadas (`categoria egreso_* + tipo
ingreso`) que la 173 dejo a proposito esperando a la **182**. Si esta feature copia esos dobles para
los cubos, copiara el problema: los dobles nuevos deben usar filas coherentes con el CHECK
`categoria ↔ tipo`.

---

## 8. Verificacion

Ademas de lo listado en `requirements.md` §4:

- **Invariante de conservacion (R12) como test de propiedad**, no como un caso: para un conjunto de
  movimientos generado, `Σ filas == total` en decimal exacto, en las dos granularidades.
- **Frontera de dia (R11)** en integracion contra la base de test: dos movimientos a
  `2026-03-10T05:59:59.999Z` y `2026-03-10T06:00:00.000Z` caen en cubos **distintos**, y el segundo
  en el cubo con clave `2026-03-10`.
- **Techo (R19)** como test parametrico sobre 1, 62, 63, 365 y 366 dias: nunca mas de 62 filas.
- **Regresion (R15)**: el `total` de cada metrica antes y despues del cambio, con los mismos dobles.
- `./init.sh --rapido` por tanda; `./init.sh` completo antes del PR.
