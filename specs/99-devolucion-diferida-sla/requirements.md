# Feature 99 — Devolución diferida + cron SLA (liberar / rechazar) con ingreso de bodega del rechazo

> Requisitos en notación EARS. Cada `R<n>` es verificable con un test.
> Money-critical marcado con **[💰]**.
> El QUÉ vive aquí; el CÓMO (Option A del dinero, anclaje derivado, cron, migración)
> vive en `design.md`. Las decisiones abiertas del gate F1.4 están al final.

## Contexto de una línea

Hoy la feature 47 re-transiciona la orden `devuelta` INMEDIATAMENTE en la misma tx de
`gestionar` (reintento a bodega, o escalado a `rechazada`). Esta feature DIFIERE esa
transición: la orden REPOSA en `devuelta` anclando una ventana SLA por causa, y un CRON la
procesa al vencer.

---

## Comportamiento de la devolución (gestionar)

**R1** — CUANDO un mensajero registra una gestión con resultado `devuelta`, el sistema DEBE
transicionar la orden al estado `devuelta` y DEBE dejarla en ese estado, SIN aplicar ninguna
transición de seguimiento inmediata (ni reintento a bodega ni escalado a `rechazada`).

**R2** — CUANDO se registra una devolución, el sistema DEBE contabilizarla como un intento,
registrando la transición a `devuelta` en el historial append-only vía el choke point
(`appendCambioEstado`, `origen_tipo = gestion`), en la misma transacción que crea la gestión.

**R3** — El sistema DEBE derivar el contador de intentos del historial (conteo de transiciones
VIGENTES cuyo destino es `devuelta`, `OrdenHistorialService.contarIntentos`), SIN materializarlo
en una columna nueva.

**R4** — CUANDO se registra una devolución, el sistema DEBE persistir su causa
(`gestion_orden.causa_devolucion` ∈ {`not_found`, `wrong_number`, `wrong_address`}, feature 73)
en el mismo INSERT de la gestión.

## Anclaje de la ventana SLA

**R5** — El sistema DEBE derivar la ventana SLA de cada orden en `devuelta` a partir de la
ÚLTIMA gestión `devuelta` VIGENTE de esa orden (`anulada_at IS NULL`): su `causa_devolucion` y
su `created_at` como instante de anclaje, sin columna nueva de tipo `devuelta_at`.

**R6** — El sistema DEBE evaluar el vencimiento como una duración ROLLING desde el anclaje:
24 horas para `not_found`; 5 días (rechazo al día 6) para `wrong_number` / `wrong_address`;
independiente de la cadencia con la que corra el cron.

## /novedades reconciliado al estado real

**R7** — MIENTRAS una orden esté en estado `devuelta`, el sistema DEBE incluirla en /novedades
de su tienda (predicado anclado a `estatus = devuelta` + tienda del actor + no borrada).

**R8** — CUANDO una orden sale de `devuelta` (por liberación del cron, escalado del cron o
resolución manual de la feature 100), el sistema DEBE retirarla de /novedades sin conteo doble.

**R9** — El sistema DEBE seguir mostrando en /novedades la causa de la última gestión `devuelta`
vigente de cada orden listada (reuso de `findCausasDevueltaVigentes`).

## Cron SLA — controlador

**R10** — CUANDO se invoca el endpoint del cron SIN header `Authorization`, o con un Bearer
token distinto de `CRON_SECRET`, o con `CRON_SECRET` no configurado, el sistema DEBE responder
401 ANTES de cualquier efecto (ni siquiera construye el servicio).

**R11** — El sistema NUNCA DEBE registrar en logs el secreto ni PII de las órdenes; el cron solo
emite conteos agregados.

**R12** — CUANDO el cron se ejecuta autorizado, el sistema DEBE responder 200 con conteos
agregados: `evaluadas`, `liberadas`, `escaladas`, `omitidas` (JSON sin PII).

**R13** — El sistema DEBE calcular el vencimiento con un reloj inyectable (por defecto `now()`),
para pruebas deterministas sin depender del reloj real.

## Cron SLA — regla not_found (24h)

**R14** — MIENTRAS una orden en `devuelta` con causa `not_found` no haya cumplido 24h desde su
anclaje, el sistema DEBE dejarla en `devuelta` (el cron la cuenta como evaluada pero NO actúa).

**R15** — CUANDO el cron procesa una orden en `devuelta` con causa `not_found` cuya ventana de
24h venció Y su conteo de intentos derivado es MENOR que el umbral (`MIN_INTENTOS_ENTREGA`,
default 3), el sistema DEBE transicionarla a la bodega responsable derivada de su zona
(`en_bodega` para zona central, `en_bodega_satelite` para satélite) y DEBE limpiar el mensajero
asignado (nuevo intento; reinicia el flujo).

**R16** — CUANDO el cron procesa una orden en `devuelta` con causa `not_found` cuya ventana de
24h venció Y su conteo de intentos derivado es MAYOR O IGUAL al umbral, el sistema DEBE
transicionarla a `rechazada`.

## Cron SLA — regla wrong_number / wrong_address (5 días)

**R17** — CUANDO el cron procesa una orden en `devuelta` con causa `wrong_number` o
`wrong_address` cuya ventana de 5 días venció, el sistema DEBE transicionarla DIRECTAMENTE a
`rechazada`, SIN pasar por el bucle de reintentos, independientemente del conteo de intentos.

## Trazabilidad de las transiciones del cron

**R18** — El sistema DEBE registrar TODA transición del cron mediante el choke point del
historial (`appendCambioEstado`) en la MISMA transacción del cambio de estado; NUNCA DEBE
escribir `orden.estatus_id` por fuera del choke point.

**R19** — El sistema DEBE clasificar la liberación por SLA con un `origen_tipo` propio
(`liberacion_devuelta_sla`) y el escalado por SLA con un `origen_tipo` propio
(`escalado_devuelta_sla`), ambos con actor `NULL` (sistema/cron).

## Dinero — ingreso de bodega por el rechazo del cron **[💰]**

**R20 [💰]** — CUANDO el cron escala una orden a `rechazada` (por R16 o R17), el sistema DEBE
registrar el ingreso de bodega por rechazo (feature 56, `cobroRechazado`) de forma consistente
con el mecanismo de snapshot del cierre, de modo que ese ingreso sea capturable por el cierre
y la wallet SIN descuadrar cierres ya cerrados/aprobados.

**R21 [💰]** — El sistema NO DEBE registrar el ingreso de bodega por rechazo más de una vez por
orden escalada (idempotencia del registro monetario aún si el cron se reejecuta).

**R22 [💰]** — El sistema DEBE atribuir el registro monetario del rechazo por SLA al mensajero de
la última gestión `devuelta` vigente de la orden, para que el ingreso se enrute a la bodega
responsable por la vía de cierre/wallet ya existente (feature 56/42/69), sin lógica monetaria
nueva.

**R23 [💰]** — El sistema DEBE calcular ese ingreso con la misma aritmética money-safe existente
(`Prisma.Decimal`, salida escala 2); NO DEBE introducir `number`/`parseFloat` sobre montos.

## Idempotencia, concurrencia y resiliencia

**R24** — CUANDO el cron se reejecuta sobre una orden que ya salió de `devuelta` (por otra
corrida, por escalado previo o por resolución manual), el sistema NO DEBE volver a
transicionarla ni duplicar historial/gestión (guarda transaccional por `estatus_id = devuelta`).

**R25** — SI dos corridas del cron se solapan, ENTONCES el sistema DEBE garantizar que a lo sumo
una transicione cada orden (el UPDATE guardado por estado hace que la perdedora afecte 0 filas
y la cuente como omitida).

**R26** — SI el procesamiento de una orden falla, ENTONCES el sistema DEBE continuar con las
demás y contabilizarla como `omitida`; una falla por orden NO DEBE abortar la corrida.

**R27** — SI el catálogo de estados destino no está sembrado, ENTONCES el cron NO DEBE actuar y
DEBE devolver conteos en cero con un aviso agregado (sin crash, patrón feature 46).

**R28** — SI una orden en `devuelta` no tiene causa en su última gestión vigente (dato anterior a
feature 73, o anomalía), ENTONCES el cron DEBE omitirla sin adivinar ventana y contabilizarla
como `omitida`.

## Reconciliación de la feature 47 (no aflojar)

**R29** — El sistema DEBE relocalizar la lógica de reintento-vs-escalado de la feature 47 al cron
SIN eliminar la capacidad: `gestionar` deja de emitir la transición de seguimiento inmediata, y
la decisión (reintento a bodega / escalado a `rechazada`) vive en el servicio del cron.

**R30** — Los tests de la feature 47 que afirmaban la transición inmediata DEBEN INVERTIRSE al
sentido nuevo (tras devolver, la orden queda en `devuelta`), NO relajarse; las aserciones de
reintento/escalado DEBEN migrar a los tests del servicio del cron.

---

## Trazabilidad R → test

Cada requisito se mapea a un test concreto en `design.md §Trazabilidad` y en `tasks.md`
(columna "done"). Un `R<n>` sin test es un fallo de la feature (CLAUDE.md regla 4).

---

## Preguntas abiertas — Gate F1.4 (cada una con recomendación; **[💰]** = money-critical)

> Estas 8 preguntas deben resolverse con el humano ANTES de implementar. La recomendación es la
> opción por defecto verificada contra el código; el humano confirma o corrige.

**Q1 [💰] — Registro del ingreso de bodega del rechazo por cron.**
Hallazgo VERIFICADO en el código: el ingreso de bodega por rechazo se computa POR GESTIÓN a
partir de `gestion_orden.resultado === "rechazada"` (`ingresoBodegaPorResultado`,
`derivarIngresoBodega`) y se snapshotea en `gestion_orden.ingreso_bodega_rechazo` al crear el
cierre (`CierreDiaRepository.crearCierre`); la wallet lo realiza al aprobar el cierre. **Por
tanto HOY la feature 47, que escala `devuelta → rechazada` con una gestión cuyo `resultado` es
`devuelta`, NO registra ningún ingreso de bodega (queda en 0.00): el snapshot existente NO lo
cubre.** Lo mismo aplicaría al cron si no hace nada.
_Recomendación:_ **Option A** — el cron crea, en la MISMA tx del escalado, una gestión sintética
con `resultado = rechazada` (actor sistema, `cierre_id NULL`, sin evidencia, motivo "escalado
SLA <causa>"), atribuida al mensajero de la última gestión `devuelta` vigente. Reutiliza BYTE A
BYTE el snapshot de la feature 56 y el feed de wallet de la 42/69 (ambos ya se anclan a
`resultado`), sin código monetario nuevo y sin descuadrar cierres cerrados (la gestión nueva es
`cierre_id NULL` → entra al PRÓXIMO cierre). Descartadas B (escribir la columna sobre la gestión
`devuelta` original: suele estar ya cerrada → descuadre) y C (columna de dinero nueva en `orden`
+ vía de wallet aparte: superficie nueva; la feature 102 dice "reusa el snapshot de 56", no una
vía nueva).
_Efecto colateral a confirmar por el humano:_ con Option A la orden escalada acumula el ingreso
por rechazo (bodega + ordenex) ADEMÁS del flete_devuelto que ya generaron sus gestiones
`devuelta`. Es exactamente lo que ocurre con un rechazo directo del mensajero; hay que confirmar
que ese es el resultado querido y no solo el ingreso de bodega aislado.

**Q2 — Anclaje de la ventana: columna nueva vs derivar del historial.**
_Recomendación:_ **derivar** de la última gestión `devuelta` vigente (`created_at` + `causa`),
que ya expone `findCausasDevueltaVigentes` y es append-only (feature 49/67). Evita columna,
backfill y desincronización causa/timestamp. Reduce la migración a solo el enum `origen_tipo`.
Descartada la columna `orden.devuelta_at` (dato redundante que hay que mantener y backfillear).

**Q3 — Frecuencia del cron y cómo se cuenta 24h / 5 días.**
_Recomendación:_ cron HORARIO (`0 * * * *`) con ventanas ROLLING en milisegundos desde el
anclaje (24h / 120h), reloj inyectable. Honra "24h"/"5 días" con imprecisión ≤ 1h. Descartado el
diario 00:00 CR (como corte-diario): simple pero puede retrasar la acción hasta ~24h y desvirtúa
la ventana de 24h. La idempotencia por estado hace seguro correr horario.

**Q4 — not_found, 3.º intento: mecánica y momento del conteo.**
_Recomendación:_ el intento se cuenta AL DEVOLVER (transición `devuelta`, R2). El cron, al
procesar, lee `contarIntentos(ordenId)` que YA incluye la devolución vigente (la orden reposa en
`devuelta`): `intentos < 3` → libera (nuevo intento); `intentos >= 3` → `rechazada`. Es la misma
regla de la 47, pero SIN el `+1` (en la 47 se decidía pre-tx; aquí la devolución ya está
committeada). Confirmar esta semántica del conteo.

**Q5 — wrong_number / wrong_address: rechazo directo al día 6.**
_Recomendación:_ confirmar rechazo directo a los 5 días (acción el día 6), sin bucle de
reintentos, sin importar el conteo de intentos (R17).

**Q6 — Reconciliación de la feature 47: eliminar o conservar.**
_Recomendación:_ RELOCALIZAR (R29): `gestionar` deja de pasar `seguimiento` para `devuelta`;
retirar `resolverSeguimientoDevuelta` de `MisAsignacionesService` y el parámetro `seguimiento` de
`crearGestionYTransicionar` (código muerto tras la relocalización); mover la derivación de bodega
responsable al servicio del cron. Invertir los tests de la 47 (no aflojarlos, R30).

**Q7 — Reconciliación de /novedades (89): predicado.**
_Recomendación:_ anclar el predicado a `estatus = devuelta` (+ tienda + no borrada), reemplazando
"gestión devuelta vigente + no cerrada". Bajo la 99 la orden SÍ reposa en `devuelta`, así que el
anclaje al estado real evita el doble conteo y saca la orden al liberarse/escalarse. Los tests de
la 89 que afirmaban que un reintento en `en_bodega` sigue como novedad deben invertirse.

**Q8 — Idempotencia + concurrencia del cron.**
_Recomendación:_ guarda `updateMany` por `estatus_id = devuelta` + `deleted_at IS NULL` (patrón
feature 46/41); la gestión sintética de rechazo se crea SOLO dentro del `if (count > 0)` de la
misma tx. Reejecución / solape → 0 filas → omitida, sin doble efecto.
