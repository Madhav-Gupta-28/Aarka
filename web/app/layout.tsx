import type {Metadata, Viewport} from "next";
import {Providers} from "@/components/Providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aarka — split a stock into a floor and the upside",
  description:
    "Own a stock? Sell its upside for cash. Want upside? Buy it without buying the stock. " +
    "Tokenized equities on Robinhood Chain.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0e1116",
  colorScheme: "dark",
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
