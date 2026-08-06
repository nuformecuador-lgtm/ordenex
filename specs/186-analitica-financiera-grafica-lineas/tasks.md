# Feature 186 — analítica financiera: gráfica de líneas en el tablero · tasks

> Lee `requirements.md` y `design.md` antes de empezar. Zona `frontend`, complejidad `low`.
> **Nada de esto se toca hasta que la puerta humana cierre la Q1** (T0).
>
> Convención del repo: casilla `[x]` al terminar cada task (la revisión de la 180 dejó un hallazgo
> `menor` por no usarlas). `[P]` = puede ir en paralelo con las otras `[P]` de su misma tanda.
> Cada task tiene su criterio de **Hecho**; sin él, no está hecha.
>
> **Ningún archivo de `lib/`, `db/` ni `components/private/analytics/` se edita en esta feature.**
> Si alguna task parece pedirlo, es que la task está mal y hay que decirlo, no editarlo.

---

## T0 — Puerta humana (BLOQUEA TODO LO DEMÁS)

- [ ] **T0.1 — Cerrar la Q1** (¿esta feature repara H1, la tabla de fechas que la 180 encendió?).
  **Hecho:** la decisión queda escrita, fechada y con su opción `(a)/(b)/(c)` en
  `progress/decision_186.md`. Si la respuesta es (b), **R13 sale de la spec** y las tasks T4.2, T5.4
  y su fila del mapa se retiran explícitamente en vez de quedarse a medias.
- [ ] **T0.2 — Registrar las decisiones de Q2..Q5.** Si el humano no se pronuncia, se aplican las
  recomendaciones tal como están escritas (mismo procedimiento que la 132 con sus seis preguntas).
  **Hecho:** las cinco preguntas tienen una línea de decisión en `progress/decision_186.md`, cada
  una diciendo si fue elección humana o aplicación del default.
- [ ] **T0.3 — Reverificar H1 contra el árbol antes de tocar nada.** Correr los tests del tablero y
  del adaptador **sin cambiar una línea** y dejar la salida de referencia.
  **Hecho:** en `progress/impl_186.md` está el baseline medido **en esta rama** (archivos, tests,
  verde/rojo) y la comprobación de que las cuatro ramas de `ContenidoDeVista` son las que dice el
  §2 del design. Si algo no coincide, se para y se dice.

---

## Tanda A — el adaptador puro (depende de T0)

- [ ] **T A.1 [P] — `esVistaTemporal`, `VistaTemporal` y `GRANULARIDADES_TEMPORALES` en
  `adaptar.ts`.** Predicado por la forma del DTO, hermano de `esVistaConNeto`; dominio agotado con
  `switch` sin rama por defecto.
  **Hecho:** `pnpm run typecheck` limpio; una vista `no_temporal` no estrecha al tipo temporal y
  una `dia`/`semana` sí; el archivo no importa nada nuevo de React, Prisma ni `next/*`.
- [ ] **T A.2 [P] — `etiquetaDeCubo(clave, granularidad, textos)`.** Pura: sin `Date`, sin zona
  horaria, sin aritmética de calendario, sin literal de locale ni de moneda.
  **Hecho:** para la misma clave, `dia` y `semana` producen etiquetas **distintas**, y ambas
  contienen la clave **literal**; la etiqueta contiene exactamente una fecha `YYYY-MM-DD`.
- [ ] **T A.3 — `serieTemporalDeVista(...)` delegando en `serieDeVista`** (⟨D5⟩), con las mismas
  sobrecargas por forma del importe. Depende de A.1 y A.2.
  **Hecho:** pedir el `"neto"` de una vista `solo_bruto` **no compila**; la serie devuelta tiene
  tantos puntos como filas trae la vista y en el mismo orden; el valor de cada punto es el que
  `aNumero` produce para ese campo (no hay una segunda conversión escrita).

## Tanda B — tests del adaptador (depende de A)

- [ ] **T B.1 — Casos de R4 y R5** en `tests/unit/analytics/tablero-financiero-adaptar.test.ts`.
  **Hecho:** existe el caso «la etiqueta del MISMO cubo cambia entre dia y semana» y el caso «la
  etiqueta nombra UNA sola fecha: la clave del cubo, y ninguna calculada». **Mutación medida y
  pegada en la bitácora:** quitar el parámetro `granularidad` del etiquetado deja rojo el primero;
  etiquetar con un rango `clave – clave+6` deja rojo el segundo.
- [ ] **T B.2 [P] — Casos de R9 y R10.**
  **Hecho:** existen «un punto por fila, en el orden del DTO, sin cola agrupada», «una serie de 62
  puntos llega entera y no lanza» y «un importe ilegible es dato ausente y nunca cero».
  **Mutación medida:** aplicar `agruparCola` a la serie deja rojo el primero; `?? 0` en la
  conversión deja rojo el tercero.

## Tanda C — el panel (depende de A; puede solaparse con B)

- [ ] **T C.1 — Textos nuevos en `TEXTOS` de `TableroFinanciero.tsx`:** nombre de la pieza para el
  título de la gráfica (⟨D8⟩), prefijo de cubo semanal y advertencia de saldo acumulado por punto.
  **Hecho:** los tres viven en el objeto `TEXTOS` existente, no hay ninguna cadena de UI suelta en
  el JSX, y ninguno contiene símbolo de moneda, código ISO ni locale.
- [ ] **T C.2 — `PanelLineas` y la rama de `ContenidoDeVista`** (⟨D7⟩), colocada **antes** de las
  dos ramas de `cod_recaudado`. Las series se componen con `esVistaConNeto` igual que hace
  `seriesComparativas`.
  **Hecho:** una vista temporal renderiza KPI + gráfica; una `no_temporal` renderiza exactamente lo
  que renderizaba antes de esta feature; **no se pasa `avisoRecorte`** ni ninguna otra prop-función.
- [ ] **T C.3 — El texto de R6/R7**, condicionado a `datos.esAcumulado` del DTO y **no** a una lista
  de ids. No se modifica el texto de «saldo al corte» que `CabeceraPanel` ya emite (⟨D3⟩).
  **Hecho:** el texto nuevo aparece solo en las métricas acumuladas y el texto viejo de la 132 sigue
  byte a byte como estaba.

## Tanda D — los dobles y los tests de componente (depende de C)

- [ ] **T D.1 — Actualizar los dobles de `tests/components/TableroFinanciero.test.tsx`** para que
  las siete métricas del desglose traigan **filas por cubo**, y añadir al menos una vista con
  `granularidad: "semana"`.
  **Hecho:** ningún doble de vista temporal declara `filas: []`; los casos preexistentes de la 132 y
  la 183 (KPI, formas de importe, totales, `saldo al corte`, cubos de tienda) siguen **verdes sin
  relajarse**; si alguno cambia de esperado, se explica uno a uno en la bitácora.
- [ ] **T D.2 — Contrapeso de cobertura (R16):** un caso que afirma que el juego de dobles cubre los
  tres valores de granularidad.
  **Hecho:** quitar la vista semanal del juego pone ese caso rojo (medido).
- [ ] **T D.3 — Casos de R1, R2, R3, R8 y R12.**
  **Hecho:** existe el par discriminador de R3 —una vista de grano `tienda` con granularidad `dia`
  **sí** lleva línea, y una de grano `fecha` con `no_temporal` **no**—, que es lo que mata una
  implementación basada en `grano` o en `filas.length`. **Mutación medida:** decidir por
  `vista.grano === "fecha"` pone rojo ese par.
- [ ] **T D.4 — Casos de R6 y R7**, escritos como par: aparece en la acumulada y **no** aparece en
  las de flujo.
  **Hecho:** pintar el texto en todas las métricas pone rojo el segundo caso (medido).
- [ ] **T D.5 — Caso de R13** (solo si Q1 = (a) o (c)): una vista temporal muestra el KPI del total
  y **ninguna** tabla por cubo.
  **Hecho:** revertir la rama de C.2 (dejar la caída actual a `PanelTabla`) pone rojo este caso.
  Es la prueba de que H1 estaba realmente sin cubrir.
- [ ] **T D.6 — Caso de R4 de punta a punta:** la alternativa textual de una vista semanal no lee
  sus puntos como días.
  **Hecho:** el caso afirma sobre el contenido de la `<ul aria-label>` de `SerieTextual`, **nunca**
  sobre nodos de recharts (lo prohíbe `analytics-paquete-guard.test.ts`); el lienzo se dobla como ya
  hacen los casos de barras y donut de ese mismo archivo.

## Tanda E — guardias (depende de C; `[P]` con D)

- [ ] **T E.1 [P] — Censo (g) en `tests/unit/guards/tablero-financiero.guardia.test.ts`:** solo un
  módulo de la región nombra los valores de `GranularidadVista`. El dominio se **importa** de
  `GRANULARIDADES_TEMPORALES` (más `"no_temporal"` derivado del tipo), no se reescribe, igual que el
  censo (e) hace con `RolValue`.
  **Hecho:** el censo trae su autocomprobación (texto prohibido → lo detecta; texto limpio → no lo
  detecta) y un contrapeso que impide que pase por vacío. **Mutación medida:** escribir
  `granularidad === "dia"` en `TableroFinanciero.tsx` lo pone rojo.
- [ ] **T E.2 [P] — Verificar que no se relajó nada** en ese archivo: ninguna aserción retirada,
  las cuentas ancladas intactas, los censos (a)–(f) igual que estaban.
  **Hecho:** en la bitácora está el `git diff` de ese archivo comentado aserción por aserción, con
  la frase explícita de qué se añadió y qué no se tocó.
- [ ] **T E.3 — Guardia de trazabilidad nuevo**
  (`tests/unit/guards/tablero-lineas-trazabilidad.guardia.test.ts`), calcado del de la 180: los
  `R1..R17` sin saltos ni repetidos, cada fila citando al menos un `.test.ts` que **exista** en el
  árbol, y la sección del mapa no puede comerse otro encabezado.
  **Hecho:** citar un archivo inexistente en el mapa lo pone rojo (medido). Es la red contra lo que
  pasó en la 188, donde tres filas del anexo apuntaban a casos que no estaban donde decían.

## Tanda F — cierre

- [ ] **T F.1 — Mapa `R1..R17 → test` en `progress/impl_186.md`,** escrito **abriendo los tests**,
  no copiando la tabla de `requirements.md` §4.
  **Hecho:** cada fila cita archivo y nombre de caso **tal como quedaron escritos**; donde el nombre
  final difiera del previsto en la spec, se dice.
- [ ] **T F.2 — Evidencia de mutación** en `progress/impl_186.md`: al menos las seis mutaciones
  nombradas en las tasks (etiqueta sin granularidad, etiqueta con rango calculado, `agruparCola`
  sobre la serie temporal, decisión por `grano`, texto de acumulada en todas, caída a `PanelTabla`).
  **Hecho:** cada mutación se sembró en el código de **producción**, se corrió, y se revirtió con la
  edición inversa exacta (**nunca `git checkout`**), con `git status` limpio comprobado después de
  cada una.
- [ ] **T F.3 — `pnpm exec next build` a mano**, con la salida pegada en la bitácora.
  **Hecho:** termina sin error. **Nunca `pnpm build`**, que encadena `migrate deploy` contra una
  base real.
- [ ] **T F.4 — Gate.** `./init.sh --rapido` al cerrar cada tanda; **`./init.sh` completo antes del
  PR, sin excepción**.
  **Hecho:** las dos salidas pegadas en la bitácora, con el **delta de rojos** declarado. Si algún
  rojo es preexistente y ajeno, se demuestra que lo es en vez de afirmarlo.
- [ ] **T F.5 — Cerrar la ficha.** `status_note` de 3–6 líneas en `feature_list.json` (el detalle
  vive en `progress/`, no duplicado en el JSON) y entrada en `progress/history.md`.
  **Hecho:** la ficha 186 queda con su `spec_path`, su rama y su PR; y si Q1 se cerró en (b), queda
  registrada la ficha nueva de la regresión H1 con su descripción.

---

## Dependencias, de un vistazo

```
T0  ──►  A ──►  B
         │
         └──►  C ──┬──►  D  ──┐
                   └──►  E  ──┴──►  F
```

`A.1` y `A.2` van en paralelo; `A.3` los necesita a los dos. `B` y `C` pueden ir a la vez una vez
cerrada `A`. `D` necesita `C` (los dobles se actualizan contra el panel ya escrito). `E` solo
necesita `C`. `F` cierra.

## Lo que NO es una task de esta feature, y no es un olvido

- Tocar `lib/`, `db/` o `components/private/analytics/`.
- Cablear el rango del tablero financiero a la barra de filtros (slot de la 131).
- Marcar el cubo en curso como parcial: el DTO no lo publica (Q2 de la 180 = (a)).
- Envolver las dos lecturas de `deCaja`/`deTesoreria` en una transacción: es la **187**, y aquí no
  se disimula derivando el total de los puntos de la línea.
- Escribir un E2E (Q5).
