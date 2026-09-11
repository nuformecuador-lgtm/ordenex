# 414 — Diseño

**Frontend puro, tres archivos de producción.** Cero migraciones, cero tablas, cero RLS, cero
endpoints, cero cambios de DTO, cero `lib/`. Los datos ya viajan y no cambian: `CierreDetalleGestion`
sigue siendo el mismo tipo, con el mismo `esRechazoSla: boolean` y el mismo `desdeAyudaTienda: boolean`
—los dos **obligatorios** en el DTO desde la 102 y la 237—.

## 1. Modelo de datos, rutas e integraciones

| Aspecto | Decisión |
| --- | --- |
| Tablas / columnas / enums | **Ninguno.** No se lee ni se escribe nada nuevo. |
| Migraciones / `down.sql` / RLS | **Ninguna.** El gate no las necesita porque no existen. |
| Rutas, endpoints, Server Actions | **Ninguno nuevo.** `verCierrePasado` se usa tal cual está. |
| Contrato de E/S del servidor | **Sin cambios.** `CierreDiaRepository.ts:295` sigue emitiendo `esRechazoSla: false` para esta vista, y `:300` sigue emitiendo `desdeAyudaTienda` derivado. Esta ficha **no** reabre la 102. |
| Integraciones externas | Ninguna. |

Lo único que cambia es **qué pinta un componente cuando la audiencia es `mensajero`**.

## 2. La decisión, en una frase

> En el comprobante, **cada audiencia ve lo mismo que ya ve en su propia tabla**: fuera el distintivo
> que no puede afirmar nada cierto, dentro la marca que sí.

No es esconder una verdad incómoda ni añadir adorno. Es retirar una **afirmación que el emisor no
puede sostener** y publicar una que **el servidor ya deriva a propósito para esta audiencia**. La
diferencia con el texto del motivo es exactamente esa: el texto largo de la 408 **sí** se sostiene
solo, porque lo deriva del propio `motivo` guardado, que es un dato que esta vista **sí** tiene.

| | Lo deriva el servidor para el mensajero | ¿Puede afirmarlo el comprobante? |
| --- | --- | --- |
| `esRechazoSla` | **No** — `false` literal, decisión 102/R11 | No. Se retira. |
| `desdeAyudaTienda` | **Sí**, y con su motivo escrito: *«es SU cierre el que tiene que decir que la gestión la hizo la tienda»* (237/D6/R41, `CierreDiaRepository.ts:296-300`) | Sí. Se publica. |

Tras el cambio, las tres superficies del mensajero cuentan lo mismo, que hoy no pasa:

| Superficie del mensajero | Origen | «La tienda» |
| --- | --- | --- |
| Tabla en vivo (`CierreDiaModule.tsx:1064-1071` / `:1097-1105`) | no | **sí** |
| Descarga (`cierre-dia-descarga-columnas.ts`) | no (no existe la columna) | no (deuda ajena, no se estrena aquí) |
| Comprobante (`cierre-factura.tsx`) | **hoy sí → no** | **hoy no → sí** |

## 3. El cambio, línea a línea

Archivo principal: `app/(app)/cierres-admin/_components/cierre-factura.tsx`, dentro de `FilaGestion`,
que ya recibe `esMensajero: boolean` (`:1390`) y ya lo usa para decidir qué dinero enseña (`:1459`,
`:1462`, `:1527`).

**(a) El distintivo de origen, `:1548-1566`.** El `<span>` del badge pasa a montarse sólo cuando la
audiencia no es la del mensajero:

```tsx
{esMensajero ? null : (
  <span className="flex items-center gap-1">
    {/* …las dos ramas Automático/Manual, sin tocar ni un rótulo ni una nota… */}
  </span>
)}
```

⚠️ **Sólo el `<span>` del badge.** El `DatoFila` de «Ingreso de bodega por rechazos» (`:1540-1547`)
vive en el MISMO fragmento `g.resultado === "rechazada"` y **se queda exactamente como está** (R3).

**(b) El argumento del motivo, `:1536`.** Pasa de `g.esRechazoSla` a `!esMensajero && g.esRechazoSla`.
El parámetro se llama `hayMarcadorDeOrigen` y ahora, en esta superficie, dice la verdad por
construcción: si la audiencia es la del mensajero **no hay marcador**, venga lo que venga del
servidor. Para el admin la expresión resuelve a lo mismo de hoy, carácter por carácter.

**(c) La marca «La tienda».** Un `DatoFila` —o un `<span>` hermano— dentro del bloque desplegado
(`{open ? … : null}`, `:1474`), **FUERA del fragmento `g.resultado === "rechazada"`**, condicionado a
`esMensajero && g.desdeAyudaTienda`, con el mismo `Badge variant="secondary"` + `title` + `aria-label`
que usa la tabla en vivo.

Dos detalles que parecen de forma y no lo son:

- **Fuera del fragmento `rechazada`.** `desdeAyudaTienda` es ortogonal al resultado: en la tabla en
  vivo vive en `COLUMNAS_COMUNES`, o sea en las cinco secciones. Anidarlo donde estaba el distintivo
  que se retira dejaría muda una **entrega** registrada por la tienda. Es la trampa que R7 va a buscar
  con dos resultados distintos.
- **En el bloque desplegado y no pegado al número de guía**, que es donde lo pone la tabla en vivo. El
  motivo es accesibilidad, medido en el archivo: en `FilaGestion` la celda de la guía está **dentro
  del `<button>` de la fila** (`:1422-1472`), y ese botón trae su propio `aria-label` (`:1427-1431`),
  que **sustituye** al contenido como nombre accesible — la nota del badge no se anunciaría. En el
  bloque desplegado sí, igual que le pasa hoy al distintivo de origen. La diferencia con la tabla en
  vivo es que allí la celda no está dentro de ningún botón.

**(d) Un comentario corto** anclando las dos decisiones: por qué se declina el origen (no se deriva
para esa vista, `CierreDiaRepository.ts:295`) y que **ésa es la única condición a cambiar** el día que
la 102 se reabra.

Nada más: sin props nuevas, sin estado, sin vocabulario nuevo.

## 4. Dónde viven los dos textos de «La tienda», y por qué se mueven

Hoy `GESTION_TIENDA_BADGE_LABEL` y `GESTION_TIENDA_BADGE_NOTA` se **declaran y exportan desde**
`CierreDiaModule.tsx:1079-1087`.

**No se pueden importar desde ahí:** `CierreDiaModule.tsx:47-50` ya importa `CierreFacturaDetalle` de
`cierre-factura.tsx`. Que `cierre-factura` importase de vuelta de `CierreDiaModule` sería un **ciclo**.

Se mueven al sitio que este repo tiene para esto, por la puerta que ya está abierta y sin estrenar ni
una dependencia:

| Archivo | Cambio |
| --- | --- |
| `cierres-admin/_components/cierre-labels.ts` | **declara** las dos constantes (módulo PURO, sin React: son dos strings) |
| `cierres-admin/_components/cierre-detalle-shared.tsx` | **dos nombres más** en el bloque de re-exportación que ya existe (`:125-174`), igual que hizo la 408 con `motivoGestionLegible` |
| `cierre-dia/_components/CierreDiaModule.tsx` | borra las dos declaraciones y **añade los dos nombres** a su import de `cierre-labels` que ya está escrito (`:58-65`) |
| `cierres-admin/_components/cierre-factura.tsx` | **añade los dos nombres** a su import de `./cierre-detalle-shared` que ya está escrito (`:41-91`) |

Nadie las importaba de `CierreDiaModule` —medido: el único consumidor es el propio archivo, y los
tests las teclean a mano (`CierreDiaModule.test.tsx:1464`, `progress/impl_237_frontend.md:478`)—, así
que el movimiento no rompe a ningún llamador y no hace falta re-exportarlas desde su sitio viejo.

**La alternativa —copiar los dos literales en `cierre-factura.tsx`— está descartada** y es la razón de
ser de R9: dos copias del mismo texto de cara al usuario divergen a la primera corrección, y la regla
escrita de esta familia de archivos es que la pantalla y el archivo dicen lo mismo **porque leen del
mismo sitio**, no porque hoy coincidan dos literales (170/R8, repetida por la 408 §3).

## 5. El fallo mudo de esta ficha, y cómo queda protegido

El aviso de la 408 aplica aquí: en esta vista `esRechazoSla` es **siempre** `false`, así que un `false`
fijo es hoy **indistinguible** del código correcto. Por eso el discriminador de esta ficha **no es ese
booleano**: es `esMensajero`, que viene de la prop `audiencia` y **se puede producir en sus dos
estados** desde un test de componente. Eso es lo que hace R1/R2 y R7/R8 parejas medibles y no
declaraciones de intenciones.

Queda un solo punto donde el booleano del servidor interviene: el argumento (b). Ahí la protección es
el **caso 3 de R4** —audiencia mensajero **con** `esRechazoSla: true`—, un estado que el servidor no
produce pero que el componente sí recibe en un test. Es el único aserto capaz de distinguir
`!esMensajero && g.esRechazoSla` de `g.esRechazoSla`, y **no atornilla ningún bug**: afirma la
dirección correcta (sin marcador ⇒ texto largo), justo al revés que el test que el reviewer de la 408
declinó escribir (`progress/review_408.md` §5.2, punto 2).

`desdeAyudaTienda` **no tiene ese problema**: el servidor lo deriva y emite sus dos valores, así que
presencia y ausencia son estados reales y R7/R8 los ejercen los dos.

Lo que **no** se hace, y se dice: una guardia sobre el texto fuente del tipo «`cierre-factura.tsx`
contiene `esMensajero ? null :`». Mide escritura, no comportamiento, y este repo ya midió que esa clase
de guardia se queda verde cuando se cambia sólo una de varias escrituras.

## 6. Alternativas descartadas

**A. Pintar un tercer estado, «sin determinar», en vez de forzar «Manual».** Descartada, y no por
coste: por contenido. (1) El sistema **sí** sabe el origen —lo tiene el historial—; lo que no lo sabe
es esta vista. Un rótulo que dice «no se sabe» afirmaría del sistema algo falso. (2) Se pintaría en
**todas** las filas rechazadas del mensajero, incluidas las que **él mismo** registró: cambiaría una
etiqueta que hoy acierta por casualidad («Manual») por una vaga en el 100 % de los casos. (3) Estrena
vocabulario visible —rótulo + nota— en una superficie de dinero, y el vocabulario de este repo se
aprueba, no se inventa (lección de la 73 y de la 405). (4) No responde ninguna pregunta que el
mensajero tenga: entre el texto del motivo y la marca «La tienda», la fila ya dice quién hizo qué.

**B. Derivar el origen también para la vista del mensajero.** Es la alternativa **G** del spec de la
408, descartada allí por ser backend. Aquí se descarta con un motivo más fuerte, y medido:
**rompería la 408.** Si `esRechazoSla` pasara a ser `true` en `/cierre-dia`, los 8 llamadores de esa
pantalla (4 renders + 4 celdas de descarga) resolverían a la **variante corta** del motivo, y esa
pantalla **no tiene columna «Origen»** — el mensajero se quedaría sin saber que el rechazo no fue
suyo. Es literalmente la **mutación 6** del spec de la 408, reaplicada por su reviewer: **6 rojos en 2
archivos** (`progress/review_408.md` §4). O sea: la ficha recién mergeada está *diseñada* para ponerse
roja si alguien hace esto. Su coste completo, si aun así se eligiera:
- **Reabre la 102/R11**, que dice con todas las letras: «la vista EN VIVO del mensajero NO expone el
  desglose SLA → `false`; la clasificación SLA sólo la deriva el detalle del admin (38/40) desde el
  historial». Esa frase está escrita en el código (`CierreDiaRepository.ts:293-295`) y en
  `specs/102-rechazos-sla-visible/`.
- Toca `lib/repositories/CierreDiaRepository.ts`: hay que añadir la relación `historialEstados`
  acotada a `WITH_DETALLE`, que alimenta **dos** lecturas (`:525` en vivo y `:1062` el cierre pasado),
  o sea una relación más en la proyección que más filas trae de esa pantalla.
- Obliga a rehacer el contrato de `motivoGestionLegible` en sus **18** puntos de llamada, porque el
  booleano dejaría de significar «hay marcador» en `/cierre-dia`.
- Cambia zona: la ficha pasa de `frontend` a `fullstack` y arrastra tests de repositorio y de servicio.
- Y al final **sigue habiendo que tocar el comprobante**, que es lo que arregla esta ficha. Un camino
  caro que además no evita el barato.

**C. Quitar la rama «Manual» del comprobante para todas las audiencias** (que la ausencia signifique
«manual», como hace el badge «La tienda»). Descartada: le quita al admin una afirmación que ahí **sí**
es cierta y está cubierta por sus tests, a cambio de nada — el mensajero seguiría necesitando el mismo
cambio, porque para él la ausencia tampoco significaría «manual».

**D. Cambiar la nota del badge «Manual» por una redacción que no acuse a nadie** («registrado a mano»).
Descartada: el rótulo seguiría diciendo `Manual` sobre un rechazo automático. Maquilla la
contradicción en vez de quitarla, y además rediseña el marcador del admin, que está fuera de alcance.

**E. Que el comprobante decida por `motivo` en vez de por audiencia** (esconder el badge sólo en las
filas cuyo motivo sea la plantilla del cron). Descartada: sería derivar el origen en el cliente a
partir de un texto, exactamente el emparejamiento laxo que la 408 prohibió (R2, «el texto libre del
mensajero es sagrado»), y dejaría «Manual» mintiendo igual en los rechazos que registró la tienda.

**F. Copiar los dos literales de «La tienda» en `cierre-factura.tsx`** en vez de moverlos al módulo
puro. Descartada en §4: dos copias del mismo texto divergen, y R9 existe para que no puedan.

## 7. Contratos de E/S que se tocan

Ninguno cambia de forma. Para que quede asentado por escrito:

| Símbolo | Antes | Después |
| --- | --- | --- |
| `CierreFacturaDetalleProps.audiencia` | `"admin" \| "mensajero"`, default `"admin"` | igual |
| `FilaGestion({ esMensajero })` | `boolean`, default `false` | igual; **gana dos usos más** |
| `CierreDetalleGestion.esRechazoSla` / `.desdeAyudaTienda` | `boolean` obligatorios | igual; el servidor sigue emitiendo lo mismo |
| `motivoGestionLegible(motivo, hayMarcadorDeOrigen)` | firma y cuerpo | **sin tocar**; sólo cambia el argumento que le pasa `cierre-factura.tsx:1536` |
| `RECHAZO_*_BADGE_*` | 4 constantes | **sin tocar, ni un carácter** |
| `GESTION_TIENDA_BADGE_LABEL` / `_NOTA` | declaradas en `CierreDiaModule.tsx` | **mismo texto**, declaradas en `cierre-labels.ts` y re-exportadas por `cierre-detalle-shared.tsx` |

## 8. Deuda anotada (no es de esta ficha, y no se decide aquí)

1. **El renglón «Ingreso de bodega por rechazos» en el comprobante del mensajero.** Es plata de la
   BODEGA pintada a quien las otras cinco ramas de ese mismo archivo se la esconden
   (`cierre-factura.tsx:1853, 1899, 1933, 1955, 1984`). Hallazgo del reviewer de la 408, ajeno a esta
   contradicción. **Fuera por decisión del humano el 2026-09-10**, y con la razón dicha: no está
   medido si ese importe afecta a la liquidación del mensajero, y una línea de dinero no se mueve a
   ciegas. **Lo que hay que medir primero, para quien la retome:** *¿ese importe entra en lo que se le
   paga al mensajero, sí o no?* Se responde en el dinero, no leyendo el componente —`pagoMensajero` e
   `ingresoBodegaRechazo` son dos columnas snapshot distintas (39 y 56)—. Hasta entonces, R3 lo
   conserva exactamente como está.
2. **Si algún día se deriva el origen para la vista del mensajero, ¿debe verlo?** **No se decide hoy**
   (humano, 2026-09-10): sería escribir una regla para un mundo que no existe. Queda como lo que es —
   **una pregunta que hereda quien reabra la 102**, no una pregunta abierta de esta ficha. El sitio ya
   tiene nombre y dirección: la condición (a) de §3, una sola línea, con su comentario puesto.

## 9. Verificación

⚠️ **El gate de esta ficha es `./init.sh` completo.** Los archivos que se tocan llevan `cierre` en el
nombre y `cierre` está en la lista de nombres de dinero de `docs/verification.md`: `--rapido` **se
niega por diseño**, también para abrir el PR. Contar con ~4 minutos y mirar los `skipped`, no sólo el
veredicto.

**Tests (el mapa `R<n> → test` está requisito por requisito en `requirements.md`):**

- `tests/components/ComprobanteMensajeroOrigenRechazo.test.tsx` *(nuevo)* — R1, R2, R3, R4, R7, R8.
- `tests/components/CierreDiaComprobanteMarcasDeOrigen.test.tsx` *(nuevo)* — R5, R9.
- Sin tocar, deben seguir verdes: `CierreMotivoRechazoAutomatico.test.tsx`, `CierresAdminModule.test.tsx`,
  `CierreDiaModule.test.tsx`, `CierreDiaMotivoRechazoAutomatico.test.tsx`, `CierreFacturaPapel.test.tsx`,
  los tres de `tests/unit/descarga/` y `cierre-detalle-superficies.guardia.test.ts` — R6.

**Todos los literales se afirman a mano.** Ni un test compara contra `RECHAZO_MANUAL_BADGE_LABEL`,
`RECHAZO_MANUAL_BADGE_NOTA`, `GESTION_TIENDA_BADGE_*` ni contra `motivoGestionLegible`: eso es
«aserción contra su propia fuente» y sale verde aunque las palabras se rompan. Se teclea `"Manual"`,
`"Rechazo registrado manualmente por el mensajero."`, `"Automático"`, su nota completa, `"La tienda"`,
su nota completa y `"Dirección errada · lo rechazó el sistema al vencerse el plazo de la devolución"`.

**El control de no-vacuidad no es opcional.** El bloque desplegado vive dentro de `{open ? … : null}`
(`cierre-factura.tsx:1474`): un test que afirme la ausencia de algo **sin desplegar la fila pasa en
verde sin el arreglo**. Cada caso de ausencia afirma primero algo que sólo existe con la fila abierta.

**Mutaciones obligatorias, cada una con su número de rojos anotado en `progress/impl_414.md`:**

1. revertir (a): volver a pintar el distintivo de origen para el mensajero → R1, R4 y R5;
2. ocultar el distintivo **también** para el admin → R2 (y debe caer `CierreMotivoRechazoAutomatico`);
3. volver a `g.esRechazoSla` en el argumento (b) → **sólo** el caso 3 de R4. Si no enrojece, ese caso
   no mide lo que dice;
4. esconder el fragmento `rechazada` entero para el mensajero (se lleva el renglón del ingreso) → R3;
5. **anidar la marca «La tienda» dentro del fragmento `rechazada`** → el caso de la `entregada` de R7.
   Es el fallo mudo de la mitad nueva: nadie ve un error, sólo una entrega sin marcar;
6. pintar la marca «La tienda» también para el admin → R8;
7. **duplicar** el literal de la nota de «La tienda» dentro de `cierre-factura.tsx` con una palabra
   cambiada, en vez de leerlo del módulo puro → R9. Es la única forma de que las dos superficies
   diverjan una vez movida la constante, y es exactamente lo que R9 existe para impedir;
8. quitar el control de no-vacuidad de los casos de ausencia y aplicar la mutación 1 → los casos deben
   pasar en VERDE. Es la autocomprobación del propio test: demuestra que el control es lo único que
   impide el falso verde.

Ninguna de las siete primeras con cero rojos. Un arnés que diga «superviviente» sin haber ejecutado un
test no vale.
