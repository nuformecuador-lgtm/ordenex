# Feature 274 — Diseño técnico

Referencias verificadas contra la rama `feature/274-cascada-tarifa-zona-tienda` (base `origin/dev`,
con la 273 ya mergeada). Las citas de línea son de esa base.

---

## 1. Modelo de datos

### 1.1 Lo que YA existe y esta feature NO migra

`db/schema.prisma:1152-1198` (`model Tarifa`), tal como lo dejó la 273:

- `tiendaId String? @map("tienda_id")` — NULL = no acotada a tienda.
- `zonaId String? @map("zona_id")` — NULL = no acotada a zona.
- `isDefault Boolean @default(false)`.
- Borrado **físico** (`deleted_at` retirada por `20260824140000_tarifa_zona_is_default`).
- `@@unique([zonaId, tiendaId])`, creado a mano en SQL con **`NULLS NOT DISTINCT`**.

Ese único es la pieza que sostiene todo el diseño: **como mucho una fila por nivel de la
cascada**, incluidas las combinaciones con NULL. Por eso se retira el desempate por
`createdAt` (R22 de la feature 69) sin sustituirlo por nada.

### 1.2 La única migración de esta feature: `20260825120000_drop_tarifa_status`

Timestamp posterior a `20260824180000_distrito_zona_especial` (la última en disco).

`migration.sql` (UP):

```sql
ALTER TABLE "tarifas" DROP COLUMN IF EXISTS "status";
DROP TYPE IF EXISTS "estado_tarifa";
```

`down.sql` (DOWN, **obligatorio**, `docs/architecture.md §Migraciones`):

```sql
DO $$ BEGIN
  CREATE TYPE "estado_tarifa" AS ENUM ('activo', 'inactivo');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "tarifas"
  ADD COLUMN IF NOT EXISTS "status" "estado_tarifa" NOT NULL DEFAULT 'activo';
```

**Pérdida de dato declarada:** el DOWN restaura la columna, no los valores. Toda fila vuelve
como `activo`. Es aceptable porque `status` no participaba de ninguna decisión de dinero en el
camino de liquidación (esa era literalmente la deuda (g)) y porque en producción se midió
**cero** tarifas `inactivo` (feature 70, citado en `TarifaVigentePorTiendaRepository.ts:100-102`).
El `down.sql` **debe** decirlo en un comentario.

RLS: `tarifas` no gana ni pierde tabla; no hay política nueva que escribir.

### 1.3 Índices

No se crean índices nuevos. Los existentes (`@@index([tiendaId])`, `@@index([zonaId])`, y
sobre todo el único `(zonaId, tiendaId)`) cubren el `WHERE` de §3.2. `@@index([createdAt])`
queda sin uso en este camino; **no se retira aquí** (lo usa el listado de configuración de
tarifas) — se deja anotado, no tocado.

---

## 2. La regla, en un solo sitio

### 2.1 Módulo puro nuevo: `lib/utils/cascada-tarifa.ts`

Sin imports de Prisma ni de HTTP. Es donde vive la regla, y existe para que R8/R21 («listado y
liquidación resuelven la misma fila») sea **estructuralmente cierto**, no una coincidencia que
haya que re-testear en cada superficie.

```ts
export interface ParTarifa {
  tiendaId: string;
  zonaId: string | null;
}

/** Clave estable de un par, para indexar el Map del batch. `|` no aparece en un uuid. */
export function clavePar(par: ParTarifa): string;

/** Fila candidata, en lo mínimo que la regla necesita ver. */
export interface FilaCascada {
  tiendaId: string | null;
  zonaId: string | null;
}

/**
 * 1 = tienda+zona · 2 = tienda, zona NULL · 3 = zona, tienda NULL · null = no aplica.
 * La fila global (NULL, NULL) devuelve `null`: NO es un cuarto nivel (R2).
 * Un par con `zonaId === null` solo puede alcanzar el nivel 2 (R6).
 */
export function nivelDeCascada(fila: FilaCascada, par: ParTarifa): 1 | 2 | 3 | null;

/**
 * Elige, para cada par pedido, la candidata de menor nivel. Determinista y sin `createdAt`
 * (R5): con el UNIQUE NULLS NOT DISTINCT no puede haber dos filas del mismo nivel para el
 * mismo par, así que el ganador no depende del orden de entrada.
 */
export function elegirPorCascada<T extends FilaCascada>(
  filas: readonly T[],
  pares: readonly ParTarifa[],
): Map<string, T | null>;

/**
 * `where` de Prisma para traer, en UNA query, todas las candidatas de N pares.
 * Se devuelve como objeto plano (estructuralmente compatible con `Prisma.TarifaWhereInput`)
 * para que este módulo siga siendo puro y testeable sin cliente generado.
 */
export function whereCascada(pares: readonly ParTarifa[]): {
  OR: Array<{ tiendaId?: string | { in: string[] }; zonaId?: string | { in: string[] } | null }>;
};
```

`whereCascada` produce tres ramas:

```ts
OR: [
  { tiendaId: { in: tiendas }, zonaId: { in: zonas } },  // nivel 1
  { tiendaId: { in: tiendas }, zonaId: null },           // nivel 2
  { tiendaId: null,            zonaId: { in: zonas } },  // nivel 3
]
```

**Sobre-lectura declarada y acotada.** La rama de nivel 1 es un producto cartesiano
`tiendas × zonas`, así que puede traer filas de pares que nadie pidió. `elegirPorCascada` las
descarta en memoria. El coste está acotado por el tamaño de página / del lote y por el UNIQUE
(no hay duplicados por par); a cambio se conserva **una sola query**, que es lo que un test ya
fija en el cierre. Si `zonas` viniera vacío (todos los pares sin zona), las ramas 1 y 3 se
omiten.

### 2.2 Qué desaparece

- El `TODO:` de la deuda (g) en `TarifaVigentePorTiendaRepository.ts:50-62` (las citas de línea
  de este documento son del archivo **antes** del renombrado de §3.1).
- `resolveTarifaCotizablePorTienda` (su propio comentario ya nombraba esta salida:
  «cuando la feature 70 cierre […] este método se COLAPSA»).
- El `orderBy: { createdAt: "desc" }` de los tres métodos.
- `ITarifaRepository.inactivarPorTienda` + su implementación (código muerto, R13). **Hueco
  aceptado y declarado (decisión del humano, 2026-08-24):** el caso «la tienda deja de ser
  `adminTienda`» queda sin cobertura —como ya estaba de hecho, porque nadie llamaba a ese
  método— y no se abre ficha por ahora.
- `estadoTarifaSchema`, `TarifaDTO.status`, `UpdateTarifaData.status`, `EstadoTarifa` importado
  de `@prisma/client` en `lib/types/tarifa.ts` y `lib/interfaces/repositories/ITarifaRepository.ts`.

---

## 3. Contratos

### 3.1 `ITarifaVigenteRepository` — de 3 métodos a 2

**Renombrado (R17), decidido el 2026-08-24.** `TarifaVigentePorTiendaRepository` →
`TarifaVigenteRepository`; `ITarifaVigentePorTiendaRepository` → `ITarifaVigenteRepository`,
con sus dos archivos. El nombre viejo afirma una regla que esta feature deroga.

Va en **su propio commit y su propia task** (`tasks.md` T2bis), *antes* de cambiar el
comportamiento y como **renombrado puro**: mismo cuerpo, mismos métodos, mismos tests pasando.
Coste declarado: toca **12 archivos de producción y 14 de test** (lista en `tasks.md`), y todo
lo que se ramifique de `dev` mientras tanto entra en conflicto textual en esos 26 archivos. Se
paga a cambio de que el diff del dinero se lea sin el ruido del renombrado.

```ts
export type TarifaTxClient = Pick<PrismaClient, "tarifa">;

export interface ITarifaVigenteRepository {
  /**
   * Cascada (R1–R6) para UN par. `null` = sin tarifa (R2).
   * Sustituye a `resolveTarifaPorTienda` Y a `resolveTarifaCotizablePorTienda`: hay un solo
   * resolver porque ya no hay `status` que los separe (R37).
   */
  resolveTarifa(tiendaId: string, zonaId: string | null): Promise<TarifaVigente | null>;

  /**
   * Cascada para N pares en UNA query (R7). El Map se indexa por `clavePar`.
   * `tx` OPCIONAL: el cierre pasa el cliente de su `$transaction` (el snapshot se congela
   * dentro); la carga vía API y el listado no tienen tx y usan el cliente del repo.
   */
  resolveTarifas(
    pares: readonly ParTarifa[],
    tx?: TarifaTxClient,
  ): Promise<Map<string, TarifaVigenteResuelta | null>>;
}
```

Cambio de firma respecto de hoy: el batch era `resolveTarifasPorTiendas(tx, tiendaIds)` —
`tx` primero y obligatorio. Se invierte para que el llamador sin transacción no tenga que
inventarse uno. `TarifaVigente` y `TarifaVigenteResuelta` (7 campos STRING + `tarifaId` +
`fulfillment`) **no cambian**: la aritmética de `lib/utils/ingreso-ordenex.ts` no se toca (R24).

### 3.2 Implementación del batch

```ts
const filas = await (tx ?? this.prisma).tarifa.findMany({
  where: whereCascada(pares),
  select: { id: true, tiendaId: true, zonaId: true, fulfillment: true, ...TARIFA_SELECT },
});
return mapear(elegirPorCascada(filas, pares));
```

Sin `orderBy`. `zonaId` entra en el `select` porque la regla lo necesita para clasificar.
El singular se implementa **sobre el mismo camino** (`resolveTarifas([par])`) o con un
`findFirst` por nivel — ver §5, alternativa descartada.

### 3.3 `TarifaDTO` y schemas (`lib/types/tarifa.ts`)

- Fuera `status` del DTO (R12) y del `actualizarTarifaSchema` (R11). Como el schema es
  `.strict()`, mandar `status` pasa a ser `validation_error` **sin escribir nada nuevo**.
- `crearTarifaSchema` / `actualizarTarifaSchema` **no** validan la prohibición global: el par
  efectivo de un `actualizar` depende de la fila existente, y zod no la ve. Va en el service
  (R14/R15), como pidió la decisión cerrada.

### 3.4 `TarifaService` — prohibición de `(NULL, NULL)`

Constante nueva, en el patrón de `ZONA_NO_EXISTE` / `TIENDA_NO_TARIFABLE`
(`TarifaService.ts:28-38`):

```ts
private readonly TARIFA_SIN_ALCANCE = {
  status: "validation_error" as const,
  fieldErrors: {
    tiendaId: ["una tarifa debe acotarse por tienda, por zona o por ambas"],
    zonaId: ["una tarifa debe acotarse por tienda, por zona o por ambas"],
  },
};
```

- `crear`: si `input.tiendaId == null && input.zonaId == null` → `TARIFA_SIN_ALCANCE`, **antes**
  de cualquier lectura (no se gasta un viaje a la base en algo ya inválido).
- `actualizar`: se calcula el **par efectivo** sobre la fila existente, que el método ya lee
  (`existente`):
  `tiendaEfectiva = input.tiendaId !== undefined ? input.tiendaId : existente.tiendaId`, idem
  zona. Si ambas quedan `null` → `TARIFA_SIN_ALCANCE`. Este es el caso que la decisión cerrada
  nombra explícitamente: `zonaId: null` sobre una tarifa que ya no tenía tienda.
- La rama `if (input.tiendaId !== undefined || input.status === "activo")`
  (`TarifaService.ts:112`) pierde su segunda condición al morir `status`.

### 3.5 El error de fila «sin tarifa» (R38) — mecanismo existente, no uno nuevo

Las dos APIs por key **ya tienen** un canal de error por fila y es el mismo en ambas:

- Cotización: `FilaCotizacionResultado = { fila, numRemision, resultado: "cotizada" | "error",
  costos?, errores?: Record<string, string[]> }` (`lib/types/cotizacion.ts:129-140`). La
  geografía ya lo usa: `CotizacionOrdenService.ts:215` empuja `geoResult.fieldErrors` tal cual.
- Carga: `CargaViaApiRow` con `resultado: "creada" | "duplicada" | "error"` y el mismo
  `errores: Record<string, string[]>` (`BulkOrdenService.ts:231, :257`).

Ese es el mecanismo que se reusa. **No** se añade un campo nuevo, ni un código de error nuevo,
ni un bloque paralelo en la respuesta.

**Clave del campo: `tarifa`.** Las claves de `errores` no son estrictamente nombres de columna
de entrada —hay precedente literal: `BulkOrdenService.ts:231-233` usa la clave `estatus` para un
fallo de catálogo que tampoco viene del cuerpo—. Una fila sin tarifa no falla por ninguna de sus
columnas, así que nombrar `provincia` o `distrito` sería señalar un dato correcto.

**Un único dueño de la cadena**, por el mismo motivo que ya está escrito en
`lib/services/mensajes-cotizacion.ts:3-6` (una cadena publicada duplicada diverge a la primera
errata). Módulo nuevo `lib/services/mensajes-tarifa.ts`:

```ts
/** R38 — error de FILA: el par (tienda, zona) de esta fila no resuelve tarifa. Mismo literal
 *  en la carga y en la cotización: una integración que lo reconozca lo reconoce en las dos. */
export const MSG_FILA_SIN_TARIFA =
  "no hay tarifa vigente para la zona de esta fila";

/** R29 — error de LOTE de la CARGA: ninguna fila resolvió tarifa -> 409. Constante nueva: el
 *  literal de cotización dice "no se puede cotizar" y aquí no se cotiza nada. Sin
 *  interpolación, como su hermano: no nombra tienda, key ni fila (misma regla que R49/255). */
export const MSG_CARGA_SIN_TARIFA =
  "la tienda no tiene una tarifa vigente asociada: no se pueden crear órdenes";
```

`MSG_COTIZACION_SIN_TARIFA` **no se toca**: sigue siendo el literal del `409` de cotización, ya
publicado en `openapi-spec.ts:751` y en el `.yaml`.

Forma de la fila en error, idéntica en las dos APIs:

```json
{ "fila": 7, "numRemision": "REM-0007", "resultado": "error",
  "errores": { "tarifa": ["no hay tarifa vigente para la zona de esta fila"] } }
```

### 3.6 El criterio de lote, escrito una vez (R27–R30, R33–R36)

Ambas APIs aplican **la misma regla**, y conviene fijar el denominador porque es donde se cuela
el error:

Sea `C` = las filas del lote que **llegan a la resolución de tarifa** (las que validan y
resuelven geografía; en la carga, además, las no duplicadas).

| caso | carga | cotización |
| --- | --- | --- |
| `C` vacío (nadie llegó a resolver) | `200`, filas con su error actual — **no** `409` (R30) | `200`, `totales` en cero (R36) |
| alguna de `C` resuelve | `200`; las que no resuelven → fila en `error` (R27/R28) | `200`; las que no → fila en `error` (R33/R34) |
| ninguna de `C` resuelve | `409` `MSG_CARGA_SIN_TARIFA`, **cero** persistencia (R29) | `409` `MSG_COTIZACION_SIN_TARIFA`, **cero** importes (R35) |

El caso `C` vacío es el que decide bien o mal la implementación ingenua (`resueltas === 0`):
un lote entero sin cobertura geográfica no tiene nada que ver con la tarifa y devolver `409`
ahí le daría al integrador un diagnóstico falso.

---

## 4. Superficies

### 4.1 `OrdenRepository` — listado (R18–R21)

Hoy (`:483-487`) el include trae `tienda.tarifasTienda { where: { status: "activo" }, take: 1 }`.
Eso se cae por dos motivos a la vez: la columna del `where` desaparece y la regla es **otra**
que la de liquidación (hoy el listado puede **mostrar** una fila y el cierre **facturar** otra).

Diseño:

1. El include de `tienda` **deja de traer tarifas** (queda `id, nombre, email, telefono`).
2. Tras el `findMany` de la página, se construyen los pares
   `{ tiendaId: row.tiendaId, zonaId: row.zonaId }` (ambos NOT NULL en `orden`), se deduplican
   y se llama **una vez** a `resolveTarifas(pares)` → **una consulta adicional por página**
   (R19), no una por fila.
3. `toListItemDTO(row, tarifa)` pasa a recibir la tarifa resuelta. `toTarifaDTO` /
   `toTarifaVigente` dejan de tipar contra `OrdenListRow["tienda"]["tarifasTienda"][number]`.

**Consecuencia sobre los tipos:** `relaciones.tienda.tarifa` es `TarifaDTO | null`
(`lib/types/orden.ts:406`) y `TarifaDTO` lleva campos que `TarifaVigenteResuelta` no tiene
(`isDefault`, `tarifaEspecial`, `createdAt`, `updatedAt`, los montos como `number`). Dos
opciones, y se elige la segunda:

- (i) Ensanchar `TarifaVigenteResuelta` con todo eso. **No**: mete `tarifaEspecial` y los
  `number` al alcance de la ruta que decide dinero, que es exactamente lo que el comentario de
  `ITarifaVigentePorTiendaRepository.ts:36-40` protege.
- (ii) **Un tipo de salida propio del listado** (elegida): el repo del listado hace su propia query de
  tarifas —con el **mismo `whereCascada` y el mismo `elegirPorCascada`**— y proyecta el row
  completo a `TarifaDTO` + `TarifaVigente`. Sigue siendo **una** query extra por página, sigue
  siendo **la misma regla** (mismo módulo puro), y el camino del dinero no se ensancha.

`ordenes-columns.tsx:174` lee `relaciones.tienda.tarifa.fulfillment`: sigue funcionando, ahora
con la fila correcta. `findListItemsByIds` (`:1188`) usa el mismo `toListItemDTO` y recibe el
mismo tratamiento; si no, el detalle del tablero diverge del listado.

### 4.2 `CierreDiaRepository` (R22–R24)

`crearCierre` (`:774-811`) ya trae `f.orden.zonaId` en `SNAPSHOT_SELECT` (`:112`). Cambio:

```ts
const tarifas = await this.tarifaRepo.resolveTarifas(
  filas.map((f) => ({ tiendaId: f.orden.tiendaId, zonaId: f.orden.zonaId })),
  tx,
);
...tarifaColumnas(tarifas.get(clavePar({ tiendaId: f.orden.tiendaId, zonaId: f.orden.zonaId })) ?? null)
```

Sigue dentro de la `$transaction` y sigue siendo **una** query (el test que fija esa propiedad
no se relaja: se actualiza para contar pares en vez de tiendas). El shape del snapshot no
cambia (R24). Y el cierre **sigue creándose** cuando una orden no resuelve tarifa, con sus
nueve columnas en NULL (R23/R39): el `409` de §4.3 y §4.4 no llega hasta aquí.

### 4.3 `BulkOrdenService` — carga vía API (R25–R31): **cambio de contrato público**

`tarifaLote` (`:277-278`) desaparece. Ya existe `esCentralPorRemision` (`:249`) poblado desde
`result.esCentral`; se añade **`zonaPorRemision`** poblado desde `result.createData.zonaId`
(`:452`, viene de `geo.zonaId`, que `resolveGeo` garantiza no nulo — una fila cuyo distrito no
tiene zona ya sale como error de cobertura, `geo-resolucion.ts:146`).

**El cambio estructural, y no es cosmético: la tarifa se resuelve ANTES de persistir.** Hoy el
orden es `toCreate → createManyOrdenesConGuia (:295-309) → tarifaLote → costoEnvio (:328)`; la
tarifa entra cuando las órdenes ya existen, que es justo lo que permitía el `"0.00"`. Con R28
una fila sin tarifa **no puede crearse**, y con R29 un lote sin ninguna tarifa **no puede dejar
ni una orden ni una fila de `carga`**. El orden nuevo:

1. Construir `toCreate` y `filas` como hoy (validación, duplicados, geografía).
2. **Una** llamada a `resolveTarifas` con los pares distintos de `toCreate` (R26).
3. Partir `toCreate` en `conTarifa` / `sinTarifa`.
   - Si `toCreate` no está vacío y `conTarifa` está vacío → **lanzar `ConflictError(
     MSG_CARGA_SIN_TARIFA)`** antes de tocar la base (R29). Nada persistido: ni órdenes, ni
     `carga`, ni historial, ni notificación.
   - Si `toCreate` está vacío (nadie llegó a resolver) → camino de hoy, `200` (R30).
4. Degradar cada fila de `sinTarifa` a `resultado: "error"` con `errores: { tarifa: [
   MSG_FILA_SIN_TARIFA] }` (§3.5) y **sacarla de `toCreate`**.
5. `createManyOrdenesConGuia(conTarifa, …)` y `costoEnvioDeTarifa(tarifaDeEstaOrden, esCentral)`
   por fila creada (R25).

Efectos derivados que hay que revisar uno por uno, no dar por hechos:

- `buildViaApiSummary`: `creadas` baja y `conError` sube; `total` sigue siendo `rows.length`
  (feature 141/R30–R33: `total_files` cuenta lo recibido, no lo creado). Una fila degradada en
  el paso 4 **no** debe contarse dos veces.
- El `409` sale por `ConflictError`, que el borde ya traduce con `appErrorToResponse` (mismo
  camino que la cotización): no hace falta un `status` nuevo en el resultado del service.
- La notificación `carga_masiva_terminada` (`:338`) no se emite en el camino del `409`: no hubo
  carga que terminar.

**Riesgo operativo declarado.** Un integrador cuyo lote entero cae en una zona recién creada sin
tarifa pasa de «200 con órdenes creadas a `0.00`» a «409 y cero órdenes». Eso es lo pedido —el
paquete deja de moverse con un precio inventado—, pero convierte un hueco de configuración en
una parada de la integración: de ahí la tarea de aviso a integradores, bloqueante del despliegue
(`tasks.md` T10).

### 4.4 `CotizacionOrdenService` (R32–R37)

Hoy resuelve la tarifa **antes** de la geografía (`:129-135`) precisamente porque no la
necesitaba. Ahora la necesita, así que el orden se invierte:

1. Precargar geografía (ya es una vez por lote).
2. Resolver geo de cada fila → `geoResult.geo.zonaId` (`geo-resolucion.ts:67`).
3. **Una** llamada a `resolveTarifas` con los pares distintos `(tiendaId, zonaId)` (R32).
4. Calcular escenarios por fila con su tarifa.

El tipo `CotizacionTarifaRepository` (`:53-56`) pasa a `Pick<…, "resolveTarifas">`.

**Criterio de lote (§3.6), decidido el 2026-08-24.** Una fila cotizable sin tarifa se degrada a
`resultado: "error"` con `errores: { tarifa: [MSG_FILA_SIN_TARIFA] }` y **sin** bloque `costos`
(R34): entra en `conError` y en `totales.filasExcluidas`, exactamente por el camino que ya
recorre una fila sin cobertura (`CotizacionOrdenService.ts:215`). El `409` sobrevive solo para
el caso en que **ninguna** fila que llegó a resolver resolvió (R35), con
`MSG_COTIZACION_SIN_TARIFA` y el shape actual de `route.ts:141` intactos.

El `status: "sin_tarifa"` del resultado del service **se conserva**, con su significado
estrechado: ya no es «la tienda no tiene tarifa» sino «ninguna fila de este lote resolvió
tarifa». `route.ts:141` no cambia una línea.

Coste declarado de este criterio: la promesa «ni un solo importe emitido cuando falta tarifa»
pasa a ser por fila y no por respuesta. Un lote mixto devuelve `200` con importes reales de
unas filas y errores de otras, así que el integrador que sume `totales` sin mirar
`filasExcluidas` obtiene un número que no es el precio del lote — el contrato ya lo advierte
(`openapi-spec.ts:627-633`) y ese párrafo cobra ahora un segundo motivo, que hay que añadirle.

### 4.5 El contrato publicado (R31)

Dos archivos espejo, `lib/api/openapi-spec.ts` y `docs/api/api-key-openapi.yaml`, más los tests
de contrato que ya los vigilan (`tests/unit/api/openapi-*.test.ts`). Cambios:

- `/api/ordenes/api-key/carga`: la descripción `:104-108` afirma hoy `"0.00"` si la tienda no
  tiene tarifa vigente → se reescribe; se añade `"409": { $ref: "#/components/responses/
  Conflict" }` con `MSG_CARGA_SIN_TARIFA` de ejemplo (`:202-204` hoy no lista `409`); y se
  documenta la fila en error con clave `tarifa`.
- `/api/ordenes/api-key/cotizacion`: el párrafo `:639-642` describe el `409` como «la tienda no
  tiene tarifa vigente» **y** declara la asimetría con `/carga` («que sí tolera la falta de
  tarifa con `costoEnvio: "0.00"`»). Las dos mitades dejan de ser ciertas: se reescriben al
  criterio de §3.6.

### 4.6 Sólo inyección

`app/api/ordenes/carga-masiva/chunk/route.ts` y `lib/actions/cierre-dia.ts`: cambia lo que se
construye/inyecta, no la lógica. (`app/api/ordenes/api-key/carga/route.ts` y
`app/api/cron/corte-diario/route.ts` solo cambian por el renombrado de §3.1.)

---

## 5. Alternativas descartadas

**A. Tres queries en cascada (`findFirst` nivel 1 → si null, nivel 2 → si null, nivel 3).**
Es la traducción literal de la regla y se lee sola. Descartada porque **no sobrevive al batch**:
para N pares son hasta 3N viajes, y el cierre de día tiene un test que fija «una sola query, sin
N+1» que habría que borrar o degradar. Mantener dos implementaciones (una en cascada para el
singular, otra por ranking para el lote) reintroduce justo el problema que esta feature viene a
cerrar: **dos reglas que pueden divergir** (hoy el listado y la liquidación ya divergen). La
elegida —una query con `OR` + ranking en memoria con `elegirPorCascada`— tiene **una sola**
implementación de la regla y el singular es el batch con un par.

**B. Resolver en SQL con `ORDER BY` de prioridad + `DISTINCT ON` (`$queryRaw`).**
Un `SELECT DISTINCT ON (par) … ORDER BY par, prioridad` deja el ranking en Postgres y evita la
sobre-lectura del producto cartesiano de §2.1. Descartada por tres razones concretas de este
repo: (1) `$queryRaw` devuelve `Decimal`/`null` sin el tipado de Prisma y este es **código de
dinero** —`docs/conventions.md` exige borde tipado y el repo serializa con `toFixed(2)` desde
`Prisma.Decimal`—; (2) el patrón de test de repositorios aquí es un **doble de Prisma hecho a
mano con asserts sobre `where`/`select` exactos**, y un `$queryRaw` solo se puede testear
contra Postgres real, lo que convierte tests unitarios rápidos en tests de integración; (3) la
regla quedaría escrita en una cadena SQL, fuera del alcance del módulo puro que hace que
listado y liquidación **no puedan** divergir (R8/R21). El coste que evita —traer unas pocas
filas de más, acotadas por el UNIQUE y por el tamaño de página— es menor que lo que cuesta.

**C. Mantener `tarifas.status` filtrándolo en el resolver único.** Cerrada por el humano antes
del spec; se registra aquí sólo para que conste que no se re-litigó.

**D. `409` de la petición entera si ALGUNA fila queda sin tarifa** (en vez del criterio de
§3.6). Considerada y **no elegida** (decisión del humano, 2026-08-24). Se registra para que
nadie la reintroduzca por su cuenta al leer el código: con ella, una sola zona sin configurar
tumba un lote de 500 filas correctas, y las dos APIs pierden el éxito parcial que es su patrón
—la carga lo tiene desde la feature 88 y la cotización lo declara en su contrato
(`openapi-spec.ts:635-637`)—. El criterio elegido cuesta, a cambio, un mensaje de error de fila
nuevo (§3.5) y que un `200` pueda contener filas sin precio.

**E. Un bloque nuevo en la respuesta (`sinTarifa: [<filas>]`) o un código de error propio para
la fila sin tarifa.** Descartada: duplicaría el canal de errores por fila que ya existe en las
dos APIs, obligaría al integrador a leer dos sitios para saber qué pasó con una fila, y sería
una segunda estructura que mantener en el `.yaml`, en el `.ts` y en sus tests de contrato. El
mecanismo de §3.5 no añade ni una clave al schema de respuesta.

---

## 6. Riesgos

- **Cambio de importes visibles sin cambio de datos.** El día que esto entre, una orden cuya
  tienda tenía dos tarifas puede pasar a mostrar/facturar **otra fila** (antes ganaba la más
  reciente; ahora la más específica). Es el objetivo de la feature, no un efecto colateral, pero
  conviene decirlo en el PR: los cierres ya creados **no** se tocan (su snapshot está congelado,
  R24).
- **Cambio de contrato de una API pública (carga por API key).** Un lote entero sin tarifa deja
  de crear órdenes y responde `409`; una fila sin tarifa deja de crearse. Un integrador que hoy
  ignora `filas[].resultado` y solo mira el `200` verá desaparecer órdenes sin enterarse. El
  aviso previo (`tasks.md` T10) **bloquea el despliegue a `prod`**, no el código ni el merge a
  `dev` — mismo trato que 239/T0.3 y 268/T8.
- **Renombrado del resolver en 26 archivos.** Cualquier rama viva que toque el cierre, la carga
  o la cotización choca textualmente al mergear. Se mitiga metiéndolo en su propio commit,
  temprano y sin cambio de comportamiento (§3.1), para que el conflicto se resuelva de un
  vistazo.
- **Ventana 273→274 en `prod`.** Mientras esta ficha no cierre, la pantalla de la 273 promete un
  cobro por zona que el motor no aplica. No desplegar 273 sin 274 (lo dice su propio
  `status_note`).
- **Frontend 275.** Depende de que `status` salga del DTO. Al terminar 274, la 275 se
  desbloquea.
