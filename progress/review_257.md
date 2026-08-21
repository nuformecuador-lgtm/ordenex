# Review — Feature 257 (API key: filtros del listado)

Revisor: agente REVIEWER. Fecha: 2026-08-21.
Rama: `feature/257-api-key-filtros-listado` (worktree `C:/w257`), 5 commits sobre `origin/dev`.
Material leido: `specs/257-api-key-filtros-listado/{requirements,design,tasks}.md`,
`progress/impl_257.md`, `CHECKPOINTS.md`, `docs/architecture.md`, `docs/conventions.md`,
`docs/verification.md`, y el diff completo `origin/dev..HEAD` (16 archivos, +2139/-10).

## Veredicto

**APROBADO.** Sin hallazgos bloqueantes. Cinco hallazgos menores, ninguno exige volver al
implementer antes del merge.

## Checklist

### Especificacion
- [x] `requirements.md` con 26 requisitos EARS numerados, alcance y fuera-de-alcance explicitos.
- [x] `design.md` con alternativas descartadas y su porque (secciones 8.1 a 8.7, siete alternativas).
- [~] `tasks.md`: T0-T10, T12 y T13 en `[x]`. T11 `[~]` descartada por decision humana firmada
      (indice compuesto fuera; sin migracion, gate `--rapido`). T14 `[ ]` es del leader (gate + PR).
      No es incumplimiento del implementer.

### Trazabilidad R1-R26 -> test (abierta y verificada test por test, no solo la tabla)
- [x] Los 26 requisitos tienen test real, con assert que corresponde al requisito. Comprobado
      abriendo los cinco archivos nuevos; ninguno es un test vacio.
- Detalle de la verificacion:
  - R1: el test de ruta afirma campo por campo que `desde/hasta/numGuia/numRemision` llegan
    `undefined` (no se apoya en `toHaveBeenCalledWith`, que ignora `undefined`), y el repo-test
    afirma `where` `toEqual({tiendaId, deletedAt:null})` exacto.
  - R2: query con `tiendaId/owner/ownerId` -> 200, params sin esas claves, `JSON.stringify` sin el
    valor colado. Respaldado en el codigo por la lectura clave por clave.
  - R3: dos casos, sin Bearer -> 401 y key inactiva -> 403, ambos con query invalida y
    `service.listar` NO llamado. La auth gana a la validacion, verificado tambien en el codigo.
  - R4: cadenas literales `YYYY-MM-DD` al service, mas independencia de cada campo.
  - R5/R6/R7/R8/R9: test de service con reloj fijo y los instantes escritos A MANO:
    `2026-08-01T06:00:00.000Z` (gte) y `2026-08-22T06:00:00.000Z` (lt). No recalcula la formula
    del codigo bajo prueba, que es lo que haria pasar tambien la formula equivocada. R8 mide
    ademas el delta exacto de 24 h.
  - R10: `it.each` con 8 casos (`22/07/2026`, ISO completa, `hoy`, vacio, por desde y por hasta)
    -> 422 `VALIDATION_ERROR` + `fieldErrors[campo]` + service no llamado.
  - R11: `it.each` con 4 casos (`2026-02-31`, `2026-13-01`) -> 422. Valida por round-trip
    (`esFechaCalendarioValida`), no por regex, asi que no rueda a marzo.
  - R12: `desde > hasta` -> 422 con `fieldErrors.hasta` y SIN `fieldErrors.desde`, mas el caso
    `desde == hasta` valido.
  - R13/R14: numerico tipado, mas `it.each` con 5 invalidos y `fieldErrors.num_guia` en
    snake_case (afirma ademas que NO sale `numGuia`).
  - R15: `where.numGuia` escalar plano, sin `not`, sin `in`.
  - R16/R17: exactitud sin casefolding ni truncado, trim de bordes documentado, vacio y solo
    espacios -> 422.
  - R18: claves hermanas del mismo `where` (`toEqual` con los seis campos), es decir AND real.
  - R19: combinacion sin resultados -> 200 con `items:[]` y `total:0` (`not.toBe(404)`,
    `not.toBe(422)`), y los cinco filtros en una sola invocacion.
  - R20: doble cobertura. El repo-test cuela un `tiendaId` ajeno por los parametros con cast y
    exige el `where` intacto; el service-test cuela `tiendaId`/`ownerId` ajenos y exige
    `ownerId === actor.usuarioId`.
  - R21/R22: archivo de seguridad propio, con la comparacion de los dos bodies completos.
  - R23: `deletedAt: null` presente con los cuatro filtros activos.
  - R24: `orderBy {createdAt:"desc"}`, `skip`/`take` los recibidos, `where` filtrado en la MISMA
    consulta.
  - R25: `expect(whereCount).toBe(whereDe(d))`, identidad de referencia y no igualdad
    estructural. Es la garantia mas fuerte disponible.
  - R26: guardia de documentacion sobre AMBOS artefactos (objeto TS y YAML espejo), incluida la
    igualdad literal de la `description` del endpoint (`toBe`, no `toContain`).

### Verificacion ejecutable
- [x] Corri yo mismo los cinco archivos nuevos: 5 files / 61 tests / 61 passed (2,91 s).
- [x] Baseline de la superficie (medido por el leader antes de implementar): 20 archivos /
      197 tests / 0 rojos. Delta reportado y coherente: 25 / 258 / 0 rojos.
- [n/a] `./init.sh --rapido` lo corre el leader (T14). No lo dupliqué, por instruccion explicita.
- [x] Sin migraciones, sin `db/schema.prisma`, sin `lib/types/`, sin configuracion de build, o sea
      que el modo rapido no se niega. Coherente con `docs/verification.md`.

### Las tres invariantes duras del design, verificadas en el arbol y no en la bitacora
- [x] (a) Ventana `gte`/`lt` con bordes en `T06:00:00.000Z`. `ApiOrdenLecturaService` usa
      `inicioDelDiaCREnUtc` / `inicioDelDiaSiguienteCREnUtc`. Un grep de `startOfDayCR` sobre el
      service devuelve cero lineas. En el repositorio, la unica aparicion de `lte` es el comentario
      que lo prohibe; el codigo emite `lt`.
- [x] (b) `tiendaId` y `deletedAt` primero e incondicionales. Leido en
      `OrdenRepository.listByOwner`: ambos se escriben antes de todos los spreads condicionales, y
      los filtros entran como escalares tipados (`Date`, `number`, `string`). Ni la firma de
      `IOrdenRepository` ni la implementacion aceptan un fragmento de `WhereInput`.
- [x] (c) Ningun `findUnique` mas comprobar dueno despues. El unico `findUnique` por `numGuia` del
      repositorio es `findByNumGuiaForTransicion` (feature 33, QR), preexistente y ajeno a este
      camino. El filtro de 257 se resuelve en un solo `where` con `tiendaId` junto al numero.

### T9, el test de seguridad
- [x] Compara los dos bodies completos en UN SOLO assert, no en dos asserts separados:
      `expect(bodyAjeno).toEqual(bodyInexistente)` en R21 y en R22, mas
      `expect(resAjeno.status).toBe(resInexistente.status)`. Cumple lo que pedia `tasks.md`.
- [x] Vive en archivo propio, como manda T9, y su encabezado documenta el anti-patron prohibido.

### Documentacion publica (R26)
- [x] Los cuatro parametros en `lib/api/openapi-spec.ts` con `in: query`, `required: false`,
      descripcion y `example` (`2026-08-01`, `2026-08-21`, `100234`, `REM-0001`).
- [x] `docs/api/api-key-openapi.yaml` consistente: mismo tipo y formato, mismo ejemplo, misma
      descripcion palabra por palabra, dentro del bloque `parameters` correcto del `get` correcto
      (el test navega el YAML por sangria, no con un `includes` suelto).
- [x] La `description` del endpoint avisa en ambos artefactos de "pagina vacia, nunca 404".

### Checkpoints de CHECKPOINTS.md
- [x] Typecheck verde; lint con 0 errores (2 warnings, ver hallazgo 4).
- [n/a] RLS y migraciones: ninguna tabla ni columna nueva. La seccion 6 del design lo declara.
- [n/a] Webhooks: no se toca el webhook (256), fuera de alcance explicito.
- [x] Sin secretos hardcodeados. El unico literal con pinta de credencial en el diff es una key
      falsa de test que nunca sale del archivo.
- [x] Sin hardcode de contexto. El offset de Costa Rica no se reinventa aqui: se consume de
      `lib/utils/fecha-cr`, helpers preexistentes que esta feature no toca.
- [x] Capas separadas. `route.ts` solo hace HTTP, zod y el mapeo snake_case a camelCase; el service
      tiene la unica decision de negocio (dia natural de CR a instantes UTC) y no conoce
      `Request`/`Response`; el repositorio solo arma el `where` de Prisma. Interfaces en
      `lib/interfaces/{services,repositories}/`.
- [x] E2E Playwright: no aplica. Es lectura filtrada sobre un canal existente; no toca auth,
      pagos, recaudo ni ingesta de ordenes.

## Hallazgos

1. **menor. El criterio de "hecho" de T4 y T5 es satisfacible sin tocar codigo, y asi se
   satisfizo.** Estaban escritos como greps. En el arbol final los tres devuelven cero lineas,
   pero llegaron ahi porque `backend_dev` REFORMULO DOS COMENTARIOS que citaban el identificador
   prohibido, no porque cambiara una linea de codigo. Verificado en el diff: el comentario del
   service dice ahora "el helper de medianoche UTC de la convencion `@db.Date` (feature 46)" en
   vez de nombrar `startOfDayCR`, y el de la ruta dice "volcar la query entera de golpe" en vez de
   nombrar `Object.fromEntries`. La conclusion del implementer es EXACTA.
   Ahora bien, la invariante no depende de esos greps: la sostienen los asserts de T6 (los
   instantes `T06:00:00.000Z` escritos a mano, no recalculados con los helpers del codigo bajo
   prueba) y los de T7 (`not.toHaveProperty("lte")`, `not.toHaveProperty("gt")` y
   `toEqual({gte, lt})`). Esos asserts SI son suficientes: fallan ante cualquier cambio real de la
   ventana y no se pueden satisfacer reescribiendo prosa. Por eso esto es menor y no bloqueante.
   Accion recomendada, de proceso y en ficha aparte: que `docs/specs.md` prohiba el grep sobre un
   identificador como criterio de "hecho" cuando ese identificador puede vivir en un comentario;
   el criterio debe ser un assert. Nota positiva: el implementer levanto el problema el mismo y lo
   commiteo (`76dc60b7`), que es exactamente lo que se espera de una bitacora.

2. **menor. El `lte` del comentario del repositorio se dejo a proposito.** Es la decision correcta
   (ahi el aviso al futuro lector vale mas que un grep limpio, y el `lte` prohibido esta congelado
   por assert). Se anota para que nadie lo "limpie" mas adelante creyendo que es un descuido.

3. **menor. T9 es tautologico en su propia capa, aunque cumple lo que se le pidio.** El
   `lecturaService` falso devuelve la misma pagina vacia en los dos escenarios, asi que la
   comparacion de bodies demuestra que EL BORDE no distingue ajeno de inexistente, no que LA
   CONSULTA no lo distinga. Eso ultimo lo demuestra T7 (el `where` lleva `tiendaId` junto a
   `numGuia` en la misma consulta) mas la ausencia, verificada en el arbol, de cualquier
   `findUnique` en este camino. La cobertura combinada es correcta y el archivo lo documenta con
   honestidad en su encabezado.
   Hueco residual, escrito para que conste: ningun test romperia si alguien anadiera en el futuro
   un `findUnique(num_guia)` EXTRA en el service antes de `listByOwner` (el body seguiria siendo
   igual y `listByOwner` se seguiria llamando). El anti-patron queda cerrado por diseno
   (seccion 4.1) y por revision, no por test. No es bloqueante: la superficie es pequena y el
   design lo prohibe por escrito, citado ademas en el encabezado del test.

4. **menor. Los 2 warnings de lint de `_args` no merecen correccion en esta ficha.** Son
   identicos, en las mismas dos lineas y con la misma regla, a los que ya produce
   `cierres-filtros-where.test.ts`, que es justo el archivo que T7 manda imitar. Silenciarlos solo
   en el archivo nuevo introduciria una divergencia de estilo entre dos hermanos. Si molestan, se
   arreglan los dos a la vez y en su propia ficha. Decision: se acepta como esta.

5. **menor. Bookkeeping abierto, y es del leader.** `tasks.md` deja T14 en `[ ]` (gate y PR), el
   worktree tiene `feature_list.json` modificado sin commitear, y falta la entrada en
   `progress/history.md` que pide `CHECKPOINTS.md`. Nada de esto vuelve al implementer.

## Conclusion

La feature hace lo que el spec dice, con la separacion de capas correcta y con las tres invariantes
duras sostenidas por asserts y no por convenciones. La invariante de seguridad (owner forzado e
indistinguibilidad de guia o remision ajena) esta cubierta por dos capas de test independientes. La
documentacion publica esta duplicada a proposito, y hay una guardia que impide que los dos
artefactos diverjan.

**Veredicto: APROBADO.** Pendiente para el leader: `./init.sh --rapido` en verde, marcar T14, PR
contra `dev` y entrada en `progress/history.md`.
