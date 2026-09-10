# Revisión 407 — Autorizar la asignación de una orden sin ubicación

> Rama `feat/407-autorizar-asignacion-sin-ubicacion-frontend` · PR #773 · base `dev`
> HEAD revisado: **e7c61758** · diff `dev...HEAD`: 25 archivos, 4.543 inserciones, 119 borrados
> Revisión ejecutada el 2026-09-10 en el worktree de la rama, con `.env` y `node_modules` propios.

**VEREDICTO: OK (APROBADO).** Cero bloqueantes.

---

## 1. Cómo se revisó

No se aceptó ninguna afirmación de las dos bitácoras sin volver a medirla. Lo que hice yo:

- corrí los diez archivos de test de la ficha por separado (**312 tests verdes**);
- apliqué **14 mutaciones propias** sobre el código de producción y sobre los guardias, y las
  reverté todas (`git status --porcelain` vacío tras cada una): **14 muertas, 0 supervivientes**;
- corrí **`./init.sh` completo** con `INIT_EXIT` escrito DENTRO del log;
- leí el diff entero de producción y los cuatro archivos de test ajenos que se tocan.

---

## 2. Checklist de `CHECKPOINTS.md`

### Especificación
- [x] `requirements.md` con R1–R20 en EARS, numerados.
- [x] `design.md` con nueve alternativas descartadas (§8-A1…A9) y su porqué.
- [ ] `tasks.md` «todas marcadas `[x]`» — **inaplicable tal como está escrito**: este repo NO usa
      casillas en `tasks.md`. Medido: 400, 401, 405 y 368 tienen **cero** `[x]` y **cero** `[ ]`.
      El criterio real de «hecho» es el bloque *Hecho cuando* de cada task, y las 14 (T1–T14) lo
      tienen; verifiqué cada una corriendo el test que nombra. Ninguna task quedó abierta.

### Trazabilidad
- [x] Cada `R<n>` mapea a un test concreto que se pone rojo si el código está mal. **Los 20
      verificados por mí**, uno a uno (§3).
- [x] El mapa `R<n> → test` está en las bitácoras: R1–R12 y la mitad servidor de R17 en
      `progress/impl_407_backend.md` §3; R10–R20 y la mitad cliente de R12/R17 en
      `progress/impl_407_frontend.md` §3. Ninguna fila vacía.

### Calidad de código
- [x] `pnpm run typecheck` sin errores (dentro del gate).
- [x] `pnpm run lint` sin errores.
- [x] `pnpm test` — la suite entera, verde (§4).
- [x] E2E Playwright: **no aplica**. No hay harness de E2E en este repo y la ficha no toca auth,
      pagos, recaudo, ingesta ni webhooks. El riesgo que un E2E cubriría queda declarado en §6.

### Datos y seguridad (Supabase)
- [x] Tablas nuevas: **ninguna**. No hay RLS que activar.
- [x] Migraciones: **ninguna**. Confirmado sobre el diff: cero archivos bajo `db/`, cero
      `db/schema.prisma`, cero `db/migrations/**`. El aviso amarillo de tres `down.sql` que da el
      gate es preexistente y ajeno (familia «ruta optimizada», 2026-08-14).
- [x] Secretos: cero `process.env`, cero claves, cero tokens en el diff.
- [x] Webhooks: la ficha no toca ninguno.

### Patrón de capas
- [x] Controller: `lib/actions/ordenes-guia.ts` y `lib/actions/recepcion-satelite.ts` **NO se
      tocan**. El campo cruza el borde solo porque la action hace `schema.parse` y entrega el
      resultado tal cual — y eso está **medido**, no afirmado: tres tests por action que mandan la
      marca y leen lo que recibió el service inyectado.
- [x] Service sin HTTP: no entra ni un `Request`/`Response`/`headers`.
- [x] Repository: **cero archivos** bajo `lib/repositories/` en el diff. `findParaAsignabilidad`
      intacto, cero consultas nuevas (el paso del gate es una lectura de un `Set` en memoria).
- [x] Interfaces en `lib/interfaces/services/`. `MOTIVOS_AUTORIZABLES_SIN_UBICACION` y
      `esMotivoAutorizableSinUbicacion` son valores de runtime dentro de ese árbol: **hay
      precedente** (5 archivos de `lib/interfaces/` ya exportan `const`/`function`), y el archivo
      **no importa nada** —verificado— así que el componente cliente que lo reexporta no arrastra
      Prisma ni `node:crypto` al bundle.

### Permisos
- [x] La marca no añade ni relaja ni un permiso: rol, zona, estado de origen, mensajero, cierres
      y tope de intentos se evalúan **antes** del gate y siguen abortando el lote. Probado de
      forma hostil (§3, R6/R7).
- [x] Mutación por Server Action, no por `fetch` a una API route.

### Multi-país / configuración
- [x] Nada hardcodeado: ni país, ni moneda, ni cuenta. Los dos literales no nombran proveedor.

### Verificación final
- [x] `./init.sh` completo en verde, corrido por mí (§4).
- [x] `progress/review_407.md` existe (este archivo) y su veredicto es OK.
- [ ] `progress/history.md`: **todavía sin entrada de la 407**. Es el paso de cierre del leader,
      no del implementador. Queda anotado como pendiente de cierre, no como hallazgo.

---

## 3. Trazabilidad: los 20 requisitos, verificados por mí

Corrí los diez archivos y leí cada caso. «Mutación» = la que apliqué yo sobre el código real.

| R | Verificación | Mutación propia |
| --- | --- | --- |
| **R1** | `asignabilidad-coordenadas-autorizada` (los TRES deterministas) + los dos gate-tests, incluido el caso con `AsignabilidadCoordenadasService` **real** | ✔ writer que no reenvía el conjunto → **4 rojos**, uno de ellos el del gate real |
| **R2** | tabla de los cuatro estados de cola, **todos marcados**, siguen bloqueando | ✔ el `if` sacado de la rama R3 y puesto como paso propio → **10 rojos** |
| **R3** | id marcado fuera del lote; marcar una no arrastra a las demás; y en los dos writers | ✔ (cubierta por la anterior y por la del modal) |
| **R4** | lat/lng presentes + marca → `asignable` | ✔ misma mutación de R2: el caso de R4 cae con ella |
| **R5** | fila sin marca sigue bloqueando · `asignabilidad-coordenadas.test.ts` **intacto** · los `toEqual` vigentes intactos · primera petición del modal sin marca | — |
| **R6** | actor sin rol → `forbidden`; cierres; origen inválido; tope de intentos; y en satélite `sin_zona`, `bodega_bloqueada`, zona ajena. **Con la marca puesta en los siete** | — (leídos y corridos: `g.evaluar` `not.toHaveBeenCalled` en todos) |
| **R7** | en cada uno de esos casos, `asignarBodegaLote`/`asignarSateliteLote` no se llamó | — |
| **R8** | lote de 3 → `partial` con 2 asignadas y 1 bloqueada, en los dos writers | — |
| **R9** | segunda llamada sin marca vuelve a bloquear · no muta la fila · instancia nueva no hereda · el modal olvida al reabrir | ✔ el conjunto guardado en la instancia → **1 rojo** |
| **R10** | `not.toHaveProperty("sinUbicacionAutorizada")` (no `toBeUndefined`) + `toEqual` completo; `conflict` sin cifra | — |
| **R11** | lote con una de la 400 y una de la 407 → `{sinUbicacion:1, sinUbicacionAutorizada:1}`, suma disjunta; y en el toast, los dos literales enteros | — |
| **R12** | guardia `autorizacion-texto-no-miente` (árbol + salida) | ✔ **dos**: copiar el literal de la 400 dentro de la 407 → **7 rojos**; aliasar las dos funciones → **13 rojos** |
| **R13** | singular, plural y `n <= 0`, contra el literal **escrito a mano** en el test | — |
| **R14** | el literal de §5.1 en el documento **antes** de pulsar (`toHaveBeenCalledTimes(1)`), en los dos modales | — |
| **R15** | ni dirección, ni guía, ni destinatario, ni teléfono, ni uuid en el DOM; el texto no lleva ni un dígito; la firma solo admite `number` | — |
| **R16** | `conflict`, `partial`, y contraste con los **cuatro** motivos de cola → sin panel | — |
| **R17** | equivalencia predicado↔gate para **cada** `EstadoBloqueante` + guardia de los dos modales | ✔ **dos**: añadir `geocodificacion_agotada` a la lista → **3 rojos**; el modal filtrando por literal propio → **3 rojos** en el guardia |
| **R18** | argumento capturado de la segunda llamada, `toEqual` exacto; doble pulsación bloqueada | ✔ **dos**: reenviar el lote entero, en bodega y en satélite → **1 rojo cada una** |
| **R19** | `numRemision` en el panel, uuid ausente del DOM (las fixtures son uuids de verdad) | — |
| **R20** | el lote que el botón de manifiesto le pide al servidor = unión de las dos peticiones | ✔ **dos**: no acumular, en bodega y en satélite → **1 rojo cada una** |

**Los 20 tienen test, y ninguno está vacío.** Ninguna fila del mapa es un `grep` sobre un
comentario: todas son aserciones sobre comportamiento o sobre el árbol real.

### Las dos mutaciones que el frontend declara como decisivas — reaplicadas

| Mutación | Bodega | Satélite | Lo que decía la bitácora |
| --- | --- | --- | --- |
| la segunda petición reenvía el **lote entero** (R18) | **1 rojo** | **1 rojo** | 1 rojo — **coincide** |
| el manifiesto se queda con la **última** respuesta (R20) | **1 rojo** | **1 rojo** | 1 rojo — **coincide** |

Las dos son, efectivamente, **fallos mudos** sin su test: la primera produce un `conflict` con
«estado de origen no permitido» que el operador leería como capricho del sistema; la segunda
descarga un manifiesto al que le faltan órdenes, sin que nada lo diga.

### El guardia del texto — mutado, no leído

Las dos formas que T9 nombra, aplicadas sobre `geocodificacion-motivo-messages.ts`:

1. **el literal de la 400 dentro del cuerpo de la 407** → `autorizacion-texto-no-miente.guardia`:
   **7 rojos** (los cuatro del barrido de frases, el de la salida, el de «distintos» y la
   contraprueba del alias).
2. **`export const mensajeAsignadasSinUbicacionAutorizada = mensajeAsignadasSinUbicacion`** →
   **13 rojos**, incluida la no-vacuidad («el guardia encuentra las DOS funciones»), que es la que
   impide que el guardia pase por vacío tras un renombrado.

El guardia hace lo que dice. Y sus propias no-vacuidades están puestas donde tienen que estar.

---

## 4. El gate, corrido por mí

`./init.sh` **completo** (el rápido se niega solo por `lib/types/**`, como predijo el design §9-3),
en el worktree de la rama, con `.env` presente:

```
✓ typecheck paso
✓ lint paso
✓ DATABASE_URL resuelta: los 152 archivos de tests contra Postgres SI se ejecutan
 Test Files  1854 passed (1854)
      Tests  27014 passed | 26 skipped (27040)
   Duration  630.08s
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1854 ejecutado(s), todos en el baseline conocido)
✓ .env presente
== init OK ==
INIT_EXIT=0
```

**Los `skipped` se leyeron, no solo el exit.** Son **26**, y **ninguno es un archivo entero**:
`AnaliticaPage.test.tsx` (17) y `AnaliticaShell.test.tsx` (9), casos sueltos dentro de suites que
sí corrieron. Los **152 archivos de `tests/integration/db` se ejecutaron** — el gate lo dice con su
cifra porque el `.env` está copiado. Ningún requisito de esta ficha depende de ellos.

**Una sola corrida, y sin contención.** El aviso era que otro reviewer trabaja contra la **misma
base local** y que un `40P01` («se ha detectado un deadlock») con 0 tests fallidos es contención,
no regresión. **No apareció ninguno**: `grep -c "40P01|deadlock"` sobre mi log = **0**, y los 1854
archivos pasaron a la primera. **No hay segunda corrida aislada que reportar porque no hubo nada
que reproducir.**

Mis cifras son idénticas a las de la bitácora del frontend (1854 / 27.014 / 26 / 0 rojos nuevos).

`tests/baseline-rojos.json` tiene `"archivos": {}`. El gate no propuso ninguna poda (T14 cerrada).

---

## 5. Los puntos que los implementadores declaran, juzgados

### 5.1. `role="status"` en vez del `role="alert"` del design §4.2 — **el argumento se sostiene**

Lo medí antes de opinar. En los cuatro archivos de test de los dos modales hay **ocho consultas
`*ByRole("alert")` en singular** (368/T5.1 y T6.1, 400/R35, y dos de la propia 407). En la ruta
`partial` el panel y la lista de bloqueadas están **en pantalla a la vez**: con `role="alert"` en
los dos habría dos coincidencias y `getByRole("alert")` **lanza** por ambigüedad. Es decir: seguir
el design al pie de la letra rompía tests ajenos vigentes, y arreglarlos habría exigido acotarlos
—justo la maniobra que hay que mirar con lupa—.

Y más allá del test, el argumento de fondo es correcto: `alert` es asertivo e interrumpe; esto no
es un error, es una decisión que se **ofrece**, y el canal asertivo ya lo ocupa el fallo. Dos
regiones asertivas simultáneas compiten por la misma atención.

La accesibilidad queda bien servida: el panel es un `<section aria-label>` = **landmark `region`
con nombre accesible**, navegable como tal, y el literal de la consecuencia está dentro y visible
**antes** de que exista el botón que lo consume. Verifiqué además que los dos `role="alert"` del
modal viven en ramas **excluyentes** (`resultado` vs `sinOrdenes`), así que la singularidad de esas
consultas sigue siendo cierta.

*Matiz, no objeción:* una live region que se **inserta entera** en el DOM no la anuncian todos los
lectores de pantalla de forma fiable — pero es exactamente el patrón que ya usa el `confirmacionDia`
de la feature 246 doce líneas más arriba, así que es la convención del repo, no deuda nueva.

**Se acepta la desviación.** Está declarada en `impl_407_frontend.md` §6.1 y en el propio código.

### 5.2. Las dos aserciones ajenas ACOTADAS (368/T5.1 y T6.1) — **más estrictas, medido**

Es donde se cuela un test debilitado, así que no me bastó leerlo. La medida decisiva:

1. muté el modal para que la lista de bloqueadas **dejara de pintar el `numRemision`**
   (`{b.numRemision} — {b.mensaje}` → `{b.mensaje}`);
2. con la aserción **acotada** (la de la 407): **ROJA** — T5.1 cae, y con ella otras dos;
3. **restauré la aserción vieja** (`findByText(/NA-138/)` sin ámbito) sobre **el mismo código
   mutado**: **VERDE**, 1 passed.

El `findByText` sin ámbito encontraba `NA-138` en el panel nuevo y daba por buena una lista de
bloqueadas que ya no identificaba nada. **La acotación no debilitó el test: lo salvó.** Lo que la
368 fijó (R10/R11: la bloqueada se identifica por remisión y con el mensaje de su motivo) se sigue
afirmando entero, ahora en el sitio donde R10/R11 lo exigen. Y el conteo de `it` de los dos
archivos no cambia (27 y 29, iguales que en `dev`): no se borró nada.

### 5.3. Los dos `toHaveBeenCalledWith` del backend — **era el contrato del borde, no un polizón**

Ese literal afirma **la foto exacta del objeto ya parseado** que la action entrega al service: es
precisamente el contrato del borde (lo puso la 246 para probar que `dia` recibe su `.default("hoy")`
y viaja sin transformar). El `.default([])` cambia esa foto de verdad, así que el literal **tenía
que** cambiar. Y no se aflojó: sigue siendo un `toHaveBeenCalledWith` con objeto literal —igualdad
profunda, exacta— y se le añadieron **dos** tests que fijan el valor nuevo por separado
(`entrada.autorizarSinUbicacionIds` `toEqual([])` sin el campo, y `toEqual([ORDEN])` con él), más
uno hostil (un id que no es uuid → `validation_error` sin tocar el service). **Queda más medido
que antes, no menos.**

### 5.4. La familia «composition root que no inyecta» — **existe y caza**

Existe en los dos writers: «407/R1: con el gate REAL enganchado, la marca viaja del input al
gate», con `new AsignabilidadCoordenadasService(colaVacia())` de verdad, filas con el
`ZERO_RESULTS` del caso de producción, **y su contraste sin la marca** (que es lo que impide que un
gate roto, que dejara pasar `ZERO_RESULTS` por su cuenta, lo pasara igual).

Lo verifiqué mutando `evaluar(filas, autorizadasSinUbicacion)` → `evaluar(filas)` en
`GuiaAsignacionService`: **4 rojos, y el del gate real entre ellos**. Con dobles solos esta familia
no se caza — aquí sí se caza.

Añado una comprobación que ninguna bitácora hacía: busqué **un tercer writer olvidado**. No lo hay.
`.evaluar(` tiene exactamente **dos** llamadores en `lib/` y `app/`, y `gateCoordenadas` **un solo**
sitio de llamada. Nada se quedó sin la marca por descuido.

### 5.5. El guardia de la ventana de 1.400 caracteres — **sigue guardando, y no se le bajó el listón**

`tests/unit/guards/marcador-fallo-config-declaracion-unica.guardia.test.ts` **no aparece en el
diff**: cero líneas tocadas. El arreglo fue mover el párrafo nuevo **por encima** de la ventana, no
ensanchar la ventana. Comprobado midiendo y mutando:

- margen actual: «FEATURE 400» está a **115 caracteres** del inicio de la ventana (queda dentro);
- mutación: tres líneas nuevas **debajo** del docstring → **1 rojo**, el caso de `esAsignable`.

El guardia sigue haciendo su trabajo. *Menor, apuntado abajo:* 115 caracteres es poco margen y lo
único que protege el orden es un comentario, no un test.

---

## 6. Límites declarados de esta verificación

1. **Nadie ha visto la pantalla en un navegador.** Todo está medido en jsdom. **Sin cubrir:** cómo
   se comporta el panel con un lote grande (¿desborda el modal con veinte órdenes autorizables?) y
   si el contraste de `bg-muted/40` es el que toca en los dos temas. Este repo tiene lección propia
   al respecto —Playwright encontró en minutos 7 textos rotos que 12.000 tests daban por buenos—.
   **No es bloqueante por sí solo** (no hay harness de E2E y el arnés no lo pide a un
   `frontend_dev`), pero queda escrito: una pasada con la app levantada lo cerraría.
2. **La autorización no deja rastro.** Es decisión del humano del 2026-09-10 (design §3.3/§8-A1) y
   no es hallazgo. Su consecuencia, dicha en voz alta porque el código ya no podrá decirla:
   **nunca se podrá responder «quién autorizó esta orden»**. Y hay un corolario que sí conviene
   tener presente: un cliente fabricado puede mandar la marca a la Server Action y hará lo mismo
   que el modal —dentro de lo que ese actor ya podía asignar (R6/R7)— **y no quedará huella de
   quién fue**.
3. **Cero tests contra Postgres nuevos**, y es correcto: la ficha no toca ni una consulta. Los 152
   archivos existentes se ejecutaron igual.

---

## 7. Hallazgos

### BLOQUEANTES

**Ninguno.**

### Menores

1. **`menor` — `progress/history.md` no tiene entrada de la 407.** Es el último checkpoint de
   «Verificación final» y es paso de cierre del leader, no del implementador. Queda pendiente.
2. **`menor` — la bitácora del backend apunta a un archivo que no existe.** `impl_407_backend.md`
   §3 remite a `progress/impl_407.md` para R13–R20; el archivo real es `impl_407_frontend.md`.
   Referencia rancia, sin efecto sobre el código.
3. **`menor` — el guardia de la ventana queda con 115 caracteres de margen** y lo único que impide
   que la próxima ficha lo vuelva a romper es un comentario («SI AMPLIAS ESTE DOCSTRING, ESCRIBE
   POR ENCIMA DE ESTA LÍNEA»). Ningún test exige ese orden. El guardia está vivo —lo muté y se
   puso rojo— pero volverá a caer con el mismo perfil de fallo.
4. **`menor` — asimetría de validación en `asignarBodegaSchema`:** `ordenIds` es
   `z.array(z.string().min(1))` y `autorizarSinUbicacionIds` es `z.array(z.string().uuid())`. La
   marca se valida **más estricto** que el lote del que tiene que ser subconjunto. Hoy es
   inalcanzable (los ids reales son uuids y el modal construye los dos desde el mismo snapshot), y
   el satélite no lo tiene porque allí ambos son uuid. Se anota para que nadie lo descubra por un
   `validation_error` sin explicación.
5. **`menor` — el panel de autorización está duplicado literalmente** (~40 líneas de JSX más su
   `handleAutorizar`) en los dos modales. Es el precedente de la 368 y el design pedía «espejo
   exacto», así que no es un defecto; pero `docs/architecture.md` («se promueve a `shared/` cuando
   al menos DOS features lo necesitan con la misma API») ya justificaría extraerlo, y toda
   divergencia futura entre los dos lados será silenciosa salvo por el par de gate-tests.
6. **`menor` — el fallback `numRemisionPorId.get(b.ordenId) ?? b.ordenId` pintaría un uuid**, que
   es literalmente lo que R19 prohíbe («nunca por su identificador interno»). **Verifiqué que es
   inalcanzable**: la primera petición manda siempre `ordenes.map(o => o.id)`, así que todo id que
   vuelve en `detalle`/`bloqueadas` está en el mapa. Es código defensivo heredado de la 368, no
   deuda nueva; queda dicho por si alguien alguna vez alimenta el modal con un lote distinto.
7. **`menor` — algunas aserciones de R14 corren sus regex contra `LITERAL_CONSECUENCIA`** (la copia
   escrita a mano en el test) en vez de contra la constante exportada. **Es sano** porque un `it`
   previo fija `MSG_CONSECUENCIA_AUTORIZAR_SIN_UBICACION === LITERAL_CONSECUENCIA` y la propiedad
   se transfiere; se anota solo para que nadie borre esa aserción de amarre creyéndola redundante:
   sin ella, todo ese bloque pasaría a comparar el literal consigo mismo.

### Trampas buscadas activamente — y lo que encontré

| Trampa | Resultado |
| --- | --- |
| Aserción contra su propia fuente | **No la hay.** Los dos literales están escritos a mano en `geocodificacion-motivo-messages.test.ts` y en los dos archivos de modal, con un aviso explícito en la cabecera de cada uno. Ver el matiz 7. |
| Literal: ¿contrato o polizón? | **Los dos casos, juzgados por separado y correctos:** el `toHaveBeenCalledWith` del borde ERA el contrato y se actualizó (§5.3); el `findByText` sin ámbito de la 368 ERA un polizón y se acotó (§5.2). |
| Test verde sin datos | **No lo hay.** Los escenarios son los de producción: `conflict` con una sola orden `direccion_no_geocodificable` es literalmente la guía 76068276; `partial` es lo que la 368 dejó vivo; el lote mixto 400+407 es posible (dos causas independientes). Ningún `if (!x) return;`. |
| Guarda desactivada sin tests hostiles | **Los hay, y en los dos niveles.** Servidor: marcar un motivo no autorizable no lo desbloquea; marcar un id ajeno al lote no cambia nada; marcar UNA no arrastra a las demás; y con la marca puesta, rol/cierres/origen/tope/zona siguen abortando **sin llegar al gate**. Cliente: «la marca NO se contagia a la orden del lote que no es autorizable», con el panel enseñando solo la autorizable. |
| El test que vive dentro de lo que borras | **No se borró ningún test.** Conteo de `it` por archivo, `dev` vs rama: 27→27, 29→29, 18→30, 14→27, 24→42, 15→20, 28→31, 10→13. Las únicas líneas de test eliminadas son las 4 aserciones sustituidas por su versión acotada. |

---

## 8. Veredicto

**OK.**

Los 20 requisitos tienen test y los 20 los verifiqué yo. Las 14 mutaciones que apliqué murieron
todas, incluidas las cuatro que el arnés señala como las de mayor riesgo (R18 y R20 en los dos
modales) y las dos del guardia del texto. El alcance es el pactado: cero migraciones, cero
`db/schema.prisma`, cero `lib/repositories/`. Las tres aserciones ajenas que se tocaron quedan más
estrictas que antes, y lo medí con una mutación que separa las dos versiones. El gate completo
terminó en verde en mi propia corrida, con la base de datos enganchada y sin contención.

La única desviación del design (`role="status"`) está declarada, argumentada y —comprobado— es la
decisión correcta: el `role="alert"` que pedía §4.2 habría roto por ambigüedad ocho consultas
singulares vigentes y habría puesto dos regiones asertivas a competir.

Queda escrito, porque es verdad y no se puede deducir de ningún test verde: **nadie ha visto esta
pantalla en un navegador**, y **nadie podrá saber nunca quién autorizó una asignación** — lo
segundo por decisión del humano.

Pendiente de cierre para el leader: la entrada en `progress/history.md`.
