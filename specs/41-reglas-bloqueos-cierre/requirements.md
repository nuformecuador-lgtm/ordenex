# Feature 41 — Reglas y bloqueos de cierre (obligatoriedad, vencidos) — requirements

> Requisitos en notación EARS. Cada `R<n>` debe mapear a un test concreto (el reviewer
> rechaza si falta trazabilidad). Money-critical: los totales de cierre son snapshot
> inmutable (features 37/39/40/56); esta feature NO recalcula ni muta cierres ya resueltos.
>
> Los requisitos se redactan sobre las decisiones **recomendadas** de la sección
> "F1.4 — decisiones pendientes". Si el humano cambia una decisión en la puerta F1.4,
> el requisito afectado se ajusta antes de implementar.

---

## F1.4 APROBADA — 2026-07-12

> Puerta de aprobación humana superada el 2026-07-12. El implementer y el reviewer
> trabajan contra ESTE texto aprobado. Cinco decisiones quedaron tal cual la
> recomendación; **Q4 cambió a la regla más estricta**.

- **Q1 (mecanismo del cron) = recomendación.** Vercel Cron Jobs:
  `/api/cron/corte-diario` protegido con `CRON_SECRET`, `schedule "0 6 * * *"`
  (= 00:00 America/Costa_Rica, UTC-6). Idempotente por vinculación de gestiones (sin
  tabla de dedupe). Sin cambios a R5/R6/R9/R11.
- **Q2 (qué es un vencido) = recomendación.** Se crea una **fila real** `cierre_dia`
  `estado='vencido'` con snapshot inmutable de totales/pago y gestiones vinculadas.
  Criterio "debía cerrar" = ≥1 `gestion_orden` con `cierre_id IS NULL` y sin cierre
  `solicitado`. Sin cambios a R2/R4/R6/R7/R8.
- **Q3 (bloqueo del mensajero) = recomendación.** Bloqueo **derivado** (sin flag);
  bloquea `solicitado` **y** `vencido`; `rechazado` NO bloquea. Sin cambios a R12/R16.
- **Q4 (bloqueo de la bodega satélite) = CAMBIO: regla MÁS ESTRICTA.** La bodega
  satélite queda bloqueada para asignar a sus mensajeros si existe **CUALQUIERA** de:
  (i) algún cierre de SUS mensajeros (`destino_tipo=bodega_satelite`,
  `destino_zona_id`=su zona, `estado IN ('solicitado','vencido')`), **O**
  (ii) su **propio `CierreBodega`** hacia la central en estado pendiente
  (`estado='solicitado'`, único estado no-resuelto que produce la feature 40:
  `CierreBodega` comparte el enum `CierreEstado`, se crea con `@default(solicitado)` y
  se resuelve a `aprobado`/`rechazado`). Afecta R17 (y por dependencia R18/R22 y la
  fila R17 del mapa de trazabilidad).
- **Q5 (resolución del vencido) = recomendación.** La bodega responsable lo
  aprueba/rechaza reutilizando la feature 38 (guardia de transición extendida para
  aceptar `vencido` como origen); resolverlo desbloquea; totales NO se recalculan.
  Sin cambios a R4/R15/R19.
- **Q6 (alcance de la UI) = recomendación.** Sin pantallas nuevas; se reutilizan
  `/cierres-admin`, la vista del mensajero y la del adminSatelite. Sin cambios a
  R20/R21/R22 (salvo el ajuste de mensaje de R22 derivado de Q4).

---

## Contexto reutilizado (no se reinventa)

- **Bodega responsable** de un mensajero = su zona: `bodega_central` si la zona del
  mensajero es la central (`zona.esCentral` vía `IZonaRepository.findCentralZonaId()`),
  o `bodega_satelite` de su propia zona (`usuario.zonaId`) en caso contrario. Esta
  derivación ya la ejecuta `CierreDiaService.solicitarCierre` (features 37/54).
- **Estados de cierre** (`cierre_estado`, feature 37): `solicitado`, `aprobado`,
  `rechazado`. Esta feature AÑADE `vencido`.
- **Gestiones del día sin cerrar**: `gestion_orden` con `cierre_id IS NULL`
  (feature 37). Solicitar/crear un cierre las vincula todo-o-nada.
- **Puntos de asignación a mensajero** (a bloquear): `GuiaAsignacionService.generarGuia`
  / `asignarDesdeBodega` (features 17/30, maestro) y `AsignacionSateliteService.asignar`
  (feature 34, adminSatelite). Ambos escriben con `updateMany` guardado por estado.
- **Desbloqueo**: aprobación del cierre en `CierresAdminService.aprobarCierre`
  (`solicitado -> aprobado`, feature 38).

---

## Jerarquía / bodega responsable

**R1** — El sistema DEBE determinar la bodega responsable de un mensajero a partir de
su zona: `bodega_central` cuando la zona del mensajero es la central
(`findCentralZonaId()`), o `bodega_satelite` de su propia zona en caso contrario,
reutilizando exactamente la derivación de la feature 37 (sin lógica divergente).

---

## Estado `vencido` y modelo de datos

**R2** — El sistema DEBE soportar `vencido` como cuarto valor del enum de estado de
cierre (`cierre_estado`), además de `solicitado`, `aprobado`, `rechazado`, con la
fuente única de verdad `CIERRE_ESTADO_SEED` (`lib/types/cierre.ts`) alineada al enum
Prisma.

**R3** — La migración que agrega `vencido` DEBE ser aditiva y traer su `down.sql`
(revierte el enum a los tres valores originales); NO DEBE alterar las policies RLS
existentes de `cierre_dia` / `cierre_bodega`.

**R4** — SI un cierre está en estado `vencido`, ENTONCES el sistema NO DEBE recalcular
ni mutar los totales snapshot de ese cierre ni de ningún cierre ya resuelto
(`aprobado`/`rechazado`); los totales de un `vencido` se congelan al crearse (igual que
`solicitado`, money-critical).

---

## Corte diario (job programado) y creación de vencidos

**R5** — El sistema DEBE exponer un endpoint de corte diario (route handler
`/api/cron/corte-diario`) que, SI la petición no presenta el secreto `CRON_SECRET`
válido, ENTONCES responde 401 sin ejecutar ningún efecto (F1.4-Q1).

**R6** — CUANDO se ejecuta el corte diario, el sistema DEBE, por cada mensajero que
"debía cerrar y no solicitó cierre", crear un cierre en estado `vencido` con destino a
su bodega responsable (R1) (F1.4-Q1/Q2).

**R7** — El sistema DEBE definir "debía cerrar y no solicitó" como: el mensajero tiene
al menos una `gestion_orden` con `cierre_id IS NULL` (actividad del día sin cerrar) y NO
tiene un cierre en estado `solicitado` pendiente (F1.4-Q2).

**R8** — CUANDO se crea un cierre `vencido`, el sistema DEBE, en una transacción
todo-o-nada, vincular (`cierre_id`) todas las gestiones pendientes del mensajero y
snapshotear los totales por método de pago, el total general y el pago al mensajero,
con el MISMO cálculo money-safe (`Prisma.Decimal`) que `solicitarCierre` (features
37/39).

**R9** — SI el corte diario se ejecuta más de una vez para la misma jornada, ENTONCES
el sistema NO DEBE crear cierres `vencido` duplicados ni alterar los ya creados
(idempotencia: una vez vinculadas las gestiones al `vencido`, ya no cumplen R7)
(F1.4-Q1).

**R10** — MIENTRAS un mensajero tenga un cierre en estado `solicitado` pendiente, el
corte NO DEBE crear un `vencido` para ese mensajero (el cierre solicitado ya cumple la
obligatoriedad; se resuelve por el flujo normal 38).

**R11** — El corte diario DEBE ejecutarse a las 00:00 de la hora local de Costa Rica
(`America/Costa_Rica`, UTC-6), es decir a las 06:00 UTC; la resolución de "la jornada
que cierra" DEBE calcularse en hora local CR, no en UTC (F1.4-Q1).

---

## Bloqueo del mensajero

**R12** — MIENTRAS un mensajero tenga al menos un cierre en estado bloqueante
(`solicitado` o `vencido`), el sistema DEBE considerarlo BLOQUEADO para recibir nuevas
asignaciones. El bloqueo es DERIVADO de la existencia de esos cierres (sin flag
persistido) (F1.4-Q3).

**R13** — CUANDO el maestro genera guía o asigna desde bodega (feature 17/30) hacia un
mensajero bloqueado (R12), el sistema DEBE rechazar la asignación de las órdenes
dirigidas a ese mensajero, con motivo accionable y SIN efectos parciales (todo-o-nada).

**R14** — CUANDO el adminSatelite asigna una orden (feature 34) a un mensajero
bloqueado (R12), el sistema DEBE rechazar la asignación, con motivo accionable y SIN
efectos parciales.

**R15** — CUANDO el cierre bloqueante de un mensajero se RESUELVE (aprobación de un
`solicitado`, o resolución de un `vencido` según R19), el sistema DEBE dejar de
bloquearlo, siempre que no le queden otros cierres bloqueantes.

**R16** — SI un cierre `rechazado` es el único estado de cierre de un mensajero,
ENTONCES el sistema NO DEBE considerarlo bloqueado por ese cierre (`rechazado` no es
estado bloqueante) (F1.4-Q3/Q5).

---

## Bloqueo de la bodega satélite

**R17** — MIENTRAS una bodega satélite tenga cierres pendientes de resolver, el sistema
DEBE considerarla BLOQUEADA para asignar órdenes a sus mensajeros. El bloqueo es
DERIVADO (sin flag) y se cumple si existe **CUALQUIERA** de estas dos causas (regla
estricta, F1.4-Q4):
(i) al menos un cierre de sus mensajeros con `destino_tipo = bodega_satelite`,
`destino_zona_id` = su zona y `estado IN ('solicitado','vencido')`; **O**
(ii) su propio `CierreBodega` hacia la central en estado pendiente (`estado =
'solicitado'`), es decir un `CierreBodega` de `zona_id` = su zona que aún no ha sido
resuelto por la central (`solicitado`, el único estado no-resuelto que produce la
feature 40; `CierreBodega` comparte el enum `CierreEstado` y se resuelve a
`aprobado`/`rechazado`).
Si CUALQUIERA de (i) o (ii) existe, la bodega satélite está bloqueada.

**R18** — CUANDO el adminSatelite intenta asignar (feature 34) MIENTRAS su bodega está
bloqueada por CUALQUIERA de las dos causas de R17, el sistema DEBE rechazar la
asignación con motivo accionable (que distinga si el bloqueo proviene de cierres de sus
mensajeros o de su propio `CierreBodega` pendiente) y SIN efectos parciales.

---

## Resolución del vencido y evidencia

**R19** — El sistema DEBE permitir que la bodega responsable resuelva un cierre
`vencido` (aprobar/rechazar) reutilizando el flujo de la feature 38, extendiendo la
guardia de transición para aceptar `vencido` como estado de origen; resolverlo
desbloquea al mensajero (R15). El detalle y los totales del `vencido` NO se recalculan
(R4) (F1.4-Q5).

**R20** — El módulo `/cierres-admin` de la bodega responsable (maestro para la central;
adminSatelite para su zona) DEBE exponer los cierres `vencido` diferenciados del resto
de estados (cola/evidencia), respetando el alcance por rol+zona ya existente (feature
38/40) (F1.4-Q6).

---

## Reflejo en la UI del bloqueo

**R21** — MIENTRAS un mensajero esté bloqueado (R12), su vista ("Cierre del día" / "Mis
asignaciones") DEBE mostrar un aviso accionable indicando que no puede recibir nuevas
asignaciones hasta que su cierre sea resuelto (F1.4-Q6).

**R22** — MIENTRAS la bodega satélite esté bloqueada por CUALQUIERA de las dos causas de
R17, la vista de asignación del adminSatelite DEBE mostrar un aviso accionable que
indique que debe resolver los cierres pendientes antes de poder asignar, diferenciando
si el bloqueo proviene de cierres de sus mensajeros (i) o de su propio `CierreBodega`
pendiente hacia la central (ii) (F1.4-Q6).

---

## Concurrencia y seguridad

**R23** — El corte diario y las guardas de asignación DEBEN ser concurrencia-seguras y
sin TOCTOU: el corte crea el `vencido` con guardia todo-o-nada (vincula gestiones solo
si `cierre_id IS NULL` y no existe `solicitado`), y las asignaciones aplican la guardia
de bloqueo dentro del mismo `updateMany` (o transacción) que la transición, de modo que
`count === 0` en el lote se reporta como conflicto sin efectos parciales.

**R24** — El endpoint del corte diario DEBE manejar errores según convenciones (nada de
`catch` vacíos; error relevante notificado por el canal definido) y NO DEBE registrar
en logs el `CRON_SECRET` ni PII/secretos.

---

## Trazabilidad (mapa preliminar R -> tipo de test)

| R | Verificación esperada |
| --- | --- |
| R1 | unit: derivación bodega responsable central vs satélite |
| R2 | unit/type: `CIERRE_ESTADO_SEED` incluye `vencido`, exhaustividad enum Prisma |
| R3 | integración: migración up/down round-trip; RLS intacta |
| R4 | unit: crear `vencido` no muta cierres resueltos; snapshot congelado |
| R5 | integración: 401 sin `CRON_SECRET`; 200 con secreto válido |
| R6 | integración: corte crea `vencido` para mensajero con actividad sin cierre |
| R7 | unit: criterio "debía cerrar" (con/sin gestiones pendientes; con solicitado) |
| R8 | unit/integración: vincula gestiones + snapshot totales todo-o-nada |
| R9 | integración: segunda corrida no duplica vencidos |
| R10 | unit: no crea vencido si hay `solicitado` |
| R11 | unit: cálculo de la jornada en hora CR (UTC-6) |
| R12 | unit: `estaBloqueado` derivado (solicitado/vencido -> true; rechazado -> false) |
| R13 | unit/integración: `generarGuia`/`asignarDesdeBodega` rechaza mensajero bloqueado |
| R14 | unit/integración: `AsignacionSateliteService.asignar` rechaza mensajero bloqueado |
| R15 | integración: aprobar/resolver desbloquea |
| R16 | unit: `rechazado` no bloquea |
| R17 | unit: bloqueo de bodega derivado por AMBAS causas — (i) cierre solicitado/vencido de sus mensajeros en su zona **y** (ii) su propio `CierreBodega` `solicitado`; cada causa por separado bloquea; sin ninguna, no bloquea |
| R18 | unit/integración: asignar con bodega bloqueada por (i) y por (ii) -> rechazo sin efectos, con motivo que distingue la causa |
| R19 | integración: resolver un `vencido` (aprobar/rechazar) vía flujo 38 extendido |
| R20 | integración: `/cierres-admin` lista vencidos por alcance rol+zona |
| R21 | e2e/componente: aviso de bloqueo en vista del mensajero |
| R22 | e2e/componente: aviso de bloqueo de bodega en vista adminSatelite, diferenciando causa (i) mensajeros vs (ii) `CierreBodega` propio |
| R23 | integración: carrera corte/solicitar y asignación concurrente sin efectos parciales |
| R24 | integración: error del cron no filtra secreto; ruta de notificación invocada |

---

## F1.4 — decisiones pendientes (el humano decide en la puerta de aprobación)

> Cada pregunta trae una **recomendación**. Los requisitos de arriba asumen las
> recomendaciones; si el humano elige otra opción, se ajustan antes de implementar.

**Q1 — Mecanismo del cron.**
¿Vercel Cron Jobs (`vercel.json` con `crons` apuntando a un route handler
`/api/cron/corte-diario` protegido con `CRON_SECRET`) vs. un script/comando corrido por
un scheduler externo?
_Recomendación:_ **Vercel Cron Jobs** (vía nativa de Vercel, sin proceso aparte). El
handler valida el header `Authorization: Bearer $CRON_SECRET` (o el header que inyecta
Vercel Cron) → 401 si no coincide (R5). **Zona horaria:** Vercel Cron corre en UTC; el
"00:00 CR" se programa como `0 6 * * *` (06:00 UTC = 00:00 UTC-6) (R11). **Idempotencia
(R9):** no se necesita tabla de dedupe por fecha — al vincular las gestiones al
`vencido` (`cierre_id` deja de ser NULL), una segunda corrida ya no las ve pendientes
(R7), por lo que no re-crea nada.

**Q2 — Qué es concretamente un "cierre vencido".**
¿Se CREA una fila `cierre_dia` con `estado='vencido'` (evidencia/auditoría para la
bodega responsable) vs. un estado virtual sin fila? ¿A qué mensajeros aplica?
_Recomendación:_ **Crear una fila real** `cierre_dia estado='vencido'` (misma tabla,
mismo snapshot de totales y pago, mismas gestiones vinculadas que un `solicitado`), para
que quede evidencia auditable y la bodega responsable la vea en `/cierres-admin`.
**Criterio "debía cerrar" (R7):** mensajero con ≥1 `gestion_orden` con `cierre_id IS
NULL` y sin cierre `solicitado` pendiente. (No se exige una ventana de fecha extra: las
gestiones sin cierre SON el trabajo del día no cerrado; el modelo ya las acumula.)

**Q3 — Bloqueo del mensajero: flag persistido vs. derivado.**
_Recomendación:_ **Derivado** (sin flag, sin drift): bloqueado ⇔ existe `cierre_dia` con
`estado IN ('solicitado','vencido')` para ese mensajero. Un índice sobre
`(mensajero_id, estado)` mantiene la consulta barata en la ruta caliente de asignación.
**Estados que bloquean:** `solicitado` **y** `vencido` (ambos = dinero sin conciliar).
**Desbloquea:** la resolución (aprobación del `solicitado`; resolución del `vencido`,
ver Q5). `rechazado` NO bloquea (R16).

**Q4 — Bloqueo de la bodega satélite: qué cuenta como "cierres pendientes".**
> ⚠️ ANULADA por F1.4 (2026-07-12): el humano eligió la **regla más estricta** — el
> bloqueo cuenta AMBAS causas ((i) cierres de sus mensajeros **O** (ii) su propio
> `CierreBodega solicitado` hacia la central). Ver bloque "F1.4 APROBADA" y R17. La
> recomendación original (solo (i)) se conserva abajo como registro histórico.
_Recomendación:_ Para el bloqueo de **asignar hacia abajo** (a sus mensajeros), cuentan
los cierres de SUS mensajeros con `destino_tipo=bodega_satelite`, `destino_zona_id`=su
zona y `estado IN ('solicitado','vencido')` (los que el adminSatelite debe resolver
antes de seguir operando). **Derivado**, análogo a Q3. El propio `CierreBodega
solicitado` (cierre hacia la central, feature 40) NO forma parte de este bloqueo de
asignación (es otro nivel); se deja como decisión explícita del humano por si quiere
incluirlo.

**Q5 — Resolución / reapertura de un vencido.**
¿Un `vencido` puede resolverse (admin lo tramita / mensajero lo solicita
retroactivamente) o queda histórico inmutable? ¿bloquea hasta resolverse?
_Recomendación:_ El `vencido` **bloquea** al mensajero (R12) y **es resoluble por la
bodega responsable** reutilizando la feature 38 (aprobar/rechazar), extendiendo la
guardia de transición para aceptar `vencido` como origen además de `solicitado` (R19).
Resolverlo desbloquea (R15). Los totales del `vencido` NO se recalculan al resolver
(R4). Alternativa que el humano puede preferir: `vencido` inmutable + acción explícita
de "reabrir/solicitar retroactivamente" del mensajero — se descarta por recomendación
por su mayor superficie (nuevo flujo del mensajero) pero queda anotada.

**Q6 — Alcance de la UI.**
_Recomendación:_ **Sin pantallas nuevas.** Los vencidos se muestran en el
`/cierres-admin` role-aware existente (features 38/40) como una categoría diferenciada;
el bloqueo del mensajero se avisa en su vista "Cierre del día"/"Mis asignaciones"
existente; el bloqueo de la bodega se avisa en la vista de asignación del adminSatelite
existente. Lo único imprescindible nuevo es el route handler del cron (sin UI).

## Preguntas abiertas (fuera de F1.4, menores)

- **P1** — ¿El `vencido` debe notificar activamente (correo/canal) a la bodega
  responsable al crearse, o basta con que aparezca en `/cierres-admin`? (R24 cubre la
  notificación de ERRORES del cron; la notificación de negocio del vencido no está
  pedida explícitamente en la descripción.) Recomendación: fuera de alcance de la 41;
  candidato a follow-up si el humano lo pide.
- **P2** — Si un mensajero pierde su `zonaId` (nulo) al momento del corte, ¿se omite el
  vencido o se registra sin destino? Recomendación: **omitir** con log de aviso (no se
  puede derivar bodega responsable sin zona; mismo criterio que `solicitarCierre`, que
  devuelve `sin_zona`).
