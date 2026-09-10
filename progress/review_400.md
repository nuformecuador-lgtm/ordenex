# Revisión — Feature 400 · «Un fallo de configuración del geocodificador no debe bloquear la asignación»

> Rama `feat/400-fallo-config-no-bloquea-asignacion` (`b31ff729` backend · `fd13f76c` spec + medición
> de producción · `2579ab20` UI), sobre `079c4ec7`.
> Revisado el 2026-09-09 en el worktree `agent-a954a48cdb9c9aa76`. **No se editó código de producción**:
> las mutaciones se aplicaron sobre copias de seguridad y se restauraron una a una; el árbol quedó
> idéntico a `HEAD` (`git status --porcelain` vacío, `typecheck` limpio) antes de escribir esto.
>
> El MCP `codebase-memory` **sí** estaba en mi conjunto de herramientas, pero para una rama con 35
> archivos tocados lo eficiente fue leer el `git diff` y abrir los archivos; todo lo que se afirma
> aquí está confirmado **en el archivo real**, no en el índice.

## VEREDICTO: **OK** — aprobada con reservas

**0 bloqueantes.** 10 hallazgos `menor`, dos de ellos medidos con mutaciones que sobrevivieron y que
conviene cerrar antes de que la 401 se apoye en esto. Los 36 requisitos tienen test, y los tests que
dicen cubrirlos los cubren: lo comprobé uno por uno abriendo el archivo, y maté 10 de 12 mutaciones
propias.

---

## Checklist

### Especificación
- [x] `specs/400-…/requirements.md` con 36 requisitos EARS numerados R1-R36, con su origen medido.
- [x] `specs/400-…/design.md` con **diez** alternativas descartadas (§8, A1-A10) y su porqué.
- [x] `specs/400-…/tasks.md` existe, con las 25 tareas y su grafo de dependencias.
- [ ] «todas las tasks marcadas `[x]`» — **no aplicable tal cual**: este `tasks.md` no usa casillas,
      usa `**Hecho cuando:**` (28 apariciones). Ver `menor-6`.

### Trazabilidad
- [x] Cada `R<n>` mapea a al menos un test concreto. Verificado **uno por uno** (tabla abajo).
- [x] `progress/impl_400_backend.md` y `progress/impl_400_frontend.md` contienen el mapa `R<n> → test`.
      La unión de los dos cubre R1-R36 sin huecos y sin ninguna fila que diga «pendiente».

### Calidad de código
- [x] `pnpm run typecheck` limpio (lo corrí yo, dos veces: al empezar y tras restaurar).
- [x] `pnpm run lint` sin hallazgos (dentro del gate).
- [x] `pnpm test` — suite entera verde, corrida por mí. Detalle abajo.
- [x] E2E: no aplica. No hay harness de Playwright en este repo y los specs previos lo declaran
      «NOT EXECUTED». La ficha toca asignación de mensajero (no auth/pagos/recaudo/webhooks).
      El riesgo se cubre por otra vía; ver `menor-5` sobre lo que T17 **no** alcanzó.

### Datos y seguridad (Supabase)
- [x] Tabla nueva: **ninguna** → no hay RLS que activar. `jobs` conserva su política.
- [x] Migraciones: **ninguna**. El aviso de `down.sql` del gate son tres migraciones de agosto
      (`20260814…`), preexistentes y ajenas.
- [x] Sin secretos hardcodeados. El marcador es `"[geocode:config]"`, un literal sin PII, sin
      credencial, sin URL y sin dígitos — afirmado a mano en el test de R14 y verificado por mí.
- [x] Webhooks: no aplica, no se añade ninguno.
- [x] **Idempotencia** donde sí aplica (el backfill de R17): probada contra Postgres real, y
      **mutada por mí** (`MUT-4`).

### Patrón de capas
- [x] Controller sin lógica: las dos Server Actions son `return service.asignarDesdeBodega(data, actor)`
      y `return service.asignar(data, actor)` — passthrough literal, sin reconstruir el objeto. Lo
      verifiqué a propósito: si reconstruyeran campo a campo, `sinUbicacion` se caería en silencio al
      cruzar el borde y sería el fallo mudo clásico de este repo. No es el caso.
- [x] Service sin HTTP. `AsignabilidadCoordenadasService` recibe `IJobRepository` por constructor.
- [x] Repository solo Prisma. `OrdenGeocodeRepository.guardarResultado` no gana lógica.
- [x] Interfaces en `lib/interfaces/services/`, separadas por categoría.
- [x] Módulo nuevo `lib/geo/fallo-config-geocode.ts` sin dependencias — correcto: lo importan un
      emisor y un lector que no deben arrastrarse.

### Permisos / multi-país
- [x] Sin cambios de permisos: los gates de rol corren **antes** del gate de coordenadas, intactos.
- [x] Sin hardcode de país, moneda ni cuenta.

### Verificación final
- [x] `./init.sh` completo, corrido **por mí**, `INIT_EXIT=0`.
- [x] `progress/review_400.md` — este archivo.
- [ ] Entrada en `progress/history.md` — **no existe** todavía. Ver `menor-7` (paso de cierre del leader).

---

## Verificación ejecutable — la corrí yo, no me fié de la bitácora

`./init.sh` completo, con el árbol quieto y sin ningún subagente mutando nada:

```
 Test Files  1832 passed (1832)
      Tests  26460 passed | 26 skipped (26486)
   Duration  996.83s
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1832 ejecutado(s), todos en el baseline conocido)
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
INIT_EXIT=0
```

Cuadra al test con lo que reportó `frontend_dev` (26.460 / 26). Y lo que de verdad importa según la
memoria del repo — **mirar los `skipped`, no solo el `INIT_EXIT`** — lo comprobé por separado:

| Comprobación | Medido por mí |
| --- | --- |
| ¿Se saltó `tests/integration/db/`? | **No.** El gate imprime `✓ DATABASE_URL resuelta: los 146 archivos de tests contra Postgres SI se ejecutan`, y el log lleva **224** líneas de `tests/integration/db/`. |
| ¿Corrió el test del backfill? | Sí: `✓ tests/integration/db/backfill-marcador-config-geocode.test.ts (6 tests) 458ms`. |
| ¿De quién son los 26 `skipped`? | Ajenos y preexistentes: `AnaliticaPage.test.tsx (58 tests \| 17 skipped)` y `AnaliticaShell.test.tsx (15 tests \| 9 skipped)`. Ninguno de la 400. |
| ¿Y no será un verde por vacío? | No. La corrida del backfill **caza una mutación del `WHERE`** (`MUT-4`, 2 rojos), así que ese archivo toca datos de verdad. |
| Los 11 archivos de test de la ficha | Todos verdes y con casos: `fallo-config-geocode` (13), `marcador-…-guardia` (14), `geocodificacion-marcador-contrato` (26), `asignabilidad-coordenadas` (48), `guia-asignacion-gate-coordenadas` (26), `asignacion-satelite-gate-coordenadas` (18), `geocodificacion-motivo-messages` (42), `geocodificacion-motivo-por-orden-…guardia` (12), `AsignarBodegaModal` (28), `AsignarSateliteModal` (33), `backfill…` (6). |

---

## Mutaciones propias — 12 aplicadas, **10 muertas, 2 supervivientes**

Los implementadores reportaron 7 y 8. Busqué las que no probaron. Procedimiento: copia de seguridad
del archivo → mutación → corrida dirigida → restauración **desde la copia**, nunca `git checkout`.

| # | Mutación | Resultado |
| --- | --- | --- |
| MUT-1 | `Record<EstadoBloqueante, string>` → `Record<string, string>` en el mapa de mensajes | **MUERTA** — 2 rojos en el guardia `400/T13`. Confirma el punto 1: el cierre es real. |
| MUT-1c | Comentario señuelo con la anotación buena **encima**, y la real como `Record<EstadoBloqueante \| string, string>`, + estado nuevo sin mensaje | **SUPERVIVIENTE** — typecheck limpio y 116/116 verdes. Ver `menor-2`. |
| MUT-1d | Lo mismo **sin** el comentario señuelo | **MUERTA** — 1 rojo. El señuelo es imprescindible para colarla: la mutación realista muere. |
| MUT-2 | `EstadoBloqueante` deja de derivarse (`Exclude`) y se escribe a mano con los 5 literales, + un sexto estado bloqueante nuevo sin mensaje | **SUPERVIVIENTE** — typecheck limpio y **129 archivos de guardias + los de la 400: 1999 tests verdes**. Ver `menor-1`. |
| MUT-3 | `esFalloConfigGeocode` usa `includes` en vez de `startsWith` | **MUERTA** — 3 rojos (el «lo menciona en medio» de R2 y R11). |
| MUT-4 | El `UPDATE` del backfill pierde `AND "estado" = 'failed'` (el conteo lo conserva) | **MUERTA** — 2 rojos contra Postgres real: la fila testigo `pending` se tocó. |
| MUT-5 | El gate deja de exigir estado no-`done` (solo mira el marcador) | **MUERTA** — 1 rojo: el job `done` con marcador debe re-encolarse (R5). |
| MUT-6 | En el **satélite**, el conteo se mueve DESPUÉS del `continue` | **MUERTA** — 4 rojos en el archivo del satélite, y el de bodega **verde**: la asimetría se distingue (design §9). |
| MUT-7 | `mensajeAsignadasSinUbicacion`: `n <= 0` → `n < 0` (con cero ya no calla) | **MUERTA** — 1 rojo en R33. El test de modal se queda verde (el modal filtra por truthiness antes), así que la red que la caza es la del módulo: existe y funciona. |
| MUT-8 | Cambia el VALOR del marcador (`[geocode:config]` → `[geocode:cfg]`) | **MUERTA** — 2 rojos. El guardia lo importa (y por eso sigue verde, correcto), pero el literal escrito a mano de R14 lo caza. Es la prueba de que el «afirmado a mano» no era decorativo. |
| MUT-11 | **Solo** `GeocodeNoConfiguradoError` deja de marcar (la credencial ausente; el otro camino intacto) | **MUERTA** — 4 rojos. Las DOS causas propias tienen testigo por separado, no una sola. |
| MUT-12 | Estado nuevo en `EstadoAsignabilidad` con la derivación **intacta** | **MUERTA en typecheck** — `error TS2741: Property 'geocodificacion_cuota_agotada' is missing … but required in type 'Record<EstadoBloqueante, string>'`. **R25 se cumple hoy**, y esto lo demuestra directamente. |

---

## Trazabilidad R → test, verificada abriendo el archivo

Recorrido uno por uno. Marco con ✔ lo que comprobé que **verifica de verdad** el requisito, no que
exista un test con nombre parecido.

| R | Test | ¿Lo cubre? |
| --- | --- | --- |
| R1 | `asignabilidad-coordenadas.test.ts::400/R1` — los tres estados parametrizados, + `enqueue` no llamado | ✔ |
| R2 | idem `::400/R2` — mismo texto SIN prefijo, `lastError: null`, y mención en medio | ✔ La versión «mismo texto sin prefijo» es la buena: prueba que la detección no cuelga de la prosa |
| R3 | idem `::400/R3` — con coordenadas `findByDedupeKeys` **no se llama**; y el marcado gana a la rama por estado | ✔ Es una aserción de ORDEN, no de resultado |
| R4 | idem `::400/R4` — parametrizado sobre los tres status deterministas, + `findByDedupeKeys` no llamado | ✔ |
| R5 | idem `::400/R5` — sin job, y job `done` **con** marcador → se encola | ✔ Matada por `MUT-5` |
| R6 | `guia-asignacion-gate-coordenadas.test.ts::400/R6` + espejo satélite | ✔ Comprueba que entra en `resultados`, no en `detalle`, y que el lote sale `ok` |
| R7 | los dos `::400/R7` — doble que **lanza** si le pasan `latitud`/`longitud`/`geocodeStatus`/`geocodedAt`, con no-vacuidad explícita | ✔ |
| R8 | `geocodificacion-service.test.ts::400/R8` — `OrdenGeocodeRepository` **real** con `prisma.orden.updateMany` doblado; `toEqual` **literal** del `where` | ✔ Ver punto 3 abajo |
| R9 | `optimizacion-ruta-degradacion.test.ts::400/R9` — 4 casos: no aborta, excluye del cálculo, y la parada **sigue apareciendo** | ✔ Ancla de no-regresión de 92/R37 |
| R10 | `asignabilidad-coordenadas.test.ts::400/R10` + `JSON.stringify(r)` en los dos gate-tests + `geocodificacion-motivo-messages.test.ts::400/R10` | ✔ Triple: tipo, runtime y serialización |
| R11 | `geocodificacion-marcador-contrato.test.ts::400/R11` — camino entero **sin doble intermedio**: service real → recorte de 500 → `JobDTO` → gate real. Las DOS causas × 3 estados | ✔ Este es el mejor test de la ficha |
| R12 | `fallo-config-geocode.test.ts::400/R12` (2000 → 500, sigue detectándose) **+ contraprueba** de que un sufijo NO habría sobrevivido + el caso punta a punta en el contrato | ✔ La contraprueba convierte una afirmación de diseño en algo falsable |
| R13 | `marcador-fallo-config-declaracion-unica.guardia.test.ts` — barre `lib/`, `app/`, `scripts/` y `tests/`, con no-vacuidad (`>100` fuentes) y 3 contrapruebas | ✔ Lee el árbol real; **el guardia importa el literal**, no lo copia |
| R14 | `fallo-config-geocode.test.ts::400/R14` — literal escrito a mano | ✔ Matado por `MUT-8` |
| R15 | Tests vigentes que siguen verdes + `lib/clients/google-geocode.ts` **sin tocar** (`git diff --stat`) | ✔ con matiz: el test «ningún detalle de outcome transitorio filtra credencial, URL ni dirección» **incluye el caso `REQUEST_DENIED`** entre sus tres casos pese a su nombre, así que el camino de configuración sí queda cubierto. No se extendió el archivo como decía el spec; no hacía falta. Ver `menor-8` |
| R16 | `geocodificacion-marcador-contrato.test.ts::400/R16` — 8 causas ajenas × 2 estados + «handler no registrado» | ✔ 17 casos, todos comprobando que **sigue bloqueando** |
| R17 | `tests/integration/db/backfill-…test.ts::R17` ×2 (idempotencia + el gate real deja pasar la fila reparada) | ✔ Ver punto 4 abajo |
| R18 | idem `::R18` ×2 — comparación **byte a byte** de todo menos `last_error`, `updated_at` incluido | ✔ Matado por `MUT-4` |
| R19 | `geocodificacion-motivo-messages.test.ts` ×2 + los DOS mappers + 3 modales | ✔ Con mitad negativa (`not.toBe("Dirección no encontrada")`) en cada sitio |
| R20 | idem `::400/R20` — literal a mano, y **después** se afirma la constante | ✔ El orden importa y está bien hecho |
| R21 | idem `::400/R21` — los tres transitorios parametrizados | ✔ |
| R22 | idem, describe `400/R22` — los 5 solos, los 3 pares (con el orden de llegada invertido en el crítico) y las tres juntas | ✔ |
| R23 | Guardia de la 368 ampliado a los **7** estados, con contraprueba nueva; + los dos mappers | ✔ Lee el árbol real |
| R24 | idem, describe `400/R24` — los 5 mensajes, sin dígitos, sin `@`, sin dirección ni id de prueba | ✔ |
| R25 | `::400/R25` — **las cinco claves escritas a mano** (no derivadas del mapa) + guardia `400/T13` + typecheck | ✔ hoy, con la reserva de `menor-1` |
| R26 | Cubierto por R4 y R20 | ✔ |
| R27 | Guardia `400/T5 — R27`: `JobDTO` con **exactamente** sus 12 campos, lista literal | ✔ Un `errorCodigo` nuevo lo pondría rojo |
| R28 | Requisito de NO-hacer. `git diff -U0 … \| grep -iE '^\+.*(cron\|notificad\|reencol)'` — **lo corrí yo**: solo comentarios y prosa del spec, ni una línea de código | ✔ con la reserva de `menor-9` |
| R29 | Ídem con `geocode_precision\|geocodePrecision` — **lo corrí yo**: 6 apariciones, **todas** en `specs/` y `progress/`, ninguna en código | ✔ con la reserva de `menor-9` |
| R30 | Guardia `400/T5 — R30` ×3: cabecera con el paso nuevo y la fecha, el matiz «YA NO es suficiente para clasificar», y el docstring de `esAsignable` | ✔ |
| R31 | Los dos gate-tests (`ok` y `partial`) + los dos tests de modal (cifra en el `role="status"` y en el toast) | ✔ Las dos mitades, servicio y DOM |
| R32 | Gate: `typeof === "number"`, `Array.isArray === false`. Modal: el bloque de confirmación **no contiene** ninguna de las 2 guías ni de los 2 ids, y el aviso SÍ está (no pasa por vacío) | ✔ |
| R33 | Gate: `toEqual` **sin** la clave + `Object.keys` no la contiene, y `conflict` tampoco. Modal: parametrizado (campo ausente / campo en cero). Módulo: `0`, `-1`, `-42` | ✔ Triple cobertura, y matada por `MUT-7` |
| R34 | Modal: el aviso está **dentro** del mismo `role="status"` que dice «Mensajero asignado a …», y sigue habiendo **un solo** `role="dialog"` | ✔ |
| R35 | Gate: `Object.keys(r).sort()` — campos hermanos. Modal: `.contains()` en **las dos direcciones** entre el `role="alert"` y el bloque de confirmación | ✔ Es la forma correcta de probar «no comparten contenedor» |
| R36 | Módulo ×3 cifras: sin «geocodificación», «config_invalida», «API», «REQUEST_DENIED»; + que dice que la causa es del sistema; + el mensaje de `geocodificacion_agotada` tampoco | ✔ |

**Nada de esto es un test contra su propia fuente.** Lo busqué expresamente: los literales de UI están
escritos a mano en los tests (`LITERAL_UBICACION_NO_VERIFICADA`, `AVISO_UNA`, `AVISO_DOS`) y, donde
además se afirma la constante exportada, se hace **después** de haber afirmado el literal. `MUT-8`
confirma que esa disciplina no era cosmética: cambiar el valor del marcador pone rojo el test aunque
el guardia lo importe. Y `MOTIVOS_BLOQUEANTES` se deriva del mapa, así que compararlo con el mapa
habría sido tautológico — el test compara contra **cinco literales escritos a mano**, que es lo
correcto.

---

## Los cuatro puntos declarados

### 1. El fallo mudo del tipado y su guardia — **el cierre es real, pero le falta un eslabón**

La cadena de R25 tiene tres eslabones:

```
EstadoAsignabilidad  --(Exclude)-->  EstadoBloqueante  --(anotacion)-->  Record<EstadoBloqueante, string>
        (1)                                (2)                                    (3)
```

- **El eslabón (3) está bien cerrado, y lo verifiqué yo.** `MUT-1` (aflojar a `Record<string, string>`)
  → **2 rojos**. `MUT-1d` (`Record<EstadoBloqueante | string, string>`) → **1 rojo**. Y el guardia
  **no mira un comentario ni un import**: su detector `tipoDelMapa` ancla en la declaración efectiva
  (`const MOTIVO_A_MENSAJE :`) y el segundo caso barre el archivo entero por las dos formas viejas.
  El guardia además **importa** el literal del marcador en vez de copiarlo, para no ser él el primer
  infractor. Nada que ver con «guardias que medían por método y no por escritura»: aquí se mide la
  escritura.
- **El eslabón (1) también está protegido**, y lo comprobé directamente con `MUT-12`: añadir un estado
  a `EstadoAsignabilidad` sin clasificarlo es `error TS2741`. **R25 se cumple hoy.**
- **El eslabón (2) no lo protege nadie.** `MUT-2`: reescribir `EstadoBloqueante` a mano —cinco
  literales en vez de `Exclude<EstadoAsignabilidad, EstadoAsignable>`— y añadir un sexto estado
  bloqueante deja **typecheck limpio y 1999 tests verdes en 129 archivos de guardias**. El mensaje del
  estado nuevo caería al `null` defensivo y el operador vería el genérico: exactamente el silencio que
  esta ficha vino a cerrar, una capa más afuera.

**Juicio:** el hallazgo del `frontend_dev` es legítimo, su diagnóstico es correcto y su guardia mata
lo que dice matar. Pero cerró el eslabón (3) y dejó abierto el (2), que es el mismo defecto un piso
más arriba. No es bloqueante —ningún requisito falla hoy y ningún test miente— pero es la reserva
principal de esta revisión. Es `menor-1` y se arregla con dos aserciones en el guardia que ya existe.

### 2. T17 — evidencia suficiente para el TEXTO, **no** para la pantalla

Lo hecho (renderizar el modal real y volcar literalmente el toast y cada `role="status"`/`role="alert"`
en cuatro escenarios) es honesto, es más de lo que da un test aislado, y **está declarado**, que es lo
que separa esto de disimularlo. Cubre de verdad:

- que los cuatro textos son los del `design.md`, sin una coma de diferencia;
- que el aviso va **pegado** a la confirmación y **fuera** del recuadro rojo (R34/R35);
- que sin nada que avisar no aparece nada de más (R33);
- que dice «2 órdenes», nunca «NA-1101 y NA-1102» (R32).

Y verifiqué por mi cuenta el riesgo estructural que ese volcado **no** podía ver: que el campo
`sinUbicacion` sobrevive al borde servidor→cliente. Las dos Server Actions devuelven el resultado del
service **literal**, sin reconstruir el objeto, así que no hay ningún «composition root que no inyecta»
escondido ahí. Eso era lo que más me preocupaba y está limpio.

**Lo que queda sin verificar, y hay que decirlo con estas palabras: está *probado hasta donde se pudo*,
no *probado*.** Falta, con la app levantada y datos reales:

1. provocar una orden con `geocode_status = ZERO_RESULTS` y **ver** que sigue diciendo «Dirección no
   encontrada» (T17, caso 1);
2. provocar una orden con job marcado de configuración y **ver** que se asigna (T17, caso 2);
3. ver el toast real: la frase concatenada pasa de 180 caracteres y en los tests el toast es un doble
   (`successMock`). Que el texto **quepa** y se lea en el toast de verdad no lo ha visto nadie. La
   memoria del repo es explícita: Playwright encontró en minutos 7 textos rotos que 12.000 tests daban
   por buenos.

Recomiendo dejarlo como **deuda declarada de la ficha** (`menor-5`) y cerrarla en la primera sesión con
navegador, no bloquear el merge por ella: el aviso es informativo, la orden ya recibió mensajero, y el
peor caso de un texto largo es cosmético.

### 3. Las dos desviaciones del backend — **las dos correctas, y el spec debería recogerlas**

**(a) «Los textos legados son dos, no uno».** Confirmado en el árbol: `GeocodeNoConfiguradoError`
existía y su mensaje era el de la credencial ausente, distinto del de `REQUEST_DENIED`. `design.md` §7
solo nombra el segundo. El backfill reconoce **los dos** (`FRAGMENTO_REQUEST_DENIED` y
`FRAGMENTO_SIN_CREDENCIAL`), el test de integración siembra una candidata de cada uno y afirma cada
`last_error` resultante por separado. **Es la decisión correcta**: si hubiera seguido el spec al pie de
la letra, un corte por credencial ausente habría quedado fuera del rescate — y `requirements.md`
precisión 3 ya decía que son **dos** caminos, así que el `design.md` es el que iba retrasado, no el
implementador. Mi `MUT-11` confirma que las dos causas tienen testigo **por separado**: romper solo la
credencial ausente da 4 rojos.

**(b) R8 movido al repositorio real.** El requisito afirma algo sobre el `WHERE` (el `updateMany` no
filtra por estatus ni mensajero) y con un doble de service eso es invisible — es literalmente la
memoria «probar el `WHERE` donde vive», medida cuatro veces en este repo. El test usa el
`OrdenGeocodeRepository` real con `prisma.orden.updateMany` doblado y compara el `where` con `toEqual`
**literal**, no `objectContaining`; el backend lo mutó (`M7`) y da 1 rojo. **Correcto.** Matiz honesto:
sigue siendo un doble de Prisma, así que verifica el `where` que el repositorio **construye**, no el SQL
que Postgres ejecuta. Para un `updateMany` por id es suficiente; para el backfill, que sí es SQL, se
hizo bien y se probó contra Postgres real.

**Sí, el spec debería actualizarse.** Concretamente: `design.md` §7 (nombrar los dos textos legados) y
la tabla de trazabilidad de `requirements.md` en R8 (decir que el test vive contra el repositorio, no
contra el service) y en R15 (`google-geocode.test.ts` no se extendió porque no hacía falta). Son tres
frases; sin ellas, el próximo que lea el spec creerá que el backfill cubre un solo texto.

### 4. El backfill sin sujetos — **probado de verdad, e idempotente de verdad**

La medición de T1 (2026-09-10, 00:22:16 UTC) da 0 jobs vivos y 0 con el marcador, así que R17/R18 no
se pueden validar contra datos reales. Lo que sí comprobé:

- **El test siembra sus propias filas y afirma que las encuentra**: `expect(antes.size).toBe(2)`,
  `.toBe(6)`, `.toBe(4)`. **No hay ningún `return` silencioso por falta de datos** — busqué el patrón
  expresamente, porque en este repo ya reportó `passed` sin comprobar nada.
- **Corre dentro de una transacción que siempre se revierte** y con `dedupe_key` propia, así que no
  choca con la base local compartida entre worktrees.
- **La idempotencia se prueba corriéndolo dos veces**, contando ocurrencias del prefijo y afirmando que
  la segunda pasada **no vuelve a tocar** las filas y que el conteo baja exactamente en 2.
- **Y no es teatro:** `MUT-4` (quitar el filtro de estado **solo** del `UPDATE`) lo pone en **2 rojos**
  contra Postgres real. El archivo toca datos.
- **Las cuatro testigo cubren cuatro razones distintas** de quedar fuera (otro tipo, otro estado, otra
  causa, ya marcada) y se comparan **byte a byte** salvo `last_error`, `updated_at` incluido — por eso
  el script usa SQL crudo en vez de `prisma.job.update`, que lo bumpearía y borraría la evidencia.
- **Doble idempotencia, además:** `marcarFalloConfigGeocode` también es idempotente en TypeScript, con
  su propio test.

**Conservarlo sin sujetos está justificado** (`design.md` §7): el coste ya está pagado y la alternativa,
el día del próximo corte, vuelve a ser alguien entrando a producción a mano bajo presión — que es
exactamente lo que pasó el 8-sep. **Una reserva**, abajo como `menor-3`: el `--dry-run` de T20 se
ejecutará contra producción a través de `ejecutarCli`, y **`ejecutarCli` no tiene ni un test**.

---

## Hallazgos

### BLOQUEANTES
**Ninguno.**

### Menores

**`menor-1` — El eslabón sin guardia de R25 (medido, `MUT-2`).**
`EstadoBloqueante = Exclude<EstadoAsignabilidad, EstadoAsignable>` es lo único que hace real la
exhaustividad, y nada comprueba que siga derivándose. Reescribirlo a mano + añadir un estado nuevo:
typecheck limpio, 1999 tests verdes. Arreglo, dos aserciones en el guardia que ya existe
(`tests/unit/guards/geocodificacion-motivo-por-orden-mismo-modulo.guardia.test.ts`, bloque `400/T13`):
leer `lib/interfaces/services/IAsignabilidadCoordenadasService.ts` y exigir que contenga
`Exclude<EstadoAsignabilidad, EstadoAsignable>` y que `EstadoBloqueante` **no** se declare como unión de
literales. Es el mismo movimiento que ya hicieron para el eslabón de abajo.

**`menor-2` — El guardia `400/T13` se deja engañar por un comentario señuelo (medido, `MUT-1c`).**
`tipoDelMapa` usa `String.match`, que devuelve la **primera** coincidencia: un comentario con la
anotación buena colocado encima de la declaración real la enmascara. Solo se explota junto con una
anotación que no contenga la cadena `Record<string, string>` —p. ej. `Record<EstadoBloqueante | string,
string>`—, y sin el señuelo la mutación muere (`MUT-1d`), así que exige mala fe, no descuido. Arreglo
natural y **ya convencional en este repo**: pasar el código por `tests/fixtures/sin-comentarios.ts`
antes de aplicar el detector — es el quitador de comentarios con el que 171 suites leen el árbol, y
existe justo para esto (`docs/verification.md`).

**`menor-3` — `ejecutarCli` del backfill no tiene test, y es lo que se invocará contra producción.**
`backfillMarcadorConfigGeocode` está bien probado (incluido «sin `--apply` no escribe ni una fila»),
pero el envoltorio CLI —el parseo de `--apply`, el rechazo de argumentos desconocidos con código 2, y
qué se imprime— no lo toca nadie. El repo **tiene el patrón**:
`tests/unit/scripts/backfill-analitica-cli.test.ts` y `backfill-caja-tesoreria-cli.test.ts`. Toda la
I/O va inyectada (`EntornoBackfillMarcador`), así que el test son quince líneas. Cerrarlo **antes** de
correr T20 contra producción.

**`menor-4` — Se copió el `.env` del árbol principal al worktree.**
Lo declara la propia bitácora del backend. Va contra `docs/verification.md` («Lo que NO se hizo, a
propósito: copiar o enlazar el `.env` al crear el worktree… Si necesitas esos archivos, exporta
`DATABASE_URL`»): arrastra credenciales a una segunda copia en disco, y la base local compartida entre
árboles hace que la migración de una feature ponga rojo el gate de las otras. **No invalida el gate**
—lo volví a correr yo con el mismo `.env` presente y los mismos 146 archivos de Postgres ejecutaron—,
pero conviene borrarlo del worktree al cerrar y usar `export DATABASE_URL=…` la próxima vez.

**`menor-5` — T17 queda a medias (declarado por el implementador).**
Ver el punto 2. Falta ver los casos 1 y 2 con datos reales y **mirar el toast real**: la frase
concatenada supera los 180 caracteres y en los tests el toast es un doble. Dejarlo como deuda explícita
de la ficha, no cerrarla en silencio.

**`menor-6` — `tasks.md` no usa casillas, así que CHECKPOINTS «todas marcadas `[x]`» no es aplicable.**
El archivo usa `**Hecho cuando:**` (28 veces). No es un incumplimiento de esta ficha: la 396, cerrada
anteayer, tiene sus **74** casillas sin marcar. Es deriva del arnés, no de la 400. O el checkpoint se
reformula, o se marca de verdad; hoy no lo cumple nadie.

**`menor-7` — Faltan los dos pasos de cierre del leader.**
No hay entrada de la 400 en `progress/history.md`, y `feature_list.json` **no tiene ficha 400** —ni en
esta rama ni en `origin/dev`, donde el último id es 399—. Es trabajo del leader y hay memoria de por qué
no lo escribe un agente con subagentes dentro, pero se anota para que no se pierda.

**`menor-8` — Tres frases que el spec debería recoger.**
`design.md` §7 (los **dos** textos legados, no uno), y la tabla de trazabilidad en R8 (el test vive
contra `OrdenGeocodeRepository`, no contra el service) y en R15 (`google-geocode.test.ts` no se
extendió: el caso vigente ya cubre `REQUEST_DENIED`). Ver punto 3.

**`menor-9` — R28 y R29 se acreditan solo con `git diff`.**
Es lo que la propia tabla de `requirements.md` autoriza («Sin test de código», «Verificable con
`git diff --stat` en el informe del reviewer»), y **lo verifiqué yo mismo** con los dos greps: cero
líneas de código. Se anota igual porque un requisito de NO-hacer acreditado por diff caduca en cuanto la
rama se mergea: si mañana la 401 añade el reencolado, nada recuerda que la 400 prometió no hacerlo. Para
R27, que sí tiene guardia, esto está bien resuelto; R28/R29 no lo tienen y no vale la pena que lo tengan
— pero que conste el límite.

**`menor-10` — La bitácora del backend se contradice consigo misma a primera vista.**
Tiene una sección «T1 — Fotografía de producción: **NO EJECUTADA**» y, 170 líneas más abajo, otra
«T1 — Fotografía de producción (ejecutada por el leader)» con los números. Las dos son ciertas y la
segunda explica la primera, pero quien lea por encima se lleva la impresión contraria. Consolidar en una
sola sección.

---

## Lo que NO es un hallazgo, y por qué lo miré

- **Los 26 `skipped`.** Ajenos, preexistentes, de `AnaliticaPage`/`AnaliticaShell`. Verificado en mi
  propio log, no en la bitácora.
- **El aviso de `down.sql`.** Tres migraciones de agosto (ficha 265). Esta ficha no añade ninguna.
- **`gateCoordenadas` cambia de forma de retorno.** Es `private`; R27 prohíbe tocar `IJobRepository`, y
  el guardia lo comprueba (`JobDTO`, 12 campos exactos). No hay contrato compartido roto.
- **`app/` importando un tipo de `lib/interfaces/`.** Es `import type`, desaparece en el build; el
  guardia exige que sea `import type` y que no se redeclare. Sin acoplamiento en runtime.
- **Los `MOTIVOS_DIRECCION_*` exportados que desaparecen.** Eran la implementación de la clasificación,
  no el contrato; el contrato pasa a ser `MOTIVOS_BLOQUEANTES`. El test que los usaba se reescribió con
  literales a mano, no comparando contra la fuente. Decidido caso por caso y anotado.
- **El modal filtra por truthiness en vez de `> 0`.** Con `0` no muestra nada, que es R33; y
  `mensajeAsignadasSinUbicacion` vuelve a filtrar con `n <= 0`. Defensa en dos capas, y la de abajo
  tiene su test (`MUT-7`).

---

## Recomendación

**Mergeable.** Ninguna reserva justifica devolverla al implementador: el código es correcto, las
mutaciones realistas mueren, la trazabilidad es real y el gate está verde medido por mí. De las diez
menores, dos merecen una tanda corta de seguimiento —`menor-1` (dos aserciones en un guardia que ya
existe) y `menor-3` (un test de CLI de quince líneas, **antes** de correr T20 contra producción)— y
`menor-5` debe quedar escrita como deuda declarada, no darse por cerrada.

Y una nota para la **401**, que depende de esta: va a seleccionar jobs por el marcador. Si antes de eso
se cierra `menor-1`, la 401 hereda una cadena de tipos con guardia completa en vez de una con un eslabón
suelto.
