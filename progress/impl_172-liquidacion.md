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


---

## TANDA F (frontend) — T F.5 y T F.6 · **COMPLETA** (2026-08-02) · TANDA F COMPLETA

> El frontend de la anulación. El backend (T F.1–T F.4) estaba entero y probado y **no se tocó
> ni una línea**: esta entrega solo lo enchufa a las dos pantallas y cierra N1 con su default.

### Archivos

**Nuevos**

| Archivo | Qué |
| --- | --- |
| `components/shared/liquidacion/AnularPagoDialog.tsx` | El diálogo de anulación, compartido por las dos pantallas. Molde: el sub-modal de rechazo de cierre (38/R11) |
| `tests/components/AnularPagoDialog.test.tsx` | **18 casos** |

**Modificados**

| Archivo | Qué |
| --- | --- |
| `components/shared/liquidacion/PagosRegistradosTabla.tsx` | Columna «Acciones» **opt-in** + el diálogo montado por fila |
| `components/shared/liquidacion/liquidacion-labels.ts` | `ANULAR_PAGO_TEXTO` / `_ERROR` / `_RESPUESTA`, el nombre accesible del control y la columna |
| `app/(app)/wallet/tiendas/_components/PagoTiendaAcciones.tsx` | Cableado de la anulación, refresco dirigido compartido con el pago, y **el aviso de N1** (T F.6) |
| `app/(app)/wallet/tiendas/_components/SaldosTiendasTable.tsx` | Pasa `puedeAnular` (una línea) |
| `app/(app)/cierres-admin/_components/PagoMensajeroSeccion.tsx` | Cableado de la anulación + relectura del pendiente |
| `app/(app)/cierres-admin/_components/pago-mensajero-labels.ts` | Los dos textos de la respuesta |
| `app/(app)/cierres-admin/_components/CierresAdminModule.tsx` | Pasa `puedeAnular` (una línea) |
| `tests/components/PagosRegistradosTabla.test.tsx` | 20 → **29 casos** |
| `tests/integration/wallet-tiendas-pago.test.tsx` | 23 → **32 casos** |
| `tests/components/CierresAdminPagoMensajero.test.tsx` | **una línea**: `anularPagoAction: vi.fn()` en el mock del módulo de acciones |
| `specs/172-liquidacion/tasks.md` | T F.5 y T F.6 marcadas `[x]` |

**Tests editados: dos, los dos declarados.** (1) En `PagosRegistradosTabla.test.tsx`, el caso
«esta tanda MUESTRA la anulación, pero no ofrece anular (eso es la Tanda F)» — su premisa deja
de ser cierta con esta task, que es el único motivo por el que se toca. Se reescribió para medir
lo que ahora vale: **sin permiso** no hay control, y el anulado sigue marcado. **Ninguna otra
aserción de ese archivo se tocó.** (2) En `CierresAdminPagoMensajero.test.tsx`, añadir el export
que faltaba en el mock: `PagoMensajeroSeccion` importa ahora `anularPagoAction` y, sin
declararlo, Vitest revienta al importar el módulo doblado. **Cero aserciones tocadas ahí.**

### T F.6 — el aviso de N1. **N1 QUEDA CERRADA POR SU DEFAULT.**

`requirements.md § N1` propone dos salidas —netear los brutos (dos valores de enum nuevos, con
la cascada de `down.sql` de este repo, o reescribir la derivación de la 171) o **no netear y
declarar la limitación en pantalla**— y deja la segunda como default. **Se aplica el default:
no se netea nada.** Ni `CUBETA_POR_CATEGORIA` ni el enum se tocan; lo que se añade es el aviso.

**Texto literal, tal y como se renderiza:**

> «Pagado a la tienda» sigue contando los pagos que se anularon, y «A favor de la tienda» suma
> la devolución de cada uno, así que esos dos importes quedan más altos de lo que se movió de
> verdad. «Saldo a favor» ya tiene todo eso descontado: ese es el número correcto.

Cuatro decisiones sobre ese párrafo:

1. **Se compone con los rótulos REALES de la cabecera** (`DESGLOSE_TIENDA_LABEL.pagado`,
   `.aFavor`, `.saldo`), no con copias escritas a mano: el día que alguien renombre un importe,
   el aviso lo sigue en vez de quedarse hablando de una cifra que ya no se llama así.
2. **Va donde se leen las cifras que afecta**: entra por el hueco `acciones`, que
   `DesgloseMovimientosTienda` renderiza **justo debajo de los cuatro importes**. Así el aviso
   queda junto a la cabecera **sin editar ese archivo** (R34 sigue en pie por no tocarlo).
3. **`role="note"`**, que es lo que un lector de pantalla anuncia como aclaración del contenido
   —y lo que permite localizarlo en el test sin depender de su texto exacto.
4. **Sin jerga.** Hay un test que barre el archivo y rechaza «contraasiento», «neteo»,
   «netear», «SLA» y «débito»: ese es vocabulario nuestro, no del maestro.

Lo que el aviso NO dice, a propósito: no menciona la categoría del movimiento ni el nombre de
la tabla. Quien lee esa pantalla decide cuánto pagar; lo único que necesita saber es que dos
cifras están infladas y cuál es la que manda.

### Mapa `R<n> → test` de estas dos tasks

| R | Test | Qué afirma |
| --- | --- | --- |
| **R4** | `wallet-tiendas-pago.test.tsx` › «sin permiso no hay control de anular (ni lista donde ponerlo)» | sin `puedeRegistrarPago` no se monta el bloque: no hay botón **y** no se pide la lista de comprobantes |
| **R4** | `PagosRegistradosTabla.test.tsx` › «FALLA CERRADO: sin declarar el permiso no hay ni columna ni botón» (**mutación 2**) | el default de `puedeAnular` es `false`; un montaje despistado no ofrece anular a nadie |
| **R4** | idem › «con permiso pero sin acción que llamar tampoco se ofrece el control» | las dos condiciones son independientes: permiso **y** acción |
| **R81** (2.ª mitad) | `wallet-tiendas-pago.test.tsx` › «la otra mitad: la acción responde `forbidden` y la pantalla lo dice» · `PagosRegistradosTabla.test.tsx` › «un rechazo del servidor deja el diálogo abierto y lo dice» | con el control A LA VISTA, el servidor niega y el aviso se pinta. Ocultar el botón no es control de acceso |
| **R81** (1.ª mitad) | `wallet-tiendas-pago.test.tsx` › «las dos mitades leen el MISMO predicado que el servicio (`esAccesoTotal`)» (de T D.3, sin editar) | quien no ve el control es exactamente quien recibiría la negativa: pagar y anular los deciden los mismos roles |
| **R72** | `AnularPagoDialog.test.tsx` › «nace con el confirmar deshabilitado…» · «un motivo de SOLO ESPACIOS tampoco lo habilita» · «**SEGUNDA BARRERA**: pulsar con el motivo en blanco no manda ninguna petición» (**mutaciones 4b y 4c**) | las **dos** barreras, medidas por separado; y `wallet-tiendas-pago.test.tsx` › «sin motivo no se envía nada» en la pantalla |
| R72 | `AnularPagoDialog.test.tsx` › «el campo se anuncia como obligatorio y su error se asocia al control» | `aria-required`, `aria-invalid` y el `aria-describedby` que apunta al `role="alert"` |
| **R74** | `PagosRegistradosTabla.test.tsx` › «con la misma lista y el mismo permiso, solo el vigente tiene botón» · `wallet-tiendas-pago.test.tsx` › «tras anular, el comprobante sigue entero y marcado en la lista» | el pago anulado conserva monto, método, quién y cuándo, **y además** el actor, el día y el motivo de la anulación. Anular no borra |
| **R82** | idem (**mutación 3**) | un pago ya anulado **no ofrece el control**: no se anula una anulación |
| R70/R76 | `AnularPagoDialog.test.tsx` › «la anulación se pide con UN solo dato: el motivo» · «no ofrece ningún campo de monto» · `wallet-tiendas-pago.test.tsx` › «manda el `pagoId` de esa fila y el motivo, sin ningún monto» | el payload tiene **dos** claves y ninguna es un importe; no hay entrada para una anulación parcial |
| **R33** | `wallet-tiendas-pago.test.tsx` › «R33: con dos desgloses abiertos, anular en uno NO vuelve a consultar el otro» (**mutación 1**) | el mismo refresco dirigido de T D.3: las **dos** claves de ESA tienda, ninguna de la otra, y la tabla de saldos sin recargar |
| **R71/R14** | idem › «el saldo que devuelve el servidor se pinta TAL CUAL, aunque sea NEGATIVO» | `restante: "-15000.00"` sale como `₡-15000.00`: no se recorta a cero, no se le quita el signo y no se recalcula nada |
| R75 | `AnularPagoDialog.test.tsx` › «`ya_anulado`: también cierra — el pago está como se quería» | el segundo intento deja el pago en el estado que se pedía y se avisa sin tratarlo como error |
| R14 | `AnularPagoDialog.test.tsx` › bloque money-safe (+ el monto máximo de la columna) y los barridos ya existentes sobre la tabla, el cableado de la tienda y los 6 archivos de la Tanda E | cero `Number(`, `parseFloat(`, `parseInt(` y `.toFixed(` en código |
| R56 | `PagosRegistradosTabla.test.tsx` › «el `id` del pago viaja en el DTO pero NO se pinta» (de T D.2, sin editar) | el `id` entra en el payload de la anulación y sigue sin aparecer en pantalla ni en el archivo |

### Verificación ejecutada — **el gate completo es del LEADER**

Por indicación explícita del leader **no se corrió la suite completa**.

```
$ pnpm typecheck
> tsc --noEmit
(sin salida: verde)

$ pnpm lint
✖ 27 problems (0 errors, 27 warnings)     # los 27 preexistentes del baseline, ninguno mío
$ pnpm exec eslint <los 8 archivos de código + los 4 de test>
(sin salida: limpio)

$ pnpm exec vitest run  tests/components/AnularPagoDialog.test.tsx
                        tests/components/PagosRegistradosTabla.test.tsx
                        tests/components/RegistrarPagoDialog.test.tsx
                        tests/integration/wallet-tiendas-pago.test.tsx
                        tests/components/CierresAdminPagoMensajero.test.tsx
                        tests/unit/descarga/pagos-registrados-descarga-columnas.test.ts
 Test Files  6 passed (6)
      Tests  175 passed (175)

$ pnpm exec vitest run  tests/integration/wallet-tiendas-desglose.test.tsx      # la 171
                        tests/integration/wallet-tiendas-page.test.tsx          # la 171
                        tests/components/CierresAdminModule.test.tsx            # la 38
                        tests/unit/descarga                                     # las guardias
 Test Files  15 passed (15)
      Tests  161 passed (161)
```

**Delta: +1 archivo, +36 tests** (18 del diálogo + 9 en la tabla + 9 en la pantalla de tiendas).
**R34 sigue en pie:** los dos archivos de la 171 pasan **sin editarlos**, aunque esta task toca
`SaldosTiendasTable`; y las tres guardias de `tests/unit/descarga` (censo, contadores y columnas
sensibles) siguen verdes **sin cambios**, porque la columna «Acciones» es de pantalla y **no**
entra en la descarga.

### LAS PRUEBAS POR MUTACIÓN — cuatro, con su salida real

Copia previa de los tres archivos de código en el scratchpad; al final se restauraron y el
`diff` quedó **idéntico** en los tres.

**Mutación 1 — REFRESCO GLOBAL en vez de dirigido** (`await mutate(() => true)`), la que la
Tanda D ya había cazado y que la anulación podía reintroducir por su cuenta:

```
 × con dos desgloses abiertos, pagar en uno NO vuelve a consultar el otro
 × tampoco vuelve a leer la lista de comprobantes de la otra tienda
 × no se recarga la página: la tabla de saldos no se vuelve a pedir por el pago
 × R33: con dos desgloses abiertos, anular en uno NO vuelve a consultar el otro
      Tests  4 failed | 28 passed (32)
```

El cuarto es el nuevo: pagar y anular comparten el mismo `refrescarEstaTienda`, y el test de la
anulación cae por sí solo.

**Mutación 2 — LA TABLA IGNORA EL PERMISO** (`const anular = onAnular`, sin mirar `puedeAnular`):

```
 × FALLA CERRADO: sin declarar el permiso no hay ni columna ni botón
      Tests  1 failed | 60 passed (61)
```

Cae uno, y es el que toca: en `/wallet/tiendas` el bloque **ni se monta** sin permiso, así que
esa pantalla no puede medir esta mitad — la mide el test del componente, que es donde vive el
default.

**Mutación 3 — SE OFRECE ANULAR UN PAGO YA ANULADO** (`false ? null : (<Button …>)`), que es
literalmente el agujero que R82 existe para cerrar:

```
 × con la misma lista y el mismo permiso, solo el vigente tiene botón
 × R74: tras anular, el comprobante sigue entero y marcado en la lista
      Tests  2 failed | 59 passed (61)
```

**Mutación 4 — el motivo, en DOS pasos, porque son DOS barreras.**

*4b — se quita SOLO el `confirmDisabled`* (el guard de `confirmar()` sigue vivo):

```
 × nace con el confirmar deshabilitado y el motivo en blanco
 × un motivo de SOLO ESPACIOS tampoco lo habilita: no es un motivo
      Tests  2 failed | 16 passed (18)
```

*4c — se quitan LAS DOS*:

```
 × nace con el confirmar deshabilitado y el motivo en blanco
 × un motivo de SOLO ESPACIOS tampoco lo habilita: no es un motivo
 × SEGUNDA BARRERA: pulsar con el motivo en blanco no manda ninguna petición
 × sin motivo no se envía nada (R72)                    <- el de la PANTALLA
      Tests  4 failed | 46 passed (50)
```

La diferencia entre 4b y 4c es el experimento: con la primera barrera fuera **no sale ninguna
petición igualmente**, y solo al quitar también el guard el motivo en blanco llega al servidor.
El test de la segunda barrera se separó del de la primera justo para poder medir esto; juntos
en un mismo `it` habrían caído los dos por el mismo motivo y el experimento no habría dicho
nada.

### Hallazgos y desviaciones

1. **La anulación se cablea TAMBIÉN en `/cierres-admin`, no solo en la tienda.** T F.5 nombra
   dos archivos de test, los dos de la tienda, pero el control vive en `PagosRegistradosTabla`,
   que está montada en las dos pantallas, y R74/R81 no distinguen beneficiario: un pago a un
   mensajero se puede teclear mal igual que uno a una tienda. Ahí el refresco dirigido son la
   lista de comprobantes de ESE cierre más la **relectura del detalle en el servidor** (el
   pendiente sube al anular, R71, y no se recalcula en el cliente).

2. **`puedeAnular` se pasa aunque el montaje ya esté gateado, y es deliberado.** En las dos
   pantallas el bloque solo se monta con permiso, así que la prop parece redundante. No lo es:
   el default de la tabla es `false`, y deducir el permiso de «alguien me montó» es exactamente
   la clase de suposición que deja de valer el día que otro consumidor la monte sin pensar. El
   permiso viaja como dato; la mutación 2 mide que se lee.

3. **El aviso de N1 solo lo ve quien puede pagar.** Entra por el hueco `acciones`, que
   `SaldosTiendasTable` solo rellena con permiso. En esa pantalla es indistinto —`page.tsx`
   hace `notFound()` para quien no tiene acceso total, así que no existe un visitante sin
   permiso—, pero queda escrito: si algún día la pantalla se abriera a otro rol, el aviso se
   quedaría fuera y habría que sacarlo del bloque de acciones (o pedirle a la 171 un hueco
   propio en la cabecera, que hoy no tiene y que no se le inventa aquí).

4. **La misma limitación existe en el libro del MENSAJERO y no se declara.** El par
   `liquidacion` + `ajuste_devengo` infla «total devengado» y «total pagado» de `/mis-pagos` con
   la misma mecánica. `design.md §6.4` y N1 hablan **solo** de la cabecera del desglose de la
   tienda, y T F.6 pide **ese** texto: se hace lo que dice el spec y se anota el vecino en vez
   de ampliarlo por cuenta propia. Decisión de una línea si se quiere cerrar en la Tanda G.

5. **El diálogo se MONTA por pago y se desmonta al cerrarse**, en vez de vivir siempre con un
   `pago` opcional. Es lo que garantiza que el motivo empiece en blanco en cada anulación: hay
   un test que abre uno, escribe medio motivo, cancela, abre el de OTRO pago y comprueba que el
   campo está vacío y que el resumen habla del segundo. Arrastrar el texto habría guardado, en
   el peor caso, una explicación que nadie escribió para ese pago.

6. **`ya_anulado` cierra el diálogo, no lo trata como error.** El estado final es el que se
   pedía (el pago está anulado) y se avisa con un toast informativo. La alternativa —dejar el
   diálogo abierto con un mensaje rojo— invitaría a reintentar algo que ya está hecho.

7. **La columna «Acciones» no entra en la descarga.** Un archivo no lleva botones: las columnas
   descargables siguen siendo las ocho de T D.2, y por eso las tres guardias de
   `tests/unit/descarga` pasan sin tocarse. El censo de tablas (R57) tampoco cambia: sigue
   siendo **una** `<DataTable>` en `components/shared/`, montada en dos sitios — eso lo cuenta
   T H.1.

8. **Preview sigue sin verificar** (hueco de T A.0), pendiente antes de mergear el PR.

---

## TANDA G — Lo que ven los beneficiarios · T G.1 y T G.2 · **COMPLETA** (2026-08-02)

> Las dos pantallas del otro lado del mostrador: el mensajero en `/mis-pagos` y la tienda en
> `/mi-wallet`. **El backend de la liquidación (Tandas A–F) no se tocó ni una línea.** Lo que sí
> se tocó —y por qué— está declarado abajo como desviación 1.

### Archivos

**Nuevos**

| Archivo | Qué |
| --- | --- |
| `tests/unit/services/mi-wallet-desglose.test.ts` | **7 casos.** El criterio duro de T G.2: la clasificación medida **por identidad**, más el barrido de que la pantalla no clasifica |

**Modificados**

| Archivo | Qué |
| --- | --- |
| `app/(app)/mi-wallet/_components/SaldoTiendaCard.tsx` | La cabecera pasa de 2 importes a **3** + el aviso de N1 |
| `app/(app)/mi-wallet/_components/mi-wallet-labels.ts` | `DESGLOSE_MI_WALLET_LABEL` y `DESGLOSE_MI_WALLET_AVISO` |
| `app/(app)/mi-wallet/_components/MiWalletModule.tsx` | Prop `desglose` + su estado, refrescado **con** el listado |
| `app/(app)/mi-wallet/page.tsx` | Pasa `desglose={movimientosResult.data.desglose}` |
| `app/(app)/mis-pagos/_components/CuentaPorPagarCard.tsx` | El aviso de N1 (decisión del leader, abajo) |
| `app/(app)/mis-pagos/_components/mis-pagos-labels.ts` | `CUENTA_AVISO_BRUTOS` |
| `lib/interfaces/services/IWalletTiendaService.ts` · `lib/services/WalletTiendaService.ts` | `listarMisMovimientos` devuelve también el `DesgloseTiendaDTO` (**desviación 1**) |
| 5 archivos de test | ver «hallazgo 2», abajo |
| `specs/172-liquidacion/tasks.md` | T G.1 y T G.2 marcadas `[x]` |

### T G.1 — el criterio se cumple LITERAL: **el test pasa sin tocar `/mis-pagos`**

Se escribió el bloque de R54 **primero**, con `app/(app)/mis-pagos/**` intacto, y salió verde:
**8 tests (5 de la 44 + 3 nuevos)** con el `git diff` de ese directorio **vacío**. R54 se
**verifica**, no se implementa, tal como anticipaba `design.md §10.3`: el libro ya se lista
entero y la etiqueta de `liquidacion` ya existía (`mis-pagos-labels.ts:27`).

El bloque monta la página REAL y, **con las props que ella produce**, el módulo REAL vía
`vi.importActual` (el resto del archivo lo tiene doblado). No basta con leer las props: lo que
R54 promete es que el mensajero **ve** el pago, y eso es una propiedad de lo pintado.

El escenario es el que exige la task, al céntimo:

| Libro sembrado | Devengado | Pagado | Cuenta por pagar |
| --- | --- | --- | --- |
| solo el cierre (`pago_devengado` 50 000) | 50 000,00 | 0,00 | **₡50000.00** |
| + el pago (`pago`/`liquidacion` 20 000) | 50 000,00 | 20 000,00 | **₡30000.00** ← baja |
| + su contraasiento (`devengo`/`ajuste_devengo` 20 000) | 70 000,00 | 20 000,00 | **₡50000.00** ← vuelve a subir |

**PRUEBAS POR MUTACIÓN — dos, con su salida real.** Un test que pasa con la pantalla rota no
prueba nada.

```
MUTACION 1: el desglose oculta los movimientos de tipo `pago`
     × con un movimiento `liquidacion` sembrado lo muestra CON SU ETIQUETA y su cuenta por pagar BAJA
     × con el CONTRAASIENTO sembrado, la cuenta por pagar vuelve a SUBIR y el reverso también se ve
     × los dos movimientos del pago se distinguen por su CONCEPTO, no por una etiqueta fija
 Tests  3 failed | 5 passed (8)

MUTACION 2: la tarjeta pinta `devengado` donde va la cuenta por pagar
     × con un movimiento `liquidacion` sembrado lo muestra CON SU ETIQUETA y su cuenta por pagar BAJA
     × con el CONTRAASIENTO sembrado, la cuenta por pagar vuelve a SUBIR y el reverso también se ve
 Tests  2 failed | 6 passed (8)
```

Restaurado desde copia: `git diff` de `app/(app)/mis-pagos` **vacío** y los 8 verdes otra vez.

### T G.2 — la tienda distingue el pago del cargo, y es **la misma función** que la del maestro

`/mi-wallet` mostraba «Créditos (COD)» y «Débitos». Desde la 172 el libro de la tienda tiene
movimientos `pago_tienda`, que son **débitos igual que un flete**: con esa cabecera, el dinero
que Ordenex le **entregó** aparecía sumado dentro de «Débitos». Con 50 000 recaudados, 1 200 de
flete y un pago de 20 000, la tienda leería «me cobraron 21 200». Ahora lee tres cifras: a tu
favor 50 000,00 · cargos de Ordenex 1 200,00 · ya pagado 20 000,00, y el saldo 28 800,00.

**El criterio duro, medido POR IDENTIDAD y no por parecido.** En
`tests/unit/services/mi-wallet-desglose.test.ts` se sustituye `derivarDesgloseTienda` por un
**espía que envuelve a la función real**. Solo hay una instancia en el registro de módulos, así
que si las dos superficies la llaman, el mismo espía acumula **las dos** llamadas — y con **el
mismo objeto de filas** (`toBe`, no `toEqual`: ninguna de las dos pre-filtra ni reagrupa antes
de clasificar, que sería otra forma de divergir sin duplicar la función).

Se complementa con un barrido estructural sobre los tres archivos de la cabecera: **ninguno
nombra una categoría del ledger en código** (los comentarios sí, y se descuentan) ni menciona
`CUBETA_POR_CATEGORIA`, con contraprueba de que el barrido detecta una categoría colada.

**PRUEBAS POR MUTACIÓN — tres, con su salida real.**

```
MUTACION A: «Cargos de Ordenex» vuelve a pintar el total de débitos (la cabecera vieja)
     × con un pago sembrado, «Ya pagado» lo muestra y «Cargos de Ordenex» NO lo incluye
     × los tres importes salen de la clasificación del servidor, no de una cuenta del cliente
 Tests  2 failed | 9 passed (11)

MUTACION B: `/mi-wallet` clasifica por su cuenta (DTO armado a mano desde credito/debito)
     × las dos superficies pasan por el MISMO `derivarDesgloseTienda` (identidad, no parecido)
     × sobre el MISMO libro, la tienda y el maestro leen importes idénticos
 Tests  2 failed | 16 passed (18)

MUTACION C: se quita el aviso de N1 de LAS DOS pantallas
     × nombra las dos cifras infladas y dice cuál es la correcta            <- /mis-pagos
     × el aviso habla en lenguaje claro: ni jerga contable ni siglas        <- /mis-pagos
     × hay UN solo aviso, y está junto a los importes agregados             <- /mis-pagos
     × declara que los importes brutos incluyen lo anulado                  <- /mi-wallet
     × el aviso habla en lenguaje claro: ni jerga contable ni siglas        <- /mi-wallet
 Tests  5 failed | 17 passed (22)
```

**Lo que la mutación B enseña, y hay que leerlo con cuidado:** el test de PANTALLA
(`mi-wallet-page.test.tsx`) **no cae** con esa mutación, porque allí la Server Action va doblada
y el fixture deriva el desglose con la función real. La divergencia servidor-adentro solo la
caza el test de servicio. Es exactamente el motivo por el que el criterio duro pedía medir
identidad y no coincidencia de cifras, y por el que ese archivo existe aparte.

Los tres archivos se restauraron desde copia y el `diff` quedó **idéntico** en los tres.

### LA ASIMETRÍA DE N1 — **RESUELTA: el aviso va TAMBIÉN en `/mis-pagos`. No hay asimetría.**

La Tanda F dejó abierto (hallazgo 4 de su bitácora) que la misma inflación de N1 existe en el
libro del mensajero y que el aviso solo se había puesto en el desglose de la tienda, porque eso
es lo único que nombran N1 y `design.md §6.4`.

**Regla aplicada (decisión del leader):** el aviso hace falta **donde se muestre un IMPORTE
AGREGADO que incluya lo anulado**; **no** hace falta donde solo se listen movimientos, porque
ahí el pago y su reverso se ven los dos y se explican solos.

Se miró qué muestra realmente cada pantalla, y esto es lo que hay:

| Pantalla | Qué muestra | ¿Agregado inflado? | Aviso |
| --- | --- | --- | --- |
| `/mis-pagos` — tarjeta «Cuenta por pagar» | **Devengado** (Σ tipo=`devengo`, incluye `ajuste_devengo`) y **Pagado** (Σ tipo=`pago`, incluye la `liquidacion` anulada) | **sí, los dos** | **SÍ, añadido** |
| `/mis-pagos` — tabla del desglose | una fila por movimiento | no | **no**, y es correcto |
| `/mi-wallet` — cabecera (T G.2) | **A tu favor** (incluye `ajuste_credito`) y **Ya pagado** (incluye el `pago_tienda` anulado) | **sí, los dos** | **SÍ, añadido** |
| `/mi-wallet` — tabla del ledger | una fila por movimiento | no | **no**, y es correcto |
| `/wallet/tiendas` — cabecera del desglose | los cuatro importes | sí | ya lo tenía (T F.6) |

La agregación del mensajero está **verificada en el código, no supuesta**:
`PagoMensajeroMovimientoRepository.agregarCuentaPorPagar` hace `groupBy(["tipo"])` **sin excluir
nada** (`:162-174`), así que `ajuste_devengo` engorda «Devengado» y la `liquidacion` anulada
sigue dentro de «Pagado». La resta —la cuenta por pagar— sale exacta. Es la misma mecánica que
en la tienda, con otros nombres.

**Conclusión: la asimetría que la Tanda F declaró queda CERRADA, no preservada.** Los dos avisos
usan el mismo lenguaje que el de T F.6, se componen con los rótulos **reales** de su tarjeta
(un renombrado los arrastra en vez de dejarlos hablando de una cifra que ya no existe), llevan
`role="note"` y hay un test por pantalla que **rechaza** «contraasiento», «neteo», «netear»,
«SLA» y los nombres de categoría. Nada de jerga en pantalla.

Texto literal en `/mis-pagos`:

> «Pagado» sigue contando los pagos que se anularon, y «Devengado» suma la devolución de cada
> uno, así que esos dos importes quedan más altos de lo que se movió de verdad. «Cuenta por
> pagar» ya tiene todo eso descontado: ese es el número correcto.

Texto literal en `/mi-wallet`:

> «Ya pagado» sigue contando los pagos que se anularon, y «A tu favor» suma la devolución de
> cada uno, así que esos dos importes quedan más altos de lo que se movió de verdad. «Saldo a
> favor» ya tiene todo eso descontado: ese es el número correcto.

**Lo que queda abierto y NO se amplió por cuenta propia:** por la misma regla,
`/wallet/mensajeros` (la vista del maestro: `CuentasPorPagarTable` y el desglose de un
mensajero) muestra los mismos dos agregados inflados y **no** lleva aviso. Está fuera de
T G.1/T G.2 —que nombran dos pantallas concretas— y ampliarlo aquí habría metido en la tanda
una tercera superficie con sus suites. **Decisión de una línea si se quiere cerrar en la
Tanda H**; queda escrito para que en la review no se lea como un olvido.

### Mapa `R<n> → test`

| R | Test | Qué afirma |
| --- | --- | --- |
| **R54** | `mis-pagos-page.test.tsx` › «con un movimiento `liquidacion` sembrado lo muestra CON SU ETIQUETA y su cuenta por pagar BAJA» (**mutaciones 1 y 2**) | la fila trae concepto «Liquidación», tipo «Pago», `₡20000.00` y el origen con la descripción del comprobante; la cuenta baja de `₡50000.00` a `₡30000.00` |
| **R54** | idem › «con el CONTRAASIENTO sembrado, la cuenta por pagar vuelve a SUBIR y el reverso también se ve» | vuelve **exactamente** a `₡50000.00`; el pago sigue a la vista (anular no borra) y «Ajuste (devengo)» aparece a su lado |
| R54 | idem › «los dos movimientos del pago se distinguen por su CONCEPTO, no por una etiqueta fija» | tres conceptos distintos en las tres filas; una etiqueta fija los pintaría iguales |
| **R55** | `mi-wallet-page.test.tsx` › «con un pago sembrado, «Ya pagado» lo muestra y «Cargos de Ordenex» NO lo incluye» (**mutación A**) | `₡20000.00` en «ya pagado», `₡1200.00` en «cargos» — y la contraprueba explícita de que **no** son `₡21200.00` |
| **R55** | idem › «la cabecera vieja ya NO existe: «Débitos» no es un rótulo de esta pantalla» | mientras existiera ese rótulo, el pago estaría contado dentro de él |
| R55 | idem › «sin pagos, «Ya pagado» sale en cero de verdad» | un cero leído de la categoría real, no un importe escondido |
| **R55** | idem › «los tres importes salen de la clasificación del servidor, no de una cuenta del cliente» (**mutación A**) | el fixture se deriva con la función REAL y la pantalla pinta esos STRING carácter por carácter; incluye un `ajuste_credito` (pago anulado) |
| **R55 (criterio duro)** | `mi-wallet-desglose.test.ts` › «las dos superficies pasan por el MISMO `derivarDesgloseTienda` (identidad, no parecido)» (**mutación B**) | **dos** llamadas al **mismo** espía, con el **mismo** objeto de filas (`toBe`) |
| R55 | idem › «sobre el MISMO libro, la tienda y el maestro leen importes idénticos» (**mutación B**) | `toEqual` entre las dos cabeceras + los valores exactos |
| R55 | idem › «la tienda pide su desglose con SU tienda_id y los MISMOS filtros que su listado (R22)» | el acotado sale del ACTOR; la cabecera y la tabla hablan del mismo conjunto |
| R55 | idem › «un rol que no es la tienda no llega ni a clasificar» | el guard va antes del repositorio: cero llamadas y cero clasificaciones |
| R55 | idem › «ningún archivo de la cabecera decide en qué importe cae una categoría» + contraprueba | barrido sobre los 3 archivos de `/mi-wallet`: ni una categoría del ledger en código, ni `CUBETA_POR_CATEGORIA` |
| R55 | idem › «los tres importes de la cabecera son EXHAUSTIVOS sobre el ledger» | las 10 categorías del SEED caen en exactamente esas tres cubetas |
| N1 | `mis-pagos-page.test.tsx` › «nombra las dos cifras infladas y dice cuál es la correcta» (**mutación C**) | con un pago anulado: devengado `₡70000.00`, pagado `₡20000.00`, cuenta por pagar `₡50000.00` exacta, y el aviso las nombra |
| N1 | idem › «hay UN solo aviso, y está junto a los importes agregados — no dentro de la tabla» | la asimetría *dentro* de la pantalla, afirmada: agregados sí, lista no |
| N1 | `mi-wallet-page.test.tsx` › «declara que los importes brutos incluyen lo anulado, y cuál es el número correcto» (**mutación C**) | a tu favor `₡70000.00`, ya pagado `₡20000.00`, saldo `₡48800.00` exacto |
| N1 | los dos › «el aviso habla en lenguaje claro: ni jerga contable ni siglas» | rechaza «contraasiento», «neteo», «netear», «SLA» y los nombres de categoría |
| R14 | barrido manual sobre los **11** archivos nuevos/modificados | cero `Number(`, `parseFloat`, `parseInt(` y `.toFixed(` en **código**; las 7 apariciones están dentro de comentarios que declaran justamente que no se usan |
| R34 | `wallet-tiendas-desglose.test.tsx` y `wallet-tiendas-page.test.tsx` verdes **sin editarlos** | siguen sin aparecer entre los modificados de la rama |

### Verificación ejecutada

```
$ pnpm typecheck
> tsc --noEmit
(sin salida: verde)

$ pnpm lint
✖ 27 problems (0 errors, 27 warnings)      # los 27 preexistentes del baseline, ninguno mío
$ pnpm exec eslint <los 8 de código + los 5 de test>
(sin salida: limpio)

$ pnpm exec vitest run  mis-pagos-page + mi-wallet-page + mi-wallet-desglose
                        + wallet-tiendas-desglose + wallet-tiendas-page + wallet-tiendas-pago
 Test Files  6 passed (6)
      Tests  99 passed (99)
```

Y, para medir el radio de la desviación 1 (un contrato de servicio que tocan la 43, la 170 y la
171), se corrieron **los tres directorios de la suite por separado** en vez de la corrida única:

```
$ pnpm exec vitest run tests/unit          489 archivos / 6428 tests / 0 fallos
$ pnpm exec vitest run tests/integration   152 archivos / 1682 tests / 0 fallos
$ pnpm exec vitest run tests/components    149 archivos / 1732 tests / 0 fallos (2.ª corrida)
```

**Total 790 archivos / 9842 tests.** Contra el baseline de la tanda (789 / 9823): **+1 archivo,
+19 tests, cero regresiones.** Los 19 son 6 en `mis-pagos-page` + 6 en `mi-wallet-page` + 7 en
el archivo nuevo. `./init.sh` y la corrida única siguen siendo del LEADER.

> La primera corrida de `tests/components` salió con **1 rojo que no era contenido**:
> `OrdenesModuleReuse`, uno de los tres archivos del flake móvil de contención de jsdom de esta
> máquina, y ajeno por completo a esta tanda (no comparte un solo import con ella). Verde en la
> corrida siguiente, 149/1732.

### Hallazgos y desviaciones

1. **DESVIACIÓN DECLARADA: T G.2 no se pudo hacer solo en la capa de presentación.** La cabecera
   de tres importes necesita la agregación **por (tipo, categoría)** del ledger, y esa lectura no
   estaba expuesta para la tienda: `verMiSaldoAction` devuelve Σ por **tipo**
   (créditos/débitos), que es justamente la partición que mete el pago dentro de «débitos». Se
   hizo el cambio **mínimo, aditivo y de solo lectura**: `listarMisMovimientos` añade una tercera
   lectura (`agregarDesglosePorTienda`, la que ya existe desde la 171) y devuelve el
   `DesgloseTiendaDTO`. Ni una escritura, ni un permiso nuevo, ni una consulta más en ningún otro
   camino, y **cero líneas del backend de la liquidación (Tandas A–F)**.
   Se eligió `listarMisMovimientos` y no `verMiSaldo` por dos razones: es la respuesta que ya
   refresca la pantalla al filtrar, así que la cabecera cumple R22 (los importes son los del
   conjunto filtrado) sin una cuarta lectura; y deja `verMiSaldo` intacta.
   **El campo es REQUERIDO a propósito.** Opcional habría evitado tocar tres dobles de test, y
   habría dejado que la cabecera se pintara con huecos el día que un consumidor se olvidara de
   emitirlo: un hueco en una pantalla de dinero se lee como «no hay nada», no como «no lo sé».
   `design.md §12` solo lista `app/(app)/mi-wallet/**` para P5 y no anticipa esta pieza — es un
   hueco del diseño, no una ampliación de alcance.

2. **Cinco archivos de test tocados, los cinco declarados, y NINGUNA aserción existente
   cambiada.** Cuatro son **añadidos de fixture** forzados por el punto 1
   (`mi-wallet-page.test.tsx`, `wallet-tienda-actions.test.ts`, `WalletDescarga.test.tsx`,
   `wallet-tienda-descarga.test.ts`) y uno es el export que faltaba en un doble
   (`mis-pagos-page.test.tsx`: `listarMisPagosCompletoAction`, que el módulo real importa). El de
   `wallet-tienda-descarga.test.ts` **no lo detectó el typecheck**: su repositorio en memoria se
   construye con `as unknown as IWalletTiendaMovimientoRepository`, así que el método nuevo
   faltaba en tiempo de ejecución y 3 tests de la 170 se pusieron rojos hasta añadirlo. Es el
   argumento vivo contra ese cast.

3. **`/mi-wallet` estrena etiquetas propias en vez de reexportar las del maestro, y es
   deliberado.** `DESGLOSE_TIENDA_LABEL` (171) habla de la tienda en tercera persona («A favor de
   la tienda», «Pagado a la tienda») porque la lee quien paga; esta pantalla la lee la tienda
   sobre su propio dinero y el resto de `/mi-wallet` ya le habla de vos. Lo que **no** se duplica
   —y es lo único que importa que no se duplique— es la **clasificación**, que vive una sola vez
   en el servidor y está medida por identidad. Nótese que la dependencia va en el sentido que ya
   existía: `desglose-tienda-labels.ts` (171) reexporta **de** `/mi-wallet`, no al revés.

4. **`saldo.creditos` y `saldo.debitos` dejan de pintarse en `/mi-wallet`, pero el DTO sigue
   viajando.** El número grande («Saldo a favor») se sigue leyendo de `saldo`, así que
   `verMiSaldoAction` no sobra ni queda ninguna prop muerta. Los dos campos siguen en el contrato
   de la 43 porque otros consumidores los usan; simplemente esta cabecera ya no los enseña, que
   es justo lo que R55 pedía.

5. **Un pago anulado deja la cabecera de la tienda en 70 000 «a tu favor» y 20 000 «ya pagado»
   con un saldo de 48 800.** No es un defecto nuevo: es N1 tal cual, y ahora está declarado en
   las tres pantallas que lo enseñan. Netearlo sigue exigiendo dos valores de enum nuevos o
   reescribir la derivación de la 171, y sigue estando fuera del alcance por su default.

6. **Preview sigue sin verificar** (hueco de T A.0), pendiente antes de mergear el PR.

---

## TANDA H — Guardias, censo y cierre · T H.1 a T H.5 · **COMPLETA** (2026-08-02) · **FEATURE COMPLETA**

> La tanda de cierre. No añade capacidad: cierra el censo, convierte en aserciones tres
> prohibiciones que hasta hoy solo estaban escritas, comprueba contra Postgres REAL que los
> constraints actúan, y consolida la trazabilidad de los 85 requisitos **diciendo dónde no
> llega**.
>
> **Baseline al inicio: 790 archivos / 9842 tests** (medido por la Tanda G en tres corridas por
> directorio). **El gate completo es del LEADER**: aquí no se corrió la suite entera.

### Archivos

**Nuevos**

| Archivo | Qué |
| --- | --- |
| `tests/unit/guards/liquidacion-money-safe.test.ts` | **7 casos.** El barrido TRANSVERSAL de T H.2 (money-safe + fuga de datos) sobre los 41 archivos de código de la feature |
| `tests/unit/guards/liquidacion-alcance.test.ts` | **3 casos.** Los no objetivos R66/R67/R68 de T H.4, medidos sobre el código en vez de «revisados en el diff» |
| `tests/components/WalletMensajerosAvisoBrutos.test.tsx` | **4 casos.** El aviso de N1 en `/wallet/mensajeros` (decisión 1 del leader) |

**Modificados**

| Archivo | Qué |
| --- | --- |
| `tests/unit/descarga/cobertura-tablas.guardia.test.ts` | T H.1: el recorrido pasa de `app/` a `app/` **+** `components/`; totales duros 29→31 archivos y 30→32 instancias; exclusiones 5→6 y censo total 31→33; **+1 test** (los montajes de una tabla compartida) |
| `tests/unit/descarga/censo-tablas.ts` | T H.1: campo `montajes?` en `TablaCensada` y las **dos** entradas del árbol `components/` |
| `app/(app)/wallet/mensajeros/_components/wallet-mensajeros-labels.ts` | T H.4: `avisoImportesBrutos(...)` + `CUENTAS_AVISO_BRUTOS` + `DESGLOSE_AVISO_BRUTOS` |
| `app/(app)/wallet/mensajeros/_components/CuentasPorPagarTable.tsx` | T H.4: el aviso sobre la tabla (una línea de JSX + su import) |
| `app/(app)/wallet/mensajeros/_components/DesglosePagosMensajero.tsx` | T H.4: el aviso bajo los tres importes (una línea de JSX + su import) |
| `specs/172-liquidacion/tasks.md` | T H.1–T H.5 marcadas `[x]` |

**CERO tests ajenos editados.** Ni la suite de la 111, ni la de analítica, ni
`CuentasPorPagarTable.test.tsx`, ni `wallet-mensajeros-page.test.tsx`, ni las de la 171 o la 38.
El aviso de N1 se mide en un archivo nuevo justamente por eso.

---

### T H.1 — Censo de tablas · el hallazgo era más grande de lo que parecía

**Lo que la Tanda E dejó anotado:** «la guardia recorre solo `app/` y la tabla vive en
`components/shared/`, así que pasa verde sin cambios». Es cierto, y **por eso mismo no valía**:
una guardia que no puede ver la tabla no la está vigilando. Con el recorrido viejo, R57 —«toda
tabla nueva DEBE quedar registrada en el censo, con su estado real»— se habría dado por cumplido
sin que nada lo sostuviera. Y registrarla a secas tampoco funcionaba: el registro se contrasta
contra el árbol en los **dos** sentidos, así que una entrada de un archivo que la guardia no
recorre falla por «registro caduco».

**La reparación:** el recorrido pasa a `["app", "components"]`. Al abrirlo aparecieron **dos**
instancias, no una:

| Instancia hallada | De quién es | Estado registrado |
| --- | --- | --- |
| `components/shared/liquidacion/PagosRegistradosTabla.tsx` | **172** | `con_descarga` |
| `components/private/analytics/TablaResumen.tsx` | **130 — PREEXISTENTE** | `fuera`, con motivo |

`TablaResumen` es un **hallazgo, no una tabla de esta feature**: existe desde la 130 y el censo
nunca la vio. Se registra `fuera` con el criterio **ya ratificado** para `ZonasModule` («el módulo
no está montado en ninguna página»): es un envoltorio del paquete de analítica sin un solo
consumidor en `app/`. **No se le cablea descarga**, porque eso sería tocar analítica y la 172 la
declara fuera de alcance (R68). Lo que sí queda cerrado es el punto ciego.

**«Las dos instancias nuevas» del enunciado eran, en el código, UNA.** `PagosRegistradosTabla` es
**un** `<DataTable>` montado en **dos** pantallas. Los totales cuentan instancias de código, así
que apuntar «2» habría sido un número falso; y contar «1» habría perdido la mitad que sí importa
—que la misma tabla se ve en dos sitios—. Se registran las dos cosas: el campo **`montajes`**
declara las pantallas una a una, y **un test nuevo** las contrasta contra el árbol en los dos
sentidos (ni un montaje sin declarar, ni un declarado que ya no exista). El detector exige
**importar Y renderizar**, para que ni un comentario cuente como montaje (`AnularPagoDialog` cita
la tabla en su cabecera) ni un re-export lo haga.

#### La guardia VISTA FALLAR, en dos etapas, ANTES de tocar los totales

**Etapa 1 — abrir el recorrido, sin registrar nada.** Salida real:

```
 ❯ tests/unit/descarga/cobertura-tablas.guardia.test.ts (3 tests | 1 failed)
     × toda tabla del árbol o declara descarga o figura como exclusión justificada

AssertionError: hay tablas sin registrar en tests/unit/descarga/censo-tablas.ts:
  expected [ …(2) ] to deeply equal []
+ [
+   "components/private/analytics/TablaResumen.tsx #1",
+   "components/shared/liquidacion/PagosRegistradosTabla.tsx #1",
+ ]
      Tests  1 failed | 2 passed (3)
```

**Etapa 2 — registradas las dos, con los totales duros TODAVÍA en los números viejos.** Aquí es
donde se leen del código los números que hay que poner:

```
 ❯ tests/unit/descarga/cobertura-tablas.guardia.test.ts (3 tests | 3 failed)
     × toda tabla del árbol o declara descarga o figura como exclusión justificada
     × las tablas declaradas fuera de alcance no montan control de descarga
     × la FASE 1 del export queda cerrada: ninguna tabla del censo sigue pendiente

AssertionError: expected 31 to be 29     # archivos con <DataTable>
AssertionError: expected 6 to be 5       # instancias `fuera`
AssertionError: expected [ … ] to have a length of 25 but got 26   # `con_descarga`
      Tests  3 failed (3)
```

**Los totales salen de esos tres «recibido», no de ningún documento:** 29→**31** archivos,
30→**32** instancias, 25→**26** `con_descarga`, 6→**7** `fuera`, censo total 31→**33** (32
`<DataTable>` + 1 `<table>` cruda).

#### Prueba por mutación del test nuevo

Se borró **uno** de los dos montajes declarados:

```
 ❯ tests/unit/descarga/cobertura-tablas.guardia.test.ts (4 tests | 1 failed)
     × una tabla compartida declara TODAS las pantallas que la montan

AssertionError: components/shared/liquidacion/PagosRegistradosTabla.tsx ::
  Pagos registrados (comprobantes de liquidación): un solo montaje: expected 1 to be greater than 1
      Tests  1 failed | 3 passed (4)
```

Restaurado desde copia (`diff` limpio) y verde otra vez. **`tests/unit/descarga` entero: 12
archivos / 92 tests, 0 fallos.**

#### Lo que esta task NO arregló, y queda escrito

`tests/unit/descarga/contadores-cabecera.guardia.test.ts` **tiene el mismo punto ciego**
(`const ARBOL_UI = "app"`). No se toca aquí porque ninguna tabla de la 172 monta un contador
`({x.length})` y abrir ese recorrido es una decisión de la 170, no de esta feature. **Hueco
declarado, ajeno y sin consecuencia hoy.**

---

### T H.2 — Barrido transversal money-safe y de fuga de datos

Cada tanda barrió **sus** archivos. Este barre la feature ENTERA, y existe por otro motivo: un
barrido por tanda protege lo que esa tanda escribió, y basta con que la siguiente añada un
archivo para que nadie lo mire. El censo de los **41 archivos de código** (no de test) va
explícito en el test y se contrasta contra el disco, más una regla de cobertura que impide que
envejezca: **todo** archivo de `components/shared/liquidacion/**` y **todo** `lib/**/*iquidacion*`
tiene que estar en la lista o el test cae.

**Qué prohíbe, y dónde — la distinción importa:**

- `Number(`, `parseFloat(`, `parseInt(` → en **todos** los archivos. Un `DECIMAL(12,2)` de 11
  dígitos no cabe exacto en un `number`: convertirlo es perder céntimos en cualquier lado.
- `.toFixed(` → **solo en el cliente**. En `lib/**` es `Prisma.Decimal.toFixed(2)`, que es la
  serialización exacta a STRING de escala 2 —el formato en el que el dinero cruza la frontera— y
  prohibirla ahí no protegería nada: obligaría a escribirla de otra forma peor. **La contracara
  se afirma aparte:** en el servidor, **todo** `toFixed` de la feature lleva el `2`.
- **Aritmética de montos en el navegador**, que el barrido de llamadas no ve: ningún archivo de
  cliente importa `@prisma/client` ni `decimal.js` ni construye un `Decimal`. Sin biblioteca de
  decimales y sin conversión a número, en el cliente solo queda **pintar**.

**Estado medido: cero `Number(`, cero `parseFloat(`, cero `parseInt(` en los 41 archivos.** Las
13 apariciones de `.toFixed(` están todas en `lib/**` y todas son `.toFixed(2)` sobre un
`Prisma.Decimal`.

#### LA DEMOSTRACIÓN QUE PIDE EL CRITERIO — tres mutaciones sobre archivos REALES

**Mutación 1 — se cuela un `Number(monto)` en un archivo real de cliente** (`const TOTAL_MAL =
(monto: string) => Number(monto) * 2;` en `PagosRegistradosTabla.tsx`):

```
 ❯ tests/unit/guards/liquidacion-money-safe.test.ts (7 tests | 2 failed)
     × ningún archivo de la feature convierte un monto a número
     × CONTRAPRUEBA: el barrido caza un `Number(monto)` colado y no caza su cita

AssertionError: conversión de dinero a número en la feature 172: expected [ Array(1) ] to deeply equal []
+ [
+   "components/shared/liquidacion/PagosRegistradosTabla.tsx: Number(",
+ ]
      Tests  2 failed | 5 passed (7)
```

**Mutación 2 — un `.toFixed(` en el CLIENTE** (`PendienteLiquidarBadge.tsx`) y **mutación 3 — un
`.toFixed()` sin escala en `lib/`** (`pendiente-cierre.ts`), aplicadas a la vez para ver que caen
tests DISTINTOS:

```
 ❯ tests/unit/guards/liquidacion-money-safe.test.ts (7 tests | 2 failed)
     × ningún archivo de la feature convierte un monto a número
     × en el servidor, todo `toFixed` de la feature es de escala 2

+ [ "app/(app)/cierres-admin/_components/PendienteLiquidarBadge.tsx: .toFixed(" ]
+ [ "lib/utils/pendiente-cierre.ts: .toFixed()" ]
      Tests  2 failed | 5 passed (7)
```

Los tres archivos se restauraron desde copia; `git diff` de `app/`, `lib/` y `components/` quedó
**vacío** y los 7 tests volvieron a verde.

**Contraprueba PERMANENTE, dentro del test.** Las mutaciones de arriba viven en esta bitácora; la
propiedad «el barrido detecta de verdad» vive en el repo: un caso alimenta al detector con
`Number(monto)` y `parseFloat(saldo)` (los caza, 2) y con una **cita** dentro de un comentario
(no la caza, 0) —los docstrings de este árbol nombran a propósito lo prohibido, y un barrido
literal fallaría por citarlo—, y además inyecta la llamada en memoria sobre un archivo real y
comprueba que aparece donde antes no había nada.

**La otra mitad, R56 — fuga de datos.** Dos aserciones:

1. **Estructural sobre el módulo de tipos:** `PagoRegistradoDTO` declara **exactamente 9** campos
   y el único que es un identificador es `id`; `AnulacionDTO` no tiene ninguno. Añadir
   `mensajeroId` o `cierreId` al DTO —el error natural cuando una pantalla necesita «solo un id
   más»— rompe el test.
2. **Con VALORES, no con nombres:** se proyecta a fila de descarga un comprobante en el que `id`,
   `referencia`, `nota` y `motivo` son **cuatro uuids distintos**, y se comprueba que el `id`
   **no sobrevive**. Los otros tres sí salen —son texto que una persona escribió; si teclea ahí
   un uuid, es su dato—, y la lista de los que salen se afirma exacta, así que el día que el `id`
   se cuele en una columna la aserción cambia.

Lo que **no** mide este archivo y hay que saber dónde está: «el `id` no se **pinta**» lo mide
`tests/components/PagosRegistradosTabla.test.tsx`, y la lista negra de credenciales/URLs la mide
la guardia transversal de la 170 (`columnas-sensibles.guardia`), que descubre el módulo de la 172
sola, por convención de nombre.

---

### T H.3 — Los constraints ACTÚAN: verificación manual contra Postgres local

Los tests de migración de este repo son **estáticos** (regex sobre el SQL). Esto es lo único que
demuestra que la base **rechaza** de verdad. La Tanda A adelantó una parte; aquí se completa y se
deja la salida real, **y en este orden**: primero el round-trip, y las inserciones **después**,
para que lo que se prueba sea el esquema que dejó el segundo `up`.

Base: **`ordenex` @ `localhost:5432`** (`npx prisma migrate status` la nombra sin exponer
credencial).

#### 1) Round-trip `up` → `down` → `up`

```
########## 1. ESTADO INICIAL (UP aplicada) ##########
tablas nuevas: [ 'liquidacion_anulacion', 'liquidacion_pago' ]
CHECK tipo<->categoria en los libros: [ 'pago_mensajero_movimiento_tipo_categoria_check',
                                        'wallet_tienda_movimiento_tipo_categoria_check' ]
enums (nº de valores): metodo_pago_value: 3 · pago_mensajero_movimiento_categoria: 5 ·
                       wallet_tienda_movimiento_categoria: 10
filas de los libros: { wtm: '0', pmm: '0' }
_prisma_migrations: [ { migration_name: '20260802120000_liquidacion_pago', aplicada: true,
                        rolled_back_at: null } ]

########## 2. DOWN: pnpm run db:rollback ##########
Aplicando rollback: 20260802120000_liquidacion_pago
Script executed successfully.
Script executed successfully.
Rollback completado: 20260802120000_liquidacion_pago

########## 3. ESTADO TRAS EL DOWN ##########
tablas nuevas: []
CHECK tipo<->categoria en los libros: []
enums (nº de valores): 3 · 5 · 10                 <- INTACTOS (el down no toca tipos, R64)
filas de los libros: { wtm: '0', pmm: '0' }       <- ADITIVA: no se reescribió ninguna (R64)
_prisma_migrations: []

########## 4. migrate status TRAS EL DOWN ##########
105 migrations found in prisma/migrations
Following migration have not yet been applied:
20260802120000_liquidacion_pago

########## 5. UP otra vez: prisma migrate deploy ##########
Applying migration `20260802120000_liquidacion_pago`
All migrations have been successfully applied.

########## 6. ESTADO TRAS EL SEGUNDO UP ##########
tablas nuevas: [ 'liquidacion_anulacion', 'liquidacion_pago' ]
CHECK tipo<->categoria en los libros: [ los 2 ]
enums (nº de valores): los mismos 3 · 5 · 10
_prisma_migrations: [ aplicada: true, rolled_back_at: null ]

########## 7. migrate status FINAL ##########
Database schema is up to date!
```

#### 2) Las restricciones, leídas de la BASE (no del archivo)

```
liquidacion_pago_beneficiario_check   CHECK (((mensajero_id IS NULL) <> (tienda_id IS NULL)))
liquidacion_pago_cierre_check         CHECK (((mensajero_id IS NULL) = (cierre_id IS NULL)))
liquidacion_pago_monto_check          CHECK ((monto > (0)::numeric))
pago_mensajero_movimiento_tipo_categoria_check
  CHECK (((tipo = 'devengo' AND categoria = ANY (ARRAY['pago_devengado','ajuste_devengo']))
       OR (tipo = 'pago'    AND categoria = ANY (ARRAY['pago_efectivo','liquidacion','ajuste_pago']))))
wallet_tienda_movimiento_tipo_categoria_check
  CHECK (((tipo = 'credito' AND categoria = ANY (ARRAY['cod_recaudado','ajuste_credito']))
       OR (tipo = 'debito'  AND categoria = ANY (ARRAY['flete','flete_devolucion','comision_cod',
             'iva_flete','iva_flete_devolucion','iva_comision_cod','pago_tienda','ajuste_debito']))))

liquidacion_anulacion_pago_id_key        UNIQUE INDEX ON liquidacion_anulacion (pago_id)
liquidacion_pago_clave_idempotencia_key  UNIQUE INDEX ON liquidacion_pago (clave_idempotencia)

RLS: liquidacion_pago      relrowsecurity=true  policies=0
     liquidacion_anulacion relrowsecurity=true  policies=0        <- R63, medido en la base
```

#### 3) Los INSERT: qué rechaza y qué acepta

Cada intento bajo su propio `SAVEPOINT`, todo dentro de una transacción que termina en
`ROLLBACK`. Salida real:

```
[1]  wallet_tienda_movimiento: pago_tienda + CREDITO    -> RECHAZADO  23514  wallet_tienda_movimiento_tipo_categoria_check
[2]  CONTRAPRUEBA: pago_tienda + debito                 -> ACEPTADO
[3]  wallet_tienda_movimiento: cod_recaudado + DEBITO   -> RECHAZADO  23514  wallet_tienda_movimiento_tipo_categoria_check
[4]  wallet_tienda_movimiento: ajuste_credito + CREDITO -> ACEPTADO   (el contraasiento de la anulación)
[5]  pago_mensajero_movimiento: liquidacion + DEVENGO   -> RECHAZADO  23514  pago_mensajero_movimiento_tipo_categoria_check
[6]  CONTRAPRUEBA: liquidacion + PAGO                   -> ACEPTADO   (lo que la 172 emite)
[7]  pago_mensajero_movimiento: ajuste_devengo + PAGO   -> RECHAZADO  23514  pago_mensajero_movimiento_tipo_categoria_check
[8]  liquidacion_pago SIN beneficiario                  -> RECHAZADO  23514  liquidacion_pago_beneficiario_check
[9]  liquidacion_pago con los DOS beneficiarios         -> RECHAZADO  23514  liquidacion_pago_beneficiario_check
[10] liquidacion_pago a una TIENDA con cierre_id        -> RECHAZADO  23514  liquidacion_pago_cierre_check
[11] liquidacion_pago con monto 0                       -> RECHAZADO  23514  liquidacion_pago_monto_check
[12] liquidacion_pago VÁLIDO a una tienda               -> ACEPTADO
[13] liquidacion_anulacion #1 de ese pago               -> ACEPTADO
[14] liquidacion_anulacion #2 del MISMO pago            -> RECHAZADO  23505  liquidacion_anulacion_pago_id_key

     anulaciones de ese pago tras el doble intento: { n: 1 }
     el pago sigue INTACTO (anular no lo toca):
       { monto: '15000.00', metodo: 'SINPE', referencia: 'REF-TH3', fecha_pago: '2026-08-02' }

conteos DESPUÉS del ROLLBACK: { wtm: '0', pmm: '0', pagos: '0', anulaciones: '0' }
la base quedó como estaba: SÍ
```

**Las contrapruebas [2], [4] y [6] son la mitad que suele faltar**: sin ellas, un CHECK que
rechazara *todo* pasaría igual de bien. Y **[13]+[14] es R75 de punta a punta**: el segundo intento
lo para la base, queda **una** anulación y la fila del pago no cambia (R69/R41: anular añade,
nunca edita). **Ninguna fila quedó en la base**: los conteos de antes y después coinciden.

---

### T H.4 — Alcance: lo que NO se hizo, convertido en aserciones

Una revisión de diff caduca el día que se mergea. Los tres no objetivos pasan a
`tests/unit/guards/liquidacion-alcance.test.ts` (**3 casos**):

| R | Afirmación ejecutable |
| --- | --- |
| **R66** | la migración crea **exactamente** `["liquidacion_pago","liquidacion_anulacion"]` y nada más; **ni un** `ADD COLUMN`, `CREATE TYPE` ni `ALTER TYPE`; el SQL no nombra «corte», «periodo», «período» ni «ciclo»; y el schema no declara ningún modelo de corte/período por tienda |
| **R67** | `ESTADOS_CIERRE_BLOQUEANTES` se **lee de `OrdenRepository.ts`** y es exactamente `["solicitado","vencido","rechazado"]`, con `aprobado` **fuera**; y **ningún** archivo de la 172 nombra esa constante (no la lee, no la extiende, no la copia) |
| **R68 / R40 / R62** | ningún archivo de la feature nombra `IWalletMovimientoRepository`, `WalletMovimientoRepository`, `walletMovimiento`, `wallet_movimiento`, `egreso_pago_tienda`, `egreso_pago_mensajero`, `reversarEgreso` ni `WalletEgresoService`, y ninguno importa `@/lib/analytics`; el SQL (sin comentarios) no menciona la caja y las tablas que reciben el CHECK son **exactamente** los dos libros |

**Prueba por mutación — dos a la vez, para ver que caen tests distintos:**

```
MUTACIONES: `aprobado` pasa a bloquear (R67) + el servicio nombra `egreso_pago_tienda` (R68)

 ❯ tests/unit/guards/liquidacion-alcance.test.ts (3 tests | 2 failed)
     × R67: los estados que bloquean al mensajero siguen siendo exactamente los tres de la 111
     × R68 / R40 / R62: ni la caja principal ni el catálogo de métricas entran en la feature

AssertionError: expected [ 'solicitado', 'vencido', …(2) ] to deeply equal [ Array(3) ]
+   "aprobado",
AssertionError: lib/services/LiquidacionService.ts nombra egreso_pago_tienda
      Tests  2 failed | 1 passed (3)
```

Los dos archivos se restauraron desde copia (`diff` idéntico) y los 3 volvieron a verde.

> El SQL se barre **sin comentarios**: la migración EXPLICA por qué no toca la caja, y un
> `toContain` sobre el texto crudo confundiría la explicación con la sentencia. Es la misma
> trampa que el barrido money-safe evita quitando los comentarios antes de mirar.

#### Las suites que no se pueden editar, verdes SIN editarlas

Ninguna aparece en el diff de la rama (comprobado con `git diff --name-only`, no de memoria):

```
$ pnpm exec vitest run  <la 111: orden-repository.bloqueo + OrdenesListadoBloqueoCierre
                         + cierre-dia-repository + cierre-dia-service + cierre-dia-action
                         + mis-asignaciones-service>
 Test Files  6 passed (6)
      Tests  263 passed (263)

$ pnpm exec vitest run  tests/unit/analytics + los 4 analytics-* de unit/components
                        + los 4 Analytics*.test.tsx + los 2 analytics-daily de integration/db
 Test Files  33 passed (33)
      Tests  504 passed (504)

$ pnpm exec vitest run  CuentasPorPagarTable + wallet-mensajeros-page + tests/unit/descarga
                        + tests/components/descarga + tests/components/paginacion
 Test Files  30 passed (30)
      Tests  207 passed (207)
```

Los dos últimos grupos importan especialmente porque esta task **sí toca** `/wallet/mensajeros`
y el censo de descargas: las suites vecinas siguen verdes sin una sola edición.

#### DECISIÓN 1 DEL LEADER — `/wallet/mensajeros` y el aviso de N1. **APLICADO.**

La Tanda G dejó esta pantalla señalada como pendiente de la misma regla: **el aviso hace falta
donde se muestre un IMPORTE AGREGADO que incluya lo anulado; no donde solo se listen
movimientos.** Se miró qué muestra de verdad, en el código:

| Superficie | Qué pinta | ¿Agregado inflado? | Aviso |
| --- | --- | --- | --- |
| `CuentasPorPagarTable` — columnas | «Devengado» y «Pagado» **por mensajero** (Σ por tipo) + «Cuenta por pagar» | **sí, las dos primeras** | **SÍ, añadido** |
| `DesglosePagosMensajero` — cabecera | «Total devengado», «Total pagado», «Cuenta por pagar» | **sí, los dos primeros** | **SÍ, añadido** |
| `DesglosePagosMensajero` — tabla | una fila por movimiento | no | **no**, y es correcto |

**No es una tabla de movimientos:** cada fila de `CuentasPorPagarTable` es un **agregado por
mensajero**, así que no le aplica la exención de la regla. La inflación está verificada en el
código, no supuesta: `PagoMensajeroMovimientoRepository.agregarCuentaPorPagar` hace
`groupBy(["tipo"])` **sin excluir nada**, de modo que el `ajuste_devengo` del reverso engorda lo
devengado y la `liquidacion` anulada sigue dentro de lo pagado. **La resta —la cuenta por pagar—
sale exacta**, y eso es justo lo que el aviso dice.

**Por qué son DOS avisos y no uno:** cada uno se compone con los rótulos **reales de su
superficie**, que son distintos («Pagado» vs «Total pagado»). Un solo aviso hablaría de una cifra
con un nombre que en la otra tabla no existe. El texto lo genera **una** función
(`avisoImportesBrutos`), así que el lenguaje es literalmente el mismo que el de T F.6 / T G.2 y un
renombrado de columna lo arrastra en vez de dejarlo hablando de algo que ya no se llama así.

Texto en la tabla de cuentas:

> «Pagado» sigue contando los pagos que se anularon, y «Devengado» suma la devolución de cada
> uno, así que esos dos importes quedan más altos de lo que se movió de verdad. «Cuenta por
> pagar» ya tiene todo eso descontado: ese es el número correcto.

Texto en la cabecera del desglose: el mismo, con «Total pagado» y «Total devengado».

**Por qué `SaldosTiendasTable` NO lo lleva y esto no es una asimetría:** esa tabla pinta **solo el
saldo**, que es el número correcto. Donde la 171 sí enseña brutos —la cabecera del desglose— el
aviso está desde T F.6.

`tests/components/WalletMensajerosAvisoBrutos.test.tsx` (**4 casos**) lo mide: los rótulos exactos
en cada superficie, que el aviso **no** está dentro de ninguna `<table>`, que vive en la misma
región que los tres importes, y que no usa jerga («contraasiento», «neteo», «netear», «SLA», ni
nombres de categoría). **Mutación ejecutada** — se quitan los dos avisos:

```
 ❯ tests/components/WalletMensajerosAvisoBrutos.test.tsx (4 tests | 4 failed)
     × la TABLA de cuentas declara que «Devengado» y «Pagado» incluyen lo anulado
     × la CABECERA del desglose lleva el mismo aviso con SUS rótulos
     × el aviso va junto a los importes agregados, NUNCA dentro de la tabla de movimientos
     × los dos avisos hablan en lenguaje claro: ni jerga contable ni siglas

TestingLibraryElementError: Unable to find an accessible element with the role "note"
```

Restaurados desde copia, `diff` idéntico, los 4 verdes. **Con esto, N1 queda declarada en las
CUATRO pantallas que enseñan un agregado inflado** (`/wallet/tiendas`, `/mis-pagos`, `/mi-wallet`
y `/wallet/mensajeros`) y en ninguna que solo liste movimientos. **La asimetría que la Tanda F
abrió y la G acotó queda CERRADA.**

#### DECISIÓN 2 DEL LEADER — la descarga del histórico NO gana la columna «pendiente de liquidar»

La Tanda E lo propuso (hallazgo 7 de su bitácora). **El leader lo descarta, y es ALCANCE
DELIBERADO, no un olvido:** tocaría el archivo de columnas que fijó la 170 y sus tests, y
**ningún R lo pide**. R26 habla de mostrarlo «en el listado de cierres y en el detalle», que es
donde está (T E.3 y T E.2). Añadido de fondo: el pendiente es un derivado que cambia con cada
pago, mientras que el archivo del histórico documenta el cierre; meterlo dentro haría que dos
descargas del mismo día dijeran cosas distintas sin que el cierre hubiera cambiado.

---

### T H.5 — CIERRE

#### El mapa `R<n> → test` COMPLETO — los 85

Cada fila es un test que **existe, pasa y afirma el requisito**. Las excepciones van marcadas y
explicadas debajo de la tabla; **no hay ninguna escondida**.

| R | Test que lo mide | |
| --- | --- | --- |
| R1 | `unit/services/liquidacion-service.test.ts` — los 4 roles sin acceso total → `forbidden` con el log de llamadas VACÍO; + `integration/wallet-tiendas-pago.test.tsx` (2.ª mitad: la acción responde `forbidden`) | ✅ |
| R2 | `unit/services/liquidacion-service.test.ts` — `adminTienda` pidiendo SU PROPIA tienda → `forbidden` | ✅ |
| R3 | `unit/actions/liquidacion-action.test.ts` — sin sesión → `unauthenticated` sin llamar al servicio, en las **5** acciones, y **con la petición rota también** | ✅ |
| R4 | `integration/wallet-tiendas-pago.test.tsx` + `components/PagosRegistradosTabla.test.tsx` — sin permiso no hay control de pagar ni de anular (default `false`, falla cerrado) | ✅ |
| R5 | `unit/services/liquidacion-service.test.ts` — el rol se evalúa antes de mirar el beneficiario; el del mensajero sale del CIERRE, no de la petición | ✅ |
| R6 | `components/CierresAdminPagoMensajero.test.tsx` (mutación A) + `unit/services/liquidacion-service.test.ts` — `adminSatelite` aprueba sin oferta y recibe `forbidden` al llamar directo | ✅ |
| R7 | `unit/repositories/liquidacion-pago-repository.test.ts` — las **10** columnas exactas del `data` | ✅ |
| R8 | `unit/types/liquidacion-schemas.test.ts` — los 3 métodos del SEED; `tarjeta`/`sinpe`/`""` → error en `metodo` | ✅ |
| R9 | `unit/repositories/liquidacion-pago-repository.test.ts` — fecha real e instante conviven y difieren | ✅ |
| R10 | `unit/types/liquidacion-schemas.test.ts` — mañana rechazado; 20:00 CR sigue siendo hoy; día y mes inexistentes | ✅ |
| R11 | idem — 12 negativos (0, negativo, 3 decimales, coma, miles, 11 dígitos, científica…) + frontera exacta | ✅ |
| R12 | idem — SINPE/transferencia sin referencia → error en `referencia`; efectivo sin ella, válido | ✅ |
| R13 | idem — frontera exacta de `LIQUIDACION_NOTA_MAX`; un carácter más → error en `nota` | ✅ |
| R14 | `unit/guards/liquidacion-money-safe.test.ts` (**T H.2**, transversal) + `components/RegistrarPagoDialog.test.tsx` + `unit/actions/liquidacion-action.test.ts` (un `monto` numérico muere en el borde) | ✅ |
| R15 | `unit/types/liquidacion-schemas.test.ts` — 5 claves de adjunto rechazadas por `.strict()`, en los 3 schemas | ✅ |
| R16 | `components/CierresAdminPagoMensajero.test.tsx` — tras aprobar con pendiente > 0 se ofrece el pago, prefijado con el pendiente del SERVIDOR | ✅ |
| R17 | idem (mutación C) — «Ahora no» y los **3** caminos de fallo dejan el cierre aprobado, y el mensaje lo dice | ✅ |
| R18 | idem + `unit/services/cierres-admin-pendiente.test.ts` — el payload de aprobar es el MISMO de la 38; declinar no deja rastro | ✅ |
| R19 | `components/CierresAdminPagoMensajero.test.tsx` — el detalle de un cierre aprobado ofrece registrar en cualquier momento posterior | ✅ |
| R20 | `unit/services/liquidacion-service.test.ts` — `solicitado`/`vencido`/`rechazado` → `cierre_no_aprobado` sin escribir; la guardia se lee DENTRO de la transacción | ✅ |
| R21 | idem + `unit/actions/liquidacion-action.test.ts` — el documento sale con `cierreId`; sin cierre no pasa el borde. Reforzado por `liquidacion_pago_cierre_check` (T H.3 [10]) | ✅ |
| R22 | `unit/utils/pendiente-cierre.test.ts` + `unit/services/cierres-admin-pendiente.test.ts` — `min(P,E)` comparada con `calcularSplitPago`; exacta al céntimo | ✅ |
| R23 | `unit/services/liquidacion-service.test.ts` + `components/RegistrarPagoDialog.test.tsx` — parcial aceptado, prefijado y editable a la baja | ✅ |
| R24 | `unit/services/liquidacion-service.test.ts` — el pendiente baja EXACTAMENTE en el monto (50 000 − 10 000 − 15 000 = `"25000.00"`) | ✅ |
| R25 | idem — `50000.01` sobre 50 000 → `excede { disponible }` sin escribir; la frontera exacta sí entra | ✅ |
| R26 | **`components/CierresAdminPagoMensajero.test.tsx`** (mutación D) — columna + insignia, los TRES estados distinguibles; y el detalle | ⚠️ el spec apunta a otro archivo (abajo) |
| R27 | idem (mutación B) + `unit/services/cierres-admin-pendiente.test.ts` — `"0.00"` no es `null`; sin botón y con texto | ✅ |
| R28 | `unit/services/cierres-admin-pendiente.test.ts` + `components/CierresAdminPagoMensajero.test.tsx` (mutación E) — los 4 estados; en los no aprobados ni se muestra ni se pide | ✅ |
| R29 | `unit/services/liquidacion-service.test.ts` — pago a tienda sin cierre, contra el saldo acumulado sin filtros | ✅ |
| R30 | `components/RegistrarPagoDialog.test.tsx` — monto prefijado con el disponible TAL CUAL y editable a la baja | ✅ |
| R31 | `unit/services/liquidacion-service.test.ts` — `60000.01` sobre 60 000 → `excede` sin escribir | ✅ |
| R32 | idem — saldo `0.00` y saldo NEGATIVO → `sin_saldo`, sin escribir | ✅ |
| R33 | `integration/wallet-tiendas-pago.test.tsx` (mutación 3 de T D.3 y mutación 1 de T F.5) — refresco DIRIGIDO, al pagar y al anular | ✅ |
| R34 | `integration/wallet-tiendas-desglose.test.tsx` y `wallet-tiendas-page.test.tsx` (171) **verdes sin editarlos**; no aparecen en el diff de la rama | ✅ |
| R35 | `unit/services/liquidacion-service.test.ts` — `pago`/`liquidacion` en el libro del mensajero y CERO filas en el de la tienda | ✅ |
| R36 | idem — `debito`/`pago_tienda` por el monto registrado | ✅ |
| R37 | idem + `unit/repositories/libros-fecha-movimiento.test.ts` — medianoche UTC de la fecha REAL, no la de registro | ✅ |
| R38 | `unit/services/liquidacion-service.test.ts` — `origenTipo`/`origenId` apuntan al pago creado | ✅ |
| R39 | idem + `unit/services/liquidacion-anulacion.test.ts` — mismo `tx`; si el movimiento falla, no hay commit | ✅ |
| R40 | idem — 7 espías de `walletMovimiento` con CERO llamadas, al pagar y al anular; + contraprueba estructural, ahora también en `unit/guards/liquidacion-alcance.test.ts` | ✅ |
| R41 | idem — cero `update`/`delete`/`upsert` sobre el pago y los dos libros; confirmado en la base (T H.3: tras anular, la fila del pago está intacta) | ✅ |
| R42 | idem, **tres vías** (espías del `tx`, doble del repositorio, ausencia estructural); en integración `cierre_dia.update` LANZA | ✅ |
| R43 | `integration/db/liquidacion-idempotencia.test.ts` (mutación 1 de T B.6) — misma clave dos veces → un pago, el MISMO comprobante | ✅ |
| R44 | idem — el INSERT se INTENTA y lo rechaza la restricción antes de releer | ✅ |
| R45 | idem — mismo beneficiario/monto/método/fecha con dos claves → dos pagos | ✅ |
| R46 | idem (mutaciones 1-3 de T B.4) — dos de 60 000 contra 100 000: uno entra, el otro `excede` | ✅ |
| R47 | idem + `components/RegistrarPagoDialog.test.tsx` (mutación 2 de T D.1) — `ya_registrado` con el comprobante real | ✅ |
| R48 | `integration/db/liquidacion-idempotencia.test.ts` (mutación 2 de T B.6) — reintentar la aprobación: `count = 0` | ✅ |
| R49 | `components/PagosRegistradosTabla.test.tsx` + `CierresAdminPagoMensajero.test.tsx` — los 7 datos del comprobante | ✅ |
| R50 | `integration/wallet-tiendas-pago.test.tsx` + `unit/services/liquidacion-service.test.ts` — la lista, en el desglose de SU tienda | ✅ |
| R51 | `integration/wallet-tiendas-pago.test.tsx` — «el movimiento del pago aparece con su concepto propio, distinguible» | ✅ |
| R52 | `unit/repositories/pago-mensajero-filtro-cierre.test.ts` (mutaciones 1 y 2 de T C.3) — **las dos mitades**, sobre un motor que EVALÚA el `where` | ✅ |
| R53 | `integration/wallet-tiendas-pago.test.tsx` — «pagado» sube y el saldo baja en el MISMO monto, sin recargar | ✅ |
| R54 | `integration/mis-pagos-page.test.tsx` (mutaciones 1 y 2 de T G.1) — el mensajero ve el pago y su reverso, en la página REAL | ✅ |
| R55 | `unit/services/mi-wallet-desglose.test.ts` (mutación B: identidad, no parecido) + `integration/mi-wallet-page.test.tsx` (mutación A) | ✅ |
| R56 | `unit/guards/liquidacion-money-safe.test.ts` (**T H.2**: DTO de 9 claves + proyección con sonda de uuids) + `unit/descarga/pagos-registrados-descarga-columnas.test.ts` + `columnas-sensibles.guardia` | ✅ |
| R57 | `unit/descarga/cobertura-tablas.guardia.test.ts` (**T H.1**) — la tabla registrada con sus dos montajes y los totales del árbol | ✅ **desde esta tanda** |
| R58 | `integration/db/liquidacion-migration.test.ts` (mutaciones 1 y 2 de T A.2) **+ T H.3 [1][3]: rechazo REAL `23514`** | ✅ |
| R59 | idem **+ T H.3 [5][7]** | ✅ |
| R60 | `integration/db/liquidacion-migration.test.ts` — sin `NOT` ni `<>`; un concepto futuro no casa ninguna rama; los 4 cruces prohibidos. **T H.3 [1][3][5][7]** lo confirma en la base | ✅ |
| **R61** | **— NO HAY TEST.** Evidencia de T A.0: producción medida y limpia; **preview NO verificada** | ❌ **HUECO — bloquea el MERGE** |
| R62 | `integration/db/liquidacion-migration.test.ts` + `unit/guards/liquidacion-alcance.test.ts` (**T H.4**) — la caja no recibe el CHECK, ni en el up ni en el down | ✅ |
| R63 | `integration/db/liquidacion-migration.test.ts` **+ T H.3: `relrowsecurity=true`, `policies=0`** leído de la base | ✅ |
| R64 | `integration/db/liquidacion-migration.test.ts` **+ el round-trip de T H.3**, con los enums intactos y cero filas reescritas | ✅ |
| R65 | `unit/actions/liquidacion-action.test.ts` — la lista EXACTA de exportaciones (5) + patrón que rechaza `editar/actualizar/modificar/corregir/update/patch` | ✅ |
| **R66** | `unit/guards/liquidacion-alcance.test.ts` (**T H.4**) — la migración crea exactamente 2 tablas, sin `ADD COLUMN`/`CREATE TYPE`, y no nombra corte/período/ciclo | ✅ **desde esta tanda** |
| **R67** | `unit/guards/liquidacion-alcance.test.ts` (**T H.4**, mutación ejecutada) + la suite de la 111 verde sin editar | ✅ **desde esta tanda** |
| **R68** | `unit/guards/liquidacion-alcance.test.ts` (**T H.4**, mutación ejecutada) + R40 por el lado del código + la suite de analítica verde sin editar | ✅ **desde esta tanda** |
| R69 | `unit/services/liquidacion-anulacion.test.ts` — contraasiento del signo opuesto, mismo monto, en el libro correcto; ni un borrado | ✅ |
| R70 | idem (mutación 1 de T F: **el criterio duro**) — un monto colado (`999999.99` y `0.01`) se IGNORA, en los dos libros | ✅ |
| R71 | idem — el saldo vuelve al valor EXACTO previo, también cuando era negativo | ✅ |
| R72 | `unit/types/liquidacion-schemas.test.ts` + `components/AnularPagoDialog.test.tsx` (mutaciones 4b y 4c: **las dos barreras, por separado**) | ✅ |
| R73 | `unit/repositories/liquidacion-pago-repository.test.ts` («escribe las TRES columnas… y devuelve quién y cuándo») + `unit/services/liquidacion-anulacion.test.ts` («quién anula sale de la SESIÓN») | ✅ |
| R74 | `components/PagosRegistradosTabla.test.tsx` (mutación 3 de T F.5) + `unit/services/liquidacion-service.test.ts` — el anulado sale ENTERO y marcado | ✅ |
| R75 | `unit/repositories/liquidacion-pago-repository.test.ts` + `integration/db/liquidacion-idempotencia.test.ts` + `liquidacion-migration.test.ts` **+ T H.3 [13][14]: `23505` REAL** | ✅ |
| R76 | `unit/services/liquidacion-anulacion.test.ts` + `components/AnularPagoDialog.test.tsx` — la petición tiene DOS campos y ninguno es un monto | ✅ |
| R77 | `unit/services/liquidacion-anulacion.test.ts` (mutación 2 de T F) — el reverso se fecha el día de la ANULACIÓN, en calendario de CR | ✅ |
| R78 | `integration/db/liquidacion-idempotencia.test.ts` — la fila del pago queda intacta campo a campo; el pago nuevo entra con la MISMA referencia y fecha | ✅ |
| R79 | idem — la cadena entera: pagar → anular → el pendiente vuelve → registrar de nuevo con clave nueva → `ok` | ✅ |
| R80 | `unit/repositories/liquidacion-pago-repository.test.ts` + `unit/utils/pendiente-cierre.test.ts` + integración con el repositorio REAL | ✅ |
| R81 | `unit/services/liquidacion-anulacion.test.ts` — los 4 roles sin acceso → `forbidden` con el log VACÍO (el pago ni se lee); + las dos mitades en pantalla | ✅ |
| R82 | idem (mutación 3 de T F.5) — el prototipo del servicio es una lista cerrada de 11 métodos; un pago anulado no ofrece el control | ✅ |
| R83 | `integration/db/liquidacion-idempotencia.test.ts` (mutación 3 de T B.4) — el candado va ANTES de leer el disponible | ✅ |
| R84 | `unit/services/liquidacion-anulacion.test.ts` + integración (mutación 3a de T F) — anular toma EL MISMO candado que su pago | ✅ |
| R85 | idem (mutación 3b) — **una** sola adquisición por operación, también en los caminos que rechazan | ✅ |

**RECUENTO: 84 de los 85 tienen un test que existe, pasa y afirma el requisito. Uno no: R61.**

##### Los tres hallazgos de la trazabilidad, sin suavizar

1. **R61 — el único requisito SIN test, y el que bloquea el merge.** Dice: «la restricción NO DEBE
   poder añadirse si algún dato existente la incumple, **y su aplicación DEBE verificarse contra
   cada base antes de desplegar**». La primera mitad es una propiedad de Postgres y está
   **demostrada** (los `ADD CONSTRAINT` van sin `NOT VALID`, y T H.3 enseña la base rechazando
   filas incoherentes). La segunda mitad es un ACTO, no un test, y **está a medias**: **producción
   medida y limpia (39 + 7 filas, cero incoherentes; enums cubiertos 10/10 y 5/5), preview NO
   VERIFICABLE desde esta sesión** porque el MCP de Supabase está fijado por `.mcp.json` al
   `project_ref` de producción y el de preview no es descubrible desde aquí (el MCP no expone
   `list_projects`, el de Vercel no devuelve variables de entorno, no hay CLI de Vercel y el ref no
   está escrito en ningún archivo del repo). **Es un hueco vivo que BLOQUEA EL MERGE, no el
   código.** Lo que falta: el `project_ref` de preview y autorización para apuntar ahí el MCP, o
   correr la consulta de T A.0 desde el SQL editor de ese proyecto. Riesgo si se ignora: el build
   del PR sale rojo **y** deja una fila fallida en el `_prisma_migrations` de preview, que bloquea
   los despliegues de preview siguientes hasta repararla a mano. Producción no corre riesgo.
2. **R26 — el test es real, el puntero del spec no.** La tabla de trazabilidad de `tasks.md` dice
   `tests/components/CierresAdminModule.test.tsx (ampliado)`; ese archivo **no se amplió** (era
   condición de «Hecho» de T E.3 dejarlo intacto) y **no contiene ni una aserción de R26**
   —comprobado: cero apariciones de «R26» y de «pendiente de liquidar»—. R26 se mide, y bien, en
   `CierresAdminPagoMensajero.test.tsx`, con su mutación D. **El requisito está cubierto; la línea
   del spec apunta a un archivo equivocado.** No se ha tocado `tasks.md § Trazabilidad` porque es
   el spec aprobado: la corrección es del leader/reviewer.
3. **R67 — los nombres del spec no existen.** La misma tabla lo mapea a «suite de la 111
   (`reglas-bloqueos-cierre`, `cierre-vencido-modelo`)»: **ninguno de esos dos archivos existe** en
   `tests/`. Los reales son `tests/unit/repositories/orden-repository.bloqueo.test.ts` y los del
   modelo del cierre vencido (`cierre-dia-repository`, `cierre-dia-service`, `cierre-dia-action`,
   `mis-asignaciones-service`, `OrdenesListadoBloqueoCierre`), todos verdes y sin editar; y desde
   esta tanda hay además una aserción directa en `unit/guards/liquidacion-alcance.test.ts`.
   **Cubierto, con el puntero mal escrito.**

##### Deuda menor heredada (no es un hueco de trazabilidad)

`tests/unit/descarga/contadores-cabecera.guardia.test.ts` recorre solo `app/`, el mismo punto
ciego que T H.1 arregló en el censo. No afecta a la 172 —ninguna de sus tablas monta un contador
`({x.length})`— y abrir ese recorrido es una decisión de la 170.

#### Los defaults aplicados — constancia

| Pregunta | Resolución | Fija | Constancia |
| --- | --- | --- | --- |
| **P2** — ¿la 172 escribe en la caja principal? | **Default: NO**, ni al pagar ni al anular | R40, R68 | Espías con cero llamadas en `liquidacion-service` y `liquidacion-anulacion`; **contraprueba estructural** en `unit/guards/liquidacion-alcance.test.ts` (T H.4): el código de la feature ni siquiera nombra la caja |
| **P5** — ¿`/mi-wallet` separa «pagado» de «cargos»? | **Default: SÍ** | R55 | Cabecera de 3 importes, clasificación medida **por identidad** con la de la 171 (`mi-wallet-desglose.test.ts`, mutación B) |
| **P6** — ¿referencia obligatoria en SINPE/transferencia? | **Default: SÍ; opcional en efectivo** | R12 | `liquidacion-schemas.test.ts`, error **en el campo `referencia`** |
| **P7** — ¿comprobante como adjunto? | **Default: NO, solo texto** | R15 | 5 claves de adjunto rechazadas por `.strict()` en los 3 schemas; sin storage, sin firma y sin permiso nuevo |
| **P8** — ¿el CHECK va también a `wallet_movimiento`? | **Default: NO** | R62 | `liquidacion-migration.test.ts` + T H.4: el SQL **sin comentarios** no menciona la caja, y las tablas alteradas son exactamente los dos libros |
| **N1** — el par pago+anulación infla los brutos | **Default: no se netea; se declara en pantalla** | — | Aviso en las **cuatro** superficies con agregado inflado: `/wallet/tiendas` (T F.6), `/mis-pagos` y `/mi-wallet` (T G.2) y **`/wallet/mensajeros` (T H.4)**. Ninguna tabla de movimientos lo lleva, y hay un test que lo afirma |
| **N2** — ¿ventana temporal para anular? | **Default: sin ventana** | — | `liquidacion-anulacion.test.ts` recorre los tres estados no aprobados del cierre y espera `ok`: anular corrige un pago que ya ocurrió, y que el cierre haya cambiado después no puede dejarlo sin reverso posible. Un pago de hace seis meses es anulable; lo que hace visible una anulación tardía es la trazabilidad (quién, cuándo y por qué), no una prohibición |

#### E2E — **DECLARADO INAPLICABLE**

`CHECKPOINTS.md` pide «al menos un test E2E (Playwright)» para flujos críticos, y esta feature es
literalmente un flujo de pagos. **No se escribe ninguno, por decisión explícita del humano: «no
más e2e, pruebas básicas nada más»** (`design.md §13`). No se tapa: se declara **cómo se cubre el
riesgo por otra vía** y qué queda descubierto.

| Lo que un E2E daría | Con qué se sustituye | ¿Equivalente? |
| --- | --- | --- |
| La cadena de servidor completa bajo concurrencia real | **T B.4 y T B.6**: servicio real + los **tres** repositorios reales + el SQL crudo real contra un store que implementa la semántica de `READ COMMITTED`, del `FOR UPDATE`, del `UNIQUE` y del índice único parcial. **9 mutaciones** ejecutadas entre las dos tasks | Casi. Lo único simulado es el motor |
| Que las restricciones de datos existan y actúen | **T H.3**: Postgres REAL, 14 intentos, `23514` y `23505` con el nombre del constraint | **Sí — y un E2E no lo haría mejor** |
| Que las pantallas ejerciten el camino | **T D.3, T E.1 y T F.5**: las tres pantallas montadas de verdad con las acciones dobladas; **12 mutaciones** entre las tres | Parcial |
| **El pegamento**: navegador real → Server Action real → Postgres real | **NADA** | ❌ |

**Lo que queda descubierto, dicho claro:** que la Server Action esté bien cableada a la página en
tiempo de ejecución. Lo acotan tres cosas —el `typecheck` estricto sobre el `import` de la acción,
que la 172 reutiliza el molde de `wallet-egresos.ts` sin inventarse cableado, y que las cinco
acciones se ejercen desde tests de pantalla que importan **el módulo real** de acciones (doblado
en su implementación, no en su firma)—, pero **no es equivalente a un E2E y no se presenta como
tal**.

#### Verificación ejecutada en esta tanda

```
$ pnpm typecheck
> tsc --noEmit
(sin salida: verde)

$ pnpm lint
✖ 27 problems (0 errors, 27 warnings)       # los 27 preexistentes del baseline, ninguno mío
$ pnpm exec eslint <los 3 test nuevos + los 5 archivos modificados>
(sin salida: limpio)

$ pnpm exec vitest run tests/integration/db          # T H.3 pide la carpeta entera
 Test Files  85 passed (85)
      Tests  1024 passed (1024)

$ pnpm exec vitest run <los 24 archivos de test de la 172, guardias incluidas>
 Test Files  24 passed (24)
      Tests  613 passed (613)

$ pnpm exec vitest run tests/unit/guards             # las guardias del repo, con las 2 nuevas
 Test Files  14 passed (14)
      Tests  100 passed (100)

$ pnpm exec vitest run tests/unit/descarga           # el censo y sus vecinas
 Test Files  12 passed (12)
      Tests  92 passed (92)
```

Más las tres corridas de suites ajenas de T H.4 (111: 6 / 263 · analítica: 33 / 504 · vecinos del
censo y de `/wallet/mensajeros`: 30 / 207), **todas verdes y ninguna editada**.

**Delta contra el baseline de la Tanda H (790 archivos / 9842 tests): +3 archivos, +15 tests.**
Los 15 son 7 (money-safe transversal) + 3 (alcance) + 4 (aviso de N1) + 1 (los montajes, en el
censo). Esperado tras el gate del leader: **793 / 9857**.

**`./init.sh` y la suite completa: DEL LEADER.** Aquí no se corrieron, por indicación explícita.

#### Delta acumulado de la feature

| Hito | Archivos | Tests |
| --- | --- | --- |
| Baseline previo a la 172 | 772 | 9257 |
| Tanda A | 775 | 9340 |
| Tanda B (1/2) | 779 | 9409 |
| Tanda B (2/2) | 780 | 9487 |
| Tanda C | 782 | 9550 |
| Tanda D | 786 | 9652 |
| Tandas E + F + G | 790 | 9842 |
| **Tanda H (esperado)** | **793** | **9857** |

**+21 archivos y +600 tests** sobre el baseline previo a la feature, sin una sola regresión
declarada en ninguna tanda.

#### Veredicto

**La 172 queda COMPLETA en código y en trazabilidad: 84 de los 85 requisitos con un test que
existe, pasa y afirma lo que dice. El que falta —R61— no es código sino un acto de verificación a
medias (preview sin medir) que BLOQUEA EL MERGE, no la implementación.**

---

## Respuesta al review — BLOQUEANTE 1 (R61), mitad testeable (2026-08-02)

Encargo estrecho del leader tras `progress/review_172-liquidacion.md`: cerrar la mitad de R61 que
vive en el repo. **La otra mitad —medir la base de PREVIEW— sigue ABIERTA y bloquea el merge**; no
es del implementer (el MCP está fijado al `project_ref` de producción) y aquí no se toca ni se da
por cerrada.

### Qué se añadió

Un solo archivo tocado: `tests/integration/db/liquidacion-migration.test.ts` (**11 → 13 casos**).

1. **`los dos CHECK VALIDAN las filas existentes: ninguno se anade con NOT VALID`** — el caso que
   pedía el review. Recorre los **dos** `ADD CONSTRAINT ... CHECK` de los libros y afirma, sobre la
   sentencia entera y con `/\bNOT\s+VALID\b/i`, que ninguno lleva `NOT VALID` (ni el rodeo
   `VALIDATE CONSTRAINT`). Red secundaria: ni una aparición en **todo** el SQL ejecutable de la
   migración, con los comentarios quitados a propósito (la cabecera nombra `NOT VALID` en prosa,
   justo para explicar por qué no está).
2. **`el detector de NOT VALID no se deja enganar por mayusculas, espacios ni saltos de linea`** —
   control del detector: 6 variantes que Postgres acepta igual (`NOT VALID`, `not valid`,
   `Not Valid`, `NOT   VALID`, `NOT\tVALID`, `NOT\nVALID`) deben detectarse, y 4 inocentes
   (`IS NOT NULL`, `NOT VALIDO`, `'validado'`, un CHECK normal) **no**. Sin este control, un
   `RE_NOT_VALID` roto dejaría el caso de arriba en verde para siempre.

### Hallazgo al escribirlo: el parser del propio archivo tapaba la mutación

`sentenciaDelCheck` recortaba la sentencia **hasta el primer `);`**. Esa regla da por hecho que la
sentencia acaba donde acaba el paréntesis del CHECK — y `NOT VALID` va **después** de ese
paréntesis. Consecuencias medidas, antes de arreglarlo:

- `NOT VALID` en el CHECK de la **tienda**: el recorte se desbordaba hasta el `);` del CHECK del
  mensajero, mezclaba las ramas de los dos libros y hacía caer 3 casos con mensajes que no nombran
  la causa (`expected [ Array(4) ] to deeply equal [ 'credito', 'debito' ]`).
- `NOT VALID` en el del **mensajero** (el último del fichero): no quedaba ningún `);` que
  encontrar ⇒ `Error: El CHECK ... no termina` **al importar el módulo**, en el `ramasDelCheck` de
  nivel superior ⇒ `Tests  no tests`. **Cero casos corridos.** El archivo entero moría antes de
  llegar a la aserción nueva.

Arreglado: la sentencia se recorta ahora **de `;` a `;`** sobre el SQL sin comentarios. El cambio
solo puede **añadir** texto al trozo inspeccionado, nunca quitarlo, así que ninguna aserción
preexistente se debilita: con el SQL real los 13 casos pasan igual.

### La prueba por mutación (14.ª de la feature)

Copia byte a byte antes de empezar (`md5 4f4087be3bf32133d256cbf711d1c637`). Dos formas distintas
a propósito: la canónica y la que una regex ingenua dejaría pasar.

**Mutación A — `NOT VALID` canónico en el CHECK del ledger de tienda:**

```
@@ -136 +136 @@ CHECK (
-);
+) NOT VALID;
```
```
 × ... > los dos CHECK VALIDAN las filas existentes: ninguno se anade con NOT VALID 2ms
 ✓ ... > el detector de NOT VALID no se deja enganar por mayusculas, espacios ni saltos de linea 0ms
AssertionError: expected true to be false // Object.is equality
      Tests  2 failed | 11 passed (13)
```
(El segundo fallo es el caso de R60, que también lo ve; el diagnóstico correcto lo da el nuevo.)

**Mutación B — minúsculas, espacios de sobra y salto de línea, en el CHECK del mensajero:**

```
@@ -146 +146,2 @@ CHECK (
-);
+)
+not   valid;
```
```
 × ... > los dos CHECK VALIDAN las filas existentes: ninguno se anade con NOT VALID 5ms
 ✓ ... > el detector de NOT VALID no se deja enganar por mayusculas, espacios ni saltos de linea 0ms
AssertionError: expected true to be false // Object.is equality
      Tests  1 failed | 12 passed (13)
```

Ésta es la que importa: **`not   valid` en dos líneas**, exactamente lo que un `toContain("NOT
VALID")` habría dejado pasar. Cae solo el caso nuevo; el control del detector aguanta en verde,
que es lo que lo hace un control.

**Restauración verificada** (no basta con «lo volví a poner»: la migración está aplicada en local
y cambiarla de verdad rompería el checksum de `_prisma_migrations`):

```
--- diff contra la copia ---
diff: sin diferencias
--- md5 ---
4f4087be3bf32133d256cbf711d1c637 *db/migrations/20260802120000_liquidacion_pago/migration.sql
--- git diff db/ ---
(vacio = intacto)
```

### Verificación

```
$ pnpm typecheck
> tsc --noEmit
(sin salida: 0 errores)

$ pnpm exec vitest run tests/integration/db
 Test Files  85 passed (85)
      Tests  1026 passed (1026)

$ pnpm exec eslint tests/integration/db/liquidacion-migration.test.ts
(sin salida: 0 errores, 0 warnings)
```

`./init.sh` y la suite completa: **del leader**, por indicación explícita.

### Trazabilidad

`specs/172-liquidacion/tasks.md § Trazabilidad`, fila **R61**, reescrita en dos mitades: la del
SQL **cubierta** por este test (con la mutación fechada), la de **preview ABIERTA y bloqueando el
merge**. Las filas R26 y R67 las corrigió el leader; no se tocaron.

**Sigue abierto y NO lo cierra este trabajo:** correr contra la base de preview la consulta de
incoherencias de T A.0 (pegada literal más arriba en esta misma bitácora) antes de mergear. En
Vercel el build migra antes de compilar y los dos `ADD CONSTRAINT` validan las filas existentes —
justo la propiedad que el test de arriba protege.

#### Veredicto

**Mitad testeable de R61 cerrada y demostrada por mutación en los dos `ADD CONSTRAINT`; de paso se
arregló un parser del test que convertía esa misma mutación en un crash de importación sin
diagnóstico. La verificación de preview sigue abierta y sigue bloqueando el merge.**

---

## Respuesta al review — BLOQUEANTE 2 (R6, el eslabón ROL → PROP) (2026-08-02)

Encargo estrecho del leader tras `progress/review_172-liquidacion.md`: la respuesta P3 del humano
—**pagan `maestro` y `admin`; `adminSatelite` NO, aunque sí apruebe cierres**— estaba afirmada
contra una PROP (`puedeRegistrarPago: false`) y no contra el ROL. El eslabón que las une es una
línea de `app/(app)/cierres-admin/page.tsx` y **ponerla en `true` no rompía ninguno de los 9857
tests**.

**Es un hueco de VERIFICACIÓN, no de comportamiento, y se comprobó que lo es**: el test nuevo pasó
a la primera con el código tal cual, sin tocar ni una línea de `app/`. El permiso ya funcionaba; lo
que faltaba era medirlo donde vive.

### Qué se añadió

Un solo archivo con casos nuevos: `tests/components/CierresAdminPage.test.tsx` (**7 → 10 casos**),
que ya montaba la página REAL con `resolveActorFromSession` doblado y ya tenía un `adminSatelite`.

1. **`adminSatelite: aprueba el cierre de su zona y NO se le ofrece pagar`** — monta
   `CierresAdminPage()` con el rol de verdad, abre el detalle de un cierre `solicitado`, pulsa
   «Aprobar» (el servidor devuelve `pendientePagoMensajero: "50000.00"`, o sea: hay dinero sobre la
   mesa) y exige que el diálogo `Registrar pago a Ana Mensajera` **no exista** y que no se haya
   llamado a `registrarPagoMensajeroAction`.
2. **`CONTRAPRUEBA — maestro | admin: aprueba y SÍ recibe la oferta`** (`it.each`, 2 casos) — la
   MISMA aprobación, el MISMO pendiente, el MISMO cierre: lo único que cambia es el rol, y el
   diálogo aparece prefijado con `50000.00`. Sin esta mitad, borrar la prop entera (default
   `false`) dejaría el caso 1 en verde para siempre.

Las dos mitades del caso 1 se afirman juntas —que **apruebe** y que **no se le ofrezca**—, porque
«no se le ofrece» sólo significa algo si el cierre quedó aprobado exactamente como antes de la 172:
un `adminSatelite` que no pudiera aprobar pasaría igual de verde y sería una regresión de la 38.

**El punto de espera es lo que hace válido el negativo.** Un `queryBy…toBeNull()` sobre una UI
asíncrona puede estar midiendo «todavía no apareció». El helper no vuelve hasta que (a)
`aprobarCierre` se llamó con `{ cierreId }`, (b) salió el toast «Cierre aprobado correctamente.»,
(c) corrió `router.refresh()` —la rama de la oferta se evalúa en la línea siguiente— y (d) el modal
de detalle ya se cerró, que ocurre en la MISMA tanda de estado en la que se plantearía la oferta.
Cuando (d) se cumple, un diálogo de pago que tocara aparecer ya está en el DOM. La mutación de abajo
lo confirma empíricamente: con el predicado abierto, el caso cae.

Piezas de apoyo, todas ADITIVAS (ninguna aserción existente tocada):

- `refresh` y los toasts pasan a dobles compartidos (`vi.hoisted`) en vez de uno nuevo por render:
  sin poder esperarlos no hay punto de espera.
- Doble de `@/lib/actions/liquidacion` (las tres exportaciones que cuelgan de esta pantalla):
  ninguna llega al servidor y se puede afirmar que a un `adminSatelite` no se le llama ninguna.
- Caché de SWR propia por render (`provider` nuevo + `dedupingInterval: 0`): la página no la aísla y
  el resto del archivo comparte la global.

### La prueba por mutación (15.ª de la feature) — es el punto entero de este bloqueante

La mutación es exactamente la que el review señala como impune: forzar el predicado de la página.

```diff
--- a/app/(app)/cierres-admin/page.tsx
+++ b/app/(app)/cierres-admin/page.tsx
@@ -178,3 +178,3 @@ export default async function CierresAdminPage() {
          */
-        puedeRegistrarPago={esAccesoTotal(actor.rol)}
+        puedeRegistrarPago={true}
       />
```

**Antes de mutar** (código real, tests nuevos incluidos):

```
$ pnpm exec vitest run tests/components/CierresAdminPage.test.tsx
 Test Files  1 passed (1)
      Tests  10 passed (10)
```

**Con la mutación aplicada:**

```
$ pnpm exec vitest run tests/components/CierresAdminPage.test.tsx
 ❯ tests/components/CierresAdminPage.test.tsx (10 tests | 1 failed) 1458ms
 FAIL  tests/components/CierresAdminPage.test.tsx > CierresAdminPage — Feature 172 [P3]/R6: quién
       recibe la oferta de pago sale del ROL > adminSatelite: aprueba el cierre de su zona y NO se
       le ofrece pagar
AssertionError: expected <div data-open id="_r_18_" …(8)>…(3)</div> to be null
 ❯ tests/components/CierresAdminPage.test.tsx:393:66
 Test Files  1 failed (1)
      Tests  1 failed | 9 passed (10)
```

Cae **sólo** el caso del `adminSatelite`; las dos contrapruebas de `maestro`/`admin` siguen verdes,
que es lo que las hace contrapruebas y no ruido. El elemento que el error imprime es el popup del
diálogo de pago: la pantalla le está ofreciendo mover dinero a quien el humano decidió que no.

**Restauración verificada** (no basta con «lo volví a poner»):

```
--- diff contra la copia ---
diff: sin diferencias
--- md5 ---
763a3d6450a70e59a43d7e0eff40163d *app/(app)/cierres-admin/page.tsx
--- git status de app/ ---
(vacio = intacto)
```

### El guard inerte de `wallet-tiendas-pago.test.tsx:395-397` — qué se decidió

El review tiene razón en el diagnóstico y conviene decirlo sin adornos: en `/wallet/tiendas` el
valor de `puedeRegistrarPago` es **hoy siempre `true`**, porque el `notFound` de la página ya echó
a todo rol sin acceso total (lo mide el test de justo debajo). Un `={true}` escrito a mano ahí no
cambiaría **nada** de lo que el usuario ve. Esa aserción **no mide el eslabón rol → prop**: mide la
FORMA de una línea que hoy es redundante.

**Decisión: se conserva, y se le quita el disfraz.** El razonamiento:

- **No es una aserción que no pueda fallar** —falla si alguien cambia la línea—, es una aserción
  cuyo fallo hoy no tendría consecuencia de producto. Eso no la hace inútil: la hace **preventiva**.
  El día que esta pantalla admita un rol sin acceso total (un `adminTienda` mirando el saldo de su
  tienda es el candidato obvio), la línea deja de ser redundante **de golpe**, y un `true`
  hardcodeado que hubiera entrado mientras tanto se convierte en un botón de pagar para quien no
  puede pagar. Que falle ahora es barato; descubrirlo entonces, no.
- **Borrarla** habría dejado esa página sin ninguna nota de por qué la línea tiene que seguir
  derivada del rol, que es justo el conocimiento que el review echa en falta.
- Lo que **no** vale es dejarla aparentando que protege el eslabón. Así que el comentario ahora dice
  literalmente qué protege y qué no, y **apunta a dónde se mide de verdad**
  (`tests/components/CierresAdminPage.test.tsx`), que es la pantalla donde un rol llega y no puede
  pagar.

Cambio: comentario reescrito dentro de ese caso. **Las dos aserciones (`toMatch` / `not.toMatch`) y
el título del test quedan intactos**; no se debilitó ni se borró ninguna.

**No se replicó el guard de fuente para `cierres-admin/page.tsx`**: sería la forma débil de lo que
el test nuevo ya afirma por comportamiento, y un regex sobre el fuente pasa en verde ante cualquier
reescritura equivalente (`actor.rol !== "adminSatelite"`, por ejemplo) mientras que el test de
pantalla mide el resultado. Duplicarlo habría añadido mantenimiento sin añadir medición.

### Verificación

```
$ pnpm typecheck
> tsc --noEmit
(sin salida: 0 errores)

$ pnpm exec eslint tests/components/CierresAdminPage.test.tsx tests/integration/wallet-tiendas-pago.test.tsx
(sin salida: 0 errores, 0 warnings)

$ pnpm exec vitest run tests/components/CierresAdminPage.test.tsx \
    tests/components/CierresAdminPagoMensajero.test.tsx \
    tests/components/CierresAdminModule.test.tsx \
    tests/integration/wallet-tiendas-pago.test.tsx
 Test Files  4 passed (4)
      Tests  111 passed (111)      # 108 antes de esta respuesta: +3, todos nuevos
```

`./init.sh` y la suite completa: **del leader**, por indicación explícita.

### Trazabilidad

`specs/172-liquidacion/tasks.md § Trazabilidad`, fila **R6**, reescrita: ahora nombra primero
`CierresAdminPage.test.tsx` (la pantalla, con el ROL), luego `CierresAdminPagoMensajero.test.tsx`
(el módulo respeta su prop) y `liquidacion-service.test.ts` (la acción responde `forbidden`). Las
filas R26, R61 y R67 no se tocaron.

#### Veredicto

**El eslabón rol → prop de `/cierres-admin` queda medido por comportamiento en la página real y
demostrado por mutación: forzar el predicado a `true` tira el caso del `adminSatelite` y deja en
verde las contrapruebas. El comportamiento de la aplicación no se tocó —el permiso ya funcionaba—;
lo que faltaba, y ya no falta, es que un cambio futuro se note. El guard de `/wallet/tiendas` se
conserva como red preventiva, con su alcance real escrito al lado.**
