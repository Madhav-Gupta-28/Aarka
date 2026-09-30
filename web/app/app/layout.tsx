import type {Metadata} from "next";

export const metadata: Metadata = {
  title: "App",
  description: "Earn cash on the shares you hold, or bet on a rise. Pick a stock, pick a line, see what you get before you do it.",
};

export default function Layout({children}: {children: React.ReactNode}) {
  return children;
}
