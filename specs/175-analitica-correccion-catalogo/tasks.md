# 175 — Tasks

> Orden obligatorio: **T0 → T1 → (T2 ‖ T3) → T4 → T5 → T6**. Las marcadas `[P]` pueden ir en
> paralelo entre sí dentro de su bloque.
> Gate por tanda: `pnpm typecheck`, `pnpm lint` y `pnpm exec vitest related --run <archivos>`.
> La suite entera (`./init.sh`) la corre el **leader** al cerrar y antes del PR
> (`AGENTS.md > Regla del gate`).

## T0 — Puerta de preguntas abiertas (BLOQUEA EL ARRANQUE)

Espejo de `requirements.md §3`. **PUERTA CERRADA el 2026-08-03**: el humano ratificó las siete con
la recomendación escrita. **La decisión de Q1/Q2 vive en `progress/decision_175.md`** ⟨D11⟩, que es
el artefacto fechado que `metrics.ts:5-7` exige para tocar el catálogo.

- [x] **T0.1 (BLOQUEANTE, Q1) RATIFICADA: `incidentes` → `producida`.** Decisión humana fechada del
      2026-08-03, en `progress/decision_175.md` ⟨D11⟩, con su motivo objetivo: tiene columna real en
      `analytics_daily` y es el 4.º término de `DENOMINADOR_GESTIONES`.
- [x] **T0.2 (BLOQUEANTE, Q2) RATIFICADA: `sin_gestionar` → `producida` también.** Es el mismo
      defecto: la 126 la sirve derivándola del embudo. Consecuencia **aceptada y medida antes de
      decidir**: el catálogo se queda sin ninguna `declarada` y `metrics.test.ts:273` se pone rojo.
      **No se relaja ese guard** — se reexpresa sobre catálogo sintético (R4), porque lo que protege
      es que el filtro PARTICIONE, no que existan métricas sin productor.
- [x] **T0.3 [P] (Q3) SÍ**: se añaden los dos campos **opcionales** a `DefinicionMetrica`. Es aditivo
      y de dominio cerrado. El plan B de `design.md §7 · Alternativa 1` queda descartado.
- [x] **T0.4 [P] (Q4) Lo actualiza la 175 en su propio PR**, y **reexpresándolo**: el caso debe
      seguir matando la mutación del `filter(estadoProduccion === "producida")` **sin afirmar el
      valor concreto** del campo (espíritu de R21 de la 131). **Verificado por el leader: el código
      de la 131 YA ESTÁ EN `dev`** —el registro dice `in_progress` por bookkeeping pendiente, no por
      trabajo en vuelo—, así que el guard vive en la troncal y esta feature lo encuentra ahí.
      **Avisar igualmente a la sesión de la 131 antes de mergear.**
- [x] **T0.5 [P] (Q5, Q6, Q7) Aceptadas las tres**: nombres y dominios de los campos nuevos; la
      divergencia 4 (el literal «19 values» cuando el seed tiene 20 desde la 157) entra AQUÍ por
      vivir dentro del mismo string que ya se reescribe; y se corrige el título de
      `definiciones-catalogo.guardia.test.ts:60-62`, que dice «diecinueve» mientras afirma 20.

## T1 — Base de tipos (R5, R9, R11)

- [x] **T1.1** Añadir a `DefinicionMetrica` (`lib/analytics/types.ts:147-166`) los campos opcionales
      `universo?: "b2_vivas_mas_cierres_del_dia"` y `derivadaDe?: TMetricaId`, cada uno con su
      comentario de una línea que diga **por qué** existe (universo B2 de la 124 / sin medida propia
      en `analytics_daily`). Depende de T0.3.
      *Hecho cuando:* `pnpm typecheck` verde y `tests/unit/analytics/types.test.ts` y
      `metrics.test.ts:61-65` (12 claves) siguen verdes sin tocarlos.

## T2 — Divergencia 1: `incidentes` (R1, R2, R3, R14) — depende de T0.1/T0.2

- [x] **T2.1** `lib/analytics/metrics.ts:218-220`: `estadoProduccion: "producida"` y reescritura del
      comentario falso, citando la columna real (`db/schema.prisma:1891`) y la decisión fechada de
      `progress/decision_175.md` (patrón `metrics.ts:462-465`).
      *Hecho cuando:* `getMetrica("incidentes").estadoProduccion === "producida"` y el comentario ya
      no afirma que el rollup no la compromete.
- [x] **T2.2** (solo si T0.2 = sí) Ídem para `sin_gestionar` (`metrics.ts:240-242`).
      *Hecho cuando:* ambas métricas declaran productor y el comentario cita la derivación de la 126.
- [x] **T2.3** Guardia nueva `tests/unit/analytics/catalogo-produccion.guardia.test.ts` con los casos
      de **R1**, **R2** (derivado de `definicion.razon`, **sin nombrar `incidentes`**), **R3**,
      **R13** (censo de árbol: nadie fuera de `lib/analytics/metrics.ts` decide datos por
      `estadoProduccion`, `universo` ni `derivadaDe`) y **R14** (existe y se cita la decisión
      fechada).
      *Hecho cuando:* los cinco casos pasan y **cada uno** muere con su mutación documentada en el
      propio archivo.

## T3 — Divergencia 2 + hallazgo 4: `ordenes_por_estado` (R5, R6, R7, R8) `[P]` con T2

- [x] **T3.1** `metrics.ts:115-128`: añadir `universo: "b2_vivas_mas_cierres_del_dia"` a `definicion`
      y **no tocar** `estados` (D4).
      *Hecho cuando:* `definiciones-catalogo.guardia.test.ts:87-91` sigue verde.
- [x] **T3.2** Reescribir la `descripcion` (`metrics.ts:118`): universo B2 con las palabras de la 124
      («vivas al corte + las que llegaron a terminal ese día»), remisión a las medidas de flujo para
      el histórico de terminales, **sin** el literal «19», y **conservando** la cita de gestiones
      anuladas que exige `metrics.test.ts:344-350`.
      *Hecho cuando:* `metrics.test.ts` entero verde y el string no contiene ningún conteo de
      estados.
- [x] **T3.3** Corregir el título y la cabecera desfasados de
      `tests/unit/analytics/definiciones-catalogo.guardia.test.ts:16-21,60-62` («diecinueve» → 20,
      feature 157).
      *Hecho cuando:* el título describe lo que el caso afirma.

## T4 — Divergencia 3: `sin_gestionar` (R9, R10, R11, R12) — depende de T1

- [x] **T4.1** `metrics.ts:232-247`: añadir `universo: "b2_vivas_mas_cierres_del_dia"` y
      `derivadaDe: "ordenes_por_estado"`; **conservar** `clase: "snapshot"` y `fuente: rollup` (D5).
      *Hecho cuando:* compila (el estrechamiento a `MetricaId` valida el id citado) y
      `operativa-fuente.guardia.test.ts:50-53` sigue verde.
- [x] **T4.2** Reescribir su `descripcion`: «sin gestionar **HOY**», proyección de
      `ordenes_estado_stock` sobre el estatus `sin_gestionar`, **sin columna propia**, no acumulada;
      conservando la cita de gestiones anuladas.
      *Hecho cuando:* dice lo mismo que `NOTA_SIN_GESTIONAR` (`lib/types/analitica-operativa.ts:64-75`)
      **sin importarlo** (D5 / Alternativa 5).
- [x] **T4.3** Guardia nueva `tests/unit/analytics/catalogo-universo.guardia.test.ts` con los casos de
      **R5**, **R6**, **R7** (ninguna descripción cuenta estados a mano), **R9**, **R10**, **R11**
      (lee `db/schema.prisma` y afirma que `AnalyticsDaily` **no** tiene columna `sin_gestionar`) y
      **R12**.
      *Hecho cuando:* los siete casos pasan y el de R11 se pone rojo si se simula la aparición de la
      columna.

## T5 — Guards rojos por diseño (R4) — depende de T2 y T4

- [x] **T5.1** `tests/unit/analytics/tablero-catalogo-paneles.test.ts:31-60`: reexpresar el caso para
      que siga matando la mutación `filter(estadoProduccion === "producida")` **sin afirmar el valor
      del campo**; actualizar el comentario que cita «declarada».
      *Hecho cuando:* el caso sigue rojo al introducir el filtro y verde con el catálogo corregido.
- [x] **T5.2** `app/(app)/analitica/_components/operativo/catalogo-paneles.ts:3-15`: actualizar el
      comentario, que cita `metrics.ts:220` / `:242` como «declarada». **Solo comentario**: el archivo
      no debe empezar a leer el campo (`tablero-catalogo-paneles.test.ts:62-73` lo prohíbe).
      *Hecho cuando:* el guard de censo sigue verde y el texto ya no afirma algo falso.
- [x] **T5.3** (solo si T0.2 = sí) `tests/unit/analytics/metrics.test.ts:266-289`: sustituir
      `listarMetricas({estadoProduccion:"declarada"}).length > 0` por la verificación de **partición**
      + un caso sobre catálogo sintético (R4).
      *Hecho cuando:* el filtro sigue teniendo un test que muere si deja de filtrar, aunque el
      catálogo no tenga ninguna métrica `declarada`.

## T6 — Cierre

- [ ] **T6.1** `progress/impl_175.md` con archivos tocados, mapa `R1..R14 → test` y salida real de
      los tests.
      *Hecho cuando:* los **14** requisitos tienen test nombrado (trazabilidad bloqueante,
      `docs/verification.md`).
- [x] **T6.2** Marcar como **cerrados** los avisos heredados: `specs/124-…/design.md:515-518` y
      `specs/126-…/design.md:463-481`, y la nota de frontera de
      `lib/types/analitica-operativa.ts:71-73`.
      *Hecho cuando:* los tres puntos dicen que la 175 los resolvió (o la nota queda referida a este
      spec).
- [x] **T6.3** Verificación de «ninguna cifra cambió»: correr los tests de la 126
      (`tests/unit/analytics/operativa-*.test.ts` y `analitica-operativa-service.test.ts`) **sin
      tocarlos** y comprobar que pasan sin modificación.
      *Hecho cuando:* cero ediciones en tests de la 126 y todos verdes.
- [ ] **T6.4** Gate del leader: `./init.sh` completo antes del PR, y aviso a la sesión de la **131**
      (T0.4) antes de mergear.
      *Hecho cuando:* verde y aviso enviado.
