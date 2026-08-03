# Feature 131 — analítica: tablero operativo · requirements

> **Zona:** frontend. **Depende de:** 126 (`done`, mergeada). **Ruta:** `/analitica`.
> **Alcance:** cablear los datos que ya sirve la Server Action de la 126 a los componentes de
> gráfica de la 130, dentro del shell de la 129, con filtros (rango, zona, tienda, mensajero) y
> revalidación explícita.

## 0. Corrección de la ficha (verificada en el árbol, no supuesta)

`feature_list.json:1514` describe la 131 como *«cablea las Server Actions de **125** a las
gráficas de **129** dentro de la ruta **128**»*. **Esos tres números son de una numeración
anterior y hoy son falsos.** Verificado leyendo el árbol de `C:/w131`:

| La ficha dice | Lo que existe de verdad | Evidencia leída |
|---|---|---|
| Server Actions de la **125** | **126** — `consultarAnaliticaOperativa` | `lib/actions/analitica-operativa.ts:78` (`// Feature 126 (T9…)`) |
| gráficas de la **129** | **130** — `components/private/analytics/*` | `components/private/analytics/tipos.ts:1` (`feature 130`) |
| ruta **128** | **129** — `app/(app)/analitica/` | `app/(app)/analitica/page.tsx:10` (`Feature 129`) |
| `depends_on: 126` | correcto | `feature_list.json:1520` |

La 128 (`analitica: cache + invalidacion por tag`) es **backend** y está `pending`
(`feature_list.json:1472-1481`). Esta spec **no diseña caché** (§9 del design).

## 1. Contexto que gobierna estos requisitos (hechos verificados)

1. **Hay UNA sola puerta de datos**: `consultarAnaliticaOperativa(entrada, deps?)`
   (`lib/actions/analitica-operativa.ts:78`), que devuelve `ResultadoOperativo` =
   `ok | validation_error | forbidden | unauthenticated` (`lib/types/analitica-operativa.ts:119`).
2. **El alcance por rol ya está aplicado en el servidor.** `prepararConsultaAnalitica`
   (`lib/analytics/consulta.ts:79`) parsea, resuelve rango, resuelve alcance e **interseca el
   filtro** antes de tocar la base. La seudonimización de mensajeros ocurre **en el servicio**
   (`lib/services/AnaliticaOperativaService.ts:481`), no en el borde: el uuid real no cruza la
   frontera. **El tablero no reimplementa nada de esto** (R10).
3. **`cobertura` es obligatoria** en toda respuesta `ok` y su tipo se declara **sin `?`**
   (`lib/types/analitica-operativa.ts:105`). Existe porque el rollup tiene una ventana ciega:
   `orden_historial_estado` nace en el horizonte de la 125 y por debajo de él las medidas salen a
   cero **legítimamente**. El aviso dirigido a esta feature está escrito en
   `lib/types/analitica-operativa.ts:19-22` y en `specs/126-…/design.md:152`.
4. **El día en curso viaja marcado** `parcial: true` + `corteAt`, y los días cerrados **no**
   (`AnaliticaOperativaService.ts:253-262, 339-340`). Los **tres** presets no personalizados
   incluyen el día de hoy (`lib/analytics/ranges.ts`, `fechasCalendarioDelRango`), así que
   **cualquier vista por defecto contiene un punto parcial**.
5. **`sin_gestionar` se deriva del embudo** y **`incidentes` está declarado
   `estadoProduccion: "declarada"` pese a tener columna y a ser servido**
   (`specs/126-…/design.md:463-480`, divergencias heredadas a la ficha **175**). Consecuencia
   directa para esta feature: **decidir los paneles por `estadoProduccion` borraría dos KPI vivos**
   (R21).
6. **El paquete de la 130 no agrupa ni re-muestrea** y **lanza** fuera de producción por encima de
   5 series o 62 puntos (`components/private/analytics/topes.ts:16, 22, 32`). Los dos cálculos son
   deber explícito de esta feature (`specs/130-…/tasks.md:41-62`).
7. **El porcentaje viaja como fracción**, no en puntos (`specs/130-…/tasks.md:52-55`), y el donut
   tiene techo de **5** segmentos conservando los **primeros** (`ibíd.:56-62`).
8. **La ruta es de `maestro`/`admin` y punto**: `ROLES_ACCESO_ANALITICA`
   (`lib/auth/menu-visibility.ts:79`), defendida por `notFound()` en la página y vigilada por
   `tests/unit/guards/roles-analitica-acceso-vs-dominio.test.ts`. Ampliarla es de la **133**.

---

## 2. Requisitos (EARS)

### Frontera y procedencia del dato

- **R1** — El sistema DEBE obtener toda cifra operativa del tablero **exclusivamente** invocando la
  Server Action `consultarAnaliticaOperativa`. Ningún archivo de la 131 DEBE importar
  `AnaliticaOperativaService`, `AnaliticaOperativa*Repository`, Prisma ni construir una ruta
  `app/api/` para esto.

- **R10** — El sistema NO DEBE filtrar, recortar, reordenar por permiso ni intentar deshacer la
  seudonimización de la serie recibida: MIENTRAS el resultado sea `ok`, DEBE renderizar los puntos
  tal como llegan. Ningún archivo de la 131 DEBE importar `lib/analytics/alcance*`,
  `lib/analytics/identidad` ni `esAccesoTotal`.

- **R25** — Ningún archivo de la 131 DEBE importar, referenciar ni renderizar analítica financiera
  (`lib/actions/analitica-financiera`, `lib/types/analitica-financiera`, métricas de
  `dominio: "financiera"`). El nombre genérico `lib/actions/analitica.ts` SIGUE prohibido y la 131
  no lo crea.

- **R26** — El sistema NO DEBE alterar el gate de la ruta: `ROLES_ACCESO_ANALITICA` sigue siendo
  `["maestro","admin"]`, la página sigue resolviendo el rol server-side y sigue sin aceptar
  parámetros (`AnaliticaPage.length === 0`).

### Estados de la respuesta — «prohibido», «inválido» y «vacío» no son el mismo píxel

- **R2** — MIENTRAS el resultado de un panel sea `forbidden`, el sistema DEBE mostrar un aviso de
  acceso denegado y NO DEBE pintar para ese panel ninguna cifra, cero, eje, leyenda ni estado
  «sin datos».

- **R3** — CUANDO el resultado sea `validation_error`, el sistema DEBE mostrar los mensajes de
  `fieldErrors` asociados a su campo de filtro y NO DEBE presentarlo como «sin datos».

- **R4** — CUANDO el resultado sea `unauthenticated`, el sistema DEBE mostrar un aviso de sesión no
  válida, distinguible del de `forbidden` y del vacío.

- **R24** — SI la invocación de la acción **lanza** (p. ej. `AnaliticaOperativaError`), ENTONCES el
  sistema DEBE mostrar el estado de error **de ese panel** con un mensaje saneado (sin ids de
  orden, guías, teléfonos ni el filtro crudo) y los demás paneles DEBEN seguir renderizándose.

### La ventana ciega y el día parcial — el corazón de la feature

- **R5** — SI la respuesta trae `cobertura.fechasNoComparables` con al menos una fecha, ENTONCES el
  sistema DEBE mostrar un aviso visible que indique **cuántas** fechas del rango no son comparables
  y **cuáles** son sus extremos, y DEBE marcar esas fechas como no comparables en la
  presentación textual de la serie.

- **R6** — MIENTRAS se muestre el aviso de cobertura, éste DEBE declarar además la limitación
  permanente (`cobertura.penumbra`): órdenes vivas al horizonte sin transición posterior. El
  sistema NO DEBE estimarla, rellenarla ni convertirla en un número.

- **R7** — El sistema NO DEBE escribir la fecha del horizonte del historial como literal en ningún
  archivo suyo: el texto del aviso se DERIVA de `cobertura.fechasNoComparables`.

- **R8** — SI un punto de la serie llega con `parcial: true`, ENTONCES el sistema DEBE distinguirlo
  del resto **por texto** (no solo por color), citando su `corteAt` en horario de Costa Rica.

- **R9** — SI un valor agregado por el tablero (total, KPI o cubo temporal) incluye al menos un
  punto `parcial: true`, ENTONCES el sistema DEBE anunciar que el agregado es parcial. NO DEBE
  presentar un agregado que mezcla días cerrados con el día en curso como si fuera cerrado.

### Filtros

- **R11** — El sistema DEBE ofrecer cuatro filtros: rango (los cuatro valores de `RANGO_PRESETS`),
  zona, tienda y mensajero; y DEBE enviarlos a la acción como el objeto `raw` que valida
  `analiticaFiltroSchema`, **sin ninguna clave adicional** (el esquema es `.strict()`).

- **R12** — CUANDO el usuario cambie cualquier filtro, el sistema DEBE volver a consultar **todos**
  los paneles con el filtro nuevo, y NO DEBE mostrar el resultado del filtro anterior como si
  correspondiera al nuevo.

- **R13** — MIENTRAS el usuario no haya tocado ningún filtro, el sistema DEBE consultar con el
  estado inicial declarado en `design.md §5.1` (preset único, sin zona/tienda/mensajero), y ese
  estado DEBE ser el mismo en cada carga de la página.

- **R14** — SI el preset es `personalizado`, ENTONCES el sistema DEBE enviar `desde` y `hasta`; y SI
  el preset NO es `personalizado`, ENTONCES el sistema NO DEBE enviar `desde` ni `hasta`.

- **R22** — Las opciones de zona, tienda y mensajero DEBEN salir de las acciones existentes del repo
  (`obtenerCatalogoFiltrosOrdenes`, `listarUsuariosPorRol`); el sistema NO DEBE declarar catálogos
  propios. SI ese catálogo falla o responde distinto de `ok`, ENTONCES el tablero DEBE seguir
  operativo con ese filtro **deshabilitado** y el resto de la pantalla viva.

- **R23** — El sistema DEBE ofrecer un control explícito de actualización que vuelva a consultar
  todos los paneles con el filtro vigente, sin recargar la página y sin cambiar el filtro.

### Presentación honesta de los números

- **R15** — SI una serie desagregada trae más de 5 categorías, ENTONCES el sistema DEBE agrupar la
  cola en una categoría «otros» **antes** de pasarla a los componentes de la 130, conservando las 5
  primeras por magnitud, y DEBE anunciar cuántas categorías se agruparon.

- **R16** — SI el rango produce más de 62 puntos por serie, ENTONCES el sistema DEBE agregarlos
  temporalmente antes de pasarlos a los componentes de la 130, y DEBE anunciar el grano usado.

- **R17** — El sistema DEBE agregar temporalmente **solo** las métricas de `unidad: "conteo"`, y NO
  DEBE promediar puntos diarios de métricas de `unidad: "porcentaje"` o `"segundos"` para producir
  un valor de periodo (sería una media de medias, que el servicio evita a propósito sumando antes
  de dividir). SI el rango excede el techo de puntos y la métrica es `porcentaje` o `segundos`,
  ENTONCES el panel NO DEBE pintar serie y DEBE mostrar el aviso de reducir el rango (**D3**).

- **R27** — MIENTRAS un panel de `porcentaje` o `segundos` esté por encima del techo de puntos, el
  sistema NO DEBE mostrar ninguna cifra total de esa métrica mientras no exista una fuente que la
  calcule **sumando antes de dividir**: ni media de medias, ni fórmula recompuesta en la UI. El
  «KPI total» que pedía D3 **no es computable hoy** con lo que expone la 126; es exactamente lo que
  la ficha nueva de §6 viene a resolver, y hasta entonces el hueco se declara en pantalla en vez de
  rellenarse (`design.md §6.3`, punto de vuelta abierto).

- **R18** — CUANDO el sistema agregue temporalmente un cubo que contenga al menos un punto
  `parcial: true`, el cubo resultante DEBE conservar la marca de parcialidad y el `corteAt` más
  reciente.

- **R19** — El sistema DEBE pasar los valores de `unidad: "porcentaje"` a los componentes de la 130
  como la **razón cruda** que devuelve el servicio, sin multiplicar por 100.

- **R20** — El sistema DEBE propagar `valor: null` como `null` a los componentes de la 130. NO DEBE
  sustituirlo por `0` ni omitir el punto.

### Catálogo de paneles

- **R21** — Todo panel del tablero DEBE corresponder a un `metricaId` existente en el catálogo con
  `dominio: "operativa"`, y el sistema NO DEBE decidir qué paneles pinta en función de
  `estadoProduccion`.
  **Por qué es un requisito y no una preferencia:** `incidentes` y `sin_gestionar` están marcados
  `estadoProduccion: "declarada"` en el catálogo (`lib/analytics/metrics.ts:220, 242`) pero la 126
  **sí los sirve con datos reales** —`incidentes` tiene columna en el rollup y es el cuarto término
  del denominador de las tres tasas; `sin_gestionar` se deriva del embudo—
  (`specs/126-…/design.md:468-480`). Un tablero que filtre por ese campo **borra dos KPI vivos sin
  que nada falle**: sin excepción, sin log, sin test rojo y sin hueco visible en la pantalla. Por
  eso el test de R21 DEBE nombrar las dos métricas y afirmar que están presentes, y no limitarse a
  contar paneles (**D6**).

---

## 3. Trazabilidad `R<n>` → test → **mutación que lo pone rojo**

> Un requisito no está cubierto porque exista un test verde: está cubierto porque **esta mutación
> concreta del código de producción pone rojo ese test nombrado**. El implementer ejecuta las 27 y
> pega la salida en `progress/impl_131.md`.

| R | Test que lo cubre | Mutación que DEBE ponerlo rojo |
|---|---|---|
| R1 | `tests/unit/analytics/tablero-operativo-frontera.guardia.test.ts` › «el tablero operativo solo consulta por la Server Action de la 126» | Añadir `import { AnaliticaOperativaService } from "@/lib/services/AnaliticaOperativaService"` en `PanelesOperativos.tsx` |
| R2 | `tests/components/TableroOperativo.test.tsx` › «con `forbidden` muestra acceso denegado y no pinta ninguna cifra ni el vacío de métrica» | En el reductor de estado, tratar `forbidden` como `{ puntos: [] }` (caer al `EmptyState` de la gráfica) |
| R3 | `tests/components/TableroOperativo.test.tsx` › «con `validation_error` muestra el mensaje del campo que falló» | Descartar `fieldErrors` y renderizar el estado vacío |
| R4 | `tests/components/TableroOperativo.test.tsx` › «con `unauthenticated` avisa de sesión no válida, con texto distinto al de prohibido» | Reusar el mismo texto/rama que `forbidden` |
| R5 | `tests/components/TableroOperativo.test.tsx` › «con fechas no comparables muestra el aviso de cobertura con su recuento y sus extremos» | Borrar el render del aviso (o condicionarlo a `length > 1`) |
| R6 | `tests/components/TableroOperativo.test.tsx` › «el aviso de cobertura declara la penumbra» | Quitar la frase de penumbra del aviso |
| R7 | `tests/unit/analytics/operativa-cobertura.test.ts` › «el horizonte se importa de la 125 y no se reescribe» (censo existente, sin tocarlo) | Escribir la fecha del horizonte como literal en `textos.ts` |
| R8 | `tests/components/TableroOperativo.test.tsx` › «el punto del día en curso se anuncia como parcial con su hora de corte» | Devolver `undefined` en el marcador de parcialidad al construir la categoría |
| R9 | `tests/unit/analytics/tablero-agregacion.test.ts` › «un total que incluye el día en curso se marca parcial» | Fijar `parcial: false` en el resultado del totalizador |
| R10 | `tests/unit/analytics/tablero-operativo-frontera.guardia.test.ts` › «el tablero no reimplementa alcance ni identidad» | Importar `resolverAlcance` en `PanelesOperativos.tsx` |
| R11 | `tests/unit/analytics/tablero-filtro.test.ts` › «el filtro emitido lo acepta `analiticaFiltroSchema` y no lleva claves extra» | Añadir `rol` (o `usuario_id`) al objeto emitido |
| R12 | `tests/components/FiltrosOperativos.test.tsx` › «al cambiar de zona se vuelve a consultar con la zona nueva» | Sacar el filtro de la clave de la consulta (dejar clave constante) |
| R13 | `tests/unit/analytics/tablero-filtro.test.ts` › «sin selección del usuario el filtro inicial es el declarado» | Cambiar el preset inicial a otro valor |
| R14 | `tests/unit/analytics/tablero-filtro.test.ts` › «`desde`/`hasta` viajan si y solo si el preset es personalizado» | Emitir siempre `desde`/`hasta` |
| R15 | `tests/unit/analytics/tablero-agregacion.test.ts` › «más de 5 categorías se agrupan en otros conservando las 5 mayores» | Devolver las series sin agrupar (el tope de la 130 lanza `SeriesExcedidasError`) |
| R16 | `tests/unit/analytics/tablero-agregacion.test.ts` › «más de 62 puntos se agregan por semana y se anuncia el grano» | Devolver los puntos crudos (`PuntosExcedidosError`) |
| R17 | `tests/unit/analytics/tablero-agregacion.test.ts` › «una métrica de porcentaje nunca se agrega promediando días» | Aplicar la media aritmética de los puntos diarios a `tasa_entrega` |
| R18 | `tests/unit/analytics/tablero-agregacion.test.ts` › «el cubo semanal que contiene el día en curso hereda `parcial` y el `corteAt` mayor» | No propagar `parcial` al cubo agregado |
| R19 | `tests/components/TableroOperativo.test.tsx` › «un 0,842 de tasa se pinta como 84,2 %» | Multiplicar el valor por 100 antes de pasarlo |
| R20 | `tests/unit/analytics/tablero-agregacion.test.ts` › «`null` se propaga como `null` y no como cero» | Sustituir por `valor ?? 0` |
| R21 | `tests/unit/analytics/tablero-catalogo-paneles.test.ts` › «el tablero declara panel para `incidentes` y `sin_gestionar` pese a estar marcadas `declarada`» + «el catálogo de paneles no lee `estadoProduccion`» | Envolver la lista de paneles en `…filter(p => getMetrica(p.metricaId)?.estadoProduccion === "producida")`. **Debe caer el caso que nombra las dos métricas**, no un conteo genérico de paneles (D6) |
| R22 | `tests/components/FiltrosOperativos.test.tsx` › «si el catálogo de filtros falla, los selectores quedan deshabilitados y los paneles siguen vivos» | Propagar la excepción del catálogo en vez de degradar |
| R23 | `tests/components/TableroOperativo.test.tsx` › «el botón de actualizar vuelve a consultar todos los paneles con el mismo filtro» | Hacer que el botón no dispare revalidación |
| R24 | `tests/components/TableroOperativo.test.tsx` › «un panel que lanza no tumba los demás y su mensaje no filtra ids» | Dejar que la excepción suba (sin frontera de error por panel) |
| R25 | `tests/unit/analytics/tablero-operativo-frontera.guardia.test.ts` › «el tablero operativo no toca nada financiero y `lib/actions/analitica.ts` no existe» | Importar `@/lib/types/analitica-financiera` en un archivo del tablero |
| R26 | `tests/components/AnaliticaPage.test.tsx` (existente, ampliado) › «la página no acepta parámetros y sigue negando a los tres roles restantes» | Añadir un rol a `ROLES_ACCESO_ANALITICA`, o dar un parámetro a `AnaliticaPage` |
| R27 | `tests/components/TableroOperativo.test.tsx` › «un panel de tasa por encima del techo no muestra ninguna cifra total, solo el aviso de reducir el rango» | Pintar un `KpiCard` con la media de los puntos diarios (o con la razón recompuesta a mano) en ese panel |

**E2E:** `CHECKPOINTS.md` exige Playwright solo para flujos críticos (auth, pagos, recaudo, ingesta,
webhooks). Este tablero es **solo lectura** y no es ninguno de ellos; la 130 ya declaró que el E2E
«corresponde a 131/132» como *posibilidad*, no como obligación (`specs/130-…/design.md:514`). Esta
spec **no** pide E2E y lo declara para que nadie lo dé por olvidado.

---

## 4. Fuera de alcance (explícito)

- **Caché e invalidación por tag** — es la **128** (`pending`, backend). El tablero no llama a
  `revalidateTag`, no declara `cacheTag` y no asume ninguna frescura distinta de «lo que devuelva la
  acción en esta llamada» (design §9).
- **Ampliar el acceso a `adminSatelite`/`adminTienda`/`mensajero`** y los recortes por rol de la
  UI — es la **133**.
- **Tablero financiero y slot `financiero` del shell** — es la **132**. Esta feature **no toca**
  `AnaliticaShell.tsx`.
- **Corregir `lib/analytics/metrics.ts`** — es la **175**. Esta feature no escribe una línea ahí.
- **Exportar CSV** — es la **134**.

## 5. Contradicción con la 129: resuelta a favor del guardia (D7, ratificada por el humano)

Además de las tres divergencias del catálogo ya heredadas a la 175, esta spec deja anotada una
**cuarta observación**, que no es del catálogo sino del **contrato de la 129**:

- **`tests/components/AnaliticaPage.test.tsx:145-157` afirma que `app/(app)/analitica/page.tsx` NO
  importa `lib/actions`, `lib/services` ni `lib/repositories`** (R24 de la 129), y `:102-104` afirma
  que la página **no acepta parámetros** (`AnaliticaPage.length === 0`). Pero
  `specs/129-…/design.md:143-145` dice que **la 131 añadirá sus `await listar…()` en esa página** y
  bajará los resultados por props del shell. **Las dos cosas no pueden ser ciertas a la vez.**

**D7 (humano, 2026-08-03): se conservan los tests y se contradice la prosa del design de la 129, a
propósito.** En este repo **el guardia manda sobre la prosa del diseño**: un test es verificable y
una frase de un `design.md` ajeno no. La página no prefetchea; los datos se piden desde el módulo
cliente por Server Action + SWR, que además es el patrón dominante del repo (`OrdenesModule`).

**Rastro para quien lea la 129 después:** esto NO es un olvido de la 131 ni una relajación de un
test ajeno. La expectativa de prefetch escrita en `specs/129-…/design.md:143-145` **queda sin
cumplir deliberadamente**, con la decisión y su motivo registrados aquí, en `design.md §4.2` y en
`progress/impl_131.md` (T7.3). Si algún día se quiere el prefetch en la página, la conversación
empieza por retirar o reescribir esas dos aserciones de `AnaliticaPage.test.tsx` **en su propio
PR**, no por colarlo de lado.

---

## 6. Decisiones del humano (puerta T0, 2026-08-03)

Las cinco preguntas de la puerta están **respondidas y cerradas**. Se copian con su motivo, y cada
una dice qué requisito o sección gobierna.

| # | Pregunta | Respuesta del humano | Dónde vive ahora |
|---|---|---|---|
| **D1** | ¿Cómo se presenta la ventana ciega? | **(A)** aviso **único** con recuento y extremos + marca en la alternativa textual. *(B) altera lo que el usuario pidió y tapa el agujero; (C) repite el aviso hasta volverlo invisible* | **R5, R6, R7** · `design.md §6.4` |
| **D2** | ¿Qué se hace con el día en curso? | **(A)** se pinta **en la serie**, marcado por texto con su `corteAt`, y **todo agregado que lo incluya se anuncia parcial** | **R8, R9, R18** · `design.md §6.4` |
| **D3** | Rango largo + tasas/tiempos | **(A) ahora + ficha para (C).** Por encima del techo, los paneles de `porcentaje`/`segundos` **no pintan serie**: piden reducir el rango. **Nunca media de medias** — reintroduce por la UI el error que `AnaliticaOperativaService.ts:38-40` evita a propósito. Y se **da de alta la ficha (C)**: pedirle a la 126 un modo agregado de verdad | **R16, R17, R27** · `design.md §6.3` · ficha nueva en §7 |
| **D4** | ¿Un panel = una llamada? | **(A)** N llamadas, **una por panel**, con **≤6 paneles** y **la latencia medida** en la tarea de verificación. Se descarta la Server Action compuesta: pondría a una feature *frontend* a escribir en `lib/actions/`, que es justo donde la **128** va a colgar su caché **en paralelo** | `design.md §4.3` y §10.1 · **T7.2** |
| **D5** | Reparto con la 132 | **(A)** la **131 aterriza primero**. Cada feature en su subárbol (`_components/operativo/**`); la 131 añade sus **dos** slots y **no toca `AnaliticaShell.tsx`**. El conflicto en `page.tsx` debe quedar en ~3 líneas | `design.md §1.2` y §1.3 · **T6.1, T6.3, T7.4** |
| **D6** | (añadida por el humano) mutación de R21 | La mutación de **R21 debe ser inequívoca**: es un fallo **silencioso y en pantalla**. El test nombra `incidentes` y `sin_gestionar` y afirma su presencia; no cuenta paneles | **R21** y su fila de trazabilidad |
| **D7** | Contradicción con la 129 | **Se acepta la resolución del spec_author:** se conservan los dos tests y se contradice la prosa de `specs/129-…/design.md:143-145` deliberadamente. **El guardia manda sobre la prosa del diseño** | **§5** · `design.md §4.2` · **T7.3** |

### 6.1 Consecuencia de D3 que hay que decir en voz alta (punto de vuelta abierto)

D3 pide que, por encima del techo, esos paneles «muestren el KPI total y pidan reducir el rango».
**El KPI total no es computable hoy sin romper la propia D3**, y no lo relleno:

- **media de los puntos diarios** → es la media de medias que D3 prohíbe explícitamente;
- **recomponer la razón desde las métricas de conteo** (`entregas / Σ DENOMINADOR_GESTIONES`) sería
  exacto, pero duplica en la UI una fórmula de negocio que vive en el catálogo y en el servicio, y
  obligaría a importar `lib/analytics/metrics` en un módulo de cliente (prohibido por R25 y por la
  regla que ya aplicó la 130 en `components/private/analytics/tipos.ts:1-9`);
- **para `tiempo_ciclo` es directamente imposible**: sus componentes (`seg_ciclo_acum`,
  `seg_ciclo_n`) no se exponen como métricas, así que no hay nada que sumar antes de dividir.

Por eso **R27** dice que ese panel muestra el aviso y **ninguna cifra** hasta que aterrice la ficha
de §7. Es el hueco declarado en pantalla en vez de rellenado, que es la misma regla que gobierna la
ventana ciega. **Si el humano prefiere la recomposición desde los conteos** (con su coste: fórmula
duplicada en la UI y solo para `porcentaje`), cambia R27 y `design.md §6.3`, y nada más.

## 7. Ficha nueva que sale de D3 (la da de alta el humano en `feature_list.json`; esta spec NO lo toca)

- **name:** `analitica: modo agregado de tasas y tiempos`
- **description:** «Backend. Extiende el contrato de lectura de la analítica operativa (126) con un
  modo AGREGADO por periodo para las métricas que no son sumables: devuelve numerador y denominador
  (o los acumuladores `seg_ciclo_acum`/`seg_ciclo_n`) por cubo temporal, de modo que un consumidor
  pueda sumar antes de dividir y presentar una tasa o un tiempo de ciclo correctos en rangos largos.
  Hoy el servicio solo devuelve el cociente ya dividido por día, así que el tablero (131) no puede
  agregar `tasa_entrega`, `tasa_devolucion`, `tasa_rechazo`, `primer_intento_ok`, `tiempo_ciclo` ni
  `aging_por_estado` sin caer en media de medias, y por decisión D3 no pinta serie ni cifra por
  encima del techo de 62 puntos. Reusa `ConsultaAnalitica` y el alcance ya existentes; no añade
  métricas al catálogo.»
- **zone:** `backend`
- **depends_on:** `126`  *(y conviene que vaya después de la **128**, para no escribir la capa de
  lectura a la vez que la caché — mismo motivo que llevó a D4)*
- **sdd:** `true` · **complexity:** `medium`
- **Consumidor que la desbloquea:** la **131** (R27 deja de ser un hueco en cuanto exista).

---

## Preguntas abiertas

**Ninguna.** Las cinco de la puerta T0 están respondidas (D1–D5) y las dos añadidas por el humano
registradas (D6, D7). El único punto de vuelta vivo es el de **§6.1**, que no bloquea la
implementación: la decisión por defecto ya está escrita en R27.
