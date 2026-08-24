# Review — Feature 276 · el tope de intentos se cierra

> Rama `feature/276-tope-de-intentos` @ **`5e723daa`** · 21 commits sobre `origin/dev` (`821a6afe`),
> 15 sobre `dev` local (`94c824f6`). Revisión del **2026-08-24**.
>
> **Veredicto: RECHAZADO · 2 bloqueantes.** Los dos son la MISMA causa —el barrido `sed` de la
> renumeración 273→276— y **ninguno está en la lógica de la ficha**. La implementación del tope la
> he medido inyectando ocho defectos y los ocho se pusieron rojos. Lo que hay que revertir son 17
> líneas en 13 archivos ajenos y reescribir una sección de la bitácora que hoy miente sobre
> `origin/dev`.

---

## 1 · El gate, corrido por mí

```
pnpm run db:generate  -> DB_GENERATE_EXIT=0
./init.sh (COMPLETO)  -> INIT_EXIT=0
Test Files  1358 passed (1358)
     Tests  18302 passed | 26 skipped (18328)
  Duration  510.95 s
```

`INIT_EXIT=$?` se escribe **dentro** del log, en la línea siguiente a `init.sh` y sin `echo` de por
medio; el log no se canalizó por `tail`.

**Coincide exactamente con lo reportado**: 1358 archivos / 18.302 casos. El delta declarado sobre el
baseline del backend (1356 / 18.275 -> +2 archivos, +27 casos) se sostiene, y con el gate en verde
absoluto el delta contra cualquier baseline es 0 por construcción.

`pnpm run db:generate` se corrió antes, como se pidió: el cliente de Prisma se comparte entre ramas
en esta máquina.

### Los tests contra Postgres CORREN, y no en vacío

Reejecutados a mano con `--reporter=verbose`:

```
OK rechazo-tope-intentos-migration.test.ts        17 casos
OK liberacion-reprogramada-cierre-real.test.ts     4 casos
OK cierre-sin-gestion-tope-sql-real.test.ts        9 casos
Test Files  3 passed (3) · Tests  30 passed (30)
```

Ninguno `skipped`, ninguno con un `return` silencioso: los dos archivos nuevos **lanzan** (`throw new
Error`) si hay `DATABASE_URL` y la tabla `orden` está vacía o falta el catálogo. Es el patrón
correcto y es lo contrario del `passed` mudo que este repo ya se comió una vez. Además los dos
llevan contrapunto de no-vacuidad (`expect(filas.size).toBe(8)`, `expect(reales.length)
.toBeGreaterThanOrEqual(15)`, `expect(conTope.caja.flat().length).toBeGreaterThan(0)`).

---

## 2 · Mata y mide — ocho defectos inyectados, ocho rojos

Cada uno se aplicó al árbol, se corrió la suite y se revirtió. El árbol quedó limpio y en el mismo
SHA (`git status --porcelain` vacío, `5e723daa`).

| # | Defecto inyectado | Resultado medido |
| --- | --- | --- |
| 1 | Quitar la **sonda de visita real** del `select` de `findOrdenesLiberables` | ROJO **2** en `liberacion-reprogramada-cierre-real` · VERDE **11** en `liberacion-reprogramada-tope`. **Reproducido exactamente lo que la bitácora declara**: la suite de dobles no ve el `select`, y ese test de Postgres es la única cobertura real de la raíz de la ficha. |
| 2 | Desactivar la puerta del tope en `MisAsignacionesService.gestionar` (R1/R5) | ROJO **7** de 14 |
| 3 | `resolverCierre` vuelve a mandar **todo** a bodega (como antes de la 276) (R21) | ROJO **5** en `cierre-sin-gestion-tope-sql-real` |
| 4 | 💰 La gestión sintética entra en **ESTE** cierre (`cierreId` en vez de `null`) | ROJO **3** (integración + el caso emparejado de dinero) |
| 5 | 💰 El `updateMany` del rechazo **limpia** el mensajero | ROJO **3**: la orden se queda en `rechazada` y la 139 ya no la lleva a `por_devolver_a_tienda` |
| 6 | La UI: `orden.enElTope === true` -> `!== false` | ROJO **10** en dos archivos |
| 7 | Desactivar la puerta de asignación de bodega central (R18) | ROJO **4** |
| 8 | El composition root deja de **pasar** `historial` | ROJO **1** en `gestion-desde-ayuda-cableado` **y** `tsc` falla: «Property 'historial' is missing … but required in type 'GestionDesdeAyudaDeps'» |

Los cinco puntos que se pidió auditar quedan **confirmados por medida, no por lectura**:

1. **El `select` es la raíz y solo Postgres lo cubre** — mutación 1, idéntica a lo declarado.
2. **`cierre_id NULL` mueve el cobro al siguiente cierre** — mutación 4: hay test y muere si se
   cambia, en los dos niveles (Postgres y el caso emparejado de feeds).
3. **El `updateMany` CONSERVA el mensajero a propósito** — mutación 5: **sí hay test que lo afirma**
   (caso 1, «acaba en `por_devolver_a_tienda`»), y cae.
4. **La UI no compara números** — `GestionarOrdenPanel.tsx:280` filtra con `permitidoEnElTope`;
   `GestionarDesdeAyudaModal.tsx:327` usa `orden.enElTope === true`. Ninguno de los dos nombra
   `reintentosConfig` ni `MIN_INTENTOS_ENTREGA` (comprobado sobre el código, no la prosa).
5. **Composition roots** — los cuatro (`gestion-desde-ayuda`, `ordenes-guia`, `recepcion-satelite`,
   `resolver-novedad`) **construyen y pasan** un `OrdenHistorialService` real. La dependencia es
   obligatoria y quitarla es rojo de typecheck **y** de test. No queda ningún notificador en su
   default no-op.

---

## 3 · Checklist de `CHECKPOINTS.md`

| | Criterio | Estado |
| --- | --- | --- |
| OK | `requirements.md` con EARS numerados R1–R38 | 38 requisitos |
| OK | `design.md` con alternativas descartadas y su porqué | seis (§2.2, §5.6, §8 A-F) |
| **NO** | `tasks.md` con **todas** las tasks marcadas `[x]` | **cero `[x]` en todo el archivo** (menor 1) |
| OK | Cada `R<n>` mapea a un test concreto | R1–R38, verificados uno a uno abriendo el test |
| OK | `progress/impl_276.md` contiene el mapa `R -> test` | 581 líneas, dos tandas |
| OK | `pnpm run typecheck` | 0 errores |
| OK | `pnpm run lint` | 0 errores · 100 warnings, todos preexistentes |
| OK | `pnpm test` | 18.302 verdes |
| n/a | E2E para flujos críticos | **inaplicable de hecho**: hay 20 specs en `e2e/` pero 13 llevan `NOT EXECUTED` y no hay harness. La ficha no añade ninguno. Ver menor 7. |
| n/a | RLS en tablas nuevas | no hay tabla ni columna nueva; solo un `value` de enum |
| OK | Migración con `down.sql` y reversible | `20260824120000_…` + `down.sql`, con test contra Postgres que **ejecuta** el down y comprueba que la base sigue legible |
| OK | Ningún secreto hardcodeado | — |
| n/a | Webhooks nuevos | ninguno; el vocabulario público no cambia |
| ⚠️ | Controller sin queries · Service sin HTTP · **Repository sin lógica de negocio** | el reparto en dos destinos (`>= umbralIntentos`) vive en `CierresAdminRepository`. Justificado —el conteo tiene que ocurrir DENTRO de la tx— y sigue el molde del bloque 109 que ya estaba ahí, con el umbral **inyectado** desde el servicio. Ver menor 10. |
| OK | Interfaces en `lib/interfaces/` por categoría | `ICierresAdminRepository`, `ILiberacionReprogramada*`, `IMisAsignacionesService` |
| OK | Páginas protegidas / Server Actions | ninguna ruta ni endpoint nuevo |
| OK | Sin hardcode de país, moneda ni umbral | el umbral sale de `reintentosConfig` en los cinco puntos nuevos; el módulo puro lo recibe por parámetro |
| OK | `./init.sh` en verde | `INIT_EXIT=0`, medido por mí |
| **NO** | Entrada en `progress/history.md` | no existe todavía (menor 3) |

---

## 4 · Hallazgos

### BLOQUEANTE 1 — el barrido 273→276 corrompió 17 citas en 13 archivos de OTRAS fichas

`git diff --stat dev...HEAD` sobre esos 13 archivos: **17 inserciones, 17 borrados, y las 34 son la
misma sustitución textual**. Ni una sola línea legítima. Lo corrompido no es adorno:

| Archivo | Qué decía | Qué dice ahora |
| --- | --- | --- |
| `specs/170-export-todas-las-tablas/design.md` | `OrdenService.ts:273-280` | `OrdenService.ts:276-280` |
| `specs/175-…/design.md` (x2), `requirements.md`, `tasks.md` | `metrics.test.ts:273` | `metrics.test.ts:276` |
| `specs/133-…/design.md`, `tasks.md` | bloque `273-300` / `132-R1/R8 (273)` | `276-300` / `(276)` |
| `specs/217-…/design.md` | `globals.css :213,215 y :273,275` | `:276,275` — un rango descendente, sin sentido |
| `specs/223-…/design.md`, `requirements.md`, `tasks.md` | `factura-contraste.guardia.test.ts:251-273` / `:265-273` | `:251-276` / `:265-276` |
| `specs/262-…/design.md` | `lib/types/orden-historial.ts:266-273` | `:266-276` |
| `tests/unit/guards/ancla-de-carga.guardia.test.ts` | «las esperas ancladas a un MOCK — **273** en el arbol al escribir esto» | «**276** en el arbol» — una **medida** falsificada |
| `tests/components/AnaliticaPage.test.tsx` (x2) | «un total puede pintarse formateado (₡918 273,45)» | «₡918 276,45» — y la constante de al lado sigue siendo `CIFRA_BRUTA = "918273.45"`: **el comentario de un guard de dinero contradice ahora su propia constante** |

Y hay una agravante que no es de forma: el mensaje del commit `8f4e1cca` afirma que «antes del
barrido se descartaron cuatro falsos positivos comprobados uno a uno —numeros de linea, un conteo de
warnings, una duracion y el importe ₡918 273,45—». **Dos de esos cuatro sí se cambiaron** (el conteo
de `ancla-de-carga` y el importe ₡918 273,45), y los números de línea se cambiaron en ocho sitios.
La afirmación del commit es falsa contra su propio diff.

Es exactamente la patología que ese mismo mensaje dice perseguir —«dejarlas apuntando al numero de
OTRA ficha seria la patologia que este repo persigue»— aplicada en la dirección contraria: ahora son
las citas de **siete fichas ajenas** las que apuntan a líneas que no son.

**Qué falta para cumplirlo:** `git checkout dev --` los 13 archivos (enumerados arriba; ninguno tiene
un solo cambio legítimo que se pierda) y volver a correr el gate.

---

### BLOQUEANTE 2 — la sección «COLISIÓN DE IDS» de la bitácora es falsa, y es la que el leader va a leer para decidir el merge

`progress/impl_276.md` (líneas 386-411) afirma que al hacer el `git fetch` final `origin/dev` había
pasado a `821a6afe` y que **en ese avance otra sesión registró los ids 276, 277 y 275**, con esta
tabla:

| id | lo que la bitácora dice que hay en `origin/dev` |
| --- | --- |
| **276** | tarifas ligadas a la zona · `in_progress` |
| **277** | cobro por zona + tienda · `pending` |
| **275** | configuración de tarifas · `pending` |

y añade que existe la rama remota `origin/feature/276-tarifas-por-zona-catalogo-vehiculos`, que «el
merge a `dev` va a dar conflicto en `feature_list.json` sí o sí» y que «resolverlo a favor de los dos
dejaría dos features distintas con el id 276».

**Medido por mí sobre `origin/dev` = `821a6afe`, que es el mismo commit que cita la bitácora:**

```
max id en origin/dev: 275
273  in_progress  tarifas ligadas a la zona: modelo, borrado fisico y catalogo
274  pending      cobro por zona + tienda: cascada de resolucion de tarifa
275  pending      configuracion de tarifas: sin `status` y con la prioridad visible
```

y `git ls-remote --heads origin` devuelve **`refs/heads/feature/273-tarifas-por-zona-catalogo-vehiculos`**.
No existe ninguna rama `feature/276-…`.

Es decir: **276 y 277 están LIBRES en `origin/dev`**, la renumeración fue correcta, y **no hay
ninguna colisión viva que resolver**. Lo que pasó es que el mismo `sed` reescribió la propia tabla de
la colisión (la columna izquierda decía `273 | 274 | 275` y quedó `276 | 277 | 275`, con el `275`
intacto porque no contenía «273» — la firma exacta del barrido) y con ella el nombre de la rama
remota.

Por qué es bloqueante y no cosmético: esa sección termina con «por qué no lo toco: es una decisión
del leader», o sea que está escrita **para que otro decida sobre esos datos**. Un leader que la lea
va a creer que tiene una colisión de ids que no tiene y va a resolver un conflicto que no existe.

**Qué falta para cumplirlo:** reescribir esa sección con lo medido —`origin/dev` usa 273/274/275 para
las fichas de tarifas, 276 y 277 están libres, la renumeración quedó bien— o borrarla, ya que la
sección «Renumerado 273 → 276» de más abajo ya cuenta la historia correcta. Y dejar dicho que el
merge de `feature_list.json` sí tendrá conflicto, pero por otra razón: **`dev` local (`94c824f6`) NO
es ancestro de `origin/dev`** (6 commits propios, 17 por detrás), y esos 6 commits locales registran
las fichas como 273/274.

---

### menores

1. **`specs/276-tope-de-intentos/tasks.md` no tiene ni un `[x]`.** `CHECKPOINTS.md` lo exige
   literalmente («todas las tasks estan marcadas `[x]`») y las tres fichas vecinas sí los usan (271:
   58, 239: 35, 268: 13). El trabajo está hecho —lo he verificado task por task— pero el criterio
   formal de `done` no se cumple hasta que se marquen.
2. **`progress/current.md` y el `status_note` de la 276 quedaron en la foto del backend.** Los dos
   dicen «backend hecho y verde, **falta frontend**» cuando T11/T12 están completos desde
   `5e723daa`, y el `status_note` cita `progress/impl_273.md`, que **no existe** (se renombró a
   `impl_276.md`). T18 pedía las dos cosas al día.
3. **No hay entrada en `progress/history.md`.** Pendiente para cerrar la ficha.
4. **`lib/types/tope-intentos.ts` SÍ tiene el defecto de `quitarComentarios`, al contrario de lo que
   dice la bitácora.** Su línea 9 lleva la frase «sin `next/*`» dentro de un comentario `//`, y eso
   abre bloque igual que en los dos componentes. La bitácora afirma que ese archivo «no tiene el
   problema» porque «allí la misma frase vive dentro de un bloque `/** … */`» — no es cierto, es una
   línea `//`. Hoy no se come ni una línea de código **por casualidad**: entre esa línea y el
   siguiente cierre de bloque (línea 39) solo hay comentarios. El día que alguien meta un `import`
   ahí, desaparece del texto que ven las guardias.
5. **`tests/unit/types/tope-intentos.test.ts:104-106` reimplementa el quitador en línea** en vez de
   usar `quitarComentarios`, que es el punto único de la feature 209 — y duplica justo la función con
   el defecto conocido. El caso se salva porque lleva su aserto positivo (`toMatch` del `import
   type`), que está en la línea 1.
6. **R31 tiene una excepción que solo vive en un comentario de test.** El propio
   `tope-intentos-invariante.guardia.test.ts` censa `incidente -> por_recoger via incidente` y la
   declara «la ÚNICA de esta lista que SÍ pone la orden en la mano de un mensajero sin pasar por la
   puerta del tope … límite conocido de esta ficha». Es defendible —es la **reversión** de
   `por_recoger -> incidente` (`IncidenteAdminService`, destino derivado del historial), misma
   familia que `deshacer_asignacion`, que el design sí dejó fuera por escrito— pero R31 está
   redactado en absoluto y ni requirements ni `design §12` la recogen. **Debe subir al spec**, no
   quedarse en un comentario: es la sexta vía de un design que dice que hay cinco.
7. **Dos specs de `e2e/` describen ahora un flujo que la ficha prohíbe** (los dos con `NOT EXECUTED`,
   así que nada se pone rojo):
   - `e2e/reintentos-escalado.spec.ts` — «la 3.ª devolución escala a `rechazada`». Con la 276, a los
     2 intentos `devuelta` **ya no se puede registrar**: ese escenario es inalcanzable.
   - `e2e/reprogramacion-liberacion.spec.ts` — asume que el cron libera por fecha sin mirar el
     cierre, que es literalmente la raíz que esta ficha cierra.
8. **Los comentarios de la migración dicen «feature 273», y la decisión de no tocarlos es CORRECTA.**
   Editar el SQL de una migración ya aplicada cambia su checksum y produce el drift que este repo ya
   pagó. Lo que sí hay que saber: 273 ya es **otra** ficha mergeada en `dev` (tarifas), así que ese
   comentario apunta hoy a la ficha equivocada. No se arregla aquí. **Fuera de ahí sí hay referencias
   mal apuntadas: son las del BLOQUEANTE 1.**
9. **El botón «Reprogramar» de la fila de `/novedades` — ACEPTABLE, no bloqueante.** R8 habla de «las
   dos superficies que crean gestión»; la que crea gestión es el modal, y el modal no abre el modo:
   no monta fecha, ni motivo, ni selector de fotos, ni confirmar. Coste medido: un clic y una ventana
   que se cierra. Cero evidencia subida, cero gestión, cero dinero, y el servidor rechaza igual (R11,
   con cuatro casos). El sitio correcto para arreglarlo es `ACCIONES_POR_GRUPO` (tabla por grupo de
   la 236), que no modela decisiones por fila — ficha corta con dueño claro, no un parche.
10. **Lógica de negocio en `CierresAdminRepository`** (el `>= umbralIntentos` que parte el conjunto).
    `CHECKPOINTS.md` dice «Repository solo ejecuta queries Prisma, sin logica de negocio». Está
    justificado (el conteo debe verse desde dentro de la transacción, y el umbral llega **inyectado**
    desde el servicio), y el bloque vecino de la 109 ya vivía ahí. Se anota, no se bloquea.
11. `MOTIVO_RECHAZO_TOPE_INTENTOS` se declara **en medio del bloque de `import`s** de
    `CierresAdminRepository.ts`.
12. En el rechazo, tras `if (movidas.count > 0)` el bucle recorre **todos** los `ids`, no solo los
    movidos. Inalcanzable en la práctica (las órdenes se leyeron en la misma tx con
    `estatusId = sin_gestionar`), pero la guarda y el bucle no hablan del mismo conjunto.
13. `SUFIJO = "273t9-…"` en `cierre-sin-gestion-tope-sql-real.test.ts:44`.

---

## 5 · El agujero de `quitarComentarios`, confirmado y dimensionado

**Confirmado.** `tests/fixtures/sin-comentarios.ts:58` hace la pasada de **bloque antes** que la de
línea: primero `replace(/\/\*[\s\S]*?\*\//g, …)` y después la de `//`. Así que cualquier `/*` que
aparezca dentro de un `//` —o dentro de una cadena— abre un bloque fantasma que se come todo hasta el
siguiente cierre, decenas de líneas más abajo. No falla ruidosamente: **el censo ve menos y su verde
se lee igual que el bueno.**

**Tamaño, medido sobre el árbol** (todo `.ts/.tsx/.js/.jsx/.mjs` salvo `node_modules`, `.next`,
`.claude`), comparando el quitador del repo contra una máquina de estados correcta:

| | |
| --- | --- |
| Sitios con un `/*` dentro de un comentario `//` | **62** (68 ocurrencias) |
| Sitios con un `/*` dentro de una cadena (globs, regex) — mismo efecto | **128** (139 ocurrencias) |
| **Archivos en los que al menos una línea de código REAL queda invisible** | **131** |
| **Líneas de código borradas del texto que ven las guardias** | **3.847** |
| Suites que leen código a través de este quitador | **159** |

Los peores, y los que importan porque son **código de producción** (9 archivos, ~153 líneas):

```
79  lib/auth/menu-visibility.ts                     (lineas 243-369)
33  lib/services/CotizacionOrdenService.ts          (9-42)
13  app/(app)/ordenes/_components/carga-masiva-error-chips.ts
11  lib/analytics/entregas-conteo.ts
 7  lib/config/reparto-mensajero.ts
 4  app/(app)/monitoreo/_components/detalle-columnas.ts
 4  lib/interfaces/services/ICotizacionOrdenService.ts
 1  lib/ranking/snapshot-dia.ts · lib/services/destino-creacion.ts
```

El caso testigo: `lib/auth/menu-visibility.ts:228` escribe la ruta `/mis-asignaciones/*` dentro de un
`//`, y eso **borra las líneas 243-369 —79 líneas de `SIDEBAR_ITEMS`—** para cualquier guardia que lea
ese archivo con el quitador. Y hay una que lo lee:
`tests/unit/guards/roles-analitica-acceso-vs-dominio.test.ts:116` censa su fuente.

**Hoy no hay ninguna guardia roja ni ninguna ciega de verdad**: comprobado que
`ROLES_ACCESO_ANALITICA` se declara en la línea **155**, fuera del tramo borrado. Es un agujero
**latente**, no vivo. Pero es de la familia «el verde que afirma de menos», y con 131 archivos y 159
suites lectoras, la siguiente guardia que se escriba sobre cualquiera de esos archivos puede nacer
ciega sin que nada lo diga.

**Esto excede la ficha 276** —le preexiste, y la 276 fue quien lo cazó, con un aserto positivo de
anti-vacuidad y no con los `not.toContain` de al lado— así que **no lo cuento como bloqueante suyo**.
Pero no hay ficha que lo recoja, y debería haberla: invertir el orden de las dos pasadas (o pasar a
una máquina de estados) es un cambio de dos líneas en `sin-comentarios.ts` cuyo radio de impacto son
esas 159 suites, así que **necesita su propia ficha y su propio gate completo**, no un parche
oportunista dentro de ésta.

---

## 6 · Lo que queda pendiente de DESPLIEGUE (declarado, no bloquea el merge)

**R37 sigue a medias, y yo tampoco lo pude cerrar.** El SQL de solo lectura está escrito, corre y
devuelve la forma esperada; la ejecución que vale es la del spec (sección «MEDICIÓN DE R37,
EJECUTADA», 2026-08-24, firmada), y esa foto **caduca**. El implementer no tenía el MCP de Supabase;
**yo tampoco lo tengo en mi juego de herramientas** (la llamada a `execute_sql` devuelve «No such
tool available»), así que no he podido re-medirla. Se repite tal cual: **se vuelve a ejecutar la
consulta (A) inmediatamente antes de desplegar**, y si aparece cualquier orden en el umbral fuera de
`devuelta`, se para (Q6): R18 la dejaría inasignable sin que nadie lo haya decidido.

**Y hay un segundo número que T0 pedía y que NUNCA se midió contra producción:** la consulta (B) —
cuántas órdenes en `reprogramada` con gestión de visita real en un cierre **no aprobado**—. Es
exactamente **el tamaño de la población que T6 congela el primer día**, o sea la mercadería que se
queda parada. El implementer lo declaró abierto y hace bien en no inventárselo, pero T0 lo exigía «en
la misma corrida» y sigue sin haberse hecho. **Debe medirse antes de desplegar**, no después: si son
dos órdenes es una nota al pie, y si son cuarenta es una conversación con el humano.

---

## 7 · Trazabilidad R1–R38

Verificada **abriendo cada test**, no leyendo la tabla. Los 38 mapean a un aserto que muerde el
requisito. Los que revisé con más lupa por tocar dinero o por ser el corazón de la ficha:

| R | Cómo se comprueba que muerde |
| --- | --- |
| R1/R5 | `mis-asignaciones-tope-intentos` 5: el doble de `IFileStorage` recibe **cero** subidas y el repo **cero** escrituras. Cae si la guarda se mueve detrás del upload (mutación 2). |
| R3 | `tope-intentos.test.ts` 3 recorre **los cinco** values del enum y deriva el veredicto de la pertenencia — probada como inclusión, no como negación. Y comprueba antes que la lista de permitidos está contenida en el censo del enum. |
| R7 | Seis suites con `REINTENTOS_MIN_INTENTOS = 5`; `alcanzaElTope(3,5) === false` mata cualquier `3` a mano. |
| R12/R14/R15 | Los dobles (11 casos) **y** el de Postgres (4 casos, 9 semillas con la gestión anulada llevando los hechos **invertidos**, para que equivocarse de gestión sea detectable). La mutación 1 confirma que solo el segundo muerde. |
| R21/R22/R23 | `cierre-sin-gestion-tope-sql-real` 1, 1b, 1c, 1d contra Postgres, pasando por el choke point real (140). |
| R24 | `cierres-admin-service.aprobar.sin-gestion` -> caso **emparejado**: el mismo cierre semilla con y sin una orden en el umbral, feeds reales, comparación campo a campo, **más dos contrapuntos obligatorios** (los feeds mueven dinero de verdad; y `gestionOrden.create` se llamó 1 vez en una corrida y 0 en la otra, o sea que la rama nueva se ejecutó). |
| R26 | Aprobar dos veces: la segunda devuelve `conflict`, una fila, una gestión. Idempotencia por construcción, sin código de idempotencia. |
| R33 | `tope-intentos-invariante.guardia` fija `RESULTADOS_QUE_CUENTAN_COMO_INTENTO` y `ORIGEN_TIPOS_VISITA_REAL` por igualdad **literal** — y aquí el literal ES el contrato, no una copia de su fuente. |
| R38 | `tope-intentos-pii.guardia` con contrapunto (`texto.length > 20`) y el aviso del cron **ejercitado de verdad** contra ids sembrados. |
| R36 | El `down.sql` **se ejecuta** contra Postgres y se comprueba que deja el enum como estaba y la base legible. Y que aplicar+revertir no cambia el `estatus_id` de ninguna orden (R35). |

**La 218 está realmente absorbida, no solo declarada.** Su decisión —qué pasa con la orden barrida a
`sin_gestionar` que ya agotó sus intentos— está en código (`resolverCierre`), en la arista
`sin_gestionar -> rechazada` del grafo, en el valor de enum `rechazo_tope_intentos` con su productor
en el mismo commit, y medida contra Postgres en 9 casos. Su ficha en `feature_list.json` quedó
`superseded` con la nota que lo explica. **Y lo hizo sin tocar el criterio de conteo** (R33): lo que
la 218 existía para decidir —si `sin_gestionar` cuenta como intento— se resolvió con un «no cuenta;
lo que cambia es el destino».

---

## 8 · Veredicto

**RECHAZADO — 2 bloqueantes.**

Los dos son la misma causa (el `sed` de la renumeración) y **ninguno toca la lógica de la ficha**:

1. 17 citas corrompidas en 13 archivos de siete fichas ajenas, incluido el comentario de un guard de
   dinero que ahora contradice su propia constante, y un mensaje de commit que afirma lo contrario de
   su diff. -> `git checkout dev --` los 13 archivos.
2. La sección «COLISIÓN DE IDS» de `progress/impl_276.md` describe un `origin/dev` que no existe y
   pide al leader una decisión sobre datos falsos. -> reescribirla con lo medido: 276 y 277 están
   libres, la renumeración quedó bien.

Los dos se arreglan en minutos y **no requieren volver a tocar código de producción**, pero sí exigen
recorrer el gate otra vez.

**Lo que sí quiero dejar dicho, porque es la parte cara:** el tope está bien cerrado. Las cinco vías
tienen puerta, la sexta (Q2) también, el `select` que es la raíz está cubierto por el único test que
puede cubrirlo, el `cierre_id NULL` que decide de qué cierre sale el dinero tiene test y muere si se
cambia, el mensajero que el `updateMany` conserva no es un olvido y hay un aserto que lo prueba, la
UI no reimplementa la regla, y los cuatro composition roots pasan la dependencia de verdad. Ocho
defectos inyectados, ocho rojos. En una ficha que **invierte la dirección del error hacia cobrar de
más**, eso es lo que había que medir, y está medido.

**Antes de desplegar, y esto no lo cierra el merge:** re-ejecutar la consulta (A) de R37 contra
producción, y medir por primera vez la consulta (B) —cuántas órdenes congela T6 el primer día—.
