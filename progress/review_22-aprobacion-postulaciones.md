# Review feature 22 — Aprobación de postulaciones de mensajeros

Reviewer: agente reviewer. Rama `feature/22-aprobacion-postulaciones`. Backend puro, sin migraciones.

## Veredicto: APROBADO

Sin hallazgos MAYORES (bloqueantes). 1 hallazgo menor (observación de reuso).

## Verificación ejecutada (npm)
- `npm run typecheck`: VERDE, 0 errores. (El error transitorio previo en `postulacion-login-regresion.test.ts` de F21 NO reaparece; typecheck limpio.)
- `npm run lint`: 0 errores; 135 warnings, todos en `.claude/skills/**` (ajenos a F22).
- Tests F22 aislados: 40/40 passed (4 archivos).
- `npm test` (suite completa): 999/999 passed, 0 failed (esta corrida no arrojó flaky).

## Checklist CHECKPOINTS
- [x] requirements.md EARS numerado R1..R21 + decisiones F1.4.
- [x] design.md con alternativa descartada.
- [x] tasks.md: 15/15 tasks marcadas `[x]`.
- [x] Cada R<n> mapeado a test concreto (tabla abajo).
- [x] impl_22 contiene el mapa R->test.
- [x] typecheck / lint / test verdes.
- [x] Sin tabla nueva / sin migración => RLS N/A (feature sin migración; confirmado: 0 archivos en prisma/migrations en el diff).
- [x] Sin secretos hardcodeados (TTL, bucket y page size por env con default).
- [x] Capas separadas: interface/service/repository/action/storage; Service no conoce HTTP; Repository solo Prisma; Action traduce dominio->contrato con withErrorHandler+toActionError.
- [x] Mutaciones vía Server Actions (`'use server'`), no rutas API.
- [x] Sin país/moneda/cuenta hardcodeados.
- [x] Alcance: 0 archivos nuevos en `app/` o `components/`; sin cambios a F21.

## Decisiones F1.4 verificadas
- P1: rechazar -> `inactivo`, aprobar -> `activo` (valores existentes del enum). Confirmado en service `decidir`. CERO migraciones.
- P2: no se persiste motivo (sin columna/migración). Confirmado.
- P3: bucket privado `mensajero-docs` (postulacionConfig.BUCKET) con TTL 300 s configurable (`APROBACION_SIGNED_URL_TTL_SECONDS`). Confirmado.
- P4: sin auditoría. Confirmado.

## Autorización (test por rol)
- R2 maestro/admin -> ok (parametrizado). R3 mensajero/adminTienda/adminSatelite -> forbidden sin tocar repo/signedUrl (asserts). R4 sin sesión -> unauthenticated (listar/aprobar/rechazar). R5 guard antes de datos/storage. Todos con test.

## Trazabilidad R -> test
| R | Test | OK |
|---|------|----|
| R1 | action: 3 fns `'use server'`, sin route handler (estructural) | si |
| R2 | service R2 maestro/admin autorizados | si |
| R3 | service R3/R5 no autorizados -> forbidden sin tocar repo/signed | si |
| R4 | action R4 sin sesión -> unauthenticated (x3) | si |
| R5 | service R3/R5 asserts repo/signed no llamados | si |
| R6 | service R6 + repo R6/R7/R8 filtro rol+estado | si |
| R7 | service R7 identidad/contacto + repo R7 vehiculo null | si |
| R8 | service R8 5 docs con URL firmada + storage batch | si |
| R9 | service R9 TTL en DTO + storage ttl/path | si |
| R10 | service R10 skip/take + total | si |
| R11 | service R11 + repo R11 lista vacía total 0 | si |
| R12 | service R12/R15 + repo updateMany condicional | si |
| R13 | service R13 not_found | si |
| R14 | service R14 conflict + carrera + repo count 0 | si |
| R15 | service R12/R15 solo cambia estado | si |
| R16 | service R16/R19 rechazar -> inactivo | si |
| R17 | service R17 not_found | si |
| R18 | service R18 conflict + repo count 0 | si |
| R19 | service R16/R19 no borra | si |
| R20 | action R20 mapea forbidden/not_found/conflict/ok | si |
| R21 | action R21 id inválido -> validation_error sin service | si |

## Hallazgos
- [menor] Reuso: la feature crea `AprobacionPostulacionRepository` y `SupabaseSignedUrlProvider` propios en lugar de reusar `MensajeroDocumentoRepository`. No es duplicación de lógica: la consulta es sobre `usuario` (no documentos) y `SupabaseFileStorage` de F21 no expone firma de URLs, por lo que el nuevo puerto de firma está justificado. Se reusa el schema, el bucket (`postulacionConfig.BUCKET`) y `MensajeroDocumento`. No bloqueante.

## Anti-carrera
Transición atómica vía `updateMany` condicional (where estado=pendiente + rol=mensajero); si count=0 reconsulta para distinguir not_found (R13/R17) de conflict (R14/R18). Correcto: dos decisiones concurrentes, solo una ve count=1. Cubierto por test "R14/R18 (carrera)".
