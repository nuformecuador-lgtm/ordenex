# Review 116 — Notas privadas del mensajero por orden

Reviewer (arne SDD). Rama revisada: feature/116-notas-privadas-mensajero
(review desde review-116 = feature + git merge origin/dev). NO se edito codigo de la feature.

## Merge de origin/dev
Auto-merge LIMPIO (estrategia ort), unico archivo tocado lib/clients/whatsapp-cloud.ts
(fix de lint de PR #151, que 116 no toca). Sin conflictos. Resultado empujado a
feature/116-notas-privadas-mensajero (ef30043..9a3b259). El fix de lint queda integrado y
./init.sh ya no corta por ese error.

## Verificacion ejecutable (corrida por el reviewer)
Worktree preparado: pnpm install + copia de .env del repo principal + prisma generate
(Prisma 7.8.0). Resultados reales:

```
pnpm run typecheck  -> OK (tsc --noEmit, 0 errores)
pnpm run lint       -> 0 errors, 143 warnings (preexistentes, ajenos a 116)
pnpm test           -> Test Files 481 passed (481) | Tests 4779 passed (4779)
./init.sh           -> == init OK ==
```

## Checklist del arne
- [x] specs/116/{requirements,design,tasks}.md presentes; requirements EARS R1-R17; design con
      2 alternativas descartadas (columna en orden; DELETE al limpiar).
- [x] Todas las tasks de tasks.md marcadas [x] (A1-A2, B1, C1, D1, E1, F1-F3, G1-G3).
- [x] Trazabilidad R->test: cada R1-R17 mapea a >=1 test con asserts reales (tabla abajo).
- [x] progress/impl_116-*.md contiene el mapa R->test (backend + frontend).
- [x] Sin migracion (R15): el diff origin/dev...HEAD NO anade db/migrations/*; reutiliza
      orden_mensajero_meta + columna nota de la 115.
- [x] Persistencia/authz: upsertNota crea/edita actualizando SOLO nota (preserva marcar_luego);
      limpiarNota = updateMany SET nota=NULL sin borrar fila, no-op idempotente; guardar en blanco
      -> limpiar (R5); usuario_id SIEMPRE del actor; rol mensajero; escritura/lectura acotadas a la
      fila propia; FK P2003 (orden inexistente) -> forbidden sin excepcion cruda.
- [x] Separacion de orden.notas (R7): la nota privada nunca toca orden.notas; el detalle muestra
      DOS campos distintos y etiquetados ("Notas" tienda dd vs "Mi nota" textbox) - verificado por
      test montando GestionarOrdenPanel.
- [x] Lectura (R8): notaPrivada reflejado via el patron real de 115 (findNotasByMensajero dentro
      del Promise.all, proyeccion por usuario_id = actor), sin N+1. MiAsignacionRow no se toco.
- [x] UI (R11/R12/R14): editor "Mi nota" hermano de AsignacionDetalle (presentacion pura intacta),
      indicador badge+preview en la card, router.refresh() en exito. 113/114/115/120 preservados.
- [x] Capas: Server Action (borde, zod, withErrorHandler) -> Service (authz, sin Prisma)
      -> Repository (solo Prisma). Interfaces en lib/interfaces/. Mutacion por Server Action.
- [x] Calidad/seguridad: sin console.* de la nota ni PII en archivos de 116; sin any; mensajes
      de rechazo fijos i18n-ready; el toast de error no filtra el contenido de la nota (test R17).
- [x] Componente cliente recibe datos por props (ordenId, notaInicial); no fetchea datos sensibles.
- [x] Sin secretos ni pais/moneda hardcodeados; no aplica webhook. RLS: 116 no crea tabla (la RLS
      de orden_mensajero_meta es de la 115).

## Tabla R -> test (archivo)
| R | Test |
| --- | --- |
| R1 | nota-privada-mensajero-service.test.ts:48; nota-privada-mensajero-repo.int.test.ts:78 |
| R2 | ...service.test.ts:66; ...repo.int.test.ts:87 |
| R3 | ...repo.int.test.ts:96 (upsert preserva marcar_luego) |
| R4 | ...service.test.ts:102; ...repo.int.test.ts:105,112 (NULL sin borrar + no-op) |
| R5 | ...service.test.ts:83,92 (blanco/vacio -> limpiar) |
| R6 | mis-asignaciones-nota-privada.test.ts:88; ...repo.int.test.ts:141 |
| R7 | mis-asignaciones-nota-privada.test.ts:110; NotaPrivadaMensajero.test.tsx:248 |
| R8 | mis-asignaciones-nota-privada.test.ts:120; ...repo.int.test.ts:141 (A no ve la de B) |
| R9 | ...service.test.ts:56; ...repo.int.test.ts:119 (A no toca fila de B) |
| R10 | ...service.test.ts:28; ...action.test.ts:65 (forbidden / unauthenticated) |
| R11 | NotaPrivadaMensajero.test.tsx:114 (editor con/sin nota) |
| R12 | NotaPrivadaMensajero.test.tsx:280 (indicador card) |
| R13 | ...action.test.ts:37,55,83 (zod: ordenId/nota invalidos -> validation_error) |
| R14 | NotaPrivadaMensajero.test.tsx:135 (exito -> router.refresh) |
| R15 | diff sin db/migrations/*; prisma generate/typecheck verdes (G1) |
| R16 | ...service.test.ts:111; ...action.test.ts:134 (orden inexistente -> forbidden) |
| R17 | NotaPrivadaMensajero.test.tsx:216 (toast sin PII) + grep sin console.* |

## Hallazgos
### Bloqueantes
- Ninguno.

### Menores (no bloquean)
- Reconciliacion spec/codigo: design 3.4 y tasks E1 describian el reflejo via JOIN + un campo
  en MiAsignacionRow. La implementacion siguio el patron REAL de la 115 (findNotasByMensajero en
  el Promise.all, sin tocar esa fila). Desviacion correcta, documentada en el impl log; queda como
  deuda de coherencia del texto del spec.
- Warning de init.sh ajeno a 116: el gate reporta 2 migraciones sin down.sql (plantillas WhatsApp,
  entraron por el merge de dev). Solo es warn; init.sh cierra OK igual. Se reporta al leader.
- R16 verificado a nivel unit: la traduccion FK P2003 a forbidden se prueba con error simulado del
  doble del repo (la suite mockea Prisma semanticamente). Aceptable: la FK real es de la 115.

## Veredicto
**OK / APROBADO** - 0 bloqueantes. Trazabilidad R1-R17 completa con tests reales, sin migracion,
authz por mensajero estructural, separacion de orden.notas verificada, UI con preservacion de
113/114/115/120. init.sh == init OK ==, 481 files / 4779 tests, typecheck 0, lint 0 errors.
