# Ficha 336 — borrar `/mis-pagos` y `/qr` · requirements.md

> **Zona:** `fullstack` · **Complejidad:** baja · **SDD:** sí
> **Naturaleza:** ficha de BORRADO. El valor de este spec no está en decir «borra estos
> archivos» —eso cabe en una línea—: está en enumerar **qué se rompe** y **qué cobertura tiene
> que sobrevivir**. En este repo borrar una pantalla ya se llevó por delante la cobertura de una
> feature ajena y costó una regresión en producción (incidente del 2026-08-07, `da544b30`).

---

## Contexto de la decisión (no se reabre; se registra)

El 2026-08-30 el humano decidió borrar las dos rutas **con los datos delante**. Lo que se le dijo
**antes** de decidir, y que consta aquí para que nadie lo redescubra dentro de tres meses:

- **`/mis-pagos` NO es código roto.** Es la ficha 44. Funciona, es de solo lectura, acota al
  mensajero en el `WHERE` (`actor.usuarioId`, nunca un id del input) y resuelve el rol
  server-side con `notFound()` para cualquier rol distinto de `mensajero`.
- **Es HOY el único sitio de la app donde un mensajero ve lo que Ordenex le debe.** No hay otro
  consumidor de `verMiCuentaPorPagarAction` / `listarMisPagosAction` / `listarMisPagosCompletoAction`
  ni pantalla equivalente. **Al borrarla, esa capacidad desaparece sin sustituto.**
- Tiene el **mismo defecto** que `/mi-wallet` (construida, correcta, sin puerta en el menú) y se
  eligió la salida **opuesta**. No es incoherencia: es una decisión de producto tomada dos veces
  con criterios distintos, y así queda escrita.
- **El humano reafirmó tras verlo: se borra. Los mensajeros no la necesitan.**

`/qr` es una pantalla de escáner suelta de la ficha 65 cuyo ítem de menú nunca llegó a existir.
A ninguna de las dos llega un enlace: **la única forma de alcanzarlas es tecleando la URL**
(verificado contra el árbol, ver `design.md §0`).

---

## Requisitos

### Bloque A — lo que deja de existir

- **R1 — Ubicuo.** El sistema DEBE dejar de exponer la ruta `/mis-pagos`: ni su archivo de ruta
  ni su carpeta de componentes deben existir en el árbol.

- **R2 — Ubicuo.** El sistema DEBE dejar de exponer la ruta `/qr`: ni su archivo de ruta ni el
  hook que solo esa pantalla usaba.

- **R3 — Ubicuo.** El sistema DEBE quedar **sin ninguna referencia de ejecución** —import,
  re-export, JSX, `href`, `router.push`, mención en una lista de rutas— a las dos rutas
  borradas ni a los símbolos que se van con ellas, en los árboles de producción (`app/`,
  `components/`, `lib/`, `hooks/`, `providers/`) ni en `middleware.ts`. Una mención en un
  comentario NO cuenta como referencia.

- **R4 — Ubicuo.** El sistema DEBE dejar de exportar, desde el módulo de Server Actions del pago
  por mensajero, las tres lecturas cuya única superficie era `/mis-pagos`.

- **R5 — Ubicuo.** El sistema DEBE dejar de declarar, en la capa de servicio y en su interfaz,
  los métodos cuya única superficie eran esas tres acciones.

### Bloque B — lo que tiene que seguir vivo

- **R6 — Ubicuo.** El sistema DEBE conservar el componente compartido de cámara `QrScanner`
  exportado y con **al menos dos importadores directos vivos**: la tarjeta compartida de captura
  de guía y la pantalla de verificación de guía del mensajero.

- **R7 — Ubicuo.** El sistema DEBE conservar **las seis superficies de escaneo** que llegan a la
  cámara a través de la tarjeta compartida (recepción en origen, recepción en bodega central,
  recepción en satélite, recolección en tienda, recogida del mensajero y confirmación física del
  cierre), cada una montando esa tarjeta.

- **R8 — Ubicuo.** El sistema DEBE conservar el servicio y el repositorio del pago por mensajero
  con **todas** sus lecturas de administración (cuentas por pagar del maestro, su versión
  paginada, su versión completa, el desglose de un mensajero y su versión completa), porque su
  superficie viva es `/wallet/mensajeros` y no la pantalla que se borra.

- **R9 — Ubicuo.** El sistema DEBE conservar el esquema de validación base del listado de pagos
  por mensajero, del que **deriva por extensión** el esquema de la vista del maestro.

- **R10 — Ubicuo.** El modelo de datos DEBE quedar intacto: ninguna tabla, columna, enum, RLS ni
  migración se crea, altera ni retira en esta ficha.

### Bloque C — la superficie de uso y su guardia

- **R11 — Ubicuo.** Al terminar la ficha, **ninguna** Server Action del módulo del pago por
  mensajero DEBE figurar en la lista de acciones sin superficie que produce la guardia de
  superficie de uso.

- **R12 — Ubicuo.** El módulo de Server Actions del pago por mensajero NO DEBE ganar ninguna
  anotación `@sin-superficie` nueva: la salida elegida es retirar, no tapar.

- **R13 — De estado.** MIENTRAS `tests/baseline-rojos.json` liste el archivo de la guardia de
  superficie de uso, el veredicto de esta ficha DEBE obtenerse del **contenido** de la lista de
  huérfanas que la guardia imprime, no del nombre del archivo en el baseline; y esa lista NO
  DEBE contener ninguna entrada atribuible a esta ficha.

- **R14 — Condicional.** SI esta ficha necesitara añadir cualquier archivo a
  `tests/baseline-rojos.json`, ENTONCES la ficha se DETIENE y se reporta al humano: un rojo
  propio metido en el baseline es exactamente el agujero que el baseline no cubre.

### Bloque D — la cobertura AJENA sobrevive

- **R15 — Ubicuo.** Todo archivo de test que cubra **otra** feature además de la que se borra
  DEBE seguir existiendo y seguir cubriendo esa otra feature. Solo se retira de él la parte que
  afirma sobre la pantalla borrada.

- **R16 — Ubicuo.** El censo compartido de tablas descargables DEBE quedar coherente con el
  árbol: sin la entrada del archivo borrado y con sus totales duros ajustados al número **medido**
  contra el árbol, no calculado de escritorio.

- **R17 — Ubicuo.** El censo compartido de archivos money-safe de la ficha 172 DEBE seguir
  existiendo, sin las rutas borradas y con el resto de su lista intacta.

- **R18 — Ubicuo.** La guardia de alcance de la ficha 173 DEBE seguir congelando las pantallas de
  dinero que sobreviven, con su control de no-vacuidad recalculado sobre las carpetas que quedan.

- **R19 — Condicional.** SI al retirar la pantalla el suelo de anti-vacuidad de una guardia
  compartida quedara por debajo de su umbral, ENTONCES el umbral se baja **nombrando la pantalla
  que desapareció**; SI el suelo sigue por encima, ENTONCES el umbral NO se toca.

- **R20 — Ubicuo.** La cobertura de la ficha 293 (el rótulo «Premio del ranking») DEBE seguir
  afirmándose sobre las superficies que sobreviven, y el número de superficies cubiertas DEBE
  quedar declarado por escrito en el propio test.

- **R21 — Ubicuo.** El control positivo del test de esquema de la ficha 44/172 —el que afirma que
  el módulo de acciones del pago por mensajero SÍ exporta lecturas— DEBE conservar **al menos dos**
  acciones vivas como testigo. Reducirlo a una lo deja a un borrado de volverse vacuo.

- **R22 — Ubicuo.** El test compartido de columnas de descarga de los dos libros del pago por
  mensajero DEBE conservar la aserción de orden **que nombra** la constante que sobrevive.

- **R23 — Ubicuo.** Ninguna ficha DEBE quedar con un requisito mapeado a un archivo de test que
  esta ficha borra: o la cita se repunta a un sustituto real, o queda anotada en su propio
  documento con el motivo escrito.

### Bloque E — la afirmación del estado final

- **R24 — Ubicuo.** El sistema DEBE incluir una guardia que afirme, sobre el árbol de archivos,
  el estado final completo de esta ficha: rutas ausentes, cámara compartida viva con sus
  importadores, seis superficies de escaneo montadas, acciones retiradas sin anotación de
  excusa, y baseline sin entradas nuevas atribuibles a la ficha.

- **R25 — Ubicuo.** Esa guardia DEBE auto-comprobar su propio detector: afirmar el tamaño de lo
  que leyó y demostrar, en las dos direcciones, que distingue una referencia de código de una
  mención en prosa. Una guardia estática rota no falla: calla.

### Bloque F — la verificación

- **R26 — Ubicuo.** El cierre de esta ficha DEBE verificarse con el gate **completo**
  (`./init.sh`), no con el rápido.
  *Motivo medido, no preferencia:* el diff toca `lib/types/**` y rutas cuyo nombre casa la lista
  de dinero (`pago`, `wallet`) bajo `lib/` y `app/`, así que `./init.sh --rapido` **se niega solo**
  y falla. No hay escape.

- **R27 — Ubicuo.** El informe de implementación DEBE contener, pegada, la lista de acciones sin
  superficie que imprime la guardia, para que el cumplimiento de R11/R13 se pueda leer en vez de
  creerse.

---

## Trazabilidad `R<n> → test`

| R | Test que lo cubre |
| --- | --- |
| R1 | `tests/unit/guards/rutas-336-retiradas.guardia.test.ts` › «las dos rutas y sus carpetas no están en el árbol» |
| R2 | idem + «`hooks/useQrNavigate.ts` no existe» |
| R3 | idem › «ningún módulo de producción referencia las rutas ni los símbolos borrados (sin contar comentarios)» |
| R4 | idem › «el módulo de acciones del pago por mensajero no exporta las tres lecturas de `/mis-pagos`» |
| R5 | `tests/unit/services/wallet-mensajero-service.test.ts` (sin los `describe` de la vista propia) + `pnpm run typecheck` |
| R6 | `tests/unit/guards/rutas-336-retiradas.guardia.test.ts` › «`QrScanner` sigue exportado y con sus importadores directos» + `tests/components/QrScanner.test.tsx` (intacto) |
| R7 | `tests/unit/guards/rutas-336-retiradas.guardia.test.ts` › «las seis superficies de escaneo siguen montando la tarjeta compartida» |
| R8 | `tests/unit/services/wallet-mensajero-service.test.ts`, `tests/unit/services/wallet-cuentas-paginado.test.ts`, `tests/unit/services/wallet-desglose-mensajero-descarga.test.ts`, `tests/unit/actions/wallet-mensajero-actions.test.ts`, `tests/unit/actions/wallet-mensajero-descarga-action.test.ts` |
| R9 | `tests/unit/actions/wallet-mensajero-actions.test.ts` › los casos de `listarPagosDeMensajeroAction` (su schema extiende el base) |
| R10 | `tests/integration/db/pago-mensajero-liquidacion.test.ts` (esquema y enums sin cambio) + ausencia de `db/migrations/**` en el diff |
| R11 | `tests/unit/guards/superficie-de-uso.guardia.test.ts` › R-A |
| R12 | `tests/unit/guards/rutas-336-retiradas.guardia.test.ts` › «ninguna acción del pago por mensajero lleva `@sin-superficie`» |
| R13 | `tests/unit/guards/rutas-336-retiradas.guardia.test.ts` › «el baseline no ganó entradas de esta ficha» + evidencia pegada (R27) |
| R14 | — (puerta de proceso: se verifica por el diff de `tests/baseline-rojos.json`, que debe ser vacío) |
| R15 | Los 14 archivos del censo de `design.md §4` siguen existiendo y verdes en `./init.sh` |
| R16 | `tests/unit/descarga/cobertura-tablas.guardia.test.ts` |
| R17 | `tests/unit/guards/liquidacion-money-safe.test.ts` › «el censo de archivos de la feature existe entero» |
| R18 | `tests/unit/guards/caja-173-alcance.guardia.test.ts` › «R63: ninguna de las pantallas congeladas sabe nada de la caja» |
| R19 | `tests/unit/descarga/contadores-cabecera.guardia.test.ts` + `tests/unit/descarga/columnas-asercion-de-orden.guardia.test.ts` + `tests/unit/descarga/adaptador-conjunto.guardia.test.ts` |
| R20 | `tests/components/PremioRankingRotulo.test.tsx` |
| R21 | `tests/integration/db/pago-mensajero-liquidacion.test.ts` › «las Server Actions del pago por mensajero NO exponen `registrarLiquidacionMensajeroAction`» |
| R22 | `tests/unit/descarga/wallet-mensajero-descarga-columnas.test.ts` › «el DESGLOSE por cierre (admin) declara sus columnas en el orden de la pantalla» |
| R23 | `tests/unit/guards/test-citado-desaparecido.guardia.test.ts` |
| R24 | `tests/unit/guards/rutas-336-retiradas.guardia.test.ts` (el archivo entero) |
| R25 | idem › «AUTOCOMPROBACIÓN: el detector ve el código y no lee la prosa» y «anti-vacuidad: el árbol se leyó entero» |
| R26 | `./init.sh` completo, con su salida pegada en `progress/impl_336.md` |
| R27 | `progress/impl_336.md` (criterio de "hecho" de la task correspondiente) |

---

## Preguntas abiertas

1. **La capacidad desaparece sin sustituto.** Tras esta ficha, un mensajero no tiene NINGÚN sitio
   en la app donde ver lo que Ordenex le debe. ¿Se registra una ficha de seguimiento («el
   mensajero ve su cuenta por pagar en otro sitio») o se cierra el asunto? El spec asume que
   **no** se registra —es lo que la decisión dice literalmente— pero conviene que sea explícito.

2. **La cita rota de la ficha 172.** `specs/172-liquidacion/tasks.md` mapea su **R54** («el
   mensajero ve el pago y su reverso») a `tests/integration/mis-pagos-page.test.tsx`, que esta
   ficha borra. Medido: **no existe sustituto** —esa conducta solo se observaba en la pantalla que
   se va—. Se propone **anotar** la cita en el propio `tasks.md` de la 172 con el motivo escrito
   (es el mecanismo que la guardia ofrece). ¿Se confirma tocar un `tasks.md` ajeno para eso, o se
   prefiere otra vía?

3. **Los tipos que quedan sin referencia.** Al retirar los tres métodos del servicio, algunos
   alias de tipo (el payload del listado propio, el input del listado paginado del mensajero)
   pueden quedar sin ninguna referencia. ¿Se retiran también, o se toleran como tipos huérfanos
   para minimizar el diff en `lib/types/**` —que es lo que dispara el gate completo—? El spec
   propone retirarlos **uno a uno y solo si se comprueba que no queda ninguna referencia**.

4. **El E2E.** `e2e/wallet-mensajeros.spec.ts` tiene cuatro `describe`, dos de ellos de
   `/mis-pagos`. En este repo los E2E **no se ejecutan** (no hay harness; los specs los declaran
   `NOT EXECUTED`), así que editarlos es contabilidad, no verificación. ¿Se editan los dos
   `describe` (propuesta del spec) o se deja el archivo tal cual con una nota?

5. **La prosa rancia.** `lib/config/moneda.ts`, `lib/interfaces/services/ILiquidacionService.ts` y
   varios comentarios de guardias nombran `/mis-pagos` **en prosa**. Ninguno es una referencia de
   ejecución y ninguno rompe nada. ¿Se corrigen en esta ficha (más diff, mismo gate) o se dejan?
   El spec propone corregir solo los dos de `lib/` y dejar los comentarios de las guardias, que
   son registro histórico de por qué un número es el que es.
