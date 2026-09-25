# Ficha 460 — la ayuda y el asistente al día con la 454, la 456 y la 459

Rama `feature/460-ayuda`, nacida de `origin/dev` en `bf036502` (merge del PR #822, la 459).
Solo `docs/ayuda/**` y un test. Ningún archivo de la app tocado.

## Páginas tocadas (todas con `actualizado: 2026-09-25` y `fuentes:` ampliadas)

| Página | Qué se añadió |
| --- | --- |
| oficina/wallet-caja | 459 entera: Flujo de dinero registrado / Dinero en caja / Movimiento neto del periodo, por qué el flujo sale negativo, «Lo que Ordenex les debe a las tiendas», barra solo con saldo inicial, los 7 conceptos en 3 grupos, **Pago por cuenta vs Cobrar un costo con ejemplo (₡50.000 a Facebook)**, qué pide el pago por cuenta, saldo inicial/aporte (la app nunca propone cifra, solo uno), anulación con motivo y movimiento contrario, comprobante, fechas en hora de Costa Rica, cobros reclasificados |
| oficina/wallet-tiendas | Las 4 cifras del desglose; Pago por cuenta de la tienda vs Cobro de Ordenex vs Pago por cuenta anulado; no cuenta como pago a la tienda; cobros reclasificados se siguen viendo como Cobro de Ordenex |
| tienda/mi-wallet | Conceptos reales del libro (COD recaudado, Flete, Cobro de Ordenex, Pago por cuenta…); «Un pago que Ordenex hizo por tu cuenta»; el comprobante no se abre desde Mi wallet (P10 de la 459) |
| oficina/cierres | Aprobar aplica el estado real (454); rechazar no mueve estados; no se traspasa ni cambia el día con gestión pendiente; Corregir el resultado / métodos de pago (maestro/admin) |
| oficina/ordenes, tienda/ordenes | Botón (i) (456); nota «Resultado · pendiente de confirmación» y nota de ayuda; eventos de la línea de tiempo |
| tienda/novedades | La ayuda es un aviso, no un estado; Habilitar cierra la ayuda; «Resolver la orden por tu cuenta» queda pendiente de confirmación |
| mensajero/reparto | Tabla de gestión con los 5 botones reales y el nombre de su resultado; «pendiente de confirmación»; Solicitar ayuda / Recuperar / Con ayuda solicitada; botón (i). Corrige «la tienda pidió ayuda» (era al revés) |
| mensajero/cierre-del-dia | Qué frena la solicitud; al aprobar se confirma el estado; Devolver a gestión solo antes de solicitar (corrige el texto viejo, que decía «sale de ese cierre»); qué es Novedad interna |
| publico/rastreo-de-paquete | «Rastrear envío» de la página principal, nota pendiente, y **la tabla de los 20 estados con los textos del botón (i)**. Al ser `publico`, llega al contexto de TODOS los roles |
| satelite/en-bodega, oficina/monitoreo, oficina/incidentes, compartido/analitica | Botón (i), nota de pendiente, Estado vs Resultado del día, nombre de la cifra de caja en analítica |
| oficina/configuracion-api | Por qué una orden entregada sigue en reparto para el integrador (estado al aprobar; `orden.gestion_registrada`, `orden.ayuda_solicitada`/`orden.ayuda_resuelta`) |

Decisiones de redacción impuestas por la guardia G2 de la 455 (sigue verde):
- «Ayuda solicitada a la tienda» es nombre retirado para `docs/ayuda` y no tiene excepción ahí: se
  describe como «una nota que avisa que se solicitó ayuda a la tienda».
- El texto aprobado de «Novedad interna» contiene «sin gestionar», frase vetada en docs: se
  escribió «terminó el día con el paquete encima y sin registrar qué pasó con él».

## Tests

`tests/unit/asistente/contexto-460.test.ts` (23 casos): arma el contexto con `contextoPara` para
cada rol y afirma con literales que la oficina recibe la diferencia pago por cuenta / cobrar un
costo (con el ejemplo), flujo vs dinero en caja, saldo inicial, anulación, comprobante y hora de
Costa Rica; que mensajero/tienda/satélite NO reciben la ayuda de la caja; que el mensajero recibe
«pendiente de confirmación», Solicitar ayuda, Recuperar y Devolver a gestión; la tienda, la nota y
«la ayuda es un aviso»; el satélite, la nota y el doc de cierres; y que los 5 roles reciben la tabla
de estados, con una fila por cada estado vigente de `NOMBRE_ESTADO`.

Mutación comprobada: quitar «pendiente de confirmación» de reparto.md y «hacia otra persona?» de
wallet-caja.md → 3 casos rojos; restaurado → verde.

## El asistente, preguntado de verdad

Script de un solo uso fuera del repo: mismo `instruccionesDelSistema(rol)` + `contextoPara(docs,
rol)` que arma `/api/asistente`, llamando a `AnthropicAsistenteClient` con la `ANTHROPIC_API_KEY` del
`.env` (sin sesión ni tope diario). Rol por pregunta: maestro, adminTienda, maestro, mensajero.
Respuestas literales:

```text
MODELO: claude-sonnet-5

===== [maestro] ¿qué diferencia hay entre pago por cuenta y cobrar un costo?

La diferencia está en **si salió plata de la caja hacia un tercero, o no**:

| | Pago por cuenta de una tienda | Cobrar un costo a una tienda |
| --- | --- | --- |
| **Cuándo se usa** | Ordenex **le pagó a alguien más en nombre de la tienda**: su proveedor, su publicidad, su personal | Ordenex **le cobra algo** a la tienda, sin pagarle a nadie más |
| **La caja** | **Baja** — sale dinero de verdad | **No cambia** |
| **El saldo de la tienda** | Baja en el monto | Baja en el monto (igual) |
| **La ganancia de Ordenex** | No cambia | No cambia |

La pregunta que decide cuál usar es una sola: **¿salió plata de Ordenex hacia un tercero?** Si sí, es pago por cuenta. Si no —por ejemplo, le entregaste material de despacho en la bodega y se lo cobrás— es cobrar un costo.

**Por qué importa elegir bien:** los dos bajan el saldo de la tienda, pero solo uno registra la salida real de dinero. Si registrás mal un pago por cuenta como si fuera un cobro, la caja queda mostrando plata que ya no está — eso descuadra todo.

Un ejemplo concreto: Ordenex le paga ₡50.000 a Facebook por publicidad de una tienda.
- Bien registrado como **pago por cuenta**: la caja baja ₡50.000 (se fue a Facebook) y el saldo de la tienda baja ₡50.000. Cuadra.
- Mal registrado como **cobro**: el saldo de la tienda baja igual, pero la caja no registra que esa plata salió. Queda un hueco.

Los dos movimientos se registran desde **Wallet · Caja**, con **Registrar movimiento**.

[[doc:oficina/wallet-caja]]

===== [adminTienda] ¿por qué mi orden dice pendiente de confirmación?

"Pendiente de confirmación" significa que el mensajero ya registró qué pasó con esa entrega (por ejemplo, "Entregado · pendiente de confirmación" o "Novedad · pendiente de confirmación"), pero todavía falta que se apruebe el cierre del día de ese mensajero.

Mientras eso no pase, la orden sigue apareciendo como **En reparto**, con esa nota al lado. Una vez que se aprueba el cierre, la orden pasa a su estado real —Entregado, Novedad, Devolución a origen por rechazo, etc.— y ahí recién se refleja el dinero correspondiente en **Mi wallet**.

Si el mensajero se equivocó y deshace la gestión, la nota desaparece y la orden vuelve a su ruta normal.

Podés ver todo esto en el historial de la orden, en **Órdenes**, donde quedan registrados los pasos: Gestión registrada, Gestión anulada, Gestión corregida, etc.

[[doc:tienda/ordenes]]

===== [maestro] ¿por qué la caja dice flujo de dinero registrado y sale negativa?

Eso pasa cuando **no hay un saldo inicial registrado** en la caja — por eso la tarjeta usa el nombre "Flujo de dinero registrado" en vez de "Dinero en caja".

Que salga negativa **no es un error**. Significa que parte de los pagos que se hicieron se pagaron con dinero que Ordenex ya tenía **antes** de empezar a usar la aplicación, y ese dinero de arranque nunca quedó registrado en el sistema. La salida del pago sí se anotó, pero la plata con la que se pagó, no — por eso el cálculo (lo que entró menos lo que salió desde el primer movimiento) puede quedar en negativo.

La misma tarjeta te lo indica con una línea debajo de la cifra, y te dice desde qué día está contando.

Si en algún momento se registra un **saldo inicial** (el dinero real con el que arrancó Ordenex), la tarjeta cambia de nombre a "Dinero en caja" y ahí sí una cifra negativa sería señal de que hay algo que revisar. Eso se registra desde **Registrar movimiento** en esta misma pantalla, con el concepto "Saldo inicial o aporte de capital" — pero ojo, la app nunca propone esa cifra: tiene que escribirla alguien que sepa cuánto había realmente.

[[doc:oficina/wallet-caja]]

===== [mensajero] ¿qué significa Novedad interna?

**Novedad interna** significa que terminaste el día con ese paquete todavía encima y sin registrar qué pasó con él (no lo entregaste, ni marcaste rechazo, reprogramación, devolución ni incidente).

Cuando pedís tu **Cierre del día**, esas órdenes que te quedaron sin gestionar aparecen en una lista aparte («Pasaron a Novedad interna»), para que quede constancia de qué llevabas encima ese día. Cuando la oficina aprueba tu cierre, el paquete vuelve a su bodega para que se asigne de nuevo.

Ojo: esto es distinto de las órdenes que sí gestionaste y quedaron pendientes de confirmación — esas no pasan a Novedad interna, solo las que no llegaste a gestionar.

[[doc:mensajero/cierre-del-dia]]
```
