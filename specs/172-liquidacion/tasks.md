# Feature 172 — Liquidación · tasks

> Checklist de pasos discretos y verificables. `[P]` = paralelizable con las demás tasks de su
> misma tanda. Cada task declara dependencias, criterio de **hecho** y los `R<n>` que cubre.
> **Ninguna task de implementación arranca antes de la aprobación humana del spec**
> (`spec_ready` → aprobado): la Tanda 0 es esa puerta.
>
> Cobertura obligatoria: **R1–R65**, todos mapeados a un test concreto (§ Trazabilidad).
> Zona `fullstack` ⇒ dentro de cada tanda el orden es **backend → frontend** (regla del arnés).

## Cómo se entrega: 8 tandas

| Tanda | Qué entrega | Depende de |
| --- | --- | --- |
| **0** | Respuestas de la puerta (8 preguntas) + resolución del calendario | — |
| **A** | Base de datos: tabla del pago + los 2 CHECK heredados + tipos y derivación pura | 0 |
| **B** | El acto de registrar un pago (servicio, idempotencia, borde) | A |
| **C** | Lecturas: pendiente por cierre, lista de comprobantes, filtro por cierre | B |
| **D** | Frontend del pago a **tienda** (la mitad simple: la 171 dejó el sitio) | C |
| **E** | Frontend del pago a **mensajero** (la mitad delicada: toca la aprobación) | C, D |
| **F** | Lo que ven los beneficiarios (`/mis-pagos`, `/mi-wallet`) | D |
| **G** | Guardias, censo y cierre de la feature | D, E, F |

**Regla de cierre de tanda:** `./init.sh` verde y suite completa sin regresiones respecto al
baseline medido **al inicio** de esa tanda.

**Criterio del orden:** (1) la base y la integridad primero, porque el CHECK heredado puede
tumbar un despliegue y hay que descubrirlo antes de escribir pantallas; (2) tienda antes que
mensajero, porque el pago a tienda no toca ningún camino crítico existente y el del mensajero
modifica la aprobación del cierre, que es la transacción más cargada del sistema; (3) los
beneficiarios al final, cuando ya existe un pago real que enseñarles.

---

# TANDA 0 — Puerta de aprobación humana (bloquea TODO)

Cada task se cierra con la respuesta del humano escrita en `progress/current.md`, o con la
constancia explícita de que se aplicó el **default** declarado en `requirements.md`.

### [ ] T0.1 — P1: ¿qué pasa si el pago excede lo que se debe?
- **Impacto:** R23, R29, R30, R44 y, con la respuesta (b), el candado de concurrencia entero
  (`design.md §4.2`) deja de hacer falta y `derivarCuentaPorPagar` tiene que admitir signo
  negativo en las tres pantallas.
- **Hecho:** decisión escrita; si es (b), se anota qué requisitos cambian de redacción.

### [ ] T0.2 [P] — P2: confirmar que la 172 NO escribe en la caja principal
- **Impacto:** R38. Contradice el borrador de la 43 (`specs/43-wallet-por-tienda/requirements.md:240-244`), escrito antes de la decisión de la 173.
- **Hecho:** confirmación escrita, o la instrucción contraria con su consecuencia sobre el balance.

### [ ] T0.3 [P] — P3: quién puede pagar (solo `maestro`, o también `admin`; `adminSatelite` sí/no)
- **Impacto:** R1, y si `adminSatelite` entra, también el flujo de aprobación de su zona (§7).
- **Hecho:** lista cerrada de roles escrita.

### [ ] T0.4 [P] — P4: ¿anular un pago mal registrado entra en la 172?
- **Impacto:** R62. Hoy **no existe** ninguna forma de corregir una fila de estos dos libros.
- **Hecho:** decisión escrita; si es «sí», se añade una tanda B-bis con el reverso compensatorio
  (molde `WalletEgresoService.reversarEgreso`); si es «no», se registra la ficha de follow-up
  **el mismo día**, para no repetir el olvido de los follow-ups de la 43 y la 44.

### [ ] T0.5 [P] — P5: ¿la cabecera de `/mi-wallet` separa «pagado» de «cargos»?
- **Impacto:** R53 y la Tanda F.2 entera.
- **Hecho:** decisión escrita.

### [ ] T0.6 [P] — P6: ¿referencia obligatoria en SINPE y transferencia?
- **Impacto:** R11 y el schema del borde. · **Hecho:** decisión escrita.

### [ ] T0.7 [P] — P7: ¿comprobante como archivo adjunto o solo texto?
- **Impacto:** alcance de la Tanda D (si es archivo, entra storage, firma y permisos nuevos).
- **Hecho:** decisión escrita.

### [ ] T0.8 [P] — P8: ¿el CHECK `categoria`↔`tipo` se añade también a `wallet_movimiento`?
- **Impacto:** R56/R57 y el riesgo #1 de la migración. · **Hecho:** decisión escrita.

### [ ] T0.9 — Calendario: colisión con la 170 fase 2 (decisión del LEADER, no del spec)
- Comprobar qué tandas de la 170 siguen en vuelo sobre `app/(app)/wallet/tiendas/**` y
  `app/(app)/cierres-admin/**` (`AGENTS.md § Paralelismo`: intersección de archivos en la misma
  zona `fullstack`).
- **Hecho:** una línea en `progress/current.md` diciendo si la 172 arranca ya o espera.

---

# TANDA A — Base de datos, integridad y piezas puras

### [ ] T A.0 — Verificar las bases ANTES de escribir la migración
- Con el MCP de Supabase, en **producción y preview** (y en local con Prisma), comprobar que
  **ninguna** fila de `wallet_tienda_movimiento` ni de `pago_mensajero_movimiento` incumple el
  CHECK de `design.md §2.3`, y contar filas de las dos tablas.
- **Depende de:** T0.8 · **Cubre:** R59
- **Hecho:** conteos y el resultado de la consulta de incoherencias pegados en
  `progress/impl_172-liquidacion.md`. Si aparece **una sola** fila incoherente, la tanda se
  detiene y vuelve a la puerta: no se «arregla» una fila de dinero sin decisión humana.

### [ ] T A.1 — Modelo Prisma + migración `up`/`down`
- `db/schema.prisma`: modelo `LiquidacionPago` (§2.1) + lados inversos en `Usuario` y `CierreDia`.
- `db/migrations/<ts>_liquidacion_pago/migration.sql`: tabla, 3 CHECK propios, `UNIQUE` de
  `clave_idempotencia`, 3 índices, 4 FK, `ENABLE ROW LEVEL SECURITY`, y los **2 CHECK** de los
  libros. `down.sql`: `DROP TABLE` + los dos `DROP CONSTRAINT`. Ningún `CREATE TYPE`.
- **Depende de:** T A.0 · **Cubre:** R56, R57, R58, R60, R61
- **Hecho:** `pnpm run db:migrate` aplica en local; `pnpm run db:rollback` revierte; `prisma
  migrate status` limpio; `pnpm typecheck` verde con el cliente regenerado.

### [ ] T A.2 — Test estático de la migración
- `tests/integration/db/liquidacion-migration.test.ts` (molde `wallet-tienda-migration.test.ts`,
  regex sobre el SQL, sin Postgres):
  - «crea la tabla del pago con monto DECIMAL(12,2) y sin updated_at/deleted_at»
  - «exige exactamente un beneficiario y el cierre solo cuando el beneficiario es un mensajero»
  - «reutiliza el enum de método de pago existente y no crea ningún tipo nuevo»
  - «habilita RLS sin políticas anon/authenticated» (R60)
  - «ata cada concepto del ledger de tienda a su único tipo válido» (R56)
  - «ata cada concepto del libro del mensajero a su único tipo válido» (R57)
  - «un concepto que la restricción no clasifica no casa ninguna rama» (R58)
  - «el down revierte la tabla y los dos CHECK, y no toca ningún enum» (R61)
- **Depende de:** T A.1 · **Cubre:** R56, R57, R58, R60, R61
- **Hecho:** 8 tests verdes; borrar a mano una rama del CHECK hace fallar el test que la afirma.

### [ ] T A.3 [P] — Tipos y schemas de borde
- `lib/types/liquidacion.ts`: los DTO de `design.md §3.2`, `montoPositivoSchema` reutilizado, tope
  por precisión de columna (molde `INDEMNIZACION_MONTO_MAX`), `z.enum(METODO_PAGO_SEED)`,
  `fechaPago` como `YYYY-MM-DD` no futura en hora de Costa Rica (`fechaCalendarioCR`),
  `referencia` condicionada al método `[P6]`, `nota` con tope, `.strict()`.
- Test `tests/unit/types/liquidacion-schemas.test.ts`.
- **Depende de:** T0.1, T0.6 · **Cubre:** R7, R9, R10, R11, R12
- **Hecho:** los casos negativos (monto 0, 3 decimales, coma decimal, monto de 11 dígitos, fecha
  de mañana, SINPE sin referencia, nota que se pasa del tope, clave desconocida) devuelven
  `validation_error` **por campo**.

### [ ] T A.4 [P] — Derivación pura del pendiente de un cierre
- `lib/utils/pendiente-cierre.ts`: `derivarPendienteCierre(P, E, yaPagado)` → STRING, con
  `Prisma.Decimal`, reutilizando `calcularSplitPago` (no reimplementando `min(P,E)`).
- Test `tests/unit/utils/pendiente-cierre.test.ts`: `E=0` → pendiente `P`; `E≥P` → `0.00`;
  `P=0` → `0.00`; pagos parciales acumulados; nunca negativo por construcción.
- **Depende de:** T0.1 · **Cubre:** R20, R22
- **Hecho:** 5 casos verdes y **cero** `Number`/`parseFloat` en el módulo.

---

# TANDA B — Registrar un pago

### [ ] T B.1 — Repositorio del pago
- `ILiquidacionPagoRepository` + `LiquidacionPagoRepository`: `crear(tx, input)` (traduce el
  conflicto de `clave_idempotencia` en un resultado, no en una excepción que suba),
  `obtenerPorClave`, `sumarPorCierre(ids)`, `sumarPorTienda(id)`, `listarPorCierre`,
  `listarPorTienda`. Solo Prisma; sin lógica de negocio.
- Test `tests/unit/repositories/liquidacion-pago-repository.test.ts`.
- **Depende de:** T A.1 · **Cubre:** R6, R8
- **Hecho:** el `crear` escribe las 10 columnas del documento; `sumarPorCierre` devuelve STRING.

### [ ] T B.2 — Los libros aceptan fecha de movimiento
- Añadir `fechaMovimiento?: Date` a `CrearPagoMensajeroInput` y `CrearMovimientoTiendaInput` y
  pasarlo solo si viene (`design.md §2.4`).
- **Depende de:** T A.1 · **Cubre:** R35
- **Hecho:** los tests existentes de los dos feeds del cierre siguen verdes **sin editarlos** —
  es la prueba de que el campo es opcional de verdad.

### [ ] T B.3 — `LiquidacionService.registrarPagoTienda`
- Guardia `esAccesoTotal` **antes** de tocar datos; saldo vía `agregarSaldoPorTienda` +
  `derivarSaldoTienda`; ramas `sin_saldo` / `excede`; escritura del documento y del débito
  `pago_tienda` en la **misma** transacción, con `origenTipo: "pago_tienda"`,
  `origenId: pago.id`, `registradoPor: actor`, `fechaMovimiento` de la fecha real y
  `descripcion` compuesta (método · referencia, **sin** la nota).
- Test `tests/unit/services/liquidacion-service.test.ts` (mitad tienda).
- **Depende de:** T B.1, T B.2, T0.1, T0.3 · **Cubre:** R1, R2, R5, R27, R28, R29, R30, R34, R36, R37, R38, R39
- **Hecho:** contraprueba incluida — `adminTienda` pidiendo **su propia** tienda recibe
  `forbidden`; y un test afirma que el repositorio de la **caja principal** no recibe ni una
  llamada (R38).

### [ ] T B.4 — `LiquidacionService.registrarPagoMensajero`
- Igual, más: el cierre debe existir y estar `aprobado` (leído dentro de la transacción), el
  pendiente sale de `derivarPendienteCierre`, y el movimiento es `pago`/`liquidacion` con
  `origenTipo: "pago_mensajero"`.
- Test `tests/unit/services/liquidacion-service.test.ts` (mitad mensajero).
- **Depende de:** T B.3, T A.4 · **Cubre:** R18, R19, R21, R22, R23, R33, R40
- **Hecho:** cierre `solicitado`, `vencido` y `rechazado` → `cierre_no_aprobado` **sin escribir
  nada**; un pago parcial deja el resto pendiente con la cifra exacta; ningún snapshot del cierre
  se toca (R40, verificado sobre el doble del repositorio).

### [ ] T B.5 — Idempotencia y carrera
- `tests/integration/db/liquidacion-idempotencia.test.ts`, con un store en memoria que **simula
  la semántica real** del `UNIQUE` y del índice único parcial de los libros (molde
  `wallet-idempotencia.test.ts`):
  - «la misma solicitud dos veces registra un solo pago y devuelve el mismo comprobante» (R41, R45)
  - «la barrera es la restricción de la base, no una comprobación previa» (R42) — se afirma que
    el servicio **no** consulta por clave antes de insertar
  - «dos pagos legítimos con el mismo monto, método y fecha son dos pagos» (R43)
  - «dos registros simultáneos del mismo beneficiario no saldan más de lo debido» (R44) `[P1]`
  - «el documento y el libro nunca divergen: Σ pagos == Σ movimientos de esos pagos»
  - «reintentar la aprobación de un cierre sigue sin duplicar movimientos» (R46)
- **Depende de:** T B.4 · **Cubre:** R41, R42, R43, R44, R45, R46
- **Hecho:** 6 tests verdes; **y** se demuestra por mutación que quitar el `UNIQUE` del store
  hace fallar el primero (un test de idempotencia que pasa sin la restricción no prueba nada).

### [ ] T B.6 — Server Actions
- `lib/actions/liquidacion.ts`: 4 acciones con el molde de `lib/actions/wallet-egresos.ts`
  (`resolveActorFromSession` → `UnauthenticatedError` **antes** del servicio → `schema.parse` →
  servicio bajo `withErrorHandler`). Mutaciones internas ⇒ Server Action, no Route Handler.
- Test `tests/unit/actions/liquidacion-action.test.ts`.
- **Depende de:** T B.4 · **Cubre:** R3, R13
- **Hecho:** sin sesión → `unauthenticated` **sin** llamar al servicio; ZodError →
  `validation_error`; ningún monto viaja como `number` (aserción de tipo en la respuesta).

---

# TANDA C — Lecturas: pendiente, comprobantes y filtro

### [ ] T C.1 [P] — Listas de comprobantes
- `listarPagosDeCierre` / `listarPagosDeTienda` en el servicio (mismo gate de rol), devolviendo
  `PagoRegistradoDTO[]` con el **nombre** de quien registró, nunca su id.
- **Depende de:** T B.1 · **Cubre:** R47, R48, R54
- **Hecho:** el DTO no contiene ningún uuid; rol sin acceso total → `forbidden`.

### [ ] T C.2 — El pendiente viaja con el cierre
- `CierreAdminResumen` gana `pendientePagoMensajero: string | null` (`null` si no está aprobado)
  y `AprobarCierreServiceResult.ok` lo devuelve tras aprobar. Una sola llamada
  `sumarPorCierre(ids de la página)` por listado; el mapper `toResumen` sigue sin recomputar dinero.
- Test `tests/unit/services/cierres-admin-pendiente.test.ts`.
- **Depende de:** T B.1, T A.4 · **Cubre:** R20, R24, R26
- **Hecho:** los tres listados (cola, histórico y sin paginar) devuelven el campo; un cierre
  `solicitado` lo devuelve `null`; el número de llamadas al repositorio por listado **no** crece
  con el tamaño de página.

### [ ] T C.3 [P] — Filtrar el desglose del mensajero por cierre incluye sus pagos
- `PagoMensajeroMovimientoRepository`: el filtro `cierreId` pasa a `OR [ {cierre_dia, cierreId},
  {pago_mensajero, origenId ∈ pagos de ese cierre} ]` (`design.md §5`).
- Test `tests/unit/repositories/pago-mensajero-filtro-cierre.test.ts`.
- **Depende de:** T B.1 · **Cubre:** R50
- **Hecho:** con un pago sembrado, filtrar por su cierre lo devuelve; filtrar por **otro** cierre
  no lo devuelve (las dos mitades, o el test pasa con un `OR` que lo trae todo).

---

# TANDA D — Frontend: pagar a una tienda

### [ ] T D.1 — Formulario de pago (compartido)
- `components/shared/liquidacion/RegistrarPagoDialog.tsx`: monto (prefijado al disponible,
  editable a la baja), método, referencia, nota y fecha real (por defecto **hoy** en hora de
  Costa Rica, no futura). Genera la **clave de idempotencia al abrirse** y la conserva entre
  reintentos; la renueva solo tras un registro exitoso. Confirmar deshabilitado mientras el
  formulario no sea válido, con el mismo criterio que revalida el servidor.
- Test `tests/components/RegistrarPagoDialog.test.tsx`.
- **Depende de:** T B.6 · **Cubre:** R13, R21, R28, R41, R45
- **Hecho:** reenviar tras un error de red manda **la misma** clave; tras un registro exitoso la
  siguiente apertura manda una distinta; cero `Number`/`parseFloat` en el archivo.

### [ ] T D.2 [P] — Tabla de comprobantes (compartida) + columnas de descarga
- `PagosRegistradosTabla.tsx` (`<DataTable>`, descarga **Familia B** con `filasLocales`) y
  `pagos-registrados-descarga-columnas.ts` (fecha real, monto, método, referencia, nota, quién,
  registrado el). Sin ids.
- Tests `tests/components/PagosRegistradosTabla.test.tsx` y
  `tests/unit/descarga/pagos-registrados-descarga-columnas.test.ts`.
- **Depende de:** T C.1 · **Cubre:** R47, R48, R54
- **Hecho:** la guardia de columnas sensibles pasa sobre el módulo nuevo sin excepciones.

### [ ] T D.3 — Cablear en el desglose de la tienda
- `SaldosTiendasTable.tsx` pasa `acciones={…}` (la prop que la 171 dejó lista); el diálogo se
  abre desde ahí; tras registrar, `mutate(claveDesgloseTienda(tiendaId))` refresca **solo** esa
  tienda; la lista de comprobantes se monta dentro del desglose.
- Test `tests/integration/wallet-tiendas-pago.test.tsx`.
- **Depende de:** T D.1, T D.2 · **Cubre:** R4, R31, R32, R49, R51
- **Hecho:** con dos desgloses abiertos, pagar en uno **no** vuelve a consultar el otro; el
  importe «pagado a la tienda» sube y el saldo baja en el mismo monto; un rol sin permiso no ve
  el botón (R4) **y** la acción le responde `forbidden` (R1); los tests de la 171 siguen verdes
  sin editarlos (R32).

---

# TANDA E — Frontend: pagar a un mensajero (toca la aprobación)

### [ ] T E.1 — Se pregunta al aprobar
- En `CierresAdminModule`: tras `aprobarCierre` con `ok`, si `pendientePagoMensajero > 0` **y** el
  actor puede pagar, se abre el mismo diálogo, prefijado con el pendiente. «Ahora no» cierra sin
  persistir nada.
- Test `tests/components/CierresAdminPagoMensajero.test.tsx`.
- **Depende de:** T C.2, T D.1 · **Cubre:** R14, R15, R16
- **Hecho:** con «Ahora no», el cierre queda **aprobado** y no se llama a ninguna acción de pago;
  si la acción de pago falla, el cierre **sigue aprobado** y el mensaje lo dice; un cierre con
  pendiente 0 no abre el diálogo; los tests de la 158 (sub-modal de indemnizaciones) siguen
  verdes sin editarlos.

### [ ] T E.2 — Pagar después, desde el cierre aprobado
- Sección «Pago al mensajero» en el detalle de un cierre `aprobado`: pendiente, lista de
  comprobantes y botón de registrar. No aparece en cierres no aprobados ni con pendiente 0.
- **Depende de:** T E.1, T D.2 · **Cubre:** R17, R25, R26, R47
- **Hecho:** los cuatro estados de cierre se prueban; con pendiente 0 no hay botón.

### [ ] T E.3 [P] — La deuda se ve sin abrir nada
- Columna «pendiente de liquidar» con su `Badge` en el listado de cierres, alimentada por
  `pendientePagoMensajero` (nunca calculada en el cliente).
- **Depende de:** T C.2 · **Cubre:** R24
- **Hecho:** un cierre aprobado con deuda se distingue en la tabla; los cierres no aprobados no
  muestran nada; `CierresAdminModule.test.tsx` sigue verde.

---

# TANDA F — Lo que ven los beneficiarios

### [ ] F.1 [P] — El mensajero ve su pago (verificación, sin cambios de código)
- Test en `tests/integration/mis-pagos-page.test.tsx`: con un movimiento `liquidacion` sembrado,
  `/mis-pagos` lo muestra con su etiqueta y su cuenta por pagar baja.
- **Depende de:** T B.4 · **Cubre:** R52
- **Hecho:** el test pasa **sin** tocar código de `/mis-pagos`. Si hiciera falta tocarlo, es un
  hallazgo y se declara.

### [ ] F.2 — La tienda distingue el pago del cargo `[P5]`
- `/mi-wallet`: cabecera de tres importes reutilizando `derivarDesgloseTienda` y
  `CUBETA_POR_CATEGORIA` **por importación**, sin duplicar la clasificación.
- Test en `tests/integration/mi-wallet-page.test.tsx`.
- **Depende de:** T0.5, T D.3 · **Cubre:** R53
- **Hecho:** con un pago sembrado, «pagado» lo muestra y «cargos» **no** lo incluye; un test
  compara por identidad que la clasificación es la misma función que usa el desglose del maestro.

---

# TANDA G — Guardias y cierre

### [ ] G.1 — Censo de tablas
- Registrar las **dos** instancias nuevas de `PagosRegistradosTabla` y actualizar los totales
  duros **leyéndolos del código en ese momento**, no de este documento.
- **Depende de:** T D.3, T E.2 · **Cubre:** R55
- **Hecho:** se deja constancia en `progress/impl_172-liquidacion.md` de haber visto la guardia
  **fallar** antes de actualizar los totales.

### [ ] G.2 [P] — Barrido money-safe y de fuga de datos
- Test transversal: ningún archivo nuevo o modificado de la feature contiene `parseFloat`,
  `Number(` ni `.toFixed(` sobre montos en cliente; ningún DTO de la feature emite uuid.
- **Depende de:** T D.3, T E.3 · **Cubre:** R13, R54
- **Hecho:** el barrido pasa y falla si se introduce a mano un `Number(monto)`.

### [ ] G.3 — Verificación manual de la migración (up → down → up)
- Contra Postgres local, con evidencia pegada en `progress/impl_172-liquidacion.md`, incluyendo
  el intento de insertar a mano una fila incoherente (`pago_tienda` + `credito`) y su rechazo.
- **Depende de:** T A.1 · **Cubre:** R56, R57, R58, R61
- **Hecho:** salida real pegada. Es la única prueba de que el CHECK **actúa** y no solo está
  escrito: los tests de migración del repo son estáticos.

### [ ] G.4 — Cierre
- `./init.sh` verde; `progress/impl_172-liquidacion.md` con el mapa `R<n> → test` completo, el
  delta de archivos/tests contra el baseline, la constancia de los defaults aplicados de la
  Tanda 0 y el resultado de T A.0 contra producción.
- **Depende de:** todas · **Cubre:** trazabilidad de `CHECKPOINTS.md`
- **Hecho:** los 65 requisitos con test que existe, pasa y afirma lo que dice.

> **E2E: declarado INAPLICABLE** (decisión del humano: «no más e2e, pruebas básicas nada más»).
> `CHECKPOINTS.md` lo pediría por ser un flujo de pagos; el riesgo se cubre con T B.5 (cadena de
> servidor completa con la semántica real de los constraints) y T D.3 / T E.1 (las dos pantallas
> con las acciones mockeadas). Ver `design.md §12`.

---

## Trazabilidad `R<n> → test`

| R | Test |
| --- | --- |
| R1 | `tests/unit/services/liquidacion-service.test.ts` — rol sin acceso total → `forbidden` sin tocar datos |
| R2 | idem — `adminTienda` pidiendo **su propia** tienda → `forbidden` (contraprueba) |
| R3 | `tests/unit/actions/liquidacion-action.test.ts` — sin sesión → `unauthenticated` sin llamar al servicio |
| R4 | `tests/integration/wallet-tiendas-pago.test.tsx` — sin permiso no se renderiza el control |
| R5 | `tests/unit/services/liquidacion-service.test.ts` — el rol se comprueba antes de leer el beneficiario del input |
| R6 | `tests/unit/repositories/liquidacion-pago-repository.test.ts` — las 10 columnas del documento |
| R7 | `tests/unit/types/liquidacion-schemas.test.ts` — método fuera del catálogo → `validation_error` |
| R8 | `tests/unit/repositories/liquidacion-pago-repository.test.ts` — fecha real e instante de registro conviven y difieren |
| R9 | `tests/unit/types/liquidacion-schemas.test.ts` — fecha de mañana (hora CR) rechazada |
| R10 | idem — 0, negativo, 3 decimales, coma y 11 dígitos rechazados |
| R11 | idem — SINPE/transferencia sin referencia rechazado; efectivo sin referencia aceptado |
| R12 | idem — nota por encima del tope rechazada |
| R13 | `tests/components/RegistrarPagoDialog.test.tsx` + barrido de G.2 — cero aritmética de dinero en cliente |
| R14 | `tests/components/CierresAdminPagoMensajero.test.tsx` — tras aprobar con pendiente > 0 se ofrece el pago |
| R15 | idem — «Ahora no» y fallo del pago dejan el cierre aprobado |
| R16 | idem + `tests/unit/services/cierres-admin-pendiente.test.ts` — aprobar no exige pago ni crea estado nuevo |
| R17 | `tests/components/CierresAdminPagoMensajero.test.tsx` — el detalle de un cierre aprobado ofrece registrar |
| R18 | `tests/unit/services/liquidacion-service.test.ts` — `solicitado`/`vencido`/`rechazado` → `cierre_no_aprobado`, sin escribir |
| R19 | idem — pago a mensajero sin cierre → rechazado en el borde |
| R20 | `tests/unit/utils/pendiente-cierre.test.ts` + `cierres-admin-pendiente.test.ts` |
| R21 | `tests/unit/services/liquidacion-service.test.ts` — monto menor al pendiente aceptado |
| R22 | idem — el pendiente baja exactamente en el monto y el resto sigue pendiente |
| R23 | idem — monto > pendiente → `excede`, sin escribir `[P1]` |
| R24 | `tests/components/CierresAdminModule.test.tsx` (ampliado) — marca de pendiente de liquidar |
| R25 | `tests/components/CierresAdminPagoMensajero.test.tsx` — con pendiente 0 no hay botón |
| R26 | `tests/unit/services/cierres-admin-pendiente.test.ts` — cierre no aprobado → `null` |
| R27 | `tests/unit/services/liquidacion-service.test.ts` — pago a tienda sin cierre, contra saldo acumulado |
| R28 | `tests/components/RegistrarPagoDialog.test.tsx` — monto prefijado al disponible y editable a la baja |
| R29 | `tests/unit/services/liquidacion-service.test.ts` — monto > saldo → `excede` `[P1]` |
| R30 | idem — saldo 0 o negativo → `sin_saldo` con mensaje `[P1]` |
| R31 | `tests/integration/wallet-tiendas-pago.test.tsx` — refresco dirigido a una sola tienda |
| R32 | suite de la 171 sin editar (`wallet-tiendas-desglose.test.tsx`, `wallet-tiendas-page.test.tsx`) |
| R33 | `tests/unit/services/liquidacion-service.test.ts` — movimiento `pago`/`liquidacion` |
| R34 | idem — movimiento `debito`/`pago_tienda` |
| R35 | idem — `fechaMovimiento` = medianoche UTC de la fecha real, no la de registro |
| R36 | idem — `origenTipo`/`origenId` apuntan al pago creado |
| R37 | idem — si el movimiento falla, el documento no queda |
| R38 | idem — el repositorio de la caja principal no recibe ninguna llamada `[P2]` |
| R39 | idem — solo `createMany`; ningún `update`/`delete` sobre los libros |
| R40 | idem — ningún snapshot del cierre se escribe |
| R41 | `tests/integration/db/liquidacion-idempotencia.test.ts` — misma solicitud dos veces, un pago |
| R42 | idem — sin consulta previa por clave; la barrera es la restricción |
| R43 | idem — dos pagos legítimos idénticos son dos pagos |
| R44 | idem — carrera de dos registros no salda de más `[P1]` |
| R45 | idem + `RegistrarPagoDialog.test.tsx` — reintento devuelve `ya_registrado` |
| R46 | idem — reintentar la aprobación no duplica movimientos |
| R47 | `tests/components/PagosRegistradosTabla.test.tsx` — los 7 datos del comprobante |
| R48 | `tests/integration/wallet-tiendas-pago.test.tsx` — la lista aparece en el desglose de la tienda |
| R49 | idem — el movimiento del pago se distingue por su concepto |
| R50 | `tests/unit/repositories/pago-mensajero-filtro-cierre.test.ts` — las dos mitades |
| R51 | `tests/integration/wallet-tiendas-pago.test.tsx` — «pagado» sube y saldo baja igual |
| R52 | `tests/integration/mis-pagos-page.test.tsx` — el mensajero ve el pago |
| R53 | `tests/integration/mi-wallet-page.test.tsx` — «pagado» separado de «cargos» `[P5]` |
| R54 | `tests/unit/descarga/pagos-registrados-descarga-columnas.test.ts` + guardia de columnas sensibles |
| R55 | `tests/unit/descarga/cobertura-tablas.guardia.test.ts` — censo con las dos instancias |
| R56 | `tests/integration/db/liquidacion-migration.test.ts` + G.3 (rechazo real de una fila incoherente) |
| R57 | idem |
| R58 | `tests/integration/db/liquidacion-migration.test.ts` — un concepto sin clasificar no casa ninguna rama |
| R59 | evidencia de T A.0 en `progress/impl_172-liquidacion.md` (verificación previa contra cada base) |
| R60 | `tests/integration/db/liquidacion-migration.test.ts` — RLS sin políticas |
| R61 | idem — `down.sql` revierte tabla y CHECK, sin tocar enums; + round-trip de G.3 |
| R62 | `tests/unit/actions/liquidacion-action.test.ts` — no se exporta ninguna acción de anular/editar `[P4]` |
| R63 | revisión de alcance: ninguna tabla, estado ni pantalla de «corte por tienda» en el diff |
| R64 | suite de la 111 (`reglas-bloqueos-cierre`, `cierre-vencido-modelo`) sin editar |
| R65 | suite de analítica (`lib/analytics`) y de la caja (`wallet*`) sin editar; R38 lo cubre por el lado del código |
