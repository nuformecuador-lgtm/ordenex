# Review — Feature 48: rechazo, devolucion a la tienda de origen

Reviewer del arnes SDD. Rama feature/48-rechazo-devolucion-tienda-origen, impl commit 5467b94.
Verificacion EJECUTABLE (no de palabra): tests corridos por el reviewer via ./init.sh.

## Veredicto: APROBADO (OK)

Sin bloqueantes. Los 19 requisitos EARS mapean a tests reales con aserciones concretas;
./init.sh verde (2405/2405); transicion atomica via el choke point #11 de la 49 confirmada;
cobertura de la 49 sigue en 11 puntos y verde; SIN migracion; autz rol+zona server-side correcta;
sub-riesgo F1.4-d respetado (adminSatelite NO se agrego a OrdenService.KNOWN_ROLES).

## Checklist CHECKPOINTS.md

- [x] requirements.md con R1..R19 EARS numerados.
- [x] design.md con alternativas descartadas (8.1-8.4).
- [x] tasks.md — tasks accionables [x]; las [ ] restantes son T0 (puerta, hecha en current),
      T5 (endurecimiento OPCIONAL, no solicitado), T12/T14/T15 (verificacion, ejecutadas), y el
      bloque T16/T17 condicional de migracion (NO aplica con la opcion recomendada).
- [x] Cada R<n> mapea a >=1 test concreto (tabla abajo).
- [x] progress/impl_48.md contiene el mapa R<n> -> test.
- [x] pnpm run typecheck 0 errores (init.sh set -e no aborto; ninguno fuera de .next/).
- [x] pnpm run lint 0 errores (135 warnings preexistentes en .claude/skills/impeccable/scripts/, ajenos).
- [x] pnpm test 2405/2405 en 265 archivos.
- [~] E2E de flujo critico: e2e/devolucion-origen.spec.ts ESCRITO pero DIFERIDO (sin harness seed/login,
      importa @playwright/test, no corre bajo vitest). Consistente con 46/47. -> deuda MENOR.
- [x] Datos/seguridad: sin tabla nueva -> RLS N/A; sin secretos; sin hardcode de pais/moneda/cuenta.
- [x] Migraciones: NINGUNA (git diff db/ vacio); las existentes conservan down.sql.
- [x] Capas: Controller (Server Action) -> Service -> Repository; interfaces en lib/interfaces/services/.
      Service sin HTTP/Prisma; repo solo Prisma.
- [x] Permisos: autz server-side en el service; mutacion interna via Server Action (no fetch a API).
- [x] ./init.sh verde; review_48.md (este) con veredicto OK.

## Tabla R<n> -> test (verificada, no vacia)

| R | Que exige | Test que lo verifica (asercion real) | Estado |
| --- | --- | --- | --- |
| R1 | Elegible por ESTADO rechazada, ambos caminos (36/47) | devolucion-origen-service.test.ts "orden rechazada por rechazo directo Y por escalado son ambas retornables" (ambas -> ok, update x1) | OK |
| R2 | No exige dato extra; conserva tienda_id/num_guia/mensajero | mismo test + ordenDTO conserva mensajeroAsignadoId/numGuia/tiendaId | OK |
| R3 | Sin transicion automatica (36/47 intactos) | git diff dev...HEAD NO toca MisAsignacionesService.ts ni GestionOrdenRepository.ts; los tests de rechazo/escalado siguen dejando rechazada | OK |
| R4 | Transicion rechazada -> devuelta_origen | devolucion-origen-service.test.ts "transiciona..."; action test; OrdenesRevisionMaestro/RecepcionSateliteModule tests | OK |
| R5 | Guardia de estado + idempotencia | devolucion-origen-service.test.ts "estado != rechazada -> conflict, sin escribir" + "devuelta_origen es idempotente (no update ni historial)" | OK |
| R6 | Tienda origen = orden.tienda_id, sin campo nuevo | fixtures del service + orden-service.test.ts (scope por tiendaId); sin cambio de schema | OK |
| R7 | Atomico: si el append falla, revierte | orden-repository.test.ts "si el append del historial falla, revierte el cambio de estado (atomico, R7)" (rechaza toda la $transaction) | OK |
| R8 | Actor + origen_tipo en el historial | orden-repository.test.ts "deja UNA fila con actorUsuarioId=admin y origen_tipo=ajuste_estado por el choke point" | OK |
| R9 | Cobertura 49 en 11, sin devolucion_origen | orden-historial-cobertura.test.ts "feature 48 (R9): el enum NO gana devolucion_origen; reutiliza ajuste_estado" (11 puntos, 1 por familia) | OK |
| R10 | Autz por bodega responsable (rol+zona) | devolucion-origen-service.test.ts (central: permite maestro/admin, niega resto; satelite: permite el de la zona, niega otra zona; fallback null) + OrdenesRevisionMaestro.test.tsx (zonaEsGam=true; readOnly) + RecepcionSateliteModule.test.tsx | OK |
| R11 | Sin permiso -> denegado sin efectos | devolucion-origen-service.test.ts (forbidden -> update NO llamado) + devolucion-origen.test.ts (unauthenticated / forbidden como dominio) | OK |
| R12 | Visibilidad tienda server-side por tienda_id | orden-service.test.ts "adminTienda ve sus rechazada/devuelta_origen por where.tiendaId"; "orden de otra tienda no aparece"; "filtro por estado" | OK |
| R13 | Etiquetas legibles (no value crudo) | OrdenesEstatusLabelAdminTienda.test.tsx ("Rechazada"/"Devuelta a origen"; queryByText(value) null) | OK |
| R14 | Visibilidad otros roles | OrdenesRevisionMaestro.test.tsx (apartado "Devueltas a origen" solo lectura) + RecepcionSateliteModule.test.tsx ("Por devolver a tienda") + recepcion-satelite-service.test.ts (porDevolver por zona) | OK |
| R15 | Linea de tiempo muestra la transicion | HistorialOrdenTimeline.test.tsx "R15: incluye rechazada -> devuelta_origen con actor y timestamp" (time, "Bodega Central", "Devuelta a origen") | OK |
| R16 | No regresion 36/47/49 | MisAsignacionesService/GestionOrdenRepository NO modificados; suite previa verde | OK |
| R17 | Sin order_status ni migracion nueva | git diff dev...HEAD vacio en db/schema.prisma y db/migrations/; cobertura afirma enum sin devolucion_origen | OK |
| R18 | ./init.sh verde | typecheck 0, lint 0, 2405/2405 | OK |
| R19 | Cada R mapeado a test | impl_48.md mapa R->test; esta tabla | OK |

## Transicion atomica + trazada + cobertura 49

- Choke point #11: DevolucionOrigenService.devolverATienda NO crea call-site nuevo; llama
  OrdenRepository.update(ordenId, { estatusId }, { actorUsuarioId, origenTipo: "ajuste_estado" }).
- Atomicidad: OrdenRepository.update (OrdenRepository.ts:346-391) hace el updateMany de estado +
  appendCambioEstado dentro de la MISMA prisma.$transaction. Registra el historial SOLO si el estatus
  cambia (data.estatusId != origenEstatusId). El test de repo confirma: (a) UNA fila
  rechazada -> devuelta_origen con actor = admin de bodega y origen_tipo = ajuste_estado; (b) si
  createMany del historial lanza, la $transaction aborta y nada persiste. Un cambio de estado sin su
  linea de historial NO es posible por esta via.
- Cobertura 49: orden-historial-cobertura.test.ts SIGUE en EXACTAMENTE 11 puntos (1 por familia de
  origen_tipo), con #11 documentado como servidor tambien del retorno, y una asercion NUEVA de que el
  enum NO contiene devolucion_origen. Verde. No se relajo ni crecio a 12.

## Autz rol+zona (R10/R11) y sub-riesgo F1.4-d

- Guardia server-side en DevolucionOrigenService.esBodegaResponsable: bodega_central ->
  maestro/admin; bodega_satelite -> adminSatelite cuya findUsuarioZonaId == orden.zonaId; resto
  (adminTienda, mensajero, adminSatelite de otra zona) -> forbidden. Deriva la bodega con
  resolverDestinoCierre(orden.zonaId, findCentralZonaId()) (misma regla 41; fallback central null ->
  satelite). Sin bypass: la escritura (update) solo se alcanza tras pasar la autz.
- Sub-riesgo F1.4-d resuelto: OrdenService.KNOWN_ROLES (OrdenService.ts:21) sigue SIN adminSatelite;
  la autz 6/26 queda intacta. La superficie/accion del satelite vive en RecepcionSateliteService.listar
  (bucket porDevolver, acotado server-side a findUsuarioZonaId), NO en el listado generico de ordenes.
  No filtra datos de otras zonas.
- Frontend defensa-en-profundidad: el maestro filtra zonaEsGam === true (mapea a esCentral) antes de
  abrir el modal; la autz real la impone el service en el servidor.

## SIN migracion

git diff --stat dev...HEAD NO reporta cambios en db/schema.prisma ni db/migrations/. Diff total: solo
aditivo (nuevo service/action/interface/modal + cambios aditivos a RecepcionSateliteService y fixtures).
rechazada/devuelta_origen ya sembrados; tienda de origen = orden.tiendaId; retorno reutiliza
origen_tipo = ajuste_estado (#11) -> sin ALTER TYPE, sin columna nueva.

## ./init.sh

    Test Files  265 passed (265)
         Tests  2405 passed (2405)
    todas las migraciones tienen down.sql
    .env presente
    == init OK ==

typecheck 0 errores; lint 0 errores (135 warnings preexistentes en .claude/skills/, ajenos).
Conteo REAL = 2405, coincide con impl_48.md (baseline 2361 -> +44).

## Hallazgos

### MENOR (deuda, no bloqueante)

1. Orden de guardias: autz DESPUES de la guardia de estado (info-disclosure leve).
   En DevolucionOrigenService.devolverATienda el corto-circuito idempotente
   (estatusValue === "devuelta_origen" -> ok) y el conflict (cuyo motivo incluye el estado actual de
   la orden) se ejecutan ANTES de esBodegaResponsable. Consecuencia: un actor AUTENTICADO pero no
   responsable (p. ej. adminTienda, o adminSatelite de otra zona) que conozca un ordenId puede
   (a) recibir ok sobre una orden ya devuelta_origen, y (b) conocer el estado actual via el motivo del
   conflict. NO modifica estado ni historial en ninguno de los dos casos (R11 "sin modificar estado ni
   historial" se cumple; update no se llama), los UUID no son enumerables y el borde exige sesion.
   Ademas coincide con el orden APROBADO en design.md 2.2 (paso 2 guardia, paso 3 autz). Por eso es
   MENOR. Recomendacion de endurecimiento (follow-up): mover la autz por bodega responsable ANTES de
   la guardia de estado (authz-first), o no exponer el estado en el motivo a actores no responsables.

2. E2E diferido (T13). e2e/devolucion-origen.spec.ts esta escrito pero NO es ejecutable (no existe
   harness de seed/login E2E; emails placeholder; importa @playwright/test -> fuera de la suite
   vitest). CHECKPOINTS pide E2E para flujos criticos; este flujo es adyacente a ingesta/recaudo
   (gestion de estado de ordenes). Consistente con la deuda ya aceptada en 46/47. Queda como deuda
   escrita-no-ejecutada; recomendable levantar el harness E2E como follow-up transversal.

### BLOQUEANTES

Ninguno.

## Conclusion

La feature cumple los 19 requisitos con trazabilidad a tests reales, respeta el choke point de la 49
con transicion atomica y trazada, mantiene la cobertura cerrada en 11, no introduce migracion, aplica
autz server-side por rol+zona sin romper la autz existente (6/26) ni el KNOWN_ROLES, y ./init.sh queda
verde en 2405/2405. Veredicto: OK (APROBADO). Dos deudas MENORES documentadas para follow-up
(orden authz-first; harness E2E).
