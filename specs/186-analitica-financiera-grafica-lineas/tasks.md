# Feature 186 — analítica financiera: gráfica de líneas en el tablero · tasks

> Lee `requirements.md` y `design.md` antes de empezar. Zona `frontend`, complejidad `low`.
> **Puerta humana CERRADA el 2026-08-06** (`requirements.md` §5): no hay task de espera.
>
> Convención del repo: casilla `[x]` al terminar cada task (la revisión de la 180 dejó un hallazgo
> `menor` por no usarlas). `[P]` = puede ir en paralelo con las otras `[P]` de su tanda. Cada task
> tiene su criterio de **Hecho**; sin él, no está hecha.
>
> **Ningún archivo de `lib/`, `db/` ni `components/private/analytics/` se edita.** Si alguna task
> parece pedirlo, es que la task está mal y hay que decirlo, no editarlo.
>
> **Esta rama tiene `dev` mergeado con el hotfix PR #305.** El `TableroFinanciero.tsx` de partida
> es el de después del hotfix. Léelo antes de la T0.

---

## T0 — Arranque

- [x] **T0.1 — Baseline medido en esta rama, antes de tocar nada.** Correr los tests del tablero,
  del adaptador y el guardia sin cambiar una línea.
  **Hecho:** en `progress/impl_186.md` está el baseline (archivos, tests, verde/rojo) y la
  comprobación de que `ContenidoDeVista` es el de `design.md` §2 —cuatro ramas, con
  `esSerieTemporal(vista) || vista.filas.length === 0 → PanelKpi`—. Si algo no coincide, se para y
  se dice.
- [x] **T0.2 — Registrar las decisiones de la puerta** (Q1 disuelta por el hotfix; Q2 = (b);
  Q3, Q4 = (a); Q5 = no) en `progress/decision_186.md`, con fecha.
  **Hecho:** las cinco tienen su línea, y la de Q2 lleva sus dos motivos —la instrucción de la 127 en
  `CuentasPorPagarAnaliticaRepository.ts:19` y la monotonía del saldo acumulado—, que son los que hay
  que poder citar en la revisión.

## Tanda A — el adaptador puro

- [x] **T A.1 — Mudar `esSerieTemporal` a `adaptar.ts` como `esVistaTemporal`** (⟨D1⟩), con su
  comentario, **conservando la forma NEGATIVA** y estrechando el tipo a `VistaTemporal`.
  `TableroFinanciero.tsx` la importa y deja de nombrar ningún valor de granularidad.
  **Hecho:** `pnpm run typecheck` limpio **y los seis casos del bloque `Hotfix — …` de
  `tests/components/TableroFinanciero.test.tsx` siguen verdes SIN TOCARLOS.** Si alguno cambia, el
  movimiento no fue puro: se para. `pnpm exec vitest run` de ese archivo pegado en la bitácora.
- [x] **T A.2 [P] — `etiquetaDeCubo(clave, granularidad, textos)`** (⟨D4⟩/⟨D5⟩): pura, sin `Date`,
  sin zona horaria, sin aritmética de calendario, sin literal de locale ni de moneda, con `switch`
  y **rama `default`** para el grano no declarado.
  **Hecho:** para la misma clave, `dia` y `semana` dan etiquetas **distintas**; las dos contienen la
  clave **literal**; cada etiqueta contiene exactamente una fecha `YYYY-MM-DD`; y un valor fuera del
  dominio no produce la etiqueta diaria.
- [x] **T A.3 — `serieTemporalDeVista(...)` delegando en `serieDeVista`** (⟨D6⟩), con las mismas
  sobrecargas por forma del importe. Depende de A.1 y A.2.
  **Hecho:** pedir el `"neto"` de una vista `solo_bruto` **no compila**; la serie tiene tantos puntos
  como filas y en el mismo orden; el valor sale de `aNumero` y **no hay una segunda conversión
  escrita** en el archivo.

## Tanda B — tests del adaptador (depende de A)

- [x] **T B.1 — Casos de R7, R8 y R9** en `tests/unit/analytics/tablero-financiero-adaptar.test.ts`.
  **Hecho:** existen «la etiqueta del MISMO cubo cambia entre dia y semana», «la etiqueta nombra UNA
  sola fecha: la clave del cubo, y ninguna calculada» y «una granularidad desconocida no se rotula
  como si fuera un dia». El tercero necesita un `as` para construir un valor fuera del dominio: el
  test **dice por qué está ahí** (⟨D5⟩: la rama existe para un DTO que llegue de una caché o de una
  versión desplegada antes, no para un valor que el tipo permita hoy).
  **Mutaciones medidas:** quitar el parámetro `granularidad` mata el primero; etiquetar con un rango
  `clave – clave+6` mata el segundo; devolver la clave cruda en el `default` mata el tercero.
- [x] **T B.2 [P] — Casos de R10 y R11.**
  **Hecho:** existen «un punto por fila, en el orden del DTO, sin cola agrupada», «una serie de 62
  puntos llega entera y no lanza» y «un importe ilegible es dato ausente y nunca cero».
  **Mutaciones medidas:** aplicar `agruparCola` mata el primero; `?? 0` mata el tercero.

## Tanda C — el panel (depende de A; puede solaparse con B)

- [x] **T C.1 — Textos nuevos en `TEXTOS` de `TableroFinanciero.tsx`:** pieza para el título de la
  gráfica (⟨D8⟩), prefijo de cubo semanal, marcador de grano no declarado y el motivo de R3.
  **Hecho:** los cuatro viven en el objeto `TEXTOS` existente, no hay cadena de UI suelta en el JSX,
  y ninguno contiene símbolo de moneda, código ISO ni locale. El motivo de R3 **nombra el porqué**
  (saldo acumulado, la línea solo puede subir o mantenerse), no solo el hecho.
- [x] **T C.2 — `PanelLineas` dentro de la rama del KPI** (⟨D8⟩), sin reordenar las dos ramas de
  `cod_recaudado` y sin crear una quinta. `ContenidoDeVista` recibe `esAcumulado` desde
  `SeccionVista`. Las series se componen con `esVistaConNeto`, igual que `seriesComparativas`.
  **Hecho:** una vista temporal de flujo renderiza KPI **+** gráfica; una `no_temporal` renderiza
  exactamente lo que renderizaba antes; **no se pasa `avisoRecorte`** ni ninguna otra prop-función;
  **no se aplica `agruparCola`** a la serie temporal.
- [x] **T C.3 — `MotivoSinSerie` para la métrica acumulada** (R3/R4, Q2 = (b)), condicionado a
  `esVistaTemporal(vista) && datos.esAcumulado` y **no** a una lista de ids. No se toca el texto de
  «saldo al corte» que `CabeceraPanel` ya emite (⟨D3⟩).
  **Hecho:** el motivo aparece en `cuenta_por_pagar_mensajero`, **no** en las seis de flujo y
  **no** en `cuenta_por_pagar_tienda` (que también es acumulada, pero `no_temporal`); y el texto
  viejo de la 132 sigue byte a byte como estaba.

## Tanda D — dobles y tests de componente (depende de C)

- [x] **T D.1 — Añadir a los dobles una vista con `granularidad: "semana"`.** Hoy la fixture solo
  tiene `dia` y `no_temporal`, así que la rama semanal no se ejercita de punta a punta.
  **Hecho:** existe el doble y su serie es coherente con lo que el servidor produciría (claves de
  cubo ascendentes y sin repetir). Los casos preexistentes de la 132, la 183 y el hotfix siguen
  verdes **sin relajarse**; si alguno cambia de esperado, se explica uno a uno en la bitácora.
- [x] **T D.2 — Casos de R17 (b), (c) y (d).** **NO se reescribe** «la fixture declara temporales
  EXACTAMENTE las siete…» ni «la serie de la fixture es DENSA…»: ya existen y son R17(a).
  **Hecho:** existen «la fixture declara acumuladas EXACTAMENTE las dos que el contrato acumula»,
  «los dobles cubren las TRES granularidades, semana incluida» y «ninguna vista de la fixture mezcla
  formas de importe entre su total y sus filas». **Mutación medida:** quitar la vista semanal mata
  el segundo.
- [x] **T D.3 — Casos de R1, R2, R6 y R13.**
  **Hecho:** existe el par discriminador de R6 —una vista de grano `tienda` con granularidad `dia`
  **sí** lleva línea, y una de grano `fecha` con `no_temporal` **no**—, que es lo que mata una
  implementación basada en `grano` o en `filas.length`. **Mutación medida:** decidir por
  `vista.grano === "fecha"` lo pone rojo.
- [x] **T D.4 — Caso de R5: la lectura por la negativa, que el hotfix no tiene probada.** Una vista
  con un valor de granularidad que el tablero no conoce se trata como **serie**, no como tabla.
  **Hecho:** **mutación medida** — escribir la señal en positivo
  (`=== "dia" || === "semana"`) pone rojo este caso. Es la única red contra el defecto de ⟨H1⟩
  reintroducido por simetría con el rotulador (`design.md` §8, alternativa 5).
- [x] **T D.5 — Casos de R3 y R4**, escritos como par: el motivo aparece en la acumulada temporal y
  **no** en las de flujo ni en la acumulada `no_temporal`.
  **Hecho:** pintar el motivo en toda métrica acumulada pone rojo el segundo caso (medido).
- [x] **T D.6 — Caso de R14:** la vista temporal conserva su KPI junto a la línea y sigue sin tabla.
  **Hecho:** sustituir el KPI por la gráfica pone rojo este caso. Es lo que impide que esta feature
  deshaga el hotfix «al reorganizar el panel».
- [x] **T D.7 — Caso de R7 de punta a punta:** la alternativa textual de una vista semanal no lee
  sus puntos como días.
  **Hecho:** el caso afirma sobre el contenido de la `<ul aria-label>` de `SerieTextual`, **nunca**
  sobre nodos de recharts (lo prohíbe `analytics-paquete-guard.test.ts`); `LineasLienzo` se dobla
  como ya se doblan `BarrasLienzo` y `DonutLienzo` en ese mismo archivo.

## Tanda E — guardias (depende de C; `[P]` con D)

- [x] **T E.1 [P] — Censo (g) en `tests/unit/guards/tablero-financiero.guardia.test.ts`:** solo un
  módulo de la región nombra los valores de `GranularidadVista`. El dominio se **importa**, no se
  reescribe (misma técnica que el censo (e) con `RolValue`).
  **Hecho:** el censo trae su autocomprobación (texto prohibido → lo detecta; texto limpio → no) y
  un contrapeso que impide que pase por vacío. **Mutación medida:** escribir
  `granularidad === "dia"` en `TableroFinanciero.tsx` lo pone rojo.
- [x] **T E.2 [P] — Verificar que no se relajó nada** en ese archivo: ninguna aserción retirada,
  cuentas ancladas intactas, censos (a)–(f) igual.
  **Hecho:** en la bitácora está el `git diff` de ese archivo comentado aserción por aserción, con
  la frase explícita de qué se añadió y qué no se tocó.
- [x] **T E.3 — Guardia de trazabilidad nuevo**
  (`tests/unit/guards/tablero-lineas-trazabilidad.guardia.test.ts`), calcado del de la 180:
  `R1..R18` sin saltos ni repetidos, cada fila citando al menos un `.test.ts` que **exista**, y la
  sección del mapa no puede comerse otro encabezado.
  **Hecho:** citar un archivo inexistente lo pone rojo (medido). Es la red contra lo que pasó en la
  188, donde tres filas del anexo apuntaban a casos que no estaban donde decían.

## Tanda F — cierre

- [x] **T F.1 — Mapa `R1..R18 → test` en `progress/impl_186.md`,** escrito **abriendo los tests**,
  no copiando la tabla de `requirements.md` §4.
  **Hecho:** cada fila cita archivo y nombre de caso **tal como quedaron escritos**; donde el nombre
  final difiera del previsto, se dice. Las filas de R17(a) citan los **dos casos del hotfix**, y se
  declara que no se reescribieron.
- [x] **T F.2 — Evidencia de mutación** en `progress/impl_186.md`: al menos las ocho nombradas en
  las tasks (etiqueta sin granularidad; etiqueta con rango calculado; `default` que devuelve la
  clave cruda; `agruparCola` sobre la serie temporal; decisión por `grano`; **señal en positivo**;
  motivo en toda métrica acumulada; KPI sustituido por la gráfica).
  **Hecho:** cada una se sembró en el código de **producción**, se corrió y se revirtió con la
  edición inversa exacta (**nunca `git checkout`**), con `git status` limpio comprobado después.
- [ ] **T F.3 — `pnpm exec next build` a mano**, con la salida pegada en la bitácora.
  **Hecho:** termina sin error. **Nunca `pnpm build`**, que encadena `migrate deploy` contra una
  base real.
- [ ] **T F.4 — Gate.** `./init.sh --rapido` al cerrar cada tanda; **`./init.sh` completo antes del
  PR, sin excepción**.
  **Hecho:** las dos salidas pegadas, con el **delta de rojos** declarado. Si algún rojo es
  preexistente y ajeno, se demuestra que lo es en vez de afirmarlo.
- [x] **T F.5 — Proponer al leader la ficha de `design.md` §7.3** («tests: perfil de forma del DTO
  financiero, compartido entre el servicio y el tablero»), que es la deuda que ⟨H1⟩ deja y que esta
  feature **no** cierra.
  **Hecho:** el borrador de la ficha está en la bitácora, con su zona, complejidad, `depends_on` y
  el motivo escrito como incidente. **No se escribe en `feature_list.json` desde aquí**: eso lo hace
  el leader.
- [ ] **T F.6 — Cerrar la ficha.** `status_note` de 3–6 líneas en `feature_list.json` (el detalle
  vive en `progress/`) y entrada en `progress/history.md`.
  **Hecho:** la 186 queda con su `spec_path`, su rama y su PR.

---

## Dependencias, de un vistazo

```
T0 ──► A ──┬──►  B
           └──►  C ──┬──►  D ──┐
                     └──►  E ──┴──► F
```

`A.1` es la primera y **bloquea de verdad**: hasta que la señal no esté en `adaptar.ts` con su tipo,
ni el rotulador ni el censo (g) tienen dónde apoyarse. `A.2` puede ir en paralelo con `A.1`; `A.3`
necesita las dos. `B` y `C` van a la vez tras `A`. `D` necesita `C`. `E` solo necesita `C`.

## Lo que NO es una task de esta feature, y no es un olvido

- Tocar `lib/`, `db/` o `components/private/analytics/`.
- Dibujar `cuenta_por_pagar_mensajero` como línea: decisión humana Q2 = (b).
- Cablear el rango financiero a la barra de filtros (slot de la 131). Con el rango fijo en `mes`, la
  granularidad `semana` **no es alcanzable en producción**: se prueba con dobles y así queda dicho.
- Marcar el cubo en curso como parcial: el DTO no lo publica (Q2 de la 180 = (a)).
- Envolver las dos lecturas de `deCaja`/`deTesoreria` en una transacción: es la **187**, y aquí no
  se disimula derivando el total de los puntos de la línea.
- Escribir un E2E (Q5). El arnés existe, pero sus specs **no se ejecutan**; añadir uno más sería
  declarar cobertura que nadie corre.
- Cerrar la deuda de ⟨H1⟩ con un test de contrato dobles ↔ servicio: es la ficha de §7.3 (T F.5).
