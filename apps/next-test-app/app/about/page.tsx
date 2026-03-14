import Link from "next/link";

export default function AboutPage() {
  return (
    <main className="container">




      <h1>
       
       
       
       
        About Test Page
      </h1>
      <p>This page exists to validate multi-page behavior.</p>
      <ul>
        <li>Ensure links and navigation render correctly.</li>
        <li>Verify source metadata on nested JSX nodes.</li>
        <li>Confirm overlay logs the clicked source location.</li>
      </ul>
      <p>
        To test, open the Source Inspector overlay (hold ALT and click), then click
      </p>
      <p>
        <Link href="/">Back to Home</Link>
      </p>
    </main>
  );
}
