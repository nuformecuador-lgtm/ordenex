# Feature 140 — Guardia central de transiciones de `order_status` — tasks.md

> Checklist verificable. `[P]` = paralelizable con las tareas de su mismo bloque.
> Cada task tiene criterio de "hecho". Trazabilidad `R<n>` -> test en `progress/impl_140.md`.

## Bloque 0 — Preludio (bloqueante)

- [x] **T0.1 Confirmar las preguntas abiertas** con el humano en la puerta de aprobación.
  **HECHO (gate F1.4, 2026-07-25): Q1–Q7 CERRADAS.** Resumen operativo:
  - **Q1** terminales = `entregada`, `devuelta_a_tienda`.
  - **Q2** `en_ruta_bodega_central` NO es vestigial (entrada por creación `carga_api`,
    salida por la 138) -> **conjunto vestigial VACÍO, sin allowlist**.
  - **Q3** TODO pasa por la guardia: **sin override `ANY -> ANY`**, ni para maestro/admin.
  - **Q4** aristas de 138/139 verificadas contra código; **no quedan `TODO`** en el mapa.
  - **Q5** la creación SÍ se valida:
    `ESTADOS_CREACION = ["en_preparacion", "en_fulfillment", "en_ruta_bodega_central"]`.
  - **Q6** `throw` tipado (`TransicionIlegalError`, sin PII); firma de `appendCambioEstado`
    intacta para los ~18 call-sites.
  - **Q7** (decisión nueva) **ACTIVACIÓN ESTRICTA día 1**: sin modo shadow, sin solo-log,
    sin feature flag.
  - Hecho: respuestas registradas en `requirements.md` (bloque de preguntas) y reflejadas
    en el mapa del apéndice A de `design.md`.
  - Depende de: —

## Bloque 1 — Módulo del mapa (dominio puro) `[P entre sí una vez fijado el contrato]`

- [x] **T1.1 Crear `lib/types/order-status-transiciones.ts`** con `TRANSICIONES`,
  `ESTADOS_CREACION`, `ESTADOS_TERMINALES`, indexado por `OrderStatusValue`, poblado con el
  inventario del apéndice A: **41 aristas de flujo** (numeración 1–42 **con el #27
  RETIRADO**) + **3 aristas de creación**. (R1, R2, R3, R8)
  - Hecho: compila; `TRANSICIONES satisfies Record<OrderStatusValue, readonly Destino[]>`
    no rompe el build; el mapa cubre los **18** `value` del catálogo; **`rechazada ->
    devolviendo_a_tienda` NO aparece** (la 139 la retiró a propósito).
  - Depende de: T0.1.

- [x] **T1.2 Añadir el chequeo de exhaustividad estática** (`satisfies` + tipo
  `_EnsureExhaustive`, patrón `orden-historial.ts`) que rompe el build si el catálogo gana
  un valor sin clasificar. (R5)
  - Hecho: al agregar un `value` ficticio al SEED en local, el `tsc` falla.
  - Depende de: T1.1.

- [x] **T1.3 `[P]` Implementar `TransicionIlegalError` + `assertTransicionValida`** (pura,
  O(1), sin PII en el mensaje: sólo los dos `value`). Incluye la rama `origen === null`
  contra `ESTADOS_CREACION`. (R6, R10, R12, R13)
  - Hecho: función exportada y tipada; error distinguible por `instanceof`.
  - Depende de: T1.1.

## Bloque 2 — Cableado en el choke point

- [x] **T2.1 Inyectar el resolvedor de catálogo cacheado** (`id -> value`, por proceso,
  default real) en `appendCambioEstado`, patrón del parámetro `emitir` con default. (R13)
  - Hecho: firma con parámetro opcional; los ~18 call-sites compilan sin cambios (R8).
  - Depende de: T1.3.

- [x] **T2.2 Validar cada entrada del lote antes del `createMany`** llamando
  `assertTransicionValida`; el `throw` propaga y revierte la `$transaction`. (R6, R7, R11)
  - Hecho: transición legal -> mismo comportamiento (append + webhook); transición ilegal
    -> `throw`, sin `createMany` ni `emitir`.
  - Hecho (Q7): **NO se introduce** ninguna variable de entorno, `ordenesConfig.*`,
    parámetro de bypass ni rama "solo-log". Un grep del PR no encuentra ningún interruptor
    para desactivar la guardia.
  - Depende de: T2.1.

## Bloque 3 — Tests (trazabilidad R->test)

- [x] **T3.1 Test de conectividad del grafo** (`START` virtual + creación/terminales):
  todo no-terminal con `inDegree>=1` y `outDegree>=1`; terminales con `inDegree>=1`;
  cobertura EXACTA de los 18 `value` del SEED (sin exenciones: el conjunto vestigial está
  vacío). (R14, R15, R16)
  - Hecho: **pasa en verde** — la auditoría manual de A.3 confirma 0 callejones y 0 cuellos
    de botella con el mapa actualizado. Si fallara, es divergencia real contra el código: se
    investiga y se corrige el mapa, **no se allowlista nada**. El fallo nombra el/los
    `value` ofensores; el nombre del test describe el comportamiento.
  - Depende de: T1.1.

- [x] **T3.2 `[P]` Test unit de `assertTransicionValida`**: acepta cada arista del
  inventario (R8), rechaza un par no listado con `TransicionIlegalError` (R6), valida
  `null -> creación` para los tres `ESTADOS_CREACION` y rechaza `null -> no-creación`
  (R10), mensaje sin PII (R12). Incluye el caso de regresión explícito
  **`rechazada -> devolviendo_a_tienda` DEBE ser ilegal** (la 139 la retiró). (R6, R8,
  R10, R12)
  - Hecho: cubre aristas legales representativas + casos ilegales.
  - Depende de: T1.3.

- [x] **T3.3 `[P]` Test del choke point**: lote legal -> `createMany` + `emitir` llamados
  (espía); lote con 1 ilegal -> lanza y NO llama `createMany` ni `emitir` (R7); regresión
  (R11) con doble espía. (R7, R11, R13)
  - Hecho: verifica atomicidad y no-regresión.
  - Depende de: T2.2.

- [x] **T3.4 `[P]` Test de no-regresión de call-sites, data-driven sobre el inventario
  COMPLETO** del apéndice A (las 41 aristas de flujo + las 3 de creación, cada una con su
  `origen_tipo`): todas DEBEN pasar la guardia. (R8)
  - **Esta task es la mitigación del riesgo asumido en Q7** (activación estricta): es lo
    único que separa un hueco del inventario de una caída de flujo en producción. No vale
    un muestreo "representativo": la tabla del test se deriva del inventario ENTERO.
  - Hecho: ninguna transición existente empieza a fallar; el número de casos del test
    coincide con el recuento de A.3 (41 + 3).
  - Depende de: T2.2.

## Bloque 4 — Cierre

- [x] **T4.1 Escribir `progress/impl_140.md`** con el mapa `R1..R17 -> test` (R17) y notas
  de las decisiones de Q1–Q7 tal como se aprobaron (incluida la activación estricta y la
  consecuencia operativa de Q3: rescatar una orden atascada exige declarar la arista y
  desplegar).
  - Hecho: cada requisito tiene su test; el reviewer puede verificarlo.
  - Depende de: T3.1–T3.4.

- [x] **T4.2 `./init.sh` verde + suite completa verde**, sin aflojar tests existentes ni
  `any` sin justificar. (docs/verification.md)
  - Hecho: `./init.sh` y `pnpm test` terminan en verde en worktree limpio.
  - Nota (A.3-#8): si algún test existente crea órdenes en un estado fuera de
    `ESTADOS_CREACION`, se **ajusta el test**, no la guardia.
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
- `progress/impl_140.md` — mapa `R<n> -> test`.

> Sin migraciones, sin `down.sql`, sin RLS, sin rutas/endpoints nuevos (§2/§6 de design.md).
