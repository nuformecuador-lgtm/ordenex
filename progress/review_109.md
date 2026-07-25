# review 109 — orden sin gestionar: cierre vencido + reasignación prioritaria

> **VEREDICTO: APROBADO** (0 bloqueantes; 1 hallazgo menor RESUELTO; 1 follow-up no bloqueante).
> Rama `feature/109-sin-gestionar-cierre-vencido`. Spec: `specs/109-sin-gestionar-cierre-vencido/`
> (R1–R31). Bitácora: `progress/impl_109.md`.

## Nota de proceso (transparencia)

La revisión la ejecutó el subagente `reviewer` (model opus), que verificó de forma independiente el
conjunto bloqueante (R29), el flujo de rechazo (38/111), la liberación al aprobar, y la cobertura
R11–R31. El `reviewer` **no pudo escribir este archivo**: su rol solo tiene `Bash` (no `Write`) y el
heredoc con backticks/`$` rompía el parseo del shell, agravado por cortes de API repetidos en la
sesión. El **leader transcribió y completó el veredicto tras re-verificar en el código** los puntos
abiertos. Se documenta el conflicto de rol: el leader remató parte de la implementación backend
(ver `impl_109.md > Remate del leader`); esas zonas se revisaron con foco extra.

## Verificación ejecutable

- `pnpm typecheck`: 0 errores.
- `pnpm lint`: 0 errores (143 warnings baseline).
- `pnpm test`: **4522 / 4522** (452 archivos), sin rojo ajeno. Verificado por el leader tras el
  cierre del frontend.

## Trazabilidad R1–R31 → test (verificada)

Todos los R mapean a un test REAL que existe y pasa. El mapa completo con rutas/líneas vive en
`impl_109.md > Mapa R → test`; se verificó puntualmente:

- **Corte extendido (R4–R10, R24, R29):** `corte-diario-repository.test.ts`,
  `corte-diario-service.test.ts` (incluye idempotencia, exclusión de los 3 estados abiertos,
  fallback si el catálogo no tiene `sin_gestionar`), `cierre-dia-repository.test.ts:356-475`
  (crearCierre corteSinGestionar; :446 `vencido` money-neutral con 0 gestiones, no `null`).
- **Choke point (R6/R18/R22):** `orden-historial-cobertura.test.ts` a **20 puntos** (agregados #19
  `crearCierre→corte_sin_gestionar` y #20 `resolverCierre→liberacion_sin_gestionar`; `crearCierre`
  sale de `NO_ESCRIBEN_ESTADO`). Los call-sites son correctos y no falta ninguno.
- **Liberación SOLO al aprobar (R14–R20):** `cierres-admin-repository.test.ts:1036-1172`
  (por zona, `prioridad=true`, actor=admin, origen `liberacion_sin_gestionar`; no-op en cierre
  normal; rechazo NO libera; sin `liberacionSinGestionar` en input → no libera),
  `cierres-admin-service.test.ts:685` (aprobar pasa la config; rechazo no).
- **Modelo GLOBAL del cierre (R27–R31):** `rechazado` bloqueante + `rechazado→solicitado`
  (money-safe, `cierre-dia-repository.test.ts:304-348`), invariante "a lo sumo un cierre abierto"
  (`cierre-dia-service.test.ts:1263/1275`, prioridad `vencido`>`rechazado`), bloqueo derivado en
  los 3 sitios (`orden-repository.bloqueo.test.ts`).
- **UI (R25/R26/R31):** etiqueta `sin_gestionar` (`EstatusLabel.test.ts`); CTA re-solicitar por
  `rechazado` indep. de `puedesSolicitar` + copy "no terminal" (`CierreDiaModule.test.tsx`); rótulo
  "Bloqueante hasta re-solicitud" en `/cierres-admin` (`CierresAdminModule.test.tsx`); guard de
  no-resalte (`PrioridadResalte.test.tsx`).

## Comprobaciones críticas

- **Money-safety ✅:** las transiciones de estado puro (`en_reparto→sin_gestionar`,
  `{vencido,rechazado}→solicitado`) cambian SOLO estado; no recalculan ni re-snapshotean totales ni
  mueven wallets (asserts money-safe en `cierre-dia-repository.test.ts:241/320` y
  `cierres-admin-repository.test.ts:607`). La liberación ocurre EXCLUSIVAMENTE en la rama `aprobado`.
- **Migraciones ✅:** 2 nuevas aditivas con `down.sql` reversible; sin migración del enum
  `CierreEstado`. El **ripple de los tests-DOWN de enum (67/99/100/106)** y del enum standalone se
  resolvió agregando los 2 valores de 109 a los SETS DE EXCLUSIÓN de cada test, **sin tocar ningún
  `down.sql`** (los `down.sql` recrean el estado histórico pre-feature: correcto). `zonas-migration`
  allow-list consistente.
- **Invariante ✅:** ninguna secuencia deja 2 cierres abiertos de `{solicitado,vencido,rechazado}`.
- **Tests de 38/111/41 AJUSTADOS, no aflojados ✅:** rechazar ya no desbloquea → ahora bloquea +
  re-solicita; las aserciones se endurecieron al nuevo modelo (revisado con foco por el remate del
  leader; los fixes de los 2 builders de mocks no cambian lo que los tests verifican, solo el tipado).

## Hallazgos

- **[MENOR — RESUELTO]** El mapa R→test de `impl_109.md` tenía una fila imprecisa
  (`R11/R12/R13/R23 → "money-neutralidad (services/db)"`) y `tasks.md` había predicho archivos
  dedicados (`sin-gestionar-money-neutral.test.ts`, `sin-gestionar-invariante.test.ts`) que NO se
  crearon: la cobertura quedó DISTRIBUIDA en las secciones "feature 109" de los archivos existentes.
  El leader precisó el mapa a las rutas/líneas reales. Sin impacto funcional (la cobertura existe y
  pasa).
- **[FOLLOW-UP — no bloqueante]** R13 ("aprobar un `vencido` money-neutral no mueve wallet") está
  garantizado por CONSTRUCCIÓN (los feeds 42/43/44 leen `gestion_orden` por `cierre_id`; 0 gestiones
  → 0 movimientos) y cubierto indirectamente por R8, pero SIN una aserción dedicada. Recomendado
  añadir un test explícito ("aprobar cierre de 0 gestiones → `crearMovimientos` no llamado") en un
  futuro toque; no bloquea porque es money-safe por diseño y la suite está verde.

## Conclusión

Feature 109 cumple el spec (R1–R31), es money-safe, respeta el choke point (49), sus migraciones son
aditivas y reversibles, y el cambio del modelo de cierre (38/111 → `rechazado` bloqueante +
re-solicitable, global) es consistente y con el ripple de tests correctamente ajustado. **APROBADO**
para PR hacia `dev`.
