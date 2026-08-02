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
