# Feature 231 — brief de diseño (entrada para el spec)

> Aprobado por el humano el **2026-08-18**: eligió la **opción B** de un lienzo con cuatro
> direcciones más la pantalla actual como referencia. Lienzo (hi-fi, tokens reales del repo,
> incluye móvil 390 px, modo oscuro y hoja de estados):
> https://claude.ai/code/artifact/d2d23fb4-5e5a-46c2-8e82-10e5dd9db518
>
> Este archivo es el ENCARGO DE DISEÑO, no el spec. El spec (requirements EARS, design,
> tasks) lo escribe `spec_author` en `specs/231-wallet-caja-dos-bolsillos/`.

## Qué cambia en pantalla

Rediseño de `/wallet` (`app/(app)/wallet/`), sobre lo que ya entregaron las features 42, 173
y 200. No se toca ningún dato existente ni ninguna regla de permisos: la página sigue siendo
solo para roles de acceso total.

1. **La caja se parte en dos bolsillos.** «Dinero en caja» conserva su cifra y gana debajo una
   **barra de composición** de dos segmentos: la porción que es de las TIENDAS
   (contra-entrega cobrado y aún sin entregar) y la que es de ORDENEX (ganancia). Debajo de la
   barra, dos bloques con su importe y su explicación. El de las tiendas conserva el aviso y
   el enlace a `/wallet/tiendas` que hoy vive en la banda ámbar; el de Ordenex va en
   superficie neutra (el acento se reserva para acción y estado — DESIGN.md).
2. **La ganancia se abre concepto por concepto.** Tarjeta nueva «Cómo se compone la ganancia
   de Ordenex»: a la izquierda los INGRESOS propios por categoría (flete, flete de devolución,
   comisión COD, IVA del flete, IVA de la comisión, ajustes), a la derecha el desglose de
   EGRESOS que ya existe (`DesgloseEgresosDTO`), y en el pie la ganancia resultante.
3. **El libro gana la columna «Dueño»** (Ordenex / Tienda), como punto de color + texto — no
   como insignia, para no meter una pastilla más por fila.

Los tres tiles de hoy (`CajaResumenCard`) se refunden en la tarjeta 1: «Entró», «Salió» y el
conteo de movimientos quedan como datos secundarios a la derecha de la cifra grande.

## Lo que obliga a ampliar en el servidor

Verificado contra `lib/types/wallet.ts:148-162`, no supuesto:

| # | Falta hoy | Por qué no puede resolverse en el cliente |
|---|---|---|
| a | La **proporción** de la barra | El cliente tiene prohibido convertir montos a número (R64 de la 173). Dividir `deTerceros` entre `enCaja` en la UI es exactamente lo vedado. |
| b | El **desglose de ingresos propios** | `CajaResumenDTO` solo trae `ingresosPropios` agregado. Hace falta el simétrico de `DesgloseEgresosDTO`, derivado con los MISMOS filtros que el libro. |
| c | El **dueño** de cada movimiento | `WalletMovimientoDTO` no lo trae. Debe derivarse de la categoría EN EL SERVIDOR, para que la columna y la descarga digan lo mismo. |
| d | Bandera del **caso no repartible** | `signoGanancia` no basta: hace falta saber que la barra no admite dos segmentos. |

## Caso límite que el spec debe cerrar

Si Ordenex gasta más de lo que gana, la porción de las tiendas es **mayor que el total de la
caja** y la barra no puede partirse. La propuesta aprobada lo resuelve con la barra entera en
ámbar y el bloque de Ordenex en rojo, diciendo que hay dinero de las tiendas cubriendo ese
saldo. Está dibujado en el artboard «B · Estados y caso límite». Si el spec propone otra
salida, es decisión con firma humana, no un ajuste.

## Bloqueo conocido — no descubrirlo dos veces

`tests/components/descarga/WalletDescarga.test.tsx:590` fija con `toEqual` la secuencia EXACTA
de los seis encabezados visibles del libro:

```
["Fecha", "Tipo", "Categoría", "Monto", "Origen", "Acciones"]
```

Añadir «Dueño» lo pone rojo. Es la MISMA sobre-especificación que en la feature 200 bloqueó el
reordenado de columnas (está documentada en el comentario de `WalletLedger.tsx`): la aserción
es de la 173 y lo que quería afirmar era otra cosa — que las categorías nuevas no añaden ni
quitan columnas. **Cambiarla es una decisión deliberada y necesita firma humana.**

El otro test de descarga NO estorba: compara `Object.keys(fila)` contra
`COLUMNAS_DESCARGA_WALLET_CAJA`, así que cambiando la fila y la lista de columnas a la vez
sigue verde.

## Fuera de alcance (ficha aparte)

Las destapó el artboard de modo oscuro, pero son de la app entera, no de esta pantalla:

- **`border-asfalto-2` en `DataTable.tsx:501`** es un token FIJO sin variante dark: en modo
  oscuro toda tabla del portal lleva un marco casi blanco (#dde1ee) sobre la tarjeta oscura.
- **El texto de error del `DataTable`** usa `text-destructive` (#ef4444): 3,76:1 sobre la
  tarjeta clara, por debajo de AA. Es el mismo patrón que las features 210 y 222 ya corrigieron
  en `Badge` y `Button` apuntando al par de `danger`.

## Otras dos direcciones, descartadas pero disponibles

Están en la página «Direcciones (archivo)» del lienzo. Se guardan porque sus ideas son
injertables sobre B sin rediseñar nada:

- **Opción A · Extracto**: comprime toda la cabecera en una sola banda. Útil si B resulta
  demasiado alta.
- **Opción C · Puesto de mando**: agrupa el libro por día con subtotal. Injerto posible sobre
  el libro de B (exigiría que los subtotales por día también vengan del servidor).

---

## PUERTA HUMANA PASADA — 2026-08-18

El humano firmó las **cinco decisiones abiertas del spec tal como venían propuestas**
(respuesta literal: «Si dale»), sin excepción:

- **D1** — se sustituye la aserción `toEqual` de los seis encabezados
  (`tests/components/descarga/WalletDescarga.test.tsx:590`) por lo que su propio caso dice
  afirmar (que las categorías de la 173 no añaden ni quitan columnas, contra la lista que
  declara el componente), y se añade un caso propio para «Dueño».
- **D2** — fila «Otros gastos de Ordenex» derivada en el servidor para que el total de la
  tarjeta sea `egresosPropios`; `DesgloseEgresosDTO` de la 45/158 queda intacto y la tarjeta
  «Egresos» actual se absorbe con su lista extraída, para que las aserciones de la 45 y la 158
  se re-hospeden en vez de borrarse.
- **D3** — los campos nuevos del resumen viajan como STRING plano.
- **D4** — el caso espejo (`deTerceros` negativo) se resuelve con el modo `solo_ordenex`.
- **D5** — entra `ingreso_iva_flete_devolucion` como séptimo concepto de ingreso.

### Lo que falta estampar en la ficha, y por qué no se hizo aquí

`feature_list.json` **no se pudo actualizar en este momento**: la ficha 231 acabó commiteada
dentro de `d648bce9`, en la rama `feature/230-dinero-sin-centimos`, y el árbol de trabajo está
ahora mismo en ESA rama, de otra sesión. Cuando el árbol vuelva a la rama
`feature/231-wallet-caja-dos-bolsillos` hay que estampar en la ficha 231:

- `spec_ready_at: "2026-08-18"`
- `spec_approved_at: "2026-08-18"`
- `status: "spec_ready"`
- y en `status_note`, la línea de que las cinco decisiones se firmaron «todo por defecto».
