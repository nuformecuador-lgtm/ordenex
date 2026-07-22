# Feature 98 — Tasks

Checklist discreto y verificable. `[P]` = paralelizable. Cada task lleva su criterio
de "hecho". Trazabilidad `R<n>` → test en las tasks de prueba.

> Gate F1.4 **aprobado (2026-07-21)**: D1 = `costoEnvio "0.00"` si no hay tarifa
> (crea igual, sin `null`, sin `error`); D2 = valor = **flete + IVA del flete**
> (STRING escala 2, `ROUND_HALF_UP`, reutilizando `aplicarPorcentaje`); D3 = campo
> **`costoEnvio`**. Ver `requirements.md` §"Resolución del gate F1.4".
>
> Depende de la feature 88 (ya `done`): reutiliza `cargarViaApi`,
> `CargaViaApiOrden`, `createManyOrdenesConGuia`. Rama `feature/98-api-carga-valor-pagar`.

## Bloque A — Cálculo del valor a pagar (util puro)

- [ ] **T1 [P] — Añadir helper `costoEnvioDeTarifa(tarifa, esCentral)` en
  `lib/utils/ingreso-ordenex.ts`.**
  Función pura money-safe: `tarifa === null → "0.00"` (gap, D1); si no,
  `flete = esCentral ? valorFleteGam : valorFlete`, y devuelve
  `round2(flete + aplicarPorcentaje(flete, ivaFlete)).toFixed(2)` (flete + IVA del
  flete, D2). Toda la aritmética con `Prisma.Decimal`, salida STRING escala 2. La
  selección de columna se comparte con `derivarIngresoOrden` (sin cambio de
  comportamiento; cubierto por sus tests existentes).
  *Hecho:* typecheck verde; los tests existentes de `ingreso-ordenex` siguen verdes.
  *(Dep: gate aprobado)*

- [ ] **T2 — Tests unitarios de `costoEnvioDeTarifa`.**
  Casos: no-central → `valorFlete` + su IVA (R2/R7); central (`esCentral true`) →
  `valorFleteGam` + su IVA (R2/R7); `tarifa null` → `"0.00"` (R8/D1);
  `ivaFlete = 0` → costo == flete base (R7); salida STRING escala 2 `ROUND_HALF_UP`,
  nunca number (R7); verificar la suma del IVA con un `ivaFlete` no trivial (p.ej.
  15%) money-safe.
  *Mapea:* R2, R7, R8.
  *(Dep: T1)*

## Bloque B — Proyectar `esCentral` en la precarga geográfica

- [ ] **T3 [P] — Añadir `esCentral: boolean` a `DistritoRow`**
  (`lib/interfaces/repositories/IOrdenRepository.ts`) y proyectarlo en
  `OrdenRepository.findDistritosByCantonIds` (`zona: { select: { esCentral: true } }`).
  *Hecho:* typecheck verde; `DistritoRow` trae el flag; sin cambios en otras vías
  que consumen `findDistritosByCantonIds` (solo lectura aditiva).
  *(Dep: gate aprobado)*

- [ ] **T4 — Test de repo `findDistritosByCantonIds` devuelve `esCentral`.**
  Distrito en zona central → `esCentral true`; en zona no central → `false`.
  *Mapea:* R2 (dato de entrada del flete).
  *(Dep: T3)*

## Bloque C — Resolución del flete en `cargarViaApi`

- [ ] **T5 — Inyectar `ITarifaVigentePorTiendaRepository` en `BulkOrdenService`.**
  Nueva dependencia de constructor; resolver la tarifa vigente del `tiendaId` UNA
  vez por lote (patrón `precargar`, `resolveTarifaPorTienda`). `cargarMasiva` NO la
  usa.
  *Hecho:* typecheck verde; diff = 0 en el cuerpo de `cargarMasiva` (R9).
  *(Dep: gate aprobado)*

- [ ] **T6 — Propagar `esCentral` por `ResolvedGeo` → `resolveFila` y calcular
  `costoEnvio` al armar `ordenes` en `cargarViaApi`.**
  Cruzar por `numRemision` (igual que `numGuia`) la fila resuelta (con `esCentral`)
  contra las creadas; `costoEnvio = costoEnvioDeTarifa(tarifaLote, esCentral)`.
  Extender `CargaViaApiOrden` con `costoEnvio: string` (D3; nunca `null`, el gap es
  `"0.00"`, D1).
  *Hecho:* typecheck verde; `cargarMasiva` intacto; solo `ordenes[]` gana el campo.
  *(Dep: T1, T3, T5)*

- [ ] **T7 — Tests de `cargarViaApi` (repo/tarifa fakes).**
  Casos: creada en zona no-central → `costoEnvio == valorFlete + IVA` (R1/R2/R7);
  creada en zona central → `costoEnvio == valorFleteGam + IVA` (R2/R7); una sola
  resolución de tarifa para N órdenes, sin N+1 (spy: el resolver se llama 1 vez)
  (R3); fila `duplicada` y fila `error` NO llevan `costoEnvio` y conservan su shape
  (R4/R6); tienda sin tarifa (`resolver → null`) → todas las creadas con
  `costoEnvio == "0.00"`, ninguna a `error` (R8/D1); `costoEnvio` STRING escala 2
  (R7); `monto_cobrar` y `costoEnvio` coexisten y no se confunden (R7).
  *Mapea:* R1, R2, R3, R4, R5, R6, R7, R8.
  *(Dep: T6)*

## Bloque D — Wiring y no-regresión

- [ ] **T8 — Actualizar `buildBulkService` en
  `app/api/ordenes/api-key/carga/route.ts`** para construir e inyectar
  `TarifaVigentePorTiendaRepository`. El resto del handler NO cambia (sigue
  devolviendo `summary`).
  *Hecho:* el endpoint compila y responde con `ordenes[].valorPagar`.
  *(Dep: T5)*

- [ ] **T9 [P] — Actualizar los fakes de `BulkOrdenService` en los tests de la
  feature 88** para el nuevo parámetro de constructor (tarifa fake), sin cambiar sus
  aserciones existentes.
  *Hecho:* la suite de la 88 sigue verde.
  *(Dep: T5)*

- [ ] **T10 — Test de endpoint: la respuesta incluye `costoEnvio` por orden creada.**
  Con deps inyectadas (auth + service fake): happy path → 200 con
  `ordenes[].costoEnvio`; forma de errores/duplicados sin cambios (R6).
  *Mapea:* R5, R6.
  *(Dep: T8)*

- [ ] **T11 [P] — Test de no-regresión de `cargarMasiva` y `carga-masiva/chunk`.**
  El `BulkSummary` de la vía sesión NO gana `costoEnvio` ni resuelve flete (R9).
  *Mapea:* R9.
  *(Dep: T5)*

- [ ] **T12 — Test de no-regresión del contrato 88.**
  Estado inicial fijo `en_ruta_bodega_principal`, `num_guia` inmediato, dedup y
  éxito parcial siguen intactos; la única extensión observable es `costoEnvio` (R10).
  *Mapea:* R10.
  *(Dep: T6)*

- [ ] **T13 — `./init.sh` verde + suite completa.**
  Medir el baseline en este worktree ANTES (la bitácora caduca; `pnpm db:generate`
  desde el schema limpio antes de medir el typecheck). Todos los `R1..R10` mapeados
  a un test concreto.
  *Hecho:* `./init.sh` en verde; tabla de trazabilidad `R→test` completa.
  *(Dep: T2, T4, T7, T10, T11, T12)*

## Mapa de trazabilidad (a completar por el implementer)

| Req | Task de test |
|-----|--------------|
| R1  | T7 |
| R2  | T2, T4, T7 |
| R3  | T7 |
| R4  | T7 |
| R5  | T7, T10 |
| R6  | T7, T10 |
| R7  | T2, T7 |
| R8  | T2, T7 |
| R9  | T11 |
| R10 | T12 |
