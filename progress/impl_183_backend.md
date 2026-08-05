# Feature 183 — bitácora del BACKEND (bloques A, B, C y D · T0–T11)

> Rama `feature/183-neto-bruto-caja`. Ejecutado por `backend_dev`.
> **Alcance:** T0–T11. `app/**` y `components/**` NO se tocan: son T12–T14 (`frontend_dev`).
> **Lo que manda:** `progress/decision_183.md` (⟨D12⟩, humano, 2026-08-04, CERRADA) y las
> cuatro preguntas de la puerta, cerradas el mismo día a su default (P1=(a) el bruto es
> volumen movido · P2=(a) · P3=(a) · P4=(a)).

---

## 1. Qué se hizo, por tarea

### T0 — Puerta

Leídos `progress/decision_183.md` entero, `requirements.md`, `design.md` y `tasks.md`.
Confirmado que la `status_note` de la ficha 183 («retirar en las CUATRO, y NO que `egresos`
gane `ingreso_ajuste`») está **superada** por ⟨D12⟩ y no se sigue. Las cuatro preguntas
constan cerradas por el leader. No se re-litiga nada.

### T1 — `ImporteAnalitico` pasa a unión discriminada por `forma`

`lib/types/analitica-financiera.ts`:

- `ImporteConNeto` (`forma: "bruto_y_neto"`, `bruto`, `neto`, `moneda`).
- `ImporteSoloBruto` (`forma: "solo_bruto"`, `bruto`, `moneda`) — **sin `neto`, ni en `null`**.
- `ImporteAnalitico = ImporteConNeto | ImporteSoloBruto`.
- Cabecera ⟨D1⟩/R37 (`:15-17`) y el comentario del tipo actualizados: declaran la acotación y
  citan ⟨D12⟩ con su fecha. El bloque nuevo explica **por qué la unión y no `neto?: string`**.
- `VistaFinanciera.total` gana la nota de R18 (una vista, una forma) apuntando a su guardia.
- **NO** se tocaron `IDS_FINANCIERAS_SERVIDAS`, `IDS_FINANCIERAS_ACUMULADAS` ni
  `esMetricaAcumulada`. El archivo no importa nada nuevo.

`pnpm run typecheck` quedó rojo aquí a propósito. Los consumidores rotos son **seis**, los que
`design.md §3.2` predijo, y están listados en §5 de este documento.

### T2 — Test de forma del contrato

`tests/unit/analytics/financiera-contratos.test.ts`, bloque R37 **dado vuelta** (R25, no
borrado): sigue exigiendo los dos campos en `ImporteConNeto` y se añaden tres casos:

- `R2/183 · leer el `neto` de un importe que no lo publica NO COMPILA` — `@ts-expect-error`
  sobre `soloBruto.neto`, más la comprobación en runtime de que la clave no se serializa.
- `R2/183 · escribir un `neto` en un importe `solo_bruto` tampoco compila`.
- `R18/183 · la union DISCRIMINA` — `switch` sobre `forma` con `const imposible: never`, sin
  rama por defecto.

Las fixtures de `COD_RECAUDADO_EJEMPLO` ganan el discriminante.

### T3 — `egresos` gana `ingreso_ajuste` y su descripción

`lib/analytics/metrics.ts`, **solo** dentro de la entrada `egresos`, exactamente cuatro cosas:

1. `definicion.categorias` 8 → **9**, con `ingreso_ajuste` **al final** y sin reordenar las ocho.
2. La `descripcion`, con la cláusula del descuento de anulaciones (texto de `design.md §4`,
   con paréntesis en vez de rayas para no meter caracteres nuevos en el catálogo).
3. Un comentario que cita `progress/decision_183.md` y escribe **2026-08-04**, con el motivo y
   la medición de producción.
4. La prosa de `:493` («Σ de las ocho categorías `egreso_*`») corregida.

Las tres entradas de Q1 **no se tocaron**: su retirada del neto vive en el contrato y en el
servicio, no en el catálogo.

### T4 — Las cuatro aserciones de «ocho categorías», dadas vuelta + el fixture de descripción

- `metrics-caja-naturaleza.guardia.test.ts` — el caso «y NO gana el reverso … ni ningún
  ingreso: eso es territorio de la 175» pasa a `gana `ingreso_ajuste` y NADA mas: el reverso
  del pago a tienda sigue fuera`. Afirma las **nueve**, enumera las **ocho históricas enteras**
  (sustituir una en vez de añadirla se ve), mantiene que `ingreso_reverso_pago_tienda` y
  `ingreso_cod_recaudado` quedan fuera, que `tercerosDeclaradasPor("egresos")` sigue siendo
  `["egreso_pago_tienda"]` (R51/173 intacto) y que `ingreso_ajuste` sigue siendo `propio`.
- `financiera-produccion.guardia.test.ts` — nueve, conservando el lado que protege (recortar
  la definición encoge la cifra).
- `analitica-financiera-service.test.ts` — `toHaveLength(9)` + `ingreso_ajuste` presente +
  R10 (id, etiqueta, granos, fuente, estadoProduccion sin cambios).
- **Bloque R53/R54 ampliado**: `DESCRIPCION_EGRESOS_PRE_183` como fixture literal, predicado
  `declaraElDescuentoDe183` (cuatro piezas: desde cuándo/qué feature · la anulación se
  descuenta · nombra `ingreso_ajuste` · el bruto cuenta los dos movimientos —P1—) y el caso
  que demuestra que el **texto pre-183 NO lo pasa** y que **sí pasa todos los demás guardias
  de descripción del repo**.

### T5 — Guardia catálogo↔decisión

`catalogo-produccion.guardia.test.ts` queda verde **por construcción**: el bloque de `egresos`
cita ahora tres decisiones (⟨D8⟩ 2026-08-02, ⟨P4⟩ 2026-08-03, ⟨D12⟩ 2026-08-04) y las tres
fechas están respaldadas por documentos que el propio bloque cita. `progress/decision_183.md`
no contiene ninguna línea con `declarada` y `producida` a la vez (comprobado con `grep`), así
que no añade obligación nueva. Las dos mutaciones de §3 lo confirman.

### T6 — `deCaja` recibe la forma; el despacho la elige

`lib/services/AnaliticaFinancieraService.ts`:

- `importe()` → **`importeConNeto()`** e **`importeSoloBruto()`**. Siguen siendo los únicos dos
  sitios que escriben `moneda` (S2/R29 intacto; lo comprueba el censo de literales de moneda
  de `analitica-financiera-service.test.ts`, verde).
- `deCaja(consulta, forma)` con `forma: "solo_bruto" | "bruto_y_neto"`.
- El despacho usa **selectores explícitos** `cajaSoloBruto` / `cajaConNeto`, sin ningún `if`
  por id dentro del manejador (precedente de la 173, dos líneas más abajo en el mismo mapa).
- `derivarBalance` **solo se llama para `egresos`**. Ni una resta de dinero escrita en el
  servicio.
- Prosa actualizada: cabecera R20/R27 (`:46-53`), comentario del despacho (`:136-137`) y
  docstring de `deCaja` (`:199-211`), que ahora declara P1 (el bruto es volumen movido).

### T7 — Los dobles imposibles, reexpresados con el par real

`tests/unit/services/analitica-financiera-derivacion.test.ts`:

- El caso del neto negativo se traslada a `egresos` con dos filas **legales**
  (`ingreso_ajuste`/`ingreso` 1000 + `egreso_gasto`/`egreso` 1500) → neto `-500.00`, y el espía
  sobre `derivarBalance` sigue afirmando `[["1000","1500"]]`.
- El caso de cancelación pasa a `R7/183 · el par REAL egreso + su anulacion` con
  `egreso_gasto`/`egreso` 400 + `ingreso_ajuste`/`ingreso` 400 → neto `"0.00"`, bruto `"800.00"`.
- **Bloque nuevo** `R1 · las tres metricas homogeneas de prefijo no publican neto ⟨D12⟩`: tres
  casos (uno por métrica de Q1) que comprueban sobre el **objeto serializado** que las claves
  son exactamente `["forma","bruto","moneda"]` y que el DTO no contiene `"neto"`; más
  `R8 · a `derivarBalance` no se le pide una resta contra cero: no se la llama`, que también
  afirma que a `egresos` **sí** se la sigue llamando.
- El barrido R27 («ningún importe es `number`») ramifica ahora por `forma`, no por id.

Ninguna fixture de este archivo contiene ya una combinación categoría↔tipo que el `CHECK` de
la 173 rechace.

### T8 — El repositorio: el `WHERE` lleva las nueve

`tests/unit/analytics/financiera-ingresos-repo.test.ts`:

- `` `egresos` ve sus NUEVE categorias, y el WHERE emitido las lleva (R5/183) `` — inspecciona
  `fake.llamadas[0].args.where.categoria.in` y afirma las nueve **en orden**, más lo que no
  lleva. Es el nivel donde la traducción a SQL existe: un doble de servicio no la ve.
- La fila cruzada `egreso_ajuste`+`tipo: ingreso` se sustituye por el **par real**.
- **Caso nuevo de R17 sobre `egresos`** (ver §3, mutación 23: el único mutante que sobrevivió).

`lib/repositories/IngresosAnaliticaRepository.ts` **no cambia de código**, solo de prosa
(`:69-82`). `lib/interfaces/repositories/IIngresosAnaliticaRepository.ts:26-40` actualizado: el
desglose por `tipo` sigue existiendo, pero ya no para las cuatro.

### T9 — La cifra no se mueve: integración contra Postgres

`tests/integration/actions/analitica-financiera-action.test.ts` (con `DATABASE_URL` alcanzable;
los 15 casos corrieron de verdad, no se saltaron):

- **F.4(b) dado vuelta**: «el contraasiento REAL … **SI** entra en `egresos`: bruto 800, neto
  0.00», comprobando además las **dos filas en el libro** por categoría y tipo.
- **El comentario `:402-427` corregido, no borrado**: la frase «el neto 0 **no** es alcanzable
  con datos legales» se conserva citada y se explica por qué su premisa dejó de valer para
  `egresos` con ⟨D12⟩ (y por qué **sigue valiendo** para las tres de Q1).
- **F.4(c) nuevo**: el censo real de producción del 2026-08-04 (4 × `egreso_pago_mensajero` =
  22.000,00 + 1 × `egreso_indemnizacion` = 42,40, cero ajustes en las dos direcciones), sembrado
  en transacción revertida y ventana de 2031 → `bruto "22042.40"` / `neto "-22042.40"`.
- **F.4(b bis) nuevo** (evidencia dura de R24): la fila con la que los dobles viejos afirmaban
  (`egreso_ajuste` + `tipo: ingreso`) **es rechazada por la base**. La premisa de R24 se mide
  contra Postgres, no de memoria.
- F.1 «lo sembrado se ve» dado vuelta: ya no afirma `neto === bruto` para `ingreso_flete`;
  afirma la **forma** (`solo_bruto`) y que el JSON no lleva `neto`.

### T10 — Guardia de forma por vista

Archivo nuevo `tests/unit/analytics/financiera-forma-importe.guardia.test.ts` (4 casos):

- el censo mira las **diez** servidas y el esperado las cubre sin sobrar ninguna, contrastado
  contra el catálogo (dos fuentes independientes);
- `R14 · la forma de las diez es EXACTAMENTE la declarada` — mapa escrito a mano: las tres de
  Q1 `solo_bruto`, las siete restantes `bruto_y_neto`, `conciliacion_cierres` `sin_importes`;
- `R18 · dentro de una vista, el total y TODAS sus filas comparten forma`, con sanidad de que
  el fixture produce vistas **y filas** (si no, R18 pasaría por vacío);
- autocomprobación del detector contra una vista sintética que mezcla.

### T11 — Cierre de backend

- Barrido de prosa en `lib/**`: **cero** cabeceras que sigan afirmando «las ocho categorías
  `egreso_*`» como estado actual o «los DOS importes de las cuatro métricas de caja». Las tres
  coincidencias que quedan son legítimas: `metrics.ts:503` («eran las ocho *hasta la 183*»,
  histórico) y dos «las cuatro métricas» en el repositorio y su interfaz, que se refieren a
  **cuántas métricas sirve ese repositorio** —siguen siendo cuatro— y no a los importes.
- `./init.sh --rapido` **no se corrió**: el gate lo corre el leader, y además typecheck no
  puede quedar verde hasta que aterrice el bloque E (ver §5).

---

## 2. Archivos creados / modificados

| Archivo | Qué |
|---|---|
| `lib/types/analitica-financiera.ts` | unión discriminada + cabecera ⟨D1⟩/R37 acotada + nota R18 |
| `lib/analytics/metrics.ts` | `egresos`: 9 categorías, descripción, comentario ⟨D12⟩, prosa `:493` |
| `lib/services/AnaliticaFinancieraService.ts` | dos constructores de importe, `deCaja(c, forma)`, despacho con selector, prosa |
| `lib/repositories/IngresosAnaliticaRepository.ts` | **solo prosa** (`:69-82`) |
| `lib/interfaces/repositories/IIngresosAnaliticaRepository.ts` | prosa del desglose por `tipo`, acotada por ⟨D12⟩ |
| `tests/unit/analytics/financiera-contratos.test.ts` | R37 dado vuelta + 3 casos de R2/R18 |
| `tests/unit/analytics/financiera-ingresos-repo.test.ts` | nueve en el `WHERE`, par real, caso R17 sobre `egresos` |
| `tests/unit/analytics/metrics-caja-naturaleza.guardia.test.ts` | nueve categorías + fixture pre-183 + `declaraElDescuentoDe183` |
| `tests/unit/analytics/financiera-produccion.guardia.test.ts` | nueve categorías |
| `tests/unit/analytics/financiera-forma-importe.guardia.test.ts` | **nuevo** (T10) |
| `tests/unit/services/_dobles-analitica-financiera.ts` | helpers `conNeto` / `soloBruto` que **afirman** la forma |
| `tests/unit/services/analitica-financiera-derivacion.test.ts` | par real, bloque R1 nuevo, R8 |
| `tests/unit/services/analitica-financiera-service.test.ts` | nueve categorías, R10, lecturas estrechadas |
| `tests/integration/actions/analitica-financiera-action.test.ts` | F.4(b) dado vuelta, F.4(b bis) y F.4(c) nuevos, comentario corregido |

**Cero cambios en `db/`, `prisma/`, RLS o datos** (R16). Comprobado:
`git diff --name-only 64957dca..HEAD -- db/ prisma/` → vacío.

Commits (uno por bloque):

```
c4be0a74 feat(183/A): ImporteAnalitico pasa a union discriminada por `forma`
fd58bd60 feat(183/B): `egresos` gana `ingreso_ajuste` y lo declara en su descripcion
f7953f66 feat(183/C): `deCaja` recibe la forma y el despacho la elige
e3fd1a1d test(183/C): R17 tambien se mide sobre `egresos`, no solo sobre `ingreso_flete`
```

---

## 3. Mutaciones: **25 aplicadas, 25 muertas** (1 sobrevivió a la primera y obligó a rehacer el test)

Cada mutación se aplicó **de verdad** al código, se corrieron los tests relacionados y se
revirtió con `git checkout --`. Salida real pegada.

### M1 · R1 — las tres de Q1 vuelven a publicar `neto` (= bruto)
`ingreso_flete: cajaSoloBruto` → `cajaConNeto`.

```
     × R14 · la forma de las diez es EXACTAMENTE la declarada 12ms
     × el DTO SERIALIZADO de `ingreso_flete` no lleva la clave `neto`, ni vacia ni en null 6ms
     × R8 · a `derivarBalance` no se le pide una resta contra cero: no se la llama 2ms
     × 0.10 + 0.20 da exactamente 0.30, no 0.30000000000000004 1ms
AssertionError: expected { cod_recaudado: 'bruto_y_neto', …(9) } to deeply equal { ingreso_flete: 'solo_bruto', …(9) }
AssertionError: expected [ 'forma', 'bruto', 'neto', 'moneda' ] to deeply equal [ 'forma', 'bruto', 'moneda' ]
 Test Files  2 failed (2)
      Tests  4 failed | 16 passed (20)
```
**MUERTA.**

### M2 · R2 — el `neto` pasa a campo **opcional** en el tipo compartido
`ImporteSoloBruto` gana `readonly neto?: string`.

```
tests/unit/analytics/financiera-contratos.test.ts(217,7): error TS2578: Unused '@ts-expect-error' directive.
tests/unit/analytics/financiera-contratos.test.ts(251,5): error TS2578: Unused '@ts-expect-error' directive.
```
**MUERTA** — exactamente como R2 lo describe: `typecheck` delata las directivas no usadas.

### M3 · R3 (literal) — el `bruto` de Q1 pasa a ser `derivarBalance(...)`

```
     × R8 · a `derivarBalance` no se le pide una resta contra cero: no se la llama 7ms
 Test Files  1 failed | 2 passed (3)
      Tests  1 failed | 34 passed (35)
```
**MUERTA**, pero con una observación que hay que dejar escrita: **ninguna aserción de valor se
movió**. No es un hueco: para las tres de Q1 con datos legales `Σ egreso = 0`, así que
`derivarBalance` es la identidad sobre el bruto — es *la premisa entera* de ⟨D12⟩ §2. La
mutación es un mutante **equivalente en valor**, y lo que la mata es la afirmación de que la
función **no se llama**. Por eso se ejecutó además M4.

### M4 · R3 (b) — el `bruto` deja de ser la Σ **sin signo** de las filas
`const bruto = sumar(...)` → `sumaDeTipo(filas, "egreso")`.

```
     × R7/183 · el par REAL egreso + su anulacion: neto 0.00 y bruto 2 × monto 6ms
     × el DTO SERIALIZADO de `ingreso_flete` no lleva la clave `neto`, ni vacia ni en null 2ms
     × el DTO SERIALIZADO de `ingreso_comision_cod` … / `ingreso_iva` …
     × 0.10 + 0.20 da exactamente 0.30, no 0.30000000000000004 1ms
     × un total de siete digitos no pierde centimos 1ms
     × F.1 · lo sembrado se ve: la caja devuelve exactamente lo insertado en el rango 20ms
     × F.2 · 22:00 CR y 00:30 CR caen en dias DISTINTOS aunque el UTC diga lo mismo 8ms
     × F.2 · el corte por `hasta` es exclusivo: 06:00Z exacto es del dia siguiente 5ms
     × F.4(b) · el contraasiento REAL de un gasto SI entra en `egresos`: bruto 800, neto 0.00 14ms
 Test Files  2 failed | 1 passed (3)
      Tests  10 failed | 50 passed (60)
```
**MUERTA** (10 casos, unitarios y contra Postgres).

### M5 · R4 — se aprovecha el PR para tocar la lista de `ingreso_flete`

```
     × y siguen declarando exactamente las categorias con las que la 127 las publico 6ms
AssertionError: expected [ 'ingreso_flete', …(2) ] to deeply equal [ 'ingreso_flete', …(1) ]
      Tests  1 failed | 20 passed (21)
```
**MUERTA** (guardia R51 de la 173).

### M6 · R5 — **sustituir** una `egreso_*` por `ingreso_ajuste` en vez de añadirla

```
     × `egresos` sigue declarando las NUEVE categorias que esa cifra tiene que sumar 8ms
     × gana `ingreso_ajuste` y NADA mas: el reverso del pago a tienda sigue fuera 6ms
     × `egresos` ve sus NUEVE categorias, y el WHERE emitido las lleva (R5/183) 6ms
     × y la consulta que las excluye devuelve filas, no una lista vacia 1ms
     × el catalogo declara las NUEVE categorias que esa cifra tiene que sumar 6ms
 Test Files  4 failed (4)
      Tests  5 failed | 65 passed (70)
```
**MUERTA**, y por los dos lados que R5 pide: la lista histórica y el `WHERE` emitido.

### M7 · R6 — a `egresos` se le aplica la retirada de Q1

```
     × R14 · la forma de las diez es EXACTAMENTE la declarada 13ms
     × un rango con mas egresos que ingresos da un neto NEGATIVO, el de la funcion 4ms
     × R7/183 · el par REAL egreso + su anulacion: neto 0.00 y bruto 2 × monto 1ms
     × R8 · a `derivarBalance` no se le pide una resta contra cero: no se la llama 4ms
     × y en `egresos`, que si publica neto, tampoco hay coma flotante 0ms
     × una `egreso_indemnizacion` en el rango entra en la cifra 5ms
     × F.4(a) · dos egresos en el mismo rango: bruto 800, neto -800 (el neto lleva SIGNO) 7ms
     × F.4(b) · el contraasiento REAL de un gasto SI entra en `egresos`: bruto 800, neto 0.00 12ms
     × F.4(c) · el censo REAL de produccion (sin anulaciones) no mueve la cifra: 22042.40 11ms
Error: egresos / total: se esperaba forma "bruto_y_neto" y llego "solo_bruto"
      Tests  9 failed | 55 passed (64)
```
**MUERTA.** Matiz honesto: R6 la describe como «no compila». Aquí muere **en ejecución**, con
un mensaje que nombra la métrica y las dos formas, porque el tipo de retorno del servicio es
`ResultadoFinanciero` para las diez y la forma no se puede fijar por métrica en el tipo. Los
helpers `conNeto`/`soloBruto` **afirman** la forma en vez de hacer un `as`, que es lo que
convierte el fallo silencioso en un rojo con nombre.

### M8 · R7 — la definición se queda en **ocho** categorías
Contra la integración:
```
     × F.4(b) · el contraasiento REAL de un gasto SI entra en `egresos`: bruto 800, neto 0.00 19ms
AssertionError: expected '400.00' to be '800.00' // Object.is equality
      Tests  1 failed | 30 passed (31)
```
La misma mutación, contra repositorio y guardias:
```
     × `egresos` sigue declarando las NUEVE categorias que esa cifra tiene que sumar 5ms
     × `egresos` ve sus NUEVE categorias, y el WHERE emitido las lleva (R5/183) 6ms
     × el material del bruto y del neto llega desglosado por tipo (R37) 3ms
     × y la consulta que las excluye devuelve filas, no una lista vacia 1ms
     × gana `ingreso_ajuste` y NADA mas: el reverso del pago a tienda sigue fuera 6ms
     × el catalogo declara las NUEVE categorias que esa cifra tiene que sumar 6ms
      Tests  6 failed | 64 passed (70)
```
**MUERTA.** Dato que conviene registrar: el caso **unitario** `R7/183` **no** se pone rojo con
esta mutación, porque el doble de servicio devuelve las filas que le pidan y no consulta el
catálogo. Es la trampa documentada: la definición se mide en el repositorio y contra Postgres,
no con dobles de servicio. Por eso R5 y R9 exigen los tres niveles.

### M9 · R8-1 — la resta se escribe **a mano** en el servicio

```
     × un rango con mas egresos que ingresos da un neto NEGATIVO, el de la funcion 6ms
     × R8 · a `derivarBalance` no se le pide una resta contra cero: no se la llama 1ms
AssertionError: expected [] to deeply equal [ [ '1000', '1500' ] ]
AssertionError: expected [] to deeply equal [ [ '1005', '0' ] ]
      Tests  2 failed | 14 passed (16)
```
**MUERTA** — el espía no registra la llamada, que es lo único que una reimplementación no puede
fingir (el número sale igual).

### M10 · R8-2 — el neto se publica en **valor absoluto**

```
     × un rango con mas egresos que ingresos da un neto NEGATIVO, el de la funcion 5ms
     × y en `egresos`, que si publica neto, tampoco hay coma flotante 1ms
     × una `egreso_indemnizacion` en el rango entra en la cifra 6ms
     × F.4(a) · dos egresos en el mismo rango: bruto 800, neto -800 (el neto lleva SIGNO) 9ms
     × F.4(c) · el censo REAL de produccion (sin anulaciones) no mueve la cifra: 22042.40 11ms
AssertionError: expected '750.00' to be '-750.00' // Object.is equality
AssertionError: expected '22042.40' to be '-22042.40' // Object.is equality
      Tests  5 failed | 55 passed (60)
```
**MUERTA** — el signo se conserva (P3, ratificada).

### M11 · R9-a — se **invierte** el orden de la resta del neto

```
     × un rango con mas egresos que ingresos da un neto NEGATIVO, el de la funcion 5ms
     × R8 · a `derivarBalance` no se le pide una resta contra cero: no se la llama 3ms
     × F.4(a) · dos egresos en el mismo rango: bruto 800, neto -800 (el neto lleva SIGNO) 10ms
     × F.4(c) · el censo REAL de produccion (sin anulaciones) no mueve la cifra: 22042.40 10ms
AssertionError: expected '22042.40' to be '-22042.40' // Object.is equality
AssertionError: expected [ [ '0', '1005' ] ] to deeply equal [ [ '1005', '0' ] ]
      Tests  5 failed | 26 passed (31)
```
**MUERTA** por el censo de producción, que es donde R9 la nombra.

### M12 · R9-b — el `ingreso_ajuste` entra **restando** en el bruto

```
     × F.4(b) · el contraasiento REAL de un gasto SI entra en `egresos`: bruto 800, neto 0.00 16ms
AssertionError: expected '0.00' to be '800.00' // Object.is equality
      Tests  1 failed | 14 passed (15)
```
**MUERTA** por F.4(b). Nota honesta: **F.4(c) sigue verde** con esta variante, y tiene que
seguirlo: el censo de producción no tiene ni una fila de ingreso, así que restarlas no mueve la
cifra. Es el reparto correcto de trabajo entre los dos casos —(c) vigila la no-regresión, (b)
vigila la aritmética del par— y por eso hacen falta los dos.

### M13 · R10-a — se toca la `etiqueta` de `egresos`
```
     × el catalogo declara las NUEVE categorias que esa cifra tiene que sumar 6ms
AssertionError: expected 'Salidas de caja' to be 'Egresos' // Object.is equality
```
### M14 · R10-b — se toca la `fuente` de `egresos`
```
     × el catalogo declara las NUEVE categorias que esa cifra tiene que sumar 7ms
AssertionError: expected { tipo: 'ledger', tablas: [ …(2) ] } to deeply equal { tipo: 'ledger', …(1) }
```
**MUERTAS** las dos.

### M15 · R11 — se **borra la cláusula nueva**: la descripción vuelve al texto pre-183

La guardia específica:
```
     × R11/183 · la de `egresos` dice que DESDE LA 183 la anulacion se DESCUENTA de la cifra 4ms
     × y la asercion discrimina: el texto PRE-183 no la pasa, aunque ya hablaba de ajustes 2ms
AssertionError: no dice desde cuando ni por que feature: expected 'salidas de la caja principal (pagos a…' to match /(desde|a partir de)[^.;]*\b183\b/
      Tests  2 failed | 19 passed (21)
```
Y la red que **no** sirve, con la misma mutación aplicada (`metrics.test.ts` + los dos guardias
de catálogo):
```
 Test Files  3 passed (3)
      Tests  63 passed (63)
```
**MUERTA**, y medida la razón por la que el fixture pre-183 es obligatorio: sin él, borrar la
frase dejaba **63 casos verdes** y ni un rojo. Es literalmente el defecto de la 173.

### M16 · R12-a — se cambia la definición **sin citar** la decisión (queda la fecha huérfana)
```
     × todo cambio de `estadoProduccion` cita una decision humana registrada en `progress/` 8ms
AssertionError: egresos cita la fecha 2026-08-04, que no aparece en ninguna de las decisiones
que el propio bloque cita (decision_F2_173.md, decision_C2_127.md)
```
### M17 · R12-b — se cita una **fecha que el documento no lleva** (2026-09-30)
```
AssertionError: egresos cita la fecha 2026-09-30, que no aparece en ninguna de las decisiones
que el propio bloque cita (decision_F2_173.md, decision_183.md, decision_C2_127.md)
```
**MUERTAS** las dos: la guardia queda verde **por construcción**, no por exención.

### M18 · R13 — `ingreso_ajuste` se reclasifica como `terceros` «para que no cuente»
```
     × R2 (design §2.1): las TRES categorias de tesoreria son de TERCEROS, y ninguna otra lo es 6ms
     × R26 (design §10-C): `ingreso_ajuste` es PROPIO, y por eso NO puede servir de reverso 3ms
     × el fixture no es inocuo: el Record SI clasifica categorias como terceros 6ms
     × declara UNA sola categoria de terceros, y es el pago a la tienda 1ms
     × gana `ingreso_ajuste` y NADA mas: el reverso del pago a tienda sigue fuera 1ms
     × `ganancia_ordenex` declara EXACTAMENTE las de naturaleza propio, y ni una de terceros 1ms
      Tests  6 failed | 39 passed (45)
```
**MUERTA.**

### M19 · R14-a — la retirada se **generaliza** a las dos métricas de tesorería
```
     × R14 · la forma de las diez es EXACTAMENTE la declarada 13ms
     × `dinero_en_caja` es entradas − salidas, con el dinero de terceros dentro 7ms
     × `ganancia_ordenex` deja fuera el dinero de terceros: 730, no 2930 1ms
     × las dos cifras son DISTINTAS sobre el mismo libro, y esa diferencia es el punto 1ms
     × R51 en el servicio: anadir contra-entrega NO mueve la ganancia y SI mueve la caja 1ms
     × un libro sin dinero de terceros hace coincidir las dos, y eso es correcto (R6) 0ms
```
### M20 · R14-b — la retirada se generaliza a `cuenta_por_pagar_mensajero`
```
     × el neto es el que la funcion compartida devuelve, y la funcion se llamo 4ms
     × R14 · la forma de las diez es EXACTAMENTE la declarada 13ms
Error: cuenta_por_pagar_mensajero / total: se esperaba forma "bruto_y_neto" y llego "solo_bruto"
```
**MUERTAS** las dos: la guardia de T10 ve «una de menos», que es como R14 lo pide.

### M21 · R15-a — se añade un id auxiliar al despacho
```
     × falla por EXCESO: el servicio no inventa ningun id que el catalogo no tenga 7ms
     × y los dos conjuntos son el mismo, comparados de una vez 1ms
     × con los ids REALES: quitar uno se detecta, y anadir uno inventado tambien 1ms
AssertionError: el servicio despacha ids que no existen en el catalogo: expected [ 'egresos_neto_aux' ] to deeply equal []
```
### M22 · R15-b — se añade un id al registro del contrato
```
     × el registro de ids servidos coincide con las diez financieras del catalogo 6ms
     × el registro de ids servidos cubre las diez financieras del catalogo 6ms
     × el censo mira las DIEZ servidas y el esperado las cubre todas, sin sobrar ninguna 7ms
```
**MUERTAS** las dos.

### M23 · R17 (1.ª pasada) — las nueve categorías se **clavan** en el repositorio
`if (consulta.metrica.id === "egresos") return [ …las nueve… ]`.

```
 Test Files  1 passed (1)
      Tests  15 passed (15)
```
**SOBREVIVIÓ.** Hallazgo real: el único caso que medía «el catálogo manda» alteraba
`ingreso_flete.definicion.categorias`, y la métrica que esta feature cambia es otra. Un guardia
que no cubre la métrica que la feature toca no es un guardia. **Test rehecho**: caso nuevo
`y lo mismo sobre `egresos`, que es LA definicion que la 183 cambio (R17/183)`, que altera
`egresos.definicion.categorias` en memoria y afirma sobre el `where` **emitido** además de
sobre el resultado.

### M24 · R17 (2.ª pasada, con el caso nuevo) — la misma mutación
```
     × y lo mismo sobre `egresos`, que es LA definicion que la 183 cambio (R17/183) 5ms
AssertionError: expected [ 'egreso_pago_tienda', …(8) ] to deeply equal [ 'egreso_indemnizacion' ]
      Tests  1 failed | 15 passed (16)
```
**MUERTA.**

### M25 · R18 — una vista con el **total** en una forma y las **filas** en otra
```
     × R14 · la forma de las diez es EXACTAMENTE la declarada 13ms
     × R18 · dentro de una vista, el total y TODAS sus filas comparten forma 2ms
+   "cod_recaudado": "mezcla:bruto_y_neto+solo_bruto",
AssertionError: cod_recaudado / cod_recaudado__por_tienda: la vista mezcla formas entre su total
y sus filas: expected [ 'bruto_y_neto', 'solo_bruto' ] to have a length of 1 but got 2
```
**MUERTA.**

**Resumen: 25 mutaciones aplicadas · 24 muertas en la primera medición · 1 superviviente (M23,
R17) que obligó a rehacer el test y murió en la segunda (M24).**

---

## 4. Mapa R → test (construido **leyendo el caso citado**)

No se contó ninguna mención `R\d+` en títulos: esa técnica cruza espacios de nombres entre
features (los `R14`, `R18`, `R37` de la 127/132/173 conviven con los de la 183 en los mismos
archivos) y ya produjo un falso 68/68 en este repo. Cada fila de abajo cita el **nombre exacto
del caso** y lo que ese caso comprueba de verdad.

| R | Archivo · caso | Qué comprueba |
|---|---|---|
| **R1** | `tests/unit/services/analitica-financiera-derivacion.test.ts` · «el DTO SERIALIZADO de \`ingreso_flete\` / \`ingreso_comision_cod\` / \`ingreso_iva\` no lleva la clave \`neto\`, ni vacia ni en null» (3 casos) | `Object.keys` del total serializado = `["forma","bruto","moneda"]` y el JSON del DTO no contiene `"neto"`. Complemento contra Postgres: `tests/integration/actions/analitica-financiera-action.test.ts` · «F.1 · lo sembrado se ve» |
| **R2** | `tests/unit/analytics/financiera-contratos.test.ts` · «R2/183 · leer el \`neto\` de un importe que no lo publica NO COMPILA» y «R2/183 · escribir un \`neto\` en un importe \`solo_bruto\` tampoco compila» | dos `@ts-expect-error`; con `neto?: string` se vuelven directivas no usadas y `typecheck` cae (medido, M2) |
| **R3** | mismo archivo que R1 · los tres casos afirman `bruto === "1005.00"`; + «0.10 + 0.20 da exactamente 0.30…» y «un total de siete digitos no pierde centimos»; + integración «F.1» (1500.00) y «F.2» (300/700/500) | el bruto vale lo mismo que antes de la feature. Ver M3/M4: la mutación literal es equivalente en valor para Q1 y muere por el espía de R8; la que sí cambia el valor mata 10 casos |
| **R4** | `tests/unit/analytics/metrics-caja-naturaleza.guardia.test.ts` · «y siguen declarando exactamente las categorias con las que la 127 las publico» | las listas de las tres de Q1, comparadas literalmente (2 / 1 / 3 categorías) |
| **R5** | `tests/unit/analytics/financiera-ingresos-repo.test.ts` · «\`egresos\` ve sus NUEVE categorias, y el WHERE emitido las lleva (R5/183)» | **nivel repositorio**: `fake.llamadas[0].args.where.categoria.in` = las nueve en orden, `toHaveLength(9)`, y no lleva las de terceros. Complementos: `metrics-caja-naturaleza.guardia` · «gana \`ingreso_ajuste\` y NADA mas…» (las ocho históricas enteras), `financiera-produccion.guardia` · «\`egresos\` sigue declarando las NUEVE…», `analitica-financiera-service.test.ts` · «el catalogo declara las NUEVE categorias…» |
| **R6** | `tests/unit/services/analitica-financiera-service.test.ts` · «una \`egreso_indemnizacion\` en el rango entra en la cifra» (lee el neto vía `conNeto`, que afirma la forma) + `financiera-forma-importe.guardia.test.ts` · «R14 · la forma de las diez es EXACTAMENTE la declarada» | `egresos` publica `bruto` **y** `neto` |
| **R7** | `analitica-financiera-derivacion.test.ts` · «R7/183 · el par REAL egreso + su anulacion: neto 0.00 y bruto 2 × monto» + integración · «F.4(b) · el contraasiento REAL de un gasto SI entra en \`egresos\`: bruto 800, neto 0.00» | par real (`egreso_gasto`/`egreso` + `ingreso_ajuste`/`ingreso`) → `neto "0.00"`, `bruto "800.00"`, con las dos filas comprobadas en el libro |
| **R8** | `analitica-financiera-derivacion.test.ts` · «un rango con mas egresos que ingresos da un neto NEGATIVO, el de la funcion» (espía: `argumentosDe(espiaBalance)` = `[["1000","1500"]]`, neto `-500.00`) y «R8 · a \`derivarBalance\` no se le pide una resta contra cero: no se la llama» | el neto lo produce `derivarBalance`, la resta no está reescrita, y el signo se conserva |
| **R9** | integración · «F.4(c) · el censo REAL de produccion (sin anulaciones) no mueve la cifra: 22042.40» | censo de ⟨D12⟩ §3 sembrado en transacción revertida (4+1 filas, cero ajustes, comprobado por `groupBy`) → `bruto "22042.40"` / `neto "-22042.40"` contra Postgres |
| **R10** | `analitica-financiera-service.test.ts` · «el catalogo declara las NUEVE categorias que esa cifra tiene que sumar» | `id`, `etiqueta`, `granos`, `fuente` y `estadoProduccion` de `egresos`, uno a uno |
| **R11** | `metrics-caja-naturaleza.guardia.test.ts` · «R11/183 · la de \`egresos\` dice que DESDE LA 183 la anulacion se DESCUENTA de la cifra» y «y la asercion discrimina: el texto PRE-183 no la pasa, aunque ya hablaba de ajustes» | las cuatro piezas por separado + `declaraElDescuentoDe183`; el fixture literal pre-183 **no** pasa el predicado y **sí** pasa R53/173 y la coletilla de `metrics.test.ts`; y se afirma que lo anterior (R53/173) sigue en pie |
| **R12** | `tests/unit/analytics/catalogo-produccion.guardia.test.ts` · «todo cambio de \`estadoProduccion\` cita una decision humana registrada en \`progress/\`» | el bloque de `egresos` cita `progress/decision_183.md` y toda fecha escrita está respaldada por una decisión que el propio bloque cita (M16/M17) |
| **R13** | `metrics-caja-naturaleza.guardia.test.ts` · «gana \`ingreso_ajuste\` y NADA mas…» (última aserción: `NATURALEZA_POR_CATEGORIA.ingreso_ajuste === "propio"`) + `tests/unit/utils/caja-tesoreria.test.ts` · «R26 (design §10-C): \`ingreso_ajuste\` es PROPIO, y por eso NO puede servir de reverso» y «R2 (design §2.1): las TRES categorias de tesoreria son de TERCEROS, y ninguna otra lo es» | `NATURALEZA_POR_CATEGORIA` intacto |
| **R14** | `tests/unit/analytics/financiera-forma-importe.guardia.test.ts` · «R14 · la forma de las diez es EXACTAMENTE la declarada» | mapa escrito a mano de las diez métricas servidas; una sola métrica que cambie de forma mueve una entrada (M19/M20) |
| **R15** | mismo archivo · «el censo mira las DIEZ servidas y el esperado las cubre todas, sin sobrar ninguna» + `analitica-financiera-service.test.ts` · «falla por EXCESO: el servicio no inventa ningun id que el catalogo no tenga», «y los dos conjuntos son el mismo, comparados de una vez», «con los ids REALES: quitar uno se detecta, y anadir uno inventado tambien» + `financiera-produccion.guardia.test.ts` · «el registro de ids servidos coincide con las diez financieras del catalogo» | censo de 25 métricas / 10 financieras servidas, por exceso y por defecto |
| **R16** | *sin test propio; evidencia de diff* | `git diff --name-only 64957dca..HEAD -- db/ prisma/` → **vacío**. Ni migración, ni `down.sql`, ni esquema, ni RLS, ni escritura de datos. El censo de migraciones del repo sigue verde porque no hay migración nueva que censar |
| **R17** | `financiera-ingresos-repo.test.ts` · «alterar \`definicion.categorias\` en memoria cambia lo que la consulta devuelve» (`ingreso_flete`) **y** «y lo mismo sobre \`egresos\`, que es LA definicion que la 183 cambio (R17/183)» | el repositorio no gana ninguna lista escrita a mano. El segundo caso **nació de la mutación M23**, que el primero no mataba |
| **R18** | `financiera-forma-importe.guardia.test.ts` · «R18 · dentro de una vista, el total y TODAS sus filas comparten forma» + «autocomprobacion: una vista que mezclara formas se detecta» + `financiera-contratos.test.ts` · «R18/183 · la union DISCRIMINA…» | una vista, una forma; con sanidad de que el fixture trae filas de verdad |
| **R19–R23** | — | **FRONTEND (bloque E, T12–T14).** Fuera de este encargo por instrucción explícita: `app/**` y `components/**` los hace `frontend_dev` |
| **R24** | `financiera-ingresos-repo.test.ts` · «el material del bruto y del neto llega desglosado por tipo (R37)» (par real, con la aserción de que cada `tipo` viene de su categoría) + `analitica-financiera-derivacion.test.ts` · «R7/183 · el par REAL…» + integración · «F.4(b bis) · la fila con la que los dobles viejos afirmaban es 23514 en la base (R24)» | los dos dobles imposibles reexpresados **con el par real**, y la premisa medida contra Postgres: la fila vieja **no se puede insertar** |
| **R25** | *evidencia de diff, más los casos citados* | **Dadas vuelta, no borradas:** el bloque R37 de `financiera-contratos`, «gana \`ingreso_ajuste\` y NADA mas…» (`metrics-caja-naturaleza`), «\`egresos\` sigue declarando las NUEVE…» (`financiera-produccion`), «el catalogo declara las NUEVE…» (`analitica-financiera-service`), «\`egresos\` ve sus NUEVE categorias…» (`financiera-ingresos-repo`), «F.1 · lo sembrado se ve» y «F.4(b)» (integración). El comentario `:402-427` de la integración **conserva citada** la frase «el neto 0 no es alcanzable con datos legales» y explica por qué su premisa dejó de valer para `egresos` y sigue valiendo para las tres de Q1 |
| **R26** | — | **Bloque F (T15).** Las notas fechadas en `specs/127-*` y `specs/132-*` no las escribe este agente, por instrucción explícita |
| **R27** | *este documento* | Mapa construido leyendo cada caso citado; prohibido el conteo de `R\d+` en títulos |

**Cubiertos aquí: R1–R18, R24, R25, R27 (21 de 27).**
**No cubiertos y por qué: R19, R20, R21, R22, R23 (frontend, T12–T14) y R26 (bloque F, T15).**

---

## 5. Salida real de la verificación

### `pnpm exec vitest run` sobre los archivos tocados (y los vecinos que el cambio roza)

```
$ pnpm exec vitest run \
    tests/unit/analytics/financiera-contratos.test.ts \
    tests/unit/analytics/financiera-ingresos-repo.test.ts \
    tests/unit/analytics/financiera-forma-importe.guardia.test.ts \
    tests/unit/analytics/financiera-produccion.guardia.test.ts \
    tests/unit/analytics/metrics-caja-naturaleza.guardia.test.ts \
    tests/unit/analytics/metrics.test.ts \
    tests/unit/analytics/catalogo-produccion.guardia.test.ts \
    tests/unit/services/analitica-financiera-derivacion.test.ts \
    tests/unit/services/analitica-financiera-service.test.ts \
    tests/unit/utils/caja-tesoreria.test.ts \
    tests/integration/actions/analitica-financiera-action.test.ts

 Test Files  11 passed (11)
      Tests  205 passed (205)
   Duration  1.70s
```

La integración corrió **de verdad** contra Postgres (`DATABASE_URL` alcanzable): 15 casos, no
`skipIf`.

### Todas las guardias del repo

```
$ pnpm exec vitest run guard

 Test Files  59 passed (59)
      Tests  812 passed (812)
   Duration  5.46s
```

### `pnpm run lint`

```
$ pnpm exec eslint <los 14 archivos tocados>
(sin salida) — EXIT=0
```

### `pnpm run typecheck` — **ROJO A PROPÓSITO, y es la lista de trabajo del bloque E**

```
$ pnpm run typecheck
app/(app)/analitica/_components/financiero/adaptar.ts(78,22): error TS7053: Element implicitly has an 'any' type because expression of type 'CampoImporte' can't be used to index type 'ImporteAnalitico'.
app/(app)/analitica/_components/financiero/adaptar.ts(110,34): error TS2339: Property 'neto' does not exist on type 'ImporteAnalitico'.
app/(app)/analitica/_components/financiero/TableroFinanciero.tsx(148,41): error TS2339: Property 'neto' does not exist on type 'ImporteAnalitico'.
app/(app)/analitica/_components/financiero/TableroFinanciero.tsx(171,66): error TS2339: Property 'neto' does not exist on type 'ImporteAnalitico'.
tests/components/AnaliticaPage.test.tsx(103,7): error TS2322: Property 'forma' is missing …
tests/components/TableroFinanciero.test.tsx(61,3): error TS2322: Property 'forma' is missing …
tests/unit/analytics/tablero-financiero-adaptar.test.ts(46,27) … (11 errores)
tests/unit/analytics/tablero-financiero-cargar.test.ts(55,9): error TS2322: Property 'forma' is missing …
```

**19 errores, en 6 archivos, TODOS de frontend.** Ni uno en `lib/**`, ni en los tests de
backend. Es exactamente lo que `design.md §3.2` predijo («dejan de compilar, los seis, uno a
uno; es el efecto buscado») y lo que el «Hecho» de T1 declara como resultado esperado.

**Para `frontend_dev` (T12–T14), la lista es esta y no hay más:**

| Archivo | Tarea |
|---|---|
| `app/(app)/analitica/_components/financiero/adaptar.ts` | T12 |
| `app/(app)/analitica/_components/financiero/TableroFinanciero.tsx` | T13 |
| `tests/unit/analytics/tablero-financiero-adaptar.test.ts` | T14 |
| `tests/unit/analytics/tablero-financiero-cargar.test.ts` | T14 |
| `tests/components/TableroFinanciero.test.tsx` | T14 |
| `tests/components/AnaliticaPage.test.tsx` | T14 |

Ayuda ya disponible: `tests/unit/services/_dobles-analitica-financiera.ts` exporta `conNeto()`
y `soloBruto()`, que **afirman** la forma en vez de hacer un `as`. El helper de **fixture**
compartido que `design.md §9` pide para los ~40-60 literales sigue pendiente y es de T14.

`./init.sh --rapido` y `./init.sh` **no se corrieron**: el gate lo corre el leader, y no puede
quedar verde hasta que aterrice el bloque E.

---

## 6. Lo que este agente NO hizo, a propósito

- `app/**` y `components/**` (T12–T13) y sus tests (T14) — son de `frontend_dev`.
- Las notas fechadas en `specs/127-*` y `specs/132-*` (T15 / R26) — bloque F.
- La medición post-merge por MCP (T18 / R9) — depende del merge.
- `./init.sh` en cualquiera de sus dos formas — lo corre el leader.

## 7. Veredicto

Backend de la 183 completo (T0–T11): el contrato discrimina por `forma` y leer un `neto` que no
existe no compila; `egresos` declara nueve categorías, conserva su neto y lo dice en su
descripción con un guardia que discrimina; las 25 mutaciones del spec están ejecutadas y todas
matan —una obligó a rehacer un test que no cubría la métrica que la feature toca—; cero
migraciones; y el único rojo que queda es el typecheck del frontend, que es el efecto buscado y
la lista de trabajo del bloque E.
