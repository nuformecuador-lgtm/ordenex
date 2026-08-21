# Feature 236 — bitácora de implementación (BACKEND: T1, T2, T3)

> Rama `feature/236-ayuda-tienda-novedades`. **Sin commit.**
> Alcance de esta bitácora: **T1 (la declaración única), T2 (el corte en el servidor) y T3 (las
> descargas)**. **T4-T6 (la pantalla) NO se tocaron** — el spec lo prohíbe explícitamente
> (`tasks.md` §Paralelismo: «T4-T6 leen contratos que T2-T3 todavía están moviendo»).

---

## 0 · Lo que se dio por medido y firmado, sin volver a suponerlo

**Medición de producción, 2026-08-19** (`progress/medicion_236.md`, MCP solo lectura):
**`devuelta` = 0** y **`ayuda_tienda` = 0** órdenes vivas, **0 notas de orden vivas**, **0 órdenes
con nota** — sobre un denominador de **141 órdenes vivas en 11 estatus**. Ceros con denominador, no
de universo vacío.

Las dos consecuencias que esta tanda escribió en el código y en los tests:

1. **El coste de migración de D3 es cero**: nadie tiene un archivo viejo que cambie de forma.
2. **La pestaña nace vacía**, así que el camino de «lista vacía» es el **primero** que va a correr en
   producción. Se trata como caso de pleno derecho, no como marginal: tiene caso propio en el
   servicio (los dos grupos), en el borde (`ok` con total 0, no un modo de fallo) y en el archivo.

⏳ La foto **caduca**. T0.1 (re-medir antes de **desplegar**, no antes de mergear) **no se ejecutó**
en esta tanda: sigue abierta y bloquea el despliegue, no el merge.

**Decisiones firmadas que esta tanda implementa tal cual, sin reabrirlas** (`requirements.md`
§«PUERTA HUMANA PASADA», 2026-08-19):

- **D1** — la pestaña muestra **sólo `ayuda_tienda`**, con una igualdad de estado hermana de la de
  devolución.
- **D3** — **descarga propia por pestaña**, y la de devoluciones **deja de traer** las de ayuda.
- **D7** — la lista de ayuda se ordena por la **fecha de la solicitud**, la que lleva más esperando
  primero.
- **D6** (la parte que toca al backend) — el archivo de la descarga se llama **«Ayuda solicitada»**.

**D8 no se implementó**: toca `HabilitarNovedadResult` y su mitad visible es T5.5, que es frontend.
Queda para quien haga T5, y sigue siendo el punto de coordinación con la ficha 240.

---

## 1 · Archivos creados

| Archivo | Qué es |
| --- | --- |
| `lib/types/novedad-grupo.ts` | **T1.1** — la declaración única: `GrupoNovedad`, `GRUPOS_NOVEDAD` (que fija el orden de las pestañas), `ESTATUS_POR_GRUPO` con `satisfies Record<GrupoNovedad, OrderStatusValue>` y `grupoDeEstatus()` derivado del mapa. |
| `app/(app)/novedades/_components/ayuda-descarga-columnas.ts` | **T3.2** — módulo puro de columnas de la descarga de ayuda. **Sin** columna de causa; **con** intentos de contacto. |
| `tests/unit/types/novedad-grupo.test.ts` | T1.1 |
| `tests/unit/actions/novedades-ayuda.test.ts` | T2.6 |
| `tests/unit/descarga/ayuda-descarga-columnas.test.ts` | T3.2 |
| `tests/integration/db/novedades-predicado-sql-real.test.ts` | El predicado nuevo **ejecutado contra Postgres real** (ver §4). |

## 2 · Archivos modificados

| Archivo | Qué cambió |
| --- | --- |
| `lib/repositories/OrdenRepository.ts` | **T2.1/T2.2/T2.5** — `novedadWhere(tiendaId, grupo)` pierde el `OR` y pasa a una igualdad tomada del mapa; `countDevueltasByTienda`/`findDevueltasByTienda` → `countNovedadesByTienda(tiendaId, grupo)` / `findNovedadesByTienda(tiendaId, grupo, pagination)`; nace `findFechaSolicitudAyuda(ordenIds)`. Mueren los `const ESTATUS_DEVUELTA`/`ESTATUS_AYUDA` (con su acta escrita en el sitio). `OrdenPrismaClient` gana `ordenHistorialEstado`. |
| `lib/interfaces/repositories/IOrdenRepository.ts` | Los tres contratos de arriba, con `grupo` **obligatorio** (un olvido de cableado rompe el typecheck, no lista en silencio el grupo equivocado). |
| `lib/services/NovedadesService.ts` | **T2.4/T2.5/T3.1/T3.3** — `listar({page,pageSize,grupo})` y `listarCompleto({grupo})`, **sin partirse en dos**. La causa **sólo** se consulta para `devolucion`; el orden lo decide el grupo. |
| `lib/interfaces/services/INovedadesService.ts` | El contrato, con `ListarNovedadesCompletoInput` nuevo. |
| `lib/actions/novedades.ts` | **T2.6** — `listarAyudaTiendaAction` y `listarAyudaTiendaCompletoAction`. El grupo **no viaja en el input**: es constante de módulo servidor. Las dos viejas conservan su firma y fijan `devolucion`. |
| `tests/unit/repositories/orden-repository.novedades.test.ts` | Reescrito con nota fechada. Ver §3. |
| `tests/unit/services/NovedadesService.test.ts` | Reescrito con nota fechada. |
| `tests/unit/guards/hilo-ventana-alcanzable.guardia.test.ts` | **T2.7** — la reparación de §2.4. Ver §5. |
| `tests/unit/services/{bulk-orden-service, bulk-orden-service.carga-api, orden-service, rol-admin-satelite-authz}.test.ts` | Dobles de `IOrdenRepository` completos: renombre mecánico de los dos métodos + el nuevo. |

**No hay migración, ni tabla, ni columna, ni política RLS** — y es una decisión, no un olvido
(`design.md` §1.1). Todo lo que esta ficha necesita ya está persistido.

---

## 3 · El `WHERE` se probó DONDE VIVE

El aviso del encargo se tomó al pie de la letra: los tests de servicio usan dobles y **no ven el
SQL**, así que el predicado nuevo tiene cobertura en **dos** niveles por debajo:

**(a) Un evaluador que APLICA el predicado a filas**, en
`tests/unit/repositories/orden-repository.novedades.test.ts`. No describe la forma del `where`: lo
ejecuta contra filas sintéticas y responde si casan. Dos propiedades lo hacen valer algo:

- **revienta ante cualquier forma que no entienda** (un `OR`, una clave hermana, un `in`), en vez de
  responder `false` y dejar verdes todas las aserciones negativas. Es lo que mata la mutación
  «devolver el `OR` de ayer»;
- **se prueba a sí mismo** contra respuestas conocidas antes de usarse (bloque 0), porque un
  evaluador roto diría «no casa» a todo.

Con él, R9 deja de ser una afirmación sobre el texto: cada estatus casa su grupo y **ninguno más**,
y ni la orden de otra tienda ni la borrada casan ningún predicado — **cada negativo con su control
positivo al lado**.

**(b) Un test contra Postgres real**, `tests/integration/db/novedades-predicado-sql-real.test.ts`,
molde de `satelite-conjunto-sql-real.test.ts`: ejecuta las tres lecturas nuevas contra el esquema
real con un `tiendaId` que no existe. Prueba lo que ningún doble puede ver — que `estatus.value`
resuelve por la relación, que el `select` de veinte columnas y cinco joins es válido, y que
`solicitud_ayuda_tienda` es un valor admisible del enum `orden_historial_origen_tipo` **en la base**,
no sólo en el cliente generado.

⚠️ **No es un test que se salte en silencio**: corrió de verdad (4 passed, 367 ms de tests contra
`localhost:5432`, base «up to date» según `prisma migrate status`). Y **no prueba el conjunto de
filas** — eso lo prueba (a) —; se dice en su cabecera para que nadie le atribuya más de lo que hace.

**Sobre la invariante heredada.** El caso «count y find comparten exactamente el mismo `where`»
existía **dos veces** en el archivo viejo (una en su describe y otra como «R21» en el de la 239). **No
se duplicó ni se borró: se colapsó en UNA que ITERA `GRUPOS_NOVEDAD`**, más un caso testigo de que
pedir un grupo no consulta el estatus del otro. Un grupo nuevo entra **solo** a la aserción.

**Sobre los `toEqual` literales.** El del `select` **es el contrato** (qué columnas cruzan la capa) y
se conservó intacto. El `NOVEDAD_WHERE` literal del archivo viejo se sustituyó por
`novedadWhereEsperado(grupo)`, construido desde una tabla `ESTATUS_ESPERADO` **escrita a mano en el
test** — a propósito **no** derivada de `ESTATUS_POR_GRUPO`, que sería compararlo contra su propia
fuente y estaría siempre verde. Que esa tabla cubra exactamente los grupos declarados tiene su propio
caso, así que un grupo nuevo obliga a pasar por ahí y decidir su estatus.

---

## 4 · Mapa `R<n> → test` (sólo los R de T1-T3)

| Req | Test que lo cubre |
| --- | --- |
| **R2** (mitad) | `tests/unit/actions/novedades-ayuda.test.ts` › «cada acción pide SU grupo, y son distintos» + «NO existe ninguna clave de entrada con la que el cliente pueda elegir el grupo» |
| **R3** | `orden-repository.novedades.test.ts` › «grupo %s: el where tiene EXACTAMENTE tres claves y su estatus es el suyo» + «ninguna marca persistida sobrevive en ningún predicado» · `hilo-ventana-alcanzable.guardia.test.ts` › «el cuerpo de `novedadWhere` NO contiene NINGÚN literal de estatus» |
| **R4** | `orden-repository.novedades.test.ts` › «count y find construyen el mismo predicado para cada grupo de `GRUPOS_NOVEDAD`» + «el grupo llega hasta el predicado» · `NovedadesService.test.ts` › «count y find reciben EXACTAMENTE los mismos tienda y grupo» |
| **R5** | `tests/unit/types/novedad-grupo.test.ts` › «`grupoDeEstatus` … para CADA entrada del mapa devuelve su grupo» + «`GRUPOS_NOVEDAD` cubre TODAS las claves del mapa» · guardia › «`novedadWhere` TOMA su estatus del mapa» |
| **R6** (mitad) | `novedad-grupo.test.ts` › «los DOS grupos existen y el mapa les da un estado a cada uno» (la otra mitad —la tabla de acciones— es T5.1, frontend) |
| **R7** | typecheck (`satisfies Record<GrupoNovedad, OrderStatusValue>`) + `novedad-grupo.test.ts` › «los dos values existen en `ORDER_STATUS_SEED`» |
| **R9** | `orden-repository.novedades.test.ts` › «cada estatus casa su propio grupo y NINGUN otro» + «ningún grupo lista una orden que SALIÓ de su estatus» |
| **R10** | `NovedadesService.test.ts` › «acota al `tiendaId = actor.usuarioId` … con el grupo pedido» · `orden-repository.novedades.test.ts` › «ni la orden de otra tienda ni la borrada casan ningún predicado» |
| **R11** | `NovedadesService.test.ts` › «rol != adminTienda -> forbidden sin tocar el repo, en CADA grupo y CADA método» (afirma también que **el conteo no llega a hacerse**: R11 pide no revelar totales) · `novedades-ayuda.test.ts` › «las dos acciones de ayuda, sin actor, no llegan al service» |
| **R17** | `NovedadesService.test.ts` › «la que pidió ayuda ANTES va primero (ascendente)» + «UNA sola consulta para toda la página» + «una orden SIN fecha de solicitud cae al fallback» · `orden-repository.novedades.test.ts` › «se queda con la solicitud MAS RECIENTE por orden» |
| **R26** (mitad) | `NovedadesService.test.ts` › «grupo `ayuda`: `findCausasDevueltaVigentes` NO se llama, y la causa sale null» (+ su control positivo para `devolucion`) |
| **R29** | `NovedadesService.test.ts` › «el DTO no gana NINGUNA clave de notas» — afirmado sobre el DTO, no sobre un comentario. *(La mitad de «al listar, `listarNotasOrden` no se llama» es T6.3, frontend.)* |
| **R36** (mitad) | `hilo-ventana-alcanzable.guardia.test.ts` › «los estatus que la TIENDA alcanza son EXACTAMENTE su ventana de escritura» |
| **R37** | `NovedadesService.test.ts` › «el listado ENTERO del grupo, con el MISMO alcance y el MISMO predicado que su pestaña» |
| **R38** | `NovedadesService.test.ts` › «el archivo de DEVOLUCIONES no puede traer una orden en ayuda» · `novedades-ayuda.test.ts` › «lo mismo en las dos descargas: cada archivo sale de su grupo» |
| **R39** | `ayuda-descarga-columnas.test.ts` › «NO existe la columna de causa, ni el texto que anuncia su ausencia» (+ control positivo: el archivo de devoluciones **sí** la tiene) |
| **R40** | `NovedadesService.test.ts` › «superado el tope -> `limite_excedido` con conteos y NINGUNA fila, por grupo» + «justo EN el tope todavía hay archivo» |
| **R47** (parte) | `orden-repository.novedades.test.ts` › el `select` de `findFechaSolicitudAyuda` es `{ordenId, createdAt}` y nada más · `ayuda-descarga-columnas.test.ts` › «no publica … ni notas» |

**El estado vacío (R16 es de T4, pero su camino de servidor se prueba aquí):**
`NovedadesService.test.ts` › «la pestaña VACÍA responde `ok` con total y sin consultas agregadas, en
los DOS grupos» · `novedades-ayuda.test.ts` › «la pestaña VACÍA responde `ok` con total 0 — no es un
error ni un vacío mudo».

---

## 5 · La guardia de §2.4 — cómo quedó

Se puso roja por la razón legítima que el diseño anticipó: `valorDe` sólo acepta un literal o un
identificador simple, y la captura pasó a ser `ESTATUS_POR_GRUPO[grupo]`. **No se relajó `valorDe` ni
se borró ningún bloque.** Se aplicó la reparación de §2.4, paso por paso:

1. **Los estatus de la pantalla de la tienda salen ahora del valor importado `ESTATUS_POR_GRUPO`**
   (`estatusDeNovedades()` los recorre por `GRUPOS_NOVEDAD`, que es lo que fija qué pestañas hay).
2. **Se añadieron las dos aserciones que ATAN el mapa al predicado real**, para que la guardia no se
   convierta en un espejo de sí misma:
   - `novedadWhereUsaElMapa()` — el cuerpo de `novedadWhere` **indexa** `ESTATUS_POR_GRUPO`;
   - `literalesDeEstatusEnNovedadWhere()` — el cuerpo **no contiene ningún literal de estatus**, ni
     directo ni escondido tras un `const` de módulo (que es la forma que tenía hasta ayer).
   Con las dos, el único origen posible es el mapa: **leer el mapa ES leer el predicado**.
3. **La propiedad SUBIÓ**, y se comprobó que subir no era cosmético: de «intersección no vacía» a
   **igualdad exacta** — los estatus que la tienda alcanza son **exactamente**
   `VENTANA_ESCRITURA.adminTienda`. Es la forma ejecutable de la enmienda de R35 de la 235.
   Se conservó el bloque 0 con su número (siguen siendo **2**), sus contrapruebas sobre fuente
   sintético (ahora en cuatro variantes: sano, con literal, con `const`, y con el `OR` de ayer) y su
   «revienta antes que adivinar».
   Para el **mensajero** la propiedad correcta sigue siendo la **inclusión** y no la igualdad
   (`por_recoger` está en su pantalla y no en su ventana, deliberadamente, feature 227 §2.2): se
   escribió como caso propio para que la asimetría no se lea como un olvido.

**La prueba de que subir sirvió de algo:** con la mutación (c) —quitar `ayuda_tienda` de la ventana
del `adminTienda`— el caso viejo de intersección **sigue verde** (la intersección con `devuelta` no
queda vacía) y **sólo cae la igualdad nueva**. Está en la salida citada abajo: en esa corrida el test
«cada rol tiene al menos un estatus alcanzable…» no aparece entre los fallos.

Se reescribió además la cabecera del archivo, que decía «los dos conjuntos se leen del FUENTE» y ya
sólo es cierto para el lado del mensajero. **No se borró: se contó qué cambió y por qué.**

---

## 6 · Mutaciones — una a una, vitest corrido, salida real leída y citada

Método: script `mutar.py` que **aborta si el texto a sustituir no está presente** (nunca deja creer
que mutó algo) y reporta `sha256[:16]` antes y después. Todas revertidas; el `sha256` final de cada
archivo coincide con el previo a la mutación (§7).

| # | Mutación | sha256[:16] antes → mutado → después | Qué cayó (mensaje REAL) |
| --- | --- | --- | --- |
| **a** | Plantar un literal de estatus dentro de `novedadWhere` | `8712d9b2…` → `d96d8005…` → `8712d9b2…` | **2 failed / 13 passed** en la guardia. `236/R3: el cuerpo de novedadWhere NO contiene NINGÚN literal de estatus` — *«alguien escribió un estatus a mano dentro del predicado de `/novedades`… expected [ 'ayuda_tienda', 'devuelta' ] to deeply equal []»* |
| **b** | Quitar un grupo de `GRUPOS_NOVEDAD` | `7737a0c3…` → `9cdd6da2…` → `7737a0c3…` | **6 failed / 9 passed**. `AssertionError: expected 1 to be 2` · `236: la lista de pestañas y el mapa de grupos no pueden separarse: expected [ 'devolucion' ] to deeply equal [ 'ayuda', 'devolucion' ]` · `236/R36 … expected [ 'devuelta' ] to deeply equal [ 'ayuda_tienda', 'devuelta' ]` |
| **c** | Quitar `ayuda_tienda` de `VENTANA_ESCRITURA.adminTienda` | `5fe37ae1…` → `088de275…` → `5fe37ae1…` | **2 failed / 13 passed**. `236/R36: los estatus que la TIENDA alcanza son EXACTAMENTE su ventana: expected [ 'ayuda_tienda', 'devuelta' ] to deeply equal [ 'devuelta' ]` · `235/R34 … expected [] to deeply equal [ 'ayuda_tienda' ]`. **El caso de intersección NO cayó** — es la prueba de que la propiedad subió. |
| **d** | Devolver el `OR` de ayer al predicado (ignora el grupo) | `8712d9b2…` → `7c63e7c2…` → `8712d9b2…` | **13 failed / 35 passed** en repo + guardia. El evaluador se niega a adivinar: `Error: el predicado de novedades tiene claves inesperadas [OR, deletedAt, tiendaId]: el evaluador solo entiende { tiendaId, deletedAt, estatus: { value } }` (×4) · `236/R5: novedadWhere TOMA su estatus del mapa … expected false to be true` |
| **e** | Consultar la causa **también** para el grupo de ayuda (R26) | `54722efc…` → `3d15630a…` → `54722efc…` | **1 failed / 30 passed**. `grupo 'ayuda': findCausasDevueltaVigentes NO se llama … expected "vi.fn()" to not be called at all, but actually been called 1 times` |
| **f** | Invertir el orden de la lista de ayuda (D7 al revés) | `54722efc…` → `c299c9f4…` → `54722efc…` | **2 failed / 29 passed**. `la que pidió ayuda ANTES va primero: expected [ 'reciente', 'esperando' ] to deeply equal [ 'esperando', 'reciente' ]` |
| **g** | La descarga de devoluciones vuelve a pedir el grupo de ayuda (R38) | `687c0617…` → `edc959b8…` → `687c0617…` | **1 failed / 12 passed**. `lo mismo en las dos descargas: cada archivo sale de su grupo (D3/R38): expected { grupo: 'ayuda' } to deeply equal { grupo: 'devolucion' }` |
| **h** | Reponer la columna de causa en el archivo de ayuda (R39) | `928d8fb5…` → `bf36dea0…` → `928d8fb5…` | **3 failed / 8 passed**. `R39/R26: NO existe la columna de causa … expected [ 'numGuia', 'numRemision', …(9) ] to not include 'causa'` |
| **i** | Familia de origen inexistente (`solicitud_ayuda_tienda_XX`) | `8712d9b2…` → `7c93aaf8…` → `8712d9b2…` | **Contra Postgres real:** `1 failed / 3 passed` — `AssertionError: promise rejected "PrismaClientValidationError{…}" instead of resolving`. En el test con dobles cae **otro** caso y por **otra** razón (`expected {…} to deeply equal {…}`, sobre el argumento). Es la demostración, en este mismo archivo, de que los dos niveles no prueban lo mismo. |

Las mutaciones **g** y **h** se corrieron **dos veces**: la primera antes de añadir las anotaciones
`@sin-superficie` (§8), la segunda contra el árbol final. La tabla cita los `sha256` **del árbol
final**; los de la primera corrida fueron `dd7e1eb5…`/`6e160166…` y `5ea6ec14…`/`bcc72ac9…`, con el
mismo resultado.

---

## 7 · Verificación — salida real

```
$ pnpm exec tsc --noEmit
exit=0            (sin ninguna línea de salida = cero errores)
```

```
$ pnpm exec eslint <los 18 archivos tocados>
EXIT=0            (sin ninguna línea de salida = cero errores ni avisos)
```

```
$ pnpm run test:guardias
 Test Files  122 passed (122)
      Tests  1798 passed (1798)
   Duration  13.01s
```

```
$ pnpm exec vitest related --run lib/actions/novedades.ts \
    lib/interfaces/repositories/IOrdenRepository.ts \
    lib/interfaces/services/INovedadesService.ts \
    lib/repositories/OrdenRepository.ts lib/services/NovedadesService.ts \
    lib/types/novedad-grupo.ts \
    "app/(app)/novedades/_components/ayuda-descarga-columnas.ts"
 Test Files  218 passed (218)
      Tests  2908 passed | 17 skipped (2925)
   Duration  139.94s
```

```
$ pnpm exec vitest run tests/unit/types/novedad-grupo.test.ts \
    tests/unit/repositories/orden-repository.novedades.test.ts \
    tests/unit/services/NovedadesService.test.ts \
    tests/unit/actions/novedades-ayuda.test.ts \
    tests/unit/descarga/ayuda-descarga-columnas.test.ts \
    tests/unit/descarga/novedades-descarga-columnas.test.ts \
    tests/unit/guards/hilo-ventana-alcanzable.guardia.test.ts \
    tests/integration/db/novedades-predicado-sql-real.test.ts
 Test Files  8 passed (8)
      Tests  122 passed (122)
```

**El gate (`./init.sh` / `./init.sh --rapido`) NO se corrió aquí, a propósito:** el gate no se corre
en paralelo con un subagente que muta el árbol, y esta bitácora se escribe con mutaciones recién
revertidas. Lo corre el leader, con el árbol quieto.

`sha256[:16]` de los archivos de producción tocados, al cerrar:

```
lib/types/novedad-grupo.ts                                  7737a0c3964c7384
lib/repositories/OrdenRepository.ts                         8712d9b21be2cb09
lib/interfaces/repositories/IOrdenRepository.ts             758aa4593297875d
lib/services/NovedadesService.ts                            54722efcde0fd16f
lib/interfaces/services/INovedadesService.ts                ecadb07cb9ad2d9e
lib/actions/novedades.ts                                    687c06178b54635c
lib/types/ventana-hilo-notas.ts                             5fe37ae10dcb0c84   (sin cambios: se mutó y se restauró)
app/(app)/novedades/_components/ayuda-descarga-columnas.ts  928d8fb556b532f6
```

---

## 8 · Lo que se tocó de `app/`, y por qué — **hay que leerlo**

`app/` se tocó **una sola vez y para crear un archivo nuevo**:
`app/(app)/novedades/_components/ayuda-descarga-columnas.ts`, que **es T3.2** (mi alcance) y vive ahí
por convención —su hermano `novedades-descarga-columnas.ts` está en la misma carpeta y la guardia de
columnas sensibles descubre los módulos por el sufijo `-descarga-columnas.ts`—. **Ningún componente,
página ni layout se modificó.**

### La guardia `superficie-de-uso` se puso roja, y su reparación es una entrega para el frontend

Al terminar T2/T3, `tests/unit/guards/superficie-de-uso.guardia.test.ts` se puso roja con **tres
huérfanos**, y los tres son consecuencia directa de que la pantalla sea otra tanda:

```
+   "lib/actions/novedades.ts:157 listarAyudaTiendaAction"
+   "lib/actions/novedades.ts:175 listarAyudaTiendaCompletoAction"
+   "app/(app)/novedades/_components/ayuda-descarga-columnas.ts"
```

Había dos salidas: cablear la pantalla (que el spec **prohíbe** hacer a la vez) o usar el mecanismo
que la propia guardia prescribe. Se eligió el segundo: **`@sin-superficie` con motivo real, junto al
export**, y el motivo dice explícitamente que es **transitorio, con dueño (T4 de esta misma feature)
y del mismo PR**.

> ⚠️ **Estas tres anotaciones CADUCAN y la guardia obliga a retirarlas** en cuanto la pantalla monte
> la pestaña y su descarga (`R-A/R-B` › «ninguna anotación sobrevive a su motivo»). **Si sobreviven
> al PR, la feature salió rota**: las órdenes en ayuda quedarían sin pantalla (peor que el estado de
> partida) o la pestaña saldría sin descarga (la regresión silenciosa que D3-(c) descartaba).

Además, dos guardias de censo (`ayuda-columna-retirada`, `gestion-aprobada-retirada`) se pusieron
rojas por **literales dentro de mis tests nuevos** (`ayuda: true` y `gestionAprobada`, en aserciones
que comprueban justamente su ausencia). Se arreglaron construyendo esos nombres por
**concatenación**, que es la convención que el propio repo ya usaba para esto. No se tocó ninguna
guardia para callarla.

---

## 9 · Lo que queda abierto para el frontend (T4-T6)

Contratos ya estables sobre los que se puede construir:

- `GrupoNovedad`, `GRUPOS_NOVEDAD` (**ayuda primero**, D6) y `grupoDeEstatus()` en
  `lib/types/novedad-grupo.ts`. **`ACCIONES_POR_GRUPO` (T5.1) debe indexarse por este mismo
  `GrupoNovedad`**: es lo que hace R6 verdadero por construcción.
- `listarAyudaTiendaAction({ page? })` y `listarAyudaTiendaCompletoAction()` — **mismo shape de
  resultado** que las de devoluciones. `PAGE_SIZE = 10`, fijo en el borde.
- `COLUMNAS_DESCARGA_AYUDA`, `filaDescargaAyuda` y `TITULO_DESCARGA_AYUDA = "Ayuda solicitada"`.
- **`NovedadDTO` no cambió** (R29): el hilo no viaja en el listado. Para el grupo de ayuda,
  `causa` llega **siempre `null`** y la consulta ni se hace — la card **no debe** pintar causa ni
  anunciar su ausencia (R26).
- El orden ya viene resuelto del servidor: la pestaña de ayuda llega **ascendente por fecha de
  solicitud**. La pantalla **no debe** reordenar.

Pendientes explícitos que esta tanda **no** hizo y que son de las siguientes:

1. **Retirar las tres anotaciones `@sin-superficie`** al cablear (§8). No es opcional: la guardia lo
   exige.
2. **D8** (`HabilitarNovedadResult` distingue «se devolvió a la ruta» de «no se movió», R25) — está
   firmado pero **no implementado**: su mitad visible es T5.5 y toca un contrato que la **240**
   también va a tocar.
3. **T6.6** escribe en `hilo-ventana-alcanzable.guardia.test.ts`, el mismo archivo que T2.7. No son
   paralelas.
4. **T0.1** — re-medir contra producción **antes de desplegar**. Bloquea el despliegue, no el merge.
5. El **fallback a vacío** de la pestaña de ayuda en `page.tsx` (design §5): si su lectura no
   responde `ok`, la pantalla **no** debe hacer `notFound()`.

---

## 10 · Veredicto

**T1, T2 y T3 entregados y verdes**: el corte vive en el servidor, sale de una sola declaración, se
probó donde se ejecuta —evaluador de filas más Postgres real—, la guardia de §2.4 quedó **más fuerte**
que antes (igualdad exacta en vez de intersección), las nueve mutaciones cayeron con salida citada, y
lo único que toca `app/` es un módulo puro nuevo con su caducidad escrita.
