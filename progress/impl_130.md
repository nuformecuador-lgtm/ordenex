# impl 130 — analítica: componentes de gráficas

Rama: `feature/130-analitica-componentes-graficas` (worktree aislado).
Base: `3491e50c` (merge de `origin/dev` en la rama de la feature).
Spec: `specs/130-analitica-componentes-graficas/` — 41 requisitos, puerta F1.4 cerrada.

---

## 1. Qué se entregó

Paquete de presentación pura en `components/private/analytics/`, **sin barril** a propósito
(§4.2 del design: un `index.ts` arrastraría `recharts` a cualquier consumidor):

| Archivo | Qué es |
|---|---|
| `tipos.ts` | contrato de props. `MetricaUnidad` **importada** de la 135 con `import type` (R3) |
| `paleta.ts` | color de serie → token `--chart-N`. Puro, determinista, inyectivo (R16–R19) |
| `topes.ts` | `MAX_SERIES=5`, `MAX_PUNTOS_SERIE=62`, los dos errores con nombre y los recortes (R30–R33) |
| `formato.ts` | `formatearValor(valor, unidad)` y `totalizar(valores)`. Puros (R20, R21, R23) |
| `SerieTextual.tsx` | alternativa textual: una entrada por punto (R10, R11) + aviso de recorte |
| `GraficaMarco.tsx` | precedencia error > carga > vacío > datos (R5–R8), nombre accesible (R9) |
| `KpiCard.tsx` | cifra + etiqueta + variación con signo en texto (R12–R15) |
| `GraficaBarras/Lineas/Donut.tsx` | estados + textual + lienzo **diferido** (R27) |
| `TablaResumen.tsx` | envoltorio fino sobre `DataTable` (R22, R23, R38) |
| `lienzo/{Barras,Lineas,Donut}Lienzo.tsx` | los **únicos** archivos que importan `recharts` (R26) |
| `lienzo/{filas,tipos-lienzo}.ts` | adaptador de forma y props del lienzo. Sin recharts |

Fuera del paquete se modificó **un solo archivo de producción**, tal como anunciaba el design:
`components/shared/KpiValorAnimado.tsx` (Q5, R35–R37).

### Dos decisiones que el spec no fijaba y que aquí quedan escritas

1. **La unidad `porcentaje` llega como FRACCIÓN (0,842 = 84,2 %), no en puntos.** El spec no lo
   decidía. Se eligió la fracción por coherencia con el catálogo de la 135, que define esas
   métricas como una razón numerador/denominador (`DefinicionMetrica.razon`), y con `Intl`, que
   multiplica por 100 en `style: "percent"`. **→ dueño de la 131:** pasa la razón cruda, no la
   pre-multipliques.
2. **En el donut el techo de segmentos es `MAX_SERIES` (5), no `MAX_PUNTOS_SERIE` (62).** En un
   donut el color distingue segmentos, no series: aplicarle 62 daría un donut de 62 porciones con
   cinco colores repetidos, exactamente lo que Q3 descartó. Un donut con más de cinco categorías
   lanza `SeriesExcedidasError` fuera de producción, como el resto del paquete.

---

## 2. Avisos que NO se tapan

**H1 — la 130 se mergea SIN LLAMADOR en producción.** El grafo es `AnaliticaShell` (existe) ←
`131` (no existe) ← `130` (esta feature). No hay ni un `import` de estos componentes en producción
hasta que aterrice la 131; el propio shell lo dice en su comentario. Es aceptable y está escrito;
lo inaceptable sería venderlo como "ya integrado". **Se comprobó midiendo:** en un `next build` sin
sonda, `recharts` aparece en **0** chunks de cliente, precisamente porque nadie lo importa (§4).

**H2 — el mensajero SÍ entra a `/analitica`.** `ROLES_ANALITICA` lo incluye. Así que "recharts no
le llega al móvil del mensajero" es **falso** si entra a la pantalla. Lo que R26/R27 garantizan, y
está medido, es que no le llegue en `/mis-asignaciones` ni en el resto de la app, y que dentro de
`/analitica` llegue **diferido**, en un chunk aparte que no está en el First Load.

**H3 — la limitación de moneda en cliente es PREEXISTENTE y fuera de alcance.** `loadMonedaConfig`
lee `process.env[name]` con clave **dinámica** y Next sólo inlinea `NEXT_PUBLIC_*` con acceso
estático, así que en el navegador la configuración cae al *default* `es-CR`/`CRC`. **Esto no lo
estrena la 130:** `formatMonto`/`loadMonedaConfig` tienen 13 consumidores de producción y **cinco ya
son `"use client"`** — `EtiquetaGuia`, `ChatConversacion`, `PosOrderCardDetalle`,
`PosOrderCardMosaico`, `SateliteOrderCard`. `KpiValorAnimado` es el **sexto**, no el primero: el
arreglo lo **alinea** con sus vecinos y consigue lo que pedía `docs/architecture.md` (que el símbolo
salga de un módulo de configuración y no del componente).
**Recomendación al humano, no se abre ficha desde aquí:** si la moneda debe poder cambiarse por
despliegue **en cliente**, es una ficha propia sobre `lib/config/moneda.ts` — variable
`NEXT_PUBLIC_`, o pasar el valor ya formateado desde el servidor — con **seis** consumidores cliente
a revisar, no uno.

---

## 3. Evidencia FUERA de vitest (R27, R36, R41)

### 3.1 R41 — comprobación de mutación de la única aserción sobre el lienzo (T4.5)

El stub global de `ResizeObserver` (`tests/setup/jest-dom.ts`) tiene `observe(){}` **vacío**, así
que `ResponsiveContainer` **no lanza: renderiza vacío**. Un `querySelector("svg")` pasaría siempre,
monte el componente su lienzo o no. Por eso la única aserción sobre el lienzo se probó rompiéndola.

- **Test:** `tests/components/AnalyticsGraficas.test.tsx` › «montaje del lienzo (R41, unica asercion
  sobre el lienzo)» › «GraficaBarras intenta montar su lienzo cuando hay datos».
- **Mutación:** se retiró el bloque `<Suspense><BarrasLienzo …/></Suspense>` de
  `components/private/analytics/GraficaBarras.tsx`.
- **Salida real con la mutación aplicada:**

```
     × GraficaBarras intenta montar su lienzo cuando hay datos 1065ms
 FAIL  tests/components/AnalyticsGraficas.test.tsx > montaje del lienzo (R41, unica asercion sobre el lienzo) > GraficaBarras intenta montar su lienzo cuando hay datos
 Test Files  1 failed (1)
      Tests  1 failed | 26 passed (27)
```

- **Tras restaurar:** `Test Files 1 passed (1)` · `Tests 27 passed (27)`.

**Además, el guard de T5.1 se probó igual, introduciendo cada violación a mano:**

```
# import de @/lib/analytics/metrics + import de recharts en KpiCard.tsx
     × toma la unidad de lib/analytics/types con import type y no importa el catalogo metrics
     × recharts solo se importa desde el paquete de analitica
      Tests  2 failed | 11 passed (13)

# lazy(() => import(...)) sustituido por import estatico en GraficaLineas.tsx
     × los componentes de grafica se montan por importacion diferida
      Tests  1 failed | 12 passed (13)
```

Y el guard de R35 (`tests/components/KpiValorAnimado.test.tsx`), reintroduciendo `` `₡ ${n}` ``:

```
     × el valor en moneda usa lib/config/moneda y el archivo no tiene simbolo literal 33ms
      Tests  1 failed | 4 passed (5)
```

### 3.2 R27 — coste de `recharts` medido sobre `next build`

**Nota metodológica obligada, porque cambia cómo se lee la cifra.** `pnpm build` encadena
`migrate-deploy` contra una base real y no se usó; se midió con `pnpm exec next build --webpack`.
El *turbopack* por defecto **no compila en este worktree** por MAX_PATH de Windows (§5), y el build
de webpack falla en el typecheck de tipos generados de rutas `.next/types/**` — un fallo
**preexistente y ajeno a esta feature** (ningún gate del repo corre el build). Para poder medir se
puso `typescript: { ignoreBuildErrors: true }` **temporalmente** en `next.config.ts` y se revirtió
después: el archivo está sin cambios en el diff final.

Next 16 ya **no imprime** las columnas de tamaño/First Load JS en la tabla de rutas, así que la
medición se hace sobre los chunks reales de `.next/static/chunks` (script de medición en el
scratchpad, fuera del repo).

**(a) Línea base — commit `3491e50c`, ANTES de instalar recharts:**

```
ARCHIVOS 111 TOTAL_BYTES 4515613
331	app/(app)/analitica/page-7b3abfc9a0003c9c.js
85915	app/(app)/mis-asignaciones/page-114b91d561c7c9dc.js
CHUNKS_CON_RECHARTS 0
```

**(b) DESPUÉS, con la feature completa y sin ningún consumidor (estado real de merge, H1):**

```
ARCHIVOS 111 TOTAL_BYTES 4516301
334	app/(app)/analitica/page-81706c0541e2559c.js
86252	app/(app)/mis-asignaciones/page-79e8503070af00b1.js
CHUNKS_CON_RECHARTS 0
```

`recharts` está en **0** chunks: nadie importa el paquete todavía (H1). Los +337 bytes de
`/mis-asignaciones` **no son recharts**: son el `import { formatMonto }` del arreglo de
`KpiValorAnimado` (T7). Es la cifra honesta, pero por sí sola no demuestra que el diferido funcione,
así que se midió también el caso que sí lo demuestra.

**(c) Con una SONDA temporal (`app/(app)/sonda130/page.tsx` importando `GraficaBarras`), borrada
tras medir y nunca commiteada:**

```
ARCHIVOS 115 TOTAL_BYTES 4941708
335	app/(app)/analitica/page-04bfc096ebb2f8bd.js
86265	app/(app)/mis-asignaciones/page-2f8eb7b653ff3ef6.js
CHUNKS_CON_RECHARTS 1
  recharts@ 388810	6301.ffd8fae062d0dc76.js

entries de ruta: 46
entries que contienen recharts: 0
sonda entry bytes: 4767
sonda entry referencia el chunk 6301? true
```

**Lo que esto afirma, y se puede releer dentro de un año:**

1. `recharts` pesa **388.810 bytes (~380 KB) sin comprimir** y viaja en **un chunk propio**,
   `6301.*.js`. Es la cifra que faltaba en el design (§4.1) y la contrapartida de D1, dicha con
   número.
2. **Ninguno de los 46 chunks de entrada de ruta contiene recharts** — ni el de la ruta que sí lo
   usa. El entry de la sonda pesa 4.767 bytes y sólo **referencia** el chunk 6301, que es
   exactamente lo que hace `lazy(() => import(…))`: sale del First Load y llega después.
3. **El First Load JS de `/mis-asignaciones` no cambia por recharts.** Su entry pasa de 85.915 a
   86.252 bytes y la diferencia está identificada (el `formatMonto` de T7), no atribuida a la
   librería. Con sonda o sin ella, `/mis-asignaciones` sigue sin ver recharts.

Sin umbral numérico a propósito (design §4.3): lo que se exige es que la cifra quede **escrita**,
para que el siguiente que la empeore tenga contra qué compararse.

### 3.3 R36 — delta de la suite completa por el cambio del compartido (T7.2 / T7.3)

Se comparan **archivos** y **tests**, no sólo "verde": una corrida con *unhandled errors* de workers
omite archivos enteros y parece casi verde.

| Momento | SHA | Test Files | Tests | Fallando |
|---|---|---|---|---|
| Base del worktree, antes de la feature | `3491e50c` | 665 | 8052 | 2 (ambos ambientales, §5) |
| **T7.2 — con la 130 entera, ANTES de tocar `KpiValorAnimado`** | `3f60a21b` | **674** | **8136** | **0** |
| **T7.3 — DESPUÉS del arreglo del compartido** | `a02a165b` | **674** | **8136** | 2 flakes (§6) |

De 665 a 674 archivos = **+9**, que son exactamente los 9 archivos de test de esta feature. De 8052
a 8136 = **+84** tests nuevos. **Ningún test ajeno cambió de estado.**

Y las tres redes que exigía el plan de no-regresión, en verde tras el cambio:

```
tests/components/MisAsignacionesPage.test.tsx
tests/components/CierresAdminModule.test.tsx
tests/components/KpiValorAnimado.test.tsx
 Test Files  3 passed (3)
      Tests  42 passed (42)
```

`MisAsignacionesPage` compara la subcadena `"350"`, que sigue siendo subcadena de «₡350,00» — por
eso el cambio de formato (I31) no rompe nada. **No se retocó ni un test ajeno**, que era la regla de
corte de Q5.

---

## 4. Hallazgos del entorno (no son defectos de la feature, pero condicionan cómo se verifica)

**E1 — el worktree está en una ruta demasiado larga para Windows (MAX_PATH).** El prefijo del
worktree son 143 caracteres; el `package.json` del cliente Prisma generado queda en **266**, por
encima del límite de 260. Node lee ese archivo con `fs` (usa rutas extendidas) pero su **resolvedor
de módulos no**, así que el paquete se comporta como si no declarase `imports` y sale
`ERR_PACKAGE_IMPORT_NOT_DEFINED` para `#main-entry-point`. Efecto: **303 de 665 archivos de test
fallaban al colectar** y la suite parecía "casi verde" con 4.059 tests en vez de 8.052 — el patrón
exacto de suite degradada.
**Cómo se resolvió:** `pnpm install --force --config.virtual-store-dir-max-length=30`, que acorta los
nombres del *virtual store*. Con eso la suite volvió a 665 archivos / 8.052 tests.
**Lo que NO se debe hacer:** mover el *virtual store* fuera del proyecto
(`--virtual-store-dir=C:/vs130`) rompe la resolución de TIPOS y aparecen ~1.800 errores falsos de
typecheck (`toBeInTheDocument does not exist`); se probó y se descartó.

**E2 — con el layout por defecto, `recharts` queda a medio extraer.** `react-redux/dist/cjs/**` y
`victory-vendor/d3-shape.js` no llegan a existir (mismo MAX_PATH), y el build falla con
`Can't resolve 'react-redux'`. Para la medición de §3.2 se instaló con
`--config.node-linker=hoisted`, que aplana `node_modules` y acorta las rutas. **Es una
particularidad de este worktree, no del repo:** `package.json` y `pnpm-lock.yaml` quedan íntegros y
en un checkout de ruta corta no aplica.

**E3 — el build no es un gate del repo y hoy no pasa limpio.** `next build` (webpack) falla en el
typecheck de `.next/types/app/api/cron/corte-diario/route.ts` por una incompatibilidad de los tipos
generados de route handlers, **anterior a esta feature**. Con turbopack ni siquiera compila en este
worktree (E1). Queda dicho porque significa que la frontera RSC **no está cubierta por ningún gate**
y esta feature no lo cambia.

**E4 — dos rojos ambientales en la base, que luego dejaron de aparecer.** En la primera medición de
la base fallaban `tests/unit/guards/no-embalaje.test.ts` (timeout: tarda 45 s contra los 20 s de
`testTimeout`, por lo lento del sistema de archivos en esta ruta) y
`tests/integration/recuperar-contrasena-form.test.tsx` (flake asíncrono). En las corridas
posteriores, ambos pasan. Son flakes por saturación, no regresiones.

---

## 4-bis. Ronda 2 — los tres bloqueantes del reviewer, cerrados con mutación (2026-08-01)

> **Nota de higiene del historial, porque el diff no lo dice solo.** El commit `07d8188b` lleva un
> mensaje centrado en B1/B2/B3, pero su diff arrastra **también** la enmienda **R33-bis** y el
> requisito **R20-bis** en `requirements.md`, los avisos 3 y 4 de `tasks.md > T0.1` y la corrección
> de **m5** (T8.3 desmarcada). Debería haber sido más de un commit
> (`docs/conventions.md`: un commit por task lógica) y no lo fue. Se deja escrito aquí en vez de
> reescribir la historia.



El reviewer **rechazó** la primera entrega. Los tres bloqueantes eran del mismo tipo y el
diagnóstico era correcto: **tests verdes que no medían el requisito**. Se reprodujeron uno a
uno antes de tocar nada, y se cierran con la mutación pegada.

### B1 (R13) — el símbolo de moneda se podía reintroducir sin que nada fallara

**Causa raíz, que es la parte interesante:** el test derivaba su esperado de `monedaConfig`, pero
**con la configuración por defecto (`es-CR`/`CRC`) `formatMonto(3500)` y un `₡` escrito a mano
producen el MISMO string byte a byte**. Ninguna aserción sobre la salida por defecto puede
separarlos. El test no era flojo: era **incapaz**.

```
# ANTES del arreglo — mutacion: return `₡${numero(valor, { minimumFractionDigits: 2 })}`
 Test Files  5 passed (5)
      Tests  42 passed (42)          <- verde con el simbolo hardcodeado

# DESPUES del arreglo — misma mutacion
     x con otra moneda configurada el valor NO lleva el simbolo del colon 11ms
     x ningun archivo del paquete escribe un simbolo de moneda, un codigo ISO ni un locale 7ms
 Test Files  2 failed | 1 passed (3)
      Tests  2 failed | 34 passed (36)
```

### B2 (R20) — el literal de idioma, igual

La cláusula «sin literal de idioma incrustado» de R20 **no la medía nada**. Es literalmente
el punto de `CHECKPOINTS.md`: «no se hardcodeó país, moneda ni cuenta».

```
# ANTES — mutacion: new Intl.NumberFormat("es-CR", opciones)
 Test Files  5 passed (5)
      Tests  42 passed (42)          <- verde con el locale hardcodeado

# DESPUES — misma mutacion
     x con otro locale configurado cambian los separadores del conteo 7ms
     x ningun archivo del paquete escribe un simbolo de moneda, un codigo ISO ni un locale 8ms
     x el formato de moneda y el locale salen de lib/config/moneda, no del paquete 2ms
 Test Files  2 failed (2)
      Tests  3 failed | 23 passed (26)
```

**Arreglo de B1+B2, por dos vías que se cubren entre sí:**

1. **Guard estático** en `analytics-paquete-guard.test.ts` › «ningun archivo del paquete escribe
   un simbolo de moneda, un codigo ISO ni un locale» — el mismo censo que ya protegía a
   `components/shared/KpiValorAnimado.tsx`, ahora sobre `components/private/analytics/**`. Cubre el
   futuro: cualquier símbolo, código ISO o `xx-XX` nuevo cae aquí aunque el string resultante
   coincida por casualidad con el correcto.
2. **Test de comportamiento con OTRA configuración**, en `analytics-formato.test.ts`: recarga el
   módulo con `MONEDA_CURRENCY=USD` / `MONEDA_LOCALE=en-US` (`vi.resetModules` + `vi.stubEnv` +
   import dinámico). Con eso los dos strings **dejan de ser idénticos** y la aserción de
   salida vuelve a medir el requisito en vez de la moneda de hoy.

### B3 (R33-bis) — el recorte del donut era código de seguridad sin un solo test

El más grave, y el reviewer tiene razón en que no era cosmético. `paleta.ts` lanza
`IndiceSerieFueraDeRangoError` para todo índice `>= MAX_SERIES` **en cualquier `NODE_ENV`,
producción incluida**, y `DonutLienzo` colorea por índice de segmento. Sin el recorte, **un donut
de 6+ categorías —`ordenes_por_estado` tiene 19— reventaría en el navegador también en
producción.**

```
# ANTES — mutacion: recorte sustituido por { items: serie.puntos, recortado: false, ... }
 Test Files  3 passed (3)
      Tests  37 passed (37)          <- ningun test se entera

# DESPUES — misma mutacion
       x con 6 categorias lanza SeriesExcedidasError fuera de produccion 6ms
       x en produccion recorta a 5 segmentos, no revienta, y anuncia el recorte por texto 16ms
 Test Files  1 failed (1)
      Tests  2 failed | 28 passed (30)
```

**Y la regla quedó ratificada, no improvisada.** El humano confirmó la desviación el
**2026-08-01**: el donut se queda con tope de **5** segmentos y conserva los **PRIMEROS**; barras y
líneas **no se tocan** (62 y los últimos). Está escrito como **R33-bis** en `requirements.md`,
con su porqué, y comunicado al dueño de la 131 en `tasks.md > T0.1`.

### Menores de la review, también atendidos

- **m5 — bookkeeping autocumplido, corregido.** T8.3 estaba marcada `[x]` afirmando que «los tres
  artefactos existen», y `progress/review_130.md` **no existía**. Vuelve a `[ ]`: no la cierra el
  implementer. Comprobado con `ls`, no de memoria.
- **(a) — la escala del `porcentaje` ya no vive sólo en el código.** Estaba en `formato.ts`, en
  esta bitácora y en el `status_note`, pero **no** donde la va a leer el spec_author de la 131.
  Ahora es **R20-bis** en `requirements.md`, está en la trazabilidad y es el punto 3 de
  `tasks.md > T0.1`.
- **m1 — R28 se cumple, pero apoyado en un DEFAULT de terceros, y ahora se dice.** El código de
  esta feature no emite ni una clase de animación, y eso sí se afirma. Pero **el lienzo SÍ
  anima** cuando la preferencia está apagada: que deje de hacerlo cuando está encendida lo
  resuelve `isAnimationActive: "auto"` → `usePrefersReducedMotion` de recharts, un default que
  **nadie fijó con prop** y con `package.json` en `^3.10.1` (rango abierto). **Riesgo residual
  declarado:** si recharts cambia ese default, el test seguiría verde y R28 se rompería sin
  avisar. El comentario del test decía «sencillamente no anima» y era inexacto; está corregido.
- **m2 — R25 es INVERIFICABLE aquí, y se marca como tal.** El texto del vacío es 100 % del
  llamador (prop `vacio`), así que el test afirma el texto que él mismo pasó. No es un test
  falso —comprueba que el texto del llamador llega y que **no** aparece el del shell— pero **no
  puede** comprobar que un llamador real escriba un texto adecuado. Eso sólo se verifica cuando
  exista la 131. Marcado «⚠ parcial» en la tabla, no «✅» a secas.
- **m4 — cómo reproducir la medición de R27 sin adivinar.** El script vive fuera del repo (es
  utilería de medición, no producto). Para repetirla: `pnpm exec next build --webpack` y luego
  recorrer `.next/static/chunks/**/*.js` sumando tamaños y buscando la cadena `recharts` en cada
  chunk; los entries de ruta son los de `.next/static/chunks/app/**`. **Vía más directa y
  preferible si alguien la rehace:** `.next/app-build-manifest.json` da los chunks **por ruta** sin
  inferir nada del contenido — no estaba disponible en la corrida de webpack de este árbol, por
  eso se midió por contenido. La conclusión no cambia: `0` de `46` entries de ruta contienen
  recharts.

---

## 5. Mapa `R<n> → test` (los 41)

| R | Test / evidencia | Estado |
|---|---|---|
| R1 | `tests/unit/components/analytics-paquete-guard.test.ts` › «expone los cinco componentes en components/private/analytics» | ✅ |
| R2 | idem › «ningun archivo del paquete hace fetch, usa server actions ni toca la base» | ✅ |
| R3 | idem › «toma la unidad de lib/analytics/types con import type y no importa el catalogo metrics» | ✅ |
| R4 | idem › «ningun componente lee window, document ni matchMedia» | ✅ |
| R5 | `tests/components/AnalyticsGraficas.test.tsx` › «%s con serie vacia muestra el estado vacio y no el lienzo» (`it.each`, 3 gráficas) | ✅ |
| R6 | idem › «%s mientras carga muestra skeleton y anuncia el estado una sola vez» | ✅ |
| R7 | idem › «%s con error muestra el mensaje en un role=alert y nada mas» | ✅ |
| R8 | idem › «%s con error y carga simultaneos gana el error» | ✅ |
| R9 | idem › «%s toma su nombre accesible del titulo recibido» | ✅ |
| R10 | idem › «publica una entrada de texto por punto de dato aunque el lienzo mida cero» + «con 400 puntos, en produccion, nunca emite mas de MAX_SERIES x MAX_PUNTOS_SERIE entradas» | ✅ |
| R11 | idem › «un punto nulo se muestra como dato ausente, no como cero» | ✅ |
| R12 | `tests/components/AnalyticsKpiCard.test.tsx` › «muestra etiqueta y valor formateado por unidad: %s» (`it.each`, 4 unidades) | ✅ |
| R13 | `analytics-paquete-guard.test.ts` › «ningun archivo del paquete escribe un simbolo de moneda, un codigo ISO ni un locale» + `analytics-formato.test.ts` › «con otra moneda configurada el valor NO lleva el simbolo del colon». **La aserción sobre la salida por defecto NO bastaba (B1)** | ✅ |
| R14 | idem › «un valor nulo muestra el marcador de dato ausente y no cero» | ✅ |
| R15 | idem › «la variacion dice su signo con texto, no solo con color» + «la variacion usa los tokens semanticos -strong, no la escala cruda» | ✅ |
| R16 | `tests/unit/components/analytics-paleta.test.ts` › «ningun archivo del paquete contiene un hex ni un color crudo de tailwind» | ✅ |
| R17 | idem › «el color de una serie es determinista para el mismo indice» | ✅ |
| R18 | idem › «los tokens declarados existen en app/globals.css, en :root y en .dark» | ✅ |
| R19 | idem › «los cinco indices del techo dan cinco tokens distintos: ninguna leyenda repite color» + «no cicla: un indice fuera del techo es un error, no el color de otra serie» | ✅ |
| R20 | `analytics-formato.test.ts` › «formatea conteo, porcentaje, moneda y segundos segun la unidad» + «con otro locale configurado cambian los separadores del conteo» + guard › «… ni un locale». **La cláusula «sin literal de idioma» la mide el guard, no la salida (B2)** | ✅ |
| R21 | idem › «formatea sin renderizar ningun componente» | ✅ |
| R22 | `tests/components/AnalyticsTablaResumen.test.tsx` › «se apoya en DataTable: hereda skeleton, vacio y error» + «no emite un table propio: usa el unico del repo, con su caption» | ✅ |
| R23 | idem › «la fila de totales se distingue de las filas de datos» + `analytics-formato.test.ts` › «totaliza en una funcion pura, ignorando los ausentes» | ✅ |
| R24 | `tests/components/AnalyticsEncajeShell.test.tsx` › «renderiza dentro de una section flex-col gap-4 sin fijar ancho ni alto en pixeles» + «acepta una clase adicional del llamador sin perder la suya» | ✅ |
| R25 | idem › «el vacio de la grafica habla del rango sin datos, no de una entrega posterior» | ⚠ **parcial** — el texto es 100 % del llamador, así que el test afirma lo que él mismo pasó. Comprueba que llega y que NO se repite el del shell; **no puede** comprobar que un llamador real escriba un texto adecuado. Se cierra con la 131 |
| R26 | `analytics-paquete-guard.test.ts` › «recharts solo se importa desde el paquete de analitica» (censa TODO el repo) | ✅ |
| R27 | **§3.2 (medición sobre `next build`)** + `analytics-paquete-guard.test.ts` › «los componentes de grafica se montan por importacion diferida» + «el paquete no tiene barril» | ✅ |
| R28 | `AnalyticsGraficas.test.tsx` › «%s con prefers-reduced-motion no aplica clases de animacion» + `AnalyticsKpiCard.test.tsx` › «no anima» | ⚠ **con dependencia externa** — nuestro código no anima (afirmado); el LIENZO lo resuelve un default de recharts (`isAnimationActive:"auto"`) que nadie fijó, con `^3.10.1`. Ver m1 en §4-bis |
| R29 | Gate `pnpm lint` (0 errores) + `analytics-paquete-guard.test.ts` › «ningun componente sincroniza estado con useEffect» | ✅ |
| R30 | `analytics-paleta.test.ts` › «MAX_SERIES vale 5 y coincide con el numero de tokens declarados» | ✅ |
| R31 | `tests/unit/components/analytics-topes.test.ts` › «con 6 series lanza SeriesExcedidasError fuera de produccion» + «en produccion conserva las 5 primeras en orden y no lanza» + `AnalyticsGraficas.test.tsx` › «con 8 series, en produccion, anuncia por texto cuantas muestra de cuantas» | ✅ |
| R32 | `analytics-topes.test.ts` › «MAX_PUNTOS_SERIE vale 62 y es mayor que 53 semanas y menor que 366 dias» | ✅ |
| R33 | idem › «con 63 puntos lanza PuntosExcedidosError fuera de produccion» + «en produccion conserva los 62 ultimos: lo reciente, no lo de enero» | ✅ |
| R33-bis | `AnalyticsGraficas.test.tsx` › «techo de SEGMENTOS del donut» › las dos ramas de `NODE_ENV` + «con 5 categorias exactas pinta las cinco y no anuncia recorte». **Enmienda ratificada por el humano el 2026-08-01**; mutación en §4-bis (B3) | ✅ |
| R20-bis | `analytics-formato.test.ts` › «formatea conteo, porcentaje, moneda y segundos segun la unidad» (0,842 → 84,2 %) | ✅ |
| R34 | `analytics-paquete-guard.test.ts` › «el paquete no agrupa en otros ni re-muestrea por semana o mes» | ✅ |
| R35 | `tests/components/KpiValorAnimado.test.tsx` › «el valor en moneda usa lib/config/moneda y el archivo no tiene simbolo literal» (con mutación probada, §3.1) | ✅ |
| R36 | **§3.3 (delta 0 de suite)** + `MisAsignacionesPage.test.tsx` y `CierresAdminModule.test.tsx` sin cambios y en verde | ✅ |
| R37 | `KpiValorAnimado.test.tsx` › «sin moneda muestra el entero…», «el valor en moneda…», «un valor nulo, indefinido o no numerico se muestra como cero y no rompe» | ✅ |
| R38 | `AnalyticsTablaResumen.test.tsx` › «formatea cada columna por su MetricaUnidad sin que el llamador pase formateadores» | ✅ |
| R39 | `analytics-paquete-guard.test.ts` › «no existe components/ui/chart y el paquete no lo importa» | ✅ |
| R40 | idem › «el paquete no importa next-themes ni escribe la clase dark» | ✅ |
| R41 | idem › «ningun test del paquete consulta nodos de recharts» + **§3.1 (mutación probada)** | ✅ |

**Los tres con evidencia fuera de vitest están señalados:** R27 → §3.2, R36 → §3.3, R41 → §3.1.

---

## 6. Cierre — `./init.sh` y suite completa

Medido en ESTE árbol, no heredado de ninguna bitácora.

### Cierre de la RONDA 2 (2026-08-01, tras arreglar los tres bloqueantes)

```
✓ node v22.13.1
✓ dependencias presentes
✓ typecheck paso
✓ lint paso
 Test Files  674 passed (674)
      Tests  8144 passed (8144)
✓ test paso
✓ todas las migraciones tienen down.sql
✓ .env presente
EXIT=0
```

- **674 archivos** — el mismo total que en la ronda 1, así que **no hay archivos omitidos** por
  *unhandled errors* de workers y el conteo es creíble.
- **8144 tests**, `+8` sobre los 8136 de la ronda 1: exactamente los ocho añadidos para cerrar los
  bloqueantes (3 de configuración de moneda/locale, 2 de guard estático, 3 del techo del donut).
- `typecheck` **0 errores**, `lint` **0 errores**.

Como en la ronda 1, la primera corrida trajo **un** rojo —`tests/integration/recuperar-contrasena-form.test.tsx`,
el mismo archivo que ya flakeó al medir la base— y pasó en aislado (`7 passed`); no menciona ni
`KpiValorAnimado` ni `private/analytics` (`grep -c` → 0). La segunda corrida, la de arriba, es verde
entera con el mismo total de archivos.

### Cierre de la RONDA 1 (antes de la review)

`./init.sh` corre `typecheck`, `lint` y `test` (`docs/verification.md`). Se corrió **dos veces**, y
se pegan las dos: la primera con 2 rojos y la segunda entera en verde, con **el mismo total de
archivos**. Esa es justamente la prueba de que los 2 rojos eran flakes por saturación y no
regresiones — y esconder la primera corrida sería el tipo de limpieza que oculta información.

**Corrida 2 — `EXIT=0`, todo verde:**

```
✓ node v22.13.1
✓ dependencias presentes
✓ typecheck paso
✓ lint paso
 Test Files  674 passed (674)
      Tests  8136 passed (8136)
✓ test paso
✓ todas las migraciones tienen down.sql
✓ .env presente
```

**Corrida 1 — salida real, con los 2 flakes:**

```
== Arnes SDD :: init ==
! jq no esta instalado (recomendado para validar feature_list.json)
✓ node v22.13.1
✓ dependencias presentes
-> pnpm run typecheck
> tsc --noEmit
✓ typecheck paso
-> pnpm run lint
> eslint
✓ lint paso
-> pnpm run test
> vitest run
...
 Test Files  2 failed | 672 passed (674)
      Tests  2 failed | 8134 passed (8136)
```

- **`typecheck`: 0 errores.**
- **`lint`: 0 errores** (20 warnings `no-unused-vars`, todas preexistentes y ninguna en archivos de
  esta feature; el mismo número que en la base).
- **`test`: 674 archivos / 8136 tests.** El total de ARCHIVOS es el que hay que comparar, no el de
  tests: coincide exactamente con el de T7.2 (674), así que **no hay archivos omitidos por
  *unhandled errors* de workers** y el conteo es creíble.

**Los 2 rojos de la corrida 1 son flakes por saturación, no regresiones** — y la corrida 2, verde
entera con el mismo total de archivos, lo confirma. Ninguno de los dos archivos menciona
`KpiValorAnimado` ni `private/analytics` (comprobado con `grep -c`: 0 y 0). Ambos son tests de
temporización que tardaron 15 s y 79 s bajo la carga de la suite completa, y **pasan en aislado**:

```
tests/unit/components/filter-component.test.tsx
tests/unit/components/usuario-form.test.tsx
 Test Files  2 passed (2)
      Tests  53 passed (53)
```

**Delta de R36, dicho con precisión:** archivos 674 → 674 y tests 8136 → 8136 entre T7.2 (antes del
arreglo del compartido) y el cierre. **Delta de tests ajenos rotos por el cambio: 0.** No se retocó
ni un test ajeno para que encajara, que era la regla de corte de Q5.
