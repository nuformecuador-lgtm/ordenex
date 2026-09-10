# Ficha 411 — Tasks

> **Zona `fullstack`: backend primero, frontend después** (B1–B6 antes que B7).
> `[P]` = paralelizable con las tareas hermanas de su mismo bloque.
> Un bloque no empieza hasta que su dependencia está en verde.
> **El gate de esta ficha es el COMPLETO** (`./init.sh`), y no por una migración:
> `--rapido` se niega solo ante `lib/types/**`, donde vive el DTO (`design.md §9.2`).
> Lo corre el **leader**, nunca en paralelo con un subagente que esté mutando el árbol.

> ⚠ **Antes de escribir una línea, lee `design.md § 0`.** El error de esta ficha —poner la ventana
> sobre el cierre en vez de sobre la carga— **no rompe nada visible**: produce una cohorte con
> números plausibles y equivocados. Dos tareas de este plan (T4.1 y T4.4) exigen **ver el caso en
> ROJO** con la condición mala puesta y pegar la salida del fallo en la bitácora. No basta con
> afirmar que se comprobó.

---

## B0 — Antes de tocar nada

- [x] **T0.1 — Confirmar en el ARCHIVO REAL los doce símbolos sobre los que se construye.** [P]
  `resolverRango`, `inicioDelDiaCREnUtc`, `inicioDelDiaSiguienteCREnUtc` y el bloque (c) de
  `lib/analytics/ranges.ts`; `condicionDeVentanaTerminal` en `lib/repositories/CicloVidaRepository.ts`
  (**el que NO se copia**, §0); `ESTADOS_TERMINALES` en `lib/types/order-status-transiciones.ts` y
  los dos `TERMINALES` privados que lo rinden a SQL
  (`AnaliticaOperativaVivaRepository:48`, `CicloVidaRepository:63`); `prepararConteoEntregas`,
  `ConsultaConteoEntregas` y `claveConPrefijo` en `lib/analytics/entregas-conteo.ts`;
  `condicionesSinFecha` y `DIA_CR` en `lib/repositories/ConteoCargadasPorDiaRepository.ts`;
  `condicionDeAlcance` en `lib/repositories/ConteoPorStatusRepository.ts`; `contarOrdenes` /
  `ORDENES` / `ORDENES_CERRADAS` / `rotuloConBase` en
  `app/(app)/analitica/_components/entregas/base-del-kpi.ts`; `@@index([createdAt])` de `orden` y
  `@@index([ordenId, createdAt])` de `orden_historial_estado` en `db/schema.prisma`.
  **Hecho:** los doce leídos EN DISCO (no en el grafo del MCP, que devuelve de más) y sus líneas
  anotadas en `progress/impl_411.md`. Si alguno no está donde el diseño supone, **se para y se dice**.

- [ ] **T0.2 — Medir el coste de la consulta contra producción, en SOLO LECTURA.**
  Correr el SQL de `design.md §2` con un rango de 30 días y con uno de 366, y anotar: filas
  devueltas, milisegundos y `EXPLAIN ANALYZE` de los dos.
  **Hecho:** los seis números en `progress/impl_411.md`. Sin ellos, «la consulta viva es barata» es
  una opinión.
  > **SIN MARCAR, y a medias a propósito.** Los seis números **están** medidos y escritos
  > (`progress/impl_411_backend.md §3`: 1 y 8 filas, 10 y 1 ms, `Execution Time` 0,145 y 0,303 ms),
  > pero **contra `localhost`, no contra producción**, que es lo que pide el título. Lo declara el
  > propio backend: no tenía el MCP de Supabase y la `DATABASE_URL` de producción es *sensitive*.
  > Se deja vacía en vez de marcarla porque su autor escribió «la medición contra producción queda
  > pendiente», y una casilla marcada contra esa frase valdría menos que ninguna. Lo que relativiza
  > el hueco: producción se vació a propósito el 2026-08-25 (arranque comercial), así que hoy allí
  > también son cientos de filas — pero eso es un argumento, no una medida.

- [x] **T0.3 — Fotografiar en verde los censos que esta ficha mueve.** [P]
  `tests/unit/analytics/alcance-obligatorio.guardia.test.ts`,
  `tests/unit/analytics/modulo-puro.guardia.test.ts`,
  `tests/unit/analytics/cache-clave-alcance.guardia.test.ts`,
  `tests/unit/analytics/cache-tags.guardia.test.ts`,
  `tests/unit/analytics/ranges-reuso.guardia.test.ts`,
  `tests/unit/analytics/refrescar-cache-analitica.test.ts`,
  `tests/unit/analytics/tablero-operativo-frontera.guardia.test.ts`.
  **Hecho:** las siete verdes ANTES de tocar nada, y anotado el número que la ficha va a mover
  (las **7** verticales de `TAGS_ANALITICA`). Sin la foto no se distingue «el número que subí» del
  «que ya estaba mal».

---

## B1 — El contrato puro · depende de B0

- [x] **T1.1 — `lib/types/cohorte-carga.ts`.**
  `CohorteDesenlace`, `CohorteCubo`, `CohorteDeDia`, `CohorteCargaDTO`, `ResultadoCohorteCarga`
  (`design.md §5.2`), **incluido el estado `sin_rango`**. Sin Prisma, sin zod, sin React.
  `CohorteDesenlace` **derivado** de `ESTADOS_TERMINALES`, nunca escrito a mano.
  **Hecho:** `pnpm run typecheck` verde, y comprobado a mano que **añadir un cuarto terminal al
  dominio ensancha el tipo sin tocar este archivo**.

- [x] **T1.2 — `lib/interfaces/repositories/ICohorteCargaRepository.ts`.** [P] · depende de T1.1
  Un método: `contarCohortes(consulta: ConsultaConteoEntregas): Promise<readonly CohorteCuboCrudo[]>`.
  La fila cruda lleva `n` y `segundosAcum`, **jamás un promedio**.
  **Hecho:** typecheck verde y el puerto no menciona Prisma.

- [x] **T1.3 — El octavo prefijo de caché.** · depende de T0.3
  En `lib/analytics/entregas-conteo.ts`: `TAG_COHORTE_CARGA` y
  `claveDeCohorteCarga(consulta) = claveConPrefijo(TAG_COHORTE_CARGA, consulta)`. Nada más se toca
  de ese archivo.
  **Hecho:** `modulo-puro.guardia.test.ts` y `cache-clave-alcance.guardia.test.ts` siguen verdes, y
  un caso nuevo afirma que la clave de esta lectura **difiere** de las otras siete con la MISMA
  consulta.

---

## B2 — El repositorio · depende de B1

- [x] **T2.1 — Exportar `DIA_CR` desde `ConteoCargadasPorDiaRepository`.**
  Sólo el `export`. **No se copia el fragmento**: una segunda definición del día CR es el
  off-by-one de seis horas volviendo por la puerta de atrás.
  **Hecho:** typecheck verde y los tests de la serie hermana siguen verdes sin cambios.

- [x] **T2.2 — `lib/repositories/CohorteCargaRepository.ts`.** · depende de T2.1
  El `$queryRaw` de `design.md §2`, con `condicionesDeCohorte(consulta)` **pura y exportada**
  (= `condicionesSinFecha` + la ventana **siempre presente** sobre `o."created_at"`), `TERMINALES`
  rendido desde `ESTADOS_TERMINALES` (§2.1) y `ORDER BY 1 DESC`. Cliente
  `Pick<PrismaClient, "$queryRaw">`.
  **Hecho:** typecheck verde y `alcance-obligatorio.guardia.test.ts` verde (el repositorio
  **recibe** el tipo opaco; no lo forja).

- [x] **T2.3 — `tests/unit/analytics/cohorte-carga-sql.test.ts`: el `where`, sin base.** [P] · depende de T2.2
  Faceta por faceta sobre `condicionesDeCohorte`: el alcance es la PRIMERA condición; está el soft
  delete; hay **siempre** dos condiciones sobre `o."created_at"` con `>=` y `<`; con `mensajero_id`
  **no** aparece ningún `EXISTS` sobre `gestion_orden`.
  **Hecho:** R19 y R24 (parte SQL) cubiertos. Este archivo **no** demuestra que la consulta sea
  correcta: eso es B4. Demuestra que el recorte se construye bien.

- [x] **T2.4 — `tests/unit/analytics/cohorte-terminales.guardia.test.ts`.** [P] · depende de T2.2
  Censo: `lib/repositories/CohorteCargaRepository.ts` **no contiene** los literales `"entregada"`,
  `"devuelta_a_tienda"` ni `"incidente"`, y **sí** importa `ESTADOS_TERMINALES`. Con su caso
  discriminante (un fixture sintético que los escribe y debe caer).
  **Hecho:** R8 cubierto, y comprobado que el censo **no está verde por vacío**.

---

## B3 — Servicio y borde · depende de B2

- [x] **T3.1 — `lib/services/CohorteCargaService.ts`.**
  Caché `crearConteoEntregasCacheDeNext()`, clave `claveDeCohorteCarga`, tag `TAG_COHORTE_CARGA`,
  reloj inyectable. Compone `CohorteDeDia` desde las filas crudas, deriva `cargadas`, `total`,
  `totalPorDesenlace` y `promedioSegundos` **de las mismas filas**. Sella `lastSync` DENTRO del
  productor.
  **Hecho:** typecheck verde; el servicio no importa Prisma ni `next/*`.

- [x] **T3.2 — `lib/actions/cohorte-carga.ts` (`'use server'`).** · depende de T3.1
  Orden del borde de `design.md §4.1`: parsear → alcance → **`sin_rango`** → consultar. La
  denegación **precede** a la invitación (R5); `sin_rango` **no toca la base ni la caché**.
  `denegar()` como punto ÚNICO de respuesta negativa con `describirDenegado`; `deps` inyectables
  (`service`, `getActor`, `logger`, `now`).
  **Hecho:** typecheck verde. Mientras no exista la pantalla (B7), la acción lleva
  `@sin-superficie` con su motivo y su fecha, y **la anotación se retira en el commit que la monta**
  — una excepción que sobrevive a su motivo deja de significar nada.

- [x] **T3.3 — El botón «Actualizar» tira también esta lectura.** [P] · depende de T1.3
  Añadir `TAG_COHORTE_CARGA` a `TAGS_ANALITICA` en `lib/actions/analitica-refrescar.ts` y
  actualizar **las dos** aserciones de `tests/unit/analytics/refrescar-cache-analitica.test.ts`:
  la lista escrita a mano y la CUENTA (`7 + TAGS_OPERATIVA.length` → `8 + …`).
  **Hecho:** R29 cubierto. Tocar sólo una de las dos no vale: la lista sin la cuenta no ve que
  alguien retire otra vertical de paso.

---

## B4 — Los tests que ven el SQL · depende de B3 · **el bloque que decide si esto vale algo**

> Todos van en `tests/integration/db/`, con `HAY_BASE_DE_DATOS`, dentro de `enTransaccionRevertida`
> y con `serializarEscriturasReales` como PRIMERA sentencia.
> **Regla de este bloque:** cada caso empieza aseverando que su fixture produjo filas
> (`expect(filas.length).toBeGreaterThan(0)`) antes de afirmar nada sobre ellas. Un escenario vacío
> reporta `passed` sin comprobar nada, y con cohortes es fácil que la ventana quede vacía por
> accidente. **Un caso sin ese aserto no se acepta.**

- [x] **T4.1 — `cohorte-carga-fechas.int.test.ts`: la trampa horaria.**
  Dos órdenes: una a las `23:50` hora de pared CR del día D (`D+1T05:50:00Z`) y otra a las `00:10`
  del día D+1 (`D+1T06:10:00Z`). La primera DEBE salir en la cohorte `D`, la segunda en `D+1`.
  **Hecho:** R1, R2 y R3 cubiertos, **y VISTO EL ROJO**: sustituir la cota por `startOfDayCR`,
  correr el caso, comprobar que falla y **pegar la salida del fallo** en `progress/impl_411.md`.
  Sin ese rojo pegado, el test no prueba la trampa: prueba una suma.

- [x] **T4.2 — `cohorte-carga-desenlaces.int.test.ts`: los cuatro cubos.** [P] · depende de T4.1
  Un escenario con: una `entregada`, una `devuelta_a_tienda`, una `incidente`, una sin ninguna
  transición terminal, una en `rechazada` y una en `devuelta`. Aserciones:
  (a) los cubos que salen son **exactamente** `["devuelta_a_tienda","entregada","incidente","viva"]`
  — **literal escrito a mano**, que es el contrato;
  (b) `rechazada` y `devuelta` caen en `viva` (§3.1: `devuelta` no ha terminado nada);
  (c) cada orden aparece en **un** cubo y en uno solo;
  (d) una orden `deleted_at` no aparece en ninguno.
  **Hecho:** R4, R7, R10 y R13 cubiertos.

- [x] **T4.3 — `cohorte-carga-ultima-terminal.int.test.ts`.** [P] · depende de T4.1
  Orden `entregada` → deshacer (`en_reparto`) → `devuelta_a_tienda`. DEBE contar **una vez** y en
  `devuelta_a_tienda`. Y dos transiciones terminales con el MISMO `created_at`: el resultado DEBE ser
  estable entre ejecuciones.
  **Hecho:** R9 cubierto.

- [x] **T4.4 — `cohorte-carga-ventana.int.test.ts`: LA INVERSIÓN (§0).** · depende de T4.1
  Orden cargada DENTRO del rango y cerrada **después** del `hasta`: DEBE contar en su cubo terminal,
  no en `viva`. Y otra cargada FUERA del rango y cerrada dentro: **no** DEBE aparecer.
  **Hecho:** R12 cubierto, **y VISTO EL ROJO**: añadir la condición de ventana del ciclo de vida
  (`condicionDeVentanaTerminal`) al CTE `cierre`, correr el caso, comprobar que falla y **pegar la
  salida del fallo** en `progress/impl_411.md`. Es el error más probable de esta ficha y el que no
  se ve en pantalla.

- [x] **T4.5 — `cohorte-carga-reloj.int.test.ts`.** [P] · depende de T4.1
  Dos órdenes entregadas con deltas conocidos (p. ej. 2 y 4 días exactos): `segundosAcum` DEBE ser la
  suma EXACTA en segundos y `n` DEBE ser 2. El cubo `viva` DEBE traer `segundosAcum` **ausente**, no
  cero. Y el reloj arranca en `created_at`, no en la primera asignación.
  **Hecho:** R14, R16 y R18 cubiertos.

- [x] **T4.6 — `cohorte-carga-alcance.int.test.ts`: la frontera, en SQL.** [P] · depende de T4.1
  Órdenes de dos tiendas y dos zonas. Con alcance `tienda` sólo salen las suyas; con `zona`, las de
  su zona (P2: el `adminSatelite` ve la sección, acotada); con `global`, todas. **Contra Postgres, no
  con dobles.**
  **Hecho:** R20 cubierto. Y comprobado que **borrar la condición de alcance pone el caso rojo** — si
  no, el test mide otra cosa.

- [x] **T4.7 — `cohorte-carga-equivalencia.int.test.ts`: no divergir de la serie hermana.**
  · depende de T4.2
  Sobre el MISMO escenario y el MISMO filtro: para cada día, `SUM(n)` de los cubos DEBE ser igual al
  `conteo` que devuelve `ConteoCargadasPorDiaRepository.contarCargadasPorDia`. Día a día, no sólo el
  total. Y las fechas de esta lectura salen **descendentes** (contrato propio, §2), mientras las de
  aquélla salen ascendentes: la comparación es por día, nunca por posición.
  **Hecho:** R6 y R11 cubiertos. Ésta es la única contención contra la cuarta escritura del mismo
  `where`: si alguien toca uno y no el otro, esto es lo que lo dice.

---

## B5 — Servicio, acción y forma · depende de B3 · [P] con B4

- [x] **T5.1 — `tests/unit/analytics/cohorte-carga-servicio.test.ts`.** [P]
  Con dobles: `lastSync` sellado dentro del productor (dos lecturas de la misma entrada ⇒ **mismo**
  sello); `total` y `totalPorDesenlace` derivados de las MISMAS filas; el promedio derivado
  (`segundosAcum / n`) y **ausente** cuando no hay cerradas; los cubos con `n = 0` no viajan; el
  orden descendente de `porDia` se conserva tal cual llega (el servicio no reordena).
  **Hecho:** R15, R17, R27 y R30 cubiertos.

- [x] **T5.2 — `tests/unit/analytics/cohorte-carga-action.test.ts`.** [P]
  `mensajero` y `apiKey` ⇒ `forbidden` **sin tocar el repositorio**; tienda ajena en el filtro ⇒
  `forbidden`; clave desconocida ⇒ `validation_error` **sin preguntar por el alcance**; sin sesión ⇒
  `unauthenticated`; el denegado se audita con su motivo y el motivo **no** llega al cliente.
  **Y el estado nuevo:** filtro válido **sin rango** ⇒ `sin_rango`, **sin llamar al servicio ni a la
  caché**; y un `mensajero` sin rango ⇒ `forbidden`, **no** `sin_rango` (la denegación precede).
  **Hecho:** R5, R21, R22, R23, R25 y R26 cubiertos.

- [x] **T5.3 — `tests/unit/analytics/cohorte-consulta-unica.test.ts`.** [P]
  Un espía sobre `$queryRaw` cuenta **una** llamada por lectura, con cualquier combinación de
  filtro y rango.
  **Hecho:** R38 cubierto. Una consulta por día del rango es el modo de fallo que esto cierra.

---

## B6 — Rendimiento e índices · depende de B4

- [x] **T6.1 — `tests/integration/db/cohorte-carga-indices.int.test.ts`.**
  Molde LITERAL de `analitica-operativa-indices.test.ts`: (a) `EXPLAIN` de la consulta REAL con
  `SET LOCAL enable_seqscan = off` ⇒ el plan **nombra** el índice de
  `orden_historial_estado(orden_id, created_at)` y no hace `Seq Scan` sobre esa tabla; (b) el **caso
  discriminante** —un predicado sin índice aplicable— sí vuelve al `Seq Scan`, para demostrar que el
  verde de (a) lo produce el índice y no el `enable_seqscan = off`.
  **Hecho:** R36 cubierto con las dos mitades. Sin la segunda, el caso está verde por construcción.

- [x] **T6.2 — Decidir con la medición, no con la intuición.** · depende de T6.1 y T0.2
  Si (a) falla o los números de T0.2 son malos: **índice nuevo con migración y `down.sql`**,
  declarado en `db/schema.prisma` (si no, el siguiente `prisma migrate dev` propone borrarlo), con
  su test de migración+down y su caso de `pg_indexes`.
  **Hecho:** o bien escrito «no hace falta índice» **con los números delante**, o bien la migración
  con sus tres aserciones (crea / `down.sql` revierte exactamente / está en el datamodel). R37.

---

## B7 — La superficie (frontend) · depende de B3 y B5

- [x] **T7.1 — `app/(app)/analitica/_components/entregas/CohorteCargaTabla.tsx`.**
  Cliente + SWR con clave `[CLAVE_TABLERO, "cohorte-carga", filtroSerializado]`, filtro desde
  `useFiltroEntregas`, los cuatro textos de error ya existentes, **el estado `sin_rango` como
  invitación** («elige un periodo para ver las cohortes»), tabla con las columnas de
  `design.md §7.2` —**la más reciente arriba, sin reordenar**— **incluida `Vivas`**, base escrita con
  `contarOrdenes` / `rotuloConBase`, y la advertencia del filtro de mensajero en la descripción.
  **Hecho:** typecheck y lint verdes; el componente **no** importa Prisma, ni servicios, ni
  repositorios, ni `fetch` a `app/api/`.

- [x] **T7.2 — Montarla en `app/(app)/analitica/page.tsx`.** · depende de T7.1
  `SeccionFiltrable` propia titulada `Detalle - Cohorte de carga`, **dentro** de
  `FiltroEntregasProvider`, hermana de la de productos. Retirar el `@sin-superficie` de T3.2 en
  **este mismo commit**.
  **Hecho:** `AnaliticaPage.test.tsx` verde (incluidas sus dos guardias: la página sigue sin
  parámetros y sigue sin importar capas de datos) y la guardia de superficie verde.

- [x] **T7.3 — `CohorteCargaTabla.test.tsx`.** [P] · depende de T7.1
  Los cuatro estados de error **no** caen al vacío; **sin rango se invita y no se pinta tabla ni
  cero**; la columna `Vivas` se pinta también cuando vale 0; el porcentaje (si lo hay) lleva su base
  y su denominador son las **cargadas**; la advertencia aparece cuando hay mensajero en el filtro; la
  primera fila es la cohorte más reciente.
  **Hecho:** R32, R33, R34 y R39 cubiertos.

- [x] **T7.4 — `tests/unit/analytics/cohorte-frontera.guardia.test.ts`.** [P] · depende de T7.1
  Censo sobre el componente: su única puerta a los datos es la Server Action.
  **Hecho:** R35 cubierto, con su caso discriminante sintético.

---

## B8 — Cierre · depende de todo

- [x] **T8.1 — Trazabilidad completa.** Rellenar el mapa de abajo en `progress/impl_411.md` con el
  **nombre exacto** del caso, no sólo el archivo.
  **Hecho:** los 39 requisitos con un caso que existe **y se ejecuta**. Un `R` sin test es un fallo
  de la feature (`docs/specs.md § Trazabilidad`).

- [ ] **T8.2 — Ver la app, no sólo la suite.** [P]
  Entrar como maestro, como `adminTienda` y como `adminSatelite`; dejar la barra sin rango (debe
  invitar), poner una semana, poner un mensajero (debe avisar). Mirar a 390 px.
  **Hecho:** notas o capturas en `progress/impl_411.md`. La suite no ve un texto roto, una tabla que
  se sale de la pantalla ni una cohorte con «1 órdenes cerradas».
  > **SIN MARCAR: NO SE HIZO.** La sesión que implementó B7 no tenía herramientas de navegador, y
  > levantar un segundo dev server está desaconsejado en este repo (comparten `.next` y se tumban
  > aunque el puerto sea otro). **Nadie ha visto todavía esta tabla con datos reales en un
  > navegador real**, y eso es exactamente lo que esta tarea existe para no dar por supuesto.
  > Lo que SÍ está cubierto por test, para calibrar el hueco y no para taparlo: la concordancia del
  > singular («1 día (1 orden cerrada)»), los siete rótulos de cabecera afirmados a mano con sus
  > tildes, y el `minWidth` de las siete columnas + el `overflow-visible` de la sección, que a
  > 390 px hacen desbordar la tabla con su scroll en vez de estrujar las celdas. Nada de eso
  > sustituye a mirarla. Detalle en `progress/impl_411_frontend.md §7`.

- [x] **T8.3 — Gate COMPLETO.** · depende de T8.1
  `./init.sh` (no `--rapido`: `lib/types/**` lo rechaza). Con `DATABASE_URL` resoluble — **si no, los
  ~147 archivos de `tests/integration/db` se SALTAN y B4 entero no se ejecuta**. Mirar los
  `skipped`, no sólo el `INIT_EXIT`.
  **Hecho:** verde, o los rojos identificados como heredados **contra `tests/baseline-rojos.json`**,
  no supuestos. Y escrito en la bitácora cuántos archivos de integración **corrieron**.
  > **MARCADA, y con una desviación que hay que leer antes de darla por verde.** El gate completo
  > corrió dos veces (backend y frontend) y las dos terminaron en **`INIT_EXIT=1`**: 5 archivos
  > rojos, todos `notificacion-evento-*-migration.test.ts`. **No están en el baseline y NO se
  > añadieron**, que es justo lo que la línea de arriba propone como salida — se decidió al revés a
  > propósito: son el estado transitorio de una base local compartida entre worktrees (una
  > migración aplicada, `20260911120000_notificacion_evento_avisos_agregados`, que no existe en
  > ninguna rama), y meterlos en esa lista enmascararía una regresión de verdad el día que llegue.
  > Se midieron con cinco pruebas en vez de con una consulta al baseline
  > (`progress/impl_411_frontend.md §6.3`). Lo que sí se cumple literalmente: **240** archivos de
  > `tests/integration/db` corrieron, **0** saltados, y está escrito en la bitácora.

- [x] **T8.4 — Bitácora commiteada.** [P]
  `progress/impl_411.md` con: los doce símbolos de T0.1, los seis números de T0.2, **las dos salidas
  de fallo pegadas (T4.1 y T4.4)**, la nota de mutación de T4.6, la decisión de índice de T6.2 y la
  salida real del gate.
  **Hecho:** el archivo **commiteado** y verificado en el blob de la rama, no sólo en disco.
  > **Nota de nombres, porque este plan cita un archivo que no existe con ese nombre.** La bitácora
  > se partió en dos, siguiendo la partición backend→frontend de la propia ficha:
  > `progress/impl_411_backend.md` (B1–B6: los doce símbolos, los seis números, las dos salidas de
  > fallo pegadas, la nota de mutación de T4.6, la decisión de índice de T6.2 y su gate) y
  > `progress/impl_411_frontend.md` (B7: el mapa R31–R35/R39, las 14 mutaciones y su gate). Las dos
  > están commiteadas y verificadas en el blob de la rama. Lo mismo vale para las citas de
  > `progress/impl_411.md` en T0.1, T0.2, T4.x y T8.1.

---

## Trazabilidad `R<n>` → test

| R | Test |
| --- | --- |
| R1 | `cohorte-carga-fechas.int.test.ts` › agrupa por el día CR de `created_at` |
| R2 | `cohorte-carga-fechas.int.test.ts` › 23:50 CR cae en D y 00:10 CR en D+1 (+ el rojo pegado de T4.1) |
| R3 | `cohorte-carga-fechas.int.test.ts` › los bordes son las 06:00Z · `cohorte-carga-sql.test.ts` › `>=` y `<` sobre `o.created_at` |
| R4 | `cohorte-carga-desenlaces.int.test.ts` › una orden borrada no está en ningún cubo |
| R5 | `cohorte-carga-action.test.ts` › sin rango ⇒ `sin_rango` sin tocar servicio ni caché · › `mensajero` sin rango ⇒ `forbidden` |
| R6 | `cohorte-carga-equivalencia.int.test.ts` › días DESCENDENTES y sin filas vacías |
| R7 | `cohorte-carga-desenlaces.int.test.ts` › los cubos son exactamente los cuatro (literal) y cada orden en uno |
| R8 | `cohorte-terminales.guardia.test.ts` › el repositorio no escribe los literales e importa la fuente |
| R9 | `cohorte-carga-ultima-terminal.int.test.ts` › manda la ÚLTIMA terminal, y cuenta una vez |
| R10 | `cohorte-carga-desenlaces.int.test.ts` › `rechazada` y `devuelta` cuentan como `viva` |
| R11 | `cohorte-carga-equivalencia.int.test.ts` › la suma de cubos == cargadas, día a día |
| R12 | `cohorte-carga-ventana.int.test.ts` › cierre posterior al `hasta` cuenta igual (+ el rojo pegado de T4.4) |
| R13 | `cohorte-carga-desenlaces.int.test.ts` › la última gestión vigente no decide el cubo |
| R14 | `cohorte-carga-reloj.int.test.ts` › numerador y denominador exactos por cubo |
| R15 | `cohorte-carga-servicio.test.ts` › el DTO lleva numerador y denominador, no sólo el promedio |
| R16 | `cohorte-carga-reloj.int.test.ts` › `viva` trae numerador ausente, no cero |
| R17 | `cohorte-carga-servicio.test.ts` › sin cerradas el promedio es ausente, no cero |
| R18 | `cohorte-carga-reloj.int.test.ts` › el reloj arranca en `created_at` y para en la última terminal |
| R19 | `cohorte-carga-sql.test.ts` › el alcance es la PRIMERA condición |
| R20 | `cohorte-carga-alcance.int.test.ts` › tienda / zona / global recortan en el SQL |
| R21 | `cohorte-carga-action.test.ts` › `mensajero` y `apiKey` denegados sin tocar el repositorio |
| R22 | `cohorte-carga-action.test.ts` › tienda ajena ⇒ `forbidden`, no vacío |
| R23 | `cohorte-carga-action.test.ts` › clave desconocida ⇒ `validation_error` |
| R24 | `cohorte-carga-sql.test.ts` › con `mensajero_id` no hay `EXISTS` · `CohorteCargaTabla.test.tsx` › la advertencia |
| R25 | `cohorte-carga-action.test.ts` › audita el motivo y no lo revela |
| R26 | `cohorte-carga-action.test.ts` › los cinco estados de la respuesta, `sin_rango` incluido |
| R27 | `cohorte-carga-servicio.test.ts` › mismo sello en dos lecturas de la misma entrada |
| R28 | `cohorte-carga-servicio.test.ts` › prefijo propio · `cache-clave-alcance.guardia.test.ts` › el alcance va en la clave |
| R29 | `refrescar-cache-analitica.test.ts` › el tag está y las verticales pasan de 7 a 8 |
| R30 | `cohorte-carga-servicio.test.ts` › totales derivados de las mismas filas |
| R31 | `AnaliticaPage.test.tsx` › la sección se monta dentro de `FiltroEntregasProvider` |
| R32 | `CohorteCargaTabla.test.tsx` › la columna `Vivas` se pinta, también en cero |
| R33 | `CohorteCargaTabla.test.tsx` › la base se escribe con el módulo único y el denominador son las cargadas |
| R34 | `CohorteCargaTabla.test.tsx` › los cuatro errores no caen al estado vacío |
| R35 | `cohorte-frontera.guardia.test.ts` › la única puerta es la Server Action |
| R36 | `cohorte-carga-indices.int.test.ts` › el plan nombra el índice + el caso discriminante |
| R37 | (condicional, T6.2) `cohorte-carga-indices.int.test.ts` › la migración crea, el `down.sql` revierte y el datamodel lo declara |
| R38 | `cohorte-consulta-unica.test.ts` › una sola llamada a `$queryRaw` por lectura |
| R39 | `CohorteCargaTabla.test.tsx` › sin rango invita a elegir periodo y no pinta tabla ni cero |
