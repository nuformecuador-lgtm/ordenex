# Review - Feature 59: Zonas - seleccionar distritos de VARIOS cantones

- Rama: feature/59-zonas-distritos-multicanton (working tree sin commit)
- Tipo: FRONTEND PURO (mejora UX del ZonaForm)
- Fecha: 2026-07-13
- Reviewer: subagente reviewer (no edita codigo)

## Resumen ejecutivo

El CODIGO, los TESTS y la SPEC estan APROBADOS: 0 bloqueantes de comportamiento,
trazabilidad R1-R12 a test real completa, frontend puro confirmado, sin regresiones.

Pero la feature NO cumple 3 puertas de CHECKPOINTS.md (artefactos de proceso, NO codigo):
falta progress/impl_59-*.md con el mapa R-test, tasks.md tiene TODAS las tasks sin marcar [x],
y no hay entrada en progress/history.md. Por la regla "OK solo si no hay bloqueantes", el
veredicto es RECHAZADO, pero los 3 blockers se cierran sin tocar codigo.

## Checklist CHECKPOINTS.md

Especificacion
- [x] requirements.md con R1..R12 en EARS.
- [x] design.md con alternativas descartadas (5 documentadas).
- [ ] FALLA: tasks.md con todas las tasks [x] -> T0..T11 siguen en [ ].

Trazabilidad
- [x] Cada R1..R12 mapea a >=1 test concreto en tests/unit/components/zona-form.test.tsx.
- [ ] FALLA: progress/impl_59-zonas-distritos-multicanton.md con el mapa R-test NO existe.

Calidad de codigo
- [x] npx tsc --noEmit: 0 errores (fuera de .next/).
- [x] npx eslint sobre ZonaForm.tsx + test: 0 errores/warnings.
- [x] npx vitest run tests/unit/components/zona-form.test.tsx: 22/22 verde.
- [x] Suite completa: 2551 passed, 2 failed = flakes (HomePage, LoginForm) confirmados:
      pasan aislados (27/27). Ninguno relacionado con feature 59.

Datos y seguridad
- [x] N/A backend: sin tablas/migraciones/webhooks/secretos nuevos (frontend puro).

Patron de capas
- [x] arbolZonas() se consume como LECTURA via Server Action; el componente no hace queries.

Permisos / Multi-pais
- [x] Sin hardcode de pais/moneda; arbolZonas mantiene su gate maestro en la accion (intacta).

Verificacion final
- [x] Suite ejecutada por el reviewer (la bitacora del implementer no existe).
- [x] progress/review_59.md creado (este archivo).
- [ ] FALLA: no hay entrada para la feature 59 en progress/history.md.

## Verificacion por requisito (R1-R12 a test)

- R1 acumulacion A-B-A: test L559 -> total no baja, checkbox A sigue marcado. OK.
- R2 agregar de 2 cantones: test L583 -> distritoIds = [d1,d5]. OK.
- R3 resumen lista todos: test L635 -> ambos cantones con uno abierto. OK.
- R4 agrupado provincia-canton: test L648-654 -> header San Jose, grupos Central/Escazu. OK.
- R5 quitar desde resumen: test L657 -> desaparece y total 2 a 1. OK.
- R6 sync bidireccional: test L680 -> fuente unica selected. OK.
- R7 contador = set completo: R1 (L571/578), R5 (L673), R9 (L762). OK.
- R8 otra zona disabled y fuera del resumen: test L706 -> Merced disabled y ausente. OK.
- R9 edicion multi-canton desde el inicio: test L721 -> mock arbolZonas 2 cantones. OK.
- R10 envio set completo: test L583 -> payload intacto, ids de ambos cantones. OK.
- R11 a11y/responsive: test L768 -> aria-label Quitar X + className /overflow/. OK.
- R12 no regresion: suite feature-55 (L100-510) 22/22 verde, contratos intactos. OK.

Trazabilidad completa: no hay R sin test; cada test asevera lo que dice cubrir.

## Verificacion de puntos clave del encargo

1. Frontend puro CONFIRMADO. git status: solo ZonaForm.tsx, zona-form.test.tsx,
   feature_list.json, progress/current.md y specs/59/. NO se toco lib/actions/zonas.ts,
   lib/types/zona.ts, services/repos, db/ ni migraciones. arbolZonas() solo lectura.
2. Contrato intacto: buildCandidate() envia distritoIds = Object.keys(selected) (set completo);
   firmas de crearZona/actualizarZona sin cambios; crearZonaSchema reusado.
3. Fuente de verdad unica: selected: Record<string, DistritoSeleccionado>; checkbox
   checked = d.id in selected; resumen derivado por useMemo; toggleDistrito/removeDistrito
   mutan el mismo mapa. Sin doble estado ni efectos de espejo (R6 OK).
4. R10 heredada: enOtraZona deshabilita; seedSeleccionEdicion/seedDesdeArbol solo siembran
   distritos de ESTA zona; los de otra zona nunca entran a selected ni al resumen.
5. Pre-marcado edicion multi-canton: seedDesdeArbol localiza el nodo por zona.id y siembra
   TODOS los cantones/distritos (provincia null, enriquecida al navegar). Tipo ArbolZonas
   consumido correctamente (lib/types/zona.ts L151-165). Cubierto por test L721.
6. No regresion: data-testid distritos-seleccionados, aria-labels, ZonaFormHandle.submit(),
   ZonaFormProps conservados. Tests preexistentes (tarifas, central, errores) verdes.
7. a11y/responsive: role=group + aria-label por provincia/canton; boton aria-label Quitar X;
   contenedor overflow-x-hidden + break-words + min-w-0 + shrink-0, dentro del max-w-lg del Modal.

## Hallazgos

BLOQUEANTES (proceso/CHECKPOINTS, NO requieren cambio de codigo)
- B1. Falta progress/impl_59-zonas-distritos-multicanton.md con el mapa R-test y evidencia
  de la corrida (CHECKPOINTS Trazabilidad; task T10). El mapa R-test SI existe de facto en el
  test file (ver arriba), pero no esta consolidado en el artefacto exigido.
- B2. tasks.md: T0..T11 siguen en [ ]. CHECKPOINTS Especificacion exige todas en [x]. (Todas
  estan de hecho implementadas y verificadas.)
- B3. No hay entrada para la feature 59 en progress/history.md (CHECKPOINTS Verificacion final).

Los tres son cierre documental del implementer/leader. El codigo NO vuelve al implementer.

Menores / deuda
- m1. El docstring del ZonaForm y comentarios de buildCandidate citan numeracion de la feature
  55 (R3/R4/R7/R8/R10/R11, R6-UI), y el test file mezcla esa numeracion (bloques preexistentes)
  con la de feature 59 (R1-R12). No es defecto pero puede confundir la lectura de trazabilidad.
- m2. Deuda escalar<->N:M de zonas SEMBRADAS (documentada en el header): una zona creada por
  script podria no pre-marcar sus distritos. Fuera de alcance de 59; solo se respeta. OK.
- m3. seedDesdeArbol (provincia null) + seedSeleccionEdicion (enriquece provincia) es
  intencional (F1.4-e); no hay test que ejerza el enriquecimiento perezoso de provincia al
  navegar en edicion. No es requisito explicito; opcional.

## Veredicto

RECHAZADO, solo por 3 puertas de CHECKPOINTS.md sin cumplir (B1, B2, B3), todas
documentales/de proceso. La implementacion (codigo + tests + spec) esta APROBADA con 0
bloqueantes de comportamiento: trazabilidad R1-R12 completa, frontend puro, contrato intacto,
sin regresiones (typecheck 0, lint 0, zona-form 22/22, suite 2551 verdes; los 2 fallos de la
corrida completa son flakes ambientales confirmados aislados).

Para pasar a OK: (1) crear progress/impl_59-zonas-distritos-multicanton.md con el mapa R-test
y la evidencia; (2) marcar T0..T11 [x] en tasks.md; (3) anadir la entrada de la feature 59 en
progress/history.md. Ningun cambio de codigo es necesario.
