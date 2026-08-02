# Feature 172 — Liquidación · tasks

> Checklist de pasos discretos y verificables. `[P]` = paralelizable con las demás tasks de su
> misma tanda. Cada task declara dependencias, criterio de **hecho** y los `R<n>` que cubre.
>
> Cobertura obligatoria: **R1–R85**, todos mapeados a un test concreto (§ Trazabilidad).
> Zona `fullstack` ⇒ dentro de cada tanda el orden es **backend → frontend** (regla del arnés).
>
> **PUERTA CERRADA el 2026-08-01** (Tanda 0 completa). Tres respuestas explícitas —**P1 =
> rechazar el exceso**, **P3 = maestro y admin**, **P4 = anular ENTRA en la 172**— y cinco
> resueltas por el default declarado. La implementación puede arrancar en cuanto el leader
> resuelva T0.9.

## Cómo se entrega: 9 tandas

| Tanda | Qué entrega | Depende de |
| --- | --- | --- |
| **0** | ~~Puerta~~ **CERRADA**: 8 respuestas + resolución del calendario | — |
| **A** | Base de datos: 2 tablas + los 2 CHECK heredados + tipos y derivación pura | 0 |
| **B** | El acto de registrar un pago (servicio, **candado**, idempotencia, borde) | A |
| **C** | Lecturas: pendiente por cierre, comprobantes, filtro por cierre | B |
| **D** | Frontend del pago a **tienda** (la mitad simple: la 171 dejó el sitio) | C |
| **E** | Frontend del pago a **mensajero** (la mitad delicada: toca la aprobación) | C, D |
| **F** | **Anulación** (backend → frontend) — tanda añadida por la respuesta a P4 | C, D, E |
| **G** | Lo que ven los beneficiarios (`/mis-pagos`, `/mi-wallet`) | D, F |
| **H** | Guardias, censo y cierre | D, E, F, G |

**Regla de cierre de tanda:** `./init.sh` verde y suite completa sin regresiones respecto al
baseline medido **al inicio** de esa tanda.

**Criterio del orden:** (1) la base y la integridad primero, porque el CHECK heredado puede
tumbar un despliegue y hay que descubrirlo antes de escribir pantallas; (2) tienda antes que
mensajero, porque el pago a tienda no toca ningún camino crítico existente y el del mensajero
modifica la aprobación del cierre, la transacción más cargada del sistema; (3) **la anulación
después de que exista algo que anular**, con su backend y su frontend juntos, para que se pueda
revisar como una capacidad completa; (4) los beneficiarios al final, cuando ya hay un pago real
—y un pago anulado— que enseñarles.

---

# TANDA 0 — Puerta de aprobación humana · **CERRADA el 2026-08-01**

Las respuestas textuales viven en `requirements.md § Preguntas de la puerta (RESUELTAS)`; aquí
queda el registro de cierre y lo que cada una desencadenó.

### [x] T0.1 — P1: ¿qué pasa si el pago excede lo que se debe?
- **RESPUESTA DEL HUMANO: RECHAZAR.** Fija R25, R31, R32 y R46.
- **Desencadena:** la sección K de requisitos (**R83–R85**) y el candado de serialización de
  `design.md §4.2`, que pasa a ser trabajo obligatorio de la Tanda B (T B.4), **no opcional**.
- **Hecho:** respuesta escrita en el spec; T B.4 creada.

### [x] T0.2 — P2: ¿la 172 escribe en la caja principal?
- **RESUELTA por el default declarado: NO**, ni al pagar ni al anular. Fija R40 y R68.
- **Hecho:** `design.md §9` declara flujo por flujo qué **no** hace la 172 y qué le deja
  preparado a la 173 sin tomarle ninguna decisión.

### [x] T0.3 — P3: quién puede pagar
- **RESPUESTA DEL HUMANO: `maestro` y `admin`. `adminSatelite` FUERA**, aunque sí apruebe
  cierres: *aprobar un cierre y mover dinero no son la misma responsabilidad*. Fija R1, R6 y R81.
- **Desencadena:** contraprueba de rol obligatoria en T B.3, T B.6, T F.2 y T E.1.
- **Hecho:** tabla de alcance por rol en `design.md §7`, con la anulación incluida.

### [x] T0.4 — P4: ¿anular un pago mal registrado entra en la 172?
- **RESPUESTA DEL HUMANO: SÍ, DENTRO** (contraria al default propuesto).
- **Desencadena:** sección J de requisitos (**R69–R82**), el modelo de `design.md §6`, la tabla
  `liquidacion_anulacion` dentro de la migración de T A.1, y **la Tanda F entera**.
- **Hecho:** alcance ampliado y recontado: **85 requisitos, 9 tandas** (antes 65 y 8).

### [x] T0.5 — P5: ¿`/mi-wallet` separa «pagado» de «cargos»?
- **RESUELTA por el default declarado: SÍ.** Fija R55. Sin esto la tienda vería su pago sumado
  dentro de «Débitos». **Hecho:** T G.2 en firme.

### [x] T0.6 — P6: ¿referencia obligatoria en SINPE y transferencia?
- **RESUELTA por el default declarado: SÍ; opcional en efectivo.** Fija R12. **Hecho:** condición
  en el schema de T A.3.

### [x] T0.7 — P7: ¿comprobante como archivo adjunto?
- **RESUELTA por el default declarado: NO, solo texto.** Fija R15. **Hecho:** sin storage, sin
  firma y sin permisos nuevos en el alcance.

### [x] T0.8 — P8: ¿el CHECK va también a `wallet_movimiento`?
- **RESUELTA por el default declarado: NO.** Fija R62. **Hecho:** `design.md §2.3` explica que
  añadir una restricción que valida filas existentes a una tabla que esta feature no escribe es
  riesgo de despliegue importado; queda anotado para la 173.

### [x] T0.9 — Calendario: colisión con la 170 fase 2 (decisión del LEADER, no del spec)
- **RESUELTA el 2026-08-02: NO hay colisión, la 172 arranca ya.** La 170 y la 171 están las dos
  en `done` (las 6 tandas de la fase 2 mergeadas: PRs #248, #249, #250, #253, #255, #256), así que
  nada sigue en vuelo sobre `app/(app)/wallet/tiendas/**` ni `app/(app)/cierres-admin/**`. Zona
  `fullstack` con **0 `in_progress`**. Constancia en `progress/impl_172-liquidacion.md`.
- Comprobar qué tandas de la 170 siguen en vuelo sobre `app/(app)/wallet/tiendas/**` y
  `app/(app)/cierres-admin/**` (`AGENTS.md § Paralelismo`: intersección de archivos en la misma
  zona `fullstack`).
- **Hecho:** una línea en `progress/current.md` diciendo si la 172 arranca ya o espera. **Es lo
  único que queda abierto de esta tanda.**

---

# TANDA A — Base de datos, integridad y piezas puras

### [x] T A.0 — Verificar las bases ANTES de escribir la migración
- **HECHA el 2026-08-02.** Producción (`scfnwxqbsgkzwsdntdvd`): **39 + 7 = 46 filas, CERO
  incoherentes**; los CHECK cubren **10/10** y **5/5** valores de los enums reales. **Preview NO
  verificada**: el MCP está fijado al ref de producción y el de preview no es descubrible desde
  esta sesión — hueco declarado en `progress/impl_172-liquidacion.md`, **a resolver antes de
  mergear el PR**, no antes de escribir el código. Evidencia y consulta pegadas allí.
- Con el MCP de Supabase, en **producción y preview** (y en local con Prisma), comprobar que
  **ninguna** fila de `wallet_tienda_movimiento` ni de `pago_mensajero_movimiento` incumple el
  CHECK de `design.md §2.3`, y contar filas de las dos tablas.
- **Por qué primero:** el `ADD CONSTRAINT ... CHECK` valida las filas existentes al aplicarse, y
  en Vercel **el build migra antes de compilar**: una sola fila incoherente en producción tumba
  el despliegue.
- **Depende de:** T0.8 · **Cubre:** R61
- **Hecho:** conteos y resultado de la consulta de incoherencias pegados en
  `progress/impl_172-liquidacion.md`. Si aparece **una sola** fila incoherente, la tanda se
  detiene y vuelve a la puerta: no se «arregla» una fila de dinero sin decisión humana.

### [x] T A.1 — Modelo Prisma + migración `up`/`down`
- **HECHA el 2026-08-02.** `db/schema.prisma`: `LiquidacionPago` + `LiquidacionAnulacion` + los 4
  lados inversos en `Usuario` y 1 en `CierreDia`. `db/migrations/20260802120000_liquidacion_pago/`
  con `migration.sql` (2 tablas, 3 CHECK del pago, 2 UNIQUE, 3 índices, 6 FK, RLS en ambas, y los
  2 CHECK `tipo`↔`categoria` de los libros) y `down.sql` (DROP en orden inverso + los 2 DROP
  CONSTRAINT). **Cero sentencias de tipos** ⇒ ningún `down.sql` previo tocado.
  Round-trip up → down → up verde en local; `migrate status` limpio; `typecheck` verde.
- `db/schema.prisma`: `LiquidacionPago` y `LiquidacionAnulacion` (§2.1, §2.2) + lados inversos en
  `Usuario` y `CierreDia`.
- `migration.sql`: las 2 tablas con sus CHECK, los 2 `UNIQUE` (`clave_idempotencia`, `pago_id`),
  los 3 índices, las 6 FK, `ENABLE ROW LEVEL SECURITY` en ambas, y los **2 CHECK** de los libros.
  `down.sql`: `DROP TABLE` en orden inverso + los dos `DROP CONSTRAINT`. **Ningún `CREATE TYPE`.**
- **Depende de:** T A.0 · **Cubre:** R58, R59, R60, R62, R63, R64, R75
- **Hecho:** `pnpm run db:migrate` aplica en local; `pnpm run db:rollback` revierte; `prisma
  migrate status` limpio; `pnpm typecheck` verde con el cliente regenerado.

### [x] T A.2 — Test estático de la migración
- **HECHA el 2026-08-02.** `tests/integration/db/liquidacion-migration.test.ts`: **11 casos, los
  11 verdes**. Los dos CHECK no se comprueban por `toContain` del SQL literal: se **parsean** a
  un mapa `tipo → categorías` y se comparan contra los valores REALES de los enums leídos de
  `db/schema.prisma`. **Prueba por mutación ejecutada** (borrar la rama `credito` y borrar
  `'ajuste_devengo'`): en los dos casos caen 2 tests; salida pegada en
  `progress/impl_172-liquidacion.md`.
- `tests/integration/db/liquidacion-migration.test.ts` (molde `wallet-tienda-migration.test.ts`,
  regex sobre el SQL, sin Postgres):
  - «crea la tabla del pago con monto DECIMAL(12,2) y sin updated_at/deleted_at»
  - «exige exactamente un beneficiario y el cierre solo cuando el beneficiario es un mensajero»
  - «un pago solo se puede anular una vez» (UNIQUE de `pago_id`, R75)
  - «reutiliza el enum de método de pago existente y no crea ningún tipo nuevo»
  - «habilita RLS sin políticas anon/authenticated en las dos tablas» (R63)
  - «ata cada concepto del ledger de tienda a su único tipo válido» (R58)
  - «ata cada concepto del libro del mensajero a su único tipo válido» (R59)
  - «un concepto que la restricción no clasifica no casa ninguna rama» (R60)
  - «las categorías de ajuste que usa la anulación son válidas en su tipo» (R69)
  - «no añade la restricción a la caja principal» (R62)
  - «el down revierte las dos tablas y los dos CHECK, y no toca ningún enum» (R64)
- **Depende de:** T A.1 · **Cubre:** R58, R59, R60, R62, R63, R64, R75
- **Hecho:** 11 tests verdes; borrar a mano una rama del CHECK hace fallar el test que la afirma.

### [x] T A.3 [P] — Tipos y schemas de borde
- **HECHA el 2026-08-02.** `lib/types/liquidacion.ts` (DTOs de §3.2 + 3 schemas `.strict()`) y
  `tests/unit/types/liquidacion-schemas.test.ts` (**57 tests verdes**). Todos los negativos de
  «Hecho» cubiertos, cada uno afirmando **el campo** del error. Hallazgo: un día inexistente
  (`2026-02-31`) **no** da `Invalid Date` en V8 (rueda al 3 de marzo), así que la validación de
  fecha compara el ISO de vuelta; hay un test que lo fija.
- `lib/types/liquidacion.ts`: los DTO de `design.md §3.2`, `montoPositivoSchema` reutilizado, tope
  por precisión de columna (molde `INDEMNIZACION_MONTO_MAX`), `z.enum(METODO_PAGO_SEED)`,
  `fechaPago` como `YYYY-MM-DD` no futura en hora de Costa Rica (`fechaCalendarioCR`),
  `referencia` **obligatoria si el método no es efectivo** `[P6]`, `nota` con tope, motivo de
  anulación no vacío, `.strict()`.
- Test `tests/unit/types/liquidacion-schemas.test.ts`.
- **Depende de:** T0.6 · **Cubre:** R8, R10, R11, R12, R13, R15, R72
- **Hecho:** los casos negativos (monto 0, 3 decimales, coma decimal, monto de 11 dígitos, fecha
  de mañana, SINPE sin referencia, nota pasada de tope, motivo en blanco, clave desconocida,
  cualquier campo de archivo adjunto) devuelven `validation_error` **por campo**.

### [x] T A.4 [P] — Derivación pura del pendiente de un cierre
- **HECHA el 2026-08-02.** `lib/utils/pendiente-cierre.ts` (`derivarPendienteCierre`, pura, STRING
  `toFixed(2)`) y `tests/unit/utils/pendiente-cierre.test.ts` (**15 tests verdes**): los 6 casos
  de «Hecho» más las fronteras al céntimo y el barrido money-safe sobre el propio módulo. La
  regla `min(P, E)` **no se reimplementa**: hay un test que compara la salida con
  `calcularSplitPago(P, E).pendiente` sobre 6 pares.
- `lib/utils/pendiente-cierre.ts`: `derivarPendienteCierre(P, E, pagadoVigente)` → STRING, con
  `Prisma.Decimal`, reutilizando `calcularSplitPago` (no reimplementando `min(P,E)`).
- Test `tests/unit/utils/pendiente-cierre.test.ts`: `E=0` → pendiente `P`; `E≥P` → `0.00`; `P=0`
  → `0.00`; pagos parciales acumulados; un pago anulado **no** descuenta; nunca negativo.
- **Depende de:** — · **Cubre:** R22, R24, R80
- **Hecho:** 6 casos verdes y **cero** `Number`/`parseFloat` en el módulo.

---

# TANDA B — Registrar un pago

### [x] T B.1 — Repositorio del pago
- **HECHA el 2026-08-02.** `lib/interfaces/repositories/ILiquidacionPagoRepository.ts` +
  `lib/repositories/LiquidacionPagoRepository.ts` (8 métodos; `anular` queda para T F.1) y
  `tests/unit/repositories/liquidacion-pago-repository.test.ts` (**20 tests verdes**). `crear`
  traduce el P2002 de la clave en `{ status: "clave_repetida" }` **en las dos formas del error**
  (nativa y driver adapter de Prisma 7, la cicatriz de `_shared/prisma-unique.ts`); un P2002 de
  otra restricción se propaga. «Vigentes» vive en una sola constante (`VIGENTE`) usada por las
  dos sumas, y hay un test que compara el `where` de las sumas con el de los listados —que sí
  traen los anulados (R74).
- `ILiquidacionPagoRepository` + implementación: `crear(tx, input)` (traduce el conflicto de
  `clave_idempotencia` en un resultado, no en una excepción que suba), `obtenerPorClave`,
  `obtenerPorId`, `sumarVigentesPorCierre(ids)`, `sumarVigentesPorTienda(id)`, `listarPorCierre`,
  `listarPorTienda`. **«Vigentes» = sin fila en `liquidacion_anulacion`.** Solo Prisma.
- Test `tests/unit/repositories/liquidacion-pago-repository.test.ts`.
- **Depende de:** T A.1 · **Cubre:** R7, R9, R80
- **Hecho:** `crear` escribe las 10 columnas del documento; las sumas excluyen anulados; los
  totales salen como STRING.

### [x] T B.2 [P] — Los libros aceptan fecha de movimiento
- **HECHA el 2026-08-02.** `fechaMovimiento?: Date` en los dos `Crear*Input` y en los dos
  repositorios, emitida **solo si viene** (spread condicional: cuando no viene, la clave **no
  existe** en el `data`, no vale `undefined`). Test nuevo
  `tests/unit/repositories/libros-fecha-movimiento.test.ts` (**6 verdes**) en archivo NUEVO
  justamente para no tocar ninguno de los existentes: los tests de los dos feeds del cierre
  (`wallet-tienda-feed-service`, `wallet-mensajero-feed-service`,
  `pago-mensajero-movimiento-repository`, `wallet-idempotencia`) siguen verdes **sin editarlos**.
- Añadir `fechaMovimiento?: Date` a `CrearPagoMensajeroInput` y `CrearMovimientoTiendaInput`, y
  pasarlo solo si viene (`design.md §2.4`).
- **Depende de:** T A.1 · **Cubre:** R37
- **Hecho:** los tests existentes de los dos feeds del cierre siguen verdes **sin editarlos** —
  es la prueba de que el campo es opcional de verdad.

### [x] T B.3 — `LiquidacionService.registrarPagoTienda`
- **HECHA el 2026-08-02.** `lib/interfaces/services/ILiquidacionService.ts` +
  `lib/services/LiquidacionService.ts` + `lib/utils/descripcion-pago.ts`
  (`descripcionDePago` y `medianocheUtcDelDia`, puras). Test
  `tests/unit/services/liquidacion-service.test.ts` (**33 verdes**) con las contrapruebas de rol
  —`adminTienda` pidiendo **su propia** tienda y `adminSatelite` → `forbidden`, con el log de
  llamadas **vacío**— y R40 medido con un doble de `tx` que expone `walletMovimiento` espiado:
  cero llamadas. El servicio **no recibe** el repositorio de la caja (contraprueba estructural).
- Guardia `esAccesoTotal` **antes** de tocar datos; saldo vía `agregarSaldoPorTienda` +
  `derivarSaldoTienda`; ramas `sin_saldo` / `excede`; escritura del documento y del débito
  `pago_tienda` en la **misma** transacción, con `origenTipo: "pago_tienda"`,
  `origenId: pago.id`, `registradoPor: actor`, `fechaMovimiento` de la fecha real y `descripcion`
  compuesta (método · referencia, **sin** la nota).
- Test `tests/unit/services/liquidacion-service.test.ts` (mitad tienda).
- **Depende de:** T B.1, T B.2 · **Cubre:** R1, R2, R5, R6, R29, R30, R31, R32, R36, R38, R39, R40, R41
- **Hecho:** contraprueba incluida — `adminTienda` pidiendo **su propia** tienda y
  `adminSatelite` reciben `forbidden`; y un test afirma que el repositorio de la **caja
  principal** no recibe ni una llamada (R40).

### [x] T B.4 — El candado de serialización `[P1]`
- **HECHA el 2026-08-02.** `bloquearBeneficiario` en el repositorio (las dos ramas: `usuario`
  para la tienda, `cierre_dia` para el mensajero) y llamada **antes** de leer el disponible.
  `tests/integration/db/liquidacion-idempotencia.test.ts` (**10 verdes**) con un store que
  implementa la semántica real del `FOR UPDATE` **leyéndolo de la sentencia cruda que emite el
  repositorio**, más visibilidad transaccional (commit → release, en ese orden).
  **Prueba por mutación ejecutada tres veces** (quitar el candado del servicio: 8 tests caen;
  candado no-op en el store: 3 caen; candado **después** de la lectura: 4 caen). Salidas pegadas
  en `progress/impl_172-liquidacion.md`. **Hallazgo del proceso:** la primera versión del store
  fotografiaba las filas *después* de ceder el turno y el test de carrera pasaba SIN candado; se
  corrigió a instantánea al inicio de la sentencia (`READ COMMITTED`) y ahí sí cae.
- `bloquearBeneficiario(tx, …)` en el repositorio (`SELECT … FOR UPDATE`: fila de `cierre_dia`
  para el mensajero, fila de `usuario` para la tienda) y llamada **antes** de leer el disponible,
  **una sola** por operación.
- Tests en `tests/integration/db/liquidacion-idempotencia.test.ts`:
  - «el bloqueo se toma antes de leer cuánto hay disponible» (orden de llamadas, R83)
  - «dos registros simultáneos no saldan más de lo debido» (carrera simulada, R46)
  - «ninguna operación toma más de un bloqueo» (R85)
- **Depende de:** T B.3 · **Cubre:** R46, R83, R85
- **Hecho:** **prueba por mutación obligatoria**: quitando el bloqueo del store, el test de
  carrera debe fallar. Un test de concurrencia que pasa sin candado no prueba nada.

### [x] T B.5 — `LiquidacionService.registrarPagoMensajero`
- **HECHA el 2026-08-02.** `registrarPagoMensajero` en `LiquidacionService` (candado del
  **cierre** → guardia de estado leída **dentro** de la transacción → pendiente derivado →
  documento + movimiento `pago`/`liquidacion` con `origenTipo: "pago_mensajero"`). El
  repositorio gana `obtenerCierreParaPago(cierreId, tx?)` —**solo lectura**, `select` de 5
  columnas— y el servicio, un tercer repositorio por constructor
  (`IPagoMensajeroMovimientoRepository`). El **beneficiario sale del cierre**, nunca de la
  petición (R5). `tests/unit/services/liquidacion-service.test.ts` pasa de 33 a **67 casos**:
  los tres estados no aprobados → `cierre_no_aprobado` sin escribir ni derivar el pendiente,
  pago parcial con la cifra exacta al céntimo, y R42 medido por tres vías (espías del `tx`,
  el doble del repositorio y la ausencia estructural de cualquier escritura sobre `cierreDia`).
- Igual que T B.3, más: el cierre debe existir y estar `aprobado` (leído dentro de la
  transacción), el pendiente sale de `derivarPendienteCierre`, el bloqueo es el del **cierre**, y
  el movimiento es `pago`/`liquidacion` con `origenTipo: "pago_mensajero"`.
- **Depende de:** T B.4, T A.4 · **Cubre:** R20, R21, R23, R24, R25, R35, R42
- **Hecho:** cierre `solicitado`, `vencido` y `rechazado` → `cierre_no_aprobado` **sin escribir
  nada**; un pago parcial deja el resto pendiente con la cifra exacta; ningún snapshot del cierre
  se toca (R42, verificado sobre el doble del repositorio).

### [x] T B.6 — Idempotencia
- **HECHA el 2026-08-02.** `tests/integration/db/liquidacion-idempotencia.test.ts` pasa de 10 a
  **26 casos**, sobre el store **ya corregido** de T B.4 (instantánea al inicio de la sentencia),
  ampliado con la semántica del `UNIQUE(clave_idempotencia)` y del índice único parcial de
  **los dos** libros, más `cierre_dia` (que **revienta** si alguien intenta escribirlo, R42).
  Los 5 casos de la lista, en los dos caminos. **Prueba por mutación ejecutada dos veces**:
  apagar el `UNIQUE` del store hace caer **5** tests —el primero incluido, con los dos pagos
  entrando (`crear-documento:pago-2`)— y apagar el índice único parcial del libro del mensajero
  hace caer los **2** de R48. Salidas pegadas en `progress/impl_172-liquidacion.md`.
- En `tests/integration/db/liquidacion-idempotencia.test.ts`, con un store en memoria que
  **simula la semántica real** del `UNIQUE` y del índice único parcial de los libros (molde
  `wallet-idempotencia.test.ts`):
  - «la misma solicitud dos veces registra un solo pago y devuelve el mismo comprobante» (R43, R47)
  - «la barrera es la restricción de la base, no una comprobación previa» (R44)
  - «dos pagos legítimos con el mismo monto, método y fecha son dos pagos» (R45)
  - «el documento y el libro nunca divergen» (invariante de `design.md §5`)
  - «reintentar la aprobación de un cierre sigue sin duplicar movimientos» (R48)
- **Depende de:** T B.5 · **Cubre:** R43, R44, R45, R47, R48
- **Hecho:** 5 tests verdes **y** demostración por mutación de que quitar el `UNIQUE` del store
  hace fallar el primero.

### [x] T B.7 — Server Actions de registro
- **HECHA el 2026-08-02.** `lib/actions/liquidacion.ts` con las **dos** acciones de registro
  (las otras tres del diseño son de T C.1 y T F.4), molde literal de `wallet-egresos.ts`.
  `tests/unit/actions/liquidacion-action.test.ts` (**23 casos**): sin sesión →
  `unauthenticated` sin tocar el servicio **y con la petición rota también** (el orden importa);
  ZodError → `validation_error` **por campo**; un monto `number` muere en el borde; los estados
  de dominio se devuelven tal cual; y R65 con **dos** aserciones —la lista EXACTA de
  exportaciones y un patrón que rechaza `editar/actualizar/modificar/corregir/update/patch`—.
- `lib/actions/liquidacion.ts` con el molde de `lib/actions/wallet-egresos.ts`
  (`resolveActorFromSession` → `UnauthenticatedError` **antes** del servicio → `schema.parse` →
  servicio bajo `withErrorHandler`). Mutaciones internas ⇒ Server Action, no Route Handler.
- Test `tests/unit/actions/liquidacion-action.test.ts`.
- **Depende de:** T B.5 · **Cubre:** R3, R14, R65
- **Hecho:** sin sesión → `unauthenticated` **sin** llamar al servicio; ZodError →
  `validation_error`; ningún monto viaja como `number`; **no se exporta ninguna acción de editar
  un pago** (R65).

---

# TANDA C — Lecturas: pendiente, comprobantes y filtro

### [ ] T C.1 [P] — Listas de comprobantes
- `listarPagosDeCierre` / `listarPagosDeTienda` en el servicio (mismo gate de rol), devolviendo
  `PagoRegistradoDTO[]` con el **nombre** de quien registró y, si lo hay, el bloque de anulación.
- **Depende de:** T B.1 · **Cubre:** R49, R50, R56, R74
- **Hecho:** el DTO no contiene ningún uuid salvo el `id` del pago (que no se pinta ni se
  descarga); un rol sin acceso total → `forbidden`.

### [ ] T C.2 — El pendiente viaja con el cierre
- `CierreAdminResumen` gana `pendientePagoMensajero: string | null` (`null` si no está aprobado) y
  `AprobarCierreServiceResult.ok` lo devuelve tras aprobar. Una sola llamada
  `sumarVigentesPorCierre(ids de la página)` por listado; `toResumen` sigue sin recomputar dinero.
- Test `tests/unit/services/cierres-admin-pendiente.test.ts`.
- **Depende de:** T B.1, T A.4 · **Cubre:** R22, R26, R28
- **Hecho:** los tres listados (cola, histórico y sin paginar) devuelven el campo; un cierre
  `solicitado` lo devuelve `null`; el número de llamadas al repositorio por listado **no** crece
  con el tamaño de página.

### [ ] T C.3 [P] — Filtrar el desglose del mensajero por cierre incluye sus pagos
- `PagoMensajeroMovimientoRepository`: el filtro `cierreId` pasa a `OR [ {cierre_dia, cierreId},
  {pago_mensajero, origenId ∈ pagos de ese cierre} ]` (`design.md §5`).
- Test `tests/unit/repositories/pago-mensajero-filtro-cierre.test.ts`.
- **Depende de:** T B.1 · **Cubre:** R52
- **Hecho:** con un pago y su contraasiento sembrados, filtrar por su cierre los devuelve los
  dos; filtrar por **otro** cierre no devuelve ninguno (las dos mitades, o el test pasa con un
  `OR` que lo trae todo).

---

# TANDA D — Frontend: pagar a una tienda

### [ ] T D.1 — Formulario de pago (compartido)
- `components/shared/liquidacion/RegistrarPagoDialog.tsx`: monto (prefijado al disponible,
  editable a la baja), método, referencia, nota y fecha real (por defecto **hoy** en hora de
  Costa Rica, no futura). Genera la **clave de idempotencia al abrirse**, la conserva entre
  reintentos y la renueva solo tras un registro exitoso. Confirmar deshabilitado mientras el
  formulario no sea válido, con el mismo criterio que revalida el servidor.
- Test `tests/components/RegistrarPagoDialog.test.tsx`.
- **Depende de:** T B.7 · **Cubre:** R14, R23, R30, R43, R47
- **Hecho:** reenviar tras un error de red manda **la misma** clave; tras un registro exitoso la
  siguiente apertura manda una distinta; cero `Number`/`parseFloat` en el archivo.

### [ ] T D.2 [P] — Tabla de comprobantes (compartida) + columnas de descarga
- `PagosRegistradosTabla.tsx` (`<DataTable>`, descarga **Familia B** con `filasLocales`) y
  `pagos-registrados-descarga-columnas.ts` (fecha real, monto, método, referencia, nota, quién,
  registrado el, **estado y datos de anulación**). Sin ids.
- Tests `tests/components/PagosRegistradosTabla.test.tsx` y
  `tests/unit/descarga/pagos-registrados-descarga-columnas.test.ts`.
- **Depende de:** T C.1 · **Cubre:** R49, R50, R56, R74
- **Hecho:** la guardia de columnas sensibles pasa sobre el módulo nuevo sin excepciones; un pago
  anulado se muestra **completo** y marcado.

### [ ] T D.3 — Cablear en el desglose de la tienda
- `SaldosTiendasTable.tsx` pasa `acciones={…}` (la prop que la 171 dejó lista); el diálogo se abre
  desde ahí; tras registrar, `mutate(claveDesgloseTienda(tiendaId))` refresca **solo** esa tienda;
  la lista de comprobantes se monta dentro del desglose.
- Test `tests/integration/wallet-tiendas-pago.test.tsx`.
- **Depende de:** T D.1, T D.2 · **Cubre:** R4, R33, R34, R51, R53
- **Hecho:** con dos desgloses abiertos, pagar en uno **no** vuelve a consultar el otro; el
  importe «pagado a la tienda» sube y el saldo baja en el mismo monto; un rol sin permiso no ve el
  botón (R4) **y** la acción le responde `forbidden` (R1); los tests de la 171 siguen verdes sin
  editarlos (R34).

---

# TANDA E — Frontend: pagar a un mensajero (toca la aprobación)

### [ ] T E.1 — Se pregunta al aprobar
- En `CierresAdminModule`: tras `aprobarCierre` con `ok`, si `pendientePagoMensajero > 0` **y** el
  actor puede pagar, se abre el mismo diálogo, prefijado con el pendiente. «Ahora no» cierra sin
  persistir nada.
- Test `tests/components/CierresAdminPagoMensajero.test.tsx`.
- **Depende de:** T C.2, T D.1 · **Cubre:** R6, R16, R17, R18
- **Hecho:** con «Ahora no», el cierre queda **aprobado** y no se llama a ninguna acción de pago;
  si la acción de pago falla, el cierre **sigue aprobado** y el mensaje lo dice; un cierre con
  pendiente 0 no abre el diálogo; **un `adminSatelite` aprueba sin que aparezca el diálogo**
  (R6); los tests de la 158 (sub-modal de indemnizaciones) siguen verdes sin editarlos.

### [ ] T E.2 — Pagar después, desde el cierre aprobado
- Sección «Pago al mensajero» en el detalle de un cierre `aprobado`: pendiente, lista de
  comprobantes y botón de registrar. No aparece en cierres no aprobados ni con pendiente 0.
- **Depende de:** T E.1, T D.2 · **Cubre:** R19, R27, R28, R49
- **Hecho:** los cuatro estados de cierre se prueban; con pendiente 0 no hay botón.

### [ ] T E.3 [P] — La deuda se ve sin abrir nada
- Columna «pendiente de liquidar» con su `Badge` en el listado de cierres, alimentada por
  `pendientePagoMensajero` (nunca calculada en el cliente).
- **Depende de:** T C.2 · **Cubre:** R26
- **Hecho:** un cierre aprobado con deuda se distingue en la tabla; los cierres no aprobados no
  muestran nada; `CierresAdminModule.test.tsx` sigue verde.

---

# TANDA F — Anular un pago `[P4]`

> Tanda añadida por la respuesta del humano a P4. Backend → frontend, como el resto.

### [ ] T F.1 — Repositorio de la anulación
- `anular(tx, { pagoId, motivo, anuladoPor })`: inserta en `liquidacion_anulacion` traduciendo el
  conflicto del `UNIQUE(pago_id)` en un resultado `ya_anulado`, nunca en una excepción que suba.
  Las sumas «vigentes» de T B.1 ya lo excluyen.
- **Depende de:** T B.1 · **Cubre:** R73, R75
- **Hecho:** el segundo intento devuelve `ya_anulado` sin insertar; la fila del pago **no se
  toca** (aserción explícita: cero `update` sobre `liquidacion_pago`).

### [ ] T F.2 — `LiquidacionService.anularPago`
- Guardia de rol (los mismos que pagan, R81); lee el pago **server-side** y toma **su mismo
  bloqueo** (§4.2, R84); inserta la anulación y el **contraasiento** en la misma transacción:
  `ajuste_devengo`/`devengo` para el mensajero, `ajuste_credito`/`credito` para la tienda, con
  `origenTipo`/`origenId` del pago y `fechaMovimiento` **del día de la anulación**.
- Test `tests/unit/services/liquidacion-anulacion.test.ts`.
- **Depende de:** T F.1, T B.4 · **Cubre:** R69, R70, R71, R76, R77, R81, R82, R84
- **Hecho:** el monto **no** se acepta del input (R70, verificado colando uno distinto: se
  ignora); el saldo vuelve al valor exacto previo al pago (R71); no existe camino para anular
  parcialmente (R76) ni para anular una anulación (R82); `adminSatelite` y `adminTienda` →
  `forbidden` (R81); la caja principal no recibe llamada (R40).

### [ ] T F.3 — Volver a pagar lo anulado
- Test de cadena: pagar → anular → el pendiente vuelve a su valor → registrar de nuevo con **clave
  nueva** y la **misma** referencia y fecha real → se acepta.
- **Depende de:** T F.2 · **Cubre:** R78, R79, R80
- **Hecho:** el segundo pago entra; reutilizar la clave del pago anulado devuelve
  `ya_registrado` y **no** crea nada (la clave no se libera al anular).

### [ ] T F.4 — Server Action de anulación
- Quinta acción en `lib/actions/liquidacion.ts`, mismo molde.
- **Depende de:** T F.2 · **Cubre:** R3, R72
- **Hecho:** sin sesión → `unauthenticated` antes del servicio; motivo en blanco →
  `validation_error` por campo.

### [ ] T F.5 — Frontend de la anulación
- `AnularPagoDialog.tsx` (motivo obligatorio, molde del sub-modal de rechazo de cierre) + el
  control dentro de `PagosRegistradosTabla`, visible solo para quien puede anular y solo en pagos
  vigentes. Tras anular, el mismo refresco dirigido de T D.3.
- Tests en `tests/components/PagosRegistradosTabla.test.tsx` y
  `tests/integration/wallet-tiendas-pago.test.tsx`.
- **Depende de:** T F.4, T D.3, T E.2 · **Cubre:** R4, R74, R81
- **Hecho:** sin motivo no se envía; un pago ya anulado no ofrece el control; el pago anulado
  sigue mostrando **todos** sus datos más quién, cuándo y por qué se anuló; un rol sin permiso no
  ve el control **y** la acción le responde `forbidden`.

### [ ] T F.6 [P] — Declarar la limitación de los importes brutos (N1)
- Texto en pantalla (junto a la cabecera del desglose) que explique que los importes brutos
  incluyen pagos anulados y su reverso, y que **el saldo es el número correcto**.
- **Depende de:** T F.5 · **Cubre:** — (cierra N1 con su default)
- **Hecho:** el texto existe, en lenguaje claro y sin jerga, y queda constancia en
  `progress/impl_172-liquidacion.md` de que N1 se cerró por default.

---

# TANDA G — Lo que ven los beneficiarios

### [ ] T G.1 [P] — El mensajero ve su pago (verificación, sin cambios de código)
- Test en `tests/integration/mis-pagos-page.test.tsx`: con un movimiento `liquidacion` sembrado,
  `/mis-pagos` lo muestra con su etiqueta y su cuenta por pagar baja; con su contraasiento
  sembrado, vuelve a subir.
- **Depende de:** T B.5, T F.2 · **Cubre:** R54
- **Hecho:** el test pasa **sin** tocar código de `/mis-pagos`. Si hiciera falta tocarlo, es un
  hallazgo y se declara.

### [ ] T G.2 — La tienda distingue el pago del cargo `[P5]`
- `/mi-wallet`: cabecera de tres importes reutilizando `derivarDesgloseTienda` y
  `CUBETA_POR_CATEGORIA` **por importación**, sin duplicar la clasificación.
- Test en `tests/integration/mi-wallet-page.test.tsx`.
- **Depende de:** T D.3 · **Cubre:** R55
- **Hecho:** con un pago sembrado, «pagado» lo muestra y «cargos» **no** lo incluye; un test
  compara por identidad que la clasificación es la misma función que usa el desglose del maestro.

---

# TANDA H — Guardias y cierre

### [ ] T H.1 — Censo de tablas
- Registrar las **dos** instancias nuevas de `PagosRegistradosTabla` y actualizar los totales
  duros **leyéndolos del código en ese momento**, no de este documento.
- **Depende de:** T D.3, T E.2 · **Cubre:** R57
- **Hecho:** constancia en `progress/impl_172-liquidacion.md` de haber visto la guardia **fallar**
  antes de actualizar los totales.

### [ ] T H.2 [P] — Barrido money-safe y de fuga de datos
- Test transversal: ningún archivo nuevo o modificado de la feature contiene `parseFloat`,
  `Number(` ni aritmética de montos en cliente; ningún DTO emite uuid salvo el `id` del pago, que
  no se pinta ni se descarga.
- **Depende de:** T D.3, T E.3, T F.5 · **Cubre:** R14, R56
- **Hecho:** el barrido pasa y falla si se introduce a mano un `Number(monto)`.

### [ ] T H.3 — Verificación manual de la migración y de los CHECK
- Contra Postgres local, con evidencia pegada en `progress/impl_172-liquidacion.md`: round-trip
  up → down → up; intento de insertar a mano una fila incoherente (`pago_tienda` + `credito`) y su
  rechazo; intento de insertar dos anulaciones del mismo pago y su rechazo.
- **Depende de:** T A.1, T F.1 · **Cubre:** R58, R59, R60, R64, R75
- **Hecho:** salida real pegada. Es la única prueba de que los constraints **actúan** y no solo
  están escritos: los tests de migración del repo son estáticos.

### [ ] T H.4 — Alcance: lo que NO se hizo
- Revisión del diff contra los no objetivos: sin ciclo de corte por tienda (R66), sin cambios en
  los estados que bloquean (R67), sin tocar caja ni analítica (R68).
- **Depende de:** todas · **Cubre:** R66, R67, R68
- **Hecho:** las suites de la 111 y de analítica siguen verdes **sin editarlas**.

### [ ] T H.5 — Cierre
- `./init.sh` verde; `progress/impl_172-liquidacion.md` con el mapa `R<n> → test` completo, el
  delta de archivos/tests contra el baseline, la constancia de los defaults aplicados (P2, P5, P6,
  P7, P8, N1, N2) y el resultado de T A.0 contra producción y preview.
- **Depende de:** todas · **Cubre:** trazabilidad de `CHECKPOINTS.md`
- **Hecho:** los 85 requisitos con test que existe, pasa y afirma lo que dice.

> **E2E: declarado INAPLICABLE** (decisión del humano: «no más e2e, pruebas básicas nada más»).
> `CHECKPOINTS.md` lo pediría por ser un flujo de pagos; el riesgo se cubre con T B.4/T B.6
> (cadena de servidor completa con la semántica real de los constraints y del bloqueo) y con
> T D.3 / T E.1 / T F.5 (las tres pantallas con las acciones mockeadas). Ver `design.md §13`.

---

## Trazabilidad `R<n> → test`

| R | Test |
| --- | --- |
| R1 | `tests/unit/services/liquidacion-service.test.ts` — rol sin acceso total → `forbidden` sin tocar datos |
| R2 | idem — `adminTienda` pidiendo **su propia** tienda → `forbidden` (contraprueba) |
| R3 | `tests/unit/actions/liquidacion-action.test.ts` — sin sesión → `unauthenticated` sin llamar al servicio (registro y anulación) |
| R4 | `tests/integration/wallet-tiendas-pago.test.tsx` — sin permiso no se renderizan los controles de pagar ni de anular |
| R5 | `tests/unit/services/liquidacion-service.test.ts` — el rol se comprueba antes de leer el beneficiario del input |
| R6 | `tests/components/CierresAdminPagoMensajero.test.tsx` + `liquidacion-service.test.ts` — `adminSatelite` aprueba sin oferta de pago y recibe `forbidden` al llamar directo |
| R7 | `tests/unit/repositories/liquidacion-pago-repository.test.ts` — las 10 columnas del documento |
| R8 | `tests/unit/types/liquidacion-schemas.test.ts` — método fuera del catálogo → `validation_error` |
| R9 | `tests/unit/repositories/liquidacion-pago-repository.test.ts` — fecha real e instante de registro conviven y difieren |
| R10 | `tests/unit/types/liquidacion-schemas.test.ts` — fecha de mañana (hora CR) rechazada |
| R11 | idem — 0, negativo, 3 decimales, coma y 11 dígitos rechazados |
| R12 | idem — SINPE/transferencia sin referencia rechazado; efectivo sin referencia aceptado |
| R13 | idem — nota por encima del tope rechazada |
| R14 | `tests/components/RegistrarPagoDialog.test.tsx` + barrido de T H.2 |
| R15 | `tests/unit/types/liquidacion-schemas.test.ts` — cualquier campo de adjunto → `validation_error` (`.strict()`) |
| R16 | `tests/components/CierresAdminPagoMensajero.test.tsx` — tras aprobar con pendiente > 0 se ofrece el pago |
| R17 | idem — «Ahora no» y fallo del pago dejan el cierre aprobado |
| R18 | idem + `tests/unit/services/cierres-admin-pendiente.test.ts` — aprobar no exige pago ni crea estado nuevo |
| R19 | `tests/components/CierresAdminPagoMensajero.test.tsx` — el detalle de un cierre aprobado ofrece registrar |
| R20 | `tests/unit/services/liquidacion-service.test.ts` — `solicitado`/`vencido`/`rechazado` → `cierre_no_aprobado`, sin escribir |
| R21 | idem — pago a mensajero sin cierre → rechazado en el borde |
| R22 | `tests/unit/utils/pendiente-cierre.test.ts` + `cierres-admin-pendiente.test.ts` |
| R23 | `tests/unit/services/liquidacion-service.test.ts` + `RegistrarPagoDialog.test.tsx` — monto menor al pendiente aceptado y prefijado |
| R24 | `tests/unit/services/liquidacion-service.test.ts` — el pendiente baja exactamente en el monto |
| R25 | idem — monto > pendiente → `excede` con el disponible, sin escribir `[P1]` |
| R26 | `tests/components/CierresAdminModule.test.tsx` (ampliado) — marca de pendiente de liquidar |
| R27 | `tests/components/CierresAdminPagoMensajero.test.tsx` — con pendiente 0 no hay botón |
| R28 | `tests/unit/services/cierres-admin-pendiente.test.ts` — cierre no aprobado → `null` |
| R29 | `tests/unit/services/liquidacion-service.test.ts` — pago a tienda sin cierre, contra saldo acumulado |
| R30 | `tests/components/RegistrarPagoDialog.test.tsx` — monto prefijado al disponible y editable a la baja |
| R31 | `tests/unit/services/liquidacion-service.test.ts` — monto > saldo → `excede` `[P1]` |
| R32 | idem — saldo 0 o negativo → `sin_saldo` con mensaje `[P1]` |
| R33 | `tests/integration/wallet-tiendas-pago.test.tsx` — refresco dirigido a una sola tienda |
| R34 | suite de la 171 sin editar (`wallet-tiendas-desglose.test.tsx`, `wallet-tiendas-page.test.tsx`) |
| R35 | `tests/unit/services/liquidacion-service.test.ts` — movimiento `pago`/`liquidacion` |
| R36 | idem — movimiento `debito`/`pago_tienda` |
| R37 | idem — `fechaMovimiento` = medianoche UTC de la fecha real, no la de registro |
| R38 | idem — `origenTipo`/`origenId` apuntan al pago creado |
| R39 | idem — si el movimiento falla, el documento no queda |
| R40 | idem + `liquidacion-anulacion.test.ts` — el repositorio de la caja no recibe ninguna llamada, ni al pagar ni al anular `[P2]` |
| R41 | idem — solo `createMany`; ningún `update`/`delete` sobre los libros ni sobre el pago |
| R42 | idem — ningún snapshot del cierre se escribe |
| R43 | `tests/integration/db/liquidacion-idempotencia.test.ts` — misma solicitud dos veces, un pago |
| R44 | idem — sin consulta previa por clave; la barrera es la restricción |
| R45 | idem — dos pagos legítimos idénticos son dos pagos |
| R46 | idem — carrera de dos registros no salda de más `[P1]` |
| R47 | idem + `RegistrarPagoDialog.test.tsx` — reintento devuelve `ya_registrado` |
| R48 | idem — reintentar la aprobación no duplica movimientos |
| R49 | `tests/components/PagosRegistradosTabla.test.tsx` — los datos del comprobante |
| R50 | `tests/integration/wallet-tiendas-pago.test.tsx` — la lista aparece en el desglose de la tienda |
| R51 | idem — el movimiento del pago se distingue por su concepto |
| R52 | `tests/unit/repositories/pago-mensajero-filtro-cierre.test.ts` — pago y contraasiento, las dos mitades |
| R53 | `tests/integration/wallet-tiendas-pago.test.tsx` — «pagado» sube y saldo baja igual |
| R54 | `tests/integration/mis-pagos-page.test.tsx` — el mensajero ve el pago y su reverso |
| R55 | `tests/integration/mi-wallet-page.test.tsx` — «pagado» separado de «cargos» `[P5]` |
| R56 | `tests/unit/descarga/pagos-registrados-descarga-columnas.test.ts` + guardia de columnas sensibles |
| R57 | `tests/unit/descarga/cobertura-tablas.guardia.test.ts` — censo con las dos instancias |
| R58 | `tests/integration/db/liquidacion-migration.test.ts` + T H.3 (rechazo real de una fila incoherente) |
| R59 | idem |
| R60 | `tests/integration/db/liquidacion-migration.test.ts` — un concepto sin clasificar no casa ninguna rama |
| R61 | evidencia de T A.0 en `progress/impl_172-liquidacion.md` (verificación previa contra producción y preview) |
| R62 | `tests/integration/db/liquidacion-migration.test.ts` — la migración no toca `wallet_movimiento` `[P8]` |
| R63 | idem — RLS sin políticas en las dos tablas nuevas |
| R64 | idem — `down.sql` revierte tablas y CHECK, sin tocar enums; + round-trip de T H.3 |
| R65 | `tests/unit/actions/liquidacion-action.test.ts` — no se exporta ninguna acción de editar un pago |
| R66 | T H.4 — revisión de alcance: ninguna tabla, estado ni pantalla de «corte por tienda» en el diff |
| R67 | suite de la 111 (`reglas-bloqueos-cierre`, `cierre-vencido-modelo`) sin editar |
| R68 | suites de analítica y de la caja sin editar; R40 lo cubre por el lado del código |
| R69 | `tests/unit/services/liquidacion-anulacion.test.ts` — contraasiento del signo opuesto, mismo monto, sin borrar ni editar |
| R70 | idem — un monto colado en el input se ignora; el del contraasiento sale del pago |
| R71 | idem — el saldo vuelve al valor exacto previo al pago |
| R72 | `tests/unit/types/liquidacion-schemas.test.ts` — motivo en blanco → `validation_error` |
| R73 | `tests/unit/repositories/liquidacion-pago-repository.test.ts` — actor e instante de la anulación persistidos |
| R74 | `tests/components/PagosRegistradosTabla.test.tsx` — el pago anulado se muestra completo, marcado y con motivo/actor/instante |
| R75 | `tests/unit/repositories/liquidacion-pago-repository.test.ts` (segunda anulación → `ya_anulado`) + `liquidacion-migration.test.ts` (UNIQUE) + T H.3 |
| R76 | `tests/unit/services/liquidacion-anulacion.test.ts` — no existe entrada de monto parcial |
| R77 | idem — el contraasiento se fecha el día de la anulación, no el del pago |
| R78 | `tests/integration/db/liquidacion-idempotencia.test.ts` (T F.3) — misma referencia y fecha en el pago nuevo |
| R79 | idem — tras anular, el pendiente vuelve y se acepta un pago nuevo |
| R80 | `tests/unit/utils/pendiente-cierre.test.ts` + `liquidacion-pago-repository.test.ts` — las sumas excluyen anulados |
| R81 | `tests/unit/services/liquidacion-anulacion.test.ts` — `adminSatelite`/`adminTienda`/`mensajero` → `forbidden` `[P3]` |
| R82 | idem — no existe camino para anular una anulación |
| R83 | `tests/integration/db/liquidacion-idempotencia.test.ts` — el bloqueo se toma ANTES de leer el disponible (orden de llamadas) |
| R84 | idem — anular toma el mismo bloqueo que su pago |
| R85 | idem — una sola adquisición por operación |
