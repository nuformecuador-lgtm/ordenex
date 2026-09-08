# impl 398 — corregir el resultado de una gestión con el cierre ya solicitado (BACKEND)

> Tanda de `backend_dev`. La pantalla (T4.1/T4.2, R16) **no está hecha**: es de `frontend_dev`.
> Rama: `worktree-agent-a927510e38123a399`. Base: `1d90483d`.

---

## 0. Lo que no era cierto en el spec, y hubo que arreglar

**El diseño no pedía la arista de `TRANSICIONES`, y sin ella la ficha NO FUNCIONA.**
`design.md §2` paso 4 dice «`orden_historial_estado`: append vía `appendCambioEstado`», y ese choke
point **valida todo lote contra `TRANSICIONES` y es de FALLO CERRADO** (140/Q7). `entregada` tenía
**una sola salida declarada** (`-> en_reparto` vía `deshacer_gestion`, #31), así que la corrección
habría muerto con `TransicionIlegalError` y la transacción entera habría revertido.

Se añade la arista **#69 `entregada -> rechazada` vía `correccion_resultado_gestion`**, con su
productor en el mismo commit (`lib/types/order-status-transiciones.ts`), su fila en el inventario
(`tests/fixtures/inventario-transiciones-140.ts`, 63→64 aristas / 60→61 pares) y un bloque de casos
propio en la guardia. `entregada` **sigue en `ESTADOS_TERMINALES`**: ese conjunto exime de tener
salida, no la prohíbe (es el argumento con el que `incidente` sostiene sus seis).

**Una discrepancia MEDIDA en el orden del enum, y se dice en voz alta.** El `down.sql` lista los 33
valores previos de `orden_historial_origen_tipo` en el orden de una base migrada **en orden de
carpeta**. En **esta base local** `rechazo_tope_intentos` va ANTES que `habilitacion_api`, al revés,
porque `20260824120000_…_rechazo_tope_intentos` se aplicó el 2026-08-24 y
`20260823120000_…_habilitacion_api` el 2026-08-25 (medido en `_prisma_migrations.finished_at`). No
es una lista rancia: es drift de esta máquina. Correr el `down` aquí **no pierde ningún valor**,
reordena esos dos. Queda escrito dentro del `down.sql`.

**Lo demás del spec se comprobó y es cierto:** `anularGestionYDevolverAGestion` escribe con
`cierreId: null` (`CierreDiaRepository.ts:1185`); la consolidación en `cierre_bodega` solo toma
`estado = aprobado` + `cierreBodegaId: null`; el comentario `// --- mueve dinero (28) ---` de
`db/schema.prisma` estaba rancio (eran 29) y se corrige a 30.

---

## 1. Las DOS migraciones

`db/migrations/20260908160000_correccion_resultado_gestion/`

| archivo | qué hace |
| --- | --- |
| `migration.sql` | **dos** `ALTER TYPE … ADD VALUE IF NOT EXISTS`, sin `BEFORE`/`AFTER` (apenden): `orden_historial_origen_tipo += 'correccion_resultado_gestion'` (la **familia** de la transición `entregada -> rechazada`) y `historial_accion_tipo += 'cierre_dia_gestion_corregida'` (el **tipo de acción** que registra quién corrigió). Aditiva: ni tablas, ni columnas, ni índices, ni datos, ni RLS nueva. |
| `down.sql` | recrea **los dos** tipos con su lista previa (`33` y `51`) y recastea sus dos columnas. Lleva el bloque de aviso «ESTAS LISTAS SON UNA FOTO DEL 2026-09-08», la consulta de `pg_enum` para medir el catálogo del día, la discrepancia de orden de esta base, y **dos precondiciones ruidosas**: si queda una fila con cualquiera de los dos valores, el `USING` aborta. |

**Las listas se MIDIERON**, no se razonaron (2026-09-08, base local `localhost:5432/ordenex`):
`historial_accion_tipo` = 51 valores; `orden_historial_origen_tipo` = 33; `historial_accion_entidad`
= 21 (no se amplía: `gestion_orden` ya estaba). **Ningún `down.sql` anterior se tocó.**

Y se re-midió contra la base, no se citó: `historial_accion_tipo` lo usa **exactamente**
`historial_accion.accion`; `orden_historial_origen_tipo`, **exactamente**
`orden_historial_estado.origen_tipo`. Los ocho índices de esas dos tablas son btree **plenos**, sin
`WHERE`, así que el `ALTER COLUMN … TYPE` los reconstruye solo.

**Aplicada con `prisma migrate deploy`** y no con `db:migrate` (`prisma migrate dev`): éste se niega
por un drift de checksum **preexistente** en `20260827160000_orden_num_remision_unico_parcial` y
pide `migrate reset`, que borraría la base local compartida. `prisma migrate status` → *«Database
schema is up to date!»*, host `localhost:5432`, base `ordenex`. `pnpm run db:generate` DESPUÉS.

---

## 2. Archivos

### Nuevos

- `db/migrations/20260908160000_correccion_resultado_gestion/{migration.sql,down.sql}`
- `tests/integration/db/correccion-resultado-gestion.int.test.ts` — 14 casos contra Postgres real
- `tests/integration/db/correccion-resultado-gestion-migration.test.ts` — 17 casos (estático + a/b/c)
- `tests/unit/repositories/cierres-admin-corregir-resultado-where.test.ts` — 17 casos, el `WHERE`
- `tests/unit/services/cierres-admin-corregir-resultado.test.ts` — 25 casos, las cinco guardias
- `tests/unit/actions/cierres-admin-corregir-resultado-action.test.ts` — 11 casos, el borde
- `tests/unit/types/corregir-resultado-schema.test.ts` — 14 casos, el schema zod
- `tests/unit/utils/cierre-totales-snapshots-congelados.test.ts` — 10 casos, la aritmética

### Modificados (producción)

| archivo | qué |
| --- | --- |
| `db/schema.prisma` | los dos valores de enum + el comentario rancio `(28)` → `(30)` |
| `lib/types/orden-historial.ts` | `correccion_resultado_gestion` en el SEED, **fuera** de `ORIGEN_TIPOS_VISITA_REAL`, **fuera** de `ORIGEN_TIPOS_CON_GESTION` y **fuera** de `ORIGENES_GESTION_FUERA_DEL_CIERRE` |
| `lib/types/historial-accion.ts` | `cierre_dia_gestion_corregida` + categoría `mueve_dinero` + etiqueta «Corrigió el resultado de una gestión» + conteos 51→52 y 29→30 |
| `lib/types/order-status-transiciones.ts` | **arista #69** (ver §0) |
| `lib/types/cierres-admin.ts` | `corregirResultadoGestionSchema` (`.strict()`, `motivoSchema` **importado**) + `CorregirResultadoGestionResult` |
| `lib/interfaces/repositories/ICierresAdminRepository.ts` | `CorregirResultadoGestionInput` / `…Result` + el método |
| `lib/interfaces/services/ICierresAdminService.ts` | `CorregirResultadoGestionServiceResult` + el método |
| `lib/repositories/CierresAdminRepository.ts` | **`corregirResultadoGestionEnCierre`**, método NUEVO |
| `lib/repositories/TarifaZonaMensajeroRepository.ts` | `resolvePagoTarifaCon(delegado, …)` — el CUERPO del resolver de la 39, extraído a función; el método delega |
| `lib/services/CierresAdminService.ts` | `corregirResultadoGestion` con las cinco guardias |
| `lib/actions/cierres-admin.ts` | Server Action `corregirResultadoGestion` (+ `@sin-superficie`, ver §6) |
| `lib/utils/cierre-totales.ts` | `sumarSnapshotsCongelados` |

### Modificados (tests y censos ajenos que el enum obliga a tocar)

`tests/fixtures/inventario-transiciones-140.ts`, `tests/unit/domain/order-status-transiciones.guardia.test.ts`,
`tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts` (entrada de censo + 51→52),
`tests/unit/guards/origenes-admitidos-en-cierre.guardia.test.ts` (ADMITIDA, con su motivo),
`tests/unit/guards/premio-ranking-alcance.guardia.test.ts` (tercer escritor de
`cierre_dia.total_pago_mensajero`, ver §5), `tests/unit/historial-accion/catalogo-y-choke-point.test.ts`,
`tests/unit/repositories/orden-historial-cobertura.test.ts` (punto de escritura **#35**),
`tests/unit/types/orden-historial-types.test.ts`, los **14** tests de migración de enum previos
(conjunto `POSTERIORES`; **ningún `down.sql` histórico se tocó**) y los **10** dobles de
`ICierresAdminRepository` en `tests/unit/services/`.

---

## 3. Lo delicado: los seis totales

Los cuatro del recaudo con **`computeTotales`** (la misma función que los congeló al solicitar), y
los dos por gestión **SUMANDO LOS SNAPSHOTS CONGELADOS** (`sumarSnapshotsCongelados`), nunca
`derivarPagos`/`derivarIngresoBodega`. Re-derivar reescribiría, con la tarifa de HOY, el pago
congelado de las **otras** gestiones del cierre. Está probado con un contraste explícito
(`cierre-totales-snapshots-congelados.test.ts`: los mismos datos dan `900.00` sumando y `1500.00`
re-derivando — 600 colones de dinero ajeno) y con la mutación **M5**.

**H2 (medida por el leader, no re-preguntada):** el `ingreso_bodega_rechazo` de la gestión corregida
sale de `resolvePagoTarifaCon(cierre.destinoZonaId, vehículo del mensajero)`. **Es la tarifa de
HOY** y `cierre_dia` no congela la fila de `tarifa_zona_mensajero`, así que **puede diferir** de la
del día del cierre. Escrito en el código, junto al cálculo.

**Las TRES identidades que el humano verificó a mano el 2026-09-08** son un caso propio contra
Postgres: `total_general` = suma de las líneas de pago vigentes; efectivo + SINPE + transferencia =
`total_general`; `total_pago_mensajero` = suma de `gestion_orden.pago_mensajero`. Con anti-vacuidad
(si los tres fueran `0.00` las tres igualdades pasarían sin decir nada).

---

## 4. Mapa `R<n>` → test

| R | Test |
| --- | --- |
| **R1** rol | `unit/services/cierres-admin-corregir-resultado.test.ts` › «398/R1 — solo el maestro y el admin corrigen un resultado» (3 casos; `adminSatelite`, `mensajero`, `adminTienda` → `forbidden` con **cero** llamadas al repo) |
| **R2** no encontrada | ídem › «398/R2 — inexistente, anulada o fuera de alcance son el MISMO desenlace» · `integration/db/correccion-resultado-gestion.int.test.ts` › «R2: una gestion de otro alcance…» y «R2: una gestion inexistente…» |
| **R3** cierre abierto | ídem › «398/R3 — solo un cierre ABIERTO se corrige» (4 estados) · **int** › «💰 R3: un cierre APROBADO Y CONSOLIDADO no se corrige, y no se le toca ni una fila» · `unit/repositories/cierres-admin-corregir-resultado-where.test.ts` › «el `WHERE` del sello lleva las CUATRO condiciones» |
| **R4** solo `entregada` | ídem › «398/R4 — solo una `entregada` se corrige a rechazo» (4 resultados) · **int** › «💰 R4: una gestion que NO es `entregada` no se corrige, aunque su cierre este abierto» |
| **R5** motivo | ídem › «398/R5 — el motivo es obligatorio…» · `unit/types/corregir-resultado-schema.test.ts` › «⭑ el schema del motivo es LITERALMENTE el de una gestion `rechazada`, no una copia» |
| **R6** lo que queda escrito en la gestión | **int** › «R6/R7: la gestion queda `rechazada`, con motivo, sin cobro, sin lineas…» · **where** › «la gestion queda rechazada, sin cobro, con pago 0.00…» y «el desglose del cobro que no hubo se BORRA entero» |
| **R7** pago 0.00 / ingreso por tarifa | **int** › «R6/R7…» · **where** › «la tarifa se resuelve con la zona CONGELADA del cierre y el vehiculo del mensajero» |
| **R8** los seis totales | **int** › «R8: los SEIS totales del cierre quedan coherentes…» y «💰 R8: las TRES identidades que el humano verifico a mano el 2026-09-08 se cumplen» · **where** › «💰 los SEIS totales…» · `unit/utils/cierre-totales-snapshots-congelados.test.ts` (10 casos) |
| **R9** orden + historial | **int** › «R9: la orden queda en `rechazada` y su historial gana UNA fila con la familia propia» y «R9: la familia NO cuenta como visita de entrega nueva» · **where** › «el historial de estados se escribe por el choke point, con la familia propia» |
| **R10** registro de acciones | **int** › «R10: se escribe UNA fila de `historial_accion` con el actor congelado, el total nuevo y el par de resultados» · **where** › «el rastro lleva el total NUEVO, el par de resultados y NUNCA el motivo» · censo: `historial-accion-escrituras-cubiertas.guardia.test.ts`, entrada propia con `metodo: "corregirResultadoGestionEnCierre"` |
| **R11** atomicidad | **int** › «💰 R11: si el snapshot del cierre no se puede escribir, NADA queda aplicado» (savepoint REAL) · **where** › «si la ORDEN no transiciona, LANZA» y «si el SNAPSHOT no se actualiza, LANZA» |
| **R12** carrera | **int** › «R12: corregir DOS veces la misma gestion: la segunda es `conflict` y no toca nada» · **servicio** › «R12: un `conflict` del repositorio (carrera) se propaga como `conflict`» |
| **R13** lo que NO se toca | **int** › «💰 R13: no se tocan el detalle congelado, las ordenes sin gestionar, las evidencias, el autor ni la fecha de creacion» |
| **R14** dinero como STRING | `unit/utils/cierre-totales-snapshots-congelados.test.ts` › «💰 la suma es EXACTA…» · `unit/actions/cierres-admin-corregir-resultado-action.test.ts` › «💰 R14: los totales viajan como STRING de escala 2, jamas como `number`» · **where** › los seis totales son `Prisma.Decimal` · guardias existentes `pagos-aritmetica-decimal`, `pago-mensajero-money-safe`, `historial-accion-money-safe` |
| **R15** cuenta como intento | **int** › «R15: tras corregir, la gestion cuenta como intento de entrega de esa orden al aprobarse el cierre» (0 → 1, medido con `contarIntentosVigentesEnLoteCon`) |
| **R16** pantalla | ⛔ **SIN CUBRIR — es de `frontend_dev`** (T4.1 `CorregirResultadoDialog` + T4.2 montaje en `CierresAdminModule`). Es el ÚNICO requisito sin test. |

Cobertura de la migración (T1.5): `tests/integration/db/correccion-resultado-gestion-migration.test.ts`
— forma en disco, el enum vivo contra los catálogos, el `down` comparado **valor a valor y en
orden** contra el estado previo reconstruido ejecutando las migraciones REALES (descubiertas
leyendo `db/migrations`, no escritas a mano), y las dos precondiciones ruidosas.

---

## 5. Dos censos ajenos que este cambio obliga a tocar, y por qué

1. **`premio-ranking-alcance.guardia.test.ts` / R13** afirmaba que los únicos escritores de
   `cierre_dia.total_pago_mensajero` eran `CierreDiaRepository` y `CierreBodegaRepository`. Ahora
   son **tres**: `CierresAdminRepository` lo escribe al corregir. La guardia existe para que añadir
   uno cueste pasar por ahí y escribir el motivo — eso se hizo, con la nota de que se escribe
   **sumando snapshots** y no re-derivando (que es lo que mantiene viva la propiedad que R13
   protegía).
2. **`origenes-admitidos-en-cierre.guardia.test.ts`**: la familia nueva entra en `ADMITIDOS`. La
   gestión corregida **sigue perteneciendo a ese cierre** — corregir en sitio es justamente lo que
   evita dejar huérfana su fila de `cierre_detail`, que es inmutable.

---

## 6. Huecos y decisiones declaradas

- **H5 — al mensajero NO se le avisa** aunque esta corrección le baje el pago de esa gestión a
  `0.00`. **Decisión del LEADER, no firma humana.** Queda como **HUECO CONOCIDO**, escrito en el
  contrato del servicio, no escondido: emitirlo pide otro tipo de notificación y otra migración.
- **H3 — no se exige evidencia fotográfica.** Decisión del LEADER. La gestión conserva la foto de
  la entrega, que es la prueba del error. Escrito en el schema del borde.
- **A la TIENDA tampoco le llega el aviso de «orden rechazada»**, y esto lo descubrí midiendo, no
  estaba en el spec: `emisorNotificacionReal` solo emite cuando `origen_tipo === "gestion"`
  (`lib/notificaciones/emitir.ts:189`), y esta familia es propia. **No es una decisión mía: es una
  consecuencia que dejo declarada** para que el humano decida si la quiere.
- **`@sin-superficie` en la Server Action.** La acción no la importa aún ningún módulo alcanzable
  porque su diálogo es de `frontend_dev`. La anotación lleva el motivo real y **caduca sola**: la
  guardia se pone roja si sobrevive a su motivo. **Se BORRA en el commit que monte el diálogo.**
- **El paquete se resuelve solo**, sin código nuevo: la orden queda `rechazada` y la aprobación del
  cierre ya mueve las `rechazada` a «por devolver». Bodega tendrá que confirmar **un paquete más**
  antes de poder aprobar.

---

## 7. Mutaciones (T5.1) — **9 de 9 muertas, cero supervivientes**

Arnés propio con **autocomprobación** (el de este repo ya reportó supervivientes sin ejecutar un
test): (1) cada mutación exige que su ancla aparezca **exactamente una vez** y aborta si no; (2)
antes de mutar corre el **baseline y exige verde**; (3) restaura siempre y (4) verifica al final que
el árbol volvió **byte a byte** al original.

```
AUTOCOMPROBACION 0 — BASELINE sin mutar: tiene que salir VERDE
 Test Files  5 passed (5)
      Tests  121 passed (121)
exit=0
```

| # | Mutación | exit | Qué murió |
| --- | --- | --- | --- |
| **M1** | quitar `resultado: 'entregada'` del `WHERE` del **sello** | 1 | int «💰 R4: una gestion que NO es `entregada`…», int «R12: corregir DOS veces…», where «el `WHERE` del sello lleva las CUATRO condiciones» |
| **M2** | quitar `estado IN (abiertos)` del `WHERE` del **snapshot** (paso 5) | 1 | where «💰 el `WHERE` del SNAPSHOT lleva el estado y el alcance, no solo el id», where «el alcance del adminSatelite acota por SU zona…» |
| **M3** | **no borrar** las líneas de `gestion_orden_pago` | 1 | 15 casos, entre ellos int «R6/R7…» y where «el desglose del cobro que no hubo se BORRA entero» |
| **M4** | dejar `pago_mensajero` como estaba en vez de `'0.00'` | 1 | int «R6/R7…», int «R8: los SEIS totales…», int «💰 R8: las TRES identidades…», where «la gestion queda rechazada…» |
| **M5** | **re-derivar** el pago con la tarifa viva en vez de sumar snapshots | 1 | int «R8: los SEIS totales…», int «💰 R8: las TRES identidades…», where «💰 los SEIS totales…» |
| **M6** | borrar el `appendAccion` del método nuevo | 1 | **censo 362/R9** «CierresAdminRepository.ts#corregirResultadoGestionEnCierre registra su accion en la misma transaccion», int «R10…», int «R12…», where «el rastro lleva el total NUEVO…», where «EL ORDEN de los pasos…» |
| **M7** | meter la familia en `ORIGEN_TIPOS_VISITA_REAL` | 1 | int «R9: la familia NO cuenta como visita de entrega nueva» |
| **M8** | **no recalcular el total general** | 1 | int «R8: los SEIS totales…», int «💰 R8: las TRES identidades…», where «💰 los SEIS totales…» |
| **M9** | **permitir corregir un cierre APROBADO/CONSOLIDADO** (quitar el estado del sello) | 1 | int «💰 R3: un cierre APROBADO Y CONSOLIDADO no se corrige…», where «el `WHERE` del sello…», where «el alcance del adminSatelite…» |

```
AUTOCOMPROBACION FINAL — el arbol vuelve a ser el original, byte a byte
  lib/repositories/CierresAdminRepository.ts restaurado: True
  lib/types/orden-historial.ts restaurado: True
SUPERVIVIENTES: ninguno
```

**M1 y M2 SOBREVIVIERON en la primera pasada, y eso cambió el diseño.** La lectura previa del
repositorio filtraba por `resultado` y por estado del cierre, así que **decidía ella** y el `WHERE`
del sello era adorno: quitarle `resultado: 'entregada'` no cambiaba nada observable. Se
reestructuró — **la lectura previa solo filtra por ALCANCE y el SELLO es la única guardia que
decide**— y se añadió el test del `WHERE` con doble de `tx`, que es lo único capaz de sostener la
guardia del paso 5 (dentro de una sola transacción el cierre no puede cambiar de estado entre el
sello y el snapshot, así que Postgres no la puede ejercitar desde una conexión). Con eso las dos
mueren.

---

## 8. Gate COMPLETO (`./init.sh`, no `--rapido`: hay migración)

Log propio: `…/scratchpad/gate-398-completo.log`, con `INIT_EXIT` escrito **dentro**, sin `tail`.

```
 Test Files  1 failed | 1818 passed (1819)
      Tests  2 failed | 26112 passed | 26 skipped (26140)
   Duration  1175.45s

ROJOS NUEVOS (1 archivo(s) que no estan en el baseline):
  - tests/integration/recuperar-contrasena-form.test.tsx
INIT_EXIT=1
```

- **`skipped` = 26**, que es el número conocido. Los 78 archivos de `tests/integration/db` **SÍ se
  ejecutaron**: el `.env` estaba copiado.
- `pnpm run typecheck` → **0 errores**. `pnpm run lint` → **0 errores** (175 warnings preexistentes).
- `pnpm run test:guardias` → **198 archivos, 2952 casos, todo verde**.

### El único rojo, y por qué NO es mío ni va al baseline

`tests/integration/recuperar-contrasena-form.test.tsx` (2 casos: la confirmación distinta y el
ojito). Tres medidas:

1. **Pasa AISLADO 4 de 4 veces** (11/11 casos cada vez).
2. **Mi diff no lo alcanza por el grafo de imports**: `vitest related --run` sobre los nueve
   archivos de producción que toqué selecciona **0** referencias a ese test.
3. Falló también en la **primera** corrida del gate, antes de que yo tocara ninguno de los tests que
   arreglé después.

Es el flake de saturación conocido (formularios con `user-event` bajo carga). **NO se añade a
`tests/baseline-rojos.json`**: no es deuda de nadie.

**La primera corrida del gate salió con 21 rojos**, todos míos y todos arreglados: censos de conteo
del enum (`33→34`, `51→52`, `29→30`), el punto de escritura **#35** del choke point, los conjuntos
`POSTERIORES` de 14 tests de migración previos y la aserción «es el último valor» de la 381, que
pasa a afirmar la **posición relativa** (más estrecha, no más laxa). `tests/components/TableroOperativo.test.tsx`
también salió rojo ahí y pasa aislado: mismo flake.

---

## 9. Veredicto

Backend completo y verificado contra Postgres real: **15 de los 16 requisitos con test**; el que
falta (**R16**, la pantalla) es de `frontend_dev`. Gate completo con **un solo rojo, medido como
flake ajeno 4 veces**; 9 de 9 mutaciones muertas con autocomprobación.
