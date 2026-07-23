# Review 115 — Mensajero: marcar orden para "gestionar mas tarde"

Reviewer del arne SDD. Rama revisada: feature/115-marcar-gestionar-luego (diff
contra origin/dev). NO se edito codigo; esto es un veredicto.

## Verificacion ejecutable (corrida por el reviewer, no confiada en la bitacora)

Worktree limpio: pnpm install + pnpm db:generate (client regenerado contra el schema
de 115, con DATABASE_URL dummy — patron del repo, no levanta Postgres).

- pnpm run typecheck (tsc --noEmit): sin errores.
- pnpm run lint (eslint): 0 errores, 143 warnings (todos preexistentes, ninguno en
  archivos de esta feature).
- pnpm run test (vitest run): 457 archivos / 4568 tests — todos verde.
- Suite especifica de 115 (5 archivos): 46 tests verde.
- init.sh: migracion con down.sql presente ("todas las migraciones tienen down.sql").

Coincide con los numeros de progress/impl_115-*.md (4568 tests).

## Checklist CHECKPOINTS

- [x] requirements.md con EARS numerados R1-R20.
- [x] design.md con alternativas descartadas ([D1]-[D4]).
- [x] tasks.md presente. PERO ver hallazgo menor #1: no usa marcas [x].
- [x] Cada R1-R20 mapea a >=1 test real con asserts (tabla abajo).
- [x] impl_115-*.md contiene el mapa R -> test.
- [x] typecheck sin errores (TS strict).
- [x] lint sin errores.
- [x] test (unit + integracion) pasa.
- [~] E2E: T9 opcional, no implementado. La feature NO es flujo critico
  (no auth/pagos/recaudo/ingesta/webhook) -> E2E no exigido por CHECKPOINTS.
- [x] Tabla nueva orden_mensajero_meta con RLS habilitada.
- [x] Migracion con down.sql inverso; db:rollback disponible.
- [x] Sin secretos hardcodeados. N/A webhooks.
- [x] Repository solo Prisma; Service sin HTTP/Prisma (DI por interfaces); Server
  Action como controlador. Interfaces en lib/interfaces/.
- [x] Mutacion interna via Server Action (no fetch a API route).
- [x] Sin hardcode de pais/moneda/cuenta (N/A a esta feature).

## Trazabilidad R -> test (verificada archivo por archivo)

| R | Test (archivo > caso) | Estado |
| - | --------------------- | ------ |
| R1 | orden-mensajero-meta.int.test.ts > "R1: crea la tabla... marcar_luego BOOLEAN NOT NULL DEFAULT false" + "R1/R7: UNIQUE (usuario_id, orden_id)" | OK |
| R2 | int > "R2: la MISMA migracion crea la columna nota TEXT NULLABLE" | OK |
| R3 | int > "R3: habilita RLS y NO define ninguna policy" (assert ENABLE ROW LEVEL SECURITY + not CREATE POLICY) | OK |
| R4 | int > "R4: DROP TABLE arrastra PK, indices, FKs y RLS" (assert estatico sobre down.sql) + init.sh valida existencia | OK (ver menor #2) |
| R5 | orden-mensajero-meta-service.test.ts > "R5: marcar setea true"; action happy path; MarcarLuegoToggle.test.tsx > "R5..." | OK |
| R6 | service > "R6: quitar setea false"; toggle > "R6..." | OK |
| R7 | int > "R7: dos toggles... EXACTAMENTE una fila" (upsert semantico) + UNIQUE estatico | OK |
| R8 | service > "R8: usa el usuario_id del actor..."; int > "R8: usuario_id persistido = actor" (input usuarioId:hacker ignorado) | OK |
| R9 | action.test.ts > "R9: rechaza ordenId vacio", "rechaza marcarLuego no booleano" (schema) + "R9: validation_error" (action) | OK |
| R10 | action > "R10 — unauthenticated antes de tocar el service" | OK |
| R11 | service > "R11: forbidden si el rol no es mensajero"; action > "R11: propaga forbidden" | OK |
| R12 | service > "R12: no puede escribir la fila de otro mensajero" | OK |
| R13 | service > "R13: forbidden orden ajena" + "R13: forbidden si null"; action > "R13"; int > "R20: m2 marcando o1 -> forbidden" | OK |
| R14 | service > "R14: not_found"; action > "R14: propaga not_found" | OK |
| R15 | service > "R15/R16: no llama ningun mutador de la orden"; int > "R15/R16" | OK |
| R16 | Igual que R15 + garantia ESTRUCTURAL: el service solo recibe Pick<IOrdenRepository,"findById"> + metaRepo -> sin acceso a escribir estatus/ruta/historial | OK |
| R17 | mis-asignaciones-marcar-luego.test.ts > "R17: true/false/default false"; int > "R17: findMarcarLuegoByMensajero" | OK |
| R18 | MarcarLuegoToggle.test.tsx > "R18: la card marcada muestra el badge; la no marcada no" | OK |
| R19 | toggle test > "R19: marcadas DESPUES de no marcadas sin cambiar la secuencia de ruta" + "R19: sin marcadas, orden intacto" | OK |
| R20 | mis-asignaciones-marcar-luego.test.ts > "R20: solo consulta con el usuarioId del actor"; int > "R8/R20: un mensajero no ve las marcas de otro" | OK |

Ningun R quedo sin test real. No hay tests vacios ni tautologicos.

## Verificacion puntual pedida por el leader

1. Persistencia (R1-R4). migration.sql: marcar_luego BOOLEAN NOT NULL DEFAULT false,
   nota TEXT NULLABLE, UNIQUE(usuario_id, orden_id), dos FK ON DELETE CASCADE a
   usuario/orden, indices por FK, ENABLE ROW LEVEL SECURITY sin policies. down.sql =
   DROP TABLE IF EXISTS (revierte exacto por cascada). Modelo Prisma en sincronia
   (con nota String? para la 116).
2. Authz (R8-R14, R20). usuario_id lo fija SIEMPRE actor.usuarioId en el service
   (upsertMarcarLuego(actor.usuarioId, ...)); el input solo aporta ordenId/marcarLuego
   (zod los acota). Rol mensajero obligatorio (ALLOWED_ROL). Propiedad validada via
   ordenRepo.findById (excluye borradas, where:{id, deletedAt:null} -> R14 confirmado
   en OrdenRepository.ts:556). Un mensajero no puede escribir la fila de otro (el where
   del upsert fija su propio usuario_id) ni leerla (findMarcarLuegoByMensajero filtra
   por usuarioId).
3. Solo informativo (R15/R16). Confirmado por diseno y por estructura: el service solo
   tiene Pick<...,"findById"> + metaRepo; es IMPOSIBLE que toque estatus, prioridad,
   ruta o historial. Tests lo verifican con spies.
4. UI (R17/R18/R19). DTO expone marcarLuego; badge variant="warning" cuando marcada;
   useMemo con sort estable (Number(a.marcarLuego??false) - Number(b.marcarLuego??false))
   sobre COPIA [...porGestionar] -> hunde las marcadas sin mutar porGestionar ni la ruta
   (mapa/secuencia siguen leyendo el original; test verifica que "Parada N" no cambia).
5. DTO marcarLuego opcional — verificado. toDTO fija SIEMPRE marcarLuego: false
   (MisAsignacionesService.ts:427) y listarMisAsignaciones lo sobreescribe con
   marcadasLuego.has(row.id) (linea 142) -> SIEMPRE un booleano concreto en el camino
   real del server. Ningun consumidor recibe undefined desde el server; el modulo ademas
   guarda con ?? false. R17 se cumple de facto. (ver menor #3)

## Hallazgos

### Menores (no bloquean)

- menor #1 — tasks.md sin marcas [x]. El tasks.md de 115 usa encabezados ### T1..T9 sin
  casillas de estado, a diferencia del hermano 111 que si usa - [x]. CHECKPOINTS pide
  "todas las tasks marcadas [x]". Todo el trabajo esta demostrablemente completo y
  trazado (T1-T8 con test; T9 explicitamente opcional y no hecho), pero ninguna task
  queda marcada literalmente. Recomendacion: anadir el estado de cada task. No es
  defecto funcional.
- menor #2 — round-trip real de la migracion diferido al humano. R4 se cubre con
  asercion estatica sobre down.sql + el chequeo de existencia de init.sh; el up->down->up
  contra Postgres real NO se ejecuto (la suite usa mocks semanticos de Prisma, patron
  api_key-migration del repo). Consistente con la convencion del repo y documentado en
  la bitacora. Aceptable.
- menor #3 — MiAsignacionDTO.marcarLuego opcional en el tipo. Sigue la convencion
  aditiva del repo (OrdenDTO.mensajeroAsignadoId?/prioridad?). El productor siempre emite
  booleano y los consumidores guardan con ?? false, asi que no hay riesgo de undefined en
  runtime. Deuda de tipado menor, no funcional.

### Bloqueantes

Ninguno.

## Veredicto

OK / APROBADO. No hay hallazgos bloqueantes. R1-R20 trazados a tests reales; persistencia,
autorizacion, "solo informativo" y UI cumplen el diseno; ./init.sh, typecheck, lint y la
suite (4568 tests) en verde verificados por el reviewer. Los tres hallazgos son menores y
no impiden el cierre.
