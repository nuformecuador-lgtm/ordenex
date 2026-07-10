# Review — Feature 21 · Postulación de mensajero

Reviewer: agente reviewer. Rama `feature/21-postulacion-mensajero` (worktree ordenex-f21).
Fecha: 2026-07-10.

## Veredicto: CAMBIOS REQUERIDOS

1 hallazgo MAYOR (bloqueante), 2 menores. Todo lo demás (spec, capas, decisiones
F1.4, seguridad, migración, alcance por slice, typecheck/lint/test verdes) pasa.

## Verificación ejecutable (corrida por el reviewer, npm)
- `npm run typecheck`: VERDE (0 errores).
- `npm run lint`: VERDE (0 errores; warnings preexistentes solo en `.claude/skills/**`).
- `npm test`: VERDE — **884 passed / 884**, 112 archivos, ~131s. Sin flaky en esta corrida
  (los 2 flaky de auth mencionados por el implementer no aparecieron).

## Trazabilidad R → test
| R | Test | Estado |
| --- | --- | --- |
| R1 | tests/integration/postulacion-page.test.tsx | OK |
| R2 | postulacion-schemas.test.ts + PostulacionForm.test.tsx | OK |
| R3 | postulacion-schemas.test.ts (falta doc) + service.test (5 docs) | OK |
| R4 | postulacion-schemas.test.ts (campos obligatorios) | OK |
| R5 | postulacion-schemas.test.ts (email inválido) | OK |
| R6 | postulacion-schemas.test.ts (password 8..72, A5) | OK |
| R7 | postulacion-schemas.test.ts (confirmación) | OK |
| R8 | postulacion-schemas.test.ts (cédula/teléfono numéricos) | OK |
| R9 | postulacion-mensajero-service.test.ts (vehículo/tipo inexistente) | OK |
| R10 | postulacion-schemas.test.ts + validarArchivo | OK |
| R11 | postulacion-schemas.test.ts (placa trim+upper) | OK |
| R12 | service.test (rol mensajero, no fuerza estado) | OK |
| R13 | service.test + migration.test (columnas+FK) | OK |
| R14 | service.test (hash bcrypt) | OK |
| R15 | service.test (resuelve rol, no crea catálogos) | OK |
| R16 | service.test (5 uploads+5 filas) + migration.test (unique) | OK |
| R17 | (ninguno) — impl apunta a MensajeroDocumentoRepository.findByUsuario, que es código de producción SIN test | **FALTA** |
| R18 | supabase-file-storage.test.ts (bucket privado, sin URL pública) | OK |
| R19 | service.test (conflict email) | OK |
| R20 | service.test (conflict cédula) | OK |
| R21 | service.test (P2002→conflict) + migration.test (no duplica unique) | OK |
| R22 | postulacion-action.test.ts (sin cookies) + page.test | OK |
| R23 | postulacion-login-regresion.test.ts (login pendiente bloqueado) | OK |
| R24 | service.test (limpieza de archivos, sin cuenta parcial) | OK |
| R25 | postulacion-mensajero-migration.test.ts (RLS sin policies) | OK |
| R26 | PostulacionForm.test.tsx (confirmación, sin redirección) | OK |
| A4 | postulacion-action.test.ts (rate_limited) | OK |

## Decisiones F1.4 — verificadas
- A2 (Storage bucket PRIVADO, paths persistidos, no bytea): OK. `SupabaseFileStorage`
  sube al bucket `mensajero-docs`, guarda `storage_path`, nunca URL pública (R18).
- A3 (duplicado = error por campo): OK. `conflict{field:"email"|"cedula"}` en service/repo;
  el frontend lo pinta en el campo exacto (`CONFLICT_MESSAGES`).
- A4 (rate-limiting en acción pública): OK. `ResetRateLimiter` reusado por IP|email.
- A5 (min 8 + confirmación, reusa strongPasswordSchema): OK. `postulacionSchema` importa
  `strongPasswordSchema` de `lib/types/password-policy.ts`; confirmación por `.refine`.

## Coherencia con spec y patrones — verificada
- Migración nueva `20260710170000_postulacion_mensajero` sin editar previas; `down.sql`
  correcto (orden tabla→tipo, FK/índice antes de columnas). OK.
- FK `usuario.vehiculo_id -> vehiculos.id` (ON DELETE RESTRICT); tabla `mensajero_documento`
  con FK CASCADE (base de limpieza R24). OK.
- Extensión de `Usuario` (primer/segundo apellido, vehiculo_id, placa) nullable. OK.
- Cuenta rol `mensajero`, estado default `pendiente` (no se pasa `estado`). OK.
- bcrypt reusado (`hashPassword`, coste 10). OK.
- Capas interface/service/repository/action separadas; action pública sin sesión;
  no implementa aprobación (feature 22). OK.
- Frontend: página pública `app/postulacion` fuera de `app/(app)`, shadcn/ui, validación
  por campo con el schema compartido, solo consume la Server Action. OK.
- Tests-guard feature 50 (vehiculos.test.ts / vehiculos-migration.test.ts): cambios
  legítimos, acotados y comentados (el FK que la 50 difirió a la 21 ahora existe; la
  migración de la 21 se apéndió con timestamp posterior). NO es un debilitamiento indebido. OK.

## Alcance por slice — verificado
- Backend: NO añadió UI (archivos en db/, lib/). OK.
- Frontend: NO tocó DB/migraciones/actions/services; solo `app/postulacion/**` y un enlace
  en `app/login/_components/LoginForm.tsx`. OK.

## Hallazgos

### MAYOR (bloqueante)
- **R17 sin test.** El requisito R17 ("el perfil DEBE poder referenciar la foto_rostro a
  partir del documento almacenado") no está cubierto por ningún test. El mapa del impl lo
  asigna a `MensajeroDocumentoRepository.findByUsuario`, pero eso es código de producción,
  no una verificación: no existe ningún test que ejercite `findByUsuario` ni que afirme que
  se resuelve la `foto_rostro`. Regla de trazabilidad (CLAUDE.md §4 / CHECKPOINTS): cada R
  mapea a al menos un test concreto → bloqueante. Para levantarlo: agregar un unit test de
  `MensajeroDocumentoRepository.findByUsuario` que verifique que devuelve los documentos del
  usuario incluyendo el path de `foto_rostro`.

### menores
- **Setup de despliegue pendiente (deuda documentada, NO bloqueante).** La migración
  `20260710170000_postulacion_mensajero` no se aplicó a Postgres y el bucket privado
  `mensajero-docs` no se creó. Está correctamente anotado en el impl como acción humana;
  la migración está cubierta por tests estáticos (regex sobre SQL). No lo ejecutó el reviewer.
- **`MensajeroDocumentoRepository` sin cobertura directa.** Relacionado con R17: la clase
  de repositorio de lectura queda sin ningún test propio; conviene cubrirla al cerrar el MAYOR.

