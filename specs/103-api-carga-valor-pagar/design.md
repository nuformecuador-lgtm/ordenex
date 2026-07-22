# Feature 98 — Design: valor a pagar (flete) en la carga por API

> Extiende la feature 88 (`cargarViaApi`) para devolver, por orden creada, el
> flete que paga la tienda. NO cambia el CRUD/cálculo de tarifas, ni la UI, ni la
> carga masiva por sesión. Toda pieza nueva es aditiva y money-safe.

## 1. Modelo de datos, migraciones y RLS

- **Sin migración.** No se crea ni altera ninguna tabla, enum ni columna. El flete
  ya existe (`tarifas.valor_flete` / `valor_flete_gam`) y el flag de zona también
  (`zona.es_central`). La feature solo LEE y proyecta.
- **Sin RLS nueva.** El acceso sigue mediado por la autenticación de API key de la
  feature 88; la lectura de tarifa/zona es server-side dentro del service.
- La única lectura nueva de esquema es proyectar `zona.esCentral` en la resolución
  geográfica del lote (hoy `DistritoRow` no lo trae). Ver §3.

## 2. Rutas / endpoints y contrato I/O

- **Ruta:** sin cambios — `POST /api/ordenes/api-key/carga`. El Route Handler
  (`route.ts`) no se toca: sigue devolviendo `cargaResult.summary` tal cual. La
  extensión es puramente del tipo del summary.
- **Contrato de salida (extensión aditiva):** se añade el campo `costoEnvio` por
  orden creada en `CargaViaApiOrden` (gate F1.4 → D3). Ejemplo (con IVA incluido,
  D2; `"0.00"` si la tienda no tiene tarifa, D1):

```jsonc
{
  "total": 3, "creadas": 2, "duplicadas": 0, "conError": 1,
  "ordenes": [
    { "id": "…", "numRemision": "R-1", "numGuia": 1001,
      "estado": "en_ruta_bodega_principal", "costoEnvio": "3.95" },
    { "id": "…", "numRemision": "R-2", "numGuia": 1002,
      "estado": "en_ruta_bodega_principal", "costoEnvio": "0.00" }
  ],
  "filas": [ /* … las filas error/duplicada NO cambian de shape (R6) … */ ]
}
```

- **Tipos afectados** (`lib/interfaces/services/IBulkOrdenService.ts`):
  - `CargaViaApiOrden` gana `costoEnvio: string` (money-safe, escala 2 — NUNCA
    `number` para dinero). NO es `string | null`: el gap de tarifa se representa
    con `"0.00"`, no con `null` (D1).
  - `CargaViaApiRow` (las filas) NO cambia: `costoEnvio` vive solo en el bloque
    `ordenes`, que ya es "una entrada por orden creada" (R5/R6).
  - `CargaViaApiSummary` no cambia de forma (sigue con `ordenes`); solo cambia el
    tipo de sus elementos.

## 3. Resolución del flete dentro de `cargarViaApi`

Punto clave verificado: la tarifa se resuelve **por tienda**, y todo el lote es de
UNA tienda (`actor.usuarioId`). Por tanto:

1. **Una sola resolución de tarifa por lote (R3).** En/junto a `precargar`,
   resolver la tarifa vigente de `tiendaId` una vez. Dos formas equivalentes de
   reuso (sin reimplementar):
   - `resolveTarifaPorTienda(tiendaId)` → `TarifaVigente | null`, o
   - `resolveTarifasPorTiendas(tx, [tiendaId])` → `Map`, tomando la única entrada.
   Se prefiere `resolveTarifaPorTienda` (un solo id; no necesita `tx`). Requiere
   inyectar un `ITarifaVigentePorTiendaRepository` en `BulkOrdenService` (nueva
   dependencia de constructor; ver §6 sobre el impacto en el wiring del route y en
   los fakes de test de la 88).

2. **Valor a pagar por orden = flete + IVA del flete (R2/R7, D2).** El flete de
   cada orden creada depende de `esCentral` de SU zona: `esCentral ? valorFleteGam
   : valorFlete` (misma selección de columna que `derivarIngresoOrden`,
   `lib/utils/ingreso-ordenex.ts`). Sobre ese flete se suma el IVA del flete
   aplicando el porcentaje `tarifa.ivaFlete` con `aplicarPorcentaje(flete,
   ivaFletePct)` — EXACTAMENTE el cálculo que ya hace `derivarIngresoOrden` para
   `ingreso_flete` + `ingreso_iva_flete` (`Prisma.Decimal`, `ROUND_HALF_UP`), sin
   reimplementarlo. Para no duplicar la lógica, se extrae un helper puro money-safe
   en `lib/utils/ingreso-ordenex.ts`:
   `costoEnvioDeTarifa(tarifa, esCentral): string` que devuelve
   `round2(flete + aplicarPorcentaje(flete, ivaFlete)).toFixed(2)`, y `"0.00"` si
   `tarifa === null` (D1/R8). `derivarIngresoOrden` puede reutilizar la selección
   de columna del mismo helper para evitar divergencia. Como el flete y su IVA se
   derivan de campos que en `TarifaVigente` son STRING escala 2, toda la aritmética
   corre con `Prisma.Decimal`; nunca `number`/`parseFloat`.

3. **De dónde sale `esCentral` por orden (evita N+1).** La zona se deriva del
   distrito en `resolveGeo`. Se extiende la precarga geográfica para traer el flag:
   - Añadir `esCentral: boolean` a `DistritoRow`
     (`lib/interfaces/repositories/IOrdenRepository.ts`) y proyectarlo en
     `findDistritosByCantonIds` (`OrdenRepository`) vía
     `zona: { select: { esCentral: true } }` (o el join equivalente). Es el mismo
     patrón por el que otras vías cargan `zonaEsGam` junto a la zona.
   - Propagar `esCentral` por `ResolvedGeo` → `resolveFila` → hasta la construcción
     de `CargaViaApiOrden`. Así el flete se calcula EN MEMORIA por cada creada, con
     la tarifa única del lote + el `esCentral` ya resuelto: cero consultas extra.

4. **Ensamblado.** En el bucle que hoy arma `ordenes` (mapeando `num_guia` por
   `numRemision`), se añade `costoEnvio = costoEnvioDeTarifa(tarifaLote, esCentral)`.
   Como `esCentral` no está hoy en `CreateOrdenConGuiaResultRow`, se cruza por
   `numRemision` contra la fila ya resuelta (que sí lo tiene desde `resolveFila`),
   igual que ya se cruza el `num_guia`. No hace falta que el repo devuelva
   `esCentral`.

5. **Gap de tarifa (R8, D1) — FIJADO.** Si `tarifaLote === null`, cada orden se
   crea igual (con su `num_guia`) y `costoEnvio = "0.00"`. Implementación trivial:
   `costoEnvioDeTarifa(null, _) === "0.00"`. NO hay rama de `error` por ausencia de
   tarifa: la carga del integrador nunca se bloquea por un dato de configuración
   interno no capturado.

## 4. Integraciones

- **`TarifaVigentePorTiendaRepository`** (feature 42/69): consumidor nuevo del
  resolver existente. Sin cambios en el repo.
- **`ingreso-ordenex.ts`** (feature 42): se le añade el helper
  `costoEnvioDeTarifa` (flete por columna + IVA del flete vía `aplicarPorcentaje`);
  misma fórmula que `derivarIngresoOrden` para `ingreso_flete` + `ingreso_iva_flete`,
  para que "cuánto paga la tienda por una orden" se lea igual en el cierre y en la
  API (si un día divergieran, la misma plata se leería distinto).
- **Route Handler 88**: sin cambios de lógica; solo el wiring de dependencias
  (`buildBulkService` debe construir también el `TarifaVigentePorTiendaRepository`).

## 5. Alternativa descartada

**Alternativa A — resolver el flete por orden con una consulta de tarifa por cada
orden creada (o por cada zona), después de `createManyOrdenesConGuia`.**
Se descarta porque:

1. **N+1 innecesario.** La tarifa es por tienda y el lote es de UNA tienda: una
   consulta por orden (o por zona) repite N veces la misma resolución. El requisito
   R3 exige explícitamente resolverla una sola vez (patrón `precargar`).
2. **Reimplementaría la selección de columna y la suma del IVA** fuera del util que
   ya las posee, arriesgando divergencia con el cierre (feature 42/69) — justo lo
   que R1/R2/R7 piden evitar.
3. **Traer `esCentral` post-creación** obligaría a que el repo lo devuelva en
   `CreateOrdenConGuiaResultRow` o a una consulta extra de zonas; en cambio,
   proyectarlo en la precarga geográfica (§3.3) lo deja disponible sin costo, junto
   al resto de la resolución de fila.

**Alternativa B (variante) — persistir el flete como snapshot en la orden.** Fuera
de alcance: el pedido es DEVOLVER el valor en la respuesta, no congelarlo en DB;
un snapshot implicaría migración y semántica de vigencia (la deuda (g) de la 69).
Se rechaza por alcance y por no introducir estado nuevo.

## 6. Notas de implementación / conventions

- **Inyección:** `BulkOrdenService` gana una dependencia
  (`ITarifaVigentePorTiendaRepository`). Actualizar `buildBulkService` en el route
  y TODOS los `new BulkOrdenService(...)` de los tests de la 88 (fakes). El fake de
  tarifa debe permitir simular `null` (gap D1 → `"0.00"`) y central/no-central
  (R2), con un `ivaFlete` no nulo para verificar la suma del IVA (D2/R7).
- **Money-safe:** `costoEnvio` es SIEMPRE STRING escala 2 (nunca `null`, nunca
  `number`, sin `parseFloat`). El gap de tarifa es `"0.00"` (D1). La suma
  flete + IVA corre con `Prisma.Decimal` reutilizando `aplicarPorcentaje` +
  `round2`/`toFixed(2)` del mismo util (D2).
- **`cargarMasiva` intacto:** el helper `costoEnvioDeTarifa` y la dependencia nueva
  NO se invocan en la vía sesión (R9). Verificar diff = 0 en el cuerpo de
  `cargarMasiva`.
- **LF** en todos los archivos.
