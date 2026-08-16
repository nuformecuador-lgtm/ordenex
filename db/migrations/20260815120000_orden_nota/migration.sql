-- Feature 227 (design §1.3, M1) — HILO de notas por orden entre la tienda y el mensajero.
-- ADITIVA y segura: crea UNA tabla nueva y no toca ni una fila, ni una columna, ni un indice
-- preexistente. El drop DESTRUCTIVO de `orden_mensajero_meta.nota` va en su PROPIA migracion
-- (M2), a proposito: mezclar lo aditivo con lo irreversible obligaria a que un solo `down.sql`
-- tirase tambien esta tabla con datos ya escritos.
--
-- Esta migracion NO lee, NO copia y NO migra `orden_mensajero_meta.nota` (R22): las notas
-- privadas de la feature 116 se escribieron bajo una promesa literal de privacidad y volcarlas
-- al hilo seria una fuga retroactiva. El hilo nace VACIO.
CREATE TABLE "orden_nota" (
  "id"         TEXT NOT NULL,
  "orden_id"   TEXT NOT NULL,
  "autor_id"   TEXT NOT NULL,
  -- R4: el rol VIGENTE al publicar, congelado. Columna y no JOIN a `usuario.rol`: el rol de
  -- un usuario puede cambiar y el hilo no debe reescribir con que sombrero se hablo.
  "rol_autor"  "rol_value" NOT NULL,
  "cuerpo"     TEXT NOT NULL,              -- R6/R7: recorte y tope de 200 caracteres en el borde
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- R31: borrado LOGICO. NULL = vigente. Es lo UNICO que muta en una fila, una vez y en un
  -- solo sentido; sin `updated_at` porque el cuerpo publicado no se edita (R2).
  "deleted_at" TIMESTAMP(3),

  CONSTRAINT "orden_nota_pkey" PRIMARY KEY ("id"),
  -- R30: el hilo vive mientras vive la orden; si la orden se borra fisicamente, sus notas se
  -- van con ella y no queda ni una fila huerfana.
  CONSTRAINT "orden_nota_orden_id_fkey" FOREIGN KEY ("orden_id")
    REFERENCES "orden"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- RESTRICT y no CASCADE: la autoria es evidencia en una disputa tienda<->mensajero y no se
  -- pierde al dar de baja a un usuario.
  CONSTRAINT "orden_nota_autor_id_fkey" FOREIGN KEY ("autor_id")
    REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- R3/R28: leer el hilo COMPLETO de una orden, ordenado, con UNA sola consulta. Misma FORMA
-- que el indice de historial de `chat_mensaje` (`conversacion_id`, `ocurrido_at`).
CREATE INDEX "orden_nota_orden_id_created_at_idx" ON "orden_nota"("orden_id", "created_at");

-- Segunda FK indexada (patron `orden_mensajero_meta`).
CREATE INDEX "orden_nota_autor_id_idx" ON "orden_nota"("autor_id");

-- R26: RLS habilitada SIN policies (solo service role), patron
-- `orden_mensajero_meta`/`plantilla_mensaje`. La autorizacion de negocio —rol, pertenencia a
-- la tienda, asignacion del mensajero y ventana de escritura por rol— vive en el service.
ALTER TABLE "orden_nota" ENABLE ROW LEVEL SECURITY;
