# Review — Feature 76: Ranking DIARIO de mensajeros + tabla de premios (monto + descripcion)

Reviewer (verifica, no edita). Worktree ordenex-f76, rama feature/76-ranking-mensajeros.
Base = origin/dev a014515. Delta = commits 0388bde (backend) + 154a385 (frontend). Fecha: 2026-07-16.

## VEREDICTO: APROBADO — 0 bloqueantes, 2 menores (bookkeeping)

## Numeros de verificacion (MEDIDOS por el reviewer)

- pnpm run typecheck: 0 errores.
- pnpm run lint: 0 errores, 139 warnings (= baseline; ninguno nuevo).
- pnpm test (1a corrida completa): 314 files, 2976 passed / 3 failed (los 3 = timeouts 5000ms flaky).
- pnpm test via ./init.sh (2a corrida): 314 files, 2979 passed / 0 failed.
- ./init.sh: == init OK == (EXIT 0).
- Tests feature-76 en aislamiento (8 files): 68 passed / 0 failed.
- Flaky en aislamiento (HomePageRol, OrdenesModuleReuse, LoginForm, no-embalaje, HomePage): 34 passed / 0 failed.

Los 3 fallos de la 1a corrida son timeouts 5000ms flaky bajo carga, AJENOS a la feature: pasan en
aislamiento y init.sh dio 2979/2979. NO son regresiones (precedente no-embalaje/LoginForm).

## Trazabilidad R1-R25 -> test (cada test EXISTE y PASA; ninguno vacio)

- R1 num/denom con rango CR (ranking-repository): numerador entregada+anuladaAt:null+rango;
  denominador asignadoAt en rango + mensajeroAsignadoId not null. OK.
- R2/R12 pct = entregadas/asignadas*100, redondeo 1 decimal EN SERVIDOR, STRING. OK.
- R3 asignadas=0 -> pct null, al final, sin podio. OK.
- R4/R5 orden desc por pct; desempate # entregas desc luego nombre asc; determinista. OK.
- R6 conteo crudo expuesto. OK.
- R7 umbral podio configurable default 1, env override, invalido->default. OK.
- R8 exactamente 3 posiciones (UNIQUE + CHECK 1..3 + seed). OK.
- R9 monto null = sin premio, nunca 0 (repo/service/UI). OK.
- R10 guardar/vaciar monto+descripcion persiste + revalidatePath. OK.
- R11 monto invalido (negativo, >2 dec, no numerico) rechazado: zod en el borde Y regex en service. OK.
- R13/R14/R15 tabla ordenada; premio junto al ocupante elegible; posicion sin ocupante no se inventa. OK.
- R16/R17/R18/R19 autz maestro edita / mensajero solo-lectura / otro-sin sesion -> notFound/forbidden /
  mensajero editando -> forbidden. Defensa en profundidad: guard en page.tsx Y en RankingService Y en action. OK.
- R20 menu /ranking maestro+mensajero, comentario corregido a intencional. OK.
- R21 tabla premio_ranking con RLS habilitada + down.sql (DROP TABLE). OK (round-trip real pendiente).
- R22 sin hardcode pais: dia por startOfDayCR, umbral por lib/config/ranking.ts, moneda por labels
  (money-safe STRING sin parseFloat/Number). OK.
- R23 CHOKE-POINT (grep de writers propio del reviewer en lib/repositories): 4/4 writers no-nulos estampan asignadoAt:
  W1 OrdenRepository.ts:837-840 generarGuiaLote (condicional: solo si mensajero no nulo; test cubre ambos casos).
  W2 OrdenRepository.ts:884 asignarBodegaLote (siempre).
  W3 OrdenRepository.ts:1133-1135 asignarSateliteLote (raw SQL: asignado_at = NOW(); test verifica el SQL).
  W4 CierreDiaRepository.ts:487-488 deshacer-gestion repone (siempre).
  CierreDiaRepository.ts:207 correctamente DESCARTADO (es un count en where, no writer).
  Ningun path de asignacion quedo sin instrumentar.
- R24 columna orden.asignado_at nullable + indice (mensajero_asignado_id, asignado_at) + down.sql; historicas NULL. OK.
- R25 descripcion texto libre opcional independiente del monto; vacio->null; upsert+action; UI con input y vista solo-lectura. OK.
- LC1 devolucion intradia: 3/3 limpiezas ponen asignadoAt:null (C1 GestionOrdenRepository.ts:273,
  C2 OrdenRepository.ts:932, C3 LiberacionReprogramadaRepository.ts:88) con tests; ranking-service fija
  que la orden limpiada no cuenta en num ni denom. OK.

No hay ningun R sin test que lo verifique.

## Checklist CHECKPOINTS.md

- OK requirements.md EARS numerado (R1-R25).
- OK design.md con alternativas descartadas (A/B/C) y porque.
- PARCIAL tasks.md existe pero las 15 tasks siguen en [ ] (0 marcadas [x]) -> menor M1.
- OK cada R<n> mapea a >=1 test concreto (verificado).
- OK impl_76-ranking-mensajeros.md con mapa R->test (backend + frontend).
- OK typecheck / lint / pnpm test verdes (2979/2979 en corrida limpia).
- OK tabla nueva premio_ranking con RLS habilitada (patron gasto_fijo_plantilla/wallet_movimiento:
  ENABLE RLS sin policies = solo service role; autz de negocio en el service).
- PARCIAL migraciones con down.sql presentes y correctos por lectura; round-trip REAL contra Postgres
  NO ejecutado (no hay .env/DATABASE_URL) -> ver seccion Migraciones.
- OK ningun secreto hardcodeado.
- OK sin webhooks nuevos (N/A).
- OK capas: action con zod en el borde sin queries; service sin HTTP; repo solo Prisma; interfaces en lib/interfaces/.
- OK pagina protegida valida rol server-side via resolveActorFromSession (cookies).
- OK componente cliente recibe datos por props (STRING serializado), no fetchea datos sensibles.
- OK mutacion = Server Action (editarPremioAction), no fetch a API route.
- OK sin hardcode pais/moneda/cuenta.
- OK ./init.sh verde.
- OK review_76-ranking-mensajeros.md (este archivo).
- FALTA entrada en progress/history.md para la 76 -> menor M2 (se anade al cierre).

## Migraciones — estado del round-trip

Verificado ESTATICAMENTE + por lectura del SQL. Round-trip REAL contra Postgres: PENDIENTE de
verificacion humana (no hay .env/DATABASE_URL en el entorno; NO se invento una corrida).

- 20260716120000_orden_asignado_at/migration.sql: ALTER TABLE orden ADD COLUMN asignado_at TIMESTAMP(3)
  (NULLABLE, aditivo) + CREATE INDEX (mensajero_asignado_id, asignado_at). down.sql: DROP INDEX IF EXISTS
  + DROP COLUMN IF EXISTS (revierte exacto, orden inverso).
- 20260716130000_premio_ranking/migration.sql: CREATE TABLE (id TEXT PK, posicion INT, monto DECIMAL(12,2)
  NULLABLE, descripcion TEXT NULLABLE, created_at/updated_at) + CHECK (posicion BETWEEN 1 AND 3) +
  UNIQUE INDEX(posicion) + INSERT 3 filas seed (monto/descripcion NULL) + ENABLE ROW LEVEL SECURITY.
  down.sql: DROP TABLE IF EXISTS (arrastra indice, check, seed y RLS).
- Ambas ADITIVAS: no alteran ni borran datos existentes. prisma migrate diff coincide con el DDL esperado;
  guard zonas-migration.test.ts verde con las 2 carpetas nuevas.

## Alcance (sin drift)

- ordenes-columns.tsx NO tocado (git diff --name-only). Iman de drift, limpio.
- Tests ajenos modificados (orden-repository.guia/asignacion-satelite, cierre-dia, gestion-orden,
  liberacion-reprogramada, zonas-migration): ENDURECIDOS no aflojados — anaden aserciones de asignadoAt
  que reflejan R23/LC1 + whitelist de migraciones. Ninguno borrado ni relajado.
- 42 archivos en el delta, todos dentro del ambito de la feature.

## Hallazgos

MENORES (deuda de bookkeeping, NO bloquean codigo, cerrar antes de done):
- M1 tasks.md con las 15 tasks en [ ]. CHECKPOINTS pide todas [x]. Implementacion verificablemente
  completa (todos los R con test verde, init.sh verde) -> desfase de marcado, no funcional. Marcar T0a-T12 [x].
- M2 falta entrada en progress/history.md para la 76. Ultimo paso del cierre (T12); se anade al mergear.

BLOQUEANTES: ninguno.

## Conclusion

Backend y frontend de la 76 cumplen requirements (R1-R25 + LC1), design y CHECKPOINTS en lo funcional,
de capas y de seguridad. Choke-point R23 verificado de forma independiente por el reviewer: 4/4 writers
instrumentados + 3/3 limpiezas, ninguno omitido. Verificacion verde medida por el reviewer (typecheck 0,
lint 0, init.sh OK 2979/2979). Round-trip real de migraciones pendiente de verificacion humana (sin Postgres);
SQL revisado a mano y correcto.

VEREDICTO: APROBADO (0 bloqueantes; M1 y M2 son bookkeeping a cerrar en el merge).
