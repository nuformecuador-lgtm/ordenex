# Review — Feature 25 · Gestión de usuarios (configuración)

Reviewer: agente reviewer · Fecha: 2026-07-10 · Rama: `feature/25-gestion-usuarios`
Alcance: backend (Bloque 0–3) + frontend (Bloque 4) + gap de integración de rol.

## Checklist CHECKPOINTS.md

### Especificación
- [x] `requirements.md` con R1–R36 (EARS numerados).
- [x] `design.md` con alternativas descartadas (A1–A6) y su porqué.
- [x] `tasks.md` con T1–T12 todas marcadas `[x]` y mapa R→task→test.

### Trazabilidad
- [x] Cada R1–R36 mapea a ≥1 test concreto y real (no vacío). Verificado por muestreo:
      authz loop cubre las 7 operaciones (crear/listar/obtener/actualizar/cambiarEstado/
      listarTiposIdentificacion/listarRoles) → forbidden (R3/R4); test de rol UUID asserta
      `payload.rolId === "rol-mensajero"`; generatedPassword una vez; etc.
- [x] `progress/impl_gestion-usuarios.md` contiene el mapa R→test (backend + frontend + gap).

### Calidad de código
- [x] TS strict: `npx tsc --noEmit` limpio (init.sh typecheck en verde). Sin `any` en los
      archivos de la 25 (schemas discriminados, DTOs tipados).
- [x] Lint sin errores (warnings pre-existentes ajenos en `.claude/skills/**`).
- [x] `pnpm test`/vitest: 72 tests de la 25 en verde en aislamiento. Ver "Flaky".
- [x] Flujo crítico auth: autz cubierta por unit + integración; no aplica E2E nuevo (reusa
      infraestructura, sin tabla/endpoint nuevos).

### Datos y seguridad
- [x] Sin tabla nueva ni migración: `git diff origin/dev...HEAD` no toca `db/`, `schema.prisma`
      ni `*.sql`. Reusa el modelo `Usuario`. RLS: no aplica (no crea tablas); autz por rol en
      Service (documentado en design §1).
- [x] Sin secretos hardcodeados. Config por env (`lib/config/usuarios.ts`).
- [x] Contraseña: solo se persiste hash bcrypt (`hashPassword`); nunca en claro. No hay
      `console.*`/logger de password/hash en Service, generator ni frontend (grep limpio).
      El generator no incluye el valor en el mensaje de error (R34).
- [ ] Webhooks: no aplica.

### Patrón de capas
- [x] Server Action (controller) valida en el borde (zod) y delega; sin queries DB ni lógica.
- [x] Service sin HTTP; autz ANTES de tocar datos en las 7 operaciones.
- [x] Repository solo Prisma; traduce errores de dominio (Catalogo/Duplicado).
- [x] Interfaces en `lib/interfaces/` separadas (repositories/services).

### Permisos
- [x] `page.tsx` (Server Component) valida `resolveActorFromSession`; `rol !== "maestro"`
      NO renderiza el módulo (muestra "No tienes permiso"). Prefetch server-side.
- [x] Componentes cliente reciben `initialData` por props; no fetchean datos sensibles server-side.
- [x] Mutaciones vía Server Actions, no API routes.

### Multi-país/config
- [x] No hardcodea país/moneda/cuenta.

### Verificación final
- [x] `./init.sh` termina en verde (`== init OK ==`, exit 0).
- [x] Este archivo de review existe.
- [ ] Entrada en `progress/history.md`: pendiente del leader al cerrar (fuera del alcance del review).

## Verificación puntual del encargo

1. **Trazabilidad R1–R36 → test real:** OK. 10 archivos de test presentes y en verde.
2. **Autz solo maestro (R1–R4):** OK. `ALLOWED_ROLES = { maestro }`; chequeo al inicio de
   cada método del Service (antes de tocar el repo). Test recorre admin/mensajero/desconocido
   sobre las 7 operaciones. Page gatea server-side.
3. **Contraseña (R30–R36):** OK. Unión discriminada `passwordMode`; manual usa
   `strongPasswordSchema` **importado** de `lib/types/password-policy.ts` (no duplicado);
   generate usa `generateStrongPassword` (crypto `randomInt`, garantiza clases, autovalida
   contra el schema). `generatedPassword` se devuelve UNA vez solo en modo generate; nunca en
   manual ni en otras acciones; nunca se persiste ni loguea en claro.
4. **No exposición passwordHash (R12/R24/R25):** OK. `UsuarioPublico`, `UsuarioListItem`,
   `LIST_SELECT`/`PUBLIC_SELECT` y todos los results discriminados excluyen `passwordHash`.
5. **GAP de rol (CRÍTICO):** RESUELTO. `UsuarioForm` puebla el select de rol vía SWR sobre
   la action `listarRoles` con `value = rol.id` (UUID) y `label = rol.value`. Ya NO usa
   `ROLES_SEED` para el value (grep sin coincidencias en `configuracion/**`). Prefill en
   edición casa por UUID (`usuario.rolId`). `listarRoles` tiene test (repo/service/action) y
   la misma autz solo-maestro (incluida en el loop forbidden). Test asserta que el payload de
   `crearUsuario` lleva `rolId` = UUID, no el `RolValue`.
6. **Sin migración:** OK, confirmado por diff.
7. **Editables (R16):** OK. `actualizarUsuarioSchema` strict solo nombre/telefono/rolId/
   tipoIdentificacionId; rechaza email/cedula/password. UI deshabilita email y cédula en edición.
8. **Baja lógica (R20–R22):** OK. `setEstado` usa `updateMany` con `estado`; nunca borrado
   físico. Enum acotado a activo|inactivo.
9. **Reuso frontend (R26–R28):** OK. `UsuariosModule` reusa DataTable + Pagination + Modal
   (async, botón bloqueado) + `useToast`, sin duplicar.
10. **TS strict sin any:** OK.
11. **init.sh + suite:** ver abajo.

## Hallazgos

- **Observación (no bloqueante) — flaky de tests bajo carga paralela.** En la corrida completa
  fallan por timeout: `LoginForm`, `recuperar-contrasena-form`, `ordenes-carga-masiva.route`,
  `HomePage` (los cuatro pre-existentes y ajenos al diff de la 25) y, en una corrida,
  `usuario-form` › "modo manual con contraseña débil" (test de la 25). Todos pasan en
  aislamiento: los 72 tests de la 25 en verde aislados; `usuario-form` solo → 5/5 en 6.9 s.
  init.sh terminó en verde (exit 0). Dictamen: NO bloqueante (cumplen en aislamiento y el diff
  de la 25 no toca los flaky pre-existentes).
- **menor — timeout por defecto en un test propio.** `usuario-form` › "modo manual con
  contraseña débil (R5/R6)" corre con el timeout por defecto (5 s), mientras sus hermanos
  pesados (userEvent + selects) recibieron 15–20 s. Bajo carga paralela flakea. Recomendación:
  subir su timeout como los otros para robustez. No afecta la corrección; pasa en aislamiento.

Sin hallazgos BLOQUEANTES.

## Estado de verificación (ejecutado por el reviewer)
- Tests de la 25 en aislamiento (10 files): **72 passed**, exit 0.
- Suite completa: 882–886 passed; los rojos son timeouts flaky que verdean en aislamiento.
- `usuario-form` en aislamiento: **5 passed**.
- `./init.sh`: **== init OK ==**, exit 0.

## Veredicto

**APROBADO** — 0 bloqueantes. El gap de integración de rol (UUID) está cerrado y verificado;
autz solo-maestro correcta en todas las operaciones; contraseña y no-exposición conformes;
sin migración; frontend reusa la infraestructura. Los flaky son pre-existentes/aislables y no
bloquean. Se sugiere (menor) elevar el timeout del test de contraseña débil.
