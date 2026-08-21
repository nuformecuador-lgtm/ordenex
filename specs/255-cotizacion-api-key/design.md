# Feature 255 — design

Decisiones técnicas ANTES de escribir código. Todo lo que se cita del árbol está verificado
contra la rama activa (`ux`, que en `lib/**`, `app/api/**`, `middleware.ts` y
`tests/unit/guards/**` es idéntica a `origin/dev`).

---

## 1. Modelo de datos

**No hay ninguno.** Esta feature NO crea tablas, NO altera columnas, NO añade índices y por tanto
**NO trae migración** (ni `migration.sql` ni `down.sql`) y **no introduce ninguna superficie RLS
nueva**. Todo lo que lee ya existe:

| Dato | Origen | Ya existe |
| --- | --- | --- |
| Provincias / cantones / distritos (+ `zonaId`, `esCentral`) | `IOrdenRepository.findAllProvincias` / `findCantonesByProvinciaIds` / `findDistritosByCantonIds` | sí (feature 15/24) |
| Tarifa de la tienda (7 campos, STRING escala 2) | tabla `tarifas` vía `TarifaVigentePorTiendaRepository` | sí (features 42/69) |
| Actor dueño | `ApiKeyAuthService.autenticar` | sí (feature 88) |

Consecuencia para `CHECKPOINTS.md`: los ítems de migración/RLS se cierran con "no aplica, la
feature no toca el esquema", y eso se verifica con una guardia de diff (tarea T14).

## 2. Ruta y borde HTTP

```
POST /api/ordenes/api-key/cotizacion
app/api/ordenes/api-key/cotizacion/route.ts     ← Controller
```

- **Convive con `[numGuia]`.** El segmento estático gana al dinámico en el App Router, y el
  precedente ya está en el árbol: `carga/` y `orden/` son hermanos estáticos de `[numGuia]/`
  desde las features 88 y 177. No hay conflicto de rutas que resolver.
- **`runtime = "nodejs"`** (Prisma) y **`maxDuration = 60`**, el mismo presupuesto que la carga
  para un lote del mismo tamaño (menos el render del PDF, que aquí no existe).
- **Middleware: NADA que tocar.** `middleware.ts:32` declara `"/api/ordenes/api-key"` en
  `SELF_AUTH_ROUTES` y `matches()` compara por prefijo (`pathname.startsWith(`${r}/`)`), así que
  un subpath nuevo pasa sin registrarse en `PUBLIC_ROUTES`. **Eso es lo que mantiene VERDE la
  guardia de la feature 229**, que congela posicionalmente las tres listas del middleware.
  Escrito aquí para que nadie lo re-descubra ni "arregle" el middleware de paso.
- **Autenticación idéntica a la carga:** `extraerBearer(req)` + `ApiKeyAuthService.autenticar`.
  `unauthenticated -> UnauthenticatedError (401)`, `forbidden -> ForbiddenError (403)`
  (`app/api/ordenes/api-key/carga/route.ts:193-247`). **No hay ni habrá un `if (tieneApiKey)`**:
  después de autenticar sería código muerto e inalcanzable (R5).
- Los errores salen por `withErrorHandler` + `appErrorToResponse` (feature 10), que es lo que
  garantiza R49: la shape de error no incluye headers y por tanto la key nunca viaja de vuelta.

### 2.1 Contrato de entrada

```jsonc
{
  "ordenes": [
    {
      "provincia": "San José", "canton": "Escazú", "distrito": "San Rafael",
      "direccion": "Multiplaza, local 12",     // se acepta; no participa del precio
      "monto_cobrar": "25900",                  // texto; base de la comisión COD
      "num_remision": "REM-0001"                // OPCIONAL: solo correlación (Q5)
    }
  ]
}
```

- `z.array(z.record(z.string(), z.string())).min(1).max(cargaMasivaConfig.MAX_CHUNK_ROWS)` —
  mismo tope que la carga (R8), mismo shape de fila cruda (R7).
- El objeto zod **NO es `filaCargaSchema`**: allí `num_remision`, `destinatario`, `telefono` y
  `producto` son obligatorios y aquí no aportan al precio (Q5). Se define
  `filaCotizacionSchema` en `lib/types/cotizacion.ts` con lo que la cotización realmente
  necesita: la terna geográfica + `monto_cobrar` + `num_remision` opcional. Las claves extra se
  ignoran en silencio (zod no-strict), igual que en la carga: así el integrador puede mandar el
  MISMO cuerpo que le manda a `/carga` sin recortarlo, que es el punto de la feature.
- **`monto_cobrar` se conserva como STRING.** `filaCargaSchema` lo pasa por `Number(value)`
  (`lib/types/carga-masiva.ts:88-101`) porque la columna lo recibe como número; aquí NO, porque
  es la BASE de la comisión y `derivarIngresoOrden` espera `montoCobrar: string | null`. Se valida
  con una expresión regular de decimal no negativo y se entrega tal cual al `Prisma.Decimal`. Ese
  es exactamente el `Number(` sobre dinero que este repo persigue con tres guardias.

### 2.2 Contrato de salida (200)

```jsonc
{
  "total": 2, "cotizadas": 1, "conError": 1,
  "totales": {                                  // D2 (firmada 2026-08-21): por fila Y por lote
    "filasSumadas": 1, "filasExcluidas": 1,     // R54: el total NUNCA calla lo que dejó fuera
    "entregado": { "flete": "₡2.500,00", "iva": "₡325,00", "comision": "₡906,50",
                   "ivaComision": "₡117,85", "total": "₡22.050,65" },
    "devuelto":  { "flete": "₡1.396,46", "iva": "₡181,54", "comision": "₡0,00",
                   "total": "-₡1.578,00" }
  },
  "filas": [
    {
      "fila": 1, "numRemision": "REM-0001", "resultado": "cotizada",
      "costos": {
        "entregado": { "flete": "₡2.500,00", "iva": "₡325,00", "comision": "₡906,50",
                       "ivaComision": "₡117,85", "total": "₡22.050,65" },
        "devuelto":  { "flete": "₡1.396,46", "iva": "₡181,54", "comision": "₡0,00",
                       "total": "-₡1.578,00" }
      }
    },
    { "fila": 2, "numRemision": null, "resultado": "error",
      "errores": { "distrito": ["distrito no encontrado en el canton"] } }
  ]
}
```

- `resultado` ∈ `"cotizada" | "error"`. **No existe `"duplicada"`** (R10): sin persistencia,
  "duplicada" no significa nada.
- Una fila `error` NO trae `costos` (R22); una fila `cotizada` NO trae `errores`.
- **Bloque `totales` de lote** (D2, firmada 2026-08-21 — R51–R56). El precio depende del
  `esCentral` de la zona de CADA fila, así que el total del lote **no es un precio, es una SUMA**,
  y el contrato lo dice de tres maneras a la vez: vive bajo la clave `totales` (no `costo`),
  espeja exactamente la forma de una fila (`entregado` con cinco conceptos, `devuelto` con cuatro
  — la asimetría de R27 se conserva arriba también, porque una suma de devoluciones tampoco lleva
  IVA de comisión), y **declara sus dos contadores**. Ver §5.3 para cómo se suma.
- El supuesto `cobra_comision = true` (R29) se declara en la **descripción OpenAPI** del endpoint,
  no como campo del cuerpo. Se evaluó emitir `supuestos: { cobraComision: true }` y se descartó:
  es un campo que nadie pidió y que habría que mantener; el sitio donde un integrador busca los
  supuestos de un precio es la documentación del contrato.

### 2.3 Error de tarifa ausente (R13)

`409 CONFLICT` con `ConflictError`, mensaje fijo en `lib/services/mensajes-cotizacion.ts`:

> `la tienda no tiene una tarifa vigente asociada: no se puede cotizar`

Por qué 409 y no 422: el cuerpo del integrador es válido; lo que falta es una precondición del
ESTADO de la cuenta. `MSG.CONFLICT` describe justo eso ("La operacion entra en conflicto con el
estado actual", `lib/errors/codes.ts:30`), y 422 mandaría al integrador a revisar su payload, que
es donde no está el problema. El mensaje no nombra tienda, key ni fila (R16).

**Orden de evaluación, y es normativo (R14):**
`auth (401/403)` → `cuerpo (422)` → `tarifa (409)` → `geo + costos por fila (200)`.
La tarifa se resuelve UNA vez por petición (R11) y **antes** de precargar la geografía, así que
una tienda sin tarifa ni siquiera paga la lectura del árbol geográfico.

---

## 3. La asimetría con la carga, declarada de frente

`BulkOrdenService.cargarViaApi` resuelve la tarifa una vez por lote y, si es `null`, tarifa TODO
el lote a `"0.00"` vía `costoEnvioDeTarifa` (`lib/utils/ingreso-ordenex.ts:114-119`). Eso es el gap
D1/R8 de la feature 98, **aceptado a propósito**.

La 255 **invierte esa regla, y solo para este borde**:

| | Carga (88/98/141/155) | Cotización (255) |
| --- | --- | --- |
| Sin tarifa | `costoEnvio: "0.00"`, la orden se crea | `409`, no se cotiza ninguna fila |
| Por qué | el paquete se va a mover igual y el dinero se liquida después | el precio ES la respuesta; un 0.00 sería una mentira sobre dinero |

**No se toca `costoEnvioDeTarifa` ni la carga.** Cambiar la carga es otra ficha, toca dinero ya
liquidado y rompería el contrato público (R50). La forma de no arrastrar el gap es simplemente
**no llamar a `costoEnvioDeTarifa` desde la cotización**: la 255 llama a `derivarIngresoOrden`, y
por delante ya se ha garantizado que la tarifa no es `null`, así que su rama `tarifa === null`
(que devuelve `{}` = todos los conceptos ausentes) es inalcanzable desde aquí. Ese "inalcanzable"
se fija con un test (T10.3), porque es la única línea que podría reintroducir el cero mudo.

---

## 4. Tarifa cotizable: la 255 NO depende de la 70

La ficha de la 70 (leída entera) dice, medido contra producción:
`TarifaVigentePorTiendaRepository.resolveTarifaPorTienda` filtra `{tiendaId, deletedAt: null}` SIN
mirar `status` (`lib/repositories/TarifaVigentePorTiendaRepository.ts:71`), de modo que una tarifa
`inactivo` se resuelve como vigente. Y su hallazgo contraintuitivo: como cada tienda tiene
EXACTAMENTE UNA tarifa, filtrar `status` allí no cae en una tarifa anterior — resuelve `null`, que
en el camino de la carga/cierre significa **conceptos 0.00**. Es decir: allí filtrar convierte un
cobro equivocado en un cobro CERO, y por eso la 70 sigue pendiente y bajo gate.

**Aquí ese argumento se invierte y por eso filtrar SÍ es seguro:** en la cotización `null` NO
degrada a cero, dispara el `409` de R13. Filtrar `status` no puede producir un precio falso;
produce una negativa explícita.

**Decisión:** la 255 **no declara `depends_on: 70`**. Define su propio criterio con un método
NUEVO en el repositorio existente:

```ts
// lib/interfaces/repositories/ITarifaVigentePorTiendaRepository.ts (extensión)
resolveTarifaCotizablePorTienda(tiendaId: string): Promise<TarifaVigente | null>;
// where: { tiendaId, deletedAt: null, status: "activo" }, orderBy createdAt desc, first
```

Por qué un método nuevo y no un parámetro del existente:
1. La guardia de la 69 (`tests/unit/repositories/tarifa-vigente-por-tienda-repository.test.ts:70-83`
   y `:141-150`) afirma DELIBERADAMENTE que el `where` de los DOS métodos existentes **no menciona
   `status`**, para que un cambio de dinero no entre de contrabando. Inspecciona los argumentos de
   la llamada mockeada, método a método: **un método nuevo no la pone roja**, y el `TODO:` del
   fuente —que otro test exige por grep— se conserva intacto.
2. La 70 sigue siendo dueña de la decisión sobre el camino de liquidación. Cuando se cierre y el
   resolver compartido filtre `status`, este método se colapsa en aquel: queda escrito en el
   docstring del método nuevo y en `progress/impl_255_backend.md` como deuda con salida nombrada.

**Riesgo declarado:** durante la ventana entre la 255 y la 70, una tarifa inactiva cotizará
distinto (409) de como liquidará el cierre (contra la tarifa inactiva). Hoy eso es teórico: la 70
midió CERO tarifas inactivas en producción. Se declara para que, el día que exista la primera, se
sepa dónde mirar.

---

## 5. Capas

```
app/api/ordenes/api-key/cotizacion/route.ts     Controller: bearer, zod, mapeo de errores
  └─ lib/services/CotizacionOrdenService.ts     Service: orquesta tarifa + geo + los 2 escenarios
       ├─ lib/services/geo-resolucion.ts        [EXTRAÍDO] resolveGeo + índices + extractor
       ├─ lib/utils/ingreso-ordenex.ts          derivarIngresoOrden  (SIN TOCAR)
       ├─ lib/utils/monto-cotizacion.ts         [NUEVO] formateo, último paso
       ├─ lib/repositories/OrdenRepository      (solo lecturas geográficas ya existentes)
       └─ lib/repositories/TarifaVigentePorTiendaRepository  (+1 método, §4)
```

Interfaces en `lib/interfaces/services/ICotizacionOrdenService.ts` y tipos en
`lib/types/cotizacion.ts`, según `docs/architecture.md`. El service **no conoce HTTP**: devuelve
un resultado discriminado (`{ status: "ok", ... } | { status: "sin_tarifa" } | { status:
"forbidden" }`) y el controller lo traduce, igual que hace `cargarViaApi`.

### 5.1 Extracción de `resolveGeo` (el único toque al fuente de la carga)

`resolveGeo`, `indexBy`, `lookup`, `normalize` y `geoInputDesdeColumnasSeparadas` son hoy privados
de `BulkOrdenService.ts` (líneas ~47-213). Se **mueven tal cual** a `lib/services/geo-resolucion.ts`
y `BulkOrdenService` los importa. Es una MUDANZA, no un cambio de comportamiento: ni una cadena de
mensaje, ni una rama, ni un orden de comprobación cambian, y las suites existentes de la carga son
la prueba (T4.2 exige que pasen sin editarlas).

Se descartó **duplicar `resolveGeo` en el service nuevo**: los tres mensajes de no-cobertura
tendrían dos dueños y derivarían a la primera corrección de una errata, que es exactamente lo que
la ficha prohíbe ("reusar sus mensajes tal cual"). Un test de paridad byte a byte (T6.4) blinda
que los tres mensajes que emite la cotización son los MISMOS strings que emite la carga.

**Cobertura y precio salen del MISMO paso**: `resolveGeo` devuelve `esCentral` del distrito
(`BulkOrdenService.ts:175`), y ese flag es el que elige la columna de flete. No hay dos pasadas.

### 5.2 Los dos escenarios

```ts
const input = { esCentral, montoCobrar, cobraComision: true };   // R25, R29
const entregada = derivarIngresoOrden({ ...input, resultado: "entregada" }, tarifa);
const devuelta  = derivarIngresoOrden({ ...input, resultado: "devuelta"  }, tarifa);
```

Dos llamadas, cero aritmética propia (R24). El precedente está medido: feature 204 — el navegador
recalculaba flete e IVA por su cuenta y **14 de 66 órdenes salían con un céntimo de diferencia
contra el cierre**, por dos causas distintas (el binario y un redondeo intermedio ausente). Los
únicos cálculos propios de esta feature son las dos SUMAS/RESTAS de `total` (R30/R31), y van con
`Prisma.Decimal`:

```
entregado.total = Decimal(montoCobrar ?? 0) − (flete + iva + comision + ivaComision)
devuelto.total  = −(flete + iva)
```

`comision`/`ivaComision` llegan como `Prisma.Decimal | undefined` (ausentes si no se cobra
comisión); en el escenario devuelto siempre ausentes, y ahí es donde nace el **cero explícito** de
R28: `comision: formatear(derivado.ingreso_comision_cod ?? new Decimal(0))`. El contrato dice cero
porque **no se cobra**, no porque falte el dato.

**Los signos están FIRMADOS** (decisión D1, 2026-08-21): `entregado.total` es lo que la TIENDA
RECIBE (positivo cuando el COD supera lo facturado) y `devuelto.total` es la DEUDA de la tienda
(negativo). Invertirlos —p. ej. para leerlos como "lo que factura Ordenex"— **es un cambio de
contrato publicado, no un ajuste de implementación**: pasa por otra puerta.

### 5.3 La suma del lote (R51–R56)

El acumulador del lote es un **`Prisma.Decimal` por concepto y por escenario**, alimentado con los
`Prisma.Decimal` de cada fila **ANTES de formatear**. El formateo del bloque de lote es una sola
llamada por concepto, al final, con el mismo `formatMontoCotizacion` que las filas:

```
por cada fila cotizada:  acc[escenario][concepto] = acc[escenario][concepto].plus(valorDecimal)
al terminar:             totales[escenario][concepto] = formatMontoCotizacion(acc[...])
```

**Prohibido y verificado (R55):** sumar los strings ya formateados, o re-parsear un `"₡1.578,00"`
para volver a operar con él. Eso sería el `Number(` sobre dinero que este repo persigue con tres
guardias, y aquí sería peor que en una pantalla: el resultado se sirve como precio. Por eso el
service acumula Decimales y **el formateador solo se llama en la frontera de salida**, nunca en
medio de un cálculo. Con `formatMontoCotizacion(valor: Prisma.Decimal)` (§6c) la regla es
estructural: la función no acepta un string, así que no hay forma de encadenar dos formateos.

**Qué filas suman (R53):** solo las `cotizada`. Una fila sin cobertura no tiene precio, así que no
puede aportar ni un cero — aportar cero la haría indistinguible de una fila gratis.

**Los dos contadores (R54)** son la contrapartida obligatoria de esa exclusión:
`filasSumadas + filasExcluidas === total`, y se emiten SIEMPRE. Sí, coinciden con los
`cotizadas`/`conError` de la raíz, y la redundancia es DELIBERADA: viven DENTRO del bloque porque
un consumidor que lea solo `totales` (una UI de "cuánto me cuesta este archivo", que es el uso
obvio) no puede quedarse con el importe sin ver de cuántas filas sale. Un test fija la coherencia
entre los dos pares para que no puedan divergir. Un total que calla las filas que
dejó fuera se lee como "esto cuesta el lote" cuando no lo es; es el mismo fallo silencioso que este
repo ya tiene fichado tres veces (248, 252, 254) y por eso el contador es parte del contrato, no
un extra de cortesía.

**Borde del cero (R56):** un lote donde ninguna fila cotiza emite `totales` igual, con todos los
importes en `₡0,00`, `filasSumadas: 0` y `filasExcluidas` = total. Cero es una afirmación; ausente
es un dato que falta. Mismo criterio que ya se aplicó al cero de `devuelto.comision` (R28). Nótese
que este caso convive con un `200`: sin tarifa no se llega hasta aquí (es un `409`, §2.3), así que
un `totales` en cero significa siempre "ninguna fila tuvo cobertura", nunca "no había tarifa".

---

## 6. El choque con la guardia 230 (dinero sin céntimos) y cómo se resuelve

La feature 230 decidió que el dinero se pinta SIN céntimos (`₡13.331.833`) y lo blindó con
`tests/unit/guards/dinero-sin-centimos.guardia.test.ts`, cinco dientes. Los 2 decimales que pide
esta feature chocan de frente:

| Diente | Qué prohíbe | Impacto en la 255 |
| --- | --- | --- |
| 1 | que los CINCO caminos públicos (`formatMontoString`, `money`, `formatMonto`, `PriceLabel`, `formatearValor(·,"moneda")`) emitan el separador decimal seguido de dígito | **`formatMontoString` NO sirve**: redondea a entero y descarta la cola (`lib/config/moneda.ts:146-149,216`) |
| 2 | TODO `.toFixed(` en `app/**` y `components/**` fuera de lista blanca | **la ruta no puede serializar dinero**; el formateo vive en `lib/` |
| 3 | (excepción declarada) las descargas XLSX/CSV NO pasan por el formateador: "la contabilidad los necesita" | **este es el precedente a invocar** |
| 5 | docstrings de la superficie de dinero que prometan decimales | el módulo nuevo **no** entra en `SUPERFICIE_DOCUMENTADA`, pero tampoco puede vivir dentro de `lib/config/moneda.ts` (su prosa se barre y un ejemplo `₡1.578,00` la pondría roja) |

**Decisión (a) — dónde vive.** Módulo NUEVO `lib/utils/monto-cotizacion.ts`, fuera de
`lib/config/moneda.ts` y fuera de los dos árboles de pantalla. `lib/` es donde `.toFixed(2)` ya
vive legítimamente.

**Decisión (b) — cómo se declara la excepción.** Se AMPLÍA la guardia de la 230 con un **diente 6:
"salidas de máquina"**, hermano explícito del diente 3, en el mismo archivo y con la misma forma
(censo por ruta + contraprueba). Afirma tres cosas:
1. `lib/utils/monto-cotizacion.ts` existe y **no es** ninguno de los cinco caminos públicos ni es
   importado desde `app/**` ni `components/**` (ninguna pantalla lo consume) — salvo el route
   handler del canal por API key, que es contrato de máquina y se nombra en el censo;
2. **SÍ emite exactamente dos decimales** (afirmación POSITIVA: si alguien "arregla" el módulo
   para alinearlo con las pantallas, la guardia se pone roja y la cotización no pierde céntimos en
   silencio);
3. la prosa del diente 3 y la cabecera del archivo pasan a decir "descargas XLSX/CSV **y salidas
   de máquina**", para que la excepción no aparezca meses después como un rojo inexplicable.

Se descartó ampliar `LISTA_BLANCA_TO_FIXED`: esa lista es para `app/**`/`components/**` y aquí no
hace falta, porque nada de la 255 serializa dinero en esos árboles. Y se descartó tocar
`monedaConfig`: los tres caracteres se LEEN de allí (R36) y nada más.

**Decisión (c) — el formato al carácter.**

```ts
export function formatMontoCotizacion(valor: Prisma.Decimal): string
```

Recibe `Prisma.Decimal`, no string: así el formateo es literalmente el último paso y no existe la
rama "verbatim" de `formatMontoString` (la única por la que puede salir texto sin forma de
importe). Serializa internamente con `toFixed(2)`, separa signo/enteros/decimales, agrupa la parte
entera de tres en tres **desde la derecha** y compone:

```
[signo][monedaConfig.simbolo][enteros agrupados con monedaConfig.separadorMiles][monedaConfig.separadorDecimal][2 dígitos]
```

Ninguno de los tres caracteres se escribe a mano (`docs/architecture.md` §4, "sin hardcode de
contexto"). **La agrupación se calcula DESPUÉS del redondeo** (que ya hizo `derivarIngresoOrden`
con `ROUND_HALF_UP` a escala 2), porque un acarreo puede añadir un dígito y cambiar la agrupación
entera — es la misma lección que dejó escrita la 230 (`lib/config/moneda.ts:118-121`).

### 6.1 Tabla de contrato del formateo (bordes incluidos)

Con `monedaConfig` por defecto (`simbolo "₡"`, `separadorMiles "."`, `separadorDecimal ","`):

| # | Entrada (`Prisma.Decimal`) | Salida | Borde que fija |
| --- | --- | --- | --- |
| 1 | `0` | `₡0,00` | cero: dos decimales, sin signo (R38) |
| 2 | `-0` / `-0.00` | `₡0,00` | **"menos cero" no se emite** (R38) |
| 3 | `7` | `₡7,00` | un dígito, cola sintética |
| 4 | `7.5` | `₡7,50` | escala < 2 → se completa a 2 |
| 5 | `999` | `₡999,00` | 3 dígitos exactos: **sin separador delante** |
| 6 | `1000` | `₡1.000,00` | múltiplo de 3: primer grupo de 1 |
| 7 | `1578` | `₡1.578,00` | el ejemplo del humano, positivo |
| 8 | `-1578` | `-₡1.578,00` | **signo DELANTE del símbolo** (R37) |
| 9 | `-1578.4` | `-₡1.578,40` | negativo con cola |
| 10 | `999.995` redondeado por la aritmética → `1000.00` | `₡1.000,00` | **acarreo que cambia el nº de dígitos**: se redondea y LUEGO se agrupa (R39) |
| 11 | `13331832.72` | `₡13.331.832,72` | agrupación múltiple; el mismo importe que las pantallas pintan `₡13.331.833` |
| 12 | `99999999999.51` | `₡99.999.999.999,51` | 11 dígitos: no cabe exacto en un `number` → nunca se convierte |
| 13 | `0.004` redondeado por la aritmética → `0.00` | `₡0,00` | un céntimo que se cae no reaparece como signo |
| 14 | `-0.5` | `-₡0,50` | negativo menor que la unidad: el signo SÍ sobrevive |

Filas 10 y 13 documentan el reparto de responsabilidades: **el redondeo es de la aritmética**
(`round2`/`aplicarPorcentaje` dentro de `derivarIngresoOrden`), el formateador **no redondea**,
solo agrupa y compone. Un formateador que redondeara sería un segundo lugar donde el dinero
cambia de valor.

---

## 7. Alternativas descartadas

**A1 — Un flag `dryRun` colgado de `POST /api/ordenes/api-key/carga`.** *Descartada.* Metería un
camino que NO persiste dentro de la ruta que SÍ persiste: la misma URL, el mismo handler y la
misma respuesta significarían cosas opuestas según un booleano del cuerpo. Un error de
serialización del cliente (o un default mal leído) pasaría de "no cobré nada" a "creé 5000
órdenes con guía". Además obligaría a versionar el contrato público de la 88/141/155, que R50
manda dejar intacto. La ficha ya lo prohíbe explícitamente y esta feature lo confirma.

**A2 — Reutilizar `costoEnvioDeTarifa` (feature 98) como fuente del precio.** *Descartada.*
Devuelve `"0.00"` cuando no hay tarifa (`lib/utils/ingreso-ordenex.ts:115`) y solo cubre
flete + IVA: no conoce comisión COD, ni IVA de comisión, ni flete de devolución. Serviría para
UN escenario de los dos y arrastraría el gap que esta feature existe para invertir.

**A3 — Emitir cada importe DOS veces (crudo escala 2 + formateado).** *Descartada por decisión
firmada del humano el 2026-08-21*, tras planteársele el riesgo: un integrador no puede sumar
`"₡1.578,00"` sin parsear símbolo y separadores, y el resto de la API por key emite crudo
(`costoEnvio: "0.00"`, `openapi-spec.ts:707-711`). Lo reafirmó. Queda cerrado y no se reabre; lo
que sí se conserva es la mecánica: `Prisma.Decimal` de punta a punta, formateo como último paso,
y **nunca** re-parsear lo formateado.

**A4 — `depends_on: 70` (bloquear la 255 hasta que se decida el filtro de `status`).**
*Descartada*, con el argumento de §4: en la cotización, filtrar `status` no puede degradar a un
precio falso porque el `null` dispara un 409. Bloquear la 255 detrás de una ficha `pending` de
prioridad baja, y preventiva por medición propia, sería pagar el coste sin cobrar el beneficio.
**Aprobado en la puerta del 2026-08-21 (decisión D6).**

**A5 — Duplicar `resolveGeo` en el service nuevo** en vez de extraerlo. *Descartada:* dos dueños
para los tres mensajes de no-cobertura → drift a la primera corrección. Ver §5.1.

**A6 — Un `CotizacionRepository` propio para la geografía.** *Descartada:* `IOrdenRepository` ya
expone exactamente las tres lecturas necesarias, usadas por `precargar`. Un repositorio nuevo
sería una segunda forma de leer las mismas tablas, con su propio riesgo de divergir en el
`normalize`.

**A7 — Sumar el lote a partir de los importes YA FORMATEADOS de cada fila.** *Descartada*, y es
la alternativa más tentadora del bloque nuevo: el service ya tiene los strings a mano y sumarlos
"solo requiere" quitar el símbolo y cambiar la coma por punto. Es exactamente el `Number(` sobre
dinero que tres guardias de este repo persiguen, y el precedente está medido (feature 204: 14 de
66 órdenes con un céntimo de diferencia). Se acumula en `Prisma.Decimal` y se formatea una sola
vez (§5.3, R55).

**A8 — Omitir el bloque `totales` cuando ninguna fila cotiza.** *Descartada:* un bloque ausente
obliga al integrador a distinguir "no me lo mandaron" de "vale cero", y las dos cosas se leen igual
en un cliente mal escrito. Se emite en cero con `filasExcluidas` = total (R56), mismo criterio que
el cero explícito de `devuelto.comision`.

**A9 — Emitir el total del lote sin contadores.** *Descartada:* un importe de lote que no dice
cuántas filas quedaron fuera afirma un precio que nadie pagó. Fallo silencioso de la familia
248/252/254. Los contadores son parte del contrato (R54).

---

## 8. Verificación y guardias que hay que mirar antes de dar por hecha la feature

1. **`tests/unit/api/openapi-177-paths-pdf-y-carga-id.test.ts:71-97`** — congela la lista de paths
   del canal por API key **en exactamente SIETE**, en el objeto TS y en el `.yaml`, y en el mismo
   orden. Publicar el octavo endpoint (R47) **pone esa guardia ROJA**. Es su trabajo: la lista se
   actualiza a ocho A PROPÓSITO, en el mismo commit que publica el endpoint, con el path nuevo
   nombrado en `PATHS_ESPERADOS` y en el `.yaml` espejo. Es la misma familia que la guardia 229 —
   una lista firmada que solo se mueve con una decisión, no de contrabando.
2. **`tests/unit/guards/dinero-sin-centimos.guardia.test.ts`** — dientes 1, 2, 3 y 5; el diente 6
   nuevo lo añade esta feature (§6b).
3. **`tests/unit/repositories/tarifa-vigente-por-tienda-repository.test.ts:70-83,141-150,227`** —
   los dos `where` existentes siguen sin mencionar `status` y el `TODO:` sigue localizable por
   grep. El método nuevo no puede tocar ninguna de las dos cosas.
4. **La guardia 229 del middleware** debe seguir verde SIN editarla (R48). Si alguien la edita en
   esta feature, es señal de que tocó `PUBLIC_ROUTES` y eso está mal.
5. **Suites de la carga por API** (`cargarViaApi`, route de carga): verdes **sin editarlas**, que
   es la prueba de que la extracción de §5.1 fue una mudanza (R50).

**E2E (Playwright): no.** `CHECKPOINTS.md` lo exige para flujos críticos de ingesta de órdenes;
este borde no ingesta nada, no tiene UI y su superficie es un contrato JSON autenticado por key.
Lo cubre un test de integración sobre el route handler con dependencias inyectadas (mismo patrón
que `handleCargaApi`). La decisión se declara aquí para que el reviewer no la lea como un olvido.
