import {Shell} from "@/components/Chrome";
import {SmoothScroll} from "@/components/Kinetic";
import {LearnBody} from "@/components/LearnBody";
import {SunBody} from "@/components/SunBody";

/**
 * How it works, for everyone who asks. The first half is for someone who has never heard of a
 * split: six tablets, three endings, a quiz. The second half is for someone who wants to check the
 * claims: where prices come from, the settlement rules, the challenge window, the contracts.
 */
export default function How() {
  return (
    <Shell strip={false}>
      <SmoothScroll />
      <LearnBody />
      <SunBody />
    </Shell>
  );
}
