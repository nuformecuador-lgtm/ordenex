# 441 — la efectividad cuenta órdenes que no son de ese día (backend)

Rama `fix/441-efectividad-por-cohorte`, desde `origin/dev` (`df11f220`). Ficha sin SDD
(`"sdd": false`), así que los requisitos son los del encargo y del diseño aprobado
(`design-analitica/Main.dc.html`, `Medido.dc.html`); se numeran aquí para poder mapearlos a un
test.

## Qué estaba mal, y dónde

`ConteoPorStatusRepository.condicionesDeConsulta` acotaba la ventana sobre
`COALESCE(u."created_at", o."created_at")` — la fecha de la **última gestión vigente**, y sólo la
de creación si la orden nunca se gestionó. Con eso «ayer» significaba *actividad de ayer* y no
*cargadas ayer*. Medido contra producción el 2026-09-17, para el día anterior: 210 órdenes y
49,0 % por fecha efectiva contra 75 y 14,7 % por cohorte de carga; **152 de las 210 se habían
cargado antes**.

## Archivos

### Creados

| archivo | qué es |
| --- | --- |
| `lib/repositories/ventana-de-carga.ts` | `ventanaDeCarga(rango)`: la ventana `[desde, hasta)` sobre `o."created_at"`. UNA definición para las cuatro lecturas. |
| `lib/analytics/madurez-cohorte.ts` | `evaluarMadurezDeCohorte`: la madurez del período y los DOS estados en que un porcentaje no se escribe. |
| `lib/config/efectividad-cohorte.ts` | `MAXIMO_SALTO_POR_ORDEN = 0,05`. El umbral se DERIVA de ahí; la medición va al lado. |
| `tests/unit/analytics/madurez-cohorte.test.ts` | 16 casos de la regla, con las mutaciones nombradas. |
| `tests/integration/db/conteo-por-status-cohorte.int.test.ts` | 4 casos contra Postgres real: la ventana de verdad, no su texto. |

### Modificados

| archivo | cambio |
| --- | --- |
| `lib/repositories/ConteoPorStatusRepository.ts` | la ventana pasa a `ventanaDeCarga(rango)`. Cabecera reescrita (el aviso de «dos implementaciones del `where`» era falso desde el 2026-08-18). |
| `lib/repositories/ConteoCargadasPorDiaRepository.ts` | usa `ventanaDeCarga` en vez de escribirla. Sin cambio de comportamiento. |
| `lib/repositories/CohorteCargaRepository.ts` | ídem. Sin cambio de comportamiento. |
| `lib/repositories/ConteoProductosRepository.ts` | sólo comentarios: declara que hereda la ventana nueva y por qué su `LATERAL` sí se queda. |
| `lib/repositories/DineroProductosRepository.ts` | se retira el `LEFT JOIN LATERAL ... u`, que existía sólo para que el `where` pudiera referenciar `u."created_at"`. |
| `tests/unit/analytics/conteo-por-status-sql.test.ts` | el bloque «La ventana temporal» afirmaba lo contrario; reescrito + un caso nuevo de procedencia. |
| `tests/unit/analytics/dinero-productos-sql.test.ts` | dos casos adaptados al SQL sin lateral, conservando su intención. |

**Ninguna migración.** Ni tabla, ni columna, ni índice, ni RLS: esto es cómo se consulta.

## Requisitos → test

| # | requisito | test |
| --- | --- | --- |
| R1 | la ventana del desglose por status cae sobre `o."created_at"`, no sobre la última gestión | `tests/integration/db/conteo-por-status-cohorte.int.test.ts` › «una orden cargada FUERA y gestionada DENTRO no entra (el caso de las 152)» |
| R2 | una orden cargada dentro y gestionada después del `hasta` sigue contando, en el bucket de su gestión | mismo archivo › «una orden cargada DENTRO y gestionada DESPUES cuenta…» |
| R3 | una orden cargada dentro y nunca gestionada cuenta por el `value` de su `order_status` | mismo archivo › «…nunca gestionada cuenta por el estatus de la orden» |
| R4 | la ventana no se reescribe: es literalmente la de `ventanaDeCarga` | `tests/unit/analytics/conteo-por-status-sql.test.ts` › «la ventana es LITERALMENTE la de `ventanaDeCarga`…» |
| R5 | sin rango no se escribe condición de fecha | mismo archivo › «SIN rango no escribe ninguna condición de fecha» (ya existía) |
| R6 | el `where` del dinero sigue siendo EXACTAMENTE el del volumen | `tests/unit/analytics/dinero-productos-sql.test.ts` › «R75 · el `where` del dinero es EL MISMO del volumen…» (ya existía) |
| R7 | el dinero ya no arrastra el lateral de la fecha, y el JOIN aportante queda intacto | mismo archivo › «FICHA 441 · el `LEFT JOIN LATERAL`… YA NO ESTA» y «⟨Q3⟩ · el JOIN a `gestion_orden` EXCLUYE las anuladas» |
| R8 | cero cerradas → NINGUNA de las dos cifras se escribe (ni la de sobre-cargadas) | `tests/unit/analytics/madurez-cohorte.test.ts` › «con 0 de 27 cerradas, NINGUNA de las dos cifras se escribe» |
| R9 | base por debajo del suelo → la cifra no se escribe | mismo archivo › «con 3 cerradas de 64, la cifra sobre cerradas se calla» |
| R10 | cada cifra se mide contra SU denominador, no contra las cargadas | mismo archivo › «cada cifra se mide contra SU denominador…» |
| R11 | el suelo se DERIVA de la tolerancia, no se escribe | mismo archivo › «en el suelo, una orden mueve la cifra EXACTAMENTE la tolerancia…» |
| R12 | la madurez deja listos vivas, cerradas y el % sobre cerradas, y los tres tramos suman | mismo archivo › «deriva cerradas, vivas y “otro desenlace”…» y «las dos cifras salen del mismo numerador…» |
| R13 | un reparto imposible se dice en voz alta, no se pinta | mismo archivo › «un reparto imposible se dice en voz alta» |

## Mutaciones ejecutadas

Las tres que pidió el encargo, aplicadas de una en una sobre el árbol y revertidas después.

| # | mutación | resultado | mensaje real |
| --- | --- | --- | --- |
| M1 | devolver la ventana a `COALESCE(u."created_at", o."created_at")` | **ROJO** 4 casos (2 integración + 2 unidad) | `AssertionError: entro una orden cargada antes del rango, solo porque se gestiono dentro: expected 1 to be undefined` · `AssertionError: se perdio una orden cargada en el rango por gestionarse despues: expected undefined to be 1` |
| M2 | quitar el guardia de CERO CERRADAS | **ROJO** 2 casos | `AssertionError: 0/27 se pintó como 0 %: expected +0 to be null` |
| M3 | quitar el guardia de BASE CHICA | **ROJO** 3 casos | `AssertionError: se pintó un 67 % sobre 3 órdenes: expected 0.6666666666666666 to be null` |

Tras revertir cada una, verde de nuevo (`16 passed` en el archivo de la regla).

M2 obligó a **reordenar** las aserciones de su caso: empezando por `sobreCerradas`, la mutación
moría por el motivo equivocado (con el guardia fuera, esa cifra sigue saliendo `null` de rebote
porque su base es 0 y la tapa el suelo) y escondía lo único que importa — que la pantalla acababa
de pintar «0,0 % de efectividad» sobre 27 órdenes que nadie ha fallado.

## El umbral, y por qué

Se elige una **tolerancia** —cuánto puede mover el número UNA orden— y el suelo sale de ella:
`MINIMO_BASE_PORCENTAJE = ceil(1 / MAXIMO_SALTO_POR_ORDEN)`. Con **5 puntos por orden**, el suelo
es **20**. Lo que se discute es «5 puntos»; «20» a secas sería una constante mágica, y el test
comprueba la derivación, no el número.

Contrastado contra poblaciones reales medidas el 2026-09-17:

| población | cargadas | cerradas | qué hace el umbral |
| --- | --- | --- | --- |
| zona GAM | 637 | 389 | las dos cifras se pintan |
| zona El Coco | 64 | 3 | tapa el % sobre cerradas (el caso que nombró el humano) |
| zona Puntarenas | 27 | 0 | ya lo tapa la regla de cero cerradas |
| cohorte de 1 día | 75 | 17 | pinta 14,7 %; tapa el 64,7 % sobre 17 |
| cohorte de 3 días | 171 | 88 | las dos se pintan |
| período del diseño | 790 | 525 | las dos se pintan |

No es un criterio estadístico y no se defiende como tal: el semiancho del IC 95 % de una
proporción cerca del 50 % es ~0,98/√N (±22 puntos con N=20), así que por esa vía habría que
esconder casi toda la pantalla. El umbral promete que la cifra **no baile sola**, no
significancia.

## Paneles: qué se movió y qué no

### Movidos a cohorte de carga

| panel | fuente | por qué se mueve |
| --- | --- | --- |
| `KpisEfectividad` | `ConteoPorStatusRepository` | es EL número de la ficha |
| `ConteoPorStatusDona` | mismo repo, **misma clave de SWR** | comparte petición y respuesta con el anterior: no puede divergir |
| `ConteoEntregasAnillo` | `ConteoEntregasRepository`, que **delega** en el anterior desde el 2026-08-18 | es literalmente el pliegue del desglose; si no se moviera, diría «834 órdenes» al lado de «790 cargadas» |
| `ProductosTabla` (volumen) | `ConteoProductosRepository`, importa `condicionesDeConsulta` | su columna «Efectividad de entrega» es el MISMO número que el héroe |
| `ProductosTabla` (dinero) | `DineroProductosRepository`, importa `condicionesDeConsulta` | **R78 exige** que comparta ventana con la fila de volumen que va a su lado |

Se movieron **cambiando la ventana dentro de `condicionesDeConsulta`**, no parametrizándola. Dos
motivos medidos: `dinero-productos-sql.test.ts` afirma que el `WHERE` del dinero es byte a byte el
que produce esa función, y `alcance-dinero.guardia.test.ts:238` exige la línea literal
`const where = Prisma.join(condicionesDeConsulta(consulta), " AND ");`. Un segundo parámetro
habría obligado a debilitar las dos.

### Ya estaban en la fecha de carga (ahora comparten la función)

`CargadasPorDiaBarras` (`ConteoCargadasPorDiaRepository`) y `CohorteCargaTabla`
(`CohorteCargaRepository`). Sin cambio de comportamiento: sus tests de integración siguen verdes.

### NO movidos, con su razón

| panel | fuente | razón de negocio |
| --- | --- | --- |
| `CicloVidaKpi` | `CicloVidaRepository` | su ventana cae sobre la **transición terminal** porque fecha el CIERRE: contesta «de lo que cerró, cuánto tardó». Su propia cabecera dice que atribuyendo por creación «el mes en curso saldría siempre artificialmente rápido: sólo habrían cerrado las fáciles». Mide una duración, no una proporción. **Ver la deuda abierta de abajo: su `n` y el del héroe no van a coincidir.** |
| `DevolucionesPorCausaAnillo` | `ConteoDevolucionesRepository` | cuenta **gestiones**, no órdenes, y la pantalla ya declara que su total no tiene por qué coincidir con el anillo de arriba. Una ventana de carga sobre un universo de gestiones no significa nada. |
| `HoyGestionBarras` | `ConteoHoyGestionRepository` | no depende del filtro: siempre el día CR en curso. Su defecto es otro y tiene ficha propia (444). |

## Por qué NO se conectó el KPI al motor de `CohorteCargaRepository`

El encargo pedía conectarlo «o justificar midiendo por qué no sirve». No sirve, y son tres hechos
del código, no una opinión:

1. **Su vocabulario de cubos es otro.** `CohorteDesenlace = ESTADOS_TERMINALES | "viva"`, y su
   propio tipo declara que una orden en `rechazada` o `devuelta` cae en **`viva`**. El héroe
   necesita «Rechazada 78» y «Devuelta 23» separadas (diseño) y la «efectividad de la gestión»
   cuenta el rechazo a favor. Con ese motor, los rechazos se contarían como trabajo pendiente.
2. **Descarta la faceta de mensajero** («una orden no la carga un mensajero»). El KPI vive bajo una
   barra de filtros con selector de mensajero y hoy sí lo respeta; cambiar de fuente lo dejaría de
   respetar en silencio.
3. **Exige rango y lanza sin él.** La pantalla arranca sin ventana puesta, así que el héroe
   reventaría al cargar.

Lo que sí se conectó es **su ventana**, que es donde vivía el defecto: hoy es literalmente la misma
función (`ventanaDeCarga`) en las tres lecturas.

## Deuda abierta (medida, no resuelta aquí)

**Hay TRES definiciones de «cerrada» vivas en la misma pantalla**, y el diseño usa un solo número
(525) para las tres:

| lectura | «cerrada» significa |
| --- | --- |
| héroe / `calcularEfectividad` | tiene un **desenlace de gestión**: `entregada`, `rechazada`, `devuelta`, `reprogramada`, `incidente` |
| tabla de cohortes | llegó a un **estado terminal**: `entregada`, `devuelta_a_tienda`, `incidente` (y `rechazada`/`devuelta` cuentan como `viva`) |
| `CicloVidaKpi` | los mismos terminales, pero con la ventana sobre la transición |

Consecuencia visible en cuanto entre la mitad de pantalla: el héroe escribirá «de las 525 que ya
cerraron» y la tarjeta de al lado «(N órdenes cerradas)» con otro N. `evaluarMadurezDeCohorte` usa
la primera definición —la del propio reparto del héroe, para que su barra sume—, que es lo correcto
para esa tarjeta pero no cierra la pregunta. **Decisión del humano**, no de esta ficha.

Además, el «343,8 h sobre 525 ya cerradas» del artboard **no necesita** mover `CicloVidaRepository`:
`CohorteCargaDTO.totalPorDesenlace` ya viaja con `segundosAcum` y `n` por cubo, así que ese promedio
sale de la misma población que el héroe sin tocar aquel repositorio.

**Caché:** `claveDeConteoPorStatus` no lleva versión de semántica y el TTL es de 15 min, así que tras
desplegar se pueden servir hasta 15 minutos de cifras con la ventana vieja bajo la misma clave. Hay
kill-switch e invalidación por tag; no se tocó.

**Fuera de ficha, encontrado al leer:** `lib/repositories/ConteoEntregasRepository.ts` tiene dos
`console.log('xyz query params', …)` / `console.log('xyz query', …)` commiteados el 2026-08-18 en
`e3d15eba`. Corren en producción en cada carga de analítica. No se tocan aquí para no mezclar; es un
borrado de dos líneas.

## Verificación

```
pnpm run typecheck   → sin salida (tsc --noEmit, verde)
pnpm run lint        → ✖ 202 problems (0 errors, 202 warnings)   [todos preexistentes: no-unused-vars en dobles de test]
./init.sh            → == init OK ==   INIT_EXIT=0
```

Gate COMPLETO (se tocan repositorios y consultas), log en `progress/gate_441.log`:

```
✓ feature_list.json: sin ids duplicados (440 fichas), cupo por zona respetado (in_progress=0)
✓ typecheck paso
✓ lint paso
Test Files  2044 passed (2044)
     Tests  29789 passed | 26 skipped (29815)
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 2044 ejecutado(s))
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at
✓ .env presente
INIT_EXIT=0
```

Los **26 `skipped`** se miraron uno a uno: son `describe.skip`/`it.skip` deliberados de
`tests/components/AnaliticaPage.test.tsx` (17) y `AnaliticaShell.test.tsx` (9), inertes desde la
ficha del shell reducido y con su motivo escrito al lado. **Ningún salto por falta de base**: `.env`
presente y los dos archivos nuevos corrieron dentro del gate —
`tests/integration/db/conteo-por-status-cohorte.int.test.ts (4 tests) 1627ms` y
`tests/unit/analytics/madurez-cohorte.test.ts (16 tests)`. El aviso de `down.sql` es preexistente y
de migraciones de otra ficha; aquí no hay migración.

## Veredicto

El KPI ya cuenta las órdenes cargadas en el período y no las que se movieron ese día; la regla de
los dos estados vive en una función pura con su umbral derivado; falta la mitad de pantalla, que va
en otra pasada.
