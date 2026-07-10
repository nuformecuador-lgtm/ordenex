# Feature 21 — Postulación de mensajero · tasks.md

Feature FULLSTACK. Se ejecuta como un solo ciclo con dos slices en orden: primero
**SLICE BACKEND** (backend_dev), luego **SLICE FRONTEND** (frontend_dev), que
depende del backend. Patrón de la feature 20.

Precondición global: **P0** confirmar que la tabla/migración `vehiculos` (feature
50) está presente en `dev` y rebasada en esta rama (ver A1). Bloquea T1.

---

## SLICE BACKEND

### T0 · Confirmar dependencia de vehículos `[P0]`
- Satisface: A1 (precondición de R9, R13).
- Hecho: `db/migrations/**vehiculos**` presente y `vehiculos` con seed (moto/carro/
  camion); `Vehiculo` en `schema.prisma`. Si falta, escalar antes de continuar.

### T1 · Migración de esquema (usuario + mensajero_documento) `[dep: T0]`
- Satisface: R13, R16, R17, R21, R25.
- Editar `db/schema.prisma`: columnas nuevas en `Usuario` (`primerApellido`,
  `segundoApellido`, `vehiculoId`, `placa`), relación a `Vehiculo`, modelo
  `MensajeroDocumento` + enum `MensajeroDocumentoTipo`.
- Crear `db/migrations/<ts>_postulacion_mensajero/migration.sql` (UP) y `down.sql`
  (DOWN) según design §1.3, con RLS en `mensajero_documento`.
- Hecho: `pnpm run db:migrate` aplica; `pnpm run db:rollback` revierte limpio;
  `usuario` conserva filas existentes (columnas nullable).

### T2 · Tipos + validación zod `[P] [dep: T1]`
- Satisface: R2, R4, R5, R6, R7, R8, R9, R10, R11.
- `lib/types/postulacion-mensajero.ts`: `postulacionSchema` (reusa
  `numericIdentifierSchema` y `MAX_PASSWORD_LENGTH`), refine confirmación,
  normalización de `placa`, validador de archivos (MIME + tamaño), tipos de
  resultado.
- Hecho: unit tests de schema verdes (R4-R11).

### T3 · Interfaz + impl de almacenamiento `[P] [dep: T1]`
- Satisface: R16, R18, R24.
- `lib/interfaces/external/IFileStorage.ts` (`upload`, `remove`) y
  `lib/storage/SupabaseFileStorage.ts` (bucket privado `mensajero-docs`, service
  role). Config env de límites/bucket en `lib/config/postulacion.ts`.
- Hecho: unit test con mock de `IFileStorage`; impl usa `createServerClient`, sin
  URL pública.

### T4 · Repositorios `[dep: T1]`
- Satisface: R13, R15, R16, R19, R20, R21.
- Extender `IUserRepository.CreateUsuarioInput` + `UserRepository.create` con
  campos nuevos; resolutor de rol `mensajero` y validación de vehículo/tipo.
- `IMensajeroDocumentoRepository` + `MensajeroDocumentoRepository` (`createMany`,
  `findByUsuario`).
- Hecho: unit tests de repos (mapeo P2002 → duplicado; createMany).

### T5 · Service de postulación `[dep: T2, T3, T4]`
- Satisface: R7, R9, R12, R13, R14, R15, R16, R19, R20, R24.
- `lib/interfaces/services/IPostulacionMensajeroService.ts` +
  `lib/services/PostulacionMensajeroService.ts` con el flujo del design §3.2
  (resolver rol → unicidad → hash → subir → transacción crear usuario+docs →
  limpieza si falla).
- Hecho: unit tests cubren R12/R14/R15/R16/R19/R20/R24 con repos y storage mockeados.

### T6 · Server Action pública `[dep: T5]`
- Satisface: R1(parcial), R22, R26(contrato).
- `lib/actions/postulacion-mensajero.ts` (`'use server'`): recibe FormData, valida,
  delega, traduce con `withErrorHandler`/`toActionError`. No lee cookies ni setea
  sesión.
- Hecho: unit test de la action confirma no-cookie (R22) y mapeo de resultados.

### T7 · Verificación backend `[dep: T6]`
- Satisface: R21, R23, R25.
- Integración: constraint único (R21), RLS activa (R25), regresión login de cuenta
  `pendiente` → `account_unavailable` (R23).
- Hecho: `pnpm run typecheck`, `pnpm run lint`, `pnpm test` (backend) verdes;
  `./init.sh` verde.

---

## SLICE FRONTEND (depende de todo el slice backend)

### T8 · Página pública de postulación `[dep: T6]`
- Satisface: R1.
- `app/postulacion/page.tsx` (Server Component mínimo, sin datos sensibles) +
  ruta accesible sin sesión; enlace desde `app/login`.
- Hecho: integración GET `/postulacion` → 200 sin sesión (R1).

### T9 · Formulario de postulación `[dep: T8]`
- Satisface: R2, R3, R10, R11, R26.
- `app/postulacion/_components/PostulacionForm.tsx` (cliente): campos R2 + 5 file
  inputs `accept="image/*"`, validación cliente (zod compartido + tipo/tamaño),
  `useTransition`, errores accesibles, envío FormData a la action; confirmación en
  `ok` (R26), errores de campo/`conflict`.
- Hecho: component tests verdes (render campos, validación cliente, error dup,
  confirmación).

### T10 · Verificación final `[dep: T9]`
- Satisface: trazabilidad completa R1-R26.
- Completar `progress/impl_21-postulacion-mensajero.md` con el mapa `R<n> → test`.
- Hecho: `pnpm run typecheck`, `pnpm run lint`, `pnpm test` verdes; `./init.sh`
  verde; todas las tasks `[x]`; cada R mapeado a test.

---

### Marcas de paralelismo
- `[P]` T2 y T3 pueden ir en paralelo tras T1.
- El resto es secuencial por dependencia (T4→T5→T6→T7; T8→T9→T10).
- El SLICE FRONTEND no arranca hasta que T6 (contrato de la action) está estable.
