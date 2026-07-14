"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type DeleteTripButtonProps = {
  tripId: string;
  tripTitle: string;
};

export function DeleteTripButton({ tripId, tripTitle }: DeleteTripButtonProps) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);

  async function deleteTrip() {
    if (isDeleting) return;

    const confirmed = window.confirm(
      `Remove "${tripTitle || "this trip"}" from your dashboard?`
    );

    if (!confirmed) return;

    setIsDeleting(true);

    try {
      const response = await fetch(`/api/trips/${tripId}`, {
        method: "DELETE"
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Could not remove this trip.");
      }

      router.refresh();
    } catch (error) {
      window.alert(
        error instanceof Error
          ? error.message
          : "Could not remove this trip."
      );
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <button
      type="button"
      onClick={deleteTrip}
      disabled={isDeleting}
      className="mt-3 w-full rounded-full border border-rose-200 bg-white px-4 py-2 text-sm font-black text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {isDeleting ? "Removing…" : "Remove trip"}
    </button>
  );
}
