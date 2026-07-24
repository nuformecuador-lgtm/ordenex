# Feature 138 — Guardia central de transiciones de `order_status` — tasks.md

> Checklist verificable. `[P]` = paralelizable con las tareas de su mismo bloque.
> Cada task tiene criterio de "hecho". Trazabilidad `R<n>` -> test en `progress/impl_138.md`.

## Bloque 0 — Preludio (bloqueante)

- [ ] **T0.1 Confirmar las preguntas abiertas Q1–Q6** con el humano en la puerta de
  aprobación. En especial Q1 (`en_tienda` vs `recibido_origen`), Q2
  (`en_ruta_bodega_principal` vestigial), Q3 (política escape hatch), Q4 (alcance
  135/136/137).
  - Hecho: respuestas registradas; el mapa se ajusta a ellas antes de T2.
  - Depende de: —

## Bloque 1 — Módulo del mapa (dominio puro) `[P entre sí una vez fijado el contrato]`

- [ ] **T1.1 Crear `lib/types/order-status-transiciones.ts`** con `TRANSICIONES`,
  `ESTADOS_CREACION`, `ESTADOS_TERMINALES`, indexado por `OrderStatusValue`, poblado con el
  inventario del apéndice A (aristas 1–36 + creación). (R1, R2, R3, R8)
  - Hecho: compila; `TRANSICIONES satisfies Record<OrderStatusValue, readonly Destino[]>`
    no rompe el build.
  - Depende de: T0.1.

- [ ] **T1.2 Añadir el chequeo de exhaustividad estática** (`satisfies` + tipo
  `_EnsureExhaustive`, patrón `orden-historial.ts`) que rompe el build si el catálogo gana
  un valor sin clasificar. (R5)
  - Hecho: al agregar un `value` ficticio al SEED en local, el `tsc` falla.
  - Depende de: T1.1.

- [ ] **T1.3 `[P]` Implementar `TransicionIlegalError` + `assertTransicionValida`** (pura,
  O(1), sin PII en el mensaje). Incluye la rama `origen === null` contra `ESTADOS_CREACION`.
  (R6, R10, R12, R13)
  - Hecho: función exportada y tipada; error distinguible por `instanceof`.
  - Depende de: T1.1.

## Bloque 2 — Cableado en el choke point

- [ ] **T2.1 Inyectar el resolvedor de catálogo cacheado** (`id -> value`, por proceso,
  default real) en `appendCambioEstado`, patrón del parámetro `emitir` con default. (R13)
  - Hecho: firma con parámetro opcional; los ~18 call-sites compilan sin cambios (R8).
  - Depende de: T1.3.

- [ ] **T2.2 Validar cada entrada del lote antes del `createMany`** llamando
  `assertTransicionValida`; el `throw` propaga y revierte la `$transaction`. (R6, R7, R11)
  - Hecho: transición legal -> mismo comportamiento (append + webhook); transición ilegal
    -> `throw`, sin `createMany` ni `emitir`.
  - Depende de: T2.1.

## Bloque 3 — Tests (trazabilidad R->test)

- [ ] **T3.1 Test de conectividad del grafo** (`START` virtual + creación/terminales):
  todo no-terminal con `inDegree>=1` y `outDegree>=1`; terminales con `inDegree>=1`;
  cobertura del SEED salvo allowlist vestigial. (R14, R15, R16)
  - Hecho: pasa con el mapa actual (o falla nombrando `en_ruta_bodega_principal` si Q2 no
    lo allowlista); el nombre del test describe el comportamiento.
  - Depende de: T1.1.

- [ ] **T3.2 `[P]` Test unit de `assertTransicionValida`**: acepta cada arista del
  inventario (R8), rechaza un par no listado con `TransicionIlegalError` (R6), valida
  `null -> creación` y rechaza `null -> no-creación` (R10), mensaje sin PII (R12). (R6, R8,
  R10, R12)
  - Hecho: cubre aristas legales representativas + casos ilegales.
  - Depende de: T1.3.

- [ ] **T3.3 `[P]` Test del choke point**: lote legal -> `createMany` + `emitir` llamados
  (espía); lote con 1 ilegal -> lanza y NO llama `createMany` ni `emitir` (R7); regresión
  (R11) con doble espía. (R7, R11, R13)
  - Hecho: verifica atomicidad y no-regresión.
  - Depende de: T2.2.

- [ ] **T3.4 `[P]` Test de no-regresión de call-sites**: para cada familia `origen_tipo`
  del inventario, la transición que ejecuta hoy sigue pasando la guardia (R8). Puede ser un
  test data-driven sobre el apéndice A.
  - Hecho: ninguna transición existente empieza a fallar.
  - Depende de: T2.2.

## Bloque 4 — Cierre

- [ ] **T4.1 Escribir `progress/impl_138.md`** con el mapa `R1..R17 -> test` (R17) y notas
  de las decisiones de Q1–Q6 tal como se aprobaron.
  - Hecho: cada requisito tiene su test; el reviewer puede verificarlo.
  - Depende de: T3.1–T3.4.

- [ ] **T4.2 `./init.sh` verde + suite completa verde**, sin aflojar tests existentes ni
  `any` sin justificar. (docs/verification.md)
  - Hecho: `./init.sh` y `pnpm test` terminan en verde en worktree limpio.
  - Depende de: T4.1.

## Archivos esperados

**Nuevos (código de producción — los crea el implementer, NO el spec_author):**
- `lib/types/order-status-transiciones.ts` — `TRANSICIONES`, `ESTADOS_CREACION`,
  `ESTADOS_TERMINALES`, `TransicionIlegalError`, `assertTransicionValida`.

**Modificados:**
- `lib/repositories/registrar-cambio-estado.ts` — validación en `appendCambioEstado` +
  parámetro resolvedor de catálogo con default (sin cambiar la firma para los call-sites).

**Tests nuevos:**
- `tests/unit/domain/order-status-transiciones.connectividad.test.ts` — R14/R15/R16.
- `tests/unit/domain/order-status-transiciones.guardia.test.ts` — R6/R8/R10/R12.
- `tests/unit/repositories/registrar-cambio-estado.guardia.test.ts` — R7/R11/R13 + R8
  data-driven.

**Estado / trazabilidad:**
- `progress/impl_138.md` — mapa `R<n> -> test`.

> Sin migraciones, sin `down.sql`, sin RLS, sin rutas/endpoints nuevos (§2/§6 de design.md).
