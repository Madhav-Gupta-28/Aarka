import Link from "next/link";
import {Shell} from "@/components/Chrome";
import {Relic} from "@/components/Relic";

export default function NotFound() {
  return (
    <Shell>
      <section className="wrap centre-page gridlines">
        <div className="plinth dither"><Relic name="fragTablet" size={320} alt="A broken clay tablet" /></div>
        <div>
          <span className="kicker">TABLET 404</span>
          <h1 className="display h-page">This inscription was <span className="px-em">lost to time.</span></h1>
          <p className="lead" style={{maxWidth: 520}}>The page you&apos;re looking for isn&apos;t here. Your funds are untouched.</p>
          <div className="row gap-16 wrap-row">
            <Link href="/" className="btn btn-primary btn-lg">Back home</Link>
            <Link href="/app" className="btn btn-secondary btn-lg">Open the app</Link>
          </div>
        </div>
      </section>
    </Shell>
  );
}
