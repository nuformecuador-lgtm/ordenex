# 184 — analitica financiera: export de la serie · tasks

Checklist de pasos discretos. `[P]` = paralelizable con las tareas de su misma tanda.
Cada task lleva **criterio de hecho** (lo que hay que poder enseñar) y sus **requisitos**.

**Regla del arnes que aplica a todo el listado:** un commit por task logica completada
(`docs/conventions.md`), nunca un mega-commit final. Y **nada se da por hecho sin gate**:
`./init.sh --rapido` al cerrar cada tanda; `./init.sh` completo antes del PR.

---

## T0 — Puerta humana: **CERRADA el 2026-08-08**

### T0.1 — ~~Cerrar Q1..Q6~~ · **HECHA**
- **Estado:** las seis quedaron respondidas por el humano, todas con la recomendacion, y viven como
  **decisiones D1–D6** al final de `requirements.md` **con su motivo y sus alternativas
  descartadas**. Ningun requisito queda condicionado.
- **Lo que el implementer DEBE tratar como hecho, no como opinion:**
  **D1** solo vistas temporales (los cubos por tienda quedan fuera; la 181 no se resuelve aqui) ·
  **D2** importe como cadena literal escala 2 · **D3** columna constante `limitacion_conocida`
  (**R30**, y la unica excepcion nombrada de R11) · **D4** el archivo no declara el rango ·
  **D5** un control por vista · **D6** una insercion en `TableroFinanciero.tsx` con su condicion
  integra (R28).
- **Regla:** ninguna se reabre sin una decision humana nueva y fechada. Ampliar el alcance del
  export sin reabrir D1 **reabre D1 de hecho**.

### T0.2 — Verificar el baseline en ESTA rama
- **Depende de:** nada. Es lo primero que se ejecuta ahora que T0.1 esta cerrada.
- **Hecho cuando:** `pnpm typecheck` verde y una corrida de la suite medida **en este worktree**,
  con el **numero total de archivos** anotado en `progress/impl_184.md`. Los baselines citados en
  bitacoras ajenas caducan con cualquier PR; y una corrida con «unhandled errors» de workers omite
  archivos enteros y parece casi verde.
- **Criterio de NO hecho:** dar por bueno un baseline que no se midio aqui.

---

## T1 — Dobles y fixtures (base de todo lo demas)

### T1.1 — Fixtures de DTO financiero
- **Depende de:** T0.
- **Que:** constructores de `ResultadoFinancieroVistas` en un helper de tests, con **cuatro**
  formas: (a) vista temporal `bruto_y_neto` de flujo; (b) vista temporal `solo_bruto`; (c) vista
  temporal **acumulada**; (d) vista **no temporal** con cubos **con forma de uuid**.
- **Hecho cuando:** los cuatro compilan contra el tipo real (no `as any`) y (d) contiene uuids
  literales buscables en un string.
- **Criterio de NO hecho:** fixtures con cubos ya inocuos en (d) — seria un verde gratuito (§9.1 T-B
  del design).
- **R:** apoyo de R12, R13, R16, R19.

### T1.2 — `[P]` Doble del borde + espia de logger con SECUENCIA
- **Depende de:** T0.
- **Que:** un `consultar` inyectable que devuelva cada uno de los cuatro `status` del borde, y un
  `ErrorLogger` espia que empuja a un array compartido `secuencia`.
- **Hecho cuando:** el helper permite afirmar `["auditoria","respuesta"]` y no solo un conteo.
- **R:** apoyo de R6, R7, R8, R9.

---

## T2 — El modulo de columnas (nucleo)

### T2.1 — `analitica-financiera-descarga-columnas.ts`
- **Depende de:** T1.1.
- **Que:** los **dos** juegos de columnas (§4.2 del design), la constante de
  `limitacion_conocida` (**D3**/R30) y la factoria `filaDescargaAnaliticaFinanciera(contexto)`.
- **Hecho cuando:** modulo puro (sin React, sin DOM, sin servicio, sin Prisma), el nombre respeta la
  convencion `*-descarga-columnas.ts`, y la guardia de la 170 lo **carga** (comprobado corriendo
  `tests/unit/descarga/columnas-sensibles.guardia.test.ts` y viendo el modulo en su censo).
- **Hecho tambien cuando:** la **cabecera del modulo** deja escrito, con todas las letras, que
  `limitacion_conocida` es la **UNICA celda cuyo texto no sale del DTO**, que esta ahi a proposito
  (D3), y como se concilia con R11 (excepcion **nombrada y unica**). Sin ese aviso, la proxima
  persona la borra creyendola un descuido — que es el fallo que esta task existe para prevenir.
- **Criterio de NO hecho:** una sola tabla de columnas con el neto vacio donde no aplica; o el
  aviso de `limitacion_conocida` ausente.
- **R:** R13, R15, R16, R17, R18, R26, R30.

### T2.2 — Test de columnas al molde de la 189
- **Depende de:** T2.1.
- **Que:** `tests/unit/descarga/analitica-financiera-descarga-columnas.test.ts`, dos casos, con
  clave **y** encabezado escritos **a mano** y en orden.
- **Hecho cuando:** las dos mutaciones dirigidas (reordenar las dos primeras columnas · quitar la
  primera) se ejecutan **una a una** y dan **ROJO**, con el arbol de produccion restaurado y
  verificado tras cada una; veredicto pegado en `progress/impl_184.md`.
- **Criterio de NO hecho:** `COLUMNAS.map(...)` a los dos lados de la asercion.
- **R:** R29.

### T2.3 — `[P]` Tests de proyeccion de una fila
- **Depende de:** T2.1, T1.1.
- **Que:** `export-financiero-columnas.test.ts` (R11, R17, R18), `export-financiero-forma.test.ts`
  (R13), `export-financiero-grano.test.ts` (R15, R16, **R30**).
- **Hecho cuando:** cada caso lleva ejecutada su mutacion de `requirements.md` con veredicto rojo.
  Incluida la **MUTACION 2 de R11**: una **segunda** celda de texto propio debe poner rojo el caso
  de R11 —la excepcion de D3 es de una celda, no una puerta—.
- **R:** R11, R13, R15, R16, R17, R18, R30.

---

## T3 — El recorrido y la seleccion de la vista

### T3.1 — `export-financiero.ts`
- **Depende de:** T2.1.
- **Que:** seleccion de la vista por `vistaId`, comprobacion `esVistatemporal`, y el recorrido
  `vista.filas → DescargaFila[]` **en el orden recibido**.
- **Hecho cuando:** modulo puro; importa `esVistaConNeto`/`esVistaTemporal` de `adaptar.ts` en vez
  de reimplementarlos; no nombra ningun valor de granularidad ni ningun id de metrica.
- **R:** R12, R14, R19, R20.

### T3.2 — `[P]` Tests de equivalencia
- **Depende de:** T3.1.
- **Que:** `export-financiero-equivalencia.test.ts` (R19, R20).
- **Hecho cuando:** la mutacion «filtrar los cubos en cero» y la mutacion «aplicar `agruparCola`»
  ponen rojo el caso que les toca.
- **R:** R19, R20.

---

## T4 — El control de cliente

### T4.1 — `ExportarVistaFinanciera.tsx`
- **Depende de:** T3.1, T1.2.
- **Que:** componente cliente delgado sobre `DescargarDatasetButton`, con `formatos: ["csv","xlsx"]`,
  `obtenerFilas` que **re-invoca el borde** con `(metricaId, FILTRO_FINANCIERO_POR_DEFECTO)` — dos
  argumentos, importando el filtro de `rango.ts` — y traduce los estados que no producen archivo
  (§4.3 del design), reusando `filasLocales` para el tope.
- **Hecho cuando:** no compone ningun nombre de archivo, no declara ningun tope propio, no replica
  el texto de «sin datos» y no escribe ninguna condicion de rol.
- **Criterio de NO hecho:** construir el filtro con un literal, aunque hoy sea equivalente.
- **R:** R1, R2, R5, R6, R8, R9, R21, R22, R24, R25, R27.

### T4.2 — Test de la puerta unica
- **Depende de:** T4.1.
- **Que:** `export-financiero-puerta.test.ts`: (a) las filas salen del borde y de ninguna otra
  fuente; (b) el filtro enviado es **el mismo objeto** (`toBe`) que `FILTRO_FINANCIERO_POR_DEFECTO`;
  (c) el `metricaId` es el de la seccion.
- **Hecho cuando:** la mutacion «sustituir el filtro por `{ rango: "mes" }`» pone rojo (b).
- **R:** R1, R2.

### T4.3 — Test del denegado, BLINDADO
- **Depende de:** T4.1, T1.2. **No paralelizable con T4.2** (comparten helper).
- **Que:** `export-financiero-denegado.test.ts`: forbidden (R6) + **orden de la auditoria** (R7) +
  validation_error sin auditar (R8) + error saneado (R9).
- **Hecho cuando:** se cumplen los **cuatro** criterios de «NO hecho» de §9.1 T-A del design: la
  asercion es sobre la **secuencia**, atraviesa el **borde real** con `deps` de test, y la mutacion
  «invertir las dos sentencias del borde» se ejecuto con veredicto **ROJO** y salida pegada en
  `progress/impl_184.md`, con `lib/actions/analitica-financiera.ts` restaurado y verificado.
- **Criterio de NO hecho:** contar llamadas al espia en vez de afirmar el orden.
- **R:** R6, R7, R8, R9.

### T4.4 — `[P]` Test del control montado
- **Depende de:** T4.1.
- **Que:** `tests/components/descarga/AnaliticaFinancieraExport.test.tsx`: los dos formatos, el
  nombre de archivo por `nombreArchivoDescarga`, el aviso de «sin datos» sin archivo, el mensaje del
  tope, y que el control cuelga de la seccion de su vista.
- **R:** R21, R22, R24, R25, R27.

---

## T5 — El montaje (el unico archivo ajeno)

### T5.1 — Insercion en `TableroFinanciero.tsx`
- **Depende de:** T4.1.
- **Que:** **una** insercion en `SeccionVista`: montar `<ExportarVistaFinanciera …/>` con props
  planas (`metricaId`, `vistaId`, `titulo`) cuando la vista es temporal.
- **Hecho cuando:** el diff de ese archivo se lee de un vistazo y es **exactamente** esa insercion
  (mas su import); `tests/unit/guards/tablero-financiero.guardia.test.ts` queda **VERDE SIN
  TOCARLO** (los siete censos: sin `"use client"`, sin prop-funcion, sin literal de moneda/ISO/
  locale, sin lista de ids, sin decision por id de metrica, sin lista de roles, sin nombrar valores
  de granularidad).
- **Criterio de NO hecho:** haber editado el guardia para que pase.
- **R:** R27, R28.

### T5.2 — Comprobacion de frontera RSC en render
- **Depende de:** T5.1.
- **Que:** un caso que renderice `TableroFinanciero` con paneles fixture y verifique que no explota
  al montar el control. Motivo: una prop-funcion cruzando la frontera RSC falla en **render**, no en
  compilacion, y ningun test que no monte ese arbol exacto la ve.
- **Hecho cuando:** el render pasa con las cuatro fixtures de T1.1.
- **R:** R28.

---

## T6 — Los guardias (no se dejan para el final: son la mitad de la feature)

### T6.1 — `export-financiero-frontera.guardia.test.ts`
- **Depende de:** T2.1, T3.1, T4.1.
- **Que:** los nueve bloques de §6 del design, **cada uno con autocomprobacion por fixture
  sintetico** (un fragmento infractor en memoria da positivo; una mencion en prosa da negativo).
- **Hecho cuando:** los nueve bloques tienen su autocomprobacion y ninguno depende de un guardia
  que caduque; el censo **recorre** el subarbol (un archivo nuevo entra solo) en vez de listar rutas.
- **Criterio de NO hecho:** un bloque sin autocomprobacion — seria verde por vacio para siempre.
- **R:** R1, R2, R3, R4, R5, R14, R18, R23, R26, R27.

### T6.2 — `export-financiero-alcance.guardia.test.ts`, BLINDADO
- **Depende de:** T2.1, T3.1, T1.1.
- **Que:** los tres bloques de R10 (censo del vocabulario del alcance · contrato de columnas contra
  lista escrita a mano · asercion sobre el **TEXTO** del archivo) mas el caso de R12 (vista no
  temporal con cubos uuid ⇒ **ningun archivo**).
- **Hecho cuando:** se cumplen los tres criterios de «NO hecho» de §9.1 T-B del design, y las
  mutaciones «anadir una fila de metadatos con el alcance» y «aceptar cualquier vista con filas»
  dan **ROJO**, con veredicto pegado en `progress/impl_184.md`.
- **R:** R10, R11, R12.

---

## T7 — Cierre

### T7.1 — Mapa `R → test`
- **Depende de:** T2–T6.
- **Hecho cuando:** `progress/impl_184.md` contiene el mapa **completo** R1..R30, construido
  **leyendo el caso citado** y comprobando que verifica lo que el requisito pide. **NO** vale contar
  menciones `R\d+` en titulos de test: esa tecnica cruza espacios de nombres entre features y en
  este repo ya produjo un falso 68/68.
- **Criterio de NO hecho:** un requisito sin test, o un test citado que no mide su requisito. El
  reviewer rechaza.

### T7.2 — Anotar las specs de las features vivas afectadas
- **Depende de:** T7.1. `[P]` con T7.3.
- **Que:** nota **fechada al margen**, sin reescribir el texto original, en
  `specs/134-analitica-export-csv/` (su D1 queda **consumida**: la financiera ya no esta fuera de
  alcance, esta en esta ficha) y en `specs/132-analitica-tablero-financiero/` (su region gana un
  control de cliente montado desde `TableroFinanciero.tsx`).
- **Precedente de forma:** T22 de la 160 sobre la 148; y P4 de la 183.

### T7.3 — Gate y PR
- **Depende de:** T7.1.
- **Hecho cuando:**
  1. `./init.sh` **completo** en verde en esta rama, medido aqui, no heredado;
  2. `pnpm run test:guardias` verde (los guardias no los selecciona el grafo de imports);
  3. el diff de `TableroFinanciero.tsx` es exactamente la insercion de T5.1;
  4. `git status --porcelain -- lib/ components/` **vacio** tras las mutaciones de T2.2, T4.3 y T6.2;
  5. el cuerpo del PR cita las decisiones `D1..D6` (puerta cerrada el **2026-08-08**) **con su
     motivo**, no solo con su letra, y el aviso de numeracion («184» en comentarios de codigo = la
     188).
- **Criterio de NO hecho:** cerrar con `--rapido`. El gate rapido cierra tandas; **antes de un PR
  va el completo, sin excepcion**.

---

## Grafo de dependencias (resumen)

```
T0 ──► T1 ──► T2.1 ──► T2.2 [P] T2.3
        │       └────► T3.1 ──► T3.2 [P]
        │                 └──► T4.1 ──► T4.2
        │                        ├────► T4.3   (no [P] con T4.2)
        │                        ├────► T4.4 [P]
        │                        └────► T5.1 ──► T5.2
        └──────────────────────────────► T6.1 [P] T6.2
                                              └──► T7.1 ──► T7.2 [P] T7.3
```
