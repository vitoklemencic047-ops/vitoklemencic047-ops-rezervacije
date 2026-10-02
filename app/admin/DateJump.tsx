"use client";

import { useRouter } from "next/navigation";

export default function DateJump({ date }: { date: string }) {
  const router = useRouter();
  return (
    <input type="date" defaultValue={date} key={date} aria-label="Datum"
      onChange={(e) => e.target.value && router.push(`/admin?datum=${e.target.value}`)} />
  );
}
