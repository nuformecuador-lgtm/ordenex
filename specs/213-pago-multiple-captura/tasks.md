# 213 — Pago múltiple por entrega (captura y presentación) — Tareas

> Worktree **`C:/w213b`**, rama `feature/213-pago-multiple-captura` (de `origin/dev`, `bb4c3185`).
> **No trabajar en el checkout principal**: tiene WIP ajeno sin commitear.
> Cada tanda cierra con **`./init.sh --rapido`**. La feature cierra con **`./init.sh` completo**,
> obligatorio antes del PR (`docs/verification.md`).
> `[P]` = paralelizable con las tareas de su misma tanda.

## Censo previo — LO QUE YA ESTÁ HECHO Y LO QUE VA A ROMPERSE

Contado antes de empezar, no a mitad. **Los ~15 archivos de fixtures que la 212 anticipó YA fueron
migrados por ella** (`impl_212.md` §2: «~25 archivos de fixtures a los que solo se les añadió
`pagos` derivado de su par escalar … y 8 de componente»). Esta ficha **no los vuelve a migrar**.

**8 archivos de test de componente construyen hoy un `CierreDetalleGestion` con `pagos`:**

| Archivo | Estado |
| --- | --- |
| `tests/components/CierreDiaModule.test.tsx` | ⚠️ **romperá** |
| `tests/components/CierreDiaModuleIncidente.test.tsx` | ⚠️ **romperá** |
| `tests/components/CierresAdminModule.test.tsx` | ⚠️ **romperá** |
| `tests/components/descarga/CierresDescarga.test.tsx` | ⚠️ **romperá** |
| `tests/components/CierreDiaPage.test.tsx` | ✅ coherente (`:96-99`: escalar + una línea que cuadra) |
| `tests/components/CierreDetalleIncidente.test.tsx` | ✅ `pagos: []` con `metodoPago: null` |
| `tests/components/CierresAdminIndemnizacion.test.tsx` | ✅ `pagos: []` con `metodoPago: null` |
| `tests/components/paginacion/paginacion-transversal.test.tsx` | ✅ deriva `pagos` del resultado |

**Por qué romperán los cuatro primeros, y no es una regresión:** su fixture BASE trae `pagos: []` y
los casos concretos sobreescriben **solo** `metodoPago` (`CierreDiaModule.test.tsx:241`, `:304`,
`:450`; `CierresAdminModule.test.tsx:536`, `:572`, `:606`; `CierreDiaModuleIncidente.test.tsx:238`;
`CierresDescarga.test.tsx:330`). En cuanto la presentación lea el desglose (R23), esas filas
quedarán sin método que pintar y sus aserciones (`getByText("SINPE")`, etc.) caerán. **Se arreglan
dando al fixture su línea coherente, NUNCA relajando la aserción.** 8 aserciones en 4 archivos.

**Guardias que hay que mirar antes de tocar las descargas** (`tests/unit/descarga/`):

- `cierre-dia-descarga-columnas.test.ts` y `cierre-gestiones-descarga-columnas.test.ts`: fijan el
  censo y el ORDEN exactos de columnas. Son las que hacen cumplir [D4] — **deben quedar intactas**.
- `columnas-sensibles.guardia.test.ts`: **reventará** con la sonda al leer una lista (design §5).
- `cobertura-tablas.guardia.test.ts`, `columnas-asercion-de-orden.guardia.test.ts`,
  `contadores-cabecera.guardia.test.ts`, `adaptador-conjunto.guardia.test.ts`: comprobar que siguen
  verdes; ninguna debería moverse porque no cambia ni una tabla ni una columna.

---

## Tanda 1 — el módulo puro de la captura

- [x] **T1.** Crear `app/(app)/mis-asignaciones/_components/desglose-captura.ts` con
  `LineaEnEdicion`, `lineaNueva`, `lineasIniciales`, `opcionesPara`, `puedeAnadirLinea`,
  `pendiente`, `lineasParaEnviar` y `erroresDeLinea`, reusando `aCentimos`/`sumaCuadra` de
  `lib/utils/pagos-recaudo.ts`. Sin React, sin `@prisma/client`, sin `lib/utils/lineas-pago.ts`.
  **Hecho:** `pnpm run typecheck` verde y el módulo no importa nada de servidor.
- [x] **T2.** `tests/unit/utils/desglose-captura.test.ts`: cubre R3, R4, R5, R11, R12 y R13, con al
  menos un caso de `0.1 + 0.2` contra `0.30` y uno de pendiente negativo (suma que se pasa).
  **Hecho:** todos verdes y cada uno visto fallar bajo una mutación del módulo (invertir el
  `disabled`, descartar la línea a medias, sumar con floats).

> Cierre de tanda: `./init.sh --rapido`.

---

## Tanda 2 — el editor en el panel (depende de T1)

- [x] **T3.** `GestionarOrdenPanel.tsx`: sustituir el estado `metodoPago` (`:260`) por `lineas`,
  borrar `metodoPagoEfectivo` (`:331`), reemplazar el `<Select>` único (`:717-733`) por
  `DesglosePagoField`, y adaptar `buildRaw` (`:341-343`), `buildFormData` (`:395-396`) y
  `elegirResultado` (`:439`). Con cobro se envía desglose puro; sin cobro, **nada**.
  **Hecho:** typecheck y lint verdes, y `git diff` no toca ningún archivo fuera de `app/`.
- [x] **T4.** `DesglosePagoField` en el mismo archivo: una fila por línea con
  `aria-label="Método de pago línea N"` / `"Monto línea N"`, botones «Añadir método» y «Quitar», y
  el resumen A cobrar / Capturado / Diferencia con `money()`.
  **Hecho:** R7 comprobable (dentro de la línea solo hay esos dos controles) y ningún símbolo de
  moneda literal en el archivo.
- [x] **T5.** `tests/components/GestionarOrdenPanelPagos.test.tsx` (nuevo): R1, R2, R6, R8, R9, R10,
  R14, R15, R16, R17, R18. El caso de R16 comprueba las TRES cosas a la vez (sin editor, cero pares
  `pagoMetodo`, `fd.get("metodoPago") === null`) y lleva contraprueba con `montoCobrar > 0`.
  **Hecho:** verdes, y las mutaciones de T2 más «no filtrar las vacías» y «enviar el escalar
  además del desglose» ponen rojo al menos un caso cada una.

> Cierre de tanda: `./init.sh --rapido`. **Aquí el mensajero ya puede capturar un pago mixto.**

---

## Tanda 3 — presentación (independiente de las tandas 1-2)

- [x] **T6.** Crear `app/(app)/cierres-admin/_components/desglose-pago.ts` con
  `desglosePantalla` y `desgloseDescarga` (0 → `null`, 1 → etiqueta, 2+ → concatenado en el orden
  recibido, etiquetas siempre de `METODO_LABEL`). Módulo puro, sin React.
  **Hecho:** typecheck verde; ninguna función ordena la lista.
- [x] **T7 [P].** Sustituir los tres sitios de presentación: `CierreDiaModule.tsx:883-887`,
  `cierre-detalle-shared.tsx:895-899` y `cierre-factura.tsx:953-962`. Ninguno vuelve a leer
  `g.metodoPago`. **Hecho:** el barrido de `METODO_LABEL` en `app/` solo lo encuentra en
  `desglose-pago.ts` y en los dos módulos de descarga.
- [x] **T8 [P].** Arreglar los **4 fixtures de componente** del censo (8 aserciones): darles su
  línea de pago coherente con el escalar que ya declaran. **No se relaja ninguna aserción**; las
  que hoy esperan `"SINPE"` deben seguir esperando `"SINPE"`.
  **Hecho:** los 4 archivos verdes con sus expectativas ORIGINALES intactas (`git diff` de los
  tests: solo altas de `pagos`, cero cambios en `expect`).
- [x] **T9.** `tests/components/CierreDetallePagos.test.tsx` (nuevo) + ampliación de
  `CierreDiaModule.test.tsx`: R20, R21, R22, R24 y R25 en los TRES sitios, incluido un caso cuyo
  orden alfabético diferiría del orden del enum.
  **Hecho:** verdes; mutar `METODO_LABEL` o invertir el orden pone rojo.

> Cierre de tanda: `./init.sh --rapido`.

---

## Tanda 4 — descargas [D4] (depende de T6)

- [x] **T10.** Cambiar la celda `metodo` de `cierre-dia-descarga-columnas.ts:101` y
  `cierre-gestiones-descarga-columnas.ts:115` a `desgloseDescarga(gestion.pagos)`. **Una línea cada
  una.** Las declaraciones de columnas NO se tocan.
  **Hecho:** los tests de censo/orden de las dos descargas siguen verdes **sin editarlos** (R26).
- [x] **T11.** Ampliar `tests/unit/descarga/cierre-dia-descarga-columnas.test.ts` y su gemelo del
  admin con R27, R28, R29, R30, R31.
  **Hecho:** cadena exacta esperada para el caso mixto; `null` para el caso sin líneas.
- [x] **T12.** Ampliar la sonda de `columnas-sensibles.guardia.test.ts` para campos de LISTA
  (design §5), **midiendo antes y después** el nº de módulos descubiertos, de filas proyectadas y
  de hallazgos, y añadiendo la contraprueba de un campo prohibido dentro de una lista.
  **Hecho:** los tres números idénticos antes y después (o, si alguno se movió, escrito POR QUÉ en
  `progress/impl_213.md` como hallazgo), y la contraprueba en rojo al quitar el arreglo.
  **Bloqueado por [Q3]:** si el humano no autoriza tocar la guardia, esta task cambia de forma.

> Cierre de tanda: `./init.sh --rapido` **+ `pnpm exec vitest run tests/unit/descarga`** entero
> (las guardias de descarga no las selecciona ningún grafo de imports).

---

## Tanda 5 — guardias y camino completo

- [x] **T13.** `tests/unit/guards/pagos-captura.guardia.test.ts` (nueva): R19 (el árbol de imports
  del panel no toca `@prisma/client` ni `lineas-pago.ts`), R23 (los tres sitios no leen
  `metodoPago`), R11/R31 (sin `parseFloat`/`Number`/`toFixed`/símbolo literal en el módulo de
  captura y en los dos de descarga, con la conversión del input acotada como excepción nombrada) y
  R32 (la forma escalar del borde sigue viva).
  **Hecho:** cada caso con **contraprueba** (import inyectado, lectura inyectada, `parseFloat`
  inyectado) y control de no-vacuidad; cero listas de archivos escritas a mano donde se pueda
  descubrir del árbol.
- [x] **T14.** E2E: ampliar `e2e/mis-asignaciones.spec.ts` con el camino MIXTO (entrega de 8.000 =
  5.000 efectivo + 3.000 transferencia) y comprobar que el cierre del día muestra
  `total_efectivo = 5.000` (R35). Su `elegirEnSelect(page, "Método de pago", …)` de `:128` muere
  con este cambio y hay que reescribirlo.
  **Hecho, con la evidencia REAL y no la prometida:** el bloque (d) del camino mixto y el helper
  `capturarLineaDePago` están **ESCRITOS y NUNCA EJECUTADOS**. No es que pasen: es que no se
  corrieron. Ejecutarlos exige `.env` con credenciales, base migrada, el bucket privado
  `gestion-evidencias`, el fixture `e2e/fixtures/evidencia.jpg`, seed del mensajero con la primera
  orden en `por_recoger` de 8.000 y `pnpm dev` levantado; y **aun con todo eso fallaría**, por
  deuda ANTERIOR a esta ficha.
  **[Q5], cerrada en la puerta:** aquí se arregló SOLO lo que este cambio rompe (el recaudo,
  `:128`). Sigue obsoleto y **sin tocar**, para la ficha de deuda que da de alta el leader:
  `recogerPrimeraOrden` asume el modal «Recoger órdenes» que retiró la 96;
  `abrirGestionPrimeraOrden` (`:98`) espera un `dialog` «Gestionar orden» que la 113 convirtió en
  panel INLINE —con lo que todo `expect(modal).toBeHidden()` cae—; y
  `elegirEnSelect(page, "Resultado de la gestión", …)` está muerto porque hoy el resultado se elige
  con botones. **Consecuencia que conviene no perder de vista:** hoy el único test que recorre
  captura → `total_efectivo` de punta a punta no corre en ninguna parte (menor 3 del reviewer).

> Cierre de tanda: `./init.sh --rapido`.

---

## Tanda 6 — cierre de la feature

- [x] **T15.** Barrido de coherencia: `metodoPago` ya no aparece en `app/` salvo donde R32 lo
  conserva; ningún archivo de `db/`, `lib/repositories/`, `lib/services/` ni `lib/interfaces/` está
  en el diff (R33); `pagos-frontera.guardia.test.ts` y los tests de la 212 verdes **sin editarlos**
  (R34). **Hecho:** `git diff --name-only origin/dev` revisado archivo por archivo y pegado en
  `impl_213.md`.
- [x] **T16.** **`./init.sh` COMPLETO**, redirigido a fichero (no pipeado: `./init.sh | tail`
  devuelve el exit de `tail`) y comparando el TOTAL de archivos con el de `dev` antes de creerse el
  conteo —una corrida degradada omite archivos enteros y parece casi verde—.
  **Hecho:** `== init OK ==` con `EXIT=0`, sin `unhandled errors` y con el nº de archivos esperado.
  Corrida sobre `704705fe`: **1090 archivos / 13752 tests, 0 rojos**, 543 s, lint 0 errores. El
  baseline de la 212 era 1081/13579, así que el árbol CRECIÓ —no es una corrida degradada—. Una
  corrida anterior se cortó al arrancar `vitest` y **no se contó como verde**: matada no es fallida,
  pero tampoco es un veredicto. Se repite el gate tras el merge de `dev` y la excepción a R34.
- [x] **T17.** `progress/impl_213.md` con el mapa **R1..R35 → test**, la evidencia de mutación de la
  captura (descuadre, no de humo) y los desvíos del spec.
  **Hecho:** los 35 requisitos con su test; el reviewer rechaza si falta uno.
- [x] **T18.** Bookkeeping: `feature_list.json` (213 → `done`, `spec_path`, fechas) y
  `progress/current.md`. Commit por task lógica (`-F` o heredoc citado: **backticks en un `-m`
  inline se EJECUTAN**) y PR **después** de T16, nunca antes.

---

## Dependencias en una línea

```
T1 → T2 → (T3, T4) → T5
T6 → (T7 [P], T8 [P]) → T9
T6 → T10 → T11 → T12
(T5, T9, T12) → T13 → T14 → T15 → T16 → T17 → T18
```

Las tandas 1-2 (captura) y 3 (presentación) son independientes entre sí y pueden ir en paralelo si
hay dos manos; la 4 depende solo de T6.

## Antes de escribir la primera línea de código

Las **seis preguntas abiertas** de `requirements.md` ([Q1] formato de la celda concatenada, [Q2] la
gestión de una sola línea en el archivo, [Q3] tocar la guardia de columnas sensibles, [Q4]
pre-carga del monto, [Q5] el E2E ya roto, [Q6] la línea a medias) van a la **puerta de aprobación
humana**. [Q1], [Q2], [Q3] y [Q6] cambian tasks concretas (T10-T12, T1); no se resuelven suponiendo.
