# Review — Feature 139 (Flujo de devolución de RECHAZADAS)

> Reviewer (`model: opus`), 2026-07-25. Este doc lo transcribe el leader porque la conexión
> degradada impidió al reviewer escribirlo directamente; el veredicto y hallazgos son los que
> devolvió el agente.

## VEREDICTO: APROBADO-CON-NOTAS — sin bloqueantes

## Trazabilidad R1–R24: COMPLETA
Cada requisito mapea a un test real y asertivo. Re-verificado en verde: typecheck 0, lint 0,
**271 tests dirigidos PASS** (backend 87 + frontend 82 + migración/seed 102, incluidos los 6 que
arregló `26a58c7`).
- **R9** retirado en las **3 superficies**: `OrdenesTabs` (sin acción en `rechazada`),
  `RecepcionSateliteModule` (`enviarACentral`), `OrdenesRevisionMaestro` (apartado rechazadas a
  solo-lectura).
- **R17 recepción central state-aware:** preserva el caso 138 (sus tests siguen verdes) y añade
  `devolviendo_a_bodega_central → por_devolver_a_tienda`.
- **R5–R12 (disparo por aprobación del cierre):** atómico, money-neutral, idempotente, `rechazado`
  no dispara, ruteo por `resolverDestinoCierre`, historial `devolucion_rechazada`.

## Bloqueantes
Ninguno.

## Dictamen de los puntos evaluados
- **T4.1 (test de integración del recorrido completo) AUSENTE → DEUDA ACEPTABLE.** Cada transición
  (R5, R13–R18) tiene unit test asertivo y verde; el flujo no está en la lista E2E-obligatoria de
  CHECKPOINTS (auth/pagos/recaudo/ingesta/webhooks); el bloque del cierre es money-neutral y está
  testeado. Mismo criterio que la 138 ("sin E2E"). **Pendiente como follow-up.**
- **Migraciones no aplicadas contra DB real** (sin `.env`): deuda post-merge; ambas con `down.sql` y
  tests estáticos de reversibilidad verdes. Aceptable, igual que 137/138.
- **`origen_tipo` del caso 139 = `recepcion_bodega_central`** (no `ajuste_estado`): coherente con el
  gate F1.4-Q2 (reusar el mecanismo de la 138, mismo evento físico); preserva el espíritu de R23 (sin
  enum nuevo). Aceptable.
- **`lib/types/recepcion-satelite.ts` (`enTransitoACentral`, solo tipo):** completación de contrato
  alineada con el service. OK.

## Notas menores (no bloqueantes)
- **R22 en los envíos por lote (R13/R15):** `OrdenRepository.update` guarda el UPDATE solo por
  `{id, deletedAt:null}` (no por `estatus_id=origen`), con pre-check en el service. Desviación respecto
  a la letra de R22 pero prescrita por el design §4.1/§4.4 y espejo del precedente aprobado (feature
  48). El anti-TOCTOU SÍ se honra en R5/R17/R18. **Recomendación futura:** endurecer a
  `updateMany WHERE estatus_id=origen`.
- **Proceso:** `tasks.md` marcado tras el OK; la descripción de `feature_list.json` 139 conserva
  nombres viejos (`en_ruta_devolucion_central`, `en_tienda`) — drift menor, el canónico es el spec;
  el título de `26a58c7` ("actualiza down.sql previos") es engañoso: el fix ajusta las EXPECTATIVAS de
  los tests de migración (que derivan la lista del SEED), no los `down.sql` (el cuerpo del commit lo
  aclara).
