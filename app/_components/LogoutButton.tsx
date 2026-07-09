"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { logout } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";

export function LogoutButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleLogout = () => {
    startTransition(async () => {
      try {
        await logout();
        // R26: after logout completes, redirect to /login
        router.push("/login");
      } catch (error) {
        console.error("Logout failed:", error);
      }
    });
  };

  return (
    <Button onClick={handleLogout} disabled={isPending} variant="outline">
      {isPending ? "Cerrando sesión..." : "Cerrar sesión"}
    </Button>
  );
}
