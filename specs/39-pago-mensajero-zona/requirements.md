# Feature 39 — Pago al mensajero por zona en el cierre — requirements.md

## F1.4 APROBADA 2026-07-12 (SUPERSEDE "Preguntas abiertas")

El humano cerro la puerta F1.4 el 2026-07-12. Las decisiones de abajo son firmes y
DOMINAN sobre la seccion "Preguntas abiertas" del final (que se conserva solo como
registro historico del razonamiento; ya NO esta abierta).

1. **Snapshot (no derivado).** El pago al mensajero se CONGELA en el cierre al
   solicitar. Migracion ADITIVA con columnas de snapshot (`gestion_orden.pago_mensajero`
   NULL, `cierre_dia.total_pago_mensajero` DEFAULT 0, `cierre_bodega.total_pago_mensajero`
   DEFAULT 0) + `down.sql`. La vista EN VIVO del mensajero deriva solo para preview; el
   resto lee el snapshot.
2. **Solo `entregada` paga al mensajero.** El pago al MENSAJERO = suma de
   `cobroEntregado` de las gestiones `entregada`. Las gestiones `rechazada`,
   `reprogramada` y `devuelta` pagan **0.00 al mensajero**. (CAMBIO: la version previa
   pagaba `cobroRechazado` por `rechazada` al mensajero; ESO YA NO APLICA.)
3. **`cobroRechazado` FUERA DE ALCANCE de la 39.** El `cobroRechazado` (pago por
   rechazo) NO va al mensajero: es un INGRESO DE BODEGA (satelite o central) y se modela
   en la **feature 56 ("ingreso de bodega por rechazos (cobroRechazado)")**, registrada
   como `pending`, `depends_on: 39`. La 39 NO disena ese ingreso.
4. **Resolucion de tarifa (sin cambio).** Por (`usuario.zonaId` del mensajero,
   `usuario.vehiculoId`) con fallback a la tarifa por defecto de la zona
   (`vehiculoId IS NULL`) en `TarifaZonaMensajero`. El pago sale de la zona del MENSAJERO.
5. **Gap de datos (sin cambio).** Si la zona no tiene tarifa capturada, el pago se
   resuelve como **0.00 y NO bloquea** el cierre; se muestra un aviso en la vista admin.
6. **Niveles del snapshot y UI (sin cambio).** Snapshot en los 3 niveles; exponer el
   pago al mensajero en los DTOs de detalle (37/38/40) y totalizar en las pantallas
   EXISTENTES (sin pantallas nuevas).

## Contexto y alcance

Cada orden que llega a un cierre del dia debe exponer el MONTO A PAGAR AL MENSAJERO
segun la zona del mensajero y el resultado de su gestion (F1.4: solo `entregada` paga
`cobroEntregado`; el resto paga 0.00), y los modulos de cierre deben TOTALIZAR ese
pago. Es un concepto DISTINTO del dinero
RECIBIDO por metodo de pago (features 37/38/40, columnas `total_efectivo/simpe/...`)
y de lo que se COBRA al cliente/tienda (features 18/42, modelo `Tarifa`).

Hallazgo de modelo (verificado en `db/schema.prisma`, no en la descripcion vieja):

- El pago al mensajero YA NO vive en `zona` (los campos `zona.pagoEntrega`/
  `pagoRechazo` fueron ELIMINADOS por el refactor #40, reconciliado por la 54).
  Vive en `model TarifaZonaMensajero`: `cobroEntregado` (pago por ENTREGA, lo UNICO
  que la 39 paga al mensajero), `cobroRechazado` (ingreso de bodega por rechazo, FUERA
  DE ALCANCE de la 39 -> feature 56), `zonaId` (obligatoria), `vehiculoId`
  (nullable = tarifa por DEFECTO de la zona). Indice unico `(zonaId, vehiculoId)`
  con NULLS NOT DISTINCT -> a lo sumo una tarifa por defecto por zona.
- `Usuario.vehiculoId` EXISTE (schema linea 94) y `Usuario.zonaId` EXISTE (linea 97).
- `TarifaZonaMensajero` NO esta sembrada por `scripts/seed-zonas.ts` (solo crea zonas
  con `nombre`); se captura desde la UI de configuracion (`ZonaForm`, feature 55, que
  SI tiene inputs `cobroEntregado`/`cobroRechazado`/`vehiculo`). En un entorno recien
  sembrado la tabla esta VACIA hasta que el maestro edite cada zona (gap de runtime,
  como paso con `esCentral`).
- NO existe un resolver que lea `TarifaZonaMensajero` por (zona, vehiculo) con
  fallback: hay que crearlo. Hoy solo se escribe/lee dentro de `ZonaRepository`.

Fuera de alcance (otras features):
- El **`cobroRechazado` (ingreso de bodega por rechazos)** -> **feature 56**
  (`depends_on: 39`). La 39 NO le paga `cobroRechazado` al mensajero NI modela el
  ingreso de la bodega; solo deja el campo `cobroRechazado` intacto en la tarifa para
  que la 56 lo consuma.
- El PAGO EFECTIVO / cuentas por pagar y de donde sale el dinero (feature 44).
- Los COBROS al cliente/tienda (18/42); bloqueos y vencidos (41).

La 39 solo CALCULA y MUESTRA lo que se le debe pagar al mensajero (solo por entregas);
no ejecuta pago.

## Requisitos (EARS)

### Resolucion de la tarifa de pago

**R1** — CUANDO el sistema deba resolver el pago al mensajero de una gestion, el
sistema DEBE buscar en `tarifa_zona_mensajero` la tarifa cuya `zona_id` sea la ZONA
DEL MENSAJERO (`usuario.zona_id`) y cuyo `vehiculo_id` sea el VEHICULO DEL MENSAJERO
(`usuario.vehiculo_id`).

**R2** — SI no existe una tarifa para (zona del mensajero, vehiculo del mensajero),
ENTONCES el sistema DEBE usar como fallback la tarifa POR DEFECTO de esa zona
(`vehiculo_id IS NULL`).

**R3** — SI el mensajero no tiene vehiculo asignado (`usuario.vehiculo_id IS NULL`),
ENTONCES el sistema DEBE resolver directamente la tarifa por defecto de la zona
(`vehiculo_id IS NULL`).

**R4** — El pago al mensajero DEBE calcularse a partir de la zona del MENSAJERO
(`usuario.zona_id`), NUNCA de la zona de la orden (`orden.zona_id`).

### Mapeo resultado -> monto

**R5** — CUANDO el resultado de la gestion es `entregada`, el sistema DEBE fijar el
pago al mensajero en `cobroEntregado` de la tarifa resuelta.

**R6** — CUANDO el resultado de la gestion es `rechazada`, el sistema DEBE fijar el
pago al mensajero en `0.00` (F1.4: solo `entregada` paga al mensajero). El
`cobroRechazado` de la tarifa NO se paga al mensajero: es un ingreso de bodega modelado
en la feature 56 (fuera del alcance de la 39).

**R7** — CUANDO el resultado de la gestion es `reprogramada` o `devuelta`, el sistema
DEBE fijar el pago al mensajero en `0.00`.

**R7b** — El pago al mensajero DEBE ser `0.00` para TODO resultado distinto de
`entregada`; el sistema NUNCA DEBE pagar `cobroRechazado` al mensajero.

**R8** — SI no existe ninguna tarifa aplicable para la zona (ni especifica por
vehiculo ni por defecto), ENTONCES el sistema DEBE fijar el pago en `0.00` y NO DEBE
bloquear ni abortar el cierre (manejo seguro del gap de datos).

**R9** — El sistema DEBE calcular todos los montos de pago con aritmetica decimal
exacta (Prisma.Decimal) y exponerlos serializados como STRING con dos decimales; NUNCA
con `number`/`parseFloat`.

### Vista del cierre del mensajero (feature 37, en vivo)

**R10** — MIENTRAS el mensajero visualiza su cierre del dia (gestiones aun sin cerrar,
`cierre_id IS NULL`), el sistema DEBE exponer, por cada orden, el pago al mensajero
DERIVADO en ese instante (resolviendo la tarifa vigente) segun R1-R8.

**R11** — MIENTRAS el mensajero visualiza su cierre del dia, el sistema DEBE exponer
el TOTAL a pagar al mensajero (suma de los pagos por orden), separado de los totales
de dinero recibido por metodo de pago.

### Snapshot al solicitar el cierre (money-critical)

**R12** — CUANDO el mensajero solicita el cierre (`solicitarCierre`), el sistema DEBE
CONGELAR (snapshot) el pago al mensajero de cada gestion incluida, resolviendo la
tarifa vigente en ese instante segun R1-R8.

**R13** — CUANDO el mensajero solicita el cierre, el sistema DEBE CONGELAR el total a
pagar al mensajero del cierre (suma de los pagos por gestion snapshoteados).

**R14** — El snapshot del pago (por gestion y total del cierre) DEBE persistirse en la
misma transaccion atomica que crea el cierre y vincula sus gestiones (no debe existir
un cierre con gestiones vinculadas pero sin su pago snapshoteado, ni viceversa).

**R15** — SI la tarifa cambia despues de solicitado el cierre, ENTONCES el pago
snapshoteado del cierre NO DEBE cambiar (el numero congelado es la fuente de verdad
del cierre).

### Vista del admin de cierres (feature 38)

**R16** — CUANDO un administrador (maestro/adminSatelite) ve el detalle de un cierre,
el sistema DEBE exponer, por cada orden del cierre, el pago al mensajero SNAPSHOTEADO
(no recalculado).

**R17** — CUANDO un administrador ve un cierre (en la cola, el historico o el detalle),
el sistema DEBE exponer el TOTAL snapshoteado a pagar al mensajero de ese cierre,
separado de los totales de dinero recibido.

### Agregacion en el cierre de bodega (feature 40)

**R18** — CUANDO el adminSatelite consolida los cierres de sus mensajeros y visualiza
la consolidacion, el sistema DEBE exponer el TOTAL agregado a pagar a mensajeros
(suma de los totales snapshoteados de los `cierre_dia` consolidables de su zona).

**R19** — CUANDO el adminSatelite solicita el cierre de bodega, el sistema DEBE
CONGELAR el total agregado a pagar a mensajeros en el `cierre_bodega`, en la misma
transaccion que lo crea (money-critical, patron R14).

**R20** — CUANDO el maestro ve el detalle de un cierre de bodega, el sistema DEBE
exponer el total a pagar a mensajeros de cada `cierre_dia` incluido y el total
agregado del cierre de bodega, ambos snapshoteados.

### Datos e integridad

**R21** — El pago al mensajero DEBE tratarse como un concepto INDEPENDIENTE del dinero
recibido: agregarlo NUNCA debe alterar los valores de `total_efectivo`, `total_simpe`,
`total_transferencia` ni `total_general` existentes (features 37/40).

**R22** — La persistencia del snapshot de pago DEBE introducirse mediante una migracion
ADITIVA (nuevas columnas nullable o con default) con su `down.sql` reversible; los
cierres ya existentes anteriores a la migracion DEBEN quedar con pago `0.00` sin
romper su lectura.

**R23** — El sistema NO DEBE exponer, por ninguna via (DTO/serializacion), un pago al
mensajero como `number` ni con perdida de precision; siempre STRING con dos decimales.

## Trazabilidad R -> test

| Req | Test (archivo / caso) |
| --- | --- |
| R1  | `tests/unit/repositories/tarifa-zona-mensajero-repository.test.ts` — resuelve tarifa por (zona, vehiculo) exacto |
| R2  | idem — fallback a tarifa por defecto (vehiculo_id NULL) cuando no hay especifica |
| R3  | idem — mensajero sin vehiculo resuelve la tarifa por defecto |
| R4  | `tests/unit/services/pago-mensajero-resolver.test.ts` — usa zona del mensajero, no de la orden |
| R5  | `tests/unit/services/pago-mensajero-resolver.test.ts` — entregada -> cobroEntregado |
| R6  | idem — rechazada -> 0.00 (NUNCA cobroRechazado al mensajero) |
| R7  | idem — reprogramada/devuelta -> 0.00 |
| R7b | idem — todo resultado != entregada -> 0.00 (incl. tarifa con cobroRechazado > 0) |
| R8  | idem — sin tarifa aplicable -> 0.00 sin lanzar |
| R9  | idem — montos Decimal exactos, salida STRING 2 decimales |
| R10 | `tests/unit/services/cierre-dia-service.test.ts` — listarCierreDia expone pago derivado por orden |
| R11 | idem — expone totalPagoMensajero separado de totales |
| R12 | `tests/unit/services/cierre-dia-service.test.ts` — solicitarCierre snapshotea pago por gestion |
| R13 | idem — snapshotea total del cierre |
| R14 | `tests/unit/repositories/cierre-dia-repository.test.ts` — crearCierre persiste pago + total en una tx |
| R15 | `tests/unit/services/cierre-dia-service.test.ts` — cambio de tarifa post-cierre no altera snapshot leido |
| R16 | `tests/unit/services/cierres-admin-service.test.ts` — detalle expone pago snapshot por orden |
| R17 | idem — resumen/detalle expone totalPagoMensajero snapshot |
| R18 | `tests/unit/services/cierre-bodega-service.test.ts` — listarConsolidacion expone total agregado |
| R19 | `tests/unit/services/cierre-bodega-service.test.ts` — solicitarCierreBodega snapshotea total agregado |
| R20 | `tests/unit/services/cierres-bodega-admin-service.test.ts` — detalle expone pago por cierre_dia + agregado |
| R21 | `tests/unit/services/cierre-dia-service.test.ts` — totales de dinero recibido intactos |
| R22 | `tests/integration/db/pago-mensajero-migration.test.ts` — round-trip migracion + cierres previos = 0.00 |
| R23 | `tests/unit/*` transversal — asserts de tipo STRING en DTOs de pago |

## Preguntas abiertas (RESUELTAS por F1.4 2026-07-12 — registro historico)

> Esta seccion ya NO esta abierta. Se conserva el razonamiento; las decisiones firmes
> estan en el bloque "F1.4 APROBADA" al inicio. Donde difieran, MANDA el bloque inicial
> (en particular Q4: F1.4 decidio que SOLO `entregada` paga al mensajero).

**Q1 (LA MAS IMPORTANTE, money-critical) — Snapshot vs derivado.**
Recomendacion: **SNAPSHOT** el pago (por gestion + total en `cierre_dia`, agregado en
`cierre_bodega`) al momento de solicitar el cierre, y DERIVAR solo en la vista EN VIVO
del mensajero antes de cerrar (preview). Justificacion: los totales de dinero de
37/40 ya se congelan al solicitar; el pago es dinero que la empresa DEBE al mensajero
y `tarifa_zona_mensajero` es editable (feature 55) -> derivar on-the-fly haria que el
monto de un cierre ya aprobado cambie retroactivamente si el maestro edita una tarifa,
rompiendo la consistencia contable y la conciliacion con la feature 44 (cuentas por
pagar). Alternativa descartada: DERIVAR siempre (sin migracion, mas simple) — se
descarta por el riesgo money-critical de numeros de cierre mutables.

**Q2 — Nivel del snapshot.**
Recomendacion: snapshot en TRES niveles coherente con 37/40:
(a) `gestion_orden.pago_mensajero` (por orden, para el detalle);
(b) `cierre_dia.total_pago_mensajero` (total del cierre del mensajero);
(c) `cierre_bodega.total_pago_mensajero` (agregado de bodega).
Alternativa descartada: solo el total en `cierre_dia` (sin columna por gestion) — se
descarta porque el detalle por orden tendria que RE-derivarse, reintroduciendo la
mutabilidad que Q1 evita.

**Q3 — Resolucion de tarifa (zona + vehiculo).**
Confirmado: `usuario.vehiculo_id` EXISTE. Recomendacion: resolver por (zona del
mensajero, su vehiculo) con fallback a la tarifa por defecto de la zona
(`vehiculo_id IS NULL`), determinista por el indice unico NULLS NOT DISTINCT.

**Q4 — Que resultados pagan. [RESUELTA por F1.4]**
DECIDIDO: SOLO `entregada` paga al mensajero (`cobroEntregado`). `rechazada`,
`reprogramada` y `devuelta` pagan `0.00` al mensajero. El `cobroRechazado` NO se paga
al mensajero: es ingreso de bodega -> feature 56 (`depends_on: 39`). (Recomendacion
previa que pagaba `cobroRechazado` por `rechazada` al mensajero: DESCARTADA por F1.4.)

**Q5 — Gap de datos (tarifa faltante).**
Recomendacion: pago `0.00` NO bloqueante (R8), para no impedir un cierre por
configuracion faltante (mismo espiritu que el fallback de `esCentral`). Nota: la
captura de tarifas existe en `ZonaForm` (feature 55) pero NO hay seed de
`tarifa_zona_mensajero`; conviene evidenciar en la vista admin cuando un pago resolvio
a 0 por falta de tarifa (aviso, no error). Alternativas descartadas: (a) bloquear el
cierre — rompe la operacion del mensajero por config del maestro; (b) lanzar error —
idem. Queda ABIERTO si el aviso visual de "sin tarifa" entra en el alcance de la 39 o
se difiere.

**Q6 — Zona del pago.**
Confirmado y recomendado: el pago sale de la zona del MENSAJERO (`usuario.zona_id`),
no de `orden.zona_id`. Coincide con el ruteo del destino del cierre (37) que ya usa
`findUsuarioZonaId`.

**Q7 — Alcance de la UI.**
La 39 es principalmente backend + DTOs. Queda ABIERTO cuanto de UI (mostrar la columna
"pago al mensajero" y el total en las pantallas /cierre-dia, /cierres-admin y las de
bodega) entra en esta feature vs. se cablea al exponer el DTO. Recomendacion: exponer
el dato en los DTOs y agregar la columna/total en las vistas existentes (cambio menor),
sin pantallas nuevas.
