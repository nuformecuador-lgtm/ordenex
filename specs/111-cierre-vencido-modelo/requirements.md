# Feature 111 — Cierre `vencido`: bloqueo total (gestionar + recibir) y resolución por el mensajero · requirements.md

Zone: `fullstack` · complexity: `high` · depends_on: 41 (`done`) · branch: `feature/111-cierre-vencido-modelo`

> Requisitos en notación EARS. Cada `R<n>` mapea a un test concreto (el reviewer rechaza
> si falta trazabilidad). **Money-critical:** el snapshot del cierre (`vencido`/`solicitado`)
> es INMUTABLE (features 37/39/56); esta feature NUNCA recalcula ni re-snapshotea totales.
>
> Las decisiones del gate F1.4 están **RESUELTAS** (ver esa sección): Q1-B + válvula de escape,
> Q2 bloqueo explícito de deshacer, Q3 bloqueo de recoger/escoger. Los requisitos ya reflejan
> esas decisiones (sin marcas `prov.`).

---

## Contexto verificado (símbolos reales, no supuestos)

- **Bloqueo derivado (feature 41, sin flag):** un mensajero está bloqueado ⇔ tiene un
  `cierre_dia` con `estado IN ('solicitado','vencido')`. La derivación única vive en
  `OrdenRepository.findMensajerosBloqueados(ids): Promise<Set<string>>`
  (`ESTADOS_CIERRE_BLOQUEANTES = ["solicitado","vencido"]`), respaldada por el índice
  `@@index([mensajeroId, estado])` de `CierreDia`. Hoy se consume SOLO en los puntos de
  ASIGNACIÓN: `GuiaAsignacionService`/`OrdenRepository` (maestro, 17/30, vía `NOT EXISTS`
  anti-TOCTOU) y `AsignacionSateliteService` (adminSatelite, 34). La Server Action
  `estadoBloqueoMensajero()` (`lib/actions/cierre-dia.ts`) ya lo expone a la UI del mensajero.
- **Gestionar (donde falta bloquear):** `MisAsignacionesService.gestionar(input, actor)`
  (mensajero entrega/reprograma/devuelve/rechaza). Hoy NO consulta bloqueo. Su repo de orden
  es `Pick<IOrdenRepository, "findEstatusIdByValue">` (habría que ampliar el `Pick` para
  inyectar `findMensajerosBloqueados`). Los precursores `recogerAsignaciones` y
  `escogerParaGestion` tampoco consultan bloqueo.
- **`solicitarCierre` (feature 37):** `CierreDiaService.solicitarCierre(actor)` — hoy:
  R10 (sin órdenes `en_espera_aceptacion`/`en_reparto` → `contarOrdenesPendientesGestion`),
  R12 (`existeCierreSolicitado` → conflict), R11 (día no vacío), luego `crearCierre`
  (transacción todo-o-nada: INSERT + vincular gestiones + snapshot). `ICierreDiaRepository`
  ya tiene `existeCierreSolicitado`; NO tiene `existeCierreVencido` ni una transición
  `vencido → solicitado`.
- **Corte diario (feature 41):** `CorteDiarioRepository.findMensajerosConActividadSinCierre`
  EXCLUYE a los mensajeros con un `solicitado` (`ESTADO_SOLICITADO`), es decir: **no crea
  `vencido` si hay `solicitado`** (una dirección del invariante ya cubierta).
- **Aprobación (feature 38/41):** `CierresAdminRepository.resolverCierre` transiciona con
  `updateMany ... WHERE id=X AND estado IN ('solicitado','vencido') AND <alcance>`
  (`ESTADOS_RESOLUBLES = ["solicitado","vencido"]`, feature 41 R19). Es decir, **hoy el admin
  YA puede aprobar/rechazar un `vencido` directamente.** `CierresAdminService.listarCierresAdmin`
  ya coloca `vencido` en la cola de "pendientes".
- **Enum e índice ya presentes:** `enum CierreEstado { solicitado aprobado rechazado vencido }`
  y `@@index([mensajeroId, estado])` existen en `db/schema.prisma` (migración de la 41). Sin
  columnas nuevas requeridas por esta feature.

---

## A) Bloqueo total — acciones del mensajero sobre las guías (backend)

- **R1** — MIENTRAS un mensajero tenga al menos un cierre en estado bloqueante (`solicitado`
  o `vencido`) sin resolver, el sistema DEBE impedirle GESTIONAR una orden (entregar,
  reprogramar, devolver o rechazar), rechazando la operación con un motivo accionable
  (que le indique resolver su cierre antes de gestionar).
  *Testeable:* `gestionar` con el mensajero teniendo un `vencido` → `conflict` con motivo; sin
  cierre bloqueante → procede normal.

- **R2** — El predicado de bloqueo que consume `gestionar` DEBE ser EXACTAMENTE el mismo de la
  asignación: bloquean `solicitado` y `vencido`; `aprobado` y `rechazado` NO bloquean;
  reutilizando el helper derivado existente (`findMensajerosBloqueados`) SIN duplicar la
  derivación ni introducir un flag persistido.
  *Testeable:* con `rechazado` como único cierre → `gestionar` procede; se verifica que el
  service invoca el mismo helper (doble espía), no una consulta paralela.

- **R3** — CUANDO `gestionar` se rechace por bloqueo (R1), el sistema NO DEBE producir efectos
  parciales: NO DEBE subir la evidencia a Storage, NI transicionar el estado de la orden, NI
  crear la fila `gestion_orden` (la guarda se evalúa ANTES de cualquier efecto).
  *Testeable:* tras el rechazo por bloqueo, el doble de Storage no recibió `upload`, la orden
  conserva su estado y no existe nueva `gestion_orden`.

- **R4** — MIENTRAS un mensajero esté bloqueado (R1), el sistema DEBE impedirle
  también RECOGER (`en_espera_aceptacion → en_reparto`) y ESCOGER una orden para gestión, con
  el MISMO predicado y un motivo accionable, sin efectos parciales. *(Q3 APROBADA.)*
  *Testeable:* `recogerAsignaciones`/`escogerParaGestion` con mensajero bloqueado → rechazo sin
  transición ni cambio de puntero.

- **R5** — MIENTRAS un mensajero esté bloqueado (R1), el sistema DEBE impedirle DESHACER una
  gestión (`CierreDiaService.deshacerGestion`, "Devolver a gestión", feature 67), rechazando la
  operación con un motivo accionable y SIN efectos. La guarda DEBE ser EXPLÍCITA (belt-and-
  suspenders) y usar el MISMO predicado derivado (`findMensajerosBloqueados`), evaluada ANTES de
  cualquier escritura; NO se apoya en el "no-op natural". *(Q2 APROBADA: bloqueo total sobre las
  guías, "no puede hacer NADA con las guías".)*
  *Testeable:* `deshacerGestion` con el mensajero teniendo un `vencido`/`solicitado` → rechazo
  con motivo; la orden NO vuelve a `en_reparto` y la gestión NO se anula; se verifica que invoca
  `findMensajerosBloqueados`. Sin cierre bloqueante → procede (regresión 67 verde).

---

## B) Solicitar el propio `vencido` e invariante (backend)

- **R6** — SI un mensajero tiene un cierre en estado `vencido` cuando ejecuta "Solicitar
  cierre", ENTONCES el sistema DEBE transicionar ese cierre `vencido → solicitado` en lugar de
  crear un cierre nuevo (no se inserta una segunda fila `cierre_dia`).
  *Testeable:* con un `vencido` existente, `solicitarCierre` → el mismo `cierreId` pasa a
  `solicitado`; el conteo de filas `cierre_dia` del mensajero no aumenta.

- **R7** — La transición `vencido → solicitado` DEBE ser concurrencia-segura mediante una
  escritura guardada por estado (`updateMany ... WHERE mensajero_id = actor AND
  estado = 'vencido'`); SI la escritura afecta 0 filas (el `vencido` ya fue
  resuelto/transicionado entre la lectura y la escritura), ENTONCES el sistema DEBE devolver
  `conflict` sin efectos.
  *Testeable:* segunda solicitud concurrente / vencido ya resuelto → `conflict`, sin cambios.

- **R8** — CUANDO se transicione `vencido → solicitado`, el sistema NO DEBE recalcular ni mutar
  el snapshot money-critical del cierre (totales por método, total general, pago al mensajero,
  ingreso de bodega por rechazos) NI re-vincular sus gestiones; SOLO DEBE cambiar `estado` (no
  toca `resuelto_por`/`resuelto_at`, que siguen nulos por no ser una resolución).
  *Testeable:* antes/después de la transición, todas las columnas de totales, `pago`, `ingreso`
  y los `cierre_id` de sus gestiones son idénticos; `resuelto_por`/`resuelto_at` siguen `null`.

- **R9** — La transición `vencido → solicitado` NO DEBE aplicar la precondición "sin órdenes
  pendientes de gestión" (feature 37 R10): un mensajero con un `vencido` y órdenes en
  `en_espera_aceptacion`/`en_reparto` DEBE poder enviar su `vencido` a aprobación. (De lo
  contrario quedaría en deadlock: bloqueado para gestionar —R1— y bloqueado para solicitar.)
  *Testeable:* mensajero con un `vencido` + 1 orden `en_reparto` → `solicitarCierre` transiciona
  el vencido a `solicitado` (no `conflict` por pendientes).

- **R10** — El sistema DEBE garantizar el INVARIANTE de no-coexistencia: un mensajero NUNCA DEBE
  tener simultáneamente un cierre `vencido` y uno `solicitado`. (El corte no crea `vencido` si
  existe `solicitado` —41 R10—; `solicitarCierre` transiciona el `vencido` en vez de crear un
  segundo cierre —R6—.)
  *Testeable:* tras cualquier secuencia (corte, solicitar, solicitar-vencido, válvula de
  escape), un mensajero jamás presenta a la vez una fila `vencido` y una `solicitado`.

- **R11** — SI el mensajero NO tiene ningún cierre `vencido`, ENTONCES `solicitarCierre` DEBE
  conservar SIN CAMBIOS el flujo de creación existente (feature 37 R10/R11/R12/R13/R14):
  precondiciones, snapshot money-safe y ruteo por zona.
  *Testeable:* sin `vencido`, los tests de la 37 siguen verdes (creación con snapshot y ruteo).

---

## C) Reflejo en la UI del mensajero (frontend)

- **R12** — MIENTRAS un mensajero esté bloqueado (R1), las vistas "Cierre del día"
  (`/cierre-dia`) y "Mis asignaciones" (`/mis-asignaciones`) DEBEN mostrar un aviso accionable
  que comunique el BLOQUEO TOTAL (no puede gestionar NI recibir) e indique resolver primero su
  cierre pendiente.
  *Testeable:* con `bloqueado = true`, ambas vistas renderizan el aviso `role="alert"` con el
  texto de bloqueo total; con `false`, no lo renderizan.

- **R13** — MIENTRAS un mensajero tenga un cierre `vencido`, la vista "Cierre del día" DEBE
  ofrecerle una acción diferenciada para SOLICITAR (enviar a aprobación) ese `vencido`,
  disponible con INDEPENDENCIA del gate de creación (`puedesSolicitar`).
  *Testeable:* con `tieneVencido = true`, aparece el CTA "Solicitar aprobación del cierre
  vencido" habilitado aunque `puedesSolicitar` sea `false`; con `false`, no aparece.

- **R14** — MIENTRAS un mensajero esté bloqueado (R1), la vista "Mis asignaciones" DEBE
  deshabilitar/guardar en la UI los controles de gestionar (y los de recoger/escoger, R4;
  defensa suave, el backend R1/R4 es la defensa real) y remitir al mensajero a resolver su
  cierre.
  *Testeable:* con `bloqueado = true`, los controles de gestionar quedan deshabilitados o su
  submit se corta con el aviso; el backend rechaza igual si se fuerza (R1).

---

## D) Resolución por el admin, válvula de escape y desbloqueo (backend + admin UI)

- **R15** — *(Q1-B APROBADA)* En su cola normal de `/cierres-admin`, el administrador de la
  bodega responsable DEBE poder resolver (aprobar/rechazar) ÚNICAMENTE cierres en estado
  `solicitado`; un cierre `vencido` NO DEBE ser resoluble directamente por la vía normal (se
  RETIRA `vencido` de `ESTADOS_RESOLUBLES` del approve/reject normal, revirtiendo parcialmente
  la feature 41 R19). El flujo NORMAL de resolución de un `vencido` es: el mensajero lo solicita
  (R6) → queda `solicitado` → el admin lo aprueba/rechaza.
  *Testeable:* aprobar/rechazar un `vencido` por la acción normal → sin efecto (`conflict`/no
  resoluble); aprobar un `solicitado` (incluido el que vino de `vencido → solicitado`) → `aprobado`.

- **R16** — *(VÁLVULA DE ESCAPE — vía de EMERGENCIA, no el flujo normal)* El administrador de la
  bodega responsable DEBE poder DESTRABAR un `vencido` ABANDONADO en nombre del mensajero (para
  el caso en que el mensajero nunca lo solicita —se va / no abre la app— y quedarían bloqueados
  él y su bodega para siempre, feature 41 R17), mediante una acción admin EXPLÍCITA y
  DIFERENCIADA del approve normal de un click (con confirmación), que transicione el `vencido → 
  solicitado` en nombre del mensajero. La acción DEBE estar acotada al alcance del admin (rol +
  zona destino), ser concurrencia-segura (escritura guardada por estado `WHERE id = X AND estado
  = 'vencido' AND <alcance>`; 0 filas → `conflict`) y NO recalcular ni mutar el snapshot
  (money-safe, R8). La vista `/cierres-admin` DEBE exponer esa acción diferenciada sobre los
  `vencido` de su alcance (etiquetada como excepción), separada de aprobar/rechazar.
  *Testeable:* admin de la bodega responsable ejecuta "destrabar" sobre un `vencido` de su
  alcance → pasa a `solicitado`, snapshot intacto; sobre un `vencido` fuera de alcance → sin
  efecto; segunda ejecución concurrente → `conflict`.

- **R17** — CUANDO el `vencido` se resuelva por la vía de escape (tras destrabarlo, R16, el
  admin lo aprueba/rechaza ya como `solicitado`), el sistema DEBE registrar QUIÉN lo resolvió
  (`resuelto_por` = admin actor) y CUÁNDO (`resuelto_at`), para auditoría money/audit,
  reutilizando la feature 38 R14. La resolución NO DEBE recalcular los totales snapshot (R8/R21).
  *Testeable:* tras destrabar + aprobar, el cierre guarda `resuelto_por` = id del admin actor y
  `resuelto_at`; los totales snapshot no cambian.

- **R18** — La transición `vencido → solicitado` (R6, por el mensajero o por la válvula R16) NO
  DEBE desbloquear al mensajero: `solicitado` SIGUE siendo estado bloqueante; el desbloqueo
  ocurre SOLO al RESOLVER el cierre (aprobación), reutilizando la feature 41 R15.
  *Testeable:* tras `vencido → solicitado`, `findMensajerosBloqueados` sigue incluyendo al
  mensajero; tras aprobar, deja de incluirlo.

---

## E) Migración, concurrencia y seguridad

- **R19** — Esta feature NO DEBE requerir migración de esquema: el enum `CierreEstado` ya
  incluye `vencido` y el índice `(mensajero_id, estado)` ya existe; la válvula de escape (R16/R17)
  reutiliza las columnas `resuelto_por`/`resuelto_at` ya presentes. SI el implementer detecta que
  una migración es imprescindible, DEBE justificarla y aportar su `down.sql` reversible (patrón
  arquitectura), manteniendo la RLS de `cierre_dia`.
  *Testeable:* la rama no añade `db/migrations/*`; `prisma validate` y `pnpm typecheck` verdes.

- **R20** — El manejo de errores DEBE seguir las convenciones (sin `catch` vacíos; motivos
  accionables) y NINGÚN borde DEBE filtrar PII/datos sensibles en el motivo del bloqueo.
  *Testeable:* el motivo de bloqueo (gestionar/recoger/escoger/deshacer) es un texto fijo
  i18n-ready, sin datos del cierre ni del actor.

- **R21** — *(money-critical, transversal)* NINGUNA ruta de esta feature (bloqueo de
  gestionar/recoger/escoger/deshacer, transición del `vencido` por el mensajero o por la válvula
  de escape, avisos/CTA de UI) DEBE alterar los totales snapshot de ningún cierre ya creado,
  cualquiera sea su estado.
  *Testeable:* suite money: los totales de un cierre no cambian ante ninguna acción bloqueada, ni
  ante `vencido → solicitado`, ni ante destrabar+aprobar.

---

## Trazabilidad (mapa preliminar R → tipo de test)

| R | Verificación esperada | Zona |
| --- | --- | --- |
| R1 | unit `MisAsignacionesService.gestionar`: mensajero bloqueado → `conflict` con motivo | B |
| R2 | unit: reutiliza `findMensajerosBloqueados` (doble espía); `rechazado`/`aprobado` no bloquean | B |
| R3 | unit: rechazo de gestionar → sin `upload`, sin transición, sin `gestion_orden` | B |
| R4 | unit: `recoger`/`escoger` con mensajero bloqueado → rechazo sin efectos | B |
| R5 | unit: `deshacerGestion` con mensajero bloqueado → rechazo sin anular ni devolver a `en_reparto`; invoca `findMensajerosBloqueados` (Q2) | B |
| R6 | integración repo/DB: `solicitarCierre` con `vencido` → mismo id pasa a `solicitado`, sin fila nueva | B |
| R7 | integración: `updateMany` guardado por estado; count===0 → `conflict` (carrera) | B |
| R8 | integración: snapshot y `cierre_id` de gestiones intactos; `resuelto_por/at` null | B |
| R9 | unit: `vencido` + orden `en_reparto` → transiciona (sin `conflict` por pendientes) | B |
| R10 | integración: ninguna secuencia (incl. válvula) deja coexistir `vencido` y `solicitado` | B |
| R11 | unit: sin `vencido`, flujo de creación 37 sin cambios (regresión verde) | B |
| R12 | componente: aviso de bloqueo total en `/cierre-dia` y `/mis-asignaciones` | F |
| R13 | componente: CTA "Solicitar aprobación del cierre vencido" cuando `tieneVencido` | F |
| R14 | componente: controles de gestionar/recoger/escoger deshabilitados con `bloqueado` | F |
| R15 | integración: acción normal sobre `vencido` → sin efecto; sobre `solicitado` → `aprobado` (Q1-B) | B |
| R16 | integración: válvula admin destraba `vencido` de su alcance → `solicitado`, snapshot intacto; fuera de alcance/carrera → sin efecto/`conflict`; componente: acción diferenciada en `/cierres-admin` | B/F |
| R17 | integración: destrabar + aprobar → `resuelto_por`=admin + `resuelto_at`; totales intactos | B |
| R18 | integración: `vencido → solicitado` (mensajero o válvula) sigue bloqueando; aprobar desbloquea | B |
| R19 | CI/typecheck: sin migración nueva; `prisma validate` OK | B |
| R20 | unit: motivo de bloqueo (gestionar/recoger/escoger/deshacer) sin PII (texto fijo) | B |
| R21 | unit/integración money: totales snapshot inmutables en todas las rutas | B |

---

## F1.4 — decisiones RESUELTAS por el humano

> Las tres preguntas quedaron cerradas en la puerta. El implementer y el reviewer trabajan
> contra ESTE texto. Los requisitos del cuerpo ya reflejan estas decisiones (sin `prov.`).

**Q1 — ¿El admin puede aprobar un `vencido` DIRECTO, o debe pasar por `solicitado`?**
→ **RESUELTA: Q1-B + VÁLVULA DE ESCAPE.** El flujo normal exige que el `vencido` pase por
`solicitado` (lo solicita el mensajero, R6) para que el admin lo apruebe; se RETIRA `vencido` de
`ESTADOS_RESOLUBLES` del approve/reject normal (R15, revierte parcialmente la 41 R19). Como
excepción de emergencia se añade una acción admin explícita y diferenciada para destrabar un
`vencido` abandonado en nombre del mensajero (R16), auditable al resolver (R17). Evita el bloqueo
permanente del mensajero y su bodega (41 R17) sin abrir un approve directo de un click.

**Q2 — ¿El bloqueo incluye DESHACER GESTIÓN (feature 67)?**
→ **RESUELTA: SÍ, con guarda EXPLÍCITA.** Un mensajero bloqueado "no puede hacer NADA con las
guías": `CierreDiaService.deshacerGestion` gana una guarda explícita con el mismo predicado
`findMensajerosBloqueados` (R5), belt-and-suspenders (no se apoya en el no-op natural).

**Q3 — ¿Se bloquean también `recoger`/`escoger`?**
→ **RESUELTA: SÍ.** Mientras esté bloqueado, el mensajero solo puede VER y SOLICITAR su `vencido`
(R6/R9, exento de la precondición de pendientes); `recoger` y `escoger` quedan bloqueados (R4)
junto con `gestionar` (R1) y `deshacer` (R5).

## Preguntas abiertas (menores, fuera de F1.4)

- **P1 — `solicitado_at` en la transición `vencido → solicitado`.** ¿Se preserva el
  `solicitado_at` con que el corte creó el `vencido`, o se "bumpea" a la hora en que el mensajero
  lo solicita? _Recomendación:_ **preservarlo** (la transición cambia SOLO `estado`, R7), para no
  mutar el registro más allá de lo imprescindible y mantener la traza del corte. La cola del
  admin lo seguirá ordenando por ese instante. Candidato a follow-up si el negocio prefiere
  reflejar el envío del mensajero.
- **P2 — Distinción del toast al solicitar.** Al reusar `solicitarCierre` para ambos caminos,
  ¿el resultado `ok` distingue "cierre creado" de "vencido enviado a aprobación" para un toast
  específico? _Recomendación:_ añadir un discriminador opcional (p. ej. `via: "creado" |
  "vencido_solicitado"`) al resultado `ok` para un mensaje preciso; no bloquea la feature.
