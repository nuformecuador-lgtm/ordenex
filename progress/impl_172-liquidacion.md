# Feature 172 — Liquidación · bitácora de implementación

> Rama `feature/172-liquidacion`, PR **#259**. Spec en `specs/172-liquidacion/`.
> 85 requisitos (R1–R85), 9 tandas. Puerta CERRADA el 2026-08-01.

---

## Baseline medido al inicio de la Tanda A (2026-08-02)

`./init.sh` → **`== init OK ==`**. `pnpm test`: **772 archivos / 9257 tests / 0 fallos**.
Lint: 0 errores, 27 warnings preexistentes (`_args`/`_items` sin usar en tests ajenos).
Toda regresión se mide contra estos números.

---

## T0.9 — Calendario: ¿colisiona con la 170 fase 2? · **RESUELTA: NO. La 172 arranca ya.**

Decisión del leader, 2026-08-02. Comprobado contra `feature_list.json`:

| Feature | Estado | Zona |
| --- | --- | --- |
| **170** (Excel + paginación server-side) | `done` | fullstack |
| **171** (desglose por tienda) | `done` | fullstack |
| **172** (liquidación) | `spec_ready` | fullstack |

Las 6 tandas de la fase 2 de la 170 están mergeadas en `dev` (PRs #248, #249, #250, #253, #255,
#256), así que **nada sigue en vuelo sobre `app/(app)/wallet/tiendas/**` ni sobre
`app/(app)/cierres-admin/**`**, que eran los dos directorios de intersección. La zona `fullstack`
queda con **0 features `in_progress`**, muy por debajo del tope de 2 de la regla 1 del arnés.

**Tanda 0 CERRADA por completo.**

---

## T A.0 — Verificación de las bases ANTES de escribir la migración

**Por qué existe esta task:** los dos `ADD CONSTRAINT … CHECK` de `design.md §2.3` van **sin
`NOT VALID`**, así que **recorren y validan las filas existentes al aplicarse**. En Vercel el build
**migra antes de compilar**: una sola fila incoherente tumba el despliegue y deja la fila fallida en
`_prisma_migrations`, que bloquea los despliegues siguientes hasta repararla a mano.

### Producción — `scfnwxqbsgkzwsdntdvd` · ✅ LIMPIA

Medido el **2026-08-02** por el MCP de Supabase (`get_project_url` devuelve
`https://scfnwxqbsgkzwsdntdvd.supabase.co`, que es la base de producción identificada con evidencia
el 2026-07-31).

Consulta de incoherencias — la negación exacta de los dos CHECK de `design.md §2.3`:

```sql
SELECT
  (SELECT count(*) FROM public.wallet_tienda_movimiento) AS wtm_total,
  (SELECT count(*) FROM public.wallet_tienda_movimiento
     WHERE NOT (
       (tipo::text = 'credito' AND categoria::text IN ('cod_recaudado','ajuste_credito'))
       OR (tipo::text = 'debito' AND categoria::text IN ('flete','flete_devolucion','comision_cod',
            'iva_flete','iva_flete_devolucion','iva_comision_cod','pago_tienda','ajuste_debito'))
     )) AS wtm_incoherentes,
  (SELECT count(*) FROM public.pago_mensajero_movimiento) AS pmm_total,
  (SELECT count(*) FROM public.pago_mensajero_movimiento
     WHERE NOT (
       (tipo::text = 'devengo' AND categoria::text IN ('pago_devengado','ajuste_devengo'))
       OR (tipo::text = 'pago' AND categoria::text IN ('pago_efectivo','liquidacion','ajuste_pago'))
     )) AS pmm_incoherentes,
  (SELECT count(*) FROM public.wallet_movimiento) AS caja_total,
  (SELECT count(*) FROM public.cierre_dia) AS cierres_total
```

Salida real:

```json
[{"wtm_total":39,"wtm_incoherentes":0,"pmm_total":7,"pmm_incoherentes":0,"caja_total":35,"cierres_total":6}]
```

**39 + 7 = 46 filas en los dos libros, CERO incoherentes.** El recorrido de validación es
instantáneo a este volumen: se confirma que **no hace falta `NOT VALID` + `VALIDATE`**, tal como
anticipaba `design.md §2.3`.

### Los CHECK son EXHAUSTIVOS sobre los enums reales de producción — verificado

No basta con que no haya filas incoherentes: si el CHECK omitiera un valor del enum, cerraría la
puerta a un concepto legítimo. Enums leídos de `pg_enum` en producción:

| Enum | Valores en la base | Clasificados por el CHECK |
| --- | --- | --- |
| `wallet_tienda_movimiento_tipo` | `credito, debito` | 2 / 2 |
| `wallet_tienda_movimiento_categoria` | `cod_recaudado, flete, flete_devolucion, comision_cod, iva_flete, iva_flete_devolucion, iva_comision_cod, pago_tienda, ajuste_credito, ajuste_debito` | **10 / 10** |
| `pago_mensajero_movimiento_tipo` | `devengo, pago` | 2 / 2 |
| `pago_mensajero_movimiento_categoria` | `pago_devengado, pago_efectivo, liquidacion, ajuste_devengo, ajuste_pago` | **5 / 5** |
| `metodo_pago_value` | `efectivo, SINPE, transferencia` | los 3 que pidió el humano; **no se crea ningún enum** |

Los CHECK de `design.md §2.3` cubren **todos** los valores existentes y ni uno de más. La propiedad
de «falla cerrado» (R60) se mantiene: un valor **futuro** que nadie clasifique no casará ninguna
rama y su INSERT será rechazado, que es lo buscado.

### Preview — ⚠️ **NO VERIFICADA. Hueco declarado, no tapado.**

**No es alcanzable desde esta sesión.** El MCP de Supabase está fijado a un solo proyecto por
`.mcp.json` (`?project_ref=scfnwxqbsgkzwsdntdvd`, producción) y **preview tiene base Supabase
propia** desde el 2026-07-27. Se intentó descubrir su `project_ref` por otras vías y ninguna lo da:

- el MCP de Supabase de este repo **no expone `list_projects`** (viene fijado al ref de producción);
- `get_project` del MCP de Vercel **no devuelve variables de entorno**, así que no revela el
  `NEXT_PUBLIC_SUPABASE_URL` de preview;
- **no hay CLI de Vercel instalada**, así que no hay `vercel env pull --environment=preview`;
- el ref de preview **no aparece en ningún archivo del repo** (búsqueda sobre `progress/`, `docs/`
  y `specs/`: el único ref que existe escrito es el de producción).

**Qué riesgo queda vivo y cuál NO.** El riesgo que esta task existe para cerrar —tumbar el
despliegue de **producción**— **está cerrado**: producción está medida y limpia. Lo que queda es
que, si la base de preview tuviera una fila incoherente, **el build del PR saldría rojo** y —peor—
dejaría una fila fallida en el `_prisma_migrations` de preview, que **bloquea los despliegues de
preview siguientes** hasta repararla a mano. Es detectable de inmediato (rojo en el PR, antes de
mergear) y no toca producción, pero **no es gratis**.

**Qué haría falta para cerrarlo:** el `project_ref` de la base de preview y autorización para
apuntar ahí el MCP (editar `.mcp.json` y reiniciar la sesión), o correr la consulta de arriba desde
el SQL editor de ese proyecto. **Pendiente del humano; hay que resolverlo antes de mergear el PR,
no antes de escribir el código.**

### Local

Se verifica con Prisma al aplicar la migración en T A.1 (`pnpm run db:migrate`): si la base local
tuviera una fila incoherente, el `ADD CONSTRAINT` fallaría ahí primero.

**Resultado de T A.0: producción limpia ⇒ la Tanda A CONTINÚA.** Ninguna fila incoherente
encontrada en la única base medible; el spec manda detenerse solo si aparece una, y no apareció.

---

## TANDA A — Base de datos, integridad y piezas puras · **COMPLETA** (2026-08-02)

T A.1, T A.2, T A.3 y T A.4 hechas. Cuatro tasks, **cero decisiones de diseño tomadas por el
implementer**: el modelo es literalmente el de `design.md §2.1/§2.2` y los contratos, los de §3.2.

### Archivos

**Nuevos**

| Archivo | Qué |
| --- | --- |
| `db/migrations/20260802120000_liquidacion_pago/migration.sql` | 2 tablas (3 CHECK del pago, 2 UNIQUE, 3 índices, 6 FK, RLS en ambas) + los 2 CHECK `tipo`↔`categoria` de los libros |
| `db/migrations/20260802120000_liquidacion_pago/down.sql` | DROP de las 2 tablas en orden inverso + los 2 DROP CONSTRAINT. No toca enums |
| `lib/types/liquidacion.ts` | DTOs de §3.2 + 3 schemas zod `.strict()` del borde |
| `lib/utils/pendiente-cierre.ts` | `derivarPendienteCierre(P, E, pagadoVigente)` pura → STRING |
| `tests/integration/db/liquidacion-migration.test.ts` | 11 casos estáticos sobre el SQL |
| `tests/unit/types/liquidacion-schemas.test.ts` | 57 casos del borde |
| `tests/unit/utils/pendiente-cierre.test.ts` | 15 casos de la derivación |

**Modificados**

| Archivo | Qué |
| --- | --- |
| `db/schema.prisma` | `LiquidacionPago` + `LiquidacionAnulacion`; 4 lados inversos en `Usuario` y 1 en `CierreDia` |
| `specs/172-liquidacion/tasks.md` | T A.1–T A.4 marcadas `[x]` con una línea de lo hecho |

**Ningún `down.sql` anterior tocado**, y es deliberado: la migración no lleva **una sola sentencia
de tipos** (ni creación de enum ni valor nuevo en uno existente), que es justo lo que dispara en
este repo la cascada de «recrear el enum en los down previos». `metodo` reutiliza
`metodo_pago_value` (36) y los contraasientos de la anulación reutilizan `ajuste_credito` /
`ajuste_devengo` (43/44). Verificado por test: `expect(upSql).not.toMatch(/CREATE TYPE/i)` y
`/ALTER TYPE/i`.

### Mapa `R<n> → test` de esta tanda

| R | Test | Qué afirma |
| --- | --- | --- |
| R8 | `tests/unit/types/liquidacion-schemas.test.ts` | los 3 métodos del SEED se aceptan; `tarjeta`, `sinpe` (otra caja) y `""` → error **en el campo `metodo`** |
| R10 | idem | hoy y ayer se aceptan; mañana no; a las 20:00 CR (día UTC ya siguiente) el día sigue siendo el de CR; día y mes inexistentes rechazados |
| R11 | idem | `LIQUIDACION_MONTO_MAX` = `9999999999.99` (derivado de `DECIMAL(12,2)`); frontera exacta arriba; 12 negativos (0, negativo, 3 decimales, coma, miles, 11 dígitos, vacío, no numérico, notación científica, símbolo de moneda…) |
| R12 | idem | SINPE/transferencia sin referencia y con referencia en blanco → error en `referencia`; efectivo sin referencia → válido |
| R13 | idem | frontera exacta de `LIQUIDACION_NOTA_MAX`; un carácter más → error en `nota` |
| R14 | idem | un monto `number` se rechaza (sin coerción); tras parsear sigue siendo el MISMO string |
| R15 | idem | 5 claves de adjunto (`comprobante`, `archivo`, `adjunto`, `evidencias`, `comprobanteUrl`) rechazadas por `.strict()`, en los 3 schemas |
| R72 | idem | motivo ausente / vacío / solo espacios / solo saltos de línea → error en `motivo`; un `monto` colado en la anulación no pasa el borde (R70) |
| R22 | `tests/unit/utils/pendiente-cierre.test.ts` | `E=0` → `P`; `E≥P` → `0.00`; `P=0` → `0.00`; frontera de 1 céntimo; y coincide con `calcularSplitPago(P,E).pendiente` en 6 pares |
| R24 | idem | pagos parciales acumulados; la resta es exacta al céntimo (lo que un float redondearía mal) |
| R80 | idem | al anular, el pendiente vuelve **exactamente** al valor previo; con dos pagos y uno anulado, solo descuenta el vigente |
| R58 | `tests/integration/db/liquidacion-migration.test.ts` | el CHECK del ledger de tienda, parseado, es exactamente `credito → {cod_recaudado, ajuste_credito}` y `debito → {los 8}`, exhaustivo sobre el enum de `schema.prisma` y sin categoría repetida entre ramas |
| R59 | idem | lo mismo para el libro del mensajero: `devengo → {pago_devengado, ajuste_devengo}`, `pago → {pago_efectivo, liquidacion, ajuste_pago}` |
| R60 | idem | los dos CHECK no contienen `NOT` ni `<>`; un concepto y un tipo futuros no casan ninguna rama; y los 4 pares cruzados prohibidos (incluido `credito`+`pago_tienda`, el hueco exacto del review de la 171) se rechazan |
| R62 | idem | la migración y el down **no mencionan** `"wallet_movimiento"`; hay exactamente **2** `_tipo_categoria_check` en todo el SQL |
| R63 | idem | `ENABLE ROW LEVEL SECURITY` en las dos tablas; ni `CREATE POLICY`, ni `GRANT`, ni `anon`, ni `authenticated` |
| R64 | idem | el down suelta `liquidacion_anulacion` **antes** que `liquidacion_pago` (la FK manda), quita los 2 CHECK y no toca ningún tipo; sin `UPDATE` ni `DELETE` (aditiva) |
| R75 | idem | `CREATE UNIQUE INDEX liquidacion_anulacion_pago_id_key`, con la FK a `liquidacion_pago` |

R61 lo cubre la evidencia de T A.0 (arriba). El resto de los R de estas tablas (R7, R9, R38, R41…)
se cubren en las tandas B/C/F, donde hay código que los ejerce.

### Verificación ejecutada

**Migración, contra Postgres local** (`ordenex` en `localhost:5432`):

```
$ npx prisma migrate deploy        # la base venía con 1 pendiente (analytics_daily)
Applying migration `20260731120000_analytics_daily`
All migrations have been successfully applied.

$ pnpm run db:migrate
Applying migration `20260802120000_liquidacion_pago`
Your database is now in sync with your schema.

$ pnpm run db:rollback
Aplicando rollback: 20260802120000_liquidacion_pago
Script executed successfully.
Rollback completado: 20260802120000_liquidacion_pago

$ npx prisma migrate status
105 migrations found in prisma/migrations
Following migration have not yet been applied:
20260802120000_liquidacion_pago

$ pnpm run db:migrate               # round-trip: up -> down -> UP
Applying migration `20260802120000_liquidacion_pago`
Your database is now in sync with your schema.

$ npx prisma migrate status
105 migrations found in prisma/migrations
Database schema is up to date!
```

El ciclo `rollback` → `db:migrate` se repitió **al final**, con el `migration.sql` definitivo (los
comentarios se retocaron después del primer apply), para que el checksum registrado en
`_prisma_migrations` sea el del archivo que se commitea y no el de una versión intermedia.
`migrate status` cierra en **`Database schema is up to date!`**.

La coherencia local se midió **antes** de aplicar, con la misma consulta de T A.0:
`{"wtm_total":0,"wtm_incoherentes":0,"pmm_total":0,"pmm_incoherentes":0}` (base local vacía en los
dos libros, así que el `ADD CONSTRAINT` no tenía nada que validar aquí; la prueba de que valida
está en producción, T A.0).

**Calidad y suite:**

```
$ pnpm run typecheck
> tsc --noEmit
(sin salida: verde, con el cliente Prisma regenerado)

$ pnpm run lint
✖ 27 problems (0 errors, 27 warnings)     # los 27 warnings preexistentes del baseline, intactos

$ pnpm exec vitest run tests/integration/db
 Test Files  84 passed (84)
      Tests  985 passed (985)

$ pnpm exec vitest run                    # SUITE COMPLETA
 Test Files  775 passed (775)
      Tests  9340 passed (9340)
   Duration  260.75s

$ ./init.sh                               # gate del arnes (typecheck + lint + suite + down.sql)
✓ typecheck paso
✓ lint paso
 Test Files  775 passed (775)
      Tests  9340 passed (9340)
   Duration  227.55s
✓ test paso
✓ todas las migraciones tienen down.sql
== init OK ==
```

La suite completa se corrió **dos veces** (directa y dentro de `./init.sh`) con el mismo
resultado: 775 / 9340 / 0 fallos.

**Delta contra el baseline de la tanda (772 archivos / 9257 tests): +3 archivos, +83 tests, 0
fallos.** Los 83 son 11 + 57 + 15. **Cero regresiones** y **cero flakes** en esta corrida (los tres
archivos con contención de jsdom conocida — `ControlDescargaTransversal`, `CuentasPorPagarTable`,
`OrdenesModuleReuse` — salieron verdes sin reejecutar).

### T A.2 — prueba por mutación del CHECK (obligatoria)

Un test de regex que pasa con el SQL mutado no prueba nada. Se mutó `migration.sql` **a mano**,
dos veces, y se comprobó que el test que afirma esa rama **cae**.

**Mutación 1 — borrar la rama `credito` ENTERA** del CHECK de `wallet_tienda_movimiento`:

```
 ❯ tests/integration/db/liquidacion-migration.test.ts (11 tests | 2 failed)
     × ata cada concepto del ledger de tienda a su unico tipo valido
     × las categorias de ajuste que usa la anulacion son validas en su tipo

AssertionError: expected [ 'debito' ] to deeply equal [ 'credito', 'debito' ]
- Expected
+ Received
  [
-   "credito",
    "debito",
  ]
 ❯ tests/integration/db/liquidacion-migration.test.ts:173:44

AssertionError: expected false to be true // Object.is equality
 ❯ tests/integration/db/liquidacion-migration.test.ts:245:69   (aceptaElCheck(credito, ajuste_credito))

 Test Files  1 failed (1)
      Tests  2 failed | 9 passed (11)
```

**Mutación 2 — borrar UNA sola categoría** (`'ajuste_devengo'`) de la rama `devengo` del CHECK de
`pago_mensajero_movimiento`:

```
 ❯ tests/integration/db/liquidacion-migration.test.ts (11 tests | 2 failed)
     × ata cada concepto del libro del mensajero a su unico tipo valido
     × las categorias de ajuste que usa la anulacion son validas en su tipo

AssertionError: expected [ 'pago_devengado' ] to deeply equal [ 'pago_devengado', 'ajuste_devengo' ]
- Expected
+ Received
  [
    "pago_devengado",
-   "ajuste_devengo",
  ]
 ❯ tests/integration/db/liquidacion-migration.test.ts:198:43

AssertionError: expected false to be true // Object.is equality
 ❯ tests/integration/db/liquidacion-migration.test.ts:246:72   (aceptaElCheck(devengo, ajuste_devengo))

 Test Files  1 failed (1)
      Tests  2 failed | 9 passed (11)
```

`migration.sql` se restauró desde copia y los **11 tests volvieron a verde**. La mutación 2 es la
que importa: una sola categoría de menos ya rompe el test, no hace falta borrar la rama entera.

**Por qué funciona:** el test **no** hace `toContain` de la cadena del CHECK. Parsea la sentencia a
un mapa `tipo → categorías`, lo compara con los valores REALES del enum leídos de
`db/schema.prisma`, y evalúa la semántica del CHECK con `aceptaElCheck(tipo, categoria)`. Por eso
también avisará —a propósito, R60— el día que alguien añada un valor al enum sin clasificarlo.

### Verificación extra: los CHECK **actúan**, no solo están escritos

Los tests de migración del repo son estáticos. Se comprobó contra Postgres local, cada INSERT
dentro de su transacción y con rollback (adelanta parte de T H.3):

| Fila intentada | Resultado real |
| --- | --- |
| `wallet_tienda_movimiento` `pago_tienda` + `credito` | `23514` **`wallet_tienda_movimiento_tipo_categoria_check`** |
| `pago_mensajero_movimiento` `liquidacion` + `devengo` | `23514` **`pago_mensajero_movimiento_tipo_categoria_check`** |
| `liquidacion_pago` sin beneficiario (los dos NULL) | `23514` **`liquidacion_pago_beneficiario_check`** |
| `liquidacion_pago` con los DOS beneficiarios | `23514` **`liquidacion_pago_beneficiario_check`** |
| `liquidacion_pago` mensajero SIN cierre | `23514` **`liquidacion_pago_cierre_check`** |
| `liquidacion_pago` tienda CON cierre | `23514` **`liquidacion_pago_cierre_check`** |
| `liquidacion_pago` monto `0` | `23514` **`liquidacion_pago_monto_check`** |
| **contraprueba** `wallet_tienda_movimiento` `pago_tienda` + `debito` | pasa el CHECK; solo choca con `23503` la FK `..._tienda_id_fkey` |
| **contraprueba** `pago_mensajero_movimiento` `liquidacion` + `pago` | pasa el CHECK; solo choca con `23503` la FK `..._mensajero_id_fkey` |

Las dos últimas son la mitad que suele faltar: demuestran que el CHECK **no** rechaza todo, sino
solo lo incoherente. Ninguna fila quedó en la base (todo en transacciones revertidas).

### Hallazgos y desviaciones

1. **`new Date("2026-02-31T00:00:00.000Z")` NO es `Invalid Date` en V8**: rueda al 3 de marzo (solo
   el **mes** fuera de rango da `Invalid Date`). Por eso `esFechaPagoValida` compara el ISO **de
   vuelta** contra la entrada, y hay un test que lo fija.
   **Defecto preexistente, fuera del alcance de esta tanda:** `esFechaFutura` en
   `lib/types/gestion-orden.ts:102-106` documenta literalmente lo contrario («un dia inexistente
   ("2026-02-31") da Invalid Date») y **no** hace el round-trip, así que hoy acepta `2026-02-31`
   como fecha de reprogramación y la guarda como 3 de marzo. No se toca aquí (es código de la
   36/73 y cambia el comportamiento de otra pantalla); queda escrito para que no se atribuya a la
   172 y para que alguien decida si abre ficha.

2. **`LIQUIDACION_MONTO_MAX` se declara, no se importa de la 158.** El diseño dice «molde
   `INDEMNIZACION_MONTO_MAX`». Coinciden en valor (`9999999999.99`) porque coinciden en precisión
   de columna, no porque sean el mismo límite: el de la 158 está derivado de
   `gestion_orden.indemnizacion` y su propio docstring lo dice. Importarlo habría propagado en
   silencio el número equivocado si una de las dos columnas cambiara de precisión.

3. **La `referencia` no lleva tope de longitud.** `design.md §3.2` fija tope para la `nota`
   (`LIQUIDACION_NOTA_MAX`) y no dice nada de la referencia, y T A.3 tampoco la lista. Se ha
   seguido el spec al pie de la letra en vez de improvisar un límite. Queda **anotado como hueco
   menor**: es texto libre contra una columna `text`, igual que la nota antes de su tope. Decisión
   de una línea si se quiere cerrar en la Tanda B.

4. **Timestamp de la migración renombrado** de `20260802152854` (el que generó Prisma) a
   `20260802120000`, para seguir la convención de horas redondas del resto del repo. Se renombró
   **antes** de aplicarla, así que no hay riesgo de desajuste con `_prisma_migrations`.

5. **FK del beneficiario y del cierre: `ON DELETE RESTRICT`.** El diseño solo fija RESTRICT para
   `registrado_por`. Para `mensajero_id`/`tienda_id`/`cierre_id` (opcionales) el default de Prisma
   habría sido `SET NULL`, que en esta tabla es **inaceptable**: poner a NULL el beneficiario
   dejaría la fila violando el CHECK XOR, y borrar un cierre borraría el vínculo de un pago con lo
   que pagó. Se declaró RESTRICT explícito en las cuatro FK del pago y en las dos de la anulación.
   Es la lectura conservadora del principio «documento inmutable», no un cambio de modelo.

6. **Preview sigue sin verificar** (hueco de T A.0, arriba). No lo resuelve esta tanda; sigue
   pendiente **antes de mergear el PR**.
