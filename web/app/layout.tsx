import type {Metadata, Viewport} from "next";
import {Gloock, Martian_Mono, Schibsted_Grotesk} from "next/font/google";
import localFont from "next/font/local";
import {Providers} from "@/components/Providers";
import "./globals.css";
import "./pages.css";
import "./kinetic.css";
import "./experience.css";

/**
 * Four voices. A knife-cut serif for feeling, a sturdy grotesk for reading, a terminal mono for
 * every number, and a pixel face for stamps and the one emphasis word per page. Swapping any of
 * them is one line here; everything else reads the CSS variables.
 */
const display = Gloock({weight: "400", subsets: ["latin"], variable: "--f-display", display: "swap"});
const ui = Schibsted_Grotesk({subsets: ["latin"], variable: "--f-ui", display: "swap"});
const num = Martian_Mono({subsets: ["latin"], variable: "--f-num", display: "swap", axes: ["wdth"]});
const px = localFont({src: "./fonts/DepartureMono-Regular.woff2", variable: "--f-px", display: "swap"});

/** Set before first paint so a Limestone reader never sees a flash of Basalt. A fixed string. */
const THEME_BOOT = `try{var t=localStorage.getItem('aarka.theme');if(t==='limestone')document.documentElement.dataset.theme=t}catch(e){}`;

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100"),
  title: {default: "Aarka — split a stock into a floor and the upside", template: "%s · Aarka"},
  openGraph: {type: "website", siteName: "Aarka", title: "Aarka — split a stock into a floor and the upside",
              description: "Earn cash on the shares you hold, or bet on a rise for a fraction of the price. No borrowing, nothing to liquidate."},
  twitter: {card: "summary_large_image", title: "Aarka — split a stock into a floor and the upside",
            description: "Earn cash on the shares you hold, or bet on a rise for a fraction of the price. No borrowing, nothing to liquidate."},
  description:
    "Keep the part you want. Sell or trade the part you don't. Put them back together anytime. " +
    "Tokenized stocks, split into a Floor and an Upside, priced by an independent public source.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0e1116",
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable} ${num.variable} ${px.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{__html: THEME_BOOT}} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
