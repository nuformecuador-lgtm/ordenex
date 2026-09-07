# Review — Ficha 376 · «la zona central se apaga sin querer, y apagarla no deja rastro»

**Revisor:** reviewer (agente). **Fecha:** 2026-09-07.
**Rama:** `fix/376-zona-central-guarda-y-rastro`, HEAD **`630b5b46`**.
**Base de la medicion:** `git diff dev...HEAD` sobre el merge-base `1f263d47` (29 archivos).

> ⚠️ **`dev` YA SE MOVIO mientras se revisaba.** `git log dev...HEAD` muestra dos commits en `dev`
> que esta rama no tiene: `7d7f1d0d` (chore 378/381) y `96250b58` (spec 381). Ninguno toca los
> archivos de esta ficha, pero el pre-vuelo caduca: hay que re-comparar contra `origin/dev` antes
> de abrir o mergear el PR.

---

## Veredicto

**APROBADA CON RESERVAS.**

El codigo esta bien y esta *medido*: no hay ni un hallazgo bloqueante de implementacion ni de
verificacion. Quedan **dos incumplimientos de `CHECKPOINTS.md`, los dos documentales**, que impiden
pasar la ficha a `done` pero no requieren tocar una sola linea de codigo ni de test.

---

## 1. Verificacion ejecutable (la corri yo, no me fie de la bitacora)

`./init.sh` **completo**, sobre el arbol de `630b5b46` sin modificar:

```
Test Files  1769 passed (1769)
     Tests  25263 passed | 26 skipped (25289)
  Duration  602.42s
tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1769 ejecutado(s))
.env presente
== init OK ==
INIT_EXIT=0
```

`INIT_EXIT=0` leido **de dentro del log**, no del exit code de la shell (la leccion del `echo` que
tapa el codigo de salida). Los **26 `skipped`** son `AnaliticaPage.test.tsx` (17) y
`AnaliticaShell.test.tsx` (9): preexistentes y ajenos. **Cero `skipped` en `integration/db`** — es
decir, la suite contra Postgres real SI corrio; `prisma migrate status` daba «up to date» antes de
empezar.

Los 12 archivos de esta ficha, todos verdes y todos ejecutados:

| Archivo | Casos |
| --- | --- |
| `tests/integration/db/zona-central-guarda-y-rastro.test.ts` | 17 |
| `tests/integration/db/historial-accion-zona-central-migration.test.ts` | 13 |
| `tests/components/ZonaCentralConfirmacion.test.tsx` | 15 |
| `tests/components/ZonaBorradoMotivo.test.tsx` | 4 |
| `tests/unit/repositories/zona-repository.test.ts` | 46 |
| `tests/unit/services/zona-service.test.ts` | 30 |
| `tests/integration/actions/zonas-action.test.ts` | 18 |
| `tests/unit/types/zona-schema.test.ts` | 18 |
| `tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts` | 51 |
| `tests/unit/historial-accion/catalogo-y-choke-point.test.ts` | 41 |
| `tests/integration/db/tarifa-zona-borrado-fk-real.test.ts` | 9 |
| `tests/integration/db/zona-reconciliacion-ordenes.test.ts` | 17 |

No hizo falta repetir nada aislado: no hubo rojos ni timeouts en esta corrida.

### 1.1 Mutaciones que aplique YO y reverti (no las del implementer)

Un test verde no dice si mide algo. Estas las aplique a mano sobre el arbol real, corri el archivo
afectado y reverti con `git checkout --`; al terminar, `git diff HEAD` esta **vacio**.

| Mutacion | Archivo mutado | Resultado |
| --- | --- | --- |
| El 2.o `appendAccion` de `update` recibe `this.prisma` en vez de `tx` | `ZonaRepository.ts` | **ROJO** — 2 de 51 en la guardia de escrituras cubiertas, con el mensaje «no le pasa a `appendAccion` la `tx`, sino otro cliente» |
| Se borra ENTERO el bloque `appendAccion` de la 376 en `update` | `ZonaRepository.ts` | **La guardia sigue VERDE (51/51)**; lo cazan los unit (6 rojos). Ver `menor-2` |
| `actualizarZonaSchema = crearZonaSchema` (el defecto original) | `lib/types/zona.ts` | **ROJO** — `zona-schema.test.ts` y `zonas-action.test.ts` |
| `esCentral: data.esCentral ?? false` en el `update` (linea 316) | `ZonaRepository.ts` | **ROJO** — los casos R1 y R4 de la suite contra Postgres |
| Se quita `if (exists.esCentral) return "es_central"` de `hardDelete` | `ZonaRepository.ts` | **ROJO** — el caso R10, y por BORRADO, no por otra cosa |
| La rama de R20 pasa a `else if (false)` | `CrearZonaForm.tsx` | **ROJO** — 9 de 15 en `ZonaCentralConfirmacion.test.tsx`, exactamente el numero que la ficha declaraba |

Nota metodologica: la primera vez que aplique la del `?? false` la puse por error en `create`
(mismo literal, dos sitios) y la suite paso en verde. **No era un falso verde del test: era mi
mutacion mal puesta** — en `create` la marca es siempre un `boolean` y `?? false` no cambia nada.
Repetida en el `update`, roja. Lo dejo escrito para que nadie lea «una mutacion sobrevivio».

---

## 2. Trazabilidad R1-R24 (comprobada test a test, no leyendo la tabla)

| R | Test que lo verifica | Comprobado |
| --- | --- | --- |
| R1 | `zona-schema.test.ts` «el campo ausente sale como `undefined`» + integracion «la marca SOBREVIVE a su ausencia» | Existe, corre, **rojo bajo mutacion** |
| R2 | `zona-schema.test.ts` «al CREAR sigue saliendo `false`» — afirma el VALOR, no `.success` | Existe y corre |
| R3 | `zona-schema.test.ts` (`false`/`true` explicitos) + integracion «`false` explicito se RECHAZA» | Existe, corre, rojo bajo mutacion |
| R4 | integracion «el resto del guardado SI se aplica entero» (nombre + distritos + tarifas) | Rojo bajo mutacion |
| R5 | integracion «`false` EXPLICITO sobre la unica central se RECHAZA, y NADA cambia» — afirma las CUATRO escrituras no aplicadas | Rojo bajo mutacion |
| R6 | `zona-service.test.ts` «`sin_zona_central` -> validation_error con el motivo colgado de `esCentral`» | Existe y corre. **Literal, no la constante** (ver §3) |
| R7 | `zonas-action.test.ts` con `ZonaService` REAL sobre repo doble, llamando la Server Action | Existe y corre |
| R8 | integracion «sin ninguna zona central, `esCentral: false` se ACEPTA» + control positivo | Existe y corre |
| R9 | integracion «el traslado deja EXACTAMENTE una central» | Existe y corre |
| R10 | integracion «la zona central SIN ordenes ni usuarios NO se borra» | Rojo bajo mutacion |
| R11 | integracion «la NO central con una orden sigue devolviendo `referenced`» + unit del service | Existe y corre |
| R12 | integracion «escribe DOS filas» (update) + «R12 en `create`» | Existe y corre |
| R13 | integracion «entidad, etiqueta, actor congelado y `monto` NULL» | Existe y corre |
| R14 | `historial-accion-sin-datos-cliente.guardia.test.ts` | **Cubierto de hecho, pero NO por esa guardia** — ver `menor-1` |
| R15 | integracion «las dos filas comparten lote» + «lote distinto del de la reconciliacion de la 366» | Existe y corre |
| R16 | `catalogo-y-choke-point.test.ts`: categoria `mueve_dinero`, etiqueta LITERAL, reparto 27/10/12 | Existe y corre |
| R17 | guardia de escrituras cubiertas + integracion «si el registro falla, ni la marca cambia ni queda la fila» (SAVEPOINT real, `RegistroCaido`) | Rojo bajo mutacion |
| R18 | integracion «repetir el guardado no anade fila» + «crear sin la marca» + 3 unit | Existe y corre |
| R19 | integracion «cero filas tras el rechazo de R5» (`historialTotal` = 0) + «`registroDeBorrado` = 0» | Existe y corre |
| R20 | `ZonaCentralConfirmacion.test.tsx`, 3 casos | **9/15 rojos bajo mutacion** |
| R21 | `ZonaCentralConfirmacion.test.tsx`, 2 casos, texto LITERAL conservado | Existe y corre |
| R22 | 2 casos de cancelacion (las dos direcciones) | Existe y corre |
| R23 | `FieldError` + `aria-describedby` + el toast que repite el motivo del servidor | Existe y corre |
| R24 | `ZonaBorradoMotivo.test.tsx`, 4 casos, los DOS textos literales | Existe y corre |

**Ninguno de los 24 requisitos se queda sin test, y ninguno de los tests citados esta vacio.**

---

## 3. Los tres riesgos que se me pidio mirar en particular

### 3.1 Aserciones contra su propia fuente — **NO HAY NINGUNA**

`MSG_SIN_ZONA_CENTRAL` vive en `lib/services/ZonaService.ts:23` y **no se exporta**. Un `grep` por
todo el arbol devuelve exactamente dos apariciones, las dos dentro de ese archivo. Los tres sitios
que afirman ese texto (`zona-service.test.ts`, `zonas-action.test.ts`,
`ZonaCentralConfirmacion.test.tsx`) lo escriben a mano. Reescribir el mensaje pone rojos los tres.
Lo mismo con los cuatro textos de pantalla (`descripcionConfirmacion` x2, `mensajeBorradoFallido`
x2): literales en el test, sin importar la funcion que los genera.

Caso limite mirado a proposito: en `ZonaCentralConfirmacion.test.tsx`, `MOTIVO_DEL_SERVIDOR` se usa
a la vez para alimentar el mock y para afirmar. **Eso es correcto aqui**, porque el contrato de R23
es precisamente «el formulario reenvia el texto del servidor TAL CUAL, sin reescribirlo»; y el caso
hermano afirma ademas que NO sale «el formulario esta incompleto».

### 3.2 Tests que se auto-aprueban — **NO HAY NINGUNO**

Cero `if (!x) return;` en los archivos nuevos. La unica aparicion de ese patron es un comentario que
explica por que NO esta. Donde la vieja receta ponia un `return` mudo, aqui hay un `throw` con
instrucciones (`beforeAll` de la suite de integracion: «corre `pnpm run db:seed`...»). Ademas hay
**anti-vacuidad explicita de las premisas**: el escenario afirma que arranca con 0 centrales antes
de seguir; el caso de R10 afirma que hay 0 ordenes y 0 usuarios apuntando; el del lote afirma que la
reconciliacion de la 366 SI ocurrio (`reconciliadas === 1`) antes de comparar lotes. Y los
`soloOk(...)` sustituyen a los `res?.` de antes: un desenlace inesperado revienta en vez de colarse
como `undefined`.

### 3.3 El literal que se toco en un test ajeno — **legitimo, y ademas mas fuerte**

`tests/integration/db/tarifa-zona-borrado-fk-real.test.ts:205` pasa de
`toEqual({ status: "conflict" })` a `toEqual({ status: "conflict", motivo: "en_uso" })`.

Ese `toEqual` **ERA** el contrato de forma, y **sigue siendolo**: `toEqual` es exacto (no admite
claves de mas), asi que el test sigue prohibiendo que por esa via viaje cualquier otro campo. Lo que
cambia es que el tipo `BorrarZonaResult` gano un campo obligatorio, y el literal se amplia con el
valor que corresponde a ESA via. No es «cambiar la asercion por su propia fuente»: es fijar, ademas,
que el rechazo por FK real sale como `en_uso` y **no** como `es_central`. La contraparte
—`es_central` por la via de la guarda— vive en el archivo nuevo. La cobertura sube, no baja.

Complemento: `zonas-action.test.ts` conserva un
`expect(Object.keys(r).sort()).toEqual(["motivo", "status"])` en el caso de `en_uso`, asi que la
forma exacta del `conflict` sigue anclada tambien en el borde.

---

## 4. La guardia reforzada (`historial-accion-escrituras-cubiertas`)

**(a) Arrastra deuda ajena? No.** El cambio es quirurgico: `indexOf("appendAccion")` (la PRIMERA
llamada) pasa a `llamadasAAppendAccion()` (TODAS), y las tres comprobaciones se aplican con
`.some()` / `.filter()` sobre esa lista. Las dos entradas nuevas del `CENSO` no tocan la de la 366
(`orden_zona_reconciliada`, mutacion `tx.orden.updateMany`), que sigue igual; el `it.each` las corre
por separado. Los numeros duros pasan de 48 a 49 en los dos sitios que los tienen.
`codigoSinComentarios` sigue delante, asi que un `appendAccion(` mencionado en un comentario no
genera falsos positivos.

**(b) Detecta lo que dice detectar? Si, y lo verifique contra el archivo real**, no solo contra los
cuerpos sinteticos que la propia guardia se auto-aplica: poniendo `this.prisma` en la SEGUNDA
llamada de `ZonaRepository.update` la guardia se pone roja (2 fallos). Con el detector de antes
—`indexOf`— esa mutacion habria pasado, porque la primera llamada sigue recibiendo `tx`.

**(c) El limite declarado: CONFIRMADO, y es exactamente como se dijo.** Borre entero el bloque
`appendAccion` de la 376 en `update` y la guardia quedo **51/51 en verde**. La razon esta a la vista
en `fallosDelPuntoDeEscritura`: la unica comprobacion de existencia es `if (llamadas.length === 0)`.
El censo no sabe *que* llamada corresponde a *que* tipo, asi que con dos `appendAccion` en el mismo
cuerpo basta con que sobreviva uno. Lo cazan los tests de comportamiento (6 rojos en
`zona-repository.test.ts` y los de integracion), asi que **el riesgo esta contenido hoy**; lo que no
es cierto es que la entrada del censo garantice, por si sola, que `zona_central_cambiada` tenga su
escritura. Queda como `menor-2`.

---

## 5. `CHECKPOINTS.md`, punto por punto

### Especificacion
- [x] `requirements.md` con EARS numerados R1-R24.
- [x] `design.md` con alternativas descartadas y su porque (siete: A-G, mas la tabla resumen §11).
- [ ] **`tasks.md` con TODAS las tasks marcadas `[x]` — NO.** T1 a T11 siguen con `[ ]`; solo T12
      esta marcada. -> `bloqueante-cierre-1`.

### Trazabilidad
- [x] Cada `R<n>` mapea a al menos un test concreto (verificado uno a uno, §2).
- [ ] **`progress/impl_376.md` con el mapa `R<n> -> test` — NO EXISTE.** El mapa vive en `tasks.md`,
      que no es donde el checkpoint lo pide. -> `bloqueante-cierre-2`.

### Calidad de codigo
- [x] `pnpm run typecheck` sin errores (TypeScript strict; ni un `any` nuevo, ni un
      `as unknown as` para tapar el cambio de tipo de `update`).
- [x] `pnpm run lint` sin errores.
- [x] `pnpm test` verde (1769/1769 archivos).
- [~] **E2E:** el repo no tiene arnes de Playwright ejecutable y la ficha no toca auth, pagos,
      recaudo, ingesta ni webhooks. Se declara **inaplicable**, con el riesgo residual dicho en §7.

### Datos y seguridad (Supabase)
- [x] **RLS:** no hay tablas nuevas ni columnas nuevas. `historial_accion` conserva su RLS
      habilitada sin policies (solo service role) desde la 362; anadir un valor de enum no la toca.
      Verificado en el `migration.sql`, que es UNA sentencia.
- [x] **Migracion versionada y reversible:**
      `db/migrations/20260907130000_historial_accion_zona_central_cambiada/` trae `migration.sql`
      (un solo `ALTER TYPE ... ADD VALUE IF NOT EXISTS`) y `down.sql` (recrea-con-lista, **48**
      valores contados uno a uno: 25 + 6 + 11 + 6). Ningun `down.sql` anterior se toco. El `down`
      **se ejecuta de verdad** en un esquema desechable por
      `historial-accion-zona-central-migration.test.ts`, que reconstruye el estado previo corriendo
      las migraciones REALES anteriores y compara valor a valor y en orden — mas fuerte que leer el
      archivo. Ver `menor-8` sobre el script `db:rollback`.
- [x] **Sin secretos hardcodeados.**
- [x] **Webhooks:** no aplica; la ficha no crea ninguno.

### Patron de capas
- [x] La Server Action no hace queries ni logica: valida el borde (`idsSchema`, tope de 20 ids) y
      delega.
- [x] El service no conoce HTTP.
- [~] **Repository:** ademas de queries, aloja la guarda de R5 y la construccion de las filas de
      auditoria. Es una desviacion **razonada por escrito** (`design.md` §2: fuera de la transaccion
      son dos transacciones y un doble daria verde con el `WHERE` roto) y con precedente en la casa
      (`UserRepository`). Se acepta; queda nombrada como `menor-5`.
- [x] Interfaces en `lib/interfaces/`, separadas por categoria.

### Permisos
- [x] Las tres acciones (`actualizarZona`, `borrarZona`, `impactoZonaCentral`) pasan por
      `esMaestro(actor)` en el service; `impactoZonaCentral` ademas exige sesion antes de parsear.
      El composition root inyecta de verdad:
      `new ZonaService(new ZonaRepository(getPrismaClient()))`.
- [x] No hay paginas nuevas ni componentes `private/` nuevos.
- [x] Las mutaciones son Server Actions, no `fetch` a API routes.

### Multi-pais / configuracion
- [x] No se hardcodea pais, moneda ni cuenta. El vocabulario `Gam` de las columnas de flete es
      preexistente y no se amplia.

### Verificacion final
- [x] `./init.sh` termina en verde (corrido por mi, §1).
- [x] `progress/review_376.md` existe (este archivo).
- [ ] **Entrada en `progress/history.md` — falta.** Es paso de cierre del leader, no del
      implementer; queda anotado, no lo cuento como bloqueante de esta revision.

---

## 6. Hallazgos

### Bloqueantes de codigo o de verificacion: **NINGUNO**

### Bloqueantes de cierre (documentales; no exigen tocar codigo)

**`bloqueante-cierre-1` — `tasks.md`: T1-T11 sin marcar.**
`specs/376-zona-central-guarda-y-rastro/tasks.md` deja T1 a T11 con `[ ]` cuando las once estan
hechas y verificadas (lo comprobe una a una contra el arbol). `CHECKPOINTS.md > Especificacion`
exige que **todas** esten `[x]`. Que falta: marcarlas.

**`bloqueante-cierre-2` — no existe `progress/impl_376.md`.**
`CHECKPOINTS.md > Trazabilidad` exige que ese archivo contenga el mapa `R<n> -> test`. Hoy el mapa
vive solo en `tasks.md`. Que falta: crear la bitacora con el mapa y la nota de las mutaciones
probadas (que hoy esta repartida entre `tasks.md` y los mensajes de commit).

### Menores

**`menor-1` — R14 esta cubierto, pero NO por la guardia que la tabla cita.**
`historial-accion-sin-datos-cliente.guardia.test.ts` recorta el bloque **desde cada `appendAccion(`**
hacia adelante. Los campos de las filas nuevas se construyen en `filasDeCambioDeMarca`
(`lib/repositories/ZonaRepository.ts:57-75`), **antes** de la primera llamada (linea 184), asi que
ningun recorte los contiene: si alguien metiera `destinatario` ahi dentro, esa guardia no lo veria.
R14 sigue verificado *de hecho* por la suite de integracion, que afirma `entidad_etiqueta` = el
nombre de la zona, `valor_anterior`/`valor_nuevo` = `"true"`/`"false"` y `monto` NULL — pero la
barrera contra regresiones futuras no esta donde la tabla dice. Arreglo barato: incluir el helper en
el barrido, o construir las entradas en el sitio de la llamada.

**`menor-2` — el censo de la guardia no ata un tipo a una llamada.** Confirmado por mutacion (§4c):
borrar entero el `appendAccion` de la 376 deja la guardia 51/51 verde. Es una limitacion estructural
del censo, no una regresion de esta ficha —hasta ahora ningun metodo censado tenia dos llamadas—, y
esta declarada por escrito. Hoy lo tapan los tests de comportamiento. El dia que se anada un tercer
tipo a un metodo que ya escribe historial, esa entrada del censo no valdra nada.

**`menor-3` — R20 tiene un hueco dentro de la misma sesion del formulario.** La rama de confirmacion
se decide con `initial?.esCentral === true`, una foto del montaje. Secuencia: marcar la zona como
central -> Guardar (exito) -> desmarcar -> Guardar. En ese segundo guardado la zona **ya es** la
central y el modal de R20 no aparece. No hay perdida de datos: el servidor rechaza igual (R5) y el
mensaje se pinta junto a la casilla (R23). Es un aviso que falta en un camino poco probable, no una
regla que se salte. La prop `zonas` tiene la misma naturaleza de foto.

**`menor-4` — el design dice que no hay superficies nuevas, y hay una.** `design.md` §6.4: «son las
mismas dos Server Actions». La implementacion anade una tercera, `impactoZonaCentral`, para poder
cumplir Q4 —que el humano firmo DESPUES de escribirse el design—. Es de solo lectura, `maestro`-only
y con tope de 20 ids, y esta documentada en `tasks.md` T12. No es un defecto; es texto de design que
se quedo desactualizado.

**`menor-5` — logica de negocio en el repositorio.** La guarda de R5 y la decision de si se escribe
rastro viven dentro de `ZonaRepository`. Roza el checkpoint «Repository solo ejecuta queries
Prisma». Esta razonado en `design.md` §2 y es la unica forma de que la condicion sea atomica y de
que una mutacion del `WHERE` se pueda ver roja. Se acepta; se nombra para que no se lea como
descuido.

**`menor-6` — `create` con la marca y SIN central previa no tiene caso propio.** Escribe UNA fila
(la de la zona que la gana). El equivalente en `update` si esta probado («R8: si no habia ninguna
central, se escribe UNA sola fila»); en `create` solo estan el caso con central previa (dos filas) y
el caso sin marca (cero filas). Hueco pequeno y de bajo riesgo.

**`menor-7` — falta la entrada en `progress/history.md`.** Paso de cierre del leader.

**`menor-8` — `pnpm run db:rollback` no se ejecuto contra la base local.** No es negligencia: la
base ya tiene el valor aplicado y podria tener filas del tipo nuevo, con lo que el `down` abortaria
por diseno (precondicion ruidosa). El `down.sql` **si** se ejecuta de verdad, en un esquema
temporal, por los bloques (b) y (c) del test de migracion, que es una prueba mas fuerte que correr
el script. Queda dicho para que nadie lea «se probo `db:rollback`».

**`menor-9` — la rama esta 2 commits por detras de `dev`.** Ver el aviso de la cabecera.

---

## 7. Lo que esta BIEN, dicho en voz alta

Para que este informe distinga «revisado y correcto» de «no mirado»:

- **El defecto se arregla donde vive, y se mide donde vive.** `esCentral` sale de `zonaFields` y
  cada operacion compone su esquema; el `undefined` viaja intacto hasta el `data` de Prisma. Y como
  esa propiedad es de Prisma y no del codigo, R1 **no** se prueba con dobles: se prueba leyendo la
  columna despues del guardado, contra Postgres. Lo confirme con mi propia mutacion.
- **La guarda de R5 sale antes de la primera escritura**, y el test no se conforma con el desenlace:
  afirma las cuatro escrituras que NO se aplicaron (nombre, distritos, tarifas, marca) y que no
  quedo ni una fila de historial. Ese es el test que hace falta.
- **El rastro cubre la zona que nadie nombra.** Dos filas, una por zona, mismo lote, y ese lote
  DISTINTO del de la reconciliacion de la 366 aunque ocurran en el mismo guardado — con un test que
  primero comprueba que la reconciliacion de verdad ocurrio antes de comparar los lotes.
- **R17 no se despacho con «el arnes no permite inyectar el fallo»**, que era la salida que el
  propio `tasks.md` autorizaba. Se uso `clienteConSavepoint(tx, true)` con `SAVEPOINT`/`ROLLBACK TO`
  reales: el registro falla, y ni la marca se mueve ni queda la fila.
- **Los dos rechazos de borrado quedan distinguibles de punta a punta**, con motivo tipado desde el
  repositorio hasta el toast, y con el caso que las FK no cubren (central sin ordenes ni usuarios)
  probado contra la base.
- **La regla vive en UN solo sitio.** Revisado el cliente linea a linea: `guardar()` confirma y
  **envia**; no hay ningun `if` que impida el guardado, ninguna copia del invariante, ningun mensaje
  redactado en el cliente para el caso de R5 (se reenvia el del servidor tal cual). Q2 se cumple
  como se firmo.
- **Money-safe.** El diff no toca ni un importe: `contarOrdenesVivasPorZona` devuelve enteros de un
  `groupBy`, `monto` va `null`, y el camino de tarifas de `update` queda intacto. Ninguna fila de
  `historial_accion` lleva datos de cliente: la etiqueta es el nombre de la zona (catalogo de la
  casa) y los valores son `"true"`/`"false"`.
- **El corte de Q4 vive en el `WHERE`** (`deletedAt: null`, `cierreDetalles: { none: {} }`) y se
  mide contra Postgres con una orden borrada y otra ya congelada en un cierre, no con un `if` que un
  doble pueda esquivar.
- **La anotacion `@sin-superficie` de `impactoZonaCentral` se puso en el commit del backend y se
  borro en el de la pantalla.** Verificado en los blobs de `11e8aa2d` y `630b5b46`: la excepcion no
  sobrevivio a su motivo.
- **Los tests ajenos que se tocaron quedaron mas fuertes, no mas flojos:** los
  `res?.ordenesReconciliadas` de la suite de la 366 pasan a un helper que **lanza** si el desenlace
  no es `ok`.

### Riesgo residual (declarado, no es hallazgo)

**Nadie ha visto la pantalla funcionando en la app real.** Los 19 casos de componente montan el
componente de verdad en jsdom con `userEvent` —no son dobles del formulario—, pero el navegador no
se abrio. En este repo esta medido que ver la app encuentra cosas que la suite da por buenas. No lo
cuento como defecto porque no lo es; lo dejo escrito para que la decision de desplegar se tome
sabiendolo.
