# Review — Feature 33: bodega satélite "mis asignaciones" y recepción por QR

**Veredicto: APROBADO (0 bloqueantes)** · reviewer (model opus) · 2026-07-11 · rama `feature/33-recepcion-qr-satelite`

## Verificación ejecutable (regla #5)
El reviewer corrió `./init.sh` él mismo: `== init OK ==`. `pnpm typecheck` verde; `pnpm lint` 0 errores (135 warnings preexistentes en `.claude/skills/*`, ajenos). `pnpm test`: **174 archivos / 1493 tests PASS**. Migraciones con `down.sql`. Además corrió `pnpm build` para dirimir el fallo reportado (ver abajo).

## Trazabilidad R1–R23 → test: COMPLETA (asserts reales verificados por muestreo)
R11/R18 (recibir transiciona con `("o1", ZONA, "os-recibida")`), R12/R14/R15 (rechazos sin efectos: el repo de escritura NO se llama), R16 (validation_error sin tocar service), R7 (módulo sin botón asignar/gestionar), R2/R20/R21 (migration test estático). Hardware (lector/cámara) declarado como verificación manual.

## Decisiones F1.4: implementadas tal cual
- (a) AMBOS mecanismos: cámara (`html5-qrcode`) + input keyboard-wedge, ambos → misma action `recibirPorQr`→`procesar()`.
- (b) `en_bodega_satelite` 13.º valor de `ORDER_STATUS_SEED`, zona derivada de `orden.zonaId`.
- (c) **Alcance por zona server-side, NO falsificable**: `RecepcionSateliteService.recibir` resuelve `zonaId = findUsuarioZonaId(actor)` y rechaza `zona_ajena` si no coincide; `OrdenRepository.recibirEnSatelite` además filtra `zonaId` en el `WHERE` del `updateMany` (doble defensa). El input zod es solo `{ ordenId }`.
- (d) Idempotencia: ya `en_bodega_satelite` → `ya_recibida` sin doble transición (test asserta que `recibirEnSatelite` no se llama); race path (UPDATE 0 filas → relee) cubierto.
- (e) 5 casos de error tipados. (f) dos secciones "Por recibir"/"Recibidas". (g) E2E `e2e/recepcion-satelite.spec.ts` escrito, coherente, typecheckea. (h) UI del maestro NO tocada.

## Migración
`20260711160000_order_status_en_bodega_satelite`: `ALTER TYPE ADD VALUE IF NOT EXISTS` + `INSERT ON CONFLICT DO NOTHING`; `down.sql` condicional (DELETE solo si ninguna orden referencia; enum PG no soporta DROP VALUE, documentado). Patrón feature 30. Transición SOLO desde `en_ruta_bodega_satelite` (guardado en el `WHERE`).

## Autz / capas / no-regresión
Página `notFound` si `rol !== adminSatelite`; service revalida `forbidden` (defensa en profundidad); action lanza `UnauthenticatedError` en el borde. Capas Action→Service→Repository con interfaces separadas; zod + `withErrorHandler`. Ruta propia `recepcion-satelite` (no invade `mis-asignaciones` del mensajero). Cambios a `EstatusBadge`/`estatus-label`/`order-status`/`Sidebar` puramente aditivos. Sin tabla/columna nueva → sin superficie RLS nueva.

## Hallazgo IMPORTANTE (ajeno a la 33, pre-existente) — el fallo de build de `/postulacion`
El reviewer corrió `pnpm build`: **compila OK** (incl. `recepcion-satelite` y `html5-qrcode`, que se importa solo vía `await import(...)` dentro de un `useEffect` de Client Component — nunca en SSR). El ÚNICO fallo es el **prerender de `/postulacion`** (feature 21): hace `prisma.vehiculo.findMany()` en prerender estático sin `export const dynamic`, y sin DB en el entorno de build da `P2021 TableDoesNotExist`. **NO es regresión de la 33** (`app/postulacion/**` no fue tocado). Es un bug latente PRE-EXISTENTE del repo: `/postulacion` debería declararse dinámica (`export const dynamic = "force-dynamic"`) o no consultar Prisma en prerender. **Candidato a feature de corrección aparte.**

## Hallazgos menores (no bloqueantes)
1. `RecepcionSateliteModule.tsx:36` `estadoLegible` usa `orden.zonaNombre || zonaNombre`; el DTO `zonaNombre` no es nullable, así que el fallback nunca se ejercita. Cosmético.
2. Deudas declaradas y aceptadas: migración no aplicada contra Postgres real (cubierta por test estático) y verificación manual de hardware (lector/cámara).
