import type {Metadata, Viewport} from "next";
import {IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Serif} from "next/font/google";
import {Providers} from "@/components/Providers";
import {DataProvider} from "@/components/DataProvider";
import {Nav} from "@/components/Nav";
import {Footer} from "@/components/Footer";
import "./globals.css";

// One superfamily in three roles: serif for display, sans for the interface, mono for every
// number. Plex was drawn for data-dense screens, and its mono is the reason the tables line up.
const sans = IBM_Plex_Sans({
  subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans", display: "swap",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap",
});
const serif = IBM_Plex_Serif({
  subsets: ["latin"], weight: ["400", "500"], variable: "--font-serif", display: "swap",
});

export const metadata: Metadata = {
  title: {default: "Aarka — a floor and the upside, priced separately", template: "%s · Aarka"},
  description:
    "Split a tokenized stock into a floor that pays up to a strike and an upside that pays " +
    "above it. No borrowing, nothing to liquidate. Live on Robinhood Chain.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0e1116",
  colorScheme: "dark",
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable}`}>
      <body>
        <Providers>
          <DataProvider>
            <Nav />
            <main className="wrap">{children}</main>
            <Footer />
          </DataProvider>
        </Providers>
      </body>
    </html>
  );
}
