# Feature 118 — Corrección SIMPE → SINPE (design)

> Requisitos: ver `requirements.md` (R1–R12). Este documento fija el CÓMO técnico y
> el inventario real clasificado (apéndice A). Regla de oro: **el valor del enum es
> user-facing y se corrige; los identificadores internos derivados (`total_simpe`,
> `totalSimpe`, clave DTO `simpe`) NO se tocan.**

## 1. Modelo de datos y migración

### 1.1 Estado actual (censo confirmado)
- Enum Prisma: `enum MetodoPagoValue { efectivo; SIMPE; transferencia }` con
  `@@map("metodo_pago_value")` — `db/schema.prisma:416-422`.
- Tipo Postgres creado en la migración histórica
  `db/migrations/20260711150000_gestion_orden_estados_metodo_pago/migration.sql:25`:
  `CREATE TYPE "metodo_pago_value" AS ENUM ('efectivo','SIMPE','transferencia');`
- El enum es un **tipo Postgres nativo** (no hay tabla catálogo con filas; no hay
  seed SQL/TS con el valor). La columna que lo usa es el método de pago del recaudo
  en `gestion_orden` (vía enum), y NO existe columna `metodo_pago` con default a
  renombrar. Las columnas `total_simpe`/`totalSimpe` son **snapshots de dinero** y no
  guardan el valor del enum, sino un `Decimal`.

### 1.2 Estrategia elegida: `ALTER TYPE ... RENAME VALUE`
Migración NUEVA (timestamp posterior a la última existente, patrón del repo
`db/migrations/<timestamp>_<nombre>/` con `migration.sql` UP + `down.sql` DOWN):

`db/migrations/<ts>_metodo_pago_rename_simpe_to_sinpe/migration.sql` (UP):
```sql
-- Feature 118 (R2): renombra el VALOR del enum. RENAME VALUE preserva el OID del
-- valor, por lo que TODAS las filas que ya apuntan a 'SIMPE' pasan a leerse 'SINPE'
-- sin reescritura de filas ni pérdida (R4). No recrea el tipo, no toca columnas.
-- A diferencia de ADD VALUE, RENAME VALUE SÍ puede ejecutarse dentro de una
-- transacción; el runner del repo lo aplica sin tratamiento especial.
ALTER TYPE "metodo_pago_value" RENAME VALUE 'SIMPE' TO 'SINPE';
```

`down.sql` (DOWN):
```sql
-- DOWN (R3): inverso exacto del UP. Devuelve el enum al estado histórico.
ALTER TYPE "metodo_pago_value" RENAME VALUE 'SINPE' TO 'SIMPE';
```

**Reversibilidad:** el `RENAME VALUE` es simétrico y total; el DOWN restituye
`SIMPE` sobre las mismas filas, sin efectos colaterales. Cumple el mandato de
`docs/architecture.md` (toda migración con `down.sql` obligatorio) y el patrón de
`scripts/db-rollback.ts`.

**Riesgo de datos:** muy bajo. `RENAME VALUE` es una operación de metadato del
catálogo (`pg_enum.enumlabel`); no recorre ni reescribe la tabla `gestion_orden`,
no invalida índices ni FKs. No hay ventana de inconsistencia de datos porque el
valor sigue siendo el mismo OID con otra etiqueta.

### 1.3 Orden de aplicación (importante)
1. Editar `db/schema.prisma` (enum `SIMPE` → `SINPE`) para que Prisma y el enum
   Postgres queden alineados.
2. Crear la migración nueva (UP + DOWN) con el `RENAME VALUE`.
3. Regenerar el cliente Prisma (el tipo `MetodoPagoValue` pasa a incluir `SINPE`);
   esto es lo que fuerza el build a exigir el resto de cambios TS (R5/R6/R7) por
   exhaustividad — es una red de seguridad, no opcional.
4. Actualizar tipos/labels/lógica TS y tests.
5. `pnpm run db:migrate` en local (memoria del repo: migrar tras merge). El deploy
   de Vercel type-checkea; un cliente Prisma stale da falso negativo — regenerar.

> Nota de despliegue: como el enum Prisma y el enum Postgres cambian a la vez, no hay
> ventana en la que el código TS (esperando `SINPE`) conviva con un enum Postgres aún
> en `SIMPE`. La migración se aplica antes/junto al deploy del código.

## 2. Contratos I/O y capas afectadas
- **Sin cambios de contrato de red.** No se agregan ni cambian endpoints, Server
  Actions ni forma de payloads. El valor del enum viaja igual; solo cambia su
  etiqueta textual `SIMPE`→`SINPE`.
- **Capa de tipos** (`lib/types/metodo-pago.ts`): `METODO_PAGO_SEED` y `MetodoPago`
  pasan a `SINPE`. Es la fuente única (patrón feature 36, R5).
- **Capa de presentación**: mapas `Record<MetodoPagoValue,string>` y opciones del
  selector cambian clave y etiqueta a `SINPE`.
- **Lógica** (`lib/utils/cierre-totales.ts`): el `switch (g.metodoPago) { case "SIMPE": }`
  pasa a `case "SINPE":`. La variable local y la clave de salida `simpe` (minúscula)
  **NO cambian** (R9): son el identificador interno acoplado a `total_simpe`.
- **RLS:** no aplica (no hay tabla nueva ni policy nueva; el enum no lleva RLS).

## 3. Qué NO se toca (frontera explícita, R9/R10)
- Columna `total_simpe` y campo Prisma `totalSimpe` (`db/schema.prisma:535,577`) y
  todos sus usos en repositorios/interfaces/servicios y tests de snapshot de dinero.
- Clave DTO `simpe` (minúscula) de los objetos de totales
  (`{ efectivo, simpe, transferencia, general }`) en interfaces, repos, servicios y
  ~30 tests de cierre. Es interno, nunca se renderiza; la etiqueta visible sale de
  los mapas de label (que sí cambian).
- La migración histórica `20260711150000_.../migration.sql` (queda con `'SIMPE'`).
- `feature_list.json`, `progress/*`, `specs/*` de otras features: son registro
  histórico, no producción; no se reescriben.

## 4. Alternativa descartada

**Alternativa: ADD VALUE + backfill + recreate/DROP del valor viejo.**
Consistiría en `ALTER TYPE ... ADD VALUE 'SINPE'`, luego
`UPDATE gestion_orden SET metodo_pago = 'SINPE' WHERE metodo_pago = 'SIMPE'`, y
finalmente eliminar `'SIMPE'` recreando el tipo (Postgres no soporta
`ALTER TYPE ... DROP VALUE`, hay que RECREAR el enum renombrando el viejo a `_old`,
recrear columnas y castear — patrón visible en los `down.sql` del repo, p. ej.
`db/migrations/20260721120000_orden_historial_origen_tipo_sla_devuelta/down.sql`).

**Por qué se descarta frente a `RENAME VALUE`:**
- **Reescribe filas** (`UPDATE`) → riesgo money-critical y ventana de inconsistencia;
  `RENAME VALUE` no toca filas (R4 se cumple gratis).
- **Recrear el tipo** obliga a dropear/recrear la columna dependiente con CAST,
  invalidando índices/FKs y con `down.sql` frágil (el patrón RECREATE del repo es
  para DROP de valores, no para un simple typo).
- **ADD VALUE no corre en la misma transacción** que su uso en Postgres (ver notas en
  las migraciones del repo), forzando pasos multi-transacción; `RENAME VALUE` es
  atómico y transaccional.
- Es más código, más riesgo y menos reversible para lograr exactamente el mismo
  resultado semántico que un `RENAME VALUE` de una línea. La corrección es un typo,
  no un cambio de dominio: `RENAME VALUE` es la herramienta exacta.

## 5. Verificación
- Test de lectura del `migration.sql`/`down.sql` nuevos (patrón de
  `tests/integration/db/gestion-orden-migration.test.ts`) para R2/R3.
- Test de integración DB para R4 (fila `SIMPE` → `SINPE`, conteo estable).
- Ajuste de `gestion-orden-migration.test.ts` para R10 (afirmar literal histórico
  `SIMPE`, desacoplado de `METODO_PAGO_SEED`).
- Suite unit/component actualizada (R5–R8) + guard de censo (R12).
- `./init.sh` y la suite completa en verde (docs/verification.md).

---

## Apéndice A — Censo real clasificado (case-sensitive, `archivo:línea`)

Clasificación: **(a)** valor enum Postgres/Prisma · **(b)** tipos TS · **(c)** seeds ·
**(d)** texto user-facing · **(e)** tests · **(f)** identificadores internos NO se tocan.

### (a) Valor del enum Postgres / Prisma  → CAMBIA a SINPE (salvo migración histórica)
- `db/schema.prisma:418` — `SIMPE` en `enum MetodoPagoValue`. **CAMBIA.**
- `db/schema.prisma:415` — comentario "OJO 'SIMPE' en mayusculas". **CAMBIA (comentario).**
- `db/migrations/20260711150000_gestion_orden_estados_metodo_pago/migration.sql:24-25`
  — `CREATE TYPE ... 'SIMPE'` + comentario. **NO CAMBIA (histórica, R10).**
- Migración NUEVA `<ts>_metodo_pago_rename_simpe_to_sinpe/migration.sql` — `RENAME VALUE 'SIMPE' TO 'SINPE'`. **SE CREA.**
- Migración NUEVA `.../down.sql` — `RENAME VALUE 'SINPE' TO 'SIMPE'`. **SE CREA (contiene 'SIMPE' por diseño).**

### (b) Tipos TS  → CAMBIA a SINPE
- `lib/types/metodo-pago.ts:13` — `METODO_PAGO_SEED = ["efectivo","SIMPE","transferencia"]`. **CAMBIA.**
- `lib/types/metodo-pago.ts:5` — comentario "OJO: 'SIMPE' en mayusculas". **CAMBIA (comentario).**
- `lib/utils/cierre-totales.ts:64` — `case "SIMPE":` (rama sobre el valor del enum). **CAMBIA a `case "SINPE":`.**
  (Nota: `simpe` local en :55/:65/:74/:77 es interno → NO cambia, categoría f.)

### (c) Seeds  → cubierto por (b)
- No hay seed SQL/TS con el valor (`scripts/seed-*.ts` no referencian `metodo_pago`).
  El "seed" del dominio es la tupla `METODO_PAGO_SEED` de `lib/types/metodo-pago.ts:13`
  (ya listada en (b)). **Sin archivo adicional.**

### (d) Texto user-facing (etiquetas / labels)  → CAMBIA a SINPE
- `app/(app)/mis-asignaciones/_components/metodo-pago-options.ts:10` — `SIMPE: "SIMPE"` (clave enum + label). **CAMBIA ambos.**
- `app/(app)/cierre-dia/_components/CierreDiaModule.tsx:123` — `SIMPE: "SIMPE"` en `Record<MetodoPagoValue,string>`. **CAMBIA.**
- `app/(app)/cierre-dia/_components/CierreDiaModule.tsx:321` — `<TotalItem label="SIMPE" ...>`. **CAMBIA.**
- `app/(app)/cierre-dia/_components/CierreDiaModule.tsx:671` — `{ id:"simpe", value:"SIMPE", ... }` (label de columna; `id:"simpe"` interno). **CAMBIA `value` → "SINPE"; `id` NO cambia.**
- `app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx:46` — `SIMPE: "SIMPE"`. **CAMBIA.**
- `app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx:259` — `<TotalItem label="SIMPE" ...>`. **CAMBIA.**
- `app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx:229` — comentario. **CAMBIA (comentario).**
- `app/(app)/cierres-admin/_components/CierresAdminModule.tsx:337` — `label="SIMPE"`. **CAMBIA.**
- `app/(app)/cierres-admin/_components/ConsolidacionBodegaModule.tsx:243` — `{ id:"simpe", value:"SIMPE", ... }`. **CAMBIA `value` → "SINPE"; `id` NO cambia.**

### (e) Tests  → CAMBIA a SINPE
- `tests/unit/types/metodo-pago.test.ts:10-11` — nombre + aserción del set. **CAMBIA.**
- `tests/unit/utils/cierre-totales.test.ts:47` — `metodoPago:"SIMPE"` (input). **CAMBIA.** (`simpe:"4.50"` en :53 es DTO → NO.)
- `tests/unit/types/gestion-orden-schemas.test.ts:117` — `metodoPago:"SIMPE"`. **CAMBIA.**
- `tests/unit/services/cierre-dia-service.test.ts:197,213,259,419,480,489` — `metodoPago:"SIMPE"` / aserción. **CAMBIA.** (claves `simpe:` DTO → NO.)
- `tests/unit/services/cierres-admin-service.test.ts:397` — `metodoPago:"SIMPE"`. **CAMBIA.**
- `tests/unit/services/cierre-bodega-service.test.ts:363` — nombre de test "no se paga con SIMPE...". **CAMBIA (texto).**
- `tests/integration/db/resolver-novedad-reprograma-dinero.test.ts:95,140` — nombres de test. **CAMBIA (texto).**
- `tests/integration/actions/cierre-dia-action.test.ts:252` — `metodoPago:"SIMPE"`. **CAMBIA.**
- `tests/components/CierreDiaModule.test.tsx:186,193` — `metodoPago:"SIMPE"` + `getByText("SIMPE")`. **CAMBIA.**
- `tests/components/CierresAdminModule.test.tsx:471,492` — igual. **CAMBIA.**
- `tests/integration/db/gestion-orden-migration.test.ts:48,53` — test de la migración HISTÓRICA. **CAMBIA: desacoplar de `METODO_PAGO_SEED`, afirmar literal histórico `SIMPE` (R10).**
- `e2e/cierre-dia.spec.ts:11` — comentario de flujo menciona `SIMPE`. **CAMBIA (texto).**
- Test NUEVO de la migración rename (UP `RENAME VALUE 'SIMPE'→'SINPE'`, DOWN inverso, R2/R3/R4). **SE CREA.**
- (Opcional, R12) Test/guard NUEVO de censo case-sensitive de `SIMPE`. **SE CREA.**

### (f) Identificadores internos NO user-facing  → NO SE TOCAN (R9)
- Columna/campo `total_simpe` / `totalSimpe`: `db/schema.prisma:535,577`;
  `db/migrations/20260712120000_cierre_bodega/migration.sql:18`;
  `db/migrations/20260712100000_cierre_dia/migration.sql:23`;
  `lib/repositories/CierreBodegaRepository.ts:20,37,54,151`;
  `lib/repositories/CierreDiaRepository.ts:309,494,509`;
  `lib/repositories/CierresAdminRepository.ts:238,263`;
  `lib/repositories/CierresBodegaAdminRepository.ts:39,56`.
- Clave DTO `simpe` (minúscula) de totales: `lib/utils/cierre-totales.ts:55,65,74,77`;
  `lib/services/CierreBodegaService.ts:28,37,42,48`;
  `lib/interfaces/repositories/ICierresAdminRepository.ts:28`;
  `lib/interfaces/services/ICierreDiaService.ts:141`; y ~30 aserciones
  `{ efectivo, simpe, transferencia, general }` en `tests/unit/repositories/*`,
  `tests/unit/services/*`, `tests/components/*`, `tests/integration/*`.
- IDs de columna de tabla UI `id:"simpe"` (interno del render, no visible como label).

> **Conteo real de archivos a modificar/crear: ~23** (8 fuentes + 12 tests existentes
> + 1 test nuevo de migración + 2 archivos de migración nueva; guard de censo opcional
> = +1). La estimación de "~59" de `feature_list.json` sobre-cuenta porque incluye los
> ~35 archivos de la categoría (f) — `total_simpe`/`totalSimpe`/clave DTO `simpe` — que
> por regla explícita **NO se tocan**.
