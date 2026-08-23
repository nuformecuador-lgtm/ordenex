# Review — feature 266 · habilitar pedido con novedad desde el canal por API key

Rama `feature/266-habilitar-pedido-api-key` (worktree `C:/w266`), 4 commits sobre
`origin/dev` (`39115008`). Revisado el 2026-08-23 leyendo el diff completo contra
`origin/dev`, los tres archivos de `specs/266-habilitar-pedido-api-key/`,
`progress/impl_266.md`, `CHECKPOINTS.md` y los SQL de las dos migraciones.

**VEREDICTO: RECHAZADO** — 1 bloqueante (trazabilidad de R29/R30: no existe NINGUN
test que toque las dos migraciones nuevas, y la fila R29 del mapa cita una guardia
que no las cubre). Todo lo demas verificado y verde.

---

## Checklist

### Especificacion
- [x] `requirements.md` con 33 requisitos EARS numerados (R1..R31 + R13-b + R14-b) y las
      seis decisiones D1..D6 firmadas transcritas.
- [x] `design.md` con seccion 7 «Alternativas descartadas»: SEIS (A1..A6), cada una con su porque.
- [x] `tasks.md`: 20 tasks, **las 20 marcadas `[x]`**, cero `[ ]`.

### Trazabilidad
- [x] `progress/impl_266.md` contiene el mapa `R<n> -> test` (33 filas).
- [ ] BLOQUEA — **cada `R<n>` mapea a un test que lo verifica**: falla en **R29 y R30**
      (hallazgo B1). Los 31 restantes: abiertos uno a uno, los asertos muerden.

### Verificacion ejecutable
- [x] Perimetro corrido por mi en el worktree, no citado de la bitacora:
      `pnpm exec vitest run` sobre los 11 archivos de la feature ->
      **11 archivos / 140 tests, 0 rojos, 2.43 s**.
- [x] Gate completo (typecheck, lint, 1332 archivos / 18007 tests, 2 rojos que pasan
      aislados) ya corrido por el leader; no se re-mide por indicacion explicita.
      `./init.sh` NO se corrio aqui, tampoco `pnpm db:migrate` (prohibido en esta maquina).

### Datos y seguridad
- [x] Tabla nueva `orden_habilitacion_api` con `ENABLE ROW LEVEL SECURITY` y CERO
      `CREATE POLICY` (patron `orden_nota`). **Sin test que lo afirme** -> B1.
- [x] Dos carpetas de migracion **separadas por el 55P04**, cada una con su `down.sql`.
- [x] El `down.sql` del enum es HONESTO: recrea el tipo con **31 valores** —diffeados linea
      a linea contra el down de la 240, unica diferencia `+rechazo_tienda`, que es lo
      esperado— y el `ALTER COLUMN ... USING (origen_tipo::text::tipo)` **aborta** si queda
      cualquier fila con `habilitacion_api`: no hay ELSE, no hay NULLIF, no hay DELETE
      silencioso. La precondicion esta escrita en el archivo.
- [x] `down.sql` de la tabla: `DROP TABLE IF EXISTS`, sin `DROP TYPE` (el tipo no es suyo).
- [x] **Ningun `down.sql` previo fue tocado**: el `--stat` del diff solo lista los dos nuevos.
- [x] Sin secretos hardcodeados. R5 afirmado con espia real de `console.error` en los
      tres desenlaces (401/403/200) y en el 500 inesperado.
- [x] Sin hardcode de pais/moneda/cuenta: la feature no toca dinero.
- [x] Webhooks: **no se crea ninguno**. Se reutiliza el choke point existente.

### Patron de capas
- [x] Route: auth + envoltorio zod + `NextResponse`. Cero queries, cero negocio.
- [x] Service: sin Request/Response/headers/Prisma. Recibe `Actor` y filas crudas.
- [x] Repos: solo Prisma. `OrdenHabilitacionApiRepository` expone UN metodo (`registrar`).
- [x] Interfaces en `lib/interfaces/{repositories,services}/`.

---

## Las nueve prioridades de la revision

**1. La escritura no se duplica — OK.** El diff no introduce ni un `updateMany` ni un
`update` sobre `orden`: lo unico que gana `OrdenRepository` es `findParaHabilitacionApi`,
un `findFirst` puro (con un test que espia `update/updateMany/create/delete/$transaction`
y los afirma NO llamados). La rama A entra por `transicionarAyuda`, el punto unico de 235/R8.
El constructor del service recibe un
`Pick<IOrdenRepository, "findParaHabilitacionApi" | "findEstatusIdByValue" | "transicionarAyuda">`:
un segundo camino de escritura no compila. El mapa `orden-historial-cobertura` sube a 32
puntos declarando el #33 sobre el MISMO simbolo, que es lo correcto.
La PUERTA si difiere (owner = `actor.usuarioId` forzado en el where, sin `autorizarSobreHilo`),
como la decision humana firmada permite.

**2. La guarda de estado — OK, y atacada.** Vive en el llamador
(`ApiHabilitacionService.procesarFila`, paso 4, ANTES de cualquier escritura) y se deriva de
`ESTATUS_POR_GRUPO`, no de literales nuevos. Se ataca directamente con el repo devolviendo
una orden fuera de estado: `it.each(["entregada","rechazada","en_reparto","incidente",
"sin_gestionar"])` **con mensajero asignado a proposito**, para que ni el discriminador de
rama pueda salvarla, y en los cinco se afirma `transicionarAyuda` NO llamado y `registrar`
NO llamado.

**3. Aislamiento por owner — OK.** El owner viaja en el where del mismo statement
(`{ numGuia, tiendaId: ownerId, deletedAt: null }`, afirmado con `toEqual` sobre lo que
llega a Prisma), no en un `if` posterior. La indistinguibilidad no depende de dos asserts
sueltos: es **estructural**, porque el repo devuelve `null` para los tres casos (no existe /
borrada / ajena) y el service construye el error desde una constante
(`MENSAJE.no_encontrada`), asi que no hay ninguna rama de codigo capaz de producir dos
cuerpos distintos. El cuerpo completo se afirma con `toEqual` en el caso `no_encontrada`.
Ver M4.

**4. La rama A notifica de verdad — OK.** `tests/unit/services/jobs/webhook-habilitacion-api-emision.test.ts`
usa el emisor REAL (`emitirWebhooksEstado`) sobre el choke point REAL (`appendCambioEstado`),
con solo el `JobRepository` falso: afirma **UN** job `webhook_estado` con
`{ ordenId, estatusDestinoId: en_reparto }`; un caso de control que pasa la misma entrada
cambiando solo la familia (`rescate_ayuda_tienda`) para detectar una exencion por familia
reintroducida a escondidas; y el caso «sin suscriptor no encola, pero la transicion se
registra». Muerde.

**5. Dinero — OK.** `habilitacion_api` **NO** entra en `ORIGEN_TIPOS_VISITA_REAL`, y no se
afirma con un `not.toContain` blando: el test fija la lista entera,
`expect(ORIGEN_TIPOS_VISITA_REAL).toEqual(["gestion","gestion_tienda_ayuda"])`, asi que se
pone rojo tanto si alguien mete esta familia como si ensancha la lista por otra via.
Tampoco entra en `ORIGEN_TIPOS_CON_GESTION`. Esta dicho por escrito en cuatro sitios
(`lib/types/orden-historial.ts`, `db/schema.prisma`, el `migration.sql` del enum y el test),
con la cadena del dano nombrada: intentos -> cron SLA (99) -> `cobroRechazado` (56).

**6. Las decisiones firmadas — OK las seis.**
- D1: solo `ayuda_tienda` y `devuelta`, derivados de `ESTATUS_POR_GRUPO`. `reprogramada`
  tiene su **`it` propio con nombre** (R13-b), no es un caso mas de la tabla.
- D2: tope 100 en `TOPE_FILAS_HABILITAR`, sin palanca de entorno, con test de 101 (422) y
  de 100 exacto (200, tope inclusivo).
- D3: segunda habilitacion -> `error` / `estado_no_habilitable`, con un
  `expect(...).not.toBe("habilitada")` explicito, **cero escrituras** (`transicionarAyuda`
  y `registrar` no llamados) y el resumen en `conError: 1`.
- D4: tabla sin lector, declarada en voz alta en `schema.prisma`, en el `migration.sql` y
  en requirements. Comprobado: no hay ningun lector de `ordenHabilitacionApi` en el arbol.
- D5: familia `habilitacion_api`, en el SEED, en el enum Prisma y en la migracion, sin drift.
- D6: la nota NO se copia al `motivo`. El test no se conforma con mirar las claves: hace
  `expect(JSON.stringify(entrada)).not.toContain("reintento")`.
- **Rama B no notifica y no dejo ganchos**: el diff completo no contiene ni un
  `notificar` / `NotificacionEvento` / `enqueue` nuevo; `schema.prisma` no gana ningun valor
  de enum de notificaciones; la rama B solo llama `logRepo.registrar` y ni siquiera consulta
  el catalogo de estados (hay test de eso).

**7. Las migraciones — OK.** Ver el bloque «Datos y seguridad»: dos carpetas separadas por el
55P04, la del enum ANTES por timestamp, cada una con su `down.sql`, y el down del enum leido
entero y confirmado honesto.

**8. Los ONCE tests de migracion modificados — OK, ninguno relajado.** Auditados **los once**,
no tres: diez reciben unicamente el literal `"habilitacion_api"` dentro de su set de
POSTERIORES / `AÑADIDOS_EN_O_DESPUES_DEL_*` y **conservan la comparacion por contenido**
(`expect(new Set(valores)).toEqual(new Set(SEED.filter(...)))`); al de la 240
(`rechazo-tienda-migration.test.ts`) se le **crea** la lista `POSTERIORES`, que es
literalmente lo que su propio comentario ordenaba hacer el dia que llegara otro valor. Los
conteos que cambian (`toHaveLength(31)->(32)` en `orden-historial-types` y en
`...recoleccion-tienda-incidente...`, y 31->32 en `orden-historial-cobertura`) siguen
ACOMPANADOS de la comparacion exhaustiva de la lista, no la sustituyen. Ningun `down.sql`
previo tocado.

**9. `num_guia` sin coercion — hallazgo MENOR, no bloqueante.** Ver M1.

---

## Hallazgos

### BLOQUEANTE

**B1 — R29 y R30 no tienen test: no existe NINGUN archivo de test que lea las dos
migraciones nuevas, y el mapa de trazabilidad lo disimula.**

`grep -rln "orden_habilitacion_api|20260823120000|20260823130000" tests/` devuelve **cero
resultados**. El mapa lo dice a medias:

- **R29** se justifica con «cubierto por la guardia de RLS del repo (tests/unit/guards,
  verde)». **Esa guardia no existe.** Lo mas parecido es `tests/unit/db/ordenes-rls.test.ts`,
  que lee por ruta absoluta dos migraciones de julio (`*_ordenes_catalogos_geografia` y
  `*_ordenes`) y no mira ninguna otra: no puede ponerse roja si manana alguien borra el
  `ENABLE ROW LEVEL SECURITY` de `orden_habilitacion_api`.
- **R30** se justifica citando el contenido del `down.sql`. El contenido es correcto —lo
  verifique leyendolo—, pero un requisito verificado por lectura humana no es un requisito
  verificado: es exactamente lo que `CLAUDE.md` regla 4 y `CHECKPOINTS.md > Trazabilidad`
  prohiben.

No es un formalismo, y la propia feature lo demuestra: los **once** tests que este PR tuvo
que modificar son de esa familia, y existen porque en este repo el DDL se protege con tests
que leen el SQL. La convencion esta viva y es reciente —`postulacion-recurso-migration.test.ts`
(253), `orden-nota-migration.test.ts` (227), `rechazo-tienda-migration.test.ts` (240),
`anclaje-devolucion-migration.test.ts` (239)—: bloque estatico que contrasta `migration.sql`,
`down.sql` y `schema.prisma` por regex, mas bloque contra Postgres real cuando hay
`DATABASE_URL`. La 266 crea una tabla y un valor de enum y es la unica que no lo trae.

**Que falta para levantarlo.** Un `tests/integration/db/habilitacion-api-migration.test.ts`
—el bloque estatico basta para desbloquear; el bloque contra base real es deseable y
opcional— que, localizando las carpetas por SUFIJO y no por ruta fija, afirme:

1. `ALTER TABLE "orden_habilitacion_api" ENABLE ROW LEVEL SECURITY;` presente y **cero**
   `CREATE POLICY` sobre esa tabla (R29).
2. Que el `down.sql` del enum recrea el tipo con **exactamente**
   `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED` menos `habilitacion_api` —comparado como conjunto
   contra el SEED, igual que hacen los otros once— y que su `ALTER COLUMN ... USING` es el
   cast directo, sin ELSE / NULLIF / DELETE, o sea que **aborta** con filas vivas (R30).
3. Que las dos migraciones estan **separadas** y que la del enum es la ANTERIOR por
   timestamp (el 55P04 es el motivo de que sean dos: hoy nada lo vigila).
4. Que los dos `down.sql` existen y que el de la tabla no lleva `DROP TYPE`.
5. Paridad `migration.sql` <-> `schema.prisma` de la tabla nueva: las dos FK con `Cascade` y
   `Restrict`, los dos indices, y la ausencia de `updated_at` / `deleted_at`, que es lo que
   sostiene el append-only de R24.

Y corregir la fila R29 de `progress/impl_266.md`, que hoy cita una guardia inexistente.

### menores

**M1 — tres criterios para `num_guia` dentro del mismo canal.** El listado (257,
`app/api/ordenes/api-key/route.ts:62`) usa `z.coerce.number().int().positive()`; la carga
declara en el contrato publicado que «Todas las claves son strings»
(`docs/api/api-key-openapi.yaml:1124`); y `habilitar` exige un number JSON, asi que
`"100234"` es `fila_invalida`. Es una friccion real de integracion —el mismo campo, el mismo
canal, la misma key, tres reglas— y el caso de soporte probable es un cliente que serializa
todo a texto y recibe 100 filas invalidas con un 200 encima.
**No se marca bloqueante por tres razones concretas:** (a) el listado es query string, donde
todo llega texto y la coercion no es una eleccion; (b) la divergencia **esta declarada en el
contrato publicado**, no descubierta —`HabilitacionRow.num_guia` dice literalmente «No se
acepta como texto»—; y (c) el criterio estricto es el seguro: es el que evita que `"0012"`
se convierta en 12 y se habilite la orden equivocada, desenlace peor que un `fila_invalida`.
Si se quiere cerrar, la ficha aparte es «unificar el criterio de num_guia en el canal», no
un parche en esta.

**M2 — sin E2E, y el checkpoint lo pide para «ingesta de ordenes / webhooks».** No hay ni
puede haber Playwright util aqui: `e2e/` es UI y **ningun** endpoint del canal por API key
tiene E2E (ni la carga, ni la cancelacion, ni la cotizacion). Se acepta por precedente, pero
queda anotado: el unico ensamblaje real route -> service -> repo -> Postgres de esta feature
no se ejercita en ningun sitio; todos sus tests corren con dobles.

**M3 — `progress/history.md` sin entrada para la 266.** Es bookkeeping del leader al
aterrizar, no del implementer, pero `CHECKPOINTS.md > Verificacion final` lo exige antes de
pasar a `done`.

**M4 — falta el caso escrito «misma guia, otra tienda».** La opacidad es estructural (el repo
devuelve `null` en los tres casos y el mensaje sale de una constante), asi que el riesgo real
es bajo; pero un `it` que llame al service dos veces —una guia inexistente y una guia ajena—
y compare los **cuerpos completos** con `toEqual` entre si dejaria la promesa de R4 afirmada
en vez de deducida. Es barato, y es la clase de invariante que se rompe el dia que alguien
anade un mensaje «mas util».

**M5 — el `estatusId` leido no se usa.** `OrdenParaHabilitacionApi.estatusId` se documenta
como «para pasarlo como origen guardado de la transicion», pero la rama A usa
`findEstatusIdByValue("ayuda_tienda")` y nunca lee ese campo. El comportamiento es
equivalente —si difirieran, el `updateMany` guardado afecta 0 filas y la fila cae en
`estado_no_habilitable`, que es la direccion segura—, pero hoy es un dato muerto con un
comentario que promete otra cosa.

---

## Que hace falta para APROBAR

Solo **B1**: un archivo de test de migracion para la feature (los cinco asertos de arriba) y
la correccion de la fila R29 del mapa. Nada mas de este review es bloqueante. Vuelve al
implementer.

---
---

# Ronda 2 — verificacion del cierre de B1

Commits `c27d8fd3` (test de las migraciones + M4 + M5) y `bcae914e` (correccion del mapa).
La primera parte de este documento **no se reescribe**: B1 ocurrio y queda en el historial.

**VEREDICTO DE LA RONDA 2: APROBADO.** B1 cerrado, y cerrado por encima de lo pedido.
Cero bloqueantes nuevos. Quedan tres menores abiertos de la ronda 1 y dos nuevos de prosa.

## 1. El test nuevo cubre los cinco asertos — SI, y con el motor

`tests/integration/db/habilitacion-api-migration.test.ts`, **21 `it` / 21 passed / 0 skipped**
(corrido por mi con `--reporter=verbose`, los 21 nombres impresos uno a uno). Los cinco asertos
que pedi, localizados:

1. **RLS + cero policies** — no por regex sobre el `.sql`, sino leyendo `pg_class.relrowsecurity`
   y `pg_policies` **despues de ejecutar el `migration.sql` REAL** en un esquema temporal:
   «R29: relrowsecurity es true en `orden_habilitacion_api`» y «R29: CERO policies...».
2. **Down del enum** — «la lista del DOWN es EXACTAMENTE el SEED menos `habilitacion_api`, y son
   31 valores» (comparado **contra `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED`**, no contra una copia a
   mano) y «el `USING` no lleva ELSE, NULLIF ni CASE: ABORTA en vez de tragarse filas en
   silencio», que ademas censa COALESCE, DELETE FROM y UPDATE sobre `orden_historial_estado`.
   El censo corre sobre el SQL **sin comentarios**, que es lo correcto: la prosa del propio down
   nombra USING ... ELSE para explicar por que NO lo usa, y un censo ingenuo se autoenganaria.
3. **Migraciones separadas y ordenadas** — «el enum y la tabla van en migraciones DISTINTAS, y la
   del enum es ANTERIOR por timestamp», que ademas afirma que la del enum no crea tabla, que la
   de la tabla no toca el tipo y que **no nombra el valor nuevo** (el 55P04 por la puerta de
   atras).
4. **Los dos `down.sql`, el de la tabla sin `DROP TYPE`** — cubierto, y con el reciproco: el down
   del enum tampoco tira la tabla.
5. **Paridad SQL / `schema.prisma`** — columnas parseadas de los dos ficheros y comparadas una a
   una, mas la ausencia de `updated_at` / `deleted_at` afirmada en ambos **y** en el motor.

De propina, y no lo habia pedido: CASCADE y RESTRICT **ejercitados** (se borra la orden y se
cuentan las filas antes y despues; se intenta borrar al actor y se afirma el mensaje de la FK),
la PK, las dos FK por `pg_constraint`, el indice compuesto **en su orden** y que el `down.sql`
REAL deja el esquema vacio. El bloque tampoco puede quedar verde por vacio: crea su propio
usuario y su propia orden, y si faltaran catalogos **lanza** con el motivo escrito en vez de
abstenerse.

## 2. El bloque contra el motor SE EJECUTA — probado, no leido

12 de los 21 `it` estan bajo `describeSiHayBase`; el reporte verbose los lista **ejecutados**,
no skipped. La prueba dura no es esa: al comentar el `ENABLE ROW LEVEL SECURITY` del
`migration.sql`, el test rojo devolvio `relrowsecurity: false` **leido de `pg_class`**. Un bloque
saltado o simulado no puede observar eso. El motor esta detras.

## 3. Las dos mutaciones — reproducidas, 1 rojo cada una, arbol restaurado

- Comentado `ALTER TABLE "orden_habilitacion_api" ENABLE ROW LEVEL SECURITY;` ->
  **1 failed | 20 passed**, y el rojo es el de `pg_class`.
- Metido un NULLIF en el `USING` del `down.sql` del enum -> **1 failed | 20 passed**, y el rojo es
  el del `USING`.

Restaurados los dos por copia byte a byte (md5 comprobado en el primero) y **`git status` limpio**
salvo este mismo archivo; `git diff --stat` vacio. Perimetro completo re-corrido despues:
**12 archivos / 162 tests / 0 rojos**.

## 4. El mapa — ahora es cierto; «verbatim» es aspiracional en cinco filas

- **R29 y R30 ya no mienten**: apuntan a **MIG** y sus citas son **verbatim**, comprobadas contra
  los nombres reales de los `it` y no contra la bitacora. La afirmacion falsa que motivo B1 —la
  «guardia de RLS del repo»— **desaparecio del documento**, y el fallo queda explicado en la
  seccion «Ronda 2» de `impl_266.md` sin adornos, que es como debe quedar.
- **R21, R24 y R10 corregidas**, las tres a verbatim real: los `it` de RD2 se llaman «R21: el
  create recibe los CINCO campos de la fila de la rama A», «R24: append-only — dos habilitaciones
  de la MISMA orden hacen DOS inserts, sin tocar la primera» y «R24: la clase NO expone ningun
  metodo de actualizacion ni de borrado»; el de OAS, «el enum de `resultado` publica los TRES
  desenlaces, y solo esos».
- **Auditoria propia, no muestreo**: extraje por script las 33 filas con todas sus citas y las
  contraste contra los **120 `it`** declarados en los diez archivos del perimetro. **Todas las
  citas resuelven a un `it` que existe.** Los conteos de los cinco `it.each` (R5 x3, R6 x6, R7 x7,
  R13/R14 x5, R19 x2) cuadran con el codigo.
- **Aviso del emoji tenido en cuenta**: el `it` de R26 empieza por un emoji de moneda y por eso
  escapa a un barrido ingenuo. **Existe**
  (`tests/unit/types/orden-historial-habilitacion-api.test.ts:31`), lo verifique invirtiendolo en
  la ronda 1 y no lo di por ausente.
- **m6 (menor)**: la bitacora dice que las 28 restantes quedaron «verbatim», y en cinco filas
  siguen siendo **parafrasis fieles**, no citas literales: R3, R22, R26, R27 y R28 —por ejemplo,
  R28 escribe «paridad objeto-espejo» donde el `it` dice «paridad objeto <-> espejo», y R27 cita
  la asercion en lugar del nombre del caso—. Cada una resuelve a un test real que muerde, lo
  verifique una por una, asi que **no es lo que fue B1**: aquello apuntaba a algo inexistente,
  esto apunta bien con otras palabras. Se anota para que nadie lea «verbatim» como garantia
  mecanica.

## 5. M4 y M5 — cerrados

- **M4**: «R4: MISMA GUIA, OTRA TIENDA — responde `no_encontrada`, igual que si la guia no
  existiera» afirma **igualdad del objeto de error** contra una guia inventada
  (`expect(resAjena.resultados[0].error).toEqual(resInexistente.resultados[0].error)`), no solo
  que las dos fallen; comprueba ademas el cuerpo completo de la fila ajena con `toEqual`, que el
  mensaje no filtra por `/tienda|otro|ajen|permiso|autoriz/i`, y cierra con cero escrituras. Es
  exactamente lo que pedi. Sigue siendo un doble —el `null` se inyecta—, pero la parte que un
  doble no puede probar (que la orden ajena NO llega) ya la cubre el test del `where` en RD1:
  entre los dos, la promesa de R4 queda afirmada de punta a punta.
- **M5**: `estatusId` **retirado** del tipo, del `select`, del aplanado y del fixture de los
  tests, con `expect(select).not.toHaveProperty("estatusId")` para que no vuelva por descuido y
  con `toEqual` —no `objectContaining`— en el aplanado. La decision es la correcta: usarlo habria
  cambiado comportamiento firmado (R19 resuelve el origen por value, con fallo cerrado), y
  arreglar solo el comentario habria dejado un dato muerto dentro de un `select` cuyo docblock
  promete «ni uno mas». Nada quedo roto: perimetro verde, y el gate completo del leader tambien.
- **m7 (menor) — queda UN comentario mintiendo, el unico que se escapo.**
  `lib/interfaces/repositories/IOrdenRepository.ts:1590`, en el docblock del METODO
  `findParaHabilitacionApi` de la interfaz, sigue diciendo «`select` ACOTADO a los **cuatro**
  campos del discriminador». Los otros tres sitios se corrigieron a TRES —el docblock del tipo,
  190 lineas mas arriba **en el mismo archivo**, el del repositorio y los tests—, asi que hoy el
  mismo fichero afirma tres y cuatro. Es prosa, no comportamiento, y no bloquea; pero es
  literalmente la clase de dato caduco que M5 existia para quitar. Una linea.

## Estado de los menores de la ronda 1

| # | Estado |
| --- | --- |
| M1 (`num_guia` sin coercion, tres criterios en el canal) | ABIERTO, aceptado: declarado en el contrato publicado. Ficha aparte si se quiere unificar |
| M2 (sin E2E del canal por API key) | ABIERTO, deuda preexistente de TODO el canal, no de esta ficha |
| M3 (`progress/history.md`) | ABIERTO, es del leader al aterrizar |
| M4 (guia de otra tienda) | **CERRADO** |
| M5 (`estatusId` muerto) | **CERRADO**, salvo el resto de prosa m7 |

## Veredicto final

**APROBADO.** B1 cerrado y verificado **invirtiendo** los asertos, no solo viendolos pasar. Los
menores m6 y m7 son de prosa: se pueden arreglar en el mismo PR o dejarse anotados, y ninguno
condiciona el merge.
