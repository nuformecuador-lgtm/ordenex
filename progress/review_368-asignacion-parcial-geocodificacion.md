# Review — Feature 368: asignacion parcial por motivo de coordenadas

> Reviewer. Verificado contra specs/368-asignacion-parcial-geocodificacion/{requirements,design,tasks}.md,

> progress/impl_368-asignacion-parcial-geocodificacion.md, CHECKPOINTS.md, docs/architecture.md,

> docs/conventions.md. Commits revisados: b24ed843..0114676e (rama fix/368-asignacion-parcial-geocodificacion).

## Checklist

### Especificacion
- [x] requirements.md con R1-R19 en formato EARS.
- [x] design.md con alternativas descartadas y su porque (A1 S2.1 reusar conflict; A2 S7 generalizar a otros motivos).
- [x] tasks.md existe. No usa checkboxes [x] literales -- usa el formato "Hecho cuando: <aserto>" que ya es la
      convencion establecida en este repo para specs cerrados (verificado contra specs/362-*/tasks.md, feature
      ya en done). No lo trato como bloqueante: es consistente con el resto del repo y cada task tiene un
      criterio ejecutable, verificado abajo.

### Trazabilidad (R1-R19)
- [x] Los 19 requisitos tienen un test nombrado en progress/impl_368...md. Verifique cada uno abriendo el
      archivo citado, no solo el nombre:
  - R1/R3/R4 (guia-asignacion-gate-coordenadas.test.ts): it.each(NO_ASIGNABLES) "motivo %s -> partial...",
    "368/R3: las DOS ordenes bloqueadas...", "368/R1: lote de 3 con la bloqueada al medio...",
    "todas asignables -> persiste con normalidad". Los cuatro corridos y verdes; afirman status, resultados,
    bloqueadas y la llamada exacta a asignarBodegaLote con el subconjunto.
  - R5 (geocodificacion-motivo-por-orden-mismo-modulo.guardia.test.ts + espejo T5/T6 en ambos modales): el
    guardia lee el codigo fuente real de los dos modales (no un mock) y confirma import del mismo modulo, con
    contrapruebas en las dos direcciones. Genuino, no vacio.
  - R6/R7/R8/R9: no-regresion verificada -- git diff confirma que generarGuia, rutearABodegaSatelite,
    asignarRecoleccion, desasignarRecoleccion no fueron tocados (los unicos hunks de ambos servicios caen en
    gateCoordenadas/asignarDesdeBodega y en el bloque 4b/paso 7 de AsignacionSateliteService.asignar), y los
    tests de tope de intentos (guia-asignacion-tope-intentos.test.ts, asignacion-satelite-tope-intentos.test.ts)
    no cambiaron de archivo.
  - R10-R14: AsignarBodegaModal.test.tsx (T5.1-T5.5) y AsignarSateliteModal.test.tsx (T6.1-T6.5) -- confirme
    que el DOM usa numRemision del ordenes prop del test (nunca un campo inventado en la respuesta mockeada,
    que solo trae ordenId/motivo), que errorMock no se llama en partial, y que un conflict sigue yendo al
    canal de error sin tocar la fase "resultado".
  - R15/R16: ordenes-guia-action.test.ts / asignacion-satelite-action.test.ts -- passthrough real
    (expect(r).toEqual(partial)), y compilacion (AsignarBodegaServiceResult/AsignarSateliteServiceResult/sus
    dos espejos de accion con "partial").
  - R17: "368/R17: carrera compuesta..." en asignacion-satelite-gate-coordenadas.test.ts -- simula una carrera
    real sobre las asignables tras filtrar por coordenadas, y afirma conflict con AMBOS motivos combinados
    (coordenadas + carrera), nunca partial. Es el caso mas delicado del diseno y esta genuinamente cubierto,
    no solo nombrado.
  - R18/R19: comentarios reescritos, verificados en el diff -- el docstring de gateCoordenadas y el bloque de
    asignarDesdeBodega en GuiaAsignacionService.ts, y el bloque 4b/paso 7 en AsignacionSateliteService.ts, ya
    no dicen "todo-o-nada" para coordenadas; nombran la ficha 368 y su fecha. El unico "TODO-O-NADA" que
    sobrevive en ambos archivos es el del tope de intentos (feature 276), que R8/R18 exigen mantener intacto
    -- correcto, no es un olvido.
- [x] Ningun mapeo es falso: abri los ocho archivos de test citados (no solo grep de nombres) y cada aserto
      prueba lo que el requisito exige, con valores concretos, no un expect(true).toBe(true).

### Alcance
- [x] git diff ad6936c9..HEAD --stat no toca OrdenesListado.tsx, ordenes-columns.tsx,
      SateliteOrdenesListado.tsx, ZonaRepository ni nada de zonas-distritos. Confirmado con
      git diff --name-only filtrado -- cero coincidencias.
- [x] feature_list.json: el diff toca solo la entrada de la ficha 368 (status, status_note, spec_path).
- [x] DetalleConflicto (lib/types/orden-guia.ts:68-71) sigue siendo { ordenId: string; motivo: string } -- no
      gano ningun campo (confirmado leyendo el archivo, no solo el diff).

### Comportamiento real (no solo compila)
- [x] GuiaAsignacionService.asignarDesdeBodega: filtra asignables de ordenIds usando bloqueadasIds (Set de
      detalleCoords), asignables.length === 0 -> conflict (R3), escribe solo asignables con asignarBodegaLote,
      devuelve partial/ok segun detalleCoords.length -- exactamente design.md S3.1.
- [x] AsignacionSateliteService.asignar: mismo patron en bloque 4b, y el chequeo de carrera del paso 7 compara
      count !== asignables.length (no ordenIds.length), combinando detalleCarrera + detalleCoords cuando
      dispara -- exactamente design.md S3.2/S5.

### UI
- [x] Los dos modales: if (result.status !== "ok" && result.status !== "partial") throw result -- partial
      nunca llega al canal de error del Modal.
- [x] numRemision sale de new Map(ordenes.map((o) => [o.id, o.numRemision])), sobre el snapshot ordenes prop
      -- nunca de un campo del backend.
- [x] ManifiestoResultado sigue recibiendo seleccion={{ ordenIds: resultado.ordenIds }}, y resultado.ordenIds
      sale de result.resultados (el subconjunto asignado) en ambos casos ok/partial -- no cambio su invocacion.

### Verificacion ejecutable (corrida por mi, no solo leida)
- [x] pnpm run db:generate (con DATABASE_URL dummy) -- verde.
- [x] pnpm exec vitest run sobre los 8 archivos de test de esta ficha (backend + frontend + guardia +
      integracion) -> 133 tests verdes, 8 archivos.
- [x] pnpm exec vitest related --run sobre los 9 archivos fuente tocados (2 servicios, 2 interfaces, 2 tipos
      de accion, 2 modales, el modulo de mensajes) -> 790 tests verdes, 52 archivos.
- [x] pnpm run typecheck -- limpio, sin errores.
- [x] pnpm run lint -- 0 errores, 149 warnings preexistentes (mismos que reporto el implementer, ninguno en
      archivos de esta ficha).
- [x] Sin migraciones, sin cambios a db/schema.prisma -- los checkpoints de RLS/migraciones/webhooks no
      aplican a esta ficha (no hay tabla nueva ni webhook).
- [x] ./init.sh completo ya lo corrio el leader 4 veces (documentado en progress/current.md); los rojos
      observados son ruido de saturacion de maquina en archivos ajenos a esta ficha (TableroDiaFiltro,
      tarifa-status-retirado, CrearTiendaForm, PostularRecursoModal, cache-tags.guardia) mas una deuda
      preexistente (superficie-de-uso.guardia.test.ts sobre lib/actions/tarifas.ts), ninguno relacionado con
      el diff de 368. No repeti la corrida completa de 24k tests (instruccion explicita); en su lugar corri
      dirigido (arriba) y confirme cero regresion en el arbol de dependencias real de los 9 archivos tocados.

## Hallazgos

Ninguno MAYOR/BLOQUEANTE.

Menor 1 -- tasks.md no usa checkboxes [x] literales como pide CHECKPOINTS.md al pie de la letra; usa el
formato narrativo "Hecho cuando: <aserto ejecutable>" ya establecido en el repo (mismo patron que la feature
362, cerrada). No bloquea porque el criterio de "hecho" es mas estricto que un checkbox (exige un test
rojo-si-esta-mal), y esta cumplido en las 10 tasks.

Menor 2 -- El texto de los mensajes nuevos (Q1) se registra como "aprobado por el humano el 2026-09-03" en
progress/impl_368...md, pero no hay una referencia verificable en el repo (ej. un commit o comentario) que
documente esa aprobacion fuera del propio impl doc. No es motivo de rechazo -- R11/R12 (el contenido
obligatorio) estan cubiertos por evidencia independiente del literal exacto, tal como preveia
requirements.md Q1 -- pero lo anoto para que quede trazado.

## Veredicto

OK -- sin hallazgos bloqueantes. Trazabilidad R1-R19 completa y verificada test por test (no solo por
nombre), alcance respetado (cero toques a las zonas prohibidas de las fichas 366/367), DetalleConflicto
intacto, logica de los dos servicios identica a design.md S3.1/S3.2/S5, UI conforme a S6.2, comentarios
"todo-o-nada" de coordenadas reescritos (R18/R19) sin tocar el de tope de intentos (R8). Typecheck y lint
limpios sobre HEAD; 133 tests dirigidos + 790 tests de vitest related verdes sobre el arbol de dependencias
real de esta ficha.

Listo para sincronizar con dev y abrir el PR.
