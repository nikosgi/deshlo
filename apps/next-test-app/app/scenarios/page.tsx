import Link from "next/link";
import { ScenariosClient } from "./scenarios-client";

export default function ScenariosPage() {
  return (
    <main className="container scenarios-page">
      <h1>Annotation Scenario Playground</h1>
      <p>
        Use this page to stress-test bubble placement, nested scroll behavior, relinking, and
        persistence across dynamic UI changes.
      </p>
      <p>
        <Link href="/">Back to Home</Link>
      </p>
      <ScenariosClient />
    </main>
  );
}

