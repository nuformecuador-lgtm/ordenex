# Review — Feature 178 (purga diaria de los PDF de cargas antiguas)

Rama revisada: `feature/178-purga-pdf-cargas`. Diff: `git diff origin/dev...HEAD`
(23 archivos: 14 creados + `vercel.json`, `.env.example` y bookkeeping).
Revisor: solo lectura. No se edito codigo, ni `feature_list.json`, ni `progress/current.md`,
ni se ejecuto ningun comando git de escritura.

## VEREDICTO: **RECHAZADO** — 1 bloqueante (R22)

Todo lo demas esta bien construido: la seleccion, el borrado, el efecto en base de datos y la
integracion con la 177 (R16) son correctos y estan medidos con tests que discriminan de verdad.
El bloqueante es unico, acotado y de arreglo pequeño, pero incumple un requisito explicito y
ademas quedo *fijado* por un test.

---

## Checklist (CHECKPOINTS.md)

### Especificacion
- [x] `specs/178-purga-pdf-cargas/requirements.md` con 26 requisitos EARS numerados.
- [x] `design.md` con alternativas descartadas y su porque.
- [x] `tasks.md`: 26 de 26 tasks marcadas `[x]` (26 `[x]`, 0 `[ ]`).

### Trazabilidad
- [x] Los 26 `R<n>` mapean a un test concreto. **Los 26 verificados abriendo el test citado**,
      no la tabla.
- [x] `progress/impl_178.md` contiene el mapa `R<n> -> test` completo.
- [ ] **R22 mapea a tests que NO miden el requisito** (BLOQUEANTE 1).

### Calidad de codigo
- [x] `pnpm typecheck` sin errores (via `./init.sh --rapido`).
- [x] `pnpm lint` sin errores (41 warnings preexistentes, ninguno en archivos de la 178).
- [x] Tests: los 6 ficheros de la feature corridos por el revisor -> **65/65 verdes**.
      `./init.sh --rapido` corrido por el revisor: cambiados 6 ficheros / 65 tests + guardias
      46 ficheros / 672 tests, todo verde, `== init OK ==`.
      Gate COMPLETO: lo corrio el leader (869 archivos / 10877 tests, 0 rojos); no se repite.
- [x] E2E: no aplica. Cron de mantenimiento sin UI; no entra en los flujos criticos listados.

### Datos y seguridad
- [x] Sin tablas nuevas -> no hay RLS nueva que exigir; la migracion no toca RLS (test lo afirma).
- [x] Migracion versionada con `migration.sql` + `down.sql` simetrico e inverso.
      **PARCIAL / NO MEDIDO:** ver menor 4.
- [x] Sin secretos hardcodeados. Se reutiliza `CRON_SECRET` via `loadCronConfig()`; no hay env
      de secreto nueva. `.env.example` documenta las dos claves sin valor.
- [x] No hay webhook nuevo. El cron valida `Bearer` y es idempotente (R8/R20 verificados).

### Patron de capas
- [x] Controller (`app/api/cron/purga-pdf-cargas/route.ts`): solo HTTP + auth + composition root.
- [x] Service: no conoce `Request`/`Response`.
- [x] Repository: solo queries Prisma.
- [x] Interfaces en `lib/interfaces/repositories/` y `lib/interfaces/services/`.

### Multi-pais / configuracion
- [x] Sin hardcode de pais/moneda/cuenta. La hora del cron va en UTC con la conversion a CR
      documentada (CR es UTC-6 fijo).

### Verificacion final
- [x] `./init.sh --rapido` verde (el completo, verde por el leader).
- [ ] Veredicto OK -> **no**: RECHAZADO.
- [x] Entrada en `progress/history.md` (la de la 178 la cierra el leader).

---

## Trazabilidad verificada: 26 / 26 R abiertos uno a uno

Convencion: **MIDE** = el test se pone rojo si el requisito se rompe; **INDIRECTO** = cubre el
contrato, pero la garantia fuerte vive en otra capa.

| R | Veredicto | Nota del revisor |
|---|---|---|
| R1 | MIDE | `purga-pdf-config.test.ts`: env `"1"` -> 1. |
| R2 | MIDE | ausente / `""` / `"abc"` / `"-1"` -> 7, los cuatro casos. |
| R3 | MIDE | `"0"` -> 0 **y** `not.toBe(7)`; `"36500"` -> 36500 (sin clamp). Discriminante frente al `readPositiveInt` copiado en `jobs.ts`/`etiquetas.ts`, que mandaria el 0 al default. |
| R4 | MIDE | (a) el modulo no exporta nada que no sea funcion y sus claves son exactamente `["loadPurgaPdfConfig"]`; (b) dos llamadas con env distinta -> ventanas distintas; (c) la ruta pasa `loadPurgaPdfConfig` **por referencia** (`expect(leerConfig).toBe(loadPurgaPdfConfig)`), no su resultado. |
| R5 | MIDE, en el repositorio (que es donde importa) | Sobre el `where` real: `Object.keys(where.createdAt)` === `["lte"]` (mata el off-by-one `lt` y cualquier segundo operador), `lte` === el corte recibido, y `JSON.stringify(where)` sin `fechaCarga`/`fecha_carga` ni anidado. Mas `orderBy createdAt asc` y `take` === limite. |
| R6 | MIDE | Service con fixture de N-1 / N / N+1 dias; el doble aplica el filtro REAL, la de N-1 no recibe `remove` ni `limpiarReferencias` y conserva sus rutas. No es tautologico. |
| R7 | MIDE | Agrupacion con 2 cargas y 5 filas de orden (incluida una con ruta null y otra con `cargaId` null): resultado exacto por `toEqual`. |
| R8 | MIDE | `OR` de 3 ramas leido del `where` real (2 columnas de carga + `ordenes.some`); y la 2a corrida no encuentra candidatas. |
| R9 | MIDE, doble via | Lectura: el `where` de `orden.findMany` no contiene `deletedAt` (ni serializado). Escritura: el `where` del `updateMany` es exactamente `{ cargaId }`. |
| R10 | MIDE | Una sola llamada a `remove` por carga, con consolidado + las 3 rutas, en orden, por `toEqual`. |
| R11 | MIDE (mecanismo de mutacion verificado) | El doble de `SupabaseFileStorage` **no reproduce el default** del 2o parametro, asi que omitirlo deja `args` de longitud 1 -> rojo. Ademas guardia `ETIQUETAS_BUCKET !== postulacionConfig.BUCKET` para que el test no se vuelva vacuo si alguien igualara los buckets por env. |
| R12 | MIDE | Carga elegible sin rutas: `remove` no se invoca **en absoluto** (no "con lista vacia"), pero si se limpia. |
| R13 | MIDE | `data` de `carga.update` con conjunto EXACTO de claves `{downloadUrl, downloadStoragePath}` a null, y `where { id }`. |
| R14 | MIDE | Idem para `orden.updateMany`, y ambos dentro de UNA `$transaction` (orden de llamadas comprobado). |
| R15 | MIDE | Conjunto exacto de claves del `data` (una columna de mas -> rojo) + `delete`/`deleteMany` nunca invocados. |
| **R16** | **MIDE — el mejor test del lote** | Analisis dedicado abajo. |
| R17 | INDIRECTO en service, **FUERTE en el repositorio** (verificado) | El `where` del `updateMany` es `{ cargaId: "<uuid>" }` (igualdad: en SQL una fila con `carga_id IS NULL` jamas casa) y la lectura usa `cargaId: { in: [...] }` (`IN` nunca casa NULL). Ademas el agrupador descarta explicitamente `o.cargaId === null`, y el test de R7 mete una fila `cargaId: null` que no aparece en el resultado. La garantia SQL existe. |
| R18 | MIDE | `vercel.json` leido de disco: path + `"0 9 * * *"`, forma diaria (5 campos), y ninguna otra franja `minuto hora` diaria coincide — con control previo `otrosDiarios.length > 0` para que la asercion no sea vacua. |
| R19 | MIDE | Si `remove` lanza: no se limpia, el error se propaga, `remove` se invoco **una sola vez** (sin reintento) y la fila conserva su ruta -> sigue siendo candidata mañana. |
| R20 | MIDE | Orden `remove` -> `limpiar` por log compartido **y** por `invocationCallOrder`; segunda corrida sobre el estado ya mutado: 0 llamadas. |
| R21 | MIDE | Config (default 200; `""`/`"abc"`/`"0"`/`"-10"` -> 200) + service (tope propagado a las dos consultas y exactamente `tope` cargas procesadas). |
| **R22** | **NO MIDE — el test fija el comportamiento equivocado** | BLOQUEANTE 1. |
| R23 | MIDE | 200 con resumen; `quedaPendiente: true` propagado; reloj inyectado pasado **crudo**; si el service lanza -> >= 500 sin filtrar secreto ni ruta, con el logger invocado. |
| R24 | MIDE | Resumen solo numerico + un bool; `JSON.stringify` sin ninguna cadena (`not.toMatch(/:\s*"/)`) y sin los ids/rutas del fixture. |
| R25 | MIDE, con el listado exigido | Los 5 casos: sin header, token incorrecto, secreto `null`, secreto `""`, y **`GET` real** sin header / sin `CRON_SECRET` afirmando que **no se construye NADA** (`prismaCtor`, `repoCtor`, `storageCtor`, `serviceCtor`, `ejecutar` sin invocar). "Ni una lectura" queda demostrado. |
| R26 | MIDE en estatico; **la mitad empirica NO MEDIDA** | 12 casos sobre el SQL ejecutable (comentarios excluidos): UP = exactamente 2 `CREATE INDEX`, ambos PARCIALES con su `WHERE` literal, tabla/columna exactas, cero DDL sobre datos, sin `CONCURRENTLY`; DOWN = 2 `DROP INDEX` en orden inverso **derivado del UP** (`[...upNombres].reverse()`), sin otro DDL; carpeta con ambos ficheros y timestamp pineado posterior al previo. Falta lo no ejecutable: ver menor 4. |

---

## Analisis dedicado: R16 (lo que justifica media feature)

**Cumple, y el control no es vacuo.** Verificado abriendo
`tests/integration/purga-pdf-regenera-177.test.ts` y siguiendo el estado de datos:

1. `PurgaPdfCargasRepository.limpiarReferencias` pone a NULL **`downloadStoragePath` Y
   `downloadUrl`**, en `carga` (`update`) y en `orden` (`updateMany`), en la misma transaccion.
   Es exactamente el testigo que mira `ApiPdfEtiquetaService` (`:50-51` orden, `:90` carga).
   Confirmado leyendo ambos ficheros, no la bitacora.
2. El test comparte **un unico objeto de estado** entre el doble de Prisma que consume el
   repositorio REAL de la 178 y el doble de `IOrdenRepository` que consume el
   `ApiPdfEtiquetaService` REAL de la 177: las filas que muta la purga son literalmente las que
   lee `/generate` despues. No son dos dobles independientes, que es como este tipo de test se
   vuelve falso.
3. El "bucket" es un `Set` compartido entre el `remove` de la purga y el generador: el test
   afirma que el objeto original **dejo de existir** y que lo firmado es un objeto **subido en
   esa misma llamada** (`objetos.has(rutaGenerada) === true`), no una expectativa hardcodeada.
4. **Discriminacion verificada por razonamiento cerrado sobre el codigo**, no por confianza en
   la bitacora: si `limpiarReferencias` dejase `downloadStoragePath` con valor, los dobles
   `findDownloadStoragePathByOrdenForOwner` / `findCargaConOrdenesForOwner` devolverian la ruta
   vieja, el service re-firmaria y `jsonCarga.generado` seria `false` -> rojo en la linea 484.
   No existe camino por el que el test pase con esa mutacion. Coincide con las dos mutaciones
   que el implementer reporta sobre la forma FINAL del test.
5. **T24 no es vacuo:** antes de la purga afirma `generado: false`, que la URL firmada apunta a
   la ruta ORIGINAL y que el generador **no** se invoco (`rutasGeneradas === []`). Sin el, T23
   pasaria aunque la purga no hiciera nada; con el, "no hacer nada" pone T23 en rojo.
6. El doble de Prisma **lanza** ante cualquier filtro o columna de `data` que no conozca
   (`aplicarData` incluida): si mañana el repo emite un filtro nuevo o toca una columna de mas
   (violando R15), el test revienta con un error explicito en vez de volverse laxo.

Unico matiz, no hallazgo: el test no afirma explicitamente que `downloadUrl` quede a NULL; eso
lo cubre el test de repositorio con conjunto exacto de claves (R13/R14). Cobertura suficiente
entre los dos.

## Analisis dedicado: el `where` del borrado irreversible

Revisado **en el repositorio, donde vive**, no solo en el service:

- `whereCandidatas(corte)` = `{ createdAt: { lte: corte }, OR: [ 3 ramas de referencia viva ] }`.
  En Prisma los campos de primer nivel y `OR` se combinan con AND: no hay forma de que una
  carga fuera del corte entre por la puerta del `OR`.
- `lte` (corte inclusivo, decision (f)); el test lo blinda con
  `Object.keys(where.createdAt) === ["lte"]`, que rompe tanto ante `lt` como ante un segundo
  operador colado.
- El corte se calcula **una sola vez** por corrida y las dos consultas comparten el helper
  `whereCandidatas`: seleccion y comprobacion de pendiente no pueden divergir en el predicado.
- Las rutas de orden solo se leen con `cargaId: { in: cargaIds }`, es decir, unicamente de las
  cargas ya seleccionadas, y el agrupador indexa por un `Map` prellenado solo con esos ids:
  **ninguna ruta de una carga fuera del corte puede llegar a `remove`**.
- N = 0: `corte = now`, verificado en el service (`toEqual(NOW)`), y la carga creada esa misma
  mañana entra. Negativo / no numerico / ausente -> 7, los cuatro casos medidos.

Conclusion: **el borrado no puede alcanzar objetos de cargas que no cumplen el corte.**

## Aislamiento del cron

- `middleware.ts:32` — `SELF_AUTH_ROUTES = ["/api/cron", ...]` y `:47` devuelve `next()` por
  prefijo: `/api/cron/purga-pdf-cargas` pasa igual que los otros cinco crons, sin tocar nada.
- El guard de `handlePurgaPdfCargas` corre **antes** de `withErrorHandler` y antes de
  `buildService()`: con secreto ausente, vacio o incorrecto no se construye Prisma, ni el repo,
  ni el storage, ni se invoca el service. Verificado en el codigo y afirmado sobre el `GET` REAL
  en dos tests. **Sin secreto no ejecuta ni una lectura: cumple.**
- Desviacion deliberada y correcta respecto del clon `procesar-devueltas-sla`: se añade
  `expected === ""` al guard (defensa en profundidad; `loadCronConfig` ya mapea `""` a `null`).

---

## Hallazgos

### BLOQUEANTE 1 — R22: `quedaPendiente` reporta `false` habiendo trabajo pendiente

`PurgaPdfCargasService.ejecutar` llama a `repo.quedanCargasPurgables(corte, tope)` **despues**
del bucle de purga (`lib/services/PurgaPdfCargasService.ts:85`; asi lo prescribe tambien
`design.md:251`, paso 5). Pero `quedanCargasPurgables` hace
`findFirst({ where: whereCandidatas(corte), skip: limite, take: 1 })`
(`lib/repositories/PurgaPdfCargasRepository.ts:96-105`), con el comentario "saltando las
`limite` ya devueltas".

Esa premisa es falsa **justo por lo que hace la feature**: las `limite` cargas ya procesadas
perdieron su referencia viva, asi que ya **no casan** `whereCandidatas` y no estan entre las
filas que `skip` deberia saltar. El `skip: limite` descuenta entonces un segundo lote de
candidatas que SI siguen pendientes.

Consecuencia medible: siendo `P` las candidatas al inicio y `L` el tope,
**para todo `L < P <= 2L` la corrida responde `quedaPendiente: false` aunque queden `P - L`
cargas sin purgar.** Con el default `L = 200`, cualquier backlog de entre 201 y 400 cargas
miente. R22 exige lo contrario: "dejar constancia de que quedo trabajo pendiente".

**Reproducido por el revisor** (script desechable en el scratchpad, fuera del repo; no se
modifico ni un archivo del proyecto), con el `PurgaPdfCargasService` y el
`PurgaPdfCargasRepository` REALES sobre un doble de Prisma con estado mutable, 3 candidatas y
tope 2:

```
cargasPurgadas 2 · restantes reales 1 · quedaPendiente false
AssertionError: expected false to be true
```

Por que los tests verdes no lo vieron:

- `tests/unit/services/purga-pdf-cargas-service.test.ts` (`R21/R22`) usa **5** candidatas con
  tope **2**: quedan 3 > 2, asi que sale `true` por el margen, no por correccion. Con 3
  candidatas y tope 2 ese mismo test se pondria rojo.
- El doble del repo en ese test implementa `candidatas(corte).length > limite`, que **reproduce
  fielmente la semantica equivocada** del repositorio real: por construccion no puede detectarla.
- `tests/unit/repositories/purga-pdf-cargas-repository.test.ts` afirma `expect(arg.skip).toBe(200)`:
  **fija el bug como contrato**.

Que falta para cumplir R22 (no lo arregla el reviewer):

1. Que la comprobacion de pendiente refleje el estado **post-purga**: lo natural es
   `quedanCargasPurgables(corte, 0)` tras el bucle (o un `existeAlgunaCandidata(corte)` sin
   `skip`); alternativa: evaluarla **antes** del bucle si se quiere conservar `skip: limite`.
2. Un test que discrimine de verdad: `candidatas = tope + 1` (p. ej. 3 con tope 2) esperando
   `quedaPendiente === true`. El caso 5/2 actual no distingue las dos implementaciones.
3. Actualizar la asercion `skip === 200` del test de repositorio y el paso 5 de `design.md:251`,
   que arrastra la misma premisa.

### menor 1 — la migracion no es re-aplicable (`CREATE INDEX` / `DROP INDEX` sin `IF [NOT] EXISTS`)

`db/migrations/20260803140000_purga_pdf_indices/migration.sql` usa `CREATE INDEX` a secas y
`down.sql` usa `DROP INDEX` a secas. El precedente mas cercano del repo,
`20260803090000_gestion_orden_idx_created_at`, si usa `IF NOT EXISTS` / `IF EXISTS`. Con el
flujo normal de Prisma (una aplicacion, un rollback) no molesta, pero un `db:rollback`
ejecutado dos veces, o un UP sobre una base donde el indice ya exista, aborta. Dado que el
round-trip **no se pudo medir** (menor 4), la version defensiva seria la prudente.

### menor 2 — el guard de ORDEN COMPLETO de `crons` en `vercel.json`: **relajarlo**

`R18: la entrada nueva no altera ni reordena las cinco existentes` fija el array completo por
`toEqual`. Cumplio su funcion (demostrar "añadir, no reescribir"), pero desde el merge pasa a
juzgar cualquier reordenacion legitima futura de un fichero compartido por 6 features — el
mismo patron de la leccion "guard branch-scoped caduca al mergear". **Decision del revisor:
relajarlo** a "las cinco entradas previas siguen presentes con su `path` y su `schedule`", sin
fijar posiciones. Los otros tres tests de R18 (existencia, forma diaria, no colision de franja)
ya cubren lo que importa y no caducan.

### menor 3 — `maxDuration = 60`: se acepta como precedente nuevo

Ninguna otra ruta de `app/api/cron/` lo declara. La justificacion escrita en el fichero es
correcta y verificable (hasta 200 cargas por corrida, cada una con una llamada a Storage y una
transaccion; con el default de plataforma de 10 s la primera corrida sobre un historico moriria
a medias) y el valor coincide con el precedente ya existente en
`app/api/ordenes/api-key/carga/route.ts`. **Se conserva.** Si el patron se acepta, conviene
extenderlo a `procesar-jobs` y `corte-diario` en un ticket aparte, en vez de dejar esta como la
unica ruta de cron con presupuesto explicito.

### menor 4 — R26 a medias: `db:migrate` / `db:rollback` **NO MEDIDOS** (dicho explicitamente)

La mitad empirica de R26 —que el UP aplique contra Postgres, que `pnpm db:rollback` lo revierta,
y si un `migrate dev --create-only` posterior propone un `DROP INDEX` fantasma de los dos
indices parciales— **no esta verificada, ni por el implementer ni por este reviewer.** La causa
es **ajena y preexistente** a la 178: la base local tiene aplicada la migracion
`20260728120000_orden_historial_origen_deshacer_asignacion`, ausente del repo, mas un checksum
modificado en `20260714123909_reconcile_fks_...`; `prisma migrate dev` exige un reset. No se
intento arreglar el drift ni resetear nada (correcto). Lo verificable en estatico esta
verificado y es solido. **Queda como deuda medible: correrlo en un entorno con la historia de
migraciones alineada antes del deploy.** No bloquea la revision de codigo, pero R26 no puede
declararse cerrado del todo.

### menor 5 — R17 en el service es indirecto (aceptado)

Lo declaro el implementer y se confirma: el test de service solo puede afirmar que la ruta de
una orden sin lote no viaja a `remove` y que el service usa unicamente los tres metodos del
contrato. La garantia fuerte se verifico donde vive, en el SQL del repositorio (igualdad
`cargaId` en el `updateMany`, `IN` en la lectura: ninguno casa NULL). Suficiente.

### menor 6 — `objetosBorrados` = rutas SOLICITADAS, no confirmadas

Consecuencia de que `SupabaseFileStorage.remove` descarte el `{ error }` del SDK. Esta
documentado en el JSDoc de la interfaz, en el comentario de clase del service y en los riesgos
del spec. Correcto declararlo; el numero no debe leerse como espacio liberado. Corolario
tambien declarado: R19/R20 solo se activan ante excepciones de red/cliente.

### menor 7 — laxitud heredada de `parseInt` en la config

`readNonNegativeInt("7.9")` -> 7 y `("10x")` -> 10, en vez de caer al default. Es identico a
`lib/config/jobs.ts` y `lib/config/etiquetas.ts`: consistencia con el repo, no una regresion.
Se anota por si algun dia se endurece en los tres a la vez.

### menor 8 — huerfanos de la 136/141 y ordenes sin lote

Ambas limitaciones estan declaradas en `requirements.md` y en los riesgos de la bitacora, con
ticket aparte recomendado. La 177 (`specs/177-api-consulta-orden-pdf/design.md:84-87`) daba por
hecho que esta feature barreria sus huerfanos: **no puede**, y la correccion de ese supuesto
esta escrita. Bien resuelto documentalmente.

---

## Estado de la 177 (lo que esta feature podia romper)

No se toco `lib/services/ApiPdfEtiquetaService.ts` ni ningun archivo de la 177: verificado en el
diff (los unicos ficheros de produccion son los 6 nuevos de la 178, mas `vercel.json` y
`.env.example`). La interaccion se resuelve por estado de datos, que es lo correcto, y esta
cubierta por el test de integracion de R16. `vitest run --changed origin/dev` -> 6 ficheros /
65 tests verdes; guardias 46 ficheros / 672 tests verdes.

## Que hace falta para pasar a APROBADO

Corregir **solo el BLOQUEANTE 1**: calculo de `quedaPendiente`, test discriminante con
`tope + 1` candidatas, asercion `skip` del test de repositorio y paso 5 de `design.md`. Los
menores 1 y 2 son mejoras recomendadas en el mismo viaje; el resto son notas o deuda declarada.
