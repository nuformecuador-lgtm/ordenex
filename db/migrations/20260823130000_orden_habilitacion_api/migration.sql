-- Feature 266 (T1.2, design §2.2, R21/R23/R24/R29) — BITACORA de las habilitaciones pedidas por
-- el canal por API key. ADITIVA y segura: crea UNA tabla nueva y no toca ni una fila, ni una
-- columna, ni un indice preexistente. El valor de enum `habilitacion_api` que la feature tambien
-- necesita va en su PROPIA migracion, ANTERIOR a esta (`20260823120000_...`): Postgres prohibe
-- usar un valor de enum recien anadido en la misma transaccion que lo anadio (55P04).
--
-- QUE GUARDA. Una fila por HABILITACION ACEPTADA, comun a las DOS ramas del endpoint (R23):
--   - rama A (`ayuda_tienda` con mensajero asignado): la orden volvio a `en_reparto`
--     -> `cambio_de_estado = true`, `estado_resultante = 'en_reparto'`.
--   - rama B (cualquier otro estado habilitable, o `ayuda_tienda` ya desasignada): el paquete esta
--     en bodega y NO se mueve el estado -> `cambio_de_estado = false`, `estado_resultante` = el
--     estado en el que la orden se quedo.
-- La rama B es la unica huella que deja su caso: sin fila de historial (no hubo transicion) y sin
-- webhook (decision firmada del humano, 2026-08-22). Por eso la `nota` es OBLIGATORIA.
--
-- ⚠️ NACE SIN LECTOR, y se ACEPTA (D4, firmada en la puerta del 2026-08-23): es una bitacora de
-- auditoria y ninguna superficie la consulta. Se escribe aqui, en voz alta, por el precedente de
-- la 270 —alli una columna que nadie leia paso inadvertida justamente porque nadie la habia
-- declarado write-only—. Exponerla es FICHA APARTE.
CREATE TABLE "orden_habilitacion_api" (
  "id"                TEXT NOT NULL,
  "orden_id"          TEXT NOT NULL,
  -- El usuario dedicado de la API key autenticada (`actor.usuarioId`), que es TAMBIEN el
  -- `tienda_id` de sus ordenes. No se acepta ningun identificador de tienda del cuerpo (R3).
  "actor_usuario_id"  TEXT NOT NULL,
  -- Obligatoria: recorte y tope de 200 caracteres en el borde (zod), el mismo de
  -- `orden_nota.cuerpo`. Sin motivo, el log de la rama B —lo UNICO que la rama B produce— no
  -- sirve para nada.
  "nota"              TEXT NOT NULL,
  -- ESCRITO, no derivado: derivar «hubo cambio de estado» del par (estado anterior, estado
  -- resultante) solo funciona si alguien recuerda como; asi la fila se explica sola y un test lo
  -- puede afirmar. `true` = rama A, `false` = rama B.
  "cambio_de_estado"  BOOLEAN NOT NULL,
  -- SNAPSHOT de lo que se le respondio al integrador en ese instante, no una referencia viva: por
  -- eso es TEXT y NO una FK a `order_status`. Si manana un value se renombra, la bitacora debe
  -- seguir diciendo lo que dijo.
  "estado_resultante" TEXT NOT NULL,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "orden_habilitacion_api_pkey" PRIMARY KEY ("id"),
  -- La bitacora vive mientras vive la orden; si la orden se borra fisicamente, sus habilitaciones
  -- se van con ella y no queda ni una fila huerfana. Patron literal de `orden_nota`.
  CONSTRAINT "orden_habilitacion_api_orden_id_fkey" FOREIGN KEY ("orden_id")
    REFERENCES "orden"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- RESTRICT y no CASCADE: la autoria es evidencia y no se pierde al dar de baja a un usuario.
  CONSTRAINT "orden_habilitacion_api_actor_usuario_id_fkey"
    FOREIGN KEY ("actor_usuario_id")
    REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- APPEND-ONLY (R24): la tabla no tiene `updated_at` ni `deleted_at` A PROPOSITO. Una segunda
-- habilitacion de la misma orden con otra nota es un HECHO NUEVO, no una correccion del anterior.
-- Mismo criterio que `orden_historial_estado`.

-- Leer TODAS las habilitaciones de una orden, ordenadas, con UNA sola consulta. Misma FORMA que el
-- indice del hilo de notas (`orden_nota(orden_id, created_at)`).
CREATE INDEX "orden_habilitacion_api_orden_id_created_at_idx"
  ON "orden_habilitacion_api"("orden_id", "created_at");

-- Segunda FK indexada (patron `orden_nota`).
CREATE INDEX "orden_habilitacion_api_actor_usuario_id_idx"
  ON "orden_habilitacion_api"("actor_usuario_id");

-- R29: RLS habilitada SIN policies (solo service role), patron
-- `orden_nota` / `orden_historial_estado` / `gestion_orden`. Toda la autorizacion de negocio —que
-- aqui es una sola cosa: la orden tiene que ser del owner de la key— vive en el service.
ALTER TABLE "orden_habilitacion_api" ENABLE ROW LEVEL SECURITY;
