import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rezervacije",
  description: "Online rezervacija stola",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="hr">
      <body>{children}</body>
    </html>
  );
}
