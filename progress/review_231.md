# review_231 — Wallet · la caja partida en dos bolsillos

> Revisión del `reviewer`. Rama `feature/231-wallet-caja-dos-bolsillos`, base `dev` = `37c3e469`.
> **El trabajo está SIN COMMITEAR:** `HEAD == origin/dev == 37c3e469` y los 42 archivos de la
> feature son cambios del árbol de trabajo. `git diff dev...HEAD` NO es el diff de esta feature
> (el `dev` local está en `08927168`, obsoleto); se revisó el árbol.
>
> **Veredicto: RECHAZADO — 2 bloqueantes, 7 menores.**

---

## 1. Checklist

### Especificación (CHECKPOINTS · Especificacion)

- [x] `specs/231-wallet-caja-dos-bolsillos/requirements.md` con 40 requisitos EARS R1-R40.
- [x] `design.md` con alternativas descartadas y su porqué (seis, con motivo medido cada una).
- [x] `tasks.md` existe.
- [ ] **`tasks.md` con todas las tasks marcadas**: 33 tasks, 0 marcadas. Ver BLOQUEANTE 2.

### Trazabilidad (CHECKPOINTS · Trazabilidad)

- [x] Los **40** requisitos tienen un test **nombrado, que existe y que se ejecuta**. Se cruzó la
      tabla de `tasks.md` y los dos mapas de `progress/impl_231.md` contra los títulos reales de
      los `it(` de los 11 archivos implicados: **0 fantasmas** (ningún test citado que no exista)
      y **0 huérfanos** (ningún requisito sin test).
- [x] `progress/impl_231.md` contiene el mapa R->test (dos, uno por mitad).
- [ ] **Un test no verifica lo que dice cubrir**: la columna de INGRESOS de la tarjeta nueva no
      tiene ni una aserción sobre el importe de cada concepto. Ver BLOQUEANTE 1
      (`docs/verification.md`, Regla del reviewer).

### Calidad de código

- [x] `pnpm run typecheck` -> **0 errores** (re-medido por mí).
- [x] `pnpm run lint` -> **0 errores**, 69 warnings (los preexistentes declarados; ninguno de esta
      feature — re-medido por mí).
- [x] Tests re-corridos por mí sobre los 12 archivos de la feature: **12 files / 164 tests verde**.
      Guardias enteras: **111 files / 1648 tests verde**.
- [x] `./init.sh` completo: corrido por el leader con el árbol quieto (1120 archivos / 14374
      tests). No se repitió; nada de lo revisado dio motivo para dudar del resultado global.
- [n/a] **E2E**: la feature no toca ningún flujo crítico — no escribe una sola fila (R37,
      verificado en el diff) y no cambia permisos. Además el repo no tiene arnés de Playwright
      vivo. Checkpoint **inaplicable**.

### Datos y seguridad (Supabase)

- [x] **Ninguna tabla nueva**, luego ningún RLS que activar. `db/` y `db/schema.prisma` **no
      aparecen** en el árbol modificado (comprobado por mí con `git status --short`).
- [x] **Ninguna migración nueva**, luego nada que revertir.
- [x] Ningún secreto: cero literales de credencial, cero `process.env` nuevo.
- [n/a] Webhooks: la feature no crea ninguno.

### Patrón de capas

- [x] Borde (`lib/actions/wallet.ts`): **sólo docstring**. Ni schema nuevo, ni acción nueva, ni
      una operación aritmética. Sigue validando con `listarMovimientosSchema`.
- [x] Servicio (`WalletService.verResumenCaja`): guard de rol **antes** de tocar la base, mismo
      `construirFiltros` que el listado, **una sola** llamada a `agregarPorCategoriaYTipo` y dos
      derivaciones puras sobre el mismo array. No conoce HTTP.
- [~] Repositorio: `toDTO` gana `dueno` leyendo `NATURALEZA_POR_CATEGORIA`. Es una **desviación
      declarada** de `docs/architecture.md`, argumentada en design 3.3 y 6.2 (búsqueda total en un
      Record durante la proyección, punto único por el que pasan los cuatro consumidores del DTO).
      **Aceptada**: mapear en el servicio multiplica el `map` por cuatro y abre justo la puerta que
      la columna existe para cerrar. `agregarPorCategoriaYTipo` y el resto del repo, intactos.
- [x] Interfaces en `lib/interfaces/`, separadas por categoría.

### Permisos y multi-país

- [x] `/wallet` sigue con `esAccesoTotal` en el mismo sitio y en el mismo orden. `forbidden` viaja
      sin datos (R30, medido).
- [x] Componentes reciben datos por props desde el Server Component; ningún `fetch` a rutas
      internas (el módulo recarga por Server Action).
- [x] Ni país, ni moneda, ni cuenta hardcodeados: la feature **no toca `money()` ni
      `lib/config/moneda.ts`**; sólo le pasa STRINGs.

### Verificación específica del encargo

- [x] **Money-safe (R12)**: barrido manual mío sobre `app/(app)/wallet/` y sobre
      `lib/utils/caja-tesoreria.ts`: **cero** `Number(`, `parseFloat(`, `parseInt(` y `.toFixed(`
      en código (las tres coincidencias que salen son citas dentro de comentarios). Las guardias
      vivas siguen **sin editar y en verde**: `caja-derivaciones.guardia.test.ts` (sigue exigiendo
      exactamente 3 `derivarBalance(`, sin literales de signo y sin `.sub(`/`.minus(`),
      `caja-173-alcance.guardia.test.ts` y el barrido transversal de la 172
      (`liquidacion-money-safe.test.ts`, que sí censa `wallet-labels.ts`). Ninguna se relajó.
- [x] **Absorción del componente (D2)**: las **18** aserciones de la 45 y la 158 están
      re-hospedadas **con su intención intacta**. Detalle en la sección 3.
- [~] **DESIGN.md**: sin hex, sin utilidades de paleta, tres roles correctos y `dark:bg-{sem}/15`
      donde toca. Una desviación semántica: menor 2.
- [x] **Dónde vive lo que se prueba**: ninguna derivación nueva depende de un WHERE ni de un
      agregado nuevo. `derivarCaja` y `derivarComposicionGanancia` son puras sobre
      `AgregadoCajaRow[]`; `agregarPorCategoriaYTipo` (el único SQL implicado) **no se toca** y
      sigue cubierto por los tests de la 173, incluidos los de `tests/integration/db/`. `dueno`
      sale de un Record en memoria, no de la base. **No hay nada nuevo que viva en el SQL y se
      esté probando sólo contra un doble.**

---

## 2. Hallazgos

### BLOQUEANTE 1 — la columna de ingresos de la tarjeta nueva no comprueba ni un importe

`tests/components/ComposicionGananciaCard.test.tsx` verifica de la columna de INGRESOS: que haya
una fila por categoría (R23), que los rótulos sean la etiqueta legible y no el enum (R25), que el
orden sea el declarado (R28) y que el **total** sea el del servidor (R22, R23/R26). **Ninguna
aserción mira el importe de una fila.** Los siete importes del conjunto (150.00, 4000.00, 900.00,
19.50, 520.00, 30.25, 90.00) no se buscan en pantalla en ningún caso.

**Medido, no razonado.** Mutación aplicada al código de producto y revertida (copia previa;
restauración verificada byte a byte y suite verde después):

    app/(app)/wallet/_components/ComposicionGananciaCard.tsx:184
    -  valor={composicion.ingresos[categoria]}
    +  valor={composicion.ingresos.ingreso_flete}   // los SIETE conceptos, el mismo importe

    $ pnpm exec vitest run tests/components/ComposicionGananciaCard.test.tsx tests/integration/wallet-page.test.tsx
     Test Files  2 passed (2)      Tests  25 passed (25)

    $ pnpm exec vitest related --run "app/(app)/wallet/_components/ComposicionGananciaCard.tsx"
     Test Files  3 passed (3)      Tests  36 passed (36)

**Cero rojos.** Una tarjeta que enseñe «Flete ₡150 · Flete de devolución ₡150 · Comisión ₡150…»
pasa el gate entero. El total sigue cuadrando (lo manda el servidor), así que en pantalla la resta
parece correcta y los conceptos mienten: es exactamente la clase de error que esta feature existe
para impedir.

R22 pide «los INGRESOS propios **por concepto** a un lado». Un importe repetido siete veces no es
«por concepto», y su test —«R22: la tarjeta enseña ingresos, egresos y la ganancia en el pie»— no
lo verifica. `docs/verification.md`, Regla del reviewer: *un test que no verifica el requisito que
dice cubrir es hallazgo bloqueante*.

**Qué falta para cumplirlo:** un caso que empareje **rótulo con importe, fila a fila**, en la
columna de ingresos (recorriendo los hijos de la lista y comprobando que el `dd` de cada `dt` es
`money(COMPOSICION.ingresos[categoria])`), con los siete importes **distintos entre sí** —el
conjunto ya lo está— y con la mutación de arriba **medida en rojo**. La mitad de servidor ya está
cubierta a este nivel (`caja-composicion.test.ts:288-293`, «cada concepto lleva SU importe, no el
del vecino»); es la mitad de pantalla la que se quedó sin ella.

*Nota de alcance:* la columna de EGRESOS sí caza esta mutación, por accidente (`getByText` revienta
con importes repetidos), pero comparte una debilidad más suave heredada de la 45 —rótulo e importe
se afirman por separado dentro de la misma lista, así que un intercambio de dos importes entre
filas sobreviviría—. Eso es preexistente y no lo introduce esta feature: se anota, no se bloquea.

### BLOQUEANTE 2 — `tasks.md` con las 33 tasks sin marcar

`specs/231-wallet-caja-dos-bolsillos/tasks.md`: **33 líneas sin marcar, 0 marcadas**. Incluye el
Bloque 0 (T0.1/T0.2/T0.3), cuya puerta humana **sí se pasó** el 2026-08-18 y está registrada en
`progress/design_231.md` y en el `status_note` de la ficha.

`CHECKPOINTS.md` (Especificación) exige que todas las tasks estén marcadas. Es papeleo, pero es un
criterio de estado final explícito y ese fichero es la única foto de qué se ejecutó y qué no.

**Qué falta:** marcar lo ejecutado y, si algo quedó fuera, decirlo ahí en vez de dejarlo
indistinguible de lo hecho.

---

### menor 1 — `progress/history.md` no tiene entrada de la 231

`CHECKPOINTS.md` (Verificación final) la exige. Normalmente la escribe el leader al cerrar, después
de esta revisión: queda anotada como pendiente de cierre, no como defecto del implementer.

### menor 2 — mensaje informativo pintado con el token de peligro

`app/(app)/wallet/_components/CajaResumenCard.tsx:288-291` pinta `mensajeModo` con
`text-danger-strong` **para los tres modos que tienen mensaje**. Sólo `solo_tiendas` es un estado
de peligro (R16). Los otros dos son informativos:

- `solo_ordenex`: «Se entregó a las tiendas más contra-entrega del que se cobró…»
- `sin_reparto`: «No hay nada que repartir…»

y quedan en rojo sobre la superficie **neutra** `bg-muted/40`. `DESIGN.md` reserva el semántico para
estado y avisa contra usarlo como decoración; un rojo permanente en un estado normal deja de leerse
como alarma cuando de verdad la hay. El contraste está bien (`-strong` es contrast-safe sobre
superficie que gira), así que es criterio, no accesibilidad.

Ningún test mira el color de ese párrafo: los casos de `sin_reparto` y `solo_ordenex` sólo comparan
el TEXTO contra `CAJA_COMPOSICION_MENSAJE[modo]`.

### menor 3 — el barrido money-safe de R12 no cubre todas las fuentes que R12 nombra

R12 dice «ninguna fuente de cliente **nueva o tocada**». El barrido de
`CajaComposicionBarra.test.tsx:52-57` cubre 4: `BarraComposicionCaja`, `CajaResumenCard`,
`ComposicionGananciaCard` y `DesgloseEgresosLista`. Quedan fuera tres fuentes de cliente tocadas por
la feature: `WalletLedger.tsx`, `WalletModule.tsx` y `wallet-ledger-descarga-columnas.ts` (esta
última emite el monto). `wallet-labels.ts` **sí** está cubierta, por el censo transversal de la 172
(`liquidacion-money-safe.test.ts:64`).

Verificado a mano: **las tres están limpias hoy**. Lo que falta es la red, no la propiedad.

### menor 4 — `lib/utils/monto-escala-2.ts` no lo barre ninguna guardia

*(Sobre la decisión abierta, no contra ella.)* El módulo existe para **no** relajar el barrido de
`caja-tesoreria.ts`, y el argumento es correcto: debilitar una aserción de dinero de otra feature es
firma humana, no arreglo de paso. Pero el módulo nuevo no está censado en ningún sitio: hoy contiene
sólo `Decimal#toFixed(2)`, y mañana nada impide que entre ahí un `Number(`.

**Opinión técnica pedida:** mantener el módulo (opción c) y **añadirle su propio barrido** que
permita `.toFixed(` y prohíba `Number(`, `parseFloat(`, `parseInt(` e importar `decimal.js`. Así la
excepción queda acotada a tres líneas vigiladas en vez de acotada a la buena voluntad. La
alternativa (a) —ampliar el caso de `caja-tesoreria.test.ts` para admitir `Decimal#toFixed`— abre la
puerta en un módulo de 300 líneas que sí manipula dinero: peor relación coste/riesgo.

### menor 5 — sobre la otra decisión abierta (lista literal de columnas de la descarga)

`tests/unit/descarga/wallet-caja-descarga-columnas.test.ts:24-45` ganó `dueno`/«Dueño» al final de
los dos arrays literales. **Estoy de acuerdo con lo hecho y no lo cuento como defecto**: a
diferencia de D1, aquí la aserción sigue afirmando exactamente lo que su nombre dice («declara sus
columnas ENUMERADAS, en el orden de la pantalla»), y sus dos propiedades vivas —caza un reordenado y
caza una columna sin declarar— se conservan enteras. Sustituir el literal por una comparación contra
el propio componente sería *más débil*, no más fuerte. Yo lo dejaría como está.

### menor 6 — la aserción que sustituye a D1 casi no puede ponerse roja

`WalletDescarga.test.tsx:609` pasó de fijar los seis encabezados literales a
`expect(conLas173).toEqual(sinLas173)`. Como las columnas del `WalletLedger` se declaran de forma
**estática** (un `useMemo` que no depende de los datos), esa igualdad es prácticamente estructural:
sólo cae si alguien hace las columnas dependientes de las filas. No hay pérdida neta de red, porque
el caso nuevo R35 sí fija los seis encabezados anteriores **en su orden**, la longitud total (6+1) y
la posición de «Dueño» —y es más fuerte que el literal que había—. Se anota para que nadie borre el
caso R35 creyendo que la protección de la 173 vive en el otro.

### menor 7 — el copy de la tarjeta nueva no menciona lo que D2 metió dentro

La descripción de `ComposicionGananciaCard.tsx:67-70` enumera lo que entra —«fletes, comisiones,
impuestos, gastos, sueldos e indemnizaciones»— y **omite el pago a mensajeros**, que por D2 ahora SÍ
entra (sobre el libro de no-regresión: 940 de 3.940,50 de la columna). Dice bien lo que queda fuera
(el dinero de las tiendas) y calla lo que acaba de entrar. La fila se llama «Otros gastos de
Ordenex», que tampoco lo nombra. Una palabra en la descripción lo arregla.

---

## 3. La absorción del componente, comprobada aserción a aserción

`DesgloseEgresosCard.tsx` y `tests/unit/components/wallet-desglose-egresos-card.test.tsx` están
borrados; **no queda ninguna referencia colgando** en todo el árbol (comprobado). Los seis casos
viven en `tests/components/ComposicionGananciaCard.test.tsx:134-214`. Contadas contra el original
(`git show HEAD:…`), **18 aserciones antes, 18 después** — y, que es lo que el encargo pedía
verificar, la intención se sostiene en los seis:

| Caso | Qué afirmaba | Qué afirma ahora | Misma intención |
| --- | --- | --- | --- |
| «renderiza los totales por tipo y el total como STRING» (45) | 3 rótulos + 3 importes + total ₡1.251 dentro del grupo «Desglose de egresos» | idéntico, con el helper `pintarComoLa158()` que fija `totalEgresos = DESGLOSE.total` para reproducir el conjunto de la 45 | **sí**, literal |
| «pinta la fila 'Indemnizaciones' con su monto TAL CUAL» (158) | rótulo + ₡25 | idéntico | **sí** |
| «el total mostrado es el que llega del servidor» (158) | `total: "999.99"` da ₡1.000 aunque las filas sumen ₡1.251 | `totalEgresos: "999.99"` da ₡1.000, mismas filas | **sí**; cambia la clave del DTO (D2), no la afirmación |
| «un monto que no cabe en un number…» (158/230) | 12345678901.99 y 12345679127.49, acarreos en sentidos opuestos sobre once dígitos | idéntico, con `otrosEgresos: "0.00"` para no alterar la cuenta | **sí** |
| «la tarjeta ya NO se titula 'Egresos administrativos'» (158) | el `card-title` contiene «Egresos» y el contenedor no dice «Egresos administrativos» | el rótulo visible de la columna es «Egresos» y la contraprueba va ahora sobre el `container` entero | **sí**, con un matiz: pasa de fijar *dónde* está la palabra a fijar sólo que está. Sigue discriminando (otro rótulo pone el `getByText` rojo) y la contraprueba barre **más** superficie que antes |
| «dice qué entra y qué NO entra en el total» (158) | descripción con indemnizaci + «no incluye» + tienda/mensajero | las tres, sobre el copy nuevo | **sí**; y el caso propio de R29 añade `not.toMatch(/ni a mensajeros/i)`, que es la consecuencia firmada en D2 |

La extracción a `DesgloseEgresosLista` conserva `role="group"`, el `aria-label` («Desglose de
egresos»), las cuatro filas, su orden y su color. Único cambio de marcado: el total pasa de
`CardFooter` a un `div` con `border-t bg-muted/50` dentro de la misma lista —lo que antes daba la
primitiva—, porque la lista ya no vive en una Card propia. Coherente con `DESIGN.md` («Cards:
hermanas, nunca anidadas»).

---

## 4. Lo que sí está bien medido (para que no se pierda dentro del rechazo)

- **La tabla de los cuatro modos está ejecutada entera**, no razonada: los **nueve** pares de signos
  de (G, T) con su modo y su porcentaje escritos a mano (`caja-composicion.test.ts:188-219`), más la
  lectura que de verdad importa: `"0.00"` sale en tres modos y `"100.00"` en dos, así que la
  pantalla **no puede** deducir la forma de la barra del porcentaje y está obligada a leer
  `modoComposicion` (R21).
- **El redondeo se distingue de verdad**: 83.335/100.000 cae justo en el medio del tercer decimal,
  así que HALF_UP (83.34) y HALF_DOWN o truncado (83.33) dan resultados distintos. Con cualquier
  otro conjunto esa aserción no habría probado el criterio.
- **La guardia de exhaustividad se auto-comprueba en las dos direcciones** (verde sobre el catálogo
  real, roja sobre uno con categorías inventadas, y con la de terceros ignorada a propósito) y
  `otrosEgresos` se deriva por **complemento**, no por lista: una categoría de egreso propio nueva
  no puede descuadrar la columna en silencio. Es la mejor decisión de diseño de la tanda.
- **R24 tiene contraprueba real**: el doble devuelve un agregado DISTINTO a partir de la segunda
  llamada, así que «una lectura» se distingue de «dos lecturas que dieron lo mismo».
- **R30 se afirma por forma**, no por ausencia: `Object.keys(r)` es exactamente `["status"]`, con
  control de no-vacuidad (con rol autorizado el mismo camino sí trae las dos).
- **R36 barre `app/(app)/wallet/` recursivamente** con control de no-vacuidad (más de 20 fuentes) y
  persigue tanto el import de la clasificación como su reconstrucción a mano con condicionales.
- **El agujero M9 (orden por magnitud) está bien cerrado**: los importes se permutaron, la
  contraprueba mide lo que dice (el mayor no es ni el primero ni el último) y hay tres variantes de
  orden medidas en rojo. Queda anotado dentro del propio archivo.
- **Los 12 archivos de fixture mecánico son eso y nada más**: revisados uno a uno, sólo rellenan los
  campos nuevos de los DTO literales. **Ninguna aserción se debilitó en ellos.**
- Ningún test de la feature tiene la forma `if (!datos) return;`, ni `skip`, ni `only`, ni `todo`
  (comprobado en los cinco archivos nuevos).

---

## 5. Veredicto

**RECHAZADO.**

Vuelve al implementer con dos cosas, y nada más:

1. **BLOQUEANTE 1** — un caso que empareje rótulo con importe, fila a fila, en la columna de
   INGRESOS de `ComposicionGananciaCard`, con la mutación
   `valor={composicion.ingresos[categoria]}` a `valor={composicion.ingresos.ingreso_flete}`
   **medida en rojo** y pegada en `progress/impl_231.md`.
2. **BLOQUEANTE 2** — marcar como hechas las tasks de
   `specs/231-wallet-caja-dos-bolsillos/tasks.md`.

Los 7 menores no son condición para el OK. Los que yo movería igualmente por baratos son el **2**
(el rojo del mensaje informativo: dos entradas de un Record) y el **7** (una palabra en el copy). El
**4** y el **5** son opinión sobre las dos decisiones que esperan firma humana.

Al cerrar, el leader tiene pendiente la entrada en `progress/history.md` (menor 1) y pasar la ficha
a `done` en `feature_list.json` (hoy `in_progress`; con la 230 son 2 en la zona `fullstack`, justo
en el tope que `./init.sh` valida).
