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

---

## TANDA B (primera mitad) — T B.1, T B.2, T B.3 y T B.4 · **HECHAS** (2026-08-02)

> Cuatro tasks: el repositorio del documento, la fecha de movimiento en los dos libros, el acto
> de pagar a una tienda y **el candado de serialización `[P1]`**. Quedan de la tanda T B.5
> (mensajero), T B.6 (idempotencia) y T B.7 (Server Actions). **No se tocó UI, ni Server
> Actions, ni nada de la anulación.**

### Archivos

**Nuevos**

| Archivo | Qué |
| --- | --- |
| `lib/interfaces/repositories/ILiquidacionPagoRepository.ts` | Contrato del documento: `bloquearBeneficiario`, `crear`, `obtenerPorClave`, `obtenerPorId`, `sumarVigentesPorCierre`, `sumarVigentesPorTienda`, `listarPorCierre`, `listarPorTienda` |
| `lib/repositories/LiquidacionPagoRepository.ts` | Implementación (solo Prisma), incluido el `SELECT … FOR UPDATE` de §4.2 |
| `lib/interfaces/services/ILiquidacionService.ts` | `LiquidacionTx`, `LiquidacionTxRunner`, `RegistrarPagoServiceResult` y `registrarPagoTienda` |
| `lib/services/LiquidacionService.ts` | Guardia de rol, candado, disponible, documento + movimiento en una transacción |
| `lib/utils/descripcion-pago.ts` | `descripcionDePago(metodo, referencia)` y `medianocheUtcDelDia(fecha)`, puras |
| `tests/unit/repositories/liquidacion-pago-repository.test.ts` | 20 casos |
| `tests/unit/repositories/libros-fecha-movimiento.test.ts` | 6 casos (T B.2) |
| `tests/unit/services/liquidacion-service.test.ts` | 33 casos |
| `tests/integration/db/liquidacion-idempotencia.test.ts` | 10 casos (T B.4; T B.6 lo amplía) |

**Modificados**

| Archivo | Qué |
| --- | --- |
| `lib/interfaces/repositories/IWalletTiendaMovimientoRepository.ts` · `IPagoMensajeroMovimientoRepository.ts` | `fechaMovimiento?: Date` (aditivo) |
| `lib/repositories/WalletTiendaMovimientoRepository.ts` · `PagoMensajeroMovimientoRepository.ts` | La emiten **solo si viene** |
| `specs/172-liquidacion/tasks.md` | T B.1–T B.4 marcadas `[x]` |

**Ningún test existente editado.** Es la condición de «Hecho» de T B.2 y se cumple literalmente:
`tests/unit/repositories/libros-fecha-movimiento.test.ts` se creó como archivo nuevo justo para
no tener que tocar los de los dos feeds del cierre.

### Mapa `R<n> → test` de estas cuatro tasks

| R | Test | Qué afirma |
| --- | --- | --- |
| R1 | `tests/unit/services/liquidacion-service.test.ts` | los 4 roles sin acceso total → `forbidden`, con el log de llamadas **vacío** (ni una lectura salió a la base) |
| R2 | idem | **contraprueba**: `adminTienda` pidiendo **su propia** tienda (`usuarioId === tiendaId`) → `forbidden` |
| R5 | idem | el rol se evalúa antes de mirar `input.tiendaId`; un `tiendaId` ajeno no amplía el alcance |
| R6 | idem | **contraprueba**: `adminSatelite` → `forbidden` y **cero** transacciones abiertas |
| R7 | `tests/unit/repositories/liquidacion-pago-repository.test.ts` | las **10** columnas exactas del `data` (ni una más, ni una menos); `monto` como `Prisma.Decimal`; sin `createdAt` del emisor |
| R9 | idem | fecha real `2026-07-30` e instante `2026-08-02T15:04:05Z` conviven y difieren; y se conservan cuando coinciden |
| R29 | `liquidacion-service.test.ts` | el pago a tienda va sin cierre (`cierreId: null`) y lee el saldo **sin filtros** (acumulado) |
| R30 | idem | pago parcial de `0.01` sobre 100 000 → `ok` con `restante: "99999.99"` |
| R31 | idem | `60000.01` sobre 60 000 → `excede { disponible: "60000.00" }` **sin escribir**; y la frontera exacta (`monto == disponible`) sí entra |
| R32 | idem | saldo `0.00` y saldo **negativo** → `sin_saldo`, sin escribir |
| R36 | idem | `tipo: debito`, `categoria: pago_tienda`, por el monto registrado |
| R37 | idem + `libros-fecha-movimiento.test.ts` | `fechaMovimiento` = `2026-07-30T00:00:00.000Z` (medianoche UTC de la fecha REAL), no la de registro; y entra por los dos bordes del filtro por rango |
| R38 | `liquidacion-service.test.ts` | `origenTipo: "pago_tienda"` y `origenId` = el id que devolvió `crear` |
| R39 | idem + `liquidacion-idempotencia.test.ts` | candado, documento y movimiento reciben **el mismo objeto `tx`**; si el movimiento falla, el error sale de la transacción sin `commit`; y Σ documentos == Σ débitos del ledger |
| R40 | `liquidacion-service.test.ts` | el doble de `tx` expone `walletMovimiento` con 7 métodos espiados: **cero llamadas**; + contraprueba estructural (el servicio no importa `IWalletMovimientoRepository` ni nombra `walletMovimiento` fuera de comentarios) |
| R41 | idem | cero `update`/`updateMany`/`delete`/`deleteMany`/`upsert` sobre `liquidacion_pago` y los dos libros (y R42: cero sobre `cierre_dia`) |
| R46 | `tests/integration/db/liquidacion-idempotencia.test.ts` | dos pagos de 60 000 **a la vez** contra 100 000 → uno `ok`, otro `excede` con `disponible: "40000.00"`; Σ pagada = 60 000; + variantes de 3 en carrera y de dos pagos que **sí** caben |
| R80 | `liquidacion-pago-repository.test.ts` | las dos sumas llevan `anulacion: { is: null }` en el `where`; los **listados no lo llevan** (R74: el anulado se sigue viendo) |
| R83 | `liquidacion-idempotencia.test.ts` | el log lo escribe el **store**, en el borde de la sentencia: `candado:usuario:t1` → `candado-tomado` → `leer-disponible` → … |
| R85 | idem + `liquidacion-pago-repository.test.ts` | **una** adquisición por operación, también en los caminos que rechazan (y se suelta: la llamada siguiente no se cuelga); dos tiendas distintas no comparten candado |

Adelantado sin ser de estas tasks (lo cerrarán T B.6/T B.7/T H.2): **R43/R44/R47** (la rama
`ya_registrado`, la ausencia de consulta previa por clave), **R56** (el DTO emite 9 claves y
ninguna es un id de persona ni la clave de idempotencia) y **R14** (todo monto STRING escala 2).

### Verificación ejecutada

```
$ pnpm typecheck
> tsc --noEmit
(sin salida: verde)

$ pnpm run lint
✖ 27 problems (0 errors, 27 warnings)      # los 27 preexistentes del baseline, intactos

$ pnpm exec vitest run tests/integration/db
 Test Files  85 passed (85)
      Tests  995 passed (995)               # baseline 84/985 -> +1 archivo, +10 tests

$ pnpm exec vitest run                      # SUITE COMPLETA, 1.a corrida
 Test Files  1 failed | 778 passed (779)
      Tests  1 failed | 9408 passed (9409)
   Duration  214.70s
   -> el unico fallo es `tests/components/CuentasPorPagarTable.test.tsx`, uno de los tres
      archivos con contencion de jsdom conocida en esta maquina.

$ pnpm exec vitest run tests/components/CuentasPorPagarTable.test.tsx   # en AISLADO
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

La suite se corrio **dos veces**. La segunda, LIMPIA de punta a punta:

```
$ pnpm exec vitest run                      # SUITE COMPLETA, 2.a corrida
 Test Files  779 passed (779)
      Tests  9409 passed (9409)
   Duration  216.50s
```

**Delta contra el baseline de la Tanda A (775 archivos / 9340 tests): +4 archivos, +69 tests.**
Los 69 son 20 + 6 + 33 + 10. **Cero regresiones.**

### T B.4 — PRUEBA POR MUTACIÓN DEL CANDADO (obligatoria)

Un test de concurrencia que pasa sin candado no prueba nada. Se mutó **tres** veces y se
comprobó qué cae. Salidas reales:

**Mutación 1 — quitar la llamada a `bloquearBeneficiario` del servicio** (el candado deja de
existir; el resto de la cadena intacta):

```
 ❯ tests/integration/db/liquidacion-idempotencia.test.ts (10 tests | 8 failed) 157ms
     × el orden de las sentencias es candado -> lectura, no al reves
     × el candado es sobre la fila de la TIENDA, que es lo que se consume
     × un pago que entra toma EXACTAMENTE un candado
     × tambien los caminos que RECHAZAN toman uno y solo uno (y lo sueltan)
     × con un solo recurso bloqueado no existe orden de adquisicion que interbloquee
     × con 100 000 disponibles, dos pagos de 60 000 a la vez: uno entra y el otro se rechaza
     × la segunda transaccion ESPERA: su lectura ocurre despues del commit de la primera
     × tres a la vez contra 100 000: entran los que caben y el resto se rechaza

AssertionError: expected [ 'ok', 'ok' ] to deeply equal [ 'excede', 'ok' ]
- Expected
+ Received
  [
-   "excede",
+   "ok",
    "ok",
  ]
 ❯ tests/integration/db/liquidacion-idempotencia.test.ts:398:21

AssertionError: expected false to be true // Object.is equality
 ❯ tests/integration/db/liquidacion-idempotencia.test.ts:445:69
   (new Prisma.Decimal(totalPagado(store)).lte("100000.00"))

 Test Files  1 failed (1)
      Tests  8 failed | 2 passed (10)
```

Los **dos** pagos entran: se sacan **120 000** de una tienda que tenía **100 000**. Es
exactamente el fallo que P1 existe para impedir.

**Mutación 2 — dejar el candado del SERVICIO intacto y volver no-op el del STORE** (`adquirir`
deja de esperar). Es la mutación que pide el spec al pie de la letra:

```
 ❯ tests/integration/db/liquidacion-idempotencia.test.ts (10 tests | 3 failed) 150ms
     × con 100 000 disponibles, dos pagos de 60 000 a la vez: uno entra y el otro se rechaza
     × la segunda transaccion ESPERA: su lectura ocurre despues del commit de la primera
     × tres a la vez contra 100 000: entran los que caben y el resto se rechaza

AssertionError: expected [ 'ok', 'ok' ] to deeply equal [ 'excede', 'ok' ]
 ❯ tests/integration/db/liquidacion-idempotencia.test.ts:399:21

 Test Files  1 failed (1)
      Tests  3 failed | 7 passed (10)
```

**Mutación 3 — mover el candado DESPUÉS de la lectura del disponible** (el error que el test de
orden existe para cazar: un candado tomado tarde no serializa nada):

```
 ❯ tests/integration/db/liquidacion-idempotencia.test.ts (10 tests | 4 failed) 163ms
     × el orden de las sentencias es candado -> lectura, no al reves
     × con 100 000 disponibles, dos pagos de 60 000 a la vez: uno entra y el otro se rechaza
     × la segunda transaccion ESPERA: su lectura ocurre despues del commit de la primera
     × tres a la vez contra 100 000: entran los que caben y el resto se rechaza

AssertionError: expected [ 'leer-disponible:t1', …(5) ] to deeply equal [ 'candado:usuario:t1', …(5) ]
- Expected
+ Received
  [
+   "leer-disponible:t1",
    "candado:usuario:t1",
    "candado-tomado:usuario:t1",
-   "leer-disponible:t1",
    "crear-documento:pago-1",
    "crear-movimiento:1",
    "commit",
  ]
```

Tras cada mutación se restauró el archivo desde copia y los **10 tests volvieron a verde**.

**Por qué el experimento vale, y el error que casi lo invalida.** El store no tiene una lista de
a quién bloquear: detecta el candado leyendo `FOR UPDATE` en **la sentencia cruda que emite el
repositorio real**. Si alguien quitara el `FOR UPDATE` del SQL, aquí no se tomaría ningún candado
y el test caería igual. El resto de la cadena también es código real (servicio real, los dos
repositorios reales).

**Hallazgo del proceso, declarado porque es la trampa de este tipo de test:** la PRIMERA versión
del store tomaba la instantánea de las filas **después** de ceder el turno, y con eso la mutación
1 dejaba el test de carrera **en verde** (medido: 6 fallos, y el de la carrera no estaba entre
ellos). El motivo es que en `READ COMMITTED` una sentencia fotografía los datos cuando
**empieza**, no cuando responde. Se corrigió el store (foto al inicio, `tic()` después) y solo
entonces la carrera empezó a discriminar. Queda un comentario grande en el archivo para que nadie
lo «simplifique» de vuelta.

### Hallazgos y desviaciones del diseño

1. **La lectura del disponible se hace sobre el cliente propio del repositorio, no sobre el
   `tx`.** Es lo que dice `design.md §3.3` (`repo.agregarSaldoPorTienda(tiendaId)`, sin `tx`) y
   se ha respetado, pero conviene dejar escrito por qué **sigue siendo correcto** y qué cuesta:
   el candado se toma primero y no se suelta hasta el commit, así que la lectura de la segunda
   transacción ocurre necesariamente **después** del commit de la primera y ve sus filas. Lo que
   sí tiene coste es que, mientras la transacción está abierta, esa lectura toma una **segunda
   conexión** del pool. A este volumen es irrelevante; si algún día hubiera contención de pool,
   la salida es añadir un `tx` opcional a `agregarSaldoPorTienda` — que hoy habría obligado a
   tocar el contrato que usan la 43 y la 171, fuera del alcance de T B.2.

2. **El choque de la clave de idempotencia sale de la transacción lanzando, y la relectura se
   hace fuera.** El diseño dice «si conflicto → `ya_registrado` (relee por clave)» sin decir
   dónde. Se relee **fuera** porque en Postgres un error de sentencia deja la transacción
   abortada: cualquier `SELECT` posterior dentro de la misma transacción fallaría con «current
   transaction is aborted». Hay un test que fija el orden de los pasos y demuestra que la
   relectura ocurre tras salir.

3. **`ILiquidacionPagoRepository` no declara todavía `anular`, y `ILiquidacionService` declara un
   solo método.** El diseño §3.1 lista los contratos completos; declararlos ahora sin
   implementación rompería `implements`. Los añaden T F.1 y T B.5/T C.1/T F.2, que es donde el
   `tasks.md` los pone.

4. **P2002 sin pista de constraint se trata como choque de clave.** `textoConstraintP2002`
   devuelve `null` cuando el error no trae ni `meta.target` ni el mensaje del driver adapter.
   `liquidacion_pago` solo tiene dos restricciones únicas —la PK sobre un uuid recién generado,
   que no puede repetirse, y `clave_idempotencia`—, y equivocarse es benigno: el servicio relee
   por la clave, no la encuentra y responde `no_encontrado`. Nunca un pago duplicado en silencio.
   Hay un test por cada forma del error (nativa, adapter, otra constraint → se propaga).

5. **`descripcionDePago` y `medianocheUtcDelDia` viven en `lib/utils/descripcion-pago.ts`.** El
   diseño las nombra sin darles casa. No se importó `METODO_PAGO_LABEL` de
   `app/(app)/mis-asignaciones/_components/`: es un módulo de pantalla y `lib/` no depende de
   `app/`. El `Record` de etiquetas es exhaustivo sobre el enum, así que un valor nuevo rompe el
   build en vez de emitir una descripción vacía en el libro.

6. **`registrarPagoTienda` no devuelve `no_encontrado` para una tienda inexistente.** Una tienda
   sin movimientos agrega `0/0` → saldo cero → `sin_saldo`, que es la respuesta correcta y no
   filtra si el id existe o no. El contrato de §3.2 sí tiene la rama; la usará el camino del
   mensajero (T B.5), donde el cierre sí se lee.

7. **La `referencia` sigue sin tope de longitud** (hueco menor heredado de la Tanda A, punto 3 de
   aquella bitácora). No se cerró aquí: sigue siendo una decisión de una línea que el spec no
   toma.

8. **Un flake conocido en la primera corrida de la suite completa.** `CuentasPorPagarTable` cayó
   con contención de jsdom y salió **verde en aislado** (6/6). Es uno de los tres archivos
   declarados como flake móvil de esta máquina; no lo toca esta tanda.

---

## TANDA B (segunda mitad) — T B.5, T B.6 y T B.7 · **HECHAS** (2026-08-02) · TANDA B COMPLETA

> Tres tasks: el acto de pagar a un **mensajero**, la **idempotencia** con su prueba por
> mutación, y las **Server Actions** de registro. **No se tocó UI** (Tandas D/E) **ni nada de la
> anulación** (Tanda F): `anular` sigue sin declararse en el repositorio, que es T F.1.

### Archivos

**Nuevos**

| Archivo | Qué |
| --- | --- |
| `lib/actions/liquidacion.ts` | Las **2** Server Actions de registro (`registrarPagoMensajeroAction`, `registrarPagoTiendaAction`). Las otras 3 del diseño son de T C.1 y T F.4 |
| `tests/unit/actions/liquidacion-action.test.ts` | 23 casos |

**Modificados**

| Archivo | Qué |
| --- | --- |
| `lib/interfaces/repositories/ILiquidacionPagoRepository.ts` | `LiquidacionCierreTxClient`, `CierreParaPagoDTO` y `obtenerCierreParaPago(cierreId, tx?)` |
| `lib/repositories/LiquidacionPagoRepository.ts` | Implementación de esa lectura (`select` de 5 columnas, montos STRING); el cliente propio gana `cierreDia` **solo para leer** |
| `lib/interfaces/services/ILiquidacionService.ts` | `registrarPagoMensajero` en el contrato; `LiquidacionTx` gana el cliente del cierre |
| `lib/services/LiquidacionService.ts` | `registrarPagoMensajero`, `pendienteDelCierre`, `restanteDe`; `responderYaRegistrado` pasa a recibir el beneficiario |
| `tests/unit/services/liquidacion-service.test.ts` | 33 → **67** casos (la mitad mensajero) |
| `tests/unit/repositories/liquidacion-pago-repository.test.ts` | 20 → **25** casos (la lectura del cierre) |
| `tests/integration/db/liquidacion-idempotencia.test.ts` | 10 → **26** casos; el store gana `cierre_dia`, el libro del mensajero y el `UNIQUE` observable |
| `specs/172-liquidacion/tasks.md` | T B.5–T B.7 marcadas `[x]` |

**Ningún archivo de otra feature tocado.** Los dos libros, los feeds del cierre, la caja y la
migración quedan exactamente como estaban.

### Mapa `R<n> → test` de estas tres tasks

| R | Test | Qué afirma |
| --- | --- | --- |
| R20 | `tests/unit/services/liquidacion-service.test.ts` | `solicitado`, `vencido` y `rechazado` → `cierre_no_aprobado` **sin escribir nada** y **sin derivar siquiera el pendiente**; + `liquidacion-idempotencia.test.ts`: dos intentos en carrera contra un cierre no aprobado dejan **cero** filas |
| R20 | idem | la guardia se lee **dentro** de la transacción: el log es `bloquear → leer:cierre → leer:pagado` y el `tx` del cierre es **el mismo objeto** que el del candado y las escrituras |
| R21 | idem | el documento sale con `cierreId` y `tiendaId: null`; un pago a mensajero **sin** cierre no pasa el borde (`liquidacion-action.test.ts`, error en el campo `cierreId`) |
| R23 | idem | un monto menor que el pendiente entra y devuelve el resto |
| R24 | idem | `restante` exacto al céntimo: 50 000 − 10 000 pagados − 15 000 = `"25000.00"`; y la frontera de 1 céntimo (`999.98` pagados, pago de `0.01` → `"0.01"`) |
| R25 | idem | `50000.01` sobre un pendiente de 50 000 → `excede { disponible: "50000.00" }` sin escribir; la frontera exacta (monto == pendiente) sí entra y deja `"0.00"` |
| R35 | idem | movimiento `pago`/`liquidacion` por el monto, en el libro del **mensajero**, y **cero** filas en el ledger de la tienda |
| R42 | idem, **tres vías** | (a) los 7 espías de `tx.cierreDia` con cero llamadas; (b) al repositorio solo se le pide **leer** el cierre; (c) contraprueba estructural: `LiquidacionPagoRepository` no contiene `cierreDia.update/updateMany/create/delete/upsert` y el servicio no nombra el delegado. En el store de integración, `cierre_dia.update` **lanza**: el snapshot se compara campo a campo antes y después |
| R43 | `tests/integration/db/liquidacion-idempotencia.test.ts` | la misma clave dos veces → **un** pago, el **mismo** comprobante (`toEqual`, campo a campo) y el saldo saldado **una** vez; en los **dos** caminos (tienda y mensajero) |
| R44 | idem | en el camino feliz **no** hay lectura por clave; en el reintento el `INSERT` se **intenta** y lo rechaza la restricción (`choque-clave`, emitido por el store) **antes** de releer; el servicio pide crear las dos veces |
| R45 | idem | mismo beneficiario, monto, método y fecha con **dos** claves → dos pagos, dos movimientos, dos `origen_id` distintos; en los dos caminos |
| R47 | idem | el reintento devuelve `ya_registrado` con el comprobante real, aunque el reintento traiga otro monto |
| R48 | idem | reintentar el feed del cierre con el repositorio **real** → `count = 0`, cero filas nuevas; y el movimiento de la liquidación **convive** con los del cierre (otro `origen_tipo`, 3 claves distintas). Además, el propio movimiento del pago es no-op al reescribirse |
| R3 | `tests/unit/actions/liquidacion-action.test.ts` | sin sesión → `unauthenticated` **sin llamar al servicio**, en las dos acciones; y **con la petición rota también** gana `unauthenticated` (el orden de R3 es literal) |
| R14 | idem | un `monto: 15000` numérico → `validation_error` en el campo `monto`, sin tocar el servicio; el string llega **intacto** al servicio; y la respuesta no contiene **ni un número suelto** al serializarla |
| R65 | idem | la lista **exacta** de exportaciones del módulo (2), y un patrón que rechaza `editar/actualizar/modificar/corregir/update/patch`. No es un comentario: es una aserción |

Reforzados de paso (ya tenían test en tandas previas, ahora también por el segundo camino):
**R1/R5/R6** (los 4 roles sin acceso → `forbidden` con log vacío, `adminSatelite` incluido),
**R22** (las tres formas de `min(P,E)`: `E=0`, `0<E<P`, `E≥P`), **R27** (cierre ya liquidado →
`sin_saldo`), **R37/R38/R39/R40/R41**, **R46/R83/R85** (el candado del **cierre**: uno solo, antes
de leer, y dos cierres distintos no se estorban), **R56** y **R12/R15/R29** en el borde.

### Verificación ejecutada

```
$ pnpm typecheck
> tsc --noEmit
(sin salida: verde)

$ pnpm run lint
✖ 27 problems (0 errors, 27 warnings)      # los 27 preexistentes del baseline, intactos

$ pnpm exec vitest run tests/integration/db
 Test Files  85 passed (85)
      Tests  1011 passed (1011)             # 995 -> +16, todos de idempotencia

$ pnpm exec vitest run                      # SUITE COMPLETA
 Test Files  780 passed (780)
      Tests  9487 passed (9487)
   Duration  259.96s

$ ./init.sh                                 # gate del arnes (typecheck + lint + suite + down.sql)
✓ typecheck paso
✓ lint paso
 Test Files  780 passed (780)
      Tests  9487 passed (9487)
   Duration  228.99s
✓ test paso
✓ todas las migraciones tienen down.sql
== init OK ==
```

La suite completa se corrió **dos veces** (directa y dentro de `./init.sh`), con el mismo
resultado exacto: 780 / 9487 / 0 fallos. **Regla de cierre de Tanda B cumplida.**

**Delta contra el baseline de la Tanda B 1/2 (779 archivos / 9409 tests): +1 archivo, +78 tests,
0 fallos.** Los 78 son 34 (servicio) + 5 (repositorio) + 16 (idempotencia) + 23 (acciones).
**Cero regresiones y CERO flakes**: los tres archivos con contención de jsdom conocida
(`ControlDescargaTransversal`, `CuentasPorPagarTable`, `OrdenesModuleReuse`) salieron verdes sin
reejecutar, así que no hizo falta una segunda corrida.

### T B.6 — PRUEBA POR MUTACIÓN DE LA IDEMPOTENCIA (obligatoria)

Un test de idempotencia que pasa sin la restricción no prueba nada. Se mutó **el store** —no el
servicio— dos veces, porque el store es quien encarna la barrera de datos.

**Mutación 1 — apagar el `UNIQUE(clave_idempotencia)`** (`if (false && (clavesIdempotencia.has…`):

```
 ❯ tests/integration/db/liquidacion-idempotencia.test.ts (26 tests | 5 failed) 765ms
     × la misma clave dos veces: un pago, el MISMO comprobante y el saldo saldado una vez
     × R43/R47 tambien en el camino del MENSAJERO (es codigo distinto, no una rama compartida)
     × un reintento con la misma clave pero OTRO monto tampoco crea nada (la clave manda)
     × en el reintento, la lectura por clave ocurre DESPUES del intento de insertar
     × sin ese choque no habria idempotencia: el servicio no filtra claves en memoria

AssertionError: expected 'ok' to be 'ya_registrado' // Object.is equality

Expected: "ya_registrado"
Received: "ok"
 ❯ tests/integration/db/liquidacion-idempotencia.test.ts:673:28

AssertionError: expected [ 'crear-documento:pago-1', …(1) ] to deeply equal [ 'crear-documento:pago-1', …(1) ]
- Expected
+ Received
  [
    "crear-documento:pago-1",
-   "choque-clave",
+   "crear-documento:pago-2",
  ]
 ❯ tests/integration/db/liquidacion-idempotencia.test.ts:766:22

 Test Files  1 failed (1)
      Tests  5 failed | 21 passed (26)
```

El `crear-documento:**pago-2**` es el fallo en su forma más cruda: **el doble submit crea un
segundo pago** y salda el saldo dos veces. Cae **el primer test**, que es lo que el criterio de
«Hecho» exige, y con él los otros cuatro de la familia.

**Mutación 2 — apagar el ÍNDICE ÚNICO PARCIAL del libro del mensajero** (la otra mitad de la
idempotencia, la que hereda el movimiento por su `origen_id`):

```
 ❯ tests/integration/db/liquidacion-idempotencia.test.ts (26 tests | 2 failed) 895ms
     × el feed del cierre es no-op al reintentarse, y el pago de la 172 CONVIVE con el
     × y el propio movimiento del pago es idempotente por su `origen_id` (doble escritura = no-op)

AssertionError: expected 2 to be +0 // Object.is equality
- Expected
+ Received
- 0
+ 2
 ❯ tests/integration/db/liquidacion-idempotencia.test.ts:890:21   (segunda aprobacion del cierre)

AssertionError: expected 1 to be +0 // Object.is equality
 ❯ tests/integration/db/liquidacion-idempotencia.test.ts:925:16   (doble escritura del pago)
```

Tras cada mutación el archivo se restauró **desde copia** (`diff` limpio contra el respaldo) y los
**26 tests volvieron a verde**.

**Por qué el experimento vale.** El store se reutiliza tal cual salió corregido de T B.4 —foto de
las filas **al inicio** de la sentencia, la semántica real de `READ COMMITTED`— y encima de esa
base se añadieron las dos restricciones. La cadena es código real: servicio real, los **tres**
repositorios reales y el SQL crudo real. Lo único simulado es la base.

### Hallazgos y desviaciones del diseño

1. **El diseño no dice CÓMO se lee el cierre, y hacía falta un método nuevo.** `design.md §3.1`
   lista los métodos de `ILiquidacionPagoRepository` y ninguno lee `cierre_dia`, pero §3.3 exige
   que el estado se compruebe **dentro de la transacción** y §5 necesita `P` y `E` del propio
   cierre. Se añadió `obtenerCierreParaPago(cierreId, tx?)` **a ese mismo repositorio** en vez de
   crear un par interfaz+clase nuevo: es el único módulo de la feature que ya tocaba `cierre_dia`
   (el `SELECT … FOR UPDATE` del candado). Es de **solo lectura** y hay un test que afirma que en
   toda la clase no existe ninguna escritura sobre ese delegado (R42).
   **El `tx` es opcional a propósito, y es el punto delicado:** con `tx` es la guardia (bajo
   candado, R20); sin `tx` es la relectura idempotente, que ocurre necesariamente **fuera** —en
   Postgres el choque de la clave deja la transacción abortada—. Para que la opcionalidad no se
   convierta en un descuido silencioso, un test fija que el registro pasa **siempre** el `tx` y
   que es el **mismo objeto** que recibe el candado.

2. **El constructor del servicio cambió de 3 a 4 dependencias** (`pagoRepo`, `tiendaRepo`,
   **`mensajeroRepo`**, `runTransaction`). Obligó a tocar los dos archivos de test de la 172 que
   lo instancian; no se editó **ninguna aserción existente** por ese motivo, solo la línea de
   construcción y el doble del repositorio.

3. **Pendiente 0 devuelve `sin_saldo`, no `excede { disponible: "0.00" }`.** El diseño describe
   `registrarPagoMensajero` como «el mismo esqueleto» cambiando el paso (c), y en el camino de la
   tienda ese paso es `disponible <= 0 → sin_saldo`. Se tradujo literalmente para que los dos
   caminos tengan la misma forma; la alternativa (`excede` con cero) también encaja en R25 y se
   descartó por simetría. La pantalla, además, ni siquiera ofrecerá el botón (R27): esta rama es
   la red del servidor ante una carrera.

4. **`no_encontrado` se estrena aquí**, tal como anticipó el punto 6 de la bitácora de la 1/2: un
   `cierreId` que no existe no se puede confundir con «sin pendiente». También lo devuelve la rama
   idempotente si el pago releído apunta a un cierre que ya no está.

5. **El log del store gana `choque-clave`, y no es cosmético.** Sin él, «el INSERT se intentó y lo
   rechazó la base» no era observable: el store lanzaba el `P2002` **antes** de registrar nada, así
   que el test de R44 no podía distinguir un choque de un `SELECT` previo. Se emite **solo** en la
   rama de rechazo, así que el log del camino feliz —y la aserción exacta de T B.4— no cambia.

6. **`registrarPagoTienda` no se tocó** salvo por el argumento de `responderYaRegistrado`, que
   ahora recibe el beneficiario en vez de un `tiendaId` suelto. Las 33 aserciones de T B.3 siguen
   verdes sin editarse.

7. **La `referencia` sigue sin tope de longitud.** Tercera tanda que lo hereda (Tanda A punto 3,
   Tanda B 1/2 punto 7). Sigue siendo una decisión de una línea que el spec no toma; la Tanda D,
   que construye el formulario, es el último sitio razonable para cerrarlo.

8. **Preview sigue sin verificar** (hueco de T A.0). No lo resuelve esta tanda; sigue pendiente
   **antes de mergear el PR**.

---

## TANDA C — Lecturas: pendiente, comprobantes y filtro · **COMPLETA** (2026-08-02)

> T C.1, T C.2 y T C.3. **No se tocó UI** (Tandas D/E) **ni la anulación** (Tanda F): `anular`
> sigue sin declararse en el repositorio ni en el servicio. Lo único que la anulación aporta a
> esta tanda es su BLOQUE en el DTO, que ya existía desde la Tanda A porque el modelo existe.
>
> **Baseline al inicio: 780 archivos / 9487 tests / 0 fallos.**

### Archivos

**Nuevos**

| Archivo | Qué |
| --- | --- |
| `tests/unit/repositories/pago-mensajero-filtro-cierre.test.ts` | 12 casos de T C.3, **sobre el repositorio**, con un mini-motor que evalúa el `where` contra filas sembradas |
| `tests/unit/services/cierres-admin-pendiente.test.ts` | 24 casos de T C.2 (derivación, los tres listados, el detalle, aprobar y el **conteo de llamadas**) |

**Modificados — código**

| Archivo | Qué |
| --- | --- |
| `lib/types/liquidacion.ts` | `LIQUIDACION_REFERENCIA_MAX` + tope en el schema (desviación declarada, abajo); `ListarPagosResult` y los 2 schemas `.strict()` de los listados |
| `lib/interfaces/services/ILiquidacionService.ts` · `lib/services/LiquidacionService.ts` | `listarPagosDeCierre` / `listarPagosDeTienda` + `ListarPagosServiceResult` |
| `lib/actions/liquidacion.ts` | `listarPagosDeCierreAction` / `listarPagosDeTiendaAction` (4 de las 5 acciones del diseño; falta la anulación, T F.4) |
| `lib/interfaces/services/ICierresAdminService.ts` | `pendientePagoMensajero` en `CierreAdminResumen` (`string \| null`) y en `AprobarCierreServiceResult.ok` (`string`) |
| `lib/services/CierresAdminService.ts` | 5.ª dependencia (solo lectura), `conPendiente`, `pendienteTrasAprobar`; `toResumen` emite `null` y sigue sin derivar dinero |
| `lib/actions/cierres-admin.ts` | Cablea `LiquidacionPagoRepository` en el servicio |
| `lib/interfaces/repositories/IPagoMensajeroMovimientoRepository.ts` · `lib/repositories/PagoMensajeroMovimientoRepository.ts` | El filtro `cierreId` pasa al `OR` de §5; el cliente Prisma gana `liquidacionPago` **solo para leer** |
| `specs/172-liquidacion/tasks.md` | T C.1–T C.3 marcadas `[x]` |

**Modificados — tests de la 172 (propios)**

`liquidacion-service.test.ts` (67 → **82**), `liquidacion-action.test.ts` (23 → **30**),
`liquidacion-schemas.test.ts` (57 → **62**).

**Modificados — tests AJENOS (15 archivos): el detalle, archivo por archivo**

Dos cambios mecánicos lo explican todo, y ninguno de los dos es opcional: (a)
`CierreAdminResumen` y `AprobarCierreServiceResult.ok` ganaron un campo **obligatorio**, así que
toda factoría de fixtures y todo `toEqual` de una aprobación tenía que declararlo o el
`typecheck` no pasa; (b) `CierresAdminService` pasó de 4 a 5 parámetros de constructor.

| Archivo | Qué se tocó | ¿Aserción tocada? |
| --- | --- | --- |
| `tests/components/CierresAdminModule.test.tsx` | +1 línea en la factoría `makeResumen`; +1 línea en el `aprobarMock.mockResolvedValue` | **No.** Las dos son datos de entrada (fixture y valor devuelto por un mock) |
| `tests/components/CierresAdminIndemnizacion.test.tsx` | idem (factoría + `aprobarMock`) | **No** |
| `tests/components/descarga/CierresDescarga.test.tsx` | +1 línea en la factoría | **No** |
| `tests/components/paginacion/BajoRiesgoPaginacion.test.tsx` | +1 línea en la factoría | **No** |
| `tests/components/paginacion/ColasPaginacion.test.tsx` | +1 línea en la factoría | **No** |
| `tests/components/paginacion/paginacion-transversal.test.tsx` | +1 línea en la factoría (con el valor según el estado del cierre) | **No** |
| `tests/unit/services/cierres-admin-service.test.ts` | 5.º argumento en `newService`; el campo añadido a **4** `toEqual` de `aprobarCierre` | **Sí, y solo añadiendo.** Los 4 siguen siendo `toEqual` (comparación exacta), con una clave más. Ni una aserción borrada ni relajada |
| `tests/unit/services/cierres-admin-indemnizacion.test.ts` | 5.º argumento; el campo en **2** `toEqual` | **Sí, y solo añadiendo** (siguen siendo `toEqual`) |
| `tests/unit/services/CierresAdminService.aprobar.devolucion.test.ts` | 5.º argumento; el campo en **1** `toEqual` | **Sí, y solo añadiendo** |
| `tests/unit/services/cierres-admin-historico-paginado.test.ts` | 5.º argumento | **No** |
| `tests/unit/services/cierres-admin-pendientes-paginado.test.ts` | 5.º argumento | **No** |
| `tests/integration/db/devolucion-rechazadas-flow.test.ts` | 5.º argumento; el campo en **1** `toEqual` | **Sí, y solo añadiendo** |
| `tests/unit/repositories/pago-mensajero-movimiento-repository.test.ts` | `liquidacionPago` en el doble de Prisma; el `where` esperado del filtro por cierre pasa a ser el `OR`; **+1 aserción nueva** (la lectura de ids va acotada por el cierre) | **Sí: es el ÚNICO cambio de EXPECTATIVA de toda la tanda.** Es inevitable —R52 cambia ese `WHERE`, que es literalmente lo que la task pide— y el test queda **más fuerte**, no más débil: sigue siendo `toEqual` del `where` completo y gana una aserción |
| `tests/unit/actions/liquidacion-action.test.ts` (propio) | los 2 métodos nuevos en el doble del servicio; la lista EXACTA de exportaciones de R65 pasa de 2 a 4 | **Sí: R65 por diseño.** Ese test existe para que ampliar la superficie obligue a mirarla |
| `tests/unit/services/liquidacion-service.test.ts` (propio) | `pagos` en `buildDobles` (los listados dejan de devolver `[]` fijo) | **No** |

**Cero aserciones debilitadas y cero borradas.** En particular: **ningún `toEqual` se convirtió
en `toMatchObject`**, y ningún `expect` previo desapareció. Comprobado leyendo el diff completo
de los 15 archivos, no de memoria.

### Mapa `R<n> → test` de esta tanda

| R | Test | Qué afirma |
| --- | --- | --- |
| R49 | `tests/unit/services/liquidacion-service.test.ts` | el comprobante de un cierre sale con sus 7 datos + el NOMBRE de quien registró + el instante, comparados campo a campo (`toEqual`); el orden del repositorio se conserva |
| R50 | idem | los de una tienda salen por el **otro** listado y `listarPorCierre` **no** se llama; sin pagos → lista vacía (no `no_encontrado`: no revela si el id existe) |
| R56 | idem | **criterio duro por partida doble**: (a) el DTO emite EXACTAMENTE 9 claves; (b) barrido inverso sobre la respuesta serializada — **todo** uuid que aparece es el `id` de un pago, y los uuids de mensajero, tienda y cierre no están |
| R74 | idem | el pago anulado sale **entero** (monto, referencia, fecha real, quién) **más** motivo/actor/instante; vigentes y anulados salen juntos (quien excluye anulados es la SUMA, R80, no la lista) |
| R1/R2/R6 | idem | los **4** roles sin acceso total → `forbidden` en los **dos** listados con el log de llamadas **vacío**; `adminTienda` pidiendo **su propia** tienda, también; y la contraprueba de que `maestro`/`admin` sí pueden |
| R3 | `tests/unit/actions/liquidacion-action.test.ts` | sin sesión → `unauthenticated` sin tocar el servicio en los dos listados, **y con la petición rota también** |
| R22 | `tests/unit/services/cierres-admin-pendiente.test.ts` | `E=0` → todo `P`; `E` parcial menos lo ya pagado; exacto al céntimo (`0.30 − 0.10 − 0.10 = 0.10`, que un float daría `0.09999…`); y coincide con `derivarPendienteCierre` en 5 pares (la regla no se reimplementa) |
| R26 | idem | los **tres** listados traen el campo (cola paginada, histórico paginado y sin paginar) **y el detalle**; y el **coste**: con páginas de 1, 5 y 50 filas el listado hace **1** llamada, medido contando |
| R28 | idem | `solicitado`, `vencido` y `rechazado` → `null`, y sus ids **ni siquiera viajan** a la agregación; en una respuesta mezclada, cada fila lleva lo suyo |
| R27 | idem | pagado del todo → `"0.00"`, que **no** es `null`: son dos cosas distintas y la pantalla las distingue |
| R16/R18 | idem | tras aprobar, `ok` trae el pendiente derivado; el orden es `aprobar → leer-cierre` (la derivación **no** entra en la transacción de aprobación); `conflict`/`no_encontrada` no derivan nada |
| R52 | `tests/unit/repositories/pago-mensajero-filtro-cierre.test.ts` | **las dos mitades**: filtrando por SU cierre salen el pago y su contraasiento; filtrando por OTRO cierre **no sale ninguno**. Más: el `mensajeroId` sigue acotando aunque el `OR` case (R20), el rango de fechas compone por AND, la página y el conteo usan el MISMO `where`, y la **cabecera** (agregación) cuenta lo mismo que la tabla |
| R12 | `tests/unit/types/liquidacion-schemas.test.ts` | frontera exacta de `LIQUIDACION_REFERENCIA_MAX`, un carácter más → error **en el campo `referencia`**; el tope se mide tras el `.trim()`; referencias reales caben; el tope de la referencia y el de la nota son números distintos y no se confunden |

R14 se refuerza en los tres frentes (todo monto STRING de escala 2; cero `Number(` y cero
`parseFloat` en los archivos nuevos y en los tocados, tests incluidos).

### Verificación ejecutada

```
$ pnpm typecheck
> tsc --noEmit
(sin salida: verde)

$ pnpm run lint
✖ 27 problems (0 errors, 27 warnings)      # los 27 preexistentes del baseline, intactos

$ pnpm exec vitest run tests/integration/db
 Test Files  85 passed (85)
      Tests  1011 passed (1011)             # igual que la Tanda B: esta tanda no añade tests de db

$ pnpm exec vitest run                      # SUITE COMPLETA
 Test Files  782 passed (782)
      Tests  9550 passed (9550)
   Duration  227.75s

$ ./init.sh                                 # gate del arnes (typecheck + lint + suite + down.sql)
✓ typecheck paso
✓ lint paso
 Test Files  782 passed (782)
      Tests  9550 passed (9550)
   Duration  229.93s
✓ test paso
✓ todas las migraciones tienen down.sql
✓ .env presente
== init OK ==
```

La suite completa se corrió **dos veces** (directa y dentro de `./init.sh`) con el mismo
resultado exacto: **782 / 9550 / 0 fallos**. Regla de cierre de tanda cumplida.

**Delta contra el baseline de la Tanda B (780 archivos / 9487 tests): +2 archivos, +63 tests, 0
fallos.** Los 63 son 12 (filtro por cierre) + 24 (pendiente) + 15 (servicio: 67→82) + 7
(acciones: 23→30) + 5 (schemas: 57→62). **Cero regresiones y CERO flakes**: los tres archivos con
contención de jsdom conocida (`ControlDescargaTransversal`, `CuentasPorPagarTable`,
`OrdenesModuleReuse`) salieron verdes en las dos corridas, sin reejecutar.

### T C.3 — PRUEBA POR MUTACIÓN DEL `WHERE` (obligatoria)

**Por qué el test vive en el repositorio.** Los tests de servicio del desglose usan un doble del
repositorio: afirman que se le pasa `cierreId` y **no ven la traducción a SQL**. Por eso el doble
de este archivo no devuelve filas fijas: es un mini-motor que **evalúa** el `where` emitido
contra filas sembradas (el pago, su contraasiento, los dos movimientos del feed, otro cierre con
su propio pago y una fila de otro mensajero colgando del mismo pago). Y **lanza** ante cualquier
columna u operador que no conozca, para que una mutación que use otra construcción reviente en
vez de pasar por «no casa nada» — hay dos tests que comprueban que el motor lanza de verdad.

**Mutación 1 — volver al filtro VIEJO** (`origen_tipo = 'cierre_dia' AND origen_id = <cierre>`,
que es literalmente lo que había antes de esta task):

```
 ❯ tests/unit/repositories/pago-mensajero-filtro-cierre.test.ts (12 tests | 7 failed) 18ms
     × MITAD 1: con el pago y su contraasiento sembrados, filtrar por SU cierre devuelve los dos
     × MITAD 2: filtrar por OTRO cierre NO devuelve ninguno de los dos
     × el acotado por MENSAJERO sigue mandando: el `OR` no lo desborda (R20)
     × el rango de fechas tambien compone por AND con el `OR` del cierre
     × la pagina y el conteo miran el MISMO conjunto (el total no cuenta otra cosa)
     × la cuenta por pagar filtrada por el cierre incluye el pago y su contraasiento
     × con el pago VIGENTE (sin anular), la cuenta por pagar del cierre baja en su monto

AssertionError: expected [ 'f-devengo-c1', 'f-efectivo-c1' ] to include 'liquidacion-c1'
 ❯ tests/unit/repositories/pago-mensajero-filtro-cierre.test.ts:253:17

AssertionError: expected 2 to be 4 // Object.is equality
- Expected
+ Received
- 4
+ 2
 ❯ tests/unit/repositories/pago-mensajero-filtro-cierre.test.ts:340:21

AssertionError: expected { devengado: '50000.00', …(1) } to deeply equal { devengado: '80000.00', …(1) }
- Expected
+ Received
  {
-   "devengado": "80000.00",
-   "pagado": "50000.00",
+   "devengado": "50000.00",
+   "pagado": "20000.00",
  }
 ❯ tests/unit/repositories/pago-mensajero-filtro-cierre.test.ts:354:17

 Test Files  1 failed (1)
      Tests  7 failed | 5 passed (12)
```

**Mutación 2 — un `OR` QUE SE LO TRAE TODO** (la segunda rama sin el `origenId ∈ pagos`:
`{ origenTipo: "pago_mensajero" }` a secas). Es la mutación que la mitad 1 sola **no** cazaría:

```
 ❯ tests/unit/repositories/pago-mensajero-filtro-cierre.test.ts (12 tests | 5 failed) 18ms
     × MITAD 2: filtrar por OTRO cierre NO devuelve ninguno de los dos
     × un cierre SIN pagos no ensancha nada: la rama del pago no casa ninguna fila
     × la pagina y el conteo miran el MISMO conjunto (el total no cuenta otra cosa)
     × la cuenta por pagar filtrada por el cierre incluye el pago y su contraasiento
     × con el pago VIGENTE (sin anular), la cuenta por pagar del cierre baja en su monto

AssertionError: expected [ 'contraasiento-c1', …(3) ] to not include 'liquidacion-c1'
 ❯ tests/unit/repositories/pago-mensajero-filtro-cierre.test.ts:266:21

AssertionError: expected [ 'contraasiento-c1', …(2) ] to deeply equal []
- Expected
+ Received
- []
+ [
+   "contraasiento-c1",
+   "liquidacion-c1",
+   "liquidacion-c2",
+ ]
 ❯ tests/unit/repositories/pago-mensajero-filtro-cierre.test.ts:276:61

AssertionError: expected 5 to be 4 // Object.is equality
 ❯ tests/unit/repositories/pago-mensajero-filtro-cierre.test.ts:340:21

 Test Files  1 failed (1)
      Tests  5 failed | 7 passed (12)
```

Tras cada mutación se restauró el archivo **desde copia** (`diff` limpio contra el respaldo) y
los **12 tests volvieron a verde**. La lectura conjunta es la que vale: la mitad 1 cae con el
filtro estrecho y la mitad 2 cae con el filtro ancho. Con una sola de las dos, uno de los dos
defectos habría pasado en verde — que es exactamente lo que el «Hecho» de T C.3 anticipa.

### T C.2 — prueba por mutación del COSTE (el criterio duro se afirma contando)

Mutación: derivar el pendiente **por fila** (un `sumarVigentesPorCierre([id])` dentro del bucle)
en vez de una sola llamada con los ids de la página. Es el error natural y **no cambia ni una
cifra** del resultado: solo el número de consultas.

```
 ❯ tests/unit/services/cierres-admin-pendiente.test.ts (24 tests | 5 failed) 23ms
     × un cierre `solicitado` lo devuelve `null` y NO entra en la agregacion
     × un cierre `vencido` lo devuelve `null` y NO entra en la agregacion
     × un cierre `rechazado` lo devuelve `null` y NO entra en la agregacion
     × el listado SIN PAGINAR (cola + historico) usa una sola agregacion para las dos listas
     × EL COSTE: el numero de llamadas NO crece con el tamaño de pagina

AssertionError: expected "vi.fn()" to be called 1 times, but got 2 times
 ❯ tests/unit/services/cierres-admin-pendiente.test.ts:237:48

AssertionError: con pageSize=5 el listado hizo mas de una consulta de pagos:
  expected "vi.fn()" to be called 1 times, but got 5 times
 ❯ tests/unit/services/cierres-admin-pendiente.test.ts:286:9
```

Restaurado desde copia; los **24** volvieron a verde. Ninguna aserción de VALOR cambió con la
mutación: sin contar llamadas, esta regresión sería invisible.

### Desviación declarada del diseño — el tope de la `referencia`

**Decisión del leader (2026-08-02), no del implementer.** `design.md §3.2` fija tope para la
`nota` y **calla sobre la `referencia`**; el hueco se venía reportando desde la Tanda A (punto 3),
la Tanda B 1/2 (punto 7) y la Tanda B 2/2 (punto 7). Se cierra aquí.

- **Tope elegido: `LIQUIDACION_REFERENCIA_MAX = 60`.**
- **De dónde sale, y por qué no es un número improvisado:** es el tope que este repo ya usa para
  un **identificador corto tecleado por una persona contra una columna `text`** — el
  identificador de una API key (`lib/types/api-key.ts:17`: «El identificador no puede exceder 60
  caracteres»). Es el único campo de esa familia en el árbol y el más corto del catálogo de topes
  de texto del repo (60 · 200 `ranking` · 300 `deshacer-asignacion` · 500 `nota` e `incidente` ·
  2000 `nota-privada` · 4096 `chat`). Una referencia de SINPE o de transferencia son 6-25
  caracteres en la práctica, así que 60 no recorta ningún caso real y cierra la puerta al texto
  sin fin. **No hay ninguna columna `varchar` en el esquema** (todo es `text`), así que no existe
  un límite de base del que derivarlo, al contrario que en el monto.
- **Dónde vive:** en el schema zod de `lib/types/liquidacion.ts`, con `.trim()` **antes** del
  `.max()` (los checks de zod corren en orden), así que el tope se mide sobre lo que de verdad se
  guarda y no sobre los espacios que rodean. Aplica a los dos registros, porque el campo vive en
  el bloque común de campos.
- **Qué NO se hizo:** no se igualó al tope de la nota. Un identificador y un texto libre no
  comparten límite porque no comparten naturaleza, y hay un test que afirma que los dos números
  son distintos (un texto de 61 caracteres es una nota válida y una referencia inválida).

### Hallazgos y desviaciones

1. **`CierresAdminService` pasa de 4 a 5 dependencias, y la 5.ª es OBLIGATORIA.** Se consideró
   hacerla opcional para no tocar los seis sitios que instancian el servicio, y se descartó: con
   una dependencia opcional, olvidar cablearla dejaría **todos** los pendientes en `null` —una
   deuda invisible en la pantalla— en vez de romper el build. Lo que sí se acotó es la
   superficie: entra como `Pick<…, "sumarVigentesPorCierre" | "obtenerCierreParaPago">`, las dos
   de **solo lectura**, así que el typecheck impide que esa pantalla registre o anule un pago.
   Aprobar y pagar siguen siendo dos escrituras distintas (§8).

2. **El pendiente entra TAMBIÉN en el detalle del cierre**, aunque el «Hecho» de T C.2 solo nombra
   los tres listados. R26 dice literalmente «en el listado de cierres **y en el detalle de ese
   cierre**», y `verCierreDetalle` devuelve un `CierreAdminResumen`: dejarlo en `null` ahí habría
   sido una trampa para T E.2, que es justo la pantalla que lo necesita. Cuesta una agregación
   con un solo id.

3. **Tras aprobar, un cierre irreleíble devuelve `"0.00"`, no un error.** No puede pasar en el
   camino real (se acaba de actualizar esa fila), y la respuesta segura es no ofrecer pagar una
   cifra que nadie derivó: el pendiente real sigue apareciendo en el listado, que lo recalcula
   cada vez que alguien mira. Está escrito en el docstring para que no se lea como un descuido.

4. **T C.1 añade también las dos Server Actions de listar**, no solo los métodos del servicio. El
   diseño (§3.1) habla de **5** acciones y la bitácora de T B.7 dejó anotado que «las otras tres
   son de T C.1 y T F.4»; sin ellas, los métodos del servicio no tendrían llamador y las Tandas
   D/E tendrían que inventárselo. Quedan **4 de 5**; la quinta (anular) es T F.4. El test de R65
   sigue afirmando la lista **exacta** de exportaciones, ahora de cuatro.

5. **Los listados de comprobantes se cierran a `maestro`/`admin`, igual que pagar.** Un listado
   de comprobantes dice quién cobró, cuánto y cómo: es la misma superficie de dinero, no «solo
   lectura». El `adminTienda` y el `mensajero` ven **lo suyo** por `/mi-wallet` y `/mis-pagos`,
   que leen el LIBRO y no esta lista (Tanda G).

6. **`agregarCuentaPorPagar` hereda el `OR` de T C.3, y es deliberado.** El «Hecho» de la task
   solo habla del listado, pero las dos consultas alimentan la **misma** pantalla: la cabecera y
   la tabla. Si solo cambiara el listado, el desglose filtrado por un cierre mostraría el pago en
   la tabla y no lo restaría en la cabecera. Hay dos tests que fijan las cifras exactas
   (80 000/50 000 con el pago anulado en medio, 50 000/50 000 con el pago vigente).

7. **Coste añadido del filtro por cierre: una consulta.** Filtrar el desglose por un cierre pasa
   de 2 consultas a 3 (la lectura de los ids de pago, 0-3 filas por el índice `cierre_id`). **Sin
   filtro por cierre no se consulta nada nuevo**, y hay un test que lo afirma (`liquidacionPago`
   con cero llamadas): el desglose sin filtrar no paga ese peaje.

8. **`buildFiltrosWhere` deja de ser función de módulo y pasa a método `async` privado.** Necesita
   el cliente Prisma para leer los ids de pago. Es un cambio de forma, no de alcance: los dos
   únicos llamadores están en la misma clase.

9. **Preview sigue sin verificar** (hueco de T A.0). No lo resuelve esta tanda; sigue pendiente
   **antes de mergear el PR**.

---

## TANDA D — Frontend: pagar a una tienda · **COMPLETA** (2026-08-02)

T D.1, T D.2 y T D.3 hechas. El código lo escribió el `frontend_dev`; **la verificación y las tres
pruebas por mutación las corrió el LEADER**, porque el agente murió tres veces seguidas por cortes
de stream de la API justo en la fase de verificación (no por fallos del trabajo: el árbol quedó
completo y coherente en las tres caídas).

### Archivos

**Nuevos**

| Archivo | Qué |
| --- | --- |
| `components/shared/liquidacion/RegistrarPagoDialog.tsx` | El formulario de pago, compartido con la Tanda E |
| `components/shared/liquidacion/clave-idempotencia.ts` | Acuña la clave (uuid v4, `crypto.randomUUID` con fallback) |
| `components/shared/liquidacion/PagosRegistradosTabla.tsx` | Lista de comprobantes (`<DataTable>`, descarga Familia B) |
| `components/shared/liquidacion/pagos-registrados-descarga-columnas.ts` | Columnas de descarga |
| `components/shared/liquidacion/liquidacion-labels.ts` | Etiquetas de pantalla |
| `components/shared/monto-cliente.ts` | `montoValido` **promovido** desde `wallet-labels.ts` |
| `app/(app)/wallet/tiendas/_components/PagoTiendaAcciones.tsx` | El cableado y el refresco dirigido |
| `tests/fixtures/money-safe.ts` | Barrido reutilizable de `Number(`/`parseFloat` |
| 4 archivos de test | ver el mapa de abajo |

**Modificados:** `app/(app)/wallet/_components/wallet-labels.ts` (re-exporta lo promovido, para no
romper a sus consumidores), `SaldosTiendasTable.tsx` (recibe `acciones`, la prop que la 171 dejó
lista a propósito) y `app/(app)/wallet/tiendas/page.tsx`.

> **`monto-cliente.ts` se PROMUEVE, no se copia.** El comparador ya vivía en `wallet-labels.ts`
> (features 42/45/158) y con la 172 son cuatro las features que lo necesitan con la misma API, que
> es el umbral de `docs/architecture.md`. Compara montos como **texto** —longitud de la parte
> entera y luego lexicográfico—, nunca `Number`/`parseFloat`: un `DECIMAL(12,2)` de 11 dígitos no
> cabe exacto en un `number`, así que comparar en coma flotante podría aceptar justo el valor que
> se quiere rechazar. Una segunda copia habría sido una segunda oportunidad de equivocarse en
> dinero.

### Las tres pruebas por mutación — corridas por el leader, con su salida real

Las tres propiedades que decidían la tanda son justo las que un test ingenuo deja pasar en verde.

**1. La clave de idempotencia se CONSERVA tras un fallo** (mutación: renovarla en la rama de
error). Es el fallo que paga dos veces: la petición pudo escribirse aunque la respuesta se
perdiera.

```
MUTACION 1 aplicada: la clave se RENUEVA tras un fallo de red
     × REINTENTO tras un error de red: se manda LA MISMA clave 83ms
     × también conserva la clave si el diálogo se CIERRA y se vuelve a abrir tras fallar 119ms
 Tests  2 failed | 42 passed (44)
```

**2. La clave se RENUEVA tras un registro exitoso** (mutación: no cerrar la sesión al registrar).
Sin esto, dos pagos legítimos del mismo importe el mismo día se colapsarían en uno y el segundo
desaparecería en silencio (R45).

```
MUTACION 2 aplicada: la clave SOBREVIVE a un registro exitoso
     × tras un registro EXITOSO, la siguiente apertura manda una clave DISTINTA 102ms
     × R47: `ya_registrado` se trata como registrado — se informa y la clave se renueva 81ms
 Tests  2 failed | 42 passed (44)
```

> Las dos mutaciones son **direcciones opuestas del mismo eje** y hacen caer tests distintos. Es lo
> que demuestra que la propiedad está medida por los dos lados y no por casualidad: un test que
> solo mirase «hay una clave» pasaría las dos mutaciones.

**3. El refresco es DIRIGIDO, no global** (mutación: `mutate(() => true)`).

```
MUTACION 3 aplicada: refresco global en vez de dirigido
     × con dos desgloses abiertos, pagar en uno NO vuelve a consultar el otro
     × tampoco vuelve a leer la lista de comprobantes de la otra tienda 1234ms
     × no se recarga la página: la tabla de saldos no se vuelve a pedir por el pago 125ms
     × tras registrar, la lista de ESA tienda se vuelve a pedir 1123ms
 Tests  4 failed | 19 passed (23)
```

Los tres archivos se restauraron desde copia y el `diff` contra el respaldo quedó **idéntico**.

### R34 — la 171 sigue en pie sin tocarla

`wallet-tiendas-desglose.test.tsx` y `wallet-tiendas-page.test.tsx` pasan **verdes sin una sola
edición**: no aparecen entre los archivos modificados de la rama. Es la prueba de que la 172
**extiende** el contrato de la 171 en vez de cambiarlo.

### Money-safe (R14)

Barrido sobre los archivos nuevos de la tanda: las únicas apariciones de `Number(` y `parseFloat`
están **dentro de comentarios** que declaran justamente que no se usan. Cero en código.

### Mapa `R<n> → test`

| R | Test |
| --- | --- |
| R4 | `wallet-tiendas-pago.test.tsx` › «sin permiso NO se renderiza el control de pagar ni la lista de comprobantes» · «el permiso FALLA CERRADO» |
| R1 (2.ª mitad) | idem › «la otra mitad: la acción responde `forbidden` y la pantalla lo dice» · «las dos mitades leen el MISMO predicado que el servicio (`esAccesoTotal`)» |
| R14 | `RegistrarPagoDialog.test.tsx` › bloque «money-safe: el dinero es TEXTO de punta a punta» (incluye el monto máximo de la columna sin notación científica) · `PagosRegistradosTabla.test.tsx` › «el monto se pinta TAL CUAL» · `pagos-registrados-descarga-columnas.test.ts` › «emite el monto TAL CUAL» |
| R23 | `RegistrarPagoDialog.test.tsx` › «un monto MENOR se acepta y viaja tal cual: es el pago parcial» |
| R30 | idem › «prefija el monto con el disponible que devolvió el servidor, TAL CUAL» |
| R33 | `wallet-tiendas-pago.test.tsx` › bloque «el refresco es DIRIGIDO a la tienda que se pagó» (**mutación 3**) |
| R34 | suite de la 171 verde **sin editarla** |
| R43 | `RegistrarPagoDialog.test.tsx` › «se acuña AL ABRIRSE, una sola vez» · «REINTENTO tras un error de red: se manda LA MISMA clave» (**mutación 1**) |
| R47 | idem › «tras un registro EXITOSO, la siguiente apertura manda una clave DISTINTA» · «`ya_registrado` se trata como registrado» (**mutación 2**) |
| R49 | `PagosRegistradosTabla.test.tsx` › «pinta fecha real, monto, método, referencia, nota, quién e instante de registro» · `pagos-registrados-descarga-columnas.test.ts` › «declara sus columnas ENUMERADAS, en el orden de la pantalla» |
| R50 | `wallet-tiendas-pago.test.tsx` › «los comprobantes viven dentro del desglose de su tienda» |
| R51 | idem — el movimiento del pago se distingue por su concepto |
| R53 | idem — «pagado» sube y el saldo baja en el mismo monto |
| R56 | `PagosRegistradosTabla.test.tsx` › «el `id` del pago viaja en el DTO pero NO se pinta» · `pagos-registrados-descarga-columnas.test.ts` › «no expone NINGÚN identificador interno» + contraprueba del barrido |
| R74 | `PagosRegistradosTabla.test.tsx` › «conserva TODOS sus datos originales y suma la marca, el actor, el día y el motivo» · «el estado distingue de verdad los dos casos (no es una etiqueta fija)» |

> R74 se **muestra** aquí pero **no se ofrece anular**: hay un test que lo fija («esta tanda MUESTRA
> la anulación, pero no ofrece anular»), para que la Tanda F no descubra tarde que el control ya
> estaba a medias.

### Verificación (corrida por el leader)

| Comprobación | Resultado |
| --- | --- |
| `pnpm typecheck` | ✅ limpio |
| `pnpm lint` | ✅ 0 errores, 27 warnings preexistentes |
| Los 4 archivos nuevos + los 2 de la 171 | ✅ 6 archivos / 140 tests |
| `pnpm exec vitest run` completo | ✅ **786 archivos / 9652 tests / 0 fallos** |
| `./init.sh` | ✅ `== init OK ==` |

Delta contra el baseline de la Tanda C (782 / 9550): **+4 archivos, +102 tests, cero regresiones**.

> **La primera corrida del gate salió con 1 rojo y NO era contenido:** `CuentasPorPagarTable`, uno
> de los tres archivos del flake móvil de contención de jsdom de esta máquina. Se aplicó el
> protocolo en vez de creerse la etiqueta —**el archivo lo toca indirectamente la Tanda C, que
> cambió `agregarCuentaPorPagar`**, así que no bastaba con llamarlo flake—: verde **3/3 en
> aislado** y verde en la **corrida completa siguiente**. Además, lo único que la Tanda D toca de
> su árbol de imports es `wallet-labels.ts`, y su diff es una **mudanza pura** (se borra la función
> y se re-exporta la misma, promovida sin cambiarle una línea), así que no había cambio de
> comportamiento que pudiera alcanzarla.

---

## TANDA E — Frontend: pagar a un mensajero (toca la aprobación) · **COMPLETA** (2026-08-02)

T E.1, T E.2 y T E.3 hechas. Es la mitad delicada del frontend porque **modifica la aprobación
del cierre**, la transacción que desbloquea al mensajero (feature 111). La propiedad que decide
esta tanda no es «se puede pagar» —eso es fácil— sino **que pagar no pueda tumbar la aprobación**.

### Archivos

**Nuevos**

| Archivo | Qué |
| --- | --- |
| `app/(app)/cierres-admin/_components/pago-mensajero-labels.ts` | Textos (módulo puro, i18n-ready). Sin siglas ni jerga |
| `app/(app)/cierres-admin/_components/PendienteLiquidarBadge.tsx` | La marca de la deuda + `hayPendienteDeLiquidar` (type guard). La comparten la tabla y el detalle |
| `app/(app)/cierres-admin/_components/RegistrarPagoMensajeroDialog.tsx` | Cableado del pago: le pone el `cierreId` al formulario compartido y traduce la respuesta |
| `app/(app)/cierres-admin/_components/PagoMensajeroSeccion.tsx` | T E.2: sección «Pago al mensajero» del detalle + `clavePagosDeCierre` |
| `tests/components/CierresAdminPagoMensajero.test.tsx` | **37 casos** |

**Modificados**

| Archivo | Qué |
| --- | --- |
| `app/(app)/cierres-admin/_components/CierresAdminModule.tsx` | Prop opcional `puedeRegistrarPago`; oferta de pago tras aprobar; sección en el detalle |
| `app/(app)/cierres-admin/_components/CierresAdminHistoricoTabla.tsx` | Columna «Pendiente de liquidar» (T E.3) |
| `app/(app)/cierres-admin/page.tsx` | Pasa `puedeRegistrarPago={esAccesoTotal(actor.rol)}` |
| `components/shared/liquidacion/RegistrarPagoDialog.tsx` | **Una prop opcional**: `cancelLabel` (ver abajo) |
| `specs/172-liquidacion/tasks.md` | T E.1–T E.3 marcadas `[x]` |

**CERO tests editados.** Ni los de la 158 (`CierresAdminIndemnizacion`), ni
`CierresAdminModule.test.tsx`, ni los de la Tanda D. Es la condición de «Hecho» de las tres tasks
y se cumple literalmente: R26 se mide en el archivo nuevo, no ampliando el de la 38.

### El único cambio al código compartido de la Tanda D — aprobado por el leader

`RegistrarPagoDialog` gana **`cancelLabel?: string`**, con default `REGISTRAR_PAGO_TEXTO.cancelar`
(«Cancelar»): aditivo puro, sin cambio de comportamiento para la Tanda D. Existe porque hay UN
caso en el que ese botón no significa «cancelar»: el diálogo que se ofrece **justo después de
aprobar**. Ahí no hay nada que cancelar —el cierre YA está aprobado y el mensajero libre— y
llamarlo «Cancelar» insinuaría que se está deshaciendo la aprobación, que es exactamente la
lectura que R17/R18 existen para impedir. Hay dos tests que fijan las **dos** direcciones: tras
aprobar el botón dice «Ahora no» y **no** existe «Cancelar»; pagando desde el detalle, al revés.
`RegistrarPagoDialog.test.tsx` (44 casos) pasa **verde sin editarlo**: el default es lo que lo
garantiza.

### Las tres propiedades que decidían la tanda

**1. «Ahora no» deja el cierre APROBADO y no llama a ninguna acción de pago.** El bloque de la
oferta no tiene una sola ruta que toque el cierre: cerrar descarta estado local de pantalla y ya.
El test lo afirma por ausencia — `registrarPagoMensajeroAction` sin llamadas, `aprobarCierre` una
sola vez, `rechazarCierre` y `forzarSolicitudVencido` cero.

**2. Si el pago FALLA, el cierre sigue aprobado y el mensaje lo dice.** Los tres caminos de fallo
—red (throw), rechazo de dominio (`excede`) y `forbidden`— avisan con un texto que **empieza** por
lo que sí quedó hecho: «El cierre quedó aprobado. El pago no se registró: podés registrarlo
después desde el detalle del cierre». El aviso se emite **y el error se relanza**, para que el
diálogo compartido conserve la clave de idempotencia y el reintento no cobre dos veces (R43).

**3. `adminSatelite` aprueba sin que aparezca el diálogo.** El permiso se resuelve **solo
server-side**, con el MISMO predicado (`esAccesoTotal`) que `LiquidacionService` usa para
responder `forbidden`. La prop es **opcional con default `false`**: falla cerrado, y un montaje
que se olvide de pasarla no ofrece pagar a nadie en vez de ofrecérselo a todos. Además de aprobar
sin oferta, su detalle **no monta la sección** y **no pide la lista de comprobantes** — con
contraprueba de que el gate discrimina (el mismo cierre CON permiso sí la ofrece).

### PRUEBAS POR MUTACIÓN — cinco, con su salida real

Un test de UI que pasa con el guard quitado no prueba nada. Se mutó el código cinco veces y se
comprobó qué cae. Tras cada una se restauró desde copia y los 37 volvieron a verde.

```
MUTACION A: la oferta ignora el permiso de pagar
     × aprueba con pendiente > 0 y NO le aparece el diálogo de pago
 Tests  1 failed | 36 passed (37)

MUTACION B: la oferta se abre con pendiente 0
     × aprueba y termina, como antes de la 172
 Tests  1 failed | 36 passed (37)

MUTACION C: un pago fallido NO dice que el cierre sigue aprobado
     × un fallo de red no toca la aprobación y el aviso empieza por lo que SÍ quedó hecho
     × un rechazo del DOMINIO (`excede`) tampoco revierte nada, y también se avisa
     × un `forbidden` del servidor deja igual el cierre: aprobado y con la deuda abierta
 Tests  3 failed | 34 passed (37)

MUTACION D: un cierre liquidado se sigue señalando con su importe
     × no ofrece registrar, y lo dice con TEXTO en vez de con un hueco
     × los TRES casos se distinguen entre sí (no es una etiqueta fija)
 Tests  2 failed | 35 passed (37)

MUTACION E: la sección de pago aparece en cualquier estado del cierre
     × estado `solicitado` → sección visible: false
     × estado `vencido` → sección visible: false
     × estado `rechazado` → sección visible: false
 Tests  3 failed | 34 passed (37)
```

A y B son el par que importa en el gate de la oferta: son las **dos** condiciones del mismo `if`
y hacen caer tests distintos, así que ninguna está pasando por casualidad gracias a la otra.

### R26 — el pendiente se PINTA, no se calcula

El valor viene del servidor (`pendientePagoMensajero`, T C.2) y se muestra carácter por carácter:
`"1234.50"` → `₡1234.50`, `"0.10"` → `₡0.10`. La única lectura que se hace del monto es «¿es mayor
que cero?», y la hace `montoValido` comparando **texto**. Barrido money-safe sobre los **6**
archivos de la tanda (los 4 nuevos + los 2 modificados): cero `Number(`, `parseFloat(`,
`parseInt(` y `.toFixed(` en código —las únicas apariciones están dentro de comentarios que
declaran justamente que no se usan—, con **contraprueba** de que el barrido detecta una
conversión colada. En el test tampoco hay ninguna.

Los **tres** estados se distinguen y el test lo mide **en la celda**, localizada por el rótulo de
su columna (no por un índice escrito a mano): importe / «Liquidado» / «—». Que sean tres y no dos
es deliberado: «no debe nada» (aprobado y liquidado, R27) y «todavía no aplica» (no aprobado, R28)
no son lo mismo, y pintarlos igual haría que un cierre pagado pasara por uno sin aprobar.

### Mapa `R<n> → test`

Todos en `tests/components/CierresAdminPagoMensajero.test.tsx`.

| R | Test | Qué afirma |
| --- | --- | --- |
| R6 | «aprueba con pendiente > 0 y NO le aparece el diálogo de pago» (**mutación A**) | el `adminSatelite` aprueba con éxito y refresco, y la oferta no existe para él |
| R6 | «tampoco ve la sección … en el detalle de un cierre aprobado» + «CONTRAPRUEBA: el mismo cierre CON permiso sí ofrece pagar» | el gate discrimina; sin permiso ni siquiera se pide la lista de comprobantes |
| R16 | «abre el mismo diálogo compartido, prefijado con el pendiente del SERVIDOR» | monto prefijado `50000.00` y disponible `₡50000.00`, y el cierre ya aprobado antes |
| R16 | «el pendiente que prefija el formulario sale de la RESPUESTA de aprobar, no de la fila» | la fila trae `null`; si se leyera de ahí no habría nada que pagar |
| R16 | «registrar el pago manda el `cierreId` y el monto TAL CUAL» | payload con `cierreId`, monto STRING, fecha de hoy CR y clave uuid |
| R17 | «cierra el diálogo sin llamar a ninguna acción de pago» | **«Ahora no»**: cero pagos, cierre aprobado, ninguna otra decisión, ningún error |
| R17 | «el botón se llama «Ahora no» y NO «Cancelar»» | el matiz que impide leer el botón como «deshacer la aprobación» |
| R17 | los 3 casos de fallo (**mutación C**) | red, `excede` y `forbidden`: el cierre sigue aprobado, el mensaje lo dice y el formulario queda abierto para reintentar |
| R18 | «el payload de aprobar es el MISMO de la 38» | `{ cierreId }` y ni una clave más: el contrato de la 38/158 no cambia |
| R18 | «el éxito … se declara y la ruta se refresca ANTES de saber si se paga» | con el diálogo abierto y sin pagar, la aprobación ya está declarada |
| R18 | «declinar … no deja rastro: el cierre no vuelve a decidirse» | «Ahora no» no es un estado |
| R19 | «muestra la sección con el pendiente y el botón» · «el botón abre el diálogo y registrar manda el `cierreId` de ESE cierre» | el segundo camino del pago, desde el histórico |
| R19 | «tras registrar, el pendiente se vuelve a LEER del servidor» | 2.ª llamada a `verCierreDetalle`; el cliente no resta |
| R26 | «un cierre aprobado CON deuda se distingue en la tabla» · «los TRES casos se distinguen entre sí» (**mutación D**) | columna + insignia, con el importe del servidor tal cual |
| R27 | «aprueba y termina, como antes de la 172» (**mutación B**) | pendiente 0 → no se abre el diálogo |
| R27 | «no ofrece registrar, y lo dice con TEXTO en vez de con un hueco» | sin botón, con motivo escrito e insignia «Liquidado» |
| R28 | «estado `%s` → sección visible: %s» (**mutación E**) | los **cuatro** estados; en los no aprobados no se muestra **ni se pide** nada |
| R28 | «la COLA no muestra pendiente» | la columna no existe donde nada puede estar aprobado |
| R49 | «se pide para ESE cierre y pinta fecha real, monto, método, referencia, nota, quién y cuándo» | los 7 datos del comprobante, en su fila |
| R49 | «pero los COMPROBANTES se siguen viendo» (pendiente 0) · «un fallo de la lectura se dice en la tabla» | la lista no desaparece al liquidar; un error no tumba la sección |
| R14 | bloque «money-safe» + contraprueba | 6 archivos barridos |

### Verificación ejecutada — **el gate completo queda para el LEADER**

Por indicación explícita del leader **no se corrió la suite completa** (las corridas largas están
tumbando a los agentes por cortes de stream de la API). Lo que sí se corrió:

```
$ pnpm typecheck
> tsc --noEmit
(sin salida: verde)

$ pnpm lint
✖ 27 problems (0 errors, 27 warnings)   # los 27 preexistentes del baseline, ninguno mío

$ pnpm exec vitest run  <8 archivos: el nuevo + CierresAdminModule + CierresAdminIndemnizacion
                         + RegistrarPagoDialog + PagosRegistradosTabla + 3 cierres-admin-*>
 Test Files  8 passed (8)
      Tests  261 passed (261)

$ pnpm exec vitest run  <7 archivos: CierresDescarga + 3 de paginación + 3 guardias de descarga>
 Test Files  7 passed (7)
      Tests  38 passed (38)

$ pnpm exec vitest run  <cierres-admin-historico-paginado + cierres-admin-pendientes-paginado
                         + wallet-tiendas-pago (Tanda D)>
 Test Files  3 passed (3)
      Tests  40 passed (40)
```

**18 archivos / 339 tests / 0 fallos**, y ni uno editado. Se ampliaron a mano los dos vecinos que
la columna nueva podía romper aunque no estaban en la lista del leader —la **descarga** del
histórico y los tests de **paginación** de esta pantalla— más las tres **guardias** de
`tests/unit/descarga` (censo de tablas, contadores de cabecera y columnas sensibles), porque la
tanda monta una tabla más en `/cierres-admin`. **`./init.sh` y la suite completa: pendientes del
leader.**

### Hallazgos y desviaciones

1. **`puedeRegistrarPago` es OPCIONAL, y es deliberado.** Hacerla obligatoria habría roto el
   typecheck de cinco archivos de test ajenos (`CierresAdminModule`, `CierresAdminIndemnizacion`,
   `CierresDescarga` y los de paginación) que montan el módulo — exactamente los que las tres
   tasks exigen dejar intactos. El default es **`false`**, no `true`: un montaje que se olvide de
   pasarla no ofrece pagar a nadie. Falla cerrado.

2. **La columna de T E.3 va en el HISTÓRICO, no en la cola.** La cola son los cierres
   `solicitado`/`vencido`, donde el pendiente es `null` por contrato (R28): la columna estaría
   vacía en todas las filas, siempre. Los cierres aprobados —los únicos que pueden deber algo— se
   listan en el histórico. Hay un test que fija las dos mitades: la columna existe en el histórico
   y **no** existe en la cola.

3. **La insignia se muestra a TODOS los roles que ven la pantalla, incluido `adminSatelite`.**
   Solo se gatean las **acciones** (registrar) y la **lista de comprobantes**, que es lo que
   `design.md §7` acota. El pendiente ya viaja en el `CierreAdminResumen` que ese rol recibe, y §7
   dice que la deuda «queda abierta y **visible** para quien tiene la caja»: esconderle el número
   a quien aprueba no protege nada y le quita el motivo por el que hay que pagar.

4. **DESVIACIÓN de un bullet de T E.2: con pendiente 0 la sección SÍ aparece, sin botón.** El
   bullet dice «no aparece … con pendiente 0»; el criterio de «Hecho» dice «con pendiente 0 no hay
   botón». Se siguió el «Hecho», que es el criterio de record, porque el bullet esconde los
   comprobantes justo cuando existen: un cierre llega a 0 **porque se pagó**, y ocultar la sección
   dejaría sin ver el pago que lo liquidó (R49). Lo que R27 pide —«dejar de señalarlo como
   pendiente y no ofrecer registrar más pagos»— se cumple entero: insignia «Liquidado», sin botón
   y con el motivo escrito. Hay un test para cada mitad.

5. **Tras registrar desde el detalle se RELEE el detalle entero** (`verCierreDetalle`), en vez de
   descontar el monto en el cliente. Cuesta una consulta y es la única forma de que el pendiente
   siga siendo un dato del servidor (R14/R26). El test lo mide contando llamadas y comprobando que
   el botón desaparece cuando el servidor devuelve `0.00`.

6. **El censo de tablas (R57) NO se toca aquí.** La guardia recorre solo `app/`, y la instancia
   nueva de `<DataTable>` la aporta `PagosRegistradosTabla`, que vive en `components/shared/`
   (igual que en la Tanda D). La guardia pasa verde sin cambios; el recuento de las **dos**
   instancias es T H.1, tal como el spec lo asigna.

7. **La descarga del histórico no gana la columna nueva.** Añadirla habría cambiado el archivo que
   la 170 fijó (y sus tests, que no se pueden editar). El pendiente es un derivado que cambia con
   cada pago; el archivo del histórico documenta el cierre. Queda anotado por si alguien lo quiere
   en la Tanda H.

8. **Preview sigue sin verificar** (hueco de T A.0). No lo resuelve esta tanda; sigue pendiente
   **antes de mergear el PR**.

---

## TANDA F (backend) — Anular un pago · T F.1, T F.2, T F.3 y T F.4 · **COMPLETA** (2026-08-02)

> Tanda partida en dos: el **código de producción** de la anulación lo dejó escrito el agente
> anterior (murió por un corte de la API antes de sus tests) y esta entrega lo **cierra con la
> cobertura que faltaba**, sin reescribirlo. **T F.5 y T F.6 son de frontend y NO entran aquí.**
>
> Estado medido al empezar: `pnpm typecheck` verde y los 4 archivos de test de la 172 que ya
> existían en verde (183 tests).

### Archivos

**Nuevos**

| Archivo | Qué |
| --- | --- |
| `tests/unit/services/liquidacion-anulacion.test.ts` | **65 casos** de T F.2: R70 (el monto colado se ignora), R69, R71, R77, R81, R84/R85, R76, R82, R40, R39 |

**Modificados — tests**

| Archivo | Qué |
| --- | --- |
| `tests/integration/db/liquidacion-idempotencia.test.ts` | **26 → 39 casos.** El store gana `liquidacion_anulacion` con su `UNIQUE(pago_id)`, la relación `anulacion` en la fila del pago, `aggregate`/`findMany` de `liquidacionPago` y el reloj inyectable. Más la cadena de T F.3 (mensajero y tienda) |
| `specs/172-liquidacion/tasks.md` | T F.1–T F.4 marcadas `[x]` |

**Código de producción incluido en el commit** (escrito por el agente anterior, **no** reescrito):
`LiquidacionService.anularPago` + `restanteTrasAnular` / `escribirContraasiento` /
`beneficiarioDelPago` / `bloqueoDelBeneficiario` / `responderYaAnulado`,
`LiquidacionPagoRepository.anular`, `descripcionDeAnulacion`, la 5.ª Server Action, los dos
contratos y las ampliaciones ya hechas en `liquidacion-service.test.ts`,
`liquidacion-pago-repository.test.ts` y `liquidacion-action.test.ts`.

### Mapa `R<n> → test` de esta tanda

| R | Test | Qué afirma |
| --- | --- | --- |
| **R70** | `liquidacion-anulacion.test.ts` | **el criterio duro de la tanda, medido colando un `monto` en la petición**: con `999999.99` y con `0.01`, el contraasiento sigue valiendo lo que valía el pago, en los **dos** libros; la cifra colada no aparece en nada de lo que el servicio manda hacer ni en lo que devuelve. Más el barrido ESTRUCTURAL: `anularPago` lee **exactamente** `input.pagoId` e `input.motivo`, y el único origen del importe es `Decimal(pago.monto)`. El beneficiario también sale del pago |
| R69 | idem | mensajero → `devengo`/`ajuste_devengo`; tienda → `credito`/`ajuste_credito`; mismo monto, `origenTipo`/`origenId` **del pago**, un solo movimiento y **cero** en el otro libro; la descripción dice que es un reverso y **no** lleva el motivo ni ningún id; ni un `update`/`delete`/`upsert` sobre las cuatro tablas |
| R71 | idem | tienda: 100 000 − 15 000 → anular → **100 000,00** exacto; al céntimo con `0.01` sobre cifras que un float redondearía mal; un saldo **en contra** vuelve a su negativo previo (no se recorta a cero). Mensajero: el pendiente vuelve a 50 000,00; con otro pago vigente en medio solo vuelve lo suyo; nunca supera lo que el cierre genera |
| R76 | idem | la petición tiene **dos** campos y el repositorio recibe **tres**, ninguno un monto; un pago de `33333.33` se anula entero |
| **R77** | idem + `liquidacion-idempotencia.test.ts` | el reverso se fecha el **día de la anulación** (2026-08-05) y **no** el del pago (2026-07-30), en los dos libros; el día es el **calendario de Costa Rica** (23:00 CR del 5 sigue siendo el 5, no el 6 de UTC); a **medianoche UTC** (§2.4); dos anulaciones en días distintos se fechan distinto; y R78: la fecha real del pago no cambia |
| R81 | idem | los **4** roles sin acceso total → `forbidden` con el log **vacío**: el pago **ni siquiera se lee**. `adminSatelite` (que aprueba cierres) y `adminTienda` **de la tienda beneficiaria**, también. Contraprueba: `maestro`/`admin` sí pueden. R73: quién anula sale de la **sesión** |
| R82 | idem + integración | el segundo intento devuelve `ya_anulado` con la anulación de la **primera** vez, **un** solo contraasiento y **sin** restante; el INSERT se intenta las dos veces (barrera de datos, no `if`); el prototipo del servicio es una **lista cerrada de 11 métodos** y ninguno se llama desanular/revertir/deshacer; en el servicio no existe ninguna sentencia de borrado |
| **R84/R85** | idem + integración | **criterio duro medido, no declarado**: se **ejecuta** `registrarPagoMensajero`/`registrarPagoTienda` y se compara el objetivo del candado con el que toma la anulación — son idénticos. El objetivo se deriva del **pago leído**. Exactamente **una** adquisición, también en los caminos que no escriben. En integración, el `FOR UPDATE` es SQL **real** del repositorio: el log completo lo fija |
| R40 | idem | los 7 espías de `walletMovimiento` sin una sola llamada, en los **dos** caminos; y la contraprueba estructural (ni `IWalletMovimientoRepository`, ni `walletMovimiento`, ni `egreso_pago_tienda`, ni `reversarEgreso` en la fuente) |
| R39 | idem | las tres sentencias reciben **el mismo** `tx`; si el contraasiento falla no hay commit y el pago **sigue vigente** para quien lo relea (nunca marcado y descontado a la vez) |
| **R78** | `liquidacion-idempotencia.test.ts` (T F.3) | la fila del pago anulado queda **intacta** campo a campo (lo único que cambia es que le cuelga su anulación); el pago nuevo entra con **la misma referencia y la misma fecha real** |
| **R79** | idem | la cadena entera: pagar 20 000 → anular → pendiente **50 000,00** → registrar de nuevo con **clave nueva** → `ok`. Y en tienda: 100 000 → 85 000 → anular → 100 000 → volver a pagar → 85 000 |
| **R80** | idem | la suma de vigentes la calcula el **repositorio real** contra el store: `sumarVigentesPorCierre` pasa a `0.00` y `sumarVigentesPorTienda` de `40000.00` a `25000.00` en cuanto existe la fila de anulación — sin tocar el pago. Contracara (R74): la **lista** sigue trayendo el anulado, entero y marcado |
| R75 | idem | anular dos veces contra el `UNIQUE(pago_id)` del store: `ya_anulado`, **una** fila de anulación, **un** contraasiento, y el `choque-anulacion` en el log |

**El detalle que se pidió medir:** reutilizar la **clave del pago anulado** devuelve
`ya_registrado`, trae el comprobante **anulado** (no lo resucita) y deja **cero filas nuevas** —
la clave **no se libera al anular**. Está en los dos caminos (mensajero y tienda).

**Money-safe:** cero `Number(` y cero `parseFloat` en los dos archivos de test y en el servicio
(hay un test que lo afirma leyendo la fuente); todo monto viaja como STRING de escala 2.

### Verificación ejecutada

```
$ pnpm typecheck
> tsc --noEmit
(sin salida: verde)

$ pnpm run lint
✖ 27 problems (0 errors, 27 warnings)      # los 27 preexistentes del baseline, intactos
$ pnpm exec eslint tests/unit/services/liquidacion-anulacion.test.ts \
                   tests/integration/db/liquidacion-idempotencia.test.ts
(sin salida: limpio)

$ pnpm exec vitest run tests/integration/db
 Test Files  85 passed (85)
      Tests  1024 passed (1024)            # 1011 de la Tanda C + los 13 de T F.3

$ pnpm exec vitest run tests/unit/services/liquidacion-anulacion.test.ts \
                      tests/unit/services/liquidacion-service.test.ts \
                      tests/unit/repositories/liquidacion-pago-repository.test.ts \
                      tests/unit/actions/liquidacion-action.test.ts
 Test Files  4 passed (4)
      Tests  222 passed (222)              # 157 que ya existían en esos 3 + 65 nuevos
```

**Delta: +1 archivo, +78 tests** (65 de `liquidacion-anulacion` + 13 de la cadena de T F.3, que
lleva el archivo de integración de 26 a 39). **El gate completo (`./init.sh` y la suite entera)
es del LEADER**: aquí no se corrió.

### LAS PRUEBAS POR MUTACIÓN (obligatorias) — cuatro, con su salida real

Se mutó `lib/services/LiquidacionService.ts` (copia previa en el scratchpad), se corrieron los
**dos** archivos, y al final se restauró desde la copia con `diff` verde:
`IDENTICO: sin diferencias con la copia`.

**Mutación 1 — TOMAR EL MONTO DEL INPUT** (`Decimal((input as …).monto ?? pago.monto)`), que es
literalmente el agujero que R70 existe para cerrar:

```
 ❯ tests/unit/services/liquidacion-anulacion.test.ts (65 tests | 4 failed)
     × CRITERIO DURO: un monto ENORME colado en la peticion se IGNORA (tienda)
     × CRITERIO DURO: tambien un monto MINUSCULO colado se ignora (tienda)
     × CRITERIO DURO: lo mismo en el libro del MENSAJERO (es codigo distinto)
     × ESTRUCTURAL: `anularPago` solo lee DOS campos de la peticion, y ninguno es un monto

AssertionError: expected '999999.99' to be '15000.00' // Object.is equality
AssertionError: expected '0.01' to be '15000.00'      // Object.is equality
AssertionError: expected '999999.99' to be '20000.00' // Object.is equality

 Test Files  1 failed | 1 passed (2)
      Tests  4 failed | 100 passed (104)
```

**Mutación 2 — FECHAR EL CONTRAASIENTO EL DÍA DEL PAGO**
(`medianocheUtcDelDia(pago.fechaPago)`), la que reescribiría saldos históricos ya mirados:

```
 ❯ tests/unit/services/liquidacion-anulacion.test.ts (65 tests | 4 failed)
     × TIENDA: el pago es del 30 de julio y el reverso se fecha el 5 de agosto
     × MENSAJERO: mismo criterio en el otro libro
     × el dia es el CALENDARIO DE COSTA RICA, no el de UTC (las 23:00 de CR siguen siendo hoy)
     × el reloj es una DEPENDENCIA: dos anulaciones en dias distintos se fechan distinto
 ❯ tests/integration/db/liquidacion-idempotencia.test.ts (39 tests | 2 failed)
     × R77: el contraasiento se fecha el dia de la ANULACION, no el del pago
     × LA CADENA: el saldo vuelve a 100 000 y el pago nuevo entra con la misma referencia

AssertionError: expected '2026-07-30T00:00:00.000Z' to be '2026-08-05T00:00:00.000Z'
      Tests  6 failed | 98 passed (104)
```

**Mutación 3a — BLOQUEAR OTRA COSA** (la fila `usuario` del mensajero en vez de la del cierre,
que es el error plausible: «total, es su mensajero»):

```
 ❯ tests/unit/services/liquidacion-anulacion.test.ts (65 tests | 3 failed)
     × CRITERIO DURO (mensajero): el objetivo es identico al que toma `registrarPagoMensajero`
     × el objetivo se deriva del PAGO leido: otro cierre en la fila, otro candado
     × R84/R83: el candado va ANTES de leer el pendiente del cierre (mensajero)
 ❯ tests/integration/db/liquidacion-idempotencia.test.ts (39 tests | 2 failed)
     × R84/R83: la anulacion toma el candado del CIERRE y lee el pendiente DESPUES
     × R84 [P1]: una anulacion y un registro simultaneos NO leen el mismo disponible

-   "candado:cierre_dia:c1"        +   "candado:usuario:m1"
-   "candado-tomado:cierre_dia:c1" +   "candado-tomado:usuario:m1"
AssertionError: expected 8 to be greater than 11   # la 2.ª lectura YA NO espera al commit
      Tests  5 failed | 99 passed (104)
```

Lo que cae en el segundo archivo es lo que importa: con el candado en la fila equivocada, **la
anulación y un registro simultáneos vuelven a leer el mismo disponible**, que es exactamente lo
que R84 existe para impedir.

**Mutación 3b — NO BLOQUEAR NADA** (se quita la línea del candado):

```
 ❯ tests/unit/services/liquidacion-anulacion.test.ts (65 tests | 10 failed)
     × el disponible se lee BAJO el candado y DESPUES de tomarlo (R83)
     × CRITERIO DURO (mensajero) / CRITERIO DURO (tienda): el objetivo es identico al del pago
     × el objetivo se deriva del PAGO leido: otro cierre en la fila, otro candado
     × R85: UNA sola adquisicion por operacion (tienda) / (mensajero)
     × R85: tambien los caminos que NO escriben toman uno y solo uno
     × R84/R83: el candado va ANTES de leer el pendiente del cierre (mensajero)
     × el segundo intento INTENTA insertar: la barrera es la restriccion, no un `if` previo
     × las tres sentencias reciben EL MISMO `tx`, en una sola transaccion
 ❯ tests/integration/db/liquidacion-idempotencia.test.ts (39 tests | 2 failed)
      Tests  12 failed | 92 passed (104)
```

### Hallazgos

1. **Ningún defecto en el código de producción de la anulación.** Se escribieron los tests
   contra el comportamiento exigido por `requirements.md` y `design.md §6`, no contra lo que el
   código hace, y las cuatro mutaciones confirman que los tests miden de verdad. No hubo que
   tocar ni una línea de `lib/`.

2. **Anular NO exige que el cierre siga aprobado, y está probado a propósito.** La guardia de
   R20 es del **registro**: anular corrige un pago que ya ocurrió, y que el cierre haya cambiado
   de estado después no puede dejar ese pago sin reverso posible. Hay un test que recorre los
   tres estados no aprobados y espera `ok`. Si algún día se quisiera lo contrario, ese test es el
   sitio donde se decide.

3. **El store de integración ganó `aggregate` y `findMany` de `liquidacionPago`**, que antes no
   tenía. Son los que usan `sumarVigentesPorTienda` y `listarPorTienda`, y se añadieron con el
   mismo criterio del resto del store: **revientan** ante un `where` que no entienden, para que
   una mutación que use otra construcción falle en vez de pasar por «no casa nada».

4. **`buildService` del store acepta ahora un reloj opcional.** Los tests de registro no lo pasan
   y siguen exactamente igual (el default del servicio es `new Date()`); solo la anulación lo
   necesita, porque R77 pregunta por «hoy».

5. **T F.5 y T F.6 siguen abiertas** (frontend), y con ellas el default de N1. **Preview sigue
   sin verificar** (hueco de T A.0), pendiente antes de mergear el PR.

