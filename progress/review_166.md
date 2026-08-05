# review_166 - Ranking: ventana del dia natural CR

Rama `feature/166-ranking-ventana-dia` @ `60eabee6`, base `origin/dev` @ `64957dca`.
Revision hecha en el worktree `C:\w166`. El reviewer no edito codigo ni tests.

## Veredicto

**OK (APROBADO).** Ningun hallazgo BLOQUEANTE. Seis hallazgos menores, todos de
mantenimiento o de bookkeeping de cierre.

## 1. Checklist de CHECKPOINTS.md

### Especificacion
- [x] `requirements.md` con 16 requisitos EARS R1..R16, mas la seccion 5 (preguntas
      abiertas) y la 6 (las cuatro respuestas humanas del 2026-08-04, con la ventana de
      despliegue 00:00-06:00 CR declarada obligatoria).
- [x] `design.md` con CINCO alternativas descartadas y su porque (seccion 7), mas el
      inventario A1-A9 de anclajes y los hallazgos H1-H7.
- [~] `tasks.md`: T0-T12 marcadas [x]. T13 (bookkeeping) sigue sin marcar -> hallazgo M1.

### Trazabilidad
- [x] Los 16 requisitos mapean a un test que EXISTE y verifica lo que promete (seccion 2).
- [x] `progress/impl_166.md` contiene el mapa R -> test completo, sin pendientes.

### Calidad de codigo
- [x] Capas: el cambio vive en el servicio; `RankingRepository` NO aparece en el diff.
      El service no conoce HTTP; el repo sigue sin logica. La dependencia nueva es
      `lib/utils/fecha-cr.ts`, no la analitica: `resolverRango` se importa solo desde el
      TEST, asi que la inversion de dependencia que la Alt. 2 evitaba no se produjo.
- [x] Tests ejecutados por el reviewer sobre el arbol final:
      ranking-ventana-dia.guardia, ranges-reuso.guardia, ranking-service,
      ranking-repository, ranking-actions, fecha-cr -> 6 files / 58 tests VERDE.
      liberar-reprogramadas-handler, periodicidad, fecha-cr-filtros (R11/R12)
      -> 3 files / 34 tests VERDE.
- [x] init.sh completo: corrido por el leader, dos corridas de 926 files / 11 497 tests;
      rojos disjuntos entre corridas, todos timeouts de 20 s, verdes en aislado, ninguno
      importa RankingService / ranges.ts / fecha-cr.ts. Lectura de delta 0 aceptada, con
      la reserva M6.
- [x] E2E: no aplica (no toca auth, pagos, recaudo, ingesta ni webhooks).

### Datos y seguridad
- [x] CERO migraciones (verificado en el diff y por la guardia de R16).
- [x] RLS: sin tablas nuevas; `premio_ranking` sin cambios de esquema.
- [x] Sin secretos, sin hardcode de pais/moneda/cuenta. `UN_DIA_MS` eliminada y la
      guardia impide reintroducir cualquier constante temporal propia.

### Contrato
- [x] `ObtenerRankingServiceResult` / `RankingRowDTO` intactos; firma de
      `obtenerRanking(actor, now)` intacta; `pct` y `premio` siguen siendo STRING.
      El diff del servicio son 3 lineas de codigo, el import y prosa.

## 2. Trazabilidad R1..R16 - verificacion individual

| R | Test | Verifica de verdad |
| --- | --- | --- |
| R1 | la ventana de hoy es el dia natural CR | Si: asserts sobre toISOString() de ambos bordes = T06:00:00.000Z. |
| R2 | misma pareja (desde, hasta) | Si: compara mock.calls[0] de entregadas vs asignadas, y desde < hasta. |
| R3 | la entrega de las 19:00 CR cuenta HOY | Si, y DISCRIMINA: con now = 2026-07-17T01:00Z la ventana vieja daba hasta = 2026-07-17T00:00Z y el instante caia fuera => rojo con el codigo previo. |
| R4 | ...de AYER queda fuera | Si, y discrimina: 2026-07-16T01:00Z estaba DENTRO de la ventana vieja (desde = 00:00Z) y ahora queda fuera (desde = 06:00Z). |
| R5 | cota exclusiva | Si para los bordes; el operador lo cubre ranking-repository.test.ts:32,56 (gte/lt), no citado en la tabla -> M3. |
| R6 | guardia, censo de literales | Si: 9 literales prohibidos sobre codigo sin comentarios, en service Y repositorio. |
| R7 | mismo now, misma ventana + censo de relojes | Si. Alcance de la excepcion: ver M2. |
| R8 | suite de la 76 + ranking-actions | CONFIRMADO POR EL DIFF: en ranking-service.test.ts solo cambian el import de resolverRango y el bloque 241-256 (el que codificaba la ventana vieja, H7/A5). Ni un assert de los demas casos tocado. ranking-actions.test.ts no aparece en el diff. |
| R9 | caso reexpresado del guardia de ranges | Si: sigue exigiendo TRES coincidencias simultaneas (startOfDayCR, /18:00/, /166/). No se vacio. |
| R10 | los cuatro censos de lib/analytics | INTACTOS: el diff del guardia toca solo la cabecera en prosa (16-28) y el caso reexpresado (98-106). Los cuatro censos, sin una sola linea modificada. |
| R11 | fecha-cr y fecha-cr-filtros | Si, verdes y sin cambios; lib/utils/fecha-cr.ts fuera del diff. |
| R12 | liberar-reprogramadas-handler, periodicidad | Si, verdes y sin cambios; los tres consumidores legitimos de startOfDayCR intactos. |
| R13 | coincide al milisegundo con resolverRango | Si: comparacion real contra el modulo de analitica, no una constante copiada. |
| R14 | la cota superior son las 24:00 CR | Si: now = 12:00 CR y hasta > now, con valor exacto. |
| R15 | guardia sobre la fuente del service | Si: exige inicioDelDiaCREnUtc, inicioDelDiaSiguienteCREnUtc y /166/. |
| R16 | guardia de migraciones y esquema | Si: lista exacta de migraciones del modulo mas aserciones sobre model PremioRanking. |

Ningun test vacio ni de nombre enganoso.

## 3. Puntos de rigor exigidos - resultado

- A2 REEXPRESADO, NO VACIADO (R9/R10): correcto. Tres coincidencias simultaneas
  conservadas; se sustituyo "RankingService" por "startOfDayCR" (la trampa que sobrevive)
  y /D6/ por /166/ (la decision que la cerro), exactamente como fija el design seccion 5.
  Los censos 54-96 no se tocaron.
- LA GUARDIA NUEVA NO PUEDE PASAR POR VACIA: sus fuentes son rutas FIJAS (readFileSync
  lanza si faltan, no devuelve lista vacia) y el censo de migraciones usa toEqual con una
  lista exacta, no un predicado sobre una coleccion posiblemente vacia.
- LA AUTOCOMPROBACION ES REAL y va mas alla del patron heredado: comprueba que el censo
  detecta un literal sospechoso inventado, que 24*60*60*1000 no se confunde con el offset
  de 6 h, y que sinDefaultDeNow() NO perdona un new Date() de cuerpo.
- LA EXCEPCION sinDefaultDeNow() PERDONA DE MAS solo en un caso marginal: ver M2. En el
  arbol actual hay UNA sola lectura de reloj en ambos ficheros y es la firma
  (RankingService.ts:53), la costura de inyeccion de la 76.
- FICHEROS NO TOCAR (A6/A7/A9): git diff --name-only origin/dev...HEAD NO lista
  lib/utils/fecha-cr.ts, lib/analytics/rollup-dia.ts,
  lib/services/AnaliticaOperativaService.ts, tests/unit/analytics/rollup-*.test.ts,
  tests/unit/analytics/operativa-intradia.test.ts, ni nada bajo specs/124 o specs/135.
  lib/repositories/RankingRepository.ts TAMPOCO. Cumplido.
- NOTAS DE SUPERSESION DE LA 76 (Q4): --numstat da 21/0 y 22/0: SOLO lineas anadidas al
  final, cero lineas historicas modificadas.
- CERO MIGRACIONES, CERO CAMBIOS DE CONTRATO: confirmado.

## 4. Hallazgos

- M1 (menor) - T13 sin marcar y sin entrada en progress/history.md. CHECKPOINTS.md exige
  ambas cosas. feature_list.json ya trae branch, spec_path y status in_progress: solo
  falta el cierre. Es bookkeeping del leader al mergear, no del implementer; no bloquea,
  pero el merge no debe cerrarse sin ello.

- M2 (menor) - sinDefaultDeNow() no esta anclada a la firma. El patron no exige "(" o ","
  delante, asi que una declaracion local "const now: Date = new Date();" en el cuerpo de
  otro metodo del mismo fichero tambien quedaria neutralizada y pasaria el censo de R7.
  Hueco estrecho y hoy no materializado; anclarlo lo cierra sin perder la costura de la 76.

- M3 (menor) - la trazabilidad de R5 no cita al test del operador. La exclusividad real
  (lt vs lte) vive en RankingRepository.ts:21,34 y esta verificada por
  ranking-repository.test.ts:32,56, fichero verde y no modificado. El test de R5 en
  ranking-service.test.ts verifica los bordes, no el operador. R5 queda cubierto entre los
  dos; falta que requirements seccion 4 e impl_166 nombren el segundo.

- M4 (menor) - dos asserts redundantes en el caso de R5: toBe(hasta) seguido de
  not.toBeLessThan(hasta) es tautologico. No resta cobertura; si anade ruido.

- M5 (menor) - la asercion de migraciones de la guardia R16 caduca. El toEqual con la
  lista exacta fallara el dia en que otra feature legitima anada cualquier migracion con
  "ranking" o "premio" en el nombre: falso rojo que caera sobre una rama ajena, patron ya
  conocido en este repo. Eleccion defendible, pero conviene dejar escrito quien la retira.

- M6 (menor, sobre la evidencia del gate) - un rojo de la 1a corrida quedo sin nombrar.
  impl_166.md seccion 3 reconoce que el cuarto rojo no se pudo nombrar por log truncado.
  La conclusion de delta 0 se sostiene por la via fuerte (conjuntos disjuntos, un solo
  rojo distinto en la segunda corrida, ninguno de los identificados importa los modulos
  tocados), pero un rojo sin identificar no puede declararse ajeno por inspeccion. No es
  bloqueante: la segunda corrida ya no lo reproduce y los seis ficheros de esta rama se
  verificaron verdes aqui, en aislado, por el reviewer.

BLOQUEANTES: ninguno.

## 5. Condicion viva de despliegue (no es un hallazgo)

La respuesta Q2 hace OBLIGATORIA la franja de merge/despliegue 00:00-06:00 CR, y Q3 obliga
a comunicar el cambio a los mensajeros. Ambas siguen abiertas por diseno y son del leader
en el momento del merge. Si el merge cae fuera de esa franja, la premisa de podio vacio
deja de sostenerse y hay que volver a preguntar antes de desplegar: eso no lo cierra este
review.

Veredicto: OK.
