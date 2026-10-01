import type {Metadata} from "next";

export const metadata: Metadata = {
  title: "Split",
  description: "One split: its line, its end date, what each half is worth, and what they'd pay.",
};

export default function Layout({children}: {children: React.ReactNode}) {
  return children;
}
