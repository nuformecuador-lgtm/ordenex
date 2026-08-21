# Feature 258 — Tareas

Dos bloques, **en este orden**: primero `backend_dev`, después `frontend_dev`. El frontend no
arranca hasta que B6 está en verde: el contrato `TableroDia` es la frontera entre los dos.

`[P]` = paralelizable con las tareas hermanas de su mismo bloque (sin intersección de archivos).

> ## ⚠️ DOS COSAS QUE VAN A MORDER SI NO SE LEEN AHORA
>
> **1. La tercera consulta del repositorio rompe una guardia, a propósito.**
> `tests/unit/tablero-dia/frontera.guardia.test.ts` afirma hoy `expect(consultas).toHaveLength(2)`
> y `expect(clasificacion).toEqual(["agregada", "paginada"])`. La serie por hora es una **tercera**
> consulta y es **agregada** (`GROUP BY`), así que la clasificación esperada pasa a
> `["agregada", "paginada", "agregada"]`. Es la tarea **B3.3**, con nombre y sitio. No es una
> sorpresa y **no se resuelve aflojando el matcher**.
>
> **2. El gate de esta ficha es `./init.sh` COMPLETO, no `--rapido`.**
> Se toca `lib/types/tablero-dia.ts`, y según `docs/verification.md` el modo rápido **se niega
> solo** ante `lib/types/**`. Es un `fail`, no un aviso. Los subagentes corren `pnpm typecheck`,
> `pnpm lint` y `pnpm exec vitest related --run <sus archivos>`; **el gate lo corre el leader**,
> completo, al cerrar cada bloque y antes del PR.

> ## Decisiones firmadas — no hay preguntas abiertas
> Las siete preguntas de la primera versión están resueltas y viven como requisitos en
> `requirements.md §10`, con su procedencia en `design.md §12`. Las tres que cambian el trabajo
> respecto al primer borrador: **la línea se reusa de `GraficaLineas`** (no se dibuja),
> **los totales se recalculan con filtro activo** y **la barra apilada entra**.

---

## Bloque BACKEND — la serie de entregas por hora

### B1 — Aritmética de la hora de pared

- [x] **B1.1 — `horaDeParedCR(ventana, instante)` en `lib/utils/ventana-dia-cr.ts`.**
      Devuelve `clamp(floor((instante − ventana.desde) / 3.6e6), 0, 23)`. Sin `startOfDayCR`, sin
      `new Date()` propio, sin zonas horarias: el offset ya está dentro de `ventana.desde`.
      **Hecho:** test nuevo cubre 00:00 CR → 0, 23:59 CR → 23, un instante fuera de la ventana por
      arriba → 23 (recorte) y el borde de las 06:00 UTC.
      **Test:** `tests/unit/utils/ventana-dia-cr-hora.test.ts` (nuevo).

### B2 — Contrato

- [x] **B2.1 — Extender `lib/types/tablero-dia.ts`.**
      (a) `PuntoRitmoEntregas { hora; acumulado }`; (b) campo **obligatorio** `ritmoEntregas` en
      `TableroDia`; (c) **mover aquí `sumarTotalesTablero(filas)`**, que hoy vive como
      `sumarTotales` dentro de `TableroDiaService.ts`.
      El (c) no es cosmética: el módulo de cliente tiene que recalcular los totales filtrados
      (R43/R65) y no puede importar el servicio sin arrastrar `lib/analytics/alcance` y el
      adaptador de caché al navegador. Este archivo ya declara en su cabecera que es importable
      desde un Client Component.
      **Hecho:** `pnpm typecheck` señala TODOS los sitios que construyen un `TableroDia`; ninguno
      se apaga con `as` ni con `?`. `lib/types/tablero-dia.ts` sigue sin importar
      `repositories/`, `services/`, `@/lib/db` ni `next/headers`.

- [x] **B2.2 — Extender `lib/interfaces/repositories/ITableroDiaRepository.ts`.** `[P]` con B2.1.
      `EntregasEnHora { hora; entregadas }` + `contarEntregasPorHora(ventana, filtro)`.
      El doc del método dice que devuelve **sólo las horas con entregas** y que acumular es del
      servicio.
      **Hecho:** compila y el doble (B2.3) lo implementa sin `any`.

- [x] **B2.3 — Actualizar `tests/unit/services/_doble-tablero-dia.ts`.**
      `RepositorioDoble` implementa el método nuevo apuntando la llamada (`ventana`, `filtro`),
      con un productor inyectable por constructor como los otros dos.
      **Hecho:** `pnpm typecheck` verde; los tests de servicio existentes siguen pasando.
      **Depende de:** B2.2.

### B3 — La consulta

- [x] **B3.1 — Tercera consulta en `lib/repositories/TableroDiaRepository.ts`, AL FINAL del archivo.**
      Reutiliza `cteIdsDelDia` y `fragmentoDeAlcance` (no los copia). `DISTINCT ON` idéntico al del
      tablero. Hora = `FLOOR(EXTRACT(EPOCH FROM (r.at − ${ventana.desde}::timestamp)) / 3600)::int`.
      `GROUP BY 1`. `COUNT` → `Number()` antes de salir.
      Declara `const RESULTADO_ENTREGADA = "entregada" satisfies GestionResultado`.
      **Prohibido:** `AT TIME ZONE`, `startOfDayCR`, `queryRawUnsafe`, interpolar el `zonaId`,
      cualquier `UPDATE/INSERT/DELETE`.
      **Va al final del archivo** porque la clasificación de B3.3 depende del ORDEN en que las
      plantillas `$queryRaw` aparecen en el texto.
      **Hecho:** B3.2 y B3.3 en verde.

- [x] **B3.2 — Test del SQL emitido.**
      Espía `$queryRaw` (patrón de `tests/unit/repositories/tablero-dia-sql.test.ts`) y afirma:
      una sola llamada; `GROUP BY` presente; el `zonaId` viaja como parámetro y **no** aparece en
      la cadena; con alcance global no hay fragmento de zona; `ventana.desde`/`hasta` están entre
      los valores; no hay `AT TIME ZONE` ni ningún literal de zona horaria; no hay
      `UPDATE|INSERT|DELETE|MERGE`; el value `entregada` viaja como parámetro.
      Y la aserción que **ata la serie al contador**:
      `CONTADOR_POR_RESULTADO[RESULTADO_ENTREGADA] === "entregadas"`.
      **Archivo:** `tests/unit/repositories/tablero-dia-ritmo-sql.test.ts` (nuevo).

- [x] **B3.3 — Actualizar `tests/unit/tablero-dia/frontera.guardia.test.ts`.** ← la que muerde
      Cláusula (d): `expect(consultas).toHaveLength(3)` y
      `expect(clasificacion).toEqual(["agregada", "paginada", "agregada"])`, con un comentario que
      diga cuál es la tercera y por qué es agregada.
      **⛔ No se afloja:** nada de `toBeGreaterThanOrEqual` ni de quitar la clasificación — eso
      convertiría la cláusula en decorado.
      **Hecho:** el guardia sigue rojo si alguien añade una cuarta consulta o si la tercera pierde
      su `GROUP BY` (se comprueba mutando a mano y revirtiendo).

### B4 — El servicio

- [x] **B4.1 — `acumularPorHora(histograma, horaCorte)` exportada desde `lib/services/TableroDiaService.ts`.**
      Rellena `0..horaCorte` sin huecos, acumula, monótona por construcción. Función pura.

- [x] **B4.2 — `obtener` pide las dos lecturas con `Promise.all` DENTRO de `cache.envolver`.**
      Mismo `generadoAt`, misma clave, mismo TTL. La autorización sigue **antes** de construir la
      clave: un actor denegado no llega a ninguna de las dos consultas.
      Aquí `sumarTotales` pasa a consumirse de `@/lib/types/tablero-dia` (B2.1c) en vez de estar
      declarada en este archivo.
      **Hecho:** B4.3 en verde.

- [x] **B4.3 — Tests del servicio.** `tests/unit/services/tablero-dia-ritmo.test.ts` (nuevo):
      - acumulado monótono y sin huecos hasta la hora de corte;
      - el último punto coincide con `totales.entregadas` del mismo resultado;
      - un día sin entregas devuelve la serie con todos los acumulados a 0;
      - `generadoAt` es **uno solo** para conteos y serie;
      - un acierto de caché **no** vuelve a llamar a `contarEntregasPorHora`;
      - un actor denegado **no** llama al repositorio ni una vez.
      **Depende de:** B2.3, B4.1, B4.2.

- [x] **B4.4 — Test de `sumarTotalesTablero` en su sitio nuevo.** `[P]` con B4.3.
      `tests/unit/tablero-dia/sumar-totales.test.ts` (nuevo): la identidad de los ocho sumandos se
      cumple sobre cualquier subconjunto de filas (es lo que hace legítimo el recálculo de R43/R65),
      y el conjunto vacío da todo ceros.
      **Hecho:** verde, y `TableroDiaService` ya no declara una segunda suma (censo de fuente).

- [x] **B4.5 — Actualizar los literales de `TableroDia` en tests existentes.** `[P]` con B4.3.
      `tests/unit/actions/tablero-dia-accion.test.ts` (constante `TABLERO`) y cualquier test de
      `tests/unit/services/tablero-dia-*.test.ts` que construya o compare un `TableroDia` con
      `toEqual`.
      **⛔ El literal ES el contrato:** se EXTIENDE con el campo nuevo, no se cambia por
      `expect.objectContaining` ni se deriva de la función que lo produce.

### B5 — Integración contra Postgres real

- [x] **B5.1 — `tests/integration/tablero-dia-ritmo.test.ts` (nuevo).**
      Sobre `tests/integration/_semilla-tablero-dia.ts` (`sembrarBase`, `crearOrden`,
      `crearGestion`, `instanteCR`, `repositorio`, `enTransaccionRevertida`). Escenarios:
      1. **Cuadre (R52):** la suma del histograma es exactamente el `entregadas` que devuelve
         `contarPorMensajero` sobre la MISMA siembra.
      2. **Una orden, tres gestiones el mismo día:** cuenta **una** vez, en la hora de la ÚLTIMA.
      3. **R72 — entregada a las 10:00 y reprogramada a las 15:00:** **no** aparece en la serie.
         El nombre del test dice que eso es lo ESPERADO («el punto de las 10:00 baja: la serie
         sigue al contador»), no una tolerancia. Si alguien «arregla» la línea para que no
         retroceda, este test se pone rojo y le explica por qué.
      4. **Hora de pared:** una gestión a las 00:30 CR cae en la hora 0 y una a las 23:30 CR en la
         23; ninguna se escapa al día vecino.
      5. **Alcance:** con `{tipo:"zona"}` no aparecen las entregas de otra zona.
      6. **Gestión anulada** (`anulada_at` no nulo) no cuenta.
      **⛔ Nada de `if (!fks) return;`:** si el escenario no puede sembrar, el test **falla**.
      Antes de darlo por bueno se mata con una mutación (`< hasta` → `<= hasta`, o quitar el
      `DISTINCT ON`) y se comprueba que se pone rojo.

### B6 — Cierre del bloque backend

- [x] **B6.1 — Gate completo.** El leader corre `./init.sh` (**completo**, no `--rapido`).
      **Hecho:** verde, con el exit code capturado dentro del log (`INIT_EXIT=$?`), no por un
      `echo` posterior.

---

## Bloque FRONTEND — el rediseño

Arranca con B6.1 en verde.

### F1 — Los ocho contadores en `Badge`

- [x] **F1.1 — `VARIANTE_CONTADOR` en `app/(app)/monitoreo/_components/contadores.ts`.**
      Mapa clavado por CLAVE DE CONTADOR, `as const satisfies Record<ClaveResultado |
      BucketSinResultado, VarianteContador>`, con
      `type VarianteContador = NonNullable<ComponentProps<typeof Badge>["variant"]>`.
      **⛔ Nunca el identificador `badgeVariants`.** **⛔ Nunca clavado por value de estatus ni de
      `gestion_resultado`** (el censo de la guardia sólo se dispara con esas claves).
      **Hecho:** quitar una clave deja de compilar (se comprueba y se revierte).

- [x] **F1.2 — `ContadoresTablero.tsx` sobre `Badge`.**
      Cada contador es `<Badge variant={VARIANTE_CONTADOR[clave]} data-contador={clave}
      title={ayuda}>` con etiqueta y cifra **en línea**. Se conservan `data-grupo="resultados"`,
      `data-grupo="sin-resultado"` y la separación visual. Acepta `densidad`: en compacta la
      etiqueta sale del texto visible pero **entra en el nombre accesible**.

- [x] **F1.3 — Verificar `Lock` en `lucide-react@^1.23.0`.** `[P]`
      **Hecho:** `pnpm typecheck` con el import puesto; si no existe, `XCircle`, y se anota el
      cambio en `progress/impl_258_frontend.md`.

- [x] **F1.4 — Ampliar `tests/components/TableroDiaTarjetas.test.tsx`.**
      Sin tocar las aserciones existentes, añade: los ocho contadores son `Badge`; la variante de
      cada uno es la de `VARIANTE_CONTADOR` (comparada **contra el mapa por clave**, no contra la
      clase); censo de fuente del árbol sin hex `#rrggbb`, sin utilidades de paleta cruda
      (`emerald-`, `red-`, `slate-`…) y sin `badgeVariants`; `otros` sigue con su `title` y su 0.
      **Mapea:** R15, R16, R17, R18, R46, R47.

### F2 — Los cinco estados con icono

- [x] **F2.1 — `TableroDiaEstados.tsx`.**
      Esqueleto con `Loader2` (`motion-safe:animate-spin`, `aria-hidden`) dentro de la región
      `role="status" aria-busy="true"`; vacío del tablero con `EmptyState icon={CalendarDays}`
      dentro del `Card` que conserva `data-slot="tablero-dia-vacio"`; aviso de refresco con
      `TriangleAlert` como **primer hijo** del `Alert`.
      **+ NUEVO** vacío de filtro (`data-slot="tablero-dia-sin-coincidencias"`,
      `EmptyState icon={Search}`, acción «Quitar el filtro»).
      **Hecho:** los textos existentes se conservan literales.

- [x] **F2.2 — Iconos en los dos `Alert` de `TableroDiaModule.tsx`.** `[P]` con F2.1.
      Denegado → `Lock` (o el fallback de F1.3), `variant="destructive"`; tarjeta desaparecida →
      `Info` en el `Alert` por defecto. Ambos como primer hijo.

- [x] **F2.3 — `tests/components/TableroDiaEstados.test.tsx` (nuevo).**
      Cada uno de los cinco estados pinta **un** `<svg>`; los cinco iconos son distintos entre sí;
      en el `Alert` el `<svg>` es el primer hijo; con los `<svg>` suprimidos el mensaje sigue
      siendo legible; el esqueleto conserva `role="status"` + `aria-busy`.
      **Mapea:** R24, R25, R26, R27, R28, R29, R30.

### F3 — El detalle en `Modal`

- [x] **F3.1 — `DetalleMensajeroPanel.tsx`: `Sheet` → `Modal` + `DataTable` + `Pagination`.**
      Conserva el **nombre del archivo**. `hideConfirm`, `cancelLabel="Cerrar"`, `size="xl"`.
      `data-slot="detalle-mensajero-panel"` en un `div` dentro de `children`. Avatar de iniciales
      en la cabecera (R71). Con cero órdenes: `data-slot="detalle-mensajero-vacio"` + `EmptyState`
      y **ninguna tabla**. Con filas: `DataTable` de cuatro columnas (sin `renderExpanded`, sin
      `descarga`, sin `filtros`) + `Pagination sticky={false}`.
      **El `pageSize` sale del detalle que devuelve el servidor** (que ya lo toma de
      `ordenesConfig.DEFAULT_PAGE_SIZE` = 25): **ni un literal numérico** (R75).
      Sigue importando `EstatusBadge`; el archivo **no** puede contener `badgeVariants`,
      `bg-success-soft`, `bg-danger-soft` ni `ORDER_STATUS_LABELS =`.

- [x] **F3.2 — Actualizar `tests/components/DetalleMensajeroPanel.test.tsx`.**
      Se **conservan**: apertura con ratón y teclado, `?mensajero=` en la URL, cierre con Escape
      que limpia el parámetro sin re-consultar, las cuatro columnas, la comparación de clases con
      `EstatusBadge`, el «—» del resultado vacío, los tres casos malos con el mismo texto y sin
      tabla, el censo de fuente, y el cierre con aviso cuando la tarjeta desaparece.
      Se **añaden**: `aria-modal` en el contenedor; el título es el nombre del mensajero (o el
      genérico); **no** hay botón «Confirmar»; hay salida visible «Cerrar»; el
      `data-slot="detalle-mensajero-panel"` desaparece del DOM al cerrar; y el `pageSize` que se
      pinta es el que vino del servidor.
      **Mapea:** R31, R32, R33, R34, R35, R36, R37, R38, R62, R75.

### F4 — Filtro, densidad y totales filtrados

- [x] **F4.1 — `filtrar-mensajeros.ts` (nuevo).** `[P]`
      `normalizarNombre(t)` (minúsculas + supresión de acentos), `filtrarFilas(filas, consulta)` e
      `iniciales(nombre)` para el avatar (R71). Puras, sin DOM, sin React.

- [x] **F4.2 — `TableroDiaControles.tsx` (nuevo).**
      `Input` con icono `Search` y `aria-label` («Filtrar por nombre de mensajero»), botón de
      limpiar cuando hay texto, y `SegmentedToggle` con `ariaLabel="Densidad del tablero"`,
      opciones cómoda/compacta, **cómoda por defecto**.

- [x] **F4.3 — Cablear en `TableroDiaModule.tsx`, `TableroDiaRejilla.tsx` y `MensajeroCard.tsx`.**
      El módulo es dueño del estado; el filtro se aplica **después** de `ordenarFilasTablero`; la
      densidad sólo cambia `gap`/columnas y la forma de los `Badge`. Avatar de iniciales en la
      tarjeta, `aria-hidden`, con el nombre completo intacto como texto.
      **⛔ El filtro NO toca la URL** (R73). **⛔ Ni el filtro ni la densidad cambian el orden ni
      provocan consultas.**

- [x] **F4.4 — Totales recalculados sobre lo filtrado, en `TableroDiaTotales.tsx`.**
      Con filtro activo: los totales salen de `sumarTotalesTablero(filasVisibles)` (la MISMA
      función que usa el servicio, B2.1c), el rótulo pasa a «Totales de lo filtrado», aparece el
      subtítulo «N de M mensajeros» y el bloque gana **`data-filtrado=""`**. Sin filtro: todo
      exactamente como hoy, sin el atributo.
      El conteo de coincidencias va en una región `role="status" aria-live="polite"`.
      **⛔ No se escribe una segunda suma** (R65).

- [x] **F4.5 — `tests/components/TableroDiaFiltro.test.tsx` (nuevo).**
      Filtro sin acentos y sin distinguir mayúsculas; filtrar no llama a `leerTableroDia` otra vez;
      **filtrar no cambia la URL**; el orden de las restantes no cambia; sin coincidencias sale el
      vacío propio con su CTA; con filtro los totales **son los de las visibles**, el bloque lleva
      `data-filtrado` y el rótulo cambia; **sin** filtro no lleva el atributo; la identidad de los
      ocho sumandos se cumple sobre los totales filtrados; la densidad no cambia cifras, ni orden,
      ni qué tarjetas se ven, y el nombre accesible de un contador sigue diciendo su etiqueta.
      **Mapea:** R39, R40, R41, R42, R43, R44, R45, R64, R65, R73.

### F5 — La barra apilada de composición

- [x] **F5.1 — `COLOR_SEGMENTO` en `contadores.ts`.**
      Mapa exhaustivo clavado por clave de contador (misma regla que F1.1), con
      `bg-success` / `bg-warning` / `bg-chart-6` / `bg-danger` / `bg-chart-11` / `bg-chart-12` /
      `bg-info` / `bg-muted-foreground/40`.
      **⛔ Ni un hex, ni una utilidad de paleta cruda.**

- [x] **F5.2 — `ComposicionBarra.tsx` (nuevo).**
      Pista `bg-muted`; un `<div>` por contador con valor > 0, ancho en `%` por `style` (Tailwind
      no compila clases dinámicas), `title` con etiqueta y cifra; la barra entera es
      `role="img"` con un `aria-label` que enumera los ocho valores.
      **⛔ Un contador a 0 no pinta segmento** (R69).
      Recibe los conteos por props: la monta `ContadoresTablero` (tarjeta) y `TableroDiaTotales`
      (tira), con el mismo dato que los ocho `Badge`.

- [x] **F5.3 — `tests/components/TableroDiaComposicion.test.tsx` (nuevo).**
      Hay barra en la tira y en cada tarjeta; los anchos suman 100 %; un contador a 0 no produce
      segmento; cada segmento usa exactamente la clase de `COLOR_SEGMENTO` para su clave; el
      `aria-label` enumera los ocho valores; y **cada cifra y etiqueta siguen legibles fuera de la
      barra** (los `Badge` de F1.2), de modo que el color no es el único portador.
      **Mapea:** R66, R67, R68, R69, R70.

### F6 — La línea de entregas acumuladas (se REUSA `GraficaLineas`)

- [x] **F6.1 — `serie-ritmo.ts` (nuevo).**
      `serieDeRitmo(puntos): readonly SerieDato[]`. Devuelve `[]` si el día no registra entregas
      (así el marco muestra su propio vacío, R59); si no, UNA serie con un `PuntoDato` por hora,
      `categoria` = la hora ya formateada («7 a. m.») y `valor` = el acumulado (**nunca `null`**:
      `null` significa dato ausente en el paquete).
      Tipos importados desde `@/components/private/analytics/tipos`, que re-exporta `MetricaUnidad`
      — así el árbol de la feature no escribe ni una ruta `lib/analytics/`.
      **Hecho:** F6.3 en verde.

- [x] **F6.2 — Montar `GraficaLineas` en `TableroDiaTotales.tsx`.**
      `titulo="Entregas acumuladas"` (visible, es el nombre accesible obligatorio),
      `unidad="conteo"`, `proporcion="bajo"` (32:9), `vacio={{ titulo, descripcion }}`.
      **⛔ NO se importa `recharts`. ⛔ NO se importa nada de `…/analytics/lienzo/`. ⛔ NO se toca
      `tests/unit/components/analytics-paquete-guard.test.ts`** (R74, R78).
      **⛔ La cifra titular NO usa `KpiValorAnimado`** (design §4).
      **Hecho:** el chunk de recharts no aparece en la carga inicial (se confirma con el censo de
      F7.1, no a ojo).

- [x] **F6.3 — Tests de la línea.**
      `tests/unit/components/serie-ritmo.test.ts` (nuevo, puro): serie vacía cuando no hay
      entregas; un punto por hora en orden; ningún `valor` es `null`; con 24 puntos
      `prepararSeries` **no recorta** (`MAX_PUNTOS_SERIE = 62`).
      `tests/components/TableroDiaRitmo.test.tsx` (nuevo): se monta `GraficaLineas` (el `<h3>` con
      el título está presente); la alternativa textual de `SerieTextual` tiene una entrada por
      punto; sin entregas se pinta el `EmptyState` del marco y **no** la lista de puntos.
      **⚠ No se consultan nodos del SVG:** en jsdom `ResponsiveContainer` renderiza vacío, y
      afirmar sobre `<path>`/`<circle>` sería un test que no mide nada. Se afirma sobre el título
      y sobre `SerieTextual`, que es lo que existe siempre.
      **Mapea:** R49, R59, R60, R76, R77.

### F7 — Cierre del bloque frontend

- [x] **F7.1 — Guardia nueva de primitivas.**
      `tests/unit/tablero-dia/primitivas.guardia.test.ts` (nuevo), censando **el árbol** con
      `arbolDeLaFeature()`:
      - ningún archivo del árbol escribe `from "recharts"` ni importa `…/analytics/lienzo/`;
      - ningún archivo del árbol nombra `badgeVariants`;
      - ningún archivo del árbol escribe un hex ni una utilidad de paleta cruda;
      - ningún archivo del árbol escribe un literal numérico de tamaño de página (R75);
      - `components/ui/` y `components/shared/` no ganaron archivos (inventario congelado);
      - `ContadoresTablero.tsx` importa `Badge`; `TableroDiaEstados.tsx` importa `EmptyState`;
        `DetalleMensajeroPanel.tsx` importa `Modal`, `DataTable` y `Pagination`;
        `TableroDiaControles.tsx` importa `Input` y `SegmentedToggle`;
        `TableroDiaTotales.tsx` importa `GraficaLineas`;
      - **cada detector se prueba contra código REAL que SÍ infringe** — una guardia que no puede
        fallar es decorado.
      **Mapea:** R18, R19, R20, R21, R22, R23, R46, R67, R74, R75, R78.

- [x] **F7.2 — Verificar que `app/(app)/monitoreo/page.tsx` no cambió.**
      `tests/components/TableroDiaPage.test.tsx` debe pasar **sin tocarlo**. Si no pasa, hay un
      cambio de alcance no pedido.
      **Mapea:** R14, R63.

- [x] **F7.3 — Revisión visual en los DOS temas.**
      Levantar la app, entrar a `/monitoreo` como `maestro` y como `adminSatelite`, y mirar los
      cinco estados, la barra, la línea y el modal en claro y en oscuro.
      **Foco concreto (design §11.6):** que el segmento `bg-info` de «En reparto» **se separe de la
      pista en tema oscuro**. Si no, la salida es `bg-chart-13` (que gira), nunca un hex nuevo.
      **⚠ No medir contraste con la herramienta del navegador** (memoria del repo: `lab()` mal
      parseado, transiciones a medio interpolar, CSS rancio del dev server). Aquí se comprueba que
      no hay texto ilegible, que no asoma una franja del tema contrario y que la línea gira.
      **Hecho:** anotado en `progress/impl_258_frontend.md` con qué se miró y en qué rol.
      **Mapea:** R47, R48, R49.

- [x] **F7.4 — Gate completo.** `./init.sh` (**completo**) lo corre el leader, **secuencialmente**,
      sin ningún subagente mutando el árbol a la vez.
      **Hecho:** verde, con `INIT_EXIT=$?` dentro del log.

---

## Mapa `R<n> → test`

El reviewer exige que ninguna fila quede vacía.

| R | Test |
| --- | --- |
| R1 | `frontera.guardia.test.ts` (árbol intacto) + `tablero-dia-conteo.test.ts` (sigue verde) |
| R2 | ausencia de `db/migrations/**` y `db/schema.prisma` en el diff (verificado por el gate) |
| R3 | `TableroDiaTarjetas.test.tsx` › «Totales» + `sumar-totales.test.ts` + `tablero-dia-conteo.test.ts` |
| R4 | `TableroDiaTarjetas.test.tsx` › «los tres buckets van SEPARADOS» |
| R5 | `TableroDiaTarjetas.test.tsx` › «'Otros' se pinta aunque valga 0» |
| R6 | `TableroDiaTarjetas.test.tsx` › «orden determinista» + `TableroDiaFiltro.test.tsx` › «el orden no cambia» |
| R7 | `DetalleMensajeroPanel.test.tsx` › «escribe `?mensajero=`» |
| R8 | `TableroDiaModule.test.tsx` › «a los 30 s hay una segunda consulta» |
| R9 | `TableroDiaModule.test.tsx` › «un refresco que falla NO vacía el tablero» |
| R10 | `TableroDiaModule.test.tsx` › «la antigüedad se mide contra `generadoAt`» |
| R11 | `TableroDiaModule.test.tsx` › «el detalle no se pide hasta que se abre una tarjeta» |
| R12 | `frontera.guardia.test.ts` › «agregada o paginada» + `tablero-dia-detalle-sql.test.ts` |
| R13 | `DetalleMensajeroPanel.test.tsx` › «los TRES casos malos dan el MISMO aviso» |
| R14 | `frontera.guardia.test.ts` › «ninguna capa lee el rol» + `TableroDiaPage.test.tsx` |
| R15 | `TableroDiaTarjetas.test.tsx` › «los ocho contadores son Badge» |
| R16 | `TableroDiaTarjetas.test.tsx` › «cada contador tiene variante» + typecheck del `satisfies` |
| R17 | `primitivas.guardia.test.ts` › «el mapa se clava por clave de contador» |
| R18 | `frontera.guardia.test.ts` › cláusula (f) + `primitivas.guardia.test.ts` |
| R19 | `frontera.guardia.test.ts` › cláusula (f) |
| R20 | `primitivas.guardia.test.ts` › cláusula (h): «ninguna primitiva conoce el dominio del tablero del día» + «las primitivas que esta pantalla monta EXISTEN todas (no se inventó ninguna)». **No es un inventario congelado, y es deliberado**: una lista de nombres con `toEqual` convertiría esta guardia en un peaje para cualquier ficha futura que estrene una primitiva legítima, y la salida barata sería borrarla. Lo que R20 protege de verdad —que esta pantalla no se haya fabricado una primitiva a medida— sí es comprobable de forma duradera. El porqué está escrito dentro de la cláusula |
| R21 | `primitivas.guardia.test.ts` + `TableroDiaEstados.test.tsx` › vacío con icono |
| R22 | `primitivas.guardia.test.ts` + `TableroDiaEstados.test.tsx` › `role="alert"` |
| R23 | `primitivas.guardia.test.ts` + `DetalleMensajeroPanel.test.tsx` |
| R24 | `TableroDiaEstados.test.tsx` › «cada estado pinta un svg» |
| R25 | `TableroDiaEstados.test.tsx` › «los cinco iconos son distintos» |
| R26 | `TableroDiaEstados.test.tsx` › «el icono del vacío va por la prop `icon`» |
| R27 | `TableroDiaEstados.test.tsx` › «el svg es el primer hijo del Alert» |
| R28 | `TableroDiaTarjetas.test.tsx` › «el skeleton se anuncia como carga» |
| R29 | `TableroDiaEstados.test.tsx` › «el mensaje se lee con los svg suprimidos» |
| R30 | `TableroDiaModule.test.tsx` › los `data-slot` de cada estado |
| R31 | `DetalleMensajeroPanel.test.tsx` › «abre un diálogo con `aria-modal`» |
| R32 | `DetalleMensajeroPanel.test.tsx` › «cerrar limpia el parámetro» |
| R33 | `DetalleMensajeroPanel.test.tsx` › «NO desmonta el tablero» |
| R34 | `DetalleMensajeroPanel.test.tsx` › «no hay botón Confirmar» |
| R35 | `DetalleMensajeroPanel.test.tsx` › «CUATRO columnas y ninguna más» |
| R36 | `DetalleMensajeroPanel.test.tsx` › «un caso vacío pintó una tabla» |
| R37 | `DetalleMensajeroPanel.test.tsx` › «el chip es EL del listado» |
| R38 | `DetalleMensajeroPanel.test.tsx` › «si la tarjeta desaparece, se cierra CON aviso» |
| R39 | `TableroDiaFiltro.test.tsx` › «el filtro es un Input con nombre accesible» |
| R40 | `TableroDiaFiltro.test.tsx` › «filtrar no consulta al servidor» |
| R41 | `TableroDiaFiltro.test.tsx` › «encuentra 'Jiménez' escribiendo 'jimenez'» |
| R42 | `TableroDiaFiltro.test.tsx` › «sin coincidencias sale el vacío propio» |
| R43 | `TableroDiaFiltro.test.tsx` › «con filtro, los totales son los de las visibles» |
| R44 | `TableroDiaFiltro.test.tsx` › «el conmutador arranca en cómoda» |
| R45 | `TableroDiaFiltro.test.tsx` › «la densidad no cambia cifras, orden ni tarjetas» |
| R46 | `primitivas.guardia.test.ts` › «ni un hex ni una utilidad de paleta cruda» |
| R47 | `TableroDiaTarjetas.test.tsx` › «la variante es la del mapa» + F7.3 |
| R48 | `primitivas.guardia.test.ts` › cláusula (d): «R47/R48: el par `-soft`/`-strong` lo pone `Badge`, no el árbol» + `TableroDiaComposicion.test.tsx` › «En reparto» se separa de la pista en los DOS temas» (con su caso de no-vacuidad: `bg-info` SÍ falla en oscuro). **No se censa «ningún token fijo del `@theme` en el árbol»**, y es deliberado: `bg-success`/`bg-warning`/`bg-danger` son tokens fijos y son el rol CORRECTO para una barra según `DESIGN.md` («base = borde, acento y punto de estado (dot, icono, barra)»). Prohibirlos de plano habría prohibido el diseño aprobado. Lo que sí se censa es la forma que de verdad rompe el tema oscuro: armar a mano el par `-soft`/`-strong` sin su compensación `dark:` |
| R49 | `TableroDiaRitmo.test.tsx` › «el color lo pone la paleta del paquete» (censo: la feature no pasa color) |
| R50 | `tablero-dia-ritmo.test.ts` (servicio) › «devuelve la serie» |
| R51 | `tests/integration/tablero-dia-ritmo.test.ts` › escenarios 2 y 3 |
| R52 | `tests/integration/tablero-dia-ritmo.test.ts` › escenario 1 + `tablero-dia-ritmo.test.ts` (servicio) |
| R53 | `tablero-dia-ritmo-sql.test.ts` › «sin `AT TIME ZONE`» + `frontera.guardia.test.ts` › cláusula (a) |
| R54 | `tablero-dia-ritmo.test.ts` (servicio) › «sin huecos y monótona» |
| R55 | `tablero-dia-ritmo-sql.test.ts` › «el `zonaId` viaja como parámetro» + `frontera.guardia.test.ts` › «`resolverAlcance` en un solo archivo» |
| R56 | `tablero-dia-ritmo.test.ts` (servicio) › «un denegado no llama al repositorio» |
| R57 | `tablero-dia-ritmo.test.ts` (servicio) › «un solo `generadoAt`» y «un acierto de caché no reproduce» |
| R58 | `tablero-dia-ritmo-sql.test.ts` + `frontera.guardia.test.ts` › cláusula (d) actualizada |
| R59 | `TableroDiaRitmo.test.tsx` › «sin entregas se pinta el vacío del marco» + `serie-ritmo.test.ts` › «devuelve `[]`» |
| R60 | `TableroDiaRitmo.test.tsx` › «una entrada de `SerieTextual` por punto» |
| R61 | Los tres tests de componente de la 192, que localizan cada ancla por su selector actual |
| R62 | `DetalleMensajeroPanel.test.tsx` › el `data-slot` aparece al abrir y desaparece al cerrar |
| R63 | `TableroDiaPage.test.tsx` › «la página NO fetchea datos» (pasa sin tocarlo) |
| R64 | `TableroDiaFiltro.test.tsx` › «con filtro: rótulo distinto, `data-filtrado` presente, N de M»; y sin filtro, ausente |
| R65 | `sumar-totales.test.ts` › «la identidad se cumple sobre cualquier subconjunto» + `primitivas.guardia.test.ts` › «una sola suma en el árbol» |
| R66 | `TableroDiaComposicion.test.tsx` › «hay barra en la tira y en cada tarjeta» |
| R67 | `TableroDiaComposicion.test.tsx` › «cada segmento usa la clase de `COLOR_SEGMENTO`» + `primitivas.guardia.test.ts` |
| R68 | `TableroDiaComposicion.test.tsx` › «`aria-label` enumera los ocho» + «cifra y etiqueta fuera de la barra» |
| R69 | `TableroDiaComposicion.test.tsx` › «un contador a 0 no pinta segmento» |
| R70 | `TableroDiaComposicion.test.tsx` › «los anchos suman 100 %» |
| R71 | `TableroDiaTarjetas.test.tsx` › «avatar `aria-hidden` y nombre completo presente» + `filtrar-mensajeros.test.ts` › `iniciales` |
| R72 | `tests/integration/tablero-dia-ritmo.test.ts` › escenario 3, nombrado como comportamiento esperado |
| R73 | `TableroDiaFiltro.test.tsx` › «filtrar no cambia la URL» |
| R74 | `primitivas.guardia.test.ts` › «ningún archivo del árbol escribe `from "recharts"`» + `analytics-paquete-guard.test.ts` intacto (sin diff) |
| R75 | `primitivas.guardia.test.ts` › «ningún literal de tamaño de página» + `DetalleMensajeroPanel.test.tsx` |
| R76 | `TableroDiaRitmo.test.tsx` › «se monta `GraficaLineas`» + `primitivas.guardia.test.ts` › «`TableroDiaTotales` la importa» |
| R77 | `tests/unit/components/serie-ritmo.test.ts` (puro, incluye «24 puntos no se recortan») |
| R78 | `primitivas.guardia.test.ts` › «sin import de `…/analytics/lienzo/`» + `analytics-paquete-guard.test.ts` › «los componentes de gráfica se montan por importación diferida» |

---

## Riesgos a vigilar durante la implementación

- **La guardia de la tercera consulta (B3.3).** Si se pone roja, la salida es actualizar el número
  y la clasificación exactos, nunca aflojar el matcher.
- **`GraficaLineas` en jsdom no dibuja nada.** No escribas aserciones sobre nodos del SVG: se
  afirma sobre el título y sobre `SerieTextual`.
- **`pnpm typecheck` rojo con errores en `.next/dev/**`.** Es el cliente/tipos rancios, no tu
  cambio: `rm -rf .next/dev` y reiniciar el dev server.
- **Gate y mutaciones no van en paralelo.** El leader no lanza el gate mientras un subagente
  escribe: el veredicto no valdría.
- **Un test de integración verde sin datos no prueba nada.** B5.1 lleva su mutación de control.
