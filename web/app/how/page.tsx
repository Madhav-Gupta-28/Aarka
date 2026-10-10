import {Shell} from "@/components/Chrome";
import {SmoothScroll} from "@/components/Kinetic";
import {Voyage} from "@/components/voyage/Voyage";

/**
 * How it works, as a voyage down a river: eight ports, a coin that changes at each, tablets that
 * write themselves, words that open into 3D deep dives. Spec mode is the same, as a reference.
 */
export default function How() {
  return (
    <Shell>
      <SmoothScroll />
      <Voyage />
    </Shell>
  );
}
