# 184 — la parte FRONTEND de la Tanda D (listados 2 y 3: «Cierres del día» del admin)

> Rama: `feature/184-deuda-170-listados` · Fecha: 2026-08-04 · Rol: FRONTEND_DEV
>
> Alcance entregado: **D.3 y D.4**. Punto de partida: `progress/impl_184_tandaD_backend.md` (los
> dos repositorios, los dos servicios, los dos schemas derivados y los dos bordes ya estaban,
> verdes y con 19 mutaciones). `lib/**`, `db/**` y los tests de backend **no se tocan**.
>
> **Veredicto en una línea: las dos pantallas de «Cierres del día» del admin dejan de releer el
> listado COMPUESTO —que trae cola e histórico juntos— para pedir cada una su mitad, y
> `PENDIENTES_184` baja de ocho a SEIS; 16 mutaciones ejecutadas, las 16 rojas.**

---

## 1. Qué se hizo

Dos commits, uno por listado, cada uno con **la pantalla y su línea del censo dentro**. Es lo que
`tasks.md > Notas de ejecución` exige y lo que impide que el censo mienta entre dos commits; las
mutaciones **MD2** y **MD10** miden justamente la mitad que faltaría si no fuera así (mover el
censo sin mover la pantalla).

| Commit | Listado | Pantalla |
| --- | --- | --- |
| `67af8791` | 2 — «Cierres del día — histórico» | `app/(app)/cierres-admin/_components/CierresAdminHistoricoTabla.tsx` |
| `876aa143` | 3 — «Cierres del día pendientes de decisión» | `app/(app)/cierres-admin/_components/CierresAdminModule.tsx` |

### D.3 — listado 2, el histórico

| Antes (T I.2) | Ahora (T D.3) |
| --- | --- |
| `filasDelConjuntoCompleto(listarCierresAdmin().then(res => …res.historico), …)` | `filasDesdeResultado(listarHistoricoCierresAdminCompleto(), filaDescargaCierreHistorico)` |
| el archivo salía del listado **compuesto**: cola **e** histórico del alcance, para quedarse con una de las dos mitades (el backend lo midió: **7 filas leídas para producir 5**) | una lectura dedicada que corta por estado **en la base**, con el mismo `where` y el mismo `orderBy` que la página |
| tope de 5000 evaluado en el **cliente** (`filasLocales` dentro del adaptador) | tope evaluado en el **servidor** (R6): por encima no viaja ni una fila |

### D.3 — listado 3, la cola de pendientes

Idéntico, con `listarPendientesCierresAdminCompleto()` y `filaDescargaCierrePendiente`. Es el que
más se ahorra en producción, y el motivo está en la forma de los datos: **la cola son los cierres
sin resolver —una decena— y el histórico crece sin tope con los días**, así que descargar la cola
arrastraba el alcance entero. El módulo deja de importar `listarCierresAdmin`: ya no le quedaba
ningún uso.

En los dos casos el comentario que defendía la relectura **no se borró, se corrigió**: la frase que
valía —el archivo es el CONJUNTO del alcance y ese acotamiento lo pone el servidor desde la sesión,
así que un `adminSatelite` sigue descargando solo su zona (R14/R44)— sigue siendo cierta; lo que
cambia es de dónde sale ese conjunto.

### D.4 — el censo, en el MISMO commit que cada pantalla

`tests/components/paginacion/paginacion-transversal.test.tsx`: los dos listados pasan a
`adaptador: "completo"` y salen de `PENDIENTES_184`. **Quedan seis** (7 `completo` + 6 `conjunto`
= los 13 del Anexo III).

### Efecto colateral, medido y anotado

Tras D.3, **`listarCierresAdmin()` tiene un solo consumidor de producción**:
`app/(app)/cierres-admin/page.tsx:44`, el Server Component que resuelve la pantalla. Es el **cuarto**
caso del mismo patrón (`listarRecepcionSatelite()` tras la A, `listarConsolidacion()` tras la B,
`listarCierreDia()` tras la C) y **no se actúa sobre él**: reducir ese contrato es un cambio de
superficie que ningún requisito de esta feature necesita. Queda anotado para quien lo decida.

---

## 2. Archivos

**Producción (2)**

- `app/(app)/cierres-admin/_components/CierresAdminHistoricoTabla.tsx` — el adaptador, los dos
  imports y el comentario que explica qué se dejó de pagar.
- `app/(app)/cierres-admin/_components/CierresAdminModule.tsx` — ídem, más la retirada del import
  de `listarCierresAdmin`.

**Tests (4)**

- `tests/components/descarga/CierresDescarga.test.tsx` — **+8 casos (18 → 26)**, cuatro por
  listado, más los dos dobles nuevos.
- `tests/components/paginacion/paginacion-transversal.test.tsx` — D.4 (los dos `adaptador` y las
  dos líneas de `PENDIENTES_184`) **y peaje** (§4).
- `tests/components/paginacion/BajoRiesgoPaginacion.test.tsx` — **peaje** (§4).
- `tests/components/paginacion/ColasPaginacion.test.tsx` — **peaje** (§4).

**Cero** cambios en `lib/**`, `db/**`, `components/**`, `feature_list.json` ni en la configuración
de `useSWR` de ninguna pantalla (**R33**: los dos objetos de opciones de `useSWR` de
`CierresAdminModule` —el del histórico y el de la cola— no aparecen en el diff).

---

## 3. Las 16 mutaciones, con su salida

Cada una: se rompe el código de verdad, se corre, y **se restaura desde una copia en memoria**
(bytes exactos, con reintento y **verificando que el contenido volvió a ser el original**), nunca
con `git checkout`/`restore`/`stash`. El guion imprime al final de cada lote qué archivos MÍOS
quedan sucios: salió `[]` las 16 veces, y al terminar `git diff` sobre mis seis rutas está vacío.
Guion: `scratchpad/tandaD_front_mutar.py`.

### Lote del listado 2 — el histórico (8)

```
=== MD1 (D.3/R1) la pantalla del historico vuelve a sacar el archivo del listado COMPUESTO
  × el archivo del histórico de cierres del día sale de su lectura DEDICADA, no del listado compuesto (R1/R8) 140ms
  × descargar el histórico ya no arrastra la COLA: el compuesto trae las dos mitades y ya no se pide (R1) 131ms
  × la pantalla NO recorta ni reordena el histórico de cierres del día que devolvió el servidor (R2) 108ms
  × un fallo de la lectura del histórico de cierres del día no produce archivo y el mensaje no lleva datos personales (R7) 1099ms
  × ninguno de los TRECE proyecta el array de la página: el archivo va al servidor 4ms
  Tests  5 failed | 41 passed (46)
  AssertionError: Cierres del día — histórico: su descarga no va al servidor por el conjunto (R52):
                  expected '"use client";…' to match /filasDesdeResultado\(/

=== MD2 (D.4/R30) el censo declara el listado 2 pendiente aunque su pantalla ya migro
  × ninguno de los TRECE proyecta el array de la página: el archivo va al servidor 5ms
  Tests  1 failed | 45 passed (46)
  AssertionError: Cierres del día — histórico: su descarga no va al servidor por el conjunto (R52):
                  expected '"use client";…' to match /filasDelConjuntoCompleto\(/

=== MD3 (D.3/R1) la pantalla del historico relee ADEMAS el compuesto y TIRA el resultado
  × el archivo del histórico de cierres del día sale de su lectura DEDICADA… (R1/R8) 105ms
  × descargar el histórico ya no arrastra la COLA… (R1) 92ms
  Tests  2 failed | 44 passed (46)
  AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times

=== MD4 (D.3/R2) la pantalla del historico RECORTA en el navegador lo que devolvio el servidor
  × la pantalla NO recorta ni reordena el histórico… (R2) 118ms
  × la descarga sigue entregando el dataset completo, no la página (R52) 571ms
  Tests  2 failed | 44 passed (46)
  AssertionError: el archivo trae la página, no el conjunto: expected [ …(24) ] to have a length of 30 but got 25

=== MD5 (D.3/R2) la pantalla del historico REORDENA en el navegador lo que devolvio el servidor
  × la pantalla NO recorta ni reordena el histórico… (R2) 103ms
  Tests  1 failed | 45 passed (46)
  AssertionError: expected [ '2026-07-11', '2026-07-12', …(1) ] to deeply equal [ '2026-07-12', '2026-07-19', …(1) ]

=== MD6 (D.3/R7) un fallo del historico se degrada a la pagina visible en vez de no producir archivo
  × un fallo de la lectura del histórico… (R7) 1121ms
  Tests  1 failed | 45 passed (46)
  AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times

=== MD7 (D.3/R4/R17) la descarga del historico viaja con el recorte de pagina
  × el archivo del histórico de cierres del día sale de su lectura DEDICADA… (R1/R8) 105ms
  Tests  1 failed | 45 passed (46)
  AssertionError: expected [ { page: 1, pageSize: 25 } ] to deeply equal []

=== MD8 (D.3/R8) la pantalla del historico ejecuta la lectura del conjunto AL MONTAR
  × el contador de cabecera muestra el total del servidor, no el tamaño de página (R42) 116ms
  × cada cola navega entre páginas y su control tiene nombre accesible (R43) 56ms
  × el usuario ve exactamente las mismas filas que antes en la página 1 (R44) 52ms
  × la descarga sigue entregando el dataset completo (R52) 69ms
  × el archivo del histórico de cierres del día sale de su lectura DEDICADA… (R1/R8) 48ms
  × la página pre-cargada se pinta sin esperar al servidor, y cada página cuesta UNA lectura 51ms
  × descargar desde la ÚLTIMA página entrega el conjunto, no lo que se ve 50ms
  Tests  7 failed | 39 passed (46)
  AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times
```

### Lote del listado 3 — la cola (8)

```
=== MD9 (D.3/R1) la pantalla de la cola vuelve a sacar el archivo del listado COMPUESTO
  × el archivo de la cola de cierres del día sale de su lectura DEDICADA, no del listado compuesto (R1/R8) 102ms
  × descargar la cola ya no arrastra el HISTÓRICO: el compuesto trae las dos mitades y ya no se pide (R1) 71ms
  × la pantalla NO recorta ni reordena la cola de cierres del día que devolvió el servidor (R2) 114ms
  × un fallo de la lectura de la cola de cierres del día no produce archivo y el mensaje no lleva datos personales (R7) 1109ms
  × ninguno de los TRECE proyecta el array de la página: el archivo va al servidor 5ms
  Tests  5 failed | 41 passed (46)
  AssertionError: expected [ Array(2) ] to have a length of 30 but got 2

=== MD10 (D.4/R30) el censo declara el listado 3 pendiente aunque su pantalla ya migro
  × ninguno de los TRECE proyecta el array de la página: el archivo va al servidor 6ms
  Tests  1 failed | 45 passed (46)
  AssertionError: Cierres del día pendientes de decisión: su descarga no va al servidor por el conjunto (R52):
                  expected '"use client";…' to match /filasDelConjuntoCompleto\(/

=== MD11 (D.3/R1) la pantalla de la cola relee ADEMAS el compuesto y TIRA el resultado
  × el archivo de la cola de cierres del día sale de su lectura DEDICADA… (R1/R8) 117ms
  × descargar la cola ya no arrastra el HISTÓRICO… (R1) 94ms
  Tests  2 failed | 44 passed (46)
  AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times

=== MD12 (D.3/R2) la pantalla de la cola RECORTA en el navegador lo que devolvio el servidor
  × la pantalla NO recorta ni reordena la cola… (R2) 119ms
  × la descarga sigue entregando el dataset completo (R52) 356ms
  × descargar desde la ÚLTIMA página entrega el conjunto, no lo que se ve 381ms
  Tests  3 failed | 43 passed (46)
  AssertionError: el archivo trae la página, no el conjunto: expected [ …(25) ] to have a length of 30 but got 25

=== MD13 (D.3/R2) la pantalla de la cola REORDENA en el navegador lo que devolvio el servidor
  × la pantalla NO recorta ni reordena la cola… (R2) 133ms
  Tests  1 failed | 45 passed (46)
  AssertionError: expected [ '2026-07-11', '2026-07-12', …(1) ] to deeply equal [ '2026-07-12', '2026-07-19', …(1) ]

=== MD14 (D.3/R7) un fallo de la cola se degrada a la pagina visible en vez de no producir archivo
  × un fallo de la lectura de la cola… (R7) 1126ms
  Tests  1 failed | 45 passed (46)
  AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times

=== MD15 (D.3/R4/R17) la descarga de la cola viaja con el recorte de pagina
  × el archivo de la cola de cierres del día sale de su lectura DEDICADA… (R1/R8) 113ms
  Tests  1 failed | 45 passed (46)
  AssertionError: expected [ { page: 1, pageSize: 25 } ] to deeply equal []

=== MD16 (D.3/R8) la pantalla de la cola ejecuta la lectura del conjunto AL MONTAR
  × cada listado navega entre páginas y el control tiene nombre accesible (R43) 37ms
  × la descarga sigue entregando el dataset completo, no la página (R52) 4ms
  × el usuario ve exactamente las mismas filas que antes en la página 1 (R44) 4ms
  × Q-I3: la vista tipo factura sigue a la tabla del histórico, no al conjunto entero 4ms
  × el archivo de la cola de cierres del día sale de su lectura DEDICADA… (R1/R8) 43ms
  Tests  5 failed | 41 passed (46)
  AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times
```

### Qué mide cada par, y las dos trampas que el encargo avisaba

**MD1/MD9 son las mutaciones que miden la tanda entera**: revierten cada pantalla al estado del
2026-08-03 y ponen rojos **a la vez** los cuatro casos de conducta y el **censo** (la pantalla
declara `completo` pero llama al otro adaptador).

**MD2/MD10 son su espejo**: mover la línea del censo sin tocar la pantalla también es rojo. Sin
esta mitad, el censo podría decir que un listado está cerrado cuando no lo está.

**MD3/MD11 son LA mutación propia de esta tanda, y son el equivalente en cliente de la M8 del
backend.** El código mutado llama a `listarCierresAdmin()` —el listado compuesto, que trae la cola
Y el histórico— **y tira el resultado**: mismo archivo, mismas filas, mismo orden, mismo xlsx byte
a byte. Es indistinguible por el resultado, y en el backend un movimiento equivalente dejaba **84
de 85** casos en verde.

Lo que le toca al componente, sin duplicar lo del backend: el backend vigila **cuántas filas leyó
su servicio** (`llamadas === ["findHistoricoCompleto"]`, `filasLeidas === [5]`); lo que ningún test
de servicio puede ver es **si la pantalla sigue pidiendo el camino caro**. Un servicio que lee su
mitad no sirve de nada mientras el módulo llame al compuesto — y ése era exactamente el estado del
que salimos. La mitad de aquí es `expect(listarCierresAdmin).not.toHaveBeenCalled()` **después** de
que la descarga se haya completado.

Y su **anti-vacuidad**, en dos pasos, porque «cero llamadas» pasa igual con un doble muerto o con
una descarga que nunca ocurrió:

1. la descarga SÍ ocurrió y produjo sus filas (`filas` con la longitud del conjunto);
2. el doble del compuesto **está vivo y trae LAS DOS MITADES** — el test lo invoca al final y
   comprueba que devuelve la cola *además* del histórico. No llamarlo es una decisión de la
   pantalla, no del arnés.

**El tamaño del fixture, atendiendo al aviso.** El caso de R2 de cada listado usa un doble de
**30 filas** con la tabla pintando **1** (histórico) o **2** (cola), y el `pageSize` del dominio es
**25**: así un recorte a la página *o* al `pageSize` se distingue del bueno. Con las 1–2 filas del
fixture original, MD4/MD12 habrían pasado verdes en el caso nuevo — la página *sería* el conjunto—.
Medido: MD4 y MD12 caen con `expected […] to have a length of 30 but got 25`.

**MD5/MD13 —reordenar— son las que justifican que el caso de R2 exista** además de la guardia vieja
de R52. Recortar lo caza también aquélla (se ve en MD4/MD12, que ponen rojos los dos archivos);
reordenar **no**, porque el archivo sigue teniendo todas sus filas. Solo el caso de R2 las mata.
Es el defecto que Q-I2/Q-L3 ya dejaron escrito en este repo.

**MD8/MD16 (leer el conjunto al montar) caen en varios sitios**, y el rojo extra es informativo:
rompen los tres archivos de paginación, que renderizan estas pantallas y cuyo caso de descarga no
espera una llamada en el montaje. Confirma la forma del peaje de §4.

**Ninguna mutación quedó verde**, así que no hubo código propio inalcanzable que retirar (la tanda
A sí tuvo uno, `SIN_FILAS`).

---

## 4. El peaje de los `vi.mock` ajenos: **TRES archivos**

El backend dejó siete candidatos. La corrección de las tandas B y C —el fallo **no** es un error de
importación, es `expected "vi.fn()" to be called 1 times, but got 0 times` en el caso de descarga,
porque vite resuelve el named import en el punto de uso— implica que `vitest related` no basta: hay
que mirar **quién pulsa el control de descarga**. Medido así, buscando los dos nombres de control
(«Descargar Cierres del día resueltos» y «Descargar Cierres pendientes de decisión») en `tests/`:

| Archivo | ¿Pulsa alguno de los dos controles? | ¿Rompió? |
| --- | --- | --- |
| `tests/components/paginacion/BajoRiesgoPaginacion.test.tsx` | **sí**, el del histórico desde la página 2 (su caso de R52) | **sí** → peaje pagado (listado 2) |
| `tests/components/paginacion/ColasPaginacion.test.tsx` | **sí**, el de la cola desde la página 2 | **sí** → peaje pagado (listado 3) |
| `tests/components/paginacion/paginacion-transversal.test.tsx` | **sí**, el de la cola (está en su `MUESTRA`) | **sí** → peaje pagado (listado 3) |
| `tests/components/descarga/CierresDescarga.test.tsx` | sí, los dos | es el archivo que esta tanda escribe |
| `tests/components/CierresAdminModule.test.tsx` | no (ni una aparición de `Descargar`) | no |
| `tests/components/CierresAdminPage.test.tsx` | no | no |
| `tests/components/CierresAdminIndemnizacion.test.tsx` | no | no |
| `tests/components/CierresAdminPagoMensajero.test.tsx` | no | no |

**`paginacion-transversal.test.tsx` es la confirmación del aviso que dejó la tanda C**: allí era «el
tercer candidato que no rompe» —renderizaba `CierreDiaModule` pero no pulsaba nada— y la nota decía
que estaba «a un caso de distancia». En esta tanda sí pulsa: su `MUESTRA` incluye «Descargar Cierres
pendientes de decisión». El aviso valía.

Los cuatro archivos restantes que referencian `@/lib/actions/cierres-admin`
(`indemnizacion-tope-negocio-cierre`, `liquidacion-money-safe`, `cierres-admin-descarga-action` y el
de integración `cierres-admin-action`) no montan estas pantallas. Verificado corriendo los once del
dominio: **213 casos verdes**.

En los tres el arreglo es el de siempre: declarar el export nuevo en la factoría con **su propio
doble** (`completo.cierresHistoricoCompleto`, `completo.cierresPendientesCompleto`) y programarlo
en el montaje. El doble del listado compuesto **se conserva en los tres**: que el archivo ya no
salga de él tiene que ser una decisión de la pantalla, no una consecuencia de que el doble no
responda.

---

## 5. El flake de jsdom

Los ocho casos nuevos dependen del reloj de `waitFor` (**1.000 ms**, no el `testTimeout` de 20 s),
así que se aplicaron los tres mecanismos:

- **Anclas positivas.** Los seis casos de éxito anclan a la **entrega del blob**
  (`waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1))`) y los dos de fallo —que por
  definición no producen archivo— al **toast**, una presencia. Ninguna espera es «que no haya X»:
  eso lo cumple también el estado transitorio de antes de empezar, y un ancla que el transitorio
  cumple no es un ancla. Las afirmaciones negativas (`not.toHaveBeenCalled`) van **después** del
  ancla, nunca dentro de ella.
- **Nada anclado a trabajo pesado real.** `exceljs` (`buildXlsxRows`) y `descargarBlob` siguen
  aislados en este archivo; el ancla es la entrega del blob, no la generación de la hoja. Las 30
  filas de los dos casos de R2 tampoco cuestan nada real: no se renderizan (la tabla pinta la página
  del doble paginado) y el generador está mockeado.
- **Medido dos veces seguidas** (§6), y con los once archivos del dominio a la vez.

---

## 6. Puertas (medición real)

```
$ pnpm run typecheck
> tsc --noEmit
=== typecheck exit: 0

$ pnpm exec vitest run tests/components/descarga/CierresDescarga.test.tsx \
    tests/components/paginacion/{paginacion-transversal,ColasPaginacion,BajoRiesgoPaginacion}.test.tsx
 Test Files  4 passed (4) · Tests  46 passed (46)      # dos pasadas seguidas, las dos verdes

$ pnpm exec vitest run <mis 4 + los 7 vecinos del dominio>
 Test Files  11 passed (11)
      Tests  213 passed (213)

$ pnpm exec vitest run guard
 Test Files  61 passed (61)
      Tests  830 passed (830)
   Duration  7.11s

$ pnpm exec eslint <mis 6 archivos>
(sin salida: 0 errores, 0 warnings)

$ pnpm exec eslint .
✖ 44 problems (0 errors, 44 warnings)     # AJENAS y preexistentes; delta propio: CERO
```

**Rojos propios: cero. Rojos ajenos: cero** — tampoco aparecieron los de contención avisados
(`LoginForm`, `RegistrarPagoDialog`): no entran en los archivos que corrí, y la suite se corrió con
el árbol razonablemente quieto.

**Un rojo AJENO de typecheck, transitorio y ya cerrado por su dueño.** A mitad del trabajo,
`pnpm run typecheck` salió en `exit 2` con un único error en
`tests/unit/services/cierres-bodega-admin-service.test.ts(93,3)` (`findHistoricoCompleto` opcional
en un doble del repositorio), dentro del `git diff` **sin commitear** del otro agente (la tanda E) y
en archivos que esta tanda no toca. Se reportó, no se arregló. La medición final, ya con esa tanda
commiteada (`9f559311`, `d0c6bceb`), es **`typecheck exit: 0`**.

**La suite completa NO se corre aquí**: el gate (`./init.sh`) lo corre el LEADER.

---

## 7. Mapa `R<n>` → archivo + nombre del caso

Construido **leyendo el caso**, no contando `R\d+` en títulos: los espacios de nombres de la 170 y
la 184 se cruzan en estos archivos (`R52`, `R44`, `R43`, `R42` son de la 170). Solo se listan los
requisitos que esta entrega toca; los del servidor están en `progress/impl_184_tandaD_backend.md §6`.

| R | Archivo | Caso | Estado |
| --- | --- | --- | --- |
| R1 | `tests/components/descarga/CierresDescarga.test.tsx` + `paginacion-transversal.test.tsx` | «el archivo del histórico de cierres del día sale de su lectura DEDICADA, no del listado compuesto (R1/R8)» y su gemelo de la cola (la acción nueva con 1 llamada y `listarCierresAdmin` con **ninguna**), más **«descargar el histórico ya no arrastra la COLA…»** / **«descargar la cola ya no arrastra el HISTÓRICO…»**, que es la mitad que el xlsx no distingue; y la mitad estática «ninguno de los TRECE proyecta el array de la página» (los dos módulos declaran `completo` y **deben** contener `filasDesdeResultado(`). Killers: **MD1**, **MD3**, **MD9**, **MD11** | ✔ **cierra aquí** para los listados 2 y 3 |
| R2 | `CierresDescarga.test.tsx` + el censo | «la pantalla NO recorta ni reordena el histórico / la cola de cierres del día que devolvió el servidor (R2)»: el doble devuelve **30** filas con la tabla pintando 1 (histórico) y 2 (cola) —y el `pageSize` del dominio es 25—, y las tres primeras en un orden que ningún orden de cliente reproduce. La mitad estática es la negativa de T0.2: los módulos **no pueden** contener `filasDelConjuntoCompleto(`. Killers: **MD4**/**MD12** (recorte) y **MD5**/**MD13** (reorden, que la guardia vieja de R52 NO caza) | ✔ |
| R3 | — | **no aplica a estos dos listados, y es medible**: ninguno tiene filtros (su schema de página solo llevaba `page`/`pageSize`). Lo afirmable es que **no viaja ninguna clave**, y eso sí se afirma: `expect(mock.calls[0]).toEqual([])` en los dos casos de R1. Killers: **MD7**, **MD15** | ✔ como «no hay filtros que llevar» |
| R4 | `CierresDescarga.test.tsx` | el mismo `toEqual([])`: la entrada no lleva `destinoZonaId` ni `destinoTipo`, que son las dos claves que, aceptadas, abrirían a un `adminSatelite` el dinero de la bodega vecina. El guard de rol y el `resolveAlcance` son del servicio (backend §6) | ✔ cliente |
| R6 | — | el tope lo evalúa el servidor y lo redacta `filasDesdeResultado`; sus casos viven en `cierres-admin-completo.test.ts` y `ControlDescargaTransversal.test.tsx`, verdes sin tocar | ✔ sin cambios |
| R7 | `CierresDescarga.test.tsx` | «un fallo de la lectura del histórico / de la cola de cierres del día no produce archivo y el mensaje no lleva datos personales (R7)»: mensaje accionable, sin nombres de mensajero, sin zona, sin montos, sin identificadores y sin el motivo del rechazo —texto libre escrito por un administrador—; no hay blob ni xlsx. Killers: **MD6**, **MD14** | ✔ **cierra aquí** |
| R8 | `CierresDescarga.test.tsx` | los dos casos de R1 afirman la acción del conjunto **sin llamar** hasta que se pulsa, y que la lectura de página sigue costando UNA (`listarHistoricoCierresAdminPaginado` / `listarPendientesCierresAdminPaginado` con 1 llamada). Killers: **MD8**, **MD16** | ✔ **cierra aquí** |
| R12 | `CierresDescarga.test.tsx` + `ControlDescargaTransversal.test.tsx` | «cada tabla de cierres ofrece su control…», «el archivo trae las filas de SU tabla, en el orden de la pantalla» y «estados, causas y destinos salen como etiqueta legible», **sin cambios**: mismas columnas, mismo orden y mismos textos. `cierres-admin-descarga-columnas.ts` no se tocó y las dos filas de descarga siguen tomando `CierreAdminResumen` | ✔ sin cambios |
| R13 | `paginacion-transversal.test.tsx` | el mismo caso del censo: los SEIS que siguen declarados `conjunto` **deben** contener `filasDelConjuntoCompleto(`, y los siete `completo`, `filasDesdeResultado(` | ✔ |
| R29 | `paginacion-transversal.test.tsx` | los dos sentidos del censo, ya existentes (lo declarado existe; lo que existe está declarado), verdes tras mover los dos listados | ✔ |
| R30 | `paginacion-transversal.test.tsx` | `PENDIENTES_184` con **seis** nombres, contrastado contra el árbol. Medido en los dos sentidos: **MD1**/**MD9** (pantalla sin censo) y **MD2**/**MD10** (censo sin pantalla) | ✔ |
| R33 | — | los dos objetos de opciones de `useSWR` de `CierresAdminModule` (histórico y cola) no se tocan: ni `fallbackData` ni ninguna opción aparecen en el diff. Su caso vive en `paginacion-transversal.test.tsx` («los TRECE pre-cargan su página») y sigue verde | ✔ |
| R34 | este archivo | el mapa de arriba | ✔ |

**Lo que NO se puede cubrir aquí, con su motivo:** R5, R14, R15, R16 y R17 son de repositorio o
borde (`lib/**`, fuera del alcance de FRONTEND_DEV) y están cerrados en
`impl_184_tandaD_backend.md`. **R9** es de la tanda C (las URL de evidencia del listado 1) y **R10**
de la tanda B (los agregados de la consolidación); ninguno aplica a estos dos listados. **R11** es
del listado 10 y **R18–R28** son la poda de la selección satélite, las dos cerradas en la tanda A.
**R31 y R32** son de la **tanda H**: la guardia nueva solo puede correr cuando A–G estén dentro, y
hoy quedan **seis** listados (tandas E, F y G).

---

## 8. Notas para quien siga

- **El peaje se busca por «quién pulsa el control», no por `vitest related`** (§4). En esta tanda
  eso redujo siete candidatos a **tres**, y confirmó el pronóstico que dejó la tanda C sobre
  `paginacion-transversal`.
- **La mutación que hay que escribir en cada tanda es la del coste que se ahorra**, no la del
  archivo que se produce: MD3/MD11 aquí, MC3 en la C, M4/M11 en la B. El archivo sale idéntico en
  las tres.
- **El tamaño del fixture del caso de R2 no es decorativo.** Con 1–2 filas, la mutación «recorta a
  la página» pasa verde porque la página es el conjunto. 30 filas con la tabla pintando 1 o 2, y el
  `pageSize` del dominio en 25, es lo mínimo que discrimina las tres cosas (página, `pageSize`,
  conjunto).
- **`listarCierresAdmin()` queda con un solo consumidor de producción**
  (`app/(app)/cierres-admin/page.tsx`). Van **cuatro** listados compuestos en la misma situación
  (`listarRecepcionSatelite`, `listarConsolidacion`, `listarCierreDia`, `listarCierresAdmin`). No se
  actúa: es un cambio de contrato que ningún requisito de esta feature necesita, pero ya es un
  patrón y no una casualidad.
- **Higiene del worktree compartido, respetada y sin incidentes.** Ninguna orden de git sin ruta
  explícita; ningún `--amend`; el guion de mutaciones restaura **desde una copia en memoria** con
  reintento y verificación del contenido, y comprueba `git status` sobre **mis seis rutas** después
  de cada mutación (`[]` las 16 veces). Los archivos del otro agente (la tanda E, en `lib/**` y
  `tests/unit/**`) no se tocaron ni se commitearon: los dos commits de esta tanda se hicieron con
  `git add` de rutas explícitas.
