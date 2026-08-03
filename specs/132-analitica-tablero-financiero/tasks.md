# Feature 132 — analítica: tablero financiero · tasks

> Orden de ejecución de arriba abajo. `[P]` = puede ir en paralelo con la task anterior marcada
> igual (no comparten archivo). Cada task cierra `R<n>` concretos y tiene su criterio de "hecho".
> **Ninguna task de código empieza antes de cerrar T0.**
>
> Gate por tanda: `./init.sh --rapido` lo corre el **leader**, no el subagente
> (`AGENTS.md > Regla del gate`). El subagente corre `pnpm typecheck`, `pnpm lint` y
> `pnpm exec vitest related --run <sus archivos>`.

---

## T0 — Puerta F1.4: preguntas abiertas (BLOQUEA TODO)

Espejo de `requirements.md > Preguntas abiertas`. El humano responde; el spec_author actualiza los
tres archivos si alguna respuesta cambia el diseño.

> **PUERTA CERRADA POR DEFECTO DECLARADO — 2026-08-03.** El humano ordenó continuar sin
> responderlas una a una («continua, vuelve y pregunta»). Las seis se toman con **la
> recomendación que ya estaba escrita en el spec**, no con un criterio nuevo, y quedan
> **PENDIENTES DE RATIFICACIÓN**. Debajo, lo que cuesta revertir cada una.

- [x] **T0.1 — Q1 (BLOQUEANTE). RESUELTA: `mes`** (ventana móvil de 30 días). Motivo: un tablero
      financiero abierto en `dia` a las 08:00 sale casi todo en cero y se lee como avería.
      → fija el valor de `rango.ts` (R26).
      *Revertir cuesta:* una constante y su test. Trivial.
- [x] **T0.2 — Q2 (BLOQUEANTE). RESUELTA: (a) id crudo**, con la limitación escrita EN PANTALLA y
      ficha aparte para los nombres (registrada como **179**). Motivo: (b) mete una consulta que
      el diseño de la 127 no previó y que habría que repetir en la 131 y en la 134; (c) reabre una
      feature `done` y mergeada.
      *Revertir a (b) cuesta:* una lectura en el Server Component y su task; la feature dejaría de
      ser sólo presentación → reevaluar alcance con el leader.
- [x] **T0.3 — Q3 (BLOQUEANTE). RESUELTA: se acepta el tablero SIN gráfica de líneas**, y el
      desglose por fecha se registra aparte (ficha **180**). Motivo: la 127 agrega la ventana
      entera y no publica filas por fecha; dibujar una línea exigiría inventarse los puntos.
      *Revertir cuesta:* la 132 se bloquea hasta ampliar la 127. **Es la única de las tres cuya
      reversión no es barata**, y por eso es la que más conviene ratificar pronto.
- [x] **T0.4 — Q4, Q5, Q6 (no bloqueantes). SIN OBJECIÓN**, se aplican las recomendaciones
      (2026-08-03): **Q4** la región financiera NO se renderiza si no hay contenido —se sigue el
      razonamiento del punto de extensión de la 129, no su instrucción, porque se contradicen
      entre sí—; **Q5** sin E2E en esta feature, el gate se cubre con los tests de página por rol
      (R1, R2) y el E2E se hace una sola vez en la 133; **Q6** el aviso de descuadre (R19) se
      muestra a los DOS roles, porque `maestro` y `admin` son equivalentes en todo el repo y
      partirlos aquí crearía una tercera categoría de rol.

---

## T1 — Andamio del shell y de la región

- [x] **T1.1 — Ampliar `AnaliticaShell`.** Añadir `financiero?: ReactNode` a `AnaliticaShellProps`
      y una `<section aria-label="Tablero financiero">` **debajo** de la región "Tablero operativo",
      en la misma pila vertical. Si la prop no llega, la sección **no se renderiza** (no hay
      `EmptyState`; ver `design.md §3.5`). No se reordena ni se modifica nada de lo existente.
      → **R6, R7**. Depende de: T0.4.
      *Hecho:* `AnaliticaShell.test.tsx` ampliado con dos casos (con prop / sin prop) en verde, y
      los casos preexistentes de las otras dos regiones intactos.

- [x] **T1.2 [P] — `rango.ts`: la única constante de rango.** Un archivo, un objeto congelado
      `FILTRO_FINANCIERO_POR_DEFECTO` con el preset decidido en T0.1. Sin lectura de
      `searchParams`, sin `Date`, sin `process.env`.
      → **R26**. Depende de: T0.1.
      *Hecho:* test que afirma que el objeto es el único origen del rango (censo: ningún otro
      archivo de la feature escribe un literal de preset).

---

## T2 — Adaptadores puros (el corazón testeable)

- [x] **T2.1 — `adaptar.ts`: `aNumero`.** `string` escala 2 → `number | null`. Devuelve `null` si
      el resultado no es finito. No hace aritmética de dinero.
      → **R15**. Depende de: T0.
      *Hecho:* tests con `"0.00"`, `"-123.45"`, `"1234567.89"`, `""`, `"abc"`, `"NaN"`; el caso
      basura devuelve `null` y **no** `0`.

- [x] **T2.2 — `adaptar.ts`: `serieDeVista` y `filasDeVista`.** Traducen `VistaFinanciera` a
      `SerieDato` / `FilaResumen[]`, exponiendo **bruto y neto** (dos columnas en la tabla; cifra +
      línea secundaria en el KPI). El `cubo` se copia tal cual, sin enriquecer.
      → **R14, R16, R24**. Depende de: T2.1.
      *Hecho:* test que toma un `VistaFinanciera` de ejemplo y afirma que cada número pintado
      procede literalmente de un campo del DTO; test que afirma que no se llama a ninguna función de
      suma sobre importes del DTO.

- [x] **T2.3 — `adaptar.ts`: `agruparCola`.** Conserva las `tope - 1` primeras categorías y agrupa
      el resto en una categoría única. El total se conserva.
      → **R20, R21**. Depende de: T2.1.
      *Hecho:* test con 12 cubos → 5 categorías, y `Σ resultado === Σ entrada`; test con 3 cubos →
      pasa sin tocar nada; test que confirma que `GraficaBarras`/`GraficaDonut` con la salida de
      esta función **no lanzan** `SeriesExcedidasError` con `NODE_ENV !== "production"`.

---

## T3 — Carga en el servidor

- [x] **T3.1 — `cargar.ts`.** `Promise.all` sobre `IDS_FINANCIERAS_SERVIDAS` invocando
      `consultarMetricaFinanciera(id, FILTRO_FINANCIERO_POR_DEFECTO)` **sin `deps`**. Normaliza a
      `PanelFinanciero` (`ok` / `error` / `denegado`). No captura y silencia: un `error` del borde
      se propaga como estado de panel, no como excepción.
      → **R9, R12, R13, R23, R27**. Depende de: T1.2, T0.
      *Hecho:* test con el Server Action mockeado que afirma (a) exactamente 8 invocaciones, (b)
      que los ids invocados son **exactamente** `IDS_FINANCIERAS_SERVIDAS`, (c) que con una
      respuesta `error` y una `forbidden` las otras seis siguen llegando `ok`, (d) que las llamadas
      se emiten antes de resolverse la primera (concurrencia real, no secuencia).

---

## T4 — Los paneles

- [x] **T4.1 — `TableroFinanciero.tsx` (servidor).** Compone los 9 paneles de `design.md §5`
      usando `KpiCard`, `GraficaDonut`, `GraficaBarras` y `TablaResumen`. Sin `"use client"`.
      **Nunca pasa `avisoRecorte`** (es una función y no cruza la frontera RSC). Los paneles
      `denegado` no se renderizan; los `error` se renderizan con la prop `error`.
      → **R4, R10, R13, R17, R22, R23, R25**. Depende de: T2.2, T2.3, T3.1.
      *Hecho:* test de render que afirma un panel por métrica, que la métrica denegada **no**
      aparece por ninguna de sus etiquetas, que el panel en error muestra `role="alert"` y **no**
      muestra ninguna cifra, y que las dos vistas de `cod_recaudado` viven en secciones distintas
      con nombres accesibles distintos y sin total conjunto.

- [x] **T4.2 — Etiqueta de "saldo al corte".** Los paneles cuyo DTO trae `esAcumulado: true`
      (`cuenta_por_pagar_tienda`, `cuenta_por_pagar_mensajero`) muestran texto visible que declara
      que es saldo al corte y no flujo del período. Se lee del DTO, no de una lista escrita a mano.
      → **R18**. Depende de: T4.1.
      *Hecho:* test que afirma el texto en esas dos y su **ausencia** en las otras seis.

- [x] **T4.3 [P] — `PanelConciliacion.tsx`.** Conteos por `(nivel, estado)` con sus totales, más el
      bloque de cuadre. SI `cuadra === false`, aviso visible con la cantidad de cierres
      descuadrados. No lanza nunca.
      → **R19**. Depende de: T3.1.
      *Hecho:* dos tests, cuadre OK y cuadre roto; el segundo afirma el aviso y que el componente
      renderiza igualmente el resto de la tabla.

---

## T5 — La página y la frontera RSC

- [x] **T5.1 — Cablear `page.tsx`.** Tras el gate existente (que **no se toca**): si
      `esAccesoTotal(actor.rol)`, `await cargarTableroFinanciero()` y pasar
      `financiero={<TableroFinanciero … />}` al shell. Si no, no pasar la prop.
      → **R1, R2, R3, R5, R8, R9**. Depende de: T1.1, T4.1, T4.3.
      *Hecho:* `AnaliticaPage.test.tsx` ampliado enumerando los **seis** `RolValue`: `maestro` y
      `admin` ven la región; los otros cuatro siguen recibiendo `notFound()`; y un caso que afirma
      que para un rol sin acceso **no aparece** ninguna etiqueta de métrica financiera ni la
      palabra de la región. Diff de `lib/auth/menu-visibility.ts` y `lib/analytics/types.ts`:
      **vacío**.

- [x] **T5.2 — Guard estático de la feature.** `tests/unit/guards/tablero-financiero.guardia.test.ts`:
      (a) ningún archivo de servidor de la feature declara `"use client"`; (b) ninguno pasa
      `avisoRecorte` ni ninguna otra prop cuyo valor sea una función a un componente cliente;
      (c) ninguno escribe símbolo de moneda, ISO ni locale; (d) ninguno escribe
      `dominio: "financiera"` ni una lista de ids financieros a mano. Con **autocomprobación**: el
      censo debe detectar cada patrón sobre texto sintético (patrón de los guards existentes del
      repo).
      → **R10, R25, R27**. Depende de: T5.1.
      *Hecho:* guard en verde y sus cuatro autocomprobaciones fallando cuando se les inyecta el
      patrón prohibido.

- [x] **T5.3 — Verificar el build de producción.** `pnpm exec next build`. **Nunca `pnpm build`**
      (encadena `migrate deploy` contra una base real).
      → **R11**. Depende de: T5.2.
      *Hecho:* salida del build pegada en `progress/impl_132-analitica-tablero-financiero.md`, terminando sin error. Si falla
      por Prisma en el bundle, el fallo es de la frontera RSC: se corrige moviendo el `"use client"`,
      no silenciando el build.

---

## T6 — Cierre

- [x] **T6.1 — Mapa de trazabilidad.** Tabla `R1..R28 → test` en `progress/impl_132-analitica-tablero-financiero.md`, con rutas
      de archivo reales.
      → **R28**. Depende de: T5.3.
      *Hecho:* los 28 números presentes, sin saltos ni repetidos, y cada ruta citada existe en el
      árbol.

- [ ] **T6.2 — Gate completo.** El **leader** corre `./init.sh` entero antes del PR.
      *Hecho:* verde, con el conteo de archivos de la suite comparado contra el baseline (~800
      archivos): una corrida con "unhandled errors" de workers omite archivos y parece verde.

- [ ] **T6.3 — Sincronización y PR.** `git fetch origin dev` + merge en la rama de la feature,
      resolver conflictos (previsibles en `AnaliticaShell.tsx` y `page.tsx` si la 131 aterriza
      antes), push y `gh pr create --base dev`.
      *Hecho:* URL del PR reportada al humano.

---

## Archivos que esta feature toca (para la validación de conflicto del leader)

**Modifica:** `app/(app)/analitica/page.tsx`, `app/(app)/analitica/_components/AnaliticaShell.tsx`,
`tests/components/AnaliticaPage.test.tsx`, `tests/components/AnaliticaShell.test.tsx`.

**Crea:** `app/(app)/analitica/_components/financiero/{rango.ts,adaptar.ts,cargar.ts,TableroFinanciero.tsx,PanelConciliacion.tsx}`,
`tests/unit/guards/tablero-financiero.guardia.test.ts`, tests unitarios de la feature,
`progress/impl_132-analitica-tablero-financiero.md`.

**No toca (y no debe):** `lib/analytics/**`, `lib/services/**`, `lib/repositories/**`,
`lib/actions/**`, `lib/auth/**`, `components/private/analytics/**`, `feature_list.json`.
