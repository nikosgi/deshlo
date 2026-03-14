import Link from "next/link";

export default function HomePage() {
  return (
    <main className="container">
      <h1>Source Inspector Test App</h1>
      <p>
        Hold <strong>Alt</strong> and click any element when
        <code>NEXT_PUBLIC_SOURCE_INSPECTOR=1</code>.
      </p>

      <section className="card-row">
        <article className="card">
          <h2>Card Adf</h2>
          <p>This element should get data source coordinates in webpack mode.</p>
        </article>
        <article className="card">
          <h2>Card B</h2>
          <p>Use this page to verify loader injection behavior.</p>
        </article>
      </section>

      <p>
        <Link href="/about">Go to About page</Link>
      </p>
    </main>
  );
}
