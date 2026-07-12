# Feature 40 — Cierre de bodega satélite → bodega principal · tasks.md

Zone: `fullstack` · complexity: `high` · depends_on: 38 (`done`) · branch: `feature/40-cierre-bodega-satelite`

> **No empezar hasta que F1.4 esté APROBADA** (ver `requirements.md > Preguntas abiertas`). Las tasks
> asumen los valores recomendados; si el humano cambia una decisión, ajustar la task marcada.
> Convención: `[P]` = paralelizable respecto a las tasks de su mismo bloque. Un commit por task
> (`feat(40): ...`), patrón `docs/conventions.md`. Cada `R<n>` mapea a ≥1 test (CHECKPOINTS).

## T0 — Baseline y arranque
- [ ] Rama `feature/40-cierre-bodega-satelite` desde `origin/dev` (ya creada). `./init.sh` VERDE
  antes de tocar nada (prisma valid, typecheck 0, lint 0, tests, build). **Hecho:** baseline verde
  registrado en `progress/impl_40-*.md`.

## T1 — Modelo de datos + migración (R8, R9, R21, R24, R25) — bloqueante de casi todo
- [ ] Añadir `model CierreBodega` a `db/schema.prisma`, la FK `cierreBodegaId` + relación en
  `model CierreDia`, las relaciones opuestas en `Usuario` (`CierreBodegaSolicitadoPor`/
  `CierreBodegaResueltoPor`) y `Zona` (`cierresBodega`). Reusar enum `CierreEstado` (design §1.1).
  **Hecho:** `npx prisma validate` OK.
- [ ] Crear la migración `db/migrations/<ts>_cierre_bodega/migration.sql` (UP) con: tabla + 3 FKs +
  4 índices + **índice único parcial** `WHERE estado='solicitado'` (R8) + `ENABLE ROW LEVEL SECURITY`
  (R24) + `ALTER TABLE cierre_dia ADD COLUMN cierre_bodega_id` + FK + índice (design §1.3).
  **Hecho:** migración escrita, sin `ALTER TYPE ADD VALUE` (reusa el enum).
- [ ] Escribir `down.sql` (DOWN, orden inverso; NO tocar el enum `cierre_estado`). **Hecho:**
  `pnpm run db:migrate` aplica y `pnpm run db:rollback` revierte limpio (round-trip R25); RLS
  habilitada verificada (R24).

## T2 — Tipos de dominio [P tras T1]
- [ ] `lib/types/cierre-bodega.ts`: schemas zod del borde (`cierreBodegaIdSchema`,
  `rechazarCierreBodegaSchema` con `motivo.trim().min(1)`, R17) + `*Result` de action (dominio +
  `unauthenticated`), espejo de `lib/types/cierres-admin.ts`. Reusar `CierreEstado` de
  `lib/types/cierre.ts` (F1.4-b). **Hecho:** typecheck 0; schemas cubren los inputs de las actions.

## T3 — Interfaces de repositorio [P tras T1]
- [ ] `lib/interfaces/repositories/ICierreBodegaRepository.ts` (adminSatelite):
  `findCierresDiaConsolidables`, `contarCierresDiaSolicitados`, `existeCierreBodegaSolicitado`,
  `crearCierreBodega`, `findCierresBodegaByZona` (design §3.4). **Hecho:** compila; firmas money-safe
  (Decimal→string).
- [ ] `lib/interfaces/repositories/ICierresBodegaAdminRepository.ts` (maestro):
  `findCierresBodega`, `findCierreBodegaConDetalle`, `resolverCierreBodega` (design §3.4).
  **Hecho:** compila; `resolverCierreBodega` devuelve `updated|conflict|fuera_de_alcance`.

## T4 — Repositorios (Prisma) — dependen de T1+T3
- [ ] `lib/repositories/CierreBodegaRepository.ts`: consolidables con el WHERE
  `estado='aprobado' AND destino_tipo='bodega_satelite' AND destino_zona_id=zona AND cierre_bodega_id
  IS NULL` (R5); `crearCierreBodega` transaccional (INSERT + `updateMany` con guardia de link, R9/R10).
  **Hecho:** cubre R5–R10 con tests de integración repo/DB (T10).
- [ ] `lib/repositories/CierresBodegaAdminRepository.ts`: `findCierresBodega` (join zona/usuario +
  `_count`), `findCierreBodegaConDetalle` (reuso `WITH_DETALLE`/`toPendienteRow` de la 37 para las
  gestiones de cada cierre_dia), `resolverCierreBodega` (`updateMany WHERE estado='solicitado'` +
  count distinguidor, R18/R19). **Hecho:** cubre R11/R15/R16/R18/R19 con integración repo/DB.

## T5 — Interfaces de servicio [P tras T2]
- [ ] `lib/interfaces/services/ICierreBodegaService.ts` + `.../ICierresBodegaAdminService.ts`: DTOs
  (`CierreBodegaResumen`, `CierreBodegaDetalleCierre`) reusando `CierreTotales`/`CierreGrupos`/
  `CierreDetalleGestion` (37) y los `*ServiceResult` (design §2). **Hecho:** compila; NO se define un
  DTO de detalle nuevo (reuso 37, R11); ningún DTO expone pago al mensajero (R14).

## T6 — Servicios (lógica de negocio) — dependen de T4+T5
- [ ] `lib/services/CierreBodegaService.ts` (adminSatelite): `listarConsolidacion` (R3–R7 + histórico)
  y `solicitarCierreBodega` (R4/R6/R7/R8/R9/R10). Suma agregada con `Prisma.Decimal` (R10, exacto,
  string). Rol `adminSatelite` (R1). **Hecho:** unit tests con dobles cubren R1, R3–R10.
- [ ] `lib/services/CierresBodegaAdminService.ts` (maestro): `listarCierresBodegaAdmin` (R15),
  `verCierreBodegaDetalle` (R11–R13/R19, firma evidencias con doble `ISignedUrlProvider` R12, agrupa
  con `toDetalleDTO` reuso 37), `aprobarCierreBodega` (R16/R18–R20/R22), `rechazarCierreBodega`
  (R17–R22). Rol `maestro` (R2). **Hecho:** unit tests cubren R2, R11–R23 (transición no muta otras
  tablas, R22).

## T7 — Server Actions — dependen de T6+T2
- [ ] `lib/actions/cierre-bodega.ts` (`'use server'`): `listarConsolidacion`,
  `solicitarCierreBodega`, `listarCierresBodegaAdmin`, `verCierreBodegaDetalle`, `aprobarCierreBodega`,
  `rechazarCierreBodega`. Resuelve actor, `withErrorHandler`, `UnauthenticatedError`, zod en el borde,
  traducción `AppErrorShape` (patrón `cierres-admin.ts`), `buildService` con
  `SupabaseSignedUrlProvider(gestionConfig.EVIDENCIA_BUCKET)`. **Hecho:** integración de action cubre
  R1/R2 (rol) y validación de borde (R17 motivo).

## T8 — UI — depende de T7 [P con T10 en su mayoría]
- [ ] Extender `app/(app)/cierres-admin/page.tsx` + `_components/`: sección "Cierre de bodega".
  adminSatelite → consolidación + "Solicitar cierre de bodega" (gate R6/R7) + histórico + `sinZona`
  (R4). maestro → cola + histórico + detalle agregado (Modal feature 13, evidencia firmada R12,
  totales R11/R13) + Aprobar/Rechazar (motivo R17). Toast (11) + refresco. Datos sensibles por props
  a `private/`. `notFound()` server-side por rol (R1/R2). **Hecho:** `pnpm build` pasa; smoke manual
  del flujo. (Si F1.4-l = módulo nuevo, crear `/cierre-bodega` y añadir item en `menu-visibility.ts`.)

## T9 — Tests unit + integración (trazabilidad R→test) — junto con T4/T6/T7
- [ ] Unit de servicios (dobles, sin DB/red): R1–R7, R10–R15, R17, R19, R23. **Hecho:** cada R con un
  test que describe el comportamiento (conventions.md).
- [ ] Integración repo/DB de test: R8 (índice único parcial → segunda solicitud conflict), R9 (crea +
  vincula, atómico), R10 (snapshot == suma), R16/R18 (transición + doble resolución conflict), R20
  (resueltoPor/resueltoAt), R21 (cierre_bodega_id intacto tras rechazo), R22 (sin otros efectos), R24
  (RLS habilitada), R25 (rollback round-trip). **Hecho:** `progress/impl_40-*.md` mapea R→ruta de test.

## T10 — E2E Playwright (`prov. F1.4-l`) [P tras T8]
- [ ] E2E del flujo money-critical: adminSatelite consolida → solicita → maestro ve la cola → abre el
  detalle agregado → aprueba/rechaza → pasa a histórico. **Hecho:** escrito (ejecución diferida,
  patrón repo 33/34/36/37/38).

## T11 — Verificación final (gate de "done")
- [ ] `npx prisma validate` OK · `pnpm typecheck` 0 · `pnpm lint` 0 · suite de tests verde (con los
  +N nuevos) · `pnpm build` pasa · `./init.sh` VERDE.
- [ ] **Rollback round-trip** de la migración `cierre_bodega`: `db:migrate` → `db:rollback` → status
  pendiente → `db:migrate` reaplica → up to date (R25); RLS verificada (R24).
- [ ] `progress/impl_40-*.md` con la tabla R→test completa; entregar al `reviewer`. **Hecho:** todos
  los R1–R25 (+E2E) con test; 0 bloqueantes.

---

### Grafo de dependencias (resumen)
```
T0 → T1 → {T2[P], T3[P], T5[P]} → T4 → T6 → T7 → T8 → T10[P]
                                    ↘ T9 (junto a T4/T6/T7) ↘
T11 (verificación) cierra todo.
```
