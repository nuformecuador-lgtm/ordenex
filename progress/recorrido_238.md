# T5.6 — Ver la app: el recorrido de la feature 238, anotado

> **Hecho el 2026-08-19 por el leader**, contra la base **local** y el servidor de dev, conduciendo
> Chromium con Playwright. Es **lo que se vio en pantalla**, con el texto leído del navegador.
> Rama `feature/238-confirmacion-fisica-cierre`, sobre `59dc3fcf`.

---

## 1 · El cierre, antes de aprobar

Cierre `solicitado` del mensajero Marco con **12 gestiones**: 5 entregadas, 2 devueltas, 2
rechazadas, 2 reprogramadas y **1 incidente**. Entrando como `admin`, `/cierres-admin` lo lista con
su botón «Ver / decidir», y el detalle abre con el desglose de siempre y sus dos botones,
«Rechazar» y «Aprobar».

## 2 · La ventana, al pulsar «Aprobar»

```
Confirmar los paquetes que vuelven

Antes de aprobar, tené delante cada paquete que vuelve a bodega y confirmá su guía:
escaneá el código o escribí el número.

Paquetes confirmados: 0 de 6.
Faltan 6 paquetes por confirmar. Si alguno no llegó, rechazá el cierre indicando cuáles faltan.
1 incidente de este cierre no se escanea: ese paquete no vuelve a bodega, se indemniza.
   Nº Guía 990008 · QA-R-0008 · Fernando Castro

[Escanear con cámara]  ·  O INGRESA MANUALMENTE  ·  Número de guía  [Confirmar]

Reprogramadas (2)   Nº Guía 990001 · Reprogramada · Pendiente · Karla Vargas · Tania
                    Nº Guía 990012 · Reprogramada · Pendiente · Oscar Brenes · Tania
Devueltas (2)       Nº Guía 990004 · … · Pendiente
                    Nº Guía 990011 · … · Pendiente
Rechazadas (2)      Nº Guía 990002 · … · Pendiente
                    Nº Guía 990010 · … · Pendiente
```

Lo que **cumple lo que D2 exigía hacer visible**: el bloqueo **habla**. No dice «no podés aprobar»,
dice **cuántas faltan** y **qué hacer si un paquete no llegó** (rechazar el cierre indicando
cuáles). Y la exclusión de incidentes **nombra el paquete concreto**, no se queda en una regla.

## 3 · Los cuatro desenlaces de una guía leída, ejercidos uno a uno

| Lo que se tecleó | Lo que dijo la pantalla | Contador |
| --- | --- | --- |
| **990005**, la de una **entregada** de este mismo cierre | «Esa guía es de este cierre, pero ese paquete no vuelve a bodega. **Resultado: Entregada.**» | 0 de 6 |
| **990008**, la del **incidente** | «Esa guía es de este cierre, pero ese paquete no vuelve a bodega. **Resultado: Incidente.**» | 0 de 6 |
| **999999**, que no está en el cierre | «Esa guía **no pertenece** a este cierre.» | 0 de 6 |
| **990001**, buena | — | **1 de 6** |
| **990001 otra vez** | «Esa guía **ya está confirmada. No se cuenta dos veces.**» | 6 de 6 (no subió a 7) |

Los tres rechazos **no marcan ninguna fila y no suben el contador**. El mensaje del incidente es
distinto del de «no pertenece», que es lo que R11 pedía: «no pertenece» invita a buscar el paquete,
y el incidente **no va a aparecer** —se indemniza—.

## 4 · Cerrar sin completar (R35)

Con **2 de 6** confirmadas, «Cancelar» y volver a «Aprobar»: **sigue en 2 de 6**. Lo escaneado no se
pierde por cerrar la ventana.

## 5 · Al completar, el copy no miente

Con las seis puestas:

```
Paquetes confirmados: 6 de 6.
Están todos. Queda indicar los montos de los incidentes.
```

**No dice «ya se puede aprobar»**, porque no se puede: el botón siguiente dice «Continuar» y lleva al
sub-modal de montos. Es la corrección de copy que el frontend encontró leyendo, y que **ninguna
mutación habría cazado** — un texto verdadero y un texto falso pasan los mismos tests.

Después, el sub-modal de la 158 intacto («Indemnizar los incidentes del cierre»), con su propio
bloqueo hablado, y el botón final **«Aprobar e indemnizar»**.

## 6 · Lo que quedó escrito en la base

Tras aprobar (`Cierre aprobado correctamente.`), medido contra Postgres:

| resultado | guía | `confirmada_fisica_at` | indemnización |
| --- | --- | --- | --- |
| entregada ×5 | 990003/5/6/7/9 | **NULL** | — |
| reprogramada ×2 | 990001, 990012 | `23:36:01.736Z` | — |
| devuelta ×2 | 990004, 990011 | `23:36:01.736Z` | — |
| rechazada ×2 | 990002, 990010 | `23:36:01.736Z` | — |
| **incidente** | 990008 | **NULL** | **12500** |

- **marcadas 6 · que vuelven 6 · coinciden.**
- **Ninguna marcada que no vuelva** — ni una entregada, ni el incidente.
- `cierre_dia.resuelto_at` = `23:36:01.660Z` y las marcas `…736Z`: **76 ms**, la misma transacción.
  La marca no es un reloj aparte.

## 7 · El techo real: la lista con doce filas — lo que jsdom NO puede decir

Medido en un **portátil corriente (1366×768)**, que es donde bodega mira, no en un monitor de 27".
Cierre reconstruido con **12 paquetes que vuelven** (el máximo medido en producción es 14):

| | |
| --- | --- |
| filas «Pendiente» pintadas | **12** |
| contador, sin desplazar | `y = 111` — **dentro del viewport** |
| desplazamiento aplicado a la lista | `scrollTop 628 de 628` (hasta el fondo) |
| contador, tras desplazar hasta el final | `y = 111` — **sigue dentro del viewport** |

**El encabezado no se mueve**: lo que se desplaza es la lista, debajo. El contador y el motivo del
bloqueo siguen a la vista con la lista en el fondo — que es exactamente lo que la medición de T0.1
exigía y lo que un test de jsdom **no puede afirmar**, porque no tiene layout.

## 8 · Un hallazgo que no es de esta ficha, y es bueno

Al reconstruir el cierre de doce filas moví gestiones de un cierre a otro **en la base**, y la
pantalla devolvió un error interno. La causa, en el log:

```
CierreDetalleFaltanteError: cierre_detail: falta el detalle congelado de la orden … en el cierre …
La aprobacion se aborta: sin snapshot no se puede liquidar sin arriesgar un descuadre (feature 69/R14).
```

**La app se negó a liquidar en vez de liquidar mal.** El destrozo era mío, no de la feature; lo que
esto demuestra es que la invariante de la 69 está viva y muerde. Se reparó devolviendo cada gestión
al cierre donde su orden **sí** tiene snapshot, usando `cierre_detail` como fuente.

## 8bis · EL HALLAZGO GORDO: un cierre que no se podía aprobar NUNCA

Al reconstruir el cierre de doce filas apareció esto, y **no** es artefacto de la reconstrucción:

```
Paquetes confirmados: 11 de 12.     ← clavado
[Continuar]  deshabilitado
```

**La causa.** `interpretarLectura` resolvía `numGuia → gestión` con un `find`, que devuelve
**siempre la primera**. Si un cierre tiene **dos gestiones vivas de la misma orden** —y por tanto la
misma guía—, la primera lectura confirma la primera fila; la segunda lectura vuelve a encontrar
**esa misma** fila, la ve confirmada y responde «Esa guía ya está confirmada». **La segunda fila se
queda pendiente para siempre y el cierre no se puede aprobar por ninguna vía.**

**No es hipotético.** Medido contra producción (MCP, solo lectura, 2026-08-19):

| medida | valor |
| --- | --- |
| pares (cierre, orden) con **más de una** gestión viva | **1** |
| de esos, con la gestión **que vuelve** repetida | **1** |
| universo de pares (cierre, orden) vivos | 48 |

Hoy no hace daño porque ese cierre ya está aprobado. **El siguiente que ocurra deja a bodega con un
cierre que no puede cerrar y sin ningún mensaje que lo explique.**

**El servidor no tenía el candado**: su regla de duplicado es por `gestionId` (`vistos.has(...)`) y
el chequeo de guía compara contra la guía real de cada orden, así que **dos entradas con la misma
`numGuia` y distinto `gestionId` son válidas**. Era un bloqueo puramente de pantalla.

**Arreglado**: una lectura confirma **todas** las filas pendientes de esa guía —hay un solo paquete
físico— y el contador pasa a contar **paquetes**, no filas. R32 se conserva y salta sólo cuando esa
guía ya no cubre nada. Apareció además una segunda cara que yo no había visto: una `entregada` que
comparte guía con una `devuelta` bloqueaba por el mismo `find`.

**Verificado después del arreglo, en pantalla y contra la base:**

```
Paquetes confirmados: 11 de 11.
cierre: aprobado
marcadas: 12 · que vuelven: 12 · coincide: true      ← las DOS filas de la guía repetida
incidente 990008: confirmada_fisica_at NULL, indemnizacion 9000
```

Y las dos devoluciones (990004, 990011) **llegan a `/novedades`** del lado tienda, que es la última
pata que T5.6 pedía.

## 9 · Estado de la base local al terminar

Un cierre quedó `solicitado` con 12 retornables + 1 incidente (los datos del punto 7), y otro quedó
**sin gestiones vivas** por el movimiento del punto 8. Es **base local de pruebas**; producción y
preview no se tocaron en ningún momento — lo único que se hizo contra producción fue la **lectura**
de T0.1.
