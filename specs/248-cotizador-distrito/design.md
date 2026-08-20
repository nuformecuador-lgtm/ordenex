# Feature 248 — Cotizador de envío por distrito · design.md

> El QUÉ está en `requirements.md`. Aquí van las decisiones técnicas, los contratos de I/O y —
> obligatorio— las alternativas descartadas con su motivo.
>
> **16 decisiones (D1…D16), 7 alternativas descartadas explícitas.** Las seis firmas humanas del
> **2026-08-20** están absorbidas en D3, D6, D12, D14, D15 y D16. **No queda ninguna pregunta
> abierta.**

---

## §1. Forma general

Dos superficies, **dos operaciones separadas**, un núcleo de dominio común y —desde la firma 4— una
**resolución geográfica compartida** con el camino que crea órdenes:

```
app/cotizador/page.tsx                    (Server Component, publico)
  └─ CotizadorForm.tsx (client)  ──►  lib/actions/cobertura-publica.ts   ('use server', SIN actor)
                                            └─► CoberturaService.consultar()          ← SOLO cobertura
                                                     └─► CoberturaDistritoRepository
                                                              └─► lib/utils/resolucion-geografica.ts  ◄─┐
                                                                                                         │ MISMO
app/api/ordenes/api-key/cotizar/route.ts  (Route handler, Bearer ordx_)                                  │ modulo
  └─► CotizadorService.cotizar(actor, entrada)                                        ← cobertura+costos │
          ├─► CoberturaDistritoRepository ──► lib/utils/resolucion-geografica.ts  ───────────────────────┤
          ├─► TarifaVigentePorTiendaRepository       (tarifa de actor.usuarioId)                         │
          └─► lib/utils/ingreso-ordenex.ts           (derivarIngresoOrden / pagoTiendaOrdenex)           │
                                                                                                         │
lib/services/BulkOrdenService.ts (carga masiva + carga por API)  ────────────────────────────────────────┤
lib/repositories/OrdenRepository.findDistritosByCantonIds       ────────────────────────────────────────┘
```

**El punto arquitectónico de toda la feature:** `CoberturaService` **no conoce** tarifas ni
aritmética; `CotizadorService` **compone** cobertura + tarifa. La superficie pública no puede
derivar un importe porque su grafo de dependencias no llega al dinero (R10), y eso se fija con una
guardia estática (§7).

---

## §2. Modelo de datos

**Ninguna tabla nueva, ninguna columna nueva, ninguna migración (R39).** El cotizador es 100 %
lectura sobre lo que ya existe:

| Dato | Origen | Nota |
| --- | --- | --- |
| Cobertura | `zona_distrito` (`ZonaDistrito`, `db/schema.prisma:468-480`) | N:M; **no existe** `distrito.zona_id` |
| Variante de flete | `zona.es_central` (`schema.prisma:413`) | elige columna, nunca fórmula |
| Geografía | `provincia` → `canton` → `distrito` | resolución por nombre normalizado (D12) |
| Tarifa | `tarifas.tienda_id` vía `TarifaVigentePorTiendaRepository` | `deleted_at IS NULL`, más reciente |

**RLS:** no hay tabla nueva. El acceso a `tarifas` sigue exactamente el camino del cierre y de la
carga por API; el aislamiento por tienda lo impone el service (`tiendaId = actor.usuarioId`, R15),
igual que `BulkOrdenService.ts:369` y `EtiquetaGuiaService.ts:36-39`.

---

## §3. Decisiones

### D1 — La entrada geográfica es el TRÍO DE NOMBRES (provincia, cantón, distrito), en ambas superficies

Ningún contrato publicado expone uuids de distrito: la carga por API key ya identifica la geografía
por nombre (`BulkOrdenService.ts:94-178`). Un integrador que cotiza con lo mismo con lo que después
carga obtiene una respuesta que **se corresponde con la orden que va a crear**. La superficie pública
usa el mismo trío (lo produce su cascada), de modo que hay **un solo contrato de entrada** y —tras
D12— **un solo resolvedor**.

*Alternativa descartada — `distritoId` (uuid):* obligaría a publicar un catálogo de ids internos
(nuevo endpoint público, nueva superficie de datos) y dejaría dos contratos distintos, uno por
superficie. Además, un uuid cotizado no garantiza que la carga posterior resuelva el mismo distrito,
porque la carga resuelve por nombre.

### D2 — Distrito con >1 zona: resultado NO DETERMINADO, nunca una zona elegida (R4/R16)

Se adopta el trato ya firmado en `OrdenRepository.ts:1207-1218`: exactamente una zona → resuelve;
0 → sin zona; >1 → no derivable. Si el cotizador eligiera una zona (la primera, la más antigua…),
podría prometer un flete GAM que la carga de esa misma orden rechazaría por ambigua. Tras D12 esta
regla existe **una sola vez** en el código (R35).

*Alternativa descartada — devolver las N zonas y cotizar todas:* multiplica la respuesta, obliga a
decidir cuál factura el cierre (que hoy **no puede** facturarla: la orden no llegaría a crearse) y
convierte un dato inconsistente en un menú.

### D3 — Superficie pública: página propia **`/cotizador`** en `PUBLIC_ROUTES` (firma 3)

La decisión (a) es explícita: página pública sin sesión. `PUBLIC_ROUTES` compara con `startsWith`
(`middleware.ts:39-41`), así que `/cotizador` abre `/cotizador/*` y nada más. **Consecuencia
obligatoria:** actualizar `LISTAS_ESPERADAS.PUBLIC_ROUTES` de
`tests/unit/guards/rastreo-sin-ruta-nueva.guardia.test.ts:54-61` en el MISMO PR (R38, T6.1).

**⚠ RIESGO ACEPTADO POR EL HUMANO (2026-08-20).** El nombre `/cotizador` **promete más de lo que esa
superficie da**: ahí no hay ni un importe, porque sin tienda no hay tarifa (decisión (b) de la
ficha). Se acepta el nombre y se compensa **en la UI, no en los requisitos**:

- el copy de la página dice explícitamente que ahí se consulta **cobertura**, y que el **costeo** se
  obtiene por el canal de integración con API key (R11, testeado);
- **ningún requisito EARS se afloja por el nombre**: R6, R7, R8 y R10 siguen intactos. La página
  sigue sin poder devolver ni derivar un importe, **ni por diferencia**.

*Alternativa descartada — modal en `/` con Server Action, como la 229:* evita tocar middleware y
guardia, pero esconde la consulta detrás de un click en la landing, sin URL propia enlazable desde
marketing; y la ficha firma «página pública», no «modal».

### D4 — El endpoint cuelga de `/api/ordenes/api-key/cotizar` (POST)

`SELF_AUTH_ROUTES` ya contiene el prefijo `/api/ordenes/api-key` (`middleware.ts:32`), así que el
endpoint pasa el middleware **sin tocar esa lista** (una lista firmada menos que mover). El borde
copia exactamente `app/api/ordenes/api-key/route.ts:52-69`: `extraerBearer` → `buildAutenticar` →
`UnauthenticatedError` (401) / `ForbiddenError` (403) → zod → 422 → service.

*Alternativa descartada — `GET` con query params:* sería cacheable, pero mete el **monto COD** en la
URL, y las URLs viajan a logs de plataforma y a analítica. Un cuerpo POST no.

### D5 — La aritmética se LLAMA, no se copia (R23/R24)

`lib/utils/ingreso-ordenex.ts:121-146` documenta la medición: la versión que reimplementaba las
mismas fórmulas en el navegador desviaba **un céntimo en 14 de 66 órdenes reales**, y no siempre por
binario: en el caso del monto 16 618,40 era **otra fórmula** (faltaba un redondeo intermedio). El
cotizador enseña dinero que la tienda comparará contra su cierre; si divergiera un céntimo, la misma
plata se leería distinta según dónde se mire. Por eso `CotizadorService` **no contiene una sola
fórmula monetaria propia**: pide los conceptos a `derivarIngresoOrden` y compone.

*Alternativa descartada — un util nuevo `cotizar-envio.ts` con las fórmulas «claras»:* es
exactamente el error ya pagado por la feature 204.

### D6 — Netos: ENTREGADA vía `pagoTiendaOrdenex`; DEVUELTA, **negativo y propio del cotizador** (firma 1)

**ENTREGADA (R19).** `pagoTiendaOrdenex(totalGeneral, fleteConIva, comisionConIva)`
(`lib/utils/ingreso-ordenex.ts:252-258`) es literalmente «lo recibido menos los dos bloques que
Ordenex factura sobre esa plata». Se invoca con `totalGeneral = montoCobrar` de la cotización.

**DEVUELTA (R21/R22).** Firma humana: el neto es **negativo**, `-(flete devolución + IVA)`, es decir
**lo que la devolución le cuesta a la tienda**. Y se implementa así:

- se **niega** el resultado ya derivado por `derivarIngresoOrden({ resultado: "devuelta" })`
  (`ingreso_flete_devolucion` + `ingreso_iva_flete_devolucion`, ya redondeados);
- **la negación es lo único nuevo**: ningún importe se recalcula, ninguna fórmula se reescribe;
- money-safe igual que todo lo demás: `Prisma.Decimal(...).neg().toFixed(2)` → `"-1695.00"` (R29).

**⚠ ESTE NÚMERO NO EXISTE EN EL CIERRE, Y HAY QUE ESCRIBIRLO EN EL CONTRATO (R22).**
`pagoTiendaOrdenex` documenta explícitamente (`ingreso-ordenex.ts:239-251`) que **no descuenta el
flete de devolución**: una devolución no recauda COD, así que no aporta al total general del cierre y
no se le resta a lo recibido. Por tanto **nadie debe intentar cuadrar el neto negativo del cotizador
contra una línea de cierre**: es una lectura del cotizador («cuánto te cuesta si vuelve»), no un
asiento. El OpenAPI lo dice con esas palabras.

*Alternativa descartada — llamar a `pagoTiendaOrdenex("0.00", fleteDevConIva, "0.00")`:* daría el
mismo número reutilizando la función, pero **fuera de su semántica documentada**, y ataría el
cotizador a que esa función nunca cambie de criterio sobre el flete de devolución. Negar el derivado
es más honesto y más estable.

### D7 — El total por N es el UNITARIO YA REDONDEADO × N (R26)

Regla no negociable de la ficha, y la razón es del código: `agregarIngresosPorConcepto`
(`:285-308`) suma los `Decimal` que `derivarIngresoOrden` **ya redondeó** por gestión. Redondear al
final de una multiplicación de valores sin redondear daría un total que **no cuadra** con lo que se
factura orden por orden. Implementación: `new Prisma.Decimal(unitario).mul(n).toFixed(2)` sobre el
STRING unitario ya emitido — incluido el neto negativo de DEVUELTA.

*Alternativa descartada — `derivar(monto × N)`:* la comisión COD es un % del monto; el % de la suma
no es la suma de los % redondeados. Es justo el error que el cierre no comete.

### D8 — Supuesto de homogeneidad explícito en la respuesta (R28)

La respuesta lleva un bloque `supuesto` con texto fijo: las N órdenes comparten **distrito y monto
COD**. No es decoración: sin él, un integrador multiplicaría una canasta heterogénea y la comisión
COD saldría mal. Cotizar canastas heterogéneas es **otro alcance** (ficha aparte).

### D9 — Sin tarifa vigente: `"0.00"` + bandera `tarifaVigente: false` (R30)

`derivarIngresoOrden(_, null)` devuelve `{}` (línea 62) y el agregado da ceros: ese gap (R9 de la
feature 42) es deliberado y **se hereda tal cual**, sin lanzar. Pero un `0.00` sin contexto se lee
como «gratis», así que la respuesta lo marca. Mismo criterio que `costoEnvioDeTarifa` (`:114-119`),
que devuelve `"0.00"` para no bloquear la carga.

### D10 — `tarifas.status` NO se filtra, y se DECLARA (R31)

Se usa `TarifaVigentePorTiendaRepository.resolveTarifaPorTienda` tal cual. Su `TODO` (`:52-63`) es
una decisión de la feature 69 **con test que exige que el `where` no mencione `status`**: añadir el
filtro aquí pondría rojo ese test y cambiaría dinero fuera de una gate. El cotizador **hereda** la
deuda, no la introduce, y la vuelve visible: la documenta en el OpenAPI («la tarifa cotizada es la
más reciente no borrada de la tienda; una tarifa marcada `inactivo` que no haya sido borrada puede
cotizarse»).

*Alternativa descartada — filtrar `status: "activo"` solo en el cotizador:* el cotizador enseñaría
un número y el cierre facturaría otro. Una divergencia deliberada entre lo que se promete y lo que se
cobra es peor que una deuda declarada.

### D11 — `fulfillment` fuera, por construcción (R32)

No hay que «excluirlo»: `TarifaVigente` (los 7 campos que consume la fórmula) **no lo contiene**
(`ITarifaVigentePorTiendaRepository.ts:20-28`); solo viaja en `TarifaVigenteResuelta`, el camino del
snapshot. El cotizador consume `TarifaVigente`, así que no puede colarse. El contrato lo fija (T6.3).

### D12 — **Se EXTRAE `resolveGeo` y se comparte** (firma 4) — el punto que sube el riesgo del PR

`resolveGeo` vive privada en `BulkOrdenService.ts:98-178`, con sus auxiliares `normalize` (`:47-49`)
y `lookup` (`:70-78`), y es **el camino que crea órdenes** (carga masiva por sesión y carga por API).
La firma humana descarta duplicarla: se extrae y se comparte.

**Dónde vive: `lib/utils/resolucion-geografica.ts`, util PURO.** Es la ubicación que manda
`docs/architecture.md` («`utils/` — helpers puros, sin side effects»): la función **no consulta la
base**; recibe los índices ya cargados (`ProvinciaRow[]`, `CantonRow[]`, filas de distrito) y devuelve
un resultado. Las **queries** siguen donde estaban, en la capa de repositorio
(`findAllProvincias` / `findCantonesByProvinciaIds` / `findDistritosByCantonIds`,
`IOrdenRepository.ts:806-814`; y su gemela delgada del cotizador, §4.3). Meterla en un repositorio
mezclaría reglas de dominio con acceso a datos, que es justo lo que el principio 1 de
`docs/architecture.md` separa.

**La regla del distrito multi-zona vive AHÍ, y solo ahí (R35).** El util exporta:

```ts
export type ZonaDeDistrito =
  | { estado: "unica"; zonaId: string; zonaNombre: string; esCentral: boolean }
  | { estado: "ninguna" }
  | { estado: "ambigua"; cuantas: number };

export function zonaDeDistrito(
  zonas: readonly { zonaId: string; nombre: string; esCentral: boolean }[],
): ZonaDeDistrito;
```

- `OrdenRepository.findDistritosByCantonIds` (`:1210-1218`) **deja de tener su propio ternario** y
  puebla `zonaId`/`esCentral` llamando a `zonaDeDistrito` (`estado === "unica"` → valores; en
  cualquier otro caso → `null` / `false`, **exactamente el comportamiento de hoy**).
- El cotizador ramifica por los **tres** estados, que es lo que necesita para distinguir R3 de R4.
  La carga solo mira `unica`. **Una definición, dos lecturas** — no dos respuestas.

**Comportamiento IDÉNTICO, y se demuestra:**

- los **mensajes literales** de `fieldErrors` de `resolveGeo` (`:107-166`, incluidos «el distrito
  '…' no tiene zona asignada» y el trato de `ambiguous`) se conservan **carácter a carácter**: los
  tests actuales de `BulkOrdenService` los afirman;
- `BulkOrdenService.resolveGeo` pasa a ser un **delegado fino** al util, sin cambiar su firma ni su
  resultado;
- **criterio de aceptación duro (R36, T1.4):** los tests existentes de carga masiva / carga por API
  pasan **sin tocarlos**. *Si hace falta modificar uno, es señal de que el refactor cambió
  comportamiento y la tarea vuelve atrás* — no se ajusta el test.

*Alternativa descartada — duplicar la resolución en un repositorio propio del cotizador (lo que
proponía la primera vuelta del spec):* evitaba tocar el camino crítico, pero dejaba **dos**
definiciones de «qué distrito es este» y **dos** respuestas posibles para el distrito multi-zona, que
es exactamente lo que la firma 4 prohíbe.

### D13 — La cascada pública se sirve desde el Server Component, sin endpoint de catálogo nuevo

`app/cotizador/page.tsx` (Server Component) lee el árbol geográfico **sin zonas** y lo pasa por props
al Client Component de la cascada. Cero round-trips, cero superficie pública nueva de datos.
`listarArbolGeografico` (`lib/actions/geografia.ts:41-44`) **no sirve**: es `maestro`-only y expone
la zona de cada distrito (R7 lo prohíbe en público).

*Alternativa descartada — SWR contra un endpoint público `/api/geografia`:* `docs/architecture.md`
recomienda SWR para datos públicos, pero eso añade una ruta pública más (y otra entrada en la lista
firmada) para un catálogo que es estático dentro de un render.

### D14 — **Sin límite de intentos en la superficie pública** (firma 6)

La 229 lo necesitó porque `num_guia` es incremental y contiguo y la respuesta traía datos del
destinatario. Aquí no: la entrada es un trío de nombres de un **catálogo geográfico que ya es
público** (las provincias, cantones y distritos del país no son un secreto), la respuesta es
«cubierto / no cubierto / no determinado» + nombre de zona, no hay PII, no hay enumeración útil de
recursos ajenos y no hay secreto que adivinar. **Se deja escrito como requisito (R40) para que no se
lea como un olvido** frente al precedente de la 229.

### D15 — `cobra_comision`: parámetro opcional con default **`true`** (firma 2)

Es un flag **por orden** en el modelo (`OrdenIngresoInput.cobraComision`, `ingreso-ordenex.ts:27-32`),
así que el cotizador lo acepta y lo **propaga tal cual**, sin interpretarlo.

**Por qué el default es `true` y no `false`:** `true` es el **caso caro** — añade comisión COD + su
IVA (`ingreso-ordenex.ts:73-82`). Una cotización que se equivoca **hacia arriba** hace que la factura
posterior sea menor o igual a lo cotizado; el default contrario produciría la sorpresa desagradable
(cotizo barato, cobro caro). Va al contrato publicado con su default explícito (R34), para que no
haya que adivinarlo.

### D16 — Tope de `cantidad`: **1..1000** (firma 5)

Entero, ambos extremos incluidos; fuera de rango → 422 sin cotizar (R27). Es un tope defensivo del
borde, en el mismo espíritu que el tope por lote de la carga (`cargaMasivaConfig.MAX_CHUNK_ROWS`):
la cotización es una multiplicación, así que el tope no protege de coste de cómputo sino de
respuestas absurdas. Vive en `lib/config/cotizador.ts`, no hardcodeado en el service (principio 4 de
`docs/architecture.md`).

---

## §4. Contratos de I/O

### 4.1 Superficie pública — Server Action `consultarCoberturaPublica(entrada: unknown)`

`lib/actions/cobertura-publica.ts`, `'use server'`, **sin `resolveActorFromSession`** (deliberado,
precedente `lib/actions/conteos-publicos.ts` y `lib/actions/rastreo-publico.ts:17-22`). Nunca lanza:
resultado discriminado. **Sin rate limit** (D14).

```ts
// entrada (zod, lib/types/cotizador.ts)
{ provincia: string; canton: string; distrito: string }

// salida
type ResultadoCoberturaPublica =
  | { estado: "cubierto"; zonaNombre: string }        // R2
  | { estado: "sin_cobertura" }                        // R3
  | { estado: "no_determinado" }                       // R4  (>1 zona)
  | { estado: "validation_error"; campos: Record<string, string> }; // R5
```

**Ni un campo más.** Sin `esCentral`, sin ids, sin importes (R6/R7). El schema zod **no declara**
ninguna clave de tienda, así que un `tiendaId` en la entrada se ignora por construcción (R8).

### 4.2 Canal por API key — `POST /api/ordenes/api-key/cotizar`

Petición:

```jsonc
{
  "provincia": "San José",
  "canton": "Central",
  "distrito": "Carmen",
  "monto_cobrar": "25000.00",   // STRING money-safe; requerido
  "cantidad": 3,                 // opcional, default 1, entero 1..1000 (D16)
  "cobra_comision": true         // opcional, default true (D15)
}
```

Respuesta 200 (cobertura resuelta y tarifa vigente):

```jsonc
{
  "cobertura": { "estado": "cubierto", "zonaNombre": "GAM" },
  "tarifaVigente": true,                                   // R30
  "cantidad": 3,
  "montoCobrar": "25000.00",
  "cobraComision": true,                                   // eco del parámetro aplicado (D15)
  "supuesto": "las 3 órdenes comparten distrito y monto a cobrar",   // R28
  "escenarios": {
    "entregada": {
      "unitario": {
        "flete": "2200.00", "ivaFlete": "286.00",
        "comisionCod": "875.00", "ivaComisionCod": "113.75",
        "costoTotal": "3474.75",          // suma de los cuatro, money-safe
        "netoTienda": "21525.25"          // pagoTiendaOrdenex(monto, flete+iva, comision+iva)
      },
      "total": { /* mismas claves: unitario YA REDONDEADO × cantidad (R26) */ }
    },
    "devuelta": {
      "unitario": {
        "fleteDevolucion": "1500.00", "ivaFleteDevolucion": "195.00",
        "costoTotal": "1695.00",
        "netoTienda": "-1695.00"          // NEGATIVO (D6/R21): lo que la devolución le cuesta
      },
      "total": { /* × cantidad; netoTienda "-5085.00" */ }
    }
  }
}
```

Con `cobra_comision: false`, el escenario `entregada` **omite** `comisionCod` e `ivaComisionCod` (no
los emite en `"0.00"`: `derivarIngresoOrden` los deja **ausentes**, `ingreso-ordenex.ts:73-82`, y
esta respuesta respeta esa distinción) — R33.

Respuesta 200 con cobertura no resuelta (R16): `{"cobertura": {...}, "costos": null}` — sin bloque
`escenarios`, sin tocar `tarifas`.

Errores: 401 (R12), 403 (R13), 422 (R14/R27), todos con el shape uniforme de `lib/errors`
(`appErrorToResponse`), como el resto del canal.

### 4.3 Módulos nuevos y modificados

**Nuevos:**

| Archivo | Rol |
| --- | --- |
| `lib/utils/resolucion-geografica.ts` | **util puro compartido** (D12): resolución del trío + `zonaDeDistrito` |
| `lib/types/cotizador.ts` | zod de entrada + DTOs de salida (ambas superficies) |
| `lib/interfaces/repositories/ICoberturaDistritoRepository.ts` + `lib/repositories/CoberturaDistritoRepository.ts` | catálogo delgado: provincias/cantones/distritos + zonas crudas del distrito. **No proyecta tarifas** (por eso no se reutiliza `OrdenRepository`, cuya proyección de listado sí trae `tarifasTienda`, `OrdenRepository.ts:354-357`, y rompería R10) |
| `lib/interfaces/services/ICoberturaService.ts` + `lib/services/CoberturaService.ts` | cobertura pura, **sin dinero** |
| `lib/interfaces/services/ICotizadorService.ts` + `lib/services/CotizadorService.ts` | compone cobertura + tarifa + `ingreso-ordenex` |
| `lib/actions/cobertura-publica.ts` | Server Action pública |
| `app/api/ordenes/api-key/cotizar/route.ts` | borde HTTP (patrón 106) |
| `app/cotizador/page.tsx` + `app/cotizador/CotizadorForm.tsx` | superficie pública (componente colocado: se usa en un solo sitio) |
| `lib/config/cotizador.ts` | tope de `cantidad` (1..1000, D16) |

**Modificados (camino crítico, D12):**

| Archivo | Cambio | Invariante |
| --- | --- | --- |
| `lib/services/BulkOrdenService.ts` | `resolveGeo`/`normalize`/`lookup` pasan a delegar en el util | firma, resultado y **mensajes de error literales** idénticos |
| `lib/repositories/OrdenRepository.ts` | `findDistritosByCantonIds` puebla `zonaId`/`esCentral` vía `zonaDeDistrito` | mismo `DistritoRow` que hoy |
| `middleware.ts` | `/cotizador` en `PUBLIC_ROUTES` | ninguna otra ruta cambia |

---

## §5. Contrato publicado (tres artefactos + dos guardias)

1. `lib/api/openapi-spec.ts` — **fuente de verdad**. Nuevo path `"/api/ordenes/api-key/cotizar"` al
   final de `paths` + schemas `CotizacionRequest`, `CotizacionResponse`, `EscenarioCotizacion`,
   `CoberturaBloque`. Documenta: el default de `cobra_comision` (R34), el supuesto de homogeneidad
   (R28), la deuda de `tarifas.status` (D10), que `fulfillment` **no** se cotiza (D11) y que el
   **neto negativo de DEVUELTA no existe en el cierre** (R22).
2. `docs/api/api-key-openapi.yaml` — espejo textual, **mismo orden de paths**.
3. `docs/api/ordenex-api-key.postman_collection.json` — request nuevo con el header Bearer.

**Guardia que se pondrá roja:** `tests/unit/api/openapi-177-paths-pdf-y-carga-id.test.ts:71-97`
(`toHaveLength(7)` + `toEqual(PATHS_ESPERADOS)` sobre TS **y** yaml). Se actualiza a 8 en el mismo PR
(T6.2). No es «arreglar el test»: la lista firmada es el contrato, y este PR lo amplía a propósito.

---

## §6. Gate

Toca **contrato publicado**, **`middleware.ts`** y —desde la firma 4— **el camino que crea órdenes**.
El gate del PR es **`./init.sh` completo, sin excepción** (`docs/verification.md`): `--rapido`
selecciona por grafo de imports y esta feature tiene acoplamientos que no son imports (listas
firmadas, `.yaml`, colección postman), además de un refactor cuyo radio de impacto es toda la
creación de órdenes. Nada de merge mirando el estado del PR: eso es un build y no corre tests.

---

## §7. Guardias nuevas que esta feature aporta

- **Aislamiento del público (R10):** guardia estática que recorre el grafo de imports de
  `lib/actions/cobertura-publica.ts`, `lib/services/CoberturaService.ts`,
  `lib/repositories/CoberturaDistritoRepository.ts` y `app/cotizador/**` y falla si aparece
  `ingreso-ordenex`, `TarifaVigentePorTienda` o `prisma.tarifa`. Se mide la **propiedad**, no el diff
  de una rama (lección de `rastreo-sin-ruta-nueva.guardia.test.ts:22-26`).
- **Cero importes en el DTO público (R6):** las claves del resultado público se comparan contra un
  literal firmado, con contraprueba.
- **Una sola definición de la zona del distrito (R35):** guardia que comprueba que el ternario
  `zonas.length === 1` (y equivalentes) no reaparece fuera de `lib/utils/resolucion-geografica.ts`.
- **Sin migración (R39):** ninguna carpeta de `db/migrations/` nombra la feature; `db/schema.prisma`
  no gana objetos.

---

## §8. Riesgos

| Riesgo | Mitigación |
| --- | --- |
| **El refactor de `resolveGeo` toca el camino que CREA órdenes** (firma 4) | Delegado fino de comportamiento idéntico + mensajes literales conservados + T1.4: los tests existentes pasan **sin modificarse**; si hay que tocar uno, se revierte el refactor |
| El nombre `/cotizador` promete importes que la página no da | Riesgo **aceptado** por el humano; compensado con copy obligatorio y testeado (R11), sin aflojar R6/R10 |
| El neto negativo de DEVUELTA se intenta cuadrar contra el cierre | Declarado en el contrato publicado (R22) y en D6, con la cita de `pagoTiendaOrdenex` |
| El cotizador se lee como promesa comercial y la tarifa cambia después | La respuesta declara que la tarifa es la vigente **al momento de cotizar**; el cierre congela la suya (feature 69/R8) |
| Tarifa `inactivo` cotizada (deuda heredada) | Declarada en el OpenAPI (D10); su arreglo es la feature 70 |
| Distrito multi-zona en datos reales | Trato «no determinado» **único y compartido** (D2 + D12) |
