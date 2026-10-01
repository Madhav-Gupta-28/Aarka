import type {Metadata} from "next";

export const metadata: Metadata = {
  title: "How it works",
  description: "One share, one line, one date. How a split works, where every price comes from, and the risks, honestly.",
};

export default function Layout({children}: {children: React.ReactNode}) {
  return children;
}
