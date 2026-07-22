# review_111 - Cierre vencido: bloqueo total + resolucion por el mensajero

Reviewer del arnes SDD. Feature 111, rama feature/111-cierre-vencido-modelo.
Verificacion EJECUTABLE (numeros reales). Hallazgos MAYORES = bloqueantes.

## Veredicto: CAMBIOS REQUERIDOS

Codigo de las 3 capas (backend + frontend) correcto, money-safe y con trazabilidad
unit/componente COMPLETA (21/21 R con test real y verde). Bloquea la capa de verificacion
E2E: no existe E2E para el flujo NUEVO de la 111 y el E2E preexistente de la 41 quedo
CONTRADICTORIO con esta feature y sin actualizar.

## Verificacion ejecutable (numeros reales)

- npx prisma validate -> schema valido (R19).
- pnpm typecheck (tsc --noEmit) -> 0 errores (cliente Prisma regenerado).
- pnpm lint -> 0 errores, 144 warnings (baseline del repo; ninguno nuevo).
- Tests backend (8 archivos R-mapeados) -> 299/299 verdes.
- Tests de componente (5 archivos) -> 119/119 verdes.
- orden-repository.bloqueo.test.ts (predicado reusado R2/R18) -> 12/12 verdes.
- git diff HEAD -- db/ VACIO; sin migraciones nuevas (R19 confirmado).
- Sin coercion de montos a float en lib tocado (R21 a nivel codigo).

NOTA: corrio sobre la base de la rama (0462aa4), 23 commits detras de origin/dev.
Re-ejecutar tras rebasar (ver menor #3).

## Checklist CHECKPOINTS

- [x] requirements.md (EARS R1-R21) / design.md (con alternativa descartada) / tasks.md existen.
- [~] tasks.md: A1-A3, B1-B7, E1, E3, E4 en [x]; C1/C2/C3/D1/E2 siguen [ ] pese a estar
      implementadas y testeadas (C1-D1). CHECKPOINTS pide todas [x] -> bookkeeping pendiente.
- [x] Trazabilidad: cada R con test concreto que lo ejerce (mapa abajo). impl_111.md trae el mapa.
- [x] typecheck / lint / tests unit+componente verdes.
- [ ] E2E (Playwright) del flujo critico/recaudo: NO cubre la 111 (ver MAYOR #1).
- [x] Sin tablas nuevas -> RLS de cierre_dia intacta (service-role); sin migracion (R19).
- [x] Sin secretos hardcodeados; sin PII en motivos de bloqueo (texto fijo, R20).
- [x] Capas separadas: Server Action -> Service -> Repository; interfaces en lib/interfaces.
- [x] Mutaciones internas por Server Action (solicitarCierre, forzarSolicitudVencido), no fetch.
- [x] Sin hardcode de pais/moneda/cuenta.

## Decisiones del gate F1.4

- Q1-B (R15): OK. ESTADOS_RESOLUBLES queda solo con solicitado en CierresAdminRepository;
  el approve/reject normal ya no casa un vencido.
- Valvula de escape (R16/R17): OK. forzarSolicitudVencido en repo (guardada por estado vencido
  + alcance, count 0 -> conflict/fuera_de_alcance, solo cambia estado, money-safe), service
  (resolveAlcance, forbidden/no_encontrada/conflict/ok) y Server Action (use server, zod +
  unauthenticated en el borde). UI diferenciada Destrabar cierre vencido con confirmacion,
  separada de aprobar/rechazar. Auditoria R17 por la resolucion posterior (resolverCierre setea
  resuelto_por/at; la valvula NO los toca) -> verificado por composicion.
- Q2 (R5): OK. Guarda EXPLICITA en CierreDiaService.deshacerGestion con findMensajerosBloqueados,
  ANTES de leer/anular (no no-op natural).
- Q3 (R4): OK. Guarda en recogerAsignaciones y escogerParaGestion.

## Trazabilidad R1-R21 -> test

| R | Test (archivo . caso) | Estado |
| --- | --- | --- |
| R1 | mis-asignaciones-service R1/R3 gestionar bloqueado -> conflict | OK |
| R2 | mis-asignaciones-service R2 rechazado/aprobado NO bloquean + espia; orden-repository.bloqueo estado IN (solicitado,vencido) | OK |
| R3 | mis-asignaciones-service NO sube evidencia / NO transiciona / NO crea gestion_orden | OK |
| R4 | mis-asignaciones-service R4 recoger/escoger bloqueado -> sin efectos | OK |
| R5 | cierre-dia-service R5 BLOQUEADO sin leer ni anular + NO bloqueado procede | OK |
| R6 | cierre-dia-repository existeCierreVencido; cierre-dia-service con vencido transiciona, NO crea | OK |
| R7 | cierre-dia-repository count 1 true / count 0 false; cierre-dia-service 0 filas conflict | OK |
| R8 | cierre-dia-repository R8/R21 NO toca snapshot/resuelto_por/at/solicitado_at | OK |
| R9 | cierre-dia-service R9 anti-deadlock vencido + pendientes transiciona; contar no llamado | OK |
| R10 | cierre-dia-service NO crea cierre nuevo (crearCierre not called) + invariante por construccion | OK |
| R11 | cierre-dia-service SIN vencido flujo 37 SIN cambios (via creado, crearCierre 1x) | OK |
| R12 | CierreDiaModule + MisAsignacionesModule aviso de bloqueo total | OK |
| R13 | cierre-dia-service tieneVencido true/false; CierreDiaModule CTA indep. de puedesSolicitar | OK |
| R14 | MisAsignacionesModule recoger oculto + cards deshabilitadas + panel no montado | OK |
| R15 | cierres-admin-repository solo solicitado; CierresAdminModule vencido NO resoluble normal | OK |
| R16 | cierres-admin-repository/service/action + CierresAdminModule destrabar diferenciado | OK |
| R17 | cierres-admin-repository valvula NO registra audit + resolverCierre R14 setea resuelto_por/at (composicion) | OK |
| R18 | cierres-admin-service valvula deja solicitado bloqueante, no aprueba; orden-repository.bloqueo | OK |
| R19 | prisma validate OK + sin db/migrations | OK |
| R20 | cierre-dia-service + mis-asignaciones-service motivo SIN PII | OK |
| R21 | cierre-dia-repository R8/R21 + cierres-admin-repository R16/R21/R17 + NO alimenta wallets ni transaction | OK |

21/21 R con test real y verde a nivel unit/componente.

## Hallazgos

### MAYOR #1 (bloqueante) - E2E: el flujo critico de la 111 no esta cubierto; el E2E de la 41 quedo contradictorio
- No existe E2E Playwright para los caminos NUEVOS de la 111: (a) mensajero bloqueado ->
  Solicitar aprobacion del cierre vencido -> admin aprueba el solicitado -> desbloqueo;
  (b) valvula: admin destraba un vencido abandonado -> aprueba -> desbloqueo.
- El unico E2E que toca vencido, e2e/reglas-bloqueos-cierre.spec.ts (feature 41, sin modificar),
  ahora CONTRADICE la 111 y fallaria si se ejecutara:
  - e2e/reglas-bloqueos-cierre.spec.ts:152 clic en Ver / decidir sobre un vencido y :157 Aprobar
    -> R15 retiro ambos de la fila/detalle vencido (ahora Ver + Destrabar cierre vencido, sin
    Aprobar). Paso 4 rompe.
  - e2e/reglas-bloqueos-cierre.spec.ts:172-174 asume el texto de bloqueo VIEJO (No puedes
    recibir...), que C1 cambio a No puedes gestionar ni recibir...
- specs/111-cierre-vencido-modelo/tasks.md:98 (E2) sigue [ ] y su nota (el spec E2E existe y
  describe ambos caminos) es INEXACTA: no existe tal spec para la 111.
- CHECKPOINTS exige un E2E que EXISTA y cubra el flujo critico/recaudo; la norma del repo
  (review_41 menor #4) acepta ejecucion diferida SOLO si el E2E existe y es correcto. Aqui no
  existe para la 111 y el preexistente documenta comportamiento revertido.
- Que falta: anadir el E2E de la 111 (ambos caminos) y actualizar reglas-bloqueos-cierre.spec.ts
  al nuevo modelo (destrabar en vez de aprobar el vencido; texto de bloqueo total). Vuelve al
  frontend_dev.

### menor #1 - tasks.md con frontend implementado pero sin marcar
specs/111-cierre-vencido-modelo/tasks.md:70,74,79,86 (C1/C2/C3/D1) siguen [ ] aunque el codigo y
sus tests de componente (119 verdes) estan hechos. CHECKPOINTS pide todas [x]. Marcar tras
resolver el MAYOR #1.

### menor #2 - R10 y R17 verificados por composicion, no end-to-end
R10 (no coexistencia) se apoya en crearCierre no llamado (unit) + comportamiento del corte de la
41; R17 se descompone en (valvula no audita) + (resolverCierre setea resuelto_por/at). Correcto,
pero sin una secuencia integracion/E2E unica de punta a punta (la cubriria el E2E del MAYOR #1).

### menor #3 (proceso) - trabajo sin commitear sobre base desactualizada
Los cambios de la 111 estan en working-tree SIN COMMIT; la rama esta 23 commits detras de
origin/dev (base 0462aa4). feature_list.json ademas marca 102 done y registra 109/110 (bookkeeping
empaquetado). 111 figura in_progress (correcto, no done prematuro). Antes de PR: commitear, rebasar
sobre origin/dev actual (incluye 100/101/102/107) y RE-EJECUTAR la suite.

## Cierre
Backend + frontend correctos y money-safe; 21/21 R con test real y verde (typecheck/lint/unit/
componente en verde). Bloquea el MAYOR #1 (E2E de la 111 ausente + E2E de la 41 contradictorio sin
actualizar). Resuelto eso (y menores #1/#3), la feature queda lista para PR.
