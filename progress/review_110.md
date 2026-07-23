# Review — Feature 110: Prioridad de reasignación unificada (reprogramadas y recuperadas)

Rama: `feature/110-prioridad-reasignacion-unificada` (cambios en working tree, HEAD == origin/dev).
Reviewer: verificación, no edición.

## Veredicto global
**CAMBIOS REQUERIDOS** — a nivel de GATE del arnés (`./init.sh` rojo). La **implementación
de la 110 (R1–R10) está APROBADA**: código correcto, trazabilidad completa, typecheck/lint
verdes y todos los tests de la feature en verde. El único bloqueante es un gate de proceso
(concurrencia de features) cuya causa es PREEXISTENTE en `dev`, no un defecto de 110.

## Trazabilidad R1–R10 → test

| Req | Test(s) | Estado |
| --- | --- | --- |
| R1  | `tests/unit/repositories/liberacion-reprogramada-repository.test.ts` (`.toEqual` incl. `prioridad:true` + caso R1/R4 `toHaveBeenCalledTimes(1)`) · integración `tests/integration/db/resolver-novedad-reprograma-sla.test.ts` (repo REAL `liberarOrden` → `prioridad=true`) | ✓ |
| R2  | `tests/unit/repositories/recuperacion-bodega-repository.test.ts` (`.toEqual` incl. `prioridad:true`; flip del caso "NO enciende") · integración `tests/integration/db/resolver-novedad-recupera-sla.test.ts` (repo REAL, central + satélite) | ✓ |
| R3  | ambos repo-tests: `count:0` → `false`, sin `appendCambioEstado` | ✓ |
| R4  | ambos repo-tests: `orden.updateMany` `toHaveBeenCalledTimes(1)` + `data.prioridad===true` (una sola escritura) | ✓ |
| R5  | `git diff origin/dev...HEAD -- db/` VACÍO; `prisma validate` OK; sin nuevo dir en `db/migrations/` | ✓ |
| R6  | ambos repo-tests: `.toEqual` del `data` completo + `Object.keys` exactos (money-neutral) + append (actor/`origen_tipo`) intacto | ✓ |
| R7  | `tests/unit/repositories/devolucion-sla-repository.test.ts` (`liberarDevueltaSla` `prioridad:true`, código línea 98 intacta) | ✓ |
| R8  | `orden-repository.guia.test.ts` + `orden-repository.asignacion-satelite.test.ts` (`prioridad=false` al asignar; código `OrdenRepository` L1381 y L1708 intactas) | ✓ |
| R9  | `tests/unit/repositories/devolucion-sla-repository.test.ts` (`escalarDevueltaSla` `not.toHaveProperty("prioridad")`; código `escalar` sin `prioridad` en su `data`) | ✓ |
| R10 | `orden-repository.test.ts` + `orden-repository.recepcion-satelite.test.ts` (`orderBy [{prioridad:"desc"}, ...]` intacto, L578/L1519) | ✓ |

10/10 cubiertos por tests reales que PASAN. Ningún test vacío.

## Checklist de revisión
- [x] R1/R2 (encendido): `prioridad:true` en el `data` del ÚNICO `updateMany` guardado por estado,
      en la MISMA escritura; append intacto dentro de `if(count>0)`. Copia el patrón de
      `DevolucionSlaRepository.liberarDevueltaSla` (R4). `LiberacionReprogramadaRepository.ts:96`,
      `RecuperacionBodegaRepository.ts:52`.
- [x] R4 atómico: sin escritura extra ni segunda transición (verificado en código y en tests
      `toHaveBeenCalledTimes(1)`).
- [x] R5 sin migración: `git diff -- db/` vacío; `prisma validate` "schema is valid".
- [x] R6 money-neutral: único cambio observable es `prioridad=true`; estado/actor/`origen_tipo`/
      historial y `Object.keys` del `data` sin otros cambios.
- [x] Regresiones R7/R8/R9/R10: código no tocado + tests verdes (76/76 en OrdenRepository).
- [x] Comentarios stale corregidos: `RecuperacionBodegaRepository` (doc de clase + de método) y
      nota de `DevolucionSlaRepository.liberarDevueltaSla` actualizados a la realidad de la 110.
- [x] Desviación T11 justificada: el route-test mockea el service; R1 se cubre con la integración
      REAL `resolver-novedad-reprograma-sla.test.ts` (el fake `updateMany` hace `Object.assign(o,data)`
      sobre el repo real → observa `prioridad=true`). Verificado.
- [x] Capas: cambio contenido en Repository (solo Prisma). Sin tabla nueva (RLS N/A), sin migración
      (down.sql N/A), sin secretos, sin hardcode de contexto.
- [x] Tasks: todas `[x]` en `tasks.md`. Mapa R→test en `progress/impl_110.md`.
- [ ] **`./init.sh` verde** → NO (ver MAYOR-1).

## Verificación ejecutable
- `pnpm run typecheck`: **0 errores**.
- `pnpm run lint`: **0 errores**, 144 warnings (preexistentes; ninguno en archivos de la 110).
- Tests de la feature (5 archivos): **30/30 verdes**. Regresión OrdenRepository (4 archivos): **76/76 verdes**.
- Suite completa (`pnpm test`): **451/452 archivos, 4482/4483 tests** verdes. Único rojo:
  `tests/integration/db/zonas-migration.test.ts` (allow-list de migraciones, deuda AJENA preexistente;
  la 110 no agrega migración). Los flaky (HomePage/HomePageRol/OrdenesModuleReuse/CierreDiaPage) NO cayeron.
- `prisma validate`: OK.
- `./init.sh`: **ROJO (exit 1)** → ver MAYOR-1.

## Hallazgos

### MAYOR-1 (gate, ajeno a la lógica de 110) — `./init.sh` rojo por concurrencia de features
`./init.sh` falla: "más de 2 features in_progress en la misma zona: backend: 103, 104, 106, 110
(4 in_progress, max 2)". CHECKPOINTS exige `./init.sh` verde como verificación final.
- **Causa raíz PREEXISTENTE:** en `origin/dev` ya están `in_progress` las backend 103, 104 y 106
  (3 > 2). La 110 se puso `in_progress` correctamente por proceso SDD; el desbordamiento no lo
  introduce el código de 110.
- **NO es un defecto de código de la 110.** No requiere tocar la implementación.
- **Remediación (leader):** cerrar/parquear o confirmar disjuntas 103/104/106 antes de mover la
  110 a `done`/merge, de modo que `./init.sh` quede verde.

### menor-1 — Working tree con cambios ajenos a la 110
`git status` muestra, además de los archivos de la 110, cambios NO relacionados que deben quedar
FUERA del commit/PR de 110:
- `package.json`: agrega script `db:seed:usuarios` (el archivo `scripts/seed-usuarios-qa.ts` existe).
- `feature_list.json`: cambia la feature **111** de `in_progress` → `done` (ajeno a 110).
Recomendación: al commitear la 110, no arrastrar estos cambios (solo debe cambiar el bloque de la
feature 110 en `feature_list.json`).

## Cierre
Implementación de la 110: sólida, fiel al patrón 101, sin regresiones, R1–R10 trazados y verdes.
El PR de código puede avanzar; el paso a `done`/merge queda condicionado a que el leader deje
`./init.sh` en verde (MAYOR-1) y a limpiar los cambios ajenos del working tree (menor-1).
