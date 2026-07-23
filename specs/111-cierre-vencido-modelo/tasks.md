# Feature 111 — Cierre `vencido`: bloqueo total y resolución por el mensajero · tasks.md

> Checklist verificable y orquestable como **backend_dev → frontend_dev** (NO implementer
> monolítico). Cada task marca `[B]` (backend) / `[F]` (frontend). `[P]` = paralelizable con
> otras `[P]` del mismo bloque. Cada task trae su criterio de "hecho" y los `R` que cubre.
> Depende de la feature 41 (done). **Sin migración** (R19). Gate F1.4 RESUELTO: Q1-B + válvula
> de escape, Q2 bloquea deshacer, Q3 bloquea recoger/escoger. No se toca `feature_list.json` ni
> `progress/`. Baseline debe quedar VERDE (`./init.sh` + `pnpm test`).

---

## Bloque A — Repositorios (backend) [precede a B]

- [x] **A1. [B]** Añadir a `ICierreDiaRepository` + `CierreDiaRepository`:
  `existeCierreVencido(mensajeroId): Promise<boolean>` (gemelo de `existeCierreSolicitado`,
  `count WHERE estado='vencido'`).
  _Hecho:_ unit/integración devuelve `true`/`false` según haya `vencido`; `pnpm typecheck` verde. (R6)

- [x] **A2. [B]** Añadir `transicionarVencidoASolicitado(mensajeroId): Promise<boolean>`:
  `updateMany WHERE mensajero_id=X AND estado='vencido' SET estado='solicitado'`; `return count===1`.
  NO toca totales, `pago`, `ingreso`, `cierre_id`, `resuelto_por/at`, `solicitado_at`.
  _Hecho:_ integración/DB: transiciona 1 fila; segunda llamada → `false`; snapshot y `cierre_id` idénticos antes/después. (R7/R8/R21)

- [x] **A3. [B] [P]** Añadir a `CierresAdminRepository`/interfaz
  `forzarSolicitudVencido(cierreId, alcance)`: `updateMany WHERE id=cierreId AND estado='vencido'
  AND <alcanceWhere> SET estado='solicitado'`; `count===0` → `conflict`/`fuera_de_alcance`
  (patrón `resolverCierre`). SOLO cambia `estado`.
  _Hecho:_ integración: destraba `vencido` en alcance → `solicitado`, snapshot intacto; fuera de alcance/carrera → sin efecto. (R16)

## Bloque B — Servicios de dominio (backend) [depende de A]

- [x] **B1. [B]** Rama del `vencido` en `CierreDiaService.solicitarCierre`: si
  `existeCierreVencido` → `transicionarVencidoASolicitado` (SIN `contarOrdenesPendientesGestion`);
  `false` → `conflict`; `true` → `ok` (opcional `via: "vencido_solicitado"`). El flujo de
  creación intacto cuando NO hay `vencido`.
  _Hecho:_ unit: con `vencido` transiciona (mismo id, sin fila nueva); con `vencido` + orden `en_reparto` NO da `conflict` por pendientes; sin `vencido`, tests de la 37 verdes. (R6/R9/R10/R11)

- [x] **B2. [B] [P]** `listarCierreDia` expone `tieneVencido: boolean` (derivado de
  `cierresPasados`, sin query extra) en `ListarCierreDiaServiceResult` y en la Server Action.
  _Hecho:_ unit: `tieneVencido=true` cuando hay un `vencido` en el histórico; `false` si no. (R13-datos)

- [x] **B3. [B]** Guarda de bloqueo en `MisAsignacionesService.gestionar`: ampliar el `Pick`
  del repo de orden con `findMensajerosBloqueados`, cablearlo en `buildService()`
  (`lib/actions/mis-asignaciones.ts`), rechazar con `conflict` + `MSG_BLOQUEADO` al inicio
  (antes de cargar orden / subir evidencia).
  _Hecho:_ unit: mensajero con `vencido`/`solicitado` → `conflict` con motivo; con `rechazado`/sin cierre → procede; el doble de Storage NO recibe `upload` y no se crea `gestion_orden`; se invoca `findMensajerosBloqueados`. (R1/R2/R3/R20)

- [x] **B4. [B] [P]** *(Q3)* Misma guarda al inicio de `recogerAsignaciones` y
  `escogerParaGestion`, con motivo accionable y sin efectos parciales.
  _Hecho:_ unit: recoger/escoger con mensajero bloqueado → rechazo sin transición ni cambio de puntero. (R4)

- [x] **B5. [B] [P]** *(Q2 — guarda EXPLÍCITA)* Guarda de bloqueo al inicio de
  `CierreDiaService.deshacerGestion`: ampliar el `Pick` de su `ordenRepo` con
  `findMensajerosBloqueados`, cablearlo en `buildService()` (`lib/actions/cierre-dia.ts`),
  rechazar con `conflict` + motivo antes de cualquier lectura/escritura.
  _Hecho:_ unit: `deshacerGestion` con mensajero bloqueado → `conflict`; la orden NO vuelve a `en_reparto` y la gestión NO se anula; sin cierre bloqueante → procede (regresión 67 verde). (R5)

- [x] **B6. [B] [P]** *(Q1-B)* Quitar `vencido` de `ESTADOS_RESOLUBLES`
  (`CierresAdminService`/`CierresAdminRepository.resolverCierre`): el approve/reject normal solo
  aplica a `solicitado`. Ajustar el test de la 41 R19 afectado.
  _Hecho:_ integración: acción normal sobre `vencido` → sin efecto (`conflict`/no resoluble); sobre `solicitado` (incl. el venido de `vencido→solicitado`) → `aprobado`. (R15)

- [x] **B7. [B]** *(Válvula de escape)* `CierresAdminService.forzarSolicitudVencido(cierreId,
  actor)` (resuelve alcance con `resolveAlcance`, llama a A3) + Server Action
  `forzarSolicitudVencido` en `lib/actions/cierres-admin.ts`.
  _Hecho:_ integración: admin destraba `vencido` de su alcance → `solicitado`, snapshot intacto; luego aprobar registra `resuelto_por`=admin + `resuelto_at`; fuera de alcance/carrera → sin efecto. (R16/R17)

## Bloque C — UI del mensajero (frontend) [depende de B1/B2]

- [x] **C1. [F]** `/cierre-dia`: actualizar `BLOQUEO_AVISO` al texto de **bloqueo total**
  ("no podés gestionar ni recibir…") en `CierreDiaModule`.
  _Hecho:_ componente: con `bloqueado=true` renderiza el aviso `role="alert"` con el texto total; con `false` no. (R12)

- [x] **C2. [F]** `/cierre-dia`: prop `tieneVencido` (desde `page.tsx`) + CTA diferenciado
  "Solicitar aprobación del cierre vencido" (con `Modal`) habilitado con independencia de
  `puedesSolicitar`; al confirmar llama a `solicitarCierre()`.
  _Hecho:_ componente: con `tieneVencido=true` el CTA aparece habilitado aunque `puedesSolicitar=false`; con `false` no aparece; al confirmar invoca la acción. (R13)

- [x] **C3. [F]** `/mis-asignaciones`: `page.tsx` pre-fetch `estadoBloqueoMensajero()` y pasa
  `bloqueado` por props; `MisAsignacionesModule` muestra el aviso de bloqueo total y deshabilita/
  guarda los controles de gestionar/recoger/escoger cuando `bloqueado`.
  _Hecho:_ componente: con `bloqueado=true` se ve el aviso y los controles quedan deshabilitados/cortados; con `false`, flujo normal. (R12/R14)

## Bloque D — UI del admin (frontend) [depende de B7]

- [x] **D1. [F]** `/cierres-admin`: sobre las filas `vencido` de la cola, botón DIFERENCIADO
  "Destrabar cierre vencido abandonado" (copy de excepción + `Modal` de confirmación), separado
  de Aprobar/Rechazar; llama a `forzarSolicitudVencido(cierreId)`.
  _Hecho:_ componente: la acción aparece SOLO en filas `vencido` del alcance; al confirmar invoca la Server Action; Aprobar/Rechazar no se ofrecen sobre `vencido`. (R16)

## Bloque E — Verificación y trazabilidad [depende de A–D]

- [x] **E1. [B]** Suite money/invariante: totales snapshot inmutables ante toda acción bloqueada,
  ante `vencido→solicitado` (mensajero y válvula) y ante destrabar+aprobar; ninguna secuencia
  deja coexistir `vencido` y `solicitado`.
  _Hecho:_ integración verde. (R10/R21)

- [x] **E2. [F] [P]** E2E Playwright del ciclo money (flujo crítico, CHECKPOINTS.md): (a)
  mensajero bloqueado → "Solicitar aprobación del cierre vencido" → admin aprueba → desbloqueado;
  (b) variante válvula: admin destraba un `vencido` abandonado → aprueba → desbloqueado.
  (Escrito; ejecución diferida, patrón del repo — no corren bajo `pnpm test`.)
  _Hecho:_ dos specs cubren ambos caminos — `e2e/cierre-vencido-modelo.spec.ts` (mensajero solicita → admin aprueba → desbloqueo) y `e2e/reglas-bloqueos-cierre.spec.ts` paso 4 actualizado (válvula: admin destraba → aprueba); consistentes con la UI real. Ejecución diferida (deuda de harness E2E). (R12/R13/R16/R17/R18)

- [x] **E3. [B]** Confirmar **sin migración**: la rama no añade `db/migrations/*`;
  `prisma validate`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `./init.sh` verdes.
  _Hecho:_ CI/local verdes; `git status` sin archivos en `db/migrations/`. (R19)

- [x] **E4.** Escribir el mapa `R<n> → test` en `progress/impl_111-*.md` (el implementer al
  ejecutar; el reviewer lo verifica).
  _Hecho:_ cada `R1..R21` referencia al menos un test por su ruta. (trazabilidad)

---

## Mapa R → task/test (el implementer fija la ruta final del archivo de test)

| R | Task | Prueba prevista | Zona |
| --- | --- | --- | --- |
| R1 | B3 | unit: `gestionar` bloqueado → `conflict` con motivo | B |
| R2 | B3 | unit: reutiliza `findMensajerosBloqueados`; `rechazado`/`aprobado` no bloquean | B |
| R3 | B3 | unit: rechazo sin `upload`, sin transición, sin `gestion_orden` | B |
| R4 | B4 | unit: recoger/escoger bloqueado → sin efectos | B |
| R5 | B5 | unit: `deshacerGestion` bloqueado → sin anular ni devolver a `en_reparto` | B |
| R6 | A1/B1 | integración: `solicitarCierre` con `vencido` → mismo id a `solicitado`, sin fila nueva | B |
| R7 | A2 | integración: `updateMany` guardado; count===0 → `conflict` | B |
| R8 | A2 | integración: snapshot + `cierre_id` intactos; `resuelto_por/at` null | B |
| R9 | B1 | unit: `vencido` + orden `en_reparto` → transiciona sin `conflict` por pendientes | B |
| R10 | B1/E1 | integración: nunca coexisten `vencido` y `solicitado` (incl. válvula) | B |
| R11 | B1 | unit: sin `vencido`, flujo de creación 37 verde (regresión) | B |
| R12 | C1/C3 | componente: aviso de bloqueo total en `/cierre-dia` y `/mis-asignaciones` | F |
| R13 | B2/C2 | componente: CTA "Solicitar aprobación del cierre vencido" con `tieneVencido` | F |
| R14 | C3 | componente: controles gestionar/recoger/escoger deshabilitados con `bloqueado` | F |
| R15 | B6 | integración: normal sobre `vencido` → sin efecto; sobre `solicitado` → `aprobado` (Q1-B) | B |
| R16 | A3/B7/D1 | integración+componente: válvula destraba `vencido` de su alcance → `solicitado`; acción diferenciada en UI | B/F |
| R17 | B7 | integración: destrabar + aprobar → `resuelto_por`=admin + `resuelto_at`; totales intactos | B |
| R18 | E1 | integración: `vencido→solicitado` (mensajero o válvula) sigue bloqueando; aprobar desbloquea | B |
| R19 | E3 | CI: sin migración nueva; `prisma validate` OK | B |
| R20 | B3 | unit: motivo de bloqueo sin PII (texto fijo) | B |
| R21 | A2/E1 | integración money: totales snapshot inmutables en todas las rutas | B |

---

## Dependencias y paralelismo

- **Orden:** A → B → (C ∥ D) → E. `A1`/`A2` preceden a `B1`; `A3` precede a `B7`; `B7` precede a `D1`.
- **backend_dev (B):** A1, A2, A3, B1–B7, E1, E3. **frontend_dev (F):** C1, C2, C3, D1, E2.
- **`[P]` seguros:** A3 ∥ A1/A2 (archivos distintos); B2 ∥ B3 ∥ B4 ∥ B5 ∥ B6 (servicios/archivos
  distintos); C1 ∥ C2 (mismo módulo: coordinar el diff); C3 y D1 independientes.
- **Gate F1.4 RESUELTO:** Q1-B + válvula (B6/B7/A3/D1), Q2 deshacer (B5), Q3 recoger/escoger (B4)
  van todos.
