# Review — Ficha 366: la zona estampada en la orden no sigue a la configuracion de zonas

> Reviewer. Rama `fix/366-zona-orden-desactualizada`, HEAD `615c4a4a` (merge de `origin/dev`).
> Diff revisado: `git diff origin/dev...HEAD` (26 archivos). El merge trae la ficha 368 ajena; queda
> FUERA de esta revision por encargo explicito y no se cuenta como hallazgo.
> Contrastado contra `specs/366-zona-orden-desactualizada/{requirements,design,tasks}.md`,
> `CHECKPOINTS.md`, `AGENTS.md`, `docs/architecture.md`, `docs/conventions.md`.
> Herramienta: el MCP `codebase-memory` SI estaba disponible (proyecto
> `R-job-singularis-projects-ordenex`); se uso para localizar implementaciones de `IZonaRepository`
> y se confirmo cada simbolo en el archivo real (el indice devolvia `ZonaRepository.update` en las
> lineas 168-204, que ya no son las suyas: hoy empieza en la 195).

---

## VEREDICTO: **RECHAZADO**

**Y conviene leer por que, porque no es por el codigo.** La implementacion es correcta y esta
medida: los 14 requisitos tienen un test que los ejercita de verdad, el corte de elegibilidad es
EXACTAMENTE el aprobado por el humano, el `UPDATE` toca solo `zonaId`, `cierre_detail` no se toca,
la migracion va sola y ningun `down.sql` anterior se movio. **Corri 215 tests de esta ficha y de
sus vecinos y todos pasaron**, incluidos los 17 contra Postgres real.

El rechazo es por **dos entregables del arnes que no existen en disco**: la bitacora
`progress/impl_366-*.md` (obligatoria por `AGENTS.md:149` y por el checkpoint de Trazabilidad) y
`specs/366-zona-orden-desactualizada/tasks.md` con sus casillas marcadas. **No hace falta tocar ni
una linea de codigo para que esto pase a OK.**

- Hallazgos **BLOQUEANTE**: 2 (los dos de proceso; cero de codigo).
- Hallazgos **menor**: 6.

---

## Checklist de `CHECKPOINTS.md`, punto por punto

### Especificacion
- [x] `requirements.md` con R1-R14 en EARS numerados.
- [x] `design.md` con alternativas descartadas y su porque (S1-A/B/C, S2-C/D, S6 `UPDATE ... RETURNING`;
      tabla resumen en S10).
- [ ] **`tasks.md` con todas las tasks marcadas `[x]`** — 0 de 30 casillas marcadas. Ver B2.

### Trazabilidad
- [x] Cada `R<n>` mapea a al menos un test concreto que lo ejercita (tabla abajo; abri los 11
      archivos de test, no solo sus nombres).
- [ ] **`progress/impl_366-*.md` con el mapa `R<n> -> test`** — el archivo NO EXISTE. Ver B1.

### Calidad de codigo
- [x] `pnpm test` sobre los 11 archivos de la ficha y sus vecinos: **215 passed, 0 failed**.
- [~] `typecheck` / `lint`: NO los corri yo — el gate completo lo esta corriendo el humano en
      paralelo y duplicar carga produce rojos falsos en esta maquina (instruccion explicita del
      encargo). El diff toca `db/schema.prisma`, `db/migrations/**` y `lib/types/**`, asi que
      `init.sh --rapido` se niega solo y exige el completo: correcto que sea el completo el que corra.
- [x] E2E: no aplica. Esta ficha no toca auth/pagos/recaudo/ingesta/webhooks, y el repo no tiene
      harness E2E ejecutable.

### Datos y seguridad (Supabase)
- [x] Ninguna tabla nueva, asi que no hay RLS que activar. `historial_accion` conserva su RLS
      habilitada sin policies (ficha 362); un valor de enum no la altera.
- [x] Migracion versionada y reversible: `db/migrations/20260903120000_historial_accion_orden_zona_reconciliada/`
      tiene `migration.sql` (UP) y `down.sql` (DOWN). Ver "lo que salio bien", punto 5.
- [x] Cero secretos. Cero hardcode de pais/moneda/cuenta.
- [x] Webhooks: no aplica (no hay ninguno nuevo).

### Patron de capas
- [x] Controller (`lib/actions/zonas.ts`) sin queries ni logica: reenvia el resultado del service.
- [x] Service (`lib/services/ZonaService.ts:108-119`) sin HTTP; transporta el conteo y el actor.
- [~] Repository: el corte de elegibilidad vive en `ZonaRepository.update`. Ver m5 (menor, con
      precedente y razon documentada).
- [x] Interfaces en `lib/interfaces/{repositories,services}/`.

### Permisos
- [x] Sin cambio de autorizacion: sigue siendo `maestro`-only (`esMaestro`, `ZonaService.actualizar`).
- [x] Mutacion por Server Action, no por ruta API.

### Multi-pais / configuracion
- [x] Nada hardcodeado.

### Verificacion final
- [ ] `./init.sh` en verde: **no verificado por mi** (lo corre el humano; ver arriba).
- [x] Este archivo existe.
- [ ] Entrada en `progress/history.md`: pendiente (paso de cierre del leader, F2.6).

---

## Trazabilidad R -> test (verificada abriendo cada archivo, no por el nombre)

Rutas abreviadas: **INT** = `tests/integration/db/zona-reconciliacion-ordenes.test.ts`;
**UNIT** = `tests/unit/repositories/zona-repository.test.ts`;
**CMP** = `tests/components/CrearZonaFormReconciliacion.test.tsx`.

| R | Que exige | Test que lo prueba | Veredicto |
| --- | --- | --- | --- |
| R1 | Re-derivacion automatica al guardar, sin accion aparte ni paso intermedio | INT:231 (una sola llamada a `update` y la orden ya cambio de zona) + CMP:121 (un solo click en Guardar, sin dialogo intermedio) | CUBIERTO |
| R2 | Distrito con exactamente 1 zona = esa es la correcta | INT:231; UNIT:451 | CUBIERTO |
| R3 | 0 o mas de 1 zonas = no mueve nada | INT:261 (cero zonas) y INT:286 (dos zonas a la vez); UNIT:556, que ademas afirma que ni siquiera se consulta `orden` | CUBIERTO |
| R4 | Orden elegible con zona distinta = se actualiza en el mismo guardado | INT:231 | CUBIERTO |
| R5 | Union de los distritos de ANTES y los de DESPUES | INT:470 (misma lista de distritos: auto-curacion de la deriva vieja) y INT:493 (distrito recien quitado, sus ordenes se van a B sin guardar B); UNIT:578 (la 2a lectura de la N:M pide los 3 distritos, sin repetidos) | CUBIERTO |
| R6 | El corte: borrada / con `cierre_detail` / con gestion vigente `entregada`, `rechazada` o `incidente` | INT:314 (facturada), INT:352 `it.each` sobre los TRES no elegibles, INT:384 `it.each` sobre `reprogramada` y `devuelta` SI elegibles, INT:414 (gestion anulada SI elegible), INT:437 (orden borrada). Ocho casos contra Postgres real | CUBIERTO |
| R7 | Inelegible = sin cambios y SIN fila de historial | INT:346 y INT:379 (el historial de esa orden queda vacio) | CUBIERTO |
| R8 | `cierre_detail` intacto | INT:348: la fila ENTERA capturada antes y despues y comparada con `toEqual`; ademas la guardia estatica `tests/unit/guards/zona-reconciliacion-no-retarifa.guardia.test.ts:152` | CUBIERTO |
| R9 | Solo `zonaId`, ningun otro campo de la orden | INT:550: diff de la fila COMPLETA, que da exactamente `["updatedAt","zonaId"]`; UNIT:466 (`data` comparado con `toEqual({ zonaId })`); la guardia estatica revienta si ese `data` gana una clave | CUBIERTO (el mas fuerte de los 14) |
| R10 | Fila con quien, cuando y que orden; SIN datos de cliente ni zona vieja/nueva | INT:253-258 (una fila, `valorAnterior` y `valorNuevo` NULL); UNIT:504 (etiqueta = guia, o remision si no hay guia; `monto` NULL; actor congelado `u-maestro` / `Maestra Uno` / `maestro`); la guardia `historial-accion-sin-datos-cliente` incluye `lib/repositories/ZonaRepository.ts` en `PUNTOS_DE_ESCRITURA`, asi que el bloque nuevo de `appendAccion` queda barrido | CUBIERTO (ver m3) |
| R11 | Un lote por guardado, distinguible del de otro | INT:493 (dos zonas resueltas en un guardado, un solo `loteId`) y INT:526 (dos guardados, dos lotes: es la mitad que caza un lote constante); UNIT:504 | CUBIERTO |
| R12 | Informar cuantas ordenes cambiaron, en la misma respuesta | UNIT:471 y UNIT:487 (cuenta filas alcanzadas, no distritos ni grupos); `tests/unit/services/zona-service.test.ts:158`; `tests/integration/actions/zonas-action.test.ts:132` (reenvia 12 y las claves del resultado son exactamente `status`, `zona`, `ordenesReconciliadas`); CMP:121, CMP:139, CMP:157 | CUBIERTO (ver m4) |
| R13 | `create()` no reconcilia | UNIT:596, que afirma que `create` NO llama a `zonaDistrito.findMany`, `orden.findMany`, `orden.updateMany` ni `historialAccion.createMany`. ESTE es el que sostiene R13; INT:576 es debil (ver m2) | CUBIERTO por el unit |
| R14 | Idempotencia: cero, y sin filas nuevas | INT:600 (dos `update` seguidos dan 1 y luego 0, y el historial se queda en una fila); UNIT:585 | CUBIERTO |

Ningun mapeo es falso y ningun test de la tabla mide el vacio: **cada exclusion trae una orden
anti-vacuidad en el MISMO distrito que si se reconcilia** (INT:343, INT:377, INT:462), de modo que un
`WHERE` que no encontrara nada pondria el caso en ROJO en vez de dejarlo verde por la razon
equivocada. Es justo el antidoto de la cicatriz del `if (!datos) return;`.

---

## Hallazgos

### BLOQUEANTE

**B1 — No existe `progress/impl_366-zona-orden-desactualizada.md`.**
`AGENTS.md:149` obliga al implementer a dejar ahi los archivos tocados, el mapa `R<n> -> test` y la
salida de los tests, y `CHECKPOINTS.md` lo repite en Trazabilidad. Comprobado que no es un despiste
de commit: `git log --all --diff-filter=A -- "progress/impl_366*"` no devuelve nada y `git status`
esta limpio, asi que el archivo no existe ni tracked ni untracked. Coste real, no formal:
`AGENTS.md:94` dice que el leader consulta ese archivo para evaluar conflictos con otras features en
curso, y hoy no hay nada que consultar. **Que falta:** escribirlo con el mapa R -> test (la tabla de
arriba sirve de base), los archivos tocados y la salida de la corrida. Vuelve al implementer.

**B2 — `specs/366-zona-orden-desactualizada/tasks.md`: 0 de 30 casillas marcadas `[x]`.**
Checkpoint explicito ("todas las tasks estan marcadas `[x]`"). Aqui NO aplica la indulgencia que se
uso en la ficha 368: aquella `tasks.md` no usa casillas en absoluto (convencion "Hecho cuando"), y
esta SI las usa (`specs/366-zona-orden-desactualizada/tasks.md:11,13,17,19,30,...`) y las deja todas
vacias. En el repo hay 145 specs con casillas marcadas, asi que la convencion existe y esta se salto.
**Que falta:** marcar lo hecho; y si alguna task quedo fuera, decir cual y por que. Para el registro:
T8 estaba declarada opcional y SI se hizo (la guardia existe y es solida).

### menor

**m1 — La corrida contra Postgres se salta entera sin `DATABASE_URL`, y el gate sigue verde.**
`tests/integration/db/_postgres-real.ts:32` y `zona-reconciliacion-ordenes.test.ts:41`
(`HAY_BASE_DE_DATOS ? describe : describe.skip`). Es la convencion del repo, y el `beforeAll` SI
revienta con un mensaje util cuando hay base pero falta la semilla (`:88-101`), que era lo que el
encargo pedia comprobar: bien resuelto. Pero **este worktree no tiene `.env`**, asi que aqui los 17
casos se saltan y nada lo grita. Lo verifique cargando el `.env` del repo principal en el entorno del
proceso (sin escribir nada en el arbol) y entonces los 17 corrieron y pasaron. Consecuencia practica:
**un gate verde solo demuestra el corte si esa corrida tenia base**. Si el gate completo se lanza
desde un entorno sin `DATABASE_URL`, la parte que de verdad mide el `WHERE` no se ejecuto. No es
defecto de esta ficha (es del andamio compartido), pero cambia como hay que leer su verde.

**m2 — El caso R13 de integracion no puede ponerse en rojo.**
`tests/integration/db/zona-reconciliacion-ordenes.test.ts:576-598`: siembra un distrito que ya estaba
en la zona B y luego crea una zona NUEVA con ese mismo distrito, con lo que el distrito acaba en DOS
zonas. Si `create()` empezara a reconciliar manana, el colapso 1/0/mas-de-1 devolveria `null` por
ambiguedad y el test **seguiria verde**: mide R3, no R13. La proteccion real de R13 es
`tests/unit/repositories/zona-repository.test.ts:596`. Arreglo concreto si se quiere cerrar: sembrar
el distrito con CERO zonas previas y una orden con zona A, para que tras el `create` resuelva
exactamente la zona nueva.

**m3 — En Postgres real no se comprueba quien firma la fila.**
El helper `historialDe` (`zona-reconciliacion-ordenes.test.ts:211-215`) selecciona solo `entidadId`,
`loteId`, `valorAnterior` y `valorNuevo`. El "quien guardo" de R10 (`actorUsuarioId`, `actorNombre`,
`actorRol`) y el `monto` NULL solo se afirman con dobles (`zona-repository.test.ts:504`). La cadena
del actor la segui yo a mano de punta a punta (punto 3 de la seccion siguiente), asi que no queda un
agujero abierto; es una asercion barata que no esta.

**m4 — El toast decide por `mode`, no por la accion que corrio.**
`app/(app)/configuracion/tarifas/_components/CrearZonaForm.tsx:96` (`esEditar = mode === "editar"`) y
`:440-448` (`mensajeGuardado`). Si el usuario esta en modo crear y pulsa Guardar dos veces, la segunda
llamada YA es `actualizarZona` (`:253`, porque `zonaIdGuardada` quedo fijado en `:261`) y puede traer
`ordenesReconciliadas > 0`, pero el mensaje sera "Zona creada" y el conteo se pierde en silencio.
R12 habla de la RESPUESTA, y la respuesta si lo trae (medido en `zonas-action.test.ts:132`), y
`design.md S5.4` dice literalmente "en modo editar": la implementacion respeta el diseno. Lo dejo
escrito porque es el unico camino por el que un conteo real no llega al ojo humano.

**m5 — El corte de negocio vive en el repositorio.**
`lib/repositories/ZonaRepository.ts:241-336`: la union de distritos, el colapso, la elegibilidad y el
conteo. `docs/architecture.md:59-61` pide "Repository: solo Prisma queries, sin logica de negocio".
No lo trato como bloqueante ni pido moverlo: `design.md S6` justifica que tiene que ocurrir DENTRO de
la `$transaction` que ya existia (o se guarda la zona y se reconcilian sus ordenes, o no ocurre
ninguna de las dos), y el repo ya tiene ese patron vivo en `OrdenRepository.corregirDatosCliente` y
en las llamadas a `appendAccion` desde repositorios (ficha 362). Sacarlo al service romperia la
atomicidad, que es la propiedad que sostiene R8 y R10.

**m6 — Sin tope de tamano del lote, dentro de una transaccion con presupuesto de 5 s.**
`lib/repositories/ZonaRepository.ts:290-331`: `orden.findMany` sin `take`, `updateMany` con
`id: { in: [...] }`, y `appendAccion` -> `historialAccion.createMany` sin trocear
(`lib/repositories/registrar-accion.ts:60`), todo dentro del `$transaction` de `update`, que no
declara opciones (`lib/db/prisma-client.ts:93` no fija `transactionOptions`, asi que rige el default
de Prisma: 5 000 ms). Con los numeros medidos en produccion (42 ordenes) esto es irrelevante, y el
filtro `cierreDetalles: { none: {} }` acota el universo a ordenes sin cerrar. Pero el techo duro
existe y conviene tenerlo escrito: `historial_accion` son 12 columnas por fila, o sea unas 5 460
filas por sentencia antes de topar con el limite de 65 535 parametros de Postgres; por encima de eso
el guardado de la zona fallaria entero. No es regresion (es el mismo patron de los borrados por lote
de la 362) y no pido cambiarlo.

---

## Lo que comprobe y salio bien

1. **El corte de elegibilidad es EXACTAMENTE el aprobado**, leido linea a linea en
   `lib/repositories/ZonaRepository.ts:290-303`: `deletedAt: null`, `cierreDetalles: { none: {} }`,
   `gestiones: { none: { anuladaAt: null, resultado: { in: [entregada, rechazada, incidente] } } }`
   y `zonaId: { not: zonaResueltaId }`. Ni un predicado de mas ni de menos. `reprogramada` y
   `devuelta` NO excluyen —que es la enmienda del humano— y hay dos casos que se pondrian en rojo si
   alguien lo "corrigiera" de vuelta a "toda gestion vigente" (INT:384).
2. **El `WHERE` esta medido contra Postgres real, y lo ejecute yo**: los 17 casos de
   `tests/integration/db/zona-reconciliacion-ordenes.test.ts` corrieron y pasaron en 2,59 s tras
   cargar `DATABASE_URL` en el entorno del proceso. Ninguno quedo `skipped`. La cabecera del archivo
   (`:27-33`) documenta las SEIS mutaciones probadas a mano y a que caso tumba cada una; verifique
   por lectura que las seis tienen una asercion que efectivamente se voltearia: quitar el
   `resultado: { in: [...] }` deja `reconciliadas` en 0 en INT:409; quitar `cierreDetalles: { none: {} }`
   la sube a 2 en INT:344; quitar `anuladaAt: null` tumba INT:414; quitar el valor `incidente` tumba
   la tercera vuelta de INT:352; cambiar `zonaId: { not: ... }` por `undefined` tumba INT:600; y usar
   solo `data.distritoIds` en vez de la union tumba INT:493. **No ejecute yo las mutaciones**, a
   proposito: el gate completo del humano corria sobre este mismo arbol, y mutar un fuente durante un
   gate invalida su veredicto (leccion ya pagada en este repo).
3. **El composition root inyecta de verdad, no solo importa.** Segui la cadena entera en los archivos
   reales: `CrearZonaForm.tsx:254` -> `lib/actions/zonas.ts:117-134` (`service.actualizar(id, data,
   actor)`, con `actor` de `resolveActorFromSession`, que devuelve `usuarioId` no nulo:
   `lib/auth/resolve-actor.ts:33`) -> `lib/services/ZonaService.ts:113` (`this.repo.update(id,
   prep.data, actor.usuarioId)`) -> `lib/repositories/ZonaRepository.ts:276`
   (`resolverActorCongelado(tx, actorUsuarioId)`), que firma cada fila. Y de vuelta:
   `{ zona, ordenesReconciliadas }` -> service -> action -> toast. **Solo hay una implementacion de
   `IZonaRepository` y un unico llamador de `actualizarZona`** (buscado con el grafo y confirmado en
   el arbol), asi que no queda ninguna punta muerta.
4. **`historial_accion`**: una fila por orden ALCANZADA (`elegibles.map`, `:319-330`), no por
   candidata; `appendAccion` recibe el `tx` de la misma transaccion, asi que no puede desacoplarse;
   `loteId` se genera UNA vez por guardado (`:275`), fuera del bucle de grupos; la etiqueta es
   `etiquetaDeEntidad("orden", { numGuia, numRemision })`, sin nada del destinatario; y
   `valorAnterior`, `valorNuevo` y `monto` van NULL. El censo de la guardia de la 362 gano su entrada
   (`tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts:188-197`) y los cuatro
   contadores duros del catalogo pasaron de 42 a 43 y de 25 a 26 donde tocaba.
5. **La migracion**: `db/migrations/20260903120000_historial_accion_orden_zona_reconciliada/migration.sql`
   es UNA sola sentencia `ALTER TYPE ... ADD VALUE IF NOT EXISTS`, sin backfill ni uso del valor.
   El `down.sql` recrea el tipo con los 42 valores previos y **compare esa lista contra el
   `CREATE TYPE` de `20260902120000_historial_accion/migration.sql`: identica y en el mismo orden**,
   con la precondicion documentada de que revertir solo es seguro si ninguna fila usa el valor nuevo.
   **Ningun `down.sql` anterior se toco**: `git diff --name-only origin/dev...HEAD -- db/` devuelve
   exactamente tres rutas (los dos archivos de la migracion nueva y `db/schema.prisma`). Y el enum ya
   esta aplicado en la base local: el test que lo lee de `pg_enum` —no del `.sql`— paso.
6. **El refactor de `zonaUnicaDeDistrito` es un MOVIMIENTO, no una copia**: el metodo privado
   desaparecio de `OrdenRepository` (queda el comentario del borrado, `:1763-1767`), sus dos
   call-sites (`:2005` y `:2159`) llaman a la funcion del modulo compartido, y ningun `expect` de sus
   tests cambio. Grep en todo el arbol: una sola definicion viva.
7. **Aserciones honestas.** Revise los `toEqual` literales uno por uno: `data` igual a `{ zonaId }`
   (R9), `Object.keys(r)` igual a `ordenesReconciliadas/status/zona` (contrato de la accion),
   `cambiadas` igual a `updatedAt/zonaId` (R9) y `recreados` igual a `previos` (down vs. migracion de
   la 362) **son el contrato**, ninguno es polizon. Y ninguna asercion se compara contra su propia
   fuente: el component test afirma el texto literal "Zona actualizada (3 ordenes reubicadas)" y no
   lo que devuelva `mensajeGuardado`; el test de migracion compara contra OTRO archivo y se protege
   de medir el vacio con `previos.length > 40`.
8. **La guardia nueva se auto-prueba.**
   `tests/unit/guards/zona-reconciliacion-no-retarifa.guardia.test.ts` recorta el cuerpo real de
   `update`, LANZA si no lo encuentra (`:66`) y ejerce su detector sobre tres cuerpos mutados en
   memoria, mas la contraprueba de que un cuerpo sano no produce fallos. Es el antidoto exacto al
   arnes de mutaciones que miente.
9. **Alcance limpio.** Los 26 archivos del diff son de la ficha; nada de la 368 (que entra por el
   merge) aparece en `origin/dev...HEAD`. `feature_list.json` NO se toco, que es lo correcto desde
   una rama de agente. No hay `any` nuevo, ni secretos, ni pantalla nueva, ni cambio de autorizacion.
10. **Texto de UI en espanol y sin jerga**: "Zona actualizada (3 ordenes reubicadas)", con el
    singular correcto ("1 orden reubicada") probado aparte. Sin siglas.

### Corridas que ejecute (acotadas, para no duplicar la carga del gate del humano)

| Comando (vitest, un archivo o un grupo pequeno) | Resultado |
| --- | --- |
| `zona-repository.test.ts` + `zona-service.test.ts` + `zona-reconciliacion-no-retarifa.guardia` + `CrearZonaFormReconciliacion.test.tsx` + `zonas-action.test.ts` | 5 archivos, **69 passed** |
| `historial-accion-orden-zona-reconciliada-migration.test.ts` (con `DATABASE_URL`) | **5 passed** (3 de texto + 2 contra `pg_enum`) |
| `zona-reconciliacion-ordenes.test.ts` (con `DATABASE_URL`) | **17 passed**, 0 skipped, contra Postgres real |
| guardias del historial (`escrituras-cubiertas`, `sin-datos-cliente`, `punto-unico`) + `catalogo-y-choke-point` + `historial-acciones-filtros-def` | 5 archivos, **124 passed** |

**Total: 215 passed, 0 failed.** No corri `./init.sh`, ni `typecheck`, ni `lint`: los corre el humano
en paralelo y duplicarlos en esta maquina produce rojos falsos por timeout.

---

## Para levantar el rechazo

1. Escribir `progress/impl_366-zona-orden-desactualizada.md` con los archivos tocados, el mapa
   `R1..R14 -> test` y la salida de la corrida. La tabla de trazabilidad de este informe sirve de
   base, y las seis mutaciones probadas ya estan escritas en
   `tests/integration/db/zona-reconciliacion-ordenes.test.ts:27-33`: conviene copiarlas ahi.
2. Marcar `[x]` en `specs/366-zona-orden-desactualizada/tasks.md`, T8 incluida.

Con esas dos cosas, y **sin tocar una linea de codigo**, el veredicto es **OK**.

> Nota operativa: este informe queda escrito pero **sin commitear**; el gate del humano corre sobre
> este mismo worktree y no conviene moverle el HEAD a mitad. En este repo ya se perdieron tres
> informes de revision por quedarse sin commitear: incluirlo en el proximo commit de la rama.

---
---

# Segunda pasada (2026-09-03) — HEAD `9b0b85f6`

## VEREDICTO ACTUALIZADO: **APROBADO**

Los dos bloqueantes estan resueltos y el acta de implementacion es **fiel**: no afirma nada que yo
haya podido desmentir sobre el codigo, la cobertura o las mediciones. Quedan **5 correcciones de
precision sobre el documento** (n1-n5), ninguna de las cuales invalida la implementacion ni la
trazabilidad; el leader pidio expresamente que se las diera con `archivo:linea` para corregirlas
antes del PR.

Alcance de esta pasada: **solo** los dos bloqueantes y la auditoria del acta como fuente
independiente. No repito la revision del codigo, que di por buena y sigue igual: los dos commits
nuevos (`2cbb114a`, `9b0b85f6`) son docs-only, **cero codigo tocado** (`git show --stat`).

## Los dos bloqueantes: cerrados

- **B1 CERRADO.** `progress/impl_366-zona-orden-desactualizada.md` existe y esta commiteado en
  `9b0b85f6` (150 lineas), con los archivos tocados, la tabla R -> test y la verificacion ejecutada.
- **B2 CERRADO.** `specs/366-zona-orden-desactualizada/tasks.md`: **38 casillas `[x]`, 0 sin marcar**,
  contadas por mi. Y el diff de ese archivo es **solo** casillas: 38 lineas `- [ ]` fuera, 38 lineas
  `- [x]` dentro, ni una linea de texto cambiada (verificado filtrando el diff).
- **Extra:** mi propio informe quedo commiteado en `2cbb114a`, que era el riesgo que este repo ya ha
  pagado tres veces.

**Correccion de un error MIO en la primera pasada:** escribi "0 de 30 casillas" en B2. Las casillas
eran **38**, no 30: no las conte, las estime. El leader las conto bien.

## Auditoria del acta: lo que verifique como cierto

1. **Las 10 mutaciones del backend y las 2 del frontend NO estan inventadas: las declararon los
   agentes, y consta en disco.** Nueve estan en el cuerpo del commit `1bf793d0` (incidente,
   `resultado: { in: [...] }`, `anuladaAt: null`, `cierreDetalles`, `zonaId: { not: ... }`, union de
   distritos, `deletedAt: null`, el UPDATE tocando otra columna, y dejar el valor nuevo en el
   `down.sql`); la decima (`loteId` constante) esta en `5b0a73ab`. Las dos del frontend (quitar el
   conteo del mensaje; pintarlo tambien con 0) estan en `3352cf35`. **Coinciden una a una con la
   tabla del acta.** Matiz util: la cabecera del test solo lista SEIS; las otras cuatro viven en los
   mensajes de commit, que es donde hay que ir a buscarlas.
2. **La corrida del `down.sql` contra Postgres real** (43 valores -> 42 sin el nuevo -> `ROLLBACK`,
   base intacta) es transcripcion literal de lo declarado en `a318dcc0`. No la re-ejecute a
   proposito: escribiria DDL sobre la base local compartida. El acta no la inventa.
3. **`183 archivos / 2196 tests` con `.env`: lo corri yo entero.** `Test Files 183 passed (183)`,
   `Tests 2196 passed (2196)`, **cero skips**, 35,5 s. La cifra del acta es exacta.
4. **`17 passed (17)`, 0 skips** en `zona-reconciliacion-ordenes.test.ts`: medido por mi en la
   primera pasada. Exacto.
5. **Las cifras del gate son internamente consistentes** (1618+78=1696; 23268+902=24170) y
   compatibles con lo que medi: 727 de los 902 tests saltados salen de `tests/integration/db`. **No
   corri `init.sh`**, asi que del `INIT_EXIT=0` no doy fe yo; doy fe de que nada de lo que si pude
   medir lo contradice.
6. **Discrepancia aparente que NO lo es:** el commit `1bf793d0` habla de "16 casos" y el acta de 17.
   Correcto: el 17.º lo anadio `5b0a73ab` (dos guardados, dos lotes). Coincide con mis 17 medidos.
7. **Referencias de linea verificadas una a una y correctas:** `ZonaRepository.ts:195-345` (el
   metodo va 195-344), `:290-303` (el WHERE), `:309` (el UPDATE), `:317-330` (historial y lote),
   `IZonaRepository.ts:44`, `ZonaService.ts:111-117`, `lib/actions/zonas.ts:131`,
   `LiberacionReprogramadaService.ts:202` y `DevolucionSlaService.ts:241`.
8. **La lista de archivos tocados no nombra nada que no cambiara**: los 22 archivos que enumera
   estan todos en el diff.

## Hallazgos nuevos sobre el acta (todos `menor`; corregir antes del PR)

**n1 — El reparto de los 78 archivos saltados no es el que dice.**
`progress/impl_366-zona-orden-desactualizada.md:107-110`: "Los 78 archivos saltados eran
`tests/integration/db/` **enteros**". Lo medi reproduciendo la condicion exacta del gate —correr ese
directorio **sin** `DATABASE_URL`— y da **`Test Files 122 passed | 61 skipped (183)`**,
`Tests 1469 passed | 727 skipped (2196)`. O sea: **61 de los 78**, no 78; y ese directorio **no se
salto entero**, 122 de sus 183 archivos SI corrieron en el gate (los que verifican migraciones por
regex sobre el `.sql`, que no necesitan base). Los **17 archivos restantes** de los 78 salen de otras
suites con la misma puerta: `tests/integration/repositories/*.int.test.ts`,
`tests/integration/tablero-dia-*.test.ts`, `analitica-financiera-action.test.ts` y compania (20
candidatos fuera de `tests/integration/db`). **La conclusion del acta se sostiene, y de hecho es peor
de lo que dice**: no solo se salto el archivo clave de esta ficha, sino tambien otras 17 suites que
tocan base. Solo hay que arreglar la atribucion de la cifra.

**n2 — La tabla R -> test copia el spec en dos renglones donde el test no da lo que se le atribuye.**
`impl_366-...md:96` (**R13**): atribuye la cobertura a "T5 `create()` no reconcilia", que es
`tests/integration/db/zona-reconciliacion-ordenes.test.ts:576`. Ese caso **no puede ponerse en rojo**:
el distrito acaba en DOS zonas, asi que el colapso devuelve `null` y ninguna orden se movera aunque
`create()` empezara a reconciliar manana. Mide R3, no R13. Quien sostiene R13 es
`tests/unit/repositories/zona-repository.test.ts:596`, que el acta **no cita**.
`impl_366-...md:93` (**R10**): atribuye todo a "T5 caso base (forma de la fila de historial)". Ese
caso (INT:253-258) comprueba `entidadId`, `loteId` y `valorAnterior`/`valorNuevo` NULL, pero **no
comprueba el «quien guardo»** ni el `monto`: eso solo esta en `zona-repository.test.ts:504` (actor
congelado y `monto` NULL) y en `zona-service.test.ts` (el actor llega como tercer argumento).
Los dos requisitos **siguen cubiertos** —mi 14 de 14 no cambia—, pero el acta cita el test
equivocado, que es justo lo que se pidio cazar. Y como el acta invoca mi verificacion en su linea
99-100, conviene que ademas mencione las salvedades m2 y m3 de este informe en vez de dejar el
respaldo en seco.

**n3 — Una cita de linea del frontend apunta a otra parte.**
`impl_366-...md:63`: `CrearZonaForm.tsx:243-269,426-438`. El primer rango encaja (el bloque nuevo va
243-266). El segundo no: `mensajeGuardado` vive en **434-446** (JSDoc 434-439, funcion 440-446);
426-432 es el cierre del componente, no el helper.

**n4 — La lista de archivos tocados se deja uno.**
Falta `tests/unit/guards/historial-accion-sin-datos-cliente.guardia.test.ts`, el 11.º archivo de test
del diff. Es un cambio de solo comentarios (42 -> 43 puntos de escritura), asi que es irrelevante para
el comportamiento, pero la lista dice "Actualizados" y ahi va. Ninguna otra ausencia, y ningun
archivo nombrado de mas.

**n5 — "Fuera de alcance" no esconde nada, pero omite el riesgo que si importa a operaciones.**
Comprobado contra `design.md S9`: los dos items que el acta lista son ciertos, y los otros cuatro del
design (tabla de historial de zonas, motor de reglas de re-tarifado, notificacion al mensajero o al
adminSatelite, retarifar un `cierre_detail` ya emitido) siguen fuera con razon. **Nada que debiera
estar dentro esta escondido.** Lo que falta es una linea sobre el riesgo aceptado de `design.md S8`:
una orden cuyo distrito resuelve 0 o mas de 1 zonas, o que es inelegible, **se queda con la zona
vieja y hoy no existe ninguna via manual** de corregirla (Q2 cerrada por el humano: no se cuenta esa
deuda). Quien opere esto manana necesita saberlo, y el acta no lo dice en ningun sitio.

## Cierre

Con B1 y B2 cerrados y el acta auditada como fiel, el veredicto de la ficha 366 es **APROBADO**. Las
correcciones n1-n5 son del documento, no del codigo, y no bloquean el PR mas alla de lo que el propio
leader quiera arreglar antes de abrirlo.

> Este apendice queda **sin commitear** (yo no commiteo salvo que me lo pidan). Conviene meterlo en
> el mismo commit que las correcciones n1-n5.
