# Review — Feature 41: reglas y bloqueos de cierre (obligatoriedad, vencidos)

Reviewer del arnes SDD. Rama feature/41-reglas-bloqueos-cierre (commit dde6fba sobre
origin/dev 7dfa44b). Verificacion EJECUTABLE. Hallazgos MAYORES tratados como bloqueantes.

## Veredicto: APROBADO
0 bloqueantes. 4 deudas menores (documentadas, ninguna money-corrupting).

## Verificacion ejecutable (numeros reales)
- prisma validate: OK — schema valido
- pnpm typecheck: 0 errores (TS strict)
- pnpm lint: 0 errores; 135 warnings preexistentes, TODOS en .claude/skills (ninguno de la 41)
- pnpm test: 1931 passed / 1931 · 214 files. Baseline 1867 -> +64. Sin regresion 37/38/39/40/56
- ./init.sh: VERDE (init OK, migraciones con down.sql, .env presente)
- Round-trip migracion: OK contra Postgres REAL (no regex)

### Metodo del round-trip (Postgres real, localhost:5432 db ordenex)
Introspeccion via Prisma client sobre pg_enum / pg_indexes / pg_class:
- Pre: enum = solicitado,aprobado,rechazado,vencido; idx cierre_dia_mensajero_id_estado_idx
  presente; cierre_bodega_zona_solicitado_uq (feature 40) presente; RLS ON en cierre_dia y
  cierre_bodega; 0 filas vencido (precondicion del down satisfecha).
- Down (pnpm db:rollback ejecuta down.sql via prisma db execute): enum revertido a 3 valores;
  idx compuesto DROPPED; uq40 RECREADO (feature 40 intacta); RLS ON; default restaurado a solicitado.
- Re-apply (prisma migrate deploy): enum de vuelta a 4 valores; idx presente; uq40 presente; RLS ON.
Reversible de verdad. El down suelta/recrea el indice unico parcial de la 40 alrededor del
cambio de tipo (documentado en down.sql; correcto).

## Checklist CHECKPOINTS
- [x] requirements.md EARS numerado (R1..R24) + bloque F1.4 APROBADA 2026-07-12
- [x] design.md con alternativas descartadas (A1..A5, incl. A5 = regla estricta Q4)
- [x] tasks.md: TODAS las tasks A1..G3 marcadas [x]
- [x] Cada R-n mapea a >=1 test concreto y NO vacio (muestreo abajo)
- [x] Mapa R->test en progress/impl_41-...md
- [x] typecheck / lint / test verdes; init.sh verde
- [x] E2E del flujo critico EXISTE (e2e/reglas-bloqueos-cierre.spec.ts) — escrito, no ejecutado
- [x] Sin tablas nuevas -> RLS de cierre_dia/cierre_bodega intacta (verificado en round-trip)
- [x] Migracion versionada + down.sql + db:rollback funciona (verificado real)
- [x] Sin secretos hardcodeados: CRON_SECRET via env (lib/config/cron.ts)
- [x] Cron: valida token Bearer (401 sin/incorrecto/ausente-config) + idempotente
- [x] Capas: route (Controller) sin queries ni negocio; service sin HTTP; repo solo queries
- [x] No hardcode de pais/moneda/contexto

## Auditoria money-critical y de diseño
1. Snapshot inmutable (R4): OK. cierre-totales.ts usa Prisma.Decimal en todo; cero
   parseFloat/Number sobre montos en rutas tocadas. resolverCierre solo transiciona estado IN
   (solicitado,vencido) -> jamas toca aprobado/rechazado. crearCierre solo INSERTa y vincula
   SUS gestiones pendientes -> no muta otros cierres.
2. Corte diario (Q1/R5/R6/R9/R11): OK. Route 401 sin/incorrecto secreto Y 401 si el secreto no
   esta configurado, ANTES de construir el service. Vencido solo para mensajero con >=1 gestion
   cierre_id IS NULL sin solicitado. Idempotente: crearCierre devuelve null (rollback) si vincula 0.
   Schedule 0 6 * * * = 00:00 CR con asercion real sobre vercel.json. R24: 200 solo conteos
   (test asegura no filtra secreto ni mensajerosSinZona); log P2 agregado sin PII.
3. Bloqueo mensajero derivado (Q3/R12/R16): OK. bloqueantes = solicitado,vencido; rechazado/
   aprobado no bloquean; derivado sin flag; desbloqueo por resolucion.
4. Bloqueo satelite estricto (Q4/R17/R18): OK. (i) cierre_dia destino satelite en solicitado/
   vencido OR (ii) CierreBodega propio solicitado. Devuelve bloqueada/porMensajeros/porCierreBodega.
   Tests con las 4 combinaciones + asercion de WHERE.
5. Resolucion del vencido (Q5/R19): OK. Guardia de la 38 extendida a estado IN (solicitado,
   vencido); NO debilitada para aprobado/rechazado (excluidos -> count 0 -> conflict). No recalcula.
6. Contrato crearCierre Promise string-o-null: OK, no es debilitamiento. solicitarCierre maneja
   cierreId === null -> conflict (linea 219). 37/39/56 verdes.
7. Concurrencia (R23): parcial-justificado. Path satelite integra NOT EXISTS en el MISMO
   executeRaw de asignarSateliteLote; crearCierre rollback null si vincula 0. Path MAESTRO solo
   pre-check (deuda #1).
8. UI (Q6/R20/R21/R22): OK. Tests de componente con aserciones especificas: badge Vencido
   resoluble (R20); aviso role=alert del mensajero (R21); aviso por causa (i)/(ii) + Asignar
   deshabilitado (R22).

## Muestreo de trazabilidad (tests reales, no vacios)
R5/R24: corte-diario-route.test.ts: 401x3 + spy no llamado + body sin secreto.
R11: assert vercel.json schedule = 0 6 * * *. R17: 4 combinaciones + WHERE.
R19: guard solicitado|vencido. R21/R22: aviso/disabled. R4: Decimal/no-recalc.
Sin R sin test; sin test tautologico detectado.

## Hallazgos

### BLOQUEANTES
Ninguno.

### Menores / deuda (accionables — no bloquean el done)
- menor #1 — TOCTOU residual en el lote del MAESTRO (R13/R23). generarGuiaLote/asignarBodegaLote
  corren en transaccion pero NO reintegran el NOT EXISTS de cierre bloqueante; dependen del
  pre-check findMensajerosBloqueados en el service. Ventana estrecha (pre-check -> escritura)
  donde un mensajero recien bloqueado podria recibir una asignacion. EVALUACION: no bloqueante
  porque (a) el diseño lo documento y justifico (design 3.3 + debt), aprobado en F1.4; (b) R23
  admite o-transaccion y el lote maestro es transaccional; (c) el path money-adjacent (satelite,
  mensajero fijo) SI tiene el NOT EXISTS; (d) impacto operativo y recuperable (los totales ya
  estan snapshot, sin corrupcion de dinero) y el siguiente intento ya bloquea. Follow-up:
  integrar el NOT EXISTS en el WHERE de generarGuiaLote/asignarBodegaLote.
- menor #2 — R23 sin test de carrera real contra DB. El anti-TOCTOU satelite se verifica por
  regex sobre el SQL del executeRaw + el null-en-0 de crearCierre por unit; no hay integracion
  con insercion concurrente entre lectura y escritura. Mecanismo estructuralmente presente.
  Follow-up: test de concurrencia real.
- menor #3 — .env.example gitignored. CRON_SECRET no queda en un .env.example trackeado; si
  documentado en lib/config/cron.ts y el header del route. Sin secreto hardcodeado (checkpoint
  satisfecho). Follow-up: documentar CRON_SECRET en archivo trackeado (README/deploy).
- menor #4 — E2E escrito pero no ejecutado. e2e/reglas-bloqueos-cierre.spec.ts cubre el flujo
  critico (corte->bloqueo->rechazo->resolucion->desbloqueo) pero no corre bajo pnpm test,
  consistente con 37/38/40/56. El checkpoint pide que el E2E EXISTA y cubra el flujo: satisfecho.
  Follow-up del proyecto: pipeline E2E ejecutable.

## Conclusion
Feature completa, verificada de forma ejecutable y sin regresion. Trazabilidad R1..R24 integra
con tests reales. Puntos money-critical correctos. Las 4 deudas son menores, documentadas y no
comprometen dinero.
VEREDICTO: APROBADO.
