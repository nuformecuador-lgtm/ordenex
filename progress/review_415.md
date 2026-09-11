# Revisión de la feature 415 — la orden dice su zona y lo que costó

**Rama:** `feat/415-zona-y-costo-por-orden-api` · **Cabeza revisada:** `ea8ae95c` · **PR:** #778 · **Base:** `dev` (`ca697141`)
**Fecha:** 2026-09-10 · **Rol:** reviewer (no edito código de producción ni `feature_list.json`)
**Worktree usado:** `.claude/worktrees/agent-ac6c27697d7cd589e` (el de la ficha, en `ea8ae95c` y limpio)

> **Nota de herramientas (regla 7 de `CLAUDE.md`).** El MCP `codebase-memory` **no estaba en mi
> conjunto de herramientas** en esta sesión, así que la búsqueda de código se hizo con `grep` y
> abriendo los archivos reales. Lo digo explícitamente, como manda el encargo. Para lo que esta
> revisión necesita —confirmar símbolos y líneas— da igual: el archivo real es la fuente, y el
> grafo, cuando miente, miente **de más**.

---

## VEREDICTO: **OK**

Ningún hallazgo bloqueante. Los 40 requisitos tienen un aserto que se pone rojo, las tres
propiedades que sólo puede afirmar Postgres se matan contra Postgres, el contrato `.ts` y su espejo
`.yaml` son **idénticos palabra por palabra** (comprobado mecánicamente, no a ojo), y las dos
verificaciones humanas que la ficha me delegaba (T10 y T11) están **hechas**.

El gate completo terminó con `INIT_EXIT=1`, pero **el único rojo no es de esta ficha**: está
medido, atribuido y reproducido en `dev` limpio. El detalle, con su causa exacta, en §4.

---

## 1. Checklist de `CHECKPOINTS.md`, punto por punto

### Especificación
- [x] `specs/415-zona-y-costo-por-orden-api/requirements.md` con EARS numerados `R1`…`R40`. Cero preguntas abiertas (las cinco cerradas por el humano y escritas como D2–D6).
- [x] `design.md` con alternativas descartadas **y su porqué**: nueve (A1–A9), incluida A9 —`zona` como cadena— que era la propuesta original del propio spec y que el humano rechazó.
- [x] `tasks.md`: **T0.1, T0.2, T0.3, T1…T13 todas `[x]`**. Ninguna casilla vacía.

### Trazabilidad
- [x] Cada `R<n>` mapea a al menos un test concreto. **Verifiqué los 40 uno a uno**; ver §2.
- [x] `progress/impl_415.md` contiene el mapa `R<n> -> test` (tabla de 40 filas, con archivo y nombre de caso).

### Calidad de código
- [x] `pnpm run typecheck` — **0 errores** (mi corrida: «typecheck paso»).
- [x] `pnpm run lint` — **0 errores**, 184 warnings preexistentes. Crucé la lista de archivos con warning contra los que toca la rama: sale uno solo (`api-pdf-etiqueta-service.test.ts`), y sus 4 warnings son de parámetros `_ordenId`/`_ownerId` que ya estaban en `dev`. La ficha **no introduce ni un warning nuevo**.
- [x] `pnpm test` — 27.646 verdes, 26 saltados, **1 rojo ajeno** (§4).
- [n/a] E2E: el repo no tiene harness de Playwright vivo y esta ficha es **backend puro sin pantalla** (ni auth, ni escritura, ni webhook: es lectura). El riesgo que un E2E cubriría —que el SQL no haga lo que el doble dice— lo cubre `tests/integration/db/costo-y-zona-api-415.test.ts` contra Postgres real, y lo comprobé matándolo (§3).

### Datos y seguridad
- [x] **Ninguna tabla nueva** => ninguna política RLS nueva que exigir. Confirmado: el diff no toca `db/schema.prisma` ni `db/migrations/`.
- [n/a] Migraciones reversibles: **no hay migración**. Los tres avisos de `down.sql` faltante del gate son deuda preexistente de tres migraciones de agosto, ajenas.
- [x] Ningún secreto hardcodeado. Barrí el diff entero buscando patrones de clave, token, contraseña, JWT y cadenas de conexión: sólo aparece la constante de test `SECRETO = "ordx_secretovivo…"`, que ya existía.
- [n/a] Webhooks: **no se toca ninguno**. El webhook `orden.estado_actualizado` queda declarado fuera de alcance en `requirements.md`, y el manual lo repite para el integrador.

### Patrón de capas
- [x] Controller sin queries ni lógica: los dos `route.ts` sólo cambian su **composition root** (construyen y **pasan** el `TarifaVigenteRepository`).
- [x] Service sin HTTP: `ApiOrdenLecturaService` recibe `Actor` y params; no toca `Request`/`Response`/headers.
- [x] Repository sólo queries: `toApiOrdenRow` mapea filas y **no deriva ni un importe**; la reconstrucción de la tarifa congelada reutiliza `tarifaDe` (`lib/utils/cierre-detalle.ts`), su única fuente. La alternativa de derivar ahí está descartada con motivo en design §10/A7.
- [x] Interfaces en `lib/interfaces/` por categoría: `ApiOrdenCosteoRow` y `ApiOrdenCongeladoRow` en `lib/interfaces/repositories/IOrdenRepository.ts`; los DTO públicos en `lib/types/api-orden.ts`.

### Permisos y multi-tenant
- [x] El `where` de la orden **no se toca**: `{ tiendaId: ownerId, deletedAt: null }` en el listado y `{ id, tiendaId: ownerId, deletedAt: null }` en el detalle, y hay un caso que lo afirma («415/R32: el where del listado y el del detalle NO cambian»).
- [x] Una orden ajena responde **404 igual que una inexistente**, y ni su zona ni sus importes se filtran (comprobado sobre el cuerpo serializado, buscando el importe inconfundible `7777.00` y el nombre `ZONA AJENA`).
- [x] `cierre_detail` se acota por su **`tienda_id` CONGELADO** (`where: { tiendaId: ownerId, … }`), no por el vivo de la orden.
- [x] `zona.id` se publica pero **no se acepta como entrada**: el resolutor de `{id}` sólo casa por `num_guia` o `num_remision`, y hay un caso que pide el detalle con el UUID de la zona y recibe 404.

### Multi-país / configuración
- [x] Sin país, moneda ni cuenta hardcodeados. Los cinco importes salen **sin símbolo de moneda y sin separador de miles**, con dos decimales y punto, y hay un aserto que lo comprueba carácter a carácter contra el dialecto money-safe del canal.

### Verificación final
- [~] `./init.sh` — **corrido entero por mí**, `INIT_EXIT=1` por **un rojo ajeno medido y atribuido** (§4). Los 27 archivos de la ficha, todos en verde.
- [x] `progress/review_415.md` — este archivo.
- [ ] **Falta la entrada en `progress/history.md`** — es el paso de cierre del leader, no del implementer. Hallazgo `menor` nº 1.

---

## 2. Trazabilidad: los 40 requisitos, verificados por mí

**Verifiqué los 40.** No me fié de la tabla: para 34 de ellos abrí el archivo y **leí el aserto**;
para los 6 restantes (R6, R23, R37, R38, R39, R40) la verificación es textual —contrato y
documentación— y la hice leyendo los textos publicados, que es exactamente lo que la ficha delega
en el reviewer.

Lo que fui a buscar en cada uno, y lo que encontré:

- **Ni una aserción contra su propia fuente.** Todos los importes esperados están escritos a mano
  con la aritmética anotada al lado; no hay un solo `expect` comparado contra el resultado de la
  función bajo prueba. Rehice las cuentas: 2500 x 13 % = 325,00; 25900 x 3,50 % = 906,50;
  906,50 x 13 % = 117,845 -> 117,85; 3000 x 13 % = 390,00; 1800 x 13 % = 234,00; y la contraprueba
  de la 204: 16618,40 x 3,50 % = 581,644 -> 581,64; 581,64 x 13 % = 75,6132 -> 75,61; suma
  **657,25** y no 657,26. Todas cuadran.
- **Ningún test verde por vacío.** `costo-y-zona-api-415.test.ts` **no contiene ni un
  `if (!algo) return;`**: si faltan FKs, usuarios, zonas o el estado del catálogo, **lanza**. Cada
  caso afirma primero que sembró (`filasDeDos === 2`, `filasDelSolicitado === 1`,
  `not.toBeNull()`), y los literales de consultas afirman además longitud mayor que cero, para que
  un espía que no se enganche no los deje verdes.
- **El 28 % (orden sin congelado) tiene su caso propio y poblado**: afirma `costoReal: null` **y**
  que `costoEstimado` sí trae los cinco conceptos, así que el `null` no puede venir de un montaje
  roto.
- **Los literales congelados son contrato, no polizón.** Los siete se **enmiendan** con bloque
  fechado y siguen siendo igualdades exactas de la lista entera. Lo medí: en los 23 archivos de
  test preexistentes que la rama toca, **cero casos borrados** (los conteos de casos sólo suben) y
  **una sola línea de aserto modificada**, la de `toHaveLength(9)` -> `toHaveLength(12)`, junto a su
  `toEqual` de la lista de tablas, que también se amplió entera. **Ni un `toEqual` degradado a
  `toMatchObject`** (el único `toMatchObject` nuevo de toda la rama está en un archivo nuevo y es
  aditivo).

---

## 3. Lo que el encargo me pidió comprobar a mí

### 3.1 El filtro por `aprobado` es LOAD-BEARING — confirmado, y la historia es la que dice el implementador

**El leader se equivocaba.** Abrí el archivo real:

- `tx.cierreDetail.createMany` está en **`lib/repositories/CierreDiaRepository.ts:942`**, dentro de
  **`async crearCierre(input: CrearCierreInput)`**, que abre en la **650** y cierra en la **984**
  (el método siguiente, `findCierresByMensajero`, empieza en la 994). Y `crearCierre` crea el
  `cierre_dia` con **estado `solicitado` por defecto**: la fila congelada nace **al SOLICITAR**.
- Es la **única** escritura de `cierre_detail` en `lib/`, `app/` y `scripts/`: el resto de
  coincidencias son `findMany`/`count` o declaraciones de tipo. Tampoco hay SQL crudo que la
  escriba.
- Y no es sólo mi grep: existe una guardia previa,
  `tests/unit/repositories/cierre-detail-inmutable.test.ts`, que **escanea `lib/`** y afirma que
  «el único camino de escritura del snapshot es el `createMany` de `crearCierre`». Eso cubre además
  **R30** (esta ficha no escribe dinero).

O sea: un cierre `solicitado` **ya tiene** su fila y un `rechazado` **la conserva**. Sin el filtro,
`costoReal` cambiaría **hacia atrás**. No es redundante.

**Reapliqué la mutación (M1) y la medí:**

```
BASE (sin mutar):  Tests  11 passed (11)

M1 — `where: { tiendaId: ownerId, cierre: { estado: "aprobado" } }`
   -> `where: { tiendaId: ownerId }`
   Tests  2 failed | 9 passed (11)
     x R26: una orden con cierre SOLICITADO trae `costoReal: null` — y su fila SI existe
     x R26: una orden con cierre RECHAZADO trae `costoReal: null`, y la fila NO se borro

RESTAURADO:        Tests  11 passed (11)   (y `git status` de `lib/` limpio)
```

**Dos rojos, exactamente los dos casos anunciados.** Y son los dos que **se siembran a mano**
porque hoy no existen en producción: sin esa siembra, el filtro no tendría quién lo matara.

### 3.2 El coste: lo medí yo, no lo leí

Escribí un test temporal propio (`tests/integration/db/zzz-review415-medicion.test.ts`, **borrado
después**; el árbol quedó limpio) que siembra **30 órdenes de un owner sin órdenes previas**, en
**DOS zonas distintas**, **10 de ellas con fila congelada**, y mide con el espía de consultas
dentro de una transacción revertida:

| Lectura | Consultas medidas | Tablas, en orden |
|---|---|---|
| Listado `limit=1` | **8** | `orden`, `order_status`, `usuario`, `zona`, `distrito`, `cierre_detail`, `orden` (count), `tarifas` |
| Listado `limit=5` | **8** | idéntico |
| Listado `limit=50` (**30 ítems**) | **8** | idéntico |
| Detalle, en el **repositorio** | **12** | las 12 del literal congelado |
| Detalle, **de punta a punta por el service** | **13** | las 12 **+ `tarifas`** |

Conclusiones, que es lo que el encargo quería:

- **El 4->8 del listado NO esconde ningún N+1.** El conjunto de consultas es **exactamente el
  mismo** con 1, 5 y 30 ítems, con dos zonas distintas en la misma página y con órdenes que tienen
  y que no tienen fila congelada. El `take: 1` de la relación anidada lo aplica Prisma **por fila
  padre**, y `resolveTarifas` se llama **una vez** con los pares distintos. La invariante que
  importa —no depende del tamaño de la página, ni del número de zonas, ni de cuántos cierres tenga
  cada orden— **se conserva y está congelada por nombre de tabla** en dos literales (listado y
  detalle), así que una relación de más se pone roja **diciendo cuál es**.
- **Matiz que hay que decir en voz alta:** el «9 -> 12» del PR y de la bitácora es el número **del
  repositorio**. De punta a punta el detalle pasa de **9 a 13**, porque el service añade su consulta
  de `tarifas`. El `design.md` §7 lo dice bien («de 9 a **12** consultas **+ 1 de tarifas**»); es el
  resumen el que redondea. Hallazgo `menor` nº 2.

### 3.3 `API_ORDEN_SELECT` -> `apiOrdenSelect(ownerId)`: la propiedad se conserva de verdad

La constante existía para que listado y detalle **no pudieran divergir**. Ahora es una función, y
esa propiedad **está afirmada por un caso ejecutable**, no prometida en un comentario:
`orden-repository.api-lectura.test.ts` -> «415/design §5.1: el detalle NO puede divergir del
listado» recorre **cada clave** del `select` que llega a `findMany` y exige que el `select` que
llega a `findFirst` tenga **la misma clave con el mismo valor** (igualdad profunda), y además que
el `ownerId` que llega a los dos `where` del congelado sea el mismo.

**Lo maté para comprobar que muerde:** añadí al `apiOrdenDetalleSelect` una `zona` propia (sin
`esCentral`) después del spread. Resultado:

```
x 415/design §5.1: el detalle NO puede divergir del listado — misma proyeccion, misma fuente
x envia a Prisma exactamente la misma proyeccion que antes de la feature 177   (SELECT_DETALLE_106)
Tests  2 failed | 33 passed (35)      -> restaurado: 35 passed (35)
```

Dos asertos independientes lo cazan. La propiedad está garantizada.

### 3.4 Los 22 tests enmendados — son derogaciones legítimas, ninguna aflojada

Son **23** archivos preexistentes (la bitácora rotula «18» y lista 22: hallazgo `menor` nº 5,
cosmético). Los comparé nombre de caso a nombre de caso, como se hizo con la 409:

- **Cero casos borrados.** Los conteos por archivo van 13->13, 15->23, 20->28, 8->8, 12->12, 6->8,
  20->20, 26->26, 7->7, 16->28, 8->18… **ninguno baja**.
- **Una sola línea de aserto modificada** en toda la rama: `toHaveLength(9)` -> `toHaveLength(12)`,
  y va acompañada del `toEqual(CONSULTAS_DEL_DETALLE)` con **las doce tablas nombradas una a una**
  y con las tres nuevas marcadas. Eso es enmendar un contrato, no aflojarlo.
- Los **cuatro congeladores de claves** (servicio, detalle, listado HTTP, detalle HTTP) pasan de
  10->13 y 12->15 **siguiendo siendo igualdades de la lista entera, ordenada**. Un campo colado por
  un spread sigue poniéndolos rojos y diciendo cuál.
- `openapi-404-mensajero` (el `required`) y `openapi-405-gestiones` (las `properties`) se enmiendan
  con su bloque fechado, y el de la 405 **sigue afirmando lo que la 405 se comprometió a no tocar**:
  que `gestiones` no se cuela en el ítem.
- `SELECT_DETALLE_106` se **enmienda** copiando el `select` real columna a columna —incluidos el
  `where`, el `orderBy` y el `take` del congelado— y **no** se sustituye por una comparación contra
  la constante de producción, que sería tautológica. Lo comprobé matándolo (§3.3): muerde.
- Los dos tests de aislamiento que el design declara intocables (`filtros-scope-ajeno`,
  `tienda-destino-aislamiento`) **conservan su alcance**: lo único que cambió en el segundo es la
  fixture del doble y el tercer argumento del constructor.
- `mensajero-forma-unica.guardia.test.ts`: su detector casa por **nombre**, no por forma, así que
  `ApiZonaDTO` —mismo par de claves, otro nombre— no lo hace caer en falso. **Su alcance no se
  tocó.**
- `api-mensajero-dto.test.ts`: las tres fixtures ganan los tres campos **para que cada
  `@ts-expect-error` siga midiendo lo que decía** (que falta `mensajero`) y no «faltan cuatro
  cosas, vaya usted a saber cuál». Es el cuidado correcto.

**Juicio: las 23 enmiendas son derogaciones justificadas y fechadas. Ninguna es un aserto aflojado.**

### 3.5 La asimetría `null` frente a los cinco `"0.00"` — implementada y explicada en tres sitios

- **Implementada:** `costoEstimadoDe(null, …)` devuelve `null`; `costoRealDe(null, …)` devuelve
  cinco `"0.00"`. El hueco de la **fila** (la orden que no entró en ningún cierre) lo resuelve el
  llamador con `costoReal: null`. Y `tarifaDe()` devuelve `null` exactamente cuando
  `cierre_detail.tarifa_id IS NULL`, que es lo que hace que el cero afirmado salga completo.
- **Explicada, y las dos mitades JUNTAS**, que es lo que impide leerlas como una inconsistencia:
  en `lib/utils/api-orden-costo.ts` (las dos funciones, una debajo de la otra, con el porqué de
  cada una), en la cabecera de `ApiOrdenListItemDTO.costoReal` (asimetría deliberada, «no es una
  inconsistencia») y en el CHANGELOG y el manual, con la frase «esto **sí** es un cero de verdad».
- **Y probada en el mismo bloque**: `api-orden-costo.test.ts`, caso «R22+R28: LA ASIMETRIA — el
  estimado sin tarifa es null; el real son cinco 0.00», los dos en el mismo caso, a propósito.
- **La quinta superficie** entra en `asimetria-sin-tarifa.test.ts` corriendo contra el **mismo**
  `TABLA_TARIFAS`, el **mismo** doble de `prisma.tarifa.findMany` y el `TarifaVigenteRepository`
  **real** que las otras cuatro, con su **contraprueba** (añadida la fila del par, salen los cinco
  conceptos con importes a mano). La cabecera pasa de cuatro a cinco superficies explicando por qué
  ésta no puede devolver 409.

### 3.6 T10 — equivalencia palabra por palabra entre el `.ts` y el `.yaml`: HECHA, 0 diferencias

No la hice a ojo. Extraje de `lib/api/openapi-spec.ts` **todas** las `description` —las de una sola
línea y las **12 multilínea** construidas uniendo un array— y comprobé que **cada texto aparece
literal** en `docs/api/api-key-openapi.yaml` tras deshacer el escapado de comillas:

```
IGUAL  len=677  [Item público de una orden propia: sin ids internos...]
IGUAL  len=226  [La ZONA DE LA ORDEN: a dónde va el paquete. NO ...]
IGUAL  len=221  [Identificador ESTABLE de la zona: un UUID en TEXTO...]
IGUAL  len=296  [Nombre de la zona tal y como está en el catálogo (...]
IGUAL  len=236  [Los CINCO conceptos que Ordenex factura por una or...]
IGUAL  (las 5 descriptions de los cinco conceptos)
IGUAL  bloque 15 lineas [Lo que costaría este paquete con la tarifa VIGEN...]
IGUAL  bloque 13 lineas [Lo que se CONGELO al cerrar: la tarifa y los dat...]
IGUAL  bloque 19 lineas [Mensajero ASIGNADO a la orden... (con la clausula nueva)]
...y los 12 bloques del archivo entero
FALLOS TOTALES: 0
```

Y contrasté a mano lo **estructural**, que no es texto: el `required` del ítem gana `zona`,
`costoEstimado` y `costoReal` **en el mismo orden** en los dos; `zona` es una referencia **pelada**
(sin `null`) en los dos; los dos costos son un `oneOf` de la referencia o `null` en los dos; `Zona`
y `OrdenCosto` tienen las mismas `properties`, el mismo `required` y `additionalProperties: false`
en los dos, y están en la **misma posición** del documento (entre `OrdenListItem` y `Pagination`),
que es lo que hace que el orden de claves del ítem publicado no se mueva.

La única diferencia entre los dos archivos está en un **comentario** (el `.yaml` condensa en dos
líneas el bloque que el `.ts` escribe en cinco). No es contrato publicado. **T10: conforme.**

### 3.7 T11 — el diff del manual: HECHO, sin ningún criterio de `grep`

Leí el diff entero de `docs/api/manual-metricas-por-mensajero.md`. Los cinco puntos están:

1. **La «Corrección del 2026-09-10» está reescrita, no borrada.** Dice las tres cosas en orden:
   que la instrucción original era falsa **cuando se escribió**, que **desde esta fecha es cierta**,
   y **por qué se deja escrito el recorrido entero** (quien leyó la corrección tiene que poder
   saber que ya no aplica). Eso es lo que R40 pedía y lo que un borrado habría roto.
2. La tabla «qué gana cada superficie» está actualizada, y **gana una fila que no le pedían**: el
   aviso de que **el webhook NO gana ni zona ni costo**, con el porqué (su cuerpo va firmado) y con
   la salida práctica (pedirlo por el detalle con su `numGuia`). Es la clase de frase que evita un
   ticket.
3. La regla nº 1 cubre ahora **las dos** entidades con nombre **en una sola frase**, con el ejemplo
   del renombrado de «FGAM El Coco» a «FGAM Coco», y diciendo por qué comparten forma.
4. El caso de uso **«Margen por paquete y por zona»** está completo: ítem de ejemplo con las trece
   claves, cómo se calcula el margen, **por qué no hay campo de total**, la tabla de por qué son
   dos campos, cuándo es `null` cada uno, el cero de verdad de `costoReal`, el escenario de entrega
   con el remite a la cotización, y **qué no se puede hacer** (ni filtrar ni ordenar; `zona.id` no
   es identificador de orden).
5. «Qué NO se publica de un mensajero» **conserva la palabra zona** y gana la aclaración de que es
   **la suya**.

Y el aviso a clientes con **validación estricta de esquema** está en los **dos** textos, como pide
R40: en el CHANGELOG arriba del todo, y en el manual en la línea 34, colocado **justo después** de
la tabla que ya enumera los tres campos nuevos, así que los cubre. **T11: conforme.**

### 3.8 T12 — el aviso: escrita no es enviada

`docs/api/CHANGELOG.md` abre con **UNA sola entrada fechada** para las dos partes, con los ocho
puntos mínimos, la lista de los ocho valores de zona, las dos frases que no pueden faltar y el
aviso de esquema estricto. Está **escrita y commiteada**. **Mandarla sigue pendiente y bloquea la
release, no el merge**, y así está declarado en la ficha y en la bitácora. Lo dejo anotado aquí
para que no se pierda entre el merge y el despliegue.

---

## 4. El gate: dos corridas, y el único rojo tiene nombre y dueño

**Corrí `./init.sh` COMPLETO yo mismo**, con el log a archivo y `INIT_EXIT` escrito **dentro** del
log. **Y la trampa se repitió**: la herramienta me notificó el comando como «completed (exit code
0)» mientras el log decía `INIT_EXIT=1`. Si hubiera mirado el exit code del proceso, habría dado
por verde un gate rojo.

```
 Test Files  1 failed | 1904 passed (1905)
      Tests  1 failed | 27646 passed | 26 skipped (27673)
   Duration  686.01s
typecheck paso
184 problems (0 errors, 184 warnings)
DATABASE_URL resuelta: los 160 archivos de tests contra Postgres SI se ejecutan
ROJOS NUEVOS (1 archivo(s) que no estan en el baseline):
  - tests/integration/db/notificacion-evento-bloqueo-cierre-migration.test.ts
INIT_EXIT=1
```

**Lo que el log SI respalda de la bitácora, comprobado en mi propia corrida:**

- **245 archivos de `tests/integration/db/` se ejecutaron** (244 en verde y el rojo), y el `grep`
  del símbolo de salto sobre el log entero devuelve **0**: ninguno saltado.
- Los **26 tests saltados** están en **exactamente dos archivos de frontend ajenos**:
  `AnaliticaPage.test.tsx` (17) y `AnaliticaShell.test.tsx` (9). Ni uno en `integration/db`.
- **T7 EJECUTO**: `tests/integration/db/costo-y-zona-api-415.test.ts (11 tests) 2644ms`, en verde.
- Los **27 archivos de la ficha aparecen todos en verde**, con los mismos conteos que la bitácora
  declara (29 casos de OpenAPI, 28 del repositorio, 23 y 31 en los dos bordes HTTP, 11 de la
  guardia, 12 del módulo puro, 13 de los tipos, 8 de la asimetría, 12 del coste de la 405).
- El total coincide con el de la bitácora salvo por el rojo: 27.646 + 1 = **27.647**, 26 saltados,
  27.673 en total.

**El rojo, medido y atribuido (no supuesto):**

| Qué comprobé | Resultado |
|---|---|
| Re-correr el archivo **aislado** en la rama 415 | **Rojo igual** — no es contención ni un flake de saturación |
| Correr **el mismo archivo en `dev` limpio** (checkout principal, `ca697141`, misma base) | **Rojo idéntico, mismo error** |
| La rama toca migraciones, el enum o notificaciones? | **No.** `db/migrations/` y `db/schema.prisma` intactos; el diff no roza `notificacion` |
| La rama va detrás de `dev`? | **Un commit**, `ca697141`, y sólo toca `feature_list.json` |
| Migraciones en el árbol de la rama y en `dev` | **190 y 190**: idénticas |
| Causa | **Otro worktree**: `feat/410-notificaciones-push` tiene **192** migraciones y la suya, `20260912120000_push_suscripcion`, **crea una columna `evento` de tipo `notificacion_evento NOT NULL`**. Aplicada a la base local compartida, esa columna **depende del tipo**, así que el `down.sql` histórico de la 271 ya no puede soltar el tipo renombrado a `_old`, y Postgres responde `2BP01` |

Es, palabra por palabra, el fallo conocido de **base local compartida**: la migración de una ficha
pone rojo el gate de las demás. **No es de la 415 y no se arregla en la 415.** Queda para el leader
(§6), y afectará a cualquier otro agente que corra el gate completo hasta que se resuelva.

---

## 5. Hallazgos

Ninguno bloqueante.

1. **`menor` — falta la entrada en `progress/history.md`.** `CHECKPOINTS.md` la exige para pasar a
   `done`. Es el paso de cierre del leader; lo anoto para que no se caiga.
2. **`menor` — el «9 a 12» del PR y de la bitácora es el número del REPOSITORIO; de punta a punta
   el detalle pasa de 9 a 13** (las 12 más la consulta de `tarifas` del service). El `design.md` §7
   lo dice bien; conviene que el resumen no lo redondee, porque el número que verá quien mire los
   logs de producción es 13.
3. **`menor` — el conteo del detalle está congelado sólo a nivel de repositorio.** Los dos literales
   (`CONSULTAS_DEL_DETALLE` en la 405 y en la 415) miden `findDetalleByOrdenIdForOwner`, no
   `detallePorOrdenId`. El listado sí está congelado a nivel de service —que es donde un N+1 sería
   posible—, así que el riesgo real es bajo: el detalle es un solo ítem. Lo digo por si alguien
   añade mañana una resolución por gestión en el service del detalle: ahí no habría literal que lo
   cazara.
4. **`menor` — `costo-y-zona-api-415.test.ts` depende del catálogo local.** Toma las dos primeras
   zonas por nombre ascendente y su aritmética esperada (flete GAM 2500,00) da por hecho que la
   primera es **central**. Lo medí: en esta base son `GAM (esCentral=true)` y `Guanacaste (false)`,
   así que pasa. En una base cuya primera zona alfabética no fuera central, el test se pondría
   **rojo** —que es la dirección segura, no la silenciosa—, pero por un motivo que no es el que
   mide. Forzar `esCentral` en la siembra lo dejaría cerrado.
5. **`menor` — cosmético:** la bitácora rotula «Tests existentes enmendados (18)» y la tabla lista
   22; los archivos preexistentes tocados son **23**.
6. **Recordatorio, no hallazgo:** **T12 bloquea la release.** La entrada del CHANGELOG *es* el
   aviso y hay que **mandarla** antes de desplegar, en particular a quien valide esquema en
   estricto.

---

## 6. Para el leader, antes de mergear

1. **El rojo de `notificacion-evento-bloqueo-cierre-migration` es de `dev` más la base local, no de
   la 415**, y **no está en `tests/baseline-rojos.json`**. Hoy deja rojo el gate completo de
   cualquier agente. Decide qué toca: registrar el rojo con su motivo, arreglar el `down.sql` de la
   271 para que contemple la tabla nueva, o esperar a que la 410 entre y se resuelva sola. **Nada de
   esto es trabajo de la 415.**
2. La rama va **un commit** por detrás de `dev` (`ca697141`, sólo `feature_list.json`). El pre-vuelo
   caduca: vuelve a comparar con `origin/dev` justo antes de abrir el merge.
3. Tras el merge, corrida completa de `./init.sh` sobre `dev` en segundo plano, como manda la regla
   5 — con el `INIT_EXIT` **dentro** del log, que hoy me volvió a hacer falta.

---

**Veredicto final: `OK`.**
