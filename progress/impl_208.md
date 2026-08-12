# impl_208 — Pago multiple por entrega (modelo y calculo del recaudo)

> Zona `backend` · complexity `high` · rama `feature/208-pago-multiple-entrega` (de `origin/dev`, `c23c118a`).
> Spec aprobado por el humano el 2026-08-12. 18 tasks, 4 tandas. T1–T16 cerradas; T17 es este archivo.
> **Sin commits y sin PR**: de eso se encarga el leader.

---

## 1. Que se construyo

El recaudo al cliente deja de ser un par unico `(monto_recibido, metodo_pago)` en `gestion_orden` y
pasa a ser un desglose de 0..N lineas `(metodo, monto)` en la tabla hija `gestion_orden_pago`.
`monto_recibido` sobrevive como TOTAL snapshot y `metodo_pago` como columna DEPRECADA (su retiro es
la ficha 210, no esta). El calculo del cierre (`computeTotales`) deja de meter todo el monto de una
entrega en un solo balde y acumula **cada linea en el balde de SU metodo**.

Las tres preguntas abiertas del spec llegaron ya resueltas por la puerta humana y se implementaron
tal cual: [Q1] backfill fiel al dato (sin filtrar por `resultado`); [Q2] monto no positivo es error
de validacion, no una linea de 0; [Q3] **no** se retira la forma escalar del borde, **ni** la columna
`metodo_pago`, **ni** el campo escalar del DTO (R12, R19 y R31 se implementan y se quedan).

---

## 2. Archivos

### Produccion — creados

| Archivo | Que es |
| --- | --- |
| `db/migrations/20260812120000_gestion_orden_pago/migration.sql` | UP: tabla, unique (gestion_id, metodo), index, FK CASCADE, RLS sin policies, backfill |
| `db/migrations/20260812120000_gestion_orden_pago/down.sql` | DOWN: DROP TABLE IF EXISTS y nada mas |
| `lib/utils/pagos-recaudo.ts` | util PURO del borde: `aCentimos`, `sumaCuadra`, `normalizarPagos`. Sin `@prisma/client` |
| `lib/utils/lineas-pago.ts` | serializador Decimal -> STRING escala 2 del desglose, compartido por las dos proyecciones |

### Produccion — modificados

| Archivo | Cambio |
| --- | --- |
| `db/schema.prisma` | modelo `GestionOrdenPago` + inverso `pagos` en `GestionOrden`; `metodoPago` marcado DEPRECADO |
| `lib/types/gestion-orden.ts` | `metodoPago` opcional + `pagos` opcional + `superRefine` de 5 reglas |
| `lib/actions/mis-asignaciones.ts` | `getAll("pagoMetodo"/"pagoMonto")` emparejados por indice; `pagos: normalizarPagos(...)` |
| `lib/interfaces/services/IMisAsignacionesService.ts` | `pagos: LineaPago[]` en la variante entregada; `metodoPago` pasa a admitir null |
| `lib/services/MisAsignacionesService.ts` | revalidacion `Prisma.Decimal` (R18) + `metodoPagoCompatibilidad` (R19) |
| `lib/interfaces/repositories/IGestionOrdenRepository.ts` | `pagos?` DENTRO de `GestionOrdenData`; la firma de `crearGestionYTransicionar` NO cambia |
| `lib/repositories/GestionOrdenRepository.ts` | `tx.gestionOrdenPago.createMany` con `Prisma.Decimal`, en la MISMA transaccion |
| `lib/interfaces/repositories/ICierreDiaRepository.ts` | `pagos` OBLIGATORIO en `CierreGestionPendienteRow`, sin fallback |
| `lib/repositories/CierreDiaRepository.ts` | `WITH_DETALLE` + `toPendienteRow` |
| `lib/repositories/CierresAdminRepository.ts` | `GESTION_ADMIN_SELECT` + `toPendienteRowDesdeSnapshot` |
| `lib/utils/cierre-totales.ts` | `computeTotales` itera lineas. `derivarPagos` / `derivarIngresoBodega` INTACTOS |
| `lib/interfaces/services/ICierreDiaService.ts` | el DTO gana `pagos` y CONSERVA `metodoPago` |
| `lib/services/CierreDiaService.ts` | passthrough del desglose en `toDetalleDTO` |

`CierresBodegaAdminRepository.ts` **no se toco**: reusa `GESTION_ADMIN_SELECT` y
`toPendienteRowDesdeSnapshot` (verificado, y hay dos tests que lo afirman).

### Tests — creados

`tests/integration/db/gestion-orden-pago-migration.test.ts`,
`tests/unit/utils/pagos-recaudo.test.ts`,
`tests/unit/types/gestion-orden-pagos-schema.test.ts`,
`tests/unit/actions/mis-asignaciones-pagos.test.ts`,
`tests/unit/services/mis-asignaciones-pagos.test.ts`,
`tests/unit/utils/cierre-totales-pagos.test.ts`,
`tests/unit/repositories/cierre-pagos-lectura.test.ts`,
`tests/unit/services/cierre-dia-service-totales-mixtos.test.ts`,
`tests/unit/guards/pagos-proyeccion.guardia.test.ts`,
`tests/unit/guards/pagos-aritmetica-decimal.guardia.test.ts`,
`tests/unit/guards/pagos-frontera.guardia.test.ts`,
`tests/fixtures/cierre-pagos.ts` (helper constructor de fixtures).

### Tests — ampliados y fixtures actualizados

`tests/unit/repositories/gestion-orden-repository.test.ts` (5 casos nuevos),
`tests/unit/services/cierre-dia-service.test.ts` (4 casos nuevos de DTO),
y ~25 archivos de fixtures a los que **solo se les anadio** `pagos` derivado de su par escalar
(los de cierres, corte diario, devolucion SLA, mis-asignaciones, los 4 de repositorios de cierre,
2 de integracion y 8 de componente).

**Ninguna asercion previa se relajo, borro ni debilito.** El helper de fixtures deriva `pagos` del
par escalar (una linea, igual que el backfill), asi que los ~20 tests de totales preexistentes
siguen pasando con sus expectativas originales: eso *es* la paridad de R27 ejerciendose sola.

---

## 3. Mapa de trazabilidad R1..R33 -> test

### A. Modelo de datos y migracion — `tests/integration/db/gestion-orden-pago-migration.test.ts`

**A** = bloque estatico (21 tests, regex sobre el SQL). **B** = bloque contra Postgres REAL (10 tests, el
`migration.sql` y el `down.sql` ejecutados en un esquema temporal dentro de una transaccion revertida).
Seis de estos diez requisitos dejaron de ser texto y son hechos del motor.

| R | Test |
| --- | --- |
| R1 | **A:** "R1: CREATE TABLE con id, gestion_id, metodo, monto, created_at, todas NOT NULL" / "R1: PRIMARY KEY en id" / "R1: FK gestion_id -> gestion_orden(id) ON DELETE CASCADE ON UPDATE CASCADE" / "R1: indice de lectura por gestion_id". **B:** "R1: la FK apunta a gestion_orden(id) con CASCADE" (medido en pg_constraint) / "R1: el CASCADE ejercido: borrar la gestion padre borra sus lineas" / "R1: el indice por gestion_id existe en pg_index" |
| R2 | **A:** "R2: UNIQUE (gestion_id, metodo) — un metodo, como mucho una vez por gestion [D2]". **B:** "R2: el mismo metodo dos veces en la misma gestion lo RECHAZA la base" + los dos controles que le dan valor |
| R3 | **A:** "R3: la linea NO almacena una referencia de pago ni un indice de orden" |
| R4 | **A:** "R4: ENABLE ROW LEVEL SECURITY sin CREATE POLICY (solo service role)". **B:** "R4: relrowsecurity = true y CERO policies" (pg_class + pg_policies) |
| R5 | **A:** "R5: no elimina, renombra ni cambia el tipo de monto_recibido / metodo_pago" + cierre-pagos-lectura :: "R31: el par escalar sigue viajando al lado del desglose" |
| R6 | **A:** "R6: inserta UNA linea (metodo_pago, monto_recibido) por gestion cobrada". **B:** "R6: el backfill escribe el conjunto exacto, AL CENTIMO, con el created_at de la gestion" |
| R7 | **A:** "R7: el WHERE tiene las TRES condiciones — sin monto nulo, sin monto 0 y sin metodo nulo" / "R7: el backfill NO inventa filas para gestiones sin cobro". **B:** "R7: CERO lineas para las tres clases excluidas" (monto NULL, monto 0 con efectivo, metodo NULL) |
| R8 | **A:** "R8: no altera cierre_dia, cierre_bodega, cierre_maestro ni cierre_detail" + guardia frontera :: "la migracion de la 208 no altera NINGUNA tabla de cierre" |
| R9 | **A:** "R9: DROP TABLE de la tabla nueva" / "R9: el down NO altera ni borra columnas ni datos de gestion_orden" / "R9: el down es SOLO el drop, ninguna otra sentencia ejecutable" / "R9: documenta que revertir pierde los desgloses MIXTOS". **B:** "R9: tras el down REAL, gestion_orden queda IDENTICA" (columnas con tipo y nullabilidad + las mismas 6 filas sembradas) |
| R10 | **A:** "R10: la invariante SUM(monto) = monto_recibido NO se expresa como CHECK ni trigger" |

### B. Borde de escritura

| R | Test |
| --- | --- |
| R11 | `gestion-orden-pagos-schema` :: "dos lineas que suman el monto recibido -> valido" / "regla 5: la suma NO iguala el monto recibido -> error en pagos" / "dos lineas del mismo metodo -> error en pagos aunque la suma cuadre" / "una linea con monto NO positivo (0) se rechaza en el propio campo"; action `mis-asignaciones-pagos` :: "dos pares pagoMetodo/pagoMonto -> dos lineas" / "un desglose que NO suma -> validation_error en pagos, sin persistir" |
| R12 | `gestion-orden-pagos-schema` :: "solo metodoPago + monto > 0 -> valido y normaliza a UNA linea con el total"; `pagos-recaudo` :: "R12: forma ESCALAR historica -> UNA linea con el total"; action :: "una linea con el total, y el escalar CONSERVADO para la columna deprecada" |
| R13 | `gestion-orden-pagos-schema` :: "metodoPago escalar + desglose -> error en pagos"; action :: "R13: escalar + desglose en el mismo FormData -> validation_error, service NO invocado" |
| R14 | `gestion-orden-pagos-schema` :: "montoRecibido 0 con desglose no vacio -> error en pagos" / "montoRecibido 0 con desglose VACIO -> valido, normaliza a CERO lineas" / "montoRecibido 0 con el escalar efectivo que hoy fuerza el panel -> valido y CERO lineas"; `pagos-recaudo` :: "R14: montoRecibido 0 -> CERO lineas sea cual sea la forma"; action :: "R14: sin cobro con el escalar efectivo -> CERO lineas"; repo :: "208/R14: lista de pagos VACIA -> no se inserta ninguna linea" |
| R15 | `gestion-orden-pagos-schema` :: "montoRecibido > 0 y ni escalar ni desglose -> error en metodoPago" / "montoRecibido > 0 con desglose VACIO -> error en metodoPago, no en pagos"; action :: "R15: sin desglose y sin escalar con cobro > 0 -> validation_error en metodoPago" |
| R16 | `gestion-orden-pagos-schema` :: "R16: ninguna otra rama admite recaudo ni desglose" (4 ramas parametrizadas); action :: "R16: una rama sin recaudo (rechazada) no gana pagos aunque el FormData los traiga" |
| R17 | `gestion-orden-repository` :: "208/R17: las lineas se insertan con el cliente de la MISMA tx" / "208/R17: si el append de la transicion falla, la tx se revierte"; service `mis-asignaciones-pagos` :: "las lineas llegan al repo en el mismo objeto que la gestion y el estado destino" |
| R18 | service `mis-asignaciones-pagos` :: "la suma NO iguala montoRecibido -> validation_error en pagos, sin subir ni persistir" / "un desglose INFLADO tampoco pasa" / "R30: una suma con decimales que en float NO cuadraria SI cuadra en Decimal" |
| R19 | idem :: "UNA linea -> metodoPago es esa" / "DOS lineas -> metodoPago NULL" / "CERO lineas, sin cobro -> metodoPago NULL, no efectivo" / "ignora el escalar que mando el cliente y usa el desglose como fuente" |
| R20 | `gestion-orden-repository` :: "208/R20: el monto de cada linea entra como Prisma.Decimal, nunca como float" + migracion :: "R20: el monto usa la MISMA escala monetaria, DECIMAL(12,2), nunca float" |

### C. Lectura y calculo

| R | Test |
| --- | --- |
| R21 | `cierre-pagos-lectura` :: "la fila trae el desglose con los montos money-safe STRING de escala 2" / "una gestion SIN lineas llega con [], nunca con undefined" / "la gestion del detalle trae el desglose, money-safe y en orden de enum" |
| R22 | idem :: "R22: el orden es asc sobre el enum NATIVO = orden de declaracion, no alfabetico" / "toPendienteRow respeta el orden que dio la consulta y no reordena" |
| R23 | idem :: "WITH_DETALLE lo pide, con el orden del enum" / "GESTION_ADMIN_SELECT lo pide igual" / "el TERCER camino (bodega) tambien trae el desglose" / "y lo pide con la MISMA definicion, no con una copia"; guardia `pagos-proyeccion.guardia` (10 casos: contraprueba incluida y censo CERRADO de productores de la fila) |
| R24 | `cierre-totales-pagos` :: "caso 1: 5.000 efectivo + 3.000 transferencia van a SU balde, no los 8.000 a efectivo" / "caso 2: mover una linea de efectivo a SINPE cambia EXACTAMENTE dos baldes y deja el general" / "caso 3: mas y menos 0.01" / "caso 6: cada balde es la suma de las lineas de SU metodo" |
| R25 | idem :: "caso 4: la MISMA gestion como reprogramada aporta 0.00 en los cuatro totales" / "caso 4: ninguno de los otros tres resultados aporta, aunque lleve lineas" |
| R26 | idem :: "caso 5: quitar la linea de transferencia baja SOLO ese balde y el general" / "caso 5: una entregada SIN ninguna linea no aporta a ningun balde" |
| R27 | idem :: "caso 7: un conjunto historico, 1 linea por gestion como el backfill, da los MISMOS 4 strings" / "caso 7: la entrega SIN cobro escalar no mueve ningun total". Ademas, los ~20 tests de totales preexistentes pasan con sus expectativas intactas |
| R28 | idem :: "caso 6: general = efectivo + SINPE + transferencia, al centimo" / "caso 6: general = suma de montoRecibido de las entregadas CON lineas, al centimo" |
| R29 | `cierre-dia-service-totales-mixtos` :: "un cierre con una entrega mixta de 8.000 snapshotea totalEfectivo = 5000.00" / "con P = 6.000 y E = 5.000, se le entregan 5.000 y quedan 1.000 pendientes" / "con la E INFLADA del modelo viejo (8.000) se le pagaria de mas y no quedaria deuda" / "el pendiente del cierre (172) hereda la misma E" / "una entrega de UN solo metodo sigue comportandose exactamente igual que antes" |
| R30 | `cierre-totales-pagos` :: "caso 8: 33.33 x 3 repartido en dos metodos da 99.99 exacto" / "caso 8: 0.10 + 0.20 en dos lineas del MISMO metodo da 0.30" / "caso 8: todos los totales salen como STRING de escala 2"; `pagos-recaudo` :: "no importa @prisma/client ni usa parseFloat"; guardia `pagos-aritmetica-decimal.guardia`, que vigila CINCO tramos: `cierre-totales.ts`, `pagos-recaudo.ts`, `lineas-pago.ts`, el bloque del `createMany` del repositorio y —anadido tras la revision— **la revalidacion de la suma del servicio (R18)**, cada uno acotado con extractor de llaves balanceadas para no prohibir la aritmetica anterior a la 208 |

### D. DTO y fronteras

| R | Test |
| --- | --- |
| R31 | `cierre-dia-service` :: "listarCierreDia: el DTO de gestion expone el desglose del recaudo (208/R31)", 4 casos, incluidos "R31: metodoPago NO desaparece, la 209 lo retira, no esta ficha" y el de la gestion sin lineas; guardia proyeccion :: "CONSERVA el par escalar junto al desglose (R31)" |
| R32 | guardia `pagos-frontera.guardia` :: "el censo de modelos con totales por metodo esta CERRADO" / "declara las TRES columnas, cada una Decimal(12,2)" / "la migracion de la 208 no altera NINGUNA tabla de cierre"; `cierre-dia-service-totales-mixtos` :: "R32: la forma del snapshot no cambia, siguen siendo los mismos cuatro totales" |
| R33 | guardia `pagos-frontera.guardia` :: "los seis modulos inmunes no mencionan el desglose", 6 casos parametrizados con control de no-vacuidad / "ningun camino de LiquidacionPago nombra el desglose [D1]", 9 archivos DESCUBIERTOS del arbol en vez de listados a mano / "CIERRE: los UNICOS modulos de lib/ que nombran el desglose son los del recaudo" / "MEDIDO: el ledger por tienda sigue proyectando de la gestion SOLO el total" / "MEDIDO: el repositorio del COD analitico sigue acotado a sus DOS tablas legales" / "CONTRAPRUEBA: el barrido caza una lectura inyectada en un inmune". Ademas, las guardias de analitica preexistentes siguen verdes SIN editarlas |

**Los 33 requisitos tienen test. Ninguno queda sin cubrir.**

---

## 4. Evidencia de MUTACION

No son tests de humo: cada mutacion se aplico al codigo de PRODUCCION, se corrio la suite y se
restauro el archivo (verificado por sha256 en la tanda 4).

### 4.1 El calculo del dinero: `computeTotales`, que es lo que fija la E del min(P, E)

| Mutacion | Test que se pone ROJO | Esperado vs obtenido |
| --- | --- | --- |
| (a) toda linea al balde efectivo, sea cual sea su metodo | `cierre-totales-pagos` :: "caso 1 mixta" | efectivo "5000.00" vs "8000.00" |
| (a) | `cierre-totales.test.ts` :: "suma solo entregadas por metodo" (test PREVIO) | "10.50" vs "17.00" |
| (a) | `totales-mixtos` :: "el pendiente del cierre (172)" | "1000.00" vs "0.00", es decir 1.000 colones en el bolsillo de una persona |
| (a) | *16 rojos en 4 archivos* | |
| (b) sumar g.montoRecibido en vez de p.monto | `cierre-totales-pagos` :: "el montoRecibido NO se suma por su cuenta" | "8000.00" vs "16000.00", doble conteo |
| (b) | `cierre-totales-pagos` :: "caso 3, mas 0.01" | "5000.01" vs "8000.00" |
| (b) | `totales-mixtos` :: "con P = 6.000 y E = 5.000" | E "5000.00" vs "8000.00" |
| (b) | *15 rojos en 3 archivos* | |
| (c) quitar el corte por resultado distinto de entregada | `cierre-totales-pagos` :: "caso 4, reprogramada aporta 0.00" | "0.00" vs "5000.00" |
| (c) | `cierre-totales-pagos` :: "caso 6, general = suma de montoRecibido" | "9384.61" vs "11166.63" |
| (c) | `cierre-totales.test.ts` :: "la rechazada NO suma" (test PREVIO) | "10.50" vs "109.50" |
| (c) | *6 rojos en 2 archivos* | |

Ninguna mutacion quedo verde: no hubo agujeros de cobertura que tapar.

### 4.2 La migracion — bloque A (estatico) y bloque B (Postgres REAL)

`tests/integration/db/gestion-orden-pago-migration.test.ts` tiene **31 tests en dos bloques**:

- **Bloque A (21 tests), estatico:** regex sobre `migration.sql`, `down.sql` y `db/schema.prisma`. Fija la
  FORMA del DDL. No necesita Postgres.
- **Bloque B (10 tests), COMPORTAMIENTO contra un Postgres de verdad.** Molde de la feature 205
  (`liquidacion-reparto-migration.test.ts` + `enTransaccionRevertida` de `_postgres-real.ts:127`): crea un
  esquema temporal, CLONA ahi `gestion_orden` con `LIKE ... INCLUDING ALL`, siembra SUS PROPIAS filas y
  ejecuta el `migration.sql` y el `down.sql` REALES, sentencia a sentencia, dentro de una transaccion que
  SIEMPRE se revierte. **No aplica la migracion, no toca `_prisma_migrations` y en `public` no queda nada**
  (comprobado tras cada corrida: sin esquemas `t208%`, sin `public.gestion_orden_pago`, `gestion_orden` con
  sus 44 filas y la 208 ausente de `_prisma_migrations`). La unica cosa que lo salta es la ausencia de
  `DATABASE_URL`, y entonces vitest lo marca SKIPPED, nunca passed. En esta maquina **corrio de verdad**:
  31 passed, 0 skipped.

Lo que el bloque B demuestra EJECUTANDO, y que una regex no podia:

| R | Hecho del motor medido |
| --- | --- |
| R6/R7 | sobre 6 gestiones sembradas, el backfill escribe el conjunto EXACTO `{(g1, efectivo, 12345.67), (g2, SINPE, 0.01), (g3, transferencia, 99.99)}` —montos comparados como TEXTO, al centimo, sin pasar por number—, una sola fila por gestion, con el `created_at` de la gestion y no el del despliegue; y **CERO** filas para las tres clases excluidas (monto NULL, monto 0 con `efectivo`, metodo NULL) |
| R2 | el segundo INSERT del MISMO `(gestion_id, metodo)` lo RECHAZA la base, con `gestion_orden_pago_gestion_id_metodo_key` en el mensaje; y los dos CONTROLES que le dan valor (mismo metodo en otra gestion, otro metodo en la misma gestion) entran sin error |
| R4 | `pg_class.relrowsecurity = true` y `pg_policies` VACIO para la tabla |
| R1 | la FK medida en `pg_constraint` (apunta a `gestion_orden(id)`, `confdeltype = 'c'`), el CASCADE ejercido de verdad (borrar la gestion padre deja 0 lineas suyas y 2 vivas) y un `gestion_id` inexistente rechazado; mas el indice por `gestion_id` en `pg_index` |
| R9 | tras el `down.sql` REAL, `gestion_orden` queda IDENTICA: misma lista de columnas con tipo, `udt_name` y nullabilidad, y **las mismas 6 filas** (conjunto comparado, no solo el conteo); y `gestion_orden_pago` ya no existe |

Mutaciones del SQL, una cada vez, con el archivo restaurado y verificado por sha256:

| Mutacion | Test ROJO | Esperado vs obtenido |
| --- | --- | --- |
| quitar `AND "monto_recibido" > 0` del backfill | B :: "R6 ... AL CENTIMO", "R7: CERO lineas", "R1: CASCADE" (+ el estatico del WHERE) | conjunto de 3 lineas vs 4, aparece una linea de "0.00"; lineas de las excluidas 0 vs **1**; lineas vivas 2 vs **3** |
| `CREATE UNIQUE INDEX` -> `CREATE INDEX` normal | B :: "R2: el mismo metodo dos veces lo rechaza la BASE" | el INSERT duplicado PASO: mensaje vacio vs el nombre del indice. Es decir, **no fallo lo que tenia que fallar** |
| `ON DELETE CASCADE` -> `ON DELETE RESTRICT` | B :: "R1: la FK apunta con CASCADE" y "R1: el CASCADE ejercido" | `on_delete` "c" vs "r"; y el borrado del padre FALLA en vez de cascadear |
| quitar `ENABLE ROW LEVEL SECURITY` | B :: "R4: RLS habilitada y CERO policies" | `relrowsecurity` true vs **false** |
| borrar el CREATE UNIQUE INDEX entero | A :: "R2: UNIQUE (gestion_id, metodo)" | 1 failed / 18 passed |
| anadir una CREATE POLICY tras el ENABLE RLS | A :: "R4: ENABLE RLS sin CREATE POLICY" | 1 failed / 18 passed |
| quitar `monto_recibido > 0` del WHERE | A :: "R7: el WHERE tiene las TRES condiciones" | 1 failed / 18 passed |

Detalle util para quien lea una corrida en rojo: en la primera version, con la mutacion del RESTRICT el
`DELETE` del padre reventaba el `beforeAll` y los 10 tests salian "skipped" con el fichero FAILED. Se
cambio a capturar el error dentro de un `SAVEPOINT`, asi que ahora la mutacion da un rojo concreto y
legible y el resto del bloque sigue midiendo.

### 4.3 Las guardias

| Mutacion | Guardia | Mensaje |
| --- | --- | --- |
| borrar pagos del WITH_DETALLE | proyeccion, 2/10 rojos | "CierreDiaRepository.WITH_DETALLE no selecciona pagos" |
| anadir a bodega una proyeccion propia SIN pagos | proyeccion, 2/10 | "proyeccion del metodo escalar SIN el desglose" |
| meter un parseFloat en el monto de computeTotales | aritmetica, 2/13 | "conversion de un monto a numero en el camino del recaudo" |
| concatenar strings en vez de Decimal.plus | aritmetica, 1/13 | "computeTotales usa el operador + sobre montos" |
| meter un parseFloat en la revalidacion del servicio (R18) | aritmetica, 4 rojos | hallazgos [] vs ["MisAsignacionesService.ts (revalidacion de la suma, R18): parseFloat("] |
| lectura de gestionOrdenPago inyectada en WalletTiendaFeedService | frontera, 4/16 | "WalletTiendaFeedService nombra gestionOrdenPago" y la clausula de CIERRE |

La mutacion de bodega destapo un defecto en la propia guardia (el extractor de declaraciones cruzaba
declaraciones intermedias y atribuia el cuerpo al nombre equivocado). Se corrigio con un lookahead y
el porque quedo escrito en el docstring de la funcion.

---

## 5. Gates

### Por tanda (`./init.sh --rapido`)

- **Tanda 1 (T1-T3):** typecheck verde / lint 0 errors / migracion 19 passed (19) / guardias 87 files, 1181 tests / `== init OK ==`
- **Tanda 2 (T4-T8):** typecheck verde / lint 0 errors / test:cambiados verde / guardias 87 files, 1181 tests / `== init OK ==`
- **Tanda 3 (T9-T13):** typecheck verde / lint 0 errors / guardias 87 files, 1181 tests / `vitest related` sobre los 6 modulos de lectura y calculo: 60 files, 969 tests passed
- **Tanda 4 (T14-T16):** typecheck verde / lint 60 problems (0 errors, 60 warnings), todas preexistentes y ajenas: la unica warning nueva de la feature se elimino / guardias **90 files, 1221 tests passed**, con las tres guardias nuevas dentro

> **Nota sobre la tanda 3.** La corrida de `--rapido` inmediatamente posterior salio ROJA con 10-13
> fallos en `tests/components/AnaliticaPage.test.tsx`, `tests/unit/auth/destino-post-login.test.ts`,
> `tests/unit/auth/menu-visibility.test.ts` y
> `tests/unit/guards/roles-analitica-acceso-vs-dominio.test.ts`. **No eran de la 208.** Otra sesion
> estaba editando EN PARALELO, en este mismo checkout, los siete archivos de analitica y roles
> (`app/(app)/analitica/page.tsx`, `lib/auth/menu-visibility.ts`, `e2e/analitica-roles.spec.ts` y sus
> tests), con mtime posterior al cierre de esa tanda. Los fallos cambiaban de archivo entre corridas y
> desaparecieron solos cuando esa sesion termino: la suite completa posterior salio verde entera.
> Ningun subagente de la 208 abrio ni edito esos siete archivos.

### Completo (`./init.sh`) — primera pasada, 2026-08-12 16:25

```
✓ typecheck paso · ✓ lint paso
 Test Files  1078 passed (1078)
      Tests  13519 passed (13519)   Duration 541.78s
✓ test paso · == init OK ==
```

### Completo (`./init.sh`) — pasada FINAL, tras corregir el bloqueante de la revision

```
== Arnes SDD :: init (modo: completo) ==
! jq no esta instalado (recomendado para validar feature_list.json)
✓ node v22.13.1
✓ dependencias presentes
✓ typecheck paso
✓ lint paso            (60 problems, 0 errors, 60 warnings — todas preexistentes y ajenas)
 Test Files  1078 passed (1078)
      Tests  13545 passed (13545)
✓ test paso
✓ todas las migraciones tienen down.sql
✓ .env presente
== init OK ==
```

Los 26 tests de mas respecto a la primera pasada son el bloque B contra Postgres real (10), los dos
nuevos del bloque A y el resto del refuerzo de guardias.

Cero `unhandled errors` de workers y 1078 archivos ejecutados: la corrida **no** esta degradada y el
conteo es real. Cero rojos: ni regresiones ni flakes en esta pasada.

**Lo que ese `init OK` NO evaluo, y por que no cuenta como aprobado.** `jq` no esta instalado en esta
maquina, asi que los pasos 3 y 4 de `init.sh` (regla max-2-features-`in_progress`-por-zona y "toda feature
sdd en vuelo tiene su carpeta de specs") se OMITEN con un `warn` y la corrida llega igualmente a
`init OK`. No es un fallo de la feature, pero cantar victoria por ese verde seria cantarla por dos pasos
que no corrieron. Se evaluaron A MANO sobre `feature_list.json`, con este resultado:

- `in_progress` = 2 en total: **196** (zona `fullstack`) y **208** (zona `backend`). Una por zona: la regla
  de maximo 2 por zona se respeta.
- Specs faltantes para features `sdd` en vuelo: **ninguna**.

---

## 6. Desvios del spec y decisiones que el spec no cubria

1. **La migracion NO se aplico a `public`, y ya no hace falta que se aplique para demostrarla.**
   `prisma migrate status` esta DIVERGENTE por causas ajenas a la 208 (`20260811140000_liquidacion_reparto`
   pendiente, y la base registra `20260728120000_orden_historial_origen_deshacer_asignacion` con otro
   timestamp local), asi que `migrate dev` pedia RESETEAR y se aborto. **Corregido tras la revision:** el
   `migration.sql` y el `down.sql` REALES se ejecutan ahora contra un Postgres de verdad en el BLOQUE B de
   `tests/integration/db/gestion-orden-pago-migration.test.ts` (molde de la 205,
   `_postgres-real.ts:127`): esquema temporal, transaccion siempre revertida, `_prisma_migrations` sin
   tocar y `public` intacta. Ver la seccion 4.2. **Lo unico que no se pudo ejercer** es el caso "base ya
   migrada", porque exigiria aplicar la migracion; el diseño del bloque es independiente del estado de
   `public` (el UP solo CREA una tabla, no altera `gestion_orden`, asi que un `public` ya migrado no puede
   chocar) y por eso no necesita la normalizacion del clon que si necesitaba el molde de la 205.
2. **`metodo_pago` se deriva del DESGLOSE, no del escalar recibido.** `buildGestionData` llama a
   `metodoPagoCompatibilidad(input.pagos)` e ignora `input.metodoPago`. Con la forma escalar legacy y
   `montoRecibido > 0` el valor escrito es el mismo que hoy; **NO** es identico en un caso: una entrega
   SIN COBRO (`montoRecibido = 0` con el escalar `efectivo` que fuerza el panel) pasa de escribir
   `'efectivo'` a escribir `NULL`. Esta testeado y fue APROBADO a sabiendas en la puerta humana (aviso
   aceptado de R19), no es un defecto.
   **Consecuencia que hay que llevarse a la 210:** la columna deprecada `metodo_pago` queda con DOS
   SEMANTICAS conviviendo. Las gestiones historicas sin cobro conservan `'efectivo'` (el backfill no las
   toca, y R7 les da CERO lineas), mientras que las nuevas escriben `NULL`. Cualquier lectura que trate esa
   columna como fuente de verdad vera dos poblaciones distintas para el mismo hecho; es munición para
   retirarla, y el motivo por el que el desglose —no la columna— es la fuente.
3. **Modulo nuevo `lib/utils/lineas-pago.ts`, no previsto en tasks.md.** El design decia "mapea con el
   mismo decimalToString", pero ese helper esta duplicado como funcion privada en los dos repositorios.
   Dos copias del serializador serian dos oportunidades de divergir de escala en un camino
   money-critical. No cambia ninguna firma publica, y la guardia de aritmetica afirma que los dos
   lectores pasan por el.
4. **Precedencia entre las reglas del superRefine:** orden 1 a 5 con corte tras cada issue, asi que
   `pagos` vacio con `montoRecibido > 0` cae en la regla 3 (error en metodoPago) y no en la 5. Es lo que
   insinua la tabla del design, pero no estaba dicho explicitamente.
5. **Longitudes desparejas en el FormData:** la lista se arma con el maximo de las dos longitudes y los
   huecos quedan indefinidos, de modo que zod los rechaza con error de campo. Truncar al minimo
   emparejaria mal el dinero en silencio.
6. **`CierreDetalleGestion.pagos` es OBLIGATORIO, no opcional** (el design 3.3 lo escribe sin
   interrogante). Coste: 8 fixtures de tests de componente ganan el campo. Ningun componente ni pagina
   se toco.
7. **El oraculo de paridad de R27 esta en centimos enteros, no en Prisma.Decimal:** compararlo contra
   otra suma de Decimal seria compararlo consigo mismo. Vive solo en el test, nunca en produccion.
8. **Hallazgo documental: `cierre_maestro` NO existe en `db/schema.prisma`.** R32 y el design 6 lo
   nombraban, pero el segundo modelo con los tres total_* es `CierreBodega` (feature 40). La guardia de
   frontera cierra el censo recorriendo TODOS los modelos en vez de suponer los nombres, asi que R32
   quedaba cubierto igual. **CORREGIDO tras la revision:** el nombre se arreglo en `requirements.md` R32 y
   en `design.md` seccion 6, cada uno con una nota fechada que explica el cambio. La errata se deja a
   proposito en R8 y en `tasks.md`, donde `cierre_maestro` aparece dentro de una lista de tablas que la
   migracion NO debe tocar: nombrar de mas ahi no debilita nada.

---

## 6.1 Cambios de la ronda 2 (tras el rechazo del reviewer)

| Que pedia la revision | Que se hizo |
| --- | --- |
| BLOQUEANTE: la migracion nunca toco un motor de Postgres, habiendo via para hacerlo sin aplicarla | bloque B de 10 tests contra Postgres real siguiendo el molde de la 205 (`enTransaccionRevertida`, esquema temporal, clon de `gestion_orden`, DDL real). R1, R2, R4, R6, R7 y R9 dejan de ser regex. Seccion 4.2 |
| menor 1: `impl_208.md` 6.2 afirmaba de mas | corregido: con `montoRecibido = 0` y escalar `efectivo` el valor SI cambia (`'efectivo'` -> `NULL`), y queda anotada la consecuencia para la 210: la columna deprecada convive con DOS semanticas |
| menor 2: `cierre_maestro` no existe | corregido en `requirements.md` R32 y `design.md` 6, con nota fechada |
| menor 3: la guardia de R30 omitia la revalidacion del servicio | anadido el quinto tramo, acotado por llaves balanceadas, con control de no-vacuidad y contraprueba; mutacion comprobada |

Lo que la revision aval y **no** se toco: `lib/utils/lineas-pago.ts` (justificado), el mapa R -> test
(completo, 33/33), la bateria de mutacion del calculo (aguanto incluso una mutacion que se invento el
reviewer: intercambiar los baldes SINPE y transferencia, que no altera el general ni la invariante R28,
y aun asi da 9 rojos). El E2E del camino mixto es entregable de la 209.

---

## 7. Estado

T1 a T17 hechas. **T18 (bookkeeping en `feature_list.json` y `progress/current.md`, commit y PR) NO se
hizo**: queda para el leader, por instruccion explicita. La decision sobre el retiro de la forma escalar
del borde y de la columna `metodo_pago` ya esta tomada ([Q3]: ficha 210 aparte) y debe quedar escrita en
el PR.

**Aviso para el leader:** todo este trabajo esta SIN COMMITEAR en el checkout principal, y otra sesion
esta usando ese mismo checkout a la vez. Un `git checkout` o un `git stash` ajeno se lo lleva por
delante.
